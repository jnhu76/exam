import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import courseRoutes from "../routes/course.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  uniquePrefix,
  type TestContext,
} from "../routes/testHelpers.js";

/**
 * F-04 — Teacher@Course scope CONTRACT (issue #286).
 *
 * The former characterization file proved the PRE-#286 org-wide reach
 * (Teacher listed / read every org course). Issue #286 implements the scoped
 * model, so this file now asserts the new contract as a regression lock:
 *
 *   - LIST  GET /courses   → non-Admin actors see ONLY their assigned courses
 *                            (SQL-side filter BEFORE pagination/total);
 *   - DETAIL GET /courses/:id → out-of-scope direct-ID probes fold into the
 *                            canonical 404 RESOURCE_NOT_FOUND (anti-
 *                            enumeration, indistinguishable from missing);
 *   - Admin stays org-wide in both paths;
 *   - authority = capability × assignment: the scope row alone grants
 *     NOTHING (a non-Teacher actor with an assignment row is still denied by
 *     the capability stage; a Teacher whose assignment was revoked loses
 *     access on the NEXT request).
 *
 * Proven endpoints: course list + course detail. The wider matrix (questions,
 * exams, scores, candidates, tags) is covered by the route-level suites.
 */
describe("F-04 Teacher@Course scope — enforced contract (issue #286)", () => {
  let ctx: TestContext;
  let teacherToken: string;
  let teacherUserId: string;
  let courseAId: string;
  let courseBId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(courseRoutes);
    const teacher = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "f04-teacher",
    );
    teacherToken = teacher.token;
    teacherUserId = teacher.user.id;

    const createCourse = async (name: string, code: string) => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/courses",
        payload: { name, code, description: "F-04 scope contract course" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(201);
      return res.json() as { id: string };
    };
    courseAId = (await createCourse("F-04 Course A", `FA-${uniquePrefix()}`))
      .id;
    courseBId = (await createCourse("F-04 Course B", `FB-${uniquePrefix()}`))
      .id;

    // Assign the Teacher to Course A ONLY.
    const now = new Date();
    await ctx.db.insert(schema.teacherCourseAssignments).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      teacherUserId,
      courseId: courseAId,
      status: "active",
      assignedBy: ctx.admin.id,
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("Teacher lists ONLY assigned courses (Course A visible, Course B hidden)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/courses",
      cookies: { "auth-token": teacherToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = (body.items as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(courseAId);
    expect(ids).not.toContain(courseBId);
    // total reflects the SCOPE-filtered count, computed in SQL before the
    // page slice — never the org-wide total post-filtered.
    expect(body.total).toBe(1);
  });

  it("Teacher reads an ASSIGNED course by id", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/courses/${courseAId}`,
      cookies: { "auth-token": teacherToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(courseAId);
  });

  it("direct-ID probe of an UNASSIGNED course → 404 RESOURCE_NOT_FOUND (anti-enumeration)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/courses/${courseBId}`,
      cookies: { "auth-token": teacherToken },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("Admin stays org-wide (both courses listed and readable)", async () => {
    const list = await ctx.app.inject({
      method: "GET",
      url: "/api/courses",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(list.statusCode).toBe(200);
    const ids = (list.json().items as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(courseAId);
    expect(ids).toContain(courseBId);

    const detail = await ctx.app.inject({
      method: "GET",
      url: `/api/courses/${courseBId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().id).toBe(courseBId);
  });

  it("revoking the assignment removes LIST + DETAIL access on the NEXT request", async () => {
    const revokedAt = new Date();
    await ctx.db
      .update(schema.teacherCourseAssignments)
      .set({
        status: "revoked",
        revokedBy: ctx.admin.id,
        revokedAt,
        updatedAt: revokedAt,
      })
      .where(
        and(
          eq(schema.teacherCourseAssignments.organizationId, ctx.org.id),
          eq(schema.teacherCourseAssignments.teacherUserId, teacherUserId),
          eq(schema.teacherCourseAssignments.courseId, courseAId),
        ),
      );

    const list = await ctx.app.inject({
      method: "GET",
      url: "/api/courses",
      cookies: { "auth-token": teacherToken },
    });
    expect(list.statusCode).toBe(200);
    const ids = (list.json().items as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(courseAId);
    expect(ids).not.toContain(courseBId);

    const detail = await ctx.app.inject({
      method: "GET",
      url: `/api/courses/${courseAId}`,
      cookies: { "auth-token": teacherToken },
    });
    expect(detail.statusCode).toBe(404);
  });
});
