# Operator Grant Formal Model

REC-I4-F1 — TLA+ safety models for the operator time-grant protocol.

Authority: `docs/adr/ADR-013-interruption-time-compensation-policy.md` is binding.

## Models

| Model | Scope | Target config |
| --- | --- | --- |
| `OperatorGrantServer.tla` | PostgreSQL transaction idempotency and concurrency | `OperatorGrantServerSafety.cfg` |
| `OperatorGrantClient.tla` | Browser cross-tab command coordination | `OperatorGrantClientSafety.cfg` |

## Running

```bash
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant:server
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant:client
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant:witnesses
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant:counterexamples
pnpm formal:operator-grant:runner-test
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant
```

See `formal/tla/TOOLCHAIN.md` for the pinned TLA+ tools version.

## Server model

The server model explores two transactions using the same operationId.
Attempt and payload assignments are independent, so the exhaustive target run
contains all of:

```text
same Attempt + same payload
same Attempt + different payload
different Attempt
```

The model has one operationId because this Job isolates the unique-key race.
`txOperation` still binds every transaction to its own operation lookup, so no
action reads an arbitrary operation fact.

### Finite domains

```text
Attempts = {A1, A2}
Txs = {T1, T2}
Operations = {Op1}
Payloads = {P1, P2}
```

### Ledger and effect representation

```text
ledgerFacts ⊆ Txs
deadlineApplyCount ∈ [Attempts -> 0..2]
```

Each member of `ledgerFacts` is one committed row whose stored values are
`txOperation[t]`, `txAttempt[t]`, and `txPayload[t]`. Two transactions can
therefore create two rows for the same operationId under a legacy action.

The deadline application count can reach `2`; neither the type invariant nor
the state representation precludes duplicate application to one Attempt.

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

`ReadExistingOperation` handles a transaction whose first operation lookup
occurs after the winner commits. Without that action, enabling TLC deadlock
checking exposes a real stuck `begun` state.

`CompletedStutter` is enabled only after both transactions reached a terminal
response. It represents intentional protocol termination and cannot mask a
stuck in-progress transaction.

### Target safety properties

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

Atomicity is checked in both directions. `RetryDoesNotApplyAgain` checks an
exact count of `1`; the legacy retry reaches count `2`.

### Reachability evidence

Two dedicated target-semantics configs intentionally violate witness
invariants:

| Config | Named witness violation | Result |
| --- | --- | --- |
| `ServerSameAttemptReplay.cfg` | `NoSameAttemptReplayWitness` | reproduced at depth 7 |
| `ServerSameAttemptPayloadConflict.cfg` | `NoSameAttemptDifferentPayloadConflictWitness` | reproduced at depth 7 |

These traces prove the replay and same-Attempt payload-conflict branches are
reachable; their safety properties are not merely conditional dead code.

### Target TLC result

```text
generated: 4520
distinct:  2392
depth:     9
workers:   2
result:    PASS (no invariant violation, deadlock checking enabled)
```

## Client model

The client model covers one fixed organizationId + attemptId workflow and one
command generation. A command contains:

```text
operationId
payload = canonical abstraction of addedSeconds + reasonCode + reasonText
```

The attemptId is fixed by the modeled workflow. `CmdOperation` and
`CmdPayload` make operationId and payload independently observable.

### Finite domains

```text
Tabs = {Tab1, Tab2}
CmdIds = {C1, C2, C3, C4}
Ops = {O1, O2}
Payloads = {P1, P2}

C1 = (O1, P1)
C2 = (O1, P1)  same operation + same payload
C3 = (O1, P2)  same operation + different payload
C4 = (O2, P1)  different operation + same payload
```

### Variables

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

`serverOutcome[t]` is the authoritative response observed for that tab.
Terminal display safety compares against it directly.

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

There is no empty `SubmitCommand` action. `ServerCommit` represents the POST.

The model deliberately covers one generation. Any confirmed authoritative
outcome sets `workflowComplete`; no action can open another draft afterward.
`commandCreator` is therefore stable. `CompletedWorkflowStutter` is enabled
only for this intentional terminal state.

### Target safety properties

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

The properties cover different surfaces:

- stored shared/local pending authorities contain at most one semantic command;
- distinct unresolved tabs submit the same operationId and payload;
- reload/takeover is identified by `tabRestoredFromShared`;
- every confirmed generation clears shared and legacy pending authorities;
- authoritative terminal cannot be projected as granted;
- a visible granted result must match that tab's committed frozen command.

### Target TLC result

```text
generated: 33929
distinct:  7329
depth:     16
workers:   2
result:    PASS (no invariant violation, deadlock checking enabled)
```

## Counterexamples

See `counterexamples/README.md`. Ten configs each enable one legacy action
switch and check one target invariant. The runner accepts only the exact named
invariant violation; pass, a different invariant, temporal failure, deadlock,
spawn failure, parse failure, JVM failure, and other tool errors all fail the
suite.

## State-space justification

The server representation changed because a per-operation function could not
represent duplicate rows. The replacement adds one subset over the existing
two transaction identities and changes the effect range from `0..1` to `0..2`.
This is the smallest bound that represents the two reviewed duplicate classes.

The client command domain changed from two opaque identities to four mapped
facts so all three operation/payload relations are present simultaneously.
`serverOutcome`, `tabRestoredFromShared`, and `workflowComplete` distinguish
authoritative response mapping, reload provenance, and the single-generation
terminal state. All additions are finite and deterministic after each action.

Both target configs use exhaustive BFS, remain below the 500,000-distinct-state
budget, and complete in under 60 seconds on the recorded machine.

## Fairness assumptions

None. The target configs check safety invariants only (`INVARIANT`, no
`PROPERTY`). No liveness is verified, so the model assumes no fairness for
server processing, response delivery, retry, tab lifetime, or user actions.

## Known runtime/model mismatches

- The models are executable consistency checks, not TypeScript/PostgreSQL
  refinement proofs.
- The server model was compared with
  `packages/exam-engine/src/operatorGrant.ts`,
  `packages/db/src/repository/attemptTimeAdjustmentRepo.ts`, and
  `apps/api/src/routes/attempts.admin.ts`. It abstracts row/Exam locks,
  connection pooling, HTTP, RBAC, audit, timestamps, and reason validation.
- The client target is not the current runtime. The current
  `ProctorDashboardPage.tsx` uses per-tab `sessionStorage` and explicitly falls
  back to in-memory state if storage fails. Shared cross-tab authority and
  fail-closed storage belong to REC-I4-C1. The legacy per-tab counterexample
  records this target/runtime gap rather than disguising it.
- The client model fixes one organizationId + attemptId workflow and one
  generation. Cross-workflow concurrency, later confirmed generations,
  different browser profiles/devices, and the concrete shared-storage
  implementation are outside this finite model.

## Relationship to RecoveryProtocol

`formal/tla/recovery/` models candidate recovery. Its `timeGrant` properties
remain locally vacuous there. This independent model owns the operator command,
idempotency, retry, atomicity, and cross-tab safety semantics.
