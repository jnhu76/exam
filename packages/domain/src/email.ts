/**
 * Email domain types (M3 — Email Outbox + SMTP Backend Foundation).
 *
 * This module is the single source of truth for the email abstraction shared
 * across `@exam/db` (outbox persistence) and `@exam/api` (senders, worker,
 * notification service). It lives in the leaf `@exam/domain` package so it
 * carries no Fastify / Drizzle / nodemailer dependency.
 *
 * Scope note: this Job builds reusable email infrastructure ONLY. There is no
 * registration, password-reset, or user-email integration here — those flows
 * do not exist in Phase 1 and the `users` table has no email column.
 */

/**
 * Lifecycle status of an outbox row.
 *
 * - `pending`  — queued, waiting to be processed (immediately or after retry).
 * - `sent`     — successfully delivered by a sender.
 * - `failed`   — exhausted all retry attempts; terminal.
 *
 * State transitions (driven by `EmailOutboxService`):
 *   pending -> sent            (send succeeded)
 *   pending -> pending+retry   (send failed, attempts < maxAttempts)
 *   pending -> failed          (send failed, attempts == maxAttempts)
 */
export type EmailOutboxStatus = "pending" | "sent" | "failed";

/**
 * Logical category of an outbox row. Used for filtering / observability only —
 * it does not affect send behavior. New categories may be added freely.
 */
export type EmailType =
  | "registration_welcome"
  | "password_reset"
  | "admin_created_user"
  | "exam_notification"
  | "grade_notification"
  | "system_alert"
  | "test_email";

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
 * Abstraction every email sender implements. Business/worker code MUST go
 * through this interface — it must never call `nodemailer.sendMail` directly.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
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
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextRetryAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
