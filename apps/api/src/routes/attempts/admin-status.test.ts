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
import { buildExamPayload } from "./__tests__/attempts.testHelpers.js";

const STATUS_TEST_PREFIX = "status-test-";

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

  describe("GET /api/admin/exams/:examId/candidates/status", () => {
    interface IsolatedTestOrg {
      orgId: string;
      adminToken: string;
      candidateToken: string;
      candidateProfileId: string;
      courseId: string;
      questionId: string;
    }

    async function createIsolatedTestOrg(): Promise<IsolatedTestOrg> {
      const slug = `${STATUS_TEST_PREFIX}${uniquePrefix()}`;
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
            name: "Status Admin",
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
            name: "Status Candidate",
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
            name: `Status Course ${slug}`,
            code: `ST-${slug}`,
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
          authEpoch: 0,
        },
        jwtSecret,
      );
      const candidateToken = signJWT(
        {
          actorId: candidate.id,
          role: candidate.role as Role,
          organizationId: org.id,
          authEpoch: 0,
        },
        jwtSecret,
      );

      return {
        orgId: org.id,
        adminToken,
        candidateToken,
        candidateProfileId: profile.id,
        courseId: course.id,
        questionId: question.id,
      };
    }

    async function createPublishedExam(
      t: IsolatedTestOrg,
      title: string,
    ): Promise<string> {
      const exam = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title,
          courseId: t.courseId,
          questionIds: [t.questionId],
        }),
        cookies: { "auth-token": t.adminToken },
      });
      const examId = exam.json().id;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: { "auth-token": t.adminToken },
      });
      return examId;
    }

    async function enrollCandidate(t: IsolatedTestOrg, examId: string) {
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/enrollments`,
        payload: { candidateIds: [t.candidateProfileId] },
        cookies: { "auth-token": t.adminToken },
      });
    }

    async function startAttempt(
      t: IsolatedTestOrg,
      examId: string,
    ): Promise<string> {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": t.candidateToken },
      });
      return res.json().id;
    }

    beforeEach(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(like(schema.organizations.slug, `${STATUS_TEST_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    afterAll(async () => {
      await ctx.drainAuditWritesStrict();
      const stale = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(like(schema.organizations.slug, `${STATUS_TEST_PREFIX}%`));
      for (const org of stale) {
        await cleanupOrganizationTestData(ctx.db, org.id);
      }
    });

    it("returns 200 with candidate status list for a valid exam with enrollments", async () => {
      const t = await createIsolatedTestOrg();
      const examId = await createPublishedExam(t, "Status Test Exam");
      await enrollCandidate(t, examId);

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${examId}/candidates/status`,
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("candidates");
      expect(body).toHaveProperty("total");
      expect(body.total).toBe(1);
      expect(body.candidates[0].candidateId).toBe(t.candidateProfileId);
      expect(body.candidates[0].name).toBe("Status Candidate");
      expect(body.candidates[0].status).toBe("not_started");
    });

    it("returns in_progress status when candidate has started the exam", async () => {
      const t = await createIsolatedTestOrg();
      const examId = await createPublishedExam(t, "Status InProgress Exam");
      await enrollCandidate(t, examId);
      await startAttempt(t, examId);

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${examId}/candidates/status`,
        cookies: { "auth-token": t.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(1);
      expect(body.candidates[0].status).toBe("in_progress");
      expect(body.candidates[0].attemptId).toBeTruthy();
      expect(body.candidates[0].deadlineAt).toBeTruthy();
    });

    it("returns 404 for a non-existent exam", async () => {
      const t = await createIsolatedTestOrg();
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${crypto.randomUUID()}/candidates/status`,
        cookies: { "auth-token": t.adminToken },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 403 for a non-admin (candidate) token", async () => {
      const t = await createIsolatedTestOrg();
      const examId = await createPublishedExam(t, "Status Forbidden Exam");
      await enrollCandidate(t, examId);

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${examId}/candidates/status`,
        cookies: { "auth-token": t.candidateToken },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
