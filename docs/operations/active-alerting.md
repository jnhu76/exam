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
| `operability.background_loop` | `client_event_retention` | `stalled` | error | the retention sweep is not progressing — expired client_events are never reclaimed (a never-fired or hung sweep; daily cadence, so detection is on the order of days) |
| `operability.background_loop` | `client_event_retention` | `recovered` | info | settled cycles resumed |
| `operability.business_failure` | `heartbeat` | `failing` | error | 4 consecutive settled heartbeat ticks with business failures on either leg (disruption or incident reconciliation) — the tick loop is alive but its work is not succeeding |
| `operability.business_failure` | `heartbeat` | `recovered` | info | a settled heartbeat tick with zero failures on both legs |
| `operability.business_failure` | `deadline_scanner` | `failing` | error | 4 consecutive settled deadline-scanner ticks with candidate failures — expired attempts are repeatedly failing to auto-submit (retried every cadence, not converging) |
| `operability.business_failure` | `deadline_scanner` | `recovered` | info | a settled deadline-scanner tick with zero failures |
| `operability.business_failure` | `client_event_retention` | `failing` | error | 4 consecutive retention passes each with at least one failed organization — expired rows are repeatedly failing to delete (daily cadence: 4 consecutive failed DAYS) |
| `operability.business_failure` | `client_event_retention` | `recovered` | info | a settled retention pass with zero failed organizations (zero deleted rows is a clean pass — no expired data is not a failure) |

Example lines:

```json
{"level":50,"time":...,"event":"operability.readiness","component":"database","state":"unavailable","msg":"Mandatory dependency unavailable: database — instance not ready for exam traffic"}
{"level":30,"time":...,"event":"operability.readiness","component":"database","state":"recovered","msg":"Mandatory dependency recovered: database"}
{"level":50,"time":...,"event":"operability.background_loop","component":"heartbeat","state":"stalled","msg":"Critical background loop stalled: heartbeat (no settled cycle within 120s)"}
{"level":50,"time":...,"event":"operability.business_failure","component":"deadline_scanner","state":"failing","msg":"Critical background loop persistently failing: deadline_scanner (4 consecutive ticks with business failures)"}
{"level":30,"time":...,"event":"operability.business_failure","component":"deadline_scanner","state":"recovered","msg":"Critical background loop business failures cleared: deadline_scanner"}
```

The business-failure threshold is compile-time policy
(`BUSINESS_FAILURE_TICK_THRESHOLD = 4` consecutive failed ticks, no env knob).
Alert state is process-local: a restart resets the counter to zero and a
persistent outage re-raises only after the threshold re-accumulates (the
restarted process must re-observe the failure before claiming it).

Recovery semantics (#862): the escalation input is a run-length counter of
consecutive FAILED ticks — it never observes success. Any settled tick with
zero failures breaks the run and emits `recovered`, whether that tick was idle
(no candidates discovered) or successful (submissions/marks created). An idle
tick is still genuine condition-level recovery for these loops: their failing
populations are self-retried persistent work — an expired attempt stays a
deadline candidate until terminalized (or its deadline is extended), a stale
attempt stays disruption-eligible until disrupted, resumed, or terminalized,
and an unreconciled episode stays pending until its incident exists — so a
previously-failing candidate can only leave discovery by being resolved. For
this state-condition alert, "no failing work observed" and "business failures
cleared" are therefore one fact; there is deliberately no separate
NO_FAILURE_OBSERVED state. A tick that THROWS, by contrast, carries no
business-failure evidence in either direction and freezes the counter (§4).

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
AND  event   in { "operability.readiness", "operability.background_loop",
                  "operability.business_failure" }
AND  state   in { "unavailable", "stalled", "failing" }
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
- **Per-pass client-event retention detail** — #544 kept GC itself
  durable-evidence-free (logs only per pass) and that boundary stands:
  deleted counts and individual per-organization failures are NOT alerts.
  #871 added only the LOOP-level facts this contract already uses everywhere
  else (see §1): a never-fired or hung sweep raises
  `operability.background_loop/client_event_retention/stalled`, and a run of
  failed daily passes escalates on the shared
  `operability.business_failure` shape (daily cadence → threshold = 4
  consecutive failed days). No `cleanup_runs` table, no second evidence
  subsystem (#544 §9 boundary).
- **CPU / memory pressure** — diagnostics-only; never an alert condition and
  never readiness-relevant (01-semantics §1).
- **Transient scanner errors** (e.g. DB-down cycles that THROW) — those
  settle, are logged by the scanners themselves, and DB loss is owned by the
  readiness events. STALLED means no observable progress. A tick-level throw
  also never advances the business-failure escalation counter (#862): DB-down
  cycles raise `operability.readiness/database`, not a second concurrent
  business-failure alert for the same root cause.
- **Occasional business failures** — a failed auto-submit or disruption is
  retried on the next cadence and stays at the existing per-item ERROR /
  aggregate INFO logs. Only PERSISTENT failure (4 consecutive failed ticks)
  escalates as `operability.business_failure` (#862); intermittent failures
  below that threshold are deliberate non-alerts.
