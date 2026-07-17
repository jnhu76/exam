import { describe, expect, it, beforeAll, afterAll } from "vitest";
import courseRoutes from "./course.js";
import {
  buildTestApp,
  createFutureRoleUserForTest,
  uniquePrefix,
} from "./testHelpers.js";

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

  it("POST /api/courses rejects duplicate code within org", async () => {
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
  });
});
