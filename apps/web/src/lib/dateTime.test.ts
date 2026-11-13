import { describe, expect, it } from "vitest";
import {
  createProductDateTimeFormatter,
  instantToLocalInput,
  localInputToInstant,
  resolveProductTimeZone,
} from "./dateTime";

describe("product date/time authority", () => {
  it("formats date, time, date-time, and ranges deterministically in zh-CN with a 24-hour cycle", () => {
    const formatter = createProductDateTimeFormatter("Asia/Shanghai");
    const instant = "2026-07-14T01:02:03.000Z";

    expect(formatter.formatDate(instant)).toBe("2026-07-14");
    expect(formatter.formatTime(instant)).toBe("09:02:03");
    expect(formatter.formatDateTime(instant)).toBe("2026-07-14 09:02:03");
    expect(formatter.formatDateRange(instant, "2026-07-15T02:03:04.000Z")).toBe(
      "2026-07-14 — 2026-07-15",
    );
  });

  // Minute-precision variant for surfaces where seconds carry no exam-rule
  // meaning; same authority, same tz rules.
  it("formats minute-precision date-time without seconds", () => {
    const formatter = createProductDateTimeFormatter("Asia/Shanghai");

    expect(formatter.formatDateTimeMinute("2026-07-14T01:02:03.000Z")).toBe(
      "2026-07-14 09:02",
    );
    // Second digits are dropped, not rounded: :59 keeps the same minute.
    expect(formatter.formatDateTimeMinute("2026-12-31T16:00:59.000Z")).toBe(
      "2027-01-01 00:00",
    );
  });

  it("produces the same output regardless of the host locale", () => {
    const instant = "2026-07-14T01:02:03.000Z";
    const enHost = createProductDateTimeFormatter("Asia/Shanghai", "en-US");
    const deHost = createProductDateTimeFormatter("Asia/Shanghai", "de-DE");

    expect(enHost.formatDateTime(instant)).toBe("2026-07-14 09:02:03");
    expect(deHost.formatDateTime(instant)).toBe("2026-07-14 09:02:03");
  });

  it("prefers organization time zone, then deployment, then browser fallback", () => {
    expect(resolveProductTimeZone("Asia/Shanghai", "UTC", "Europe/Paris")).toBe(
      "Asia/Shanghai",
    );
    expect(resolveProductTimeZone(null, "UTC", "Europe/Paris")).toBe("UTC");
    expect(resolveProductTimeZone(undefined, undefined, "Europe/Paris")).toBe(
      "Europe/Paris",
    );
  });
});

/**
 * Scheduling seam (F-20/#971): wall-clock ↔ instant conversions at the
 * product time boundary. Every assertion names the time zone explicitly, so
 * the results must hold under ANY host/browser time zone.
 */
describe("schedule seam — instant → datetime-local wall clock", () => {
  it("fills back the wall clock of the scheduling zone, not the browser zone", () => {
    // The acceptance example: 01:00Z is 09:00 in Shanghai, 17:00 the previous
    // day in Los Angeles.
    expect(
      instantToLocalInput("2026-11-20T01:00:00.000Z", "Asia/Shanghai"),
    ).toBe("2026-11-20T09:00");
    expect(
      instantToLocalInput("2026-11-20T01:00:00.000Z", "America/Los_Angeles"),
    ).toBe("2026-11-19T17:00");
  });

  it("uses minute precision for the datetime-local value", () => {
    expect(
      instantToLocalInput("2026-11-20T01:00:30.500Z", "Asia/Shanghai"),
    ).toBe("2026-11-20T09:00");
  });

  it("fails closed to an empty value for an unparseable instant", () => {
    // The seam owns the guard: callers pass wire instants straight in.
    expect(instantToLocalInput("not-a-date", "Asia/Shanghai")).toBe("");
    expect(instantToLocalInput("", "Asia/Shanghai")).toBe("");
  });
});

describe("schedule seam — datetime-local wall clock → instant", () => {
  it("resolves the audit acceptance value: 2026-11-20 09:00 Shanghai = 2026-11-20T01:00:00.000Z", () => {
    expect(localInputToInstant("2026-11-20T09:00", "Asia/Shanghai")).toEqual({
      kind: "unique",
      instant: "2026-11-20T01:00:00.000Z",
    });
  });

  it("declares the datetime-local control's minute precision only", () => {
    // The authoring controls are minute-granularity datetime-local inputs, so
    // a seconds-bearing value is a FORMAT error — never a DST-gap. In
    // particular ":00" must not be misreported as non-existent.
    expect(localInputToInstant("2026-11-20T09:00:00", "Asia/Shanghai")).toEqual(
      { kind: "invalid" },
    );
    expect(localInputToInstant("2026-11-20T09:00:30", "Asia/Shanghai")).toEqual(
      { kind: "invalid" },
    );
  });

  it("resolves correctly in a half-hour-offset zone", () => {
    expect(localInputToInstant("2026-11-20T09:00", "Asia/Kolkata")).toEqual({
      kind: "unique",
      instant: "2026-11-20T03:30:00.000Z",
    });
  });

  it("round-trips through the same seam in a DST zone", () => {
    const instant = "2026-07-14T18:30:00.000Z";
    const wall = instantToLocalInput(instant, "America/Los_Angeles");
    expect(wall).toBe("2026-07-14T11:30"); // PDT (UTC-7), not host-zone time
    expect(localInputToInstant(wall, "America/Los_Angeles")).toEqual({
      kind: "unique",
      instant,
    });
  });

  it("rejects a wall clock inside the spring-forward gap as non-existent", () => {
    // 2026-03-08 02:00→03:00 in Los Angeles: 02:30 does not exist.
    expect(
      localInputToInstant("2026-03-08T02:30", "America/Los_Angeles"),
    ).toEqual({
      kind: "dst-gap",
    });
    // The same wall clock is fine in a zone without the transition.
    expect(localInputToInstant("2026-03-08T02:30", "Asia/Shanghai")).toEqual({
      kind: "unique",
      instant: "2026-03-07T18:30:00.000Z",
    });
  });

  it("rejects a wall clock inside the fall-back overlap as ambiguous", () => {
    // 2026-11-01 02:00→01:00 in Los Angeles: 01:30 occurs twice.
    expect(
      localInputToInstant("2026-11-01T01:30", "America/Los_Angeles"),
    ).toEqual({ kind: "ambiguous" });
  });

  it("rejects impossible calendar dates and malformed input", () => {
    expect(localInputToInstant("2026-02-30T09:00", "Asia/Shanghai")).toEqual({
      kind: "invalid",
    });
    expect(localInputToInstant("2026-13-01T09:00", "Asia/Shanghai")).toEqual({
      kind: "invalid",
    });
    expect(localInputToInstant("2026-11-20T25:00", "Asia/Shanghai")).toEqual({
      kind: "invalid",
    });
    expect(localInputToInstant("not-a-date", "Asia/Shanghai")).toEqual({
      kind: "invalid",
    });
    expect(localInputToInstant("", "Asia/Shanghai")).toEqual({
      kind: "invalid",
    });
  });
});
