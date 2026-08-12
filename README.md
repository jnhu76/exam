# Exam Platform

LAN/on-premise exam and assessment platform. Single-tenant, auto-graded, supports open-book quizzes and strict proctored exams.

> **Current scope**: single-tenant. The Phase 1/2 exam loop is complete
> (publish/open/close/cancel/archive/extend, candidate attempt flow with
> answer save protocol, deadline auto-submit, manual grading, result
> publishing, monitoring/diagnostics, export/audit) with `timed_window` the
> only timing mode. Phase 3 authorization infrastructure and the
> Admin/Teacher/Candidate MVP role switch (P4) are closed; Phase 3 product
> work (scoped Teacher/Proctor/Grader role bundles, staff invitation, SMTP
> reset, account lifecycle UI, WYSIWYG submit) remains open.
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

- **Web** (Vite): <http://localhost:5173>
- **API** (Fastify): <http://localhost:3000>

The web dev server proxies `/api/*` requests to the API server automatically.

### Test Users (basic seed)

By default, `pnpm db:seed` creates the following test users (basic seed =
Admin + Candidate accounts):

| Username     | Password       | Role       |
| ------------ | -------------- | ---------- |
| `admin`      | `admin123`     | Admin      |
| `candidate`  | `candidate123` | Candidate  |
| `candidate2` | `candidate123` | Candidate  |

> **Phase 1 scope**: only `Admin` and `Candidate` are Phase 1 product roles.
> `Teacher` is an active MVP product role since the P4 role switch. `Proctor`
> and `Grader` exist in the schema/DB layer but are **not active product
> roles** — their product paths, login, and UI are deferred to Phase 3+
> (scoped role bundles).

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

> **Phase 1 scope**: demo seed creates Admin + Candidate accounts.
> `Teacher` is an active MVP product role since the P4 role switch;
> `SuperAdmin` / `Proctor` / `Grader` roles are **not seeded and not active
> in Phase 1** (deferred to later phases). Schema/DB columns for those roles
> are retained for forward compatibility.

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
pnpm db:up       # Start PostgreSQL container (port 15432)
pnpm db:migrate  # Run migrations
pnpm db:seed     # Seed with test users
pnpm dev         # Start API + Web with hot reload
```

- Web: <http://localhost:5173>
- API: <http://localhost:3000>
- Database: PostgreSQL 18 on `localhost:15432`

### Mode 2: Docker Compose (Full Stack)

Production-like deployment. Builds the app image and starts the default MVP
topology in containers: API + PostgreSQL + Email delivery worker. Redis is
**optional** (gated behind the `redis` profile); when enabled it owns ONE
production responsibility — the **shared rate-limit state** (P7 decision
2026-08-08, ADR-001 "Post-MVP Decision (P7)"). The Email worker is required
to drain the PostgreSQL `email_outbox` table that `result_published`
notifications write into (ADR-011). See
[`docs/deployment/mvp-deployment-runbook.md`](docs/deployment/mvp-deployment-runbook.md)
for the canonical deployment & operations runbook (prerequisites, env vars,
first install, recovery, upgrade checklist, known limitations).

```bash
# Configure production-required env (copy template, edit):
cp .env.example .env
#   POSTGRES_PASSWORD, JWT_SECRET, CORS_ORIGIN, PUBLIC_WEB_ORIGIN are
#   REQUIRED in the bundled docker-compose.yml (it uses ${VAR:?...}
#   required-expansion — Compose fails to start if any is unset). There
#   is NO default database password in production (P6-007).

docker compose up -d --build    # build + start app, db, email-worker
docker compose logs -f app
docker compose ps               # verify app, db, email-worker are up
docker compose down             # stops + removes containers (keeps ./data)
# NOTE: authoritative state lives in the operator-visible host bind
# mount ./data/postgres (EXAM_DATA_ROOT, default ./data). `docker compose down`
# retains it; `docker compose down -v` is a no-op for bind mounts. To destroy
# authoritative data you must explicitly delete ./data/postgres. See
# docs/deployment/backup-and-recovery.md.

# (Optional) enable the Redis profile — the shared rate limiter reads/writes
# Redis when the runtime is ready:
docker compose --profile redis up -d --build
# and set REDIS_PASSWORD=<secret>, REDIS_URL=redis://:<secret>@redis:6379
#   (REDIS_MODE=optional|required) in .env — production Redis runs with
#   requirepass, so an authenticated URL is required (see runbook §10)
```

- App: <http://localhost:3000>
- Database: PostgreSQL (internal, not exposed to host)
- Email worker: drains `email_outbox` (resident process; see ADR-011)
- Migrations run on container start. The `app` container runs
  `node dist/scripts/migrate.js` in its entrypoint before binding the API.
  The `email-worker` depends on `app: service_healthy`, so its startup
  self-migrate call is serialized strictly AFTER the app's migrate call
  (the drizzle journal tracks state; it is NOT a concurrency lock — P6-009).
- Redis: **optional** profile (`--profile redis`); not started by a bare
  `docker compose up` (P6-010 / ADR-001). When running, the API's shared
  rate limiter reads/writes Redis (ADR-001 "Post-MVP Decision (P7)");
  PostgreSQL remains the exam fact authority.

The scanner (heartbeat + deadline) runs **in-process** inside the `app`
container — there is no separate scanner service.

#### Production first-Admin bootstrap

The first Admin is created via the `bootstrap-admin` CLI against a fresh
migrated database (P6-008). The baseline dev/test seed
(`packages/db/src/seed.ts`) ships known default credentials and refuses to
run when `APP_MODE=production`. Do NOT use the baseline seed as the
production bootstrap path.

```bash
docker compose exec app \
  node dist/scripts/bootstrap-admin.js \
  --username admin \
  --password '<STRONG_OPERATOR_PASSWORD>' \
  --name 'System Admin' \
  --organization-name 'My Organization'
```

The bootstrap: (1) locates or creates the internal default organization
(slug `default`); (2) creates the first Admin with the explicit password;
(3) creates the primary Admin role assignment in the same transaction;
(4) writes an `admin.bootstrap` audit row. It refuses a second active
Admin unless `--force` is supplied. It does NOT create Candidate accounts.

Alternatively, on a fresh installation you can use the **Launchpad**
first-install page: set `LAUNCHPAD_SETUP_TOKEN=<openssl rand -hex 32>` in
`.env`, start the stack, and navigate to `/launchpad` to complete the
first-Admin setup in the browser. The Launchpad and the CLI share one
canonical atomic mutation body (serialized by a transaction-scoped
PostgreSQL advisory lock so exactly one first installation may win); once
the installation is initialized, `/launchpad` redirects to `/login` (it
never reopens). See
[`docs/deployment/backup-and-recovery.md`](docs/deployment/backup-and-recovery.md) §11.

#### Backup and recovery

Authoritative state is the PostgreSQL data directory under
`./data/postgres`. **Host persistence is not backup** — see
[`docs/deployment/backup-and-recovery.md`](docs/deployment/backup-and-recovery.md)
for the full decision tree. There is exactly ONE production/operator Docker
Compose entry point (`docker-compose.yml`); optional capabilities such as
PITR are PostgreSQL database configuration
(`scripts/backup/postgres-enable-pitr.sh`), not an alternate Docker
topology. The supported paths are: stopped-directory relocation (C1),
cold-filesystem backup/restore (C1), C2 logical `pg_dump` online backup +
clean restore, and C3 physical `pg_basebackup` + WAL archive / PITR.

## Docker Files Reference

| File                      | Purpose                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `Dockerfile`              | Multi-stage build: base → builder → production runner                         |
| `docker-compose.yml`      | Production: app + email-worker + PostgreSQL 18 (Redis 7 optional, `--profile redis`) |
| `docker-compose.dev.yml`  | Local development: PostgreSQL 18 + Redis 7 (for `pnpm db:up` / host runs)    |
| `docker-compose.test.yml` | Full-stack + E2E: app (dev) + PostgreSQL 18 + Redis 7 + Playwright            |
| `docker-entrypoint.sh`    | Runs migrations before starting the server                                    |
| `.env.example`            | Runtime/dev environment template                                              |
| `.env.test.example`       | Test/coverage environment template (copy to `.env.test.local`)                |

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
| `pnpm db:up`             | Start PostgreSQL container (dev, port 15432)                |
| `pnpm db:down`           | Stop PostgreSQL container                                   |
| `pnpm db:reset`          | Reset dev database (down + up + migrate)                   |
| `pnpm test`              | Run all tests                                               |
| `pnpm --filter web test` | Run web tests only                                          |
| `pnpm typecheck`         | Type-check all packages                                     |
| `pnpm lint`              | Run the code-quality checker (not ESLint)                   |
| `pnpm lint:eslint`       | Run ESLint on the web package                               |
| `pnpm lint:quality`      | Canonical alias for `pnpm lint` (code-quality checker)      |
| `pnpm verify`            | Full verification: format + lint + typecheck + test + build |
| `pnpm verify:static`     | Static gates only (no DB-dependent tests)                   |
| `pnpm e2e:docker`        | Managed Docker E2E lifecycle (build, migrate, seed, run)    |
| `pnpm test:e2e`          | **Existing-env only**: runs Playwright against a pre-running API/web/seeded DB |
| `pnpm smoke`             | Lightweight PR smoke gate (single Playwright E2E spec)      |

> **Command semantics**
>
> - `pnpm lint` runs `scripts/check-code-quality.mjs` (architecture, copy, UI
>   guards, etc.). For ESLint, use `pnpm lint:eslint`.
> - `pnpm test:integration` is a compatibility alias for `pnpm test`; both run
>   `vitest run` with the same test files.
> - `pnpm test:e2e` and `pnpm smoke` are **existing-environment-only**: they
>   assume PostgreSQL is migrated, E2E data is seeded, and the API + web servers
>   are already running. Use `pnpm e2e:docker` (or `bash scripts/e2e/run-wsl.sh`)
>   for a managed lifecycle that builds, migrates, seeds, and runs Playwright.

## Project Structure

```
apps/
  web/          React 19 + Vite + TypeScript frontend
  api/          Fastify + TypeScript backend
  e2e/          Playwright E2E browser tests

packages/
  domain/       Domain types, enums, errors
  contracts/    Zod schemas, API contracts
  db/           Drizzle ORM, migrations, repositories
  auth/         Session, RBAC, tenant guard
  exam-engine/  Timer, answer protocol, grading
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + Vite + TypeScript + shadcn/ui + TailwindCSS v4 |
| Backend | Node.js 24.15.x + Fastify + TypeScript + Zod validation |
| Database | PostgreSQL 18.4 via Drizzle ORM |
| Cache | Redis 7 (optional, shared rate limiting; PostgreSQL remains the fact authority) |
| Monorepo | pnpm 11 + Turborepo 2.9.16 |

See `docs/standards/testing.md` for CI infrastructure details and local testing setup.

## Documentation

The canonical documentation index is [`docs/README.md`](docs/README.md). Start there.

| Document | Description |
|---|---|
| `docs/SPEC.md` | Full product specification — invariants, domain model, architecture (authoritative) |
| `docs/README.md` | Canonical documentation index and authority precedence |
| `docs/roadmap/phase-roadmap.md` | Phase 1/2/3/4 scope authority |
| `docs/roadmap/current.md` | Current work and what comes next |
| `docs/status/implementation-status.md` | What is implemented / partial / limited now |
| `docs/standards/code-quality.md` | Code quality rules, gates, AI coding rules |
| `docs/standards/testing.md` | Testing & CI contract |
| `docs/architecture/authorization.md` | Capability-based authorization model (implemented) |
| `docs/adr/README.md` | Architecture Decision Records index |
| `docs/architecture/frontend.md` | Frontend architecture (as-built) |
| `docs/standards/ui-system.md` | UI system constraints (as-built visual authority) |

Historical material (plans, audits, reviews, implementation reports) lives under `docs/archive/` and is not current implementation guidance.

## Environment Variables

### Application Settings

| Variable            | Default                         | Description                                                   |
| ------------------- | ------------------------------- | ------------------------------------------------------------- |
| `VITE_API_BASE_URL` | `""` (proxy)                    | API base URL for the web client                               |
| `APP_MODE`          | `development`                   | Run mode: `development`, `test`, `e2e`, `ci`, `production`    |
| `APP_PORT`          | `3000`                          | API server port                                               |
| `HOST`              | `0.0.0.0`                       | API server listen address                                     |
| `DATABASE_URL`      | `postgresql://...`              | Database connection URL (**required in production**)           |
| `REDIS_URL`         | (empty = disabled)              | Redis connection URL (optional; enables the shared rate limiter when the runtime is ready)     |
| `REDIS_KEY_PREFIX`  | `""`                            | Redis key prefix for namespace separation                     |
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
> PostgreSQL. Redis tests require a running Redis instance. Start both with
> `pnpm db:up` (uses `docker-compose.dev.yml`, PostgreSQL 18 + Redis 7). The
> dev compose maps PostgreSQL to host port **`15432`** (host `:5432` is
> commonly occupied on Windows/WSL; override via `DB_HOST_PORT`).
> `pnpm db:up` auto-creates both `exam` (dev runtime) and `exam_test` (tests)
> databases; set `DATABASE_URL` in `.env` (see `.env.example`) and
> `TEST_DATABASE_URL` in `.env.test.local` (see `.env.test.example`). In CI,
> GitHub Actions `services: postgres` and `services: redis` provide these
> instead (on `:5432`/`:6379`, since CI runs in an isolated VM).

### Quick local test setup

```bash
# 1. Start PostgreSQL + Redis (creates exam + exam_test databases)
pnpm db:up

# 2. Copy env templates and adjust ports if needed:
cp .env.example .env                              # runtime/dev config
cp .env.test.example .env.test.local              # test config
#    .env        → DATABASE_URL=postgresql://exam:exam@localhost:15432/exam
#    .env.test.local → TEST_DATABASE_URL=postgresql://exam:exam@localhost:15432/exam_test
#    .env        → REDIS_URL=redis://localhost:6379

# 3. Run tests (vitest reads .env + .env.test.local; @exam/db + @exam/api hit exam_test)
pnpm coverage
```

> WSL/Windows users: host `:5432` is often taken by a Windows-side service, so
> the dev compose publishes `15432` instead. CI uses `:5432` (isolated VM).
> The single-source DB resolver (`packages/db/src/databaseUrl.ts`) reads the
> URL from env; tests never silently fall back to a guessed localhost.

### E2E Tests (Playwright, browser)

E2E browser tests live in `apps/e2e/e2e/*.spec.ts` and cover the candidate
exam lifecycle (happy-path, resume, submit-flush, demo-seed accounts, manual
grading, result publishing, proctor runtime, disconnect/restore, deadline
crash, fill_blank, multi_select, proctor monitoring UI). See **[`docs/standards/testing.md`](docs/standards/testing.md)** for the
full guide (prerequisites, flags, env vars, targeting, seed, debugging).

**Two execution modes — choose by environment:**

- **WSL / local** (`scripts/e2e/run-wsl.sh`) — runs the API dev server + a local
  Chromium on the host. Faster iteration; requires Node/pnpm/Playwright locally
  and the dev compose (`pnpm db:up`). Best for development.
- **Docker** (`scripts/e2e/run.sh`) — builds the full app image and runs
  Playwright in a container. No local Node/Playwright needed; matches CI most
  closely. Best for CI-parity and isolated runs.

Both should produce the same pass/fail set.

**WSL / local one-command entry**:

```bash
bash scripts/e2e/run-wsl.sh                       # run all specs (host Chromium)
bash scripts/e2e/run-wsl.sh candidate-happy-path  # spec filename keyword
bash scripts/e2e/run-wsl.sh --grep "happy path"   # Playwright title regex
bash scripts/e2e/run-wsl.sh --no-reseed           # reuse existing seed data
bash scripts/e2e/run-wsl.sh --keep-server         # leave dev server running
```

**Docker one-command entry** (builds, starts the stack, runs Playwright,
cleans up — requires Docker, no local Playwright install):

```bash
bash scripts/e2e/run.sh                       # run all specs
bash scripts/e2e/run.sh candidate-happy-path  # spec filename keyword
bash scripts/e2e/run.sh --grep "happy path"   # Playwright title regex
bash scripts/e2e/run.sh --no-build            # reuse last image
```

**Manual `docker compose` profile** (for debugging / single-spec runs):

```bash
# 1. Start the full stack + DB (app runs migrate + canonical E2E seed on boot)
docker compose -f docker-compose.test.yml up -d --build db redis app

# 2. Run the E2E service (Playwright image) against the running app
docker compose -f docker-compose.test.yml --profile e2e run --rm e2e

# 3. Tear down (wipe the DB volume for a clean reseed)
docker compose -f docker-compose.test.yml down -v
```

**CI** — the `e2e` job in `.github/workflows/ci.yml` builds the app, seeds
(`db:seed:e2e`), starts the API, and runs `playwright test` with `APP_MODE=e2e`
(rate limiting disabled). It targets `http://localhost:3000` because app and
Playwright share the runner host.

> **Targeting note**: inside the compose network the browser targets
> `http://examapp:3000` (a network alias), **not** the service name `app`.
> Chromium HSTS-preloads the bare hostname `app` (Google's `.app` TLD is
> force-HTTPS), so `http://app:3000/` fails with `ERR_SSL_PROTOCOL_ERROR`.
> `run.sh` avoids this by pointing at the app container IP. Do not revert
> `E2E_BASE_URL` to `http://app:3000`. Details in the E2E guide.

## Build

```bash
# Build all packages
pnpm build

# Build web only
pnpm --filter web build
```
