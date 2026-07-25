import type { EmailType, NotificationType } from "@exam/domain";

// P5-N1-I2 — static V1 channel policy + NotificationType -> EmailType mapping.
//
// Authority: P5-N1-R0 §10 (Static V1 policy) + §14 (mapping) — frozen.
//
// V1 policy:
//   result_published:
//     Inbox = required
//     Email = enabled when a normalized recipient email exists
//
// V1 mapping (exactly one entry):
//   result_published -> grade_notification
//
// NotificationType and EmailType are INDEPENDENT string spaces. The mapping
// is explicit and tested (apps/api/src/notifications/policy.test.ts); it is
// NEVER inferred by string equality between the two unions.

/**
 * Maps a NotificationType to its operational EmailType, or null when no Email
 * channel is wired for that type.
 *
 * V1 has exactly one entry: `result_published -> grade_notification`. The
 * target reuses the existing `grade_notification` EmailType (already defined
 * in @exam/domain) rather than introducing a duplicate `result_published`
 * EmailType — the two would express the same intent under different names.
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
    default: {
      // Exhaustiveness guard: a future NotificationType without a V1 mapping
      // is a compile error here. The cast is for the test-only hypothetical
      // path; in production this branch is unreachable for V1.
      const _exhaustive: never = type;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * V1 Inbox policy: is an Inbox row required for this notification type?
 *
 * `result_published` always requires an Inbox row (the Inbox is the
 * authoritative in-product channel; a candidate without email still gets one).
 */
export function requiresInbox(type: NotificationType): boolean {
  switch (type) {
    case "result_published":
      return true;
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return false;
    }
  }
}

/**
 * V1 Email policy: is the Email channel enabled for this recipient?
 *
 * `result_published` enables Email ONLY when a normalized recipient email is
 * present. A candidate without email receives an Inbox row only (no outbox
 * row). This is the composition of §10 ("Email = enabled when normalized
 * recipient email exists") and the per-recipient email source (users.email,
 * P5-N1-I1 §13).
 *
 * Blank/whitespace strings are treated as "no email" as defense in depth —
 * the contract layer already maps blank to undefined, but the policy must not
 * silently enable Email on a stray blank.
 */
export function emailEnabledForRecipient(
  type: NotificationType,
  recipientEmail: string | null,
): boolean {
  if (type !== "result_published") {
    return false;
  }
  if (typeof recipientEmail !== "string") return false;
  return recipientEmail.trim() !== "";
}
