import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentBulletList,
  ContentDocumentV1,
  ContentListItem,
  ContentOrderedList,
  ContentParagraph,
} from "@exam/domain";
import {
  contentDocumentToTiptap,
  contentDocumentsEqual,
  tiptapToContentDocument,
} from "./contentAdapter";

function doc(json: JSONContent[]): JSONContent {
  return { type: "doc", content: json };
}

const text = (t: string, marks?: string[]): JSONContent => ({
  type: "text",
  text: t,
  ...(marks ? { marks: marks.map((type) => ({ type })) } : {}),
});

const richDoc: ContentDocumentV1 = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        // NOTE: inlineCode is exclusive in the grammar — never combined with
        // other marks on one run (kernel normalize enforces this).
        { type: "text", text: "solve ", marks: ["bold"] },
        { type: "text", text: "x", marks: ["inlineCode"] },
        { type: "inlineMath", latex: "x^2-1=0" },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "step" }] },
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
    { type: "codeBlock", language: "python", text: "print(1)\n" },
    { type: "blockMath", latex: "\\int_0^1 x\\,dx" },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "a" }] },
              ],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [] }],
            },
          ],
        },
      ],
    },
  ],
};

/** narrows a possibly-undefined block to a paragraph (throws = test bug). */
function para0(
  block: ContentBlock | undefined,
): Extract<ContentBlock, { type: "paragraph" }> {
  if (!block || block.type !== "paragraph")
    throw new Error("expected paragraph");
  return block;
}

describe("contentDocumentToTiptap", () => {
  it("maps every grammar node into Tiptap JSON", () => {
    const json = contentDocumentToTiptap(richDoc);
    expect(json.type).toBe("doc");
    expect(json.content?.map((n) => n.type)).toEqual([
      "paragraph",
      "bulletList",
      "codeBlock",
      "blockMath",
      "table",
    ]);
    const para = json.content?.[0];
    expect(para?.content?.[0]?.marks).toEqual([{ type: "bold" }]);
    expect(para?.content?.[1]?.marks).toEqual([{ type: "code" }]);
    expect(para?.content?.[2]?.attrs).toEqual({ latex: "x^2-1=0" });
    expect(json.content?.[2]?.attrs).toEqual({ language: "python" });
  });

  it("round-trips through tiptapToContentDocument to the identical canonical doc", () => {
    const json = contentDocumentToTiptap(richDoc);
    expect(tiptapToContentDocument(json)).toEqual(richDoc);
  });
});

describe("tiptapToContentDocument", () => {
  it("downgrades the code mark to inlineCode; kernel exclusivity drops code when combined", () => {
    const out = tiptapToContentDocument(
      doc([
        {
          type: "paragraph",
          content: [
            // Tiptap's code mark normally excludes others natively; a hit
            // here (paste/import) resolves per the kernel: inlineCode yields.
            text("x", ["code", "bold", "italic", "underline"]),
          ],
        },
        {
          type: "paragraph",
          content: [text("y", ["code"])],
        },
      ]),
    );
    const p0 = para0(out.content[0]);
    const p1 = para0(out.content[1]);
    expect((p0.content[0] as { marks?: string[] }).marks).toEqual([
      "bold",
      "italic",
      "underline",
    ]);
    expect((p1.content[0] as { marks?: string[] }).marks).toEqual([
      "inlineCode",
    ]);
  });

  it("downgrades tableHeader cells to tableCell and drops span attrs", () => {
    const out = tiptapToContentDocument(
      doc([
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 2, rowspan: 3, colwidth: [100, 100] },
                  content: [
                    {
                      type: "paragraph",
                      content: [text("head")],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    const table = out.content[0];
    if (!table || table.type !== "table") throw new Error("expected table");
    const cell = table.content[0]?.content[0];
    expect(cell?.type).toBe("tableCell");
    expect(cell).not.toHaveProperty("attrs");
  });

  it("nulls a codeBlock language outside the kernel pattern", () => {
    const out = tiptapToContentDocument(
      doc([
        {
          type: "codeBlock",
          attrs: { language: "bad lang!!" },
          content: [text("x")],
        },
        { type: "codeBlock", attrs: { language: "c++" }, content: [text("y")] },
      ]),
    );
    expect(out.content[0]).toEqual({
      type: "codeBlock",
      language: null,
      text: "x",
    });
    expect(out.content[1]).toEqual({
      type: "codeBlock",
      language: "c++",
      text: "y",
    });
  });

  it("downgrades off-grammar blocks inside list items", () => {
    const out = tiptapToContentDocument(
      doc([
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "codeBlock",
                  attrs: { language: "js" },
                  content: [text("code()")],
                },
                {
                  type: "blockMath",
                  attrs: { latex: "E=mc^2" },
                },
              ],
            },
          ],
        },
      ]),
    );
    const list = out.content[0];
    if (!list || list.type !== "bulletList")
      throw new Error("expected bulletList");
    const item = list.content[0];
    if (!item) throw new Error("expected list item");
    expect(item.content.map((c) => c.type)).toEqual(["paragraph", "paragraph"]);
    const mathPara = para0(item.content[1]);
    expect(mathPara.content[0]).toEqual({
      type: "inlineMath",
      latex: "E=mc^2",
    });
  });

  it("throws on nodes outside the grammar (fail-safe, allow-list makes it unreachable)", () => {
    expect(() =>
      tiptapToContentDocument(doc([{ type: "image", attrs: { src: "x" } }])),
    ).toThrow(/unmappable block node: image/);
  });

  it("normalizes transient editor output (drops empty runs, keeps distinct-mark runs separate)", () => {
    const out = tiptapToContentDocument(
      doc([
        {
          type: "paragraph",
          content: [
            text("ans"),
            text("wer", ["bold"]),
            text(""), // empty run — dropped
            { type: "hardBreak" },
          ],
        },
        { type: "paragraph", content: [] }, // trailing empty — dropped by normalize
      ]),
    );
    expect(out.content).toHaveLength(1);
    const para = para0(out.content[0]);
    expect(para.content).toEqual([
      { type: "text", text: "ans" },
      { type: "text", text: "wer", marks: ["bold"] },
      { type: "hardBreak" },
    ]);
  });
});

describe("contentDocumentsEqual — editor two-way ownership sync (#301 corrective pass)", () => {
  // Canonical documents, the shape the editor emits and the parent echoes.
  function canonicalDoc(): ContentDocumentV1 {
    return {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "solve ", marks: ["bold"] },
            { type: "inlineMath", latex: "x^2" },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "step" }],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  it("is true for structurally identical canonical documents", () => {
    expect(contentDocumentsEqual(canonicalDoc(), canonicalDoc())).toBe(true);
  });

  it("is false when a text run or its marks differ", () => {
    const other = canonicalDoc();
    (
      other.content[0] as { content: Array<{ text?: string }> }
    ).content[0]!.text = "solve";
    expect(contentDocumentsEqual(canonicalDoc(), other)).toBe(false);

    const markShifted = canonicalDoc();
    const marks = (
      markShifted.content[0] as { content: Array<{ marks?: string[] }> }
    ).content[0];
    marks!.marks = ["italic"];
    expect(contentDocumentsEqual(canonicalDoc(), markShifted)).toBe(false);
  });

  it("is false when math, code, block math, or list structure differs", () => {
    const math = canonicalDoc();
    (
      math.content[0] as { content: Array<{ latex?: string }> }
    ).content[1]!.latex = "y^2";
    expect(contentDocumentsEqual(canonicalDoc(), math)).toBe(false);

    const listItemAdded = canonicalDoc();
    (
      listItemAdded.content[1] as { content: Array<{ content: unknown[] }> }
    ).content[0]!.content.push({
      type: "paragraph",
      content: [{ type: "text", text: "extra" }],
    });
    expect(contentDocumentsEqual(canonicalDoc(), listItemAdded)).toBe(false);
  });

  it("is true for a codeBlock whose only difference is null vs undefined language (canonical both ways)", () => {
    const withCode = (language: string | null): ContentDocumentV1 => ({
      docVersion: 1,
      type: "doc",
      content: [{ type: "codeBlock", language, text: "let x = 1" }],
    });
    expect(contentDocumentsEqual(withCode("js"), withCode("js"))).toBe(true);
    expect(contentDocumentsEqual(withCode(null), withCode(null))).toBe(true);
  });
});

describe("contentDocumentsEqual — collection-length equality (corrective pass)", () => {
  // The comparator is the editor ownership protocol's correctness boundary: a
  // prefix bug (iterating only `a` and ignoring extra trailing elements of `b`)
  // would classify [A] == [A,B] and skip a required external replacement. Every
  // collection in the grammar must compare full lengths, both directions.

  const item = (text: string): ContentListItem => ({
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const bullet = (...items: ContentListItem[]): ContentBulletList => ({
    type: "bulletList",
    content: items,
  });
  const ordered = (...items: ContentListItem[]): ContentOrderedList => ({
    type: "orderedList",
    content: items,
  });
  const cell = (text: string) => ({
    type: "tableCell" as const,
    content: [
      {
        type: "paragraph" as const,
        content: [{ type: "text" as const, text }],
      },
    ],
  });
  const row = (...cells: ReturnType<typeof cell>[]) => ({
    type: "tableRow" as const,
    content: cells,
  });
  const table = (...rows: ReturnType<typeof row>[]): ContentBlock => ({
    type: "table",
    content: rows,
  });
  const doc = (content: ContentBlock[]): ContentDocumentV1 => ({
    docVersion: 1,
    type: "doc",
    content,
  });
  const nestedItem = (
    ...blocks: Array<ContentParagraph | ContentBulletList | ContentOrderedList>
  ): ContentListItem => ({
    type: "listItem",
    content: blocks,
  });

  it.each([
    ["bullet list item count", bullet(item("a")), bullet(item("a"), item("b"))],
    [
      "ordered list item count",
      ordered(item("a")),
      ordered(item("a"), item("b")),
    ],
    [
      "table row count",
      table(row(cell("a"))),
      table(row(cell("a")), row(cell("b"))),
    ],
    [
      "table cell count",
      table(row(cell("a"))),
      table(row(cell("a"), cell("b"))),
    ],
    [
      "nested list item count",
      bullet(nestedItem(bullet(item("a")))),
      bullet(nestedItem(bullet(item("a"), item("b")))),
    ],
  ])("rejects a trailing extra element: %s ([A] != [A,B])", (_name, a, b) => {
    expect(contentDocumentsEqual(doc([a]), doc([b]))).toBe(false);
    // Symmetric: [A,B] != [A] too — length is compared on both sides.
    expect(contentDocumentsEqual(doc([b]), doc([a]))).toBe(false);
  });

  it("keeps equal-length collections with identical elements equal", () => {
    expect(
      contentDocumentsEqual(
        doc([bullet(item("a"), item("b"))]),
        doc([bullet(item("a"), item("b"))]),
      ),
    ).toBe(true);
    expect(
      contentDocumentsEqual(
        doc([table(row(cell("a"), cell("b")), row(cell("c"), cell("d")))]),
        doc([table(row(cell("a"), cell("b")), row(cell("c"), cell("d")))]),
      ),
    ).toBe(true);
  });

  it("is symmetric over representative canonical docs (equal(a,b) == equal(b,a))", () => {
    const pairs: Array<[ContentDocumentV1, ContentDocumentV1]> = [
      [doc([bullet(item("x"))]), doc([bullet(item("x"))])],
      [doc([bullet(item("x"))]), doc([bullet(item("x")), bullet(item("y"))])],
      [
        doc([ordered(item("1")), ordered(item("1"), item("2"))]),
        doc([ordered(item("1")), ordered(item("2"))]),
      ],
      [
        doc([table(row(cell("a")), row(cell("b"), cell("c")))]),
        doc([table(row(cell("a"), cell("b")))]),
      ],
      [
        doc([bullet(nestedItem(bullet(item("inner")), ordered(item("deep"))))]),
        doc([{ type: "paragraph", content: [{ type: "text", text: "tail" }] }]),
      ],
    ];
    for (const [a, b] of pairs) {
      expect(contentDocumentsEqual(a, b)).toBe(contentDocumentsEqual(b, a));
    }
  });
});
