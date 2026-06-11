# Review Profile: Frontend UI State

Use this profile for React/Svelte UI state, forms, optimistic updates, websocket state, and user-visible error behavior.

## Common Risk Patterns

### 1. Local UI state diverges from server truth

Reviewer checks:

- server response dominates stale local optimistic state;
- refetch/recovery paths reconcile state.

### 2. Loading/error flags get stuck

Reviewer checks:

- all success/error/cancel branches clear loading flags;
- component unmount and abort paths are handled.

### 3. Form validation mismatch

Reviewer checks:

- frontend validation matches backend contract where needed;
- invalid payloads cannot be submitted silently.

### 4. Test lacks user-visible assertion

Reviewer checks:

- tests assert rendered output or user-visible behavior;
- implementation details are not over-tested.

### 5. Form reset on prop change

Reviewer checks:

- editing forms use `useEffect` + `reset()` to re-initialize when `initialValues` prop changes;
- stale default values don't persist after data loads.

### 6. Shared constants remain backward-compatible

Reviewer checks:

- `Record<string, ...>` type is preserved for constants consumed by multiple callers;
- new typed accessors don't break existing string-indexed usages.
