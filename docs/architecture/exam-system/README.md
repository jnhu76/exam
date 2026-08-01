# Exam System Architecture — Index

> Normative architecture documentation for the exam platform's domain protocols, state machines, and data authority.

```text
Last runtime verified against: bcf02847b0231e233dcb3ff98ec7ae681739b028
Recovery contract updated in: PR #218

Verification scope:
Runtime behavior verified against master after merged P5-0 / PR #210.
Recovery contract documentation (ADR-012, candidate-recovery.md) updated in PR #218.
```

## Purpose

This directory contains the authoritative normative description of how the exam system's core domain actually works. It answers:

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

The repository has two distinct authority dimensions. Architecture documents must respect both.

### Normative intent authority

These define intended invariants and accepted decisions:

```text
Accepted ADR
  → active SPEC / CONTEXT
  → approved architecture documents (this directory)
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
| [incident-authority.md](./incident-authority.md) | Exam incident authority (ADR-014 ACCEPTED; J3 Admin runtime IMPLEMENTED — in review on PR): lifecycle, commands, permission matrix, transaction boundaries, data model |
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

- Phase 1 only implements `timed_window` timing mode; `timed_sync`, `deadline`, and `untimed` are **NOT IMPLEMENTED** as runtime modes (schema fields exist).
- `not_started`, `queued`, `grading`, and `voided` attempt statuses have **no write path** in the current implementation — they exist as target design.
- Candidate disrupted-recovery UI is **IMPLEMENTED** (REC-I3): the `useAttemptRestore()` hook drives restore from the `CandidateTakeSnapshot` `canResume` capability — an explicit restore command, a `restoring` state, a `failed`/retry surface with an auto-focused retry button, a generation token to prevent cross-attempt cross-writes, and an authoritative snapshot reload after the command acks. The recovery contract is implemented under ADR-012/ADR-013. See [candidate-recovery.md](./candidate-recovery.md) for sequence diagrams.
  - What remains open is the **operator/proctor** side, not the candidate surface: the operator time-grant route/permission is **IMPLEMENTED** (REC-I4-I3B2 CLOSED); the exam incident authority persistence and Admin API are **IMPLEMENTED** (J3 `REC-I6-I1` — in review on PR; see [incident-authority.md](./incident-authority.md)); a dedicated operator/proctor recovery center is **NOT IMPLEMENTED** (REC-OPS J5/J6), Proctor incident permissions and Proctor-to-Exam scope are **NOT IMPLEMENTED** (J4/M11), and system-generated incidents are **NOT IMPLEMENTED**.
- Email delivery infrastructure (outbox + worker) is **IMPLEMENTED** (P5-0 merged) and has its first production business caller: the `result_published` publication (P5-N1, CLOSED, PR #213) atomically creates the candidate Inbox row and enqueues the Email outbox row. Additional operational notification types remain P5-N2+ scope.
- Notification Inbox is **IMPLEMENTED** (P5-N1, CLOSED, PR #213) for `result_published`; additional operational notification types remain P5-N2+ scope.
- `Paper` is an **implicit or embedded composition concept**, not an explicit aggregate (see [domain-model.md](./domain-model.md)).
- Candidate answer-key visibility is **fixed to hidden** — a future configurable release policy is **NOT IMPLEMENTED**.
- Teacher role has capability grants but resource-scoped authorization (Teacher@course) is **NOT IMPLEMENTED** — Teacher permissions are currently flat org-wide.

## How Future Audits Update These Documents

1. A new audit or architecture Job SHOULD read these documents as the current normative baseline.
2. When implementation changes, the relevant document MUST be updated to reflect the new normative state.
3. When an ADR supersedes a document section, the document MUST be updated to reference the ADR and remove the superseded content.
4. Each document carries a "Last verified against commit" marker near its title. After a change, the marker MUST be updated and the affected sections re-verified.
