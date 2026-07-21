import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import proctorMonitoringRoutes from "./proctorMonitoring.js";
import {
  buildTestApp,
  createCandidateViaApi,
  createExamViaApi,
} from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createClientEventRepo } from "@exam/db/src/repository/clientEventRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";

/**
 * Registers auth + the monitoring routes under test. Auth is needed to mint
 * admin/candidate sessions; the monitoring routes are the system under test.
 */
const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  // Note: buildTestApp registers authPlugin (fastify.authenticate/requireRole)
  // automatically. We only need business routes here.
  await fastify.register(courseRoutes);
  await fastify.register(questionRoutes);
  await fastify.register(candidateRoutes);
  await fastify.register(examRoutes);
  await fastify.register(attemptRoutes);
  await fastify.register(proctorMonitoringRoutes);
};

describe("proctor monitoring API", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });
  });

  afterAll(async () => {
    // Clean up any client_events we wrote.
    await ctx.db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.organizationId, ctx.org.id));
    await ctx.cleanup();
  });

  /** Creates a published, open exam with one question. Returns its id. */
  async function createOpenExam(title: string): Promise<string> {
    const examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: title,
      courseCode: `mon-${Date.now()}`,
      courseName: `Monitoring ${title}`,
      questionContent: `${title} q`,
      questionAnswer: true,
      questionScore: 10,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    // The exam is created as "draft". Publish it directly via DB so the
    // candidate can start an attempt (avoids requiring the publish route
    // to be registered in the test plugin).
    await ctx.db
      .update(schema.exams)
      .set({ status: "published" })
      .where(eq(schema.exams.id, examId));
    return examId;
  }

  async function enrollAndStart(
    examId: string,
    candidate: { profileId: string; token: string },
  ): Promise<string> {
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidate.profileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    const start = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidate.token },
    });
    expect(start.statusCode).toBe(201);
    return start.json().id as string;
  }

  /** Seeds a client_event directly via the repo (bypasses the upload route). */
  async function seedEvent(
    attemptId: string,
    examId: string,
    name: string,
    metadata: Record<string, unknown> = {},
    level: "debug" | "info" | "warn" | "error" = "info",
  ): Promise<void> {
    await createClientEventRepo(ctx.db).createMany(
      {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate",
        permissions: [],
        sessionId: "sess",
      },
      [
        {
          userId: ctx.candidate.id,
          attemptId,
          examId,
          questionId: null,
          kind: "exam_telemetry",
          level,
          name,
          route: null,
          occurredAt: new Date(),
          receivedAt: new Date(),
          clientSessionId: "sess-1",
          metadata,
          userAgent: null,
        },
      ],
    );
  }

  describe("GET /api/admin/exams/:examId/proctor/attempts", () => {
    it("admin receives monitoring statuses for active attempts", async () => {
      const examId = await createOpenExam("Monitor Exam A");
      const cand = await createCandidateViaApi(
        ctx.app,
        ctx.adminToken,
        `cand-mon-a-${Date.now()}`,
        ctx.org.id,
      );
      const attemptId = await enrollAndStart(examId, {
        profileId: cand.candidateProfileId,
        token: cand.token,
      });
      // Seed a couple of events to exercise counts.
      await seedEvent(attemptId, examId, "visibility_lost");
      await seedEvent(attemptId, examId, "browser_offline");

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${examId}/proctor/attempts`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBeGreaterThanOrEqual(1);
      const row = body.items.find(
        (i: { attemptId: string }) => i.attemptId === attemptId,
      );
      expect(row).toBeDefined();
      expect(row.onlineState).toBe("online"); // just started
      expect(row.visibilityLostCount).toBe(1);
      expect(row.browserOfflineCount).toBe(1);
      // lastSaveAt: server-side fact (attempt.lastActivityAt, set on start).
      expect(row.lastSaveAt).not.toBeNull();
      expect(["normal", "warning", "critical"]).toContain(row.warningLevel);
    });

    it("candidate CANNOT access (403)", async () => {
      const examId = await createOpenExam("Monitor Exam Forbidden");
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${examId}/proctor/attempts`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("PERMISSION_DENIED");
    });

    it("unauthenticated → 401", async () => {
      const examId = await createOpenExam("Monitor Exam NoAuth");
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${examId}/proctor/attempts`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects an invalid examId (400)", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/not-a-uuid/proctor/attempts`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/admin/attempts/:attemptId/proctor-events", () => {
    it("admin receives the timeline with allowlisted metadata (sensitive dropped)", async () => {
      const examId = await createOpenExam("Monitor Exam Timeline");
      const cand = await createCandidateViaApi(
        ctx.app,
        ctx.adminToken,
        `cand-mon-t-${Date.now()}`,
        ctx.org.id,
      );
      const attemptId = await enrollAndStart(examId, {
        profileId: cand.candidateProfileId,
        token: cand.token,
      });
      // Seed an event carrying BOTH allowlisted and sensitive fields.
      await seedEvent(
        attemptId,
        examId,
        "answer_autosave_failed",
        {
          questionId: "q1",
          saveMode: "autosave",
          durationMs: 99,
          errorCode: "NET",
          answer: "SECRET_ANSWER", // must be dropped
          token: "abc", // must be dropped
        },
        "warn",
      );

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/proctor-events?limit=20`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const ev = body.items.find(
        (i: { name: string }) => i.name === "answer_autosave_failed",
      );
      expect(ev).toBeDefined();
      expect(ev.metadata).toEqual({
        questionId: "q1",
        saveMode: "autosave",
        durationMs: 99,
        errorCode: "NET",
      });
      expect(ev.metadata).not.toHaveProperty("answer");
      expect(ev.metadata).not.toHaveProperty("token");
      expect(ev.source).toBe("client_event");
    });

    it("candidate CANNOT access (403)", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/00000000-0000-4000-8000-000000000001/proctor-events`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("cross-org / nonexistent attempt → 404", async () => {
      // A valid UUID that does not exist in this org.
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/00000000-0000-4000-8000-000000000099/proctor-events`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });
  });

  describe("POST /api/admin/attempts/:attemptId/proctor-incident", () => {
    it("admin creates a proctor incident and writes audit event", async () => {
      const examId = await createOpenExam("Incident Exam A");
      const cand = await createCandidateViaApi(
        ctx.app,
        ctx.adminToken,
        `cand-inc-a-${Date.now()}`,
        ctx.org.id,
      );
      const attemptId = await enrollAndStart(examId, {
        profileId: cand.candidateProfileId,
        token: cand.token,
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/proctor-incident`,
        payload: {
          incidentType: "suspicious_behavior_marked",
          examId,
          candidateId: cand.candidateProfileId,
          attemptId,
          reasonCode: "TAB_SWITCH",
          note: "Candidate switched tabs 5 times",
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });

      // Verify audit event was written.
      const { items } = await createAuditLogRepo(ctx.db).listPaginatedFiltered(
        {
          actorId: ctx.admin.id,
          organizationId: ctx.org.id,
          targetOrganizationId: ctx.org.id,
          role: "Admin",
          permissions: [],
          sessionId: "test",
        },
        1,
        50,
        { action: "proctor.incident_marked" },
      );
      const mine = items.find((i) => i.auditLog.targetId === attemptId);
      expect(mine).toBeDefined();
      expect(mine!.auditLog.metadata).toMatchObject({
        incidentType: "suspicious_behavior_marked",
        examId,
        reasonCode: "TAB_SWITCH",
      });
    });

    it("rejects invalid incident type with 400", async () => {
      const examId = await createOpenExam("Incident Exam B");
      const cand = await createCandidateViaApi(
        ctx.app,
        ctx.adminToken,
        `cand-inc-b-${Date.now()}`,
        ctx.org.id,
      );
      const attemptId = await enrollAndStart(examId, {
        profileId: cand.candidateProfileId,
        token: cand.token,
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/proctor-incident`,
        payload: {
          incidentType: "invalid_type",
          examId,
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(400);
    });

    it("candidate CANNOT create incident (403)", async () => {
      const examId = await createOpenExam("Incident Exam C");
      const cand = await createCandidateViaApi(
        ctx.app,
        ctx.adminToken,
        `cand-inc-c-${Date.now()}`,
        ctx.org.id,
      );
      const attemptId = await enrollAndStart(examId, {
        profileId: cand.candidateProfileId,
        token: cand.token,
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/proctor-incident`,
        payload: {
          incidentType: "manual_note_added",
          examId,
        },
        cookies: { "auth-token": cand.token },
      });
      expect(res.statusCode).toBe(403);
    });

    it("stores only the declared bounded incident note field", async () => {
      const examId = await createOpenExam("Incident Exam D");
      const cand = await createCandidateViaApi(
        ctx.app,
        ctx.adminToken,
        `cand-inc-d-${Date.now()}`,
        ctx.org.id,
      );
      const attemptId = await enrollAndStart(examId, {
        profileId: cand.candidateProfileId,
        token: cand.token,
      });

      await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/proctor-incident`,
        payload: {
          incidentType: "identity_check_failed",
          examId,
          note: "Identity could not be verified",
        },
        cookies: { "auth-token": ctx.adminToken },
      });

      const { items } = await createAuditLogRepo(ctx.db).listPaginatedFiltered(
        {
          actorId: ctx.admin.id,
          organizationId: ctx.org.id,
          targetOrganizationId: ctx.org.id,
          role: "Admin",
          permissions: [],
          sessionId: "test",
        },
        1,
        50,
        { action: "proctor.incident_marked" },
      );
      const mine = items.find((i) => i.auditLog.targetId === attemptId);
      expect(mine).toBeDefined();
      const serialized = JSON.stringify(mine!.auditLog.metadata);
      expect(serialized).not.toContain("candidateAnswer");
      expect(serialized).not.toContain("standardAnswer");
      expect(mine!.auditLog.metadata.note).toBe(
        "Identity could not be verified",
      );
    });

    it("rejects contradictory client-supplied resource IDs", async () => {
      const examId = await createOpenExam("Incident Canonical IDs");
      const cand = await createCandidateViaApi(
        ctx.app,
        ctx.adminToken,
        `cand-inc-canonical-${Date.now()}`,
        ctx.org.id,
      );
      const attemptId = await enrollAndStart(examId, {
        profileId: cand.candidateProfileId,
        token: cand.token,
      });

      const response = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/proctor-incident`,
        payload: {
          incidentType: "manual_note_added",
          examId: crypto.randomUUID(),
        },
        cookies: { "auth-token": ctx.adminToken },
      });

      expect(response.statusCode).toBe(400);
      const { items } = await createAuditLogRepo(ctx.db).listPaginatedFiltered(
        {
          actorId: ctx.admin.id,
          organizationId: ctx.org.id,
          targetOrganizationId: ctx.org.id,
          role: "Admin",
          permissions: [],
          sessionId: "test",
        },
        1,
        50,
        { action: "proctor.incident_marked", targetId: attemptId },
      );
      expect(items).toHaveLength(0);
    });

    it("rejects an incident note over 500 characters", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/admin/attempts/00000000-0000-4000-8000-000000000001/proctor-incident",
        payload: {
          incidentType: "manual_note_added",
          note: "n".repeat(501),
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(response.statusCode).toBe(400);
    });

    it("unauthenticated → 401", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/00000000-0000-4000-8000-000000000001/proctor-incident`,
        payload: {
          incidentType: "manual_note_added",
          examId: "00000000-0000-4000-8000-000000000002",
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("nonexistent attempt → 404", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/00000000-0000-4000-8000-000000000099/proctor-incident`,
        payload: {
          incidentType: "manual_note_added",
          examId: "00000000-0000-4000-8000-000000000002",
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
