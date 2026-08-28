import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import { teacherCourseAssignments } from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import { resolveOrganizationId } from "./baseRepo.js";

export type TeacherCourseAssignmentRow =
  typeof teacherCourseAssignments.$inferSelect;

export interface InsertTeacherCourseAssignmentInput {
  teacherUserId: string;
  courseId: string;
  assignedBy: string;
  assignedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RevokeTeacherCourseAssignmentInput {
  revokedBy: string;
  revokedAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped repository for the Teacher-to-Course assignment aggregate
 * (issue #286 §3A). Every method filters by `ctx.organizationId` (fail closed
 * on cross-organization rows); user/course same-organization consistency is
 * enforced by the route command layer (plain `users(id)` / composite
 * `courses(organization_id, id)` FKs, mirroring ADR-015 §15).
 *
 * Episode semantics: at most one ACTIVE episode per (organization, teacher,
 * course) — enforced by the `teacher_course_assignments_active_unique`
 * partial unique index. Revoked episodes remain as history. There is no
 * operation-receipt table: assignment is an Admin configuration surface with
 * deterministic outcome contracts (assign-active → no_change handled by the
 * caller; revoke-without-active → null from {@link resolveRevokeTarget}).
 */
export function createTeacherCourseAssignmentRepo(db: Database) {
  async function insertAssignment(
    ctx: TenantContext | RequestContext,
    input: InsertTeacherCourseAssignmentInput,
  ): Promise<TeacherCourseAssignmentRow> {
    const rows = await db
      .insert(teacherCourseAssignments)
      .values({
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        teacherUserId: input.teacherUserId,
        courseId: input.courseId,
        status: "active",
        assignedBy: input.assignedBy,
        assignedAt: input.assignedAt,
        revokedBy: null,
        revokedAt: null,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      })
      .returning();
    return rows[0]!;
  }

  async function findActiveByTeacherAndCourse(
    ctx: TenantContext | RequestContext,
    teacherUserId: string,
    courseId: string,
  ): Promise<TeacherCourseAssignmentRow | null> {
    const rows = await db
      .select()
      .from(teacherCourseAssignments)
      .where(
        and(
          eq(
            teacherCourseAssignments.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(teacherCourseAssignments.teacherUserId, teacherUserId),
          eq(teacherCourseAssignments.courseId, courseId),
          eq(teacherCourseAssignments.status, "active"),
        ),
      );
    return rows[0] ?? null;
  }

  /**
   * Revoke target resolution: the active episode if one exists, otherwise
   * null. `forUpdate` serializes concurrent assign/revoke on the same triple
   * inside the caller's transaction (the partial unique index is the second
   * line of defense).
   */
  async function resolveRevokeTarget(
    ctx: TenantContext | RequestContext,
    teacherUserId: string,
    courseId: string,
    forUpdate: boolean,
  ): Promise<TeacherCourseAssignmentRow | null> {
    const query = db
      .select()
      .from(teacherCourseAssignments)
      .where(
        and(
          eq(
            teacherCourseAssignments.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(teacherCourseAssignments.teacherUserId, teacherUserId),
          eq(teacherCourseAssignments.courseId, courseId),
          eq(teacherCourseAssignments.status, "active"),
        ),
      );
    if (forUpdate) {
      const rows = await query.for("update");
      return rows[0] ?? null;
    }
    const rows = await query;
    return rows[0] ?? null;
  }

  async function revokeAssignment(
    ctx: TenantContext | RequestContext,
    assignmentId: string,
    input: RevokeTeacherCourseAssignmentInput,
  ): Promise<TeacherCourseAssignmentRow | null> {
    const rows = await db
      .update(teacherCourseAssignments)
      .set({
        status: "revoked",
        revokedBy: input.revokedBy,
        revokedAt: input.revokedAt,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(
            teacherCourseAssignments.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(teacherCourseAssignments.id, assignmentId),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * All episodes for (organization, teacher) ordered by newest first
   * (stable (assigned_at DESC, id DESC)). Backs the Admin assignment API
   * list; the caller filters by status when requested.
   */
  async function listByTeacher(
    ctx: TenantContext | RequestContext,
    teacherUserId: string,
  ): Promise<TeacherCourseAssignmentRow[]> {
    return db
      .select()
      .from(teacherCourseAssignments)
      .where(
        and(
          eq(
            teacherCourseAssignments.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(teacherCourseAssignments.teacherUserId, teacherUserId),
        ),
      )
      .orderBy(
        desc(teacherCourseAssignments.assignedAt),
        desc(teacherCourseAssignments.id),
      );
  }

  /**
   * The teacher's ACTIVE assigned course ids — the resource scope for LIST
   * filtering and the direct-ID gate. Empty array = assigned to nothing.
   */
  async function listActiveCourseIdsByTeacher(
    ctx: TenantContext | RequestContext,
    teacherUserId: string,
  ): Promise<string[]> {
    const rows = await db
      .select({ courseId: teacherCourseAssignments.courseId })
      .from(teacherCourseAssignments)
      .where(
        and(
          eq(
            teacherCourseAssignments.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(teacherCourseAssignments.teacherUserId, teacherUserId),
          eq(teacherCourseAssignments.status, "active"),
        ),
      );
    return rows.map((r) => r.courseId);
  }

  /** hasActiveAssignment — boolean gate for the per-request Teacher scope check. */
  async function hasActiveAssignment(
    ctx: TenantContext | RequestContext,
    courseId: string,
    teacherUserId: string,
  ): Promise<boolean> {
    const row = await findActiveByTeacherAndCourse(
      ctx,
      teacherUserId,
      courseId,
    );
    return row != null;
  }

  /** Count of active assignments for a course (Admin reverse surface). */
  async function countActiveByCourse(
    ctx: TenantContext | RequestContext,
    courseId: string,
  ): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(teacherCourseAssignments)
      .where(
        and(
          eq(
            teacherCourseAssignments.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(teacherCourseAssignments.courseId, courseId),
          eq(teacherCourseAssignments.status, "active"),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  return {
    insertAssignment,
    findActiveByTeacherAndCourse,
    resolveRevokeTarget,
    revokeAssignment,
    listByTeacher,
    listActiveCourseIdsByTeacher,
    hasActiveAssignment,
    countActiveByCourse,
  };
}

export type TeacherCourseAssignmentRepo = ReturnType<
  typeof createTeacherCourseAssignmentRepo
>;
