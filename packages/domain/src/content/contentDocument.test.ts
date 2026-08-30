import { describe, expect, it } from "vitest";
import {
  CONTENT_DOC_VERSION,
  CONTENT_LIMITS,
  checkContentDocumentLimits,
  contentModeOf,
  normalizeContentDocument,
  plainTextProjection,
  plainTextToDocument,
  type ContentBlock,
  type ContentBulletList,
  type ContentDocumentV1,
  type ContentListItem,
  type ContentParagraph,
} from "./contentDocument.js";

function doc(...blocks: ContentBlock[]): ContentDocumentV1 {
  return { docVersion: CONTENT_DOC_VERSION, type: "doc", content: blocks };
}

function paragraph(text: string, marks?: string[]): ContentParagraph {
  return {
    type: "paragraph",
    content: [
      { type: "text", text, ...(marks ? { marks: marks as never[] } : {}) },
    ],
  };
}

function listItem(...children: ContentListItem["content"]): ContentListItem {
  return { type: "listItem", content: children };
}

describe("ContentDocumentV1 normalization", () => {
  it("accepts a minimal valid document", () => {
    const d = doc(paragraph("Hello"));
    expect(normalizeContentDocument(d)).toEqual(d);
    expect(checkContentDocumentLimits(d)).toEqual([]);
  });

  it("accepts a document containing every V1 node and mark", () => {
    const d = doc(
      {
        type: "paragraph",
        content: [
          { type: "text", text: "bold", marks: ["bold"] },
          { type: "text", text: "italic", marks: ["italic"] },
          { type: "text", text: "underline", marks: ["underline"] },
          { type: "text", text: "code", marks: ["inlineCode"] },
          { type: "hardBreak" },
          { type: "text", text: "after" },
          { type: "inlineMath", latex: "E=mc^2" },
        ],
      },
      {
        type: "bulletList",
        content: [
          listItem(paragraph("bullet one")),
          listItem(paragraph("nested"), {
            type: "orderedList",
            content: [listItem(paragraph("inner"))],
          }),
        ],
      },
      {
        type: "orderedList",
        content: [listItem(paragraph("ordered"))],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [paragraph("A1")] },
              { type: "tableCell", content: [paragraph("B1")] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [paragraph("A2")] },
              { type: "tableCell", content: [paragraph("B2")] },
            ],
          },
        ],
      },
      { type: "blockMath", latex: "\\int_0^1 x^2 dx" },
      { type: "codeBlock", language: "ts", text: "const x = 1;\n" },
    );
    expect(normalizeContentDocument(d)).toEqual(d);
    expect(checkContentDocumentLimits(d)).toEqual([]);
  });

  it("is idempotent: normalize(normalize(x)) equals normalize(x)", () => {
    const d = doc({
      type: "paragraph",
      content: [
        { type: "text", text: "a", marks: ["italic", "bold"] },
        { type: "text", text: "b", marks: ["bold", "italic"] },
        { type: "text", text: "" },
        { type: "text", text: "c", marks: ["bold"] },
      ],
    });
    const once = normalizeContentDocument(d);
    expect(normalizeContentDocument(once)).toEqual(once);
  });

  it("sorts marks into canonical order and dedupes", () => {
    const d = doc(paragraph("x", ["underline", "bold", "italic", "bold"]));
    expect(normalizeContentDocument(d)).toEqual(
      doc(paragraph("x", ["bold", "italic", "underline"])),
    );
  });

  it("merges adjacent text runs with identical marks", () => {
    const d: ContentDocumentV1 = {
      docVersion: CONTENT_DOC_VERSION,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "he", marks: ["bold"] },
            { type: "text", text: "llo", marks: ["bold"] },
            { type: "text", text: " world" },
          ],
        },
      ],
    };
    expect(normalizeContentDocument(d)).toEqual(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "hello", marks: ["bold"] },
          { type: "text", text: " world" },
        ],
      }),
    );
  });

  it("drops empty text runs, empty list items, empty lists, and trailing empty paragraphs", () => {
    const d: ContentDocumentV1 = {
      docVersion: CONTENT_DOC_VERSION,
      type: "doc",
      content: [
        paragraph("keep"),
        { type: "paragraph", content: [] },
        { type: "bulletList", content: [{ type: "listItem", content: [] }] },
      ],
    };
    expect(normalizeContentDocument(d)).toEqual(doc(paragraph("keep")));
  });

  it("preserves code block and math whitespace verbatim", () => {
    const d = doc(
      { type: "codeBlock", language: "py", text: "  indent\n    more\n\n" },
      { type: "blockMath", latex: "  x = {1 \\\\over 2}  " },
    );
    expect(normalizeContentDocument(d)).toEqual(d);
  });

  it("nulls out a codeBlock language that fails the bounded grammar", () => {
    const d = doc({ type: "codeBlock", language: "bad language!!", text: "x" });
    expect(normalizeContentDocument(d)).toEqual(
      doc({ type: "codeBlock", language: null, text: "x" }),
    );
  });

  it("throws on unknown block nodes (fail closed)", () => {
    const d = doc({ type: "image", content: [] } as unknown as ContentBlock);
    expect(() => normalizeContentDocument(d)).toThrow(/unknown block node/);
  });

  it("throws on an unsupported envelope", () => {
    expect(() =>
      normalizeContentDocument({
        ...doc(paragraph("x")),
        docVersion: 2 as never,
      }),
    ).toThrow(/unsupported document envelope/);
  });
});

describe("ContentDocumentV1 limits", () => {
  it("rejects oversized text runs, code, latex, and tables", () => {
    const oversized = doc(
      {
        type: "paragraph",
        content: [
          { type: "text", text: "x".repeat(CONTENT_LIMITS.textRun + 1) },
        ],
      },
      {
        type: "codeBlock",
        language: null,
        text: "y".repeat(CONTENT_LIMITS.codeBlock + 1),
      },
      { type: "blockMath", latex: "z".repeat(CONTENT_LIMITS.latex + 1) },
      {
        type: "table",
        content: Array.from({ length: CONTENT_LIMITS.tableRows + 1 }, () => ({
          type: "tableRow" as const,
          content: [{ type: "tableCell" as const, content: [paragraph("c")] }],
        })),
      },
    );
    const violations = checkContentDocumentLimits(oversized);
    expect(violations).toHaveLength(4);
    expect(violations[0]).toMatch(/text run/);
    expect(violations[1]).toMatch(/code block/);
    expect(violations[2]).toMatch(/latex/);
    expect(violations[3]).toMatch(/rows/);
  });

  it("rejects oversized serialized documents", () => {
    // Many max-length runs stack past the serialized ceiling without any
    // single run violating the per-run limit.
    const d = doc({
      type: "paragraph",
      content: Array.from({ length: 8 }, () => ({
        type: "text" as const,
        text: "a".repeat(CONTENT_LIMITS.textRun),
      })),
    });
    expect(checkContentDocumentLimits(d)).toEqual([
      expect.stringMatching(/serialized document/),
    ]);
  });

  it("rejects too many nodes and too-deep trees", () => {
    // Deep list nesting beyond listDepth (list → item → list per level).
    let list: ContentBulletList = {
      type: "bulletList",
      content: [listItem(paragraph("leaf"))],
    };
    for (let i = 0; i < CONTENT_LIMITS.listDepth + 2; i++) {
      list = { type: "bulletList", content: [listItem(list)] };
    }
    const violations = checkContentDocumentLimits(doc(list));
    expect(violations.join("\n")).toMatch(/list nesting/);

    // Node-count flood: many small paragraphs.
    const flood = doc(
      ...Array.from({ length: CONTENT_LIMITS.totalNodes + 1 }, () =>
        paragraph("x"),
      ),
    );
    expect(checkContentDocumentLimits(flood).join("\n")).toMatch(/nodes/);
  });
});

describe("plainTextProjection", () => {
  it("is deterministic and covers every node kind", () => {
    const d = doc(
      {
        type: "paragraph",
        content: [
          { type: "text", text: "line one" },
          { type: "hardBreak" },
          { type: "text", text: "line two" },
          { type: "inlineMath", latex: "a+b" },
        ],
      },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [paragraph("item 1")] },
          { type: "listItem", content: [paragraph("item 2")] },
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [paragraph("r1c1")] },
              { type: "tableCell", content: [paragraph("r1c2")] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [paragraph("r2c1")] },
              { type: "tableCell", content: [paragraph("r2c2")] },
            ],
          },
        ],
      },
      { type: "blockMath", latex: "E=mc^2" },
      { type: "codeBlock", language: "ts", text: "const x = 1;" },
    );
    const expected = [
      "line one\nline twoa+b",
      "item 1\nitem 2",
      "r1c1 r1c2\nr2c1 r2c2",
      "E=mc^2",
      "const x = 1;",
    ].join("\n");
    expect(plainTextProjection(d)).toBe(expected);
    expect(plainTextProjection(d)).toBe(
      plainTextProjection(normalizeContentDocument(d)),
    );
  });

  it("round-trips plain text through plainTextToDocument", () => {
    const text = "第一段\n\n第三段 with code: x=1";
    expect(plainTextProjection(plainTextToDocument(text))).toBe(text);
  });
});

describe("contentModeOf", () => {
  it("derives plain for null/undefined and rich otherwise", () => {
    expect(contentModeOf(null)).toBe("plain");
    expect(contentModeOf(undefined)).toBe("plain");
    expect(contentModeOf(doc(paragraph("x")))).toBe("rich");
  });
});
