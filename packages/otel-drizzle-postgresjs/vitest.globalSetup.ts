/**
 * Vitest globalSetup: test-database readiness for the DB telemetry plugin's
 * real-PG suite. Same ownership contract as @exam/db's globalSetup via
 * `prepareTestDatabase` (@exam/db): explicit TEST_DATABASE_URL must exist;
 * implicit local targets self-provision `exam_test`; an unreachable server
 * is a soft skip (the PG-guarded suites self-skip), a reachable server with
 * a misconfigured target fails fast.
 *
 * Run lease: claimed in worker-database mode exactly like @exam/db's — this
 * suite uses per-file schemas by default (getIsolatedTestDb), but a
 * worker-database invocation WOULD consume package worker slots, and two
 * concurrent package worker-slot runs would truncate each other's fixtures
 * (turbo serializes this package's test after @exam/db#test; the lease is
 * the manual-run guard with the same intent).
 */
import { createConnection } from "node:net";
import { URL } from "node:url";
import { resolveTestBranchUrl } from "@exam/db/databaseUrl";
import { acquireDbPackageRunLease } from "@exam/db/testInfraLock";
import { resolveDbIsolationMode } from "@exam/db/testScope";
import { prepareTestDatabase } from "@exam/db/testDbBootstrap";

const PROBE_TIMEOUT_MS = 2_000;
const RETRY_COUNT = 5;
const RETRY_DELAY_MS = 1_000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function probeTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export default async function globalSetup(): Promise<
  (() => Promise<void>) | undefined
> {
  const url = resolveTestBranchUrl(process.env);
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : 5432;

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt += 1) {
    if (await probeTcp(host, port)) {
      await prepareTestDatabase();
      if (resolveDbIsolationMode(process.env) !== "worker-database") {
        return undefined;
      }
      const lease = await acquireDbPackageRunLease(url, process.env);
      return async () => {
        await lease.release();
      };
    }
    if (attempt < RETRY_COUNT) await sleep(RETRY_DELAY_MS);
  }

  process.stdout.write(
    `[vitest globalSetup] WARN: test database server ${host}:${port} unreachable — ` +
      `continuing without bootstrap (PG-guarded suites self-skip).\n`,
  );
}
