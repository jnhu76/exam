# Test I/O Optimization Report

> Phase 10 — final report for the test-I/O optimization task. Records what was
> tried, what worked, what didn't, and the safe speedup available today.

## Summary

The ~330s `pnpm verify` was decomposed into three independent cost centers. The
largest api-suite gain comes from **enabling per-worker PostgreSQL databases**
(`TEST_DB_ISOLATION=worker-database`) with modest parallelism (`maxWorkers=4`),
reducing the api suite from ~119s to ~32s (3.7× speedup) — and to ~25s with
`maxWorkers=6` (4.8×). This is **opt-in**, safe (≥3 consecutive passes, 0
failures), and already wired as `pnpm test:api:fast`.

The `isolate:false` optimization (targeting the 35s per-file import overhead)
was **tried and disproven** — under the `forks` pool, each file runs in its own
process, so module isolation is process-based regardless of the `isolate` flag
(Context7 `/vitest-dev/vitest/v4.1.6`).

The migrate-cache optimization (`reuseSchema`) was implemented and proven
correct but yields a modest ~3–4s gain — it is available as infrastructure
(opt-in via `buildTestApp({reuseSchema:true})`) but not wired into tests by
default.

## Problem

- `pnpm verify` takes ~330s, dominated by `verify:db-tests` running the
  api suite twice (test + coverage) under serial `fileParallelism:false`.
- The serialization mitigates BUG-FLAKE-001 (concurrent DDL contention on
  a shared PG schema), but per-worker databases eliminate the root cause.

## Before

| Command | Duration | Result | Notes |
|---|---:|---:|---|
| `pnpm test:api` (default) | ~119s | 646/5skip | file-schema, serial; import 35.7s + tests 74.8s |
| `pnpm test:db` | ~6.4s | 163 pass | parallel, per-file schema |
| `pnpm test:nodb --force` | ~115s | pass | dominated by web (~122s jsdom) |
| `pnpm verify` | ~330s | pass | api test + api coverage ~2× |

## Root causes found

| Root cause | Evidence | Fix |
|---|---|---|
| Per-build migration I/O (~58 builds, each runs all 7 Drizzle migrations on a fresh schema) | Bench: CREATE SCHEMA 36ms + migrate 84ms + seed 12ms + cleanup 51ms = ~195ms/build; ~58 builds × 195ms ≈ 11s | migrate-cache (`reuseSchema`) — implemented but modest gain (3–4s) because most builds are inter-file |
| Per-file import overhead (~35–43s) | Vitest `import` breakdown: 35.7–42.7s; serial forks re-import the Fastify+plugins+db stack per file | `isolate:false` — TRIED + DISPROVEN: forks pool is process-based; Context7 confirms `isolate` has no effect under forks |
| Serial file-schema (no parallelism) | `fileParallelism:false` as BUG-FLAKE-001 mitigation | **worker-database + maxWorkers=4**: per-worker DBs eliminate schema contention at the source, enabling safe parallelism (3.7× speedup) |
| web/jsdom suite (~122s) | web has NO PostgreSQL dependency; env 41s + import 23.5s | OUT OF SCOPE (separate problem, not PG I/O) |

## Changes made

1. **migrate-cache (`reuseSchema`) infrastructure** (`testHelpers.ts`): opt-in
   module-level schema cache that reuses a migrated schema across multiple
   `buildTestApp` calls in the same vitest fork. TRUNCATE-resets between builds.
   Saves ~232ms/build in multi-build files. Available, not wired by default.
2. **`test:api:fast:max` command** (`package.json`): worker-db + maxWorkers=6
   for aggressive local parallelism.
3. **Documentation**: isolation audit updated with Phase 7 parallelism
   experiment results; plan doc updated with disproven `isolate:false` evidence.

## After

| Command | Duration | Result | Notes |
|---|---:|---:|---|
| `pnpm test:api` (default, unchanged) | ~119s | 646/5skip | serial, file-schema (unchanged default) |
| `pnpm test:api:fast` (worker-db, 4w) | ~32s | 651/0skip | **3.7× faster** than default |
| `pnpm test:api:fast:max` (worker-db, 6w) | ~25s | 651/0skip | **4.8× faster** than default |
| `pnpm test:db` | ~6.4s | 163 pass | unchanged |
| `pnpm test:nodb` | ~115s | pass | unchanged (web/jsdom is separate) |

## Improvement

| Command | Before | After (opt-in) | Delta |
|---|---:|---:|---:|
| api suite | ~119s | ~32s (test:api:fast) | **-87s (-73%)** |
| api suite | ~119s | ~25s (test:api:fast:max) | **-94s (-79%)** |
| full verify | ~330s | — | unchanged (serial default kept; coverage not parallelized) |

## Correctness safeguards

- `maxWorkers=2/4/6` each validated with **≥3 consecutive full-suite passes**
  (651/651, 0 failures). No BUG-FLAKE-001 recurrence.
- Per-worker databases guarantee cross-file data isolation — each worker owns
  its own PG database; TRUNCATE-resets between tests.
- The opt-in config guard (`API_TEST_MAX_WORKERS` requires
  `TEST_DB_ISOLATION=worker-database`) prevents accidental parallel runs on
  shared schemas.
- Default `pnpm verify` (serial, file-schema) is unchanged — the CI gate is
  untouched.
- No orphan databases observed (verified via `\l` before/after each batch).

## What was explicitly not changed

- No Phase 3 features.
- No business state moved to Redis.
- No Redis lock replacing PG row locks (`FOR UPDATE` sites unchanged).
- No state machine rewrite.
- No test deletion.
- No timeout/skip/retry masking.
- No `fileParallelism:true` as default (opt-in only).
- No seed architecture change (seed is 12ms/build — disproven as a cost source).
- No web/jsdom optimization (out of scope, no PG dependency).

## Remaining risks

- **CI stress evidence**: worker-db + maxWorkers=4 has not been tested on CI
  hardware. The default `pnpm verify` (serial) is kept as the safety net.
- **Coverage + parallelism**: `verify:db-tests` runs api test + api coverage
  concurrently under turbo. If api runs parallel (4–6 workers), combined with
  db coverage workers, the PG server could see 10+ concurrent pools + DDL.
  This should be measured before changing the verify default.
- **Worker count ceiling**: maxWorkers > 6 not tested; PG connection pool
  saturation is likely beyond 8 workers on this 8-core machine.

## Follow-up tasks

1. **CI stress test**: run `test:api:fast` (worker-db, 4w) on CI hardware 5×
   to confirm stability before promoting to default.
2. **Coverage parallelism**: measure `coverage:api` under worker-db + 4w to
   confirm it does not regress.
3. **Default promotion**: if CI stress passes, consider changing the default
   api test path to worker-db + maxWorkers=4, removing the serial mitigation
   from `pnpm verify`.
4. **web/jsdom optimization**: the ~122s web suite is the largest remaining
   cost center in `test:nodb` — separate task, no PG involvement.
5. **Wire `reuseSchema` into multi-build test files**: the migrate-cache
   infrastructure is ready; wiring it into the 7 files that call
   `buildTestApp` >1 time would save ~3–4s per full suite run. Low risk,
   already validated.

## Commands run

All experiments on commit `37a5265` (Phase 2 收口 head), 8-core WSL2, PG 18.4.

| Command | Result | Duration | Notes |
|---|---:|---:|---|
| bench: single buildTestApp cycle | — | ~195ms | schema36+conn12+migrate84+seed12+cleanup51 |
| bench: TEMPLATE DB clone | — | ~62ms | rejected (0-connection requirement) |
| probe: cached schema reuse | PASS | 235ms vs 467ms | 232ms saved per reuse |
| `test:api` (default) | PASS | ~119s | baseline |
| `test:api:fast` (4w) | PASS ×3 | ~32s | 3.7× speedup |
| `test:api:fast:max` (6w) | PASS ×3 | ~25s | 4.8× speedup |
| `test:db` | PASS | ~6.4s | unchanged |
| `verify:static` | PASS | <1s | format/lint/copy/arch/typecheck |
