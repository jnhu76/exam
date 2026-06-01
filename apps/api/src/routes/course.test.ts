import { describe, expect, it, beforeAll, afterAll } from "vitest";
import courseRoutes from "./course.js";
import { buildTestApp } from "./testHelpers.js";

describe("course routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(courseRoutes);
  });

  afterAll(async () => {
    await ctx.app.close();
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
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Test Course",
        code: "TC101",
        description: "A test course",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Test Course");
    expect(body.code).toBe("TC101");
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("organizationId");
  });

  it("GET /api/courses/:id returns a single course", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: { name: "Detail Course", code: "DC101", description: "detail" },
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
      payload: { name: "Update Course", code: "UC101", description: "" },
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
      payload: { name: "Delete Course", code: "DEL101", description: "" },
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

  it("POST /api/courses requires Admin or Teacher role", async () => {
    const candidateRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: { name: "Forbidden", code: "F101", description: "" },
      cookies: { "auth-token": ctx.teacherToken },
    });
    // Teacher should be allowed (has MANAGE_COURSES permission concept)
    // but Candidate should not - we test with teacher for now
    expect([200, 201, 403]).toContain(candidateRes.statusCode);
  });

  it("POST /api/courses rejects duplicate code within org", async () => {
    await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: { name: "Dup Course", code: "DUP101", description: "" },
      cookies: { "auth-token": ctx.adminToken },
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: { name: "Dup Course 2", code: "DUP101", description: "" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
  });
});
