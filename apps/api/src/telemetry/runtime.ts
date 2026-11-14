import { appendFileSync } from "node:fs";
import type { FastifyPluginCallback } from "fastify";
import { setTransactionSeam } from "@exam/db/observation";
import type { TransactionSeam } from "@exam/db/observation";
import {
  getRuntimeConfig,
  type TelemetryConfig,
} from "../config/runtimeConfig.js";
import {
  BoundedMemorySpanExporter,
  type RetainedSpan,
} from "./boundedMemorySpanExporter.js";
import { ExceptionScrubSpanProcessor } from "./exceptionScrubSpanProcessor.js";
import { ServerRootPropagator } from "./serverRootPropagator.js";
import { UrlScrubSpanProcessor } from "./urlScrubSpanProcessor.js";

/**
 * Structural view of the root postgres.js pool the db plugin hands over for
 * telemetry tagging. The plugin only creates ONE LAZY marker query through
 * it (`sql.unsafe("select 1")` — created, never consumed, dropped), so a
 * registration executes nothing.
 */
interface TelemetryRootSql {
  unsafe: (query: string) => unknown;
}

/**
 * Structural handle of the DB telemetry plugin (#964 W2). The plugin is
 * referenced ONLY through the dynamic import inside startSdk — the Off
 * deployment never loads the module (and thus never installs its driver
 * prototype patch) at all.
 */
interface DbTelemetryHandle {
  registerRootConnection(sql: TelemetryRootSql): void;
  readonly transactionSeam: TransactionSeam;
  disable(): void;
}

/**
 * Technical telemetry runtime (ADR-028, default Off).
 *
 * Lifecycle contract:
 * - **Off** (`TELEMETRY_ENABLED` unset/empty/false — the deployment default):
 *   {@link initTelemetry} returns before ANY telemetry module is loaded.
 *   The dynamic `import("./sdkBundle.js")` never executes, so no OTel
 *   SDK/instrumentation package, export task, or network surface exists in
 *   the process (W1.1 measured the Off state: zero spans, zero connections to
 *   the collector port, unmodified exit). Since W3/W4, the API span helpers
 *   (businessOperationSpan.ts for business operations, backgroundLoopSpan.ts
 *   for background loop cycles) statically import the API-only facade
 *   `@opentelemetry/api` — already an apps/api dependency since W1 — which is
 *   inert without a registered provider: ProxyTracer → NonRecordingSpans and
 *   NOOP_METER_PROVIDER → no-op instruments, no task, no network. The SDK
 *   bundle itself stays dynamic-import-only.
 * - **On**: the SDK is assembled from granular OTel packages with explicit
 *   per-signal configuration (sdkBundle.ts startTracing/startMetrics — no
 *   auto-configure facade), and every signal's exporter env is additionally
 *   pinned to `none` before construction (W1.1 probe F4/S8: the default OTLP
 *   exporter dials localhost:4318; the explicit env decision keeps that
 *   surface at zero for any OTel library that consults the env). The one
 *   remote exporter is the W6 opt-in (`TELEMETRY_EXPORTER=otlp`): traces via
 *   a bounded BatchSpanProcessor over OTLP/HTTP, metrics via one bounded
 *   periodic reader registered as the global MeterProvider — both pointed
 *   at TELEMETRY_OTLP_ENDPOINT. Logs have NO remote path: Pino stays
 *   stdout-only (correlation-only instrumentation; remote log ingestion is
 *   the collector's job, ADR-028 D3 single-path rule).
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

/**
 * Defined bounds of the OTLP metric reader (the metric counterpart of
 * BATCH_QUEUE_BOUNDS — bounded by contract, ADR-028 D1). Export failures
 * (collector unreachable) are contained by the SDK's reader internals and
 * never propagate into request handling.
 */
const OTLP_METRIC_EXPORT_INTERVAL_MS = 60_000;
const OTLP_METRIC_EXPORT_TIMEOUT_MS = 30_000;

interface ActiveTelemetry {
  sdk: { shutdown: () => Promise<void> };
  /** Batch-queue flush (null when there is no batch processor). */
  flush: (() => Promise<void>) | null;
  fastifyOtelPlugin: FastifyPluginCallback;
  memoryExporter: BoundedMemorySpanExporter | null;
  /** Witness dump path captured at init; empty string = disabled. */
  memoryDumpFile: string;
  /**
   * DB telemetry plugin handle (#964 W2) — null when its install degraded.
   * Its install captured the pristine driver prototype references once;
   * `disable()` stops recording AND restores those pristine methods (#974 —
   * the patch is removed, not merely inert).
   */
  dbTelemetry: DbTelemetryHandle | null;
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
 * Tags a root postgres.js pool for the DB telemetry plugin (root vs
 * transaction attribution, #964 W2). No-op when telemetry is Off or the
 * plugin install degraded — the db plugin calls it unconditionally right
 * after `createDatabase`. Registrations after shutdown are ignored.
 */
export function registerRootSqlConnectionForTelemetry(
  sql: TelemetryRootSql,
): void {
  active?.dbTelemetry?.registerRootConnection(sql);
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

  // Stop DB telemetry recording FIRST (no new spans after this point), and
  // clear the @exam/db observation seam so the transaction path returns to
  // its seam-less behavior for whatever still runs during close (#964 W2).
  if (current.dbTelemetry) {
    try {
      current.dbTelemetry.disable();
    } catch {
      // Contained: a broken disable never blocks the shutdown sequence.
    }
  }
  setTransactionSeam(null);

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

/**
 * Composed shutdown of the assembled SDK faces. INVARIANT: every face's
 * shutdown runs to settlement even when another face fails — a trace-face
 * rejection must never cancel the metric face's final periodic export,
 * whose interval only ends through its provider shutdown. Faces run
 * concurrently inside ONE bounded caller race (shutdownTelemetry), so a
 * hung face cannot starve the others; the first rejection re-surfaces
 * only after every face has settled.
 */
export function composeSdkShutdown(
  faces: readonly (() => Promise<void>)[],
): () => Promise<void> {
  return async () => {
    const outcomes = await Promise.allSettled(faces.map((run) => run()));
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        throw outcome.reason;
      }
    }
  };
}

async function startSdk(config: TelemetryConfig): Promise<ActiveTelemetry> {
  // PROTOCOL (W1.1 S8/F4, kept from the sdk-node wiring): every OTel library
  // that consults the exporter env must see the explicit `none` decision
  // BEFORE any exporter construction. The W6 `otlp` branch below replaces
  // this explicit decision with an explicit exporter for traces+metrics —
  // never remove the `none` defaults into silence; any new signal path must
  // be another explicit decision like that one.
  process.env.OTEL_TRACES_EXPORTER = "none";
  process.env.OTEL_METRICS_EXPORTER = "none";
  process.env.OTEL_LOGS_EXPORTER = "none";

  const bundle = await import("./sdkBundle.js");

  const memoryExporter =
    config.exporter === "memory" ? new BoundedMemorySpanExporter() : null;

  // Scrub processors FIRST (URL surface, then exception surface): every
  // later processor and any exporter observe the same span object, so the
  // scrubbed form is the only exported form (urlScrubSpanProcessor.ts and
  // exceptionScrubSpanProcessor.ts headers). sdk-trace 3.1.1 takes the
  // exporter and the queue bounds in ONE options object.
  const spanProcessors = [
    new UrlScrubSpanProcessor(),
    new ExceptionScrubSpanProcessor(),
  ];
  let flush: (() => Promise<void>) | null = null;
  let metricsSdk: ReturnType<typeof bundle.startMetrics> | null = null;
  if (memoryExporter) {
    const batch = new bundle.BatchSpanProcessor({
      exporter: memoryExporter,
      ...BATCH_QUEUE_BOUNDS,
    });
    spanProcessors.push(batch);
    flush = () => batch.forceFlush();
  } else if (config.exporter === "otlp") {
    // W6 opt-in: the only remote exporter path. Same scrub-first processor
    // chain and the same bounded queue as the memory witness — the remote
    // destination sees exactly the scrubbed projection. Metrics register
    // the global meter provider over ONE bounded periodic reader (W4's
    // facade instruments turn into real series exactly here; in every other
    // exporter mode they stay NOOP — the W4 containment contract).
    const batch = new bundle.BatchSpanProcessor({
      exporter: bundle.createOtlpSpanExporter(config.otlpEndpoint),
      ...BATCH_QUEUE_BOUNDS,
    });
    spanProcessors.push(batch);
    flush = () => batch.forceFlush();
    metricsSdk = bundle.startMetrics({
      serviceName: config.serviceName,
      reader: bundle.createPeriodicOtlpMetricReader(
        config.otlpEndpoint,
        OTLP_METRIC_EXPORT_INTERVAL_MS,
        OTLP_METRIC_EXPORT_TIMEOUT_MS,
      ),
    });
  }

  const tracing = bundle.startTracing({
    serviceName: config.serviceName,
    sampleRatio: config.sampleRatio,
    spanProcessors,
    propagator: new ServerRootPropagator(bundle.createOutboundPropagator()),
    instrumentations: [
      bundle.createHttpInstrumentation(),
      bundle.createPinoInstrumentation(),
    ],
  });

  // #964 W2: the DB telemetry plugin loads ONLY here — inside the On path,
  // after the SDK is up and BEFORE the Fastify instance (and with it the db
  // plugin's root pool) exists, so the prototype patch is in place before
  // the process's first statement. A degraded install keeps the rest
  // of telemetry alive (ADR-028 D1: telemetry failures never change
  // business results).
  let dbTelemetry: DbTelemetryHandle | null = null;
  try {
    const dbBundle = await import("@exam/otel-drizzle-postgresjs");
    dbTelemetry = dbBundle.installOtelDbTelemetry();
    setTransactionSeam(dbTelemetry.transactionSeam);
  } catch (err) {
    dbTelemetry = null;
    setTransactionSeam(null);
    process.stderr.write(
      `${JSON.stringify({
        event: "telemetry.db_init_failed",
        reason: err instanceof Error ? err.message : String(err),
      })}\n`,
    );
  }

  const fastifyOtel = bundle.createFastifyInstrumentation();
  return {
    sdk: {
      // Both faces always run: composeSdkShutdown lets a trace-face failure
      // never cancel the metric face's final periodic export (R4 review —
      // the faces are independent queues; sdk-node composed the same two
      // faces internally).
      shutdown: composeSdkShutdown([
        () => tracing.shutdown(),
        ...(metricsSdk ? [() => metricsSdk.shutdown()] : []),
      ]),
    },
    flush,
    fastifyOtelPlugin: fastifyOtel.plugin(),
    memoryExporter,
    memoryDumpFile: config.memoryDumpFile,
    dbTelemetry,
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
