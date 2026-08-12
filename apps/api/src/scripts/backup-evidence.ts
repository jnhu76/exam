/**
 * Local script: record durable backup / restore-drill evidence (P7-E2B).
 *
 * This is the typed operator evidence command between the P7-C backup
 * scripts (host) and the evidence ledger (PostgreSQL). It is invoked by
 * `scripts/backup/*.sh` at their natural checkpoints and by operators
 * recording restore-drill outcomes. It NEVER executes backups, restores, or
 * any infrastructure action — it only records EVIDENCE of what the scripts
 * already did.
 *
 * Usage (host, via the app container):
 *   docker compose exec -T app node dist/scripts/backup-evidence.js \
 *     start --operation-id logical:2026-08-12 --type logical \
 *       --artifact-label exam-2026-08-12.dump --executor host_script
 *   docker compose exec -T app node dist/scripts/backup-evidence.js \
 *     complete --operation-id logical:2026-08-12 --type logical \
 *       --artifact-label exam-2026-08-12.dump --size-bytes 123456 \
 *       --verification-method pg_restore_list --executor host_script
 *   docker compose exec -T app node dist/scripts/backup-evidence.js \
 *     fail --operation-id logical:2026-08-12 --type logical \
 *       --reason "pg_restore --list rejected the archive" --executor host_script
 *   docker compose exec -T app node dist/scripts/backup-evidence.js \
 *     drill --operation-id logical-restore:2026-08-12 --backup-type logical \
 *       --result succeeded --source automated --duration-ms 42000
 *
 * SUCCESS semantics (ADR-017 D10): `complete` records a verified success;
 * the CLI refuses to record success without verification evidence — use
 * `fail` for any non-verified outcome. The ledger NEVER stores secrets,
 * credentials, or host paths (only the safe artifact label).
 */

import { createDatabase } from "@exam/db";
import { createBackupEvidenceRepo } from "@exam/db/src/repository/backupEvidenceRepo.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { loadRootEnv } from "../config/loadRootEnv.js";
import { resolveDatabaseUrlFromEnv } from "../config/runtimeConfig.js";
import type {
  BackupExecutorType,
  BackupType,
  RestoreDrillResult,
  RestoreDrillSource,
} from "@exam/domain";

const BACKUP_TYPES: readonly BackupType[] = [
  "logical",
  "physical_base",
  "cold_filesystem",
];
const EXECUTOR_TYPES: readonly BackupExecutorType[] = [
  "host_script",
  "deployment_drill",
];
const DRILL_RESULTS: readonly RestoreDrillResult[] = [
  "succeeded",
  "failed",
  "operator_declared",
];
const DRILL_SOURCES: readonly RestoreDrillSource[] = [
  "automated",
  "operator_declared",
];

function fail(message: string): never {
  process.stderr.write(`backup-evidence: ${message}` + "\n");
  process.exit(1);
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      // Only `undefined` is a missing value; an option flag must never be
      // consumed as a value (e.g. `--reason --executor host_script`).
      if (value === undefined || value.startsWith("--"))
        fail(`missing value for --${key}`);
      args[key] = value;
      i++;
    }
  }
  return args;
}

function required(args: Record<string, string>, key: string): string {
  const v = args[key];
  if (!v) fail(`--${key} is required`);
  return v;
}

function assertOneOf<T extends string>(
  v: string,
  allowed: readonly T[],
  flag: string,
): T {
  if (!(allowed as readonly string[]).includes(v)) {
    fail(`--${flag} must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}

function assertBackupType(v: string): BackupType {
  return assertOneOf(v, BACKUP_TYPES, "type");
}

function assertExecutor(v: string): BackupExecutorType {
  return assertOneOf(v, EXECUTOR_TYPES, "executor");
}

function parsePositiveInt(v: string, flag: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0)
    fail(`--${flag} must be a non-negative integer`);
  return n;
}

/**
 * Resolves the single-tenant organization anchor (Phase 1 default org). The
 * evidence ledger is org-scoped like every business table.
 */
async function resolveDefaultOrgId(
  db: Awaited<ReturnType<typeof createDatabase>>["db"],
): Promise<string> {
  const rows = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .orderBy(schema.organizations.createdAt)
    .limit(1);
  if (!rows[0]) fail("no organization exists — bootstrap the deployment first");
  return rows[0]!.id;
}

async function main(): Promise<void> {
  loadRootEnv();
  // Test-mode guard: APP_MODE test/ci/e2e routes the resolver to
  // TEST_DATABASE_URL (fail-fast) — an operator recording evidence against a
  // test database would make the product ledger silently miss the run while
  // the shell hard gate passes. Refuse instead of writing to the wrong DB.
  const appMode = process.env.APP_MODE;
  if (appMode === "test" || appMode === "ci" || appMode === "e2e") {
    fail(
      `refusing to record evidence with APP_MODE=${appMode} (test database). ` +
        "Set APP_MODE=development and DATABASE_URL to the deployment database.",
    );
  }
  const databaseUrl = resolveDatabaseUrlFromEnv(process.env);
  let databaseName = "?";
  try {
    databaseName = new URL(databaseUrl).pathname.replace(/^\//, "") || "?";
  } catch {
    // Unparseable URL — the connection attempt below will surface the error.
  }
  process.stderr.write(`backup-evidence: target database "${databaseName}"\n`);
  const conn = await createDatabase(databaseUrl);
  try {
    const [command, ...rest] = process.argv.slice(2);
    if (!command) {
      fail(
        "subcommand required: start | complete | fail | drill (see file header for usage)",
      );
    }
    const args = parseArgs(rest);
    const orgId = await resolveDefaultOrgId(conn.db);
    const ctx = {
      organizationId: orgId,
      actorId: "system",
      role: "Admin" as const,
      permissions: [],
    };
    const repo = createBackupEvidenceRepo(conn.db);
    const now = new Date();

    switch (command) {
      case "start": {
        const operationId = required(args, "operation-id");
        const backupType = assertBackupType(required(args, "type"));
        const artifactLabel = required(args, "artifact-label");
        const executorType = assertExecutor(args.executor ?? "host_script");
        const run = await repo.startRun(ctx, {
          operationId,
          backupType,
          artifactLabel,
          executorType,
          now,
        });
        process.stdout.write(
          `started run ${run.id} (${run.operationId}, ${run.backupType})\n`,
        );
        break;
      }
      case "complete": {
        const operationId = required(args, "operation-id");
        const backupType = assertBackupType(required(args, "type"));
        const artifactLabel = required(args, "artifact-label");
        const sizeBytes = parsePositiveInt(
          required(args, "size-bytes"),
          "size-bytes",
        );
        const verificationMethod = required(args, "verification-method");
        const executorType = assertExecutor(args.executor ?? "host_script");
        const run = await repo.completeRun(ctx, {
          operationId,
          backupType,
          artifactLabel,
          artifactSizeBytes: sizeBytes,
          verificationMethod,
          verifiedAt: now,
          executorType,
          now,
        });
        if (run.status === "succeeded") {
          process.stdout.write(
            `verified success: ${run.artifactLabel} (${sizeBytes} bytes, ${verificationMethod})\n`,
          );
        } else if (run.status === "failed") {
          process.stderr.write(
            `duplicate operation conflict: a verified success for ${operationId} already exists with a different artifact; this attempt was NOT recorded as success\n`,
          );
          process.exit(1);
        }
        break;
      }
      case "fail": {
        const operationId = required(args, "operation-id");
        const backupType = assertBackupType(required(args, "type"));
        const reason = required(args, "reason");
        const executorType = assertExecutor(args.executor ?? "host_script");
        await repo.failRun(ctx, {
          operationId,
          backupType,
          executorType,
          reason,
          now,
        });
        process.stdout.write(
          `recorded failure for ${operationId}: ${reason}` + "\n",
        );
        break;
      }
      case "cold-import": {
        // Cold-filesystem backups run while PostgreSQL is STOPPED; the
        // script writes a typed spool next to the artifact and the operator
        // imports it here after `docker compose up -d`. The spool is a
        // transit file, NOT a second authority store — this command is the
        // only path that turns it into ledger rows, and it applies the same
        // verified-success semantics as `complete` (fail closed on a
        // contradictory duplicate). A malformed spool is rejected.
        const spoolPath = required(args, "spool");
        let spool: {
          schemaVersion?: unknown;
          operationId?: unknown;
          backupType?: unknown;
          artifactLabel?: unknown;
          artifactSizeBytes?: unknown;
          verificationMethod?: unknown;
          startedAt?: unknown;
          completedAt?: unknown;
          executorType?: unknown;
        };
        try {
          const fs = await import("node:fs/promises");
          spool = JSON.parse(
            await fs.readFile(spoolPath, "utf8"),
          ) as typeof spool;
        } catch {
          fail(`cannot read spool file: ${spoolPath}`);
        }
        if (spool.schemaVersion !== undefined && spool.schemaVersion !== 1)
          fail(
            `spool: unsupported schemaVersion ${String(spool.schemaVersion)}`,
          );
        if (typeof spool.operationId !== "string")
          fail("spool: operationId missing");
        if (typeof spool.backupType !== "string")
          fail("spool: backupType missing");
        if (typeof spool.artifactLabel !== "string")
          fail("spool: artifactLabel missing");
        const backupType = assertOneOf(spool.backupType, BACKUP_TYPES, "type");
        let sizeBytes = 0;
        if (spool.artifactSizeBytes !== undefined) {
          if (
            typeof spool.artifactSizeBytes !== "number" ||
            !Number.isInteger(spool.artifactSizeBytes) ||
            spool.artifactSizeBytes < 0
          ) {
            fail("spool: artifactSizeBytes must be a non-negative integer");
          }
          sizeBytes = spool.artifactSizeBytes;
        }
        const verificationMethod =
          typeof spool.verificationMethod === "string"
            ? spool.verificationMethod
            : "pg_version_presence";
        // The spool is an untrusted operator file: a malformed timestamp must
        // fail cleanly (never an uncaught RangeError from toISOString).
        const startedAt =
          typeof spool.startedAt === "string" ? new Date(spool.startedAt) : now;
        if (Number.isNaN(startedAt.getTime())) {
          fail(`spool: startedAt is not a valid date: ${spool.startedAt}`);
        }
        const run = await repo.completeRun(ctx, {
          operationId: spool.operationId,
          backupType,
          artifactLabel: spool.artifactLabel,
          artifactSizeBytes: sizeBytes,
          verificationMethod,
          verifiedAt: now,
          executorType: assertExecutor(
            typeof spool.executorType === "string"
              ? spool.executorType
              : "host_script",
          ),
          now,
          startedAt,
        });
        if (run.status === "succeeded") {
          process.stdout.write(
            `imported verified cold backup ${run.operationId} (started ${startedAt.toISOString()})\n`,
          );
        } else {
          process.stderr.write(
            `duplicate operation conflict: a verified success for ${spool.operationId} already exists; spool NOT imported\n`,
          );
          process.exit(1);
        }
        break;
      }
      case "drill": {
        const operationId = required(args, "operation-id");
        const backupType = assertOneOf(
          required(args, "backup-type"),
          BACKUP_TYPES,
          "backup-type",
        );
        const result = assertOneOf(
          required(args, "result"),
          DRILL_RESULTS,
          "result",
        );
        const source = assertOneOf(
          required(args, "source"),
          DRILL_SOURCES,
          "source",
        );
        const durationMs = args["duration-ms"]
          ? parsePositiveInt(args["duration-ms"], "duration-ms")
          : undefined;
        const drill = await repo.recordDrill(ctx, {
          operationId,
          backupType,
          result,
          source,
          startedAt: new Date(now.getTime() - (durationMs ?? 0)),
          completedAt: now,
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(args.reason ? { failureReason: args.reason } : {}),
        });
        process.stdout.write(
          `recorded ${source} restore drill ${drill.operationId}: ${drill.result}\n`,
        );
        break;
      }
      default:
        fail(`unknown subcommand: ${command}`);
    }
  } finally {
    await conn.sql.end();
  }
}

void main();
