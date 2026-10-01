import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  DOMParser as ProseMirrorDOMParser,
  Node as ProseMirrorNode,
} from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
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
  settleImplicitMathSelection,
} from "./RichContentEditor";

/**
 * Reality tests against the REAL production editor schema (#676). jsdom
 * cannot drive real keystrokes into ProseMirror — browser-level proof of the
 * same scenarios lives in apps/e2e/e2e/rich-content.spec.ts. Here every
 * document mutation goes through real Tiptap commands, which dispatch the
 * same transactions real input does.
 */

const LATEX = "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}";

const liveEditors: Editor[] = [];

function createEditor(content?: unknown): Editor {
  const editor = new Editor({
    extensions: richEditorExtensions(),
    content: content ?? {
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    },
  });
  liveEditors.push(editor);
  return editor;
}

// A failing test must not leak a live ProseMirror view into later tests —
// document-level listener pollution can mask or mimic downstream failures.
afterEach(() => {
  for (const editor of liveEditors) {
    if (!editor.isDestroyed) editor.destroy();
  }
  liveEditors.length = 0;
});

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
  settleImplicitMathSelection(editor);
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

  it("consecutive blockMath: re-inserting over a selected atom keeps the caret off its neighbour", () => {
    // Persisted reality: successive toolbar inserts leave adjacent blockMath
    // nodes (the paragraphs between them are canonicalized away), so a
    // restored document can have another atom directly after the selection.
    // A plain near() would land the caret ON that neighbour atom and the
    // next inline input would destroy it — the #676 mechanism one position
    // over.
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "blockMath", attrs: { latex: "x^2" } },
        { type: "blockMath", attrs: { latex: "y^2" } },
      ],
    });
    editor
      .chain()
      .command(({ tr, dispatch }) => {
        if (dispatch) tr.setSelection(NodeSelection.create(tr.doc, 0));
        return true;
      })
      .run();
    // Raw insertContent without focus() so the NodeSelection precondition is
    // deterministic in jsdom.
    editor.commands.insertContent({
      type: "blockMath",
      attrs: { latex: LATEX },
    });
    settleImplicitMathSelection(editor);
    expect(editor.state.selection instanceof NodeSelection).toBe(false);
    editor.commands.insertContent({ type: "text", text: "续" });
    const maths = (editor.getJSON().content ?? [])
      .filter((block) => block.type === "blockMath")
      .map((block) => block.attrs?.latex);
    expect(maths).toEqual([LATEX, "y^2"]);
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

describe("C12 restore — a draft must never open ordinary typing onto a selected formula", () => {
  /**
   * Persisted reality: the canonical normalizer strips paragraphs between
   * successive toolbar inserts, so drafts genuinely exist with the shape
   * [blockMath…]. Editor creation and authoritative setContent adopt such a
   * document with `Selection.atStart`, which NodeSelects the first atom —
   * and ProseMirror replaces a selected atom with the next inline input, so
   * the candidate's first keystroke destroyed the formula (C12). The
   * component normalizes both restore paths through
   * settleImplicitMathSelection (quiet: establishing the caret must not
   * itself trigger a save); these tests exercise the exact production
   * schema and call it the same way.
   */
  const shapes: Array<{
    name: string;
    latexes: string[];
    trailingProse: boolean;
  }> = [
    { name: "[blockMath]", latexes: ["x^2"], trailingProse: false },
    {
      name: "[blockMath, blockMath]",
      latexes: ["x^2", "y^2"],
      trailingProse: false,
    },
    {
      name: "[blockMath, blockMath, blockMath]",
      latexes: ["x^2", "y^2", "z^2"],
      trailingProse: false,
    },
    {
      name: "[paragraph, blockMath]",
      latexes: ["y^2"],
      trailingProse: true,
    },
    {
      name: "[blockMath, paragraph]",
      latexes: ["x^2"],
      trailingProse: true,
    },
  ];

  /**
   * [paragraph, blockMath] needs the formula AFTER a prose paragraph and
   * [blockMath, paragraph] BEFORE it; build those two explicitly instead of
   * over-generalizing a builder.
   */
  function shapeContent(
    shape: (typeof shapes)[number],
  ): Parameters<typeof contentDocumentToTiptap>[0] {
    switch (shape.name) {
      case "[paragraph, blockMath]":
        return {
          docVersion: 1,
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "前文" }] },
            { type: "blockMath", latex: shape.latexes[0]! },
          ],
        };
      case "[blockMath, paragraph]":
        return {
          docVersion: 1,
          type: "doc",
          content: [
            { type: "blockMath", latex: shape.latexes[0]! },
            { type: "paragraph", content: [{ type: "text", text: "后文" }] },
          ],
        };
      default:
        return {
          docVersion: 1,
          type: "doc",
          content: shape.latexes.map((latex) => ({
            type: "blockMath" as const,
            latex,
          })),
        };
    }
  }

  function assertSafeRestoredState(editor: Editor, latexes: string[]) {
    // The restore normalization must not leave an implicitly selected atom…
    expect(editor.state.selection instanceof NodeSelection).toBe(false);
    expect(editor.state.selection instanceof TextSelection).toBe(true);
    // …and ordinary typing right after restore must not destroy any formula.
    editor.commands.insertContent({ type: "text", text: "答" });
    const survivingLatexes = (editor.getJSON().content ?? [])
      .filter((block) => block.type === "blockMath")
      .map((block) => block.attrs?.latex);
    expect(survivingLatexes).toEqual(latexes);
  }

  it.each(shapes)(
    "$name: initial editor creation is safe to type into",
    (shape) => {
      const editor = createEditor(contentDocumentToTiptap(shapeContent(shape)));
      settleImplicitMathSelection(editor, { quiet: true });
      assertSafeRestoredState(editor, shape.latexes);
      editor.destroy();
    },
  );

  it.each(shapes)(
    "$name: authoritative setContent replacement is safe to type into",
    (shape) => {
      const editor = createEditor();
      // Authoritative external replacement (draft restore, server
      // reconciliation): emitUpdate:false, then the component settles the
      // selection the same quiet way.
      editor.commands.setContent(contentDocumentToTiptap(shapeContent(shape)), {
        emitUpdate: false,
      });
      settleImplicitMathSelection(editor, { quiet: true });
      assertSafeRestoredState(editor, shape.latexes);
      editor.destroy();
    },
  );

  it("quiet restore settlement fires no update — establishing the caret never autosaves", () => {
    let updates = 0;
    const editor = new Editor({
      extensions: richEditorExtensions(),
      content: {
        type: "doc",
        content: [
          { type: "blockMath", attrs: { latex: "x^2" } },
          { type: "blockMath", attrs: { latex: "y^2" } },
        ],
      },
      onUpdate: () => {
        updates += 1;
      },
    });
    liveEditors.push(editor);
    settleImplicitMathSelection(editor, { quiet: true });
    expect(updates).toBe(0);
    // The landing paragraph exists editor-side as a typing target…
    expect(blockTypes(editor)).toEqual(["blockMath", "blockMath", "paragraph"]);
    // …and canonicalizes away (trailing empty paragraph), so the next real
    // edit emits exactly the persisted draft plus the typed content.
    const canonical = tiptapToContentDocument(editor.getJSON());
    expect(canonical.content.map((block) => block.type)).toEqual([
      "blockMath",
      "blockMath",
    ]);
    // Contrast on a second editor: the non-quiet toolbar path DOES emit —
    // the spy works and the quiet restore path is the exception, not a
    // broken listener.
    const toolbarEditor = new Editor({
      extensions: richEditorExtensions(),
      content: {
        type: "doc",
        content: [
          { type: "blockMath", attrs: { latex: "x^2" } },
          { type: "blockMath", attrs: { latex: "y^2" } },
        ],
      },
      onUpdate: () => {
        updates += 1;
      },
    });
    liveEditors.push(toolbarEditor);
    settleImplicitMathSelection(toolbarEditor);
    expect(updates).toBe(1);
  });
});

describe("C13 paste/drop boundary — operation-produced math selections normalize", () => {
  /**
   * prosemirror-view parses pasted/dropped text/html through the schema's
   * parse rules (parseFromClipboard); the editor's own copy serialization is
   * the schema toDOM (data-type + data-latex), so copying a formula within
   * the editor produces HTML that pastes back as a math atom. jsdom cannot
   * deliver real clipboard/drag DOM events (no DataTransfer, no layout for
   * posAtCoords), so each probe replays the exact transaction the view
   * builds at that boundary — the dispatch lines mirror prosemirror-view's
   * doPaste/handleDrop — and asserts the production plugin normalized the
   * result. The real-event layer is proven in
   * apps/e2e/e2e/rich-content.spec.ts.
   */

  /** The single-node fast path doPaste takes (sliceSingleNode). */
  function nodeFromClipboardHtml(editor: Editor, html: string) {
    const el = document.createElement("div");
    el.innerHTML = html;
    const slice = ProseMirrorDOMParser.fromSchema(editor.schema).parseSlice(el);
    if (!slice || slice.content.childCount !== 1) {
      throw new Error("expected a single-node clipboard slice");
    }
    return slice.content.firstChild as ProseMirrorNode;
  }

  const blockLatexes = (editor: Editor) =>
    (editor.getJSON().content ?? [])
      .filter((block) => block.type === "blockMath")
      .map((block) => block.attrs?.latex);

  it("the editor's own copy markup parses back into a math atom (reachability)", () => {
    const editor = createEditor();
    const node = nodeFromClipboardHtml(
      editor,
      `<span data-type="inline-math" data-latex="x^2"></span>`,
    );
    expect(node.type.name).toBe("inlineMath");
    expect(node.attrs.latex).toBe("x^2");
    editor.destroy();
  });

  it("pasting a copied block formula over an atom selection keeps every formula typable", () => {
    // Restored all-math draft: the candidate clicks the first formula
    // (explicit selection) to copy it, then pastes over the selection.
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "blockMath", attrs: { latex: "x^2" } },
        { type: "blockMath", attrs: { latex: "y^2" } },
      ],
    });
    const node = nodeFromClipboardHtml(
      editor,
      `<div data-type="block-math" data-latex="x^2"></div>`,
    );
    // doPaste: sliceSingleNode → replaceSelectionWith + paste metas.
    editor.view.dispatch(
      editor.state.tr
        .replaceSelectionWith(node)
        .scrollIntoView()
        .setMeta("paste", true)
        .setMeta("uiEvent", "paste"),
    );
    expect(editor.state.selection instanceof NodeSelection).toBe(false);
    editor.commands.insertContent({ type: "text", text: "答" });
    expect(blockLatexes(editor)).toEqual(["x^2", "y^2"]);
    editor.destroy();
  });

  it("dropping a dragged formula leaves a safe text cursor, formula intact", () => {
    // dragstart within a node selection carries the atom; moving (not
    // copying) also deletes the source. handleDrop inserts it at the
    // dropPoint and NodeSelects the dropped node only when $pos.nodeAfter
    // matches it — i.e. at a block boundary, which is where the hazard
    // lives (prosemirror-view handleDrop).
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "前文" }] },
        { type: "blockMath", attrs: { latex: "x^2" } },
      ],
    });
    // doc positions: paragraph("前文") spans 0..4, the atom sits at 4..5.
    const atom = editor.state.doc.nodeAt(4);
    if (!atom || atom.type.name !== "blockMath") {
      throw new Error("fixture bug: expected the blockMath at pos 4");
    }
    const tr = editor.state.tr;
    tr.delete(4, 4 + atom.nodeSize); // move=true: source removed
    const dropPos = tr.mapping.map(0); // dropped at the doc's block boundary
    tr.replaceRangeWith(dropPos, dropPos, atom);
    if (!tr.doc.resolve(dropPos).nodeAfter?.eq(atom)) {
      throw new Error(
        "fixture bug: drop point must precede the atom — got " +
          JSON.stringify(tr.doc.toJSON().content),
      );
    }
    // prosemirror-view handleDrop: a dropped single selectable node whose
    // nodeAfter matches is NodeSelected at the drop point.
    tr.setSelection(new NodeSelection(tr.doc.resolve(dropPos)));
    editor.view.dispatch(tr.setMeta("uiEvent", "drop"));
    expect(editor.state.selection instanceof NodeSelection).toBe(false);
    expect(editor.state.selection instanceof TextSelection).toBe(true);
    editor.commands.insertContent({ type: "text", text: "答" });
    expect(blockLatexes(editor)).toEqual(["x^2"]);
    editor.destroy();
  });

  it("pasting a block formula at a prose caret leaves a safe text cursor", () => {
    // The common flow: copy a formula, park the caret after prose, paste.
    // The pasted block atom closes the paragraph, and with no text cursor
    // directly ahead the view leaves the atom NodeSelected.
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "前文" }] },
        { type: "blockMath", attrs: { latex: "x^2" } },
        { type: "paragraph", content: [{ type: "text", text: "后文" }] },
      ],
    });
    editor.commands.setTextSelection(3); // caret after "前文"
    const node = nodeFromClipboardHtml(
      editor,
      `<div data-type="block-math" data-latex="y^2"></div>`,
    );
    editor.view.dispatch(
      editor.state.tr
        .replaceSelectionWith(node)
        .scrollIntoView()
        .setMeta("uiEvent", "paste"),
    );
    expect(editor.state.selection instanceof NodeSelection).toBe(false);
    editor.commands.insertContent({ type: "text", text: "答" });
    expect(blockLatexes(editor)).toEqual(["y^2", "x^2"]);
    // Surrounding prose survived the paste and the typing.
    const text = JSON.stringify(editor.getJSON());
    expect(text).toContain("前文");
    expect(text).toContain("后文");
    editor.destroy();
  });

  it("plain-text LaTeX paste produces text, never a math node (not-reachable boundary)", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    });
    // Plain-text clipboard content carries no math markup; the schema's
    // parse rules cannot build a math atom from it.
    editor.view.dispatch(
      editor.state.tr
        .replaceSelectionWith(editor.schema.text("$x^2$ \\frac{a}{b}"))
        .setMeta("uiEvent", "paste"),
    );
    const canonical = tiptapToContentDocument(editor.getJSON());
    expect(JSON.stringify(canonical)).not.toContain("inlineMath");
    expect(JSON.stringify(canonical)).not.toContain("blockMath");
    expect(canonical.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "$x^2$ \\frac{a}{b}" }],
    });
    editor.destroy();
  });

  it("explicit user node selection is left alone — no operation meta, no normalization", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "blockMath", attrs: { latex: "x^2" } },
        { type: "blockMath", attrs: { latex: "y^2" } },
      ],
    });
    // A click/arrow-key selection is an ordinary transaction with no
    // paste/drop meta; the C13 plugin must never rewrite it (#679).
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
    );
    expect(editor.state.selection instanceof NodeSelection).toBe(true);
    editor.destroy();
  });
});

describe("schema ↔ adapter structural guard — no editor-emittable node is silently lost", () => {
  /**
   * Every node the production schema can emit, with the canonical type the
   * adapter must produce for it. tableHeader has a documented downgrade
   * (grammar tables are unspanned); everything else maps 1:1. If the editor
   * grammar grows, the schema pin above and this table (plus the adapter)
   * must grow together: a probed node without an adapter mapping makes
   * tiptapToContentDocument throw — fail-safe, never silent.
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
      settleImplicitMathSelection(editor);
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

describe("C14 table-cell math fidelity — cell blockMath survives as math", () => {
  it("a blockMath inside a real editor cell canonicalizes to inline math, not text", () => {
    // The editor schema allows a blockMath inside a table cell (authoring or
    // paste); the adapter must downgrade it to an inlineMath paragraph — the
    // list-item policy — so the candidate's formula reloads as a formula.
    const editor = createEditor({
      type: "doc",
      content: [
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
                      content: [{ type: "text", text: "c" }],
                    },
                    { type: "blockMath", attrs: { latex: "x^2" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const doc = tiptapToContentDocument(editor.getJSON());
    const table = doc.content[0];
    if (!table || table.type !== "table") throw new Error("expected table");
    const cell = table.content[0]?.content[0];
    if (!cell || cell.type !== "tableCell") throw new Error("expected cell");
    expect(cell.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "c" }] },
      { type: "paragraph", content: [{ type: "inlineMath", latex: "x^2" }] },
    ]);
    // …and the canonical cell restores into the editor (reload renders the
    // formula through the Mathematics extension, not as literal text).
    expect(tiptapToContentDocument(contentDocumentToTiptap(doc))).toEqual(doc);
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
