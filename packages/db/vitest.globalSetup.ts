/**
 * Vitest globalSetup: test-database readiness for @exam/db.
 *
 * Applies the SAME ownership contract as apps/api's globalSetup via
 * `prepareTestDatabase` (@exam/db):
 *   - explicit TEST_DATABASE_URL → must already exist; a missing database
 *     fails fast with a clear error instead of cascading through the
 *     DB-backed test files;
 *   - implicit local target → `exam_test` is self-provisioned when missing
 *     (this is the path that makes a fresh `pnpm db:up` volume work for
 *     `pnpm test` with no initdb SQL).
 *
 * DIFFERENCE from apps/api: @exam/db's suite is mixed (pure resolver tests +
 * PG-integration tests). The PG-integration files self-skip via their
 * `PG_DESCRIBE` reachability guards when PostgreSQL is down, and that
 * contract must keep working — so an UNREACHABLE server is a soft skip here
 * (warning only), while a reachable server with a missing/misconfigured
 * target database is a hard fail-fast.
 *
 * No worker-DB sweep here: packages/db never runs in worker-database mode
 * (its tests use the per-file schema helper; the worker-DB lifecycle tests
 * create uniquely-named, self-cleaned fixtures).
 *
 * @see https://vitest.dev/config/globalsetup
 */
import { createConnection } from "node:net";
import { URL } from "node:url";
import { resolveTestBranchUrl } from "./src/databaseUrl.js";
import { prepareTestDatabase } from "./src/testDbBootstrap.js";

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

export default async function globalSetup(): Promise<void> {
  // Invalid URL (unsafe test DB name) is a hard configuration error even
  // before any probing — surface it directly.
  const url = resolveTestBranchUrl(process.env);
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : 5432;

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt += 1) {
    if (await probeTcp(host, port)) {
      // Server is up: enforce the ownership contract (self-provision the
      // implicit local exam_test / fail fast on a missing explicit DB).
      await prepareTestDatabase();
      return;
    }
    if (attempt < RETRY_COUNT) await sleep(RETRY_DELAY_MS);
  }

  process.stdout.write(
    `[vitest globalSetup] WARN: test database server ${host}:${port} unreachable — ` +
      `continuing without bootstrap (PG-guarded suites self-skip; unguarded ` +
      `DB-dependent suites will fail with connection errors).\n`,
  );
}
