# REC-I4-F1 — Operator Grant Formal Model (Implementation Closeout)

Authority: `docs/adr/ADR-013-interruption-time-compensation-policy.md` (binding).
Models: [`formal/tla/operator-grant/`](../../formal/tla/operator-grant/).
Runner: [`scripts/formal/run-operator-grant-tlc.mjs`](../../scripts/formal/run-operator-grant-tlc.mjs).

## Status

`REC-I4-F1 MODEL CHECKED — READY FOR HUMAN REVIEW`

- **Server safety**: PASS (exhaustive BFS, 1224 distinct states, depth 11).
- **Client safety**: PASS (exhaustive BFS, 8039 distinct states, depth 18).
- **Counterexamples**: all 8 expected-negative configs reproduce the NAMED
  violation (legacy flags affect actions only; the buggy action violates
  the TARGET property).

## Purpose

Introduce two independent TLA+ safety models covering the operator
time-grant command protocol frozen by ADR-013 §5/§9:

1. **OperatorGrantServer.tla** — PostgreSQL transaction-level idempotency
   and concurrency (unique constraint as winner authority, atomic
   ledger+deadline commit, conflict/replay/terminal outcomes).
2. **OperatorGrantClient.tla** — Browser-side cross-tab command
   coordination (freeze/publish, shared pending authority, response loss
   recovery, reload restoration, terminal display correctness).

The models are executable consistency checks. They do NOT mechanically
verify that the TypeScript implementation is a refinement.

## Files inspected

```text
docs/adr/ADR-013-interruption-time-compensation-policy.md
packages/exam-engine/src/operatorGrant.ts
apps/web/src/pages/admin/ProctorDashboardPage.tsx
apps/web/src/lib/clientSessionId.ts
formal/tla/recovery/RecoveryProtocol.tla (pattern reference)
scripts/formal/run-recovery-tlc.mjs (runner pattern reference)
formal/AGENTS.md, formal/README.md, formal/tla/TOOLCHAIN.md
```

## Finite bounds

### Server

```text
Attempts = {A1, A2}, Exams = {E1, E2}, Txs = {T1, T2}
Operations = {Op1}, Payloads = {P1, P2}
```

### Client

```text
Tabs = {Tab1, Tab2}, CmdIds = {C1, C2}, Ops = {O1, O2},
Payloads = {P1, P2}
```

## Variables

### Server

```text
attemptStatus, attemptDeadlineEffect, ledgerAttempt, ledgerPayload,
txPhase, txAttempt, txPayload, txOutcome, responseSent
```

### Client

```text
tabPhase, tabDraftCmd, tabFrozenCmd, tabVisibleOutcome,
sharedPendingCmd, tabLocalPendingCmd, serverCommittedCmd, commandCreator
```

## Target actions

### Server

```text
BeginCommand, ReadOperationAbsent, CommitWinner, ObserveUniqueViolation,
BeginFreshRecovery, ReadCommittedWinner, ReturnTerminal, ReturnGranted,
LoseResponse, RetrySameCommand
```

### Client

```text
OpenDraft, EditDraft, FreezeAndPublishCommand, SubmitCommand,
ServerCommit, DeliverResponse, LoseResponse, CloseDialog, Navigate,
ReloadTab, RestoreSharedPendingCommand, RetryFrozenCommand,
ConfirmTerminal, ConfirmRejected, ClearConfirmedCommand
```

## Target safety properties

### Server (9 invariants)

```text
ServerTypeOK, AtMostOneLedgerPerOperation,
AtMostOneDeadlineEffectPerOperation, LedgerAndDeadlineCommitAtomically,
ConflictLoserDeadlineUnchanged, ReplayReturnsCommittedFact,
DifferentCommandReturnsIdempotencyConflict, TerminalAttemptNeverGranted,
RetryDoesNotApplyAgain
```

### Client (7 invariants)

```text
ClientTypeOK, FrozenCommandImmutable,
IndeterminatePreservesCommandIdentity,
AtMostOneUnresolvedCommandPerWorkflow, NoSecondSubmitWhileUnresolved,
ReloadRestoresExactCommand, TerminalNeverReportedAsGranted
```

## Legacy-defect switches

### Server

| Flag | Effect | Expected violation |
| --- | --- | --- |
| LegacyDuplicateEffect | Bypass unique constraint, apply second effect | AtMostOneDeadlineEffectPerOperation |
| LegacyPartialCommit | Commit ledger without deadline effect | LedgerAndDeadlineCommitAtomically |
| LegacyWrongConflictOutcome | Different command returns replay | DifferentCommandReturnsIdempotencyConflict |
| LegacyTerminalGrant | Grant time to terminal attempt | TerminalAttemptNeverGranted |

### Client

| Flag | Effect | Expected violation |
| --- | --- | --- |
| LegacyPerTabPending | Per-tab sessionStorage authority | AtMostOneUnresolvedCommandPerWorkflow |
| LegacyNewIdentityAfterLoss | Reload creates new identity | IndeterminatePreservesCommandIdentity |
| LegacyMutableRetry | Retry mutates command identity | FrozenCommandImmutable |
| LegacyTerminalAsGranted | Display terminal as granted | TerminalNeverReportedAsGranted |

## TLC results (exact)

### Server target safety

```text
generated: 5765
distinct:  1224
depth:     11
workers:   2
runtime:   < 2 s
result:    PASS (no error)
```

### Client target safety

```text
generated: 58567
distinct:  8039
depth:     18
workers:   2
runtime:   < 2 s
result:    PASS (no error)
```

### Counterexamples (all 8)

| Config | Violated invariant | States | Depth |
| --- | --- | --- | --- |
| ServerLegacyDuplicateEffect | AtMostOneDeadlineEffectPerOperation | 770 | — |
| ServerLegacyPartialCommit | LedgerAndDeadlineCommitAtomically | 269 | — |
| ServerLegacyWrongConflictOutcome | DifferentCommandReturnsIdempotencyConflict | 977 | — |
| ServerLegacyTerminalGrant | TerminalAttemptNeverGranted | 229 | — |
| ClientLegacyPerTabPending | AtMostOneUnresolvedCommandPerWorkflow | 72 | — |
| ClientLegacyNewIdentityAfterLoss | IndeterminatePreservesCommandIdentity | 29 | — |
| ClientLegacyMutableRetry | FrozenCommandImmutable | 66 | — |
| ClientLegacyTerminalAsGranted | TerminalNeverReportedAsGranted | 23 | — |

## Toolchain

```text
TLA+ tools: v1.7.4 (pinned in formal/tla/TOOLCHAIN.md)
TLC:        v2.19 (bundled in tla2tools.jar)
Java:       OpenJDK 25.0.3
Runner:     scripts/formal/run-operator-grant-tlc.mjs
JAR:        TLA2TOOLS_JAR env var (not vendored)
```

## Assumptions

1. PostgreSQL unique constraint (organizationId, operationId) is the sole
   winner authority. Row-level locks on different Attempts do not intersect.
2. The server model uses flat string encoding for ledger entries (avoids
   TLC record/string comparison limitation).
3. The client model uses model values (C1, C2) for command identities with
   a fixed CmdOp mapping to operations.
4. One workflow per model run (fixed organizationId + attemptId).
5. Two transactions / two tabs are sufficient to expose all concurrency
   races in the protocol.
6. Response loss is modeled as a non-deterministic action (LoseResponse)
   rather than a timing assumption.

## Runtime/model mismatch

- The model does NOT verify TypeScript refinement.
- HTTP transport, RBAC, React internals, DOM events, and network timing
  are NOT modeled.
- The client model does NOT commit to a specific storage technology
  (IndexedDB, localStorage, Web Locks) — that decision belongs to REC-I4-C1.
- The server model does NOT model connection pooling, isolation levels
  beyond the unique constraint, or concurrent DDL.

## V1/C1 input conditions

This formal model (F1) provides the verified safety contract that:

- **REC-I4-V1** (deterministic PostgreSQL verification) must confirm at
  runtime: the unique constraint decides the winner, ledger+deadline commit
  atomically, conflict returns idempotency_conflict, replay returns
  idempotent_replay, terminal returns terminal.
- **REC-I4-C1** (cross-tab coordination) must implement: shared pending
  authority (not per-tab), frozen command immutability, exact restoration
  on reload, terminal never displayed as granted.
