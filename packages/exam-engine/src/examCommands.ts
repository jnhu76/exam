import type { Exam, Question, QuestionSnapshot } from "@exam/domain";
import { InvalidStateTransitionError, ValidationError } from "@exam/domain";
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

/**
 * Transitions an exam from open to closed status, preventing further attempts.
 *
 * ADR-005 Slice 1 / review decision #2: idempotent for `closed` — a `closed`
 * exam returns unchanged (no `InvalidStateTransitionError`). The route layer
 * uses this to detect the idempotent case and suppress the duplicate audit.
 * The unresolved-attempts guard lives at the route layer (it needs the
 * attempt repo); this engine function performs only the status transition.
 */
export async function closeExam(
  repo: ExamRepository,
  examId: string,
): Promise<Exam> {
  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  // Idempotent: already closed -> return as-is.
  if (exam.status === "closed") {
    return exam;
  }

  assertTransition(exam.status, "closed");

  const updated = await repo.update(examId, { status: "closed" });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/**
 * Cancels an exam abnormally (published -> canceled, open -> canceled).
 *
 * ADR-005 Slice 4 (cancel-minimal): the engine performs only the status
 * transition. It does NOT void or force-submit attempts. The unresolved-
 * attempts guard (open with in_progress/disrupted/submitted/grading) lives at
 * the route layer (needs the attempt repo), surfacing as
 * EXAM_CANCEL_NOT_ALLOWED / UNRESOLVED_ATTEMPTS_EXIST. cancel is NOT idempotent
 * (canceled -> canceled is rejected); to settle a canceled exam, archive it.
 */
export async function cancelExam(
  repo: ExamRepository,
  examId: string,
): Promise<Exam> {
  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "canceled");

  const updated = await repo.update(examId, { status: "canceled" });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/**
 * Reverts a published exam back to draft (published -> draft).
 *
 * ADR-005 Slice 2 §3.2: only allowed from `published`. The route layer
 * reconciles status by now BEFORE calling this, so a stale `published` exam
 * whose openAt already passed (logically `open`) is rejected at the route as
 * `EXAM_UNPUBLISH_NOT_ALLOWED`. This engine function performs only the
 * transition; it never accepts `open -> draft`.
 */
export async function unpublishExam(
  repo: ExamRepository,
  examId: string,
): Promise<Exam> {
  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "draft");

  const updated = await repo.update(examId, { status: "draft" });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/**
 * Extends an open exam's closeAt by a positive number of minutes
 * (open -> open, only closeAt changes).
 *
 * ADR-005 Slice 2 §3.4: only allowed for `open`. The route layer reconciles
 * first, so a stale `open` exam whose closeAt already passed (logically
 * `closed`) is rejected at the route as `EXAM_EXTEND_NOT_ALLOWED` and cannot
 * be revived. `extendMinutes` must be a positive integer; the new closeAt is
 * the old closeAt + extendMinutes (keeps the remaining window semantics).
 */
export async function extendExam(
  repo: ExamRepository,
  examId: string,
  extendMinutes: number,
): Promise<Exam> {
  if (!Number.isInteger(extendMinutes) || extendMinutes <= 0) {
    throw new ValidationError("extendMinutes must be a positive integer");
  }

  const exam = await repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  // extend is NOT a state transition (status stays "open"); it only updates
  // closeAt. So require the status to be exactly "open" rather than using
  // assertTransition (the transition table has no "open -> open" entry).
  if (exam.status !== "open") {
    throw new InvalidStateTransitionError(
      `Cannot extend exam in ${exam.status} state`,
    );
  }

  const oldCloseAt = new Date(exam.closeAt);
  const newCloseAt = new Date(oldCloseAt.getTime() + extendMinutes * 60_000);
  const updated = await repo.update(examId, { closeAt: newCloseAt });
  if (!updated) throw new ValidationError("Exam not found after update");
  return updated;
}

/** Result of a check-on-access auto-transition, including whether a transition occurred. */
export interface CheckAndUpdateResult {
  exam: Exam;
  transition?: "open" | "closed";
  previousStatus?: string;
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
  let exam = await repo.findById(examId);
  if (!exam) {
    return null;
  }

  const previousStatus = exam.status;
  let transition: "open" | "closed" | undefined;

  if (exam.status === "published" && now >= exam.openAt) {
    exam = await openExam(repo, examId);
    transition = "open";
  }

  if (exam.status === "open" && now >= exam.closeAt) {
    exam = await closeExam(repo, examId);
    transition = "closed";
  }

  return {
    exam,
    ...(transition ? { transition, previousStatus } : {}),
  };
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
