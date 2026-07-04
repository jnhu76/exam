import { describe, expect, it } from "vitest";
import type {
  ExamAttempt,
  QuestionScoreResult,
  QuestionSnapshot,
} from "@exam/domain";
import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@exam/domain";
import { gradeQuestion, reconcileScores } from "./manualGrading.js";
import type { ManualGradingRepository } from "./manualGrading.js";
import type { AttemptRepository } from "./attemptCommands.js";

const fixedNow = new Date("2026-01-01T00:00:00Z");
const DEFAULT_PASSING = 50;

function subjectiveQuestion(id: string, score = 10): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "single_choice",
    content: `Subjective ${id}`,
    attachments: [],
    options: [],
    standardAnswer: null,
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: 0,
    rubric: null,
  };
}

function objectiveQuestion(id: string): QuestionSnapshot {
  return { ...subjectiveQuestion(id), standardAnswer: "a" };
}

function makeAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    organizationId: "org-1",
    examId: "exam-1",
    enrollmentId: "enr-1",
    candidateId: "cand-1",
    attemptNo: 1,
    status: "graded",
    questionSnapshot: [subjectiveQuestion("q-sub")],
    answers: [],
    gradingStatus: "pending_manual",
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides,
  };
}

/** Builds an AttemptRepository backed by an in-memory attempt + update log. */
function makeAttemptRepo(attempt: ExamAttempt | null) {
  const updates: Partial<ExamAttempt>[] = [];
  let current: ExamAttempt | null = attempt;
  const repo: AttemptRepository = {
    findById: () => current,
    findByIdForUpdate: () => current,
    findActiveByEnrollment: () => null,
    findByEnrollmentAndAttemptNo: () => null,
    create: () => attempt as ExamAttempt,
    update: (_id: string, data: Partial<ExamAttempt>) => {
      updates.push(data);
      current = current ? { ...current, ...data } : current;
      return current;
    },
  };
  return { repo, updates };
}

/** Builds a ManualGradingRepository backed by an in-memory entry map. */
function makeManualRepo(
  initial: Array<{ questionId: string; score: number }> = [],
) {
  const entries = new Map(initial.map((e) => [e.questionId, e]));
  const upserts: Array<Record<string, unknown>> = [];
  const repo: ManualGradingRepository = {
    upsert: async (input) => {
      upserts.push(input);
      entries.set(input.questionId, {
        questionId: input.questionId,
        score: input.score,
      });
    },
    findByAttempt: async () =>
      Array.from(entries.values()).map((e) => ({
        questionId: e.questionId,
        score: e.score,
      })),
  };
  return { repo, upserts };
}

describe("gradeQuestion command", () => {
  it("throws NotFoundError when the attempt does not exist", async () => {
    const { repo: attRepo } = makeAttemptRepo(null);
    const { repo: manualRepo } = makeManualRepo();
    await expect(
      gradeQuestion(
        attRepo,
        manualRepo,
        "attempt-1",
        "q-sub",
        5,
        "",
        "grader-1",
        fixedNow,
        DEFAULT_PASSING,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("throws PermissionDeniedError on an auto_graded attempt", async () => {
    const attempt = makeAttempt({
      gradingStatus: "auto_graded",
      questionSnapshot: [objectiveQuestion("q-obj")],
    });
    const { repo: attRepo } = makeAttemptRepo(attempt);
    const { repo: manualRepo } = makeManualRepo();
    await expect(
      gradeQuestion(
        attRepo,
        manualRepo,
        "attempt-1",
        "q-obj",
        5,
        "",
        "grader-1",
        fixedNow,
        DEFAULT_PASSING,
      ),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("throws ValidationError for a non-subjective question id", async () => {
    const attempt = makeAttempt({
      questionSnapshot: [
        subjectiveQuestion("q-sub"),
        objectiveQuestion("q-obj"),
      ],
    });
    const { repo: attRepo } = makeAttemptRepo(attempt);
    const { repo: manualRepo } = makeManualRepo();
    await expect(
      gradeQuestion(
        attRepo,
        manualRepo,
        "attempt-1",
        "q-obj",
        5,
        "",
        "grader-1",
        fixedNow,
        DEFAULT_PASSING,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when score exceeds maxScore", async () => {
    const attempt = makeAttempt();
    const { repo: attRepo } = makeAttemptRepo(attempt);
    const { repo: manualRepo } = makeManualRepo();
    await expect(
      gradeQuestion(
        attRepo,
        manualRepo,
        "attempt-1",
        "q-sub",
        11,
        "",
        "grader-1",
        fixedNow,
        DEFAULT_PASSING,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when score is NaN", async () => {
    const attempt = makeAttempt();
    const { repo: attRepo } = makeAttemptRepo(attempt);
    const { repo: manualRepo } = makeManualRepo();
    await expect(
      gradeQuestion(
        attRepo,
        manualRepo,
        "attempt-1",
        "q-sub",
        Number.NaN,
        "",
        "grader-1",
        fixedNow,
        DEFAULT_PASSING,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("stays pending_manual and does NOT reconcile when questions remain", async () => {
    const attempt = makeAttempt({
      questionSnapshot: [subjectiveQuestion("q-a"), subjectiveQuestion("q-b")],
    });
    const { repo: attRepo, updates } = makeAttemptRepo(attempt);
    const { repo: manualRepo, upserts } = makeManualRepo();

    const result = await gradeQuestion(
      attRepo,
      manualRepo,
      "attempt-1",
      "q-a",
      7,
      "good",
      "grader-1",
      fixedNow,
      DEFAULT_PASSING,
    );

    expect(result).toEqual({
      gradingStatus: "pending_manual",
      fullyGraded: false,
    });
    // Only ONE upsert happened (the graded question).
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ questionId: "q-a", score: 7 });
    // Partial grading never reconciles: no score/gradingResult write.
    expect(updates).toEqual([]);
  });

  it("flips to fully_graded AND reconciles total when the last question is graded", async () => {
    const attempt = makeAttempt();
    const { repo: attRepo, updates } = makeAttemptRepo(attempt);
    const { repo: manualRepo } = makeManualRepo();

    const result = await gradeQuestion(
      attRepo,
      manualRepo,
      "attempt-1",
      "q-sub",
      9,
      "",
      "grader-1",
      fixedNow,
      DEFAULT_PASSING,
    );

    expect(result).toEqual({
      gradingStatus: "fully_graded",
      fullyGraded: true,
      totalScore: 9,
      passed: false, // 9 < 50
    });
    // Full grading writes the reconciled gradingStatus + score + passed + gradingResult.
    expect(updates).toHaveLength(1);
    const update = updates[0]!;
    expect(update.gradingStatus).toBe("fully_graded");
    expect(update.score).toBe(9);
    expect(update.passed).toBe(false);
    expect(update.gradingResult).toHaveLength(1);
    const row = (update.gradingResult as QuestionScoreResult[])[0]!;
    expect(row).toMatchObject({ questionId: "q-sub", score: 9, maxScore: 10 });
  });

  it("overwrites a previous entry on re-grade and reconciles idempotently", async () => {
    const attempt = makeAttempt();
    const { repo: attRepo, updates } = makeAttemptRepo(attempt);
    const { repo: manualRepo, upserts } = makeManualRepo([
      { questionId: "q-sub", score: 3 },
    ]);

    const result = await gradeQuestion(
      attRepo,
      manualRepo,
      "attempt-1",
      "q-sub",
      8,
      "re-grade",
      "grader-1",
      fixedNow,
      DEFAULT_PASSING,
    );

    expect(result.fullyGraded).toBe(true);
    expect(result.totalScore).toBe(8); // recomputed from the single full entry set
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ questionId: "q-sub", score: 8 });
    // Re-grade reconciles again from the complete set (not 3 + 8 = double-count).
    expect(updates[0]!.score).toBe(8);
  });

  it("reconciles even when already fully_graded (re-grade keeps total in sync)", async () => {
    const attempt = makeAttempt({ gradingStatus: "fully_graded" });
    const { repo: attRepo, updates } = makeAttemptRepo(attempt);
    const { repo: manualRepo, upserts } = makeManualRepo([
      { questionId: "q-sub", score: 3 },
    ]);

    const result = await gradeQuestion(
      attRepo,
      manualRepo,
      "attempt-1",
      "q-sub",
      8,
      "re-grade",
      "grader-1",
      fixedNow,
      DEFAULT_PASSING,
    );

    expect(result.fullyGraded).toBe(true);
    expect(result.totalScore).toBe(8);
    expect(upserts).toHaveLength(1);
    // Re-grade on an already-fully-graded attempt still reconciles the total.
    expect(updates[0]!.score).toBe(8);
  });
});

describe("reconcileScores", () => {
  function objResult(
    id: string,
    score: number,
    maxScore: number,
  ): QuestionScoreResult {
    return {
      questionId: id,
      score,
      maxScore,
      correct: score >= maxScore,
      candidateAnswer: "a",
      standardAnswer: "a",
    };
  }

  it("sums objective auto results + manual entries and computes passed", () => {
    const attempt = makeAttempt({
      questionSnapshot: [
        objectiveQuestion("q-obj"),
        subjectiveQuestion("q-sub", 60),
      ],
      gradingResult: [objResult("q-obj", 40, 40)],
    });
    const { questionResults, totalScore, passed } = reconcileScores(
      attempt,
      [{ questionId: "q-sub", score: 50 }],
      DEFAULT_PASSING,
    );
    expect(totalScore).toBe(90); // 40 objective + 50 manual
    expect(passed).toBe(true); // 90 >= 50
    const subjective = questionResults.find((r) => r.questionId === "q-sub");
    expect(subjective).toMatchObject({ score: 50, maxScore: 60 });
    const objective = questionResults.find((r) => r.questionId === "q-obj");
    expect(objective).toMatchObject({ score: 40, maxScore: 40 });
  });

  it("is idempotent — re-running with the same entries yields the same total", () => {
    const attempt = makeAttempt({
      questionSnapshot: [
        objectiveQuestion("q-obj"),
        subjectiveQuestion("q-sub", 60),
      ],
      gradingResult: [objResult("q-obj", 40, 40)],
    });
    const entries = [{ questionId: "q-sub", score: 50 }];
    const first = reconcileScores(attempt, entries, DEFAULT_PASSING);
    const second = reconcileScores(attempt, entries, DEFAULT_PASSING);
    expect(second.totalScore).toBe(first.totalScore);
    expect(second.passed).toBe(first.passed);
  });

  it("marks a full-mark manual entry as correct", () => {
    const attempt = makeAttempt({
      questionSnapshot: [subjectiveQuestion("q-sub", 60)],
    });
    const { questionResults } = reconcileScores(
      attempt,
      [{ questionId: "q-sub", score: 60 }],
      DEFAULT_PASSING,
    );
    expect(questionResults[0]!.correct).toBe(true);
    expect(questionResults[0]!.standardAnswer).toBeNull();
  });
});
