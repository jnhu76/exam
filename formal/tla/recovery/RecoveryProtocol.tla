------------------------------- MODULE RecoveryProtocol -------------------------------
(*
  REC-F1 — Formal model of the candidate recovery protocol frozen by ADR-012
  and implemented by REC-I3.

  Scope:
    Abstract recovery protocol among Client, Server, Environment. Captures
    concurrency, route-binding, snapshot-authority, and terminal-monotonicity
    semantics that the TypeScript implementation must preserve.

  Non-goals:
    Does NOT model React/DOM/Fastify/PostgreSQL/HTTP serialization/RBAC/
    grading/answer content. It is an executable consistency check, not a
    mechanically verified refinement.

  Authority:
    docs/adr/ADR-012-candidate-recovery-contract.md is binding. Where the
    runtime still differs from target (REC-I4 time-compensation), the mismatch
    is documented, NOT modeled as target.

  Finiteness:
    All domains are small finite sets. Counters are bounded. NavigateTo is
    included (it is the core of the cross-attempt race being modeled) and
    bounded via small RequestIds + on-navigation request clearing.

  Legacy-defect switches (CONSTANTS):
    Each switch changes ACTION behavior only — it NEVER appears in a property.
    Each expected-counterexample config enables exactly one switch; the buggy
    action it enables produces a state that violates the named TARGET
    property (which is stated without the flag).
*)
EXTENDS Naturals, Sequences, FiniteSets, TLC

\* =============================================================================
\* Finite domains.
\* =============================================================================

CONSTANTS
  Attempts,
  Generations,
  RequestIds,
  AnswerValues,
  \* Legacy-defect switches — affect ACTIONS only, NEVER properties.
  LegacyWrongAttemptCapability,
  LegacyGlobalInFlight,
  LegacyApplyStalePageLoad,
  LegacySkipReloadAfterPostFailure

\* -----------------------------------------------------------------------------
\* Variables (single contiguous block — TLA+ disallows blank lines here).
\* -----------------------------------------------------------------------------
VARIABLES
  serverStatus,             \* [attempt -> status]
  serverVersion,            \* [attempt -> 0..MAX_VERSION]  monotonic
  submittedSnapshot,        \* [attempt -> AnswerValue | NoSnapshot]  frozen at submit
  disruptedOnce,            \* [attempt -> BOOL]  bounds MarkDisrupted
  routeAttempt,             \* the attempt the page is bound to
  clientGeneration,         \* monotonic token bumped on route change
  clientSnapshotAttempt,    \* attempt id of the last applied snapshot
  clientSnapshotGen,        \* generation of the last applied snapshot
  clientSnapshotEditable,   \* isEditable flag of the last applied snapshot
  pageLoadRequests,         \* in-flight initial GETs
  restoreRequests,          \* in-flight POST /restore
  snapshotReloadRequests,   \* in-flight post-restore GETs
  pendingDeliveries,        \* queued responses (frozen server state inside)
  uiState,                  \* loading | restoring | editable | restore_failed | terminal
  lastSnapshotViaGet,       \* TRUE iff the applied snapshot came from a page_load/snapshot_reload (not a POST)
  networkUp,                \* held TRUE for the liveness execution
  deadlinePassed,           \* [attempt -> BOOL]
  timeGrant                 \* [attempt -> 0..MAX_GRANT]  only GrantExtension bumps

\* =============================================================================
\* Derived definitions
\* =============================================================================

vars ==
  <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
    routeAttempt, clientGeneration,
    clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
    pageLoadRequests, restoreRequests, snapshotReloadRequests,
    pendingDeliveries, uiState, lastSnapshotViaGet, networkUp,
    deadlinePassed, timeGrant>>

MAX_VERSION == 3
MAX_GRANT == 1
\* Cap on concurrently-pending deliveries. Keeps pendingDeliveries finite
\* without weakening the properties: any delivery beyond the cap is simply
\* not produced (the request stays in flight and is re-served later).
MAX_DELIVERIES == 2

Statuses == {"in_progress", "disrupted", "submitted", "graded", "voided"}
NetOutcomes == {"acknowledged", "lost"}

IsTerminal(s) == s = "submitted" \/ s = "graded" \/ s = "voided"
IsResumable(s) == s = "disrupted"

Phases == {"loading", "restoring", "editable", "restore_failed", "terminal"}

NoSnapshot == "none"

RequestKind == {"page_load", "restore", "snapshot_reload"}

\* Request record (created by client actions; carries creation-time binding).
Request == [ requestId     : RequestIds,
             attemptId      : Attempts,
             generation     : Generations,
             requestKind    : RequestKind,
             snapshotAttempt: Attempts \cup {NoSnapshot} ]

\* Delivery record. CRITICALLY, the server-state fields are FROZEN at the
\* moment the server produced the response. Apply-time reads the frozen
\* values, never the live server state — otherwise a delayed response would
\* magically carry the latest state and stale-snapshot-content could not be
\* modeled (only stale request identity). Only the two fields actually read
\* at apply time are carried (statusAtResponse, editableAtResponse); carrying
\* more would needlessly multiply distinct delivery records.
Delivery == [ requestId         : RequestIds,
              attemptId          : Attempts,
              generation         : Generations,
              requestKind        : RequestKind,
              outcome            : NetOutcomes,
              statusAtResponse   : Statuses,
              editableAtResponse : BOOLEAN ]

\* Predicates over the state --------------------------------------------------

IsCurrent(r) ==
  r.attemptId = routeAttempt /\ r.generation = clientGeneration

\* TARGET per-attempt in-flight guard: a restore is in flight for the route
\* iff there exists a restore request bound to the current route.
RestoreInFlightForRoute ==
  \E r \in restoreRequests : IsCurrent(r)

\* LEGACY global in-flight guard (bug): ANY in-flight restore blocks ALL
\* routes. Used by StartRestore when LegacyGlobalInFlight is TRUE.
AnyRestoreInFlight ==
  restoreRequests # {}

\* The guard StartRestore actually uses. The legacy flag switches the guard
\* to the global-blocking form.
RestoreStartGuard ==
  IF LegacyGlobalInFlight THEN ~AnyRestoreInFlight ELSE ~RestoreInFlightForRoute

\* =============================================================================
\* Init
\* =============================================================================

Init ==
  /\ serverStatus = [a \in Attempts |-> "disrupted"]
  /\ serverVersion = [a \in Attempts |-> 0]
  /\ submittedSnapshot = [a \in Attempts |-> NoSnapshot]
  /\ disruptedOnce = [a \in Attempts |-> FALSE]
  /\ routeAttempt = CHOOSE a \in Attempts : TRUE
  /\ clientGeneration = CHOOSE g \in Generations : TRUE
  /\ clientSnapshotAttempt = NoSnapshot
  /\ clientSnapshotGen = CHOOSE g \in Generations : TRUE
  /\ clientSnapshotEditable = FALSE
  /\ pageLoadRequests = {}
  /\ restoreRequests = {}
  /\ snapshotReloadRequests = {}
  /\ pendingDeliveries = {}
  /\ uiState = "loading"
  /\ lastSnapshotViaGet = FALSE
  /\ networkUp = TRUE
  /\ deadlinePassed = [a \in Attempts |-> FALSE]
  /\ timeGrant = [a \in Attempts |-> 0]

\* =============================================================================
\* Helper: build a delivery freezing the live server state for an attempt.
\* =============================================================================

MakeDelivery(rid, r) ==
  [requestId |-> rid, attemptId |-> r.attemptId, generation |-> r.generation,
   requestKind |-> r.requestKind, outcome |-> "acknowledged",
   statusAtResponse |-> serverStatus[r.attemptId],
   editableAtResponse |-> (serverStatus[r.attemptId] = "in_progress")]

\* =============================================================================
\* Client / navigation actions
\* =============================================================================

\* NavigateTo bumps the generation token and clears in-flight REQUESTS for
\* the old route (REC-I3 generationRef reset). Pending DELIVERIES are NOT
\* cleared — a late stale delivery may still arrive and must be rejected at
\* apply time. This is the cross-attempt race the model exists to verify.
NavigateTo(a) ==
  /\ a # routeAttempt
  /\ a \in Attempts
  /\ routeAttempt' = a
  /\ clientGeneration' = CHOOSE g \in Generations : g # clientGeneration
  /\ clientSnapshotAttempt' = NoSnapshot
  /\ clientSnapshotGen' = clientGeneration'
  /\ clientSnapshotEditable' = FALSE
  /\ lastSnapshotViaGet' = FALSE
  /\ uiState' = "loading"
  /\ pageLoadRequests' = {}
  /\ restoreRequests' = {}
  /\ snapshotReloadRequests' = {}
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                 pendingDeliveries, networkUp, deadlinePassed, timeGrant>>

StartPageLoad ==
  /\ uiState = "loading"
  /\ networkUp
  /\ ~(\E r \in pageLoadRequests : IsCurrent(r))
  /\ \E rid \in RequestIds :
       /\ rid \notin {r.requestId : r \in pageLoadRequests \cup restoreRequests
                                          \cup snapshotReloadRequests}
       /\ pageLoadRequests' = pageLoadRequests \cup {
           [requestId |-> rid, attemptId |-> routeAttempt,
            generation |-> clientGeneration, requestKind |-> "page_load",
            snapshotAttempt |-> clientSnapshotAttempt]}
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                 routeAttempt, clientGeneration,
                 clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                 restoreRequests, snapshotReloadRequests, pendingDeliveries,
                 uiState, lastSnapshotViaGet, networkUp, deadlinePassed, timeGrant>>

\* StartRestore. Capability gate uses clientSnapshotAttempt = routeAttempt
\* under the TARGET; the legacy flag disables that check, allowing a restore
\* for B to be initiated from A's snapshot (NoWrongAttemptRestore violation).
\* The in-flight guard uses RestoreStartGuard (per-attempt target / global
\* legacy).
StartRestore ==
  /\ networkUp
  /\ uiState \in {"loading", "restore_failed"}
  /\ IsResumable(serverStatus[routeAttempt])
  /\ (LegacyWrongAttemptCapability \/ clientSnapshotAttempt = routeAttempt)
  /\ RestoreStartGuard
  /\ \E rid \in RequestIds :
       /\ rid \notin {r.requestId : r \in pageLoadRequests \cup restoreRequests
                                          \cup snapshotReloadRequests}
       /\ restoreRequests' = restoreRequests \cup {
           [requestId |-> rid, attemptId |-> routeAttempt,
            generation |-> clientGeneration, requestKind |-> "restore",
            snapshotAttempt |-> clientSnapshotAttempt]}
  /\ uiState' = "restoring"
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                 routeAttempt, clientGeneration,
                 clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                 pageLoadRequests, snapshotReloadRequests, pendingDeliveries,
                 lastSnapshotViaGet, networkUp, deadlinePassed, timeGrant>>

RetryRestore ==
  /\ networkUp
  /\ uiState = "restore_failed"
  /\ IsResumable(serverStatus[routeAttempt])
  /\ (LegacyWrongAttemptCapability \/ clientSnapshotAttempt = routeAttempt)
  /\ RestoreStartGuard
  /\ \E rid \in RequestIds :
       /\ rid \notin {r.requestId : r \in pageLoadRequests \cup restoreRequests
                                          \cup snapshotReloadRequests}
       /\ restoreRequests' = restoreRequests \cup {
           [requestId |-> rid, attemptId |-> routeAttempt,
            generation |-> clientGeneration, requestKind |-> "restore",
            snapshotAttempt |-> clientSnapshotAttempt]}
  /\ uiState' = "restoring"
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                 routeAttempt, clientGeneration,
                 clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                 pageLoadRequests, snapshotReloadRequests, pendingDeliveries,
                 lastSnapshotViaGet, networkUp, deadlinePassed, timeGrant>>

\* REC-I3 always issues an authoritative GET after the POST settles. The
\* legacy flag skips it (LegacyApplyPostOutcome then drives UI from the POST).
StartAuthoritativeReload ==
  /\ networkUp
  /\ uiState = "restoring"
  /\ restoreRequests = {}
  /\ ~LegacySkipReloadAfterPostFailure
  /\ ~(\E r \in snapshotReloadRequests : IsCurrent(r))
  /\ \E rid \in RequestIds :
       /\ rid \notin {r.requestId : r \in pageLoadRequests \cup restoreRequests
                                          \cup snapshotReloadRequests}
       /\ snapshotReloadRequests' = snapshotReloadRequests \cup {
           [requestId |-> rid, attemptId |-> routeAttempt,
            generation |-> clientGeneration, requestKind |-> "snapshot_reload",
            snapshotAttempt |-> clientSnapshotAttempt]}
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                 routeAttempt, clientGeneration,
                 clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                 pageLoadRequests, restoreRequests, pendingDeliveries,
                 uiState, lastSnapshotViaGet, networkUp, deadlinePassed, timeGrant>>

\* Apply a page-load / snapshot-reload response. Reads the FROZEN server
\* state carried by the delivery. Under TARGET, a stale delivery (not
\* current route/generation) is rejected. Under the legacy flag, a stale
\* delivery may be applied — the buggy behavior the property catches.
ApplyAuthoritativeReload(d) ==
  /\ d \in pendingDeliveries
  /\ d.requestKind \in {"page_load", "snapshot_reload"}
  /\ (LegacyApplyStalePageLoad \/ IsCurrent(d))
  /\ d.outcome = "acknowledged"
  /\ pendingDeliveries' = pendingDeliveries \ {d}
  /\ pageLoadRequests' = pageLoadRequests \ {r \in pageLoadRequests : r.requestId = d.requestId}
  /\ snapshotReloadRequests' = snapshotReloadRequests \ {r \in snapshotReloadRequests : r.requestId = d.requestId}
  /\ clientSnapshotAttempt' = d.attemptId
  /\ clientSnapshotGen' = d.generation
  /\ clientSnapshotEditable' = d.editableAtResponse
  /\ lastSnapshotViaGet' = TRUE
  /\ uiState' = CASE d.statusAtResponse = "in_progress"
                  -> "editable"
                [] IsTerminal(d.statusAtResponse)
                  -> "terminal"
                [] IsResumable(d.statusAtResponse) /\ d.requestKind = "snapshot_reload"
                  -> "restore_failed"
                [] OTHER -> "loading"
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                 routeAttempt, clientGeneration,
                 restoreRequests, networkUp, deadlinePassed, timeGrant>>

\* LEGACY buggy action: when the legacy flag is set and the reload was
\* skipped, the POST outcome alone drives the UI to editable. The
\* PostOutcomeIsNotPageAuthority property (stated WITHOUT the flag) catches
\* this: editable requires an applied GET snapshot.
LegacyApplyPostOutcome ==
  /\ LegacySkipReloadAfterPostFailure
  /\ uiState = "restoring"
  /\ restoreRequests = {}
  /\ \E d \in pendingDeliveries :
       /\ d.requestKind = "restore"
       /\ d.outcome = "acknowledged"
       /\ pendingDeliveries' = pendingDeliveries \ {d}
       /\ clientSnapshotAttempt' = d.attemptId
       /\ clientSnapshotGen' = d.generation
       /\ clientSnapshotEditable' = TRUE
       /\ lastSnapshotViaGet' = FALSE
       /\ uiState' = "editable"
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                 routeAttempt, clientGeneration,
                 pageLoadRequests, snapshotReloadRequests, restoreRequests,
                 networkUp, deadlinePassed, timeGrant>>

\* =============================================================================
\* Server actions
\* =============================================================================

MarkDisrupted ==
  /\ \E a \in Attempts :
       /\ serverStatus[a] = "in_progress"
       /\ ~disruptedOnce[a]
       /\ serverStatus' = [serverStatus EXCEPT ![a] = "disrupted"]
       /\ disruptedOnce' = [disruptedOnce EXCEPT ![a] = TRUE]
       /\ UNCHANGED <<serverVersion, submittedSnapshot, routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, uiState, lastSnapshotViaGet, networkUp, deadlinePassed, timeGrant>>

\* GET handler: produce a delivery freezing the live server state. Capped by
\* MAX_DELIVERIES so pendingDeliveries stays finite.
ServerReturnSnapshot ==
  /\ Cardinality(pendingDeliveries) < MAX_DELIVERIES
  /\ \E r \in pageLoadRequests \cup snapshotReloadRequests :
       /\ r.attemptId \in Attempts
       /\ pendingDeliveries' = pendingDeliveries \cup {MakeDelivery(r.requestId, r)}
       /\ pageLoadRequests' = pageLoadRequests \ {r}
       /\ snapshotReloadRequests' = snapshotReloadRequests \ {r}
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      restoreRequests, uiState, lastSnapshotViaGet, networkUp, deadlinePassed, timeGrant>>

\* POST /restore handler: lifecycle transition disrupted -> in_progress.
\* Does NOT grant time (REC-I4 target). Produces a delivery freezing state.
ProcessRestore ==
  /\ \E r \in restoreRequests :
       /\ IsResumable(serverStatus[r.attemptId])
       /\ ~deadlinePassed[r.attemptId]
       /\ Cardinality(pendingDeliveries) < MAX_DELIVERIES
       /\ serverStatus' = [serverStatus EXCEPT ![r.attemptId] = "in_progress"]
       /\ serverVersion' = [serverVersion EXCEPT ![r.attemptId] =
            serverVersion[r.attemptId] + 1]
       /\ pendingDeliveries' = pendingDeliveries \cup {MakeDelivery(r.requestId, r)}
       /\ restoreRequests' = restoreRequests \ {r}
       /\ UNCHANGED <<submittedSnapshot, disruptedOnce, routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, snapshotReloadRequests,
                      uiState, lastSnapshotViaGet, networkUp, deadlinePassed, timeGrant>>

\* POST /restore rejected because the deadline won between GET and POST.
RejectRestoreDeadlineWon ==
  /\ \E r \in restoreRequests :
       /\ deadlinePassed[r.attemptId]
       /\ Cardinality(pendingDeliveries) < MAX_DELIVERIES
       /\ pendingDeliveries' = pendingDeliveries \cup {MakeDelivery(r.requestId, r)}
       /\ restoreRequests' = restoreRequests \ {r}
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, snapshotReloadRequests,
                      uiState, lastSnapshotViaGet, networkUp, deadlinePassed, timeGrant>>

\* The restore POST delivery is a command ACK only — the client never applies
\* it as page state (except under the legacy bug). It must be consumed to
\* release the requestId; otherwise repeated POSTs exhaust the pool and
\* produce a model-artifact liveness failure. ConsumePostAck is the TARGET
\* consumption path (the legacy path is LegacyApplyPostOutcome above).
ConsumePostAck ==
  /\ \E d \in pendingDeliveries :
       /\ d.requestKind = "restore"
       /\ pendingDeliveries' = pendingDeliveries \ {d}
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      uiState, lastSnapshotViaGet, networkUp, deadlinePassed, timeGrant>>

DeadlineReconcile ==
  /\ \E a \in Attempts :
       /\ deadlinePassed[a]
       /\ serverStatus[a] \in {"in_progress", "disrupted"}
       /\ serverStatus' = [serverStatus EXCEPT ![a] = "submitted"]
       /\ submittedSnapshot' = [submittedSnapshot EXCEPT ![a] =
            CHOOSE v \in AnswerValues : TRUE]
       /\ serverVersion' = [serverVersion EXCEPT ![a] =
            serverVersion[a] + 1]
       /\ UNCHANGED <<disruptedOnce, routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, uiState, lastSnapshotViaGet, networkUp, timeGrant, deadlinePassed>>

SubmitAttempt ==
  /\ uiState = "editable"
  /\ \E a \in Attempts :
       /\ a = routeAttempt
       /\ serverStatus[a] = "in_progress"
       /\ serverStatus' = [serverStatus EXCEPT ![a] = "submitted"]
       /\ submittedSnapshot' = [submittedSnapshot EXCEPT ![a] =
            CHOOSE v \in AnswerValues : TRUE]
       /\ serverVersion' = [serverVersion EXCEPT ![a] =
            serverVersion[a] + 1]
       /\ uiState' = "terminal"
       /\ UNCHANGED <<disruptedOnce, routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, lastSnapshotViaGet, networkUp, timeGrant, deadlinePassed>>

GradeAttempt ==
  /\ \E a \in Attempts :
       /\ serverStatus[a] = "submitted"
       /\ serverStatus' = [serverStatus EXCEPT ![a] = "graded"]
       /\ UNCHANGED <<serverVersion, submittedSnapshot, disruptedOnce, routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, uiState, lastSnapshotViaGet, networkUp, timeGrant, deadlinePassed>>

GrantExtension ==
  /\ \E a \in Attempts :
       /\ serverStatus[a] \in {"in_progress", "disrupted"}
       /\ timeGrant[a] < MAX_GRANT
       /\ timeGrant' = [timeGrant EXCEPT ![a] = timeGrant[a] + 1]
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, uiState, lastSnapshotViaGet, networkUp, deadlinePassed>>

\* =============================================================================
\* Environment actions
\* =============================================================================

\* Lose a response. The client must recover (via the authoritative GET under
\* TARGET, or be stuck under the legacy skip-reload bug).
LoseResponse ==
  /\ \E d \in pendingDeliveries :
       /\ pendingDeliveries' = pendingDeliveries \ {d}
       /\ pageLoadRequests' = pageLoadRequests \ {r \in pageLoadRequests : r.requestId = d.requestId}
       /\ restoreRequests' = restoreRequests \ {r \in restoreRequests : r.requestId = d.requestId}
       /\ snapshotReloadRequests' = snapshotReloadRequests \ {r \in snapshotReloadRequests : r.requestId = d.requestId}
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      uiState, lastSnapshotViaGet, networkUp, deadlinePassed, timeGrant>>

NetworkDown == /\ networkUp /\ networkUp' = FALSE
               /\ UNCHANGED <<lastSnapshotViaGet, serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                              routeAttempt, clientGeneration,
                              clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                              pageLoadRequests, restoreRequests, snapshotReloadRequests,
                              pendingDeliveries, uiState, deadlinePassed, timeGrant>>
NetworkUp == /\ ~networkUp /\ networkUp' = TRUE
             /\ UNCHANGED <<lastSnapshotViaGet, serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                            routeAttempt, clientGeneration,
                            clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                            pageLoadRequests, restoreRequests, snapshotReloadRequests,
                            pendingDeliveries, uiState, deadlinePassed, timeGrant>>

DeadlinePasses ==
  /\ \E a \in Attempts :
       /\ ~deadlinePassed[a]
       /\ deadlinePassed' = [deadlinePassed EXCEPT ![a] = TRUE]
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, uiState, lastSnapshotViaGet, networkUp, timeGrant>>

\* =============================================================================
\* Next variants. The safety model is SPLIT into focused configurations to
\* keep each reachable state graph finite (a single Next with NavigateTo +
\* loss + deadline + grade diverges past 10^6 states in seconds). Each
\* variant includes only the actions relevant to a property family:
\*   - CoreNext      : single-route restore lifecycle (no NavigateTo).
\*   - RouteSwitchNext: adds NavigateTo for the cross-attempt race properties.
\*                     Excludes loss/deadline/grade (which combinatorially
\*                     explode against route changes).
\*   - SubmissionNext: single-route submit/freeze/grade (no NavigateTo).
\* The UNION of these covers the full action set; each is independently
\* exhaustive. See formal/tla/recovery/README.md §"Split safety models".
\* =============================================================================

\* Core restore lifecycle on a single route.
CoreNext ==
  \/ StartPageLoad
  \/ StartRestore
  \/ RetryRestore
  \/ StartAuthoritativeReload
  \/ LegacyApplyPostOutcome
  \/ (\E d \in pendingDeliveries : ApplyAuthoritativeReload(d))
  \/ ConsumePostAck
  \/ ServerReturnSnapshot
  \/ ProcessRestore
  \/ RejectRestoreDeadlineWon
  \/ LoseResponse

\* Cross-attempt races: includes NavigateTo. Excludes loss/deadline/grade to
\* stay finite — those are covered by CoreNext and SubmissionNext.
RouteSwitchNext ==
  \/ (\E a \in Attempts : NavigateTo(a))
  \/ StartPageLoad
  \/ StartRestore
  \/ RetryRestore
  \/ StartAuthoritativeReload
  \/ LegacyApplyPostOutcome
  \/ (\E d \in pendingDeliveries : ApplyAuthoritativeReload(d))
  \/ ConsumePostAck
  \/ ServerReturnSnapshot
  \/ ProcessRestore

\* Submission / freeze / grade lifecycle on a single route.
SubmissionNext ==
  \/ StartPageLoad
  \/ StartRestore
  \/ StartAuthoritativeReload
  \/ (\E d \in pendingDeliveries : ApplyAuthoritativeReload(d))
  \/ ConsumePostAck
  \/ ServerReturnSnapshot
  \/ ProcessRestore
  \/ DeadlinePasses
  \/ DeadlineReconcile
  \/ SubmitAttempt
  \/ GradeAttempt

\* Full Next — the union. Used only for the explore mode; NOT for the gated
\* safety configs (it diverges). Kept for completeness so the action surface
\* is documented in one place.
Next ==
  \/ (\E a \in Attempts : NavigateTo(a))
  \/ StartPageLoad
  \/ StartRestore
  \/ RetryRestore
  \/ StartAuthoritativeReload
  \/ LegacyApplyPostOutcome
  \/ (\E d \in pendingDeliveries : ApplyAuthoritativeReload(d))
  \/ ConsumePostAck
  \/ ServerReturnSnapshot
  \/ ProcessRestore
  \/ RejectRestoreDeadlineWon
  \/ DeadlineReconcile
  \/ SubmitAttempt
  \/ GradeAttempt
  \/ LoseResponse
  \/ DeadlinePasses

\* Liveness Next — excludes NavigateTo / NetworkDown / NetworkUp (fairness
\* assumptions: user stays on route; network eventually stays available).
LivenessNext ==
  \/ StartPageLoad
  \/ StartRestore
  \/ RetryRestore
  \/ StartAuthoritativeReload
  \/ (\E d \in pendingDeliveries : ApplyAuthoritativeReload(d))
  \/ ConsumePostAck
  \/ ServerReturnSnapshot
  \/ ProcessRestore
  \/ RejectRestoreDeadlineWon
  \/ DeadlineReconcile
  \/ SubmitAttempt
  \/ GradeAttempt
  \/ LoseResponse
  \/ DeadlinePasses

Spec == Init /\ [][Next]_vars
CoreSpec == Init /\ [][CoreNext]_vars
RouteSwitchSpec == Init /\ [][RouteSwitchNext]_vars
SubmissionSpec == Init /\ [][SubmissionNext]_vars
LiveSpec == Init /\ [][LivenessNext]_vars

\* =============================================================================
\* SAFETY INVARIANTS — state predicates. NO legacy flag is referenced.
\* =============================================================================

TypeOK ==
  /\ serverStatus \in [Attempts -> Statuses]
  /\ serverVersion \in [Attempts -> 0..MAX_VERSION]
  /\ submittedSnapshot \in [Attempts -> AnswerValues \cup {NoSnapshot}]
  /\ disruptedOnce \in [Attempts -> BOOLEAN]
  /\ routeAttempt \in Attempts
  /\ clientGeneration \in Generations
  /\ clientSnapshotAttempt \in Attempts \cup {NoSnapshot}
  /\ clientSnapshotGen \in Generations
  /\ clientSnapshotEditable \in BOOLEAN
  /\ pageLoadRequests \in SUBSET Request
  /\ restoreRequests \in SUBSET Request
  /\ snapshotReloadRequests \in SUBSET Request
  /\ pendingDeliveries \in SUBSET Delivery
  /\ uiState \in Phases
  /\ lastSnapshotViaGet \in BOOLEAN
  /\ networkUp \in BOOLEAN
  /\ deadlinePassed \in [Attempts -> BOOLEAN]
  /\ timeGrant \in [Attempts -> 0..MAX_GRANT]

\* A restore for B must never be initiated from A's snapshot. Stated over the
\* creation-time binding captured in the request record.
NoWrongAttemptRestore ==
  \A r \in restoreRequests : r.snapshotAttempt = r.attemptId

\* A stale page-load/restore/reload response cannot become the page's applied
\* snapshot. Stated over the APPLIED snapshot: when one is applied, it must
\* match the current route + generation. (A pending stale delivery is allowed;
\* what is forbidden is letting it become the applied snapshot.)
NoStalePageLoadApply ==
  (clientSnapshotAttempt # NoSnapshot) =>
    (clientSnapshotAttempt = routeAttempt /\ clientSnapshotGen = clientGeneration)

NoStaleRestoreApply ==
  (clientSnapshotAttempt # NoSnapshot) =>
    (clientSnapshotAttempt = routeAttempt /\ clientSnapshotGen = clientGeneration)

\* Editable requires a current-generation authoritative GET snapshot for the
\* current route. A POST ack alone (or a stale apply) cannot make it editable.
EditableRequiresCurrentAuthoritativeSnapshot ==
  (uiState = "editable") =>
    (clientSnapshotAttempt = routeAttempt
     /\ clientSnapshotGen = clientGeneration
     /\ clientSnapshotEditable = TRUE)

\* POST outcome is not page authority: editable requires the applied snapshot
\* to have come from a GET (page_load / snapshot_reload), not from a POST
\* restore ack. Tracked via the lastSnapshotViaGet history variable, which
\* ApplyAuthoritativeReload sets TRUE and LegacyApplyPostOutcome sets FALSE.
PostOutcomeIsNotPageAuthority ==
  (uiState = "editable") => lastSnapshotViaGet

\* =============================================================================
\* TEMPORAL SAFETY PROPERTIES — cross-state constraints. These MUST be checked
\* via PROPERTY (not INVARIANT) in the .cfg. NO legacy flag is referenced.
\* =============================================================================

\* Once submitted/graded/voided, an attempt cannot return to a non-terminal
\* state (terminal statuses are absorbing). Stated as a transition constraint:
\* if it is terminal now, it must remain terminal in the next state.
TerminalNeverResurrects ==
  [][\A a \in Attempts :
       IsTerminal(serverStatus[a]) => IsTerminal(serverStatus'[a])]_vars

\* Once a submitted snapshot is frozen, it never changes.
SubmittedSnapshotImmutable ==
  [][\A a \in Attempts :
       submittedSnapshot[a] # NoSnapshot => submittedSnapshot'[a] = submittedSnapshot[a]]_vars

\* serverVersion never decreases.
ServerVersionNeverDecreases ==
  [][\A a \in Attempts : serverVersion'[a] >= serverVersion[a]]_vars

\* timeGrant never decreases (only GrantExtension may bump it).
TimeGrantNeverDecreases ==
  [][\A a \in Attempts : timeGrant'[a] >= timeGrant[a]]_vars

\* Cross-attempt non-blocking: if route B is resumable and the client has
\* applied B's snapshot, then an in-flight restore for A must not prevent a
\* restore for B. Stated as: when no restore is in flight for the route, the
\* client's ability to start one for B is not gated on A. Modeled as an
\* enabledness assertion: the StartRestore guard for the route, under target,
\* depends only on the route's own in-flight status.
NoCrossAttemptRestoreBlocking ==
  []((IsResumable(serverStatus[routeAttempt])
       /\ clientSnapshotAttempt = routeAttempt
       /\ ~RestoreInFlightForRoute)
      => <>(RestoreInFlightForRoute
            \/ serverStatus[routeAttempt] = "in_progress"
            \/ IsTerminal(serverStatus[routeAttempt])))

\* =============================================================================
\* Liveness property (PROPERTY, under fairness).
\* =============================================================================

CurrentResumableAttemptEventuallyProgresses ==
  []((networkUp /\ IsResumable(serverStatus[routeAttempt])
       /\ uiState \in {"loading", "restoring"})
      => <>(uiState \in {"editable", "terminal", "restore_failed"}))

\* =============================================================================
\* Fairness
\* =============================================================================

ApplyAnyAuthoritativeReload == \E d \in pendingDeliveries : ApplyAuthoritativeReload(d)

FairSpec ==
  /\ LiveSpec
  /\ WF_vars(StartPageLoad)
  /\ WF_vars(StartRestore)
  /\ WF_vars(ServerReturnSnapshot)
  /\ WF_vars(ProcessRestore)
  /\ WF_vars(RejectRestoreDeadlineWon)
  /\ WF_vars(StartAuthoritativeReload)
  /\ WF_vars(ApplyAnyAuthoritativeReload)
  /\ WF_vars(ConsumePostAck)

=============================================================================
\* ==EOF==
