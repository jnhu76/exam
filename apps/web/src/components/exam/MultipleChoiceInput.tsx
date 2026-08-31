import type { ContentDocumentV1 } from "@exam/domain";
import { ContentRenderer } from "@/components/shared/content/ContentRenderer";

/**
 * Checkbox-based input for multiple-choice questions.
 * Allows toggling individual options and returns a sorted array of selected
 * IDs. Option labels render through the static ContentRenderer so rich
 * option content (issue 301) displays exactly as in the read path.
 */
export function MultipleChoiceInput({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: {
    id: string;
    content: string;
    contentDocument?: ContentDocumentV1 | null;
  }[];
  value: string[];
  onChange: (answer: unknown) => void;
  disabled?: boolean;
}) {
  const selected = new Set(value);

  function toggle(id: string) {
    if (disabled) return;
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
          className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${selected.has(option.id) ? "border-primary bg-primary/5" : !disabled && "hover:bg-muted/50"}`}
        >
          <input
            type="checkbox"
            checked={selected.has(option.id)}
            onChange={() => toggle(option.id)}
            disabled={disabled}
            className="size-4 accent-primary"
          />
          <ContentRenderer
            content={option.content}
            document={option.contentDocument}
          />
        </label>
      ))}
    </div>
  );
}
