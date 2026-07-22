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
 * P3-L0-2E Slice 5 — score-authority poison tests.
 *
 * These behavioral tests prove that NOTHING other than the materialized grading
 * entries can affect the terminal score: not a stale persisted gradingResult,
 * not mutable draft answers, and not a conflicting submittedAnswers snapshot.
 * (Live questions are structurally unreachable — see
 * gradingArchitecture.structural.test.ts "aggregator reads only id +
 * questionSnapshot".)
 *
 * They exercise the canonical terminal aggregation seam directly. The
 * complementary structural locks (function body never reads .answers /
 * .submittedAnswers / .gradingResult) live in the structural test file; these
 * behavioral tests are the belt-and-suspenders proof at the value level.
 */

const NOW = new Date("2026-07-01T00:00:00Z");
const PASSING = 50;

function objectiveSnapshot(id: string, score: number): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "single_choice",
    content: `Objective ${id}`,
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

function textSnapshot(id: string, score: number): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "text_response",
    content: `Text ${id}`,
    attachments: [],
    options: [],
    standardAnswer: null,
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: 1,
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

function manualEntry(
  questionId: string,
  earned: number,
  maxScore: number,
): AttemptGradingEntry {
  return {
    id: `e-${questionId}`,
    organizationId: "org-1",
    attemptId: "attempt-1",
    questionId,
    gradingMode: "manual",
    status: "completed_manual",
    maxScore,
    earnedScore: earned,
    candidateAnswer: "an essay",
    standardAnswer: null,
    correct: earned >= maxScore,
    comment: "graded",
    gradedBy: "grader-1",
    gradedAt: NOW,
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

// ── Step 4: stale gradingResult has zero authority ─────────────────
describe("Slice 5 Step 4 — stale persisted gradingResult has zero scoring authority", () => {
  it("ignores a deliberately conflicting gradingResult and sums entry earned scores", () => {
    // Fixture from the Slice 5 spec:
    //   q-objective (maxScore=40): completed_auto earnedScore=40
    //   q-text      (maxScore=60): completed_manual earnedScore=30
    // Persisted gradingResult is poisoned to full-zero (objective=0, manual=0,
    // total=0, passed=false). The aggregate MUST be 70 from the entries.
    const questions = [
      objectiveSnapshot("q-obj", 40),
      textSnapshot("q-text", 60),
    ];
    const entries = [autoEntry("q-obj", 40, 40), manualEntry("q-text", 30, 60)];
    const poisonedGradingResult = [
      {
        questionId: "q-obj",
        score: 0,
        maxScore: 40,
        correct: false,
        candidateAnswer: "a",
        standardAnswer: "a",
      },
      {
        questionId: "q-text",
        score: 0,
        maxScore: 60,
        correct: false,
        candidateAnswer: null,
        standardAnswer: null,
      },
    ];
    const attempt = buildAttempt(questions, {
      gradingResult: poisonedGradingResult,
      score: 0,
      passed: false,
    });

    const result = aggregateGradingEntries(attempt, entries, PASSING);

    expect(result.totalScore).toBe(70);
    expect(result.questionResults.map((q) => q.score)).toEqual([40, 30]);
    // PASSING=50; 70 >= 50 → passed.
    expect(result.passed).toBe(true);
  });
});

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

// ── Step 7: live questions have zero terminal authority (structural) ──
describe("Slice 5 Step 7 — live question changes have zero terminal authority", () => {
  it("aggregator has no question-repo access: frozen snapshot + entries are the only inputs", () => {
    // Step 7 allowance: "Do not modify live question data if the production
    // aggregation seam has no possible access to it and existing source/
    // structural proof is already decisive." The aggregator signature is
    // `(attempt, entries, passingScore)` — it has no question repository and
    // cannot reach live question rows. The frozen QuestionSnapshot (maxScore,
    // type, standardAnswer) is the only question metadata it reads; a live
    // question row mutation cannot reach it. This is locked structurally in
    // gradingArchitecture.structural.test.ts ("aggregator reads only id +
    // questionSnapshot"). This test documents that relationship and proves the
    // frozen snapshot's maxScore is the validation authority.
    const questions = [objectiveSnapshot("q-obj", 40)];
    const entries = [autoEntry("q-obj", 40, 40, "a")];
    const attempt = buildAttempt(questions);

    const result = aggregateGradingEntries(attempt, entries, PASSING);

    // The maxScore in the result derives from the entry (which was validated
    // against the frozen snapshot at aggregation time). A live question's
    // maxScore cannot change this.
    expect(result.maxScore).toBe(40);
    expect(result.questionResults[0]!.maxScore).toBe(40);
  });
});

// ── Step 8: workset corruption fail-closed (pure-function property) ──
//
// The per-corruption throw behavior is already exhaustively covered in
// gradingAggregation.test.ts (Slice 4):
//   - missing grading entry        → C ("throws when an entry is missing")
//   - missing by ID set            → C ("count matches but a questionId absent")
//   - extra grading entry          → D ("entry exists for a question not in snapshot")
//   - duplicate entry              → E ("duplicate questionId in the entry set")
//   - pending_manual at terminal   → F ("any manual entry still pending_manual")
//   - non-terminal auto status     → F ("auto entry not completed_auto")
//   - mode mismatch                → guards ("gradingMode disagrees")
//   - maxScore mismatch            → guards ("entry maxScore disagrees")
//   - null earnedScore             → guards ("terminal entry has null earnedScore")
//   - earnedScore out of range     → guards ("earnedScore out of range")
//
// Slice 5 Step 8 requires ADDITIONALLY that "attempt.score / gradingResult /
// passed / terminal state" remain unchanged after a corruption rejection. Since
// aggregateGradingEntries is a PURE FUNCTION (no repo, no side effects) that
// THROWS on corruption, it can never return a value the caller could persist —
// the throw propagates and the downstream attemptRepo.update(...) in
// finalizeGrading never executes. The test below locks that purity contract.
describe("Slice 5 Step 8 — workset corruption fail-closed: pure function cannot mutate attempt truth", () => {
  it("every corruption case throws (never returns a usable aggregate the caller could persist)", () => {
    const questions = [
      objectiveSnapshot("q-obj", 40),
      textSnapshot("q-text", 60),
    ];
    const validObjective = autoEntry("q-obj", 40, 40, "a");
    const validManual = manualEntry("q-text", 30, 60);

    const corruptionCases: Array<{
      name: string;
      entries: AttemptGradingEntry[];
    }> = [
      // missing entry (only the objective, the manual is absent)
      { name: "missing entry", entries: [validObjective] },
      // extra entry (an unknown question appears)
      {
        name: "extra entry",
        entries: [validObjective, validManual, autoEntry("q-ghost", 5, 5, "a")],
      },
      // duplicate entry (same questionId twice)
      {
        name: "duplicate entry",
        entries: [validObjective, validObjective, validManual],
      },
      // pending_manual at terminal
      {
        name: "pending_manual at terminal",
        entries: [
          validObjective,
          { ...validManual, status: "pending_manual", earnedScore: null },
        ],
      },
      // mode mismatch (manual question flagged auto)
      {
        name: "mode mismatch",
        entries: [
          validObjective,
          { ...validManual, gradingMode: "auto", status: "completed_auto" },
        ],
      },
      // maxScore mismatch
      {
        name: "maxScore mismatch",
        entries: [validObjective, { ...validManual, maxScore: 999 }],
      },
      // null earnedScore on terminal entry
      {
        name: "null earnedScore",
        entries: [validObjective, { ...validManual, earnedScore: null }],
      },
    ];

    for (const c of corruptionCases) {
      const attempt = buildAttempt(questions, {
        // ExamAttempt.score/passed are optional; "unset" is undefined.
      });
      // The pure function must throw — it cannot return a partial aggregate.
      // Because it throws, no caller (finalizeGrading) can reach its
      // attemptRepo.update(...) with a corrupted result, so attempt.score /
      // gradingResult / passed / status are never written. The throw IS the
      // fail-closed boundary.
      expect(
        () => aggregateGradingEntries(attempt, c.entries, PASSING),
        `expected corruption case "${c.name}" to throw`,
      ).toThrow();
      // And the input attempt object is untouched (purity).
      expect(attempt.score).toBeUndefined();
      expect(attempt.gradingResult).toBeUndefined();
      expect(attempt.passed).toBeUndefined();
      expect(attempt.status).toBe("submitted");
    }
  });
});
