# Exam Platform

LAN/on-premise exam and assessment platform. Multi-tenant, auto-graded, supports open-book quizzes and strict proctored exams.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start all services (API + Web) in development mode
pnpm dev
```

This starts:
- **Web** (Vite): http://localhost:5173
- **API** (Fastify): http://localhost:3000

The web dev server proxies `/api/*` requests to the API server automatically.

## Development Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all services in dev mode (hot reload) |
| `pnpm --filter web dev` | Start only the web frontend |
| `pnpm --filter api dev` | Start only the API server |
| `pnpm test` | Run all tests |
| `pnpm --filter web test` | Run web tests only |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint all packages |
| `pnpm verify` | Full verification: format + lint + typecheck + test + build |

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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | `""` (proxy) | API base URL for the web client |
| `APP_PORT` | `3000` | API server port |
| `HOST` | `0.0.0.0` | API server host |

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
