import type { EmailType, NotificationType } from "@exam/domain";

// P5-N1-I2 — static channel policy + NotificationType -> EmailType mapping.
//
// Authority: P5-N1-R0 §10 (static policy) + §14 (mapping); `exam_assigned`
// added under #402/#299.
//
// Policy:
//   result_published:
//     Inbox = required
//     Email = enabled when a normalized recipient email exists
//   exam_assigned:
//     Inbox = required
//     Email = enabled when a normalized recipient email exists
//
// Mappings (exactly one entry per type):
//   result_published -> grade_notification
//   exam_assigned    -> exam_notification
//
// NotificationType and EmailType are INDEPENDENT string spaces. The mapping
// is explicit and tested (apps/api/src/notifications/policy.test.ts); it is
// NEVER inferred by string equality between the two unions.

/**
 * Maps a NotificationType to its operational EmailType, or null when no Email
 * channel is wired for that type.
 *
 * Each target reuses an existing `EmailType` value rather than introducing a
 * duplicate under the NotificationType's name — the two would express the
 * same intent under different names.
 */
export function resolveEmailTypeForNotification(
  type: NotificationType,
): EmailType | null {
  switch (type) {
    case "result_published":
      // Explicit mapping. Do NOT collapse to `return type as EmailType` —
      // NotificationType and EmailType are independent string spaces and
      // "result_published" !== "grade_notification".
      return "grade_notification";
    case "exam_assigned":
      return "exam_notification";
    default: {
      // Exhaustiveness guard: a NotificationType without a mapping is a
      // compile error here. The cast is for the test-only hypothetical path;
      // in production this branch is unreachable.
      const _exhaustive: never = type;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Inbox policy: is an Inbox row required for this notification type?
 *
 * Every implemented type requires an Inbox row (the Inbox is the
 * authoritative in-product channel; a candidate without email still gets
 * one).
 */
export function requiresInbox(type: NotificationType): boolean {
  switch (type) {
    case "result_published":
    case "exam_assigned":
      return true;
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return false;
    }
  }
}

/**
 * Email policy: is the Email channel enabled for this recipient?
 *
 * Email is enabled ONLY when a normalized recipient email is present. A
 * recipient without email receives an Inbox row only (no outbox row). This
 * is the composition of the per-type policy and the per-recipient email
 * source (users.email, P5-N1-I1 §13).
 *
 * Blank/whitespace strings are treated as "no email" as defense in depth —
 * the contract layer already maps blank to undefined, but the policy must
 * not silently enable Email on a stray blank.
 */
export function emailEnabledForRecipient(
  type: NotificationType,
  recipientEmail: string | null,
): boolean {
  if (type !== "result_published" && type !== "exam_assigned") {
    return false;
  }
  if (typeof recipientEmail !== "string") return false;
  return recipientEmail.trim() !== "";
}
