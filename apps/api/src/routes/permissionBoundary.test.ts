import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { HTTPMethods } from "fastify";
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
import { schema } from "@exam/db/src/schema/pg.js";
import { DEFAULT_CONTROL_FLAGS } from "./attempts/attempts.testHelpers.js";
import type { Exam } from "@exam/domain";

/**
 * Fail-fast type-narrowing helper. Used in zero-write fixtures to prove the
 * deterministic fixture was actually created — fixture absence MUST fail the
 * test rather than silently returning (RBAC-M10-B PR190 REVIEW CORRECTIVE 1,
 * Finding 1).
 */
function requireDefined<T>(
  value: T | null | undefined,
  message: string,
): asserts value is T {
  expect(value, message).toBeDefined();
}

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

    // M10-B: 7 capability-migrated routes — unauthenticated denied.
    //
    // The prior implementation only asserted `matrix.toHaveLength(7)` without
    // executing any HTTP request, so the test was vacuous
    // (RBAC-M10-B PR190 REVIEW CORRECTIVE 2). This table drives a real
    // `ctx.app.inject()` per route and asserts 401 on each, replacing the
    // seven duplicate single-route tests that covered the same ground.
    //
    // `method` is typed `HTTPMethods` and `payload` is optional, so each entry
    // flows into `ctx.app.inject()` without an `as never` cast.
    const m10bUnauthenticatedRoutes: ReadonlyArray<{
      method: HTTPMethods;
      url: string;
      payload?: object;
    }> = [
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

    it("contains exactly 7 M10-B unauthenticated routes", () => {
      expect(m10bUnauthenticatedRoutes).toHaveLength(7);
    });

    it.each(m10bUnauthenticatedRoutes)(
      "$method $url returns 401 without authentication",
      async ({ method, url, payload }) => {
        const res = await ctx.app.inject({
          method,
          url,
          ...(payload === undefined ? {} : { payload }),
        });

        expect(res.statusCode).toBe(401);
      },
    );
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
    //
    // RBAC-M10-B PR190 REVIEW CORRECTIVE 1, Finding 1:
    // Every fixture is created deterministically via direct schema inserts.
    // No test relies on incidental seed/baseline data. Each test fails fast
    // (requireDefined) if fixture creation somehow did not produce a row,
    // so the test can never pass vacuously through a silent early return.

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

    /**
     * Insert a course directly into the DB with a unique code. Deterministic:
     * does not depend on baseline seed data. Returns the created row.
     */
    async function insertCourse() {
      const now = new Date();
      const id = randomUUID();
      const code = `boundary-course-${uniquePrefix()}`;
      const rows = await ctx.db
        .insert(schema.courses)
        .values({
          id,
          organizationId: ctx.org.id,
          name: `Boundary Course ${code}`,
          code,
          description: "",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const course = rows[0];
      requireDefined(course, "insertCourse: course row must be created");
      return course;
    }

    /**
     * Insert an exam directly into the DB with the requested status. The exam
     * is wired to its own fresh course so it has no associated questions,
     * enrollments, or attempts — keeping the zero-write assertions isolated.
     *
     * `closeAt` is recorded on the returned object so callers can compare it
     * byte-exactly before/after a denied extend request.
     */
    async function insertExamInStatus(status: Exam["status"]) {
      const course = await insertCourse();
      const now = new Date();
      const id = randomUUID();
      // Open window straddles `now` so the persisted status is meaningful for
      // every transition under test (unpublish/extend/cancel/archive/delete).
      const openAt = new Date(now.getTime() - 60 * 60 * 1000);
      const closeAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const rows = await ctx.db
        .insert(schema.exams)
        .values({
          id,
          organizationId: ctx.org.id,
          title: `Boundary Exam ${status}-${uniquePrefix()}`,
          description: "",
          courseId: course.id,
          status,
          timingMode: "timed_window",
          durationMinutes: 60,
          openAt,
          closeAt,
          passingScore: 60,
          totalScore: 100,
          questionSelectionMode: "manual",
          questionIds: [],
          questionSnapshot: [],
          controlFlags: { ...DEFAULT_CONTROL_FLAGS },
          retakePolicy: "max_attempts",
          scoreStrategy: "highest",
          maxAttempts: 3,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const exam = rows[0];
      requireDefined(
        exam,
        `insertExamInStatus: ${status} exam must be created`,
      );
      return { course, exam };
    }

    it("unpublish denied — exam remains published", async () => {
      const examRepo = createExamRepo(ctx.db);
      const { exam: publishedExam } = await insertExamInStatus("published");

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${publishedExam.id}/unpublish`,
        payload: {},
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const reRead = await examRepo.findById(adminCtx(), publishedExam.id);
      requireDefined(reRead, "unpublish: exam must still exist after denial");
      expect(reRead.status).toBe("published");
      expect(reRead.updatedAt.getTime()).toBe(
        publishedExam.updatedAt.getTime(),
      );
    });

    it("extend denied — exam closeAt unchanged", async () => {
      const examRepo = createExamRepo(ctx.db);
      const { exam: openExam } = await insertExamInStatus("open");

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${openExam.id}/extend`,
        payload: { extendMinutes: 999 },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const reRead = await examRepo.findById(adminCtx(), openExam.id);
      requireDefined(reRead, "extend: exam must still exist after denial");
      expect(reRead.closeAt.getTime()).toBe(openExam.closeAt.getTime());
      expect(reRead.updatedAt.getTime()).toBe(openExam.updatedAt.getTime());
    });

    it("cancel denied — exam status unchanged", async () => {
      const examRepo = createExamRepo(ctx.db);
      const { exam: publishedExam } = await insertExamInStatus("published");

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${publishedExam.id}/cancel`,
        payload: {},
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const reRead = await examRepo.findById(adminCtx(), publishedExam.id);
      requireDefined(reRead, "cancel: exam must still exist after denial");
      expect(reRead.status).toBe("published");
      expect(reRead.updatedAt.getTime()).toBe(
        publishedExam.updatedAt.getTime(),
      );
    });

    it("archive denied — exam remains closed", async () => {
      const examRepo = createExamRepo(ctx.db);
      const { exam: closedExam } = await insertExamInStatus("closed");

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${closedExam.id}/archive`,
        payload: {},
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const reRead = await examRepo.findById(adminCtx(), closedExam.id);
      requireDefined(reRead, "archive: exam must still exist after denial");
      expect(reRead.status).toBe("closed");
      expect(reRead.updatedAt.getTime()).toBe(closedExam.updatedAt.getTime());
    });

    it("exam delete denied — exam still exists with unchanged state", async () => {
      const examRepo = createExamRepo(ctx.db);
      const { exam: draftExam } = await insertExamInStatus("draft");

      const res = await ctx.app.inject({
        method: "DELETE",
        url: `/api/exams/${draftExam.id}`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const reRead = await examRepo.findById(adminCtx(), draftExam.id);
      requireDefined(reRead, "exam delete: exam must still exist after denial");
      expect(reRead.id).toBe(draftExam.id);
      expect(reRead.status).toBe("draft");
      expect(reRead.title).toBe(draftExam.title);
      expect(reRead.updatedAt.getTime()).toBe(draftExam.updatedAt.getTime());
    });

    it("course delete denied — course still exists with unchanged state", async () => {
      const courseRepo = createCourseRepo(ctx.db);
      const course = await insertCourse();

      const res = await ctx.app.inject({
        method: "DELETE",
        url: `/api/courses/${course.id}`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const reRead = await courseRepo.findById(adminCtx(), course.id);
      requireDefined(
        reRead,
        "course delete: course must still exist after denial",
      );
      expect(reRead.id).toBe(course.id);
      expect(reRead.code).toBe(course.code);
      expect(reRead.name).toBe(course.name);
      expect(reRead.updatedAt.getTime()).toBe(course.updatedAt.getTime());
    });

    it("score export denied — no audit log written for this exam", async () => {
      const { exam: targetExam } = await insertExamInStatus("closed");
      const auditRepo = createAuditLogRepo(ctx.db);

      // Precise filter: audit events scoped to THIS exam, by action. Avoids
      // global row-count comparisons that would be fragile under concurrent
      // test fixtures. The denied request must produce zero new matching
      // audit events for this exam.
      const before = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        {
          targetType: "exam",
          targetId: targetExam.id,
          action: "export_scores",
        },
      );

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/exams/${targetExam.id}/export/scores`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const after = await auditRepo.listPaginatedFiltered(adminCtx(), 1, 1000, {
        targetType: "exam",
        targetId: targetExam.id,
        action: "export_scores",
      });
      expect(after.total).toBe(before.total);
      expect(after.items.length).toBe(before.items.length);
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
