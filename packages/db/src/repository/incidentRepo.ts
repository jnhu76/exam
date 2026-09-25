import { randomUUID } from "node:crypto";
import type {
  ExamIncident,
  ExamIncidentAction,
  ExamIncidentAttempt,
  ExamIncidentEvent,
  ExamIncidentInterruptionLink,
  IncidentActionType,
  IncidentEventType,
  IncidentRelationshipType,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  RequestContext,
} from "@exam/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  courses,
  examIncidentActions,
  examIncidentAttempts,
  examIncidentEvents,
  examIncidentInterruptionLinks,
  examIncidents,
  exams,
  organizations,
} from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import { resolveOrganizationId } from "./baseRepo.js";

export type ExamIncidentRow = typeof examIncidents.$inferSelect;
export type ExamIncidentEventRow = typeof examIncidentEvents.$inferSelect;
export type ExamIncidentActionRow = typeof examIncidentActions.$inferSelect;
export type ExamIncidentAttemptRow = typeof examIncidentAttempts.$inferSelect;
export type ExamIncidentInterruptionLinkRow =
  typeof examIncidentInterruptionLinks.$inferSelect;

export interface CreateIncidentInput {
  examId: string;
  attemptId?: string | null;
  candidateId?: string | null;
  type: IncidentType;
  severity?: IncidentSeverity;
  occurredAt?: Date | null;
  description: string;
  reportedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateIncidentInput {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  version?: number;
  resolutionSummary?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: Date | null;
  updatedAt?: Date;
}

export interface AppendEventInput {
  incidentId: string;
  eventType: IncidentEventType;
  commandType: string;
  operationId: string;
  actorId?: string | null;
  beforeVersion: number;
  afterVersion: number;
  payload?: Record<string, unknown>;
  createdAt: Date;
}

export interface InsertActionLinkInput {
  incidentId: string;
  actionType: IncidentActionType;
  actionId: string;
  attemptId: string;
  actorId?: string | null;
  operationId: string;
  linkedAt: Date;
}

export interface InsertAttemptMembershipInput {
  incidentId: string;
  attemptId: string;
  relationshipType: IncidentRelationshipType;
  linkedBy: string;
  operationId: string;
  linkedAt: Date;
}

export interface InsertInterruptionLinkInput {
  incidentId: string;
  attemptId: string;
  interruptionId: string;
  linkedBy: string;
  operationId: string;
  linkedAt: Date;
}

/**
 * One committed row per `(organization_id, operation_id)` on the
 * `exam_incident_events_org_operation_unique` arbiter. commandType and
 * payload ride along so the caller classifies completion with the engine's
 * `isMatchingCommittedOperation` — existence alone is never completion.
 */
export interface CommittedIncidentOperation {
  operationId: string;
  commandType: string;
  payload: Record<string, unknown>;
}

/**
 * Max operation ids bound into ONE probe statement. The bind protocol caps
 * parameters per statement (postgres.js throws client-side at >= 65534, so a
 * single unbounded IN list breaks reconciliation outright once an
 * organization's historical episode count crosses that boundary).
 *
 * Chunks are disjoint and `(organization_id, operation_id)` is unique on the
 * arbiter, so every matching arbiter row enters the map exactly once. Each
 * chunk executes under its own READ COMMITTED statement snapshot, so the
 * union is not a single point-in-time snapshot — and reconciliation does not
 * need one: a match any chunk observed is authoritative durable
 * completion evidence that safely suppresses delivery; an operation committed
 * after an earlier chunk's snapshot may be absent from the map, and delivery
 * re-validates it through the canonical operation-recovery pre-read (replay /
 * conflict / create) before writing; mismatched operationId occupancy still
 * surfaces as a conflict. Chunking therefore bounds transport parameters
 * without introducing a completion authority or a correctness dependency on
 * snapshot consistency.
 */
export const OPERATION_PROBE_BATCH = 10_000;

export function createIncidentRepo(db: Database) {
  // ── Incident CRUD ──

  async function insert(
    ctx: TenantContext | RequestContext,
    input: CreateIncidentInput,
  ): Promise<ExamIncidentRow> {
    const rows = await db
      .insert(examIncidents)
      .values({
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        examId: input.examId,
        attemptId: input.attemptId ?? null,
        candidateId: input.candidateId ?? null,
        type: input.type,
        severity: input.severity ?? "info",
        status: "open",
        occurredAt: input.occurredAt ?? null,
        description: input.description,
        resolutionSummary: null,
        resolvedAt: null,
        resolvedBy: null,
        reportedBy: input.reportedBy,
        version: 1,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      })
      .returning();
    return rows[0]!;
  }

  async function findById(
    ctx: TenantContext | RequestContext,
    incidentId: string,
  ): Promise<ExamIncidentRow | null> {
    const rows = await db
      .select()
      .from(examIncidents)
      .where(
        and(
          eq(examIncidents.organizationId, resolveOrganizationId(ctx)),
          eq(examIncidents.id, incidentId),
        ),
      );
    return rows[0] ?? null;
  }

  /**
   * Incident → Exam → Course → Organization authorization chain (J4-I1B,
   * ADR-015 §8). Tenant-scoped by the incident's org anchor; the parent-chain
   * org consistency (incident.org == exam.org == course.org == org) is
   * verified by the resolver.
   */
  async function findAuthorizationChain(
    ctx: TenantContext | RequestContext,
    incidentId: string,
  ) {
    const orgId = resolveOrganizationId(ctx);
    const rows = await db
      .select({
        incidentId: examIncidents.id,
        incidentOrganizationId: examIncidents.organizationId,
        linkedExamId: examIncidents.examId,
        examId: exams.id,
        examOrganizationId: exams.organizationId,
        linkedCourseId: exams.courseId,
        courseId: courses.id,
        courseOrganizationId: courses.organizationId,
        organizationId: organizations.id,
      })
      .from(examIncidents)
      .leftJoin(exams, eq(examIncidents.examId, exams.id))
      .leftJoin(courses, eq(exams.courseId, courses.id))
      .leftJoin(organizations, eq(courses.organizationId, organizations.id))
      .where(
        and(
          eq(examIncidents.organizationId, orgId),
          eq(examIncidents.id, incidentId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async function findByIdForUpdate(
    ctx: TenantContext | RequestContext,
    incidentId: string,
  ): Promise<ExamIncidentRow | null> {
    const rows = await db
      .select()
      .from(examIncidents)
      .where(
        and(
          eq(examIncidents.organizationId, resolveOrganizationId(ctx)),
          eq(examIncidents.id, incidentId),
        ),
      )
      .for("update");
    return rows[0] ?? null;
  }

  async function listByExam(
    ctx: TenantContext | RequestContext,
    examId: string,
    statusFilter?: IncidentStatus[],
  ): Promise<ExamIncidentRow[]> {
    const conditions = [
      eq(examIncidents.organizationId, resolveOrganizationId(ctx)),
      eq(examIncidents.examId, examId),
    ];
    if (statusFilter && statusFilter.length > 0) {
      conditions.push(inArray(examIncidents.status, statusFilter));
    }
    return db
      .select()
      .from(examIncidents)
      .where(and(...conditions))
      .orderBy(asc(examIncidents.createdAt), asc(examIncidents.id));
  }

  async function update(
    ctx: TenantContext | RequestContext,
    incidentId: string,
    input: UpdateIncidentInput,
  ): Promise<ExamIncidentRow | null> {
    const updates: Record<string, unknown> = {};
    if (input.status !== undefined) updates.status = input.status;
    if (input.severity !== undefined) updates.severity = input.severity;
    if (input.version !== undefined) updates.version = input.version;
    if (input.resolutionSummary !== undefined)
      updates.resolutionSummary = input.resolutionSummary;
    if (input.resolvedBy !== undefined) updates.resolvedBy = input.resolvedBy;
    if (input.resolvedAt !== undefined) updates.resolvedAt = input.resolvedAt;
    if (input.updatedAt !== undefined) updates.updatedAt = input.updatedAt;

    if (Object.keys(updates).length === 0) return findById(ctx, incidentId);

    const rows = await db
      .update(examIncidents)
      .set(updates)
      .where(
        and(
          eq(examIncidents.organizationId, resolveOrganizationId(ctx)),
          eq(examIncidents.id, incidentId),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  // ── Events ──

  async function appendEvent(
    ctx: TenantContext | RequestContext,
    input: AppendEventInput,
  ): Promise<ExamIncidentEventRow> {
    const rows = await db
      .insert(examIncidentEvents)
      .values({
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        incidentId: input.incidentId,
        eventType: input.eventType,
        commandType: input.commandType,
        operationId: input.operationId,
        actorId: input.actorId ?? null,
        beforeVersion: input.beforeVersion,
        afterVersion: input.afterVersion,
        payload: (input.payload ?? {}) as Record<string, unknown>,
        createdAt: input.createdAt,
      })
      .returning();
    return rows[0]!;
  }

  async function findEventByOperationId(
    ctx: TenantContext | RequestContext,
    operationId: string,
  ): Promise<ExamIncidentEventRow | null> {
    const rows = await db
      .select()
      .from(examIncidentEvents)
      .where(
        and(
          eq(examIncidentEvents.organizationId, resolveOrganizationId(ctx)),
          eq(examIncidentEvents.operationId, operationId),
        ),
      );
    return rows[0] ?? null;
  }

  /**
   * Batch probe of the `exam_incident_events_org_operation_unique` arbiter.
   * Returns each hit WITH its commandType and canonical payload
   * so the caller classifies completion through the engine's
   * `isMatchingCommittedOperation` (same command + same payload): a bare
   * operationId hit is NOT completion — an operation committed under the
   * same operationId with a different command/payload is a conflict that
   * must surface, never be silently skipped. Indexed by that unique; an
   * empty input short-circuits to an empty map. Link rows or incident
   * fields are never probed for this decision.
   */
  async function listCommittedOperations(
    ctx: TenantContext | RequestContext,
    operationIds: string[],
  ): Promise<Map<string, CommittedIncidentOperation>> {
    if (operationIds.length === 0) return new Map();
    const resolved = new Map<string, CommittedIncidentOperation>();
    for (
      let start = 0;
      start < operationIds.length;
      start += OPERATION_PROBE_BATCH
    ) {
      const rows = await db
        .select({
          operationId: examIncidentEvents.operationId,
          commandType: examIncidentEvents.commandType,
          payload: examIncidentEvents.payload,
        })
        .from(examIncidentEvents)
        .where(
          and(
            eq(examIncidentEvents.organizationId, resolveOrganizationId(ctx)),
            inArray(
              examIncidentEvents.operationId,
              operationIds.slice(start, start + OPERATION_PROBE_BATCH),
            ),
          ),
        );
      for (const row of rows) {
        resolved.set(row.operationId, {
          operationId: row.operationId,
          commandType: row.commandType,
          payload: row.payload as Record<string, unknown>,
        });
      }
    }
    return resolved;
  }

  async function listEventsByIncident(
    ctx: TenantContext | RequestContext,
    incidentId: string,
  ): Promise<ExamIncidentEventRow[]> {
    return db
      .select()
      .from(examIncidentEvents)
      .where(
        and(
          eq(examIncidentEvents.organizationId, resolveOrganizationId(ctx)),
          eq(examIncidentEvents.incidentId, incidentId),
        ),
      )
      .orderBy(asc(examIncidentEvents.eventSequence));
  }

  // ── Action Links ──

  async function insertActionLink(
    ctx: TenantContext | RequestContext,
    input: InsertActionLinkInput,
  ): Promise<ExamIncidentActionRow> {
    const rows = await db
      .insert(examIncidentActions)
      .values({
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        incidentId: input.incidentId,
        actionType: input.actionType,
        actionId: input.actionId,
        attemptId: input.attemptId,
        actorId: input.actorId ?? null,
        linkedAt: input.linkedAt,
        operationId: input.operationId,
      })
      .returning();
    return rows[0]!;
  }

  async function findActionLinkByOperationId(
    ctx: TenantContext | RequestContext,
    operationId: string,
  ): Promise<ExamIncidentActionRow | null> {
    const rows = await db
      .select()
      .from(examIncidentActions)
      .where(
        and(
          eq(examIncidentActions.organizationId, resolveOrganizationId(ctx)),
          eq(examIncidentActions.operationId, operationId),
        ),
      );
    return rows[0] ?? null;
  }

  async function findActionLinkByAction(
    ctx: TenantContext | RequestContext,
    actionType: IncidentActionType,
    actionId: string,
  ): Promise<ExamIncidentActionRow | null> {
    const rows = await db
      .select()
      .from(examIncidentActions)
      .where(
        and(
          eq(examIncidentActions.organizationId, resolveOrganizationId(ctx)),
          eq(examIncidentActions.actionType, actionType),
          eq(examIncidentActions.actionId, actionId),
        ),
      );
    return rows[0] ?? null;
  }

  async function listActionsByIncident(
    ctx: TenantContext | RequestContext,
    incidentId: string,
  ): Promise<ExamIncidentActionRow[]> {
    return db
      .select()
      .from(examIncidentActions)
      .where(
        and(
          eq(examIncidentActions.organizationId, resolveOrganizationId(ctx)),
          eq(examIncidentActions.incidentId, incidentId),
        ),
      )
      .orderBy(asc(examIncidentActions.linkedAt), asc(examIncidentActions.id));
  }

  // ── Attempt Membership ──

  async function insertAttemptMembership(
    ctx: TenantContext | RequestContext,
    input: InsertAttemptMembershipInput,
  ): Promise<ExamIncidentAttemptRow> {
    const rows = await db
      .insert(examIncidentAttempts)
      .values({
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        incidentId: input.incidentId,
        attemptId: input.attemptId,
        relationshipType: input.relationshipType,
        linkedAt: input.linkedAt,
        linkedBy: input.linkedBy,
        operationId: input.operationId,
      })
      .returning();
    return rows[0]!;
  }

  async function findAttemptMembershipByOperationId(
    ctx: TenantContext | RequestContext,
    operationId: string,
  ): Promise<ExamIncidentAttemptRow | null> {
    const rows = await db
      .select()
      .from(examIncidentAttempts)
      .where(
        and(
          eq(examIncidentAttempts.organizationId, resolveOrganizationId(ctx)),
          eq(examIncidentAttempts.operationId, operationId),
        ),
      );
    return rows[0] ?? null;
  }

  async function listAttemptsByIncident(
    ctx: TenantContext | RequestContext,
    incidentId: string,
  ): Promise<ExamIncidentAttemptRow[]> {
    return db
      .select()
      .from(examIncidentAttempts)
      .where(
        and(
          eq(examIncidentAttempts.organizationId, resolveOrganizationId(ctx)),
          eq(examIncidentAttempts.incidentId, incidentId),
        ),
      )
      .orderBy(
        asc(examIncidentAttempts.linkedAt),
        asc(examIncidentAttempts.id),
      );
  }

  // ── Interruption Links ──

  async function insertInterruptionLink(
    ctx: TenantContext | RequestContext,
    input: InsertInterruptionLinkInput,
  ): Promise<ExamIncidentInterruptionLinkRow> {
    const rows = await db
      .insert(examIncidentInterruptionLinks)
      .values({
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        incidentId: input.incidentId,
        attemptId: input.attemptId,
        interruptionId: input.interruptionId,
        linkedAt: input.linkedAt,
        linkedBy: input.linkedBy,
        operationId: input.operationId,
      })
      .returning();
    return rows[0]!;
  }

  async function findInterruptionLinkByOperationId(
    ctx: TenantContext | RequestContext,
    operationId: string,
  ): Promise<ExamIncidentInterruptionLinkRow | null> {
    const rows = await db
      .select()
      .from(examIncidentInterruptionLinks)
      .where(
        and(
          eq(
            examIncidentInterruptionLinks.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(examIncidentInterruptionLinks.operationId, operationId),
        ),
      );
    return rows[0] ?? null;
  }

  async function listInterruptionLinksByIncident(
    ctx: TenantContext | RequestContext,
    incidentId: string,
  ): Promise<ExamIncidentInterruptionLinkRow[]> {
    return db
      .select()
      .from(examIncidentInterruptionLinks)
      .where(
        and(
          eq(
            examIncidentInterruptionLinks.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(examIncidentInterruptionLinks.incidentId, incidentId),
        ),
      )
      .orderBy(
        asc(examIncidentInterruptionLinks.linkedAt),
        asc(examIncidentInterruptionLinks.id),
      );
  }

  return {
    insert,
    findById,
    findAuthorizationChain,
    findByIdForUpdate,
    listByExam,
    update,
    appendEvent,
    findEventByOperationId,
    listCommittedOperations,
    listEventsByIncident,
    insertActionLink,
    findActionLinkByOperationId,
    findActionLinkByAction,
    listActionsByIncident,
    insertAttemptMembership,
    findAttemptMembershipByOperationId,
    listAttemptsByIncident,
    insertInterruptionLink,
    findInterruptionLinkByOperationId,
    listInterruptionLinksByIncident,
  };
}

export type IncidentRepo = ReturnType<typeof createIncidentRepo>;
