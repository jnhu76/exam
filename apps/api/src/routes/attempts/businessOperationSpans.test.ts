import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetRuntimeConfigForTest } from "../../config/runtimeConfig.js";
import {
  flushRetainedSpansForDiagnostics,
  getRetainedSpansForDiagnostics,
  initTelemetry,
  shutdownTelemetry,
  type TelemetryRuntimeHandle,
} from "../../telemetry/runtime.js";
import { withBusinessOperationSpan } from "../../telemetry/businessOperationSpan.js";
import {
  ATTR_OP_ATTEMPT_ID,
  ATTR_OP_CLIENT_SEQ,
  ATTR_OP_ERROR_CODE,
  ATTR_OP_EXAM_ID,
  ATTR_OP_OPERATION_ID,
  ATTR_OP_OUTCOME,
  ATTR_OP_QUESTION_ID,
  ATTR_OP_RESULT,
  OUTCOME_EXCEPTION,
  OUTCOME_NO_OP,
  OUTCOME_REJECTED,
  OUTCOME_SUCCESS,
  SPAN_ATTEMPT_ANSWER_SAVE,
  SPAN_ATTEMPT_DEADLINE_AUTO_SUBMIT,
  SPAN_ATTEMPT_DEADLINE_RECONCILE,
  SPAN_ATTEMPT_FORCE_SUBMIT,
  SPAN_ATTEMPT_GRADE,
  SPAN_ATTEMPT_RESTORE,
  SPAN_ATTEMPT_START,
  SPAN_ATTEMPT_SUBMIT,
  SPAN_ATTEMPT_TIME_GRANT,
  START_RESULT_NEW,
} from "../../telemetry/businessOperationVocabulary.js";
import { NotFoundError } from "@exam/domain";
import { autoSubmitAndGrade } from "../../plugins/deadlineScanner.js";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/schema/pg";
import {
  buildExamPayload,
  createIsolatedAttemptOrg,
  disruptAttempt,
  type IsolatedAttemptOrg,
} from "./__tests__/attempts.testHelpers.js";

/**
 * Business operation span integration tests (#964 W3): the nine wired
 * critical-operation boundaries observed over the REAL routes, REAL engine
 * commands, and REAL PostgreSQL, inside ONE telemetry session per process
 * (`TELEMETRY_EXPORTER=memory`). The OTel API registers its global provider
 * one-way per process, so this file owns a single session; assertions read
 * before/after deltas of the retained (scrubbed) span buffer.
 *
 * Coverage per the W3.1 contract: success, value-shaped business rejection
 * (save protocol), thrown business rejection (domain error), exception
 * classification, HTTP-request-granularity vs business-operation granularity
 * for retries, the deadline reconcile entries (read-time frozen/unchanged,
 * background submitted/skipped), and the owner-count/parent shape of the
 * trace (1 request root → handler → business span → db spans).
 */

type RetainedSpan = ReturnType<typeof getRetainedSpansForDiagnostics>[number];

let handle: TelemetryRuntimeHandle | null = null;

// TestContext from buildTestApp — the combined plugin wires the otel
// span-owner plugin before the route surfaces.
let ctx: Awaited<ReturnType<typeof buildTestApp>>;

const SCANNER_CTX = {
  actorId: "system:deadline-scanner",
  organizationId: "",
  role: "System" as const,
  permissions: [] as import("@exam/domain").Permission[],
  sessionId: "system:deadline-scanner",
  targetOrganizationId: "",
};

/**
 * Begins a span window: flushes the batch queue first (so fixture spans
 * queued before the window cannot leak into it), then snapshots the SET of
 * already-retained span ids. The watermark is immune to both (a) pre-window
 * queued spans and (b) the ring buffer trimming old entries once its
 * 1000-span cap is reached — either would falsify an index-based delta.
 */
async function beginSpanWindow(): Promise<Set<string>> {
  await flushRetainedSpansForDiagnostics();
  return new Set(getRetainedSpansForDiagnostics().map((s) => s.spanId));
}

/** Flushes the batch queue and returns every span retained INSIDE the window. */
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

function expectBusinessSpan(spans: RetainedSpan[], name: string): RetainedSpan {
  const matching = spansNamed(spans, name);
  expect(matching, `exactly one ${name} span in the delta`).toHaveLength(1);
  return matching[0]!;
}

function backdateDeadline(attemptId: string): Promise<void> {
  const past = new Date(Date.now() - 60_000);
  return ctx.db
    .update(schema.examAttempts)
    .set({ deadlineAt: past })
    .where(eq(schema.examAttempts.id, attemptId))
    .then(() => undefined);
}

async function createOrg(
  label: string,
  questionType: "single_choice" | "text_response" = "single_choice",
): Promise<IsolatedAttemptOrg> {
  return createIsolatedAttemptOrg(ctx, {
    slugPrefix: "biz-span-test-",
    label,
    questionType,
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

async function startAttempt(
  examId: string,
  token: string,
): Promise<{ attemptId: string; spans: RetainedSpan[] }> {
  const before = await beginSpanWindow();
  const res = await ctx.app.inject({
    method: "POST",
    url: `/api/attempts/${examId}/start`,
    cookies: { "auth-token": token },
  });
  const spans = await endSpanWindow(before);
  expect(res.statusCode).toBe(201);
  return { attemptId: res.json().id as string, spans };
}

async function saveAnswer(
  attemptId: string,
  questionId: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<{
  status: number;
  body: Record<string, unknown>;
  spans: RetainedSpan[];
}> {
  const before = await beginSpanWindow();
  const res = await ctx.app.inject({
    method: "POST",
    url: `/api/attempts/${attemptId}/answers/${questionId}`,
    payload: { attemptId, questionId, ...payload },
    cookies: { "auth-token": token },
  });
  const spans = await endSpanWindow(before);
  return { status: res.statusCode, body: res.json(), spans };
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
  const combinedPlugin: FastifyPluginAsync = async (fastify) => {
    // Registration-order contract (mirrors server.ts): the span-owner plugin
    // registers BEFORE any route surface.
    await fastify.register(handle!.fastifyOtelPlugin);
    await fastify.register(examRoutes, { prefix: "" });
    await fastify.register(attemptRoutes, { prefix: "" });
  };
  ctx = await buildTestApp(combinedPlugin);
  SCANNER_CTX.organizationId = ctx.org.id;
  SCANNER_CTX.targetOrganizationId = ctx.org.id;
});

afterAll(async () => {
  await ctx.cleanup();
  await shutdownTelemetry();
  vi.unstubAllEnvs();
  resetRuntimeConfigForTest();
});

describe("business operation span helper contract", () => {
  it("marks a successful operation with outcome=success and returns its result unchanged", async () => {
    const before = await beginSpanWindow();
    const result = await withBusinessOperationSpan(
      SPAN_ATTEMPT_START,
      {},
      async () => "payload",
    );
    const spans = await endSpanWindow(before);
    expect(result).toBe("payload");
    const span = expectBusinessSpan(spans, SPAN_ATTEMPT_START);
    expect(attr(span, ATTR_OP_OUTCOME)).toBe(OUTCOME_SUCCESS);
    expect(span.status).toBe("unset");
  });

  it("classifies a thrown 4xx domain error as rejected with the envelope error code", async () => {
    const thrown = new NotFoundError("Attempt not found");
    let caught: unknown = null;
    const before = await beginSpanWindow();
    await withBusinessOperationSpan(SPAN_ATTEMPT_SUBMIT, {}, async () => {
      throw thrown;
    }).catch((err: unknown) => {
      caught = err;
    });
    const spans = await endSpanWindow(before);
    expect(caught).toBe(thrown);
    const span = expectBusinessSpan(spans, SPAN_ATTEMPT_SUBMIT);
    expect(attr(span, ATTR_OP_OUTCOME)).toBe(OUTCOME_REJECTED);
    // The span carries the SAME normalized code the wire envelope would.
    expect(attr(span, ATTR_OP_ERROR_CODE)).toBe("RESOURCE_NOT_FOUND");
    // A business rejection is not a span-transport failure: status stays unset.
    expect(span.status).toBe("unset");
  });

  it("classifies an unexpected exception and never records its message", async () => {
    const sentinel = new Error("boom-with-potentially-sensitive-detail");
    let caught: unknown = null;
    const before = await beginSpanWindow();
    await withBusinessOperationSpan(SPAN_ATTEMPT_GRADE, {}, async () => {
      throw sentinel;
    }).catch((err: unknown) => {
      caught = err;
    });
    const spans = await endSpanWindow(before);
    expect(caught).toBe(sentinel);
    const span = expectBusinessSpan(spans, SPAN_ATTEMPT_GRADE);
    expect(attr(span, ATTR_OP_OUTCOME)).toBe(OUTCOME_EXCEPTION);
    expect(span.status).toBe("error");
    // The raw message never enters the attributes (no exception.message, no
    // exception event — W2 attribute-safety posture at the API layer).
    const attributeDump = JSON.stringify(span.attributes);
    expect(attributeDump).not.toContain(
      "boom-with-potentially-sensitive-detail",
    );
  });

  it("marks a value-shaped no-op when the body refines the outcome", async () => {
    const before = await beginSpanWindow();
    const result = await withBusinessOperationSpan(
      SPAN_ATTEMPT_DEADLINE_AUTO_SUBMIT,
      {},
      async (span) => {
        span.setAttribute(ATTR_OP_OUTCOME, OUTCOME_NO_OP);
        return false;
      },
    );
    const spans = await endSpanWindow(before);
    expect(result).toBe(false);
    const span = expectBusinessSpan(spans, SPAN_ATTEMPT_DEADLINE_AUTO_SUBMIT);
    expect(attr(span, ATTR_OP_OUTCOME)).toBe(OUTCOME_NO_OP);
  });

  it("contains a broken span machinery: the operation still runs to its result", async () => {
    // A throwing-attributes proxy makes startSpan fail BEFORE the operation
    // body runs; the helper must fall back to running the body (contained),
    // and the business result is unchanged.
    const hostileAttributes = new Proxy(
      {},
      {
        get: () => {
          throw new Error("broken-span-machinery");
        },
      },
    );
    const before = await beginSpanWindow();
    const result = await withBusinessOperationSpan(
      SPAN_ATTEMPT_START,
      hostileAttributes,
      async () => "business-result-intact",
    );
    const spans = await endSpanWindow(before);
    // The containment contract: the business result is unchanged regardless
    // of what the span machinery did.
    expect(result).toBe("business-result-intact");
  });
});

describe("wired critical operations over real routes (telemetry On)", () => {
  it("start: one business span under the handler span, exam/attempt ids attached", async () => {
    const t = await createOrg("Start");
    const examId = await createPublishedEnrolledExam(t, "Biz Span Start Exam");
    const { attemptId, spans } = await startAttempt(examId, t.candidateToken);

    const startSpan = expectBusinessSpan(spans, SPAN_ATTEMPT_START);
    expect(attr(startSpan, ATTR_OP_OUTCOME)).toBe(OUTCOME_SUCCESS);
    expect(attr(startSpan, ATTR_OP_RESULT)).toBe(START_RESULT_NEW);
    expect(attr(startSpan, ATTR_OP_EXAM_ID)).toBe(examId);
    expect(attr(startSpan, ATTR_OP_ATTEMPT_ID)).toBe(attemptId);

    // Parent chain: exactly one request root → handler → business span.
    // (@fastify/otel names the handler span `handler - <handlerName>`.)
    const roots = spans.filter((s) => s.parentSpanId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.name).toBe("request");
    const handlers = spans.filter((s) => s.name.startsWith("handler - "));
    expect(handlers).toHaveLength(1);
    expect(handlers[0]!.parentSpanId).toBe(roots[0]!.spanId);
    expect(startSpan.parentSpanId).toBe(handlers[0]!.spanId);
  });

  it("save: accepted → success; stale-version protocol rejection → rejected with the protocol reason", async () => {
    const t = await createOrg("Save");
    const examId = await createPublishedEnrolledExam(t, "Biz Span Save Exam");
    const { attemptId } = await startAttempt(examId, t.candidateToken);

    const first = await saveAnswer(attemptId, t.questionId, t.candidateToken, {
      answer: "b",
      clientSeq: 1,
      clientSavedAt: new Date().toISOString(),
      baseVersion: 0,
    });
    expect(first.status).toBe(200);
    expect(first.body.accepted).toBe(true);
    const acceptedSpan = expectBusinessSpan(
      first.spans,
      SPAN_ATTEMPT_ANSWER_SAVE,
    );
    expect(attr(acceptedSpan, ATTR_OP_OUTCOME)).toBe(OUTCOME_SUCCESS);
    expect(attr(acceptedSpan, ATTR_OP_RESULT)).toBe("accepted");
    expect(attr(acceptedSpan, ATTR_OP_ATTEMPT_ID)).toBe(attemptId);
    expect(attr(acceptedSpan, ATTR_OP_QUESTION_ID)).toBe(t.questionId);
    expect(attr(acceptedSpan, ATTR_OP_CLIENT_SEQ)).toBe(1);

    // The same client retrying with the stale base version: a NEW HTTP
    // request with a NEW server-minted requestId, observed by a NEW business
    // span in its OWN trace — per-request granularity. The server refusal is
    // a value-shaped 200 rejection carrying the protocol reason.
    const second = await saveAnswer(attemptId, t.questionId, t.candidateToken, {
      answer: "b",
      clientSeq: 2,
      clientSavedAt: new Date().toISOString(),
      baseVersion: 0,
    });
    expect(second.status).toBe(200);
    expect(second.body.accepted).toBe(false);
    const rejectedSpan = expectBusinessSpan(
      second.spans,
      SPAN_ATTEMPT_ANSWER_SAVE,
    );
    expect(attr(rejectedSpan, ATTR_OP_OUTCOME)).toBe(OUTCOME_REJECTED);
    expect(attr(rejectedSpan, ATTR_OP_RESULT)).toBe("STALE_VERSION");
    expect(attr(rejectedSpan, ATTR_OP_ERROR_CODE)).toBeUndefined();

    // Per-request vs per-operation granularity: two business spans, two
    // distinct server-rooted traces, one request root each.
    expect(rejectedSpan.traceId).not.toBe(acceptedSpan.traceId);
    const firstRoots = first.spans.filter((s) => s.parentSpanId === null);
    const secondRoots = second.spans.filter((s) => s.parentSpanId === null);
    expect(firstRoots).toHaveLength(1);
    expect(secondRoots).toHaveLength(1);
    expect(firstRoots[0]!.traceId).not.toBe(secondRoots[0]!.traceId);
  });

  it("submit: one business span owns the orchestrator; the db transaction spans hang under it", async () => {
    const t = await createOrg("Submit");
    const examId = await createPublishedEnrolledExam(t, "Biz Span Submit Exam");
    const { attemptId } = await startAttempt(examId, t.candidateToken);
    const saved = await saveAnswer(attemptId, t.questionId, t.candidateToken, {
      answer: "b",
      clientSeq: 1,
      clientSavedAt: new Date().toISOString(),
      baseVersion: 0,
    });
    expect(saved.body.accepted).toBe(true);

    const before = await beginSpanWindow();
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": t.candidateToken },
    });
    const spans = await endSpanWindow(before);
    expect(res.statusCode).toBe(200);
    const submitSpan = expectBusinessSpan(spans, SPAN_ATTEMPT_SUBMIT);
    expect(attr(submitSpan, ATTR_OP_OUTCOME)).toBe(OUTCOME_SUCCESS);
    expect(attr(submitSpan, ATTR_OP_ATTEMPT_ID)).toBe(attemptId);

    // Owner count: exactly one request root and one submit owner per request.
    const roots = spans.filter((s) => s.parentSpanId === null);
    expect(roots).toHaveLength(1);
    expect(spansNamed(spans, SPAN_ATTEMPT_SUBMIT)).toHaveLength(1);

    // The W2 logical transaction layer parents under the business span —
    // single measurement per layer, no second attribution vocabulary.
    const txSpans = spansNamed(spans, "db.transaction");
    expect(txSpans.length).toBeGreaterThanOrEqual(1);
    expect(
      txSpans.filter((tx) => tx.parentSpanId === submitSpan.spanId).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("restore: the engine lifecycle union is the span result fact", async () => {
    const t = await createOrg("Restore");
    const examId = await createPublishedEnrolledExam(
      t,
      "Biz Span Restore Exam",
    );
    const { attemptId } = await startAttempt(examId, t.candidateToken);
    await disruptAttempt(ctx.db, t.orgId, attemptId);

    const before = await beginSpanWindow();
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/restore`,
      cookies: { "auth-token": t.candidateToken },
    });
    const spans = await endSpanWindow(before);
    expect(res.statusCode).toBe(200);
    expect(res.json().lifecycle).toBe("restored");
    const restoreSpan = expectBusinessSpan(spans, SPAN_ATTEMPT_RESTORE);
    expect(attr(restoreSpan, ATTR_OP_OUTCOME)).toBe(OUTCOME_SUCCESS);
    expect(attr(restoreSpan, ATTR_OP_RESULT)).toBe("restored");
    expect(attr(restoreSpan, ATTR_OP_ATTEMPT_ID)).toBe(attemptId);
  });

  it("deadline reconcile (read-time): take on an unexpired attempt records unchanged", async () => {
    const t = await createOrg("TakeUnchanged");
    const examId = await createPublishedEnrolledExam(
      t,
      "Biz Span Take Unchanged Exam",
    );
    const { attemptId } = await startAttempt(examId, t.candidateToken);

    const before = await beginSpanWindow();
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${attemptId}/take`,
      cookies: { "auth-token": t.candidateToken },
    });
    const spans = await endSpanWindow(before);
    expect(res.statusCode).toBe(200);
    const reconcileSpan = expectBusinessSpan(
      spans,
      SPAN_ATTEMPT_DEADLINE_RECONCILE,
    );
    expect(attr(reconcileSpan, ATTR_OP_OUTCOME)).toBe(OUTCOME_SUCCESS);
    expect(attr(reconcileSpan, ATTR_OP_RESULT)).toBe("unchanged");
  });

  it("deadline reconcile (read-time): take on an expired attempt records frozen without changing the deadline verdict", async () => {
    const t = await createOrg("TakeFrozen");
    const examId = await createPublishedEnrolledExam(
      t,
      "Biz Span Take Frozen Exam",
    );
    const { attemptId } = await startAttempt(examId, t.candidateToken);
    await backdateDeadline(attemptId);

    const before = await beginSpanWindow();
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${attemptId}/take`,
      cookies: { "auth-token": t.candidateToken },
    });
    const spans = await endSpanWindow(before);
    expect(res.statusCode).toBe(200);
    // The read-time entry froze the attempt exactly as the engine always did
    // (business valid submittedAt = the effective deadline, not the read).
    const body = res.json();
    expect(["submitted", "graded"]).toContain(body.attemptStatus);
    const reconcileSpan = expectBusinessSpan(
      spans,
      SPAN_ATTEMPT_DEADLINE_RECONCILE,
    );
    expect(attr(reconcileSpan, ATTR_OP_RESULT)).toBe("frozen");
  });

  it("grade: scoring an auto-graded attempt is a rejected business outcome; a pending_manual completion succeeds", async () => {
    const t = await createOrg("Grade");
    const examId = await createPublishedEnrolledExam(t, "Biz Span Grade Exam");
    const { attemptId } = await startAttempt(examId, t.candidateToken);
    const saved = await saveAnswer(attemptId, t.questionId, t.candidateToken, {
      answer: "b",
      clientSeq: 1,
      clientSavedAt: new Date().toISOString(),
      baseVersion: 0,
    });
    expect(saved.body.accepted).toBe(true);
    const submitted = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": t.candidateToken },
    });
    expect(submitted.statusCode).toBe(200);

    // A single_choice attempt grades automatically → manual scoring is a
    // thrown domain rejection (InvalidStateTransitionError, 409).
    const before = await beginSpanWindow();
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: t.questionId, score: 50, comment: "" },
      cookies: { "auth-token": t.adminToken },
    });
    const spans = await endSpanWindow(before);
    expect(res.statusCode).toBe(409);
    const rejectedSpan = expectBusinessSpan(spans, SPAN_ATTEMPT_GRADE);
    expect(attr(rejectedSpan, ATTR_OP_OUTCOME)).toBe(OUTCOME_REJECTED);
    expect(attr(rejectedSpan, ATTR_OP_ERROR_CODE)).toBe(
      "INVALID_STATE_TRANSITION",
    );

    // Success path: a text_response attempt holds at pending_manual; the
    // manual grade completes it (one-way) and the span observes success.
    const t2 = await createOrg("GradeOk", "text_response");
    const examId2 = await createPublishedEnrolledExam(
      t2,
      "Biz Span Grade Ok Exam",
    );
    const { attemptId: manualAttemptId } = await startAttempt(
      examId2,
      t2.candidateToken,
    );
    const textSaved = await saveAnswer(
      manualAttemptId,
      t2.questionId,
      t2.candidateToken,
      {
        answer: "考生作答内容",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
    );
    expect(textSaved.body.accepted).toBe(true);
    const manualSubmitted = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${manualAttemptId}/submit`,
      cookies: { "auth-token": t2.candidateToken },
    });
    // A pending_manual attempt holds at `submitted` — the manual-grading
    // queue owns the terminal transition (LoadAttemptResponse has no
    // gradingStatus field; the grade-question success below proves the
    // pending entry was materialized).
    expect(manualSubmitted.json().status).toBe("submitted");

    const gradedBefore = await beginSpanWindow();
    const graded = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${manualAttemptId}/grade-question`,
      payload: { questionId: t2.questionId, score: 80, comment: "ok" },
      cookies: { "auth-token": t2.adminToken },
    });
    const gradedSpans = await endSpanWindow(gradedBefore);
    expect(graded.statusCode).toBe(200);
    expect(graded.json().fullyGraded).toBe(true);
    const okSpan = expectBusinessSpan(gradedSpans, SPAN_ATTEMPT_GRADE);
    expect(attr(okSpan, ATTR_OP_OUTCOME)).toBe(OUTCOME_SUCCESS);
    expect(attr(okSpan, ATTR_OP_QUESTION_ID)).toBe(t2.questionId);
  });

  it("time grant + force submit: the command identity and disposition unions are the span facts", async () => {
    const t = await createOrg("Command");
    // The grant command requires an operator_incident interruption policy
    // snapshot (frozen from the exam's interruptionTimePolicy at attempt
    // creation) — same fixture contract as admin-time-grants.test.ts.
    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...buildExamPayload({
          title: "Biz Span Command Exam",
          courseId: t.courseId,
          questionIds: [t.questionId],
        }),
        interruptionTimePolicy: "operator_incident",
      },
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
    const { attemptId } = await startAttempt(examId, t.candidateToken);

    // Time grant on the in-progress attempt.
    const grantOperationId = crypto.randomUUID();
    const grantBefore = await beginSpanWindow();
    const grant = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/time-grants`,
      payload: {
        operationId: grantOperationId,
        addedSeconds: 300,
        reasonCode: "operator_extend",
        reasonText: "proctor authorized extension",
      },
      cookies: { "auth-token": t.adminToken },
    });
    const grantSpans = await endSpanWindow(grantBefore);
    expect(grant.statusCode).toBe(200);
    expect(grant.json().outcome).toBe("granted");
    const grantSpan = expectBusinessSpan(grantSpans, SPAN_ATTEMPT_TIME_GRANT);
    expect(attr(grantSpan, ATTR_OP_OUTCOME)).toBe(OUTCOME_SUCCESS);
    expect(attr(grantSpan, ATTR_OP_RESULT)).toBe("granted");
    expect(attr(grantSpan, ATTR_OP_OPERATION_ID)).toBe(grantOperationId);
    expect(attr(grantSpan, ATTR_OP_ATTEMPT_ID)).toBe(attemptId);

    // Force submit the in-progress attempt (applied), then replay the same
    // operationId (idempotent_replay — one span per HTTP command, each
    // carrying the receipt's own disposition).
    const submitOperationId = crypto.randomUUID();
    const forceSubmitBefore = await beginSpanWindow();
    const forceSubmit = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/force-submit`,
      payload: {
        operationId: submitOperationId,
        reason: "proctor observed misconduct",
      },
      cookies: { "auth-token": t.adminToken },
    });
    const forceSubmitSpans = await endSpanWindow(forceSubmitBefore);
    expect(forceSubmit.statusCode).toBe(200);
    expect(forceSubmit.json().disposition).toBe("applied");
    const appliedSpan = expectBusinessSpan(
      forceSubmitSpans,
      SPAN_ATTEMPT_FORCE_SUBMIT,
    );
    expect(attr(appliedSpan, ATTR_OP_OUTCOME)).toBe(OUTCOME_SUCCESS);
    expect(attr(appliedSpan, ATTR_OP_RESULT)).toBe("applied");
    expect(attr(appliedSpan, ATTR_OP_OPERATION_ID)).toBe(submitOperationId);

    const replayBefore = await beginSpanWindow();
    const replay = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/force-submit`,
      payload: {
        operationId: submitOperationId,
        reason: "proctor observed misconduct",
      },
      cookies: { "auth-token": t.adminToken },
    });
    const replaySpans = await endSpanWindow(replayBefore);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().disposition).toBe("idempotent_replay");
    const replaySpan = expectBusinessSpan(
      replaySpans,
      SPAN_ATTEMPT_FORCE_SUBMIT,
    );
    expect(attr(replaySpan, ATTR_OP_RESULT)).toBe("idempotent_replay");
    expect(replaySpan.traceId).not.toBe(appliedSpan.traceId);
  });

  it("deadline auto-submit (background): self-rooted trace; submitted vs stale-discovery no_op", async () => {
    const t = await createOrg("AutoSubmit");
    const examId = await createPublishedEnrolledExam(
      t,
      "Biz Span AutoSubmit Exam",
    );
    const { attemptId } = await startAttempt(examId, t.candidateToken);
    await backdateDeadline(attemptId);

    const scannerCtx = {
      ...SCANNER_CTX,
      organizationId: t.orgId,
      targetOrganizationId: t.orgId,
    };

    // First call: the attempt is genuinely expired → submitted+graded.
    const firstBefore = await beginSpanWindow();
    const first = await autoSubmitAndGrade(
      ctx.db,
      scannerCtx,
      attemptId,
      new Date(),
    );
    const firstSpans = await endSpanWindow(firstBefore);
    expect(first).toBe(true);
    const submittedSpan = expectBusinessSpan(
      firstSpans,
      SPAN_ATTEMPT_DEADLINE_AUTO_SUBMIT,
    );
    expect(attr(submittedSpan, ATTR_OP_OUTCOME)).toBe(OUTCOME_SUCCESS);
    expect(attr(submittedSpan, ATTR_OP_RESULT)).toBe("submitted");
    expect(attr(submittedSpan, ATTR_OP_ATTEMPT_ID)).toBe(attemptId);
    // Background entry: no HTTP requestId is fabricated — the span roots its
    // own trace (observability contract §Background work).
    expect(submittedSpan.parentSpanId).toBeNull();
    expect(firstSpans.filter((s) => s.name === "request")).toHaveLength(0);

    // Second call: the attempt is already graded → the under-lock recheck
    // skips → legitimate no_op, not a rejection.
    const secondBefore = await beginSpanWindow();
    const second = await autoSubmitAndGrade(
      ctx.db,
      scannerCtx,
      attemptId,
      new Date(),
    );
    const secondSpans = await endSpanWindow(secondBefore);
    expect(second).toBe(false);
    const skippedSpan = expectBusinessSpan(
      secondSpans,
      SPAN_ATTEMPT_DEADLINE_AUTO_SUBMIT,
    );
    expect(attr(skippedSpan, ATTR_OP_OUTCOME)).toBe(OUTCOME_NO_OP);
    expect(attr(skippedSpan, ATTR_OP_RESULT)).toBe("skipped");
  });
});
