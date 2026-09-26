# Port Map (live document)

Current facts only. Every host-accessible port has exactly one owning
environment variable; consumers derive, they never re-hardcode. Machine-local
conflicts are resolved by overriding the owner variable in `.env`, not by
changing product defaults.

| Mode  | Service           | Internal port | Host port owner                     | Default |
| ----- | ----------------- | ------------: | ----------------------------------- | ------: |
| dev   | API               |           n/a | `DEV_API_PORT` (API bind + Vite proxy target) | 3000 |
| dev   | Vite              |           n/a | `VITE_PORT` (also owns API dev CORS / PUBLIC_WEB_ORIGIN default) | 5173 |
| dev   | PostgreSQL Docker |          5432 | `DB_HOST_PORT` (dev compose publish + constructed dev `DATABASE_URL`) | 5432 |
| dev   | Redis Docker      |          6379 | `REDIS_HOST_PORT` (dev compose publish; point `REDIS_URL` at the same port) | 6379 |
| Docker | nginx edge       |            80 | `EXAM_PORT` (the ONLY host publish; also owns default `CORS_ORIGIN` / `PUBLIC_WEB_ORIGIN`) | 80 |
| Docker | Exam app (API)   |          3000 | internal only (`app:3000` behind the edge) | — |
| Docker | static web (SPA) |          4173 | internal only (`web:4173` behind the edge) | — |
| Docker | PostgreSQL        |          5432 | internal only (`db:5432`)            | — |
| Docker | Redis             |          6379 | internal only (`redis:6379`)         | — |

Notes:

- Vite exists only in local development. Production Docker exposes ONE port:
  `EXAM_PORT` → the nginx edge on container 80 (#585), which routes `/api/**`
  to the API (`app:3000`) and everything else to the static SPA (`web:4173`).
- Env files own one mode each: `.env` (from `.env.example`) is local
  development ONLY; `.env.deploy` (from `.env.deploy.example`, filled by
  `node scripts/generate-env.mjs`) is deployment ONLY and is read via
  `docker compose --env-file .env.deploy` (the flag replaces the default `.env`
  as Compose's interpolation file, so the dev `.env` is never read for
  deployment — host shell exports still override individual values). Dev
  tooling never reads `.env.deploy`. Tests keep their own `.env.test.local`
  (from `.env.test.example`).
- **Managed WSL E2E topology** (issue #571): The runner
  (`scripts/e2e/run.sh`) sets `COMPOSE_DISABLE_ENV_FILE=1` before any
  Compose invocation, so the developer root `.env` is intentionally ignored by
  managed E2E Compose. The runner freezes `DB_HOST_PORT`, `REDIS_HOST_PORT`,
  `TZ`, and `APP_TIMEZONE` once from shell input (or managed defaults) and
  exports them. Both the runner's URL derivation and Compose interpolation see
  the same values. Normal development (`docker compose -f docker-compose.dev.yml
  ...` without the runner) still reads root `.env` as before. To override ports
  for managed E2E, pass them as shell env vars:
  `DB_HOST_PORT=25432 bash scripts/e2e/run.sh`.
- `APP_PORT` is container-internal only ("current API process bind port",
  fixed at 3000 in every Compose file and the Dockerfile). It is never a host
  publish port; host publishing is `EXAM_PORT`.
- The API bind port is mode-owned, so a stale variable from one world cannot
  hijack the other:
  - `development` → `DEV_API_PORT` (default 3000). A leftover `APP_PORT` in a
    pre-split `.env` is deliberately ignored.
  - `production` → `APP_PORT` (default 3000) — the container identity.
  - test-like (`test`/`e2e`/`ci`) → `APP_PORT` when a container runner sets it
    (production/Docker shapes), else `DEV_API_PORT` (host-native E2E shards,
    set by `scripts/e2e/run.sh` launch_api).
- In dev, an unset `DATABASE_URL` is constructed from `DB_HOST_PORT`
  (`postgresql://exam:exam@localhost:<DB_HOST_PORT>/exam`, the
  `docker-compose.dev.yml` contract). An explicit `DATABASE_URL` (external
  PostgreSQL) always wins.
- In test-like modes, an unset `TEST_DATABASE_URL` is constructed from the
  same `DB_HOST_PORT` (`postgresql://exam:exam@localhost:<DB_HOST_PORT>/exam_test`),
  so changing `DB_HOST_PORT` once makes `pnpm test` follow too. An explicit
  `TEST_DATABASE_URL` (CI / remote DB) always wins.
- 5173 / 5432 are the conventional Vite / PostgreSQL ports. A 2026-08 WSL2 +
  Docker Desktop 4.83 probe on this repository verified both bind, forward,
  and serve end to end (including a real PostgreSQL query through host 5432
  and a Node server on 5173, reachable from both WSL and Windows). In this
  environment the historical 4173 / 15432 workaround could not be reproduced
  as a platform-level restriction, so they are not treated as inherent WSL
  limits here and were retired as defaults; the probe does not retroactively
  rule out the port conflict that originally motivated them on other machines.
