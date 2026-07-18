import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createCandidateViaApi,
  createFutureRoleUserForTest,
  uniquePrefix,
} from "./testHelpers.js";
import authRoutes from "./auth.js";
import candidateRoutes from "./candidate.js";
import attemptRoutes from "./attempts.js";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import userRoutes from "./user.js";
import scoreRoutes from "./scores.js";
import { exportRoutes } from "./export.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createCourseRepo } from "@exam/db/src/repository/courseRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";

describe("permission boundary", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(candidateRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(examRoutes);
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(userRoutes);
      await fastify.register(scoreRoutes);
      await fastify.register(exportRoutes);
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe("unauthenticated gets 401 on all protected endpoints", () => {
    it("GET /api/exams returns 401", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/exams",
      });
      expect(res.statusCode).toBe(401);
    });

    it("POST /api/candidates returns 401", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/candidates",
        payload: {
          username: "should-not-create",
          password: "password123",
          name: "Should Not Create",
          fields: {},
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("GET /api/exams/:id/export/scores returns 401", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/export/scores",
      });
      expect(res.statusCode).toBe(401);
    });

    // M10-B: 7 capability-migrated routes — unauthenticated denied
    it("POST /api/exams/:id/unpublish returns 401", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/unpublish",
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    });

    it("POST /api/exams/:id/extend returns 401", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/extend",
        payload: { extendMinutes: 10 },
      });
      expect(res.statusCode).toBe(401);
    });

    it("POST /api/exams/:id/cancel returns 401", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/cancel",
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    });

    it("POST /api/exams/:id/archive returns 401", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/archive",
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    });

    it("DELETE /api/exams/:id returns 401", async () => {
      const res = await ctx.app.inject({
        method: "DELETE",
        url: "/api/exams/00000000-0000-0000-0000-000000000000",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("candidate cannot access admin APIs", () => {
    let candidateToken: string;

    beforeAll(async () => {
      const candidate = await createCandidateViaApi(
        ctx.app,
        ctx.adminToken,
        `boundary-cand-01-${uniquePrefix()}`,
        ctx.org.id,
      );
      candidateToken = candidate.token;
    });

    it("GET /api/exams returns 403", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/exams",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("POST /api/candidates returns 403", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/candidates",
        payload: {
          username: "should-not-create-bnd",
          password: "password123",
          name: "Should Not Create",
          fields: {},
        },
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("GET /api/exams/:id/export/scores returns 403", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/export/scores",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("DELETE /api/courses/:id returns 403", async () => {
      const res = await ctx.app.inject({
        method: "DELETE",
        url: "/api/courses/00000000-0000-0000-0000-000000000000",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("GET /api/users returns 403", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/users",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    // M10-B: 7 capability-migrated routes — candidate denied
    it("POST /api/exams/:id/unpublish returns 403 for candidate", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/unpublish",
        payload: {},
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("POST /api/exams/:id/extend returns 403 for candidate", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/extend",
        payload: { extendMinutes: 10 },
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("POST /api/exams/:id/cancel returns 403 for candidate", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/cancel",
        payload: {},
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("POST /api/exams/:id/archive returns 403 for candidate", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/archive",
        payload: {},
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("DELETE /api/exams/:id returns 403 for candidate", async () => {
      const res = await ctx.app.inject({
        method: "DELETE",
        url: "/api/exams/00000000-0000-0000-0000-000000000000",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("Teacher/Proctor/Grader denied on M10-B Admin-only routes", () => {
    let teacherToken: string;
    let proctorToken: string;
    let graderToken: string;

    beforeAll(async () => {
      const teacher = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Teacher",
        "boundary-tchr",
      );
      teacherToken = teacher.token;
      const proctor = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Proctor",
        "boundary-proc",
      );
      proctorToken = proctor.token;
      const grader = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Grader",
        "boundary-grad",
      );
      graderToken = grader.token;
    });

    const m10bMigratedRoutes = [
      {
        method: "POST",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/unpublish",
        payload: {},
      },
      {
        method: "POST",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/extend",
        payload: { extendMinutes: 10 },
      },
      {
        method: "POST",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/cancel",
        payload: {},
      },
      {
        method: "POST",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/archive",
        payload: {},
      },
      {
        method: "DELETE",
        url: "/api/exams/00000000-0000-0000-0000-000000000000",
      },
      {
        method: "DELETE",
        url: "/api/courses/00000000-0000-0000-0000-000000000000",
      },
      {
        method: "GET",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/export/scores",
      },
    ];

    it("Teacher denied on all 7 M10-B migrated routes", async () => {
      for (const { method, url, payload } of m10bMigratedRoutes) {
        const res = await ctx.app.inject({
          method,
          url,
          payload,
          cookies: { "auth-token": teacherToken },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it("Proctor denied on all 7 M10-B migrated routes", async () => {
      for (const { method, url, payload } of m10bMigratedRoutes) {
        const res = await ctx.app.inject({
          method,
          url,
          payload,
          cookies: { "auth-token": proctorToken },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it("Grader denied on all 7 M10-B migrated routes", async () => {
      for (const { method, url, payload } of m10bMigratedRoutes) {
        const res = await ctx.app.inject({
          method,
          url,
          payload,
          cookies: { "auth-token": graderToken },
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });

  describe("M10-B zero-write evidence — denied mutations", () => {
    // For the six mutation routes (unpublish, extend, cancel, archive,
    // exam delete, course delete), a denied request must not change
    // persistent state. The capability preHandler should prevent handler
    // execution, so we prove this by recording state before, executing
    // the denied request, and re-reading state after.
    //
    // ScoreExport has an audit-log write side effect; we verify that
    // denied requests do not produce audit entries.

    function adminCtx() {
      return {
        actorId: ctx.admin.id,
        organizationId: ctx.org.id,
        targetOrganizationId: ctx.org.id,
        role: "Admin" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
      };
    }

    it("unpublish denied — exam remains published", async () => {
      const examRepo = createExamRepo(ctx.db);
      const exams = await examRepo.list(adminCtx());
      const publishedExam = exams.find((e) => e.status === "published");
      if (!publishedExam) return;

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${publishedExam.id}/unpublish`,
        payload: {},
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const reRead = await examRepo.findById(adminCtx(), publishedExam.id);
      expect(reRead?.status).toBe("published");
      expect(reRead?.updatedAt?.getTime()).toBe(
        publishedExam.updatedAt?.getTime(),
      );
    });

    it("extend denied — exam endTime unchanged", async () => {
      const examRepo = createExamRepo(ctx.db);
      const exams = await examRepo.list(adminCtx());
      const openExam = exams.find((e) => e.status === "open");
      if (!openExam) return;

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${openExam.id}/extend`,
        payload: { extendMinutes: 999 },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const reRead = await examRepo.findById(adminCtx(), openExam.id);
      expect(reRead?.closeAt?.getTime()).toBe(openExam.closeAt?.getTime());
    });

    it("cancel denied — exam not canceled", async () => {
      const examRepo = createExamRepo(ctx.db);
      const exams = await examRepo.list(adminCtx());
      const publishedExam = exams.find((e) => e.status === "published");
      if (!publishedExam) return;

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${publishedExam.id}/cancel`,
        payload: {},
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const reRead = await examRepo.findById(adminCtx(), publishedExam.id);
      expect(reRead?.status).toBe("published");
    });

    it("archive denied — exam not archived", async () => {
      const examRepo = createExamRepo(ctx.db);
      const exams = await examRepo.list(adminCtx());
      const closedExam = exams.find((e) => e.status === "closed");
      if (!closedExam) return;

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${closedExam.id}/archive`,
        payload: {},
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const reRead = await examRepo.findById(adminCtx(), closedExam.id);
      expect(reRead?.status).toBe("closed");
    });

    it("exam delete denied — exam still exists", async () => {
      const examRepo = createExamRepo(ctx.db);
      const exams = await examRepo.list(adminCtx());
      const draftExam = exams.find((e) => e.status === "draft");
      if (!draftExam) return;

      const res = await ctx.app.inject({
        method: "DELETE",
        url: `/api/exams/${draftExam.id}`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const reRead = await examRepo.findById(adminCtx(), draftExam.id);
      expect(reRead).not.toBeNull();
      expect(reRead!.id).toBe(draftExam.id);
    });

    it("course delete denied — course still exists", async () => {
      const courseRepo = createCourseRepo(ctx.db);
      const courses = await courseRepo.list(adminCtx());
      const targetCourse = courses[0];
      if (!targetCourse) return;

      const res = await ctx.app.inject({
        method: "DELETE",
        url: `/api/courses/${targetCourse.id}`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const reRead = await courseRepo.findById(adminCtx(), targetCourse.id);
      expect(reRead).not.toBeNull();
      expect(reRead!.id).toBe(targetCourse.id);
    });

    it("score export denied — no audit log written", async () => {
      const examRepo = createExamRepo(ctx.db);
      const exams = await examRepo.list(adminCtx());
      const targetExam = exams[0];
      if (!targetExam) return;

      const auditRepo = createAuditLogRepo(ctx.db);
      const before = await auditRepo.list(adminCtx());

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/exams/${targetExam.id}/export/scores`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const after = await auditRepo.list(adminCtx());
      expect(after.length).toBe(before.length);
    });
  });

  describe("admin can access all management APIs", () => {
    it("GET /api/exams returns 200", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/exams",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("GET /api/candidates returns 200", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/candidates",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("GET /api/users returns 200", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/users",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
