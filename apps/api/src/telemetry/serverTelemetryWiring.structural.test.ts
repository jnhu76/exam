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
const businessSpanSource = readFileSync(
  join(__dirname, "./businessOperationSpan.ts"),
  "utf8",
);
const loopSpanSource = readFileSync(
  join(__dirname, "./backgroundLoopSpan.ts"),
  "utf8",
);
const loopVocabularySource = readFileSync(
  join(__dirname, "./backgroundLoopVocabulary.ts"),
  "utf8",
);
const bundleSource = readFileSync(join(__dirname, "./sdkBundle.ts"), "utf8");

/**
 * The production files allowed to reference the business span helper (the
 * wired critical-operation boundaries, #964 W3). Any NEW span-creation site
 * must extend this list — and the vocabulary — deliberately, not silently.
 */
const BUSINESS_SPAN_CALLER_FILES = [
  "../routes/attempts.candidate.ts",
  "../routes/attempts.admin.ts",
  "../routes/gradingQueue.ts",
  "../plugins/deadlineScanner.ts",
];

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
    const sdkIndex = runtimeSource.indexOf("bundle.startTracing(");
    expect(envForceIndex).toBeGreaterThan(-1);
    expect(sdkIndex).toBeGreaterThan(envForceIndex);
    expect(runtimeSource).toContain(
      'process.env.OTEL_METRICS_EXPORTER = "none"',
    );
    expect(runtimeSource).toContain('process.env.OTEL_LOGS_EXPORTER = "none"');
  });

  it("assembles the SDK from granular packages: sdk-node is banned", () => {
    // #973 P1: @opentelemetry/sdk-node's dependency closure drags the gRPC /
    // Zipkin / Prometheus exporter families (→ @grpc/grpc-js → protobufjs →
    // @types/node) into the production payload, failing the deploy artifact
    // contract's dev-toolchain negative scan. The bundle must not import the
    // meta-package or use its facade, and the runtime must not reference the
    // facade anywhere.
    const specifiers = [
      ...bundleSource.matchAll(/from\s+["']([^"']+)["']/g),
    ].map((match) => match[1]!);
    expect(specifiers).not.toContain("@opentelemetry/sdk-node");
    expect(bundleSource).not.toContain("NodeSDK");
    expect(runtimeSource).not.toContain("NodeSDK");
  });

  it("places the URL scrub processor first in the processor chain", () => {
    const scrubIndex = runtimeSource.indexOf("new UrlScrubSpanProcessor()");
    const batchIndex = runtimeSource.indexOf("new bundle.BatchSpanProcessor(");
    expect(scrubIndex).toBeGreaterThan(-1);
    if (batchIndex !== -1) {
      expect(batchIndex).toBeGreaterThan(scrubIndex);
    }
  });

  it("places the exception scrub second, before every queueing processor", () => {
    // #973 P1: @fastify/otel writes error.message into span.status.message
    // and recordException attaches exception.* text — the exception scrub
    // must run on the live span before any processor queues it, so every
    // exporter (memory now, OTLP later) sees only the scrubbed form.
    const urlScrubIndex = runtimeSource.indexOf("new UrlScrubSpanProcessor()");
    const exceptionScrubIndex = runtimeSource.indexOf(
      "new ExceptionScrubSpanProcessor()",
    );
    const batchIndex = runtimeSource.indexOf("new bundle.BatchSpanProcessor(");
    expect(urlScrubIndex).toBeGreaterThan(-1);
    expect(exceptionScrubIndex).toBeGreaterThan(urlScrubIndex);
    if (batchIndex !== -1) {
      expect(batchIndex).toBeGreaterThan(exceptionScrubIndex);
    }
  });

  it("never ships the experimental ESM loader hook", () => {
    // W1.1 measured the loader breaking the real ESM entry's module linking
    // (--experimental-loader syntax error at boot). The injection stays the
    // in-app early init only.
    expect(serverSource).not.toContain("--experimental-loader");
    expect(runtimeSource).not.toContain("hook.mjs");
  });

  it("loads the DB telemetry plugin only inside the On-path SDK start, before fastify exists", () => {
    // #964 W2: the plugin installs a driver prototype patch (reversible
    // since #974) — the Off deployment must never even import it. The only
    // reference is the dynamic import inside startSdk (after the SDK is up —
    // the granular `bundle.startTracing(` — before the fastify plugin is
    // built), and its seam registration must sit in the same On-path block.
    const dynamicImportIndex = runtimeSource.indexOf(
      'await import("@exam/otel-drizzle-postgresjs")',
    );
    expect(dynamicImportIndex).toBeGreaterThan(-1);
    expect(runtimeSource).not.toMatch(
      /from ["']@exam\/otel-drizzle-postgresjs["']/,
    );
    const sdkStartIndex = runtimeSource.indexOf("bundle.startTracing(");
    const seamIndex = runtimeSource.indexOf(
      "setTransactionSeam(dbTelemetry.transactionSeam)",
    );
    const fastifyIndex = runtimeSource.indexOf(
      "bundle.createFastifyInstrumentation()",
    );
    expect(sdkStartIndex).toBeGreaterThan(-1);
    expect(dynamicImportIndex).toBeGreaterThan(sdkStartIndex);
    expect(seamIndex).toBeGreaterThan(dynamicImportIndex);
    expect(fastifyIndex).toBeGreaterThan(seamIndex);
  });

  it("stops DB telemetry recording before the shutdown flush", () => {
    const disableIndex = runtimeSource.indexOf("current.dbTelemetry.disable()");
    const seamClearIndex = runtimeSource.indexOf("setTransactionSeam(null);");
    const flushIndex = runtimeSource.indexOf("if (current.flush) {");
    expect(disableIndex).toBeGreaterThan(-1);
    expect(seamClearIndex).toBeGreaterThan(-1);
    expect(disableIndex).toBeLessThan(flushIndex);
    expect(seamClearIndex).toBeLessThan(flushIndex);
  });
});

describe("business operation span wiring (#964 W3)", () => {
  it("creates spans only through the single helper — no second span-creation site", () => {
    // The only startActiveSpan/startSpan call sites in production src are the
    // business helper (below), the W4 loop helper, and the W1 sdkBundle/W2
    // plugin internals. Route code must never create spans directly — it
    // wires the helper at the existing boundaries.
    expect(businessSpanSource).toContain("tracer.startActiveSpan(");
    expect(businessSpanSource).not.toContain('from "./sdkBundle.js"');
    expect(businessSpanSource).not.toContain(
      'import("@exam/otel-drizzle-postgresjs")',
    );
  });

  it("wires the critical operations at the existing HTTP/background boundaries", () => {
    for (const caller of BUSINESS_SPAN_CALLER_FILES) {
      const source = readFileSync(join(__dirname, caller), "utf8");
      expect(
        source.includes("withBusinessOperationSpan("),
        `${caller} must wire business spans through the shared helper`,
      ).toBe(true);
      expect(
        source.includes("startActiveSpan("),
        `${caller} must not create spans directly`,
      ).toBe(false);
    }
  });

  it("keeps the API-facade import contained to the API telemetry span helpers", () => {
    // Off-state module-graph contract (businessOperationSpan.ts and
    // backgroundLoopSpan.ts headers): the API-only @opentelemetry/api facade
    // is statically imported by EXACTLY these two production modules; the
    // runtime and everything else loads it only dynamically (or not at all).
    expect(runtimeSource).not.toMatch(/from ["']@opentelemetry\/api["']/);
    for (const allowed of [
      "./businessOperationSpan.ts",
      "./backgroundLoopSpan.ts",
    ]) {
      expect(readFileSync(join(__dirname, allowed), "utf8")).toMatch(
        /from ["']@opentelemetry\/api["']/,
      );
    }
  });
});

describe("single technical-signal owner (#964 W7.1)", () => {
  it("keeps @fastify/otel as the only HTTP SERVER span owner", () => {
    // W1.1 measured dual instrumentation emitting 2 server spans per request;
    // ADR-028 §3 table two forbids it. HTTP instrumentation remains registered
    // for outbound client spans/propagation only.
    expect(bundleSource).toContain(
      "disableIncomingRequestInstrumentation: true",
    );
    expect(runtimeSource).toContain("bundle.createHttpInstrumentation()");
    expect(runtimeSource).toContain("bundle.createFastifyInstrumentation()");
    expect(runtimeSource).not.toContain("registerOnInitialization");
  });

  it("keeps Pino as the only server log API with log sending disabled", () => {
    // Correlation only: instrumentation-pino injects trace_id/span_id into
    // stdout; it never becomes a second remote log path (ADR-028 D3).
    expect(bundleSource).toContain(
      "new PinoInstrumentation({ disableLogSending: true })",
    );
    expect(runtimeSource).toContain('process.env.OTEL_LOGS_EXPORTER = "none"');
    expect(runtimeSource).not.toContain("logRecordProcessors");
  });
});

describe("background loop span wiring (#964 W4)", () => {
  const LOOP_CALLER_FILES = [
    "../plugins/deadlineScanner.ts",
    "../plugins/heartbeat.ts",
    "../plugins/clientEventRetention.ts",
    "../plugins/emailOutboxLoop.ts",
  ];

  it("resolves cycle span names only through the frozen loop→span bijection", () => {
    // The helper takes a closed BackgroundLoopName and resolves the span
    // name through SPAN_NAME_BY_LOOP — a call site cannot invent a name.
    expect(loopSpanSource).toContain("SPAN_NAME_BY_LOOP[loop]");
    expect(loopSpanSource).toContain("tracer.startActiveSpan(");
    // The bijection is total over the four frozen loop constants.
    for (const loop of [
      "LOOP_HEARTBEAT",
      "LOOP_DEADLINE_SCANNER",
      "LOOP_CLIENT_EVENT_RETENTION",
      "LOOP_EMAIL_OUTBOX",
    ]) {
      expect(loopVocabularySource).toContain(`[${loop}]:`);
    }
  });

  it("wires every background loop through the shared cycle helper", () => {
    for (const caller of LOOP_CALLER_FILES) {
      const source = readFileSync(join(__dirname, caller), "utf8");
      expect(
        source.includes("withLoopCycleSpan("),
        `${caller} must wire its cycle through the shared loop helper`,
      ).toBe(true);
      expect(
        source.includes("startActiveSpan("),
        `${caller} must not create spans directly`,
      ).toBe(false);
    }
  });
});
