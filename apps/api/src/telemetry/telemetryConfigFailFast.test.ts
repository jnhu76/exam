import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import { initTelemetry, isTelemetryActive } from "./runtime.js";

/**
 * Fail-fast oracle: an invalid TELEMETRY_* value is operator
 * misconfiguration and must propagate like every other settings leaf —
 * startup fails instead of silently running Off. Owns the process's single
 * init decision (see runtime.ts), hence its own file.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  resetRuntimeConfigForTest();
});

describe("telemetry config fail-fast", () => {
  it("a bad TELEMETRY_SAMPLE_RATIO value fails fast at init", async () => {
    vi.stubEnv("APP_MODE", "development");
    vi.stubEnv("TELEMETRY_ENABLED", "true");
    vi.stubEnv("TELEMETRY_SAMPLE_RATIO", "abc");
    await expect(initTelemetry()).rejects.toThrow(/ratio between 0 and 1/);
    expect(isTelemetryActive()).toBe(false);
  });
});
