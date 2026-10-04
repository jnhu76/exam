import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import {
  buildEditorCommands,
  COMMAND_GROUP_ORDER,
  type EditorCommandDescriptor,
} from "./commands";
import { richEditorExtensions } from "../RichContentEditor";

/**
 * Reality tests for the candidate command catalogue (contract
 * docs/design/candidate-rich-editor-ux.md §1–§3). Every descriptor is
 * exercised against the REAL production editor schema; the catalogue must
 * never grow an operation the frozen grammar cannot persist.
 */

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

afterEach(() => {
  for (const editor of liveEditors) {
    if (!editor.isDestroyed) editor.destroy();
  }
  liveEditors.length = 0;
});

function commandMap(
  hooks = { openFormula: () => {} },
): Map<string, EditorCommandDescriptor> {
  return new Map(
    buildEditorCommands(hooks).map((command) => [command.id, command]),
  );
}

/** Local JSONContent narrowing — Tiptap v3 types .content as a union. */
type JsonNode = { type?: string; content?: JsonNode[]; text?: string };

describe("command catalogue — frozen surface (CANDIDATE_VISIBLE == PERSISTABLE)", () => {
  it("exposes exactly the frozen command set — no more, no less", () => {
    expect([...commandMap().keys()].sort()).toEqual(
      [
        "undo",
        "redo",
        "bold",
        "italic",
        "underline",
        "inlineCode",
        "bulletList",
        "orderedList",
        "formula",
        "codeBlock",
        "table",
      ].sort(),
    );
  });

  it("groups cover only the sanctioned groups in the frozen order", () => {
    expect(COMMAND_GROUP_ORDER).toEqual([
      "history",
      "inline",
      "list",
      "insert",
    ]);
  });
});

describe("toggle commands — active/enabled semantics against the real editor", () => {
  it.each([
    ["bold", "bold", (e: Editor) => e.chain().focus().toggleBold()],
    ["italic", "italic", (e: Editor) => e.chain().focus().toggleItalic()],
    [
      "underline",
      "underline",
      (e: Editor) => e.chain().focus().toggleUnderline(),
    ],
    ["inlineCode", "code", (e: Editor) => e.chain().focus().toggleCode()],
  ] as const)(
    "isActive follows the stored mark for %s",
    (id, tiptapName, toggle) => {
      const editor = createEditor();
      const command = commandMap().get(id);
      if (!command) throw new Error(`missing command ${id}`);
      editor.commands.setTextSelection({ from: 1, to: 1 });
      editor.chain().focus().insertContent("答案文字").run();
      editor.commands.setTextSelection({ from: 1, to: 1 });
      expect(command.isActive(editor)).toBe(false);
      editor.commands.setTextSelection({ from: 1, to: 5 });
      const applied = toggle(editor).run();
      expect(Boolean(applied)).toBe(true);
      // caret inside the marked span → active
      editor.commands.setTextSelection({ from: 2, to: 3 });
      expect(command.isActive(editor)).toBe(true);
      // caret AFTER the marked text, separated by an unmarked paragraph, so no
      // stored-mark bleed reads as active
      editor.commands.insertContentAt(
        {
          from: editor.state.doc.content.size,
          to: editor.state.doc.content.size,
        },
        { type: "paragraph" },
      );
      editor.commands.setTextSelection({
        from: editor.state.doc.content.size - 1,
        to: editor.state.doc.content.size - 1,
      });
      expect(command.isActive(editor)).toBe(false);
    },
  );

  it.each(["bulletList", "orderedList"] as const)(
    "isActive follows the list context for %s",
    (id) => {
      const editor = createEditor();
      const command = commandMap().get(id);
      if (!command) throw new Error(`missing command ${id}`);
      editor.commands.setTextSelection({ from: 1, to: 1 });
      editor.chain().focus().insertContent("列表项").run();
      editor.commands.setTextSelection({ from: 1, to: 4 });
      const toggle =
        id === "bulletList"
          ? editor.chain().focus().toggleBulletList()
          : editor.chain().focus().toggleOrderedList();
      toggle.run();
      editor.commands.setTextSelection({ from: 2, to: 2 });
      expect(command.isActive(editor)).toBe(true);
      editor.commands.setTextSelection({
        from: editor.state.doc.content.size,
        to: editor.state.doc.content.size,
      });
      if (editor.isActive(id)) {
        // caret inside the only list item cannot leave the list; toggle off
        editor.commands.setTextSelection({ from: 1, to: 4 });
        editor
          .chain()
          .focus()
          [id === "bulletList" ? "toggleBulletList" : "toggleOrderedList"]()
          .run();
      }
      expect(command.isActive(editor)).toBe(false);
    },
  );

  it("codeBlock isActive tracks the block node", () => {
    const editor = createEditor();
    const command = commandMap().get("codeBlock");
    if (!command) throw new Error("missing command codeBlock");
    editor.commands.setTextSelection({ from: 1, to: 1 });
    editor.chain().focus().toggleCodeBlock().run();
    expect(command.isActive(editor)).toBe(true);
    editor.chain().focus().toggleCodeBlock().run();
    expect(command.isActive(editor)).toBe(false);
  });
});

describe("undo/redo — real history through the catalogue (#677 F2)", () => {
  it("undo/redo start disabled, enable after a mutation, and revert it", () => {
    const editor = createEditor();
    const undo = commandMap().get("undo");
    const redo = commandMap().get("redo");
    if (!undo || !redo) throw new Error("missing history commands");

    expect(undo.isEnabled(editor)).toBe(false);
    expect(redo.isEnabled(editor)).toBe(false);

    editor.commands.insertContent("第一版");
    expect(editor.state.doc.textContent).toBe("第一版");
    expect(undo.isEnabled(editor)).toBe(true);
    expect(redo.isEnabled(editor)).toBe(false);

    undo.execute(editor);
    expect(editor.state.doc.textContent).toBe("");
    expect(redo.isEnabled(editor)).toBe(true);

    redo.execute(editor);
    expect(editor.state.doc.textContent).toBe("第一版");
  });

  it("undo reverts a formatting toggle (marks enter history)", () => {
    const editor = createEditor();
    editor.commands.insertContent("目标词");
    const bold = commandMap().get("bold");
    if (!bold) throw new Error("missing command bold");
    editor.commands.setTextSelection({ from: 1, to: 4 });
    bold.execute(editor);
    expect(editor.isActive("bold")).toBe(true);

    const undo = commandMap().get("undo");
    if (!undo) throw new Error("missing command undo");
    undo.execute(editor);
    expect(editor.isActive("bold")).toBe(false);
  });
});

describe("contextual availability", () => {
  it("formula mirrors editability only", () => {
    const editor = createEditor();
    const formula = commandMap().get("formula");
    if (!formula) throw new Error("missing command formula");
    expect(formula.isEnabled(editor)).toBe(true);
    editor.setEditable(false);
    expect(formula.isEnabled(editor)).toBe(false);
  });

  it("table is enabled in an empty document and inserts the headerless 2×2 grammar shape", () => {
    const editor = createEditor();
    const table = commandMap().get("table");
    if (!table) throw new Error("missing command table");
    expect(table.isEnabled(editor)).toBe(true);
    table.execute(editor);
    const json = editor.getJSON() as JsonNode;
    const tableNode = (json.content ?? []).find((n) => n.type === "table");
    expect(tableNode).toBeTruthy();
    const rows = tableNode?.content ?? [];
    expect(rows.length).toBe(2);
    for (const row of rows) {
      const cells = row.content ?? [];
      expect(cells.every((cell) => cell.type === "tableCell")).toBe(true);
    }
    expect(JSON.stringify(json)).not.toContain("tableHeader");
  });

  it("table insertion is not offered inside a table (nested tables are not grammar)", () => {
    const editor = createEditor();
    const table = commandMap().get("table");
    if (!table) throw new Error("missing command table");
    table.execute(editor);
    // caret is inside the inserted table — a nested table would be
    // downgraded to plain text by the canonical adapter, so the catalogue
    // disables the command instead of offering a silent downgrade
    expect(editor.isActive("table")).toBe(true);
    expect(table.isEnabled(editor)).toBe(false);
  });
});
