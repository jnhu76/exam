import type { EmailOutboxRow, EmailType, RequestContext } from "@exam/domain";
import type { EmailOutboxRepo } from "@exam/db/src/repository/emailOutboxRepo.js";

/** Input for enqueuing a generic outbox email. */
export interface EnqueueEmailInput {
  ctx: RequestContext;
  type: EmailType;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
}

/**
 * The notification service business routes use to enqueue emails (M3).
 *
 * It ONLY writes to the outbox — it never sends SMTP. A separate worker
 * (`EmailOutboxService.processDueEmails`) drains the outbox asynchronously.
 * This keeps email out of the request path and guarantees email failure can
 * never roll back a business transaction.
 *
 * Two surfaces:
 *  - {@link enqueueEmail} / {@link enqueueTestEmail}: throw on outbox write
 *    failure (use when the caller wants to know).
 *  - {@link enqueueBestEffort}: swallows outbox-write failures and returns
 *    `null` (use from business flows where email must never break the main
 *    transaction — the recommended pattern).
 */
export class EmailNotificationService {
  constructor(
    private readonly deps: {
      repo: Pick<EmailOutboxRepo, "create">;
      defaultMaxAttempts: number;
      /** Optional pino-style logger for best-effort failure warnings. */
      logger?: { warn(obj: Record<string, unknown>, msg: string): void };
      /** Optional audit emitter for P3-M4A email outbox events. */
      auditEmitter?: (event: {
        action: string;
        targetType: string;
        targetId: string;
        metadata: Record<string, unknown>;
      }) => void;
    },
  ) {}

  /**
   * Enqueue an email row. Throws if the outbox write fails. Callers that must
   * not fail on email problems should use {@link enqueueBestEffort} instead.
   */
  async enqueueEmail(input: EnqueueEmailInput): Promise<EmailOutboxRow> {
    const row = await this.deps.repo.create(input.ctx, {
      type: input.type,
      recipientEmail: input.recipientEmail,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml ?? null,
      maxAttempts: this.deps.defaultMaxAttempts,
    });
    this.deps.auditEmitter?.({
      action: "email.outbox_created",
      targetType: "email_outbox",
      targetId: row.id,
      metadata: {
        type: input.type,
        recipientEmail: input.recipientEmail,
        subject: input.subject,
      },
    });
    return row;
  }

  /**
   * Best-effort enqueue: on outbox-write failure, logs (via the optional
   * logger) and returns `null` instead of throwing. This is the surface
   * business routes should use so an email problem never rolls back the main
   * transaction.
   */
  async enqueueBestEffort(
    input: EnqueueEmailInput,
  ): Promise<EmailOutboxRow | null> {
    try {
      return await this.enqueueEmail(input);
    } catch (err) {
      this.deps.logger?.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "email enqueue failed (best-effort)",
      );
      return null;
    }
  }

  /** Convenience: enqueue a `test_email` row to the given recipient. */
  async enqueueTestEmail(
    ctx: RequestContext,
    to: string,
  ): Promise<EmailOutboxRow> {
    return this.enqueueEmail({
      ctx,
      type: "test_email",
      recipientEmail: to,
      subject: "Test email",
      bodyText: "This is a test email from the exam platform.",
    });
  }
}
