/**
 * J4-I1B behavior tests (ADR-015 §4.3 / §4.8 / §9) — Proctor assignment
 * enforcement on the assignment_scoped monitoring routes.
 *
 * Dedicated assertions:
 *   - assigned Proctor: 200 on timeline / proctor-events / proctor/attempts;
 *   - UNASSIGNED Proctor (same org): 404 RESOURCE_NOT_FOUND — the SAME
 *     response shape as a missing attempt (anti-enumeration, §9);
 *   - Admin: 200 without any assignment row (no fake assignment rows, §2);
 *   - Admin needs no assignment row to exist.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import proctorMonitoringRoutes from "./proctorMonitoring.js";
import { registerAdminAttemptRoutes } from "./attempts.admin.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  uniquePrefix,
} from "./testHelpers.js";

const plugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(proctorMonitoringRoutes);
  await fastify.register(registerAdminAttemptRoutes);
};

describe("J4-I1B Proctor assignment enforcement (assignment_scoped)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let attemptId: string;
  let assignedProctorToken: string;
  let unassignedProctorToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(plugin);

    // Exam + attempt fixture in the seed org.
    const now = new Date();
    const courseId = randomUUID();
    examId = randomUUID();
    attemptId = randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Proctor scope course",
      code: `PSC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.exams).values({
      id: examId,
      organizationId: ctx.org.id,
      title: "Proctor scope exam",
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
    const enrollmentId = randomUUID();
    const candidateProfileId = randomUUID();
    await ctx.db.insert(schema.candidateProfiles).values({
      id: candidateProfileId,
      organizationId: ctx.org.id,
      userId: ctx.candidate.id,
      fields: {},
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

    // Two Proctors: P1 assigned to the exam, P2 unassigned.
    const p1 = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Proctor",
      "assigned-proctor",
    );
    assignedProctorToken = p1.token;
    await ctx.db.insert(schema.examProctorAssignments).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      examId,
      proctorUserId: p1.user.id,
      status: "active",
      assignedBy: ctx.admin.id,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const p2 = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Proctor",
      "unassigned-proctor",
    );
    unassignedProctorToken = p2.token;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // URLs are built lazily inside each test body: examId/attemptId are only
  // assigned in beforeAll, and it.each evaluates its table at module load.
  const monitoringRoutes = [
    {
      name: "GET /admin/exams/:examId/proctor/attempts",
      build: () => `/api/admin/exams/${examId}/proctor/attempts`,
    },
    {
      name: "GET /admin/attempts/:attemptId/proctor-events",
      build: () => `/api/admin/attempts/${attemptId}/proctor-events?limit=20`,
    },
    {
      name: "GET /admin/attempts/:attemptId/timeline",
      build: () => `/api/admin/attempts/${attemptId}/timeline`,
    },
  ];

  it.each(monitoringRoutes)(
    "assigned Proctor: $name → 200",
    async ({ build }) => {
      const res = await ctx.app.inject({
        method: "GET",
        url: build(),
        cookies: { "auth-token": assignedProctorToken },
      });
      expect(res.statusCode, build()).toBe(200);
    },
  );

  it.each(monitoringRoutes)(
    "UNASSIGNED Proctor: $name → 404 RESOURCE_NOT_FOUND (anti-enumeration)",
    async ({ build }) => {
      const res = await ctx.app.inject({
        method: "GET",
        url: build(),
        cookies: { "auth-token": unassignedProctorToken },
      });
      expect(res.statusCode, build()).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    },
  );

  it.each(monitoringRoutes)(
    "Admin (no assignment row): $name → 200 — Admin short-circuits the assignment requirement",
    async ({ build }) => {
      const res = await ctx.app.inject({
        method: "GET",
        url: build(),
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode, build()).toBe(200);
    },
  );

  it("unassigned 404 is indistinguishable from a missing attempt (same response shape)", async () => {
    const missing = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${randomUUID()}/timeline`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const unassigned = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${attemptId}/timeline`,
      cookies: { "auth-token": unassignedProctorToken },
    });
    expect(missing.statusCode).toBe(404);
    expect(unassigned.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("RESOURCE_NOT_FOUND");
    expect(unassigned.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("a revoked assignment blocks the next request (404); restoring it restores access", async () => {
    const now = new Date();
    const [episode] = await ctx.db
      .select({ id: schema.examProctorAssignments.id })
      .from(schema.examProctorAssignments)
      .where(
        and(
          eq(schema.examProctorAssignments.organizationId, ctx.org.id),
          eq(schema.examProctorAssignments.examId, examId),
          eq(schema.examProctorAssignments.status, "active"),
        ),
      );
    expect(episode).toBeDefined();

    await ctx.db
      .update(schema.examProctorAssignments)
      .set({ status: "revoked", revokedAt: now, revokedBy: ctx.admin.id })
      .where(
        and(
          eq(schema.examProctorAssignments.organizationId, ctx.org.id),
          eq(schema.examProctorAssignments.id, episode!.id),
        ),
      );

    const revokedRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/exams/${examId}/proctor/attempts`,
      cookies: { "auth-token": assignedProctorToken },
    });
    expect(revokedRes.statusCode).toBe(404);

    // Restore via a NEW active episode for the SAME proctor (reassign
    // semantics) — the next request is authorized again.
    const proctorId = (
      await ctx.db
        .select({ proctorUserId: schema.examProctorAssignments.proctorUserId })
        .from(schema.examProctorAssignments)
        .where(eq(schema.examProctorAssignments.id, episode!.id))
    )[0]!.proctorUserId;
    await ctx.db.insert(schema.examProctorAssignments).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      examId,
      proctorUserId: proctorId,
      status: "active",
      assignedBy: ctx.admin.id,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const restoredRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/exams/${examId}/proctor/attempts`,
      cookies: { "auth-token": assignedProctorToken },
    });
    expect(restoredRes.statusCode).toBe(200);
  });
});
