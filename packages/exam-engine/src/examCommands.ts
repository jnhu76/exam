import type {
  Exam,
  ExamStatus,
  Question,
  QuestionSnapshot,
} from "@exam/domain";
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

export function publishExam(
  repo: ExamRepository,
  examId: string,
  questions: Question[],
): Exam {
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

  const questionSnapshot = buildQuestionSnapshot(exam.questionIds, questions);

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
