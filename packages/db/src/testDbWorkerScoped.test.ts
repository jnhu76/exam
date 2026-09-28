import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "./schema/pg.js";
import { getWorkerScopedTestDb, resolveTestDbUrl } from "./testDb.js";
import { resolveDbPackageTestScope } from "./testScope.js";
import {
  setupWorkerTestDatabase,
  withDatabaseName,
} from "./testWorkerDatabase.js";

/**
 * #648 — contract tests for `getWorkerScopedTestDb`, the ordinary-test
 * worker-slot seam. The worker-database bootstrap, migrate-once and TRUNCATE
 * semantics themselves are owned by `testWorkerDatabase.test.ts` (unique
 * self-cleaned fixtures) and the API slot-reuse proofs; this file owns what
 * is NEW here:
 *
 *   - the FIRST helper use in a test file resets leftover business state on
 *     the package slot (the cross-file / cross-run isolation boundary);
 *   - a SECOND helper call in the SAME file does not reset again (files may
 *     retain rows across several in-file fixtures);
 *   - migration metadata survives the reset boundary on the package slots;
 *   - the slot name lives in the package-db namespace (exam_test_db_*),
 *     disjoint from API worker slots.
 *
 * The "predecessor" is simulated in-process: a handle on the SAME package
 * slot inserts a sentinel row and closes, exactly the state a previously
 * executed test file (same VITEST_POOL_ID, fresh process) leaves behind —
 * the bootstrap fact is server-side, so the helper then behaves as it would
 * at a real file handoff.
 */

const BASE_URL = resolveTestDbUrl();

async function pgReachable(url: string): Promise<boolean> {
  const sql = postgres(url, { connect_timeout: 2 });
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end();
  }
}

const PG_UP = await pgReachable(withDatabaseName(BASE_URL, "postgres"));
const PG_DESCRIBE = PG_UP ? describe : describe.skip;

/** Inserted by the simulated predecessor, queried after the file's reset. */
const sentinelSlug = `worker-scope-sentinel-${randomUUID().slice(0, 8)}`;
let sentinelSlugWasPresent = false;
let metadataCountBeforeReset = -1;
let cleanupFixture: (() => Promise<void>) | undefined;

afterAll(async () => {
  await cleanupFixture?.();
}, 30_000);

async function migrationMetadataCount(databaseUrl: string): Promise<number> {
  const raw = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await raw`
      SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations
    `;
    return rows[0]?.c ?? -1;
  } finally {
    await raw.end();
  }
}

async function sentinelOrgExists(
  databaseUrl: string,
  slug: string,
): Promise<boolean> {
  const raw = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await raw`
      SELECT 1 FROM organizations WHERE slug = ${slug} LIMIT 1
    `;
    return rows.length > 0;
  } finally {
    await raw.end();
  }
}

PG_DESCRIBE(
  "getWorkerScopedTestDb — ordinary-test worker-slot seam (#648)",
  { timeout: 30_000 },
  () => {
    let fixture: Awaited<ReturnType<typeof getWorkerScopedTestDb>>;

    beforeAll(async () => {
      // Slot-handoff predecessor: leave business rows + capture migration
      // metadata state on the package slot BEFORE this file's first helper
      // use, exactly as an earlier test file / run would have left them.
      const predecessor = await setupWorkerTestDatabase({
        scope: resolveDbPackageTestScope(),
      });
      try {
        await predecessor.db.insert(schema.organizations).values({
          id: randomUUID(),
          name: "worker-scope predecessor",
          displayName: "worker-scope predecessor",
          slug: sentinelSlug,
        });
        sentinelSlugWasPresent = await sentinelOrgExists(
          predecessor.databaseUrl,
          sentinelSlug,
        );
        metadataCountBeforeReset = await migrationMetadataCount(
          predecessor.databaseUrl,
        );
      } finally {
        await predecessor.close();
      }

      fixture = await getWorkerScopedTestDb();
      cleanupFixture = fixture.cleanup;
    }, 30_000);

    it("resolves the package slot in the exam_test_db_* namespace", () => {
      expect(fixture.databaseName).toMatch(/^exam_test_db_[a-z0-9_]+$/);
      expect(fixture.databaseUrl).toContain(`/${fixture.databaseName}`);
    });

    it("first use in the file reset the predecessor's business rows", async () => {
      expect(sentinelSlugWasPresent).toBe(true);
      expect(await sentinelOrgExists(fixture.databaseUrl, sentinelSlug)).toBe(
        false,
      );
    });

    it("migration metadata survived the reset boundary", async () => {
      expect(metadataCountBeforeReset).toBeGreaterThan(0);
      expect(await migrationMetadataCount(fixture.databaseUrl)).toBe(
        metadataCountBeforeReset,
      );
    });

    it("second helper call in the same file does NOT truncate again", async () => {
      const markerSlug = `worker-scope-marker-${randomUUID().slice(0, 8)}`;
      await fixture.db.insert(schema.organizations).values({
        id: randomUUID(),
        name: "worker-scope marker",
        displayName: "worker-scope marker",
        slug: markerSlug,
      });

      const again = await getWorkerScopedTestDb();
      // Same slot, same connection generation…
      expect(again.databaseName).toBe(fixture.databaseName);
      expect(again.databaseUrl).toBe(fixture.databaseUrl);
      // …and the pre-call row is still there: a second truncate would have
      // removed it.
      expect(await sentinelOrgExists(again.databaseUrl, markerSlug)).toBe(true);
    });
  },
);
