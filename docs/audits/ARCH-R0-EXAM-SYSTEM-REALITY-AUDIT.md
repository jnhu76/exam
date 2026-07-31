# ARCH-R0: Exam System Reality Audit

> This audit challenges the normative architecture documents against the actual implementation.

```text
Starting correction HEAD:
e34cf0e80afc8f64cdd6fff7a0791dd5322bd88f

Architecture reality base:
cac6b85c425c85ad4077002bc518fca0b50f766f
```

## 1. Starting commit

This audit is based on commit `cac6b85c425c85ad4077002bc518fca0b50f766f` (current master after merged P5-0 / PR #210).

PR #211 is **PENDING / NON-AUTHORITATIVE UNTIL MERGED** and is treated as future P3 result-publication work only.

## 2. Authority Read

The following authority sources were read before auditing:

- `AGENTS.md`, `CONTEXT.md`, `SPEC.md`
- `docs/architecture/exam-runtime.md`, `authorization.md`
- `docs/adr/` (ADR-005 through ADR-011)
- `docs/roadmap/phase-roadmap.md`, `phase3-open-items.md`
- `docs/status/implementation-status.md`
- All `packages/domain/src/`, `packages/exam-engine/src/`, `packages/db/src/`, `packages/authz/src/`
- All `apps/api/src/routes/`, `apps/api/src/orchestrators/`, `apps/api/src/authz/`, `apps/api/src/adapters/`, `apps/api/src/audit/`
- Key `apps/web/src/` pages and lib

## 3. Repository Inventory

| Layer | Package | Status |
|-------|---------|--------|
| Domain | `packages/domain/src/` | Complete |
| Engine | `packages/exam-engine/src/` | Complete |
| DB | `packages/db/src/` | Complete |
| Authz | `packages/authz/src/` | Complete |
| Contracts | `packages/contracts/src/` | Complete |
| API routes | `apps/api/src/routes/` | Complete |
| API orchestrators | `apps/api/src/orchestrators/` | Complete |
| API authz | `apps/api/src/authz/` | Complete |
| API audit | `apps/api/src/audit/` | Complete |
| API workers | `apps/api/src/workers/` | Complete |
| Frontend | `apps/web/src/` | Sampled |

## 4. Domain-Object Reality

### 4.1 Question

**Normative claim**: Question is a live mutable authoring entity with no lifecycle state. **CONFIRMED**.

**Normative claim**: Live Question row remains mutable even after snapshots are created. **CONFIRMED**. Snapshot creation freezes the copy, not the live source row.

### 4.2 Paper

**Normative claim**: Paper is classification C (derived concept). **CONFIRMED**.

### 4.3 Exam

**Normative claim**: 6 lifecycle states; all transitions go through command functions. **CONFIRMED**.

**Normative claim**: Fields freeze at publish (enforced by route-layer guards). **CONFIRMED**. No DB constraint enforces this — application-level enforcement is the accepted architecture.

### 4.4 Enrollment

**Normative claim**: Child entity of Exam. **CONFIRMED**. Always mutated in the same transaction as parent operations.

### 4.5 Attempt

**Normative claim**: 8 states, 4 reachable. **CONFIRMED**.

**Finding**: The `grading` state has transition table entries (`submitted:grade → grading`, `grading:complete_grading → graded`) but is **unreachable** — `finalizeTerminalGrading()` writes `status = 'graded'` directly.
**Classification**: ARCHITECTURAL_DEBT — dead transition table entries.

### 4.6 Grading workset

**Normative claim**: `attempt_grading_entries` is the single durable grading truth. **CONFIRMED**.

## 5. Paper Reality

**Classification C confirmed**. No explicit Paper aggregate. Total score is derived (validated at publish to equal sum of question scores, enforced at application layer).

## 6. Protocol Inventory

All 20+ protocols cataloged. Key corrections from first draft:

1. **Separate Start and Restore**: They are distinct endpoints (`POST /attempts/:examId/start` vs `POST /attempts/:attemptId/restore`) with distinct permissions (`attempt.start` vs `attempt.restore`).
2. **Email outbox enqueue is infrastructure, not business protocol**: The infrastructure primitive (table, repo, worker) is IMPLEMENTED, but no production business caller exists. The business notification-to-outbox protocol is NOT IMPLEMENTED.
3. **Result-publication route**: `POST /exams/:id/publish-results`, actor = Admin/Teacher via `exam.result.publish`, audit action = `exam.publish_results`, no route-level reconciliation.
4. **Protocol actors corrected**: Teacher has `exam.publish`, `exam.close`, `exam.result.publish`, `score.all.view`, `question.create/update/delete`, `course.create/update`, `exam.create/update`, `exam.enrollment.manage`. Admin-only: `exam.cancel`, `exam.archive`, `exam.delete`, `exam.extend`, `exam.unpublish`.

## 7. State-Machine Reality

### 7.1 Exam
**CONFIRMED**. 6 states, transitions match `EXAM_VALID_TRANSITIONS`.

### 7.2 Attempt
**CONFIRMED with caveat**. `grading` state is unreachable.

### 7.3 Enrollment
**CONFIRMED**. 4 states.

## 8. Data-Authority Reality

### 8.1 Live Question joins in grading paths
**NO live Question joins found**. `aggregateGradingEntries()` reads only frozen sources.
**Status**: NOT_A_PROBLEM.

### 8.2 Mutable submitted answers
**Only writer is `submitAttempt()`**. Backfill script is a one-time operation.
**Status**: NOT_A_PROBLEM.

### 8.3 Direct status writes outside commands
**NO direct status writes found in routes**.
**Status**: NOT_A_PROBLEM.

### 8.4 Heartbeat bypasses engine layer
Heartbeat route calls `attemptRepo.update` directly.
**Classification**: ACCEPTED_LIMITATION — intentional for performance.

## 9. Transaction-Boundary Reality

### 9.1 Transactions containing external network IO
**NO transactions contain SMTP send**.
**Status**: NOT_A_PROBLEM.

### 9.2 Audits outside authoritative transactions
Best-effort audits (login, create/update) may be lost on crash.
**Classification**: ACCEPTED_LIMITATION — explicit durability classification.

## 10. Idempotency and Conflict Reality

### 10.1 Save Answer idempotency
**CONFIRMED**. Idempotent per `(questionId, clientSeq)`.

### 10.2 Submit idempotency
**CONFIRMED**. Returns existing frozen snapshot.

### 10.3 Deadline scanner vs. inline reconciliation
Both converge on `isAttemptDeadlineExpired()` → `submitAttempt()`.
**Status**: NOT_A_PROBLEM.

## 11. Authorization Reality

### 11.1 Role-name authorization branches
**NO production authorization uses `users.role` or JWT role**.
**Status**: NOT_A_PROBLEM.

### 11.2 Client-derived security decisions
**Candidate's `candidateId` is NEVER trusted from client**.
**Status**: NOT_A_PROBLEM.

## 12. Security-Boundary Reality

### 12.1 Cross-organization access
**All repo methods filter by `ctx.organizationId`**.
**Status**: NOT_A_PROBLEM.

### 12.2 Cross-Candidate attempt access
**Returns 404 (anti-enumeration)**.
**Status**: NOT_A_PROBLEM.

### 12.3 Standard-answer leakage
**Candidate projections always exclude `standardAnswer` and `rubric`**.
**Status**: NOT_A_PROBLEM.

## 13. Frontend Projection Reality

**Frontend consumes derived capabilities via pure function**. `deriveTakeExamView(snapshot)` derives ALL UI state. No business rule reconstruction.
**Status**: NOT_A_PROBLEM.

## 14. Worker and Asynchronous-Boundary Reality

### 14.1 Email worker liveness
**CONFIRMED**. `worker_heartbeats` table records each poll cycle.

### 14.2 Heartbeat scanner
**CONFIRMED**. `setInterval` every 30s, marks stale `in_progress` as `disrupted`.

### 14.3 Deadline scanner
**CONFIRMED**. Auto-submits expired attempts under REPEATABLE READ with EA lock.

## 15. Documentation Drift

### 15.1 SPEC.md vs. implementation
SPEC.md lists `voidAttempt` as a command function but it does not exist.
**Classification**: DOCUMENTATION_DRIFT — SPEC.md should mark `voidAttempt` as "target design — no implementation".

## 16. Missing Tests

| Area | Test coverage | Status |
|------|--------------|--------|
| Save vs Submit concurrency | `submitFreezeBarrier.test.ts` (real PostgreSQL, 5 race iterations) + `save-submit-race.spec.ts` (E2E) | **PROVEN** |
| Concurrent email workers | `emailOutboxRepo.test.ts` (claimDue SKIP LOCKED test, two workers) | **PROVEN** |
| Deadline scanner vs. save | Unit tests exist; integration test for concurrent scanner + save appears absent | **MISSING_PROOF** |
| Concurrent last-question manual grading | Unit tests exist; concurrent integration test appears absent | **MISSING_PROOF** |
| Cross-Candidate 404 vs 403 | Route tests exist; dedicated anti-enumeration test appears absent | **MISSING_PROOF** |

## 17. Missing Constraints

| Constraint | Status | Classification |
|------------|--------|----------------|
| `exam.totalScore = SUM(questionSnapshot.score)` at DB level | **MISSING** — enforced only by `publishExam()` | ACCEPTED_LIMITATION |
| `attempt.submittedAnswers` immutability at DB level | **MISSING** — enforced only by code | ACCEPTED_LIMITATION |

Both are enforced at the application layer by the sole command that writes the field. No production path bypasses the command. A PostgreSQL trigger would duplicate complex domain logic. Application-level enforcement is the accepted architecture.

## 18. Architectural Defects

### 18.1 `grading` state is dead code
**Classification**: ARCHITECTURAL_DEBT — transition table entries are unreachable.

### 18.2 `hasSubjectiveQuestions` deprecated but still exported
**Classification**: ARCHITECTURAL_DEBT — deprecated function with canonical replacement exists.

## 19. Accepted Limitations

> **Closeout note (current authority):** items 6 and 7 below were accurate at
> the audit base (`cac6b85c`, pre-P5-N1) and are retained as audit history.
> Both were subsequently resolved by P5-N1 (CLOSED, PR #213): the
> `result_published` publication is now the first production Email outbox
> caller, and the candidate Notification Inbox is implemented. See the P6 MVP
> Ready Closeout Reality Audit and `docs/status/implementation-status.md` for
> the as-built state.

1. **Email at-least-once delivery**: Duplicates possible on worker crash. Accepted by design.
2. **No question deletion guard**: Snapshots are copies, so historical attempts are safe.
3. **No DB-level constraint on totalScore or submittedAnswers**: Application-level enforcement is the accepted architecture.
4. **Heartbeat bypasses engine layer**: Direct repo update, accepted for performance.
5. **`grading` state is dead code**: No write path, but transition table entries exist.
6. **Email has no business caller**: Infrastructure exists (P5-0 merged), but business protocol is NOT IMPLEMENTED (P5-N1 scope).
7. **Notification Inbox not implemented**: Only the email channel exists.
8. **Disrupted recovery UI not productized**: Backend capability exists; frontend restore flow is incomplete.
9. **Teacher resource scope**: Teacher has capabilities but scoped authorization (Teacher@course) is NOT IMPLEMENTED — currently flat org-wide.
10. **Candidate answer-key visibility**: Fixed to hidden. Configurable release is NOT IMPLEMENTED.

## 20. Future Capabilities

Future capability inventory is **not included in gap classification totals**.

| Capability | Phase | Dependency |
|------------|-------|------------|
| Notification Inbox + result-published Email | P5-N1 | P3 closure |
| WYSIWYG submit final-answer barrier | P3 | |
| Staff invitation + password reset | P3 | |
| Resource-relationship auth (M11) | Phase 3 | |
| IP/CIDR examination restrictions | Phase 2+ | |
| Question version table | Future | |
| Explicit Paper aggregate | Future | |
| Multi-tenant | Phase 4 | |

Current forward dependency: P3 result-publication closeout = pending in unmerged PR #211. P5-N1 = future and blocked on P3 closure.

## 21. Overdesign Risks

| Risk | Assessment |
|------|------------|
| `ReconciledAttemptMutationContext` opaque evidence | Justified — proves transaction affinity across EA lock seam. |
| `LockedEnrollmentAttemptIdentity` with dual private symbols | Justified — prevents mint bypass. |
| Three-state durability for audit | Justified — explicit classification per action. |
| `client_events` separate from `audit_logs` | Justified — different concerns. |

## 22. Gap Register

See [ARCH-R0-EXAM-SYSTEM-GAP-REGISTER.md](./ARCH-R0-EXAM-SYSTEM-GAP-REGISTER.md).

## 23. Recommended Next Jobs

| Job | Priority | Scope |
|-----|----------|-------|
| **ARCH-R1: Clean up attempt state machine** | P2 | Remove/document dead `grading` transitions |
| **ARCH-R2: Integration test for concurrent scanner + save** | P2 | Prove serialization under concurrent load |
| **ARCH-R3: Integration test for concurrent manual grading** | P2 | Prove terminal closure under concurrent last-question grading |
| **ARCH-R4: Remove deprecated export** | P3 | `hasSubjectiveQuestions` |
| **Documentation: Fix SPEC.md voidAttempt** | P3 | Mark as target design |
| **P5-N1: Notification Inbox + Email integration** | P3 (queued) | Business caller + Inbox |
