import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/schema/pg";
import { createAttemptRepo } from "@exam/db/repository/attemptRepo";
import { cleanupOrganizationTestData } from "@exam/db/testCleanup";
import {
  buildExamPayload,
  createIsolatedAttemptOrg,
  type IsolatedAttemptOrg,
} from "./__tests__/attempts.testHelpers.js";

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
    async function createPublishedExam(
      t: IsolatedAttemptOrg,
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

    async function enrollCandidate(t: IsolatedAttemptOrg, examId: string) {
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/enrollments`,
        payload: { candidateIds: [t.candidateProfileId] },
        cookies: { "auth-token": t.adminToken },
      });
    }

    async function startAttempt(
      t: IsolatedAttemptOrg,
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
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: STATUS_TEST_PREFIX,
        label: "Status",
      });
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
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: STATUS_TEST_PREFIX,
        label: "Status",
      });
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
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: STATUS_TEST_PREFIX,
        label: "Status",
      });
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${crypto.randomUUID()}/candidates/status`,
        cookies: { "auth-token": t.adminToken },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 403 for a non-admin (candidate) token", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: STATUS_TEST_PREFIX,
        label: "Status",
      });
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
