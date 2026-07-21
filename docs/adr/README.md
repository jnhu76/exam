# Architecture Decision Records — Index

> Each ADR carries an explicit `Status` field in its own file. This index
> summarizes statuses for navigation. Status labels are the authority; file
> age or location is not.

```text
STATUS:          CURRENT
AUTHORITY:        Index
SCOPE:            docs/adr/ decision records
OWNER:            Architecture
LAST VERIFIED:    2712c01 — statuses read verbatim from each ADR file
SUPERSEDES:       —
RELATED ADRS:     ADR-001 through ADR-009 (see table)
```

## Status legend

- **Accepted** — decision is binding and reflected in code.
- **Accepted (amended)** — binding, with a later corrective section that
  supersedes part of the original text (the original is retained as history).
- **Deferred** — a real decision recorded now; adoption is gated on stated
  trigger conditions. Deferred ADRs are **not** archived.
- **Proposed** — recorded proposal, pending acceptance. Not yet binding.
- **Superseded** — replaced by a later ADR. Retained for history.

## ADR index

| ADR | Title | Status | Note |
|-----|-------|--------|------|
| [ADR-001](ADR-001-redis.md) | Redis as Optional Infrastructure | **Accepted** (baseline) / **Deferred** (full adoption) | Optional baseline wired; no business feature depends on Redis. Full adoption gated on a measured trigger. Not archived. |
| [ADR-002](ADR-002-websocket-sse.md) | WebSocket / SSE for Real-Time Updates | **Deferred** | Phase 2 proctor dashboard uses HTTP polling. WS/SSE revisited only if polling latency is operationally insufficient. |
| [ADR-003](ADR-003-job-queue.md) | Job Queue for Async / Long-Running Workloads | **Deferred** | No queue in Phase 2; all work synchronous/request-scoped. PostgreSQL-backed in-process worker is the first adoption path. |
| [ADR-004](ADR-004-desktop-electron.md) | Desktop / Electron Exam Runtime | **Deferred** | `apps/desktop/` not started; `controlFlags.requireLockdown` schema-only. Future Desktop must reuse the server-side exam protocol. |
| [ADR-005](ADR-005-exam-operation-state-baseline.md) | Exam Operation State Baseline | **Accepted** (implemented, Rev 2) | Three-axis state model; lock-reconcile-assert-mutate transaction rule; close/cancel/unpublish/extend/archive implemented. |
| [ADR-006](ADR-006-exam-time-authority.md) | Exam Time Authority | **Accepted** (amended 2026-07-21) | `fastify.now()` is the single runtime clock. 2026-07-21 amendment binds the audit durability contract; the prior broad audit amendment is retained as history and superseded by the amendment section. |
| [ADR-007](ADR-007-stateful-infrastructure-test-isolation.md) | Stateful Infrastructure Test Isolation | **Proposed** (documentation-only) | Long-term test-resource isolation contract. Phases 2A–6F mostly complete (local/test evidence); Phase 6G live-CI validation and Redis/Queue-prefix integration deferred. The two former ADR-007 audit companions (`flake-and-speed-audit`, `phase6-evidence-gap-audit`) have been moved to `docs/archive/dev/`. |
| [ADR-008](ADR-008-submit-answer-freeze.md) | Submit Answer Freeze Barrier | **Accepted** (Phase 2 conservative) | `submitAndGradeAttempt` collapsed into a single transaction under the row lock. Option D (WYSIWYG submit) deferred to Phase 3. |
| [ADR-009](ADR-009-frontend-state-machine-adoption.md) | Frontend State Machine Adoption Strategy | **Proposed** | Incremental FSM adoption (reducer + transition table, no XState/Zustand in Phases A–C). `CandidateExamMachine` first. Pending human audit. |

## ADRs that must not be archived

ADR-001, ADR-004, and ADR-009 record real (even if deferred or proposed)
decisions. They are **not** archived regardless of status; only their `Status`
field is updated when the decision changes. Archiving a deferred decision
loses context.

## Numbering note

There is exactly one file per ADR number under `docs/adr/`. The historical
ADR-007 trio (one governing ADR + two audit-companion reports) has been
collapsed: the two companions were moved to `docs/archive/dev/`, leaving
`ADR-007-stateful-infrastructure-test-isolation.md` as the sole ADR-007.
