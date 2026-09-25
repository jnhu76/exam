/**
 * Email backend barrel.
 *
 * Outbox rows are created ONLY by the owning business/identity transaction via
 * `createEmailOutboxRepo(tx).create` (ADR-011: the row commits atomically with
 * its business fact). `EmailOutboxService` drains due rows; senders are wrapped
 * by `fastify.emailSender` and must never be called for product Email outside
 * the worker. The diagnostic test-email probe lives in `routes/email.ts` (it
 * sends synchronously and bypasses the outbox).
 */
export * from "./senders.js";
export * from "./retryPolicy.js";
export * from "./sanitizeError.js";
export * from "./outboxService.js";
export * from "./renderedEmail.js";
