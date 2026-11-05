import { describe, expect, it } from "vitest";
import { DiagnosticsResponseSchema } from "./system.js";

// #886: the #862 escalation counters must be REQUIRED non-negative integers
// on both scanner blocks of the diagnostics response — a projection the
// route cannot silently omit. Builders take the counter as a param so the
// "field absent" cases are expressed directly (undefined ⇒ key omitted).

function heartbeatStatusBlock(consecutiveFailedTicks?: number) {
  return {
    interval: 30_000,
    timeout: 60_000,
    lastScanAt: null,
    disruptedCount: 0,
    failedCount: 0,
    incidentReconciliationFailedCount: 0,
    ...(consecutiveFailedTicks === undefined ? {} : { consecutiveFailedTicks }),
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

function validDiagnostics(
  heartbeatConsecutive?: number,
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
    heartbeatStatus: heartbeatStatusBlock(heartbeatConsecutive),
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

describe("DiagnosticsResponseSchema consecutiveFailedTicks (#886)", () => {
  it("accepts the two escalation counters and round-trips their values", () => {
    const result = DiagnosticsResponseSchema.safeParse(validDiagnostics(2, 3));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.heartbeatStatus.consecutiveFailedTicks).toBe(2);
      expect(result.data.deadlineScannerStatus.consecutiveFailedTicks).toBe(3);
    }
  });

  it("requires the field on both scanner blocks", () => {
    expect(
      DiagnosticsResponseSchema.safeParse(validDiagnostics(undefined, 0))
        .success,
    ).toBe(false);
    expect(
      DiagnosticsResponseSchema.safeParse(validDiagnostics(0, undefined))
        .success,
    ).toBe(false);
  });

  it("rejects negative and non-integer counters", () => {
    for (const bad of [-1, 1.5]) {
      expect(
        DiagnosticsResponseSchema.safeParse(validDiagnostics(bad, 0)).success,
      ).toBe(false);
      expect(
        DiagnosticsResponseSchema.safeParse(validDiagnostics(0, bad)).success,
      ).toBe(false);
    }
  });
});
