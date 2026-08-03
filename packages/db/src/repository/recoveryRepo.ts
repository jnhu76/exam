import type { RequestContext } from "@exam/domain";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  candidateProfiles,
  examAttempts,
  examIncidentAttempts,
  examIncidents,
  examProctorAssignments,
  exams,
  users,
} from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import { resolveOrganizationId } from "./baseRepo.js";
import type { ExamIncidentRow } from "./incidentRepo.js";

/**
 * Recovery Incident Queue (J5-I1A, contract §5.4).
 *
 * Organization-wide list of incidents for the Admin Recovery Center, ordered
 * by `(created_at DESC, id DESC)` with opaque keyset pagination. Every item is
 * enriched in-repo so the API returns a single anchored projection per row —
 * the frontend never needs to fan out per-row refetches.
 *
 * Tenant boundary is enforced on every read via `ctx.organizationId`
 * (fail-closed on cross-org rows).
 */

/** Structured keyset cursor: the (createdAt, id) pair of the last row of the previous page. */
export interface IncidentQueueCursor {
  createdAt: Date;
  id: string;
}

export interface ListIncidentQueueParams {
  limit: number;
  cursor?: IncidentQueueCursor | null;
  examId?: string | null;
  candidateId?: string | null;
  attemptId?: string | null;
  status?: string | null;
  severity?: string | null;
  incidentType?: string | null;
  createdFrom?: Date | null;
  createdTo?: Date | null;
  unresolvedOnly?: boolean | null;
  assignedProctorUserId?: string | null;
}

export interface IncidentQueueExamSummary {
  id: string;
  title: string;
  status: string;
}

export interface IncidentQueueAttemptSummary {
  id: string;
  candidateId: string | null;
  status: string;
  deadlineAt: Date | null;
}

export interface IncidentQueueCandidateSummary {
  id: string;
  displayName: string;
}

export interface IncidentQueueProctorSummary {
  userId: string;
  displayName: string;
}

export interface IncidentQueueItem {
  incident: ExamIncidentRow;
  examSummary: IncidentQueueExamSummary;
  primaryAttempt: IncidentQueueAttemptSummary | null;
  primaryCandidate: IncidentQueueCandidateSummary | null;
  linkedAttemptCount: number;
  linkedCandidateCount: number;
  activeProctors: IncidentQueueProctorSummary[];
}

export function createRecoveryRepo(db: Database) {
  /**
   * listIncidentQueue — Admin Recovery Center queue (J5-I1A §5.4).
   *
   * - Org-wide scope, ordered `(created_at DESC, id DESC)`.
   * - Keyset pagination via opaque cursor parsed at the API boundary; the repo
   *   consumes only the trusted structured `(createdAt, id)` pair.
   * - Fetches `limit + 1` rows so a single over-fetch signals "has next page".
   * - Tenant isolation: every condition set includes the org predicate.
   * - `assignedProctorUserId` filters on the *current active* Proctor
   *   assignment (status='active'); historical incident-time Proctor is NOT
   *   used (contract §5.4 adjudication).
   */
  async function listIncidentQueue(
    ctx: TenantContext | RequestContext,
    params: ListIncidentQueueParams,
  ): Promise<{
    items: IncidentQueueItem[];
    nextCursor: IncidentQueueCursor | null;
  }> {
    const orgId = resolveOrganizationId(ctx);
    const conditions = [eq(examIncidents.organizationId, orgId)];

    if (params.examId) conditions.push(eq(examIncidents.examId, params.examId));
    if (params.candidateId)
      conditions.push(eq(examIncidents.candidateId, params.candidateId));
    if (params.attemptId)
      conditions.push(eq(examIncidents.attemptId, params.attemptId));
    if (params.status) conditions.push(eq(examIncidents.status, params.status));
    if (params.severity)
      conditions.push(eq(examIncidents.severity, params.severity));
    if (params.incidentType)
      conditions.push(eq(examIncidents.type, params.incidentType));
    if (params.createdFrom)
      conditions.push(gte(examIncidents.createdAt, params.createdFrom));
    if (params.createdTo)
      conditions.push(lte(examIncidents.createdAt, params.createdTo));
    if (params.unresolvedOnly) {
      // unresolved = status IN ('open', 'investigating'); resolved/dismissed
      // are excluded. inArray composes cleanly with the rest of the predicate.
      conditions.push(inArray(examIncidents.status, ["open", "investigating"]));
    }

    // assignedProctorUserId → only exams where this Proctor has an active
    // assignment today. Subquery keeps the queue predicate on incident rows.
    if (params.assignedProctorUserId) {
      const activeExamIds = db
        .select({ examId: examProctorAssignments.examId })
        .from(examProctorAssignments)
        .where(
          and(
            eq(examProctorAssignments.organizationId, orgId),
            eq(
              examProctorAssignments.proctorUserId,
              params.assignedProctorUserId,
            ),
            eq(examProctorAssignments.status, "active"),
          ),
        );
      conditions.push(inArray(examIncidents.examId, activeExamIds));
    }

    // Keyset cursor: DESC means strictly BEFORE the cursor row.
    if (params.cursor) {
      const cursorCreatedAt = params.cursor.createdAt.toISOString();
      const cursorId = params.cursor.id;
      conditions.push(
        sql`(
          ${examIncidents.createdAt} < ${cursorCreatedAt}::timestamptz
          OR (
            ${examIncidents.createdAt} = ${cursorCreatedAt}::timestamptz
            AND ${examIncidents.id} < ${cursorId}
          )
        )`,
      );
    }

    const rows = await db
      .select()
      .from(examIncidents)
      .where(and(...conditions))
      .orderBy(desc(examIncidents.createdAt), desc(examIncidents.id))
      .limit(params.limit + 1);

    const pageRows = rows.slice(0, params.limit);
    const hasNext = rows.length > params.limit && pageRows.length > 0;
    const nextCursor = hasNext
      ? {
          createdAt: pageRows[pageRows.length - 1]!.createdAt,
          id: pageRows[pageRows.length - 1]!.id,
        }
      : null;

    const items = await Promise.all(
      pageRows.map((row) => enrichIncident(db, orgId, row)),
    );
    return { items, nextCursor };
  }

  return { listIncidentQueue };
}

export type RecoveryRepo = ReturnType<typeof createRecoveryRepo>;

// ── Enrichment (single SQL per dimension, per row) ──
// The queue page is bounded (≤ limit) so a bounded N+1 is acceptable; the
// contract forbids per-row frontend refetch, not per-row backend enrichment.

async function enrichIncident(
  db: Database,
  orgId: string,
  incident: ExamIncidentRow,
): Promise<IncidentQueueItem> {
  // 1. Exam summary — incident.examId is NOT NULL; exams row is the boundary.
  const examRows = await db
    .select({
      id: exams.id,
      title: exams.title,
      status: exams.status,
    })
    .from(exams)
    .where(and(eq(exams.organizationId, orgId), eq(exams.id, incident.examId)))
    .limit(1);
  const examRow = examRows[0];
  if (!examRow) {
    // Broken parent chain — fail-closed. API layer surfaces 503 AUTHZ_UNAVAILABLE.
    throw new Error(
      `RECOVERY_QUEUE_PARENT_BROKEN: incident ${incident.id} exam ${incident.examId}`,
    );
  }
  const examSummary: IncidentQueueExamSummary = {
    id: examRow.id,
    title: examRow.title,
    status: examRow.status,
  };

  // 2. Primary attempt (anchor attempt) — nullable.
  let primaryAttempt: IncidentQueueAttemptSummary | null = null;
  if (incident.attemptId) {
    const attemptRows = await db
      .select({
        id: examAttempts.id,
        candidateId: examAttempts.candidateId,
        status: examAttempts.status,
        deadlineAt: examAttempts.deadlineAt,
      })
      .from(examAttempts)
      .where(
        and(
          eq(examAttempts.organizationId, orgId),
          eq(examAttempts.id, incident.attemptId),
        ),
      )
      .limit(1);
    const a = attemptRows[0];
    if (a) {
      primaryAttempt = {
        id: a.id,
        candidateId: a.candidateId,
        status: a.status,
        deadlineAt: a.deadlineAt,
      };
    }
  }

  // 3. Primary candidate (incident.candidateId) — nullable.
  let primaryCandidate: IncidentQueueCandidateSummary | null = null;
  if (incident.candidateId) {
    const candRows = await db
      .select({
        id: candidateProfiles.id,
        displayName: users.name,
      })
      .from(candidateProfiles)
      .leftJoin(users, eq(candidateProfiles.userId, users.id))
      .where(
        and(
          eq(candidateProfiles.organizationId, orgId),
          eq(candidateProfiles.id, incident.candidateId),
        ),
      )
      .limit(1);
    const c = candRows[0];
    if (c) {
      primaryCandidate = { id: c.id, displayName: c.displayName ?? "" };
    }
  }

  // 4. Linked attempts = anchor attempt (if set) ∪ explicit membership rows.
  //    Linked candidate count = distinct candidateId across the linked attempts.
  const memberRows = await db
    .select({ attemptId: examIncidentAttempts.attemptId })
    .from(examIncidentAttempts)
    .where(
      and(
        eq(examIncidentAttempts.organizationId, orgId),
        eq(examIncidentAttempts.incidentId, incident.id),
      ),
    );
  const linkedAttemptIds = new Set<string>();
  if (incident.attemptId) linkedAttemptIds.add(incident.attemptId);
  for (const m of memberRows) linkedAttemptIds.add(m.attemptId);
  const linkedAttemptCount = linkedAttemptIds.size;

  // Resolve distinct candidateIds for the linked attempts (in-org).
  let linkedCandidateCount = 0;
  if (linkedAttemptCount > 0) {
    const linkedRows = await db
      .select({ candidateId: examAttempts.candidateId })
      .from(examAttempts)
      .where(
        and(
          eq(examAttempts.organizationId, orgId),
          inArray(examAttempts.id, [...linkedAttemptIds]),
        ),
      );
    const candidateIds = new Set<string>();
    for (const r of linkedRows) {
      if (r.candidateId) candidateIds.add(r.candidateId);
    }
    linkedCandidateCount = candidateIds.size;
  }

  // 5. Active Proctors for the incident's exam — current active assignment only
  //    (status='active'); historical incident-time Proctor is NOT included.
  const proctorRows = await db
    .select({
      userId: examProctorAssignments.proctorUserId,
      displayName: users.name,
    })
    .from(examProctorAssignments)
    .leftJoin(users, eq(examProctorAssignments.proctorUserId, users.id))
    .where(
      and(
        eq(examProctorAssignments.organizationId, orgId),
        eq(examProctorAssignments.examId, incident.examId),
        eq(examProctorAssignments.status, "active"),
      ),
    );
  const activeProctors: IncidentQueueProctorSummary[] = proctorRows.map(
    (p) => ({ userId: p.userId, displayName: p.displayName ?? "" }),
  );

  return {
    incident,
    examSummary,
    primaryAttempt,
    primaryCandidate,
    linkedAttemptCount,
    linkedCandidateCount,
    activeProctors,
  };
}
