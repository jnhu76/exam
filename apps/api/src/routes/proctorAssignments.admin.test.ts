import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  uniquePrefix,
} from "./testHelpers.js";
import { adminProctorAssignmentRoutes } from "./proctorAssignments.admin.js";

const plugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(adminProctorAssignmentRoutes);
};

const opId = () => randomUUID();

describe("Admin proctor assignment API (ADR-015 §16, J4-I1C)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let proctorUserId: string;
  let proctorToken: string;
  let teacherUserId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(plugin);

    // Exam fixture in the seed org.
    const now = new Date();
    const courseId = randomUUID();
    examId = randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Assignment course",
      code: `AC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.exams).values({
      id: examId,
      organizationId: ctx.org.id,
      title: "Assignment exam",
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

    // Proctor user WITH active Proctor role (qualifies for assignment).
    const proctor = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Proctor",
      "assignment-target",
    );
    proctorUserId = proctor.user.id;
    proctorToken = proctor.token;

    // Teacher user WITHOUT a Proctor role (fails qualification).
    const teacher = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "assignment-teacher",
    );
    teacherUserId = teacher.user.id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  const assign = (payload: Record<string, unknown>) =>
    ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/proctors`,
      cookies: { "auth-token": ctx.adminToken },
      payload,
    });

  const list = (query = "") =>
    ctx.app.inject({
      method: "GET",
      url: `/api/admin/exams/${examId}/proctors${query}`,
      cookies: { "auth-token": ctx.adminToken },
    });

  const revoke = (proctorId: string, payload: Record<string, unknown>) =>
    ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/proctors/${proctorId}/revoke`,
      cookies: { "auth-token": ctx.adminToken },
      payload,
    });

  describe("assign", () => {
    it("Admin assign → applied, active episode, audit written", async () => {
      const operationId = opId();
      const res = await assign({ operationId, proctorUserId });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.outcome).toBe("applied");
      expect(body.assignment).toMatchObject({
        examId,
        proctorUserId,
        status: "active",
        assignedBy: ctx.admin.id,
      });
      expect(body.assignment.revokedAt).toBeNull();

      // Audit row exists.
      const audit = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.action, "exam.proctor_assigned"),
            eq(schema.auditLogs.targetId, examId),
          ),
        );
      expect(audit.length).toBe(1);
      expect(audit[0]!.metadata).toMatchObject({
        examId,
        proctorUserId,
        assignmentId: body.assignment.id,
      });
    });

    it("Admin duplicate assign with a NEW operationId → no_change, no new episode, no extra audit", async () => {
      const auditBefore = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.action, "exam.proctor_assigned"));
      const res = await assign({ operationId: opId(), proctorUserId });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().outcome).toBe("no_change");

      const episodes = await ctx.db
        .select()
        .from(schema.examProctorAssignments)
        .where(
          and(
            eq(schema.examProctorAssignments.organizationId, ctx.org.id),
            eq(schema.examProctorAssignments.examId, examId),
            eq(schema.examProctorAssignments.proctorUserId, proctorUserId),
          ),
        );
      expect(episodes).toHaveLength(1);
      const auditAfter = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.action, "exam.proctor_assigned"));
      expect(auditAfter.length).toBe(auditBefore.length);
    });

    it("Admin assign replay (same operationId + payload) → idempotent_replayed", async () => {
      const operationId = opId();
      await assign({ operationId, proctorUserId });
      const res = await assign({ operationId, proctorUserId });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().outcome).toBe("idempotent_replayed");
    });

    it("Admin assign payload conflict (same operationId, different reasonCode) → 409 IDEMPOTENCY_CONFLICT", async () => {
      const operationId = opId();
      await assign({ operationId, proctorUserId });
      const res = await assign({
        operationId,
        proctorUserId,
        reasonCode: "different",
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("inactive target user → 400 VALIDATION_ERROR", async () => {
      const inactive = await createAssignedUserForTest(
        ctx.db,
        ctx.org.id,
        "Proctor",
        "inactive-proctor",
      );
      await ctx.db
        .update(schema.users)
        .set({ isActive: false })
        .where(eq(schema.users.id, inactive.user.id));
      const res = await assign({
        operationId: opId(),
        proctorUserId: inactive.user.id,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("target without an active Proctor role → 400 VALIDATION_ERROR", async () => {
      const res = await assign({
        operationId: opId(),
        proctorUserId: teacherUserId,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("cross-organization target user is hidden → 404 RESOURCE_NOT_FOUND", async () => {
      const foreignOrgId = randomUUID();
      await ctx.db.insert(schema.organizations).values({
        id: foreignOrgId,
        name: "Foreign org",
        displayName: "Foreign org",
        slug: `foreign-${uniquePrefix()}`,
      });
      await ctx.db.insert(schema.users).values({
        id: randomUUID(),
        organizationId: foreignOrgId,
        username: `foreign-user-${uniquePrefix()}`,
        passwordHash: "hash",
        name: "Foreign",
        role: "Proctor",
        isActive: true,
      });
      const foreignUser = await ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.organizationId, foreignOrgId))
        .limit(1);
      const res = await assign({
        operationId: opId(),
        proctorUserId: foreignUser[0]!.id,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });

    it("missing exam → 404 (the Exam resolver runs on every assignment route)", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/exams/${randomUUID()}/proctors`,
        cookies: { "auth-token": ctx.adminToken },
        payload: { operationId: opId(), proctorUserId },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });
  });

  describe("list", () => {
    it("active default: only active episodes", async () => {
      const res = await list();
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) {
        expect(item.status).toBe("active");
      }
    });

    it("list revoked", async () => {
      // Revoke the current active episode first.
      const active = await ctx.db
        .select()
        .from(schema.examProctorAssignments)
        .where(
          and(
            eq(schema.examProctorAssignments.organizationId, ctx.org.id),
            eq(schema.examProctorAssignments.examId, examId),
            eq(schema.examProctorAssignments.status, "active"),
          ),
        )
        .limit(1);
      if (active[0]) {
        await revoke(active[0]!.proctorUserId, { operationId: opId() });
      }
      const res = await list("?status=revoked");
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) {
        expect(item.status).toBe("revoked");
        expect(item.revokedAt).not.toBeNull();
      }
    });

    it("list all + stable keyset pagination (limit 1)", async () => {
      // Ensure at least two episodes exist for pagination.
      for (let i = 0; i < 2; i++) {
        const p = await createAssignedUserForTest(
          ctx.db,
          ctx.org.id,
          "Proctor",
          `pagination-${i}`,
        );
        await assign({ operationId: opId(), proctorUserId: p.user.id });
      }
      const page1 = await list("?status=all&limit=1");
      expect(page1.statusCode).toBe(200);
      const body1 = page1.json();
      expect(body1.items).toHaveLength(1);
      expect(body1.nextCursor).not.toBeNull();

      const page2 = await list(
        `?status=all&limit=1&cursor=${encodeURIComponent(body1.nextCursor)}`,
      );
      expect(page2.statusCode).toBe(200);
      const body2 = page2.json();
      expect(body2.items).toHaveLength(1);
      // Keyset pagination never repeats an item and the cursor order is stable.
      expect(body2.items[0]!.id).not.toBe(body1.items[0]!.id);
    });

    it.each([
      ["garbage", "garbage"],
      ["missing separator", "2026-08-02T00:00:00.000Z"],
      ["invalid datetime", "not-a-date|some-id"],
      ["empty id", "2026-08-02T00:00:00.000Z|"],
      ["too many parts", "a|b|c"],
    ])(
      "rejects malformed cursor (%s) → 400 VALIDATION_ERROR",
      async (_label, cursor) => {
        const res = await list(`?cursor=${encodeURIComponent(cursor)}`);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe("VALIDATION_ERROR");
      },
    );
  });

  describe("revoke", () => {
    it("Admin revoke applied → episode revoked, audit written", async () => {
      // Establish a fresh episode.
      const freshProctor = await createAssignedUserForTest(
        ctx.db,
        ctx.org.id,
        "Proctor",
        "revoke-target",
      );
      await assign({
        operationId: opId(),
        proctorUserId: freshProctor.user.id,
      });

      const auditBefore = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.action, "exam.proctor_revoked"));
      const res = await revoke(freshProctor.user.id, { operationId: opId() });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.outcome).toBe("applied");
      expect(body.assignment.status).toBe("revoked");
      expect(body.assignment.revokedBy).toBe(ctx.admin.id);
      expect(body.assignment.revokedAt).not.toBeNull();

      const auditAfter = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.action, "exam.proctor_revoked"));
      expect(auditAfter.length).toBe(auditBefore.length + 1);
    });

    it("Admin revoke already revoked with a NEW operationId → no_change", async () => {
      const freshProctor = await createAssignedUserForTest(
        ctx.db,
        ctx.org.id,
        "Proctor",
        "revoke-twice",
      );
      await assign({
        operationId: opId(),
        proctorUserId: freshProctor.user.id,
      });
      await revoke(freshProctor.user.id, { operationId: opId() });
      const res = await revoke(freshProctor.user.id, { operationId: opId() });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().outcome).toBe("no_change");
    });

    it("Admin revoke replay → idempotent_replayed", async () => {
      const freshProctor = await createAssignedUserForTest(
        ctx.db,
        ctx.org.id,
        "Proctor",
        "revoke-replay",
      );
      await assign({
        operationId: opId(),
        proctorUserId: freshProctor.user.id,
      });
      const operationId = opId();
      await revoke(freshProctor.user.id, { operationId });
      const res = await revoke(freshProctor.user.id, { operationId });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().outcome).toBe("idempotent_replayed");
    });

    it("revoke with no relationship at all → 404 RESOURCE_NOT_FOUND", async () => {
      const res = await revoke(teacherUserId, { operationId: opId() });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });
  });

  describe("authorization + resolver", () => {
    it("non-Admin is denied on every assignment route (403)", async () => {
      const proctorAssignRes = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/exams/${examId}/proctors`,
        cookies: { "auth-token": proctorToken },
        payload: { operationId: opId(), proctorUserId },
      });
      expect(proctorAssignRes.statusCode).toBe(403);
      const listRes = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${examId}/proctors`,
        cookies: { "auth-token": proctorToken },
      });
      expect(listRes.statusCode).toBe(403);
      const revokeRes = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/exams/${examId}/proctors/${proctorUserId}/revoke`,
        cookies: { "auth-token": proctorToken },
        payload: { operationId: opId() },
      });
      expect(revokeRes.statusCode).toBe(403);
    });

    it("cross-org Exam is hidden → 404 on every route (resolver runs)", async () => {
      const foreignOrgId = randomUUID();
      await ctx.db.insert(schema.organizations).values({
        id: foreignOrgId,
        name: "Foreign org 2",
        displayName: "Foreign org 2",
        slug: `foreign2-${uniquePrefix()}`,
      });
      const foreignCourseId = randomUUID();
      await ctx.db.insert(schema.courses).values({
        id: foreignCourseId,
        organizationId: foreignOrgId,
        name: "Foreign course",
        code: `FC-${uniquePrefix()}`,
        description: "",
      });
      const foreignExamId = randomUUID();
      await ctx.db.insert(schema.exams).values({
        id: foreignExamId,
        organizationId: foreignOrgId,
        title: "Foreign exam",
        description: "",
        courseId: foreignCourseId,
        status: "open",
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(),
        closeAt: new Date(Date.now() + 86400_000),
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
      });
      // All three assignment routes share the same Exam scoped resolver, so a
      // cross-org exam must be hidden to each — not just GET. The title claims
      // "every route", so prove assign + revoke too.
      const getList = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/exams/${foreignExamId}/proctors`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(getList.statusCode).toBe(404);
      expect(getList.json().error.code).toBe("RESOURCE_NOT_FOUND");

      const postAssign = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/exams/${foreignExamId}/proctors`,
        cookies: { "auth-token": ctx.adminToken },
        payload: { operationId: opId(), proctorUserId },
      });
      expect(postAssign.statusCode).toBe(404);
      expect(postAssign.json().error.code).toBe("RESOURCE_NOT_FOUND");

      const postRevoke = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/exams/${foreignExamId}/proctors/${proctorUserId}/revoke`,
        cookies: { "auth-token": ctx.adminToken },
        payload: { operationId: opId() },
      });
      expect(postRevoke.statusCode).toBe(404);
      expect(postRevoke.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });
  });
});
