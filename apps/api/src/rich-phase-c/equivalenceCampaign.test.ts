/**
 * Phase-C Campaign C (#669) — normalization equivalence classes.
 *
 * Frozen semantics (contract §3.1): canonical equivalence is structural
 * identity after normalization, N(d1) == N(d2) — NOT visual output equality,
 * NOT plain-projection equality, NOT mathematical equivalence of formulas.
 *
 * Method: explicit equivalence pairs (must normalize to the same canonical
 * value) and non-equivalence pairs (must stay distinct). All comparisons run
 * the production normalizeContentDocument; equality is oracle-side structural
 * identity.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeContentDocument,
  type ContentDocumentV1,
  type ContentInline,
  type ContentMarkType,
} from "@exam/domain";
import { structuralEqual } from "./generators.js";

type Block = ContentDocumentV1["content"][number];

function doc(blocks: Block[]): ContentDocumentV1 {
  return { docVersion: 1, type: "doc", content: blocks };
}

/** Narrow paragraph builder — assignable both to Block and listItem content. */
function para(
  text: string,
  marks?: ContentMarkType[],
): {
  type: "paragraph";
  content: ContentInline[];
} {
  return {
    type: "paragraph",
    content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
  };
}

/** Canonical form of a schema-valid document, via the production normalizer. */
function canon(docValue: ContentDocumentV1): ContentDocumentV1 {
  return normalizeContentDocument(docValue);
}

describe("Phase-C Campaign C — normalization equivalence classes", () => {
  const equivalencePairs: Array<{
    name: string;
    d1: ContentDocumentV1;
    d2: ContentDocumentV1;
  }> = [
    {
      name: "adjacent plain split",
      d1: doc([para("ab")]),
      d2: doc([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "text", text: "b" },
          ],
        },
      ]),
    },
    {
      name: "adjacent same-mark split",
      d1: doc([para("ab", ["bold"])]),
      d2: doc([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: ["bold"] },
            { type: "text", text: "b", marks: ["bold"] },
          ],
        },
      ]),
    },
    {
      name: "mark order",
      d1: doc([para("x", ["bold", "italic"])]),
      d2: doc([para("x", ["italic", "bold"])]),
    },
    {
      name: "duplicate marks",
      d1: doc([para("x", ["bold"])]),
      d2: doc([para("x", ["bold", "bold", "bold"])]),
    },
    {
      name: "empty text run before content",
      d1: doc([para("a")]),
      d2: doc([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "" },
            { type: "text", text: "a" },
          ],
        },
      ]),
    },
    {
      name: "trailing empty paragraph",
      d1: doc([para("a")]),
      d2: doc([para("a"), { type: "paragraph", content: [] }]),
    },
    {
      name: "trailing empty paragraph with empty runs",
      d1: doc([para("a")]),
      d2: doc([
        para("a"),
        {
          type: "paragraph",
          content: [
            { type: "text", text: "" },
            { type: "text", text: "" },
          ],
        },
      ]),
    },
    {
      name: "trailing empty list item",
      d1: doc([
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [para("x")] }],
        },
      ]),
      d2: doc([
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [para("x")] },
            { type: "listItem", content: [{ type: "paragraph", content: [] }] },
          ],
        },
      ]),
    },
    {
      name: "trailing empty paragraph inside list item",
      d1: doc([
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [para("x")] }],
        },
      ]),
      d2: doc([
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [para("x"), { type: "paragraph", content: [] }],
            },
          ],
        },
      ]),
    },
    {
      name: "empty list is dropped",
      d1: doc([]),
      d2: doc([{ type: "bulletList", content: [] }]),
    },
    {
      name: "single empty paragraph is dropped",
      d1: doc([]),
      d2: doc([{ type: "paragraph", content: [] }]),
    },
    {
      name: "empty code language normalizes to null (invalid language cleared)",
      d1: doc([{ type: "codeBlock", language: null, text: "x" }]),
      d2: doc([{ type: "codeBlock", language: "not a language!", text: "x" }]),
    },
  ];

  it.each(equivalencePairs.map((p) => [p.name, p.d1, p.d2] as const))(
    "equivalent: %s",
    (_name, d1, d2) => {
      expect(structuralEqual(canon(d1), canon(d2))).toBe(true);
    },
  );

  const nonEquivalencePairs: Array<{
    name: string;
    d1: ContentDocumentV1;
    d2: ContentDocumentV1;
  }> = [
    {
      name: "bold vs plain",
      d1: doc([para("x", ["bold"])]),
      d2: doc([para("x")]),
    },
    {
      name: "inlineMath vs text with same source",
      d1: doc([
        { type: "paragraph", content: [{ type: "inlineMath", latex: "1/2" }] },
      ]),
      d2: doc([para("1/2")]),
    },
    {
      name: "blockMath vs paragraph inlineMath",
      d1: doc([{ type: "blockMath", latex: "x" }]),
      d2: doc([
        { type: "paragraph", content: [{ type: "inlineMath", latex: "x" }] },
      ]),
    },
    {
      name: "codeBlock vs paragraph with same text",
      d1: doc([{ type: "codeBlock", language: null, text: "x" }]),
      d2: doc([para("x")]),
    },
    {
      name: "codeBlock language ts vs null",
      d1: doc([{ type: "codeBlock", language: "ts", text: "x" }]),
      d2: doc([{ type: "codeBlock", language: null, text: "x" }]),
    },
    {
      name: "different LaTeX source (mathematically equal is NOT canonical identity)",
      d1: doc([{ type: "blockMath", latex: "\\frac12" }]),
      d2: doc([{ type: "blockMath", latex: "\\frac{1}{2}" }]),
    },
    {
      name: "table 1x2 vs 2x1",
      d1: doc([
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [para("a")] },
                { type: "tableCell", content: [para("b")] },
              ],
            },
          ],
        },
      ]),
      d2: doc([
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [{ type: "tableCell", content: [para("a")] }],
            },
            {
              type: "tableRow",
              content: [{ type: "tableCell", content: [para("b")] }],
            },
          ],
        },
      ]),
    },
    {
      name: "hardBreak vs none",
      d1: doc([
        {
          type: "paragraph",
          content: [{ type: "text", text: "a" }, { type: "hardBreak" }],
        },
      ]),
      d2: doc([para("a")]),
    },
    {
      name: "two paragraphs vs one merged paragraph (visual join is NOT identity)",
      d1: doc([para("a"), para("b")]),
      d2: doc([para("ab")]),
    },
    {
      name: "orderedList vs bulletList",
      d1: doc([
        {
          type: "orderedList",
          content: [{ type: "listItem", content: [para("x")] }],
        },
      ]),
      d2: doc([
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [para("x")] }],
        },
      ]),
    },
    {
      name: "middle empty paragraph is kept (only trailing empties are artifacts)",
      d1: doc([para("a"), { type: "paragraph", content: [] }, para("b")]),
      d2: doc([para("a"), para("b")]),
    },
    {
      name: "inlineCode vs plain (exclusive mark carries semantics)",
      d1: doc([para("x", ["inlineCode"])]),
      d2: doc([para("x")]),
    },
    {
      name: "underline vs italic",
      d1: doc([para("x", ["underline"])]),
      d2: doc([para("x", ["italic"])]),
    },
  ];

  it.each(nonEquivalencePairs.map((p) => [p.name, p.d1, p.d2] as const))(
    "distinct: %s",
    (_name, d1, d2) => {
      expect(structuralEqual(canon(d1), canon(d2))).toBe(false);
    },
  );

  it("mark exclusivity: inlineCode+bold input normalizes the exclusive resolution deterministically", () => {
    // The wire schema REJECTS inlineCode+bold, but normalize (declared
    // adapter-side resolution, #673 C3) resolves it deterministically.
    const combined: ContentDocumentV1 = doc([
      {
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: ["bold", "inlineCode"] }],
      },
    ]);
    expect(
      structuralEqual(canon(combined), canon(doc([para("x", ["bold"])]))),
    ).toBe(true);
  });

  it("equivalence closure sanity: canonically-equivalent inputs produce identical canonical values on both sides (determinism)", () => {
    for (const { d1, d2 } of equivalencePairs) {
      expect(structuralEqual(canon(canon(d1)), canon(canon(d2)))).toBe(true);
    }
  });
});
