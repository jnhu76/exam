# EXAM-547-READINESS-ALERTING-1 — Stage A/B baseline (current-master reality)

> AUDIT-ONLY measurement of the CURRENT deployment/health/alerting reality on
> base `13457f9b` (= master, PR #562 merge). No production code was changed
> before or during this measurement. Method: isolated Compose project
> (`-p exam547-base`, throwaway `EXAM_DATA_ROOT`, port 3311, image built from
> this checkout via `docker-compose.build.yml` with `pull_policy: build`).
> Toolchain: Node v24.15.0, pnpm 11.1.2, Docker 29.5.3, Compose v5.1.4,
> PostgreSQL 18.4 (`postgres:18.4-bookworm`).

## 1. Current deployment chain (as-built)

```text
PostgreSQL (db, pg_isready healthcheck 10s/5s/5)
    ↓ depends_on: condition: service_healthy   [VERIFIED — see A3b]
app container (entrypoint: migrations THEN Fastify listen)
    ↓ Docker healthcheck: node fetch /api/health + / (SPA)   [LIVENESS ONLY]
    interval 30s / timeout 5s / retries 3 / start_period 30s
    ↓ restart: unless-stopped
candidate traffic (direct-LAN: published port, no router consumes health status)
```

Background loops inside the app process:

```text
heartbeat scanner (30s interval, activeScan promise guard)
deadline scanner (30s interval, activeScan promise guard)
email outbox loop (5s poll, supervised while-loop + durable worker_heartbeats row)
client-event retention (startup run + 24h interval, activeRun promise guard)
       ↓
in-memory metrics (heartbeatMetrics/deadlineScannerMetrics; process-local, reset on restart)
durable heartbeat (email worker only, worker_heartbeats table)
       ↓
/api/system/diagnostics (authenticated pull view)
structured pino logs (stdout JSON)
       ↓
operator (pull-only; no active alert path)
```

Per-node OWNER / SOURCE OF TRUTH / FAILURE MODE / SIGNAL / CONSUMER / RECOVERY:

| Node | Owner | Source of truth | Failure mode | Current signal | Current consumer | Recovery model |
| --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL | db service | pg data dir (bind mount) | stopped/crash/corruption | pg_isready → container health | compose `depends_on` (startup only) | `restart: unless-stopped` + operator |
| app process | app service | image + env | crash, hang | `/api/health` 200 | Docker healthcheck | `restart: unless-stopped` |
| app↔DB path | db plugin (postgres.js pool, defaults: max 10, connect_timeout 30s) | — | DB loss while running | **none at deployment layer** (healthcheck is DB-blind) | **nobody** | pool auto-reconnect (measured ~4s) |
| heartbeat scanner | heartbeat.ts plugin | in-memory `heartbeatMetrics` | throw / hang (`activeScan` never settles) / timer stop | `lastScanAt` in diagnostics; `level:50` log per throw | operator pull only | next tick (throw case); **none for hang** |
| deadline scanner | deadlineScanner.ts | in-memory `deadlineScannerMetrics` | same | same | operator pull only | same |
| email outbox | emailOutboxLoop.ts | durable outbox + `worker_heartbeats` row | SMTP down / DB down | worker status in diagnostics (stale-aware), logs | operator pull only | supervised retry + lock-timeout recovery |
| client-event retention | clientEventRetention.ts | logs only (deliberate, #544) | throw | `level:50` log | none | next daily tick / restart convergence |

## 2. Measured baseline (bounded polling, no fixed-sleep correctness gates)

### A1 — DB down while app is running (`docker compose stop db`, 150s window)

| Signal | Observed (every 5s sample) |
| --- | --- |
| `GET /api/health` | **200 for the entire 150s** (liveness preserved — by design) |
| `GET /api/system/health` (auth) | **500 or hangs** (curl `-m 8` timeouts between 500s; postgres.js connect/retry leaves the request unbounded past the client budget) |
| `GET /api/system/dashboard` (normal DB-backed API) | **500** (or hangs past client budget) |
| Docker health status (`docker inspect`) | **`healthy` for the entire 150s** — the F3-05 gap reproduced on current master |
| App container ID | `c924d934b7e4…` → unchanged |
| RestartCount | 0 (no silent auto-restart) |

**Conclusion:** running-state DB loss is invisible to every deployment-layer
signal. The only failure evidence is 500s on business routes and structured
error logs. An operator not actively watching gets no machine signal.

### A2 — DB recovery WITHOUT app restart (`docker compose start db`)

- `/api/system/health` → 200 and `/api/system/dashboard` → 200 after **~4s**
  (bounded poll; postgres.js pool reconnects on its own).
- Same app container ID, RestartCount still 0.
- **Recovery property: no app restart is required.** Any design that implies
  restart-on-readiness-failure would be worse than current reality.

### A3 — DB unavailable at app startup (bypassing deps: `up -d app --no-deps --force-recreate`)

- Entrypoint runs migrations BEFORE listen; with `db` stopped the DNS name no
  longer resolves (`getaddrinfo ENOTFOUND db`), migration fails, process exits.
- Container **crash-loops**: RestartCount 0→7 in ~60s (`restart: unless-stopped`);
  `/api/health` never answers (process never listens).
- There is NO "alive-but-unready listening app" startup state in this topology:
  DB-unavailable-at-startup = restart loop, not a false-ready server.
- After `start db`, the app converges to listening in **~4s**.

### A3b — normal startup ordering (`docker compose up -d`)

- Compose printed `db … Waiting` → `db … Healthy` → `app … Started`: the
  `depends_on: condition: service_healthy` gate already exists and works.
  No second startup coordinator is needed or added by #547.

### A4 — Compose/Docker healthcheck semantics (verified + official docs)

- `docker inspect` exposes per-probe exit codes and the rolling status
  (`starting` → `healthy` / `unhealthy`).
- Docker docs (context7 `/docker/docs`): `retries` = consecutive failures needed
  to mark unhealthy; failures during `start_period` do NOT count toward
  retries; `timeout` kills an over-running probe (bounded probe execution).
  With interval 30s / retries 3, a steady DB loss flips the app container to
  `unhealthy` within ≈90s after the first failing probe.
- **Truthfulness (F3-05 scope):** in the direct-LAN topology nothing consumes
  Docker health status for traffic routing. `unhealthy` means "deployment
  readiness state / orchestration gate", NOT "traffic is blocked". No router is
  added by #547.

### B — background-loop reality (code + runtime evidence)

| Loop | Cadence (default) | First run | last-start/complete evidence | Failure evidence | Stall detection | Diagnostics | Structured error | Recovery | Classification input |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| heartbeat scanner | 30s (`HEARTBEAT_SCAN_INTERVAL_MS`) | first tick at +30s (no startup run) | `heartbeatMetrics.lastScanAt` set mid-cycle, **after** disruption leg, **before** incident-reconciliation leg completes | `level:50` "Error scanning for disrupted attempts" per cycle (captured live during A-window) | **NONE** — `lastScanAt` never analyzed; hung `activeScan` (B2) silently skips every later tick (`if (activeScan) return`) | `heartbeatStatus` block in `/api/system/diagnostics` (interval/timeout/lastScanAt/disruptedCount) | yes | next tick (throw); **none for hang** | candidate CRITICAL_EXAM_RUNTIME |
| deadline scanner | 30s (`DEADLINE_SCAN_INTERVAL_MS`, defaults to heartbeat interval) | first tick at +interval | `deadlineScannerMetrics.lastScanAt` after cycle | `level:50` "Error scanning for expired attempts" per cycle (captured live) | **NONE** — same `activeScan` shape | `deadlineScannerStatus` block | yes | next tick / none for hang | candidate CRITICAL_EXAM_RUNTIME |
| email outbox loop | 5s poll (`EMAIL_WORKER_POLL_INTERVAL_MS`) | startup (waits for org) | **durable** `worker_heartbeats` row (lastPollAt/lastSuccessAt/lastError) + org resolution | `poll cycle failed` level:50 + heartbeat `lastError` (captured live) | **indirect**: `buildEmailStatus` marks worker degraded when heartbeat stale (pull-only) | `emailStatus` block (stale-aware) | yes | supervised retry + recoverAbandoned | degraded operational service, NOT exam-traffic readiness |
| client-event retention | startup + 24h | startup run | logs only (deliberate #544 non-goal: no durable evidence) | `level:50` per-org + pass-level | none (acceptable — #544 explicitly rejected durable run evidence) | none | yes | next tick / next process start | DIAGNOSTIC_ONLY |

B2 hang proof (code): `heartbeat.ts:296-351` and `deadlineScanner.ts:338-361`
both guard ticks with `if (closing || activeScan) return;` and clear `activeScan`
only in `.finally`. A scan whose promise never settles leaves `activeScan != null`
forever: the process stays alive, `/api/health` stays 200, every subsequent tick
is skipped, and NO counter, timestamp, or log changes — silent work stoppage
invisible to every current surface (proven deterministic in the S3-style unit
test added by this task).

B4 bootstrap: no WARMING concept exists. `lastScanAt` is `null` until the first
cycle completes and diagnostics renders `null` — nothing distinguishes
"just started, first tick pending" from "stalled since start".

## 3. Baseline gaps #547 must close (and must NOT close)

1. Running-state DB loss keeps the deployment gate green (A1) — readiness gap.
2. No public, unauthenticated, DB-aware readiness surface a healthcheck can
   consume; the authenticated `/api/system/health` also mixes CPU/memory into
   its status (`computeStatus` ignores `dbResponseMs` for status — measured
   code: `systemMonitor.ts:23-29` uses only cpu/memory thresholds — but the
   ROUTE would still 500, not 503, on DB loss, and requires credentials).
3. Hung critical scanner = silent work stoppage (B2) — no bounded stall signal.
4. No active alert contract: everything is pull; a log line exists but has no
   stable machine semantics (event/component/state), dedupe, or transition rules.

NOT gaps (explicitly out of scope): no Prometheus/Grafana/OTel, no log shipping
(#312), no traffic router consuming health status, no auto-restart policy, no
Redis responsibility changes (#554), no durable alert ledger.
