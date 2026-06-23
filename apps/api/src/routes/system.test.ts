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
    await ctx.cleanup();
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

    it("returns non-negative counts", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/dashboard",
        cookies: { "auth-token": ctx.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalQuestions).toBeGreaterThanOrEqual(0);
      expect(body.activeExams).toBeGreaterThanOrEqual(0);
      expect(body.totalCandidates).toBeGreaterThanOrEqual(0);
      expect(body.todayExams).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(body.recentExams)).toBe(true);
    });

    it("returns 401 without authentication", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/health",
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /system/public-config", () => {
    it("returns deployment mode and features without authentication", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/public-config",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("deploymentMode");
      expect(body.deploymentMode).toBe("singleTenant");
      expect(body).toHaveProperty("features");
      expect(body.features).toHaveProperty("apiReference");
      expect(body).toHaveProperty("apiReference");
      expect(body.apiReference).toHaveProperty("uiPath");
      expect(body.apiReference).toHaveProperty("specPath");
    });

    it("does not expose SuperAdmin / tenant switcher / multiTenant fields", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/public-config",
      });

      expect(res.statusCode).toBe(200);
      const bodyText = res.body;
      expect(bodyText).not.toContain("exposeSuperAdmin");
      expect(bodyText).not.toContain("tenantSwitcher");
      expect(bodyText).not.toContain("superAdminConsole");
      expect(bodyText).not.toContain("multiTenant");
    });

    it("does not expose secrets in the response body", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/public-config",
      });

      expect(res.statusCode).toBe(200);
      const bodyText = res.body;
      expect(bodyText).not.toContain("JWT_SECRET");
      expect(bodyText).not.toContain("DATABASE_URL");
      expect(bodyText).not.toContain("password");
    });
  });

  describe("GET /system/diagnostics", () => {
    it("returns 401 without authentication", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
      });

      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for candidate role", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(403);
    });

    it("returns diagnostics with correct shape for admin", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body).toHaveProperty("version");
      expect(body).toHaveProperty("uptime");
      expect(body).toHaveProperty("dbLatency");
      expect(typeof body.version).toBe("string");
      expect(typeof body.uptime).toBe("number");
      expect(typeof body.dbLatency).toBe("number");
      expect(body.dbLatency).toBeGreaterThanOrEqual(0);

      expect(body).toHaveProperty("heartbeatStatus");
      expect(body.heartbeatStatus).toHaveProperty("interval");
      expect(body.heartbeatStatus).toHaveProperty("timeout");
      expect(body.heartbeatStatus).toHaveProperty("lastScanAt");
      expect(body.heartbeatStatus).toHaveProperty("disruptedCount");
      expect(typeof body.heartbeatStatus.interval).toBe("number");
      expect(typeof body.heartbeatStatus.timeout).toBe("number");
      expect(typeof body.heartbeatStatus.disruptedCount).toBe("number");
      expect(body.heartbeatStatus.disruptedCount).toBeGreaterThanOrEqual(0);

      expect(body).toHaveProperty("deadlineScannerStatus");
      expect(body.deadlineScannerStatus).toHaveProperty("interval");
      expect(body.deadlineScannerStatus).toHaveProperty("lastScanAt");
      expect(body.deadlineScannerStatus).toHaveProperty("autoSubmitCount");
      expect(typeof body.deadlineScannerStatus.interval).toBe("number");
      expect(typeof body.deadlineScannerStatus.autoSubmitCount).toBe("number");
      expect(body.deadlineScannerStatus.autoSubmitCount).toBeGreaterThanOrEqual(
        0,
      );

      expect(body).toHaveProperty("config");
      expect(body.config).toHaveProperty("heartbeatInterval");
      expect(body.config).toHaveProperty("heartbeatTimeout");
      expect(body.config).toHaveProperty("deadlineScanInterval");
      expect(typeof body.config.heartbeatInterval).toBe("number");
      expect(typeof body.config.heartbeatTimeout).toBe("number");
      expect(typeof body.config.deadlineScanInterval).toBe("number");
    });

    it("does not expose secrets in diagnostics response", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const bodyText = res.body;
      expect(bodyText).not.toContain("JWT_SECRET");
      expect(bodyText).not.toContain("DATABASE_URL");
      expect(bodyText).not.toContain("password");
    });
  });
});
