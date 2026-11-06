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
| `operability.tick_failure` | `heartbeat` | `failing` | error | a monitor sample read at least 4 consecutive heartbeat-scanner ticks whose body THREW (the exception reached the tick-level catch) — the loop keeps settling, so this is invisible to the stall fact, and the throw freezes the business-failure counter. Root cause, business outcome and backlog state are NOT asserted |
| `operability.tick_failure` | `heartbeat` | `recovered` | info | a settled heartbeat tick without a throw interrupted the run and the sampled counter is below 4 (tick exceptions cleared; latest tick and business restoration unknown) |
| `operability.tick_failure` | `deadline_scanner` | `failing` | error | a monitor sample read at least 4 consecutive deadline-scanner ticks whose body THREW — the loop keeps settling, so this is invisible to the stall fact, and the throw freezes the business-failure counter. Root cause, business outcome and backlog state are NOT asserted |
| `operability.tick_failure` | `deadline_scanner` | `recovered` | info | a settled deadline-scanner tick without a throw interrupted the run and the sampled counter is below 4 (tick exceptions cleared; latest tick and business restoration unknown) |

Example lines:

```json
{"level":50,"time":...,"event":"operability.readiness","component":"database","state":"unavailable","msg":"Mandatory dependency unavailable: database — instance not ready for exam traffic"}
{"level":30,"time":...,"event":"operability.readiness","component":"database","state":"recovered","msg":"Mandatory dependency recovered: database"}
{"level":50,"time":...,"event":"operability.background_loop","component":"heartbeat","state":"stalled","msg":"Critical background loop stalled: heartbeat (no settled cycle within 120s)"}
{"level":50,"time":...,"event":"operability.business_failure","component":"deadline_scanner","state":"failing","msg":"Critical background loop persistently failing: deadline_scanner (4 consecutive ticks with business failures)"}
{"level":30,"time":...,"event":"operability.business_failure","component":"deadline_scanner","state":"recovered","msg":"Critical background loop business failures cleared: deadline_scanner"}
{"level":50,"time":...,"event":"operability.tick_failure","component":"heartbeat","state":"failing","msg":"Critical background loop tick exceptions: heartbeat (4 consecutive ticks threw; root cause unknown)"}
{"level":30,"time":...,"event":"operability.tick_failure","component":"heartbeat","state":"recovered","msg":"Critical background loop tick exceptions cleared: heartbeat (a settled tick without a throw interrupted the run; business restoration unknown)"}
```

The business-failure threshold is compile-time policy
(`BUSINESS_FAILURE_TICK_THRESHOLD = 4` consecutive failed ticks, no env knob).
The tick-failure leg deliberately reuses the same constant as an initial
escalation policy; this does not assert that the two facts have equivalent
consequences or that 4 is a tuned SLA. A future change must review both
heartbeat/deadline-scanner alerts and the retention business-failure alert that
shares the constant.
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

### Tick-level throws (#885, ADR-024)

A tick-level throw is a distinct fact from a business failure, a stall and a
dependency outage:

- `failing` is emitted only when a **monitor sample actually reads** a
  `consecutiveThrowTicks` value of at least 4 and the transition tracker allows
  a new failure. Reaching 4 is not itself an event. A throw settles (so the
  stall fact stays healthy) and freezes the business-failure counter (so #862
  stays silent); without this event a loop may throw forever with no escalation.
- It asserts ONLY the sampled run of throws. It does NOT assert that the
  database is or is not the root cause — the readiness probe covers
  `organizations LIMIT 1` and says nothing about the scanners' own query paths
  (the #885 study injected a PostgreSQL-shaped `42703` error through a fake db
  and observed it coexisting with a healthy probe on every sample; that is a
  simulated error, not a real-PostgreSQL fault) — nor that business processing
  failed, nor that a backlog is or is not converging.
- `recovered` is emitted when a sample reads a value below the window after a
  previously observed failure. The narrow fact is: **a settled tick without a
  throw interrupted the run, and the sampled counter is currently below 4.**
  The exact message is: `Critical background loop tick exceptions cleared:
  <component> (a settled tick without a throw interrupted the run; business
  restoration unknown)`.
  It does NOT mean the latest settled tick was clean, the counter is currently
  0, the business work succeeded, the underlying fault was fixed, or pending
  work is drained. For example, a sampled sequence
  `C=4 -> clean -> throw -> throw -> throw -> sampled C=3` can emit
  `recovered` even though the latest tick threw.

#### Sampling boundary (normative)

Let `S` be the scanner interval, `M` the monitor interval, and `K = 4`.
`r_j` is the actual monitor read point, **not** the monitor timer trigger:
the readiness probe is awaited first. The `C >= K` state for a finite run
exists only from the Kth throw's settle until the next clean settle. A read
must fall inside that interval to produce `failing`.

- A state residency `W` strictly greater than the maximum actual-read gap `G`,
  with sampling continuing, is sufficient coverage. When `W == G`, same-time
  execution order decides; no guarantee follows without an ordering proof.
- **`S >= M` is not a general sufficient condition, and the default 30s/15s
  configuration is not one either.** Variable-length ticks, readiness awaits
  and same-time scheduling can move the read past the window.
- If the process stays alive, throwing ticks keep settling and the monitor
  keeps reading, a continuing run is eventually observed. There is no
  unconditional finite-run completeness guarantee and no wall-clock detection
  SLA.
- A hung tick does not increment the counter; an overlap-skipped tick is not a
  settled tick; a restart loses process-local history; monitor starvation
  provides no detection deadline.
- If `K -> clean -> K` happens entirely between samples, the tracker can keep
  the same alert cycle and no `recovered` is observed. That is a sampling
  boundary, not a claim that the run never ended.
- A repeating `3 throws -> 1 clean` pattern never reaches `K`: that is the
  threshold-policy boundary, not a sampling miss.

The default-configuration counterexample is part of the contract:

```text
S=30s, M=15s, K=4
scanner starts at 30, 60, 90, 120, 150.
The first three throw and settle immediately. The fourth starts at 120 and
throws/settles at 149. The monitor reads C=3 at 135.
The monitor starts at 150 but its readiness probe takes 1s, so it reads at 151.
The scanner's next tick starts at 150 and clean-settles at 150.1, resetting C.
C>=4 exists only in approximately [149, 150.1); no failing event is produced.
```

No unsupported interval or monitor starvation is needed for this miss. The
fourth tick takes about 29s and the readiness wait is 1s. The product boundary
test executes the real scanner and monitor ordering.

- A throw run may coexist with a stale `operability.business_failure` `failing`
  line from before the throws started (that counter is frozen, so it neither
  clears nor advances). Do not read the stale line as fresh evidence, and do
  not expect a recovery for it until a clean settle occurs (#895).
- Accepted boundary: the counter is strictly consecutive, so a high-duty-cycle
  intermittent pattern (3 throwing ticks, then 1 clean tick, repeating) never
  reaches the threshold. A windowed policy would add state and needs its own
  decision.
- Scope: only the `heartbeat` and `deadline_scanner` loops emit this event. The
  client-event retention loop has the same freeze/settle shape but a daily
  cadence and the #544 evidence boundary, so a throw run there remains covered
  only by its per-pass ERROR logs.

### Diagnostics projection of the escalation counter (#886)

`GET /api/system/diagnostics` exposes the **business-failure** escalation input
for the two exam loops as read-only fields:
`heartbeatStatus.consecutiveFailedTicks` and
`deadlineScannerStatus.consecutiveFailedTicks`. They are a projection of the
same counter this contract describes — no second authority. The #885 throw-run
counter (`consecutiveThrowTicks`) is deliberately NOT projected: a read-only
field does not close an alert gap, and adding it would widen the response
contract without changing what pages anyone.

- consecutive SETTLED ticks with business failures; the first clean settle
  resets to 0; a tick-level throw freezes it (§4);
- process-local: a restart starts from 0, like every alert state here;
- NOT the cumulative `failedCount` also present in diagnostics: a loop can
  show a high lifetime failure count with `consecutiveFailedTicks === 0`
  (intermittent failures), or a fresh run climbing from 0;
- the alert threshold stays the monitor's compile-time policy
  (`BUSINESS_FAILURE_TICK_THRESHOLD = 4`). The counter is the INPUT: a value
  ≥ 4 does not by itself confirm that a stdout
  `operability.business_failure` line was produced or delivered — the
  monitor evaluates on its own cadence, and delivery depends on the stdout
  hook (§3).

## 2. Stability and content guarantees

- `event`, `component`, `state` are STABLE fields (contract; adding a new
  component/value is additive and must update this file).
- At most ONE line per state transition (dedupe is process-local; repeated
  evaluations are silent). No log storms by construction — pinned by tests.
  A line produced is not proof that stdout delivered it: a lost failing line
  can suppress the notification until the state changes again, and a lost
  recovered line can leave an external notification stale-open.
- Evaluated on the monitor's own 15s cadence; detection latency for a DB loss is
  ≤ ~15s + probe time under normal monitor scheduling, well ahead of the
  Compose unhealthy flip (~90s). Monitor starvation or a delayed readiness
  probe extends that bound.
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
                  "operability.business_failure", "operability.tick_failure" }
AND  state   in { "unavailable", "stalled", "failing" }
THEN page / notify the operator.

IF   event matches AND state == "recovered"
THEN clear / resolve the corresponding notification
     (key = event + component).
```

- The clear key is `(event, component)`; there is at most one active failure
  per key.
- `operability.tick_failure` is a NEW event value (#885): a watcher that has
  not been updated will not page on it. During a database outage
  `readiness/database` and `tick_failure/<loop>` can fire for the same root
  cause — two true facts on distinct keys. Correlate and dedupe at the
  notification layer; the app deliberately performs no causal suppression.
- The tracker updates before the stdout call. If a failing transition line is
  lost, it is not re-emitted while the state is unchanged, so the operator may
  receive no notification at all; if a recovered line is lost, an external
  notification may stay stale-open. Neither loss is uniformly fail-safe.
- A restart does not emit a recovery for the previous process. Cross-process
  notification cleanup is an external lifecycle policy, not an application
  guarantee.
- A single database fault on one instance can produce up to 3 failing and 3
  recovered transitions: `readiness/database` plus `tick_failure/heartbeat` and
  `tick_failure/deadline_scanner`. Whether that becomes one, two or three
  notifications is watcher policy; this contract does not add application-level
  correlation.
- A watcher must key facts by both `event` and `component`. Multi-instance
  source partitioning and cross-instance notification merging belong to the
  deployment; do not let one instance's `recovered` clear another instance's
  active failure.
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
- **A single transient scanner error** — one throwing cycle settles, is logged
  by the scanner itself, and stays below the throw-run threshold. Only a
  PERSISTENT run escalates, as `operability.tick_failure` (#885; heartbeat and
  deadline_scanner only, see §1 scope). STALLED means no observable progress; a
  throw is not a stall.
- **Root-cause attribution for throws** — `operability.tick_failure` reports
  the run of exceptions, never the cause. A tick-level throw also never advances
  the business-failure escalation counter (#862), so a database outage can raise
  `operability.readiness/database` and, when it also makes the scanners throw, a
  separate `operability.tick_failure` per loop — up to three true facts, not one
  fact stated twice. Their correlation belongs to the external watcher
  (ADR-024).
- **Occasional business failures** — a failed auto-submit or disruption is
  retried on the next cadence and stays at the existing per-item ERROR /
  aggregate INFO logs. Only PERSISTENT failure (4 consecutive failed ticks)
  escalates as `operability.business_failure` (#862); intermittent failures
  below that threshold are deliberate non-alerts.
