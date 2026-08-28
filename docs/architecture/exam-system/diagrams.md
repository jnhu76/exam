# Architecture Diagrams

> Evidence-backed Mermaid diagrams of the exam system.

```text
Last verified against commit:
cac6b85c425c85ad4077002bc518fca0b50f766f

Verification scope:
Current master implementation after merged P5-0 / PR #210.
```

---

## 1. System Context Diagram

```mermaid
C4Context
    title System Context — Exam Platform

    person(admin, "Admin", "Configures courses, questions, exams, enrollments, grading, exports")
    person(teacher, "Teacher", "Course/exam authoring and lifecycle manager")
    person(proctor, "Proctor", "Exam-room runtime authority")
    person(grader, "Grader", "Manual scoring of subjective questions")
    person(candidate, "Candidate", "Takes assigned exams")
    person(maintainer, "Maintainer", "Read-only operational observer (health / diagnostics / backup evidence)")

    system(exam_system, "Exam Platform", "LAN/on-premise exam and assessment platform")

    system_Ext(smtp, "SMTP / Email Provider", "External email delivery")

    rel(admin, exam_system, "Manages", "HTTPS / Web UI")
    rel(teacher, exam_system, "Manages", "HTTPS / Web UI")
    rel(proctor, exam_system, "Monitors", "HTTPS / Web UI")
    rel(grader, exam_system, "Grades", "HTTPS / Web UI")
    rel(candidate, exam_system, "Takes exams", "HTTPS / Web UI")
    rel(maintainer, exam_system, "Views operational health / diagnostics / evidence", "HTTPS / Web UI")

    rel(exam_system, smtp, "Sends email", "SMTP (async)")
```

**Authority**: `apps/api/src/server.ts`, `packages/authz/src/presets.ts`, `apps/api/src/plugins/emailOutboxLoop.ts` (#320 CONVERGE — in-process outbox loop; standalone `workers/emailDeliveryWorker.ts` remains as an optional escape hatch)
**Evidence**: 7 built-in role presets total — 6 assignable human roles (Admin, Teacher, Proctor, Grader, Candidate, Maintainer; Maintainer added by P7-E2A — read-only Operational Observer; ADR-017) + 1 synthetic non-assignable System actor (not rendered as a person; deadline auto-submit / heartbeat scan / reconcile). Maintainer holds exactly 5 operational `*.view` capabilities, 0 business permissions, 0 writes — the relation is **observation only: no business mutation, no infrastructure execution**. Admin ∩ Maintainer = ∅ is enforced server-side (D14). SMTP is the only external system dependency (async via the in-process email outbox loop).
**Known limitations**: Teacher/Proctor/Grader are Phase 3 roles (capability infrastructure exists; product role UI is incomplete). Teacher course-scope is NOT enforced — see P7-RBAC F-04. Email delivery is the only async external dependency. No CDN, no cloud services, no external APIs.

---

## 2. Aggregate and Data Relationship Diagram

```mermaid
erDiagram
    Organization ||--o{ User : has
    Organization ||--o{ Candidate : has
    Organization ||--o{ Course : has
    Organization ||--o{ Exam : has
    Organization ||--o{ ExamEnrollment : has
    Organization ||--o{ ExamAttempt : has
    Organization ||--o{ AttemptGradingEntry : has
    Organization ||--o{ AuditLog : has
    Organization ||--o{ EmailOutbox : has
    Organization ||--o{ WorkerHeartbeat : has

    User ||--o| Candidate : profile
    Candidate ||--o{ ExamEnrollment : enrolled
    Course ||--o{ Question : contains
    Exam ||--|{ ExamEnrollment : has
    Exam ||--o{ ExamAttempt : has
    ExamEnrollment ||--o{ ExamAttempt : tracks
    ExamAttempt ||--|{ AttemptGradingEntry : materialized

    Exam {
        uuid id PK
        text status
        jsonb questionSnapshot "FROZEN at publish"
        timestamp resultsPublishedAt "FACT timestamp"
    }

    ExamAttempt {
        uuid id PK
        text status
        jsonb answers "DRAFT (mutable)"
        jsonb submitted_answers "FROZEN at submit"
        jsonb gradingResult "PROJECTION (derived)"
        text gradingStatus "ORTHOGONAL lifecycle"
        timestamp submittedAt
        timestamp deadlineAt
        timestamp lastActivityAt "heartbeat"
    }

    AttemptGradingEntry {
        uuid id PK
        text gradingMode "auto | manual"
        text status "completed_auto | pending_manual | completed_manual"
        doublePrecision earnedScore
    }

    Question {
        uuid id PK
        text type
        jsonb standardAnswer
        text rubric
    }

    AuditLog {
        uuid id PK
        text action
        text targetType
        text targetId
        jsonb metadata
    }

    EmailOutbox {
        uuid id PK
        text status
        text lockedBy
        text providerMessageId
    }

    WorkerHeartbeat {
        uuid id PK
        text workerName
        timestamp lastPollAt
    }
```

**Legend**:
- **Aggregate root**: Organization, User, Candidate, Course, Question, Exam, ExamAttempt
- **Child entity**: ExamEnrollment (owned by Exam), AttemptGradingEntry (owned by Attempt)
- **Embedded value**: QuestionSnapshot (inside Exam/Attempt), AnswerRecord, SubmittedAnswersSnapshot
- **Projection**: gradingResult (derived from AttemptGradingEntry)
- **Infrastructure record**: AuditLog, EmailOutbox, WorkerHeartbeat

**Authority**: `packages/db/src/schema/pg.ts`, `packages/domain/src/types.ts`
**Evidence**: Table definitions in schema.ts mirror the aggregate types. Foreign keys enforce parent-child relationships.
**Known limitations**: Paper is an implicit composition concept (no table). Result is a projection (no table). Notification Inbox is NOT IMPLEMENTED.

---

## 3. End-to-End Data Flow Diagram

```mermaid
flowchart TD
    subgraph Authoring["1. Question Authoring (LIVE)"]
        Q["Question Bank<br/>questions table<br/>mutable standardAnswer + rubric"]
    end

    subgraph Composition["2. Exam Composition"]
        E["Exam<br/>exam.questionIds[]<br/>ordered question list"]
    end

    subgraph Publish["3. Exam Publish / Freeze"]
        EP["publishExam()<br/>builds questionSnapshot<br/>FROZEN COPY"]
        EP2["exam.questionSnapshot<br/>immutable frozen copy<br/>standardAnswer + rubric"]
    end

    subgraph Enroll["4. Enrollment"]
        EN["ExamEnrollment<br/>assigned | started | completed"]
    end

    subgraph Start["5. Attempt Start / Freeze"]
        SA["startOrRestoreAttempt()<br/>copies questionSnapshot<br/>to attempt"]
        SA2["attempt.questionSnapshot<br/>immutable frozen copy"]
    end

    subgraph Draft["6. Draft Answer Saves"]
        D["saveAnswer()<br/>versioned, idempotent<br/>attempt.answers JSONB"]
    end

    subgraph Submit["7. Submit Freeze Barrier"]
        SB["submitAttempt()<br/>FOR UPDATE lock<br/>build SubmittedAnswersSnapshot"]
        SB2["attempt.submitted_answers<br/>FROZEN COPY<br/>immutable"]
    end

    subgraph Grading["8. Grading"]
        GW["materializeGradingWorkset()<br/>attempt_grading_entries<br/>one row per frozen question"]
        GA["aggregateGradingEntries()<br/>reads entries + snapshot<br/>NEVER live questions"]
    end

    subgraph Terminal["9. Terminal Projection"]
        TP["finalizeTerminalGrading()<br/>attempt.score / passed<br/>enrollment.finalScore"]
        TP2["attempt.gradingResult<br/>PROJECTION<br/>never read as input"]
    end

    subgraph Visibility["10. Result Visibility"]
        RV["computeResultVisibility()<br/>AND of publish-policy<br/>and grading-completeness"]
    end

    subgraph PublishResults["11. Manual Result Publication"]
        PR["publishResults()<br/>sets resultsPublishedAt<br/>write-once, idempotent"]
    end

    subgraph Future["12. Future: P5-N1 Notification"]
        N["NOT IMPLEMENTED<br/>Notification Inbox<br/>+ Email enqueue"]
    end

    subgraph Email["13. Email Worker"]
        EW["Email Worker<br/>claimDue + send<br/>at-least-once delivery"]
    end

    Q -->|"copy at publish"| EP
    E -->|"publishExam"| EP
    EP --> EP2
    EP2 -->|"copy at start"| SA
    SA --> SA2
    SA2 --> D
    D -->|"saveAnswer"| SB
    SB --> SB2
    SB2 -->|"frozen authority"| GW
    GW --> GA
    GA --> TP
    TP --> TP2
    TP2 --> RV
    PR --> RV
    RV -->|"visible"| CandidateView["Candidate View<br/>NO standardAnswer<br/>NO rubric"]
    RV -->|"visible"| AdminView["Admin/Teacher View<br/>standardAnswer OK<br/>rubric OK"]

    GW -.->|"future"| N
    N -.->|"future"| Email

    style EP fill:#ffcccc,stroke:#ff0000
    style EP2 fill:#ffcccc,stroke:#ff0000
    style SA2 fill:#ffcccc,stroke:#ff0000
    style SB2 fill:#ffcccc,stroke:#ff0000
    style TP2 fill:#ccffcc,stroke:#00cc00
    style N fill:#cccccc,stroke:#666666,stroke-dasharray: 5 5
```

**Freeze points** (red): questionSnapshot at publish, questionSnapshot at attempt start, submitted_answers at submit.
**Projection boundary** (green): gradingResult is a projection, never read as scoring input.
**Async boundary**: Email worker sends SMTP outside any DB transaction.

**Authority**: `packages/exam-engine/src/examCommands.ts`, `attemptCommands.ts`, `answerProtocol.ts`, `gradingWorkset.ts`, `grading.ts`, `apps/api/src/routes/attempts.shared.ts`
**Evidence**: Each step maps to a documented command function. Freeze points are enforced by `buildQuestionSnapshot()`, `buildSubmittedAnswersSnapshot()`.
**Known limitations**: P5-N1 (Notification Inbox + Email enqueue) is NOT IMPLEMENTED — shown as future/dashed. Teacher/Proctor/Grader are Phase 3 roles. IP/CIDR, device binding, emergency access are NOT IMPLEMENTED.

---

## 4. State Machine Diagrams

See [state-and-authority.md](./state-and-authority.md) for the following state machine diagrams:

- Exam lifecycle (6 states)
- Attempt lifecycle (8 states, 4 reachable)
- Grading sub-process (3 states, orthogonal)
- Enrollment lifecycle (4 states)
- Email outbox lifecycle (5 states)

---

## 5. Sequence Diagrams

### 5.1 Exam Publish and Question-Snapshot Creation

```mermaid
sequenceDiagram
    actor Admin as Admin/Teacher
    participant Route as POST /exams/:id/publish
    participant Engine as publishExam()
    participant ExamRepo as ExamRepository
    participant DB as PostgreSQL

    Admin->>Route: POST /exams/:id/publish
    Route->>Route: authenticate + requireCapability(exam.publish)
    Route->>DB: executeInTransaction
    Route->>ExamRepo: findByIdForUpdate(examId)
    ExamRepo->>DB: SELECT ... FOR UPDATE
    DB-->>ExamRepo: exam row
    ExamRepo-->>Route: exam
    Route->>Engine: publishExam(repo, examId, questions)
    Engine->>Engine: assertTransition(draft, published)
    Engine->>Engine: validate questions, scores, policies
    Engine->>Engine: buildQuestionSnapshot(questionIds, questions)
    Note over Engine: FROZEN COPY created here<br/>standardAnswer + rubric copied
    Engine->>ExamRepo: update(examId, {status: published, questionSnapshot})
    ExamRepo->>DB: UPDATE exams
    Engine-->>Route: updated exam
    Route->>Route: recordAtomicHttpAudit(exam.published)
    Route-->>Admin: 200 + exam response
```

**Authority**: `apps/api/src/routes/exam.ts`, `packages/exam-engine/src/examCommands.ts`
**Evidence**: Route uses `executeAdminExamTransition` → `findByIdForUpdate` → `publishExam()`.
**Known limitations**: `published` and `open` are distinct states. Publish does NOT open the exam (that's a separate transition or lazy auto-open).

### 5.2 Save Answer

```mermaid
sequenceDiagram
    actor Candidate
    participant Route as POST /attempts/:id/answers/:qid
    participant Lock as lockEnrollmentAndAttempt
    participant Recon as ensureAttemptDeadlineReconciled
    participant Prep as prepareReconciledAttemptMutation
    participant Save as saveAnswer()
    participant DB as PostgreSQL

    Candidate->>Route: POST /attempts/:id/answers/:qid
    Note over Route: {attemptId, questionId, answer, clientSeq, baseVersion}
    Route->>Route: authenticate + requireOwnAttempt(attempt.answer.save)
    Route->>DB: executeInTransaction

    Route->>Lock: lockEnrollmentAndAttempt(enrollments, attempts, attemptId)
    Lock->>DB: SELECT attempt (locator, no lock)
    Lock->>DB: SELECT enrollment FOR UPDATE
    Lock->>DB: SELECT attempt FOR UPDATE
    Lock-->>Route: LockedEnrollmentAttemptIdentity

    Route->>Recon: ensureAttemptDeadlineReconciled(..., capability, now)
    alt attempt past effectiveDeadline
        Recon->>Save: submitAttempt(source: deadline_scanner, reason: deadline)
        Save->>DB: UPDATE attempt (submitted)
    else attempt not expired
        Recon-->>Route: attempt unchanged
    end

    Route->>Prep: prepareReconciledAttemptMutation(..., capability, now)
    Prep->>Prep: computeEffectiveDeadline(exam, attempt)
    Prep-->>Route: {attempt, mutationContext}

    Route->>Save: saveAnswer(attempts, mutationContext, request)
    Save->>Save: processSaveAnswer(state, request)
    Note over Save: Idempotent check via clientSeqMap<br/>Version check via baseVersion
    alt accepted
        Save->>DB: UPDATE attempt.answers + lastActivityAt
        Save-->>Route: {accepted: true, serverVersion}
    else rejected
        Save-->>Route: {accepted: false, conflict: reason}
    end

    Route-->>Candidate: 200/409 + response
```

**Authority**: `apps/api/src/routes/attempts.candidate.ts`, `packages/exam-engine/src/answerProtocol.ts`, `deadlineReconciliation.ts`, `lockSeam.ts`
**Evidence**: Route delegates to `lockEnrollmentAndAttempt` → `prepareReconciledAttemptMutation` → `saveAnswer`.
**Known limitations**: `processSaveAnswer` is a pure function (no IO). The composite `saveAnswer` owns load-decide-apply-persist.

### 5.3 Save-vs-Submit Concurrency (ADR-008)

```mermaid
sequenceDiagram
    participant Save as Save Answer Request
    participant Submit as Submit Request
    participant DB as PostgreSQL (attempt row)

    Note over Save,Submit: Both requests target the same attemptId

    alt Save acquires lock first
        Save->>DB: SELECT attempt FOR UPDATE
        DB-->>Save: attempt (in_progress)
        Save->>DB: UPDATE attempt.answers
        Save-->>Save: accepted (serverVersion)
        Submit->>DB: SELECT attempt FOR UPDATE (waits)
        DB-->>Submit: attempt (in_progress, answers updated)
        Submit->>DB: UPDATE attempt (submitted, submitted_answers)
        Submit-->>Submit: graded
    else Submit acquires lock first
        Submit->>DB: SELECT attempt FOR UPDATE
        DB-->>Submit: attempt (in_progress)
        Submit->>DB: UPDATE attempt (submitted, submitted_answers)
        Submit-->>Submit: graded
        Save->>DB: SELECT attempt FOR UPDATE (waits)
        DB-->>Save: attempt (submitted)
        Save-->>Save: rejected (ATTEMPT_ALREADY_SUBMITTED)
    end
```

**Authority**: ADR-008, `packages/exam-engine/src/attemptCommands.ts` `submitAttempt()`
**Evidence**: `submitAttempt()` reads via `findByIdForUpdate`. `saveAnswer()` runs inside EA lock. The FOR UPDATE serializes concurrent access. Existing test: `apps/api/src/routes/submitFreezeBarrier.test.ts` (real PostgreSQL, 5 race iterations).
**Known limitations**: Both outcomes are protocol-legitimate. The invariant is that grading reads the same answer set the row ended with (no stale snapshot).

### 5.4 Candidate Submit + Freeze + Automatic Grading

```mermaid
sequenceDiagram
    actor Candidate
    participant Route as POST /attempts/:id/submit
    participant Orchestrator as submitAndGradeAttempt
    participant Recon as ensureAttemptDeadlineReconciled
    participant Submit as submitAttempt()
    participant Materialize as materializeGradingWorkset
    participant Finalize as finalizeGrading → finalizeTerminalGrading
    participant DB as PostgreSQL

    Candidate->>Route: POST /attempts/:id/submit
    Route->>Route: authenticate + requireOwnAttempt(attempt.submit)
    Route->>Orchestrator: submitAndGradeAttempt(db, ctx, attemptId, candidateId, now)

    Orchestrator->>DB: executeInTransaction
    Orchestrator->>DB: lockEnrollmentAndAttempt

    Orchestrator->>Recon: ensureAttemptDeadlineReconciled(...)
    Note over Recon: Lazy freeze if past deadline
    alt already submitted/grading/graded
        Recon-->>Orchestrator: alreadyGraded = true
        Orchestrator-->>Route: return early
    end

    Orchestrator->>Submit: submitAttempt(attemptRepo, gradingWorksetRepo, attemptId, now)
    Submit->>Submit: findByIdForUpdate(attemptId)
    Submit->>Submit: transition(status, submit)
    Submit->>Submit: buildSubmittedAnswersSnapshot(answers, questionSnapshot)
    Note over Submit: FROZEN COPY created here<br/>protocol metadata stripped
    Submit->>DB: UPDATE attempt (submitted, submitted_answers, submittedAt)
    Submit->>Materialize: materializeGradingWorkset(submitted, gradingWorksetRepo)
    Materialize->>DB: INSERT attempt_grading_entries (one per question)

    alt gradingStatus === pending_manual
        Orchestrator-->>Route: hold at submitted (manual grading queue)
    else
        Orchestrator->>Finalize: finalizeGrading(...)
        Finalize->>Finalize: aggregateGradingEntries(attempt, entries, passingScore)
        Note over Finalize: Reads ONLY:<br/>- attempt.questionSnapshot (frozen)<br/>- attempt_grading_entries<br/>NEVER: live questions, draft answers
        Finalize->>DB: UPDATE attempt (graded, score, passed, gradingResult)
        Finalize->>DB: UPDATE enrollment (finalScore, finalPassed, finalAttemptId)
    end

    Orchestrator-->>Route: attempt (committed state)
    Route-->>Candidate: 200 + attempt response
```

**Authority**: `apps/api/src/orchestrators/submitAndGradeAttempt.ts`, `packages/exam-engine/src/attemptCommands.ts`, `gradingWorkset.ts`, `grading.ts`
**Evidence**: `submitAndGradeAttempt` composes submit + grade in ONE transaction under EA lock.
**Known limitations**: Submit carries NO answer payload. The `grading` state is unreachable — auto-graded attempts go directly from `submitted` to `graded`.

### 5.5 Manual Grading Terminal Closure

```mermaid
sequenceDiagram
    actor Grader as Admin/Grader
    participant Route as POST /attempts/:id/grade-question
    participant Cmd as gradeQuestion()
    participant Workset as attempt_grading_entries
    participant Finalize as finalizeTerminalGrading
    participant DB as PostgreSQL

    Grader->>Route: POST /attempts/:id/grade-question
    Note over Route: {attemptId, questionId, score, comment}
    Route->>Route: authenticate + requireScopedCapability(grading.score.write)
    Route->>DB: executeInTransaction

    Route->>Cmd: gradeQuestion(attemptRepo, enrollmentRepo, worksetRepo, capability, questionId, score, comment, graderId, now, exam)

    Cmd->>Cmd: validate attempt.status === submitted
    Cmd->>Cmd: validate attempt.gradingStatus === pending_manual
    Cmd->>Workset: findByAttemptAndQuestion(attemptId, questionId)
    Workset-->>Cmd: entry (gradingMode: manual, status: pending_manual)
    Cmd->>Cmd: validate 0 ≤ score ≤ entry.maxScore
    Cmd->>Workset: completeManualEntry({attemptId, questionId, earnedScore, comment, gradedBy, gradedAt})
    Workset->>DB: UPDATE entry (completed_manual)

    Cmd->>Workset: countPendingManualForAttempt(attemptId)
    alt remaining pending === 0
        Cmd->>Finalize: finalizeTerminalGrading(...)
        Finalize->>Finalize: aggregateGradingEntries(attempt, entries, passingScore)
        Finalize->>DB: UPDATE attempt (graded, score, passed, gradingResult, fully_graded)
        Finalize->>DB: UPDATE enrollment (finalScore, finalPassed, finalAttemptId)
        Finalize-->>Cmd: true
    else remaining pending > 0
        Cmd-->>Route: {gradingStatus: pending_manual, fullyGraded: false}
    end

    Route-->>Grader: 200 + grading result
```

**Authority**: `packages/exam-engine/src/manualGrading.ts`, `grading.ts`
**Evidence**: `gradeQuestion` completes one pending_manual entry and delegates to `finalizeTerminalGrading` when the last one is done.
**Known limitations**: Manual grading completion is one-way. A `completed_manual` entry cannot be revised by the ordinary grading command.

### 5.6 Manual Result Publication

```mermaid
sequenceDiagram
    actor Admin as Admin/Teacher
    participant Route as POST /exams/:id/publish-results
    participant Engine as publishResults()
    participant DB as PostgreSQL

    Admin->>Route: POST /exams/:id/publish-results
    Route->>Route: authenticate + requireCapability(exam.result.publish)
    Route->>DB: executeInTransaction

    Route->>Engine: publishResults(repo, examId, now)
    Engine->>Engine: validate status ∈ {published, open, closed}
    alt resultsPublishedAt already set
        Engine-->>Route: {exam, alreadyPublished: true}
    else first publish
        Engine->>DB: UPDATE exams (resultsPublishedAt = now)
        Engine-->>Route: {exam, alreadyPublished: false}
        Route->>Route: recordAtomicHttpAudit(exam.publish_results)
    end

    Route-->>Admin: 200 + {ok: true, resultsPublishedAt, alreadyPublished}
```

**Authority**: `apps/api/src/routes/exam.ts`, `packages/exam-engine/src/examCommands.ts`
**Evidence**: Route uses `executeInTransaction` → `publishResults()` → `recordAtomicHttpAudit(action: "exam.publish_results")`. No route-level reconciliation step.
**Known limitations**: Publish does NOT advance grading. If grading is still pending, results stay hidden behind `not_graded` hiddenReason.

### 5.7 Email Worker Claim/Send/Retry/Dead

```mermaid
sequenceDiagram
    participant Worker as Email Worker
    participant Outbox as email_outbox
    participant SMTP as SMTP Provider

    loop Every pollIntervalMs (default 5s)
        Worker->>Outbox: recoverAbandoned(orgId, now, lockTimeout)
        Outbox->>Outbox: UPDATE processing → pending WHERE lockedAt < cutoff

        Worker->>Outbox: claimDue(orgId, now, workerInstanceId, batchSize)
        Outbox->>Outbox: SELECT due pending/retry_wait<br/>FOR UPDATE SKIP LOCKED<br/>LIMIT batchSize<br/>UPDATE → processing
        Outbox-->>Worker: claimed rows

        loop For each claimed row
            Worker->>SMTP: sender.send(row)
            alt success
                Worker->>Outbox: markSent(row.id, sentAt, providerMessageId, workerInstanceId)
                Outbox->>Outbox: UPDATE status=sent (ownership-fenced)
            else failure, attempts < max
                Worker->>Outbox: markRetryWait(row.id, attemptCount, lastError, nextAttemptAt, workerInstanceId)
                Outbox->>Outbox: UPDATE status=retry_wait (ownership-fenced)
            else failure, attempts >= max
                Worker->>Outbox: markDead(row.id, attemptCount, lastError, workerInstanceId)
                Outbox->>Outbox: UPDATE status=dead (ownership-fenced)
            end
        end
    end
```

**Authority**: `apps/api/src/plugins/emailOutboxLoop.ts`, `packages/db/src/repository/emailOutboxRepo.ts`, `apps/api/src/email/outboxService.ts`
**Evidence**: The in-process loop polls, claims via `FOR UPDATE SKIP LOCKED`, sends outside transaction, marks result with ownership fence (#320 CONVERGE).
**Known limitations**: At-least-once delivery (crash after SMTP acceptance but before markSent causes duplicate). No production business caller enqueues emails (P5-N1 scope).

---

## 6. Security Boundary Diagram

```mermaid
flowchart TB
    subgraph Client["Client (Browser)"]
        Cookie["HTTP-only Cookie<br/>auth-token (JWT)"]
        UI["Web UI<br/>React + Vite"]
    end

    subgraph APILayer["API Layer (Fastify)"]
        Auth["authenticate<br/>verify JWT + loadAssignmentAuthority"]
        CapGate["requireCapability<br/>ctx.capabilities.includes(perm)"]
        OrgBoundary["Organization Boundary<br/>ctx.organizationId filtering"]
        Ownership["Resource/Ownership Resolver<br/>attemptResolver / examResolver"]
        TxLock["EA Lock Seam<br/>Enrollment → Attempt → Exam"]
        SnapshotBoundary["Snapshot Boundary<br/>grading reads frozen copies only"]
        CandidateProjection["Candidate-Safe Projection<br/>standardAnswer stripped<br/>rubric absent"]
    end

    subgraph Domain["Domain Engine"]
        Commands["Command Functions<br/>publishExam, submitAttempt, ..."]
        StateMachine["State Machines<br/>assertTransition"]
    end

    subgraph DB["PostgreSQL"]
        BusinessTables["Business Tables<br/>+ organizationId on every row"]
        EmailOutbox["email_outbox<br/>ownership fence (lockedBy)"]
        AuditLog["audit_logs<br/>append-only"]
    end

    subgraph Worker["Background Worker"]
        EmailFence["Email Worker Ownership Fence<br/>claimDue FOR UPDATE SKIP LOCKED<br/>markSent/markDead ownership-fenced"]
    end

    Cookie --> Auth
    UI --> Cookie
    Auth --> CapGate
    CapGate --> OrgBoundary
    OrgBoundary --> Ownership
    Ownership --> TxLock
    TxLock --> Commands
    Commands --> StateMachine
    Commands --> SnapshotBoundary
    SnapshotBoundary --> CandidateProjection
    Commands --> BusinessTables
    Commands --> SnapshotBoundary
    BusinessTables --> AuditLog
    EmailFence --> EmailOutbox

    style Cookie fill:#ccffcc,stroke:#00cc00
    style Auth fill:#ccffcc,stroke:#00cc00
    style CapGate fill:#ccffcc,stroke:#00cc00
    style OrgBoundary fill:#ccffcc,stroke:#00cc00
    style Ownership fill:#ccffcc,stroke:#00cc00
    style TxLock fill:#ccccff,stroke:#0000cc
    style SnapshotBoundary fill:#ffcccc,stroke:#ff0000
    style CandidateProjection fill:#ffcccc,stroke:#ff0000
    style EmailFence fill:#ffffcc,stroke:#cccc00
```

**Trust boundaries**:
- **Green** (authentication/authorization): Cookie → authenticate → capability gate → org boundary → ownership resolver
- **Blue** (transactional): EA lock seam serializes concurrent mutations
- **Red** (data protection): Snapshot boundary ensures grading reads frozen copies; Candidate projection strips standardAnswer/rubric
- **Yellow** (infrastructure): Email worker ownership fence prevents stale-lock corruption

**Authority**: `apps/api/src/plugins/auth.ts`, `authz.ts`, `packages/exam-engine/src/lockSeam.ts`, `apps/api/src/routes/attempts.shared.ts`
**Evidence**: Each boundary maps to documented code. `loadAssignmentAuthority` resolves from `user_role_assignments`. `computeAnswerVisibility` always returns hidden.
**Known limitations**: Teacher resource-scope (Teacher@course) is NOT IMPLEMENTED — capabilities are flat org-wide. IP/CIDR, device binding, emergency access are NOT IMPLEMENTED.
