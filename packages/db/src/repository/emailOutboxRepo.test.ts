import { randomUUID } from "node:crypto";
import type { EmailOutboxStatus, RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { createEmailOutboxRepo } from "./emailOutboxRepo.js";
import { createOrganizationRepo } from "./organizationRepo.js";
import { emailOutbox } from "../schema/pg.js";
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
 * Inserts a row directly (bypassing the repo's `create`) so retry/failed
 * scenarios can start from a pre-seeded `attempts` value. Mirrors what the
 * service does across ticks.
 */
async function seedRow(
  db: Database,
  orgId: string,
  overrides: Partial<{
    status: EmailOutboxStatus;
    attempts: number;
    maxAttempts: number;
    nextRetryAt: Date | null;
    lastError: string | null;
  }> = {},
) {
  const ts = new Date();
  const status: EmailOutboxStatus = overrides.status ?? "pending";
  const [row] = await db
    .insert(emailOutbox)
    .values({
      id: randomUUID(),
      organizationId: orgId,
      type: "test_email",
      recipientEmail: "to@example.com",
      subject: "s",
      bodyText: "t",
      bodyHtml: null,
      status,
      attempts: overrides.attempts ?? 0,
      maxAttempts: overrides.maxAttempts ?? 3,
      lastError: overrides.lastError ?? null,
      nextRetryAt: overrides.nextRetryAt ?? null,
      sentAt: null,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning();
  return row!;
}

describe("emailOutboxRepo", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let organizationRepo: ReturnType<typeof createOrganizationRepo>;
  let emailRepo: ReturnType<typeof createEmailOutboxRepo>;
  let ctx: RequestContext;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-email-outbox");
    db = result.db;
    cleanup = result.cleanup;
    organizationRepo = createOrganizationRepo(db);
    emailRepo = createEmailOutboxRepo(db);
    const org = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "org",
        displayName: "Org",
        slug: `slug-${randomUUID().slice(0, 8)}`,
      },
    );
    ctx = createContext(org.id);
  });

  afterAll(async () => {
    await cleanup();
  });

  it("create inserts a pending row with attempts=0 and no retry/sent stamps", async () => {
    const row = await emailRepo.create(ctx, {
      type: "test_email",
      recipientEmail: "to@example.com",
      subject: "Hello",
      bodyText: "Body",
      maxAttempts: 3,
    });
    expect(row).toMatchObject({
      organizationId: ctx.organizationId,
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      nextRetryAt: null,
      sentAt: null,
    });
  });

  it("findDuePending returns pending rows due now (null or past nextRetryAt), oldest-first, limited", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-01-01T01:00:00Z");

    const due = await seedRow(db, ctx.organizationId, { nextRetryAt: null });
    const pastRetry = await seedRow(db, ctx.organizationId, {
      nextRetryAt: new Date("2025-12-31T23:00:00Z"),
    });
    const notYetDue = await seedRow(db, ctx.organizationId, {
      nextRetryAt: future,
    });
    const alreadySent = await seedRow(db, ctx.organizationId, {
      status: "sent",
    });

    const rows = await emailRepo.findDuePending(ctx, now, 100);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(due.id);
    expect(ids).toContain(pastRetry.id);
    expect(ids).not.toContain(notYetDue.id);
    expect(ids).not.toContain(alreadySent.id);
  });

  it("findDuePending respects the limit", async () => {
    const now = new Date();
    await seedRow(db, ctx.organizationId, { nextRetryAt: null });
    await seedRow(db, ctx.organizationId, { nextRetryAt: null });
    const rows = await emailRepo.findDuePending(ctx, now, 1);
    expect(rows).toHaveLength(1);
  });

  it("markSent sets status=sent, sentAt, and clears nextRetryAt", async () => {
    const row = await seedRow(db, ctx.organizationId, { nextRetryAt: null });
    const sentAt = new Date("2026-01-01T00:00:00Z");
    const updated = await emailRepo.markSent(ctx, row.id, sentAt);
    expect(updated).toMatchObject({
      id: row.id,
      status: "sent",
      nextRetryAt: null,
    });
    expect(updated?.sentAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("markRetryScheduled sets attempts, lastError, nextRetryAt, keeps status pending", async () => {
    const row = await seedRow(db, ctx.organizationId, { attempts: 0 });
    const retryAt = new Date("2026-01-01T00:01:00Z");
    const updated = await emailRepo.markRetryScheduled(
      ctx,
      row.id,
      1,
      "boom",
      retryAt,
    );
    expect(updated).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "boom",
    });
    expect(updated?.nextRetryAt?.toISOString()).toBe(
      "2026-01-01T00:01:00.000Z",
    );
  });

  it("markFailed sets attempts, lastError, status=failed, clears nextRetryAt", async () => {
    const row = await seedRow(db, ctx.organizationId, { attempts: 2 });
    const updated = await emailRepo.markFailed(ctx, row.id, 3, "final boom");
    expect(updated).toMatchObject({
      status: "failed",
      attempts: 3,
      lastError: "final boom",
      nextRetryAt: null,
    });
  });

  it("findById is scoped to the tenant organization", async () => {
    const row = await emailRepo.create(ctx, {
      type: "test_email",
      recipientEmail: "x@example.com",
      subject: "s",
      bodyText: "t",
      maxAttempts: 3,
    });
    expect(await emailRepo.findById(ctx, row.id)).not.toBeNull();
    // A context for a different org must not see it.
    const otherOrg = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "other",
        displayName: "Other",
        slug: `other-${randomUUID().slice(0, 8)}`,
      },
    );
    const otherCtx = createContext(otherOrg.id);
    expect(await emailRepo.findById(otherCtx, row.id)).toBeNull();
  });

  it("countByStatus returns pending/sent/failed counts scoped to the org", async () => {
    // Seed a known mix of statuses for THIS org (ctx). Other tests in this
    // file also seed rows, so we assert on the delta, not absolute totals.
    const before = await emailRepo.countByStatus(ctx);
    await seedRow(db, ctx.organizationId, { status: "pending" });
    await seedRow(db, ctx.organizationId, { status: "pending" });
    await seedRow(db, ctx.organizationId, { status: "sent" });
    await seedRow(db, ctx.organizationId, { status: "failed" });

    const after = await emailRepo.countByStatus(ctx);
    expect(after.pending).toBe(before.pending + 2);
    expect(after.sent).toBe(before.sent + 1);
    expect(after.failed).toBe(before.failed + 1);
  });

  it("countByStatus is scoped to the caller's organization", async () => {
    // Rows in ctx's org must NOT be counted by a different org's context.
    const otherOrg = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "iso",
        displayName: "Iso",
        slug: `iso-${randomUUID().slice(0, 8)}`,
      },
    );
    const otherCtx = createContext(otherOrg.id);

    await seedRow(db, ctx.organizationId, { status: "pending" });
    const before = await emailRepo.countByStatus(otherCtx);
    await seedRow(db, ctx.organizationId, { status: "sent" });
    const after = await emailRepo.countByStatus(otherCtx);

    // otherCtx's counts are unchanged despite rows added to ctx's org.
    expect(after).toEqual(before);
  });
});
