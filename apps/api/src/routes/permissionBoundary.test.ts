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
import roleAssignmentRoutes from "./roleAssignments.js";
import scoreRoutes from "./scores.js";
import { exportRoutes } from "./export.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createCourseRepo } from "@exam/db/src/repository/courseRepo.js";
import {
  createAuditLogRepo,
  type AuditLogListFilter,
} from "@exam/db/src/repository/auditLogRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { DEFAULT_CONTROL_FLAGS } from "./attempts/attempts.testHelpers.js";
import type { Exam } from "@exam/domain";
import { hashPassword } from "@exam/auth/src/password.js";
import { eq } from "drizzle-orm";

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

/** Reads an awaited atomic/sensitive audit count immediately after response. */
async function readAuditCount<TFilter extends AuditLogListFilter>(
  auditRepo: ReturnType<typeof createAuditLogRepo>,
  ctx: Parameters<typeof auditRepo.listPaginatedFiltered>[0],
  expectedTotal: number,
  filter: TFilter,
): Promise<number> {
  const result = await auditRepo.listPaginatedFiltered(ctx, 1, 1000, filter);
  expect(result.total).toBe(expectedTotal);
  return result.total;
}

/** Asserts immediate atomic/sensitive audit absence after rejection. */
async function expectAuditCount<TFilter extends AuditLogListFilter>(
  auditRepo: ReturnType<typeof createAuditLogRepo>,
  ctx: Parameters<typeof auditRepo.listPaginatedFiltered>[0],
  expectedTotal: number,
  filter: TFilter,
): Promise<void> {
  const result = await auditRepo.listPaginatedFiltered(ctx, 1, 1000, filter);
  expect(result.total).toBe(expectedTotal);
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
      await fastify.register(roleAssignmentRoutes);
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

  // ─────────────────── M10-C: identity & role-assignment ────────────────────
  //
  // M10-C migrates 10 routes from legacy requireRole(["Admin"]) to flat
  // capability gates (Permission.UserView / UserCreate / UserUpdate /
  // UserPasswordReset / UserDelete / UserRoleAssign). All six permissions are
  // Admin-only in the current role presets, so this block proves:
  //
  //   1. unauthenticated → 401 on all 10 routes
  //   2. Candidate → 403 on all 10 routes
  //   3. Teacher / Proctor / Grader → 403 on all 10 routes
  //   4. System login path unavailable (System is non-login)
  //   5. denied mutations leave zero business write (user row, password hash,
  //      account status, users.role, role-assignment rows, primary assignment)
  //   6. denied mutations leave zero audit write
  //   7. successful primary-assignment mutations still sync users.role
  //      (compatibility invariant preserved — runtime authority unchanged)
  //   8. Admin reaches the handler (capability decision = allow) on read routes
  //
  // Same non-vacuity discipline as M10-B: every fixture is created via direct
  // schema insert with a deterministic unique prefix; every read-back is
  // fail-fast via requireDefined.

  describe("M10-C unauthenticated matrix — all 10 routes return 401", () => {
    const placeholderId = "00000000-0000-0000-0000-000000000000";
    const m10cUnauthenticatedRoutes: ReadonlyArray<{
      method: HTTPMethods;
      url: string;
      payload?: object;
    }> = [
      { method: "GET", url: "/api/users" },
      {
        method: "POST",
        url: "/api/users",
        payload: {
          username: "should-not-create",
          password: "password123",
          name: "Should Not",
          role: "Candidate",
        },
      },
      {
        method: "PATCH",
        url: `/api/users/${placeholderId}`,
        payload: { name: "Should Not" },
      },
      {
        method: "POST",
        url: `/api/users/${placeholderId}/reset-password`,
        payload: { newPassword: "ShouldNot123!" },
      },
      { method: "DELETE", url: `/api/users/${placeholderId}` },
      { method: "GET", url: "/api/roles/assignable" },
      {
        method: "GET",
        url: `/api/users/${placeholderId}/role-assignments`,
      },
      {
        method: "POST",
        url: `/api/users/${placeholderId}/role-assignments`,
        payload: { role: "Teacher", isPrimary: false },
      },
      {
        method: "PATCH",
        url: `/api/role-assignments/${placeholderId}`,
        payload: { isPrimary: true },
      },
      {
        method: "DELETE",
        url: `/api/role-assignments/${placeholderId}`,
      },
    ];

    it.each(m10cUnauthenticatedRoutes)(
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

  describe("M10-C non-Admin denial matrix — Candidate/Teacher/Proctor/Grader get 403", () => {
    let candidateToken: string;
    let teacherToken: string;
    let proctorToken: string;
    let graderToken: string;

    // Deterministic target fixtures created once per describe (worker-DB
    // isolation resets between runs; unique prefix avoids in-run collisions).
    let candidateTargetId: string;
    let assignmentId: string;

    async function insertTargetUser(
      role: "Admin" | "Candidate" = "Candidate",
      usernamePrefix = "m10c-target",
    ) {
      const id = randomUUID();
      const username = `${usernamePrefix}-${uniquePrefix()}`;
      const now = new Date();
      const rows = await ctx.db
        .insert(schema.users)
        .values({
          id,
          organizationId: ctx.org.id,
          username,
          passwordHash: await hashPassword("password123"),
          name: `M10C ${username}`,
          role,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const user = rows[0];
      requireDefined(user, "insertTargetUser: user row must be created");
      // Seed a primary active assignment so the role-assignment routes have a
      // real target. (Both stores must agree for sync tests to be meaningful.)
      const aRows = await ctx.db
        .insert(schema.userRoleAssignments)
        .values({
          id: randomUUID(),
          organizationId: ctx.org.id,
          userId: id,
          role,
          isPrimary: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const assignment = aRows[0];
      requireDefined(
        assignment,
        "insertTargetUser: assignment row must be created",
      );
      return { user, assignment };
    }

    beforeAll(async () => {
      // Mint a Candidate via the API so its session is real.
      const candidate = await createCandidateViaApi(
        ctx.app,
        ctx.adminToken,
        `m10c-cand-${uniquePrefix()}`,
        ctx.org.id,
      );
      candidateToken = candidate.token;
      // Future roles via direct DB insert (consistent with the M10-B pattern).
      const teacher = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Teacher",
        "m10c-tchr",
      );
      teacherToken = teacher.token;
      const proctor = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Proctor",
        "m10c-proc",
      );
      proctorToken = proctor.token;
      const grader = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Grader",
        "m10c-grad",
      );
      graderToken = grader.token;

      // Deterministic fixtures for the parameterized routes.
      const { user, assignment } = await insertTargetUser();
      candidateTargetId = user.id;
      assignmentId = assignment.id;
    });

    const m10cRoutes: ReadonlyArray<{
      method: HTTPMethods;
      buildUrl: () => string;
      payload?: object;
      label: string;
    }> = [
      { method: "GET", buildUrl: () => "/api/users", label: "list users" },
      {
        method: "POST",
        buildUrl: () => "/api/users",
        payload: {
          username: `m10c-deny-${uniquePrefix()}`,
          password: "password123",
          name: "M10C Deny",
          role: "Candidate",
        },
        label: "create user",
      },
      {
        method: "PATCH",
        buildUrl: () => `/api/users/${candidateTargetId}`,
        payload: { name: "Should Not Update" },
        label: "update user",
      },
      {
        method: "POST",
        buildUrl: () => `/api/users/${candidateTargetId}/reset-password`,
        payload: { newPassword: "ShouldNot123!" },
        label: "reset password",
      },
      {
        method: "DELETE",
        buildUrl: () => `/api/users/${candidateTargetId}`,
        label: "delete user",
      },
      {
        method: "GET",
        buildUrl: () => "/api/roles/assignable",
        label: "list assignable roles",
      },
      {
        method: "GET",
        buildUrl: () => `/api/users/${candidateTargetId}/role-assignments`,
        label: "list user assignments",
      },
      {
        method: "POST",
        buildUrl: () => `/api/users/${candidateTargetId}/role-assignments`,
        payload: { role: "Teacher", isPrimary: false },
        label: "create assignment",
      },
      {
        method: "PATCH",
        buildUrl: () => `/api/role-assignments/${assignmentId}`,
        payload: { isPrimary: true },
        label: "promote assignment",
      },
      {
        method: "DELETE",
        buildUrl: () => `/api/role-assignments/${assignmentId}`,
        label: "delete assignment",
      },
    ];

    it("Candidate denied on all 10 M10-C routes", async () => {
      for (const { method, buildUrl, payload, label } of m10cRoutes) {
        const res = await ctx.app.inject({
          method,
          url: buildUrl(),
          ...(payload === undefined ? {} : { payload }),
          cookies: { "auth-token": candidateToken },
        });
        expect(res.statusCode, `Candidate → ${label}`).toBe(403);
      }
    });

    it("Teacher denied on all 10 M10-C routes", async () => {
      for (const { method, buildUrl, payload, label } of m10cRoutes) {
        const res = await ctx.app.inject({
          method,
          url: buildUrl(),
          ...(payload === undefined ? {} : { payload }),
          cookies: { "auth-token": teacherToken },
        });
        expect(res.statusCode, `Teacher → ${label}`).toBe(403);
      }
    });

    it("Proctor denied on all 10 M10-C routes", async () => {
      for (const { method, buildUrl, payload, label } of m10cRoutes) {
        const res = await ctx.app.inject({
          method,
          url: buildUrl(),
          ...(payload === undefined ? {} : { payload }),
          cookies: { "auth-token": proctorToken },
        });
        expect(res.statusCode, `Proctor → ${label}`).toBe(403);
      }
    });

    it("Grader denied on all 10 M10-C routes", async () => {
      for (const { method, buildUrl, payload, label } of m10cRoutes) {
        const res = await ctx.app.inject({
          method,
          url: buildUrl(),
          ...(payload === undefined ? {} : { payload }),
          cookies: { "auth-token": graderToken },
        });
        expect(res.statusCode, `Grader → ${label}`).toBe(403);
      }
    });
  });

  describe("M10-C System login path is unavailable", () => {
    // The System preset is `loginAllowed: false` and `assignable: false`
    // (packages/authz/src/presets.ts). Two distinct boundaries prevent a
    // System principal from reaching any M10-C handler, and each requires
    // its own test (CodeRabbit review on PR #191):
    //
    //   1. AUTHENTICATION BOUNDARY — a forged JWT whose actorId has no
    //      matching active user row is rejected by the `authenticate`
    //      plugin with 401 AUTH_REQUIRED before any capability check.
    //      This protects against forged-JWT attacks regardless of role.
    //
    //   2. SYSTEM-ROLE POLICY BOUNDARY — even when a real active
    //      System-role user presents valid credentials at POST /auth/login,
    //      the login handler rejects it at `auth.ts` ASSIGNABLE_LOGIN_ROLES
    //      with 401 AUTH_INVALID_CREDENTIALS + login.failure audit
    //      (reason=non_login_role). This is the actual System non-login
    //      policy from ADR §System Actor Policy.
    //
    // The prior single test conflated these two by minting a forged JWT
    // for a non-existent actor and accepting [401, 403]. That proved only
    // boundary #1. It is split and tightened below.

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

    it("a forged System-claimed JWT with no user row is rejected by authenticate with 401", async () => {
      // Boundary #1: authenticate plugin requires an active user row.
      // A JWT claiming any role (including System) for a non-existent
      // actorId is rejected before the capability gate. Exact 401 —
      // never 403, because the capability gate is never reached.
      const { signJWT } = await import("@exam/auth/src/session.js");
      const { getRuntimeConfig } = await import("../config/runtimeConfig.js");
      const systemToken = signJWT(
        {
          actorId: randomUUID(),
          role: "System" as never,
          organizationId: ctx.org.id,
        },
        getRuntimeConfig().authSecret.jwtSecret,
      );
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/users",
        cookies: { "auth-token": systemToken },
      });
      expect(res.statusCode).toBe(401);
    });

    it("an active System-role user cannot login via POST /auth/login (401, no cookie, non_login_role audit)", async () => {
      // Boundary #2: the actual System-role non-login policy.
      // Seed a real active System-role user with a valid password
      // (users.role is plain text — no CHECK constraint — so direct
      // insert of role="System" is allowed; createFutureRoleUserForTest
      // cannot be used because LegacyRole excludes "System").
      const username = `m10c-system-${uniquePrefix()}`;
      const password = "password123";
      const userId = randomUUID();
      const now = new Date();
      const rows = await ctx.db
        .insert(schema.users)
        .values({
          id: userId,
          organizationId: ctx.org.id,
          username,
          passwordHash: await hashPassword(password),
          name: "M10C System User",
          role: "System",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const systemUser = rows[0];
      requireDefined(systemUser, "System user must be seeded");

      // Audit count before — scoped to login.failure for this user.
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "login.failure", targetType: "login", targetId: userId },
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username, password },
      });

      // Exact 401 — System-role rejection, not invalid credentials.
      expect(res.statusCode).toBe(401);
      // No auth-token cookie issued (login did not succeed).
      const setCookie = res.headers["set-cookie"];
      if (setCookie !== undefined) {
        const cookieHeader = Array.isArray(setCookie)
          ? setCookie.join(";")
          : setCookie;
        expect(cookieHeader).not.toContain("auth-token=");
      }
      // Generic error code — does not leak the System-role reason.
      expect(res.json().error.code).toBe("AUTH_INVALID_CREDENTIALS");
      // Tenant login audit is tracked best-effort. Drain the tracked work
      // before asserting its eventual evidence; the 401 above must not wait
      // for audit storage.
      await ctx.drainAuditWrites();
      const auditTotal = await readAuditCount(
        auditRepo,
        adminCtx(),
        auditBefore.total + 1,
        { action: "login.failure", targetType: "login", targetId: userId },
      );
      expect(auditTotal).toBe(auditBefore.total + 1);
      // Re-read to get the actual item for metadata assertions.
      const auditAfter = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "login.failure", targetType: "login", targetId: userId },
      );
      const newAudit = auditAfter.items.find(
        (a) => !auditBefore.items.some((b) => b.auditLog.id === a.auditLog.id),
      );
      requireDefined(newAudit, "new login.failure audit row must exist");
      const metadata = newAudit.auditLog.metadata as Record<string, unknown>;
      // RBAC-M10-E: System cannot hold an assignment (not in the assignable
      // set), so the authority resolver returns no_active_assignments before
      // the ASSIGNABLE_LOGIN_ROLES check is reached. The audit reason reflects
      // that — System is still rejected, just via the authority-first path.
      expect(metadata.reason).toBe("no_active_assignments");
      expect(metadata).not.toHaveProperty("username");
    });
  });

  describe("M10-C zero-write evidence — denied mutations", () => {
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
     * Insert a deterministic user + primary assignment directly into the DB.
     * Returns both rows so the caller can compare byte-exact state before
     * and after a denied request.
     */
    async function insertTargetUserWithAssignment(
      role: "Admin" | "Candidate" = "Candidate",
      usernamePrefix = "m10c-zw",
    ) {
      const id = randomUUID();
      const username = `${usernamePrefix}-${uniquePrefix()}`;
      const now = new Date();
      const userRows = await ctx.db
        .insert(schema.users)
        .values({
          id,
          organizationId: ctx.org.id,
          username,
          passwordHash: await hashPassword("password123"),
          name: `M10C ZW ${username}`,
          role,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const user = userRows[0];
      requireDefined(user, "insertTargetUserWithAssignment: user must exist");
      const aRows = await ctx.db
        .insert(schema.userRoleAssignments)
        .values({
          id: randomUUID(),
          organizationId: ctx.org.id,
          userId: id,
          role,
          isPrimary: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const assignment = aRows[0];
      requireDefined(
        assignment,
        "insertTargetUserWithAssignment: assignment must exist",
      );
      return { user, assignment };
    }

    async function readUser(id: string) {
      const rows = await ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, id));
      return rows[0] ?? null;
    }

    async function readAssignmentsForUser(userId: string) {
      return ctx.db
        .select()
        .from(schema.userRoleAssignments)
        .where(eq(schema.userRoleAssignments.userId, userId));
    }

    it("POST /users denied — no new user row, no new assignment, no audit", async () => {
      const userRepo = createUserRepo(ctx.db);
      const auditRepo = createAuditLogRepo(ctx.db);
      const beforeCount = await userRepo.listPaginatedByRoles(
        adminCtx(),
        ["Admin", "Candidate"],
        1,
        1000,
      );
      const auditBefore = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.create" },
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/users",
        payload: {
          username: `m10c-deny-create-${uniquePrefix()}`,
          password: "password123",
          name: "Should Not Exist",
          role: "Candidate",
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const afterCount = await userRepo.listPaginatedByRoles(
        adminCtx(),
        ["Admin", "Candidate"],
        1,
        1000,
      );
      expect(afterCount.total).toBe(beforeCount.total);
      await expectAuditCount(auditRepo, adminCtx(), auditBefore.total, {
        action: "user.create",
      });
    });

    it("PATCH /users/:id denied — user row, role, password hash, active status all unchanged", async () => {
      const { user } = await insertTargetUserWithAssignment();
      const before = await readUser(user.id);
      requireDefined(before, "PATCH deny: user must exist before");
      // CodeRabbit PR #191 review: assert unchanged route-specific audit
      // count (user.update) scoped to (org, targetType=user, targetId).
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.update", targetType: "user", targetId: user.id },
      );

      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/users/${user.id}`,
        payload: { name: "Hacked Name", isActive: false },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const after = await readUser(user.id);
      requireDefined(after, "PATCH deny: user must still exist after denial");
      expect(after.name).toBe(before.name);
      expect(after.role).toBe(before.role);
      expect(after.isActive).toBe(before.isActive);
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      await expectAuditCount(auditRepo, adminCtx(), auditBefore.total, {
        action: "user.update",
        targetType: "user",
        targetId: user.id,
      });
    });

    it("POST /users/:id/reset-password denied — password hash unchanged", async () => {
      const { user } = await insertTargetUserWithAssignment("Candidate");
      const before = await readUser(user.id);
      requireDefined(before, "reset-password deny: user must exist before");
      // CodeRabbit PR #191 review: assert unchanged route-specific audit
      // count (candidate.password_reset) scoped to (org, targetType=user,
      // targetId).
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        {
          action: "candidate.password_reset",
          targetType: "user",
          targetId: user.id,
        },
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${user.id}/reset-password`,
        payload: { newPassword: "HackedPass123!" },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const after = await readUser(user.id);
      requireDefined(after, "reset-password deny: user must still exist");
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      await expectAuditCount(auditRepo, adminCtx(), auditBefore.total, {
        action: "candidate.password_reset",
        targetType: "user",
        targetId: user.id,
      });
    });

    it("DELETE /users/:id denied — user row still exists, assignment rows intact", async () => {
      const { user, assignment } = await insertTargetUserWithAssignment();
      const beforeUser = await readUser(user.id);
      requireDefined(beforeUser, "DELETE deny: user must exist before");
      const beforeAssignments = await readAssignmentsForUser(user.id);
      expect(beforeAssignments.some((a) => a.id === assignment.id)).toBe(true);
      // CodeRabbit PR #191 review: assert unchanged route-specific audit
      // count (user.delete) scoped to (org, targetType=user, targetId).
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.delete", targetType: "user", targetId: user.id },
      );

      const res = await ctx.app.inject({
        method: "DELETE",
        url: `/api/users/${user.id}`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const afterUser = await readUser(user.id);
      requireDefined(afterUser, "DELETE deny: user must still exist");
      expect(afterUser.updatedAt.getTime()).toBe(
        beforeUser.updatedAt.getTime(),
      );
      const afterAssignments = await readAssignmentsForUser(user.id);
      expect(afterAssignments.length).toBe(beforeAssignments.length);
      expect(afterAssignments.some((a) => a.id === assignment.id)).toBe(true);
      await expectAuditCount(auditRepo, adminCtx(), auditBefore.total, {
        action: "user.delete",
        targetType: "user",
        targetId: user.id,
      });
    });

    it("POST /users/:id/role-assignments denied — no new assignment row, users.role unchanged, no audit", async () => {
      const { user } = await insertTargetUserWithAssignment("Candidate");
      const beforeUser = await readUser(user.id);
      requireDefined(beforeUser, "POST assignment deny: user must exist");
      const beforeAssignments = await readAssignmentsForUser(user.id);
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.role_changed", targetId: user.id },
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${user.id}/role-assignments`,
        payload: { role: "Teacher", isPrimary: true },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const afterUser = await readUser(user.id);
      requireDefined(afterUser, "POST assignment deny: user must still exist");
      expect(afterUser.role).toBe(beforeUser.role);
      expect(afterUser.updatedAt.getTime()).toBe(
        beforeUser.updatedAt.getTime(),
      );
      const afterAssignments = await readAssignmentsForUser(user.id);
      expect(afterAssignments.length).toBe(beforeAssignments.length);
      await expectAuditCount(auditRepo, adminCtx(), auditBefore.total, {
        action: "user.role_changed",
        targetId: user.id,
      });
    });

    it("PATCH /role-assignments/:assignmentId denied — promote-to-primary branch never runs, no audit", async () => {
      // CodeRabbit PR #191 review: the prior payload `{ isPrimary: false }`
      // hit the no-op throw branch at roleAssignments.ts (neither
      // `isPrimary===true` nor `isActive===false`). The denial held only
      // because the capability gate fires first — the test would also
      // pass with an empty payload. Switch to the REAL promote branch
      // (`isPrimary: true` against a secondary assignment) so the test
      // would fail if the gate ever let an unauthorized principal reach
      // a state-changing promote operation.
      const { user, assignment: primaryAssignment } =
        await insertTargetUserWithAssignment("Candidate");
      // Seed a SECONDARY Grader assignment as the promote target.
      const now = new Date();
      const secondaryRows = await ctx.db
        .insert(schema.userRoleAssignments)
        .values({
          id: randomUUID(),
          organizationId: ctx.org.id,
          userId: user.id,
          role: "Grader",
          isPrimary: false,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const secondaryAssignment = secondaryRows[0];
      requireDefined(
        secondaryAssignment,
        "PATCH assignment deny: secondary assignment must be seeded",
      );

      const beforeUser = await readUser(user.id);
      requireDefined(beforeUser, "PATCH assignment deny: user must exist");
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.role_changed", targetType: "user", targetId: user.id },
      );

      // Denial payload targets the REAL promote branch: this WOULD
      // promote the secondary Grader assignment to primary, demote the
      // Candidate primary, sync users.role → "Grader", and write
      // user.role_changed audit if the handler ran.
      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/role-assignments/${secondaryAssignment.id}`,
        payload: { isPrimary: true },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      // Secondary assignment must remain non-primary.
      const secondaryRowsAfter = await ctx.db
        .select()
        .from(schema.userRoleAssignments)
        .where(eq(schema.userRoleAssignments.id, secondaryAssignment.id));
      const secondaryAfter = secondaryRowsAfter[0];
      requireDefined(
        secondaryAfter,
        "PATCH assignment deny: secondary assignment must still exist",
      );
      expect(secondaryAfter.isPrimary).toBe(false);
      expect(secondaryAfter.isActive).toBe(true);
      expect(secondaryAfter.role).toBe("Grader");
      // Primary Candidate assignment must remain the sole primary.
      const primaryRowsAfter = await ctx.db
        .select()
        .from(schema.userRoleAssignments)
        .where(eq(schema.userRoleAssignments.id, primaryAssignment.id));
      const primaryAfter = primaryRowsAfter[0];
      requireDefined(
        primaryAfter,
        "PATCH assignment deny: primary assignment must still exist",
      );
      expect(primaryAfter.isPrimary).toBe(true);
      expect(primaryAfter.role).toBe("Candidate");
      // users.role must be unchanged — the sync path was never reached.
      const afterUser = await readUser(user.id);
      requireDefined(afterUser, "PATCH assignment deny: user must still exist");
      expect(afterUser.role).toBe(beforeUser.role);
      expect(afterUser.role).toBe("Candidate");
      await expectAuditCount(auditRepo, adminCtx(), auditBefore.total, {
        action: "user.role_changed",
        targetType: "user",
        targetId: user.id,
      });
    });

    it("DELETE /role-assignments/:assignmentId denied — assignment row still exists, users.role unchanged, no audit", async () => {
      const { user, assignment } = await insertTargetUserWithAssignment();
      const beforeUser = await readUser(user.id);
      requireDefined(beforeUser, "DELETE assignment deny: user must exist");
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        {
          action: "user.role_changed",
          targetType: "role_assignment",
          targetId: assignment.id,
        },
      );

      const res = await ctx.app.inject({
        method: "DELETE",
        url: `/api/role-assignments/${assignment.id}`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);

      const rows = await ctx.db
        .select()
        .from(schema.userRoleAssignments)
        .where(eq(schema.userRoleAssignments.id, assignment.id));
      const after = rows[0];
      requireDefined(
        after,
        "DELETE assignment deny: assignment must still exist",
      );
      expect(after.isPrimary).toBe(assignment.isPrimary);
      const afterUser = await readUser(user.id);
      requireDefined(
        afterUser,
        "DELETE assignment deny: user must still exist",
      );
      expect(afterUser.role).toBe(beforeUser.role);
      await expectAuditCount(auditRepo, adminCtx(), auditBefore.total, {
        action: "user.role_changed",
        targetType: "role_assignment",
        targetId: assignment.id,
      });
    });
  });

  describe("M10-C users.role compatibility synchronization (preserved)", () => {
    // The runtime authority is still users.role (M10-E has not started).
    // M10-C must NOT change this. It must preserve the existing sync invariant:
    // every primary-active assignment mutation re-syncs users.role.
    //
    // These positive-path tests prove the sync still happens after the
    // capability-gate migration — they would fail if the migration had
    // accidentally removed a syncUsersRoleFromPrimary call site.

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

    async function insertTargetUserWithPrimary(
      role: "Admin" | "Candidate" = "Candidate",
      usernamePrefix = "m10c-sync",
    ) {
      const id = randomUUID();
      const username = `${usernamePrefix}-${uniquePrefix()}`;
      const now = new Date();
      const userRows = await ctx.db
        .insert(schema.users)
        .values({
          id,
          organizationId: ctx.org.id,
          username,
          passwordHash: await hashPassword("password123"),
          name: `M10C Sync ${username}`,
          role,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const user = userRows[0];
      requireDefined(user, "insertTargetUserWithPrimary: user must exist");
      const aRows = await ctx.db
        .insert(schema.userRoleAssignments)
        .values({
          id: randomUUID(),
          organizationId: ctx.org.id,
          userId: id,
          role,
          isPrimary: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const primary = aRows[0];
      requireDefined(
        primary,
        "insertTargetUserWithPrimary: primary assignment must exist",
      );
      return { user, primary };
    }

    async function readUserRole(userId: string) {
      const rows = await ctx.db
        .select({ role: schema.users.role })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      const r = rows[0];
      requireDefined(r, "readUserRole: user must exist");
      return r.role;
    }

    it("PATCH promote-to-primary syncs users.role to the promoted role", async () => {
      const { user } = await insertTargetUserWithPrimary("Candidate");
      // Add a secondary Grader assignment to promote.
      const addRes = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${user.id}/role-assignments`,
        payload: { role: "Grader", isPrimary: false },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(addRes.statusCode).toBe(201);
      const graderAssignmentId = addRes.json().id;

      const promoteRes = await ctx.app.inject({
        method: "PATCH",
        url: `/api/role-assignments/${graderAssignmentId}`,
        payload: { isPrimary: true },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(promoteRes.statusCode).toBe(200);
      expect(await readUserRole(user.id)).toBe("Grader");
    });

    it("DELETE a primary assignment auto-promotes the next active and syncs users.role", async () => {
      const { user } = await insertTargetUserWithPrimary("Candidate");
      // Add a secondary Grader assignment to auto-promote.
      const addRes = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${user.id}/role-assignments`,
        payload: { role: "Grader", isPrimary: false },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(addRes.statusCode).toBe(201);

      // Find the primary Candidate assignment id, then delete it.
      const listRes = await ctx.app.inject({
        method: "GET",
        url: `/api/users/${user.id}/role-assignments`,
        cookies: { "auth-token": ctx.adminToken },
      });
      const items = listRes.json().items as Array<{
        id: string;
        role: string;
        isPrimary: boolean;
      }>;
      const primary = items.find((i) => i.role === "Candidate" && i.isPrimary);
      requireDefined(primary, "sync delete: primary Candidate assignment");
      const delRes = await ctx.app.inject({
        method: "DELETE",
        url: `/api/role-assignments/${primary.id}`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(delRes.statusCode).toBe(204);
      expect(await readUserRole(user.id)).toBe("Grader");
    });

    it("PATCH /users/:id role-change syncs users.role to the new role", async () => {
      const { user } = await insertTargetUserWithPrimary("Candidate");
      const auditRepo = createAuditLogRepo(ctx.db);
      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/users/${user.id}`,
        payload: { role: "Admin" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().role).toBe("Admin");
      expect(await readUserRole(user.id)).toBe("Admin");

      const roleAudits = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.role_changed", targetId: user.id },
      );
      const genericAudits = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.update", targetId: user.id },
      );
      const profileAudits = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.profile_updated", targetId: user.id },
      );
      expect(roleAudits.total).toBe(1);
      expect(genericAudits.total).toBe(0);
      expect(profileAudits.total).toBe(0);
    });

    it("POST secondary assignment writes a user.role_changed audit", async () => {
      const { user } = await insertTargetUserWithPrimary("Candidate");
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.role_changed", targetId: user.id },
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${user.id}/role-assignments`,
        payload: { role: "Proctor", isPrimary: false },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(201);

      const auditTotal = await readAuditCount(
        auditRepo,
        adminCtx(),
        auditBefore.total + 1,
        { action: "user.role_changed", targetId: user.id },
      );
      expect(auditTotal).toBe(auditBefore.total + 1);

      const auditAfter = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.role_changed", targetId: user.id },
      );
      const newRows = auditAfter.items.filter(
        (a) => !auditBefore.items.some((b) => b.auditLog.id === a.auditLog.id),
      );
      const newRow = newRows[0];
      requireDefined(newRow, "secondary assignment audit row");
      const meta = newRow.auditLog.metadata as Record<string, unknown>;
      expect(meta.assignmentAdded).toBe(true);
      expect(meta.role).toBe("Proctor");
      expect(meta.isPrimary).toBe(false);
    });

    it("PATCH deactivate secondary assignment writes a user.role_changed audit", async () => {
      const { user } = await insertTargetUserWithPrimary("Candidate");
      // Seed a secondary Grader assignment.
      const addRes = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${user.id}/role-assignments`,
        payload: { role: "Grader", isPrimary: false },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(addRes.statusCode).toBe(201);
      const secondaryId: string = addRes.json().id;

      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.role_changed", targetId: user.id },
      );

      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/role-assignments/${secondaryId}`,
        payload: { isActive: false },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);

      const auditTotal = await readAuditCount(
        auditRepo,
        adminCtx(),
        auditBefore.total + 1,
        { action: "user.role_changed", targetId: user.id },
      );
      expect(auditTotal).toBe(auditBefore.total + 1);

      const auditAfter = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.role_changed", targetId: user.id },
      );
      const newRows2 = auditAfter.items.filter(
        (a) => !auditBefore.items.some((b) => b.auditLog.id === a.auditLog.id),
      );
      const newRow2 = newRows2[0];
      requireDefined(newRow2, "deactivate secondary audit row");
      const meta = newRow2.auditLog.metadata as Record<string, unknown>;
      expect(meta.assignmentDeactivated).toBe(true);
      expect(meta.role).toBe("Grader");
      expect(meta.isPrimary).toBe(false);
      expect(meta.assignmentId).toBe(secondaryId);
      expect(await readUserRole(user.id)).toBe("Candidate");
    });

    it("PATCH deactivate primary assignment auto-promotes and writes audit", async () => {
      const { user } = await insertTargetUserWithPrimary("Candidate");
      const auditRepo = createAuditLogRepo(ctx.db);
      // Baseline before setup adds its own transactional role-change audit.
      const auditBefore = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.role_changed" },
      );
      // Seed a secondary Grader to auto-promote (writes audit).
      const addRes = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${user.id}/role-assignments`,
        payload: { role: "Grader", isPrimary: false },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(addRes.statusCode).toBe(201);

      // Find the primary Candidate assignment id.
      const listRes = await ctx.app.inject({
        method: "GET",
        url: `/api/users/${user.id}/role-assignments`,
        cookies: { "auth-token": ctx.adminToken },
      });
      const listItems = listRes.json().items as Array<{
        id: string;
        role: string;
        isPrimary: boolean;
      }>;
      const primary = listItems.find((i) => i.isPrimary);
      requireDefined(primary, "primary deactivate: primary assignment");

      // Deactivate primary (writes another user.role_changed audit).
      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/role-assignments/${primary.id}`,
        payload: { isActive: false },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);

      // Wait for BOTH audits (secondary-creation + primary-deactivation).
      const auditTotal = await readAuditCount(
        auditRepo,
        adminCtx(),
        auditBefore.total + 2,
        { action: "user.role_changed" },
      );
      expect(auditTotal).toBe(auditBefore.total + 2);

      const auditAfter = await auditRepo.listPaginatedFiltered(
        adminCtx(),
        1,
        1000,
        { action: "user.role_changed" },
      );
      const newRows3 = auditAfter.items.filter(
        (a) => !auditBefore.items.some((b) => b.auditLog.id === a.auditLog.id),
      );
      // newRows3 contains [deactivate_audit, secondary_audit] (DESC order).
      // newRows3[0] is the deactivation audit (most recent).
      const deactRow = newRows3[0];
      requireDefined(deactRow, "deactivate primary audit row");
      const lastMeta = deactRow.auditLog.metadata as Record<string, unknown>;
      expect(lastMeta.assignmentDeactivated).toBe(true);
      expect(lastMeta.oldPrimaryRole).toBe("Candidate");
      expect(lastMeta.resultingPrimaryRole).toBe("Grader");
      expect(lastMeta.assignmentId).toBe(primary.id);
      expect(await readUserRole(user.id)).toBe("Grader");
    });
  });
});
