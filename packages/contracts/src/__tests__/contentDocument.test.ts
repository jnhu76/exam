import { describe, expect, it } from "vitest";
import {
  AnswerModeEnum,
  ContentDocumentV1Schema,
  canonicalizeContentDocument,
} from "../contentDocument.js";
import {
  CreateQuestionRequestSchema,
  UpdateQuestionRequestSchema,
} from "../question.js";
import { QuestionSnapshotSchema } from "../attempt.js";
import {
  CONTENT_LIMITS,
  RICH_STRING_UNREPRESENTABLE_MESSAGE,
  normalizeContentDocument,
  type ContentDocumentV1,
} from "@exam/domain";

function doc(content: unknown[]): ContentDocumentV1 {
  return { docVersion: 1, type: "doc", content } as ContentDocumentV1;
}

const RICH_TEXT_RESPONSE_CREATE = {
  courseId: "11111111-1111-4111-8111-111111111111",
  type: "text_response",
  contentDocument: doc([
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Prove: ", marks: ["bold"] },
        { type: "inlineMath", latex: "a^2+b^2=c^2" },
      ],
    },
  ]),
  standardAnswer: null,
  score: 10,
  rubric: "证明过程完整",
};

describe("ContentDocumentV1Schema (wire grammar)", () => {
  it("accepts a valid document with every V1 node and mark", () => {
    const parsed = ContentDocumentV1Schema.safeParse(
      doc([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "b", marks: ["bold"] },
            { type: "text", text: "i", marks: ["italic"] },
            { type: "text", text: "u", marks: ["underline"] },
            { type: "text", text: "c", marks: ["inlineCode"] },
            { type: "hardBreak" },
            { type: "inlineMath", latex: "x+1" },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "li" }] },
                {
                  type: "orderedList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "nested" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { type: "blockMath", latex: "\\int_0^1 x dx" },
        { type: "codeBlock", language: "ts", text: "let x = 1;" },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "A" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "B" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown nodes, marks, and attributes (closed vocabulary)", () => {
    const unknownNode = ContentDocumentV1Schema.safeParse(
      doc([{ type: "image", attrs: { assetId: "x" } }]),
    );
    expect(unknownNode.success).toBe(false);

    const unknownMark = ContentDocumentV1Schema.safeParse(
      doc([
        {
          type: "paragraph",
          content: [{ type: "text", text: "x", marks: ["highlight"] }],
        },
      ]),
    );
    expect(unknownMark.success).toBe(false);

    const unknownAttr = ContentDocumentV1Schema.safeParse(
      doc([
        {
          type: "paragraph",
          content: [{ type: "text", text: "x" }],
          attrs: { color: "red" },
        },
      ]),
    );
    expect(unknownAttr.success).toBe(false);
  });

  it("accepts raw HTML-looking strings as schema-valid text content", () => {
    // HTML arrives as TEXT — valid grammar, inert content; the renderer test
    // proves it can never become executable DOM.
    const script = ContentDocumentV1Schema.safeParse(
      doc([
        {
          type: "paragraph",
          content: [{ type: "text", text: "<script>alert(1)</script>" }],
        },
      ]),
    );
    expect(script.success).toBe(true);
  });

  it("rejects wrong docVersion, bad marks combos, ragged tables, and empty latex", () => {
    expect(
      ContentDocumentV1Schema.safeParse({ ...doc([]), docVersion: 2 }).success,
    ).toBe(false);

    expect(
      ContentDocumentV1Schema.safeParse(
        doc([
          {
            type: "paragraph",
            content: [
              { type: "text", text: "x", marks: ["bold", "inlineCode"] },
            ],
          },
        ]),
      ).success,
    ).toBe(false);

    const ragged = ContentDocumentV1Schema.safeParse(
      doc([
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [] }],
                },
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [] }],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(ragged.success).toBe(false);

    expect(
      ContentDocumentV1Schema.safeParse(doc([{ type: "blockMath", latex: "" }]))
        .success,
    ).toBe(false);
  });

  it("rejects deep trees and oversized payloads (server-side limits)", () => {
    expect(
      ContentDocumentV1Schema.safeParse(
        doc([{ type: "codeBlock", language: null, text: "x".repeat(50000) }]),
      ).success,
    ).toBe(false);

    expect(
      ContentDocumentV1Schema.safeParse(
        doc([{ type: "blockMath", latex: "y".repeat(6000) }]),
      ).success,
    ).toBe(false);
  });

  it("AnswerModeEnum only allows plain|rich", () => {
    expect(AnswerModeEnum.safeParse("plain").success).toBe(true);
    expect(AnswerModeEnum.safeParse("rich").success).toBe(true);
    expect(AnswerModeEnum.safeParse("markdown").success).toBe(false);
  });
});

describe("question contract evolution", () => {
  it("accepts a rich text_response create without content", () => {
    const parsed = CreateQuestionRequestSchema.safeParse(
      RICH_TEXT_RESPONSE_CREATE,
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts a plain create unchanged (content required)", () => {
    const ok = CreateQuestionRequestSchema.safeParse({
      ...RICH_TEXT_RESPONSE_CREATE,
      type: "single_choice",
      content: "2+2=?",
      contentDocument: null,
      options: [
        { id: "A", content: "3" },
        { id: "B", content: "4" },
      ],
      standardAnswer: "B",
    });
    expect(ok.success).toBe(true);

    const missingContent = CreateQuestionRequestSchema.safeParse({
      ...RICH_TEXT_RESPONSE_CREATE,
      type: "single_choice",
      contentDocument: null,
      options: [
        { id: "A", content: "3" },
        { id: "B", content: "4" },
      ],
      standardAnswer: "B",
    });
    expect(missingContent.success).toBe(false);
  });

  it("rejects fill_blank with rich content (hard rule)", () => {
    const parsed = CreateQuestionRequestSchema.safeParse({
      ...RICH_TEXT_RESPONSE_CREATE,
      type: "fill_blank",
      content: "x",
      standardAnswer: "1",
    });
    expect(parsed.success).toBe(false);
    expect(
      JSON.stringify(parsed.error?.issues).includes(
        "fill_blank questions do not support rich content",
      ),
    ).toBe(true);
  });

  it("rejects answerMode on non-text_response and rich options without content", () => {
    const wrongMode = CreateQuestionRequestSchema.safeParse({
      ...RICH_TEXT_RESPONSE_CREATE,
      type: "single_choice",
      answerMode: "rich",
      content: "q",
      contentDocument: null,
      options: [
        { id: "A", content: "3" },
        { id: "B", content: "4" },
      ],
      standardAnswer: "B",
    });
    expect(wrongMode.success).toBe(false);

    const plainRichOption = CreateQuestionRequestSchema.safeParse({
      ...RICH_TEXT_RESPONSE_CREATE,
      type: "single_choice",
      content: "q",
      contentDocument: null,
      options: [
        { id: "A", content: "3" },
        { id: "B", contentDocument: RICH_TEXT_RESPONSE_CREATE.contentDocument },
      ],
      standardAnswer: "B",
    });
    expect(plainRichOption.success).toBe(true);
    expect(
      CreateQuestionRequestSchema.safeParse({
        ...RICH_TEXT_RESPONSE_CREATE,
        type: "single_choice",
        content: "q",
        contentDocument: null,
        options: [{ id: "A", content: "3" }, { id: "B" }],
        standardAnswer: "B",
      }).success,
    ).toBe(false);
  });

  it("treats contentDocument null as explicit clear on update", () => {
    const clear = UpdateQuestionRequestSchema.safeParse({
      contentDocument: null,
      content: "back to plain",
    });
    expect(clear.success).toBe(true);
  });

  it("legacy snapshots without rich fields parse as Plain", () => {
    const legacy = {
      originalQuestionId: "q-1",
      type: "text_response",
      content: "plain prompt",
      attachments: [],
      options: [{ id: "A", content: "x" }],
      standardAnswer: null,
      score: 5,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
      rubric: null,
    };
    const parsed = QuestionSnapshotSchema.parse(legacy);
    expect(parsed.contentDocument).toBeNull();
    expect(parsed.answerMode).toBeNull();
    expect(parsed.options[0]?.contentDocument).toBeNull();
  });

  it("freezes rich fields on new snapshots", () => {
    const rich = {
      originalQuestionId: "q-1",
      type: "text_response",
      content: "projection",
      contentDocument: RICH_TEXT_RESPONSE_CREATE.contentDocument,
      answerMode: "rich",
      attachments: [],
      options: [
        {
          id: "A",
          content: "opt",
          contentDocument: RICH_TEXT_RESPONSE_CREATE.contentDocument,
        },
      ],
      standardAnswer: null,
      score: 5,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
      rubric: null,
    };
    const parsed = QuestionSnapshotSchema.parse(rich);
    expect(parsed.contentDocument).toEqual(rich.contentDocument);
    expect(parsed.answerMode).toBe("rich");
    expect(parsed.options[0]?.contentDocument).toEqual(rich.contentDocument);
  });
});

describe("ContentDocumentV1Schema — preflight-safe parse entry", () => {
  /**
   * Real recursive grammar bomb: doc → bulletList → listItem → bulletList →
   * listItem … to `depth` list levels, with a paragraph leaf. The grammar is
   * mutually recursive, so WITHOUT the iterative preflight the recursive
   * parser would overflow the stack on these. The public schema must reject
   * them with a controlled failure, never a RangeError.
   */
  function grammarBomb(depth: number): unknown {
    let block: Record<string, unknown> = {
      type: "paragraph",
      content: [{ type: "text", text: "leaf" }],
    };
    for (let i = 0; i < depth; i++) {
      block = {
        type: "bulletList",
        content: [{ type: "listItem", content: [block] }],
      };
    }
    return { docVersion: 1, type: "doc", content: [block] };
  }

  it("rejects a 500-level recursive grammar bomb in a controlled way (no RangeError), naming the structural limit", () => {
    const parsed = ContentDocumentV1Schema.safeParse(grammarBomb(500));
    expect(parsed.success).toBe(false);
    // The controlled rejection is the PREFLIGHT's, not a grammar mismatch —
    // the issue message names the structural limit.
    expect(parsed.error?.issues[0]?.message ?? "").toMatch(
      /nesting exceeds|depth exceeds|structural/,
    );
  });

  it("rejects the bomb inside a CreateQuestionRequestSchema body (Fastify validator path)", () => {
    const body = {
      ...RICH_TEXT_RESPONSE_CREATE,
      contentDocument: grammarBomb(500),
    };
    expect(() => CreateQuestionRequestSchema.safeParse(body)).not.toThrow();
    expect(CreateQuestionRequestSchema.safeParse(body).success).toBe(false);
  });

  it("accepts a within-limits document the removed raw-node budget used to reject (#673)", () => {
    // 677 plain paragraphs = 1354 grammar nodes < totalNodes(2000), ~41k
    // serialized chars < serializedChars: the measured minimal failure of
    // the Phase-C raw-node-budget campaign, now asserted at the PUBLIC
    // parse entry shared by route validation, read classification, and
    // client guards. Within-limit documents must never fail here.
    const legal = {
      docVersion: 1,
      type: "doc",
      content: Array.from({ length: 677 }, () => ({
        type: "paragraph",
        content: [{ type: "text", text: "0123456789".repeat(3) }],
      })),
    };
    const parsed = ContentDocumentV1Schema.safeParse(legal);
    expect(parsed.success).toBe(true);
  });

  describe("canonicalizeContentDocument (RC-03 closure seam)", () => {
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

    it("returns the RC-03 fixed point for legal input", () => {
      const legal = canonicalizeContentDocument(
        runsDocument([{ text: "x" }, { text: "y" }]),
      );
      expect(legal.ok).toBe(true);
      if (legal.ok) {
        expect(legal.value).toEqual(runsDocument([{ text: "xy" }]));
        expect(normalizeContentDocument(legal.value)).toEqual(legal.value);
      }
    });

    it("rejects the merge class on the canonical form with the limit violation", () => {
      // Two schema-valid unmarked runs whose merge is a 20001-char run:
      // rejected on the representation that would be persisted.
      const overMerge = canonicalizeContentDocument(
        runsDocument([
          { text: "a".repeat(CONTENT_LIMITS.textRun) },
          { text: "b" },
        ]),
      );
      expect(overMerge.ok).toBe(false);
      if (!overMerge.ok) {
        // The first canonical-limit issue names the textRun ceiling — via
        // the zod max message or the limits walker, both driven by
        // CONTENT_LIMITS.textRun.
        expect(overMerge.reason).toContain(String(CONTENT_LIMITS.textRun));
      }
    });
  });

  it("still accepts the deepest legal grammar document (7 nested lists = tree depth 16)", () => {
    let block: Record<string, unknown> = {
      type: "paragraph",
      content: [{ type: "text", text: "leaf" }],
    };
    for (let i = 0; i < 7; i++) {
      block = {
        type: "bulletList",
        content: [{ type: "listItem", content: [block] }],
      };
    }
    const parsed = ContentDocumentV1Schema.safeParse({
      docVersion: 1,
      type: "doc",
      content: [block],
    });
    expect(parsed.success).toBe(true);
  });
});

// ── Durable string representability (#669 Phase F / counterexample D-F01) ──
//
// The string-leaf intake owns the narrowing: an unrepresentable string must
// fail the schema (and therefore canonicalization) BEFORE any write seam can
// accept it, so canonicalization success implies durable representability.

describe("durable string representability (D-F01 closure)", () => {
  const NUL = "\u0000";
  const LONE_HIGH = "\uD800";
  const LONE_LOW = "\uDC00";

  function textDoc(text: string): ContentDocumentV1 {
    return doc([{ type: "paragraph", content: [{ type: "text", text }] }]);
  }

  it("rejects U+0000 and lone surrogates in a text run, with the shared reason", () => {
    for (const bad of [NUL, LONE_HIGH, LONE_LOW, `ok${NUL}ok`]) {
      const parsed = ContentDocumentV1Schema.safeParse(textDoc(bad));
      expect(parsed.success, JSON.stringify(bad)).toBe(false);
      if (!parsed.success) {
        expect(
          parsed.error.issues.some(
            (issue) => issue.message === RICH_STRING_UNREPRESENTABLE_MESSAGE,
          ),
          JSON.stringify(bad),
        ).toBe(true);
      }
    }
  });

  it("rejects unrepresentable strings in every free string leaf", () => {
    const corpus: unknown[] = [
      doc([{ type: "codeBlock", language: null, text: `x${NUL}` }]),
      doc([{ type: "blockMath", latex: `x${LONE_HIGH}` }]),
      doc([
        {
          type: "paragraph",
          content: [{ type: "inlineMath", latex: `${LONE_LOW}x` }],
        },
      ]),
    ];
    for (const value of corpus) {
      expect(
        ContentDocumentV1Schema.safeParse(value).success,
        JSON.stringify(value),
      ).toBe(false);
    }
  });

  it("codeBlock.language is excluded by the language grammar, not this rule", () => {
    const parsed = ContentDocumentV1Schema.safeParse(
      doc([{ type: "codeBlock", language: `a${NUL}b`, text: "x" }]),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) =>
          issue.message.includes("language grammar"),
        ),
      ).toBe(true);
      expect(
        parsed.error.issues.some(
          (issue) => issue.message === RICH_STRING_UNREPRESENTABLE_MESSAGE,
        ),
      ).toBe(false);
    }
  });

  it("accepts well-formed exotic scalars (CJK, paired emoji, U+FFFD)", () => {
    expect(
      ContentDocumentV1Schema.safeParse(textDoc("答案 🚀 \uFFFD")).success,
    ).toBe(true);
  });

  it("canonicalization never succeeds for an unrepresentable document", () => {
    const result = canonicalizeContentDocument(textDoc(NUL));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(RICH_STRING_UNREPRESENTABLE_MESSAGE);
    }
  });

  it("the question create wire schema rejects an unrepresentable rich prompt", () => {
    const parsed = CreateQuestionRequestSchema.safeParse({
      ...RICH_TEXT_RESPONSE_CREATE,
      contentDocument: textDoc(`prove ${NUL}`),
    });
    expect(parsed.success).toBe(false);
  });
});
