------------------------------- MODULE RecoveryProtocol -------------------------------
(*
  REC-F1 — Formal model of the candidate recovery protocol frozen by ADR-012
  and implemented by REC-I3, conformed to the frozen Exam semantic
  authority (docs/architecture/exam-semantic-boundaries.md, EXSEM-001..020,
  adopted by ADR-021).

  Scope:
    Abstract recovery protocol among Client, Server, Environment. Captures
    concurrency, route-binding, snapshot-authority, terminal-monotonicity,
    and canonical effective-deadline semantics (EXSEM-011/013/014) that the
    TypeScript implementation must preserve.

  Policy scope (binding):
    The recovery timeline modeled here covers candidate recovery safety for
    the strict and operator_incident interruption-timing policies: the
    canonical deadline is monotone once passed, and only an explicit restore
    command can resume a disrupted attempt.
    It does NOT verify bounded_grace compensation reachability. Under
    bounded_grace, an authorized time adjustment may extend the effective
    deadline before final reconciliation and therefore rescue an
    interruption that was already expired pre-adjustment. That reachability
    class (a deadline that is NOT monotone across the rescue window) is
    intentionally outside this model; modeling it would require its own
    state machine owned by the ADR-013 §5/§7 bounded-compensation semantics.
    Properties in this TLA+ family must not be interpreted as proofs
    covering every candidate interruption-time policy.

  Effective-state conformance (EXSEM-013/014):
    deadlinePassed is the canonical server-time fact (EXSEM-011). Stored
    status may lag it — lazy materialization is legal (EXSEM-013) — but
    every state-sensitive server decision in this model evaluates or
    reconciles the canonical effective state first (EXSEM-014), mirroring
    the production command paths, which reconcile inside their
    transactions:
      - candidate GET (ServerReturnSnapshot) serves from reconciled state;
      - candidate submit (SubmitAttempt) is guarded against canonical
        expiry — an expired attempt is frozen by deadline authority, never
        candidate authority;
      - a deadline-won restore (RejectRestoreDeadlineWon) materializes the
        terminal deadline outcome instead of leaving disrupted+expired.
    DeadlinePasses models canonical time crossing only: it records the
    canonical fact and materializes nothing. The client runtime may
    subsequently notice the deadline and trigger auto-submit asynchronously
    (flush → POST /submit → server reconciliation → authoritative reload),
    and that workflow is not collapsed into DeadlinePasses. Stored status —
    and the page projection derived from the last authoritative snapshot —
    may therefore lag canonical expiry. That lag is not an authority: a
    candidate submit of an expired attempt is never legal, and an
    authoritative response produced after canonical expiry is
    reconciled/terminal before it is served.

  Non-goals:
    Does NOT model React/DOM/Fastify/PostgreSQL/HTTP serialization/RBAC/
    grading/answer content, numeric time or grant arithmetic, or
    bounded_grace compensation. It is an executable consistency check, not
    a mechanically verified refinement. Operator time grants are owned by
    the separate formal/tla/operator-grant/ family (ADR-013 §8/§9); this
    model deliberately contains no grant mechanism.

  Authority:
    docs/adr/ADR-012-candidate-recovery-contract.md (restore flow) and
    docs/architecture/exam-semantic-boundaries.md (EXSEM-011/013/014
    effective-state and freeze semantics, adopted by ADR-021) are binding.

  Finiteness:
    All domains are small finite sets. Counters are bounded. NavigateTo is
    included (it is the core of the cross-attempt race being modeled) and
    bounded via small RequestIds + server-side consumption (ProcessRestore /
    ServerReturnSnapshot remove in-flight requests).

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
  deadlinePassed            \* [attempt -> BOOL]  canonical server-time fact (EXSEM-011)

\* =============================================================================
\* Derived definitions
\* =============================================================================

vars ==
  <<serverStatus, serverVersion, submittedSnapshot,
    routeAttempt, clientGeneration,
    clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
    pageLoadRequests, restoreRequests, snapshotReloadRequests,
    pendingDeliveries, uiState, lastSnapshotViaGet,
    deadlinePassed>>

MAX_VERSION == 3
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
\* Canonical deadline reconciliation (EXSEM-013/014)
\* =============================================================================

\* Canonical expiry of a not-yet-terminal attempt: stored status lags the
\* canonical deadline inside the lazy-materialization window.
DeadlineExpiredFor(a) ==
  deadlinePassed[a] /\ serverStatus[a] \in {"in_progress", "disrupted"}

\* The shared deadline-reconciliation effect: materialize the canonical
\* terminal outcome — status submitted, answers frozen once, server version
\* advanced. Used by every site that terminalizes a deadline-won attempt
\* (DeadlineReconcile, the GET handler, the deadline-won restore rejection)
\* so they cannot diverge. It is deliberately NOT applied by DeadlinePasses:
\* canonical time crossing materializes nothing.
\* OWNERSHIP: the caller must establish the not-yet-terminal precondition
\* (serverStatus[a] \in {"in_progress","disrupted"}), which is exactly
\* submittedSnapshot[a] = NoSnapshot — the freeze is first-and-only, so
\* SubmittedSnapshotImmutable is preserved.
DeadlineReconcileEffect(a) ==
  /\ serverStatus' = [serverStatus EXCEPT ![a] = "submitted"]
  /\ submittedSnapshot' = [submittedSnapshot EXCEPT ![a] =
       CHOOSE v \in AnswerValues : TRUE]
  /\ serverVersion' = [serverVersion EXCEPT ![a] = serverVersion[a] + 1]

\* Effective status a server command serves for an attempt after canonical
\* deadline reconciliation: an expired, not-yet-terminal attempt is served
\* terminal (production builds the GET snapshot from the reconciled row and
\* derives isEditable from status + canonical deadline jointly).
ReconciledServeStatus(a) ==
  IF DeadlineExpiredFor(a) THEN "submitted" ELSE serverStatus[a]

\* =============================================================================
\* Init
\* =============================================================================

Init ==
  /\ serverStatus = [a \in Attempts |-> "disrupted"]
  /\ serverVersion = [a \in Attempts |-> 0]
  /\ submittedSnapshot = [a \in Attempts |-> NoSnapshot]
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
  /\ deadlinePassed = [a \in Attempts |-> FALSE]

\* =============================================================================
\* Helper: build a delivery freezing the effective server state for an
\* attempt. The caller passes the post-reconciliation served status
\* (ReconciledServeStatus, or the post-command status for restore ACKs), so
\* a canonically expired attempt is never served editable.
\* =============================================================================

MakeDelivery(rid, r, servedStatus) ==
  [requestId |-> rid, attemptId |-> r.attemptId, generation |-> r.generation,
   requestKind |-> r.requestKind, outcome |-> "acknowledged",
   statusAtResponse |-> servedStatus,
   editableAtResponse |-> (servedStatus = "in_progress")]

\* =============================================================================
\* Client / navigation actions
\* =============================================================================

\* NavigateTo bumps the generation token, making old requests stale. In-flight
\* requests are NOT cleared: the real implementation does not cancel old POSTs;
\* they may still settle on the server and the generation/route guard rejects
\* them at apply time. This is the cross-attempt race the model exists to
\* verify. The legacy-defect switch affects ONLY the guard (RestoreStartGuard),
\* NOT navigation behavior — ensuring a clean A/B comparison where both models
\* face the same reachable state and differ only in guard logic.
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
  /\ restoreRequests' = restoreRequests
  /\ snapshotReloadRequests' = {}
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot,
                 pendingDeliveries, deadlinePassed>>

StartPageLoad ==
  /\ uiState = "loading"
  /\ ~(\E r \in pageLoadRequests : IsCurrent(r))
  /\ \E rid \in RequestIds :
       /\ rid \notin {r.requestId : r \in pageLoadRequests \cup restoreRequests
                                          \cup snapshotReloadRequests}
       /\ pageLoadRequests' = pageLoadRequests \cup {
           [requestId |-> rid, attemptId |-> routeAttempt,
            generation |-> clientGeneration, requestKind |-> "page_load",
            snapshotAttempt |-> clientSnapshotAttempt]}
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot,
                 routeAttempt, clientGeneration,
                 clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                 restoreRequests, snapshotReloadRequests, pendingDeliveries,
                 uiState, lastSnapshotViaGet, deadlinePassed>>

\* StartRestore. Capability gate uses clientSnapshotAttempt = routeAttempt
\* under the TARGET; the legacy flag disables that check, allowing a restore
\* for B to be initiated from A's snapshot (NoWrongAttemptRestore violation).
\* The in-flight guard uses RestoreStartGuard (per-attempt target / global
\* legacy).
StartRestore ==
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
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot,
                 routeAttempt, clientGeneration,
                 clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                 pageLoadRequests, snapshotReloadRequests, pendingDeliveries,
                 lastSnapshotViaGet, deadlinePassed>>

RetryRestore ==
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
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot,
                 routeAttempt, clientGeneration,
                 clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                 pageLoadRequests, snapshotReloadRequests, pendingDeliveries,
                 lastSnapshotViaGet, deadlinePassed>>

\* REC-I3 always issues an authoritative GET after the POST settles. The
\* legacy flag skips it (LegacyApplyPostOutcome then drives UI from the POST).
StartAuthoritativeReload ==
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
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot,
                 routeAttempt, clientGeneration,
                 clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                 pageLoadRequests, restoreRequests, pendingDeliveries,
                 uiState, lastSnapshotViaGet, deadlinePassed>>

\* Apply a page-load / snapshot-reload response. Reads the FROZEN server
\* state carried by the delivery — and ONLY that. Under TARGET, a stale
\* delivery (not current route/generation) is rejected. Under the legacy
\* flag, a stale delivery may be applied — the buggy behavior the property
\* catches.
\* Apply time deliberately consults neither live server state nor the
\* canonical clock: an applied CandidateTakeSnapshot is the page's business
\* authority until another authoritative server response replaces it.
\* A response produced before expiry may therefore be applied after the
\* canonical deadline has crossed and still render editable — an allowed
\* transient UI lag, not a grant of mutation authority. Convergence comes
\* from the server paths (submit is deadline-guarded, a new GET reconciles
\* before serving, the scanner converges durable state), never from
\* client-side reconstruction of business lock state.
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
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot,
                 routeAttempt, clientGeneration,
                 restoreRequests, deadlinePassed>>

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
  /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot,
                 routeAttempt, clientGeneration,
                 pageLoadRequests, snapshotReloadRequests, restoreRequests,
                 deadlinePassed>>

\* =============================================================================
\* Server actions
\* =============================================================================

\* GET handler: a command-style GET with side effects — production reconciles
\* the canonical deadline inside a locked transaction BEFORE building the
\* snapshot. Serving an expired, not-yet-terminal attempt first materializes
\* the terminal deadline outcome via the shared reconciliation effect, then
\* freezes the delivery from the reconciled status; an expired attempt is
\* never served editable. Capped by MAX_DELIVERIES so pendingDeliveries
\* stays finite.
ServerReturnSnapshot ==
  /\ Cardinality(pendingDeliveries) < MAX_DELIVERIES
  /\ \E r \in pageLoadRequests \cup snapshotReloadRequests :
       /\ r.attemptId \in Attempts
       /\ IF DeadlineExpiredFor(r.attemptId)
            THEN DeadlineReconcileEffect(r.attemptId)
            ELSE UNCHANGED <<serverStatus, submittedSnapshot, serverVersion>>
       /\ pendingDeliveries' = pendingDeliveries \cup {
            MakeDelivery(r.requestId, r, ReconciledServeStatus(r.attemptId))}
       /\ pageLoadRequests' = pageLoadRequests \ {r}
       /\ snapshotReloadRequests' = snapshotReloadRequests \ {r}
       /\ UNCHANGED <<routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      restoreRequests, uiState, lastSnapshotViaGet, deadlinePassed>>

\* POST /restore handler: lifecycle transition disrupted -> in_progress.
\* Does NOT grant time — operator time grants are owned by the separate
\* formal/tla/operator-grant/ family (ADR-013 §8/§9). The guard evaluates
\* the canonical effective state (EXSEM-014): an expired attempt is never
\* restored. Produces an ACK delivery freezing the post-command status.
ProcessRestore ==
  /\ \E r \in restoreRequests :
       /\ IsResumable(serverStatus[r.attemptId])
       /\ ~deadlinePassed[r.attemptId]
       /\ Cardinality(pendingDeliveries) < MAX_DELIVERIES
       /\ serverStatus' = [serverStatus EXCEPT ![r.attemptId] = "in_progress"]
       /\ serverVersion' = [serverVersion EXCEPT ![r.attemptId] =
            serverVersion[r.attemptId] + 1]
       /\ pendingDeliveries' = pendingDeliveries \cup {
            MakeDelivery(r.requestId, r, "in_progress")}
       /\ restoreRequests' = restoreRequests \ {r}
       /\ UNCHANGED <<submittedSnapshot, routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, snapshotReloadRequests,
                      uiState, lastSnapshotViaGet, deadlinePassed>>

\* POST /restore rejected because the canonical deadline won between GET
\* and POST. Production composes policy evaluation → (authorized
\* adjustment, out of this model's policy scope) → canonical deadline
\* reconciliation inside the restore transaction (ADR-013 §7): an attempt
\* still expired after evaluation is terminalized there. The rejection
\* therefore materializes the terminal deadline outcome via the shared
\* reconciliation effect — it never leaves a perpetual disrupted+expired
\* authoritative server state. If the stored status already terminalized,
\* the ACK simply freezes that terminal status.
RejectRestoreDeadlineWon ==
  /\ \E r \in restoreRequests :
       /\ deadlinePassed[r.attemptId]
       /\ Cardinality(pendingDeliveries) < MAX_DELIVERIES
       /\ IF DeadlineExpiredFor(r.attemptId)
            THEN DeadlineReconcileEffect(r.attemptId)
            ELSE UNCHANGED <<serverStatus, submittedSnapshot, serverVersion>>
       /\ pendingDeliveries' = pendingDeliveries \cup {
            MakeDelivery(r.requestId, r, ReconciledServeStatus(r.attemptId))}
       /\ restoreRequests' = restoreRequests \ {r}
       /\ UNCHANGED <<routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, snapshotReloadRequests,
                      uiState, lastSnapshotViaGet, deadlinePassed>>

\* The restore POST delivery is a command ACK only — the client never applies
\* it as page state (except under the legacy bug). It must be consumed to
\* release the requestId; otherwise repeated POSTs exhaust the pool and
\* produce a model-artifact liveness failure. ConsumePostAck is the TARGET
\* consumption path (the legacy path is LegacyApplyPostOutcome above).
ConsumePostAck ==
  /\ \E d \in pendingDeliveries :
       /\ d.requestKind = "restore"
       /\ pendingDeliveries' = pendingDeliveries \ {d}
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      uiState, lastSnapshotViaGet, deadlinePassed>>

\* Lazy materialization of a deadline-won attempt outside any command path
\* (EXSEM-013: time-triggered state may materialize late; EXSEM-014: the
\* scanner is discovery-and-convergence only — this is the same
\* materialization every command path performs inline).
DeadlineReconcile ==
  /\ \E a \in Attempts :
       /\ DeadlineExpiredFor(a)
       /\ DeadlineReconcileEffect(a)
       /\ UNCHANGED <<routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, uiState, lastSnapshotViaGet, deadlinePassed>>

\* Candidate submit (pre-deadline only). EXSEM-014: submit is a
\* state-sensitive mutation, so the candidate command must never be the
\* freeze authority for a canonically expired attempt — production
\* reconciles the deadline inside the submit transaction and returns the
\* deadline-attributed freeze, making the candidate POST an idempotent
\* return. The ~deadlinePassed guard admits only the pre-deadline
\* candidate-authority first freeze (EXSEM-008); the server-side effect
\* shape equals DeadlineReconcileEffect's but is kept inline to keep the
\* candidate-authority freeze visibly distinct from deadline
\* reconciliation at this abstraction level.
SubmitAttempt ==
  /\ uiState = "editable"
  /\ \E a \in Attempts :
       /\ a = routeAttempt
       /\ serverStatus[a] = "in_progress"
       /\ ~deadlinePassed[a]
       /\ serverStatus' = [serverStatus EXCEPT ![a] = "submitted"]
       /\ submittedSnapshot' = [submittedSnapshot EXCEPT ![a] =
            CHOOSE v \in AnswerValues : TRUE]
       /\ serverVersion' = [serverVersion EXCEPT ![a] =
            serverVersion[a] + 1]
       /\ uiState' = "terminal"
       /\ UNCHANGED <<routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, lastSnapshotViaGet, deadlinePassed>>

GradeAttempt ==
  /\ \E a \in Attempts :
       /\ serverStatus[a] = "submitted"
       /\ serverStatus' = [serverStatus EXCEPT ![a] = "graded"]
       /\ UNCHANGED <<serverVersion, submittedSnapshot, routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, uiState, lastSnapshotViaGet, deadlinePassed>>

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
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      uiState, lastSnapshotViaGet, deadlinePassed>>

\* Canonical time advances past an attempt's deadline (EXSEM-011: server
\* time is the only deadline authority). This action carries the canonical
\* fact and NOTHING else: no durable state is materialized and no UI
\* projection is rewritten, so stored status may lag canonical expiry
\* (EXSEM-013) and the page may still show the last authoritative snapshot.
\* The client runtime may subsequently notice the deadline and trigger
\* auto-submit, but that workflow spans flush → POST /submit → server
\* reconciliation → authoritative reload and is deliberately NOT collapsed
\* into this step. Materialization stays owned by ServerReturnSnapshot,
\* SubmitAttempt, RejectRestoreDeadlineWon, and DeadlineReconcile.
DeadlinePasses ==
  /\ \E a \in Attempts :
       /\ ~deadlinePassed[a]
       /\ deadlinePassed' = [deadlinePassed EXCEPT ![a] = TRUE]
       /\ UNCHANGED <<serverStatus, serverVersion, submittedSnapshot,
                      routeAttempt, clientGeneration,
                      clientSnapshotAttempt, clientSnapshotGen, clientSnapshotEditable,
                      pageLoadRequests, restoreRequests, snapshotReloadRequests,
                      pendingDeliveries, uiState, lastSnapshotViaGet>>

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
\* exhaustive. Per-config ENABLEDNESS still varies with the excluded
\* environment actions (e.g. deadline-guarded actions are inert in
\* Core/RouteSwitch because DeadlinePasses runs only in Submission/Liveness).
\* See formal/tla/recovery/README.md §"Split safety models".
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

\* Liveness Next — excludes NavigateTo (fairness assumption: the user stays
\* on the route). Network availability is a documented environment
\* assumption of FairSpec, not a modeled toggle.
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

\* Helper: the set of request IDs currently consumed by any in-flight request.
UsedRequestIds ==
  {r.requestId : r \in pageLoadRequests \cup restoreRequests \cup snapshotReloadRequests}

\* Helper: the base conditions under which a restore for the current route
\* SHOULD be startable. These are the per-route, per-client preconditions that
\* are independent of the in-flight guard implementation (target vs legacy).
RestoreStartBaseConditions ==
  /\ uiState \in {"loading", "restore_failed"}
  /\ IsResumable(serverStatus[routeAttempt])
  /\ clientSnapshotAttempt = routeAttempt
  /\ ~RestoreInFlightForRoute
  /\ \E rid \in RequestIds : rid \notin UsedRequestIds

TypeOK ==
  /\ serverStatus \in [Attempts -> Statuses]
  /\ serverVersion \in [Attempts -> 0..MAX_VERSION]
  /\ submittedSnapshot \in [Attempts -> AnswerValues \cup {NoSnapshot}]
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
  /\ deadlinePassed \in [Attempts -> BOOLEAN]

\* A restore for B must never be initiated from A's snapshot. Stated over the
\* creation-time binding captured in the request record.
NoWrongAttemptRestore ==
  \A r \in restoreRequests : r.snapshotAttempt = r.attemptId

\* A stale page-load/restore/reload response cannot become the page's applied
\* snapshot. Stated over the APPLIED snapshot: when one is applied, it must
\* match the current route + generation. (A pending stale delivery is allowed;
\* what is forbidden is letting it become the applied snapshot.)
\* NoStalePageLoadApply and NoStaleRestoreApply are intentional semantic
\* aliases: they carry distinct named obligations (the page-load path and the
\* restore/reload path of the same stale-apply isolation) and distinct
\* counterexample targets; their formulas coincide today and are kept as two
\* names deliberately.
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

\* Cross-attempt non-blocking (enabledness safety): when all per-route base
\* conditions for starting a restore are satisfied, StartRestore must be
\* ENABLED. NavigateTo preserves old in-flight requests in both modes, so the
\* critical race state (route=B, A's restore still in-flight, B has none) is
\* reachable under BOTH target and legacy. The A/B comparison is clean:
\*   Target (per-attempt guard): A's stale request has attemptId=A, gen=old,
\*     so RestoreInFlightForRoute=FALSE for B → guard passes → ENABLED.
\*   Legacy (global guard): AnyRestoreInFlight=TRUE (A's request exists)
\*     → guard fails → NOT ENABLED → invariant violated at that state.
\* Same reachable state; only the guard differs. No fairness needed; pure
\* state predicate. Checked as INVARIANT in the route-switch safety config.
NoCrossAttemptRestoreBlocking ==
  RestoreStartBaseConditions => ENABLED StartRestore

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

\* =============================================================================
\* Liveness property (PROPERTY, under fairness).
\* =============================================================================

\* Environment assumption (documented, not modeled): the network eventually
\* stays available and the environment eventually delivers a non-lost
\* response. The former networkUp conjunct was constant TRUE in every spec
\* (its toggling actions were unreachable dead surface, removed with the
\* Issue #656 F6 cleanup), so the property is unchanged by its removal.
CurrentResumableAttemptEventuallyProgresses ==
  []((IsResumable(serverStatus[routeAttempt])
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
