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
import { adminGraderAssignmentRoutes } from "./graderAssignments.admin.js";

const plugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(adminGraderAssignmentRoutes);
};

/** Minimal draft exam row (assignment target; grading scope carrier). */
function examRow(orgId: string, courseId: string, title: string) {
  const now = new Date();
  return {
    id: randomUUID(),
    organizationId: orgId,
    title,
    description: "",
    courseId,
    status: "draft",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: now,
    closeAt: new Date(now.getTime() + 86_400_000),
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
      showResultImmediately: false,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
  };
}

describe("Admin grader-to-exam assignment API (issue #296)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let graderUserId: string;
  let graderToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(plugin);

    const now = new Date();
    const courseId = randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Grader assignment course",
      code: `GAC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    const exam = examRow(ctx.org.id, courseId, "Grader assignment exam");
    examId = exam.id;
    await ctx.db.insert(schema.exams).values(exam);

    // Grader WITH an active Grader role (qualifies for assignment).
    const grader = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Grader",
      "exam-assignment-target",
    );
    graderUserId = grader.user.id;
    graderToken = grader.token;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  const assign = (userId: string, eid: string = examId) =>
    ctx.app.inject({
      method: "POST",
      url: `/api/admin/users/${userId}/exam-assignments`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { examId: eid },
    });

  const list = (userId: string, query = "") =>
    ctx.app.inject({
      method: "GET",
      url: `/api/admin/users/${userId}/exam-assignments${query}`,
      cookies: { "auth-token": ctx.adminToken },
    });

  const revoke = (userId: string, eid: string = examId) =>
    ctx.app.inject({
      method: "POST",
      url: `/api/admin/users/${userId}/exam-assignments/${eid}/revoke`,
      cookies: { "auth-token": ctx.adminToken },
    });

  it("Admin assign → applied, active episode, atomic audit written", async () => {
    const res = await assign(graderUserId);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.outcome).toBe("applied");
    expect(body.assignment).toMatchObject({
      graderUserId,
      examId,
      status: "active",
      assignedBy: ctx.admin.id,
    });
    expect(body.assignment.revokedAt).toBeNull();

    const audit = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "exam.grader_assigned"),
          eq(schema.auditLogs.targetId, examId),
        ),
      );
    expect(audit.length).toBe(1);
    expect(audit[0]!.metadata).toMatchObject({
      examId,
      graderUserId,
      assignmentId: body.assignment.id,
    });
  });

  it("Admin duplicate assign → no_change, single episode, no extra audit", async () => {
    const auditBefore = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "exam.grader_assigned"));
    const res = await assign(graderUserId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().outcome).toBe("no_change");

    const episodes = await ctx.db
      .select()
      .from(schema.graderExamAssignments)
      .where(
        and(
          eq(schema.graderExamAssignments.organizationId, ctx.org.id),
          eq(schema.graderExamAssignments.graderUserId, graderUserId),
          eq(schema.graderExamAssignments.examId, examId),
        ),
      );
    expect(episodes).toHaveLength(1);
    const auditAfter = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "exam.grader_assigned"));
    expect(auditAfter.length).toBe(auditBefore.length);
  });

  it("target without an active Grader role → 400 VALIDATION_ERROR", async () => {
    const teacher = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "not-a-grader",
    );
    const res = await assign(teacher.user.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("inactive target user → 400 VALIDATION_ERROR", async () => {
    const inactive = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Grader",
      "inactive-grader",
      { isActive: false },
    );
    const res = await assign(inactive.user.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("unknown target user → 404 RESOURCE_NOT_FOUND", async () => {
    const res = await assign(randomUUID());
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("cross-organization target user is hidden → 404 RESOURCE_NOT_FOUND", async () => {
    const foreignOrgId = randomUUID();
    await ctx.db.insert(schema.organizations).values({
      id: foreignOrgId,
      name: "Foreign org",
      displayName: "Foreign org",
      slug: `foreign-ga-${uniquePrefix()}`,
    });
    const foreign = await createAssignedUserForTest(
      ctx.db,
      foreignOrgId,
      "Grader",
      "foreign-grader",
    );
    const res = await assign(foreign.user.id);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("cross-organization exam is hidden → 404 RESOURCE_NOT_FOUND", async () => {
    const foreignOrgId = randomUUID();
    await ctx.db.insert(schema.organizations).values({
      id: foreignOrgId,
      name: "Foreign org 2",
      displayName: "Foreign org 2",
      slug: `foreign2-ga-${uniquePrefix()}`,
    });
    const now = new Date();
    const foreignCourseId = randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: foreignCourseId,
      organizationId: foreignOrgId,
      name: "Foreign course",
      code: `FCG-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    const foreignExam = examRow(foreignOrgId, foreignCourseId, "Foreign exam");
    await ctx.db.insert(schema.exams).values(foreignExam);
    const res = await assign(graderUserId, foreignExam.id);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("revoke → applied + atomic audit; second revoke → 404; re-assign opens a NEW episode", async () => {
    const other = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Grader",
      "revoke-target",
    );
    const otherExam = examRow(
      ctx.org.id,
      (
        await ctx.db
          .select()
          .from(schema.courses)
          .where(eq(schema.courses.organizationId, ctx.org.id))
      )[0]!.id,
      "Revoke exam",
    );
    await ctx.db.insert(schema.exams).values(otherExam);
    const assigned = await assign(other.user.id, otherExam.id);
    expect(assigned.json().outcome).toBe("applied");

    const res = await revoke(other.user.id, otherExam.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      outcome: "applied",
      assignment: { status: "revoked", examId: otherExam.id },
    });

    const audit = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "exam.grader_revoked"),
          eq(schema.auditLogs.targetId, otherExam.id),
        ),
      );
    expect(audit.length).toBe(1);

    const again = await revoke(other.user.id, otherExam.id);
    expect(again.statusCode).toBe(404);
    expect(again.json().error.code).toBe("RESOURCE_NOT_FOUND");

    const reassigned = await assign(other.user.id, otherExam.id);
    expect(reassigned.statusCode, reassigned.body).toBe(200);
    expect(reassigned.json().outcome).toBe("applied");
    const episodes = await ctx.db
      .select()
      .from(schema.graderExamAssignments)
      .where(
        and(
          eq(schema.graderExamAssignments.organizationId, ctx.org.id),
          eq(schema.graderExamAssignments.graderUserId, other.user.id),
          eq(schema.graderExamAssignments.examId, otherExam.id),
        ),
      );
    expect(episodes).toHaveLength(2);
  });

  it("list defaults to active; status=all includes revoked episodes", async () => {
    const res = await list(graderUserId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0]).toMatchObject({ examId, status: "active" });

    const all = await list(graderUserId, "?status=all");
    expect(all.statusCode).toBe(200);
    expect(all.json().items.length).toBeGreaterThanOrEqual(1);
  });

  it("Grader token cannot manage or view assignments (Admin-only permissions) → 403", async () => {
    const managed = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/users/${graderUserId}/exam-assignments`,
      cookies: { "auth-token": graderToken },
      payload: { examId },
    });
    expect(managed.statusCode).toBe(403);

    const viewed = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/users/${graderUserId}/exam-assignments`,
      cookies: { "auth-token": graderToken },
    });
    expect(viewed.statusCode).toBe(403);
  });

  it("unauthenticated request → 401", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/users/${graderUserId}/exam-assignments`,
    });
    expect(res.statusCode).toBe(401);
  });
});
