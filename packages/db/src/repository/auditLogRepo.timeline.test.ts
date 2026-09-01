import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { createAuditLogTestRepo } from "../testHelpers/auditLogTestRepo.js";
import { createOrganizationRepo } from "./organizationRepo.js";
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

describe("auditLogRepo.listByTarget (timeline)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  const rootContext = createContext("system", "Admin", "system");
  let ctx: RequestContext;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-repo-audit-timeline");
    db = result.db;
    cleanup = result.cleanup;
    const orgRepo = createOrganizationRepo(db);
    const suffix = randomUUID().slice(0, 8);
    const org = await orgRepo.create(rootContext, {
      name: `audit-tl-${suffix}`,
      displayName: `AuditTimeline ${suffix}`,
      slug: `audit-tl-${suffix}`,
    });
    ctx = createContext(org.id);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  });

  it("returns only rows matching (targetType, targetId) for the org, oldest-first", async () => {
    const repo = createAuditLogTestRepo(db);
    const attemptId = randomUUID();

    const first = await repo.create(ctx, {
      actorId: ctx.actorId,
      action: "attempt.start",
      targetType: "attempt",
      targetId: attemptId,
      metadata: { step: 1 },
    });
    // Force a distinct later timestamp so ordering is deterministic even when
    // both inserts land in the same millisecond.
    await new Promise((r) => setTimeout(r, 15));
    const second = await repo.create(ctx, {
      actorId: ctx.actorId,
      action: "attempt.submit",
      targetType: "attempt",
      targetId: attemptId,
      metadata: { step: 2 },
    });

    const rows = await repo.listByTarget(ctx, "attempt", attemptId);
    expect(rows.map((r) => r.auditLog.id)).toEqual([first.id, second.id]);
    expect(rows[0]!.auditLog.action).toBe("attempt.start");
    expect(rows[1]!.auditLog.action).toBe("attempt.submit");
  });

  it("excludes rows for a different targetId (boundary isolation)", async () => {
    const repo = createAuditLogTestRepo(db);
    const targetA = randomUUID();
    const targetB = randomUUID();

    await repo.create(ctx, {
      actorId: ctx.actorId,
      action: "attempt.start",
      targetType: "attempt",
      targetId: targetA,
      metadata: {},
    });
    await repo.create(ctx, {
      actorId: ctx.actorId,
      action: "attempt.start",
      targetType: "attempt",
      targetId: targetB,
      metadata: {},
    });

    const rowsForA = await repo.listByTarget(ctx, "attempt", targetA);
    expect(rowsForA.every((r) => r.auditLog.targetId === targetA)).toBe(true);
    expect(rowsForA.some((r) => r.auditLog.targetId === targetB)).toBe(false);
  });
});
