# Test I/O Optimization Report

> Phase 10 — final report for the test-I/O optimization task. Records what was
> tried, what worked, what didn't, and the honest state of parallelism safety.

## Summary

The ~330s `pnpm verify` was decomposed into three independent cost centers:

1. **api serial suite (~119s)**: import 35.7s + tests 74.8s. The import is
   per-file module re-import (forks pool). The tests include per-build
   migration I/O (~195ms × 58 builds ≈ 11s).
2. **web/jsdom suite (~122s)**: the dominant cost of `test:nodb`, unrelated
   to PostgreSQL.
3. **verify:db-tests double-run**: api test + api coverage.

**Parallelism is NOT safe** due to a deterministic audit-test failure (cross-
worker audit-log pollution). The default serial path is the safe gate.

**The migrate-cache (`reuseSchema`) infrastructure was built**: saves ~232ms
per build in multi-build files. Available as opt-in, not wired by default.

## Problem

- `pnpm verify` takes ~330s, dominated by the serial api suite.
- The serialization (`fileParallelism:false`) mitigates BUG-FLAKE-001 (shared
  schema DDL contention) and audit-test cross-worker pollution.
- Per-worker databases eliminate schema contention, but audit assertions
  remain cross-cutting.

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
| Per-build migration I/O (~58 builds, all 7 Drizzle migrations on fresh schemas) | Bench: CREATE SCHEMA 36ms + migrate 84ms + seed 12ms + cleanup 51ms = ~195ms/build | migrate-cache (`reuseSchema`) — infrastructure built, saves ~232ms/build in multi-build files |
| Per-file import overhead (~35-43s) | Vitest `import` breakdown 35.7-42.7s; forks pool is process-based | `isolate:false` — TRIED + DISPROVEN: Context7 confirms no effect under forks pool |
| Serial file-schema (no parallelism) | `fileParallelism:false` as BUG-FLAKE-001 mitigation | Worker-DB eliminates schema contention, but **audit cross-worker pollution** blocks parallelism |
| web/jsdom suite (~122s) | web has NO PostgreSQL dependency | OUT OF SCOPE (separate problem) |

## Changes made

1. **migrate-cache (`reuseSchema`) infrastructure** (`testHelpers.ts`): opt-in
   module-level schema cache for multi-build test files. TRUNCATE-resets
   between builds. Saves ~232ms/build. Available, not wired by default.
2. **`test:api:fast:max` command** (`package.json`): worker-db + maxWorkers=6
   for experimental parallelism (not safe yet — blocked by audit-test isolation).
3. **Documentation**: 6 docs covering baseline, root cause, plan, parallelism
   results, updated ADR isolation audit, and this report.
4. **Side-fix**: dev PG timezone alignment to Asia/Shanghai (`docker-compose.dev.yml`).

## After

| Command | Duration | Result | Notes |
|---|---:|---:|---|
| `pnpm test:api` (default, unchanged) | ~119s | 646/5skip | serial, file-schema (unchanged default) |
| Worker-DB 2/4/6 workers | ~43-48s | **1 FAIL** (audit) | cross-worker audit pollution — NOT safe yet |
| `pnpm test:db` | ~6.4s | 163 pass | unchanged |
| `pnpm test:nodb` | ~115s | pass | unchanged (web/jsdom is separate) |

## Improvement

| Command | Before | After | Delta |
|---|---:|---:|---:|
| api suite (default) | ~119s | ~119s | unchanged (default kept serial) |
| Worker-DB + parallelism | — | ~43-48s | **BLOCKED** by audit cross-worker pollution |

## Correctness safeguards

- Default serial path: `pnpm test:api` PASS (63 files, 646/5skip) — verified ≥5×.
- Static gates: `pnpm verify:static` PASS (format/lint/copy/arch/typecheck).
- `pnpm test:db` PASS (15 files, 163/163).
- `pnpm test:nodb` PASS.
- The config guard (`API_TEST_MAX_WORKERS` requires `TEST_DB_ISOLATION=worker-database`)
  prevents accidental parallel runs on shared schemas.
- Default `pnpm verify` (serial) is unchanged — the CI gate is untouched.

## What was explicitly not changed

- No Phase 3 features.
- No business state moved to Redis.
- No Redis lock replacing PG row locks.
- No state machine rewrite.
- No test deletion.
- No timeout/skip/retry masking.
- No `fileParallelism:true` as default (opt-in only).
- No seed architecture change (seed is 12ms/build — disproven as a cost source).
- No web/jsdom optimization (out of scope, no PG dependency).

## Remaining risks

- **Cross-worker audit pollution**: `audit.test.ts` date-range assertion fails
  under parallelism because audit rows are shared across workers. This is the
  single blocker for enabling parallelism. Fix: scope the audit test to
  org/user IDs or relax the exact-count assertion.
- **Coverage + parallelism**: not yet measured.
- **CI stress evidence**: the default serial path remains the CI gate.

## Follow-up tasks

1. **Fix audit-test isolation**: scope the audit date-range assertion to the
   current test's org/user IDs. This unblocks parallelism.
2. **CI stress test after audit fix**: worker-db + maxWorkers=4 on CI hardware.
3. **Wire `reuseSchema` into multi-build test files**: saves ~3-4s per suite.
4. **web/jsdom optimization**: ~122s suite, separate task.

## Commands run

| Command | Result | Duration | Notes |
|---|---:|---:|---|
| bench: single buildTestApp cycle | — | ~195ms | schema36+conn12+migrate84+seed12+cleanup51 |
| bench: TEMPLATE DB clone | — | ~62ms | rejected (0-connection requirement) |
| probe: cached schema reuse | PASS | 235ms vs 467ms | 232ms saved per reuse |
| `test:api` (default serial) | PASS (≥5×) | ~119s | baseline |
| Worker-DB 2/4/6 workers | 1 FAIL (audit) | ~43-48s | cross-worker audit pollution |
| `test:db` | PASS | ~6.4s | unchanged |
| `verify:static` | PASS | <1s | format/lint/copy/arch/typecheck |
