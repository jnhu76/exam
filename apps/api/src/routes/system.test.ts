import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestContext } from "./testHelpers.js";
import { buildTestApp } from "./testHelpers.js";
import systemRoutes from "./system.js";

describe("system routes", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp(systemRoutes);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe("GET /system/health", () => {
    it("returns health metrics with correct shape", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/health",
        cookies: { "auth-token": ctx.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("cpu");
      expect(body).toHaveProperty("memory");
      expect(body).toHaveProperty("dbResponseMs");
      expect(body).toHaveProperty("status");
      expect(typeof body.cpu).toBe("number");
      expect(typeof body.memory).toBe("number");
      expect(typeof body.dbResponseMs).toBe("number");
      expect(["ok", "degraded", "critical"]).toContain(body.status);
    });

    it("returns cpu between 0 and 100", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/health",
        cookies: { "auth-token": ctx.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.cpu).toBeGreaterThanOrEqual(0);
      expect(body.cpu).toBeLessThanOrEqual(100);
    });

    it("returns memory between 0 and 100", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/health",
        cookies: { "auth-token": ctx.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.memory).toBeGreaterThanOrEqual(0);
      expect(body.memory).toBeLessThanOrEqual(100);
    });

    it("returns dbResponseMs as non-negative number", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/health",
        cookies: { "auth-token": ctx.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.dbResponseMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("GET /system/dashboard", () => {
    it("returns dashboard stats with correct shape", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/dashboard",
        cookies: { "auth-token": ctx.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("totalQuestions");
      expect(body).toHaveProperty("activeExams");
      expect(body).toHaveProperty("totalCandidates");
      expect(body).toHaveProperty("todayExams");
      expect(body).toHaveProperty("recentExams");
      expect(typeof body.totalQuestions).toBe("number");
      expect(typeof body.activeExams).toBe("number");
      expect(typeof body.totalCandidates).toBe("number");
      expect(typeof body.todayExams).toBe("number");
      expect(Array.isArray(body.recentExams)).toBe(true);
    });

    it("returns zero counts for empty database", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/dashboard",
        cookies: { "auth-token": ctx.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalQuestions).toBe(0);
      expect(body.activeExams).toBe(0);
      expect(body.totalCandidates).toBe(0);
      expect(body.todayExams).toBe(0);
      expect(body.recentExams).toHaveLength(0);
    });

    it("returns 401 without authentication", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/health",
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
