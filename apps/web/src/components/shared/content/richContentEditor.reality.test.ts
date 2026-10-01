import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type {
  ContentBlock,
  ContentDocumentV1,
  ContentParagraph,
} from "@exam/domain";
import {
  contentDocumentToTiptap,
  tiptapToContentDocument,
} from "./contentAdapter";
import {
  richEditorExtensions,
  settleCursorAfterMathInsert,
} from "./RichContentEditor";

/**
 * Reality tests against the REAL production editor schema (#676). jsdom
 * cannot drive real keystrokes into ProseMirror — browser-level proof of the
 * same scenarios lives in apps/e2e/e2e/rich-content.spec.ts. Here every
 * document mutation goes through real Tiptap commands, which dispatch the
 * same transactions real input does.
 */

const LATEX = "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}";

function createEditor(content?: unknown): Editor {
  return new Editor({
    extensions: richEditorExtensions(),
    content: content ?? {
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    },
  });
}

function insertMath(editor: Editor, displayMode: boolean, latex: string) {
  editor
    .chain()
    .focus()
    .insertContent({
      type: displayMode ? "blockMath" : "inlineMath",
      attrs: { latex },
    })
    .run();
  // Production toolbar path: insertMath in RichContentEditor runs the same
  // settlement after every insert.
  settleCursorAfterMathInsert(editor);
}

const blockTypes = (editor: Editor) =>
  (editor.getJSON().content ?? []).map((node) => node.type);

/** narrows a possibly-undefined block to a paragraph (throws = test bug). */
function para0(block: ContentBlock | undefined): ContentParagraph {
  if (!block || block.type !== "paragraph")
    throw new Error("expected paragraph");
  return block;
}

describe("Tiptap math node reality (#676 — guards extension version drift)", () => {
  it("inline formula: insertContent emits an inlineMath node inside a paragraph", () => {
    const editor = createEditor();
    insertMath(editor, false, LATEX);
    const paragraph = editor.getJSON().content?.[0];
    expect(paragraph?.type).toBe("paragraph");
    expect(paragraph?.content?.[0]).toEqual({
      type: "inlineMath",
      attrs: { latex: LATEX },
    });
    editor.destroy();
  });

  it("block formula: insertContent emits a top-level blockMath atom with a latex attr", () => {
    const editor = createEditor();
    insertMath(editor, true, LATEX);
    // Recorded reality: the atom replaces the trailing empty paragraph, and
    // the settlement guard appends a paragraph so the caret has a textblock.
    expect(editor.getJSON().content?.[0]).toEqual({
      type: "blockMath",
      attrs: { latex: LATEX },
    });
    const selection = editor.state.selection;
    expect(selection instanceof NodeSelection).toBe(false);
    editor.destroy();
  });

  it("the production schema stays pinned to the Rich V1 grammar", () => {
    const editor = createEditor();
    // A node/mark added to the editor without an adapter mapping is the
    // #676-style silent-loss hazard; adding one must update this pin and the
    // adapter together.
    expect(Object.keys(editor.schema.nodes).sort()).toEqual(
      [
        "blockMath",
        "bulletList",
        "codeBlock",
        "doc",
        "hardBreak",
        "inlineMath",
        "listItem",
        "orderedList",
        "paragraph",
        "table",
        "tableCell",
        "tableHeader",
        "tableRow",
        "text",
      ].sort(),
    );
    expect(Object.keys(editor.schema.marks).sort()).toEqual(
      ["bold", "code", "italic", "underline"].sort(),
    );
    editor.destroy();
  });
});

describe("#676 regression — a visible blockMath survives the candidate's next edit", () => {
  it("block insert at document end, then an inline formula insert", () => {
    const editor = createEditor();
    insertMath(editor, true, LATEX);
    insertMath(editor, false, "a^2+b^2=c^2");
    const doc = tiptapToContentDocument(editor.getJSON());
    expect(doc.content.some((block) => block.type === "blockMath")).toBe(true);
    expect(
      doc.content.some(
        (block) =>
          block.type === "paragraph" &&
          block.content.some((inline) => inline.type === "inlineMath"),
      ),
    ).toBe(true);
    editor.destroy();
  });

  it("block insert at document end, then plain typing", () => {
    const editor = createEditor();
    insertMath(editor, true, LATEX);
    editor
      .chain()
      .focus()
      .insertContent({ type: "text", text: "证明完毕" })
      .run();
    const doc = tiptapToContentDocument(editor.getJSON());
    expect(doc.content.some((block) => block.type === "blockMath")).toBe(true);
    editor.destroy();
  });

  it("block insert into an empty paragraph, then an inline formula insert", () => {
    const editor = createEditor();
    insertMath(editor, true, LATEX);
    expect(blockTypes(editor)).toContain("blockMath");
    insertMath(editor, false, "E=mc^2");
    const doc = tiptapToContentDocument(editor.getJSON());
    expect(doc.content.some((block) => block.type === "blockMath")).toBe(true);
    editor.destroy();
  });

  it("mid-paragraph block insert keeps the paragraph split and the caret in a textblock", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "第一段" }] },
        { type: "paragraph", content: [{ type: "text", text: "第二段" }] },
      ],
    });
    editor.commands.setTextSelection(6);
    insertMath(editor, true, LATEX);
    expect(editor.state.selection instanceof NodeSelection).toBe(false);
    insertMath(editor, false, "a^2");
    const doc = tiptapToContentDocument(editor.getJSON());
    expect(doc.content.some((block) => block.type === "blockMath")).toBe(true);
    editor.destroy();
  });
});

describe("malformed LaTeX — bounded rendering, source preserved (#677 F1)", () => {
  it("malformed inline and block latex convert verbatim; nothing is dropped", () => {
    const editor = createEditor();
    insertMath(editor, false, "\\frac{");
    insertMath(editor, true, "{{{{{");
    const doc = tiptapToContentDocument(editor.getJSON());
    const paragraph = doc.content[0];
    expect(paragraph?.type === "paragraph" && paragraph.content[0]).toEqual({
      type: "inlineMath",
      latex: "\\frac{",
    });
    expect(doc.content[1]).toEqual({ type: "blockMath", latex: "{{{{{" });
    editor.destroy();
  });
});

describe("restore control — a reloaded document never opens with the atom selected", () => {
  it("setContent of a document ending in blockMath lands the caret in a textblock", () => {
    const editor = createEditor(
      contentDocumentToTiptap({
        docVersion: 1,
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "已保存" }] },
          { type: "blockMath", latex: "x^2" },
        ],
      }),
    );
    expect(editor.state.selection instanceof NodeSelection).toBe(false);
    editor.destroy();
  });
});

describe("schema ↔ adapter structural guard — no editor-emittable node is silently lost", () => {
  /**
   * Every node the production schema can emit, with the canonical type the
   * adapter must produce for it. tableHeader has a documented downgrade
   * (grammar tables are unspanned); everything else maps 1:1. If the editor
   * grammar grows, this table and the adapter must grow together — an
   * unmapped node makes tiptapToContentDocument throw (fail-safe) and these
   * cases fail.
   */
  const NODE_TO_CANONICAL: Record<string, string> = {
    paragraph: "paragraph",
    text: "text",
    hardBreak: "hardBreak",
    codeBlock: "codeBlock",
    bulletList: "bulletList",
    orderedList: "orderedList",
    listItem: "listItem",
    table: "table",
    tableRow: "tableRow",
    tableCell: "tableCell",
    tableHeader: "tableCell",
    blockMath: "blockMath",
    inlineMath: "inlineMath",
  };

  /** Minimal editor JSON instance of one schema node, in a valid document. */
  const NODE_INSTANCE: Record<string, JSONContent> = {
    // A trailing empty paragraph is canonicalized away (documented), so the
    // paragraph probe carries text like any real edited paragraph would.
    paragraph: {
      type: "paragraph",
      content: [{ type: "text", text: "x" }],
    },
    text: {
      type: "paragraph",
      content: [{ type: "text", text: "x" }],
    },
    hardBreak: {
      type: "paragraph",
      content: [{ type: "hardBreak" }],
    },
    codeBlock: {
      type: "codeBlock",
      attrs: { language: null },
      content: [{ type: "text", text: "code" }],
    },
    bulletList: {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "i" }] },
          ],
        },
      ],
    },
    orderedList: {
      type: "orderedList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "i" }] },
          ],
        },
      ],
    },
    listItem: {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "i" }] },
          ],
        },
      ],
    },
    table: {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "c" }] },
              ],
            },
          ],
        },
      ],
    },
    tableRow: {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "c" }] },
              ],
            },
          ],
        },
      ],
    },
    tableCell: {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "c" }] },
              ],
            },
          ],
        },
      ],
    },
    tableHeader: {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "h" }] },
              ],
            },
          ],
        },
      ],
    },
    blockMath: { type: "blockMath", attrs: { latex: "x^2" } },
    inlineMath: {
      type: "paragraph",
      content: [{ type: "inlineMath", attrs: { latex: "x^2" } }],
    },
  };

  it.each(Object.keys(NODE_TO_CANONICAL))(
    "editor node %s converts to canonical %s without silent loss",
    (nodeType) => {
      const editor = createEditor({ type: "doc", content: [] });
      const json = NODE_INSTANCE[nodeType];
      if (!json) throw new Error(`no instance fixture for ${nodeType}`);
      editor.commands.insertContent(json);
      settleCursorAfterMathInsert(editor);
      const canonical = tiptapToContentDocument(editor.getJSON());
      const expected = NODE_TO_CANONICAL[nodeType];
      const found = JSON.stringify(canonical).includes(`"type":"${expected}"`);
      expect(found).toBe(true);
      editor.destroy();
    },
  );

  it("every mark the schema can emit converts without silent loss", () => {
    const editor = createEditor();
    editor.commands.insertContent({
      type: "paragraph",
      content: [
        { type: "text", text: "b", marks: [{ type: "bold" }] },
        { type: "text", text: "i", marks: [{ type: "italic" }] },
        { type: "text", text: "u", marks: [{ type: "underline" }] },
        { type: "text", text: "c", marks: [{ type: "code" }] },
      ],
    });
    const doc = tiptapToContentDocument(editor.getJSON());
    const markSets = para0(doc.content[0]).content.map((inline) =>
      "marks" in inline ? inline.marks : undefined,
    );
    expect(markSets).toEqual([
      ["bold"],
      ["italic"],
      ["underline"],
      ["inlineCode"],
    ]);
    editor.destroy();
  });
});

describe("editor ⇄ canonical whole-grammar round trip", () => {
  const mixedDoc: ContentDocumentV1 = {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "解：", marks: ["bold"] },
          { type: "text", text: "设", marks: ["italic"] },
          { type: "text", text: "周长", marks: ["underline"] },
          { type: "text", text: "半径", marks: ["inlineCode"] },
          { type: "inlineMath", latex: "r=\\frac{C}{2\\pi}" },
          { type: "text", text: "，" },
          { type: "hardBreak" },
          { type: "text", text: "证毕。" },
        ],
      },
      {
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "步骤一" }],
              },
            ],
          },
        ],
      },
      { type: "codeBlock", language: "python", text: "print(1)\n" },
      { type: "blockMath", latex: "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}" },
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
                    content: [{ type: "text", text: "符号" }],
                  },
                ],
              },
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "值" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it("a mixed document restores into the real editor and converts back identically", () => {
    const editor = createEditor(contentDocumentToTiptap(mixedDoc));
    expect(tiptapToContentDocument(editor.getJSON())).toEqual(mixedDoc);
    editor.destroy();
  });

  it("inserting block math into that mixed document loses nothing", () => {
    const editor = createEditor(contentDocumentToTiptap(mixedDoc));
    editor.commands.setTextSelection(1);
    insertMath(editor, true, LATEX);
    const doc = tiptapToContentDocument(editor.getJSON());
    // The whole original grammar is still present…
    expect(tiptapToContentDocument(editor.getJSON())).toEqual({
      ...mixedDoc,
      content: [{ type: "blockMath", latex: LATEX }, ...mixedDoc.content],
    });
    expect(doc.content).toHaveLength(mixedDoc.content.length + 1);
    editor.destroy();
  });
});
