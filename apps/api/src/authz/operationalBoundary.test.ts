import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import {
  buildTestApp,
  createAssignedUserForTest,
} from "../routes/testHelpers.js";
import { registerApiRoutes } from "../routes/registerApiRoutes.js";
import type { TestContext } from "../routes/testHelpers.js";

/**
 * P7-E2A — Operational RBAC Boundary product tests (ADR-017 D1/D2/D7/D8/D14).
 *
 * Proves at the HTTP surface:
 *   - Maintainer can login and read operational health/diagnostics;
 *   - Maintainer holds ZERO business authority (users/candidates/courses/
 *     questions/exams/grading/scores/settings/incidents/proctor-assignments/
 *     recovery all denied);
 *   - Maintainer cannot perform business mutations (force-submit, time grant,
 *     misconduct, result publish);
 *   - Maintainer never receives business-integrity diagnostics (D8);
 *   - POST /email/test no longer rides the diagnostics view capability (D7);
 *   - Admin behavior unchanged (compatibility);
 *   - Admin + Maintainer on the same actor is rejected server-side (D14).
 */
describe("P7-E2A Operational RBAC Boundary", () => {
  let ctx: TestContext;
  let cleanup: () => Promise<void>;
  let maintainerToken: string;
  let maintainerUsername: string;

  const apiRoutes: FastifyPluginAsync = async (fastify) => {
    await registerApiRoutes(fastify);
  };

  beforeAll(async () => {
    // registerApiRoutes applies the /api prefix itself — pass an empty prefix
    // so buildTestApp does not double-prefix to /api/api.
    const built = await buildTestApp(apiRoutes as FastifyPluginAsync, {
      prefix: "",
    });
    ctx = built;
    cleanup = built.cleanup;
    const maintainer = await createAssignedUserForTest(
      built.db,
      built.org.id,
      "Maintainer",
      "maintainer",
    );
    maintainerToken = maintainer.token;
    maintainerUsername = maintainer.user.username;
  });

  afterAll(async () => {
    await cleanup();
  });

  async function asMaintainer(method: string, url: string, payload?: unknown) {
    return ctx.app.inject({
      method,
      url,
      payload,
      cookies: { "auth-token": maintainerToken },
    });
  }

  async function asAdmin(method: string, url: string, payload?: unknown) {
    return ctx.app.inject({
      method,
      url,
      payload,
      cookies: { "auth-token": ctx.adminToken },
    });
  }

  describe("Maintainer login + operational read", () => {
    it("Maintainer can login and /auth/me reports the role", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: maintainerUsername,
          password: "password123",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.role).toBe("Maintainer");
      expect(body.capabilities).toContain("system.health.view");
      expect(body.capabilities).toContain("system.diagnostics.view");
      expect(body.capabilities).not.toContain("user.view");
      expect(body.capabilities).not.toContain("system.email.test");
    });

    it("Maintainer can read operational health", async () => {
      const res = await asMaintainer("GET", "/api/system/health");
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.dbResponseMs).toBe("number");
    });

    it("Maintainer can read operational diagnostics", async () => {
      const res = await asMaintainer("GET", "/api/system/diagnostics");
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.dbLatency).toBe("number");
      expect(body.redisStatus).toBeDefined();
      expect(body.emailStatus).toBeDefined();
    });

    it("Maintainer NEVER receives business-integrity diagnostics (D8)", async () => {
      const res = await asMaintainer("GET", "/api/system/diagnostics");
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).not.toHaveProperty("integrity");
    });

    it("Admin still receives business-integrity diagnostics (no regression)", async () => {
      const res = await asAdmin("GET", "/api/system/diagnostics");
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.integrity).toBeDefined();
      expect(typeof body.integrity.submittedNotTerminalized).toBe("number");
    });
  });

  describe("Maintainer business denial", () => {
    it.each([
      ["GET", "/api/users"],
      ["GET", "/api/candidates"],
      ["GET", "/api/courses"],
      ["GET", "/api/questions"],
      ["GET", "/api/exams"],
      ["GET", "/api/admin/grading-queue"],
      ["GET", "/api/exams/00000000-0000-4000-8000-000000000001/scores"],
      ["GET", "/api/admin/settings"],
      ["GET", "/api/admin/settings/branding"],
      ["GET", "/api/admin/audit-logs"],
      ["GET", "/api/admin/import-logs"],
      ["GET", "/api/candidate-fields"],
      ["GET", "/api/admin/recovery/incidents"],
      ["GET", "/api/roles/assignable"],
      ["GET", "/api/exam-profiles"],
    ] as const)("%s %s → 403", async (method, url) => {
      const res = await asMaintainer(method, url);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    });

    it.each([
      [
        "POST",
        "/api/users",
        {
          username: "denied",
          password: "password123",
          name: "Denied",
          role: "Admin",
        },
      ],
      [
        "POST",
        "/api/candidates",
        {
          username: "denied",
          password: "password123",
          name: "Denied",
          fields: {},
        },
      ],
      ["POST", "/api/courses", { name: "Denied", code: "D1" }],
      [
        "POST",
        "/api/questions",
        {
          courseId: "00000000-0000-4000-8000-000000000001",
          type: "single_choice",
          content: "q",
          options: [
            { id: "a", content: "1" },
            { id: "b", content: "2", isCorrect: true },
          ],
          standardAnswer: "b",
          score: 1,
        },
      ],
      [
        "POST",
        "/api/exams",
        {
          title: "Denied",
          courseId: "00000000-0000-4000-8000-000000000001",
          durationMinutes: 60,
          openAt: "2026-08-01T00:00:00.000Z",
          closeAt: "2026-08-02T00:00:00.000Z",
          passingScore: 0,
          totalScore: 100,
        },
      ],
      [
        "POST",
        "/api/exam-profiles",
        {
          name: "Denied",
          description: "",
          durationMinutes: 60,
          retakePolicy: "unlimited",
          maxAttempts: 1,
          scoreStrategy: "highest",
          resultPublicationMode: "immediate",
          interruptionTimePolicy: "strict",
        },
      ],
      [
        "POST",
        "/api/admin/exams/00000000-0000-4000-8000-000000000001/proctors",
        {
          operationId: "00000000-0000-4000-8000-000000000002",
          proctorUserId: "some-user",
        },
      ],
    ] as const)("%s %s → 403", async (method, url, payload) => {
      const res = await asMaintainer(method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    });

    it("Maintainer cannot grade (grading-details denied)", async () => {
      const res = await asMaintainer(
        "GET",
        "/api/admin/attempts/00000000-0000-4000-8000-000000000001/grading-details",
      );
      expect(res.statusCode).toBe(403);
    });

    it("Maintainer cannot publish results", async () => {
      const res = await asMaintainer(
        "POST",
        "/api/exams/00000000-0000-4000-8000-000000000001/publish-results",
      );
      expect(res.statusCode).toBe(403);
    });

    it("Maintainer cannot force-submit / time-grant / mark misconduct", async () => {
      const attemptId = "00000000-0000-4000-8000-000000000001";
      const res1 = await asMaintainer(
        "POST",
        `/api/admin/attempts/${attemptId}/force-submit`,
        { operationId: randomUUID(), reason: "test" },
      );
      expect(res1.statusCode).toBe(403);
      const res2 = await asMaintainer(
        "POST",
        `/api/admin/attempts/${attemptId}/time-grants`,
        {
          operationId: randomUUID(),
          addedSeconds: 60,
          reasonCode: "test",
          reasonText: "test",
        },
      );
      expect(res2.statusCode).toBe(403);
      const res3 = await asMaintainer(
        "POST",
        `/api/admin/attempts/${attemptId}/misconduct`,
        { operationId: randomUUID(), severity: "warning", notes: "test" },
      );
      expect(res3.statusCode).toBe(403);
    });

    it("Maintainer cannot resolve incidents (business mutation)", async () => {
      const res = await asMaintainer(
        "POST",
        "/api/admin/incidents/00000000-0000-4000-8000-000000000001/resolve",
        {
          operationId: randomUUID(),
          expectedVersion: 1,
          resolutionSummary: "test",
        },
      );
      expect(res.statusCode).toBe(403);
    });

    it("Maintainer cannot manage users (create rejected)", async () => {
      const res = await asMaintainer("POST", "/api/users", {
        username: "hacker",
        password: "password123",
        name: "Hacker",
        role: "Admin",
      });
      expect(res.statusCode).toBe(403);
    });

    it("Maintainer cannot modify organization settings", async () => {
      const res = await asMaintainer("PATCH", "/api/admin/settings/branding", {
        name: "Hacked",
      });
      expect(res.statusCode).toBe(403);
    });

    it("Maintainer cannot list role assignments (user management)", async () => {
      const res = await asMaintainer(
        "GET",
        `/api/users/${ctx.admin.id}/role-assignments`,
      );
      expect(res.statusCode).toBe(403);
    });
  });

  describe("Email test capability split (D7)", () => {
    it("Maintainer cannot send a test email (no system.email.test)", async () => {
      const res = await asMaintainer("POST", "/api/email/test", {
        to: "someone@example.com",
      });
      expect(res.statusCode).toBe(403);
    });

    it("Admin can still send a test email (compatibility preserved)", async () => {
      const res = await asAdmin("POST", "/api/email/test", {
        to: "someone@example.com",
      });
      // 200 regardless of transport state (disabled/sent/failed) — the gate
      // must pass for Admin.
      expect(res.statusCode).toBe(200);
    });
  });

  describe("Admin ↔ Maintainer mutual exclusion at the HTTP surface (D14)", () => {
    it("rejects adding a Maintainer assignment to the Admin actor", async () => {
      const res = await asAdmin(
        "POST",
        `/api/users/${ctx.admin.id}/role-assignments`,
        {
          role: "Maintainer",
          isPrimary: false,
        },
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toContain(
        "ADMIN_MAINTAINER_EXCLUSION",
      );
    });

    it("rejects adding an Admin assignment to a Maintainer actor", async () => {
      // Create a Maintainer through the approved path first.
      const created = await asAdmin("POST", "/api/users", {
        username: `ops-${Date.now()}`,
        password: "password123",
        name: "Ops Maintainer",
        role: "Maintainer",
      });
      expect(created.statusCode).toBe(201);
      const maintainerUser = created.json();

      const res = await asAdmin(
        "POST",
        `/api/users/${maintainerUser.id}/role-assignments`,
        {
          role: "Admin",
          isPrimary: false,
        },
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toContain(
        "ADMIN_MAINTAINER_EXCLUSION",
      );
    });

    it("Maintainer is provisioned through the approved user path (D2)", async () => {
      const res = await asAdmin("POST", "/api/users", {
        username: `ops2-${Date.now()}`,
        password: "password123",
        name: "Ops Two",
        role: "Maintainer",
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().role).toBe("Maintainer");

      // The user list shows Maintainer accounts (PHASE1_SUPPORTED_ROLES).
      const list = await asAdmin("GET", "/api/users");
      expect(list.statusCode).toBe(200);
      const roles = list.json().items.map((u: { role: string }) => u.role);
      expect(roles).toContain("Maintainer");
    });
  });
});
