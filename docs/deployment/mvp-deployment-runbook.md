# MVP Deployment & Operations Runbook

> **Authority:** canonical deployment and operations document for the
> implemented MVP subset (single deployment / single default organization /
> Admin + Teacher + Candidate MVP roles / `timed_window` exams / objective +
> manual grading / result publication / Inbox + Email outbox / PostgreSQL
> Email worker / LAN-on-premise).
>
> **Companion documents:**
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
Postgres:  provided by the 'db' service (postgres:18.4-bookworm). External
           Postgres is also supported by setting DATABASE_URL and removing
           the 'db' service — but the supported MVP path is the bundled
           service.
Redis:     OPTIONAL. The 'redis' service ships for forward-compatibility
           with the Phase 2 baseline. No MVP business code reads/writes
           Redis. See §9.
SMTP:      OPTIONAL. Leave EMAIL_ENABLED=false to drain the outbox to 'sent'
           status without external delivery. Set EMAIL_ENABLED=true +
           EMAIL_TRANSPORT=smtp + SMTP_* to enable real Email delivery.
Backups:   operator-supplied pg_dump schedule against the 'pgdata' volume
           (see §11).
```

---

## 2. Environment variables

Copy `.env.example` → `.env` and set the production-required values. Every
variable below has a safe default for local/dev; production-required values
fail fast at boot if missing.

### Production-required (fail-fast at boot if missing or invalid)

| Variable | Purpose | Validation |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection for API + worker | postgres URL; production does not fall back to localhost |
| `JWT_SECRET` | Signs the `auth-token` cookie JWT; also required by the worker's runtime-config loader | non-empty; no default in production |
| `CORS_ORIGIN` | Browser origin allowlist (credentials:true) | comma-separated → array |
| `PUBLIC_WEB_ORIGIN` | Used to build Email action links; validated as absolute origin (scheme+host[+port], no path) | HTTPS recommended in production; never derived from `request.headers.host` |

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
| `REDIS_URL` | unset (disabled) | optional; see §9 |
| `HEARTBEAT_SCAN_INTERVAL_MS` / `HEARTBEAT_TIMEOUT_MS` | 30000 / 60000 | in-process heartbeat scanner |
| `DEADLINE_SCAN_INTERVAL_MS` | (inherits HEARTBEAT) | in-process deadline scanner |
| `RATE_LIMIT_*` | 100 / 60000 / disabled in e2e | IP-keyed in-memory rate limiter |

### Email (worker + sender)

| Variable | Default | Notes |
|---|---|---|
| `EMAIL_ENABLED` | false | master switch; false → DisabledEmailSender drains outbox to 'sent' |
| `EMAIL_TRANSPORT` | fake | `fake` or `smtp`; `smtp` is force-overridden to `fake` in test/e2e/ci |
| `EMAIL_FAKE_MODE` | success | `success` or `failure` (fake transport only) |
| `EMAIL_FROM` | no-reply@example.local | Email From header |
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
#   DATABASE_URL=postgresql://exam:<STRONG_DB_PASSWORD>@db:5432/exam
#   JWT_SECRET=<GENERATE_A_LONG_RANDOM_SECRET>
#   CORS_ORIGIN=https://exam.your-org.internal
#   PUBLIC_WEB_ORIGIN=https://exam.your-org.internal
#   POSTGRES_PASSWORD=<STRONG_DB_PASSWORD>   # must match DATABASE_URL

# 3. (Optional) Enable real Email delivery
# EMAIL_ENABLED=true
# EMAIL_TRANSPORT=smtp
# SMTP_HOST=smtp.your-org.internal
# SMTP_USER=...
# SMTP_PASSWORD=...

# 4. Build and start the full stack (app + db + redis + email-worker)
docker compose up -d --build

# 5. Watch the API come up (migration runs inside the container entrypoint)
docker compose logs -f app
# Look for: 'Running database migrations...', 'Server listening at http://0.0.0.0:3000'

# 6. Verify all four services are up
docker compose ps
```

The Dockerfile builds the app + email-worker from the same image. The
`docker-entrypoint.sh` runs `node dist/scripts/migrate.js` once on first
boot of the `app` container, then `exec node dist/server.js`. The
`email-worker` container runs `node dist/workers/emailDeliveryWorker.js`
directly (the worker self-migrates at startup — idempotent via the drizzle
journal).

---

## 4. Migration

Migrations are managed by drizzle-kit (`packages/db/drizzle.config.ts`). The
production migration entrypoint is `node dist/scripts/migrate.js`, which is
run:

1. By the `app` container's `docker-entrypoint.sh` before `node dist/server.js`.
2. By the `email-worker` container's startup (the worker calls
   `migratePostgres(db)` before its poll loop).

Both paths are idempotent (drizzle journal gates concurrent invocations).
Re-running migrations is safe and emits NOTICE messages about the journal
schema already existing.

```bash
# Run migrations manually (rarely needed; containers do this automatically)
docker compose exec app node dist/scripts/migrate.js

# Inspect the drizzle journal
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT count(*) FROM drizzle.__drizzle_migrations;"

# Inspect table count
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"
```

**Failed migration recovery:** inspect the drizzle journal for the last
applied migration; re-running migrate is safe. If the schema is corrupted,
restore from the latest `pg_dump` backup (§11) and re-run migrate.

---

## 5. Bootstrap admin

The first admin account is created by the baseline seed. The Compose
entrypoint seeds when `RUN_SEED=1` is set (run once on first install, then
unset for normal restarts).

```bash
# Option A: seed via the container entrypoint (set RUN_SEED=1 in .env, then
# 'docker compose up -d app'; the entrypoint runs dist/seed.js). Unset
# RUN_SEED afterward and restart app.
RUN_SEED=1 docker compose up -d app
docker compose logs app | tail -20   # look for 'Phase 1 dev/test seed credentials'

# Option B: run the seed script directly against the running stack
docker compose exec app node dist/seed.js

# Option C: reset the admin password later without re-seeding
docker compose exec app node dist/scripts/reset-admin-password.js
```

The seed creates authentication-only accounts. For full demo data (courses,
questions, exams, attempts), use `pnpm db:seed:demo` against the dev DB only
— never against the production DB.

> **Custom seed credentials** (optional): `SEED_ORG_NAME`,
> `SEED_ORG_DISPLAY_NAME`, `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`,
> `SEED_CANDIDATE_*`. Set in `.env` before the first seed.

---

## 6. Start services

```bash
# Normal start (all four services)
docker compose up -d

# Verify
docker compose ps
# Expected: app (healthy), db (healthy), redis (healthy), email-worker (up)

# API health (liveness — process alive)
curl -s http://localhost:${APP_PORT:-3000}/api/health
# Expected: {"status":"ok"}

# Admin-only system health (DB ping + CPU/memory)
# (requires authentication; obtain the auth-token cookie via the login page)
curl -s -b "auth-token=<JWT>" http://localhost:${APP_PORT:-3000}/api/system/health
# Expected: {"cpu":..,"memory":..,"dbResponseMs":..,"status":"ok"}
```

Service dependency ordering is enforced by Compose `depends_on` with
`condition: service_healthy`:

```text
db (healthy) ← app, email-worker
redis (healthy) ← app
```

The scanner (heartbeat + deadline) runs **in-process** inside the `app`
container — there is no separate scanner service. The scanner's liveness is
covered by the `app` healthcheck and surfaced in `/api/system/diagnostics`.

---

## 7. Verify health

The implemented MVP separates **liveness** from **readiness**:

| Endpoint | Auth | Purpose | What it checks |
|---|---|---|---|
| `GET /api/health` | none | Liveness probe (Compose healthcheck, container restart) | process alive only |
| `GET /api/system/health` | admin (`SystemHealthView`) | Readiness / DB availability | DB ping latency + CPU/memory |
| `GET /api/system/diagnostics` | admin (`SystemDiagnosticsView`) | Operational diagnostics | DB latency, Redis (if configured), scanner metrics, email worker heartbeat, outbox backlog, oldest pending age, dead rows |
| `GET /api/system/info` | none | Version + uptime | n/a |
| `GET /api/system/public-config` | none | Public config (deployment mode, feature flags) | n/a |

The Compose `app` healthcheck polls `GET /api/health` every 30s (5s timeout,
3 retries, 30s start period). A failing healthcheck restarts the `app`
container (`restart: unless-stopped`).

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
# The worker starts automatically with 'docker compose up -d'. Verify:
docker compose logs email-worker | tail -20
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

## 10. Redis requirement

**Redis is OPTIONAL** in the implemented MVP (`UNUSED_RESIDUE` classification
per the P6 audit and ADR-001). No MVP business code reads from or writes to
Redis:

- Email delivery queue = PostgreSQL `email_outbox` (frozen by ADR-011).
- Inbox persistence = PostgreSQL `notifications` (frozen by ADR-011).
- Admission queue / rate limiter = in-process / DB-backed (ADR-001).
- Session/JWT = stateless cookie + JWT (no Redis session store).

Leave `REDIS_URL` unset to disable Redis. The `redis` Compose service ships
for forward-compatibility with the Phase 2 baseline (ADR-001) and is
health-checked, but the API, worker, Inbox, and Email all function without
it. Diagnostics reports `redisStatus.connected=false` when Redis is
unconfigured — this is expected and does not degrade the MVP path.

Redis becomes `REQUIRED` only when a documented, measured trigger is met
(multi-instance, shared rate limit, distributed presence, cross-process
scanner coordination, persistent admission queue). **None of these triggers
is met by the implemented MVP subset.**

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
docker compose restart redis       # optional; not required for MVP

# Stuck Email processing recovery
# The worker recovers abandoned rows at the top of every poll cycle after
# EMAIL_WORKER_LOCK_TIMEOUT_MS (default 300s). To force immediate recovery,
# restart the worker:
docker compose restart email-worker

# Dead Email inspection (admin-only via psql)
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT id, recipient_user_id, subject, attempt_count, last_error,
             created_at, last_attempt_at
      FROM email_outbox WHERE status = 'dead';"

# Replay a dead Email (advanced — inspect last_error first)
# ⚠️  This re-attempts delivery. Confirm the recipient and content first.
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "UPDATE email_outbox
      SET status='pending', locked_at=NULL, locked_by=NULL,
          next_attempt_at=now(), last_error=NULL
      WHERE id = '<UUID>';"

# Stale worker heartbeat
# /api/system/diagnostics emailStatus.worker.status=degraded when
# now - last_poll_at > EMAIL_WORKER_HEARTBEAT_STALE_MS (default 60s).
# Restart the worker:
docker compose restart email-worker

# Failed migration
docker compose logs app | grep -i migrat
# Re-running migrate is idempotent:
docker compose exec app node dist/scripts/migrate.js
# If schema is corrupted, restore from backup (§11 backup/restore) and
# re-run migrate.

# Admin password reset
docker compose exec app node dist/scripts/reset-admin-password.js

# Candidate interrupted attempt
# The backend restoreAttempt route exists; the frontend self-service
# restore UI is deferred (Phase 2+). Current behavior: a disrupted attempt
# jumps to the result page with an 'answering interrupted' message.

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
- Frontend disrupted-recovery UI is NOT productized (backend capability exists;
  frontend self-service restore button deferred to Phase 2+).
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
- WYSIWYG final-answer Option D (ADR-008) NOT implemented.
- Live backup validation (pg_dump/restore) was not executed in the P6 audit;
  this runbook documents the supported procedure. Validate on first
  production deploy.
```

---

## 17. Backup / export (operator-supplied)

The supported backup procedure is `pg_dump` against the `pgdata` volume.

```bash
# Backup (online, consistent)
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner --clean --if-exists \
  > backup_$(date +%Y%m%d_%H%M%S).sql

# Verify backup is non-empty and ends with completion
ls -lh backup_*.sql
tail -5 backup_*.sql   # should contain 'PostgreSQL database dump complete'

# Restore (offline — stop API + worker first to avoid writes during restore)
docker compose stop app email-worker
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < backup_YYYYMMDD_HHMMSS.sql
docker compose up -d app email-worker
```

For larger deployments, consider `pg_basebackup` for physical backups or
continuous WAL archiving. Schedule backups via cron on the Docker host — the
MVP does not ship a backup scheduler.

> **Note:** the P6 audit verified the migrate-from-zero path (§9 of the
> audit) but did not execute a live pg_dump/restore cycle. Validate the
> backup/restore procedure on first production deploy before relying on it.
