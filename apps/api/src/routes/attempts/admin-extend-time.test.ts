import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Role } from "@exam/domain";
import { buildExamPayload } from "./attempts.testHelpers.js";

const EXTEND_TIME_TEST_PREFIX = "extend-time-test-";

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

  describe("POST /api/admin/attempts/:attemptId/extend-time", () => {
    interface IsolatedTestOrg {
      orgId: string;
      adminToken: string;
      adminUserId: string;
      candidateToken: string;
      candidateProfileId: string;
      courseId: string;
      questionId: string;
    }

    async function createIsolatedTestOrg(): Promise<IsolatedTestOrg> {
      const slug = `${EXTEND_TIME_TEST_PREFIX}${uniquePrefix()}`;
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

      const adminId = crypto.randomUUID();
      const admin = (
        await ctx.db
          .insert(schema.users)
          .values({
            id: adminId,
            organizationId: org.id,
            username: `admin-${slug}`,
            passwordHash,
            name: "ET Admin",
            role: "Admin",
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: crypto.randomUUID(),
        organizationId: org.id,
        userId: adminId,
        role: "Admin",
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      const candidateId = crypto.randomUUID();
      const candidate = (
        await ctx.db
          .insert(schema.users)
          .values({
            id: candidateId,
            organizationId: org.id,
            username: `candidate-${slug}`,
            passwordHash,
            name: "ET Candidate",
            role: "Candidate",
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: crypto.randomUUID(),
        organizationId: org.id,
        userId: candidateId,
        role: "Candidate",
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

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
            name: `ET Course ${slug}`,
            code: `ET-${slug}`,
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
        adminUserId: admin.id,
        candidateToken,
        candidateProfileId: profile.id,
        courseId: course.id,
        questionId: question.id,
      };
    }

    async function createStartedAttempt(
      t: IsolatedTestOrg,
      examTitle: string,
      durationMinutes = 60,
    ): Promise<{ attemptId: string; examId: string }> {
      const exam = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: examTitle,
          courseId: t.courseId,
          questionIds: [t.questionId],
          durationMinutes,
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
      return { attemptId, examId: localExamId };
    }

    function makeAdminCtx(t: IsolatedTestOrg) {
      return {
        actorId: t.adminUserId,
        organizationId: t.orgId,
        role: "Admin" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: t.orgId,
      };
    }

    beforeEach(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(like(schema.organizations.slug, `${EXTEND_TIME_TEST_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    afterAll(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(like(schema.organizations.slug, `${EXTEND_TIME_TEST_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    it("extends an in_progress attempt's deadline and audits the action (200)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Extend Time InProgress Exam",
      );
      const before = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      const beforeDeadline = before!.deadlineAt!;

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/extend-time`,
        payload: { additionalMinutes: 10 },
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const after = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(after?.deadlineAt?.getTime()).toBe(
        beforeDeadline.getTime() + 10 * 60_000,
      );

      await ctx.drainAuditWrites();
      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const extendRows = auditRows.filter(
        (r) => r.action === "attempt.extendTime",
      );
      expect(extendRows).toHaveLength(1);
      expect(extendRows[0]!.actorId).toBe(t.adminUserId);
      expect(extendRows[0]!.metadata).toMatchObject({
        additionalMinutes: 10,
      });
    });

    it("extends a disrupted attempt's deadline (200)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Extend Time Disrupted Exam",
      );
      const before = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      const beforeDeadline = before!.deadlineAt!;
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "disrupted" })
        .where(eq(schema.examAttempts.id, attemptId));

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/extend-time`,
        payload: { additionalMinutes: 5 },
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const after = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      expect(after?.deadlineAt?.getTime()).toBe(
        beforeDeadline.getTime() + 5 * 60_000,
      );
    });

    it("rejects a submitted attempt with 409 INVALID_STATE", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId } = await createStartedAttempt(
        t,
        "Extend Time Submitted Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "submitted" })
        .where(eq(schema.examAttempts.id, attemptId));

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/extend-time`,
        payload: { additionalMinutes: 5 },
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(409);
    });

    it("rejects an extension beyond exam.closeAt with 409 DEADLINE_EXCEEDS_EXAM_CLOSE (deadline unchanged)", async () => {
      const t = await createIsolatedTestOrg();
      const { attemptId, examId } = await createStartedAttempt(
        t,
        "Extend Time BeyondClose Exam",
      );
      const before = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      const beforeDeadline = before!.deadlineAt!;
      // exam.closeAt is openAt + (a long window). Push deadline near closeAt,
      // then extend far enough to exceed it.
      const examRow = (
        await ctx.db
          .select()
          .from(schema.exams)
          .where(eq(schema.exams.id, examId))
      )[0]!;
      const closeAt = examRow.closeAt as Date;
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: new Date(closeAt.getTime() - 60_000) })
        .where(eq(schema.examAttempts.id, attemptId));

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/extend-time`,
        payload: { additionalMinutes: 120 },
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(409);
      const after = await createAttemptRepo(ctx.db).findById(
        makeAdminCtx(t),
        attemptId,
      );
      // deadline unchanged (still the near-closeAt value we set, not beforeDeadline)
      expect(after?.deadlineAt?.getTime()).toBe(closeAt.getTime() - 60_000);
      expect(after?.deadlineAt?.getTime()).not.toBe(beforeDeadline.getTime());
    });
  });
});
