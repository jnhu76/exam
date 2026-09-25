import { describe, expect, it } from "vitest";
import type {
  AnswerRecord,
  AttemptGradingEntry,
  ExamAttempt,
  QuestionSnapshot,
  SubmittedAnswersSnapshot,
} from "@exam/domain";
import { aggregateGradingEntries } from "./gradingWorkset.js";

/**
 * P3-L0-2E Slice 5 — score-authority poison tests (retained subset).
 *
 * These behavioral tests prove that NOTHING other than the materialized grading
 * entries can affect the terminal score: not mutable draft answers, and not a
 * conflicting submittedAnswers snapshot. (Stale gradingResult authority is
 * owned by gradingAggregation.test.ts B; workset corruption fail-closed by its
 * C/D/E/F + consistency guards, including the purity of the rejection.)
 *
 * They exercise the canonical terminal aggregation seam directly.
 */

const NOW = new Date("2026-07-01T00:00:00Z");
const PASSING = 50;

function objectiveSnapshot(id: string, score: number): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "single_choice",
    content: `Objective ${id}`,
    contentDocument: null,
    answerMode: null,
    attachments: [],
    options: [],
    standardAnswer: "a",
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: 0,
    rubric: null,
  };
}

function autoEntry(
  questionId: string,
  earned: number,
  maxScore: number,
  candidateAnswer: unknown = "a",
): AttemptGradingEntry {
  return {
    id: `e-${questionId}`,
    organizationId: "org-1",
    attemptId: "attempt-1",
    questionId,
    gradingMode: "auto",
    status: "completed_auto",
    maxScore,
    earnedScore: earned,
    candidateAnswer,
    standardAnswer: "a",
    correct: earned >= maxScore,
    comment: "",
    gradedBy: null,
    gradedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildAttempt(
  questions: QuestionSnapshot[],
  overrides: Partial<ExamAttempt> = {},
): ExamAttempt {
  return {
    id: "attempt-1",
    organizationId: "org-1",
    examId: "exam-1",
    enrollmentId: "enr-1",
    candidateId: "cand-1",
    attemptNo: 1,
    status: "submitted",
    questionSnapshot: questions,
    answers: [],
    gradingStatus: "pending_manual",
    submittedAnswers: { schemaVersion: 1, answers: [] },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ── Step 5: draft answers have zero terminal authority ─────────────
describe("Slice 5 Step 5 — mutable draft answers cannot affect terminal aggregation", () => {
  it("objective score stays 40 when draft answer is later mutated to wrong", () => {
    // Materialized truth: completed_auto earnedScore=40 (correct draft at
    // freeze time). The mutable draft is then changed to a wrong value. The
    // aggregator must read the entry's earned score, NOT re-grade the draft.
    const questions = [objectiveSnapshot("q-obj", 40)];
    const entries = [autoEntry("q-obj", 40, 40, "a")];
    const conflictingDraft: AnswerRecord[] = [
      { questionId: "q-obj", answer: "WRONG", version: 2, savedAt: NOW },
    ];
    const attempt = buildAttempt(questions, { answers: conflictingDraft });

    const result = aggregateGradingEntries(attempt, entries, PASSING);

    expect(result.totalScore).toBe(40);
    expect(result.questionResults[0]!.score).toBe(40);
    expect(result.questionResults[0]!.correct).toBe(true);
  });
});

// ── Step 6: submittedAnswers are not regraded at terminal aggregation ─
describe("Slice 5 Step 6 — submittedAnswers are not re-graded during terminal aggregation", () => {
  it("terminal aggregate uses entry earnedScore, ignoring a conflicting submittedAnswers snapshot", () => {
    // Materialized truth: completed_auto earnedScore=40. The frozen
    // submittedAnswers snapshot is then poisoned to a WRONG answer. Because the
    // aggregator does not re-run objective grading on submittedAnswers, the
    // terminal score must remain 40.
    const questions = [objectiveSnapshot("q-obj", 40)];
    const entries = [autoEntry("q-obj", 40, 40, "a")];
    const poisonedSnapshot: SubmittedAnswersSnapshot = {
      schemaVersion: 1,
      answers: [{ questionId: "q-obj", value: "WRONG" }],
    };
    const attempt = buildAttempt(questions, {
      submittedAnswers: poisonedSnapshot,
    });

    const result = aggregateGradingEntries(attempt, entries, PASSING);

    expect(result.totalScore).toBe(40);
    expect(result.questionResults[0]!.score).toBe(40);
    expect(result.questionResults[0]!.correct).toBe(true);
  });
});
