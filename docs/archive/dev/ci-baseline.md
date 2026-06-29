# CI Baseline

This document records the CI infrastructure baseline for the exam platform. It serves as the single source of truth for CI configuration decisions and is the reference for future optimization work.

## Runtime versions

| Component | Version | Source |
|-----------|---------|--------|
| Node.js | 24.15.x | `actions/setup-node@v6` with `node-version: "24.15.x"` |
| pnpm | 11 | `pnpm/action-setup@v6` with `version: "11"` (also `packageManager: pnpm@11.1.2` in root `package.json`) |
| PostgreSQL | 18.4-bookworm | GitHub Actions service container (`postgres:18.4-bookworm`) |
| Redis | 7-alpine | GitHub Actions service container (`redis:7-alpine`) — verify job only |
| Turbo | 2.9.16 | `turbo` in monorepo, invoked via `pnpm` scripts |

## CI job structure

```
push / PR → master

  ┌────────────┐
  │   static   │  format · lint · typecheck (DB-free, ~1 min)
  └─────┬──────┘
        │
  ┌─────┴─────┐
  │           │
  ▼           ▼
┌─────────┐ ┌─────────┐
│ verify  │ │  e2e    │
│ PG+Redis│ │ PG      │
└─────────┘ └─────────┘
```

- `static` gates both `verify` and `e2e`.
- `verify` and `e2e` run in parallel after `static` passes.
- Each job owns its own service containers (isolated PG databases, isolated Redis).
- `verify` runs coverage + integration tests + build.
- `e2e` runs Playwright end-to-end tests against a real API server.

### Job details

| Job | Timeout | Services | Key steps |
|-----|---------|----------|-----------|
| `static` | 10 min | none | `pnpm verify:static` (format, lint, copy, arch, typecheck) |
| `verify` | 15 min | PG 18.4, Redis 7 | coverage, integration, build |
| `e2e` | 20 min | PG 18.4 | build, migrate, seed, start server, Playwright |

## Turborepo remote cache

Remote cache is configured at the workflow level:

```yaml
env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: ${{ vars.TURBO_TEAM }}
```

- `TURBO_TOKEN` — stored in GitHub Secrets (Bearer token for Vercel Remote Cache).
- `TURBO_TEAM` — stored in GitHub Repository Variables (team slug; using `vars` instead of `secrets` keeps the slug visible in CI logs rather than censored).
- Both secrets/vars must be configured in the repository settings for cache to be active. If absent, turbo falls back to local cache only (graceful degradation).

## Local baseline

| Metric | Value |
|--------|-------|
| `pnpm verify` (cached) | ~27.2 s |
| `pnpm verify` (cold, no cache) | ~150 s |
| API tests | 651 |
| DB tests | 163 |
| `pnpm verify:static` | format + lint + copy + arch + typecheck |

## PR / master strategy

- **PR**: pushes and PRs to `master` trigger the full CI pipeline (`static` → `verify` + `e2e`).
- **Concurrency**: same-workflow runs on the same ref cancel in-progress runs (`cancel-in-progress: true`).
- **No branch-specific filtering**: all jobs run on every push/PR. There is no PR-fast / master-full split yet (see "Future optimizations").

## Coverage

Coverage currently runs inside the `verify` job as part of `pnpm coverage`. It covers all packages (web, auth, domain, contracts, exam-engine, import-export via turbo; db/api via vitest `--coverage`). Coverage is not a separate job.

## Local Docker setup (for local testing)

```bash
docker run -d --name exam-pg -p 5432:5432 \
  -e POSTGRES_USER=exam -e POSTGRES_PASSWORD=exam -e POSTGRES_DB=exam_test \
  postgres:18.4-bookworm

docker run -d --name exam-redis -p 6379:6379 redis:7-alpine
```

Then run tests with:

```bash
REDIS_URL=redis://127.0.0.1:6379 \
DATABASE_URL=postgresql://exam:exam@localhost:5432/exam_test \
pnpm coverage
```

## Future optimizations (not yet implemented)

These are documented for awareness, not as current work items:

- **PR fast test / master full verify**: skip heavy coverage on PRs, run full verify only on master merge.
- **PG version matrix**: test against multiple PostgreSQL versions (e.g., 16, 17, 18).
- **Vitest sharding**: split test suites across parallel runners for faster wall-clock time.
- **Affected-only CI**: run only packages changed in a PR (currently all packages always run).
- **Redis in e2e**: add Redis service to e2e job if e2e tests need Redis-backed features.

## Service container health checks

Both PG and Redis use GitHub Actions service container health checks with `--health-cmd`, `--health-interval`, `--health-timeout`, and `--health-retries` options. Steps that depend on the service wait for the health check to pass before proceeding.

| Service | Health check | Interval | Timeout | Retries |
|---------|-------------|----------|---------|---------|
| PostgreSQL | `pg_isready -U exam -d <db>` | 5 s | 3 s | 10 |
| Redis | `redis-cli ping` | 5 s | 3 s | 10 |

## Files

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | CI pipeline definition |
| `docs/dev/ci-baseline.md` | This document |
| `docs/dev/redis-baseline.md` | Redis plugin architecture and test isolation |
| `docs/dev/test-suite-taxonomy.md` | Test suite structure and naming |
