import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import { initTelemetry } from "./runtime.js";

/**
 * Diagnostic-hygiene oracle for the init-failure event: the structured
 * telemetry.init_failed line must never echo the configured OTLP endpoint
 * (deploy topology — and a credential-bearing URL must never reach a log
 * line; the config layer rejects those, the event redacts any
 * endpoint-bearing SDK message regardless).
 *
 * PROCESS BOUNDARY: consumes the process's single init decision, so this
 * file owns exactly one test (one telemetry session per process — see
 * initTelemetry's header).
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("./sdkBundle.js");
  vi.resetModules();
  vi.unstubAllEnvs();
  resetRuntimeConfigForTest();
});

describe("telemetry init diagnostics", () => {
  it("the init-failure event never echoes the configured OTLP endpoint", async () => {
    vi.doMock("./sdkBundle.js", () => ({
      BatchSpanProcessor: class {},
      // Real exporter-construction failures echo the URL they were built
      // from — this seam is exactly where an endpoint-bearing message can
      // enter the init-failure event.
      createOtlpSpanExporter: () => {
        throw new Error(
          "synthetic exporter failure while dialing http://collector:4318/v1/traces",
        );
      },
    }));
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });
    vi.stubEnv("APP_MODE", "development");
    vi.stubEnv("TELEMETRY_ENABLED", "true");
    vi.stubEnv("TELEMETRY_EXPORTER", "otlp");
    vi.stubEnv("TELEMETRY_OTLP_ENDPOINT", "http://collector:4318");

    const handle = await initTelemetry();
    expect(handle).toBeNull();

    const eventLine = stderrChunks.find((line) =>
      line.includes("telemetry.init_failed"),
    );
    expect(eventLine).toBeDefined();
    const reason = (JSON.parse(eventLine!) as { reason: string }).reason;
    // Deploy topology (and any secret a malformed URL might carry) must not
    // enter the diagnostic event: the endpoint substring is replaced, the
    // rest of the message survives verbatim.
    expect(reason).not.toContain("http://collector:4318");
    expect(reason).toContain("synthetic exporter failure while dialing");
    expect(reason).toContain("<otlp-endpoint>/v1/traces");
  });
});
