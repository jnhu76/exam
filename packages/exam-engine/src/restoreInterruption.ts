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
import { assertCapabilityFor } from "./lockSeam.js";
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
        eligibleSeconds: number | null;
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
  if (!lockedAttempt.interruptedAt) {
    throw new ValidationError(
      "Disrupted attempt has no interruptedAt timestamp",
    );
  }

  const interruptionId = lockedAttempt.currentInterruptionId;

  // #5: Validate episode identity before inserting terminalized event.
  const episode = await resolution.episodeRepo.findByAttemptForUpdate(
    lockedAttempt.id,
    interruptionId,
  );
  if (!episode) {
    throw new ValidationError(
      "Interruption episode not found for the active pointer",
    );
  }
  if (episode.attemptId !== lockedAttempt.id) {
    throw new ValidationError("Interruption episode attemptId mismatch");
  }

  const detected = await resolution.eventRepo.findDetected(interruptionId);
  if (!detected) {
    throw new ValidationError(
      "No detected event found for the active interruption",
    );
  }
  if (detected.attemptId !== lockedAttempt.id) {
    throw new ValidationError("Detected event attemptId mismatch");
  }
  if (detected.interruptionId !== interruptionId) {
    throw new ValidationError("Detected event interruptionId mismatch");
  }
  if (detected.occurredAt.getTime() !== lockedAttempt.interruptedAt.getTime()) {
    throw new ValidationError(
      "Detected event occurredAt does not match attempt interruptedAt",
    );
  }

  const existingOutcome =
    await resolution.eventRepo.findOutcome(interruptionId);
  if (existingOutcome) {
    throw new ValidationError(
      "Interruption episode already has an outcome event",
    );
  }

  // Append the terminalized event. The pointer is cleared by submitAttempt's
  // own update (currentInterruptionId=null, interruptedAt=null).
  await resolution.eventRepo.insert({
    attemptId: lockedAttempt.id,
    interruptionId,
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
  // #6: Assert capability affinity at the start.
  assertCapabilityFor(capability, enrollmentRepo, attemptRepo);

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

  // 3. If the attempt is already in_progress, reconstruct from latest outcome.
  if (attempt.status === "in_progress") {
    return reconstructInProgressOutcome(
      attempt,
      episodeRepo,
      eventRepo,
      adjustmentRepo,
    );
  }

  // 4. If the attempt is already terminal, reconstruct via idempotency (R10).
  if (
    attempt.status === "submitted" ||
    attempt.status === "grading" ||
    attempt.status === "graded" ||
    attempt.status === "voided"
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
  if (!attempt.interruptedAt) {
    throw new ValidationError(
      "Disrupted attempt has no interruptedAt timestamp",
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

  // #6: Full episode identity validation.
  const episode = await episodeRepo.findByAttemptForUpdate(
    attempt.id,
    interruptionId,
  );
  if (!episode) {
    throw new ValidationError(
      "Interruption episode not found for the active pointer",
    );
  }
  if (episode.attemptId !== attempt.id) {
    throw new ValidationError("Interruption episode attemptId mismatch");
  }

  const detectedEvent = await eventRepo.findDetected(interruptionId);
  if (!detectedEvent) {
    throw new ValidationError(
      "No detected event found for the active interruption",
    );
  }
  if (detectedEvent.attemptId !== attempt.id) {
    throw new ValidationError("Detected event attemptId mismatch");
  }
  if (detectedEvent.interruptionId !== interruptionId) {
    throw new ValidationError("Detected event interruptionId mismatch");
  }
  if (detectedEvent.occurredAt.getTime() !== attempt.interruptedAt.getTime()) {
    throw new ValidationError(
      "Detected event occurredAt does not match attempt interruptedAt",
    );
  }

  const existingOutcome = await eventRepo.findOutcome(interruptionId);
  if (existingOutcome) {
    throw new ValidationError(
      "Interruption episode already has an outcome event",
    );
  }

  const detectedAt = detectedEvent.occurredAt;

  // 8. Evaluate the policy decision.
  // The policy evaluator (interruptionPolicy.ts) is the single source of truth
  // for reason-code strings and zero-grant outcomes across strict /
  // operator_incident / bounded_grace. Routing all three policies through it
  // (instead of hand-duplicating the strict/operator_incident reason codes here)
  // keeps the persisted ledger reason codes consistent with the canonical
  // STRICT_ZERO_GRANT_REASON / OPERATOR_INCIDENT_ZERO_GRANT_REASON constants.
  let addedSeconds = 0;
  let adjustmentId: string | null = null;
  let eligibleSeconds = 0;
  let reasonCode = "";

  // bounded_grace is the only policy that can carry a durable time adjustment,
  // so it is the only one that participates in idempotent adjustment reuse.
  if (snapshot.policy === "bounded_grace") {
    // #8: Check idempotency before evaluating.
    const existingAdjustment =
      await adjustmentRepo.findBoundedByInterruption(interruptionId);

    if (existingAdjustment) {
      // Reuse existing adjustment.
      if (
        existingAdjustment.attemptId !== attempt.id ||
        existingAdjustment.interruptionId !== interruptionId ||
        existingAdjustment.source !== "bounded_grace" ||
        existingAdjustment.policy !== "bounded_grace" ||
        existingAdjustment.addedSeconds <= 0
      ) {
        throw new ValidationError(
          "Existing bounded_grace adjustment failed identity validation",
        );
      }
      adjustmentId = existingAdjustment.id;
      eligibleSeconds = existingAdjustment.eligibleSeconds ?? 0;
      addedSeconds = existingAdjustment.addedSeconds;
      reasonCode = existingAdjustment.reasonCode;
    } else {
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

        await attemptRepo.update(attempt.id, {
          deadlineAt: decision.afterDeadline!,
        });
      }
    }
  } else {
    // strict / operator_incident: zero grant, no adjustment. Evaluate via the
    // canonical policy evaluator so the reason code is sourced from the same
    // constants as bounded_grace rather than hand-duplicated here.
    const decision = evaluateInterruptionTimePolicy({
      snapshot,
      detectedAt,
      decisionNow: now,
      beforeDeadline: attempt.deadlineAt ?? null,
      examCloseAt: exam.closeAt,
      priorBoundedGraceAddedSeconds: 0,
    });
    eligibleSeconds = decision.eligibleSeconds;
    addedSeconds = decision.addedSeconds;
    reasonCode = decision.reasonCode;
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

  // 10. Reconcile deadline (may submit if expired).
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

  // #7: Write the restored outcome event.
  await eventRepo.insert({
    attemptId: attempt.id,
    interruptionId,
    eventType: "restored",
    occurredAt: now,
    observedLastActivityAt: null,
    detectionSource: null,
    timeoutSeconds: null,
    policy: snapshot.policy,
    eligibleSeconds,
    timeAdjustmentId: adjustmentId,
    actorId: null,
    reasonCode,
  });

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
 * #9: Reconstructs the outcome for an already in_progress attempt.
 * Checks the latest episode and outcome to return proper compensation.
 */
async function reconstructInProgressOutcome(
  attempt: ExamAttempt,
  episodeRepo: InterruptionEpisodeRepository,
  eventRepo: InterruptionEventRepository,
  adjustmentRepo: TimeAdjustmentRepository,
): Promise<RestoreInterruptionResult> {
  const latestEpisode = await episodeRepo.findLatestByAttempt(attempt.id);
  const latestOutcome = await eventRepo.findLatestOutcomeByAttempt(attempt.id);

  if (!latestOutcome) {
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

  if (latestOutcome.eventType === "terminalized") {
    throw new ValidationError(
      "Attempt is in_progress but latest outcome is terminalized (identity violation)",
    );
  }

  // latestOutcome.eventType === "restored"
  if (latestEpisode && latestOutcome.interruptionId !== latestEpisode.id) {
    throw new ValidationError(
      "Latest outcome interruptionId does not match latest episode",
    );
  }
  if (latestOutcome.attemptId !== attempt.id) {
    throw new ValidationError("Latest outcome attemptId mismatch");
  }

  let adjustmentId: string | null = latestOutcome.timeAdjustmentId ?? null;
  let addedSeconds = 0;
  let eligibleSeconds = latestOutcome.eligibleSeconds ?? 0;

  if (adjustmentId) {
    const adjustment = await adjustmentRepo.findById(adjustmentId);
    if (
      !adjustment ||
      adjustment.attemptId !== attempt.id ||
      adjustment.interruptionId !== latestOutcome.interruptionId ||
      adjustment.id !== adjustmentId ||
      adjustment.source !== "bounded_grace" ||
      adjustment.policy !== "bounded_grace"
    ) {
      throw new ValidationError(
        "Restored outcome adjustment failed identity validation",
      );
    }
    addedSeconds = adjustment.addedSeconds;
    eligibleSeconds = adjustment.eligibleSeconds ?? 0;
  }

  return {
    attempt,
    lifecycle: "already_in_progress",
    compensation: {
      policy: latestOutcome.policy,
      interruptionId: latestOutcome.interruptionId,
      eligibleSeconds,
      addedSeconds,
      adjustmentId,
    },
  };
}

/**
 * #9: Reconstructs a terminal outcome from the latest terminalized event (R10).
 * Used when the attempt is already submitted/grading/graded/voided on entry.
 * Fails closed on adjustment identity mismatch.
 */
async function reconstructTerminalOutcome(
  attempt: ExamAttempt,
  eventRepo: InterruptionEventRepository,
  adjustmentRepo: TimeAdjustmentRepository,
): Promise<RestoreInterruptionResult> {
  const latestOutcome = await eventRepo.findLatestOutcomeByAttempt(attempt.id);
  if (latestOutcome && latestOutcome.eventType === "terminalized") {
    const adjustmentId: string | null = latestOutcome.timeAdjustmentId ?? null;
    let addedSeconds = 0;
    let eligibleSeconds = latestOutcome.eligibleSeconds ?? 0;

    if (adjustmentId) {
      const adjustment = await adjustmentRepo.findById(adjustmentId);
      if (
        !adjustment ||
        adjustment.attemptId !== attempt.id ||
        adjustment.interruptionId !== latestOutcome.interruptionId ||
        adjustment.source !== "bounded_grace" ||
        adjustment.policy !== "bounded_grace"
      ) {
        throw new ValidationError(
          "Terminalized outcome adjustment failed identity validation",
        );
      }
      addedSeconds = adjustment.addedSeconds;
      eligibleSeconds = adjustment.eligibleSeconds ?? 0;
    }

    return {
      attempt,
      lifecycle: "terminal",
      compensation: {
        policy: latestOutcome.policy,
        interruptionId: latestOutcome.interruptionId,
        eligibleSeconds,
        addedSeconds,
        adjustmentId,
      },
    };
  }
  // Terminal without a terminalized event, or latest outcome is restored
  // → plain terminal, no compensation.
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
