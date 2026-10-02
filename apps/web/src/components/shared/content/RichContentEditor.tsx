import { useEffect, useRef } from "react";
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { NodeSelection, Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
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
import "katex/dist/katex.min.css";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ContentDocumentV1 } from "@exam/domain";
import {
  contentDocumentToTiptap,
  contentDocumentsEqual,
  tiptapToContentDocument,
} from "./contentAdapter";

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
 */
export function richEditorExtensions() {
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
    }),
    SettleMathSelectionAfterOperation,
  ];
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
 *     must CONTINUE AFTER the formula. Backward search is forbidden — text
 *     landing ahead of a just-produced formula reorders the answer — so when
 *     no text cursor lies ahead, a paragraph is appended directly after the
 *     atom as the typing landing zone.
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
 * The decision of settleImplicitMathSelection as a pure transaction builder,
 * shared with the paste/drop plugin (whose fix joins the paste transaction
 * instead of dispatching its own). Returns null when the state needs no fix.
 */
function implicitMathSelectionFix(
  state: EditorState,
  landing: MathSettlementLanding = "after",
): Transaction | null {
  const { selection, doc, schema } = state;
  if (!(selection instanceof NodeSelection)) return null;
  if (!MATH_NODE_NAMES.has(selection.node.type.name)) return null;
  const tr = state.tr;
  const forward = Selection.findFrom(doc.resolve(selection.to), 1, true);
  if (forward) {
    tr.setSelection(forward);
    return tr;
  }
  if (landing === "nearest") {
    const backward = Selection.findFrom(doc.resolve(selection.from), -1, true);
    if (backward) {
      tr.setSelection(backward);
      return tr;
    }
  }
  // No text cursor ahead of the atom — give ordinary typing a landing zone
  // it cannot replace. Restore adopts the document as a whole and parks the
  // caret at the document end; operations own the atom they produced, so
  // their landing zone goes directly after it (see the policy note above).
  const insertPos = landing === "after" ? selection.to : doc.content.size;
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
          const fix = implicitMathSelectionFix(newState);
          if (!fix) return null;
          // Preserve the input-rules undo receipt across the settlement: the
          // plugin's reducer drops it on any foreign selectionSet/docChanged
          // transaction, and the Backspace binding tries undoInputRule()
          // first — without this copy the rule-made formula could not be
          // undone back to its typed source. The receipt's transform still
          // references the rule's own transaction, whose replacement range
          // the settlement (insertion strictly AFTER the atom) never shifts.
          if (receiptPlugin) fix.setMeta(receiptPlugin, receipt);
          return fix;
        },
      }),
    ];
  },
});

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
 * same posture as the read-side KaTeX seam.
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

  const editor = useEditor({
    extensions: richEditorExtensions(),
    content: contentDocumentToTiptap(document),
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
    editor.commands.setContent(contentDocumentToTiptap(document), {
      emitUpdate: false,
    });
    // Same restore boundary as creation: the adopted document must not open
    // ordinary typing onto a selected math atom, and the settlement must not
    // itself trigger a save (quiet).
    settleImplicitMathSelection(editor, { quiet: true, landing: "nearest" });
  }, [editor, document]);

  const mathInputRef = useRef<HTMLInputElement>(null);

  function insertMath(displayMode: boolean) {
    const latex = mathInputRef.current?.value.trim();
    if (!latex || !editor) return;
    editor
      .chain()
      .focus()
      .insertContent({
        type: displayMode ? "blockMath" : "inlineMath",
        attrs: { latex },
      })
      .run();
    // Not quiet: the insert is a real edit and the settlement's possible
    // landing paragraph belongs to it.
    settleImplicitMathSelection(editor);
    if (mathInputRef.current) mathInputRef.current.value = "";
  }

  if (!editor) return null;

  const btn = (command: () => void, label: string) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onMouseDown={(e) => e.preventDefault()}
      onClick={command}
    >
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {btn(
          () => editor.chain().focus().toggleBold().run(),
          t("content.editor.bold"),
        )}
        {btn(
          () => editor.chain().focus().toggleItalic().run(),
          t("content.editor.italic"),
        )}
        {btn(
          () => editor.chain().focus().toggleUnderline().run(),
          t("content.editor.underline"),
        )}
        {btn(
          () => editor.chain().focus().toggleCode().run(),
          t("content.editor.inlineCode"),
        )}
        {btn(
          () => editor.chain().focus().toggleBulletList().run(),
          t("content.editor.bulletList"),
        )}
        {btn(
          () => editor.chain().focus().toggleOrderedList().run(),
          t("content.editor.orderedList"),
        )}
        {btn(
          () => editor.chain().focus().toggleCodeBlock().run(),
          t("content.editor.codeBlock"),
        )}
        {btn(
          () =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 2, cols: 2, withHeaderRow: false })
              .run(),
          t("content.editor.table"),
        )}
        <input
          ref={mathInputRef}
          type="text"
          placeholder={t("content.editor.latexPlaceholder")}
          className="w-40 rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring"
        />
        {btn(() => insertMath(false), t("content.editor.inlineMath"))}
        {btn(() => insertMath(true), t("content.editor.blockMath"))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
