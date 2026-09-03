import { describe, expect, it } from "vitest";
import type {
  Exam,
  ExamAttempt,
  ExamEnrollment,
  QuestionSnapshot,
} from "@exam/domain";
import { GradingStatus } from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import { gradeAttemptIdempotent } from "./grading.js";
import { lockEnrollmentAndAttempt } from "./lockSeam.js";

/**
 * P3-L0-2E Slice 5 Step 11 — partial-score branch containment.
 *
 * Slice 4 retains `computeGradingResult` for exactly ONE production use: the
 * response-only `pending_manual` partial-score branch inside
 * `gradeAttemptIdempotent`. This is the highest-priority retained surface, so
 * Slice 5 must prove it cannot mutate terminal score truth.
 *
 * Source audit (grading.ts gradeAttemptIdempotent):
 *   A. Caller:                gradeAttemptIdempotent
 *   B. Reachable state:       gradingStatus === PendingManual (status=submitted)
 *   C. Persists score:        NO  (early return before finalizeGrading)
 *   D. Persists gradingResult: NO  (same early return)
 *   E. Persists passed:       NO
 *   F. Reaches finalizeGrading: NO
 *   G. Reaches aggregateGradingEntries: NO
 *   H. Terminal attempt reachable: NO (graded returns earlier at line 380)
 *   I. Response-only:         YES
 *   J. Frozen-truth input:    YES (submittedAnswers + frozen snapshot)
 *
 * The behavioral test below captures persisted score/gradingResult/passed,
 * exercises the production partial-score response path, independently re-reads
 * the attempt, and proves those persisted fields are unchanged. It also spies
 * on attemptRepo.update to prove NO terminal write occurs.
 */

const NOW = new Date("2026-06-01T12:00:00Z");

/**
 * P3-FORMAL-P0-D2 test helper: mints a genuine capability via the canonical seam.
 */
async function mintCap(
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
) {
  return lockEnrollmentAndAttempt(enrollmentRepo, attemptRepo, attemptId);
}

function mixedQuestions(): QuestionSnapshot[] {
  return [
    {
      originalQuestionId: "q-obj",
      type: "single_choice",
      content: "Objective",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [],
      standardAnswer: "a",
      score: 50,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
      rubric: null,
    },
    {
      originalQuestionId: "q-text",
      type: "text_response",
      content: "Essay",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [],
      standardAnswer: null,
      score: 50,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 1,
      rubric: null,
    },
  ];
}

function makeExam(): Exam {
  return {
    id: "exam-1",
    organizationId: "org-1",
    courseId: "course-1",
    title: "Mixed Exam",
    description: "",
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: new Date("2026-01-01T00:00:00Z"),
    closeAt: new Date("2026-12-31T00:00:00Z"),
    passingScore: 50,
    totalScore: 100,
    questionSelectionMode: "manual",
    questionIds: ["q-obj", "q-text"],
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
    syncStartedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makePendingManualAttempt(): ExamAttempt {
  return {
    id: "attempt-1",
    organizationId: "org-1",
    examId: "exam-1",
    enrollmentId: "enrollment-1",
    candidateId: "candidate-1",
    attemptNo: 1,
    status: "submitted",
    questionSnapshot: mixedQuestions(),
    answers: [
      { questionId: "q-obj", answer: "a", version: 1, savedAt: NOW },
      { questionId: "q-text", answer: "essay draft", version: 1, savedAt: NOW },
    ],
    gradingStatus: GradingStatus.PendingManual,
    submittedAnswers: {
      schemaVersion: 1,
      answers: [
        { questionId: "q-obj", value: "a" },
        { questionId: "q-text", value: "essay draft" },
      ],
    },
    // Terminal truth fields are NOT yet set — the attempt is held at submitted
    // pending manual grading. They must remain unset after the partial-score
    // response path runs. ExamAttempt.score/passed/gradedAt are optional
    // (number?/boolean?/Date?), so "unset" is `undefined`.
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeEnrollment(): ExamEnrollment {
  return {
    id: "enrollment-1",
    organizationId: "org-1",
    examId: "exam-1",
    candidateId: "candidate-1",
    status: "started",
    attemptCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("Slice 5 Step 11 — partial-score branch cannot mutate terminal score truth", () => {
  it("gradeAttemptIdempotent returns a partial response WITHOUT persisting score/gradingResult/passed", async () => {
    const exam = makeExam();
    const initialAttempt = makePendingManualAttempt();
    const enrollment = makeEnrollment();

    let storedAttempt = initialAttempt;
    let updateCalls = 0;
    const examRepo: ExamRepository = {
      findById: () => exam,
      findByIdForUpdate: () => exam,
      update: () => exam,
    };
    const attemptRepo: AttemptRepository = {
      findById: () => storedAttempt,
      findByIdForUpdate: () => storedAttempt,
      findActiveByEnrollment: () => null,
      findByEnrollmentAndAttemptNo: () => null,
      create: () => storedAttempt,
      update: (_id, data) => {
        updateCalls++;
        storedAttempt = { ...storedAttempt, ...data };
        return storedAttempt;
      },
      refreshLastActivityIfInProgress: (_id, now) => {
        if (storedAttempt.status !== "in_progress") return null;
        storedAttempt = { ...storedAttempt, lastActivityAt: now };
        return storedAttempt;
      },
    };
    const enrollmentRepo: EnrollmentRepository = {
      findByExamAndCandidate: () => enrollment,
      findByExamAndCandidateForUpdate: () => enrollment,
      create: () => enrollment,
      update: (_id, data) => {
        return { ...enrollment, ...data };
      },
    };
    const worksetRepo: GradingWorksetRepository = {
      findByAttempt: async () => [],
      findByAttemptAndQuestion: async () => null,
      bulkCreate: async () => {},
      completeManualEntry: async () => null,
      countPendingManualForAttempt: async () => 0,
    };

    const cap = await mintCap(enrollmentRepo, attemptRepo, "attempt-1");
    const result = await gradeAttemptIdempotent(
      examRepo,
      enrollmentRepo,
      attemptRepo,
      worksetRepo,
      cap,
      NOW,
    );

    // The partial-score branch returns a ScoreResult (the objective partial).
    // For the fixture, q-obj answer "a" matches standardAnswer "a" → 50/50.
    expect(result.totalScore).toBe(50);
    expect(result.passed).toBe(true);
    expect(result.questionResults).toHaveLength(2);

    // CRITICAL containment proof: the partial response did NOT persist.
    expect(updateCalls).toBe(0);
    const after = await attemptRepo.findById("attempt-1");
    expect(after?.score).toBeUndefined();
    expect(after?.gradingResult).toBeUndefined();
    expect(after?.passed).toBeUndefined();
    expect(after?.gradedAt).toBeUndefined();
    expect(after?.status).toBe("submitted");
    expect(after?.gradingStatus).toBe(GradingStatus.PendingManual);
  });

  it("a graded (terminal) attempt never reaches the partial-score branch", async () => {
    // H: terminal attempts short-circuit at the `status === graded` guard
    // (grading.ts line 380) BEFORE the pending_manual branch. A graded attempt
    // with a stale gradingStatus=pending_manual must still return its existing
    // terminal result, never recompute a partial.
    const exam = makeExam();
    const gradedAttempt: ExamAttempt = {
      ...makePendingManualAttempt(),
      status: "graded",
      score: 70,
      passed: true,
      gradedAt: NOW,
      gradingResult: [
        {
          questionId: "q-obj",
          score: 50,
          maxScore: 50,
          correct: true,
          candidateAnswer: "a",
          standardAnswer: "a",
        },
        {
          questionId: "q-text",
          score: 20,
          maxScore: 50,
          correct: false,
          candidateAnswer: "essay",
          standardAnswer: null,
        },
      ],
      // Stale/inconsistent gradingStatus — defensive: the graded guard wins.
      gradingStatus: GradingStatus.PendingManual,
    };
    let storedAttempt = gradedAttempt;
    let updateCalls = 0;
    const examRepo: ExamRepository = {
      findById: () => exam,
      findByIdForUpdate: () => exam,
      update: () => exam,
    };
    const attemptRepo: AttemptRepository = {
      findById: () => storedAttempt,
      findByIdForUpdate: () => storedAttempt,
      findActiveByEnrollment: () => null,
      findByEnrollmentAndAttemptNo: () => null,
      create: () => storedAttempt,
      update: (_id, data) => {
        updateCalls++;
        storedAttempt = { ...storedAttempt, ...data };
        return storedAttempt;
      },
      refreshLastActivityIfInProgress: (_id, now) => {
        if (storedAttempt.status !== "in_progress") return null;
        storedAttempt = { ...storedAttempt, lastActivityAt: now };
        return storedAttempt;
      },
    };
    const enrollmentRepo: EnrollmentRepository = {
      findByExamAndCandidate: () => makeEnrollment(),
      findByExamAndCandidateForUpdate: () => makeEnrollment(),
      create: () => makeEnrollment(),
      update: (_id, data) => ({ ...makeEnrollment(), ...data }),
    };
    const worksetRepo: GradingWorksetRepository = {
      findByAttempt: async () => [],
      findByAttemptAndQuestion: async () => null,
      bulkCreate: async () => {},
      completeManualEntry: async () => null,
      countPendingManualForAttempt: async () => 0,
    };

    const cap = await mintCap(enrollmentRepo, attemptRepo, "attempt-1");
    const result = await gradeAttemptIdempotent(
      examRepo,
      enrollmentRepo,
      attemptRepo,
      worksetRepo,
      cap,
      NOW,
    );

    // Returns the EXISTING terminal result (70), not a recomputed partial.
    expect(result.totalScore).toBe(70);
    expect(result.passed).toBe(true);
    expect(result.questionResults).toHaveLength(2);
    // No re-grade, no write.
    expect(updateCalls).toBe(0);
    expect(storedAttempt.score).toBe(70);
    expect(storedAttempt.gradingResult).toHaveLength(2);
  });
});
