import { ValidationError } from "@exam/domain";

/** Calculates the absolute deadline from a start time and duration in minutes. */
export function calculateDeadlineAt(
  startedAt: Date,
  durationMinutes: number,
): Date {
  return new Date(startedAt.getTime() + durationMinutes * 60 * 1000);
}

type DeadlineExam = { closeAt: Date | null | undefined };
type DeadlineAttempt = { deadlineAt?: Date | null | undefined };

/**
 * Computes the canonical effective deadline for an attempt.
 *
 * The deadline lattice is deliberately small:
 *   - exam close + attempt deadline => min(closeAt, deadlineAt)
 *   - exam close only               => closeAt
 *   - neither                       => null (no deadline)
 *   - attempt deadline only         => invalid hybrid; fail closed
 *
 * CANONICAL DEADLINE AUTHORITY: this is the single source of truth for the
 * effective deadline value. Discovery queries may over-approximate candidates,
 * but the authoritative expiry decision is `isAttemptDeadlineExpired` below.
 * Living in the timing leaf lets every engine module depend on it without
 * cycles; `deadlineReconciliation.ts` re-exports it for deep-import stability.
 */
export function computeEffectiveDeadline(
  exam: { closeAt: Date },
  attempt: DeadlineAttempt,
): Date;
export function computeEffectiveDeadline(
  exam: DeadlineExam,
  attempt: DeadlineAttempt,
): Date | null;
export function computeEffectiveDeadline(
  exam: DeadlineExam,
  attempt: DeadlineAttempt,
): Date | null {
  const examClose = exam.closeAt ?? null;
  const attemptDeadline = attempt.deadlineAt ?? null;

  if (examClose === null) {
    if (attemptDeadline !== null) {
      throw new ValidationError(
        "Exam closeAt is required when an attempt deadline exists",
      );
    }
    return null;
  }

  if (attemptDeadline === null) return examClose;
  return attemptDeadline < examClose ? attemptDeadline : examClose;
}

/**
 * Canonical "is this attempt past its effective deadline?" decision.
 *
 * A null effective deadline means there is no deadline and therefore this
 * predicate is always false. Otherwise expiry is `now >= effectiveDeadline`.
 * This is the SOLE authoritative expiry seam for deadline-triggered mutation;
 * callers must not re-derive deadline comparisons inline.
 */
export function isAttemptDeadlineExpired(
  exam: DeadlineExam,
  attempt: DeadlineAttempt,
  now: Date,
): boolean {
  const effectiveDeadline = computeEffectiveDeadline(exam, attempt);
  return (
    effectiveDeadline !== null && now.getTime() >= effectiveDeadline.getTime()
  );
}

/**
 * The synchronized-deadline equation for `timed_sync` exams (#291 Phase B,
 * Model A freeze in docs/contracts/timed-sync-semantics.md):
 *
 *   syncDeadline = null when the operator has not triggered the sitting;
 *   otherwise min(syncStartedAt + durationMinutes, closeAt).
 *
 * Canonical owner of the sitting's shared base deadline. The operator start
 * command (B2) persists T0 (`exam.syncStartedAt`); attempt start copies the
 * value into `attempt.deadlineAt`, so every consumer below the start seam
 * keeps flowing through the existing `computeEffectiveDeadline` kernel —
 * there is no sync branch in reconciliation or the scanner. Pure function of
 * the durable exam row: a restart reconstructs the same deadline without
 * process-local state.
 *
 * A triggered sync exam without `durationMinutes` fails closed: degrading to
 * null would model an endless sitting whose attempts never auto-submit.
 */
export function computeSyncDeadline(exam: {
  syncStartedAt: Date | null;
  durationMinutes: number | null;
  closeAt: Date | null | undefined;
}): Date | null {
  const t0 = exam.syncStartedAt;
  if (t0 === null) return null;
  if (exam.durationMinutes === null) {
    throw new ValidationError(
      "timed_sync exams require a positive durationMinutes",
    );
  }
  const durationBound = calculateDeadlineAt(t0, exam.durationMinutes);
  const hardCap = exam.closeAt ?? null;
  if (hardCap === null) return durationBound;
  return durationBound < hardCap ? durationBound : hardCap;
}

/** Returns the remaining seconds until the deadline, or 0 if the deadline has passed. */
export function getRemainingSeconds(deadlineAt: Date, now: Date): number {
  const diff = deadlineAt.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / 1000);
}
