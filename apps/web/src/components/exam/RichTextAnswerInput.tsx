import {
  isContentDocumentV1,
  plainTextToDocument,
  type ContentDocumentV1,
} from "@exam/domain";
import { RichContentEditorLazy } from "@/components/shared/content/RichContentEditorLazy";

/**
 * Rich answer input for `text_response` questions authored with
 * `answerMode: "rich"` (issue 301). The saved answer is a canonical
 * ContentDocumentV1; a legacy plain-string draft (saved before the mode
 * switch) is upgraded into a document so nothing the candidate typed is lost.
 *
 * OWNERSHIP (issue 301 corrective pass): the caller MUST key this component
 * by question identity — a question switch must remount the editor, never
 * reuse the previous question's Tiptap document. The `value` prop is the
 * authoritative answer: it seeds the editor at mount and is re-applied
 * whenever it is externally replaced (e.g. STALE_VERSION server
 * reconciliation), while local-edit echoes from the parent state round-trip
 * are recognized and ignored (see RichContentEditor).
 */
export function RichTextAnswerInput({
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: unknown;
  onChange: (answer: unknown) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const document: ContentDocumentV1 = isContentDocumentV1(value)
    ? value
    : plainTextToDocument(typeof value === "string" ? value : "");
  return (
    <RichContentEditorLazy
      document={document}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={ariaLabel}
    />
  );
}
