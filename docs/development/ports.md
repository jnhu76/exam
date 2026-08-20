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
| dev   | Redis Docker      |          6379 | fixed dev-infra publish (`docker-compose.dev.yml`) | 6379 |
| Docker | Exam app         |          3000 | `EXAM_PORT` (host publish; also owns default `CORS_ORIGIN` / `PUBLIC_WEB_ORIGIN`) | 3000 |
| Docker | PostgreSQL        |          5432 | internal only (`db:5432`)            | — |
| Docker | Redis             |          6379 | internal only (`redis:6379`)         | — |

Notes:

- Vite exists only in local development. Production Docker serves the compiled
  SPA and the API through the same Exam app port (`EXAM_PORT` → container 3000).
- Env files own one mode each: `.env` (from `.env.example`) is local
  development ONLY; `.env.deploy` (from `.env.deploy.example`, filled by
  `node scripts/generate-env.mjs`) is deployment ONLY and is read via
  `docker compose --env-file .env.deploy` (the flag replaces the default `.env`
  as Compose's interpolation file, so the dev `.env` is never read for
  deployment — host shell exports still override individual values). Dev
  tooling never reads `.env.deploy`. Tests keep their own `.env.test.local`
  (from `.env.test.example`).
- `APP_PORT` is container-internal only ("current API process bind port",
  fixed at 3000 in every Compose file and the Dockerfile). It is never a host
  publish port; host publishing is `EXAM_PORT`.
- The API bind port is mode-owned, so a stale variable from one world cannot
  hijack the other:
  - `development` → `DEV_API_PORT` (default 3000). A leftover `APP_PORT` in a
    pre-split `.env` is deliberately ignored.
  - `production` → `APP_PORT` (default 3000) — the container identity.
  - test-like (`test`/`e2e`/`ci`) → `APP_PORT` when a container runner sets it
    (Docker E2E), else `DEV_API_PORT` (WSL E2E shards).
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
