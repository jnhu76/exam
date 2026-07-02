import type { EmailSender } from "@exam/domain";
import type { RequestContext } from "@exam/domain";
import type { EmailOutboxRepo } from "@exam/db";
import { computeNextRetryAt } from "./retryPolicy.js";
import { sanitizeEmailError } from "./sanitizeError.js";

/** Per-tick result of {@link EmailOutboxService.processDueEmails}. */
export interface ProcessResult {
  /** Total due rows picked up this tick. */
  processed: number;
  /** Rows moved to terminal `sent`. */
  sent: number;
  /** Rows kept `pending` with a scheduled retry. */
  retryScheduled: number;
  /** Rows moved to terminal `failed` (maxAttempts reached). */
  failed: number;
}

/**
 * The email outbox worker service (M3).
 *
 * Reads due `pending` rows from PostgreSQL and drives each through a sender:
 *
 *   success                            -> markSent
 *   failure && attempts < maxAttempts  -> markRetryScheduled (exponential backoff)
 *   failure && attempts == maxAttempts -> markFailed (terminal)
 *
 * Contract guarantees:
 *  - One email's failure NEVER blocks another (each is processed in its own
 *    try/catch).
 *  - The worker never affects the originating business transaction (it only
 *    touches `email_outbox` rows, long after the business commit).
 *  - Time is injected (`now`), so retry arithmetic is deterministic and
 *    testable — no raw wall-clock reads.
 *
 * This is a manually-triggered service (no background daemon in M3). A future
 * scanner plugin may call `processDueEmails` on an interval.
 */
export class EmailOutboxService {
  constructor(
    private readonly deps: {
      repo: EmailOutboxRepo;
      ctx: RequestContext;
      sender: EmailSender;
      retryBaseSeconds: number;
      /** Literal secrets to scrub from persisted `lastError` (e.g. SMTP password). */
      scrubSecrets?: string[];
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
   * Process up to `limit` due pending emails as of `now`. Returns counts.
   * Never throws for a single email's send failure.
   */
  async processDueEmails(opts: {
    now: Date;
    limit: number;
  }): Promise<ProcessResult> {
    const { repo, ctx, sender } = this.deps;
    const result: ProcessResult = {
      processed: 0,
      sent: 0,
      retryScheduled: 0,
      failed: 0,
    };

    const due = await repo.findDuePending(ctx, opts.now, opts.limit);
    result.processed = due.length;

    for (const row of due) {
      try {
        await sender.send({
          to: row.recipientEmail,
          subject: row.subject,
          text: row.bodyText,
          ...(row.bodyHtml ? { html: row.bodyHtml } : {}),
        });
        await repo.markSent(ctx, row.id, opts.now);
        result.sent += 1;
      } catch (err) {
        const nextAttempts = row.attempts + 1;
        const lastError = sanitizeEmailError(err, this.deps.scrubSecrets ?? []);
        if (nextAttempts >= row.maxAttempts) {
          await repo.markFailed(ctx, row.id, nextAttempts, lastError);
          result.failed += 1;
          this.deps.auditEmitter?.({
            action: "email.send_failed",
            targetType: "email_outbox",
            targetId: row.id,
            metadata: {
              outboxId: row.id,
              attempts: nextAttempts,
              lastError,
            },
          });
        } else {
          const nextRetryAt = computeNextRetryAt(
            opts.now,
            nextAttempts,
            this.deps.retryBaseSeconds,
          );
          await repo.markRetryScheduled(
            ctx,
            row.id,
            nextAttempts,
            lastError,
            nextRetryAt,
          );
          result.retryScheduled += 1;
          this.deps.auditEmitter?.({
            action: "email.send_retried",
            targetType: "email_outbox",
            targetId: row.id,
            metadata: {
              outboxId: row.id,
              attempts: nextAttempts,
              nextRetryAt: nextRetryAt.toISOString(),
            },
          });
        }
      }
    }

    return result;
  }
}
