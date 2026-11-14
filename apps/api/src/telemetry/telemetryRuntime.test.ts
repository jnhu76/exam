import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import {
  initTelemetry,
  isTelemetryActive,
  shutdownTelemetry,
} from "./runtime.js";

/**
 * Off-state oracle for the telemetry runtime (ADR-028, default Off).
 *
 * PROCESS BOUNDARY: the runtime makes ONE init decision per process and
 * shutdown is terminal (see runtime.ts). Every state that consumes the
 * decision owns its own test file; this file only proves Off shapes — Off
 * is itself a decision, so the fail-fast config test runs LAST after all
 * Off inits are done.
 */

function stubEnv(extra: Record<string, string>): void {
  vi.stubEnv("APP_MODE", "development");
  for (const [key, value] of Object.entries(extra)) {
    vi.stubEnv(key, value);
  }
}

beforeEach(() => {
  resetRuntimeConfigForTest();
});

afterEach(async () => {
  await shutdownTelemetry();
  vi.unstubAllEnvs();
  resetRuntimeConfigForTest();
});

describe("telemetry runtime Off state", () => {
  it("Off: returns null, registers nothing, and never touches the OTEL_* env surface", async () => {
    stubEnv({});
    const before = {
      traces: process.env.OTEL_TRACES_EXPORTER,
      metrics: process.env.OTEL_METRICS_EXPORTER,
      logs: process.env.OTEL_LOGS_EXPORTER,
    };
    const handle = await initTelemetry();
    expect(handle).toBeNull();
    expect(isTelemetryActive()).toBe(false);
    expect(process.env.OTEL_TRACES_EXPORTER).toBe(before.traces);
    expect(process.env.OTEL_METRICS_EXPORTER).toBe(before.metrics);
    expect(process.env.OTEL_LOGS_EXPORTER).toBe(before.logs);
  });

  it("Off is idempotent: repeated init keeps returning null", async () => {
    stubEnv({});
    expect(await initTelemetry()).toBeNull();
    expect(await initTelemetry()).toBeNull();
    expect(isTelemetryActive()).toBe(false);
  });

  it("shutdown without a live SDK is a no-op that never throws", async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
    expect(isTelemetryActive()).toBe(false);
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});
