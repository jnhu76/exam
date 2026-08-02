/**
 * J4-I1D end-to-end authorization tests (ADR-015 §6.3) — the frozen
 * Proctor capability set activated behind the J4-I1B resolver enforcement.
 *
 * Fixtures: Admin · Proctor P1 (assigned to Exam A) · Proctor P2 (unassigned)
 * · Exam A · Exam B · Attempts and Incidents under both Exams.
 *
 * Covers every §6.3 assertion, including the revocation / role-loss /
 * role-restore cycles and the "Admin needs no fake assignment row" invariant.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import proctorMonitoringRoutes from "./proctorMonitoring.js";
import { registerAdminAttemptRoutes } from "./attempts.admin.js";
import { registerAdminIncidentRoutes } from "./incidents.admin.js";
import { adminProctorAssignmentRoutes } from "./proctorAssignments.admin.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  uniquePrefix,
} from "./testHelpers.js";

const plugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(proctorMonitoringRoutes);
  await fastify.register(registerAdminAttemptRoutes);
  await fastify.register(registerAdminIncidentRoutes);
  await fastify.register(adminProctorAssignmentRoutes);
};

const opId = () => randomUUID();

interface ExamFixture {
  examId: string;
  attemptId: string;
  incidentId: string;
}

describe("J4-I1D Proctor minimum activation — end-to-end authorization", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examA: ExamFixture;
  let examB: ExamFixture;
  let p1UserId: string;
  let p1Token: string;
  let p2Token: string;
  let p1AssignmentId: string;
  let candidateProfileId: string;

  async function seedExam(examTitle: string): Promise<ExamFixture> {
    const now = new Date();
    const courseId = randomUUID();
    const examId = randomUUID();
    const attemptId = randomUUID();
    const incidentId = randomUUID();
    const enrollmentId = randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: `${examTitle} course`,
      code: `EC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.exams).values({
      id: examId,
      organizationId: ctx.org.id,
      title: examTitle,
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(now.getTime() + 86400_000),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [],
      questionSnapshot: [],
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
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId: ctx.org.id,
      examId,
      candidateId: candidateProfileId,
      status: "active",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId: ctx.org.id,
      examId,
      enrollmentId,
      candidateId: candidateProfileId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      startedAt: now,
      deadlineAt: new Date(now.getTime() + 3600_000),
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.examIncidents).values({
      id: incidentId,
      organizationId: ctx.org.id,
      examId,
      attemptId: null,
      candidateId: null,
      type: "network_interruption",
      severity: "minor",
      status: "open",
      occurredAt: null,
      description: `${examTitle} incident`,
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: ctx.admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { examId, attemptId, incidentId };
  }

  beforeAll(async () => {
    ctx = await buildTestApp(plugin);

    // One shared candidate profile for both exams (the seed org's candidate).
    candidateProfileId = randomUUID();
    await ctx.db.insert(schema.candidateProfiles).values({
      id: candidateProfileId,
      organizationId: ctx.org.id,
      userId: ctx.candidate.id,
      fields: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    examA = await seedExam("Exam A");
    examB = await seedExam("Exam B");

    // P1: assigned to Exam A. P2: unassigned.
    const p1 = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Proctor",
      "e2e-p1",
    );
    p1UserId = p1.user.id;
    p1Token = p1.token;
    const p2 = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Proctor",
      "e2e-p2",
    );
    p2Token = p2.token;

    const now = new Date();
    const [assignment] = await ctx.db
      .insert(schema.examProctorAssignments)
      .values({
        id: randomUUID(),
        organizationId: ctx.org.id,
        examId: examA.examId,
        proctorUserId: p1UserId,
        status: "active",
        assignedBy: ctx.admin.id,
        assignedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    p1AssignmentId = assignment!.id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe("assigned-Proctor reads (Exam A)", () => {
    it("P1 lists Exam A but NOT Exam B", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/proctor/exams",
        cookies: { "auth-token": p1Token },
      });
      expect(res.statusCode).toBe(200);
      const ids = res
        .json()
        .items.map((item: { examId: string }) => item.examId);
      expect(ids).toContain(examA.examId);
      expect(ids).not.toContain(examB.examId);
    });

    it("P1 reads Exam A monitoring data", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${examA.examId}/proctor/attempts`,
        cookies: { "auth-token": p1Token },
      });
      expect(res.statusCode).toBe(200);
    });

    it("P1 reads the Exam A attempt timeline and proctor-events", async () => {
      const timeline = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${examA.attemptId}/timeline`,
        cookies: { "auth-token": p1Token },
      });
      expect(timeline.statusCode).toBe(200);
      const events = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${examA.attemptId}/proctor-events?limit=20`,
        cookies: { "auth-token": p1Token },
      });
      expect(events.statusCode).toBe(200);
    });
  });

  describe("cross-Exam denial (anti-enumeration)", () => {
    it("P1 cannot read Exam B by guessed Exam id → 404, same shape as missing", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${examB.examId}/proctor/attempts`,
        cookies: { "auth-token": p1Token },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
      // Indistinguishable from a missing exam id.
      const missing = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${randomUUID()}/proctor/attempts`,
        cookies: { "auth-token": p1Token },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });

    it("P1 cannot read an Attempt belonging to Exam B → 404", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${examB.attemptId}/timeline`,
        cookies: { "auth-token": p1Token },
      });
      expect(res.statusCode).toBe(404);
    });

    it("P1 cannot read an Incident belonging to Exam B → 404", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/incidents/${examB.incidentId}`,
        cookies: { "auth-token": p1Token },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });
  });

  describe("incident authority for assigned Exams", () => {
    it("P1 can create an Incident for Exam A", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/exams/${examA.examId}/incidents`,
        cookies: { "auth-token": p1Token },
        payload: {
          operationId: opId(),
          type: "suspected_misconduct",
          description: "P1 reported issue",
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().outcome).toBe("applied");
    });

    it("P1 can investigate the Exam A incident (start + note)", async () => {
      const created = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/exams/${examA.examId}/incidents`,
        cookies: { "auth-token": p1Token },
        payload: {
          operationId: opId(),
          type: "operator_error",
          description: "Investigate me",
        },
      });
      const incidentId = created.json().incident.id;
      const investigate = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/incidents/${incidentId}/investigate`,
        cookies: { "auth-token": p1Token },
        payload: { operationId: opId(), expectedVersion: 1 },
      });
      expect(investigate.statusCode, investigate.body).toBe(200);
      const note = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/incidents/${incidentId}/notes`,
        cookies: { "auth-token": p1Token },
        payload: { operationId: opId(), body: "P1 note" },
      });
      expect(note.statusCode, note.body).toBe(200);
    });

    it("P1 cannot resolve or dismiss an Incident → 403", async () => {
      const resolveRes = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/incidents/${examA.incidentId}/resolve`,
        cookies: { "auth-token": p1Token },
        payload: {
          operationId: opId(),
          expectedVersion: 1,
          resolutionSummary: "resolved",
        },
      });
      expect(resolveRes.statusCode).toBe(403);
      const dismissRes = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/incidents/${examA.incidentId}/dismiss`,
        cookies: { "auth-token": p1Token },
        payload: { operationId: opId(), expectedVersion: 1, reasonText: "n/a" },
      });
      expect(dismissRes.statusCode).toBe(403);
    });
  });

  describe("dangerous operations stay denied (J4-I1B grants removed)", () => {
    it("P1 cannot force-submit → 403", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${examA.attemptId}/force-submit`,
        cookies: { "auth-token": p1Token },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    });

    it("P1 cannot mark misconduct → 403", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${examA.attemptId}/misconduct`,
        cookies: { "auth-token": p1Token },
        payload: { severity: "warning", notes: "nope" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("P1 cannot grant time → 403", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${examA.attemptId}/time-grants`,
        cookies: { "auth-token": p1Token },
        payload: {
          operationId: opId(),
          addedSeconds: 60,
          reasonCode: "test",
          reasonText: "test grant",
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("lifecycle: revocation / role-loss / role-restore", () => {
    it("revoking P1's assignment makes the next request return 404", async () => {
      const now = new Date();
      await ctx.db
        .update(schema.examProctorAssignments)
        .set({ status: "revoked", revokedAt: now, revokedBy: ctx.admin.id })
        .where(
          and(
            eq(schema.examProctorAssignments.organizationId, ctx.org.id),
            eq(schema.examProctorAssignments.id, p1AssignmentId),
          ),
        );
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${examA.examId}/proctor/attempts`,
        cookies: { "auth-token": p1Token },
      });
      expect(res.statusCode).toBe(404);
    });

    it("restoring the assignment restores access", async () => {
      const now = new Date();
      const [restored] = await ctx.db
        .insert(schema.examProctorAssignments)
        .values({
          id: randomUUID(),
          organizationId: ctx.org.id,
          examId: examA.examId,
          proctorUserId: p1UserId,
          status: "active",
          assignedBy: ctx.admin.id,
          assignedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      p1AssignmentId = restored!.id;
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${examA.examId}/proctor/attempts`,
        cookies: { "auth-token": p1Token },
      });
      expect(res.statusCode).toBe(200);
    });

    it("removing the active Proctor ROLE disables access even though the assignment remains", async () => {
      // Deactivate P1's Proctor role assignment (the exam assignment stays
      // active — the triple requires BOTH).
      await ctx.db
        .update(schema.userRoleAssignments)
        .set({ isActive: false })
        .where(
          and(
            eq(schema.userRoleAssignments.organizationId, ctx.org.id),
            eq(schema.userRoleAssignments.userId, p1UserId),
          ),
        );
      // With zero active assignments, authenticate denies 401.
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${examA.examId}/proctor/attempts`,
        cookies: { "auth-token": p1Token },
      });
      expect(res.statusCode).toBe(401);
    });

    it("restoring the active Proctor role makes the retained active assignment authorize again", async () => {
      await ctx.db
        .update(schema.userRoleAssignments)
        .set({ isActive: true })
        .where(
          and(
            eq(schema.userRoleAssignments.organizationId, ctx.org.id),
            eq(schema.userRoleAssignments.userId, p1UserId),
          ),
        );
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${examA.examId}/proctor/attempts`,
        cookies: { "auth-token": p1Token },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("Admin authority without fake assignment rows", () => {
    it("Admin works on every Proctor-reachable route with zero assignment rows", async () => {
      const routes = [
        ["GET", `/api/admin/exams/${examA.examId}/proctor/attempts`],
        ["GET", `/api/admin/attempts/${examA.attemptId}/timeline`],
        ["GET", `/api/admin/incidents/${examA.incidentId}`],
        ["GET", `/api/admin/incidents/${examB.incidentId}`],
      ] as const;
      for (const [method, url] of routes) {
        const res = await ctx.app.inject({
          method,
          url,
          cookies: { "auth-token": ctx.adminToken },
        });
        expect(res.statusCode, `${method} ${url}`).toBe(200);
      }
    });

    it("no Admin assignment row is ever created", async () => {
      const rows = await ctx.db
        .select()
        .from(schema.examProctorAssignments)
        .where(eq(schema.examProctorAssignments.proctorUserId, ctx.admin.id));
      expect(rows).toEqual([]);
    });
  });
});
