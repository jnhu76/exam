import type { ExamAttempt, AnswerRecord } from "@exam/domain";

/**
 * OpenAPI security scheme: HTTP-only cookie authentication. Shared by every
 * attempt route (candidate + admin) for response schema serialization.
 */
export const cookieAuth = [{ cookieAuth: [] }] as const;

/**
 * Serializes an ExamAttempt domain object into the API response shape,
 * converting Date fields to ISO strings and conditionally including score/passed.
 */
function toAttemptResponse(attempt: ExamAttempt) {
  return {
    id: attempt.id,
    organizationId: attempt.organizationId,
    examId: attempt.examId,
    enrollmentId: attempt.enrollmentId,
    candidateId: attempt.candidateId,
    attemptNo: attempt.attemptNo,
    status: attempt.status,
    questionSnapshot: attempt.questionSnapshot,
    answers: attempt.answers.map((a) => ({
      questionId: a.questionId,
      answer: a.answer,
      version: a.version,
      savedAt: new Date(a.savedAt).toISOString(),
    })),
    ...(attempt.score == null ? {} : { score: attempt.score }),
    ...(attempt.passed == null ? {} : { passed: attempt.passed }),
    startedAt: attempt.startedAt?.toISOString(),
    submittedAt: attempt.submittedAt?.toISOString(),
    deadlineAt: attempt.deadlineAt?.toISOString(),
    lastActivityAt: attempt.lastActivityAt?.toISOString(),
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
  };
}

/**
 * Serializes an ExamAttempt for candidate-facing responses, stripping
 * standardAnswer and other admin-only fields from the question snapshot.
 */
export function toCandidateAttemptResponse(attempt: ExamAttempt, now: Date) {
  return {
    ...toAttemptResponse(attempt),
    serverNow: now.toISOString(),
    questionSnapshot: attempt.questionSnapshot.map((q) => ({
      originalQuestionId: q.originalQuestionId,
      type: q.type,
      content: q.content,
      attachments: q.attachments,
      options: q.options,
      score: q.score,
      gradingRule: q.gradingRule,
      order: q.order,
    })),
  };
}
