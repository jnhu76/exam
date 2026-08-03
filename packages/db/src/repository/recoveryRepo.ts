import type { RequestContext } from "@exam/domain";
import { AuthzUnavailableError } from "@exam/domain";
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
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
 * (fail-closed on cross-org rows). Enrichment is batch-per-page (contract
 * §5.1 "NO N+1 architecture"): a fixed number of SQL queries regardless of
 * page size, assembled in memory per incident.
 *
 * Snapshot consistency: the whole page read (base query + enrichment) runs
 * inside one read-only `REPEATABLE READ` transaction, so a filter such as
 * `assignedProctorUserId` and the returned `activeProctors` projection always
 * come from the same snapshot — a concurrent revoke can never make the page
 * contradict its own filter.
 */

/** Structured keyset cursor: `(createdAtExact, id)` of the last row of the previous page. */
export interface IncidentQueueCursor {
  /**
   * DB-exact UTC timestamp text (microsecond precision), produced by the
   * SQL projection (`to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`) and cast
   * straight back to `timestamptz` in the next page's predicate. A JS `Date`
   * round-trip would truncate sub-millisecond values and skip rows.
   */
  createdAtExact: string;
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
   *   consumes only the trusted structured `(createdAtExact, id)` pair.
   * - Fetches `limit + 1` rows so a single over-fetch signals "has next page".
   * - Tenant isolation: every condition set includes the org predicate.
   * - `assignedProctorUserId` filters on the *current active* Proctor
   *   assignment (status='active'); historical incident-time Proctor is NOT
   *   used (contract §5.4 adjudication).
   * - `attemptId` / `candidateId` match the incident's anchor fields AND the
   *   explicit membership links (`exam_incident_attempts`) — the queue row
   *   projects linked attempts as part of the incident's identity, so a
   *   related-attempt search must not miss membership-only links.
   * - Enrichment is batch-per-page: a fixed number of queries, never N+1.
   */
  async function listIncidentQueue(
    ctx: TenantContext | RequestContext,
    params: ListIncidentQueueParams,
  ): Promise<{
    items: IncidentQueueItem[];
    nextCursor: IncidentQueueCursor | null;
  }> {
    // The base page query and every enrichment query share ONE read-only
    // REPEATABLE READ transaction, so the page's filter predicates and its
    // projections (e.g. activeProctors) are always from the same snapshot.
    return db.transaction(
      async (tx) => {
        const orgId = resolveOrganizationId(ctx);
        const conditions = [eq(examIncidents.organizationId, orgId)];

        if (params.examId)
          conditions.push(eq(examIncidents.examId, params.examId));
        if (params.candidateId) {
          // candidateId matches the incident's anchor candidate, the candidate
          // of its anchor attempt, or the candidate of any linked (membership)
          // attempt. Subqueries keep the queue predicate on incident rows.
          const attemptIdsForCandidate = tx
            .select({ id: examAttempts.id })
            .from(examAttempts)
            .where(
              and(
                eq(examAttempts.organizationId, orgId),
                eq(examAttempts.candidateId, params.candidateId),
              ),
            );
          const incidentIdsViaMembership = tx
            .select({ incidentId: examIncidentAttempts.incidentId })
            .from(examIncidentAttempts)
            .where(
              and(
                eq(examIncidentAttempts.organizationId, orgId),
                inArray(examIncidentAttempts.attemptId, attemptIdsForCandidate),
              ),
            );
          const orCond = or(
            eq(examIncidents.candidateId, params.candidateId),
            inArray(examIncidents.attemptId, attemptIdsForCandidate),
            inArray(examIncidents.id, incidentIdsViaMembership),
          );
          if (orCond) conditions.push(orCond);
        }
        if (params.attemptId) {
          // attemptId matches the incident's anchor attempt OR any linked
          // (membership) attempt.
          const incidentIdsViaMembership = tx
            .select({ incidentId: examIncidentAttempts.incidentId })
            .from(examIncidentAttempts)
            .where(
              and(
                eq(examIncidentAttempts.organizationId, orgId),
                eq(examIncidentAttempts.attemptId, params.attemptId),
              ),
            );
          const orCond = or(
            eq(examIncidents.attemptId, params.attemptId),
            inArray(examIncidents.id, incidentIdsViaMembership),
          );
          if (orCond) conditions.push(orCond);
        }
        if (params.status)
          conditions.push(eq(examIncidents.status, params.status));
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
          conditions.push(
            inArray(examIncidents.status, ["open", "investigating"]),
          );
        }

        // assignedProctorUserId → only exams where this Proctor has an active
        // assignment today. Subquery keeps the queue predicate on incident rows.
        if (params.assignedProctorUserId) {
          const activeExamIds = tx
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

        // Keyset cursor: DESC means strictly BEFORE the cursor row. The cursor
        // carries the DB-exact timestamp text (up to microseconds), cast back
        // to timestamptz so no sub-millisecond row is ever skipped.
        if (params.cursor) {
          const cursorCreatedAt = params.cursor.createdAtExact;
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

        // Project the DB-exact timestamp text alongside each row so the
        // next-page cursor never loses sub-millisecond precision.
        const rows = await tx
          .select({
            incident: examIncidents,
            createdAtExact: sql<string>`to_char(${examIncidents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          })
          .from(examIncidents)
          .where(and(...conditions))
          .orderBy(desc(examIncidents.createdAt), desc(examIncidents.id))
          .limit(params.limit + 1);

        const pageRows = rows.slice(0, params.limit).map((r) => r.incident);
        const hasNext = rows.length > params.limit && pageRows.length > 0;
        const nextCursor = hasNext
          ? {
              createdAtExact: rows[params.limit - 1]!.createdAtExact,
              id: rows[params.limit - 1]!.incident.id,
            }
          : null;

        const items = await enrichPage(tx, orgId, pageRows);
        return { items, nextCursor };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  return { listIncidentQueue };
}

export type RecoveryRepo = ReturnType<typeof createRecoveryRepo>;

/**
 * Enriches a whole queue page with a FIXED number of SQL queries (contract
 * §5.1 "NO N+1 architecture"): base incidents + exams + memberships +
 * attempts + candidates + proctors, then assembles per-incident projections
 * in memory. The query count never grows with `limit` or row count.
 *
 * Broken parent chains (an Incident whose Exam is missing or not in the org)
 * fail closed with {@link AuthzUnavailableError} — the API layer surfaces it
 * as 503 AUTHZ_UNAVAILABLE. An admin audit surface must never silently drop
 * rows it cannot project.
 */
async function enrichPage(
  db: Database,
  orgId: string,
  incidents: ExamIncidentRow[],
): Promise<IncidentQueueItem[]> {
  if (incidents.length === 0) return [];

  const incidentIds = incidents.map((i) => i.id);
  const examIds = [...new Set(incidents.map((i) => i.examId))];

  // 1. Exams (the tenant boundary) — one batch for the whole page.
  const examRows = await db
    .select({ id: exams.id, title: exams.title, status: exams.status })
    .from(exams)
    .where(and(eq(exams.organizationId, orgId), inArray(exams.id, examIds)));
  const examById = new Map(examRows.map((e) => [e.id, e]));
  for (const incident of incidents) {
    if (!examById.has(incident.examId)) {
      throw new AuthzUnavailableError(
        `RECOVERY_QUEUE_PARENT_BROKEN: incident ${incident.id} exam ${incident.examId}`,
      );
    }
  }

  // 2. Memberships (explicit attempt links) — one batch for the whole page.
  const memberRows = await db
    .select({
      incidentId: examIncidentAttempts.incidentId,
      attemptId: examIncidentAttempts.attemptId,
    })
    .from(examIncidentAttempts)
    .where(
      and(
        eq(examIncidentAttempts.organizationId, orgId),
        inArray(examIncidentAttempts.incidentId, incidentIds),
      ),
    );

  // 3. Linked attempt ids = anchor attempt (if set) ∪ membership rows; then a
  //    single batch fetch resolves their exam/candidate/status/deadline.
  const linkedIdsByIncident = new Map<string, Set<string>>();
  for (const incident of incidents) {
    linkedIdsByIncident.set(incident.id, new Set<string>());
  }
  for (const incident of incidents) {
    if (incident.attemptId)
      linkedIdsByIncident.get(incident.id)!.add(incident.attemptId);
  }
  for (const m of memberRows) {
    linkedIdsByIncident.get(m.incidentId)?.add(m.attemptId);
  }
  const allLinkedAttemptIds = new Set<string>();
  for (const ids of linkedIdsByIncident.values()) {
    for (const id of ids) allLinkedAttemptIds.add(id);
  }
  const attemptRows =
    allLinkedAttemptIds.size > 0
      ? await db
          .select({
            id: examAttempts.id,
            examId: examAttempts.examId,
            candidateId: examAttempts.candidateId,
            status: examAttempts.status,
            deadlineAt: examAttempts.deadlineAt,
          })
          .from(examAttempts)
          .where(
            and(
              eq(examAttempts.organizationId, orgId),
              inArray(examAttempts.id, [...allLinkedAttemptIds]),
            ),
          )
      : [];
  const attemptById = new Map(attemptRows.map((a) => [a.id, a]));

  // 4. Candidates — primary candidates + linked-attempt candidates, one batch.
  const candidateIds = new Set<string>();
  for (const incident of incidents) {
    if (incident.candidateId) candidateIds.add(incident.candidateId);
  }
  for (const a of attemptRows) {
    if (a.candidateId) candidateIds.add(a.candidateId);
  }
  const candRows =
    candidateIds.size > 0
      ? await db
          .select({
            id: candidateProfiles.id,
            displayName: users.name,
          })
          .from(candidateProfiles)
          .leftJoin(users, eq(candidateProfiles.userId, users.id))
          .where(
            and(
              eq(candidateProfiles.organizationId, orgId),
              inArray(candidateProfiles.id, [...candidateIds]),
            ),
          )
      : [];
  const candidateById = new Map(
    candRows.map((c) => [c.id, { displayName: c.displayName ?? "" }]),
  );

  // 4b. Fail closed on unresolvable/inconsistent anchors. A non-null anchor or
  //     membership is NOT an optional display hint — the frozen creation
  //     matrix derives candidate from the authoritative attempt, so a broken
  //     link means tenant-data corruption, never "exam-wide incident". The
  //     admin audit surface must not disguise corruption as absence.
  for (const incident of incidents) {
    if (incident.attemptId) {
      const a = attemptById.get(incident.attemptId);
      if (!a) {
        throw new AuthzUnavailableError(
          `RECOVERY_QUEUE_ATTEMPT_BROKEN: incident ${incident.id} attempt ${incident.attemptId}`,
        );
      }
      if (a.examId !== incident.examId) {
        throw new AuthzUnavailableError(
          `RECOVERY_QUEUE_ANCHOR_EXAM_MISMATCH: incident ${incident.id} attempt ${incident.attemptId} exam ${a.examId}`,
        );
      }
      if (
        incident.candidateId != null &&
        a.candidateId !== incident.candidateId
      ) {
        throw new AuthzUnavailableError(
          `RECOVERY_QUEUE_ANCHOR_CANDIDATE_MISMATCH: incident ${incident.id} attempt ${incident.attemptId} candidate ${a.candidateId}`,
        );
      }
    }
    if (incident.candidateId && !candidateById.has(incident.candidateId)) {
      throw new AuthzUnavailableError(
        `RECOVERY_QUEUE_CANDIDATE_BROKEN: incident ${incident.id} candidate ${incident.candidateId}`,
      );
    }
  }
  for (const m of memberRows) {
    if (!attemptById.has(m.attemptId)) {
      throw new AuthzUnavailableError(
        `RECOVERY_QUEUE_MEMBERSHIP_BROKEN: incident ${m.incidentId} attempt ${m.attemptId}`,
      );
    }
  }

  // 5. Active Proctors for the page's exams — current active assignment only
  //    (status='active'); historical incident-time Proctor is NOT included.
  //    Deterministic ordering (displayName, userId) so the projection is a
  //    stable contract instead of an unspecified DB row order.
  const proctorRows = await db
    .select({
      examId: examProctorAssignments.examId,
      userId: examProctorAssignments.proctorUserId,
      displayName: users.name,
    })
    .from(examProctorAssignments)
    .leftJoin(users, eq(examProctorAssignments.proctorUserId, users.id))
    .where(
      and(
        eq(examProctorAssignments.organizationId, orgId),
        inArray(examProctorAssignments.examId, examIds),
        eq(examProctorAssignments.status, "active"),
      ),
    )
    .orderBy(asc(users.name), asc(examProctorAssignments.proctorUserId));
  const proctorsByExam = new Map<string, IncidentQueueProctorSummary[]>();
  for (const p of proctorRows) {
    const list = proctorsByExam.get(p.examId) ?? [];
    list.push({ userId: p.userId, displayName: p.displayName ?? "" });
    proctorsByExam.set(p.examId, list);
  }

  // 6. Assemble per incident (pure in-memory).
  return incidents.map((incident) => {
    const exam = examById.get(incident.examId)!;
    const linkedIds = linkedIdsByIncident.get(incident.id)!;
    const linkedCandidateIds = new Set<string>();
    for (const aid of linkedIds) {
      const a = attemptById.get(aid);
      if (a?.candidateId) linkedCandidateIds.add(a.candidateId);
    }
    const anchorAttempt = incident.attemptId
      ? attemptById.get(incident.attemptId)
      : undefined;
    const primaryAttempt = anchorAttempt
      ? {
          id: anchorAttempt.id,
          candidateId: anchorAttempt.candidateId,
          status: anchorAttempt.status,
          deadlineAt: anchorAttempt.deadlineAt,
        }
      : null;
    const primaryCandidate =
      incident.candidateId && candidateById.has(incident.candidateId)
        ? {
            id: incident.candidateId,
            displayName: candidateById.get(incident.candidateId)!.displayName,
          }
        : null;

    return {
      incident,
      examSummary: { id: exam.id, title: exam.title, status: exam.status },
      primaryAttempt,
      primaryCandidate,
      linkedAttemptCount: linkedIds.size,
      linkedCandidateCount: linkedCandidateIds.size,
      activeProctors: proctorsByExam.get(incident.examId) ?? [],
    };
  });
}
