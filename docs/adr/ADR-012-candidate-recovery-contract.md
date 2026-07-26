# ADR-012 — Candidate Recovery Contract and Threat Model

## Status

Accepted

## Metadata

| Field | Value |
|---|---|
| Date | 2026-07-26 |
| Decision owners | jnhu76 |
| Supersedes | — |
| Superseded by | — |
| Related decisions | ADR-004 (desktop, deferred), ADR-005 (exam operation state baseline), ADR-006 (exam time authority), ADR-008 (submit answer freeze barrier) |

## Context

The exam platform implements a server-authoritative Answer Save Protocol
(versioned, idempotent, conflict-detecting) backed by PostgreSQL. Candidates
take exams in a browser; answers are debounced and sent to the server via
HTTP POST. A heartbeat scanner detects disconnection and marks attempts as
`disrupted`. A `restoreAttempt` command transitions disrupted attempts back
to `in_progress`, compensating disconnected time by extending `deadlineAt`
bounded by `exam.closeAt`.

Current gaps identified by audit:

- Unconfirmed answer edits exist only in browser memory (React refs) during
  the debounce/request window. A page refresh or browser crash loses them.
- The Web client has no durable pending-answer journal.
- The explicit `POST /attempts/:attemptId/restore` route exists but has no
  current Web frontend caller.
- Directly opening `/take/:attemptId` for a disrupted attempt returns the
  snapshot but does not complete the restore workflow.
- `restoreAttempt` automatically returns the full disconnected duration as
  time compensation, bounded only by `exam.closeAt`. This is not a safe
  permanent default.
- No multi-tab or multi-device conflict detection exists beyond the
  server-side version protocol.
- The version protocol does NOT reject `baseVersion > currentVersion`
  (future version). A client sending `baseVersion=999` against
  `currentVersion=2` is accepted. This is a known defect, not a design
  choice. The TARGET_INVARIANT (strict equality) is frozen here; the
  runtime fix is owned by REC-I2a.

This ADR freezes the recovery contract, authority model, failure taxonomy,
save-operation semantics, local journal abstraction, time-compensation policy
direction, security boundaries, and observability requirements — establishing
a stable foundation for implementation Jobs REC-I1 through REC-V1.

## Decision

Freeze the candidate exam recovery contract as specified below. This is a
design and policy decision; no runtime implementation is included.

---

## Product Scope

The implemented product is a **reliable Web examination system**.

A future secure desktop client is an optional delivery layer for unusually
strict examinations, not a prerequisite for ordinary Web exams.

```text
deliveryMode = web          (current, implemented)
deliveryMode = secure_desktop  (future, optional, not promised here)
```

A Web exam supports: practice, course assessment, internal training,
ordinary supervised classroom exams, general recruitment screening.

It does NOT claim that ordinary browser telemetry can prove that the
candidate did not use another device, another person, or external materials.

---

## Authority Model

### Server-confirmed answer

An answer version that:

- was accepted by the authoritative save protocol (`processSaveAnswer`)
- was committed to PostgreSQL (`exam_attempts.answers`)
- has an authoritative `serverVersion`
- has a server acceptance timestamp (`savedAt`)

### Pending local operation (TARGET)

A candidate edit that:

- has been durably written to the client journal
- has not yet received authoritative server acknowledgement

### In-memory edit (CURRENT)

A candidate edit that:

- has not yet been durably written locally
- has not been server-confirmed

The target architecture must minimize or eliminate this state.

### Authoritative answer — three-phase model

**During attempt (draft authority)**:

For each attempt question: the highest `serverVersion` accepted by the
server under the save protocol in `exam_attempts.answers`.

**At submission (freeze barrier)**:

`submitAttempt` freezes the current draft answers into
`exam_attempts.submitted_answers` within the submit transaction (ADR-008).
The frozen snapshot is the exact answer set read under the row lock.

**After submission (grading authority)**:

`submitted_answers` and the grading workset derived from it are the sole
scoring authority. Grading reads the frozen `submitted_answers` snapshot,
NOT the mutable draft `answers` column. The draft `answers` column is
immutable after submission (the save protocol rejects writes to
submitted/grading/graded attempts).

**Recovery constraint**:

Recovery flows must NOT modify `answers`, `submitted_answers`, or the
grading workset of a submitted/grading/graded attempt.

Authority is NOT:

- latest client timestamp
- latest packet received regardless of version
- latest local journal value
- highest clientSeq without server acceptance
- candidate assertion

### PostgreSQL sole authority

PostgreSQL remains the sole authority for:

- attempt lifecycle
- confirmed answers
- effective deadline
- submission state
- submitted answer snapshot
- grading workset
- final result

Local storage is recovery material, not a second authoritative answer store.

---

## Failure Taxonomy

### A. Network interruption

The client remains usable. The candidate may still enter answers locally.
The server cannot immediately confirm those answers.

Examples: Wi-Fi loss, temporary LAN outage, API unreachable from one
client, request timeout, response lost after server commit.

### B. Client process interruption

The browser tab, browser process, or future desktop process stops running.
The same device may later restart and recover local storage.

Examples: page refresh, tab close, browser crash, application crash,
operating-system restart.

### C. Device loss or replacement

The original local storage may no longer be available. A replacement device
can recover only server-confirmed state unless a separate approved transfer
mechanism exists.

Examples: computer hardware failure, disk failure, candidate moved to
another workstation, original device is unavailable.

### D. Server-side outage

Multiple candidates may be unable to synchronize or participate. The
service can potentially prove the affected outage interval.

Examples: API outage, database outage, server restart, network outage
affecting the examination site.

### E. Concurrent client activity

More than one tab, browser, process, or device attempts to edit the same
attempt.

### F. Client persistence failure (TARGET)

The local journal storage itself becomes unavailable or unreliable.

Examples: IndexedDB unavailable, `QuotaExceededError`, transaction abort,
database corruption, private-browsing mode limitations, browser storage
eviction, disk full.

Frozen rules:

- A journal write failure must NEVER result in a `saved_locally` UI state.
- The system must either degrade to server-only mode with a persistent
  warning, or (for exams requiring high durability assurance) prevent
  starting or continuing the attempt.
- Storage eviction by the browser is treated as data loss for unsynced
  operations; server-confirmed state is unaffected.
- REC-I1 must define detection, degradation, and user notification behavior.

These failure classes are NOT equivalent and must not be treated as such.

---

## Save Operation Model

### Current operation identity (CURRENT)

The current implementation identifies a logical save operation by the
composite key:

```text
(attemptId, questionId, clientSeq)
```

`clientSeq` is a per-question client-assigned monotonic integer. The server
persists `clientSeqHistory` for replay detection but does NOT independently
validate monotonicity or assign a server-side operation identifier. The
current response does not return a standalone `operationId` field.

Limitations of the current identity:

- The server does not verify that `clientSeq` is strictly monotonic.
- After a browser crash with no durable journal, the client may not be able
  to reproduce the same `clientSeq` for replay.
- There is no server-issued receipt identity separate from the composite key.

### Target semantic identity (TARGET — OPEN_DECISION, owned by REC-I2)

The target protocol requires:

```text
operationId — stable identity for one logical answer update
```

Whether the target uses an independent `operationId` wire field, or continues
to use the existing `(attemptId, questionId, clientSeq)` composite identity
with enhanced validation, is an **OPEN_DECISION** owned by REC-I2. REC-I1
must NOT embed a specific operationId format into the IndexedDB schema before
this decision is frozen.

### Operation fields (semantic model — NOT a wire format)

```text
operationId       — TARGET semantic field; wire format undecided (REC-I2)
attemptId
questionId
clientSeq         — per-question monotonic client sequence (CURRENT)
baseVersion       — expected current serverVersion
answer payload
clientSavedAt     — client-observed changedAt (diagnostic only)
```

These field names describe the semantic model. The concrete transport format
(request body shape, header placement, field naming) is owned by REC-I2.

### Server result fields (semantic model)

```text
accepted          — boolean
serverVersion     — authoritative version after operation
savedAt           — server acceptance timestamp
operationId       — TARGET receipt identity (wire format undecided)
conflict reason   — when rejected
```

### Invariants

**Stable operation identity (TARGET)**: Each logical answer update receives
one stable identity. Retries of the same logical operation reuse the same
identity. The mechanism (composite key vs standalone field) is decided by
REC-I2.

**Idempotent replay (CURRENT_INVARIANT)**: Same identity + same semantic
payload → return the original accepted result without another write.
Implemented via `(questionId, clientSeq)` idempotency key and `answersEqual`
comparison in `processSaveAnswer`.

**Conflicting replay (CURRENT_INVARIANT)**: Same identity + different
semantic payload → reject as conflicting payload. Implemented via
`CONFLICTING_PAYLOAD` rejection.

**Version protection**:

- `baseVersion < current serverVersion` → reject as stale
  (CURRENT_INVARIANT — implemented via `STALE_VERSION` rejection.)
- `baseVersion >= current serverVersion` → currently may be accepted
  (CURRENT behavior — the server unconditionally assigns
  `currentVersion + 1` without checking for future baseVersion.)

**KNOWN_DEFECT (FUTURE_BASEVERSION)**: The current protocol does NOT reject
`baseVersion > currentVersion`. A request with `baseVersion=999` against
`currentVersion=2` is accepted. The request schema only validates
`baseVersion >= 0`. This is a gap, not a designed behavior.

**TARGET_INVARIANT (REC-I2)**: `baseVersion` must strictly equal
`currentVersion`. Future `baseVersion` (greater than current) must be
rejected with an explicit error code. Runtime fix is owned by REC-I2 and
must NOT be included in this documentation PR.

**Server time authority (CURRENT_INVARIANT)**: The server controls `savedAt`,
deadline checks, lease expiry, submission validity, time compensation. Client
timestamps are diagnostic only. (ADR-006.)

---

## Local Journal Abstraction (TARGET)

### Offline multiple-edit semantics (TARGET — must be frozen before REC-I1)

When a candidate edits the same question multiple times while offline, the
system must NOT produce a chain of stale operations that replay incorrectly.

**Problem**: If the journal stores every edit as an independent operation
with the same `baseVersion`, sequential replay causes only the FIRST
operation to succeed; the candidate's LATEST intent is rejected as stale.

**Frozen model — DurableAnswerDraft + SaveOperationOutbox**:

```text
DurableAnswerDraft (per question):
  Stores the candidate's latest intent.
  Each edit overwrites the previous draft for that question.
  Contains: questionId, latest answer payload, localChangedAt, draftSeq.

SaveOperationOutbox (per operation):
  Generated ONLY when preparing to send to the server.
  Contains: operationId, baseVersion (from last known serverVersion),
  answer payload (from current draft), sync state.
  Once sent, operationId and baseVersion are immutable.
```

**Offline edit flow**:

```text
candidate edits question Q (offline)
→ overwrite DurableAnswerDraft[Q] with latest answer
→ no network operation is generated yet

candidate edits question Q again (offline)
→ overwrite DurableAnswerDraft[Q] again
→ still no network operation

candidate reconnects
→ read server currentVersion for Q
→ generate ONE SaveOperation from latest draft + current serverVersion
→ send to server
```

**In-flight / uncertain operation handling**:

```text
If a previously sent operation is uncertain (response lost):
→ retry with same operationId (idempotent replay)
→ if accepted: acknowledge, update known serverVersion
→ if conflict: mark conflict, fetch new serverVersion
→ THEN generate a new operation from the latest draft if it differs
  from the acknowledged server state
```

**Constraints**:

- The journal must NOT store an append-only chain of all offline edits as
  independent server-bound operations.
- Unsent drafts are compressible: only the latest per question matters.
- Sent-but-uncertain operations must be resolved before new operations for
  the same question are generated.
- `supersedesOperationId` or equivalent may be added by REC-I2 if the
  outbox model requires explicit supersession tracking.

This model must be validated and frozen by REC-I2 BEFORE REC-I1 implements
the IndexedDB schema. REC-I1 stores the DurableAnswerDraft and
SaveOperationOutbox as separate concerns, not a single flat operation list.

### Implementation-neutral interface

```ts
interface PendingAnswerJournal {
  put(entry: PendingAnswerEntry): Promise<void>;
  listForAttempt(scope: AttemptJournalScope): Promise<PendingAnswerEntry[]>;
  markInFlight(scope: AttemptJournalScope, operationId: string): Promise<void>;
  acknowledge(scope: AttemptJournalScope, operationId: string, receipt: ServerSaveReceipt): Promise<void>;
  markConflict(scope: AttemptJournalScope, operationId: string, conflict: SaveConflict): Promise<void>;
  deleteAcknowledged(scope: AttemptJournalScope): Promise<void>;
  clearAttempt(scope: AttemptJournalScope, reason: JournalClearReason): Promise<void>;
}
```

Journal scope must include: `organizationId`, `userId`, `examId`,
`attemptId`.

A future desktop implementation may additionally include: `installationId`,
`deviceId`, `journalFormatVersion`.

Intended adapters:

- Web: `IndexedDBPendingAnswerJournal`
- Future desktop: `SQLitePendingAnswerJournal`

Both must implement the same semantic contract. React component state is
NOT part of the persistence abstraction.

---

## Write Ordering (TARGET)

```text
candidate changes answer
→ persist pending operation to local journal
→ update or confirm UI state
→ send operation to server
→ receive authoritative acknowledgement
→ mark operation acknowledged locally
→ compact or remove acknowledged entry
```

The journal write must happen before relying on the network request.

A periodic synchronization loop may be added later as a repair mechanism,
but periodic autosave must not be the only durability mechanism.

### UI truth states (TARGET)

```text
editing
saved_locally
syncing
saved_to_server
sync_failed
conflict
submitted
```

Generic UI text such as `saved` must not represent both local and server
durability.

---

## Recovery Semantics

### Browser refresh or same-device restart (TARGET)

Recovery must:

1. load the authoritative server snapshot
2. load pending local operations for the same organization/user/attempt
3. compare operation receipts and server versions
4. discard or acknowledge already-committed operations
5. replay safe pending operations
6. surface conflicts instead of silently overwriting
7. enter the attempt only after recovery state is known

### Disrupted attempt

Recovery must be an explicit command.

**CURRENT_TRANSITIONAL**: The current `restoreAttempt` command combines
lifecycle restoration (disrupted → in_progress) AND full disconnected-time
compensation in a single operation. This coupling is NOT the target contract.

**TARGET**: State restoration and time compensation are independent decisions:

```text
restoreAttemptState()          — lifecycle transition only
evaluateInterruptionTimePolicy() — compensation decision (REC-I4)
```

Preferred semantic flow:

```text
GET take snapshot
→ server returns attemptStatus=disrupted and canResume=true
→ client invokes explicit restore command
→ server reconciles deadline/submission first
→ server restores only if still legally resumable
→ client reloads authoritative take snapshot
```

An ordinary read endpoint must not silently grant time or change lifecycle
state. The explicit restore route must not be removed merely because the
current Web client does not call it.

### Device replacement

A replacement device recovers: server-confirmed answers, authoritative
remaining time, authoritative attempt state.

It does NOT automatically recover: pending operations stored only on the
unavailable original device.

Future encrypted transfer or offline submission packages are separate Jobs.

---

## Time Policy

Recovering answer/state is separate from granting additional exam time.

The existing behavior of automatically returning the full disconnected
duration is NOT a permanent contract.

### Interruption time policy model (TARGET)

```ts
type InterruptionTimePolicy =
  | "strict"
  | "bounded_grace"
  | "operator_incident";
```

**strict**: Interruption does not stop exam time. The candidate may recover
state but receives no automatic time extension.

**bounded_grace**: A small, explicitly configured technical grace may be
applied. Grace must have a per-incident and/or per-attempt aggregate cap.

**operator_incident**: Recovery does not itself extend time. An authorized
operator records an incident and explicitly grants time.

### Frozen direction

Full disconnect-time compensation is NOT a safe default.

Where exact seconds are undecided, define named configuration and
invariants, not magic numbers.

### Trust distinction (frozen)

```text
Personal network interruption (Class A):
  Disconnect duration is client-claimed, NOT fully trusted.
  Does NOT automatically entitle the candidate to equivalent time.
  Time policy (strict / bounded_grace) governs any compensation.

Server-side outage (Class D):
  Incident interval is server-observable and operator-confirmable.
  May justify system-wide compensation or exam clock suspension.
  Specific compensation algorithm is NOT frozen here;
  owned by REC-I4 (policy) and REC-I6 (operator incident timeline).
```

REC-R1 freezes that these two classes are different and must not share
the same compensation logic. The specific compensation algorithm is
deferred.

### Deadline extension attribution (TARGET)

Every future deadline extension must be attributable to: policy, incident,
operator action, or system-wide outage.

And must record: `beforeDeadline`, `afterDeadline`, `addedSeconds`,
`reason`, `source`, `actor` (when applicable), `incidentId` (when
applicable).

---

## Security Boundaries

### Network-interruption trust boundaries

For ordinary Web exams: local persistence can retain recovery data for the
same browser profile. It does NOT provide trustworthy proof to the server
that the data is authentic, complete, timely, or produced without external
assistance.

It CANNOT prove that the candidate did not use another device, another
person, external materials, modified JavaScript, or modified local storage.

Hash chains, local timestamps, IndexedDB, client signatures, and
zero-knowledge proofs alone do NOT prove that no cheating occurred during
disconnection.

### Offline answer policy hooks (TARGET, not implemented)

```ts
type OfflineAnswerPolicy =
  | "continue_and_sync"
  | "bounded_window"
  | "lock_when_offline"
  | "operator_review";
```

The standard Web product may use different policy choices per exam, but the
protocol must remain the same.

Zero-knowledge proofs, remote attestation, TPM, TEE, and lockdown-browser
features are explicitly deferred.

### Local storage security (TARGET)

The journal may contain only minimum recovery data: `organizationId`,
`userId`, `examId`, `attemptId`, `questionId`, `operationId`, `clientSeq`,
`baseVersion`, `answer`, `changedAt`, sync state, journal format version.

It must NOT contain: standard answers, grading truth, rubrics not already
visible to candidates, hidden explanations, other candidates' data,
administrator data, cookies, authentication tokens, passwords, full API
responses, unrestricted request bodies.

Required isolation: `organization + user + attempt`. A newly authenticated
user must never receive another user's pending journal.

Cleanup triggers: authoritative submission, attempt void/freeze when no
longer editable, explicit secure logout handling, user identity change,
retention expiry, exam or attempt deletion signal.

Encrypting IndexedDB with a key available to the same JavaScript runtime
does NOT protect against active XSS.

Primary Web protections: data minimization, short retention, identity
isolation, strict CSP, XSS prevention, httpOnly authentication cookies,
secure cleanup.

---

## Concurrent-Client Semantics (TARGET)

One authoritative server answer version per question.

The later Web implementation should support a single active writer where
practical. Potential adapters: Web Locks API, BroadcastChannel, server-side
active session or lease, desktop single-instance lock.

**Single-writer control is a cooperative UX mechanism, NOT a security
boundary.** Web Locks and BroadcastChannel can be disabled or bypassed by
a determined user. The server `baseVersion`/`serverVersion` check is the
final integrity protection. Any client can call the API directly without
acquiring a frontend lock; the server must independently reject stale writes.

Frozen rules:

- A second tab/device must not silently overwrite newer server state.
- A stale client must receive a visible conflict result.
- Device takeover must invalidate or supersede the previous active writer.
- High-risk supervised device takeover may require operator approval.
- Frontend lock mechanisms improve UX by reducing conflicts; they do not
  replace server-side version enforcement.

---

## Submission Recovery

Submission must be idempotent. (CURRENT_INVARIANT — implemented via
`submitAttempt` idempotent already-submitted path.)

Required behavior:

```text
candidate submits
server commits submission
response is lost
candidate reconnects
→ server returns existing submission result
→ attempt is not submitted twice
→ submitted answers are not rebuilt differently
→ grading workset is not duplicated
```

### Pre-submission barrier (TARGET)

#### Candidate voluntary submission

```text
Before allowing submit:
  client reconciles pending operations

  IF no pending / uncertain / conflict operations remain:
    → allow normal submit

  IF unresolved operations exist:
    → block submit by default
    → display explicit warning with unresolved count
    → offer destructive override option:
      "Submit only server-confirmed answers"
      (requires explicit secondary confirmation;
       records incident metadata with unresolved count)
```

The server freezes only what it has confirmed. Local pending operations
that never reached the server do NOT automatically enter the submitted
answer set.

#### Deadline auto-submission (server-side)

```text
Deadline arrives:
  server freezes current confirmed draft answers
  unresolved local pending data does NOT enter the submission
  incident metadata records the existence of unresolved local state
  (if known from last client telemetry)
```

The server cannot wait for the client. This is legitimate behavior.

#### Admin/proctor force-submission

```text
Admin forces submit:
  server freezes confirmed draft answers
  records: operator identity, reason, unresolved pending count (if known)
```

### Post-submission journal handling

After authoritative submission:

- the client journal for that attempt must no longer be editable
- pending entries must be reconciled or preserved only as incident evidence
- answer data must be removed according to the cleanup policy

---

## Desktop Portability

The future desktop client must reuse: attempt lifecycle, save operation
contract, operationId semantics, baseVersion/serverVersion semantics,
restore command, submission semantics, telemetry vocabulary, incident model.

It may replace only the adapters: IndexedDB → SQLite, browser session →
desktop installation/session, browser lifecycle → desktop process
lifecycle, browser credential handling → OS credential store.

ADR-004 selects Electron as the future desktop shell (deferred). This
decision is preserved but not implemented here.

A desktop wrapper is NOT automatically a secure lockdown browser.

---

## Observability Requirements (TARGET)

Future recovery implementations must emit events for:

```text
answer_changed, answer_persisted_locally, answer_sync_started,
answer_sync_succeeded, answer_sync_failed, answer_sync_uncertain,
answer_conflict,
network_offline, network_online,
interruption_detected, restore_started, restore_succeeded, restore_failed,
pending_journal_found, pending_replay_started, pending_replay_succeeded,
pending_replay_conflict,
device_takeover_requested, device_takeover_succeeded, device_takeover_failed,
incident_created, time_extension_granted
```

Telemetry must contain identifiers and counts, not answer contents.

Allowed: `attemptId`, `examId`, `questionId`, `operationId`,
`clientSessionId`, `pendingCount`, `replayedCount`, `conflictCount`,
`durationMs`, `errorCode`, `requestId`, `releaseVersion`.

Forbidden: candidate answer, question text, standard answer, rubric,
password, token, cookie, Authorization header, full request/response body.

---

## Consequences

- REC-I3 through REC-V1 are governed by this contract.
- The current full-compensation restore behavior is documented as
  transitional, not permanent. REC-I4 owns the policy change.
- The explicit restore route is preserved for future frontend adoption
  (REC-I3).
- Local journal implementation is authorized but must not begin before
  REC-I2a freezes the data model (DurableAnswerDraft + SaveOperationOutbox).
- Time-policy configuration is deferred to product decision (REC-I4).
- Multi-tab conflict UX is deferred to REC-I2b.
- The `baseVersion > currentVersion` known defect is documented; runtime
  fix is owned by REC-I2a and is NOT part of this documentation PR.
- `submitted_answers` is affirmed as the post-submission grading authority
  per ADR-008; recovery flows must not modify it.

## Rejected Alternatives

| Alternative | Reason rejected |
|---|---|
| React state as recovery storage | Lost on refresh/crash; not durable |
| Periodic server autosave as the only durability mechanism | Loses edits between intervals; no local durability |
| localStorage for sensitive answer journals | Synchronous, size-limited, no structured isolation, cleared by user |
| Full disconnect-time compensation as an implicit default | Abuse vector; not bounded; not attributable |
| Client timestamps as deadline authority | Client clock is untrusted; server is time authority (ADR-006) |
| Silent last-writer-wins | Loses data; no conflict visibility; violates version protocol |
| Automatic merge/CRDT for conflicting exam answers | Exam answers are atomic per question; merge semantics undefined |
| Zero-knowledge proofs as proof of no cheating | ZKP proves data integrity, not real-world candidate behavior |
| Ordinary GET requests silently restoring lifecycle state | Violates command/query separation; side effects must be explicit |
| Building a desktop client in REC-R1 | Out of scope; ADR-004 defers desktop implementation |

## Deferred Work

| Job | Scope | Dependency |
|---|---|---|
| REC-I3 | Disrupted-attempt recovery UX (explicit frontend restore) | None — server route exists |
| REC-I4 | Interruption and time-compensation policy | REC-I3 (restore must work before policy changes) |
| REC-I2a | Protocol hardening: operation identity freeze, future baseVersion fix, replay receipt, offline supersession model | REC-I4 (time policy independent) |
| REC-I1 | Web pending-answer journal (IndexedDB adapter): DurableAnswerDraft + SaveOperationOutbox + isolation + cleanup | REC-I2a (data model must be frozen first) |
| REC-I2b | Recovery reconciliation, replay, and conflict UX | REC-I1 (journal must exist) |
| REC-I5 | Recovery telemetry and correlation | REC-I2b |
| REC-I6 | Operator incident timeline | REC-I4 |
| REC-V1 | Crash/network verification | REC-I2b |

### Job order rationale

The order is risk-priority, not pure architecture-dependency:

1. **REC-I3 first**: directly fixes "crashed candidate is locked out" (P1
   user-facing blocker). Small scope — the server route already exists and
   is tested; only a frontend caller is needed.
2. **REC-I4 second**: removes the "restore = full compensation" permanent
   semantic (P1 abuse vector). Independent of journal.
3. **REC-I2a third**: freezes the data model (operation identity,
   baseVersion strictness, offline supersession) so REC-I1 does not embed
   an undecided schema.
4. **REC-I1 fourth**: implements IndexedDB storage against a stable
   semantic contract.
5. **REC-I2b fifth**: completes the reconciliation and conflict UX on top
   of the journal.

REC-I3 and REC-I4 are independent of each other and may proceed in
parallel. REC-I1 must NOT begin before REC-I2a freezes the storage model.

## Related Decisions

| ADR | Relationship |
|---|---|
| ADR-004 | Desktop/Electron deferred. ADR-012 preserves the decision; desktop reuses recovery contract adapters. |
| ADR-005 | Exam operation state baseline. ADR-012 does not modify exam lifecycle states or transitions. |
| ADR-006 | Exam time authority. ADR-012 reaffirms `fastify.now()` as sole clock; does not redefine `now`. |
| ADR-008 | Submit answer freeze barrier. ADR-012 adopts ADR-008's `submitted_answers` as post-submission grading authority. |

### Document authority boundaries

```text
candidate-recovery.md
  Responsible for: recovery semantics, sequence diagrams, decision matrices.

state-and-authority.md
  Responsible for: lifecycle states, authority boundaries, state machines.

ADR-012
  Responsible for: design decisions, trade-offs, frozen contract.
```

In case of conflict, the ADR governs design decisions; the architecture
documents govern descriptive state modeling.
