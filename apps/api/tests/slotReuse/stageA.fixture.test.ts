import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import examRoutes from "../../src/routes/exam.js";
import {
  buildTestApp,
  type TestContext,
} from "../../src/routes/testHelpers.js";
import { resolveTestScope } from "@exam/db/src/testScope.js";

/**
 * Round-3 slot-reuse isolation proof — STAGE A (the predecessor file).
 *
 * Two sequential child Vitest runs share ONE execution slot (same resolved
 * worker id → same physical slot database). Stage A plays "file/process A":
 * it enters through the canonical API test bootstrap (buildTestApp), writes a
 * unique sentinel business row, and closes normally. Stage B (a LATER
 * process on the SAME slot DB) must not observe this sentinel.
 *
 * This file is inert in ordinary suite runs: the parent
 * (slot-reuse-isolation.test.ts) spawns it as a child Vitest run with
 * SLOT_REUSE_STAGE=A; without that env the whole describe skips.
 */
const HANDOFF_PATH = process.env.SLOT_REUSE_HANDOFF ?? "";
const SENTINEL_CODE = `slotreuse-sentinel-${randomUUID()}`;

describe.skipIf(process.env.SLOT_REUSE_STAGE !== "A")(
  "slot-reuse stage A (predecessor file)",
  () => {
    let ctx: TestContext;

    beforeAll(
      async () => {
        ctx = await buildTestApp(examRoutes);
      },
      // Lifecycle-queue participant: bootstrap takes the shared DDL lock.
      30_000,
    );

    afterAll(async () => {
      await ctx.cleanup();
    }, 30_000);

    it("writes a sentinel business row into its slot database", async () => {
      const scope = resolveTestScope(process.env);
      expect(scope.postgresDatabaseName).not.toBeNull();

      // Sentinel: a course row belonging to the seeded default org.
      await ctx.conn.sql`
        INSERT INTO courses
          (id, organization_id, name, code, description, created_at, updated_at)
        VALUES (${randomUUID()}, ${ctx.org.id}, ${"Slot Reuse Sentinel"},
                ${SENTINEL_CODE}, ${"poison row from stage A"}, now(), now())
      `;
      const found = await ctx.conn.sql`
        SELECT count(*)::int AS c FROM courses WHERE code = ${SENTINEL_CODE}
      `;
      expect(Number((found[0] as { c: number }).c)).toBe(1);

      // Migration metadata count at A's bootstrap time — stage B must observe
      // the SAME count (reset preserves migration metadata; no migrations ran
      // between the two files).
      const meta = await ctx.conn.sql`
        SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations
      `;
      const migrationCount = Number((meta[0] as { c: number }).c);
      expect(migrationCount).toBeGreaterThan(0);

      // Handoff: stage B (a separate process) reads this file.
      await writeFile(
        HANDOFF_PATH,
        JSON.stringify(
          {
            stageADone: true,
            databaseName: scope.postgresDatabaseName,
            poolId: process.env.VITEST_POOL_ID ?? null,
            workerInstanceId: process.env.VITEST_WORKER_ID ?? null,
            sentinelCode: SENTINEL_CODE,
            migrationCount,
          },
          null,
          2,
        ),
      );
    });
  },
);
