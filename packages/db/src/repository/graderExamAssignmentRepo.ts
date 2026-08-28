import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import { graderExamAssignments } from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import { resolveOrganizationId } from "./baseRepo.js";

export type GraderExamAssignmentRow = typeof graderExamAssignments.$inferSelect;

export interface InsertGraderExamAssignmentInput {
  graderUserId: string;
  examId: string;
  assignedBy: string;
  assignedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RevokeGraderExamAssignmentInput {
  revokedBy: string;
  revokedAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped repository for the Grader-to-Exam assignment aggregate
 * (issue #296). Every method filters by `ctx.organizationId` (fail closed
 * on cross-organization rows); user/exam same-organization consistency is
 * enforced by the route command layer (plain `users(id)` / composite
 * `exams(organization_id, id)` FKs, mirroring the teacher_course_assignments
 * convention).
 *
 * Episode semantics: at most one ACTIVE episode per (organization, grader,
 * exam) — enforced by the `grader_exam_assignments_active_unique` partial
 * unique index. Revoked episodes remain as history. There is no
 * operation-receipt table: assignment is an Admin configuration surface with
 * deterministic outcome contracts (assign-active → no_change handled by the
 * caller; revoke-without-active → null from {@link resolveRevokeTarget}).
 */
export function createGraderExamAssignmentRepo(db: Database) {
  async function insertAssignment(
    ctx: TenantContext | RequestContext,
    input: InsertGraderExamAssignmentInput,
  ): Promise<GraderExamAssignmentRow> {
    const rows = await db
      .insert(graderExamAssignments)
      .values({
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        graderUserId: input.graderUserId,
        examId: input.examId,
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

  async function findActiveByGraderAndExam(
    ctx: TenantContext | RequestContext,
    graderUserId: string,
    examId: string,
  ): Promise<GraderExamAssignmentRow | null> {
    const rows = await db
      .select()
      .from(graderExamAssignments)
      .where(
        and(
          eq(graderExamAssignments.organizationId, resolveOrganizationId(ctx)),
          eq(graderExamAssignments.graderUserId, graderUserId),
          eq(graderExamAssignments.examId, examId),
          eq(graderExamAssignments.status, "active"),
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
    graderUserId: string,
    examId: string,
    forUpdate: boolean,
  ): Promise<GraderExamAssignmentRow | null> {
    const query = db
      .select()
      .from(graderExamAssignments)
      .where(
        and(
          eq(graderExamAssignments.organizationId, resolveOrganizationId(ctx)),
          eq(graderExamAssignments.graderUserId, graderUserId),
          eq(graderExamAssignments.examId, examId),
          eq(graderExamAssignments.status, "active"),
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
    input: RevokeGraderExamAssignmentInput,
  ): Promise<GraderExamAssignmentRow | null> {
    const rows = await db
      .update(graderExamAssignments)
      .set({
        status: "revoked",
        revokedBy: input.revokedBy,
        revokedAt: input.revokedAt,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(graderExamAssignments.organizationId, resolveOrganizationId(ctx)),
          eq(graderExamAssignments.id, assignmentId),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * All episodes for (organization, grader) ordered by newest first
   * (stable (assigned_at DESC, id DESC)). Backs the Admin assignment API
   * list; the caller filters by status when requested.
   */
  async function listByGrader(
    ctx: TenantContext | RequestContext,
    graderUserId: string,
  ): Promise<GraderExamAssignmentRow[]> {
    return db
      .select()
      .from(graderExamAssignments)
      .where(
        and(
          eq(graderExamAssignments.organizationId, resolveOrganizationId(ctx)),
          eq(graderExamAssignments.graderUserId, graderUserId),
        ),
      )
      .orderBy(
        desc(graderExamAssignments.assignedAt),
        desc(graderExamAssignments.id),
      );
  }

  /**
   * The grader's ACTIVE assigned exam ids — the resource scope for LIST
   * filtering and the direct-ID gate. Empty array = assigned to nothing.
   */
  async function listActiveExamIdsByGrader(
    ctx: TenantContext | RequestContext,
    graderUserId: string,
  ): Promise<string[]> {
    const rows = await db
      .select({ examId: graderExamAssignments.examId })
      .from(graderExamAssignments)
      .where(
        and(
          eq(graderExamAssignments.organizationId, resolveOrganizationId(ctx)),
          eq(graderExamAssignments.graderUserId, graderUserId),
          eq(graderExamAssignments.status, "active"),
        ),
      );
    return rows.map((r) => r.examId);
  }

  /** hasActiveAssignment — boolean gate for the per-request Grader scope check. */
  async function hasActiveAssignment(
    ctx: TenantContext | RequestContext,
    examId: string,
    graderUserId: string,
  ): Promise<boolean> {
    const row = await findActiveByGraderAndExam(ctx, graderUserId, examId);
    return row != null;
  }

  /** Count of active assignments for an exam (Admin reverse surface). */
  async function countActiveByExam(
    ctx: TenantContext | RequestContext,
    examId: string,
  ): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(graderExamAssignments)
      .where(
        and(
          eq(graderExamAssignments.organizationId, resolveOrganizationId(ctx)),
          eq(graderExamAssignments.examId, examId),
          eq(graderExamAssignments.status, "active"),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Deletes EVERY episode (active + revoked) for an exam, scoped to the
   * tenant. Used inside the exam-delete transaction: the composite exam FK
   * would otherwise block deletion once any episode exists. Episode history
   * for a deleted exam is meaningless; the compliance record lives in
   * audit_logs.
   */
  async function deleteByExam(
    ctx: TenantContext | RequestContext,
    examId: string,
  ): Promise<void> {
    await db
      .delete(graderExamAssignments)
      .where(
        and(
          eq(graderExamAssignments.organizationId, resolveOrganizationId(ctx)),
          eq(graderExamAssignments.examId, examId),
        ),
      );
  }

  return {
    insertAssignment,
    findActiveByGraderAndExam,
    resolveRevokeTarget,
    revokeAssignment,
    listByGrader,
    listActiveExamIdsByGrader,
    hasActiveAssignment,
    countActiveByExam,
    deleteByExam,
  };
}

export type GraderExamAssignmentRepo = ReturnType<
  typeof createGraderExamAssignmentRepo
>;
