import { useTranslation } from "react-i18next";

/**
 * Input component for fill-in-the-blank questions. Supports single-blank
 * (string value) and multi-blank (record value) modes, with auto-detection
 * of blank count from the question content.
 */
export function FillBlankInput({
  content,
  blanks,
  value,
  onChange,
  disabled = false,
}: {
  content: string;
  blanks: { id: string; content: string }[];
  value: Record<string, string> | string;
  onChange: (answer: unknown) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const normalizedBlanks =
    blanks.length > 0
      ? blanks
      : Array.from({
          length: Math.max(1, content.split("____").length - 1),
        }).map((_, index) => ({
          id: `blank-${index + 1}`,
          content: t("candidateRuntime.answer.fillBlank.blankLabel", {
            number: index + 1,
          }),
        }));

  const recordValue: Record<string, string> =
    typeof value === "string" ? {} : value;
  const isSingleBlank = normalizedBlanks.length === 1;
  const singleBlankId = normalizedBlanks[0]?.id;
  const singleValue =
    typeof value === "string"
      ? value
      : singleBlankId
        ? (recordValue[singleBlankId] ?? "")
        : "";

  function handleChange(id: string, text: string) {
    if (isSingleBlank) {
      onChange(text);
      return;
    }
    onChange({ ...recordValue, [id]: text });
  }

  return (
    <div className="flex flex-col gap-4">
      {normalizedBlanks.map((blank, i) => (
        <div key={blank.id} className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">
            {t("candidateRuntime.answer.fillBlank.blankLabel", {
              number: i + 1,
            })}
            :
          </span>
          <input
            type="text"
            value={isSingleBlank ? singleValue : (recordValue[blank.id] ?? "")}
            onChange={(e) => handleChange(blank.id, e.target.value)}
            disabled={disabled}
            className={`flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
            placeholder={t("candidateRuntime.answer.fillBlank.placeholder")}
            aria-label={t("candidateRuntime.answer.fillBlank.blankInputLabel", {
              number: i + 1,
            })}
          />
        </div>
      ))}
    </div>
  );
}
