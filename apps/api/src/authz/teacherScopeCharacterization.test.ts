import { afterAll, beforeAll, describe, expect, it } from "vitest";
import courseRoutes from "../routes/course.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  uniquePrefix,
  type TestContext,
} from "../routes/testHelpers.js";

/**
 * F-04 — Teacher course-scope CURRENT-REALITY characterization.
 *
 * TARGET model:     Teacher@Course — authority narrowed to assigned courses.
 * CURRENT reality:  org-wide effective reach. A Teacher can list and read
 *                   EVERY org course/question/exam; the flat requireCapability
 *                   gate checks only the capability, never an assigned-course
 *                   scope (none is persisted; no scope resolver exists).
 *
 * These tests PROVE the current org-wide behavior so it is explicit and cannot
 * regress silently. They deliberately DO NOT assert the desired Teacher@Course
 * narrowing — that is an unimplemented, explicitly-deferred scope-bundle
 * milestone (see packages/authz/src/presets.ts Teacher section + the
 * remediation report). P7-F is not blocked by F-04, but P7-F MUST NOT claim or
 * depend on Teacher course isolation until that milestone closes it.
 */
describe("F-04 Teacher course-scope — current org-wide reach (NOT the desired model)", () => {
  let ctx: TestContext;
  let teacherToken: string;
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

    const createCourse = async (name: string, code: string) => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/courses",
        payload: { name, code, description: "F-04 characterization course" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(201);
      return res.json() as { id: string };
    };
    courseAId = (await createCourse("F-04 Course A", `FA-${uniquePrefix()}`))
      .id;
    courseBId = (await createCourse("F-04 Course B", `FB-${uniquePrefix()}`))
      .id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("Teacher lists EVERY org course (org-wide LIST reach — F-04 gap)", async () => {
    // A scoped Teacher@Course model would return only the Teacher's assigned
    // courses. Today there is no assignment carrier and no LIST filter, so the
    // Teacher sees both courses regardless of any (non-existent) assignment.
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/courses",
      cookies: { "auth-token": teacherToken },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().items as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(courseAId);
    expect(ids).toContain(courseBId);
  });

  it("Teacher reads ANY org course by id (no per-course narrowing — F-04 gap)", async () => {
    // A scoped model would 403/404 a course the Teacher is not assigned to.
    // Today the flat CourseView gate admits every org course.
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/courses/${courseBId}`,
      cookies: { "auth-token": teacherToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(courseBId);
  });
});
