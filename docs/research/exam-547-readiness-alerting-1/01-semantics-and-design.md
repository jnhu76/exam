# EXAM-547-READINESS-ALERTING-1 — Semantic freeze and readiness design gate

Authority for every implementation decision in this task. Baseline measurements:
[`00-baseline.md`](00-baseline.md). Alert contract: canonical home [`docs/operations/active-alerting.md`](../../operations/active-alerting.md) (evidence pointer: [`03-alert-contract.md`](03-alert-contract.md)).

## 1. Frozen four-layer semantic model

```text
LIVENESS ≠ READINESS ≠ DIAGNOSTICS ≠ ALERTING
```

| Layer | Question it answers | Authority surface | Dependency-blind? | Auth | Change by #547 |
| --- | --- | --- | --- | --- | --- |
| L1 liveness | Is the Fastify process/event loop responsive? | `GET /api/health` → `{status:"ok"}` | YES — DB/Redis/SMTP state never affects it | none | **none** (unchanged) |
| L2 readiness | Does this instance currently hold its MANDATORY serving dependencies (the ones whose loss makes exam traffic unservable)? | `GET /api/ready` → `200 {status:"ready"}` / `503 {status:"not_ready"}` | no — probes exactly the mandatory set (below) | none (see §5 abuse audit) | **new** |
| L3 diagnostics | Rich operator pull view (CPU, memory, DB latency, Redis, scanners, outbox, integrity) | `GET /api/system/health`, `GET /api/system/diagnostics` | no (by design) | SystemHealthView / SystemDiagnosticsView | extended (loop stall fields) — no semantic change to existing fields |
| L4 alerting | Machine-consumable transition signal for critical operational conditions, without an operator pulling | structured pino transition events `operability.*` + documented external hook contract | n/a | n/a (server-emitted) | **new** |

Measured facts that motivated the split:

- `computeStatus` (`packages/exam-engine/src/systemMonitor.ts`) uses ONLY cpu/memory
  thresholds (>95 critical / >80 degraded); `dbResponseMs` is displayed but never
  affects status. High CPU must not gate deployment readiness, and DB loss must not
  be representable as "degraded CPU-ish status" — the layers stay separate.
- Baseline A1: `/api/system/health` HANGS or 500s on DB loss (no bounded 503) —
  it can never be a healthcheck target even ignoring its auth requirement.

## 2. Mandatory-dependency set (L2)

| Dependency | Classification | Rationale (as-built responsibility, no #554 decisions) |
| --- | --- | --- |
| PostgreSQL | **READINESS_BLOCKING** (the only universal member) | Every exam read/write, auth, audit. Baseline A1: with PG down all business routes 500. `systemStatsRepo.pingDb()` is the canonical trivial probe (measured 0.75 ms healthy). |
| Redis, `REDIS_MODE=off` | NOT_RELEVANT | client never created |
| Redis, `REDIS_MODE=optional` | DEGRADED_ONLY | By design (runtimeConfig.ts): degrade to local rate-limit store; "startup never hangs and never crashes on Redis loss". Not a serving capability. |
| Redis, `REDIS_MODE=required` | **READINESS_BLOCKING while so configured** | Existing as-built responsibility: the DelegatingRateLimitStore fails CLOSED (503 RATE_LIMIT_UNAVAILABLE) when the runtime is unusable — the instance cannot serve limiter-covered traffic. Readiness mirrors the SAME existing authority: `redisRuntime.shouldUseRedis()` (state `ready` + client present). No new probe, no new state machine, no #554 decision — if #554 changes the responsibility model, this derivation follows the config-declared mode. |
| SMTP / email outbox worker | DEGRADED_ONLY | Email is an operational notification service; an SMTP outage must not mark the exam system unready (brief §23). Existing diagnostics already surface worker state (durable heartbeat + stale detection). |
| heartbeat scanner / deadline scanner / incident reconciliation | OPERABILITY (active stall alert), **NOT readiness-blocking** | Convergent on resume (under-lock canonical rechecks; arbiter convergence per #545). A stalled scanner delays bookkeeping/terminalization but the instance still serves exam traffic correctly; blocking readiness on it would restart-loop the app and HIDE the failure — the opposite of #547's goal. |
| client-event retention | DIAGNOSTIC_ONLY | #544 already decided: low-trust telemetry GC, logs only, no durable evidence. |

## 3. Readiness design gate (R0–R3)

### R0 — keep probing `/api/health` in Compose

**REJECTED.** Baseline A1 measured `healthy` for 150+ s of total DB loss. This
is the F3-05 gap itself; keeping it would fail the issue's acceptance criteria.

### R1 — Compose probes authenticated `/api/system/health`

**REJECTED.**
1. Requires SystemHealthView credentials inside Compose → a deployment secret
   whose leakage widens the diagnostics surface (CPU/memory/DB latency to an
   unauthenticated holder of the probe config).
2. Mixed semantics: status derives from cpu/memory; a busy-CPU instant would
   flap the deployment gate for a non-correctness reason.
3. Measured failure mode is 500/hang, not a bounded 503 — healthcheck probes
   would race Docker's 5 s timeout against postgres.js' 30 s connect budget.

### R2 — Compose probes PostgreSQL directly (pg_isready/SELECT 1 from app container)

**REJECTED as the readiness authority.** It proves DATABASE liveness, bypassing
the app's own pool, credentials, migration state, and network namespace; it
would also be a SECOND readiness authority beside the app's own view (brief
"no second authority"). The db service already has its own pg_isready
healthcheck for startup ordering (`depends_on`), which is the right and only
place for a database-container probe. (Application-level DB reachability is
still proven — but through the app: `/api/ready` runs the app's own
`pingDb()` through the app's own pool.)

### R3 — minimal public readiness endpoint `GET /api/ready` — **CHOSEN**

```text
GET /api/ready
200 {"status":"ready"}        — every mandatory dependency currently satisfied
503 {"status":"not_ready"}    — at least one mandatory dependency unusable
```

- Derivation: ONE function `probeApplicationReadiness(...)` = bounded
  `pingDb()` (Promise.race with a compile-time budget; timeout ⇒ not ready)
  + (if `REDIS_MODE=required`) `redisRuntime.shouldUseRedis()`.
  The SAME function feeds the readiness route, the readiness alert
  transitions, and (as the DB leg) nothing else — single derivation, no
  per-consumer logic drift.
- Response privacy: when the HANDLER runs, exactly `{status}` — no dependency
  names, no DB error text, no latency, no topology, no stack traces (brief §25;
  tested). One deliberate exception (adversarial-review F3): with
  `REDIS_MODE=required` and Redis unusable, the limiter fails closed BEFORE the
  handler and the answer is the standard 503 `RATE_LIMIT_UNAVAILABLE` envelope —
  same gate direction (503 = not ready). The route therefore schema-declares
  ONLY its 200 body: a second 503 schema would serialize-reject that envelope
  and mask the outage as a 500 (regression-pinned in readiness.test.ts).
- Liveness `/api/health` remains untouched.

### Public endpoint abuse audit (brief §10)

- Probe cost: one `SELECT id FROM organizations LIMIT 1` (measured 0.75 ms;
  indexed trivial table). No unbounded query, no write, no lock.
- Rate limiting: `/api/ready` stays INSIDE the /api scope's default limiter
  (100/min per IP, same as every /api route) — the limiter IS the
  anti-amplification bound. No `rateLimit:false` override.
- Compose healthcheck cadence: 1 probe / 30 s = 2/min from the container's own
  loopback — 50× under the limit; the healthcheck can never 429 itself.
  (A burst abuser gets 429 like any other route; readiness flapping under
  abuse is indistinguishable from any other rate-limited route and is bounded
  by the same limiter, which is the documented deployment policy since #546.)
- DB amplification ceiling: worst case = limiter max (100/min/IP) × trivial
  indexed query ≈ negligible vs. one heartbeat scan cycle.

## 4. Compose readiness gate

`app.healthcheck` switches its API leg from `/api/health` to `/api/ready`
(kept: the `/` SPA leg — the check still proves "this container can serve").

```text
test: node -e "…fetch('/api/ready')… fetch('/')…"   (image runtime; no curl/wget)
interval 30s | timeout 5s | retries 3 | start_period 30s   (unchanged — no widening)
```

- HTTP 503 → `response.ok === false` → probe exit 1 (non-zero): correct.
- Probe runtime bounded by Docker `timeout: 5s` (kills over-running probes) AND
  by the in-app probe budget (well under 5s) — double-bounded, no green-buying.
- `start_period 30s` covers app boot + migrations (measured boot ≪ 30s;
  failures inside start_period don't count toward retries — Docker docs).
- Unhealthy transition bound: ≤ interval×(retries) ≈ 90s after DB loss —
  documented as the deployment-gate detection latency.
- **Truthfulness:** in the direct-LAN topology nothing routes on health status.
  `unhealthy` = deployment readiness state / orchestration gate visibility, NOT
  "traffic blocked". No proxy/router is introduced by #547 (brief §13).
- Machine guard: `deployment-topology-contract.mjs` gains an assertion pinning
  the app healthcheck to `/api/ready` (regression: silently probing liveness
  again fails `pnpm verify:static`).

## 5. Background-loop classification (brief §23 output)

| COMPONENT | PRODUCT EFFECT IF STALLED | CURRENT RECOVERY | READINESS_BLOCKING | ACTIVE_ALERT | PULL_DIAGNOSTIC | RATIONALE |
| --- | --- | --- | --- | --- | --- | --- |
| heartbeat scanner (+ System incident reconciliation leg) | disruption detection + incident bookkeeping delayed; converges on resume (#545 arbiter) | next tick; none for hang | **no** | **yes** (`operability.background_loop`, component `heartbeat`) | diagnostics heartbeatStatus + stall fields | exam-time operability critical, but instance still serves traffic correctly |
| deadline scanner | expired attempts not terminalized/graded until resume; save-time deadline authority still enforced per request | next tick; none for hang | **no** | **yes** (component `deadline_scanner`) | diagnostics deadlineScannerStatus + stall fields | same |
| email outbox loop | notifications delayed; durable outbox preserves work | supervised retry + lock-timeout recovery + durable worker heartbeat (stale-aware diagnostics already exist) | **no** | **no new one** — existing worker-status degradation + error logs are the authority; adding a parallel in-memory stall alert would create a SECOND failure authority over the durable heartbeat | emailStatus block | degraded operational service, not exam traffic |
| client-event retention | telemetry GC delayed | next tick / next start | **no** | **no** | logs (by #544 decision) | low-trust telemetry; #544 explicitly rejected durable evidence |

System incident reconciliation runs INSIDE the heartbeat cycle — covered by the
heartbeat component's stall semantics (a hung reconciliation leg holds the whole
cycle's promise open).

## 6. Stall semantics and threshold (brief §16–§17)

Per critical scanner the plugin records (metrics objects extended in place):

```text
lastStartedAt   — tick body began
lastSettledAt   — tick body settled (success OR error — settle ≠ success)
activeSince     — non-null while a tick body is in flight
```

Classification (`WARMING | HEALTHY | ACTIVE | STALLED`), evaluated by the
monitor on its own cadence with an explicit `now`:

```text
no settle yet AND now - pluginStart < staleAfter      → WARMING   (no alert)
activeSince != null AND now - activeSince ≥ staleAfter → STALLED   (hang: B2)
activeSince == null AND lastSettledAt older than staleAfter → STALLED (timer dead: B3)
activeSince != null (within bound)                     → ACTIVE   (no alert)
otherwise                                              → HEALTHY  (no alert)
```

- `staleAfter = k × configured interval`, **k = 4** (compile-time policy, no env
  knob). Rationale: heartbeat/deadline cadence is 30 s default; one legitimate
  long cycle — #545-measured worst-case reconciliation leg (10k-id probe chunks,
  50 k episodes) ≈ 0.5 s probe wall-time plus per-episode work, well under one
  interval, but DB contention can legitimately stretch a cycle across a couple
  of intervals — k=4 tolerates that without false alerts while bounding true
  detection to ≤ ~4 intervals (~2 min at defaults). Any k<3 risks a false
  stalled alert during a legitimately long cycle; k>8 would let a real stall
  ride for most of an exam session's critical window.
- Errors that SETTLE a cycle (throw → catch → settle) are NOT stall: DB-down
  cycles settle every interval and are covered by the readiness alert — one
  condition, one alert authority (no double-alerting).
- WARMING uses the same `staleAfter` from plugin registration as the grace:
  the first tick fires at +interval; grace = 4×interval covers first-cycle
  work before any settled evidence exists. A process whose first cycle hangs
  becomes STALLED at the same threshold as any other hang (no special case).

## 7. Alert transition dedupe (brief §22)

Process-local `lastEmittedState` per (event, component). One log line per
STATE TRANSITION only: `ok→unavailable` (error), `unavailable→ok` (info,
"recovered" — info because it is a resolution, not a degraded state). Repeated
identical evaluations emit nothing. Restart re-emitting a current outage is
allowed and documented; alert state is NOT readiness truth, NOT scanner truth,
NOT durable business state, and gets NO table/Redis/ledger.

## 8. Implementation map (minimal diff, no framework)

| Change | File(s) |
| --- | --- |
| readiness probe + monitor plugin (probe fn, stall classifier, transition dedupe, timers) | `apps/api/src/plugins/operabilityMonitor.ts` (new; logic exported pure for tests, plugin shape follows deadlineScanner pattern) |
| `GET /api/ready` route (next to `/api/health`, same scope/limiter) | `apps/api/src/routes/apiSurface.ts`, schema beside `healthSchema.ts` |
| scanner metrics: lastStartedAt/lastSettledAt/activeSince | `apps/api/src/plugins/heartbeat.ts`, `apps/api/src/plugins/deadlineScanner.ts` (existing metrics objects, in place) |
| diagnostics expose stall fields (typed contract) | `packages/contracts` diagnostics schema, `apps/api/src/routes/system.ts` |
| Compose healthcheck → `/api/ready` + contract guard | `docker-compose.yml`, `scripts/repository-contract/deployment-topology-contract.mjs` |
| executable deployment evidence D1–D4 | `tests/deployment/readiness-gate.sh` (+ `test:deployment:readiness` script, wired into `test:deployment` chain) |
| operator docs (layer table, alert hook contract) | `docs/operations/README.md`, `docs/deployment/mvp-deployment-runbook.md` |

Explicitly NOT built (scope guards, brief §28): no ProbeRegistry /
HealthFramework / generic scheduler, no Prometheus/OTel/Loki, no webhook
subsystem, no durable alert table, no Redis alert state, no auto-restart, no
traffic router, no new env knobs.

## 9. Test matrix (brief §30)

| Layer | File | Covers |
| --- | --- | --- |
| pure unit | `apps/api/src/plugins/operabilityMonitor.test.ts` | readiness classification (PG ok/down/timeout; redis off/optional+down/required+down), stall S1–S5 (normal/bootstrap/hung/repeat-eval/recover), transition dedupe (exactly-one, no storm), threshold derivation |
| pure unit (scanner seam) | existing `heartbeat.test.ts` / `deadlineScanner.test.ts` extended | started/settled/active bookkeeping on start/complete/throw/hang |
| Fastify integration | new readiness route test + existing route-test harness | 200/503, response privacy, rate-limit coexistence (healthcheck cadence never 429s) |
| real deployment | `tests/deployment/readiness-gate.sh` | D1 healthy, D2 DB-down (liveness 200 / ready 503 / compose unhealthy / same container), D3 recovery (ready 200 / healthy / no restart), D4 depends_on ordering — all bounded polling |
