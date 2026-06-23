# ADR Isolation Audit

> Phase D of Phase 2 收口. After the Redis baseline (Phase C) is in place,
> audit the **actual data-conflict and flake root causes** with evidence — NOT
> to optimize the ~330s test time directly, but to produce the evidence base
> for any future safe parallelism. No parallelism is restored here.

## Summary

The test suite's slowness is **structural, not incidental**, and is already
well-diagnosed in `docs/dev/test-flakes.md` (BUG-FLAKE-001) and
`docs/known-test-isolation-issues.md` (K-1). This audit confirms those findings
with current evidence and maps each shared resource to its isolation strategy
and risk.

Two distinct root causes underlie the ~330s `pnpm verify`:

1. **State leak (FIXED)** — cross-file / cross-worker DB state pollution.
   Resolved by per-file (`file-schema`) and per-worker (`worker-database`) PG
   isolation (`testIsolation.ts`, `testWorkerDatabase.ts`). `buildTestApp`
   resolves the mode and creates an isolated schema/database per test context.
2. **I/O contention (NOT FIXED, mitigated by serialization)** — concurrent
   `CREATE SCHEMA` / `CREATE DATABASE` / migrate / seed against one PG instance
   under coverage instrumentation starves individual operations past the 5s
   testTimeout. Mitigated (not fixed) by `apps/api fileParallelism:false` +
   the `verify:db-tests` serial chain. This is why the api suite runs serial.

Redis baseline (Phase C) does **not** fix either; it adds Redis-key-prefix
isolation only. The audit below confirms no Redis state is currently shared
between tests (Redis has no runtime consumers yet).

## Current test time

Measured (Phase A baseline, this machine):

| Suite | Time | Parallelism | Notes |
|---|---:|---|---|
| `test:nodb` | ~105s | turbo parallel | 5/8 turbo-cached |
| `test:db` (`@exam/db`) | ~7s | **parallel** | 163 tests, per-file schema |
| `test:api` (`@exam/api`) | ~112–133s | **serial** (`fileParallelism:false`) | 646 tests; dominant cost |
| `verify:db-tests` | ~api × 2 + db | serial chain | runs api test **and** api coverage |

The ~330s `pnpm verify` is dominated by `verify:db-tests`, which runs the
**serial** api suite twice (test + coverage) plus build. The serial api run is
the single largest time block.

## Resource isolation matrix

| Resource | Current isolation strategy | Risk | Evidence | Proposed fix | Priority |
|---|---|---|---|---|---|
| PG business data (test) | per-file schema (`file-schema`) OR per-worker DB (`worker-database`) via `buildTestApp` | Low (state) / Med (I/O) | testIsolation.ts, testWorkerDatabase.ts, testHelpers.ts:114-158 | state-leak solved; I/O contention needs migrate semaphore / template DB | DEFER |
| PG catalog DDL (CREATE SCHEMA/DB, migrate) | cross-process advisory lock (`testInfraLock.ts`, `withTestInfraLifecycleLock`) | Med | testIsolation.ts:139, testWorkerDatabase.ts:212,333 | lock already serializes heavy DDL; further gains need template-DB clone | DEFER |
| PG migration lifecycle | idempotent Drizzle `migrate()` per schema/DB; `__drizzle_migrations` excluded from TRUNCATE | Low | testWorkerDatabase.ts:61-64,333 | idempotent re-run is a no-op; safe | — |
| Default org / seed data | seeded per test context inside `buildTestApp` (not a global shared seed) | Low | testHelpers.ts:180+ | each context seeds its own org | — |
| Redis keys | **prefix isolation** (Phase C); SCAN-based cleanup, no FLUSHALL | Low | testRedis.ts, redis.test.ts, testScope.redisPrefix | baseline in place; no runtime consumers yet | — |
| Queue jobs | none (no queue runtime; in-process `examQueues` Map, not Redis) | n/a | attempts.ts examQueues | deferred until queue adoption (ADR-003) | PHASE 3 |
| Background workers (scanners) | `setInterval` timers with `onClose`→`clearInterval` | Low | heartbeat.ts:254, deadlineScanner.ts:244 | cleaned on app close; no cross-test leak | — |
| Deadline scanner state | in-process; idempotent auto-submit (FOR UPDATE on attempt) | Low | deadlineScanner.ts:104-143 | idempotent; re-runs are safe | — |
| Rate-limit state | in-memory limiter (login 10/min, exam routes) | Low | rateLimit.ts, auth.ts | reset per-process; E2E disables via RATE_LIMIT_DISABLED | — |
| Presence/heartbeat state | in-process scanner; `exam_attempts.lastActivityAt` in PG (canonical) | Low | heartbeat.ts | state is in PG, not Redis; Redis not used | — |
| Vitest file parallelism | `apps/api` serial by default; opt-in parallel via `TEST_DB_ISOLATION=worker-database`+`API_TEST_MAX_WORKERS` | Med (if restored) | apps/api/vitest.config.ts:50-78 | do NOT restore without stress evidence (see Parallelism blockers) | DEFER |
| Turbo package parallelism | `@exam/api#test` dependsOn `@exam/db#test` (api waits for db) | Low | turbo.json | intentional ordering | — |
| E2E seed isolation | `RUN_SEED=e2e` canonical seed (baseline + demo candidate1..4); rate-limit disabled; fast scanners | Low | docker-compose.test.yml, e2e-seed.ts | E2E owns its compose stack | — |

## PostgreSQL conflicts

- **State leak**: SOLVED. Each `buildTestApp` creates an isolated schema
  (`file-schema`, default) or worker database (`worker-database`, opt-in) and
  seeds its own org. Business tables never leak across test contexts.
  Evidence: testIsolation.ts:223 `setupIsolatedTestDb`, testHelpers.ts:158.
- **I/O contention**: UNSOLVED, mitigated by serialization. Concurrent
  `CREATE SCHEMA`/`CREATE DATABASE`/migrate/seed against one PG instance under
  coverage instrumentation starves operations past the 5s testTimeout.
  Evidence: test-flakes.md BUG-FLAKE-001 PR86 matrix (parallel default → 2
  PASS/1 FAIL; maxWorkers≤4 → PASS). The `testInfraLock` advisory lock
  serializes catalog DDL but does not eliminate throughput contention.
- **K-1 (known, pre-existing)**: `user.test.ts` list-pagination assertion
  sees residue when run as a sub-set, because some older tests reuse the
  shared `exam_test` DB without truncating. Not caused by Phase 2 work;
  deferred. Evidence: known-test-isolation-issues.md K-1.

## Redis conflicts

- **None currently.** Redis has no runtime consumers (no rate-limit/presence/
  queue code reads `fastify.redis` except the diagnostics health check). The
  only Redis usage is the baseline plugin + test isolation helper, both
  prefix-scoped and SCAN-cleaned. There is no shared Redis state to conflict.

## Background worker lifecycle

- Heartbeat and deadline scanners use `setInterval`, registered with an
  `onClose` hook that calls `clearInterval` (heartbeat.ts:254,
  deadlineScanner.ts:244). Test apps close between contexts, so timers do not
  leak across tests.
- Deadline auto-submit is **idempotent**: it locks the attempt row
  (`findByIdForUpdate`), checks status ∈ {in_progress, disrupted}, then
  `submitAttempt`. A re-run after a prior submit is a guarded no-op.
  Evidence: deadlineScanner.ts:104-143.

## Seed/default data conflicts

- Each test context seeds its own default org via `buildTestApp`
  (testHelpers.ts:180+); there is no global shared seed that pollutes tests.
- E2E uses a canonical `RUN_SEED=e2e` seed (baseline + demo candidates) in its
  own compose stack; it does not share the unit-test DB.
- Default org is the only org (Phase 1 single-tenant); org/user fixtures are
  per-context, so cross-test org pollution does not occur.

## Parallelism blockers

| Blocker | Evidence | Can parallelize now? | Required fix |
|---|---|---:|---|
| `apps/api` I/O contention under coverage | test-flakes.md BUG-FLAKE-001 PR86 matrix; default parallel → FAIL | **No** | template-DB clone or migrate semaphore + stress evidence at target worker count |
| `fileParallelism:false` forces maxWorkers=1 | vitest.config.ts:24-27 (maxWorkers overridden to 1) | No (consequence of above) | resolve I/O contention first |
| auth amplification (6× login + audit polling per case) under contention | test-flakes.md 2026-06-23 observation | No | resolve I/O contention; auth cost shrinks once contention drops |
| K-1 shared-DB sub-set failure | known-test-isolation-issues.md K-1 | Partially | make sub-set runs use isolation too (mostly already do; K-1 is a residual older test) |

## MUST FIX

None found in Phase D. The scanners clean up correctly; the advisory lock is
in place; Redis prefix cleanup is safe (Phase C). No test-cleanup hole,
unclosed worker, or default-org pollution was identified.

## SHOULD FIX

- **K-1** (`user.test.ts` sub-set pagination assertion): residual shared-DB
  coupling. Fix direction documented in known-test-isolation-issues.md
  (truncate on setup, or relax the exact-equality assertion). Not blocking.

## DEFER

- **I/O contention root cause** (the real ~330s driver): template-DB cloning
  and/or a migration semaphore to remove the `CREATE SCHEMA`/migrate/seed
  throughput bottleneck. Requires its own stress-evidence PR before any
  `fileParallelism` restoration. This is the path to shortening test time —
  NOT Redis, NOT a parallelism flag flip.
- **Safe parallelism restoration**: gated on the above fix + stress evidence
  at the chosen `API_TEST_MAX_WORKERS`. The opt-in mechanism already exists
  (worker-database + API_TEST_MAX_WORKERS); only the contention evidence is
  missing.

## Commands run

| Command | Result | Duration | Notes |
|---|---:|---:|---|
| `test:nodb` | PASS | 105s | 5/8 cached |
| `test:db` | PASS | 7s | 163 tests, parallel |
| `test:api` | PASS (after Phase C) | 112s | 646 pass / 5 skip / 0 fail |
| redis.test.ts (REDIS_URL unset) | PASS | 0.4s | 2 pass / 5 skip (no 10s storm) |
| grep scanners onClose | clearInterval present | <1s | heartbeat.ts:254, deadlineScanner.ts:244 |
| grep FOR UPDATE | 3 sites | <1s | examRepo, enrollmentRepo, attemptRepo |

## Recommended next steps

Focus on evidence-based fixes only:

1. **Template-DB / migrate-semaphore investigation** to remove the I/O
   contention root cause (the actual driver of serial api tests). This is the
   only change that can safely shorten test time.
2. **K-1 cleanup** (truncate-on-setup or relaxed assertion) — small, isolated.
3. Do **not** flip `fileParallelism` or `API_TEST_MAX_WORKERS` globally until
   step 1 produces stress evidence at the target worker count.
4. Redis consumers (rate-limit/presence/queue) remain Phase 3+ and require a
   measured trigger (ADR-001); the baseline is ready when they arrive.
