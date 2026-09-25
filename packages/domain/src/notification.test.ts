import { describe, it, expect } from "vitest";
import { NOTIFICATION_TYPES } from "./notification.js";

// Slice 2 — notification domain types.
//
// Contract (P5-N1-R0 §7, §22; exam_assigned added under #402/#299):
//   - NotificationType values: result_published, exam_assigned.
//   - Severity / resource_type / resource_id / archived_at / invalidated_at
//     columns are deferred — they are not domain types here.
//   - NotificationType and EmailType are INDEPENDENT string spaces. The
//     mappings (result_published -> grade_notification,
//     exam_assigned -> exam_notification) are owned and proven by the policy
//     layer (apps/api/src/notifications/policy.ts + policy.test.ts).

describe("NOTIFICATION_TYPES", () => {
  // The exact-equality pin already proves absence of every deferred type
  // (schedule/cancel/grading/announcement); adding one requires its own
  // operational evidence (#402 brake).
  it("contains exactly the implemented types", () => {
    expect(NOTIFICATION_TYPES).toEqual(["result_published", "exam_assigned"]);
  });
});
