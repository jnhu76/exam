import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import { createEmailOutboxRepo } from "@exam/db/src/repository/emailOutboxRepo.js";
import { emailOutbox } from "@exam/db/src/schema/pg.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import type { Database } from "@exam/db/src/types.js";
import type { EmailSender } from "@exam/domain";
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
    attempts: number;
    maxAttempts: number;
    nextRetryAt: Date | null;
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
      status: "pending",
      attempts: overrides.attempts ?? 0,
      maxAttempts: overrides.maxAttempts ?? 3,
      lastError: null,
      nextRetryAt: overrides.nextRetryAt ?? null,
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
    repo = createEmailOutboxRepo(db);
  });

  afterAll(async () => {
    await cleanup();
  });

  it("pending -> sent on success (sentAt = now)", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const row = await seedRow(db, ctx.organizationId, { nextRetryAt: null });
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: new FakeEmailSender("success"),
      retryBaseSeconds: 60,
    });
    const result = await service.processDueEmails({ now, limit: 10 });
    expect(result.processed).toBe(1);
    expect(result.sent).toBe(1);
    const updated = await repo.findById(ctx, row.id);
    expect(updated).toMatchObject({
      status: "sent",
      nextRetryAt: null,
    });
    // sentAt is returned as a Date by the repo; compare instant, not string.
    expect(updated?.sentAt?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("pending -> retry scheduled on failure (attempts+1, lastError, nextRetryAt)", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const row = await seedRow(db, ctx.organizationId, {
      attempts: 0,
      maxAttempts: 3,
      nextRetryAt: null,
    });
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: new FakeEmailSender("failure"),
      retryBaseSeconds: 60,
    });
    const result = await service.processDueEmails({ now, limit: 10 });
    expect(result.failed).toBe(0);
    expect(result.retryScheduled).toBe(1);
    const updated = await repo.findById(ctx, row.id);
    expect(updated).toMatchObject({
      status: "pending",
      attempts: 1,
    });
    // 60 * 2**(1-1) = 60s
    expect(updated?.nextRetryAt?.toISOString()).toBe(
      "2026-06-01T00:01:00.000Z",
    );
    expect(updated?.lastError).toContain("Fake email sender failure");
  });

  it("pending -> failed after reaching maxAttempts (nextRetryAt null)", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    // Already failed twice; one more failure hits maxAttempts=3 -> failed.
    const row = await seedRow(db, ctx.organizationId, {
      attempts: 2,
      maxAttempts: 3,
      nextRetryAt: null,
    });
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: new FakeEmailSender("failure"),
      retryBaseSeconds: 60,
    });
    const result = await service.processDueEmails({ now, limit: 10 });
    expect(result.failed).toBe(1);
    const updated = await repo.findById(ctx, row.id);
    expect(updated).toMatchObject({
      status: "failed",
      attempts: 3,
      nextRetryAt: null,
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
      },
    };
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: selectiveSender,
      retryBaseSeconds: 60,
    });
    const result = await service.processDueEmails({ now, limit: 10 });
    expect(result.processed).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.retryScheduled).toBe(1);
    const ok = await repo.findById(ctx, okRow.id);
    const fail = await repo.findById(ctx, failRow.id);
    expect(ok?.status).toBe("sent");
    expect(fail?.status).toBe("pending");
    expect(fail?.attempts).toBe(1);
  });

  it("disabled sender is a safe no-op for the worker (nothing sent, nothing errored)", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const row = await seedRow(db, ctx.organizationId, { nextRetryAt: null });
    // DisabledEmailSender is a no-op sender that resolves; from the worker's
    // perspective the send "succeeded" (no throw), so the row goes to sent.
    // This is intentional: a disabled deployment still drains its outbox to a
    // terminal state rather than leaving rows pending forever.
    const disabled: EmailSender = { async send() {} };
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: disabled,
      retryBaseSeconds: 60,
    });
    const result = await service.processDueEmails({ now, limit: 10 });
    expect(result.sent).toBe(1);
    expect(await repo.findById(ctx, row.id)).toMatchObject({ status: "sent" });
  });

  it("uses the injected clock for retry time (deterministic)", async () => {
    const now = new Date("2026-12-31T23:59:00Z");
    const row = await seedRow(db, ctx.organizationId, { nextRetryAt: null });
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: new FakeEmailSender("failure"),
      retryBaseSeconds: 60,
    });
    await service.processDueEmails({ now, limit: 10 });
    const updated = await repo.findById(ctx, row.id);
    // now + 60s
    expect(updated?.nextRetryAt?.toISOString()).toBe(
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
    await service.processDueEmails({ now, limit: 10 });
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
      attempts: 2,
      maxAttempts: 3,
    });
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: new FakeEmailSender("failure"),
      retryBaseSeconds: 60,
      auditEmitter,
    });
    await service.processDueEmails({ now, limit: 10 });
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
      attempts: 0,
      maxAttempts: 3,
    });
    const service = new EmailOutboxService({
      repo,
      ctx,
      sender: new FakeEmailSender("failure"),
      retryBaseSeconds: 60,
      auditEmitter,
    });
    await service.processDueEmails({ now, limit: 10 });
    expect(auditEmitter).toHaveBeenCalledOnce();
    expect(auditEmitter).toHaveBeenCalledWith({
      action: "email.send_retried",
      targetType: "email_outbox",
      targetId: row.id,
      metadata: {
        outboxId: row.id,
        attempts: 1,
        nextRetryAt: "2026-06-01T00:01:00.000Z",
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
    await service.processDueEmails({ now, limit: 10 });
    const call = auditEmitter.mock.calls[0]![0] as {
      metadata: Record<string, unknown>;
    };
    expect(JSON.stringify(call.metadata)).not.toContain("secret@example.com");
    expect(call.metadata).not.toHaveProperty("bodyText");
    expect(call.metadata).not.toHaveProperty("bodyHtml");
  });
});
