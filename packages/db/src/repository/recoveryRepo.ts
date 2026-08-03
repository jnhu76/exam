import type { RequestContext } from "@exam/domain";
import { AuthzUnavailableError } from "@exam/domain";
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import {
  attemptTimeAdjustments,
  auditLogs,
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
import { createIncidentRepo, type ExamIncidentRow } from "./incidentRepo.js";

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

/**
 * Exam summary carrying the canonical closeAt so the route layer can compute
 * each Attempt's effective deadline via the canonical
 * `computeEffectiveDeadline(exam, attempt)` authority (contract §6.2 / §6.3).
 * The repo MUST NOT re-derive the min(closeAt, deadlineAt) formula itself —
 * it only carries the inputs the canonical helper needs.
 */
export interface IncidentAggregateExamSummary {
  id: string;
  title: string;
  status: string;
  /** Exam closeAt — the upper bound of every effective deadline. */
  closeAt: Date;
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

// ── Aggregate detail types (J5-I1A2, contract §6.3) ──

export interface IncidentAggregateEventSummary {
  id: string;
  eventSequence: number;
  eventType: string;
  commandType: string;
  operationId: string;
  actorId: string | null;
  beforeVersion: number;
  afterVersion: number;
  payload: unknown;
  createdAt: Date;
}

export interface IncidentAggregateNoteSummary {
  operationId: string;
  actorId: string | null;
  body: string;
  createdAt: Date;
}

export interface IncidentAggregateActionSummary {
  id: string;
  actionType: string;
  actionId: string;
  attemptId: string;
  actorId: string | null;
  operationId: string;
  linkedAt: Date;
}

export interface IncidentAggregateAttemptMembershipSummary {
  id: string;
  attemptId: string;
  relationshipType: string;
  linkedAt: Date;
  linkedBy: string;
  operationId: string;
}

export interface IncidentAggregateInterruptionLinkSummary {
  id: string;
  attemptId: string;
  interruptionId: string;
  linkedAt: Date;
  linkedBy: string;
  operationId: string;
}

export interface IncidentAggregateCandidateSummary {
  id: string;
  displayName: string;
}

export interface IncidentAggregateAttemptSummary {
  id: string;
  candidateId: string | null;
  status: string;
  /**
   * Raw per-attempt deadline (examAttempts.deadlineAt). The route layer maps
   * this to the canonical effective deadline; the repo never re-derives it.
   */
  deadlineAt: Date | null;
  /**
   * attempt.examId — required for the same-Exam scope validation (ADR-014 §7
   * scope quadruple: every linked/anchor attempt MUST belong to the Incident's
   * exam). Not exposed on the wire; consumed by the repo's fail-closed check.
   */
  examId: string;
}

export interface IncidentAggregateTimeAdjustmentSummary {
  id: string;
  attemptId: string;
  addedSeconds: number;
  reasonCode: string | null;
  operationId: string;
  createdAt: Date;
}

export interface IncidentAggregateAuditReferenceSummary {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  createdAt: Date;
}

export type IncidentAllowedAction =
  | "investigate"
  | "add_note"
  | "change_severity"
  | "resolve"
  | "dismiss"
  | "link_action"
  | "link_attempt"
  | "link_interruption";

export interface IncidentAggregate {
  incident: ExamIncidentRow;
  examSummary: IncidentAggregateExamSummary;
  events: IncidentAggregateEventSummary[];
  notes: IncidentAggregateNoteSummary[];
  actions: IncidentAggregateActionSummary[];
  attemptMemberships: IncidentAggregateAttemptMembershipSummary[];
  interruptionLinks: IncidentAggregateInterruptionLinkSummary[];
  candidateSummaries: IncidentAggregateCandidateSummary[];
  attemptSummaries: IncidentAggregateAttemptSummary[];
  timeAdjustmentSummaries: IncidentAggregateTimeAdjustmentSummary[];
  auditReferences: IncidentAggregateAuditReferenceSummary[];
  /**
   * Status-derived action candidates ONLY (ADR-014 §3). The repo computes
   * exactly the status machine; the ROUTE layer is the place that filters
   * them down to the caller's final allowed set (J5-R0 §6.2: action
   * eligibility = capability + resource scope + status; J5-R0 §6.3: the wire
   * `allowedActions` is the per-caller intersection, never the raw status
   * candidates). The route additionally applies the incident-shape filter
   * (an anchored Incident never exposes `link_attempt`).
   */
  statusActionCandidates: IncidentAllowedAction[];
  /**
   * Transaction snapshot timestamp — `transaction_timestamp()` queried INSIDE
   * the RR transaction, so it is the actual PostgreSQL snapshot time, not a
   * request-side clock reading. // adr-006-allow: DB snapshot identity stamp,
   * not an exam-lifecycle time decision (see ADR-006 allowlist entry).
   */
  snapshotAt: Date;
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

  /**
   * getIncidentAggregate — authoritative aggregate projection for the Admin
   * Recovery Center detail view (J5-I1A2 §6.3).
   *
   * Reads Incident + events + notes + actions + Attempt memberships +
   * interruption links + Exam/Attempt/Candidate summaries + time adjustments +
   * audit references + allowed actions from ONE consistent snapshot: a
   * read-only REPEATABLE READ transaction. All repos are bound to the same
   * transaction handle so the Incident version, event/action/membership lists,
   * and summaries cannot come from different snapshots.
   *
   * - Returns null if the incident does not exist in the caller's organization
   *   (fail-closed on missing / cross-org; the resolver at the API layer maps
   *   that to 404 RESOURCE_NOT_FOUND).
   * - `snapshotAt` is `transaction_timestamp()` queried INSIDE the RR
   *   transaction — the actual PostgreSQL snapshot time, not a request-side
   *   clock reading. // adr-006-allow: DB snapshot identity stamp, not an
   *   exam-lifecycle time decision (see ADR-006 allowlist entry).
   * - `statusActionCandidates` is server-derived from the current status per
   *   ADR-014 §3 (the route layer further filters by the caller's
   *   capabilities + incident shape to produce the wire `allowedActions`).
   * - The full relationship graph is validated against the ADR-014 §7 scope
   *   quadruple (org, exam, attempt, candidate); any unresolvable link or
   *   scope contradiction fails closed with {@link AuthzUnavailableError}
   *   (503 AUTHZ_UNAVAILABLE) — the admin audit surface never silently drops
   *   a summary nor disguises corruption as absence.
   */
  async function getIncidentAggregate(
    ctx: TenantContext | RequestContext,
    incidentId: string,
  ): Promise<IncidentAggregate | null> {
    const orgId = resolveOrganizationId(ctx);

    return db.transaction(
      async (tx) => {
        const incidentRepo = createIncidentRepo(tx);

        const incident = await incidentRepo.findById(
          { organizationId: orgId } as TenantContext,
          incidentId,
        );
        if (!incident) return null;

        // All dimension reads bound to `tx` → same REPEATABLE READ snapshot.
        const events = await incidentRepo.listEventsByIncident(
          { organizationId: orgId } as TenantContext,
          incidentId,
        );
        const actions = await incidentRepo.listActionsByIncident(
          { organizationId: orgId } as TenantContext,
          incidentId,
        );
        const attemptMemberships = await incidentRepo.listAttemptsByIncident(
          { organizationId: orgId } as TenantContext,
          incidentId,
        );
        const interruptionLinks =
          await incidentRepo.listInterruptionLinksByIncident(
            { organizationId: orgId } as TenantContext,
            incidentId,
          );

        // Exam summary — also fetch closeAt so the route layer can compute the
        // canonical effective deadline via computeEffectiveDeadline(exam,
        // attempt). The repo never re-derives the min(closeAt, deadlineAt)
        // formula; it only carries the canonical helper's inputs.
        const examRows = await tx
          .select({
            id: exams.id,
            title: exams.title,
            status: exams.status,
            closeAt: exams.closeAt,
          })
          .from(exams)
          .where(
            and(eq(exams.organizationId, orgId), eq(exams.id, incident.examId)),
          )
          .limit(1);
        const examRow = examRows[0];
        if (!examRow) {
          // Broken parent chain — fail closed with the same shape the queue
          // uses (503 AUTHZ_UNAVAILABLE), never a bare 500.
          throw new AuthzUnavailableError(
            `RECOVERY_AGG_PARENT_BROKEN: incident ${incident.id} exam ${incident.examId}`,
          );
        }
        if (examRow.closeAt == null) {
          // timed_window invariant: every exam carries a non-null closeAt. A
          // null here is tenant-data corruption the canonical deadline helper
          // cannot reason about — fail closed rather than mis-project.
          throw new AuthzUnavailableError(
            `RECOVERY_AGG_EXAM_CLOSEAT_NULL: incident ${incident.id} exam ${incident.examId}`,
          );
        }

        // ADR-014 §2: anchor and membership are MUTUALLY EXCLUSIVE — an
        // anchored Incident (attemptId set) rejects membership rows. A
        // historical row carrying both is tenant-data corruption: fail closed
        // instead of projecting a graph the authority forbids.
        if (incident.attemptId !== null && attemptMemberships.length > 0) {
          throw new AuthzUnavailableError(
            `RECOVERY_AGG_ANCHOR_MEMBERSHIP_CONFLICT: incident ${incident.id}`,
          );
        }

        // Summary (linked) attempt set = anchor attempt (if any) ∪ membership
        // rows. This is the wire's `attemptSummaries` — exactly the durable
        // "linked attempts" relationships (§6.1).
        const summaryAttemptIds = new Set<string>();
        if (incident.attemptId) summaryAttemptIds.add(incident.attemptId);
        for (const m of attemptMemberships) {
          summaryAttemptIds.add(m.attemptId);
        }

        // Referenced attempt set additionally covers action-link and
        // interruption-link attempts. ADR-014 §7 treats anchor, membership,
        // operator action links, and interruption evidence links as
        // INDEPENDENT durable relationships — an action/interruption link does
        // NOT require the attempt to also be a membership (e.g. the canonical
        // time-grant path atomically creates time adjustment + action link
        // without a membership row). Referenced attempts are batch-read and
        // fail-closed validated (same-Exam, matching candidate when the
        // incident is candidate-focused); only summary attempts are projected
        // into `attemptSummaries`.
        const referencedAttemptIds = new Set(summaryAttemptIds);
        for (const act of actions) referencedAttemptIds.add(act.attemptId);
        for (const link of interruptionLinks) {
          referencedAttemptIds.add(link.attemptId);
        }
        const referencedIdList = [...referencedAttemptIds];

        // Attempt summaries — MUST select examAttempts.examId so the same-Exam
        // scope quadruple (ADR-014 §7) is verifiable. The candidate set is
        // seeded from BOTH the summary attempts AND the incident's own
        // candidateId focus (candidate-focused exam-wide incident:
        // attemptId=null, candidateId=set — without this seed the aggregate
        // would project an empty candidate list and contradict itself).
        let attemptSummaries: IncidentAggregateAttemptSummary[] = [];
        const candidateIds = new Set<string>();
        if (incident.candidateId) candidateIds.add(incident.candidateId);
        let timeAdjustmentSummaries: IncidentAggregateTimeAdjustmentSummary[] =
          [];
        const attemptById = new Map<
          string,
          { examId: string; candidateId: string | null }
        >();
        if (referencedIdList.length > 0) {
          const attRows = await tx
            .select({
              id: examAttempts.id,
              candidateId: examAttempts.candidateId,
              status: examAttempts.status,
              deadlineAt: examAttempts.deadlineAt,
              examId: examAttempts.examId,
            })
            .from(examAttempts)
            .where(
              and(
                eq(examAttempts.organizationId, orgId),
                inArray(examAttempts.id, referencedIdList),
              ),
            )
            .orderBy(asc(examAttempts.id));
          // Wire decision (J5-R0 §6.3): attemptSummaries = summary attempts
          // only. Action/interruption-referenced attempts are validated but
          // not summarized — they remain reachable by id via the link rows.
          attemptSummaries = attRows
            .filter((a) => summaryAttemptIds.has(a.id))
            .map((a) => ({
              id: a.id,
              candidateId: a.candidateId,
              status: a.status,
              deadlineAt: a.deadlineAt,
              examId: a.examId,
            }));
          for (const a of attRows) {
            attemptById.set(a.id, {
              examId: a.examId,
              candidateId: a.candidateId,
            });
            if (a.candidateId && summaryAttemptIds.has(a.id)) {
              candidateIds.add(a.candidateId);
            }
          }

          // Time adjustments for ALL referenced attempts (action links with
          // action_type='time_grant' point at these ledger rows). Fetching by
          // the referenced set guarantees the canonical atomic time-grant
          // path (adjustment + action link, no membership) still projects its
          // ledger row.
          const timeAdjRows = await tx
            .select({
              id: attemptTimeAdjustments.id,
              attemptId: attemptTimeAdjustments.attemptId,
              addedSeconds: attemptTimeAdjustments.addedSeconds,
              reasonCode: attemptTimeAdjustments.reasonCode,
              operationId: attemptTimeAdjustments.operationId,
              createdAt: attemptTimeAdjustments.createdAt,
            })
            .from(attemptTimeAdjustments)
            .where(
              and(
                eq(attemptTimeAdjustments.organizationId, orgId),
                inArray(attemptTimeAdjustments.attemptId, referencedIdList),
              ),
            )
            .orderBy(
              asc(attemptTimeAdjustments.createdAt),
              asc(attemptTimeAdjustments.id),
            );
          timeAdjustmentSummaries = timeAdjRows.map((t) => ({
            id: t.id,
            attemptId: t.attemptId,
            addedSeconds: t.addedSeconds,
            reasonCode: t.reasonCode,
            operationId: t.operationId,
            createdAt: t.createdAt,
          }));
        }

        // ── Fail-closed relationship-graph validation (ADR-014 §7 scope
        //    quadruple). The composite FKs only prove organization + attempt
        //    consistency; they do NOT prove `incident.examId ==
        //    attempt.examId`, nor that a candidate-focused incident's
        //    membership belongs to the same candidate. The application layer
        //    must verify these and fail closed on any contradiction — never
        //    silently omit a summary, never disguise corruption as absence.
        // Anchor attempt (if any) MUST resolve and belong to the incident's
        // exam; its candidate MUST match the incident focus when set.
        if (incident.attemptId) {
          const a = attemptById.get(incident.attemptId);
          if (!a) {
            throw new AuthzUnavailableError(
              `RECOVERY_AGG_ANCHOR_BROKEN: incident ${incident.id} attempt ${incident.attemptId}`,
            );
          }
          if (a.examId !== incident.examId) {
            throw new AuthzUnavailableError(
              `RECOVERY_AGG_ANCHOR_EXAM_MISMATCH: incident ${incident.id} attempt ${incident.attemptId} exam ${a.examId}`,
            );
          }
          if (
            incident.candidateId != null &&
            a.candidateId !== incident.candidateId
          ) {
            throw new AuthzUnavailableError(
              `RECOVERY_AGG_ANCHOR_CANDIDATE_MISMATCH: incident ${incident.id} attempt ${incident.attemptId} candidate ${a.candidateId}`,
            );
          }
        }
        // Every membership MUST resolve to an attempt of the incident's exam;
        // for a candidate-focused incident, every membership attempt MUST
        // belong to that candidate (ADR-014 §7 candidate matrix).
        for (const m of attemptMemberships) {
          const a = attemptById.get(m.attemptId);
          if (!a) {
            throw new AuthzUnavailableError(
              `RECOVERY_AGG_MEMBERSHIP_BROKEN: incident ${incident.id} membership ${m.id} attempt ${m.attemptId}`,
            );
          }
          if (a.examId !== incident.examId) {
            throw new AuthzUnavailableError(
              `RECOVERY_AGG_MEMBERSHIP_EXAM_MISMATCH: incident ${incident.id} membership ${m.id} attempt ${m.attemptId} exam ${a.examId}`,
            );
          }
          if (
            incident.candidateId != null &&
            a.candidateId !== incident.candidateId
          ) {
            throw new AuthzUnavailableError(
              `RECOVERY_AGG_MEMBERSHIP_CANDIDATE_MISMATCH: incident ${incident.id} membership ${m.id} attempt ${m.attemptId} candidate ${a.candidateId}`,
            );
          }
        }
        // Action links and interruption links each carry an attemptId that
        // MUST resolve in-org and satisfy the same scope quadruple — but the
        // attempt does NOT need to be a membership (the relationships are
        // independent, ADR-014 §7). An anchored incident rejects membership,
        // but its action / interruption links still MUST point at the anchor
        // attempt (same-Exam; candidate-matched when the incident is
        // candidate-focused).
        for (const act of actions) {
          const a = attemptById.get(act.attemptId);
          if (
            !a ||
            a.examId !== incident.examId ||
            (incident.candidateId != null &&
              a.candidateId !== incident.candidateId)
          ) {
            throw new AuthzUnavailableError(
              `RECOVERY_AGG_ACTION_ATTEMPT_SCOPE: incident ${incident.id} action ${act.id} attempt ${act.attemptId}`,
            );
          }
        }
        for (const link of interruptionLinks) {
          const a = attemptById.get(link.attemptId);
          if (
            !a ||
            a.examId !== incident.examId ||
            (incident.candidateId != null &&
              a.candidateId !== incident.candidateId)
          ) {
            throw new AuthzUnavailableError(
              `RECOVERY_AGG_INTERRUPTION_ATTEMPT_SCOPE: incident ${incident.id} interruptionLink ${link.id} attempt ${link.attemptId}`,
            );
          }
        }

        // Candidate summaries — fail closed if a non-null candidate focus
        // cannot be resolved in-org (a candidate-focused incident whose
        // candidate row is missing or belongs to another org is corruption,
        // not an exam-wide incident with an empty focus).
        let candidateSummaries: IncidentAggregateCandidateSummary[] = [];
        if (candidateIds.size > 0) {
          // Same-org predicate on the User join: a historical or directly-
          // written CandidateProfile may point at a User of ANOTHER org. The
          // leftJoin must restrict the joined User to the caller's org, or
          // the aggregate would project a foreign-org display name.
          const candRows = await tx
            .select({
              id: candidateProfiles.id,
              displayName: users.name,
            })
            .from(candidateProfiles)
            .leftJoin(
              users,
              and(
                eq(candidateProfiles.userId, users.id),
                eq(users.organizationId, orgId),
              ),
            )
            .where(
              and(
                eq(candidateProfiles.organizationId, orgId),
                inArray(candidateProfiles.id, [...candidateIds]),
              ),
            )
            .orderBy(asc(users.name), asc(candidateProfiles.id));
          for (const c of candRows) {
            // candidate_profiles.user_id is NOT NULL, so a missing join row
            // means the same-org User is gone or belongs to another org —
            // tenant-graph corruption. The candidate identity projection must
            // NOT disguise that as an empty display name (the UI would read
            // "user never set a name" while the graph is actually broken).
            if (c.displayName == null) {
              throw new AuthzUnavailableError(
                `RECOVERY_AGG_CANDIDATE_USER_BROKEN: incident ${incident.id} candidate ${c.id}`,
              );
            }
          }
          candidateSummaries = candRows.map((c) => ({
            id: c.id,
            displayName: c.displayName as string,
          }));
          for (const cid of candidateIds) {
            if (!candidateSummaries.some((c) => c.id === cid)) {
              throw new AuthzUnavailableError(
                `RECOVERY_AGG_CANDIDATE_BROKEN: incident ${incident.id} candidate ${cid}`,
              );
            }
          }
        }

        // Audit references for this incident target. The actor User join is
        // restricted to the caller's org for the same tenant-projection
        // reason as the candidate join.
        const auditRows = await tx
          .select({
            id: auditLogs.id,
            action: auditLogs.action,
            actorId: auditLogs.actorId,
            actorName: users.name,
            createdAt: auditLogs.createdAt,
          })
          .from(auditLogs)
          .leftJoin(
            users,
            and(
              eq(users.id, auditLogs.actorId),
              eq(users.organizationId, orgId),
            ),
          )
          .where(
            and(
              eq(auditLogs.organizationId, orgId),
              eq(auditLogs.targetType, "incident"),
              eq(auditLogs.targetId, incidentId),
            ),
          )
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id));
        const auditReferences: IncidentAggregateAuditReferenceSummary[] =
          auditRows.map((a) => ({
            id: a.id,
            action: a.action,
            actorId: a.actorId,
            // null actorName is a legitimate audit-contract outcome for an
            // actor whose User row is gone or out-of-org — it is NOT damage
            // being disguised: the actorId is still projected verbatim, and
            // the audit row's own organizationId was the org predicate.
            actorName: a.actorName,
            createdAt: a.createdAt,
          }));

        // Notes derived from note_added events (event payload body), in
        // stable event_sequence order (events come pre-ordered).
        const notes: IncidentAggregateNoteSummary[] = events
          .filter((e) => e.eventType === "note_added")
          .map((e) => ({
            operationId: e.operationId,
            actorId: e.actorId,
            body:
              (e.payload as { body?: string } | null)?.body?.toString() ?? "",
            createdAt: e.createdAt,
          }));

        // Transaction snapshot timestamp — queried INSIDE the RR transaction
        // so it is the actual PostgreSQL snapshot time, not a request-side
        // clock reading. The route passes no `now`; this is the only source.
        // Raw `execute` results bypass Drizzle's column serializers, so the
        // driver hands back timestamptz as text; parse it into a Date.
        const snapshotRows = (await tx.execute(
          sql`SELECT transaction_timestamp() AS ts`, // adr-006-allow: DB snapshot identity stamp (see ADR-006 allowlist entry)
        )) as unknown as Array<{ ts: string }>;
        // Fail fast: an absent / unparseable snapshot stamp means the snapshot
        // contract itself is broken (driver shape drift or empty result) —
        // never silently project 1970-01-01 or Invalid Date.
        const rawSnapshotTs = snapshotRows[0]?.ts;
        const snapshotAt = rawSnapshotTs ? new Date(rawSnapshotTs) : null;
        if (!snapshotAt || Number.isNaN(snapshotAt.getTime())) {
          throw new AuthzUnavailableError(
            `RECOVERY_AGG_SNAPSHOT_TIMESTAMP_INVALID: incident ${incident.id}`,
          );
        }

        const statusActionCandidates = deriveStatusActionCandidates(
          incident.status,
        );

        return {
          incident,
          examSummary: {
            id: examRow.id,
            title: examRow.title,
            status: examRow.status,
            closeAt: examRow.closeAt,
          },
          events: events.map((e) => ({
            id: e.id,
            eventSequence: e.eventSequence,
            eventType: e.eventType,
            commandType: e.commandType,
            operationId: e.operationId,
            actorId: e.actorId,
            beforeVersion: e.beforeVersion,
            afterVersion: e.afterVersion,
            payload: e.payload,
            createdAt: e.createdAt,
          })),
          notes,
          actions: actions.map((a) => ({
            id: a.id,
            actionType: a.actionType,
            actionId: a.actionId,
            attemptId: a.attemptId,
            actorId: a.actorId,
            operationId: a.operationId,
            linkedAt: a.linkedAt,
          })),
          attemptMemberships: attemptMemberships.map((m) => ({
            id: m.id,
            attemptId: m.attemptId,
            relationshipType: m.relationshipType,
            linkedAt: m.linkedAt,
            linkedBy: m.linkedBy,
            operationId: m.operationId,
          })),
          interruptionLinks: interruptionLinks.map((l) => ({
            id: l.id,
            attemptId: l.attemptId,
            interruptionId: l.interruptionId,
            linkedAt: l.linkedAt,
            linkedBy: l.linkedBy,
            operationId: l.operationId,
          })),
          candidateSummaries,
          attemptSummaries,
          timeAdjustmentSummaries,
          auditReferences,
          statusActionCandidates,
          snapshotAt,
        };
      },
      {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      },
    );
  }

  return { listIncidentQueue, getIncidentAggregate };
}

/**
 * Status-derived action candidates per ADR-014 §3.
 *
 * ADR-014 freezes these rules:
 * - `investigate` is allowed ONLY from `open` (it is the `open → investigating`
 *   transition; `investigating` is NOT a self-transition).
 * - `change_severity` is allowed only in non-terminal status.
 * - `resolve` / `dismiss` are allowed from `open | investigating`.
 * - `add_note`, `link_action`, `link_attempt`, `link_interruption` are
 *   append-only side writes allowed in ANY status (including the terminal
 *   `resolved` / `dismissed`) — operators may annotate or correlate after
 *   resolution.
 *
 * These are status-derived candidates ONLY. The route layer further filters
 * by the caller's capabilities and the incident shape (J5-R0 §6.2: action
 * eligibility = capability + resource scope + status; §6.3: the wire
 * `allowedActions` is the per-caller intersection) — a caller without
 * `incident.investigate` / `incident.resolve` sees fewer actions, and an
 * anchored Incident never exposes `link_attempt`.
 */
function deriveStatusActionCandidates(status: string): IncidentAllowedAction[] {
  const APPEND_ONLY: IncidentAllowedAction[] = [
    "add_note",
    "link_action",
    "link_attempt",
    "link_interruption",
  ];
  if (status === "open") {
    return [
      "investigate",
      "add_note",
      "change_severity",
      "resolve",
      "dismiss",
      "link_action",
      "link_attempt",
      "link_interruption",
    ];
  }
  if (status === "investigating") {
    return [
      "add_note",
      "change_severity",
      "resolve",
      "dismiss",
      "link_action",
      "link_attempt",
      "link_interruption",
    ];
  }
  // resolved / dismissed (terminal): only append-only side writes remain.
  return APPEND_ONLY;
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
