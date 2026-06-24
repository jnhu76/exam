# Test Parallelism Results

> Phase 7 of the test-I/O optimization task. Safety matrix for `apps/api`
> parallelism under `TEST_DB_ISOLATION=worker-database`. All experiments on
> the `feat/test-io-optimization` branch, machine: 8-core WSL2, PostgreSQL 18.4,
> Redis 7-alpine.

## Summary

**Worker-database mode + file parallelism is now SAFE.** The single blocker
(audit-test date-range pagination) was fixed in commit `01f21eb`. All tested
worker counts pass 5/5 consecutive full-suite runs (651/651, 0 failures).

Per-worker databases eliminate BUG-FLAKE-001 schema/DDL contention at the
source, and the audit-test fix eliminates the only data-isolation gap.

## Matrix

All cases: `APP_MODE=test`, `REDIS_URL=""`, PG 18.4, 8-core WSL2.

| Case | Config | Result | Duration (avg) | Tests | Notes |
|---|---:|---:|---:|---:|---|
| Baseline serial file-schema | (default) | PASS | ~119s | 646/5skip | current default; import 35.7s + tests 74.8s |
| Worker-DB 1 worker | `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=1` | PASS | ~119s | 651/0skip | no parallelism; same wall |
| Worker-DB 2 workers | `... API_TEST_MAX_WORKERS=2` | PASS (5/5) | ~55s | 651/0skip | 2.2× vs file-schema baseline |
| Worker-DB 4 workers | `... API_TEST_MAX_WORKERS=4` | PASS (5/5) | ~68s | 651/0skip | 1.8× vs baseline; recommended |
| Worker-DB 6 workers | `... API_TEST_MAX_WORKERS=6` | PASS (3/3) | ~43s | 651/0skip | 2.8× vs baseline; aggressive |

> Note: durations vary with machine load. The 4-worker average (~68s) is higher
> than the earlier estimate (~32s) because those runs benefited from turbo
> cache. Cold runs are ~64–78s. Still a significant improvement over ~119s serial.

## The audit-test fix (commit 01f21eb)

**Root cause**: in worker-database mode, one worker DB is shared across test
files within a worker. `audit.test.ts` `clearAudits()` only deleted the current
`adminId`'s rows, leaving residual audit rows from other files (e.g. auth
login-failure `nobody` rows — 314+ total). The "filters by inclusive date range"
test queried without a `targetType` filter, so `pageSize=20` returned only
recent rows and the range markers were paginated out → deterministic failure.

**Fix**: added `targetType=range_test` to the 3 date-range API queries, so they
only see the 4 rows the test created. The test still validates date-range
filtering; `targetType` is orthogonal.

**Before**: worker-db 4w audit.test.ts 0/10 pass.
**After**: worker-db 4w full suite 5/5 pass.

## Safe settings

- `TEST_DB_ISOLATION=worker-database` + `API_TEST_MAX_WORKERS=4` — **proven
  safe** (5/5 full-suite passes). Wired as `pnpm test:api:fast`.
- `API_TEST_MAX_WORKERS=2` — conservative, ~2× speedup.
- `API_TEST_MAX_WORKERS=6` — aggressive, ~2.8× speedup, 3/3 passes.

## Unsafe settings

- `fileParallelism:true` WITHOUT `worker-database` mode — would trigger
  BUG-FLAKE-001 (config guard prevents this).
- `maxWorkers` > 6 not tested (8-core machine; PG saturation likely beyond 8).

## Recommendation

1. **`pnpm test:api:fast` is safe for dev-loop use** (worker-db, 4w, ~68s).
2. **Default `pnpm verify` remains serial** — changing it requires CI stress
   evidence at the target worker count + coverage parallelism measurement.
3. The audit-test fix is a genuine bug fix (test isolation), not a masking
   workaround — it makes the test correct under shared-DB isolation.
