import { describe, it, expect } from "vitest";
import {
  ProctorAttemptStatusSchema,
  ProctorAttemptListResponseSchema,
  ProctorAttemptEventSchema,
  ProctorAttemptEventListResponseSchema,
} from "../proctorMonitoring.js";

/** Minimal valid status row. */
function baseStatus(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: "00000000-0000-4000-8000-000000000001",
    candidateId: "00000000-0000-4000-8000-000000000002",
    candidateName: "张三",
    status: "in_progress",
    onlineState: "online",
    lastHeartbeatAt: "2026-06-25T00:00:00.000Z",
    lastSaveAt: null,
    lastClientEventAt: null,
    visibilityLostCount: 0,
    browserOfflineCount: 0,
    saveFailedCount: 0,
    submitFailedCount: 0,
    warningLevel: "normal",
    ...overrides,
  };
}

/** Minimal valid event row. */
function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-00000000000a",
    occurredAt: "2026-06-25T00:00:00.000Z",
    name: "visibility_lost",
    level: "info",
    kind: "exam_telemetry",
    ...overrides,
  };
}

describe("ProctorAttemptStatusSchema", () => {
  it("accepts a minimal valid status", () => {
    expect(ProctorAttemptStatusSchema.safeParse(baseStatus()).success).toBe(
      true,
    );
  });

  it("accepts all onlineState values", () => {
    for (const s of ["online", "stale", "offline"]) {
      expect(
        ProctorAttemptStatusSchema.safeParse(baseStatus({ onlineState: s }))
          .success,
      ).toBe(true);
    }
  });

  it("accepts all warningLevel values", () => {
    for (const w of ["normal", "warning", "critical"]) {
      expect(
        ProctorAttemptStatusSchema.safeParse(baseStatus({ warningLevel: w }))
          .success,
      ).toBe(true);
    }
  });

  it("rejects an invalid onlineState", () => {
    expect(
      ProctorAttemptStatusSchema.safeParse(baseStatus({ onlineState: "maybe" }))
        .success,
    ).toBe(false);
  });

  it("rejects negative counts", () => {
    expect(
      ProctorAttemptStatusSchema.safeParse(baseStatus({ saveFailedCount: -1 }))
        .success,
    ).toBe(false);
  });

  it("accepts null timestamps but rejects garbage", () => {
    expect(
      ProctorAttemptStatusSchema.safeParse(baseStatus({ lastSaveAt: null }))
        .success,
    ).toBe(true);
    expect(
      ProctorAttemptStatusSchema.safeParse(
        baseStatus({ lastSaveAt: "yesterday" }),
      ).success,
    ).toBe(false);
  });
});

describe("ProctorAttemptListResponseSchema", () => {
  it("wraps a list of statuses with a total", () => {
    const result = ProctorAttemptListResponseSchema.safeParse({
      items: [
        baseStatus(),
        baseStatus({ attemptId: "00000000-0000-4000-8000-000000000003" }),
      ],
      total: 2,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a response with non-status items", () => {
    expect(
      ProctorAttemptListResponseSchema.safeParse({
        items: [{ nope: true }],
        total: 1,
      }).success,
    ).toBe(false);
  });
});

describe("ProctorAttemptEventSchema", () => {
  it("accepts a minimal event with allowlisted metadata + source", () => {
    expect(
      ProctorAttemptEventSchema.safeParse(
        baseEvent({
          metadata: { questionId: "q1", durationMs: 120 },
          source: "client_event",
        }),
      ).success,
    ).toBe(true);
  });

  it("accepts audit_log as a source (compliance-derived rows)", () => {
    expect(
      ProctorAttemptEventSchema.safeParse(
        baseEvent({ name: "force_submit", source: "audit_log", metadata: {} }),
      ).success,
    ).toBe(true);
  });

  it("accepts an optional route", () => {
    expect(
      ProctorAttemptEventSchema.safeParse(
        baseEvent({
          route: "/exam/x/take/y",
          metadata: {},
          source: "client_event",
        }),
      ).success,
    ).toBe(true);
  });

  it("requires a source field", () => {
    // baseEvent() does not include source → schema must reject.
    expect(
      ProctorAttemptEventSchema.safeParse(baseEvent({ metadata: {} })).success,
    ).toBe(false);
  });
});

describe("ProctorAttemptEventListResponseSchema", () => {
  it("is a paginated response of events", () => {
    const result = ProctorAttemptEventListResponseSchema.safeParse({
      items: [baseEvent({ metadata: {}, source: "client_event" })],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    expect(result.success).toBe(true);
  });
});
