----------------------------- MODULE OperatorGrantClient -----------------------------
(*
  REC-I4-F1 — Formal safety model of the operator time-grant client protocol.

  Scope:
    Models the browser-side command lifecycle for operator time-grants:
    draft creation, atomic freeze/publish, submission, response handling,
    cross-tab coordination via a shared pending-command authority, response
    loss recovery, and reload restoration.

  Authority:
    docs/adr/ADR-013-interruption-time-compensation-policy.md is binding.
    The model does NOT commit to a specific storage technology (IndexedDB,
    localStorage, Web Locks) — that decision belongs to REC-I4-C1.

  Non-goals:
    Does NOT model PostgreSQL, HTTP transport, server-side idempotency
    (covered by OperatorGrantServer.tla), React internals, or DOM events.

  Finite domains:
    Tabs = {Tab1, Tab2}, CmdIds = {C1, C2}, Ops = {O1, O2},
    Payloads = {P1, P2}. One workflow: fixed organizationId + attemptId.
    Each CmdId maps to a fixed Op and Payload via CmdOp/CmdPayload.

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
  C1, C2,
  \* Legacy-defect switches — affect ACTIONS only, NEVER properties.
  LegacyPerTabPending,
  LegacyNewIdentityAfterLoss,
  LegacyMutableRetry,
  LegacyTerminalAsGranted

\* =============================================================================
\* Variables — all flat strings to avoid TLC record/string comparison issues.
\* =============================================================================

VARIABLES
  tabPhase,           \* [t \in Tabs -> TabPhases]
  tabDraftCmd,        \* [t \in Tabs -> CmdIds \cup {"none"}]
  tabFrozenCmd,       \* [t \in Tabs -> CmdIds \cup {"none"}]
  tabVisibleOutcome,  \* [t \in Tabs -> Outcomes \cup {"none"}]
  sharedPendingCmd,   \* CmdIds \cup {"none"} — cross-tab authority (target)
  tabLocalPendingCmd, \* [t \in Tabs -> CmdIds \cup {"none"}] — legacy per-tab
  serverCommittedCmd, \* CmdIds \cup {"none"} — server truth
  commandCreator      \* Tabs \cup {"none"} — who created the shared command

vars == <<tabPhase, tabDraftCmd, tabFrozenCmd, tabVisibleOutcome,
          sharedPendingCmd, tabLocalPendingCmd, serverCommittedCmd,
          commandCreator>>

\* =============================================================================
\* Derived definitions
\* =============================================================================

TabPhases == {"idle", "draft", "submitting", "indeterminate", "confirmed"}

Outcomes == {"granted", "idempotent_replay", "terminal", "rejected",
             "idempotency_conflict"}

\* Command-to-operation mapping (fixed per CmdId).
\* C1 and C2 may map to the same or different Ops depending on config.
CmdOp(c) == IF c = C1 THEN "O1" ELSE "O2"

\* =============================================================================
\* Type invariant
\* =============================================================================

ClientTypeOK ==
  /\ tabPhase \in [Tabs -> TabPhases]
  /\ tabDraftCmd \in [Tabs -> CmdIds \cup {"none"}]
  /\ tabFrozenCmd \in [Tabs -> CmdIds \cup {"none"}]
  /\ tabVisibleOutcome \in [Tabs -> Outcomes \cup {"none"}]
  /\ sharedPendingCmd \in CmdIds \cup {"none"}
  /\ tabLocalPendingCmd \in [Tabs -> CmdIds \cup {"none"}]
  /\ serverCommittedCmd \in CmdIds \cup {"none"}
  /\ commandCreator \in Tabs \cup {"none"}

\* =============================================================================
\* Initial state
\* =============================================================================

Init ==
  /\ tabPhase = [t \in Tabs |-> "idle"]
  /\ tabDraftCmd = [t \in Tabs |-> "none"]
  /\ tabFrozenCmd = [t \in Tabs |-> "none"]
  /\ tabVisibleOutcome = [t \in Tabs |-> "none"]
  /\ sharedPendingCmd = "none"
  /\ tabLocalPendingCmd = [t \in Tabs |-> "none"]
  /\ serverCommittedCmd = "none"
  /\ commandCreator = "none"

\* =============================================================================
\* Target actions
\* =============================================================================

\* Open a draft dialog (tab-local, no shared authority needed yet).
OpenDraft(t) ==
  /\ tabPhase[t] = "idle"
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "draft"]
  /\ \E c \in CmdIds:
       tabDraftCmd' = [tabDraftCmd EXCEPT ![t] = c]
  /\ UNCHANGED <<tabFrozenCmd, tabVisibleOutcome, sharedPendingCmd,
                  tabLocalPendingCmd, serverCommittedCmd, commandCreator>>

\* Edit the draft (switch to a different command identity within the tab).
EditDraft(t) ==
  /\ tabPhase[t] = "draft"
  /\ tabDraftCmd[t] # "none"
  /\ \E c \in CmdIds:
       tabDraftCmd' = [tabDraftCmd EXCEPT ![t] = c]
  /\ UNCHANGED <<tabPhase, tabFrozenCmd, tabVisibleOutcome, sharedPendingCmd,
                  tabLocalPendingCmd, serverCommittedCmd, commandCreator>>

\* Freeze the draft and publish to shared authority.
FreezeAndPublishCommand(t) ==
  /\ tabPhase[t] = "draft"
  /\ tabDraftCmd[t] # "none"
  /\ IF LegacyPerTabPending
     THEN \* Legacy: publish only to tab-local (other tab invisible).
          /\ tabLocalPendingCmd[t] = "none"
          /\ tabLocalPendingCmd' = [tabLocalPendingCmd EXCEPT ![t] = tabDraftCmd[t]]
          /\ UNCHANGED sharedPendingCmd
     ELSE \* Target: publish to shared authority atomically.
          /\ sharedPendingCmd = "none"
          /\ \A t2 \in Tabs \ {t}:
               ~(tabPhase[t2] \in {"submitting", "indeterminate"}
                 /\ tabFrozenCmd[t2] # "none")
          /\ sharedPendingCmd' = tabDraftCmd[t]
          /\ UNCHANGED tabLocalPendingCmd
  /\ tabFrozenCmd' = [tabFrozenCmd EXCEPT ![t] = tabDraftCmd[t]]
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "submitting"]
  /\ commandCreator' = t
  /\ UNCHANGED <<tabDraftCmd, tabVisibleOutcome, serverCommittedCmd>>

\* Submit the frozen command to the server (models the HTTP POST).
SubmitCommand(t) ==
  /\ tabPhase[t] = "submitting"
  /\ tabFrozenCmd[t] # "none"
  /\ UNCHANGED <<tabPhase, tabDraftCmd, tabFrozenCmd, tabVisibleOutcome,
                  sharedPendingCmd, tabLocalPendingCmd, serverCommittedCmd,
                  commandCreator>>

\* Server commits the command (models successful server processing).
ServerCommit(t) ==
  /\ tabPhase[t] = "submitting"
  /\ tabFrozenCmd[t] # "none"
  /\ serverCommittedCmd = "none"
  /\ serverCommittedCmd' = tabFrozenCmd[t]
  /\ UNCHANGED <<tabPhase, tabDraftCmd, tabFrozenCmd, tabVisibleOutcome,
                  sharedPendingCmd, tabLocalPendingCmd, commandCreator>>

\* Deliver the response to the tab (granted).
DeliverResponse(t) ==
  /\ tabPhase[t] = "submitting"
  /\ serverCommittedCmd # "none"
  /\ tabFrozenCmd[t] # "none"
  /\ serverCommittedCmd = tabFrozenCmd[t]
  /\ (sharedPendingCmd = "none" \/ sharedPendingCmd = tabFrozenCmd[t])
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "confirmed"]
  /\ tabVisibleOutcome' = [tabVisibleOutcome EXCEPT ![t] = "granted"]
  /\ sharedPendingCmd' = "none"
  /\ tabLocalPendingCmd' = [t2 \in Tabs |-> "none"]
  /\ UNCHANGED <<tabDraftCmd, tabFrozenCmd, serverCommittedCmd, commandCreator>>

\* Response is lost (network failure, tab crash before receipt).
LoseResponse(t) ==
  /\ tabPhase[t] = "submitting"
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "indeterminate"]
  /\ UNCHANGED <<tabDraftCmd, tabFrozenCmd, tabVisibleOutcome,
                  sharedPendingCmd, tabLocalPendingCmd, serverCommittedCmd,
                  commandCreator>>

\* Close the dialog (does not clear frozen command if indeterminate).
CloseDialog(t) ==
  /\ tabPhase[t] \in {"confirmed", "indeterminate"}
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "idle"]
  /\ tabVisibleOutcome' = [tabVisibleOutcome EXCEPT ![t] = "none"]
  /\ UNCHANGED <<tabDraftCmd, tabFrozenCmd, sharedPendingCmd,
                  tabLocalPendingCmd, serverCommittedCmd, commandCreator>>

\* Navigate away (preserves frozen command in shared authority).
Navigate(t) ==
  /\ tabPhase[t] \in {"idle", "confirmed", "indeterminate"}
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "idle"]
  /\ tabDraftCmd' = [tabDraftCmd EXCEPT ![t] = "none"]
  /\ tabVisibleOutcome' = [tabVisibleOutcome EXCEPT ![t] = "none"]
  /\ UNCHANGED <<tabFrozenCmd, sharedPendingCmd,
                  tabLocalPendingCmd, serverCommittedCmd, commandCreator>>

\* Reload the tab.
ReloadTab(t) ==
  /\ tabPhase[t] \in {"idle", "indeterminate", "confirmed"}
  /\ IF LegacyNewIdentityAfterLoss
     THEN \* Legacy: discard old command, restore with a fresh identity.
          /\ sharedPendingCmd # "none"
          /\ \E c \in CmdIds:
               /\ c # sharedPendingCmd
               /\ tabFrozenCmd' = [tabFrozenCmd EXCEPT ![t] = c]
          /\ tabPhase' = [tabPhase EXCEPT ![t] = "indeterminate"]
          /\ tabDraftCmd' = [tabDraftCmd EXCEPT ![t] = "none"]
     ELSE \* Target: restore exact frozen command from shared authority.
          /\ sharedPendingCmd # "none"
          /\ tabFrozenCmd' = [tabFrozenCmd EXCEPT ![t] = sharedPendingCmd]
          /\ tabPhase' = [tabPhase EXCEPT ![t] = "indeterminate"]
          /\ tabDraftCmd' = [tabDraftCmd EXCEPT ![t] = "none"]
  /\ tabVisibleOutcome' = [tabVisibleOutcome EXCEPT ![t] = "none"]
  /\ UNCHANGED <<sharedPendingCmd, tabLocalPendingCmd,
                  serverCommittedCmd, commandCreator>>

\* Restore shared pending command on focus/visibility (target only).
RestoreSharedPendingCommand(t) ==
  /\ ~LegacyPerTabPending
  /\ tabPhase[t] = "idle"
  /\ sharedPendingCmd # "none"
  /\ tabFrozenCmd' = [tabFrozenCmd EXCEPT ![t] = sharedPendingCmd]
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "indeterminate"]
  /\ UNCHANGED <<tabDraftCmd, tabVisibleOutcome, sharedPendingCmd,
                  tabLocalPendingCmd, serverCommittedCmd, commandCreator>>

\* Retry the frozen command (after indeterminate / response loss).
RetryFrozenCommand(t) ==
  /\ tabPhase[t] = "indeterminate"
  /\ tabFrozenCmd[t] # "none"
  /\ IF LegacyMutableRetry
     THEN \* Legacy: mutate to a different command identity on retry.
          \E c \in CmdIds:
            /\ c # tabFrozenCmd[t]
            /\ tabFrozenCmd' = [tabFrozenCmd EXCEPT ![t] = c]
            /\ tabPhase' = [tabPhase EXCEPT ![t] = "submitting"]
     ELSE \* Target: retry exact frozen command unchanged.
          /\ tabPhase' = [tabPhase EXCEPT ![t] = "submitting"]
          /\ UNCHANGED tabFrozenCmd
  /\ UNCHANGED <<tabDraftCmd, tabVisibleOutcome, sharedPendingCmd,
                  tabLocalPendingCmd, serverCommittedCmd, commandCreator>>

\* Confirm terminal outcome and clear pending.
ConfirmTerminal(t) ==
  /\ tabPhase[t] \in {"submitting", "indeterminate"}
  /\ tabFrozenCmd[t] # "none"
  /\ (sharedPendingCmd = "none" \/ sharedPendingCmd = tabFrozenCmd[t])
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "confirmed"]
  /\ IF LegacyTerminalAsGranted
     THEN \* Bug: display terminal as granted.
          tabVisibleOutcome' = [tabVisibleOutcome EXCEPT ![t] = "granted"]
     ELSE tabVisibleOutcome' = [tabVisibleOutcome EXCEPT ![t] = "terminal"]
  /\ sharedPendingCmd' = "none"
  /\ tabLocalPendingCmd' = [t2 \in Tabs |-> "none"]
  /\ UNCHANGED <<tabDraftCmd, tabFrozenCmd, serverCommittedCmd, commandCreator>>

\* Confirm rejection and clear pending.
ConfirmRejected(t) ==
  /\ tabPhase[t] \in {"submitting", "indeterminate"}
  /\ tabFrozenCmd[t] # "none"
  /\ (sharedPendingCmd = "none" \/ sharedPendingCmd = tabFrozenCmd[t])
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "confirmed"]
  /\ tabVisibleOutcome' = [tabVisibleOutcome EXCEPT ![t] = "rejected"]
  /\ sharedPendingCmd' = "none"
  /\ tabLocalPendingCmd' = [t2 \in Tabs |-> "none"]
  /\ UNCHANGED <<tabDraftCmd, tabFrozenCmd, serverCommittedCmd, commandCreator>>

\* Clear confirmed command (reset to idle for new workflow).
ClearConfirmedCommand(t) ==
  /\ tabPhase[t] = "confirmed"
  /\ tabPhase' = [tabPhase EXCEPT ![t] = "idle"]
  /\ tabFrozenCmd' = [tabFrozenCmd EXCEPT ![t] = "none"]
  /\ tabDraftCmd' = [tabDraftCmd EXCEPT ![t] = "none"]
  /\ tabVisibleOutcome' = [tabVisibleOutcome EXCEPT ![t] = "none"]
  /\ UNCHANGED <<sharedPendingCmd, tabLocalPendingCmd,
                  serverCommittedCmd, commandCreator>>

\* =============================================================================
\* Next-state relation
\* =============================================================================

Next ==
  \E t \in Tabs:
    \/ OpenDraft(t)
    \/ EditDraft(t)
    \/ FreezeAndPublishCommand(t)
    \/ SubmitCommand(t)
    \/ ServerCommit(t)
    \/ DeliverResponse(t)
    \/ LoseResponse(t)
    \/ CloseDialog(t)
    \/ Navigate(t)
    \/ ReloadTab(t)
    \/ RestoreSharedPendingCommand(t)
    \/ RetryFrozenCommand(t)
    \/ ConfirmTerminal(t)
    \/ ConfirmRejected(t)
    \/ ClearConfirmedCommand(t)

Spec == Init /\ [][Next]_vars

\* =============================================================================
\* Safety properties (NEVER reference legacy flags)
\* =============================================================================

\* After first submit, the frozen command matches the shared authority.
FrozenCommandImmutable ==
  \A t \in Tabs:
    (tabPhase[t] \in {"submitting", "indeterminate"}
     /\ tabFrozenCmd[t] # "none"
     /\ sharedPendingCmd # "none") =>
      tabFrozenCmd[t] = sharedPendingCmd

\* Response loss preserves exact command identity through recovery.
IndeterminatePreservesCommandIdentity ==
  \A t \in Tabs:
    (tabPhase[t] = "indeterminate" /\ tabFrozenCmd[t] # "none"
     /\ sharedPendingCmd # "none") =>
      tabFrozenCmd[t] = sharedPendingCmd

\* At most one unresolved command per workflow across all tabs.
AtMostOneUnresolvedCommandPerWorkflow ==
  \A t1, t2 \in Tabs:
    (t1 # t2
     /\ tabPhase[t1] \in {"submitting", "indeterminate"}
     /\ tabPhase[t2] \in {"submitting", "indeterminate"}
     /\ tabFrozenCmd[t1] # "none"
     /\ tabFrozenCmd[t2] # "none") =>
      CmdOp(tabFrozenCmd[t1]) = CmdOp(tabFrozenCmd[t2])

\* While an unresolved command exists, no tab submits a different one.
NoSecondSubmitWhileUnresolved ==
  \A t \in Tabs:
    (tabPhase[t] \in {"submitting", "indeterminate"}
     /\ tabFrozenCmd[t] # "none"
     /\ sharedPendingCmd # "none") =>
      CmdOp(tabFrozenCmd[t]) = CmdOp(sharedPendingCmd)

\* Reload restores the exact frozen command from shared authority.
ReloadRestoresExactCommand ==
  \A t \in Tabs:
    (tabPhase[t] = "indeterminate" /\ tabFrozenCmd[t] # "none"
     /\ sharedPendingCmd # "none") =>
      tabFrozenCmd[t] = sharedPendingCmd

\* Confirmed outcomes clear the shared pending command (scoped to active cmd).
ConfirmedOutcomeClearsPending ==
  \A t \in Tabs:
    (tabPhase[t] = "confirmed"
     /\ tabVisibleOutcome[t] \in {"granted", "idempotent_replay",
                                   "terminal", "rejected",
                                   "idempotency_conflict"}
     /\ tabFrozenCmd[t] # "none"
     /\ sharedPendingCmd # "none") =>
      tabFrozenCmd[t] # sharedPendingCmd

\* Displaying granted requires actual server commitment.
TerminalNeverReportedAsGranted ==
  \A t \in Tabs:
    tabVisibleOutcome[t] = "granted" => serverCommittedCmd # "none"

================================================================================
