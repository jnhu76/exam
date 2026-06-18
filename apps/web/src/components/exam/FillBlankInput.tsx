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
  const normalizedBlanks =
    blanks.length > 0
      ? blanks
      : Array.from({
          length: Math.max(1, content.split("____").length - 1),
        }).map((_, index) => ({
          id: `blank-${index + 1}`,
          content: `第${index + 1}空`,
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
            第{i + 1}空:
          </span>
          <input
            type="text"
            value={isSingleBlank ? singleValue : (recordValue[blank.id] ?? "")}
            onChange={(e) => handleChange(blank.id, e.target.value)}
            disabled={disabled}
            className={`flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
            placeholder="请输入答案"
            aria-label={`第${i + 1}空答案`}
          />
        </div>
      ))}
    </div>
  );
}
