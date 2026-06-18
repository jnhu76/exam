/**
 * Radio-button input for true/false (judgment) questions,
 * offering "正确" (true) and "错误" (false) options.
 */
export function TrueFalseInput({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean | undefined;
  onChange: (answer: unknown) => void;
  disabled?: boolean;
}) {
  const options = [
    { value: true, label: "正确" },
    { value: false, label: "错误" },
  ];

  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => (
        <label
          key={String(option.value)}
          className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${value === option.value ? "border-primary bg-primary/5" : !disabled && "hover:bg-muted/50"}`}
        >
          <input
            type="radio"
            name="true-false"
            value={String(option.value)}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            disabled={disabled}
            className="size-4 accent-primary"
            data-testid={`true-false-${option.value}`}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
