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
  `node scripts/generate-env.mjs`) is deployment ONLY and is read exclusively
  via `docker compose --env-file .env.deploy` (passing the flag makes Compose
  ignore `.env` entirely, and no dev tooling reads `.env.deploy`). Tests keep
  their own `.env.test.local` (from `.env.test.example`).
- `APP_PORT` is container-internal only ("current API process bind port",
  fixed at 3000 in every Compose file and the Dockerfile). It is never a host
  publish port; host publishing is `EXAM_PORT`.
- In dev, the API resolves its bind port as `APP_PORT ?? DEV_API_PORT ?? 3000`
  (Compose/E2E runners set `APP_PORT`; a bare `pnpm dev` uses `DEV_API_PORT`).
- In dev, an unset `DATABASE_URL` is constructed from `DB_HOST_PORT`
  (`postgresql://exam:exam@localhost:<DB_HOST_PORT>/exam`, the
  `docker-compose.dev.yml` contract). An explicit `DATABASE_URL` (external
  PostgreSQL) always wins.
- 5173 / 5432 are the conventional Vite / PostgreSQL ports. A 2026-08 WSL2 +
  Docker Desktop 4.83 probe on this repository verified both bind, forward,
  and serve end to end (including a real PostgreSQL query through host 5432
  and a Node server on 5173, reachable from both WSL and Windows); the old
  4173 / 15432 workaround ports are not platform-necessary and were retired.
