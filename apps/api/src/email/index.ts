/**
 * Email backend foundation barrel (M3/P5-0 — Email Outbox + Delivery Runtime).
 *
 * Public surface for the rest of the API: senders (transport selection),
 * retry policy, error sanitizer, the outbox worker service, and the
 * email delivery (enqueue) service. Business routes must go through
 * `EmailDeliveryService` / `EmailOutboxService` — never through nodemailer
 * or `SmtpEmailSender` directly.
 */
export * from "./senders.js";
export * from "./retryPolicy.js";
export * from "./sanitizeError.js";
export * from "./outboxService.js";
export * from "./emailDeliveryService.js";
