import { metrics, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { ContainedSpan } from "./businessOperationSpan.js";
import {
  ATTR_LOOP_NAME,
  ATTR_LOOP_OUTCOME,
  ATTR_LOOP_WORK,
  CYCLE_DURATION_BUCKETS,
  LOOP_INSTRUMENTATION_SCOPE,
  LOOP_OUTCOME_EXCEPTION,
  METRIC_CYCLE_COUNT,
  METRIC_CYCLE_DURATION,
  METRIC_WORK_COUNT,
  SPAN_NAME_BY_LOOP,
  type BackgroundLoopName,
  type LoopCycleOutcome,
  type LoopWorkKind,
} from "./backgroundLoopVocabulary.js";

/**
 * Background loop cycle spans + metrics (#964 W4, ADR-028 D2/D3/D4).
 *
 * ONE span per settled loop cycle (heartbeat tick, deadline scan tick,
 * retention pass, email outbox poll), rooted at the loop itself. Background
 * code has no ambient server context, so the span roots its own trace
 * (observability contract §Background work — an HTTP requestId is never
 * fabricated for background work); the W3 business spans inside a cycle
 * (e.g. `exam.attempt.deadline_auto_submit`) parent under the cycle span via
 * the ambient context automatically — no extra wiring at those call sites.
 * A hung cycle is observable as its never-ended span, but the STALL verdict
 * stays with the operability monitor (#547): this layer only records facts.
 *
 * The helper also projects each cycle's own results — the ScanResult /
 * retention result / email ProcessResult counters the loops already produce
 * and log — onto the frozen W4 metric vocabulary
 * (backgroundLoopVocabulary.ts): cycle duration (histogram, seconds), cycle
 * count by outcome (counter), and projected work counts (counter). Metrics
 * are a derived projection recorded at this single settle boundary; the
 * loops' in-memory facts (`*Metrics` objects), readiness, operability.* stdout
 * alerts, and outbox semantics stay untouched (their owners are unchanged).
 *
 * INTENTIONAL (Off-state module graph): like businessOperationSpan.ts, this
 * module statically imports the API-only `@opentelemetry/api` facade and is
 * statically imported by the loop plugins. Without a registered provider
 * `trace.getTracer()` yields NonRecordingSpans and
 * `metrics.getMeterProvider()` yields NOOP_METER_PROVIDER — zero tasks, zero
 * network, zero behavior change (the metrics API has no proxy re-delegation
 * like the trace API, so instruments are bound LAZILY, see
 * {@link getInstruments}). The SDK bundle stays dynamic-import-only inside
 * startSdk (serverTelemetryWiring.structural.test.ts).
 *
 * Failure containment (ADR-028 D1): telemetry never changes a business
 * result. Span mechanics and metric recording are individually contained;
 * operation errors always propagate unchanged (the helper never swallows,
 * wraps, or retries them). Metric-recording failures degrade to spans-only.
 */

const tracer = trace.getTracer(LOOP_INSTRUMENTATION_SCOPE);

/** Frozen instrument surface bound to the global meter provider. */
interface LoopInstruments {
  duration: { record: (value: number, attrs: Record<string, string>) => void };
  cycles: { add: (value: number, attrs: Record<string, string>) => void };
  work: { add: (value: number, attrs: Record<string, string>) => void };
}

let instruments: LoopInstruments | null = null;
let instrumentsBroken = false;

/**
 * Binds the metric instruments on FIRST settle. INVARIANT: a global meter
 * provider (when any) registers during `initTelemetry`/`sdk.start()`, which
 * runs before the Fastify app — and therefore before any timer, poll, or
 * pass can settle — so the first settle always sees the final provider
 * decision. When no provider exists (Off, or On without a metric reader —
 * the deployment default until W6), the API's NOOP_METER_PROVIDER yields
 * no-op instruments that are memoized here: structurally present, inert.
 * A broken meter creation degrades to spans-only for the process lifetime.
 */
function getInstruments(): LoopInstruments | null {
  if (instruments || instrumentsBroken) return instruments;
  try {
    const meter = metrics.getMeter(LOOP_INSTRUMENTATION_SCOPE);
    instruments = {
      duration: meter.createHistogram(METRIC_CYCLE_DURATION, {
        description: "Duration of one settled background loop cycle",
        unit: "s",
        advice: { explicitBucketBoundaries: [...CYCLE_DURATION_BUCKETS] },
      }),
      cycles: meter.createCounter(METRIC_CYCLE_COUNT, {
        description: "Settled background loop cycles by loop and outcome",
        unit: "{cycle}",
      }),
      work: meter.createCounter(METRIC_WORK_COUNT, {
        description: "Projected per-cycle work of background loops by kind",
        unit: "{item}",
      }),
    };
  } catch {
    instrumentsBroken = true;
  }
  return instruments;
}

/** One cycle's projected work, keyed by the closed work-kind vocabulary. */
export interface LoopCycleHandle {
  /**
   * Projects a nonzero per-cycle work count onto `exam.loop.work.count` at
   * settle. Counts recorded before a mid-cycle throw still settle with the
   * cycle (the work really happened); zero counts never create a series.
   */
  countWork(work: LoopWorkKind, count: number): void;
}

const NON_RECORDING_CYCLE: LoopCycleHandle = {
  countWork() {},
};

class ContainedCycle implements LoopCycleHandle {
  constructor(private readonly work: Map<LoopWorkKind, number>) {}

  countWork(work: LoopWorkKind, count: number): void {
    if (!Number.isFinite(count) || count <= 0) return;
    this.work.set(work, (this.work.get(work) ?? 0) + count);
  }
}

function recordCycleMetrics(
  loop: BackgroundLoopName,
  outcome: LoopCycleOutcome,
  work: Map<LoopWorkKind, number>,
  durationSec: number,
): void {
  const current = getInstruments();
  if (!current) return;
  try {
    current.duration.record(durationSec, { [ATTR_LOOP_NAME]: loop });
    current.cycles.add(1, {
      [ATTR_LOOP_NAME]: loop,
      [ATTR_LOOP_OUTCOME]: outcome,
    });
    for (const [kind, count] of work) {
      if (count > 0) {
        current.work.add(count, {
          [ATTR_LOOP_NAME]: loop,
          [ATTR_LOOP_WORK]: kind,
        });
      }
    }
  } catch {
    // A broken instrument degrades to spans-only observation (ADR-028 D1).
  }
}

function finishCycleSpan(span: ContainedSpan, outcome: LoopCycleOutcome): void {
  span.setAttribute(ATTR_LOOP_OUTCOME, outcome);
  if (outcome === LOOP_OUTCOME_EXCEPTION) span.setStatusError();
  span.end();
}

/**
 * Runs one loop cycle inside its own rooted cycle span and projects its
 * results onto the frozen W4 metric vocabulary. The body returns the cycle's
 * closed outcome plus its own result, which passes through unchanged; a
 * thrown error is classified `exception`, recorded with whatever work was
 * already counted, and rethrown — the loop's existing catch/finally
 * bookkeeping (stall facts, throw counters, heartbeat writes) is untouched.
 *
 * @param loop closed-vocabulary loop name (span name and labels derive from it).
 * @param body the existing cycle body; returns `{ outcome, result }`.
 */
export async function withLoopCycleSpan<T>(
  loop: BackgroundLoopName,
  body: (
    cycle: LoopCycleHandle,
  ) => Promise<{ outcome: LoopCycleOutcome; result: T }>,
): Promise<T> {
  const work = new Map<LoopWorkKind, number>();
  const cycle = new ContainedCycle(work);
  let bodyEntered = false;
  try {
    return await tracer.startActiveSpan(
      SPAN_NAME_BY_LOOP[loop],
      async (span: Span) => {
        bodyEntered = true;
        const contained = new ContainedSpan(span);
        const startedAt = performance.now();
        try {
          const { outcome, result } = await body(cycle);
          recordCycleMetrics(
            loop,
            outcome,
            work,
            (performance.now() - startedAt) / 1000,
          );
          finishCycleSpan(contained, outcome);
          return result;
        } catch (err) {
          recordCycleMetrics(
            loop,
            LOOP_OUTCOME_EXCEPTION,
            work,
            (performance.now() - startedAt) / 1000,
          );
          finishCycleSpan(contained, LOOP_OUTCOME_EXCEPTION);
          throw err;
        }
      },
    );
  } catch (err) {
    // The span MACHINERY failed before the cycle body ran (broken
    // provider/context manager): run the cycle under a non-recording handle
    // so the loop behavior is unchanged.
    if (bodyEntered) throw err;
    const { result } = await body(NON_RECORDING_CYCLE);
    return result;
  }
}
