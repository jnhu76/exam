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
 * switch) is upgraded into a document on mount so nothing the candidate
 * typed is lost.
 *
 * The initial document is consumed at mount; like Tiptap itself, the editor
 * owns its state afterwards and pushes canonical documents up through
 * onChange (the server re-validates the shape on save).
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
  const initialDocument: ContentDocumentV1 = isContentDocumentV1(value)
    ? value
    : plainTextToDocument(typeof value === "string" ? value : "");
  return (
    <RichContentEditorLazy
      initialDocument={initialDocument}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={ariaLabel}
    />
  );
}
