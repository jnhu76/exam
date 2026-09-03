import { ValidationError } from "@exam/domain";

/** Calculates the absolute deadline from a start time and duration in minutes. */
export function calculateDeadlineAt(
  startedAt: Date,
  durationMinutes: number,
): Date {
  return new Date(startedAt.getTime() + durationMinutes * 60 * 1000);
}

/**
 * The synchronized-deadline equation for `timed_sync` exams (#291 Phase B,
 * Model A freeze in docs/audits/291-PHASE-B-TIMED-SYNC-SEMANTIC-FREEZE.md):
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
