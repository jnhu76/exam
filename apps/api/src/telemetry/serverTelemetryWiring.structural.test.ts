import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static wiring contract for the telemetry runtime (ADR-028).
 *
 * The telemetry init ordering is a LOAD-ORDER contract that a behavioral
 * test cannot see from the outside: initTelemetry must run before the
 * Fastify instance is constructed (fastify requires pino lazily inside the
 * constructor — after that require, instrumentation-pino can no longer
 * patch it and correlation silently disappears), and the span-owner plugin
 * must register before any other plugin/route definition (a late
 * registration drops handler spans). These invariants are pinned here by
 * source-order assertions on the single wiring site.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dirname, "../server.ts"), "utf8");
const runtimeSource = readFileSync(join(__dirname, "./runtime.ts"), "utf8");

describe("server.ts telemetry wiring", () => {
  it("initializes telemetry before the Fastify instance is constructed", () => {
    const initIndex = serverSource.indexOf("await initTelemetry()");
    const fastifyIndex = serverSource.indexOf("Fastify({");
    expect(initIndex).toBeGreaterThan(-1);
    expect(fastifyIndex).toBeGreaterThan(initIndex);
  });

  it("registers the span-owner plugin before every other plugin and route surface", () => {
    const pluginRegister = serverSource.indexOf(
      "register(telemetry.fastifyOtelPlugin)",
    );
    const cookieRegister = serverSource.indexOf("register(fastifyCookie)");
    const routesRegister = serverSource.indexOf("register(apiSurfacePlugin");
    expect(pluginRegister).toBeGreaterThan(-1);
    expect(cookieRegister).toBeGreaterThan(pluginRegister);
    expect(routesRegister).toBeGreaterThan(pluginRegister);
  });

  it("flushes telemetry on the shutdown path, after the app close sequence", () => {
    const closeStart = serverSource.indexOf("app.auditWrites.stopAccepting()");
    const flushIndex = serverSource.indexOf("await shutdownTelemetry()");
    const assistIndex = serverSource.indexOf("BOUNDED_EXIT_ASSIST_MS = 2_000");
    expect(flushIndex).toBeGreaterThan(-1);
    expect(flushIndex).toBeGreaterThan(closeStart);
    expect(assistIndex).toBeLessThan(flushIndex);
  });
});

describe("telemetry runtime construction contract", () => {
  it("disables every signal auto-export before the SDK is constructed", () => {
    const envForceIndex = runtimeSource.indexOf(
      'process.env.OTEL_TRACES_EXPORTER = "none"',
    );
    const sdkIndex = runtimeSource.indexOf("new bundle.NodeSDK");
    expect(envForceIndex).toBeGreaterThan(-1);
    expect(sdkIndex).toBeGreaterThan(envForceIndex);
    expect(runtimeSource).toContain(
      'process.env.OTEL_METRICS_EXPORTER = "none"',
    );
    expect(runtimeSource).toContain('process.env.OTEL_LOGS_EXPORTER = "none"');
  });

  it("places the URL scrub processor first in the processor chain", () => {
    const scrubIndex = runtimeSource.indexOf("new UrlScrubSpanProcessor()");
    const batchIndex = runtimeSource.indexOf("new bundle.BatchSpanProcessor(");
    expect(scrubIndex).toBeGreaterThan(-1);
    if (batchIndex !== -1) {
      expect(batchIndex).toBeGreaterThan(scrubIndex);
    }
  });

  it("never ships the experimental ESM loader hook", () => {
    // W1.1 measured the loader breaking the real ESM entry's module linking
    // (--experimental-loader syntax error at boot). The injection stays the
    // in-app early init only.
    expect(serverSource).not.toContain("--experimental-loader");
    expect(runtimeSource).not.toContain("hook.mjs");
  });
});
