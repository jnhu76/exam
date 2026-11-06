# ADR-024 — Tick-level throw escalation (`operability.tick_failure`)

## Status

- Status: **ACCEPTED** — the project Owner explicitly approved the
  independent, monitor-sampled `operability.tick_failure` decision on
  2026-11-06 and authorized PR #896 to merge. The acceptance retains the
  shared initial threshold `K = 4` and the documented sampling limitations:
  finite throw runs can be missed, and no universal detection SLA, root-cause
  attribution, business restoration, or operator-notification delivery is
  guaranteed. This decision becomes binding on `master` when PR #896 merges.
- Date: 2026-11-05 (contract precision revised 2026-11-06; Owner accepted 2026-11-06)
- Decision owners: project (explicit Owner approval, PR #896, 2026-11-06)
- Supersedes: none — **revises** one paragraph of
  [`docs/operations/active-alerting.md`](../operations/active-alerting.md) §4
  ("Transient scanner errors")
- Related: ADR-018 (operational observability window), #547 (active alert
  contract), #862 (persistent business failure), #885 (research verdict GO_C),
  #895 (stale business-failure coexistence)

## Context

#885 established, by source reading and by a reproducible fault-injection study
(`research/issue-885/`), that three independent mechanisms suppress every
escalation for a loop that **settles but throws on every tick**:

1. `lastSettledAt` is stamped in `.finally()` — a throwing tick still settles,
   so `classifyLoopStall` reads `healthy` and no `operability.background_loop`
   event is produced;
2. `consecutiveFailedTicks` is advanced inside the `try` body — a throw freezes
   it below `BUSINESS_FAILURE_TICK_THRESHOLD`, so no
   `operability.business_failure` event is produced;
3. the readiness probe covers `organizations LIMIT 1`, not the scanners' own
   query paths, so a throw with the database reachable stays silent — and a
   *healthy probe does not prove the throw's root cause is non-database*
   (the #885 study injected a PostgreSQL-shaped `42703` error through the fake
   database and observed it coexisting with a healthy probe on every sample;
   that is a simulated error, not a real-PostgreSQL fault injection).

The only remaining signal was a per-tick ERROR log, which the §3 external hook
whitelist did not page on, so the blind spot was unbounded in the running
process.

### The facts this decision keeps distinct

| Fact | What is observable | What is not asserted |
| --- | --- | --- |
| dependency/readiness | the mandatory dependency probe succeeded or failed | that a scanner throw has the same cause |
| stall | the loop has no expected progress or settle | that a settling-but-throwing loop is stalled |
| business failure | a settled tick observed business work failing | that a thrown tick's business work failed or succeeded |
| tick failure | a run of tick-level throws reached the sampling threshold | root cause, business outcome, backlog state, delivery to an operator |

A tick can complete part of its business work and then throw. `settled` means
the tick body finished, either normally or by exception. Readiness being healthy
does not prove an exception is not database-caused, and readiness being
unhealthy does not prove it is. One root cause (for example, a database failure)
can produce several different facts: readiness, `tick_failure` for heartbeat,
and `tick_failure` for deadline_scanner. Those are distinct observations, not a
duplicate authority.

## Decision

Add a fourth fact family to the #547 contract:

- event `operability.tick_failure`
- components `heartbeat`, `deadline_scanner`
- states `failing` (error) and `recovered` (info)
- input: a process-local `consecutiveThrowTicks` run-length counter per scanner,
  incremented when the tick body throws into the tick-level `catch`, reset to 0
  by a tick that settles without throwing
- policy: `failing` when a monitor read observes `consecutiveThrowTicks >= K`,
  where `K = BUSINESS_FAILURE_TICK_THRESHOLD = 4`, and the tracker permits a
  transition. The threshold is compile-time policy, not an env knob.

`failing` asserts only that a monitor sample observed a run of at least four
consecutive tick-level throws. It does not assert that the database is or is not
the cause, that business processing failed, or that a backlog is converging.

`recovered` asserts only that a settled tick without a throw interrupted the run
and the current sampled counter is below `K`. It does not assert that the latest
tick was clean, that the counter is currently 0, that business work succeeded,
that the root cause was fixed, or that pending work was drained. Business
restoration remains unknown.

### Sampling contract (normative)

Definitions:

- `S`: scanner configured interval; `M`: monitor configured interval;
  `K = 4`.
- `a_i`: the actual start of scanner tick `i`; `e_i`: the moment its
  `.finally()` updates the counter.
- `r_j`: the actual moment monitor sample `j` reads the counter. This is after
  the readiness probe await and is not the monitor timer's trigger time.
- `C(t)`: the process-local consecutive-throw counter.
- `A(t)`: the transition tracker's stored state for the tick-failure fact.

The guarantees are:

1. **Reaching the threshold is not an event.** A new `failing` transition is
   produced only when a monitor sample actually reads `C >= K` and the tracker
   allows the transition. A count reaching `K` with no read while it is visible
   produces nothing.
2. For a finite throw run, the `C >= K` state exists only from the settle of
   the `K`th consecutive throw until the next clean settle. Only a read inside
   that interval can observe it.
3. If the state's residency time `W` is strictly greater than the maximum gap
   `G` between relevant actual reads, and sampling continues, that is a
   sufficient condition for coverage. When `W == G`, same-time execution order
   matters and no guarantee follows without an ordering proof.
4. **`S >= M` is not a general sufficient condition, and neither is the
   default `S = 30 s`, `M = 15 s`.** Variable-length ticks, readiness-probe
   awaits, and same-time timer scheduling can compress or move the visible
   window past a read. A monitor sample may trigger at the end of the window
   but perform its read after the counter has reset.
5. If the process stays alive, throwing ticks keep settling, and the monitor
   keeps reading, a continuing throw run is eventually observed. There is no
   unconditional completeness guarantee for finite runs and no wall-clock
   detection SLA.
6. A hung tick does not increment the throw counter. An overlap-skipped tick is
   not a settled tick and does not update it. A restart loses process-local
   history. Monitor starvation provides no detection deadline.
7. A repeating `3 throws -> 1 clean` pattern never reaches `K`: that is the
   threshold-policy boundary. A run that reaches `K` but disappears between
   samples is the sampling boundary. They are different failures and must not
   be described as one.

The default configuration counterexample that the contract must carry:

```text
S = 30s, M = 15s, K = 4
scanner starts: 30, 60, 90, 120, 150
the first three throw and settle immediately; the fourth starts at 120 and
throws/settles at 149.
the monitor reads C=3 at 135.
the monitor starts at 150 but its readiness probe takes 1s, so it reads at 151.
the scanner's next tick starts at 150 and clean-settles at 150.1, resetting C.
Therefore C>=4 exists only in approximately [149, 150.1), and no failing event
is produced.
```

This needs no unsupported interval, no monitor starvation, and no tick longer
than the scanner cadence: the fourth execution takes about 29 s and the
readiness wait is 1 s. A regression test executes the real scanner and monitor
path with this ordering; a manually assigned counter is not sufficient evidence
for the scheduling claim.

A second boundary follows from the same contract: if `K -> clean -> K` happens
entirely between two samples, the tracker can see the same alert state twice and
does not observe the intervening `recovered`. That is allowed by the sampling
contract; it is not a claim that the exception run never ended.

### Recovery semantics

The exact production recovery message is:

```text
Critical background loop tick exceptions cleared: heartbeat (a settled tick without a throw interrupted the run; business restoration unknown)
```

The monitor observes the counter, not every tick. A sequence such as:

```text
sample C=4 -> clean -> throw -> throw -> throw -> sample C=3
```

is allowed to emit `recovered` even though the latest settled tick threw. The
wording above is therefore the only supportable claim. “The last settled tick
did not throw” is false in general and is not part of this contract.

Recovery does not mean the counter is currently 0; later throws can have
re-accumulated it to 3 before the sample. It does not mean business work
succeeded, the underlying fault was fixed, or pending work drained.

### Shared threshold policy

The existing `BUSINESS_FAILURE_TICK_THRESHOLD = 4` and the existing shared
classifier are retained. Sharing the number is the current initial escalation
policy; it does not prove that a business failure and a tick exception have
equivalent consequences, and it is not an independently tuned SLA. Any future
change to the threshold must review both alerts for `heartbeat` and
`deadline_scanner`, plus the retention business-failure alert that actually
shares the constant. The existing pins (`.toBe(4)`, the literal-4 message
assertion, and the 3/4 boundary tests) are the verification of that policy.

### Event, delivery and notification are separate layers

```text
observable fact -> structured event -> stdout delivery -> operator notification -> incident response
```

This decision closes the gap from an in-process fact to a structured
transition. It does not prove that stdout is delivered, that a watcher is
deployed, or that an operator received a notification.

- The tracker updates before the log call. If the failing line is lost, the
  transition may never be re-emitted while the state is unchanged, so the
  operator can receive no notification at all. If a recovered line is lost, an
  external watcher can remain stale-open. Neither loss is uniformly
  fail-safe.
- A transition is not automatically re-sent just because the state persists.
- A restart does not emit a recovery for the previous process. Cross-process
  alert lifecycle belongs to the external deployment policy.
- A watcher must recognize `operability.tick_failure`; until its whitelist is
  updated, the structured log line is not an operator notification.
- Within one source, facts are keyed by `(event, component)`. Multi-instance
  source partitioning and notification merging belong to deployment; this
  decision adds no application field or notification system.
- One database fault on one instance can produce readiness plus two scanner
  `tick_failure` facts: up to 3 failing and 3 recovered transitions (6 total),
  not 5. How many notifications that becomes is watcher policy.

## Alternatives considered

- **Status quo / external ERROR aggregation (A).** Rejected: the per-tick
  ERROR line has no stable event/component, recovery would be inferred from
  absence (indistinguishable from stdout loss), and every deployment would have
  to build counting, dedupe and recovery itself.
- **Fold throws into `business_failure` (B).** Rejected: it emits a literally
  false “N consecutive ticks with business failures” message for a pure throw
  run, breaks the #862 freeze regression tests, and creates a second authority
  over the same event key. The freeze semantics of `consecutiveFailedTicks`
  remain untouched.
- **Suppress `tick_failure` while readiness is unavailable (D).** Rejected:
  readiness health does not prove root-cause identity, suppression hides a
  coincident independent bug, and the #885 study measured phantom
  raise/recover transitions at the readiness-recovery boundary.
- **Monotonic failure sequence or state latch.** A latch can reduce sampling
  blind spots, but adds durable-ish state, a consumer protocol, and new
  recovery semantics. It is not required to state the existing mechanism
  truthfully and is out of scope here.
- **Emit the transition directly at settle time.** Feasible, but it would move
  the monitoring boundary into every scanner and bypass the monitor's single
  transition owner. The current sampled design is retained; the sampling
  boundary is documented rather than hidden.
- **A separate event under `background_loop` or `business_failure`.** Rejected:
  the external clear key is `(event, component)`. Sharing a key with stall or
  business failure would let one fact's recovery clear the other's active
  alert. A fourth event family is the minimum shape that preserves independent
  recovery.

## Consequences

- Deployments that want to be paged must add `operability.tick_failure` to
  their §3 watcher whitelist; an unmodified watcher ignores the new event.
- During a database outage, readiness and `tick_failure` can both fire for one
  root cause. They are distinct facts on distinct clear keys; correlation and
  dedupe at notification level belong to the external watcher. The app adds no
  suppression, because suppression would be a causal claim it cannot prove.
- A strictly consecutive counter cannot cover high-duty-cycle intermittent
  throws (3 throws then 1 clean tick, repeating). That is an accepted,
  documented boundary; a windowed policy would need a separate decision and
  more state.
- A finite run can be missed at any scanner/monitor ratio; the sample window
  and default counterexample above are part of the contract. No claim of
  “all finite runs are reported” is made.
- A stale `operability.business_failure/failing` can coexist with a truthful
  `tick_failure/failing` during a throw run (E10). The business counter is
  frozen by #862, so it neither clears nor advances. This is a known residual
  tracked by #895; this decision does not repair it and does not emit a false
  business recovery.
- The `client_event_retention` loop has the same settle/freeze shape but no
  `tick_failure` leg in this decision: its cadence is daily and its evidence
  boundary is #544. A throw run there remains visible only in per-pass ERROR
  logs; adding it would be a separate, equally small decision.
- No durable alert state, schema change, new timer, probe, I/O channel,
  environment knob, or public diagnostics field is added. The two throw
  counters are process-local and are not projected by `/api/system/diagnostics`.
- The #885 fault-injection study used a fake database. It did not measure a
  real PostgreSQL fault, real operator delivery, or statistical miss/false-
  positive rates.
- Per monitor tick the added work is two counter reads, two comparisons, two
  tracker calls, and one additional closure; alert objects are allocated only
  on a transition. No new scanning or persistent I/O is introduced. Actual
  heap-allocation behavior was not measured.

## Revisit triggers

Reconsider this decision if any of the following becomes real rather than
hypothetical:

- a finite throw run that matters operationally is missed and the miss has
  demonstrated impact;
- operators require a response-time SLA instead of a sampling contract;
- a restart masking an incident is observed in practice;
- high-duty-cycle intermittent failures are judged unacceptable at the
  threshold boundary;
- alert noise or business loss attributable to this fact is measured.

Any change to `K`, sampling assumptions, the clear key, or the event family is
a new decision, not a silent tuning change.
