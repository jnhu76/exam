# Phase 2 Baseline

> Phase A of Phase 2 收口. Establish the verification baseline, command
> inventory, and measured timings **before** changing anything. All numbers in
> this file were measured on this machine during 收口 on 2026-06-24 and are
> reproducible from the commands in the table.

## Repository overview

Monorepo (`pnpm` workspace, `turbo` orchestrator):

```
apps/
  api/    Fastify API (TypeScript, vitest)
  web/    React 19 + Vite + shadcn/ui
  e2e/    Playwright
packages/
  domain/         leaf — no internal deps
  contracts/      Zod DTOs (no fastify)
  db/             Drizzle ORM + repository + test isolation infra
  auth/           session / rbac / tenant guard
  exam-engine/    timer / answer protocol / grading (no fastify)
  import-export/  CSV / Excel / PDF
```

Stateful test infra (this machine, measured baseline):

- PostgreSQL 18.4 (`docker-compose.dev.yml`, db service, host port 5432).
- Redis 7-alpine (`docker-compose.dev.yml`, redis service — see "Do not change
  yet" note on host port below).

## Verification commands discovered

From root `package.json`:

| Command | What it runs |
|---|---|
| `pnpm format:check` | `prettier --check .` |
| `pnpm lint` | `scripts/check-code-quality.mjs` (no-`any`, console, etc.) |
| `pnpm lint:copy` | hardcoded business-copy guard |
| `pnpm lint:arch` | dependency-boundary + no-bare-`db.select` in routes |
| `pnpm typecheck` | `turbo typecheck` (tsc --noEmit per package) |
| `pnpm test` | `turbo test` (all packages) |
| `pnpm test:nodb` | turbo test excluding `@exam/db` and `@exam/api` |
| `pnpm test:db` | `@exam/db` tests only |
| `pnpm test:api` | `@exam/api` tests only |
| `pnpm test:api:fast` | api tests, opt-in worker-database parallelism |
| `pnpm coverage:nodb` | coverage for non-db/api packages |
| `pnpm coverage:db` | `@exam/db` coverage |
| `pnpm coverage:api` | `@exam/api` coverage |
| `pnpm verify:nodb-tests` | `test:nodb` + `coverage:nodb` |
| `pnpm verify:db-tests` | `test:db` + `test:api` + `coverage:db` + `coverage:api` |
| `pnpm build` | `turbo build` |
| `pnpm verify` | format + lint + copy + arch + typecheck + nodb-tests + db-tests + build |
| `pnpm verify:fast` | static + nodb-tests + `test:db:unit` + `test:api:fast` + build |
| `pnpm verify:ci` | static + nodb-tests + coverage:db + coverage:api + test:integration + build |

Test parallelism controls (root + `apps/api/vitest.config.ts`):

- `apps/api` default: `fileParallelism: false` (serial). Mitigates
  BUG-FLAKE-001 (cross-file PG schema contention under coverage).
- Opt-in parallel: `TEST_DB_ISOLATION=worker-database` **and**
  `API_TEST_MAX_WORKERS=<N>` (positive int). Either missing → stays serial.
- `packages/db` runs parallel (`vitest.config.ts`, restored).
- turbo serializes api tests after db tests
  (`@exam/api#test` dependsOn `@exam/db#test`).

## Commands run

Environment: `APP_MODE=test`,
`TEST_DATABASE_URL=postgresql://exam:exam@localhost:5432/exam_test`,
`DATABASE_URL=<same>`, `REDIS_URL=""` (unset). Measured wall-clock unless noted.

| Command | Result | Duration | Notes |
|---|---|---:|---|
| `pnpm format:check` | PASS | <1s | all files prettier-clean |
| `pnpm lint` | PASS | <1s | code-quality OK |
| `pnpm lint:copy` | PASS | <1s | no hardcoded copy |
| `pnpm lint:arch` | PASS | <1s | dependency boundaries OK |
| `pnpm typecheck` | PASS (cache hit) | 5.7s wall (FULL TURBO) | cached; cold build would be longer |
| `pnpm test:nodb` | PASS | **1m45s (105s)** | 5/8 turbo-cached |
| `pnpm test:db` | PASS | **7.0s** | 163 tests, parallel |
| `pnpm test:api` | **FAIL** | **2m13s (133s)** | 4 fail / 645 pass / 2 skip — see below |
| `pnpm --filter @exam/api exec vitest run src/routes/redis.test.ts` (REDIS_URL set) | PASS | 0.6s | 7/7 (requires host Redis) |
| `pnpm --filter @exam/api exec vitest run src/routes/redis.test.ts` (REDIS_URL unset) | **FAIL** | 10.4s | 3 fail / 2 pass / 2 skip — 10s spent on connection retries |

### `test:api` failures observed at baseline (4 tests, 2 files)

These failures are present **right now**, against the in-progress Redis
baseline work tree (uncommitted `apps/api/src/plugins/redis.ts`,
`routes/testRedis.ts`, `routes/redis.test.ts`, modified `routes/system.ts`).
Both are **caused by the Redis baseline change** and are classified as
MUST FIX for Phase C (minimal fix only):

1. `src/runtime/time-authority.structural.test.ts` — ADR-006 guardrail now
   fires on `apps/api/src/routes/system.ts:201` and `:203`:
   `Date.now()` used for Redis latency (`const start = Date.now()` …
   `latencyMs: Date.now() - start`). This is a non-business-time diagnostics
   measurement, but the file is not on the guardrail allowlist, so the
   structural test breaks the build. **Introduced by this change.**

2. `src/routes/redis.test.ts` — 3 tests fail whenever Redis is not reachable
   from the host (`connects and decorates fastify.redis`,
   `closes connection gracefully`, `prefix-scoped delete only removes scoped
   keys`). Root cause: the suite hardcodes
   `process.env.REDIS_URL ?? "redis://localhost:6379"` and always attempts a
   real connection. When Redis is unreachable it retries for ~10s then fails.
   A baseline test that documents an **optional** Redis must `describe.skip`
   (not fail) when Redis is absent. **Introduced by this change.**

Neither failure is a pre-existing flake: both were introduced by the Redis
baseline work and disappear once the Phase C minimal fixes are applied.

## Current known cost

- **`pnpm test:api` (serial, default): ~133s**, of which ~88s is actual test
  time and the rest is import/startup. This is the dominant cost in
  `verify:db-tests` (api test + api coverage run the suite twice → ~4–5 min
  just for the api layer under coverage).
- **`pnpm verify` (full): not measured end-to-end this run**, but composed of
  static (<10s) + nodb (~105s, partly cached) + db-tests (db ~7s + api ~133s +
  coverage:db + coverage:api ≈ another api-sized run) + build. The "≈330s"
  figure cited for this repo is consistent with `verify:db-tests` running the
  api suite twice (test + coverage) plus build.
- **Slowest area: `@exam/api` coverage** (re-runs the whole serial api suite
  under instrumentation). The serial `fileParallelism: false` default roughly
  doubles api wall time.
- Current parallelism:
  - `apps/api`: serial by default; opt-in parallel via
    `TEST_DB_ISOLATION=worker-database` + `API_TEST_MAX_WORKERS=N`.
  - `packages/db`: parallel.
  - turbo: `@exam/api#test` dependsOn `@exam/db#test` (api waits for db).

## Do not change yet

- **`fileParallelism`** in `apps/api/vitest.config.ts` — stays `false` (serial)
  by default. Restoring parallelism is gated on the ADR isolation audit
  (Phase D), not done opportunistically.
- **turbo task dependencies** (`@exam/api#test` → `@exam/db#test`) — unchanged.
- **Background worker / scanner lifecycle** (heartbeat, deadline scanner) —
  unchanged; Redis baseline must not move scanner ownership to Redis.
- **DB isolation strategy** — `worker-database` opt-in stays opt-in; default
  path unchanged. Redis prefix isolation is additive only.
- **PostgreSQL as canonical state source** — Redis baseline adds coordination
  infra only; exam/attempt/enrollment state stays in PostgreSQL.
