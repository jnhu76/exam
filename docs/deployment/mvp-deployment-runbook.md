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
           bundled docker-compose.yml composes DATABASE_URL for app and
           email-worker from POSTGRES_USER / POSTGRES_PASSWORD /
           POSTGRES_DB, so the bundled 'db' service is REQUIRED for the
           supported MVP path. External Postgres is NOT a supported MVP
           deployment — the worker's DATABASE_URL is composed, not read
           from an external DATABASE_URL. Do NOT remove the 'db' service.
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

Copy `.env.example` → `.env` and set the production-required values. The
bundled `docker-compose.yml` uses Compose `${VAR:?...}` required-expansion
for the production-required variables below — Compose itself fails to start
if any is unset. There is NO default database password in production
(P6-007).

### Production-required (Compose `${VAR:?...}` expansion fails if unset)

| Variable | Purpose | Validation |
|---|---|---|
| `POSTGRES_PASSWORD` | Database superuser password; composed into `DATABASE_URL` for the API and worker | required, no default (P6-007) |
| `JWT_SECRET` | Signs the `auth-token` cookie JWT; also required by the worker's runtime-config loader | non-empty; no default in production |
| `CORS_ORIGIN` | Browser origin allowlist (credentials:true) | comma-separated → array |
| `PUBLIC_WEB_ORIGIN` | Used to build Email action links; validated as absolute origin (scheme+host[+port], no path) | HTTPS recommended in production; never derived from `request.headers.host` |
| `DATABASE_URL` | PostgreSQL connection for API + worker | composed by Compose from `POSTGRES_*`; set explicitly only when using external Postgres |

### Optional (with safe defaults)

| Variable | Default | Notes |
|---|---|---|
| `APP_PORT` | 3000 | API listen port |
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

### Email (worker + sender)

| Variable | Default | Notes |
|---|---|---|
| `EMAIL_ENABLED` | false | master switch; false → DisabledEmailSender drains outbox to 'sent' |
| `EMAIL_TRANSPORT` | fake | `fake` or `smtp`; `smtp` is force-overridden to `fake` in test/e2e/ci |
| `EMAIL_FAKE_MODE` | success | `success` or `failure` (fake transport only) |
| `EMAIL_FROM` | `no-reply@example.local` | Email From header |
| `EMAIL_FROM_NAME` | Exam Platform | Email From name |
| `EMAIL_MAX_ATTEMPTS` | 3 | worker max attempts before `dead` |
| `EMAIL_RETRY_BASE_SECONDS` | 60 | exponential backoff base (base * 2^(attempts-1)) |
| `EMAIL_WORKER_POLL_INTERVAL_MS` | 5000 | worker poll loop |
| `EMAIL_WORKER_BATCH_SIZE` | 20 | max rows per poll |
| `EMAIL_WORKER_LOCK_TIMEOUT_MS` | 300000 (5 min) | abandoned-lock recovery threshold |
| `EMAIL_WORKER_HEARTBEAT_STALE_MS` | 60000 | diagnostics staleness threshold |

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
> shell `EMAIL_*` / `SMTP_*` values silently override `.env`. Use
> `env -u EMAIL_ENABLED -u SMTP_HOST ... docker compose up` to start cleanly
> when a stale shell env is suspected.

---

## 3. First installation

```bash
# 1. Clone and enter the repository
git clone <repo-url> exam && cd exam

# 2. Configure environment (copy template, edit production-required values)
cp .env.example .env
# Edit .env:
#   POSTGRES_PASSWORD=<STRONG_DB_PASSWORD>   # REQUIRED (P6-007, no default)
#   JWT_SECRET=<GENERATE_A_LONG_RANDOM_SECRET>      # REQUIRED
#   CORS_ORIGIN=https://exam.your-org.internal      # REQUIRED
#   PUBLIC_WEB_ORIGIN=https://exam.your-org.internal # REQUIRED
#   (the bundled Compose composes DATABASE_URL from POSTGRES_*)
#   (REDIS_URL is optional — leave unset to disable Redis; see §10)

# 3. (Optional) Enable real Email delivery
# EMAIL_ENABLED=true
# EMAIL_TRANSPORT=smtp
# SMTP_HOST=smtp.your-org.internal
# SMTP_USER=...
# SMTP_PASSWORD=...

# 4. Build and start the default stack (app + db + email-worker).
#    Redis is NOT started by default (P6-010); see §10 to enable it.
docker compose up -d --build

# 5. Watch the API come up (migration runs inside the container entrypoint).
#    Use the native --tail flag instead of a pipe so failure context is kept.
docker compose logs --tail=50 -f app
# Look for: 'Running database migrations...', 'Server listening at http://0.0.0.0:3000'

# 6. Verify app + db are healthy. The email-worker starts after app health
#    and waits for the first organization to be bootstrapped (step 7).
docker compose ps
# Expected: app (healthy), db (healthy), email-worker (up)

# 7. Bootstrap the first Admin (production path — see §5). This also
#    creates the internal default organization, which unblocks the worker.
docker compose exec app \
  node dist/scripts/bootstrap-admin.js \
  --username admin --password '<STRONG_OPERATOR_PASSWORD>' \
  --name 'System Admin' --organization-name 'My Organization'

# 8. The same worker container detects the new organization, resolves it,
#    and enters its poll loop without restarting. Verify:
docker compose logs --tail=20 email-worker
# Look for: 'resolved default organization', 'starting poll loop'
```

> **First-boot worker bootstrap-pending state (expected):** on a fresh
> migrated database the `email-worker` cannot resolve the internal default
> organization until `bootstrap-admin` creates it. Instead of exiting and
> relying on Compose restart, the worker stays `Up`, writes a
> `bootstrap_pending` heartbeat, and sleeps until the organization appears.
> This is the documented first-boot behavior, NOT a defect. Once bootstrap
> creates the org (step 7), the same worker container resolves it and
> enters its poll loop. The `app` and `db` services are healthy regardless;
> only the worker's ability to consume email is gated on the org existing.

The Dockerfile builds the app + email-worker from the same image. The
`docker-entrypoint.sh` runs `node dist/scripts/migrate.js` once on first
boot of the `app` container, then `exec node dist/server.js`. The
`email-worker` container runs `node dist/workers/emailDeliveryWorker.js`
directly. The worker depends on `app: service_healthy`, so its startup
self-migrate call is serialized strictly AFTER the app's migrate call
(P6-009: the drizzle journal tracks state; it is NOT a concurrency lock).

---

## 4. Migration

Migrations are managed by drizzle-kit (`packages/db/drizzle.config.ts`). The
production migration entrypoint is `node dist/scripts/migrate.js`, which is
run:

1. By the `app` container's `docker-entrypoint.sh` before `node dist/server.js`.
2. By the `email-worker` container's startup (the worker calls
   `migratePostgres(db)` before its poll loop).

**Migration ordering (P6-009):** the drizzle migration journal tracks
applied state; it is NOT a distributed lock and does NOT serialize
concurrent migration runners. To avoid racing the app container's migrate
call, the `email-worker` service declares `depends_on: app: condition:
service_healthy`, so the required startup sequence is:

```text
db healthy → app entrypoint migrates → API binds + becomes healthy
           → email-worker starts → worker's migratePostgres re-run
           → worker poll loop starts
```

Both paths are idempotent (re-running migrate emits a NOTICE that the
journal schema already exists and exits 0), but the Compose dependency
chain is what serializes them — not the journal.

```bash
# Run migrations manually (rarely needed; containers do this automatically)
docker compose exec app node dist/scripts/migrate.js

# Inspect the drizzle journal. NOTE: $POSTGRES_USER / $POSTGRES_DB are
# expanded INSIDE the db container (the postgres image exports them as
# env vars), not by the host shell — so wrap the psql call in sh -c and
# run it via 'docker compose exec db'.
docker compose exec db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM drizzle.__drizzle_migrations;"'

# Inspect table count
docker compose exec db sh -c \
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
docker compose exec app \
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
docker compose exec app node dist/scripts/reset-admin-password.js
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
# Normal start (default stack: app + db + email-worker; Redis is optional — §10)
docker compose up -d

# Verify
docker compose ps
# Expected: app (healthy), db (healthy), email-worker (up)

# API health (liveness — process alive)
curl -s http://localhost:${APP_PORT:-3000}/api/health
# Expected: {"status":"ok"}

# Admin-only system health (DB ping + CPU/memory)
# (requires authentication; obtain the auth-token cookie via the login page)
curl -s -b "auth-token=<JWT>" http://localhost:${APP_PORT:-3000}/api/system/health
# Expected: {"cpu":..,"memory":..,"dbResponseMs":..,"status":"ok"}
```

Service dependency ordering is enforced by Compose `depends_on` with
`condition: service_healthy`. Migration ordering (P6-009) is serialized by
chaining these dependencies — the drizzle migration journal tracks state,
it does NOT lock concurrent runners:

```text
default topology:
  db (healthy) ← app (healthy) ← email-worker
                  ↑ app entrypoint runs migrate before binding

optional redis profile (--profile redis):
  db (healthy) ← app
  redis (healthy)   # NOT a dependency of app (P6-010)
```

The scanner (heartbeat + deadline) runs **in-process** inside the `app`
container — there is no separate scanner service. The scanner's liveness is
covered by the `app` healthcheck and surfaced in `/api/system/diagnostics`.

---

## 7. Verify health

The implemented MVP separates **liveness** from **readiness**:

| Endpoint | Auth | Purpose | What it checks |
|---|---|---|---|
| `GET /api/health` | none | Liveness probe (Compose healthcheck, dependency ordering) | process alive only |
| `GET /api/system/health` | admin (`SystemHealthView`) | Readiness / DB availability | DB ping latency + CPU/memory |
| `GET /api/system/diagnostics` | admin (`SystemDiagnosticsView`) | Operational diagnostics | DB latency, Redis (if configured), scanner metrics, email worker heartbeat, outbox backlog, oldest pending age, dead rows |
| `GET /api/system/info` | none | Version + uptime | n/a |
| `GET /api/system/public-config` | none | Public config (deployment mode, feature flags) | n/a |

The Compose `app` healthcheck polls `GET /api/health` every 30s (5s timeout,
3 retries, 30s start period). The healthcheck has two roles:

```text
healthcheck:
  - marks the container healthy / unhealthy (visible via 'docker compose ps',
    'docker inspect', and Compose UI);
  - supports dependency ordering: services that declare
    'depends_on: app: condition: service_healthy' (currently the
    email-worker) wait for the app healthcheck to pass before starting.
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
`/api/system/health` reflects the DB ping, and the worker's `emailStatus`
gates on dead rows + heartbeat staleness. Optional delivery degradation
(`EMAIL_ENABLED=false`) does not falsely break core availability —
`emailStatus.status` correctly reports `disabled` rather than `unavailable`.

---

## 8. Run Email worker

The `email-worker` Compose service runs the resident Email delivery worker
(ADR-011). It is the **only** consumer of the PostgreSQL `email_outbox` table
that `result_published` notifications write into.

```bash
# The worker starts automatically with 'docker compose up -d'. Verify.
# Use the native --tail flag (not a pipe) so failure context is preserved.
docker compose logs --tail=20 email-worker
# Look for:
#   'email delivery worker starting'
#   'resolved default organization'
#   'creating email sender' (enabled:false / true, transport:fake / smtp)
#   'starting poll loop' (pollIntervalMs, batchSize, lockTimeoutMs)

# Inspect the worker heartbeat (admin-only)
curl -s -b "auth-token=<JWT>" http://localhost:${APP_PORT:-3000}/api/system/diagnostics \
  | jq .emailStatus
# Expected fields: status, enabled, worker.{status,lastPollAt,lastSuccessAt,
#                  lastErrorAt,lastError}, outbox.{pending,processing,
#                  retryWait,sent,dead}, oldestPendingAge,
#                  lastSuccessfulDeliveryAt
```

The worker:

- polls every `EMAIL_WORKER_POLL_INTERVAL_MS` (default 5s),
- claims up to `EMAIL_WORKER_BATCH_SIZE` rows atomically
  (`SELECT … FOR UPDATE SKIP LOCKED` + `UPDATE … RETURNING`),
- finalizes each row (markSent / markRetryWait / markDead), all
  ownership-fenced on `locked_by`,
- writes a heartbeat row to `worker_heartbeats` every poll cycle,
- recovers abandoned processing rows at the top of every poll cycle
  (`recoverAbandoned`).

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
curl -s -b "auth-token=<JWT>" http://localhost:${APP_PORT:-3000}/api/system/diagnostics \
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

The default topology is `app + db + email-worker`. The `redis` Compose
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
docker compose --profile redis up -d --build

# 3. Verify all four services:
docker compose ps
# Expected: app (healthy), db (healthy), redis (healthy), email-worker (up)
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
curl -s http://localhost:${APP_PORT:-3000}/api/health

# 2. Public config
curl -s http://localhost:${APP_PORT:-3000}/api/system/public-config

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

# 7. (If EMAIL_ENABLED=true) Verify the worker drained the outbox:
curl -s -b "auth-token=<JWT>" http://localhost:${APP_PORT:-3000}/api/system/diagnostics \
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
docker compose stop    # stops containers without removing them
# or
docker compose down    # stops and removes containers (keeps volumes)
# or
docker compose down -v # DANGEROUS: also removes pgdata + redisdata volumes
                       # (destroys all data — only for clean reinstall)
```

Graceful shutdown behavior:

```text
app container (SIGTERM):
  - auditWrites.stopAccepting() (no new audit writes accepted)
  - drain in-flight audit writes (10s timeout, best-effort)
  - app.close() (releases DB pool, Redis client if configured, sender)
email-worker container (SIGTERM):
  - finish current poll cycle (no new claim)
  - sender.close() (SmtpEmailSender closes the pooled transporter)
  - sql.end() (close DB connection)
  - exit 0
  - any processing row left behind is recovered by the next worker start
    via recoverAbandoned after EMAIL_WORKER_LOCK_TIMEOUT_MS (default 300s)
```

---

## 13. Restart / recovery

```bash
# Restart a single service
docker compose restart app
docker compose restart email-worker
docker compose restart db
docker compose restart redis       # optional profile; not started by default
                                    # (P6-010 / ADR-001)

# Stuck Email processing recovery
# The worker recovers abandoned rows at the top of every poll cycle after
# EMAIL_WORKER_LOCK_TIMEOUT_MS (default 300s). To force immediate recovery,
# restart the worker:
docker compose restart email-worker

# Dead Email inspection (admin-only via psql). $POSTGRES_USER / $POSTGRES_DB
# are expanded INSIDE the db container (postgres image env), not by the
# host shell — wrap in sh -c.
docker compose exec db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT id, recipient_user_id, subject, attempt_count, last_error, created_at, last_attempt_at FROM email_outbox WHERE status = '\''dead'\'';"'

# Replay a dead Email (advanced — inspect last_error first)
# ⚠️  This re-attempts delivery. Confirm the recipient and content first.
docker compose exec db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE email_outbox SET status='\''pending'\'', locked_at=NULL, locked_by=NULL, next_attempt_at=now(), last_error=NULL WHERE id = '\''<UUID>'\'';"'

# Stale worker heartbeat
# /api/system/diagnostics emailStatus.worker.status=degraded when
# now - last_poll_at > EMAIL_WORKER_HEARTBEAT_STALE_MS (default 60s).
# Restart the worker:
docker compose restart email-worker

# Failed migration. Use the native --tail flag instead of a pipe so failure
# context is preserved.
docker compose logs --tail=100 app
# Re-running migrate is idempotent:
docker compose exec app node dist/scripts/migrate.js
# If schema is corrupted, restore from backup (§11 backup/restore) and
# re-run migrate.

# Admin password reset
docker compose exec app node dist/scripts/reset-admin-password.js

# Candidate interrupted attempt
# REC-I3 implements direct-entry candidate restore: the Web client calls the
# explicit restore command and reloads the authoritative take snapshot.
# ADR-013 recovery policy is implemented: strict is the default and
# bounded_grace follows the frozen caps. Admin operator time grants are a
# separate audited command; use the Dashboard action only when the Attempt's
# frozen policy is operator_incident.

# Log / requestId investigation
docker compose logs app | jq 'select(.reqId == "<REQ_ID>")'
```

---

## 14. Log and diagnostics lookup

All logs are pino JSON to stdout. Every request log carries `reqId`. The
API redacts sensitive fields via a `REDACT_CONFIG`; SMTP passwords are
additionally scrubbed by `sanitizeEmailError`.

```bash
# Tail all services
docker compose logs -f

# Filter by service
docker compose logs -f app
docker compose logs -f email-worker

# Filter by request id (JSON log)
docker compose logs app | jq 'select(.reqId == "req-42")'

# Filter by log level
docker compose logs app | jq 'select(.level >= 40)'   # warn and above

# Live diagnostics (admin-only)
watch -n 5 'curl -s -b "auth-token=<JWT>"
  http://localhost:${APP_PORT:-3000}/api/system/diagnostics | jq'
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

```text
[ ] Read CHANGELOG / release notes for breaking changes.
[ ] Back up the database (pg_dump — §11).
[ ] Pull the new code: git pull && pnpm install --frozen-lockfile.
[ ] Run pnpm verify:static locally.
[ ] Rebuild the image: docker compose build.
[ ] Pull/seed any new required env vars into .env.
[ ] docker compose up -d (containers will run migrate on restart).
[ ] Watch migration logs: docker compose logs app | grep -i migrat.
[ ] Verify /api/health and /api/system/health.
[ ] Verify /api/system/diagnostics reflects expected DB + worker state.
[ ] Run the operator checklist (P6 audit §25).
[ ] If rollback is needed: restore the DB backup and redeploy the previous
    image tag.
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

The currently documented backup procedure is `pg_dump` against the `pgdata` volume.

> **CURRENT PROCEDURE UNVALIDATED — do not treat as a proven exact historical
> restore until P7-C restore drills close this gap.** The P7-C0 durability
> audit (`docs/audits/P7-C0-DURABILITY-PERSISTENCE-REALITY-AUDIT.md` §16/§16.1)
> classified this path as **documented-only, UNVALIDATED**: the P6 audit
> verified the migrate-from-zero path but never executed a live
> pg_dump/restore cycle, and exact historical state replacement is NOT proven
> (restoring an older dump into an already-newer database may leave objects
> absent from the dump unless the target is recreated/cleaned under an
> explicit restore contract). Validate on first production deploy before
> relying on it.

```bash
# Backup (online, consistent). $POSTGRES_USER / $POSTGRES_DB are expanded
# INSIDE the db container (postgres image env), not by the host shell —
# wrap pg_dump in sh -c. The dump stream is captured on the host.
docker compose exec -T db sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists' \
  > backup_$(date +%Y%m%d_%H%M%S).sql

# Verify backup is non-empty and ends with completion
ls -lh backup_*.sql
tail -5 backup_*.sql   # should contain 'PostgreSQL database dump complete'

# Restore (offline — stop API + worker first to avoid writes during restore).
# Feed the host-side dump file into the db container's psql.
# NOTE: --clean --if-exists drops objects present in the dump, but does NOT
# remove objects that exist in the target DB yet are absent from an older
# dump. For an EXACT historical replacement, recreate/clean the target
# database under an explicit restore contract (P7-C restore drills).
docker compose stop app email-worker
docker compose exec -T db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < backup_YYYYMMDD_HHMMSS.sql
docker compose up -d app email-worker
```

For larger deployments, consider `pg_basebackup` for physical backups or
continuous WAL archiving. Schedule backups via cron on the Docker host — the
MVP does not ship a backup scheduler. Note that `wal_level=replica` is already
sufficient for continuous archiving / PITR; the actual missing pieces for PITR
are `archive_mode=on`, an `archive_command`, a WAL archive destination/retention
contract, a base-backup/recovery procedure, and a recovery drill (P7-C0 §7).

> **Note:** the P6 audit verified the migrate-from-zero path (§9 of the
> audit) but did not execute a live pg_dump/restore cycle. Validate the
> backup/restore procedure on first production deploy before relying on it.
