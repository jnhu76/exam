# REC-I4-F1 — Operator Grant Formal Model (Implementation Closeout)

Authority: `docs/adr/ADR-013-interruption-time-compensation-policy.md`.
Models: [`formal/tla/operator-grant/`](../../formal/tla/operator-grant/).
Runner: [`scripts/formal/run-operator-grant-tlc.mjs`](../../scripts/formal/run-operator-grant-tlc.mjs).

## Status

`REC-I4-F1 MODEL CHECKED — READY FOR HUMAN REVIEW`

- Server target safety: PASS, exhaustive BFS, 2,392 distinct states, depth 9.
- Client target safety: PASS, exhaustive BFS, 7,329 distinct states, depth 16.
- Target reachability: both same-Attempt witnesses reproduced.
- Expected negatives: all 10 configs reproduced the exact named invariant.
- Runner tests: 5 PASS.
- TLC deadlock checking is enabled.
- The formal suite is not a default `pnpm verify` or CI gate.

## Purpose

The two independent models cover the ADR-013 operator-grant protocol:

1. `OperatorGrantServer.tla` models operationId uniqueness, transaction
   winner/loser behavior, bidirectional ledger/deadline atomicity, exact
   replay/conflict classification, terminal rejection, and retry count.
2. `OperatorGrantClient.tla` models one cross-tab command generation,
   operationId/payload freezing, shared pending authority, response loss,
   reload/takeover, authoritative outcome mapping, and confirmed clearing.

These are executable consistency checks. They do not mechanically prove that
the TypeScript/PostgreSQL implementation refines the model.

## Files inspected

```text
docs/adr/ADR-013-interruption-time-compensation-policy.md
packages/exam-engine/src/operatorGrant.ts
packages/db/src/repository/attemptTimeAdjustmentRepo.ts
apps/api/src/routes/attempts.admin.ts
apps/web/src/pages/admin/ProctorDashboardPage.tsx
formal/tla/recovery/RecoveryProtocol.tla
scripts/formal/run-recovery-tlc.mjs
formal/AGENTS.md
formal/README.md
formal/tla/TOOLCHAIN.md
```

`packages/exam-engine/src/operatorGrant.ts` exists and is tracked in the
current repository; no replacement path is needed.

## Server finite model

```text
Attempts = {A1, A2}
Txs = {T1, T2}
Operations = {Op1}
Payloads = {P1, P2}
```

`txAttempt` and `txPayload` are independently selected. The former
distinct-Attempt initialization restriction was removed.

### State representation

```text
attemptStatus
deadlineApplyCount        [Attempts -> 0..2]
ledgerFacts               subset of Txs
txPhase
txOperation
txAttempt
txPayload
txOutcome
responseSent
```

Every `ledgerFacts` member is a separate committed row described by
`txOperation[t]`, `txAttempt[t]`, and `txPayload[t]`. Two facts can carry the
same operationId, so the model can represent the database uniqueness defect it
checks.

`deadlineApplyCount` can reach 2. Duplicate application to one Attempt is not
excluded by the type invariant.

### Target actions

```text
BeginCommand
ReadOperationAbsent
ReadExistingOperation
CommitWinner
ObserveUniqueViolation
BeginFreshRecovery
ReadCommittedWinner
ReturnTerminal
ReturnGranted
LoseResponse
RetrySameCommand
CompletedStutter
```

Removing the runner's deadlock-disable flag exposed a missing state:
`begun` after another transaction already committed. `ReadExistingOperation`
now sends that command to the authoritative committed-row read.

`CompletedStutter` is restricted to the state where every transaction has a
terminal response. It does not create a generic in-flight self-loop.

### Target safety invariants

```text
ServerTypeOK
AtMostOneLedgerPerOperation
AtMostOneDeadlineEffectPerOperation
LedgerImpliesExactlyOneEffect
EffectImpliesExactlyOneLedger
ConflictLoserDeadlineUnchanged
ReplayReturnsCommittedFact
DifferentCommandReturnsIdempotencyConflict
TerminalAttemptNeverGranted
RetryDoesNotApplyAgain
```

Atomicity is a two-way relationship:

```text
ledger row  => exactly one matching deadline application
application => exactly one matching ledger row
```

`RetryDoesNotApplyAgain` requires the matching count and total count to remain
exactly 1. The legacy retry reaches 2.

## Server reachability evidence

The witness configs use target semantics only; all legacy switches are false.
They intentionally check a false invariant so TLC emits a named trace.

| Config | Named violation | Depth |
| --- | --- | ---: |
| `ServerSameAttemptReplay` | `NoSameAttemptReplayWitness` | 7 |
| `ServerSameAttemptPayloadConflict` | `NoSameAttemptDifferentPayloadConflictWitness` | 7 |

The first trace uses distinct transactions with the same operationId, Attempt,
and payload and reaches `idempotent_replay`. The second keeps operationId and
Attempt equal, changes payload, and reaches `idempotency_conflict`.

## Client finite model

```text
Tabs = {Tab1, Tab2}
CmdIds = {C1, C2, C3, C4}
Ops = {O1, O2}
Payloads = {P1, P2}

C1 = (O1, P1)
C2 = (O1, P1)
C3 = (O1, P2)
C4 = (O2, P1)
```

This domain simultaneously contains:

```text
same operation + same payload
same operation + different payload
different operation + same payload
```

The modeled workflow fixes organizationId + attemptId. `Payloads` abstract the
canonical `addedSeconds + reasonCode + reasonText` payload.

### State representation

```text
tabPhase
tabDraftCmd
tabFrozenCmd
tabVisibleOutcome
tabRestoredFromShared
sharedPendingCmd
tabLocalPendingCmd
serverCommittedCmd
serverOutcome
commandCreator
workflowComplete
```

`serverOutcome[t]` is independent authoritative response state. Terminal
display safety compares it directly with `tabVisibleOutcome[t]`.

### Target actions

```text
OpenDraft
EditDraft
FreezeAndPublishCommand
AdoptSharedOverDraft
ServerCommit
ServerReplay
DeliverSuccessResponse
LoseResponse
CloseIndeterminateDialog
NavigateAway
ReloadTab
RestoreSharedPendingCommand
RetryFrozenCommand
ConfirmTerminal
ConfirmRejected
ConfirmConflict
CompletedWorkflowStutter
```

The former stateless `SubmitCommand` self-loop was removed. `ServerCommit`
represents the request.

The model covers one command generation. Confirmation sets
`workflowComplete`, prevents later `OpenDraft`, and stabilizes
`commandCreator`. `CompletedWorkflowStutter` represents only that intentional
terminal state.

### Target safety invariants

```text
ClientTypeOK
FrozenCommandImmutable
IndeterminatePreservesCommandIdentity
AtMostOneUnresolvedCommandPerWorkflow
NoSecondSubmitWhileUnresolved
ReloadRestoresExactCommand
ConfirmedOutcomeClearsPending
TerminalNeverReportedAsGranted
VisibleGrantedMatchesServerCommit
```

All declared invariants are listed in `OperatorGrantClientSafety.cfg`.
`ConfirmedOutcomeClearsPending` now checks that the one confirmed generation
clears shared and legacy local pending authority.

`TerminalNeverReportedAsGranted` checks:

```text
serverOutcome[t] = terminal
  => tabVisibleOutcome[t] != granted
```

`VisibleGrantedMatchesServerCommit` separately requires granted to match the
tab's committed frozen operationId and payload.

## Target TLC results

### Server

```text
generated: 4,520
distinct:  2,392
depth:     9
workers:   2
runtime:   < 2 s
result:    PASS (no invariant violation; no unexpected deadlock)
```

### Client

```text
generated: 33,929
distinct:  7,329
depth:     16
workers:   2
runtime:   < 2 s
result:    PASS (no invariant violation; no unexpected deadlock)
```

## Expected-negative evidence

| Config | Exact violated invariant | Depth |
| --- | --- | ---: |
| `ServerLegacyDuplicateEffect` | `AtMostOneLedgerPerOperation` | 7 |
| `ServerLegacyPartialCommit` | `LedgerImpliesExactlyOneEffect` | 4 |
| `ServerLegacyDeadlineOnlyCommit` | `EffectImpliesExactlyOneLedger` | 4 |
| `ServerLegacyWrongConflictOutcome` | `DifferentCommandReturnsIdempotencyConflict` | 7 |
| `ServerLegacyTerminalGrant` | `TerminalAttemptNeverGranted` | 4 |
| `ServerLegacyRetryDuplicateApply` | `RetryDoesNotApplyAgain` | 6 |
| `ClientLegacyPerTabPending` | `AtMostOneUnresolvedCommandPerWorkflow` | 5 |
| `ClientLegacyNewIdentityAfterLoss` | `IndeterminatePreservesCommandIdentity` | 4 |
| `ClientLegacyMutableRetry` | `FrozenCommandImmutable` | 5 |
| `ClientLegacyTerminalAsGranted` | `TerminalNeverReportedAsGranted` | 4 |

The duplicate server action inserts a second ledger fact. Ledger-only and
deadline-only partial commits cover both atomicity directions. The retry
counterexample increments one Attempt from count 1 to 2. The client mutable
retry keeps operationId and changes payload. The terminal client defect sets
authoritative terminal while displaying granted.

Witness and expected-negative runs stop at the first named violation. Their
partial generated/distinct counts can vary with worker scheduling, so this
audit records deterministic trace depth rather than presenting partial counts
as complete state-space statistics. The complete target state statistics above
are exhaustive and stable.

## Runner hardening

The runner now:

- keeps TLC deadlock checking enabled;
- validates `FORMAL_WORKERS` as a positive integer;
- treats Java probe error, signal, or nonzero status as an immediate failure;
- treats child-process spawn failure as a tool failure;
- returns an unconditional `__temporal__` sentinel for temporal failure;
- returns a distinct `__deadlock__` sentinel for deadlock;
- accepts a counterexample/witness only when TLC reports the exact configured
  invariant name.

Runner unit tests cover temporal classification, spawn failure, worker
validation, broken Java status, and the absence of `-deadlock`.

## State-space justification

The server adds only:

```text
ledgerFacts ⊆ two transaction identities
deadlineApplyCount range 0..2
txOperation over a singleton operation set
```

These are the minimum finite values needed to express two ledger rows and two
applications. Removing the forced distinct-Attempt constraint broadens
initial mappings without adding an unbounded domain.

The client adds two command identities, a finite authoritative outcome per tab,
a finite reload-provenance bit per tab, and one finite workflow terminal bit.
The four command identities are the minimum explicit mapping used here to
contain all three operation/payload relations simultaneously.

Both target runs remain below the 500,000-distinct-state budget.

## Fairness

None. Both target configs are safety-only (`INVARIANT`, no `PROPERTY`).
No liveness claim is made, and no fairness assumption is imposed on server
processing, response delivery, retry, tab lifetime, or user action.

## Runtime/model mismatches

- No mechanical refinement proof connects either model to production.
- The server abstraction omits row/Exam locks, connection pooling, HTTP, RBAC,
  audit, timestamps, and input validation.
- The current client in
  `apps/web/src/pages/admin/ProctorDashboardPage.tsx` uses per-tab
  `sessionStorage` and falls back to memory when storage fails. It does not yet
  implement the model's shared cross-tab authority or fail-closed behavior.
  That target/runtime gap belongs to REC-I4-C1 and is preserved by the
  `LegacyPerTabPending` counterexample.
- The client fixes one workflow and one generation. Cross-workflow commands,
  later confirmed generations, different browser profiles/devices, and
  concrete storage coordination are outside the model.

## Toolchain

```text
TLA+ tools: v1.7.4
TLC:        v2.19
Java:       OpenJDK 25.0.3
workers:    2
runner:     scripts/formal/run-operator-grant-tlc.mjs
```

The JAR remains external through `TLA2TOOLS_JAR`; no binary or generated TLC
state is committed.
