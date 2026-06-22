import { describe, expect, it } from "vitest";
import type { ExamAttempt, QuestionSnapshot } from "@exam/domain";
import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@exam/domain";
import { gradeQuestion } from "./manualGrading.js";
import type { ManualGradingRepository } from "./manualGrading.js";
import type { AttemptRepository } from "./attemptCommands.js";

const fixedNow = new Date("2026-01-01T00:00:00Z");

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
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("stays pending_manual and does NOT touch status/score when questions remain", async () => {
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
    );

    expect(result).toEqual({
      gradingStatus: "pending_manual",
      fullyGraded: false,
    });
    // Only ONE upsert happened (the graded question).
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ questionId: "q-a", score: 7 });
    // Decision #2: no mutation of lifecycle status / score / gradingResult / passed.
    expect(updates).toEqual([]);
  });

  it("flips gradingStatus to fully_graded when the last question is graded", async () => {
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
    );

    expect(result).toEqual({
      gradingStatus: "fully_graded",
      fullyGraded: true,
    });
    // Only gradingStatus is written — never status/score/etc (Decision #2).
    expect(updates).toEqual([{ gradingStatus: "fully_graded" }]);
  });

  it("overwrites a previous entry on re-grade via upsert", async () => {
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
    );

    expect(result.fullyGraded).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ questionId: "q-sub", score: 8 });
    // The attempt was pending_manual with one entry; grading the last question
    // flips it to fully_graded (one gradingStatus-only update).
    expect(updates).toEqual([{ gradingStatus: "fully_graded" }]);
  });

  it("does not re-issue a fully_graded update when already fully_graded", async () => {
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
    );

    expect(result.fullyGraded).toBe(true);
    expect(upserts).toHaveLength(1);
    // Already fully_graded: no status update needed.
    expect(updates).toEqual([]);
  });
});
