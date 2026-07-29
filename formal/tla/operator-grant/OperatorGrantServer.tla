----------------------------- MODULE OperatorGrantServer -----------------------------
(*
  REC-I4-F1 — Formal safety model of the operator time-grant server protocol.

  Scope:
    Models the PostgreSQL transaction-level idempotency and concurrency
    semantics of the operator time-grant command (ADR-013 §5/§9). Two
    independent transactions race on the same operationId targeting
    different Attempts/Exams. The unique constraint (organizationId,
    operationId) is the sole winner authority.

  Authority:
    docs/adr/ADR-013-interruption-time-compensation-policy.md is binding.

  Non-goals:
    Does NOT model HTTP, RBAC, React, browser storage, or network
    transport. Client-side command coordination is modeled separately
    in OperatorGrantClient.tla.

  Finite domains:
    Attempts = {A1, A2}, Exams = {E1, E2}, Txs = {T1, T2},
    Operations = {Op1}, Payloads = {P1, P2}.
    A1 belongs to E1; A2 belongs to E2. Row locks do not intersect;
    only the unique (org, operationId) constraint decides the winner.

  Legacy-defect switches (CONSTANTS):
    Each switch changes ACTION behavior only — NEVER appears in a property.
    Each counterexample config enables exactly one switch.
*)
EXTENDS Naturals, FiniteSets, TLC

\* =============================================================================
\* Constants
\* =============================================================================

CONSTANTS
  Attempts,
  Exams,
  Txs,
  Operations,
  Payloads,
  \* Legacy-defect switches — affect ACTIONS only, NEVER properties.
  LegacyDuplicateEffect,
  LegacyPartialCommit,
  LegacyWrongConflictOutcome,
  LegacyTerminalGrant

\* =============================================================================
\* Variables
\* =============================================================================

VARIABLES
  attemptStatus,         \* [a \in Attempts -> {"active", "terminal"}]
  attemptDeadlineEffect, \* [a \in Attempts -> 0..1]
  ledgerAttempt,         \* [op \in Operations -> Attempts \cup {"none"}]
  ledgerPayload,         \* [op \in Operations -> Payloads \cup {"none"}]
  txPhase,               \* [t \in Txs -> phase]
  txAttempt,             \* [t \in Txs -> Attempts] fixed assignment
  txPayload,             \* [t \in Txs -> Payloads] command payload
  txOutcome,             \* [t \in Txs -> outcome \cup {"none"}]
  responseSent           \* [t \in Txs -> BOOL]

vars == <<attemptStatus, attemptDeadlineEffect, ledgerAttempt, ledgerPayload,
          txPhase, txAttempt, txPayload, txOutcome, responseSent>>

\* =============================================================================
\* Derived definitions
\* =============================================================================

Phases == {"idle", "begun", "ready_to_commit",
           "committed", "unique_violation", "recovering", "responded"}

Outcomes == {"granted", "idempotent_replay", "idempotency_conflict", "terminal"}

IsTerminalStatus(s) == s = "terminal"

LedgerAbsent(op) == ledgerAttempt[op] = "none"
LedgerPresent(op) == ledgerAttempt[op] # "none"

\* =============================================================================
\* Type invariant
\* =============================================================================

ServerTypeOK ==
  /\ attemptStatus \in [Attempts -> {"active", "terminal"}]
  /\ attemptDeadlineEffect \in [Attempts -> 0..1]
  /\ ledgerAttempt \in [Operations -> Attempts \cup {"none"}]
  /\ ledgerPayload \in [Operations -> Payloads \cup {"none"}]
  /\ txPhase \in [Txs -> Phases]
  /\ txAttempt \in [Txs -> Attempts]
  /\ txPayload \in [Txs -> Payloads]
  /\ txOutcome \in [Txs -> Outcomes \cup {"none"}]
  /\ responseSent \in [Txs -> BOOLEAN]

\* =============================================================================
\* Initial state
\* =============================================================================

Init ==
  /\ attemptStatus \in [Attempts -> {"active", "terminal"}]
  /\ attemptDeadlineEffect = [a \in Attempts |-> 0]
  /\ ledgerAttempt = [op \in Operations |-> "none"]
  /\ ledgerPayload = [op \in Operations |-> "none"]
  /\ txPhase = [t \in Txs |-> "idle"]
  /\ txAttempt \in [Txs -> Attempts]
  /\ \E t1, t2 \in Txs: t1 # t2 /\ txAttempt[t1] # txAttempt[t2]
  /\ txPayload \in [Txs -> Payloads]
  /\ txOutcome = [t \in Txs |-> "none"]
  /\ responseSent = [t \in Txs |-> FALSE]

\* =============================================================================
\* Target actions
\* =============================================================================

BeginCommand(t) ==
  /\ txPhase[t] = "idle"
  /\ txPhase' = [txPhase EXCEPT ![t] = "begun"]
  /\ UNCHANGED <<attemptStatus, attemptDeadlineEffect, ledgerAttempt,
                  ledgerPayload, txAttempt, txPayload, txOutcome, responseSent>>

ReadOperationAbsent(t) ==
  /\ txPhase[t] = "begun"
  /\ \A op \in Operations: LedgerAbsent(op)
  /\ txPhase' = [txPhase EXCEPT ![t] = "ready_to_commit"]
  /\ UNCHANGED <<attemptStatus, attemptDeadlineEffect, ledgerAttempt,
                  ledgerPayload, txAttempt, txPayload, txOutcome, responseSent>>

\* Atomic commit: ledger insert + deadline effect in one transaction.
\* The unique constraint is modeled by the guard LedgerAbsent(op).
CommitWinner(t) ==
  /\ txPhase[t] = "ready_to_commit"
  /\ \E op \in Operations:
       /\ LedgerAbsent(op)
       /\ ~IsTerminalStatus(attemptStatus[txAttempt[t]])
       /\ ledgerAttempt' = [ledgerAttempt EXCEPT ![op] = txAttempt[t]]
       /\ ledgerPayload' = [ledgerPayload EXCEPT ![op] = txPayload[t]]
       /\ attemptDeadlineEffect' = [attemptDeadlineEffect EXCEPT
                                      ![txAttempt[t]] = 1]
  /\ txPhase' = [txPhase EXCEPT ![t] = "committed"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "granted"]
  /\ UNCHANGED <<attemptStatus, txAttempt, txPayload, responseSent>>

\* The unique constraint rejects the second committer.
ObserveUniqueViolation(t) ==
  /\ txPhase[t] = "ready_to_commit"
  /\ \E op \in Operations: LedgerPresent(op)
  /\ txPhase' = [txPhase EXCEPT ![t] = "unique_violation"]
  /\ UNCHANGED <<attemptStatus, attemptDeadlineEffect, ledgerAttempt,
                  ledgerPayload, txAttempt, txPayload, txOutcome, responseSent>>

\* Rollback the failed transaction and start a fresh one.
BeginFreshRecovery(t) ==
  /\ txPhase[t] = "unique_violation"
  /\ txPhase' = [txPhase EXCEPT ![t] = "recovering"]
  /\ UNCHANGED <<attemptStatus, attemptDeadlineEffect, ledgerAttempt,
                  ledgerPayload, txAttempt, txPayload, txOutcome, responseSent>>

\* In the fresh transaction, read the committed winner and determine outcome.
ReadCommittedWinner(t) ==
  /\ txPhase[t] = "recovering"
  /\ \E op \in Operations:
       /\ LedgerPresent(op)
       /\ IF ledgerAttempt[op] = txAttempt[t] /\ ledgerPayload[op] = txPayload[t]
          THEN txOutcome' = [txOutcome EXCEPT ![t] = "idempotent_replay"]
          ELSE txOutcome' = [txOutcome EXCEPT ![t] = "idempotency_conflict"]
  /\ txPhase' = [txPhase EXCEPT ![t] = "responded"]
  /\ UNCHANGED <<attemptStatus, attemptDeadlineEffect, ledgerAttempt,
                  ledgerPayload, txAttempt, txPayload, responseSent>>

\* Terminal attempt: no grant, no ledger, no deadline effect.
ReturnTerminal(t) ==
  /\ txPhase[t] \in {"begun", "ready_to_commit"}
  /\ IsTerminalStatus(attemptStatus[txAttempt[t]])
  /\ txPhase' = [txPhase EXCEPT ![t] = "responded"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "terminal"]
  /\ UNCHANGED <<attemptStatus, attemptDeadlineEffect, ledgerAttempt,
                  ledgerPayload, txAttempt, txPayload, responseSent>>

\* Response delivery (successful path).
ReturnGranted(t) ==
  /\ txPhase[t] = "committed"
  /\ txOutcome[t] = "granted"
  /\ responseSent' = [responseSent EXCEPT ![t] = TRUE]
  /\ txPhase' = [txPhase EXCEPT ![t] = "responded"]
  /\ UNCHANGED <<attemptStatus, attemptDeadlineEffect, ledgerAttempt,
                  ledgerPayload, txAttempt, txPayload, txOutcome>>

\* Response loss: committed result exists but client never receives it.
LoseResponse(t) ==
  /\ txPhase[t] = "committed"
  /\ txOutcome[t] = "granted"
  /\ responseSent' = [responseSent EXCEPT ![t] = FALSE]
  /\ txPhase' = [txPhase EXCEPT ![t] = "responded"]
  /\ UNCHANGED <<attemptStatus, attemptDeadlineEffect, ledgerAttempt,
                  ledgerPayload, txAttempt, txPayload, txOutcome>>

\* Retry after response loss: same operationId, same attempt, same payload.
RetrySameCommand(t) ==
  /\ txPhase[t] = "responded"
  /\ txOutcome[t] = "granted"
  /\ responseSent[t] = FALSE
  /\ \E op \in Operations:
       /\ LedgerPresent(op)
       /\ ledgerAttempt[op] = txAttempt[t]
       /\ ledgerPayload[op] = txPayload[t]
  /\ txPhase' = [txPhase EXCEPT ![t] = "responded"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "idempotent_replay"]
  /\ responseSent' = [responseSent EXCEPT ![t] = TRUE]
  /\ UNCHANGED <<attemptStatus, attemptDeadlineEffect, ledgerAttempt,
                  ledgerPayload, txAttempt, txPayload>>

\* =============================================================================
\* Legacy actions (enabled by flags; violate target properties)
\* =============================================================================

\* Bug: bypass unique constraint, apply a second deadline effect.
LegacyDuplicateEffectAction(t) ==
  /\ LegacyDuplicateEffect
  /\ txPhase[t] = "ready_to_commit"
  /\ \E op \in Operations:
       /\ LedgerPresent(op)
       /\ ~IsTerminalStatus(attemptStatus[txAttempt[t]])
       /\ attemptDeadlineEffect' = [attemptDeadlineEffect EXCEPT
                                      ![txAttempt[t]] = 1]
  /\ txPhase' = [txPhase EXCEPT ![t] = "committed"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "granted"]
  /\ UNCHANGED <<attemptStatus, ledgerAttempt, ledgerPayload,
                  txAttempt, txPayload, responseSent>>

\* Bug: commit ledger without deadline effect (partial commit).
LegacyPartialCommitAction(t) ==
  /\ LegacyPartialCommit
  /\ txPhase[t] = "ready_to_commit"
  /\ \E op \in Operations:
       /\ LedgerAbsent(op)
       /\ ~IsTerminalStatus(attemptStatus[txAttempt[t]])
       /\ ledgerAttempt' = [ledgerAttempt EXCEPT ![op] = txAttempt[t]]
       /\ ledgerPayload' = [ledgerPayload EXCEPT ![op] = txPayload[t]]
  /\ txPhase' = [txPhase EXCEPT ![t] = "committed"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "granted"]
  /\ UNCHANGED <<attemptStatus, attemptDeadlineEffect,
                  txAttempt, txPayload, responseSent>>

\* Bug: different command on same operationId returns replay instead of conflict.
LegacyWrongConflictOutcomeAction(t) ==
  /\ LegacyWrongConflictOutcome
  /\ txPhase[t] = "recovering"
  /\ \E op \in Operations:
       /\ LedgerPresent(op)
       /\ (ledgerAttempt[op] # txAttempt[t] \/ ledgerPayload[op] # txPayload[t])
  /\ txPhase' = [txPhase EXCEPT ![t] = "responded"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "idempotent_replay"]
  /\ UNCHANGED <<attemptStatus, attemptDeadlineEffect, ledgerAttempt,
                  ledgerPayload, txAttempt, txPayload, responseSent>>

\* Bug: grant time to a terminal attempt.
LegacyTerminalGrantAction(t) ==
  /\ LegacyTerminalGrant
  /\ txPhase[t] = "ready_to_commit"
  /\ IsTerminalStatus(attemptStatus[txAttempt[t]])
  /\ \E op \in Operations:
       /\ LedgerAbsent(op)
       /\ ledgerAttempt' = [ledgerAttempt EXCEPT ![op] = txAttempt[t]]
       /\ ledgerPayload' = [ledgerPayload EXCEPT ![op] = txPayload[t]]
       /\ attemptDeadlineEffect' = [attemptDeadlineEffect EXCEPT
                                      ![txAttempt[t]] = 1]
  /\ txPhase' = [txPhase EXCEPT ![t] = "committed"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "granted"]
  /\ UNCHANGED <<attemptStatus, txAttempt, txPayload, responseSent>>

\* =============================================================================
\* Next-state relation
\* =============================================================================

TargetNext ==
  \E t \in Txs:
    \/ BeginCommand(t)
    \/ ReadOperationAbsent(t)
    \/ CommitWinner(t)
    \/ ObserveUniqueViolation(t)
    \/ BeginFreshRecovery(t)
    \/ ReadCommittedWinner(t)
    \/ ReturnTerminal(t)
    \/ ReturnGranted(t)
    \/ LoseResponse(t)
    \/ RetrySameCommand(t)

LegacyNext ==
  \E t \in Txs:
    \/ LegacyDuplicateEffectAction(t)
    \/ LegacyPartialCommitAction(t)
    \/ LegacyWrongConflictOutcomeAction(t)
    \/ LegacyTerminalGrantAction(t)

Next == TargetNext \/ LegacyNext

Spec == Init /\ [][Next]_vars

\* =============================================================================
\* Safety properties (NEVER reference legacy flags)
\* =============================================================================

\* Same organization + operationId: at most one committed adjustment fact.
AtMostOneLedgerPerOperation ==
  Cardinality({op \in Operations: LedgerPresent(op)}) <= 1

\* Same operationId: at most one Attempt receives a deadline effect.
AtMostOneDeadlineEffectPerOperation ==
  Cardinality({a \in Attempts: attemptDeadlineEffect[a] = 1}) <= 1

\* Ledger committed => exactly one target Attempt has a deadline effect.
LedgerAndDeadlineCommitAtomically ==
  \A op \in Operations:
    LedgerPresent(op) =>
      /\ attemptDeadlineEffect[ledgerAttempt[op]] = 1
      /\ \A other \in Attempts \ {ledgerAttempt[op]}:
           attemptDeadlineEffect[other] = 0

\* A conflict loser's Attempt has no deadline effect from this operation.
ConflictLoserDeadlineUnchanged ==
  \A t \in Txs:
    txOutcome[t] = "idempotency_conflict" =>
      \E op \in Operations:
        LedgerPresent(op) /\ ledgerAttempt[op] # txAttempt[t]

\* Same command retry/recovery returns the committed fact, no second effect.
ReplayReturnsCommittedFact ==
  \A t \in Txs:
    txOutcome[t] = "idempotent_replay" =>
      \E op \in Operations:
        /\ LedgerPresent(op)
        /\ ledgerAttempt[op] = txAttempt[t]
        /\ ledgerPayload[op] = txPayload[t]

\* Different command (different attempt or payload) must not get replay/granted.
DifferentCommandReturnsIdempotencyConflict ==
  \A t \in Txs:
    txOutcome[t] \in {"granted", "idempotent_replay"} =>
      \A op \in Operations:
        LedgerPresent(op) =>
          ledgerAttempt[op] = txAttempt[t] /\ ledgerPayload[op] = txPayload[t]

\* Terminal attempt: no grant, no deadline effect.
TerminalAttemptNeverGranted ==
  \A t \in Txs:
    IsTerminalStatus(attemptStatus[txAttempt[t]]) =>
      /\ txOutcome[t] # "granted"
      /\ attemptDeadlineEffect[txAttempt[t]] = 0

\* After response loss + retry: at most one deadline effect total.
RetryDoesNotApplyAgain ==
  \A t \in Txs:
    txOutcome[t] = "idempotent_replay" =>
      attemptDeadlineEffect[txAttempt[t]] <= 1

================================================================================
