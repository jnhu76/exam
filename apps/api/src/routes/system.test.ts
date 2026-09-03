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
import { eq, inArray } from "drizzle-orm";
import { BOOTSTRAP_PENDING_MESSAGE } from "../workers/emailDeliveryWorker.js";

// P7-S2 integrity-block test fixtures accumulate submitted-attempt rows that
// change the tenant-wide anomaly totals. Tracked IDs let an inner afterAll
// delete them in FK-safe order (entries → attempts → enrollments → profiles →
// exams → users → courses) so each test sees a clean baseline and the
// bounded-sample cap assertions are not perturbed by leftover state.
const seeded = {
  gradingEntryIds: [] as string[],
  attemptIds: [] as string[],
  enrollmentIds: [] as string[],
  candidateProfileIds: [] as string[],
  examIds: [] as string[],
  userIds: [] as string[],
  courseIds: [] as string[],
};

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
          type: "grade_notification",
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
          type: "grade_notification",
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
    // FK-ordered teardown of every row the two seed helpers created, so the
    // shared test tenant's anomaly totals return to a clean baseline between
    // tests and the bounded-sample assertions are not perturbed by leftovers.
    afterAll(async () => {
      const db = ctx.db;
      // Guard each delete: drizzle treats `.where(undefined)` as "no WHERE"
      // (DELETE ALL), which would wipe the shared tenant. Only delete when the
      // tracker is non-empty. FK-safe order: entries → attempts → enrollments
      // → profiles → exams → users → courses. Errors are swallowed because the
      // outer ctx.cleanup still drops the schema.
      if (seeded.gradingEntryIds.length > 0) {
        await db
          .delete(schema.attemptGradingEntries)
          .where(
            inArray(schema.attemptGradingEntries.id, seeded.gradingEntryIds),
          )
          .catch(() => {});
      }
      if (seeded.attemptIds.length > 0) {
        await db
          .delete(schema.examAttempts)
          .where(inArray(schema.examAttempts.id, seeded.attemptIds))
          .catch(() => {});
      }
      if (seeded.enrollmentIds.length > 0) {
        await db
          .delete(schema.examEnrollments)
          .where(inArray(schema.examEnrollments.id, seeded.enrollmentIds))
          .catch(() => {});
      }
      if (seeded.candidateProfileIds.length > 0) {
        await db
          .delete(schema.candidateProfiles)
          .where(
            inArray(schema.candidateProfiles.id, seeded.candidateProfileIds),
          )
          .catch(() => {});
      }
      if (seeded.examIds.length > 0) {
        await db
          .delete(schema.exams)
          .where(inArray(schema.exams.id, seeded.examIds))
          .catch(() => {});
      }
      if (seeded.userIds.length > 0) {
        await db
          .delete(schema.users)
          .where(inArray(schema.users.id, seeded.userIds))
          .catch(() => {});
      }
      if (seeded.courseIds.length > 0) {
        await db
          .delete(schema.courses)
          .where(inArray(schema.courses.id, seeded.courseIds))
          .catch(() => {});
      }
    });

    const questionSnapshot: QuestionSnapshot[] = [
      {
        originalQuestionId: "q-legacy-1",
        type: "single_choice",
        content: "Q",
        contentDocument: null,
        answerMode: null,
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
        gradingStatus?:
          | "auto_graded"
          | "pending_manual"
          | "fully_graded"
          | null;
        withEntry?: boolean;
        snapshot?: QuestionSnapshot[];
        attemptId?: string;
      } = {},
    ): Promise<string> {
      const now = new Date();
      const orgId = ctx.org.id;
      const courseId = randomUUID();
      const examId = randomUUID();
      const candidateProfileId = randomUUID();
      const userId = randomUUID();
      const snapshot = overrides.snapshot ?? questionSnapshot;
      seeded.courseIds.push(courseId);
      seeded.examIds.push(examId);
      seeded.candidateProfileIds.push(candidateProfileId);
      seeded.userIds.push(userId);

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
      seeded.enrollmentIds.push(enrollmentId);
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
      const attemptId = overrides.attemptId ?? randomUUID();
      seeded.attemptIds.push(attemptId);
      await ctx.db.insert(schema.examAttempts).values({
        id: attemptId,
        organizationId: orgId,
        examId,
        enrollmentId,
        candidateId: candidateProfileId,
        attemptNo: 1,
        status: overrides.status ?? "submitted",
        // Explicit `null` must survive (legacy rows carry NULL grading_status);
        // only an ABSENT override falls back to the schema default.
        gradingStatus:
          overrides.gradingStatus === undefined
            ? "auto_graded"
            : overrides.gradingStatus,
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
        const entryId = randomUUID();
        seeded.gradingEntryIds.push(entryId);
        await ctx.db.insert(schema.attemptGradingEntries).values({
          id: entryId,
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

    // ── P7-S2 merge-review regressions ────────────────────────────────
    // The detector's anomaly predicates must run over the FULL candidate set
    // (counts are SQL totals, never derived from the bounded sample), and the
    // returned sample must be deterministic and capped at `limit`.

    /** GET diagnostics and return the integrity block (asserts HTTP 200). */
    async function fetchIntegrity(): Promise<{
      submittedNotTerminalized: number;
      submittedWorksetMismatch: number;
      anomalies: Array<{
        attemptId: string;
        kind: string;
        gradingStatus: string | null;
      }>;
    }> {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      return res.json().integrity;
    }

    /**
     * Bulk-seeds `count` submitted attempts sharing one exam/enrollment
     * (attemptNo 1..count satisfies the org+enrollment+attempt unique index).
     */
    async function seedSubmittedAttemptsBulk(
      count: number,
      opts: {
        gradingStatus: "auto_graded" | "pending_manual" | null;
        withEntry: boolean;
      },
    ): Promise<string[]> {
      const now = new Date();
      const orgId = ctx.org.id;
      const courseId = randomUUID();
      const examId = randomUUID();
      const candidateProfileId = randomUUID();
      const userId = randomUUID();
      seeded.courseIds.push(courseId);
      seeded.examIds.push(examId);
      seeded.candidateProfileIds.push(candidateProfileId);
      seeded.userIds.push(userId);

      await ctx.db.insert(schema.courses).values({
        id: courseId,
        organizationId: orgId,
        name: "Bulk",
        code: `BK-${randomUUID().slice(0, 6)}`,
        description: "",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert(schema.exams).values({
        id: examId,
        organizationId: orgId,
        title: "Bulk exam",
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
        questionIds: [questionSnapshot[0]!.originalQuestionId],
        questionSnapshot,
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
        username: `bk-cand-${randomUUID().slice(0, 6)}`,
        passwordHash: "hash",
        name: "Bulk Candidate",
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
      seeded.enrollmentIds.push(enrollmentId);
      await ctx.db.insert(schema.examEnrollments).values({
        id: enrollmentId,
        organizationId: orgId,
        examId,
        candidateId: candidateProfileId,
        status: "completed",
        attemptCount: count,
        createdAt: now,
        updatedAt: now,
      });

      // Build all attempt + grading-entry rows first, then insert in two bulk
      // statements (N rows each) instead of N round-trips. Every generated ID
      // is tracked for the FK-ordered afterAll cleanup.
      const attemptRows: (typeof schema.examAttempts.$inferInsert)[] = [];
      const entryRows: (typeof schema.attemptGradingEntries.$inferInsert)[] =
        [];
      const attemptIds: string[] = [];
      for (let i = 0; i < count; i++) {
        const attemptId = randomUUID();
        attemptIds.push(attemptId);
        attemptRows.push({
          id: attemptId,
          organizationId: orgId,
          examId,
          enrollmentId,
          candidateId: candidateProfileId,
          attemptNo: i + 1,
          status: "submitted",
          gradingStatus: opts.gradingStatus,
          questionSnapshot,
          answers: [],
          submittedAnswers: { schemaVersion: 1, answers: [] },
          submittedAt: now,
          gradedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        if (opts.withEntry) {
          const entryId = randomUUID();
          entryRows.push({
            id: entryId,
            organizationId: orgId,
            attemptId,
            questionId: questionSnapshot[0]!.originalQuestionId,
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
      }
      if (attemptRows.length > 0) {
        await ctx.db.insert(schema.examAttempts).values(attemptRows);
        seeded.attemptIds.push(...attemptIds);
      }
      if (entryRows.length > 0) {
        await ctx.db.insert(schema.attemptGradingEntries).values(entryRows);
        seeded.gradingEntryIds.push(...entryRows.map((r) => r.id!));
      }
      return attemptIds;
    }

    it("counts an anomaly beyond the first 100 submitted attempts (no sample false-negative)", async () => {
      const before = await fetchIntegrity();

      // 120 CLEAN submitted attempts (consistent workset) push the candidate
      // set past any naive 100-row sample; the anomaly is the 121st row. A
      // detector that samples candidate rows BEFORE applying the anomaly
      // predicate would report zero — the count must come from SQL totals.
      await seedSubmittedAttemptsBulk(120, {
        gradingStatus: "pending_manual",
        withEntry: true,
      });
      const [anomalyId] = await seedSubmittedAttemptsBulk(1, {
        gradingStatus: "pending_manual",
        withEntry: false,
      });

      const after = await fetchIntegrity();
      expect(after.submittedWorksetMismatch).toBe(
        before.submittedWorksetMismatch + 1,
      );
      // The 120 clean rows belong to neither anomaly family.
      expect(after.submittedNotTerminalized).toBe(
        before.submittedNotTerminalized,
      );
      // The 121st-row anomaly must appear in the returned sample.
      const anomaly = after.anomalies.find((a) => a.attemptId === anomalyId);
      expect(anomaly).toBeDefined();
      expect(anomaly?.kind).toBe("submitted_workset_mismatch");
      expect(anomaly?.gradingStatus).toBe("pending_manual");
    });

    it("reports exact totals above the sample cap (counts never derived from the sample)", async () => {
      const before = await fetchIntegrity();

      // 120 rows each carrying BOTH anomaly families: 120 not-terminalized +
      // 120 workset-mismatch, far above the 100-row sample budget.
      await seedSubmittedAttemptsBulk(120, {
        gradingStatus: "auto_graded",
        withEntry: false,
      });

      const after = await fetchIntegrity();
      expect(after.submittedNotTerminalized).toBe(
        before.submittedNotTerminalized + 120,
      );
      expect(after.submittedWorksetMismatch).toBe(
        before.submittedWorksetMismatch + 120,
      );
      // The SAMPLE stays bounded at 100 even when totals exceed it AND every
      // fetched row qualifies for BOTH anomaly kinds (the boundary row that
      // pushes 99→100→101 under a naive post-row cap). This is the per-push
      // cap contract: the returned array length can never exceed `limit`.
      expect(after.anomalies.length).toBeLessThanOrEqual(100);
    });

    it("reports legacy grading_status=NULL anomalies without failing response serialization", async () => {
      // `grading_status` has no NOT NULL constraint; a legacy submitted row
      // can carry NULL. The wire contract must accept it — otherwise the
      // diagnostics response 500s exactly when the most corrupt rows appear.
      // A deterministic lowest-sorting attempt id guarantees the row is in
      // the bounded 100-row sample even though the bulk tests above have
      // filled the tenant's anomaly set past the sample cap.
      const LOWEST_SORTING_ATTEMPT_ID = "00000000-0000-0000-0000-000000000000";
      const attemptId = await seedLegacyAttempt({
        gradingStatus: null,
        withEntry: false,
        attemptId: LOWEST_SORTING_ATTEMPT_ID,
      });

      const integrity = await fetchIntegrity();
      expect(integrity.submittedWorksetMismatch).toBeGreaterThanOrEqual(1);
      const anomaly = integrity.anomalies.find(
        (a) => a.attemptId === attemptId,
      );
      expect(anomaly).toBeDefined();
      expect(anomaly?.kind).toBe("submitted_workset_mismatch");
      // Faithful evidence, not a fabricated value.
      expect(anomaly?.gradingStatus).toBeNull();
    });
  });
});
