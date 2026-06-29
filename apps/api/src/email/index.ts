/**
 * Email backend foundation barrel (M3 — Email Outbox + SMTP Backend Foundation).
 *
 * Public surface for the rest of the API: senders (transport selection),
 * retry policy, error sanitizer, the outbox worker service, and the
 * notification (enqueue) service. Business routes must go through
 * `EmailNotificationService` / `EmailOutboxService` — never through nodemailer
 * or `SmtpEmailSender` directly.
 */
export * from "./senders.js";
export * from "./retryPolicy.js";
export * from "./sanitizeError.js";
export * from "./outboxService.js";
export * from "./notificationService.js";
