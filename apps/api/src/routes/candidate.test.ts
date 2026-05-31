import { describe, expect, it, beforeAll, afterAll } from "vitest";
import candidateRoutes from "./candidate.js";
import { buildTestApp } from "./testHelpers.js";

describe("candidate routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(candidateRoutes);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("GET /api/candidates returns list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidates",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeInstanceOf(Array);
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
