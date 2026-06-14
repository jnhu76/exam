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
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("New User");
    expect(body.role).toBe("Admin");
    expect(body).not.toHaveProperty("passwordHash");
  });

  it("POST /api/users returns validation details", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: "x",
        password: "short",
        name: "",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: {
          fields: expect.arrayContaining([
            expect.objectContaining({ field: "username", code: "TOO_SMALL" }),
            expect.objectContaining({ field: "password", code: "TOO_SMALL" }),
            expect.objectContaining({ field: "name", code: "TOO_SMALL" }),
          ]),
        },
        requestId: expect.any(String),
      },
    });
  });

  it("POST /api/users returns a stable conflict for duplicate usernames", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: ctx.admin.username,
        password: "password123",
        name: "Duplicate User",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: {
        code: "USER_ALREADY_EXISTS",
        requestId: expect.any(String),
      },
    });
  });

  it("PATCH /api/users/:id updates a user", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `updateuser-${Date.now()}`,
        password: "password123",
        name: "Update Me",
        role: "Admin",
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
        role: "Admin",
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
    expect(res.body).toBe("");
  });

  it("PATCH /api/users/:id returns ErrorResponse v0 when missing", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${crypto.randomUUID()}`,
      payload: { name: "Missing User" },
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: {
        code: "RESOURCE_NOT_FOUND",
        requestId: expect.any(String),
      },
    });
  });

  it("POST /api/users requires Admin role", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: "forbidden",
        password: "password123",
        name: "Forbidden",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: {
        code: "PERMISSION_DENIED",
        requestId: expect.any(String),
      },
    });
  });
});
