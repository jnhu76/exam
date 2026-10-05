import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
// Type-only: brings the prosemirror-view declaration into the program so the
// EditorView augmentation below merges with the class @tiptap/pm re-exports.
import type {} from "prosemirror-view";

/**
 * Editor-scoped keyboard/selection extensions for the candidate Rich editor
 * (#669 phase U, contract docs/design/candidate-rich-editor-ux.md §4–§5).
 * Presentation-free: these are editor mechanisms, not toolbar behavior.
 */

/**
 * The outcome of the list Tab/Shift+Tab decision for one keystroke.
 *   apply    → run the sink/lift command (Tiptap list semantics)
 *   swallow  → the gesture is list-scoped but the structure change is illegal
 *              (e.g. Tab on the first/only item): consume the keystroke so the
 *              browser default can never move focus out of the editor
 *   pass     → not a list context; ordinary traversal/other handlers apply
 */
export type ListTabDecision = "apply" | "swallow" | "pass";

/**
 * Pure decision for the list keyboard contract. Extracted so the escape-class
 * regressions (#677 F4, review A finding U-01: first-item Tab used to fall
 * through to the browser default and land on page controls) test against the
 * real editor state without synthesizing keyboard events.
 *
 * Tables are excluded: inside a table the Tiptap table keymap owns Tab
 * (cell navigation), except when the caret is in a list nested in a cell —
 * there the list contract wins, matching sink/lift legality.
 */
export function decideListTab(
  editor: Editor,
  direction: "sink" | "lift",
): ListTabDecision {
  if (!editor.isActive("listItem")) return "pass";
  const command =
    direction === "sink"
      ? editor.can().sinkListItem("listItem")
      : editor.can().liftListItem("listItem");
  return command ? "apply" : "swallow";
}

export function runListTab(
  editor: Editor,
  direction: "sink" | "lift",
): boolean {
  const decision = decideListTab(editor, direction);
  if (decision === "pass") return false;
  if (decision === "swallow") return true;
  if (direction === "sink") {
    editor.chain().focus().sinkListItem("listItem").run();
  } else {
    editor.chain().focus().liftListItem("listItem").run();
  }
  return true;
}

/**
 * Tab / Shift+Tab inside list items indent and outdent where legal and are
 * otherwise swallowed — focus must never escape the editor toward page
 * controls (#677 F4). Outside lists the guard passes the keystroke through,
 * so ordinary accessibility traversal and the table keymap are untouched.
 */
export const ListTabGuard = Extension.create({
  name: "listTabGuard",
  addKeyboardShortcuts() {
    return {
      Tab: () => runListTab(this.editor, "sink"),
      "Shift-Tab": () => runListTab(this.editor, "lift"),
    };
  },
});

/**
 * Keyboard twin of the toolbar's downgrade-context disables (commands.ts,
 * contract §1): the built-in list/code-block shortcuts stay bound inside
 * table cells and list items and would create structure the canonical
 * adapter replaces with plain text on save (review U-R2). Swallowing the
 * keystroke here preempts the built-in binding (later-registered extensions
 * resolve first) exactly where the toolbar buttons are disabled — one
 * predicate per grammar fact, enforced at both entry points.
 */
export const DowngradeCommandGuard = Extension.create({
  name: "downgradeCommandGuard",
  addKeyboardShortcuts() {
    const inTableCell = (editor: Editor): boolean =>
      editor.isActive("tableCell") || editor.isActive("tableHeader");
    const structureDowngrades = (editor: Editor): boolean =>
      inTableCell(editor) || editor.isActive("listItem");
    return {
      "Mod-Shift-8": () => inTableCell(this.editor),
      "Mod-Shift-7": () => inTableCell(this.editor),
      "Mod-Alt-C": () => structureDowngrades(this.editor),
    };
  },
});

/**
 * prosemirror-view applies native DOM selection changes through its
 * `selectionchange` listener, which Chrome delivers asynchronously and may
 * not fire before the next keystroke. Its keydown path only force-flushes an
 * ALREADY-SCHEDULED observer flush, so after an unhandled native caret move
 * (Ctrl+End, PageUp, …) the DOM selection can still be ahead of the view
 * state when the next key is processed. When the document ends with a table,
 * the pending DOM caret sits after the trailing tableWrapper — a position
 * with no document representation — and the keystroke is then reconciled
 * against the stale selection: the input is dropped or lands on the wrong
 * block while staying visible in the DOM (#701).
 * INVARIANT: by the time any keydown is handled or inserted, the view state
 * selection reflects the current DOM selection. flush() reuses
 * prosemirror-view's own guards (suppression, ignoreSelectionChange, focus);
 * the composing guard mirrors editHandlers.keydown, which does no input work
 * during composition. Runs before editHandlers.keydown (custom DOM handlers
 * run first) and returns false, so keymaps and the browser default proceed.
 */
declare module "prosemirror-view" {
  interface EditorView {
    /**
     * Internal DOM observer (untyped upstream). Only flush() is relied on —
     * the same entry prosemirror-view's keydown path reaches via forceFlush.
     */
    domObserver: { flush(): void };
  }
}

export const SyncPendingSelectionOnKeydown = Extension.create({
  name: "syncPendingSelectionOnKeydown",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("syncPendingSelectionOnKeydown"),
        props: {
          handleDOMEvents: {
            keydown: (view: EditorView) => {
              if (view.composing) return false;
              view.domObserver.flush();
              return false;
            },
          },
        },
      }),
    ];
  },
});

/** The math atoms of the frozen grammar, shared by the activation seams. */
const MATH_NODE_NAMES = new Set(["inlineMath", "blockMath"]);

/** Payload of an activated (re-edit requested) formula atom. */
export interface FormulaActivation {
  pos: number;
  latex: string;
  /** True for blockMath (独立显示), false for inlineMath (行内). */
  display: boolean;
  /** Node size — the range the atom occupies (in-place conversion target). */
  nodeSize: number;
}

/**
 * Enter on a formula atom under an explicit NodeSelection opens the formula
 * surface — the keyboard twin of clicking the atom (#679 re-edit). Click
 * activation is wired through the Mathematics extension's own onClick option;
 * this extension owns ONLY the keyboard path, and returns false for every
 * other selection so ordinary Enter behavior is untouched.
 */
export function createFormulaActivateExtension(
  onActivate: (activation: FormulaActivation) => void,
  options: { atomLabel?: (latex: string) => string } = {},
): Extension {
  const ExtensionClass = Extension.create({
    name: "formulaActivate",
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          if (!this.editor.isEditable) return false;
          const { selection } = this.editor.state;
          if (!(selection instanceof NodeSelection)) return false;
          if (!MATH_NODE_NAMES.has(selection.node.type.name)) return false;
          onActivate({
            pos: selection.from,
            latex:
              typeof selection.node.attrs.latex === "string"
                ? selection.node.attrs.latex
                : "",
            display: selection.node.type.name === "blockMath",
            nodeSize: selection.to - selection.from,
          });
          return true;
        },
      };
    },
    addProseMirrorPlugins() {
      const labelFor = options.atomLabel ?? ((latex: string) => latex);
      const buildDecorations = (doc: ProseMirrorNode): DecorationSet => {
        const atoms: Decoration[] = [];
        doc.descendants((node, pos) => {
          if (!MATH_NODE_NAMES.has(node.type.name)) return;
          const latex =
            typeof node.attrs.latex === "string" ? node.attrs.latex : "";
          // Accessible name for the atom (#679/contract §4): the
          // KaTeX-rendered atom is otherwise anonymous to assistive tech.
          // The label text is i18n-owned (injected by the component); the
          // latex doubles as the discoverability cue for the click/Enter
          // re-edit path.
          const label = labelFor(latex);
          atoms.push(
            Decoration.node(pos, pos + node.nodeSize, {
              "aria-label": label,
              title: label,
            }),
          );
        });
        return DecorationSet.create(doc, atoms);
      };
      return [
        new Plugin({
          key: new PluginKey("formulaAtomAccessibility"),
          // The set is built once per DOC CHANGE and mapped across
          // selection-only transactions, instead of re-descending the whole
          // document on every keystroke (review U-R12).
          state: {
            init: (_config, state) => buildDecorations(state.doc),
            apply: (tr, cached) =>
              tr.docChanged
                ? buildDecorations(tr.doc)
                : cached.map(tr.mapping, tr.doc),
          },
          props: {
            decorations(state): DecorationSet {
              return this.getState(state) ?? DecorationSet.empty;
            },
          },
        }),
      ];
    },
  });
  return ExtensionClass;
}
