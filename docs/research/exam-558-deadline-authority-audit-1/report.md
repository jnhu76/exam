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
  BUG_CONFIRMED_PARTIAL (structural) + ISSUE_SCOPE_INCOMPLETE

  STRUCTURAL (confirmed, deterministic — R1s/R2s): take/submit have NO designed
  Exam serialization point. `ensureAttemptDeadlineReconciled` reads Exam with a
  plain MVCC read; when a candidate's authority is superseded by a committed
  closeAt change that lands AFTER the freeze path's last exam-touching
  statement, the stale freeze commits durably (R1s: submittedAt =
  pre-extension closeAt, submissionReason = deadline, through the take
  composition; R2s: same through the REAL submitAndGradeAttempt orchestrator).

  MEASURED REACHABILITY (corrects the issue's premise AND this audit's first
  draft): through the REAL take/submit routes racing a REAL extend, the stale
  freeze did NOT become durable in any run — but not for the reason first
  assumed. Server-log-proven mechanism (R1v): the stale pass freezes
  (submitAttempt succeeds), then the finalize UPDATE re-runs the exams FK RI
  check (`SELECT 1 FROM exams ... FOR KEY SHARE`), which raises 40001
  (serialization_failure) because the parent row was concurrently updated +
  committed after the take tx's snapshot; executeInTransaction rolls back the
  whole pass and retries; pass 2 sees the extended closeAt and does not
  freeze. This protection is INCIDENTAL — the #543 audit comment explicitly
  warns "an incidental FK parent check ... is NOT load-bearing and must not
  be treated as a substitute serialization point" — and it is
  ORDERING-DEPENDENT: it fires only while a freeze-path child write executes
  after the writer's commit. R1s demonstrates the durable stale freeze the
  moment the writer commits in the window between the freeze's last
  exam-touching statement and the take commit (production equivalents:
  writer-tx delay, commit latency, or a pending_manual freeze path that skips
  the finalize write). take/submit `now` sampling: take samples fastify.now()
  INSIDE the tx (attempts.candidate.ts:897, after the EA seam — so a writer
  committing between the snapshot and the now-sample is seen as stale by a
  pass that survives the RI abort only if its exam read preceded the commit);
  submit samples now at route entry (attempts.candidate.ts:1146) before the
  orchestrator. Neither path owns a serialization point; correctness on the
  live surface currently rests on an undesigned, unowned, fragile RI
  interaction plus the extend command's closed-guard.

  ISSUE_SCOPE_INCOMPLETE:
    - submit's second plain exam read (minSubmitAfterStartMinutes,
      submitAndGradeAttempt.ts:188) reads the SAME RR snapshot as the
      reconciliation, and the field is immutable for open exams (PATCH allows
      only openAt/closeAt for published; open is rejected) —
      SAFE_BY_IMMUTABILITY + redundant-read smell, not a second authority
      class.
    - T-B (take post-tx mixed-version snapshot) is REAL and proven (R1c): the
      response's effectiveDeadline projects the post-tx exam generation while
      the attempt was reconciled under the pre-extension generation —
      display-benign in the only reachable writer direction (extension =
      later); no irreversible decision consumes it.
    - The start path (POST /attempts/:examId/start → startOrRestoreAttempt)
      makes deadline-dependent decisions (window guard, timed_sync deadlineAt
      = min(T0+duration, closeAt) PERSISTED at creation, minSubmit
      feasibility) from a plain exam read under READ COMMITTED with no Exam
      lock — valid-linearization today (the live writer only loosens the
      window), same structural class, not in #558's list.
    - The restore seam has TWO production entries with DIFFERENT isolation:
      RR via POST /attempts/:id/restore (attempts.candidate.ts:1272) and READ
      COMMITTED via the start path (attempts.candidate.ts:728 →
      attemptCommands.ts:249) — the safety mechanism differs (40001-retry vs
      read-latest-under-lock); both safe today.

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
                            prepareReconciledAttemptMutation (40001 + whole-tx retry) — DESIGNED.
                          - restore, operatorGrant: Exam FOR UPDATE BEFORE reconcile (caller-owned, DESIGNED).
                          - scanner: Exam FOR UPDATE BEFORE the canonical recheck (caller-owned, DESIGNED).
                          - take, submit: NO designed Exam serialization point. The only abort
                            mechanism is the INCIDENTAL exams-FK RI check inside the freeze's
                            child writes (measured, R1v) — ordering-dependent, unowned, and
                            explicitly disclaimed as non-authority by the #543 doctrine.

B. CLOSEAT WRITERS (production, exhaustive)
   writer 1: POST /exams/:id/extend (Admin) → executeAdminExamTransition:
             Exam FOR UPDATE → reconcileExamForMutation (lazy open→closed) →
             guard status === "open" → extendExam(engine): positive-int only,
             newCloseAt = oldCloseAt + minutes (LATER only). Reachable for LIVE
             exams; refuses once closeAt has passed (ALREADY_CLOSED).
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
           reconciliation → SAFE_TRANSITIVELY, DESIGNED (#543 suite 6/6 on
           current master; P1).
   take:   attempts.candidate.ts GET .../take — EA lock, plain exam read inside
           reconciliation, NO designed Exam lock; measured: the stale pass is
           aborted by the INCIDENTAL exams-FK RI-check 40001 (R1v) — protected
           by accident, ordering-dependent (R1s = the durable counter-example).
   submit: submitAndGradeAttempt — EA lock, plain exam read inside
           reconciliation, second plain exam read (minSubmitAfterStartMinutes,
           same snapshot, immutable field), no designed Exam lock → same
           classification (R2s = durable under flipped ordering; R2 = RI-abort).
   restore: restoreInterruptedAttempt — Attempt FOR UPDATE then Exam FOR UPDATE
           BEFORE reconcile → SAFE_DIRECTLY (DESIGNED). Two entries: RR
           (restore route) and RC (start path).
   operatorGrant: grantAttemptTime — Attempt FOR UPDATE then Exam FOR UPDATE
           BEFORE reconcile → SAFE_DIRECTLY (DESIGNED).
   other:  scanner autoSubmitAndGrade — does NOT call the seam; EA lock + Exam
           FOR UPDATE + inline canonical recheck → SAFE_DIRECTLY (DESIGNED).
           markDisrupted / manualGrading / misconduct / forceSubmit: no
           deadline-Exam read (force-submit bypasses deadline by definition).

D. #543 TRANSITIVE SAFETY
   stale reconciliation before later Exam lock: REVERTED BY RETRY. Under RR, a
     closeAt change committed after T1's snapshot makes T1's subsequent
     SELECT...FOR UPDATE on the exam row raise 40001 (P1, live probe);
     executeInTransaction (packages/db/src/types.ts:161) retries the WHOLE
     callback (40001/40P01, MAX_RETRIES=3, 20/40/80ms backoff) on a fresh
     snapshot; PostgreSQL aborts the entire transaction on the serialization
     failure, so the stale freeze never becomes durable.
   whole-tx rollback proof: P1 (this audit) + candidate-save-deadline-race
     suite H1/H2 (6/6 passing on current master e4bb06c8).
   save status: SAFE_TRANSITIVELY. The #543 fix makes the save path's deadline
     decision writer-agnostic. The same DESIGNED discipline is absent from
     take/submit (whose only abort path is the incidental RI interaction).

E. TAKE FINDINGS
   reconciliation race: structurally present (plain exam read, no designed
     serialization point). Measured on the real route: the stale pass freezes
     but is aborted by the incidental exams-FK RI-check 40001 (R1v) → retry
     converges (R1, 3x re-run, stable). The abort is ordering-dependent: a
     writer commit landing after the freeze's last exam-touching statement
     yields a DURABLE stale freeze (R1s).
   post-tx snapshot race (T-B): REAL (R1c) — response projects the post-tx exam
     generation; attempt reconciled under the pre-extension generation. In the
     only reachable writer direction (extension = later), the mixed snapshot is
     display-benign: no irreversible decision consumes it.
   severity: LOW as an observed live failure; MEDIUM-HIGH as an undesigned,
     unowned safety property (the exact class the #543 doctrine warns about),
     plus the durable stale-freeze window (R1s) whose production trigger is
     writer-tx/commit delay inside the take tx's freeze-to-commit span.

F. SUBMIT FINDINGS
   reconciliation race: same structure as take (R2s = durable under flipped
     ordering; R2 = RI-abort + manual submit under arrival semantics).
   second plain Exam read (minSubmitAfterStartMinutes,
     submitAndGradeAttempt.ts:188): same RR snapshot as the reconciliation;
     field immutable for open exams → SAFE_BY_IMMUTABILITY + redundant-read
     smell. If #558 lands, folding it into the seam's locked read is a
     legitimate one-authority cleanup.
   minSubmitAfterStartMinutes mutability: immutable post-publish (route guard);
     mutable in draft only (no attempts exist).
   severity: LOW.

G. LOCK GRAPH (current, production)
   current:
     Enrollment → Attempt                    (lockEnrollmentAndAttempt, lockEnrollmentAndActiveAttempt)
     Attempt → Exam                          (save seam prepareReconciledAttemptMutation AFTER reconcile;
                                              restore, operatorGrant BEFORE reconcile; scanner)
     Enrollment → Attempt → Exam → Enrollment(re-lock, same tx) — the trailing
                                              Enrollment FOR UPDATE re-locks a lock the tx
                                              already holds; no new edge
     Episode rows: findByAttemptForUpdate — strictly AFTER Attempt (leaf)
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
   FK incidental edges (measured, R1s instrumentation + server log):
     (a) a candidate tx that freezes holds FOR KEY SHARE on the exam parent
         (from FK checks), which STALLS a concurrent exams SELECT...FOR UPDATE
         (writer queues behind the candidate tx) — never the reverse order;
     (b) the freeze's child-write RI check raises 40001 when the parent was
         concurrently updated+committed after the child tx's snapshot — this is
         the accidental abort that protected R1/R2. Both directions are
         non-authority: (a) is a stall, (b) is ordering-dependent and unowned.

H. DETERMINISTIC REPRO (apps/api/src/routes/attempts/exam-558-deadline-authority.audit.concurrency.test.ts — audit branch; 11/11 green, real PostgreSQL 18.4 via repo test-isolation)
   P1  RR: exams SELECT..FOR UPDATE after a concurrent closeAt commit → 40001;
       whole-callback retry lands on the new authority.
   P2  RR: plain exam read stays stale after a concurrent commit (no error).
   P3  FK parent check (INSERT referencing the exam) after a concurrent
       closeAt commit does NOT raise 40001 — FK locking is not authority.
   R1  REAL take route + REAL extend route (candidate parked past the old
       closeAt, released after the wall clock passed it): stale pass aborts
       (40001 via the incidental RI check — see R1v); attempt stays
       in_progress; response projects the extended authority. Stable across
       3+ re-runs.
   R2  REAL submit route, same schedule: stale pass aborts; retried pass
       accepts the candidate MANUAL submit (submittedAt = arrival now <
       closeAt, reason = manual); extension applied.
   R1c REAL take parked while extension commits (attempt not expired): attempt
       reconciled under the old authority; response effectiveDeadline =
       extended authority (deadline-mode exam, effectiveDeadline === closeAt).
       T-B mixed-version projection PROVEN, display-benign.
   R3/R4 candidate-wins linearizations: both sides commit; no deadlock; extend
       does not queue behind the candidate tx (no Exam serialization point).
   R1v MECHANISM PROBE (per-pass instrumentation + exams-FK trigger with
       RAISE LOG, server-log evidence): pass 1 = stale snapshot, freeze
       succeeds (submitAttempt), finalize UPDATE dies with 40001
       "could not serialize access due to concurrent update" whose CONTEXT is
       `SELECT 1 FROM exams ... FOR KEY SHARE`; pass 2 = extended authority,
       no freeze. THE SMOKING GUN for the incidental protection.
   R1s STAGED take (injected now = closeAt+1s; take route's tx body verbatim;
       writer = plain closeAt UPDATE on a dedicated connection committed AFTER
       the freeze's writes, BEFORE the take commit): the stale freeze COMMITS
       DURABLY (submittedAt = old closeAt, reason = deadline). The writer is a
       plain UPDATE because a writer's FOR UPDATE would queue behind the
       freeze's incidental FK KEY SHARE (measured); the authority change is
       identical.
   R2s STAGED submit: the REAL submitAndGradeAttempt orchestrator (injected
       now), parked at the EA seam via the enrollment barrier, writer commits
       mid-flight → same durable stale freeze. The structural gap lives in the
       shared path, not the route.
   No sleeps gate any outcome; interleavings are forced by deferred barriers
   and a pg_locks liveness predicate (hard timeout, loud failure on miss).
   POST-FIX EXPECTATIONS (Design B): R2s flips to the #543-H2 oracle (writer
   40001 + retry, no durable stale freeze). R1s's writer lands after the
   future seam lock → its observable outcome becomes a valid take-wins
   linearization (assertions would hold unchanged) — the post-fix regression
   oracle for the seam is R2s plus the save suite; R1/P2/P3/R3/R4/R1c keep
   passing unchanged.

I. ROOT CAUSE
   `ensureAttemptDeadlineReconciled`'s contract treats the Exam read as a plain
   lookup and delegates serialization to callers. Three callers took on that
   duty (restore, operatorGrant, scanner) and #543 added it to the save seam —
   but take and submit never acquired it. The reconciliation seam is therefore
   not writer-agnostic: whether a deadline decision serializes against Exam
   writers depends on which of five call sites is entered. On the live surface
   the gap is masked by an undesigned, ordering-dependent FK-RI abort (R1v)
   that the repo's own #543 doctrine explicitly disclaims as non-authority.

J. REPAIR DESIGN COMPARISON
   A caller-owned (take/submit each: EA lock → Exam FOR UPDATE → reconcile):
     + mirrors restore/operatorGrant (existing precedent); no engine contract change.
     − duplicates the discipline at every entrypoint; correctness depends on
       each future caller remembering it (exactly the failure class #558 is);
       lock provenance stays distributed.
   B reconciliation-owned (the seam's contract REQUIRES the authoritative Exam
     lock: ensureAttemptDeadlineReconciled takes the exam row via
     findByIdForUpdate instead of plain findById, before any decision):
     + ONE canonical enforcement point; future entrypoints inherit the
       discipline mechanically; no second entrypoint.
     + smallest semantic change: same repo, same call position, interface
       already declares findByIdForUpdate (examCommands.ts:51); in-memory fakes
       already implement it (attemptMutation.testHelpers.ts:262).
     + double-lock callers are safe: restore/operatorGrant re-lock a row their
       tx already holds (Postgres no-op); save's later findByIdForUpdate
       becomes an equally-safe re-lock. CAVEAT (fresh review): those callers'
       explicit pre-locks PRODUCE the `exam` object their later logic consumes
       (restoreInterruption.ts:228 feeds policy evaluation at :366/:411) — a
       cleanup that removes the pre-locks must first refactor those consumers
       onto the seam's locked read; that cleanup is OUT of #558 scope.
     − "hidden lock acquisition" inside a reconcile function must be
       documented at the seam (INVARIANT comment) and covered by regression
       tests (R2s flips to the #543-H2 oracle; the save suite guards the save
       path).
   C narrow locked-reconciliation composition seam (a lock+reconcile helper):
     + avoids touching ensureAttemptDeadlineReconciled's contract.
     − creates a second reconciliation entrypoint parallel to the canonical
       seam (violates single-authority unless the old path is reserved), or
       degenerates into A-with-extra-naming.

RECOMMENDED_DESIGN: B — reconciliation seam owns the Exam lock.
   Reasons: minimal semantic authority (one decision + its serialization in one
   function), smallest change surface (one read swapped for its locked sibling
   plus comment/tests), mechanical lock-order safety (EA capability is already
   asserted at seam entry; Enrollment → Attempt → Exam holds by construction,
   under both RR and the start path's READ COMMITTED where the in-seam lock
   degrades to read-latest-under-lock — correct, no 40001, no break), no
   duplicated protocol (unlike A/C), lowest future regression risk. The seam
   change also converts the take/submit paths from "protected by an incidental,
   ordering-dependent RI abort" to "protected by the designed discipline".

K. DOC DRIFT (active docs, current master)
   docs/architecture/exam-system/data-authority.md
     §9.2 transaction inventory: Save row omits the #543 Exam FOR UPDATE inside
       prepareReconciledAttemptMutation; "Deadline reconciliation — EA lock →
       ensureAttemptDeadlineReconciled — Atomic" describes take/submit
       composition without noting the missing DESIGNED Exam serialization
       (and the incidental RI abort) → INCOMPLETE.
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

AUDIT ARTIFACTS (audit branch only; not for merge as-is):
   apps/api/src/routes/attempts/exam-558-deadline-authority.audit.concurrency.test.ts
     — 11 deterministic probes: P1-P3 (RR mechanism), R1/R2 (real-route
     reality: the incidental RI abort), R1v (mechanism pin-down with
     server-log evidence), R1c (T-B mixed-version projection), R3/R4
     (candidate-wins linearizations), R1s/R2s (durable stale freeze under
     flipped writer ordering).

READY_FOR_HUMAN_REVIEW_BEFORE_FIX
```

## §L. FRESH REVIEW (independent adversarial pass, no prior transcript)

Reviewer verdicts on the 10 attack points, and dispositions:

1. Callsite enumeration — AGREE_WITH_CAVEAT: the caller set is complete; caveat adopted (restore has two production entries with different isolation — now recorded in §C/§5).
2. RR assumptions — AGREE_WITH_CAVEAT + a BLOCKER against the report's FIRST draft: the take route samples `fastify.now()` INSIDE the tx at attempts.candidate.ts:897 (after the EA seam), so the first draft's "E < S arrival-pinning" argument was factually wrong for take. UPHELD IN PART AND RESOLVED BY MEASUREMENT: the corrected E > S model predicted pass 1 freezes; instrumentation (R1v + server log) then identified WHY the freeze still does not become durable — the exams-FK RI check raises 40001 inside the freeze's finalize UPDATE and the whole pass retries. The reviewer's alternative prediction (a durable stale freeze through the real route) is falsified by R1/R1v/R2 evidence (6+ runs, log-proven mechanism); the draft's "unreachable via API" claim is likewise replaced by "incidentally protected, ordering-dependent, durable under flipped ordering (R1s)".
3. FK lock as authority — AGREE: the audit never leaned on FK locks as a safety argument; P3 exists to disprove it. (The measured RI abort is documented AS incidental and non-authority, consistent with the #543 doctrine.)
4. Exam → Attempt inversion — AGREE: none found (admin transitions, PATCH, delete, publishResults, reconciliation, forceSubmit, gradingQueue, scanner all verified).
5. save #543 classification — AGREE: no survivor window; the exam-derived input of the decision is closeAt only.
6. T-B mixed-version snapshot — AGREE: display-benign in the extend direction; adopted caveat (the response would also present a stale freeze as lockReason "submitted" — harmless for display, useless for detection).
7. minSubmitAfterStartMinutes — AGREE: immutable post-publish; same-snapshot read.
8. operatorGrant/restore — AGREE: no decision precedes the Exam lock; adopted caveat (two entries, two isolation mechanisms).
9. Repro oracle vacuity — DISPUTE (partially), resolved by measurement: R1/R2 are real discriminators (a durable freeze would flip them). The reviewer's own model predicted R1 must fail; R1v's per-pass instrumentation proved pass 1 dies via the exams-FK RI 40001 — i.e., the reviewer's mechanism model (P2 ⇒ durable stale freeze) was incomplete: it missed the RI abort inside the freeze path. The reviewer is RIGHT that the first draft's E < S reasoning was wrong, and RIGHT that R1s cannot serve as the post-fix 40001 oracle (only R2s flips) — J corrected.
10. Repair design — AGREE_WITH_CAVEAT: Design B stands; adopted caveats (restore consumer refactor before any pre-lock cleanup; per-isolation post-fix expectations).

Reviewer MAJORS — all incorporated: submit's unproven-unreachability (writer tx straddling closeAt) folded into the corrected model; R1s oracle claim corrected; Design B cleanup caveat added; restore isolation split recorded.
Reviewer MINORS — all fixed: fixture now returns the effective (post-shorten) closeAt; debug prints removed; header rewritten to the measured reality; the "arrival" citation corrected.

Reviewer OVERALL verdict on the first draft was UNSOUND (headline reachability reasoning). The corrected audit: structural findings unchanged and code-grounded; reachability model replaced with the measured RI-abort mechanism; repair boundary unchanged (Design B). FINAL: SOUND_WITH_CAVEATS — ready for human review of the repair-boundary decision.
