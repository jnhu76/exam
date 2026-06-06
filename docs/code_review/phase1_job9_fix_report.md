# Phase 1 Job 9 — Fix Report

> Fix date: 2026-06-01
> Related review: `code_review/phase1_job9_review.md`

---

## Fixes Applied

### Fix 1: Restore unauthenticated `/api/health` for Docker healthchecks

**Problem:** Old `/api/health` was removed during review cleanup, but Docker healthchecks need an unauthenticated endpoint. `/api/system/health` requires `preHandler: [fastify.authenticate]` and returns 401 without a valid JWT cookie.

**Change:** Restored `app.get("/api/health", ...)` in `apps/api/src/server.ts` returning `{ status: "ok" }`. Updated both `docker-compose.yml` and `docker-compose.dev.yml` healthcheck URLs to use `/api/health`.

**Files:**

- `apps/api/src/server.ts` — restored endpoint
- `docker-compose.yml` — healthcheck URL
- `docker-compose.dev.yml` — healthcheck URL

---

### Fix 2: Frontend DTOs import from `@exam/contracts`

**Problem:** `DashboardPage.tsx` and `SystemHealthPage.tsx` defined local interfaces (`DashboardData`, `RecentExam`, `HealthData`) that duplicated `DashboardResponse`, `DashboardRecentExam`, and `SystemHealthResponse` from `@exam/contracts`. Violates code-quality rule §code-quality "no duplicate DTOs".

**Change:** Replaced local interfaces with imports from `@exam/contracts`. Used `SystemHealthResponse["status"]` to derive the `HealthStatus` type.

**Files:**

- `apps/web/src/pages/admin/DashboardPage.tsx` — removed local `DashboardData` and `RecentExam`, imported `DashboardResponse`
- `apps/web/src/pages/admin/SystemHealthPage.tsx` — removed local `HealthData`, imported `SystemHealthResponse`

---

### Fix 3: Dockerfile migration entrypoint

**Problem:** Spec §9.4 requires "runs migrations on startup before serving". Dockerfile had `CMD ["node", "apps/api/dist/server.js"]` with no migration step.

**Change:** Created `docker-entrypoint.sh` that runs `node apps/api/dist/scripts/migrate.js` before starting the server. Created `apps/api/src/scripts/migrate.ts` that detects `DATABASE_URL` and runs appropriate migrations (SQLite or PostgreSQL). Updated Dockerfile to use `ENTRYPOINT ["/app/docker-entrypoint.sh"]`.

**Files:**

- `docker-entrypoint.sh` — new entrypoint script
- `apps/api/src/scripts/migrate.ts` — migration runner
- `Dockerfile` — changed CMD to ENTRYPOINT

---

### Fix 4: `docker-compose.dev.yml` network config

**Problem:** Production `docker-compose.yml` had `exam-net` network and proper isolation. Dev compose had no network configuration.

**Change:** Added `exam-net` network to `docker-compose.dev.yml`.

**Files:**

- `docker-compose.dev.yml` — added networks section

---

### Fix 5: PostgreSQL runtime support (C1)

**Problem:** `dbPlugin` threw an error when `DATABASE_URL` pointed to PostgreSQL. `systemStatsRepo` only accepted `SqliteDatabase`. Production deployment with PostgreSQL was impossible.

**Change:**

- `dbPlugin`: accepts both SQLite and PostgreSQL; casts PG db to `SqliteDatabase` for the Fastify decorator
- `packages/db/src/types.ts`: new file defining `AnyDatabase = SqliteDatabase | PostgresDatabase`
- `packages/db/src/repository/systemStatsRepo.ts`: accepts `AnyDatabase`, branches on `isSqlite()` at runtime — SQLite uses `.all()/.get()`, PG uses `.execute()`
- `apps/api/src/routes/system.ts`: casts `fastify.db` to `AnyDatabase` when passing to `systemStatsRepo`
- `packages/db/src/seed.ts`: accepts `AnyDatabase`, throws if not SQLite
- `packages/db/src/sqlite.ts`: re-exports `SqliteDatabase` from `types.ts`

**Files:**

- `apps/api/src/plugins/db.ts` — accepts both DB types
- `packages/db/src/types.ts` — new shared type definitions
- `packages/db/src/repository/systemStatsRepo.ts` — dual-database support
- `apps/api/src/routes/system.ts` — type cast for systemStatsRepo
- `packages/db/src/seed.ts` — accepts `AnyDatabase` with SQLite guard
- `packages/db/src/sqlite.ts` — re-exports from types.ts

---

## Verification

```bash
$ pnpm typecheck
Tasks:    14 successful, 14 total

$ pnpm test
Tasks:    14 successful, 14 total
  @exam/api: 96 tests passed
  @exam/web: 100 tests passed
  @exam/exam-engine: 86 tests passed
  @exam/db: 22 tests passed
  @exam/auth: 8 tests passed
```

---

## Known Limitations (not fixed, deferred)

| ID  | Description                                      | Deferral Reason                        |
| --- | ------------------------------------------------ | -------------------------------------- |
| N2  | `getRecentExams` hardcodes `participantCount: 0` | Needs JOIN on examEnrollments; Phase 2 |
| N3  | Sidebar duplicate key `/admin/exams`             | Pre-existing issue, not J9             |
