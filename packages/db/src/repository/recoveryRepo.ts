import type {
  AttemptTimeAdjustment,
  InterruptionTimePolicy,
  RequestContext,
} from "@exam/domain";
import { AuthzUnavailableError } from "@exam/domain";
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import {
  attemptTimeAdjustments,
  auditLogs,
  candidateProfiles,
  examAttempts,
  examEnrollments,
  examIncidentActions,
  examIncidentAttempts,
  examIncidentInterruptionLinks,
  examIncidents,
  examProctorAssignments,
  exams,
  users,
} from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import { resolveOrganizationId } from "./baseRepo.js";
import { createIncidentRepo, type ExamIncidentRow } from "./incidentRepo.js";
import {
  createAttemptInterruptionEventRepo,
  type AttemptInterruptionEventRow,
} from "./attemptInterruptionEventRepo.js";
import {
  createAttemptInterruptionRepo,
  type AttemptInterruptionRow,
} from "./attemptInterruptionRepo.js";
import type { AttemptTimeAdjustmentRow } from "./attemptTimeAdjustmentRepo.js";
import {
  createAuditLogRepo,
  type AuditLogRowWithActor,
} from "./auditLogRepo.js";

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
   * Final attempt score (examAttempts.score, `total_score`) — null until the
   * attempt is graded. Mirrors the existing attempt-detail wire semantics.
   */
  score: number | null;
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
  policy: InterruptionTimePolicy;
  source: AttemptTimeAdjustment["source"];
  beforeDeadline: Date;
  afterDeadline: Date;
  addedSeconds: number;
  eligibleSeconds: number | null;
  reasonCode: string | null;
  reasonText: string | null;
  actorId: string | null;
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

// ── Attempt Operations Context types (J5-I1A3, contract §6.4) ──

export interface AttemptOperationsInterruptionEpisode {
  interruption: {
    id: string;
    attemptId: string;
    createdAt: Date;
  };
  /**
   * Events of this episode, pre-ordered by `(occurredAt asc, id asc)` — the
   * events table has no `event_sequence` column; occurredAt IS the
   * chronological order (contract §6.4).
   */
  events: AttemptInterruptionEventRow[];
}

export interface AttemptOperationsRelatedIncident {
  id: string;
  status: string;
  severity: string;
  /** Incident description — the wire `title` (navigation stub). */
  title: string;
  /**
   * Most-recent link time across the attempt's memberships and action links —
   * the wire ordering key ("most recently linked first", contract §6.4).
   */
  linkedAt: Date;
}

export interface ExamRecoveryContext {
  examSummary: {
    id: string;
    title: string;
    status: string;
    timingMode: string;
    /** Non-null — the repo fails closed (503) when the timed_window invariant is broken. */
    closeAt: Date;
  };
  incidentStats: {
    total: number;
    byStatus: {
      open: number;
      investigating: number;
      resolved: number;
      dismissed: number;
    };
    bySeverity: {
      info: number;
      minor: number;
      major: number;
      critical: number;
    };
  };
  /** Newest 20 incidents of the exam (createdAt desc, id desc tiebreak). */
  recentIncidents: {
    id: string;
    type: string;
    severity: string;
    status: string;
    createdAt: Date;
  }[];
  /** Current ACTIVE proctor assignments with same-org display names. */
  activeProctors: { userId: string; displayName: string }[];
  /** Counts per attempt status for ALL attempts of the exam. */
  attemptStatusDistribution: Record<string, number>;
  snapshotAt: Date;
}

export type AttemptAllowedAction =
  | "time_grant"
  | "force_submit"
  | "misconduct_mark";

export interface AttemptOperationsContext {
  attempt: {
    id: string;
    examId: string;
    candidateId: string;
    attemptNo: number;
    status: string;
    startedAt: Date | null;
    /** Raw per-attempt deadline. The route computes the effective deadline. */
    deadlineAt: Date | null;
    submittedAt: Date | null;
    gradedAt: Date | null;
    lastActivityAt: Date | null;
    /** Projected: true when the jsonb MisconductFlag is set (null → false). */
    misconduct: boolean;
  };
  /**
   * Exam summary carrying closeAt so the route can compute the canonical
   * effective deadline via `computeEffectiveDeadline` — the repo never
   * re-derives the min(closeAt, deadlineAt) formula (same split as the
   * Incident aggregate).
   */
  examSummary: IncidentAggregateExamSummary;
  candidateSummary: { id: string; displayName: string };
  /**
   * Episodes sorted by `interruption.createdAt` asc (contract §6.4), events
   * within each episode sorted chronologically.
   */
  interruptionEpisodes: AttemptOperationsInterruptionEpisode[];
  /**
   * FULL per-Attempt adjustment ledger (every row for this attempt, all
   * sources) — semantically distinct from the Incident aggregate's
   * incident-scoped `timeAdjustmentSummaries` (contract §6.4 boundary).
   */
  timeAdjustments: AttemptTimeAdjustmentRow[];
  /**
   * Audit trail for the attempt target — same shape and ordering (createdAt
   * asc) as `GET /admin/attempts/:attemptId/timeline`.
   */
  timeline: AuditLogRowWithActor[];
  /**
   * Navigation stubs from attempt memberships ∪ action links, deduplicated by
   * incident id, most recently linked first (contract §6.4).
   */
  relatedIncidents: AttemptOperationsRelatedIncident[];
  /**
   * Status-derived action candidates ONLY. The route intersects them with the
   * caller's capabilities to produce the wire `allowedActions` (same split as
   * `IncidentAggregate.statusActionCandidates`; contract §6.4: real
   * eligibility = caller capability ∩ Attempt state ∩ resource scope).
   */
  statusActionCandidates: AttemptAllowedAction[];
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
    snapshotAt: Date;
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

        // Transaction snapshot timestamp — queried INSIDE the RR transaction
        // (same pattern as the aggregate / attempt / exam reads) so the queue's
        // `snapshotAt` is the actual PostgreSQL snapshot time the rows came
        // from, not a request-side clock. The page's staleness indicator is
        // anchored to this same server snapshot (contract §5.4 / §6.3
        // consistency).
        const snapshotRows = (await tx.execute(
          sql`SELECT transaction_timestamp() AS ts`, // adr-006-allow: DB snapshot identity stamp (see ADR-006 allowlist entry)
        )) as unknown as Array<{ ts: string }>;
        const rawSnapshotTs = snapshotRows[0]?.ts;
        const snapshotAt = rawSnapshotTs ? new Date(rawSnapshotTs) : null;
        if (!snapshotAt || Number.isNaN(snapshotAt.getTime())) {
          throw new AuthzUnavailableError(
            `RECOVERY_QUEUE_SNAPSHOT_TIMESTAMP_INVALID`,
          );
        }

        return { items, nextCursor, snapshotAt };
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

        // The incidentRepo reads accept TenantContext | RequestContext, and
        // `ctx` already carries organizationId (proven by resolveOrganizationId
        // above). Pass ctx directly — no synthetic partial TenantContext cast.
        const incident = await incidentRepo.findById(ctx, incidentId);
        if (!incident) return null;

        // All dimension reads bound to `tx` → same REPEATABLE READ snapshot.
        const events = await incidentRepo.listEventsByIncident(ctx, incidentId);
        const actions = await incidentRepo.listActionsByIncident(
          ctx,
          incidentId,
        );
        const attemptMemberships = await incidentRepo.listAttemptsByIncident(
          ctx,
          incidentId,
        );
        const interruptionLinks =
          await incidentRepo.listInterruptionLinksByIncident(ctx, incidentId);

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
        const timeAdjustmentSummaries: IncidentAggregateTimeAdjustmentSummary[] =
          [];
        // adjustmentById is populated inside the referenced-attempt read block
        // below (only when there are time_grant action links) and consumed in
        // the per-action identity validation that follows.
        let adjustmentById = new Map<
          string,
          {
            id: string;
            attemptId: string;
            policy: InterruptionTimePolicy;
            source: AttemptTimeAdjustment["source"];
            beforeDeadline: Date;
            afterDeadline: Date;
            addedSeconds: number;
            eligibleSeconds: number | null;
            reasonCode: string;
            reasonText: string | null;
            actorId: string | null;
            operationId: string;
            createdAt: Date;
          }
        >();
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
              score: examAttempts.score,
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
              score: a.score,
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

          // Time adjustments referenced by THIS Incident's time_grant action
          // identities ONLY (ADR-014 §7: action_id is the polymorphic referent;
          // for time_grant it is exactly the attempt_time_adjustments.id). The
          // projection is NOT the complete per-Attempt ledger — unrelated grants
          // on the same Attempt (other incidents, administrative adjustments)
          // must NOT leak in. J5-R0 §6.1 freezes the detail field as "linked
          // time grants / actions"; the full per-Attempt ledger belongs to
          // Attempt Operations Context.
          //
          // `actions` is already read above; collect the time_grant referents
          // and fetch by id (the adjustment PK), not by attempt_id.
          const timeGrantActionIds = [
            ...new Set(
              actions
                .filter((a) => a.actionType === "time_grant")
                .map((a) => a.actionId),
            ),
          ];
          const timeAdjRows =
            timeGrantActionIds.length === 0
              ? []
              : await tx
                  .select({
                    id: attemptTimeAdjustments.id,
                    attemptId: attemptTimeAdjustments.attemptId,
                    policy: attemptTimeAdjustments.policy,
                    source: attemptTimeAdjustments.source,
                    beforeDeadline: attemptTimeAdjustments.beforeDeadline,
                    afterDeadline: attemptTimeAdjustments.afterDeadline,
                    addedSeconds: attemptTimeAdjustments.addedSeconds,
                    eligibleSeconds: attemptTimeAdjustments.eligibleSeconds,
                    reasonCode: attemptTimeAdjustments.reasonCode,
                    reasonText: attemptTimeAdjustments.reasonText,
                    actorId: attemptTimeAdjustments.actorId,
                    operationId: attemptTimeAdjustments.operationId,
                    createdAt: attemptTimeAdjustments.createdAt,
                  })
                  .from(attemptTimeAdjustments)
                  .where(
                    and(
                      eq(attemptTimeAdjustments.organizationId, orgId),
                      inArray(attemptTimeAdjustments.id, timeGrantActionIds),
                    ),
                  );
          adjustmentById = new Map(timeAdjRows.map((r) => [r.id, r]));
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
        //
        // Each action link ALSO carries a polymorphic actionId whose referent
        // depends on action_type (ADR-014 §7): for time_grant it is the exact
        // attempt_time_adjustments.id; for force_submit it IS the attemptId
        // itself. action_id is plain text with no DB FK, so the application
        // layer MUST fail-closed validate the referent on read — a missing or
        // attempt-mismatched referent is tenant-graph corruption, never a
        // partial projection. time_grant links additionally drive the
        // timeAdjustmentSummaries projection: each linked adjustment is
        // projected in action-link order (stable; independent of the
        // adjustment's own createdAt), so actions[i] maps to its fact.
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
          switch (act.actionType) {
            case "time_grant": {
              const adjustment = adjustmentById.get(act.actionId);
              if (!adjustment) {
                throw new AuthzUnavailableError(
                  `RECOVERY_AGG_TIME_GRANT_REFERENT_BROKEN: incident ${incident.id} action ${act.id} adjustment ${act.actionId}`,
                );
              }
              if (adjustment.attemptId !== act.attemptId) {
                throw new AuthzUnavailableError(
                  `RECOVERY_AGG_TIME_GRANT_ATTEMPT_MISMATCH: incident ${incident.id} action ${act.id} actionAttempt ${act.attemptId} adjustmentAttempt ${adjustment.attemptId}`,
                );
              }
              timeAdjustmentSummaries.push({
                id: adjustment.id,
                attemptId: adjustment.attemptId,
                policy: adjustment.policy,
                source: adjustment.source,
                beforeDeadline: adjustment.beforeDeadline,
                afterDeadline: adjustment.afterDeadline,
                addedSeconds: adjustment.addedSeconds,
                eligibleSeconds: adjustment.eligibleSeconds,
                reasonCode: adjustment.reasonCode,
                reasonText: adjustment.reasonText,
                actorId: adjustment.actorId,
                operationId: adjustment.operationId,
                createdAt: adjustment.createdAt,
              });
              break;
            }
            case "force_submit": {
              // ADR-014 §7: force_submit action_id IS the force-submitted
              // attemptId (force submit is a one-time terminal fact). The
              // audit-fact existence check is the canonical write command's
              // authority at link time; this read model validates the identity
              // invariant only.
              if (act.actionId !== act.attemptId) {
                throw new AuthzUnavailableError(
                  `RECOVERY_AGG_FORCE_SUBMIT_ACTION_ID_MISMATCH: incident ${incident.id} action ${act.id} actionId ${act.actionId} attemptId ${act.attemptId}`,
                );
              }
              break;
            }
            default: {
              throw new AuthzUnavailableError(
                `RECOVERY_AGG_ACTION_TYPE_UNSUPPORTED: incident ${incident.id} action ${act.id} type ${act.actionType}`,
              );
            }
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
          // candidate_profiles.user_id is NOT NULL, so a missing join row
          // means the same-org User is gone or belongs to another org —
          // tenant-graph corruption. The candidate identity projection must
          // NOT disguise that as an empty display name (the UI would read
          // "user never set a name" while the graph is actually broken).
          // Validation + projection run in ONE iteration over candRows; after
          // narrowing displayName to non-null there is no `as string` left.
          const resolved = new Set<string>();
          candidateSummaries = candRows.map((c) => {
            if (c.displayName == null) {
              throw new AuthzUnavailableError(
                `RECOVERY_AGG_CANDIDATE_USER_BROKEN: incident ${incident.id} candidate ${c.id}`,
              );
            }
            resolved.add(c.id);
            return { id: c.id, displayName: c.displayName };
          });
          for (const cid of candidateIds) {
            if (!resolved.has(cid)) {
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

  /**
   * getAttemptOperationsContext — the full per-Attempt operations ledger
   * (J5-I1A3, contract §6.4).
   *
   * Reads Attempt + Exam + Enrollment + Candidate + interruption episodes +
   * time-adjustment ledger + audit timeline + related incidents from ONE
   * consistent snapshot: a read-only REPEATABLE READ transaction, matching
   * getIncidentAggregate. All dimension reads are bound to the same
   * transaction handle so the Attempt state and its ledger cannot come from
   * different snapshots.
   *
   * - Returns null if the attempt does not exist in the caller's organization
   *   (fail-closed on missing / cross-org; the route maps that to 404
   *   RESOURCE_NOT_FOUND).
   * - Broken parent chain (Exam, Enrollment, CandidateProfile → User) or any
   *   unresolvable relationship (event → episode, adjustment referents,
   *   incident links) fails closed with {@link AuthzUnavailableError} (503
   *   AUTHZ_UNAVAILABLE) — the admin audit surface never silently drops a row
   *   nor disguises corruption as absence.
   * - `timeAdjustments` is the FULL per-Attempt ledger (every adjustment row
   *   for this attempt, all sources) — semantically distinct from the Incident
   *   aggregate's incident-scoped `timeAdjustmentSummaries` (contract §6.4
   *   boundary; the two must never be confused).
   * - `statusActionCandidates` is server-derived from the current attempt
   *   status; the route layer intersects caller capabilities for the wire
   *   `allowedActions`.
   */
  async function getAttemptOperationsContext(
    ctx: TenantContext | RequestContext,
    attemptId: string,
  ): Promise<AttemptOperationsContext | null> {
    const orgId = resolveOrganizationId(ctx);

    return db.transaction(
      async (tx) => {
        // Attempt (org-scoped). Missing / cross-org → null (404 at route).
        const attemptRows = await tx
          .select()
          .from(examAttempts)
          .where(
            and(
              eq(examAttempts.organizationId, orgId),
              eq(examAttempts.id, attemptId),
            ),
          )
          .limit(1);
        const attempt = attemptRows[0];
        if (!attempt) return null;

        // Exam parent — broken chain fails closed (503), same shape as the
        // aggregate. closeAt non-null is the timed_window invariant the
        // canonical effective-deadline helper needs.
        const examRows = await tx
          .select({
            id: exams.id,
            title: exams.title,
            status: exams.status,
            closeAt: exams.closeAt,
          })
          .from(exams)
          .where(
            and(eq(exams.organizationId, orgId), eq(exams.id, attempt.examId)),
          )
          .limit(1);
        const examRow = examRows[0];
        if (!examRow) {
          throw new AuthzUnavailableError(
            `RECOVERY_OP_PARENT_BROKEN: attempt ${attemptId} exam ${attempt.examId}`,
          );
        }
        if (examRow.closeAt == null) {
          throw new AuthzUnavailableError(
            `RECOVERY_OP_EXAM_CLOSEAT_NULL: attempt ${attemptId} exam ${attempt.examId}`,
          );
        }

        // Enrollment parent — must resolve in-org and agree with the attempt's
        // own exam/candidate (scope-quadruple validation, ADR-014 §7 shape).
        const enrollmentRows = await tx
          .select({
            id: examEnrollments.id,
            examId: examEnrollments.examId,
            candidateId: examEnrollments.candidateId,
          })
          .from(examEnrollments)
          .where(
            and(
              eq(examEnrollments.organizationId, orgId),
              eq(examEnrollments.id, attempt.enrollmentId),
            ),
          )
          .limit(1);
        const enrollment = enrollmentRows[0];
        if (!enrollment) {
          throw new AuthzUnavailableError(
            `RECOVERY_OP_ENROLLMENT_BROKEN: attempt ${attemptId} enrollment ${attempt.enrollmentId}`,
          );
        }
        if (
          enrollment.examId !== attempt.examId ||
          enrollment.candidateId !== attempt.candidateId
        ) {
          throw new AuthzUnavailableError(
            `RECOVERY_OP_ENROLLMENT_SCOPE_MISMATCH: attempt ${attemptId} enrollment ${enrollment.id}`,
          );
        }

        // Candidate identity — same-org CandidateProfile joined to a same-org
        // User. candidate_profiles.user_id is NOT NULL, so a missing join row
        // means the same-org User is gone or belongs to another org —
        // tenant-graph corruption, never an empty display name (fail-closed).
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
              eq(candidateProfiles.id, attempt.candidateId),
            ),
          )
          .limit(1);
        const candRow = candRows[0];
        if (!candRow) {
          throw new AuthzUnavailableError(
            `RECOVERY_OP_CANDIDATE_BROKEN: attempt ${attemptId} candidate ${attempt.candidateId}`,
          );
        }
        if (candRow.displayName == null) {
          throw new AuthzUnavailableError(
            `RECOVERY_OP_CANDIDATE_USER_BROKEN: attempt ${attemptId} candidate ${attempt.candidateId}`,
          );
        }

        // Interruption episodes: batch-read the attempt's interruptions and ALL
        // of its events in two queries (never N+1), then group events under
        // their episode preserving the events' chronological order.
        const interruptionRepo = createAttemptInterruptionRepo(tx);
        const eventRepo = createAttemptInterruptionEventRepo(tx);
        const interruptions = await interruptionRepo.findByAttempt(
          ctx,
          attemptId,
        );
        const eventRows = await eventRepo.listByAttempt(ctx, attemptId);
        const episodeIds = new Set(interruptions.map((i) => i.id));
        // Defense-in-depth over the composite FK: an event row whose episode is
        // not among this attempt's episodes is corruption, not absence.
        for (const e of eventRows) {
          if (!episodeIds.has(e.interruptionId)) {
            throw new AuthzUnavailableError(
              `RECOVERY_OP_EVENT_EPISODE_BROKEN: attempt ${attemptId} event ${e.id} interruption ${e.interruptionId}`,
            );
          }
        }
        const eventsByInterruption = new Map<
          string,
          AttemptInterruptionEventRow[]
        >();
        for (const e of eventRows) {
          const list = eventsByInterruption.get(e.interruptionId) ?? [];
          list.push(e);
          eventsByInterruption.set(e.interruptionId, list);
        }
        const interruptionEpisodes: AttemptOperationsInterruptionEpisode[] =
          interruptions.map((i) => ({
            interruption: {
              id: i.id,
              attemptId: i.attemptId,
              createdAt: i.createdAt,
            },
            events: eventsByInterruption.get(i.id) ?? [],
          }));

        // FULL per-Attempt time-adjustment ledger (all sources), ordered by
        // (createdAt asc, id asc).
        const timeAdjustments = await tx
          .select()
          .from(attemptTimeAdjustments)
          .where(
            and(
              eq(attemptTimeAdjustments.organizationId, orgId),
              eq(attemptTimeAdjustments.attemptId, attemptId),
            ),
          )
          .orderBy(
            asc(attemptTimeAdjustments.createdAt),
            asc(attemptTimeAdjustments.id),
          );
        const adjustmentIds = new Set(timeAdjustments.map((t) => t.id));
        // Fail-closed referent validation:
        // - an event's timeAdjustmentId must resolve among this attempt's
        //   ledger rows (the FK is plain-id, not org-composite — a foreign-org
        //   referent is corruption);
        // - an adjustment's interruptionId must be one of this attempt's
        //   episodes (the column has no FK at all).
        for (const e of eventRows) {
          if (e.timeAdjustmentId && !adjustmentIds.has(e.timeAdjustmentId)) {
            throw new AuthzUnavailableError(
              `RECOVERY_OP_EVENT_ADJUSTMENT_REFERENT_BROKEN: attempt ${attemptId} event ${e.id} adjustment ${e.timeAdjustmentId}`,
            );
          }
        }
        for (const t of timeAdjustments) {
          if (t.interruptionId && !episodeIds.has(t.interruptionId)) {
            throw new AuthzUnavailableError(
              `RECOVERY_OP_ADJUSTMENT_INTERRUPTION_BROKEN: attempt ${attemptId} adjustment ${t.id} interruption ${t.interruptionId}`,
            );
          }
        }

        // Audit timeline — loaded BEFORE the relationship-graph validation so
        // the force-submit audit-fact check (ADR-014 §7) can read the canonical
        // `attempt.forceSubmit` fact from the same RR snapshot. Same shape and
        // ordering (createdAt asc) as the timeline endpoint; null actorName is
        // a legitimate audit-contract outcome for an actor whose User row is
        // gone or out-of-org.
        const timeline = await createAuditLogRepo(tx).listByTarget(
          ctx,
          "attempt",
          attemptId,
        );
        const hasForceSubmitFact = timeline.some(
          (e) =>
            e.auditLog.action === "attempt.forceSubmit" &&
            e.auditLog.targetType === "attempt" &&
            e.auditLog.targetId === attemptId,
        );

        // Related incidents (contract §6.4, ADR-014 §7) — the FOUR formal
        // relationship edges: direct anchor ∪ attempt memberships ∪ action
        // links ∪ interruption-evidence links.
        //
        // ADR-014 freezes a link-scope quadruple for EVERY link and an
        // anchor/membership exclusivity rule. The projection validates EVERY
        // edge independently: any single broken edge fails closed (503
        // AUTHZ_UNAVAILABLE) BEFORE dedup — there is no "any-path-passes"
        // relaxation. Only after all edges pass are they folded by incident id
        // (linkedAt = max across the incident's edges), most recently linked
        // first.
        //
        // Adjustment `incidentId` referents are validated with the full
        // quadruple (the wire carries them for navigation) but do NOT enter
        // the related list unless a formal edge also exists — a field that
        // happens to carry an incident id is not a business relationship.
        type RelatedEdge =
          | { kind: "anchor"; incidentId: string; linkedAt: Date }
          | { kind: "membership"; incidentId: string; linkedAt: Date }
          | {
              kind: "action";
              incidentId: string;
              linkedAt: Date;
              actionType: string;
              actionId: string;
              edgeAttemptId: string;
            }
          | {
              kind: "interruption";
              incidentId: string;
              linkedAt: Date;
              linkAttemptId: string;
              interruptionId: string;
            };

        // Direct anchors: incidents whose attempt_id IS this attempt. An
        // anchored incident is the single subject of a single-attempt
        // incident (attemptId set at creation). linkedAt = incident.createdAt.
        const anchorRows = await tx
          .select({
            id: examIncidents.id,
            createdAt: examIncidents.createdAt,
          })
          .from(examIncidents)
          .where(
            and(
              eq(examIncidents.organizationId, orgId),
              eq(examIncidents.attemptId, attemptId),
            ),
          );
        const anchoredIncidentIds = anchorRows.map((r) => r.id);
        const edges: RelatedEdge[] = anchorRows.map((r) => ({
          kind: "anchor",
          incidentId: r.id,
          linkedAt: r.createdAt,
        }));

        // Memberships: exam-wide incident → this attempt (examIncidentAttempts).
        const membershipRows = await tx
          .select({
            incidentId: examIncidentAttempts.incidentId,
            linkedAt: examIncidentAttempts.linkedAt,
          })
          .from(examIncidentAttempts)
          .where(
            and(
              eq(examIncidentAttempts.organizationId, orgId),
              eq(examIncidentAttempts.attemptId, attemptId),
            ),
          );
        for (const m of membershipRows) {
          edges.push({
            kind: "membership",
            incidentId: m.incidentId,
            linkedAt: m.linkedAt,
          });
        }

        // Action links: separately-authoritative operator actions
        // (time_grant / force_submit) linked to this attempt.
        const actionLinkRows = await tx
          .select({
            incidentId: examIncidentActions.incidentId,
            linkedAt: examIncidentActions.linkedAt,
            actionType: examIncidentActions.actionType,
            actionId: examIncidentActions.actionId,
            edgeAttemptId: examIncidentActions.attemptId,
          })
          .from(examIncidentActions)
          .where(
            and(
              eq(examIncidentActions.organizationId, orgId),
              eq(examIncidentActions.attemptId, attemptId),
            ),
          );
        for (const a of actionLinkRows) {
          edges.push({
            kind: "action",
            incidentId: a.incidentId,
            linkedAt: a.linkedAt,
            actionType: a.actionType,
            actionId: a.actionId,
            edgeAttemptId: a.edgeAttemptId,
          });
        }

        // Interruption-evidence links: incidents → this attempt's interruption
        // episodes (examIncidentInterruptionLinks).
        const interruptionLinkRows = await tx
          .select({
            incidentId: examIncidentInterruptionLinks.incidentId,
            linkedAt: examIncidentInterruptionLinks.linkedAt,
            linkAttemptId: examIncidentInterruptionLinks.attemptId,
            interruptionId: examIncidentInterruptionLinks.interruptionId,
          })
          .from(examIncidentInterruptionLinks)
          .where(
            and(
              eq(examIncidentInterruptionLinks.organizationId, orgId),
              eq(examIncidentInterruptionLinks.attemptId, attemptId),
            ),
          );
        for (const l of interruptionLinkRows) {
          edges.push({
            kind: "interruption",
            incidentId: l.incidentId,
            linkedAt: l.linkedAt,
            linkAttemptId: l.linkAttemptId,
            interruptionId: l.interruptionId,
          });
        }

        // Anchor/membership conflict — WHOLE-INCIDENT (ADR-014 §7). An
        // anchored incident must NOT carry any membership row, for this
        // attempt OR any other. The per-attempt membership query above only
        // sees rows for THIS attempt, so an anchor→other-attempt membership
        // would be invisible. Batch-check every anchored incident's full
        // membership set; any row at all is the mutually-exclusive corruption.
        if (anchoredIncidentIds.length > 0) {
          const anchoredMemberships = await tx
            .select({ incidentId: examIncidentAttempts.incidentId })
            .from(examIncidentAttempts)
            .where(
              and(
                eq(examIncidentAttempts.organizationId, orgId),
                inArray(examIncidentAttempts.incidentId, anchoredIncidentIds),
              ),
            )
            .limit(1);
          if (anchoredMemberships.length > 0) {
            throw new AuthzUnavailableError(
              `RECOVERY_OP_ANCHOR_MEMBERSHIP_CONFLICT: attempt ${attemptId} incident ${anchoredMemberships[0]!.incidentId}`,
            );
          }
        }

        // Gather every incident id referenced by any edge, plus the adjustment
        // incidentId referents, then batch-load the incident rows WITH the
        // scope-quadruple columns (examId / attemptId / candidateId) so each
        // edge can be validated against its ADR-014 §7 scope rule.
        const edgeIncidentIds = [...new Set(edges.map((e) => e.incidentId))];
        const adjustmentIncidentIds = [
          ...new Set(
            timeAdjustments
              .map((t) => t.incidentId)
              .filter((id): id is string => id != null),
          ),
        ];
        const allIncidentIds = [
          ...new Set([...edgeIncidentIds, ...adjustmentIncidentIds]),
        ];

        type IncidentProjection = {
          id: string;
          status: string;
          severity: string;
          description: string;
          examId: string;
          attemptId: string | null;
          candidateId: string | null;
        };
        const incidentById = new Map<string, IncidentProjection>();
        if (allIncidentIds.length > 0) {
          const incRows = await tx
            .select({
              id: examIncidents.id,
              status: examIncidents.status,
              severity: examIncidents.severity,
              description: examIncidents.description,
              examId: examIncidents.examId,
              attemptId: examIncidents.attemptId,
              candidateId: examIncidents.candidateId,
            })
            .from(examIncidents)
            .where(
              and(
                eq(examIncidents.organizationId, orgId),
                inArray(examIncidents.id, allIncidentIds),
              ),
            );
          for (const r of incRows) incidentById.set(r.id, r);
          // Existence: every referenced id must resolve in-org.
          for (const id of allIncidentIds) {
            if (!incidentById.has(id)) {
              throw new AuthzUnavailableError(
                `RECOVERY_OP_RELATED_INCIDENT_BROKEN: attempt ${attemptId} incident ${id}`,
              );
            }
          }
        }

        // candidateId focus helper: incident.candidateId is null-or-matching
        // the attempt's candidate (candidate-focused exam-wide incident).
        const candidateOk = (incidentCandidateId: string | null) =>
          incidentCandidateId == null ||
          incidentCandidateId === attempt.candidateId;

        // Validate EVERY edge independently. Any broken edge → 503.
        for (const edge of edges) {
          const inc = incidentById.get(edge.incidentId)!;
          if (edge.kind === "anchor") {
            // Anchor: incident.attemptId == this attempt, same exam, candidate
            // null-or-matching.
            if (
              inc.attemptId !== attemptId ||
              inc.examId !== attempt.examId ||
              !candidateOk(inc.candidateId)
            ) {
              throw new AuthzUnavailableError(
                `RECOVERY_OP_ANCHOR_SCOPE_MISMATCH: attempt ${attemptId} incident ${inc.id}`,
              );
            }
          } else if (edge.kind === "membership") {
            // Membership: incident is exam-wide (attemptId null), same exam,
            // candidate null-or-matching.
            if (
              inc.attemptId !== null ||
              inc.examId !== attempt.examId ||
              !candidateOk(inc.candidateId)
            ) {
              throw new AuthzUnavailableError(
                `RECOVERY_OP_MEMBERSHIP_SCOPE_MISMATCH: attempt ${attemptId} incident ${inc.id}`,
              );
            }
          } else if (edge.kind === "action") {
            // Action: same exam, incident.attemptId null-or-this, candidate
            // null-or-matching, AND referent integrity on the action itself.
            if (
              inc.examId !== attempt.examId ||
              (inc.attemptId !== null && inc.attemptId !== attemptId) ||
              !candidateOk(inc.candidateId)
            ) {
              throw new AuthzUnavailableError(
                `RECOVERY_OP_ACTION_INCIDENT_SCOPE_MISMATCH: attempt ${attemptId} incident ${inc.id}`,
              );
            }
            if (edge.edgeAttemptId !== attemptId) {
              throw new AuthzUnavailableError(
                `RECOVERY_OP_ACTION_ATTEMPT_MISMATCH: attempt ${attemptId} incident ${inc.id}`,
              );
            }
            if (edge.actionType === "time_grant") {
              // actionId must resolve to a row in THIS attempt's adjustment
              // ledger (the FK is plain-id; a foreign-attempt referent is
              // corruption).
              const adj = timeAdjustments.find((t) => t.id === edge.actionId);
              if (!adj || adj.attemptId !== attemptId) {
                throw new AuthzUnavailableError(
                  `RECOVERY_OP_ACTION_TIME_GRANT_REFERENT_BROKEN: attempt ${attemptId} incident ${inc.id} action ${edge.actionId}`,
                );
              }
            } else if (edge.actionType === "force_submit") {
              // actionId == this attempt's id (identity shape) AND the
              // authoritative audit fact exists in this same snapshot.
              if (edge.actionId !== attemptId) {
                throw new AuthzUnavailableError(
                  `RECOVERY_OP_ACTION_FORCE_SUBMIT_IDENTITY_BROKEN: attempt ${attemptId} incident ${inc.id} action ${edge.actionId}`,
                );
              }
              if (!hasForceSubmitFact) {
                throw new AuthzUnavailableError(
                  `RECOVERY_OP_FORCE_SUBMIT_FACT_MISSING: attempt ${attemptId} incident ${inc.id}`,
                );
              }
            } else {
              // Unknown action type — CHECK constraint makes this unreachable,
              // but fail closed rather than silently accept.
              throw new AuthzUnavailableError(
                `RECOVERY_OP_ACTION_TYPE_UNKNOWN: attempt ${attemptId} incident ${inc.id} actionType ${edge.actionType}`,
              );
            }
          } else {
            // Interruption: same exam, incident.attemptId null-or-this,
            // candidate null-or-matching, the link's attempt is this attempt,
            // AND the interruption resolves to one of this attempt's episodes.
            if (
              inc.examId !== attempt.examId ||
              (inc.attemptId !== null && inc.attemptId !== attemptId) ||
              !candidateOk(inc.candidateId)
            ) {
              throw new AuthzUnavailableError(
                `RECOVERY_OP_INTERRUPTION_INCIDENT_SCOPE_MISMATCH: attempt ${attemptId} incident ${inc.id}`,
              );
            }
            if (edge.linkAttemptId !== attemptId) {
              throw new AuthzUnavailableError(
                `RECOVERY_OP_INTERRUPTION_LINK_ATTEMPT_MISMATCH: attempt ${attemptId} incident ${inc.id}`,
              );
            }
            if (!episodeIds.has(edge.interruptionId)) {
              throw new AuthzUnavailableError(
                `RECOVERY_OP_INTERRUPTION_LINK_REFERENT_BROKEN: attempt ${attemptId} incident ${inc.id} interruption ${edge.interruptionId}`,
              );
            }
          }
        }

        // Adjustment incidentId referents — full quadruple validation. They
        // do NOT enter relatedIncidents unless a formal edge also exists.
        for (const incidentId of adjustmentIncidentIds) {
          const inc = incidentById.get(incidentId)!;
          if (
            inc.examId !== attempt.examId ||
            (inc.attemptId !== null && inc.attemptId !== attemptId) ||
            !candidateOk(inc.candidateId)
          ) {
            throw new AuthzUnavailableError(
              `RECOVERY_OP_ADJUSTMENT_INCIDENT_SCOPE_MISMATCH: attempt ${attemptId} incident ${incidentId}`,
            );
          }
        }

        // All edges passed — dedup by incident id, linkedAt = max across the
        // incident's edges, most recently linked first (id desc tiebreaker).
        const latestLinkByIncident = new Map<string, Date>();
        for (const edge of edges) {
          const prev = latestLinkByIncident.get(edge.incidentId);
          if (!prev || edge.linkedAt.getTime() > prev.getTime()) {
            latestLinkByIncident.set(edge.incidentId, edge.linkedAt);
          }
        }
        const relatedIncidents: AttemptOperationsRelatedIncident[] = [
          ...latestLinkByIncident.entries(),
        ]
          .map(([id, linkedAt]) => {
            const inc = incidentById.get(id)!;
            return {
              id,
              status: inc.status,
              severity: inc.severity,
              title: inc.description,
              linkedAt,
            };
          })
          .sort((a, b) => {
            const byTime = b.linkedAt.getTime() - a.linkedAt.getTime();
            if (byTime !== 0) return byTime;
            return b.id.localeCompare(a.id);
          });

        // Transaction snapshot timestamp — queried INSIDE the RR transaction
        // so it is the actual PostgreSQL snapshot time, not a request-side
        // clock reading. Raw `execute` results bypass Drizzle's column
        // serializers, so the driver hands back timestamptz as text.
        const snapshotRows = (await tx.execute(
          sql`SELECT transaction_timestamp() AS ts`, // adr-006-allow: DB snapshot identity stamp (see ADR-006 allowlist entry)
        )) as unknown as Array<{ ts: string }>;
        const rawSnapshotTs = snapshotRows[0]?.ts;
        const snapshotAt = rawSnapshotTs ? new Date(rawSnapshotTs) : null;
        if (!snapshotAt || Number.isNaN(snapshotAt.getTime())) {
          throw new AuthzUnavailableError(
            `RECOVERY_OP_SNAPSHOT_TIMESTAMP_INVALID: attempt ${attemptId}`,
          );
        }

        const statusActionCandidates = deriveAttemptStatusActionCandidates(
          attempt.status,
        );

        return {
          attempt: {
            id: attempt.id,
            examId: attempt.examId,
            candidateId: attempt.candidateId,
            attemptNo: attempt.attemptNo,
            status: attempt.status,
            startedAt: attempt.startedAt,
            deadlineAt: attempt.deadlineAt,
            submittedAt: attempt.submittedAt,
            gradedAt: attempt.gradedAt,
            lastActivityAt: attempt.lastActivityAt,
            misconduct: attempt.misconduct != null,
          },
          examSummary: {
            id: examRow.id,
            title: examRow.title,
            status: examRow.status,
            closeAt: examRow.closeAt,
          },
          candidateSummary: {
            id: candRow.id,
            displayName: candRow.displayName,
          },
          interruptionEpisodes,
          timeAdjustments,
          timeline,
          relatedIncidents,
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

  /**
   * getExamRecoveryContext — the org-wide Exam recovery aggregate (contract
   * §6.5, J5-I1B4): exam summary, incident counts (by status/severity), the
   * newest incidents, active proctors, and the attempt status distribution,
   * read in ONE REPEATABLE READ read-only snapshot.
   *
   * Composition from existing endpoints was evaluated and rejected (§6.5):
   * the incident counts and the attempt status distribution have NO server
   * source elsewhere, and composing the rest would multi-fetch with
   * per-statement snapshot skew. Missing/cross-org exam → null (route maps
   * 404); broken timed_window invariant (null closeAt) or proctor→User
   * resolution → 503 AUTHZ_UNAVAILABLE (fail-closed, never partial).
   */
  async function getExamRecoveryContext(
    ctx: TenantContext | RequestContext,
    examId: string,
  ): Promise<ExamRecoveryContext | null> {
    const orgId = resolveOrganizationId(ctx);
    return db.transaction(
      async (tx) => {
        // 1. Exam — org-scoped; missing/cross-org fails closed to null (404).
        const examRows = await tx
          .select({
            id: exams.id,
            title: exams.title,
            status: exams.status,
            timingMode: exams.timingMode,
            closeAt: exams.closeAt,
          })
          .from(exams)
          .where(and(eq(exams.organizationId, orgId), eq(exams.id, examId)))
          .limit(1);
        const exam = examRows[0];
        if (!exam) return null;
        if (exam.closeAt == null) {
          // timed_window invariant — a null closeAt is tenant-data corruption
          // the deadline surface cannot reason about.
          throw new AuthzUnavailableError(
            `RECOVERY_EXAM_CLOSEAT_NULL: exam ${examId}`,
          );
        }

        // 2. Incident counts — SQL GROUP BY over the org+exam-scoped rows.
        //    status/severity are constrained by CHECK constraints, so the fixed
        //    buckets cover every legal value; an out-of-bucket value is
        //    impossible under the constraint but fail closed (503) rather than
        //    silently drop it — the admin audit surface never disguises
        //    corruption. `total` is the sum of the grouped counts and is
        //    asserted against Σ byStatus and Σ bySeverity for defense-in-depth.
        const byStatus = {
          open: 0,
          investigating: 0,
          resolved: 0,
          dismissed: 0,
        };
        const bySeverity = {
          info: 0,
          minor: 0,
          major: 0,
          critical: 0,
        };
        const incidentGroupRows = await tx
          .select({
            status: examIncidents.status,
            severity: examIncidents.severity,
            count: sql<number>`count(*)::int`,
          })
          .from(examIncidents)
          .where(
            and(
              eq(examIncidents.organizationId, orgId),
              eq(examIncidents.examId, examId),
            ),
          )
          .groupBy(examIncidents.status, examIncidents.severity);
        let total = 0;
        for (const row of incidentGroupRows) {
          if (!(row.status in byStatus)) {
            throw new AuthzUnavailableError(
              `RECOVERY_EXAM_UNKNOWN_INCIDENT_STATUS: exam ${examId} status ${row.status}`,
            );
          }
          if (!(row.severity in bySeverity)) {
            throw new AuthzUnavailableError(
              `RECOVERY_EXAM_UNKNOWN_INCIDENT_SEVERITY: exam ${examId} severity ${row.severity}`,
            );
          }
          byStatus[row.status as keyof typeof byStatus] += row.count;
          bySeverity[row.severity as keyof typeof bySeverity] += row.count;
          total += row.count;
        }
        // Defense-in-depth: total must equal the sum of each bucket dimension.
        const sumByStatus =
          byStatus.open +
          byStatus.investigating +
          byStatus.resolved +
          byStatus.dismissed;
        const sumBySeverity =
          bySeverity.info +
          bySeverity.minor +
          bySeverity.major +
          bySeverity.critical;
        if (total !== sumByStatus || total !== sumBySeverity) {
          throw new AuthzUnavailableError(
            `RECOVERY_EXAM_INCIDENT_TOTAL_MISMATCH: exam ${examId} total ${total} sumByStatus ${sumByStatus} sumBySeverity ${sumBySeverity}`,
          );
        }

        // 3. Recent incidents — newest 20 (createdAt desc, id desc tiebreak).
        const recentIncidents = await tx
          .select({
            id: examIncidents.id,
            type: examIncidents.type,
            severity: examIncidents.severity,
            status: examIncidents.status,
            createdAt: examIncidents.createdAt,
          })
          .from(examIncidents)
          .where(
            and(
              eq(examIncidents.organizationId, orgId),
              eq(examIncidents.examId, examId),
            ),
          )
          .orderBy(desc(examIncidents.createdAt), desc(examIncidents.id))
          .limit(20);

        // 4. Active proctors — current active assignments only (status='active')
        //    with SAME-ORG display names; a missing or cross-org User row is
        //    tenant-graph corruption (fail closed, never an empty-name stub).
        const proctorRows = await tx
          .select({
            userId: examProctorAssignments.proctorUserId,
            displayName: users.name,
          })
          .from(examProctorAssignments)
          .leftJoin(
            users,
            and(
              eq(examProctorAssignments.proctorUserId, users.id),
              eq(users.organizationId, orgId),
            ),
          )
          .where(
            and(
              eq(examProctorAssignments.organizationId, orgId),
              eq(examProctorAssignments.examId, examId),
              eq(examProctorAssignments.status, "active"),
            ),
          )
          .orderBy(asc(users.name), asc(examProctorAssignments.proctorUserId));
        const activeProctors: { userId: string; displayName: string }[] = [];
        for (const p of proctorRows) {
          if (p.displayName == null) {
            throw new AuthzUnavailableError(
              `RECOVERY_EXAM_PROCTOR_USER_BROKEN: exam ${examId} proctor ${p.userId}`,
            );
          }
          activeProctors.push({ userId: p.userId, displayName: p.displayName });
        }

        // 5. Attempt status distribution — SQL GROUP BY over ALL attempts of
        //    the exam. Keys are dynamic (no fixed-bucket constraint), so the
        //    distribution is built straight from the grouped rows.
        const attemptGroupRows = await tx
          .select({
            status: examAttempts.status,
            count: sql<number>`count(*)::int`,
          })
          .from(examAttempts)
          .where(
            and(
              eq(examAttempts.organizationId, orgId),
              eq(examAttempts.examId, examId),
            ),
          )
          .groupBy(examAttempts.status);
        const attemptStatusDistribution: Record<string, number> = {};
        for (const row of attemptGroupRows) {
          attemptStatusDistribution[row.status] = row.count;
        }

        // 6. Transaction snapshot timestamp — queried INSIDE the RR
        //    transaction (same pattern as the Incident aggregate).
        const snapshotRows = (await tx.execute(
          sql`SELECT transaction_timestamp() AS ts`, // adr-006-allow: DB snapshot identity stamp (see ADR-006 allowlist entry)
        )) as unknown as Array<{ ts: string }>;
        const rawSnapshotTs = snapshotRows[0]?.ts;
        const snapshotAt = rawSnapshotTs ? new Date(rawSnapshotTs) : null;
        if (!snapshotAt || Number.isNaN(snapshotAt.getTime())) {
          throw new AuthzUnavailableError(
            `RECOVERY_EXAM_SNAPSHOT_TIMESTAMP_INVALID: exam ${examId}`,
          );
        }

        return {
          examSummary: {
            id: exam.id,
            title: exam.title,
            status: exam.status,
            timingMode: exam.timingMode,
            closeAt: exam.closeAt,
          },
          incidentStats: { total, byStatus, bySeverity },
          recentIncidents,
          activeProctors,
          attemptStatusDistribution,
          snapshotAt,
        };
      },
      {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      },
    );
  }

  return {
    listIncidentQueue,
    getIncidentAggregate,
    getAttemptOperationsContext,
    getExamRecoveryContext,
  };
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

/**
 * Status-derived attempt action candidates (contract §6.4, frozen from the
 * canonical attempt-command preconditions):
 *
 * - `time_grant`: the canonical grant seam requires the attempt to be
 *   `in_progress | disrupted` AFTER deadline reconciliation (operatorGrant:
 *   resurrecting `submitted | grading | graded | voided` is forbidden).
 * - `force_submit`: `voided` is the only truly invalid state (the Admin
 *   force-submit route; `submitted` rows are recovered to `graded`, and
 *   `grading`/`graded` are idempotent no-ops).
 * - `misconduct_mark`: allowed on ANY attempt status (§16).
 *
 * These are status-derived candidates ONLY. The route layer further filters
 * by the caller's capabilities (attempt.time.grant / attempt.force_submit /
 * attempt.misconduct.mark — all Admin-only) to produce the wire
 * `allowedActions` (contract §6.4: eligibility = caller capability ∩ Attempt
 * state ∩ resource scope).
 */
function deriveAttemptStatusActionCandidates(
  status: string,
): AttemptAllowedAction[] {
  const candidates: AttemptAllowedAction[] = [];
  if (status === "in_progress" || status === "disrupted") {
    candidates.push("time_grant");
  }
  if (status !== "voided") {
    candidates.push("force_submit");
  }
  candidates.push("misconduct_mark");
  return candidates;
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
