/**
 * Incident→attempt relationship-graph validation (ADR-014 §7 scope quadruple).
 *
 * WHY a shared module: the composite foreign keys on `exam_incident_attempts`,
 * `exam_incident_actions` and `exam_incident_interruption_links` only prove
 * (organization, attempt) consistency. They do NOT prove
 * `incident.examId == attempt.examId`, nor that a candidate-focused incident's
 * linked attempt belongs to that candidate. Every read surface that projects a
 * link row must therefore re-verify the scope quadruple in the application
 * layer and FAIL CLOSED on contradiction — never silently omit a link, never
 * disguise corruption as absence.
 *
 * INVARIANT: this validator is the single authority for that verification. The
 * Admin recovery aggregate and the Proctor Recovery Center detail projection
 * MUST both run it; a surface that validates only its own subset of
 * relationships would leak ids whose scope the incident does not own
 * (assignment scope must come from one canonical owner).
 *
 * OWNERSHIP: reading the referenced attempts (and the incident's own row) is
 * caller-owned — this module performs no I/O. Callers batch-read every
 * referenced attempt into `attemptById`, keyed by attempt id, restricted to the
 * caller's organization; a referenced id absent from that map is therefore
 * either missing or cross-org, and both are corruption from the graph's point
 * of view.
 *
 * The validator throws {@link AuthzUnavailableError} (HTTP 503
 * AUTHZ_UNAVAILABLE at the route) with the caller's surface prefix, so each
 * surface keeps its own diagnostic codes while sharing one invariant:
 * `{prefix}_ANCHOR_BROKEN`, `{prefix}_ANCHOR_EXAM_MISMATCH`,
 * `{prefix}_ANCHOR_CANDIDATE_MISMATCH`, `{prefix}_ANCHOR_MEMBERSHIP_CONFLICT`,
 * `{prefix}_MEMBERSHIP_{BROKEN,EXAM_MISMATCH,CANDIDATE_MISMATCH}`,
 * `{prefix}_ACTION_ATTEMPT_SCOPE`, `{prefix}_ACTION_TYPE_UNSUPPORTED`,
 * `{prefix}_FORCE_SUBMIT_ACTION_ID_MISMATCH`,
 * `{prefix}_INTERRUPTION_ATTEMPT_SCOPE`.
 */
import { AuthzUnavailableError } from "@exam/domain";

/**
 * The exam + candidate legs of the ADR-014 §7 link scope quadruple. The
 * organization leg is enforced by every caller's in-org batch read and the
 * `incident.attemptId` leg (anchor identity / null-or-matching link target) by
 * {@link validateIncidentRelationshipGraph}; resolution is `attemptById`.
 */
export function incidentScopeViolation(
  incident: { examId: string; candidateId: string | null },
  attempt: { examId: string; candidateId: string | null },
): "EXAM_MISMATCH" | "CANDIDATE_MISMATCH" | null {
  if (attempt.examId !== incident.examId) return "EXAM_MISMATCH";
  if (
    incident.candidateId != null &&
    attempt.candidateId !== incident.candidateId
  ) {
    return "CANDIDATE_MISMATCH";
  }
  return null;
}

interface IncidentGraphIncident {
  id: string;
  examId: string;
  /** Non-null → anchored incident; anchor and membership are exclusive. */
  attemptId: string | null;
  /** Non-null → candidate-focused incident (candidate matrix applies). */
  candidateId: string | null;
}

interface IncidentGraphAttempt {
  examId: string;
  candidateId: string | null;
}

interface IncidentGraphActionLink {
  id: string;
  actionType: string;
  actionId: string;
  attemptId: string;
}

interface IncidentGraphInterruptionLink {
  id: string;
  attemptId: string;
}

/**
 * Fail-closed verification of the whole incident relationship graph.
 *
 * Reports each violation as a stable `{prefix}_{LEG}` code so callers keep
 * their own diagnostic namespace while the invariant stays in one place.
 */
export function validateIncidentRelationshipGraph(input: {
  /** Diagnostic namespace, e.g. `RECOVERY_AGG` or `RECOVERY_PROCTOR_DETAIL`. */
  codePrefix: string;
  incident: IncidentGraphIncident;
  /** Batch-read, in-org attempts keyed by id. Never mutated. */
  attemptById: ReadonlyMap<string, IncidentGraphAttempt>;
  attemptMemberships: readonly { id: string; attemptId: string }[];
  actionLinks: readonly IncidentGraphActionLink[];
  interruptionLinks: readonly IncidentGraphInterruptionLink[];
}): void {
  const {
    codePrefix,
    incident,
    attemptById,
    attemptMemberships,
    actionLinks,
    interruptionLinks,
  } = input;

  const fail: (leg: string, detail: string) => never = (leg, detail) => {
    throw new AuthzUnavailableError(`${codePrefix}_${leg}: ${detail}`);
  };

  // Anchor and membership are MUTUALLY EXCLUSIVE (ADR-014 §2): an anchored
  // Incident (attemptId set) rejects membership rows. A historical row carrying
  // both is tenant-data corruption, not a graph to project.
  if (incident.attemptId !== null && attemptMemberships.length > 0) {
    fail("ANCHOR_MEMBERSHIP_CONFLICT", `incident ${incident.id}`);
  }

  // Anchor attempt (if any) MUST resolve and belong to the incident's exam; its
  // candidate MUST match the incident focus when set.
  if (incident.attemptId !== null) {
    const anchor = attemptById.get(incident.attemptId);
    if (!anchor) {
      fail(
        "ANCHOR_BROKEN",
        `incident ${incident.id} attempt ${incident.attemptId}`,
      );
    }
    const violation = incidentScopeViolation(incident, anchor);
    if (violation === "EXAM_MISMATCH") {
      fail(
        "ANCHOR_EXAM_MISMATCH",
        `incident ${incident.id} attempt ${incident.attemptId} exam ${anchor.examId}`,
      );
    }
    if (violation === "CANDIDATE_MISMATCH") {
      fail(
        "ANCHOR_CANDIDATE_MISMATCH",
        `incident ${incident.id} attempt ${incident.attemptId} candidate ${anchor.candidateId ?? "null"}`,
      );
    }
  }

  // Every membership MUST resolve to an attempt of the incident's exam; for a
  // candidate-focused incident, every membership attempt MUST belong to that
  // candidate (ADR-014 §7 candidate matrix).
  for (const membership of attemptMemberships) {
    const attempt = attemptById.get(membership.attemptId);
    if (!attempt) {
      fail(
        "MEMBERSHIP_BROKEN",
        `incident ${incident.id} membership ${membership.id} attempt ${membership.attemptId}`,
      );
    }
    const violation = incidentScopeViolation(incident, attempt);
    if (violation === "EXAM_MISMATCH") {
      fail(
        "MEMBERSHIP_EXAM_MISMATCH",
        `incident ${incident.id} membership ${membership.id} attempt ${membership.attemptId} exam ${attempt.examId}`,
      );
    }
    if (violation === "CANDIDATE_MISMATCH") {
      fail(
        "MEMBERSHIP_CANDIDATE_MISMATCH",
        `incident ${incident.id} membership ${membership.id} attempt ${membership.attemptId} candidate ${attempt.candidateId ?? "null"}`,
      );
    }
  }

  // Action links and interruption links each carry an attemptId that MUST
  // resolve in-org and satisfy the scope quadruple — but the attempt does NOT
  // need to be a membership: ADR-014 §7 treats anchor, membership, operator
  // action links and interruption evidence links as INDEPENDENT durable
  // relationships (the canonical time-grant path atomically creates a time
  // adjustment + action link without a membership row). An anchored incident
  // rejects membership, but its action / interruption links still MUST point at
  // the anchor attempt.
  //
  // The polymorphic `actionId` referent is validated by the surface that can
  // read it: for time_grant it is an `attempt_time_adjustments.id` and for
  // force_submit it IS the attemptId (ADR-014 §7), so the identity legs a read
  // surface can always prove — the action must target the incident's anchor
  // when anchored, and force_submit's actionId must equal its attemptId —
  // belong here.
  for (const action of actionLinks) {
    const attempt = attemptById.get(action.attemptId);
    if (
      !attempt ||
      (incident.attemptId !== null &&
        action.attemptId !== incident.attemptId) ||
      incidentScopeViolation(incident, attempt) !== null
    ) {
      fail(
        "ACTION_ATTEMPT_SCOPE",
        `incident ${incident.id} action ${action.id} attempt ${action.attemptId}`,
      );
    }
    switch (action.actionType) {
      case "time_grant":
        break;
      case "force_submit": {
        if (action.actionId !== action.attemptId) {
          fail(
            "FORCE_SUBMIT_ACTION_ID_MISMATCH",
            `incident ${incident.id} action ${action.id} actionId ${action.actionId} attemptId ${action.attemptId}`,
          );
        }
        break;
      }
      default: {
        fail(
          "ACTION_TYPE_UNSUPPORTED",
          `incident ${incident.id} action ${action.id} type ${action.actionType}`,
        );
      }
    }
  }

  for (const link of interruptionLinks) {
    const attempt = attemptById.get(link.attemptId);
    if (
      !attempt ||
      (incident.attemptId !== null && link.attemptId !== incident.attemptId) ||
      incidentScopeViolation(incident, attempt) !== null
    ) {
      fail(
        "INTERRUPTION_ATTEMPT_SCOPE",
        `incident ${incident.id} interruptionLink ${link.id} attempt ${link.attemptId}`,
      );
    }
  }
}
