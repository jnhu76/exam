import type {
  Exam,
  ExamAttempt,
  ExamEnrollment,
  RequestContext,
} from "@exam/domain";
import type { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import type { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import type { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import type {
  ExamRepository,
  AttemptRepository,
  EnrollmentRepository,
} from "@exam/exam-engine";

/** Adapts the DB exam repo to the ExamRepository interface expected by
 * the exam-engine command functions, binding the request context. */
export function createExamRepoAdapter(
  repo: ReturnType<typeof createExamRepo>,
  ctx: RequestContext,
): ExamRepository {
  return {
    findById: async (examId) =>
      (await repo.findById(ctx, examId)) as Exam | null,
    update: async (examId, data) =>
      (await repo.update(
        ctx,
        examId,
        data as Record<string, unknown>,
      )) as Exam | null,
  };
}

/** Adapts the DB attempt repo to the AttemptRepository interface expected by
 * the exam-engine command functions, binding the request context. */
export function createAttemptRepoAdapter(
  repo: ReturnType<typeof createAttemptRepo>,
  ctx: RequestContext,
): AttemptRepository {
  return {
    findById: async (id) =>
      (await repo.findById(ctx, id)) as ExamAttempt | null,
    findByIdForUpdate: async (id) =>
      (await repo.findByIdForUpdate(ctx, id)) as ExamAttempt | null,
    findActiveByEnrollment: async (enrollmentId) =>
      (await repo.findActiveByEnrollment(
        ctx,
        enrollmentId,
      )) as ExamAttempt | null,
    findByEnrollmentAndAttemptNo: async (enrollmentId, attemptNo) =>
      (await repo.findByEnrollmentAndAttemptNo(
        ctx,
        enrollmentId,
        attemptNo,
      )) as ExamAttempt | null,
    create: async (input) =>
      (await repo.create(
        ctx,
        input as Parameters<typeof repo.create>[1],
      )) as ExamAttempt,
    update: async (id, data) =>
      (await repo.update(
        ctx,
        id,
        data as Parameters<typeof repo.update>[2],
      )) as ExamAttempt | null,
  };
}

/** Adapts the DB enrollment repo to the EnrollmentRepository interface expected
 * by the exam-engine command functions, binding the request context. */
export function createEnrollmentRepoAdapter(
  repo: ReturnType<typeof createEnrollmentRepo>,
  ctx: RequestContext,
): EnrollmentRepository {
  return {
    findByExamAndCandidate: async (examId, candidateId) =>
      (await repo.findByExamAndCandidate(
        ctx,
        examId,
        candidateId,
      )) as ExamEnrollment | null,
    findByExamAndCandidateForUpdate: async (examId, candidateId) =>
      (await repo.findByExamAndCandidateForUpdate(
        ctx,
        examId,
        candidateId,
      )) as ExamEnrollment | null,
    create: async (input) =>
      (await repo.create(
        ctx,
        input as Parameters<typeof repo.create>[1],
      )) as ExamEnrollment,
    update: async (id, data) =>
      (await repo.update(
        ctx,
        id,
        data as Parameters<typeof repo.update>[2],
      )) as ExamEnrollment | null,
  };
}
