# Testing & CI Contract

> **Authority**: This document is the single source of truth for test boundaries,
> environment variables, and CI lane contracts. Implementation may NOT deviate
> from these rules without updating this document first. If this document
> conflicts with code, this document wins until the code is updated.

## Table of Contents

1. [CI Lanes](#1-ci-lanes)
2. [Environment Variable Contract](#2-environment-variable-contract)
3. [Time / Async Testing Contract](#3-time--async-testing-contract)
4. [E2E Contract](#4-e2e-contract)
5. [Local WSL Test Matrix](#5-local-wsl-test-matrix)
6. [Docker E2E Test Matrix](#6-docker-e2e-test-matrix)
7. [CI E2E Test Matrix](#7-ci-e2e-test矩阵)
8. [Verification Checklist](#8-verification-checklist)

---

## 1. CI Lanes

The CI pipeline (`.github/workflows/ci.yml`) runs on every PR to `master`.
After `static` passes, `verify` and `e2e` run **in parallel**.

### 1.1 Static Checks

| Field | Value |
|-------|-------|
| **Job name** | `static` |
| **Command** | `pnpm verify:static` |
| **Services** | None |
| **Env vars** | None (inherits runner defaults) |
| **Allowed resources** | CPU only (format, lint, typecheck) |
| **Forbidden** | Database access, network calls, file writes outside repo |
| **Timeout** | 10 minutes |
| **Failure attribution** | `format:check` → Prettier issue; `lint` → ESLint issue; `lint:copy` → hardcoded business copy; `lint:arch` → dependency boundary violation; `typecheck` → TypeScript error |

### 1.2 Package Build (workspace packages)

| Field | Value |
|-------|-------|
| **Job** | `verify` (step 0) |
| **Command** | `pnpm --filter "./packages/*" build` |
| **Why needed** | `@exam/web coverage` runs vitest directly (bypassing Turbo's task graph), so the `^build` dependency in `turbo.json` does NOT apply. Without this step, `@exam/domain/dist` and `@exam/contracts/dist` don't exist, causing Vite import-analysis failures. |
| **Scope** | All packages in `packages/` (domain, contracts, auth, db, authz, exam-engine, import-export). NOT apps/ (web, api). |
| **Cache** | Turbo caches each package's `dist/**` |

### 1.3 Web Coverage

| Field | Value |
|-------|-------|
| **Job** | `verify` (step 1) |
| **Command** | `pnpm --filter @exam/web coverage` |
| **Services** | None (pure jsdom) |
| **Env vars** | `APP_MODE=test`, `NODE_ENV=test` (from vitest config) |
| **Allowed resources** | CPU (jsdom + V8 coverage instrumentation) |
| **Forbidden** | Database access, Redis, network calls |
| **Timeout** | 10s per test (CI guardrail in `vitest.config.ts`) |
| **Failure attribution** | Test failure → check `apps/web/src/**/*.test.tsx`; coverage threshold → check `vitest.config.ts` thresholds |

### 1.4 API Coverage

| Field | Value |
|-------|-------|
| **Job** | `verify` (step 2) |
| **Command** | `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api coverage` |
| **Services** | PostgreSQL (via CI service container on `localhost:5432`) |
| **Env vars** | `DATABASE_URL=postgresql://exam:exam@localhost:5432/exam_test`, `TEST_DATABASE_URL=postgresql://exam:exam@localhost:5432/exam_test`, `JWT_SECRET=ci-test-secret`, `APP_MODE=ci`, `NODE_ENV=test`, `DEPLOYMENT_MODE=singleTenant`, `REDIS_URL=redis://localhost:6379`, `TEST_DB_ISOLATION=worker-database`, `API_TEST_MAX_WORKERS=4` |
| **Allowed resources** | PostgreSQL (`exam_test`), Redis, CPU |
| **Forbidden** | `exam` or `exam_e2e` databases, filesystem writes outside repo |
| **Failure attribution** | DB errors → check Postgres service; timeout → check `API_TEST_MAX_WORKERS`; auth → check `JWT_SECRET` |

### 1.5 Package Coverage

| Field | Value |
|-------|-------|
| **Job** | `verify` (step 3) |
| **Command** | `pnpm --filter "./packages/*" coverage` |
| **Services** | PostgreSQL (for `@exam/db` tests only) |
| **Env vars** | Same as API coverage (inherited from job-level `env:`) |
| **Allowed resources** | PostgreSQL (`exam_test`), CPU |
| **Forbidden** | `exam` or `exam_e2e` databases |
| **Note** | Each package's coverage is independent. `@exam/auth` tests are pure unit tests (no DB). `@exam/db` tests require PostgreSQL. Other packages (domain, contracts, authz, exam-engine, import-export) are pure unit tests. |
| **Failure attribution** | Check which package failed in the step output |

### 1.6 Full Build

| Field | Value |
|-------|-------|
| **Job** | `verify` (step 4) |
| **Command** | `pnpm build` |
| **Services** | None |
| **Allowed resources** | CPU, filesystem |
| **Forbidden** | Network calls (unless package build requires it) |

### 1.7 E2E (Playwright)

| Field | Value |
|-------|-------|
| **Job** | `e2e` (matrix: `shardIndex: [1, 2]`, `shardTotal: [2]`) |
| **Command** | `pnpm --filter @exam/e2e test:e2e -- --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}` |
| **Services** | PostgreSQL (`exam_e2e` on `localhost:5432`) |
| **Env vars** | `DATABASE_URL=postgresql://exam:exam@localhost:5432/exam_e2e`, `TEST_DATABASE_URL=postgresql://exam:exam@localhost:5432/exam_e2e`, `JWT_SECRET=e2e-test-secret`, `APP_MODE=e2e`, `NODE_ENV=test`, `DEPLOYMENT_MODE=singleTenant`, `E2E_BASE_URL=http://localhost:3000`, `E2E_SHARD_TOTAL=2`, fast scanner intervals (`HEARTBEAT_TIMEOUT_MS=15000`, etc.), `RATE_LIMIT_MAX=1000`, `RATE_LIMIT_WINDOW_MS=60000` |
| **Allowed resources** | PostgreSQL (`exam_e2e`), CPU, Chromium |
| **Forbidden** | `exam` or `exam_test` databases, a host port that contradicts `DB_HOST_PORT` (default 5432) |
| **Failure attribution** | Server startup → check `server.log`; test failure → check `test-results/`; shard-specific → check shard index |

### 1.8 E2E Merge

| Field | Value |
|-------|-------|
| **Job** | `e2e-merge` |
| **Command** | `npx playwright merge-reports --reporter html ./all-blob-reports` |
| **Services** | None |
| **Env vars** | None |
| **Input** | Downloaded blob reports from all E2E shards |
| **Failure attribution** | Invalid zip → corrupt artifact; empty merge → all shards skipped/cancelled |

---

## 2. Environment Variable Contract

### 2.1 `DATABASE_URL`

| Context | Value | Purpose |
|---------|-------|---------|
| Local dev (constructed) | `postgresql://exam:exam@localhost:<DB_HOST_PORT>/exam` (default 5432) | Runtime/dev |
| CI verify | `postgresql://exam:exam@localhost:5432/exam_test` | Both DATABASE_URL and TEST_DATABASE_URL point to same test DB |
| CI E2E | `postgresql://exam:exam@localhost:5432/exam_e2e` | E2E seed + runtime |
| Docker test | `postgresql://db:5432/exam_test` | Container internal |
| WSL E2E | `postgresql://exam:exam@localhost:<DB_HOST_PORT>/exam_e2e` (default 5432) | E2E seed + runtime |

**Rules:**
- `DATABASE_URL` is for **runtime/dev** use only.
- Unit/integration tests MUST NOT silently fall back to `DATABASE_URL`.
- The DB resolver (`resolveDatabaseUrl`) enforces this: test/ci/e2e modes use `TEST_DATABASE_URL` when set, otherwise a LOCAL test URL constructed from `DB_HOST_PORT` (single source — changing `DB_HOST_PORT` once makes local `pnpm test` follow automatically), and never fall back to `DATABASE_URL`.

### 2.2 `TEST_DATABASE_URL`

| Context | Value | Purpose |
|---------|-------|---------|
| Local dev (`.env.test.local`) | optional — when unset resolves to `postgresql://exam:exam@localhost:<DB_HOST_PORT>/exam_test` (default 5432) | vitest runtime |
| CI verify | `postgresql://exam:exam@localhost:5432/exam_test` | vitest runtime |
| CI E2E | `postgresql://exam:exam@localhost:5432/exam_e2e` | E2E seed + runtime |

**Rules:**
- An explicit `TEST_DATABASE_URL` always wins (CI / remote DB / special case) and is **operator-owned**: the harness verifies it exists and fails fast if missing — it never creates, migrates, or falls back for an explicit URL (see §2.8).
- Set-but-empty (`TEST_DATABASE_URL=`) counts as unset.
- When unset, the resolver constructs a LOCAL test URL from the single-source `DB_HOST_PORT` (the same variable `docker-compose.dev.yml` publishes and dev `DATABASE_URL` construction uses) and targets `exam_test`, which the harness self-provisions when missing (see §2.8). There is nothing to keep in sync.
- Must point to a database whose name contains `test`, `e2e`, or `ci`.
- The name-safety guard in `resolveTestBranchUrl()` enforces this unless `ALLOW_UNSAFE_TEST_DATABASE_URL=1`.
- In CI, `DATABASE_URL` and `TEST_DATABASE_URL` often point to the same test database. This is allowed because both are test databases.
- WSL E2E deliberately unsets `TEST_DATABASE_URL` and uses `DATABASE_URL` with `APP_MODE=development` to avoid the name-safety guard.

### 2.3 `JWT_SECRET`

| Context | Value | Purpose |
|---------|-------|---------|
| CI verify | `ci-test-secret` | API + package tests |
| CI E2E | `e2e-test-secret` | E2E runtime |
| Local dev | from `.env` or `"development-only-change-me"` fallback | Dev runtime |

**Rules:**
- CI may set `JWT_SECRET` globally for all test jobs.
- **Production guard tests** (e.g., `packages/auth/src/session.test.ts`) MUST use `vi.stubEnv` to override `JWT_SECRET` to `""` and `APP_MODE` to `"production"`. They MUST NOT modify the CI global `JWT_SECRET`.
- `vi.unstubAllEnvs()` MUST be called in `afterEach` to restore the original env.

### 2.4 `NODE_ENV`

| Context | Value |
|---------|-------|
| CI (all jobs) | `test` |
| Local dev | `development` |
| Production | `production` |

**Rules:**
- Vitest configs force `NODE_ENV=test` via `TEST_RUNTIME_ENV` from `vitest.shared.ts`.
- Production behavior tests MUST use `vi.stubEnv("NODE_ENV", "production")`.

### 2.5 `APP_MODE`

| Context | Value | Effect |
|---------|-------|--------|
| CI verify | `ci` | Routes to `TEST_DATABASE_URL`; non-production mode |
| CI E2E | `e2e` | Routes to `TEST_DATABASE_URL`; E2E mode |
| Local dev | `development` | Routes to `DATABASE_URL` |
| Production | `production` | Routes to `DATABASE_URL`; production guards active |
| Vitest (all) | `test` (forced by `TEST_RUNTIME_ENV`) | Routes to `TEST_DATABASE_URL` when set, else a LOCAL URL constructed from `DB_HOST_PORT` |

**Rules:**
- `APP_MODE` is the authoritative runtime mode selector.
- `NODE_ENV` is a fallback when `APP_MODE` is unset.
- Valid values: `development`, `test`, `e2e`, `ci`, `production`.
- `APP_MODE=multiTenant` must fail fast at startup (Phase 4 only).

### 2.6 `REDIS_URL`

| Context | Value | Purpose |
|---------|-------|---------|
| CI verify | `redis://localhost:6379` | API tests that use Redis |
| CI E2E | Not set | E2E doesn't need Redis |
| Docker | `redis://redis:6379` | Container internal |
| Local dev | `redis://localhost:6379` | Dev runtime |

**Rules:**
- Redis is required for API tests that exercise rate limiting, session storage, or pub/sub.
- If Redis is unreachable, API tests that depend on it will fail. Tests that don't use Redis (pure unit tests) are unaffected.
- `@exam/db` tests do NOT require Redis.
- `@exam/auth` tests do NOT require Redis.

### 2.7 `DEPLOYMENT_MODE`

| Context | Value |
|---------|-------|
| CI (all) | `singleTenant` |
| Production | `singleTenant` |
| Phase 4 | `multiTenant` (not yet allowed) |

**Rules:**
- Phase 1.x is single-tenant only.
- `DEPLOYMENT_MODE=multiTenant` must fail fast at startup.

### 2.8 Test Database Lifecycle Ownership

The single authority for "who creates / verifies / drops which test database".
The runtime seam is `packages/db/src/testDbBootstrap.ts` (`prepareTestDatabase`),
wired into both vitest globalSetups (`apps/api/vitest.globalSetup.ts`,
`packages/db/vitest.globalSetup.ts`).

```
                    PostgreSQL server
                           |
             +-------------+-------------+
             |                           |
     explicit test URL            implicit local URL
  (TEST_DATABASE_URL/TEST_DB_URL)  (constructed from DB_HOST_PORT,
             |                      always exam_test)
     operator-owned DB              Exam-owned convenience DB
             |                           |
   MUST already exist             MAY self-provision if missing
             |                           |
  verify + FAIL FAST if absent    ensure -> migrate -> test
```

| Lifecycle | Owner | Notes |
|-----------|-------|-------|
| PostgreSQL server (local) | developer (`pnpm db:up`) | `docker-compose.dev.yml`; no initdb SQL — `POSTGRES_DB` creates only `exam` |
| Implicit local `exam_test` | Exam test harness | Self-provisioned by `prepareTestDatabase` whenever missing; survives `DROP DATABASE` without container reset |
| Explicit `TEST_DATABASE_URL` target | environment / operator (CI service, remote DB) | Verified connectable; NEVER created/migrated/dropped by the harness — restricted no-CREATEDB roles are supported |
| Worker DBs `exam_test_w<N>` | Exam test harness (implicit-local server only) | Created per vitest worker id by `setupWorkerTestDatabase`; idle leftovers swept at apps/api run start + teardown (`sweepIdleWorkerDatabases`, busy DBs skipped) |
| Schemas `test_*` | per-test-file isolation (`testIsolation.ts`) | Created + dropped per file |
| Schema content | production Drizzle migrations only | No test-only schema DDL anywhere |
| Seed data | test bodies (`seed()` after migration) | `pnpm db:seed:demo` seeds ONLY the dev `exam` DB |
| E2E DB `exam_e2e*` | E2E runners (`scripts/e2e/*`) | Own their full lifecycle; out of scope here |
| CI DB | CI service containers (`POSTGRES_DB=exam_test`) | Operator-owned; the harness never creates on it |

**Rules:**

- Set-but-empty `TEST_DATABASE_URL=` counts as UNSET (template artifact, not an
  operator decision).
- The name-safety guard (name contains `test`/`e2e`/`ci`) applies on both
  branches.
- `prepareTestDatabase` refuses to run in production mode.
- Turbo cache identity: every DB-routing / topology variable
  (`TEST_DATABASE_URL`, `TEST_DB_URL`, `DB_HOST_PORT`, `TEST_DB_ISOLATION`,
  `API_TEST_MAX_WORKERS`, `TEST_INFRA_SCOPE`, `TEST_SHARD_INDEX`,
  `TEST_WORKER_ID`, `TEST_ADMIN_DATABASE`, `ALLOW_UNSAFE_TEST_DATABASE_URL`)
  is declared in the `env` key of the DB-backed test tasks in `turbo.json` —
  passed through AND hashed into the task cache key, so a routing change can
  never replay a green result recorded against a different database. The
  `passThroughEnv`-only shape is forbidden for these tasks (enforced by
  `scripts/repository-contract/turbo-config-contract.mjs`).

**Worker-DB physical lifecycle** (`TEST_DB_ISOLATION=worker-database`):

| Event | Create? | Reuse? | Reset? | Drop? |
|-------|---------|--------|--------|-------|
| worker start | ensure DB if missing (`exam_test_w<VITEST_WORKER_ID>`) | same id → yes | — | — |
| test file start | (worker id may increment → new DB) | same id → yes | `resetPostgres()` TRUNCATE | — |
| worker recycle | new id → new DB | old DB NOT reused | — | — |
| successful run end | — | — | — | teardown sweep (idle only) |
| failed run end | — | — | — | teardown sweep (idle only) |
| process crash | — | — | — | nothing (leftover) |
| next run | — | — | — | startup sweep reclaims crash leftovers |

Worker ids are assigned per fork execution and are not reused across files, so
without the sweep one full API run leaves ~90 physical databases (observed:
90 on a long-lived dev server). The sweep only ever runs against the
implicit-local server; an operator-supplied server owns its own lifecycle.

---

## 3. Time / Async Testing Contract

### 3.1 Prohibited Patterns

The following patterns are **forbidden** in all tests (unit, integration, E2E):

| Pattern | Why forbidden |
|---------|---------------|
| `await new Promise(r => setTimeout(r, 10000))` | Real sleep wastes CI time and causes flakes |
| `await new Promise(r => setTimeout(r, 15000))` | Same |
| `await new Promise(r => setTimeout(r, 30000))` | Same |
| Real polling interval wait (e.g., `await delay(15000)`) | Polling is a runtime concern, not a test concern |
| `Date.now()` elapsed assertion with ms tolerance | Clock drift causes flakes across CI runners |
| Test-level `timeout: 30000` to mask hangs | Hangs should be fixed, not absorbed |
| Timer advancement without `act()` wrapper | React state updates outside `act()` cause warnings |
| `userEvent` calls without `await` | Fire-and-forget user events miss async state updates |

### 3.2 Required Patterns

The following patterns are **mandatory** when testing time-dependent behavior:

| Pattern | When to use |
|---------|-------------|
| `vi.useFakeTimers()` / `vi.useRealTimers()` | Any test involving timers, intervals, or `setTimeout` |
| `vi.setSystemTime(date)` | Tests that depend on specific dates |
| `vi.advanceTimersByTimeAsync(ms)` | Advancing fake timers in async code |
| `vi.advanceTimersToNextTimerAsync()` | Advancing to the next scheduled timer |
| `await act(async () => { ... })` | Wrapping React state updates from timer advancement |
| `vi.stubEnv(key, value)` | Isolating environment variables for production-guard tests |
| `vi.unstubAllEnvs()` in `afterEach` | Restoring env after stubbing |
| `vi.resetModules()` + dynamic import | Testing import-time env reads (when function reads env at module load) |

### 3.3 Acceptable Patterns

These are allowed with caution:

| Pattern | When acceptable |
|---------|-----------------|
| `waitFor(() => expect(el).toBeInTheDocument())` | Waiting for DOM to appear (small timeout, e.g., 1000ms) |
| `fireEvent.change(el, { target: { value } })` | Non-critical fields in slow tests where `userEvent.type` would exceed timeout |
| Backoff/retry pure function tests | Testing algorithmic logic without real time |
| `Date.now()` for seeding unique data | NOT for elapsed assertions |

### 3.4 Audit completion and background-work lifecycle contract

Audit tests must first select the production durability and lifecycle contract;
a drain is not a substitute for a transaction or a durable response boundary.

| Durability | Completion boundary | Test assertion |
| --- | --- | --- |
| `atomic` | Security-sensitive business mutation and audit insert use the same branded PostgreSQL transaction. | Assert both after success; inject audit failure and assert both absent; inject business failure/no-op and assert no false audit. Do not poll or drain. |
| `synchronous_sensitive_read` | Final audit insert settles before sensitive response data is returned. | Inject audit failure and assert a failed response contains no protected data; immediately query successful evidence. Do not poll or drain. |
| `best_effort` | Response may precede persistence; accepted work belongs to the Fastify audit lifecycle. | Prove audit failure does not change the business HTTP result. Use a controlled deferred promise and explicit drain/close boundary. SIGKILL loss is accepted. |
| `domain_history` | Canonical domain rows own the state; compliance audit is excluded. | Assert the domain transition/save succeeds independently and no excluded audit action is emitted, including idempotent replay. |

`apps/api/src/routes/auditAtomicity.test.ts` uses a transaction-local
PostgreSQL trigger to fail audit insertion for a selected action. This is the
standard deterministic failure injection: it exercises the real repository
and transaction rather than replacing the audit writer with a mock. Each
mutation case must record the HTTP/script result, business state, audit state,
and rollback expectation. The retained families include route-owned,
admin-invariant/role assignment, submit/grading service, exam transition
executor, CLI/bootstrap, and bulk import boundaries.

`apps/api/src/audit/auditArchitecture.test.ts` keeps the five-dimensional
action definition exhaustive, recursively inventories production emitters,
separates ACTIVE from RESERVED/DEPRECATED vocabulary, forbids direct writer
bypasses, and proves that a root `Database` cannot satisfy the branded
`TransactionDatabase` contract. Required inventory invariants are:

```text
ACTIVE_WITH_ZERO_CALLSITES = 0
RESERVED_WITH_ACTIVE_CALLSITE = 0
UNOWNED_DIRECT_WRITER = 0
```

Best-effort background work started by a request, hook, or helper must have an
explicit lifecycle owner. The owner registers the work before control is
released, observes every rejection, removes settled work from its registry,
and provides an awaitable quiescence or drain barrier.

The following rules are mandatory:

- No destructive fixture cleanup may begin while a side effect associated
  with the preceding test is pending.
- A real sleep, retry loop, or cleanup helper is not a synchronization
  barrier. Tests must use the owning component's explicit drain or a
  deterministic deferred-Promise barrier.
- `afterAll` means test callbacks have returned; it does not prove that
  unawaited work created by those callbacks has settled.
- `cleanupBusinessData` deletes business rows while retaining an organization;
  callers must quiesce producers and drain their work first.
- `cleanupOrganizationTestData` destructively removes an organization and its
  dependent rows; callers must quiesce producers and drain their work first.
  Neither helper discovers or waits for application-owned work.
- Applications built with `buildTestApp` expose `drainAuditWrites()` for
  best-effort tests. Call it before destructive cleanup whenever the test has
  scheduled best-effort work. `cleanup()` calls `app.close()`, whose audit
  close hook drains accepted work before the test DB connection is closed.
- A test-owned Fastify builder that exercises `recordBestEffortAudit` must also
  register the production audit lifecycle plugin. It must not substitute an
  immediately awaited test-only sink that hides production lifecycle races.

The ordinary test barrier includes writes scheduled while a drain is active
until the pending set becomes empty. Production close first stops accepting
new best-effort work, then drains for 10 seconds. Timeout tests use fake timers
and a controlled unresolved promise; they assert the returned timed-out result,
pending count, late-work rejection, no lifecycle-owned fatal/process mutation,
and bounded completion. The server may log a warning, but best-effort loss alone
must not set a nonzero exit code. Real sleeps and polling are forbidden here.

### 3.5 Attempt-suite fixture lifecycle

The seven attempt suites below use one organization per test.
Their business data has the same lifetime as that organization. Each
`beforeEach` drains accepted audit writes left by the preceding request before
deleting a stale prefixed organization; each nested `afterAll` drains before
final prefixed-organization deletion; and the outer `afterAll` calls
`ctx.cleanup()`, which closes the app, drains application-owned audit work, and
then closes the DB connection.

These retained drain calls are lifecycle hygiene for the shared application
builder; they are not the correctness boundary for atomic attempt audits, which
are awaited and transactional. Automatic submit/disruption and answer saves
are domain-history exclusions and therefore do not use this drain as a hidden
durability boundary.

| Suite | Before-test destructive cleanup | Final destructive cleanup |
|---|---|---|
| `admin-status.test.ts` | drain, then `cleanupOrganizationTestData` | nested `afterAll`: drain, then organization cleanup |
| `heartbeat.test.ts` | drain, then `cleanupOrganizationTestData` | nested `afterAll`: drain, then organization cleanup |
| `admin-force-submit.test.ts` | drain, then `cleanupOrganizationTestData` | nested `afterAll`: drain, then organization cleanup |
| `admin-misconduct.test.ts` | drain, then `cleanupOrganizationTestData` | nested `afterAll`: drain, then organization cleanup |
| `admin-extend-time.test.ts` | drain, then `cleanupOrganizationTestData` | nested `afterAll`: drain, then organization cleanup |
| `timeline.test.ts` | drain, then `cleanupOrganizationTestData` | nested `afterAll`: drain, then organization cleanup |
| `deadline-scanner.test.ts` | drain, then `cleanupOrganizationTestData` | nested `afterAll`: drain, then organization cleanup |

---

## 4. E2E Contract

### 4.1 WSL E2E vs Docker E2E

| Aspect | WSL E2E (`scripts/e2e/run-wsl.sh`) | Docker E2E (`scripts/e2e/run.sh`) |
|--------|--------------------------------------|-----------------------------------|
| **Execution** | Native on host (no app container) | Full Docker Compose (app + db + e2e containers) |
| **Database** | `exam_e2e` (or per-shard `exam_e2e_w{N}`) | `exam_test` (inside container) |
| **APP_MODE** | `development` (deliberately, to avoid name-safety guard) | `e2e` |
| **TEST_DATABASE_URL** | Explicitly unset | `db:5432/exam_test` |
| **Sharding** | Supported (`E2E_WORKERS`, default 2) | Not supported (single process) |
| **Blob reports** | Merged locally after run | Not used (list reporter only) |
| **Cleanup** | Stops shard servers → bounded wait → drops worker DBs → temp logs | `docker compose down -v` |
| **Cleanup ordering** | Strict: stop servers BEFORE `DROP DATABASE` (issue #256-A). DROP is loud (no `\|\| true`); failure surfaces DB name + PG error and escalates exit to sentinel 70 if tests passed | N/A (single compose down) |
| **DB retention** | `E2E_KEEP_WORKER_DB_ON_FAILURE=1` retains `exam_e2e_w*` only on Playwright failure (success always cleans) | N/A |
| **Use case** | Fast local iteration | CI-like parity, reproducible builds |

### 4.2 CI E2E Shard Rules

| Aspect | Rule |
|--------|------|
| **Shard count** | 2 (defined in `matrix.shardTotal: [2]`) |
| **Shard index** | `${{ matrix.shardIndex }}` (1-based) |
| **Database per shard** | Single shared `exam_e2e` (CI doesn't create per-shard DBs) |
| **Playwright workers** | `E2E_WORKERS_PER_SHARD` (default 1) |
| **fail-fast** | `false` (all shards run even if one fails) |
| **Blob zip naming** | `report-${{ matrix.shardIndex }}.zip` |
| **Artifact naming** | `e2e-blob-shard-${{ matrix.shardIndex }}` |
| **Upload retention** | 1 day |

### 4.3 Playwright Report Merge Contract

**Preconditions:**
1. Each shard uploads a blob zip with a unique name: `report-{N}.zip`.
2. Artifact names are unique per shard: `e2e-blob-shard-{N}`.
3. `download-artifact` with `merge-multiple: true` flattens all zips into `all-blob-reports/`.

**Validation steps (before merge):**
1. `find all-blob-reports -maxdepth 2 -type f` — list all files.
2. Reject non-`.zip` files (no `.gitkeep`, no HTML report zips, no stray files).
3. For each `.zip`: `unzip -t "$z"` — verify zip integrity.
4. Count blob zips; warn if zero (all shards skipped/cancelled).

**Merge command:**
```bash
npx playwright merge-reports --reporter html ./all-blob-reports
```

**Post-merge:**
- Merged HTML report uploaded as `playwright-html-report` artifact (14-day retention).

**Forbidden:**
- Feeding HTML report zips to `merge-reports` (only blob zips are valid input).
- Artifact name collisions (two shards with the same artifact name → second overwrites first).
- Sharing data state between shards (each shard must be self-contained).

### 4.4 run-wsl.sh Cleanup Contract (issue #256-A)

The WSL runner owns a strict teardown lifecycle. All cleanup logic lives in
`scripts/e2e/run-wsl-lib.sh` (sourced by `run-wsl.sh`) and is unit-tested by
`scripts/e2e/run-wsl-lib.test.mjs` (run via `pnpm test:e2e-runner`, also part of
`verify:static`).

**Lifecycle (after Playwright shards finish):**

```
freeze worst Playwright exit code → FROZEN_EXIT
→ run_cleanup (EXIT/INT/TERM trap, idempotent):
    1. stop shard API process groups (TERM → bounded wait → KILL)
    2. drop worker DBs (loud, after servers released connections)
    3. diagnostics on failure (shard port/db/log)
    4. temp-log cleanup (success path only)
    5. dev compose down (only if this script started it)
→ compute_final_exit picks the priority-matrix exit code
```

**Why this order:** PostgreSQL refuses `DROP DATABASE` while connections are
open. The historical script dropped before stopping servers and swallowed the
error with `>/dev/null 2>&1 || true`, so `exam_e2e_w*` leaked permanently
(issue #256). Stopping servers first + `DROP DATABASE ... WITH (FORCE)`
(PG 13+; this repo runs 18.4) makes the drop reliable; a loud, unswallowed
failure surfaces it instead of hiding it.

**Exit-code priority matrix:**

| Playwright | Cleanup | Final exit |
|------------|---------|---------------------|
| PASS (0)   | PASS    | 0 |
| FAIL (!=0) | PASS    | Playwright code |
| PASS (0)   | FAIL    | 70 (cleanup sentinel) |
| FAIL (!=0) | FAIL    | Playwright code (cleanup error printed) |

Cleanup never masks a test failure and never turns a failing cleanup into 0.

**DB-name prefix guard:** only `exam_e2e` and `exam_e2e_w<N>` are dropped.
`exam`, `postgres`, `exam_test`, production names, and injection attempts are
rejected by `is_safe_worker_db_name`.

---

## 5. Local WSL Test Matrix

### 5.1 Unit Tests

```bash
# All packages
pnpm test

# Single package
pnpm --filter @exam/auth test
pnpm --filter @exam/domain test
```

- **DB required**: No (except `@exam/db`).
- **Env**: `APP_MODE=test`, `NODE_ENV=test` (forced by vitest config).

### 5.2 API Integration Tests

```bash
# Serial (default)
pnpm --filter @exam/api test

# Parallel (requires worker-database isolation)
TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api test
```

- **DB required**: Yes (`exam_test` on `DB_HOST_PORT`, default 5432).
- **Env**: `TEST_DATABASE_URL` must point to `exam_test`.

### 5.3 Web Tests

```bash
pnpm --filter @exam/web test
```

- **DB required**: No (pure jsdom).
- **Env**: `APP_MODE=test`, `NODE_ENV=test` (forced by vitest config).

### 5.4 E2E Tests

```bash
# Default (2 shards, parallel)
bash scripts/e2e/run-wsl.sh

# Single shard
E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh

# Custom shard count
E2E_WORKERS=4 bash scripts/e2e/run-wsl.sh
```

- **DB required**: Yes (`exam_e2e` on `DB_HOST_PORT`, default 5432).
- **Env**: `APP_MODE=development`, `DATABASE_URL` pointing to `exam_e2e`, `TEST_DATABASE_URL` unset.

---

## 6. Docker E2E Test Matrix

```bash
# Standard run
bash scripts/e2e/run.sh

# With port remapping (if host ports are occupied)
COMPOSE_FILE=docker-compose.test.yml:docker-compose.test.override.yml bash scripts/e2e/run.sh
```

### Services

| Service | Image | Port | DB |
|---------|-------|------|----|
| `db` | `postgres:18.4-bookworm` | 5432 (or 5433 with override) | `exam_test` |
| `app` | Built from `Dockerfile` | 3000 (or 3300 with override) | N/A (connects to `db`) |
| `e2e` | `mcr.microsoft.com/playwright:v1.61.0-noble` | N/A | N/A (connects to `app`) |

### Seed Data

- `RUN_SEED=e2e` in app container → auto-runs `db:seed:e2e` on startup.
- Produces deterministic demo accounts: admin, candidate, candidate1-4.

### DB Lifecycle

- Created fresh by `docker compose up`.
- Destroyed by `docker compose down -v` on cleanup.
- No persistent volumes (data is ephemeral).

### Artifact Output

- Playwright list reporter (stdout).
- No blob reports, no merge.
- Screenshots on failure saved to `test-results/`.

---

## 7. CI E2E 测试矩阵

### Services

| Service | Image | Port | DB |
|---------|-------|------|----|
| `postgres` | `postgres:18.4-bookworm` | `5432:5432` | `exam_e2e` |

### Shard Configuration

| Parameter | Value |
|-----------|-------|
| `matrix.shardIndex` | `[1, 2]` |
| `matrix.shardTotal` | `[2]` |
| `fail-fast` | `false` |

### Blob Report Contract

| Step | Detail |
|------|--------|
| **Blob zip name** | `report-{shardIndex}.zip` |
| **Artifact name** | `e2e-blob-shard-{shardIndex}` |
| **Upload path** | `apps/e2e/blob-report/*.zip` |
| **Download path** | `apps/e2e/all-blob-reports/` |
| **Merge input validation** | Reject non-zip files, verify zip integrity |
| **Merge command** | `npx playwright merge-reports --reporter html ./all-blob-reports` |
| **Output artifact** | `playwright-html-report` (14-day retention) |

---

## 8. Verification Checklist

After any change to test configuration, CI workflow, or vitest config, verify:

- [ ] `pnpm verify:static` passes (format, lint, typecheck)
- [ ] `pnpm --filter @exam/auth coverage` passes
- [ ] `pnpm --filter "./packages/*" coverage` passes
- [ ] `pnpm --filter @exam/web coverage` passes
- [ ] `pnpm --filter "@exam/api" coverage` passes (with `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4`)
- [ ] `pnpm verify` passes (full pipeline)
- [ ] E2E blob report merge produces valid HTML report
- [ ] No `as any` casts in test files
- [ ] All time-dependent tests use fake timers
- [ ] No `TEST_DATABASE_URL` fallback to `DATABASE_URL` in test configs
