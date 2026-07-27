# Candidate Recovery Architecture

Authority: ADR-012. This document provides sequence diagrams, state tables,
and decision matrices for the candidate exam recovery contract.

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
        API->>DB: restoreAttempt (deadline reconciliation)
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
    API->>DB: BEGIN + lock
    API->>DB: ensureAttemptDeadlineReconciled (re-check before restore)
    API->>Engine: restoreAttempt
    Engine->>Engine: transition(disrupted, restore)
    Note over Engine: CURRENT_TRANSITIONAL: restoreAttempt currently<br/>computes disconnectedDuration AND adjusts deadlineAt<br/>in the same command. This is NOT the target contract.
    Engine->>Engine: compute disconnectedDuration
    Engine->>Engine: adjust deadlineAt (bounded by exam.closeAt)
    Note over Engine: TARGET (REC-I3 + REC-I4):<br/>State restore and time compensation are separate.<br/>REC-I3 (DONE): explicit restore command from Web client.<br/>REC-I4 (PENDING): policy-driven compensation (strict/bounded_grace/operator_incident).
    Engine->>DB: UPDATE status=in_progress, deadlineAt, lastActivityAt
    API->>DB: COMMIT
    API-->>C: restore acknowledgement (legacy LoadAttemptResponse)
    Note over C: REC-I3: the restore response is a command ack only.<br/>The page reloads the authoritative snapshot, NOT<br/>the restore response.
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

Deferred: REC-I4 (time-compensation policy) is NOT modified by REC-I3. The
current `restoreAttempt` engine may still grant full disconnected-time
compensation; the Web client deliberately uses neutral copy
("服务器正在确认考试状态和剩余时间") and does not duplicate time logic.



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
