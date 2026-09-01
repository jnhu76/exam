import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { auditLogs } from "../schema/pg.js";
import { createAuditLogTestRepo } from "../testHelpers/auditLogTestRepo.js";
import { createOrganizationRepo } from "./organizationRepo.js";
import { createUserRepo } from "./userRepo.js";
import type { Database } from "../types.js";

const permissions: RequestContext["permissions"] = [];

function createContext(
  organizationId: string,
  role: RequestContext["role"] = "Admin",
  targetOrganizationId?: string,
): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role,
    permissions,
    sessionId: randomUUID(),
    ...(targetOrganizationId ? { targetOrganizationId } : {}),
  };
}

/**
 * Backdate a just-inserted audit row to `ts`. Lets date-range bounds be
 * deterministic regardless of wall-clock time during the test run.
 */
async function backdate(db: Database, id: string, ts: Date): Promise<void> {
  await db.update(auditLogs).set({ createdAt: ts }).where(eq(auditLogs.id, id));
}

/**
 * ADR-007 Phase 6D isolation: each repo test file owns an isolated PG schema.
 * Tests insert rows directly via the base CRUD repo with controlled
 * `createdAt` timestamps so date-range bounds are deterministic.
 */
describe("auditLogRepo.listPaginatedFiltered (filters)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  const rootContext = createContext("system", "Admin", "system");
  let ctx: RequestContext;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-repo-audit-list");
    db = result.db;
    cleanup = result.cleanup;
    const orgRepo = createOrganizationRepo(db);
    const suffix = randomUUID().slice(0, 8);
    const org = await orgRepo.create(rootContext, {
      name: `audit-list-${suffix}`,
      displayName: `AuditList ${suffix}`,
      slug: `audit-list-${suffix}`,
    });
    ctx = createContext(org.id);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("filters by targetType", async () => {
    const repo = createAuditLogTestRepo(db);
    const examTarget = randomUUID();
    const userTarget = randomUUID();

    await repo.create(ctx, {
      actorId: ctx.actorId,
      action: "exam.create",
      targetType: "exam",
      targetId: examTarget,
      metadata: {},
    });
    await repo.create(ctx, {
      actorId: ctx.actorId,
      action: "user.create",
      targetType: "user",
      targetId: userTarget,
      metadata: {},
    });

    const { items } = await repo.listPaginatedFiltered(ctx, 1, 50, {
      targetType: "exam",
    });
    expect(items.every((r) => r.auditLog.targetType === "exam")).toBe(true);
    expect(items.some((r) => r.auditLog.targetId === examTarget)).toBe(true);
    expect(items.some((r) => r.auditLog.targetId === userTarget)).toBe(false);
  });

  it("filters by inclusive date range (from / to)", async () => {
    const repo = createAuditLogTestRepo(db);

    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const t1 = new Date("2026-02-01T00:00:00.000Z");
    const t2 = new Date("2026-03-01T00:00:00.000Z");
    const t3 = new Date("2026-04-01T00:00:00.000Z");

    const cases: Array<{ ts: Date; tag: string }> = [
      { ts: t0, tag: "t0" },
      { ts: t1, tag: "t1" },
      { ts: t2, tag: "t2" },
      { ts: t3, tag: "t3" },
    ];
    for (const { ts, tag } of cases) {
      const created = await repo.create(ctx, {
        actorId: ctx.actorId,
        action: `range.${tag}`,
        targetType: "range_test",
        targetId: randomUUID(),
        metadata: { tag },
      });
      await backdate(db, created.id, ts);
    }

    const tagsOf = (
      rows: { auditLog: { targetType: string; action: string } }[],
    ) =>
      rows
        .filter((r) => r.auditLog.targetType === "range_test")
        .map((r) => r.auditLog.action);

    // from = t1: includes t1, t2, t3 (>=).
    const fromOnly = await repo.listPaginatedFiltered(ctx, 1, 50, {
      from: t1,
    });
    const fromTags = tagsOf(fromOnly.items);
    expect(fromTags).toEqual(
      expect.arrayContaining(["range.t1", "range.t2", "range.t3"]),
    );
    expect(fromTags).not.toContain("range.t0");

    // to = t2: includes t0, t1, t2 (<=).
    const toOnly = await repo.listPaginatedFiltered(ctx, 1, 50, { to: t2 });
    const toTags = tagsOf(toOnly.items);
    expect(toTags).toEqual(
      expect.arrayContaining(["range.t0", "range.t1", "range.t2"]),
    );
    expect(toTags).not.toContain("range.t3");

    // from=t1, to=t2: only t1 and t2 (inclusive both bounds).
    const both = await repo.listPaginatedFiltered(ctx, 1, 50, {
      from: t1,
      to: t2,
    });
    const bothTags = tagsOf(both.items);
    expect(bothTags).toEqual(expect.arrayContaining(["range.t1", "range.t2"]));
    expect(bothTags).not.toContain("range.t0");
    expect(bothTags).not.toContain("range.t3");
  });

  it("combines action + targetType + date range", async () => {
    const repo = createAuditLogTestRepo(db);
    const keep = await repo.create(ctx, {
      actorId: ctx.actorId,
      action: "combo.keep",
      targetType: "combo_type",
      targetId: randomUUID(),
      metadata: {},
    });
    await repo.create(ctx, {
      actorId: ctx.actorId,
      action: "combo.drop",
      targetType: "combo_type",
      targetId: randomUUID(),
      metadata: {},
    });

    await backdate(db, keep.id, new Date("2026-02-15T00:00:00.000Z"));

    const { items } = await repo.listPaginatedFiltered(ctx, 1, 50, {
      action: "combo.keep",
      targetType: "combo_type",
      from: new Date("2026-02-01T00:00:00.000Z"),
      to: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(items.length).toBe(1);
    expect(items[0]!.auditLog.action).toBe("combo.keep");
  });
});

describe("auditLogRepo.listPaginatedFiltered (actorName join)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  const rootContext = createContext("system", "Admin", "system");

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-repo-audit-actor");
    db = result.db;
    cleanup = result.cleanup;
    const orgRepo = createOrganizationRepo(db);
    const suffix = randomUUID().slice(0, 8);
    const org = await orgRepo.create(rootContext, {
      name: `audit-actor-${suffix}`,
      displayName: `AuditActor ${suffix}`,
      slug: `audit-actor-${suffix}`,
    });
    const ctx = createContext(org.id);
    // Seed a user to be the audit actor.
    const userRepo = createUserRepo(db);
    const actor = await userRepo.create(ctx, {
      username: `actor-${suffix}`,
      passwordHash: "x",
      name: "张审计",
      role: "Admin",
      isActive: true,
    });
    // Seed an audit log referencing that user.
    const auditRepo = createAuditLogTestRepo(db);
    await auditRepo.create(ctx, {
      actorId: actor.id,
      action: "exam.create",
      targetType: "exam",
      targetId: randomUUID(),
      metadata: {},
    });
    // Also seed one with an actorId that has NO matching user (e.g. "system").
    await auditRepo.create(ctx, {
      actorId: "system",
      action: "admin.bootstrap",
      targetType: "system",
      targetId: randomUUID(),
      metadata: {},
    });
    // Stash org id on the context for the test below.
    (rootContext as unknown as { _orgId?: string })._orgId = org.id;
    (rootContext as unknown as { _ctx?: RequestContext })._ctx = ctx;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("resolves actorId → actorName via LEFT JOIN users", async () => {
    const stored = rootContext as unknown as { _ctx: RequestContext };
    const ctx = stored._ctx;
    const repo = createAuditLogTestRepo(db);
    const { items } = await repo.listPaginatedFiltered(ctx, 1, 50, {});
    const createRow = items.find((r) => r.auditLog.action === "exam.create");
    expect(createRow).toBeDefined();
    expect(createRow!.actorName).toBe("张审计");
  });

  it("returns null actorName when no matching user exists", async () => {
    const stored = rootContext as unknown as { _ctx: RequestContext };
    const ctx = stored._ctx;
    const repo = createAuditLogTestRepo(db);
    const { items } = await repo.listPaginatedFiltered(ctx, 1, 50, {
      action: "admin.bootstrap",
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.actorName).toBeNull();
  });
});
