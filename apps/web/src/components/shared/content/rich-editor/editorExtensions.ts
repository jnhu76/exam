import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

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
): Extension {
  const ExtensionClass = Extension.create({
    name: "formulaActivate",
    addKeyboardShortcuts() {
      return {
        Enter: () => {
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
      return [
        new Plugin({
          key: new PluginKey("formulaAtomAccessibility"),
          props: {
            decorations(state): DecorationSet {
              const atoms: Decoration[] = [];
              state.doc.descendants((node, pos) => {
                if (!MATH_NODE_NAMES.has(node.type.name)) return;
                const latex =
                  typeof node.attrs.latex === "string" ? node.attrs.latex : "";
                // Accessible name for the atom (#679/contract §4): the
                // KaTeX-rendered atom is otherwise anonymous to assistive
                // tech. The latex hint doubles as the discoverability cue for
                // the click/Enter re-edit path.
                atoms.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    "aria-label": `公式 ${latex}`,
                    title: `公式 ${latex}`,
                  }),
                );
              });
              return DecorationSet.create(state.doc, atoms);
            },
          },
        }),
      ];
    },
  });
  return ExtensionClass;
}
