# Operator Grant Formal Model

REC-I4-F1 — TLA+ safety models for the operator time-grant protocol.

Authority: `docs/adr/ADR-013-interruption-time-compensation-policy.md` is binding.

## Models

| Model | Scope | Config |
| --- | --- | --- |
| OperatorGrantServer.tla | PostgreSQL transaction-level idempotency and concurrency | OperatorGrantServerSafety.cfg |
| OperatorGrantClient.tla | Browser-side cross-tab command coordination | OperatorGrantClientSafety.cfg |

## Running

```bash
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant:server
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant:client
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant:counterexamples
TLA2TOOLS_JAR=/path/to/tla2tools.jar pnpm formal:operator-grant
```

See `formal/tla/TOOLCHAIN.md` for the pinned TLA+ tools version.

## Server model (OperatorGrantServer.tla)

Models two independent PostgreSQL transactions racing on the same
operationId targeting different Attempts. The unique constraint
(organizationId, operationId) is the sole winner authority.

### Finite domains

```text
Attempts = {A1, A2}, Exams = {E1, E2}, Txs = {T1, T2}
Operations = {Op1}, Payloads = {P1, P2}
```

### Variables

```text
attemptStatus, attemptDeadlineEffect, ledgerAttempt, ledgerPayload,
txPhase, txAttempt, txPayload, txOutcome, responseSent
```

### Target actions

```text
BeginCommand, ReadOperationAbsent, CommitWinner, ObserveUniqueViolation,
BeginFreshRecovery, ReadCommittedWinner, ReturnTerminal, ReturnGranted,
LoseResponse, RetrySameCommand
```

### Target safety properties

```text
ServerTypeOK, AtMostOneLedgerPerOperation,
AtMostOneDeadlineEffectPerOperation, LedgerAndDeadlineCommitAtomically,
ConflictLoserDeadlineUnchanged, ReplayReturnsCommittedFact,
DifferentCommandReturnsIdempotencyConflict, TerminalAttemptNeverGranted,
RetryDoesNotApplyAgain
```

### Legacy-defect switches

```text
LegacyDuplicateEffect, LegacyPartialCommit,
LegacyWrongConflictOutcome, LegacyTerminalGrant
```

### TLC result (target safety)

```text
1224 distinct states, depth 11, 2 workers, < 2 s — PASS
```

## Client model (OperatorGrantClient.tla)

Models the browser-side command lifecycle: draft creation, atomic
freeze/publish, submission, response handling, cross-tab coordination
via a shared pending-command authority, response loss recovery, and
reload restoration.

### Finite domains

```text
Tabs = {Tab1, Tab2}, CmdIds = {C1, C2}, Ops = {O1, O2},
Payloads = {P1, P2}
```

One workflow: fixed organizationId + attemptId.

### Variables

```text
tabPhase, tabDraftCmd, tabFrozenCmd, tabVisibleOutcome,
sharedPendingCmd, tabLocalPendingCmd, serverCommittedCmd, commandCreator
```

### Target actions

```text
OpenDraft, EditDraft, FreezeAndPublishCommand, SubmitCommand,
ServerCommit, DeliverResponse, LoseResponse, CloseDialog, Navigate,
ReloadTab, RestoreSharedPendingCommand, RetryFrozenCommand,
ConfirmTerminal, ConfirmRejected, ClearConfirmedCommand
```

### Target safety properties

```text
ClientTypeOK, FrozenCommandImmutable,
IndeterminatePreservesCommandIdentity,
AtMostOneUnresolvedCommandPerWorkflow, NoSecondSubmitWhileUnresolved,
ReloadRestoresExactCommand, TerminalNeverReportedAsGranted
```

### Legacy-defect switches

```text
LegacyPerTabPending, LegacyNewIdentityAfterLoss,
LegacyMutableRetry, LegacyTerminalAsGranted
```

### TLC result (target safety)

```text
8039 distinct states, depth 18, 2 workers, < 2 s — PASS
```

## Counterexamples

See `counterexamples/README.md`. Each config enables exactly one legacy
flag and checks exactly one target invariant. The runner verifies the
named violation is produced.

## State-space discipline

Both configs use exhaustive BFS (not simulation). Both are well under
the 500,000 distinct state budget and complete in under 60 seconds on
ordinary hardware.

## Relationship to RecoveryProtocol

RecoveryProtocol (`formal/tla/recovery/`) models the candidate recovery
flow. Its timeGrant properties remain locally vacuous in that model.
This independent operator-grant model is responsible for the
command/idempotency/cross-tab semantics of the time-grant operation.
