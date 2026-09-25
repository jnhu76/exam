import { Input } from "@/components/ui/input";
import { useDataViewTextCommit } from "@/hooks/useDataViewTextCommit";

/**
 * The exact-text filter control for a data-view toolbar.
 *
 * An exact-identifier filter (exam ID, candidate ID, …) is NOT fuzzy search,
 * so it must not wear search semantics: no leading search icon, no "clear the
 * search" affordance, no placeholder promising free-text matching. What it
 * DOES share with search is the commit choreography — draft, debounce, blur
 * flush, Enter flush — which is owned once by useDataViewTextCommit.
 *
 * Width belongs to the toolbar's semantic tier, not to this control: pages
 * wrap it in `<ToolbarFilter size="wide">`, exactly like the enum selects use
 * `size="narrow"` (docs/standards/ui-system.md).
 */
export function TextFilterInput({
  value,
  onChange,
  onCommit,
  placeholder,
  debounceMs = 300,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  /** Host state update — fires on every keystroke. */
  onChange: (value: string) => void;
  /** Commit the settled value (server query / URL parameter). */
  onCommit: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const commit = useDataViewTextCommit({
    value,
    onChange,
    onCommit,
    debounceMs,
  });

  return (
    <Input
      type="text"
      value={commit.value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => commit.change(event.target.value)}
      onBlur={commit.flush}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit.flush();
      }}
      className={className}
    />
  );
}
