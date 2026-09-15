# EXAM-558-DEADLINE-AUTHORITY-CODE-REALITY-AUDIT-1

```text
BASE_SHA: e4bb06c89a5a381a62882fc11566e864dc070046 (matches the authoritative base in the task brief)
BRANCH: audit/558-deadline-authority-reality-1 (from master)
WORKTREE: clean except audit artifacts (this report + the audit test file)
ISSUE: #558 — [Hardening][A2-followup] Exam-lock gap in take/submit deadline reads (sibling of #543)

FACT FREEZE (verified):
  BASE_SHA          = e4bb06c89a5a381a62882fc11566e864dc070046  (expected; matches)
  BRANCH            = master → audit/558-deadline-authority-reality-1
  WORKTREE          = clean at audit start
  #558              = OPEN
  #543              = CLOSED
  #542 / #544       = CLOSED (Phase A CLOSED — not reopened)
  PR #557 merge     = ff312ec8 ("Merge pull request #557 from jnhu76/hardening/543-answer-save-deadline-race-1")

VERDICT:
  BUG_CONFIRMED_PARTIAL  (structural) + ISSUE_SCOPE_INCOMPLETE (reachability & scope)

  - STRUCTURAL (confirmed, deterministic, R1s/R2s): `ensureAttemptDeadlineReconciled`
    reads Exam with a plain MVCC read and take/submit have NO serialization point
    against concurrent closeAt writers. When a candidate's arrival authority was
    already superseded by a committed closeAt change, the stale freeze commits
    durably (R1s: submittedAt = pre-extension closeAt, submissionReason = deadline,
    while the extension had already committed). #543's save seam closes this exact
    schedule via Exam FOR UPDATE + 40001 whole-tx retry (P1 proves the mechanism;
    the #543 suite passes 6/6 on current master).
  - REACHABILITY (falsifies the issue's headline scenario): the stale-freeze
    schedule is NOT producible through the real production surfaces today:
      * The only live-exam closeAt writer is POST /exams/:id/extend
        (executeAdminExamTransition), which reconciles status FIRST and refuses
        (EXAM_EXTEND_NOT_ALLOWED / ALREADY_CLOSED) once closeAt has passed.
      * A candidate freeze requires entry-now >= closeAt; the candidate `now` is
        sampled at request arrival (attempts.candidate.ts: submit route `const now
        = fastify.now()` threaded into submitAndGradeAttempt; take route passes
        fastify.now() into the reconciliation), and the tx snapshot is fixed
        milliseconds later at the EA locator read. A stale-freeze schedule needs
        C(writer commit) < F(old closeAt) <= E(entry) — but E < S(snapshot) < C is
        forced by the code structure, a contradiction.
      * Empirically: R1/R2 (real take/submit route + real extend route committing
        mid-flight, candidate released after the wall clock passed the old closeAt)
        show NO stale freeze — take stays in_progress; submit is accepted as a
        manual submit under request-arrival semantics. The freeze could only be
        staged by injecting `now` (R1s/R2s), i.e. by a writer/geometry that does
        not exist on the live API today.
  - ISSUE_SCOPE_INCOMPLETE:
      * #558's "second plain exam read" in submit (`minSubmitAfterStartMinutes`,
        submitAndGradeAttempt.ts:188) is the SAME RR snapshot as the
        reconciliation (same tx), and the field is immutable for open exams
        (PATCH allows only openAt/closeAt for published; open is rejected) —
        SAFE_BY_IMMUTABILITY + redundant-read smell, not a second authority class.
      * T-B (take post-tx mixed-version snapshot) is REAL and proven (R1c): the
        response's effectiveDeadline is projected from the post-tx exam read
        while the attempt was reconciled under the pre-extension authority —
        display-benign in the only reachable direction (extension moves the
        deadline later); no irreversible decision derives from it.
      * The start path (POST /attempts/:examId/start) also makes
        deadline-dependent decisions (window guard, timed_sync deadlineAt = min(T0
        + duration, closeAt) PERSISTED at creation, minSubmitAfterStartMinutes
        feasibility) from a plain exam read under READ COMMITTED with no Exam
        lock — reachable-schedule analysis says valid-linearization today (the
        live writer only loosens the window), but it is the same structural class
        and is NOT in #558's list.

A. AUTHORITY OWNERS
   deadline computation:  computeEffectiveDeadline / isAttemptDeadlineExpired /
                          computeSyncDeadline (packages/exam-engine/src/timer.ts) — single canonical authority.
   reconciliation:        ensureAttemptDeadlineReconciled
                          (packages/exam-engine/src/deadlineReconciliation.ts) — the ONLY freeze entrypoint;
                          prepareReconciledAttemptMutation composes it for save.
                          The scanner does NOT call it; it re-checks
                          isAttemptDeadlineExpired inline under locks
                          (deadlineScanner.ts autoSubmitAndGrade).
   serialization:         DISTRIBUTED AMONG CALLERS today:
                          - save (#543): Exam FOR UPDATE AFTER reconcile, inside
                            prepareReconciledAttemptMutation (40001 + whole-tx retry).
                          - restore, operatorGrant: Exam FOR UPDATE BEFORE reconcile (caller-owned).
                          - scanner: Exam FOR UPDATE BEFORE the canonical recheck (caller-owned).
                          - take, submit: NO Exam serialization point at all.
                          If serialization ownership is distributed — yes, explicitly: three
                          different placements (before / after / absent).

B. CLOSEAT WRITERS (production, exhaustive)
   writer 1: POST /exams/:id/extend (Admin) → executeAdminExamTransition:
             Exam FOR UPDATE → reconcileExamForMutation (lazy open→closed) →
             guard status === "open" → extendExam(engine): positive-int only,
             newCloseAt = oldCloseAt + minutes (LATER only). Reachable for LIVE
             exams; direction = LATER only; refuses once closeAt has passed.
   writer 2: PATCH /exams/:id (Admin/Teacher): Exam FOR UPDATE → reconcile →
             guard: draft = full edit (closeAt any direction), published =
             schedule-only {openAt, closeAt} (any direction; clearing closeAt
             only for untimed); OPEN exams → ExamUpdateNotAllowedError.
             REACHABLE only for draft/published — an exam with attempts is
             effectively always open (the start route reconciles published→open
             first), so PATCH cannot race live attempt deadline decisions.
   writer 3: exam create (initial value; not a mutation of a live exam).
   live-exam reachable direction: LATER only, via extendExam, positive-only.
   "shorten closeAt of a live exam" is UNREACHABLE_WITH_CURRENT_API.

C. PRODUCTION CALLSITE MATRIX (ensureAttemptDeadlineReconciled — all callers)
   save:   prepareReconciledAttemptMutation — reconcile (plain exam read) THEN
           Exam FOR UPDATE → later lock + 40001 whole-tx retry aborts any stale
           reconciliation → SAFE_TRANSITIVELY (proven: #543 suite H1/H2, P1).
   take:   attempts.candidate.ts GET .../take — EA lock, plain exam read inside
           reconciliation, NO Exam lock, post-tx plain exam read for the
           snapshot → UNSAFE structurally (R1s) / not reachable via live API
           (R1) / T-B projection mixing proven benign (R1c).
   submit: submitAndGradeAttempt — EA lock, plain exam read inside
           reconciliation, second plain exam read (minSubmitAfterStartMinutes,
           same snapshot, immutable field), no Exam lock → same classification
           (R2s structural / R2 reality).
   restore: restoreInterruptedAttempt — Attempt FOR UPDATE then Exam FOR UPDATE
           BEFORE reconcile → SAFE_DIRECTLY.
   operatorGrant: grantAttemptTime — Attempt FOR UPDATE then Exam FOR UPDATE
           BEFORE reconcile → SAFE_DIRECTLY.
   other:  scanner autoSubmitAndGrade — does NOT call the seam; EA lock + Exam
           FOR UPDATE + inline canonical recheck → SAFE_DIRECTLY.
           markDisrupted / manualGrading / misconduct / forceSubmit: no
           deadline-Exam read (force-submit bypasses deadline by definition).

D. #543 TRANSITIVE SAFETY
   stale reconciliation before later Exam lock: REVERTED BY RETRY. Under RR, a
     closeAt change committed after T1's snapshot makes T1's subsequent
     SELECT...FOR UPDATE on the exam row raise 40001 (P1, live probe);
     executeInTransaction (packages/db/src/types.ts:161) retries the WHOLE
     callback (40001/40P01, MAX_RETRIES=3, 20/40/80ms backoff) on a fresh
     snapshot; the retry re-runs reconciliation against the new authority.
     PostgreSQL aborts the entire transaction on the serialization failure, so
     the stale freeze (submitAttempt + workset + grading writes) never becomes
     durable.
   whole-tx rollback proof: P1 (this audit) + candidate-save-deadline-race
     suite H1/H2 (6/6 passing on current master e4bb06c8).
   save status: SAFE_TRANSITIVELY. The #543 fix is NOT save-specific: it makes
     the save path's deadline decision writer-agnostic. The same discipline is
     absent from take/submit.

E. TAKE FINDINGS
   reconciliation race: structurally present (plain exam read, no serialization
     point; R1s stages a durable stale freeze) — but not producible via the
     real routes today (R1: arrival-pinned `now` + extend's closed-guard).
   post-tx snapshot race (T-B): REAL (R1c) — response projects the post-tx exam
     generation; attempt reconciled under the pre-extension generation. In the
     only reachable direction (extension = later), the mixed snapshot is
     display-benign: no irreversible decision consumes it; the attempt state in
     the same response is authoritative.
   severity: LOW as a live bug; MEDIUM as a structural/writer-agnosticism gap
     (identical in kind to what #543 closed for save).

F. SUBMIT FINDINGS
   reconciliation race: same as take (R2s structural, R2 unreachable-via-API).
   second plain Exam read (minSubmitAfterStartMinutes,
     submitAndGradeAttempt.ts:188): (1) NOT merely redundant in position — it
     executes AFTER reconciliation — but it reads the SAME tx snapshot, so it
     cannot disagree with the freeze decision's generation; (2) no semantic
     inconsistency reachable; (3) minSubmitAfterStartMinutes is IMMUTABLE for
     open exams (PATCH published allows only openAt/closeAt; open rejected) →
     SAFE_BY_IMMUTABILITY; (4) architectural smell only (a second authority-
     shaped read where the frozen field would justify none); (5) if #558 is
     implemented, folding it into the seam's locked read (or hoisting the
     locked exam) is a legitimate one-authority cleanup, not a separate fix.
   minSubmitAfterStartMinutes mutability: immutable post-publish (route guard);
     mutable in draft only (no attempts exist).
   severity: LOW.

G. LOCK GRAPH (current, production)
   current:
     Enrollment → Attempt                    (lockEnrollmentAndAttempt, lockEnrollmentAndActiveAttempt)
     Attempt → Exam                          (save seam prepareReconciledAttemptMutation; restore;
                                              operatorGrant; scanner autoSubmitAndGrade)
     Enrollment → Attempt → Exam → Enrollment(re-lock, same tx)
                                              (scanner + save + finalize paths — the trailing
                                              Enrollment FOR UPDATE re-locks a lock the tx
                                              already holds; no new edge)
     Episode rows: findByAttemptForUpdate — strictly AFTER Attempt (leaf under Attempt)
     Exam-only paths: executeAdminExamTransition (extend/close/cancel/archive),
                      PATCH, publishResults, delete(draft), reconcileExamForRead
     Enrollment-only: enrollment remove (assigned-only)
     Attempt-only: markDisrupted, manualGrading, misconduct, forceSubmit
   Exam→Attempt edge found: NO. Exam→Enrollment: NO. Attempt→Enrollment: NO.
     (cancel's unresolved-attempt check is a plain COUNT read, not a lock.)
   proposed: take/submit add the existing Attempt → Exam edge (same as
     save/restore/operatorGrant/scanner). No cycle possible: no path acquires
     Exam before Attempt/Enrollment.
   CYCLE_FOUND: NO.
   FK incidental edges (measured, R1s instrumentation): a candidate tx that
     freezes inserts FK-referencing rows and thereby HOLDS FOR KEY SHARE on the
     exam parent; a concurrent SELECT ... FOR UPDATE on exams (the #543
     serialization shape) then QUEUES behind the candidate tx (observed lock
     chain: writer's exams FOR UPDATE blocked on candidate tx's transactionid).
     This is not authority (no 40001 for the candidate; the candidate commits
     and the writer applies afterwards — candidate-wins), and it cannot invert
     the lock order (same Attempt→Exam direction), but it can stall exam
     writers for the duration of a long candidate tx.

H. DETERMINISTIC REPRO (apps/api/src/routes/attempts/exam-558-deadline-authority.audit.concurrency.test.ts — audit branch; 10/10 green, run twice; PostgreSQL 18.4 via repo test-isolation)
   R1 take extend-wins (REAL routes): take parked at the enrollment barrier
     (snapshot fixed, arrival-now pinned), real extend commits +30min, release
     after wall clock passes old closeAt → NO stale freeze; attempt stays
     in_progress; response projects the EXTENDED deadline. Documents the
     arrival-semantics + guard reality.
   R2 submit extend-wins (REAL routes): same schedule through the real submit
     route → manual submit accepted (submittedAt = arrival sample < old
     closeAt, submissionReason = manual), extension applied. Candidate-wins
     linearization; no stale freeze.
   R1c take mixed-version snapshot: real take parked while extension commits →
     attempt reconciled under old authority, response effectiveDeadline =
     extended authority (deadline-mode exam, effectiveDeadline === closeAt).
     T-B PROVEN, display-benign.
   R3 take-wins / R4 submit-wins: candidate decision commits, extension applies
     after; both succeed; no deadlock; extend does NOT queue behind the
     candidate tx (no Exam serialization point exists on take/submit).
   R1s staged take (injected now — the #543 H2 pattern; writer = canonical
     closeAt update on a dedicated connection, plain UPDATE because a writer's
     FOR UPDATE queues behind the freeze's incidental FK KEY SHARE): the stale
     freeze COMMITS DURABLY (submittedAt = old closeAt, reason = deadline)
     although the closeAt change committed before the take tx ended →
     BUG_CONFIRMED at composition level; contrast P1/#543: the save seam
     converts this exact schedule into 40001 + retry.
   R2s staged submit: the REAL submitAndGradeAttempt orchestrator (injected
     now), parked at the EA seam → same durable stale freeze → the structural
     gap is in the shared seam, not the route.
   No sleeps gate any outcome; interleavings are forced by deferred barriers
   and a pg_locks liveness predicate (hard timeout, loud failure on miss).

I. ROOT CAUSE
   `ensureAttemptDeadlineReconciled`'s contract treats the Exam read as a plain
   lookup and delegates serialization to callers. Three callers took on that
   duty (restore, operatorGrant, scanner) and #543 added it to the save seam —
   but take and submit never acquired it. The reconciliation seam is therefore
   not writer-agnostic: whether a deadline decision serializes against Exam
   writers depends on which of five call sites is entered. The save fix
   demonstrates the intended discipline (Attempt → Exam FOR UPDATE under
   executeInTransaction retry); take/submit predate it and were not migrated.

J. REPAIR DESIGN COMPARISON
   A caller-owned (take/submit each: EA lock → Exam FOR UPDATE → reconcile):
     + mirrors restore/operatorGrant (existing precedent); no engine contract change.
     − duplicates the discipline at every entrypoint; correctness depends on
       each future caller remembering it (exactly the failure class #558 is);
       lock provenance stays distributed (3 different placements today).
   B reconciliation-owned (the seam's contract REQUIRES the authoritative Exam
     lock: ensureAttemptDeadlineReconciled takes the exam row via
     findByIdForUpdate instead of plain findById, before any decision):
     + ONE canonical enforcement point; future entrypoints inherit the
       discipline mechanically; no second entrypoint.
     + smallest semantic change: same repo, same call position, interface
       already declares findByIdForUpdate (examCommands.ts:51); in-memory fakes
       already implement it (attemptMutation.testHelpers.ts:262).
     + double-lock callers are safe: restore/operatorGrant/scanner re-lock a
       row their tx already holds (Postgres no-op); save's later
       findByIdForUpdate becomes an equally-safe re-lock; their explicit
       pre-locks can be cleaned up separately (out of #558 scope).
     − "hidden lock acquisition" inside a reconcile function must be
       documented at the seam (INVARIANT comment) and covered by the R1s/R2s
       schedules as regression tests (they flip to expect 40001-retry, i.e.
       NO durable stale freeze — the #543 H2 oracle).
   C narrow locked-reconciliation composition seam (a lock+reconcile helper):
     + avoids touching ensureAttemptDeadlineReconciled's contract.
     − creates a second reconciliation entrypoint parallel to the canonical
       seam (two ways to reconcile — violates single-authority unless the old
       path is reserved), or degenerates into A-with-extra-naming.

RECOMMENDED_DESIGN: B — reconciliation seam owns the Exam lock.
   Reasons: minimal semantic authority (one decision + its serialization in one
   function), smallest change surface (one read swapped for its locked sibling
   plus comment/tests), mechanical lock-order safety (EA capability is already
   asserted at seam entry; Enrollment → Attempt → Exam holds by construction),
   no duplicated protocol (unlike A/C), lowest future regression risk.

K. DOC DRIFT (active docs, current master)
   docs/architecture/exam-system/data-authority.md
     §9.2 transaction inventory: Save row omits the #543 Exam FOR UPDATE inside
       prepareReconciledAttemptMutation; "Deadline reconciliation — EA lock →
       ensureAttemptDeadlineReconciled — Atomic" describes take/submit
       composition without noting the missing Exam serialization → INCOMPLETE.
     §9.3 "Enrollment → Attempt → Exam — all code paths MUST": order correct;
       does not say which callers actually reach the Exam node (take/submit do
       not) → INCOMPLETE.
   docs/architecture/exam-system/domain-model.md
     §6.3 "closeAt — Only via extendExam() in open state" → FALSE_ON_CURRENT_MASTER
       (PATCH writes closeAt in draft/published; draft any direction).
       Same row family: "openAt — only in published (route guard)" misses draft.
     §8.7 "No background worker, no scheduled scan" → FALSE_ON_CURRENT_MASTER
       (apps/api/src/plugins/deadlineScanner.ts; system actor DeadlineScanner).
   docs/architecture/exam-system/protocol-catalog.md
     "Deadline Reconciliation" entry: Actor = candidate entry points only —
       misses the scanner actor → INCOMPLETE; "Audit event:
       attempt.deadline_reconciled (atomic)" — no such audit action exists in
       production code → FALSE.
     "Exam Extend" entry → CORRECT (guard and shape match code).
   docs/architecture/exam-system/diagrams.md
     §5.2 Save Answer sequence stops at prepareReconciledAttemptMutation →
       saveAnswer; does not render the #543 Exam FOR UPDATE → INCOMPLETE.
   docs/architecture/exam-runtime.md
     §5.1 "exam.closeAt（schema notNull、domain Date）恒为权威上界" →
       FALSE_ON_CURRENT_MASTER (#291 Phase A: closeAt nullable for untimed;
       domain Date | null; nullable computeEffectiveDeadline overload).
     §5.1 ACTIVE-DEADLINE-001 frames NULL deadlineAt as "schema-admissible but
       protocol-unreachable" — stale after #291 Phase A: `deadline`-mode
       attempts carry NULL deadlineAt as the NORMAL protocol state → STALE.
   (No active doc was edited in this audit.)

FRESH REVIEW: see §L below (independent reviewer, no prior transcript).

AUDIT ARTIFACTS (audit branch only; not for merge as-is):
   apps/api/src/routes/attempts/exam-558-deadline-authority.audit.concurrency.test.ts
     — 10 deterministic probes: P1 (RR 40001 + whole-tx retry onto new
     authority), P2 (plain read stays stale), P3 (FK parent check does NOT
     serialize), R1/R2 (real-route reality: arrival-pinned decisions),
     R1c (T-B mixed-version projection), R3/R4 (candidate-wins linearizations,
     no deadlock), R1s/R2s (staged structural gap: durable stale freeze — these
     become the post-fix regression oracle under Design B).
   Post-fix expectation for R1s/R2s: both flip to the #543-H2 oracle (freeze
   attempt loses via 40001, retry freezes under the NEW authority or not at
   all); R1/R2/R1c/R3/R4/P1-P3 keep passing unchanged.

READY_FOR_HUMAN_REVIEW_BEFORE_FIX
```

## §L. FRESH REVIEW (independent adversarial pass)

Recorded verbatim from the fresh-context reviewer; dispositions inline.

(Place for reviewer output — filled in the final version below.)
