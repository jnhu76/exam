import { appendFileSync } from "node:fs";
import type { FastifyPluginCallback } from "fastify";
import {
  getRuntimeConfig,
  type TelemetryConfig,
} from "../config/runtimeConfig.js";
import {
  BoundedMemorySpanExporter,
  type RetainedSpan,
} from "./boundedMemorySpanExporter.js";
import { ServerRootPropagator } from "./serverRootPropagator.js";
import { UrlScrubSpanProcessor } from "./urlScrubSpanProcessor.js";

/**
 * Technical telemetry runtime (ADR-028, default Off).
 *
 * Lifecycle contract:
 * - **Off** (`TELEMETRY_ENABLED` unset/empty/false — the deployment default):
 *   {@link initTelemetry} returns before ANY telemetry module is loaded.
 *   The dynamic `import("./sdkBundle.js")` never executes, so no OTel
 *   package, instrumentation, export task, or network surface exists in the
 *   process (W1.1 measured the Off state: zero spans, zero connections to
 *   the collector port, unmodified exit).
 * - **On**: the SDK is assembled from granular OTel packages with explicit
 *   per-signal configuration (sdkBundle.ts startTracing — no auto-configure
 *   facade), and every signal's exporter env is additionally pinned to
 *   `none` before construction (W1.1 probe F4/S8: the default OTLP exporter
 *   dials localhost:4318; the explicit env decision keeps that surface at
 *   zero for any OTel library that consults the env). There is no remote
 *   exporter at the API runtime layer; OTLP enablement is a W6 deployment
 *   concern that must extend THIS wiring, not bypass it.
 * - **Degraded**: any SDK construction/start failure is contained — a
 *   structured warn event goes to stderr and the process continues with
 *   telemetry Off. Telemetry failures never change business results
 *   (ADR-028 D1), and re-running {@link initTelemetry} after a failure does
 *   not retry inside the same process lifetime.
 *
 * Ordering contract (INVARIANT, pinned by
 * serverTelemetryWiring.structural.test.ts): {@link initTelemetry} MUST run
 * before the Fastify instance is constructed. fastify 5.8.5 requires pino
 * lazily inside the `Fastify()` constructor (lib/logger-factory.js →
 * lib/logger-pino.js), so initializing before that construction is what
 * lets instrumentation-pino's require-hook patch pino before it loads —
 * after it, the correlation fields silently never appear. The experimental
 * ESM loader hook is NOT an alternative: it breaks the real ESM entry's
 * module linking (W1.1 probe F3).
 */

/**
 * Shutdown flush budget. One best-effort term appended to the #351 shutdown
 * sequence (loop 8s + audit 10s + DB 10s + exit assist 2s + this bound);
 * the flush runs concurrently AFTER app.close() settles, and the race bound
 * keeps a stuck exporter from extending the bounded shutdown.
 */
const SHUTDOWN_FLUSH_TIMEOUT_MS = 3_000;

/**
 * Defined bounds of the batch export queue (the SDK defaults, written down
 * so the queue is bounded BY CONTRACT, not by accident — ADR-028 D1).
 */
const BATCH_QUEUE_BOUNDS = {
  maxQueueSize: 2048,
  scheduledDelayMillis: 5_000,
  exportTimeoutMillis: 30_000,
  maxExportBatchSize: 512,
} as const;

interface ActiveTelemetry {
  sdk: { shutdown: () => Promise<void> };
  /** Batch-queue flush (null when there is no batch processor). */
  flush: (() => Promise<void>) | null;
  fastifyOtelPlugin: FastifyPluginCallback;
  memoryExporter: BoundedMemorySpanExporter | null;
  /** Witness dump path captured at init; empty string = disabled. */
  memoryDumpFile: string;
}

let active: ActiveTelemetry | null = null;
let initAttempted = false;

/** A registered plugin for the server entry, or null when telemetry is Off. */
export interface TelemetryRuntimeHandle {
  fastifyOtelPlugin: FastifyPluginCallback;
}

/** Whether a telemetry SDK is live in this process. */
export function isTelemetryActive(): boolean {
  return active !== null;
}

/**
 * Witness accessor for the retained (scrubbed) spans of the memory
 * exporter, or null when telemetry is Off or the exporter is `none`.
 * Test/diagnostics surface — never a delivery path.
 */
export function getRetainedSpansForDiagnostics(): readonly RetainedSpan[] {
  return active?.memoryExporter?.getRetainedSpans() ?? [];
}

/**
 * Flush the batch export queue into the witness buffer. Bounded and
 * never-throwing, exactly like the shutdown flush — the companion of
 * {@link getRetainedSpansForDiagnostics} for any consumer that must read
 * spans before shutdown (tests; a future diagnostics projection).
 */
export async function flushRetainedSpansForDiagnostics(): Promise<void> {
  const current = active;
  if (!current?.flush) return;
  try {
    await Promise.race([
      current.flush(),
      new Promise<void>((resolve) =>
        setTimeout(resolve, SHUTDOWN_FLUSH_TIMEOUT_MS).unref(),
      ),
    ]);
  } catch {
    // Flush failure is telemetry-internal; the reader sees what landed.
  }
}

/**
 * Initialize technical telemetry. One decision per process: the first call
 * fixes the lifetime — later calls return the same handle (repeat init), or
 * null once Off, degraded, or shut down (PROTOCOL: the OTel API registers
 * its global provider ONE-WAY per process — `registerGlobal` in
 * @opentelemetry/api refuses duplicate registration — so a post-shutdown
 * re-init would silently produce no signals; shutdown is therefore
 * terminal, and tests prove one session per process, one file each).
 *
 * Fail-fast boundary: application CONFIG errors propagate (consistent with
 * every other settings leaf — a bad `TELEMETRY_*` value must not silently
 * disable the feature the operator asked for). SDK RUNTIME failures are
 * contained and degrade to Off for the process lifetime.
 */
export async function initTelemetry(): Promise<TelemetryRuntimeHandle | null> {
  if (active) return { fastifyOtelPlugin: active.fastifyOtelPlugin };
  if (initAttempted) return null;
  initAttempted = true;

  const config = getRuntimeConfig().telemetry;
  if (!config.enabled) return null;

  try {
    active = await startSdk(config);
    return { fastifyOtelPlugin: active.fastifyOtelPlugin };
  } catch (err) {
    // Structured stderr event, not app.log: at init time no fastify logger
    // exists yet (same rationale as the runtimeConfig email-mode guard).
    // Shape mirrors the operability.* bounded events.
    process.stderr.write(
      `${JSON.stringify({
        event: "telemetry.init_failed",
        reason: err instanceof Error ? err.message : String(err),
      })}\n`,
    );
    return null;
  }
}

/**
 * Flush and shut down telemetry. Best-effort and exit-neutral by contract:
 * called after the app has closed, bounded by a timeout race, never throws,
 * never sets the process exit code. Idempotent (repeat calls are no-ops).
 * TERMINAL for the process: a later {@link initTelemetry} returns null (see
 * its header — the API's one-way global registration).
 */
export async function shutdownTelemetry(): Promise<void> {
  const current = active;
  active = null;
  initAttempted = true;
  if (!current) return;

  // Flush the batch queue FIRST so the witness dump sees every span the
  // process produced; both flush and shutdown are bounded races so a stuck
  // exporter can never extend the #351 shutdown budget.
  if (current.flush) {
    try {
      await Promise.race([
        current.flush(),
        new Promise<void>((resolve) =>
          setTimeout(resolve, SHUTDOWN_FLUSH_TIMEOUT_MS).unref(),
        ),
      ]);
    } catch {
      // Keep shutting down; the dump writes whatever landed.
    }
  }

  if (current.memoryExporter) {
    writeMemoryDumpIfConfigured(
      current.memoryExporter.getRetainedSpans(),
      current.memoryDumpFile,
    );
  }

  try {
    await Promise.race([
      current.sdk.shutdown(),
      new Promise<void>((resolve) =>
        setTimeout(resolve, SHUTDOWN_FLUSH_TIMEOUT_MS).unref(),
      ),
    ]);
  } catch {
    // A shutdown/flush failure is telemetry-internal; business shutdown
    // semantics (exit code, timing) are untouched (ADR-028 D1).
  }
}

async function startSdk(config: TelemetryConfig): Promise<ActiveTelemetry> {
  // PROTOCOL (W1.1 S8/F4, kept from the sdk-node wiring): the API runtime
  // has no remote exporter surface, and every OTel library that consults
  // the exporter env must see the explicit `none` decision BEFORE any
  // exporter construction. W6's OTLP enablement must replace this explicit
  // decision with an explicit exporter — never remove it into silence.
  process.env.OTEL_TRACES_EXPORTER = "none";
  process.env.OTEL_METRICS_EXPORTER = "none";
  process.env.OTEL_LOGS_EXPORTER = "none";

  const bundle = await import("./sdkBundle.js");

  const memoryExporter =
    config.exporter === "memory" ? new BoundedMemorySpanExporter() : null;

  // Scrub processor FIRST: every later processor and any exporter observe
  // the same span object, so the scrubbed form is the only exported form
  // (urlScrubSpanProcessor.ts header). sdk-trace 3.1.1 takes the exporter
  // and the queue bounds in ONE options object.
  const spanProcessors = [new UrlScrubSpanProcessor()];
  let flush: (() => Promise<void>) | null = null;
  if (memoryExporter) {
    const batch = new bundle.BatchSpanProcessor({
      exporter: memoryExporter,
      ...BATCH_QUEUE_BOUNDS,
    });
    spanProcessors.push(batch);
    flush = () => batch.forceFlush();
  }

  const sdk = bundle.startTracing({
    serviceName: config.serviceName,
    sampleRatio: config.sampleRatio,
    spanProcessors,
    propagator: new ServerRootPropagator(bundle.createOutboundPropagator()),
    instrumentations: [
      bundle.createHttpInstrumentation(),
      bundle.createPinoInstrumentation(),
    ],
  });

  const fastifyOtel = bundle.createFastifyInstrumentation();
  return {
    sdk,
    flush,
    fastifyOtelPlugin: fastifyOtel.plugin(),
    memoryExporter,
    memoryDumpFile: config.memoryDumpFile,
  };
}

function writeMemoryDumpIfConfigured(
  spans: readonly RetainedSpan[],
  dumpFile: string,
): void {
  if (!dumpFile) return;
  try {
    const lines = spans.map((span) => JSON.stringify(span));
    appendFileSync(dumpFile, `${lines.join("\n")}\n`);
  } catch {
    // Witness write is best-effort; it never masks the shutdown outcome.
  }
}
