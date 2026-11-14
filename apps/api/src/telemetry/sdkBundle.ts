/**
 * The ONLY module in the workspace that statically imports OpenTelemetry SDK
 * packages. It is reachable exclusively through the dynamic
 * `import("./sdkBundle.js")` in `runtime.ts`, which runs after the
 * `TELEMETRY_ENABLED` gate — so the default-Off deployment (ADR-028 D1)
 * never loads any telemetry external dependency at runtime, and the On path
 * loads the whole version-locked group in one place.
 *
 * VERSION GROUP (W1.1 probe, exactly-pinned in package.json — upgrade as one
 * unit): @opentelemetry/api@1.10.0 · sdk-trace@3.1.1 ·
 * context-async-hooks@3.1.1 · core@3.1.1 · resources@3.1.1 ·
 * instrumentation@0.301.2 · instrumentation-http@0.301.2 ·
 * instrumentation-pino@0.71.0 · @fastify/otel@1.0.1. The @fastify/otel
 * internal `@opentelemetry/instrumentation@^0.300.0` resolves to 0.300.0 and
 * co-runs with the 0.301.2 SDK generation in one process with a single API
 * instance (probe-measured: no conflict, no duplicate registration).
 *
 * TRANSPORT BOUNDARY (#973 P1): the SDK is assembled here from granular
 * packages, NOT from @opentelemetry/sdk-node. sdk-node's dependency closure
 * drags the exporter families this deployment never uses — OTLP-gRPC ×3,
 * Zipkin, Prometheus (→ @grpc/grpc-js → @grpc/proto-loader → protobufjs →
 * @types/node) and the B3 propagator — into the production payload, which
 * the deploy artifact contract rejects (#798 negative scan: @types/* must
 * never enter the dependency store). The API's exporter surface is the
 * in-memory witness and (W6) OTLP/HTTP only; this bundle therefore imports
 * no exporter package at all — the trace-side processors/exporters are
 * constructed by runtime.ts from sdk-trace alone.
 *
 * The wiring below reproduces exactly the global-registration sequence of
 * the sdk-node start path it replaces (registerInstrumentations → context
 * manager → propagator → tracer provider), with the metric and log faces
 * intentionally absent: this runtime never constructs a meter or logger
 * provider (no metric reader, no log-record producer — pino correlation is
 * injection-only), so there is nothing to register for those signals.
 */
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import type { SpanProcessor } from "@opentelemetry/sdk-trace";
import type { TextMapPropagator } from "@opentelemetry/api";
import { FastifyOtelInstrumentation } from "@fastify/otel";

export {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  HttpInstrumentation,
  PinoInstrumentation,
  FastifyOtelInstrumentation,
  defaultResource,
  resourceFromAttributes,
};

/** Options for {@link startTracing} — the whole trace-face assembly. */
export interface TracingOptions {
  /** `service.name` resource attribute (deployment identity). */
  serviceName: string;
  /** Root sampling ratio fed to the ParentBased sampler. */
  sampleRatio: number;
  /**
   * Complete span-processor chain, in registration order — the URL scrub
   * processor must be first (runtime.ts keeps that ordering; the SDK
   * invokes processors in array order, so the scrubbed form is the only
   * exported form).
   */
  spanProcessors: SpanProcessor[];
  /**
   * The process-global text-map propagator (server-root policy wrapper over
   * the W3C outbound composite).
   */
  propagator: TextMapPropagator;
  /** Instrumentations to enable against the global tracer provider. */
  instrumentations: Instrumentation[];
}

/** Handle of the assembled trace SDK — lifecycle surface only. */
export interface StartedTracing {
  /**
   * Shuts the tracer provider down: flushes and stops every span processor
   * in the chain and unregisters the SDK-internal task. The OTel API's
   * global registrations are one-way per process (see runtime.ts), so
   * shutdown is terminal exactly as it was under sdk-node.
   */
  shutdown: () => Promise<void>;
}

/**
 * The W3C outbound propagator composite (standard `tracecontext,baggage`
 * order). Used ONLY for outbound injection — inbound extraction is refused
 * by the ServerRootPropagator wrapper.
 */
export function createOutboundPropagator() {
  return new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  });
}

/**
 * HTTP instrumentation kept for outbound client spans and context
 * propagation. Incoming-request instrumentation is DISABLED: @fastify/otel
 * is the sole HTTP SERVER span owner (W1.1 measured dual instrumentation
 * producing 2 server spans per request when both are enabled — forbidden by
 * ADR-028 §3 table two).
 */
export function createHttpInstrumentation() {
  return new HttpInstrumentation({
    disableIncomingRequestInstrumentation: true,
  });
}

/**
 * Pino instrumentation in correlation-only mode: `disableLogSending: true`
 * turns off the plugin's own OTLP log-record export; the instrumentation
 * then only injects `trace_id` / `span_id` / `trace_flags` into the stdout
 * log records. Pino stays the only server log entry point and the stdout
 * redaction policy (REDACT_CONFIG) stays fully in force (W1.1 measured
 * correlation fields and redaction coexisting).
 */
export function createPinoInstrumentation() {
  return new PinoInstrumentation({ disableLogSending: true });
}

/**
 * Fastify span-owner instrumentation. `instrumentHooks: false` converges the
 * per-request span volume to the request root span + the route handler span
 * (the default `true` emitted ~8 spans/request on the production entry
 * shape — lifecycle-hook spans of rate-limit/cors/cookie — W1.1 probe F6).
 * The instance's `.plugin()` is registered explicitly on the app BEFORE any
 * route definition (registration-order contract pinned by
 * serverTelemetryWiring.structural.test.ts); `registerOnInitialization`
 * stays unset so the module-patch path is never exercised.
 */
export function createFastifyInstrumentation() {
  return new FastifyOtelInstrumentation({ instrumentHooks: false });
}

/**
 * Assemble and start the trace SDK: build the provider from the explicit
 * options, then perform the global registrations the OTel instrumentations
 * and the @fastify/otel span owner resolve against — in the same order the
 * sdk-node start path used (W1.1 probe-verified): instrumentations first
 * (they bind the API's global proxy and patch modules), then the context
 * manager, the global propagator, and finally the global tracer provider.
 *
 * No diag console logger is installed: sdk-node defaulted one at `info`,
 * but every diagnostic this runtime owns goes through structured channels
 * (telemetry.init_failed) and internal OTel diag noise must not leak to
 * stdout/stderr unshaped.
 */
export function startTracing(options: TracingOptions): StartedTracing {
  const tracerProvider = new TracerProvider({
    resource: defaultResource().merge(
      resourceFromAttributes({
        "service.name": options.serviceName,
      }),
    ),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(options.sampleRatio),
    }),
    spanProcessors: options.spanProcessors,
  });

  registerInstrumentations({ instrumentations: options.instrumentations });

  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  propagation.setGlobalPropagator(options.propagator);

  trace.setGlobalTracerProvider(tracerProvider);

  return {
    shutdown: () => tracerProvider.shutdown(),
  };
}
