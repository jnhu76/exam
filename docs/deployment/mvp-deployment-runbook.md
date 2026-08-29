# MVP Deployment & Operations Runbook

> **Authority:** canonical deployment and operations document for the
> implemented MVP subset (single deployment / single default organization /
> Admin + Teacher + Candidate MVP roles / `timed_window` exams / objective +
> manual grading / result publication / Inbox + Email outbox / PostgreSQL
> Email worker / LAN-on-premise).
>
> **Companion documents:**
>
> - [`docs/audits/P6-MVP-READY-REALITY-AUDIT.md`](../audits/P6-MVP-READY-REALITY-AUDIT.md)
>   — release-readiness audit (acceptance matrix, finding register, evidence).
> - [`docs/adr/ADR-011-notification-and-email-delivery.md`](../adr/ADR-011-notification-and-email-delivery.md)
>   — Notification and Email architecture authority.
> - [`docs/architecture/email-config.md`](../architecture/email-config.md)
>   — Email configuration operational guide.
> - [`docs/adr/ADR-001-redis.md`](../adr/ADR-001-redis.md) — Redis decision
>   (optional in the implemented MVP).
> - [`docs/deployment/upgrade-and-uninstall.md`](./upgrade-and-uninstall.md)
>   — operator upgrade & uninstall lifecycle (canonical guide).
>
> **Scope:** LAN/on-premise, single-tenant. Do NOT use this runbook for any
> multi-tenant, cloud, or Phase 4 deployment — those modes are not
> implemented.

---

## 1. Prerequisites

```text
Hardware:  single host (LAN/on-premise). Single-instance operation.
           Multi-instance deployment is NOT supported by the implemented MVP
           (the in-process scanners and admission queue assume one API owner).
OS:        Linux (Docker host). Windows/macOS via Docker Desktop acceptable
           for evaluation only.
Software:  Docker Engine ≥ 25.x, Docker Compose v2.
Network:   internal LAN only. The platform must remain offline-capable.
           TLS is delegated to a reverse proxy (nginx/caddy) in front of the
           API when the deployment needs HTTPS — the app does not terminate
           TLS itself.
Postgres:  provided by the 'db' service (postgres:18.4-bookworm). The
           bundled docker-compose.yml composes DATABASE_URL for the app
           from POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB, so the
           bundled 'db' service is REQUIRED for the supported MVP path.
           External Postgres is NOT a supported MVP deployment — DATABASE_URL
           is composed, not read from an external source. Do NOT remove the
           'db' service.
Redis:     OPTIONAL — a bare 'docker compose up' starts no Redis and needs
           no Redis configuration (P7 review P1). When enabled (the 'redis'
           profile, P6-010), Redis owns the shared rate-limit state (P7):
           production requires REDIS_PASSWORD — the redis container refuses
           to start without it — plus an authenticated REDIS_URL (P7 review
           P1-1). See §10.
SMTP:      OPTIONAL. Leave EMAIL_ENABLED=false to drain the outbox to 'sent'
           status without external delivery. Set EMAIL_ENABLED=true +
           EMAIL_TRANSPORT=smtp + SMTP_* to enable real Email delivery.
Backups:   operator-supplied pg_dump schedule against the 'pgdata' volume
           (see §11).
```

---

## 2. Environment variables

Deployment and development settings are SEPARATE files:

- `.env.deploy` (from `.env.deploy.example`, filled by
  `node scripts/generate-env.mjs`) — deployment only. Compose reads it via the
  explicit `--env-file .env.deploy` flag; passing the flag replaces the default
  `.env` as Compose's interpolation file, so the dev `.env` is never read for
  deployment (host shell environment variables can still override individual
  values). Every `docker compose` command in this runbook includes it.
- `.env` (from `.env.example`) — local development only. No dev tooling
  (`pnpm dev` / Vite / Drizzle / vitest) ever reads `.env.deploy`, and no
  deployment secret ever lands in `.env`.

Set the production-required values in `.env.deploy`. The
bundled `docker-compose.yml` uses Compose `${VAR:?...}` required-expansion
for the production-required variables below — Compose itself fails to start
if any is unset. There is NO default database password in production
(P6-007).

### Production-required (Compose `${VAR:?...}` expansion fails if unset)

| Variable | Purpose | Validation |
|---|---|---|
| `POSTGRES_PASSWORD` | Database superuser password; composed into `DATABASE_URL` for the API | required, no default (P6-007) — generate with `node scripts/generate-env.mjs` |
| `JWT_SECRET` | Signs the `auth-token` cookie JWT | non-empty; no default in production — generate with `node scripts/generate-env.mjs` |
| `DATABASE_URL` | PostgreSQL connection for the API | composed by Compose from `POSTGRES_*`; set explicitly only when using external Postgres |

### Optional (with safe defaults)

| Variable | Default | Notes |
|---|---|---|
| `CORS_ORIGIN` | `http://localhost:<EXAM_PORT>` | Browser origin allowlist (credentials:true); comma-separated → array. The Compose default follows the host port; override for LAN/hostname access |
| `PUBLIC_WEB_ORIGIN` | `http://localhost:<EXAM_PORT>` | Used to build Email action links; validated as absolute origin (scheme+host[+port], no path). The Compose default follows the host port; override for LAN/hostname access; HTTPS recommended in production |
| `EXAM_PORT` | 3000 | Host published port (`${EXAM_PORT:-3000}:3000`); the container API stays on 3000 (`APP_PORT` is container-internal only). Local dev uses `DEV_API_PORT` instead — see docs/development/ports.md |
| `HOST` | 0.0.0.0 | API bind host |
| `APP_MODE` | development | `production` enables CSRF, HSTS, Secure cookie, fail-fast required env |
| `NODE_ENV` | development | maps to production/test/development |
| `DEPLOYMENT_MODE` | singleTenant | `multiTenant` is rejected at boot (Phase 4 only) |
| `COOKIE_SECURE` | false (auto-true in production) | cookie Secure flag |
| `APP_TIMEZONE` / `TZ` | Asia/Shanghai | display/log/diagnostics only; does not change business-time comparison semantics |
| `REDIS_URL` | unset (disabled) | optional; see §10 (enable with `--profile redis`; authenticated URL required) |
| `REDIS_PASSWORD` | unset (redis profile disabled) | optional at Compose parse time — a bare `docker compose up` needs no Redis config (P7 review P1); REQUIRED when the `redis` profile is enabled: the redis container refuses to start without it and runs with `requirepass` (P7 review P1-1) |
| `HEARTBEAT_SCAN_INTERVAL_MS` / `HEARTBEAT_TIMEOUT_MS` | 30000 / 60000 | in-process heartbeat scanner |
| `DEADLINE_SCAN_INTERVAL_MS` | (inherits HEARTBEAT) | in-process deadline scanner |
| `RATE_LIMIT_*` | 100 / 60000 / disabled in e2e | IP-keyed rate limiter; Redis-backed shared state when the `redis` profile is enabled and the runtime is ready — local in-memory fallback only in `optional` mode; `required` mode fails closed with 503 `RATE_LIMIT_UNAVAILABLE` (never falls back to local). See §10 |

### Email (in-process outbox loop + sender)

| Variable | Default | Notes |
|---|---|---|
| `EMAIL_ENABLED` | false | master switch; false → DisabledEmailSender drains outbox to 'sent' |
| `EMAIL_TRANSPORT` | fake | `fake` or `smtp`; `smtp` is force-overridden to `fake` in test/e2e/ci |
| `EMAIL_FAKE_MODE` | success | `success` or `failure` (fake transport only) |
| `EMAIL_FROM` | `no-reply@example.local` | Email From header |
| `EMAIL_FROM_NAME` | Exam Platform | Email From name |
| `EMAIL_MAX_ATTEMPTS` | 3 | max attempts before `dead` |
| `EMAIL_RETRY_BASE_SECONDS` | 60 | exponential backoff base (base * 2^(attempts-1)) |
| `EMAIL_WORKER_POLL_INTERVAL_MS` | 5000 | outbox loop poll interval |
| `EMAIL_WORKER_BATCH_SIZE` | 20 | max rows per poll |
| `EMAIL_WORKER_LOCK_TIMEOUT_MS` | 300000 (5 min) | abandoned-lock recovery threshold |
| `EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS` | 8000 | SIGTERM bound for the in-process loop; rows left `processing` are redelivered via lock-timeout recovery. One term of the shutdown budget contract: loop (8s) + audit drain (10s) + DB close (10s) must stay below `stop_grace_period` (45s) |
| `EMAIL_WORKER_HEARTBEAT_STALE_MS` | 60000 | diagnostics staleness threshold |
| `EMAIL_FAKE_DELAY_MS` | 0 | fake-transport only: simulated send latency (tests/deployment rehearsal) |

### SMTP (only when `EMAIL_TRANSPORT=smtp`)

| Variable | Default | Notes |
|---|---|---|
| `SMTP_HOST` | (empty) | **required** when transport=smtp (fail-fast) |
| `SMTP_PORT` | 587 | |
| `SMTP_SECURE` | false | strict bool |
| `SMTP_REQUIRE_TLS` | true | strict bool |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | true | strict bool; warns but does not hard-fail if false |
| `SMTP_TLS_SERVERNAME` | (empty) | optional SNI servername |
| `SMTP_CONNECTION_TIMEOUT_MS` / `SMTP_GREETING_TIMEOUT_MS` / `SMTP_SOCKET_TIMEOUT_MS` | 10000 each | |
| `SMTP_USER` / `SMTP_PASSWORD` | (empty) | auth block omitted if both empty; password is scrubbed from logs/errors |

> **dotenv gotcha:** dotenv does NOT overwrite inherited `process.env`. Stale
> shell `EMAIL_*` / `SMTP_*` values silently override `.env.deploy`. Use
> `env -u EMAIL_ENABLED -u SMTP_HOST ... docker compose --env-file .env.deploy up`
> to start cleanly
> when a stale shell env is suspected.

---

## 3. First installation

```bash
# 1. Clone and enter the repository
git clone <repo-url> exam && cd exam

# 2. Configure the deployment environment. The generator creates .env.deploy
#    from .env.deploy.example and fills the empty JWT_SECRET and
#    POSTGRES_PASSWORD with random values (an existing value is never
#    rotated). To set secrets manually instead:
#    cp .env.deploy.example .env.deploy, then set both (openssl rand -hex 32).
node scripts/generate-env.mjs

# 3. (Optional) Enable real Email delivery — edit .env.deploy:
# EMAIL_ENABLED=true
# EMAIL_TRANSPORT=smtp
# SMTP_HOST=smtp.your-org.internal
# SMTP_USER=...
# SMTP_PASSWORD=...

# 4. Pull and start the default stack (app + db) from the
#    prebuilt release image. Compose runs the image pinned in .env.deploy
#    as EXAM_IMAGE, which step 2 derived from .release-version (see
#    "Image acquisition" below). No local build happens; Redis is NOT
#    started by default (P6-010); see §10 to enable it.
docker compose --env-file .env.deploy up -d

# 5. Watch the API come up (migration runs inside the container entrypoint).
docker compose --env-file .env.deploy logs --tail=50 -f app
# Look for: 'Running database migrations...', 'Server listening at http://0.0.0.0:3000'

# 6. Verify app + db are healthy. The in-process email outbox loop waits for
#    the first organization to be bootstrapped (step 7).
docker compose --env-file .env.deploy ps
# Expected: app (healthy), db (healthy)
```

`CORS_ORIGIN` / `PUBLIC_WEB_ORIGIN` default to `http://localhost:3000`; set
them in `.env.deploy` to your machine's address for LAN access.

# 7. Bootstrap the first Admin (production path — see §5). This also
#    creates the internal default organization, which unblocks the in-process
#    email outbox loop.
#    Two equivalent paths share one canonical atomic mutation body:
#
#    (a) CLI fallback (operator path):
docker compose --env-file .env.deploy exec app \
  node dist/scripts/bootstrap-admin.js \
  --username admin --password '<STRONG_OPERATOR_PASSWORD>' \
  --name 'System Admin' --organization-name 'My Organization'
#
#    (b) Launchpad first-install page (browser path): set
#        LAUNCHPAD_SETUP_TOKEN=<openssl rand -hex 32> in .env BEFORE step 4,
#        then navigate to http://<host>:<EXAM_PORT>/launchpad and complete
#        the first-Admin setup form. Once initialized, /launchpad redirects
#        to /login and never reopens. See backup-and-recovery.md §8.

# 8. The in-process outbox loop detects the new organization, resolves it,
#    and starts polling without restarting. Verify:
docker compose --env-file .env.deploy logs --tail=20 app
# Look for: 'resolved default organization',
#           'in-process email outbox loop started'
```

> **First-boot bootstrap-pending state (expected):** on a fresh migrated
> database the in-process outbox loop cannot resolve the internal default
> organization until `bootstrap-admin` creates it. The loop does not crash
> the API: it writes a `bootstrap_pending` heartbeat and sleeps until the
> organization appears. This is the documented first-boot behavior, NOT a
> defect. Once bootstrap creates the org (step 7), the loop resolves it and
> starts polling. The `app` and `db` services are healthy throughout; only
> email consumption is gated on the org existing.

The image ENTRYPOINT is `docker-entrypoint.sh`: it runs
`node dist/scripts/migrate.js` once on boot, then `exec node dist/server.js`.
The app container is the SOLE migration owner and the sole outbox consumer
(#320 CONVERGE — the duplicate worker migrate path and its
`app: service_healthy` serialization were removed with the dedicated
container).

### Image acquisition (#321)

The `app` service runs the **prebuilt release image**
pinned in `.env.deploy` as `EXAM_IMAGE`. `node scripts/generate-env.mjs`
derives the pin from the repository's `.release-version`
(`ghcr.io/jnhu76/exam:vX.Y.Z`); an explicit non-canonical `EXAM_IMAGE`
value wins (private registry mirrors, offline loads), while a canonical
`ghcr.io/jnhu76/exam:vX.Y.Z` pin follows `.release-version` on the next
generate-env run (the upgrade path). The image is published automatically
by the release workflow (`.github/workflows/release.yml`) when the release
tag is cut — same commit as the GitHub Release, the enforced-immutable git
tag, and a `sha-<commit>` alias tag. There is deliberately NO `latest` tag;
the semantic-version pin is the authority. Compose `${EXAM_IMAGE:?...}`
refuses to start the stack when the pin is missing. If the pinned tag has
not been published yet, use the source-build path below.

#### Online pull (default)

`docker compose --env-file .env.deploy up -d` pulls the pinned image once
(outbound access to ghcr.io at install/upgrade time only); afterwards the
image is cached locally and the platform runtime has no network dependency.

Two one-time registry facts (maintainer side, not per-install):

- **First publish creates a PRIVATE GHCR package** even though the
  repository is public. After the first release, flip
  `ghcr.io/jnhu76/exam` to Public in GitHub → Packages → package settings
  (one-way); until then anonymous operator pulls fail with an opaque
  403/denied. The release closeout must verify an anonymous pull works.
- Published images are **linux/amd64**. On other architectures use the
  source-build path below.

#### Offline / air-gapped transfer

On any machine with registry access:

```bash
docker pull ghcr.io/jnhu76/exam:vX.Y.Z
docker save ghcr.io/jnhu76/exam:vX.Y.Z | gzip > exam-image-vX.Y.Z.tar.gz
sha256sum exam-image-vX.Y.Z.tar.gz   # record; verify after transfer
```

Transfer the archive (plus the repository checkout, for
`generate-env.mjs`) by removable media, then on the air-gapped host:

```bash
sha256sum exam-image-vX.Y.Z.tar.gz                 # must match
docker load < exam-image-vX.Y.Z.tar.gz
node scripts/generate-env.mjs                      # derives the same EXAM_IMAGE
docker compose --env-file .env.deploy up -d        # local image, no pull
```

Keep the loaded reference identical to `EXAM_IMAGE` — Compose matches by
reference, not digest.

#### Contributor source build (not the operator path)

Contributors and PR acceptance verify THIS checkout by merging the build
override; the deployment acceptance suites (`tests/deployment/`) always
merge it via their compose wrapper:

```bash
docker compose --env-file .env.deploy \
  -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

The override pins `exam-local:dev` with `pull_policy: build`, forcing a
build from the current tree and never pulling a registry image under that
tag.

---

## 4. Migration

Migrations are managed by drizzle-kit (`packages/db/drizzle.config.ts`). The
production migration entrypoint is `node dist/scripts/migrate.js`, run once
by the `app` container's `docker-entrypoint.sh` before
`node dist/server.js`. There is exactly ONE migration runner since #320
CONVERGE (the former duplicate worker self-migrate path is gone), so the
P6-009 serialization concern no longer arises in the default deployment:

```text
db healthy → app entrypoint migrates → API binds + becomes healthy
           → in-process outbox loop starts (after bootstrap)
```

```bash
# Run migrations manually (rarely needed; containers do this automatically)
docker compose --env-file .env.deploy exec app node dist/scripts/migrate.js

# Inspect the drizzle journal. NOTE: $POSTGRES_USER / $POSTGRES_DB are
# expanded INSIDE the db container (the postgres image exports them as
# env vars), not by the host shell — so wrap the psql call in sh -c and
# run it via 'docker compose exec db'.
docker compose --env-file .env.deploy exec db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM drizzle.__drizzle_migrations;"'

# Inspect table count
docker compose --env-file .env.deploy exec db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'
```

**Failed migration recovery:** inspect the drizzle journal for the last
applied migration; re-running migrate is safe. If the schema is corrupted,
restore from the latest `pg_dump` backup (§11) and re-run migrate.

---

## 5. Bootstrap admin (production)

The first admin account is created by the **production bootstrap CLI**
(`dist/scripts/bootstrap-admin.js`), NOT the baseline dev/test seed. The
baseline seed (`packages/db/src/seed.ts`) ships known default credentials
(admin/admin123, candidate/candidate123) and refuses to run when
`APP_MODE=production` (P6-008). It must not be used as the production
bootstrap path.

```bash
# Production first-Admin bootstrap (P6-008). Run once against a fresh
# migrated database. The password is ALWAYS explicitly supplied; there is
# no default.
docker compose --env-file .env.deploy exec app \
  node dist/scripts/bootstrap-admin.js \
  --username admin \
  --password '<STRONG_OPERATOR_PASSWORD>' \
  --name 'System Admin' \
  --organization-name 'My Organization'
```

The bootstrap:

1. locates the internal organization with slug `default`; if it does not
   exist, creates it (using `--organization-name` or the documented
   non-secret default `Default Organization`);
2. creates the first Admin with the explicit `--password` (hashed; never
   stored plaintext);
3. creates the primary Admin role assignment;
4. writes an `admin.bootstrap` audit row (actor `system`).

Steps 1–4 run in **one transaction** (`bootstrapAdminOnFreshDb`): they
commit atomically, so a failure in any step leaves no orphan org, user,
assignment, or audit row. The bootstrap also refuses a second active Admin
unless `--force` is supplied.

It does **not** create Candidate accounts. Candidates are created later by
the Admin via `POST /api/admin/candidates`.

### Optional CLI arguments

```text
--username <admin-username>             (required)
--password '<strong-password>'          (required, never defaulted)
--name '<display-name>'                 (required)
--organization-name '<org-name>'        (optional; default 'Default Organization')
--organization-display-name '<name>'    (optional; falls back to org name)
--force                                 (allow a second active Admin)
```

### Reset admin password later (without re-seeding)

```bash
docker compose --env-file .env.deploy exec app node dist/scripts/reset-admin-password.js
```

### Dev/test seed (NOT for production)

The baseline seed is dev/test infrastructure only. It is run by the
Compose entrypoint when `RUN_SEED=1` (or `RUN_SEED=e2e` for the canonical
E2E seed) is set **in the `.env` file** (per the shell > `.env.local` >
`.env` precedence contract — do NOT pass it as a shell-only override, which
would silently bypass the operator's `.env`). It refuses to run when
`APP_MODE=production`. For full demo data (courses, questions, exams,
attempts), use `pnpm db:seed:demo` against the dev DB only — never against
the production DB.

> **Custom seed credentials** (optional, dev/test only): `SEED_ORG_NAME`,
> `SEED_ORG_DISPLAY_NAME`, `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`,
> `SEED_CANDIDATE_*`. Set in `.env` before the first seed. These are
> ignored in production (the seed refuses to run).

---

## 6. Start services

```bash
# Normal start (default stack: app + db; Redis is optional — §10)
docker compose --env-file .env.deploy up -d

# Verify
docker compose --env-file .env.deploy ps
# Expected: app (healthy), db (healthy)

# API health (liveness — process alive)
curl -s http://localhost:${EXAM_PORT:-3000}/api/health
# Expected: {"status":"ok"}

# Admin-only system health (DB ping + CPU/memory)
# (requires authentication; obtain the auth-token cookie via the login page)
curl -s -b "auth-token=<JWT>" http://localhost:${EXAM_PORT:-3000}/api/system/health
# Expected: {"cpu":..,"memory":..,"dbResponseMs":..,"status":"ok"}
```

Service dependency ordering is enforced by Compose `depends_on` with
`condition: service_healthy`. Migration ordering (P6-009) is serialized by
chaining these dependencies — the drizzle migration journal tracks state,
it does NOT lock concurrent runners:

```text
default topology (#320 CONVERGE):
  db (healthy) ← app (healthy)
                  ↑ app entrypoint runs migrate before binding

optional redis profile (--profile redis):
  db (healthy) ← app
  redis (healthy)   # NOT a dependency of app (P6-010)
```

The scanners (heartbeat + deadline) AND the email outbox delivery loop run
**in-process** inside the `app` container — there is no separate worker or
scanner service (#320 CONVERGE removed the dedicated email-worker
container). Their liveness is covered by the `app` healthcheck and surfaced
in `/api/system/diagnostics`.

---

## 7. Verify health

The implemented MVP separates **liveness** from **readiness**:

| Endpoint | Auth | Purpose | What it checks |
|---|---|---|---|
| `GET /api/health` | none | Liveness probe (Compose healthcheck, dependency ordering) | process alive only |
| `GET /api/system/health` | admin (`SystemHealthView`) | Readiness / DB availability | DB ping latency + CPU/memory |
| `GET /api/system/diagnostics` | admin (`SystemDiagnosticsView`) | Operational diagnostics | DB latency, Redis (if configured), scanner metrics, outbox loop heartbeat, outbox backlog, oldest pending age, dead rows |
| `GET /api/system/info` | none | Version + uptime | n/a |
| `GET /api/system/public-config` | none | Public config (deployment mode, feature flags) | n/a |

The Compose `app` healthcheck polls `GET /api/health` every 30s (5s timeout,
3 retries, 30s start period). The healthcheck has two roles:

```text
healthcheck:
  - marks the container healthy / unhealthy (visible via 'docker compose ps',
    'docker inspect', and Compose UI);
  - no other service depends on app health since #320 CONVERGE removed the
    email-worker service (the guard exists for future dependent services).
```

A healthcheck does **not**, by itself, restart a still-running container.
The `restart: unless-stopped` policy restarts the `app` container only when
its process **exits**. These are independent mechanisms:

```text
healthcheck = marks container health + gates dependent startup
restart     = restarts the container when the process exits, per policy
```

Do not conflate them. A container can be `unhealthy` and still running
(restart policy does not fire); a container that exits is restarted per the
policy regardless of its last health state. To force-restart an unhealthy
container, an operator must `docker compose restart app` (or use an external
watchdog that reads health state and restarts explicitly). The MVP ships no
such watchdog — the runbook documents the manual `docker compose restart`
recovery path.

**Health does not claim `ready` when a required dependency is unusable:**
`/api/system/health` reflects the DB ping, and the outbox loop's `emailStatus`
gates on dead rows + heartbeat staleness. Optional delivery degradation
(`EMAIL_ENABLED=false`) does not falsely break core availability —
`emailStatus.status` correctly reports `disabled` rather than `unavailable`.

---

## 8. Email outbox loop (in-process)

The email outbox delivery loop runs **inside the `app` container** as a
Fastify plugin (`plugins/emailOutboxLoop.ts`, #320 CONVERGE). It is the
**only** consumer of the PostgreSQL `email_outbox` table that identity and
notification flows write into. It reuses the exact poll body of the former
standalone worker (ADR-011): durable outbox, `FOR UPDATE SKIP LOCKED`
claiming, retry/backoff, lock-timeout recovery, at-least-once delivery, and
a PostgreSQL heartbeat — so diagnostics are unchanged.

```bash
# The loop starts automatically with 'docker compose up -d'. Verify.
# Use the native --tail flag (not a pipe) so failure context is preserved.
docker compose --env-file .env.deploy logs --tail=20 app
# Look for:
#   'resolved default organization'
#   'in-process email outbox loop started' (pollIntervalMs, batchSize,
#    lockTimeoutMs, enabled)

# Inspect the loop heartbeat (admin-only)
curl -s -b "auth-token=<JWT>" http://localhost:${EXAM_PORT:-3000}/api/system/diagnostics \
  | jq .emailStatus
# Expected fields: status, enabled, worker.{status,lastPollAt,lastSuccessAt,
#                  lastErrorAt,lastError}, outbox.{pending,processing,
#                  retryWait,sent,dead}, oldestPendingAge,
#                  lastSuccessfulDeliveryAt
```

The loop:

- polls every `EMAIL_WORKER_POLL_INTERVAL_MS` (default 5s),
- claims up to `EMAIL_WORKER_BATCH_SIZE` rows atomically
  (`SELECT … FOR UPDATE SKIP LOCKED` + `UPDATE … RETURNING`),
- finalizes each row (markSent / markRetryWait / markDead), all
  ownership-fenced on `locked_by`,
- writes a heartbeat row to `worker_heartbeats` every poll cycle,
- recovers abandoned processing rows at the top of every poll cycle
  (`recoverAbandoned`),
- is supervised: a loop crash (e.g. a database hiccup) is retried after the
  poll interval with an error heartbeat instead of crashing the API,
- shuts down bounded: on SIGTERM the loop stops within
  `EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS` (default 8s); rows still `processing`
  are redelivered via lock-timeout recovery (documented at-least-once).

With `EMAIL_ENABLED=false` (default), `DisabledEmailSender` drains outbox
rows to `sent` status without any network call. This **does not** prove
external mailbox delivery.

---

## 9. Run scanner

The scanner is **not a separate process**. It runs as in-process Fastify
plugins inside the `app` container:

- `apps/api/src/plugins/heartbeat.ts` — detects disconnected candidates and
  marks their attempts `disrupted`.
- `apps/api/src/plugins/deadlineScanner.ts` — auto-submits attempts whose
  deadline has expired.

Both scanners are `unref()`'d so they do not keep the process alive. They
are single-instance by design (no distributed lock) — the implemented MVP
assumes a single API process.

```bash
# Inspect scanner metrics (admin-only)
curl -s -b "auth-token=<JWT>" http://localhost:${EXAM_PORT:-3000}/api/system/diagnostics \
  | jq '.heartbeatStatus, .deadlineScannerStatus'
# Expected: interval, timeout, lastScanAt, disruptedCount / autoSubmitCount
```

Scanner tuning env vars: `HEARTBEAT_SCAN_INTERVAL_MS`,
`HEARTBEAT_TIMEOUT_MS`, `DEADLINE_SCAN_INTERVAL_MS`. Changes require an
`app` container restart (`docker compose restart app`).

---

## 10. Redis (optional profile)

**Redis is OPTIONAL** in the implemented MVP (ADR-001). When enabled it owns
ONE production responsibility: the **shared rate-limit state** (P7 — first
real business adoption). PostgreSQL remains the exam fact authority; Redis
holds only ephemeral coordination state:

- Email delivery queue = PostgreSQL `email_outbox` (frozen by ADR-011).
- Inbox persistence = PostgreSQL `notifications` (frozen by ADR-011).
- Admission queue = in-process / DB-backed (ADR-001).
- Shared rate limiter = Redis when `REDIS_MODE=optional|required` and the
  runtime is `ready`; local in-memory store when Redis is off or
  optional-degraded (per-process best-effort — no strict global N while
  degraded); fail closed (503 `RATE_LIMIT_UNAVAILABLE`) in `required` mode.
- Session/JWT = stateless cookie + JWT (no Redis session store).

The default topology is `app + db`. The `redis` Compose
service is gated behind the `redis` profile (P6-010): a bare
`docker compose up` does NOT start it, and the `app` service does NOT
depend on redis health. The API defaults `REDIS_URL` to empty (disabled).
Diagnostics reports `redisStatus.connected=false` when Redis is
unconfigured — this is expected and does not degrade the MVP path.

### Enabling the optional Redis profile

Production Redis MUST be authenticated (P7 review P1-1): the redis
container refuses to start without a non-empty `REDIS_PASSWORD` (startup
guard) and the server runs with `requirepass`. The check lives at
container startup, not Compose expansion, so a bare `docker compose up`
without the profile needs no Redis configuration (P7 review P1). Set both
the password and the authenticated URL:

```bash
# 1. In .env (production):
#    REDIS_PASSWORD=<secret>
#    REDIS_URL=redis://:<same-secret>@redis:6379
#    (URL-encode the password if it contains reserved characters)

# 2. Start the stack with the redis profile:
docker compose --env-file .env.deploy --profile redis up -d

# 3. Verify all four services:
docker compose --env-file .env.deploy ps
# Expected: app (healthy), db (healthy), redis (healthy)
```

The `redis` service exists for the optional shared rate limiter and
forward-compatibility with the Phase 2 baseline (ADR-001). Enabling it does
NOT move Inbox or Email queues to Redis — those remain PostgreSQL-backed
(frozen by ADR-011).

Redis becomes `REQUIRED` (`REDIS_MODE=required`) only when a documented,
measured trigger is met (multi-instance, strict global rate limit,
distributed presence, cross-process scanner coordination, persistent
admission queue). **None of these triggers is met by the implemented MVP
subset; `REDIS_MODE=required` is an explicit operator choice for
deployments that need strict shared limits.**

---

## 11. Perform smoke test

After first install:

```bash
# 1. API liveness
curl -s http://localhost:${EXAM_PORT:-3000}/api/health

# 2. Public config
curl -s http://localhost:${EXAM_PORT:-3000}/api/system/public-config

# 3. Admin login via the web UI (https://exam.your-org.internal/login)
#    Log in with the seeded admin credentials.

# 4. In the admin console:
#    - Create a Candidate
#    - Create or import a Course
#    - Create or import Questions
#    - Create a timed_window Exam
#    - Enroll the Candidate
#    - Publish and open the Exam

# 5. Candidate logs in via the web UI, takes the exam, submits.
#    Verify objective grading completes and the result is visible.

# 6. Admin publishes manual results.
#    Verify the Candidate sees the Inbox badge, can open the notification,
#    and that it navigates to the authoritative frozen result page.

# 7. (If EMAIL_ENABLED=true) Verify the outbox loop drained the queue:
curl -s -b "auth-token=<JWT>" http://localhost:${EXAM_PORT:-3000}/api/system/diagnostics \
  | jq .emailStatus.outbox
#    Expect sent to increase; pending/processing to return to 0.

# 8. Inspect the audit log for the publication event.
```

For a full automated end-to-end smoke (Playwright), use
`pnpm e2e:docker` (Docker lifecycle) or `bash scripts/e2e/run-wsl.sh` (WSL
host lifecycle) in a non-production stack. **Never** run E2E against the
production database.

---

## 12. Normal shutdown

```bash
# Graceful shutdown: SIGTERM is propagated to each container.
docker compose --env-file .env.deploy stop    # stops containers without removing them
# or
docker compose --env-file .env.deploy down    # stops and removes containers (keeps data)
# or
docker compose --env-file .env.deploy down -v # with bind mounts there are no named
                       # volumes, so -v removes NOTHING extra — data under
                       # ./data/* (PGDATA, Redis dir, backup spools) is
                       # retained either way. Deleting data is an explicit
                       # rm — see upgrade-and-uninstall.md §3.2.
```

Graceful shutdown behavior (#351 budget contract):

```text
app container (SIGTERM, stop_grace_period: 45s):
  - auditWrites.stopAccepting() (no new audit writes accepted)
  - app.close() runs onClose hooks serially in reverse registration order:
    - email outbox loop stops: waits up to EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS
      (default 8s) for the current poll cycle, then abandons it
    - sender / scanners / redis close
    - in-flight audit writes drain (10s timeout, best-effort, overlapping)
    - DB pool released (sql.end, 10s timeout)
  - whole-shutdown worst case: 8s + 10s + 10s + 2s (bounded exit assist)
    = 30s < stop_grace_period 45s
  - exit is then NATURAL on the clean path; if work abandoned by the
    bounded shutdown (the in-flight send) still holds the event loop, a
    bounded assist (2s) logs the remaining owners and exits with the
    settled code — never a Docker SIGKILL
  - any processing row left behind is recovered by the next app start
    via recoverAbandoned after EMAIL_WORKER_LOCK_TIMEOUT_MS (default 300s)
```

A container exit code of **137 after `docker stop` is a FAILURE**, not
normal: it means Docker SIGKILLed the app because graceful shutdown
exceeded the grace period (budget regression — enforced by
`scripts/repository-contract/deployment-topology-contract.mjs`).

---

## 13. Restart / recovery

```bash
# Restart a single service
docker compose --env-file .env.deploy restart app
docker compose --env-file .env.deploy restart db
docker compose --env-file .env.deploy restart redis       # optional profile; not started by default
                                    # (P6-010 / ADR-001)

# Stuck Email processing recovery
# The outbox loop recovers abandoned rows at the top of every poll cycle
# after EMAIL_WORKER_LOCK_TIMEOUT_MS (default 300s). To force immediate
# recovery, restart the app:
docker compose --env-file .env.deploy restart app

# Dead Email inspection (admin-only via psql). $POSTGRES_USER / $POSTGRES_DB
# are expanded INSIDE the db container (postgres image env), not by the
# host shell — wrap in sh -c.
docker compose --env-file .env.deploy exec db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT id, recipient_user_id, subject, attempt_count, last_error, created_at, last_attempt_at FROM email_outbox WHERE status = '\''dead'\'';"'

# Replay a dead Email (advanced — inspect last_error first)
# ⚠️  This re-attempts delivery. Confirm the recipient and content first.
docker compose --env-file .env.deploy exec db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE email_outbox SET status='\''pending'\'', locked_at=NULL, locked_by=NULL, next_attempt_at=now(), last_error=NULL WHERE id = '\''<UUID>'\'';"'

# Stale loop heartbeat
# /api/system/diagnostics emailStatus.worker.status=degraded when
# now - last_poll_at > EMAIL_WORKER_HEARTBEAT_STALE_MS (default 60s).
# Restart the app:
docker compose --env-file .env.deploy restart app

# Failed migration. Use the native --tail flag instead of a pipe so failure
# context is preserved.
docker compose --env-file .env.deploy logs --tail=100 app
# Re-running migrate is idempotent:
docker compose --env-file .env.deploy exec app node dist/scripts/migrate.js
# If schema is corrupted, restore from backup (§11 backup/restore) and
# re-run migrate.

# Admin password reset
docker compose --env-file .env.deploy exec app node dist/scripts/reset-admin-password.js

# Candidate interrupted attempt
# REC-I3 implements direct-entry candidate restore: the Web client calls the
# explicit restore command and reloads the authoritative take snapshot.
# ADR-013 recovery policy is implemented: strict is the default and
# bounded_grace follows the frozen caps. Admin operator time grants are a
# separate audited command; use the Dashboard action only when the Attempt's
# frozen policy is operator_incident.

# Log / requestId investigation
docker compose --env-file .env.deploy logs app | jq 'select(.reqId == "<REQ_ID>")'
```

---

## 14. Log and diagnostics lookup

All logs are pino JSON to stdout. Every request log carries `reqId`. The
API redacts sensitive fields via a `REDACT_CONFIG`; SMTP passwords are
additionally scrubbed by `sanitizeEmailError`.

```bash
# Tail all services
docker compose --env-file .env.deploy logs -f

# Filter by service
docker compose --env-file .env.deploy logs -f app

# Filter by request id (JSON log)
docker compose --env-file .env.deploy logs app | jq 'select(.reqId == "req-42")'

# Filter by log level
docker compose --env-file .env.deploy logs app | jq 'select(.level >= 40)'   # warn and above

# Live diagnostics (admin-only)
watch -n 5 'curl -s -b "auth-token=<JWT>"
  http://localhost:${EXAM_PORT:-3000}/api/system/diagnostics | jq'
```

Diagnostic fields (see `GET /api/system/diagnostics`):

```text
version, uptime
dbLatency                         — PostgreSQL ping latency
redisStatus.{connected,latencyMs} — conditional on Redis being configured
heartbeatStatus                   — in-process heartbeat scanner metrics
deadlineScannerStatus             — in-process deadline scanner metrics
emailStatus.status                — overall: available / degraded / disabled
emailStatus.worker                — worker heartbeat (last_poll_at, last_success_at,
                                    last_error_at, last_error)
emailStatus.outbox                — pending / processing / retry_wait / sent / dead
emailStatus.oldestPendingAge      — seconds, or null
emailStatus.lastSuccessfulDeliveryAt — timestamp, or null
config                            — heartbeatInterval / heartbeatTimeout / deadlineScanInterval
```

---

## 15. Upgrade checklist

> **Canonical lifecycle guide:** see
> [`upgrade-and-uninstall.md`](./upgrade-and-uninstall.md) — supported
> path, version-skipping policy, rollback contract, and the uninstall
> guide (preserve vs. full removal) live there, with the executable
> evidence suite. The checklist below is the operator's short form.

```text
[ ] Read CHANGELOG / release notes for breaking changes (version-skip
    restrictions / db major bumps are always announced there).
[ ] Back up the database (logical dump — backup-and-recovery.md §7).
[ ] Pull the new code: git pull.
[ ] Run pnpm verify:static locally.
[ ] Re-pin the image: .env.deploy EXAM_IMAGE follows .release-version on
    the next `node scripts/generate-env.mjs` run (a canonical
    ghcr.io/jnhu76/exam:vX.Y.Z pin is re-derived; an explicit mirror
    value must be updated by hand), then pull it:
    docker compose --env-file .env.deploy pull.
[ ] docker compose --env-file .env.deploy up -d (migrate runs on app start).
[ ] Watch migration logs: docker compose --env-file .env.deploy logs app
    | grep -i migrat.
[ ] Verify /api/health and /api/system/health; log in as an existing Admin;
    open a candidate + a recent result.
[ ] Rollback (if needed): restore the pre-upgrade backup + redeploy the
    previous image tag (upgrade-and-uninstall.md §2.5 — a canonical
    EXAM_IMAGE pin follows .release-version on the next generate-env run,
    so edit .env.deploy AFTER it, or pin by digest).
```

Migrations are forward-only by default. drizzle-kit does not auto-generate
down migrations. Rollback is via DB restore from backup.

---

## 16. Known limitations

See `docs/audits/P6-MVP-READY-REALITY-AUDIT.md` §23 (accepted limitations)
and §24 (deferred capabilities). Highlights:

```text
- Frontend candidate disrupted-recovery UI IS productized (REC-I3, PR #219):
  self-service restore from the `canResume` snapshot capability, with
  restoring/failed/retry states and authoritative snapshot reload. The
  Admin operator time-grant action is also productized (REC-I4-I3B2): it uses
  an Attempt-scoped API with a frozen operation ID and authoritative refresh.
  Admin/Proctor recovery centers, REC-I6 incident authority, and Proctor time
  grants remain open. (Older P6-era docs list this as not-productized — that
  predates REC-I3 / REC-I4-I3B2.)
- Multi-instance deployment is NOT supported (in-process scanners + admission
  queue assume a single API owner).
- timed_sync / untimed timing modes NOT implemented (only timed_window).
- Queue admission (requireQueue + batchSize + batchInterval) NOT operationally wired.
- IP/CIDR exam restrictions, device binding, single-session enforcement NOT implemented.
- multiTenant / SuperAdmin / organizationSlug login NOT implemented (Phase 4).
- pass-to-proceed API / service tokens / API keys / webhooks NOT implemented (Phase 4).
- Staff invitation / SMTP password reset / account recovery UI NOT implemented
  (Phase 3 product work).
- Additional NotificationType values beyond result_published NOT implemented
  (P5-N2 future).
- Email template engine + backend i18n NOT started.
- Generic final-answer submit barrier — ADR-008 Option D (answer-type-independent) NOT implemented.
- Live backup validation (pg_dump/restore) was not executed in the P6 audit;
  this runbook documents the supported procedure. Validate on first
  production deploy.
```

---

## 17. Backup / export (operator-supplied)

> **Canonical backup & recovery authority:** see
> [`docs/deployment/backup-and-recovery.md`](./backup-and-recovery.md). That
> guide documents the supported C1 cold-filesystem backup/restore and
> relocation procedures in full. The summary below is retained for
> runbook-local context.

Authoritative state is the PostgreSQL data directory under
`${EXAM_DATA_ROOT:-./data}/postgres` (a host bind mount since P7-C1; the
former `pgdata` named volume is gone). **Host persistence is not backup** —
a copy on the same failing disk is a weak local copy, not disaster recovery.

### C1 cold-filesystem backup (validated)

The simplest full backup: stop Exam cleanly, copy the COMPLETE postgres
directory to an off-host destination, restart. Use the helper scripts,
which preserve ownership/mode/symlinks and refuse unsafe paths:

```bash
# Stop Exam first (PostgreSQL must be STOPPED — a live copy is corrupt-prone).
# The source is the deployment's EXAM_DATA_ROOT (default ./data):
docker compose --env-file .env.deploy down
scripts/backup/cold-filesystem-backup.sh \
  "${EXAM_DATA_ROOT:-./data}" \
  /mnt/nas/exam-backups/$(date +%Y%m%d)
docker compose --env-file .env.deploy up -d
```

Restore into a fresh data root, then start Exam with the same PostgreSQL
major version and the same DB credentials:

```bash
scripts/backup/cold-filesystem-restore.sh /mnt/nas/exam-backups/<date> /opt/exam/data-fresh
EXAM_DATA_ROOT=/opt/exam/data-fresh POSTGRES_PASSWORD=<same> docker compose up -d
```

Both procedures were validated by an automated suite
(`tests/deployment/persistence-and-cold-restore.sh`) that proves a
fresh working Exam deployment with identical authoritative state is
produced from the backup. See backup-and-recovery.md §6.

### pg_dump logical backup and clean restore (validated by C2)

The C2 logical path is the recommended routine backup (PostgreSQL stays
online). It was validated by an automated suite
(`tests/deployment/logical-backup-restore.sh`) that proves a fresh
working Exam with State A is produced from a State-A dump, with State-B-only
data correctly absent — closing the P7-C0 P2-2/P2-3 gaps. The clean-restore
contract (DROP + recreate from template0, then `pg_restore`) is enforced by
`scripts/backup/postgres-logical-restore.sh`. See
`docs/deployment/backup-and-recovery.md` §7.

```bash
# Online logical backup (PostgreSQL stays ONLINE; API may be down):
scripts/backup/postgres-logical-backup.sh exam /mnt/nas/exam-logical/$(date +%Y%m%d).dump

# Clean restore (STOP the API first; script requires typing target DB name):
docker compose --env-file .env.deploy stop app
scripts/backup/postgres-logical-restore.sh exam /mnt/nas/exam-logical/<date>.dump exam
docker compose --env-file .env.deploy up -d app

# P7-E2B — record the restore drill in the product ledger after restart
# (the restore script prints the exact command with its measured duration):
docker compose --env-file .env.deploy exec app node dist/scripts/backup-evidence.js drill \
  --operation-id logical-restore:$(date +%F) --backup-type logical \
  --result succeeded --source operator_declared --duration-ms <ms>
```

The P7-C scripts record durable evidence of every run into the product
ledger (`backup_runs` etc.) at their natural checkpoints — see
`backup-and-recovery.md` §0.5. The `postgres-logical-backup.sh` and
`pg-basebackup.sh` scripts record start/completion automatically (completion
is a hard gate: a verified artifact whose evidence cannot be recorded fails
the script loudly rather than silently vanishing from the product view).
Cold-filesystem backups spool evidence and are imported after restart via
`backup-evidence.js cold-import --spool <path>`.

The older `pg_dump --clean --if-exists | psql` one-liner is retained below
for reference, but the clean-target contract above is the supported path
(`--clean --if-exists` into a dirty target does NOT remove dump-absent
objects):

```bash
# Backup (online, consistent). $POSTGRES_USER / $POSTGRES_DB are expanded
# INSIDE the db container (postgres image env), not by the host shell —
# wrap pg_dump in sh -c. The dump stream is captured on the host.
docker compose --env-file .env.deploy exec -T db sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists' \
  > backup_$(date +%Y%m%d_%H%M%S).sql

# Verify backup is non-empty and ends with completion
ls -lh backup_*.sql
tail -5 backup_*.sql   # should contain 'PostgreSQL database dump complete'

# Restore (offline — stop the API first to avoid writes during restore).
# Feed the host-side dump file into the db container's psql.
# NOTE: --clean --if-exists drops objects present in the dump, but does NOT
# remove objects that exist in the target DB yet are absent from an older
# dump. For an EXACT historical replacement, recreate/clean the target
# database under an explicit restore contract (C2 restore drill).
docker compose --env-file .env.deploy stop app
docker compose --env-file .env.deploy exec -T db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < backup_YYYYMMDD_HHMMSS.sql
docker compose --env-file .env.deploy up -d app
```

For larger deployments, prefer the C2 logical backup (`scripts/backup/postgres-logical-backup.sh`,
which produces a `pg_dump -Fc` artifact and is verified by a clean-restore
drill) for routine backups. Physical `pg_basebackup`, continuous WAL
archiving, and PITR are now implemented (P7-C3): see
[`docs/deployment/backup-and-recovery.md`](backup-and-recovery.md) §8 for
the pg_basebackup script, the canonical `scripts/backup/postgres-enable-pitr.sh`
WAL-archiving command (there is no PITR Compose file — PITR is a database
capability configured via `ALTER SYSTEM`, not an alternate Docker topology),
the PITR procedure, retention contract, and drill evidence. Schedule backups
via cron on the Docker host — the platform does not ship a backup scheduler
(a control plane is a P7-E concern, not started).
