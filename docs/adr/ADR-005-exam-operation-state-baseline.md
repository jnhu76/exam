# ADR-005 — Exam Operation State Baseline

## Status

Proposed (design-first; **not yet implemented**). Awaiting review before any
production code. This ADR is the authority for the forthcoming implementation
that unblocks the paused P2B-J1 admin full-loop E2E.

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
operation semantics. Building `close` without `cancel`/`extend`/`unpublish`,
or building the timing policy without a `submit source` discriminator, would
force rework. This ADR fixes the **state model, API surface, error contract,
and audit events** in one place. Phase 2B/2C jobs then implement slices of it.

### Conventions confirmed from the codebase (binding for this ADR)

| Concern | Existing convention | ADR decision |
| --- | --- | --- |
| Spelling of cancel | Codebase uses **US** `canceled` (30) over `cancelled` (0). `packages/domain/src/enums.ts` and all routes use `canceled`. | Use **`canceled`** for the new state, error code `EXAM_CANCEL_NOT_ALLOWED`, audit action `exam.cancel`. The prompting spec wrote `cancelled`; we follow the codebase. |
| Exam status enum | `packages/domain/src/enums.ts:104` `ExamStatus = {draft, published, open, closed, archived}` (5 states). | **Extend** to 6 by adding `Canceled`. Doc comment updated. |
| Error code format | `SCREAMING_SNAKE_CASE` in `packages/contracts/src/messageRegistry.ts` (`EXAM_NOT_DRAFT`, `EXAM_NOT_OPEN`, `ATTEMPT_CLOSED`, …). | New codes follow this exactly (e.g. `EXAM_CLOSE_NOT_ALLOWED`). |
| Error response shape | `{ code, message, requestId, details }`. | No second format introduced. |
| Audit action format | **dot.case**: `"exam.publish"`, `"exam.archive"`, `"enrollment.add"` (`apps/api/src/routes/exam.ts:558,589`). | New actions use dot.case: `exam.unpublish`, `exam.close`, `exam.extend`, `exam.cancel`. **Not** the SCREAMING form from the prompting spec. |
| Audit write helper | `recordAudit(fastify, request, ctx, action, targetType, targetId, metadata)` (`apps/api/src/routes/audit.ts:25`). `actorId` comes from `ctx`. | `fromStatus`/`toStatus`/`reason` go in `metadata`; `targetId = examId`; actor from `ctx.actorId`. |
| State machine file | `packages/exam-engine/src/examStateMachine.ts` (`EXAM_VALID_TRANSITIONS`, `assertTransition`). | Same file/shape extended; commands added in `examCommands.ts`. |

### Related decisions (referenced, **not modified**)

- **ADR-001 (Redis)**: Deferred. This baseline adds **no Redis dependency**.
  Admin close/extend are synchronous HTTP writes; auto-close runs on the
  existing in-process scanner.
- **ADR-002 (WebSocket/SSE)**: Deferred. Admin operation status changes are
  **HTTP polling** (Phase 2C proctor dashboard will poll). No WS/SSE introduced.
- **ADR-003 (Job Queue)**: Deferred. Deadline auto-submit stays on the existing
  DB-backed scanner, not a queue.
- **ADR-004 (Desktop/Electron)**: Deferred. Orthogonal runtime surface.

These four remain `Deferred`. ADR-005 neither supersedes nor amends them.

## Decision

Adopt a **three-layer state model** and a **stateful admin operation surface**
plus a **candidate runtime timing policy**, as specified below. Implement in
slices under Phase 2B (admin ops) and 2C (proctor runtime) jobs, after this ADR
is reviewed.

## Layer 1 — Three-state model

The platform must distinguish three independent state axes. Conflating them is
the root cause of the P2B-J1 blockers.

### 1.1 Exam lifecycle state (entity: `Exam`)

| State | Meaning | Editable? | Candidates can take? |
| --- | --- | --- | --- |
| `draft` | Created, not released. Full edit. | yes | no |
| `published` | Released, not currently open. Limited edit (schedule). | schedule only | no |
| `open` | Window is live; candidates may start/resume. | no (use close/extend) | yes |
| `closed` | Normal end. Scores/export allowed. | no | no |
| `canceled` | Abnormal cancellation. | no | no |
| `archived` | Read-only historical. | no | no |

Source: `packages/domain/src/enums.ts` `ExamStatus` (extend with `Canceled`).

### 1.2 Attempt state (entity: `ExamAttempt`)

Existing, unchanged in this baseline:
`not_started → queued → in_progress → disrupted | submitted → grading → graded | voided`
(`packages/domain/src/enums.ts:71`, machine in
`attemptStateMachine.ts`). Note `voided` already exists — a precedent for the
future invalidation surface.

### 1.3 Candidate / session / device operational state

Not a single enum — derived from `ExamAttempt` fields:
- **session liveness** — `lastActivityAt` heartbeat vs `HEARTBEAT_TIMEOUT_MS`
  → live / disconnected (`disrupted`).
- **device** — implicit via the authenticated session cookie; no per-candidate
  device binding exists in Phase 1/2.
- **resume eligibility** — `in_progress | disrupted` attempt exists for the
  enrollment.

This layer is **observed**, not transitioned by a dedicated machine. Future
proctor/device jobs (§Future) add explicit state here.

## Layer 2 — Exam lifecycle transitions

```
draft
  -> published      via publish

published
  -> draft          via unpublish
  -> open           via auto-open / access-time reconciliation
  -> canceled       via cancel
  -> archived       via archive

open
  -> closed         via admin close
  -> closed         via auto-close / access-time reconciliation
  -> open           via extend closeAt
  -> canceled       via cancel

closed
  -> archived       via archive

canceled
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
draft     -> archived        (must publish first; current machine already forbids)
open      -> archived        (must close first; current machine already forbids)
```

### Diff vs current machine (`examStateMachine.ts`)

| Transition | Current | Target | Action |
| --- | --- | --- | --- |
| `published -> draft` | missing | add (unpublish) | new |
| `open -> closed` (admin) | missing (auto-only) | add (admin close) | new |
| `open -> open` (extend) | n/a (not a status change) | update `closeAt` only | new op |
| `published -> canceled` | missing | add | new state |
| `open -> canceled` | missing | add | new state |
| `canceled -> archived` | missing | add | new state |
| `published -> archived` | present | **keep** | unchanged |
| `closed -> archived` | present | **keep** | unchanged |
| `open -> closed` (auto) | present | keep | unchanged |

**Archive behavior diff (prompt §4.6, "report the diff first"):** current
machine allows `published -> archived` and `closed -> archived` only. Target
adds `canceled -> archived`. We **do not** allow `open -> archived` or
`draft -> archived` (consistent with current).

## Layer 3 — Admin operation API surface

All admin-only (`preHandler: [authenticate, requireRole(["Admin"])]`), all
under `/api/exams/:id`, all return `ExamSchema` (or specific fields noted), all
record audit. Error envelope is the existing `{code,message,requestId,details}`.

### 3.1 `POST /api/exams/:id/publish` — exists, verify

- Allowed: `draft -> published` (and `draft -> open` when `openAt <= now` and
  current behavior already auto-opens — keep as-is).
- Reject: `open|closed|canceled|archived` → `EXAM_ALREADY_PUBLISHED` /
  `INVALID_STATE_TRANSITION` (existing).
- Audit: `exam.publish` (existing).

### 3.2 `POST /api/exams/:id/unpublish` — **new**

- Allowed: `published -> draft`.
- Reject: `draft|open|closed|canceled|archived` → `EXAM_UNPUBLISH_NOT_ALLOWED`.
- Hard rule: **never** `open -> draft`.
- Audit: `exam.unpublish`, metadata `{fromStatus:"published", toStatus:"draft"}`.

### 3.3 `POST /api/exams/:id/close` — **new** (unblocks P2B-J1)

- Body: `{ "reason"?: string }`.
- Allowed: `open -> closed`.
- Idempotency: **200 + current exam, no duplicate audit** when already `closed`
  (chosen to match idempotent-read conventions; see Alternatives).
- Reject: `draft|published|canceled|archived` → `EXAM_CLOSE_NOT_ALLOWED`.
- **Does NOT force-submit active attempts** in this baseline. Closing ends the
  exam lifecycle; in-progress attempts are left to the deadline scanner / future
  proctor force-submit. Documented explicitly.
- Audit: `exam.close`, metadata `{reason?, fromStatus:"open", toStatus:"closed"}`.
- **Expected effect**: after `close`, `examEnded` is true → scores/export
  return 200 (replaces the `endingSoonSec` workaround).

### 3.4 `POST /api/exams/:id/extend` — **new**

- Body (chosen form): `{ "extendMinutes": number, "reason"?: string }`.
  Preferred over `closeAt` to avoid generic PATCH semantics mid-`open`.
- Allowed: `open -> open` (updates `closeAt` only).
- Rules: `extendMinutes` integer > 0; new `closeAt > old closeAt`; new
  `closeAt > now`.
- Reject: `draft|published|closed|canceled|archived` → `EXAM_EXTEND_NOT_ALLOWED`.
- Audit: `exam.extend`, metadata `{extendMinutes, oldCloseAt, newCloseAt, reason?}`.

### 3.5 `POST /api/exams/:id/cancel` — **new**

- Body: `{ "reason": string }` (required).
- Allowed: `published -> canceled`, `open -> canceled`.
- Reject: `draft|closed|canceled|archived` → `EXAM_CANCEL_NOT_ALLOWED`.
- **Does not convert to draft. Does not delete/void attempts.** First
  implementation only flips status + audit + reason.
- Scores/export policy for `canceled`: **least invasive** — `examEnded` is
  satisfied (`status === canceled` counts as ended), so scores/export are
  allowed **admin-only**. Attempt rows carry no special cancellation marker in
  this baseline (future: add `cancellationMarker` to export rows).
- Audit: `exam.cancel`, metadata `{reason, fromStatus, toStatus:"canceled"}`.

> **Fallback if `canceled` churn is too large:** ship 3.2/3.3/3.4 first
> (unpublish/close/extend) and defer `cancel` to a follow-up. The close
> operation alone unblocks P2B-J1. Decision recorded at implementation time.

### 3.6 `POST /api/exams/:id/archive` — exists, verify/extend

- Allowed: `published -> archived`, `closed -> archived`, **`canceled -> archived`** (new).
- Reject: `draft|open|archived` → `INVALID_STATE_TRANSITION` (existing).
- Audit: `exam.archive` (existing).

### 3.7 `PATCH /api/exams/:id` — clarify, keep draft-default

- `draft` → full edit (current).
- `published` → **schedule-only** (`openAt`, `closeAt`) with rules
  `openAt` in future if not yet open, `closeAt > openAt`. (New allowance.)
- `open|closed|canceled|archived` → reject generic PATCH → `EXAM_UPDATE_NOT_ALLOWED`.
  Use the dedicated operations (close/extend).

## Layer 4 — Candidate runtime timing policy

### 4.1 New exam fields

```
latestStartOffsetMinutes : integer | null   (null = disabled)
minSubmitAfterStartMinutes: integer | null   (null = disabled)
```

Validation: `null` or integer `>= 0`. Added across: DB migration + schema
(snake_case `latest_start_offset_minutes`, `min_submit_after_start_minutes`),
`packages/contracts/src/exam.ts` (create/update/response Zod), OpenAPI output.
Admin UI is a **documented follow-up** if it would bloat the PR; **API must be
complete**.

### 4.2 Late-entry cutoff (`latestStartOffsetMinutes`)

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

### 4.3 Minimum manual submit duration (`minSubmitAfterStartMinutes`)

Applies **only** to candidate manual submit:

```
earliestSubmitAt = attempt.startedAt + minSubmitAfterStartMinutes
if source == "candidate" and now < earliestSubmitAt:
  reject -> 409 ATTEMPT_SUBMIT_TOO_EARLY
details: { earliestSubmitAt, remainingSeconds }
```

Must **not** block: `deadline_scanner`, `proctor`, `system` submit sources.

### 4.4 Submit source discriminator (command layer only)

```ts
type SubmitSource = "candidate" | "deadline_scanner" | "proctor" | "system";
```

- **Not** a client-controlled body field. Candidate route hard-codes
  `{ source: "candidate" }`; scanner hard-codes `deadline_scanner`; etc.
- No silent default to `"candidate"` for internal callers — source is explicit
  at the command boundary.

## Error contract (new codes, existing format)

| Code | HTTP | Where |
| --- | --- | --- |
| `EXAM_UNPUBLISH_NOT_ALLOWED` | 409 | unpublish |
| `EXAM_CLOSE_NOT_ALLOWED` | 409 | close |
| `EXAM_EXTEND_NOT_ALLOWED` | 409 | extend |
| `EXAM_CANCEL_NOT_ALLOWED` | 409 | cancel |
| `EXAM_UPDATE_NOT_ALLOWED` | 409 | PATCH non-editable state |
| `ATTEMPT_LATE_ENTRY_CLOSED` | 409 | new startAttempt past cutoff |
| `ATTEMPT_SUBMIT_TOO_EARLY` | 409 | candidate submit before min duration |

All in `packages/contracts/src/messageRegistry.ts` with localized messages
(`packages/domain/src/errors.ts` classes as needed). No second error format.

## Audit events (dot.case, existing helper)

| Action | Trigger | metadata |
| --- | --- | --- |
| `exam.publish` | publish | (existing) |
| `exam.unpublish` | unpublish | `{fromStatus, toStatus}` |
| `exam.close` | close | `{reason?, fromStatus, toStatus}` |
| `exam.extend` | extend | `{extendMinutes, oldCloseAt, newCloseAt, reason?}` |
| `exam.cancel` | cancel | `{reason, fromStatus, toStatus}` |
| `exam.archive` | archive | (existing, extend for `canceled -> archived`) |

`actorId` from `ctx.actorId`; no noisy audit for rejected candidate submits.

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
`exam-detail-extend-btn`, `exam-detail-cancel-btn`. Dialogs: close (reason
optional), extend (`extendMinutes` required), cancel (`reason` required). No
full proctor/session UI in this baseline.

## Implemented now vs future

### This baseline implements (in follow-on Phase 2B/2C jobs)

- `canceled` lifecycle state + transition matrix extension.
- Admin ops: `unpublish`, `close`, `extend`, `cancel`; verify `publish`,
  `archive`; clarify `PATCH`.
- Runtime policy fields `latestStartOffsetMinutes`,
  `minSubmitAfterStartMinutes` + the two guards.
- `SubmitSource` discriminator.
- New error codes + audit events.
- Minimal admin UI controls with testids.

### Future / explicitly NOT this baseline

(Phase 2C+ proctor runtime and beyond.)

- `pause` / `resume` exam (a live hold distinct from `cancel`).
- Per-candidate device replacement / rebind.
- Account unlock / session reset.
- Machine preflight checks.
- Proctor force-submit (closes an **attempt**, not the exam; separate from
  admin `close`).
- Attempt invalidation (uses existing `voided` status; needs its own op).
- Automatic force-submit of active attempts on exam `close` (deferred; close
  ends the lifecycle only).
- Result publishing workflow / provisional-vs-final score visibility.
- Live/provisional score monitor.
- Additional lifecycle states: `paused`, `suspended`, `result_published`,
  `force_closed` — documented as future only; not added now.

## P2B-J1 findings this baseline fixes

| Finding | Fixed by |
| --- | --- |
| No deterministic admin close for an `open` exam (scores/export stuck on 409) | `POST /api/exams/:id/close` (§3.3) — `examEnded` becomes true, replacing the `endingSoonSec` workaround. |
| `PATCH /exams/:id` is draft-only, so schedules can't be adjusted after publish | `PATCH` schedule-edit for `published` (§3.7) + `extend` for `open` (§3.4). |
| No minimum manual submit duration | `minSubmitAfterStartMinutes` + `ATTEMPT_SUBMIT_TOO_EARLY` (§4.3). |
| No late-entry cutoff | `latestStartOffsetMinutes` + `ATTEMPT_LATE_ENTRY_CLOSED` (§4.2). |
| Admin full-loop E2E blocked | Resumes once close + timing policy land; no `endingSoonSec` workaround remains. |
| (Out of scope here, separate fix) Admin pages lacked `data-testid` | Captured in the spike commit; new UI controls here use stable testids by default. |

## Boundary / non-collision with existing Phase 2C jobs

This baseline operates on the **exam lifecycle** axis. It must not collide
with the per-**attempt** proctor operations already scoped in Phase 2C. The
distinction is explicit and binding:

| Operation | Entity / field | Axis | Owner job | Collides with this ADR? |
| --- | --- | --- | --- | --- |
| `POST /api/exams/:id/extend` (§3.4) | `Exam.closeAt` | **exam window** (all candidates) | **this ADR (P2B)** | no — different axis |
| `POST /api/admin/attempts/:id/extend-time` | `ExamAttempt.deadlineAt` | **per-attempt** | **P2C-J3** | no — per-candidate |
| `POST /api/admin/attempts/:id/force-submit` | attempt submit | **per-attempt** | **P2C-J2** | no — closes one attempt, not the exam |
| `POST /api/exams/:id/close` (§3.3) | `Exam.status` open→closed | **exam lifecycle** | **this ADR (P2B)** | no |

**Naming**: the verb "extend" is overloaded. `exam.extend` (here) extends the
**exam window**; `attempt.extendTime` (P2C-J3) extends a **candidate's
deadline**. The two API paths (`/exams/:id/extend` vs
`/admin/attempts/:id/extend-time`) and audit actions (`exam.extend` vs
`attempt.extendTime`) are kept distinct to avoid ambiguity.

**Force-submit boundary**: P2C-J2 force-submits a single attempt. This ADR's
`exam.close` ends the **exam lifecycle** and does **not** submit attempts. The
two are independent: a closed exam may still have `in_progress`/`disrupted`
attempts (left to the deadline scanner or a future P2C-J2 force-submit). This
is why "automatic force-submit on close" is deferred to a future op.

## Alternatives considered

- **Idempotency for `close`**: 200 + current exam (chosen) vs 409-with-reason.
  Chose 200 to match idempotent read conventions and avoid flaky double-click
  errors in the admin UI.
- **Extend body shape**: `extendMinutes` (chosen, explicit op) vs absolute
  `closeAt` (rejected — smells like generic PATCH mid-`open`).
- **Cancel in first cut**: include vs defer. Included but with a documented
  fallback to defer if the new state causes broad churn.
- **Force-submit on close**: rejected for this baseline — proctor/admin
  force-submit is a separate future op touching **attempts**, not the exam
  lifecycle.
- **`submit source` as a body field**: rejected — source is a command-layer
  discriminator, never client-controlled, to prevent bypassing the early-submit
  guard.

## Consequences

- Positive: one authority for exam operation semantics; P2B-J1 E2E unblocks;
  P2C proctor runtime has a stable base; clear error codes + audit trails.
- Negative: one new lifecycle state (`canceled`) touches enums, state machine,
  contracts, OpenAPI, and admin UI — non-trivial but contained.
- Neutral: Redis/WS/queue/Desktop ADRs stay `Deferred`; this baseline is
  HTTP-polling + synchronous writes + DB-backed scanner, consistent with
  single-instance Phase 2 deployment.

## Open questions for review

1. Confirm `canceled` (US spelling) is acceptable despite the prompting spec
   writing `cancelled`. (Codebase strongly favors US.)
2. Confirm the `close` idempotency choice (200 vs 409).
3. Confirm scores/export policy for `canceled` exams (allow admin-only, no
   cancellation marker in rows) vs reject outright.
4. Confirm `extendMinutes` (relative) over absolute `closeAt`.
5. Confirm scope split: ship close first (unblocks P2B-J1), defer cancel/extend
   if needed — or land all four together.
