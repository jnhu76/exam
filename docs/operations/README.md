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

### Worker heartbeats storage growth (`worker_heartbeats`)

`worker_heartbeats` backs the `emailStatus.worker` projection of
`GET /api/system/diagnostics`. Every API/worker process start mints a fresh
random `workerInstanceId` (`hostname-pid-uuid`,
`apps/api/src/plugins/emailOutboxLoop.ts`), and heartbeats UPSERT on that
key (unique index `worker_heartbeats_instance_uk`), so each process restart
nets one new row per worker name; churn within a live instance updates in
place and adds no rows. No code path deletes expired instance rows (#1013).

Growth is measured — not cleaned — by the read-only CLI
(`apps/api/src/scripts/measure-worker-heartbeat-growth.ts`):

```bash
pnpm --filter @exam/api measure:worker-heartbeats                          # single snapshot
pnpm --filter @exam/api measure:worker-heartbeats --sample-seconds 300     # two snapshots + deltas
pnpm --filter @exam/api measure:worker-heartbeats --worker-name NAME       # EXPLAIN probe target only
pnpm --filter @exam/api measure:worker-heartbeats --schema NAME            # pin the search_path
```

The tool is strictly read-only: it opens one dedicated connection (`max: 1`),
sets `default_transaction_read_only = on` for the session, and issues only
one aggregate `SELECT` plus one `EXPLAIN (ANALYZE, FORMAT JSON)`. Write
refusal on that handle is proven by
`apps/api/src/scripts/measure-worker-heartbeats.readonly.test.ts` (expects
PostgreSQL error 25006). On success the measurement is printed as JSON on
stdout; on failure stderr gets `measurement failed: <message>` (never the
connection URL) and the exit code is 1. Unknown arguments are rejected.

**Snapshot fields** (single-snapshot output): `capturedAt`, `database`,
`serverVersion`, `totalRows`, `byWorker[]` — per `worker_name`:
`workerName`, `rows`, `distinctInstances`, `latestPollAt`, `oldestCreatedAt`
(full-table `GROUP BY worker_name`) — and `findLatestByNameProbe`:
`workerName`, `planNode`, `executionTimeMs`. With `--sample-seconds N > 0`
the output is `{ sampleSeconds, first, second, deltaRows, deltaByWorker }`
(`first`/`second` are full snapshots).

**Reading the diff.** Run the tool periodically (cron), archive the JSON
outputs, and compare two archived snapshots for the growth rate;
`--sample-seconds N` captures a bounded-interval delta in one invocation.
The two samples are separate implicit read-only transactions on one
connection — the sleep between them holds no transaction — so deltas are
plain scalar differences with no window or locking semantics.
`deltaByWorker` is keyed off the second snapshot's worker set: a worker
name that disappears between snapshots produces no negative entry.
`--worker-name` changes only the EXPLAIN probe target and never filters
`byWorker`. The daily restart rate of a worker ≈ its `deltaByWorker` entry
over a 24-hour window (equivalently, the increase of its
`byWorker[].distinctInstances` between archived snapshots), because each
process start nets one row and same-instance churn does not.

**Target database and environment** (ownership per
[`../standards/testing.md` §2.8](../standards/testing.md)). The tool never
creates, migrates, or drops anything — it connects and reads — so the
target database must already exist and already contain the migrated
`worker_heartbeats` table. Mode routing: `APP_MODE` is authoritative,
`NODE_ENV` is the fallback. Test-like modes (`test`/`ci`/`e2e`) read
`TEST_DATABASE_URL ?? TEST_DB_URL` (database name must contain
`test`/`e2e`/`ci`), else construct the local `exam_test` URL from
`DB_HOST_PORT`; an explicit `TEST_DATABASE_URL` target is operator-owned
and must already exist — the harness never creates or drops it. Any other
mode resolves as development: `DATABASE_URL` — including values admitted
from the repository-root `.env`, which the tool loads — or the constructed
dev `exam` database. Exporting `TEST_DATABASE_URL` alone therefore does
NOT route to the test database; set `APP_MODE=test` (or `NODE_ENV=test`)
as well. `TEST_RUNTIME_ENV` applies only inside vitest projects, not to
direct CLI invocations.

**Re-measurement triggers** (#1013 disposition; measurement is the
delivered scope):

1. `totalRows` exceeds 100,000;
2. sustained >50 restarts/day for several weeks (read from
   `deltaByWorker` / `distinctInstances` growth as above);
3. the `findLatestByName` plan degrades to a Sort under the Limit node
   while the table holds more than ~10k rows. The probe's `planNode`
   exports only the root node type, which is always `Limit` (the query
   has `LIMIT 1`), so it cannot by itself distinguish
   `Limit → Index Scan Backward` from `Limit → Sort`; judge this trigger
   by running the full EXPLAIN manually — the probe's exact statement is
   `EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM worker_heartbeats WHERE
   worker_name = 'email-delivery' ORDER BY last_poll_at DESC LIMIT 1`
   (the probe interpolates an escaped literal where production issues a
   parameterized statement, so plan shapes can differ at the margin). The
   expected shape walks `worker_heartbeats_last_poll_at_idx`; a Sort node
   means the planner abandoned the index (typically stale statistics). For
   the row-count term, the figure that directly drives this query's cost
   is the probe worker's `byWorker[].rows` (the statement filters on
   `worker_name`); `totalRows` is the looser, table-level proxy #1013
   records.

**Deleting rows can fabricate recovery.** `emailStatus.worker` is derived
entirely from the single newest row per worker name (`ORDER BY
last_poll_at DESC LIMIT 1`). Deleting that newest row — e.g. a degraded
instance holding `lastError` — makes the same query return the
next-newest row immediately: a fresh row with a success and no error
flips `workerStatus` to `available`, so the deletion itself fabricates
recovery, and even a stale successor erases the `lastError`/`lastErrorAt`
evidence from the projection.

**Retention status.** #1013's disposition is DEFER: cleanup and retention
thresholds are a separate future owner decision that this page does not
make. The procedure and triggers above exist so that decision can be
taken on evidence.

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
