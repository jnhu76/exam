/**
 * Email backend foundation barrel (M3/P5-0 — Email Outbox + Delivery Runtime).
 *
 * Public surface for the rest of the API: senders (transport selection),
 * retry policy, error sanitizer, the outbox drain service, and the shared
 * rendered-content contract. The diagnostic test-email probe lives in
 * `routes/email.ts` (it sends synchronously and bypasses the outbox).
 *
 * Outbox rows are created ONLY by the owning business/identity transaction
 * via `createEmailOutboxRepo(tx).create` (ADR-011: the row commits atomically
 * with its business fact). `EmailOutboxService` drains due rows; senders are
 * wrapped by `fastify.emailSender` and must never be called for product
 * Email outside the worker.
 */
export * from "./senders.js";
export * from "./retryPolicy.js";
export * from "./sanitizeError.js";
export * from "./outboxService.js";
export * from "./renderedEmail.js";
