/**
 * Notification domain types (Notification Inbox + Result-Published).
 *
 * This module is the leaf-domain source of truth for the Inbox notification
 * abstraction. It lives in `@exam/domain` so it carries no Fastify / Drizzle
 * dependency and can be imported by `@exam/contracts`, `@exam/db`, and
 * `@exam/api` without layering violations.
 *
 * `NotificationType` and `EmailType` are INDEPENDENT string spaces. The
 * operational mappings (`result_published -> grade_notification`,
 * `exam_assigned -> exam_notification`) live in policy code
 * (`apps/api/src/notifications/policy.ts`) and are tested there — they are NOT
 * asserted by string equality here.
 *
 * A type is added additively, exactly when its operational wiring (policy +
 * dispatch) ships; that never changes rows already persisted under an existing
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
