import { useEffect, useRef } from "react";
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
    extensions: [
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
        // Grammar tables are unspanned; never offer header rows.
      }),
    ],
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
