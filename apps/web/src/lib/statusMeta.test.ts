import { describe, expect, it } from "vitest";
import { getStatusMeta, isStatusKey, statusMeta } from "./statusMeta";

describe("statusMeta", () => {
  it("every status entry has a labelKey (no hardcoded label copy)", () => {
    for (const [key, meta] of Object.entries(statusMeta)) {
      expect(
        typeof meta.labelKey === "string" && meta.labelKey.length > 0,
        `${key} must have a non-empty labelKey`,
      ).toBe(true);
      // J2 invariant: statusMeta stores NO Chinese label text — only the key.
      // The Chinese text lives in the i18n catalog (locales/zh-CN.ts).
      expect(meta).not.toHaveProperty("label");
    }
  });

  it("labelKeys are stable, dotted i18n keys namespaced under 'status.'", () => {
    expect(statusMeta.draft.labelKey).toBe("status.exam.draft");
    expect(statusMeta.open.labelKey).toBe("status.exam.open");
    expect(statusMeta.connected.labelKey).toBe("status.connection.connected");
    expect(statusMeta.in_progress.labelKey).toBe("status.attempt.in_progress");
    for (const meta of Object.values(statusMeta)) {
      expect(meta.labelKey.startsWith("status.")).toBe(true);
    }
  });

  it("has infrastructure status entries for diagnostics (available/degraded/unavailable/disabled/unknown)", () => {
    // P3-M5B: the diagnostics email/worker surfaces use a stable vocabulary.
    // These must exist as statusMeta entries so StatusBadge can render them.
    expect(statusMeta.infraAvailable.labelKey).toBe("status.infra.available");
    expect(statusMeta.infraDegraded.labelKey).toBe("status.infra.degraded");
    expect(statusMeta.infraUnavailable.labelKey).toBe(
      "status.infra.unavailable",
    );
    expect(statusMeta.infraDisabled.labelKey).toBe("status.infra.disabled");
    expect(statusMeta.infraUnknown.labelKey).toBe("status.infra.unknown");
    // Tones follow the project convention: success/warning/destructive/muted/muted.
    expect(statusMeta.infraAvailable.tone).toBe("success");
    expect(statusMeta.infraDegraded.tone).toBe("warning");
    expect(statusMeta.infraUnavailable.tone).toBe("destructive");
    expect(statusMeta.infraDisabled.tone).toBe("muted");
    expect(statusMeta.infraUnknown.tone).toBe("muted");
  });

  it("preserves tone + icon metadata (semantic/color unchanged by i18n)", () => {
    expect(statusMeta.closed).toMatchObject({ tone: "secondary" });
    expect(statusMeta.started).toMatchObject({ tone: "success" });
    expect(statusMeta.blocked).toMatchObject({ tone: "destructive" });
    expect(statusMeta.in_progress).toMatchObject({ tone: "primary" });
    expect(statusMeta.submitted).toMatchObject({ tone: "secondary" });
    expect(statusMeta.saving).toMatchObject({ tone: "warning" });
    expect(statusMeta.failed).toMatchObject({ tone: "destructive" });
    expect(statusMeta.expired).toMatchObject({ tone: "destructive" });
    // icon is still a component reference, not removed by the labelKey change.
    expect(statusMeta.graded.icon).toBeTypeOf("object");
  });

  it("detects known status keys", () => {
    expect(isStatusKey("published")).toBe(true);
    expect(isStatusKey("not_a_status")).toBe(false);
  });

  it("falls back to unknown metadata for unsupported statuses", () => {
    expect(getStatusMeta("not_a_status")).toEqual(statusMeta.unknown);
  });
});
