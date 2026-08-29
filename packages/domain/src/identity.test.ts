import { describe, expect, it } from "vitest";
import {
  computeStaffInvitationStatus,
  STAFF_INVITATION_STATUSES,
} from "./identity.js";

describe("computeStaffInvitationStatus (#297)", () => {
  const base = {
    consumedAt: null,
    revokedAt: null,
    expiresAt: new Date("2026-09-07T00:00:00Z"),
  };

  it("exposes the closed status vocabulary", () => {
    expect(STAFF_INVITATION_STATUSES).toEqual([
      "pending",
      "accepted",
      "revoked",
      "expired",
    ]);
  });

  it("derives pending before expiry", () => {
    expect(
      computeStaffInvitationStatus({ ...base, now: new Date("2026-09-01") }),
    ).toBe("pending");
  });

  it("derives accepted with authority over revoked and expiry", () => {
    expect(
      computeStaffInvitationStatus({
        ...base,
        consumedAt: new Date("2026-09-01"),
        revokedAt: new Date("2026-09-02"),
        now: new Date("2026-09-03"),
      }),
    ).toBe("accepted");
    // Expiry after consumption never demotes an accepted invitation.
    expect(
      computeStaffInvitationStatus({
        ...base,
        consumedAt: new Date("2026-09-01"),
        now: new Date("2026-10-01"),
      }),
    ).toBe("accepted");
  });

  it("derives revoked with authority over expiry", () => {
    expect(
      computeStaffInvitationStatus({
        ...base,
        revokedAt: new Date("2026-09-02"),
        now: new Date("2026-10-01"),
      }),
    ).toBe("revoked");
  });

  it("derives expired at the boundary", () => {
    expect(
      computeStaffInvitationStatus({ ...base, now: new Date("2026-09-07") }),
    ).toBe("expired");
  });
});
