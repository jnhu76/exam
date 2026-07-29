# RecoveryProtocol — Formal Model

Authority: `docs/adr/ADR-012-candidate-recovery-contract.md` (binding).
Implementation reference: REC-I3 (`apps/web/src/exam/useAttemptRestore.ts`,
`apps/web/src/pages/exam/TakeExamPage.tsx`, `apps/api/src/routes/attempts.candidate.ts`,
`packages/exam-engine/src/{attemptCommands,deadlineReconciliation}.ts`).

This is an **executable consistency check** over selected recovery-protocol
semantics, not a proof that the TypeScript implementation is a refinement.

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
real answer content, telemetry transport, IndexedDB/SQLite, desktop runtime.

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

The **union** of these covers the full action set; each is independently
exhaustive. Run all three via `pnpm formal:recovery` (the `all` mode).

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
  the applied snapshot.)
- `EditableRequiresCurrentAuthoritativeSnapshot` — `uiState = "editable"`
  requires `clientSnapshotAttempt = routeAttempt`, current generation, and
  `clientSnapshotEditable`.
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
- `TimeGrantNeverDecreases` — `[][timeGrant'[a] >= timeGrant[a]]_vars`.
  **Currently vacuous in REC-F1:** `GrantExtension` (the only action that
  mutates `timeGrant`) is intentionally NOT in any gated `Next` variant —
  target-only time-compensation is deferred to REC-I4. `timeGrant` therefore
  stays at its initial value across all reachable states, so the property
  holds trivially. It is retained as a PROPERTY (not demoted to an
  invariant) so that, once REC-I4 introduces a reachable time-compensation
  action into a gated `Next`, this same property becomes a meaningful
  cross-state check with no config surgery. See "Known runtime/model
  mismatches" §1.

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
produced (`statusAtResponse`, `editableAtResponse`). `ApplyAuthoritativeReload`
reads the FROZEN values, never the live server state — otherwise a delayed
response would magically carry the latest state and stale-snapshot-content
could not be modeled (only stale request identity). Only the two fields
actually read at apply time are carried; carrying more needlessly multiplies
distinct delivery records. `pendingDeliveries` is capped (`MAX_DELIVERIES`)
so it stays finite.

---

## Liveness and fairness assumptions

`CurrentResumableAttemptEventuallyProgresses` under weak fairness on
`StartPageLoad`, `StartRestore`, `ServerReturnSnapshot`, `ProcessRestore`,
`RejectRestoreDeadlineWon`, `StartAuthoritativeReload`,
`ApplyAnyAuthoritativeReload`, `ConsumePostAck`. Explicit environmental
assumptions: network eventually stays available; user does not navigate
away / unmount; environment eventually delivers a non-lost response.

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
| MAX_GRANT | 1 |
| MAX_DELIVERIES | 2 |
| MarkDisrupted | once per attempt |

State-space statistics (TLC v2.19 / TLA+ v1.7.4, 1–2 workers):

```text
CoreSafety       :   4,679 distinct states, depth 25 — PASS
RouteSwitchSafety:  31,158 distinct states, depth 26 — PASS (includes NavigateTo)
SubmissionSafety :  88,936 distinct states, depth 26 — PASS
Liveness         :  14,653 distinct states         — PARTIAL (property violated)
```

Counterexample reproduction (each produces the NAMED violation):

```text
LegacyWrongAttemptRestore       :     10 distinct — NoWrongAttemptRestore violated
LegacyGlobalInFlight            :  1,127 distinct — NoCrossAttemptRestoreBlocking violated (INVARIANT)
LegacyStalePageLoad             :     63 distinct — NoStalePageLoadApply violated
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

## Known runtime/model mismatches

1. **REC-I4 (time-compensation) deferred.** `ProcessRestore` leaves
   `timeGrant` unchanged in the model. The runtime may still grant time
   inside `restoreAttempt`; the TARGET model separates `ProcessRestore` from
   `GrantExtension` and intentionally keeps `GrantExtension` OUT of every
   gated `Next`. As a result `TimeGrantNeverDecreases` is **target-only and
   currently vacuous** — `timeGrant` is constant at its initial value across
   all reachable states. The property is retained as a PROPERTY precisely so
   it becomes a meaningful cross-state check once REC-I4 introduces a
   reachable time-compensation action; no REC-F1 widening of scope is
   implied. Recorded, NOT modeled as target.
   RecoveryProtocol's `timeGrant` properties remain locally vacuous in the
   recovery model. The independent operator-grant model owns command,
   idempotency, and cross-tab semantics (see
   `formal/tla/operator-grant/`).
2. **Liveness PARTIAL** — see above.
3. `NavigateTo` preserves in-flight requests in both modes (the real
   implementation does not cancel old POSTs). The generation token makes
   old requests stale; they are rejected at apply time. The legacy-defect
   switch affects ONLY the guard (`RestoreStartGuard`), not navigation
   behavior — ensuring target and legacy face the same reachable state
   and differ only in guard logic (clean A/B comparison).

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
