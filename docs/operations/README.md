# Operations

> Day-2 operations for Exam deployments: backup, upgrade, diagnostics,
> email recovery, and troubleshooting. For first installation, see
> [INSTALL.md](../../INSTALL.md). For deployment topology, see
> [Deployment](../deployment/).

## Backup and Recovery

Authoritative state is the PostgreSQL data directory under
`./data/postgres`. Host persistence is not backup.

| Path | Description | Evidence |
| --- | --- | --- |
| C1 cold-filesystem | Stop, copy data dir, restart | `tests/deployment/persistence-and-cold-restore.sh` |
| C2 logical `pg_dump` | Online backup + clean restore | `tests/deployment/logical-backup-restore.sh` |
| C3 physical `pg_basebackup` | WAL archive + PITR | `tests/deployment/pitr.sh` |

See
[`backup-and-recovery.md`](../deployment/backup-and-recovery.md) for
the complete decision tree, scripts, and evidence ledger.

## Upgrade and Uninstall

Upgrades use the prebuilt image pin: `git pull` → re-generate env →
pull new image → `docker compose up -d` (migrations run on app start).

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
| `GET /api/ready` | none | Readiness | Deployment gate: mandatory serving dependencies (PostgreSQL; Redis only when `REDIS_MODE=required`) currently usable. `200 {"status":"ready"}` / `503 {"status":"not_ready"}` — nothing else is disclosed. |
| `GET /api/system/health` | admin | Diagnostics | DB ping latency, CPU, memory + derived status (CPU/memory thresholds only) |
| `GET /api/system/diagnostics` | admin | Diagnostics | Operational: DB latency, Redis, scanner state + stall classification, outbox, integrity |
| `GET /api/system/info` | none | — | Version + uptime |
| `GET /api/system/public-config` | none | — | Deployment mode, feature flags |

The Compose `app` healthcheck polls `/api/ready` (the readiness gate) and
the SPA root every 30s. An `unhealthy` app container means the deployment
readiness state is violated (e.g. PostgreSQL is down); it is an
orchestration/visibility signal, NOT a traffic block — in the default
direct-LAN topology nothing routes on Docker health status.

## Active Alerting (operability events)

The app emits BOUNDED structured transition events on critical operational
conditions, so a machine can page without anyone opening the diagnostics
page. Stable fields (stdout pino JSON; full contract:
[`research/exam-547-readiness-alerting-1/03-alert-contract.md`](../research/exam-547-readiness-alerting-1/03-alert-contract.md)):

```text
event: "operability.readiness"       component: "database"|"redis"          state: "unavailable"|"recovered"
event: "operability.background_loop" component: "heartbeat"|"deadline_scanner" state: "stalled"|"recovered"
```

One log line per state TRANSITION only (no storms; recovery is one `info`
line). Minimal external hook: alert when `level >= error AND event in
{operability.readiness, operability.background_loop}` with a failure
`state`; use `recovered` to clear. Consumable by journald / Docker log
driver / Loki / a custom watcher — none of which is required or bundled
(#312 stays separate).

## Logs and Monitoring

All logs are pino JSON to stdout. Every request carries a `reqId`.

```bash
docker compose --env-file .env.deploy logs -f app          # tail all
docker compose --env-file .env.deploy logs app | jq 'select(.level >= 40)'  # warn+
```

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
| Port conflict | Change `EXAM_PORT` in `.env.deploy` |
| Container won't start | `docker compose --env-file .env.deploy logs app` |
| WSL2 / Docker Desktop | See [`docker-troubleshooting.md`](../docker-troubleshooting.md) |
| China mainland mirrors | Build args: `--build-arg NPM_REGISTRY=... --build-arg DEBIAN_MIRROR=...` |
| JWT expired / 401 | Check `JWT_SECRET` hasn't changed between restarts |
| Email not sending | Check `EMAIL_ENABLED=true` and `SMTP_HOST` in `.env.deploy` |
| Redis connection refused | Redis is optional; only needed with `--profile redis` |
