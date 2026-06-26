# ADR-005 — Exam Operation State Baseline

## Status

**Accepted** (implemented). Error codes, audit actions, and the Canceled state
exist in the codebase. Core lifecycle operations (close, cancel, unpublish,
extend, archive) are implemented per this ADR's transaction pattern.

> **Revision 2** incorporates mandatory review feedback: rename to "three-axis
> state model"; mandatory lock-reconcile-assert-mutate transaction rule; close
> active-attempt policy; defer `cancel`; stale-state protection on
> `unpublish`/`extend`; PATCH-published restricted to schedule fields; runtime
> policy validation; submitAttempt guard ordering; implementation sliced into
> 4 phases.

## Context

The P2B-J1 admin-flow audit (spike, commit `61ad5c9` on `feat/new-task`) tried
to drive the full admin loop end-to-end and surfaced a cluster of missing
exam-operation capabilities. The individual gaps are real, but fixing them
piecemeal (e.g. an `endingSoonSec` E2E workaround, a single close route) would
produce incoherent state semantics. This ADR establishes the **baseline model**
first, so the implementation has one authority to build against.

### Verified findings from the P2B-J1 spike

1. `GET /api/exams/:id/scores` and `GET /api/exams/:id/export/scores` gate on
   `examEnded` (`apps/api/src/routes/scores.ts:124` `canOpenScoreList`). A
   graded attempt alone does **not** open scores/export.
2. `examEnded = status in {closed, archived} OR now >= closeAt`. With a long
   future `closeAt`, an `open` exam stays 409 even after candidates submit.
3. There is **no deterministic admin operation to close/end an open exam**.
   The spike confirmed the full inventory of close paths:
   - `POST /api/exams/:id/close` — **does not exist**.
   - `POST /api/exams/:id/archive` — exists but rejects `open`
     (`EXAM_VALID_TRANSITIONS.open = ["closed"]`; archive is only
     `published|closed -> archived`).
   - `PATCH /api/exams/:id` — exists but is **draft-only**
     (`existing.status !== "draft"` → `ExamNotDraftError`,
     `apps/api/src/routes/exam.ts:482`).
   - Time-based: `checkAndUpdateExamStatus` auto-closes `open -> closed` when
     `now >= closeAt`, but only on access. No admin can force-close now.
4. The spike used a short `closeAt` window (`endingSoonSec`) + poll as an E2E
   workaround. **This workaround must not carry into production.** It hides the
   missing close operation behind timing.
5. `ControlFlags` (`packages/contracts/src/exam.ts:35`) has **no minimum manual
   submit duration** and **no late-entry cutoff**. `submitAttempt`
   (`packages/exam-engine/src/attemptCommands.ts:208`) checks only the attempt
   state machine — no elapsed-time guard.
6. The roadmap already flagged this:
   `docs/phase2/phase2.plan.md:297` — *"openExam()/closeExam() exist but no
   route or scheduler calls them."*

### Why a design-first baseline (not direct implementation)

P2B-J2 (admin hardening) and P2C (proctor runtime) both depend on exam
operation semantics. Building `close` without `extend`/`unpublish`, or building
the timing policy without a `submit source` discriminator, would force rework.
This ADR fixes the **state model, API surface, error contract, and audit
events** in one place. Phase 2B/2C jobs then implement slices of it.

### Conventions confirmed from the codebase (binding for this ADR)

| Concern | Existing convention | ADR decision |
| --- | --- | --- |
| Spelling of cancel | Codebase uses **US** `canceled` (30) over `cancelled` (0). | Use **`canceled`** for the state and any related code. (Cancel op is **implemented** in Phase 2 — see §Layer 3.5.) |
| Exam status enum | `packages/domain/src/enums.ts:104` `ExamStatus = {draft, published, open, closed, canceled, archived}` (6 states). | All 6 states are **implemented** in Phase 2. |
| Error code format | `SCREAMING_SNAKE_CASE` in `packages/contracts/src/messageRegistry.ts`. | New codes follow this exactly. |
| Error response shape | `{ code, message, requestId, details }`. | No second format introduced. |
| Audit action format | **dot.case**: `"exam.publish"`, `"exam.archive"`, `"enrollment.add"`. | New actions use dot.case. |
| Audit write helper | `recordAudit(fastify, request, ctx, action, targetType, targetId, metadata)`. `actorId` from `ctx`. | `fromStatus`/`toStatus`/`reason` go in `metadata`. |
| State machine file | `packages/exam-engine/src/examStateMachine.ts`. | Same file/shape extended. |
| Attempt "active" states | `in_progress`, `disrupted` (plus `submitted`/`grading` are in-flight to graded). | "Unfinalized" = not yet `graded`/`voided`. |

### Related decisions (referenced, **not modified**)

ADR-001/002/003/004 (Redis, WS/SSE, Job Queue, Desktop) remain `Deferred` and
orthogonal. This baseline adds no Redis, no WS/SSE, no queue; admin close/
extend are synchronous HTTP writes; auto-close runs on the existing in-process
scanner.

## Decision

Adopt a **three-axis state model**, a **stateful admin operation surface**, and
a **candidate runtime timing policy**, with a mandatory
**lock-reconcile-assert-mutate** transaction rule binding every admin
operation. Implement in **4 slices** (see §Implementation Slices) after this
ADR is reviewed.

## Layer 1 — Three-axis state model

The platform must distinguish three **independent state axes**. Conflating
them is the root cause of the P2B-J1 blockers.

### 1.1 Exam lifecycle state (entity: `Exam`)

| State | Meaning | Editable? | Candidates can take? |
| --- | --- | --- | --- |
| `draft` | Created, not released. Full edit. | yes | no |
| `published` | Released, not currently open. Limited edit (schedule only). | schedule only | no |
| `open` | Window is live; candidates may start/resume. | no (use close/extend) | yes |
| `closed` | Normal end. Scores/export allowed **only when no unfinalized attempts remain**. | no | no |
| `canceled` | Abnormal cancellation. *(Deferred — see §3.5.)* | no | no |
| `archived` | Read-only historical. | no | no |

Source: `packages/domain/src/enums.ts` `ExamStatus` (extend with `Canceled`
only in Slice 4).

### 1.2 Attempt state (entity: `ExamAttempt`)

Existing, unchanged in this baseline:
`not_started → queued → in_progress → disrupted | submitted → grading → graded | voided`.

**Finalized** states (attempt is settled): `graded`, `voided`.
**Unfinalized** ("active") states: `in_progress`, `disrupted`, `submitted`,
`grading`. The close guard (§3.3) and scores/export gate (§Close & Export
Policy) key off this distinction.

### 1.3 Candidate / session / device operational state

Not a single enum — derived from `ExamAttempt` fields:
- **session liveness** — `lastActivityAt` heartbeat vs `HEARTBEAT_TIMEOUT_MS`
  → live / disconnected (`disrupted`).
- **device** — implicit via the authenticated session cookie; no per-candidate
  device binding in Phase 1/2.
- **resume eligibility** — `in_progress | disrupted` attempt exists for the
  enrollment.

This axis is **observed**, not transitioned by a dedicated machine. Future
proctor/device jobs add explicit state here.

## Construction hard rule — reconcile under lock (binding)

**This is a construction hard rule, not an open question.** Every admin
operation — publish, unpublish, close, extend, cancel, archive, PATCH — must
execute this exact sequence inside a single transaction:

```
transaction
  -> find exam for update        (row lock)
  -> reconcile status by now     (checkAndUpdateExamStatus)
  -> assert transition           (state machine)
  -> mutate                      (status / closeAt / timing fields)
  -> audit                       (recordAudit)
  -> commit
```

1. **Lock** the exam row (e.g. `SELECT ... FOR UPDATE` via the repo) so no
   concurrent admin op or scanner races the decision.
2. **Reconcile** status by `now` — run the access-time reconciliation
   (`checkAndUpdateExamStatus`) **before** asserting the requested transition.
   This guarantees a *stale* persisted status cannot be acted on: if `now`
   says the exam should be `open`/`closed`, the row is advanced first.
3. **Assert** the transition against the **reconciled** status via the state
   machine.
4. **Mutate** the row (status / `closeAt` / timing fields).
5. **Audit** (dot.case action, metadata includes `fromStatus`/`toStatus`).
6. **Commit.**

### Why this is non-negotiable — stale-state failure modes

Reconciling under lock is the only thing that prevents these concrete bugs:

- **`unpublish` on a stale `published`**: an exam whose `openAt` already passed
  is persisted as `published` but is logically `open`. Without reconcile-first,
  `unpublish` would accept it (`published -> draft`) and silently rewind a
  live exam back to draft — candidates mid-exam lose their window.
- **`extend` on a stale `open`**: an exam whose `closeAt` already passed is
  persisted as `open` but is logically `closed`. Without reconcile-first,
  `extend` would revive a dead exam by pushing `closeAt` forward — reopening a
  window the deadline scanner already treated as ended, and conflicting with
  already-issued 409s on candidate starts.
- **`close` racing the deadline scanner**: without the row lock, the scanner\'s
  `open -> closed` auto-close and the admin\'s `close` can both read `open` and
  both write, producing duplicate audits or a lost-update.

Any admin op that skips reconcile-under-lock is a bug. This rule is what makes
stale-state protection (§3.2, §3.4) and the close active-attempt guard (§3.3)
correct.

## Layer 2 — Exam lifecycle transitions

```
draft
  -> published      via publish

published
  -> draft          via unpublish   (stale-guarded: see §3.2)
  -> open           via auto-open / access-time reconciliation
  -> canceled       via cancel       (DEFERRED — Slice 4)
  -> archived       via archive

open
  -> closed         via admin close  (active-attempt-guarded: see §3.3)
  -> closed         via auto-close / access-time reconciliation
  -> open           via extend closeAt (stale-guarded: see §3.4)
  -> canceled       via cancel       (DEFERRED — Slice 4)

closed
  -> archived       via archive

canceled            (DEFERRED)
  -> archived       via archive

archived
  -> (no mutation)
```

### Explicitly rejected transitions

```
open      -> draft
closed    -> draft
canceled  -> draft
archived  -> anything mutable
draft     -> archived        (must publish first)
open      -> archived        (must close first)
```

## Layer 3 — Admin operation API surface

All admin-only, under `/api/exams/:id`, all run the **lock-reconcile-assert-
mutate** rule, all record audit. Error envelope is the existing
`{code,message,requestId,details}`.

### 3.1 `POST /api/exams/:id/publish` — exists, verify

- Allowed: `draft -> published` (and `draft -> open` when `openAt <= now` and
  current behavior auto-opens — keep as-is).
- Reject: `open|closed|canceled|archived` → existing codes.
- Audit: `exam.publish` (existing).

### 3.2 `POST /api/exams/:id/unpublish` — **new** (Slice 2)

- Allowed: `published -> draft` **only if, after reconciliation, the exam is
  still `published`** (i.e. `now < openAt`). Stale-state protection: if
  reconciliation advanced the exam to `open` (because `openAt` already
  passed), `unpublish` is rejected.
- Reject: `draft|open|closed|canceled|archived`, or reconciled-to-`open` →
  `EXAM_UNPUBLISH_NOT_ALLOWED`.
- Hard rule: **never** `open -> draft`.
- Audit: `exam.unpublish`, metadata `{fromStatus:"published", toStatus:"draft"}`.

### 3.3 `POST /api/exams/:id/close` — **new** (Slice 1; unblocks P2B-J1)

- Body: `{ "reason"?: string }`.
- Allowed: `open -> closed` **only when no unfinalized attempts exist** for the
  exam (i.e. no `in_progress | disrupted | submitted | grading` rows). This is
  the **close active-attempt policy (MVP)**: admin must let active attempts be
  resolved first (candidate submits, deadline scanner auto-submits, or a future
  P2C-J2 force-submit).
- Reject:
  - `draft|published|canceled|archived`, or reconciled-not-`open` →
    `EXAM_CLOSE_NOT_ALLOWED`.
  - `open` with unfinalized attempts remaining → `EXAM_CLOSE_NOT_ALLOWED` with
    `details.reason = "UNRESOLVED_ATTEMPTS_EXIST"` and
    `details.activeAttemptCount`.
- Idempotency: **200 + current exam, no duplicate audit** when already `closed`
  AND no unfinalized attempts.
- **Does NOT force-submit active attempts** in this baseline.
- Audit: `exam.close`, metadata `{reason?, fromStatus:"open", toStatus:"closed"}`.
- **Expected effect**: once `closed` and no active attempts remain, `examEnded`
  is true → scores/export return 200 (replaces the `endingSoonSec` workaround).

### 3.4 `POST /api/exams/:id/extend` — **new** (Slice 2)

- Body: `{ "extendMinutes": number, "reason"?: string }`.
- Allowed: `open -> open` (updates `closeAt` only) **only if, after
  reconciliation, the exam is still `open`** (i.e. `now < closeAt`). Stale-state
  protection: if reconciliation advanced the exam to `closed` (because
  `closeAt` already passed), `extend` is rejected — a stale `open` exam cannot
  be revived by extending its `closeAt`.
- Rules: `extendMinutes` integer > 0; new `closeAt > old closeAt`; new
  `closeAt > now`.
- Reject: `draft|published|closed|canceled|archived`, or reconciled-to-`closed`
  → `EXAM_EXTEND_NOT_ALLOWED`.
- Audit: `exam.extend`, metadata
  `{extendMinutes, oldCloseAt, newCloseAt, reason?}`.

### 3.5 `POST /api/exams/:id/cancel` — **Implemented** (Slice 4, Phase 2)

`cancel` has been implemented in Phase 2. The engine performs the status
transition (`published -> canceled`, `open -> canceled`). The route layer
enforces the unresolved-attempts guard (rejecting with
`EXAM_CANCEL_NOT_ALLOWED` when open with in-progress/disrupted/submitted/grading
attempts).

- Allowed: `published -> canceled`, `open -> canceled`;
- Rejected: `draft|closed|canceled|archived` → `EXAM_CANCEL_NOT_ALLOWED`;
- Attempt behavior: attempts are NOT voided or force-submitted by cancel.
  The unresolved-attempts guard prevents cancel while attempts are active.
- Result/export behavior: `publishResults` and score/export endpoints reject
  `canceled` exams until cancellation-marker result/export semantics are
  implemented (Phase 3).

Note: `canceled` exams can be archived (`canceled -> archived`). Cancel is
NOT idempotent (`canceled -> canceled` is rejected); to settle a canceled exam,
archive it.

`cancel` evidence package / signed cancellation report remains Phase 3+.

### 3.6 `POST /api/exams/:id/archive` — exists, verify (includes `canceled`)

- Allowed: `published -> archived`, `closed -> archived`, `canceled -> archived`.
- Reject: `draft|open|archived`.
- Audit: `exam.archive` (existing).

### 3.7 `PATCH /api/exams/:id` — clarify, keep draft-default

- `draft` → full edit (current).
- `published` → **schedule fields only**: `openAt`, `closeAt`. **No** question,
  `controlFlags`, score-policy, or other mutation after publish. Rules: if the
  exam is not yet open, `openAt` may be in the future; `closeAt > openAt`.
- `open|closed|canceled|archived` → reject generic PATCH →
  `EXAM_UPDATE_NOT_ALLOWED`. Use the dedicated operations (close/extend).

## Layer 4 — Candidate runtime timing policy

### 4.1 New exam fields

```
latestStartOffsetMinutes : integer | null   (null = disabled)
minSubmitAfterStartMinutes: integer | null   (null = disabled)
```

Validation: `null` or integer `>= 0`. Added across DB migration + schema
(snake_case `latest_start_offset_minutes`, `min_submit_after_start_minutes`),
contracts Zod (create/update/response), OpenAPI. Admin UI is a **documented
follow-up** if it bloats the PR; **API must be complete**.

### 4.2 Validation rules (binding)

- `latestStartAt = openAt + latestStartOffsetMinutes` **must be before
  `closeAt`** (when `latestStartOffsetMinutes != null`). Reject otherwise at
  create/update with a validation error.
- `minSubmitAfterStartMinutes` **should not exceed `durationMinutes`** unless
  explicitly allowed; default behavior: reject at create/update if
  `minSubmitAfterStartMinutes > durationMinutes` (it would make manual submit
  impossible). A future flag may lift this; none exists now.
- **Non-`timed_window` exams**: Phase 1 only supports `timed_window`. Both
  fields are **ignored** (treated as `null`) for any non-`timed_window` timing
  mode; the create/update validator rejects setting them when
  `timingMode !== "timed_window"`. (When `timed_sync` etc. ship, their policy
  is defined then — out of scope here.)

### 4.3 Late-entry cutoff (`latestStartOffsetMinutes`)

Applies **only to creating a new attempt**:

```
latestStartAt = exam.openAt + latestStartOffsetMinutes
if now > latestStartAt: reject new startAttempt -> 409 ATTEMPT_LATE_ENTRY_CLOSED
details: { latestStartAt, now }
```

Must **not** block: resume `in_progress`, restore `disrupted`, deadline
scanner, admin/proctor/system ops.

**Ordering inside `startAttempt` (binding):**
1. Lock enrollment/candidate scope as today.
2. Find existing active/resumable attempt.
3. If one exists → resume/restore path (no cutoff).
4. Only when creating a **new** attempt → apply `latestStartOffsetMinutes`.
5. Create attempt.

### 4.4 Minimum manual submit duration (`minSubmitAfterStartMinutes`) + guard ordering

Applies **only** to candidate manual submit:

```
earliestSubmitAt = attempt.startedAt + minSubmitAfterStartMinutes
if source == "candidate" and now < earliestSubmitAt:
  reject -> 409 ATTEMPT_SUBMIT_TOO_EARLY
details: { earliestSubmitAt, remainingSeconds }
```

**Guard ordering inside `submitAttempt` (binding):**
1. Load attempt.
2. **Idempotent already-submitted path first**: if the attempt is already
   `submitted`/`grading`/`graded`, return success/idempotent without running
   the early-submit check. (A re-submit after the deadline scanner already
   submitted must not be re-rejected by the early-submit guard.)
3. Run state-machine transition assertion.
4. Only for a genuine `in_progress -> submitted` transition with
   `source == "candidate"` → apply `minSubmitAfterStartMinutes`.

Must **not** block: `deadline_scanner`, `proctor`, `system` submit sources.

### 4.5 Submit source discriminator (command layer only)

```ts
type SubmitSource = "candidate" | "deadline_scanner" | "proctor" | "system";
```

- **Not** a client-controlled body field. Candidate route hard-codes
  `{ source: "candidate" }`; scanner hard-codes `deadline_scanner`; etc.
- No silent default to `"candidate"` for internal callers — source is explicit
  at the command boundary.

## Close & export policy (binding)

- **Close requires no active attempts** (§3.3). An exam cannot reach `closed`
  while unfinalized attempts remain.
- **Scores/export require `examEnded` AND no unfinalized attempts**. Concretely,
  `canOpenScoreList` (or a sibling guard) must additionally reject with
  `EXAM_NOT_FINISHED` / `details.reason = "UNRESOLVED_ATTEMPTS_EXIST"` when
  unfinalized attempts exist, even if `now >= closeAt`. This prevents exporting
  partial results while candidates are still mid-exam.
- `cancel` carries its own export marker; `publishResults` and score/export
  endpoints reject `canceled` exams until cancellation-marker result/export
  semantics are implemented (Phase 3). The only ended-with-results path for
  now is `closed` (with `resultsPublishedAt`).

## Error contract (new codes, existing format)

| Code | HTTP | Where |
| --- | --- | --- |
| `EXAM_UNPUBLISH_NOT_ALLOWED` | 409 | unpublish |
| `EXAM_CLOSE_NOT_ALLOWED` | 409 | close (incl. `details.reason = "UNRESOLVED_ATTEMPTS_EXIST"`) |
| `EXAM_EXTEND_NOT_ALLOWED` | 409 | extend |
| `EXAM_UPDATE_NOT_ALLOWED` | 409 | PATCH non-editable state / non-schedule field on published |
| `ATTEMPT_LATE_ENTRY_CLOSED` | 409 | new startAttempt past cutoff |
| `ATTEMPT_SUBMIT_TOO_EARLY` | 409 | candidate submit before min duration |

`EXAM_CANCEL_NOT_ALLOWED` and the `canceled` enum value are **implemented** in
Phase 2 (Slice 4). No second error format.

## Audit events (dot.case, existing helper)

| Action | Trigger | metadata |
| --- | --- | --- |
| `exam.publish` | publish | (existing) |
| `exam.unpublish` | unpublish | `{fromStatus, toStatus}` |
| `exam.close` | close | `{reason?, fromStatus, toStatus, activeAttemptCount?}` |
| `exam.extend` | extend | `{extendMinutes, oldCloseAt, newCloseAt, reason?}` |
| `exam.archive` | archive | (existing) |

`exam.cancel` is **implemented** in Phase 2 (Slice 4). `actorId` from `ctx`; no noisy
audit for rejected candidate submits.

## Admin UI controls (minimal, with stable testids)

```
draft      : publish, edit
published  : unpublish, edit-schedule, cancel, archive (if allowed)
open       : close, extend, cancel
closed     : scores, export, archive
canceled   : archive
archived   : read-only
```

New `data-testid`s: `exam-detail-unpublish-btn`, `exam-detail-close-btn`,
`exam-detail-extend-btn`, `exam-detail-cancel-btn`.
Dialogs: close (reason optional), extend (`extendMinutes` required), cancel (reason optional). No full
proctor/session UI in this baseline.

## Implementation Slices

Implementation is split into 4 slices. Each slice is independently shippable
and testable; later slices depend on earlier ones.

### Slice 1 — Close baseline (unblocks P2B-J1)

- `POST /api/exams/:id/close` with the lock-reconcile-assert-mutate rule.
- Close active-attempt guard (`UNRESOLVED_ATTEMPTS_EXIST` rejection).
- Scores/export guard extended to also require no unfinalized attempts.
- Minimal UI: `exam-detail-close-btn`.
- **Replaces the `endingSoonSec` workaround; admin full-loop E2E can resume
  (setup → publish → candidate take+submit → admin close → scores → export).**

### Slice 2 — Unpublish / schedule / extend

- `POST /api/exams/:id/unpublish` (stale-guarded).
- `POST /api/exams/:id/extend` (stale-guarded).
- PATCH clarification: `published` schedule-only (`openAt`/`closeAt`).
- UI: `exam-detail-unpublish-btn`, `exam-detail-extend-btn`.

### Slice 3 — Timing policy

- Fields `latestStartOffsetMinutes` + `minSubmitAfterStartMinutes` (DB, schema,
  contracts, OpenAPI).
- Late-entry cutoff in `startAttempt` (new-attempt-only).
- Min-submit guard in `submitAttempt` with the binding guard ordering
  (idempotent-already-submitted first).
- `SubmitSource` discriminator across all submit call sites.
- Validation rules (§4.2).

### Slice 4 — Cancel (likely deferred further)

- `canceled` enum value + `exam.cancel` op + `EXAM_CANCEL_NOT_ALLOWED`.
- **Only** if/when attempt-voiding and cancellation-marker export semantics
  are decided. This ADR must be amended with those decisions before Slice 4
  ships. Default assumption: **Slice 4 does not ship** in this work cycle.

## Boundary / non-collision with existing Phase 2C jobs

This baseline operates on the **exam lifecycle** axis. It must not collide with
the per-**attempt** proctor operations already scoped in Phase 2C:

| Operation | Entity / field | Axis | Owner job | Collides? |
| --- | --- | --- | --- | --- |
| `POST /api/exams/:id/extend` (§3.4) | `Exam.closeAt` | exam window (all) | this ADR (P2B) | no |
| `POST /api/admin/attempts/:id/extend-time` | `ExamAttempt.deadlineAt` | per-attempt | P2C-J3 | no |
| `POST /api/admin/attempts/:id/force-submit` | attempt submit | per-attempt | P2C-J2 | no |
| `POST /api/exams/:id/close` (§3.3) | `Exam.status` open→closed | exam lifecycle | this ADR (P2B) | no |

`exam.extend` extends the **exam window**; `attempt.extendTime` (P2C-J3) extends
a **candidate's deadline**. The API paths and audit actions are kept distinct.
`exam.close` ends the **exam lifecycle** and does **not** submit attempts;
P2C-J2 force-submit closes a single attempt. `close`'s active-attempt guard
(§3.3) means the two converge only when an admin force-submits remaining
attempts (P2C-J2) so `close` can then succeed.

## Implemented now vs future

### This baseline implements (across Slices 1–4)

- Admin ops: `close` (S1), `unpublish`/`extend`/PATCH-clarify (S2); verify
  `publish`/`archive`; `cancel` (S4).
- Runtime policy fields + the two guards + `SubmitSource` (S3).
- Lock-reconcile-assert-mutate rule across all admin ops.
- New error codes (including cancel) + audit events.
- Minimal admin UI controls with testids (including cancel).

### Future / explicitly NOT this baseline

- `pause` / `resume` exam.
- Per-candidate device replacement / rebind.
- Account unlock / session reset.
- Machine preflight checks.
- Proctor force-submit (P2C-J2) and attempt invalidation (`voided` op).
- Automatic force-submit of active attempts on exam `close` (deferred).
- Result publishing workflow / provisional-vs-final score visibility.
- Live/provisional score monitor.
- Additional lifecycle states: `paused`, `suspended`, `result_published`,
  `force_closed` — documented as future only; not added now.
- `canceled` evidence package / signed cancellation report (Phase 3+).

## P2B-J1 findings this baseline fixes

| Finding | Fixed by |
| --- | --- |
| No deterministic admin close for an `open` exam (scores/export stuck on 409) | `close` (Slice 1) — `examEnded` becomes true, no `endingSoonSec` workaround. |
| Active attempts block safe export | Close guard + scores/export guard require no unfinalized attempts. |
| `PATCH /exams/:id` draft-only | PATCH schedule-edit for `published` (Slice 2) + `extend` for `open`. |
| No minimum manual submit duration | `minSubmitAfterStartMinutes` + `ATTEMPT_SUBMIT_TOO_EARLY` (Slice 3). |
| No late-entry cutoff | `latestStartOffsetMinutes` + `ATTEMPT_LATE_ENTRY_CLOSED` (Slice 3). |
| Admin full-loop E2E blocked | Resumes after Slice 1; no `endingSoonSec` workaround remains. |
| (Out of scope here) Admin pages lacked `data-testid` | Captured in the spike commit; new UI controls here use stable testids. |

## Alternatives considered

- **Close active-attempt policy**: "allow close anytime, force-submit later"
  was rejected for MVP in favor of "close only when no active attempts" — it
  keeps `closed` as a truly settled state and makes export correctness
  provable. Force-submit remains a separate P2C-J2 op.
- **Idempotency for `close`**: 200 + current exam (chosen) vs 409-with-reason.
- **Extend body shape**: `extendMinutes` (chosen, explicit op) vs absolute
  `closeAt`.
- **Cancel in first implementation**: **deferred** per review feedback; its
  attempt/result/export semantics needed explicit decisions first. Now
  implemented in Phase 2 (Slice 4) with minimal cancel semantics (no attempt
  voiding, export rejection pending Phase 3 cancellation-marker).
- **`submit source` as a body field**: rejected — command-layer discriminator,
  never client-controlled.

## Consequences

- Positive: one authority for exam operation semantics; P2B-J1 E2E unblocks
  (Slice 1); P2C proctor runtime has a stable base; close/export correctness is
  provable (no active attempts).
- Negative: `close` requires active attempts to be resolved first — admins
  cannot end an exam with live candidates without force-submit (P2C-J2) or
  waiting for the scanner. This is intentional and documented.
- Neutral: ADR-001..004 stay `Deferred`; this baseline is HTTP-polling +
  synchronous writes + DB-backed scanner, consistent with single-instance
  Phase 2.

## Resolved review decisions

All six review questions are now owner-resolved. Slices 1–4 already implement
all decisions.

1. **`canceled` spelling**
   Use US spelling: `canceled`. `cancelled` MUST NOT appear in enum values,
   contracts, state-machine transitions, tests, or API responses. The
   `canceled` enum value is implemented in Phase 2 (Slice 4).

2. **`close` idempotency**
   `POST /api/exams/:id/close` is idempotent. If the exam is already `closed`
   and no unfinalized attempts remain, return `200` with the current exam and
   do NOT write a duplicate `exam.close` audit event. Do not return `409` for
   this already-closed settled case. *(Implemented in Slice 1.)*

3. **Close active-attempt policy**
   Keep the MVP policy: `close` rejects while unfinalized attempts exist. An
   `open` exam with `in_progress | disrupted | submitted | grading` attempts
   MUST return `409 EXAM_CLOSE_NOT_ALLOWED` with:

   ```json
   {
     "details": {
       "reason": "UNRESOLVED_ATTEMPTS_EXIST",
       "activeAttemptCount": "<number>"
     }
   }
   ```

   `close` MUST NOT force-submit attempts. Attempt resolution belongs to
   candidate submit, the deadline scanner, or a future P2C force-submit.
   *(Implemented in Slice 1.)*

4. **Extend body shape**
   Use relative `extendMinutes`, not absolute `closeAt`. The server computes
   `newCloseAt` under the exam row lock from the reconciled current exam
   state. `extendMinutes` MUST be an integer greater than `0`, and the
   resulting `newCloseAt` MUST be greater than both `oldCloseAt` and `now`.
   *(Implemented in Slice 2.)*

5. **`minSubmitAfterStartMinutes > durationMinutes`**
   Reject at create/update validation time. Allowing it would make candidate
   manual submit impossible for the configured exam duration. A future
   explicit policy flag may relax this, but no such flag exists in this
   baseline. *(Validation is part of Slice 3; the create/update route rejects
   when the field exceeds `durationMinutes`.)*

6. **`canceled` scores/export behavior**
   Implemented in Phase 2 (Slice 4). `cancel` / `canceled` are implemented.

   `publishResults` and score/export endpoints reject `canceled` exams with
   an explicit error. Silent normal scores/export for `canceled` exams is
   forbidden. Cancellation-marker result/export semantics are deferred to
   Phase 3.

   Current error code for canceled exams:

   - `EXAM_CANCELED_RESULTS_UNAVAILABLE` — 409 — scores/export for canceled
     exams before cancellation-marker result/export semantics are implemented.

   Current shape:

   ```ts
   if (exam.status === "canceled") {
     return reply.code(409).send(
       buildErrorResponse(request, {
         code: "EXAM_CANCELED_RESULTS_UNAVAILABLE",
         message: "Scores/export are unavailable for canceled exams.",
         details: { reason: "CANCELLATION_MARKER_NOT_IMPLEMENTED" },
       }),
     );
   }
   // TODO(Phase 3+): Replace this rejection with explicit cancellation-marker
   // result/export semantics once canceled exam behavior is defined.
   ```
