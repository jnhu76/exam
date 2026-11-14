import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { metrics, trace } from "@opentelemetry/api";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import { initTelemetry, shutdownTelemetry } from "./runtime.js";

/**
 * OTLP export-path oracle (#964 W6, R6 review): a path-prefixed collector
 * base URL is a valid deployment shape (collector behind a reverse-proxy
 * prefix), and BOTH signals must arrive at `<endpoint>/v1/traces` and
 * `<endpoint>/v1/metrics` — asserted against the REAL request paths the
 * exporter POSTs, not the configured string. The R6 review showed that a
 * query or fragment in the endpoint silently corrupts these request paths
 * while startup still reports telemetry active; those endpoint shapes are
 * rejected at the config layer (see telemetryConfigFailFast.test.ts), and
 * this file pins the valid prefixed shape end-to-end.
 *
 * PROCESS BOUNDARY: consumes the process's single init decision, so this
 * file owns exactly one test (one telemetry session per process — see
 * initTelemetry's header).
 */

describe("otlp export paths for a path-prefixed collector", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTest();
  });

  it(
    "POSTs both signals under the configured path prefix",
    { timeout: 15_000 },
    async () => {
      const arrivals: string[] = [];
      const server = createServer((req, res) => {
        // A healthy collector: record the request path and accept the export.
        arrivals.push(req.url ?? "");
        req.resume();
        res.writeHead(200);
        res.end();
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const port = (server.address() as { port: number }).port;

      vi.stubEnv("APP_MODE", "development");
      vi.stubEnv("DATABASE_URL", "postgresql://exam:exam@localhost:5432/exam");
      vi.stubEnv("TELEMETRY_ENABLED", "true");
      vi.stubEnv("TELEMETRY_EXPORTER", "otlp");
      vi.stubEnv("TELEMETRY_OTLP_ENDPOINT", `http://127.0.0.1:${port}/otlp`);

      const handle = await initTelemetry();
      expect(handle).not.toBeNull();

      // One queued span and one recorded measurement so both signal faces
      // export at shutdown.
      trace.getTracer("export-path-test").startSpan("probe").end();
      metrics.getMeter("export-path-test").createCounter("probe").add(1);

      await shutdownTelemetry();

      // The signal paths are APPENDED to the configured prefix — never glued
      // into a query, never truncated by a fragment.
      expect(arrivals).toContain("/otlp/v1/traces");
      expect(arrivals).toContain("/otlp/v1/metrics");

      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  );
});
