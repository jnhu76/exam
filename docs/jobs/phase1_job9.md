# Job 9: Health Check + Dashboard + Docker Compose

## Goal

Build server health check endpoint, admin dashboard with stats, basic system health monitoring page, and production-ready Docker Compose deployment with PostgreSQL.

## Scope

- Server health check endpoint (CPU, memory, DB response time)
- Admin dashboard page with stats cards
- System health monitoring page (basic, no degradation)
- Dockerfile (multi-stage: build web + serve from api)
- Docker Compose (app + PostgreSQL for production)
- Docker Compose dev variant (app + SQLite for dev/demo)
- Migration on startup strategy
- .env.example + README deploy section

## Out of Scope

- Adaptive degradation / auto-switch (Phase 2)
- WebSocket health stream (Phase 2)
- Manual degradation mode switch (Phase 2)
- Kubernetes / orchestration (Phase 2)
- HTTPS / TLS termination (handled by reverse proxy in deployment)
- Backup/restore automation (Phase 2)

## Dependencies

J8 (Score Management — dashboard shows exam/score stats)

## Files to Create / Modify

- `apps/api/src/plugins/health.ts`
- `packages/exam-engine/src/systemMonitor.ts`
- `apps/web/src/pages/admin/DashboardPage.tsx`
- `apps/web/src/pages/admin/SystemHealthPage.tsx`
- `Dockerfile`
- `.dockerignore`
- `docker-compose.yml`
- `docker-compose.dev.yml`
- `.env.example` (update with Docker-related vars)
- `README.md` (deploy section)

## Data Model Changes

None.

## API Contracts

- `GET /api/system/health` → `{ cpu: number, memory: number, dbResponseMs: number, status: "ok" | "degraded" | "critical" }`
- `GET /api/system/dashboard` → `{ totalQuestions: number, activeExams: number, totalCandidates: number, todayExams: number, recentExams: Exam[] }`

## UI Tasks

- Admin dashboard page (§3.2)
- System health page (§3.15)

## TDD Plan

- Integration: health endpoint returns correct shape and thresholds
- Integration: Docker build succeeds
- Integration: Docker Compose up starts all services
- Integration: complete login → exam → score flow works in container
- Manual: verify dashboard stats with seeded data

## Subtasks

- [ ] **9.1** Server health check endpoint
  - Acceptance: GET /api/system/health returns { cpu%, memory%, dbResponseMs, status: "ok"|"degraded"|"critical" }; basic resource monitoring with thresholds (ok=<80%, degraded=80-95%, critical=>95% for CPU/memory); dbResponseMs measured from simple query ping; no auto-switch or adaptive degradation in Phase 1
  - Files: `apps/api/src/plugins/health.ts`, `packages/exam-engine/src/systemMonitor.ts`
  - Verify: curl /api/system/health; confirm response shape with cpu, memory, dbResponseMs, status; confirm status thresholds work correctly

- [ ] **9.2** Client: admin dashboard page
  - Acceptance: 4 StatsCards showing 题目总数 / 考试进行中 / 考生总数 / 今日考试; recent exams table (exam name, status badge, participant count, actions); loading state uses Skeleton component; empty state uses EmptyState component; all user-facing strings in zh-CN
  - Files: `apps/web/src/pages/admin/DashboardPage.tsx`
  - Verify: dashboard displays correctly with seeded data; confirm 4 stats cards show accurate counts; confirm recent exams table renders; test empty state with no data; test loading skeleton state

- [ ] **9.3** Client: system health page (basic version)
  - Acceptance: 3 metric cards (CPU usage / memory usage / DB response time) with visual indicators; 10s auto-refresh interval; no degradation config UI, no event stream, no manual switch — those are Phase 2; status indicator uses color + icon dual indicators for accessibility
  - Files: `apps/web/src/pages/admin/SystemHealthPage.tsx`
  - Verify: open page and observe live data updating every 10s; confirm 3 metric cards render; confirm status indicators show ok/degraded/critical correctly with both color and icon

- [ ] **9.4** Dockerfile (Node.js + PostgreSQL)
  - Acceptance: Single Dockerfile for apps/api serving static files from apps/web build; multi-stage build: stage 1 installs deps and builds web, stage 2 copies built web assets to api public dir and runs api; production image uses node:lts-alpine; exposes port 3000; non-root user for security; runs migrations on startup before serving
  - Files: `Dockerfile`, `.dockerignore`
  - Verify: `docker build -t exam .` succeeds; `docker run -p 3000:3000 exam` starts and serves both API and frontend

- [ ] **9.5** Docker Compose (app + PostgreSQL)
  - Acceptance: docker-compose.yml defines app service + PostgreSQL service with persistent volume; .env file switches DATABASE_URL between PostgreSQL (prod) and SQLite (dev); docker-compose.dev.yml provides app + SQLite configuration for dev/demo; healthcheck configured on both services; proper network isolation; migration runs on app startup
  - Files: `docker-compose.yml`, `docker-compose.dev.yml`
  - Verify: `docker compose up` starts all services; complete login → create exam → take exam → view scores flow works end-to-end; `docker compose -f docker-compose.dev.yml up` works with SQLite; data persists across container restarts

## Acceptance Criteria

1. Health endpoint returns CPU%, memory%, dbResponseMs with correct status thresholds
2. Dashboard shows 4 stats cards + recent exams table
3. System health page auto-refreshes every 10s with color + icon indicators
4. Dockerfile multi-stage build succeeds
5. Docker Compose (prod) starts app + PostgreSQL with persistent volume
6. Docker Compose (dev) starts app + SQLite
7. Migration runs on container startup
8. Non-root user in production container
9. Complete exam flow works in Docker
10. .env.example documents all Docker-related vars
11. `pnpm typecheck` passes

## Verify Commands

```bash
pnpm typecheck
pnpm test
docker build -t exam .
docker run -p 3000:3000 exam
docker compose up
docker compose -f docker-compose.dev.yml up
curl http://localhost:3000/api/system/health
```

## Review Checklist

- [ ] Health thresholds: ok=<80%, degraded=80-95%, critical=>95%
- [ ] No adaptive degradation in Phase 1
- [ ] Dockerfile uses node:lts-alpine, non-root user
- [ ] PostgreSQL is production default, SQLite dev/demo only
- [ ] Migration runs before app serves requests
- [ ] .env.example has DATABASE_URL for both PostgreSQL and SQLite
- [ ] Docker Compose has persistent volumes for PostgreSQL
- [ ] Health check uses color + icon (not color-only) for accessibility
- [ ] No CDN or external API dependencies in Docker build
- [ ] No duplicate DTOs (types imported from `@exam/domain` or `@exam/contracts`)
- [ ] No `any` / `as any`
- [ ] No bare `db.select()` in routes (repository pattern only)
- [ ] No complex business logic in route handlers
- [ ] Repository methods receive RequestContext with organizationId
- [ ] State changes via command functions
- [ ] Errors use domain error types from `packages/domain/src/errors.ts`
- [ ] No `console.log` (use logger in api, nothing in packages)
- [ ] No unnecessary new dependencies
- [ ] `pnpm verify` passes
