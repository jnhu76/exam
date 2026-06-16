# Exam Platform

LAN/on-premise exam and assessment platform. Single-tenant, auto-graded, supports open-book quizzes and strict proctored exams.

> **Current scope (Phase 1 + Phase 2)**: single-tenant, Admin + Candidate only.
> Tenant schema, role enums, and `organizationId` boundaries are retained for
> forward compatibility. MultiTenant product paths, SuperAdmin UI, tenant
> switcher, organizationSlug login, API keys, service tokens, webhooks, and
> CAS/OAuth are deferred to later phases.

## Quick Start

```bash
# Install dependencies
pnpm install

# Seed database with test users
pnpm db:seed

# Start all services (API + Web) in development mode
pnpm dev
```

This starts:

- **Web** (Vite): http://localhost:5173
- **API** (Fastify): http://localhost:3000

The web dev server proxies `/api/*` requests to the API server automatically.

### Test Users (basic seed)

By default, `pnpm db:seed` creates the following test users (Phase 1 = Admin +
Candidate only):

| Username     | Password       | Role       |
| ------------ | -------------- | ---------- |
| `admin`      | `admin123`     | Admin      |
| `candidate`  | `candidate123` | Candidate  |
| `candidate2` | `candidate123` | Candidate  |

> **Phase 1 scope**: only `Admin` and `Candidate` are runnable roles. Other
> roles (`SuperAdmin`, `Teacher`, `Proctor`, `Grader`) exist in the schema/DB
> layer but are **not active in Phase 1** — their product paths, login, and UI
> are deferred to later phases. Demo-seed rows for those roles are kept for
> forward compatibility but cannot log in.

You can customize these users by setting environment variables in your `.env` file (copy from `.env.example`):

```bash
# Organization settings
SEED_ORG_NAME="My Organization"
SEED_ORG_DISPLAY_NAME="My Organization"

# Admin user
SEED_ADMIN_USERNAME="admin"
SEED_ADMIN_PASSWORD="admin123"
SEED_ADMIN_NAME="Admin"

# Candidate user
SEED_CANDIDATE_USERNAME="candidate"
SEED_CANDIDATE_PASSWORD="candidate123"
SEED_CANDIDATE_NAME="Candidate"

# Second candidate user
SEED_CANDIDATE2_USERNAME="candidate2"
SEED_CANDIDATE2_PASSWORD="candidate123"
SEED_CANDIDATE2_NAME="Candidate 2"
```

### Demo Seed

The demo seed creates a rich dataset for full-flow manual testing. It includes 5 users (1 Admin + 4 Candidates), 3 courses, 10 questions (all 4 types), 4 exams in various statuses, enrollments, and graded attempts.

```bash
# Fresh demo seed (resets database)
pnpm db:reset && pnpm db:seed:demo

# Re-run on existing database (idempotent)
pnpm db:seed:demo

# Verify seed data integrity
pnpm db:seed:demo:verify
```

#### Demo Accounts

| Username | Password | Role | Purpose |
|---|---|---|---|
| `admin` | `admin123` | Admin | All admin features (config, questions, exams, grading) |
| `candidate1` | `candidate123` | Candidate | In-progress exam (resume) |
| `candidate2` | `candidate123` | Candidate | Available / start |
| `candidate3` | `candidate123` | Candidate | Resumable / resume |
| `candidate4` | `candidate123` | Candidate | Graded / view result |

> **Phase 1 scope**: demo seed creates Admin + Candidate accounts only.
> `SuperAdmin` / `Teacher` / `Proctor` / `Grader` roles are **not seeded and
> not active in Phase 1** (deferred to later phases). Schema/DB columns for
> those roles are retained for forward compatibility.

#### Demo Data

- **3 courses**: SAFETY-101, SKILL-201, EMPTY-001 (empty course)
- **10 questions**: All 4 types (single_choice, multiple_choice, true_false, fill_blank)
- **4 exams**: open, draft, published (future), closed
- **Enrollments + attempts**: Pre-created states for all candidate flows (in_progress, disrupted, graded)

See `docs/dev/demo-seed-test-guide.md` for detailed test flows and verification checklists.

## Deployment Modes

### Mode 1: Local Development

Requires a running PostgreSQL instance. Use `pnpm db:up` to start one via Docker.

```bash
pnpm install
pnpm db:up       # Start PostgreSQL container (port 5432)
pnpm db:migrate  # Run migrations
pnpm db:seed     # Seed with test users
pnpm dev         # Start API + Web with hot reload
```

- Web: http://localhost:5173
- API: http://localhost:3000
- Database: PostgreSQL 18 on `localhost:5432`

### Mode 2: Docker Compose (Full Stack)

Production-like deployment. Builds the app image and starts both API and PostgreSQL in containers.

```bash
docker compose up -d
docker compose logs -f app
docker compose down
docker compose down -v   # remove database data
```

- App: http://localhost:3000
- Database: PostgreSQL (internal, not exposed to host)
- Migrations run automatically on container start

## Docker Files Reference

| File                      | Purpose                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `Dockerfile`              | Multi-stage build: base → builder → production runner                         |
| `docker-compose.yml`      | Production: app + PostgreSQL 18                                               |
| `docker-compose.dev.yml`  | Local development DB: PostgreSQL 18 only (for `pnpm db:up` / host test runs)  |
| `docker-compose.test.yml` | Full-stack + E2E: app (dev) + PostgreSQL 18 + E2E service (Playwright, profile) |
| `docker-entrypoint.sh`    | Runs migrations before starting the server                                    |
| `.env.example`            | Environment variable template                                                 |

## Development Commands

| Command                  | Description                                                 |
| ------------------------ | ----------------------------------------------------------- |
| `pnpm dev`               | Start all services in dev mode (hot reload)                 |
| `pnpm --filter web dev`  | Start only the web frontend                                 |
| `pnpm --filter api dev`  | Start only the API server                                   |
| `pnpm db:seed`           | Seed database with basic test users                        |
| `pnpm db:seed:demo`      | Seed rich demo dataset (5 users, 4 exams, graded attempts) |
| `pnpm db:seed:demo:verify` | Verify demo seed data integrity                          |
| `pnpm db:push`           | Push schema changes to database                             |
| `pnpm db:migrate`        | Run database migrations                                     |
| `pnpm db:studio`         | Open Drizzle Studio                                         |
| `pnpm db:up`             | Start PostgreSQL container (dev, port 5432)                |
| `pnpm db:down`           | Stop PostgreSQL container                                   |
| `pnpm db:reset`          | Reset dev database (down + up + migrate)                   |
| `pnpm test:pg`           | Run tests against PostgreSQL                                |
| `pnpm test`              | Run all tests                                               |
| `pnpm --filter web test` | Run web tests only                                          |
| `pnpm typecheck`         | Type-check all packages                                     |
| `pnpm lint`              | Lint all packages                                           |
| `pnpm verify`            | Full verification: format + lint + typecheck + test + build |

## Project Structure

```
apps/
  web/          React 19 + Vite + TypeScript frontend
  api/          Fastify + TypeScript backend

packages/
  domain/       Domain types, enums, errors
  contracts/    Zod schemas, API contracts
  db/           Drizzle ORM, migrations, repositories
  auth/         Session, RBAC, tenant guard
  exam-engine/  Timer, answer protocol, grading
```

## Tech Stack

- **Frontend**: React 19, Vite, TypeScript, shadcn/ui, TailwindCSS v4
- **Backend**: Fastify, TypeScript, Zod validation
- **Database**: PostgreSQL 18 via Drizzle ORM
- **Monorepo**: pnpm workspaces + Turborepo

## Documentation

| Document | Description |
|---|---|
| `docs/SPEC.md` | Full product specification (authoritative) |
| `docs/code-quality.md` | Code quality rules and conventions (authoritative) |
| `docs/phase2/phase2.plan.md` | Phase 2 Exam Runtime Closure plan (authoritative) |
| `docs/phase2/discovery/01-frontend-inventory.md` | Phase 1 frontend route/component inventory |
| `docs/phase2/discovery/02-backend-api-inventory.md` | Phase 1 backend API endpoint inventory |
| `docs/phase2/discovery/03-openapi-contract-audit.md` | OpenAPI spec vs actual code audit |
| `docs/phase2/discovery/04-state-machine-audit.md` | Exam/attempt/enrollment state machine audit |
| `docs/phase2/discovery/05-user-flow-trace-map.md` | End-to-end user flow trace (candidate, admin, proctor) |
| `docs/phase2/discovery/06-phase2-gap-analysis.md` | Phase 2 gap analysis with P0/P1/P2 priorities |
| `docs/dev/demo-seed-plan.md` | Demo seed dataset plan (historical — actual seed differs) |
| `docs/dev/demo-seed-contract.md` | Enum values, entity fields, lifecycle rules, data relations |
| `docs/dev/demo-seed-test-guide.md` | Step-by-step manual test guide for demo seed |
| `docs/dev/exam-data-chain.md` | Entity relationships and data flow documentation |
| `docs/dev/manual-test-bugs.md` | Known bugs from manual testing |

## Environment Variables

### Application Settings

| Variable            | Default                         | Description                                                   |
| ------------------- | ------------------------------- | ------------------------------------------------------------- |
| `VITE_API_BASE_URL` | `""` (proxy)                    | API base URL for the web client                               |
| `APP_MODE`          | `development`                   | Run mode: `development`, `test`, `e2e`, `ci`, `production`    |
| `APP_PORT`          | `3000`                          | API server port                                               |
| `HOST`              | `0.0.0.0`                       | API server listen address                                     |
| `DATABASE_URL`      | `postgresql://...`              | Database connection URL (**required in production**)           |
| `JWT_SECRET`        | auto-generated in dev           | JWT signing secret (**required in production**; fail-fast)    |
| `NODE_ENV`          | `development`                   | Node environment (build/fallback signal)                      |
| `COOKIE_SECURE`     | `false`                         | Whether cookies should be secure (HTTPS only)                 |
| `CORS_ORIGIN`       | `http://localhost:5173`         | CORS origin for API server (**required in production**)       |
| `DEPLOYMENT_MODE`   | `singleTenant`                  | Deployment mode. Phase 1 is `singleTenant` only. `multiTenant` is rejected at startup (Phase 4) |

### Seed Data Configuration (Optional)

| Variable                  | Default                | Description                       |
| ------------------------- | ---------------------- | --------------------------------- |
| `SEED_ORG_NAME`           | `Default Organization` | Default organization name         |
| `SEED_ORG_DISPLAY_NAME`   | Same as SEED_ORG_NAME  | Default organization display name |
| `SEED_ADMIN_USERNAME`     | `admin`                | Admin username                    |
| `SEED_ADMIN_PASSWORD`     | `admin123`             | Admin password                    |
| `SEED_ADMIN_NAME`         | `Admin`                | Admin display name                |
| `SEED_CANDIDATE_USERNAME` | `candidate`            | Candidate username                |
| `SEED_CANDIDATE_PASSWORD` | `candidate123`         | Candidate password                |
| `SEED_CANDIDATE_NAME`     | `Candidate`            | Candidate display name            |
| `SEED_CANDIDATE2_USERNAME`| `candidate2`           | Second candidate username         |
| `SEED_CANDIDATE2_PASSWORD`| `candidate123`         | Second candidate password         |
| `SEED_CANDIDATE2_NAME`    | `Candidate 2`          | Second candidate display name     |

## Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm coverage

# Run specific package tests
pnpm --filter web test
pnpm --filter db test
```

> **Note**: DB-dependent tests (`@exam/db`, `@exam/api`) require a running
> PostgreSQL. Start one with `pnpm db:up` (uses `docker-compose.dev.yml`,
> PostgreSQL 18 on port `5432`) and set `DATABASE_URL` /
> `TEST_DATABASE_URL` to point at it. In CI, GitHub Actions `services: postgres`
> provides this instead.

### E2E Tests (Playwright, browser)

E2E browser tests live in `apps/e2e/e2e/*.spec.ts` and cover the candidate
exam lifecycle (happy-path, resume, submit-flush, demo-seed accounts). They run
in two environments:

**CI** — the `e2e` job in `.github/workflows/ci.yml` builds the app, seeds
(`db:seed` + `db:seed:demo`), starts the API, and runs `playwright test` with
`APP_MODE=e2e` (rate limiting disabled).

**Local via Docker** (canonical browser entry — requires Docker, no local
Playwright install needed):

```bash
# 1. Start the full stack + DB (app must be healthy for E2E to target it)
docker compose -f docker-compose.test.yml up -d --build

# 2. Run the E2E service (Playwright image) against the running app
docker compose -f docker-compose.test.yml --profile e2e run --rm e2e

# 3. Tear down
docker compose -f docker-compose.test.yml down -v
```

The E2E service uses the official `mcr.microsoft.com/playwright` image and
targets `http://app:3000` inside the compose network.

> **Local Playwright residue**: if you previously ran `sudo playwright install`
> locally, `apps/e2e/node_modules/playwright-core` may be root-owned and block
> `pnpm install` with `EPERM`. Clean it up (needs sudo):
> ```bash
> sudo rm -rf apps/e2e/node_modules
> pnpm install
> ```
> After that, prefer the Docker entry above — local browsers are not required.

## Build

```bash
# Build all packages
pnpm build

# Build web only
pnpm --filter web build
```
