# Security and Trust Boundaries

> Current-state security model for the exam system. This is a description of what exists, not a wishlist.

## 1. Authentication Boundary

### 1.1 HTTP-only Cookie + JWT

- Authentication token is stored in an **HTTP-only cookie** (`auth-token`), not in localStorage.
- The token is an HS256 JWT signed with `JWT_SECRET`.
- `JWT_SECRET` MUST be set in production; the server fails fast if missing.
- Cookie is `Secure` in production, `SameSite` enforced.

### 1.2 Session derivation

Session IDs are derived by SHA-256 hashing the JWT. The JWT is never stored raw in the DB.

### 1.3 Password storage

Passwords are hashed with **argon2id** (configurable to bcrypt). Timing-attack mitigation: `verifyPasswordOrDummy()` performs a dummy verify when no hash exists, ensuring consistent timing for existent and non-existent users.

### 1.4 Authentication flow

1. Client POSTs credentials to `/api/auth/login`.
2. Server verifies credentials against `users.passwordHash`.
3. Server loads `user_role_assignments` for the user.
4. Server resolves `AssignmentAuthority` (active roles + capability union).
5. Server signs a JWT and sets it as an HTTP-only cookie.
6. Server returns user profile + capabilities.

**Critical rule**: `users.role` and the JWT `role` claim are **compatibility projections only**. Authorization is resolved from `user_role_assignments` at every request.

## 2. Organization Boundary

### 2.1 Single-tenant data boundary

All business tables carry `organizationId`. Every repository method receives `ctx` and filters by `ctx.organizationId`.

### 2.2 Phase 1 constraint

Phase 1 is single-tenant: `organizationId` comes from the internal default organization. There is no organization switcher, no organizationSlug login, and no multi-tenant capability.

### 2.3 Organization anchor

All authorization resolvers load the full parent chain from PostgreSQL and verify every node belongs to the actor's organization. A broken chain or org mismatch → `DeniedScope`.

## 3. Capability Authorization

### 3.1 Capability-based, NOT role-based

Every protected route declares a capability requirement (e.g., `exam.publish`, `attempt.submit`). Authorization checks `ctx.capabilities.includes(permission)`.

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
| Teacher | course | Course/exam authoring |
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
| `requireOwnAttempt(permission, resourceIdKey)` | Capability + attempt owner === actor | **404** (anti-enumeration) |
| `requireExamEligibility(permission, resourceIdKey, mode)` | Capability + enrollment exists | 403 or 404 |
| `requireScoreCapability()` | ScoreAllView OR (ScoreOwnView + owner) | 403 |
| `requireScopedCapability(permission, resolverKey, resourceIdKey)` | Capability + resource resolves under org anchor | 403 |

### 4.2 Anti-enumeration

Cross-candidate attempt access returns **404** (not 403) to prevent an attacker from distinguishing "attempt exists but you don't own it" from "attempt doesn't exist".

## 5. Question-Answer Leakage

### 5.1 Standard answer protection

- `questions.standardAnswer` is the authoring source (live, mutable).
- `QuestionSnapshot.standardAnswer` is the frozen copy on each attempt.
- **Candidate-facing projections (CandidateTakeSnapshot, ResultDTO) MUST NOT expose `standardAnswer`** unless:
  1. `answerVisibility === 'visible'` AND
  2. The result is published (result visible).

### 5.2 Rubric protection

- `questions.rubric` is the authoring source.
- `QuestionSnapshot.rubric` is the frozen copy.
- **Candidate-facing projections MUST NOT expose `rubric`** unless `answerVisibility === 'visible'`.

### 5.3 Grading view is authorized

`GradingQuestionDTO` (returned to graders) DOES contain `standardAnswer` and `rubric`. Access is gated by `grading.answer.view` capability + scoped to the attempt.

## 6. Frozen-Data Integrity

### 6.1 Question snapshot immutability

`QuestionSnapshot` is a copy. Once created (at exam publish or attempt start), it is never modified. Live `questions` edits do not affect existing snapshots.

### 6.2 Submitted-answer immutability

`submitted_answers` is written once (inside the submit transaction) and never modified. INV-A-002.

### 6.3 Published-exam immutability

After publish, the exam's `questionSnapshot`, `totalScore`, `passingScore`, `controlFlags`, and policy fields are immutable (enforced by route-layer guards).

## 7. Save-Answer Conflicts

### 7.1 Stale version

A save with `baseVersion < currentVersion` is rejected as `STALE_VERSION`. The client must re-read the current state and retry.

### 7.2 Conflicting payload

A save with the same `(questionId, clientSeq)` but a different payload is rejected as `CONFLICTING_PAYLOAD`. This prevents silent data loss from client misuse of the idempotency key.

### 7.3 Save vs. Submit concurrency

The submit freeze barrier acquires the attempt row via `FOR UPDATE`. A save that arrives after the submit lock is acquired sees the attempt in `submitted` state and is rejected as `ATTEMPT_ALREADY_SUBMITTED`.

## 8. Submit Freeze

### 8.1 Atomic barrier

The submit freeze barrier runs inside a single transaction holding the attempt row lock:
1. Read attempt (FOR UPDATE).
2. Build `SubmittedAnswersSnapshot` from draft answers.
3. Write `submitted_answers`, `status = 'submitted'`, `submittedAt`.
4. Materialize `attempt_grading_entries`.

### 8.2 Repeated submit

`submitAttempt()` is idempotent. A re-submit returns the existing frozen snapshot unchanged (and validates workset consistency).

### 8.3 Submit carries NO answer payload

The submit endpoint has an empty body. It grades whatever answers are already persisted. This prevents a candidate from submitting different answers than they saved.

## 9. Deadline Enforcement

### 9.1 Server time authority

`fastify.now()` is the canonical time authority. Every request captures one `now` and threads it through. Client timestamps (`clientSavedAt`) are recorded but never used for deadline decisions.

### 9.2 Effective deadline

`effectiveDeadline = min(exam.closeAt, attempt.deadlineAt)`. A NULL `attempt.deadlineAt` falls back to `exam.closeAt` (defensive recovery).

### 9.3 Lazy reconciliation

Deadline reconciliation is triggered at candidate entry points (`/take`, save, submit, resume), NOT by a background scheduler. The scanner is a backup for cases where the candidate never returns.

## 10. Result Visibility

### 10.1 Policy-controlled

Result visibility is the AND of "result computable" and "publish policy satisfied" (INV-R-002).

### 10.2 Candidate vs. Admin

Candidates see results only if the visibility policy allows. Admins with `score.all.view` see all results regardless of policy.

### 10.3 Canceled exam guard

Canceled exams MUST NOT expose normal scores/export (`ExamCanceledResultsUnavailableError`).

## 11. Audit Integrity

### 11.1 Append-only

`audit_logs` rows are written once and never updated. There is no delete or update path.

### 11.2 Durability tiers

- **Atomic**: Written inside the caller's transaction (exam transitions, submit, grading).
- **Synchronous sensitive read**: Written synchronously for data exports.
- **Best-effort**: Async drain queue for low-risk events (login, create/update).

### 11.3 Audit duplication or omission

- Atomic audits cannot be omitted (they are in the same transaction as the mutation).
- Best-effort audits may be omitted if the process crashes before the drain queue flushes (accepted limitation).
- Audit actions are validated against a closed catalog (`assertAuditAction`). Unknown actions are rejected.

## 12. Email Delivery Ownership

### 12.1 Outbox pattern

Business transactions INSERT rows into `email_outbox`. A separate worker claims and sends them. Email failure never rolls back the business transaction.

### 12.2 Ownership fence

`markSent`, `markRetryWait`, and `markDead` are ownership-fenced: `WHERE status='processing' AND lockedBy=workerInstanceId`.

### 12.3 Worker crash recovery

Abandoned `processing` rows are reset to `pending` by `recoverAbandoned()` after a lock timeout.

## 13. Worker Liveness

### 13.1 Heartbeat storage

`worker_heartbeats` table records each poll cycle. The API diagnostics surface reads these to determine liveness without process-local shared state or Redis.

### 13.2 Heartbeat scanner

The heartbeat scanner runs as a Fastify plugin (setInterval, default 30s). It marks `in_progress` attempts as `disrupted` if `lastActivityAt` is older than the timeout (default 60s).

## 14. Sensitive Logging

### 14.1 Internal reason vs. external message

Auth failure internal reasons are written to pino logs but NEVER exposed to the frontend. The frontend receives a generic error code.

### 14.2 SMTP secrets

`scrubSecrets` removes SMTP passwords from errors before they are written to `email_outbox.lastError`.

### 14.3 Client event sanitization

`sanitizeClientEvent()` redacts keys matching a denylist (password, token, cookie, authorization, secret, answer, content, body).

## 15. Threat Model

| Threat | Protected asset | Current control | Evidence | Residual risk | Classification |
|--------|----------------|----------------|----------|---------------|----------------|
| Cross-organization access | All business data | `organizationId` filtering on every repo query; org anchor verification in resolvers | `baseRepo.ts`, `attemptResolver.ts` | Low — single-tenant in Phase 1 | NOT_A_PROBLEM |
| Cross-Candidate attempt access | Attempt data | `requireOwnAttempt` ownership gate; anti-enumeration 404 | `ownAttemptCapability.ts` | Low | NOT_A_PROBLEM |
| StandardAnswer leakage | Question answers | Candidate projections exclude standardAnswer/rubric unless `answerVisibility` allows | `CandidateTakeSnapshotSchema` (Zod strips fields) | Low | NOT_A_PROBLEM |
| Rubric leakage | Grading guidance | Same as standardAnswer | Same | Low | NOT_A_PROBLEM |
| Live Question edits affecting old Attempts | Grading integrity | Snapshots are copies; grading reads from snapshots only | `grading.ts` comment + `aggregateGradingEntries` | Low | NOT_A_PROBLEM |
| Stale Save requests | Answer integrity | Versioned optimistic concurrency (`baseVersion` check) | `processSaveAnswer()` | Low | NOT_A_PROBLEM |
| Same clientSeq with different payload | Answer integrity | `CONFLICTING_PAYLOAD` rejection | `processSaveAnswer()` | Low | NOT_A_PROBLEM |
| Save vs. Submit concurrency | Answer integrity | Attempt `FOR UPDATE` serializes save against submit | `submitAttempt()` | Low | NOT_A_PROBLEM |
| Repeated Submit | Answer integrity | Idempotent submit; frozen snapshot returned unchanged | `submitAttempt()` | Low | NOT_A_PROBLEM |
| Repeated Result publication | Result integrity | Idempotent `publishResults()` (write-once `resultsPublishedAt`) | `publishResults()` | Low | NOT_A_PROBLEM |
| Concurrent Result publication | Result integrity | Exam `FOR UPDATE` serializes publish attempts | Route-layer transaction | Low | NOT_A_PROBLEM |
| Duplicate Email enqueue | Email delivery | Partial unique index on `(org, dedupeKey)` | `email_outbox` schema | Low | NOT_A_PROBLEM |
| Concurrent Email workers | Email delivery | `FOR UPDATE SKIP LOCKED` + ownership fence | `claimDue()`, `markSent()` | Low | NOT_A_PROBLEM |
| Worker crash after provider send | Email delivery | **ACCEPTED LIMITATION**: if the worker crashes between SMTP send and `markSent()`, the row stays `processing` and may be re-sent after recovery | `recoverAbandoned()` resets to `pending` | Medium — at-least-once delivery accepted | ACCEPTED_LIMITATION |
| Authorization based on stale role strings | Access control | Authority resolved from `user_role_assignments` at every request; `users.role` is display-only | `loadAssignmentAuthority()` | Low | NOT_A_PROBLEM |
| Audit duplication or omission | Compliance | Atomic audits in-tx; best-effort may be lost on crash | `auditWriter.ts` | Low — accepted for best-effort tier | ACCEPTED_LIMITATION |
| Candidate accessing another candidate's result | Result privacy | Ownership gate + 404 anti-enumeration | `requireOwnAttempt` | Low | NOT_A_PROBLEM |
| Force-submit by unauthorized actor | Attempt integrity | `attempt.force_submit` capability gate | `attempts.admin.ts` | Low | NOT_A_PROBLEM |
| Deadline manipulation | Exam timing | Server time authority (`fastify.now()`); client timestamps not trusted | `timer.ts`, route-layer `now` threading | Low | NOT_A_PROBLEM |

## 16. Intentionally Absent Controls

The following high-security features are **intentionally absent** in the current implementation. They are recorded as future capabilities only:

| Control | Status | Notes |
|---------|--------|-------|
| IP/CIDR examination restrictions | **NOT IMPLEMENTED** | `controlFlags.restrictIp` schema-only |
| LAN-only access policy | **NOT IMPLEMENTED** | Network-level concern, not app-level |
| Trusted proxy configuration | **NOT IMPLEMENTED** | |
| Single-device or concurrent-session policy | **NOT IMPLEMENTED** | Phase 4 pass-to-proceed |
| Emergency Candidate examination credential | **NOT IMPLEMENTED** | |
| WYSIWYG final-answer submission barrier | **NOT IMPLEMENTED** | Phase 3 |
| Higher-assurance submit confirmation | **NOT IMPLEMENTED** | |
| Device binding | **NOT IMPLEMENTED** | |
| WebSocket session for exam lockdown | **NOT IMPLEMENTED** | Phase 2 |
| Adaptive degradation | **NOT IMPLEMENTED** | Phase 2 planned |
| Question version table | **NOT IMPLEMENTED** | Snapshots serve this role |
| Notification Inbox | **NOT IMPLEMENTED** | Only email outbox exists |

## 17. Security Invariant Summary

| ID | Statement | Owner | Enforcement |
|----|-----------|-------|-------------|
| INV-SEC-001 | Authorization is resolved from active `user_role_assignments` rows, never from `users.role` or JWT claims. | Auth layer | `loadAssignmentAuthority()` |
| INV-Q-001 | Question snapshots are immutable copies; grading MUST read from snapshots. | Grading engine | `aggregateGradingEntries()` reads only `questionSnapshot` + `submitted_answers` |
| INV-A-001 | Once submitted/grading/graded/voided, Candidate answer writes MUST NOT modify answers. | Attempt commands | `submitAttempt()` freezes; `processSaveAnswer()` rejects post-submit |
| INV-A-002 | `submitted_answers` MUST be written exactly once, inside the submit transaction. | Submit barrier | `buildSubmittedAnswersSnapshot()` + single `attemptRepo.update()` |
| INV-G-001 | Terminal grading MUST derive from frozen truth, not live questions. | Grading engine | `aggregateGradingEntries()` reads only frozen sources |
| INV-G-002 | `attempt_grading_entries` is the single durable grading truth. | Grading engine | All grading paths read/write entries; `gradingResult` is projection |
| INV-R-001 | Candidate result projection MUST NOT expose `standardAnswer`/`rubric` unless allowed. | Result serialization | Zod schema strips fields |
| INV-R-002 | Result visibility is AND of publish-policy and grading-completeness. | Result computation | Route-layer visibility logic |
| INV-N-001 | SMTP send happens outside the DB transaction. | Email worker | `processDueEmails()` sends after claim tx commits |
| INV-MAIL-001 | Email worker claim uses `FOR UPDATE SKIP LOCKED`. | Email outbox repo | `claimDue()` atomic CTE |
