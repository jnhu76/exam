import type { ExamAttempt, AnswerRecord, Exam } from "@exam/domain";
import type { GradingStatus } from "@exam/domain";

/**
 * OpenAPI security scheme: HTTP-only cookie authentication. Shared by every
 * attempt route (candidate + admin) for response schema serialization.
 */
export const cookieAuth = [{ cookieAuth: [] }] as const;

/**
 * Derives inputMode from question type. Not stored in DB (L0 §1.2).
 */
function getInputMode(
  type: string,
): "choice" | "boolean" | "single_line" | "multi_line" {
  switch (type) {
    case "single_choice":
    case "multiple_choice":
      return "choice";
    case "true_false":
      return "boolean";
    case "fill_blank":
      return "single_line";
    case "text_response":
      return "multi_line";
    default:
      return "choice";
  }
}

/**
 * Computes effectiveDeadline from exam and attempt fields.
 * effectiveDeadline = min(exam deadline, attempt deadline)
 */
function computeEffectiveDeadline(
  exam: Exam,
  attempt: ExamAttempt,
): Date | null {
  const examDeadline = exam.closeAt;
  const attemptDeadline = attempt.deadlineAt;
  if (!attemptDeadline) return examDeadline;
  return examDeadline < attemptDeadline ? examDeadline : attemptDeadline;
}

/**
 * Computes resultVisibility based on exam publication mode and attempt state.
 */
function computeResultVisibility(
  exam: Exam,
  attempt: ExamAttempt,
): "hidden" | "visible" {
  if (attempt.status !== "graded") return "hidden";
  const gradingStatus = attempt.gradingStatus ?? "auto_graded";
  if (gradingStatus === "pending_manual") return "hidden";
  if (
    exam.resultPublicationMode === "after_grading" &&
    gradingStatus !== "fully_graded"
  )
    return "hidden";
  switch (exam.resultPublicationMode) {
    case "immediate":
      return "visible";
    case "after_grading":
      return "visible";
    case "manual":
      return exam.resultsPublishedAt != null ? "visible" : "hidden";
    default:
      return "hidden";
  }
}

/**
 * Computes answerVisibility — whether standardAnswer/rubric is shown.
 * For MVP, always hidden for candidates.
 */
function computeAnswerVisibility(): "hidden" | "visible" {
  return "hidden";
}

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

/**
 * Builds a CandidateTakeSnapshot from an attempt, exam, and server time.
 * This is the unified endpoint response for GET /candidate/attempts/:attemptId/take.
 *
 * Implements L0 §6.1: derived capabilities, answerSource routing,
 * security projection, and Cache-Control: no-store.
 */
export function buildCandidateTakeSnapshot(
  attempt: ExamAttempt,
  exam: Exam,
  now: Date,
) {
  const attemptStatus = attempt.status;
  const gradingStatus: GradingStatus = attempt.gradingStatus ?? "auto_graded";
  const effectiveDeadline = computeEffectiveDeadline(exam, attempt);
  const effectiveDeadlineStr = effectiveDeadline?.toISOString() ?? null;

  // Derived capability: isEditable (CONTEXT.md:12, exam-protocol.md §6.1)
  // effectiveDeadline === null means open-ended (no deadline) — always editable
  const isDeadlineExpired =
    effectiveDeadline !== null && now >= effectiveDeadline;
  const isEditable = attemptStatus === "in_progress" && !isDeadlineExpired;

  // Derived capabilities
  const canStart = false; // Already started
  const canResume = attemptStatus === "disrupted";
  const canSave = isEditable;
  const canSubmit =
    (attemptStatus === "in_progress" || attemptStatus === "disrupted") &&
    !isDeadlineExpired;

  // Lock reason
  let lockReason: "deadline" | "submitted" | "voided" | "disrupted" | undefined;
  if (!isEditable) {
    if (isDeadlineExpired) {
      lockReason = "deadline";
    } else if (
      attemptStatus === "submitted" ||
      attemptStatus === "grading" ||
      attemptStatus === "graded"
    ) {
      lockReason = "submitted";
    } else if (attemptStatus === "voided") {
      lockReason = "voided";
    } else if (attemptStatus === "disrupted") {
      lockReason = "disrupted";
    }
  }

  // Build answer lookup from draft answers
  const answerMap = new Map<string, unknown>();
  for (const a of attempt.answers) {
    answerMap.set(a.questionId, a.answer);
  }

  // Build submitted answers lookup if available
  const submittedMap = new Map<string, unknown>();
  const submittedAnswers = (attempt as unknown as Record<string, unknown>)
    .submittedAnswers as
    | {
        schemaVersion: number;
        answers: { questionId: string; value: unknown }[];
      }
    | null
    | undefined;
  if (submittedAnswers?.answers) {
    for (const a of submittedAnswers.answers) {
      submittedMap.set(a.questionId, a.value);
    }
  }

  // Build questions with answerSource routing (L0 §6.1)
  const questions = attempt.questionSnapshot.map((q) => {
    let answerValue: unknown = null;
    let answerSource: "draft" | "submitted" | "none" = "none";

    if (attemptStatus === "in_progress" || attemptStatus === "disrupted") {
      // Draft answers
      if (answerMap.has(q.originalQuestionId)) {
        answerValue = answerMap.get(q.originalQuestionId);
        answerSource = "draft";
      }
    } else if (
      attemptStatus === "submitted" ||
      attemptStatus === "grading" ||
      attemptStatus === "graded"
    ) {
      // Submitted answers
      if (submittedMap.has(q.originalQuestionId)) {
        answerValue = submittedMap.get(q.originalQuestionId);
        answerSource = "submitted";
      } else if (answerMap.has(q.originalQuestionId)) {
        // Fallback to draft if submitted_answers not yet populated
        answerValue = answerMap.get(q.originalQuestionId);
        answerSource = "submitted";
      }
    }
    // not_started, queued, voided → answerSource = "none", answerValue = null

    return {
      id: q.originalQuestionId,
      type: q.type,
      prompt: q.content,
      options: q.options,
      inputMode: getInputMode(q.type),
      maxScore: q.score,
      answerValue,
      answerSource,
    };
  });

  const resultVisibility = computeResultVisibility(exam, attempt);
  const answerVisibility = computeAnswerVisibility();

  return {
    attemptId: attempt.id,
    examId: attempt.examId,
    attemptStatus,
    gradingStatus,
    isEditable,
    canStart,
    canResume,
    canSave,
    canSubmit,
    lockReason,
    resultVisibility,
    answerVisibility,
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    serverNow: now.toISOString(),
    effectiveDeadline: effectiveDeadlineStr,
    serverRevision: attempt.updatedAt.toISOString(),
    questions,
  };
}
