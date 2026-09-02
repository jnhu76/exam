import type { ExamAttempt, AnswerRecord, Exam } from "@exam/domain";
import type { GradingStatus } from "@exam/domain";
import {
  computeEffectiveDeadline,
  resolveCandidateResultVisibility,
} from "@exam/exam-engine";

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

// computeEffectiveDeadline is re-exported above from @exam/exam-engine and is
// the ONLY deadline seam used below (L0 §5.1). Since Phase A (#291) it is
// null-safe: an untimed exam (closeAt null) projects an null effective
// deadline; a deadline-mode attempt (deadlineAt null) falls back to the exam
// close.

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
 * Serializes an ExamAttempt for candidate-facing responses. In addition to
 * stripping standardAnswer/rubric from the question snapshot, this applies
 * the canonical candidate result visibility authority (#324): when the exam's
 * publication policy hides the result, the score/passed fields are omitted —
 * grading truth stays in the DB, it just does not reach the candidate. The
 * exam argument is REQUIRED so no caller can bypass the authority by
 * accident.
 */
export function toCandidateAttemptResponse(
  attempt: ExamAttempt,
  now: Date,
  exam: Exam,
) {
  const {
    score: attemptScore,
    passed: attemptPassed,
    ...baseWithoutResultFacts
  } = toAttemptResponse(attempt);
  const visibility = resolveCandidateResultVisibility(exam, attempt);
  return {
    ...baseWithoutResultFacts,
    ...(visibility.visible && attemptScore !== undefined
      ? { score: attemptScore }
      : {}),
    ...(visibility.visible && attemptPassed !== undefined
      ? { passed: attemptPassed }
      : {}),
    serverNow: now.toISOString(),
    questionSnapshot: attempt.questionSnapshot.map((q) => ({
      originalQuestionId: q.originalQuestionId,
      type: q.type,
      content: q.content,
      // #301: frozen rich prompt/answer mode are candidate-safe (no grading
      // secrets); options carry their frozen rich documents too.
      contentDocument: q.contentDocument ?? null,
      answerMode: q.answerMode ?? null,
      attachments: q.attachments,
      options: q.options.map((o) => ({
        id: o.id,
        content: o.content,
        contentDocument: o.contentDocument ?? null,
      })),
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
  // Canonical seam — single deadline authority for every timing mode. A null
  // result means open-ended (untimed): never expired, no countdown.
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
  const submittedAnswers = attempt.submittedAnswers;
  if (submittedAnswers?.answers) {
    for (const a of submittedAnswers.answers) {
      submittedMap.set(a.questionId, a.value);
    }
  }

  // Build answer metadata lookup (clientSeq, version) for restoring
  // client-side state on page reload.
  const answerMetaMap = new Map<
    string,
    { clientSeq?: number; version: number }
  >();
  for (const a of attempt.answers as Array<{
    questionId: string;
    clientSeq?: number;
    version: number;
  }>) {
    answerMetaMap.set(a.questionId, {
      ...(a.clientSeq !== undefined ? { clientSeq: a.clientSeq } : {}),
      version: a.version,
    });
  }

  // Build questions with answerSource routing (L0 §6.1)
  const questions = attempt.questionSnapshot.map((q) => {
    let answerValue: unknown = null;
    let answerSource: "draft" | "submitted" | "none" = "none";
    let currentClientSeq: number | undefined;
    let currentVersion: number | undefined;

    if (attemptStatus === "in_progress" || attemptStatus === "disrupted") {
      // Draft answers
      if (answerMap.has(q.originalQuestionId)) {
        answerValue = answerMap.get(q.originalQuestionId);
        answerSource = "draft";
        const meta = answerMetaMap.get(q.originalQuestionId);
        if (meta) {
          currentClientSeq = meta.clientSeq;
          currentVersion = meta.version;
        }
      }
    } else if (
      attemptStatus === "submitted" ||
      attemptStatus === "grading" ||
      attemptStatus === "graded"
    ) {
      // Submitted answers — only from submitted_answers column
      if (submittedMap.has(q.originalQuestionId)) {
        answerValue = submittedMap.get(q.originalQuestionId);
        answerSource = "submitted";
      }
      // If submitted_answers doesn't have this question, answerSource stays "none"
    }
    // not_started, queued, voided → answerSource = "none", answerValue = null

    return {
      id: q.originalQuestionId,
      type: q.type,
      prompt: q.content,
      // #301: frozen rich prompt + the author-defined answer input mode.
      // Legacy/plain snapshots project null/"plain" so the client keeps the
      // plain fast path.
      promptDocument: q.contentDocument ?? null,
      answerMode: q.answerMode ?? "plain",
      options: q.options.map((o) => ({
        id: o.id,
        content: o.content,
        contentDocument: o.contentDocument ?? null,
      })),
      inputMode: getInputMode(q.type),
      maxScore: q.score,
      answerValue,
      answerSource,
      currentClientSeq,
      currentVersion,
    };
  });

  const resultVisibility = resolveCandidateResultVisibility(exam, attempt)
    .visible
    ? ("visible" as const)
    : ("hidden" as const);
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
    // Canonical timing mode — the client must gate the personal countdown on
    // this field, never on effectiveDeadline being null (#291 Phase A).
    timingMode: exam.timingMode,
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    serverNow: now.toISOString(),
    effectiveDeadline: effectiveDeadlineStr,
    serverRevision: attempt.updatedAt.toISOString(),
    questions,
  };
}
