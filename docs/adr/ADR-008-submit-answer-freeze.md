# ADR-008 — Submit Answer Freeze Barrier

## Status

**Accepted (Phase 2 conservative).** This ADR records the grading-authority
semantics the current contract can actually guarantee, the `submitAndGradeAttempt`
single-transaction fix (J1) that closes a real stale-snapshot window, and the
explicit non-guarantee around concurrent save-vs-submit lock ordering. Option D
(the generic final-answer submit barrier) is recorded as a follow-up that
requires a contract change and is **out of Phase-2 scope**.

> **Revision note (2026-07-31, docs-only):** Option D was originally labelled
> "WYSIWYG submit" because rich-text answering was the expected trigger at the
> time. The label was corrected because the barrier is **answer-type-
> independent** — the save/submit lock-ordering race it closes can affect single
> choice, multi-select, true/false, fill-blank, and text answers alike. The
> contract below (a `/submit` final-answer payload or answer-version/hash
> barrier) was always generic; only the heading/label is changed, not the
> semantics. Closing the plain-text `text_response` authoring loop does not
> close this barrier.

## Context

`save-submit-race.spec.ts` surfaced a real product-semantics issue (not a flaky
test): when a candidate has the correct answer `true` saved and confirmed, then
concurrently fires `/submit` and several `/answers` with the wrong answer
(`false`) using a **legal** `baseVersion === currentVersion`, the final score
could non-deterministically come out 0 or 100.

Investigation found **two distinct races**, only one of which was originally
diagnosed:

1. **Stale-snapshot race (the one originally diagnosed).** The legacy
   `submitAndGradeAttempt` structure was:
   - **TX1**: `findByIdForUpdate` → ownership check → `submitAttempt`
     (`in_progress` → `submitted`) → **commit + release lock**.
   - **Between TX1 and TX2**: `readGradingSnapshot` + `computeGradingResult`
     ran with **non-transactional** repos (`createAttemptRepo(db)`), reading
     `attempt.answers` with a plain `findById` — no lock, no transaction.
   - **TX2**: `findByIdForUpdate` (re-lock) → `finalizeGrading` using the
     **pre-computed** `result`.

   A concurrent save landing in the inter-tx window mutated `answers`, and the
   non-tx snapshot read the mutated value. TX2's re-lock could not help: the
   score was already computed from the out-of-tx read, and `finalizeGrading`
   uses the passed-in `result`, never recomputing from its locked re-read
   (which only consults `status`).

2. **Lock-ordering race (diagnosed during P0-4 implementation — fundamental).**
   `/submit` carries **no final-answer payload or version barrier**. When a
   save and a submit are fired concurrently (`Promise.all`), both call
   `findByIdForUpdate`. **Whichever acquires the lock first wins:**
   - save first → sees `in_progress` → legally accepts `false`
     (`baseVersion === currentVersion`, not stale) → releases → submit locks,
     reads `false`, scores **0**.
   - submit first → flips row to `submitted` → releases → save locks, sees
     `submitted`, rejected (`ATTEMPT_ALREADY_SUBMITTED`) → submit read `true`,
     scores **100**.

   Both outcomes are **protocol-legitimate**. The server has no notion of
   "the answer the candidate saw at the instant they clicked submit" — submit
   is a state transition, not an answer write. A save that lands milliseconds
   before submit is a real, distinct answer.

## Decision

### Adopted (current Phase-2 contract)

- **No API contract change.** `/submit` continues to carry no answer payload.
- **Submit/save concurrency is serialized by Postgres row lock; lock-acquisition
  order decides the winning answer.** This is the documented, legitimate
  semantics — not a bug to "fix" by inventing submit priority the contract
  does not define.
- **J1 (implemented): `submitAndGradeAttempt` runs submit + answer snapshot
  read + score compute + finalize in ONE transaction under the row lock.**
  This closes race #1: the score is always computed from the locked,
  in-transaction answer set, never a stale out-of-tx snapshot.
- **Grading must match the answers read inside the submit transaction.** The
  score is consistent with whatever answer set the row held under the lock.
- **No guarantee** that "the answer visible in the UI at submit-click time
  wins." That requires Option D.

### Rejected alternatives

| Option | Why rejected |
| ------ | ------------ |
| **max score (best-of-history within one attempt)** | Wrong abstraction. `scoreStrategy=highest` is for selecting across *multiple attempts* on the enrollment, not within one attempt. Would award "was ever correct" and directly violates SPEC §3.5 latest-answer-wins. Masks the race instead of fixing it. |
| **`score ∈ {0,100}` as the test's permanent assertion** | Asserts nothing meaningful — accepts any nondeterminism. Hides real regressions of the J1 invariant (score-vs-answer consistency). |
| **stale `baseVersion = currentVersion - 1` workaround** | Stops testing the real race; relabels it green. The whole point is a *legal* currentVersion save. |
| **TX1/TX2 kept, but recompute `result` inside TX2** | Does not close race #1: TX1 commits and releases the lock; a save can land between TX1-commit and TX2-lock, and TX2's locked read then sees the mutated value. Only a single transaction is airtight. |
| **schema snapshot column (`submittedAnswerSnapshot`)** | Schema change (forbidden in this scope). Also redundant: `answers` is already immutable post-`submitted` (the answer protocol rejects saves on submitted/grading/graded rows). |
| **fake submit priority without a payload** | Impossible. Without the client telling the server what it submitted, the server cannot prefer "the submit answer" over a save that legitimately arrived first. |

### Follow-up (Option D — generic final-answer submit barrier)

If the product later requires "the answer visible at submit-click time is the
grading authority":

- `/submit` request carries the client's **final answer payload** (or an
  **answer-version / hash barrier**) — what the candidate saw when they clicked.
- The server, inside the submit transaction, confirms the answer state matches
  the barrier (or persists the payload first), then grades against it.
- This makes submit authoritative over earlier-arriving saves.

Option D requires **contract + frontend + API changes** and its own ADR
amendment. It is **not** Phase-2 scope and is not started here.

## Consequences

- **Transaction is slightly longer**: objective-question grading
  (`computeGradingResult` / `gradeAnswers`) now runs inside the locked
  transaction. This is CPU-bound and fast (<10ms in tests); the candidate
  submit path is not hot. Acceptable.
- **Fairness/determinism improved for race #1** (stale snapshot): eliminated.
  The score is always consistent with the locked answer set.
- **Race #2 (lock ordering) remains as documented, legitimate behavior.** The
  E2E `save-submit-race.spec.ts` and the API `submitFreezeBarrier.test.ts`
  assert the true invariants (graded + no 5xx + saves accepted-or-deterministically-rejected
  + score consistent with final persisted answer), not a fixed `score === 100`.
- **No contract change, no schema change, no UI/i18n change.**
- **P0-1 (submit row lock) and P0-2 (grading transaction contract) invariants
  preserved and strengthened.**

## Evidence

- Fix: `apps/api/src/orchestrators/submitAndGradeAttempt.ts` (single
  `executeInTransaction`).
- Engine invariants unchanged: `packages/exam-engine/src/grading.ts`
  (`finalizeGrading`), `packages/exam-engine/src/attemptCommands.ts`
  (`submitAttempt` uses `findByIdForUpdate`).
- API integration test: `apps/api/src/routes/submitFreezeBarrier.test.ts`
  (real Postgres, 5+ race iterations, asserts score↔answer consistency).
- E2E: `apps/e2e/e2e/save-submit-race.spec.ts` (asserts true invariants, not
  fixed score).
