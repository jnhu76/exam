import { describe, expect, it, beforeAll, afterAll } from "vitest";
import userRoutes from "./user.js";
import { buildTestApp } from "./testHelpers.js";

describe("user routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(userRoutes);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("GET /api/users returns paginated list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/users",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page", 1);
    expect(body.items).toBeInstanceOf(Array);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/users creates a user", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `newuser-${Date.now()}`,
        password: "password123",
        name: "New User",
        role: "Teacher",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("New User");
    expect(body.role).toBe("Teacher");
    expect(body).not.toHaveProperty("passwordHash");
  });

  it("PATCH /api/users/:id updates a user", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `updateuser-${Date.now()}`,
        password: "password123",
        name: "Update Me",
        role: "Teacher",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${created.id}`,
      payload: { name: "Updated Name" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Updated Name");
  });

  it("DELETE /api/users/:id deletes a user", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `deleteuser-${Date.now()}`,
        password: "password123",
        name: "Delete Me",
        role: "Proctor",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/users/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(204);
  });

  it("POST /api/users requires Admin role", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: "forbidden",
        password: "password123",
        name: "Forbidden",
        role: "Teacher",
      },
      cookies: { "auth-token": ctx.teacherToken },
    });
    expect(res.statusCode).toBe(403);
  });
});
