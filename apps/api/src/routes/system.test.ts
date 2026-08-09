import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { QuestionSnapshot } from "@exam/domain";
import type { TestContext } from "./testHelpers.js";
import { buildTestApp } from "./testHelpers.js";
import systemRoutes from "./system.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import {
  emailOutbox,
  workerHeartbeats,
  schema,
} from "@exam/db/src/schema/pg.js";
import { eq } from "drizzle-orm";
import { BOOTSTRAP_PENDING_MESSAGE } from "../workers/emailDeliveryWorker.js";

async function cleanupWorkerHeartbeats(db: TestContext["db"]) {
  await db
    .delete(workerHeartbeats)
    .where(eq(workerHeartbeats.workerName, "email-delivery"));
}

function restoreEmailEnabled(prevEnabled: string | undefined) {
  if (prevEnabled === undefined) {
    delete process.env.EMAIL_ENABLED;
  } else {
    process.env.EMAIL_ENABLED = prevEnabled;
  }
  resetRuntimeConfigForTest();
}

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

      /* P3-M7: explicit assertion that diagnostics degrades cleanly when Redis is absent. The test app does not register the redis plugin (fastify.redis === undefined), so the route's `if (fastify.redis)` branch is false → connected:false, latencyMs:null. Guardrail: diagnostics never breaks when Redis is down. */
      expect(body).toHaveProperty("redisStatus");
      expect(body.redisStatus.connected).toBe(false);
      expect(body.redisStatus.latencyMs).toBeNull();

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
      // Email surface must not leak SMTP creds or recipient addresses.
      expect(bodyText).not.toContain("SMTP_");
      expect(bodyText).not.toContain("recipientEmail");
      expect(bodyText).not.toContain("bodyText");
      expect(bodyText).not.toContain("bodyHtml");
    });

    it("reports redisStatus connected:false when redis ping throws", async () => {
      // Inject a fake redis client whose ping() rejects, then restore. The
      // test app does not register the redis plugin, so we decorate first.
      const fakeThrowingRedis = {
        ping: async () => Promise.reject(new Error("ECONNREFUSED")),
      };
      ctx.app.redis = fakeThrowingRedis as never;
      try {
        const res = await ctx.app.inject({
          method: "GET",
          url: "/api/system/diagnostics",
          cookies: { "auth-token": ctx.adminToken },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.redisStatus.connected).toBe(false);
        expect(body.redisStatus.latencyMs).toBeNull();
      } finally {
        ctx.app.redis = null;
      }
    });

    // ── M5: email diagnostics surface ──────────────────────────────
    // The test runtime has EMAIL_ENABLED=false (fake/disabled), so the
    // diagnostics emailStatus must report "disabled" with zeroed counts.
    it("includes emailStatus reporting disabled when email is disabled", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body).toHaveProperty("emailStatus");
      expect(body.emailStatus).toHaveProperty("status", "disabled");
      expect(body.emailStatus).toHaveProperty("enabled", false);
      expect(body.emailStatus).toHaveProperty("worker");
      expect(body.emailStatus.worker).toHaveProperty("status", "disabled");
      expect(body.emailStatus).toHaveProperty("outbox");
      expect(body.emailStatus.outbox).toEqual({
        pending: 0,
        processing: 0,
        retryWait: 0,
        sent: 0,
        dead: 0,
      });
    });

    it("reports outbox counts and degraded status when email enabled + failed rows exist", async () => {
      // Flip email ON for this test and rebuild config. The test-mode guard
      // forces transport=fake, but `enabled` stays true — enough to exercise
      // the route's enabled branch (it queries outbox counts regardless of
      // transport).
      const prevEnabled = process.env.EMAIL_ENABLED;
      process.env.EMAIL_ENABLED = "true";
      resetRuntimeConfigForTest();

      // Seed a dead row + a sent row into the test org's outbox. We use
      // raw insert (not the repo) so we can set terminal statuses directly.
      const orgId = ctx.org.id;
      const seeded: (typeof emailOutbox.$inferInsert)[] = [
        {
          id: randomUUID(),
          organizationId: orgId,
          type: "test_email",
          recipientEmail: "a@x.com",
          subject: "s",
          bodyText: "t",
          status: "dead",
          attemptCount: 3,
          maxAttempts: 3,
          lastError: "boom",
        },
        {
          id: randomUUID(),
          organizationId: orgId,
          type: "test_email",
          recipientEmail: "b@x.com",
          subject: "s",
          bodyText: "t",
          status: "sent",
          attemptCount: 1,
          maxAttempts: 3,
          sentAt: new Date(),
        },
      ];
      await ctx.db.insert(emailOutbox).values(seeded);

      try {
        const res = await ctx.app.inject({
          method: "GET",
          url: "/api/system/diagnostics",
          cookies: { "auth-token": ctx.adminToken },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.emailStatus.enabled).toBe(true);
        // dead > 0 ⇒ degraded per the status rules.
        expect(body.emailStatus.status).toBe("degraded");
        expect(body.emailStatus.outbox.dead).toBeGreaterThanOrEqual(1);
        expect(body.emailStatus.outbox.sent).toBeGreaterThanOrEqual(1);
      } finally {
        // Cleanup: remove seeded rows + restore env.
        await ctx.db
          .delete(emailOutbox)
          .where(eq(emailOutbox.organizationId, orgId));
        restoreEmailEnabled(prevEnabled);
      }
    });

    it("reports degraded worker status when heartbeat shows bootstrap_pending", async () => {
      const prevEnabled = process.env.EMAIL_ENABLED;
      process.env.EMAIL_ENABLED = "true";
      resetRuntimeConfigForTest();

      try {
        await ctx.db.insert(workerHeartbeats).values({
          id: randomUUID(),
          workerName: "email-delivery",
          workerInstanceId: "bootstrap-pending-test",
          lastPollAt: new Date(),
          lastSuccessAt: null,
          lastErrorAt: null,
          lastError: BOOTSTRAP_PENDING_MESSAGE,
        });

        const res = await ctx.app.inject({
          method: "GET",
          url: "/api/system/diagnostics",
          cookies: { "auth-token": ctx.adminToken },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.emailStatus.enabled).toBe(true);
        expect(body.emailStatus.worker.status).toBe("degraded");
        expect(body.emailStatus.worker.lastError).toContain(
          "bootstrap_pending",
        );
        expect(body.emailStatus.status).toBe("degraded");
      } finally {
        await cleanupWorkerHeartbeats(ctx.db);
        restoreEmailEnabled(prevEnabled);
      }
    });

    it("reports available worker status when heartbeat shows a recent success", async () => {
      const prevEnabled = process.env.EMAIL_ENABLED;
      process.env.EMAIL_ENABLED = "true";
      resetRuntimeConfigForTest();

      try {
        const now = new Date();
        await ctx.db.insert(workerHeartbeats).values({
          id: randomUUID(),
          workerName: "email-delivery",
          workerInstanceId: "available-test",
          lastPollAt: now,
          lastSuccessAt: now,
          lastErrorAt: null,
          lastError: null,
        });

        const res = await ctx.app.inject({
          method: "GET",
          url: "/api/system/diagnostics",
          cookies: { "auth-token": ctx.adminToken },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.emailStatus.enabled).toBe(true);
        expect(body.emailStatus.worker.status).toBe("available");
        expect(body.emailStatus.worker.lastError).toBeNull();
        expect(body.emailStatus.status).toBe("available");
      } finally {
        await cleanupWorkerHeartbeats(ctx.db);
        restoreEmailEnabled(prevEnabled);
      }
    });

    it("restores EMAIL_ENABLED correctly when it was initially absent", () => {
      const original = process.env.EMAIL_ENABLED;
      delete process.env.EMAIL_ENABLED;

      process.env.EMAIL_ENABLED = "true";
      resetRuntimeConfigForTest();
      restoreEmailEnabled(undefined);

      expect(process.env.EMAIL_ENABLED).toBeUndefined();

      if (original !== undefined) {
        process.env.EMAIL_ENABLED = original;
      }
      resetRuntimeConfigForTest();
    });
  });

  // P7-S2 Phase 7 — read-only attempt-integrity anomalies.
  describe("GET /system/diagnostics integrity block", () => {
    const questionSnapshot: QuestionSnapshot[] = [
      {
        originalQuestionId: "q-legacy-1",
        type: "single_choice",
        content: "Q",
        attachments: [],
        options: [],
        standardAnswer: "a",
        score: 10,
        gradingRule: {
          multiSelectScoring: "all_correct_full",
          fillBlankMatchMode: "exact",
        },
        order: 0,
        rubric: null,
      },
    ];

    async function seedLegacyAttempt(
      overrides: {
        status?: string;
        gradingStatus?: "auto_graded" | "pending_manual" | "fully_graded";
        withEntry?: boolean;
        snapshot?: QuestionSnapshot[];
      } = {},
    ): Promise<string> {
      const now = new Date();
      const orgId = ctx.org.id;
      const courseId = randomUUID();
      const examId = randomUUID();
      const candidateProfileId = randomUUID();
      const userId = randomUUID();
      const snapshot = overrides.snapshot ?? questionSnapshot;

      await ctx.db.insert(schema.courses).values({
        id: courseId,
        organizationId: orgId,
        name: "Legacy",
        code: `LG-${randomUUID().slice(0, 6)}`,
        description: "",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert(schema.exams).values({
        id: examId,
        organizationId: orgId,
        title: "Legacy exam",
        description: "",
        courseId,
        status: "closed",
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: now,
        closeAt: new Date(now.getTime() + 86400_000),
        passingScore: 60,
        totalScore: 100,
        questionSelectionMode: "manual",
        questionIds: snapshot.map(
          (q) => (q as { originalQuestionId: string }).originalQuestionId,
        ),
        questionSnapshot: snapshot,
        controlFlags: {
          shuffleQuestions: false,
          shuffleOptions: false,
          detectTabSwitch: false,
          disableCopyPaste: false,
          requireQueue: false,
          batchSize: 10,
          batchInterval: 3,
          restrictIp: false,
          requireLockdown: false,
          showResultImmediately: true,
        },
        retakePolicy: "unlimited",
        scoreStrategy: "highest",
        maxAttempts: 1,
        interruptionTimePolicy: "operator_incident",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert(schema.users).values({
        id: userId,
        organizationId: orgId,
        username: `lg-cand-${randomUUID().slice(0, 6)}`,
        passwordHash: "hash",
        name: "Legacy Candidate",
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert(schema.candidateProfiles).values({
        id: candidateProfileId,
        organizationId: orgId,
        userId,
        fields: {},
        createdAt: now,
        updatedAt: now,
      });
      const enrollmentId = randomUUID();
      await ctx.db.insert(schema.examEnrollments).values({
        id: enrollmentId,
        organizationId: orgId,
        examId,
        candidateId: candidateProfileId,
        status: "completed",
        attemptCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      const attemptId = randomUUID();
      await ctx.db.insert(schema.examAttempts).values({
        id: attemptId,
        organizationId: orgId,
        examId,
        enrollmentId,
        candidateId: candidateProfileId,
        attemptNo: 1,
        status: overrides.status ?? "submitted",
        gradingStatus: overrides.gradingStatus ?? "auto_graded",
        questionSnapshot: snapshot,
        answers: [],
        submittedAnswers: {
          schemaVersion: 1,
          answers: [],
        },
        submittedAt: now,
        gradedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      if (overrides.withEntry) {
        await ctx.db.insert(schema.attemptGradingEntries).values({
          id: randomUUID(),
          organizationId: orgId,
          attemptId,
          questionId: (snapshot[0] as { originalQuestionId: string })
            .originalQuestionId,
          gradingMode: "auto",
          status: "completed_auto",
          maxScore: 10,
          earnedScore: 10,
          candidateAnswer: "a",
          standardAnswer: "a",
          correct: true,
          comment: "",
          gradedBy: null,
          gradedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      return attemptId;
    }

    it("reports zero anomalies on a clean tenant", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.integrity.submittedNotTerminalized).toBe(0);
      expect(body.integrity.submittedWorksetMismatch).toBe(0);
      expect(body.integrity.anomalies).toEqual([]);
    });

    it("detects legacy submitted+auto_graded attempts with identity evidence", async () => {
      const attemptId = await seedLegacyAttempt();

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.integrity.submittedNotTerminalized).toBeGreaterThanOrEqual(1);
      const anomaly = body.integrity.anomalies.find(
        (a: { attemptId: string }) => a.attemptId === attemptId,
      );
      expect(anomaly).toBeDefined();
      expect(anomaly.kind).toBe("submitted_not_terminalized");
      expect(anomaly.submittedAt).toBeTruthy();
      expect(anomaly.snapshotQuestions).toBe(1);
      expect(anomaly.gradingEntries).toBe(0);
    });

    it("detects submitted attempts with a missing workset (count mismatch)", async () => {
      const attemptId = await seedLegacyAttempt({
        gradingStatus: "pending_manual",
        withEntry: false,
      });

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.integrity.submittedWorksetMismatch).toBeGreaterThanOrEqual(1);
      const anomaly = body.integrity.anomalies.find(
        (a: { attemptId: string }) => a.attemptId === attemptId,
      );
      expect(anomaly).toBeDefined();
      expect(anomaly.kind).toBe("submitted_workset_mismatch");
      expect(anomaly.gradingEntries).toBe(0);
      expect(anomaly.snapshotQuestions).toBe(1);
    });

    it("does not flag a consistent workset (entry count == snapshot count)", async () => {
      const attemptId = await seedLegacyAttempt({
        gradingStatus: "pending_manual",
        withEntry: true,
      });

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const anomalies = body.integrity.anomalies.filter(
        (a: { attemptId: string }) => a.attemptId === attemptId,
      );
      // With a matching workset the attempt must NOT be flagged as
      // workset-mismatch; a pending_manual submitted row is not a
      // submitted_not_terminalized anomaly either.
      expect(anomalies).toEqual([]);
    });

    it("does not flag current-runtime graded attempts", async () => {
      const attemptId = await seedLegacyAttempt({
        status: "graded",
        gradingStatus: "auto_graded",
        withEntry: true,
      });

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const anomalies = body.integrity.anomalies.filter(
        (a: { attemptId: string }) => a.attemptId === attemptId,
      );
      expect(anomalies).toEqual([]);
    });
  });
});
