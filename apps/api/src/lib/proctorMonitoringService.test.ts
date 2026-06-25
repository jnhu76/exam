import { describe, it, expect } from "vitest";
import {
  classifyOnlineState,
  computeWarningLevel,
  projectSafeMetadata,
} from "./proctorMonitoringService.js";
import {
  MONITORING_ONLINE_THRESHOLD_MS,
  MONITORING_OFFLINE_THRESHOLD_MS,
} from "@exam/contracts";

const NOW = new Date("2026-06-25T12:00:00.000Z");
const heart = (secondsAgo: number) =>
  new Date(NOW.getTime() - secondsAgo * 1000);

describe("classifyOnlineState (centralized thresholds)", () => {
  it("is online when heartbeat within 30s", () => {
    expect(classifyOnlineState(heart(5), NOW)).toBe("online");
    expect(classifyOnlineState(heart(30), NOW)).toBe("online");
  });
  it("is stale between 30s and 90s", () => {
    expect(classifyOnlineState(heart(31), NOW)).toBe("stale");
    expect(classifyOnlineState(heart(89), NOW)).toBe("stale");
    expect(classifyOnlineState(heart(90), NOW)).toBe("stale");
  });
  it("is offline beyond 90s or with no heartbeat", () => {
    expect(classifyOnlineState(heart(91), NOW)).toBe("offline");
    expect(classifyOnlineState(heart(600), NOW)).toBe("offline");
    expect(classifyOnlineState(null, NOW)).toBe("offline");
  });
  it("uses the exported centralized constants (not magic numbers)", () => {
    // Guard against threshold drift: the boundaries must equal the constants.
    expect(
      classifyOnlineState(heart(MONITORING_ONLINE_THRESHOLD_MS / 1000), NOW),
    ).toBe("online");
    expect(
      classifyOnlineState(
        heart(MONITORING_ONLINE_THRESHOLD_MS / 1000 + 1),
        NOW,
      ),
    ).toBe("stale");
    expect(
      classifyOnlineState(heart(MONITORING_OFFLINE_THRESHOLD_MS / 1000), NOW),
    ).toBe("stale");
    expect(
      classifyOnlineState(
        heart(MONITORING_OFFLINE_THRESHOLD_MS / 1000 + 1),
        NOW,
      ),
    ).toBe("offline");
  });
});

describe("computeWarningLevel (status hint, never cheating)", () => {
  const base = {
    onlineState: "online" as const,
    saveFailedCount: 0,
    submitFailedCount: 0,
    visibilityLostCount: 0,
    browserOfflineCount: 0,
    hasDeadlineAutoSubmitFailed: false,
  };

  it("normal when nothing abnormal", () => {
    expect(computeWarningLevel(base)).toBe("normal");
  });

  it("critical when offline", () => {
    expect(computeWarningLevel({ ...base, onlineState: "offline" })).toBe(
      "critical",
    );
  });
  it("critical when submit_failed > 0", () => {
    expect(computeWarningLevel({ ...base, submitFailedCount: 1 })).toBe(
      "critical",
    );
  });
  it("critical when save_failed >= 3", () => {
    expect(computeWarningLevel({ ...base, saveFailedCount: 3 })).toBe(
      "critical",
    );
  });
  it("critical when deadline_auto_submit_failed", () => {
    expect(
      computeWarningLevel({ ...base, hasDeadlineAutoSubmitFailed: true }),
    ).toBe("critical");
  });

  it("warning when stale", () => {
    expect(computeWarningLevel({ ...base, onlineState: "stale" })).toBe(
      "warning",
    );
  });
  it("warning when save_failed > 0 (but < 3)", () => {
    expect(computeWarningLevel({ ...base, saveFailedCount: 1 })).toBe(
      "warning",
    );
    expect(computeWarningLevel({ ...base, saveFailedCount: 2 })).toBe(
      "warning",
    );
  });
  it("warning when visibility_lost > 0", () => {
    expect(computeWarningLevel({ ...base, visibilityLostCount: 1 })).toBe(
      "warning",
    );
  });
  it("warning when browser_offline > 0", () => {
    expect(computeWarningLevel({ ...base, browserOfflineCount: 1 })).toBe(
      "warning",
    );
  });
});

describe("projectSafeMetadata (per-event allowlist, default-deny)", () => {
  it("keeps only allowlisted keys for answer_autosave_failed", () => {
    const out = projectSafeMetadata("answer_autosave_failed", {
      questionId: "q1",
      saveMode: "autosave",
      durationMs: 120,
      errorCode: "NET",
      answer: "SECRET",
      token: "abc",
      randomExtra: "x",
    });
    expect(out).toEqual({
      questionId: "q1",
      saveMode: "autosave",
      durationMs: 120,
      errorCode: "NET",
    });
    expect(out).not.toHaveProperty("answer");
    expect(out).not.toHaveProperty("token");
  });

  it("drops answer/content/token/cookie even if present in raw", () => {
    const out = projectSafeMetadata("submit_failed", {
      durationMs: 50,
      errorCode: "X",
      answer: "A",
      content: "question body",
      cookie: "c",
      authorization: "Bearer z",
    });
    expect(out).toEqual({ durationMs: 50, errorCode: "X" });
  });

  it("returns empty object for an unknown event name (default-deny)", () => {
    expect(
      projectSafeMetadata("some_new_event", { anything: 1, answer: "x" }),
    ).toEqual({});
  });

  it("returns empty object when allowlist is empty (force_submit etc.)", () => {
    expect(
      projectSafeMetadata("force_submit", { actor: "admin", reason: "x" }),
    ).toEqual({});
  });

  it("handles null/undefined raw metadata", () => {
    expect(projectSafeMetadata("submit_failed", null)).toEqual({});
    expect(projectSafeMetadata("submit_failed", undefined)).toEqual({});
  });
});
