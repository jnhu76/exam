import { describe, expect, it } from "vitest";
import {
  CONTENT_DOC_VERSION,
  CONTENT_LIMITS,
  checkContentDocumentLimits,
  isDurableRichString,
  normalizeContentDocument,
  plainTextProjection,
  plainTextToDocument,
  preflightContentDocumentStructure,
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

describe("preflightContentDocumentStructure", () => {
  it("accepts a grammar-valid document", () => {
    expect(preflightContentDocumentStructure(doc(paragraph("hello")))).toEqual(
      [],
    );
  });

  it("rejects a non-envelope value", () => {
    expect(preflightContentDocumentStructure("plain")).not.toEqual([]);
    expect(preflightContentDocumentStructure(42)).not.toEqual([]);
    expect(preflightContentDocumentStructure({ type: "doc" })).not.toEqual([]);
    expect(
      preflightContentDocumentStructure({
        docVersion: 2,
        type: "doc",
        content: [],
      }),
    ).not.toEqual([]);
  });

  function nestedArrays(depth: number): unknown {
    let node: unknown = "leaf";
    for (let i = 0; i < depth; i++) node = [node];
    return { docVersion: 1, type: "doc", content: node };
  }

  it("rejects hostile nesting without recursing (controlled violations, no stack overflow)", () => {
    // 1000 levels is far past any legal document and would overflow a
    // recursive walk; the iterative preflight must reject it in bounded time.
    const violations = preflightContentDocumentStructure(nestedArrays(1000));
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.includes("nesting exceeds"))).toBe(true);
  });

  it("rejects a serialized-oversized array fan-out at the serialization gate", () => {
    // 200k empty objects serialize to ~600k chars — past serializedChars —
    // so the value is rejected before the raw walk runs. The walk itself is
    // inherently bounded: every raw JSON value costs at least one serialized
    // character, so a payload that passes the size gate cannot make the walk
    // visit more than CONTENT_LIMITS.serializedChars units.
    const hostile = {
      docVersion: 1,
      type: "doc",
      content: new Array(200_000).fill(0).map(() => ({})),
    };
    const violations = preflightContentDocumentStructure(hostile);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("stops at the serialization gate — an oversized payload never enters the raw walk", () => {
    // Oversized AND deeper than the raw depth budget: if the walk ran, it
    // would append a "nesting exceeds" violation on top of the size one.
    // The gate's verdict is final, so the serialized-size violation must be
    // the ONLY one — proving the hostile structure was never traversed.
    let bomb: unknown = "x".repeat(200_000);
    for (let i = 0; i < 50; i++) bomb = [bomb];
    const hostile = { docVersion: 1, type: "doc", content: bomb };
    expect(preflightContentDocumentStructure(hostile)).toEqual([
      `serialized document exceeds ${CONTENT_LIMITS.serializedChars} chars`,
    ]);
  });

  it("rejects a cyclic structure instead of throwing", () => {
    const cyclic: Record<string, unknown> = { docVersion: 1, type: "doc" };
    cyclic["self"] = cyclic;
    expect(() => preflightContentDocumentStructure(cyclic)).not.toThrow();
    expect(
      preflightContentDocumentStructure(cyclic).some((v) =>
        v.includes("JSON-representable"),
      ),
    ).toBe(true);
  });

  it("accepts a deep-but-legal document (depth-limited list nesting) far below the preflight budget", () => {
    // Each nested list consumes two tree levels (list + listItem), so the
    // depth limit (16) binds before the listDepth limit: 7 nested lists put
    // the leaf paragraph at depth 15 — the deepest legal document. The raw
    // walk sees it ~2 levels higher and must still accept it with room to
    // spare against the hostile-depth budget.
    let node: ContentBlock = paragraph("leaf");
    for (let i = 0; i < 7; i++) {
      node = {
        type: "bulletList",
        content: [{ type: "listItem", content: [node as never] }],
      };
    }
    const legal = doc(node);
    expect(checkContentDocumentLimits(legal)).toEqual([]);
    expect(preflightContentDocumentStructure(legal)).toEqual([]);
  });

  // ── RC-04 / PC-F02 regressions (#669 Phase D1; evidence #686) ─────
  //
  // Phase C (#673 C1) proved the preflight raw-walk node budget rejected
  // documents CONTENT_LIMITS accepts: every object, array, and scalar
  // string counted as one raw unit, so legal documents at ~30% of the
  // serialized budget and well under totalNodes failed with "document
  // exceeds 4064 structural nodes". The fixtures below are the measured
  // failure scales of that campaign, kept fixed and deterministic. The
  // invariant: within authoritative CONTENT_LIMITS ⇒ preflight accepts.

  it("accepts within-limits documents the raw-node budget used to reject (#673)", () => {
    // Plain runs: 700 paragraphs = 1400 grammar nodes < totalNodes.
    const plainRuns = doc(
      ...Array.from({ length: 700 }, () =>
        paragraph("012345678901234567890123456789"),
      ),
    );
    expect(checkContentDocumentLimits(plainRuns)).toEqual([]);
    expect(preflightContentDocumentStructure(plainRuns)).toEqual([]);

    // Fully marked runs: 500 paragraphs = 1000 grammar nodes; every mark
    // string is a raw unit the old budget charged against the document.
    const markedRuns = doc(
      ...Array.from({ length: 500 }, () =>
        paragraph("01234567890123456789", [
          "bold",
          "italic",
          "underline",
        ] as never[]),
      ),
    );
    expect(checkContentDocumentLimits(markedRuns)).toEqual([]);
    expect(preflightContentDocumentStructure(markedRuns)).toEqual([]);

    // Duplicate marks: 12 repeated "bold" marks per run pass the schema
    // (only inlineCode exclusivity is restricted) and normalization dedups
    // them — 300 paragraphs of this shape are grammar-legal and were
    // rejected purely by raw-unit accounting.
    const duplicateMarks = doc(
      ...Array.from({ length: 300 }, () =>
        paragraph("01234567890123456789", Array(12).fill("bold") as never[]),
      ),
    );
    expect(checkContentDocumentLimits(duplicateMarks)).toEqual([]);
    expect(preflightContentDocumentStructure(duplicateMarks)).toEqual([]);

    // Empty paragraphs: pure container overhead, one third of a raw unit
    // per grammar node.
    const emptyParagraphs = doc(
      ...Array.from({ length: 1400 }, () => ({
        type: "paragraph" as const,
        content: [],
      })),
    );
    expect(checkContentDocumentLimits(emptyParagraphs)).toEqual([]);
    expect(preflightContentDocumentStructure(emptyParagraphs)).toEqual([]);

    // Marked table: 16 rows × 20 cells = 320 cells ≤ tableCells, 977
    // grammar nodes < totalNodes.
    const markedTable = doc({
      type: "table",
      content: Array.from({ length: 16 }, () => ({
        type: "tableRow" as const,
        content: Array.from({ length: 20 }, () => ({
          type: "tableCell" as const,
          content: [
            paragraph("0123456789", ["bold", "italic", "underline"] as never[]),
          ],
        })),
      })),
    });
    expect(checkContentDocumentLimits(markedTable)).toEqual([]);
    expect(preflightContentDocumentStructure(markedTable)).toEqual([]);
  });

  it("leaves node-count rejection to the limits authority, not preflight (RC-04 boundary)", () => {
    // 1100 paragraphs × 2 runs = 2200 grammar nodes > totalNodes(2000),
    // ~105k serialized chars < serializedChars: the only authority that
    // rejects this document is CONTENT_LIMITS — preflight must stay clean
    // so the schema's own limit walker produces the violation.
    const overNodeBudget = doc(
      ...Array.from({ length: 1100 }, () => ({
        type: "paragraph" as const,
        content: [
          { type: "text" as const, text: "abcde" },
          { type: "text" as const, text: "fghij" },
        ],
      })),
    );
    expect(preflightContentDocumentStructure(overNodeBudget)).toEqual([]);
    expect(
      checkContentDocumentLimits(overNodeBudget).some((violation) =>
        violation.includes("nodes"),
      ),
    ).toBe(true);
  });
});

// ── Durable string representability ──
//
// The Rich string domain is narrower than "any JS string": the durable
// platform (PostgreSQL jsonb/text over UTF-8) holds exactly the well-formed
// Unicode scalar values minus U+0000. Authority acceptance must imply
// durable representability.

describe("durable string representability (isDurableRichString)", () => {
  it("accepts well-formed Unicode scalar values", () => {
    for (const s of [
      "plain ascii",
      "中文试卷",
      "paired emoji 🚀",
      "\uFFFD replacement character",
      "combining e\u0301",
      "tab\tand\nnewline",
      "",
    ]) {
      expect(isDurableRichString(s), JSON.stringify(s)).toBe(true);
    }
  });

  it("rejects U+0000 in every position", () => {
    for (const s of ["\u0000", "a\u0000b", "trailing\u0000"]) {
      expect(isDurableRichString(s), JSON.stringify(s)).toBe(false);
    }
  });

  it("rejects lone surrogates in every position", () => {
    for (const s of [
      "\uD800", // lone high
      "\uDC00", // lone low
      "a\uD800b", // high mid-string
      "a\uDC00b", // low mid-string
      "end\uD83D", // high at end
      "\uD800A", // high followed by a non-low
      "a\uDC00", // low at end
    ]) {
      expect(isDurableRichString(s), JSON.stringify(s)).toBe(false);
    }
  });

  it("accepts properly paired surrogates adjacent to other text", () => {
    for (const s of ["a🚀b", "\uD83D\uDE00", "\uD83D\uDE00\uD83D\uDE00"]) {
      expect(isDurableRichString(s), JSON.stringify(s)).toBe(true);
    }
  });
});
