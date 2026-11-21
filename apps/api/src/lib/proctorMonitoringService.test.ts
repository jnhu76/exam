import { describe, it, expect, vi } from "vitest";
import type { RequestContext } from "@exam/domain";
import type { Database } from "@exam/db/types";
import type { ClientEventTimelineRow } from "@exam/db/repository/clientEventRepo";
import {
  buildProctorAttemptEventTimeline,
  classifyOnlineState,
  computeWarningLevel,
  projectSafeMetadata,
} from "./proctorMonitoringService.js";
import {
  ClientEventSchema,
  MONITORING_ONLINE_THRESHOLD_MS,
  MONITORING_OFFLINE_THRESHOLD_MS,
} from "@exam/contracts";

const NOW = new Date("2026-06-25T12:00:00.000Z");
const heart = (secondsAgo: number) =>
  new Date(NOW.getTime() - secondsAgo * 1000);

// Repo-boundary mocks for the timeline assembly tests below. The real
// SQL/route semantics (authorization, K-way pagination, µs merge keys) are
// covered by the real-PostgreSQL route suites (proctorMonitoring*.test.ts);
// these mocks exist only to feed a synthetic poison row through the service's
// projection/merge/slice path.
const timelineRepoMocks = vi.hoisted(() => ({
  countByAttempt: vi.fn(),
  listTimelinePrefixByAttempt: vi.fn(),
  countFilteredByActions: vi.fn(),
  listTimelinePrefixByActions: vi.fn(),
}));

vi.mock("@exam/db/repository/clientEventRepo", () => ({
  createClientEventRepo: () => ({
    countByAttempt: timelineRepoMocks.countByAttempt,
    listTimelinePrefixByAttempt: timelineRepoMocks.listTimelinePrefixByAttempt,
  }),
}));

vi.mock("@exam/db/repository/auditLogRepo", () => ({
  createAuditLogRepo: () => ({
    countFilteredByActions: timelineRepoMocks.countFilteredByActions,
    listTimelinePrefixByActions: timelineRepoMocks.listTimelinePrefixByActions,
  }),
}));

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

  // R-PLT-1 (#1057): the allowlist is indexed by the client-controllable
  // event name. The names below pass the write-side contracts regex and are
  // persistable by any authenticated candidate against their own attempt, but
  // on a plain-object allowlist they resolve to inherited Object.prototype
  // members instead of an own entry (e.g. `constructor` is the Object
  // function, whose .length === 1 slips past the empty-allowlist guard).
  // INVARIANT: an inherited-member name is just another unknown name — it
  // must take the same default-deny branch and return empty metadata, never
  // hand a non-array value to the field loop.
  it("returns empty metadata for prototype-key event names (default-deny, no throw)", () => {
    for (const name of [
      "constructor",
      "hasOwnProperty",
      "isPrototypeOf",
      "propertyIsEnumerable",
    ]) {
      expect(projectSafeMetadata(name, { answer: "x", token: "abc" })).toEqual(
        {},
      );
      expect(projectSafeMetadata(name, null)).toEqual({});
    }
  });

  // Reachability premise pinned at the same layer: these names satisfy the
  // contracts name regex, so the write path persists them verbatim and the
  // projection above is fed from real rows.
  it("write-side name schema admits prototype-key names (entry fact, not the fix owner)", () => {
    for (const name of ["constructor", "hasOwnProperty"]) {
      const parsed = ClientEventSchema.safeParse({
        kind: "proctor",
        level: "info",
        name,
        occurredAt: "2026-06-25T12:00:00.000Z",
      });
      expect(parsed.success).toBe(true);
    }
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

// R-PLT-1 (#1057) acceptance: a persisted client event whose name collides
// with an Object.prototype member must not break the merged timeline read.
// The poison row is the newest client row (server receivedAt), so it sits in
// every page's prefix window — the exact position that 500-ed all pages
// before the own-key projection.
describe("buildProctorAttemptEventTimeline (synthetic poison row)", () => {
  const ctx: RequestContext = {
    actorId: "proctor-1",
    organizationId: "org-1",
    role: "Proctor",
    permissions: [],
    sessionId: "session-1",
  };

  const poisonRow: ClientEventTimelineRow & { sortKeyUs: number } = {
    id: "11111111-1111-4111-8111-111111111111",
    occurredAt: "2026-06-25T11:59:59.000Z",
    receivedAt: new Date("2026-06-25T12:00:02.000Z"),
    name: "constructor",
    level: "info",
    kind: "proctor",
    route: null,
    metadata: { answer: "SECRET", token: "abc" },
    sortKeyUs: 1_725_000_002_000_000,
  };
  const saveFailedRow: ClientEventTimelineRow & { sortKeyUs: number } = {
    id: "22222222-2222-4222-8222-222222222222",
    occurredAt: "2026-06-25T11:59:58.000Z",
    receivedAt: new Date("2026-06-25T12:00:01.000Z"),
    name: "submit_failed",
    level: "error",
    kind: "proctor",
    route: null,
    metadata: { durationMs: 42, errorCode: "NETWORK", answer: "SECRET" },
    sortKeyUs: 1_725_000_001_000_000,
  };
  // Only the fields the timeline assembly reads; the mocked factory does not
  // validate against the full audit_logs row type.
  const auditRow = {
    auditLog: {
      id: "33333333-3333-4333-8333-333333333333",
      action: "attempt.forceSubmit",
      createdAt: new Date("2026-06-25T12:00:03.000Z"),
      metadata: {},
    },
    actorName: null,
    sortKeyUs: 1_725_000_003_000_000,
  };

  it("keeps the merged timeline readable and paginated", async () => {
    timelineRepoMocks.countByAttempt.mockResolvedValue(2);
    timelineRepoMocks.countFilteredByActions.mockResolvedValue(1);
    timelineRepoMocks.listTimelinePrefixByAttempt.mockImplementation(
      async (_ctx: unknown, _attemptId: string, prefixSize: number) =>
        [poisonRow, saveFailedRow].slice(0, prefixSize),
    );
    timelineRepoMocks.listTimelinePrefixByActions.mockImplementation(
      async (
        _ctx: unknown,
        _filter: unknown,
        _actions: string[],
        prefixSize: number,
      ) => [auditRow].slice(0, prefixSize),
    );

    // The mocked factories never read db; the real ones are covered by the
    // real-PostgreSQL route suites.
    const db = {} as Database;

    const page1 = await buildProctorAttemptEventTimeline(db, ctx, "attempt-1", {
      limit: 2,
      page: 1,
    });
    expect(page1.total).toBe(3);
    expect(page1.totalPages).toBe(2);
    expect(page1.items.map((item) => item.id)).toEqual([
      auditRow.auditLog.id,
      poisonRow.id,
    ]);
    // The poison row survives projection with default-deny metadata: no throw,
    // and none of its raw client payload is projected.
    expect(page1.items[1]!.name).toBe("constructor");
    expect(page1.items[1]!.metadata).toEqual({});

    const page2 = await buildProctorAttemptEventTimeline(db, ctx, "attempt-1", {
      limit: 2,
      page: 2,
    });
    expect(page2.items.map((item) => item.id)).toEqual([saveFailedRow.id]);
    // Legal projection is unchanged by the own-key guard.
    expect(page2.items[0]!.metadata).toEqual({
      durationMs: 42,
      errorCode: "NETWORK",
    });
  });
});
