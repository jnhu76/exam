import { describe, expect, it } from "vitest";
import type { Exam, ExamAttempt, ExamEnrollment } from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import {
  ensureAttemptDeadlineReconciled,
  computeEffectiveDeadline,
} from "./deadlineReconciliation.js";

function makeExam(overrides: Partial<Exam> = {}): Exam {
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
    questionSnapshot: [
      {
        originalQuestionId: "q1",
        type: "single_choice",
        content: "Q1",
        attachments: [],
        options: [],
        standardAnswer: "a",
        score: 100,
        gradingRule: {
          multiSelectScoring: "all_correct_full",
          fillBlankMatchMode: "exact",
        },
        order: 0,
        rubric: null,
      },
    ],
    answers: [
      { questionId: "q1", answer: "a", version: 1, savedAt: new Date() },
    ],
    startedAt: new Date("2025-01-01T10:00:00Z"),
    deadlineAt: new Date("2025-01-01T11:00:00Z"),
    lastActivityAt: new Date("2025-01-01T10:00:00Z"),
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
    status: "started",
    attemptCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRepos(
  attempts: ExamAttempt[],
  exams: Exam[] = [makeExam()],
  enrollments: ExamEnrollment[] = [makeEnrollment()],
) {
  const attemptStore = [...attempts];
  const examStore = [...exams];
  const enrStore = [...enrollments];
  const attemptRepo: AttemptRepository = {
    findById: async (id) => attemptStore.find((a) => a.id === id) ?? null,
    findByIdForUpdate: async (id) =>
      attemptStore.find((a) => a.id === id) ?? null,
    findActiveByEnrollment: async (enrollmentId) =>
      attemptStore.find(
        (a) =>
          a.enrollmentId === enrollmentId &&
          (a.status === "in_progress" || a.status === "disrupted"),
      ) ?? null,
    findByEnrollmentAndAttemptNo: async (enrollmentId, attemptNo) =>
      attemptStore.find(
        (a) => a.enrollmentId === enrollmentId && a.attemptNo === attemptNo,
      ) ?? null,
    create: async (input) => {
      const a = {
        ...input,
        id: "new",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ExamAttempt;
      attemptStore.push(a);
      return a;
    },
    update: async (id, data) => {
      const idx = attemptStore.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      attemptStore[idx] = { ...attemptStore[idx]!, ...data };
      return attemptStore[idx]!;
    },
  };
  const examRepo: ExamRepository = {
    findById: (id) => examStore.find((e) => e.id === id) ?? null,
    update: (id, data) => {
      const idx = examStore.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      examStore[idx] = { ...examStore[idx]!, ...data };
      return examStore[idx]!;
    },
  };
  const enrollmentRepo: EnrollmentRepository = {
    findByExamAndCandidate: (examId, candidateId) =>
      enrStore.find(
        (e) => e.examId === examId && e.candidateId === candidateId,
      ) ?? null,
    findByExamAndCandidateForUpdate: (examId, candidateId) =>
      enrStore.find(
        (e) => e.examId === examId && e.candidateId === candidateId,
      ) ?? null,
    create: async (input) => {
      const e = {
        ...input,
        id: "new",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ExamEnrollment;
      enrStore.push(e);
      return e;
    },
    update: (id, data) => {
      const idx = enrStore.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      enrStore[idx] = { ...enrStore[idx]!, ...data };
      return enrStore[idx]!;
    },
  };
  const gradingWorksetRepo: GradingWorksetRepository = {
    findByAttempt: async () => [],
    findByAttemptAndQuestion: async () => null,
    bulkCreate: async () => {},
    completeManualEntry: async () => null,
    countPendingManualForAttempt: async () => 0,
  };
  return { attemptRepo, examRepo, enrollmentRepo, gradingWorksetRepo };
}

describe("ensureAttemptDeadlineReconciled (P3-L0-3)", () => {
  it("freezes an expired in_progress attempt to submitted with submitted_answers", async () => {
    const now = new Date("2025-01-01T11:30:00Z"); // after deadline 11:00
    const attempt = makeAttempt({ status: "in_progress" });
    const { attemptRepo, examRepo, enrollmentRepo, gradingWorksetRepo } =
      makeRepos([attempt]);

    const result = await ensureAttemptDeadlineReconciled(
      examRepo,
      enrollmentRepo,
      attemptRepo,
      gradingWorksetRepo,
      "attempt-1",
      now,
    );

    expect(result.status).toBe("graded");
    expect(result.submittedAt).toEqual(new Date("2025-01-01T11:00:00Z"));
    expect(result.submissionReason).toBe("deadline");
    expect(result.submittedAnswers).toEqual({
      schemaVersion: 1,
      answers: [{ questionId: "q1", value: "a" }],
    });
  });

  it("submittedAt = effectiveDeadline (not the reconciliation wall-clock time)", async () => {
    const now = new Date("2025-01-01T11:45:00Z");
    const attempt = makeAttempt({
      status: "in_progress",
      deadlineAt: new Date("2025-01-01T10:30:00Z"), // earlier than exam closeAt
    });
    const { attemptRepo, examRepo, enrollmentRepo, gradingWorksetRepo } =
      makeRepos([attempt]);

    const result = await ensureAttemptDeadlineReconciled(
      examRepo,
      enrollmentRepo,
      attemptRepo,
      gradingWorksetRepo,
      "attempt-1",
      now,
    );

    // effectiveDeadline = min(exam.closeAt 12:00, attempt.deadlineAt 10:30) = 10:30
    expect(result.submittedAt).toEqual(new Date("2025-01-01T10:30:00Z"));
  });

  it("returns the attempt unchanged when not expired", async () => {
    const now = new Date("2025-01-01T10:30:00Z"); // before deadline 11:00
    const attempt = makeAttempt({ status: "in_progress" });
    const { attemptRepo, examRepo, enrollmentRepo, gradingWorksetRepo } =
      makeRepos([attempt]);

    const result = await ensureAttemptDeadlineReconciled(
      examRepo,
      enrollmentRepo,
      attemptRepo,
      gradingWorksetRepo,
      "attempt-1",
      now,
    );

    expect(result.status).toBe("in_progress");
    expect(result.submittedAnswers).toBeUndefined();
  });

  it("returns a submitted attempt unchanged (idempotent — does not rebuild)", async () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const frozen = {
      schemaVersion: 1 as const,
      answers: [{ questionId: "q1", value: "frozen" }],
    };
    const attempt = makeAttempt({
      status: "submitted",
      submittedAnswers: frozen,
      submissionReason: "manual",
      submittedAt: new Date("2025-01-01T10:50:00Z"),
    });
    const { attemptRepo, examRepo, enrollmentRepo, gradingWorksetRepo } =
      makeRepos([attempt]);

    const result = await ensureAttemptDeadlineReconciled(
      examRepo,
      enrollmentRepo,
      attemptRepo,
      gradingWorksetRepo,
      "attempt-1",
      now,
    );

    // Idempotent: existing frozen snapshot + submittedAt preserved.
    expect(result.submittedAnswers).toEqual(frozen);
    expect(result.submittedAt).toEqual(new Date("2025-01-01T10:50:00Z"));
    expect(result.submissionReason).toBe("manual");
  });

  it("returns not_started/queued/voided unchanged (no freeze)", async () => {
    const now = new Date("2025-01-01T11:30:00Z");
    for (const status of ["not_started", "queued", "voided"] as const) {
      const attempt = makeAttempt({ status });
      const { attemptRepo, examRepo, enrollmentRepo, gradingWorksetRepo } =
        makeRepos([attempt]);
      const result = await ensureAttemptDeadlineReconciled(
        examRepo,
        enrollmentRepo,
        attemptRepo,
        gradingWorksetRepo,
        "attempt-1",
        now,
      );
      expect(result.status).toBe(status);
      expect(result.submittedAnswers).toBeUndefined();
    }
  });

  it("reconciles a disrupted attempt (disrupted is auto-submittable)", async () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const attempt = makeAttempt({ status: "disrupted" });
    const { attemptRepo, examRepo, enrollmentRepo, gradingWorksetRepo } =
      makeRepos([attempt]);

    const result = await ensureAttemptDeadlineReconciled(
      examRepo,
      enrollmentRepo,
      attemptRepo,
      gradingWorksetRepo,
      "attempt-1",
      now,
    );

    expect(result.status).toBe("graded");
    expect(result.submissionReason).toBe("deadline");
  });
});

// ── P3-L0-2C: manual-grading hold on the deadline path ────────────
// Protocol §3.3: an expired text_response / mixed attempt must hold at
//   submitted + pending_manual (submissionReason='deadline'), NOT auto-
//   finalize to graded. Only completeManualGrading may advance it.

describe("ensureAttemptDeadlineReconciled (P3-L0-2C manual hold)", () => {
  it("holds an expired pure text_response attempt at submitted + pending_manual", async () => {
    const now = new Date("2025-01-01T11:30:00Z"); // after deadline 11:00
    const textAttempt = makeAttempt({
      status: "in_progress",
      questionSnapshot: [
        {
          originalQuestionId: "q-text",
          type: "text_response",
          content: "Subjective question",
          attachments: [],
          options: [],
          standardAnswer: null,
          score: 100,
          gradingRule: {
            multiSelectScoring: "all_correct_full",
            fillBlankMatchMode: "exact",
          },
          order: 0,
          rubric: "按逻辑给分",
        },
      ],
      answers: [
        {
          questionId: "q-text",
          answer: "主观答案",
          version: 1,
          savedAt: new Date("2025-01-01T10:30:00Z"),
        },
      ],
    });
    const { attemptRepo, examRepo, enrollmentRepo, gradingWorksetRepo } =
      makeRepos([textAttempt]);

    const result = await ensureAttemptDeadlineReconciled(
      examRepo,
      enrollmentRepo,
      attemptRepo,
      gradingWorksetRepo,
      "attempt-1",
      now,
    );

    expect(result.status).toBe("submitted");
    expect(result.gradingStatus).toBe("pending_manual");
    expect(result.submissionReason).toBe("deadline");
    expect(result.submittedAt).toEqual(new Date("2025-01-01T11:00:00Z"));
    // submitted_answers must still be frozen.
    expect(result.submittedAnswers).toEqual({
      schemaVersion: 1,
      answers: [{ questionId: "q-text", value: "主观答案" }],
    });
  });

  it("holds an expired mixed (objective + text_response) attempt at submitted + pending_manual", async () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const mixedAttempt = makeAttempt({
      status: "in_progress",
      questionSnapshot: [
        {
          originalQuestionId: "q-obj",
          type: "true_false",
          content: "Objective TF",
          attachments: [],
          options: [],
          standardAnswer: true,
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
          content: "Subjective",
          attachments: [],
          options: [],
          standardAnswer: null,
          score: 50,
          gradingRule: {
            multiSelectScoring: "all_correct_full",
            fillBlankMatchMode: "exact",
          },
          order: 1,
          rubric: "按逻辑给分",
        },
      ],
      answers: [
        {
          questionId: "q-obj",
          answer: true,
          version: 1,
          savedAt: new Date("2025-01-01T10:30:00Z"),
        },
        {
          questionId: "q-text",
          answer: "主观答案",
          version: 1,
          savedAt: new Date("2025-01-01T10:30:00Z"),
        },
      ],
    });
    const { attemptRepo, examRepo, enrollmentRepo, gradingWorksetRepo } =
      makeRepos([mixedAttempt]);

    const result = await ensureAttemptDeadlineReconciled(
      examRepo,
      enrollmentRepo,
      attemptRepo,
      gradingWorksetRepo,
      "attempt-1",
      now,
    );

    expect(result.status).toBe("submitted");
    expect(result.gradingStatus).toBe("pending_manual");
    expect(result.submissionReason).toBe("deadline");
  });

  it("still grades an expired pure-objective attempt inline (regression)", async () => {
    // The deadline path's existing synchronous auto-grade behavior for
    // pure-objective attempts must be preserved.
    const now = new Date("2025-01-01T11:30:00Z");
    const attempt = makeAttempt({ status: "in_progress" });
    const { attemptRepo, examRepo, enrollmentRepo, gradingWorksetRepo } =
      makeRepos([attempt]);

    const result = await ensureAttemptDeadlineReconciled(
      examRepo,
      enrollmentRepo,
      attemptRepo,
      gradingWorksetRepo,
      "attempt-1",
      now,
    );

    expect(result.status).toBe("graded");
    expect(result.gradingStatus).toBe("auto_graded");
    expect(result.submissionReason).toBe("deadline");
  });
});

describe("computeEffectiveDeadline", () => {
  it("throws ValidationError when exam.closeAt is null", () => {
    const exam = makeExam({ closeAt: null as unknown as Date });
    const attempt = makeAttempt();
    expect(() => computeEffectiveDeadline(exam, attempt)).toThrow(
      /closeAt is required/,
    );
  });

  it("throws ValidationError when exam.closeAt is undefined", () => {
    const exam = makeExam({ closeAt: undefined as unknown as Date });
    const attempt = makeAttempt();
    expect(() => computeEffectiveDeadline(exam, attempt)).toThrow(
      /closeAt is required/,
    );
  });
});
