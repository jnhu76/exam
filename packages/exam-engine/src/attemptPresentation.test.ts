import { describe, expect, it } from "vitest";
import type { ControlFlags, QuestionSnapshot } from "@exam/domain";
import {
  materializeAttemptPresentation,
  type RandomSource,
} from "./attemptPresentation.js";

/** #294 — deterministic [0,1) sequence; exhausted draws return 0. */
function sequenceRng(...values: number[]): RandomSource {
  let i = 0;
  return () => values[i++] ?? 0;
}

/** Control flags with the two #294 policy inputs; everything else inert. */
function flags(
  shuffleQuestions: boolean,
  shuffleOptions: boolean,
): ControlFlags {
  return {
    shuffleQuestions,
    shuffleOptions,
    detectTabSwitch: false,
    disableCopyPaste: false,
    requireQueue: false,
    batchSize: 10,
    batchInterval: 3,
    restrictIp: false,
    requireLockdown: false,
    showResultImmediately: true,
  };
}

/** Published snapshot with all five question types represented. */
function publishedSnapshot(): QuestionSnapshot[] {
  return [
    {
      originalQuestionId: "q1",
      type: "single_choice",
      content: "Q1",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [
        { id: "a", content: "A" },
        { id: "b", content: "B" },
        { id: "c", content: "C" },
      ],
      standardAnswer: "b",
      score: 20,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
      rubric: null,
    },
    {
      originalQuestionId: "q2",
      type: "multiple_choice",
      content: "Q2",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [
        { id: "d", content: "D" },
        { id: "e", content: "E" },
      ],
      standardAnswer: ["d"],
      score: 20,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 1,
      rubric: null,
    },
    {
      originalQuestionId: "q3",
      type: "true_false",
      content: "Q3",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [
        { id: "t", content: "True" },
        { id: "f", content: "False" },
      ],
      standardAnswer: "t",
      score: 20,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 2,
      rubric: null,
    },
    {
      originalQuestionId: "q4",
      type: "fill_blank",
      content: "Q4",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [],
      standardAnswer: "x",
      score: 20,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 3,
      rubric: null,
    },
    {
      originalQuestionId: "q5",
      type: "text_response",
      content: "Q5",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [],
      standardAnswer: null,
      score: 20,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 4,
      rubric: "Rubric",
    },
  ];
}

describe("materializeAttemptPresentation (#294)", () => {
  // T1 / P0 — no shuffle preserves both dimensions.
  it("P0: preserves question and option order when both flags are false", () => {
    const published = publishedSnapshot();
    const result = materializeAttemptPresentation(
      published,
      flags(false, false),
    );

    expect(result).toEqual(published);
    expect(result.map((q) => q.originalQuestionId)).toEqual([
      "q1",
      "q2",
      "q3",
      "q4",
      "q5",
    ]);
    expect(result.map((q) => q.order)).toEqual([0, 1, 2, 3, 4]);
  });

  // T2 / P1 — question-only shuffle.
  it("P1: question order follows the deterministic RNG, options preserved", () => {
    const published = publishedSnapshot();
    // 5 questions → 4 draws. rng 0.1,0,0,0 → [q2,q3,q4,q5,q1]
    const result = materializeAttemptPresentation(
      published,
      flags(true, false),
      sequenceRng(0.1, 0, 0, 0),
    );

    expect(result.map((q) => q.originalQuestionId)).toEqual([
      "q2",
      "q3",
      "q4",
      "q5",
      "q1",
    ]);
    expect(result.map((q) => q.order)).toEqual([0, 1, 2, 3, 4]);
    // Options untouched on every question, including choice types.
    expect(result[4]!.options.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(result[0]!.options.map((o) => o.id)).toEqual(["d", "e"]);
  });

  // T3 / P2 — option-only shuffle.
  it("P2: choice options shuffle, non-choice unchanged, question order preserved", () => {
    const published = publishedSnapshot();
    // Draws consumed per question in published order: q1 (3 opts, 2 draws),
    // q2 (2 opts, 1 draw), q3 true_false (0 draws), q4/q5 (0 draws).
    const result = materializeAttemptPresentation(
      published,
      flags(false, true),
      sequenceRng(0.1, 0, 0.1),
    );

    expect(result.map((q) => q.originalQuestionId)).toEqual([
      "q1",
      "q2",
      "q3",
      "q4",
      "q5",
    ]);
    expect(result.map((q) => q.order)).toEqual([0, 1, 2, 3, 4]);
    // q1 [a,b,c] with rng 0.1,0 → [b,c,a]
    expect(result[0]!.options.map((o) => o.id)).toEqual(["b", "c", "a"]);
    // q2 [d,e] with rng 0.1 → [e,d]
    expect(result[1]!.options.map((o) => o.id)).toEqual(["e", "d"]);
    // Non-choice question types keep their options verbatim (T5).
    expect(result[2]!.options.map((o) => o.id)).toEqual(["t", "f"]);
    expect(result[3]!.options).toEqual([]);
    expect(result[4]!.options).toEqual([]);
  });

  // T4 / P3 — both dimensions independently.
  it("P3: both dimensions shuffle independently", () => {
    const published = publishedSnapshot();
    // Question shuffle consumes 4 draws (0.1,0,0,0 → [q2,q3,q4,q5,q1]).
    // Option shuffle then runs over the NEW question order:
    // q2 (1 draw), q1 (2 draws); q3/q4/q5 consume none.
    const result = materializeAttemptPresentation(
      published,
      flags(true, true),
      sequenceRng(0.1, 0, 0, 0, 0.1, 0.1, 0),
    );

    expect(result.map((q) => q.originalQuestionId)).toEqual([
      "q2",
      "q3",
      "q4",
      "q5",
      "q1",
    ]);
    expect(result.map((q) => q.order)).toEqual([0, 1, 2, 3, 4]);
    expect(result[0]!.options.map((o) => o.id)).toEqual(["e", "d"]);
    expect(result[4]!.options.map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  // T6 — source snapshot immutability.
  it("T6: the published snapshot is never mutated by any policy combination", () => {
    const published = publishedSnapshot();
    const before = JSON.stringify(published);
    const optionArrayBefore = published[0]!.options;

    materializeAttemptPresentation(
      published,
      flags(true, true),
      sequenceRng(0.1, 0, 0, 0, 0.1, 0.1, 0),
    );
    materializeAttemptPresentation(
      published,
      flags(false, true),
      sequenceRng(0.1, 0, 0.1),
    );
    materializeAttemptPresentation(
      published,
      flags(true, false),
      sequenceRng(0.1, 0, 0, 0),
    );

    expect(JSON.stringify(published)).toBe(before);
    // Even the option array objects are not re-pointed in the source.
    expect(published[0]!.options).toBe(optionArrayBefore);
    expect(published[0]!.options.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  // T7 — order normalization.
  it("T7: randomized snapshot renormalizes order to 0..n-1 regardless of published indices", () => {
    const published = publishedSnapshot().map((q, i) => ({
      ...q,
      order: (i + 1) * 10, // deliberately non-normalized published indices
    }));

    const result = materializeAttemptPresentation(
      published,
      flags(true, false),
      sequenceRng(0.1, 0, 0, 0),
    );

    expect(result.map((q) => q.order)).toEqual([0, 1, 2, 3, 4]);
    result.forEach((q, i) => {
      expect(q.order).toBe(i);
    });
    // Array order and order-field order agree (F4 normalization).
    expect(result.map((q) => q.order)).toEqual(result.map((_, i) => i));
  });

  // §16 — different attempts CAN differ (deterministic, non-probabilistic).
  it("T10: two deterministic RNG sequences can produce different frozen orders", () => {
    const published = publishedSnapshot();
    const attemptA = materializeAttemptPresentation(
      published,
      flags(true, true),
      sequenceRng(0.1, 0, 0, 0, 0.1, 0.1, 0),
    );
    const attemptB = materializeAttemptPresentation(
      published,
      flags(true, true),
      sequenceRng(0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99),
    );

    expect(attemptA.map((q) => q.originalQuestionId).join(",")).not.toBe(
      attemptB.map((q) => q.originalQuestionId).join(","),
    );
    // Identity permutation is a legal draw — the invariant is MAY differ.
    expect(attemptB.map((q) => q.originalQuestionId).join(",")).toBe(
      ["q1", "q2", "q3", "q4", "q5"].join(","),
    );
  });

  // §17 — zero/one-element behavior.
  it("zero-question snapshot shuffles safely (no negative index, no swap)", () => {
    const result = materializeAttemptPresentation(
      [],
      flags(true, true),
      sequenceRng(0.1),
    );

    expect(result).toEqual([]);
  });

  it("single-question snapshot shuffles safely and keeps options", () => {
    const published = publishedSnapshot().slice(0, 1);
    const result = materializeAttemptPresentation(
      published,
      flags(true, true),
      sequenceRng(0.1, 0.1, 0),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.originalQuestionId).toBe("q1");
    expect(result[0]!.order).toBe(0);
    expect(result[0]!.options.map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  it("two-option choice shuffles without division issues", () => {
    const published = publishedSnapshot().slice(1, 2);
    const result = materializeAttemptPresentation(
      published,
      flags(false, true),
      sequenceRng(0.1),
    );

    expect(result[0]!.options.map((o) => o.id)).toEqual(["e", "d"]);
  });
});
