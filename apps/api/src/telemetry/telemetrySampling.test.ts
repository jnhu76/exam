import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import {
  flushRetainedSpansForDiagnostics,
  getRetainedSpansForDiagnostics,
  initTelemetry,
  shutdownTelemetry,
  type TelemetryRuntimeHandle,
} from "./runtime.js";
import { buildApp, withServer } from "./testHelpers.js";

/**
 * Sampling oracle: `TELEMETRY_SAMPLE_RATIO=0` must sample nothing. One real
 * init session per process (test file) — see telemetrySignals.test.ts.
 */

let handle: TelemetryRuntimeHandle | null = null;

beforeAll(async () => {
  vi.stubEnv("APP_MODE", "development");
  vi.stubEnv("TELEMETRY_ENABLED", "true");
  vi.stubEnv("TELEMETRY_EXPORTER", "memory");
  vi.stubEnv("TELEMETRY_SAMPLE_RATIO", "0");
  resetRuntimeConfigForTest();
  handle = await initTelemetry();
  if (!handle) throw new Error("telemetry session did not start");
});

afterAll(async () => {
  await shutdownTelemetry();
  vi.unstubAllEnvs();
  resetRuntimeConfigForTest();
});

describe("telemetry sampling", () => {
  it("TELEMETRY_SAMPLE_RATIO=0 samples nothing", async () => {
    if (!handle) throw new Error("session not started");
    const harness = await buildApp(handle.fastifyOtelPlugin);
    await withServer(harness, async (base) => {
      const response = await fetch(`${base}/w12/ordinary`);
      expect(response.status).toBe(200);
    });
    await flushRetainedSpansForDiagnostics();
    expect(getRetainedSpansForDiagnostics()).toEqual([]);
  });
});
