# P3-FORMAL-P0-D: Enrollment ↔ Attempt Lock-Order Cycle Reachability

**Audit date:** 2026-07-08
**HEAD:** `1a85e49`
**Auditor:** Agent (P3-FORMAL-P0-D assessment)

---

## Summary

The lock-order cycle between `exam_enrollments` and `exam_attempts` identified in phase 1 is **reachable in production** under concurrent independent transactions. This audit supersedes the earlier static-only analysis and provides definitive PostgreSQL concurrency evidence.

**Verdict: REACHABLE DEADLOCK SCHEDULE — PROVEN**

---

## 1. Static Cycle (Background)

Two transaction families acquire the same two rows in opposite order:

| Path | First lock | Second lock | Source |
|------|-----------|-------------|--------|
| **EA** (Enrollment→Attempt) | `exam_enrollments ... FOR UPDATE` (by `findByExamAndCandidateForUpdate`) | `exam_attempts ... FOR UPDATE` (by `findActiveByEnrollment`) | `startOrRestoreAttempt` |
| **AE** (Attempt→Enrollment) | `exam_attempts ... FOR UPDATE` (by `findByIdForUpdate`) | `exam_enrollments ... FOR UPDATE` (by `findByIdForUpdate`) | `finalizeTerminalGrading` (submit, force-submit, auto-submit, manual-grade, reconciliation) |

Each path requires row identity to match: the **same** enrollment `E` and the **same** in-progress attempt `A`.

---

## 2. Reachability Proof

### 2.1 Row Identity Precondition Satisfiable

A candidate has exactly **one** in-progress attempt per exam. The enrollment `E` and its active attempt `A` share `A.enrollment_id = E.id`. Therefore:

- **EA path:** `startOrRestoreAttempt` locks `E` by `(examId, candidateId)`, then locks `A` by `A.enrollment_id = E.id`.
- **AE path:** `finalizeTerminalGrading` locks `A` by `attemptId`, then locks `E` by `E.id = A.enrollment_id`.

**Result:** When two concurrent transactions hit rows `(E, A)` that satisfy `E.id = A.enrollment_id`, the lock-order cycle is formed. This is the **normal, common case** — every submit/force-submit/auto-submit on the active attempt uses exactly these rows.

### 2.2 Protocol Guard Compatibility

Both paths have status-based guards that must pass before acquiring the second lock:

| Path | Guard on first-lock row | Criteria |
|------|------------------------|----------|
| EA | `E.status = 'in_progress'` | Enrollment must be in_progress to start an attempt |
| AE | `A.status = 'in_progress'` | Only in_progress attempts can be submitted |

Both guards are **compatible**: a candidate whose enrollment is `in_progress` and attempt is `in_progress` satisfies both. This is the steady state during an active exam session.

### 2.3 REPEATABLE READ Semantics

The system uses `REPEATABLE READ` isolation. PostgreSQL implements `FOR UPDATE` locks under REPEATABLE READ with:

- **First locker succeeds** — the lock wait is granted if the row is not already locked.
- **Second locker blocks** — the second `FOR UPDATE` must wait for the first transaction to release its lock.
- **Deadlock detection** — PostgreSQL's `deadlock_timeout` (default 1s) fires, the detector chooses the **victim** (the AE transaction in this test), and aborts it with SQLSTATE `40P01`.

### 2.4 Reproducer Evidence

A controlled concurrent reproducer was created and executed against `exam_test`:

```
Tx EA (Enrollment→Attempt):
  1. BEGIN REPEATABLE READ
  2. SELECT ... FROM exam_enrollments WHERE id=E FOR UPDATE   ← acquires lock E
  3. [wait for barrier 1]
  4. SELECT ... FROM exam_attempts WHERE enrollment_id=E FOR UPDATE  ← blocks on A

Tx AE (Attempt→Enrollment):
  1. BEGIN REPEATABLE READ
  2. SELECT ... FROM exam_attempts WHERE id=A FOR UPDATE     ← acquires lock A
  3. [wait for barrier 1]
  4. SELECT ... FROM exam_enrollments WHERE id=E FOR UPDATE  ← blocked by Tx EA's lock E

  → PostgreSQL deadlock detector fires (deadlock_timeout ~1s)
  → Tx AE chosen as victim, SQLSTATE 40P01
  → Tx EA proceeds, lock A is granted
```

**Outcome:**
- `eaStatus: fulfilled` — Tx EA (the natural candidate submit path) completed successfully
- `aeStatus: rejected` — Tx AE (the grading finalization path) was aborted
- `sqlstate: 40P01`, `causeCode: 40P01`

---

## 3. Production Impact Assessment

### 3.1 Is the Schedule Actually Reachable?

**Yes.** Two concurrent requests that interact with the same `(Enrollment E, Attempt A)` pair can produce the exact interleaving:

1. **Request A** (e.g., candidate save-answer heartbeat) runs `startOrRestoreAttempt` and has locked `E` but not yet `A`.
2. **Request B** (e.g., admin force-submit, or deadline auto-submit) runs `finalizeTerminalGrading`, locks `A`, then attempts to lock `E`.

This is not a theoretical cycle — it is the natural result of two concurrent operations touching the same enrollment+attempt.

### 3.2 Blameless Victim: AE Path

In the reproducer, the AE path (Attempt→Enrollment) was the deadlock victim. This means:

- `finalizeTerminalGrading` is the path that gets the 40P01 error.
- The EA path (candidate operations via `startOrRestoreAttempt`) succeeds.

In production, PostgreSQL may choose either transaction as the victim depending on timing. The AE path is more likely to be the victim because it holds fewer locks (one row vs. one row), though this is an implementation detail.

### 3.3 Existing Mitigations

1. **Three retries** — `executeInTransaction` retries up to 3 times on 40P01/40001.
2. **REPEATABLE READ** — prevents phantom reads but does not prevent deadlocks (as proven).
3. **Short lock windows** — FOR UPDATE locks are held only within transaction boundaries.

### 3.4 Remaining Concern

With 3 retries, a transient 40P01 is **recoverable**: AE transaction aborts, EA transaction completes, AE retries after EA completes, both succeed. However:

- **Deadlock_timeout is ~1s** — each deadlock detection pause adds ~1s+ of latency to the AE path.
- **3 retries × 1s = 3+ seconds** of tail latency for force-submit/auto-submit/manual-grade.
- Under **high concurrency** (many concurrent submits on same exam), retries may compound.
- The `cannot be serialized` 40001 error under REPEATABLE READ can also fire if a concurrent UPDATE modifies the enrollment row between repeatable read snapshots; this is a separate class from the deadlock but hits the same retry path.

---

## 4. Conclusion

| Element | Finding |
|---------|---------|
| Static cycle exists | PROVEN (phase 1) |
| Row identity matchable | YES — same enrollment E, same active attempt A |
| Protocol guards compatible | YES — E.status=in_progress, A.status=in_progress |
| REPEATABLE READ visibility | Compatible — snapshot does not prevent FOR UPDATE blocking |
| Deadlock reproducible | YES — 40P01 confirmed in `exam_test` with independent connections |
| Production reachable | YES — any concurrent submit/save/auto-submit/force-submit pair |

**Verdict: REACHABLE DEADLOCK SCHEDULE — PROVEN**

### Recommended Action

This is NOT a Phase 1 blocker (the 3-retry mechanism makes it recoverable), but it should be tracked for Phase 2 resolution:

- **Short-term:** Document that `finalizeTerminalGrading` may experience 40P01 under concurrent load; accept the 1-3s retry latency.
- **Medium-term (Phase 2):** Apply lock ordering — acquire `exam_enrollments` first in ALL transaction paths, before `exam_attempts`. This eliminates the cycle at the source.
- **Long-term:** Consider advisory locks or a dedicated lock manager if concurrency grows beyond the retry tolerance.
