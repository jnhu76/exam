/**
 * Read-only measurement tool for `worker_heartbeats` growth (#800 D5,
 * MEASURE-first — Owner disposition CONFIRMED_LOW_MEASURE_FIRST).
 *
 * Every API/worker process starts with a fresh random `workerInstanceId`
 * (`hostname-pid-uuid`) and heartbeats UPSERT on that key; nothing deletes
 * expired instance rows, so every crash-looped worker restart leaks exactly
 * one row. Before scheduling any retention repair, this tool measures the
 * ACTUAL growth rate and the `findLatestByName` read cost on a live
 * deployment.
 *
 * The tool is strictly READ-ONLY: it sets `default_transaction_read_only`
 * on its session and issues only SELECT/EXPLAIN statements. It never
 * mutates the table, never prints the connection URL, and implements no
 * retention decision — sampling policy belongs to the operator.
 *
 * Usage:
 *   pnpm --filter @exam/api measure:worker-heartbeats
 *   pnpm --filter @exam/api measure:worker-heartbeats -- --sample-seconds 300
 *   pnpm --filter @exam/api measure:worker-heartbeats -- --worker-name email-delivery
 *   pnpm --filter @exam/api measure:worker-heartbeats -- --schema test_measure_witness
 *
 * Run periodically (cron/ops runbook) and archive the JSON output; comparing
 * two archived snapshots gives the growth rate. `--sample-seconds N` takes
 * both samples in one invocation for a bounded-interval delta. `--schema`
 * pins the Drizzle search_path (schema-isolated deployments / measurement
 * witnesses).
 */

import { createDatabase } from "@exam/db";
import { loadRootEnv } from "../config/loadRootEnv.js";

export interface WorkerHeartbeatsSnapshot {
  capturedAt: string;
  database: string;
  serverVersion: string;
  totalRows: number;
  byWorker: Array<{
    workerName: string;
    rows: number;
    distinctInstances: number;
    latestPollAt: string;
    oldestCreatedAt: string;
  }>;
  /** Cost probe of the exact query `findLatestByName` issues (diagnostics). */
  findLatestByNameProbe: {
    workerName: string;
    planNode: string;
    executionTimeMs: number;
  };
}

export interface GrowthMeasurement {
  sampleSeconds: number;
  first: WorkerHeartbeatsSnapshot;
  second: WorkerHeartbeatsSnapshot;
  deltaRows: number;
  deltaByWorker: Record<string, number>;
}

type Sql = Awaited<ReturnType<typeof createDatabase>>["sql"];

// EXPLAIN ANALYZE of the exact read path the workerHeartbeatRepo uses for
// diagnostics liveness (findLatestByName): filter by worker_name, order by
// last_poll_at DESC, take one row.
function findLatestByNameExplainSql(workerName: string): string {
  const quoted = workerName.replace(/'/g, "''");
  return (
    "EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM worker_heartbeats " +
    `WHERE worker_name = '${quoted}' ORDER BY last_poll_at DESC LIMIT 1`
  );
}

async function takeSnapshot(
  sql: Sql,
  probeWorkerName: string,
): Promise<WorkerHeartbeatsSnapshot> {
  const result = (await sql.unsafe(`
    SELECT json_build_object(
      'capturedAt', to_json(clock_timestamp()),
      'database', current_database(),
      'serverVersion', (SELECT setting FROM pg_catalog.pg_settings WHERE name = 'server_version'),
      'totalRows', (SELECT count(*) FROM worker_heartbeats),
      'byWorker', (
        SELECT coalesce(json_agg(row_to_json(t) ORDER BY t."workerName"), '[]'::json)
        FROM (
          SELECT worker_name AS "workerName",
                 count(*) AS "rows",
                 count(DISTINCT worker_instance_id) AS "distinctInstances",
                 max(last_poll_at) AS "latestPollAt",
                 min(created_at) AS "oldestCreatedAt"
          FROM worker_heartbeats
          GROUP BY worker_name
        ) t
      )
    ) AS snapshot
  `)) as Array<{
    snapshot: Omit<WorkerHeartbeatsSnapshot, "findLatestByNameProbe">;
  }>;

  const snapshot = result[0]!.snapshot;

  const planRows = (await sql.unsafe(
    findLatestByNameExplainSql(probeWorkerName),
  )) as Array<{
    "QUERY PLAN": Array<{
      Plan: { "Node Type": string };
      "Execution Time": number;
    }>;
  }>;
  const plan = planRows[0]!["QUERY PLAN"][0]!;

  return {
    ...snapshot,
    findLatestByNameProbe: {
      workerName: probeWorkerName,
      planNode: plan.Plan["Node Type"],
      executionTimeMs: plan["Execution Time"],
    },
  };
}

export async function measureWorkerHeartbeatGrowth(options: {
  sampleSeconds: number;
  probeWorkerName: string;
  schema?: string;
}): Promise<GrowthMeasurement | WorkerHeartbeatsSnapshot> {
  const { sampleSeconds, probeWorkerName, schema } = options;
  // OWNERSHIP: the measurement handle is a SINGLE dedicated connection
  // (`max: 1` on both branches — the searchPath branch pins it in
  // createPostgresDatabase, the default branch gets it from `options.max`),
  // so the session-level SET below provably covers EVERY statement this
  // tool issues. A default pooled handle would apply the SET to one
  // arbitrary connection while later statements could run unguarded on
  // others. No transaction is held across the sampling sleep — each
  // statement is its own implicit read-only transaction.
  const { sql } = await createDatabase(undefined, schema, { max: 1 });
  try {
    // Fail-safe: this session must never write, even if a future edit adds
    // a statement by mistake.
    await sql.unsafe("SET default_transaction_read_only = on");
    const first = await takeSnapshot(sql, probeWorkerName);
    if (sampleSeconds <= 0) {
      return first;
    }
    await new Promise((resolve) => setTimeout(resolve, sampleSeconds * 1000));
    const second = await takeSnapshot(sql, probeWorkerName);
    const deltaByWorker: Record<string, number> = {};
    for (const entry of second.byWorker) {
      const before = first.byWorker.find(
        (w) => w.workerName === entry.workerName,
      )?.rows;
      deltaByWorker[entry.workerName] =
        entry.rows - (before === undefined ? 0 : before);
    }
    return {
      sampleSeconds,
      first,
      second,
      deltaRows: second.totalRows - first.totalRows,
      deltaByWorker,
    };
  } finally {
    await sql.end();
  }
}

function parseArgs(argv: ReadonlyArray<string>): {
  sampleSeconds: number;
  probeWorkerName: string;
  schema?: string;
} {
  let sampleSeconds = 0;
  let probeWorkerName = "email-delivery";
  let schema: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sample-seconds") {
      const parsed = Number(argv[i + 1]);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`--sample-seconds requires a non-negative number`);
      }
      sampleSeconds = parsed;
      i++;
    } else if (argv[i] === "--worker-name") {
      probeWorkerName = argv[i + 1] ?? "";
      if (!/^[A-Za-z0-9._-]+$/.test(probeWorkerName)) {
        throw new Error(`--worker-name must match [A-Za-z0-9._-]+`);
      }
      i++;
    } else if (argv[i] === "--schema") {
      schema = argv[i + 1] ?? "";
      if (!/^[A-Za-z0-9_]+$/.test(schema)) {
        throw new Error(`--schema must match [A-Za-z0-9_]+`);
      }
      i++;
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  // exactOptionalPropertyTypes: only carry `schema` when actually provided.
  return {
    sampleSeconds,
    probeWorkerName,
    ...(schema !== undefined ? { schema } : {}),
  };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "\u0000");

if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  loadRootEnv();
  measureWorkerHeartbeatGrowth(options)
    .then((measurement) => {
      process.stdout.write(JSON.stringify(measurement, null, 2) + "\n");
    })
    .catch((err: unknown) => {
      // Never print the connection URL (it may carry credentials).
      process.stderr.write(
        `measurement failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    });
}
