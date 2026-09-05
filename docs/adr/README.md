# Architecture Decision Records

> ADRs record durable architecture decisions. They are not implementation
> reports, audits, closeout notes, or roadmaps; those belong in
> [`docs/archive/`](../archive/) or the relevant planning area.

This README is the **global navigation and governance map** for the ADR corpus.
An individual ADR owns one primary decision; this file explains how ADRs are
grouped, how they relate, and in what order the corpus is being cleaned up.

## Document roles

Use the documents for different jobs:

| Document | Owns |
| --- | --- |
| `docs/adr/README.md` | Global ADR map, status vocabulary, authority precedence, relationship vocabulary, review order |
| Individual ADR | One primary architecture decision, its invariants, consequences, and explicit relationships |
| `docs/architecture/` / contracts / SPEC | Current whole-system normative explanation |
| Issues / roadmaps / plans | Work tracking and implementation sequencing |
| `docs/archive/` | Historical evidence, audits, closeouts, superseded implementation context |

Do not turn an ADR into a running project diary. If a section can change
independently without changing the ADR's primary decision, prefer a separate ADR
or current architecture documentation.

## Status vocabulary

Every ADR should state its status clearly:

- **ACCEPTED** — binding architecture decision.
- **PROPOSED** — recorded for review; not yet binding.
- **DEFERRED** — explicit decision not to adopt/implement now; revisit only on
  its trigger.
- **SUPERSEDED** — replaced for the stated scope by another accepted decision.
- **REJECTED** — considered and not adopted.

A file may contain explicitly scoped decisions with different statuses. For
example ADR-003 has an ACCEPTED classification/adoption policy while a generic
job-queue platform remains DEFERRED. Scope must be explicit; chronology alone
never determines status.

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
  first. It must not automatically fix either side until the decision owner
  chooses one of: keep ADR and fix implementation; accept implementation and
  amend/supersede the ADR; or redesign both.

## Relationship vocabulary

The ADR corpus is a small **directed decision graph**, not a chronology and not
a strict tree.

| Relationship | Meaning | Authority effect |
| --- | --- | --- |
| `depends on` | Consumes another ADR's authority | Does not modify the depended-on ADR |
| `specializes` | Applies an existing decision to a narrower domain/workload with additional rules | Parent remains authoritative outside the specialization |
| `amends` | Explicitly changes a named part of an existing accepted decision | Newer accepted amendment wins only for that stated scope |
| `supersedes` | Replaces an earlier decision for the stated scope | Earlier decision becomes historical for that scope |
| `related` | Useful cross-reference only | No authority effect |

README grouping, ADR number, issue linkage, and implementation chronology do
**not** create any of these relationships.

## Architecture map

ADRs are grouped by their **primary architectural responsibility**:

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

**Grouping is navigation only.** It does not create `depends on`, `specializes`,
`amends`, or `supersedes` edges. Those must be recorded explicitly in the ADRs
that own the affected decisions.

### A. Platform & runtime foundations

These ADRs decide whether supporting infrastructure/runtime mechanisms may be
introduced and what authority they may hold. They must not silently take over
exam-domain truth.

| ADR | Primary responsibility | Status |
| --- | --- | --- |
| [ADR-001](ADR-001-redis.md) | Redis responsibility boundary and deployment semantics | ACCEPTED bounded adoption / broader responsibilities DEFERRED |
| [ADR-002](ADR-002-websocket-sse.md) | Polling vs SSE/WebSocket transport | DEFERRED |
| [ADR-003](ADR-003-job-queue.md) | Queue/workload classification and adoption boundary | ACCEPTED policy / generic platform DEFERRED |
| [ADR-004](ADR-004-desktop-electron.md) | Optional Desktop/Electron runtime adoption | DEFERRED |
| [ADR-007](ADR-007-stateful-infrastructure-test-isolation.md) | Stateful infrastructure test isolation/lifecycle | ACCEPTED core; later work partly deferred |

### B. Exam execution & correctness core

These ADRs define correctness-critical exam/attempt foundations. This group has
accumulated substantial later evolution and is intentionally reviewed **after**
lower-coupling groups; do not casually reshape its state machines while doing
unrelated ADR cleanup.

| ADR | Primary responsibility | Status |
| --- | --- | --- |
| [ADR-005](ADR-005-exam-operation-state-baseline.md) | Exam lifecycle/state transitions and admin operation baseline | ACCEPTED |
| [ADR-006](ADR-006-exam-time-authority.md) | Canonical exam/attempt time authority | ACCEPTED, amended |
| [ADR-008](ADR-008-submit-answer-freeze.md) | Submit/save serialization and answer freeze boundary | ACCEPTED |

### C. Recovery, incident & proctoring

| ADR | Primary responsibility | Status |
| --- | --- | --- |
| [ADR-012](ADR-012-candidate-recovery-contract.md) | Candidate recovery contract and threat model | ACCEPTED |
| [ADR-013](ADR-013-interruption-time-compensation-policy.md) | Interruption detection and time compensation | ACCEPTED |
| [ADR-014](ADR-014-exam-incident-authority.md) | Incident authority and recovery evidence | ACCEPTED |
| [ADR-015](ADR-015-proctor-exam-scope-authority.md) | Proctor-to-exam resource scope | ACCEPTED |

### D. Authorization & operations

| ADR | Primary responsibility | Status |
| --- | --- | --- |
| [ADR-010](ADR-010-scoped-rbac-architecture.md) | Capability + resource-scope authorization | ACCEPTED |
| [ADR-017](ADR-017-operational-authority-maintainer-boundary.md) | Operational/Maintainer authority boundary | ACCEPTED through revision 4 |
| [ADR-018](ADR-018-operational-observability-window.md) | Read-only operational observability contract | ACCEPTED |

### E. Application, client & content evolution

| ADR | Primary responsibility | Status |
| --- | --- | --- |
| [ADR-009](ADR-009-frontend-state-machine-adoption.md) | Frontend state-machine adoption | PROPOSED |
| [ADR-011](ADR-011-notification-and-email-delivery.md) | Inbox notification and asynchronous Email delivery | ACCEPTED |
| [ADR-016](ADR-016-future-offline-resilient-client-data-and-recovery-model.md) | Future offline-resilient client | DEFERRED |
| [ADR-019](ADR-019-content-document-model.md) | Rich-content/document authority model | PROPOSED |

## ADR review and optimization order

Review order is a **maintenance strategy**, not authority precedence. Prefer
low-coupling decisions first so difficult correctness work is not mixed with
basic documentation cleanup.

```text
1. README / global governance map
2. ADR-001..004 foundation subset                 <- first convergence group
3. ADR-007 and other remaining foundation details
4. Authorization / operations + client/content groups
5. Recovery / incident / proctoring group
6. Exam execution & correctness core (005/006/008) <- intentionally later
7. Reconcile relationships within each group
8. Reconcile cross-group dependency/conflict graph
9. Only then consider splitting, merging, or adding new root ADRs
```

The first foundation subset (ADR-001..004) is tracked by issue #471. ADR-007 is
in the same architectural group but is **not** implied to be reviewed merely
because 001..004 are converged.

## Optimization rules

1. **One ADR, one primary decision.** Do not grow a mega-ADR merely because a
   later feature touches the same subsystem.
2. **Current binding decision first.** Historical rollout/slice text may remain
   only when clearly marked historical/non-normative.
3. **Explicit relationships only.** State `depends on`, `specializes`, `amends`,
   or `supersedes`; never infer them from dates/numbers.
4. **Keep independent state axes independent.** A new feature consumes existing
   lifecycle/time/attempt/authz authority unless an explicit redesign is
   accepted.
5. **Architecture docs explain the current whole system.** ADRs explain the
   durable decision and why it exists.
6. **Optimize individual ADRs before group convergence.** Group restructuring
   comes only after each member has been audited.

## Recommended reading paths

These paths are navigation only:

- **Infrastructure:** ADR-001 -> ADR-003 -> ADR-007; consult ADR-002/004 only
  when their adoption triggers matter.
- **Exam correctness:** ADR-005 -> ADR-006 -> ADR-008 -> ADR-012 -> ADR-013 ->
  ADR-014.
- **Proctor intervention:** ADR-010 -> ADR-015, then the relevant exam/time/
  recovery ADRs.
- **Operations:** ADR-010 -> ADR-017 -> ADR-018.
- **Client/content:** ADR-009 / ADR-016 / ADR-019 according to the capability;
  ADR-011 owns current notification/delivery specialization.

## Numeric index

ADR numbers are stable lookup identifiers; grouping does not renumber files.

| ID | Title | Status | Supersedes | Superseded by |
| --- | --- | --- | --- | --- |
| [ADR-001](ADR-001-redis.md) | Redis as Optional Infrastructure | ACCEPTED bounded adoption / DEFERRED broader responsibilities | none | none |
| [ADR-002](ADR-002-websocket-sse.md) | WebSocket / SSE for Real-Time Updates | DEFERRED | none | none |
| [ADR-003](ADR-003-job-queue.md) | Job Queue for Async / Long-Running Workloads | ACCEPTED classification policy / DEFERRED generic platform | none | none |
| [ADR-004](ADR-004-desktop-electron.md) | Desktop / Electron Exam Runtime | DEFERRED | none | none |
| [ADR-005](ADR-005-exam-operation-state-baseline.md) | Exam Operation State Baseline | ACCEPTED | none | none |
| [ADR-006](ADR-006-exam-time-authority.md) | Exam Time Authority | ACCEPTED, amended | none | none |
| [ADR-007](ADR-007-stateful-infrastructure-test-isolation.md) | Stateful Infrastructure Test Isolation | ACCEPTED core / later work partly deferred | none | none |
| [ADR-008](ADR-008-submit-answer-freeze.md) | Submit Answer Freeze Barrier | ACCEPTED | none | none |
| [ADR-009](ADR-009-frontend-state-machine-adoption.md) | Frontend State Machine Adoption | PROPOSED | none | none |
| [ADR-010](ADR-010-scoped-rbac-architecture.md) | Scoped RBAC Architecture | ACCEPTED | none | none |
| [ADR-011](ADR-011-notification-and-email-delivery.md) | Notification Inbox and Email Delivery Architecture | ACCEPTED | none | none |
| [ADR-012](ADR-012-candidate-recovery-contract.md) | Candidate Recovery Contract and Threat Model | ACCEPTED | none | none |
| [ADR-013](ADR-013-interruption-time-compensation-policy.md) | Interruption Detection and Time-Compensation Policy | ACCEPTED | ADR-012's incomplete time-policy direction | none |
| [ADR-014](ADR-014-exam-incident-authority.md) | Exam Incident Authority | ACCEPTED | none | none |
| [ADR-015](ADR-015-proctor-exam-scope-authority.md) | Proctor-to-Exam Resource Scope Authority | ACCEPTED | none | none |
| [ADR-016](ADR-016-future-offline-resilient-client-data-and-recovery-model.md) | Future Offline-Resilient Client Data and Recovery Model | DEFERRED | none | none |
| [ADR-017](ADR-017-operational-authority-maintainer-boundary.md) | Operational Authority and Maintainer Boundary | ACCEPTED through revision 4 | none | none |
| [ADR-018](ADR-018-operational-observability-window.md) | Operational Observability Window | ACCEPTED | none | none |
| [ADR-019](ADR-019-content-document-model.md) | Content Document Model | PROPOSED | none | none |

## Numbering

ADR numbers are stable and never reused. The next free number is **ADR-020**.
Files that are audits *about* an ADR belong under `docs/archive/`, not in this
folder with a conflicting ADR number.
