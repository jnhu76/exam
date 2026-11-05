# EXAM #885 — ALERT_SEMANTICS

Facts first, then fields/counters/events. Every claim below is tagged
**MEASURED** (real plugin output), **SOURCE_VERIFIED** (read from BASE_SHA), or
**INFERRED** (reasoning over the two). Where evidence cannot decide, the answer is
**UNKNOWN** and stays UNKNOWN.

## 1. The four fact states

| State | Definition (what is actually observable) | Existing authority | What it does NOT mean |
| --- | --- | --- | --- |
| **DEPENDENCY_UNAVAILABLE** | A mandatory serving dependency failed its OWN probe: `probeApplicationReadiness` → `pingDb()` threw or exceeded 2s (or required-mode Redis unusable). Independent evidence, one probe per 15s monitor tick. | `operability.readiness/database/unavailable` (`operabilityMonitor.ts:112-148`, `:344-355`). MEASURED: E1/E9 raised exactly one, at the first monitor sample after fault start (detection 0 ms in that phase alignment; worst case ≤ 15 s + probe). | Does not say anything about background-loop execution, and does not prove the probe's root cause is the same as any concurrent tick throw. |
| **BUSINESS_OPERATION_FAILED** | The tick **settled** (reached the end of `try`, so `.finally` stamped `lastSettledAt`), and at least one business item failed: `failedCount > 0` (heartbeat: disruption leg OR incident-reconciliation leg; deadline: auto-submit). | `operability.business_failure/*/failing` at 4 consecutive such ticks (`operabilityMonitor.ts:420-471`, `:444-471`). MEASURED: E4/E6-business-failure raised at +105 s from fault start, recovered +15 s after the first clean settle. | Does not mean the loop stalled (stallState stays `healthy`), and does not mean the tick threw. |
| **TICK_EXECUTION_FAILED** | The tick aborted: an exception escaped the business-failure per-item catches into the plugin `catch`, which emitted `"Error scanning for …"` and skipped the `consecutiveFailedTicks` update. The tick STILL SETTLED (`.finally`). | **NO existing escalated alert.** Only a per-tick ERROR log, which the §3 external hook does not page on. MEASURED: E2/E3/E6 produced 9 consecutive throw ticks per loop with readiness healthy, `consecutiveFailedTicks` frozen at 0, `stallState=healthy`, and ZERO `operability.*` events. | Does not mean the DB is down, does not mean the DB is healthy-as-root-cause, and does not mean the loop stalled. |
| **UNKNOWN_CAUSE** | Persistent exceptions are observable but the app's own facts cannot attribute them: a healthy probe does not exclude a DB-root cause (E3), and an unhealthy probe does not prove causation (E1/E9). | No current signal. **This is the honest label for a tick throw.** | Not a diagnosis. It is a refusal to over-claim. |

### Why these four must stay distinct

- **Loop liveness** (`lastSettledAt` freshness) is a STALL fact. MEASURED E2/E3: all 9 throw
  ticks per loop settled (`hbSettled=9`, `dlSettled=9`, 10 distinct `lastSettledAt` values),
  `stallState=healthy`. MEASURED E11: a hung tick never settled (`hbSettled=0`), raised
  `operability.background_loop` stalled at +135 s. **Throwing ≠ stalled.**
- **Dependency readiness** is a probe fact. MEASURED E2/E3: 18 monitor samples in the fault
  window, `pingFailDeltaSum = 0` — probe healthy on every sample while every tick threw.
- **Business work success** is a per-item fact. MEASURED E4: business failures escalate; E2:
  a throw carries NO business-failure evidence in either direction (the counter freezes).
- **Alert delivery** is NOT event production. No watcher implementation exists in the repo
  (`SOURCE_MAP.md §5`). Only stdout event-production latency is measured; operator receipt
  latency is UNKNOWN.

## 2. Answers to the required semantic questions

**Q: Can a tick throw be regarded as a business failure?**
**NO.** SOURCE_VERIFIED: `consecutiveFailedTicks` is updated inside `try` and the `catch` is
empty apart from an ERROR log (`heartbeat.ts:386-392`, `deadlineScanner.ts:374-389`). A throw
aborts the tick before any business-failure count is computed. MEASURED E2: business_failure
stayed 0 across 9 throw ticks. Claiming "N consecutive ticks with business failures" for a
throw run would be a FALSE statement (candidate B's measured defect).

**Q: Does a run of consecutive tick throws have independent operational meaning?**
**YES.** It is a distinct, bounded, observable fact: "for N consecutive cadences the loop's
execution aborted before completing". MEASURED E2/E3/E6: it persists indefinitely (no upper
bound in the current design), with readiness healthy and no stall. It is neither readiness nor
business_failure nor stall, so leaving it un-escalated is a coverage gap, not a deliberate
non-alert. This is the minimum fact worth adding.

**Q: Can DB-down and non-DB throws be reliably distinguished?**
**NO.** SOURCE_VERIFIED (`SOURCE_MAP.md §3`): `pingDb()` covers only
`SELECT id FROM organizations LIMIT 1`, while scanner work hits `exam_attempts`, joins,
`FOR UPDATE` transactions, permissions, schema and per-row logic. MEASURED E3: a
PostgreSQL-shaped `42703` error at attempt discovery coexists with a probe healthy on all 18
samples. A healthy probe therefore does **not** exclude a DB-root cause; an unhealthy probe
does **not** prove one either.

**Q: If they cannot be distinguished, which wrong attribution must be avoided?**
Avoid ALL of: (a) `DB healthy && tick throws ⇒ non-DB exception`; (b) `DB down ⇒ the throw is
caused by the DB`; (c) `tick throws ⇒ business processing failed`; (d) `tick throws ⇒ loop
stalled`; (e) emitting `recovered` for a condition whose evidence is only "the exception
disappeared". The only supportable wording is a **cause-UNKNOWN** statement about the tick's
execution, with readiness and business_failure left to their own independent facts.

**Q: What fact constitutes accurate fault recovery?**
For **business_failure** (MEASURED E4/E6-business-failure): a settled tick with zero failures
on all legs — the doc §1 (`:48-61`) justifies this as a state-condition recovery because the
failing populations are self-retried persistent work. For **tick execution**: the honest
recovery fact is "a settled tick with NO thrown exception was observed", i.e. the *exception
run* ended. It is **NOT** "the background business recovered" and **NOT** "the backlog drained".
For **readiness**: the probe succeeding again (MEASURED E1/E9: `recovered` emitted).

**Q: Is a clean tick sufficient to prove the consecutive-exception episode ended?**
Sufficient for the narrow fact **yes** (no throw was observed in that tick); sufficient for
"the underlying fault is fixed / work caught up" **NO / UNKNOWN**. A throw aborts the whole
tick, so work that would have been done was not done; one clean tick only proves the loop could
complete once. Any `recovered` message for tick failures must be worded as "exceptions cleared",
never "business recovered".

**Q: Did the exception merely disappear, or did the background business recover successfully?**
From the app's facts: **UNKNOWN**, by construction. MEASURED E6: after 9 continuous throws,
clean ticks resumed and the counterfactual tick-failure tracker emitted `recovered` at +15 s —
but no business-success evidence existed (there were no candidates/attempts in the harness).
This must be stated as UNKNOWN in the runbook rather than converted into a success claim.

**Q: Should an old `business_failure` alert stay active while throws occur?**
**MEASURED E10**: business_failure `failing` raised at +150 s; 7 throw ticks then followed with
DB healthy; the frozen counter stayed ≥ 4, so the alert stayed `failing` with NO recovery until
the first clean settle at +450 s. Emitting `recovered` on a throw would be a **false recovery**
(the throw carries no clean-settle evidence — SOURCE_VERIFIED freeze rule). Keeping it is
fail-safe but its message ("N consecutive ticks with business failures") is **stale**: no
business work was being attempted. Honest resolution: keep the state, and document it as
**UNKNOWN-status** (neither confirmed cleared nor confirmed ongoing) rather than "fixing" it by
emitting recovery or by redefining the counter. Candidate C adds a separate truthful fact; it
does not and should not repair this stale claim. This is a residual risk of the frozen #862
contract, recorded here, not silently changed.

**Q: Which recovery judgements must remain UNKNOWN?**
(i) Whether a DB-root cause was the cause of a throw even when the probe is healthy;
(ii) whether business backlog drained after the exception run ends;
(iii) whether stdout loss means an operator ever received/cleared an alert;
(iv) whether a process restart preserved the pre-restart episode (it does not — process-local,
    MEASURED E7: no carry-over recovery, re-raise only after re-accumulating the threshold);
(v) during a throw run following a business_failure raise (E10), whether the business-failure
    condition is ongoing or merely unobserved.

## 3. Design consequences for any new signal

1. **It must not name a root cause.** Event/state/message may say only "tick execution
   persistently failing / exceptions cleared" with `component` = the loop. No "DB", no
   "business".
2. **It must not reuse the business_failure counter or its message.** Different fact,
   different run-length, different recovery meaning.
3. **A clean settle clears the throw run** (condition-level recovery), and the recovery
   message must say "exceptions cleared", not "recovered" in a business sense.
4. **Process-local only**: no durable state, no schema, no env knob, no new timer or channel.
   Restart semantics are inherited from `createOperabilityTransitionTracker`.
5. **UNKNOWN must be explicit in documentation**: stdout-loss, root cause, and business
   restoration are not decidable from the emitted facts. There is no "NO_FAILURE_OBSERVED"
   third state — that would require a contract change and a second state machine; the doc must
   carry the uncertainty instead.

## 4. The gap in one sentence

When a background loop keeps settling and throwing every cadence with readiness healthy,
F1 (`lastSettledAt` fresh) suppresses the stall alert, F2 (frozen counter) suppresses the
business_failure alert, and F4 (healthy probe) suppresses the readiness alert — so the only
remaining signal is a per-tick ERROR log that the §3 external hook contract explicitly does
not page on. MEASURED: E2/E3/E6, 9 consecutive throw ticks per loop, **ZERO** escalated events.
