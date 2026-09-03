import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RequestContext } from "@exam/domain";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import { createNotificationRepo } from "@exam/db/src/repository/notificationRepo.js";
import { createEmailOutboxRepo } from "@exam/db/src/repository/emailOutboxRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { emailOutbox } from "@exam/db/src/schema/pg.js";
import { eq } from "drizzle-orm";
import {
  dispatchResultPublishedFanOut,
  dispatchResultPublishedToRecipient,
  dispatchExamAssigned,
} from "./notificationService.js";

// P5-N1-I2 Slice 6 — NotificationService transaction integration.
//
// These tests prove the atomicity invariant (P5-N1-R0 §17.2):
//   result mutation + required Inbox rows + required outbox rows commit together
// Inside a single executeInTransaction, a failed required Inbox/outbox write
// rolls back the whole publication. SMTP is never called (the worker drains
// the outbox asynchronously).
//
// Each test seeds its own recipient user/org inside the isolated test DB.

function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

const PUBLIC_WEB_ORIGIN = "https://exam.example.local";
const EMAIL_MAX_ATTEMPTS = 3;
const NOW = new Date("2026-07-25T12:00:00.000Z");

describe("dispatchResultPublishedToRecipient (transaction integration)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let orgId: string;
  let userCounter: number;

  async function createTestUser(organizationId: string): Promise<string> {
    const userRepo = createUserRepo(db);
    const ctx: RequestContext = {
      actorId: "system",
      organizationId,
      role: "Admin",
      permissions: [],
      sessionId: "s",
    };
    const user = await userRepo.create(ctx, {
      username: `notifsvc-${userCounter++}-${randomUUID().slice(0, 6)}`,
      passwordHash: "x",
      name: `User ${userCounter}`,
      role: "Candidate",
      isActive: true,
    });
    return user.id;
  }

  beforeAll(async () => {
    const env = await getIsolatedTestDb("api-notificationService");
    db = env.db;
    cleanup = env.cleanup;
    userCounter = 0;
    const org = await createOrganizationRepo(db).create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions: [],
        sessionId: "s",
      },
      {
        name: "Test Org",
        displayName: "Test Org",
        slug: `notifsvc-${randomUUID().slice(0, 8)}`,
      },
    );
    orgId = org.id;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("creates an Inbox row (required) and an outbox row when email exists, atomically", async () => {
    const ctx = createContext(orgId);
    const recipientUserId = await createTestUser(orgId);
    const attemptId = randomUUID();
    const examId = randomUUID();

    const result = await executeInTransaction(db, async (tx) => {
      return dispatchResultPublishedToRecipient(
        {
          db: tx,
          ctx,
          examTitle: "Test Exam",
          examId,
          recipients: [],
          publicWebOrigin: PUBLIC_WEB_ORIGIN,
          emailMaxAttempts: EMAIL_MAX_ATTEMPTS,
          now: NOW,
        },
        { userId: recipientUserId, email: "cand@example.com", attemptId },
      );
    });

    expect(result.inboxCreated).toBe(true);
    expect(result.outboxCreated).toBe(true);
    expect(result.notification.recipientUserId).toBe(recipientUserId);
    expect(result.notification.actionPath).toBe(`/exam/${attemptId}/result`);
    expect(result.notification.dedupeKey).toBe(`result_published:${examId}`);

    // Inbox row is committed.
    const notifRepo = createNotificationRepo(db);
    const unread = await notifRepo.countUnread(ctx, recipientUserId);
    expect(unread).toBe(1);

    // Outbox row is committed and links to the notification.
    const outboxRows = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.notificationId, result.notification.id));
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]!.type).toBe("grade_notification");
    expect(outboxRows[0]!.recipientEmail).toBe("cand@example.com");
    expect(outboxRows[0]!.recipientUserId).toBe(recipientUserId);
    expect(outboxRows[0]!.dedupeKey).toBe(
      `result_published:${examId}:${recipientUserId}`,
    );
    // The Email body contains the absolute link with PUBLIC_WEB_ORIGIN.
    expect(outboxRows[0]!.bodyText).toContain(PUBLIC_WEB_ORIGIN);
    expect(outboxRows[0]!.bodyText).toContain(`/exam/${attemptId}/result`);
  });

  it("creates Inbox-only (no outbox row) when recipient has no email", async () => {
    const ctx = createContext(orgId);
    const recipientUserId = await createTestUser(orgId);
    const attemptId = randomUUID();
    const examId = randomUUID();

    const result = await executeInTransaction(db, async (tx) => {
      return dispatchResultPublishedToRecipient(
        {
          db: tx,
          ctx,
          examTitle: "No Email Exam",
          examId,
          recipients: [],
          publicWebOrigin: PUBLIC_WEB_ORIGIN,
          emailMaxAttempts: EMAIL_MAX_ATTEMPTS,
          now: NOW,
        },
        { userId: recipientUserId, email: null, attemptId },
      );
    });

    expect(result.inboxCreated).toBe(true);
    expect(result.outboxCreated).toBe(false);

    // No outbox row links to this notification.
    const outboxRows = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.notificationId, result.notification.id));
    expect(outboxRows).toHaveLength(0);
  });

  it("is idempotent on a duplicate publication trigger (no new rows)", async () => {
    const ctx = createContext(orgId);
    const recipientUserId = await createTestUser(orgId);
    const attemptId = randomUUID();
    const examId = randomUUID();

    const baseOpts = {
      ctx,
      examTitle: "Idempotent Exam",
      examId,
      recipients: [] as never[],
      publicWebOrigin: PUBLIC_WEB_ORIGIN,
      emailMaxAttempts: EMAIL_MAX_ATTEMPTS,
      now: NOW,
    };

    // First dispatch.
    await executeInTransaction(db, async (tx) => {
      return dispatchResultPublishedToRecipient(
        { ...baseOpts, db: tx },
        {
          userId: recipientUserId,
          email: "cand@example.com",
          attemptId,
        },
      );
    });
    // Second dispatch with the SAME dedupe key.
    const second = await executeInTransaction(db, async (tx) => {
      return dispatchResultPublishedToRecipient(
        { ...baseOpts, db: tx },
        { userId: recipientUserId, email: "cand@example.com", attemptId },
      );
    });
    expect(second.inboxCreated).toBe(false);
    expect(second.outboxCreated).toBe(false);

    // Exactly one Inbox row and one outbox row for this recipient.
    const notifRepo = createNotificationRepo(db);
    const { items } = await notifRepo.list(ctx, recipientUserId, {
      page: 1,
      pageSize: 100,
    });
    const own = items.filter(
      (i) => i.dedupeKey === `result_published:${examId}`,
    );
    expect(own).toHaveLength(1);
    const outboxRows = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.recipientUserId, recipientUserId));
    const ownOutbox = outboxRows.filter(
      (r) => r.dedupeKey === `result_published:${examId}:${recipientUserId}`,
    );
    expect(ownOutbox).toHaveLength(1);
  });

  it("rolls back the publication when the outbox insert fails (required write)", async () => {
    // Simulate a required outbox failure by inserting a pre-existing row with
    // the SAME dedupe key before the dispatch — the unique constraint violation
    // must propagate and roll back the whole tx (Inbox row included).
    const ctx = createContext(orgId);
    const recipientUserId = await createTestUser(orgId);
    const attemptId = randomUUID();
    const examId = randomUUID();
    const dedupeKey = `result_published:${examId}:${recipientUserId}`;

    // Pre-seed an outbox row with the same dedupe key to force a conflict.
    await createEmailOutboxRepo(db).create(ctx, {
      type: "grade_notification",
      recipientEmail: "cand@example.com",
      subject: "pre-existing",
      bodyText: "pre-existing",
      bodyHtml: null,
      maxAttempts: EMAIL_MAX_ATTEMPTS,
      dedupeKey,
    });

    // The dispatch must throw (23505 unique_violation), and because we wrap it
    // in executeInTransaction, the Inbox row it tried to insert must be rolled
    // back — proving the atomicity invariant.
    await expect(
      executeInTransaction(db, async (tx) => {
        return dispatchResultPublishedToRecipient(
          {
            db: tx,
            ctx,
            examTitle: "Rollback Exam",
            examId,
            recipients: [],
            publicWebOrigin: PUBLIC_WEB_ORIGIN,
            emailMaxAttempts: EMAIL_MAX_ATTEMPTS,
            now: NOW,
          },
          { userId: recipientUserId, email: "cand@example.com", attemptId },
        );
      }),
    ).rejects.toThrow();

    // No Inbox row for this recipient/exam survived.
    const notifRepo = createNotificationRepo(db);
    const { items } = await notifRepo.list(ctx, recipientUserId, {
      page: 1,
      pageSize: 100,
    });
    const own = items.filter(
      (i) => i.dedupeKey === `result_published:${examId}`,
    );
    expect(own).toHaveLength(0);
  });
});

describe("dispatchResultPublishedFanOut", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let orgId: string;
  let fanOutUserCounter: number;

  async function createFanOutUser(organizationId: string): Promise<string> {
    const userRepo = createUserRepo(db);
    const ctx: RequestContext = {
      actorId: "system",
      organizationId,
      role: "Admin",
      permissions: [],
      sessionId: "s",
    };
    const user = await userRepo.create(ctx, {
      username: `fanout-${fanOutUserCounter++}-${randomUUID().slice(0, 6)}`,
      passwordHash: "x",
      name: `FanOut User ${fanOutUserCounter}`,
      role: "Candidate",
      isActive: true,
    });
    return user.id;
  }

  beforeAll(async () => {
    const env = await getIsolatedTestDb("api-notificationService-fanout");
    db = env.db;
    cleanup = env.cleanup;
    fanOutUserCounter = 0;
    const org = await createOrganizationRepo(db).create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions: [],
        sessionId: "s",
      },
      {
        name: "FanOut Org",
        displayName: "FanOut Org",
        slug: `fanout-${randomUUID().slice(0, 8)}`,
      },
    );
    orgId = org.id;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("fans out to multiple recipients in one transaction and reports counts", async () => {
    const ctx = createContext(orgId);
    const examId = randomUUID();
    const recipients = [
      {
        userId: await createFanOutUser(orgId),
        email: "a@example.com",
        attemptId: randomUUID(),
      },
      {
        userId: await createFanOutUser(orgId),
        email: null,
        attemptId: randomUUID(),
      },
      {
        userId: await createFanOutUser(orgId),
        email: "c@example.com",
        attemptId: randomUUID(),
      },
    ];

    const summary = await executeInTransaction(db, async (tx) => {
      return dispatchResultPublishedFanOut({
        db: tx,
        ctx,
        examTitle: "FanOut Exam",
        examId,
        recipients,
        publicWebOrigin: PUBLIC_WEB_ORIGIN,
        emailMaxAttempts: EMAIL_MAX_ATTEMPTS,
        now: NOW,
      });
    });

    expect(summary.recipientsProcessed).toBe(3);
    expect(summary.inboxRowsCreated).toBe(3);
    expect(summary.outboxRowsCreated).toBe(2); // only the two with email
  });

  it("handles an empty recipient set (no recipients processed)", async () => {
    const ctx = createContext(orgId);
    const summary = await executeInTransaction(db, async (tx) => {
      return dispatchResultPublishedFanOut({
        db: tx,
        ctx,
        examTitle: "Empty Exam",
        examId: randomUUID(),
        recipients: [],
        publicWebOrigin: PUBLIC_WEB_ORIGIN,
        emailMaxAttempts: EMAIL_MAX_ATTEMPTS,
        now: NOW,
      });
    });
    expect(summary.recipientsProcessed).toBe(0);
    expect(summary.inboxRowsCreated).toBe(0);
    expect(summary.outboxRowsCreated).toBe(0);
  });
});

describe("dispatchExamAssigned (transaction integration, #299)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let orgId: string;
  let userCounter: number;

  async function createTestUser(organizationId: string): Promise<string> {
    const userRepo = createUserRepo(db);
    const ctx: RequestContext = {
      actorId: "system",
      organizationId,
      role: "Admin",
      permissions: [],
      sessionId: "s",
    };
    const user = await userRepo.create(ctx, {
      username: `assigned-${userCounter++}-${randomUUID().slice(0, 6)}`,
      passwordHash: "x",
      name: `Assigned User ${userCounter}`,
      role: "Candidate",
      isActive: true,
    });
    return user.id;
  }

  beforeAll(async () => {
    const env = await getIsolatedTestDb("api-notificationService-assigned");
    db = env.db;
    cleanup = env.cleanup;
    userCounter = 0;
    const org = await createOrganizationRepo(db).create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions: [],
        sessionId: "s",
      },
      {
        name: "Assigned Org",
        displayName: "Assigned Org",
        slug: `assigned-${randomUUID().slice(0, 8)}`,
      },
    );
    orgId = org.id;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("creates an Inbox row and an exam_notification outbox row atomically (email exists)", async () => {
    const ctx = createContext(orgId);
    const recipientUserId = await createTestUser(orgId);
    const examId = randomUUID();

    const result = await executeInTransaction(db, async (tx) => {
      return dispatchExamAssigned({
        db: tx,
        ctx,
        examId,
        examTitle: "Assigned Exam",
        recipientUserId,
        recipientEmail: "cand@example.com",
        publicWebOrigin: PUBLIC_WEB_ORIGIN,
        emailMaxAttempts: EMAIL_MAX_ATTEMPTS,
        now: NOW,
      });
    });

    expect(result.inboxCreated).toBe(true);
    expect(result.outboxCreated).toBe(true);
    expect(result.notification.recipientUserId).toBe(recipientUserId);
    expect(result.notification.type).toBe("exam_assigned");
    // The action path is the candidate exam list — the existing authorized
    // surface — and passes the contract validator.
    expect(result.notification.actionPath).toBe("/exam/list");
    expect(result.notification.dedupeKey).toBe(`exam_assigned:${examId}`);

    // Inbox row is committed.
    const notifRepo = createNotificationRepo(db);
    const unread = await notifRepo.countUnread(ctx, recipientUserId);
    expect(unread).toBe(1);

    // Outbox row is committed, links to the notification, and carries the
    // absolute exam-list link.
    const outboxRows = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.notificationId, result.notification.id));
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]!.type).toBe("exam_notification");
    expect(outboxRows[0]!.recipientEmail).toBe("cand@example.com");
    expect(outboxRows[0]!.recipientUserId).toBe(recipientUserId);
    expect(outboxRows[0]!.dedupeKey).toBe(
      `exam_assigned:${examId}:${recipientUserId}`,
    );
    expect(outboxRows[0]!.subject).toBe("考试已安排");
    expect(outboxRows[0]!.bodyText).toContain("Assigned Exam");
    expect(outboxRows[0]!.bodyText).toContain(`${PUBLIC_WEB_ORIGIN}/exam/list`);
  });

  it("creates Inbox-only (no outbox row) when the candidate user has no email", async () => {
    const ctx = createContext(orgId);
    const recipientUserId = await createTestUser(orgId);
    const examId = randomUUID();

    const result = await executeInTransaction(db, async (tx) => {
      return dispatchExamAssigned({
        db: tx,
        ctx,
        examId,
        examTitle: "No Email Assignment",
        recipientUserId,
        recipientEmail: null,
        publicWebOrigin: PUBLIC_WEB_ORIGIN,
        emailMaxAttempts: EMAIL_MAX_ATTEMPTS,
        now: NOW,
      });
    });

    expect(result.inboxCreated).toBe(true);
    expect(result.outboxCreated).toBe(false);
    const outboxRows = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.notificationId, result.notification.id));
    expect(outboxRows).toHaveLength(0);
  });

  it("is idempotent on a duplicate assignment trigger (no new rows)", async () => {
    const ctx = createContext(orgId);
    const recipientUserId = await createTestUser(orgId);
    const examId = randomUUID();
    const base = {
      db: db as Database,
      ctx,
      examId,
      examTitle: "Duplicate Assignment",
      recipientUserId,
      recipientEmail: "cand@example.com",
      publicWebOrigin: PUBLIC_WEB_ORIGIN,
      emailMaxAttempts: EMAIL_MAX_ATTEMPTS,
      now: NOW,
    };

    const first = await executeInTransaction(db, (tx) =>
      dispatchExamAssigned({ ...base, db: tx }),
    );
    expect(first.inboxCreated).toBe(true);
    expect(first.outboxCreated).toBe(true);

    // Retry of the same assignment episode: dedupe keys make this a no-op.
    const second = await executeInTransaction(db, (tx) =>
      dispatchExamAssigned({ ...base, db: tx }),
    );
    expect(second.inboxCreated).toBe(false);
    expect(second.outboxCreated).toBe(false);

    const notifRepo = createNotificationRepo(db);
    const { items } = await notifRepo.list(ctx, recipientUserId, {
      page: 1,
      pageSize: 100,
    });
    const own = items.filter((i) => i.dedupeKey === `exam_assigned:${examId}`);
    expect(own).toHaveLength(1);
  });

  it("rolls back the Inbox row when the required outbox insert fails", async () => {
    const ctx = createContext(orgId);
    const recipientUserId = await createTestUser(orgId);
    const examId = randomUUID();
    const dedupeKey = `exam_assigned:${examId}:${recipientUserId}`;

    // Pre-seed an outbox row with the same dedupe key to force a unique
    // violation on the required outbox insert — it must propagate and roll
    // back the whole transaction (Inbox row included).
    await createEmailOutboxRepo(db).create(ctx, {
      type: "exam_notification",
      recipientEmail: "cand@example.com",
      subject: "pre-existing",
      bodyText: "pre-existing",
      bodyHtml: null,
      maxAttempts: EMAIL_MAX_ATTEMPTS,
      dedupeKey,
    });

    await expect(
      executeInTransaction(db, async (tx) =>
        dispatchExamAssigned({
          db: tx,
          ctx,
          examId,
          examTitle: "Rollback Assignment",
          recipientUserId,
          recipientEmail: "cand@example.com",
          publicWebOrigin: PUBLIC_WEB_ORIGIN,
          emailMaxAttempts: EMAIL_MAX_ATTEMPTS,
          now: NOW,
        }),
      ),
    ).rejects.toThrow();

    // No Inbox row for this recipient/exam survived.
    const notifRepo = createNotificationRepo(db);
    const { items } = await notifRepo.list(ctx, recipientUserId, {
      page: 1,
      pageSize: 100,
    });
    const own = items.filter((i) => i.dedupeKey === `exam_assigned:${examId}`);
    expect(own).toHaveLength(0);
  });
});
