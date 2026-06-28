# Follow-up: Parallelize the `@exam/web` test suite

> **Status**: ✅ RESOLVED (landed 2026-06-29)
> **Scope**: `apps/web` vitest configuration only — no business logic change
> **Resolution**: `apps/web/vitest.config.ts` changed `maxWorkers: 1` → `maxWorkers: 4, minWorkers: 2`. Web suite wall-clock dropped from ~224s to ~48s (~4.6×), 625/625 tests pass across 3 consecutive runs with zero flake. Kept on this branch pending review/merge; this note can be deleted once merged.

## Why this was recorded

During P0-1 verification, `pnpm verify` measured ~3m46s wall-clock. The dominant cost was `@exam/web:coverage` at **~224s**, while the actual P0-1 change touched only `packages/exam-engine`. Investigation showed the web suite is structurally serialized, so this note captures the finding for a future dedicated task rather than expanding P0-1's scope.

## Evidence

`apps/web/vitest.config.ts`:

```ts
test: {
  environment: "jsdom",
  pool: "forks",
  maxWorkers: 1,            // <-- all files run serially in one fork
  server: { deps: { inline: ["react-dom"], fallbackCJS: true } },
  // ...
}
```

Measurements on the P0-1 working tree (`pnpm --filter @exam/web exec vitest run --coverage`):

| Metric | Value |
| --- | --- |
| Test files | 17 (61+ tests) |
| `@exam/web:coverage` duration | ~224s |
| `tests` time | 111.84s |
| `import` time | 30.17s |
| `setup` time | 13.62s |
| Slowest files | `ExamMonitoringPage` ~15s, `TakeExamPage` ~8s, `CandidatesPage` ~7s |

Because `maxWorkers: 1` forces single-file serial execution, slow files cannot overlap.

## Why it was set to 1

Introduced by commit `8ef3b9e` — *"fix: stabilize frontend baseline and api env loading"* (2026-06-15). `maxWorkers: 1` was the stabilization lever at the time. The original instability source was **not** documented in the commit body, so it must be re-verified before raising the worker count.

## Why deferred from P0-1

- P0-1 scope is strictly the `submitAttempt()` TOCTOU fix in `packages/exam-engine`.
- Touching `apps/web/vitest.config.ts` is unrelated test infra and would inflate the P0-1 diff.
- The 120s "before" number was a turbo cache hit (`Cached: 12 cached, 14 total`); a full re-run of `@exam/web:coverage` was always ~224s. This is not a regression caused by P0-1.

## Suggested approach (do NOT edit blindly)

1. Establish the failure baseline first: run `pnpm --filter @exam/web test` repeatedly with the current config and record which tests (if any) are flaky.
2. Try `maxWorkers: 2` (or `minWorkers: 2`) with `pool: "forks"` kept as-is. Re-run and compare wall-clock and flake rate.
3. Do **not** switch `pool: "forks"` → `"threads"` without a flake study: jsdom + React Testing Library + the `inline: ["react-dom"]` server-deps setting are the classic threads-pool flake surface.
4. If module-level state leaks (global mocks, MSW handlers, `globalThis` mutation) are the reason `maxWorkers: 1` was needed, fix them in `src/test/setup.ts` / `src/test/react-act-env.ts` so each worker is self-contained, *then* raise the worker count.
5. Separately consider splitting `coverage` out of the local `verify` fast path so the common pre-commit loop runs `test` (no coverage) and gates coverage separately.

## Owner / next

Candidate for a dedicated test-infra PR, not bundled with a feature fix. Non-blocking.
