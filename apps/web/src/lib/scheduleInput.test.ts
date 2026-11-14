import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { resolveScheduleField, scheduleFieldHint } from "./scheduleInput";

/** Deterministic stand-in for i18next's TFunction (asserts the seam's keys). */
const t = ((key: string, options?: { timeZone?: string }) =>
  `${key}:${options?.timeZone ?? ""}`) as unknown as TFunction;

/**
 * Edit-preservation contract (#971 F-20/D): an untouched field keeps the
 * ORIGINAL wire instant — seconds and the stored DST-overlap side included —
 * instead of re-converting its minute-precision wall clock.
 */
describe("resolveScheduleField — edit preservation", () => {
  it("keeps the original instant (seconds included) when the wall clock is untouched", () => {
    expect(
      resolveScheduleField(
        "2026-11-20T09:00",
        "2026-11-20T01:00:30.000Z",
        "Asia/Shanghai",
      ),
    ).toEqual({
      status: "unchanged",
      instant: "2026-11-20T01:00:30.000Z",
      changed: false,
    });
  });

  it("keeps the stored side of a DST fall-back overlap when untouched", () => {
    // 01:30 occurs twice in Los Angeles on 2026-11-01; the stored instant is
    // the SECOND occurrence (09:30:30Z). Re-converting the wall clock would
    // silently move it to the first occurrence (08:30Z).
    expect(
      resolveScheduleField(
        "2026-11-01T01:30",
        "2026-11-01T09:30:30.000Z",
        "America/Los_Angeles",
      ),
    ).toEqual({
      status: "unchanged",
      instant: "2026-11-01T09:30:30.000Z",
      changed: false,
    });
  });

  it("resolves an edited wall clock through the session zone", () => {
    expect(
      resolveScheduleField(
        "2026-11-20T10:00",
        "2026-11-20T01:00:30.000Z",
        "Asia/Shanghai",
      ),
    ).toEqual({
      status: "ok",
      instant: "2026-11-20T02:00:00.000Z",
      changed: true,
    });
  });

  it("classifies DST gap, overlap, and malformed input without snapping", () => {
    expect(
      resolveScheduleField("2026-03-08T02:30", null, "America/Los_Angeles")
        .status,
    ).toBe("dst-gap");
    expect(
      resolveScheduleField("2026-11-01T01:30", null, "America/Los_Angeles")
        .status,
    ).toBe("ambiguous");
    // Seconds are not part of the datetime-local control's format: a format
    // error is never reported as a DST gap.
    expect(
      resolveScheduleField("2026-11-20T09:00:00", null, "Asia/Shanghai").status,
    ).toBe("invalid");
  });

  it("reports a cleared field as empty (untimed closeAt stays null)", () => {
    expect(resolveScheduleField("", null, "Asia/Shanghai")).toEqual({
      status: "empty",
      instant: null,
      changed: true,
    });
  });
});

describe("scheduleFieldHint", () => {
  it("names the session zone for DST hints and stays silent when resolvable", () => {
    expect(scheduleFieldHint("dst-gap", "America/Los_Angeles", t)).toBe(
      "admin.forms.exam.scheduleDstGap:America/Los_Angeles",
    );
    expect(scheduleFieldHint("ambiguous", "America/Los_Angeles", t)).toBe(
      "admin.forms.exam.scheduleDstAmbiguous:America/Los_Angeles",
    );
    expect(scheduleFieldHint("invalid", "Asia/Shanghai", t)).toBe(
      "admin.forms.exam.scheduleInvalid:",
    );
    expect(scheduleFieldHint("ok", "Asia/Shanghai", t)).toBeNull();
    expect(scheduleFieldHint("unchanged", "Asia/Shanghai", t)).toBeNull();
    expect(scheduleFieldHint("empty", "Asia/Shanghai", t)).toBeNull();
  });
});
