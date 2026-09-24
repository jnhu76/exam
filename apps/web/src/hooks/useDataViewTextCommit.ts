import { useCallback, useEffect, useRef } from "react";

/**
 * The single text-commit interaction owner for data-view text controls
 * (issue 601 Phase F convergence).
 *
 * The census found two text controls doing the same interaction with two
 * different implementations: the free-text search (DataViewSearch, 300ms,
 * component-owned) and the exact-identifier filters (/admin/recovery, 400ms,
 * page-local `draftRef` + blur flush + Enter flush + reset choreography). The
 * *query semantics* of the two controls differ — fuzzy search vs exact
 * identifier — but the commit choreography does not, so it lives here once and
 * both controls consume it. Pages keep owning what the committed value MEANS
 * (which query parameter, which API call); this hook owns only when a settled
 * value is committed.
 *
 * Contract:
 *   - the field is fully controlled by `value`; `change` reflects every
 *     keystroke to the host immediately (so the input never lags) and
 *     schedules the debounced commit;
 *   - `flush` commits a pending value NOW (blur / Enter) and is a no-op when
 *     nothing is pending, so a blur without typing cannot re-fire a query;
 *   - `clear` commits the empty value immediately — a clear is a deliberate
 *     action, not typing, so it must not wait for the debounce;
 *   - an external reset (the host setting `value` to "" behind the field's
 *     back, e.g. a "clear all filters" button) cancels a pending commit, so a
 *     stale term cannot land after the reset.
 */
export interface DataViewTextCommit {
  /** The controlled value (host-owned, reflected immediately). */
  value: string;
  /** Immediate change handler — reflects and schedules the commit. */
  change: (next: string) => void;
  /** Commit a pending value now (blur / Enter). No-op when nothing is pending. */
  flush: () => void;
  /** Clear the value and commit "" immediately. */
  clear: () => void;
}

export function useDataViewTextCommit({
  value,
  onChange,
  onCommit,
  debounceMs = 300,
}: {
  value: string;
  /** Host state update — fires on every keystroke. */
  onChange: (value: string) => void;
  /** Commit the settled value to the query (server call / URL update). */
  onCommit: (value: string) => void;
  debounceMs?: number;
}): DataViewTextCommit {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  // An EXTERNAL reset — the host moving the value somewhere other than the
  // term we are about to commit (a "clear all filters" button, a URL-driven
  // reset) — cancels the pending commit, so a stale term cannot land after the
  // reset. Typing itself never trips this: `change` sets the pending term to
  // the value it just published, so the two agree until the commit lands.
  useEffect(() => {
    if (pending.current !== null && value !== pending.current) cancel();
  }, [value, cancel]);

  const change = useCallback(
    (next: string) => {
      onChange(next);
      cancel();
      pending.current = next;
      timer.current = setTimeout(() => {
        timer.current = null;
        const settled = pending.current;
        pending.current = null;
        if (settled !== null) onCommit(settled);
      }, debounceMs);
    },
    [cancel, debounceMs, onCommit, onChange],
  );

  const flush = useCallback(() => {
    if (timer.current === null) return;
    const settled = pending.current;
    cancel();
    if (settled !== null) onCommit(settled);
  }, [cancel, onCommit]);

  const clear = useCallback(() => {
    cancel();
    onChange("");
    onCommit("");
  }, [cancel, onChange, onCommit]);

  return { value, change, flush, clear };
}
