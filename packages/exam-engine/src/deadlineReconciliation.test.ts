import { describe, expect, it } from "vitest";
import type {
  AttemptGradingEntry,
  Exam,
  ExamAttempt,
  ExamEnrollment,
} from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import { computeGradingResult } from "./grading.js";
import {
  ensureAttemptDeadlineReconciled,
  computeEffectiveDeadline,
  isAttemptDeadlineExpired,
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
  // Slice 4: finalizeGrading aggregates from the workset. The stub must:
  //  - store entries materialized by submitAttempt (bulkCreate) so mixed /
  //    text_response holds see pending_manual entries, and
  //  - for pure-objective attempts that reach finalizeGrading directly,
  //    synthesize completed_auto entries from the canonical auto-grader.
  const worksetStore = new Map<string, AttemptGradingEntry[]>();
  const gradingWorksetRepo: GradingWorksetRepository = {
    findByAttempt: async (id) => {
      const stored = worksetStore.get(id);
      if (stored) return stored.map((e) => ({ ...e }));
      const att = attemptStore.find((a) => a.id === id);
      if (!att) return [];
      // Only synthesize for already-submitted/graded attempts. For
      // in_progress/disrupted, return [] so submitAttempt's fresh-freeze
      // precondition (zero entries) passes.
      if (att.status === "in_progress" || att.status === "disrupted") return [];
      const ex = examStore.find((e) => e.id === att.examId);
      if (!ex) return [];
      const r = computeGradingResult(att, ex, new Date());
      return r.questionResults.map((qr) => ({
        id: `entry-${qr.questionId}`,
        organizationId: att.organizationId,
        attemptId: att.id,
        questionId: qr.questionId,
        gradingMode: "auto" as const,
        status: "completed_auto" as const,
        maxScore: qr.maxScore,
        earnedScore: qr.score,
        candidateAnswer: qr.candidateAnswer,
        standardAnswer: qr.standardAnswer,
        correct: qr.correct,
        comment: "",
        gradedBy: null,
        gradedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    },
    findByAttemptAndQuestion: async () => null,
    bulkCreate: async (inputs) => {
      const rows: AttemptGradingEntry[] = inputs.map((inp) => ({
        id: `entry-${inp.questionId}`,
        organizationId: "org-1",
        attemptId: inp.attemptId,
        questionId: inp.questionId,
        gradingMode: inp.gradingMode,
        status: inp.status,
        maxScore: inp.maxScore,
        earnedScore: inp.earnedScore,
        candidateAnswer: inp.candidateAnswer,
        standardAnswer: inp.standardAnswer,
        correct: inp.correct,
        comment: "",
        gradedBy: null,
        gradedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      const aid = inputs[0]?.attemptId ?? "attempt-1";
      worksetStore.set(aid, rows);
    },
    completeManualEntry: async () => null,
    countPendingManualForAttempt: async (id) => {
      const rows = worksetStore.get(id) ?? [];
      return rows.filter(
        (e) => e.gradingMode === "manual" && e.status === "pending_manual",
      ).length;
    },
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

// T1-T4: the canonical "is this attempt expired?" seam. This is the SOLE
// authority for any code path that mutates attempt state on deadline (inline
// reconciliation AND the scanner under-lock recheck). Both paths MUST call
// this — never re-derive deadlineAt<=now || closeAt<=now.
describe("isAttemptDeadlineExpired (canonical expiry authority)", () => {
  const EXAM_CLOSE = new Date("2025-01-01T12:00:00Z");

  // T1: now strictly after the effective deadline => expired.
  it("returns true when now > min(exam.closeAt, attempt.deadlineAt)", () => {
    const exam = makeExam({ closeAt: EXAM_CLOSE });
    const attempt = makeAttempt({
      status: "in_progress",
      deadlineAt: new Date("2025-01-01T11:00:00Z"),
    });
    const now = new Date("2025-01-01T11:30:00Z");
    // effectiveDeadline = min(12:00, 11:00) = 11:00; now 11:30 > 11:00
    expect(isAttemptDeadlineExpired(exam, attempt, now)).toBe(true);
  });

  // T2: now at-or-before the effective deadline => NOT expired.
  it("returns false when now <= min(exam.closeAt, attempt.deadlineAt)", () => {
    const exam = makeExam({ closeAt: EXAM_CLOSE });
    const attempt = makeAttempt({
      status: "in_progress",
      deadlineAt: new Date("2025-01-01T11:00:00Z"),
    });
    // exactly at effective deadline (11:00) => expired (>= is the boundary)
    expect(
      isAttemptDeadlineExpired(exam, attempt, new Date("2025-01-01T11:00:00Z")),
    ).toBe(true);
    // one ms before => not expired
    expect(
      isAttemptDeadlineExpired(
        exam,
        attempt,
        new Date("2025-01-01T10:59:59.999Z"),
      ),
    ).toBe(false);
  });

  // T3: absent attempt deadline => falls back to exam.closeAt (carve-out).
  it("expires at exam.closeAt when attempt.deadlineAt is absent (NULL carve-out)", () => {
    const exam = makeExam({ closeAt: EXAM_CLOSE });
    const attempt = makeAttempt({ status: "in_progress" });
    // exactOptionalPropertyTypes forbids `deadlineAt: undefined`; delete the
    // key to model an attempt with no per-attempt deadline (domain optional).
    delete (attempt as { deadlineAt?: Date }).deadlineAt;
    // effectiveDeadline = closeAt = 12:00
    expect(
      isAttemptDeadlineExpired(exam, attempt, new Date("2025-01-01T11:59:00Z")),
    ).toBe(false);
    expect(
      isAttemptDeadlineExpired(exam, attempt, new Date("2025-01-01T12:00:00Z")),
    ).toBe(true);
  });

  // P0-C T2: computeEffectiveDeadline assigns exam.closeAt to a NULL-deadline
  // attempt. This is the global authority for both inline reconciliation and
  // scanner discovery (NULL DEADLINE MEANS EXAM-CLOSE-ONLY DEADLINE).
  it("computeEffectiveDeadline returns exam.closeAt when attempt.deadlineAt is absent (P0-C)", () => {
    const exam = makeExam({ closeAt: EXAM_CLOSE });
    const attempt = makeAttempt({ status: "in_progress" });
    delete (attempt as { deadlineAt?: Date }).deadlineAt;
    expect(computeEffectiveDeadline(exam, attempt).getTime()).toBe(
      EXAM_CLOSE.getTime(),
    );
  });

  // T4: non-NULL attempt.deadlineAt PAST exam.closeAt => expires at closeAt.
  // This is the bug scenario: an attempt whose per-attempt deadline was
  // extended beyond the exam window must still expire when the WINDOW closes.
  it("expires at exam.closeAt when attempt.deadlineAt is past closeAt (the divergence bug scenario)", () => {
    const exam = makeExam({ closeAt: EXAM_CLOSE });
    const attempt = makeAttempt({
      status: "in_progress",
      // per-attempt deadline is in the FUTURE, beyond the exam window.
      deadlineAt: new Date("2025-01-01T13:00:00Z"),
    });
    // effectiveDeadline = min(12:00, 13:00) = 12:00 (closeAt wins)
    // At 12:30 the exam window has closed even though the per-attempt
    // deadline is 13:00. The scanner's old predicate (deadlineAt<=now only)
    // MISSED this; the canonical seam and the new discovery predicate catch it.
    expect(
      isAttemptDeadlineExpired(exam, attempt, new Date("2025-01-01T12:30:00Z")),
    ).toBe(true);
  });
});
