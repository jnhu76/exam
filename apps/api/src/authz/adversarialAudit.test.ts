import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import {
  buildTestApp,
  createAssignedUserForTest,
} from "../routes/testHelpers.js";
import { registerApiRoutes } from "../routes/registerApiRoutes.js";
import type { TestContext } from "../routes/testHelpers.js";

/**
 * P7-E closeout — Security adversarial audit (mission §15).
 *
 * Red-team probes at the HTTP surface:
 *   A. Compromised Admin cannot become Maintainer on the same account, reach
 *      infrastructure execution, or read secrets.
 *   B. Compromised Maintainer cannot touch any business surface.
 *   C. (Assignment race — covered by adminMaintainerExclusion.test.ts.)
 *   D. (Evidence forgery — covered by backupEvidence.test.ts.)
 *   E. Browser operations probe: no restore/PITR/raw-backup-path/shell/
 *      secret/restart/DB-endpoint/Redis-credential surface exists.
 */
describe("P7-E adversarial audit", () => {
  let ctx: TestContext;
  let cleanup: () => Promise<void>;
  let maintainerToken: string;

  const apiRoutes: FastifyPluginAsync = async (fastify) => {
    await registerApiRoutes(fastify);
  };

  beforeAll(async () => {
    const built = await buildTestApp(apiRoutes as FastifyPluginAsync, {
      prefix: "",
    });
    ctx = built;
    cleanup = built.cleanup;
    const m = await createAssignedUserForTest(
      built.db,
      built.org.id,
      "Maintainer",
      "maintainer-adv",
    );
    maintainerToken = m.token;
  });

  afterAll(async () => {
    await cleanup();
  });

  const asMaintainer = (method: string, url: string, payload?: unknown) =>
    ctx.app.inject({
      method,
      url,
      payload,
      cookies: { "auth-token": maintainerToken },
    });

  const asAdmin = (method: string, url: string, payload?: unknown) =>
    ctx.app.inject({
      method,
      url,
      payload,
      cookies: { "auth-token": ctx.adminToken },
    });

  describe("A. Compromised Admin", () => {
    it("cannot self-assign the Maintainer role (mutual exclusion at the surface)", async () => {
      const res = await asAdmin(
        "POST",
        `/api/users/${ctx.admin.id}/role-assignments`,
        { role: "Maintainer", isPrimary: false },
      );
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toContain(
        "ADMIN_MAINTAINER_EXCLUSION",
      );
    });

    it("cannot read DB/Redis/SMTP secrets through any route", async () => {
      // Probe every secret-bearing route shape the audit can imagine; each
      // must be 404 (no surface) — never a secret echo.
      for (const url of [
        "/api/system/secrets",
        "/api/system/env",
        "/api/system/config/raw",
        "/api/admin/settings/secrets",
        "/api/settings/credentials",
        "/api/system/redis-credentials",
        "/api/system/database-url",
      ]) {
        for (const method of ["GET", "POST"] as const) {
          const res = await asAdmin(method, url);
          expect(res.statusCode, `${method} ${url}`).toBe(404);
        }
      }
    });

    it("cannot reach restore / PITR / destructive recovery / restart surfaces", async () => {
      for (const url of [
        "/api/system/restore",
        "/api/system/pitr",
        "/api/system/backups/restore",
        "/api/system/pgdata",
        "/api/system/restart",
        "/api/system/services/restart",
        "/api/system/backups/trigger",
        "/api/system/backups/schedule",
        "/api/system/backups/retention",
      ]) {
        for (const method of [
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
        ] as const) {
          const res = await asAdmin(method, url);
          expect(res.statusCode, `${method} ${url}`).toBe(404);
        }
      }
    });
  });

  describe("B. Compromised Maintainer", () => {
    it("cannot author/modify/publish exams", async () => {
      const examId = "00000000-0000-4000-8000-000000000001";
      for (const [method, url, body] of [
        [
          "POST",
          "/api/exams",
          {
            title: "x",
            courseId: examId,
            durationMinutes: 60,
            openAt: "2026-08-01T00:00:00.000Z",
            closeAt: "2026-08-02T00:00:00.000Z",
            passingScore: 0,
            totalScore: 100,
          },
        ],
        ["PATCH", `/api/exams/${examId}`, { title: "hacked" }],
        ["POST", `/api/exams/${examId}/publish`, {}],
        ["POST", `/api/exams/${examId}/publish-results`, {}],
        ["DELETE", `/api/exams/${examId}`, undefined],
      ] as const) {
        const res = await asMaintainer(method, url, body);
        expect(res.statusCode, `${method} ${url}`).toBe(403);
      }
    });

    it("cannot view candidate answers or export attempts", async () => {
      const attemptId = "00000000-0000-4000-8000-000000000001";
      for (const url of [
        `/api/admin/attempts/${attemptId}/export`,
        `/api/admin/attempts/${attemptId}/export/csv`,
        `/api/admin/attempts/${attemptId}/grading-details`,
      ]) {
        const res = await asMaintainer("GET", url);
        expect(res.statusCode, `GET ${url}`).toBe(403);
      }
    });

    it("cannot grade / assign roles / manage candidates / resolve incidents", async () => {
      const attemptId = "00000000-0000-4000-8000-000000000001";
      const userId = "00000000-0000-4000-8000-000000000002";
      const res1 = await asMaintainer(
        "POST",
        `/api/admin/attempts/${attemptId}/grade-question`,
        { questionId: "q1", score: 1 },
      );
      expect(res1.statusCode).toBe(403);
      const res2 = await asMaintainer(
        "POST",
        `/api/users/${userId}/role-assignments`,
        { role: "Teacher", isPrimary: false },
      );
      expect(res2.statusCode).toBe(403);
      const res3 = await asMaintainer("POST", "/api/candidates", {
        username: "cand-x",
        password: "password123",
        name: "Candidate X",
        fields: {},
      });
      expect(res3.statusCode).toBe(403);
      const res4 = await asMaintainer(
        "POST",
        "/api/admin/incidents/00000000-0000-4000-8000-000000000001/resolve",
        {
          operationId: "00000000-0000-4000-8000-000000000003",
          expectedVersion: 1,
          resolutionSummary: "x",
        },
      );
      expect(res4.statusCode).toBe(403);
    });

    it("cannot modify the Admin's policy intent (403) and sees no integrity data", async () => {
      const put = await asMaintainer("PUT", "/api/system/ops-policy", {
        desiredRpoSeconds: 3600,
        desiredRetentionDays: 30,
        desiredDrillCadenceDays: 7,
        version: 0,
        reason: "maintainer override",
      });
      expect(put.statusCode).toBe(403);

      const diag = await asMaintainer("GET", "/api/system/diagnostics");
      expect(diag.json()).not.toHaveProperty("integrity");
    });
  });

  describe("E. Browser operations probe", () => {
    it("no raw shell / raw backup path / DB endpoint / Redis credential surface exists", async () => {
      for (const url of [
        "/api/system/shell",
        "/api/system/exec",
        "/api/system/backups/paths",
        "/api/system/backups/destination",
        "/api/system/db-endpoint",
        "/api/system/redis-credentials",
      ]) {
        const res = await asAdmin("POST", url);
        expect(res.statusCode, `POST ${url}`).toBe(404);
      }
    });

    it("all operational responses are free of secrets and host paths", async () => {
      const urls = [
        "/api/system/health",
        "/api/system/diagnostics",
        "/api/system/backups",
        "/api/system/restore-readiness",
        "/api/system/ops-policy",
      ];
      for (const url of urls) {
        const res = await asAdmin("GET", url);
        expect(res.statusCode, `GET ${url}`).toBe(200);
        const text = JSON.stringify(res.json());
        expect(text).not.toMatch(
          /postgresql:\/\/|PGPASSWORD|SMTP_PASSWORD|JWT_SECRET|REDIS_PASSWORD|\/var\/lib|\/mnt\//i,
        );
      }
    });
  });
});
