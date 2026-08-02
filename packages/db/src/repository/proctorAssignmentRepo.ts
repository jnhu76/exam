import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  examProctorAssignmentEvents,
  examProctorAssignments,
} from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import { resolveOrganizationId } from "./baseRepo.js";

export type ExamProctorAssignmentRow =
  typeof examProctorAssignments.$inferSelect;
export type ExamProctorAssignmentEventRow =
  typeof examProctorAssignmentEvents.$inferSelect;

export type AssignmentStatusFilter = "active" | "revoked" | "all";

export interface ListExamProctorsParams {
  status: AssignmentStatusFilter;
  limit: number;
  /** Opaque keyset cursor: `"<createdAtISO>|<id>"` (stable (created_at, id) order). */
  cursor?: string | null;
}

export interface InsertAssignmentInput {
  examId: string;
  proctorUserId: string;
  assignedBy: string;
  assignedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppendProctorAssignmentEventInput {
  assignmentId: string;
  commandType: "assign" | "revoke";
  operationId: string;
  canonicalPayload: Record<string, unknown>;
  outcome: "applied" | "no_change";
  actorId: string;
  createdAt: Date;
}

export interface RevokeAssignmentInput {
  revokedBy: string;
  revokedAt: Date;
  updatedAt: Date;
}

/** Row + event lookup result used by the engine commands and recovery. */
export interface OperationReceiptLookup {
  assignmentId: string;
  commandType: string;
  canonicalPayload: Record<string, unknown>;
}

/**
 * Tenant-scoped repository for the Proctor-to-Exam assignment aggregate
 * (ADR-015 §4). Every method filters by `ctx.organizationId` (fail closed on
 * cross-organization rows); user-to-organization consistency is enforced by
 * the command layer (plain `users(id)` FKs, ADR-015 §15).
 */
export function createProctorAssignmentRepo(db: Database) {
  // ── Episodes ──

  async function insertAssignment(
    ctx: TenantContext | RequestContext,
    input: InsertAssignmentInput,
  ): Promise<ExamProctorAssignmentRow> {
    const rows = await db
      .insert(examProctorAssignments)
      .values({
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        examId: input.examId,
        proctorUserId: input.proctorUserId,
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

  async function findById(
    ctx: TenantContext | RequestContext,
    assignmentId: string,
  ): Promise<ExamProctorAssignmentRow | null> {
    const rows = await db
      .select()
      .from(examProctorAssignments)
      .where(
        and(
          eq(examProctorAssignments.organizationId, resolveOrganizationId(ctx)),
          eq(examProctorAssignments.id, assignmentId),
        ),
      );
    return rows[0] ?? null;
  }

  /**
   * The active episode, optionally restricted to the recovery race window
   * (`createdBefore` — episodes created at/after the bound are never matched;
   * ADR-015 §7 amendment).
   */
  async function findActiveByExamAndProctor(
    ctx: TenantContext | RequestContext,
    examId: string,
    proctorUserId: string,
    opts?: { createdBefore?: Date },
  ): Promise<ExamProctorAssignmentRow | null> {
    const conditions = [
      eq(examProctorAssignments.organizationId, resolveOrganizationId(ctx)),
      eq(examProctorAssignments.examId, examId),
      eq(examProctorAssignments.proctorUserId, proctorUserId),
      eq(examProctorAssignments.status, "active"),
    ];
    if (opts?.createdBefore) {
      conditions.push(
        sql`${examProctorAssignments.createdAt} < ${opts.createdBefore.toISOString()}::timestamptz`,
      );
    }
    const rows = await db
      .select()
      .from(examProctorAssignments)
      .where(and(...conditions));
    return rows[0] ?? null;
  }

  /**
   * Most-recent episode of ANY status for (org, exam, proctor) by the frozen
   * order `(created_at DESC, id DESC)`. The §7 loser-receipt recovery falls
   * back to this when the winning episode was already revoked before its
   * fresh read, so the loser still forms its receipt against the episode
   * that caused the collision. `createdBefore` restricts the lookup to the
   * recovery's race window — a reassignment round created after the bound is
   * never referenced.
   */
  async function findMostRecentEpisodeByExamAndProctor(
    ctx: TenantContext | RequestContext,
    examId: string,
    proctorUserId: string,
    opts?: { createdBefore?: Date },
  ): Promise<ExamProctorAssignmentRow | null> {
    const conditions = [
      eq(examProctorAssignments.organizationId, resolveOrganizationId(ctx)),
      eq(examProctorAssignments.examId, examId),
      eq(examProctorAssignments.proctorUserId, proctorUserId),
    ];
    if (opts?.createdBefore) {
      conditions.push(
        sql`${examProctorAssignments.createdAt} < ${opts.createdBefore.toISOString()}::timestamptz`,
      );
    }
    const rows = await db
      .select()
      .from(examProctorAssignments)
      .where(and(...conditions))
      .orderBy(
        sql`${examProctorAssignments.createdAt} DESC`,
        sql`${examProctorAssignments.id} DESC`,
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Most-recent revoked episode for (org, exam, proctor) by the frozen
   * tie-break `(revoked_at DESC, id DESC)` (ADR-015 §6). The
   * `exam_proctor_assignments_revoke_target_idx` index covers this query.
   */
  async function findMostRecentRevoked(
    ctx: TenantContext | RequestContext,
    examId: string,
    proctorUserId: string,
  ): Promise<ExamProctorAssignmentRow | null> {
    const rows = await db
      .select()
      .from(examProctorAssignments)
      .where(
        and(
          eq(examProctorAssignments.organizationId, resolveOrganizationId(ctx)),
          eq(examProctorAssignments.examId, examId),
          eq(examProctorAssignments.proctorUserId, proctorUserId),
          eq(examProctorAssignments.status, "revoked"),
        ),
      )
      .orderBy(
        sql`${examProctorAssignments.revokedAt} DESC`,
        sql`${examProctorAssignments.id} DESC`,
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Revoke target resolution: the active episode if one exists, otherwise the
   * most-recent revoked episode. `forUpdate` is used by the revoke command to
   * serialize against concurrent revokes on the same episode (ADR-015 §21).
   */
  async function resolveRevokeTarget(
    ctx: TenantContext | RequestContext,
    examId: string,
    proctorUserId: string,
    forUpdate: boolean,
  ): Promise<ExamProctorAssignmentRow | null> {
    const base = (rows: ExamProctorAssignmentRow[]) => rows[0] ?? null;
    const orgId = resolveOrganizationId(ctx);
    if (forUpdate) {
      const active = await db
        .select()
        .from(examProctorAssignments)
        .where(
          and(
            eq(examProctorAssignments.organizationId, orgId),
            eq(examProctorAssignments.examId, examId),
            eq(examProctorAssignments.proctorUserId, proctorUserId),
            eq(examProctorAssignments.status, "active"),
          ),
        )
        .for("update");
      if (active[0]) return active[0];
      const revoked = await db
        .select()
        .from(examProctorAssignments)
        .where(
          and(
            eq(examProctorAssignments.organizationId, orgId),
            eq(examProctorAssignments.examId, examId),
            eq(examProctorAssignments.proctorUserId, proctorUserId),
            eq(examProctorAssignments.status, "revoked"),
          ),
        )
        .orderBy(
          sql`${examProctorAssignments.revokedAt} DESC`,
          sql`${examProctorAssignments.id} DESC`,
        )
        .limit(1)
        .for("update");
      return base(revoked);
    }
    return (
      (await findActiveByExamAndProctor(ctx, examId, proctorUserId)) ??
      (await findMostRecentRevoked(ctx, examId, proctorUserId))
    );
  }

  async function revokeAssignment(
    ctx: TenantContext | RequestContext,
    assignmentId: string,
    input: RevokeAssignmentInput,
  ): Promise<ExamProctorAssignmentRow | null> {
    const rows = await db
      .update(examProctorAssignments)
      .set({
        status: "revoked",
        revokedBy: input.revokedBy,
        revokedAt: input.revokedAt,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(examProctorAssignments.organizationId, resolveOrganizationId(ctx)),
          eq(examProctorAssignments.id, assignmentId),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  // ── Events (append-only receipts) ──

  async function appendEvent(
    ctx: TenantContext | RequestContext,
    input: AppendProctorAssignmentEventInput,
  ): Promise<ExamProctorAssignmentEventRow> {
    const rows = await db
      .insert(examProctorAssignmentEvents)
      .values({
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        assignmentId: input.assignmentId,
        commandType: input.commandType,
        operationId: input.operationId,
        canonicalPayload: input.canonicalPayload,
        outcome: input.outcome,
        actorId: input.actorId,
        createdAt: input.createdAt,
      })
      .returning();
    return rows[0]!;
  }

  async function findEventByOperationId(
    ctx: TenantContext | RequestContext,
    operationId: string,
  ): Promise<ExamProctorAssignmentEventRow | null> {
    const rows = await db
      .select()
      .from(examProctorAssignmentEvents)
      .where(
        and(
          eq(
            examProctorAssignmentEvents.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(examProctorAssignmentEvents.operationId, operationId),
        ),
      );
    return rows[0] ?? null;
  }

  /** Operation-receipt projection for the recovery fresh-transaction lookup. */
  async function findReceiptByOperationId(
    ctx: TenantContext | RequestContext,
    operationId: string,
  ): Promise<OperationReceiptLookup | null> {
    const row = await findEventByOperationId(ctx, operationId);
    return row
      ? {
          assignmentId: row.assignmentId,
          commandType: row.commandType,
          canonicalPayload: row.canonicalPayload as Record<string, unknown>,
        }
      : null;
  }

  // ── Read commands (ADR-015 §5) ──

  /**
   * listExamProctors — keyset-paginated episode list for one exam, ordered by
   * `(created_at, id)`. `status='active'` (default) | `'revoked'` | `'all'`;
   * history statuses are Admin-only at the API layer.
   */
  async function listExamProctors(
    ctx: TenantContext | RequestContext,
    examId: string,
    params: ListExamProctorsParams,
  ): Promise<{ items: ExamProctorAssignmentRow[]; nextCursor: string | null }> {
    const conditions = [
      eq(examProctorAssignments.organizationId, resolveOrganizationId(ctx)),
      eq(examProctorAssignments.examId, examId),
    ];
    if (params.status !== "all") {
      conditions.push(eq(examProctorAssignments.status, params.status));
    }
    if (params.cursor) {
      const [createdAtIso, id] = params.cursor.split("|");
      const cursorCreatedAt = new Date(createdAtIso!).toISOString();
      // Keyset predicate on (created_at, id): strictly after the cursor row.
      conditions.push(
        sql`(
          ${examProctorAssignments.createdAt} > ${cursorCreatedAt}::timestamptz
          OR (
            ${examProctorAssignments.createdAt} = ${cursorCreatedAt}::timestamptz
            AND ${examProctorAssignments.id} > ${id}
          )
        )`,
      );
    }
    const rows = await db
      .select()
      .from(examProctorAssignments)
      .where(and(...conditions))
      .orderBy(
        asc(examProctorAssignments.createdAt),
        asc(examProctorAssignments.id),
      )
      .limit(params.limit + 1);
    const items = rows.slice(0, params.limit);
    const nextCursor =
      rows.length > params.limit && items.length > 0
        ? `${items[items.length - 1]!.createdAt.toISOString()}|${items[items.length - 1]!.id}`
        : null;
    return { items, nextCursor };
  }

  /** listProctorExams — active assignments for one proctor. */
  async function listProctorExams(
    ctx: TenantContext | RequestContext,
    proctorUserId: string,
  ): Promise<ExamProctorAssignmentRow[]> {
    return db
      .select()
      .from(examProctorAssignments)
      .where(
        and(
          eq(examProctorAssignments.organizationId, resolveOrganizationId(ctx)),
          eq(examProctorAssignments.proctorUserId, proctorUserId),
          eq(examProctorAssignments.status, "active"),
        ),
      )
      .orderBy(
        asc(examProctorAssignments.createdAt),
        asc(examProctorAssignments.id),
      );
  }

  /** getProctorExamAssignment — current active assignment or null. */
  async function getProctorExamAssignment(
    ctx: TenantContext | RequestContext,
    examId: string,
    proctorUserId: string,
  ): Promise<ExamProctorAssignmentRow | null> {
    return findActiveByExamAndProctor(ctx, examId, proctorUserId);
  }

  /** hasActiveAssignment — boolean gate for the per-request Proctor assignment check. */
  async function hasActiveAssignment(
    ctx: TenantContext | RequestContext,
    examId: string,
    proctorUserId: string,
  ): Promise<boolean> {
    const row = await findActiveByExamAndProctor(ctx, examId, proctorUserId);
    return row != null;
  }

  return {
    insertAssignment,
    findById,
    findActiveByExamAndProctor,
    findMostRecentEpisodeByExamAndProctor,
    findMostRecentRevoked,
    resolveRevokeTarget,
    revokeAssignment,
    appendEvent,
    findEventByOperationId,
    findReceiptByOperationId,
    listExamProctors,
    listProctorExams,
    getProctorExamAssignment,
    hasActiveAssignment,
  };
}

export type ProctorAssignmentRepo = ReturnType<
  typeof createProctorAssignmentRepo
>;
