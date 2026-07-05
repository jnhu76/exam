import type { RequestContext, ExamAttempt } from "@exam/domain";
import { InvalidStateTransitionError, NotFoundError } from "@exam/domain";
import type { Database } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import {
  submitAttempt,
  readGradingSnapshot,
  computeGradingResult,
  finalizeGrading,
  ensureAttemptDeadlineReconciled,
} from "@exam/exam-engine";
import { createExamEngineRepos } from "../adapters/repoAdapters.js";

export interface SubmitAndGradeResult {
  attempt: ExamAttempt;
  alreadyGraded: boolean;
}

/**
 * Orchestrates the candidate submit + grade flow.
 *
 * Submit freeze barrier (ADR-008): submit, answer snapshot read, score
 * computation, and finalization all run inside ONE transaction holding the
 * attempt row lock. Previously this was split into TX1 (submit) → non-tx
 * `readGradingSnapshot`/`computeGradingResult` → TX2 (finalize), and a
 * concurrent `saveAnswer(baseVersion === currentVersion)` landing in the
 * inter-tx window could change which answer the score was computed from
 * (0/100 swing). Folding everything into the locked transaction makes the
 * answers captured under the submit lock the grading authority: any save that
 * arrives after `submitAttempt` flips the row to `submitted` is rejected by
 * the answer protocol (`ATTEMPT_ALREADY_SUBMITTED`), and the score is
 * computed from the locked, post-submit answers in the same tx.
 *
 * `submitted` (not yet `graded`) is treated as a crash-recovery case: submit
 * landed but grading didn't, so a retry grades it idempotently without
 * re-submitting. `graded` is the only truly terminal state.
 *
 * Does NOT handle: request validation, candidate profile lookup,
 * audit recording, or HTTP response serialization.
 */
export async function submitAndGradeAttempt(
  db: Database,
  ctx: RequestContext,
  attemptId: string,
  candidateProfileId: string,
  now: Date,
): Promise<SubmitAndGradeResult> {
  const alreadyGraded = await executeInTransaction(db, async (tx) => {
    const txAttemptRepo = createAttemptRepo(tx);
    const lockedAttempt = await txAttemptRepo.findByIdForUpdate(ctx, attemptId);
    if (!lockedAttempt || lockedAttempt.candidateId !== candidateProfileId) {
      throw new NotFoundError("Attempt not found");
    }

    const status = lockedAttempt.status;
    // `graded` is the only truly terminal, nothing-more-to-do state.
    if (status === "graded") {
      return true;
    }
    // `in_progress`/`disrupted` need the submit transition first; `submitted`
    // is a crash-recovery case (submit landed but grading didn't) and is
    // graded directly without re-submitting. Both then run the SAME
    // locked-tx grading block below (the freeze barrier).
    if (
      status === "in_progress" ||
      status === "disrupted" ||
      status === "submitted"
    ) {
      const { exams, enrollments, attempts } = createExamEngineRepos(
        {
          examRepo: createExamRepo(tx),
          attemptRepo: txAttemptRepo,
          enrollmentRepo: createEnrollmentRepo(tx),
        },
        ctx,
      );

      // P3-L0-3: lazy deadline reconciliation before submit. If the attempt
      // is past its effective deadline, freeze it as deadline-submitted
      // (submittedAt = effectiveDeadline, submissionReason='deadline') and
      // return that frozen result. The candidate's submit then returns the
      // existing deadline-submitted snapshot — no new answer payload accepted.
      //
      // After reconciliation the returned attempt carries the authoritative
      // current state. Use its status directly instead of the stale
      // pre-reconciliation `status` captured above, so we never issue a
      // redundant second submitAttempt call.
      let currentStatus = status;
      if (status === "in_progress" || status === "disrupted") {
        const reconciled = await ensureAttemptDeadlineReconciled(
          exams,
          enrollments,
          attempts,
          attemptId,
          now,
        );
        const reconciledStatus = reconciled.status;
        // If reconciliation already froze the attempt, skip the remaining
        // submit+grade work. This avoids redundant readGradingSnapshot,
        // computeGradingResult, and finalizeGrading calls that would extend
        // the FOR UPDATE lock unnecessarily.
        if (
          reconciledStatus === "graded" ||
          reconciledStatus === "submitted" ||
          reconciledStatus === "grading"
        ) {
          return true;
        }
        currentStatus = reconciledStatus;
      }

      if (currentStatus === "in_progress" || currentStatus === "disrupted") {
        // Reconciliation did not freeze (deadline not yet expired), or this
        // is the `submitted` crash-recovery path that skipped reconciliation.
        // Submit flips the row to `submitted` under the same lock. After this,
        // any concurrent saveAnswer sees `submitted` and is rejected
        // (ATTEMPT_ALREADY_SUBMITTED), so the answers can no longer mutate.
        await submitAttempt(attempts, attemptId, now, {
          source: "candidate",
          minSubmitAfterStartMinutes:
            (await exams.findById(lockedAttempt.examId))
              ?.minSubmitAfterStartMinutes ?? null,
        });
      }

      // P3-L0-2C: branch on the authoritative gradingStatus established at
      // the submit/freeze barrier. A pending_manual attempt MUST hold at
      // submitted — the manual-grading queue owns the final transition. No
      // question-type rescan here; the freeze barrier is the single
      // classification authority. Both the fresh-submit case (submitAttempt
      // just wrote pending_manual) and the crash-recovery `submitted` case
      // (carrying its previously-established gradingStatus) are covered.
      const postSubmit = await attempts.findByIdForUpdate(attemptId);
      if (!postSubmit) {
        throw new NotFoundError("Attempt not found after submit");
      }
      if (postSubmit.gradingStatus === "pending_manual") {
        return false;
      }

      // Re-read the grading snapshot from the SAME transaction so the answers
      // feeding the score are the locked, post-submit answers. This is the
      // freeze barrier: the score is derived from exactly the answer set that
      // existed when the submit lock was held. (For the crash-recovery
      // `submitted` path this also re-grades idempotently.)
      const snapshot = await readGradingSnapshot(
        exams,
        enrollments,
        attempts,
        attemptId,
      );
      if (!snapshot) {
        throw new NotFoundError("Attempt not found after submit");
      }

      const result = computeGradingResult(snapshot.attempt, snapshot.exam, now);
      await finalizeGrading(
        enrollments,
        attempts,
        attemptId,
        snapshot.enrollment.id,
        result,
        snapshot.exam,
      );
      return false;
    }
    throw new InvalidStateTransitionError(
      `Cannot submit attempt in ${status} state`,
    );
  });

  // Read the final committed attempt state for the response. Outside the tx
  // is safe here: this is a pure read of the now-committed result, and no
  // further mutation depends on it.
  const attemptRepo = createAttemptRepo(db);
  const attempt = await attemptRepo.findById(ctx, attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found after grading");
  }

  return { attempt: attempt as ExamAttempt, alreadyGraded };
}
