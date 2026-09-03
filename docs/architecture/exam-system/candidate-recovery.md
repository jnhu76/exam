# Candidate Recovery Architecture

Authority: ADR-012 for candidate recovery and ADR-013 for interruption-time
policy. This document provides sequence diagrams, state tables, and decision
matrices for those contracts.

---

## Formal model

The selected recovery protocol is model-checked under
[`formal/tla/recovery/`](../../../formal/tla/recovery/). The executable
TLA+ specification (`RecoveryProtocol.tla`) and its safety / liveness /
expected-counterexample configurations are run via
`pnpm formal:recovery:*` (see `formal/README.md`).

ADR-012 remains the binding architectural decision. The formal model
verifies selected concurrency and recovery properties (route-bound restore
authority, stale-response isolation, terminal-state monotonicity,
submitted-snapshot immutability, server-version monotonicity, cross-attempt
non-blocking, "POST is not page authority", "restore does not directly
grant time"). It is **not** a proof that the TypeScript implementation is
a refinement. Safety is exhaustively model-checked; liveness is currently
PARTIAL. REC-I4 runtime mismatches are documented in the
[REC-I4-R0 audit](../../archive/audits/REC-I4-R0-INTERRUPTION-TIME-POLICY.md);
formal-model mismatches are documented in the
[REC-F1 audit](../../archive/audits/REC-F1-RECOVERY-PROTOCOL-FORMAL-MODEL.md).

---

## Sequence Diagrams

### Normal Answer Save (CURRENT)

```mermaid
sequenceDiagram
    participant C as Candidate Browser
    participant API as Fastify API
    participant Engine as exam-engine
    participant DB as PostgreSQL

    C->>C: candidate edits answer
    C->>C: useSubmitFlush schedules debounced save
    C->>API: POST /attempts/:attemptId/answers/:questionId
    API->>DB: BEGIN + lockEnrollmentAndAttempt (FOR UPDATE)
    API->>Engine: prepareReconciledAttemptMutation
    Engine->>Engine: ensureAttemptDeadlineReconciled
    Engine->>Engine: computeEffectiveDeadline
    Engine->>Engine: processSaveAnswer (pure decision)
    alt accepted
        Engine->>DB: UPDATE exam_attempts SET answers, lastActivityAt
        Engine-->>API: accepted + serverVersion + savedAt
    else rejected (stale/conflict/deadline)
        Engine-->>API: rejected + reason
    end
    API->>DB: COMMIT
    API-->>C: SaveAnswerResponse
```

### Response Lost After Server Commit (TARGET)

```mermaid
sequenceDiagram
    participant C as Candidate Browser
    participant J as Local Journal
    participant API as Fastify API
    participant DB as PostgreSQL

    C->>J: put(pendingOperation)
    C->>API: POST /answers (operationId=op1)
    API->>DB: COMMIT (answer saved)
    Note over API,C: response lost (network failure)
    C->>C: mark sync_failed / uncertain
    C->>API: retry POST /answers (operationId=op1, same payload)
    API->>DB: idempotency check (clientSeq match)
    API-->>C: original accepted result (no new write)
    C->>J: acknowledge(op1, receipt)
    C->>J: deleteAcknowledged
```

### Browser Restart Recovery (TARGET)

```mermaid
sequenceDiagram
    participant C as Candidate Browser
    participant J as AnswerRecoveryStore (IndexedDB)
    participant API as Fastify API
    participant DB as PostgreSQL

    C->>API: GET /candidate/attempts/:attemptId/take
    API-->>C: CandidateTakeSnapshot (status, canResume, canSave, answers, versions)

    Note over C: Phase 1: Lifecycle reconciliation (MUST precede answer reconciliation)

    alt attemptStatus=disrupted AND canResume=true
        C->>API: POST /attempts/:examId/start (or /restore)
        API-->>C: restored attempt
        C->>API: GET /candidate/attempts/:attemptId/take (reload)
        API-->>C: refreshed snapshot
    end

    alt snapshot.canSave=false (submitted / auto-submitted / voided)
        C->>J: freeze journal (no new writes)
        Note over C: retain journal per incident/cleanup policy only
        C->>C: show terminal state to candidate
        Note over C: STOP — no answer replay or operation creation
    end

    Note over C: Phase 2: Answer reconciliation (only when canSave=true)

    C->>J: listDrafts(scope)
    J-->>C: DurableAnswerDrafts (latest intent per question)
    C->>J: listOperations(scope)
    J-->>C: SaveOperationOutbox (sent-but-uncertain)
    C->>C: resolve uncertain operations first (retry idempotent)
    alt operation already confirmed by server
        C->>J: acknowledgeOperation + removeAcknowledged
    else operation still pending
        C->>API: retry POST /answers (same operationId)
        alt accepted
            C->>J: acknowledgeOperation
        else conflict
            C->>J: markOperationConflict
        end
    end
    C->>C: update known serverVersion per question
    C->>C: compare each draft vs server-confirmed answer
    alt draft differs from server
        C->>J: enqueueOperation (new operation from latest draft)
        C->>API: POST /answers (new operationId, current baseVersion)
        alt accepted
            C->>J: acknowledgeOperation
        else conflict (stale)
            C->>J: markOperationConflict
            C->>C: surface conflict to candidate
        end
    end
    C->>C: enter attempt with reconciled state
```

### Device Replacement

```mermaid
sequenceDiagram
    participant New as New Device
    participant API as Fastify API
    participant DB as PostgreSQL

    New->>API: authenticate + GET /candidate/exams
    API-->>New: exam list with availability
    New->>API: POST /attempts/:examId/start
    API->>DB: find active/disrupted attempt
    alt disrupted attempt exists
        API->>DB: restoreInterruptedAttempt (deadline reconciliation)
        API-->>New: restored attempt (server-confirmed answers only)
    else in_progress attempt exists
        API-->>New: existing attempt (server-confirmed answers only)
    end
    Note over New: DurableAnswerDrafts and SaveOperationOutbox entries<br/>from the original device are NOT recovered
```

### Disrupted-Attempt Restore (CURRENT + TARGET)

```mermaid
sequenceDiagram
    participant C as Candidate Browser
    participant API as Fastify API
    participant Engine as exam-engine
    participant DB as PostgreSQL

    C->>API: GET /candidate/attempts/:attemptId/take
    API->>DB: deadline reconciliation (may auto-submit if expired)
    API-->>C: snapshot (attemptStatus=disrupted, canResume=true)
    Note over C: REC-I3 (implemented): capability field<br/>canResume drives the explicit restore action,<br/>NOT raw attemptStatus. The restoring UI overlay<br/>is shown while the command is in flight.
    C->>API: POST /attempts/:attemptId/restore
    API->>DB: BEGIN + lock Enrollment → Attempt → Exam
    API->>DB: ensureAttemptDeadlineReconciled (re-check before restore)
    API->>Engine: restoreInterruptedAttempt()
    Engine->>Engine: evaluateInterruptionTimePolicy() on frozen snapshot
    Engine->>DB: INSERT bounded_grace adjustment + UPDATE deadlineAt (when policy grants)
    Engine->>Engine: ensureAttemptDeadlineReconciled (reconcile using adjusted deadline)
    Engine->>Engine: restoreAttemptState() (lifecycle-only helper)
    Engine->>DB: UPDATE status=in_progress, lastActivityAt
    Engine->>DB: INSERT interruption event (restored outcome)
    Note over Engine: ADR-013 implemented (REC-I4-I1/I2/I3A/I3B1/I3B2):<br/>state restore and time compensation are separate.<br/>grantAttemptTime() is a separate Admin operator command,<br/>not part of candidate restore.
    API->>DB: COMMIT
    API-->>C: RestoreAttemptResponse (lifecycle + candidate-safe compensation summary + attempt projection)
    Note over C: REC-I3 / ADR-013 §6: the response is a command RESULT,<br/>not the take-page authority. It carries the lifecycle outcome<br/>(restored / already_in_progress / terminal), a candidate-safe<br/>compensation summary (policy + addedSeconds), and a candidate<br/>attempt projection — enough to render a restoring/terminal state.<br/>The page then reloads the authoritative CandidateTakeSnapshot.
    C->>API: GET /candidate/attempts/:attemptId/take (reload)
    API-->>C: reloaded snapshot (in_progress OR terminal if deadline won)
    Note over C: Branch on the reloaded snapshot only.<br/>No automatic restore loop. No invented in_progress.
```

### Disrupted-Attempt Restore — Web Client Implementation Status (REC-I3)

The Web recovery flow frozen by ADR-012 §Recovery Semantics is implemented in
`apps/web/src/exam/useAttemptRestore.ts` and wired into
`apps/web/src/pages/exam/TakeExamPage.tsx`. Behavior summary:

```text
GET /candidate/attempts/:attemptId/take (authoritative snapshot)
  ↓
IF snapshot.canResume == true:
  → render restoring UI overlay
  → POST /api/attempts/:attemptId/restore EXACTLY ONCE
  → reload GET /candidate/attempts/:attemptId/take
  → branch on the reloaded snapshot
ELSE:
  → initialize normally from the snapshot (existing flow)
```

Properties preserved by the implementation:

- `CandidateTakeSnapshot` remains the page business truth source. The restore
  POST response is treated only as a command acknowledgement.
- `snapshot.canResume` — NOT raw `attemptStatus === "disrupted"` — governs
  whether restore is attempted.
- Restore fires at most once concurrently per mounted attempt. Guards
  (per `useAttemptRestore`):
  - **`restoreInFlightRef` keyed by `attemptId`** (NOT a boolean): stores the
    identity of the attempt that currently owns the in-flight POST/GET chain.
    A route change to a NEW attempt while an OLD attempt's POST is still
    pending is NOT a duplicate, so the new attempt's restore proceeds and
    claims the slot; the old attempt's stale resolution only clears the slot
    when it is STILL the owner.
  - **`restoredForAttemptRef`** — per-attempt identity guard, committed INSIDE
    `performRestore` after the in-flight guard passes (not pre-marked in the
    auto-restore effect), so an effect whose `performRestore` was rejected by
    the guard can still restore once the owner changes.
  - **`generationRef` + `currentAttemptIdRef`** — monotonic generation token
    and latest-bound `attemptId`. Both are captured at the start of each async
    restore chain and re-checked after every await; a stale POST/GET from a
    previous route cannot apply its snapshot or mutate UI state. The
    generation is bumped ONLY on a real `attemptId` change (render-time
    prev-value check), never on StrictMode re-mount of the same attempt.
  This replaces the earlier shared-boolean `cancelledRef` cleanup flag, which
  a new effect setup could reset before a stale async chain resumed. Verified
  by component tests against React Strict Mode effect replay, snapshot
  re-renders, and cross-attempt races (resumable→resumable, old GET late
  success/failure).
- The same generation discipline guards the PAGE's own `loadSnapshot`
  (`loadGenerationRef` + `currentAttemptIdRef`): a late GET from a previous
  route cannot overwrite the new route's snapshot or write `loadError` onto an
  already-loaded page.
- On a real route change ALL attempt-scoped page state is reset (snapshot,
  loadError, isLoading, currentIndex, answers, save/submit/transient/flush
  states, and the submit/deadline refs), so nothing from the previous attempt
  can leak onto the new route — in particular, a retained `currentIndex` out
  of range for the new exam cannot pin the page to the generic ErrorState.
- **The answer-save queue is isolated per attempt.** Because `TakeExamPage`
  reuses one instance across `:attemptId` route changes, `useSubmitFlush`
  receives the route `attemptId` as a `scopeKey` and gives each scope its OWN
  pending/inflight/status/generation maps (keyed by `questionId`). On a scope
  change (`useLayoutEffect`, before paint): the old scope's pending debounce
  timers are cancelled; the old scope object is retained so its
  already-inflight saves settle without writing status; a brand-new scope
  with empty maps is installed. Two scopes sharing a `questionId` do NOT
  share a queue — the new scope's save never serializes behind the old
  scope's inflight save. `flush()` binds its scope at call time and never
  drains/awaits/count another scope's work. The page's `saveAnswer` closure
  is stale-guarded on a scope-generation token (captured at schedule time,
  re-checked before any read of page authority, after the `await`, and at
  the top of `catch`) so an in-flight old-attempt save cannot mutate the new
  page's state/refs. `loadGenerationRef` is bumped on EVERY `loadSnapshot`
  call (not just route change) so two concurrent loads of the same attempt
  cannot reorder (latest-GET-wins).
- User-triggered retry after a genuine failure is supported via a dedicated
  "重试恢复" control (a fresh POST is allowed).
- Deadline race: if the deadline wins between GET and POST restore, the
  reloaded snapshot is terminal/non-resumable; the page renders the terminal
  state and does NOT auto-loop restore.
- Snapshot reload failure after a successful restore is treated as an
  uncertain state; the page surfaces a reload/retry path rather than
  inventing `in_progress` from the restore response.
- Restore failure is NOT represented as a save failure and does NOT display
  generic "时间到" / "正在自动交卷" copy merely because the disrupted
  snapshot has `isEditable=false`.

Telemetry: `restore_started` / `restore_succeeded` / `restore_failed` are
emitted via the existing `trackExamEvent` helper, scoped to attemptId/examId
with `durationMs` and `errorCode` only. No answer content is recorded.

ADR-013 is closed through REC-I4-I3B2.

REC-I4-I1/I2/I3A/I3B1 implement the persistence, frozen policy, candidate
restore compensation runtime, and canonical operator-grant engine/ledger
semantics.

REC-I4-I3B2 closes the separate Admin operator-grant product path: permission,
Attempt-scoped route, atomic audit, PostgreSQL race recovery, and Dashboard
retry coordination.

`restoreInterruptedAttempt()` applies the frozen policy (strict zero-grant by
default, bounded_grace only with explicit caps). `grantAttemptTime()` is a
separate Admin operator command and is not part of candidate restore. The Web
client deliberately uses neutral copy
("服务器正在确认考试状态和剩余时间") and does not duplicate time logic.

### Interruption-Time Policy (IMPLEMENTED)

ADR-013 freezes:

```text
strict            (default) → restore lifecycle, automatic grant 0
bounded_grace               → explicit Exam caps + Attempt snapshot
operator_incident           → candidate restore grants 0; operator command only
```

Detection and entitlement are different:

```text
heartbeat timeout
  → server evidence that qualifying activity has not recently been observed
  → may create a disrupted state and interruption episode

heartbeat timeout
  ↛ proof that now - lastActivityAt seconds must be returned
```

The target persistence model keeps:

- an active `currentInterruptionId` / `interruptedAt` pointer on the Attempt;
- an append-only interruption event history for every
  `in_progress → disrupted` episode and its outcome;
- a frozen interruption-policy snapshot on the Attempt;
- an append-only ledger for positive deadline adjustments.

The episode UUID is per Attempt interruption. A future `incidentId` is a
different identity for one service incident affecting multiple attempts.

#### Strict restore ordering

```mermaid
sequenceDiagram
    participant API as Candidate Restore API
    participant DB as PostgreSQL
    participant Engine as exam-engine

    API->>DB: BEGIN + lock Enrollment → Attempt → Exam
    API->>Engine: reconcile authoritative deadline
    alt reconciliation is terminal
        Engine-->>API: terminal
        API->>DB: resolve episode terminal + clear active pointer
    else attempt remains disrupted
        API->>Engine: restoreAttemptState()
        Engine-->>API: lifecycle restored
        API->>DB: resolve episode restored + clear active pointer
        Note over API,DB: automatic addedSeconds = 0
    end
    API->>DB: COMMIT
```

The route satisfies this contract: `restoreInterruptedAttempt()` runs the
deadline reconciliation first and returns a terminal result without invoking
the lifecycle restore when reconciliation made the Attempt terminal.

#### Bounded-grace restore ordering

```mermaid
sequenceDiagram
    participant API as Candidate Restore API
    participant DB as PostgreSQL
    participant Policy as Interruption Policy
    participant Recon as Deadline Reconciliation

    API->>DB: BEGIN + lock Enrollment → Attempt → Exam
    API->>DB: reject/return already-terminal; load active episode + policy snapshot
    API->>Policy: evaluate server-observed eligible seconds and all caps
    Policy-->>API: idempotent adjustment decision
    alt addedSeconds > 0
        API->>DB: INSERT adjustment ledger + UPDATE deadlineAt
    end
    API->>Recon: reconcile using adjusted authoritative deadline
    alt still resumable
        API->>DB: disrupted → in_progress; resolve episode restored
    else adjusted deadline still expired
        API->>DB: terminal wins; resolve episode terminal
    end
    API->>DB: clear active interruption pointer + COMMIT
```

The eligible interval begins at the committed server detection time, not a
client timestamp. The grant is the minimum of eligible seconds, the
per-incident cap, the remaining automatic aggregate cap, and room before
`exam.closeAt`.

#### Operator-incident ordering

Candidate restore uses the strict ordering and adds zero. An authorized
operator may run a separately attributable, reason-required grant command
only while the Attempt is `in_progress | disrupted`. Ordinary time extension
does not reopen a submitted, grading, graded, or voided Attempt.

### Server Outage

```mermaid
sequenceDiagram
    participant C as Candidate Browser
    participant J as Local Journal (TARGET)
    participant API as Fastify API (unavailable)

    C->>J: persist latest DurableAnswerDraft [TARGET write-ahead]
    J-->>C: durable acknowledgement
    C->>API: POST /answers (timeout)
    C->>C: detect network_offline
    Note over C: OfflineAnswerPolicy governs behavior:<br/>continue_and_sync / bounded_window → allow editing<br/>lock_when_offline → lock new input<br/>operator_review → save locally, mark for review
    C->>J: overwrite DurableAnswerDraft [TARGET]
    C->>C: candidate continues answering (policy-permitted)
    Note over API: server outage interval
    Note over API: server restarts
    C->>API: GET /health (online)
    C->>C: detect network_online
    C->>J: read latest drafts + pending outbox [TARGET]
    C->>C: resolve uncertain in-flight operations first
    C->>API: generate + send operations from latest drafts [TARGET]
    API-->>C: acknowledgements / conflicts
```

### Submission Response Loss (CURRENT)

```mermaid
sequenceDiagram
    participant C as Candidate Browser
    participant API as Fastify API
    participant DB as PostgreSQL

    C->>API: POST /attempts/:attemptId/submit
    API->>DB: BEGIN + FOR UPDATE
    API->>DB: submitAttempt (freeze + workset)
    API->>DB: COMMIT
    Note over API,C: response lost
    C->>API: retry POST /attempts/:attemptId/submit
    API->>DB: findByIdForUpdate
    API->>API: detect status=submitted (idempotent path)
    API->>API: validateGradingWorksetConsistency
    API-->>C: existing submission result (no duplicate)
```

---

## State / Authority Table

| State | Authority | Storage | Recoverable after crash |
|---|---|---|---|
| Server-confirmed answer | PostgreSQL | `exam_attempts.answers` | Yes |
| Submitted answer snapshot | PostgreSQL | `exam_attempts.submitted_answers` | Yes |
| Attempt lifecycle status | PostgreSQL | `exam_attempts.status` | Yes |
| Effective deadline | PostgreSQL | `min(exam.closeAt, attempt.deadlineAt)` | Yes |
| Grading workset | PostgreSQL | `attempt_grading_entries` | Yes |
| Final result | PostgreSQL | `exam_enrollments.finalScore/finalPassed` | Yes |
| Durable local draft (TARGET) | Client recovery intent | IndexedDB / SQLite | Same device only |
| Save operation outbox (TARGET) | Pending transport intent | IndexedDB / SQLite | Same device only |
| In-memory edit (CURRENT) | Browser memory | React refs | No |
| Client telemetry buffer | Browser memory | in-memory queue | No |

---

## Failure Decision Matrix

| Failure class | Server-confirmed answers | Pending local ops (TARGET) | Time compensation | Recovery path |
|---|---|---|---|---|
| A. Network interruption | Safe (server holds) | Journal holds; replay on reconnect | Policy-dependent (not auto-full); client-claimed duration NOT fully trusted | Replay pending → reconcile |
| B. Client process interruption | Safe | Same device: journal survives; different: lost | Policy-dependent | Reload snapshot → replay journal |
| C. Device loss/replacement | Safe | Lost (original device only) | None automatic | Server-confirmed state only |
| D. Server-side outage | Safe (if committed before outage) | Journal holds; replay after recovery | Operator incident / system-wide; server-observable interval | Replay pending → reconcile |
| E. Concurrent client activity | Version protocol protects | Conflict surfaced to stale client | N/A | Stale client receives STALE_VERSION |
| F. Client persistence failure | Safe (server holds) | Lost or corrupted; degrade to server-only | N/A | Server-confirmed state; warn candidate |

---

## Web vs Future Desktop Adapter Boundary

| Concern | Web adapter | Future desktop adapter |
|---|---|---|
| Journal storage | IndexedDB | SQLite |
| Session identity | HTTP-only cookie + JWT | Desktop installation/session |
| Process lifecycle | Browser tab/process | Desktop process |
| Credential handling | httpOnly cookie | OS credential store |
| Single-writer lock | Web Locks API / BroadcastChannel | Desktop single-instance lock |
| Save protocol | Same (operationId, baseVersion, serverVersion) | Same |
| Restore command | Same (POST /restore) | Same |
| Submission semantics | Same (idempotent) | Same |
| Telemetry vocabulary | Same event names | Same event names |
| Incident model | Same | Same |

---

## Data Retention Table

| Data | Retention trigger | Action |
|---|---|---|
| Pending journal entries | Authoritative submission | Clear attempt journal (physical delete after reconciliation) |
| Pending journal entries | Attempt void/freeze | Remove answer payload; retain operation count + sync state + event IDs for appeal |
| Pending journal entries | Secure logout | Detach from active session; do NOT physically delete unresolved entries |
| Pending journal entries | User B logs in on same device | User B can NEVER query or discover User A's journal |
| Pending journal entries | User A re-logs in on same device | User A MAY rediscover their unresolved journal entries |
| Pending journal entries | Retention expiry | Physical delete (time-based cleanup, policy-configured) |
| Pending journal entries | Exam/attempt deletion signal | Physical delete |
| Pending journal entries | Explicit user abandonment | Physical delete (user-initiated, confirmed) |
| Server-confirmed answers | Permanent | PostgreSQL retention policy |
| Submitted answer snapshot | Permanent | PostgreSQL retention policy |
| Telemetry events | Configurable | No answer content; ids + counts only |

### Logout and user-change semantics (frozen)

```text
Logout:
  Journal entries are NOT physically deleted.
  They are detached from the active session identity.

User B login (same device):
  User B can NEVER read, query, or recover User A's journal.
  Isolation is enforced by scope key: organizationId + userId + attemptId.

User A re-login (same device):
  User A MAY rediscover unresolved journal entries for active attempts.

Physical deletion occurs ONLY on:
  - authoritative submission (after reconciliation)
  - retention expiry (time-based, policy-configured)
  - explicit user abandonment (confirmed)
  - exam/attempt deletion signal
  - lawful deletion request

"Clear" in this document means "make inaccessible to the current user
session", NOT "physically delete", unless the trigger explicitly states
physical deletion.
```
