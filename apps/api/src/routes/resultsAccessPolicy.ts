import type { Exam } from "@exam/domain";

/**
 * Admin results-access policy for the score-list and score-export surfaces
 * (ADR-005 §Close & export policy, binding): results require `examEnded` AND
 * no unfinalized attempts; canceled exams are rejected outright until
 * cancellation-marker result semantics exist. This module is the single
 * authority for both conditions — routes map the verdicts to their own wire
 * responses and must not re-derive the predicates inline.
 */

/** Discriminated verdict of {@link resolveAdminResultsAccess}. */
export type AdminResultsAccess =
  | { allowed: false; verdict: "EXAM_CANCELED" }
  | {
      allowed: false;
      verdict: "UNRESOLVED_ATTEMPTS_EXIST";
      unresolvedCount: number;
    }
  | { allowed: false; verdict: "EXAM_NOT_FINISHED" }
  | { allowed: false; verdict: "NO_GRADED_ATTEMPTS" }
  | { allowed: true; verdict: "allowed" };

/**
 * Whether an exam has ended: it reached a terminal results state
 * (closed/archived) or its scheduled window has elapsed.
 *
 * INVARIANT: untimed exams (closeAt === null) never end by the clock.
 * Boundary: `now === closeAt` counts as ended (>= semantics), matching the
 * scores-line behavior this predicate was extracted from.
 */
export function isExamEnded(
  exam: Pick<Exam, "status" | "closeAt">,
  now: Date,
): boolean {
  return (
    exam.status === "closed" ||
    exam.status === "archived" ||
    (exam.closeAt !== null && now >= exam.closeAt)
  );
}

/** Options for {@link resolveAdminResultsAccess}. */
export interface AdminResultsAccessOptions {
  /**
   * Export keeps the established headers-only CSV line for an ended exam with
   * zero graded attempts; the score list rejects that state. Precedence above
   * (canceled > unresolved > not-ended) is unchanged. Only the export route
   * sets this.
   */
  allowZeroGraded?: boolean;
}

/**
 * Resolves whether admin results surfaces (score list / score export) may
 * expose an exam's results. The verdict order is the wire precedence both
 * routes must preserve: canceled > unresolved attempts > not-ended >
 * no-graded-attempts (export opts out of the last block because the
 * established zero-graded CSV is headers-only 200).
 */
export function resolveAdminResultsAccess(
  exam: Pick<Exam, "status" | "closeAt">,
  now: Date,
  unresolvedCount: number,
  gradedCount: number,
  options: AdminResultsAccessOptions = {},
): AdminResultsAccess {
  if (exam.status === "canceled") {
    return { allowed: false, verdict: "EXAM_CANCELED" };
  }
  if (unresolvedCount > 0) {
    return {
      allowed: false,
      verdict: "UNRESOLVED_ATTEMPTS_EXIST",
      unresolvedCount,
    };
  }
  if (!isExamEnded(exam, now)) {
    return { allowed: false, verdict: "EXAM_NOT_FINISHED" };
  }
  if (gradedCount === 0 && !options.allowZeroGraded) {
    return { allowed: false, verdict: "NO_GRADED_ATTEMPTS" };
  }
  return { allowed: true, verdict: "allowed" };
}
