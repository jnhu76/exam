# P2B-J0 — Exam Operation State Baseline (ADR)

> **Authority**: `docs/adr/ADR-005-exam-operation-state-baseline.md` (Proposed, Revision 2).
> This job card registers the ADR into the Phase 2B workflow. It produces
> **design only** — no production code until the ADR is reviewed and approved.
> Implementation is sliced 1–4 (Slice 1 = close baseline, unblocks P2B-J1;
> Slice 2 = unpublish/schedule/extend; Slice 3 = timing policy; Slice 4 =
> cancel, deferred).

## 1. Summary

Establish the exam operation state baseline (lifecycle + attempt + session
model, admin operation surface, runtime timing policy) as a single design
authority before any production hardening. Unblocks the paused P2B-J1 admin
full-loop E2E.

## 2. Job Classification

```txt
[x] docs-only planning job
[ ] OpenAPI / contract job
[ ] backend state-machine job
[ ] backend API / route job
[ ] DB / repository / transaction job
[ ] frontend UI job
[ ] E2E / regression job
[x] infra ADR job
```

## 3. Problem / Gap

- Current behavior: P2B-J1 admin-loop E2E is blocked because there is no
  deterministic admin operation to close an open exam; scores/export gate on
  `examEnded`; there is no min-submit / late-entry policy.
- Impact: Admin cannot end an exam on demand; candidate timing controls are
  absent; piecemeal fixes (e.g. `endingSoonSec` workaround) would create
  incoherent semantics.
- Discovery source: P2B-J1 spike (commit `61ad5c9`); `docs/phase2/phase2.plan.md:297`.
- Why this must be fixed now: P2B-J2 (hardening) and P2C (proctor runtime)
  both depend on a stable exam operation model.

## 4. Runtime Decision Gate Closed

```txt
[ ] 1. Candidate can complete a full exam
[ ] 2. Disconnection / refresh / deadline / duplicate actions are safe
[ ] 3. Admin can complete setup -> assignment -> publish -> result -> export
[ ] 4. Every frontend button has backend route
[ ] 5. Every backend API has frontend entry or backend-only reason
[x] 6. Docs / OpenAPI / code / E2E are aligned
[ ] 7. State machine is server-enforced
[ ] 8. Infra/Desktop solves real pain instead of premature complexity
```

## 5. User Flow Closed

Design-only; defines the admin operation + runtime policy model. See ADR-005
§Layer 3 (admin ops) and §Layer 4 (timing policy).

## 6. Current Behavior

`ExamStatus = {draft, published, open, closed, archived}`. `openExam`/
`closeExam` exist but no route calls `closeExam`. `PATCH /exams/:id` is
draft-only. No `unpublish`, `extend`, `cancel`. No `latestStartOffsetMinutes`/
`minSubmitAfterStartMinutes`. No submit-source discriminator.

## 7. Target Behavior

Per ADR-005: 6 lifecycle states (add `canceled`), full transition matrix,
admin ops (`publish`/`unpublish`/`close`/`extend`/`cancel`/`archive`/`PATCH`),
runtime policy fields + guards, submit-source type, new error codes + audit
events. No new infra (Redis/WS/queue) — see Related ADRs.

## 8. Scope

This job may modify:

```txt
docs/adr/ADR-005-exam-operation-state-baseline.md
docs/phase2/jobs/P2B-J0-*.md
docs/phase2/jobs/phase2_job_index.md
docs/phase2/phase2.plan.md (cross-reference only, no scope change)
```

## 9. Non-Scope

This job must not modify:

```txt
Any production code (packages/, apps/) — design only.
```

## 10. Dependencies

```txt
Depends on: P2B-J1 (spike findings), P2A-J4 (open/close semantics)
Blocks: P2B-J2 (split J2a/J2b/J2c consume this baseline)
Can run in parallel with: nothing (it is the gating design)
```

## 11. Construction Locations

| Layer | Files / Modules | Expected Change |
| --- | --- | --- |
| docs | `docs/adr/ADR-005-*.md` | New ADR (Proposed) |
| docs | `docs/phase2/jobs/P2B-J0-*.md` | This card |
| docs | `docs/phase2/jobs/phase2_job_index.md` | Register P2B-J0 |

## 12. Backend Contract Trace

See ADR-005 §Layer 3 (API surface) and §Error contract.

## 13. API / Contract Changes

**Design only.** Approved changes land in follow-on jobs:
`POST /exams/:id/{unpublish,close,extend,cancel}`; verify `publish`/`archive`;
clarify `PATCH`; new fields `latestStartOffsetMinutes`/`minSubmitAfterStartMinutes`;
`SubmitSource` type.

## 14. Error Contract

**Design only.** New codes (ADR-005 §Error contract):
`EXAM_UNPUBLISH_NOT_ALLOWED`, `EXAM_CLOSE_NOT_ALLOWED`,
`EXAM_EXTEND_NOT_ALLOWED`, `EXAM_CANCEL_NOT_ALLOWED`, `EXAM_UPDATE_NOT_ALLOWED`,
`ATTEMPT_LATE_ENTRY_CLOSED`, `ATTEMPT_SUBMIT_TOO_EARLY`.

## 15. State Machine Contract

**Design only.** Transition matrix in ADR-005 §Layer 2. Mandatory
**lock-reconcile-assert-mutate** rule across every admin op (ADR §Mandatory
transaction rule). Stale-state protection on `unpublish`/`extend`. Close
active-attempt guard (`ACTIVE_ATTEMPTS_EXIST`). `canceled` + `cancel` op
**deferred** (Slice 4). Reject `open/closed/canceled->draft`,
`archived->any`, `draft/open->archived`.

## 16. Command / Repository Boundary

**Design only.** New commands: `unpublishExam`, `closeExam` (route-backed, not
just the engine helper), `extendExam`, `cancelExam`; `submitAttempt(..., {source})`.

## 17. DB / Transaction / Locking Plan

**Design only.** Two nullable integer columns
(`latest_start_offset_minutes`, `min_submit_after_start_minutes`). No locking
changes for the admin ops (single-row status updates).

## 18. Concurrency / Idempotency / Race Cases

`close` is idempotent (200 + current exam when already closed). `extend`
rejects non-positive `extendMinutes` and `closeAt <= now`. Submit guards are
source-gated to not block the deadline scanner.

## 19. Frontend UX States

**Design only.** Minimal controls per ADR-005 §Admin UI, with stable
`data-testid`s. Full proctor/session UI deferred.

## 20. Audit / Security / RBAC

All new ops Admin-only (`requireRole(["Admin"])`). Audit actions dot.case:
`exam.unpublish`, `exam.close`, `exam.extend`, `exam.cancel`; extend
`exam.archive` for `canceled->archived`. `actorId` from `ctx`; from/to/reason
in `metadata`.

## 21. Seed Impact

No seed change.

## 22. Tests

| Type | Required Test |
| --- | --- |
| design | ADR review checklist (§Open questions) |

Implementation tests land in the consuming jobs (P2B-J2a/b/c).

## 23. Acceptance Criteria

```txt
[x] ADR-005 (Rev 2) written with three-axis model, state matrix, mandatory
    lock-reconcile-assert-mutate rule, close active-attempt policy, stale-state
    protection, runtime policy validation, and submitAttempt guard ordering.
[x] cancel deferred (Slice 4); cancel semantics (voiding + export marker)
    left as an explicit open question.
[x] Boundary with P2C-J2 (force-submit) and P2C-J3 (per-attempt extend-time) documented.
[x] Implementation sliced 1–4; Slice 1 (close) is the P2B-J1 unblocker.
[x] Convention conflicts resolved (canceled spelling; audit dot.case).
[x] P2B-J1 findings mapped to fixes.
[x] No production code changed.
[x] Job index updated.
```

## 24. Regression Risks

- Risk 1: reviewers may want `cancel` deferred (see ADR fallback).
- Risk 2: audit-action naming (dot.case) may be revisited — defer to ADR review.

## 25. Rollback / Compatibility

Design-only; rollback = revert this ADR + card. No runtime impact.

## 26. PR Boundaries

Docs + ADR + job index only.

## 27. Review Guardrails

Must not approve production implementation in this PR. Must confirm the 5 open
questions in ADR-005 before opening implementation jobs.

## 28. Verification Commands

```bash
# docs-only; no build/test gates beyond markdown sanity
pnpm format:check
```

## 29. Final Report Requirements

```txt
1. Modified files: ADR-005, this card, phase2_job_index.md
2. Behavior changed: none (design)
3. Behavior explicitly not changed: all production code
4. API / contract changes: none (design only)
5. State-machine changes: none (design only)
6. DB / migration changes: none (design only)
7. Tests added/updated: none
8. Verification commands and results: pnpm format:check passed
9. Remaining risks or follow-ups: resolve ADR-005 open questions, then split P2B-J2
```
