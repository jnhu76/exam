import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { metrics, trace } from "@opentelemetry/api";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import { initTelemetry, shutdownTelemetry } from "./runtime.js";

/**
 * Shutdown deadline oracle (#964 W6, R5 review): with a collector that
 * ACCEPTS OTLP exports but never answers, the whole telemetry shutdown —
 * both provider faces — is bounded by ONE deadline counted from the moment
 * shutdown starts. The former structure raced two SERIAL 3 s bounds
 * (flush first, then sdk.shutdown): the metric face's final export only
 * STARTED after the trace side's race expired (POST /v1/metrics at
 * ≈ t+3 s) and shutdownTelemetry returned at ≈ t+6 s — double the runbook's
 * stated 3 s term.
 *
 * PROCESS BOUNDARY: consumes the process's single init decision, so this
 * file owns exactly one test (one telemetry session per process — see
 * initTelemetry's header).
 */

describe("telemetry shutdown against a hanging collector", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTest();
  });

  it(
    "bounds both provider faces by one deadline and starts them together",
    { timeout: 15_000 },
    async () => {
      const arrivals: { url: string; t: number }[] = [];
      const server = createServer((req, res) => {
        // Accept and record the export, then never answer — the
        // hanging-collector shape (the socket stays open until the test
        // tears the server down).
        req.resume();
        arrivals.push({ url: req.url ?? "", t: Date.now() });
        void res;
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const port = (server.address() as { port: number }).port;

      vi.stubEnv("APP_MODE", "development");
      vi.stubEnv("DATABASE_URL", "postgresql://exam:exam@localhost:5432/exam");
      vi.stubEnv("TELEMETRY_ENABLED", "true");
      vi.stubEnv("TELEMETRY_EXPORTER", "otlp");
      vi.stubEnv("TELEMETRY_OTLP_ENDPOINT", `http://127.0.0.1:${port}`);

      const handle = await initTelemetry();
      expect(handle).not.toBeNull();

      // One queued span and one recorded measurement so both faces have
      // something to export at shutdown.
      trace.getTracer("shutdown-deadline-test").startSpan("probe").end();
      metrics.getMeter("shutdown-deadline-test").createCounter("probe").add(1);

      const t0 = Date.now();
      await shutdownTelemetry();
      const elapsed = Date.now() - t0;

      const traceArrivals = arrivals.filter((a) =>
        a.url.includes("/v1/traces"),
      );
      const metricArrivals = arrivals.filter((a) =>
        a.url.includes("/v1/metrics"),
      );
      // Both faces really exported through shutdown.
      expect(traceArrivals.length).toBeGreaterThan(0);
      expect(metricArrivals.length).toBeGreaterThan(0);
      // Both faces START together: the metric face's final export is never
      // queued behind the trace side's drain (the R5 regression measured
      // it at ≈ +3000 ms after the trace POST).
      const firstTraceArrival = traceArrivals[0]!;
      const firstMetricArrival = metricArrivals[0]!;
      expect(Math.abs(firstMetricArrival.t - firstTraceArrival.t)).toBeLessThan(
        600,
      );
      // ONE shared deadline: the composition returns at ≈ the 3 s bound —
      // never two serial bounds (regression: ≈ 6 s) and never an early
      // abandonment of the exports.
      expect(elapsed).toBeGreaterThanOrEqual(2_500);
      expect(elapsed).toBeLessThanOrEqual(3_600);

      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  );
});
