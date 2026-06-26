import { describe, expect, it, beforeAll, afterAll } from "vitest";
import importLogRoutes from "./importLogs.js";
import candidateRoutes from "./candidate.js";
import { buildTestApp } from "./testHelpers.js";

describe("import-logs routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let adminToken: string;
  let candidateLogId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(candidateRoutes);
      await fastify.register(importLogRoutes);
    });
    adminToken = ctx.adminToken;

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {
        rows: [
          {
            username: `implog-${Date.now()}`,
            password: "password123",
            name: "Import Log",
            fields: {},
          },
        ],
      },
      cookies: { "auth-token": adminToken },
    });
    candidateLogId = res.json().logId;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("GET /api/admin/import-logs returns paginated list including persisted logs", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/import-logs?page=1&pageSize=20",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toBeInstanceOf(Array);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
    expect(body.totalPages).toBeGreaterThanOrEqual(1);
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(candidateLogId);
  });

  it("GET /api/admin/import-logs filters by type=candidate", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/import-logs?page=1&pageSize=20&type=candidate",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(
      body.items.every((i: { type: string }) => i.type === "candidate"),
    ).toBe(true);
    expect(
      body.items.some((i: { id: string }) => i.id === candidateLogId),
    ).toBe(true);
  });

  it("GET /api/admin/import-logs item carries status, counts, and errorsDetail", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/import-logs?page=1&pageSize=20&type=candidate",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const item = res
      .json()
      .items.find((i: { id: string }) => i.id === candidateLogId);
    expect(item).toBeDefined();
    expect(["completed", "partial", "failed"]).toContain(item.status);
    expect(item.total).toBe(1);
    expect(item.createdCount + item.updatedCount + item.errors).toBe(
      item.total,
    );
    expect(item.metadata).toBeInstanceOf(Object);
  });

  it("GET /api/admin/import-logs requires Admin role", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/import-logs?page=1",
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /api/admin/import-logs returns 401 without authentication", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/import-logs?page=1",
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/admin/import-logs returns stable empty structure for non-matching type filter", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/import-logs?page=1&pageSize=20&type=question",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toBeInstanceOf(Array);
    expect(typeof body.total).toBe("number");
    expect(typeof body.page).toBe("number");
    expect(typeof body.pageSize).toBe("number");
    expect(typeof body.totalPages).toBe("number");
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
  });

  it("GET /api/admin/import-logs returns empty items for page beyond total", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/import-logs?page=9999&pageSize=10",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toBeInstanceOf(Array);
    expect(body.items.length).toBe(0);
    expect(body.page).toBe(9999);
  });

  it("GET /api/admin/import-logs does not leak sensitive fields", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/import-logs?page=1&pageSize=20",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const bodyText = res.body;
    expect(bodyText).not.toContain("passwordHash");
    expect(bodyText).not.toContain("password");
    expect(bodyText).not.toContain("JWT_SECRET");
    expect(bodyText).not.toContain("DATABASE_URL");
  });

  it("GET /api/admin/import-logs each item has required fields and no extra sensitive data", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/import-logs?page=1&pageSize=20",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    if (body.items.length > 0) {
      const item = body.items[0];
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("type");
      expect(item).toHaveProperty("status");
      expect(item).toHaveProperty("total");
      expect(item).toHaveProperty("createdCount");
      expect(item).toHaveProperty("updatedCount");
      expect(item).toHaveProperty("errors");
      expect(item).toHaveProperty("metadata");
      expect(item).toHaveProperty("createdAt");
      expect(item).not.toHaveProperty("rawRows");
      expect(item).not.toHaveProperty("passwordHash");
    }
  });

  it("GET /api/admin/import-logs pagination: pageSize=1 returns at most 1 item", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/import-logs?page=1&pageSize=1",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeLessThanOrEqual(1);
    expect(body.pageSize).toBe(1);
    expect(body.totalPages).toBeGreaterThanOrEqual(body.total);
  });
});
