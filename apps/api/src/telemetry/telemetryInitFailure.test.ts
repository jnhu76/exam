import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import { initTelemetry, isTelemetryActive } from "./runtime.js";

/**
 * Degradation oracle: SDK bundle load failure must degrade to Off with a
 * structured stderr event, never crash startup (ADR-028 D1 — telemetry
 * failures cannot change business results).
 *
 * PROCESS BOUNDARY: this file consumes the process's single init decision
 * (the failure counts as attempted), so it owns no other init-state tests.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("./sdkBundle.js");
  vi.resetModules();
  vi.unstubAllEnvs();
  resetRuntimeConfigForTest();
});

describe("telemetry init degradation", () => {
  it("degrades to Off with a structured stderr event when the SDK bundle fails to load", async () => {
    vi.doMock("./sdkBundle.js", () => {
      throw new Error("synthetic-sdk-unavailable");
    });
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });
    vi.stubEnv("APP_MODE", "development");
    vi.stubEnv("TELEMETRY_ENABLED", "true");
    vi.stubEnv("TELEMETRY_EXPORTER", "memory");

    const handle = await initTelemetry();
    expect(handle).toBeNull();
    expect(isTelemetryActive()).toBe(false);

    const eventLine = stderrChunks.find((line) =>
      line.includes("telemetry.init_failed"),
    );
    expect(eventLine).toBeDefined();
    expect(eventLine).toContain('"event":"telemetry.init_failed"');
    // The reason is whatever the loader threw (here the module loader's own
    // failure message); the event only has to carry it verbatim.
    const reason = (JSON.parse(eventLine!) as { reason: string }).reason;
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
    // No retry inside the process lifetime: the decision was made.
    expect(await initTelemetry()).toBeNull();
  });
});
