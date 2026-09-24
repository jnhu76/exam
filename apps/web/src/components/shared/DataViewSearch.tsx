import { SearchInput } from "@/components/shared/SearchInput";
import { useDataViewTextCommit } from "@/hooks/useDataViewTextCommit";

/**
 * Debounced free-text search field for data toolbars.
 *
 * Wraps SearchInput (the visual authority — leading icon, clear button, focus
 * ring, placeholder) and adds the search commit contract: the shared
 * text-commit choreography (useDataViewTextCommit — draft, debounce, clear),
 * an optional loading flag for the in-flight query, and a controlled
 * `value`/`onSearch` pair where `onSearch` receives the DEBOUNCED term (not
 * every keystroke).
 *
 * The input is FULLY CONTROLLED by `value` (no divergent local state): typing
 * calls onChange immediately so the host can update its own input state, while
 * the debounced `onSearch` fires only after typing settles. This keeps the
 * displayed text and the committed value in lockstep — a clear/reset from the
 * host is reflected instantly, with no stale local copy and no pending debounce
 * overwriting it. This is what removes the "search box jumps / refetches on
 * every keystroke" jitter.
 *
 * Fuzzy search is the only control that wears this presentation; an
 * exact-identifier filter uses TextFilterInput (same commit contract, no fake
 * search semantics).
 */
export function DataViewSearch({
  value,
  onChange,
  onSearch,
  onClear,
  placeholder,
  clearLabel,
  loading = false,
  debounceMs = 300,
  disabled = false,
  className,
  containerClassName,
  "aria-label": ariaLabel,
}: {
  /** The current input value (host-owned; reflected immediately). */
  value: string;
  /** Immediate change callback — host updates its input state synchronously. */
  onChange: (value: string) => void;
  /** Fired with the debounced term after typing settles. */
  onSearch: (term: string) => void;
  /** Optional explicit clear handler; defaults to onChange(""). */
  onClear?: () => void;
  placeholder?: string;
  clearLabel?: string;
  /** Show the query-in-flight indicator (consumer controls the request). */
  loading?: boolean;
  debounceMs?: number;
  disabled?: boolean;
  className?: string;
  containerClassName?: string;
  "aria-label"?: string;
}) {
  const commit = useDataViewTextCommit({
    value,
    onChange,
    onCommit: onSearch,
    debounceMs,
  });

  return (
    <SearchInput
      value={commit.value}
      onChange={commit.change}
      onClear={onClear ?? commit.clear}
      placeholder={placeholder}
      clearLabel={clearLabel}
      aria-label={ariaLabel}
      disabled={disabled || loading}
      className={className}
      containerClassName={containerClassName}
    />
  );
}
