# Test I/O Baseline

> Phase 0 of the test-I/O optimization task. Measurements taken BEFORE any
> change, on commit `37a5265`, machine: 8-core WSL2, PostgreSQL 18.4 +
> Redis 7-alpine via `docker-compose.dev.yml`. All numbers reproducible from
> the commands in the tables.

## Summary

The ~330s `pnpm verify` is the sum of three **independent** cost centers, only
one of which is the PostgreSQL I/O contention flagged in the Phase 2 收口:

1. **`@exam/api` serial suite: ~113–119s** — Vitest breakdown:
   `import 35.7s` + `tests 74.8s` + transform 1.6s. The `tests` portion includes
   a per-`buildTestApp` cost of **~195 ms** (CREATE SCHEMA 36 + connect 12 +
   migrate 84 + seed 12 + cleanup 51) executed **~58 times** across the suite.
   The `import` portion is redundant re-import of the Fastify+plugins+db stack
   in each isolated fork (fileParallelism:false = one fork per file, fresh
   module cache).
2. **`@exam/web` suite: ~122–132s** — jsdom-heavy, NO PostgreSQL dependency.
   Breakdown: `environment 41s` + `import 23.5s` + `tests 49s` + `setup 9s`.
   This is the dominant cost of `test:nodb` and is **unrelated to PG I/O**.
3. **`@exam/db` suite: ~6s** — parallel, fast; the only flake is the known
   BUG-FLAKE-002 boundary on `demo-seed.test.ts` (~5.3s vs 5s timeout).

The `verify:db-tests` step runs the api suite TWICE (test + coverage) plus db
test + coverage, so the api serial cost is the largest single contributor to
full verify.

## Commands run

Environment: `APP_MODE=test`,
`TEST_DATABASE_URL=postgresql://exam:exam@localhost:5432/exam_test`,
`DATABASE_URL=<same>`, `REDIS_URL=""` unless noted.

| Command | Result | Duration | Notes |
|---|---|---:|---|
| `pnpm --filter @exam/api exec vitest run` | PASS (646/5skip) | 118.9s | import 35.7s + tests 74.8s |
| `pnpm --filter @exam/db exec vitest run` | PASS (×3: 6.0/6.4/6.7s) | ~6.4s | import 11-13s (parallel, aggregated); 1 boundary flake on demo-seed |
| `pnpm --filter @exam/web exec vitest run` | PASS (550) | 122.5–131.8s | jsdom; env 41s, import 23.5s, tests 49s |
| `pnpm --filter @exam/auth exec vitest run` | PASS | 1.5s | nodb reference |
| `pnpm test:nodb --force` | PASS (cold) | 1m55s | dominated by web (~122s); turbo-parallel |
| `pnpm test:nodb` (warm) | PASS | 76ms (FULL TURBO) | fully cached |
| bench: single buildTestApp cycle | — | ~195 ms | schema36+conn12+migrate84+seed12+cleanup51 |

## Test timing breakdown

| Area | Command | Duration | Notes |
|---|---|---:|---|
| api tests (serial) | `pnpm test:api` | ~119s | import 35.7s + tests 74.8s |
| db tests (parallel) | `pnpm test:db` | ~6.4s | 163 tests, parallel; 1 known boundary flake |
| web tests | `pnpm --filter @exam/web test` | ~122–132s | jsdom, no PG; the real nodb cost |
| nodb (cold) | `pnpm test:nodb --force` | ~115s | ≈ web (slowest package) since turbo is parallel |
| nodb (warm) | `pnpm test:nodb` | 76ms | FULL TURBO cached |
| coverage:api | `pnpm coverage:api` | ~api-sized | re-runs api suite under instrumentation |

## Slow test files (api, per-file wall from JSON reporter)

Sum of all 63 file walls = **49.3s**; the remaining ~70s of the 119s is
per-file import + build overhead NOT counted in `tests`.

| File | Duration | DB? | buildTestApp calls | Notes |
|---|---:|---:|---:|---|
| routes/examTransitions.test.ts | 5.36s | yes | 6 | reconciliation + audit characterization |
| routes/auth.test.ts | 4.09s | yes | 6 | 6× login + audit polling (auth amplification) |
| routes/exam.test.ts | 3.90s | yes | 9 | full exam lifecycle, most builds |
| routes/audit.test.ts | 3.80s | yes | — | audit-list assertions |
| routes/attempts/candidate-save-submit.test.ts | 2.44s | yes | 2 | answer protocol + submit |
| routes/export.test.ts | 2.17s | yes | — | CSV export |
| routes/smoke-tests/api-smoke.test.ts | 2.10s | yes | — | smoke |
| routes/scores.test.ts | 2.01s | yes | — | scores |
| routes/user.test.ts | 1.96s | yes | — | (K-1 residual sub-set coupling) |
| routes/testBackgroundJobs.test.ts | 1.73s | yes | — | scanner integration |
| routes/attempts/deadline-scanner.test.ts | 1.51s | yes | — | deadline auto-submit |
| routes/resultPublishing.test.ts | 1.50s | yes | — | publication mode |
| (remaining ~50 files) | <1.3s each | — | — | tail is fast |
| **non-DB plugins/config files** | 0.00–0.03s | no | 0 | rateLimit/heartbeat/logRedaction/etc. |

Total `buildTestApp` references across api test files: **~58**. Each one (in
the default `file-schema` path) runs CREATE SCHEMA + migratePostgres + seed.

## Current parallelism settings

| Layer | Setting | Current value | Notes |
|---|---|---|---|
| apps/api vitest `fileParallelism` | `false` (default) | serial | BUG-FLAKE-001 mitigation; maxWorkers forced to 1 |
| apps/api opt-in parallel | `TEST_DB_ISOLATION=worker-database` + `API_TEST_MAX_WORKERS=N` | off by default | both required to enable |
| apps/api vitest pool | (not set) | vitest default `forks` w/ isolation | one fork per file |
| packages/db vitest | default (parallel) | parallel | 8 files, 6 DB; safe per db/vitest.config.ts notes |
| packages/web vitest | default (parallel) | parallel | jsdom; unrelated to PG |
| turbo package parallel | turbo default | parallel | `@exam/api#test` dependsOn `@exam/db#test` (api waits db) |

## Current DB lifecycle

Per `buildTestApp` (testHelpers.ts), **default `file-schema` path**:
1. `setupIsolatedTestDb({namespace:"api"})` → generates unique schema name
   (`test_api_<worker>_<pid>_<ctr>_<rand>`), `CREATE SCHEMA IF NOT EXISTS`
   inside the cross-process advisory lock.
2. `createDatabase(dbUrl, schemaName)` → postgres.js pool with
   `?options=-c search_path=<schema>,public`.
3. `migratePostgres(conn.db, {migrationsSchema})` → runs all 7 Drizzle
   migrations (233 lines total) into the new schema. Drizzle tracks applied
   migrations in `__drizzle_migrations`, but a fresh schema has none, so it
   runs all 7 every time.
4. `seed(db, hashPassword)` → inserts 1 org + 3 users (upsert on conflict).
5. App is built, plugins registered, tokens minted.
6. On cleanup: `app.close()`, `conn.sql.end()`, `DROP SCHEMA ... CASCADE`
   inside the advisory lock.

`migratePostgres` cost = **~84 ms/build** (measured). Repeated ~58× ≈ ~5s of
pure migration I/O, plus ~36ms schema-create × 58 ≈ ~2s, plus cleanup ~51ms
× 58 ≈ ~3s. Total per-build lifecycle ≈ **~195ms × 58 ≈ 11s** of the api
suite, but it is spread across the `tests` (74.8s) and `import` (35.7s) time.

## Current seed lifecycle

- **Test seed** (`packages/db/src/seed.ts`): called inside EVERY `buildTestApp`
  (`testHelpers.ts:199`). Idempotent upsert: 1 organization (slug "default") +
  3 users (admin/candidate/candidate2). Small (3 password hashes, 4 rows).
  Cost ≈ **~12 ms/build**. NOT the dominant cost; the migrate that precedes
  it (~84ms) dominates the build cycle.
- **No per-test re-seed**: within a file, builds reuse the same seeded ctx.
- **E2E seed** (`e2e-seed.ts`, `RUN_SEED=e2e`): separate, baseline + demo
  candidate1..4; only for E2E compose. Not shared with unit/api tests.
- **Default org/user**: slug "default", users admin/candidate/candidate2.
  Per-file schema isolation means each file gets its OWN copy (no shared ID
  pollution) — but every file pays the seed cost.

## Current Redis lifecycle

- Redis is **optional**; default test runs have `REDIS_URL=""` (unset) →
  `fastify.redis` is null, no connection. The redis baseline test
  (`redis.test.ts`) SKIPs connection tests when Redis is absent.
- No runtime consumer reads `fastify.redis` except the diagnostics health
  check. So Redis adds **~0 cost** to normal test runs.
- When enabled, prefix isolation + SCAN cleanup applies (Phase 2 收口 C).

## Initial hypotheses

| Hypothesis | Classification | Evidence |
|---|---|---|
| Per-build CREATE SCHEMA + migrate (7 files) repeated ~58× is a major api cost | **likely** | bench ~195ms/build; migrate=84ms is the biggest single build cost; 58 builds |
| Redundant per-file module import (Fastify+plugins+db) is a major api cost | **likely** | `import 35.7s` in vitest breakdown; serial forks re-import the stack per file |
| web/jsdom suite dominates nodb and is unrelated to PG | **confirmed** | web 122–132s vs auth 1.5s; env 41s + import 23.5s; web has no PG dependency |
| Seed (org+3 users) is the dominant cost | **unlikely** | seed ≈ 12ms/build; migrate (84ms) is ~7× the seed cost |
| Concurrent migration DDL contention (BUG-FLAKE-001 I/O) | **possible** | advisory lock already serializes DDL; under serial api runs contention is minimal; matters only if parallelism is restored |
| Coverage instrumentation amplifies api I/O | **possible** | verify runs api test + api coverage separately; coverage is a separate ~api-sized cost |
| Background scanners leak across tests | **disproved** | scanners clear their interval on `onClose` (heartbeat.ts:254, deadlineScanner.ts:244); app.close() between contexts |

## Do not change yet

- **`apps/api` `fileParallelism`** — stays `false` (serial). Restoring needs
  the migrate/build-cost reduction + stress evidence first (Phase 7).
- **`packages/db` parallelism** — already parallel and safe; do not touch.
- **`packages/web` parallelism** — jsdom cost is its own problem, not a PG
  I/O problem; out of scope for THIS task (PG I/O). Tracked separately.
- **business state machines, API contracts, seed E2E semantics** — unchanged.
- **PostgreSQL as canonical state source** — unchanged; Redis stays optional.
