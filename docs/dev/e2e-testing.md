# E2E Testing Guide

End-to-end browser tests (Playwright + Chromium) that drive the full exam
platform stack — app API + PostgreSQL + Redis — through real HTTP and a real
browser. Specs live in `apps/e2e/e2e/*.spec.ts`.

This document is the canonical "how to run E2E" reference. For the demo-seed
data contract the specs rely on, see
[`docs/dev/demo-seed-contract.md`](./demo-seed-contract.md).

---

## TL;DR

```bash
# Canonical one-command entry (builds, starts stack, runs Playwright, cleans up)
bash scripts/e2e/run.sh

# Or, run the compose profile manually
docker compose -f docker-compose.test.yml up -d --build db redis app
docker compose -f docker-compose.test.yml --profile e2e run --rm e2e
docker compose -f docker-compose.test.yml down -v
```

Both paths bring up four services on the `exam-net` bridge network:

| Service | Image | Role |
| ------- | ----- | ---- |
| `db` | `postgres:18.4-bookworm` | PostgreSQL (migrated on app start) |
| `redis` | `redis:7-alpine` | Redis (session/cache) |
| `app` | built from repo `Dockerfile` | Fastify API; runs migrate + `RUN_SEED=e2e` on boot |
| `e2e` | `mcr.microsoft.com/playwright:v1.61.0-noble` | Playwright runner (profile-gated) |

---

## Prerequisites

- **Docker** + **Docker Compose v2** (`docker compose ...`). No local Node,
  pnpm, or Playwright/browser install is required — everything runs in
  containers.
- Free host ports: `3000` (app), `5432` (db), `6379` (redis). Override with
  `APP_PORT` / `DB_HOST_PORT` / `REDIS_HOST_PORT` (see
  [Environment variables](#environment-variables)).
- The `e2e` service installs `@playwright/test@1.61.0` at runtime
  (`npm install --no-save`), so an E2E proxy may be needed in restricted
  networks — set `E2E_PROXY`.

---

## Option A — `scripts/e2e/run.sh` (recommended)

The wrapper script orchestrates the whole flow and is the canonical entry used
by maintainers. It builds the image, starts the stack, waits for the app health
check, resolves the app container IP, runs Playwright, propagates the exit code,
and cleans up.

```bash
bash scripts/e2e/run.sh                       # run all specs in apps/e2e/e2e/
bash scripts/e2e/run.sh candidate-happy-path  # spec filename keyword match
bash scripts/e2e/run.sh resume submit-flush   # multiple keywords (OR)
bash scripts/e2e/run.sh --grep "happy path"   # Playwright title regex filter
bash scripts/e2e/run.sh --no-build            # reuse the previously built image
bash scripts/e2e/run.sh --keep                # keep stack up after the run
bash scripts/e2e/run.sh --rebuild             # force --no-cache rebuild
```

### Flags

| Flag | Effect |
| ---- | ------ |
| `--no-build` | Skip `docker compose build`; reuse the last image |
| `--rebuild` | Build with `--no-cache` |
| `--keep` | Do not tear down after the run (alias for `KEEP_STACK=1`) |
| `--grep "<pattern>"` | Pass a Playwright `--grep` title filter |

### Environment variables

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `APP_PORT` | `3000` | Host port mapped to the app container |
| `JWT_SECRET` | `e2e-test-secret` | JWT signing secret for the run |
| `E2E_PROXY` | _(empty)_ | `HTTP_PROXY`/`HTTPS_PROXY` for the e2e container's `npm install` |
| `COMPOSE_PROJECT_NAME` | `exam-e2e` | Isolate concurrent runs (each gets its own network/volumes) |
| `KEEP_STACK` | `0` | `1` = keep containers after run (same as `--keep`) |

> **Port conflict?** If `:3000`/`:5432`/`:6379` are taken, remap without editing
> the compose file:
> ```bash
> APP_PORT=3001 DB_HOST_PORT=5433 REDIS_HOST_PORT=6380 bash scripts/e2e/run.sh
> ```

---

## Option B — manual `docker compose` profile

Useful for debugging, running a single spec repeatedly, or inspecting the
running stack.

```bash
# 1. Build + start db, redis, app (app runs migrate + canonical E2E seed on boot)
docker compose -f docker-compose.test.yml up -d --build db redis app

# 2. Wait for the app health check (or poll /api/health yourself)
docker compose -f docker-compose.test.yml ps        # app shows "(healthy)"

# 3. Run Playwright via the e2e profile
docker compose -f docker-compose.test.yml --profile e2e run --rm e2e

# 4. Run a single spec (override the service command)
docker compose -f docker-compose.test.yml --profile e2e run --rm e2e \
  npx playwright test e2e/candidate-happy-path.spec.ts --reporter=list

# 5. Tear down (and wipe the DB volume for a clean reseed)
docker compose -f docker-compose.test.yml down -v
```

---

## How targeting works (important)

The Playwright browser runs **inside the `e2e` container** and reaches the app
**over the compose network**, not via `localhost`.

- `E2E_BASE_URL` is the URL the browser navigates to. In
  `docker-compose.test.yml` it is `http://examapp:3000`.
- **Why `examapp`, not the service name `app`?** Chromium's HSTS preload list
  includes the bare hostname `app` (Google's `.app` TLD is force-HTTPS), so
  `http://app:3000/` is silently upgraded to HTTPS and fails with
  `ERR_SSL_PROTOCOL_ERROR` (the app is plain HTTP). The `app` service therefore
  publishes a safe network alias `examapp`, and `E2E_BASE_URL` points at it.
  `scripts/e2e/run.sh` instead resolves the app container's IP and sets
  `E2E_BASE_URL=http://<IP>:3000` for the same reason. **Both paths work; do
  not revert `E2E_BASE_URL` to `http://app:3000`.**

---

## Seed data

E2E uses the **canonical E2E seed** (`RUN_SEED=e2e`), composed of baseline seed
+ demo seed + verification. It is applied automatically on `app` container boot
by `docker-entrypoint.sh` (after migrations). The demo accounts (password
`candidate123` / `admin123`):

| Username | Password | State |
| -------- | -------- | ----- |
| `admin` | `admin123` | Admin |
| `candidate1` | `candidate123` | `in_progress` / resume |
| `candidate2` | `candidate123` | `available` / start |
| `candidate3` | `candidate123` | `resumable` (disrupted) / resume |
| `candidate4` | `candidate123` | `graded` / view result |

The seed is **idempotent** — re-running `node dist/e2e-seed.js --skip-migrate`
inside the `app` container re-applies it without duplicating rows, which is
useful to reset demo attempt states after a manual run. For the full contract,
see [`docs/dev/demo-seed-contract.md`](./demo-seed-contract.md).

### Re-seed a running stack

```bash
docker compose -f docker-compose.test.yml exec app node dist/e2e-seed.js --skip-migrate
```

---

## Accelerated background scanners (gotcha)

`docker-compose.test.yml` **accelerates** the heartbeat and deadline scanners
so the `disconnect-restore` and `deadline-crash` specs are deterministic
without multi-minute wall-clock waits:

| Var | E2E value | Production default |
| --- | --------- | ------------------ |
| `HEARTBEAT_TIMEOUT_MS` | `15000` | `60000` |
| `HEARTBEAT_SCAN_INTERVAL_MS` | `5000` | `30000` |
| `DEADLINE_SCAN_INTERVAL_MS` | `5000` | `30000` |

These fast scanners can disturb **static** demo-seed attempts if they live long
enough (e.g. an `in_progress` demo attempt whose `lastActivityAt` is never
refreshed will flip to `disrupted` after 15s; an expired `disrupted` attempt is
auto-submitted by the deadline scanner). The demo seed and the
`demo-seed-accounts` spec are written to tolerate this (demo attempt
`deadlineAt`s are set ~2h out; the spec restores+heartbeats the `in_progress`
contract before asserting). **Production deployments keep the defaults via
`docker-compose.yml`.**

---

## CI

The `e2e` job in `.github/workflows/ci.yml` builds the app, seeds
(`db:seed:e2e`), starts the API, and runs `playwright test` with
`APP_MODE=e2e` (rate limiting disabled). It targets `http://localhost:3000`
because the app and Playwright run on the same runner host (not separate
containers), so the `app`-hostname HSTS issue does not apply there.

---

## Debugging tips

- **View app logs** while a run is in progress:
  `docker compose -f docker-compose.test.yml logs -f app`
- **Keep the stack up** to inspect the DB after a failure:
  `bash scripts/e2e/run.sh --keep`, then
  `docker compose -f docker-compose.test.yml exec db psql -U exam -d exam`
- **Traces on failure**: set `E2E_TRACE=1` (the Playwright config retains
  traces for failed tests) — e.g.
  `docker compose -f docker-compose.test.yml --profile e2e run --rm -e E2E_TRACE=1 e2e`
- **Local Playwright residue**: if you previously ran `sudo playwright install`
  locally, `apps/e2e/node_modules/playwright-core` may be root-owned and block
  `pnpm install` with `EPERM`. Clean it up (needs sudo):
  ```bash
  sudo rm -rf apps/e2e/node_modules
  pnpm install
  ```
  After that, prefer the Docker entry above — local browsers are not required.
- **`ERR_SSL_PROTOCOL_ERROR`?** The browser is hitting a hostname on Chromium's
  HSTS preload list. Keep `E2E_BASE_URL` on `examapp` (compose) or the app IP
  (`run.sh`); never `http://app:3000`. See
  [How targeting works](#how-targeting-works-important).
