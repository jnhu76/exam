import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { auditLogs } from "../schema/pg.js";
import { createAuditLogTestRepo } from "../testHelpers/auditLogTestRepo.js";
import { createOrganizationRepo } from "./organizationRepo.js";
import type { Database } from "../types.js";

const permissions: RequestContext["permissions"] = [];

function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions,
    sessionId: randomUUID(),
  };
}

/**
 * ADR-007 Phase 6D isolation: each repo test file owns an isolated PG schema.
 * #298 keyset pagination over `(created_at DESC, id DESC)` — the id
 * tiebreaker makes the order total and stable even for rows sharing an exact
 * timestamp, so paging can never skip or duplicate a row.
 */
describe("auditLogRepo.listKeysetFiltered (keyset pagination)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  const rootContext = createContext("system");
  let ctx: RequestContext;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-repo-audit-keyset");
    db = result.db;
    cleanup = result.cleanup;
    const orgRepo = createOrganizationRepo(db);
    const suffix = randomUUID().slice(0, 8);
    const org = await orgRepo.create(rootContext, {
      name: `audit-keyset-${suffix}`,
      displayName: `AuditKeyset ${suffix}`,
      slug: `audit-keyset-${suffix}`,
    });
    ctx = createContext(org.id);
  });

  afterAll(async () => {
    await cleanup();
  });

  it("walks (created_at DESC, id DESC) without overlap or skip", async () => {
    const repo = createAuditLogTestRepo(db);
    // 7 rows, three sharing an exact timestamp to exercise the id tiebreaker.
    const stamps = [
      "2026-06-01T00:00:00.000Z",
      "2026-06-02T00:00:00.000Z",
      "2026-06-02T00:00:00.000Z",
      "2026-06-02T00:00:00.000Z",
      "2026-06-03T00:00:00.000Z",
      "2026-06-04T00:00:00.000Z",
      "2026-06-04T00:00:00.000Z",
    ];
    for (const ts of stamps) {
      const created = await repo.create(ctx, {
        actorId: ctx.actorId,
        action: "keyset.marker",
        targetType: "keyset_test",
        targetId: randomUUID(),
        metadata: {},
      });
      await db
        .update(auditLogs)
        .set({ createdAt: new Date(ts) })
        .where(eq(auditLogs.id, created.id));
    }

    const seen: string[] = [];
    let after: { createdAt: Date; id: string } | undefined;
    let pages = 0;
    for (;;) {
      const params: {
        limit: number;
        filter?: { targetType: string };
        after?: { createdAt: Date; id: string };
      } = { limit: 2, filter: { targetType: "keyset_test" } };
      if (after) params.after = after;
      const { items, hasMore } = await repo.listKeysetFiltered(ctx, params);
      for (const row of items) seen.push(row.auditLog.id);
      pages += 1;
      if (!hasMore) break;
      expect(items).toHaveLength(2);
      const last = items[items.length - 1]!;
      after = { createdAt: last.auditLog.createdAt, id: last.auditLog.id };
    }

    expect(pages).toBe(4); // 2 + 2 + 2 + 1
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7); // no duplicates

    // The paged walk must equal a single full read of the same query — the
    // strongest no-skip/no-dup/no-order-drift assertion available.
    const { items: allAtOnce } = await repo.listKeysetFiltered(ctx, {
      limit: 100,
      filter: { targetType: "keyset_test" },
    });
    expect(seen).toEqual(allAtOnce.map((r) => r.auditLog.id));
  });

  it("applies filters (action + targetType + actorId) with the cursor semantics", async () => {
    const repo = createAuditLogTestRepo(db);
    const otherActor = randomUUID();
    await repo.create(ctx, {
      actorId: ctx.actorId,
      action: "keyset.filtered",
      targetType: "keyset_filter",
      targetId: randomUUID(),
      metadata: {},
    });
    await repo.create(ctx, {
      actorId: otherActor,
      action: "keyset.filtered",
      targetType: "keyset_filter",
      targetId: randomUUID(),
      metadata: {},
    });
    await repo.create(ctx, {
      actorId: ctx.actorId,
      action: "keyset.filtered",
      targetType: "keyset_filter",
      targetId: randomUUID(),
      metadata: {},
    });

    const { items, hasMore } = await repo.listKeysetFiltered(ctx, {
      limit: 10,
      filter: {
        action: "keyset.filtered",
        targetType: "keyset_filter",
        actorId: ctx.actorId,
      },
    });
    expect(items).toHaveLength(2);
    expect(items.every((r) => r.auditLog.actorId === ctx.actorId)).toBe(true);
    expect(hasMore).toBe(false);
  });

  it("returns only rows strictly before the cursor (never repeats the cursor row)", async () => {
    const repo = createAuditLogTestRepo(db);
    const created = await repo.create(ctx, {
      actorId: ctx.actorId,
      action: "keyset.cursor",
      targetType: "keyset_cursor",
      targetId: randomUUID(),
      metadata: {},
    });
    const { items, hasMore } = await repo.listKeysetFiltered(ctx, {
      limit: 10,
      filter: { targetType: "keyset_cursor" },
      after: { createdAt: created.createdAt, id: created.id },
    });
    expect(items).toHaveLength(0);
    expect(hasMore).toBe(false);
  });

  it("combines the snapshot `to` bound with the cursor (window + keyset)", async () => {
    const repo = createAuditLogTestRepo(db);
    // #298 corrective: every continuation page runs the keyset predicate AND
    // the frozen snapshot upper bound together — this combination is the
    // load-bearing path, not an edge case.
    const snapshotTo = new Date("2026-07-01T12:00:00.000Z");
    for (const [ts, tag] of [
      ["2026-07-01T00:00:00.000Z", "early"],
      ["2026-07-02T00:00:00.000Z", "late"],
    ] as const) {
      const created = await repo.create(ctx, {
        actorId: ctx.actorId,
        action: "keyset.snapshot",
        targetType: "keyset_snapshot",
        targetId: tag,
        metadata: {},
      });
      await db
        .update(auditLogs)
        .set({ createdAt: new Date(ts) })
        .where(eq(auditLogs.id, created.id));
    }

    const bounded = await repo.listKeysetFiltered(ctx, {
      limit: 10,
      filter: { targetType: "keyset_snapshot", to: snapshotTo },
    });
    expect(bounded.items.map((r) => r.auditLog.targetId)).toEqual(["early"]);

    // The bound still holds on the continuation page past the early row:
    // the `late` row is newer than the snapshot and must stay invisible.
    const afterEarly = await repo.listKeysetFiltered(ctx, {
      limit: 10,
      filter: { targetType: "keyset_snapshot", to: snapshotTo },
      after: {
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        id: bounded.items[0]!.auditLog.id,
      },
    });
    expect(afterEarly.items).toHaveLength(0);
    expect(afterEarly.hasMore).toBe(false);
  });

  it("scopes strictly to the organization (cross-org rows are invisible)", async () => {
    const repo = createAuditLogTestRepo(db);
    const otherOrg = await createOrganizationRepo(db).create(rootContext, {
      name: `audit-keyset-other-${randomUUID().slice(0, 8)}`,
      displayName: "AuditKeysetOther",
      slug: `audit-keyset-other-${randomUUID().slice(0, 8)}`,
    });
    await repo.create(createContext(otherOrg.id), {
      actorId: "x",
      action: "keyset.other",
      targetType: "keyset_org",
      targetId: randomUUID(),
      metadata: {},
    });
    const { items } = await repo.listKeysetFiltered(ctx, {
      limit: 10,
      filter: { targetType: "keyset_org" },
    });
    expect(items).toHaveLength(0);
  });
});
