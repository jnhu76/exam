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
| Dead emails | Inspect via `psql`, replay by resetting status to `pending` |
| Loop degraded | Check `GET /api/system/diagnostics` `emailStatus.worker` |

See
[`architecture/email-config.md`](../architecture/email-config.md) for
the full SMTP configuration reference and
[`mvp-deployment-runbook.md`](../deployment/mvp-deployment-runbook.md)
section 8 for the outbox loop internals.

## Health and Diagnostics

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | none | Liveness probe (Compose healthcheck) |
| `GET /api/system/health` | admin | Readiness — DB ping, CPU, memory |
| `GET /api/system/diagnostics` | admin | Operational: DB latency, Redis, scanners, outbox |
| `GET /api/system/info` | none | Version + uptime |
| `GET /api/system/public-config` | none | Deployment mode, feature flags |

The Compose `app` healthcheck polls `/api/health` every 30s. It checks
that both the API and the SPA are reachable.

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
