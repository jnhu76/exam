import { describe, expect, it } from "vitest";
import type { QuestionSnapshot } from "@exam/domain";
import { validateAnswerForQuestion } from "./validateAnswerForQuestion.js";

function snapshot(overrides: Partial<QuestionSnapshot>): QuestionSnapshot {
  return {
    originalQuestionId: "q1",
    type: "single_choice",
    content: "Q",
    contentDocument: null,
    answerMode: null,
    attachments: [],
    options: [
      { id: "A", content: "a", contentDocument: null },
      { id: "B", content: "b", contentDocument: null },
    ],
    standardAnswer: "A",
    score: 5,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: 0,
    rubric: null,
    ...overrides,
  };
}

const RICH_DOC = {
  docVersion: 1 as const,
  type: "doc" as const,
  content: [
    {
      type: "paragraph" as const,
      content: [{ type: "text" as const, text: "answer" }],
    },
  ],
};

describe("validateAnswerForQuestion (#301 §21/§44)", () => {
  it("single_choice: accepts a valid option id, rejects objects and unknown ids", () => {
    const q = snapshot({});
    expect(validateAnswerForQuestion(q, "A")).toEqual({ ok: true, value: "A" });
    expect(validateAnswerForQuestion(q, { id: "A" }).ok).toBe(false);
    expect(validateAnswerForQuestion(q, "Z").ok).toBe(false);
  });

  it("multiple_choice: accepts id arrays (incl. empty), rejects shapes and unknown ids", () => {
    const q = snapshot({ type: "multiple_choice" });
    expect(validateAnswerForQuestion(q, ["A", "B"])).toEqual({
      ok: true,
      value: ["A", "B"],
    });
    expect(validateAnswerForQuestion(q, []).ok).toBe(true);
    expect(validateAnswerForQuestion(q, "A").ok).toBe(false);
    expect(validateAnswerForQuestion(q, ["A", "Z"]).ok).toBe(false);
    expect(validateAnswerForQuestion(q, [1]).ok).toBe(false);
  });

  it("true_false: accepts booleans only", () => {
    const q = snapshot({ type: "true_false", options: [] });
    expect(validateAnswerForQuestion(q, true)).toEqual({
      ok: true,
      value: true,
    });
    expect(validateAnswerForQuestion(q, "true").ok).toBe(false);
  });

  it("fill_blank: accepts strings and blank-universe records, rejects foreign keys", () => {
    const q = snapshot({
      type: "fill_blank",
      content: "a ____ b ____ c",
      options: [],
    });
    expect(validateAnswerForQuestion(q, "1")).toEqual({ ok: true, value: "1" });
    expect(
      validateAnswerForQuestion(q, { "blank-1": "x", "blank-2": "y" }),
    ).toEqual({
      ok: true,
      value: { "blank-1": "x", "blank-2": "y" },
    });
    expect(validateAnswerForQuestion(q, { "blank-9": "x" }).ok).toBe(false);
    expect(validateAnswerForQuestion(q, { "blank-1": 5 }).ok).toBe(false);
    expect(validateAnswerForQuestion(q, ["1"]).ok).toBe(false);
  });

  it("plain text_response: accepts strings, rejects objects", () => {
    const q = snapshot({
      type: "text_response",
      options: [],
      standardAnswer: null,
    });
    expect(validateAnswerForQuestion(q, "essay")).toEqual({
      ok: true,
      value: "essay",
    });
    expect(validateAnswerForQuestion(q, { text: "essay" }).ok).toBe(false);
  });

  it("rich text_response: rejects strings, accepts valid ContentDocumentV1", () => {
    const q = snapshot({
      type: "text_response",
      answerMode: "rich",
      options: [],
      standardAnswer: null,
    });
    expect(validateAnswerForQuestion(q, "plain text").ok).toBe(false);
    const ok = validateAnswerForQuestion(q, RICH_DOC);
    expect(ok.ok).toBe(true);
    expect(validateAnswerForQuestion(q, { type: "doc" }).ok).toBe(false);
  });

  it("canonicalizes rich answers BEFORE equality/idempotency (transient forms converge)", () => {
    const q = snapshot({
      type: "text_response",
      answerMode: "rich",
      options: [],
      standardAnswer: null,
    });
    const transientForm = {
      ...RICH_DOC,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "ans" },
            { type: "text", text: "we", marks: [] },
            { type: "text", text: "" },
            { type: "text", text: "r", marks: [] },
          ],
        },
        { type: "paragraph", content: [] },
      ],
    };
    const a = validateAnswerForQuestion(q, RICH_DOC);
    const b = validateAnswerForQuestion(q, transientForm);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      // The canonical values are structurally identical: the idempotency
      // replay check (same clientSeq) will see an equal payload.
      expect(b.value).toEqual(a.value);
    }
  });

  it("null stays a valid cleared answer for every type", () => {
    for (const q of [
      snapshot({}),
      snapshot({
        type: "text_response",
        answerMode: "rich" as const,
        options: [],
      }),
      snapshot({ type: "fill_blank", content: "a ____", options: [] }),
    ]) {
      expect(validateAnswerForQuestion(q, null)).toEqual({
        ok: true,
        value: null,
      });
    }
  });
});
