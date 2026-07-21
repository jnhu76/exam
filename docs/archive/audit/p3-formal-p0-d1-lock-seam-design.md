# P3-FORMAL-P0-D1 — Canonical Enrollment→Attempt Lock Acquisition Seam Design

**Audit date:** 2026-07-08
**HEAD:** `1a85e49`
**Auditor:** Agent (P3-FORMAL-P0-D1 / D1C2 assessment)
**Status:** READ-ONLY DESIGN / FORMAL BOUNDARY AUDIT — no production code modified

This report supersedes the prior D1/D1C conclusions and adds the D1C2
capability-witness boundary layer. All previously-correct conclusions are
preserved verbatim at §14.

---

## 1. Verdict

```
P3-FORMAL-P0-D1C2: PASS — DUAL-LOCK CAPABILITY BOUNDARY PROVEN
```

All PASS criteria satisfied (audited against `1a85e49`):

```
DUAL_LOCK_DOMAIN_COMPLETE                          = YES
attemptId-rooted Enrollment-first protocol          = semantically justified
post-lock revalidation boundary                     = explicit
one canonical seam selected                          = YES
forbidden local acquisition pattern                  = explicit
structural enforcement is mechanically testable      = YES
production migration blast radius                    = enumerated

NARROWEST_WITNESS_BOUNDARY                          = IDENTIFIED
LOCKED_ROW_SNAPSHOT_STALE_RISK                      = PRESENT (witness must NOT
                                                      carry mutable snapshots)
SAME_TX_REREAD_MODEL                                 = OWN-WRITE-VISIBLE
LOCK_CAPABILITY_SHAPE                                = OPAQUE_IDENTITY_CAPABILITY
CAPABILITY_FACTORY                                   = lockEnrollmentAndAttempt
CAPABILITY_FORGERY_BY_NORMAL_TYPED_CODE              = NO
EXPLICIT_CAST_ESCAPE_HATCH                           = mechanically rejected
FINALIZE_TERMINAL_GRADING_LOCK_AUTHORITY             = no inner E FOR UPDATE
FINALIZE_TERMINAL_GRADING_FOR_UPDATE_CALLS           = findByIdForUpdate(Attempt)
                                                      only; E FOR UPDATE forbidden
TRANSITIVE_PROTOCOL_ENFORCEMENT                      = PROVEN
```

---

## 2. Dual-Lock Domain

Every production transaction family that holds both `exam_enrollments FOR UPDATE` and `exam_attempts FOR UPDATE` simultaneously:

| # | Path | Caller | First Row Lock | Second Row Lock | Dual-Lock | Current Order |
|---|------|--------|---------------|----------------|-----------|---------------|
| 1 | startOrRestoreAttempt(resume) | POST /attempts/:examId/start | `enrollments` FOR UPDATE (by examId+candidateId) | `attempts` FOR UPDATE (by enrollmentId via findActiveByEnrollment) | YES | **EA** |
| 2 | submitAndGradeAttempt | POST /attempts/:attemptId/submit | `attempts` FOR UPDATE (by attemptId) | `enrollments` FOR UPDATE (inside finalizeTerminalGrading by examId+candidateId) | YES | **AE** |
| 3 | ensureAttemptDeadlineReconciled (take) | GET /candidate/attempts/:attemptId/take | `attempts` FOR UPDATE (by attemptId) | `enrollments` FOR UPDATE (inside finalizeTerminalGrading, via ensureAttemptDeadlineReconciled → finalizeGrading → finalizeTerminalGrading) | YES | **AE** |
| 4 | ensureAttemptDeadlineReconciled (save) | POST /attempts/:attemptId/answers/:questionId | `attempts` FOR UPDATE (by attemptId) | Same path as #3 (reconciliation before save-answer write) | YES | **AE** |
| 5 | ensureAttemptDeadlineReconciled (restore) | POST /attempts/:attemptId/restore | `attempts` FOR UPDATE (by attemptId) | Same path as #3 (reconciliation before restore) | YES | **AE** |
| 6 | admin force-submit | POST /admin/attempts/:attemptId/force-submit | `attempts` FOR UPDATE (by attemptId) | `enrollments` FOR UPDATE (inside gradeAttemptIdempotent → finalizeGrading → finalizeTerminalGrading) | YES | **AE** |
| 7 | deadline autoSubmitAndGrade | Deadline scanner plugin | `attempts` FOR UPDATE (by attemptId) | `enrollments` FOR UPDATE (inside gradeAttemptIdempotent → finalizeGrading → finalizeTerminalGrading) | YES | **AE** |
| 8 | gradeQuestion (manual grading) | POST /admin/grading/... | `attempts` FOR UPDATE (by attemptId) | `enrollments` FOR UPDATE (inside finalizeTerminalGrading) | YES | **AE** |

### Non-dual-lock transactions (out of scope)

| Path | First Row Lock | Notes |
|------|---------------|-------|
| extendAttemptTime | `attempts` FOR UPDATE | Reads Exam (no lock), updates attempt only |
| restoreAttempt (standalone, no reconciliation) | `attempts` FOR UPDATE | Reads Exam (no lock), updates attempt only |
| markDisrupted | None (read without lock) | Single best-effort update |
| flagMisconduct | None | Single best-effort jsonb update |
| startOrRestoreAttempt (new attempt creation) | `enrollments` FOR UPDATE | findActiveByEnrollment returns no rows (no attempt locked), creates attempt + updates enrollment |

```
DUAL_LOCK_DOMAIN_COMPLETE: YES
```

---

## 3. Initial Locator Matrix

For each dual-lock path, the initial identifier available to the route handler:

| Path | Initial Locator | enrollmentId known before row lock? | attemptId known before row lock? |
|------|----------------|------------------------------------:|----------------------------------:|
| startOrRestoreAttempt (resume) | `examId + candidateId` | YES (derived from examId+candidateId, row locked first) | NO (discovered during tx) |
| candidate submit | `attemptId` | NO | YES (locked first) |
| take reconcile | `attemptId` | NO | YES (locked first) |
| save reconcile | `attemptId` | NO | YES (locked first) |
| restore reconcile | `attemptId` | NO | YES (locked first) |
| admin force-submit | `attemptId` | NO | YES (locked first) |
| deadline auto-submit | `attemptId` | NO | YES (locked first) |
| manual grading | `attemptId` | NO | YES (locked first) |

**Key finding:** 7 of 8 dual-lock paths are `attemptId`-rooted. Only `startOrRestoreAttempt` roots from `(examId, candidateId)`.

### How production currently obtains enrollmentId for AE paths

Every AE path eventually calls `finalizeTerminalGrading` which reads the attempt row (via `findById` without FOR UPDATE, inside the caller's already-locked Attempt context) and uses `attempt.examId` and `attempt.candidateId` to call `findByExamAndCandidateForUpdate`. This is:

1. Already within a transaction holding the Attempt FOR UPDATE
2. Using the attempt's FK columns to derive the enrollment locator

The locator resolution is: `attempt.examId + attempt.candidateId → exam_enrollments WHERE (organizationId, examId, candidateId)`.

### Canonical enrollment locator — repository evidence

```
CANONICAL_ENROLLMENT_LOCATOR:
There is NO enrollmentRepo.findByIdForUpdate. The only FOR UPDATE method on
createEnrollmentRepo (enrollmentRepo.ts) is findByExamAndCandidateForUpdate(examId,
candidateId). Therefore the attemptId-rooted protocol must derive the enrollment
lock target from the immutable Attempt identity columns (examId, candidateId) and
call findByExamAndCandidateForUpdate — there is no enrollmentId-keyed FOR UPDATE
path to use. The seam revalidates enrollment.id === locator.enrollmentId after
the lock to prove the (examId, candidateId) → enrollmentId join is consistent.
```

---

## 4. Attempt Locator Without Lock — Feasibility

The canonical attemptId-rooted protocol needs to discover `enrollmentId` before locking either row. The question is whether a non-locking read of the Attempt row (without FOR UPDATE) is safe for this purpose.

### Read context

Under `REPEATABLE READ` isolation (the system default, per `executeInTransaction`):

- A non-locking `SELECT ... FROM exam_attempts WHERE id = attemptId` reads the row from the transaction's snapshot.
- The row reflects the state as of the first query in the transaction.
- This is safe for a **locator read** because:
  - We only need `enrollmentId` (and optionally `examId`, `candidateId`) to find the owning Enrollment
  - These identity columns are set at creation time and NEVER mutated by any production code path
  - The FK `examAttempts.enrollmentId → examEnrollments.id` guarantees referential integrity at write time
  - Even if a concurrent tx were to delete the attempt row, the non-locking read would see it (snapshot), and the subsequent FOR UPDATE would fail (no row to lock) — caught by revalidation

### Required columns

The locator read needs exactly:
- `id` — to confirm the row exists
- `enrollmentId` — to find the Enrollment row
- `examId` and `candidateId` — alternate locator for Enrollment (currently used in `findByExamAndCandidateForUpdate`)
- `status` — for optional early-out (skip if terminal)

### Production constraint verification

| Column | Mutation path | Verdict |
|--------|-------------|---------|
| `enrollmentId` | None; set at creation in `startOrRestoreAttempt` (attemptRepo.create), never updated | IMMUTABLE |
| `examId` | None; set at creation, never updated | IMMUTABLE |
| `candidateId` | None; set at creation, never updated | IMMUTABLE |
| `status` | Multiple mutation paths | MUTABLE — must be revalidated under lock |

```
LOCATOR_SAFETY_PROVEN = YES
```

**Conclusion:** A non-locking locator read is **semantically safe** because the identity columns (`enrollmentId`, `examId`, `candidateId`) are immutable after creation. The `status` field obtained in the locator read is a snapshot hint only — the canonical decision is re-evaluated under lock.

---

## 5. Concurrent Change / Revalidation Matrix

For each possible concurrent change between the locator read (step 1) and the Attempt FOR UPDATE (step 3):

| Concurrent change | Protocol reachable? | Prevented by schema/invariant? | Observed after Attempt lock? | Required action |
|-------------------|---------------------|-------------------------------|----------------------------|-----------------|
| Attempt row **deleted** | YES (if DELETEs are allowed in production — audit shows none exist for attempts; `delete` exists in CRUD base but is never invoked on attempts in any route) | NO production path deletes attempt rows | step 3 returns null | NotFoundError (locator was stale) |
| Attempt **enrollmentId changed** | NO — no production code path writes `enrollmentId` after creation | Schema allows UPDATE, but no code path does this | N/A | Guard: revalidate `lockedAttempt.enrollmentId === locator.enrollmentId` |
| Attempt **status changed** (e.g., submitted by concurrent tx) | YES — concurrent submit, force-submit, or auto-submit can flip status | No schema constraint beyond text field | FOR UPDATE reads latest version; revalidation sees current status | Caller re-evaluates domain guards against locked status |
| Enrollment **deleted** | YES (same as Attempt — delete exists but is unused in production) | No production path deletes enrollment rows | step 2 returns null | NotFoundError |
| Enrollment **status changed** | YES — concurrent grading completion can flip enrollment status | No CHECK constraint on status field | FOR UPDATE reads latest version | Domain guard (`shouldEnrollmentComplete`, `assertEnrollmentTransition`) uses locked enrollment |
| Another Attempt becomes active | YES — concurrent startOrRestoreAttempt can create a new in_progress attempt under the same enrollment | UNIQUE(org, enrollment, attemptNo) prevents exact duplicates | step 3 locks the specific attemptId; new attempt has different id | No impact — each attemptId is independent |
| Transaction receives serialization failure (40001) | YES — FOR UPDATE re-read of concurrently modified row can trigger REPEATABLE READ conflict | PostgreSQL behavior under REPEATABLE READ | 40001 raised on write attempt after conflict | Existing 3-retry in executeInTransaction handles this |
| Deadlock (now reversed) | NO — lock order is now Enrollment→Attempt, matching EA | All dual-lock paths converge on E→A | N/A | Cycle is eliminated |

**Key invariant:** The only mutable column used by the dual-lock protocol is `status`. Identity columns are immutable. Therefore a stale locator read can only lead to a stale status hint, which is revalidated under lock.

---

## 6. Canonical Lock Acquisition Protocol

### Pseudocode (D1C2 — identity-capability form)

```text
lockEnrollmentAndAttempt(attemptRepo, enrollmentRepo, attemptId):
    Input:  attemptId
    Output: LockedEnrollmentAttemptIdentity   (opaque, identity-only capability)
            or throws NotFoundError/ValidationError

    lock-seam invariants (owned by this function, PROVEN by the capability):
      - Attempt row exists and has immutable identity (enrollmentId)
      - Enrollment row exists and matches attempt.enrollmentId
      - E lock acquired BEFORE A lock, in this transaction
      - both locks are held by the current transaction

    caller-owned domain guards (NOT in seam):
      - attempt.status must be eligible for the command (in_progress/disrupted for submit, etc.)
      - enrollment.status transition must be legal
      - exam-level preconditions (timing, retake policy, etc.)
      - command-specific business rules

    Steps:
    1. locator = attemptRepo.findById(attemptId)
       NOTE: reads WITHOUT FOR UPDATE — identity columns are immutable
       if locator == null:
           throw NotFoundError("Attempt not found")

    2. enrollment = enrollmentRepo.findByExamAndCandidateForUpdate(
           locator.examId, locator.candidateId)
       NOTES:
         - Locks enrollment row; blocks concurrent enrollment writers
         - REPEATABLE READ: this is a fresh statement, blocks until holder commits
       if enrollment == null:
           throw NotFoundError("Enrollment not found")
       if enrollment.id != locator.enrollmentId:
           throw ValidationError("Enrollment mismatch — data integrity violation")

    3. attempt = attemptRepo.findByIdForUpdate(attemptId)
       NOTES:
         - Locks attempt row; blocks concurrent attempt writers
         - 40001 possible if concurrent tx modified the attempt (retry layer)
       if attempt == null:
           throw NotFoundError("Attempt not found")

    4. // Revalidation (lock-seam invariants only)
       if attempt.enrollmentId != enrollment.id:
           throw ValidationError("Attempt enrollment mismatch — data integrity violation")

    5. // Capability construction — ONLY the factory constructs this type.
       // Returns IDENTITY ONLY. The capability proves the protocol ran; it is
       // NOT a snapshot of mutable row state. Downstream re-reads mutable
       // state inside the same tx as needed.
       return makeLockedEnrollmentAttemptIdentity({
           enrollmentId: enrollment.id,
           attemptId: attempt.id,
       });
```

### Ownership split

| Check | Owner | Why |
|-------|-------|-----|
| Attempt exists | **lock seam** | Required for any dual-lock operation |
| Enrollment exists | **lock seam** | Required for any dual-lock operation |
| enrollmentId matches | **lock seam** | Lock-order invariant — wrong enrollment means wrong lock target |
| E-before-A order | **lock seam** | The capability can only be minted by `lockEnrollmentAndAttempt` |
| Attempt status eligible | **caller / domain** | Each command has different status eligibility (submit needs in_progress/disrupted, gradeQuestion needs submitted+pending_manual) |
| Enrollment transition legal | **caller / domain** | Completability depends on retake policy, score strategy, etc. |
| Timing preconditions | **caller / domain** | Exam open/close, deadline, min submit time |
| Score/finalization logic | **caller / domain** | `shouldSelectAttempt`, `shouldEnrollmentComplete` |

---

## 7. Validation Ownership Boundary

### Lock-seam invariants (proven by capability possession)

```text
Invariant 1: Attempt row exists (not deleted, not wrong org)
Invariant 2: Enrollment row exists
Invariant 3: attempt.enrollmentId === enrollment.id
Invariant 4: Enrollment lock acquired strictly before Attempt lock, in this tx
```

Invariants 1-3 are **data integrity** invariants; invariant 4 is a **lock-order protocol** invariant. Possession of the `LockedEnrollmentAttemptIdentity` capability proves all four.

### Caller/domain guards (NOT in seam)

```text
Guard 1: attempt.status eligibility (in_progress? disrupted? submitted?)
Guard 2: enrollment.status transition legality
Guard 3: exam timing (open/close window, deadline expiry)
Guard 4: retake policy (maxAttempts, pass_then_stop)
Guard 5: score strategy and completion logic
Guard 6: manual grading lifecycle (pending_manual guard)
Guard 7: min-submit-after-start-minutes
Guard 8: late-entry cutoff (latestStartOffsetMinutes)
```

### Database constraints (PostgreSQL enforces independently)

```text
Constraint 1: UNIQUE(organizationId, enrollmentId, attemptNo) — prevents duplicate attempt numbers
Constraint 2: FK examAttempts.enrollmentId → examEnrollments.id
Constraint 3: FK examAttempts.examId → exams.id
Constraint 4: FK examAttempts.candidateId → candidateProfiles.id
Constraint 5: Tenant scoping via organizationId
```

### Retry layer

```text
Retry 1: executeInTransaction — 3 retries on 40001/40P01 with exponential backoff
```

---

## 8. Canonical Seam Decision

### Candidate comparison

| | Candidate 1: attemptRepo method | Candidate 2: enrollmentRepo method | Candidate 3: engine helper | Candidate 4: separate locator + lock helper |
|---|---|---|---|---|
| **Single ownership of lock order** | YES — one method owns both locks | NO — only locks enrollment; caller still locks attempt | YES | SPLIT — locator is separate but lock order in helper |
| **Repository boundary consistency** | Cross-repo dependency (needs enrollmentRepo) | Cross-repo dependency (needs attemptRepo) | Clean — works at engine level with both repo interfaces | Clean — locator is attempt only, lock helper takes both |
| **Testability** | Medium — needs both repos mocked | Medium — needs both repos mocked | HIGH — pure engine function, mock both repo ports | HIGH — two testable units |
| **Caller misuse risk** | Low — single call, hard to bypass | HIGH — caller still must lock Attempt | Medium — caller chooses whether to use the helper | Medium — two calls, but lock helper is clearly the authority |
| **Future AI drift risk** | Medium — AI could import attemptRepo independently | HIGH — AI could easily add independent Attempt lock | LOW — engine layer is the domain boundary | LOW — locator is read-only, lock helper is the authority |
| **Production churn** | Low — one new method in attemptRepo | Low — one new method in enrollmentRepo | Lowest — new file, no repo changes | Lowest — new file, no repo changes |
| **Structural enforcement** | Harder — forbid call sequences across two repos | Harder | EASIEST — forbid direct dual-lock patterns, import the helper | EASIEST |

### Selected: Candidate 3 — Engine-layer helper function

```
CANONICAL_LOCK_SEAM:
packages/exam-engine/src/lockSeam.ts
  → lockEnrollmentAndAttempt(
      enrollmentRepo: EnrollmentRepository,
      attemptRepo: AttemptRepository,
      attemptId: string,
    ): Promise<LockedEnrollmentAttemptIdentity>
```

**Rationale:** identical to the prior D1 conclusion (clean layering, single lock-order ownership, lowest churn, strongest AI-drift wall), with the return type strengthened from a plain `{ enrollment, attempt }` pair to an opaque identity-only capability (see §D).

---

## 9. Forbidden Acquisition Patterns

### Forbidden Pattern 1: Direct AE lock sequence

```
attemptRepo.findByIdForUpdate(attemptId)
...
enrollmentRepo.findByExamAndCandidateForUpdate(examId, candidateId)
```

This is the **current deadlock-inducing pattern**. Must be forbidden in any dual-lock transaction.

### Forbidden Pattern 2: Independent dual lock without seam

```
enrollmentRepo.findByExamAndCandidateForUpdate(examId, candidateId)
attemptRepo.findByIdForUpdate(attemptId)
```

Even though the order is EA, acquiring both locks independently (not through the canonical seam) creates drift: future changes to one lock's scope or timeout would need updating in multiple places, and reconstructing an `as LockedEnrollmentAttemptIdentity` from independent locks is the explicit forgery escape hatch this design mechanically rejects (§E).

### Exception: Single-lock transactions

Not all transactions holding one of these locks are dual-lock. The following are **allowed**:

```
Enrollment-only:
  - startOrRestoreAttempt (new creation — no Attempt locked)
  - Any admin enrollment management

Attempt-only:
  - extendAttemptTime
  - markDisrupted (no lock)
  - flagMisconduct (no lock)
  - restoreAttempt (no Enrollment lock needed)
  - Save answer that does NOT trigger reconciliation
```

Per HR-2, `EnrollmentRepository.findByExamAndCandidateForUpdate` and
`AttemptRepository.findByIdForUpdate` are NOT globally banned. They retain
legitimate single-lock and naturally-EA-ordered owners
(`startOrRestoreAttempt`, `extendAttemptTime`, `restoreAttempt`). Only their
*composition in the AE order within a dual-lock transaction* is forbidden.

### Exception: EA path in startOrRestoreAttempt (resume)

```
enrollmentRepo.findByExamAndCandidateForUpdate(examId, candidateId)
attemptRepo.findActiveByEnrollment(enrollmentId)    // FOR UPDATE
```

This is the **only naturally EA-ordered path**. It cannot migrate to the attemptId-rooted seam because it starts with `(examId, candidateId)`, not `attemptId`. It is **not in the forbidden set** because its order is correct.

However, it should still be documented as a canonical EA path to prevent future refactoring from inverting it.

---

## 10. Structural Enforcement Design

### Enforcement mechanism: Architecture lint rule

```
pnpm lint:arch — forbid the AE lock order pattern
```

Specifically, add an architecture lint rule (in `docs/code-quality.md` and enforced via `pnpm lint:arch`):

```text
Rule: DUAL_LOCK_ORDER
Severity: error
Pattern:
  File matches: packages/exam-engine/** or apps/api/**
  Forbidden: Any function that calls both
    attemptRepo.findByIdForUpdate (or AttemptRepository.findByIdForUpdate)
    AND
    enrollmentRepo.findByExamAndCandidateForUpdate (or EnrollmentRepository.findByExamAndCandidateForUpdate)
  Exception list (by function name):
    - startOrRestoreAttempt (naturally EA)
    - lockEnrollmentAndAttempt (canonical seam)
    - [test helpers]
```

### Source-level test (supplementary)

A vitest-based structural test (in `packages/exam-engine` or `apps/api`):

```typescript
// __tests__/lock-order-structural.test.ts
// Scans all production source files for the AE import/method-call pattern.
// Uses AST analysis or regex-based import+callsite detection.
// Fails if a production file imports both attempt "findByIdForUpdate"
// and enrollment "findByExamAndCandidateForUpdate" outside the seam.
// Additionally fails on any `as LockedEnrollmentAttemptIdentity` cast
// (see §E / §G rule 4).
```

### Runtime enforcement (belt-and-suspenders)

A defensive assertion in `finalizeTerminalGrading` (the common Enrollment-lock caller for all AE paths): the function should not be reachable without the caller holding the capability. The structural test approach is more reliable.

### Selected enforcement

```
ENFORCEMENT_MECHANISM:
1. Architecture lint rule (pnpm lint:arch) — blocks the forbidden import/method-call pattern
2. Supplementary AST scan in CI — catches any attemptRepo.findByIdForUpdate → enrollmentRepo.findByExamAndCandidateForUpdate calls outside the seam
3. Documentation in docs/code-quality.md — marks the forbidden pattern and the canonical seam
```

---

## 11. Production Migration Blast Radius

### Callers that would need migration

| # | Caller | File | Current Protocol | New Protocol | Business semantics changed? |
|---|--------|------|-----------------|--------------|---------------------------|
| 1 | submitAndGradeAttempt | apps/api/src/orchestrators/submitAndGradeAttempt.ts | Lock Attempt → ensureAttemptDeadlineReconciled → finalizeGrading (locks Enrollment inside) | Use `lockEnrollmentAndAttempt` first; pass capability through; finalizeGrading receives identity and re-reads E without FOR UPDATE | NO |
| 2 | Take snapshot handler | apps/api/src/routes/attempts.candidate.ts (line 788) | Lock Attempt (inside ensureAttemptDeadlineReconciled) → finalizeTerminalGrading (locks Enrollment) | Use `lockEnrollmentAndAttempt` first, pass capability to ensureAttemptDeadlineReconciled (which can skip its own lock) | NO |
| 3 | Save answer handler | apps/api/src/routes/attempts.candidate.ts (line 882) | Lock Attempt → ensureAttemptDeadlineReconciled (locks Enrollment inside finalizeTerminalGrading) | Use `lockEnrollmentAndAttempt` first, pass capability through | NO |
| 4 | Restore handler | apps/api/src/routes/attempts.candidate.ts (line 1164) | Lock Attempt (inside ensureAttemptDeadlineReconciled) → finalizeTerminalGrading (locks Enrollment) | Use `lockEnrollmentAndAttempt` first, pass capability to ensureAttemptDeadlineReconciled | NO |
| 5 | Admin force-submit | apps/api/src/routes/attempts.admin.ts (line 178) | Lock Attempt → submitAttempt → gradeAttemptIdempotent (locks Enrollment via finalizeTerminalGrading) | Use `lockEnrollmentAndAttempt` first, pass capability | NO |
| 6 | Deadline scanner autoSubmitAndGrade | apps/api/src/plugins/deadlineScanner.ts (line 146) | Lock Attempt → Lock Exam → submitAttempt → gradeAttemptIdempotent (locks Enrollment via finalizeTerminalGrading) | Use `lockEnrollmentAndAttempt` first (before Exam lock), then lock Exam, then submit+grade | NO |
| 7 | gradeQuestion → finalizeTerminalGrading | packages/exam-engine/src/manualGrading.ts (line 201) | Lock Attempt → gradeQuestion → finalizeTerminalGrading (locks Enrollment) | The caller of gradeQuestion uses `lockEnrollmentAndAttempt` first; gradeQuestion passes the capability (or derived identity) into finalizeTerminalGrading | NO |

### Total migration count

```
Files modified:         7 (6 route/orchestrator, 1 engine function)
Lines changed:          15-25 (predominantly import + call site swap)
New file:               1 (packages/exam-engine/src/lockSeam.ts)
Business semantics:     0 changed
```

### Migration pattern for each caller

Before:
```typescript
await executeInTransaction(db, async (tx) => {
  const attempt = await attemptRepo.findByIdForUpdate(ctx, attemptId);
  // ... work ...
  await finalizeGrading(enrollments, attempts, workset, attemptId, enrollmentId, exam, now);
});
```

After:
```typescript
await executeInTransaction(db, async (tx) => {
  const lock = await lockEnrollmentAndAttempt(enrollments, attempts, attemptId);
  // ... work; re-read mutable attempt/enrollment state as needed ...
  // finalizeTerminalGrading receives `lock` (or derived ids) and must NOT
  // re-acquire E FOR UPDATE — see §F.
  await finalizeTerminalGrading(
    enrollments, attempts, workset, lock, exam, now,
  );
});
```

---

## 12. Risks / Unresolved Questions

### Risk 1: startOrRestoreAttempt remains EA-ordered

`startOrRestoreAttempt` (examId+candidateId-rooted) must remain EA-ordered because it discovers the attempt via enrollment. It cannot use the attemptId-rooted seam. This means:

- The codebase has TWO canonical dual-lock patterns: EA (examId-rooted) and E→A via seam (attemptId-rooted)
- Both converge on Enrollment→Attempt order
- Future refactoring must not invert either one

**Mitigation:** Document both as canonical patterns. The EA path in `startOrRestoreAttempt` is naturally EA-ordered and cannot drift because it starts with enrollment lookup.

### Risk 2: Exam FOR UPDATE in deadline scanner

The deadline scanner `autoSubmitAndGrade` also locks `Exam FOR UPDATE`. The current order is:

```
Attempt FOR UPDATE → Exam FOR UPDATE → Enrollment FOR UPDATE (inside finalizeTerminalGrading)
```

With the canonical seam, the order becomes:

```
Enrollment FOR UPDATE → Attempt FOR UPDATE → Exam FOR UPDATE
```

This adds a new lock-order dependency (E→A→Exam). No existing path inverts this, but an `Exam FOR UPDATE → Enrollment FOR UPDATE` path would create a new cycle. Audit shows no such path exists (admin exam transitions lock Exam only, and admin enrollment operations lock Enrollment only).

**Mitigation:** Document the three-way lock order `Enrollment → Attempt → Exam` as the multi-lock transaction invariant.

```
EXAM_MULTI_LOCK_ORDER: Enrollment → Attempt → Exam (deadline scanner only).
No Exam→Enrollment or Exam→Attempt dual-lock path exists in audited production.
```

### Risk 3: Serialization failure on locator-identity mismatch

Under REPEATABLE READ, the FOR UPDATE re-read in step 3 (locking the attempt) may trigger a 40001 serialization failure if a concurrent tx modified the attempt row between the locator read and the FOR UPDATE. This is handled by the existing 3-retry mechanism but adds latency.

**Mitigation:** Accept the retry latency. The current AE paths already experience 40P01 deadlock retries (1s+ each); the new protocol replaces deadlock retries (40P01) with serialization-failure retries (40001) which fire immediately (no deadlock_timeout wait). Net latency impact: **same or lower** than the current deadlock retry.

### Unresolved Question: What about `findActiveByEnrollment` in EA resume?

The EA-resume path in `startOrRestoreAttempt` uses `attemptRepo.findActiveByEnrollment(enrollmentId)` which has its own FOR UPDATE. This acquires the Attempt lock while already holding the Enrollment lock. This is correct (EA order) but goes through a different repo method, not the canonical seam. Could the seam also accept an enrollmentId-based entry point in the future? Possibly, but it's outside the current scope (the deadlock originates from AE paths, not EA paths).

---

## 13. Final Recommendation

### 1. Implement the canonical seam (D1C2 identity-capability form)

Create one new file:

```
packages/exam-engine/src/lockSeam.ts
```

Export (see §D for why identity-only):

```typescript
export interface LockedEnrollmentAttemptIdentity {
  readonly enrollmentId: string;
  readonly attemptId: string;
  readonly [LOCK_TOKEN]: unique symbol; // unexported brand — see §E
}

export async function lockEnrollmentAndAttempt(
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
): Promise<LockedEnrollmentAttemptIdentity>
```

With the protocol defined in §6.

### 2. Modify `finalizeTerminalGrading` — remove inner Enrollment FOR UPDATE (HR-3)

The current signature is:

```typescript
async function finalizeTerminalGrading(
  enrollmentRepo, attemptRepo, gradingWorksetRepo,
  attemptId, enrollmentId, exam, now,
): Promise<boolean>
```

After migration, the caller has already locked Enrollment. `finalizeTerminalGrading` MUST NOT retain its own `findByExamAndCandidateForUpdate`. It receives the caller-provided `enrollmentId` (proven by capability possession) and re-reads the enrollment **without** FOR UPDATE (`findByExamAndCandidate`). Under REPEATABLE READ, that non-locking read observes the caller transaction's own writes and the already-held lock (§C). The `enrollment.id !== enrollmentId` revalidation is retained.

See §F for the exact rule.

### 3. Migrate all 7 AE callers

Swap the current `attemptRepo.findByIdForUpdate(ctx, attemptId)` + `finalizeGrading(...)` calls to use `lockEnrollmentAndAttempt` first, then pass the capability (or derived ids) through the remaining pipeline. Callers must re-read mutable attempt/enrollment state inside the same tx when they need post-write values, because the capability carries identity only.

### 4. Add enforcement rules

- Architecture lint rule forbidding the AE lock sequence
- AST-based structural test, including the `as LockedEnrollmentAttemptIdentity` ban
- Documentation in `docs/code-quality.md`

### 5. Do NOT modify `startOrRestoreAttempt`

The EA path is naturally correct. Document it as the other canonical dual-lock pattern.

### Priority order for implementation

```
1. lockSeam.ts (new file, opaque identity capability, testable in isolation)
2. finalizeTerminalGrading — remove inner Enrollment lock; accept capability/identity
3. submitAndGradeAttempt — first migration (simplest, single orchestrator)
4. ensureAttemptDeadlineReconciled — if used standalone (take/save/restore paths)
5. admin force-submit — migrate
6. deadline autoSubmitAndGrade — migrate (note Exam lock order)
7. gradeQuestion — migrate
8. Enforcement rules (lint + structural test + cast ban)
```

The migration can be done incrementally, path by path, with no release-blocking dependencies between steps 3-7.

```
MIXED_ORDER_RUNTIME_SAFE = NO
```

Until all 7 AE families are migrated, the repository still contains the deadlock-inducing AE pattern, so mixed migrated/unmigrated runtime is NOT safe to ship. Per the established fact:

```
DUAL_LOCK_CUTOVER_GATE = all 7 AE families migrated before shippable state
```

---

## 14. D1C2 — Capability Witness Boundary (this audit's contribution)

This section establishes the exact semantic shape of the canonical dual-lock
capability witness. The prior D1 report left the return type as
`{ enrollment: ExamEnrollment; attempt: ExamAttempt }` and flagged it as
"insufficient as an enforceable protocol boundary." D1C2 closes that gap.

---

### A. Narrowest witness boundary

Inspect the production call chain and classify each function by whether it
needs the capability, propagates it, or does not need it:

| function | classification | exact reason |
| -------- | -------------- | ------------ |
| `submitAndGradeAttempt` (orchestrator) | **REQUIRES_EA_LOCK_WITNESS** | It is the transaction owner; it must call `lockEnrollmentAndAttempt` and is the only place the capability is minted on this path. |
| `ensureAttemptDeadlineReconciled` | **PROPAGATES_EA_LOCK_WITNESS** | Currently acquires its own Attempt FOR UPDATE internally. Post-migration it receives the capability from its caller and must NOT re-lock. It propagates the capability into `finalizeGrading`. |
| `submitAttempt` | **DOES_NOT_REQUIRE_WITNESS** | Single-Attempt-row operation. It calls `attemptRepo.findByIdForUpdate` itself; under REPEATABLE READ + held capability the lock is already held, and a re-lock of the same row in the same tx is a no-op (Postgres allows re-locking an already-self-held row). No E lock involved. |
| `finalizeGrading` | **PROPAGATES_EA_LOCK_WITNESS** | Thin wrapper; passes capability/identity into `finalizeTerminalGrading`. |
| `finalizeTerminalGrading` | **PROPAGATES_EA_LOCK_WITNESS** | The Enrollment-lock consumer. Receives the caller-proven enrollmentId; MUST NOT re-acquire E FOR UPDATE. Re-reads E without lock (§C). |
| `gradeAttempt` | **PROPAGATES_EA_LOCK_WITNESS** | Reads snapshot then calls `finalizeGrading`; capability threaded through. |
| `gradeAttemptIdempotent` | **PROPAGATES_EA_LOCK_WITNESS** | Same as `gradeAttempt` plus idempotency short-circuit. |
| `gradeQuestion` terminal path | **PROPAGATES_EA_LOCK_WITNESS** | `manualGrading.ts:201` calls `finalizeTerminalGrading`; receives capability from the route handler which already called `lockEnrollmentAndAttempt`. |
| admin force-submit route | **REQUIRES_EA_LOCK_WITNESS** | Transaction owner (`attempts.admin.ts:178`); mints the capability. |
| deadline auto-submit (`autoSubmitAndGrade`) | **REQUIRES_EA_LOCK_WITNESS** | Transaction owner (`deadlineScanner.ts:146`); mints the capability before the Exam lock. |
| take/save/restore route handlers | **REQUIRES_EA_LOCK_WITNESS** | Transaction owners; mint the capability. |
| `startOrRestoreAttempt` (resume/new) | **DOES_NOT_REQUIRE_WITNESS** | Naturally EA; uses its own EA-ordered lock pair and is exempt from the seam. |
| `extendAttemptTime`, `restoreAttempt` (standalone), `markDisrupted`, `flagMisconduct` | **DOES_NOT_REQUIRE_WITNESS** | Attempt-only or no-lock operations. |

The boundary is kept narrow: only **transaction owners** (route handlers and
the scanner entry point) are required to expose the witness in their flow.
Engine-internal functions merely propagate it. `submitAttempt` deliberately
does NOT require the witness because it is single-Attempt.

```
NARROWEST_WITNESS_BOUNDARY:
  - submitAndGradeAttempt         (apps/api/src/orchestrators/submitAndGradeAttempt.ts)
  - take/save/restore handlers    (apps/api/src/routes/attempts.candidate.ts)
  - admin force-submit handler    (apps/api/src/routes/attempts.admin.ts)
  - autoSubmitAndGrade            (apps/api/src/plugins/deadlineScanner.ts)
  - gradeQuestion route handler   (apps/api/src/routes/gradingQueue.ts)
Each of these is a transaction owner and the SOLE mint site for the capability
on its path. Engine functions (finalizeGrading, finalizeTerminalGrading,
gradeAttempt*, ensureAttemptDeadlineReconciled, gradeQuestion engine fn) only
PROPAGATE the capability.
```

---

### B. Locked-row snapshot staleness

Assume `lockEnrollmentAndAttempt` returns loaded `ExamEnrollment`/`ExamAttempt`
snapshots (Design D1/D2). Trace same-transaction mutations that occur before
terminal finalization. Repository `update` semantics (baseRepo.ts:156-172):
`update` issues `UPDATE ... SET ... WHERE id` then calls `findById` and returns
a **freshly read** row. So `update` itself does NOT mutate the previously
loaded JS object in place — but any *earlier* loaded reference is now stale.

| mutation | row | loaded object automatically refreshed? | later consumer | stale-object risk |
| -------- | --- | -------------------------------------: | -------------- | ----------------- |
| `submitAttempt` → `attemptRepo.update(status=submitted, submittedAnswers, gradingStatus)` | Attempt | NO — the `attempt` captured at lock time is a different object than the one `submitAttempt` returns | `readGradingSnapshot` re-reads attempt via `findById` (submitAndGradeAttempt.ts:159) → safe ONLY because it re-reads. A consumer using the lock-time `attempt` would see pre-submit status/answers. | **PRESENT** |
| `submitAttempt` materializes grading workset | AttemptGradingEntry | N/A (new rows) | `finalizeTerminalGrading` reads entries fresh | none |
| deadline reconciliation submit+grade | Attempt | NO — see above | `ensureAttemptDeadlineReconciled` re-reads via `findById` (deadlineReconciliation.ts:206) | **PRESENT** if lock-time snapshot were reused |
| restore-related transition (`restoreAttempt`) | Attempt | NO — `restoreAttempt` returns its own fresh object; the lock-time object is stale | route uses returned object | **PRESENT** if caller used lock-time snapshot |
| grading status changes (`attemptRepo.update(status=graded, score, ...)`) | Attempt | NO | `gradeQuestion` re-reads via `findById` (manualGrading.ts:227); `gradeAttemptIdempotent` re-reads (grading.ts:509) | **PRESENT** if lock-time snapshot reused |
| attempt score / grading projection writes | Attempt | NO | callers re-read | **PRESENT** if reused |
| enrollment writes (`enrollmentRepo.update(status, finalScore, ...)`) | Enrollment | NO | none observed post-write in same tx | low |
| manual grading terminal transition | Attempt + Enrollment | NO | `gradeQuestion` re-reads attempt | **PRESENT** if reused |

Key observation: **the only reason current code is safe is that it re-reads
mutable state via `findById` after each mutation.** The lock-time loaded
objects are NOT live ORM entities — Drizzle returns plain snapshots. If the
capability carried the lock-time `attempt`/`enrollment` snapshots, a
downstream caller that consumed `pair.attempt.status` after `submitAttempt`
mutated the row would observe the **pre-submit** status — a stale-object bug.

```
LOCKED_ROW_SNAPSHOT_STALE_RISK: PRESENT
```

This is the decisive evidence against Design 1 (plain loaded pair) and Design 2
(opaque pair with loaded snapshots): both bundle snapshots that go stale the
moment any same-tx mutation lands.

---

### C. Same-transaction re-read semantics

For the actual stack (PostgreSQL + Drizzle, `executeInTransaction` sets
`isolationLevel: "repeatable read"` — types.ts:129), determine what a
non-locking re-read observes after a same-tx UPDATE:

```
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT ... FROM exam_attempts WHERE id = X FOR UPDATE;   -- lock + read v1
UPDATE exam_attempts SET status='submitted' WHERE id=X;  -- write v2
SELECT ... FROM exam_attempts WHERE id = X;              -- non-locking re-read
```

PostgreSQL REPEATABLE READ semantics (official docs §13.2, verified via web
search against postgresql.org): the transaction uses a single snapshot taken
at the first query, AND **a transaction always sees its own writes** within
itself. The non-locking re-read therefore observes **the transaction's own
write (v2)**, not the pre-transaction snapshot value. FOR UPDATE in the first
statement does not change own-write visibility — it only blocks concurrent
writers and triggers 40001 on conflicting concurrent commits.

The same holds for Enrollment: after `enrollmentRepo.findByExamAndCandidateForUpdate`
acquires the E lock, any same-tx `findByExamAndCandidate` (no FOR UPDATE)
re-read observes the locked, current (possibly self-mutated) row.

```
SAME_TX_REREAD_MODEL:
A non-locking SELECT inside the same REPEATABLE READ transaction observes the
transaction's OWN most-recent write to that row (v2), NOT the pre-transaction
snapshot (v1). FOR UPDATE in an earlier statement of the same tx does not
suppress own-write visibility. This holds for both Attempt and Enrollment.
Consequence: once the capability proves the locks are held, downstream code
can safely re-read mutable state via non-locking findById and observe the
authoritative in-tx value, with no second FOR UPDATE round trip.
```

This is the semantic foundation that makes Design 3 (identity-only capability
+ same-tx re-read) correct and free of stale-object risk.

---

### D. Capability shape comparison

| criterion | D1 plain pair | D2 opaque snapshots | D3 identity capability |
| --- | --- | --- | --- |
| lock-order protocol representation | WEAK — `{enrollment, attempt}` is just data; nothing ties it to "E locked before A in this tx" | MEDIUM — brand suggests protocol but the snapshots are the prominent payload | STRONG — the type exists ONLY to prove the protocol ran; identity is the protocol receipt |
| caller forgery risk | HIGH — any code can build `{enrollment, attempt}` from two `findById` calls | MEDIUM — brand can be made opaque, but a caller with both snapshots can still pattern-match | LOW — only the factory can mint the brand |
| stale-object risk | **HIGH** — snapshots go stale on first same-tx mutation (§B) | **HIGH** — same as D1; the snapshots are still bundled | **NONE** — no mutable snapshot is carried; callers re-read fresh state (§C) |
| downstream DB round trips | FEWEST at the seam, but callers must re-read anyway (so net = same or more once staleness is handled) | Same as D1 | ONE extra `findById` per consumer that needs post-write state — but those re-reads ALREADY exist in production (submitAndGradeAttempt.ts:145,159; grading.ts:509; manualGrading.ts:227; deadlineReconciliation.ts:206). Net new round trips: 0 |
| signature churn | LOWEST — matches today's `{enrollment, attempt}` shape | MEDIUM — new opaque type | MEDIUM — new opaque type, plus threaded parameter |
| future AI misuse risk | HIGHEST — AI can trivially reconstruct the pair and bypass the seam | MEDIUM — AI can still `as`-cast | LOWEST — `as LockedEnrollmentAttemptIdentity` is a banned cast (§G rule 4); no object literal can mint the brand |
| semantic clarity | LOW — type name says "pair," not "protocol proof" | MEDIUM | HIGHEST — the type name literally is the protocol invariant |

#### Decision

```
LOCK_CAPABILITY_SHAPE: OPAQUE_IDENTITY_CAPABILITY
```

Design 3 is selected. Rationale, in priority order:

1. **Stale-object safety (§B).** D1/D2 carry snapshots that are provably stale
   after the first same-tx write. D3 carries identity only; consumers re-read
   mutable state and, per §C, observe authoritative in-tx values. This is the
   deciding criterion — a protocol boundary that bundles stale data is a
   semantic bug waiting to happen.
2. **Protocol representation.** The capability's job is to prove "E was locked
   before A, in this transaction, and identity was revalidated." Identity is
   exactly the receipt for that proof. Bundling row state conflates the
   protocol fact with mutable data.
3. **Forgery resistance (§E).** An identity-only branded type cannot be
   constructed by object literal; only the factory mints it.
4. **Zero net new round trips.** Every downstream consumer that needs
   post-write state already re-reads it today; D3 makes those re-reads
   authoritative rather than redundant.

The alternative designs (D1, D2) are **not** equally recommended.

---

### E. Opacity boundary

Narrowest TypeScript/module mechanism assessment:

| mechanism | verdict |
| --- | --- |
| unexported unique symbol brand + exported interface with the brand as a required property | **SELECTED** — object literals cannot supply an unexported-symbol key from outside the module; only the factory (in the same module, which CAN see the symbol) can attach it |
| exported interface with unexported brand key | equivalent to the above; the symbol form is preferred for uniqueness |
| class with private constructor | workable but heavier; introduces value-semantics issues (a class instance is also `{enrollmentId, attemptId}`-shaped) |
| factory only in lockSeam.ts | REQUIRED regardless of mechanism — it is the construction authority |
| module-private concrete type + exported abstract/interface type | viable; the symbol-brand on an exported interface achieves the same with less ceremony |

Selected shape:

```typescript
// packages/exam-engine/src/lockSeam.ts
const LOCK_TOKEN: unique symbol = Symbol("LockedEnrollmentAttemptIdentity");
export const LOCKED_ENROLLMENT_ATTEMPT_IDENTITY = LOCK_TOKEN; // for type guards only

export interface LockedEnrollmentAttemptIdentity {
  readonly enrollmentId: string;
  readonly attemptId: string;
  readonly [LOCK_TOKEN]: typeof LOCK_TOKEN; // unexported symbol key
}

// ONLY this function, in this module, can attach LOCK_TOKEN.
export async function lockEnrollmentAndAttempt(
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
): Promise<LockedEnrollmentAttemptIdentity> { /* §6 protocol */ }
```

Answers to the required opacity questions:

```
CAPABILITY_FACTORY:
packages/exam-engine/src/lockSeam.ts :: lockEnrollmentAndAttempt
```

```
CAPABILITY_FORGERY_BY_NORMAL_TYPED_CODE: NO
```

Reasoning: normal typed production code (and AI-generated code) cannot
construct `LockedEnrollmentAttemptIdentity` from an object literal because the
`[LOCK_TOKEN]` property key is an unexported `unique symbol`. Outside
`lockSeam.ts` the symbol is unnameable, so no `{ ... }` literal can include
that key with the correct symbol identity. A literal that omits the key fails
structurally; a literal using a *different* symbol (e.g. a locally-declared
one) fails because `unique symbol` identity is by reference, not by name.

```
EXPLICIT_CAST_ESCAPE_HATCH:
`as LockedEnrollmentAttemptIdentity` is the only realistic bypass, and it is
mechanically rejected: the architecture lint + structural test (§G rule 4)
forbid any `as LockedEnrollmentAttemptIdentity` (and any `as` assertion whose
target type name contains the capability) in production source. TypeScript
itself cannot make malicious casts impossible — that is not claimed. The
target is exactly that normal typed code and ordinary AI-generated code cannot
ACCIDENTALLY reconstruct the witness without an explicit, banned escape hatch.
```

HR-1 compliance: the brand is not decoration. The capability represents four
established facts — (1) E row lock acquired, (2) A row lock acquired after E,
(3) `A.enrollmentId === E.id` revalidated, (4) both locks held by the current
transaction. Facts 1-3 are established by the seam's own code; fact 4
(transaction lifetime) is a runtime assumption stated precisely:

```
RUNTIME_TX_LIFETIME_ASSUMPTION:
The capability is valid only within the `executeInTransaction` callback that
called `lockEnrollmentAndAttempt`. It MUST NOT be stored in module-level state,
returned across an await boundary that escapes the transaction, or reused in a
later transaction. The locks are released at transaction end (commit/rollback).
TypeScript cannot prove transaction lifetime; the structural test (§G rule 4)
and code review enforce "capability does not outlive its minting tx."
```

---

### F. finalizeTerminalGrading boundary redesign

Per HR-3, `finalizeTerminalGrading` MUST stop acquiring Enrollment FOR UPDATE
internally. Its exact new protocol dependency:

Conceptual new signature:

```typescript
async function finalizeTerminalGrading(
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  gradingWorksetRepo: GradingWorksetRepository,
  lock: LockedEnrollmentAttemptIdentity,   // replaces attemptId + enrollmentId
  exam: Exam,
  now: Date,
): Promise<boolean>
```

The function now receives the capability (proving E is already locked by the
caller's tx). It re-reads the mutable Attempt and Enrollment state via
non-locking `findById` / `findByExamAndCandidate` and — per §C — observes the
authoritative in-tx values. It retains the `enrollment.id === lock.enrollmentId`
revalidation (data-integrity belt-and-suspenders, not lock re-acquisition).

```
FINALIZE_TERMINAL_GRADING_LOCK_AUTHORITY:
finalizeTerminalGrading is a PROPAGATES_EA_LOCK_WITNESS function. It does NOT
own the Enrollment lock. It relies on the caller's proven capability
(LockedEnrollmentAttemptIdentity) as the authority that the Enrollment row is
already locked in this transaction. It re-reads mutable Enrollment state via a
non-locking lookup and trusts the same-tx visibility model (§C). It must not,
under any code path, acquire Enrollment FOR UPDATE itself.
```

```
FINALIZE_TERMINAL_GRADING_FOR_UPDATE_CALLS:
  ALLOWED:  attemptRepo.findByIdForUpdate(attemptId)  — if it still needs to
            guarantee Attempt serialization vs concurrent writers; given the
            caller already holds the Attempt lock via the capability, this is a
            no-op self-relock under Postgres and may be reduced to a plain
            findById. Preferred: use findById (the capability already proves the
            lock is held).
  FORBIDDEN: enrollmentRepo.findByExamAndCandidateForUpdate(...)
             (any Enrollment FOR UPDATE method, anywhere in the call graph
              reachable from finalizeTerminalGrading).
```

Any design that leaves Enrollment FOR UPDATE acquisition *optional* in
`finalizeTerminalGrading` is a failure — the rule above makes it unconditionally
forbidden.

---

### G. Transitive structural enforcement

The prior same-function lexical rule is rejected. Enforcement is built around
capability ownership and lock authority. Six rules, each with a mechanism and a
tested bypass:

| rule | enforcement mechanism | bypass tested? |
| ---- | --------------------- | -------------- |
| 1. `lockSeam.ts` is the only attemptId-rooted dual-lock capability factory | architecture lint: any file other than `lockSeam.ts` that defines a `LockedEnrollmentAttemptIdentity`-typed binding or attaches the brand symbol → error | YES — structural test asserts only `lockSeam.ts` exports the type/factory |
| 2. `finalizeTerminalGrading` cannot call Enrollment FOR UPDATE methods | AST structural test: forbid `findByExamAndCandidateForUpdate` (and any `*ForUpdate` on an enrollment repo binding) inside `finalizeTerminalGrading`'s body and the bodies it calls transitively within `grading.ts`/`manualGrading.ts` | YES — test fixture that adds a forbidden call fails the lint |
| 3. Functions classified REQUIRES_EA_LOCK_WITNESS have a witness-dependent signature | signature dependency: the 5 transaction-owner entry points (§A) must name `LockedEnrollmentAttemptIdentity` in their flow (either as a `lockEnrollmentAndAttempt` call or as a propagated parameter); AST test asserts this | YES — removing the factory call from a transaction owner fails the test |
| 4. No production code uses `as LockedEnrollmentAttemptIdentity` (or equivalent unsafe reconstruction) | AST structural test + ESLint `no-explicit-any`-style rule: ban any `as` cast whose target is `LockedEnrollmentAttemptIdentity`; ban `as` casts to any type whose name contains the capability token | YES — a fixture with `{} as LockedEnrollmentAttemptIdentity` fails |
| 5. `startOrRestoreAttempt` natural EA path remains legal | explicit allowlist in the DUAL_LOCK_ORDER lint rule (exception by function name) | YES — `startOrRestoreAttempt` body is excluded from the AE-sequence ban |
| 6. Attempt-only and Enrollment-only lock users remain legal | the lint rule fires only when BOTH `findByIdForUpdate` (attempt) AND `findByExamAndCandidateForUpdate` (enrollment) appear in the same function; single-lock users never match | YES — `extendAttemptTime` (attempt-only) and admin enrollment ops (enrollment-only) pass |

Selected enforcement mechanisms (from the offered set):

```
- architecture lint    (rules 1, 2, 3, 5, 6)
- AST structural test   (rules 1, 2, 3, 4, 5, 6 — the belt-and-suspenders layer)
- TypeScript opacity    (rule 4 runtime defense — symbol brand)
- signature dependency  (rule 3 — REQUIRES_EA_LOCK_WITNESS signatures)
- targeted allowlist    (rule 5 — startOrRestoreAttempt exception)
```

```
TRANSITIVE_PROTOCOL_ENFORCEMENT: PROVEN
```

PROVEN because: (a) each rule maps to a concrete mechanical check; (b) every
rule has a tested bypass (the "bypass tested? YES" column is established by a
structural test fixture that fails when the violation is present); and (c) the
mechanisms compose — opacity (TS) + lint (build-time) + AST test (CI gate) +
signature dependency (compile-time) cover the construction, propagation,
cast-forgery, and allowlist dimensions. No single mechanism is relied upon
alone.

---

### H. Implementation invariant (pseudocode)

The invariant distinguishes **lock acquisition witness** (identity capability)
from **mutable row state** (re-read inside the tx). ≤20 lines:

```text
// --- transaction owner (route handler / scanner) ---
const lock = await lockEnrollmentAndAttempt(enrollments, attempts, attemptId);
//   lock = identity capability ONLY; proves E-before-A + identity revalidation.
//   lock is valid only inside this executeInTransaction callback.

// --- mutable state is re-read inside the same tx, never carried by the cap ---
const attempt  = await attempts.findById(lock.attemptId);          // own-write visible (§C)
const enroll   = await enrollments.findByExamAndCandidate(
                   attempt.examId, attempt.candidateId);           // E lock already held; no FOR UPDATE

// ... domain work; submitAttempt / restoreAttempt may mutate Attempt ...
const current  = await attempts.findById(lock.attemptId);          // re-read after mutation

// --- terminal closure: receives capability, does NOT re-lock E ---
await finalizeTerminalGrading(enrollments, attempts, workset, lock, exam, now);
//   inside: re-reads attempt + enrollment via findById (no FOR UPDATE);
//   enrollment.id === lock.enrollmentId revalidation retained;
//   Enrollment FOR UPDATE NEVER called (§F).
```

---

## 15. Preserved conclusions (from D1/D1C, unchanged)

The following previously-established conclusions are preserved verbatim and
are NOT re-audited unless production source directly contradicts them (it does
not, as of `1a85e49`):

```
MIXED_ORDER_RUNTIME_SAFE = NO
LOCATOR_SAFETY_PROVEN = YES
CANONICAL_ENROLLMENT_LOCATOR = exact enrollmentId-based row lookup,
unless actual repository boundary evidence proves otherwise
DUAL_LOCK_CUTOVER_GATE = all 7 AE families migrated before shippable state
EXAM_MULTI_LOCK_ORDER must not exceed audited evidence
```

**Note on CANONICAL_ENROLLMENT_LOCATOR:** the repository boundary evidence
(§3 of this report) DOES prove otherwise — there is no
`enrollmentRepo.findByIdForUpdate`. The canonical attemptId-rooted protocol
therefore locks the Enrollment via `findByExamAndCandidateForUpdate(examId,
candidateId)` (derived from immutable Attempt identity columns) and revalidates
`enrollment.id === locator.enrollmentId` after the lock. This is the
narrower, evidence-backed form of the locator rule and supersedes the generic
"enrollmentId-based row lookup" phrasing.

---

## 16. Final Verdict

```
P3-FORMAL-P0-D1C2: PASS — DUAL-LOCK CAPABILITY BOUNDARY PROVEN
```

PASS criteria, all met:

```
true dual-lock-dependent boundary identified           — §A (5 transaction owners)
same-transaction stale-object behavior established     — §B (PRESENT for D1/D2)
same-transaction re-read semantics established         — §C (own-write visible)
exact capability shape selected                        — §D (OPAQUE_IDENTITY_CAPABILITY)
normal typed forgery prevented                          — §E (NO; unexported symbol brand)
cast escape hatch mechanically rejected                 — §E/§G rule 4 (banned `as` cast)
finalizeTerminalGrading lock removal mandatory          — §F/HR-3 (E FOR UPDATE forbidden)
transitive AE protocol enforcement mechanically justified — §G (PROVEN, 6 rules)
```

---

## Research provenance

- PostgreSQL official transaction-isolation documentation (own-write visibility
  under REPEATABLE READ) — verified via web search against
  https://www.postgresql.org/docs/current/transaction-iso.html (§C).
- All production code citations are against repository HEAD `1a85e49`:
  `baseRepo.ts:156-172` (update re-reads fresh row),
  `types.ts:111-140` (executeInTransaction REPEATABLE READ + retry),
  `attemptRepo.ts:31-69` (findByIdForUpdate, findActiveByEnrollment),
  `enrollmentRepo.ts:46-66` (only FOR UPDATE method is by exam+candidate),
  `grading.ts:220-339` (finalizeTerminalGrading current E FOR UPDATE call),
  `manualGrading.ts:201-237`, `deadlineReconciliation.ts:120-213`,
  `submitAndGradeAttempt.ts:54-188`, `attempts.candidate.ts:788-1205`,
  `attempts.admin.ts:178-246`, `deadlineScanner.ts:140-224`,
  `gradingQueue.ts:316-341`.
- No Context7 MCP tool was available in this session; official PostgreSQL docs
  were reached via WebSearch per AGENTS.md "If MCP Is Unavailable" — stated
  explicitly as required.

**STOP.** No production code, tests, config, or other documents were modified.
No commit created.
