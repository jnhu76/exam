import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { TestContext } from "../testHelpers.js";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";

/**
 * Default exam control flags used by the shared attempt-route fixture and any
 * test that builds an exam payload via {@link buildExamPayload}.
 */
export const DEFAULT_CONTROL_FLAGS = {
  shuffleQuestions: false,
  shuffleOptions: false,
  detectTabSwitch: false,
  disableCopyPaste: false,
  requireQueue: false,
  batchSize: 10,
  batchInterval: 3,
  restrictIp: false,
  requireLockdown: false,
  showResultImmediately: true,
} as const;

/**
 * Builds a create-exam payload from partial overrides, filling in the same
 * defaults the original attempts.test.ts used (timed_window, manual selection,
 * a 1h-past openAt / 24h-future closeAt window, unlimited retakes, etc.).
 */
export function buildExamPayload(
  overrides: Partial<{
    title: string;
    courseId: string;
    questionIds: string[];
    controlFlags: object;
    retakePolicy: string;
    scoreStrategy: string;
    maxAttempts: number;
    passingScore: number;
    totalScore: number;
    durationMinutes: number;
    minSubmitAfterStartMinutes: number | null;
    latestStartOffsetMinutes: number | null;
  }> = {},
) {
  return {
    title: overrides.title ?? "Test Exam",
    description: "",
    courseId: overrides.courseId ?? "",
    timingMode: "timed_window" as const,
    durationMinutes: overrides.durationMinutes ?? 60,
    openAt: new Date(Date.now() - 3600000).toISOString(),
    closeAt: new Date(Date.now() + 86400000).toISOString(),
    passingScore: overrides.passingScore ?? 60,
    totalScore: overrides.totalScore ?? 100,
    questionSelectionMode: "manual" as const,
    questionIds: overrides.questionIds ?? [],
    controlFlags: overrides.controlFlags ?? { ...DEFAULT_CONTROL_FLAGS },
    retakePolicy: overrides.retakePolicy ?? "unlimited",
    scoreStrategy: overrides.scoreStrategy ?? "highest",
    maxAttempts: overrides.maxAttempts ?? 3,
    minSubmitAfterStartMinutes: overrides.minSubmitAfterStartMinutes ?? null,
    latestStartOffsetMinutes: overrides.latestStartOffsetMinutes ?? null,
  };
}

/**
 * Enrolls the shared fixture's candidate profile into the given exam via the
 * admin enrollment API. Extracted verbatim from the original attempts.test.ts
 * outer-describe helper (which closed over `ctx` and `candidateProfileId`);
 * here those are passed explicitly so shared-fixture test files can reuse it.
 */
export async function enrollCandidateForExam(
  ctx: TestContext,
  candidateProfileId: string,
  examId: string,
) {
  await ctx.app.inject({
    method: "POST",
    url: `/api/exams/${examId}/enrollments`,
    payload: { candidateIds: [candidateProfileId] },
    cookies: { "auth-token": ctx.adminToken },
  });
}

/**
 * Ensures a candidate profile row exists for the shared fixture's candidate
 * user, returning its id. Reused across the candidate-runtime test files.
 */
export async function ensureCandidateProfile(
  ctx: TestContext,
): Promise<string> {
  const existing = await ctx.db
    .select({ id: schema.candidateProfiles.id })
    .from(schema.candidateProfiles)
    .where(eq(schema.candidateProfiles.userId, ctx.candidate.id));
  if (existing[0]) return existing[0].id;
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.candidateProfiles).values({
    id,
    organizationId: ctx.org.id,
    userId: ctx.candidate.id,
    fields: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

/**
 * Result of {@link buildSharedAttemptFixture}: the shared app/context plus the
 * ids of the course, questions, published exam, and enrolled candidate profile
 * that the shared-fixture attempt-route tests depend on.
 */
export interface SharedAttemptFixture {
  ctx: TestContext;
  examId: string;
  courseId: string;
  questionId: string;
  fillBlankQuestionId: string;
  candidateProfileId: string;
}

/**
 * Reproduces the original `attempts.test.ts` outer `beforeAll` setup verbatim:
 * builds the test app (examRoutes + attemptRoutes), seeds a course, a
 * single_choice question, a fill_blank question, a candidate profile, then
 * creates + publishes + enrolls an exam. Call once per shared-fixture file's
 * outer `beforeAll`; pair with `ctx.cleanup()` in `afterAll`.
 */
export async function buildSharedAttemptFixture(): Promise<SharedAttemptFixture> {
  const ctx = await buildTestApp(async (fastify) => {
    await fastify.register(examRoutes, { prefix: "" });
    await fastify.register(attemptRoutes, { prefix: "" });
  });

  const courseId = crypto.randomUUID();
  const questionId = crypto.randomUUID();
  const fillBlankQuestionId = crypto.randomUUID();

  await ctx.db.insert(schema.courses).values({
    id: courseId,
    organizationId: ctx.org.id,
    name: "Test Course",
    code: `TC-${uniquePrefix()}`,
    description: "Test",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await ctx.db.insert(schema.questions).values({
    id: questionId,
    organizationId: ctx.org.id,
    courseId,
    type: "single_choice",
    content: "What is 1+1?",
    options: [
      { id: "a", content: "1" },
      { id: "b", content: "2" },
      { id: "c", content: "3" },
    ],
    standardAnswer: "b",
    attachments: [],
    score: 100,
    difficulty: 1,
    tags: [],
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await ctx.db.insert(schema.questions).values({
    id: fillBlankQuestionId,
    organizationId: ctx.org.id,
    courseId,
    type: "fill_blank",
    content: "安全出口标识的颜色是____色",
    options: [],
    standardAnswer: "绿",
    attachments: [],
    score: 100,
    difficulty: 1,
    tags: [],
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const candidateProfileId = await ensureCandidateProfile(ctx);

  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/exams",
    payload: buildExamPayload({
      title: "Attempt Test Exam",
      courseId,
      questionIds: [questionId],
    }),
    cookies: { "auth-token": ctx.adminToken },
  });
  if (res.statusCode !== 201) {
    throw new Error(
      `Failed to create exam: ${res.statusCode} ${JSON.stringify(res.json())}`,
    );
  }
  const examId = res.json().id;

  await ctx.app.inject({
    method: "POST",
    url: `/api/exams/${examId}/publish`,
    cookies: { "auth-token": ctx.adminToken },
  });

  await ctx.app.inject({
    method: "POST",
    url: `/api/exams/${examId}/enrollments`,
    payload: { candidateIds: [candidateProfileId] },
    cookies: { "auth-token": ctx.adminToken },
  });

  return {
    ctx,
    examId,
    courseId,
    questionId,
    fillBlankQuestionId,
    candidateProfileId,
  };
}

/**
 * Lists the attempt-command receipts for an attempt, oldest first. Shared by
 * the force-submit / misconduct durable-command test files.
 */
export async function listReceipts(ctx: TestContext, attemptId: string) {
  return ctx.db
    .select()
    .from(schema.attemptCommandReceipts)
    .where(eq(schema.attemptCommandReceipts.attemptId, attemptId))
    .orderBy(schema.attemptCommandReceipts.createdAt);
}

/**
 * Counts the `attempt.misconductFlagged` audit rows for an attempt, filtering
 * the action IN SQL (no JavaScript-side filtering). Drains pending audit
 * writes first so the count is stable.
 */
export async function countMisconductAudits(
  ctx: TestContext,
  attemptId: string,
) {
  await ctx.drainAuditWrites();
  return ctx.db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.targetId, attemptId),
        eq(schema.auditLogs.action, "attempt.misconductFlagged"),
      ),
    );
}

/**
 * Properly transitions an in_progress attempt to disrupted by creating the
 * interruption episode + detected event + setting the active pointer, as
 * required by the exam_attempts_status_pointer_check CHECK constraint.
 */
export async function disruptAttempt(
  db: TestContext["db"],
  organizationId: string,
  attemptId: string,
  overrides: {
    interruptedAt?: Date;
    lastActivityAt?: Date;
    policy?: "strict" | "bounded_grace" | "operator_incident";
  } = {},
): Promise<void> {
  const episodeId = randomUUID();
  const now = overrides.interruptedAt ?? new Date();
  const policy = overrides.policy ?? "strict";
  await db.insert(schema.attemptInterruptions).values({
    id: episodeId,
    organizationId,
    attemptId,
    createdAt: now,
  });
  await db.insert(schema.attemptInterruptionEvents).values({
    id: randomUUID(),
    organizationId,
    attemptId,
    interruptionId: episodeId,
    eventType: "detected",
    occurredAt: now,
    observedLastActivityAt: overrides.lastActivityAt ?? now,
    detectionSource: "heartbeat_timeout",
    timeoutSeconds: 60,
    policy,
    reasonCode: "heartbeat_timeout",
    createdAt: now,
  });
  await db
    .update(schema.examAttempts)
    .set({
      status: "disrupted",
      currentInterruptionId: episodeId,
      interruptedAt: now,
      updatedAt: now,
      ...(overrides.lastActivityAt && {
        lastActivityAt: overrides.lastActivityAt,
      }),
    })
    .where(eq(schema.examAttempts.id, attemptId));
}
