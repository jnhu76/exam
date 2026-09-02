import { describe, expect, it } from "vitest";
import {
  computeEffectiveDeadline,
  isAttemptDeadlineExpired,
} from "./deadlineReconciliation.js";

describe("nullable effective-deadline kernel", () => {
  const closeAt = new Date("2026-09-02T12:00:00Z");
  const earlierAttemptDeadline = new Date("2026-09-02T11:00:00Z");
  const laterAttemptDeadline = new Date("2026-09-02T13:00:00Z");

  it("uses the earlier of exam close and attempt deadline", () => {
    expect(
      computeEffectiveDeadline(
        { closeAt },
        { deadlineAt: earlierAttemptDeadline },
      ),
    ).toEqual(earlierAttemptDeadline);
    expect(
      computeEffectiveDeadline({ closeAt }, { deadlineAt: laterAttemptDeadline }),
    ).toEqual(closeAt);
  });

  it("uses the exam close when the attempt has no personal deadline", () => {
    expect(computeEffectiveDeadline({ closeAt }, { deadlineAt: null })).toEqual(
      closeAt,
    );
  });

  it("represents absence of both bounds as no deadline", () => {
    expect(
      computeEffectiveDeadline({ closeAt: null }, { deadlineAt: null }),
    ).toBeNull();
  });

  it("never reports deadline expiry when no deadline exists", () => {
    expect(
      isAttemptDeadlineExpired(
        { closeAt: null },
        { deadlineAt: null },
        new Date("2099-01-01T00:00:00Z"),
      ),
    ).toBe(false);
  });

  it("keeps the equality boundary expired when a deadline exists", () => {
    expect(
      isAttemptDeadlineExpired(
        { closeAt },
        { deadlineAt: null },
        new Date(closeAt),
      ),
    ).toBe(true);
  });

  it("fails closed on the impossible attempt-only deadline hybrid", () => {
    expect(() =>
      computeEffectiveDeadline(
        { closeAt: null },
        { deadlineAt: earlierAttemptDeadline },
      ),
    ).toThrow(/closeAt is required/);
  });
});
