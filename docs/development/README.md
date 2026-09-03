# Development Guide

> Local development setup, testing, code quality, and architecture
> references for Exam contributors.

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

# 2. Start PostgreSQL (+ Redis for optional features)
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
| `pnpm db:up` | Start PostgreSQL container (port `DB_HOST_PORT`, default 5432) |
| `pnpm db:down` | Stop PostgreSQL container |
| `pnpm db:reset` | Reset dev database (down + up) |
| `pnpm db:migrate` | Run migrations |
| `pnpm db:push` | Push schema changes directly |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm db:generate` | Generate migration files |

The dev `DATABASE_URL` is constructed from `DB_HOST_PORT` by the single
source DB resolver (`packages/db/src/databaseUrl.ts`). An explicit
`DATABASE_URL` always wins.

## Seed and Demo Data

| Command | Purpose |
| --- | --- |
| `pnpm db:seed` | Basic seed: Admin + 2 Candidate users |
| `pnpm db:seed:demo` | Rich demo: 5 users, 3 courses, 10 questions, 4 exams |
| `pnpm db:seed:demo:verify` | Verify demo seed integrity |

Custom seed credentials can be set in `.env` before seeding (see
`.env.example` for the full list). The seed refuses to run in
production mode.

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
pnpm lint:repo-contract # turbo/package/seed/ADR/topology contracts
pnpm lint:ui-gates      # frontend visual authority guards
```

## E2E

Two execution modes for Playwright browser tests:

- **WSL / local** (`bash scripts/e2e/run-wsl.sh`) — runs against the
  dev server + host Chromium. Best for development iteration.
- **Docker** (`bash scripts/e2e/run.sh`) — builds and runs the full
  stack in containers. Best for CI-parity.

Both produce the same pass/fail set. See
[`docs/standards/testing.md`](../standards/testing.md) for the full
E2E guide.

## Architecture References

| Document | Purpose |
| --- | --- |
| [`docs/SPEC.md`](../SPEC.md) | Product specification — invariants, domain model |
| [`docs/architecture/authorization.md`](../architecture/authorization.md) | Capability-based authorization model |
| [`docs/architecture/exam-runtime.md`](../architecture/exam-runtime.md) | Exam / Attempt / Answer / Submit protocol |
| [`docs/architecture/email-config.md`](../architecture/email-config.md) | Email outbox / SMTP operator reference |
| [`docs/architecture/frontend.md`](../architecture/frontend.md) | Frontend architecture (as-built) |
| [`docs/standards/ui-system.md`](../standards/ui-system.md) | UI system constraints and visual authority |
| [`docs/adr/README.md`](../adr/README.md) | Architecture Decision Records index |
| [`docs/contracts/api-contract.md`](../contracts/api-contract.md) | Runtime-first API contract policy |

## AI / Agent Guidance

AI coding agents must read and follow [`AGENTS.md`](../../AGENTS.md)
before making any changes. It defines work modes, authorization
boundaries, database safety, testing strategy, and modification
principles.
