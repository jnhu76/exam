import { describe, it, expect } from "vitest";
import {
  resolveEmailTypeForNotification,
  requiresInbox,
  emailEnabledForRecipient,
} from "./policy.js";

// P5-N1-I2 Slice 1 — static channel policy + NotificationType->EmailType
// mapping (P5-N1-R0 §10, §14; exam_assigned added under #402/#299).
//
// Policy:
//   result_published / exam_assigned:
//     Inbox = required
//     Email = enabled when normalized recipient email exists
// Mappings (exactly one per type):
//   result_published -> grade_notification
//   exam_assigned    -> exam_notification
// NotificationType and EmailType are INDEPENDENT string spaces — the mappings
// are explicit and tested; they are never inferred by string equality.

describe("resolveEmailTypeForNotification (explicit mapping)", () => {
  it("maps result_published -> grade_notification", () => {
    expect(resolveEmailTypeForNotification("result_published")).toBe(
      "grade_notification",
    );
  });

  it("maps exam_assigned -> exam_notification", () => {
    expect(resolveEmailTypeForNotification("exam_assigned")).toBe(
      "exam_notification",
    );
  });

  it("does NOT assume NotificationType === EmailType by string equality", () => {
    // The mapping targets reuse existing EmailType values, NOT the
    // NotificationType string. If someone renamed EmailType to mirror the
    // NotificationType, these assertions would still require the explicit
    // mappings.
    const resultMapped = resolveEmailTypeForNotification("result_published");
    expect(resultMapped).not.toBe("result_published");
    expect(resultMapped).toBe("grade_notification");
    const assignedMapped = resolveEmailTypeForNotification("exam_assigned");
    expect(assignedMapped).not.toBe("exam_assigned");
    expect(assignedMapped).toBe("exam_notification");
  });
});

describe("requiresInbox (channel policy)", () => {
  it("result_published requires Inbox", () => {
    expect(requiresInbox("result_published")).toBe(true);
  });

  it("exam_assigned requires Inbox (a candidate without email still gets one)", () => {
    expect(requiresInbox("exam_assigned")).toBe(true);
  });
});

describe("emailEnabledForRecipient (channel policy)", () => {
  it("enables Email for either type when a normalized email exists", () => {
    expect(
      emailEnabledForRecipient("result_published", "cand@example.com"),
    ).toBe(true);
    expect(emailEnabledForRecipient("exam_assigned", "cand@example.com")).toBe(
      true,
    );
  });

  it("disables Email when email is null", () => {
    expect(emailEnabledForRecipient("result_published", null)).toBe(false);
    expect(emailEnabledForRecipient("exam_assigned", null)).toBe(false);
  });

  it("disables Email when email is empty/blank", () => {
    // Defense in depth: the contract already maps blank -> undefined, but the
    // policy must not enable Email on a stray blank string.
    expect(emailEnabledForRecipient("result_published", "")).toBe(false);
    expect(emailEnabledForRecipient("result_published", "   ")).toBe(false);
    expect(emailEnabledForRecipient("exam_assigned", "")).toBe(false);
    expect(emailEnabledForRecipient("exam_assigned", "   ")).toBe(false);
  });
});
