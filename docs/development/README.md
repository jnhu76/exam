# Development Guide

**English** · [简体中文](README.zh-CN.md)

> Local development setup, testing, code quality, and architecture
> references for Exam contributors.
>
> This guide is a human-friendly projection. Exact command wiring is owned by
> `package.json` scripts, testing lifecycle semantics by
> [`docs/standards/testing.md`](../standards/testing.md), and agent behavior
> by [`AGENTS.md`](../../AGENTS.md). Where a semantic `pnpm` command exists,
> prefer it over the underlying low-level invocation.

## Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | 24.15.x | `nvm use 24.15` or equivalent |
| pnpm | 11.x | `corepack enable && corepack prepare pnpm@11.1.2 --activate` |
| Docker | ≥ 25.x | For PostgreSQL via `pnpm db:up` |
| Docker Compose | v2 | Included with Docker Desktop |

## Repository Layout

```text
apps/
  web/            React 19 + Vite + TypeScript frontend
  api/            Fastify + TypeScript backend
  e2e/            Playwright E2E browser tests

packages/
  domain/         Domain types, enums, errors (no framework deps)
  contracts/      Zod schemas, API contracts
  db/             Drizzle ORM, migrations, repositories
  auth/           Session, RBAC, argon2 password hashing
  authz/          Capability-based authorization, scope resolvers
  exam-engine/    Timer, answer protocol, grading engine
  import-export/  CSV/Excel import and export
```

## Local Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL + Redis (loopback-only host ports; the Redis
#    container is a zero-config convenience for opt-in consumers — the
#    application's Redis mode stays off unless REDIS_URL is configured)
pnpm db:up

# 3. Run migrations
pnpm db:migrate

# 4. Seed test users (admin / candidate / candidate2)
pnpm db:seed

# 5. Start dev servers
pnpm dev
```

This starts:

- **Web** (Vite): `http://localhost:5173`
- **API** (Fastify): `http://localhost:3000`

The Vite dev server proxies `/api/*` requests to the API automatically.

## Database

| Command | Purpose |
| --- | --- |
| `pnpm db:up` | Start/reuse the dev containers: PostgreSQL + Redis, loopback-only host ports (`DB_HOST_PORT` / `REDIS_HOST_PORT`, defaults 5432 / 6379) |
| `pnpm db:down` | Tear down the dev Compose stack (`docker compose down`) — dev database state is disposable and NOT reachable afterwards |
| `pnpm db:reset` | Tear down and immediately start a fresh stack; reconstruct data with `pnpm db:migrate` + `pnpm db:seed` |
| `pnpm db:migrate` | Run migrations |
| `pnpm db:push` | Push schema changes directly |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm db:generate` | Generate migration files |

The dev stack runs as the pinned Compose project `exam-dev` (#631), so a
production rehearsal from this checkout can never recreate its containers.
Dev database state is explicitly **disposable**: the Postgres container
holds no named volume. `pnpm db:up` after `stop` / `restart` / a host
reboot reuses the existing container and keeps its data; `pnpm db:down`
removes the container, and the next `db:up` mounts a fresh anonymous
volume — the old state is unreachable either way (the test `exam_test`
database is self-provisioned by the test harness). Reconstruction is
`pnpm db:migrate` + `pnpm db:seed`. A dev stack created before the pin
lives under project `exam` and is untouched by `pnpm db:up`; start it
explicitly with `docker compose -p exam -f docker-compose.dev.yml up -d`.

The dev `DATABASE_URL` is constructed from `DB_HOST_PORT` by the single
source DB resolver (`packages/db/src/databaseUrl.ts`). An explicit
`DATABASE_URL` always wins.

## Seed and Demo Data

| Command | Purpose |
| --- | --- |
| `pnpm db:seed` | Basic seed: Admin + 2 Candidate users |
| `pnpm db:seed:demo` | Rich demo: 5 users, 3 courses, 10 questions, 4 exams |
| `pnpm db:seed:demo:verify` | Verify demo seed integrity |

Custom seed credentials can be set in `.env` before seeding (`SEED_ORG_NAME`,
`SEED_ORG_DISPLAY_NAME`, `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`,
`SEED_CANDIDATE_*` — see the runbook's *Custom seed credentials* note in
`docs/deployment/mvp-deployment-runbook.md` for the full list; they are not
`.env.example` keys). The seed refuses to run in production mode.

## Running the Application

```bash
pnpm dev          # API + Web with hot reload
pnpm --filter web dev   # Web only
pnpm --filter api dev   # API only
```

| Service | Dev port | Owner variable |
| --- | --- | --- |
| Web (Vite) | 5173 | `VITE_PORT` |
| API (Fastify) | 3000 | `DEV_API_PORT` |
| PostgreSQL | 5432 | `DB_HOST_PORT` |

See [`ports.md`](ports.md) for the full port map and mode ownership
rules.

## Development Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Start all services in dev mode |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm coverage` | Run tests with coverage |
| `pnpm lint` | Code quality checker |
| `pnpm lint:eslint` | ESLint on web package |
| `pnpm typecheck` | Type-check all packages |
| `pnpm verify:static` | All static gates (no DB required) |
| `pnpm verify` | Full verification: static + coverage + build |

## Testing

The testing contract, environment variables, DB lifecycle, and CI
infrastructure are documented in
[`docs/standards/testing.md`](../standards/testing.md).

Quick summary:

- Unit/component tests: `pnpm test`
- DB-dependent tests (`@exam/db`, `@exam/api`): require running
  PostgreSQL — start with `pnpm db:up`
- Full verification: `pnpm verify` (format + lint + typecheck +
  coverage + build)

## Code Quality

All quality rules, dependency graph constraints, and AI coding
guidelines live in
[`docs/standards/code-quality.md`](../standards/code-quality.md).

Key checks:

```bash
pnpm lint:arch          # architecture boundary checks
pnpm lint:db-config     # database config consistency
pnpm lint:env-contract  # env var contract guards
```

## E2E

One canonical host-native runner for Playwright browser tests:

- **Local / CI parity** (`pnpm e2e` → `bash scripts/e2e/run.sh`) — runs the
  API dev server + host Chromium; Compose owns only the PostgreSQL/Redis
  dependencies. CI executes the same product contracts with service
  containers instead of the dev Compose stack.

See [`docs/standards/testing.md`](../standards/testing.md) for the full
E2E guide.

## Architecture References

| Document | Purpose |
| --- | --- |
| [`docs/SPEC.md`](../SPEC.md) | Product specification — invariants, domain model |
| [`docs/architecture/authorization.md`](../architecture/authorization.md) | Capability-based authorization model |
| [`docs/architecture/exam-runtime.md`](../architecture/exam-runtime.md) | Exam / Attempt / Answer / Submit protocol |
| [`docs/operations/email-config.md`](../operations/email-config.md) | Email outbox / SMTP operator reference |
| [`docs/architecture/frontend.md`](../architecture/frontend.md) | Frontend architecture (as-built) |
| [`docs/standards/ui-system.md`](../standards/ui-system.md) | UI system constraints and visual authority |
| [`docs/adr/README.md`](../adr/README.md) | Architecture Decision Records index |
| [`docs/contracts/api-contract.md`](../contracts/api-contract.md) | Runtime-first API contract policy |

## AI / Agent Guidance

AI coding agents must read and follow [`AGENTS.md`](../../AGENTS.md)
before making any changes. It defines work modes, authorization
boundaries, database safety, testing strategy, and modification
principles.
