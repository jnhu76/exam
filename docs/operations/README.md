# Operations

> Day-2 operations for Exam deployments: backup, upgrade, diagnostics,
> email recovery, and troubleshooting. For first installation, see
> [INSTALL.md](../../INSTALL.md). For deployment topology, see
> [Deployment](../deployment/).

## Backup and Recovery

Authoritative state is the PostgreSQL data directory under
`./data/postgres`. Host persistence is not backup.

The ONE supported mechanism is `pg_dump -Fc` / `pg_restore` via the
operator tool:

```bash
./scripts/db-backup.sh backup  /mnt/nas/exam-$(date +%Y%m%d).dump
./scripts/db-backup.sh restore /mnt/nas/exam-20260926.dump
```

Scheduling and retention are operator policy (cron/systemd). See the
runbook §17 for details.

## Upgrade and Uninstall

Upgrades use the prebuilt release image pins (`EXAM_IMAGE` /
`EXAM_WEB_IMAGE`): `git pull` → re-generate env → pull the new release
images → `docker compose up -d` (migrations run on app start).

See
[`upgrade-and-uninstall.md`](../deployment/upgrade-and-uninstall.md)
for the full lifecycle including rollback, version-skip policy, and
uninstall.

## Email Configuration

Email delivery runs as an in-process outbox loop inside the app
container. The loop uses `FOR UPDATE SKIP LOCKED` claiming, retry with
backoff, and lock-timeout recovery.

| Scenario | Action |
| --- | --- |
| Email disabled (default) | Outbox drains to `sent` without delivery — no action needed |
| Enable SMTP | Set `EMAIL_ENABLED=true`, `EMAIL_TRANSPORT=smtp`, `SMTP_*` vars |
| Stuck processing | Restart app — abandoned rows recovered after lock timeout |
| Dead emails | Inspect `last_error` via `psql`; no supported automatic replay — see notes below |
| Loop degraded | Check `GET /api/system/diagnostics` `emailStatus.worker` |

See
[`email-config.md`](email-config.md) for
the full SMTP configuration reference and
[`mvp-deployment-runbook.md`](../deployment/mvp-deployment-runbook.md)
section 8 for the outbox loop internals.

**Dead email guidance:** The `dead` status is terminal — the retry
budget has been exhausted. There is no automated replay mechanism.
Inspect `last_error` and the recipient/content via `psql` to determine
the failure cause. The deployment runbook documents a manual operator
override procedure; use it only after confirming the root cause.
Do not mutate the outbox directly unless following that documented
procedure.

## Health and Diagnostics

Four distinct layers — do not conflate them (#547):

| Endpoint | Auth | Layer | Purpose |
| --- | --- | --- | --- |
| `GET /api/health` | none | Liveness | Process/event-loop responsive. Dependency-blind BY DESIGN: stays 200 through DB loss. |
| `GET /api/ready` | none | Readiness | Deployment gate: mandatory serving dependencies (PostgreSQL; Redis only when `REDIS_MODE=required`) currently usable. Handler body: `200 {"status":"ready"}` / `503 {"status":"not_ready"}` — nothing else is disclosed. One deliberate exception: with `REDIS_MODE=required` and Redis unusable, the rate limiter fails closed first and the answer is the standard 503 `RATE_LIMIT_UNAVAILABLE` error envelope (same gate direction — 503 = not ready). |
| `GET /api/system/health` | Admin + Maintainer | Diagnostics | DB ping latency, CPU, memory + derived status (CPU/memory thresholds only) |
| `GET /api/system/diagnostics` | Admin + Maintainer | Diagnostics | Operational: DB latency, Redis, scanner state + stall classification, outbox; Admin responses may additionally include business-integrity anomalies (Maintainer never receives the business-integrity projection) |
| `GET /api/system/info` | none | — | Version + uptime |
| `GET /api/system/public-config` | none | — | Deployment mode, feature flags |

The Compose `app` healthcheck polls `/api/ready` (the readiness gate) every
30s; the `web` service carries the SPA HTML healthcheck and holds its own
startup until the app is healthy (it is the sole public ingress). An
`unhealthy`
app container means the deployment readiness state is violated (e.g.
PostgreSQL is down); it is an orchestration/visibility signal, NOT a
runtime traffic block — health status never routes or restarts traffic.

## Active Alerting (operability events)

The app emits BOUNDED structured transition events on critical operational
conditions, so a deployed watcher can notify an operator without anyone opening
the diagnostics page. The application produces stdout events only; it does not
deploy the watcher or prove delivery. Stable fields (stdout pino JSON; full
contract:
[`operations/active-alerting.md`](active-alerting.md) — the canonical contract):

```text
event: "operability.readiness"        component: "database"|"redis"            state: "unavailable"|"recovered"
event: "operability.background_loop"  component: "heartbeat"|"deadline_scanner" state: "stalled"|"recovered"
event: "operability.business_failure" component: loop component                 state: "failing"|"recovered"
event: "operability.tick_failure"     component: "heartbeat"|"deadline_scanner" state: "failing"|"recovered"
```

At most one log line per observed state TRANSITION (no storms; recovery is one
`info` line). A lost line is not automatically re-sent while the state is
unchanged, and a restart does not emit a recovery for the previous process.
Minimal external hook: alert when `level >= error AND event in
{operability.readiness, operability.background_loop,
operability.business_failure, operability.tick_failure}` with a failure
`state`; use `recovered` to clear, keyed by `(event, component)`. The watcher
must be deployed/updated before the new event reaches a pager. Consumable by
journald / Docker log driver / Loki / a custom watcher — none of which is
required or bundled (#312 stays separate).

## Logs and Monitoring

All logs are pino JSON to stdout. Every request carries a `reqId`.

Failed answer-save investigations (what a missing receipt does and does not
prove, and the UNKNOWN boundary): see
[`save-failure-evidence.md`](save-failure-evidence.md).

```bash
docker compose --env-file .env.production logs -f app          # tail all
docker compose --env-file .env.production logs app | jq 'select(.level >= 40)'  # warn+
```

**nginx edge logs (`web` service).** The access log (`exam_privacy` format) is
secret-free by construction — it never records raw URLs. The error log
(Owner Decision A, `error` level) MAY quote full request lines including
query strings during upstream/DNS failures (verified by fault injection;
see the #925/#926 evidence archive). Handle it accordingly:

- restrict who may run `docker logs web` / read
  `/var/lib/docker/containers/**.log` on the host (operators only — Docker
  access is near-host privilege; app RBAC does not cover OS logs);
- set explicit log rotation (compose `logging:` `max-size`/`max-file`, or
  the daemon default) — the bundled compose file does not cap log growth
  by itself;
- redact query strings before sharing error-log excerpts outside the
  ops team.


## Incident and Recovery

- **Candidate disrupted attempts**: heartbeat scanner marks attempts
  `disrupted` on timeout; candidates self-restore via the TakeExam
  page
- **Admin Recovery Center**: event queue, event details, attempt/exam
  context, and operator actions
- **Operator time grants**: Admin can extend attempt time via the
  Dashboard; audited with operation-ID idempotency

See
[`architecture/exam-system/candidate-recovery.md`](../architecture/exam-system/candidate-recovery.md)
for the full recovery protocol.

## Troubleshooting

| Issue | Resolution |
| --- | --- |
| Port conflict | Change `EXAM_PORT` in `.env.production` |
| Container won't start | `docker compose --env-file .env.production logs app` |
| WSL2 / Docker Desktop | See [`docker-troubleshooting.md`](../docker-troubleshooting.md) |
| China mainland mirrors | Build args: `--build-arg NPM_REGISTRY=... --build-arg DEBIAN_MIRROR=...` |
| JWT expired / 401 | Check `JWT_SECRET` hasn't changed between restarts |
| Email not sending | Check `EMAIL_ENABLED=true` and `SMTP_HOST` in `.env.production` |
| Redis connection refused | Redis is optional; only needed with `--profile redis` |
