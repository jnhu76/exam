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
  RequestContext,
} from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  examIncidentActions,
  examIncidentAttempts,
  examIncidentEvents,
  examIncidentInterruptionLinks,
  examIncidents,
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
  type: string;
  severity?: string;
  occurredAt?: Date | null;
  description: string;
  reportedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateIncidentInput {
  status?: string;
  severity?: string;
  version?: number;
  resolutionSummary?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: Date | null;
  updatedAt?: Date;
}

export interface AppendEventInput {
  incidentId: string;
  eventType: string;
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
  actionType: string;
  actionId: string;
  attemptId: string;
  actorId?: string | null;
  operationId: string;
  linkedAt: Date;
}

export interface InsertAttemptMembershipInput {
  incidentId: string;
  attemptId: string;
  relationshipType: string;
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
    statusFilter?: string[],
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
    actionType: string,
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
      );
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
      );
  }

  return {
    insert,
    findById,
    findByIdForUpdate,
    listByExam,
    update,
    appendEvent,
    findEventByOperationId,
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
