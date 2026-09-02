import type {
  AttemptTimingPolicySnapshot,
  Exam,
  InterruptionTimePolicy,
} from "@exam/domain";
import { ValidationError } from "@exam/domain";

/**
 * Canonical reason codes for interruption policy decisions. Stable strings
 * persisted in event/ledger rows; never inferred from timestamps.
 */
export const STRICT_ZERO_GRANT_REASON = "strict_zero_grant";
export const OPERATOR_INCIDENT_ZERO_GRANT_REASON =
  "operator_incident_candidate_restore_zero_grant";
export const BOUNDED_GRACE_REASON = "bounded_grace_auto";

/** Input shape for the pure policy evaluator snapshot resolver. */
export interface ResolveAttemptTimingPolicySnapshotInput {
  /** The Exam's interruption-time policy. Omitted resolves to `strict`. */
  interruptionTimePolicy?: InterruptionTimePolicy;
  interruptionGracePerIncidentSeconds?: number | null;
  interruptionGracePerAttemptSeconds?: number | null;
}

/**
 * Resolves the immutable {@link AttemptTimingPolicySnapshot} to freeze into a
 * new attempt at creation time (ADR-013 §3, R4).
 *
 * Fail-closed rules:
 *   - omitted policy + omitted caps  → `strict` with both caps null;
 *   - unknown policy                 → fail closed;
 *   - `strict` / `operator_incident` with any cap present → fail closed;
 *   - `bounded_grace` with missing/non-positive caps, or
 *     `perIncident > perAttempt`     → fail closed;
 *   - `bounded_grace` well-formed    → carry both positive integer caps.
 *
 * The resolver never copies possibly-optional Exam fields blindly; it
 * validates the policy/cap shape and fails closed on any inconsistency so a
 * mid-attempt Exam edit cannot change an existing attempt's outcome.
 */
export function resolveAttemptTimingPolicySnapshot(
  input: ResolveAttemptTimingPolicySnapshotInput,
): AttemptTimingPolicySnapshot {
  const policy = input.interruptionTimePolicy ?? "strict";
  const perIncident = input.interruptionGracePerIncidentSeconds ?? null;
  const perAttempt = input.interruptionGracePerAttemptSeconds ?? null;

  if (
    policy !== "strict" &&
    policy !== "bounded_grace" &&
    policy !== "operator_incident"
  ) {
    throw new ValidationError(
      `Unknown interruption time policy: ${String(input.interruptionTimePolicy)}`,
    );
  }

  if (policy === "strict" || policy === "operator_incident") {
    if (perIncident !== null || perAttempt !== null) {
      throw new ValidationError(
        `Interruption policy ${policy} must have both caps null`,
      );
    }
    return {
      schemaVersion: 1,
      policy,
      perIncidentCapSeconds: null,
      perAttemptAggregateCapSeconds: null,
    };
  }

  // bounded_grace — both caps must be present, positive integers, ordered.
  if (perIncident == null || perAttempt == null) {
    throw new ValidationError(
      "bounded_grace interruption policy requires both caps",
    );
  }
  if (
    !Number.isInteger(perIncident) ||
    !Number.isInteger(perAttempt) ||
    perIncident <= 0 ||
    perAttempt <= 0
  ) {
    throw new ValidationError(
      "bounded_grace interruption caps must be positive integers",
    );
  }
  if (perIncident > perAttempt) {
    throw new ValidationError(
      "bounded_grace per-incident cap must not exceed per-attempt aggregate cap",
    );
  }
  return {
    schemaVersion: 1,
    policy: "bounded_grace",
    perIncidentCapSeconds: perIncident,
    perAttemptAggregateCapSeconds: perAttempt,
  };
}

/**
 * Convenience overload: resolve directly from an Exam row's optional fields.
 */
export function resolveAttemptTimingPolicySnapshotFromExam(
  exam: Pick<
    Exam,
    | "interruptionTimePolicy"
    | "interruptionGracePerIncidentSeconds"
    | "interruptionGracePerAttemptSeconds"
  >,
): AttemptTimingPolicySnapshot {
  // Read each optional field explicitly so that `exactOptionalPropertyTypes`
  // does not propagate `undefined` into the resolved-input shape.
  const policy = exam.interruptionTimePolicy;
  const perIncident = exam.interruptionGracePerIncidentSeconds;
  const perAttempt = exam.interruptionGracePerAttemptSeconds;
  return resolveAttemptTimingPolicySnapshot({
    ...(policy !== undefined && { interruptionTimePolicy: policy }),
    ...(perIncident !== undefined && {
      interruptionGracePerIncidentSeconds: perIncident,
    }),
    ...(perAttempt !== undefined && {
      interruptionGracePerAttemptSeconds: perAttempt,
    }),
  });
}

/** Input to {@link evaluateInterruptionTimePolicy}. */
export interface EvaluateInterruptionPolicyInput {
  /** The attempt's immutable timing-policy snapshot. */
  snapshot: AttemptTimingPolicySnapshot;
  /** Authoritative detection instant = unique detected event occurredAt. */
  detectedAt: Date;
  /** The single server-captured decision time for this restore. */
  decisionNow: Date;
  /** The attempt's locked current deadlineAt (before any adjustment). */
  beforeDeadline: Date | null;
  /** The exam's locked closeAt — the hard upper bound for any grant. Null
   *  for untimed exams (#291 Phase A), which can never carry a bounded_grace
   *  snapshot, so a null here fails closed in the bounded branch. */
  examCloseAt: Date | null;
  /** Sum of committed bounded_grace added_seconds for this attempt. */
  priorBoundedGraceAddedSeconds: number;
}

/** Output of {@link evaluateInterruptionTimePolicy}. */
export interface InterruptionPolicyDecision {
  policy: InterruptionTimePolicy;
  eligibleSeconds: number;
  addedSeconds: number;
  beforeDeadline: Date | null;
  afterDeadline: Date | null;
  reasonCode: string;
}

/**
 * Pure evaluator for one interruption time-compensation decision
 * (ADR-013 §5, R-G). No repository access, no DB writes.
 *
 * - `strict` and `operator_incident` candidate restore grant zero seconds and
 *   leave the deadline unchanged.
 * - `bounded_grace` computes the four-cap minimum:
 *     eligible (floor of decisionNow - detectedAt seconds, min 0),
 *     per-incident cap (snapshot),
 *     remaining aggregate cap (snapshot - prior bounded grace),
 *     close-room (floor of examCloseAt - beforeDeadline seconds, min 0).
 *
 * Fail-closed: invalid bounded snapshot shape, or a `null` `beforeDeadline`
 * for an active bounded attempt (the engine must not invent a deadline from
 * `now`). `decisionNow < detectedAt` is treated defensively as 0 eligible
 * rather than an error.
 */
export function evaluateInterruptionTimePolicy(
  input: EvaluateInterruptionPolicyInput,
): InterruptionPolicyDecision {
  const { snapshot, detectedAt, decisionNow, beforeDeadline, examCloseAt } =
    input;

  if (snapshot.policy === "strict" || snapshot.policy === "operator_incident") {
    if (
      snapshot.perIncidentCapSeconds !== null ||
      snapshot.perAttemptAggregateCapSeconds !== null
    ) {
      throw new ValidationError(
        `Invalid ${snapshot.policy} snapshot: caps must be null`,
      );
    }
    return {
      policy: snapshot.policy,
      eligibleSeconds: 0,
      addedSeconds: 0,
      beforeDeadline,
      afterDeadline: beforeDeadline,
      reasonCode:
        snapshot.policy === "strict"
          ? STRICT_ZERO_GRANT_REASON
          : OPERATOR_INCIDENT_ZERO_GRANT_REASON,
    };
  }

  // bounded_grace
  const perIncident = snapshot.perIncidentCapSeconds;
  const perAttempt = snapshot.perAttemptAggregateCapSeconds;
  if (
    perIncident == null ||
    perAttempt == null ||
    !Number.isInteger(perIncident) ||
    !Number.isInteger(perAttempt) ||
    perIncident <= 0 ||
    perAttempt <= 0 ||
    perIncident > perAttempt
  ) {
    throw new ValidationError(
      "Invalid bounded_grace snapshot: caps missing, non-positive, or out of order",
    );
  }
  if (beforeDeadline == null) {
    // Active bounded attempt must carry a deadline; never invent one from now.
    throw new ValidationError(
      "bounded_grace restore requires a non-null attempt deadline",
    );
  }
  if (examCloseAt == null) {
    // Untimed exams have no close bound and cannot carry bounded_grace
    // (canonical timing-mode matrix) — never compute an unbounded grant.
    throw new ValidationError(
      "bounded_grace restore requires a non-null exam closeAt",
    );
  }

  // eligibleSeconds: floor(max(0, decisionNow - detectedAt) / 1000)
  const rawEligibleMs = decisionNow.getTime() - detectedAt.getTime();
  const eligibleSeconds = Math.floor(Math.max(0, rawEligibleMs) / 1000);

  // remainingAggregate: max(0, perAttempt - prior)
  const prior = Math.max(0, input.priorBoundedGraceAddedSeconds);
  const remainingAggregateSeconds = Math.max(0, perAttempt - prior);

  // closeRoom: floor(max(0, examCloseAt - beforeDeadline) / 1000)
  const closeRoomMs = examCloseAt.getTime() - beforeDeadline.getTime();
  const closeRoomSeconds = Math.floor(Math.max(0, closeRoomMs) / 1000);

  const addedSeconds = Math.min(
    eligibleSeconds,
    perIncident,
    remainingAggregateSeconds,
    closeRoomSeconds,
  );

  const afterDeadline = new Date(
    beforeDeadline.getTime() + addedSeconds * 1000,
  );

  return {
    policy: "bounded_grace",
    eligibleSeconds,
    addedSeconds,
    beforeDeadline,
    afterDeadline,
    reasonCode: BOUNDED_GRACE_REASON,
  };
}
