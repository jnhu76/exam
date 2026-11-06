# EXAM #885 — DECISION

**Verdict: GO_C** (independent tick-execution-failure escalation), **CONDITIONAL**.
GO_C is a research/decision verdict only — it does **not** authorize product implementation,
PR creation, merge, or release. Conditions are listed in §5 and must be met before any code
is written.

Evidence classes used throughout: **MEASURED** (real plugin stdout/metrics in the harness),
**SOURCE_VERIFIED** (read from BASE_SHA), **INFERRED** (reasoning over the two),
**UNKNOWN** (cannot be decided here). No statistical rates are claimed.

> **Replay errata (2026-11-06).** The `105 s` detection / `15 s` recovery figures in this
> historical study were measured from phase observation markers, not from the actual
> injection/throw-settle events. The corrected episode-level measurements and the committed
> E7 reset instrument are in [`POSTFIX_VALIDATION.md`](POSTFIX_VALIDATION.md) §6. The
> “0 allocations” wording is narrowed there: no new scanning or persistent I/O was added,
> but heap allocation was not measured and per-monitor-tick closures do allocate.

## 1. Candidate analysis

### A — keep runtime, fix docs + external log rules

`MEASURED`: E2/E3/E6 produce only per-tick ERROR logs (9 per loop) and **ZERO**
`operability.*` events. `SOURCE_VERIFIED`: the §3 external hook pages only on
`event ∈ {readiness, background_loop, business_failure}` (`active-alerting.md:98-113`); the
scanner catch logs have **no `event` field** (`heartbeat.ts:391`, `deadlineScanner.ts:388`),
and **no watcher implementation exists in the repo** (`SOURCE_MAP.md §5`).

A therefore requires a *new* external aggregation pipeline: consecutive counting, dedup,
recovery, and attribution all become the watcher's problem. `INFERRED`: recovery would be
derived from the **absence** of ERROR lines, which is indistinguishable from stdout loss —
the exact false-certainty the task forbids. `UNKNOWN`: log-shipping lag, delivery, false
recovery after a dropped line. A is **not** zero-work and does **not** deliver an active
alert; a plain ERROR log must not be declared a delivered alert.

**REJECT.**

### B — count throws into the existing `business_failure`

`MEASURED`: B raises `operability.business_failure` on pure throw runs (E2/E3/E6, 1–2 events
per scenario) whose message says `"N consecutive ticks with business failures"` — a **FALSE
statement** (`SOURCE_VERIFIED`: the counter update is inside `try`, the `catch` is empty,
`heartbeat.ts:386-392`). It also duplicates the real alert in E4/E5/E6-business-failure
(second authority over the same fact), yields `dup=2` in E1/E9 alongside readiness, and
`MEASURED` E5 shows mixed fault types corrupt the streak (a run of 8 spanning 240 s with 6
throws interspersed). `SOURCE_VERIFIED`: it breaks the two freeze REGRESSION tests
(`heartbeat.test.ts:636`, `deadlineScanner.test.ts:379`) and §1/§4 of the alerting doc, i.e.
it changes the #862/#884 contract. Lowest line count is not a correctness argument.

**REJECT.**

### C — independent continuous tick-execution-failure escalation

`MEASURED`: C covers E2/E3/E6 (detection **105 s** from actual fault occurrence, recovery
**15 s**), is silent in E0/E4/E5(no throws)/E6-business-failure/E11/E12, re-raises correctly
after restart (E7), and correctly ignores 3-tick bursts (E8). It is the only candidate with a
truthful, cause-UNKNOWN fact. `SOURCE_VERIFIED`: it reuses the existing 15 s timer
(`operabilityMonitor.ts:550`), the single readiness probe (`:508`), the tracker factory
(`:229-247`), the threshold classifier (`:54`, `:66-70`), the tracker wiring (`:488-499`), the
snapshot input (`:250-270`), and the stdout emission loop (`:529-538`). `INFERRED`: 2 new
process-local integers + 2 tracker closures, 0 new timers/probes/channels, no durable state.

`MEASURED` costs: E1/E9 produce `dup=2` (two `tick_failure/failing` events during a readiness
outage, one per loop). These are **distinct facts** (dependency unavailable vs. loop execution
aborted), keyed by distinct `(event, component)` pairs, not a duplicate authority over one
fact. Keep them; handle notification-level correlation in the watcher, not by app-layer
suppression.

**SUPPORT, CONDITIONAL (§5).**

### D — conditional hybrid with app-layer readiness correlation

`MEASURED`: D removes the duplicates (`dup=0` in E1/E9) but introduces a **phantom
raise/recover pair at the readiness-recovery boundary** — E1 raises `failing` @255000 ms
(the exact instant readiness emits `recovered`, 15 s after the last throw) then clears
@270000 ms; E9 raises @195000 ms on a count accumulated during the suppressed window.
Detection is delayed (E1 210000 ms vs C's 105000 ms). Suppression also assumes
"DB down ⇒ the throw is redundant", the very inference E3 refutes, and hides an independent
tick bug coincident with a DB outage. It needs an extra freeze condition per tracker — a
root-cause-ish state machine the task explicitly warns against.

**REJECT.** The cure is measurably worse than the noise. External incident correlation
(documented, not implemented) is the right layer for dedupe.

## 2. Unified quantified comparison matrix

Cells are tagged `[M]` MEASURED, `[S]` SOURCE_VERIFIED, `[I]` INFERRED, `[U]` UNKNOWN.
"Scenario-level" means 20 deterministic scenarios — **no percentage is claimed**.

| Dimension | A | B | C (recommended) | D |
| --- | --- | --- | --- | --- |
| Verified miss / false-positive scenarios | `[M]` Miss: E2/E3/E6/E7/E8/E12 (0 escalated). FP: none in-process, but recovery-from-absence is `[U]` | `[M]` No miss; **FP**: E2/E3/E6/E4/E5/E6-biz emit a false "business failures" claim; E10 semantics broken | `[M]` No miss on the core "every tick throws" case; FP: **0** in E0/E4/E5/E6-biz/E11/E8-3-tick/E12. Miss boundary: E12 intermittent | `[M]` Same coverage as C plus E1/E9 boundary artifacts; FP: 0 in clean scenarios; **2 phantom raises** (E1 @255 s, E9 @195 s) |
| Same-root-cause duplicate alerts | `[M]` 2 (E1) + 2 (E9) `[S]` plus a whole new watcher pipeline | `[M]` 2 + 2 (`dup=2` in E1/E9) **and** duplicate authority in E4/E5 | `[M]` 2 + 2 (`dup=2`), truthful distinct facts, `(event,component)`-keyed | `[M]` 0 during outage, but 2 delayed/late raises after recovery |
| Correctness & semantic precision | `[I]` Low: no event, absence-based recovery, free-text `msg` keying | `[M]` **Wrong**: false "business failures" message; breaks freeze contract | `[S]` High: says only "N consecutive ticks threw; cause unknown"; `recovered` = "exceptions cleared", not business recovery | `[M]` Medium: no root-cause claim in wording, but suppression is a causal over-claim |
| Incident diagnosability | `[U]` log text + `err` only; no stable `event`/`component` | `[M]` Misleading: blames business work | `[S]` Stable `event`/`component`/`state`; existing ERROR logs retain the `err` for diagnosis; UNKNOWN explicitly documented | `[S]` Same as C, minus visibility during readiness outages |
| Detection latency (from actual fault) | `[M]` 105000 ms in-process (CF log rule) `[U]` real watcher | `[M]` 105000 ms | `[M]` **105000 ms** (E2/E3/E6); readiness itself 0 ms in E1/E9 (worst case ≤15 s + probe) | `[M]` 105000–210000 ms; suppressed window delays it |
| Recovery latency | `[U]` absence-derived, unbounded | `[M]` 15000 ms | `[M]` **15000 ms** (first clean settle) | `[M]` 15000 ms + phantom raise/recover pairs |
| New machine work per scanner tick | `[S]` 0 | `[I]` 1 integer increment (catch) | `[S]` 1 integer increment (catch) OR 1 assignment to 0 (end of `try`); **0 new I/O** (object allocation not measured) | `[I]` same as C |
| New machine work per monitor tick | `[S]` 0 in-process; `[U]` external | `[I]` 0 (reuses existing leg) | `[I]` 2 integer reads + 2 classifier calls + 2 tracker calls; 1 extra stdout line **only on a transition** | `[I]` C + 1 readiness gate + 1 freeze condition per tracker |
| New timer / DB probe / I/O / scanning work | `[S]` 0 in-process; `[U]` external pipeline | `[S]` 0 | `[S]` **0 new timers, 0 new probes, 0 new scanning/persistent I/O** (reuses `:550`, `:508`, the existing `alerts` array); heap allocation not measured, and the per-monitor-tick closure allocates | `[S]` 0 new timers/probes; +1 gate branch |
| New state | `[S]` 0 in-process; `[U]` new external state | `[S]` 0 new (but redefines an existing field) | `[I]` **4 scalars**: 2 process-local integers + 2 tracker `boolean\|null`. No durable state/schema/env knob | `[I]` C + 2 freeze conditions |
| Code change & regression scope | `[S]` 0 product files; `[U]` external rule | `[S]` 2 plugin files + doc §1/§4 + **2 freeze REGRESSION tests must change** | `[S]` 2 plugins + 1 monitor + 1 doc; 3 test files (2 mechanical fixture extensions, 1 new test set). 2 freeze REGRESSION tests stay **unchanged** | `[S]` C + correlation logic + more tests |
| Compatibility with existing external log consumers | `[S]` Backward-compatible for the app, but consumers must build a new pipeline | `[M]` **Breaking**: same event name now emitted for a different fact | `[S]` **Additive, backward-compatible**: +1 `event` value, `state`/`component` unions already fit; old watchers ignore it. **BUT §3 whitelist must add the new event before anyone is paged** | `[S]` Same additive change as C |
| Complexity & maintenance cost | `[I]` Low in app, high+unowned externally | `[S]` Low lines, **high semantic debt + contract churn** | `[I]` Low: mirrors an existing leg; 4 scalars; no config | `[I]` Medium: gating, freeze, boundary artifacts, more tests |

## 3. Verdict

**GO_C — CONDITIONAL.** Priority order applied: correct alert semantics > verifiable incident
coverage > no duplicate failure authority > minimal machine work > code lines.

- B is rejected on **correctness** despite the smallest diff.
- A is rejected on **verifiable coverage** (no escalatable event; delivery unowned).
- D is rejected because app-layer root-cause correlation measurably creates a phantom
  raise/recover pair and re-introduces causal over-claiming; notification-level dedupe belongs
  to the external watcher.
- C is the only candidate that closes the measured gap with **zero new timers, probes,
  durable state, env knobs or channels**, and with **zero measured false positives** in the
  clean/business-failure-only/stall/short-burst/intermittent scenarios.

C does **not** fix, and must not claim to fix: alert delivery (no watcher exists), root-cause
attribution, the E10 stale `business_failure` alert, or the E12 chronic-intermittent boundary.
Those are named residual risks/conditions, not hidden ones.

## 4. Recommended change package (plan only — NO code written)

### 4.1 Files to change (7 physical files) and why

| File | Why it MUST change |
| --- | --- |
| `apps/api/src/plugins/heartbeat.ts` | The throw fact is observed in this plugin's `catch` (`:390`). Add `consecutiveThrowTicks` to `heartbeatMetrics` (`:53-78`). **Recommended implementation (Reviewer 2):** set a tick-local `threw` flag in `catch` and update the counter in the **existing `.finally()`** (`:393-397`) as `threw ? +1 : 0`. One authoritative write point, robust to any throw position, and the frozen `consecutiveFailedTicks` update inside `try` (`:386-389`) is **never touched**. `lastSettledAt` definition unchanged. |
| `apps/api/src/plugins/deadlineScanner.ts` | Same reason at `catch` `:387` / `.finally()` `:390-394`. |
| `apps/api/src/plugins/operabilityMonitor.ts` | Single classifier/tracker/emit owner: extend `OperabilitySnapshotInput` (`:250-270`) with 2 counters, `OperabilityAlert.event` union (`:273-277`) with `"operability.tick_failure"`, `OperabilityTickTrackers` (`:295-306`) with `tick_failure: {heartbeat, deadline_scanner}`, add one emission leg in `evaluateOperabilityTick` (after `:471`), create 2 trackers (`:488-499`), pass the 2 counters (`:519-524`). |
| `docs/operations/active-alerting.md` | External contract: add 2 catalogue rows, add `operability.tick_failure` to the §3 whitelist, **revise §4's throw-ownership paragraph** (`:142-147`) as an explicit decision (this is a documented design reversal, not a silent addition), document UNKNOWN/correlation/E10/E12 boundaries. |
| `apps/api/src/plugins/heartbeat.test.ts` | Pin the new throw counter; `resetEscalationFacts()` gains one line. Freeze REGRESSION stays intact. |
| `apps/api/src/plugins/deadlineScanner.test.ts` | Same. |
| `apps/api/src/plugins/operabilityMonitor.test.ts` | `snapshotInput()` / `makeTrackers()` gain 2 zero-default fields / 2 trackers; new catalogue, threshold, recovery, restart, negative tests. |

**Out of the minimal scope** (explicit follow-up, not required): a diagnostics projection of the
new counter in `apps/api/src/routes/system.ts` + `packages/contracts/src/system.ts` +
`apps/api/openapi.json` + `docs/contracts/observability.md` (the #886 precedent). A read-only
projection does not close the alert gap and would expand the change surface.

### 4.2 Logic directly reusable

`createOperabilityTransitionTracker` (`:229-247`); `BUSINESS_FAILURE_TICK_THRESHOLD` /
`classifyPersistentBusinessFailure` (`:54`, `:66-70`) **as a hypothesis to validate** (same 30 s
tick cadence → 105 s measured detection), not forced. Reviewer 2 condition: reusing a
*business-failure-named* constant for a non-business fact is semantic debt — resolve with a
neutral alias or an explicit one-line comment, **NOT** a new constant (that would be a
config-knob smell). The `businessFailure` closure shape
(`:420-442`); the 15 s `setInterval(runTick, …)` (`:550`); the single
`probeApplicationReadiness` (`:508`); the per-fact tracker wiring (`:488-499`); the stdout
emission loop (`:529-538`); the existing `state` value `"failing"` and `component` values
`heartbeat` / `deadline_scanner` (no union change needed there); the process-local metrics
singleton + `.finally` pattern in both scanners; the existing external `(event, component)`
clear key.

### 4.3 Existing regression tests to update

- **`heartbeat.test.ts:636-678` and `deadlineScanner.test.ts:379-439` (freeze REGRESSION):
  MUST stay semantically unchanged and pass.** C adds a *separate* counter; it does not touch
  `consecutiveFailedTicks`. This is C's main advantage over B.
- `operabilityMonitor.test.ts`: `snapshotInput()` (`:250-277`) needs 2 new zero-valued fields;
  `makeTrackers()` (`:280-293`) needs 2 new trackers. Re-verify assertions such as "healthy
  everything → no alerts at all" (`:296-300`) and every `toHaveLength(n)` count with the new
  leg present.
- Control evidence: all **67 existing tests** in the 3 suites pass unchanged at BASE_SHA
  (`results/regression-transcript.txt`), so any post-change failure is attributable to the
  change.

### 4.4 Minimal new test set

**~7 tests, not a port of the 20-scenario research harness** (Reviewer 2: that would be test
bloat — the counterfactual matrix is research evidence, never a regression contract):

1. Plugin level, heartbeat: continuous throws increment, clean settle resets, throw tick still
   settles; the `consecutiveFailedTicks` freeze REGRESSION still holds on the same tick.
2. Plugin level, deadline_scanner: same.
3. Monitor level: threshold boundary (3 silent / 4 raises) folded into the existing boundary test.
4. Monitor level: at threshold → exactly one `tick_failure/{loop}/failing` with exact
   fields + message; S4 no-storm; clean settle → exactly one `recovered`, then silence.
5. Monitor level **negative / false-positive**: clean, business-failure-only, stall-only and
   below-threshold snapshots emit ZERO `tick_failure`; the three fact families coexist on
   distinct keys (mirror `operabilityMonitor.test.ts:744`).
6. Monitor level restart: fresh trackers + zeroed counters re-raise without carry-over recovery.
7. End-to-end (reuse this harness's pattern, ONE scenario): DB-healthy continuous throws
   through the real tick entry → one `failing` per loop then `recovered` on the first clean
   settle; E1/E9 read-only check that readiness and tick_failure both emit (no app suppression).

Control: re-run the **3 existing suites (67 tests)** unchanged apart from fixture extension.

### 4.5 How to prove no NEW false positives

Scenario-level `MEASURED` baseline: C produced **0 events** in E0 (clean), E4 and
E6-business-failure (business failures only), E11 (stalled), the 3-tick burst of E8, and E12
(intermittent). New product tests must assert the same shapes. Additionally, a differential
check: with both new counters at 0, `evaluateOperabilityTick` output must be **identical** to
the current implementation for every existing test input (the 67-test control).

### 4.6 How to prove #547 / #862 contracts are not broken

- Re-run the 3 existing suites unchanged apart from fixture extension → 67 PASS.
- Assert `consecutiveFailedTicks` freeze/reset semantics and `lastSettledAt` definition are
  byte-identical (guardrail of #885 itself).
- Assert readiness / background_loop / business_failure event counts in E0/E1/E4/E9/E11 are
  **unchanged** from the measured baseline (26 `operability.*` events across the 20 scenarios).
- Assert `docs/operations/active-alerting.md` §1 catalogue rows for the 3 existing events are
  unchanged; the change is additive (new event + §3 whitelist entry).

### 4.7 Rollback path

One semantically cohesive commit. `git revert` removes the 2 metrics fields, the monitor leg,
the doc rows and the new tests. **No migration, no schema, no durable state, no env knob, no
external channel** → no data or deployment side effects. The only external-facing change is an
additive §3 whitelist entry: old watchers ignore the new event; a reverted deployment simply
stops producing it. Nothing to drain or backfill.

### 4.8 Why a smaller modification cannot work

- **Docs only (A)**: no escalatable event exists; §3 whitelist ignores ERROR logs; recovery
  would be absence-based; no delivery proof.
- **Diagnostics-only (#886-style projection)**: read-only; still no transition event, so no
  watcher can page. Does not close the gap.
- **Add `event`/`component` to the existing scanner ERROR log**: still needs per-tick counting,
  dedup and recovery state to bound it (i.e. C's counter); changes a log line's contract; and
  those logs carry `err` detail which §2 forbids in alert content.
- **Emit on `background_loop` with `state:"failing"`** (Reviewer 2): pages with no §3 change,
  but **shares the `(event, component)` clear key with the stall fact** — a stall `recovered`
  would clear the throw alert and vice versa. Corrupts dedup.
- **Threshold 1**: pages on E8's deliberately non-alerted 3-tick burst (log storm).
- **`business_failure` with a new `state`**: still a false fact about business work.
- **Reuse `lastSettledAt`**: forbidden by the #885 guardrail; throws settle so it reads
  `healthy` (MEASURED E2/E3), and it is pinned by #547's "settled-with-error is not stalled".
- **B**: smallest diff but a false message, two broken freeze tests, a changed #862 contract,
  and duplicate authority.

## 5. Conditions that MUST be met before implementation (GO is not authorization)

1. **Scope the claim**: GO_C closes the **stdout EVENT-PRODUCTION** gap. It does NOT deliver
   an operator page. `docs/operations/active-alerting.md §3` must add
   `operability.tick_failure` to the whitelist, and deployment owners must update their
   watcher. Without that, the new event is emitted but nobody is paged.
2. **Explicit decision record**: §4's "throw → readiness ownership" paragraph and the
   freeze-test comments ("per-tick ERROR logs are the only signal … by ownership design") are
   a documented design decision. Reversing it needs an explicit decision/ADR reference, not a
   silent "no new channel" addition.
3. **Recovery message**: must read "tick exceptions cleared … business restoration unknown",
   NOT "business recovered" and NOT a `failing` wording on the recovery line.
4. **Threshold**: validate that reusing `4` (105 s detection) is the right policy for throws;
   do **not** add an env knob. E12 shows a strict consecutive counter cannot cover
   high-duty-cycle intermittent throws — either accept that as a documented deliberate boundary
   or open a SEPARATE decision for a windowed policy (more state). Do not bolt a window onto
   this change.
5. **Correlation**: document that readiness + tick_failure during a DB outage are distinct
   facts to be deduped by the external watcher's incident correlation; do NOT add app-layer
   suppression (D is rejected).
6. **UNKNOWNs in the runbook**: stdout loss, root cause, business restoration, E10 stale
   business_failure status, restart re-emission.
7. **E10 follow-up**: file a focused follow-up Issue on the frozen #862 contract's stale
   `business_failure` alert during a throw run; do not fix it inside #885.

## 6. Independent reviews

### Reviewer 1 — Reliability / Observability (completed)

Verdict: **A REJECT, B REJECT, C CONDITIONAL SUPPORT, D REJECT; overall GO_C CONDITIONAL.**
Top 3 risks: (1) **delivery is unowned** — §3 whitelist lacks the new event and no watcher
implementation exists, so calling this an "alerting fix" is an over-claim; (2) D's
correlation is a causal over-claim with measured phantom alerts (E1 @255000/@270000, E9
@195000); (3) a strict consecutive threshold has a **chronic-intermittent false negative**.
Blunt disagreements with the leading direction: the evidence writes as if §3 is a working
watcher; C actually reverses a documented design decision and needs an ADR; the measured C
`recovered` message did not say "exceptions cleared"; "no false positives" on a 3-tick burst
is simultaneously a false negative; documenting E10 as UNKNOWN relieves the author, not the
operator.

**How the research was corrected in response (not smoothed over):** the counterfactual
recovery message was fixed to "tick exceptions cleared … business restoration unknown"; a new
targeted **E12** was executed and confirmed the chronic-intermittent gap (12 throw ticks +
7 clean settles per loop, **ZERO** events from A/B/C/D); conditions §5.1–§5.4 and §5.7 were
added. Reviewer 1's delivery and ADR objections are recorded as binding conditions, not
resolved by this research. The E12 objection is recorded as a named residual boundary, not
silently solved with extra state.

### Reviewer 2 — Minimum Necessary Engineering (completed)

Verdict: **A REJECT, B REJECT, C SUPPORT (CONDITIONAL), D REJECT; overall GO_C**, conditional
on exactly: no diagnostics field, no env knob, no readiness correlation, no port of the
research harness into the product suite.

Minimum accepted change set: **0 new files, 0 new exported functions, 0 new timers, 0 new DB
probes, 0 new channels, 0 durable state, 0 env knobs, 0 OpenAPI/schema changes**. Genuinely
new: 2 process-local integers, 2 tracker instances, 2 `OperabilitySnapshotInput` fields, 1
`event` union member, 1 local closure in `evaluateOperabilityTick`. Recommended that the
counter be written in the **existing `.finally()`** via a tick-local `threw` flag (one
authoritative write point; the frozen `consecutiveFailedTicks` update inside `try` is never
touched) — adopted into §4.1. `packages/contracts/src/system.ts` and `routes/system.ts` must
**not** change (a diagnostics projection is #886-style scope creep). Complexity ranking
code+maintenance: `B < A(in-repo only) < C < D`; **correctness-adjusted: C is the cheapest
correct option**.

Top 3 objections: (1) C ships a `recovered` whose own evidence calls the underlying state
UNKNOWN — a flapping pattern (4 throws → 1 clean → 4 throws) is **not measured** and the
evidence was internally inconsistent here; (2) C only closes the gap after an out-of-repo
watcher config update — do not claim "operator notified"; (3) E10 residual is truthful but
operationally noisy and must be labelled UNKNOWN-status.

### Disputes between the two reviewers (recorded, NOT merged)

| # | Reviewer 1 | Reviewer 2 | Disposition |
| --- | --- | --- | --- |
| D1 | C **reverses a documented design decision** (§4 + freeze-test comments "by ownership design") and needs an **explicit decision/ADR**, not just a doc bullet. | Treats it as a **§4 bullet rewrite** inside the doc change; no ADR demanded. | **Adopt R1's more conservative position** (§5.2). Recorded as a genuine difference, not a consensus. |
| D2 | "No false positives on a 3-tick burst" is **simultaneously a false negative**; the strict consecutive threshold is a coverage risk requiring validation/reconsideration. | Frames it as **evidence inconsistency about `recovered`** (flapping unmeasured) and asks for a reset test + documented flapping behaviour, not a coverage guarantee. | E12 (3-throw-1-clean) was executed and confirmed the gap; **4→1→4 flapping remains UNMEASURED**. Both positions recorded; §5.4 accepts the boundary rather than silently solving it. |
| D3 | E10 "document as UNKNOWN" **relieves the author, not the operator** — the event still asserts a definite stale `failing`; log a tracked follow-up, don't call it resolved. | E10 must be labelled UNKNOWN-status in the doc; two concurrent failing facts are truthful but noisy. | Both agree it is a residual risk and must not be fixed inside #885; §5.7 files the follow-up. R1's sharper wording retained. |
| D4 | "§3 is a working watcher" framing in the evidence is wrong — **delivery is UNKNOWN for EVERY event**, not just ERROR logs. | A's in-process detection timing is **misleadingly presented as equivalent to C's**; real A's dedupe/recovery/attribution are UNKNOWN. | Both delivered as binding conditions (§5.1). EXPERIMENTS.md §5 already states delivery is UNKNOWN for all events; A's in-process figure is explicitly labelled COUNTERFACTUAL. |

**Agreement (not a dispute)**: both independently rejected A, B and D; both supported C
conditionally; both named the §3 whitelist/delivery gap as the top risk; both require no
diagnostics field, no env knob, no durable state, no harness port into the product suite;
both require the two freeze REGRESSION tests to stay unchanged.

**Transient completeness note**: Reviewer 2 observed (mid-research) that
`EXPERIMENTS.md` cited `DECISION.md` and `REPRO.md` while neither existed yet. Both now
exist. No product code was changed in response to either review; the review-driven changes
were: corrected counterfactual recovery wording, added targeted E12, tightened §4.4 to ~7
tests, adopted the `.finally()` counter write, added the neutral-alias condition, and added
the extra rejected smaller options in §4.8.

## 7. Final answer to the question posed

> How to reliably discover a persistently failing background loop with the least extra
> machine work, while keeping every alert's claim true?

Produce **one new, independent, cause-UNKNOWN fact** — "N consecutive ticks threw" — using
the machinery already present: add 2 process-local integers to the scanner metrics (one
increment per throw, one reset per clean settle), feed them into the existing 15 s monitor
snapshot, classify with the existing threshold predicate, dedupe with the existing transition
tracker, and emit one additive stdout event through the existing loop. **Zero new timers,
probes, durable state, env knobs or I/O channels per tick.** Leave readiness,
business_failure and stall facts exactly as they are; refuse to attribute a root cause; state
recovery as "exceptions cleared" with business restoration UNKNOWN; and update the external
hook whitelist so the produced event can actually be consumed. Measured: 105 s detection,
15 s recovery, 0 false positives in the clean/business-failure-only/stall/short-burst
scenarios, at the cost of 4 scalars and one additive contract entry.
