# ADR-012 — Candidate Recovery Contract and Threat Model

## Status

Accepted

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

### Authoritative answer

For each attempt question: the highest `serverVersion` accepted by the
server under the save protocol.

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

These failure classes are NOT equivalent and must not be treated as such.

---

## Save Operation Model

### Operation fields

```text
operationId       — stable identity for one logical answer update
attemptId
questionId
clientSeq         — per-question monotonic client sequence
baseVersion       — expected current serverVersion
answer payload
clientSavedAt     — client-observed changedAt (diagnostic only)
```

### Server result fields

```text
accepted          — boolean
serverVersion     — authoritative version after operation
savedAt           — server acceptance timestamp
operationId       — receipt identity (or equivalent)
conflict reason   — when rejected
```

### Invariants

**Stable operation identity**: Each logical answer update receives one
stable `operationId`. Retries of the same logical operation reuse the same
operationId.

**Idempotent replay**: Same operationId + same semantic payload → return
the original accepted result without another write. (CURRENT_INVARIANT —
implemented via `clientSeq` idempotency in `processSaveAnswer`.)

**Conflicting replay**: Same operationId + different semantic payload →
reject as conflicting payload. (CURRENT_INVARIANT — implemented via
`CONFLICTING_PAYLOAD` rejection.)

**Version protection**:

- `baseVersion == current serverVersion` → may be accepted
- `baseVersion < current serverVersion` → reject as stale
- `baseVersion > current serverVersion` → reject as invalid/future version

(CURRENT_INVARIANT — implemented via `STALE_VERSION` rejection.)

**Server time authority**: The server controls `savedAt`, deadline checks,
lease expiry, submission validity, time compensation. Client timestamps are
diagnostic only. (CURRENT_INVARIANT — ADR-006.)

---

## Local Journal Abstraction (TARGET)

Implementation-neutral interface:

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

### Deadline extension attribution (TARGET)

Every future deadline extension must be attributable to: policy, incident,
operator action, or system-wide outage.

And must record: `beforeDeadline`, `afterDeadline`, `addedSeconds`,
`reason`, `source`, `actor` (when applicable), `incidentId` (when
applicable).

---

## Security Boundaries

### Network-interruption trust boundaries

For ordinary Web exams: local persistence can prove that this browser
currently holds data. It CANNOT prove that the candidate did not use another
device, another person, external materials, modified JavaScript, or modified
local storage.

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

Frozen rules:

- A second tab/device must not silently overwrite newer server state.
- A stale client must receive a visible conflict result.
- Device takeover must invalidate or supersede the previous active writer.
- High-risk supervised device takeover may require operator approval.

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

- REC-I1 through REC-V1 are governed by this contract.
- The current full-compensation restore behavior is documented as
  transitional, not permanent.
- The explicit restore route is preserved for future frontend adoption.
- Local journal implementation is authorized but not started.
- Time-policy configuration is deferred to product decision.
- Multi-tab conflict UX is deferred to implementation Jobs.

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

| Job | Scope |
|---|---|
| REC-I1 | Web pending-answer journal (IndexedDB adapter) |
| REC-I2 | Save acknowledgement and replay reconciliation |
| REC-I3 | Disrupted-attempt recovery UX |
| REC-I4 | Interruption and time-compensation policy |
| REC-I5 | Recovery telemetry and correlation |
| REC-I6 | Operator incident timeline |
| REC-V1 | Crash/network verification |
