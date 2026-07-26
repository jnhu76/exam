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
    participant J as Local Journal (IndexedDB)
    participant API as Fastify API
    participant DB as PostgreSQL

    C->>API: GET /candidate/attempts/:attemptId/take
    API-->>C: CandidateTakeSnapshot (server-confirmed answers)
    C->>J: listForAttempt(org, user, exam, attempt)
    J-->>C: pending operations
    C->>C: compare receipts vs server versions
    alt operation already confirmed
        C->>J: acknowledge + deleteAcknowledged
    else operation pending and safe
        C->>API: replay POST /answers (operationId, baseVersion)
        alt accepted
            C->>J: acknowledge
        else conflict (stale version)
            C->>J: markConflict
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
    Note over New: pending operations from original device are NOT recovered
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
    C->>API: POST /attempts/:examId/start (or /restore)
    API->>DB: BEGIN + lock
    API->>Engine: restoreAttempt
    Engine->>Engine: transition(disrupted, restore)
    Engine->>Engine: compute disconnectedDuration
    Engine->>Engine: adjust deadlineAt (bounded by exam.closeAt)
    Engine->>DB: UPDATE status=in_progress, deadlineAt, lastActivityAt
    API->>DB: COMMIT
    API-->>C: restored attempt response
    C->>C: reload take snapshot
```

### Server Outage

```mermaid
sequenceDiagram
    participant C as Candidate Browser
    participant J as Local Journal (TARGET)
    participant API as Fastify API (unavailable)

    C->>API: POST /answers (timeout)
    C->>C: detect network_offline
    C->>J: put(pendingOperation) [TARGET]
    C->>C: candidate continues answering locally
    C->>J: put(pendingOperation2) [TARGET]
    Note over API: server outage interval
    Note over API: server restarts
    C->>API: GET /health (online)
    C->>C: detect network_online
    C->>J: listForAttempt [TARGET]
    C->>API: replay pending operations [TARGET]
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
| Pending local operation (TARGET) | Client journal | IndexedDB / SQLite | Same device only |
| In-memory edit (CURRENT) | Browser memory | React refs | No |
| Client telemetry buffer | Browser memory | in-memory queue | No |

---

## Failure Decision Matrix

| Failure class | Server-confirmed answers | Pending local ops (TARGET) | Time compensation | Recovery path |
|---|---|---|---|---|
| A. Network interruption | Safe (server holds) | Journal holds; replay on reconnect | Policy-dependent (not auto-full) | Replay pending → reconcile |
| B. Client process interruption | Safe | Same device: journal survives; different: lost | Policy-dependent | Reload snapshot → replay journal |
| C. Device loss/replacement | Safe | Lost (original device only) | None automatic | Server-confirmed state only |
| D. Server-side outage | Safe (if committed before outage) | Journal holds; replay after recovery | Operator incident / system-wide | Replay pending → reconcile |
| E. Concurrent client activity | Version protocol protects | Conflict surfaced to stale client | N/A | Stale client receives STALE_VERSION |

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
| Pending journal entries | Authoritative submission | Clear attempt journal |
| Pending journal entries | Attempt void/freeze | Clear (no longer editable) |
| Pending journal entries | Secure logout | Policy-defined (do not silently delete unresolved) |
| Pending journal entries | User identity change | Clear previous user's journal |
| Pending journal entries | Retention expiry | Time-based cleanup |
| Pending journal entries | Exam/attempt deletion signal | Clear |
| Server-confirmed answers | Permanent | PostgreSQL retention policy |
| Submitted answer snapshot | Permanent | PostgreSQL retention policy |
| Telemetry events | Configurable | No answer content; ids + counts only |
