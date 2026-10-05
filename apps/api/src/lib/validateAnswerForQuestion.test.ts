import { describe, expect, it } from "vitest";
import {
  ContentDocumentV1Schema,
  canonicalizeContentDocument,
} from "@exam/contracts";
import {
  CONTENT_LIMITS,
  normalizeContentDocument,
  type ContentDocumentV1,
  type QuestionSnapshot,
} from "@exam/domain";
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

  it("rich text_response: rejects durable-unrepresentable strings before persistence", () => {
    const q = snapshot({
      type: "text_response",
      answerMode: "rich",
      options: [],
      standardAnswer: null,
    });
    for (const bad of ["\u0000", "\uD800", "\uDC00"]) {
      const hostile = {
        ...RICH_DOC,
        content: [
          { type: "paragraph", content: [{ type: "text", text: `a${bad}b` }] },
        ],
      };
      expect(
        validateAnswerForQuestion(q, hostile).ok,
        JSON.stringify(bad),
      ).toBe(false);
    }
    // The rule is representability, not ASCII-ness: well-formed exotic
    // scalars stay legal.
    const exotic = {
      ...RICH_DOC,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "答案 🚀 \uFFFD" }],
        },
      ],
    };
    expect(validateAnswerForQuestion(q, exotic).ok).toBe(true);
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

describe("rich canonical closure (#669)", () => {
  const RICH = snapshot({
    type: "text_response",
    answerMode: "rich",
    options: [],
    standardAnswer: null,
  });
  const T = CONTENT_LIMITS.textRun;

  /** One-paragraph document from text runs; runs merge when marks match. */
  function runsDocument(
    runs: Array<{ text: string; marks?: string[] }>,
  ): ContentDocumentV1 {
    return {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: runs.map((run) => ({
            type: "text" as const,
            text: run.text,
            ...(run.marks ? { marks: run.marks as never[] } : {}),
          })),
        },
      ],
    };
  }

  it("rejects the merge-class seed before durable acceptance (#669/#686)", () => {
    // The minimized counterexample: two adjacent unmarked runs,
    // each within textRun, whose canonical merge is a 20001-char run that
    // ContentDocumentV1Schema rejects. Durable acceptance must decide on
    // that canonical form, so the seed must be rejected, not persisted.
    const seed = runsDocument([{ text: "a".repeat(T) }, { text: "b" }]);
    expect(
      ContentDocumentV1Schema.safeParse(normalizeContentDocument(seed)).success,
    ).toBe(false);
    expect(validateAnswerForQuestion(RICH, seed).ok).toBe(false);
  });

  it("keeps the canonical textRun boundary closed from both sides", () => {
    // Largest accepted canonical form: two merged runs totalling exactly T.
    const atLimit = validateAnswerForQuestion(
      RICH,
      runsDocument([{ text: "a".repeat(T - 1) }, { text: "b" }]),
    );
    expect(atLimit.ok).toBe(true);
    if (atLimit.ok) {
      expect(atLimit.value).toEqual(
        runsDocument([{ text: "a".repeat(T - 1) + "b" }]),
      );
      expect(ContentDocumentV1Schema.safeParse(atLimit.value).success).toBe(
        true,
      );
    }

    // First rejected canonical boundary: one char past the limit exists
    // only after the merge, never in any input run.
    expect(
      validateAnswerForQuestion(
        RICH,
        runsDocument([{ text: "a".repeat(T - 1) }, { text: "bc" }]),
      ).ok,
    ).toBe(false);

    // A single run at the limit stays legal; one char more is not.
    expect(
      validateAnswerForQuestion(RICH, runsDocument([{ text: "a".repeat(T) }]))
        .ok,
    ).toBe(true);
    expect(
      validateAnswerForQuestion(
        RICH,
        runsDocument([{ text: "a".repeat(T + 1) }]),
      ).ok,
    ).toBe(false);
  });

  it("decides legality on the canonical form normalization produces", () => {
    // Duplicate marks are schema-legal; canonicalization dedups them to
    // ["bold"] AND merges adjacent runs, so the canonical text length is
    // the sum. Exactly-at-limit merges stay legal; one char over is not.
    const dup = (n: number) => Array(n).fill("bold");
    const atLimit = validateAnswerForQuestion(
      RICH,
      runsDocument([
        { text: "a".repeat(T - 1), marks: dup(3) },
        { text: "b", marks: dup(2) },
      ]),
    );
    expect(atLimit.ok).toBe(true);
    if (atLimit.ok) {
      expect(atLimit.value).toEqual(
        runsDocument([{ text: "a".repeat(T - 1) + "b", marks: ["bold"] }]),
      );
    }
    expect(
      validateAnswerForQuestion(
        RICH,
        runsDocument([
          { text: "a".repeat(T - 1), marks: dup(3) },
          { text: "bc", marks: dup(2) },
        ]),
      ).ok,
    ).toBe(false);
  });

  it("merge bridges only adjacent identical runs; hardBreak still separates (fixed point holds)", () => {
    const separated: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a".repeat(T) },
            { type: "hardBreak" },
            { type: "text", text: "b" },
          ],
        },
      ],
    };
    const result = validateAnswerForQuestion(RICH, separated);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = ContentDocumentV1Schema.safeParse(result.value);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        // Fixed point: canonicalizing an accepted canonical value
        // again succeeds and changes nothing.
        expect(normalizeContentDocument(parsed.data)).toEqual(parsed.data);
      }
    }
  });

  it("property: every accepted answer stays schema-legal after canonicalization (seeded, bounded)", () => {
    // Generator only constructs candidates; acceptance and canonical
    // legality are decided exclusively by production functions. Text-run
    // lengths are boundary-biased so same-mark neighbours land around the
    // merge limit. Seed 0x66900001 from the Phase-C campaign lineage.
    let a = 0x66900001 >>> 0;
    const rand = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const intBetween = (lo: number, hi: number) =>
      lo + Math.floor(rand() * (hi - lo + 1));
    const pick = <T>(xs: readonly T[]): T =>
      xs[Math.floor(rand() * xs.length)]!;

    for (let i = 0; i < 300; i++) {
      const candidate: ContentDocumentV1 = {
        docVersion: 1,
        type: "doc",
        content: Array.from({ length: intBetween(1, 3) }, () => ({
          type: "paragraph" as const,
          content: Array.from({ length: intBetween(1, 4) }, () => {
            const kind = pick([
              "text",
              "text",
              "text",
              "hardBreak",
              "math",
            ] as const);
            if (kind === "hardBreak") return { type: "hardBreak" as const };
            if (kind === "math")
              return { type: "inlineMath" as const, latex: "x" };
            const len =
              rand() < 0.34
                ? Math.max(1, Math.round(T / 2) + intBetween(-60, 60))
                : intBetween(1, 40);
            const marks = pick([
              undefined,
              ["bold"],
              ["bold", "italic"],
              ["bold", "bold"],
              ["underline", "underline", "underline"],
            ] as const);
            return {
              type: "text" as const,
              text: "x".repeat(len),
              ...(marks ? { marks: [...marks] } : {}),
            };
          }),
        })),
      };
      const result = validateAnswerForQuestion(RICH, candidate);
      if (result.ok) {
        const parsed = ContentDocumentV1Schema.safeParse(result.value);
        expect(
          parsed.success,
          `accepted candidate #${i} must stay legal after canonicalization`,
        ).toBe(true);
      }
    }
  });
});
