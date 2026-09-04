import { useEffect, useRef } from "react";
import { SearchInput } from "@/components/shared/SearchInput";

/**
 * Debounced search field for data toolbars.
 *
 * Wraps SearchInput (the visual authority — leading icon, clear button, focus
 * ring, placeholder) and adds a search contract: a short debounce
 * so the consumer's server-side query fires after typing settles, an optional
 * loading flag for the in-flight query, and a controlled `value`/`onSearch`
 * pair where `onSearch` receives the DEBOUNCED term (not every keystroke).
 *
 * The input is FULLY CONTROLLED by `value` (no divergent local state): typing
 * calls onChange immediately so the host can update its own input state, while
 * the debounced `onSearch` fires only after typing settles. This keeps the
 * displayed text and the committed value in lockstep — a clear/reset from the
 * host is reflected instantly, with no stale local copy and no pending debounce
 * overwriting it. This is what removes the "search box jumps / refetches on
 * every keystroke" jitter.
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // If the host clears the value externally (e.g. a "clear all filters" button
  // that sets value="" directly, bypassing this field's own clear button),
  // cancel any pending debounce so a stale term cannot re-fire onSearch and
  // overwrite the cleared value moments later.
  useEffect(() => {
    if (value === "" && timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [value]);

  function handleChange(next: string) {
    onChange(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onSearch(next);
    }, debounceMs);
  }

  function handleClear() {
    if (timer.current) clearTimeout(timer.current);
    (onClear ?? onChange)("");
  }

  return (
    <SearchInput
      value={value}
      onChange={handleChange}
      onClear={handleClear}
      placeholder={placeholder}
      clearLabel={clearLabel}
      aria-label={ariaLabel}
      disabled={disabled || loading}
      className={className}
      containerClassName={containerClassName}
    />
  );
}
