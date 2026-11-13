/**
 * The ONLY module in the workspace that statically imports OpenTelemetry SDK
 * packages. It is reachable exclusively through the dynamic
 * `import("./sdkBundle.js")` in `runtime.ts`, which runs after the
 * `TELEMETRY_ENABLED` gate — so the default-Off deployment (ADR-028 D1)
 * never loads any telemetry external dependency at runtime, and the On path
 * loads the whole version-locked group in one place.
 *
 * VERSION GROUP (W1.1 probe, exactly-pinned in package.json — upgrade as one
 * unit): @opentelemetry/api@1.10.0 · sdk-node@0.301.2 ·
 * instrumentation-http@0.301.2 · instrumentation-pino@0.71.0 ·
 * sdk-trace/resources/core@3.1.1 · @fastify/otel@1.0.1. The @fastify/otel
 * internal `@opentelemetry/instrumentation@^0.300.0` resolves to 0.300.0 and
 * co-runs with the 0.301.2 SDK generation in one process with a single API
 * instance (probe-measured: no conflict, no duplicate registration).
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { FastifyOtelInstrumentation } from "@fastify/otel";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";

export {
  NodeSDK,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  HttpInstrumentation,
  PinoInstrumentation,
  FastifyOtelInstrumentation,
  defaultResource,
  resourceFromAttributes,
};

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
