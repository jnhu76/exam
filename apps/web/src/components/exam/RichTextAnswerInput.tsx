import { plainTextToDocument } from "@exam/domain";
import { classifyPersistedRichAnswer } from "@/components/shared/content/richAnswer";
import { RichContentEditorLazy } from "@/components/shared/content/RichContentEditorLazy";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useTranslation } from "react-i18next";

/**
 * Rich answer input for `text_response` questions authored with
 * `answerMode: "rich"` (issue 301). The `value` prop is interpreted through
 * the shared persisted-read authority (§7 read contract, #669 Phase D3):
 * only states whose editability is semantically justified mount the editor —
 *
 *   rich_valid / rich_noncanonical → the persisted document as-is
 *   empty                          → an explicitly empty editor
 *   plain / legacy_plain           → the authorized kernel upgrade mapping
 *                                    (plainTextToDocument)
 *
 * `unsupported_version` and `corrupt` FAIL CLOSED: an integrity notice is
 * rendered instead of an editor, so no initial onChange/autosave can ever
 * replace the persisted source with synthetic empty content
 * (CORRUPT_PERSISTED_RICH != EMPTY_DOCUMENT).
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
    case "rich_noncanonical":
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
          document={plainTextToDocument("")}
          onChange={onChange}
          disabled={disabled}
          ariaLabel={ariaLabel}
        />
      );
    case "plain":
    case "legacy_plain":
      return (
        <RichContentEditorLazy
          document={plainTextToDocument(read.text)}
          onChange={onChange}
          disabled={disabled}
          ariaLabel={ariaLabel}
        />
      );
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
