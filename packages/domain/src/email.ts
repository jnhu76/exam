/**
 * Email domain types (M3/P5-0 — Email Outbox + Delivery Runtime).
 *
 * This module is the single source of truth for the email abstraction shared
 * across `@exam/db` (outbox persistence) and `@exam/api` (senders, worker,
 * delivery service). It lives in the leaf `@exam/domain` package so it
 * carries no Fastify / Drizzle / nodemailer dependency.
 *
 * Scope note: this module defines reusable email infrastructure ONLY. The
 * identity flows that enqueue mail (staff invitation, password reset) and the
 * operational notification flow (result_published) live in `@exam/api` and
 * enqueue through the outbox — this module owns the shared row/message types,
 * not the callers.
 */

/**
 * Lifecycle status of an outbox row (P5-0 target state).
 *
 * - `pending`    — first-time or immediately claimable.
 * - `processing` — claimed by one worker; locked_at and locked_by are non-null.
 * - `retry_wait` — retryable failure under backoff; next_attempt_at is non-null.
 * - `sent`       — terminal: sender adapter returned successfully.
 * - `dead`       — terminal: retry budget exhausted; last_error is non-null.
 *
 * State transitions:
 *   pending    -> processing  (worker claims)
 *   retry_wait -> processing  (worker claims when next_attempt_at <= now())  // adr-006-allow
 *   processing -> sent        (send succeeded)
 *   processing -> retry_wait  (send failed, attempt_count < max_attempts)
 *   processing -> dead        (send failed, attempt_count >= max_attempts)
 *   processing -> pending     (abandoned-lock recovery)
 */
export type EmailOutboxStatus =
  | "pending"
  | "processing"
  | "retry_wait"
  | "sent"
  | "dead";

/**
 * Logical category of an outbox row. Used for filtering / observability only —
 * it does not affect send behavior.
 *
 * A value is added exactly when a production writer starts emitting it and
 * removed when no production writer remains (#300 audit): the `email_outbox`
 * `type` column is plain text with no CHECK constraint, so the union only
 * constrains NEW rows; historical rows keep their persisted value. Current
 * writers: `grade_notification` (result_published), `exam_notification`
 * (exam_assigned), `staff_invitation`, `password_reset`.
 */
export type EmailType =
  | "password_reset"
  | "staff_invitation"
  | "exam_notification"
  | "grade_notification";

/**
 * A canonical email message handed to a sender. `html` is optional; `text` is
 * always required as the portable fallback body.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
}

/**
 * Result returned by an EmailSender after a send attempt.
 *
 * - `providerMessageId`: the identifier returned by the configured sender
 *   adapter. For SMTP/Nodemailer this is the RFC 5322 Message-ID exposed as
 *   SendInfo.messageId. It is not an SMTP transaction identifier and is not
 *   proof that the target mailbox received or displayed the message.
 */
export interface EmailSendResult {
  providerMessageId: string | null;
}

/**
 * Abstraction every email sender implements. Business/worker code MUST go
 * through this interface — it must never call `nodemailer.sendMail` directly.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
  close?(): void | Promise<void>;
}

/**
 * Narrowest honest context for system processes (e.g. the email worker) that
 * only need an organization boundary without an authenticated user, role, or
 * permissions.
 */
export interface OrganizationScope {
  organizationId: string;
}

/**
 * A persisted email outbox row. Mirrors the `email_outbox` table shape
 * (declared in `@exam/db`'s Drizzle schema) so service/test code can reason
 * about rows without importing Drizzle types.
 */
export interface EmailOutboxRow {
  id: string;
  organizationId: string;
  type: EmailType;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  status: EmailOutboxStatus;
  attemptCount: number;
  maxAttempts: number;
  lockedAt: Date | null;
  lockedBy: string | null;
  providerMessageId: string | null;
  dedupeKey: string | null;
  lastError: string | null;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  /**
   * Optional Inbox notification that triggered this Email (P5-N1-I2). Null for
   * identity-flow Emails; set on operational Emails
   * (result_published -> grade_notification).
   */
  notificationId: string | null;
  /**
   * Optional recipient user link, independent of recipientEmail (P5-N1-I2).
   */
  recipientUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
