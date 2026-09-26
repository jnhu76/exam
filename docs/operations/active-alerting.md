# EXAM-547 — Active alert contract (L4) and external hook

The machine-consumable seam #547 adds. Everything here is emitted by the
operability monitor (`apps/api/src/plugins/operabilityMonitor.ts`), pinned by
unit tests (`operabilityMonitor.test.ts`); the readiness leg was additionally
validated against a real stack during #547 acceptance.

## 1. Event catalogue

All events are pino JSON lines on the app's **stdout** (the same stream every
other structured log uses — no second channel, no buffering, no batching).

| event | component | state | level | meaning |
| --- | --- | --- | --- | --- |
| `operability.readiness` | `database` | `unavailable` | error | PostgreSQL unusable through the app's own pool (probe threw or exceeded the 2s budget) — the instance cannot serve exam traffic correctly |
| `operability.readiness` | `database` | `recovered` | info | PostgreSQL usable again |
| `operability.readiness` | `redis` | `unavailable` | error | `REDIS_MODE=required` and the Redis runtime is unusable (the same condition that fails limiter-covered requests closed) |
| `operability.readiness` | `redis` | `recovered` | info | required-mode Redis usable again |
| `operability.background_loop` | `heartbeat` | `stalled` | error | no settled heartbeat-scanner cycle within 4× the configured scan interval (hung in-flight cycle or dead timer) — disruption detection / incident reconciliation is not progressing |
| `operability.background_loop` | `heartbeat` | `recovered` | info | settled cycles resumed |
| `operability.background_loop` | `deadline_scanner` | `stalled` | error | deadline scanner likewise not progressing — expired attempts are not being terminalized |
| `operability.background_loop` | `deadline_scanner` | `recovered` | info | settled cycles resumed |

Example lines:

```json
{"level":50,"time":...,"event":"operability.readiness","component":"database","state":"unavailable","msg":"Mandatory dependency unavailable: database — instance not ready for exam traffic"}
{"level":30,"time":...,"event":"operability.readiness","component":"database","state":"recovered","msg":"Mandatory dependency recovered: database"}
{"level":50,"time":...,"event":"operability.background_loop","component":"heartbeat","state":"stalled","msg":"Critical background loop stalled: heartbeat (no settled cycle within 120s)"}
```

## 2. Stability and content guarantees

- `event`, `component`, `state` are STABLE fields (contract; adding a new
  component/value is additive and must update this file).
- Exactly ONE line per state transition (dedupe is process-local; repeated
  evaluations are silent). No log storms by construction — pinned by tests.
- Emitted on the monitor's own 15s cadence; detection latency for a DB loss is
  ≤ ~15s + probe time, well ahead of the Compose unhealthy flip (~90s).
- NO secrets, NO candidate data, NO answer data, NO SQL text, NO topology
  detail. The message strings above are the entire information content beyond
  the three stable fields.
- A process restart re-emits a CURRENT outage once. That is allowed and
  intended (alert state is not durable, by decision — no table, no Redis, no
  ledger; alert state is not business state).

## 3. Minimal external hook contract

An external watcher needs nothing beyond the app's stdout JSON:

```text
CONSUME app stdout JSON (journald / Docker logging driver / Loki / custom)
IF   level >= 50 (error)
AND  event   in { "operability.readiness", "operability.background_loop" }
AND  state   in { "unavailable", "stalled" }
THEN page / notify the operator.

IF   event matches AND state == "recovered"
THEN clear / resolve the corresponding notification
     (key = event + component).
```

- The clear key is `(event, component)`; there is at most one active failure
  per key.
- `#547 does NOT require any platform` (no Prometheus, Grafana, OTel, Loki,
  PagerDuty, Slack, webhook). #312 (optional external log shipping) remains a
  separate, demand-driven task and is NOT needed to consume this contract.
- Coarse-but-useful fallback for existing deployments: alerting on
  `docker inspect` health going `unhealthy` (≈90s slower, no recovery
  semantics) — the structured events above are the primary contract.

## 4. What is deliberately NOT alerted

- **Email outbox / SMTP failures** — already covered by the existing durable
  `worker_heartbeats` degradation surface (diagnostics `emailStatus.worker`)
  and per-cycle error logs; a second in-memory stall alert over the same
  condition would create a second failure authority.
- **Client-event retention failures** — #544 decision: low-trust telemetry GC,
  logs only.
- **CPU / memory pressure** — diagnostics-only; never an alert condition and
  never readiness-relevant (01-semantics §1).
- **Transient scanner errors** (e.g. DB-down cycles that THROW) — those
  settle, are logged by the scanners themselves, and DB loss is owned by the
  readiness events. STALLED means no observable progress.
