import { describe, expect, it } from "vitest";
import type {
  AttemptGradingEntry,
  ExamAttempt,
  QuestionSnapshot,
} from "@exam/domain";
import { aggregateGradingEntries } from "./gradingWorkset.js";

/**
 * P3-L0-2E Slice 4 — canonical terminal aggregation from grading entries.
 *
 * These tests prove {@link aggregateGradingEntries} is the single terminal
 * score authority: it reads ONLY `attempt_grading_entries` (earned score) +
 * the frozen `questionSnapshot` (universe / order / metadata). It must:
 *
 *   - sum earned scores from entries (never recompute, never read old
 *     gradingResult)
 *   - reject any workset that is not exactly complete + terminal
 *   - project the final result in frozen-snapshot order
 *
 * Pure-function tests — no repos, no DB. The command-level lifecycle
 * (submitAttempt → finalizeGrading / gradeQuestion terminal branch) is
 * exercised in manualGradingCompletion.test.ts and the API gradingQueue tests.
 */

const NOW = new Date("2026-07-01T00:00:00Z");
const DEFAULT_PASSING = 50;

function objectiveSnapshot(
  id: string,
  score: number,
  standardAnswer: unknown = "a",
): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "single_choice",
    content: `Objective ${id}`,
    attachments: [],
    options: [],
    standardAnswer,
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: 0,
    rubric: null,
  };
}

function textSnapshot(
  id: string,
  score: number,
  opts: { standardAnswer?: unknown; order?: number } = {},
): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "text_response",
    content: `Text ${id}`,
    attachments: [],
    options: [],
    standardAnswer: opts.standardAnswer ?? null,
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: opts.order ?? 1,
    rubric: null,
  };
}

function makeAttempt(
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
    submittedAnswers: {
      schemaVersion: 1,
      answers: [],
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

interface EntryOpts {
  id?: string;
  attemptId?: string;
  gradingMode?: "auto" | "manual";
  status?: "completed_auto" | "completed_manual" | "pending_manual";
  maxScore?: number;
  earnedScore?: number | null;
  candidateAnswer?: unknown;
  standardAnswer?: unknown;
  correct?: boolean | null;
}

function entry(questionId: string, opts: EntryOpts = {}): AttemptGradingEntry {
  const mode = opts.gradingMode ?? "auto";
  // NOTE: use `!== undefined` (not `??`) so an explicit `earnedScore: null`
  // is preserved — terminal entries must never have null earnedScore, and
  // several tests below assert the aggregator rejects it.
  const earned = opts.earnedScore !== undefined ? opts.earnedScore : 0;
  return {
    id: opts.id ?? `entry-${questionId}`,
    organizationId: "org-1",
    attemptId: opts.attemptId ?? "attempt-1",
    questionId,
    gradingMode: mode,
    status:
      opts.status ?? (mode === "auto" ? "completed_auto" : "completed_manual"),
    maxScore: opts.maxScore ?? 10,
    earnedScore: earned,
    candidateAnswer: opts.candidateAnswer ?? null,
    standardAnswer: opts.standardAnswer ?? null,
    correct: opts.correct ?? null,
    comment: "",
    gradedBy: mode === "manual" ? "grader-1" : null,
    gradedAt: mode === "manual" ? NOW : null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

// ── A. mixed final total from entries only ────────────────────────
describe("Slice 4 A: mixed final total from entries only", () => {
  it("final score = sum of entry earnedScore (objective auto + manual)", () => {
    const questions = [
      objectiveSnapshot("q-obj", 40, "a"),
      textSnapshot("q-text", 60),
    ];
    const attempt = makeAttempt(questions);
    // Note: gradingResult is intentionally absent (undefined) on this attempt —
    // the old persisted/reconstruct path must NOT be consulted. The total must
    // come purely from the entries. (We don't set gradingResult at all rather
    // than passing undefined, which exactOptionalPropertyTypes rejects.)
    const entries = [
      entry("q-obj", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 40,
        earnedScore: 40,
        candidateAnswer: "a",
        standardAnswer: "a",
        correct: true,
      }),
      entry("q-text", {
        gradingMode: "manual",
        status: "completed_manual",
        maxScore: 60,
        earnedScore: 30,
        candidateAnswer: "student essay",
        standardAnswer: null,
        correct: false,
      }),
    ];

    const result = aggregateGradingEntries(attempt, entries, DEFAULT_PASSING);

    expect(result.totalScore).toBe(70); // 40 + 30, NOT recomputed
    expect(result.maxScore).toBe(100);
    expect(result.passed).toBe(true); // 70 >= 50
    expect(result.questionResults).toHaveLength(2);
  });
});

// ── B. stale gradingResult cannot override entries ────────────────
describe("Slice 4 B: stale persisted gradingResult has zero scoring authority", () => {
  it("ignores a stale objective gradingResult row that conflicts with the entry", () => {
    const questions = [
      objectiveSnapshot("q-obj", 40, "a"),
      textSnapshot("q-text", 60),
    ];
    // Persisted gradingResult claims q-obj scored 0 (stale) — the entry says 40.
    // The entry MUST win; the old "persisted wins" precedence is forbidden.
    const attempt = makeAttempt(questions, {
      gradingResult: [
        {
          questionId: "q-obj",
          score: 0, // stale — conflicts with the entry's 40
          maxScore: 40,
          correct: false,
          candidateAnswer: "a",
          standardAnswer: "a",
        },
      ],
    });
    const entries = [
      entry("q-obj", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 40,
        earnedScore: 40,
        candidateAnswer: "a",
        standardAnswer: "a",
        correct: true,
      }),
      entry("q-text", {
        gradingMode: "manual",
        status: "completed_manual",
        maxScore: 60,
        earnedScore: 30,
        candidateAnswer: "ans",
        standardAnswer: null,
        correct: false,
      }),
    ];

    const result = aggregateGradingEntries(attempt, entries, DEFAULT_PASSING);

    // 40 (entry) + 30 = 70, NOT 0 (stale) + 30 = 30.
    expect(result.totalScore).toBe(70);
  });
});

// ── C. missing grading entry fails closed ─────────────────────────
describe("Slice 4 C: missing grading entry fails closed", () => {
  it("throws when an entry is missing for a frozen question (no reconstruction)", () => {
    const questions = [
      objectiveSnapshot("q1", 10, "a"),
      objectiveSnapshot("q2", 10, "b"),
    ];
    const attempt = makeAttempt(questions);
    // Only q1's entry exists — q2 is missing. The exact-count check fires
    // first and is itself the missing-entry detection for this shape.
    const entries = [
      entry("q1", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 10,
        correct: true,
      }),
    ];

    expect(() =>
      aggregateGradingEntries(attempt, entries, DEFAULT_PASSING),
    ).toThrow(
      /expected 2 entries.*found 1|missing grading entry for question q2/,
    );
  });

  it("throws a missing-question error when count matches but a questionId is absent", () => {
    // 2 frozen questions, 2 entries, but the second entry is for a questionId
    // not in the snapshot — count passes, the per-question lookup fails.
    const questions = [
      objectiveSnapshot("q1", 10, "a"),
      objectiveSnapshot("q2", 10, "b"),
    ];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q1", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 10,
        correct: true,
      }),
      entry("q3", {
        // not in frozen snapshot — count is 2 but q2 is missing
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 10,
        correct: true,
      }),
    ];

    expect(() =>
      aggregateGradingEntries(attempt, entries, DEFAULT_PASSING),
    ).toThrow(/missing grading entry for question q2/);
  });
});

// ── D. extra grading entry fails closed ───────────────────────────
describe("Slice 4 D: extra grading entry fails closed", () => {
  it("throws when an entry exists for a question not in the frozen snapshot", () => {
    const questions = [
      objectiveSnapshot("q1", 10, "a"),
      objectiveSnapshot("q2", 10, "b"),
    ];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q1", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 10,
        correct: true,
      }),
      entry("q2", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 5,
        correct: false,
      }),
      entry("q-orphan", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 10,
        correct: true,
      }),
    ];

    expect(() =>
      aggregateGradingEntries(attempt, entries, DEFAULT_PASSING),
    ).toThrow(
      /expected 2 entries.*found 3|extra grading entry for question q-orphan/,
    );
  });
});

// ── E. duplicate identity cannot be tolerated ─────────────────────
describe("Slice 4 E: duplicate entry identity fails closed", () => {
  it("throws on a duplicate questionId in the entry set (same count, repeated id)", () => {
    // 2 frozen questions, 2 entries, but BOTH entries are for q1 — count
    // passes (2===2), the duplicate-detection pass fires before the
    // missing-q2 check because it runs while indexing.
    const questions = [
      objectiveSnapshot("q1", 10, "a"),
      objectiveSnapshot("q2", 10, "b"),
    ];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q1", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 10,
        correct: true,
      }),
      entry("q1", {
        // duplicate questionId — different id/earnedScore, same q
        id: "entry-q1-dup",
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 5,
        correct: false,
      }),
    ];

    expect(() =>
      aggregateGradingEntries(attempt, entries, DEFAULT_PASSING),
    ).toThrow(/duplicate grading entry for question q1/);
  });
});

// ── F. non-terminal entry blocks aggregation ──────────────────────
describe("Slice 4 F: pending_manual entry blocks terminal aggregation", () => {
  it("throws when any manual entry is still pending_manual", () => {
    const questions = [
      objectiveSnapshot("q-obj", 40, "a"),
      textSnapshot("q-text-1", 30),
      textSnapshot("q-text-2", 30),
    ];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q-obj", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 40,
        earnedScore: 40,
        correct: true,
      }),
      entry("q-text-1", {
        gradingMode: "manual",
        status: "completed_manual",
        maxScore: 30,
        earnedScore: 20,
        correct: false,
      }),
      entry("q-text-2", {
        gradingMode: "manual",
        status: "pending_manual", // NOT terminal
        maxScore: 30,
        earnedScore: null,
        correct: null,
      }),
    ];

    expect(() =>
      aggregateGradingEntries(attempt, entries, DEFAULT_PASSING),
    ).toThrow(/status pending_manual is not terminal/);
  });

  it("throws when an auto entry is not completed_auto", () => {
    const questions = [objectiveSnapshot("q1", 10, "a")];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q1", {
        gradingMode: "auto",
        status: "completed_manual", // wrong terminal status for auto mode
        maxScore: 10,
        earnedScore: 10,
        correct: true,
      }),
    ];

    expect(() =>
      aggregateGradingEntries(attempt, entries, DEFAULT_PASSING),
    ).toThrow(
      /status completed_manual is not terminal \(expected completed_auto\)|gradingMode auto/,
    );
  });
});

// ── G/H. pure-objective final score from entries ──────────────────
describe("Slice 4 G/H: pure-objective final score from entries", () => {
  it("final score = sum of completed_auto entry earnedScores (multi-question)", () => {
    // Fills the identified test gap: no existing engine test proves a
    // multi-question pure-objective attempt's final score = sum of correct.
    const questions = [
      objectiveSnapshot("q1", 30, "a"),
      objectiveSnapshot("q2", 20, "b"),
      objectiveSnapshot("q3", 50, "c"),
    ];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q1", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 30,
        earnedScore: 30, // correct
        candidateAnswer: "a",
        standardAnswer: "a",
        correct: true,
      }),
      entry("q2", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 20,
        earnedScore: 0, // wrong
        candidateAnswer: "x",
        standardAnswer: "b",
        correct: false,
      }),
      entry("q3", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 50,
        earnedScore: 50, // correct
        candidateAnswer: "c",
        standardAnswer: "c",
        correct: true,
      }),
    ];

    const result = aggregateGradingEntries(attempt, entries, DEFAULT_PASSING);

    expect(result.totalScore).toBe(80); // 30 + 0 + 50
    expect(result.maxScore).toBe(100);
    expect(result.passed).toBe(true); // 80 >= 50
  });

  it("objective wrong answer stays zero (no reconstruction, no double-count)", () => {
    const questions = [objectiveSnapshot("q1", 100, "a")];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q1", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 100,
        earnedScore: 0, // wrong answer frozen at submit
        candidateAnswer: "wrong",
        standardAnswer: "a",
        correct: false,
      }),
    ];

    const result = aggregateGradingEntries(attempt, entries, 50);
    expect(result.totalScore).toBe(0);
    expect(result.passed).toBe(false);
  });
});

// ── I/J/K. no double-count ────────────────────────────────────────
describe("Slice 4 I/J/K: no double-count", () => {
  it("objective earnedScore is read once per entry (no objective double-count)", () => {
    const questions = [objectiveSnapshot("q1", 40, "a")];
    const attempt = makeAttempt(questions, {
      // Stale gradingResult also carries q1 — must NOT be added on top.
      gradingResult: [
        {
          questionId: "q1",
          score: 40,
          maxScore: 40,
          correct: true,
          candidateAnswer: "a",
          standardAnswer: "a",
        },
      ],
    });
    const entries = [
      entry("q1", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 40,
        earnedScore: 40,
        correct: true,
      }),
    ];

    const result = aggregateGradingEntries(attempt, entries, 50);
    // 40 (entry) — NOT 40 + 40 (stale gradingResult).
    expect(result.totalScore).toBe(40);
  });

  it("manual earnedScore is read once per entry (no manual double-count)", () => {
    const questions = [textSnapshot("q1", 60)];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q1", {
        gradingMode: "manual",
        status: "completed_manual",
        maxScore: 60,
        earnedScore: 45,
        correct: false,
      }),
    ];

    const result = aggregateGradingEntries(attempt, entries, 50);
    expect(result.totalScore).toBe(45); // not 90
  });
});

// ── L/M/N. row count + order + sum invariant ──────────────────────
describe("Slice 4 L/M/N: result row count, order, sum invariant", () => {
  it("final gradingResult has exactly one row per frozen question", () => {
    const questions = [
      objectiveSnapshot("q-obj", 40, "a"),
      textSnapshot("q-t1", 30),
      textSnapshot("q-t2", 30),
    ];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q-obj", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 40,
        earnedScore: 40,
        correct: true,
      }),
      entry("q-t1", {
        gradingMode: "manual",
        status: "completed_manual",
        maxScore: 30,
        earnedScore: 20,
        correct: false,
      }),
      entry("q-t2", {
        gradingMode: "manual",
        status: "completed_manual",
        maxScore: 30,
        earnedScore: 15,
        correct: false,
      }),
    ];

    const result = aggregateGradingEntries(attempt, entries, DEFAULT_PASSING);

    expect(result.questionResults).toHaveLength(3);
    expect(result.totalScore).toBe(75); // 40 + 20 + 15
  });

  it("final gradingResult row order matches frozen QuestionSnapshot order (NOT entry DB order)", () => {
    // Frozen order: q-a, q-b, q-c. Entries deliberately in shuffled order.
    const questions = [
      objectiveSnapshot("q-a", 10, "a"),
      objectiveSnapshot("q-b", 10, "b"),
      objectiveSnapshot("q-c", 10, "c"),
    ];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q-c", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 10,
        correct: true,
      }),
      entry("q-a", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 5,
        correct: false,
      }),
      entry("q-b", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 10,
        correct: true,
      }),
    ];

    const result = aggregateGradingEntries(attempt, entries, DEFAULT_PASSING);

    expect(result.questionResults.map((r) => r.questionId)).toEqual([
      "q-a",
      "q-b",
      "q-c",
    ]);
    // Scores follow the frozen-order mapping, not entry input order.
    expect(result.questionResults.map((r) => r.score)).toEqual([5, 10, 10]);
  });
});

// ── Consistency guards: mode + maxScore mismatch ──────────────────
describe("Slice 4: mode/maxScore consistency guards", () => {
  it("throws when entry gradingMode disagrees with canonical question semantics", () => {
    // text_response is manual by QuestionType; an auto entry for it is wrong.
    const questions = [textSnapshot("q-text", 60)];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q-text", {
        gradingMode: "auto", // wrong — text_response is manual
        status: "completed_auto",
        maxScore: 60,
        earnedScore: 60,
        correct: true,
      }),
    ];

    expect(() =>
      aggregateGradingEntries(attempt, entries, DEFAULT_PASSING),
    ).toThrow(/gradingMode auto != expected manual/);
  });

  it("throws when entry maxScore disagrees with the frozen question score", () => {
    const questions = [objectiveSnapshot("q1", 40, "a")];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q1", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 50, // frozen says 40
        earnedScore: 50,
        correct: true,
      }),
    ];

    expect(() =>
      aggregateGradingEntries(attempt, entries, DEFAULT_PASSING),
    ).toThrow(/entry maxScore 50 != frozen 40/);
  });

  it("throws when a terminal entry has null earnedScore", () => {
    const questions = [objectiveSnapshot("q1", 10, "a")];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q1", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: null, // illegal for a terminal entry
        correct: null,
      }),
    ];

    expect(() =>
      aggregateGradingEntries(attempt, entries, DEFAULT_PASSING),
    ).toThrow(/terminal entry has null earnedScore/);
  });

  it("throws when earnedScore is out of range", () => {
    const questions = [objectiveSnapshot("q1", 10, "a")];
    const attempt = makeAttempt(questions);
    const entries = [
      entry("q1", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 15, // > maxScore
        correct: true,
      }),
    ];

    expect(() =>
      aggregateGradingEntries(attempt, entries, DEFAULT_PASSING),
    ).toThrow(/earnedScore 15 out of range/);
  });
});
