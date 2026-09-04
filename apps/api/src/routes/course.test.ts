import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { schema } from "@exam/db/src/schema/pg.js";
import courseRoutes, { isCourseCodeConflict } from "./course.js";
import {
  buildTestApp,
  createFutureRoleUserForTest,
  uniquePrefix,
} from "./testHelpers.js";

describe("isCourseCodeConflict (C1-R1 DB-authoritative classification)", () => {
  /** Mirrors the driver wrap the route actually sees: outer error with a cause chain down to the postgres.js error. */
  const wrappedUniqueViolation = () => {
    const pgError = Object.assign(new Error("任意非协议文本的数据库错误消息"), {
      code: "23505",
      constraint_name: "courses_org_code_unique",
    });
    return Object.assign(new Error("insert failed"), { cause: pgError });
  };

  it("matches 23505 + courses_org_code_unique through a cause chain regardless of message text", () => {
    expect(isCourseCodeConflict(wrappedUniqueViolation())).toBe(true);
    expect(
      isCourseCodeConflict(
        Object.assign(new Error("double wrap"), {
          cause: wrappedUniqueViolation(),
        }),
      ),
    ).toBe(true);
  });

  it("never classifies by message text alone (D0.6)", () => {
    const textOnly = new Error(
      'duplicate key value violates unique constraint "courses_org_code_unique"',
    );
    expect(isCourseCodeConflict(textOnly)).toBe(false);
  });

  it("does not swallow unrelated 23505 constraints on the same table", () => {
    const otherConstraint = Object.assign(new Error("dup"), {
      code: "23505",
      constraint_name: "courses_org_id_unique",
    });
    expect(isCourseCodeConflict(otherConstraint)).toBe(false);
    expect(
      isCourseCodeConflict(
        Object.assign(new Error("wrapped"), { cause: otherConstraint }),
      ),
    ).toBe(false);
  });

  it("rejects other SQLSTATEs and non-error inputs", () => {
    expect(
      isCourseCodeConflict(
        Object.assign(new Error("serialization"), { code: "40001" }),
      ),
    ).toBe(false);
    expect(isCourseCodeConflict(null)).toBe(false);
    expect(isCourseCodeConflict(undefined)).toBe(false);
  });
});

describe("course routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let teacherToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(courseRoutes);
    ({ token: teacherToken } = await createFutureRoleUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "course-teacher",
    ));
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("GET /api/courses returns paginated list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/courses",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body.items).toBeInstanceOf(Array);
  });

  it("POST /api/courses creates a course", async () => {
    const code = `TC-${uniquePrefix()}`;
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Test Course",
        code,
        description: "A test course",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Test Course");
    expect(body.code).toBe(code);
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("organizationId");
  });

  it("GET /api/courses/:id returns a single course", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Detail Course",
        code: `DC-${uniquePrefix()}`,
        description: "detail",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/courses/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Detail Course");
  });

  it("PATCH /api/courses/:id updates a course", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Update Course",
        code: `UC-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/courses/${created.id}`,
      payload: { name: "Updated Name" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Updated Name");
  });

  it("DELETE /api/courses/:id deletes a course", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Delete Course",
        code: `DEL-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/courses/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(204);
  });

  it("DELETE /api/courses/:id returns 404 for non-existent", async () => {
    const res = await ctx.app.inject({
      method: "DELETE",
      url: "/api/courses/00000000-0000-0000-0000-000000000000",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/courses requires Admin role", async () => {
    const candidateRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Forbidden",
        code: `F-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(candidateRes.statusCode).toBe(403);
  });

  it("allows Teacher to list, create, read, and update courses", async () => {
    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/courses",
      cookies: { "auth-token": teacherToken },
    });
    expect(listRes.statusCode).toBe(200);

    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Teacher Course",
        code: `TCH-${uniquePrefix()}`,
        description: "Teacher-owned authoring dependency",
      },
      cookies: { "auth-token": teacherToken },
    });
    expect(createRes.statusCode).toBe(201);
    const courseId = createRes.json().id as string;

    const detailRes = await ctx.app.inject({
      method: "GET",
      url: `/api/courses/${courseId}`,
      cookies: { "auth-token": teacherToken },
    });
    expect(detailRes.statusCode).toBe(200);

    const updateRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/courses/${courseId}`,
      payload: { name: "Teacher Updated Course" },
      cookies: { "auth-token": teacherToken },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().name).toBe("Teacher Updated Course");
  });

  it("keeps course deletion unavailable to Teacher", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Teacher Non-delete Course",
        code: `TND-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });

    const deleteRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/courses/${createRes.json().id as string}`,
      cookies: { "auth-token": teacherToken },
    });
    expect(deleteRes.statusCode).toBe(403);
  });

  it("POST /api/courses rejects duplicate code within org with a machine reason (C1-B)", async () => {
    const dupCode = `DUP-${uniquePrefix()}`;
    await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: { name: "Dup Course", code: dupCode, description: "" },
      cookies: { "auth-token": ctx.adminToken },
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: { name: "Dup Course 2", code: dupCode, description: "" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("RESOURCE_CONFLICT");
    expect(body.error.details?.reason).toBe("COURSE_CODE_EXISTS");
    expect(body.error.details?.params).toEqual({ courseCode: dupCode });
  });

  it("PATCH /api/courses/:id renaming onto an existing code carries the stable reason from the DB unique path (C1-R1)", async () => {
    const codeA = `RC-A-${uniquePrefix()}`;
    const codeB = `RC-B-${uniquePrefix()}`;
    for (const [name, code] of [
      ["Race Course A", codeA],
      ["Race Course B", codeB],
    ] as const) {
      const createRes = await ctx.app.inject({
        method: "POST",
        url: "/api/courses",
        payload: { name, code, description: "" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(createRes.statusCode).toBe(201);
    }
    const courseB = (await ctx.db.query.courses.findFirst({
      where: (c, { eq }) => eq(c.code, codeB),
    }))!;

    // PATCH has no create-style pre-check: the courses_org_code_unique
    // index is the only authority for this failure.
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/courses/${courseB.id}`,
      payload: { code: codeA },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("RESOURCE_CONFLICT");
    expect(body.error.details?.reason).toBe("COURSE_CODE_EXISTS");
    expect(body.error.details?.params).toEqual({ courseCode: codeA });
  });

  it("DELETE /api/courses/:id rejects a course that still has questions with a machine reason (C1-B)", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Course With Questions",
        code: `Q-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const courseId = createRes.json().id as string;

    await ctx.db.insert(schema.questions).values({
      id: crypto.randomUUID(),
      organizationId: ctx.org.id,
      courseId,
      type: "single_choice",
      content: "Choose A",
      options: [{ id: "a", content: "A" }],
      standardAnswer: "a",
      attachments: [],
      score: 10,
      difficulty: 1,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/courses/${courseId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("RESOURCE_CONFLICT");
    expect(body.error.details?.reason).toBe("COURSE_HAS_QUESTIONS");
    expect(body.error.details?.params?.questionCount).toBe(1);
  });
});
