import type {
  Context,
  TextMapGetter,
  TextMapPropagator,
  TextMapSetter,
} from "@opentelemetry/api";

/**
 * Inbound-untrusting propagator for the API server (ADR-028 D2, server-root
 * trace policy).
 *
 * `extract` returns the caller's context UNCHANGED: no remote span context
 * and no baggage is ever adopted from inbound `traceparent` / `tracestate` /
 * `baggage` headers. Every HTTP SERVER span therefore starts a fresh
 * server-created trace root — a browser cannot graft its own trace onto the
 * server (W1.1 probe F1 measured the default propagator adopting client
 * parents; this class is the countermeasure).
 *
 * `inject`/`fields` stay full W3C (`tracecontext` + `baggage`): outbound
 * requests this server makes still carry ITS trace context downstream.
 */
export class ServerRootPropagator implements TextMapPropagator {
  readonly #outbound: TextMapPropagator;

  constructor(outbound: TextMapPropagator) {
    this.#outbound = outbound;
  }

  extract(
    context: Context,
    _carrier: unknown,
    _getter: TextMapGetter,
  ): Context {
    // INVARIANT: inbound headers are never identity or parent-context
    // authority (ADR-025 keeps request.id server-owned; this keeps the trace
    // parent server-owned the same way).
    return context;
  }

  inject(
    context: Context,
    carrier: Record<string, string>,
    setter: TextMapSetter,
  ): void {
    this.#outbound.inject(context, carrier, setter);
  }

  fields(): string[] {
    return this.#outbound.fields();
  }
}
