import { describe, expect, it } from "vitest";
import {
  createProductDateTimeFormatter,
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
