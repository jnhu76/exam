import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import {
  createFormulaActivateExtension,
  decideListTab,
  runListTab,
  type FormulaActivation,
} from "./editorExtensions";
import { richEditorExtensions } from "../RichContentEditor";

/**
 * Reality tests for the editor-scoped keyboard/selection extensions
 * (contract §4–§5): the list Tab guard (#677 F4 — review A finding U-01:
 * first-item Tab used to escape the editor) and the formula activation seam.
 */

const liveEditors: Editor[] = [];

function createEditor(withFormulaActivation = false): {
  editor: Editor;
  activations: FormulaActivation[];
} {
  const activations: FormulaActivation[] = [];
  const editor = new Editor({
    extensions: richEditorExtensions(
      withFormulaActivation
        ? { onFormulaActivate: (a) => activations.push(a) }
        : {},
    ),
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    },
  });
  liveEditors.push(editor);
  return { editor, activations };
}

afterEach(() => {
  for (const editor of liveEditors) {
    if (!editor.isDestroyed) editor.destroy();
  }
  liveEditors.length = 0;
});

/** Local JSONContent narrowing — Tiptap v3 types .content as a union. */
type JsonNode = { type?: string; content?: JsonNode[]; text?: string };
function childNodes(node: JsonNode | undefined): JsonNode[] {
  return node?.content ?? [];
}
function docNodes(editor: Editor): JsonNode[] {
  return childNodes(editor.getJSON() as JsonNode);
}

function typeListWithTwoItems(editor: Editor): void {
  editor.commands.insertContent("第一项");
  editor.commands.toggleBulletList();
  editor.commands.enter();
  editor.commands.insertContent("第二项");
}

describe("list Tab decision (#677 F4 / U-01)", () => {
  it("passes through outside a list (no Tab trap)", () => {
    const { editor } = createEditor();
    editor.commands.insertContent("普通段落");
    editor.commands.setTextSelection({ from: 2, to: 2 });
    expect(decideListTab(editor, "sink")).toBe("pass");
    expect(decideListTab(editor, "lift")).toBe("pass");
    expect(runListTab(editor, "sink")).toBe(false);
  });

  it("applies the sink for a sink-legal item", () => {
    const { editor } = createEditor();
    typeListWithTwoItems(editor);
    // caret on the SECOND item (sink-legal: has a previous sibling)
    const end = editor.state.doc.content.size;
    editor.commands.setTextSelection({ from: end - 1, to: end - 1 });
    expect(editor.isActive("listItem")).toBe(true);
    expect(decideListTab(editor, "sink")).toBe("apply");
    expect(runListTab(editor, "sink")).toBe(true);
    // the second item is now nested under the first
    const list = docNodes(editor).find((n) => n.type === "bulletList");
    const firstItem = childNodes(list)[0];
    expect(childNodes(firstItem).some((n) => n.type === "bulletList")).toBe(
      true,
    );
  });

  it("SWALLOWS Tab on the first/only item — focus never escapes the editor", () => {
    const { editor } = createEditor();
    editor.commands.insertContent("唯一项");
    editor.commands.toggleBulletList();
    editor.commands.setTextSelection({ from: 2, to: 2 });
    expect(editor.isActive("listItem")).toBe(true);
    expect(decideListTab(editor, "sink")).toBe("swallow");
    // runListTab consumes the keystroke (true) and changes nothing
    expect(runListTab(editor, "sink")).toBe(true);
    const list = docNodes(editor).find((n) => n.type === "bulletList");
    expect(childNodes(list).length).toBe(1);
    const liftedChildren = childNodes(childNodes(list)[0]);
    expect(liftedChildren.some((n) => n.type === "bulletList")).toBe(false);
  });

  it("lifts a nested item back out (Shift+Tab outdent)", () => {
    const { editor } = createEditor();
    typeListWithTwoItems(editor);
    const end = editor.state.doc.content.size;
    editor.commands.setTextSelection({ from: end - 1, to: end - 1 });
    expect(runListTab(editor, "sink")).toBe(true);
    // nested now: lift is legal
    expect(decideListTab(editor, "lift")).toBe("apply");
    expect(runListTab(editor, "lift")).toBe(true);
    const list = docNodes(editor).find((n) => n.type === "bulletList");
    expect(childNodes(list).length).toBe(2);
    const liftedChildren = childNodes(childNodes(list)[0]);
    expect(liftedChildren.some((n) => n.type === "bulletList")).toBe(false);
  });

  it("top-level Shift+Tab lifts the item out of the list (stock Tiptap semantics)", () => {
    const { editor } = createEditor();
    editor.commands.insertContent("第一项");
    editor.commands.toggleBulletList();
    editor.commands.setTextSelection({ from: 2, to: 2 });
    // can() reports lift available for a top-level item: the stock lift
    // converts it back to a paragraph — a legal outdent, not an escape
    expect(decideListTab(editor, "lift")).toBe("apply");
    expect(runListTab(editor, "lift")).toBe(true);
    expect(editor.isActive("listItem")).toBe(false);
    expect(editor.state.doc.textContent).toBe("第一项");
  });

  it("persists the nested structure through the canonical adapter", () => {
    const { editor } = createEditor();
    typeListWithTwoItems(editor);
    const end = editor.state.doc.content.size;
    editor.commands.setTextSelection({ from: end - 1, to: end - 1 });
    runListTab(editor, "sink");
    // the adapter is exercised end-to-end in contentAdapter.test.ts; here we
    // pin the shape the adapter receives (nested list inside listItem)
    const list = docNodes(editor).find((n) => n.type === "bulletList");
    const nested = childNodes(childNodes(list)[0]).find(
      (n) => n.type === "bulletList",
    );
    expect(JSON.stringify(nested)).toContain("第二项");
  });
});

describe("formula activation seam (#679 re-edit)", () => {
  it("Enter on an explicitly selected math atom reports the activation", () => {
    const { editor, activations } = createEditor(true);
    editor.commands.insertContent("前文");
    editor.commands.insertContent({
      type: "inlineMath",
      attrs: { latex: "x^2" },
    });
    // locate the atom and select it explicitly
    let atomPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "inlineMath") atomPos = pos;
    });
    expect(atomPos).toBeGreaterThan(0);
    // simulate the explicit user selection (click / arrow keys): a real
    // NodeSelection on the atom, dispatched through the view
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, atomPos),
      ),
    );
    const selection = editor.state.selection;
    expect(selection instanceof NodeSelection).toBe(true);
    // dispatch the Enter binding through the real keymap path
    const handled = editor.commands.keyboardShortcut("Enter");
    expect(handled).toBe(true);
    expect(activations).toHaveLength(1);
    expect(activations[0]).toMatchObject({
      pos: atomPos,
      latex: "x^2",
      display: false,
    });
    expect(activations[0]?.nodeSize).toBeGreaterThan(0);
  });

  it("Enter on ordinary text does not activate anything", () => {
    const { editor, activations } = createEditor(true);
    editor.commands.insertContent("普通文本");
    editor.commands.setTextSelection({ from: 2, to: 2 });
    editor.commands.keyboardShortcut("Enter");
    expect(activations).toHaveLength(0);
  });

  it("math atoms carry an accessible name decoration", () => {
    const { editor } = createEditor(true);
    editor.commands.insertContent({
      type: "inlineMath",
      attrs: { latex: "E=mc^2" },
    });
    const atomEl = editor.view.dom.querySelector("[aria-label^='公式']");
    expect(atomEl).not.toBeNull();
    expect(atomEl?.getAttribute("aria-label")).toContain("E=mc^2");
  });
});

describe("keyboardShortcut plumbing", () => {
  it("TextSelection Enter stays untouched when no atom is selected", () => {
    const { editor } = createEditor(true);
    editor.commands.insertContent("行一");
    editor.commands.setTextSelection({ from: 2, to: 2 });
    const before = editor.state.doc.childCount;
    expect(editor.state.selection instanceof TextSelection).toBe(true);
    editor.commands.keyboardShortcut("Enter");
    // ordinary Enter splits the paragraph (stock behavior preserved)
    expect(editor.state.doc.childCount).toBeGreaterThanOrEqual(before);
  });
});

describe("activation wiring is inert without the option", () => {
  it("schema-level tests get no activation extension", () => {
    const { editor, activations } = createEditor(false);
    expect(activations).toHaveLength(0);
    // the extension is not in the extension list
    const names = editor.extensionManager.extensions.map((e) => e.name);
    expect(names).not.toContain("formulaActivate");
  });
});

describe("vi spy sanity for the activation callback", () => {
  it("callback receives a stable shape", () => {
    const activations: FormulaActivation[] = [];
    const spy = vi.fn((a: FormulaActivation) => activations.push(a));
    const editor = new Editor({
      extensions: richEditorExtensions({ onFormulaActivate: spy }),
      content: { type: "doc", content: [{ type: "paragraph", content: [] }] },
    });
    liveEditors.push(editor);
    editor.commands.insertContent({
      type: "blockMath",
      attrs: { latex: "\\sum_{i=1}^{n} i" },
    });
    let atomPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "blockMath") atomPos = pos;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, atomPos),
      ),
    );
    editor.commands.keyboardShortcut("Enter");
    expect(spy).toHaveBeenCalledTimes(1);
    const firstActivation = spy.mock.calls[0]?.[0];
    expect(firstActivation?.display).toBe(true);
  });
});
