import { describe, expect, it } from "vitest";
import { DiagnosticsResponseSchema } from "./system.js";

// #886: the #862 escalation counters must be REQUIRED non-negative integers
// on both scanner blocks of the diagnostics response — a projection the
// route cannot silently omit. Builders take the counter as a param so the
// "field absent" cases are expressed directly (undefined ⇒ key omitted).
//
// #1004: the heartbeat incident counters
// (`incidentCreatedCount` / `incidentConflictCount`) are the read-only
// projection of the plugin-owned `heartbeatMetrics` cumulative counters, so
// they are REQUIRED non-negative integers on the heartbeat block as well.

interface HeartbeatBlockOverrides {
  consecutiveFailedTicks?: number;
  /** Drop the #886 escalation counter to express "field absent" directly. */
  omitConsecutiveFailedTicks?: boolean;
  incidentCreatedCount?: number;
  incidentConflictCount?: number;
  /** Drop BOTH #1004 counters to express the "field absent" case directly. */
  omitIncidentCounters?: boolean;
}

function heartbeatStatusBlock(overrides: HeartbeatBlockOverrides = {}) {
  const {
    consecutiveFailedTicks = 0,
    omitConsecutiveFailedTicks = false,
    incidentCreatedCount = 0,
    incidentConflictCount = 0,
    omitIncidentCounters = false,
  } = overrides;
  return {
    interval: 30_000,
    timeout: 60_000,
    lastScanAt: null,
    disruptedCount: 0,
    failedCount: 0,
    incidentReconciliationFailedCount: 0,
    ...(omitIncidentCounters
      ? {}
      : { incidentCreatedCount, incidentConflictCount }),
    ...(omitConsecutiveFailedTicks ? {} : { consecutiveFailedTicks }),
    startedAt: null,
    lastStartedAt: null,
    lastSettledAt: null,
    activeSince: null,
    stallState: "warming" as const,
  };
}

function deadlineScannerStatusBlock(consecutiveFailedTicks?: number) {
  return {
    interval: 30_000,
    lastScanAt: null,
    autoSubmitCount: 0,
    failedCount: 0,
    ...(consecutiveFailedTicks === undefined ? {} : { consecutiveFailedTicks }),
    startedAt: null,
    lastStartedAt: null,
    lastSettledAt: null,
    activeSince: null,
    stallState: "warming" as const,
  };
}

/** Returns a copy of `obj` with `key` removed (typed, no unused bindings). */
function withoutKey<T extends object, K extends keyof T>(
  obj: T,
  key: K,
): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

function validDiagnostics(
  heartbeat: HeartbeatBlockOverrides = {},
  scannerConsecutive?: number,
) {
  return {
    version: "0.0.0",
    uptime: 1,
    dbLatency: 1,
    redisStatus: {
      mode: "off" as const,
      state: "disabled" as const,
      connected: false,
      latencyMs: null,
      degradedReason: null,
    },
    heartbeatStatus: heartbeatStatusBlock(heartbeat),
    deadlineScannerStatus: deadlineScannerStatusBlock(scannerConsecutive),
    emailStatus: {
      status: "disabled" as const,
      enabled: false,
      worker: {
        status: "disabled" as const,
        lastPollAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
      },
      outbox: { pending: 0, processing: 0, retryWait: 0, sent: 0, dead: 0 },
      oldestPendingAge: null,
      lastSuccessfulDeliveryAt: null,
    },
    config: {
      heartbeatInterval: 30_000,
      heartbeatTimeout: 60_000,
      deadlineScanInterval: 30_000,
    },
  };
}

/** Replaces the heartbeat block on an otherwise-valid payload. */
function diagnosticsWithHeartbeat(heartbeatStatus: unknown) {
  return { ...validDiagnostics({}, 0), heartbeatStatus };
}

describe("DiagnosticsResponseSchema consecutiveFailedTicks (#886)", () => {
  it("accepts the two escalation counters and round-trips their values", () => {
    const result = DiagnosticsResponseSchema.safeParse(
      validDiagnostics({ consecutiveFailedTicks: 2 }, 3),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.heartbeatStatus.consecutiveFailedTicks).toBe(2);
      expect(result.data.deadlineScannerStatus.consecutiveFailedTicks).toBe(3);
    }
  });

  it("requires the field on both scanner blocks", () => {
    expect(
      DiagnosticsResponseSchema.safeParse(
        validDiagnostics({ omitConsecutiveFailedTicks: true }, 0),
      ).success,
    ).toBe(false);
    expect(
      DiagnosticsResponseSchema.safeParse(
        validDiagnostics({ consecutiveFailedTicks: 0 }, undefined),
      ).success,
    ).toBe(false);
  });

  it("rejects negative and non-integer counters", () => {
    for (const bad of [-1, 1.5]) {
      expect(
        DiagnosticsResponseSchema.safeParse(
          validDiagnostics({ consecutiveFailedTicks: bad }, 0),
        ).success,
      ).toBe(false);
      expect(
        DiagnosticsResponseSchema.safeParse(
          validDiagnostics({ consecutiveFailedTicks: 0 }, bad),
        ).success,
      ).toBe(false);
    }
  });
});

describe("DiagnosticsResponseSchema heartbeat incident counters (#1004)", () => {
  it("accepts both incident counters and round-trips their values", () => {
    const result = DiagnosticsResponseSchema.safeParse(
      validDiagnostics(
        { incidentCreatedCount: 7, incidentConflictCount: 2 },
        0,
      ),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.heartbeatStatus.incidentCreatedCount).toBe(7);
      expect(result.data.heartbeatStatus.incidentConflictCount).toBe(2);
    }
  });

  it("requires both incident counters — the projection cannot be silently omitted", () => {
    const block = heartbeatStatusBlock();
    expect(
      DiagnosticsResponseSchema.safeParse(
        diagnosticsWithHeartbeat(
          heartbeatStatusBlock({ omitIncidentCounters: true }),
        ),
      ).success,
    ).toBe(false);
    expect(
      DiagnosticsResponseSchema.safeParse(
        diagnosticsWithHeartbeat(withoutKey(block, "incidentCreatedCount")),
      ).success,
    ).toBe(false);
    expect(
      DiagnosticsResponseSchema.safeParse(
        diagnosticsWithHeartbeat(withoutKey(block, "incidentConflictCount")),
      ).success,
    ).toBe(false);
  });

  it("rejects negative and non-integer incident counters independently", () => {
    for (const bad of [-1, 1.5]) {
      expect(
        DiagnosticsResponseSchema.safeParse(
          validDiagnostics({ incidentCreatedCount: bad }, 0),
        ).success,
      ).toBe(false);
      expect(
        DiagnosticsResponseSchema.safeParse(
          validDiagnostics({ incidentConflictCount: bad }, 0),
        ).success,
      ).toBe(false);
    }
  });

  it("keeps created and conflict counts independently represented", () => {
    const onlyCreated = DiagnosticsResponseSchema.safeParse(
      validDiagnostics(
        { incidentCreatedCount: 5, incidentConflictCount: 0 },
        0,
      ),
    );
    expect(onlyCreated.success).toBe(true);
    if (onlyCreated.success) {
      expect(onlyCreated.data.heartbeatStatus.incidentCreatedCount).toBe(5);
      expect(onlyCreated.data.heartbeatStatus.incidentConflictCount).toBe(0);
    }

    const onlyConflict = DiagnosticsResponseSchema.safeParse(
      validDiagnostics(
        { incidentCreatedCount: 0, incidentConflictCount: 9 },
        0,
      ),
    );
    expect(onlyConflict.success).toBe(true);
    if (onlyConflict.success) {
      expect(onlyConflict.data.heartbeatStatus.incidentCreatedCount).toBe(0);
      expect(onlyConflict.data.heartbeatStatus.incidentConflictCount).toBe(9);
    }
  });

  it("accepts large cumulative counters (process-lifetime, unbounded integers)", () => {
    const result = DiagnosticsResponseSchema.safeParse(
      validDiagnostics(
        {
          incidentCreatedCount: 2_147_483_647,
          incidentConflictCount: 1_000_000_000,
        },
        0,
      ),
    );
    expect(result.success).toBe(true);
  });
});
