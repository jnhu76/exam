import { describe, it, expect } from "vitest";
import {
  resolveEmailTypeForNotification,
  requiresInbox,
  emailEnabledForRecipient,
} from "./policy.js";
import type { NotificationType } from "@exam/domain";

// P5-N1-I2 Slice 1 — static V1 channel policy + NotificationType->EmailType
// mapping (P5-N1-R0 §10, §14 — frozen).
//
// V1 policy:
//   result_published:
//     Inbox = required
//     Email = enabled when normalized recipient email exists
// Mapping (exactly one):
//   result_published -> grade_notification
// NotificationType and EmailType are INDEPENDENT string spaces — the mapping
// is explicit and tested; it is never inferred by string equality.

describe("resolveEmailTypeForNotification (explicit mapping)", () => {
  it("maps result_published -> grade_notification (the only V1 entry)", () => {
    expect(resolveEmailTypeForNotification("result_published")).toBe(
      "grade_notification",
    );
  });

  it("returns null for a NotificationType with no Email mapping", () => {
    // No V1 type maps to null, but the function must be total over the union.
    // Use a hypothetical future type cast to prove the null branch.
    expect(
      resolveEmailTypeForNotification("exam_assigned" as NotificationType),
    ).toBeNull();
  });

  it("does NOT assume NotificationType === EmailType by string equality", () => {
    // The frozen mapping target is grade_notification, NOT result_published.
    // If someone renamed EmailType.result_published into existence, this test
    // would still require the explicit mapping to point at grade_notification.
    const mapped = resolveEmailTypeForNotification("result_published");
    expect(mapped).not.toBe("result_published");
    expect(mapped).toBe("grade_notification");
  });
});

describe("requiresInbox (V1 channel policy)", () => {
  it("result_published requires Inbox", () => {
    expect(requiresInbox("result_published")).toBe(true);
  });

  it("a hypothetical future type without a V1 policy defaults to false", () => {
    expect(requiresInbox("exam_assigned" as NotificationType)).toBe(false);
  });
});

describe("emailEnabledForRecipient (V1 channel policy)", () => {
  it("result_published enables Email when a normalized email exists", () => {
    expect(
      emailEnabledForRecipient("result_published", "cand@example.com"),
    ).toBe(true);
  });

  it("result_published disables Email when email is null", () => {
    expect(emailEnabledForRecipient("result_published", null)).toBe(false);
  });

  it("result_published disables Email when email is empty/blank", () => {
    // Defense in depth: the contract already maps blank -> undefined, but the
    // policy must not enable Email on a stray blank string.
    expect(emailEnabledForRecipient("result_published", "")).toBe(false);
    expect(emailEnabledForRecipient("result_published", "   ")).toBe(false);
  });
});
