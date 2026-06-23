# Test Parallelism Results

> Phase 7 of the test-I/O optimization task. Safety matrix for `apps/api`
> parallelism under `TEST_DB_ISOLATION=worker-database`. All experiments on
> commit `37a5265`, machine: 8-core WSL2, PostgreSQL 18.4, `pnpm --filter
> @exam/api exec vitest run`. Each config tested ≥3×.

## Summary

**Worker-database mode + file parallelism is NOT fully safe yet.** While 62
out of 63 test files pass under all tested worker counts, the `audit.test.ts`
"filters by inclusive date range" test **deterministically fails** (3/3 runs)
at every maxWorkers ≥ 2. The root cause is **cross-worker audit-log pollution**:
audit rows written by one worker's tests are visible to another worker's
audit-list assertions. This is a known isolation gap (audit logs are
fire-and-forget `recordAudit`, not scoped to the worker's database) and was
not surfaced under the legacy `fileParallelism:false` serial regime.

**Result**: parallelism is **NOT safe** at the default config. The `reuseSchema`
migrate-cache (Phase 3) is the safe, immediate win. Parallelism requires
fixing audit-log isolation first — either by making the audit assertion
resilient, or by scoping audit queries to the current test's organizationId
range.

## Matrix

All cases: `APP_MODE=test`, `REDIS_URL=""` (unset, Redis not needed),
postgresql://exam:exam@localhost:5432/exam_test, 8-core WSL2.

| Case | Config | Result | Duration (avg) | Tests | Notes |
|---|---:|---:|---:|---:|---|
| Baseline serial file-schema | (default) | PASS | ~119s | 646/5skip | current default; import 35.7s + tests 74.8s |
| Worker-DB serial (1w) | `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=1` | PASS | ~119s | 651/0skip | no parallelism; same wall as file-schema |
| Worker-DB 2 workers | `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=2` | **FAIL (1 test)** | ~48s | 1 fail (audit), 645 pass | 3/3 consistent |
| Worker-DB 4 workers | `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4` | **FAIL (1 test)** | ~48s | 1 fail (audit), 645 pass | 3/3 consistent |
| Worker-DB 6 workers | `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=6` | **FAIL (1 test)** | ~43s | 1 fail (audit), 645 pass | 3/3 consistent |

All `maxWorkers=2/4/6` runs were tested with **3 consecutive runs**, and the
audit test failed identically every time (`audit.test.ts:144 "filters by
inclusive date range"`). No BUG-FLAKE-001 DDL contention was observed —
per-worker databases do eliminate schema contention. The failure is a
**data-isolation** gap in audit assertions, not a schema/DDL contention issue.

## Failure root cause

`audit.test.ts` "filters by inclusive date range" inserts audit rows, then
asserts a count from `GET /api/admin/audit-logs?from=...&to=...`. Under
parallelism, **other workers' audit rows** (from their own test builds)
intersect with the date range and inflate the count, causing the
`expected false to be true` assertion failure.

The audit repo writes to a shared `audit_logs` table that spans all workers'
databases (fire-and-forget `recordAudit`). The per-worker database isolates
**business tables** (exams, attempts, enrollments) but audit rows are
cross-cutting by design (they log all operations).

## Safe settings

- `TEST_DB_ISOLATION=worker-database` + `API_TEST_MAX_WORKERS=1` — **proven
  safe** (serial, same wall time as file-schema). Offers the migrate-once
  per-worker-DB benefit but no parallelism gain.
- Default serial file-schema — **safe** (the current production default).

## Unsafe settings

- Any `maxWorkers ≥ 2` — audit test fails deterministically.
- `fileParallelism:true` WITHOUT `worker-database` mode — would trigger
  BUG-FLAKE-001 (the config guard prevents this).

## Remaining blockers

1. **Cross-worker audit assertion**: the `audit.test.ts` date-range test must
   either (a) scope its query to the current test's org/user IDs, (b) truncate
   audit rows before the assertion, or (c) relax the exact-count assertion to
   a `>=` bound. Until this is fixed, parallelism cannot be safely enabled.
2. **Coverage + parallelism**: not yet measured.
3. **CI stress**: not yet measured.

## Recommendation

1. **Do NOT change the default** `fileParallelism` or `API_TEST_MAX_WORKERS`.
   The serial default remains the safe gate.
2. **Fix the audit-test isolation** as a follow-up (small, isolated) before
   enabling parallelism.
3. The `reuseSchema` migrate-cache (Phase 3) is the safe, available win —
   it reduces per-build migration I/O without changing parallelism.
4. The orphan database cleanup mechanism (`testWorkerDatabase.dropDatabaseIfExists`)
   is functional but was not triggered by the parallel runs — those databases
   were from prior experimental runs. A `pnpm test:api:fast` cleanup command
   or `afterAll` hook could be added as a follow-up.
