# RecoveryProtocol — Formal Model

Authority: `docs/adr/ADR-012-candidate-recovery-contract.md` (binding).
Implementation reference: REC-I3 (`apps/web/src/exam/useAttemptRestore.ts`,
`apps/web/src/pages/exam/TakeExamPage.tsx`, `apps/api/src/routes/attempts.candidate.ts`,
`packages/exam-engine/src/{attemptCommands,deadlineReconciliation}.ts`).

This is an **executable consistency check** over selected recovery-protocol
semantics, not a proof that the TypeScript implementation is a refinement.

---

## Scope

Modeled:

- the abstract recovery protocol among Client, Server, and Environment;
- route identity + client generation token (REC-I3 `generationRef`);
- authoritative server attempt state and the client's applied snapshot;
- page-load GET, restore POST, and post-restore snapshot-reload GET;
- request/response delay, reordering, and loss;
- deadline reconciliation and submission;
- UI recovery phase transitions;
- the route-bound restore authority, stale-response isolation, terminal-state
  monotonicity, submitted-snapshot immutability, server-version monotonicity,
  cross-attempt non-blocking, "POST is not page authority", and "restore does
  not directly grant time" (REC-I4 target) properties.

Not modeled (out of scope):

- React `useEffect`/`useRef`, DOM nodes, Fastify routes, PostgreSQL tables,
  HTTP serialization, RBAC, grading algorithms, real answer content,
  telemetry transport, IndexedDB/SQLite, desktop runtime.

---

## Non-goals

- This model does **not** mechanically verify that the TypeScript
  implementation conforms. A passing safety check verifies the *protocol*
  over a small finite domain.
- The model represents the **TARGET** contract (ADR-012). Where the current
  runtime still differs (REC-I4 time-compensation), the mismatch is recorded
  in `docs/audits/REC-F1-RECOVERY-PROTOCOL-FORMAL-MODEL.md`, not encoded as
  target behavior.

---

## Participants

- **Client** — owns the route, generation token, applied snapshot, UI phase,
  and the page-load / restore / reload request lifecycle.
- **Server** — owns authoritative attempt status, version, submitted
  snapshot, deadline reconciliation, restore processing, grading.
- **Environment** — decides response delivery, delay, loss, and reordering.

---

## Variables

| Variable | Domain | Role |
|---|---|---|
| `serverStatus[a]` | Statuses | authoritative attempt lifecycle |
| `serverVersion[a]` | `0..MAX_VERSION` (3) | monotonic; never decreases |
| `submittedSnapshot[a]` | AnswerValues ∪ {NoSnapshot} | frozen at submit (ADR-008) |
| `disruptedOnce[a]` | BOOLEAN | bounds MarkDisrupted (excluded from Next) |
| `routeAttempt` | Attempts | the page's current route |
| `clientGeneration` | Generations | monotonic token (REC-I3 generationRef) |
| `clientSnapshotAttempt` | Attempts ∪ {NoSnapshot} | attempt of the applied snapshot |
| `clientSnapshotGen` | Generations | generation of the applied snapshot |
| `clientSnapshotEditable` | BOOLEAN | isEditable of the applied snapshot |
| `pageLoadRequests` | SUBSET Request | in-flight initial GETs |
| `restoreRequests` | SUBSET Request | in-flight POST /restore |
| `snapshotReloadRequests` | SUBSET Request | in-flight post-restore GETs |
| `pendingDeliveries` | SUBSET Delivery | queued responses (may reorder/loss) |
| `uiState` | Phases | loading/restoring/editable/restore_failed/terminal/unavailable |
| `networkUp` | BOOLEAN | held TRUE (network-stable fairness assumption) |
| `deadlinePassed[a]` | BOOLEAN | set by DeadlinePasses; consumed by DeadlineReconcile |
| `timeGrant[a]` | `0..MAX_GRANT` (1) | only GrantExtension may bump |

`Request` carries `requestId`, `attemptId`, `generation`, `requestKind`, and
`snapshotAttempt` (the client's applied-snapshot attempt at creation — used by
`NoWrongAttemptRestore`).

---

## Actions

Client/navigation: `NavigateTo` (defined; not in Next), `StartPageLoad`,
`StartRestore`, `RetryRestore`, `StartAuthoritativeReload`,
`ApplyAuthoritativeReload(d)`, `Unmount` (defined; not in Next).

Server: `MarkDisrupted` (defined; not in Next — Init models disrupted),
`ServerReturnSnapshot`, `ProcessRestore`, `RejectRestoreDeadlineWon`,
`DeadlineReconcile`, `SubmitAttempt`, `GradeAttempt`, `GrantExtension`
(defined; not in Next — structural property verified by invariant).

Environment: `DelayResponse`, `DeliverResponse` (defined; not in Next —
stuttering no-ops; `ApplyAuthoritativeReload` already chooses any pending
delivery for reordering), `LoseResponse`, `NetworkDown`/`NetworkUp` (defined;
not in Next — network-stable fairness assumption),
`DeadlinePasses`.

The full action set is documented for completeness and for the
counterexample vocabulary; the excluded actions are listed in the `Next`
comment with their rationale.

---

## Invariants (safety)

| Invariant | Property |
|---|---|
| `TypeOK` | all variables stay in their declared finite domains |
| `NoWrongAttemptRestore` | a restore for B is never initiated from A's snapshot |
| `NoStalePageLoadApply` | a stale page-load response cannot replace the applied snapshot |
| `NoStaleRestoreApply` | a stale restore/reload chain cannot mutate the applied snapshot |
| `EditableRequiresCurrentAuthoritativeSnapshot` | editable requires a current-generation GET snapshot |
| `TerminalNeverResurrects` | terminal status cannot return to in_progress |
| `SubmittedSnapshotImmutable` | submitted snapshot does not change after freeze |
| `ServerVersionNeverDecreases` | serverVersion is monotonic and bounded |
| `NoCrossAttemptRestoreBlocking` | the in-flight guard is keyed on the current route only |
| `RestoreDoesNotDirectlyChangeDeadline` | only GrantExtension may bump timeGrant |
| `PostOutcomeIsNotPageAuthority` | editable requires an applied GET (POST is not authority) |

All 11 hold under the target (legacy-flag-off) configuration.

---

## Liveness and fairness assumptions

The temporal property `CurrentResumableAttemptEventuallyProgresses` is checked
under weak fairness on `StartPageLoad`, `StartRestore`, `ServerReturnSnapshot`,
`ProcessRestore`, `RejectRestoreDeadlineWon`, `StartAuthoritativeReload`, and
`ApplyAnyAuthoritativeReload`.

**Explicit fairness assumptions** (without these the property does not hold):

- the network eventually stays available (modeled by holding `networkUp = TRUE`
  and excluding `NetworkDown`/`NetworkUp` from Next);
- the user does not navigate away from the route (modeled by excluding
  `NavigateTo` from the liveness Next);
- the user does not unmount the page (modeled by excluding `Unmount`);
- the environment eventually delivers a non-lost authoritative response
  (modeled by excluding `LoseResponse` from the liveness Next — loss is still
  verified for safety);
- the server eventually processes enabled requests;
- the client eventually fires enabled page-load / restore / reload.

**Liveness result: PARTIAL.** Under the current fairness annotations TLC
finds a counterexample in which the restore/post-rejection/deadline-
reconciliation cycle does not converge to editable/terminal/restore_failed.
The cycle is rooted in the interaction between `RejectRestoreDeadlineWon`
and `DeadlineReconcile` for an attempt whose deadline passes during
restore. This is recorded as PARTIAL per the REC-F1 prompt §14/§20:
safety is exhaustively verified; liveness is documented, not silently
deleted. The recommended next step is a refined deadline/restore
interaction model (see "Deferred work" below).

---

## Model bounds

| Domain | Value | Rationale |
|---|---|---|
| Attempts | {A, B} | two distinct attempts for cross-attempt coverage |
| Generations | {g0, g1} | one route change worth of generation tokens |
| RequestIds | {r0, r1, r2} | small; in-flight guard is per-attempt, not pool-based |
| NetOutcomes | {acknowledged, lost} | server always succeeds; environment decides delivery |
| AnswerValues | {ans0, ans1} | symbolic; only immutability is asserted |
| MAX_VERSION | 3 | bounded serverVersion |
| MAX_GRANT | 1 | bounded timeGrant |
| MarkDisrupted | once per attempt | bounds disrupt/restore cycles |

State-space statistics (target safety run, 1 worker, TLC v2.19 / TLA+ v1.7.4):

```text
10,584,513 states generated
1,020,640 distinct states found
0 states left on queue
depth 43
~30s wall-clock
fingerprint collision probability: optimistic 5.3E-7, actual 8.0E-8
```

The fingerprint collision probability is non-zero (the model is checked
with TLC's default 64-bit fingerprint). It is well below the threshold
where undetected state collisions would plausibly mask a violation, but a
future run with `-fpbits N` or a larger `Generations`/`RequestIds` could
reduce it further if required.

---

## Commands

```bash
# Safety (target — all legacy flags FALSE):
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:safety

# Liveness (PARTIAL — see above):
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:liveness

# Expected counterexamples:
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery:counterexamples

# All:
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:recovery
```

The runner streams TLC output, parses the violated-invariant name, and
distinguishes target-pass / liveness-PARTIAL / counterexample-NOT_REPRODUCED
/ hard-failure. See `scripts/formal/run-recovery-tlc.mjs`.

---

## Expected outputs

- **Safety**: `Model checking completed. No error has been found.` (exit 0)
- **Liveness**: currently `Temporal properties were violated.` under the
  PARTIAL annotation (the runner reports this as PARTIAL, not a hard fail).
- **Counterexamples**: see `counterexamples/README.md`.

---

## Known runtime/model mismatches

1. **REC-I4 (time-compensation policy) is deferred.** The current
   `restoreAttempt` runtime may still grant full disconnected-time
   compensation inside the restore command. The TARGET model separates
   state restoration (`ProcessRestore`) from time compensation
   (`GrantExtension`); the runtime mismatch is documented, NOT modeled as
   target. `RestoreDoesNotDirectlyChangeDeadline` is the target invariant.
2. **NavigateTo is excluded from Next** for state-space finiteness.
   Cross-attempt race safety is verified structurally (request creation-time
   binding + per-attempt in-flight guard), not by exercising route changes.
3. **Liveness is PARTIAL** (see above).
4. **Counterexamples are not mechanically reproduced** under the finite
   model (see `counterexamples/README.md`).

---

## How to interpret counterexamples

Each `.cfg` under `counterexamples/` enables exactly one legacy-defect flag
and points at the invariant the defect would violate. Run them via
`pnpm formal:recovery:counterexamples`. A result of NOT_REPRODUCED is a
documented finite-model gap (not a silent success); a result of
EXPECTED_VIOLATION confirms the model reproduces the bug class; any other
violation is a hard failure.

---

## How REC-I3 / REC-I4 / REC-I2a / REC-I1 relate to the model

- **REC-I3** (implemented): the explicit frontend restore flow modeled here.
  The route-binding tokens (`routeAttempt`, `clientGeneration`), the
  per-attempt in-flight guard, and the "POST is not authority" rule mirror
  `useAttemptRestore.ts`.
- **REC-I4** (pending): time-compensation policy. The model separates
  `ProcessRestore` (lifecycle) from `GrantExtension` (time) — the TARGET.
  The current runtime mismatch is documented.
- **REC-I2a** (pending): protocol hardening (operation identity, strict
  baseVersion). Not directly modeled; the `Request` record's
  `snapshotAttempt` is a related creation-time binding.
- **REC-I1** (pending, blocked on REC-I2a): durable pending-answer journal.
  Out of scope for this model (answer content is symbolic).

---

## Deferred work

1. Refine the deadline/restore interaction so the liveness property holds
   under fairness (currently PARTIAL). Candidate: make `RejectRestoreDeadlineWon`
   transition `uiState` to a state from which the reload GET provably fires,
   and bound `DeadlineReconcile` against repeated re-freezing.
2. Reproduce the expected counterexamples mechanically — requires either
   including a bounded `NavigateTo` (with symmetry sets or a smaller
   cross-attempt state graph) or modeling the buggy transitions directly
   behind each legacy flag.
3. Consider TLC symmetry sets (`Attempts` are symmetric) to reduce the state
   space and allow a richer model.
