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
import { adminTeacherAssignmentRoutes } from "./teacherAssignments.admin.js";

const plugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(adminTeacherAssignmentRoutes);
};

describe("Admin teacher-to-course assignment API (issue #286)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let teacherUserId: string;
  let teacherToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(plugin);

    const now = new Date();
    courseId = randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Teacher assignment course",
      code: `TAC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });

    // Teacher WITH an active Teacher role (qualifies for assignment).
    const teacher = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "course-assignment-target",
    );
    teacherUserId = teacher.user.id;
    teacherToken = teacher.token;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  const assign = (userId: string, cid: string = courseId) =>
    ctx.app.inject({
      method: "POST",
      url: `/api/admin/users/${userId}/course-assignments`,
      cookies: { "auth-token": ctx.adminToken },
      payload: { courseId: cid },
    });

  const list = (userId: string, query = "") =>
    ctx.app.inject({
      method: "GET",
      url: `/api/admin/users/${userId}/course-assignments${query}`,
      cookies: { "auth-token": ctx.adminToken },
    });

  const revoke = (userId: string, cid: string = courseId) =>
    ctx.app.inject({
      method: "POST",
      url: `/api/admin/users/${userId}/course-assignments/${cid}/revoke`,
      cookies: { "auth-token": ctx.adminToken },
    });

  it("Admin assign → applied, active episode, atomic audit written", async () => {
    const res = await assign(teacherUserId);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.outcome).toBe("applied");
    expect(body.assignment).toMatchObject({
      teacherUserId,
      courseId,
      status: "active",
      assignedBy: ctx.admin.id,
    });
    expect(body.assignment.revokedAt).toBeNull();

    const audit = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "course.teacher_assigned"),
          eq(schema.auditLogs.targetId, courseId),
        ),
      );
    expect(audit.length).toBe(1);
    expect(audit[0]!.metadata).toMatchObject({
      courseId,
      teacherUserId,
      assignmentId: body.assignment.id,
    });
  });

  it("Admin duplicate assign → no_change, single episode, no extra audit", async () => {
    const auditBefore = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "course.teacher_assigned"));
    const res = await assign(teacherUserId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().outcome).toBe("no_change");

    const episodes = await ctx.db
      .select()
      .from(schema.teacherCourseAssignments)
      .where(
        and(
          eq(schema.teacherCourseAssignments.organizationId, ctx.org.id),
          eq(schema.teacherCourseAssignments.teacherUserId, teacherUserId),
          eq(schema.teacherCourseAssignments.courseId, courseId),
        ),
      );
    expect(episodes).toHaveLength(1);
    const auditAfter = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "course.teacher_assigned"));
    expect(auditAfter.length).toBe(auditBefore.length);
  });

  it("target without an active Teacher role → 400 VALIDATION_ERROR", async () => {
    const admin2 = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Admin",
      "not-a-teacher",
    );
    const res = await assign(admin2.user.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("inactive target user → 400 VALIDATION_ERROR", async () => {
    const inactive = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "inactive-teacher",
      { isActive: false },
    );
    const res = await assign(inactive.user.id);
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
    const foreign = await createAssignedUserForTest(
      ctx.db,
      foreignOrgId,
      "Teacher",
      "foreign-teacher",
    );
    const res = await assign(foreign.user.id);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("cross-organization course is hidden → 404 RESOURCE_NOT_FOUND", async () => {
    const foreignOrgId = randomUUID();
    await ctx.db.insert(schema.organizations).values({
      id: foreignOrgId,
      name: "Foreign org 2",
      displayName: "Foreign org 2",
      slug: `foreign2-${uniquePrefix()}`,
    });
    const now = new Date();
    const foreignCourseId = randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: foreignCourseId,
      organizationId: foreignOrgId,
      name: "Foreign course",
      code: `FC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    const res = await assign(teacherUserId, foreignCourseId);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("revoke → applied + atomic audit; second revoke → 404", async () => {
    const other = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "revoke-target",
    );
    const otherCourseId = randomUUID();
    const now = new Date();
    await ctx.db.insert(schema.courses).values({
      id: otherCourseId,
      organizationId: ctx.org.id,
      name: "Revoke course",
      code: `RC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    const assigned = await assign(other.user.id, otherCourseId);
    expect(assigned.json().outcome).toBe("applied");

    const res = await revoke(other.user.id, otherCourseId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      outcome: "applied",
      assignment: { status: "revoked", courseId: otherCourseId },
    });

    const audit = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "course.teacher_revoked"),
          eq(schema.auditLogs.targetId, otherCourseId),
        ),
      );
    expect(audit.length).toBe(1);

    const again = await revoke(other.user.id, otherCourseId);
    expect(again.statusCode).toBe(404);
    expect(again.json().error.code).toBe("RESOURCE_NOT_FOUND");

    // Revocation enables re-assignment as a NEW episode; history is kept.
    const reassigned = await assign(other.user.id, otherCourseId);
    expect(reassigned.statusCode, reassigned.body).toBe(200);
    expect(reassigned.json().outcome).toBe("applied");
    const episodes = await ctx.db
      .select()
      .from(schema.teacherCourseAssignments)
      .where(
        and(
          eq(schema.teacherCourseAssignments.organizationId, ctx.org.id),
          eq(schema.teacherCourseAssignments.teacherUserId, other.user.id),
          eq(schema.teacherCourseAssignments.courseId, otherCourseId),
        ),
      );
    expect(episodes).toHaveLength(2);
  });

  it("list defaults to active; status=all includes revoked episodes", async () => {
    const res = await list(teacherUserId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0]).toMatchObject({ courseId, status: "active" });

    const all = await list(teacherUserId, "?status=all");
    expect(all.statusCode).toBe(200);
    expect(all.json().items.length).toBeGreaterThanOrEqual(1);
  });

  it("Teacher token cannot manage or view assignments (Admin-only permissions) → 403", async () => {
    const managed = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/users/${teacherUserId}/course-assignments`,
      cookies: { "auth-token": teacherToken },
      payload: { courseId },
    });
    expect(managed.statusCode).toBe(403);

    const viewed = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/users/${teacherUserId}/course-assignments`,
      cookies: { "auth-token": teacherToken },
    });
    expect(viewed.statusCode).toBe(403);
  });

  it("unauthenticated request → 401", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/users/${teacherUserId}/course-assignments`,
    });
    expect(res.statusCode).toBe(401);
  });
});
