# Exam Platform

LAN/on-premise exam and assessment platform. Multi-tenant, auto-graded, supports open-book quizzes and strict proctored exams.

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

By default, `pnpm db:seed` creates the following test users:

| Username    | Password       | Role       |
| ----------- | -------------- | ---------- |
| `admin`     | `admin123`     | SuperAdmin |
| `teacher`   | `teacher123`   | Teacher    |
| `candidate` | `candidate123` | Candidate  |

You can customize these users by setting environment variables in your `.env` file (copy from `.env.example`):

```bash
# Organization settings
SEED_ORG_NAME="My Organization"
SEED_ORG_DISPLAY_NAME="My Organization"

# Admin user
SEED_ADMIN_USERNAME="admin"
SEED_ADMIN_PASSWORD="admin123"
SEED_ADMIN_NAME="Admin"

# Teacher user
SEED_TEACHER_USERNAME="teacher"
SEED_TEACHER_PASSWORD="teacher123"
SEED_TEACHER_NAME="Teacher"

# Candidate user
SEED_CANDIDATE_USERNAME="candidate"
SEED_CANDIDATE_PASSWORD="candidate123"
SEED_CANDIDATE_NAME="Candidate"
```

### Demo Seed

The demo seed creates a rich dataset for full-flow manual testing. It includes 8 users, 3 courses, 10 questions (all 4 types), 5 exams in various statuses, enrollments, and graded attempts.

```bash
# Fresh demo seed (deletes and recreates dev.db)
rm -f dev.db && pnpm db:seed:demo

# Re-run on existing database (idempotent)
pnpm db:seed:demo

# Verify seed data integrity
pnpm db:seed:demo:verify
```

#### Demo Accounts

| Username | Password | Role | Purpose |
|---|---|---|---|
| `superadmin` | `admin123` | SuperAdmin | Organization management, all admin features |
| `admin` | `admin123` | Admin | All admin features except org management |
| `teacher1` | `teacher123` | Teacher | Course/question/exam management |
| `teacher2` | `teacher123` | Teacher | Teacher permission checks |
| `candidate1` | `candidate123` | Candidate | In-progress exam, retake history |
| `candidate2` | `candidate123` | Candidate | Assigned but not started |
| `candidate3` | `candidate123` | Candidate | Disrupted/recovery case |
| `candidate4` | `candidate123` | Candidate | Graded result case |

#### Demo Data

- **3 courses**: SAFETY-101, SKILL-201, EMPTY-001 (empty course)
- **10 questions**: All 4 types (single_choice, multiple_choice, true_false, fill_blank)
- **5 exams**: open, draft, published (future), closed, strict mode
- **Enrollments + attempts**: Pre-created states for all candidate flows (in_progress, disrupted, graded, not-started)

See `docs/dev/demo-seed-test-guide.md` for detailed test flows and verification checklists.

## Deployment Modes

### Mode 1: Local Development (SQLite)

The simplest way to run. No Docker required. Uses SQLite as the database.

```bash
pnpm install
pnpm db:seed    # Creates dev.db with test users
pnpm dev        # Starts API + Web with hot reload
```

- Web: http://localhost:5173
- API: http://localhost:3000
- Database: `./dev.db` (SQLite file, auto-created)

### Mode 2: Local Development with PostgreSQL

For testing PostgreSQL compatibility locally. Starts only a PostgreSQL container; API and Web run on host via `pnpm dev`.

```bash
# 1. Start PostgreSQL container
docker compose -f docker-compose.test.yml up -d

# 2. Set DATABASE_URL in .env
echo 'DATABASE_URL="postgresql://exam:exam@localhost:5432/exam_test"' >> .env

# 3. Install and start
pnpm install
pnpm dev
```

The API server auto-runs migrations on startup. No manual `db:seed` needed for PostgreSQL — create users via the admin UI after first login.

To stop PostgreSQL:

```bash
docker compose -f docker-compose.test.yml down
# Optionally remove data:
docker compose -f docker-compose.test.yml down -v
```

### Mode 3: Docker Compose (Full Stack)

Production-like deployment. Builds the app image and starts both API and PostgreSQL in containers.

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f app

# Stop all services
docker compose down

# Stop and remove database data
docker compose down -v
```

- App: http://localhost:3000
- Database: PostgreSQL (internal, not exposed to host)
- Migrations run automatically on container start

### Mode 4: Docker Compose (Development with Docker)

Runs the app in Docker with SQLite. Useful for testing the Docker build without PostgreSQL.

```bash
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml logs -f app
docker compose -f docker-compose.dev.yml down
```

- App: http://localhost:3000
- Database: SQLite (persisted in Docker volume)

## Docker Files Reference

| File                      | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `Dockerfile`              | Multi-stage build: build → production runner (node:lts-alpine) |
| `docker-compose.yml`      | Production: app + PostgreSQL                                   |
| `docker-compose.dev.yml`  | Development: app + SQLite                                      |
| `docker-compose.test.yml` | Local testing: PostgreSQL only (for host-based `pnpm dev`)     |
| `docker-entrypoint.sh`    | Runs migrations before starting the server                     |
| `.env.example`            | Environment variable template                                  |

## Development Commands

| Command                  | Description                                                 |
| ------------------------ | ----------------------------------------------------------- |
| `pnpm dev`               | Start all services in dev mode (hot reload)                 |
| `pnpm --filter web dev`  | Start only the web frontend                                 |
| `pnpm --filter api dev`  | Start only the API server                                   |
| `pnpm db:seed`           | Seed SQLite database with basic test users                |
| `pnpm db:seed:demo`      | Seed rich demo dataset (8 users, 5 exams, graded attempts) |
| `pnpm db:seed:demo:verify` | Verify demo seed data integrity                          |
| `pnpm db:push`           | Push schema changes to database                             |
| `pnpm db:migrate`        | Run database migrations                                     |
| `pnpm db:studio`         | Open Drizzle Studio                                         |
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
  desktop/      Electron shell (Phase 2)

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
- **Database**: SQLite (dev) / PostgreSQL (prod) via Drizzle ORM
- **Monorepo**: pnpm workspaces + Turborepo

## Documentation

| Document | Description |
|---|---|
| `docs/SPEC.md` | Full product specification |
| `docs/code-quality.md` | Code quality rules and conventions |
| `docs/dev/demo-seed-plan.md` | Demo seed dataset plan (accounts, courses, exams) |
| `docs/dev/demo-seed-contract.md` | Enum values, entity fields, lifecycle rules, data relations |
| `docs/dev/demo-seed-test-guide.md` | Step-by-step manual test guide for demo seed |
| `docs/dev/exam-data-chain.md` | Entity relationships and data flow documentation |
| `docs/dev/manual-test-bugs.md` | Known bugs from manual testing |

## Environment Variables

### Application Settings

| Variable            | Default                   | Description                                   |
| ------------------- | ------------------------- | --------------------------------------------- |
| `VITE_API_BASE_URL` | `""` (proxy)              | API base URL for the web client               |
| `APP_PORT`          | `3000`                    | API server port                               |
| `HOST`              | `0.0.0.0`                 | API server host                               |
| `DATABASE_URL`      | `sqlite:./dev.db`         | Database connection URL                       |
| `JWT_SECRET`        | `change-me-in-production` | Secret key for JWT token generation           |
| `NODE_ENV`          | `development`             | Application environment                       |
| `COOKIE_SECURE`     | `false`                   | Whether cookies should be secure (HTTPS only) |
| `CORS_ORIGIN`       | `http://localhost:5173`   | CORS origin for API server                    |

### Seed Data Configuration (Optional)

| Variable                  | Default                | Description                       |
| ------------------------- | ---------------------- | --------------------------------- |
| `SEED_ORG_NAME`           | `Default Organization` | Default organization name         |
| `SEED_ORG_DISPLAY_NAME`   | Same as SEED_ORG_NAME  | Default organization display name |
| `SEED_ADMIN_USERNAME`     | `admin`                | Admin username                    |
| `SEED_ADMIN_PASSWORD`     | `admin123`             | Admin password                    |
| `SEED_ADMIN_NAME`         | `Admin`                | Admin display name                |
| `SEED_TEACHER_USERNAME`   | `teacher`              | Teacher username                  |
| `SEED_TEACHER_PASSWORD`   | `teacher123`           | Teacher password                  |
| `SEED_TEACHER_NAME`       | `Teacher`              | Teacher display name              |
| `SEED_CANDIDATE_USERNAME` | `candidate`            | Candidate username                |
| `SEED_CANDIDATE_PASSWORD` | `candidate123`         | Candidate password                |
| `SEED_CANDIDATE_NAME`     | `Candidate`            | Candidate display name            |

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

## Build

```bash
# Build all packages
pnpm build

# Build web only
pnpm --filter web build
```
