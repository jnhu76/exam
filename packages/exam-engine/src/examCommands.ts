import type { Exam, ExamStatus, QuestionSnapshot } from "@exam/domain";
import { InvalidStateTransitionError, ValidationError } from "@exam/domain";

export interface ExamRepository {
  findById(examId: string): Exam | null;
  update(examId: string, data: Partial<Exam>): Exam | null;
}

const VALID_TRANSITIONS: Record<ExamStatus, ExamStatus[]> = {
  draft: ["published"],
  published: ["open", "archived"],
  open: ["closed"],
  closed: ["archived"],
  archived: [],
};

function assertTransition(current: ExamStatus, target: ExamStatus): void {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.includes(target)) {
    throw new InvalidStateTransitionError(
      `Cannot transition from ${current} to ${target}`,
    );
  }
}

export function publishExam(repo: ExamRepository, examId: string): Exam {
  const exam = repo.findById(examId);
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

  const questionSnapshot: QuestionSnapshot[] = exam.questionIds.map(
    (qid, index) => ({
      originalQuestionId: qid,
      type: "single_choice" as const,
      content: "",
      attachments: [],
      options: [],
      standardAnswer: null,
      score: 0,
      gradingRule: {
        multiSelectScoring: "all_correct_full" as const,
        fillBlankMatchMode: "exact" as const,
      },
      order: index,
    }),
  );

  return repo.update(examId, {
    status: "published",
    questionSnapshot,
  })!;
}

export function openExam(repo: ExamRepository, examId: string): Exam {
  const exam = repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "open");

  return repo.update(examId, { status: "open" })!;
}

export function closeExam(repo: ExamRepository, examId: string): Exam {
  const exam = repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "closed");

  return repo.update(examId, { status: "closed" })!;
}

export function archiveExam(repo: ExamRepository, examId: string): Exam {
  const exam = repo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  assertTransition(exam.status, "archived");

  return repo.update(examId, { status: "archived" })!;
}
