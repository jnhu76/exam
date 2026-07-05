import type { Exam, ExamAttempt } from "@exam/domain";
import {
  GradingStatus,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import { submitAttempt } from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import {
  readGradingSnapshot,
  computeGradingResult,
  finalizeGrading,
} from "./grading.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import { materializeGradingWorkset } from "./gradingWorkset.js";

/**
 * Auto-submittable attempt states for deadline reconciliation.
 * `not_started`/`queued` never started; `submitted`/`grading`/`graded` are
 * already frozen; `voided` is terminal. Only in-flight states get frozen.
 *
 * Typed against ExamAttempt["status"] so a future status rename surfaces at
 * compile time instead of silently breaking reconciliation.
 */
const AUTOSUBMITTABLE_STATUSES: ReadonlySet<ExamAttempt["status"]> = new Set<
  ExamAttempt["status"]
>(["in_progress", "disrupted"]);

/**
 * Computes the effective deadline for an attempt.
 *
 * `effectiveDeadline = min(exam.closeAt, attempt.deadlineAt)` — derived from
 * existing fields, no new deadline model (L0 §5.1). A null attempt deadline
 * falls back to the exam close.
 */
export function computeEffectiveDeadline(
  exam: Exam,
  attempt: ExamAttempt,
): Date {
  const examClose = exam.closeAt;
  if (examClose == null) {
    throw new ValidationError(
      "Exam closeAt is required for deadline computation (timed_window invariant)",
    );
  }
  return attempt.deadlineAt && attempt.deadlineAt < examClose
    ? attempt.deadlineAt
    : examClose;
}

/**
 * Lazy-triggered deadline reconciliation (P3-L0-3 / ADR-008 §5.3).
 *
 * Called at candidate attempt entry points (`/take`, save, submit, resume).
 * No background worker, no scheduled scan — reconciliation happens inline at
 * the entry point, transactionally. If the attempt is in an auto-submittable
 * state (`in_progress`/`disrupted`) and `now >= effectiveDeadline`, this
 * freezes the draft answers into `submitted_answers` (via `submitAttempt`
 * with `submissionReason: 'deadline'`), then grades. `submittedAt` is set to
 * the `effectiveDeadline` (the business-effective time), NOT the wall-clock
 * reconciliation instant.
 *
 * Idempotent: a submitted/grading/graded attempt is returned unchanged — its
 * existing `submitted_answers` + `submittedAt` are never rebuilt.
 *
 * The caller MUST wrap this in a transaction holding the attempt row lock
 * (`findByIdForUpdate`) so the read-freeze-write is atomic against concurrent
 * candidate save/submit. This mirrors `autoSubmitAndGrade`.
 *
 * @throws {NotFoundError} attempt or exam not found.
 * @throws {InvalidStateTransitionError} should not occur in normal operation
 *   (defensive against unexpected status mutations).
 */
export async function ensureAttemptDeadlineReconciled(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  gradingWorksetRepo: GradingWorksetRepository,
  attemptId: string,
  now: Date,
): Promise<ExamAttempt> {
  const attempt = await attemptRepo.findByIdForUpdate(attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }

  // Idempotent already-frozen path: submitted/grading/graded carry a frozen
  // submitted_answers — return unchanged (do NOT rebuild).
  if (
    attempt.status === "submitted" ||
    attempt.status === "grading" ||
    attempt.status === "graded"
  ) {
    return attempt;
  }

  // not_started/queued/voided: never auto-submitted. Return unchanged — no
  // freeze. voided is terminal; not_started/queued cannot have answers.
  if (!AUTOSUBMITTABLE_STATUSES.has(attempt.status)) {
    return attempt;
  }

  const exam = await examRepo.findById(attempt.examId);
  if (!exam) {
    throw new NotFoundError("Exam not found");
  }

  const effectiveDeadline = computeEffectiveDeadline(exam, attempt);

  // Not expired yet — nothing to reconcile.
  if (now.getTime() < effectiveDeadline.getTime()) {
    return attempt;
  }

  // Lazy inline submit-and-grade using effectiveDeadline as the submit time,
  // so submittedAt = effectiveDeadline (the business deadline), not the
  // wall-clock reconciliation instant. submissionReason='deadline' marks the
  // freeze as deadline-triggered.
  //
  // We reuse the existing grading pipeline: readGradingSnapshot →
  // computeGradingResult → finalizeGrading. The freeze itself (building
  // SubmittedAnswersSnapshot) is owned by submitAttempt (P3-L0-2); we pass
  // the effective deadline as `now` so the frozen submittedAt is correct.
  // submitAttempt is a static import (no circular dep — attemptCommands does
  // not import from this module).
  //
  // P3-L0-2C: submitAttempt now establishes the authoritative gradingStatus
  // at the freeze barrier. Branch on it — a pending_manual attempt MUST hold
  // at submitted (protocol §3.3); only completeManualGrading may advance it.
  // No per-caller question-type rescan here.
  const submittedAttempt = await submitAttempt(
    attemptRepo,
    attemptId,
    effectiveDeadline,
    {
      source: "deadline_scanner",
      submissionReason: "deadline",
    },
  );

  // P3-L0-2E: materialize the durable grading workset from the frozen
  // submitted_answers. Must happen inside the same transaction as the
  // submit freeze. Idempotent — a retry after a crash is a no-op if entries
  // already exist.
  await materializeGradingWorkset(submittedAttempt, gradingWorksetRepo);

  if (submittedAttempt.gradingStatus === GradingStatus.PendingManual) {
    return submittedAttempt;
  }

  const snapshot = await readGradingSnapshot(
    examRepo,
    enrollmentRepo,
    attemptRepo,
    attemptId,
  );
  if (!snapshot) {
    throw new NotFoundError("Attempt not found after reconciliation");
  }

  const result = computeGradingResult(snapshot.attempt, snapshot.exam, now);
  await finalizeGrading(
    enrollmentRepo,
    attemptRepo,
    attemptId,
    snapshot.enrollment.id,
    result,
    snapshot.exam,
  );

  const reconciled = await attemptRepo.findById(attemptId);
  if (!reconciled) {
    throw new InvalidStateTransitionError(
      "Attempt disappeared after reconciliation",
    );
  }
  return reconciled;
}
