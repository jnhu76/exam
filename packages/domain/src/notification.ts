/**
 * Notification domain types (P5-N1 — Notification Inbox + Result-Published).
 *
 * This module is the leaf-domain source of truth for the Inbox notification
 * abstraction. It lives in `@exam/domain` so it carries no Fastify / Drizzle
 * dependency and can be imported by `@exam/contracts`, `@exam/db`, and
 * `@exam/api` without layering violations.
 *
 * V1+ scope (P5-N1-R0 §7, §22; extended additively for `exam_assigned`
 * under #402/#299):
 *   - NotificationType values: `"result_published"`, `"exam_assigned"`.
 *   - Severity is deferred (info-only; no column, no domain type).
 *   - `NotificationType` and `EmailType` are INDEPENDENT string spaces. The
 *     operational mappings (`result_published -> grade_notification`,
 *     `exam_assigned -> exam_notification`) live in policy code
 *     (`apps/api/src/notifications/policy.ts`) and are tested there — they
 *     are NOT asserted by string equality here.
 *
 * Still-deferred notification types (not implemented): `exam_time_changed`,
 * `exam_cancelled`, `grading_assigned`, `announcement`. Adding them later is
 * additive and does not change any row already persisted under an existing
 * type.
 */

/**
 * The set of NotificationType values implemented.
 *
 * Kept as a readonly tuple so callers can iterate, type-narrow, and assert
 * exhaustiveness. The companion `NotificationType` union is derived from it.
 * A value is added exactly when its operational wiring (policy + dispatch)
 * ships.
 */
export const NOTIFICATION_TYPES = [
  "result_published",
  "exam_assigned",
] as const satisfies readonly string[];

/**
 * Logical category of an Inbox notification row.
 *
 * Values are appended additively, exactly when their operational wiring
 * ships.
 */
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Type guard: true iff `value` is one of the implemented
 * {@link NotificationType} literals. Use this on every untrusted boundary
 * (DB reads, API inputs) so a future type can be added without silently
 * widening legacy readers.
 */
export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === "string" &&
    (NOTIFICATION_TYPES as readonly string[]).includes(value)
  );
}
