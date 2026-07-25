# State and Authority Model

> Normative description of the exam system's lifecycle states, sub-process states, policies, and fact timestamps. Explains why these must not be collapsed into one giant state enum.

## Why these must not be collapsed

The system has **five orthogonal state dimensions**:

1. **Exam lifecycle status** — the publication/operation state of the exam container.
2. **Attempt lifecycle status** — the execution state of one candidate's attempt.
3. **Attempt grading status** — the scoring pipeline state, orthogonal to attempt lifecycle.
4. **Enrollment status** — the candidate's overall qualification state for an exam.
5. **Email outbox status** — the delivery lifecycle of an email record.

Collapsing these into one enum would create a combinatorial explosion (6 × 8 × 3 × 4 × 5 = 2,880 theoretical combinations, most illegal) and make it impossible to reason about one dimension independently. Each dimension has its own transitions, its own commands, and its own invariants.

---

## 1. Exam Lifecycle Status

### States

| State | Meaning | Candidates can start attempts? |
|-------|---------|-------------------------------|
| `draft` | Being configured by Admin | No |
| `published` | Released; visible to candidates; `now < openAt` | Yes (OPEN_STATUSES includes published) |
| `open` | `now >= openAt`; actively accepting attempts | Yes |
| `closed` | Normal end (`now >= closeAt` or admin close) | No |
| `canceled` | Abnormal cancellation | No |
| `archived` | Terminal archive; read-only | No |

### Legal transitions

```
draft → [published]
published → [draft, open, canceled, archived]
open → [closed, canceled]
closed → [archived]
canceled → [archived]
archived → []  (terminal)
```

### Commands owning each transition

| Transition | Command | Actor |
|------------|---------|-------|
| `draft → published` | `publishExam()` | Admin |
| `published → draft` | `unpublishExam()` | Admin |
| `published → open` | `openExam()` (or `checkAndUpdateExamStatus()`) | Admin / System (lazy) |
| `open → closed` | `closeExam()` (or `checkAndUpdateExamStatus()`) | Admin / System (lazy) |
| `published → canceled` | `cancelExam()` | Admin |
| `open → canceled` | `cancelExam()` | Admin |
| `published → archived` | `archiveExam()` | Admin |
| `closed → archived` | `archiveExam()` | Admin |
| `canceled → archived` | `archiveExam()` | Admin |

### Preconditions

| Transition | Preconditions |
|------------|--------------|
| `draft → published` | ≥1 question; valid schedule; `timed_window`; manual selection; valid retake policy; totalScore matches question scores; auto questions have standardAnswer; text_response has rubric |
| `published → draft` | After reconciliation, exam is still `published` (`now < openAt`) |
| `published → open` | `now >= openAt` (auto) or admin operation |
| `open → closed` | `now >= closeAt` (auto) or admin close with no unresolved attempts |
| `open → canceled` | Admin cancels; no unresolved attempts |
| `published → canceled` | Admin cancels |
| `any → archived` | From `closed`, `canceled`, or `published` (after reconciliation) |

### Terminal states

`archived` is the sole terminal state. `closed` and `canceled` can transition to `archived`.

### Recovery transitions

None — exam transitions are one-way. The only "recovery" is `published → draft` (unpublish), which is gated by `now < openAt`.

### Forbidden transitions

Any transition not listed in the table above is forbidden. Specifically:
- `open → published` is forbidden.
- `open → draft` is forbidden.
- `canceled → open` is forbidden.
- `archived → anything` is forbidden.

---

## 2. Attempt Lifecycle Status

### States

| State | Meaning | Answers writable? |
|-------|---------|-------------------|
| `not_started` | Enrolled but not started | N/A (no attempt row) |
| `queued` | Waiting for batch entry (Phase 2) | N/A |
| `in_progress` | Actively taking the exam | Yes |
| `disrupted` | Heartbeat timeout; disconnected | No |
| `submitted` | Candidate submitted; frozen | No |
| `grading` | Auto-grading in progress (transient) | No |
| `graded` | All scoring complete | No |
| `voided` | Terminal override | No |

### Reachable states

Only `in_progress`, `disrupted`, `submitted`, and `graded` have write paths in the current implementation. `not_started`, `queued`, `grading`, and `voided` are **target design states with no current write path**.

### Legal transitions

```
in_progress → [submitted, disrupted]
disrupted → [submitted, in_progress]
submitted → [grading]
grading → [graded]
submitted → [graded]  (auto-graded attempts skip "grading" state)
graded → [voided]  (target design — no write path)
```

### Commands owning each transition

| Transition | Command | Actor |
|------------|---------|-------|
| (enrollment) → `in_progress` | `startOrRestoreAttempt()` | Candidate |
| `in_progress → disrupted` | `markDisrupted()` | Heartbeat scanner (System) |
| `disrupted → in_progress` | `restoreAttempt()` | Candidate |
| `in_progress → submitted` | `submitAttempt()` | Candidate / System (deadline) / Admin (force) |
| `disrupted → submitted` | `submitAttempt()` | System (deadline) / Admin (force) |
| `submitted → graded` | `finalizeTerminalGrading()` | System (auto-grade or manual-grade closure) |

### Preconditions

| Transition | Preconditions |
|------------|--------------|
| `startOrRestoreAttempt` | Exam is `published`/`open`; time within `[openAt, closeAt)`; enrollment exists; retake policy allows; late-entry cutoff not passed |
| `markDisrupted` | Attempt is `in_progress`; `lastActivityAt` older than timeout |
| `restoreAttempt` | Attempt is `disrupted`; EA lock held |
| `submitAttempt` | Attempt is `in_progress` or `disrupted`; (candidate-only) `minSubmitAfterStartMinutes` elapsed; zero pre-existing grading entries |
| `finalizeTerminalGrading` | Attempt is `submitted`; workset is fully terminal |

### Terminal states

`graded` is the terminal state for normal flow. `voided` is the terminal override (target design). `submitted` with `pending_manual` is a waiting state — not terminal, but no further automatic progression.

### Recovery transitions

`disrupted → in_progress` via `restoreAttempt()`. The deadline is adjusted to compensate for disconnected time: `newDeadline = oldDeadline + disconnectedDuration`, capped at `exam.closeAt`.

### Forbidden transitions

- `submitted → in_progress` is forbidden.
- `graded → submitted` is forbidden.
- `graded → in_progress` is forbidden.
- `voided → anything` is forbidden.
- `not_started → anything` has no write path.
- `queued → anything` has no write path.

---

## 3. Grading Status (sub-process state)

### States

| State | Meaning |
|-------|---------|
| `auto_graded` | Scored entirely by the auto-grading engine (set at submit-freeze for pure-objective attempts) |
| `pending_manual` | Has text_response questions awaiting manual scoring |
| `fully_graded` | All questions (auto + manual) scored |

### Orthogonality to Attempt Status

`gradingStatus` is **orthogonal** to `attemptStatus`. An attempt may be:
- `submitted` + `pending_manual` (awaiting manual scoring)
- `graded` + `auto_graded` (pure-objective, graded at submit)
- `graded` + `fully_graded` (manual scoring complete)
- `graded` + `pending_manual` (**inconsistent** — prevented by `finalizeGrading()` guard)

### Legal transitions

```
(at submit-freeze):
  pure-objective attempt → auto_graded
  has-manual attempt → pending_manual

(manual grading):
  pending_manual → fully_graded  (when last manual entry is scored)
```

### Authority

`gradingStatus` is set **once** at the submit-freeze barrier by `submitAttempt()`:
- `requiresManualGrading(questionSnapshot)` → `pending_manual`
- otherwise → `auto_graded`

It advances to `fully_graded` by `finalizeTerminalGrading()` when the last manual entry is completed.

---

## 4. Enrollment Status

### States

| State | Meaning |
|-------|---------|
| `assigned` | Candidate enrolled; no attempt started yet |
| `started` | At least one attempt created |
| `completed` | Retake policy exhausted, passed, or exam window closed |
| `blocked` | Violation; candidate is blocked |

### Legal transitions

```
assigned → [started, blocked]
started → [completed, blocked]
blocked → [started]
completed → []  (terminal)
```

### Commands owning each transition

| Transition | Command | Actor |
|------------|---------|-------|
| `assigned → started` | `startOrRestoreAttempt()` | Candidate |
| `started → completed` | `finalizeTerminalGrading()` (via `shouldEnrollmentComplete()`) | System |
| `started → blocked` | (future) | Admin |

### Preconditions for completion

`shouldEnrollmentComplete()` returns true when:
- `retakePolicy === 'max_attempts'` AND `attemptCount >= maxAttempts`
- `retakePolicy === 'pass_then_stop'` AND candidate passed
- `now >= exam.closeAt`

---

## 5. Email Outbox Status

### States

| State | Meaning |
|-------|---------|
| `pending` | Queued for sending |
| `processing` | Claimed by a worker |
| `retry_wait` | Failed; waiting for retry |
| `sent` | Successfully delivered (terminal) |
| `dead` | Max attempts exceeded (terminal) |

### Legal transitions

```
pending → [processing]
processing → [sent, retry_wait, pending (abandoned-lock recovery)]
retry_wait → [processing]
sent → []  (terminal)
dead → []  (terminal)
```

### Commands owning each transition

| Transition | Command | Actor |
|------------|---------|-------|
| `pending → processing` | `claimDue()` | Email worker |
| `processing → sent` | `markSent()` | Email worker |
| `processing → retry_wait` | `markRetryWait()` | Email worker |
| `processing → pending` | `recoverAbandoned()` | Email worker |
| `retry_wait → processing` | `claimDue()` | Email worker |
| `processing → dead` | `markDead()` | Email worker |

### Ownership fence

`markSent`, `markRetryWait`, and `markDead` are ownership-fenced: `WHERE status='processing' AND lockedBy=workerInstanceId`. Returns null if ownership is lost.

---

## 6. Policy Fields

These are not lifecycle states — they are configuration fields that control behavior.

### 6.1 Result Publication Policy

| Field | Type | Effect |
|-------|------|--------|
| `exam.resultPublicationMode` | `immediate` / `after_grading` / `manual` | Controls when candidates see results |

- `immediate`: visible as soon as grading is computable (auto_graded or fully_graded).
- `after_grading`: visible only when `gradingStatus = fully_graded`.
- `manual`: hidden until `publishResults()` sets `resultsPublishedAt`.

### 6.2 Retake Policy

| Field | Type | Effect |
|-------|------|--------|
| `exam.retakePolicy` | `unlimited` / `max_attempts` / `pass_then_stop` | Controls whether a new attempt is allowed |

- `unlimited`: always allowed.
- `max_attempts`: allowed while `attemptCount < maxAttempts`.
- `pass_then_stop`: allowed while candidate has not passed.

### 6.3 Score Strategy

| Field | Type | Effect |
|-------|------|--------|
| `exam.scoreStrategy` | `highest` / `latest` / `first` | Selects which attempt's score becomes the enrollment final score |

Implemented by `shouldSelectAttempt()`:
- `latest`: always replace (the latest attempt's score wins).
- `highest`: replace if new score > current final score.
- `first`: never replace (the first attempt's score wins).

---

## 7. Fact Timestamps

These are not states — they are authoritative instants recorded once.

| Field | Meaning | Set by | Writable? |
|-------|---------|--------|-----------|
| `exam.resultsPublishedAt` | First publish-results instant | `publishResults()` | Write-once |
| `attempt.startedAt` | When the attempt began | `startOrRestoreAttempt()` | Write-once |
| `attempt.submittedAt` | When the attempt was submitted | `submitAttempt()` / deadline reconciliation | Write-once |
| `attempt.gradedAt` | When grading finalized | `finalizeTerminalGrading()` | Write-once |
| `attempt.deadlineAt` | Effective deadline for the attempt | `startOrRestoreAttempt()` / `extendAttemptTime()` / `restoreAttempt()` | Updated by extension/restore |
| `attempt.lastActivityAt` | Heartbeat field | `saveAnswer()` / heartbeat route / `restoreAttempt()` | Updated on activity |
| `attempt.createdAt` | Row creation time | Repo (auto) | Never |
| `attempt.updatedAt` | Row update time | Repo (auto) | Never |
| `emailOutbox.sentAt` | When the email was delivered | `markSent()` | Write-once |
| `emailOutbox.lockedAt` | When the row was claimed | `claimDue()` | Updated on claim |
| `auditLog.createdAt` | When the audit event occurred | Repo (auto) | Never |

### Why these are timestamps, not states

A timestamp records **when** something happened. A state describes **what condition** something is in. Collapsing them would lose information: `submittedAt = null` tells you the attempt hasn't been submitted; `submittedAt = 2026-07-25T10:00:00Z` tells you exactly when. A state cannot carry that precision.

---

## 8. Summary: State Machine Independence

| Dimension | States | Independent? | Why |
|-----------|--------|--------------|-----|
| Exam status | 6 | Yes | Exam lifecycle is unrelated to any specific candidate |
| Attempt status | 8 (4 reachable) | Yes | Each attempt progresses independently |
| Grading status | 3 | Yes | Orthogonal to attempt lifecycle — describes scoring progress |
| Enrollment status | 4 | Yes | Describes the candidate's overall qualification |
| Email outbox status | 5 | Yes | Describes delivery progress; unrelated to exams |

A transition in one dimension does not imply a transition in another. For example:
- An exam can be `closed` while attempts are still `in_progress` (existing attempts finish independently).
- An attempt can be `submitted` while `gradingStatus` is `pending_manual` (waiting for human grading).
- An enrollment can be `started` while the exam is `closed` (the candidate started before close).
