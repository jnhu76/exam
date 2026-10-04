import type { Editor } from "@tiptap/core";
import {
  Bold,
  Code2,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Sigma,
  SquareCode,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The candidate editor's UI command catalogue (#669 phase U, contract
 * docs/design/candidate-rich-editor-ux.md §1).
 *
 * INVARIANT: this is a presentation catalogue, NOT a second Rich semantic
 * authority. Every command maps onto the existing Tiptap extension allow-list
 * (= the frozen ContentDocumentV1 grammar); no descriptor introduces a node,
 * mark, attribute, or validation rule. Grammar/persistence authority stays
 * with contentAdapter + the backend contract.
 *
 * CANDIDATE_VISIBLE_SUPPORTED_CONTENT == CANONICAL_PERSISTABLE_SEMANTICS:
 * commands whose result the canonical adapter cannot persist (heading, link,
 * image, table merge/split/header, …) have NO descriptor and must not gain
 * one without a grammar change first.
 */

export type EditorCommandId =
  | "undo"
  | "redo"
  | "bold"
  | "italic"
  | "underline"
  | "inlineCode"
  | "bulletList"
  | "orderedList"
  | "formula"
  | "codeBlock"
  | "table";

export type EditorCommandKind = "toggle" | "action" | "insert";

export type EditorCommandGroup = "history" | "inline" | "list" | "insert";

export interface EditorCommandDescriptor {
  id: EditorCommandId;
  group: EditorCommandGroup;
  /** i18n key of the candidate-facing label (never editor-framework jargon). */
  labelKey: string;
  icon: LucideIcon;
  kind: EditorCommandKind;
  /** Shown in tooltip / aria-keyshortcuts ONLY when genuinely bound. */
  shortcut?: string;
  /** Toggle commands only; drives aria-pressed + visual active state. */
  isActive(editor: Editor): boolean;
  isEnabled(editor: Editor): boolean;
  execute(editor: Editor): void;
}

/** Presentation hint: these commands move into the narrow-viewport overflow menu. */
export const OVERFLOW_COMMAND_IDS: ReadonlySet<EditorCommandId> = new Set([
  "codeBlock",
  "table",
]);

export interface EditorCommandHooks {
  /**
   * Opens the formula surface. Injected so the catalogue stays decoupled from
   * the dialog; the formula command's editor-side semantics (insert/update of
   * inlineMath/blockMath) live in the surface, which writes through the same
   * math commands and settlement guarantees as before.
   */
  openFormula(): void;
}

/**
 * Contexts where a CODE BLOCK or TABLE would be downgraded to plain text on
 * save (contentAdapter: list items accept paragraph/nested-lists only; table
 * cells accept paragraphs only). Offering the operation would show the
 * candidate something the persisted answer replaces with plain text — the
 * silent-downgrade class the phase contract forbids (§6).
 */
function structureDowngradesHere(editor: Editor): boolean {
  return editor.isActive("tableCell") || editor.isActive("listItem");
}

/**
 * Contexts where a LIST would be downgraded: table cells hold paragraphs
 * only. Nested lists inside a LIST ITEM are persistable and stay available —
 * that is the #677 F4 nesting capability, not a downgrade.
 */
function listDowngradesHere(editor: Editor): boolean {
  return editor.isActive("tableCell");
}

export function buildEditorCommands(
  hooks: EditorCommandHooks,
): readonly EditorCommandDescriptor[] {
  return [
    {
      id: "undo",
      group: "history",
      labelKey: "content.editor.undo",
      icon: Undo2,
      kind: "action",
      shortcut: "Mod+Z",
      isActive: () => false,
      isEnabled: (editor) => editor.can().undo(),
      execute: (editor) => {
        editor.chain().focus().undo().run();
      },
    },
    {
      id: "redo",
      group: "history",
      labelKey: "content.editor.redo",
      icon: Redo2,
      kind: "action",
      shortcut: "Mod+Y",
      isActive: () => false,
      isEnabled: (editor) => editor.can().redo(),
      execute: (editor) => {
        editor.chain().focus().redo().run();
      },
    },
    {
      id: "bold",
      group: "inline",
      labelKey: "content.editor.bold",
      icon: Bold,
      kind: "toggle",
      shortcut: "Mod+B",
      isActive: (editor) => editor.isActive("bold"),
      isEnabled: (editor) => editor.can().toggleBold(),
      execute: (editor) => {
        editor.chain().focus().toggleBold().run();
      },
    },
    {
      id: "italic",
      group: "inline",
      labelKey: "content.editor.italic",
      icon: Italic,
      kind: "toggle",
      shortcut: "Mod+I",
      isActive: (editor) => editor.isActive("italic"),
      isEnabled: (editor) => editor.can().toggleItalic(),
      execute: (editor) => {
        editor.chain().focus().toggleItalic().run();
      },
    },
    {
      id: "underline",
      group: "inline",
      labelKey: "content.editor.underline",
      icon: Underline,
      kind: "toggle",
      shortcut: "Mod+U",
      isActive: (editor) => editor.isActive("underline"),
      isEnabled: (editor) => editor.can().toggleUnderline(),
      execute: (editor) => {
        editor.chain().focus().toggleUnderline().run();
      },
    },
    {
      id: "inlineCode",
      group: "inline",
      labelKey: "content.editor.inlineCode",
      icon: Code2,
      kind: "toggle",
      shortcut: "Mod+E",
      isActive: (editor) => editor.isActive("code"),
      isEnabled: (editor) => editor.can().toggleCode(),
      execute: (editor) => {
        editor.chain().focus().toggleCode().run();
      },
    },
    {
      id: "bulletList",
      group: "list",
      labelKey: "content.editor.bulletList",
      icon: List,
      kind: "toggle",
      shortcut: "Mod+Shift+8",
      isActive: (editor) => editor.isActive("bulletList"),
      isEnabled: (editor) =>
        editor.can().toggleBulletList() && !listDowngradesHere(editor),
      execute: (editor) => {
        editor.chain().focus().toggleBulletList().run();
      },
    },
    {
      id: "orderedList",
      group: "list",
      labelKey: "content.editor.orderedList",
      icon: ListOrdered,
      kind: "toggle",
      shortcut: "Mod+Shift+7",
      isActive: (editor) => editor.isActive("orderedList"),
      isEnabled: (editor) =>
        editor.can().toggleOrderedList() && !listDowngradesHere(editor),
      execute: (editor) => {
        editor.chain().focus().toggleOrderedList().run();
      },
    },
    {
      id: "formula",
      group: "insert",
      labelKey: "content.editor.formula",
      icon: Sigma,
      kind: "action",
      isActive: () => false,
      isEnabled: (editor) => editor.isEditable,
      execute: () => {
        hooks.openFormula();
      },
    },
    {
      id: "codeBlock",
      group: "insert",
      labelKey: "content.editor.codeBlock",
      icon: SquareCode,
      kind: "toggle",
      shortcut: "Mod+Alt+C",
      isActive: (editor) => editor.isActive("codeBlock"),
      isEnabled: (editor) =>
        editor.can().toggleCodeBlock() && !structureDowngradesHere(editor),
      execute: (editor) => {
        editor.chain().focus().toggleCodeBlock().run();
      },
    },
    {
      id: "table",
      group: "insert",
      labelKey: "content.editor.table",
      icon: Table2,
      kind: "insert",
      isActive: () => false,
      isEnabled: (editor) =>
        editor.can().insertTable({ rows: 2, cols: 2, withHeaderRow: false }) &&
        !structureDowngradesHere(editor),
      execute: (editor) => {
        editor
          .chain()
          .focus()
          .insertTable({ rows: 2, cols: 2, withHeaderRow: false })
          .run();
      },
    },
  ];
}

/** Group order for presentation; descriptors render grouped in this sequence. */
export const COMMAND_GROUP_ORDER: readonly EditorCommandGroup[] = [
  "history",
  "inline",
  "list",
  "insert",
];
