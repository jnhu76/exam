import { describe, expect, it, vi } from "vitest";
import {
  startAttempt,
  startOrRestoreAttempt,
  submitAttempt,
  markDisrupted,
  restoreAttempt,
  restoreAttemptState,
  flagMisconduct,
  extendAttemptTime,
  type AttemptRepository,
  type EnrollmentRepository,
} from "./attemptCommands.js";
import type {
  AttemptGradingEntry,
  Exam,
  ExamAttempt,
  ExamEnrollment,
  AttemptInterruption,
  AttemptInterruptionEvent,
  QuestionSnapshot,
  RequestContext,
} from "@exam/domain";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import {
  AttemptDeadlineExceedsExamCloseError,
  ExamNotOpenError,
  InvalidStateTransitionError,
  ValidationError,
  MaxAttemptsReachedError,
} from "@exam/domain";
import { MisconductSeverity } from "@exam/domain";
import type {
  InterruptionEpisodeRepository,
  InterruptionEventRepository,
  TimeAdjustmentRepository,
} from "./interruptionRepositories.js";

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
      rubric: null,
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
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
    resultsPublishedAt: null,
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
    findByIdForUpdate(id) {
      return store.find((a) => a.id === id) ?? null;
    },
    findActiveByEnrollment(enrollmentId) {
      return (
        store.find(
          (a) =>
            a.enrollmentId === enrollmentId &&
            (a.status === "in_progress" || a.status === "disrupted"),
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
    refreshLastActivityIfInProgress(id, now) {
      const idx = store.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      if (store[idx]!.status !== "in_progress") return null;
      store[idx] = { ...store[idx]!, lastActivityAt: now };
      return store[idx]!;
    },
  };
}

function makeWorksetRepo(
  existing: AttemptGradingEntry[] = [],
): GradingWorksetRepository {
  const store = new Map<string, AttemptGradingEntry>();
  for (const e of existing) {
    store.set(`${e.attemptId}:${e.questionId}`, e);
  }
  let counter = 0;
  const repo: GradingWorksetRepository = {
    findByAttempt: async (attemptId: string) => {
      return Array.from(store.values()).filter(
        (e) => e.attemptId === attemptId,
      );
    },
    findByAttemptAndQuestion: async (attemptId, questionId) => {
      const found = store.get(`${attemptId}:${questionId}`);
      return found ? { ...found } : null;
    },
    bulkCreate: async (inputs) => {
      for (const input of inputs) {
        const key = `${input.attemptId}:${input.questionId}`;
        if (store.has(key)) {
          throw new Error(`duplicate grading entry for ${key}`);
        }
        store.set(key, {
          id: `entry-${++counter}`,
          organizationId: "org-1",
          comment: "",
          gradedBy: null,
          gradedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...input,
        });
      }
    },
    completeManualEntry: async (input) => {
      const key = `${input.attemptId}:${input.questionId}`;
      const existing = store.get(key);
      if (!existing) return null;
      const updated: AttemptGradingEntry = {
        ...existing,
        status: "completed_manual",
        earnedScore: input.earnedScore,
        correct: input.earnedScore >= input.maxScore,
        comment: input.comment,
        gradedBy: input.gradedBy,
        gradedAt: input.gradedAt,
        updatedAt: input.now,
      };
      store.set(key, updated);
      return { ...updated };
    },
    countPendingManualForAttempt: async (attemptId) =>
      Array.from(store.values()).filter(
        (e) =>
          e.attemptId === attemptId &&
          e.gradingMode === "manual" &&
          e.status === "pending_manual",
      ).length,
  };
  return repo;
}

function q1AutoEntry(
  attemptId: string,
  earnedScore: number,
  candidateAnswer: unknown = null,
): AttemptGradingEntry {
  return {
    id: "entry-q1",
    organizationId: "org-1",
    attemptId,
    questionId: "q1",
    gradingMode: "auto",
    status: "completed_auto",
    maxScore: 50,
    earnedScore,
    candidateAnswer,
    standardAnswer: "a",
    correct: earnedScore === 50,
    comment: "",
    gradedBy: null,
    gradedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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
    findByExamAndCandidateForUpdate(examId, candidateId) {
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

function makeGradingWorksetRepo(): GradingWorksetRepository {
  return {
    findByAttempt: async () => [],
    findByAttemptAndQuestion: async () => null,
    bulkCreate: async () => {},
    completeManualEntry: async () => null,
    countPendingManualForAttempt: async () => 0,
  };
}

describe("attemptCommands", () => {
  describe("startAttempt", () => {
    it("creates new attempt for candidate with enrollment", async () => {
      const exam = makeExam();
      const enrollment = makeEnrollment();
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
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

    // ADR-005 Slice 3 §4.3: late-entry cutoff on NEW attempt only.
    it("rejects new start after latestStartOffsetMinutes (ATTEMPT_LATE_ENTRY_CLOSED)", async () => {
      // openAt=09:00, offset=60min -> latestStartAt=10:00; now=10:30 > 10:00.
      const exam = makeExam({ latestStartOffsetMinutes: 60 });
      const enrollment = makeEnrollment();
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
      const enrRepo = makeEnrollmentRepo([enrollment]);
      const attRepo = makeAttemptRepo();

      await expect(
        startAttempt(examRepo, enrRepo, attRepo, "exam-1", "cand-1", fixedNow),
      ).rejects.toThrow(/late entry/i);
    });

    it("allows new start before latestStartOffsetMinutes cutoff", async () => {
      // openAt=09:00, offset=120min -> latestStartAt=11:00; now=10:30 < 11:00.
      const exam = makeExam({ latestStartOffsetMinutes: 120 });
      const enrollment = makeEnrollment();
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
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
    });

    it("late-entry cutoff does NOT block resume of an active attempt", async () => {
      // An in_progress attempt exists; now is past cutoff. Resume allowed.
      const exam = makeExam({ latestStartOffsetMinutes: 60 });
      const enrollment = makeEnrollment();
      const active = makeAttempt({ status: "in_progress" });
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
      const enrRepo = makeEnrollmentRepo([enrollment]);
      const attRepo = makeAttemptRepo([active]);

      const result = await startAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
      );
      expect(result.status).toBe("in_progress");
    });

    it("rejects when no enrollment exists (Phase 1 requires explicit assignment)", async () => {
      const exam = makeExam();
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
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
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
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

    it("restores disrupted attempt instead of creating new", async () => {
      const exam = makeExam();
      const enrollment = makeEnrollment({ attemptCount: 1 });
      const disruptedAttempt = makeAttempt({
        status: "disrupted",
        currentInterruptionId: "ep-1",
        interruptionTimingPolicySnapshot: {
          schemaVersion: 1,
          policy: "strict",
          perIncidentCapSeconds: null,
          perAttemptAggregateCapSeconds: null,
        },
        answers: [
          {
            questionId: "q1",
            answer: "a",
            version: 1,
            savedAt: new Date("2025-01-01T10:15:00Z"),
          },
        ],
      });
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
      const enrRepo = makeEnrollmentRepo([enrollment]);
      const attRepo = makeAttemptRepo([disruptedAttempt]);
      const episodeRepo: InterruptionEpisodeRepository = {
        create: async () => ({ id: "ep-1" }) as AttemptInterruption,
        findById: async () => null,
        findByAttemptForUpdate: async () => null,
        findLatestByAttempt: async () => null,
      };
      const eventRepo: InterruptionEventRepository = {
        insert: async () => ({ id: "evt-1" }) as AttemptInterruptionEvent,
        findDetected: async () =>
          ({
            id: "evt-detected",
            organizationId: "org-1",
            attemptId: "attempt-1",
            interruptionId: "ep-1",
            eventType: "detected",
            occurredAt: new Date("2025-01-01T10:00:00Z"),
            observedLastActivityAt: new Date("2025-01-01T10:00:00Z"),
            detectionSource: "heartbeat_timeout",
            timeoutSeconds: 60,
            policy: "strict",
            eligibleSeconds: null,
            timeAdjustmentId: null,
            actorId: null,
            reasonCode: "heartbeat_timeout",
            createdAt: new Date("2025-01-01T10:00:00Z"),
          }) as AttemptInterruptionEvent,
        findOutcome: async () => null,
        findLatestOutcomeByAttempt: async () => null,
      };
      const adjustmentRepo: TimeAdjustmentRepository = {
        insert: async () => ({ id: "adj-1" }) as any,
        findById: async () => null,
        findBoundedByInterruption: async () => null,
        sumBoundedGraceSeconds: async () => 0,
      };
      const gradingWorksetRepo = makeGradingWorksetRepo();

      const result = await startOrRestoreAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
        {
          episodeRepo,
          eventRepo,
          adjustmentRepo,
          gradingWorksetRepo,
        },
      );

      expect(result.attempt.id).toBe("attempt-1");
      expect(result.attempt.status).toBe("in_progress");
      expect(result.attempt.answers).toHaveLength(1);
    });

    it("returns existing in_progress attempt even after max attempts are exhausted", async () => {
      const exam = makeExam({
        retakePolicy: "max_attempts",
        maxAttempts: 1,
        latestStartOffsetMinutes: null,
        minSubmitAfterStartMinutes: null,
      });
      const enrollment = makeEnrollment({ attemptCount: 1 });
      const existingAttempt = makeAttempt();
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
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
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
      const enrRepo = makeEnrollmentRepo();
      const attRepo = makeAttemptRepo();

      await expect(
        startAttempt(examRepo, enrRepo, attRepo, "exam-1", "cand-1", fixedNow),
      ).rejects.toThrow(ExamNotOpenError);
    });

    it("throws ExamNotOpenError when exam is closed", async () => {
      const exam = makeExam({ status: "closed" });
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
      const enrRepo = makeEnrollmentRepo();
      const attRepo = makeAttemptRepo();

      await expect(
        startAttempt(examRepo, enrRepo, attRepo, "exam-1", "cand-1", fixedNow),
      ).rejects.toThrow(ExamNotOpenError);
    });

    it("throws ValidationError when exam not found", async () => {
      const examRepo = {
        findById: () => null,
        findByIdForUpdate: () => null,
        update: () => null,
      };
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
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
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
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
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
        latestStartOffsetMinutes: null,
        minSubmitAfterStartMinutes: null,
      });
      const enrollment = makeEnrollment({ attemptCount: 1 });
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
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
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
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
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
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

    it("uses findByExamAndCandidateForUpdate for enrollment lookup (transaction-safe)", async () => {
      const exam = makeExam();
      const enrollment = makeEnrollment();
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
      const attRepo = makeAttemptRepo();

      const enrRepo: EnrollmentRepository = {
        findByExamAndCandidate: () => null,
        findByExamAndCandidateForUpdate: () => enrollment,
        create: (input) => ({
          id: "enr-new",
          organizationId: input.organizationId,
          examId: input.examId,
          candidateId: input.candidateId,
          status: input.status,
          attemptCount: input.attemptCount,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        update: (_id, data) => ({ ...enrollment, ...data }) as ExamEnrollment,
      };

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
    });

    it("returns existing attempt when findByExamAndCandidateForUpdate finds active attempt", async () => {
      const exam = makeExam();
      const enrollment = makeEnrollment({ attemptCount: 1 });
      const existingAttempt = makeAttempt();
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
      const attRepo = makeAttemptRepo([existingAttempt]);

      const enrRepo: EnrollmentRepository = {
        findByExamAndCandidate: () => null,
        findByExamAndCandidateForUpdate: () => enrollment,
        create: (input) => ({
          id: "enr-new",
          organizationId: input.organizationId,
          examId: input.examId,
          candidateId: input.candidateId,
          status: input.status,
          attemptCount: input.attemptCount,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        update: (_id, data) => ({ ...enrollment, ...data }) as ExamEnrollment,
      };

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
  });

  describe("submitAttempt", () => {
    it("transitions in_progress → submitted", async () => {
      const attempt = makeAttempt();
      const attRepo = makeAttemptRepo([attempt]);
      const wsRepo = makeWorksetRepo();

      const result = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        fixedNow,
      );

      expect(result.status).toBe("submitted");
      expect(result.submittedAt).toEqual(fixedNow);
    });

    // ADR-005 Slice 3 §4.4: idempotent already-submitted path runs BEFORE
    // the early-submit rejection. A re-submit of an already-submitted/graded
    // attempt returns the current attempt instead of erroring.
    it("returns idempotent success for an already-submitted attempt", async () => {
      const attempt = makeAttempt({
        status: "submitted",
        submittedAnswers: { schemaVersion: 1, answers: [] },
        gradingStatus: "auto_graded",
      });
      const attRepo = makeAttemptRepo([attempt]);
      const wsRepo = makeWorksetRepo([q1AutoEntry("attempt-1", 0)]);

      const result = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        fixedNow,
      );

      expect(result.status).toBe("submitted");
    });

    it("returns idempotent success for a graded attempt", async () => {
      const attempt = makeAttempt({
        status: "graded",
        submittedAnswers: { schemaVersion: 1, answers: [] },
        gradingStatus: "auto_graded",
      });
      const attRepo = makeAttemptRepo([attempt]);
      const wsRepo = makeWorksetRepo([q1AutoEntry("attempt-1", 0)]);

      const result = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        fixedNow,
      );

      expect(result.status).toBe("graded");
    });

    it("rejects candidate submit before minSubmitAfterStartMinutes (ATTEMPT_SUBMIT_TOO_EARLY)", async () => {
      const startedAt = new Date("2025-01-01T10:00:00Z");
      const attempt = makeAttempt({ status: "in_progress", startedAt });
      const attRepo = makeAttemptRepo([attempt]);
      const wsRepo = makeWorksetRepo();

      await expect(
        submitAttempt(
          attRepo,
          wsRepo,
          "attempt-1",
          new Date("2025-01-01T10:05:00Z"),
          {
            source: "candidate",
            minSubmitAfterStartMinutes: 30,
          },
        ),
      ).rejects.toThrow(/too early/i);
    });

    it("allows candidate submit at/after minSubmitAfterStartMinutes", async () => {
      const startedAt = new Date("2025-01-01T10:00:00Z");
      const attempt = makeAttempt({ status: "in_progress", startedAt });
      const attRepo = makeAttemptRepo([attempt]);
      const wsRepo = makeWorksetRepo();

      const result = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        new Date("2025-01-01T10:31:00Z"),
        { source: "candidate", minSubmitAfterStartMinutes: 30 },
      );

      expect(result.status).toBe("submitted");
    });

    it("deadline_scanner bypasses minSubmitAfterStartMinutes", async () => {
      const startedAt = new Date("2025-01-01T10:00:00Z");
      const attempt = makeAttempt({ status: "in_progress", startedAt });
      const attRepo = makeAttemptRepo([attempt]);
      const wsRepo = makeWorksetRepo();

      const result = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        new Date("2025-01-01T10:01:00Z"),
        { source: "deadline_scanner", minSubmitAfterStartMinutes: 30 },
      );

      expect(result.status).toBe("submitted");
    });

    it("throws ValidationError for non-existent attempt", async () => {
      const attRepo = makeAttemptRepo();
      const wsRepo = makeWorksetRepo();

      await expect(
        submitAttempt(attRepo, wsRepo, "nonexistent", fixedNow),
      ).rejects.toThrow(ValidationError);
    });

    it("allows late submission (past deadline) — answers already saved on server", async () => {
      const attempt = makeAttempt({
        deadlineAt: new Date("2025-01-01T09:00:00Z"),
      });
      const attRepo = makeAttemptRepo([attempt]);
      const wsRepo = makeWorksetRepo();

      const result = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        new Date("2025-01-01T11:00:00Z"),
      );

      expect(result.status).toBe("submitted");
    });

    it("throws ValidationError when submit update returns null", async () => {
      const attempt = makeAttempt();
      const attRepo: AttemptRepository = {
        findById: () => attempt,
        findByIdForUpdate: () => attempt,
        findActiveByEnrollment: () => null,
        findByEnrollmentAndAttemptNo: () => null,
        create: () => attempt,
        update: () => null,
        refreshLastActivityIfInProgress: () => attempt,
      };
      const wsRepo = makeWorksetRepo();

      await expect(
        submitAttempt(attRepo, wsRepo, "attempt-1", fixedNow),
      ).rejects.toThrow(ValidationError);
    });

    // --- P0-1: row-lock TOCTOU defense (findByIdForUpdate) ---

    // Case A: submitAttempt must read via the row-locking path, not a bare
    // findById. Proves the read that feeds the idempotency/state checks is the
    // FOR UPDATE read, matching restoreAttempt / extendAttemptTime.
    it("reads the attempt via findByIdForUpdate (row lock), not bare findById", async () => {
      const attempt = makeAttempt();
      const attRepo: AttemptRepository = {
        findById: () => attempt,
        findByIdForUpdate: () => attempt,
        findActiveByEnrollment: () => null,
        findByEnrollmentAndAttemptNo: () => null,
        create: () => attempt,
        update: (id, data) => ({ ...attempt, id, ...data }),
        refreshLastActivityIfInProgress: () => attempt,
      };
      const findByIdSpy = vi.spyOn(attRepo, "findById");
      const findForUpdateSpy = vi.spyOn(attRepo, "findByIdForUpdate");
      const wsRepo = makeWorksetRepo();

      await submitAttempt(attRepo, wsRepo, "attempt-1", fixedNow);

      expect(findForUpdateSpy).toHaveBeenCalledTimes(1);
      expect(findForUpdateSpy).toHaveBeenCalledWith("attempt-1");
      expect(findByIdSpy).not.toHaveBeenCalled();
    });

    // Case B (deterministic lock-ordering): the candidate submit and the
    // deadline-scanner autoSubmit both target the same in_progress row. With a
    // lock read, the second submitter observes the freshly-submitted row and
    // takes the idempotent path -> exactly one status write, one stable
    // terminal state, no duplicate scoring/audit trigger (the engine itself
    // emits no extra write here).
    it("candidate submit + scanner autoSubmit converge on one submitted result (single status write)", async () => {
      const attempt = makeAttempt({ status: "in_progress" });
      const store: ExamAttempt[] = [attempt];

      const attRepo: AttemptRepository = {
        findById: (id) => store.find((a) => a.id === id) ?? null,
        findByIdForUpdate: (id) => store.find((a) => a.id === id) ?? null,
        findActiveByEnrollment: () => null,
        findByEnrollmentAndAttemptNo: () => null,
        create: (input) => {
          const created = {
            ...input,
            id: "x",
            createdAt: new Date(),
            updatedAt: new Date(),
          } as ExamAttempt;
          store.push(created);
          return created;
        },
        // Single mutating write shared by both submitters.
        update: (id, data) => {
          const idx = store.findIndex((a) => a.id === id);
          if (idx === -1) return null;
          store[idx] = { ...store[idx]!, ...data };
          return store[idx]!;
        },
        refreshLastActivityIfInProgress: (id, now) => {
          const idx = store.findIndex((a) => a.id === id);
          if (idx === -1) return null;
          if (store[idx]!.status !== "in_progress") return null;
          store[idx] = { ...store[idx]!, lastActivityAt: now };
          return store[idx]!;
        },
      };
      const updateSpy = vi.spyOn(attRepo, "update");
      const wsRepo = makeWorksetRepo();

      // Candidate submits first, then the scanner observes the locked row and
      // must NOT mutate it again.
      const candidateNow = new Date("2025-01-01T10:45:00Z");
      const scannerNow = new Date("2025-01-01T10:46:00Z");
      const first = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        candidateNow,
        { source: "candidate" },
      );
      const second = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        scannerNow,
        { source: "deadline_scanner" },
      );

      expect(first.status).toBe("submitted");
      expect(first.submittedAt).toEqual(candidateNow);
      // Second submitter converged on the existing terminal state.
      expect(second.status).toBe("submitted");
      expect(second.submittedAt).toEqual(candidateNow);

      // Exactly one status-mutating write across both submitters; the scanner
      // took the idempotent branch (no extra write, no overwrite of submittedAt).
      const statusWrites = updateSpy.mock.calls.filter(([, data]) =>
        Boolean(data && typeof data === "object" && "status" in data),
      );
      expect(statusWrites).toHaveLength(1);

      const final = await attRepo.findByIdForUpdate("attempt-1");
      expect(final?.status).toBe("submitted");
      expect(final?.submittedAt).toEqual(candidateNow);
    });

    // Case C: a re-submit of an already-terminal attempt returns the current
    // attempt and performs NO mutating write (idempotency survives the lock
    // read — the locked row is already terminal).
    it("re-submit of a graded attempt is idempotent and performs no write", async () => {
      const graded = makeAttempt({
        status: "graded",
        score: 80,
        submittedAt: new Date("2025-01-01T10:45:00Z"),
        submittedAnswers: { schemaVersion: 1, answers: [] },
        gradingStatus: "auto_graded",
      });
      const store: ExamAttempt[] = [graded];
      const attRepo: AttemptRepository = {
        findById: (id) => store.find((a) => a.id === id) ?? null,
        findByIdForUpdate: (id) => store.find((a) => a.id === id) ?? null,
        findActiveByEnrollment: () => null,
        findByEnrollmentAndAttemptNo: () => null,
        create: (input) => {
          const created = {
            ...input,
            id: "x",
            createdAt: new Date(),
            updatedAt: new Date(),
          } as ExamAttempt;
          store.push(created);
          return created;
        },
        update: (id, data) => {
          const idx = store.findIndex((a) => a.id === id);
          if (idx === -1) return null;
          store[idx] = { ...store[idx]!, ...data };
          return store[idx]!;
        },
        refreshLastActivityIfInProgress: (id, now) => {
          const idx = store.findIndex((a) => a.id === id);
          if (idx === -1) return null;
          if (store[idx]!.status !== "in_progress") return null;
          store[idx] = { ...store[idx]!, lastActivityAt: now };
          return store[idx]!;
        },
      };
      const updateSpy = vi.spyOn(attRepo, "update");
      const wsRepo = makeWorksetRepo([q1AutoEntry("attempt-1", 0)]);

      const result = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        new Date("2025-01-01T12:00:00Z"),
        { source: "candidate" },
      );

      expect(result.status).toBe("graded");
      expect(result.score).toBe(80);
      expect(updateSpy).not.toHaveBeenCalled();

      const final = await attRepo.findByIdForUpdate("attempt-1");
      expect(final?.status).toBe("graded");
      expect(final?.score).toBe(80);
    });

    // ── P3-L0-2: submit freeze writes submittedAnswers + submissionReason ──

    it("freezes a SubmittedAnswersSnapshot from draft answers on submit", async () => {
      const attempt = makeAttempt({
        answers: [
          {
            questionId: "q1",
            answer: "a",
            version: 2,
            savedAt: new Date("2025-01-01T10:05:00Z"),
          },
        ],
      });
      const attRepo = makeAttemptRepo([attempt]);
      const wsRepo = makeWorksetRepo();

      const result = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        fixedNow,
      );

      expect(result.submittedAnswers).toEqual({
        schemaVersion: 1,
        answers: [{ questionId: "q1", value: "a" }],
      });
    });

    it("writes submissionReason='manual' by default (candidate submit)", async () => {
      const attempt = makeAttempt();
      const attRepo = makeAttemptRepo([attempt]);
      const wsRepo = makeWorksetRepo();

      const result = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        fixedNow,
      );

      expect(result.submissionReason).toBe("manual");
    });

    it("writes submissionReason='deadline' when the caller passes it", async () => {
      const attempt = makeAttempt();
      const attRepo = makeAttemptRepo([attempt]);
      const wsRepo = makeWorksetRepo();

      const result = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        fixedNow,
        { submissionReason: "deadline" },
      );

      expect(result.submissionReason).toBe("deadline");
    });

    it("does NOT rebuild submittedAnswers on an already-submitted attempt (idempotent)", async () => {
      const frozen = {
        schemaVersion: 1 as const,
        answers: [{ questionId: "q1", value: "frozen-value" }],
      };
      const attempt = makeAttempt({
        status: "submitted",
        submittedAnswers: frozen,
        submissionReason: "deadline",
        submittedAt: new Date("2025-01-01T10:30:00Z"),
        gradingStatus: "auto_graded",
      });
      const attRepo = makeAttemptRepo([attempt]);
      const wsRepo = makeWorksetRepo([
        q1AutoEntry("attempt-1", 0, "frozen-value"),
      ]);

      const result = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        fixedNow,
      );

      // Idempotent: existing frozen snapshot + reason + submittedAt preserved.
      expect(result.submittedAnswers).toEqual(frozen);
      expect(result.submissionReason).toBe("deadline");
      expect(result.submittedAt).toEqual(new Date("2025-01-01T10:30:00Z"));
    });
  });

  describe("markDisrupted", () => {
    function makeInterruptionRepos(): {
      episodeRepo: InterruptionEpisodeRepository;
      eventRepo: InterruptionEventRepository;
    } {
      let episodeIdCounter = 0;
      return {
        episodeRepo: {
          create: async () => {
            episodeIdCounter++;
            return {
              id: `episode-${episodeIdCounter}`,
              organizationId: "org-1",
              attemptId: "attempt-1",
              createdAt: new Date("2025-01-01T10:05:00Z"),
            } as AttemptInterruption;
          },
          findById: async () => null,
          findByAttemptForUpdate: async () => null,
          findLatestByAttempt: async () => null,
        },
        eventRepo: {
          insert: async () => ({ id: "evt-1" }) as AttemptInterruptionEvent,
          findDetected: async () => null,
          findOutcome: async () => null,
          findLatestOutcomeByAttempt: async () => null,
        },
      };
    }

    it("transitions in_progress → disrupted with episode + detected event", async () => {
      const attempt = makeAttempt({
        lastActivityAt: new Date("2025-01-01T09:55:00Z"),
      });
      const attRepo = makeAttemptRepo([attempt]);
      const { episodeRepo, eventRepo } = makeInterruptionRepos();
      const scannerTickNow = new Date("2025-01-01T10:05:00Z");

      const result = await markDisrupted(
        attRepo,
        episodeRepo,
        eventRepo,
        "attempt-1",
        scannerTickNow,
        60,
      );

      expect(result.outcome).toBe("marked");
      if (result.outcome === "marked") {
        expect(result.attempt.status).toBe("disrupted");
        expect(result.attempt.currentInterruptionId).toBe("episode-1");
        expect(result.attempt.interruptedAt).toEqual(scannerTickNow);
      }
    });

    it("returns fresh_under_lock when lastActivityAt is recent enough", async () => {
      const attempt = makeAttempt({
        lastActivityAt: new Date("2025-01-01T10:04:30Z"), // 30s ago, < 60s timeout
      });
      const attRepo = makeAttemptRepo([attempt]);
      const { episodeRepo, eventRepo } = makeInterruptionRepos();
      const scannerTickNow = new Date("2025-01-01T10:05:00Z");

      const result = await markDisrupted(
        attRepo,
        episodeRepo,
        eventRepo,
        "attempt-1",
        scannerTickNow,
        60,
      );

      expect(result.outcome).toBe("fresh_under_lock");
    });

    it("returns fresh_under_lock when lastActivityAt is null", async () => {
      const attempt = makeAttempt();
      // The attempt must have no lastActivityAt to simulate a null value.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { lastActivityAt: _omit, ...rest } = attempt;
      const attRepo = makeAttemptRepo([rest as ExamAttempt]);
      const { episodeRepo, eventRepo } = makeInterruptionRepos();
      const scannerTickNow = new Date("2025-01-01T10:05:00Z");

      const result = await markDisrupted(
        attRepo,
        episodeRepo,
        eventRepo,
        "attempt-1",
        scannerTickNow,
        60,
      );

      expect(result.outcome).toBe("fresh_under_lock");
    });

    it("returns state_changed_before_lock for non in_progress attempt", async () => {
      const attempt = makeAttempt({ status: "submitted" });
      const attRepo = makeAttemptRepo([attempt]);
      const { episodeRepo, eventRepo } = makeInterruptionRepos();
      const scannerTickNow = new Date("2025-01-01T10:05:00Z");

      const result = await markDisrupted(
        attRepo,
        episodeRepo,
        eventRepo,
        "attempt-1",
        scannerTickNow,
        60,
      );

      expect(result.outcome).toBe("state_changed_before_lock");
    });

    it("returns missing when attempt not found", async () => {
      const attRepo = makeAttemptRepo([]);
      const { episodeRepo, eventRepo } = makeInterruptionRepos();
      const scannerTickNow = new Date("2025-01-01T10:05:00Z");

      const result = await markDisrupted(
        attRepo,
        episodeRepo,
        eventRepo,
        "nonexistent",
        scannerTickNow,
        60,
      );

      expect(result.outcome).toBe("missing");
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
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
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

    it("returns attempt directly when already in_progress", async () => {
      const attempt = makeAttempt({ status: "in_progress" });
      const exam = makeExam();
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
      const attRepo = makeAttemptRepo([attempt]);

      const result = await restoreAttempt(
        examRepo,
        attRepo,
        "attempt-1",
        fixedNow,
      );

      expect(result.status).toBe("in_progress");
      expect(result.id).toBe("attempt-1");
    });

    it("throws for non-existent attempt", async () => {
      const exam = makeExam();
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
      const attRepo = makeAttemptRepo();

      await expect(
        restoreAttempt(examRepo, attRepo, "nonexistent", fixedNow),
      ).rejects.toThrow(ValidationError);
    });

    it("adjusts deadlineAt by the time spent disconnected", async () => {
      const attempt = makeAttempt({
        status: "disrupted",
        startedAt: new Date("2025-01-01T10:00:00Z"),
        deadlineAt: new Date("2025-01-01T11:00:00Z"),
        lastActivityAt: new Date("2025-01-01T10:20:00Z"),
      });
      const exam = makeExam();
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
      const attRepo = makeAttemptRepo([attempt]);

      const restoreNow = new Date("2025-01-01T10:30:00Z");
      const result = await restoreAttempt(
        examRepo,
        attRepo,
        "attempt-1",
        restoreNow,
      );

      const disconnectedMs =
        restoreNow.getTime() - attempt.lastActivityAt!.getTime();
      const expectedDeadline = new Date(
        attempt.deadlineAt!.getTime() + disconnectedMs,
      );
      expect(result.deadlineAt).toEqual(expectedDeadline);
    });

    it("caps new deadlineAt at exam.closeAt when disconnected time pushes past it", async () => {
      const attempt = makeAttempt({
        status: "disrupted",
        startedAt: new Date("2025-01-01T10:00:00Z"),
        deadlineAt: new Date("2025-01-01T11:50:00Z"),
        lastActivityAt: new Date("2025-01-01T10:20:00Z"),
      });
      const exam = makeExam({
        closeAt: new Date("2025-01-01T12:00:00Z"),
      });
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
      const attRepo = makeAttemptRepo([attempt]);

      const restoreNow = new Date("2025-01-01T11:55:00Z");
      const result = await restoreAttempt(
        examRepo,
        attRepo,
        "attempt-1",
        restoreNow,
      );

      expect(result.deadlineAt).toEqual(new Date("2025-01-01T12:00:00Z"));
    });

    it("does not double-apply deadline adjustment when called twice (idempotent)", async () => {
      const attempt = makeAttempt({
        status: "disrupted",
        startedAt: new Date("2025-01-01T10:00:00Z"),
        deadlineAt: new Date("2025-01-01T11:00:00Z"),
        lastActivityAt: new Date("2025-01-01T10:20:00Z"),
      });
      const exam = makeExam();
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };
      const attRepo = makeAttemptRepo([attempt]);

      const restoreNow = new Date("2025-01-01T10:30:00Z");
      const first = await restoreAttempt(
        examRepo,
        attRepo,
        "attempt-1",
        restoreNow,
      );

      const secondRestoreNow = new Date("2025-01-01T10:35:00Z");
      const second = await restoreAttempt(
        examRepo,
        attRepo,
        "attempt-1",
        secondRestoreNow,
      );

      expect(second.deadlineAt).toEqual(first.deadlineAt);
      expect(second.status).toBe("in_progress");
    });
  });

  describe("restoreAttemptState (lifecycle-only)", () => {
    const restoreNow = new Date("2025-01-01T10:30:00Z");

    it("transitions disrupted → in_progress, refreshes lastActivityAt, clears pointer/mirror", async () => {
      const attempt = makeAttempt({
        status: "disrupted",
        deadlineAt: new Date("2025-01-01T11:00:00Z"),
        lastActivityAt: new Date("2025-01-01T10:00:00Z"),
        currentInterruptionId: "int-1",
        interruptedAt: new Date("2025-01-01T10:05:00Z"),
      });
      const attRepo = makeAttemptRepo([attempt]);
      const { outcome, attempt: restored } = await restoreAttemptState(
        attempt,
        attRepo,
        restoreNow,
      );
      expect(outcome).toBe("restored");
      expect(restored.status).toBe("in_progress");
      expect(restored.lastActivityAt).toEqual(restoreNow);
      expect(restored.currentInterruptionId).toBeNull();
      expect(restored.interruptedAt).toBeNull();
    });

    it("does NOT mutate the deadline (lifecycle-only, no compensation)", async () => {
      const deadline = new Date("2025-01-01T11:00:00Z");
      const attempt = makeAttempt({
        status: "disrupted",
        deadlineAt: deadline,
        lastActivityAt: new Date("2025-01-01T10:00:00Z"),
      });
      const attRepo = makeAttemptRepo([attempt]);
      const { attempt: restored } = await restoreAttemptState(
        attempt,
        attRepo,
        restoreNow,
      );
      expect(restored.deadlineAt).toEqual(deadline);
    });

    it("returns already_in_progress when the locked attempt is in_progress", async () => {
      const attempt = makeAttempt({ status: "in_progress" });
      const attRepo = makeAttemptRepo([attempt]);
      const { outcome } = await restoreAttemptState(
        attempt,
        attRepo,
        restoreNow,
      );
      expect(outcome).toBe("already_in_progress");
    });

    it("returns terminal when the locked attempt is submitted/grading/graded/voided", async () => {
      for (const status of [
        "submitted",
        "grading",
        "graded",
        "voided",
      ] as const) {
        const attempt = makeAttempt({ status });
        const attRepo = makeAttemptRepo([attempt]);
        const { outcome } = await restoreAttemptState(
          attempt,
          attRepo,
          restoreNow,
        );
        expect(outcome).toBe("terminal");
      }
    });

    it("fails closed for not_started/queued", async () => {
      for (const status of ["not_started", "queued"] as const) {
        const attempt = makeAttempt({ status });
        const attRepo = makeAttemptRepo([attempt]);
        await expect(
          restoreAttemptState(attempt, attRepo, restoreNow),
        ).rejects.toThrow();
      }
    });
  });

  describe("flagMisconduct", () => {
    const fixedNow = new Date("2025-01-01T10:30:00Z");

    it("records a misconduct flag on an in_progress attempt without changing status", async () => {
      const attempt = makeAttempt({ status: "in_progress" });
      const repo = makeAttemptRepo([attempt]);

      const result = await flagMisconduct(
        repo,
        "attempt-1",
        "admin-1",
        MisconductSeverity.Serious,
        "looked at phone",
        fixedNow,
      );

      expect(result.misconduct).toEqual({
        flaggedAt: fixedNow,
        flaggedBy: "admin-1",
        notes: "looked at phone",
        severity: "serious",
      });
      expect(result.status).toBe("in_progress");
    });

    it("overwrites a previous flag on re-flag (idempotent upsert)", async () => {
      const attempt = makeAttempt({ status: "in_progress" });
      const repo = makeAttemptRepo([attempt]);

      await flagMisconduct(
        repo,
        "attempt-1",
        "admin-1",
        MisconductSeverity.Warning,
        "first note",
        fixedNow,
      );
      const later = new Date("2025-01-01T11:00:00Z");
      const result = await flagMisconduct(
        repo,
        "attempt-1",
        "admin-2",
        MisconductSeverity.Serious,
        "updated note",
        later,
      );

      expect(result.misconduct).toEqual({
        flaggedAt: later,
        flaggedBy: "admin-2",
        notes: "updated note",
        severity: "serious",
      });
    });

    it("allows flagging a voided attempt (any state per P2C-J4 §16)", async () => {
      const repo = makeAttemptRepo([makeAttempt({ status: "voided" })]);

      const result = await flagMisconduct(
        repo,
        "attempt-1",
        "admin-1",
        MisconductSeverity.Warning,
        "note",
        fixedNow,
      );

      expect(result.misconduct?.severity).toBe("warning");
      expect(result.status).toBe("voided");
    });
    it("throws ValidationError for empty notes", async () => {
      const repo = makeAttemptRepo([makeAttempt()]);

      await expect(
        flagMisconduct(
          repo,
          "attempt-1",
          "admin-1",
          MisconductSeverity.Warning,
          "   ",
          fixedNow,
        ),
      ).rejects.toThrow(ValidationError);
    });
  });
  describe("extendAttemptTime", () => {
    const fixedNow = new Date("2025-01-01T10:30:00Z");

    it("extends an in_progress attempt's deadline by additionalMinutes", async () => {
      const attempt = makeAttempt({
        deadlineAt: new Date("2025-01-01T11:00:00Z"),
      });
      const attRepo = makeAttemptRepo([attempt]);
      const examRepo = {
        findById: () => makeExam(),
        findByIdForUpdate: () => makeExam(),
        update: () => makeExam(),
      };

      const result = await extendAttemptTime(
        examRepo,
        attRepo,
        "attempt-1",
        15,
        fixedNow,
      );

      // 11:00 + 15min = 11:15, still before exam closeAt 12:00.
      expect(result.deadlineAt).toEqual(new Date("2025-01-01T11:15:00Z"));
      expect(result.status).toBe("in_progress");
    });

    it("extends a disrupted attempt's deadline", async () => {
      const attempt = makeAttempt({
        status: "disrupted",
        deadlineAt: new Date("2025-01-01T11:00:00Z"),
      });
      const attRepo = makeAttemptRepo([attempt]);
      const examRepo = {
        findById: () => makeExam(),
        findByIdForUpdate: () => makeExam(),
        update: () => makeExam(),
      };

      const result = await extendAttemptTime(
        examRepo,
        attRepo,
        "attempt-1",
        30,
        fixedNow,
      );

      expect(result.deadlineAt).toEqual(new Date("2025-01-01T11:30:00Z"));
      expect(result.status).toBe("disrupted");
    });

    it("rejects with AttemptDeadlineExceedsExamCloseError when new deadline > exam.closeAt", async () => {
      const attempt = makeAttempt({
        deadlineAt: new Date("2025-01-01T11:00:00Z"),
      });
      const attRepo = makeAttemptRepo([attempt]);
      const examRepo = {
        findById: () => makeExam(),
        findByIdForUpdate: () => makeExam(),
        update: () => makeExam(),
      };

      // 11:00 + 120min = 13:00 > exam closeAt 12:00.
      await expect(
        extendAttemptTime(examRepo, attRepo, "attempt-1", 120, fixedNow),
      ).rejects.toThrow(AttemptDeadlineExceedsExamCloseError);

      // Deadline must be unchanged after rejection.
      const after = await attRepo.findById("attempt-1");
      expect(after?.deadlineAt).toEqual(new Date("2025-01-01T11:00:00Z"));
    });

    it("throws InvalidStateTransitionError for submitted/graded/voided attempts", async () => {
      const attRepo = makeAttemptRepo([makeAttempt({ status: "submitted" })]);
      const examRepo = {
        findById: () => makeExam(),
        findByIdForUpdate: () => makeExam(),
        update: () => makeExam(),
      };

      await expect(
        extendAttemptTime(examRepo, attRepo, "attempt-1", 10, fixedNow),
      ).rejects.toThrow(InvalidStateTransitionError);
    });

    it("throws ValidationError for non-positive or non-integer additionalMinutes", async () => {
      const attRepo = makeAttemptRepo([makeAttempt()]);
      const examRepo = {
        findById: () => makeExam(),
        findByIdForUpdate: () => makeExam(),
        update: () => makeExam(),
      };

      await expect(
        extendAttemptTime(examRepo, attRepo, "attempt-1", 0, fixedNow),
      ).rejects.toThrow(ValidationError);
      await expect(
        extendAttemptTime(examRepo, attRepo, "attempt-1", -5, fixedNow),
      ).rejects.toThrow(ValidationError);
      await expect(
        extendAttemptTime(examRepo, attRepo, "attempt-1", 5.5, fixedNow),
      ).rejects.toThrow(ValidationError);
    });
  });
});
