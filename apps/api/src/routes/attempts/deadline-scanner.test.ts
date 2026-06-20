import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, inArray, like, lte, and } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import { scanDatabaseForExpiredAttempts } from "../../plugins/deadlineScanner.js";
import { autoSubmitAndGrade } from "../../plugins/deadlineScanner.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Role } from "@exam/domain";
import { buildExamPayload } from "./attempts.testHelpers.js";

const DEADLINE_SCANNER_TEST_PREFIX = "deadline-scanner-test-";

describe("attempt routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe("deadline scanner — scanDatabaseForExpiredAttempts", () => {
    interface IsolatedTestOrg {
      orgId: string;
      adminToken: string;
      candidateToken: string;
      candidateUserId: string;
      candidateProfileId: string;
      courseId: string;
      questionId: string;
    }

    async function createIsolatedTestOrg(): Promise<IsolatedTestOrg> {
      const slug = `${DEADLINE_SCANNER_TEST_PREFIX}${uniquePrefix()}`;
      const now = new Date();

      const org = (
        await ctx.db
          .insert(schema.organizations)
          .values({
            id: crypto.randomUUID(),
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
            id: crypto.randomUUID(),
            organizationId: org.id,
            username: `admin-${slug}`,
            passwordHash,
            name: "DS Admin",
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
            id: crypto.randomUUID(),
            organizationId: org.id,
            username: `candidate-${slug}`,
            passwordHash,
            name: "DS Candidate",
            role: "Candidate",
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;

      const profile = (
        await ctx.db
          .insert(schema.candidateProfiles)
          .values({
            id: crypto.randomUUID(),
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
            id: crypto.randomUUID(),
            organizationId: org.id,
            name: `DS Course ${slug}`,
            code: `DS-${slug}`,
            description: "",
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;

      const question = (
        await ctx.db
          .insert(schema.questions)
          .values({
            id: crypto.randomUUID(),
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
          role: admin.role as Role,
          organizationId: org.id,
        },
        jwtSecret,
      );
      const candidateToken = signJWT(
        {
          actorId: candidate.id,
          role: candidate.role as Role,
          organizationId: org.id,
        },
        jwtSecret,
      );

      return {
        orgId: org.id,
        adminToken,
        candidateToken,
        candidateUserId: candidate.id,
        candidateProfileId: profile.id,
        courseId: course.id,
        questionId: question.id,
      };
    }

    function makeCandidateCtx(t: IsolatedTestOrg) {
      return {
        actorId: t.candidateUserId,
        organizationId: t.orgId,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: t.orgId,
      };
    }

    async function createStartedAttemptWithQuestion(
      t: IsolatedTestOrg,
      examTitle: string,
    ): Promise<{ attemptId: string; questionId: string }> {
      const exam = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: examTitle,
          courseId: t.courseId,
          questionIds: [t.questionId],
          durationMinutes: 1,
        }),
        cookies: { "auth-token": t.adminToken },
      });
      const localExamId = exam.json().id;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${localExamId}/publish`,
        cookies: { "auth-token": t.adminToken },
      });
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${localExamId}/enrollments`,
        payload: { candidateIds: [t.candidateProfileId] },
        cookies: { "auth-token": t.adminToken },
      });

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${localExamId}/start`,
        cookies: { "auth-token": t.candidateToken },
      });
      const attemptId = startRes.json().id as string;

      const examDetail = (
        await ctx.app.inject({
          method: "GET",
          url: `/api/exams/${localExamId}`,
          cookies: { "auth-token": t.adminToken },
        })
      ).json();
      const localQuestionId = examDetail.questionIds[0];

      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${localQuestionId}`,
        payload: {
          attemptId,
          questionId: localQuestionId,
          answer: true,
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": t.candidateToken },
      });

      return { attemptId, questionId: localQuestionId };
    }

    async function backdateDeadline(attemptId: string): Promise<void> {
      const past = new Date(Date.now() - 60_000);
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: past, status: "in_progress" })
        .where(eq(schema.examAttempts.id, attemptId));
    }

    beforeAll(async () => {
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "voided" })
        .where(
          and(
            inArray(schema.examAttempts.status, ["in_progress", "disrupted"]),
            lte(schema.examAttempts.deadlineAt, new Date()),
          ),
        );
    });

    beforeEach(async () => {
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(
          like(schema.organizations.slug, `${DEADLINE_SCANNER_TEST_PREFIX}%`),
        );
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    afterAll(async () => {
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(
          like(schema.organizations.slug, `${DEADLINE_SCANNER_TEST_PREFIX}%`),
        );
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    it("auto-submits and grades an expired in_progress attempt end-to-end", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit InProgress Exam",
      );
      await backdateDeadline(attemptId);

      const result = await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      expect(result.submittedCount).toBeGreaterThanOrEqual(1);

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("graded");
      expect(attempt?.submittedAt).toBeDefined();
      expect(attempt?.gradedAt).toBeDefined();
      expect(attempt?.score).toBeDefined();
    });

    it("records exactly one attempt.autoSubmit audit event on a successful auto-submit", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Audit Exam",
      );
      await backdateDeadline(attemptId);

      await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const autoSubmitRows = auditRows.filter(
        (r) => r.action === "attempt.autoSubmit",
      );
      expect(autoSubmitRows).toHaveLength(1);
      expect(autoSubmitRows[0]!.targetType).toBe("attempt");
    });

    it("does NOT write a phantom attempt.autoSubmit audit when the row is already submitted at lock time (race no-op)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Race Exam",
      );
      await backdateDeadline(attemptId);
      const scannerCtx = {
        actorId: "system:deadline-scanner",
        organizationId: t.orgId,
        role: "Admin" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "system:deadline-scanner",
        targetOrganizationId: t.orgId,
      };

      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "submitted", submittedAt: new Date() })
        .where(eq(schema.examAttempts.id, attemptId));

      const stateChanged = await autoSubmitAndGrade(
        ctx.db,
        scannerCtx,
        attemptId,
        new Date(),
      );

      expect(stateChanged).toBe(false);

      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const autoSubmitRows = auditRows.filter(
        (r) => r.action === "attempt.autoSubmit",
      );
      expect(autoSubmitRows).toHaveLength(0);

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("submitted");
    });

    it("is idempotent: second scan does not re-grade or duplicate audit", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Idempotent Exam",
      );
      await backdateDeadline(attemptId);

      await scanDatabaseForExpiredAttempts(ctx.app, new Date());
      const firstAttempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      const firstGradedAt = firstAttempt?.gradedAt;

      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.examAttempts.id, attemptId));

      const second = await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      expect(second.submittedCount).toBe(0);

      const afterSecond = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(afterSecond?.status).toBe("graded");
      expect(afterSecond?.gradedAt?.getTime()).toBe(firstGradedAt?.getTime());

      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const autoSubmitCount = auditRows.filter(
        (r) => r.action === "attempt.autoSubmit",
      ).length;
      expect(autoSubmitCount).toBe(1);
    });

    it("auto-submits a disrupted attempt whose deadline has passed", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Disrupted Exam",
      );
      await backdateDeadline(attemptId);
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "disrupted" })
        .where(eq(schema.examAttempts.id, attemptId));

      const result = await scanDatabaseForExpiredAttempts(ctx.app, new Date());
      expect(result.submittedCount).toBeGreaterThanOrEqual(1);

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("graded");
    });

    it("does not touch a voided attempt whose deadline has passed", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Voided Exam",
      );
      await backdateDeadline(attemptId);
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "voided" })
        .where(eq(schema.examAttempts.id, attemptId));

      const result = await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("voided");
      expect(result.submittedCount).toBe(0);
    });

    it("does not auto-submit an in_progress attempt whose deadline is still future", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttemptWithQuestion(
        t,
        "Deadline AutoSubmit Future Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: new Date(Date.now() + 3600_000) })
        .where(eq(schema.examAttempts.id, attemptId));

      await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      const attempt = await createAttemptRepo(ctx.db).findById(
        makeCandidateCtx(t),
        attemptId,
      );
      expect(attempt?.status).toBe("in_progress");
    });
  });
});
