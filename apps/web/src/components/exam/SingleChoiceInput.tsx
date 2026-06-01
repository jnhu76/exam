export function SingleChoiceInput({
  options,
  value,
  onChange,
}: {
  options: { id: string; content: string }[];
  value: string | undefined;
  onChange: (answer: unknown) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((option) => (
        <label
          key={option.id}
          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${value === option.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
        >
          <input
            type="radio"
            name="single-choice"
            value={option.id}
            checked={value === option.id}
            onChange={() => onChange(option.id)}
            className="size-4 accent-primary"
          />
          <span>{option.content}</span>
        </label>
      ))}
    </div>
  );
}
