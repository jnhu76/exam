----------------------------- MODULE OperatorGrantServer -----------------------------
(*
  REC-I4-F1 — Formal safety model of the operator time-grant server protocol.

  Scope:
    Models PostgreSQL transaction-level idempotency and concurrency for the
    operator time-grant command (ADR-013 §5/§9). Two transactions race on one
    operationId. Their Attempts and payloads are chosen independently, so TLC
    explores same-Attempt replay, same-Attempt payload conflict, and
    cross-Attempt conflict.

  Authority:
    docs/adr/ADR-013-interruption-time-compensation-policy.md is binding.

  Non-goals:
    Does NOT model HTTP, RBAC, React, browser storage, network transport,
    Exam-row locking, or more than one operationId per run. The singleton
    operation domain isolates the uniqueness race under review.

  Finite domains:
    Attempts = {A1, A2}, Txs = {T1, T2},
    Operations = {Op1}, Payloads = {P1, P2}.

  Ledger representation:
    ledgerFacts is a set of committed transaction facts. A fact t stores
    txOperation[t], txAttempt[t], and txPayload[t]. Unlike a per-operation
    function slot, this representation can express two rows with the same
    operationId. deadlineApplyCount can reach 2, so duplicate application to
    the same Attempt is representable and checkable.

  Legacy-defect switches (CONSTANTS):
    Each switch changes ACTION behavior only — NEVER appears in a property.
*)
EXTENDS Naturals, FiniteSets, TLC

\* =============================================================================
\* Constants
\* =============================================================================

CONSTANTS
  Attempts,
  Txs,
  Operations,
  Payloads,
  \* Legacy-defect switches — affect ACTIONS only, NEVER properties.
  LegacyDuplicateEffect,
  LegacyLedgerOnlyCommit,
  LegacyDeadlineOnlyCommit,
  LegacyWrongConflictOutcome,
  LegacyTerminalGrant,
  LegacyRetryDuplicateApply

\* =============================================================================
\* Variables
\* =============================================================================

VARIABLES
  attemptStatus,      \* [a \in Attempts -> {"active", "terminal"}]
  deadlineApplyCount, \* [a \in Attempts -> 0..2]
  ledgerFacts,        \* SUBSET Txs; each member is one committed ledger row
  txPhase,            \* [t \in Txs -> Phases]
  txOperation,        \* [t \in Txs -> Operations] fixed command operationId
  txAttempt,          \* [t \in Txs -> Attempts] fixed command Attempt
  txPayload,          \* [t \in Txs -> Payloads] fixed command payload
  txOutcome,          \* [t \in Txs -> Outcomes \cup {"none"}]
  responseSent        \* [t \in Txs -> BOOLEAN]

vars == <<attemptStatus, deadlineApplyCount, ledgerFacts, txPhase,
          txOperation, txAttempt, txPayload, txOutcome, responseSent>>

\* =============================================================================
\* Derived definitions
\* =============================================================================

Phases == {"idle", "begun", "ready_to_commit",
           "committed", "unique_violation", "recovering", "responded"}

Outcomes == {"granted", "idempotent_replay", "idempotency_conflict", "terminal"}

IsTerminalStatus(s) == s = "terminal"

LedgerFactsFor(op) == {t \in ledgerFacts: txOperation[t] = op}
LedgerPresent(op) == LedgerFactsFor(op) # {}
LedgerAbsent(op) == ~LedgerPresent(op)

DeadlineApplyFacts ==
  {pair \in (Attempts \X (1..2)):
     pair[2] <= deadlineApplyCount[pair[1]]}

DeadlineApplyTotal == Cardinality(DeadlineApplyFacts)

SameCommand(left, right) ==
  /\ txOperation[left] = txOperation[right]
  /\ txAttempt[left] = txAttempt[right]
  /\ txPayload[left] = txPayload[right]

\* =============================================================================
\* Type invariant
\* =============================================================================

ServerTypeOK ==
  /\ attemptStatus \in [Attempts -> {"active", "terminal"}]
  /\ deadlineApplyCount \in [Attempts -> 0..2]
  /\ ledgerFacts \subseteq Txs
  /\ txPhase \in [Txs -> Phases]
  /\ txOperation \in [Txs -> Operations]
  /\ txAttempt \in [Txs -> Attempts]
  /\ txPayload \in [Txs -> Payloads]
  /\ txOutcome \in [Txs -> Outcomes \cup {"none"}]
  /\ responseSent \in [Txs -> BOOLEAN]

\* =============================================================================
\* Initial state
\* =============================================================================

Init ==
  /\ Cardinality(Attempts) = 2
  /\ Cardinality(Txs) = 2
  /\ Cardinality(Operations) = 1
  /\ Cardinality(Payloads) = 2
  /\ attemptStatus \in [Attempts -> {"active", "terminal"}]
  /\ deadlineApplyCount = [a \in Attempts |-> 0]
  /\ ledgerFacts = {}
  /\ txPhase = [t \in Txs |-> "idle"]
  /\ txOperation \in [Txs -> Operations]
  /\ txAttempt \in [Txs -> Attempts]
  /\ txPayload \in [Txs -> Payloads]
  /\ txOutcome = [t \in Txs |-> "none"]
  /\ responseSent = [t \in Txs |-> FALSE]

\* =============================================================================
\* Target actions
\* =============================================================================

BeginCommand(t) ==
  /\ txPhase[t] = "idle"
  /\ txPhase' = [txPhase EXCEPT ![t] = "begun"]
  /\ UNCHANGED <<attemptStatus, deadlineApplyCount, ledgerFacts,
                  txOperation, txAttempt, txPayload, txOutcome, responseSent>>

ReadOperationAbsent(t) ==
  /\ txPhase[t] = "begun"
  /\ LedgerAbsent(txOperation[t])
  /\ txPhase' = [txPhase EXCEPT ![t] = "ready_to_commit"]
  /\ UNCHANGED <<attemptStatus, deadlineApplyCount, ledgerFacts,
                  txOperation, txAttempt, txPayload, txOutcome, responseSent>>

\* A command that starts after the winner committed reads that fact directly.
ReadExistingOperation(t) ==
  /\ txPhase[t] = "begun"
  /\ LedgerPresent(txOperation[t])
  /\ txPhase' = [txPhase EXCEPT ![t] = "recovering"]
  /\ UNCHANGED <<attemptStatus, deadlineApplyCount, ledgerFacts,
                  txOperation, txAttempt, txPayload, txOutcome, responseSent>>

\* Atomic commit: ledger insert + one deadline application in one transaction.
CommitWinner(t) ==
  /\ txPhase[t] = "ready_to_commit"
  /\ LedgerAbsent(txOperation[t])
  /\ ~IsTerminalStatus(attemptStatus[txAttempt[t]])
  /\ deadlineApplyCount[txAttempt[t]] < 2
  /\ ledgerFacts' = ledgerFacts \cup {t}
  /\ deadlineApplyCount' =
       [deadlineApplyCount EXCEPT
          ![txAttempt[t]] = @ + 1]
  /\ txPhase' = [txPhase EXCEPT ![t] = "committed"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "granted"]
  /\ UNCHANGED <<attemptStatus, txOperation, txAttempt, txPayload, responseSent>>

\* The unique constraint rejects a second fact for the same operationId.
ObserveUniqueViolation(t) ==
  /\ txPhase[t] = "ready_to_commit"
  /\ LedgerPresent(txOperation[t])
  /\ txPhase' = [txPhase EXCEPT ![t] = "unique_violation"]
  /\ UNCHANGED <<attemptStatus, deadlineApplyCount, ledgerFacts,
                  txOperation, txAttempt, txPayload, txOutcome, responseSent>>

BeginFreshRecovery(t) ==
  /\ txPhase[t] = "unique_violation"
  /\ txPhase' = [txPhase EXCEPT ![t] = "recovering"]
  /\ UNCHANGED <<attemptStatus, deadlineApplyCount, ledgerFacts,
                  txOperation, txAttempt, txPayload, txOutcome, responseSent>>

\* In a fresh transaction, read the committed winner and classify replay/conflict.
ReadCommittedWinner(t) ==
  /\ txPhase[t] = "recovering"
  /\ LedgerPresent(txOperation[t])
  /\ LET winner == CHOOSE w \in LedgerFactsFor(txOperation[t]): TRUE
     IN IF SameCommand(winner, t)
        THEN txOutcome' = [txOutcome EXCEPT ![t] = "idempotent_replay"]
        ELSE txOutcome' = [txOutcome EXCEPT ![t] = "idempotency_conflict"]
  /\ txPhase' = [txPhase EXCEPT ![t] = "responded"]
  /\ UNCHANGED <<attemptStatus, deadlineApplyCount, ledgerFacts,
                  txOperation, txAttempt, txPayload, responseSent>>

ReturnTerminal(t) ==
  /\ txPhase[t] \in {"begun", "ready_to_commit"}
  /\ IsTerminalStatus(attemptStatus[txAttempt[t]])
  /\ txPhase' = [txPhase EXCEPT ![t] = "responded"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "terminal"]
  /\ UNCHANGED <<attemptStatus, deadlineApplyCount, ledgerFacts,
                  txOperation, txAttempt, txPayload, responseSent>>

ReturnGranted(t) ==
  /\ txPhase[t] = "committed"
  /\ txOutcome[t] = "granted"
  /\ responseSent' = [responseSent EXCEPT ![t] = TRUE]
  /\ txPhase' = [txPhase EXCEPT ![t] = "responded"]
  /\ UNCHANGED <<attemptStatus, deadlineApplyCount, ledgerFacts,
                  txOperation, txAttempt, txPayload, txOutcome>>

LoseResponse(t) ==
  /\ txPhase[t] = "committed"
  /\ txOutcome[t] = "granted"
  /\ responseSent' = [responseSent EXCEPT ![t] = FALSE]
  /\ txPhase' = [txPhase EXCEPT ![t] = "responded"]
  /\ UNCHANGED <<attemptStatus, deadlineApplyCount, ledgerFacts,
                  txOperation, txAttempt, txPayload, txOutcome>>

\* Retry after response loss reuses operationId, Attempt, and payload.
RetrySameCommand(t) ==
  /\ txPhase[t] = "responded"
  /\ txOutcome[t] = "granted"
  /\ responseSent[t] = FALSE
  /\ \E winner \in LedgerFactsFor(txOperation[t]):
       SameCommand(winner, t)
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "idempotent_replay"]
  /\ responseSent' = [responseSent EXCEPT ![t] = TRUE]
  /\ UNCHANGED <<attemptStatus, deadlineApplyCount, ledgerFacts, txPhase,
                  txOperation, txAttempt, txPayload>>

\* Intentional stutter only after both transactions have reached terminal responses.
CompletedStutter ==
  /\ \A t \in Txs: txPhase[t] = "responded"
  /\ UNCHANGED vars

\* =============================================================================
\* Legacy actions (enabled by flags; violate target properties)
\* =============================================================================

\* Bug: bypass uniqueness, insert a second ledger row, and apply again.
LegacyDuplicateEffectAction(t) ==
  /\ LegacyDuplicateEffect
  /\ txPhase[t] = "ready_to_commit"
  /\ LedgerPresent(txOperation[t])
  /\ t \notin ledgerFacts
  /\ ~IsTerminalStatus(attemptStatus[txAttempt[t]])
  /\ deadlineApplyCount[txAttempt[t]] < 2
  /\ ledgerFacts' = ledgerFacts \cup {t}
  /\ deadlineApplyCount' =
       [deadlineApplyCount EXCEPT
          ![txAttempt[t]] = @ + 1]
  /\ txPhase' = [txPhase EXCEPT ![t] = "committed"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "granted"]
  /\ UNCHANGED <<attemptStatus, txOperation, txAttempt, txPayload, responseSent>>

\* Bug: ledger row commits without its deadline application.
LegacyLedgerOnlyCommitAction(t) ==
  /\ LegacyLedgerOnlyCommit
  /\ txPhase[t] = "ready_to_commit"
  /\ LedgerAbsent(txOperation[t])
  /\ ~IsTerminalStatus(attemptStatus[txAttempt[t]])
  /\ ledgerFacts' = ledgerFacts \cup {t}
  /\ txPhase' = [txPhase EXCEPT ![t] = "committed"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "granted"]
  /\ UNCHANGED <<attemptStatus, deadlineApplyCount,
                  txOperation, txAttempt, txPayload, responseSent>>

\* Bug: deadline application commits without a ledger row.
LegacyDeadlineOnlyCommitAction(t) ==
  /\ LegacyDeadlineOnlyCommit
  /\ txPhase[t] = "ready_to_commit"
  /\ LedgerAbsent(txOperation[t])
  /\ ~IsTerminalStatus(attemptStatus[txAttempt[t]])
  /\ deadlineApplyCount[txAttempt[t]] < 2
  /\ deadlineApplyCount' =
       [deadlineApplyCount EXCEPT
          ![txAttempt[t]] = @ + 1]
  /\ txPhase' = [txPhase EXCEPT ![t] = "committed"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "granted"]
  /\ UNCHANGED <<attemptStatus, ledgerFacts,
                  txOperation, txAttempt, txPayload, responseSent>>

\* Bug: a different command on the operationId returns replay.
LegacyWrongConflictOutcomeAction(t) ==
  /\ LegacyWrongConflictOutcome
  /\ txPhase[t] = "recovering"
  /\ \E winner \in LedgerFactsFor(txOperation[t]):
       ~SameCommand(winner, t)
  /\ txPhase' = [txPhase EXCEPT ![t] = "responded"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "idempotent_replay"]
  /\ UNCHANGED <<attemptStatus, deadlineApplyCount, ledgerFacts,
                  txOperation, txAttempt, txPayload, responseSent>>

\* Bug: grant time to a terminal Attempt.
LegacyTerminalGrantAction(t) ==
  /\ LegacyTerminalGrant
  /\ txPhase[t] = "ready_to_commit"
  /\ IsTerminalStatus(attemptStatus[txAttempt[t]])
  /\ LedgerAbsent(txOperation[t])
  /\ ledgerFacts' = ledgerFacts \cup {t}
  /\ deadlineApplyCount' =
       [deadlineApplyCount EXCEPT
          ![txAttempt[t]] = @ + 1]
  /\ txPhase' = [txPhase EXCEPT ![t] = "committed"]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "granted"]
  /\ UNCHANGED <<attemptStatus, txOperation, txAttempt, txPayload, responseSent>>

\* Bug: response-loss retry applies the same command a second time.
LegacyRetryDuplicateApplyAction(t) ==
  /\ LegacyRetryDuplicateApply
  /\ txPhase[t] = "responded"
  /\ txOutcome[t] = "granted"
  /\ responseSent[t] = FALSE
  /\ \E winner \in LedgerFactsFor(txOperation[t]):
       SameCommand(winner, t)
  /\ deadlineApplyCount[txAttempt[t]] < 2
  /\ deadlineApplyCount' =
       [deadlineApplyCount EXCEPT
          ![txAttempt[t]] = @ + 1]
  /\ txOutcome' = [txOutcome EXCEPT ![t] = "idempotent_replay"]
  /\ responseSent' = [responseSent EXCEPT ![t] = TRUE]
  /\ UNCHANGED <<attemptStatus, ledgerFacts, txPhase,
                  txOperation, txAttempt, txPayload>>

\* =============================================================================
\* Next-state relation
\* =============================================================================

TargetNext ==
  \/ \E t \in Txs:
       \/ BeginCommand(t)
       \/ ReadOperationAbsent(t)
       \/ ReadExistingOperation(t)
       \/ CommitWinner(t)
       \/ ObserveUniqueViolation(t)
       \/ BeginFreshRecovery(t)
       \/ ReadCommittedWinner(t)
       \/ ReturnTerminal(t)
       \/ ReturnGranted(t)
       \/ LoseResponse(t)
       \/ RetrySameCommand(t)
  \/ CompletedStutter

LegacyNext ==
  \E t \in Txs:
    \/ LegacyDuplicateEffectAction(t)
    \/ LegacyLedgerOnlyCommitAction(t)
    \/ LegacyDeadlineOnlyCommitAction(t)
    \/ LegacyWrongConflictOutcomeAction(t)
    \/ LegacyTerminalGrantAction(t)
    \/ LegacyRetryDuplicateApplyAction(t)

Next == TargetNext \/ LegacyNext

Spec == Init /\ [][Next]_vars

\* =============================================================================
\* Safety properties (NEVER reference legacy flags)
\* =============================================================================

\* Same organization + operationId: at most one committed adjustment row.
AtMostOneLedgerPerOperation ==
  \A op \in Operations:
    Cardinality(LedgerFactsFor(op)) <= 1

\* This model has one operationId; it can cause at most one application total.
AtMostOneDeadlineEffectPerOperation ==
  DeadlineApplyTotal <= 1

\* Every committed ledger row has exactly its one matching deadline application.
LedgerImpliesExactlyOneEffect ==
  \A fact \in ledgerFacts:
    /\ deadlineApplyCount[txAttempt[fact]] = 1
    /\ DeadlineApplyTotal = 1

\* Every deadline application has exactly one matching committed ledger row.
EffectImpliesExactlyOneLedger ==
  DeadlineApplyTotal > 0 =>
    /\ Cardinality(ledgerFacts) = 1
    /\ \E fact \in ledgerFacts:
         deadlineApplyCount[txAttempt[fact]] = 1

\* A conflict outcome is attributable to one winner and applies nothing again.
ConflictLoserDeadlineUnchanged ==
  \A t \in Txs:
    txOutcome[t] = "idempotency_conflict" =>
      \E winner \in LedgerFactsFor(txOperation[t]):
        /\ ~SameCommand(winner, t)
        /\ deadlineApplyCount[txAttempt[winner]] = 1
        /\ DeadlineApplyTotal = 1

\* Same command retry/recovery returns the exact committed fact.
ReplayReturnsCommittedFact ==
  \A t \in Txs:
    txOutcome[t] = "idempotent_replay" =>
      \E winner \in LedgerFactsFor(txOperation[t]):
        SameCommand(winner, t)

\* Only the exact committed command may receive granted/replay.
DifferentCommandReturnsIdempotencyConflict ==
  \A t \in Txs:
    txOutcome[t] \in {"granted", "idempotent_replay"} =>
      \E winner \in LedgerFactsFor(txOperation[t]):
        SameCommand(winner, t)

\* Terminal Attempt: no grant and no deadline application.
TerminalAttemptNeverGranted ==
  \A t \in Txs:
    IsTerminalStatus(attemptStatus[txAttempt[t]]) =>
      /\ txOutcome[t] # "granted"
      /\ deadlineApplyCount[txAttempt[t]] = 0

\* A replay has exactly one application; count=2 remains representable.
RetryDoesNotApplyAgain ==
  \A t \in Txs:
    txOutcome[t] = "idempotent_replay" =>
      /\ deadlineApplyCount[txAttempt[t]] = 1
      /\ DeadlineApplyTotal = 1

\* =============================================================================
\* Reachability witnesses (checked only by dedicated witness configs)
\* =============================================================================

SameAttemptReplayReached ==
  \E t, winner \in Txs:
    /\ t # winner
    /\ winner \in ledgerFacts
    /\ txOutcome[t] = "idempotent_replay"
    /\ responseSent[t] = FALSE
    /\ SameCommand(winner, t)

SameAttemptDifferentPayloadConflictReached ==
  \E t, winner \in Txs:
    /\ t # winner
    /\ winner \in ledgerFacts
    /\ txOutcome[t] = "idempotency_conflict"
    /\ txOperation[t] = txOperation[winner]
    /\ txAttempt[t] = txAttempt[winner]
    /\ txPayload[t] # txPayload[winner]

NoSameAttemptReplayWitness == ~SameAttemptReplayReached

NoSameAttemptDifferentPayloadConflictWitness ==
  ~SameAttemptDifferentPayloadConflictReached

================================================================================
