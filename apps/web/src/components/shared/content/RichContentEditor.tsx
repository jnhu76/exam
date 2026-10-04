import { useEffect, useMemo, useRef, useState } from "react";
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ReplaceStep } from "@tiptap/pm/transform";
import type { Transform } from "@tiptap/pm/transform";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import Code from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { Mathematics } from "@tiptap/extension-mathematics";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import "katex/dist/katex.min.css";
import { useTranslation } from "react-i18next";
import { contentDocumentsEqual, type ContentDocumentV1 } from "@exam/domain";
import {
  contentDocumentToTiptap,
  tiptapToContentDocument,
} from "./contentAdapter";
import { buildEditorCommands } from "./rich-editor/commands";
import {
  DowngradeCommandGuard,
  ListTabGuard,
  createFormulaActivateExtension,
  type FormulaActivation,
} from "./rich-editor/editorExtensions";
import { RichEditorToolbar } from "./rich-editor/RichEditorToolbar";
import { TableContextualBar } from "./rich-editor/TableContextualBar";
import {
  FormulaEditorDialog,
  type FormulaDialogTarget,
} from "./rich-editor/FormulaEditorDialog";

/**
 * Two-way ownership protocol: the Tiptap instance owns its state after mount,
 * but the `document` prop stays the AUTHORITATIVE answer and may be externally
 * replaced (server reconciliation after STALE_VERSION, draft restore, parent
 * reset). One ref tracks the canonical document the editor CURRENTLY holds,
 * with the invariant
 *   ref === canonical document currently held by Tiptap.
 *   - LOCAL EDIT        : onUpdate maps Tiptap JSON → canonical `next`,
 *                         re-anchors the ref, then onChange(next).
 *   - PARENT LOCAL ECHO : document == ref → no-op (never setContent, which
 *                         would reset the caret and fight the user's keys).
 *   - AUTHORITATIVE     : document != ref → setContent(document,
 *     REPLACEMENT         emitUpdate:false) so the reset never echoes back
 *                         through onUpdate into a save → setContent loop;
 *                         then the ref is re-anchored to the document.
 * The ref is the ONLY truth about what Tiptap holds: never treat "was applied
 * once" as "is what the editor holds" — a replacement back to an earlier value
 * (e.g. empty) must be applied again when the ref shows the editor moved on.
 *
 * The component must still be keyed by question identity at the call site so
 * a question switch never reuses a Tiptap document across questions.
 *
 * `isAuthoritativeReplacement` below is the pure correctness boundary of this
 * protocol, extracted so the rollback-to-empty / null-clear regressions are
 * unit-testable without a ProseMirror instance (jsdom cannot type into Tiptap).
 */
export function isAuthoritativeReplacement(
  incoming: ContentDocumentV1,
  currentEditorDocument: ContentDocumentV1 | null,
): boolean {
  return (
    currentEditorDocument === null ||
    !contentDocumentsEqual(incoming, currentEditorDocument)
  );
}

/**
 * The extension set defining the editor-side grammar. Single authority for
 * the component and the reality tests, so tests always exercise the exact
 * schema production uses. Fresh instances per call — configure() is not
 * idempotent across documents.
 *
 * `options` carries ONLY presentation wiring that does not affect the grammar:
 * the placeholder text, and the formula re-edit activation callback (contract
 * §5.2). Both default to inert so schema-level tests exercise the same node
 * and mark vocabulary without React context.
 */
export function richEditorExtensions(
  options: {
    placeholder?: string;
    onFormulaActivate?: (activation: FormulaActivation) => void;
    formulaAtomLabel?: (latex: string) => string;
  } = {},
) {
  return [
    Document,
    Paragraph,
    Text,
    HardBreak,
    Bold,
    Italic,
    Underline,
    Code,
    CodeBlock,
    BulletList,
    OrderedList,
    ListItem,
    // Grammar tables are unspanned; never offer header rows.
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Mathematics.configure({
      katexOptions: {
        throwOnError: false,
        trust: false,
        strict: "ignore",
        maxSize: 50,
        maxExpand: 1000,
      },
      ...(options.onFormulaActivate
        ? {
            inlineOptions: {
              onClick: (node: ProseMirrorNode, pos: number) =>
                options.onFormulaActivate?.(toActivation(node, pos, false)),
            },
            blockOptions: {
              onClick: (node: ProseMirrorNode, pos: number) =>
                options.onFormulaActivate?.(toActivation(node, pos, true)),
            },
          }
        : {}),
    }),
    UndoRedo,
    ...(options.placeholder
      ? [Placeholder.configure({ placeholder: options.placeholder })]
      : []),
    ListTabGuard,
    DowngradeCommandGuard,
    ...(options.onFormulaActivate
      ? [
          createFormulaActivateExtension(options.onFormulaActivate, {
            atomLabel: options.formulaAtomLabel,
          }),
        ]
      : []),
    SettleMathSelectionAfterOperation,
  ];
}

/**
 * Narrows a Mathematics onClick payload into the activation seam's shape.
 * The Mathematics extension binds its click handler unconditionally — the
 * editable gate lives here so a disabled editor (locked attempt, shared
 * read/edit consumers) never opens the formula surface (review U-R11).
 */
function toActivation(
  node: { attrs: { latex?: unknown }; nodeSize: number },
  pos: number,
  display: boolean,
): FormulaActivation {
  return {
    pos,
    latex: typeof node.attrs.latex === "string" ? node.attrs.latex : "",
    display,
    nodeSize: node.nodeSize,
  };
}

/**
 * Editor-side projection of a canonical document for the canvas: ProseMirror
 * needs at least one textblock for ordinary typing, placeholder, and mark
 * commands. The canonical empty document ({content:[]}) mounts as ONE empty
 * paragraph — the update path canonicalizes it straight back to {content:[]},
 * so the ownership protocol's echo comparison stays stable (no flip-flop).
 * Never persisted anywhere: storage authority is untouched.
 */
function toEditorContent(document: ContentDocumentV1): JSONContent {
  const json = contentDocumentToTiptap(document);
  return json.content?.length
    ? json
    : { type: "doc", content: [{ type: "paragraph" }] };
}

/**
 * The math atoms of the frozen grammar. Both are selectable ProseMirror
 * atoms, so both can end up under an operation-produced NodeSelection.
 */
const MATH_NODE_NAMES = new Set(["blockMath", "inlineMath"]);

/**
 * INVARIANT: an operation-produced math selection never survives to ordinary
 * typing. ProseMirror replaces a selected atom with the next inline input, so
 * a caret left on an implicitly selected formula silently destroys it — the
 * #676 loss class, reachable at every boundary that inserts or moves a math
 * atom programmatically:
 *   - toolbar insert replacing a trailing textblock (#676);
 *   - editor creation / authoritative setContent of a textblock-less draft
 *     (the canonical normalizer strips paragraphs between consecutive block
 *     formulas, so persisted drafts genuinely have this shape) (#673 C12);
 *   - paste or drop of a math atom (#673 C13 — prosemirror-view NodeSelects
 *     a dropped single node and leaves a pasted atom selected whenever no
 *     text cursor follows it);
 *   - the Mathematics input rules converting typed `$$…$$` / `$$$…$$$` text
 *     into an atom (#673 C15 — the rule consumes the keystroke inside
 *     handleTextInput and, when it replaces the whole textblock, maps the
 *     caret onto the new atom).
 * EXPLICIT user selection (click, arrow keys) is ordinary ProseMirror
 * semantics and never passes through this guard (#679).
 *
 * Two landing policies, because the two boundaries own different invariants:
 *   - "nearest" (RESTORE): adoption of a persisted draft only needs a safe
 *     caret; the nearest text cursor wins, backward included.
 *   - "after" (OPERATIONS that produce or move a formula): prose typed next
 *     must CONTINUE DIRECTLY AFTER the formula — the caret takes the text
 *     position at the atom's end or the paragraph flush against it, and when
 *     neither exists a landing paragraph is appended at the atom's end. The
 *     scan never crosses a block (#681 review F6): reaching a distant
 *     paragraph past a neighbouring formula/list/table moves the candidate's
 *     typing across blocks they did not type past. Backward search is
 *     forbidden — text landing ahead of a just-produced formula reorders the
 *     answer. The anchor is the operation-PRODUCED atom, not merely the
 *     selected one: input rules anchor at the receipt's replacement because
 *     their mapped selection can drift onto a neighbour.
 *
 * The text-only scan skips atoms, so a neighbouring formula is never
 * selected. The landing paragraph is editor-only: it canonicalizes away on
 * the next emitted document (trailing empty paragraphs are not canonical),
 * and the restore paths dispatch it quiet, so establishing the caret never
 * triggers an autosave by itself.
 */
export function settleImplicitMathSelection(
  editor: Editor,
  options: { quiet?: boolean; landing?: MathSettlementLanding } = {},
): void {
  const tr = implicitMathSelectionFix(editor.state, options.landing ?? "after");
  if (!tr) return;
  if (options.quiet) {
    // Restore boundary: the settlement is not a user edit — no update emit
    // (no autosave echo) and no history entry the candidate would have to
    // undo through.
    tr.setMeta("preventUpdate", true);
    tr.setMeta("addToHistory", false);
  }
  editor.view.dispatch(tr);
}

type MathSettlementLanding = "nearest" | "after";

/**
 * The undo receipt tiptap's input-rules plugin stores in its state meta
 * (`run()` records it after a rule's handler mutated the transaction): the
 * rule transaction itself, the keystroke range, and the typed text.
 */
type InputRuleReceipt = {
  transform: Transform;
  from: number;
  to: number;
  text: string;
};

/**
 * The document position just after the math atom an input rule produced, or
 * null when the receipt's steps inserted no math atom. The rule's mapped
 * selection may drift onto a NEIGHBOURING atom (Selection.near through the
 * whole-textblock replacement), so the "after" anchor cannot be read off the
 * selection — it must come from the receipt's own replacement steps.
 */
function inputRuleProducedMathEnd(receipt: InputRuleReceipt): number | null {
  const { steps, mapping } = receipt.transform;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (!(step instanceof ReplaceStep)) continue;
    const produced = step.slice.content.firstChild;
    if (!produced || !MATH_NODE_NAMES.has(produced.type.name)) continue;
    return mapping.slice(i + 1).map(step.from + step.slice.size, 1);
  }
  return null;
}

/**
 * The decision of settleImplicitMathSelection as a pure transaction builder,
 * shared with the paste/drop plugin (whose fix joins the paste transaction
 * instead of dispatching its own). Returns null when the state needs no fix.
 * `producedMathEnd` overrides the selected atom as the "after" anchor when
 * the caller knows the operation-produced atom's end (input rules).
 */
function implicitMathSelectionFix(
  state: EditorState,
  landing: MathSettlementLanding = "after",
  producedMathEnd?: number,
): Transaction | null {
  const { selection, doc, schema } = state;
  if (!(selection instanceof NodeSelection)) return null;
  if (!MATH_NODE_NAMES.has(selection.node.type.name)) return null;
  const tr = state.tr;
  const atomEnd = producedMathEnd ?? selection.to;
  const $end = doc.resolve(atomEnd);
  if (landing === "after") {
    // INVARIANT (#681 review F4/F6): continuation is DIRECTLY after the
    // operation-produced formula. The caret takes the text position at the
    // atom's end (inline atoms) or the paragraph flush against it; when
    // neither exists, a landing paragraph is appended at the atom's end. No
    // unrestricted scan — textOnly findFrom skips atoms, so a distant
    // paragraph past a neighbouring formula/list/table would move the
    // candidate's typing across blocks they did not type past.
    if ($end.parent.inlineContent) {
      tr.setSelection(TextSelection.create(doc, atomEnd));
      return tr;
    }
    const next = $end.nodeAfter;
    if (next?.type === schema.nodes.paragraph) {
      tr.setSelection(TextSelection.create(doc, atomEnd + 1));
      return tr;
    }
  } else {
    // Restore only needs a safe caret: the nearest text cursor wins,
    // backward included.
    const forward = Selection.findFrom($end, 1, true);
    if (forward) {
      tr.setSelection(forward);
      return tr;
    }
    const backward = Selection.findFrom(doc.resolve(selection.from), -1, true);
    if (backward) {
      tr.setSelection(backward);
      return tr;
    }
  }
  // No text cursor directly ahead of the atom — give ordinary typing a
  // landing zone it cannot replace. Operations append it directly after the
  // atom (see the policy note above); restore, adopting the document as a
  // whole, parks the caret at the document end.
  const insertPos = landing === "after" ? atomEnd : doc.content.size;
  const paragraph = schema.nodes.paragraph?.create();
  if (!paragraph) return null;
  tr.insert(insertPos, paragraph);
  const caret = Selection.findFrom(tr.doc.resolve(insertPos), 1, true);
  if (!caret) return null;
  tr.setSelection(caret);
  return tr;
}

/**
 * The operation boundary: transactions the view or the input-rule machinery
 * dispatch without a user selection gesture, which can leave a math atom
 * under a NodeSelection.
 *   - paste / drop: the view tags both with a `uiEvent` meta (#673 C13);
 *   - math input rules: the rules run inside `handleTextInput`, and tiptap
 *     tags the transaction with the input-rules plugin's own state meta
 *     (`spec.isInputRules` — the same marker `undoInputRule` reads) (#673
 *     C15).
 * Normalizing ONLY those transactions keeps explicit user selection
 * untouched — every other NodeSelection path (click, keyboard, plugin) is
 * unaffected (#679).
 */
const SettleMathSelectionAfterOperation = Extension.create({
  name: "settleMathSelectionAfterOperation",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("settleMathSelectionAfterOperation"),
        appendTransaction: (transactions, _oldState, newState) => {
          const inputRulePlugins = newState.plugins.filter(
            (plugin) =>
              "isInputRules" in plugin.spec &&
              plugin.spec.isInputRules === true,
          );
          let receiptPlugin: (typeof inputRulePlugins)[number] | null = null;
          let receipt: unknown;
          const operationProduced = transactions.some((tr) => {
            if (
              tr.getMeta("uiEvent") === "paste" ||
              tr.getMeta("uiEvent") === "drop"
            ) {
              return true;
            }
            return inputRulePlugins.some((plugin) => {
              const meta = tr.getMeta(plugin);
              if (meta === undefined) return false;
              // Keep the LAST receipt: a batch may hold several rule runs and
              // the plugin state mirrors exactly the newest one.
              receiptPlugin = plugin;
              receipt = meta;
              return true;
            });
          });
          if (!operationProduced) return null;
          // INVARIANT (#681 review F4): "after" means after the
          // operation-PRODUCED math node. Input rules are the special case —
          // the rule's mapped selection can drift onto a neighbouring atom —
          // so the anchor comes from the receipt's replacement, not from the
          // NodeSelection; toolbar/paste/drop select their own target, and
          // keep the selection anchor.
          const producedMathEnd =
            receiptPlugin && receipt
              ? inputRuleProducedMathEnd(receipt as InputRuleReceipt)
              : null;
          const fix = implicitMathSelectionFix(
            newState,
            "after",
            producedMathEnd ?? undefined,
          );
          if (!fix) return null;
          if (receiptPlugin && receipt) {
            // Preserve the input-rules undo receipt across the settlement: the
            // plugin's reducer drops it on any foreign selectionSet/docChanged
            // transaction, and the Backspace binding tries undoInputRule()
            // first — without this copy the rule-made formula could not be
            // undone back to its typed source.
            //
            // The receipt's transform must also COVER the settlement:
            // undoInputRule inverts only the recorded transform's steps, so a
            // landing paragraph inserted here would otherwise survive the undo
            // as structure residue (#681 review F5). The receipt's transform
            // doc is the post-rule document the fix steps were computed
            // against, so they apply onto it verbatim; the eq guard keeps a
            // larger batch from folding steps that could not invert cleanly.
            const recorded = receipt as InputRuleReceipt;
            if (recorded.transform.doc.eq(newState.doc)) {
              for (const step of fix.steps) recorded.transform.step(step);
            }
            fix.setMeta(receiptPlugin, receipt);
          }
          return fix;
        },
      }),
    ];
  },
});

/**
 * Applies a confirmed formula edit to the editor — the dialog confirm path
 * for both inserts (target null) and re-edits. Exported for the reality
 * suite: the mode decision must be proven against the real schema, not a
 * component mock.
 */
export function applyFormulaEdit(
  editor: Editor,
  target: FormulaDialogTarget | null,
  latex: string,
  display: boolean,
): void {
  // FRESH-context clamp (C14): the dialog's blockAllowed is an OPEN-TIME
  // snapshot and the context can change while the dialog is open
  // (authoritative replacement / restore), so the persisted node type is
  // re-derived from the live editor AT CONFIRM TIME. A 独立显示 result never
  // persists inside a list item or table cell — writing a blockMath there
  // would only save as math because the canonical adapter silently downgrades
  // it afterwards, diverging candidate-visible semantics from persisted
  // semantics. Every final node choice below uses this value, not the raw
  // choice.
  const persistableDisplay =
    display && !editor.isActive("listItem") && !editor.isActive("table");
  if (target && target.pos !== undefined) {
    const atom = editor.state.doc.nodeAt(target.pos);
    if (!atom || !MATH_NODE_NAMES.has(atom.type.name)) {
      // The targeted atom vanished under the dialog (undo elsewhere,
      // authoritative replacement) — do not write into a stale position.
      return;
    }
    // Identity guard (review U-R6): a DIFFERENT atom may now sit at the
    // remembered position (undo of an insert, authoritative replacement).
    // Type-at-position alone would let the edit land in the wrong formula;
    // require the opened latex to still match before writing.
    const targetIsBlock = target.display;
    if (
      (atom.type.name === "blockMath") !== targetIsBlock ||
      atom.attrs.latex !== target.latex
    ) {
      return;
    }
    const atomIsBlock = atom.type.name === "blockMath";
    if (persistableDisplay === atomIsBlock) {
      if (persistableDisplay) {
        editor
          .chain()
          .focus()
          .updateBlockMath({ latex, pos: target.pos })
          .run();
      } else {
        editor
          .chain()
          .focus()
          .updateInlineMath({ latex, pos: target.pos })
          .run();
      }
      return;
    }
    // 行内 ↔ 独立显示 conversion: different node types, so the atom is
    // replaced in place, then the operation settlement re-runs — the
    // replacement atom is operation-produced (#676 guard). A clamped
    // 独立显示 converts the existing blockMath to inline math in place.
    editor
      .chain()
      .insertContentAt(
        {
          from: target.pos,
          to: target.pos + (target.nodeSize ?? atom.nodeSize),
        },
        {
          type: persistableDisplay ? "blockMath" : "inlineMath",
          attrs: { latex },
        },
      )
      .run();
    settleImplicitMathSelection(editor);
    return;
  }
  editor
    .chain()
    .focus()
    .insertContent({
      type: persistableDisplay ? "blockMath" : "inlineMath",
      attrs: { latex },
    })
    .run();
  // Not quiet: the insert is a real edit and the settlement's possible
  // landing paragraph belongs to it.
  settleImplicitMathSelection(editor);
}

/**
 * WYSIWYG rich-text editor. The EDIT surface — the ONLY place
 * Tiptap/ProseMirror is imported, always reached through the lazy wrapper
 * (RichContentEditorLazy) so plain-mode bundles never download it.
 *
 * Extension allow-list mirrors the frozen ContentDocumentV1 grammar exactly:
 * no StarterKit, no image/link/mention. The editor is NOT the storage
 * authority: every change is mapped through contentAdapter into the canonical
 * grammar and surfaced via onChange; the server re-validates on write.
 *
 * Math nodes render through the Mathematics extension with trust disabled —
 * same posture as the read-side KaTeX seam. The command bar, formula surface
 * and table controls are the presentation layer over this editor (contract
 * docs/design/candidate-rich-editor-ux.md); they add no grammar.
 */
export default function RichContentEditor({
  document,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  document: ContentDocumentV1;
  onChange: (document: ContentDocumentV1) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  // Keep the latest callback without re-creating the editor on parent
  // re-render — keystrokes must not re-render this component's React tree.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // INVARIANT: currentEditorDocumentRef === canonical document currently held
  // by Tiptap. useRef's initializer captures the FIRST render's document —
  // exactly the one useEditor consumed at creation — and every local edit or
  // applied replacement below re-anchors it.
  const currentEditorDocumentRef = useRef<ContentDocumentV1 | null>(document);

  // The formula surface is React state; the editor extensions are created
  // once. This ref forwards activation events (atom click / Enter) to the
  // latest handler without re-creating the editor.
  const formulaRequestRef = useRef<(activation: FormulaActivation) => void>(
    () => {},
  );

  const editor = useEditor({
    extensions: richEditorExtensions({
      placeholder: t("candidateRuntime.answer.subjective.placeholder"),
      onFormulaActivate: (activation) => formulaRequestRef.current(activation),
      formulaAtomLabel: (latex) => t("content.formula.atomLabel", { latex }),
    }),
    content: toEditorContent(document),
    editable: !disabled,
    onUpdate: ({ editor }) => {
      try {
        const next = tiptapToContentDocument(editor.getJSON());
        // LOCAL EDIT: re-anchor the ownership ref to the document Tiptap now
        // holds BEFORE surfacing it, so a later authoritative replacement back
        // to an older baseline is never skipped as a stale "already applied".
        currentEditorDocumentRef.current = next;
        onChangeRef.current(next);
      } catch {
        // Unmappable node (extension regression): keep the last good
        // document instead of emitting out-of-grammar data.
      }
    },
    editorProps: {
      attributes: {
        // Explicit ARIA role: contenteditable's implicit textbox role is not
        // reliably exposed to programmatic a11y trees (jsdom 29 reflects no
        // contentEditable IDL property), and the answer surface must be
        // queryable by role — never again accidentally satisfied by an
        // unrelated input (the removed bare LaTeX field was what the first
        // role=textbox assertion matched).
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel ?? t("content.editor.label"),
        class:
          "type-body min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
      },
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    // C12 restore boundary: editor creation adopts the persisted draft with
    // Selection.atStart — a textblock-less draft opens with its first formula
    // under a NodeSelection the next keystroke would destroy. Quiet: no
    // update emit, so establishing a safe caret never autosaves by itself.
    settleImplicitMathSelection(editor, { quiet: true, landing: "nearest" });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    if (
      !isAuthoritativeReplacement(document, currentEditorDocumentRef.current)
    ) {
      // PARENT LOCAL ECHO: the prop is the document this editor just emitted —
      // structurally equal to what Tiptap holds. Skip; setContent here would
      // reset the caret and fight the user's keystrokes.
      return;
    }
    // AUTHORITATIVE EXTERNAL REPLACEMENT — server reconciliation, restore, or
    // parent reset. The editor adopts it as its new baseline; emitUpdate:false
    // so the reset does not echo back through onUpdate into a save loop.
    currentEditorDocumentRef.current = document;
    editor.commands.setContent(toEditorContent(document), {
      emitUpdate: false,
    });
    // Same restore boundary as creation: the adopted document must not open
    // ordinary typing onto a selected math atom, and the settlement must not
    // itself trigger a save (quiet).
    settleImplicitMathSelection(editor, { quiet: true, landing: "nearest" });
  }, [editor, document]);

  // ---- formula surface state ----
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formulaTarget, setFormulaTarget] =
    useState<FormulaDialogTarget | null>(null);
  const [formulaBlockAllowed, setFormulaBlockAllowed] = useState(true);
  const formulaTargetRef = useRef<FormulaDialogTarget | null>(null);
  formulaTargetRef.current = formulaTarget;

  /** 独立显示 persists only outside list items / table cells (C14 downgrade). */
  function blockMathPersistsHere(): boolean {
    if (!editor) return false;
    return !editor.isActive("listItem") && !editor.isActive("table");
  }

  formulaRequestRef.current = (activation: FormulaActivation) => {
    // The Mathematics extension binds its click handler unconditionally; the
    // editable gate lives at the activation sink so a disabled editor
    // (locked attempt, shared read/edit consumers) never opens the formula
    // surface (review U-R11).
    if (!editor?.isEditable) return;
    setFormulaTarget({
      latex: activation.latex,
      display: activation.display,
      pos: activation.pos,
      nodeSize: activation.nodeSize,
    });
    setFormulaBlockAllowed(blockMathPersistsHere());
    setFormulaOpen(true);
  };

  const commands = useMemo(
    () =>
      buildEditorCommands({
        openFormula: () => {
          setFormulaTarget(null);
          setFormulaBlockAllowed(blockMathPersistsHere());
          setFormulaOpen(true);
        },
      }),
    // blockMathPersistsHere reads the live editor at invocation time; the
    // catalogue itself is editor-independent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor],
  );

  /** Applies a confirmed formula edit through the existing math commands. */
  function applyFormula(latex: string, display: boolean) {
    if (!editor) return;
    applyFormulaEdit(editor, formulaTargetRef.current, latex, display);
  }

  if (!editor) return null;

  return (
    <div className="flex flex-col gap-2">
      <RichEditorToolbar
        editor={editor}
        commands={commands}
        disabled={disabled}
      />
      <TableContextualBar editor={editor} disabled={disabled} />
      <EditorContent editor={editor} />
      <FormulaEditorDialog
        open={formulaOpen}
        onOpenChange={(open) => {
          setFormulaOpen(open);
          // A dismissed surface returns the candidate to the writing
          // surface: Escape/overlay-close routes through Radix, which
          // restores focus to the page, not the editor (the confirm path
          // refocuses through its command chain). Selection-only, so no
          // update event and no save can ride on it.
          if (!open) editor.commands.focus();
        }}
        target={formulaTarget}
        blockAllowed={formulaBlockAllowed}
        onConfirm={applyFormula}
      />
    </div>
  );
}
