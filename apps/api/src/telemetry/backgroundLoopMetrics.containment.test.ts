import { describe, expect, it } from "vitest";
import { context, metrics, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { withLoopCycleSpan } from "./backgroundLoopSpan.js";
import {
  ATTR_LOOP_OUTCOME,
  LOOP_DEADLINE_SCANNER,
  LOOP_OUTCOME_SUCCESS,
  SPAN_LOOP_DEADLINE_SCANNER,
  WORK_SUBMITTED,
} from "./backgroundLoopVocabulary.js";

/**
 * Containment of the W4 loop layer when the METRIC machinery is hostile
 * (ADR-028 D1: telemetry failures never change business results). This file
 * owns its own global registrations (one process per test file): a real
 * tracer provider records the spans, while a METER provider whose getMeter
 * throws must never reach the loop — the cycle still runs, still records its
 * span, and the body result is unchanged (metrics degrade to spans-only for
 * the process lifetime). The no-provider (Off) posture is exercised by every
 * existing loop test file running without a telemetry session.
 */

describe("background loop metrics containment (hostile meter)", () => {
  const exporter = new InMemorySpanExporter();

  it("a broken meter degrades to spans-only and never reaches the cycle body", async () => {
    const tracerProvider = new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });
    trace.setGlobalTracerProvider(tracerProvider);
    context.setGlobalContextManager(new AsyncLocalStorageContextManager());
    // Hostile meter: the getMeter call itself throws; the helper must
    // contain it and never let it reach the loop.
    metrics.setGlobalMeterProvider({
      getMeter: () => {
        throw new Error("broken-meter-machinery");
      },
    });

    const result = await withLoopCycleSpan(
      LOOP_DEADLINE_SCANNER,
      async (cycle) => {
        cycle.countWork(WORK_SUBMITTED, 3);
        return { outcome: LOOP_OUTCOME_SUCCESS, result: "contained-result" };
      },
    );

    expect(result).toBe("contained-result");
    const spans = exporter
      .getFinishedSpans()
      .filter((s) => s.name === SPAN_LOOP_DEADLINE_SCANNER);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes[ATTR_LOOP_OUTCOME]).toBe(LOOP_OUTCOME_SUCCESS);
  });
});
