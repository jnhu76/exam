import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_TYPES,
  isNotificationType,
  type NotificationType,
} from "./notification.js";
import type { EmailType } from "./email.js";

// Slice 2 — notification domain types.
//
// Contract (P5-N1-R0 §7, §22; exam_assigned added under #402/#299):
//   - NotificationType values: result_published, exam_assigned.
//   - Severity / resource_type / resource_id / archived_at / invalidated_at
//     columns are deferred — they are not domain types here.
//   - NotificationType and EmailType are INDEPENDENT string spaces. The
//     mappings (result_published -> grade_notification,
//     exam_assigned -> exam_notification) live in policy code
//     (apps/api/src/notifications/policy.ts), NOT in the domain layer. These
//     tests prove the string inequalities the policy relies on.

describe("NOTIFICATION_TYPES", () => {
  it("contains exactly the implemented types", () => {
    expect(NOTIFICATION_TYPES).toEqual(["result_published", "exam_assigned"]);
  });

  it("does NOT include deferred types (schedule/cancel/grading/announcement)", () => {
    // Adding these requires their own operational evidence (#402 brake).
    const deferred = [
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
  it("accepts the implemented type literals", () => {
    expect(isNotificationType("result_published")).toBe(true);
    expect(isNotificationType("exam_assigned")).toBe(true);
  });

  it("rejects a deferred type string", () => {
    expect(isNotificationType("exam_cancelled")).toBe(false);
  });

  it("rejects an unknown type string", () => {
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
  // The frozen mappings are result_published -> grade_notification and
  // exam_assigned -> exam_notification. These literal strings MUST differ
  // from their NotificationType sources — the policy layer depends on the
  // inequality and must never assume `NotificationType === EmailType` by
  // string equality.
  it("'result_published' is NOT equal to any EmailType string", () => {
    const emailTypes: EmailType[] = [
      "password_reset",
      "staff_invitation",
      "exam_notification",
      "grade_notification",
    ];
    const nt: NotificationType = "result_published";
    for (const et of emailTypes) {
      expect(nt).not.toEqual(et);
    }
  });

  it("'exam_assigned' is NOT equal to any EmailType string", () => {
    const emailTypes: EmailType[] = [
      "password_reset",
      "staff_invitation",
      "exam_notification",
      "grade_notification",
    ];
    const nt: NotificationType = "exam_assigned";
    for (const et of emailTypes) {
      expect(nt).not.toEqual(et);
    }
  });

  it("the mapping targets 'grade_notification' and 'exam_notification' are valid EmailTypes", () => {
    // Smoke check: the EmailTypes that policy.ts maps to actually exist.
    const valid: EmailType[] = ["grade_notification", "exam_notification"];
    expect(valid).toHaveLength(2);
  });
});
