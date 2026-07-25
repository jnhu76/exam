import { randomUUID } from "node:crypto";
import type {
  EmailOutboxStatus,
  OrganizationScope,
  RequestContext,
} from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { createEmailOutboxRepo } from "./emailOutboxRepo.js";
import { createOrganizationRepo } from "./organizationRepo.js";
import { emailOutbox } from "../schema/pg.js";
import type { Database } from "../types.js";
import { eq } from "drizzle-orm";

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
 * scenarios can start from a pre-seeded `attemptCount` value. Mirrors what the
 * service does across ticks.
 */
async function seedRow(
  db: Database,
  orgId: string,
  overrides: Partial<{
    status: EmailOutboxStatus;
    attemptCount: number;
    maxAttempts: number;
    nextAttemptAt: Date | null;
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
      attemptCount: overrides.attemptCount ?? 0,
      maxAttempts: overrides.maxAttempts ?? 3,
      lockedAt: null,
      lockedBy: null,
      providerMessageId: null,
      dedupeKey: null,
      lastError: overrides.lastError ?? null,
      nextAttemptAt: overrides.nextAttemptAt ?? null,
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
  let orgScope: OrganizationScope;

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
    orgScope = { organizationId: org.id };
  });

  afterAll(async () => {
    await cleanup();
  });

  it("create inserts a pending row with attemptCount=0 and no retry/sent stamps", async () => {
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
      attemptCount: 0,
      maxAttempts: 3,
      lastError: null,
      nextAttemptAt: null,
      sentAt: null,
    });
  });

  it("findDuePending returns pending rows due now (null or past nextAttemptAt), oldest-first, limited", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-01-01T01:00:00Z");

    const due = await seedRow(db, ctx.organizationId, { nextAttemptAt: null });
    const pastRetry = await seedRow(db, ctx.organizationId, {
      nextAttemptAt: new Date("2025-12-31T23:00:00Z"),
    });
    const notYetDue = await seedRow(db, ctx.organizationId, {
      nextAttemptAt: future,
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
    await seedRow(db, ctx.organizationId, { nextAttemptAt: null });
    await seedRow(db, ctx.organizationId, { nextAttemptAt: null });
    const rows = await emailRepo.findDuePending(ctx, now, 1);
    expect(rows).toHaveLength(1);
  });

  it("markSent sets status=sent, sentAt, providerMessageId, and clears nextAttemptAt/locks", async () => {
    const row = await seedRow(db, ctx.organizationId, { nextAttemptAt: null });
    const sentAt = new Date("2026-01-01T00:00:00Z");
    const updated = await emailRepo.markSent(ctx, row.id, sentAt, "msg-123");
    expect(updated).toMatchObject({
      id: row.id,
      status: "sent",
      nextAttemptAt: null,
      providerMessageId: "msg-123",
      lockedAt: null,
      lockedBy: null,
    });
    expect(updated?.sentAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("markSent stores null providerMessageId when absent", async () => {
    const row = await seedRow(db, ctx.organizationId, { nextAttemptAt: null });
    const sentAt = new Date("2026-01-01T00:00:00Z");
    const updated = await emailRepo.markSent(ctx, row.id, sentAt, null);
    expect(updated?.providerMessageId).toBeNull();
  });

  it("markRetryWait sets attemptCount, lastError, nextAttemptAt, status=retry_wait, clears locks", async () => {
    const row = await seedRow(db, ctx.organizationId, { attemptCount: 0 });
    const retryAt = new Date("2026-01-01T00:01:00Z");
    const updated = await emailRepo.markRetryWait(
      ctx,
      row.id,
      1,
      "boom",
      retryAt,
    );
    expect(updated).toMatchObject({
      status: "retry_wait",
      attemptCount: 1,
      lastError: "boom",
      lockedAt: null,
      lockedBy: null,
    });
    expect(updated?.nextAttemptAt?.toISOString()).toBe(
      "2026-01-01T00:01:00.000Z",
    );
  });

  it("markDead sets attemptCount, lastError, status=dead, clears nextAttemptAt/locks", async () => {
    const row = await seedRow(db, ctx.organizationId, { attemptCount: 2 });
    const updated = await emailRepo.markDead(ctx, row.id, 3, "final boom");
    expect(updated).toMatchObject({
      status: "dead",
      attemptCount: 3,
      lastError: "final boom",
      nextAttemptAt: null,
      lockedAt: null,
      lockedBy: null,
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

  it("countByStatus returns all status counts scoped to the org", async () => {
    const before = await emailRepo.countByStatus(ctx);
    await seedRow(db, ctx.organizationId, { status: "pending" });
    await seedRow(db, ctx.organizationId, { status: "pending" });
    await seedRow(db, ctx.organizationId, { status: "sent" });
    await seedRow(db, ctx.organizationId, { status: "dead" });

    const after = await emailRepo.countByStatus(ctx);
    expect(after.pending).toBe(before.pending + 2);
    expect(after.sent).toBe(before.sent + 1);
    expect(after.dead).toBe(before.dead + 1);
  });

  it("countByStatus is scoped to the caller's organization", async () => {
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

  it("claimDue returns claimed rows with processing status and lock fields", async () => {
    // Use a separate org to avoid interference from other tests
    const claimOrg = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "claim-org",
        displayName: "Claim",
        slug: `claim-${randomUUID().slice(0, 8)}`,
      },
    );
    const claimCtx = createContext(claimOrg.id);

    const now = new Date("2026-06-01T00:00:00Z");
    await seedRow(db, claimOrg.id, { nextAttemptAt: null });
    await seedRow(db, claimOrg.id, { nextAttemptAt: null });

    const claimed = await emailRepo.claimDue(claimCtx, now, "worker-1", 10);
    expect(claimed).toHaveLength(2);
    for (const row of claimed) {
      expect(row.status).toBe("processing");
      expect(row.lockedBy).toBe("worker-1");
      expect(row.lockedAt?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
      expect(row.attemptCount).toBe(1);
    }
  });

  it("claimDue skips rows already locked by another worker", async () => {
    const claimOrg = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "skip-org",
        displayName: "Skip",
        slug: `skip-${randomUUID().slice(0, 8)}`,
      },
    );
    const claimCtx = createContext(claimOrg.id);

    const now = new Date("2026-06-01T00:00:00Z");
    await seedRow(db, claimOrg.id, { nextAttemptAt: null });
    // Claim by worker-1
    const firstClaim = await emailRepo.claimDue(claimCtx, now, "worker-1", 10);
    expect(firstClaim).toHaveLength(1);

    // worker-2 should not claim the same row (SKIP LOCKED)
    const secondClaim = await emailRepo.claimDue(claimCtx, now, "worker-2", 10);
    expect(secondClaim).toHaveLength(0);
  });

  it("claimDue handles retry_wait rows that are due", async () => {
    const claimOrg = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "retry-org",
        displayName: "Retry",
        slug: `retry-${randomUUID().slice(0, 8)}`,
      },
    );
    const claimCtx = createContext(claimOrg.id);

    const now = new Date("2026-06-01T00:00:00Z");
    const past = new Date("2026-05-01T00:00:00Z");
    const future = new Date("2026-07-01T00:00:00Z");

    // A retry_wait row that is due (past nextAttemptAt)
    await seedRow(db, claimOrg.id, {
      status: "retry_wait" as EmailOutboxStatus,
      nextAttemptAt: past,
    });
    // A retry_wait row that is not yet due
    await seedRow(db, claimOrg.id, {
      status: "retry_wait" as EmailOutboxStatus,
      nextAttemptAt: future,
    });

    const claimed = await emailRepo.claimDue(claimCtx, now, "worker-1", 10);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.status).toBe("processing");
  });

  it("claimDue does not claim terminal rows (sent, dead)", async () => {
    const claimOrg = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "terminal-org",
        displayName: "Terminal",
        slug: `terminal-${randomUUID().slice(0, 8)}`,
      },
    );
    const claimCtx = createContext(claimOrg.id);

    const now = new Date("2026-06-01T00:00:00Z");
    await seedRow(db, claimOrg.id, { status: "sent" as EmailOutboxStatus });
    await seedRow(db, claimOrg.id, { status: "dead" as EmailOutboxStatus });

    const claimed = await emailRepo.claimDue(claimCtx, now, "worker-1", 10);
    expect(claimed).toHaveLength(0);
  });

  it("recoverAbandoned returns processing rows to pending after lock timeout", async () => {
    // Use a separate org to avoid interference from other tests
    const isoOrg = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "recovery-org",
        displayName: "Recovery",
        slug: `recovery-${randomUUID().slice(0, 8)}`,
      },
    );
    const recoveryCtx = createContext(isoOrg.id);

    const now = new Date("2026-06-01T00:00:00Z");
    const lockedLongAgo = new Date("2026-05-01T00:00:00Z");

    // Abandoned row (locked longer than 10 minutes ago)
    const abandonedRow = await seedRow(db, isoOrg.id, {
      status: "processing" as EmailOutboxStatus,
      attemptCount: 1,
    });
    await db
      .update(emailOutbox)
      .set({ lockedAt: lockedLongAgo, lockedBy: "dead-worker" })
      .where(eq(emailOutbox.id, abandonedRow.id));

    // Recently locked row (should NOT be recovered)
    const recentRow = await seedRow(db, isoOrg.id, {
      status: "processing" as EmailOutboxStatus,
      attemptCount: 1,
    });
    await db
      .update(emailOutbox)
      .set({ lockedAt: now, lockedBy: "active-worker" })
      .where(eq(emailOutbox.id, recentRow.id));

    // 10 minute timeout
    const recovered = await emailRepo.recoverAbandoned(
      recoveryCtx,
      now,
      600_000, // 10 minutes
    );
    expect(recovered).toBe(1); // Only the old row should be recovered
  });

  it("accepts OrganizationScope context (not just RequestContext)", async () => {
    const row = await emailRepo.create(orgScope, {
      type: "test_email",
      recipientEmail: "org-scope@example.com",
      subject: "Org scope test",
      bodyText: "test",
      maxAttempts: 3,
    });
    expect(row.organizationId).toBe(orgScope.organizationId);
    expect(row.status).toBe("pending");

    const found = await emailRepo.findById(orgScope, row.id);
    expect(found).not.toBeNull();
  });
});
