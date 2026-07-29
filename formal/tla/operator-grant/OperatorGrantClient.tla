----------------------------- MODULE OperatorGrantClient -----------------------------
(*
  REC-I4-F1 — Formal safety model of the operator time-grant client protocol.

  Scope:
    Models one browser-side operator-grant command generation: draft creation,
    atomic freeze/publish, submission, authoritative server outcome, response
    loss, reload/takeover, exact retry, terminal mapping, and cross-tab pending
    coordination. A confirmed outcome terminates this model generation.

  Authority:
    docs/adr/ADR-013-interruption-time-compensation-policy.md is binding.
    The model does NOT commit to IndexedDB, localStorage, Web Locks, or another
    storage technology; that decision belongs to REC-I4-C1.

  Non-goals:
    Does NOT model PostgreSQL, HTTP transport, RBAC, React internals, DOM
    events, or a second command generation after confirmation.

  Finite domains:
    Tabs = {Tab1, Tab2}; CmdIds = {C1, C2, C3, C4};
    Ops = {O1, O2}; Payloads = {P1, P2}.
    CmdOperation/CmdPayload deliberately include:
      C1 and C2: same operation + same payload,
      C1 and C3: same operation + different payload,
      C1 and C4: different operation + same payload.
    The workflow fixes organizationId + attemptId. Payload is the canonical
    finite abstraction of addedSeconds + reasonCode + reasonText.

  Legacy-defect switches (CONSTANTS):
    Each switch changes ACTION behavior only — NEVER appears in a property.
*)
EXTENDS Naturals, FiniteSets, TLC

\* =============================================================================
\* Constants
\* =============================================================================

CONSTANTS
  Tabs,
  CmdIds,
  Ops,
  Payloads,
  C1, C2, C3, C4,
  O1, O2,
  P1, P2,
  \* Legacy-defect switches — affect ACTIONS only, NEVER properties.
  LegacyPerTabPending,
  LegacyNewIdentityAfterLoss,
  LegacyMutableRetry,
  LegacyTerminalAsGranted

\* =============================================================================
\* Variables
\* =============================================================================

VARIABLES
  tabPhase,              \* [t \in Tabs -> TabPhases]
  tabDraftCmd,           \* [t \in Tabs -> CmdIds \cup {"none"}]
  tabFrozenCmd,          \* [t \in Tabs -> CmdIds \cup {"none"}]
  tabVisibleOutcome,     \* [t \in Tabs -> Outcomes \cup {"none"}]
  tabRestoredFromShared, \* [t \in Tabs -> BOOLEAN]
  sharedPendingCmd,      \* CmdIds \cup {"none"} — target shared authority
  tabLocalPendingCmd,    \* [t \in Tabs -> CmdIds \cup {"none"}] — legacy
  serverCommittedCmd,    \* CmdIds \cup {"none"} — committed command authority
  serverOutcome,         \* [t \in Tabs -> Outcomes \cup {"none"}]
  commandCreator,        \* Tabs \cup {"none"} — stable for this generation
  workflowComplete       \* BOOLEAN — confirmed generation is terminal

vars == <<tabPhase, tabDraftCmd, tabFrozenCmd, tabVisibleOutcome,
          tabRestoredFromShared, sharedPendingCmd, tabLocalPendingCmd,
          serverCommittedCmd, serverOutcome, commandCreator, workflowComplete>>

\* =============================================================================
\* Derived definitions
\* =============================================================================

TabPhases == {"idle", "draft", "submitting", "indeterminate", "confirmed"}

Outcomes == {"granted", "idempotent_replay", "terminal", "rejected",
             "idempotency_conflict"}

CmdOperation(c) ==
  IF c \in {C1, C2, C3} THEN O1 ELSE O2

CmdPayload(c) ==
  IF c \in {C1, C2, C4} THEN P1 ELSE P2

CommandFact(c) == <<CmdOperation(c), CmdPayload(c)>>

SameCommand(left, right) ==
  /\ CmdOperation(left) = CmdOperation(right)
  /\ CmdPayload(left) = CmdPayload(right)

StoredPendingCommands ==
  {c \in CmdIds:
     \/ sharedPendingCmd = c
     \/ \E t \in Tabs: tabLocalPendingCmd[t] = c}

StoredPendingFacts ==
  {CommandFact(c): c \in StoredPendingCommands}

\* =============================================================================
\* Type invariant
\* =============================================================================

ClientTypeOK ==
  /\ tabPhase \in [Tabs -> TabPhases]
  /\ tabDraftCmd \in [Tabs -> CmdIds \cup {"none"}]
  /\ tabFrozenCmd \in [Tabs -> CmdIds \cup {"none"}]
  /\ tabVisibleOutcome \in [Tabs -> Outcomes \cup {"none"}]
  /\ tabRestoredFromShared \in [Tabs -> BOOLEAN]
  /\ sharedPendingCmd \in CmdIds \cup {"none"}
  /\ tabLocalPendingCmd \in [Tabs -> CmdIds \cup {"none"}]
  /\ serverCommittedCmd \in CmdIds \cup {"none"}
  /\ serverOutcome \in [Tabs -> Outcomes \cup {"none"}]
  /\ commandCreator \in Tabs \cup {"none"}
  /\ workflowComplete \in BOOLEAN

\* =============================================================================
\* Initial state
\* =============================================================================

Init ==
  /\ Cardinality(Tabs) = 2
  /\ CmdIds = {C1, C2, C3, C4}
  /\ Ops = {O1, O2}
  /\ Payloads = {P1, P2}
  /\ tabPhase = [t \in Tabs |-> "idle"]
  /\ tabDraftCmd = [t \in Tabs |-> "none"]
  /\ tabFrozenCmd = [t \in Tabs |-> "none"]
  /\ tabVisibleOutcome = [t \in Tabs |-> "none"]
  /\ tabRestoredFromShared = [t \in Tabs |-> FALSE]
  /\ sharedPendingCmd = "none"
  /\ tabLocalPendingCmd = [t \in Tabs |-> "none"]
  /\ serverCommittedCmd = "none"
  /\ serverOutcome = [t \in Tabs |-> "none"]
  /\ commandCreator = "none"
  /\ workflowComplete = FALSE

\* =============================================================================
\* Target actions
\* =============================================================================

OpenDraft(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] = "idle"
  /\ IF LegacyPerTabPending
     THEN tabLocalPendingCmd[t] = "none"
     ELSE /\ sharedPendingCmd = "none"
          /\ \A other \in Tabs: tabLocalPendingCmd[other] = "none"
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "draft"]
  /\ \E c \in CmdIds:
       tabDraftCmd' = [tabDraftCmd EXCEPT ![t] = c]
  /\ tabRestoredFromShared' =
       [tabRestoredFromShared EXCEPT ![t] = FALSE]
  /\ UNCHANGED <<tabFrozenCmd, tabVisibleOutcome, sharedPendingCmd,
                  tabLocalPendingCmd, serverCommittedCmd, serverOutcome,
                  commandCreator, workflowComplete>>

EditDraft(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] = "draft"
  /\ tabDraftCmd[t] # "none"
  /\ \E c \in CmdIds:
       /\ c # tabDraftCmd[t]
       /\ tabDraftCmd' = [tabDraftCmd EXCEPT ![t] = c]
  /\ UNCHANGED <<tabPhase, tabFrozenCmd, tabVisibleOutcome,
                  tabRestoredFromShared, sharedPendingCmd, tabLocalPendingCmd,
                  serverCommittedCmd, serverOutcome, commandCreator,
                  workflowComplete>>

\* Freeze the full operationId+payload command and publish it atomically.
FreezeAndPublishCommand(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] = "draft"
  /\ tabDraftCmd[t] # "none"
  /\ IF LegacyPerTabPending
     THEN /\ tabLocalPendingCmd[t] = "none"
          /\ tabLocalPendingCmd' =
               [tabLocalPendingCmd EXCEPT ![t] = tabDraftCmd[t]]
          /\ UNCHANGED sharedPendingCmd
     ELSE /\ sharedPendingCmd = "none"
          /\ sharedPendingCmd' = tabDraftCmd[t]
          /\ UNCHANGED tabLocalPendingCmd
  /\ tabFrozenCmd' = [tabFrozenCmd EXCEPT ![t] = tabDraftCmd[t]]
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "submitting"]
  /\ tabRestoredFromShared' =
       [tabRestoredFromShared EXCEPT ![t] = FALSE]
  /\ commandCreator' =
       IF commandCreator = "none" THEN t ELSE commandCreator
  /\ UNCHANGED <<tabDraftCmd, tabVisibleOutcome, serverCommittedCmd,
                  serverOutcome, workflowComplete>>

\* A tab with a stale draft adopts the already-published shared command.
AdoptSharedOverDraft(t) ==
  /\ ~workflowComplete
  /\ ~LegacyPerTabPending
  /\ tabPhase[t] = "draft"
  /\ sharedPendingCmd # "none"
  /\ tabFrozenCmd' = [tabFrozenCmd EXCEPT ![t] = sharedPendingCmd]
  /\ tabDraftCmd' = [tabDraftCmd EXCEPT ![t] = "none"]
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "indeterminate"]
  /\ tabRestoredFromShared' =
       [tabRestoredFromShared EXCEPT ![t] = TRUE]
  /\ UNCHANGED <<tabVisibleOutcome, sharedPendingCmd, tabLocalPendingCmd,
                  serverCommittedCmd, serverOutcome, commandCreator,
                  workflowComplete>>

\* ServerCommit represents the POST; there is no empty SubmitCommand action.
ServerCommit(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] = "submitting"
  /\ tabFrozenCmd[t] # "none"
  /\ serverCommittedCmd = "none"
  /\ serverCommittedCmd' = tabFrozenCmd[t]
  /\ serverOutcome' = [serverOutcome EXCEPT ![t] = "granted"]
  /\ UNCHANGED <<tabPhase, tabDraftCmd, tabFrozenCmd, tabVisibleOutcome,
                  tabRestoredFromShared, sharedPendingCmd, tabLocalPendingCmd,
                  commandCreator, workflowComplete>>

\* A retry of the already-committed exact command returns replay.
ServerReplay(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] = "submitting"
  /\ tabFrozenCmd[t] # "none"
  /\ serverCommittedCmd # "none"
  /\ SameCommand(serverCommittedCmd, tabFrozenCmd[t])
  /\ serverOutcome[t] # "idempotent_replay"
  /\ serverOutcome' =
       [serverOutcome EXCEPT ![t] = "idempotent_replay"]
  /\ UNCHANGED <<tabPhase, tabDraftCmd, tabFrozenCmd, tabVisibleOutcome,
                  tabRestoredFromShared, sharedPendingCmd, tabLocalPendingCmd,
                  serverCommittedCmd, commandCreator, workflowComplete>>

DeliverSuccessResponse(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] = "submitting"
  /\ tabFrozenCmd[t] # "none"
  /\ serverOutcome[t] \in {"granted", "idempotent_replay"}
  /\ serverCommittedCmd # "none"
  /\ SameCommand(serverCommittedCmd, tabFrozenCmd[t])
  /\ (sharedPendingCmd = "none"
      \/ SameCommand(sharedPendingCmd, tabFrozenCmd[t]))
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "confirmed"]
  /\ tabVisibleOutcome' =
       [tabVisibleOutcome EXCEPT ![t] = serverOutcome[t]]
  /\ sharedPendingCmd' = "none"
  /\ tabLocalPendingCmd' = [other \in Tabs |-> "none"]
  /\ workflowComplete' = TRUE
  /\ UNCHANGED <<tabDraftCmd, tabFrozenCmd, tabRestoredFromShared,
                  serverCommittedCmd, serverOutcome, commandCreator>>

LoseResponse(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] = "submitting"
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "indeterminate"]
  /\ UNCHANGED <<tabDraftCmd, tabFrozenCmd, tabVisibleOutcome,
                  tabRestoredFromShared, sharedPendingCmd, tabLocalPendingCmd,
                  serverCommittedCmd, serverOutcome, commandCreator,
                  workflowComplete>>

CloseIndeterminateDialog(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] = "indeterminate"
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "idle"]
  /\ tabVisibleOutcome' = [tabVisibleOutcome EXCEPT ![t] = "none"]
  /\ UNCHANGED <<tabDraftCmd, tabFrozenCmd, tabRestoredFromShared,
                  sharedPendingCmd, tabLocalPendingCmd, serverCommittedCmd,
                  serverOutcome, commandCreator, workflowComplete>>

NavigateAway(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] = "indeterminate"
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "idle"]
  /\ tabDraftCmd' = [tabDraftCmd EXCEPT ![t] = "none"]
  /\ tabVisibleOutcome' = [tabVisibleOutcome EXCEPT ![t] = "none"]
  /\ UNCHANGED <<tabFrozenCmd, tabRestoredFromShared, sharedPendingCmd,
                  tabLocalPendingCmd, serverCommittedCmd, serverOutcome,
                  commandCreator, workflowComplete>>

ReloadTab(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] \in {"idle", "indeterminate"}
  /\ sharedPendingCmd # "none"
  /\ IF LegacyNewIdentityAfterLoss
     THEN \E c \in CmdIds:
            /\ ~SameCommand(c, sharedPendingCmd)
            /\ tabFrozenCmd' = [tabFrozenCmd EXCEPT ![t] = c]
     ELSE /\ (~tabRestoredFromShared[t]
               \/ ~SameCommand(tabFrozenCmd[t], sharedPendingCmd))
          /\ tabFrozenCmd' =
               [tabFrozenCmd EXCEPT ![t] = sharedPendingCmd]
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "indeterminate"]
  /\ tabDraftCmd' = [tabDraftCmd EXCEPT ![t] = "none"]
  /\ tabVisibleOutcome' = [tabVisibleOutcome EXCEPT ![t] = "none"]
  /\ tabRestoredFromShared' =
       [tabRestoredFromShared EXCEPT ![t] = TRUE]
  /\ UNCHANGED <<sharedPendingCmd, tabLocalPendingCmd, serverCommittedCmd,
                  serverOutcome, commandCreator, workflowComplete>>

RestoreSharedPendingCommand(t) ==
  /\ ~workflowComplete
  /\ ~LegacyPerTabPending
  /\ tabPhase[t] = "idle"
  /\ sharedPendingCmd # "none"
  /\ tabFrozenCmd' = [tabFrozenCmd EXCEPT ![t] = sharedPendingCmd]
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "indeterminate"]
  /\ tabRestoredFromShared' =
       [tabRestoredFromShared EXCEPT ![t] = TRUE]
  /\ UNCHANGED <<tabDraftCmd, tabVisibleOutcome, sharedPendingCmd,
                  tabLocalPendingCmd, serverCommittedCmd, serverOutcome,
                  commandCreator, workflowComplete>>

RetryFrozenCommand(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] = "indeterminate"
  /\ tabFrozenCmd[t] # "none"
  /\ IF LegacyMutableRetry
     THEN \E c \in CmdIds:
            /\ CmdOperation(c) = CmdOperation(tabFrozenCmd[t])
            /\ CmdPayload(c) # CmdPayload(tabFrozenCmd[t])
            /\ tabFrozenCmd' = [tabFrozenCmd EXCEPT ![t] = c]
     ELSE UNCHANGED tabFrozenCmd
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "submitting"]
  /\ serverOutcome' = [serverOutcome EXCEPT ![t] = "none"]
  /\ UNCHANGED <<tabDraftCmd, tabVisibleOutcome, tabRestoredFromShared,
                  sharedPendingCmd, tabLocalPendingCmd, serverCommittedCmd,
                  commandCreator, workflowComplete>>

ConfirmTerminal(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] \in {"submitting", "indeterminate"}
  /\ tabFrozenCmd[t] # "none"
  /\ (sharedPendingCmd = "none"
      \/ SameCommand(sharedPendingCmd, tabFrozenCmd[t]))
  /\ serverOutcome' = [serverOutcome EXCEPT ![t] = "terminal"]
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "confirmed"]
  /\ IF LegacyTerminalAsGranted
     THEN tabVisibleOutcome' =
            [tabVisibleOutcome EXCEPT ![t] = "granted"]
     ELSE tabVisibleOutcome' =
            [tabVisibleOutcome EXCEPT ![t] = "terminal"]
  /\ sharedPendingCmd' = "none"
  /\ tabLocalPendingCmd' = [other \in Tabs |-> "none"]
  /\ workflowComplete' = TRUE
  /\ UNCHANGED <<tabDraftCmd, tabFrozenCmd, tabRestoredFromShared,
                  serverCommittedCmd, commandCreator>>

ConfirmRejected(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] \in {"submitting", "indeterminate"}
  /\ tabFrozenCmd[t] # "none"
  /\ serverOutcome' = [serverOutcome EXCEPT ![t] = "rejected"]
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "confirmed"]
  /\ tabVisibleOutcome' = [tabVisibleOutcome EXCEPT ![t] = "rejected"]
  /\ sharedPendingCmd' = "none"
  /\ tabLocalPendingCmd' = [other \in Tabs |-> "none"]
  /\ workflowComplete' = TRUE
  /\ UNCHANGED <<tabDraftCmd, tabFrozenCmd, tabRestoredFromShared,
                  serverCommittedCmd, commandCreator>>

ConfirmConflict(t) ==
  /\ ~workflowComplete
  /\ tabPhase[t] \in {"submitting", "indeterminate"}
  /\ tabFrozenCmd[t] # "none"
  /\ serverOutcome' =
       [serverOutcome EXCEPT ![t] = "idempotency_conflict"]
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "confirmed"]
  /\ tabVisibleOutcome' =
       [tabVisibleOutcome EXCEPT ![t] = "idempotency_conflict"]
  /\ sharedPendingCmd' = "none"
  /\ tabLocalPendingCmd' = [other \in Tabs |-> "none"]
  /\ workflowComplete' = TRUE
  /\ UNCHANGED <<tabDraftCmd, tabFrozenCmd, tabRestoredFromShared,
                  serverCommittedCmd, commandCreator>>

\* Intentional stutter only after this one command generation is confirmed.
CompletedWorkflowStutter ==
  /\ workflowComplete
  /\ UNCHANGED vars

\* =============================================================================
\* Next-state relation
\* =============================================================================

Next ==
  \/ \E t \in Tabs:
       \/ OpenDraft(t)
       \/ EditDraft(t)
       \/ FreezeAndPublishCommand(t)
       \/ AdoptSharedOverDraft(t)
       \/ ServerCommit(t)
       \/ ServerReplay(t)
       \/ DeliverSuccessResponse(t)
       \/ LoseResponse(t)
       \/ CloseIndeterminateDialog(t)
       \/ NavigateAway(t)
       \/ ReloadTab(t)
       \/ RestoreSharedPendingCommand(t)
       \/ RetryFrozenCommand(t)
       \/ ConfirmTerminal(t)
       \/ ConfirmRejected(t)
       \/ ConfirmConflict(t)
  \/ CompletedWorkflowStutter

Spec == Init /\ [][Next]_vars

\* =============================================================================
\* Safety properties (NEVER reference legacy flags)
\* =============================================================================

\* Frozen operationId and full payload match the shared authority.
FrozenCommandImmutable ==
  \A t \in Tabs:
    (tabPhase[t] \in {"submitting", "indeterminate"}
     /\ tabFrozenCmd[t] # "none"
     /\ sharedPendingCmd # "none") =>
      SameCommand(tabFrozenCmd[t], sharedPendingCmd)

\* Response loss preserves operationId and payload while indeterminate.
IndeterminatePreservesCommandIdentity ==
  \A t \in Tabs:
    (tabPhase[t] = "indeterminate"
     /\ tabFrozenCmd[t] # "none"
     /\ sharedPendingCmd # "none") =>
      SameCommand(tabFrozenCmd[t], sharedPendingCmd)

\* Shared/local storage contains at most one semantic pending command.
AtMostOneUnresolvedCommandPerWorkflow ==
  Cardinality(StoredPendingFacts) <= 1

\* Distinct unresolved tabs never submit different operationId/payload facts.
NoSecondSubmitWhileUnresolved ==
  \A t1, t2 \in Tabs:
    (t1 # t2
     /\ tabPhase[t1] \in {"submitting", "indeterminate"}
     /\ tabPhase[t2] \in {"submitting", "indeterminate"}
     /\ tabFrozenCmd[t1] # "none"
     /\ tabFrozenCmd[t2] # "none") =>
      SameCommand(tabFrozenCmd[t1], tabFrozenCmd[t2])

\* A reload/focus takeover restores the exact operationId and payload.
ReloadRestoresExactCommand ==
  \A t \in Tabs:
    (tabRestoredFromShared[t]
     /\ tabFrozenCmd[t] # "none"
     /\ sharedPendingCmd # "none") =>
      SameCommand(tabFrozenCmd[t], sharedPendingCmd)

\* Confirmation terminates this generation and clears all pending authority.
ConfirmedOutcomeClearsPending ==
  workflowComplete =>
    /\ sharedPendingCmd = "none"
    /\ \A t \in Tabs: tabLocalPendingCmd[t] = "none"

\* Authoritative terminal can never be projected as granted.
TerminalNeverReportedAsGranted ==
  \A t \in Tabs:
    serverOutcome[t] = "terminal" =>
      tabVisibleOutcome[t] # "granted"

\* A granted projection must match this tab's committed frozen command.
VisibleGrantedMatchesServerCommit ==
  \A t \in Tabs:
    tabVisibleOutcome[t] = "granted" =>
      /\ serverOutcome[t] = "granted"
      /\ serverCommittedCmd # "none"
      /\ tabFrozenCmd[t] # "none"
      /\ SameCommand(serverCommittedCmd, tabFrozenCmd[t])

================================================================================
