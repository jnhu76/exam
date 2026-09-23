import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { open, readFile, writeFile } from "node:fs/promises";
import { expect } from "vitest";
import type { TestContext } from "../../src/routes/testHelpers.js";
import { getTestInfraLockAcquisitionCount } from "@exam/db/src/testInfraLock.js";
import { resolveTestScope } from "@exam/db/src/testScope.js";

/**
 * Shared protocol for the two bootstrap-lifetime fixture files (spawned as
 * ONE child Vitest run with maxWorkers=1 by bootstrap-lifetime.test.ts).
 *
 * The proof is role-agnostic: whichever file the child runner executes first
 * elects the "first" role via an exclusive lock file, runs on the cold
 * worker-slot database, and records its process/slot identity and lifecycle
 * acquisition count. The second file must observe the SAME pool slot and
 * worker database even if Vitest executes it in a fresh worker process, plus
 * ZERO new lifecycle acquisitions (the slot lifetime of the @exam/db
 * bootstrap fact across per-file process/module isolation), and — because the
 * per-file business-data reset has FILE lifetime — no trace of the first
 * file's sentinel business row, with canonical seed state and migration
 * metadata intact.
 *
 * The acquisition counter is module-local in `testInfraLock`, so it starts
 * at zero per file exactly like every other module-level fact — a faithful
 * per-file measurement of "did this file's buildTestApp take lifecycle locks".
 */

export const BOOTSTRAP_LIFETIME_HANDOFF =
  process.env.BOOTSTRAP_LIFETIME_HANDOFF ?? "";

export interface LifetimeHandoff {
  /** Basename of the fixture file that wrote this handoff. */
  file: string;
  pid: number;
  poolId: string | null;
  workerDb: string;
  /** Lifecycle-lock acquisitions taken during THIS file's module realm. */
  lockAcquisitions: number;
  sentinelCode: string;
  migrationCount: number;
  /** Only meaningful in the second file's handoff. */
  sentinelSeen: boolean | null;
  canonicalSeedOk: boolean | null;
}

const ROLE_LOCK = "role-first.lock";
const FIRST_HANDOFF = "first-handoff.json";
const SECOND_HANDOFF = "second-handoff.json";

async function electFirstFile(): Promise<boolean> {
  try {
    const fh = await open(join(BOOTSTRAP_LIFETIME_HANDOFF, ROLE_LOCK), "wx");
    await fh.close();
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

export async function runBootstrapLifetimeFixture(
  ctx: TestContext,
  selfFile: string,
): Promise<void> {
  const isFirstFile = await electFirstFile();
  const workerDb = resolveTestScope(process.env).postgresDatabaseName;
  expect(workerDb).not.toBeNull();
  const poolId = process.env.VITEST_POOL_ID ?? null;
  const lockAcquisitions = getTestInfraLockAcquisitionCount();

  if (isFirstFile) {
    // Cold first file: its buildTestApp performed THE slot bootstrap —
    // ONE merged ensure+migrate critical section, nothing else on the
    // lifecycle lane.
    expect(lockAcquisitions).toBe(1);

    const sentinelCode = `bootlifetime-sentinel-${randomUUID()}`;
    await ctx.conn.sql`
      INSERT INTO courses
        (id, organization_id, name, code, description, created_at, updated_at)
      VALUES (${randomUUID()}, ${ctx.org.id}, ${"Bootstrap Lifetime Sentinel"},
              ${sentinelCode}, ${"poison row from the first lifetime file"},
              now(), now())
    `;
    const found = await ctx.conn.sql`
      SELECT count(*)::int AS c FROM courses WHERE code = ${sentinelCode}
    `;
    expect(Number((found[0] as { c: number }).c)).toBe(1);

    const meta = await ctx.conn.sql`
      SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations
    `;
    const migrationCount = Number((meta[0] as { c: number }).c);
    expect(migrationCount).toBeGreaterThan(0);

    await writeFile(
      join(BOOTSTRAP_LIFETIME_HANDOFF, FIRST_HANDOFF),
      JSON.stringify(
        {
          file: selfFile,
          pid: process.pid,
          poolId,
          workerDb,
          lockAcquisitions,
          sentinelCode,
          migrationCount,
          sentinelSeen: null,
          canonicalSeedOk: null,
        } satisfies LifetimeHandoff,
        null,
        2,
      ),
    );
    return;
  }

  const first = JSON.parse(
    await readFile(join(BOOTSTRAP_LIFETIME_HANDOFF, FIRST_HANDOFF), "utf8"),
  ) as LifetimeHandoff;

  // Bootstrap lifetime: SLOT, not file. Vitest executes each file in its own
  // worker process (forks pool, isolate:true) — which is exactly WHY the
  // bootstrap fact must live server-side — but both files resolve the SAME
  // pool slot and worker database, and this file's build took ZERO lifecycle
  // acquisitions: the precheck observed the completed bootstrap without the
  // lane.
  expect(lockAcquisitions).toBe(0);
  expect(poolId).toBe(first.poolId);
  expect(workerDb).toBe(first.workerDb);
  expect(selfFile).not.toBe(first.file);

  // Reset lifetime: FILE, not slot. The second file's first buildTestApp
  // must have truncated the first file's sentinel business row.
  const sentinel = await ctx.conn.sql`
    SELECT count(*)::int AS c FROM courses WHERE code = ${first.sentinelCode}
  `;
  const sentinelSeen = Number((sentinel[0] as { c: number }).c) > 0;
  expect(sentinelSeen).toBe(false);

  // The reset preserves canonical seeded state.
  const orgs = await ctx.conn.sql`
    SELECT count(*)::int AS c FROM organizations WHERE slug = 'default'
  `;
  const admins = await ctx.conn.sql`
    SELECT count(*)::int AS c FROM users WHERE username = 'admin'
  `;
  const canonicalSeedOk =
    Number((orgs[0] as { c: number }).c) > 0 &&
    Number((admins[0] as { c: number }).c) > 0;
  expect(canonicalSeedOk).toBe(true);

  // The reset preserves migration metadata (truncate never touches it), and
  // the slot-lifetime bootstrap means no migration ran in between.
  const meta = await ctx.conn.sql`
    SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations
  `;
  const migrationCount = Number((meta[0] as { c: number }).c);
  expect(migrationCount).toBe(first.migrationCount);

  await writeFile(
    join(BOOTSTRAP_LIFETIME_HANDOFF, SECOND_HANDOFF),
    JSON.stringify(
      {
        file: selfFile,
        pid: process.pid,
        poolId,
        workerDb,
        lockAcquisitions,
        sentinelCode: first.sentinelCode,
        migrationCount,
        sentinelSeen,
        canonicalSeedOk,
      } satisfies LifetimeHandoff,
      null,
      2,
    ),
  );
}
