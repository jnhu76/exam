# ADR-007 — Stateful Infrastructure Test Isolation

## Status

ACCEPTED (infrastructure implemented, Phase 6G/7 deferred).

Phase 2–4 and 6E are implemented and enforced. Phases 5A/5B and 6D have
local-only evidence; Phases 6 and 6F have CI config prepared but await live
validation. The core isolation contract (per-worker DB, scope resolver,
background default-off) is in active use. Phase 6G (live CI validation) and
Phase 7 (Redis/Queue prefix) remain deferred until triggered.

This ADR is a **long-term architecture constraint** that governs how every
stateful test resource (PostgreSQL, Redis, Queue, background worker) is
allocated, isolated, and cleaned up. Implementation phases are sequenced in
`docs/archive/dev/test-ci-parallelism-plan.md`.

## Context

The exam platform runs its API / DB / integration tests against a **real
PostgreSQL** instance. Real PostgreSQL is non-negotiable for correctness,
because a set of behaviors can only be exercised on the real engine:

- multi-statement transactions and `ROLLBACK` semantics
- row-level locks and `SELECT ... FOR UPDATE`
- constraints (FK, unique, check) enforced by the engine
- Drizzle migration mechanics (including schema-scoped migration tracking)
- tenant isolation (`organizationId` data boundary)
- audit persistence under the answer save protocol
- the deadline / disrupted scanner against real `exam_attempts` rows
- concurrent start / save / submit flows

Tests today are slow, and the slowness is structural rather than incidental.
The contributing factors, as evidenced in `apps/api/vitest.config.ts`,
`docs/standards/test-flakes.md`, and `docs/archive/known-test-isolation-issues.md`:

- `apps/api/vitest.config.ts` sets `fileParallelism: false`. Vitest's
  `resolveConfig` then forces `maxWorkers = 1`, so all ~45 API test files run
  strictly serial. The CI flag cannot bypass this.
- Each test file currently provisions its own PostgreSQL schema via
  `packages/db/src/testIsolation.ts` (`setupIsolatedTestDb()` /
  `buildTestApp({ schemaName })`): `CREATE SCHEMA` → migration → seed at
  start, `DROP SCHEMA ... CASCADE` at end.
- The historical reason serial execution was retained is captured in
  `docs/standards/test-flakes.md` as `BUG-FLAKE-001`. This ADR treats that record
  strictly as **historical background and motivation**. This ADR does **not**
  claim the flake is fixed, and does not authorize removing any current
  mitigation.
- Serial execution plus per-file schema create/migrate/drop roughly doubles
  the `apps/api` test and coverage time versus a parallel baseline. The
  parallel baseline itself is not currently safe at default worker counts, as
  documented in `BUG-FLAKE-001` PR86 diagnostic matrix.

Beyond PostgreSQL, the platform is on a trajectory toward more stateful
infrastructure (see ADR-001 Redis, ADR-003 Job Queue — both Deferred today):

- Redis presence
- Redis rate limiting
- queue / BullMQ
- outbox processor
- deadline scanner as a queue-backed job
- async audit writer
- background workers

If isolation rules are designed only for PostgreSQL, the same class of flake
(implicit cross-worker shared state) will simply reappear on Redis and Queue
once they arrive. This ADR therefore defines a **single isolation contract**
that covers PostgreSQL, Redis, Queue, and background workers together.

## Non-Goals

- No claim that `BUG-FLAKE-001` (or any entry in `test-flakes.md`) is fixed.
  Existing mitigations (`fileParallelism: false`, `verify:db-tests` serial
  chain, scanner legacy timeout, per-file schema isolation) remain in force
  until a follow-up PR removes them with its own evidence.
- No replacement of real PostgreSQL with SQLite, `pg-mem`, or any in-process
  fake. Real PostgreSQL stays the only engine for correctness-critical tests.
- No test-only migrations and no business-schema changes made for test speed.
- No change to the product's LAN / on-premise / offline posture. This is about
  the test harness only.

## Does this change the production database schema?

No.

This ADR only changes test infrastructure topology and lifecycle. It does not
change production tables, columns, indexes, constraints, enums, foreign keys,
or migration semantics. Per-worker databases, Redis prefixes, and queue
prefixes exist solely in the test harness; none of them are referenced by
production code paths.

## Implementation Status

State taxonomy used in this table:

- **ACCEPTED_AND_ENFORCED** — decision accepted and implementation enforced in
  local dev and CI (e.g., scope resolver, worker DB isolation, background
  default-off).
- **LOCAL_ONLY_EVIDENCE** — implementation works locally and has local stress
  evidence, but has not been validated in live CI or at coverage scale.
- **CONFIG_PREPARED** — CI/workflow configuration is in place but has not yet
  been exercised by a real CI run.
- **LIVE_CI_UNVALIDATED** — CI configuration exists; live validation is pending.
- **DEFERRED** — explicitly postponed until a documented trigger fires.

| Phase                            | Status                    | Evidence / Notes                                    |
| -------------------------------- | ------------------------- | --------------------------------------------------- |
| Phase 2A — scope resolver        | ACCEPTED_AND_ENFORCED     | resolver + scope naming landed                      |
| Phase 3A — worker DB prototype   | ACCEPTED_AND_ENFORCED     | db helper tested                                    |
| Phase 3B — API worker DB opt-in  | ACCEPTED_AND_ENFORCED     | API suite can run serial in worker DB mode           |
| Phase 4 — background default-off | ACCEPTED_AND_ENFORCED     | buildTestApp does not auto-start scanner timers     |
| Phase 5A — local maxWorkers=2    | LOCAL_ONLY_EVIDENCE       | 5/5 local stress pass; not CI-ready, not coverage/global proof |
| Phase 5B — local maxWorkers=4    | LOCAL_ONLY_EVIDENCE       | 5/5 local stress pass; local recommended mode; not CI-ready, not coverage/global proof |
| Phase 6 — CI shard               | CONFIG_PREPARED           | 2 shards × 1 worker in ci.yml; live CI validation pending |
| Phase 6D — physical DB lifecycle contention | LOCAL_ONLY_EVIDENCE | advisory lock + unique DB names + robust drop; coverage:db 5/5 PASS, verify 1/1 PASS + 2/2 stress; does not close BUG-FLAKE-001 |
| Phase 6E — CI verify gate dedup | ACCEPTED_AND_ENFORCED     | `verify:ci` uses coverage as test entry; `verify`/`verify:db-tests`/api-fast/e2e semantics unchanged |
| Phase 6F — CI job DAG optimization | CONFIG_PREPARED        | new `static` job; `verify`/`api-fast`/`e2e` now `needs: static` (parallel); test semantics unchanged; live CI validation pending |
| Phase 6G — Live CI validation    | DEFERRED                  | Blocked until GitHub Actions can run. Must validate `static`/`verify`/`api-fast`/`e2e` on the real CI DAG before changing defaults or closing ADR-007. Local evidence is not sufficient. |
| Phase 7 — Redis / Queue prefix   | DEFERRED                  | Only when Redis / Queue adoption is triggered       |

## Current Recommended Modes

### Local recommended

```bash
TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api test
```

Only for local API suite. Based on Phase 5B 5/5 stress evidence. Does not
imply CI should use 4 workers.

### Local conservative

```bash
TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=2 pnpm --filter @exam/api test
```

Use if local machine has fewer cores or IO contention.

### Legacy fallback

```bash
TEST_DB_ISOLATION=file-schema pnpm --filter @exam/api test
```

Remains available. Still uses existing BUG-FLAKE-001 mitigation path. Slower
but useful for rollback / debugging.

### Worker DB serial

```bash
TEST_DB_ISOLATION=worker-database TEST_WORKER_ID=1 pnpm --filter @exam/api test
```

Only for serial debugging. Never use `TEST_WORKER_ID=1` in parallel / shard
mode.

## Critical Warning: Do Not Set TEST_WORKER_ID in Parallel or Shard Mode

In serial worker-database debugging, `TEST_WORKER_ID=1` is allowed.

In parallel mode, `TEST_WORKER_ID` must not be set.

`resolveWorkerId()` prioritizes `TEST_WORKER_ID` over `VITEST_WORKER_ID`.
If `TEST_WORKER_ID=1` is set during parallel Vitest execution, all workers
will use the same database, such as `exam_test_w1` or `exam_test_s1_w1`.
That breaks worker isolation.

Correct:

```bash
TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api test
```

Wrong:

```bash
TEST_DB_ISOLATION=worker-database TEST_WORKER_ID=1 API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api test
```

CI shard — same rule:

Correct:

```bash
TEST_INFRA_SCOPE=ci TEST_SHARD_INDEX=1 TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=1 pnpm --filter @exam/api exec vitest run --shard=1/2
```

Wrong:

```bash
TEST_INFRA_SCOPE=ci TEST_SHARD_INDEX=1 TEST_DB_ISOLATION=worker-database TEST_WORKER_ID=1 API_TEST_MAX_WORKERS=1 pnpm --filter @exam/api exec vitest run --shard=1/2
```

## Decision

Adopt a **single test-scope model** in which every test scope owns its
PostgreSQL database, its Redis key prefix, and its Queue prefix, and in which
background workers are off by default unless a test explicitly opts in.

```
Every test scope must own its PostgreSQL database, Redis key namespace,
and Queue prefix.

Ordinary tests do not start background workers by default.

Background and queue worker tests must be explicit, dedicated, and serial
unless proven worker-safe.
```

The scope identifier binds all four resources together. No mutable namespace
may be shared across scopes. Different scopes MAY share the same physical
PostgreSQL / Redis service, but they MUST NOT share a PG database, a Redis key
prefix, a Queue prefix, or a background worker lifecycle.

### 1. Test scope

A test scope is a single string that uniquely identifies an isolated resource
set. Within a single test scope, app instances, connection pools, and handles
MAY use that scope's resources. Across scopes, no mutable namespace may cross
the boundary. In particular, ordinary API tests MUST NOT have multiple
distinct Vitest workers share a single ordinary test scope — each ordinary
worker gets its own scope id (`local_w{w}` / `s{shard}_w{w}`). Dedicated
scopes (`background`, `concurrency`, `e2e`) are single-namespace by design.

| Scope kind               | Scope id format | Used by                          |
| ------------------------ | --------------- | -------------------------------- |
| Local ordinary worker    | `local_w{w}`    | local `pnpm --filter @exam/api test` |
| CI shard worker          | `s{shard}_w{w}` | CI `api-fast` shard matrix       |
| Background dedicated     | `background`    | background-job test group         |
| Concurrency dedicated    | `concurrency`   | true concurrency test group       |
| E2E dedicated            | `e2e`           | Playwright / full browser tests   |

The same scope id MUST bind all of:

- PostgreSQL database
- Redis key prefix
- Queue prefix
- background worker lifecycle

### 2. PostgreSQL isolation

Local ordinary tests:

```
exam_test_w{worker}
```

CI ordinary tests:

```
exam_test_s{shard}_w{worker}
```

Rules:

- Ordinary API / integration tests use a **per-worker database**.
- Each worker database is **migrated once** per test run, not per file.
- State is reset between tests with `TRUNCATE ... RESTART IDENTITY CASCADE`,
  not by recreating the schema. The implementation PR MUST declare an explicit
  reset boundary (per-file or per-test) and that boundary MUST preserve test
  independence. This ADR does not mandate `beforeEach` truncation for every
  suite; the chosen boundary just has to keep tests from observing each other's
  state.
- No SQLite / `pg-mem` substitution for correctness-critical tests.
- No business-schema modification for test speed.
- No test-only migration in place of the real migration.

Background, concurrency, and E2E scopes use their own dedicated databases
(`exam_test_background`, `exam_test_concurrency`, `exam_test_e2e`).

> Note: the existing per-file schema mechanism in
> `packages/db/src/testIsolation.ts` is retained as the **legacy fallback**
> (`TEST_DB_ISOLATION=file-schema`). This ADR sets the long-term default to
> per-worker database; the fallback must remain until Phase 3 stress evidence
> justifies its removal in a separate PR.

### 3. Redis isolation

Local ordinary tests:

```
exam:test:local:w{worker}:
```

CI ordinary tests:

```
exam:test:s{shard}:w{worker}:
```

Rules:

- Redis is a **first-class stateful test resource**, treated with the same
  isolation discipline as PostgreSQL.
- Redis `SELECT DB` is **not** the long-term primary isolation mechanism. It
  is fragile under shared instances and not portable across environments.
- Preferred isolation is **CI shard-level Redis service/container** plus
  **worker-level key prefix**.
- Redis cleanup MUST be **prefix-scoped by default**.
- `FLUSHDB` / `FLUSHALL` is permitted **only** when the current Redis instance
  (or database) is fully dedicated to the current test scope. Otherwise only
  keys under the current prefix may be deleted.

### 4. Queue / BullMQ isolation

Queue prefix:

Local ordinary tests:

```
exam:test:local:w{worker}
```

CI ordinary tests:

```
exam:test:s{shard}:w{worker}
```

Rules:

- The Queue MUST reuse the same test scope as PostgreSQL and Redis.
- When using BullMQ, isolation MUST be via BullMQ's `prefix` option. The
  `Queue`, `Worker`, `QueueEvents`, and `FlowProducer` for a given scope MUST
  all use the same `prefix`.
- `ioredis` `keyPrefix` MUST NOT be used as the BullMQ isolation mechanism.
  BullMQ composes its own keys and the `keyPrefix` can corrupt key layout.
- Ordinary API tests MUST NOT start queue workers by default.
- Ordinary API tests MAY verify enqueue behavior, but they are **producer-only**
  by default.
- Queue worker / retry / delay / consumer tests MUST live in the background or
  concurrency test group, not in the ordinary API suite.
- `Queue`, `Worker`, `QueueEvents`, `FlowProducer`, Redis clients, and timers
  MUST be explicitly closed in teardown. Leaked workers are a test-defining bug,
  not a tolerated artifact.

### 5. Test taxonomy (summary; full version in `docs/archive/dev/test-suite-taxonomy.md`)

| Group          | Purpose                                     | Isolation                                  | Execution                  |
| -------------- | ------------------------------------------- | ------------------------------------------ | -------------------------- |
| ordinary API   | single-link route / flow / validation / auth / admin / candidate / grading correctness | PG worker database; Redis worker prefix; queue producer-only or disabled; background jobs off | local `maxWorkers=4`; CI shard `maxWorkers=1~2` |
| background-job | deadline scanner, heartbeat disrupted, audit polling, outbox processor, queue worker, async audit writer | dedicated PG database; dedicated Redis prefix/service; dedicated queue prefix; workers explicitly enabled | serial or low worker count |
| true concurrency | start attempt race, submit idempotency race, restore race, `FOR UPDATE` lock behavior, scanner idempotency, tenant isolation under concurrent requests | dedicated infrastructure; concurrency manufactured inside the test | runner usually serial |
| E2E            | Playwright, admin/candidate demo flow, refresh during exam, full browser flow | dedicated seeded PG; dedicated Redis/Queue namespace; workers explicit | PR smoke; main/nightly full |

## Considered options

### PostgreSQL isolation options

1. **Current: per-file schema + serial execution.** Eliminates cross-file state
   leak, but serial execution doubles `apps/api` test/coverage time and per-file
   `CREATE SCHEMA` + migrate + `DROP SCHEMA` is the bulk of per-file cost.
   Status quo baseline, not the long-term default.
2. **Per-file schema + `fileParallelism=true`.** Keeps schema isolation but
   parallelizes schema create/migrate/drop across files; this is the exact
   throughput bottleneck documented in `BUG-FLAKE-001` PR86 diagnostic matrix.
   Rejected as the long-term default.
3. **Per-worker schema.** Reduces file count × migrate cost to worker count ×
   migrate cost. Improvement, but still pays schema create/drop per run and
   keeps the `search_path` machinery.
4. **Per-worker database (chosen for local ordinary tests).** One
   `exam_test_w{w}` per worker, migrated once, truncated between tests. Best
   trade-off between isolation and per-run cost. Long-term local default.
5. **Per-test-group database.** One database per taxonomy group. Stronger
   isolation between groups, used for background / concurrency / E2E.
6. **CI shard + per-worker database (chosen for CI ordinary tests).** Each CI
   matrix shard gets its own PostgreSQL service and each worker within the shard
   gets its own database. Long-term CI default.
7. **Transaction rollback per test.** Fast, but incompatible with tests that
   must observe committed state across requests, scanners, and workers
   (commit-visible deadline scans, audit polls, `FOR UPDATE` across
   transactions). Rejected as the primary mechanism.
8. **PostgreSQL template database.** `CREATE DATABASE ... TEMPLATE <template>`
   pre-bakes the migrated schema so a worker database is a fast `CREATE
   DATABASE` clone rather than a full migration. **Phase 8 optional
   optimization**, not a Phase-1 requirement. Adopt only if migration/seed
   cost on per-worker databases is still too high after Phase 3.

### Redis isolation options

1. **Redis `SELECT DB`.** Simple, but not portable, fragile under shared
   instances, and a 16-DB ceiling. **Rejected as the long-term primary
   isolation.**
2. **Redis key prefix (chosen default).** `exam:test:s{shard}:w{worker}:`.
    Portable, composes with CI service isolation, and works on a shared
    instance. Long-term default.
3. **Dedicated Redis service/container per CI job (chosen for CI).** Pair with
    option 2: shard-level dedicated Redis + worker-level prefix. Eliminates
    cross-shard contention entirely.

### Queue isolation options

1. **`TEST_QUEUE_MODE`: `disabled` / `producer-only` / `worker-enabled`.**
    - `disabled`: ordinary tests where no enqueue is exercised.
    - `producer-only` (default for ordinary API tests that touch enqueue): the
      test asserts the enqueue succeeded and the job row exists; no consumer.
    - `worker-enabled`: only in background or concurrency tests, with explicit
      worker lifecycle and teardown.

## Consequences

Positive:

- One mental model covers PostgreSQL, Redis, and Queue as a test reaches more
  stateful infrastructure.
- Ordinary API tests regain safe parallelism: per-worker database eliminates
  the per-file schema create/migrate/drop cost that is the documented
  throughput bottleneck.
- Background and queue worker tests become explicit, dedicated, and isolated,
  instead of leaking workers into the ordinary suite.
- Cleanup invariants become uniform: `resetPostgres()`, `resetRedisByPrefix()`,
  `resetQueues()`, `closeInfra()`.

Negative / cost:

- Requires a datasource / scope resolver, per-worker database provisioning,
  and Redis/Queue prefix plumbing — sequenced in the rollout plan.
- The current `fileParallelism: false` and `verify:db-tests` chain cannot be
  removed by this ADR; each removal is a follow-up PR with stress evidence.
- Migration cost on a fresh per-worker database must be measured. If it is
  still too high, Phase 8 (template database) is the lever, not premature
  optimization.

## Environment variables

This ADR defines the recommended environment variable surface. Introducing the
variables themselves is a Phase 2+ implementation concern; this PR only
documents the contract.

```
TEST_INFRA_SCOPE=local|ci
TEST_SHARD_INDEX=local|1|2|3
TEST_WORKER_ID={vitest worker id}

TEST_DB_ISOLATION=worker-database|file-schema
TEST_DATABASE_URL_TEMPLATE=postgres://.../exam_test_s{shard}_w{worker}

TEST_REDIS_ISOLATION=prefix|database|service
TEST_REDIS_URL=redis://localhost:6379
TEST_REDIS_PREFIX=exam:test:s{shard}:w{worker}:

TEST_QUEUE_MODE=disabled|producer-only|worker-enabled
TEST_QUEUE_PREFIX=exam:test:s{shard}:w{worker}

API_TEST_GROUP=fast|background|concurrency|all
API_TEST_MAX_WORKERS=1|2|4
```

`TEST_WORKER_ID` should be resolved from the test runner when possible (e.g.
the runner's per-worker identifier), not manually supplied by developers. A
manually-set worker id defeats the purpose of per-worker isolation and can
silently collapse two workers onto one database/prefix. The other variables
above describe the contract surface; introducing them is a Phase 2+
implementation concern, not part of this PR.

Rollback must remain available:

```
TEST_DB_ISOLATION=file-schema
API_TEST_MAX_WORKERS=1
fileParallelism=false
```

`fileParallelism: false` in `apps/api/vitest.config.ts` is the existing rollback
lever. Vitest's `resolveConfig` forces `maxWorkers = 1` when
`fileParallelism: false`, so this lever cannot be bypassed by a CI flag — which
is exactly why it is a reliable rollback.

## Cleanup invariants

The test harness MUST expose a uniform cleanup surface with these semantics:

```
resetPostgres()       // TRUNCATE ... RESTART IDENTITY CASCADE on the worker DB
resetRedisByPrefix()  // delete keys under the current scope prefix only
resetQueues()         // drain / obliterate the current scope's queues
closeInfra()          // close pools, redis clients, workers, timers
```

Hard invariants (any violation is a test-defining bug, not a tolerated flake):

- No leaked PostgreSQL pools.
- No leaked Redis connections.
- No leaked `Queue` / `Worker` / `QueueEvents` / `FlowProducer`.
- No leaked timers / intervals.
- No background jobs running in ordinary tests unless explicitly enabled.
- No shared mutable state across workers.
- No shared mutable state across CI shards.

## Local strategy

Local target (Phase 5+, after Phase 2–4 land):

```
fileParallelism=true
maxWorkers=4
TEST_INFRA_SCOPE=local
TEST_DB_ISOLATION=worker-database
```

Local ordinary API test layout:

```
worker 1 -> PG exam_test_w1,  Redis exam:test:local:w1:, Queue prefix exam:test:local:w1
worker 2 -> PG exam_test_w2,  Redis exam:test:local:w2:, Queue prefix exam:test:local:w2
worker 3 -> PG exam_test_w3,  Redis exam:test:local:w3:, Queue prefix exam:test:local:w3
worker 4 -> PG exam_test_w4,  Redis exam:test:local:w4:, Queue prefix exam:test:local:w4
```

## CI strategy

CI MUST NOT rely solely on Vitest workers inside a single job. CI target:

```
api-fast shard 1/N
api-fast shard 2/N
api-fast shard 3/N
api-background serial
api-concurrency serial
e2e-smoke
```

Each CI job SHOULD own its own PostgreSQL service / Redis service, or at
minimum a unique database / prefix within a shared service.

CI ordinary API shard:

```
maxWorkers=1~2
PG:          exam_test_s{shard}_w{worker}
Redis:       exam:test:s{shard}:w{worker}:
Queue prefix: exam:test:s{shard}:w{worker}
```

## Rollout plan (summary)

Full sequencing and acceptance gates live in
`docs/archive/dev/test-ci-parallelism-plan.md`. Phases at a glance:

- **Phase 0 — docs only (this PR).** Add ADR + plan + taxonomy. No code change.
- **Phase 1 — classify tests.** Tag ordinary / background / concurrency / E2E.
- **Phase 2A — scope resolver (Completed).** Scope resolver for local worker
  and CI shard+worker, with legacy `file-schema` fallback.
- **Phase 3A — worker DB prototype (Completed).** Worker database helper
  tested.
- **Phase 3B — API worker DB opt-in (Completed).** API suite can run serial
  in worker DB mode.
- **Phase 4 — background jobs explicit opt-in (Completed).** `buildTestApp()`
  does not start scanner / poller / queue worker by default; background tests
  opt in.
- **Phase 5A — local maxWorkers=2 (Completed).** 5/5 stress pass.
- **Phase 5B — local maxWorkers=4 (Completed).** 5/5 stress pass; local
  recommended mode.
- **Phase 6 — CI sharding (Planned / Prepared next).** `api-fast` matrix
  shards, per-shard `maxWorkers=1~2`, background/concurrency/E2E as separate
  jobs. Live CI validation pending.
- **Phase 7 — Redis / Queue integration (Deferred).** Redis prefix resolver,
  queue prefix resolver, `producer-only` mode, `worker-enabled` only in
  dedicated tests. Only when Redis / Queue adoption is triggered.
- **Phase 8 — optional template DB.** If migration/seed is still slow,
  `CREATE DATABASE exam_test_s{shard}_w{worker} TEMPLATE exam_template_{hash}`.

## Phase 6 Plan — CI Shard + Worker Database Isolation

Status: Config prepared; live CI shard validation pending. Live CI validation is
currently unavailable. This phase must not claim CI speedup until real CI
timing exists.

**Goal**: CI uses GitHub Actions matrix shards with worker-database isolation,
not single-job Vitest workers.

**First CI shape** (2 shards x 1 worker):

```
api-fast shard 1/2:
  TEST_INFRA_SCOPE=ci
  TEST_SHARD_INDEX=1
  TEST_DB_ISOLATION=worker-database
  API_TEST_MAX_WORKERS=1
  vitest --shard=1/2

api-fast shard 2/2:
  TEST_INFRA_SCOPE=ci
  TEST_SHARD_INDEX=2
  TEST_DB_ISOLATION=worker-database
  API_TEST_MAX_WORKERS=1
  vitest --shard=2/2
```

Database naming:

```
shard 1 worker 1 -> exam_test_s1_w1
shard 2 worker 1 -> exam_test_s2_w1
```

If later tuned to 2 workers per shard:

```
shard 1 worker 2 -> exam_test_s1_w2
shard 2 worker 2 -> exam_test_s2_w2
```

**Acceptance gates**:

- Local simulated shard 1/2 passes.
- Local simulated shard 2/2 passes.
- Legacy file-schema still passes.
- Local worker-db maxWorkers=4 still passes.
- `pnpm verify` passes or unrelated failure documented.
- Docs clearly say live CI validation pending.

## Phase 7 Plan — Redis / Queue Prefix Integration

Status: Deferred until Redis / Queue adoption.

**Trigger conditions** — Phase 7 only starts when one or more of the
following lands:

- Redis presence
- Redis rate limit
- BullMQ / queue
- Outbox processor
- Async audit writer
- Queue-backed deadline scanner
- Background worker consuming jobs

**Scope**:

- Implement Redis prefix resolver (`exam:test:{scope}:`).
- Implement queue prefix resolver (`exam:test:{scope}`).
- Implement `TEST_QUEUE_MODE=disabled|producer-only|worker-enabled`.
- Ordinary API tests default to queue disabled or producer-only.
- Worker / consumer / retry / delay tests run in background / concurrency
  group.
- Implement cleanup: `resetRedisByPrefix()`, `resetQueues()`, `closeInfra()`.
- Ensure no leaked Redis connections.
- Ensure no leaked `Queue` / `Worker` / `QueueEvents` / `FlowProducer`.
- If BullMQ is adopted, use BullMQ `prefix`, not ioredis `keyPrefix`.

**Explicitly not done**:

- Phase 7 is not required to finish current PostgreSQL test-infra work.
- Redis / Queue must not be introduced only for testing.

### Phase 6G — Live CI validation TODO

Status: **Deferred until GitHub Actions can run.**

Phase 6G is required because **local evidence cannot prove CI stability**. The
optimized CI DAG (Phase 6F) and the worker-database shard job (`api-fast`) must
be validated on GitHub Actions before ADR-007 can be considered complete. Local
stress (Phase 6D `coverage:db` 5/5, `pnpm verify` PASS) is necessary but not
sufficient: CI differs in CPU scheduling, PostgreSQL service behavior, cold-start
timing, cache state, and job parallelism.

**Blocked decisions** (do not proceed until live CI evidence exists):

- default worker-database mode
- removing `apps/api fileParallelism:false`
- removing `verify:db-tests`
- treating `api-fast` as a replacement gate
- closing BUG-FLAKE-001 globally
- further CI DAG / artifact-sharing optimization based only on local evidence

**Acceptance evidence** (minimum): one clean GitHub Actions run on the new DAG
with `static` / `verify` / both `api-fast` shards / `e2e` all PASS, and no
recurrence of physical-DB-lifecycle timeout, auth amplification timeout,
worker-database shard isolation failure, or e2e ordering/cold-start failure.
Preferred: 3 consecutive clean runs with recorded timing. Full checklist lives
in `docs/standards/test-flakes.md` Phase 6G section.

## Completion Boundary

> **Phase 6 completion-boundary 修正（2026-06-23）**：ADR-007 **不能**算作已完全关闭，除非
> 残留缓解**要么**以 stress 证据移除，**要么**被明确接受为永久设计决策。当前仍在的缓解：
>
> - `apps/api` `fileParallelism: false`（默认串行；worker-database 仍 opt-in，未默认）。
> - `verify:db-tests` 串行链（`test:db && test:api && coverage:db && coverage:api`）。
> - scanner legacy timeout（15_000ms）。
> - worker-database opt-in 状态（未设为默认 / CI 默认）。
> - CI shard live validation pending。
> - **auth amplification 仍 open**（`auth.test.ts` 在全量 coverage + PG I/O 争用下的 5s
>   timeout 子类，未单独修复）。
>
> 因此 Phase 5 的 "Completed" 仅是 **local-only / test-only evidence**；Phase 6 的
> "Config prepared" 仅是**配置就绪，live CI validation pending**。
>
> **Phase 6D（2026-06-23）补充**：physical DB lifecycle contention 已实现根因缓解
> （PostgreSQL advisory lock 串行化 heavy test-infra DDL/migration + per-run unique DB
> names + robust DROP with connection termination），local 证据 `coverage:db` 5/5 PASS、
> `pnpm verify` 1/1 + 2/2 stress PASS。这**只**修复 BUG-FLAKE-001 的 physical-DB-lifecycle
> 子类，**不**关闭 BUG-FLAKE-001 全局（auth amplification 子类 + A′ serial 仍在），**不**
> 构成 CI 证据，**不**允许移除上述任何残留缓解。在上述缓解移除 / 永久化决策 + CI live
> validation 完成之前，ADR-007 保持 Proposed / not-fully-closed。

For the current PostgreSQL test-infra track, ADR-007 is considered complete
when:

1. Local worker-database API mode has stress evidence. **(done — Phase 5B)**
2. Legacy file-schema fallback remains available. **(done — retained)**
3. CI shard configuration is prepared and documented. **(done — Phase 6 plan)**
4. Live CI validation status is explicitly recorded. **(pending — Phase 6)**
5. Redis / Queue integration is either implemented or explicitly deferred until
   adoption. **(done — Phase 7 deferred)**

Phase 7 is not a blocker unless Redis / Queue has been adopted.

PostgreSQL local / CI test isolation can be completed before Redis / Queue
exists. Redis / Queue prefix integration is adoption-triggered, not mandatory
upfront work.

## Validation matrix (acceptance gates, not run in this PR)

Local:

```
pnpm --filter @exam/api test
API_TEST_MAX_WORKERS=2 pnpm --filter @exam/api test
API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api test
repeat maxWorkers=4 five times
pnpm verify
```

CI:

```
api-fast shard 1/N
api-fast shard 2/N
api-fast shard 3/N
api-background serial
api-concurrency serial
e2e-smoke
```

Targeted stress (each `x5`):

```
auth tests
candidate flow tests
admin flow tests
deadline scanner tests
audit polling tests
queue producer tests
queue worker tests
tenant isolation tests
```

Failure principles:

- Do NOT mask failure by raising timeouts.
- Do NOT silently skip flaky tests.
- MUST record minimum reproduction, failure log, and the suspected invariant
  violation.

## Acquisition-count contract for the lifecycle lock (2026-08-26 audit addendum)

The Phase 6D lifecycle lock serializes heavy DDL on purpose; the 2026-08-26
drifting-timeout audit (see `docs/standards/test-flakes.md` "2026-08-26" entry)
showed the failure mode is not the lock itself but its **queue load**: measured
244 acquisitions per `@exam/db` coverage run with median wait ~0.7s / p95 ~2.2s
on fully green runs, scaling monotonically with worker count (workers=1:
p50 19ms). Two structural rules now bound the load at the seams:

1. **One critical section per setup.** `getIsolatedTestDb` batches
   CREATE SCHEMA + migrate into a single
   `withTestInfraLifecycleLock` acquisition. Any future setup seam MUST NOT
   split its bootstrap across multiple lock acquisitions — each extra
   acquisition pays a full global queue wait.
2. **Bootstrap once per process per database.** The worker-database path
   memoizes ensure+migrate per resolved worker URL; repeated setups in the
   same process acquire the lock zero times. Vitest runs every test file in a
   fresh isolated worker process (workers are not reused under the default
   `isolate` semantics), so process scope == file scope.
3. **Split keys by resource class.** The single shared key meant one
   long-tail physical-DDL outlier (a measured 23.4s `DROP DATABASE` on WSL2
   I/O) blocked the entire high-frequency schema queue and starved unrelated
   suites past their 10s hookTimeout. `withTestInfraLifecycleLock` now takes
   `lockClass: "schema" | "database"`: CREATE/DROP DATABASE callers MUST use
   the `database` key; schema/migration critical sections keep the original
   key. Cross-class engine contention (the Phase 6D concern) is carried by the
   participating lifecycle suites' deterministic-queue hang-protection
   budgets, not by one global key.
4. **Queue-participant hooks get the 30s budget explicitly.** Vitest's
   per-describe `{ timeout }` applies to test bodies only — hooks resolve
   their own timeout as `beforeAll(fn, timeout = getDefaultHookTimeout())`
   (verified in the vitest runner source), so a hook that acquires the
   lifecycle lock runs on the 10s global default unless the package config
   raises it. Worse, a timed-out hook is not cancelled: its orphaned promise
   keeps holding the advisory lock and cascades multi-second waits to every
   sibling (measured 23.8s single wait after one hook timeout).
   `packages/db/vitest.config.ts` therefore sets `hookTimeout: 30_000`,
   matching the 30s budgets the lifecycle describes already declare for their
   tests. Any future suite whose beforeAll/afterAll acquires the lifecycle
   lock relies on this package-level budget; do not lower it without
   re-justifying the queue envelope.

Regression tests assert these rules via
`getTestInfraLockAcquisitionCount()` and fail on the pre-fix implementation.
`TEST_INFRA_TRACE=1` emits per-acquisition wait/hold diagnostics to stderr for
future audits. Known remaining load (follow-up, not contract): every fresh
worker still pays one CREATE DATABASE + full migrate acquisition; template-DB
cloning or a slot-bounded worker DB pool would be the next structural
reduction.

## Relationship to existing flake records

This ADR is informed by, but does not modify, `docs/standards/test-flakes.md`:

- `BUG-FLAKE-001` (scanner 5s timeout under parallel + shared schema) is the
  historical motivation for serial execution and per-file schema isolation. It
  is cited here as **background only**. This ADR does not claim it is fixed,
  and removes none of its current mitigations.
- `BUG-FLAKE-002` (turbo cross-package shared DB), `BUG-FLAKE-003` (deadline
  scanner leaked rows), `BUG-FLAKE-004` (intra-suite cross-file state leak) are
  instances of the cross-scope shared-state class this ADR targets. The
  per-worker database + per-worker Redis/Queue prefix model is designed to make
  that class of failure structurally preventable when cleanup and lifecycle
  invariants are enforced, but the existing mitigations stay until each
  follow-up phase removes them with evidence.

## References

- `docs/standards/test-flakes.md` — flake registry, including `BUG-FLAKE-001`
  through `BUG-FLAKE-004` and the PR86 / PR87 / PR88 diagnostic matrices.
- `docs/archive/known-test-isolation-issues.md` — pre-existing isolation issues.
- `docs/adr/ADR-001-redis.md` — Redis adoption triggers (currently Deferred).
- `docs/adr/ADR-003-job-queue.md` — job queue adoption triggers (currently
  Deferred).
- `apps/api/vitest.config.ts` — current `fileParallelism: false` and the
  Vitest `resolveConfig` semantics that make it unbypassable.
- `packages/db/src/testIsolation.ts` — existing per-file / per-worker schema
  isolation helper, retained as the legacy fallback.
- `docs/archive/dev/test-ci-parallelism-plan.md` — phased implementation plan.
- `docs/archive/dev/test-suite-taxonomy.md` — full test taxonomy and tagging rules.
