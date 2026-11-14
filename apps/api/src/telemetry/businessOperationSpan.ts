import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type SpanAttributeValue,
} from "@opentelemetry/api";
import { AppError } from "@exam/domain";
import { normalizeErrorCode } from "../lib/errorResponse.js";
import {
  ATTR_OP_ERROR_CODE,
  ATTR_OP_OUTCOME,
  BUSINESS_INSTRUMENTATION_SCOPE,
  OUTCOME_EXCEPTION,
  OUTCOME_REJECTED,
  OUTCOME_SUCCESS,
  type BusinessOperationSpanName,
} from "./businessOperationVocabulary.js";

/**
 * Business operation execution spans (#964 W3, ADR-028 D2/D4).
 *
 * ONE diagnostic span per critical business operation (start, save, submit,
 * grade, restore, time grant, force submit, deadline reconcile/auto-submit),
 * created at the existing HTTP-adapter / background-entry boundary around the
 * EXISTING engine command — never inside Domain or Exam Engine (ADR-028 D2:
 * those packages keep zero OTel dependency; the span layer only observes).
 *
 * Parenting is ambient: inside a request the span lands under the W1
 * request/handler spans of the same trace; in background code (deadline
 * scanner) there is no ambient server context, so the span roots its own
 * trace (observability contract §Background work — an HTTP requestId is
 * never fabricated for background work; a future W4 loop root would parent
 * these automatically).
 *
 * Classification reuses the EXISTING error authority — the wire envelope's
 * own classifier (plugins/errors.ts): a thrown AppError with a 4xx status is
 * `rejected` (attr exam.op.error_code = normalizeErrorCode, the same code the
 * response envelope carries); any other failure is `exception` (span status
 * ERROR). Value-shaped rejections (the answer-save protocol's
 * `accepted: false`) and legitimate no-ops are marked by the operation body
 * itself via the received span. Outcome categories and correlation ids come
 * from the closed W3 vocabulary (businessOperationVocabulary.ts).
 *
 * Privacy boundary (ADR-028 D4 / W2 attribute-safety posture): span events
 * would embed exception MESSAGES (exception.message), and messages are not a
 * bounded vocabulary — so failures are classified into fixed categories
 * ONLY; `recordException` is deliberately NOT called. No raw SQL, parameters,
 * payloads, answer content, URLs, or credentials have an attribute key here.
 *
 * INTENTIONAL (Off-state module graph): this module statically imports the
 * API-only facade `@opentelemetry/api` and is imported by the route modules.
 * With telemetry Off no provider is registered, so `trace.getTracer()`
 * yields a ProxyTracer that produces NonRecordingSpans — no SDK bundle, no
 * export task, no network, no behavior change (proven by the whole existing
 * suite running without init, plus the W3.1 R3-off real-entry probe). The
 * SDK bundle itself (`./sdkBundle.js`) stays dynamic-import-only inside
 * startSdk (serverTelemetryWiring.structural.test.ts pins that boundary).
 *
 * Failure containment (ADR-028 D1): telemetry is never allowed to change a
 * business result. Every span-mechanics call is individually contained; if
 * the span machinery itself fails BEFORE the operation body runs, the body
 * still runs under a non-recording span. Operation errors always propagate
 * unchanged — the helper never swallows, wraps, retries, or reorders them.
 * (Version note, verified against the installed sdk-trace 3.1.1 source:
 * `startActiveSpan` ends the span only when the body calls `end()` and does
 * not record exceptions implicitly — so the classification and end calls
 * below are the only lifecycle owners.)
 */

// Re-exported so the vocabulary stays the single import point for call sites.
export * from "./businessOperationVocabulary.js";

/** The tracer is a ProxyTracer — it re-delegates to the global provider on
 * every call, so this module-scope binding is correct across Off→On init. */
const tracer = trace.getTracer(BUSINESS_INSTRUMENTATION_SCOPE);

/**
 * The span surface an operation body may use: attach a bounded
 * correlation/result fact (call sites use closed-vocabulary keys only).
 * Deliberately narrower than the raw OTel Span — span lifecycle (status,
 * end) stays owned by this module, and a broken span implementation can
 * never surface into the operation.
 */
export interface BusinessOperationSpan {
  setAttribute(key: string, value: SpanAttributeValue): void;
}

/** Shared non-recording instance for the broken-tracer fallback path. */
const NON_RECORDING: BusinessOperationSpan = {
  setAttribute() {},
};

class ContainedSpan implements BusinessOperationSpan {
  constructor(private readonly span: Span) {}

  setAttribute(key: string, value: SpanAttributeValue): void {
    try {
      this.span.setAttribute(key, value);
    } catch {
      // Telemetry-internal; observation loss never fails the operation.
    }
  }

  setStatusError(): void {
    try {
      this.span.setStatus({ code: SpanStatusCode.ERROR });
    } catch {
      // Contained.
    }
  }

  end(): void {
    try {
      this.span.end();
    } catch {
      // Contained.
    }
  }
}

/**
 * Classifies a thrown failure onto the span using the wire envelope's own
 * error authority. 4xx-shaped AppErrors are business rejections; everything
 * else is an exception (span status ERROR, no message ever recorded).
 */
function classifyThrown(span: ContainedSpan, err: unknown): void {
  if (
    err instanceof AppError &&
    err.statusCode >= 400 &&
    err.statusCode < 500
  ) {
    span.setAttribute(ATTR_OP_OUTCOME, OUTCOME_REJECTED);
    span.setAttribute(
      ATTR_OP_ERROR_CODE,
      normalizeErrorCode(err.code, err.statusCode),
    );
    return;
  }
  span.setAttribute(ATTR_OP_OUTCOME, OUTCOME_EXCEPTION);
  span.setStatusError();
}

/**
 * Runs `fn` inside one business operation span. The span starts with the
 * provisional `success` outcome; `fn` refines it (value-shaped rejections,
 * no-op results) via the received span, and a thrown error re-classifies it.
 *
 * @param operation span name — must be a closed-vocabulary constant.
 * @param attributes correlation attributes (ids only; see vocabulary header).
 * @param fn the existing business operation body.
 */
export async function withBusinessOperationSpan<T>(
  operation: BusinessOperationSpanName,
  attributes: Attributes,
  fn: (span: BusinessOperationSpan) => Promise<T>,
): Promise<T> {
  let fnEntered = false;
  try {
    return await tracer.startActiveSpan(
      operation,
      { attributes },
      async (span) => {
        fnEntered = true;
        const businessSpan = new ContainedSpan(span);
        // Provisional outcome — refined below by value-shaped rejections /
        // no-ops, overwritten by the catch classifier on a thrown failure.
        businessSpan.setAttribute(ATTR_OP_OUTCOME, OUTCOME_SUCCESS);
        try {
          const result = await fn(businessSpan);
          businessSpan.end();
          return result;
        } catch (err) {
          classifyThrown(businessSpan, err);
          businessSpan.end();
          throw err;
        }
      },
    );
  } catch (err) {
    // The span MACHINERY failed before the operation body ran (broken
    // sampler/provider/context manager): run the body under a non-recording
    // span so the business result is unchanged.
    if (fnEntered) throw err;
    return fn(NON_RECORDING);
  }
}
