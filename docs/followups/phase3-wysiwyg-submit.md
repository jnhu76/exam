# Follow-up: Phase 3 — WYSIWYG Submit / Final Answer Barrier

> **Status**: Proposed / not started (Phase 3 product task)
> **Origin**: ADR-008 (P0-4 Submit Freeze Barrier) — records the gap the
> current Phase-2 contract cannot close.
> **Lifecycle**: Remove this note when the feature lands or is formally
> descoped.

## One-line goal

`/submit` carries a **final-answer payload** (or an **answer-version / hash
barrier**) so the server grades against the answer the candidate saw at the
instant they clicked submit — true WYSIWYG submit.

## Why this exists

P0-4 (ADR-008) closed the *stale-snapshot* race by folding submit + grading
into one transaction. It deliberately did **not** close the *lock-ordering*
race: when a legal `currentVersion` save races with `/submit`, the Postgres
row lock serializes them and **whichever locks first wins** (save first →
wrong answer persisted → score 0; submit first → later saves rejected →
score 100). Both are protocol-legitimate under the current contract, because
`/submit` carries no answer payload — the server cannot know "the answer at
submit-click time". So Phase-2 grading authority is *the locked answer set*,
not *the UI answer at click time*.

## What this would change (Option D)

- **Contract**: `SubmitAttemptRequest` gains a final-answer payload **or** an
  answer-version/hash barrier (the client's view of the answer set at click).
- **Server**: inside the submit transaction, confirm the answer state matches
  the barrier (or persist the payload first), then grade against it. This
  makes submit authoritative over earlier-arriving saves — "the answer at
  submit-click time wins".
- **Frontend**: the submit call must capture and send the current UI answer
  state (payload or version snapshot).

## Scope / dependencies

- API contract change (`SubmitAttemptRequest`) + response compatibility.
- Frontend change (capture + send submit-time answer state).
- New ADR amendment (supersedes the Phase-2 non-guarantee in ADR-008).
- Migration/compat: must not break existing clients during rollout.
- Restores the strict `score === 100` assertion in `save-submit-race.spec.ts`
  once the barrier is enforced.

## Non-goals (Phase 2)

- No multi-tenant, no SuperAdmin, no Phase-3 roles.
- Does not touch manual grading (runs post-submit on already-frozen answers).

## Owner / next

Product decision needed: is "UI answer at submit-click time must win" a
hard requirement? If yes, this is the only correct fix and should be scoped
as a Phase-3 contract change. If the current Phase-2 semantics (locked
answer set is authoritative) are acceptable, this can stay deferred.
