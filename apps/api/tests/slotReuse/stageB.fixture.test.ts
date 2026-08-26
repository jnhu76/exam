import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import examRoutes from "../../src/routes/exam.js";
import {
  buildTestApp,
  type TestContext,
} from "../../src/routes/testHelpers.js";
import { resolveTestScope } from "@exam/db/src/testScope.js";

/**
 * Round-3 slot-reuse isolation proof — STAGE B (the successor file).
 *
 * A LATER child Vitest run on the SAME execution slot / same physical slot
 * database as stage A. Enters through the canonical API test bootstrap
 * (buildTestApp). The inter-file reset boundary (per-process one-time
 * truncate in buildTestApp) MUST run before business state is observed:
 *
 *   - stage A's sentinel business row MUST NOT be visible;
 *   - the canonical baseline/seed (default org + admin + candidate) MUST be;
 *   - migration metadata MUST have survived the reset.
 *
 * The assertions below fail if that truncate boundary is removed (proven by
 * mutation during round-3 validation): without the reset, stage A's sentinel
 * course is still in the shared slot database.
 *
 * Inert in ordinary suite runs (parent spawns it with SLOT_REUSE_STAGE=B).
 */
const HANDOFF_PATH = process.env.SLOT_REUSE_HANDOFF ?? "";

describe.skipIf(process.env.SLOT_REUSE_STAGE !== "B")(
  "slot-reuse stage B (successor file, same slot database)",
  () => {
    let ctx: TestContext;
    let handoff: {
      stageADone: boolean;
      databaseName: string;
      poolId: string | null;
      sentinelCode: string;
      migrationCount: number;
    };

    beforeAll(
      async () => {
        handoff = JSON.parse(await readFile(HANDOFF_PATH, "utf8"));
        ctx = await buildTestApp(examRoutes);
      },
      // Lifecycle-queue participant: bootstrap takes the shared DDL lock.
      30_000,
    );

    afterAll(async () => {
      // Append stage B's verdict for the parent (single evidence file),
      // then release the app.
      const merged = {
        ...handoff,
        stageBDone: true,
        stageBDatabaseName: resolveTestScope(process.env).postgresDatabaseName,
        stageBPoolId: process.env.VITEST_POOL_ID ?? null,
      };
      await writeFile(HANDOFF_PATH, JSON.stringify(merged, null, 2));
      await ctx.cleanup();
    }, 30_000);

    it("resolves to the SAME physical slot database as stage A", () => {
      const scope = resolveTestScope(process.env);
      expect(scope.postgresDatabaseName).toBe(handoff.databaseName);
    });

    it("does NOT see stage A's sentinel (inter-file reset boundary held)", async () => {
      const rows = await ctx.conn.sql`
        SELECT count(*)::int AS c FROM courses WHERE code = ${handoff.sentinelCode}
      `;
      expect(Number((rows[0] as { c: number }).c)).toBe(0);
    });

    it("sees the canonical baseline/seed, not stage A's data", async () => {
      // The seeded default organization is exactly the one business org
      // present after the reset + seed; ctx.admin/ctx.candidate come from the
      // seed result, proving the canonical baseline rather than leftovers.
      expect(ctx.org.slug).toBe("default");
      expect(ctx.admin.role).toBe("Admin");
      expect(ctx.candidate.role).toBe("Candidate");
      const orgs = await ctx.conn.sql`
        SELECT count(*)::int AS c FROM organizations
      `;
      expect(Number((orgs[0] as { c: number }).c)).toBe(1);
    });

    it("migration metadata survived the reset", async () => {
      const meta = await ctx.conn.sql`
        SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations
      `;
      expect(Number((meta[0] as { c: number }).c)).toBe(handoff.migrationCount);
    });
  },
);
