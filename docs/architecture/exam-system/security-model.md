# Security and Trust Boundaries

> Current-state security model for the exam system.

```text
Last verified against commit:
cac6b85c425c85ad4077002bc518fca0b50f766f

Verification scope:
Current master implementation after merged P5-0 / PR #210.
```

## 1. Authentication Boundary

### 1.1 HTTP-only Cookie + JWT

- Authentication token is stored in an **HTTP-only cookie** (`auth-token`), not in localStorage.
- The token is an HS256 JWT signed with `JWT_SECRET`.
- `JWT_SECRET` MUST be set in production; the server fails fast if missing.

### 1.2 Password storage

Passwords are hashed with **argon2id** (configurable to bcrypt). Timing-attack mitigation: `verifyPasswordOrDummy()` performs a dummy verify when no hash exists.

### 1.3 Authentication flow

1. Client POSTs credentials to `/api/auth/login`.
2. Server verifies credentials against `users.passwordHash`.
3. Server loads `user_role_assignments` for the user.
4. Server resolves `AssignmentAuthority` (active roles + capability union).
5. Server signs a JWT and sets it as an HTTP-only cookie.

**Critical rule**: `users.role` and the JWT `role` claim are **compatibility projections only**. Authorization is resolved from `user_role_assignments` at every request.

## 2. Organization Boundary

### 2.1 Single-tenant data boundary

All business tables carry `organizationId`. Every repository method receives `ctx` and filters by `ctx.organizationId`.

### 2.2 Phase 1 constraint

Phase 1 is single-tenant: `organizationId` comes from the internal default organization. There is no organization switcher, no organizationSlug login, and no multi-tenant capability.

## 3. Capability Authorization

### 3.1 Capability-based, NOT role-based

Every protected route declares a capability requirement. Authorization checks `ctx.capabilities.includes(permission)`.

### 3.2 Capability resolution

`loadAssignmentAuthority(db, ctx, userId)`:
1. Loads active `user_role_assignments` rows for the user.
2. Filters to active rows.
3. Validates exactly-one-primary invariant.
4. Unions all active role presets' permissions into `ctx.capabilities`.

### 3.3 Role presets

| Role | Default scope | Key capabilities |
|------|--------------|------------------|
| Admin | organization | ~60 (superset) |
| Teacher | course | Course/exam authoring, `exam.result.publish`, `score.all.view` |
| Proctor | exam | Exam-room runtime |
| Grader | exam | Manual scoring |
| Candidate | own_attempt | Own-scope runtime |
| System | system | Background scanners |

### 3.4 Fail-closed contract

Any integrity failure in capability resolution → **503 AUTHZ_UNAVAILABLE** (never 401, never fallback to `users.role`).

## 4. Resource-Scope Status

### 4.1 Ownership-based gates

| Gate | Check | On failure |
|------|-------|------------|
| `requireOwnAttempt` | Capability + attempt owner === actor | **404** (anti-enumeration) |
| `requireExamEligibility` | Capability + enrollment exists | 403 or 404 |
| `requireScoreCapability()` | ScoreAllView OR (ScoreOwnView + owner) | 403 |
| `requireScopedCapability` | Capability + resource resolves under org anchor | 403 |

### 4.2 Anti-enumeration

Cross-candidate attempt access returns **404** (not 403) to prevent an attacker from distinguishing "attempt exists but you don't own it" from "attempt doesn't exist".

## 5. Question-Answer Leakage

### 5.1 Standard answer protection

- `questions.standardAnswer` is the authoring source (live, mutable).
- `QuestionSnapshot.standardAnswer` is the frozen copy on each attempt.
- **Candidate-facing projections NEVER expose `standardAnswer`** (INV-R-001).
- **Teacher/Admin ScoreAllView may retain frozen `standardAnswer`** on the grading detail view.

### 5.2 Rubric protection

- `questions.rubric` is the authoring source.
- `QuestionSnapshot.rubric` is the frozen copy.
- **Rubric is absent from the Candidate result contract.**

### 5.3 INV-R-001 (corrected)

Under the current MVP contract (`apps/api/src/routes/attempts.shared.ts`):
- `computeAnswerVisibility()` always returns `"hidden"` (no arguments, no conditions).
- CandidateTakeSnapshot and candidate attempt serializers never include `standardAnswer` or `rubric`.
- Result own-view strips `standardAnswer` unconditionally.
- Rubric is absent from the Candidate result contract.

A future configurable answer-key release policy is **NOT IMPLEMENTED**.

## 6. Frozen-Data Integrity

### 6.1 Question snapshot immutability

`QuestionSnapshot` is a copy. Once created (at exam publish or attempt start), it is never modified.

### 6.2 Submitted-answer immutability

`submitted_answers` is written once (inside the submit transaction) and never modified.

### 6.3 Published-exam immutability

After publish, the exam's `questionSnapshot`, `totalScore`, `passingScore`, `controlFlags`, and policy fields are immutable (enforced by route-layer guards).

## 7. Save-Answer Conflicts

### 7.1 Stale version

A save with `baseVersion < currentVersion` is rejected as `STALE_VERSION`.

### 7.2 Conflicting payload

A save with the same `(questionId, clientSeq)` but a different payload is rejected as `CONFLICTING_PAYLOAD`.

### 7.3 Save vs. Submit concurrency

The submit freeze barrier acquires the attempt row via `FOR UPDATE`. A save that arrives after the submit lock is acquired sees the attempt in `submitted` state and is rejected.

## 8. Submit Freeze

### 8.1 Atomic barrier

The submit freeze barrier runs inside a single transaction holding the attempt row lock:
1. Read attempt (FOR UPDATE).
2. Build `SubmittedAnswersSnapshot` from draft answers.
3. Write `submitted_answers`, `status = 'submitted'`, `submittedAt`.
4. Materialize `attempt_grading_entries`.

### 8.2 Submit carries NO answer payload

The submit endpoint has an empty body. It grades whatever answers are already persisted.

## 9. Deadline Enforcement

### 9.1 Server time authority

`fastify.now()` is the canonical time authority. Every request captures one `now` and threads it through.

### 9.2 Effective deadline

`effectiveDeadline = min(exam.closeAt, attempt.deadlineAt)`.

### 9.3 Lazy reconciliation

Deadline reconciliation is triggered at candidate entry points, NOT by a background scheduler. The scanner is a backup.

## 10. Result Visibility

### 10.1 Policy-controlled

Result visibility is the AND of "result computable" and "publish policy satisfied" (INV-R-002).

### 10.2 Candidate vs. Admin

Candidates see results only if the visibility policy allows. Admins/Teachers with `score.all.view` see all results regardless of policy.

### 10.3 Canceled exam guard

Canceled exams MUST NOT expose normal scores/export.

## 11. Audit Integrity

### 11.1 Append-only

`audit_logs` rows are written once and never updated.

### 11.2 Durability tiers

- **Atomic**: Written inside the caller's transaction.
- **Synchronous sensitive read**: Written synchronously for data exports.
- **Best-effort**: Async drain queue for low-risk events.

## 12. Email Delivery Ownership

### 12.1 Outbox pattern

Business transactions INSERT rows into `email_outbox`. A separate worker claims and sends them.

### 12.2 Ownership fence

`markSent`, `markRetryWait`, and `markDead` are ownership-fenced: `WHERE status='processing' AND lockedBy=workerInstanceId`.

### 12.3 At-least-once semantic

Ownership fencing prevents a stale/lost worker from updating delivery state; it does NOT guarantee exactly-once SMTP delivery. A crash after provider acceptance but before `markSent` may cause duplicate delivery. Current semantic is at-least-once.

## 13. Threat Model

| Threat | Protected asset | Current control | Residual risk | Classification |
|--------|----------------|----------------|---------------|----------------|
| Cross-organization access | All business data | `organizationId` filtering on every repo query | Low | NOT_A_PROBLEM |
| Cross-Candidate attempt access | Attempt data | `requireOwnAttempt` ownership gate; 404 anti-enumeration | Low | NOT_A_PROBLEM |
| StandardAnswer leakage | Question answers | Candidate projections always exclude standardAnswer | Low | NOT_A_PROBLEM |
| Rubric leakage | Grading guidance | Rubric absent from Candidate contract | Low | NOT_A_PROBLEM |
| Live Question edits affecting old Attempts | Grading integrity | Snapshots are copies; grading reads from snapshots only | Low | NOT_A_PROBLEM |
| Stale Save requests | Answer integrity | Versioned optimistic concurrency | Low | NOT_A_PROBLEM |
| Same clientSeq with different payload | Answer integrity | `CONFLICTING_PAYLOAD` rejection | Low | NOT_A_PROBLEM |
| Save vs. Submit concurrency | Answer integrity | Attempt `FOR UPDATE` | Low | NOT_A_PROBLEM |
| Repeated Submit | Answer integrity | Idempotent submit | Low | NOT_A_PROBLEM |
| Repeated Result publication | Result integrity | Idempotent `publishResults()` (write-once) | Low | NOT_A_PROBLEM |
| Duplicate Email enqueue | Email delivery | Partial unique index on `(org, dedupeKey)` | Low | NOT_A_PROBLEM |
| Concurrent Email workers | Email delivery | `FOR UPDATE SKIP LOCKED` + ownership fence | Low | NOT_A_PROBLEM |
| Worker crash after provider send | Email delivery | At-least-once accepted; `recoverAbandoned()` resets | Medium | ACCEPTED_LIMITATION |
| Authorization based on stale role strings | Access control | Authority resolved from `user_role_assignments` at every request | Low | NOT_A_PROBLEM |
| Audit omission | Compliance | Atomic audits in-tx; best-effort may be lost on crash | Low | ACCEPTED_LIMITATION |
| Candidate accessing another candidate's result | Result privacy | Ownership gate + 404 anti-enumeration | Low | NOT_A_PROBLEM |
| Deadline manipulation | Exam timing | Server time authority; client timestamps not trusted | Low | NOT_A_PROBLEM |

## 14. Security Invariant Summary

| ID | Statement | Owner | Enforcement |
|----|-----------|-------|-------------|
| INV-SEC-001 | Authorization is resolved from active `user_role_assignments` rows, never from `users.role` or JWT claims. | Auth layer | `loadAssignmentAuthority()` |
| INV-Q-001 | Question snapshots are immutable copies; grading MUST read from snapshots. | Grading engine | `aggregateGradingEntries()` reads only frozen sources |
| INV-A-001 | Once submitted/grading/graded/voided, Candidate answer writes MUST NOT modify answers. | Attempt commands | `submitAttempt()` freezes; `processSaveAnswer()` rejects post-submit |
| INV-A-002 | `submitted_answers` MUST be written exactly once, inside the submit transaction. | Submit barrier | Single `attemptRepo.update()` inside `submitAttempt()` |
| INV-G-001 | Terminal grading MUST derive from frozen truth, not live questions. | Grading engine | `aggregateGradingEntries()` reads only frozen sources |
| INV-G-002 | `attempt_grading_entries` is the single durable grading truth. | Grading engine | All grading paths read/write entries; `gradingResult` is projection |
| INV-R-001 | Candidate-facing projections MUST NOT expose `standardAnswer` or `rubric`. `answerVisibility` is fixed to hidden. | Serialization | Zod schema strips fields; `computeAnswerVisibility()` always returns hidden |
| INV-R-002 | Result visibility is AND of publish-policy and grading-completeness. | Result computation | Route-layer visibility logic |
| INV-N-001 | SMTP send happens outside the DB transaction. | Email worker | `processDueEmails()` sends after claim tx commits |
| INV-MAIL-001 | Email worker claim uses `FOR UPDATE SKIP LOCKED`. | Email outbox repo | `claimDue()` atomic CTE |
