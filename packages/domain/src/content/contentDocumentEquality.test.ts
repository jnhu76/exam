import { describe, expect, it } from "vitest";
import {
  CONTENT_DOC_VERSION,
  contentDocumentsEqual,
  type ContentBlock,
  type ContentBulletList,
  type ContentDocumentV1,
  type ContentListItem,
  type ContentOrderedList,
  type ContentParagraph,
} from "./contentDocument.js";

/**
 * structural equality of canonical documents — moved from the web adapter
 * test suite when `contentDocumentsEqual` moved into the domain kernel (the
 * §18 equivalence authority), because the shared persisted-answer classifier
 * depends on it.
 *
 * The comparator is the editor ownership protocol's correctness boundary and
 * the read classifier's canonical-trust comparison: a prefix bug (iterating
 * only `a` and ignoring extra trailing elements of `b`) would classify
 * [A] == [A,B], skip a required external replacement, and accept a
 * noncanonical document as rich_valid.
 */
describe("contentDocumentsEqual — structural equality of canonical documents", () => {
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
    docVersion: CONTENT_DOC_VERSION,
    type: "doc",
    content,
  });
  const nestedItem = (
    ...blocks: Array<ContentParagraph | ContentBulletList | ContentOrderedList>
  ): ContentListItem => ({
    type: "listItem",
    content: blocks,
  });
  const mixed = (): ContentDocumentV1 =>
    doc([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "solve ", marks: ["bold"] },
          { type: "inlineMath", latex: "x^2" },
        ],
      },
      bullet(item("step")),
    ]);
  const firstTextRun = (d: ContentDocumentV1) =>
    (
      d.content[0] as {
        content: Array<{ text?: string; marks?: string[]; latex?: string }>;
      }
    ).content[0]!;

  it("is true for structurally identical canonical documents", () => {
    expect(contentDocumentsEqual(mixed(), mixed())).toBe(true);
    expect(
      contentDocumentsEqual(
        doc([table(row(cell("a"), cell("b")), row(cell("c"), cell("d")))]),
        doc([table(row(cell("a"), cell("b")), row(cell("c"), cell("d")))]),
      ),
    ).toBe(true);
  });

  it("is false when a text run, its marks, math, or list structure differs", () => {
    const textChanged = mixed();
    firstTextRun(textChanged).text = "solve";
    expect(contentDocumentsEqual(mixed(), textChanged)).toBe(false);

    const markShifted = mixed();
    firstTextRun(markShifted).marks = ["italic"];
    expect(contentDocumentsEqual(mixed(), markShifted)).toBe(false);

    const mathChanged = mixed();
    (
      (mathChanged.content[0] as { content: Array<{ latex?: string }> })
        .content[1] as { latex: string }
    ).latex = "y^2";
    expect(contentDocumentsEqual(mixed(), mathChanged)).toBe(false);

    const listItemAdded = mixed();
    (
      listItemAdded.content[1] as { content: Array<{ content: unknown[] }> }
    ).content[0]!.content.push({
      type: "paragraph",
      content: [{ type: "text", text: "extra" }],
    });
    expect(contentDocumentsEqual(mixed(), listItemAdded)).toBe(false);
  });

  it("is true for a codeBlock whose only difference is null vs undefined language (canonical both ways)", () => {
    const withCode = (language: string | null): ContentDocumentV1 => ({
      docVersion: CONTENT_DOC_VERSION,
      type: "doc",
      content: [{ type: "codeBlock", language, text: "let x = 1" }],
    });
    expect(contentDocumentsEqual(withCode("js"), withCode("js"))).toBe(true);
    expect(contentDocumentsEqual(withCode(null), withCode(null))).toBe(true);
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
