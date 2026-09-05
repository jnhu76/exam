# Architecture Decision Records

> Formal architectural decisions. Each ADR records a concrete problem,
> alternatives considered, the decision, its consequences, and a status.
> An ADR is **not** an audit report, implementation report, corrective review,
> or evidence-gap analysis — those live in [`docs/archive/`](../archive/).

This README is the **navigation map for the ADR set**. Individual ADRs own
specific decisions; this file explains how those decisions are grouped and how
to read them together.

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

An ADR file may contain more than one explicitly scoped decision with different
statuses (for example, an ACCEPTED classification policy while a particular
platform adoption remains DEFERRED). In that case the scope/status pair must be
stated explicitly; do not infer one file-wide status from chronology alone.

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

## Architecture map

The ADR set is organized by **primary architectural responsibility**, not by
number. The shape is intentionally closer to a small dependency graph than a
single chronological list.

```text
Architecture decisions
|
+-- A. Platform & runtime foundations
|   +-- ADR-001 Redis / optional infrastructure
|   +-- ADR-002 real-time transport
|   +-- ADR-003 async / queue classification
|   +-- ADR-004 desktop runtime
|   `-- ADR-007 stateful-infrastructure test isolation
|
+-- B. Exam execution & correctness core
|   +-- ADR-005 exam lifecycle / operation state
|   +-- ADR-006 time authority
|   `-- ADR-008 submit answer freeze barrier
|
+-- C. Recovery, incident & proctoring
|   +-- ADR-012 candidate recovery contract
|   +-- ADR-013 interruption / time compensation
|   +-- ADR-014 exam incident authority
|   `-- ADR-015 proctor-to-exam scope authority
|
+-- D. Authorization & operations
|   +-- ADR-010 scoped RBAC
|   +-- ADR-017 operational authority / maintainer boundary
|   `-- ADR-018 operational observability window
|
`-- E. Application, client & content evolution
    +-- ADR-009 frontend state-machine adoption
    +-- ADR-011 notification / email delivery
    +-- ADR-016 future offline-resilient client
    `-- ADR-019 content document model
```

**Important:** grouping is navigation, not precedence. It does not create a
`supersedes`, `amends`, or `depends on` relationship. Cross-group dependencies
must be stated explicitly in the affected ADRs. An ADR has one primary group in
this README so the map stays readable, but another group's ADR may still depend
on or specialize it.

### A. Platform & runtime foundations

These ADRs answer which supporting infrastructure or runtime mechanisms may be
introduced and under what constraints. They should not silently take ownership
of exam-domain truth.

| ADR | Primary responsibility | Current status summary |
| --- | --- | --- |
| [ADR-001](ADR-001-redis.md) | Redis responsibility boundary and deployment semantics | ACCEPTED baseline/shared rate limiting; broader adoption scoped separately |
| [ADR-002](ADR-002-websocket-sse.md) | Polling vs SSE/WebSocket real-time transport | DEFERRED |
| [ADR-003](ADR-003-job-queue.md) | Queue/workload classification and adoption boundary | ACCEPTED policy; general-purpose job platform DEFERRED |
| [ADR-004](ADR-004-desktop-electron.md) | Desktop/Electron runtime adoption | DEFERRED |
| [ADR-007](ADR-007-stateful-infrastructure-test-isolation.md) | Isolation/lifecycle rules for stateful infrastructure in tests | ACCEPTED core; later phases partly deferred |

### B. Exam execution & correctness core

These ADRs define the smallest core protocol needed to reason about an exam and
an attempt correctly. Later recovery/proctoring decisions should specialize
this core rather than redefine it implicitly.

| ADR | Primary responsibility | Current status summary |
| --- | --- | --- |
| [ADR-005](ADR-005-exam-operation-state-baseline.md) | Exam lifecycle/state transitions and admin operation baseline | ACCEPTED |
| [ADR-006](ADR-006-exam-time-authority.md) | Canonical exam/attempt time authority | ACCEPTED, amended |
| [ADR-008](ADR-008-submit-answer-freeze.md) | Submit/save serialization and answer freeze boundary | ACCEPTED |

### C. Recovery, incident & proctoring

These ADRs cover what happens when a normal exam path is interrupted or an
operator/proctor must intervene. They are expected to consume the lifecycle,
time, submit, and authorization authorities rather than duplicate them.

| ADR | Primary responsibility | Current status summary |
| --- | --- | --- |
| [ADR-012](ADR-012-candidate-recovery-contract.md) | Candidate recovery contract and threat model | ACCEPTED |
| [ADR-013](ADR-013-interruption-time-compensation-policy.md) | Interruption detection and time-compensation policy | ACCEPTED; explicitly supersedes part of ADR-012's time direction |
| [ADR-014](ADR-014-exam-incident-authority.md) | Incident authority and recovery evidence | ACCEPTED |
| [ADR-015](ADR-015-proctor-exam-scope-authority.md) | Proctor-to-exam resource scope | ACCEPTED |

### D. Authorization & operations

These ADRs govern who may exercise authority and what operational information
may be observed. They are cross-cutting constraints on domain/runtime features.

| ADR | Primary responsibility | Current status summary |
| --- | --- | --- |
| [ADR-010](ADR-010-scoped-rbac-architecture.md) | Capability + resource-scope authorization | ACCEPTED |
| [ADR-017](ADR-017-operational-authority-maintainer-boundary.md) | Operational role/maintainer authority boundary | ACCEPTED through revision 4 |
| [ADR-018](ADR-018-operational-observability-window.md) | Read-only operational observability contract | ACCEPTED |

### E. Application, client & content evolution

These ADRs add product/client capabilities around the exam core. Some remain
future proposals and therefore must not be treated as current runtime authority.

| ADR | Primary responsibility | Current status summary |
| --- | --- | --- |
| [ADR-009](ADR-009-frontend-state-machine-adoption.md) | Frontend state-machine adoption | PROPOSED |
| [ADR-011](ADR-011-notification-and-email-delivery.md) | Inbox notification and asynchronous email delivery | ACCEPTED |
| [ADR-016](ADR-016-future-offline-resilient-client-data-and-recovery-model.md) | Future offline-resilient client | DEFERRED |
| [ADR-019](ADR-019-content-document-model.md) | Rich content/document authority model | PROPOSED |

## Recommended reading paths

These are **navigation paths, not authority precedence**.

- **Exam correctness:** ADR-005 -> ADR-006 -> ADR-008 -> ADR-012 -> ADR-013 -> ADR-014.
- **Proctor / scoped intervention:** ADR-010 -> ADR-015, then the relevant exam
  lifecycle/time/recovery ADRs.
- **Infrastructure choices:** ADR-001 -> ADR-003 -> ADR-007; consult ADR-002 or
  ADR-004 only when their adoption triggers are relevant.
- **Operational surface:** ADR-010 -> ADR-017 -> ADR-018.
- **Client/content evolution:** ADR-009 / ADR-016 / ADR-019 according to the
  capability being designed; ADR-011 is the current notification/delivery
  specialization.

## ADR structure and optimization rules

The target is **small decisions connected by explicit relationships**, not one
large ADR accumulating every later feature.

1. **One ADR, one primary decision.** If a section can change independently
   without changing the ADR's core decision, prefer a separate ADR or move the
   current-system description to architecture documentation.
2. **README owns the global map; an ADR owns its local decision.** Do not copy a
   neighboring ADR's complete decision into another ADR merely for convenience.
3. **State relationships explicitly.** Use clear terms such as `depends on`,
   `specializes`, `amends`, or `supersedes`; chronology and ADR numbers are not
   relationships.
4. **Keep the current binding decision easy to find.** Acceptance-time facts,
   old slices, rollout notes, and superseded wording may remain as historical
   evidence only when clearly marked non-normative.
5. **Prefer architecture docs for current as-built explanation.** ADRs explain
   why and what was decided; `docs/architecture/` explains how the current
   system works as a whole.
6. **Do not merge independent state axes.** A later feature should consume the
   authority of lifecycle/time/attempt/authz decisions instead of growing one
   mega-state-machine unless an explicit redesign is accepted.
7. **Split before generalizing.** Optimize individual ADRs first. Only after
   each member of a group is audited should the group itself be consolidated or
   restructured.

## Review sequence for this ADR set

The ADR cleanup follows this order:

```text
1. Global map / grouping          <- this README
2. Audit and optimize one ADR at a time
3. Reconcile relationships inside each group
4. Reconcile cross-group dependencies / conflicts
5. Only then consider splitting, merging, or introducing new root ADRs
```

This sequence prevents a group-level rewrite from silently deciding unresolved
individual ADR conflicts.

## Numeric index

The numeric index remains the stable lookup table. Grouping above does not
renumber or relocate ADRs.

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
