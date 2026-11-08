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

  // Correlation keys (#800 PR-B): the save-error allowlist must project the
  // envelope requestId, the HTTP status, and the save's clientSeq so a
  // proctor-timeline failure row can be correlated with the answer-save
  // receipt row (candidate key — clientSeq is not content identity) and
  // the server-side request log — while non-correlation junk stays dropped.
  it("projects the correlation keys (clientSeq/requestId/status) for save-failure events", () => {
    // requestId sample is a well-formed UUID because that is the ONLY shape
    // the server mints (genReqId — server.ts) and the only shape the
    // projection gate passes (see the shape-gate test below).
    const out = projectSafeMetadata("answer_autosave_failed", {
      questionId: "q1",
      saveMode: "autosave",
      durationMs: 120,
      errorCode: "SAVE_PERSISTENCE_FAILED",
      clientSeq: 3,
      requestId: "1b0e6f2a-9c3d-4e5f-8a7b-6c5d4e3f2a1b",
      status: 500,
      // Non-correlation extras stay dropped by the allowlist itself.
      rawMessage: "internal ooops",
      stack: "Error: ...",
      answer: "SECRET",
    });
    expect(out).toEqual({
      questionId: "q1",
      saveMode: "autosave",
      durationMs: 120,
      errorCode: "SAVE_PERSISTENCE_FAILED",
      clientSeq: 3,
      requestId: "1b0e6f2a-9c3d-4e5f-8a7b-6c5d4e3f2a1b",
      status: 500,
    });
    expect(out).not.toHaveProperty("rawMessage");
    expect(out).not.toHaveProperty("stack");
    expect(out).not.toHaveProperty("answer");
  });

  // Security F2 (#864 §7.4 fix loop): the server mints requestId exclusively
  // as a UUID (genReqId — server.ts), and the authorized timeline renders
  // this allowlist field under 请求编号 semantics. The raw metadata blob is
  // client-owned, so the projection must SHAPE-GATE the claim: only a
  // well-formed UUID string may ride the allowlist; anything else (prose, an
  // oversized payload, someone else's real UUID embedded in text, non-string
  // values) is dropped — the field stays a client-claimed correlation
  // candidate, never a free-form content-injection slot in the investigator
  // view.
  it("shape-gates client-claimed requestId: only a well-formed UUID string is projected", () => {
    const uuid = "3f2b8c9e-1a2b-4c3d-9e8f-7a6b5c4d3e2f";
    // A genuine UUID claim keeps its correlation value.
    expect(
      projectSafeMetadata("answer_autosave_failed", { requestId: uuid }),
    ).toEqual({ requestId: uuid });
    // Prose / legacy-style free text: not projected.
    expect(
      projectSafeMetadata("answer_autosave_failed", {
        requestId: "req-500-abc",
      }),
    ).toEqual({});
    // A foreign real UUID embedded in prose must not slip through either.
    expect(
      projectSafeMetadata("answer_autosave_failed", {
        requestId: `investigate ${uuid} please`,
      }),
    ).toEqual({});
    // Oversized payload (≤32KiB is storable in the jsonb metadata).
    expect(
      projectSafeMetadata("answer_autosave_failed", {
        requestId: "x".repeat(32_768),
      }),
    ).toEqual({});
    // Non-string shapes: not projected.
    expect(
      projectSafeMetadata("answer_autosave_failed", { requestId: 12345 }),
    ).toEqual({});
    expect(
      projectSafeMetadata("answer_autosave_failed", { requestId: null }),
    ).toEqual({});
    expect(
      projectSafeMetadata("answer_autosave_failed", { requestId: true }),
    ).toEqual({});
    // Other allowlisted keys are unaffected by the requestId gate.
    expect(
      projectSafeMetadata("answer_autosave_failed", {
        requestId: "not-a-uuid",
        clientSeq: 7,
      }),
    ).toEqual({ clientSeq: 7 });
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

  // Operator time-grant audit metadata. Projects the non-sensitive
  // correlation/justification fields; drops anything outside the allowlist.
  it("projects allowlisted fields for grant_time and drops the rest", () => {
    const out = projectSafeMetadata("grant_time", {
      adjustmentId: "adj-1",
      operationId: "op-1",
      addedSeconds: 600,
      reasonCode: "technical_incident",
      interruptionId: null,
      // none of these are on the allowlist → dropped
      actorId: "admin-1",
      answer: "SECRET",
      token: "abc",
    });
    expect(out).toEqual({
      adjustmentId: "adj-1",
      addedSeconds: 600,
      reasonCode: "technical_incident",
    });
    expect(out).not.toHaveProperty("operationId");
    expect(out).not.toHaveProperty("actorId");
    expect(out).not.toHaveProperty("answer");
  });
});
