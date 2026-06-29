import { randomUUID } from "node:crypto";
import type { EmailOutboxRow, RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import { createEmailOutboxRepo } from "@exam/db/src/repository/emailOutboxRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import type { RequestContext as RC } from "@exam/domain";
import { EmailNotificationService } from "./notificationService.js";

const permissions: RequestContext["permissions"] = [];

function createContext(organizationId: string): RC {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions,
    sessionId: randomUUID(),
  };
}

describe("EmailNotificationService", () => {
  let cleanup: () => Promise<void>;
  let ctx: RequestContext;
  let realRepo: ReturnType<typeof createEmailOutboxRepo>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("api-email-notify");
    cleanup = result.cleanup;
    const organizationRepo = createOrganizationRepo(result.db);
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
    realRepo = createEmailOutboxRepo(result.db);
  });

  afterAll(async () => {
    await cleanup();
  });

  it("enqueueEmail inserts a pending outbox row with the given recipient", async () => {
    const svc = new EmailNotificationService({
      repo: realRepo,
      defaultMaxAttempts: 3,
    });
    const row = await svc.enqueueEmail({
      ctx,
      type: "test_email",
      recipientEmail: "to@example.com",
      subject: "Hello",
      bodyText: "Body",
    });
    expect(row).toMatchObject({
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      recipientEmail: "to@example.com",
      type: "test_email",
    });
  });

  it("enqueueTestEmail enqueues a test_email row", async () => {
    const svc = new EmailNotificationService({
      repo: realRepo,
      defaultMaxAttempts: 3,
    });
    const row = await svc.enqueueTestEmail(ctx, "tester@example.com");
    expect(row.type).toBe("test_email");
    expect(row.recipientEmail).toBe("tester@example.com");
    expect(row.status).toBe("pending");
  });

  it("enqueueBestEffort resolves to null when the repo throws (does not propagate)", async () => {
    const failingRepo = {
      create: vi.fn().mockRejectedValue(new Error("DB down")),
    } as unknown as ReturnType<typeof createEmailOutboxRepo>;
    const svc = new EmailNotificationService({
      repo: failingRepo,
      defaultMaxAttempts: 3,
    });
    const row = await svc.enqueueBestEffort({
      ctx,
      type: "test_email",
      recipientEmail: "x@example.com",
      subject: "s",
      bodyText: "t",
    });
    expect(row).toBeNull();
    expect(failingRepo.create).toHaveBeenCalledOnce();
  });

  it("BUSINESS SAFETY: a committed business row persists even when email enqueue fails", async () => {
    // This is the M3 business-transaction non-rollback invariant (Option C).
    // We use a real audit-log repo to write a real business row, then call the
    // notification service backed by a FAILING repo (best-effort). The audit
    // row must still exist — email failure must never roll back committed work.
    const result = await getIsolatedTestDb("api-email-safety");
    try {
      const db = result.db;
      const organizationRepo = createOrganizationRepo(db);
      const auditRepo = createAuditLogRepo(db);
      const org = await organizationRepo.create(
        {
          actorId: "system",
          organizationId: "system",
          role: "Admin",
          permissions,
          sessionId: "s",
        },
        {
          name: "safety-org",
          displayName: "Safety",
          slug: `safety-${randomUUID().slice(0, 8)}`,
        },
      );
      const bizCtx = createContext(org.id);

      // 1. Commit a real business row (audit log).
      const auditRow = await auditRepo.create(bizCtx, {
        actorId: bizCtx.actorId,
        action: "test.email.safety",
        targetType: "email",
        targetId: "n/a",
        metadata: { ok: true },
      });
      const writtenId = auditRow.id;

      // 2. Email enqueue fails (failing repo) — but the caller uses the
      //    best-effort surface, so the failure is swallowed (logged).
      const failingRepo = {
        create: vi.fn().mockRejectedValue(new Error("outbox insert failed")),
      } as unknown as ReturnType<typeof createEmailOutboxRepo>;
      const svc = new EmailNotificationService({
        repo: failingRepo,
        defaultMaxAttempts: 3,
      });
      const enqueued = await svc.enqueueBestEffort({
        ctx: bizCtx,
        type: "admin_created_user",
        recipientEmail: "newuser@example.com",
        subject: "Account created",
        bodyText: "Welcome",
      });

      // 3. The business row is still there.
      expect(enqueued).toBeNull();
      const stillThere = await auditRepo.findById(bizCtx, writtenId);
      expect(stillThere?.id).toBe(writtenId);
      expect(stillThere?.action).toBe("test.email.safety");
    } finally {
      await result.cleanup();
    }
  });
});
