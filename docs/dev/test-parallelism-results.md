# Test Parallelism Results

> Phase 7 of the test-I/O optimization task. Safety matrix for `apps/api`
> parallelism under `TEST_DB_ISOLATION=worker-database`. All experiments on
> commit `37a5265`, machine: 8-core WSL2, PostgreSQL 18.4, `pnpm --filter
> @exam/api exec vitest run`. Each config tested ≥3×.

## Summary

**Worker-database mode + file parallelism is safe and stable** up to
`maxWorkers=6` (the highest tested). The BUG-FLAKE-001 serial mitigation
(`fileParallelism:false`) is no longer needed when per-worker databases
are active — each worker owns its own PG database, eliminating cross-file
DDL contention and cross-file data pollution at the source.

The largest measured win: `maxWorkers=6` reduces the api suite from ~119s
(default serial file-schema) to ~25s — a **~4.3× speedup**.

## Matrix

All cases: `APP_MODE=test`, `REDIS_URL=""` (unset, Redis not needed),
postgresql://exam:exam@localhost:5432/exam_test, 8-core WSL2.

| Case | Config | Result | Duration (avg) | Tests | Notes |
|---|---:|---:|---:|---:|---|
| Baseline serial file-schema | (default) | PASS | ~119s | 646/5skip | current default; import 35.7s + tests 74.8s |
| Worker-DB serial (1w) | `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=1` | PASS | ~108s | 651/0skip | avoids per-file schema create+drop overhead |
| Worker-DB 2 workers | `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=2` | PASS (3/3) | ~55s | 651/0skip | 2.2× vs file-schema baseline |
| Worker-DB 4 workers | `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4` | PASS (3/3) | ~32s | 651/0skip | 3.7× vs baseline; 3.4× vs serial worker-DB |
| Worker-DB 6 workers | `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=6` | PASS (3/3) | ~25s | 651/0skip | 4.8× vs baseline; best measured |

All `maxWorkers=2/4/6` runs were tested with **3 consecutive passes** to rule
out flakiness. No BUG-FLAKE-001 recurrence (concurrent DDL contention) was
observed — the per-worker database eliminates the root cause (shared schema
contention). No orphan databases were left behind (verified via `\l` before/
after each batch).

## Safe settings

- `TEST_DB_ISOLATION=worker-database` + `API_TEST_MAX_WORKERS=4` — **proven
  safe** (≥3 passes, 0 failures). Recommended as the `test:api:fast` default.
- `maxWorkers=2` — conservative, 2× speedup, very low contention risk.
- `maxWorkers=6` — aggressive, 4.8× speedup, still passed 3/3 on this machine.
  Should be stress-tested on CI before being made default.

## Unsafe settings

- `maxWorkers` > 6 not tested (8-core machine; PG connection pool + DDL
  concurrency would likely saturate beyond 6–8 workers).
- `fileParallelism:true` WITHOUT `worker-database` mode — would trigger
  BUG-FLAKE-001 (shared schema contention). The config guards this:
  `API_TEST_MAX_WORKERS` requires `TEST_DB_ISOLATION=worker-database` or it
  throws.

## Remaining blockers

- **`@exam/db` coverage + `@exam/api` coverage running concurrently** under
  turbo: the `verify:db-tests` chain runs api tests + api coverage + db tests
  + db coverage. If api parallelises but db parallelises too, the PG server
  sees up to 6+4=10 concurrent pools + DDL. This should be measured, not
  assumed safe.
- **CI shard** (`TEST_INFRA_SCOPE=ci` + `TEST_SHARD_INDEX`): the per-worker-
  database model is designed for CI sharding (each shard gets its own PG
  service), but this has not been stress-tested on CI hardware.
- **Default configuration**: the current default is `fileParallelism:false`
  (serial, file-schema). Changing the default to `worker-database + parallel`
  is a follow-up decision that needs CI stress evidence.

## Recommendation

1. **Add `pnpm test:api:fast` using `TEST_DB_ISOLATION=worker-database
   API_TEST_MAX_WORKERS=4`** as a documented dev-loop fast path. Keep the
   default serial path for safety.
2. Run the CI stress matrix (worker-database + maxWorkers=4/6 on CI hardware)
   before changing the default.
3. Do NOT change the default for `pnpm verify` (it currently runs serial
   + coverage; coverage under parallelism needs separate measurement).
4. The `reuseSchema` cache (Phase 3) is orthogonal — it helps intra-file
   multi-build scenarios regardless of parallelism mode.
