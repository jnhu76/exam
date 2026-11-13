import { eq } from "drizzle-orm";
import Fastify from "fastify";
import type { EmailSender } from "@exam/domain";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import {
  flushRetainedSpansForDiagnostics,
  getRetainedSpansForDiagnostics,
  initTelemetry,
  shutdownTelemetry,
  type TelemetryRuntimeHandle,
} from "./runtime.js";
import { withLoopCycleSpan } from "./backgroundLoopSpan.js";
import {
  ATTR_LOOP_NAME,
  ATTR_LOOP_OUTCOME,
  ATTR_LOOP_WORK,
  LOOP_CLIENT_EVENT_RETENTION,
  LOOP_DEADLINE_SCANNER,
  LOOP_EMAIL_OUTBOX,
  LOOP_HEARTBEAT,
  LOOP_OUTCOME_EMPTY,
  LOOP_OUTCOME_EXCEPTION,
  LOOP_OUTCOME_FAILED,
  LOOP_OUTCOME_SUCCESS,
  LOOP_WORK_ALLOWLIST,
  METRIC_CYCLE_COUNT,
  METRIC_CYCLE_DURATION,
  METRIC_WORK_COUNT,
  SPAN_LOOP_CLIENT_EVENT_RETENTION,
  SPAN_LOOP_DEADLINE_SCANNER,
  SPAN_LOOP_EMAIL_OUTBOX,
  SPAN_LOOP_HEARTBEAT,
  WORK_DELETED,
  WORK_FAILED,
  WORK_MARKED,
  WORK_PROCESSED,
  WORK_SENT,
  WORK_SUBMITTED,
} from "./backgroundLoopVocabulary.js";
import deadlineScannerPlugin, {
  deadlineScannerMetrics,
  scanDatabaseForExpiredAttempts,
} from "../plugins/deadlineScanner.js";
import heartbeatPlugin, { heartbeatMetrics } from "../plugins/heartbeat.js";
import { runClientEventRetentionOnce } from "../plugins/clientEventRetention.js";
import emailOutboxLoopPlugin from "../plugins/emailOutboxLoop.js";
import { createClientEventRepo } from "@exam/db/repository/clientEventRepo";
import { createOrganizationRepo } from "@exam/db/repository/organizationRepo";
import { getIsolatedTestDb } from "@exam/db/testDb";
import type { Database } from "@exam/db/types";
import {
  attemptInterruptionEvents,
  emailOutbox,
  examAttempts,
  organizations,
  schema,
} from "@exam/db/schema/pg";
import type { FastifyPluginAsync } from "fastify";
import { buildTestApp } from "../routes/testHelpers.js";
import examRoutes from "../routes/exam.js";
import attemptRoutes from "../routes/attempts.js";
import {
  buildExamPayload,
  createIsolatedAttemptOrg,
  type IsolatedAttemptOrg,
} from "../routes/attempts/__tests__/attempts.testHelpers.js";

/**
 * Background loop cycle span + metric integration tests (#964 W4): the four
 * loops observed over their REAL cycle bodies (deadline scan, heartbeat tick,
 * retention pass, email outbox poll) and REAL PostgreSQL, inside ONE
 * telemetry session per process (`TELEMETRY_EXPORTER=memory`) plus a
 * test-owned global meter provider with a DELTA in-memory reader — the API
 * runtime has no metric reader until W6, so the metric projection is
 * observed here through the same lazy instrument binding the production loop
 * helper uses.
 *
 * Coverage per the W4.1 contract: cycle 开始/结果/空轮/失败 as the closed
 * outcome vocabulary, work-kind projections of the loops' own results,
 * exception classification (throw propagates unchanged), zero-count series
 * suppression, the deadline auto-submit re-parenting under the W4 loop root
 * (the W3 handoff), and unchanged loop settle semantics (lastSettledAt /
 * throw counters stay stamped by the plugins). Off inertness is proven by
 * the whole regression suite running without a session; containment of a
 * broken meter is proven in backgroundLoopMetrics.containment.test.ts.
 */

type RetainedSpan = ReturnType<typeof getRetainedSpansForDiagnostics>[number];

let handle: TelemetryRuntimeHandle | null = null;

// TestContext from buildTestApp — the combined plugin wires the otel
// span-owner plugin before the route surfaces.
let ctx: Awaited<ReturnType<typeof buildTestApp>>;

// Test-owned global meter provider — DELTA temporality so every collect()
// returns exactly the increments since the previous collect.
const metricsExporter = new InMemoryMetricExporter(
  AggregationTemporality.DELTA,
);
const metricsReader = new PeriodicExportingMetricReader({
  exporter: metricsExporter,
  exportIntervalMillis: 3_600_000,
});

async function beginSpanWindow(): Promise<Set<string>> {
  await flushRetainedSpansForDiagnostics();
  return new Set(getRetainedSpansForDiagnostics().map((s) => s.spanId));
}

async function endSpanWindow(watermark: Set<string>): Promise<RetainedSpan[]> {
  await flushRetainedSpansForDiagnostics();
  return [...getRetainedSpansForDiagnostics()].filter(
    (s) => !watermark.has(s.spanId),
  );
}

function spansNamed(spans: RetainedSpan[], name: string): RetainedSpan[] {
  return spans.filter((s) => s.name === name);
}

function attr(span: RetainedSpan, key: string): unknown {
  return span.attributes[key];
}

/** Waits for a span of `name` recorded INSIDE the window (watermark-scoped). */
async function waitForCycleSpan(
  spanName: string,
  watermark: Set<string>,
  predicate: (span: RetainedSpan) => boolean = () => true,
  timeoutMs = 5_000,
): Promise<RetainedSpan> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await flushRetainedSpansForDiagnostics();
    const match = getRetainedSpansForDiagnostics().find(
      (s) => s.name === spanName && !watermark.has(s.spanId) && predicate(s),
    );
    if (match) return match;
    if (Date.now() > deadline) {
      throw new Error(`cycle span ${spanName} not observed within timeout`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// ── Metric snapshot helpers (DELTA collect → flat series maps) ──────────────

interface MetricSnapshot {
  sums: Map<string, number>;
  histograms: Map<string, { count: number; sum: number }>;
}

function seriesKey(name: string, attrs: Record<string, unknown>): string {
  return `${name}|${JSON.stringify(attrs)}`;
}

async function snapshotMetrics(): Promise<MetricSnapshot> {
  const result = await metricsReader.collect();
  const sums = new Map<string, number>();
  const histograms = new Map<string, { count: number; sum: number }>();
  for (const scope of result.resourceMetrics.scopeMetrics) {
    for (const metric of scope.metrics) {
      for (const dp of metric.dataPoints) {
        const attrs = dp.attributes as Record<string, unknown>;
        if (metric.dataPointType === DataPointType.HISTOGRAM) {
          const value = dp.value as { count: number; sum: number };
          histograms.set(seriesKey(metric.descriptor.name, attrs), {
            count: value.count,
            sum: value.sum,
          });
        } else {
          sums.set(
            seriesKey(metric.descriptor.name, attrs),
            dp.value as number,
          );
        }
      }
    }
  }
  return { sums, histograms };
}

function cycleCountOf(
  snapshot: MetricSnapshot,
  loop: string,
  outcome: string,
): number {
  return (
    snapshot.sums.get(
      seriesKey(METRIC_CYCLE_COUNT, {
        [ATTR_LOOP_NAME]: loop,
        [ATTR_LOOP_OUTCOME]: outcome,
      }),
    ) ?? 0
  );
}

function workCountOf(
  snapshot: MetricSnapshot,
  loop: string,
  kind: string,
): number {
  return (
    snapshot.sums.get(
      seriesKey(METRIC_WORK_COUNT, {
        [ATTR_LOOP_NAME]: loop,
        [ATTR_LOOP_WORK]: kind,
      }),
    ) ?? 0
  );
}

function cycleCountSeriesOf(snapshot: MetricSnapshot, loop: string): string[] {
  const prefix = `${METRIC_CYCLE_COUNT}|{"${ATTR_LOOP_NAME}":"${loop}"`;
  return [...snapshot.sums.keys()].filter((k) => k.startsWith(prefix));
}

beforeAll(async () => {
  vi.stubEnv("APP_MODE", "development");
  vi.stubEnv("TELEMETRY_ENABLED", "true");
  vi.stubEnv("TELEMETRY_EXPORTER", "memory");
  resetRuntimeConfigForTest();
  // One session per process: the provider (and the W2 DB telemetry install)
  // is in place BEFORE the Fastify app and its DB pool are built.
  handle = await initTelemetry();
  if (!handle) throw new Error("telemetry session did not start");
  // The API runtime registers no meter provider (no metric reader until W6);
  // the test-owned provider exercises the same lazy instrument binding.
  metrics.setGlobalMeterProvider(
    new MeterProvider({ readers: [metricsReader] }),
  );
  const combinedPlugin: FastifyPluginAsync = async (fastify) => {
    await fastify.register(handle!.fastifyOtelPlugin);
    await fastify.register(examRoutes, { prefix: "" });
    await fastify.register(attemptRoutes, { prefix: "" });
  };
  ctx = await buildTestApp(combinedPlugin);
}, 30_000);

afterAll(async () => {
  await ctx.cleanup();
  await shutdownTelemetry();
  await metricsReader.shutdown();
  vi.unstubAllEnvs();
  resetRuntimeConfigForTest();
}, 30_000);

// ── W4 vocabulary closure ───────────────────────────────────────────────────

describe("background loop vocabulary closure (W4)", () => {
  it("freezes the work allowlist per loop with distinct closed kinds", () => {
    expect(LOOP_WORK_ALLOWLIST[LOOP_DEADLINE_SCANNER]).toEqual([
      WORK_SUBMITTED,
      WORK_FAILED,
    ]);
    expect(LOOP_WORK_ALLOWLIST[LOOP_CLIENT_EVENT_RETENTION]).toEqual([
      WORK_DELETED,
      "failed_org",
    ]);
    expect(LOOP_WORK_ALLOWLIST[LOOP_HEARTBEAT]).toContain(WORK_MARKED);
    expect(LOOP_WORK_ALLOWLIST[LOOP_HEARTBEAT]).toHaveLength(6);
    expect(LOOP_WORK_ALLOWLIST[LOOP_EMAIL_OUTBOX]).toHaveLength(6);
    const all = Object.values(LOOP_WORK_ALLOWLIST).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("names every loop with its frozen metric label value", () => {
    expect(LOOP_HEARTBEAT).toBe("heartbeat");
    expect(LOOP_DEADLINE_SCANNER).toBe("deadline_scanner");
    expect(LOOP_CLIENT_EVENT_RETENTION).toBe("client_event_retention");
    expect(LOOP_EMAIL_OUTBOX).toBe("email_outbox");
  });
});

// ── Cycle helper contract ───────────────────────────────────────────────────

describe("background loop cycle helper contract", () => {
  it("records a success cycle: span outcome, cycle count, duration histogram, work counts", async () => {
    const before = await beginSpanWindow();
    const metricsBefore = await snapshotMetrics();
    const returned = await withLoopCycleSpan(LOOP_HEARTBEAT, async (cycle) => {
      cycle.countWork(WORK_MARKED, 2);
      cycle.countWork(WORK_MARKED, 1); // accumulates
      cycle.countWork(WORK_PROCESSED, 4);
      return { outcome: LOOP_OUTCOME_SUCCESS, result: "payload" as const };
    });
    const spans = await endSpanWindow(before);
    const metricsAfter = await snapshotMetrics();

    expect(returned).toBe("payload");
    const cycleSpans = spansNamed(spans, SPAN_LOOP_HEARTBEAT);
    expect(cycleSpans).toHaveLength(1);
    const span = cycleSpans[0]!;
    // Background cycles root their own trace — no request/handler parent.
    expect(span.parentSpanId).toBeNull();
    expect(attr(span, ATTR_LOOP_OUTCOME)).toBe(LOOP_OUTCOME_SUCCESS);
    expect(span.status).toBe("unset");
    // Closed attribute surface: only the frozen outcome key (url.path is the
    // W1 scrub processor's existing structural-exit behavior on all spans).
    expect(
      Object.keys(span.attributes).filter((k) => k !== "url.path"),
    ).toEqual([ATTR_LOOP_OUTCOME]);

    expect(
      cycleCountOf(metricsAfter, LOOP_HEARTBEAT, LOOP_OUTCOME_SUCCESS) -
        cycleCountOf(metricsBefore, LOOP_HEARTBEAT, LOOP_OUTCOME_SUCCESS),
    ).toBe(1);
    expect(
      workCountOf(metricsAfter, LOOP_HEARTBEAT, WORK_MARKED) -
        workCountOf(metricsBefore, LOOP_HEARTBEAT, WORK_MARKED),
    ).toBe(3);
    expect(
      workCountOf(metricsAfter, LOOP_HEARTBEAT, WORK_PROCESSED) -
        workCountOf(metricsBefore, LOOP_HEARTBEAT, WORK_PROCESSED),
    ).toBe(4);
    const histogramKey = [...metricsAfter.histograms.keys()].find((k) =>
      k.startsWith(
        `${METRIC_CYCLE_DURATION}|{"${ATTR_LOOP_NAME}":"${LOOP_HEARTBEAT}"`,
      ),
    );
    expect(histogramKey).toBeDefined();
  });

  it("records an empty cycle without creating any work series", async () => {
    const metricsBefore = await snapshotMetrics();
    const result = await withLoopCycleSpan(LOOP_DEADLINE_SCANNER, async () => ({
      outcome: LOOP_OUTCOME_EMPTY,
      result: 7 as const,
    }));
    const metricsAfter = await snapshotMetrics();

    expect(result).toBe(7);
    expect(
      cycleCountOf(metricsAfter, LOOP_DEADLINE_SCANNER, LOOP_OUTCOME_EMPTY) -
        cycleCountOf(metricsBefore, LOOP_DEADLINE_SCANNER, LOOP_OUTCOME_EMPTY),
    ).toBe(1);
    expect(
      workCountOf(metricsAfter, LOOP_DEADLINE_SCANNER, WORK_SUBMITTED),
    ).toBe(0);
    expect(workCountOf(metricsAfter, LOOP_DEADLINE_SCANNER, WORK_FAILED)).toBe(
      0,
    );
  });

  it("classifies a thrown body as exception, rethrows unchanged, records work done before the throw", async () => {
    const sentinel = new Error("boom-with-potentially-sensitive-detail");
    let caught: unknown = null;
    const metricsBefore = await snapshotMetrics();
    const before = await beginSpanWindow();
    await withLoopCycleSpan(LOOP_CLIENT_EVENT_RETENTION, async (cycle) => {
      cycle.countWork(WORK_DELETED, 5); // work really happened before the throw
      throw sentinel;
    }).catch((err: unknown) => {
      caught = err;
    });
    const spans = await endSpanWindow(before);
    const metricsAfter = await snapshotMetrics();

    expect(caught).toBe(sentinel);
    const span = spansNamed(spans, SPAN_LOOP_CLIENT_EVENT_RETENTION)[0]!;
    expect(attr(span, ATTR_LOOP_OUTCOME)).toBe(LOOP_OUTCOME_EXCEPTION);
    expect(span.status).toBe("error");
    // The raw message never enters the attributes (no exception.message, no
    // exception event — same privacy posture as the W3 business spans).
    expect(JSON.stringify(span.attributes)).not.toContain(
      "boom-with-potentially-sensitive-detail",
    );
    expect(
      cycleCountOf(
        metricsAfter,
        LOOP_CLIENT_EVENT_RETENTION,
        LOOP_OUTCOME_EXCEPTION,
      ) -
        cycleCountOf(
          metricsBefore,
          LOOP_CLIENT_EVENT_RETENTION,
          LOOP_OUTCOME_EXCEPTION,
        ),
    ).toBe(1);
    expect(
      workCountOf(metricsAfter, LOOP_CLIENT_EVENT_RETENTION, WORK_DELETED) -
        workCountOf(metricsBefore, LOOP_CLIENT_EVENT_RETENTION, WORK_DELETED),
    ).toBe(5);
  });

  it("never creates a series for zero, negative, or NaN counts", async () => {
    await withLoopCycleSpan(LOOP_EMAIL_OUTBOX, async (cycle) => {
      cycle.countWork(WORK_SENT, 0);
      cycle.countWork(WORK_SENT, -3);
      cycle.countWork(WORK_SENT, Number.NaN);
      return { outcome: LOOP_OUTCOME_EMPTY, result: undefined };
    });
    const metricsAfter = await snapshotMetrics();
    const workSeries = [...metricsAfter.sums.keys()].filter((k) =>
      k.startsWith(
        `${METRIC_WORK_COUNT}|{"${ATTR_LOOP_NAME}":"${LOOP_EMAIL_OUTBOX}"`,
      ),
    );
    // The DELTA window covers exactly this cycle; no add() ran, so no email
    // work series may exist at all.
    expect(workSeries).toEqual([]);
  });
});

// ── Deadline scanner: real-PG wiring + the W3 re-parent proof ───────────────

async function createOrg(label: string): Promise<IsolatedAttemptOrg> {
  return createIsolatedAttemptOrg(ctx, {
    slugPrefix: "bg-loop-test-",
    label,
    questionType: "single_choice",
  });
}

async function createPublishedEnrolledExam(
  t: IsolatedAttemptOrg,
  title: string,
): Promise<string> {
  const examRes = await ctx.app.inject({
    method: "POST",
    url: "/api/exams",
    payload: buildExamPayload({
      title,
      courseId: t.courseId,
      questionIds: [t.questionId],
    }),
    cookies: { "auth-token": t.adminToken },
  });
  expect(examRes.statusCode).toBe(201);
  const examId = examRes.json().id as string;
  const publishRes = await ctx.app.inject({
    method: "POST",
    url: `/api/exams/${examId}/publish`,
    cookies: { "auth-token": t.adminToken },
  });
  expect(publishRes.statusCode).toBe(200);
  const enrollRes = await ctx.app.inject({
    method: "POST",
    url: `/api/exams/${examId}/enrollments`,
    payload: { candidateIds: [t.candidateProfileId] },
    cookies: { "auth-token": t.adminToken },
  });
  expect(enrollRes.statusCode).toBe(200);
  return examId;
}

async function startAttempt(examId: string, token: string): Promise<string> {
  const res = await ctx.app.inject({
    method: "POST",
    url: `/api/attempts/${examId}/start`,
    cookies: { "auth-token": token },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe("deadline scanner cycle over real PostgreSQL (telemetry On)", () => {
  it("one rooted cycle span re-parents the W3 auto-submit business spans; counts project the ScanResult", async () => {
    const t = await createOrg("DeadlineLoop");
    const examId = await createPublishedEnrolledExam(
      t,
      "Bg Loop Deadline Exam",
    );
    const attemptId = await startAttempt(examId, t.candidateToken);
    const past = new Date(Date.now() - 60_000);
    await ctx.db
      .update(schema.examAttempts)
      .set({ deadlineAt: past })
      .where(eq(schema.examAttempts.id, attemptId));

    const metricsBefore = await snapshotMetrics();
    const before = await beginSpanWindow();
    const result = await scanDatabaseForExpiredAttempts(ctx.app);
    const spans = await endSpanWindow(before);
    const metricsAfter = await snapshotMetrics();

    expect(result.submittedCount).toBe(1);
    expect(result.failedCount).toBe(0);

    // Exactly one rooted cycle span; no HTTP request span in a background trace.
    const cycleSpans = spansNamed(spans, SPAN_LOOP_DEADLINE_SCANNER);
    expect(cycleSpans).toHaveLength(1);
    const cycleSpan = cycleSpans[0]!;
    expect(cycleSpan.parentSpanId).toBeNull();
    expect(attr(cycleSpan, ATTR_LOOP_OUTCOME)).toBe(LOOP_OUTCOME_SUCCESS);
    expect(spansNamed(spans, "request")).toHaveLength(0);

    // The W3 handoff: the per-attempt business span parents under the W4
    // cycle root automatically — no extra wiring at the business call site.
    const autoSubmitSpans = spansNamed(
      spans,
      "exam.attempt.deadline_auto_submit",
    );
    expect(autoSubmitSpans).toHaveLength(1);
    expect(autoSubmitSpans[0]!.parentSpanId).toBe(cycleSpan.spanId);
    expect(attr(autoSubmitSpans[0]!, "exam.op.result")).toBe("submitted");

    // The business outcome is unchanged: the attempt really was submitted.
    const [row] = await ctx.db
      .select({ status: schema.examAttempts.status })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    expect(["submitted", "graded"]).toContain(row!.status);

    // Metric projection of the ScanResult at the single settle boundary.
    expect(
      cycleCountOf(metricsAfter, LOOP_DEADLINE_SCANNER, LOOP_OUTCOME_SUCCESS) -
        cycleCountOf(
          metricsBefore,
          LOOP_DEADLINE_SCANNER,
          LOOP_OUTCOME_SUCCESS,
        ),
    ).toBe(1);
    expect(
      workCountOf(metricsAfter, LOOP_DEADLINE_SCANNER, WORK_SUBMITTED) -
        workCountOf(metricsBefore, LOOP_DEADLINE_SCANNER, WORK_SUBMITTED),
    ).toBe(1);
    expect(
      workCountOf(metricsAfter, LOOP_DEADLINE_SCANNER, WORK_FAILED) -
        workCountOf(metricsBefore, LOOP_DEADLINE_SCANNER, WORK_FAILED),
    ).toBe(0);
  });
});

// ── Mock-db tick wiring: empty / failed / exception cycles ──────────────────

const ORG = { id: "org-1" };

function buildTickApp(db: unknown) {
  const clock = { current: new Date("2026-11-13T08:00:00Z") };
  const app = Fastify({ logger: false });
  app.decorate<unknown>("db", db as never);
  app.decorate("now", () => clock.current);
  return { app, clock };
}

function resetHeartbeatFacts() {
  heartbeatMetrics.startedAt = null;
  heartbeatMetrics.lastStartedAt = null;
  heartbeatMetrics.lastSettledAt = null;
  heartbeatMetrics.activeSince = null;
  heartbeatMetrics.disruptedCount = 0;
  heartbeatMetrics.disruptionFailedCount = 0;
  heartbeatMetrics.systemIncidentsCreated = 0;
  heartbeatMetrics.systemIncidentConflicts = 0;
  heartbeatMetrics.incidentReconciliationFailedCount = 0;
  heartbeatMetrics.consecutiveFailedTicks = 0;
  heartbeatMetrics.consecutiveThrowTicks = 0;
}

function resetDeadlineFacts() {
  deadlineScannerMetrics.startedAt = null;
  deadlineScannerMetrics.lastStartedAt = null;
  deadlineScannerMetrics.lastSettledAt = null;
  deadlineScannerMetrics.activeSince = null;
  deadlineScannerMetrics.consecutiveFailedTicks = 0;
  deadlineScannerMetrics.consecutiveThrowTicks = 0;
}

describe("heartbeat tick cycle wiring (mock db, real short interval)", () => {
  async function runOneTick(db: unknown) {
    vi.stubEnv("HEARTBEAT_SCAN_INTERVAL_MS", "20");
    vi.stubEnv("HEARTBEAT_TIMEOUT_MS", "1000");
    resetRuntimeConfigForTest();
    resetHeartbeatFacts();
    const { app } = buildTickApp(db);
    // Watermark BEFORE registration: the first tick fires at +20ms, which can
    // race a post-ready watermark.
    const watermark = await beginSpanWindow();
    await app.register(heartbeatPlugin);
    await app.ready();
    return { app, watermark };
  }

  it("a quiet tick settles as outcome=empty with the plugin settle facts untouched", async () => {
    const emptyEpisodeChain = {
      innerJoin: () => emptyEpisodeChain,
      where: () => emptyEpisodeChain,
      orderBy: () => Promise.resolve([]),
    };
    const quietDb = {
      select: () => ({
        from: (table: unknown) => {
          if (table === organizations) return Promise.resolve([ORG]);
          if (table === examAttempts) {
            return { where: () => Promise.resolve([]) };
          }
          if (table === attemptInterruptionEvents) return emptyEpisodeChain;
          throw new Error("unexpected table in heartbeat fake db");
        },
      }),
    };
    const { app, watermark } = await runOneTick(quietDb);
    try {
      const span = await waitForCycleSpan(SPAN_LOOP_HEARTBEAT, watermark);
      expect(attr(span, ATTR_LOOP_OUTCOME)).toBe(LOOP_OUTCOME_EMPTY);
      expect(span.parentSpanId).toBeNull();
      expect(heartbeatMetrics.lastSettledAt).not.toBeNull();
    } finally {
      await app.close();
      vi.unstubAllEnvs();
      resetRuntimeConfigForTest();
    }
  });

  it("an all-failure tick settles as outcome=failed with both leg failures projected", async () => {
    const STALE_ATTEMPT = {
      id: "att-fail",
      status: "in_progress",
      lastActivityAt: new Date("2026-11-13T07:00:00Z"),
    };
    const allFailingDb = {
      select: () => ({
        from: (table: unknown) => {
          if (table === organizations) return Promise.resolve([ORG]);
          if (table === examAttempts) {
            return { where: () => Promise.resolve([STALE_ATTEMPT]) };
          }
          throw new Error("unexpected table in heartbeat fake db");
        },
      }),
      transaction: async () => {
        throw new Error("forced disruption failure");
      },
    };
    const metricsBefore = await snapshotMetrics();
    const { app, watermark } = await runOneTick(allFailingDb);
    try {
      const span = await waitForCycleSpan(SPAN_LOOP_HEARTBEAT, watermark);
      expect(attr(span, ATTR_LOOP_OUTCOME)).toBe(LOOP_OUTCOME_FAILED);
      expect(heartbeatMetrics.consecutiveFailedTicks).toBe(1);
      const snapshot = await snapshotMetrics();
      expect(
        workCountOf(snapshot, LOOP_HEARTBEAT, "disruption_failed") -
          workCountOf(metricsBefore, LOOP_HEARTBEAT, "disruption_failed"),
      ).toBe(1);
      expect(
        workCountOf(snapshot, LOOP_HEARTBEAT, "incident_failed") -
          workCountOf(metricsBefore, LOOP_HEARTBEAT, "incident_failed"),
      ).toBe(1);
    } finally {
      await app.close();
      vi.unstubAllEnvs();
      resetRuntimeConfigForTest();
    }
  });

  it("a discovery throw settles as outcome=exception and the next tick recovers to empty", async () => {
    let failFirst = true;
    const throwingDb = {
      select: () => ({
        from: () => {
          if (failFirst) {
            failFirst = false;
            throw new Error("forced discovery failure");
          }
          return Promise.resolve([]);
        },
      }),
    };
    const { app, watermark } = await runOneTick(throwingDb);
    try {
      const thrownSpan = await waitForCycleSpan(SPAN_LOOP_HEARTBEAT, watermark);
      expect(attr(thrownSpan, ATTR_LOOP_OUTCOME)).toBe(LOOP_OUTCOME_EXCEPTION);
      expect(thrownSpan.status).toBe("error");
      expect(heartbeatMetrics.consecutiveThrowTicks).toBe(1);
      // Recovery: the NEXT tick settles clean — the loop keeps converging.
      const recovered = await waitFor(async () => {
        await flushRetainedSpansForDiagnostics();
        return getRetainedSpansForDiagnostics().some(
          (s) =>
            s.name === SPAN_LOOP_HEARTBEAT &&
            !watermark.has(s.spanId) &&
            attr(s, ATTR_LOOP_OUTCOME) === LOOP_OUTCOME_EMPTY,
        );
      }, 5_000);
      expect(recovered).toBe(true);
    } finally {
      await app.close();
      vi.unstubAllEnvs();
      resetRuntimeConfigForTest();
    }
  });

  it("the deadline scanner tick projects an exception cycle the same way", async () => {
    vi.stubEnv("HEARTBEAT_SCAN_INTERVAL_MS", "20");
    vi.stubEnv("DEADLINE_SCAN_INTERVAL_MS", "20");
    vi.stubEnv("HEARTBEAT_TIMEOUT_MS", "1000");
    resetRuntimeConfigForTest();
    resetDeadlineFacts();
    const throwingDb = {
      select: () => ({
        from: () => {
          throw new Error("forced org discovery failure");
        },
      }),
    };
    const { app } = buildTickApp(throwingDb);
    const watermark = await beginSpanWindow();
    await app.register(deadlineScannerPlugin);
    await app.ready();
    try {
      const span = await waitForCycleSpan(
        SPAN_LOOP_DEADLINE_SCANNER,
        watermark,
      );
      expect(attr(span, ATTR_LOOP_OUTCOME)).toBe(LOOP_OUTCOME_EXCEPTION);
      expect(deadlineScannerMetrics.lastSettledAt).not.toBeNull();
    } finally {
      await app.close();
      vi.unstubAllEnvs();
      resetRuntimeConfigForTest();
    }
  });
});

// ── Retention pass wiring (real PostgreSQL) ─────────────────────────────────

describe("client-event retention pass wiring (real PostgreSQL)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function eventRow(name: string, receivedAt: Date) {
    return {
      userId: null,
      attemptId: null,
      examId: null,
      questionId: null,
      kind: "log",
      level: "info",
      name,
      route: null,
      occurredAt: receivedAt,
      receivedAt,
      clientSessionId: null,
      eventId: null,
      metadata: {},
      userAgent: null,
    };
  }

  it("an empty pass settles as outcome=empty; a pass with expired rows settles as success with deleted projected", async () => {
    const metricsBefore = await snapshotMetrics();

    const beforeEmpty = await beginSpanWindow();
    const emptyResult = await runClientEventRetentionOnce(ctx.app);
    const emptySpans = await endSpanWindow(beforeEmpty);

    expect(emptyResult.deletedCount).toBe(0);
    expect(emptyResult.failedOrganizationCount).toBe(0);
    const emptySpan = spansNamed(
      emptySpans,
      SPAN_LOOP_CLIENT_EVENT_RETENTION,
    )[0]!;
    expect(emptySpan.parentSpanId).toBeNull();
    expect(attr(emptySpan, ATTR_LOOP_OUTCOME)).toBe(LOOP_OUTCOME_EMPTY);

    // Expired rows for the seeded org: the next pass must delete them.
    const cutoff = new Date(Date.now() - 31 * DAY_MS);
    const sentinel = `bg-loop-retention-${randomUUID().slice(0, 8)}`;
    await createClientEventRepo(ctx.db).createMany(
      {
        actorId: randomUUID(),
        organizationId: ctx.org.id,
        role: "Admin",
        permissions: [],
        sessionId: randomUUID(),
      },
      [eventRow(sentinel, cutoff)],
    );

    const beforeDelete = await beginSpanWindow();
    const deleteResult = await runClientEventRetentionOnce(ctx.app);
    const deleteSpans = await endSpanWindow(beforeDelete);
    const metricsAfter = await snapshotMetrics();

    expect(deleteResult.deletedCount).toBeGreaterThanOrEqual(1);
    expect(deleteResult.failedOrganizationCount).toBe(0);
    const deleteSpan = spansNamed(
      deleteSpans,
      SPAN_LOOP_CLIENT_EVENT_RETENTION,
    )[0]!;
    expect(attr(deleteSpan, ATTR_LOOP_OUTCOME)).toBe(LOOP_OUTCOME_SUCCESS);
    expect(
      workCountOf(metricsAfter, LOOP_CLIENT_EVENT_RETENTION, WORK_DELETED) -
        workCountOf(metricsBefore, LOOP_CLIENT_EVENT_RETENTION, WORK_DELETED),
    ).toBe(deleteResult.deletedCount);
    expect(
      cycleCountOf(
        metricsAfter,
        LOOP_CLIENT_EVENT_RETENTION,
        LOOP_OUTCOME_EMPTY,
      ) -
        cycleCountOf(
          metricsBefore,
          LOOP_CLIENT_EVENT_RETENTION,
          LOOP_OUTCOME_EMPTY,
        ),
    ).toBe(1);
    expect(
      cycleCountOf(
        metricsAfter,
        LOOP_CLIENT_EVENT_RETENTION,
        LOOP_OUTCOME_SUCCESS,
      ) -
        cycleCountOf(
          metricsBefore,
          LOOP_CLIENT_EVENT_RETENTION,
          LOOP_OUTCOME_SUCCESS,
        ),
    ).toBe(1);
  });
});

// ── Email outbox poll wiring (real PostgreSQL, stub sender) ─────────────────

describe("email outbox poll cycle wiring (real PostgreSQL)", () => {
  // The email loop enforces the single-organization deployment contract
  // (waitForSingleOrganization), so it gets its OWN isolated database with
  // exactly one org — the shared buildTestApp db holds the deadline fixture
  // orgs and would keep the loop in bootstrap-forever.
  let db: Database;
  let cleanup: () => Promise<void>;
  let orgId: string;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("api-bg-loop-email-outbox");
    db = result.db;
    cleanup = result.cleanup;
    const organizationRepo = createOrganizationRepo(db);
    const org = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions: [],
        sessionId: "system",
      },
      {
        name: "org",
        displayName: "Org",
        slug: `slug-${randomUUID().slice(0, 8)}`,
      },
    );
    orgId = org.id;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("a delivering poll settles as outcome=success with sent processed; a quiet poll settles as empty", async () => {
    vi.stubEnv("EMAIL_WORKER_POLL_INTERVAL_MS", "100");
    vi.stubEnv("EMAIL_WORKER_BATCH_SIZE", "10");
    vi.stubEnv("EMAIL_WORKER_LOCK_TIMEOUT_MS", "30000");
    vi.stubEnv("EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS", "1000");
    resetRuntimeConfigForTest();

    const ts = new Date();
    await db.insert(emailOutbox).values({
      id: randomUUID(),
      organizationId: orgId,
      type: "grade_notification",
      recipientEmail: "to@example.com",
      subject: "s",
      bodyText: "t",
      bodyHtml: null,
      status: "pending",
      attemptCount: 0,
      maxAttempts: 3,
      lastError: null,
      nextAttemptAt: null,
      lockedAt: null,
      lockedBy: null,
      providerMessageId: null,
      dedupeKey: null,
      sentAt: null,
      createdAt: ts,
      updatedAt: ts,
    });

    const sender: EmailSender = {
      send: async () => ({ providerMessageId: `mid-${randomUUID()}` }),
    };
    const app = Fastify({ logger: false });
    app.decorate("db", db as never);
    app.decorate("now", () => new Date());
    app.decorate<EmailSender>("emailSender", sender);
    // Watermark BEFORE registration: the supervised loop starts polling
    // during register/ready, so the first (delivering) poll may settle before
    // ready() resolves — its span must be INSIDE the assertion window.
    const watermark = await beginSpanWindow();
    await app.register(emailOutboxLoopPlugin);
    await app.ready();

    try {
      // First poll delivers the pending row (success); later polls are quiet
      // (empty). Both outcomes must appear as rooted cycle spans.
      const successSpan = await waitForCycleSpan(
        SPAN_LOOP_EMAIL_OUTBOX,
        watermark,
        (s) => attr(s, ATTR_LOOP_OUTCOME) === LOOP_OUTCOME_SUCCESS,
        10_000,
      );
      expect(successSpan.parentSpanId).toBeNull();
      await waitForCycleSpan(
        SPAN_LOOP_EMAIL_OUTBOX,
        watermark,
        (s) => attr(s, ATTR_LOOP_OUTCOME) === LOOP_OUTCOME_EMPTY,
        10_000,
      );

      const snapshot = await snapshotMetrics();
      const series = cycleCountSeriesOf(snapshot, LOOP_EMAIL_OUTBOX);
      // Both outcomes recorded as series of the frozen metric.
      expect(
        series.some((k) =>
          k.includes(`"${ATTR_LOOP_OUTCOME}":"${LOOP_OUTCOME_SUCCESS}"`),
        ),
      ).toBe(true);
      expect(
        series.some((k) =>
          k.includes(`"${ATTR_LOOP_OUTCOME}":"${LOOP_OUTCOME_EMPTY}"`),
        ),
      ).toBe(true);
      expect(
        workCountOf(snapshot, LOOP_EMAIL_OUTBOX, WORK_SENT),
      ).toBeGreaterThanOrEqual(1);
      expect(
        workCountOf(snapshot, LOOP_EMAIL_OUTBOX, WORK_PROCESSED),
      ).toBeGreaterThanOrEqual(1);
    } finally {
      await app.close();
      vi.unstubAllEnvs();
      resetRuntimeConfigForTest();
    }
  }, 20_000);
});
