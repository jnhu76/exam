/**
 * Notification domain types (P5-N1 — Notification Inbox + Result-Published).
 *
 * This module is the leaf-domain source of truth for the Inbox notification
 * abstraction. It lives in `@exam/domain` so it carries no Fastify / Drizzle
 * dependency and can be imported by `@exam/contracts`, `@exam/db`, and
 * `@exam/api` without layering violations.
 *
 * V1 scope (P5-N1-R0 §7, §22 — frozen):
 *   - The ONLY NotificationType value is `"result_published"`.
 *   - Severity is deferred (V1 = info-only; no column, no domain type).
 *   - `NotificationType` and `EmailType` are INDEPENDENT string spaces. The
 *     operational mapping (`result_published -> grade_notification`) lives in
 *     policy code (`apps/api/src/notifications/policy.ts`, P5-N1-I2) and is
 *     tested there — it is NOT asserted by string equality here.
 *
 * Deferred notification types (NOT V1): `exam_assigned`, `exam_time_changed`,
 * `exam_cancelled`, `grading_assigned`, `announcement`. Adding them later is
 * additive and does not change any V1 row already persisted as
 * `"result_published"`.
 */

/**
 * The set of NotificationType values implemented in V1.
 *
 * Kept as a readonly tuple so callers can iterate, type-narrow, and assert
 * exhaustiveness. The companion `NotificationType` union is derived from it.
 */
export const NOTIFICATION_TYPES = [
  "result_published",
] as const satisfies readonly string[];

/**
 * Logical category of an Inbox notification row.
 *
 * V1 has exactly one value. Future values will be appended additively.
 */
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Type guard: true iff `value` is one of the V1 {@link NotificationType}
 * literals. Use this on every untrusted boundary (DB reads, API inputs) so a
 * future type can be added without silently widening legacy readers.
 */
export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === "string" &&
    (NOTIFICATION_TYPES as readonly string[]).includes(value)
  );
}
