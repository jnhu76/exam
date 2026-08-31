import { describe, expect, it } from "vitest";
import { AnswerModeEnum, ContentDocumentV1Schema } from "../contentDocument.js";
import {
  CreateQuestionRequestSchema,
  UpdateQuestionRequestSchema,
} from "../question.js";
import { QuestionSnapshotSchema } from "../attempt.js";
import type { ContentDocumentV1 } from "@exam/domain";

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

  it("rejects a 500-level recursive grammar bomb in a controlled way (no RangeError)", () => {
    expect(() =>
      ContentDocumentV1Schema.safeParse(grammarBomb(500)),
    ).not.toThrow();
    expect(ContentDocumentV1Schema.safeParse(grammarBomb(500)).success).toBe(
      false,
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

  it("proves the preflight fired: the rejection names the structural limit, not a grammar mismatch", () => {
    const parsed = ContentDocumentV1Schema.safeParse(grammarBomb(500));
    const message = parsed.error?.issues[0]?.message ?? "";
    expect(message).toMatch(/nesting exceeds|depth exceeds|structural/);
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

  it("keeps null/undefined handling intact for the composed schema", () => {
    expect(ContentDocumentV1Schema.nullable().safeParse(null).success).toBe(
      true,
    );
    expect(ContentDocumentV1Schema.nullish().safeParse(undefined).success).toBe(
      true,
    );
  });
});
