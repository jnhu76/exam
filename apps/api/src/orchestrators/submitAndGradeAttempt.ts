import type { RequestContext, Exam, ExamAttempt } from "@exam/domain";
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
} from "@exam/exam-engine";
import { createExamEngineRepos } from "../adapters/repoAdapters.js";

export interface SubmitAndGradeResult {
  attempt: ExamAttempt;
  alreadyGraded: boolean;
}

/**
 * Orchestrates the candidate submit + grade flow.
 *
 * TX1: lock attempt → ownership check → submitAttempt
 * readGradingSnapshot + computeGradingResult (outside TX)
 * TX2: finalizeGrading
 * Re-read final attempt state
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
  const phaseOne = await executeInTransaction(db, async (tx) => {
    const txAttemptRepo = createAttemptRepo(tx);
    const lockedAttempt = await txAttemptRepo.findByIdForUpdate(ctx, attemptId);
    if (!lockedAttempt || lockedAttempt.candidateId !== candidateProfileId) {
      throw new NotFoundError("Attempt not found");
    }

    const status = lockedAttempt.status;
    if (status === "in_progress" || status === "disrupted") {
      const exam = (await createExamRepo(tx).findById(
        ctx,
        lockedAttempt.examId,
      )) as Exam | null;
      const { attempts } = createExamEngineRepos(
        {
          examRepo: createExamRepo(tx),
          attemptRepo: txAttemptRepo,
          enrollmentRepo: createEnrollmentRepo(tx),
        },
        ctx,
      );
      await submitAttempt(attempts, attemptId, now, {
        source: "candidate",
        minSubmitAfterStartMinutes: exam?.minSubmitAfterStartMinutes ?? null,
      });
      return { alreadyGraded: false } as const;
    }
    if (status === "submitted") {
      return { alreadyGraded: false } as const;
    }
    if (status === "graded") {
      return { alreadyGraded: true } as const;
    }
    throw new InvalidStateTransitionError(
      `Cannot submit attempt in ${status} state`,
    );
  });

  const attemptRepo = createAttemptRepo(db);

  if (phaseOne.alreadyGraded) {
    const graded = await attemptRepo.findById(ctx, attemptId);
    if (!graded) {
      throw new NotFoundError("Attempt not found");
    }
    return { attempt: graded as ExamAttempt, alreadyGraded: true };
  }

  const examRepo = createExamRepo(db);
  const enrollmentRepo = createEnrollmentRepo(db);

  const { exams, enrollments, attempts } = createExamEngineRepos(
    {
      examRepo,
      enrollmentRepo,
      attemptRepo,
    },
    ctx,
  );

  const snapshot = await readGradingSnapshot(
    exams,
    enrollments,
    attempts,
    attemptId,
  );
  if (!snapshot) {
    throw new NotFoundError("Attempt not found after submit");
  }

  const gradingResult = computeGradingResult(
    snapshot.attempt,
    snapshot.exam,
    now,
  );

  await executeInTransaction(db, async (tx) => {
    const txAttemptRepo = createAttemptRepo(tx);
    await txAttemptRepo.findByIdForUpdate(ctx, attemptId);
    const { enrollments, attempts } = createExamEngineRepos(
      {
        examRepo: createExamRepo(tx),
        attemptRepo: txAttemptRepo,
        enrollmentRepo: createEnrollmentRepo(tx),
      },
      ctx,
    );
    await finalizeGrading(
      enrollments,
      attempts,
      attemptId,
      snapshot.enrollment.id,
      gradingResult,
      snapshot.exam,
    );
  });

  const attempt = await attemptRepo.findById(ctx, attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found after grading");
  }

  return { attempt: attempt as ExamAttempt, alreadyGraded: false };
}
