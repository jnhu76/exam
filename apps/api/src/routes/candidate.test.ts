import { describe, expect, it, beforeAll, afterAll } from "vitest";
import candidateRoutes from "./candidate.js";
import { buildTestApp } from "./testHelpers.js";

describe("candidate routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(candidateRoutes);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("GET /api/candidates returns paginated list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidates",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page", 1);
    expect(body).toHaveProperty("pageSize");
    expect(body.items).toBeInstanceOf(Array);
  });

  it("POST /api/candidates creates a candidate with user", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `candidate-${Date.now()}`,
        password: "password123",
        name: "Test Candidate",
        fields: { employeeId: "E001" },
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.fields).toEqual({ employeeId: "E001" });
    expect(body).toHaveProperty("userId");
  });

  it("POST /api/candidates/import bulk imports candidates", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {
        rows: [
          {
            username: `import1-${Date.now()}`,
            password: "password123",
            name: "Import One",
            fields: { employeeId: "I001" },
          },
          {
            username: `import2-${Date.now()}`,
            password: "password123",
            name: "Import Two",
            fields: { employeeId: "I002" },
          },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(2);
    expect(body.total).toBe(2);
  });

  it("POST /api/candidates/import re-imports by username as update", async () => {
    const username = `dup-${Date.now()}`;
    const res1 = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {
        rows: [
          {
            username,
            password: "password123",
            name: "Dup User",
            fields: { employeeId: "D001" },
          },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().created).toBe(1);

    const res2 = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {
        rows: [
          {
            username,
            password: "password123",
            name: "Dup User Updated",
            fields: { employeeId: "D001" },
          },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res2.statusCode).toBe(200);
    const body = res2.json();
    expect(body.created).toBe(0);
    expect(body.updated).toBe(1);
    expect(body.errors).toHaveLength(0);
  });

  it("POST /api/candidates/import rejects missing username or name", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {
        rows: [
          { username: "", password: "123456", name: "No User", fields: {} },
          { username: "no-name", password: "123456", name: "", fields: {} },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.errors).toHaveLength(2);
    expect(body.errors[0].row).toBe(1);
    expect(body.errors[1].row).toBe(2);
  });

  it("POST /api/candidates requires Admin role", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: "forbidden",
        password: "password123",
        name: "Forbidden",
        fields: {},
      },
      cookies: { "auth-token": ctx.teacherToken },
    });
    expect(res.statusCode).toBe(403);
  });
});
