import { normalizeContentDocument, plainTextToDocument } from "@exam/domain";
import { classifyPersistedRichAnswer } from "@exam/contracts";
import { RichContentEditorLazy } from "@/components/shared/content/RichContentEditorLazy";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useTranslation } from "react-i18next";

/**
 * Rich answer input for `text_response` questions authored with
 * `answerMode: "rich"` (issue 301). The `value` prop is interpreted through
 * the shared persisted-read authority (§7 read contract, #669 Phase D3):
 * only states whose editability is semantically justified mount the editor —
 *
 *   rich_valid             → the persisted document as-is
 *   empty                  → an explicitly empty editor
 *   plain / legacy_plain   → the authorized kernel upgrade mapping
 *                            (plainTextToDocument)
 *
 * `rich_noncanonical`, `unsupported_version` and `corrupt` FAIL CLOSED: an
 * integrity notice is rendered instead of an editor, so no initial
 * onChange/autosave can ever replace the persisted source with synthetic or
 * normalized content (CORRUPT_PERSISTED_RICH != EMPTY_DOCUMENT).
 *
 * INVARIANT: persisted content must earn editability. A noncanonical value
 * must not mount even though it is interpretable — the editor's onUpdate
 * path re-serializes through canonicalization, so mounting it would turn
 * read classification into a silent repair write of never-edited content,
 * and for the PC-F01 closure class the canonicalized form itself exceeds
 * CONTENT_LIMITS, producing an editor whose output can never save. Repair
 * of such values is a future explicit policy, never read-time behavior.
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
  answerMode,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: unknown;
  answerMode: string | null | undefined;
  onChange: (answer: unknown) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const read = classifyPersistedRichAnswer({ value, answerMode });
  switch (read.kind) {
    case "rich_valid":
      return (
        <RichContentEditorLazy
          document={read.document}
          onChange={onChange}
          disabled={disabled}
          ariaLabel={ariaLabel}
        />
      );
    case "empty":
      return (
        <RichContentEditorLazy
          // CANONICAL mount form: the editor's update path emits
          // canonicalized documents (normalizeContentDocument), so the mount
          // value must live in the same canonical space. Mounting the raw
          // plainTextToDocument shape ({paragraph:[]}) against the canonical
          // echo ({content:[]}) made the two-way ownership protocol flip-flop
          // (each side read as an authoritative replacement of the other),
          // dispatching setContent twice at mount — with the side effect of
          // no-op undo history entries. See RichContentEditor's ownership
          // protocol.
          document={normalizeContentDocument(plainTextToDocument(""))}
          onChange={onChange}
          disabled={disabled}
          ariaLabel={ariaLabel}
        />
      );
    case "plain":
    case "legacy_plain":
      return (
        <RichContentEditorLazy
          document={normalizeContentDocument(plainTextToDocument(read.text))}
          onChange={onChange}
          disabled={disabled}
          ariaLabel={ariaLabel}
        />
      );
    case "rich_noncanonical":
    case "unsupported_version":
    case "corrupt":
      return (
        <Alert variant="destructive" data-testid="rich-answer-integrity-error">
          <AlertDescription>
            {t("content.unsafeEditableAnswer")}
          </AlertDescription>
        </Alert>
      );
  }
}
