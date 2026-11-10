import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyLoggerOptions } from "fastify";
import type { TestContext } from "../../testHelpers.js";
import { buildTestApp, uniquePrefix } from "../../testHelpers.js";
import examRoutes from "../../exam.js";
import attemptRoutes from "../../attempts.js";
import { schema } from "@exam/db/schema/pg";
import { signJWT } from "@exam/auth/session";
import { hashPassword } from "@exam/auth/password";
import { getRuntimeConfig } from "../../../config/runtimeConfig.js";
import type { Role } from "@exam/domain";

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
 * Builds a create-exam payload from partial overrides, filling in the shared
 * attempt-route fixture defaults (timed_window, manual selection, a past openAt
 * / future closeAt window, unlimited retakes, etc.).
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
    // #291: deadline/untimed carry null duration; untimed also nulls
    // closeAt (the payload builder below handles that from timingMode).
    timingMode: "timed_window" | "deadline" | "untimed";
    durationMinutes: number | null;
    closeAt: string | null;
    minSubmitAfterStartMinutes: number | null;
    latestStartOffsetMinutes: number | null;
  }> = {},
) {
  const untimed = overrides.timingMode === "untimed";
  return {
    title: overrides.title ?? "Test Exam",
    description: "",
    courseId: overrides.courseId ?? "",
    timingMode: overrides.timingMode ?? ("timed_window" as const),
    // INVARIANT: explicit null is a real timed-mode value (deadline/untimed) —
    // merge on `undefined`, never `??`, or null collapses to the 60 default.
    durationMinutes:
      overrides.durationMinutes !== undefined
        ? overrides.durationMinutes
        : untimed
          ? null
          : 60,
    openAt: new Date(Date.now() - 3600000).toISOString(),
    closeAt:
      overrides.closeAt === undefined
        ? untimed
          ? null
          : new Date(Date.now() + 86400000).toISOString()
        : overrides.closeAt,
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
 * admin enrollment API. `ctx` and `candidateProfileId` are explicit parameters
 * (not closure state) so every shared-fixture test file can reuse the call.
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
 * Builds the shared attempt-route fixture: the test app (examRoutes +
 * attemptRoutes), a course, a single_choice question, a fill_blank question, a
 * candidate profile, then a published + enrolled exam. Call once per
 * shared-fixture file's outer `beforeAll`; pair with `ctx.cleanup()` in
 * `afterAll`.
 */
export async function buildSharedAttemptFixture(opts?: {
  /**
   * Fastify logger config forwarded to {@link buildTestApp}. Default: logging
   * stays disabled. Files that assert structured log lines pass a capturing
   * stream here (#861) — the app is built once per file, so the app-level
   * logger is the only wiring point.
   */
  logger?: FastifyLoggerOptions;
}): Promise<SharedAttemptFixture> {
  const ctx = await buildTestApp(async (fastify) => {
    await fastify.register(examRoutes, { prefix: "" });
    await fastify.register(attemptRoutes, { prefix: "" });
  }, opts);

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

/**
 * Isolated per-suite organization for the attempt-command admin suites: an
 * org, an Admin user and a Candidate user (each with an ACTIVE primary role
 * assignment — authentication resolves authority from
 * user_role_assignments), a candidate profile, a course, one question, and
 * signed tokens. `slugPrefix` is load-bearing: several suites prove
 * absence-of-side-effects via `organizations.slug LIKE '<prefix>%'` filters,
 * so every suite keeps its distinct prefix.
 */
export interface IsolatedAttemptOrg {
  orgId: string;
  adminToken: string;
  adminUserId: string;
  candidateToken: string;
  candidateUserId: string;
  candidateProfileId: string;
  courseId: string;
  questionId: string;
}

export async function createIsolatedAttemptOrg(
  ctx: TestContext,
  opts: {
    slugPrefix: string;
    label: string;
    questionType?: "single_choice" | "text_response";
  },
): Promise<IsolatedAttemptOrg> {
  const slug = `${opts.slugPrefix}${uniquePrefix()}`;
  const now = new Date();

  const org = (
    await ctx.db
      .insert(schema.organizations)
      .values({
        id: randomUUID(),
        name: slug,
        displayName: slug,
        slug,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;

  const passwordHash = await hashPassword("password123");

  const admin = (
    await ctx.db
      .insert(schema.users)
      .values({
        id: randomUUID(),
        organizationId: org.id,
        username: `admin-${slug}`,
        passwordHash,
        name: `${opts.label} Admin`,
        role: "Admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;

  const candidate = (
    await ctx.db
      .insert(schema.users)
      .values({
        id: randomUUID(),
        organizationId: org.id,
        username: `candidate-${slug}`,
        passwordHash,
        name: `${opts.label} Candidate`,
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;

  // Authentication resolves authority from ACTIVE user_role_assignments.
  // Seed one active primary assignment per user so the tokens authenticate
  // with their role's preset.
  const assignments: Array<typeof schema.userRoleAssignments.$inferInsert> = [
    {
      id: randomUUID(),
      organizationId: org.id,
      userId: admin.id,
      role: "Admin",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      organizationId: org.id,
      userId: candidate.id,
      role: "Candidate",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
  await ctx.db.insert(schema.userRoleAssignments).values(assignments);

  const profile = (
    await ctx.db
      .insert(schema.candidateProfiles)
      .values({
        id: randomUUID(),
        organizationId: org.id,
        userId: candidate.id,
        fields: {},
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;

  const course = (
    await ctx.db
      .insert(schema.courses)
      .values({
        id: randomUUID(),
        organizationId: org.id,
        name: `${opts.label} Course ${slug}`,
        code: `${opts.label}-${slug}`,
        description: "",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;

  const question =
    opts.questionType === "text_response"
      ? (
          await ctx.db
            .insert(schema.questions)
            .values({
              id: randomUUID(),
              organizationId: org.id,
              courseId: course.id,
              type: "text_response",
              content: "Explain the meaning of life.",
              options: [],
              standardAnswer: null,
              // text_response requires a non-empty rubric at publish time
              // (standardAnswer is optional for it).
              rubric: "Score 0–100 by clarity and depth.",
              attachments: [],
              score: 100,
              difficulty: 1,
              tags: [],
              gradingRule: {
                multiSelectScoring: "all_correct_full",
                fillBlankMatchMode: "exact",
              },
              createdAt: now,
              updatedAt: now,
            })
            .returning()
        )[0]!
      : (
          await ctx.db
            .insert(schema.questions)
            .values({
              id: randomUUID(),
              organizationId: org.id,
              courseId: course.id,
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
              createdAt: now,
              updatedAt: now,
            })
            .returning()
        )[0]!;

  const { jwtSecret } = getRuntimeConfig().authSecret;
  const adminToken = signJWT(
    {
      actorId: admin.id,
      role: "Admin" as Role,
      organizationId: org.id,
      authEpoch: 0,
    },
    jwtSecret,
  );
  const candidateToken = signJWT(
    {
      actorId: candidate.id,
      role: "Candidate" as Role,
      organizationId: org.id,
      authEpoch: 0,
    },
    jwtSecret,
  );

  return {
    orgId: org.id,
    adminToken,
    adminUserId: admin.id,
    candidateToken,
    candidateUserId: candidate.id,
    candidateProfileId: profile.id,
    courseId: course.id,
    questionId: question.id,
  };
}

/**
 * Adds one more role user (e.g. a Proctor) to an org created by
 * {@link createIsolatedAttemptOrg}, with an ACTIVE primary role assignment
 * and a signed token. Compose after the factory rather than growing its
 * option set per suite.
 */
export async function createOrgRoleUser(
  ctx: TestContext,
  orgId: string,
  // System is a pseudo-role, not an assignable user_role_assignments row.
  role: Exclude<Role, "Candidate" | "System">,
  label: string,
): Promise<{ userId: string; token: string }> {
  const slug = `${label.toLowerCase().replace(/\s+/g, "-")}-${uniquePrefix()}`;
  const now = new Date();
  const userId = randomUUID();
  await ctx.db.insert(schema.users).values({
    id: userId,
    organizationId: orgId,
    username: `${role.toLowerCase()}-${slug}`,
    passwordHash: await hashPassword("password123"),
    name: `${label} ${role}`,
    role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert(schema.userRoleAssignments).values({
    id: randomUUID(),
    organizationId: orgId,
    userId,
    role,
    isPrimary: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const { jwtSecret } = getRuntimeConfig().authSecret;
  const token = signJWT(
    {
      actorId: userId,
      role: role as Role,
      organizationId: orgId,
      authEpoch: 0,
    },
    jwtSecret,
  );
  return { userId, token };
}

/**
 * Request-context for an {@link IsolatedAttemptOrg}'s candidate user (repo
 * calls under the candidate's own authority).
 */
export function candidateRequestContext(t: IsolatedAttemptOrg) {
  return {
    actorId: t.candidateUserId,
    organizationId: t.orgId,
    role: "Candidate" as const,
    permissions: [] as import("@exam/domain").Permission[],
    sessionId: "test",
    targetOrganizationId: t.orgId,
  };
}
