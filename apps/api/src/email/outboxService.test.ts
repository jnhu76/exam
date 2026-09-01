import { randomUUID } from "node:crypto";
import type {
  EmailSender,
  EmailOutboxStatus,
  OrganizationScope,
  RequestContext,
} from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import { createEmailOutboxRepo } from "@exam/db/src/repository/emailOutboxRepo.js";
import { emailOutbox } from "@exam/db/src/schema/pg.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import type { Database } from "@exam/db/src/types.js";
import { FakeEmailSender } from "./senders.js";
import { EmailOutboxService } from "./outboxService.js";
import { sanitizeEmailError } from "./sanitizeError.js";

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

/** Inserts an outbox row with arbitrary pre-state for transition tests. */
async function seedRow(
  db: Database,
  orgId: string,
  overrides: Partial<{
    attemptCount: number;
    maxAttempts: number;
    nextAttemptAt: Date | null;
    status: EmailOutboxStatus;
    recipientEmail: string;
  }> = {},
) {
  const ts = new Date();
  const [row] = await db
    .insert(emailOutbox)
    .values({
      id: randomUUID(),
      organizationId: orgId,
      type: "test_email",
      recipientEmail: overrides.recipientEmail ?? "to@example.com",
      subject: "s",
      bodyText: "t",
      bodyHtml: null,
      status: overrides.status ?? "pending",
      attemptCount: overrides.attemptCount ?? 0,
      maxAttempts: overrides.maxAttempts ?? 3,
      lastError: null,
      nextAttemptAt: overrides.nextAttemptAt ?? null,
      lockedAt: null,
      lockedBy: null,
      providerMessageId: null,
      dedupeKey: null,
      sentAt: null,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning();
  return row!;
}

describe("EmailOutboxService.processDueEmails", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let ctx: RequestContext;
  let orgScope: OrganizationScope;
  let repo: ReturnType<typeof createEmailOutboxRepo>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("api-email-outbox");
    db = result.db;
    cleanup = result.cleanup;
    const organizationRepo = createOrganizationRepo(db);
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
    repo = createEmailOutboxRepo(db);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("pending -> sent on success (sentAt = now, providerMessageId from sender)", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const row = await seedRow(db, ctx.organizationId, { nextAttemptAt: null });
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: new FakeEmailSender("success"),
      retryBaseSeconds: 60,
    });
    const result = await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "test-worker-1",
    });
    expect(result.processed).toBe(1);
    expect(result.sent).toBe(1);
    const updated = await repo.findById(ctx, row.id);
    expect(updated).toMatchObject({
      status: "sent",
      nextAttemptAt: null,
    });
    // sentAt is returned as a Date by the repo; compare instant, not string.
    expect(updated?.sentAt?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("pending -> retry_wait on failure (attemptCount+1, lastError, nextAttemptAt)", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const row = await seedRow(db, ctx.organizationId, {
      attemptCount: 0,
      maxAttempts: 3,
      nextAttemptAt: null,
    });
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: new FakeEmailSender("failure"),
      retryBaseSeconds: 60,
    });
    const result = await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "test-worker-2",
    });
    expect(result.dead).toBe(0);
    expect(result.retryWait).toBe(1);
    const updated = await repo.findById(ctx, row.id);
    expect(updated).toMatchObject({
      status: "retry_wait",
      attemptCount: 1,
    });
    // 60 * 2**(1-1) = 60s
    expect(updated?.nextAttemptAt?.toISOString()).toBe(
      "2026-06-01T00:01:00.000Z",
    );
    expect(updated?.lastError).toContain("Fake email sender failure");
  });

  it("pending -> dead after reaching maxAttempts (nextAttemptAt null)", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    // Already failed twice; one more failure hits maxAttempts=3 -> dead.
    const row = await seedRow(db, ctx.organizationId, {
      attemptCount: 2,
      maxAttempts: 3,
      nextAttemptAt: null,
    });
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: new FakeEmailSender("failure"),
      retryBaseSeconds: 60,
    });
    const result = await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "test-worker-3",
    });
    expect(result.dead).toBe(1);
    const updated = await repo.findById(ctx, row.id);
    expect(updated).toMatchObject({
      status: "dead",
      attemptCount: 3,
      nextAttemptAt: null,
    });
    expect(updated?.lastError).toBeTruthy();
  });

  it("one failing email does not block another pending email", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const failRow = await seedRow(db, ctx.organizationId, {
      recipientEmail: "fail@example.com",
    });
    const okRow = await seedRow(db, ctx.organizationId, {
      recipientEmail: "ok@example.com",
    });
    // A sender that fails for one recipient and succeeds for another.
    const selectiveSender: EmailSender = {
      async send(message) {
        if (message.to === "fail@example.com") {
          throw new Error("Fake email sender failure");
        }
        return { providerMessageId: null };
      },
    };
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: selectiveSender,
      retryBaseSeconds: 60,
    });
    const result = await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "test-worker-4",
    });
    expect(result.processed).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.retryWait).toBe(1);
    const ok = await repo.findById(ctx, okRow.id);
    const fail = await repo.findById(ctx, failRow.id);
    expect(ok?.status).toBe("sent");
    expect(fail?.status).toBe("retry_wait");
    expect(fail?.attemptCount).toBe(1);
  });

  it("disabled sender is a safe no-op for the worker (nothing sent, nothing errored)", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const row = await seedRow(db, ctx.organizationId, { nextAttemptAt: null });
    // DisabledEmailSender is a no-op sender that resolves; from the worker's
    // perspective the send "succeeded" (no throw), so the row goes to sent.
    const disabled: EmailSender = {
      async send() {
        return { providerMessageId: null };
      },
    };
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: disabled,
      retryBaseSeconds: 60,
    });
    const result = await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "test-worker-5",
    });
    expect(result.sent).toBe(1);
    expect(await repo.findById(ctx, row.id)).toMatchObject({ status: "sent" });
  });

  it("uses the injected clock for retry time (deterministic)", async () => {
    const now = new Date("2026-12-31T23:59:00Z");
    const row = await seedRow(db, ctx.organizationId, { nextAttemptAt: null });
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: new FakeEmailSender("failure"),
      retryBaseSeconds: 60,
    });
    await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "test-worker-6",
    });
    const updated = await repo.findById(ctx, row.id);
    // now + 60s
    expect(updated?.nextAttemptAt?.toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("sanitizes a non-Fake sender error into lastError", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const SECRET = "worker-secret-pw";
    const row = await seedRow(db, ctx.organizationId);
    const leakingSender: EmailSender = {
      async send() {
        throw Object.assign(new Error(`auth failed ${SECRET}`), {
          code: "EAUTH",
          responseCode: 535,
        });
      },
    };
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: leakingSender,
      retryBaseSeconds: 60,
      scrubSecrets: [SECRET],
    });
    await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "test-worker-7",
    });
    const updated = await repo.findById(ctx, row.id);
    expect(updated?.lastError).not.toContain(SECRET);
    expect(updated?.lastError).toContain("EAUTH");
    // sanity: the sanitizer agrees
    expect(
      sanitizeEmailError(
        Object.assign(new Error(`auth failed ${SECRET}`), { code: "EAUTH" }),
        [SECRET],
      ),
    ).not.toContain(SECRET);
  });

  it("emits email.send_failed audit event when max attempts reached", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const auditEmitter = vi.fn();
    const row = await seedRow(db, ctx.organizationId, {
      attemptCount: 2,
      maxAttempts: 3,
    });
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: new FakeEmailSender("failure"),
      retryBaseSeconds: 60,
      auditEmitter,
    });
    await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "test-worker-8",
    });
    expect(auditEmitter).toHaveBeenCalledOnce();
    expect(auditEmitter).toHaveBeenCalledWith({
      action: "email.send_failed",
      targetType: "email_outbox",
      targetId: row.id,
      metadata: {
        outboxId: row.id,
        attempts: 3,
        lastError: expect.any(String),
      },
    });
  });

  it("emits email.send_retried audit event when retry scheduled", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const auditEmitter = vi.fn();
    const row = await seedRow(db, ctx.organizationId, {
      attemptCount: 0,
      maxAttempts: 3,
    });
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: new FakeEmailSender("failure"),
      retryBaseSeconds: 60,
      auditEmitter,
    });
    await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "test-worker-9",
    });
    expect(auditEmitter).toHaveBeenCalledOnce();
    expect(auditEmitter).toHaveBeenCalledWith({
      action: "email.send_retried",
      targetType: "email_outbox",
      targetId: row.id,
      metadata: {
        outboxId: row.id,
        attempts: 1,
        nextAttemptAt: "2026-06-01T00:01:00.000Z",
      },
    });
  });

  it("audit metadata does not contain email body content", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const auditEmitter = vi.fn();
    const row = await seedRow(db, ctx.organizationId, {
      recipientEmail: "secret@example.com",
    });
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: new FakeEmailSender("failure"),
      retryBaseSeconds: 60,
      auditEmitter,
    });
    await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "test-worker-10",
    });
    const call = auditEmitter.mock.calls[0]![0] as {
      metadata: Record<string, unknown>;
    };
    expect(JSON.stringify(call.metadata)).not.toContain("secret@example.com");
    expect(call.metadata).not.toHaveProperty("bodyText");
    expect(call.metadata).not.toHaveProperty("bodyHtml");
  });

  it("accepts OrganizationScope context (not just RequestContext)", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const row = await seedRow(db, ctx.organizationId, { nextAttemptAt: null });
    const service = new EmailOutboxService({
      repo,
      ctx: orgScope,
      sender: new FakeEmailSender("success"),
      retryBaseSeconds: 60,
    });
    const result = await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "test-worker-11",
    });
    expect(result.sent).toBe(1);
    expect(await repo.findById(ctx, row.id)).toMatchObject({ status: "sent" });
  });
});
