import { describe, expect, it, vi } from "vitest";
import {
  startOrRestoreAttempt,
  submitAttempt,
  markDisrupted,
  restoreAttemptState,
  flagMisconduct,
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
  AttemptTimeAdjustment,
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
  ExamAlreadyPassedError,
  RetakeDeferredError,
} from "@exam/domain";
import { MisconductSeverity } from "@exam/domain";
import type {
  InterruptionEpisodeRepository,
  InterruptionEventRepository,
  TimeAdjustmentRepository,
} from "./interruptionRepositories.js";
import type { SubmitInterruptionResolution } from "./restoreInterruption.js";

const stubEpisodeRepo: InterruptionEpisodeRepository = {
  create: async () => ({ id: "stub" }) as never,
  findById: async () => null,
  findByAttemptForUpdate: async () => null,
  findLatestByAttempt: async () => null,
};
const stubEventRepo: InterruptionEventRepository = {
  insert: async (input) => ({ id: "stub-event", ...input }) as never,
  findDetected: async () => null,
  findOutcome: async () => null,
  findLatestOutcomeByAttempt: async () => null,
};
const noneResolution: SubmitInterruptionResolution = {
  mode: "none",
  episodeRepo: stubEpisodeRepo,
  eventRepo: stubEventRepo,
};

const stubAdjustmentRepo: TimeAdjustmentRepository = {
  insert: async (input) => ({ id: "stub-adj", ...input }) as never,
  findById: async () => null,
  findByOperationId: async () => null,
  findBoundedByInterruption: async () => null,
  sumBoundedGraceSeconds: async () => 0,
};
const stubGradingWorksetRepo: GradingWorksetRepository = {
  findByAttempt: async () => [],
  findByAttemptAndQuestion: async () => null,
  bulkCreate: async () => {},
  completeManualEntry: async () => null,
  countPendingManualForAttempt: async () => 0,
};
const startDeps = {
  episodeRepo: stubEpisodeRepo,
  eventRepo: stubEventRepo,
  adjustmentRepo: stubAdjustmentRepo,
  gradingWorksetRepo: stubGradingWorksetRepo,
};

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

/**
 * Minimal deferred for deterministic concurrency handshakes.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
  describe("startOrRestoreAttempt", () => {
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

      const { attempt: result } = await startOrRestoreAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
        startDeps,
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
        startOrRestoreAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "exam-1",
          "cand-1",
          fixedNow,
          startDeps,
        ),
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

      const { attempt: result } = await startOrRestoreAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
        startDeps,
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

      const { attempt: result } = await startOrRestoreAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
        startDeps,
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
        startOrRestoreAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "exam-1",
          "cand-1",
          fixedNow,
          startDeps,
        ),
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

      const { attempt: result } = await startOrRestoreAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
        startDeps,
      );

      expect(result.id).toBe("attempt-1");
    });

    it("restores disrupted attempt instead of creating new", async () => {
      const exam = makeExam();
      const enrollment = makeEnrollment({ attemptCount: 1 });
      const detectedAt = new Date("2025-01-01T10:00:00Z");
      const disruptedAttempt = makeAttempt({
        status: "disrupted",
        currentInterruptionId: "ep-1",
        interruptedAt: detectedAt,
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
        findByAttemptForUpdate: async (
          attemptId: string,
          interruptionId: string,
        ) =>
          attemptId === "attempt-1" && interruptionId === "ep-1"
            ? ({
                id: "ep-1",
                attemptId: "attempt-1",
                organizationId: "org-1",
                createdAt: detectedAt,
              } as AttemptInterruption)
            : null,
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
            occurredAt: detectedAt,
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
        insert: async () =>
          ({
            id: "adj-1",
            operationId: "op-1",
            organizationId: "org-1",
            attemptId: "attempt-1",
            interruptionId: null,
            incidentId: null,
            policy: "strict",
            source: "operator",
            beforeDeadline: new Date("2025-01-01T10:00:00Z"),
            afterDeadline: new Date("2025-01-01T10:00:00Z"),
            addedSeconds: 0,
            eligibleSeconds: 0,
            reasonCode: "strict_zero_grant",
            reasonText: null,
            actorId: null,
            createdAt: new Date("2025-01-01T10:00:00Z"),
          }) as AttemptTimeAdjustment,
        findById: async () => null,
        findByOperationId: async () => null,
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

      const { attempt: result } = await startOrRestoreAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
        startDeps,
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
        startOrRestoreAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "exam-1",
          "cand-1",
          fixedNow,
          startDeps,
        ),
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
        startOrRestoreAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "exam-1",
          "cand-1",
          fixedNow,
          startDeps,
        ),
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
        startOrRestoreAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "nonexistent",
          "cand-1",
          fixedNow,
          startDeps,
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
        startOrRestoreAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "exam-1",
          "cand-1",
          new Date("2025-01-01T11:00:00Z"),
          startDeps,
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
        startOrRestoreAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "exam-1",
          "cand-1",
          new Date("2025-01-01T10:30:00Z"),
          startDeps,
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
        startOrRestoreAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "exam-1",
          "cand-1",
          fixedNow,
          startDeps,
        ),
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

      const { attempt: result } = await startOrRestoreAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
        startDeps,
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

      const { attempt: result } = await startOrRestoreAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
        startDeps,
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

      const { attempt: result } = await startOrRestoreAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
        startDeps,
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

      const { attempt: result } = await startOrRestoreAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
        startDeps,
      );

      expect(result.id).toBe("attempt-1");
    });

    // ── #324 review P1-3: retake deferral under the enrollment lock ────────
    //
    // While a pass_then_stop final result exists but is hidden (manual mode,
    // not yet published), the start decision must defer BOTH passed and failed
    // candidates with the same error. The decision runs inside the engine AFTER
    // the enrollment lock, so it shares the grading finalizer's serialization
    // boundary — no pre-transaction read can race ahead of a committed
    // terminalization and leak a 409-vs-201 pass/fail oracle.

    function hiddenPassThenStopExam() {
      return makeExam({
        retakePolicy: "pass_then_stop",
        resultPublicationMode: "manual",
        resultsPublishedAt: null,
      });
    }

    function terminalAttempt(overrides: Partial<ExamAttempt> = {}) {
      return makeAttempt({
        id: "attempt-1",
        status: "graded",
        attemptNo: 1,
        gradingStatus: "auto_graded",
        gradedAt: new Date("2025-01-01T10:20:00Z"),
        gradingResult: [
          {
            questionId: "q1",
            score: 80,
            maxScore: 100,
            correct: true,
            candidateAnswer: "a",
            standardAnswer: "a",
          },
        ],
        ...overrides,
      });
    }

    it("defers retake while result hidden — passed candidate gets RetakeDeferredError, no new attempt", async () => {
      const exam = hiddenPassThenStopExam();
      const enrollment = makeEnrollment({
        status: "started",
        attemptCount: 1,
        finalScore: 80,
        finalPassed: true,
        finalAttemptId: "attempt-1",
      });
      const enrRepo = makeEnrollmentRepo([enrollment]);
      const attRepo = makeAttemptRepo([
        terminalAttempt({ score: 80, passed: true }),
      ]);
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };

      await expect(
        startOrRestoreAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "exam-1",
          "cand-1",
          fixedNow,
          startDeps,
        ),
      ).rejects.toThrow(RetakeDeferredError);
      // The deferral happens before any attempt creation.
      expect(await attRepo.findByEnrollmentAndAttemptNo("enr-1", 2)).toBeNull();
    });

    it("defers retake while result hidden — failed candidate gets the SAME RetakeDeferredError, no new attempt", async () => {
      const exam = hiddenPassThenStopExam();
      const enrollment = makeEnrollment({
        status: "started",
        attemptCount: 1,
        finalScore: 20,
        finalPassed: false,
        finalAttemptId: "attempt-1",
      });
      const enrRepo = makeEnrollmentRepo([enrollment]);
      const attRepo = makeAttemptRepo([
        terminalAttempt({
          score: 20,
          passed: false,
          gradingResult: [
            {
              questionId: "q1",
              score: 20,
              maxScore: 100,
              correct: false,
              candidateAnswer: "b",
              standardAnswer: "a",
            },
          ],
        }),
      ]);
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };

      await expect(
        startOrRestoreAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "exam-1",
          "cand-1",
          fixedNow,
          startDeps,
        ),
      ).rejects.toThrow(RetakeDeferredError);
      expect(await attRepo.findByEnrollmentAndAttemptNo("enr-1", 2)).toBeNull();
    });

    it("published result — passed candidate blocked by durable ExamAlreadyPassedError", async () => {
      const exam = makeExam({
        retakePolicy: "pass_then_stop",
        resultPublicationMode: "manual",
        resultsPublishedAt: new Date("2025-01-01T10:25:00Z"),
      });
      const enrollment = makeEnrollment({
        status: "completed",
        attemptCount: 1,
        finalScore: 80,
        finalPassed: true,
        finalAttemptId: "attempt-1",
      });
      const enrRepo = makeEnrollmentRepo([enrollment]);
      const attRepo = makeAttemptRepo([
        terminalAttempt({ score: 80, passed: true }),
      ]);
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };

      await expect(
        startOrRestoreAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "exam-1",
          "cand-1",
          fixedNow,
          startDeps,
        ),
      ).rejects.toThrow(ExamAlreadyPassedError);
      expect(await attRepo.findByEnrollmentAndAttemptNo("enr-1", 2)).toBeNull();
    });

    it("published result — failed candidate may retake (new attempt created)", async () => {
      const exam = makeExam({
        retakePolicy: "pass_then_stop",
        resultPublicationMode: "manual",
        resultsPublishedAt: new Date("2025-01-01T10:25:00Z"),
      });
      const enrollment = makeEnrollment({
        status: "started",
        attemptCount: 1,
        finalScore: 20,
        finalPassed: false,
        finalAttemptId: "attempt-1",
      });
      const enrRepo = makeEnrollmentRepo([enrollment]);
      const attRepo = makeAttemptRepo([
        terminalAttempt({
          score: 20,
          passed: false,
          gradingResult: [
            {
              questionId: "q1",
              score: 20,
              maxScore: 100,
              correct: false,
              candidateAnswer: "b",
              standardAnswer: "a",
            },
          ],
        }),
      ]);
      const examRepo = {
        findById: () => exam,
        findByIdForUpdate: () => exam,
        update: () => exam,
      };

      const { attempt, isNew } = await startOrRestoreAttempt(
        examRepo,
        enrRepo,
        attRepo,
        "exam-1",
        "cand-1",
        fixedNow,
        startDeps,
      );
      expect(isNew).toBe(true);
      expect(attempt.attemptNo).toBe(2);
    });

    it("P1-3 deterministic race: grading commits after start arrival but before the lock — passed AND failed candidates get the same deferred rejection, no attempt created", async () => {
      // Deterministic interleaving (issue #324 review P1-3):
      //   T1 start request arrives while attempt #1 is still grading
      //     (enrollment.finalAttemptId = null).
      //   T2 grading finalizer commits terminalization under the enrollment
      //     lock (finalScore/finalPassed/finalAttemptId).
      //   T1 then acquires the enrollment lock and must observe the committed
      //     state — the deferral decision shares the finalizer's serialization
      //     boundary, so passed and failed candidates get the SAME opaque
      //     rejection instead of a 409-vs-201 pass/fail oracle.
      for (const outcome of ["pass", "fail"] as const) {
        const exam = hiddenPassThenStopExam();
        const now = new Date("2025-01-01T10:30:00Z");
        const sharedEnrollments: ExamEnrollment[] = [
          makeEnrollment({ status: "started", attemptCount: 1 }),
        ];
        const sharedAttempts: ExamAttempt[] = [
          makeAttempt({
            status: "submitted",
            attemptNo: 1,
            submittedAt: now,
            gradingStatus: "auto_graded",
          }),
        ];

        const t1ReachedLock = deferred<void>();
        const gradingDone = deferred<void>();

        const enrRepo: EnrollmentRepository = {
          findByExamAndCandidate: (examId, candidateId) =>
            sharedEnrollments.find(
              (e) => e.examId === examId && e.candidateId === candidateId,
            ) ?? null,
          findByExamAndCandidateForUpdate: async (examId, candidateId) => {
            // T1 has reached the enrollment lock; release T2 (grading) and
            // WAIT for it to commit before returning the row — exactly what a
            // real lock wait observes. The start decision therefore runs on
            // post-terminalization state.
            t1ReachedLock.resolve();
            await gradingDone.promise;
            return (
              sharedEnrollments.find(
                (e) => e.examId === examId && e.candidateId === candidateId,
              ) ?? null
            );
          },
          create: (input) => {
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
            sharedEnrollments.push(enr);
            return enr;
          },
          update: (id, data) => {
            const idx = sharedEnrollments.findIndex((e) => e.id === id);
            if (idx === -1) return null;
            sharedEnrollments[idx] = { ...sharedEnrollments[idx]!, ...data };
            return sharedEnrollments[idx]!;
          },
        };

        const attRepo: AttemptRepository = {
          findById: (id) => sharedAttempts.find((a) => a.id === id) ?? null,
          findByIdForUpdate: (id) =>
            sharedAttempts.find((a) => a.id === id) ?? null,
          findActiveByEnrollment: (enrollmentId) =>
            sharedAttempts.find(
              (a) =>
                a.enrollmentId === enrollmentId &&
                (a.status === "in_progress" || a.status === "disrupted"),
            ) ?? null,
          findByEnrollmentAndAttemptNo: (enrollmentId, attemptNo) =>
            sharedAttempts.find(
              (a) =>
                a.enrollmentId === enrollmentId && a.attemptNo === attemptNo,
            ) ?? null,
          create: (input) => {
            const created = {
              ...input,
              id: input.id ?? "attempt-new",
              createdAt: new Date(),
              updatedAt: new Date(),
            } as ExamAttempt;
            sharedAttempts.push(created);
            return created;
          },
          update: (id, data) => {
            const idx = sharedAttempts.findIndex((a) => a.id === id);
            if (idx === -1) return null;
            sharedAttempts[idx] = { ...sharedAttempts[idx]!, ...data };
            return sharedAttempts[idx]!;
          },
          refreshLastActivityIfInProgress: (id, tick) => {
            const idx = sharedAttempts.findIndex((a) => a.id === id);
            if (idx === -1) return null;
            if (sharedAttempts[idx]!.status !== "in_progress") return null;
            sharedAttempts[idx] = {
              ...sharedAttempts[idx]!,
              lastActivityAt: tick,
            };
            return sharedAttempts[idx]!;
          },
        };

        const examRepo = {
          findById: () => exam,
          findByIdForUpdate: () => exam,
          update: () => exam,
        };

        // T2 — grading finalizer. Waits for T1 to reach the enrollment lock,
        // then commits the attempt terminal projection + enrollment final
        // facts in one unit (mirroring finalizeTerminalGrading under the lock).
        const t2 = (async () => {
          await t1ReachedLock.promise;
          const passed = outcome === "pass";
          const score = passed ? 80 : 20;
          const attIdx = sharedAttempts.findIndex((a) => a.id === "attempt-1");
          sharedAttempts[attIdx] = {
            ...sharedAttempts[attIdx]!,
            status: "graded",
            score,
            passed,
            gradedAt: now,
            gradingStatus: "auto_graded",
            gradingResult: [
              {
                questionId: "q1",
                score,
                maxScore: 100,
                correct: passed,
                candidateAnswer: passed ? "a" : "b",
                standardAnswer: "a",
              },
            ],
          };
          const enrIdx = sharedEnrollments.findIndex((e) => e.id === "enr-1");
          sharedEnrollments[enrIdx] = {
            ...sharedEnrollments[enrIdx]!,
            finalScore: score,
            finalPassed: passed,
            finalAttemptId: "attempt-1",
          };
          gradingDone.resolve();
        })();

        // T1 — the start request.
        const t1 = startOrRestoreAttempt(
          examRepo,
          enrRepo,
          attRepo,
          "exam-1",
          "cand-1",
          now,
          startDeps,
        );

        // Both outcomes land on the SAME semantic error, and neither created
        // attempt #2 — the hidden-result deferral is identical for passed and
        // failed candidates.
        await expect(t1).rejects.toThrow(RetakeDeferredError);
        await t2;
        expect(sharedAttempts).toHaveLength(1);
      }
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
        { resolution: noneResolution },
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
        { resolution: noneResolution },
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
        { resolution: noneResolution },
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
            resolution: noneResolution,
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
        {
          source: "candidate",
          minSubmitAfterStartMinutes: 30,
          resolution: noneResolution,
        },
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
        {
          source: "deadline_scanner",
          minSubmitAfterStartMinutes: 30,
          resolution: noneResolution,
        },
      );

      expect(result.status).toBe("submitted");
    });

    it("throws ValidationError for non-existent attempt", async () => {
      const attRepo = makeAttemptRepo();
      const wsRepo = makeWorksetRepo();

      await expect(
        submitAttempt(attRepo, wsRepo, "nonexistent", fixedNow, {
          resolution: noneResolution,
        }),
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
        { resolution: noneResolution },
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
        submitAttempt(attRepo, wsRepo, "attempt-1", fixedNow, {
          resolution: noneResolution,
        }),
      ).rejects.toThrow(ValidationError);
    });

    // --- P0-1: row-lock TOCTOU defense (findByIdForUpdate) ---

    // Case A: submitAttempt must read via the row-locking path, not a bare
    // findById. Proves the read that feeds the idempotency/state checks is the
    // FOR UPDATE read, matching restoreAttempt.
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

      await submitAttempt(attRepo, wsRepo, "attempt-1", fixedNow, {
        resolution: noneResolution,
      });

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
        { source: "candidate", resolution: noneResolution },
      );
      const second = await submitAttempt(
        attRepo,
        wsRepo,
        "attempt-1",
        scannerNow,
        { source: "deadline_scanner", resolution: noneResolution },
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
        { source: "candidate", resolution: noneResolution },
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
        { resolution: noneResolution },
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
        { resolution: noneResolution },
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
        { submissionReason: "deadline", resolution: noneResolution },
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
        { resolution: noneResolution },
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
        interruptionTimingPolicySnapshot: {
          schemaVersion: 1,
          policy: "strict",
          perIncidentCapSeconds: null,
          perAttemptAggregateCapSeconds: null,
        },
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
});
