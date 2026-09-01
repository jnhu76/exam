import { randomUUID } from "node:crypto";
import type {
  EmailOutboxStatus,
  OrganizationScope,
  RequestContext,
} from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { setupIsolatedTestDb } from "../testIsolation.js";
import type { IsolatedTestDb } from "../testIsolation.js";
import { createDatabase } from "../database.js";
import type { DatabaseConnection } from "../database.js";
import { createEmailOutboxRepo } from "./emailOutboxRepo.js";
import { createOrganizationRepo } from "./organizationRepo.js";
import { emailOutbox } from "../schema/pg.js";
import type { Database } from "../types.js";
import { eq, sql } from "drizzle-orm";
import { migratePostgres } from "../postgres.js";

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
    sentAt: Date | null;
    lockedAt: Date | null;
    lockedBy: string | null;
    dedupeKey: string | null;
    createdAt: Date;
  }> = {},
) {
  const ts = new Date();
  const status: EmailOutboxStatus = overrides.status ?? "pending";

  // Enforce state machine invariants at the seed layer so tests don't
  // violate the new CHECK constraints.
  const isProcessing = status === "processing";
  const isSent = status === "sent";
  const isDead = status === "dead";
  const isRetryWait = status === "retry_wait";

  const lockedAt = overrides.lockedAt ?? (isProcessing ? ts : null);
  const lockedBy = overrides.lockedBy ?? (isProcessing ? "seed-worker" : null);
  const sentAt = overrides.sentAt ?? (isSent ? ts : null);
  const lastError = overrides.lastError ?? (isDead ? "seed dead error" : null);
  const nextAttemptAt =
    overrides.nextAttemptAt ??
    (isRetryWait ? new Date(ts.getTime() + 60_000) : null);

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
      lockedAt,
      lockedBy,
      providerMessageId: null,
      dedupeKey: overrides.dedupeKey ?? null,
      lastError,
      nextAttemptAt,
      sentAt,
      createdAt: overrides.createdAt ?? ts,
      updatedAt: ts,
    })
    .returning();
  return row!;
}

/** A simple promise-based barrier for synchronizing concurrent test steps. */
interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Rejects if the inner promise does not settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`Timed out after ${ms}ms — claimDue blocked on a locked row`),
      );
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
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
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

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
    const row = await seedRow(db, ctx.organizationId, {
      status: "processing",
      nextAttemptAt: null,
      lockedBy: "worker-1",
    });
    const sentAt = new Date("2026-01-01T00:00:00Z");
    const updated = await emailRepo.markSent(
      ctx,
      row.id,
      sentAt,
      "msg-123",
      "worker-1",
    );
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
    const row = await seedRow(db, ctx.organizationId, {
      status: "processing",
      nextAttemptAt: null,
      lockedBy: "worker-1",
    });
    const sentAt = new Date("2026-01-01T00:00:00Z");
    const updated = await emailRepo.markSent(
      ctx,
      row.id,
      sentAt,
      null,
      "worker-1",
    );
    expect(updated?.providerMessageId).toBeNull();
  });

  it("markSent returns null when ownership is lost (different workerInstanceId)", async () => {
    const row = await seedRow(db, ctx.organizationId, {
      status: "processing",
      nextAttemptAt: null,
      lockedBy: "worker-1",
    });
    const sentAt = new Date("2026-01-01T00:00:00Z");
    const updated = await emailRepo.markSent(
      ctx,
      row.id,
      sentAt,
      "msg-123",
      "other-worker",
    );
    expect(updated).toBeNull();
  });

  it("markRetryWait sets attemptCount, lastError, nextAttemptAt, status=retry_wait, clears locks", async () => {
    const row = await seedRow(db, ctx.organizationId, {
      status: "processing",
      attemptCount: 0,
      lockedBy: "worker-1",
    });
    const retryAt = new Date("2026-01-01T00:01:00Z");
    const updated = await emailRepo.markRetryWait(
      ctx,
      row.id,
      1,
      "boom",
      retryAt,
      "worker-1",
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

  it("markRetryWait returns null when ownership is lost", async () => {
    const row = await seedRow(db, ctx.organizationId, {
      status: "processing",
      attemptCount: 0,
      lockedBy: "worker-1",
    });
    const retryAt = new Date("2026-01-01T00:01:00Z");
    const updated = await emailRepo.markRetryWait(
      ctx,
      row.id,
      1,
      "boom",
      retryAt,
      "other-worker",
    );
    expect(updated).toBeNull();
  });

  it("markDead sets attemptCount, lastError, status=dead, clears nextAttemptAt/locks", async () => {
    const row = await seedRow(db, ctx.organizationId, {
      status: "processing",
      attemptCount: 2,
      lockedBy: "worker-1",
    });
    const updated = await emailRepo.markDead(
      ctx,
      row.id,
      3,
      "final boom",
      "worker-1",
    );
    expect(updated).toMatchObject({
      status: "dead",
      attemptCount: 3,
      lastError: "final boom",
      nextAttemptAt: null,
      lockedAt: null,
      lockedBy: null,
    });
  });

  it("markDead returns null when ownership is lost", async () => {
    const row = await seedRow(db, ctx.organizationId, {
      status: "processing",
      attemptCount: 2,
      lockedBy: "worker-1",
    });
    const updated = await emailRepo.markDead(
      ctx,
      row.id,
      3,
      "final boom",
      "other-worker",
    );
    expect(updated).toBeNull();
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

  describe("dedupe partial unique index", () => {
    let dedupeOrg: string;
    let otherOrg: string;

    beforeAll(async () => {
      const org = await organizationRepo.create(
        {
          actorId: "system",
          organizationId: "system",
          role: "Admin",
          permissions,
          sessionId: "s",
        },
        {
          name: "dedupe-org",
          displayName: "Dedupe",
          slug: `dedupe-${randomUUID().slice(0, 8)}`,
        },
      );
      dedupeOrg = org.id;

      const other = await organizationRepo.create(
        {
          actorId: "system",
          organizationId: "system",
          role: "Admin",
          permissions,
          sessionId: "s",
        },
        {
          name: "dedupe-other-org",
          displayName: "DedupeOther",
          slug: `dedupe-other-${randomUUID().slice(0, 8)}`,
        },
      );
      otherOrg = other.id;
    });

    it("rejects same org + same non-null dedupe key", async () => {
      await seedRow(db, dedupeOrg, { dedupeKey: "dup-1" });
      let caught: unknown;
      try {
        await seedRow(db, dedupeOrg, { dedupeKey: "dup-1" });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(JSON.stringify(caught)).toMatch(
        /email_outbox_org_dedupe_key_unique|23505/,
      );
    });

    it("rejects same org + same key after first row becomes sent", async () => {
      const row = await seedRow(db, dedupeOrg, {
        dedupeKey: "dup-sent",
        status: "processing",
        lockedBy: "seed-worker",
      });
      // Transition to terminal `sent`.
      await db
        .update(emailOutbox)
        .set({
          status: "sent",
          sentAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        })
        .where(eq(emailOutbox.id, row.id));
      let caughtSent: unknown;
      try {
        await seedRow(db, dedupeOrg, { dedupeKey: "dup-sent" });
      } catch (err) {
        caughtSent = err;
      }
      expect(caughtSent).toBeDefined();
      expect(JSON.stringify(caughtSent)).toMatch(
        /email_outbox_org_dedupe_key_unique|23505/,
      );
    });

    it("rejects same org + same key after first row becomes dead", async () => {
      const row = await seedRow(db, dedupeOrg, {
        dedupeKey: "dup-dead",
        status: "processing",
        lockedBy: "seed-worker",
      });
      // Transition to terminal `dead`.
      await db
        .update(emailOutbox)
        .set({
          status: "dead",
          lastError: "exhausted",
          nextAttemptAt: null,
          lockedAt: null,
          lockedBy: null,
        })
        .where(eq(emailOutbox.id, row.id));
      let caughtDead: unknown;
      try {
        await seedRow(db, dedupeOrg, { dedupeKey: "dup-dead" });
      } catch (err) {
        caughtDead = err;
      }
      expect(caughtDead).toBeDefined();
      expect(JSON.stringify(caughtDead)).toMatch(
        /email_outbox_org_dedupe_key_unique|23505/,
      );
    });

    it("accepts different org + same non-null key", async () => {
      await seedRow(db, dedupeOrg, { dedupeKey: "cross-org" });
      const row = await seedRow(db, otherOrg, { dedupeKey: "cross-org" });
      expect(row).toBeDefined();
    });

    it("accepts same org + two null dedupe keys", async () => {
      const a = await seedRow(db, dedupeOrg, { dedupeKey: null });
      const b = await seedRow(db, dedupeOrg, { dedupeKey: null });
      expect(a).toBeDefined();
      expect(b).toBeDefined();
    });

    it("index definition matches the partial unique predicate", async () => {
      const rows = await db.execute<{ indexdef: string }>(sql`
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'email_outbox_org_dedupe_key_unique'
      `);
      expect(rows).toHaveLength(1);
      const def = rows[0]!.indexdef;
      expect(def).toContain("UNIQUE");
      expect(def).toContain("organization_id");
      expect(def).toContain("dedupe_key");
      expect(def).toContain("WHERE");
      expect(def).toContain("dedupe_key IS NOT NULL");
    });
  });
});

/**
 * Concurrency tests using genuinely independent PostgreSQL connections.
 *
 * These prove `FOR UPDATE SKIP LOCKED` behavior — not just that a committed
 * `processing` row is unclaimable, but that `claimDue` skips an *uncommitted*
 * locked row without blocking.
 */
describe("emailOutboxRepo — SKIP LOCKED with independent connections", () => {
  let iso: IsolatedTestDb;
  let connA: DatabaseConnection;
  let connB: DatabaseConnection;
  let repoA: ReturnType<typeof createEmailOutboxRepo>;
  let repoB: ReturnType<typeof createEmailOutboxRepo>;
  let orgScope: OrganizationScope;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({ namespace: "db-email-concurrency" });
    // Two independent single-connection pools against the same isolated schema.
    connA = await createDatabase(iso.databaseUrl, iso.schemaName);
    connB = await createDatabase(iso.databaseUrl, iso.schemaName);
    // Migrate once — both connections share the same schema.
    await migratePostgres(connA.db, { migrationsSchema: iso.schemaName });

    const orgRepoA = createOrganizationRepo(connA.db);
    const org = await orgRepoA.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "conc-org",
        displayName: "Conc",
        slug: `conc-${randomUUID().slice(0, 8)}`,
      },
    );
    orgScope = { organizationId: org.id };
    repoA = createEmailOutboxRepo(connA.db);
    repoB = createEmailOutboxRepo(connB.db);
  }, 30_000);

  afterAll(async () => {
    try {
      await connA.sql.end();
    } catch {
      /* ignore */
    }
    try {
      await connB.sql.end();
    } catch {
      /* ignore */
    }
    await iso.cleanup();
  }, 30_000);

  it("connections use distinct PostgreSQL backends", async () => {
    const rowA = (
      await connA.sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
    )[0];
    const rowB = (
      await connB.sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
    )[0];
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    expect(rowA!.pid).not.toBe(rowB!.pid);
  });

  it("claimDue skips an uncommitted locked row and claims another", async () => {
    // Fresh org so earlier claims in this schema do not interfere.
    const orgRepoA = createOrganizationRepo(connA.db);
    const org = await orgRepoA.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "skip-locked-org",
        displayName: "SkipLocked",
        slug: `skiplock-${randomUUID().slice(0, 8)}`,
      },
    );
    const scope = { organizationId: org.id };
    const now = new Date("2026-07-01T00:00:00Z");

    // Two due rows with deterministic createdAt ordering.
    const rowA = await seedRow(connA.db, org.id, {
      nextAttemptAt: null,
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    const rowB = await seedRow(connA.db, org.id, {
      nextAttemptAt: null,
      createdAt: new Date("2026-06-02T00:00:00Z"),
    });

    // Connection A: start a transaction that locks row A (FOR UPDATE, no SKIP).
    const lockAcquired = deferred();
    const releaseLock = deferred();

    const lockHolder = (async () => {
      await connA.sql`BEGIN`;
      await connA.sql`
        SELECT id FROM email_outbox
        WHERE organization_id = ${org.id} AND id = ${rowA.id}
        FOR UPDATE
      `;
      lockAcquired.resolve();
      await releaseLock.promise;
      await connA.sql`ROLLBACK`;
    })();

    try {
      await lockAcquired.promise;

      // Connection B: claimDue must skip row A and claim row B.
      const claimed = await withTimeout(
        repoB.claimDue(scope, now, "worker-b", 2),
        5000,
      );

      expect(claimed).toHaveLength(1);
      expect(claimed[0]!.id).toBe(rowB.id);
      expect(claimed[0]!.status).toBe("processing");
      expect(claimed[0]!.lockedBy).toBe("worker-b");
      expect(claimed[0]!.attemptCount).toBe(1);
    } finally {
      releaseLock.resolve();
      await lockHolder;
    }

    // After releasing the lock, row A becomes claimable exactly once.
    const afterRelease = await repoA.claimDue(scope, now, "worker-a", 2);
    expect(afterRelease).toHaveLength(1);
    expect(afterRelease[0]!.id).toBe(rowA.id);
    expect(afterRelease[0]!.attemptCount).toBe(1);
  });

  it("parallel claims return disjoint row sets with no double-claims", async () => {
    const orgRepoA = createOrganizationRepo(connA.db);
    const org = await orgRepoA.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "parallel-org",
        displayName: "Parallel",
        slug: `par-${randomUUID().slice(0, 8)}`,
      },
    );
    const scope = { organizationId: org.id };
    const now = new Date("2026-07-01T00:00:00Z");

    // 12 due rows with deterministic createdAt ordering.
    for (let i = 0; i < 12; i++) {
      await seedRow(connA.db, org.id, {
        nextAttemptAt: null,
        createdAt: new Date(`2026-06-01T00:${String(i).padStart(2, "0")}:00Z`),
      });
    }

    // Both workers claim up to 6 rows in the same event-loop turn.
    const [claimedA, claimedB] = await Promise.all([
      repoA.claimDue(scope, now, "worker-a", 6),
      repoB.claimDue(scope, now, "worker-b", 6),
    ]);

    const idsA = claimedA.map((r) => r.id);
    const idsB = claimedB.map((r) => r.id);

    // No overlap.
    const intersection = idsA.filter((id) => idsB.includes(id));
    expect(intersection).toHaveLength(0);

    // Union covers all 12 rows.
    expect(new Set([...idsA, ...idsB]).size).toBe(12);

    // Every returned row has status=processing and was claimed once.
    for (const row of [...claimedA, ...claimedB]) {
      expect(row.status).toBe("processing");
      expect(row.attemptCount).toBe(1);
    }

    // lockedBy matches the worker that returned it.
    for (const row of claimedA) expect(row.lockedBy).toBe("worker-a");
    for (const row of claimedB) expect(row.lockedBy).toBe("worker-b");

    // Persisted state: exactly 12 processing rows, each attempt_count = 1.
    const persisted = await connA.sql<
      {
        id: string;
        locked_by: string;
        attempt_count: number;
      }[]
    >`
      SELECT id, locked_by, attempt_count
      FROM email_outbox
      WHERE organization_id = ${org.id} AND status = 'processing'
    `;
    expect(persisted).toHaveLength(12);
    for (const row of persisted) {
      expect(row.attempt_count).toBe(1);
      expect(["worker-a", "worker-b"]).toContain(row.locked_by);
    }
  });
});
