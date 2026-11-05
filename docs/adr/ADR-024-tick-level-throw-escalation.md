# ADR-024 — Tick-level throw escalation (`operability.tick_failure`)

## Status

- Status: **PROPOSED** — recorded with the #885 change for the decision owner's
  review. Acceptance happens at merge (AGENTS.md §7: accepting a substantive
  architecture decision is a human gate), so until then `master` keeps the #547
  behaviour — throws settle, are logged, and are not escalated — and this
  branch is a proposal whose code is implemented and tested but not yet
  authoritative.
- Date: 2026-11-05
- Decision owners: project
- Supersedes: none — **revises** one paragraph of
  [`docs/operations/active-alerting.md`](../operations/active-alerting.md) §4
  ("Transient scanner errors")
- Related: ADR-018 (operational observability window), #547 (active alert
  contract), #862 (persistent business failure), #885 (research verdict GO_C)

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
   (measured: a PostgreSQL-shaped `42703` error coexisting with a healthy probe
   on every sample).

The only remaining signal was a per-tick ERROR log, which the §3 external hook
whitelist does not page on, so the blind spot was unbounded.

## Decision

Add a fourth fact family to the #547 contract:

- event `operability.tick_failure`
- components `heartbeat`, `deadline_scanner`
- states `failing` (error) and `recovered` (info)
- input: a process-local `consecutiveThrowTicks` run-length counter per scanner,
  incremented when the tick body throws into the tick-level `catch`, reset to 0
  by a tick that settles without throwing
- policy: `failing` when the run reaches the existing 4-tick window
  (`classifyPersistentBusinessFailure`), counted at each scanner's configured
  cadence (30 s by default). The window is shared with #862 **deliberately**:
  both facts are runs of loop ticks, so retuning one independently must be an
  explicit decision rather than a silent side effect of renaming a constant.
  The threshold is compile-time policy, not an env knob.

**failing asserts** only that the same loop produced at least four consecutive
tick-level throws. It does NOT assert that the database is or is not the cause,
that business processing failed, or that any backlog is (not) converging.

**recovered asserts** only that a settled tick without a throw interrupted the
run. It does NOT assert that business work succeeded, that a database fault was
fixed, or that pending work is drained — business restoration stays UNKNOWN.

## What this revises

`active-alerting.md` §4 said tick-level throws "are owned by the readiness
events". That ownership claim is narrowed, not deleted:

- readiness keeps exclusive ownership of **dependency availability**;
- a run of throws becomes its **own** fact, because readiness health does not
  prove causation and because a throwing tick settles (so neither the stall nor
  the business-failure fact can observe it).

## Invariants preserved

- `lastSettledAt` keeps its definition (#547): a throwing tick still settles.
- `consecutiveFailedTicks` keeps its freeze/reset semantics (#862) — untouched.
- `operability.readiness`, `operability.business_failure` and
  `operability.background_loop` keep their definitions and their keys.
- No durable alert state, no schema change, no new timer, probe or I/O channel.
- Process-local state: a restart re-accumulates and may re-raise; it never
  carries a recovery across processes.

## Consequences

- Deployments that want to be paged must add `operability.tick_failure` to
  their §3 watcher whitelist; an unmodified watcher ignores the new event.
- During a database outage, readiness and tick_failure can both fire for one
  root cause. They are distinct facts on distinct clear keys; correlation and
  dedupe at notification level belong to the external watcher — the app adds
  no suppression, because suppression would be a causal claim it cannot prove.
- A strictly consecutive counter cannot cover high-duty-cycle intermittent
  throws (3 throws then 1 clean tick, repeating). That is an accepted,
  documented boundary; a windowed policy would need a separate decision and
  more state.
- The `recovered` message claims only that a clean tick interrupted the run,
  because the monitor observes the counter, not every tick. At the default
  cadence (15 s monitor, 30 s scanners) every scanner tick is sampled, so that
  is the first clean tick; with a scanner interval configured below the monitor
  cadence, a run can be interrupted and a new one started between two samples.
- The client-event retention loop has the same settle/freeze shape but no
  `tick_failure` leg in this decision: its cadence is daily and its evidence
  boundary is #544. A throw run there remains visible only in per-pass ERROR
  logs; adding it would be a separate, equally small decision.
