import type {
  AttemptGradingEntry,
  Exam,
  ExamAttempt,
  ExamEnrollment,
  QuestionSnapshot,
} from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import { lockEnrollmentAndAttempt } from "./lockSeam.js";
import {
  prepareReconciledAttemptMutation,
  type PreparedAttemptMutation,
} from "./deadlineReconciliation.js";
import type { SubmitInterruptionResolution } from "./restoreInterruption.js";
import type {
  InterruptionEpisodeRepository,
  InterruptionEventRepository,
} from "./interruptionRepositories.js";

// EXAM-ANSWER-PRECONDITION-CORRECTIVE-0 — shared in-memory test harness for the
// canonical Save Answer action and its preparation seam. Used by both the
// closure regression tests (saveAnswer.test.ts) and the precondition topology
// tests (answerPreconditions.test.ts) to avoid fixture duplication.
//
// NOTE: fixtures use FIXED timestamps only — no empty-arg wall-clock Date
// constructor. The ADR-006 time-authority structural test scans exam-engine src
// for raw wall-clock reads and does not exclude testHelpers files (nor does it
// strip comments), so any such constructor call here would fail it. Business-
// time authority in these tests flows through the explicit `now: Date` argument
// to `prepare(...)`.

/** Fixed audit-column timestamp for fixtures (not a business-time authority). */
const FIXED_STAMP = new Date("2025-01-01T09:00:00Z");

export function makeSnapshot(): QuestionSnapshot[] {
  return [
    {
      originalQuestionId: "q1",
      type: "single_choice",
      content: "Q1",
      attachments: [],
      options: [{ id: "a", content: "A" }],
      standardAnswer: "a",
      score: 100,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
      rubric: null,
    },
  ];
}

/**
 * A manual-grading (text_response) question snapshot. Used by tests that need
 * the deadline reconciliation seam to freeze cleanly to `pending_manual` (no
 * grading aggregation) when `now >= effectiveDeadline`, so the post-freeze
 * `saveAnswer` behavior can be observed without a grading workset.
 */
export function makeManualSnapshot(): QuestionSnapshot[] {
  return [
    {
      originalQuestionId: "q1",
      type: "text_response",
      content: "Q1",
      attachments: [],
      options: [],
      standardAnswer: null,
      score: 100,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
      rubric: "Answer the question.",
    },
  ];
}

export function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: "exam-1",
    organizationId: "org-1",
    title: "Exam",
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
    questionSnapshot: [],
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
    createdAt: FIXED_STAMP,
    updatedAt: FIXED_STAMP,
    ...overrides,
  };
}

export function makeAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
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
    createdAt: FIXED_STAMP,
    updatedAt: FIXED_STAMP,
    ...overrides,
  };
}

export function makeEnrollment(
  overrides: Partial<ExamEnrollment> = {},
): ExamEnrollment {
  return {
    id: "enr-1",
    organizationId: "org-1",
    examId: "exam-1",
    candidateId: "cand-1",
    status: "started",
    attemptCount: 1,
    createdAt: FIXED_STAMP,
    updatedAt: FIXED_STAMP,
    ...overrides,
  };
}

/** In-memory AttemptRepository fake recording update payloads. */
export function makeAttemptRepo(attempts: ExamAttempt[]): AttemptRepository & {
  updateCalls: Partial<ExamAttempt>[];
  get(id: string): ExamAttempt;
  /** Count of updates that wrote the draft `answers` field (the save write). */
  draftAnswerWriteCount(): number;
} {
  const store = [...attempts];
  const updateCalls: Partial<ExamAttempt>[] = [];
  return {
    findById(id) {
      return store.find((a) => a.id === id) ?? null;
    },
    findByIdForUpdate(id) {
      return store.find((a) => a.id === id) ?? null;
    },
    findActiveByEnrollment() {
      return null;
    },
    findByEnrollmentAndAttemptNo() {
      return null;
    },
    create() {
      throw new Error("not used");
    },
    update(id, data) {
      updateCalls.push(data);
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
    updateCalls,
    get(id: string): ExamAttempt {
      const found = store.find((a) => a.id === id);
      if (!found) throw new Error(`attempt ${id} not found in fake store`);
      return found;
    },
    draftAnswerWriteCount(): number {
      // The draft `answers` write is the Save Answer protocol write. Lifecycle
      // writes (status, submittedAnswers, lastActivityAt-only) are excluded —
      // `lastActivityAt` alone is the heartbeat, not a draft mutation.
      return updateCalls.filter((p) =>
        Object.prototype.hasOwnProperty.call(p, "answers"),
      ).length;
    },
  };
}

export function makeEnrollmentRepo(
  enrollments: ExamEnrollment[],
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
    create() {
      throw new Error("not used");
    },
    update(id, data) {
      const idx = store.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      store[idx] = { ...store[idx]!, ...data };
      return store[idx]!;
    },
  };
}

export function makeExamRepo(exams: Exam[]): ExamRepository {
  const store = [...exams];
  return {
    findById(examId) {
      return store.find((e) => e.id === examId) ?? null;
    },
    findByIdForUpdate(examId) {
      return store.find((e) => e.id === examId) ?? null;
    },
    update() {
      throw new Error("not used");
    },
  };
}

export function makeGradingWorksetRepo(): GradingWorksetRepository {
  return {
    findByAttempt: async () => [] as AttemptGradingEntry[],
    findByAttemptAndQuestion: async () => null,
    bulkCreate: async () => {},
    completeManualEntry: async () => null,
    countPendingManualForAttempt: async () => 0,
  };
}

function makeStubEpisodeRepo(): InterruptionEpisodeRepository {
  return {
    create: async () => ({ id: "stub" }) as never,
    findById: async () => null,
    findByAttemptForUpdate: async () => null,
    findLatestByAttempt: async () => null,
  };
}

function makeStubEventRepo(): InterruptionEventRepository {
  return {
    insert: async (input) => ({ id: "stub-event", ...input }) as never,
    findDetected: async () => null,
    findOutcome: async () => null,
    findLatestOutcomeByAttempt: async () => null,
  };
}

export function makeNoneResolution(): SubmitInterruptionResolution {
  return {
    mode: "none",
    episodeRepo: makeStubEpisodeRepo(),
    eventRepo: makeStubEventRepo(),
  };
}

export interface PreparedHarness extends PreparedAttemptMutation {
  attemptRepo: ReturnType<typeof makeAttemptRepo>;
  enrollmentRepo: EnrollmentRepository;
  examRepo: ExamRepository;
  gradingWorksetRepo: GradingWorksetRepository;
}

/**
 * Full preparation harness: builds in-memory repos, mints the EA capability via
 * the canonical seam, runs the preparation seam, and returns the mutation
 * context plus the post-reconciliation attempt and the repo objects.
 */
export async function prepare(
  exam: Exam,
  attempt: ExamAttempt,
  enrollment: ExamEnrollment,
  now: Date,
): Promise<PreparedHarness> {
  const attemptRepo = makeAttemptRepo([attempt]);
  const enrollmentRepo = makeEnrollmentRepo([enrollment]);
  const examRepo = makeExamRepo([exam]);
  const gradingWorksetRepo = makeGradingWorksetRepo();
  const cap = await lockEnrollmentAndAttempt(
    enrollmentRepo,
    attemptRepo,
    attempt.id,
  );
  const { attempt: currentAttempt, mutationContext } =
    await prepareReconciledAttemptMutation(
      examRepo,
      enrollmentRepo,
      attemptRepo,
      gradingWorksetRepo,
      cap,
      now,
      makeNoneResolution(),
    );
  return {
    attemptRepo,
    enrollmentRepo,
    examRepo,
    gradingWorksetRepo,
    attempt: currentAttempt,
    mutationContext,
  };
}
