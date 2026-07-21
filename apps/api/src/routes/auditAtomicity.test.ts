import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import type { Database } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import type { Permission, QuestionSnapshot } from "@exam/domain";
import { buildTestApp, uniquePrefix, type TestContext } from "./testHelpers.js";
import userRoutes from "./user.js";
import roleAssignmentRoutes from "./roleAssignments.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import authRoutes from "./auth.js";

function adminContext(ctx: TestContext) {
  return {
    actorId: ctx.admin.id,
    organizationId: ctx.org.id,
    targetOrganizationId: ctx.org.id,
    role: "Admin" as const,
    permissions: [] as Permission[],
    sessionId: "audit-atomicity-test",
  };
}

async function installAuditFailure(
  db: Database,
  action: string,
): Promise<() => Promise<void>> {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const functionName = `fail_audit_${suffix}`;
  const triggerName = `fail_audit_trigger_${suffix}`;
  const quotedAction = action.replaceAll("'", "''");

  await db.execute(
    sql.raw(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected audit failure for ${quotedAction}';
      END;
      $$ LANGUAGE plpgsql
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON audit_logs
      FOR EACH ROW
      WHEN (NEW.action = '${quotedAction}')
      EXECUTE FUNCTION ${functionName}()
    `),
  );

  return async () => {
    await db.execute(
      sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_logs`),
    );
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`));
  };
}

async function countAudit(
  ctx: TestContext,
  action: string,
  targetId: string,
): Promise<number> {
  const rows = await ctx.db
    .select({ id: schema.auditLogs.id })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.organizationId, ctx.org.id),
        eq(schema.auditLogs.action, action),
        eq(schema.auditLogs.targetId, targetId),
      ),
    );
  return rows.length;
}

async function createCandidateUser(ctx: TestContext, label: string) {
  const userId = crypto.randomUUID();
  await ctx.db.insert(schema.users).values({
    id: userId,
    organizationId: ctx.org.id,
    username: `${label}-${uniquePrefix()}`,
    passwordHash: "test-hash",
    name: label,
    role: "Candidate",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await ctx.db.insert(schema.userRoleAssignments).values({
    id: crypto.randomUUID(),
    organizationId: ctx.org.id,
    userId,
    role: "Candidate",
    isPrimary: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return userId;
}

async function createExam(ctx: TestContext, status: string) {
  const courseId = crypto.randomUUID();
  const examId = crypto.randomUUID();
  const now = new Date();
  await ctx.db.insert(schema.courses).values({
    id: courseId,
    organizationId: ctx.org.id,
    name: "Audit Atomicity Course",
    code: `AUD-${uniquePrefix()}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert(schema.exams).values({
    id: examId,
    organizationId: ctx.org.id,
    title: "Audit Atomicity Exam",
    description: "",
    courseId,
    status,
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: new Date(now.getTime() - 60_000),
    closeAt: new Date(now.getTime() + 3_600_000),
    passingScore: 6,
    totalScore: 10,
    questionSelectionMode: "manual",
    questionIds: [],
    questionSnapshot: [],
    controlFlags: {
      shuffleQuestions: false,
      shuffleOptions: false,
      detectTabSwitch: false,
      disableCopyPaste: false,
      requireQueue: false,
      batchSize: 10,
      batchInterval: 3,
      restrictIp: false,
      requireLockdown: false,
      showResultImmediately: false,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 3,
    resultPublicationMode: "manual",
    createdAt: now,
    updatedAt: now,
  });
  return examId;
}

describe("ADR-006 audit durability and atomicity", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp(async (app) => {
      await app.register(userRoutes);
      await app.register(roleAssignmentRoutes);
      await app.register(examRoutes);
      await app.register(attemptRoutes);
      await app.register(authRoutes, { prefix: "/auth" });
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("commits a successful mutation and its audit row together", async () => {
    const userId = await createCandidateUser(ctx, "role-audit-success");
    const response = await ctx.app.inject({
      method: "POST",
      url: `/api/users/${userId}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { role: "Proctor", isPrimary: false },
    });

    expect(response.statusCode).toBe(201);
    const assignments = await ctx.db
      .select()
      .from(schema.userRoleAssignments)
      .where(eq(schema.userRoleAssignments.userId, userId));
    expect(assignments.some((row) => row.role === "Proctor")).toBe(true);
    expect(await countAudit(ctx, "user.role_changed", userId)).toBe(1);
  });

  it("does not write an audit row when the business mutation fails", async () => {
    const userId = await createCandidateUser(ctx, "role-business-failure");
    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/users/${userId}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { role: "Proctor", isPrimary: false },
    });
    expect(first.statusCode).toBe(201);
    const auditBefore = await countAudit(ctx, "user.role_changed", userId);

    const duplicate = await ctx.app.inject({
      method: "POST",
      url: `/api/users/${userId}/role-assignments`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { role: "Proctor", isPrimary: false },
    });

    expect(duplicate.statusCode).toBe(409);
    const assignments = await ctx.db
      .select()
      .from(schema.userRoleAssignments)
      .where(
        and(
          eq(schema.userRoleAssignments.userId, userId),
          eq(schema.userRoleAssignments.role, "Proctor"),
        ),
      );
    expect(assignments).toHaveLength(1);
    expect(await countAudit(ctx, "user.role_changed", userId)).toBe(
      auditBefore,
    );
  });

  it("tracks tenant login success without delaying a successful response", async () => {
    const before = await countAudit(ctx, "login.success", ctx.admin.id);
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin123" },
    });

    expect(response.statusCode).toBe(200);
    await ctx.drainAuditWrites();
    expect(await countAudit(ctx, "login.success", ctx.admin.id)).toBe(
      before + 1,
    );
  });

  it("does not turn a successful login into an outage when tenant audit fails", async () => {
    const removeFailure = await installAuditFailure(ctx.db, "login.success");
    const before = await countAudit(ctx, "login.success", ctx.admin.id);
    try {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin", password: "admin123" },
      });

      expect(response.statusCode).toBe(200);
      expect(
        response.cookies.some(
          (cookie: { name: string }) => cookie.name === "auth-token",
        ),
      ).toBe(true);
      await ctx.drainAuditWrites();
      expect(await countAudit(ctx, "login.success", ctx.admin.id)).toBe(before);
    } finally {
      await removeFailure();
    }
  });

  it("keeps an ordinary authentication denial at 401 when tenant audit fails", async () => {
    const removeFailure = await installAuditFailure(ctx.db, "login.failure");
    try {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin", password: "wrong-password" },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("AUTH_INVALID_CREDENTIALS");
      await ctx.drainAuditWrites();
    } finally {
      await removeFailure();
    }
  });

  it("rolls back role assignment when its audit insert fails", async () => {
    const userId = await createCandidateUser(ctx, "role-audit-failure");
    const removeFailure = await installAuditFailure(
      ctx.db,
      "user.role_changed",
    );
    try {
      const response = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${userId}/role-assignments`,
        cookies: { "auth-token": ctx.adminToken },
        payload: { role: "Proctor", isPrimary: false },
      });
      expect(response.statusCode).toBe(500);
      const assignments = await ctx.db
        .select()
        .from(schema.userRoleAssignments)
        .where(eq(schema.userRoleAssignments.userId, userId));
      expect(assignments.some((row) => row.role === "Proctor")).toBe(false);
      expect(await countAudit(ctx, "user.role_changed", userId)).toBe(0);
    } finally {
      await removeFailure();
    }
  });

  it("rolls back user deletion when its audit insert fails", async () => {
    const userId = await createCandidateUser(ctx, "delete-audit-failure");
    const removeFailure = await installAuditFailure(ctx.db, "user.delete");
    try {
      const response = await ctx.app.inject({
        method: "DELETE",
        url: `/api/users/${userId}`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(response.statusCode).toBe(500);
      const users = await ctx.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      expect(users).toHaveLength(1);
      expect(await countAudit(ctx, "user.delete", userId)).toBe(0);
    } finally {
      await removeFailure();
    }
  });

  it("rolls back result publication when its audit insert fails", async () => {
    const examId = await createExam(ctx, "closed");
    const removeFailure = await installAuditFailure(
      ctx.db,
      "exam.publish_results",
    );
    try {
      const response = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish-results`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(response.statusCode).toBe(500);
      const exams = await ctx.db
        .select({ resultsPublishedAt: schema.exams.resultsPublishedAt })
        .from(schema.exams)
        .where(eq(schema.exams.id, examId));
      expect(exams[0]?.resultsPublishedAt).toBeNull();
      expect(await countAudit(ctx, "exam.publish_results", examId)).toBe(0);
    } finally {
      await removeFailure();
    }
  });

  it("rolls back an exam transition executor mutation when its audit insert fails", async () => {
    const examId = await createExam(ctx, "open");
    const removeFailure = await installAuditFailure(ctx.db, "exam.close");
    try {
      const response = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/close`,
        payload: { reason: "rollback proof" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(response.statusCode).toBe(500);
      const exams = await ctx.db
        .select({ status: schema.exams.status })
        .from(schema.exams)
        .where(eq(schema.exams.id, examId));
      expect(exams[0]?.status).toBe("open");
      expect(await countAudit(ctx, "exam.close", examId)).toBe(0);
    } finally {
      await removeFailure();
    }
  });

  it("rolls back manual grading when its audit insert fails", async () => {
    const examId = await createExam(ctx, "open");
    const candidateRows = await ctx.db
      .select({ id: schema.candidateProfiles.id })
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.userId, ctx.candidate.id));
    const candidateId = candidateRows[0]?.id ?? crypto.randomUUID();
    if (!candidateRows[0]) {
      await ctx.db.insert(schema.candidateProfiles).values({
        id: candidateId,
        organizationId: ctx.org.id,
        userId: ctx.candidate.id,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const gradingQuestion: QuestionSnapshot = {
      originalQuestionId: "manual-question",
      type: "text_response",
      content: "Manual question",
      options: [],
      standardAnswer: null,
      attachments: [],
      score: 10,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      rubric: "Award up to ten points",
      order: 0,
    };
    await ctx.db
      .update(schema.exams)
      .set({
        questionIds: [gradingQuestion.originalQuestionId],
        questionSnapshot: [gradingQuestion],
      })
      .where(eq(schema.exams.id, examId));

    const requestContext = adminContext(ctx);
    const enrollment = await createEnrollmentRepo(ctx.db).create(
      requestContext,
      {
        examId,
        candidateId,
        status: "started",
        attemptCount: 1,
      },
    );
    const attempt = await createAttemptRepo(ctx.db).create(requestContext, {
      examId,
      enrollmentId: enrollment.id,
      candidateId,
      attemptNo: 1,
      status: "submitted",
      gradingStatus: "pending_manual",
      questionSnapshot: [gradingQuestion],
      answers: [],
      submittedAnswers: { schemaVersion: 1, answers: [] },
      submittedAt: new Date(),
    });
    await createAttemptGradingEntryRepo(ctx.db).bulkCreate(requestContext, [
      {
        attemptId: attempt.id,
        questionId: gradingQuestion.originalQuestionId,
        gradingMode: "manual",
        status: "pending_manual",
        maxScore: 10,
        earnedScore: null,
        candidateAnswer: "candidate answer",
        standardAnswer: null,
        correct: null,
      },
    ]);

    const removeFailure = await installAuditFailure(
      ctx.db,
      "grading.score_entered",
    );
    try {
      const response = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attempt.id}/grade-question`,
        cookies: { "auth-token": ctx.adminToken },
        payload: {
          questionId: gradingQuestion.originalQuestionId,
          score: 8,
          comment: "good",
        },
      });
      expect(response.statusCode).toBe(500);
      const entry = await createAttemptGradingEntryRepo(
        ctx.db,
      ).findByAttemptAndQuestion(
        requestContext,
        attempt.id,
        gradingQuestion.originalQuestionId,
      );
      expect(entry?.status).toBe("pending_manual");
      expect(entry?.earnedScore).toBeNull();
      expect(await countAudit(ctx, "grading.score_entered", attempt.id)).toBe(
        0,
      );
    } finally {
      await removeFailure();
    }
  });
});
