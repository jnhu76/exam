# Exam System Architecture — Index

> Normative architecture documentation for the exam platform's domain protocols, state machines, and data authority.

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

## Authority Order

When evidence conflicts, the following authority order resolves the conflict:

```
Accepted ADR
  → SPEC.md + CONTEXT.md
  → Current architecture documents (this directory)
  → Domain command functions (packages/exam-engine/src/)
  → API composition (apps/api/src/routes/, apps/api/src/orchestrators/)
  → Repository implementation (packages/db/src/repository/)
  → Frontend projection (apps/web/src/)
  → Tests and audits
```

**Rule**: An ADR's explicit decision overrides an architecture document. An architecture document overrides a code comment. Code comments override tests. Tests are evidence of behavior, not authority for it.

## Document Map

| Document | Purpose |
|----------|---------|
| [domain-model.md](./domain-model.md) | Aggregate catalog, Question/Paper/Exam/Enrollment/Attempt/Grading/Result models |
| [protocol-catalog.md](./protocol-catalog.md) | Every protocol: purpose, actor, preconditions, state transition, writes, transaction boundary, idempotency, audit |
| [state-and-authority.md](./state-and-authority.md) | State machines for Exam, Attempt, Enrollment, Grading, Email outbox; policy fields; fact timestamps |
| [data-authority.md](./data-authority.md) | What data is authoritative, who writes it, when it becomes immutable, transaction boundaries, crash recovery |
| [security-model.md](./security-model.md) | Authentication, organization boundary, capability authorization, ownership, frozen-data integrity, threat model |

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

## Current Implementation Commit

These documents describe the system state at the commit at which they are authored. See the git log of this branch for the exact commit. Unmerged PR content is identified as **PENDING / NON-AUTHORITATIVE UNTIL MERGED**.

## Known Limitations

- Phase 1 only implements `timed_window` timing mode; `timed_sync`, `deadline`, and `untimed` are **NOT IMPLEMENTED** as runtime modes (schema fields exist).
- `not_started`, `queued`, `grading`, and `voided` attempt statuses have **no write path** in the current implementation — they exist as target design.
- Disrupted recovery UI is **NOT IMPLEMENTED** — the backend capability (heartbeat scanner, `restoreAttempt`) exists, but the candidate-facing restore flow is incomplete.
- Email delivery infrastructure (outbox, worker) has **no business caller** — the `EmailNotificationService` is never instantiated by any route.
- Notification Inbox is **NOT IMPLEMENTED** — only the email outbox channel exists.
- `Paper` is an **implicit or embedded composition concept**, not an explicit aggregate (see [domain-model.md §Paper classification](./domain-model.md#paper-classification)).

## How Future Audits Update These Documents

1. A new audit or architecture Job SHOULD read these documents as the current normative baseline.
2. When implementation changes, the relevant document MUST be updated to reflect the new normative state.
3. When an ADR supersedes a document section, the document MUST be updated to reference the ADR and remove the superseded content.
4. Each document carries a "Last verified against commit" marker. After a change, the marker MUST be updated and the affected sections re-verified.
