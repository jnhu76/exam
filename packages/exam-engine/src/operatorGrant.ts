import type { AttemptTimeAdjustment, ExamAttempt } from "@exam/domain";
import {
  AttemptDeadlineExceedsExamCloseError,
  IdempotencyConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import type {
  InterruptionEpisodeRepository,
  InterruptionEventRepository,
  TimeAdjustmentRepository,
} from "./interruptionRepositories.js";
import {
  assertCapabilityFor,
  type LockedEnrollmentAttemptIdentity,
} from "./lockSeam.js";
import { ensureAttemptDeadlineReconciled } from "./deadlineReconciliation.js";
import type { SubmitInterruptionResolution } from "./restoreInterruption.js";

/**
 * PostgreSQL `integer` upper bound. The `added_seconds` column is a Postgres
 * integer, not an unbounded JS number; reject oversized values up front rather
 * than surfacing a low-level DB error.
 */
const POSTGRES_INTEGER_MAX = 2_147_483_647;

/**
 * Canonical reason code used when an expired `disrupted` attempt is
 * terminalized during an operator-grant transaction's deadline reconciliation.
 * Mirrors the policy-evaluator reason-code sourcing convention: a stable
 * string persisted in the terminalized event, never inferred from timestamps.
 */
const OPERATOR_GRANT_DEADLINE_RECONCILIATION_REASON =
  "operator_grant_deadline_reconciliation";

/** RFC 4122 UUID (canonical/​hyphenated form, case-insensitive). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Determines whether a committed adjustment row is the exact same operator
 * grant command as the incoming request. Used by the idempotency check: an
 * existing row that matches every field is a replay (same command), while any
 * mismatch is an idempotency identity conflict (ADR-013 §9).
 */
function isSameOperatorGrantOperation(
  existing: AttemptTimeAdjustment,
  attemptId: string,
  addedSeconds: number,
  reasonCode: string,
  reasonText: string,
  actorId: string,
  interruptionId: string | null,
  incidentId: string | null,
): boolean {
  return (
    existing.attemptId === attemptId &&
    existing.addedSeconds === addedSeconds &&
    existing.reasonCode === reasonCode &&
    existing.reasonText === reasonText &&
    existing.actorId === actorId &&
    (existing.interruptionId ?? null) === interruptionId &&
    (existing.incidentId ?? null) === incidentId &&
    existing.source === "operator" &&
    existing.policy === "operator_incident" &&
    existing.eligibleSeconds === null
  );
}

/**
 * Caller-supplied input for an operator time grant (ADR-013 §5
 * `operator_incident`). `operationId` is command identity, not a dedupe field:
 * same identity + same payload returns the committed result; same identity +
 * different payload conflicts (ADR-013 §9).
 */
export interface GrantAttemptTimeInput {
  /** Target attempt, already locked by the EA capability. */
  attemptId: string;
  /** Stable caller-supplied idempotency identity. Must be a UUID. */
  operationId: string;
  /** Positive seconds to add. Must be a positive PostgreSQL integer. */
  addedSeconds: number;
  /** Operator-authored reason code (non-empty, ≤ 100 chars). */
  reasonCode: string;
  /** Operator-authored reason text (non-empty, bounded). */
  reasonText: string;
  /** Optional interruption the grant addresses; must belong to the attempt. */
  interruptionId?: string | null;
  /** Reserved for REC-I6; must be null in B1. */
  incidentId?: string | null;
  /** Authenticated operator. */
  actorId: string;
  /** Single authoritative command timestamp. */
  now: Date;
}

/**
 * Optional Incident validation port for the combined grant+link path
 * (ADR-014 §10). When `input.incidentId` is non-null, the grant command MUST
 * validate the Incident scope BEFORE deadline reconciliation runs — never after.
 *
 * The lookup is ctx-organization-scoped at the adapter layer, so a null result
 * proves both "missing" and "cross-org" (→ 404 RESOURCE_NOT_FOUND). The
 * returned values are server-derived from the authoritative Incident row; the
 * request body carries only the identifier.
 */
export interface IncidentGrantValidator {
  findForGrantValidation(incidentId: string): Promise<{
    examId: string;
    attemptId: string | null;
    candidateId: string | null;
  } | null>;
}

/** Outcome of {@link grantAttemptTime}. */
export type GrantOutcome = "granted" | "terminal" | "idempotent_replay";

/** Result of {@link grantAttemptTime}. */
export interface GrantAttemptTimeResult {
  /** Post-grant (or post-reconcile-terminal) attempt. */
  attempt: ExamAttempt;
  outcome: GrantOutcome;
  /**
   * Inserted row on `granted`; the committed existing row on
   * `idempotent_replay`; null on `terminal`.
   */
  adjustment: AttemptTimeAdjustment | null;
  /** 0 on `terminal`; the applied seconds otherwise. */
  addedSeconds: number;
}

/**
 * Operator-initiated positive deadline grant (ADR-013 §5 `operator_incident`,
 * §7 ordering, §8 ledger, §9 transaction/lock/idempotency).
 *
 * This command performs the ledger insert and deadline update through
 * **caller-supplied transaction-bound repositories**. It is
 * transaction-*compatible*, not atomic by itself: the B2 caller MUST execute
 * it inside `executeInTransaction` so the ledger insert and deadline update
 * commit and roll back together. ADR-013 forbids operator grants from
 * resurrecting `submitted | grading | graded | voided`.
 *
 * Frozen order:
 *   1. assert EA capability affinity;
 *   2. re-read the locked Attempt, then lock the Exam;
 *   3. normalize + validate inputs;
 *   4. operationId replay/conflict check;
 *   5. validate the `operator_incident` policy snapshot;
 *   5b. validate the optional Incident scope quadruple (ADR-014 §10) — BEFORE
 *       deadline reconciliation, so an expired Attempt + invalid incidentId
 *       cannot terminalize and skip validation;
 *   6. reconcile the deadline (may terminalize);
 *   7. if terminal: return, no grant;
 *   8. validate optional interruption episode ownership;
 *   9. require the attempt still `in_progress | disrupted`;
 *   10. compute afterDeadline with arithmetic safety;
 *   11. reject (no silent clamp) if `afterDeadline > exam.closeAt`;
 *   12. insert the append-only operator adjustment;
 *   13. update `attempt.deadlineAt`;
 *   14. re-read the attempt and return it with the adjustment.
 *
 * @throws {Error} EA capability transaction-affinity violation.
 * @throws {NotFoundError} attempt, exam, or incident not found under lock.
 * @throws {ValidationError} malformed input, missing/wrong policy snapshot,
 *   interruption episode not owned, or Incident scope-quadruple mismatch.
 * @throws {InvalidStateTransitionError} attempt snapshot policy is not
 *   `operator_incident`, or post-reconcile status is not grantable.
 * @throws {IdempotencyConflictError} operationId replayed with a differing
 *   payload.
 * @throws {AttemptDeadlineExceedsExamCloseError} the new deadline would exceed
 *   `exam.closeAt`.
 */
export async function grantAttemptTime(
  examRepo: ExamRepository,
  attemptRepo: AttemptRepository,
  enrollmentRepo: EnrollmentRepository,
  episodeRepo: InterruptionEpisodeRepository,
  eventRepo: InterruptionEventRepository,
  adjustmentRepo: TimeAdjustmentRepository,
  gradingWorksetRepo: GradingWorksetRepository,
  incidentGrantValidator: IncidentGrantValidator | null,
  capability: LockedEnrollmentAttemptIdentity,
  input: GrantAttemptTimeInput,
): Promise<GrantAttemptTimeResult> {
  // 1. Assert EA capability affinity BEFORE any further use — proves the
  //    caller minted the capability via the canonical seam against this exact
  //    tx-bound repo pair, and that the Attempt row lock is held through here.
  assertCapabilityFor(capability, enrollmentRepo, attemptRepo);

  // 2. Re-read the locked Attempt (the capability carries no mutable
  //    snapshot), then lock the Exam. The Attempt row was already locked by
  //    lockEnrollmentAndAttempt; the same-tx re-lock is the established
  //    project pattern (matches restoreInterruptedAttempt).
  const attempt = await attemptRepo.findByIdForUpdate(capability.attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }
  const exam = await examRepo.findByIdForUpdate(attempt.examId);
  if (!exam) {
    throw new NotFoundError("Exam not found");
  }

  // 3. Normalize and validate inputs. Canonicalization happens up front so
  //    validation, idempotency comparison, and the ledger write all use the
  //    same canonical values (prevents " x " vs "x" from looking like a
  //    different payload on retry).
  const { attemptId, operationId, addedSeconds, actorId, now } = input;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new ValidationError("now must be a valid timestamp");
  }
  if (attemptId !== capability.attemptId) {
    throw new ValidationError(
      "Grant attemptId does not match the locked attempt",
    );
  }
  if (!UUID_RE.test(operationId)) {
    throw new ValidationError("operationId must be a valid UUID");
  }
  // Validate incidentId as a UUID BEFORE any Incident lookup or deadline
  // reconciliation (P2-E): a malformed identifier must fail closed with a
  // clean VALIDATION_ERROR, never reach the DB or the audit path.
  if (input.incidentId != null && !UUID_RE.test(input.incidentId)) {
    throw new ValidationError("incidentId must be a valid UUID");
  }
  if (actorId.trim().length === 0) {
    throw new ValidationError("actorId must not be empty");
  }
  const reasonCode = input.reasonCode.trim();
  if (reasonCode.length === 0) {
    throw new ValidationError("reasonCode must not be empty");
  }
  if (reasonCode.length > 100) {
    throw new ValidationError("reasonCode must be at most 100 chars");
  }
  const reasonText = input.reasonText.trim();
  if (reasonText.length === 0) {
    throw new ValidationError("reasonText must not be empty");
  }
  if (reasonText.length > 1000) {
    throw new ValidationError("reasonText must be at most 1000 chars");
  }
  if (
    !Number.isInteger(addedSeconds) ||
    addedSeconds <= 0 ||
    addedSeconds > POSTGRES_INTEGER_MAX
  ) {
    throw new ValidationError(
      "addedSeconds must be a positive PostgreSQL integer",
    );
  }
  const interruptionId = input.interruptionId ?? null;

  // 4. operationId replay / conflict check. `operationId` is command
  //    identity: the same identity + the same payload returns the committed
  //    result (idempotent_replay); any mismatch is an idempotency identity
  //    conflict (ADR-013 §9), including rows belonging to bounded_grace,
  //    administrative_correction, system_incident, or a different attempt.
  const existing = await adjustmentRepo.findByOperationId(operationId);
  if (existing) {
    if (
      !isSameOperatorGrantOperation(
        existing,
        attemptId,
        addedSeconds,
        reasonCode,
        reasonText,
        actorId,
        interruptionId,
        input.incidentId ?? null,
      )
    ) {
      throw new IdempotencyConflictError();
    }
    const replayedAttempt = await attemptRepo.findById(attemptId);
    if (!replayedAttempt) {
      throw new NotFoundError("Attempt not found during idempotent replay");
    }
    return {
      attempt: replayedAttempt,
      outcome: "idempotent_replay",
      adjustment: existing,
      addedSeconds: existing.addedSeconds,
    };
  }

  // 5. Validate the operator_incident policy snapshot. The operator grant is
  //    authorized only for attempts frozen under operator_incident; it must
  //    not become a silent override backdoor for strict / bounded_grace
  //    attempts.
  const snapshot = attempt.interruptionTimingPolicySnapshot;
  if (!snapshot) {
    throw new ValidationError(
      "Attempt has no interruption timing policy snapshot",
    );
  }
  if (snapshot.policy !== "operator_incident") {
    throw new InvalidStateTransitionError(
      "Operator time grant requires operator_incident policy",
    );
  }

  // 5b. Validate the Incident scope quadruple (ADR-014 §10/§7) BEFORE deadline
  //     reconciliation. This must run BEFORE reconciliation so that an expired
  //     Attempt + invalid incidentId cannot terminalize the Attempt and then
  //     skip validation via the terminal-outcome short-circuit. The frozen
  //     order is: operationId replay → policy snapshot → Incident validation
  //     → deadline reconciliation → terminal/grant.
  //
  //     This is a NON-LOCKING read of the authoritative Incident row; it does
  //     not introduce a reverse lock order against the ADR-013 chain.
  //     Missing/cross-org Incident → 404 RESOURCE_NOT_FOUND; same-org but wrong
  //     exam/attempt/candidate → 400 VALIDATION_ERROR.
  if (input.incidentId != null) {
    if (!incidentGrantValidator) {
      throw new ValidationError(
        "incidentId requires an incident grant validator",
      );
    }
    const incident = await incidentGrantValidator.findForGrantValidation(
      input.incidentId,
    );
    if (!incident) {
      throw new NotFoundError("Incident not found");
    }
    if (incident.examId !== attempt.examId) {
      throw new ValidationError(
        "Incident belongs to a different exam than the attempt",
      );
    }
    if (incident.attemptId != null && incident.attemptId !== attempt.id) {
      throw new ValidationError("Incident is anchored to a different attempt");
    }
    if (
      incident.candidateId != null &&
      incident.candidateId !== attempt.candidateId
    ) {
      throw new ValidationError(
        "Incident candidate does not match the attempt candidate",
      );
    }
  }

  // 6. Reconcile the deadline. Expired in_progress → terminalized via
  //    mode none; expired disrupted → terminalized with the terminalized
  //    event + pointer clearing via mode active_interruption. Both end the
  //    command with outcome terminal and no grant, so an expired attempt
  //    cannot escape terminal via a grant.
  const resolution: SubmitInterruptionResolution =
    attempt.status === "disrupted"
      ? {
          mode: "active_interruption",
          episodeRepo,
          eventRepo,
          hint: {
            policy: snapshot.policy,
            eligibleSeconds: null,
            adjustmentId: null,
            reasonCode: OPERATOR_GRANT_DEADLINE_RECONCILIATION_REASON,
          },
        }
      : { mode: "none", episodeRepo, eventRepo };

  const reconciled = await ensureAttemptDeadlineReconciled(
    examRepo,
    enrollmentRepo,
    attemptRepo,
    gradingWorksetRepo,
    capability,
    now,
    resolution,
  );

  // 7. If reconciliation terminalized the attempt, return terminal — no grant.
  //    Terminal wins over interruption validation: a terminal attempt never
  //    performs an episode lookup, ledger insert, or deadline grant regardless
  //    of the interruptionId supplied.
  if (
    reconciled.status === "submitted" ||
    reconciled.status === "grading" ||
    reconciled.status === "graded" ||
    reconciled.status === "voided"
  ) {
    return {
      attempt: reconciled,
      outcome: "terminal",
      adjustment: null,
      addedSeconds: 0,
    };
  }

  // 8. Validate optional interruption episode ownership via the canonical
  //    episode port. This runs only for still-active attempts (terminal wins).
  //    Normalize omitted interruptionId to null in step 3; here we validate
  //    non-null references as canonical UUIDs before any repository access,
  //    then load via the episode port. This legally references the current
  //    active episode, restored historical episodes, strict/operator_incident
  //    historical episodes, and bounded episodes that produced no positive
  //    adjustment. The DB composite FK remains the last line of defense.
  if (interruptionId !== null && !UUID_RE.test(interruptionId)) {
    throw new ValidationError("interruptionId must be a valid UUID");
  }
  if (interruptionId !== null) {
    const episode = await episodeRepo.findByAttemptForUpdate(
      attempt.id,
      interruptionId,
    );
    if (!episode || episode.attemptId !== attempt.id) {
      throw new ValidationError(
        "Interruption episode does not belong to this attempt",
      );
    }
  }

  // 9. Require the attempt still be grantable after reconciliation.
  if (
    reconciled.status !== "in_progress" &&
    reconciled.status !== "disrupted"
  ) {
    throw new InvalidStateTransitionError(
      `Cannot grant time for attempt in ${reconciled.status} state`,
    );
  }

  // 10. Compute afterDeadline with arithmetic safety. The beforeDeadline is
  //     the reconciled attempt's current deadline; a missing deadline is a
  //     protocol violation (timed_window active attempts always carry one).
  const beforeDeadline = reconciled.deadlineAt;
  if (!beforeDeadline) {
    throw new ValidationError(
      "Cannot grant operator time without an attempt deadline",
    );
  }
  const afterMs = beforeDeadline.getTime() + addedSeconds * 1000;
  if (!Number.isSafeInteger(afterMs)) {
    throw new ValidationError("Calculated deadline is out of range");
  }
  const afterDeadline = new Date(afterMs);
  if (Number.isNaN(afterDeadline.getTime())) {
    throw new ValidationError("Calculated deadline is invalid");
  }

  // #291 Phase A: untimed exams have no closeAt to grant against (and can
  // never carry the operator_incident snapshot policy — canonical matrix).
  if (exam.closeAt === null) {
    throw new ValidationError(
      "Cannot grant operator time on an exam without closeAt",
    );
  }

  // 11. Reject (no silent clamp) if the new deadline would exceed exam.closeAt.
  if (afterDeadline.getTime() > exam.closeAt.getTime()) {
    throw new AttemptDeadlineExceedsExamCloseError({
      newDeadlineAt: afterDeadline,
      examCloseAt: exam.closeAt,
    });
  }

  // 12. Insert the append-only operator adjustment. policy is the proven
  //     operator_incident snapshot policy; source is operator; the non-null
  //     actorId + non-empty reasonText satisfy the source_shape CHECK.
  const adjustment = await adjustmentRepo.insert({
    operationId,
    attemptId,
    interruptionId,
    incidentId: input.incidentId ?? null,
    policy: snapshot.policy,
    source: "operator",
    beforeDeadline,
    afterDeadline,
    addedSeconds,
    eligibleSeconds: null,
    reasonCode,
    reasonText,
    actorId,
  });

  // 13. Update the attempt deadline. The B2 caller's executeInTransaction
  //     owns the ledger+deadline atomicity (commit/rollback together).
  const updated = await attemptRepo.update(attemptId, {
    deadlineAt: afterDeadline,
  });
  if (!updated) {
    throw new NotFoundError("Attempt not found after deadline update");
  }

  // 14. Re-read the authoritative attempt and return.
  const finalAttempt = await attemptRepo.findById(attemptId);
  if (!finalAttempt) {
    throw new NotFoundError("Attempt not found after grant");
  }

  return {
    attempt: finalAttempt,
    outcome: "granted",
    adjustment,
    addedSeconds,
  };
}
