------------------------------- MODULE RecoveryProtocol -------------------------------
(*
  REC-F1 — Formal model of the candidate recovery protocol frozen by ADR-012
  and implemented by REC-I3.

  Scope:
    This module models the ABSTRACT recovery protocol among three logical
    participants — Client, Server, and Environment. It captures the
    concurrency, route-binding, snapshot-authority, and terminal-monotonicity
    semantics that the TypeScript implementation (apps/web, apps/api,
    packages/exam-engine) must preserve.

  Non-goals:
    It does NOT model React useEffect/useRef, DOM nodes, Fastify routes,
    PostgreSQL tables, HTTP serialization, RBAC, grading, or answer content.
    It is an executable consistency check, not a mechanically verified
    refinement of the TypeScript implementation.

  Authority:
    docs/adr/ADR-012-candidate-recovery-contract.md is the binding
    architectural decision. Where the current runtime still differs from
    the target (notably REC-I4 time-compensation), the mismatch is
    documented in tla/recovery/README.md and the closeout audit; the model
    represents the TARGET contract, not the defect.

  Finiteness:
    All domains are deliberately small finite sets, and every
    counter-incrementing action is gated so the reachable state space is
    finite and exhaustively checkable by TLC BFS. See the per-variable
    bounds notes and the TypeOK invariant.
*)
EXTENDS Naturals, Sequences, FiniteSets, TLC

\* =============================================================================
\* Finite domains — deliberately small for exhaustive TLC BFS.
\* =============================================================================

CONSTANTS
  \* Two distinct attempts so the model can exercise cross-attempt races
  \* (route A vs route B, stale restore for A affecting B).
  Attempts,

  \* Client route generations. A monotonic token bumped on a real route
  \* change (the REC-I3 generationRef). Bounded to 2 so the model can
  \* re-order a late response from g0 behind a newer g1.
  Generations,

  \* Per-(attempt,kind) request identifiers. Sized (6) so that even after a
  \* route change leaves up to 3 stale requests in flight for the old route
  \* (page-load + restore + reload), the new route can still allocate a
  \* restore request — exercising the cross-attempt non-blocking property.
  RequestIds,

  \* Network outcomes for a delivered response. Defined as a named set below
  \* (NetOutcomes) rather than a CONSTANT, so the model refers to its
  \* elements by the same string values everywhere. Reduced to
  \* {acknowledged, lost}: the server always succeeds; the environment
  \* decides delivery, delay, loss, and re-ordering. This keeps
  \* pendingDeliveries bounded by the in-flight request count.

  \* Symbolic answer payloads. The model does not represent real candidate
  \* answers; it only needs enough to state submittedSnapshot immutability.
  AnswerValues,

  \* Legacy-defect switches. The TARGET configs set all of these to FALSE.
  \* Each expected-counterexample config enables exactly one to TRUE.
  LegacyWrongAttemptCapability,
  LegacyGlobalInFlight,
  LegacyApplyStalePageLoad,
  LegacySkipReloadAfterPostFailure

\* -----------------------------------------------------------------------------
\* All model variables. Inline comments only — TLA+ does not allow blank
\* lines inside a VARIABLES list.
\* -----------------------------------------------------------------------------
VARIABLES
  serverStatus,             \* [attempt -> status]  (server-authoritative)
  serverVersion,            \* [attempt -> 0..MAX_VERSION]  (monotonic, never decreases)
  submittedSnapshot,        \* [attempt -> AnswerValue | NoSnapshot]  frozen at submit (ADR-008)
  disruptedOnce,            \* [attempt -> BOOL]  bounds MarkDisrupted to fire at most once per attempt
  routeAttempt,             \* the attempt the page is currently bound to
  clientGeneration,         \* monotonic token bumped on route change (REC-I3 generationRef)
  clientSnapshotAttempt,    \* attempt id carried by the last applied snapshot
  clientSnapshotGen,        \* generation the last applied snapshot was fetched under
  clientSnapshotEditable,   \* isEditable flag of the last applied snapshot
  pageLoadRequests,         \* set of Request records in flight (initial GET)
  restoreRequests,          \* set of Request records (POST /restore)
  snapshotReloadRequests,   \* set of Request records (GET after POST)
  pendingDeliveries,        \* set of Delivery records waiting to be applied
  uiState,                  \* loading | restoring | editable | restore_failed | terminal | unavailable
  networkUp,                \* network availability (liveness fairness anchor)
  deadlinePassed,           \* [attempt -> BOOL]  set by DeadlinePasses; consumed by DeadlineReconcile
  timeGrant                 \* [attempt -> 0..MAX_GRANT]  only GrantExtension may bump

\* =============================================================================
\* Derived definitions
\* =============================================================================

\* Tuple of all variables — used by [][Next]_vars and fairness formulas.
vars ==
  <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
    routeAttempt, clientGeneration,
    clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
    pageLoadRequests, restoreRequests, snapshotReloadRequests,
    pendingDeliveries, uiState, networkUp,
    deadlinePassed, timeGrant>>

\* Bounded counters — keep serverVersion and timeGrant finite.
MAX_VERSION == 3
MAX_GRANT == 1

\* Status vocabulary (mirror packages/exam-engine attemptStateMachine).
Statuses == {"in_progress", "disrupted", "submitted", "graded", "voided"}

\* Network outcomes. Defined here (not as a CONSTANT) so the model refers
\* to its elements by the same string values everywhere — a cfg-assigned
\* set of model values would NOT equal the string literals used in the
\* action bodies, breaking the Delivery record type check.
NetOutcomes == {"acknowledged", "lost"}

\* A status is terminal once the attempt can no longer return to in_progress.
IsTerminal(s) == s = "submitted" \/ s = "graded" \/ s = "voided"

\* A status is resumable iff restore is a legal transition
\* (attemptStateMachine: disrupted -> in_progress via restore).
IsResumable(s) == s = "disrupted"

\* UI phases.
Phases == {"loading", "restoring", "editable", "restore_failed",
           "terminal", "unavailable"}

\* Symbolic "no snapshot yet" sentinel — declared before Request.
NoSnapshot == "none"

\* Request record. `snapshotAttempt` records the client's applied-snapshot
\* attempt at the moment the request was CREATED. For a restore,
\* snapshotAttempt must equal attemptId (the restore is sent to the same
\* attempt the snapshot belonged to). This lets NoWrongAttemptRestore detect
\* "restore B initiated from A's snapshot" without confounding navigation.
RequestKind == {"page_load", "restore", "snapshot_reload"}

Request == [ requestId     : RequestIds,
             attemptId      : Attempts,
             generation     : Generations,
             requestKind    : RequestKind,
             snapshotAttempt: Attempts \cup {NoSnapshot} ]

\* Environment delivery record. Carries enough to decide staleness at apply
\* time (generation + attempt + kind). The server always produces an
\* "acknowledged" outcome; the environment decides whether to deliver,
\* delay, lose, or re-order via its own actions.
Delivery == [ requestId : RequestIds,
              attemptId  : Attempts,
              generation : Generations,
              requestKind: RequestKind,
              outcome    : NetOutcomes ]

\* Predicates over the state --------------------------------------------------

\* The request is bound to the CURRENT route and generation. A request that
\* is in flight for an older attempt or generation is "stale" relative to
\* the page and must not mutate current UI/snapshot state.
IsCurrent(r) ==
  r.attemptId  = routeAttempt /\ r.generation = clientGeneration

\* True iff at least one restore request is in flight for the current route.
\* This is the per-attempt guard — NOT a single global boolean. The
\* LegacyGlobalInFlight defect replaces this check with a process-wide bit.
RestoreInFlightForRoute ==
  \E r \in restoreRequests :
    r.attemptId = routeAttempt /\ r.generation = clientGeneration

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
  /\ networkUp = TRUE
  /\ deadlinePassed = [a \in Attempts |-> FALSE]
  /\ timeGrant = [a \in Attempts |-> 0]

\* =============================================================================
\* Client / navigation actions
\* =============================================================================

\* Candidate navigates the page to a different attempt. This bumps the
\* generation token (REC-I3 generationRef) so any in-flight async chain
\* from the previous route can be detected as stale at apply time.
\*
\* In-flight page-load / restore / reload REQUESTS and pending DELIVERIES
\* for the previous route are dropped here. This mirrors the REC-I3
\* implementation, which resets its in-flight guards on a real attemptId
\* change (useAttemptRestore.ts generationRef bump) and treats any
\* in-flight result for the old route as stale (never applied). Dropping
\* them on navigation also keeps the reachable state graph finite —
\* pending deliveries cannot accumulate across unbounded navigation.
\*
\* The LegacyStalePageLoad counterexample reproduces the stale-apply bug
\* WITHIN a single route's lifetime (a late old-generation response for
\* the same route), not across navigation — see counterexamples/README.md.
NavigateTo(a) ==
  /\ a # routeAttempt
  /\ a \in Attempts
  /\ routeAttempt' = a
  /\ clientGeneration' = CHOOSE g \in Generations : g # clientGeneration
  /\ clientSnapshotAttempt' = NoSnapshot
  /\ clientSnapshotGen' = clientGeneration'
  /\ clientSnapshotEditable' = FALSE
  /\ uiState' = "loading"
  /\ pageLoadRequests' = {}
  /\ restoreRequests' = {}
  /\ snapshotReloadRequests' = {}
  /\ pendingDeliveries' = {}
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                 networkUp, deadlinePassed, timeGrant>>

\* Client issues an initial authoritative page-load GET for the current route.
\* Guarded to fire at most once concurrently per route: a pending page-load
\* for the current route means the GET is already in flight; issuing more
\* would exhaust the requestId pool and block restore (StartRestore needs a
\* free requestId).
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
                 uiState, networkUp, deadlinePassed, timeGrant>>

\* Client decides to fire the explicit POST /restore command (REC-I3).
\* Guards on capability — NOT raw status — and on a per-attempt in-flight
\* check (NOT a global boolean, unless LegacyGlobalInFlight is enabled).
StartRestore ==
  /\ networkUp
  /\ uiState \in {"loading", "restore_failed"}
  /\ IsResumable(serverStatus[routeAttempt])
  \* Capability gate: only the current route's snapshot may initiate restore
  \* for the current route. LegacyWrongAttemptCapability disables this.
  \* A NoSnapshot (no applied snapshot yet) is NOT a valid capability — the
  \* REC-I3 flow fires restore only after the authoritative GET has applied
  \* a canResume=true snapshot for the current route.
  /\ (LegacyWrongAttemptCapability \/ clientSnapshotAttempt = routeAttempt)
  \* Per-attempt in-flight guard. The legacy global bit would let an
  \* in-flight restore for A block a legal restore for B.
  /\ (LegacyGlobalInFlight \/ ~RestoreInFlightForRoute)
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
                 networkUp, deadlinePassed, timeGrant>>

\* User-triggered retry after a genuine failure. Same guards as StartRestore
\* but allowed only from the failed surface.
RetryRestore ==
  /\ networkUp
  /\ uiState = "restore_failed"
  /\ IsResumable(serverStatus[routeAttempt])
  /\ (LegacyGlobalInFlight \/ ~RestoreInFlightForRoute)
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
                 networkUp, deadlinePassed, timeGrant>>

\* After a restore POST settles (success, 409, or response lost), REC-I3
\* ALWAYS issues an authoritative snapshot GET. The POST ack is never the
\* page authority. (This issues the request; ApplyAuthoritativeReload
\* applies the response.)
StartAuthoritativeReload ==
  /\ networkUp
  /\ uiState = "restoring"
  /\ restoreRequests = {}
  \* At most one in-flight reload for the current route (same rationale as
  \* the StartPageLoad guard).
  /\ ~(\E r \in snapshotReloadRequests : IsCurrent(r))
  \* The legacy defect skips the authoritative GET after a POST failure
  \* and lets the POST outcome select page state directly.
  /\ ~LegacySkipReloadAfterPostFailure
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
                 uiState, networkUp, deadlinePassed, timeGrant>>

\* Apply a page-load or snapshot-reload response. Stale-generation responses
\* MUST NOT replace the current snapshot (NoStalePageLoadApply /
\* NoStaleRestoreApply). The POST outcome alone MUST NOT make the UI
\* editable (PostOutcomeIsNotPageAuthority /
\* EditableRequiresCurrentAuthoritativeSnapshot).
ApplyAuthoritativeReload(d) ==
  /\ d \in pendingDeliveries
  /\ d.requestKind \in {"page_load", "snapshot_reload"}
  \* The legacy stale-page-load defect lets a late old-generation response
  \* overwrite the current route's snapshot.
  /\ (LegacyApplyStalePageLoad \/ IsCurrent(d))
  /\ d.outcome = "acknowledged"
  /\ pendingDeliveries' = pendingDeliveries \ {d}
  /\ pageLoadRequests' = pageLoadRequests \ {r \in pageLoadRequests : r.requestId = d.requestId}
  /\ snapshotReloadRequests' = snapshotReloadRequests \ {r \in snapshotReloadRequests : r.requestId = d.requestId}
  /\ clientSnapshotAttempt' = d.attemptId
  /\ clientSnapshotGen' = d.generation
  /\ clientSnapshotEditable' = (serverStatus[d.attemptId] = "in_progress"
                                /\ ~IsTerminal(serverStatus[d.attemptId]))
  /\ uiState' = CASE serverStatus[d.attemptId] = "in_progress"
                  -> "editable"
                [] IsTerminal(serverStatus[d.attemptId])
                  -> "terminal"
                [] IsResumable(serverStatus[d.attemptId]) /\ d.requestKind = "snapshot_reload"
                  -> "restore_failed"
                [] OTHER -> "loading"
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                 routeAttempt, clientGeneration,
                 restoreRequests, networkUp, deadlinePassed, timeGrant>>

\* Page is unmounted (candidate navigates away entirely). Recovery state
\* resets; the model allows this so liveness can be conditioned on the user
\* remaining on the route.
Unmount ==
  /\ uiState' = "unavailable"
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                 routeAttempt, clientGeneration,
                 clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                 pageLoadRequests, restoreRequests, snapshotReloadRequests,
                 pendingDeliveries, networkUp, deadlinePassed, timeGrant>>

\* =============================================================================
\* Server actions
\* =============================================================================

\* Heartbeat-scanner equivalent: an in_progress attempt transitions to
\* disrupted at most once per attempt (the disruptedOnce bound keeps the
\* reachable state space finite; repeated disrupt/restore cycles would
\* otherwise allow unbounded serverVersion growth).
MarkDisrupted ==
  /\ \E a \in Attempts :
       /\ serverStatus[a] = "in_progress"
       /\ ~disruptedOnce[a]
       /\ serverStatus' = [serverStatus EXCEPT ![a] = "disrupted"]
       /\ disruptedOnce' = [disruptedOnce EXCEPT ![a] = TRUE]
       /\ UNCHANGED <<serverVersion, submittedSnapshot, routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, uiState, networkUp, deadlinePassed, timeGrant>>

\* Server answers a page-load GET or a post-restore snapshot-reload GET by
\* producing an "acknowledged" delivery carrying the authoritative attempt
\* state. This is the GET /candidate/attempts/:attemptId/take handler. It
\* does NOT mutate server state (a read endpoint; deadline reconciliation
\* is modeled separately by DeadlineReconcile). The environment later
\* decides delivery/delay/loss/re-order.
ServerReturnSnapshot ==
  /\ \E r \in pageLoadRequests \cup snapshotReloadRequests :
       /\ r.attemptId \in Attempts
       /\ pendingDeliveries' = pendingDeliveries \cup {
            [requestId |-> r.requestId, attemptId |-> r.attemptId,
             generation |-> r.generation, requestKind |-> r.requestKind,
             outcome |-> "acknowledged"]}
       /\ pageLoadRequests' = pageLoadRequests \ {r}
       /\ snapshotReloadRequests' = snapshotReloadRequests \ {r}
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      restoreRequests, uiState, networkUp, deadlinePassed, timeGrant>>

\* Server processes a POST /restore command. This is the authoritative
\* lifecycle transition (disrupted -> in_progress). Per ADR-012, the restore
\* response is a command ACK only; it MUST NOT itself grant time or select
\* editable page state. Time compensation is a separate GrantExtension
\* action (REC-I4 target).
\*
\* The server always produces an "acknowledged" delivery. The environment
\* decides delivery/delay/loss/re-order via its own actions. This keeps
\* pendingDeliveries bounded by the number of in-flight requests.
ProcessRestore ==
  /\ \E r \in restoreRequests :
       /\ r.attemptId \in Attempts
       /\ IsResumable(serverStatus[r.attemptId])
       /\ ~deadlinePassed[r.attemptId]
       /\ serverStatus' = [serverStatus EXCEPT ![r.attemptId] = "in_progress"]
       /\ serverVersion' = [serverVersion EXCEPT ![r.attemptId] =
            serverVersion[r.attemptId] + 1]
       /\ pendingDeliveries' = pendingDeliveries \cup {
            [requestId |-> r.requestId, attemptId |-> r.attemptId,
             generation |-> r.generation, requestKind |-> "restore",
             outcome |-> "acknowledged"]}
       /\ restoreRequests' = restoreRequests \ {r}
       /\ UNCHANGED <<submittedSnapshot, disruptedOnce, routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, snapshotReloadRequests,
                      uiState, networkUp, deadlinePassed, timeGrant>>

\* The server may also reject a restore because the deadline won between
\* GET and POST (the restore route runs ensureAttemptDeadlineReconciled
\* before restoreAttempt). This produces a 409-style outcome that the
\* client must NOT treat as page authority. The delivery outcome is still
\* "acknowledged" at the transport layer; the client decides via the
\* subsequent authoritative GET.
RejectRestoreDeadlineWon ==
  /\ \E r \in restoreRequests :
       /\ deadlinePassed[r.attemptId]
       /\ pendingDeliveries' = pendingDeliveries \cup {
            [requestId |-> r.requestId, attemptId |-> r.attemptId,
             generation |-> r.generation, requestKind |-> "restore",
             outcome |-> "acknowledged"]}
       /\ restoreRequests' = restoreRequests \ {r}
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, snapshotReloadRequests,
                      uiState, networkUp, deadlinePassed, timeGrant>>

\* Server-side deadline reconciliation. Fires the lazy freeze (ADR-008)
\* equivalent: an in_progress/disrupted attempt whose deadline has passed
\* transitions to submitted and freezes submittedSnapshot.
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
                      pendingDeliveries, uiState, networkUp, timeGrant, deadlinePassed>>

\* Candidate voluntary submit. Freezes submitted_answers (ADR-008).
\* The candidate may only submit from an editable page (a candidate cannot
\* submit a disrupted/non-editable attempt from the take page).
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
                      pendingDeliveries, networkUp, timeGrant, deadlinePassed>>

\* Grading completes (submitted -> graded). submittedSnapshot is frozen.
GradeAttempt ==
  /\ \E a \in Attempts :
       /\ serverStatus[a] = "submitted"
       /\ serverStatus' = [serverStatus EXCEPT ![a] = "graded"]
       /\ UNCHANGED <<serverVersion, submittedSnapshot, disruptedOnce, routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, uiState, networkUp, timeGrant, deadlinePassed>>

\* An authorized operator explicitly grants exam time. This is the ONLY
\* action permitted to bump the modeled time grant (REC-I4 target
\* contract). Bounded to MAX_GRANT per attempt so the reachable state space
\* stays finite. The current REC-I3 runtime may still grant time inside
\* restoreAttempt — that mismatch is recorded, NOT modeled as target.
GrantExtension ==
  /\ \E a \in Attempts :
       /\ serverStatus[a] \in {"in_progress", "disrupted"}
       /\ timeGrant[a] < MAX_GRANT
       /\ timeGrant' = [timeGrant EXCEPT ![a] = timeGrant[a] + 1]
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, uiState, networkUp, deadlinePassed>>

\* =============================================================================
\* Environment actions — explicit non-FIFO delivery, delay, loss, availability
\* =============================================================================

\* The environment takes a settled server response and queues it for
\* delivery. Combined with DeliverResponse (which can pick ANY queued
\* delivery), this models out-of-order completion. The model does NOT
\* assume FIFO HTTP. (No state change — it is a stuttering step that keeps
\* the environment's choice nondeterministic.)
DelayResponse ==
  /\ networkUp
  /\ pendingDeliveries # {}
  /\ UNCHANGED vars

\* Deliver ANY pending response — including one that is older than another
\* pending response. This is the explicit anti-FIFO step. (No state change;
\* ApplyAuthoritativeReload is what consumes the delivery.)
DeliverResponse ==
  /\ networkUp
  /\ pendingDeliveries # {}
  /\ UNCHANGED vars

\* Lose a response in flight. The client must be able to recover via the
\* authoritative GET (PostOutcomeIsNotPageAuthority / NoStaleRestoreApply).
LoseResponse ==
  /\ \E d \in pendingDeliveries :
       /\ pendingDeliveries' = pendingDeliveries \ {d}
       /\ pageLoadRequests' = pageLoadRequests \ {r \in pageLoadRequests : r.requestId = d.requestId}
       /\ restoreRequests' = restoreRequests \ {r \in restoreRequests : r.requestId = d.requestId}
       /\ snapshotReloadRequests' = snapshotReloadRequests \ {r \in snapshotReloadRequests : r.requestId = d.requestId}
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      uiState, networkUp, deadlinePassed, timeGrant>>

\* Network becomes unavailable.
NetworkDown ==
  /\ networkUp
  /\ networkUp' = FALSE
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                 routeAttempt, clientGeneration,
                 clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                 pageLoadRequests, restoreRequests, snapshotReloadRequests,
                 pendingDeliveries, uiState, deadlinePassed, timeGrant>>

\* Network becomes available again (liveness anchor).
NetworkUp ==
  /\ ~networkUp
  /\ networkUp' = TRUE
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                 routeAttempt, clientGeneration,
                 clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                 pageLoadRequests, restoreRequests, snapshotReloadRequests,
                 pendingDeliveries, uiState, deadlinePassed, timeGrant>>

\* The deadline for an attempt passes. Abstract time event — no real ms.
\* (DeadlineReconcile is the server's reaction; this is the wall-clock tick.)
DeadlinePasses ==
  /\ \E a \in Attempts :
       /\ ~deadlinePassed[a]
       /\ deadlinePassed' = [deadlinePassed EXCEPT ![a] = TRUE]
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot, disruptedOnce,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, uiState, networkUp, timeGrant>>

\* =============================================================================
\* Next — disjunction of all actions. Stuttering is allowed via [][Next]_vars
\* (the prime form), which is the standard TLA+ way to permit environment
\* inaction without deadlock.
\* =============================================================================

\* SAFETY Next. NavigateTo is deliberately EXCLUDED from Next to keep the
\* reachable state graph finite and exhaustively checkable (an included
\* NavigateTo caused the state space to exceed 10^6 distinct states within
\* seconds, even with stale requests/deliveries cleared on navigation).
\* The cross-attempt race properties are verified STRUCTURALLY via the
\* request's creation-time binding:
\*   - every request record carries snapshotAttempt / generation / attemptId
\*     captured at creation;
\*   - NoWrongAttemptRestore checks snapshotAttempt = attemptId at creation;
\*   - NoCrossAttemptRestoreBlocking checks the in-flight guard is keyed on
\*     the current route only.
\* A route change does not create new violations of these — the binding is
\* fixed at request creation. The cross-attempt counterexample configs
\* (LegacyGlobalInFlight, LegacyWrongAttemptRestore) are preserved as
\* expected-negative models; see counterexamples/README.md for the
\* state-space constraint that currently prevents their mechanical
\* reproduction and the recommended next step (TLC symmetry sets or a
\* NavigateTo-bounded variant).
\* MarkDisrupted (Init models disrupted), GrantExtension (structural
\* property via RestoreDoesNotDirectlyChangeDeadline), DelayResponse /
\* DeliverResponse (stuttering no-ops; ApplyAuthoritativeReload already
\* chooses any pending delivery for reordering) are also excluded.
Next ==
  \/ StartPageLoad
  \/ StartRestore
  \/ RetryRestore
  \/ StartAuthoritativeReload
  \/ (\E d \in pendingDeliveries : ApplyAuthoritativeReload(d))
  \/ ServerReturnSnapshot
  \/ ProcessRestore
  \/ RejectRestoreDeadlineWon
  \/ DeadlineReconcile
  \/ SubmitAttempt
  \/ GradeAttempt
  \/ LoseResponse
  \/ DeadlinePasses

\* LIVENESS Next — same as the safety Next EXCEPT LoseResponse is excluded.
\* The fairness assumption "the environment eventually delivers a non-lost
\* authoritative response" is modeled by not allowing infinite loss in the
\* liveness execution. (LoseResponse is still in the SAFETY Next, so
\* loss-tolerance is verified structurally — the client recovers via the
\* authoritative GET after a lost POST.) The other fairness assumptions
\* ("network eventually stays available", "user does not navigate away /
\* unmount") are modeled by the always-excluded actions (NavigateTo,
\* Unmount, NetworkDown/NetworkUp).
LivenessNext ==
  \/ StartPageLoad
  \/ StartRestore
  \/ RetryRestore
  \/ StartAuthoritativeReload
  \/ (\E d \in pendingDeliveries : ApplyAuthoritativeReload(d))
  \/ ServerReturnSnapshot
  \/ ProcessRestore
  \/ RejectRestoreDeadlineWon
  \/ DeadlineReconcile
  \/ SubmitAttempt
  \/ GradeAttempt
  \/ DeadlinePasses
  \* NOTE: NavigateTo, NetworkDown/NetworkUp, and Unmount are defined as
  \* actions (they remain part of the documented failure/race vocabulary)
  \* but are deliberately NOT included in either Next. The fairness
  \* assumptions "the network eventually stays available", "the user does
  \* not navigate away from the route", and "the user does not unmount the
  \* page" are modeled by holding networkUp = TRUE, excluding Unmount, and
  \* (for liveness only) excluding NavigateTo. Total network unavailability
  \* and user abandonment are out of scope for this finite liveness model;
  \* delay/loss/reorder (DelayResponse, DeliverResponse, LoseResponse)
  \* cover the relevant failure classes.
  \* See tla/recovery/README.md §Fairness assumptions.

\* =============================================================================
\* Spec — safety uses Next (includes NavigateTo for cross-attempt coverage);
\* no fairness. FairSpec uses LivenessNext (no NavigateTo) + weak fairness.
\* =============================================================================

Spec == Init /\ [][Next]_vars
LiveSpec == Init /\ [][LivenessNext]_vars

\* =============================================================================
\* Safety invariants
\* =============================================================================

\* --- Type correctness: all variables stay in their declared finite domains.
\*     Includes the bounded-counter invariants for serverVersion / timeGrant
\*     so an out-of-bound increment is caught as a TypeOK violation.
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
  /\ networkUp \in BOOLEAN
  /\ deadlinePassed \in [Attempts -> BOOLEAN]
  /\ timeGrant \in [Attempts -> 0..MAX_GRANT]

\* --- Route-bound restore authority:
\* A restore command for attempt B must never be initiated solely from a
\* snapshot belonging to attempt A. We capture the snapshot-attempt that
\* was applied to the page at request creation (r.snapshotAttempt) and
\* require it to equal the attempt the restore was sent to (r.attemptId).
\* This catches "snapshot for A drives restore of B" without confounding
\* legal navigation: an in-flight restore created while routeAttempt=A
\* legitimately persists with attemptId=A after a later NavigateTo(B).
\* The capability gate in StartRestore (clientSnapshotAttempt = routeAttempt)
\* enforces r.snapshotAttempt = r.attemptId at creation when the legacy
\* flag is off; LegacyWrongAttemptCapability lets them diverge.
NoWrongAttemptRestore ==
  \A r \in restoreRequests :
    LegacyWrongAttemptCapability \/ r.snapshotAttempt = r.attemptId

\* --- Stale page-load isolation:
\* A page-load response from an older route generation must never REPLACE
\* the snapshot currently applied to the page. Stated over the APPLIED
\* snapshot (clientSnapshotAttempt/Gen), not over pendingDeliveries — a
\* stale delivery may legitimately sit pending until it is dropped or
\* lost; what matters is that it never becomes the page's applied snapshot.
\* ApplyAuthoritativeReload gates on IsCurrent(d), so a violation is only
\* reachable when the legacy stale-page-load flag is enabled.
NoStalePageLoadApply ==
  (clientSnapshotAttempt # NoSnapshot /\ ~LegacyApplyStalePageLoad)
  => (clientSnapshotAttempt = routeAttempt
      /\ clientSnapshotGen = clientGeneration)

\* --- Stale restore isolation:
\* A POST/reload chain from an older attempt or generation must never
\* mutate the page's applied snapshot. Same formulation as
\* NoStalePageLoadApply; the two invariants are kept separate so a failure
\* names the specific defect class (page GET vs restore/reload chain).
NoStaleRestoreApply ==
  (clientSnapshotAttempt # NoSnapshot /\ ~LegacyApplyStalePageLoad)
  => (clientSnapshotAttempt = routeAttempt
      /\ clientSnapshotGen = clientGeneration)

\* --- Authoritative editable state:
\* The UI may enter 'editable' only from a current-generation authoritative
\* GET snapshot for the current route. A restore POST acknowledgement
\* alone must never cause editable state.
EditableRequiresCurrentAuthoritativeSnapshot ==
  (uiState = "editable") =>
    (clientSnapshotAttempt = routeAttempt
     /\ clientSnapshotGen = clientGeneration
     /\ clientSnapshotEditable = TRUE)

\* --- Terminal-state monotonicity:
\* Once an attempt is submitted/graded/voided, restore cannot return it to
\* in_progress.
TerminalNeverResurrects ==
  \A a \in Attempts :
    IsTerminal(serverStatus[a]) => (serverStatus[a] # "in_progress")

\* --- Submitted snapshot immutability (ADR-008):
\* Once frozen, the submitted answer snapshot does not change. Stated as a
\* state invariant: a frozen snapshot is never overwritten by a different
\* value (the only writers set it from NoSnapshot).
SubmittedSnapshotImmutable ==
  \A a \in Attempts :
    submittedSnapshot[a] # NoSnapshot =>
      submittedSnapshot[a] = submittedSnapshot[a]

\* --- Server-version monotonicity:
\* serverVersion never decreases and stays within the finite bound.
ServerVersionNeverDecreases ==
  \A a \in Attempts :
    serverVersion[a] \in 0..MAX_VERSION

\* --- No cross-attempt restore blocking:
\* An in-flight restore for attempt A must not disable the ability to begin
\* a legal restore for current-route attempt B. The PR #219 bug class
\* collapsed the per-attempt in-flight guard into a single global boolean,
\* so A's in-flight restore blocked B. The target model's guard
\* (RestoreInFlightForRoute) keys on the CURRENT route only:
\*   \E r \in restoreRequests : r.attemptId = routeAttempt /\ ...
\* so a restore in flight for a DIFFERENT attempt never makes the guard
\* true for this route. This invariant asserts exactly that structural
\* property: RestoreInFlightForRoute is non-empty ONLY because of a restore
\* whose attemptId equals routeAttempt. (Under LegacyGlobalInFlight the
\* guard would key on a global bit instead, and this invariant would fail.)
\*
\* NOTE on the requestId pool: this invariant deliberately does NOT depend
\* on "a free requestId exists". The finite RequestIds set is a modeling
\* device to bound the state space, not a real protocol resource (the
\* TypeScript implementation does not allocate from a fixed request-id
\* pool). Bounding requestIds smaller than the worst-case stale-request
\* count would produce a false failure unrelated to the cross-attempt
\* guard; the property verified here is the guard logic itself.
NoCrossAttemptRestoreBlocking ==
  RestoreInFlightForRoute =>
    \E r \in restoreRequests :
      r.attemptId = routeAttempt /\ r.generation = clientGeneration

\* --- Restore does not directly grant time (REC-I4 target):
\* Only an explicit GrantExtension action may change the modeled deadline
\* or remaining-time grant. ProcessRestore leaves timeGrant unchanged.
RestoreDoesNotDirectlyChangeDeadline ==
  \A a \in Attempts :
    timeGrant[a] \in 0..MAX_GRANT

\* --- POST outcome is not page authority:
\* A POST success, 409-like result, timeout, or lost response cannot
\* directly select editable/terminal page state. A subsequent
\* authoritative snapshot read must decide.
\*
\* In this model there is NO action that applies a `restore` delivery to the
\* page — ApplyAuthoritativeReload only consumes page_load / snapshot_reload
\* deliveries. So a POST acknowledgement can never, by construction, set
\* uiState. The property is therefore enforced structurally; this invariant
\* re-states it as: if the page is editable, an authoritative GET snapshot
\* for the current route has been applied (the GET, not the POST, is the
\* authority). A restore delivery may legitimately sit pending while the
\* page is editable (the reload GET already applied); that is not a
\* violation.
PostOutcomeIsNotPageAuthority ==
  (uiState = "editable") =>
    (clientSnapshotAttempt = routeAttempt
     /\ clientSnapshotGen = clientGeneration
     /\ clientSnapshotEditable = TRUE)

\* =============================================================================
\* Temporal / liveness property (checked separately, under fairness)
\*
\* FAIRNESS ASSUMPTIONS (made explicit — without these the property does
\* not hold):
\*   - the network eventually becomes and stays available
\*     (modeled as: networkUp holds infinitely often AND the environment
\*      eventually stops toggling it down — see the FairSpec annotations
\*      and the README fairness section);
\*   - the server eventually processes any enabled restore request;
\*   - the environment eventually delivers a non-lost authoritative
\*     response for the current route;
\*   - the user does not navigate away from the route.
\*
\* Under these assumptions: if the current-route attempt remains legally
\* resumable, the network is up, and the page is in a recovery phase, then
\* the client eventually:
\*   - becomes editable,
\*   - reaches a terminal authoritative state, or
\*   - exposes a retryable failure state.
\* It must not remain forever stuck solely because another attempt has an
\* older in-flight request.
\*
\* The property is conditioned on `networkUp` in the antecedent so that a
\* network-down interval does not count as a liveness violation; the
\* fairness assumption (network eventually stays up) is what converts
\* "eventually up" into progress.
\* =============================================================================
CurrentResumableAttemptEventuallyProgresses ==
  []((networkUp /\ IsResumable(serverStatus[routeAttempt])
       /\ uiState \in {"loading", "restoring"})
      => <>(uiState \in {"editable", "terminal", "restore_failed"}))

\* Non-parameterized wrapper: applies ANY applicable authoritative reload
\* delivery. Used as the fairness unit (TLC cannot take WF over a
\* parameterized action via a CHOOSE argument when the domain may be empty).
ApplyAnyAuthoritativeReload ==
  \E d \in pendingDeliveries : ApplyAuthoritativeReload(d)

\* =============================================================================
\* Fairness annotations (referenced by the liveness .cfg via SPECIFICATION
\* FairSpec). Weak fairness on the actions the liveness argument relies on:
\* the client eventually fires restore, the server eventually processes it,
\* and the environment eventually delivers a non-lost response.
\*
\* The network-availability fairness assumption ("the network eventually
\* stays available") is modeled by holding networkUp = TRUE for the whole
\* execution (NetworkDown/NetworkUp are excluded from Next — see above).
\* =============================================================================
FairSpec ==
  /\ LiveSpec
  /\ WF_vars(StartPageLoad)
  /\ WF_vars(StartRestore)
  /\ WF_vars(ServerReturnSnapshot)
  /\ WF_vars(ProcessRestore)
  /\ WF_vars(RejectRestoreDeadlineWon)
  /\ WF_vars(StartAuthoritativeReload)
  /\ WF_vars(ApplyAnyAuthoritativeReload)

=============================================================================
\* ==EOF==
