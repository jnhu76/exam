import type { ExamAttempt, InterruptionTimePolicy } from "@exam/domain";
import { ValidationError } from "@exam/domain";
import type { RestoreLifecycleOutcome } from "./attemptCommands.js";
import type {
  InterruptionEpisodeRepository,
  InterruptionEventRepository,
  TimeAdjustmentRepository,
} from "./interruptionRepositories.js";

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
