/**
 * Checkbox-based input for multiple-choice questions.
 * Allows toggling individual options and returns a sorted array of selected IDs.
 */
export function MultipleChoiceInput({
  options,
  value,
  onChange,
}: {
  options: { id: string; content: string }[];
  value: string[];
  onChange: (answer: unknown) => void;
}) {
  const selected = new Set(value);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange(Array.from(next).sort());
  }

  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => (
        <label
          key={option.id}
          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${selected.has(option.id) ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
        >
          <input
            type="checkbox"
            checked={selected.has(option.id)}
            onChange={() => toggle(option.id)}
            className="size-4 accent-primary"
          />
          <span>{option.content}</span>
        </label>
      ))}
    </div>
  );
}
