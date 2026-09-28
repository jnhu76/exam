# RecoveryProtocol — Formal Model

Authority: `docs/adr/ADR-012-candidate-recovery-contract.md` (binding) and
`docs/architecture/exam-semantic-boundaries.md` (EXSEM-001..020, adopted by
ADR-021) — in particular EXSEM-011 (server time is the only deadline
authority), EXSEM-013/014 (effective state = stored facts + canonical time;
reconcile-or-evaluate before state-sensitive mutation), and EXSEM-008
(first-submit freeze).
Implementation reference: REC-I3 (`apps/web/src/exam/useAttemptRestore.ts`,
`apps/web/src/pages/exam/TakeExamPage.tsx`,
`apps/api/src/routes/attempts.candidate.ts`,
`packages/exam-engine/src/{attemptCommands,deadlineReconciliation,restoreInterruption}.ts`).

This is an **executable consistency check** over selected recovery-protocol
semantics, not a proof that the TypeScript implementation is a refinement.

---

## Policy scope (binding)

The recovery timeline modeled here covers candidate recovery safety for:

- **strict**
- **operator_incident** candidate restore behavior

It does **NOT** verify **bounded_grace** compensation reachability.
Under bounded_grace, an authorized time adjustment may extend the effective
deadline before final reconciliation and therefore rescue an interruption
that was already expired pre-adjustment. That reachability class (a deadline
that is not monotone across the rescue window) is intentionally outside this
model: `deadlinePassed` is monotone here, so a grace-rescued restore is
unrepresentable by construction. Properties in this TLA+ family must not be
interpreted as proofs covering every candidate interruption-time policy.
bounded_grace currently has no formal owner; giving it one would be a
separate decision (ADR-013 §5/§7 semantics).

---

## Scope

Modeled: the abstract recovery protocol among Client, Server, Environment;
route identity + client generation token (REC-I3 `generationRef`);
authoritative server attempt state and the client's applied snapshot;
page-load GET, restore POST, post-restore snapshot-reload GET;
request/response delay, reordering, loss; **cross-attempt navigation**
(`NavigateTo` is in the route-switch Next); deadline reconciliation and
submission; UI recovery phase transitions.

Not modeled (out of scope): React `useEffect`/`useRef`, DOM nodes, Fastify
routes, PostgreSQL tables, HTTP serialization, RBAC, grading algorithms,
real answer content, telemetry transport, IndexedDB/SQLite, desktop runtime,
numeric time/grant arithmetic (operator grants are owned by
`formal/tla/operator-grant/`), and bounded_grace compensation (see
"Policy scope" above).

---

## Effective-state conformance (EXSEM-013/014)

`deadlinePassed` is the canonical server-time fact. Stored status may lag it
(lazy materialization is legal), but every state-sensitive server decision
in the model evaluates or reconciles the canonical effective state first,
mirroring the production command paths which reconcile inside their
transactions:

- **GET** (`ServerReturnSnapshot`): a command-style GET with side effects —
  serving an expired, not-yet-terminal attempt first materializes the
  terminal deadline outcome (shared `DeadlineReconcileEffect`), then freezes
  the delivery from the reconciled status. An expired attempt is never
  served editable. (Production: `attempts.candidate.ts` GET /take runs
  `ensureAttemptDeadlineReconciled` in a locked transaction before building
  the snapshot; `isEditable = in_progress ∧ ¬expired`.)
- **Submit** (`SubmitAttempt`): guarded by `¬deadlinePassed[a]` — the
  candidate command is never the freeze authority for an expired attempt;
  production reconciles inside the submit transaction and returns the
  deadline-attributed freeze (the candidate POST becomes an idempotent
  return).
- **Restore** (`ProcessRestore` guard / `RejectRestoreDeadlineWon`
  terminalization): a deadline-won restore materializes the terminal
  deadline outcome via the same `DeadlineReconcileEffect` — it never leaves
  a perpetual `disrupted + expired` authoritative state (production
  composes policy evaluation → adjustment-if-applicable → reconciliation
  inside the restore transaction, ADR-013 §7).
- **Deadline auto-submit collapse** (`DeadlinePasses`): when the canonical
  deadline reaches the routed attempt while the page is editable, the client
  countdown has hit zero and the runtime deadline auto-submit fires
  (`TakeExamPage` deadline auto-submit → POST submit → server-side deadline
  submission → terminal page). The model collapses this chain atomically,
  so the page's editable authority ends in the same step canonical expiry
  begins.
- **Apply-time deadline gate** (`ApplyAuthoritativeReload`): a frozen
  editable response whose attempt is canonically expired by the time it is
  applied cannot re-open editing (the page lands terminal). This evaluates
  a canonical environment fact — not live server response content — so the
  frozen-delivery principle below is preserved.

All terminalization sites share one operator, `DeadlineReconcileEffect`, so
they cannot drift apart.

---

## Split safety models (state-space discipline)

A single `Next` containing NavigateTo + loss + deadline + grade diverges
past 10^6 distinct states in seconds. The safety model is therefore split
into focused configurations, each exhaustive over a smaller action set:

| Config | Spec | Action set focus |
|---|---|---|
| `RecoveryProtocolSafety.cfg` | `CoreSpec` | single-route restore lifecycle (no NavigateTo); loss included |
| `RecoveryProtocolRouteSwitchSafety.cfg` | `RouteSwitchSpec` | adds **NavigateTo** for cross-attempt races; loss/deadline/grade excluded |
| `RecoveryProtocolSubmissionSafety.cfg` | `SubmissionSpec` | submit / freeze / grade; deadline reconcile |

The **union** of these three action sets equals the full action set
declared in the module (16 actions). Each configuration is exhaustive over
its own action set; per-action *enabledness* still varies by configuration —
e.g. deadline-guarded actions (`RejectRestoreDeadlineWon`, the
reconciliation branches) are inert in Core/RouteSwitch because
`DeadlinePasses` runs only in Submission/Liveness. Run all three via
`pnpm formal:recovery` (the `all` mode).

---

## Properties — what they actually check

Properties NEVER reference a legacy flag. The legacy flags affect ACTION
behavior only (see "Legacy flags" below). Each property below is the TARGET
statement; a legacy config that enables a buggy action violates it.

State predicates (INVARIANTs):

- `TypeOK` — all variables stay in their declared finite domains.
- `NoWrongAttemptRestore` — every restore request's creation-time
  `snapshotAttempt = attemptId` (a restore for B is never initiated from
  A's snapshot).
- `NoStalePageLoadApply` / `NoStaleRestoreApply` — when a snapshot is
  applied, its attempt/generation match the current route/generation. (A
  stale delivery may sit pending; what is forbidden is letting it become
  the applied snapshot.) These two are **intentional semantic aliases**:
  they name distinct obligations (page-load path vs restore/reload path of
  the same stale-apply isolation) and distinct counterexample targets; the
  formulas coincide today and are kept as two names deliberately.
- `EditableRequiresCurrentAuthoritativeSnapshot` — `uiState = "editable"`
  requires `clientSnapshotAttempt = routeAttempt`, current generation, and
  `clientSnapshotEditable`.
- `EditableImpliesNotExpired` — `uiState = "editable"` requires
  `~deadlinePassed[routeAttempt]`: no state may pair an editable page with
  a canonically expired attempt (EXSEM-013/014). This is the regression
  oracle for the Issue #656 F1/F2 defect class (candidate-authority freeze
  of an expired attempt; editable GET served for an expired attempt). It is
  checked as an INVARIANT in `RecoveryProtocolSubmissionSafety.cfg` — the
  only gated safety config where `DeadlinePasses` runs and the deadline and
  the editable page genuinely interact; Core and RouteSwitch exclude
  `DeadlinePasses`, so `deadlinePassed` is constant FALSE there and the
  invariant would be vacuous. Verified non-vacuous: stated against the
  pre-repair model, TLC violates it (Issue #656); on the repaired model it
  holds over the full SubmissionSafety state space.
- `PostOutcomeIsNotPageAuthority` — `uiState = "editable"` requires the
  applied snapshot to have come from a GET (page_load/snapshot_reload),
  tracked via the `lastSnapshotViaGet` history variable. A POST restore
  ack cannot make the page editable.
- `NoCrossAttemptRestoreBlocking` — enabledness safety: when all per-route
  base conditions for starting a restore hold (`RestoreStartBaseConditions`),
  `StartRestore` must be `ENABLED`. Under target (per-attempt guard) this
  holds universally; under legacy (global guard) an in-flight restore for A
  disables `StartRestore` for B, violating the invariant at that state. No
  fairness or scheduler assumption needed. Checked as INVARIANT in the
  route-switch safety config.

Cross-state constraints (PROPERTYs — checked as temporal formulas):

- `TerminalNeverResurrects` — `[][IsTerminal(s) => IsTerminal(s')]_vars`
  (terminal statuses are absorbing; cannot return to in_progress).
- `SubmittedSnapshotImmutable` — once a submitted snapshot is non-NoSnapshot,
  it never changes.
- `ServerVersionNeverDecreases` — `[][serverVersion'[a] >= serverVersion[a]]_vars`.

---

## Legacy flags — actions only, never properties

Each legacy flag enables a buggy ACTION. The corresponding expected-
counterexample config sets exactly one flag TRUE; the buggy action produces
a state that violates the named TARGET property.

| Flag | Buggy action | Caught by |
|---|---|---|
| `LegacyWrongAttemptCapability` | `StartRestore` skips the `clientSnapshotAttempt = routeAttempt` capability gate | `NoWrongAttemptRestore` |
| `LegacyGlobalInFlight` | `StartRestore` uses `~AnyRestoreInFlight` (global) instead of `~RestoreInFlightForRoute` (per-attempt) — A's restore blocks B | `NoCrossAttemptRestoreBlocking` (INVARIANT) |
| `LegacyApplyStalePageLoad` | `ApplyAuthoritativeReload` skips the `IsCurrent(d)` gate — a stale delivery becomes the applied snapshot | `NoStalePageLoadApply` / `NoStaleRestoreApply` |
| `LegacySkipReloadAfterPostFailure` | adds `LegacyApplyPostOutcome` — the POST ack alone drives UI to editable, `lastSnapshotViaGet' = FALSE` | `PostOutcomeIsNotPageAuthority` |

All four counterexamples **reproduce the named violation** under the
committed runner. See `counterexamples/README.md`.

---

## Delivery record — frozen server state

A `Delivery` freezes the server state at the moment the response was
produced (`statusAtResponse`, `editableAtResponse`).
`ApplyAuthoritativeReload` reads the FROZEN values, never the live server
state — otherwise a delayed response would magically carry the latest state
and stale-snapshot-content could not be modeled (only stale request
identity). Only the two fields actually read at apply time are carried;
carrying more needlessly multiplies distinct delivery records.
`pendingDeliveries` is capped (`MAX_DELIVERIES`) so it stays finite.

The served status passed to `MakeDelivery` is the **post-reconciliation**
status (`ReconciledServeStatus`), so a canonically expired attempt is
served terminal, never editable — the delivery freezes the *effective*
server state at response time, which is exactly what the production GET
returns.

---

## Liveness and fairness assumptions

`CurrentResumableAttemptEventuallyProgresses` under weak fairness on
`StartPageLoad`, `StartRestore`, `ServerReturnSnapshot`, `ProcessRestore`,
`RejectRestoreDeadlineWon`, `StartAuthoritativeReload`,
`ApplyAnyAuthoritativeReload`, `ConsumePostAck`. Explicit environmental
assumptions: the network eventually stays available; the user does not
navigate away / unmount; the environment eventually delivers a non-lost
response. Network availability is a documented assumption, not a modeled
toggle (the former constant `networkUp` variable and its unreachable
`NetworkDown`/`NetworkUp` toggling actions were removed as dead surface in
the Issue #656 F6 cleanup; the variable was constant TRUE in every spec, so
no property or fairness obligation changed).

**Liveness result: PARTIAL (failed).** TLC finds a counterexample. The
runner reports this as a FAILURE (exit non-zero) — it is NOT wrapped as
success. Use `pnpm formal:recovery:explore` for a non-gated run.

**Root cause of the PARTIAL:** `LoseResponse` is in `LivenessNext` and can
race with `ApplyAnyAuthoritativeReload`. The environment produces a response,
`Apply` becomes briefly enabled, `LoseResponse` fires first (disabling
`Apply`), and the cycle repeats indefinitely. Weak fairness on `Apply` cannot
resolve this because `Apply` is not *continuously* enabled — it is repeatedly
enabled then disabled by loss. This is an environment-fairness gap, not a
protocol defect.

**NOT a fix:** `SF_vars(LoseResponse)` would *strengthen* loss (require it to
fire whenever repeatedly enabled), making the problem worse. The correct
resolution is one of:

1. **Minimal:** define a `LivenessNextEventuallyDelivered` that excludes
   `LoseResponse`, documenting that liveness holds under the assumption
   "the environment eventually delivers a non-lost response". Response loss
   remains covered by the safety configs.
2. **Refined:** strengthen to `SF_vars(ApplyAnyAuthoritativeReload)` — if an
   applicable authoritative response appears infinitely often, at least one
   is eventually applied. This is a stronger (but still reasonable)
   environment assumption.

Both are deferred to a follow-up. The safety model (which covers the
protocol's correctness guarantees) is unaffected.

---

## Model bounds

| Domain | Value |
|---|---|
| Attempts | {A, B} |
| Generations | {g0, g1} |
| RequestIds | {r0, r1, r2} |
| NetOutcomes | {acknowledged, lost} (defined in module) |
| AnswerValues | {ans0, ans1} |
| MAX_VERSION | 3 |
| MAX_DELIVERIES | 2 |

State-space statistics (TLC2 v2.19 / TLA+ v1.7.4):

```text
CoreSafety       :   4,679 distinct states, depth 25 — PASS
RouteSwitchSafety:  31,158 distinct states, depth 27 — PASS (includes NavigateTo)
SubmissionSafety :  81,140 distinct states, depth 26 — PASS (incl. EditableImpliesNotExpired)
Liveness         :  30,674 distinct states         — PARTIAL (property violated, documented)
```

(Pre-repair SubmissionSafety was 88,936 distinct states; the EXSEM-013/014
repair prunes the forbidden expiry-window states. Post-repair liveness
grows over its pre-repair 14,653 because the reconciled-serve and
deadline-collapse variants add reachable states; the PARTIAL verdict and
its root cause are unchanged.)

Counterexample reproduction (each produces the NAMED violation):

```text
LegacyWrongAttemptRestore       :     10 distinct — NoWrongAttemptRestore violated
LegacyGlobalInFlight            :  1,129 distinct — NoCrossAttemptRestoreBlocking violated (INVARIANT)
LegacyStalePageLoad             :     48 distinct — NoStalePageLoadApply violated
LegacyNoReloadAfterPostFailure :    100 distinct — PostOutcomeIsNotPageAuthority violated
```

---

## Commands

```bash
# Target safety (all three split configs):
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:safety
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:safety:route
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:safety:submission

# Counterexamples (must reproduce named violations):
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:counterexamples

# Liveness (PARTIAL — exits non-zero):
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:liveness

# Non-gated exploration (always exits 0):
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:explore

# All gated checks:
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery
```

Exit-code policy: safety pass / counterexample reproduced → 0; liveness
violation / counterexample not reproduced / tool error → non-zero.

---

## Known runtime/model boundaries

1. **Operator time grants are owned elsewhere.** REC-I4 landed: operator
   time compensation is an explicit, ledger-backed command owned by the
   `formal/tla/operator-grant/` family (ADR-013 §8/§9 — command identity,
   idempotency, retry, ledger↔effect atomicity, cross-tab safety). This
   model deliberately contains no grant mechanism; the former
   `timeGrant`/`GrantExtension`/`TimeGrantNeverDecreases` scaffold was
   stale (unreachable in every gated `Next`) and has been removed. Restore
   never implicitly compensates time.
2. **Liveness PARTIAL** — see above.
3. `NavigateTo` preserves in-flight requests in both modes (the real
   implementation does not cancel old POSTs). The generation token makes
   old requests stale; they are rejected at apply time. The legacy-defect
   switch affects ONLY the guard (`RestoreStartGuard`), not navigation
   behavior — ensuring target and legacy face the same reachable state
   and differ only in guard logic (clean A/B comparison).
4. **bounded_grace is out of policy scope** — see "Policy scope" above.

---

## How to interpret counterexamples

Each `.cfg` enables exactly one legacy flag and points at the invariant/
property the defect violates. Run via `pnpm formal:recovery:counterexamples`.
The runner parses TLC output for the named violation; any other result
(wrong violation, no violation, tool error) is a hard failure.

---

## Deferred work

1. Close the liveness PARTIAL: define `LivenessNextEventuallyDelivered`
   (excluding `LoseResponse`) or strengthen to
   `SF_vars(ApplyAnyAuthoritativeReload)`. Document the eventual-delivery
   environment assumption. Do NOT use `SF_vars(LoseResponse)`.
2. Consider TLC symmetry sets over `Attempts` to allow a single unified
   safety Next if desired.
3. bounded_grace deadline-rescue reachability has no formal owner anywhere
   in `formal/`; if that coverage is ever required, it needs its own model
   family (see "Policy scope").
