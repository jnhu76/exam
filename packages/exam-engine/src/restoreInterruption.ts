import type { ExamAttempt, InterruptionTimePolicy } from "@exam/domain";
import { NotFoundError, ValidationError } from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
  RestoreLifecycleOutcome,
} from "./attemptCommands.js";
import { restoreAttemptState } from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import type {
  InterruptionEpisodeRepository,
  InterruptionEventRepository,
  TimeAdjustmentRepository,
} from "./interruptionRepositories.js";
import type { LockedEnrollmentAttemptIdentity } from "./lockSeam.js";
import { ensureAttemptDeadlineReconciled } from "./deadlineReconciliation.js";
import { evaluateInterruptionTimePolicy } from "./interruptionPolicy.js";
import type { EvaluateInterruptionPolicyInput } from "./interruptionPolicy.js";

/**
 * Threaded through the submit terminalization chain (R2/R9). Carries the
 * engine-side interruption repositories so `submitAttempt` can append the
 * terminalized event under the same row lock, without requiring the caller
 * to know about interruption internals.
 *
 * - `mode: "none"` — no active interruption to resolve. Used by deadline
 *   scanner and normal candidate submit when the attempt is `in_progress`.
 * - `mode: "active_interruption"` — the attempt was `disrupted` and the
 *   caller has prepared the terminalization hint. The hint is the output of
 *   the policy evaluator, authored by `restoreInterruptedAttempt`.
 *
 * The union carries NO independent `now` (R9) — the submit function's own
 * `now` is reused.
 */
export type SubmitInterruptionResolution =
  | {
      mode: "none";
      episodeRepo: InterruptionEpisodeRepository;
      eventRepo: InterruptionEventRepository;
    }
  | {
      mode: "active_interruption";
      episodeRepo: InterruptionEpisodeRepository;
      eventRepo: InterruptionEventRepository;
      hint: {
        policy: InterruptionTimePolicy;
        eligibleSeconds: number;
        adjustmentId: string | null;
        reasonCode: string;
      };
    };

/**
 * Compensation decision produced by the restore command, describing the
 * time-grant (or lack thereof) for the interruption.
 */
export interface RestoreCompensation {
  policy: InterruptionTimePolicy;
  interruptionId: string | null;
  eligibleSeconds: number;
  addedSeconds: number;
  adjustmentId: string | null;
}

/**
 * Full result of the composed restore command.
 */
export interface RestoreInterruptionResult {
  attempt: ExamAttempt;
  lifecycle: RestoreLifecycleOutcome;
  compensation: RestoreCompensation;
}

/**
 * Appends a `terminalized` event for the active interruption on a disrupted
 * attempt that is being submitted. Called under the attempt row lock inside
 * `submitAttempt`.
 *
 * The pointer (`currentInterruptionId`, `interruptedAt`) is cleared by
 * `submitAttempt`'s own update — this function only appends the event.
 *
 * Under-lock enforcement (R9):
 *   - `disrupted + mode=none` → fail closed (caller must resolve).
 *   - `in_progress + mode=active_interruption` → fail closed (no active
 *     interruption to terminalize).
 *
 * @param lockedAttempt - The attempt row, already locked FOR UPDATE.
 * @param resolution - The caller's interruption resolution.
 * @param now - The submit function's authoritative timestamp (R9).
 */
export async function resolveActiveInterruptionOnTerminalization(
  lockedAttempt: ExamAttempt,
  resolution: SubmitInterruptionResolution,
  now: Date,
): Promise<void> {
  if (resolution.mode === "none") {
    if (lockedAttempt.status === "disrupted") {
      throw new ValidationError(
        "Cannot submit a disrupted attempt without interruption resolution " +
          "(mode=none is invalid for disrupted status)",
      );
    }
    return;
  }

  // mode === "active_interruption"
  if (lockedAttempt.status !== "disrupted") {
    throw new ValidationError(
      "Cannot resolve active interruption for a non-disrupted attempt " +
        "(mode=active_interruption is invalid for in_progress status)",
    );
  }

  if (!lockedAttempt.currentInterruptionId) {
    throw new ValidationError(
      "Disrupted attempt has no active interruption pointer",
    );
  }

  // Append the terminalized event. The pointer is cleared by submitAttempt's
  // own update (currentInterruptionId=null, interruptedAt=null).
  await resolution.eventRepo.insert({
    attemptId: lockedAttempt.id,
    interruptionId: lockedAttempt.currentInterruptionId,
    eventType: "terminalized",
    occurredAt: now,
    observedLastActivityAt: null,
    detectionSource: null,
    timeoutSeconds: null,
    policy: resolution.hint.policy,
    eligibleSeconds: resolution.hint.eligibleSeconds,
    timeAdjustmentId: resolution.hint.adjustmentId,
    actorId: null,
    reasonCode: resolution.hint.reasonCode,
  });
}

/**
 * Composed restore command for a disrupted attempt. Handles the full
 * lifecycle: policy evaluation, time grant (bounded_grace), deadline
 * reconciliation, and idempotency reconstruction (R10).
 *
 * Lock protocol: the caller must have already acquired the Enrollment lock
 * and hold the EA capability. This function acquires the Exam lock
 * internally.
 *
 * @param examRepo - Exam repository (FOR UPDATE capable).
 * @param attemptRepo - Attempt repository (FOR UPDATE capable).
 * @param enrollmentRepo - Enrollment repository.
 * @param episodeRepo - Interruption episode repository.
 * @param eventRepo - Interruption event repository.
 * @param adjustmentRepo - Time adjustment repository.
 * @param gradingWorksetRepo - Grading workset repository.
 * @param capability - EA lock capability from the canonical seam.
 * @param now - The single authoritative restore timestamp.
 * @returns The restore result with lifecycle outcome and compensation.
 */
export async function restoreInterruptedAttempt(
  examRepo: ExamRepository,
  attemptRepo: AttemptRepository,
  enrollmentRepo: EnrollmentRepository,
  episodeRepo: InterruptionEpisodeRepository,
  eventRepo: InterruptionEventRepository,
  adjustmentRepo: TimeAdjustmentRepository,
  gradingWorksetRepo: GradingWorksetRepository,
  capability: LockedEnrollmentAttemptIdentity,
  now: Date,
): Promise<RestoreInterruptionResult> {
  // 1. Lock the attempt row.
  const attempt = await attemptRepo.findByIdForUpdate(capability.attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }

  // 2. Lock the exam row.
  const exam = await examRepo.findByIdForUpdate(attempt.examId);
  if (!exam) {
    throw new NotFoundError("Exam not found");
  }

  // 3. If the attempt is already in_progress, return immediately.
  if (attempt.status === "in_progress") {
    return {
      attempt,
      lifecycle: "already_in_progress",
      compensation: {
        policy: attempt.interruptionTimingPolicySnapshot?.policy ?? "strict",
        interruptionId: null,
        eligibleSeconds: 0,
        addedSeconds: 0,
        adjustmentId: null,
      },
    };
  }

  // 4. If the attempt is already terminal, reconstruct via idempotency (R10).
  if (
    attempt.status === "submitted" ||
    attempt.status === "grading" ||
    attempt.status === "graded"
  ) {
    return reconstructTerminalOutcome(attempt, eventRepo, adjustmentRepo);
  }

  // 5. If the attempt is not disrupted, fail closed.
  if (attempt.status !== "disrupted") {
    throw new ValidationError(
      `Cannot restore attempt in ${attempt.status} state`,
    );
  }

  // 6. Validate the active interruption pointer.
  if (!attempt.currentInterruptionId) {
    throw new ValidationError(
      "Disrupted attempt has no active interruption pointer",
    );
  }
  const interruptionId = attempt.currentInterruptionId;

  // 7. Resolve the policy snapshot.
  const snapshot = attempt.interruptionTimingPolicySnapshot;
  if (!snapshot) {
    throw new ValidationError(
      "Disrupted attempt has no interruption timing policy snapshot",
    );
  }

  // 8. Evaluate the policy decision.
  const detectedEvent = await eventRepo.findDetected(interruptionId);
  if (!detectedEvent) {
    throw new ValidationError(
      "No detected event found for the active interruption",
    );
  }
  const detectedAt = detectedEvent.occurredAt;

  let addedSeconds = 0;
  let adjustmentId: string | null = null;
  let eligibleSeconds = 0;
  let reasonCode = "";

  if (snapshot.policy === "strict" || snapshot.policy === "operator_incident") {
    eligibleSeconds = 0;
    addedSeconds = 0;
    reasonCode =
      snapshot.policy === "strict"
        ? "strict_zero_grant"
        : "operator_incident_candidate_restore_zero_grant";
  } else if (snapshot.policy === "bounded_grace") {
    const priorBoundedGraceSeconds =
      await adjustmentRepo.sumBoundedGraceSeconds(attempt.id);

    const policyInput: EvaluateInterruptionPolicyInput = {
      snapshot,
      detectedAt,
      decisionNow: now,
      beforeDeadline: attempt.deadlineAt ?? null,
      examCloseAt: exam.closeAt,
      priorBoundedGraceAddedSeconds: priorBoundedGraceSeconds,
    };

    const decision = evaluateInterruptionTimePolicy(policyInput);
    eligibleSeconds = decision.eligibleSeconds;
    addedSeconds = decision.addedSeconds;
    reasonCode = decision.reasonCode;

    if (addedSeconds > 0) {
      if (!attempt.deadlineAt) {
        throw new ValidationError(
          "Cannot grant bounded_grace time without a deadline",
        );
      }
      const adjustment = await adjustmentRepo.insert({
        operationId: `restore-${interruptionId}-${now.getTime()}`,
        attemptId: attempt.id,
        interruptionId,
        incidentId: null,
        policy: "bounded_grace",
        source: "bounded_grace",
        beforeDeadline: attempt.deadlineAt,
        afterDeadline: decision.afterDeadline!,
        addedSeconds,
        eligibleSeconds,
        reasonCode,
        reasonText: null,
        actorId: null,
      });
      adjustmentId = adjustment.id;

      // Update the deadline within the same tx.
      await attemptRepo.update(attempt.id, {
        deadlineAt: decision.afterDeadline!,
      });
    }
  }

  // 9. Build the resolution for deadline reconciliation.
  const resolution: SubmitInterruptionResolution = {
    mode: "active_interruption",
    episodeRepo,
    eventRepo,
    hint: {
      policy: snapshot.policy,
      eligibleSeconds,
      adjustmentId,
      reasonCode,
    },
  };

  // 10. Reconcile deadline (may submit if expired). The resolution ensures
  //     proper terminalization if the deadline has passed.
  const reconciled = await ensureAttemptDeadlineReconciled(
    examRepo,
    enrollmentRepo,
    attemptRepo,
    gradingWorksetRepo,
    capability,
    now,
    resolution,
  );

  // 11. If the deadline reconciliation submitted the attempt, return terminal.
  if (
    reconciled.status === "submitted" ||
    reconciled.status === "grading" ||
    reconciled.status === "graded"
  ) {
    return reconstructTerminalOutcome(reconciled, eventRepo, adjustmentRepo);
  }

  // 12. Restore the attempt lifecycle.
  const lifecycleResult = await restoreAttemptState(attempt, attemptRepo, now);

  // 13. Re-read the attempt after restore.
  const restoredAttempt = await attemptRepo.findById(attempt.id);
  if (!restoredAttempt) {
    throw new NotFoundError("Attempt not found after restore");
  }

  return {
    attempt: restoredAttempt,
    lifecycle: lifecycleResult.outcome,
    compensation: {
      policy: snapshot.policy,
      interruptionId,
      eligibleSeconds,
      addedSeconds,
      adjustmentId,
    },
  };
}

/**
 * Reconstructs a terminal outcome from the latest terminalized event (R10).
 * Used when the attempt is already submitted/grading/graded on entry.
 */
async function reconstructTerminalOutcome(
  attempt: ExamAttempt,
  eventRepo: InterruptionEventRepository,
  adjustmentRepo: TimeAdjustmentRepository,
): Promise<RestoreInterruptionResult> {
  const latestOutcome = await eventRepo.findLatestOutcomeByAttempt(attempt.id);
  if (latestOutcome && latestOutcome.eventType === "terminalized") {
    let adjustmentId: string | null = latestOutcome.timeAdjustmentId ?? null;
    if (adjustmentId) {
      const adjustment = await adjustmentRepo.findById(adjustmentId);
      if (
        !adjustment ||
        adjustment.attemptId !== attempt.id ||
        adjustment.interruptionId !== latestOutcome.interruptionId
      ) {
        adjustmentId = null;
      }
    }
    return {
      attempt,
      lifecycle: "terminal",
      compensation: {
        policy: latestOutcome.policy,
        interruptionId: latestOutcome.interruptionId,
        eligibleSeconds: latestOutcome.eligibleSeconds ?? 0,
        addedSeconds: 0,
        adjustmentId,
      },
    };
  }
  // Terminal without a terminalized event → plain terminal, no compensation.
  return {
    attempt,
    lifecycle: "terminal",
    compensation: {
      policy: attempt.interruptionTimingPolicySnapshot?.policy ?? "strict",
      interruptionId: null,
      eligibleSeconds: 0,
      addedSeconds: 0,
      adjustmentId: null,
    },
  };
}
