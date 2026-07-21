# Architecture Decision Records

> Formal architectural decisions. Each ADR records a concrete problem,
> alternatives considered, the decision, its consequences, and a status.
> An ADR is **not** an audit report, implementation report, corrective review,
> or evidence-gap analysis — those live in [`docs/archive/`](../archive/).

## How to read an ADR

Every ADR carries this metadata (in its Status section or header):

```markdown
- Status: ACCEPTED | PROPOSED | DEFERRED | SUPERSEDED | REJECTED
- Date: YYYY-MM-DD
- Decision owners: project
- Supersedes: ADR-NNN or none
- Superseded by: ADR-NNN or none
```

- **ACCEPTED** — the decision is binding and (where applicable) implemented.
- **PROPOSED** — the decision is recorded but not yet accepted; implementation
  may not have begun or may be partial.
- **DEFERRED** — the decision is to *not* build the thing now; revisited on a
  documented trigger.
- **SUPERSEDED** — replaced by a later ADR (see `Superseded by`).
- **REJECTED** — considered and not adopted.

## Index

| ID | Title | Status | Current / Historical | Supersedes | Superseded by |
| --- | --- | --- | --- | --- | --- |
| [ADR-001](ADR-001-redis.md) | Redis as Optional Infrastructure | ACCEPTED (baseline) / DEFERRED (full adoption) | Current | none | none |
| [ADR-002](ADR-002-websocket-sse.md) | WebSocket / SSE for Real-Time Updates | DEFERRED | Current | none | none |
| [ADR-003](ADR-003-job-queue.md) | Job Queue for Async / Long-Running Workloads | DEFERRED | Current | none | none |
| [ADR-004](ADR-004-desktop-electron.md) | Desktop / Electron Exam Runtime | DEFERRED | Current | none | none |
| [ADR-005](ADR-005-exam-operation-state-baseline.md) | Exam Operation State Baseline | ACCEPTED (implemented, Rev 2) | Current | none | none |
| [ADR-006](ADR-006-exam-time-authority.md) | Exam Time Authority | ACCEPTED (amended 2026-07-21) | Current | none | none |
| [ADR-007](ADR-007-stateful-infrastructure-test-isolation.md) | Stateful Infrastructure Test Isolation | PROPOSED (long-term constraint) | Current | none | none |
| [ADR-008](ADR-008-submit-answer-freeze.md) | Submit Answer Freeze Barrier | ACCEPTED (Phase 2 conservative) | Current | none | none |
| [ADR-009](ADR-009-frontend-state-machine-adoption.md) | Frontend State Machine Adoption | PROPOSED (pending human audit) | Current | none | none |
| [ADR-010](ADR-010-scoped-rbac-architecture.md) | Phase 3 Scoped RBAC Architecture | ACCEPTED (infrastructure implemented) | Current | none | none |

## Numbering

ADR numbers are stable and never reused. The next free number is **ADR-011**.
Two files previously in `docs/adr/` used the `ADR-007` prefix
(`ADR-007-flake-and-speed-audit.md`, `ADR-007-phase6-evidence-gap-audit.md`)
but were **audit reports about** ADR-007, not ADRs themselves — they have been
moved to [`docs/archive/audits/`](../archive/audits/). The genuine ADR-007 is
`ADR-007-stateful-infrastructure-test-isolation.md`.
