import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_TYPES,
  isNotificationType,
  type NotificationType,
} from "./notification.js";
import type { EmailType } from "./email.js";

// Slice 2 — notification domain types.
//
// V1 contract (P5-N1-R0 §7, §22 — frozen):
//   - The ONLY NotificationType value is "result_published".
//   - Severity / resource_type / resource_id / archived_at / invalidated_at
//     columns are NOT V1 (deferred) — they are not domain types here.
//   - NotificationType and EmailType are INDEPENDENT string spaces. The
//     mapping (result_published -> grade_notification) lives in policy code
//     (apps/api/src/notifications/policy.ts, P5-N1-I2), NOT in the domain
//     layer. This test proves the string inequality the policy relies on.

describe("NOTIFICATION_TYPES", () => {
  it("contains exactly one V1 type: result_published", () => {
    expect(NOTIFICATION_TYPES).toEqual(["result_published"]);
  });

  it("does NOT include deferred types (exam_assigned etc.)", () => {
    // Deferred per P5-N1-R0 §5 / §23. Adding them here would silently widen V1.
    const deferred = [
      "exam_assigned",
      "exam_time_changed",
      "exam_cancelled",
      "grading_assigned",
      "announcement",
    ];
    for (const d of deferred) {
      expect(NOTIFICATION_TYPES).not.toContain(d);
    }
  });
});

describe("isNotificationType", () => {
  it("accepts the V1 type literal", () => {
    expect(isNotificationType("result_published")).toBe(true);
  });

  it("rejects an unknown type string", () => {
    expect(isNotificationType("exam_assigned")).toBe(false);
    expect(isNotificationType("")).toBe(false);
    expect(isNotificationType("result_published_typo")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isNotificationType(null as unknown as string)).toBe(false);
    expect(isNotificationType(undefined as unknown as string)).toBe(false);
    expect(isNotificationType(42 as unknown as string)).toBe(false);
  });
});

describe("NotificationType / EmailType string independence", () => {
  // The frozen mapping is result_published -> grade_notification. These two
  // literal strings MUST differ — the policy layer depends on the inequality
  // and must never assume `NotificationType === EmailType` by string equality.
  it("'result_published' is NOT equal to any EmailType string", () => {
    const emailTypes: EmailType[] = [
      "password_reset",
      "staff_invitation",
      "grade_notification",
    ];
    const nt: NotificationType = "result_published";
    for (const et of emailTypes) {
      expect(nt).not.toEqual(et);
    }
  });

  it("the V1 mapping target 'grade_notification' is a valid EmailType", () => {
    // Smoke check: the EmailType that policy.ts will map to actually exists.
    const valid: EmailType = "grade_notification";
    expect(valid).toBe("grade_notification");
  });
});
