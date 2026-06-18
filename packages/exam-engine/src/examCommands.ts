import type { Exam, Question, QuestionSnapshot } from "@exam/domain";
import { ValidationError } from "@exam/domain";
import { assertTransition } from "./examStateMachine.js";

export { assertTransition as assertExamTransition } from "./examStateMachine.js";

/** Repository interface for persisting exam records. */
export interface ExamRepository {
  findById(examId: string): Promise<Exam | null> | Exam | null;
  update(
    examId: string,
    data: Partial<Exam>,
  ): Promise<Exam | null> | Exam | null;
}

/**
 * Builds a snapshot of the questions assigned to an exam, preserving order and copying
 * question data to prevent later bank edits from affecting existing attempts.
 */
export function buildQuestionSnapshot(
  questionIds: string[],
  questions: Question[],
): QuestionSnapshot[] {
  const questionMap = new Map(questions.map((q) => [q.id, q]));
  return questionIds.map((qid, index) => {
    const q = questionMap.get(qid);
    if (!q) {
      throw new ValidationError(`Question ${qid} not found`);
    }
    return {
      originalQuestionId: q.id,
      type: q.type,
      content: q.content,
      attachments: q.attachments,
      options: q.options.map((o) => ({ id: o.id, content: o.content })),
      standardAnswer: q.standardAnswer,
      score: q.score,
      gradingRule: q.gradingRule,
      order: index,
    };
  });
}

/**
 * Publishes an exam: validates all preconditions (questions, scores, timing, policies),
 * builds the question snapshot, and transitions the exam to published status.
 */
export async function publishExam(
  repo: ExamRepository,
  examId: string,
  questions: Question[],
): Promise<Exam> {
  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "published");

  if (exam.questionIds.length === 0) {
    throw new ValidationError("Exam must have at least one question");
  }
  if (exam.passingScore <= 0) {
    throw new ValidationError("Passing score must be positive");
  }
  if (exam.durationMinutes <= 0) {
    throw new ValidationError("Duration must be positive");
  }
  if (exam.timingMode !== "timed_window") {
    throw new ValidationError("Phase 1 only supports timed_window exams");
  }
  if (exam.questionSelectionMode !== "manual") {
    throw new ValidationError(
      "Phase 1 only supports manual question selection",
    );
  }
  if (
    !["unlimited", "max_attempts", "pass_then_stop"].includes(exam.retakePolicy)
  ) {
    throw new ValidationError("Retake policy is not supported in Phase 1");
  }
  if (exam.openAt >= exam.closeAt) {
    throw new ValidationError("Exam openAt must be before closeAt");
  }

  const questionSnapshot = buildQuestionSnapshot(exam.questionIds, questions);
  if (questions.some((question) => question.courseId !== exam.courseId)) {
    throw new ValidationError("Exam questions must belong to its course");
  }
  const totalScore = questionSnapshot.reduce(
    (sum, question) => sum + question.score,
    0,
  );
  if (exam.totalScore !== totalScore) {
    throw new ValidationError("Exam totalScore must match question scores");
  }
  if (exam.passingScore > totalScore) {
    throw new ValidationError("Passing score cannot exceed total score");
  }

  const updated = await repo.update(examId, {
    status: "published",
    questionSnapshot,
  });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/** Transitions an exam from published to open status, making it available for candidates. */
export async function openExam(
  repo: ExamRepository,
  examId: string,
): Promise<Exam> {
  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "open");

  const updated = await repo.update(examId, { status: "open" });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/** Transitions an exam from open to closed status, preventing further attempts. */
export async function closeExam(
  repo: ExamRepository,
  examId: string,
): Promise<Exam> {
  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "closed");

  const updated = await repo.update(examId, { status: "closed" });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/** Result of a check-on-access auto-transition, including whether a transition occurred. */
export interface CheckAndUpdateResult {
  exam: Exam;
  transition?: "open" | "closed";
}

/**
 * Check-on-access auto-transition for exam status.
 * Lazily transitions published→open when now >= openAt, and open→closed when now >= closeAt.
 * Returns the exam (potentially updated) with transition info, or null if not found.
 */
export async function checkAndUpdateExamStatus(
  repo: ExamRepository,
  examId: string,
  now: Date,
): Promise<CheckAndUpdateResult | null> {
  const exam = await repo.findById(examId);
  if (!exam) {
    return null;
  }

  if (exam.status === "published" && now >= exam.openAt) {
    const updated = await openExam(repo, examId);
    return { exam: updated, transition: "open" };
  }

  if (exam.status === "open" && now >= exam.closeAt) {
    const updated = await closeExam(repo, examId);
    return { exam: updated, transition: "closed" };
  }

  return { exam };
}

/** Transitions an exam to archived status, making it read-only. */
export async function archiveExam(
  repo: ExamRepository,
  examId: string,
): Promise<Exam> {
  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "archived");

  const updated = await repo.update(examId, { status: "archived" });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}
