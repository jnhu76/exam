import { describe, expect, it } from "vitest";
import {
  startAttempt,
  submitAttempt,
  markDisrupted,
  restoreAttempt,
  type AttemptRepository,
  type EnrollmentRepository,
} from "./attemptCommands.js";
import type {
  Exam,
  ExamAttempt,
  ExamEnrollment,
  QuestionSnapshot,
  RequestContext,
} from "@exam/domain";
import {
  ExamNotOpenError,
  InvalidStateTransitionError,
  ValidationError,
  MaxAttemptsReachedError,
} from "@exam/domain";

function makeSnapshot(): QuestionSnapshot[] {
  return [
    {
      originalQuestionId: "q1",
      type: "single_choice",
      content: "Q1",
      attachments: [],
      options: [{ id: "a", content: "A" }],
      standardAnswer: "a",
      score: 50,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
    },
  ];
}

function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: "exam-1",
    organizationId: "org-1",
    title: "Test Exam",
    description: "",
    courseId: "course-1",
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: new Date("2025-01-01T09:00:00Z"),
    closeAt: new Date("2025-01-01T12:00:00Z"),
    passingScore: 60,
    totalScore: 100,
    questionSelectionMode: "manual",
    questionIds: ["q1"],
    questionSnapshot: makeSnapshot(),
    controlFlags: {
      shuffleQuestions: false,
      shuffleOptions: false,
      detectTabSwitch: false,
      disableCopyPaste: false,
      requireQueue: false,
      batchSize: 10,
      batchInterval: 3,
      restrictIp: false,
      requireLockdown: false,
      showResultImmediately: true,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEnrollment(
  overrides: Partial<ExamEnrollment> = {},
): ExamEnrollment {
  return {
    id: "enr-1",
    organizationId: "org-1",
    examId: "exam-1",
    candidateId: "cand-1",
    status: "assigned",
    attemptCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    organizationId: "org-1",
    examId: "exam-1",
    enrollmentId: "enr-1",
    candidateId: "cand-1",
    attemptNo: 1,
    status: "in_progress",
    questionSnapshot: makeSnapshot(),
    answers: [],
    startedAt: new Date("2025-01-01T10:00:00Z"),
    deadlineAt: new Date("2025-01-01T11:00:00Z"),
    lastActivityAt: new Date("2025-01-01T10:00:00Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeAttemptRepo(attempts: ExamAttempt[] = []): AttemptRepository {
  const store = [...attempts];
  return {
    findById(id) {
      return store.find((a) => a.id === id) ?? null;
    },
    findActiveByEnrollment(enrollmentId) {
      return (
        store.find(
          (a) => a.enrollmentId === enrollmentId && a.status === "in_progress",
        ) ?? null
      );
    },
    findByEnrollmentAndAttemptNo(enrollmentId, attemptNo) {
      return (
        store.find(
          (a) => a.enrollmentId === enrollmentId && a.attemptNo === attemptNo,
        ) ?? null
      );
    },
    create(input) {
      const base = {
        id: input.id ?? "attempt-new",
        organizationId: input.organizationId,
        examId: input.examId,
        enrollmentId: input.enrollmentId,
        candidateId: input.candidateId,
        attemptNo: input.attemptNo,
        status: input.status,
        questionSnapshot: input.questionSnapshot,
        answers: input.answers,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const optional: Partial<
        Pick<
          ExamAttempt,
          | "startedAt"
          | "deadlineAt"
          | "lastActivityAt"
          | "score"
          | "passed"
          | "submittedAt"
        >
      > = {};
      if (input.startedAt) optional.startedAt = input.startedAt;
      if (input.deadlineAt) optional.deadlineAt = input.deadlineAt;
      if (input.lastActivityAt) optional.lastActivityAt = input.lastActivityAt;
      const attempt = { ...base, ...optional } as ExamAttempt;
      store.push(attempt);
      return attempt;
    },
    update(id, data) {
      const idx = store.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      store[idx] = { ...store[idx]!, ...data };
      return store[idx]!;
    },
  };
}

function makeEnrollmentRepo(
  enrollments: ExamEnrollment[] = [],
): EnrollmentRepository {
  const store = [...enrollments];
  return {
    findByExamAndCandidate(examId, candidateId) {
      return (
        store.find(
          (e) => e.examId === examId && e.candidateId === candidateId,
        ) ?? null
      );
    },
    create(input) {
      const enr: ExamEnrollment = {
        id: input.id ?? "enr-new",
        organizationId: input.organizationId,
        examId: input.examId,
        candidateId: input.candidateId,
        status: input.status,
        attemptCount: input.attemptCount,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.push(enr);
      return enr;
    },
    update(id, data) {
      const idx = store.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      store[idx] = { ...store[idx]!, ...data };
      return store[idx]!;
    },
  };
}

const fixedNow = new Date("2025-01-01T10:30:00Z");
const fixedStart = new Date("2025-01-01T10:30:00Z");

describe("attemptCommands", () => {
  describe("startAttempt", () => {
    it("creates new attempt for candidate with enrollment", async () => {
      const exam = makeExam();
      const enrollment = makeEnrollment();
      const examRepo = { findById: () => exam, update: () => exam };
      const enrRepo = makeEnrollmentRepo([enrollment]);
      const attRepo = makeAttemptRepo();

      const result = await startAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
      );

      expect(result.status).toBe("in_progress");
      expect(result.candidateId).toBe("cand-1");
      expect(result.examId).toBe("exam-1");
      expect(result.enrollmentId).toBe("enr-1");
      expect(result.attemptNo).toBe(1);
      expect(result.questionSnapshot).toEqual(exam.questionSnapshot);
      expect(result.startedAt).toEqual(fixedStart);
      expect(result.deadlineAt).toEqual(new Date("2025-01-01T11:30:00Z"));
    });

    it("rejects when no enrollment exists (Phase 1 requires explicit assignment)", async () => {
      const exam = makeExam();
      const examRepo = { findById: () => exam, update: () => exam };
      const enrRepo = makeEnrollmentRepo();
      const attRepo = makeAttemptRepo();

      await expect(
        startAttempt(examRepo, enrRepo, attRepo, "exam-1", "cand-1", fixedNow),
      ).rejects.toThrow(ValidationError);
    });

    it("returns existing in_progress attempt instead of creating new", async () => {
      const exam = makeExam();
      const enrollment = makeEnrollment({ attemptCount: 1 });
      const existingAttempt = makeAttempt();
      const examRepo = { findById: () => exam, update: () => exam };
      const enrRepo = makeEnrollmentRepo([enrollment]);
      const attRepo = makeAttemptRepo([existingAttempt]);

      const result = await startAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
      );

      expect(result.id).toBe("attempt-1");
    });

    it("returns existing in_progress attempt even after max attempts are exhausted", async () => {
      const exam = makeExam({
        retakePolicy: "max_attempts",
        maxAttempts: 1,
      });
      const enrollment = makeEnrollment({ attemptCount: 1 });
      const existingAttempt = makeAttempt();
      const examRepo = { findById: () => exam, update: () => exam };
      const enrRepo = makeEnrollmentRepo([enrollment]);
      const attRepo = makeAttemptRepo([existingAttempt]);

      const result = await startAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
      );

      expect(result.id).toBe("attempt-1");
      expect(result.attemptNo).toBe(1);
    });

    it("throws ExamNotOpenError when exam is not open", async () => {
      const exam = makeExam({ status: "draft" });
      const examRepo = { findById: () => exam, update: () => exam };
      const enrRepo = makeEnrollmentRepo();
      const attRepo = makeAttemptRepo();

      await expect(
        startAttempt(examRepo, enrRepo, attRepo, "exam-1", "cand-1", fixedNow),
      ).rejects.toThrow(ExamNotOpenError);
    });

    it("throws ExamNotOpenError when exam is closed", async () => {
      const exam = makeExam({ status: "closed" });
      const examRepo = { findById: () => exam, update: () => exam };
      const enrRepo = makeEnrollmentRepo();
      const attRepo = makeAttemptRepo();

      await expect(
        startAttempt(examRepo, enrRepo, attRepo, "exam-1", "cand-1", fixedNow),
      ).rejects.toThrow(ExamNotOpenError);
    });

    it("throws ValidationError when exam not found", async () => {
      const examRepo = { findById: () => null, update: () => null };
      const enrRepo = makeEnrollmentRepo();
      const attRepo = makeAttemptRepo();

      await expect(
        startAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "nonexistent",
          "cand-1",
          fixedNow,
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("throws ExamNotOpenError when current time is before openAt", async () => {
      const exam = makeExam({
        openAt: new Date("2025-01-01T12:00:00Z"),
        closeAt: new Date("2025-01-01T14:00:00Z"),
      });
      const examRepo = { findById: () => exam, update: () => exam };
      const enrRepo = makeEnrollmentRepo();
      const attRepo = makeAttemptRepo();

      await expect(
        startAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "exam-1",
          "cand-1",
          new Date("2025-01-01T11:00:00Z"),
        ),
      ).rejects.toThrow(ExamNotOpenError);
    });

    it("throws ExamNotOpenError when current time is after closeAt", async () => {
      const exam = makeExam({
        openAt: new Date("2025-01-01T09:00:00Z"),
        closeAt: new Date("2025-01-01T10:00:00Z"),
      });
      const examRepo = { findById: () => exam, update: () => exam };
      const enrRepo = makeEnrollmentRepo();
      const attRepo = makeAttemptRepo();

      await expect(
        startAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "exam-1",
          "cand-1",
          new Date("2025-01-01T10:30:00Z"),
        ),
      ).rejects.toThrow(ExamNotOpenError);
    });

    it("throws MaxAttemptsReachedError when max attempts reached", async () => {
      const exam = makeExam({
        retakePolicy: "max_attempts",
        maxAttempts: 1,
      });
      const enrollment = makeEnrollment({ attemptCount: 1 });
      const examRepo = { findById: () => exam, update: () => exam };
      const enrRepo = makeEnrollmentRepo([enrollment]);
      const attRepo = makeAttemptRepo();

      await expect(
        startAttempt(examRepo, enrRepo, attRepo, "exam-1", "cand-1", fixedNow),
      ).rejects.toThrow(MaxAttemptsReachedError);
    });

    it("increments attempt number for subsequent attempts", async () => {
      const exam = makeExam();
      const enrollment = makeEnrollment({ attemptCount: 1 });
      const prevAttempt = makeAttempt({
        status: "submitted",
        attemptNo: 1,
      });
      const examRepo = { findById: () => exam, update: () => exam };
      const enrRepo = makeEnrollmentRepo([enrollment]);
      const attRepo = makeAttemptRepo([prevAttempt]);

      const result = await startAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
      );

      expect(result.attemptNo).toBe(2);
    });

    it("copies questionSnapshot from published exam", async () => {
      const snapshot = makeSnapshot();
      const exam = makeExam({ questionSnapshot: snapshot });
      const enrollment = makeEnrollment();
      const examRepo = { findById: () => exam, update: () => exam };
      const enrRepo = makeEnrollmentRepo([enrollment]);
      const attRepo = makeAttemptRepo();

      const result = await startAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
      );

      expect(result.questionSnapshot).toEqual(snapshot);
    });
  });

  describe("submitAttempt", () => {
    it("transitions in_progress → submitted", async () => {
      const attempt = makeAttempt();
      const attRepo = makeAttemptRepo([attempt]);

      const result = await submitAttempt(attRepo, "attempt-1", fixedNow);

      expect(result.status).toBe("submitted");
      expect(result.submittedAt).toEqual(fixedNow);
    });

    it("throws InvalidStateTransitionError for submitted attempt", async () => {
      const attempt = makeAttempt({ status: "submitted" });
      const attRepo = makeAttemptRepo([attempt]);

      await expect(
        submitAttempt(attRepo, "attempt-1", fixedNow),
      ).rejects.toThrow(InvalidStateTransitionError);
    });

    it("throws ValidationError for non-existent attempt", async () => {
      const attRepo = makeAttemptRepo();

      await expect(
        submitAttempt(attRepo, "nonexistent", fixedNow),
      ).rejects.toThrow(ValidationError);
    });

    it("allows late submission (past deadline) — answers already saved on server", async () => {
      const attempt = makeAttempt({
        deadlineAt: new Date("2025-01-01T09:00:00Z"),
      });
      const attRepo = makeAttemptRepo([attempt]);

      const result = await submitAttempt(
        attRepo,
        "attempt-1",
        new Date("2025-01-01T11:00:00Z"),
      );

      expect(result.status).toBe("submitted");
    });

    it("throws ValidationError when submit update returns null", async () => {
      const attempt = makeAttempt();
      const attRepo: AttemptRepository = {
        findById: () => attempt,
        findActiveByEnrollment: () => null,
        findByEnrollmentAndAttemptNo: () => null,
        create: () => attempt,
        update: () => null,
      };

      await expect(
        submitAttempt(attRepo, "attempt-1", fixedNow),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("markDisrupted", () => {
    it("transitions in_progress → disrupted", async () => {
      const attempt = makeAttempt();
      const attRepo = makeAttemptRepo([attempt]);

      const result = await markDisrupted(attRepo, "attempt-1");

      expect(result.status).toBe("disrupted");
    });

    it("throws for non in_progress attempt", async () => {
      const attempt = makeAttempt({ status: "submitted" });
      const attRepo = makeAttemptRepo([attempt]);

      await expect(markDisrupted(attRepo, "attempt-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });
  });

  describe("restoreAttempt", () => {
    it("transitions disrupted → in_progress and preserves answers + remaining time", async () => {
      const attempt = makeAttempt({
        status: "disrupted",
        answers: [
          {
            questionId: "q1",
            answer: "a",
            version: 1,
            savedAt: new Date("2025-01-01T10:15:00Z"),
          },
        ],
        deadlineAt: new Date("2025-01-01T11:00:00Z"),
        lastActivityAt: new Date("2025-01-01T10:20:00Z"),
      });
      const exam = makeExam();
      const examRepo = { findById: () => exam, update: () => exam };
      const attRepo = makeAttemptRepo([attempt]);

      const restoreNow = new Date("2025-01-01T10:30:00Z");
      const result = await restoreAttempt(
        examRepo,
        attRepo,
        "attempt-1",
        restoreNow,
      );

      expect(result.status).toBe("in_progress");
      expect(result.answers).toHaveLength(1);
      expect(result.answers[0]!.answer).toBe("a");
      expect(result.deadlineAt).toBeDefined();
      expect(result.lastActivityAt).toEqual(restoreNow);
    });

    it("throws for non disrupted attempt", async () => {
      const attempt = makeAttempt({ status: "in_progress" });
      const exam = makeExam();
      const examRepo = { findById: () => exam, update: () => exam };
      const attRepo = makeAttemptRepo([attempt]);

      await expect(
        restoreAttempt(examRepo, attRepo, "attempt-1", fixedNow),
      ).rejects.toThrow(InvalidStateTransitionError);
    });

    it("throws for non-existent attempt", async () => {
      const exam = makeExam();
      const examRepo = { findById: () => exam, update: () => exam };
      const attRepo = makeAttemptRepo();

      await expect(
        restoreAttempt(examRepo, attRepo, "nonexistent", fixedNow),
      ).rejects.toThrow(ValidationError);
    });

    it("keeps the original deadline while restoring a disrupted attempt", async () => {
      const attempt = makeAttempt({
        status: "disrupted",
        startedAt: new Date("2025-01-01T10:00:00Z"),
        deadlineAt: new Date("2025-01-01T11:00:00Z"),
        lastActivityAt: new Date("2025-01-01T10:20:00Z"),
      });
      const exam = makeExam();
      const examRepo = { findById: () => exam, update: () => exam };
      const attRepo = makeAttemptRepo([attempt]);

      const restoreNow = new Date("2025-01-01T10:30:00Z");
      const result = await restoreAttempt(
        examRepo,
        attRepo,
        "attempt-1",
        restoreNow,
      );

      expect(result.deadlineAt).toEqual(new Date("2025-01-01T11:00:00Z"));
    });
  });
});
