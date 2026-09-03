// #291 Phase B1 — the synchronized-deadline equation (Model A freeze,
// docs/audits/291-PHASE-B-TIMED-SYNC-SEMANTIC-FREEZE.md).
//
// syncDeadline = null when the operator has not triggered the sitting;
// otherwise min(T0 + durationMinutes, closeAt). The equation is a pure
// function of the durable exam row so a restart reconstructs the same
// deadline without process-local state.

import { describe, expect, it } from "vitest";
import { computeSyncDeadline } from "./timer.js";

describe("synchronized-deadline kernel", () => {
  const t0 = new Date("2025-01-01T10:00:00Z");
  const durationBound = new Date("2025-01-01T11:30:00Z"); // T0 + 90min
  const hardCap = new Date("2025-01-01T11:00:00Z"); // earlier than duration end

  it("has no deadline before the operator triggers the synchronized start", () => {
    expect(
      computeSyncDeadline({
        syncStartedAt: null,
        durationMinutes: 90,
        closeAt: hardCap,
      }),
    ).toBeNull();
  });

  it("binds the shared deadline at T0 + duration when the cap is later", () => {
    expect(
      computeSyncDeadline({
        syncStartedAt: t0,
        durationMinutes: 90,
        closeAt: new Date("2025-01-01T12:00:00Z"),
      }),
    ).toEqual(durationBound);
  });

  it("binds the shared deadline at closeAt when the cap is earlier", () => {
    expect(
      computeSyncDeadline({
        syncStartedAt: t0,
        durationMinutes: 90,
        closeAt: hardCap,
      }),
    ).toEqual(hardCap);
  });

  it("keeps the exact boundary when T0 + duration equals closeAt", () => {
    expect(
      computeSyncDeadline({
        syncStartedAt: t0,
        durationMinutes: 60,
        closeAt: hardCap,
      }),
    ).toEqual(hardCap);
  });

  it("treats a missing closeAt as duration-bound (defensive; authoring requires closeAt)", () => {
    expect(
      computeSyncDeadline({
        syncStartedAt: t0,
        durationMinutes: 90,
        closeAt: null,
      }),
    ).toEqual(durationBound);
  });

  it("fails closed when a triggered sync exam carries no duration", () => {
    // A malformed sync exam must degrade to an error, never to "no deadline":
    // null would mean the sitting never ends and no attempt ever auto-submits.
    expect(() =>
      computeSyncDeadline({
        syncStartedAt: t0,
        durationMinutes: null,
        closeAt: hardCap,
      }),
    ).toThrow(/duration/);
  });
});
