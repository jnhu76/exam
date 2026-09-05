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

## Authority precedence

Architecture authority originates from an explicit human-approved decision;
an ADR is the durable record of that authority. When sources disagree, use the
following precedence order:

1. **Explicit human-approved decision in the current review**, provided the
   decision is recorded as an ADR acceptance, amendment, revision, or
   supersession before implementation proceeds.
2. **Latest ACCEPTED amendment or revision** that explicitly changes an ADR.
3. **Current ACCEPTED ADR** that has not been superseded or amended for the
   disputed decision.
4. **Current architecture / specification documentation** (`docs/architecture/`,
   `SPEC`, contracts, or equivalent current normative documentation).
5. **As-built implementation and tests**, which establish runtime reality but
   do not silently redefine architecture authority.
6. **Issues, roadmaps, audits, closeout reports, and historical records**, which
   provide evidence and provenance but are not architecture authority by
   themselves.

Binding rules:

- A newer ADR number does **not** implicitly supersede an older ADR.
- An ACCEPTED ADR changes only through an explicit human-approved ACCEPTED
  amendment, revision, or superseding ADR. The relationship must identify the
  affected ADR and decision; chronological order alone is insufficient.
- Code or test divergence does **not** implicitly supersede an ADR. It is an
  as-built delta that requires disposition.
- `PROPOSED` and `DEFERRED` ADRs are not binding implementation authority for
  current runtime behavior. They may constrain future work only as their status
  explicitly states.
- Historical or acceptance-time facts retained inside an ADR are evidence, not
  current normative requirements, unless the ADR explicitly marks them as
  binding decisions or invariants.
- If two ACCEPTED ADRs conflict and no explicit amendment / supersession /
  precedence relation resolves the disputed decision, the result is
  **AUTHORITY CONFLICT — HUMAN DISPOSITION REQUIRED**. Do not guess based on ADR
  number, file date, code age, or implementation convenience.
- An implementation audit must report `ADR says X / as-built says Y` as a delta
  first. It must not automatically "fix" either side until the decision owner
  chooses one of: keep ADR and fix implementation; accept implementation and
  amend/supersede the ADR; or redesign both.

This precedence governs ADR review and ADR-to-implementation conformance work.

## Index

| ID | Title | Status | Current / Historical | Supersedes | Superseded by |
| --- | --- | --- | --- | --- | --- |
| [ADR-001](ADR-001-redis.md) | Redis as Optional Infrastructure | ACCEPTED (baseline; shared rate-limiting adoption amended 2026-08-08) / DEFERRED (full adoption) | Current | none | none |
| [ADR-002](ADR-002-websocket-sse.md) | WebSocket / SSE for Real-Time Updates | DEFERRED | Current | none | none |
| [ADR-003](ADR-003-job-queue.md) | Job Queue for Async / Long-Running Workloads | ACCEPTED (queue classification/adoption policy, amended 2026-09-05) / DEFERRED (general-purpose job-queue platform) | Current | none | none |
| [ADR-004](ADR-004-desktop-electron.md) | Desktop / Electron Exam Runtime | DEFERRED | Current | none | none |
| [ADR-005](ADR-005-exam-operation-state-baseline.md) | Exam Operation State Baseline | ACCEPTED (implemented, Rev 2) | Current | none | none |
| [ADR-006](ADR-006-exam-time-authority.md) | Exam Time Authority | ACCEPTED (amended 2026-07-21) | Current | none | none |
| [ADR-007](ADR-007-stateful-infrastructure-test-isolation.md) | Stateful Infrastructure Test Isolation | ACCEPTED (infrastructure implemented, Phase 6G/7 deferred) | Current | none | none |
| [ADR-008](ADR-008-submit-answer-freeze.md) | Submit Answer Freeze Barrier | ACCEPTED (Phase 2 conservative) | Current | none | none |
| [ADR-009](ADR-009-frontend-state-machine-adoption.md) | Frontend State Machine Adoption | PROPOSED (pending human audit) | Current | none | none |
| [ADR-010](ADR-010-scoped-rbac-architecture.md) | Phase 3 Scoped RBAC Architecture | ACCEPTED (infrastructure implemented) | Current | none | none |
| [ADR-011](ADR-011-notification-and-email-delivery.md) | Notification Inbox and Email Delivery Architecture | ACCEPTED (2026-07-25, P5-N1-R0) | Current | none | none |
| [ADR-012](ADR-012-candidate-recovery-contract.md) | Candidate Recovery Contract and Threat Model | ACCEPTED | Current | none | none |
| [ADR-013](ADR-013-interruption-time-compensation-policy.md) | Interruption Detection and Time-Compensation Policy | ACCEPTED | Current | ADR-012's incomplete time-policy direction | none |
| [ADR-014](ADR-014-exam-incident-authority.md) | Exam Incident Authority | ACCEPTED (runtime implemented — J3, PR #242; Admin recovery center J5 closed) | Current | none | none |
| [ADR-015](ADR-015-proctor-exam-scope-authority.md) | Proctor-to-Exam Resource Scope Authority | ACCEPTED (runtime implemented — J4-I1, PR #250) | Current | none | none |
| [ADR-016](ADR-016-future-offline-resilient-client-data-and-recovery-model.md) | Future Offline-Resilient Client Data and Recovery Model | DEFERRED | Current | none | none |
| [ADR-017](ADR-017-operational-authority-maintainer-boundary.md) | Operational Authority and Maintainer Boundary | **ACCEPTED through revision 4** (rev 1–3: 2026-08-12, PR #281 — Hybrid Maintainer Model + Admin↔Maintainer mutual exclusion; rev 4: ACCEPTED 2026-08-14, P7 final program closeout — Maintainer = read-only Operational Observer; Configurer does not exist; ops policy = reliability objective; D5 tightened) | Current | none | none |
| [ADR-018](ADR-018-operational-observability-window.md) | Operational Observability Window | **ACCEPTED** (2026-08-14, P7 final program closeout — read-only runtime-data contract: read-only / redacted / domain-separated / bounded / source-aware / truthful; Metrics/Logs/Events/Materials taxonomy) | Current | none | none |
| [ADR-019](ADR-019-content-document-model.md) | Content Document Model: Dual-Mode Question Content and Rich Answer Authority | PROPOSED (pending human audit) | Current | none | none |

## Numbering

ADR numbers are stable and never reused. The next free number is **ADR-020**.
Two files previously in `docs/adr/` used the `ADR-007` prefix
(`ADR-007-flake-and-speed-audit.md`, `ADR-007-phase6-evidence-gap-audit.md`)
but were **audit reports about** ADR-007, not ADRs themselves — they have been
moved to [`docs/archive/audits/`](../archive/audits/). The genuine ADR-007 is
`ADR-007-stateful-infrastructure-test-isolation.md`.
