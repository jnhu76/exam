# Exam System Architecture — Index

> Architecture documentation for the exam platform's domain protocols, state
> machines, and data authority. **Role: explanatory architecture map, not a
> competing normative authority** (#614 authority split). Binding decisions
> live in Accepted ADRs (`docs/adr/`), wire behavior in contracts
> (`docs/contracts/`), product invariants in [`../../SPEC.md`](../../SPEC.md),
> and current delivery state in
> [`../../status/implementation-status.md`](../../status/implementation-status.md).
> Where a section here and one of those authorities disagree, the authority
> wins and the drift must be reconciled. Point-in-time analysis inside these
> files is retained as evidence and marked as such.

```text
Last runtime verified against: b673bb22c3ebed91f9bed86dc20c70c589a68eab
Verification scope: 2026-09-25 (#614) — the confirmed drift families
(delivery-state claims) were re-verified against current master; sections
without an explicit re-verification note retain their original snapshot
(previous marker: b994d109).
Recovery contract documentation (ADR-012, candidate-recovery.md) updated in PR #218.
```

## Purpose

This directory explains how the exam system's core domain currently works. It is a current-architecture projection of its owning authorities, not an independent normative owner. It answers:

- What are the core domain objects, and what authority does each own?
- What protocols operate on them?
- What lifecycle and sub-process states exist?
- Which commands perform state transitions?
- Which data becomes immutable, and when?
- Which transaction boundaries protect those transitions?
- How does data flow from Question authoring to Candidate result?
- Where are the authorization and security boundaries?
- Which parts are implemented, implicit, incomplete, or absent?

## Scope

This documentation covers the **exam domain core**: Question authoring, Exam composition and publication, Candidate enrollment, Attempt execution, Answer save and submit, Automatic and manual grading, Result projection and publication, Authorization, Audit logging, and Email delivery infrastructure.

It does **not** cover UI implementation details, deployment topology, or non-domain infrastructure (build system, CI configuration, frontend component library).

## Authority Model

Binding authority lives upstream of this directory. This directory is a projection of it:

```text
Accepted ADR / SPEC / contracts / executable implementation
  ↓
exam-system/** = explanatory current-architecture projection
                 + explicitly bounded historical analysis
```

### Owning authorities

These define intended invariants and accepted decisions; this directory must track them and never compete with them:

```text
Accepted ADR (docs/adr/) — binding architecture decisions
  → SPEC (docs/SPEC.md) — product invariants
  → contracts (docs/contracts/) — wire behavior and data formats
```

### As-built reality authority

These define what the system actually does at runtime:

```text
database schema and constraints
  → domain/engine commands
  → API/orchestrator transaction composition
  → repository implementation
  → frontend projections
  → executable tests
```

### Conflict resolution

Architecture documents do **not** override executable reality. When normative intent and implementation conflict:

- Record **DOCUMENTATION_DRIFT** when documentation is stale.
- Record **DEFECT** or **SECURITY_DEFECT** when implementation violates an accepted invariant.
- Record **OPEN_DECISION** when the intended semantics are genuinely unresolved.
- Do not silently select one authority over the other.

## Document Map

| Document | Purpose |
|----------|---------|
| [domain-model.md](./domain-model.md) | Aggregate catalog, Question/Paper/Exam/Enrollment/Attempt/Grading/Result models |
| [protocol-catalog.md](./protocol-catalog.md) | Every protocol: purpose, actor, preconditions, state transition, writes, transaction boundary, idempotency, audit |
| [state-and-authority.md](./state-and-authority.md) | State machines for Exam, Attempt, Grading, Enrollment, Email outbox; policy fields; fact timestamps |
| [incident-authority.md](./incident-authority.md) | Exam incident authority (ADR-014 ACCEPTED; J3 Admin runtime IMPLEMENTED — CLOSED, PR #242 merged): lifecycle, commands, permission matrix, transaction boundaries, data model |
| [data-authority.md](./data-authority.md) | What data is authoritative, who writes it, when it becomes immutable, transaction boundaries, crash recovery |
| [security-model.md](./security-model.md) | Authentication, organization boundary, capability authorization, ownership, frozen-data integrity, threat model |
| [diagrams.md](./diagrams.md) | Mermaid architecture diagrams: system context, aggregate relationships, data flow, state machines, sequence diagrams, security boundaries |

## Normative Terminology

These documents use RFC 2119 terms deliberately:

| Term | Meaning |
|------|---------|
| **MUST** | Required invariant of the current implementation |
| **MUST NOT** | Prohibited by the current protocol |
| **SHOULD** | Intended current behavior with an accepted exception |
| **MAY** | Optional current behavior |

For absent or proposed behavior, these explicit labels are used:

| Label | Meaning |
|-------|---------|
| **NOT IMPLEMENTED** | Capability does not exist in the current code |
| **IMPLICIT** | Behavior exists but is not enforced by an explicit invariant |
| **PARTIALLY IMPLEMENTED** | Some sub-capabilities exist; others do not |
| **ACCEPTED LIMITATION** | Current scope intentionally provides weaker semantics |
| **FUTURE CAPABILITY** | Valid product capability not currently required |
| **OPEN DECISION** | Product semantics have not been decided |

## Known Limitations

- Timing modes `timed_window`, `deadline`, and `untimed` are **IMPLEMENTED** (#291 Phase A); `timed_sync` remains **NOT ACTIVATED** — its semantics are frozen in `docs/contracts/timed-sync-semantics.md`, with implementation planned in B1→B2 slices.
- `not_started`, `queued`, and `voided` attempt statuses have **no write path** in the current implementation — they exist as target design. The historical `grading` attempt status was **removed** (#542): it is no longer part of `AttemptStatus` and a DB CHECK rejects it; grading pipeline state lives in the orthogonal `gradingStatus`.
- Candidate disrupted-recovery UI is **IMPLEMENTED** (REC-I3): the `useAttemptRestore()` hook drives restore from the `CandidateTakeSnapshot` `canResume` capability — an explicit restore command, a `restoring` state, a `failed`/retry surface with an auto-focused retry button, a generation token to prevent cross-attempt cross-writes, and an authoritative snapshot reload after the command acks. The recovery contract is implemented under ADR-012/ADR-013. See [candidate-recovery.md](./candidate-recovery.md) for sequence diagrams.
  - The **operator/proctor** side is also **IMPLEMENTED**: the operator time-grant route/permission (REC-I4-I3B2 CLOSED), the exam incident authority persistence and Admin API (J3 `REC-I6-I1`, PR #242; see [incident-authority.md](./incident-authority.md)), assigned-Proctor incident authority + Proctor-to-Exam scope (J4-I1/M11, ADR-015 §13), the Admin Recovery Center (J5) and the Proctor Operations surface (J6, #303), and system-generated incidents (#304, ADR-014 §8 Gate A). Current projection semantics: [`../../contracts/admin-recovery-center.md`](../../contracts/admin-recovery-center.md) §13.1.
- Email delivery infrastructure (outbox + worker) is **IMPLEMENTED** (P5-0 merged) and has its first production business caller: the `result_published` publication (P5-N1, CLOSED, PR #213) atomically creates the candidate Inbox row and enqueues the Email outbox row. Additional operational notification types remain P5-N2+ scope.
- Notification Inbox is **IMPLEMENTED** (P5-N1, CLOSED, PR #213) for `result_published`; additional operational notification types remain P5-N2+ scope.
- `Paper` is an **implicit or embedded composition concept**, not an explicit aggregate (see [domain-model.md](./domain-model.md)).
- Candidate answer-key visibility is **fixed to hidden** — a future configurable release policy is **NOT IMPLEMENTED**.
- Teacher@Course resource-scoped authorization is **ENFORCED** (#286): `teacher_course_assignments` carriers + per-request scope gate + SQL-side LIST filtering. Proctor@Exam (ADR-015) and Grader@Exam (#296) are enforced the same way.

## How Future Audits Update These Documents

1. A new audit or architecture Job MAY read these documents as a navigational baseline for the current explanatory state, but MUST verify every load-bearing fact against its owning authority (Accepted ADR / SPEC / contracts) and the as-built implementation before treating it as current truth. These documents are not a competing normative owner.
2. When implementation changes, the affected document MUST be updated so its explanation keeps tracking the owning authority — not to declare a new normative state.
3. When an ADR supersedes a document section, the document MUST be updated to reference the ADR and remove the superseded content or mark it explicitly as bounded history.
4. Each document carries a "Last verified against commit" marker near its title. After a change, the marker MUST be updated and the affected sections re-verified. A marker MUST name a commit that exists in this repository AND state its verification scope (which sections are current as of it, which retain an earlier snapshot). Commit distance from HEAD alone is never treated as staleness; an unpinned or ambiguous marker is a defect.
