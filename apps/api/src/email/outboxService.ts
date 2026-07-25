import type { EmailSender, EmailSendResult } from "@exam/domain";
import type { EmailRepoContext, EmailOutboxRepo } from "@exam/db";
import { computeNextRetryAt } from "./retryPolicy.js";
import { sanitizeEmailError } from "./sanitizeError.js";

/** Per-tick result of {@link EmailOutboxService.processDueEmails}. */
export interface ProcessResult {
  /** Total due rows claimed this tick. */
  processed: number;
  /** Rows moved to terminal `sent`. */
  sent: number;
  /** Rows moved to `retry_wait` (attempts remaining). */
  retryWait: number;
  /** Rows moved to terminal `dead` (maxAttempts reached). */
  dead: number;
  /** Rows whose ownership was lost before finalize (stale-worker ack suppressed). */
  ownershipLost: number;
}

/**
 * The email outbox worker service (P5-0).
 *
 * Claims due rows from PostgreSQL using `FOR UPDATE SKIP LOCKED` and drives
 * each through a sender. The claim is atomic: selected rows are immediately
 * set to `processing` with lock ownership.
 *
 * After the send attempt (outside the claim transaction):
 *   success                      -> markSent (with providerMessageId)
 *   failure && attempts < max    -> markRetryWait (exponential backoff)
 *   failure && attempts >= max   -> markDead (terminal)
 *
 * Contract guarantees:
 *  - One email's failure NEVER blocks another (each is processed in its own
 *    try/catch).
 *  - The worker never affects the originating business transaction (it only
 *    touches `email_outbox` rows, long after the business commit).
 *  - Time is injected (`now`), so retry arithmetic is deterministic and
 *    testable — no raw wall-clock reads.
 *  - SMTP is never called inside the claim transaction.
 */
export class EmailOutboxService {
  constructor(
    private readonly deps: {
      repo: EmailOutboxRepo;
      ctx: EmailRepoContext;
      sender: EmailSender;
      retryBaseSeconds: number;
      /** Literal secrets to scrub from persisted `lastError` (e.g. SMTP password). */
      scrubSecrets?: string[];
      /** Optional audit emitter for email outbox events. */
      auditEmitter?: (event: {
        action: string;
        targetType: string;
        targetId: string;
        metadata: Record<string, unknown>;
      }) => void;
    },
  ) {}

  /**
   * Process up to `limit` due emails as of `now`. Returns counts.
   * Never throws for a single email's send failure.
   */
  async processDueEmails(opts: {
    now: Date;
    limit: number;
    workerInstanceId: string;
  }): Promise<ProcessResult> {
    const { repo, ctx, sender } = this.deps;
    const result: ProcessResult = {
      processed: 0,
      sent: 0,
      retryWait: 0,
      dead: 0,
      ownershipLost: 0,
    };

    // Claim due rows atomically (one READ COMMITTED transaction)
    const claimed = await repo.claimDue(
      ctx,
      opts.now,
      opts.workerInstanceId,
      opts.limit,
    );
    result.processed = claimed.length;

    // Process each claimed row — send outside the transaction
    for (const row of claimed) {
      try {
        const sendResult: EmailSendResult = await sender.send({
          to: row.recipientEmail,
          subject: row.subject,
          text: row.bodyText,
          ...(row.bodyHtml ? { html: row.bodyHtml } : {}),
        });
        // Mark sent (ownership-fenced: only if still locked by us)
        const sent = await repo.markSent(
          ctx,
          row.id,
          opts.now,
          sendResult.providerMessageId,
          opts.workerInstanceId,
        );
        if (sent) {
          result.sent += 1;
        } else {
          // Ownership was lost (another worker recovered + re-claimed this row).
          // Do NOT count as success — the row will be retried by the new owner.
          result.ownershipLost += 1;
        }
      } catch (err) {
        // attemptCount is already incremented by the claim SQL
        const currentAttemptCount = row.attemptCount;
        const lastError = sanitizeEmailError(err, this.deps.scrubSecrets ?? []);
        if (currentAttemptCount >= row.maxAttempts) {
          const dead = await repo.markDead(
            ctx,
            row.id,
            currentAttemptCount,
            lastError,
            opts.workerInstanceId,
          );
          if (dead) {
            result.dead += 1;
            this.deps.auditEmitter?.({
              action: "email.send_failed",
              targetType: "email_outbox",
              targetId: row.id,
              metadata: {
                outboxId: row.id,
                attempts: currentAttemptCount,
                lastError,
              },
            });
          } else {
            result.ownershipLost += 1;
          }
        } else {
          const nextAttemptAt = computeNextRetryAt(
            opts.now,
            currentAttemptCount,
            this.deps.retryBaseSeconds,
          );
          const retried = await repo.markRetryWait(
            ctx,
            row.id,
            currentAttemptCount,
            lastError,
            nextAttemptAt,
            opts.workerInstanceId,
          );
          if (retried) {
            result.retryWait += 1;
            this.deps.auditEmitter?.({
              action: "email.send_retried",
              targetType: "email_outbox",
              targetId: row.id,
              metadata: {
                outboxId: row.id,
                attempts: currentAttemptCount,
                nextAttemptAt: nextAttemptAt.toISOString(),
              },
            });
          } else {
            result.ownershipLost += 1;
          }
        }
      }
    }

    return result;
  }
}
