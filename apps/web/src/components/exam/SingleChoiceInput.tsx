/**
 * Radio-button input for single-choice questions.
 * Renders a list of options and reports the selected option ID.
 */
export function SingleChoiceInput({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: { id: string; content: string }[];
  value: string | undefined;
  onChange: (answer: unknown) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => (
        <label
          key={option.id}
          className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${value === option.id ? "border-primary bg-primary/5" : !disabled && "hover:bg-muted/50"}`}
        >
          <input
            type="radio"
            name="single-choice"
            value={option.id}
            checked={value === option.id}
            onChange={() => onChange(option.id)}
            disabled={disabled}
            className="size-4 accent-primary"
          />
          <span>{option.content}</span>
        </label>
      ))}
    </div>
  );
}
