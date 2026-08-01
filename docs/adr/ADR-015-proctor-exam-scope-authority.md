# ADR-015 — Proctor-to-Exam Resource Scope Authority

## Status

**Proposed** — 2026-08-02

This ADR is **Proposed**. It is the candidate authority contract for
`M11-PROCTOR-EXAM-ASSIGNMENTS` (J4-I1). It must not be marked **Accepted**
by the same implementation agent that authors it; acceptance requires an
independent review that closes the §12 acceptance checklist. Until
Accepted, J4-I1 is BLOCKED.

Acceptance, when it happens, authorizes J4-I1 to implement the frozen
contract below. Acceptance does **not** itself implement any schema,
command, route, permission, preset, resolver, or UI behavior, and it does
not authorize J5/J6, system incidents, Redis, custom roles,
multiTenant, or SuperAdmin.

If the project's house practice is later judged to allow a design PR to
enter master as Accepted, the acceptance record must still state: decision
owner, review evidence, and acceptance date (see §12).

## Metadata

| Field | Value |
| --- | --- |
| Date | 2026-08-02 |
| Decision owners | jnhu76 |
| Supersedes | none |
| Superseded by | — |
| Related decisions | ADR-010 (Scoped RBAC), ADR-013 (interruption/time policy), ADR-014 (incident authority) |
| Reality audit | [`docs/audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md`](../audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md) |
| Roadmap job | [`docs/roadmap/recovery-operations-jobs.md`](../roadmap/recovery-operations-jobs.md) §6 (J4) |
| Phase | Phase 3 product work (M11 resource-relationship authorization) |

## Terminology

The keywords MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
and MAY are to be interpreted as described in RFC 2119. Tables, schemas,
routes, and commands in this ADR are **proposals frozen for implementation**
unless explicitly labeled as a current runtime fact (verified in the reality
audit).

## Context

The platform implements a capability-based authorization model whose
infrastructure is live (ADR-010, ACCEPTED; `packages/authz/`,
`apps/api/src/authz/`). Roles are presets; an actor's effective authority is
the union of every active `user_role_assignments` row's preset permissions,
resolved per request (`loadAssignmentAuthority`). What is **not** implemented
is the Phase 3 *product* work built on that infrastructure — in particular
resource-relationship authorization (M11). The Proctor role preset exists
and carries org-wide capabilities, but there is no Proctor→Exam assignment
and no resolver that narrows Proctor authority to assigned exams.

The recovery workstream (`docs/roadmap/recovery-operations-jobs.md`) requires
that the **minimum** resource-relationship slice — Proctor → assigned Exam —
be frozen before any runtime work begins, so that J4-I1 implements frozen
semantics instead of inventing them. This ADR is that freeze. It is built
directly on the reality audit
([`M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md`](../audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md)),
which records the verified master state at `e9fa1969`.

J3 (REC-I6-I1-INCIDENT-PERSISTENCE-COMMANDS) is CLOSED on master (PR #242).
ADR-014 (ACCEPTED) froze the incident authority and explicitly stated:
"Proctor receives no Incident permission until J4/M11 lands scoped authority"
and "the target grant is applied by J4 (M11) at the same time
Proctor-to-Exam scope enforcement lands." This ADR freezes what that
"scoped authority" is.

### Current runtime facts constraining this decision (verified in reality audit §4)

1. **No resource-scoped assignment exists.** `user_role_assignments` carries
   only `(organizationId, userId, role, isPrimary, isActive)` — there is no
   `scope_type` / `scope_resource_id` column. The assignment a Proctor
   receives today is organization-wide.
2. **No `exam_proctor_assignments` / `exam_staff` / `course_staff` /
   `grading_assignment` table exists** anywhere in the schema or migrations.
3. **The Proctor preset grants** `ExamRoomView`, `AttemptStatusView`,
   `AttemptTimelineView`, `AttemptMisconductMark`, `AttemptForceSubmit`
   (org-wide). It grants **zero** `incident.*` permissions (the ADR-014
   boundary holds). `AttemptTimeGrant` is Admin-only by design.
4. **Live resolvers** exist for `exam` and `attempt` (org + ownership chain).
   There is **no Incident→Exam resolver** and **no Proctor-assignment
   resolver**.
5. **Flat sensitive routes:** `POST /admin/attempts/:attemptId/misconduct`
   and `.../force-submit` are gated by flat `requireCapability` (their
   registry entries declare `Scope.Attempt` / `resolver: "attempt"` but the
   route files do not wire the scoped preHandler). All 11 incident routes
   are flat.
6. **Authority is loaded per request** from `user_role_assignments`; there
   is no JWT-capability cache. Revocation is therefore effective on the next
   authenticated request — the correct model for J4 to reuse.
7. **Idempotency precedent (ADR-013 / ADR-014):** `operationId` command
   identity with `idempotent_replay` / `IDEMPOTENCY_CONFLICT` (HTTP 409),
   a named unique constraint as final arbiter, and 23505 recognized only on
   that named constraint (with rollback → fresh-transaction recovery).
8. **House id/type conventions:** entity ids and actor ids are `text`;
   operation ids are `uuid`. Lock ordering `Enrollment → Attempt → Exam`
   (ADR-013 §9) is frozen and MUST NOT be reordered.

## Decision Summary

1. **The minimum resource relationship is `Proctor → explicitly assigned
   Exam`.** Nothing else (role alone, course membership, org membership,
   history, UI visibility, URL knowledge, incident-creator identity) grants
   Exam-scoped Proctor authority (§6.1).
2. **Admin is organization-wide Exam authority by product policy, not by
   fake assignment rows.** The resolver short-circuits Admin; no
   `exam_proctor_assignments` row is ever synthesized for Admin (§6.2, §6.3).
3. **Every Proctor Exam-scoped operation requires the triple** — active
   Proctor role assignment AND active Proctor-to-Exam assignment AND the
   explicit permission. None of the three substitutes for another (§6.3).
4. **The assignment is an append-preserving aggregate** with at most one
   active row per `(organization, exam, proctor)`; revocation is monotonic;
   reassignment creates a new active episode (§6.4).
5. **Two canonical commands** — `assignProctorToExam()` and
   `revokeProctorFromExam()` — each carrying `operationId`; no universal
   `updateAssignment()` (§6.5, §6.6).
6. **Redis is explicitly excluded** from the authorization authority path;
   PostgreSQL is the sole source of truth (§Non-goals, §6.10).
7. **Resolver enforcement MUST land before any Proctor permission
   activation.** The J4-I1 decomposition (§10) forbids activating Proctor
   capabilities before the scoped preHandler runs on every sensitive route.

## Non-Goals

- persistence implementation, migrations, repositories (J4-I1A);
- runtime resolver implementation and route flipping (J4-I1B);
- Admin assignment API implementation and OpenAPI (J4-I1C);
- Proctor permission activation and browser E2E (J4-I1D);
- Teacher→Course, Teacher→Exam, Grader→Work assignment (separate M11
  slices; explicitly out of J4 scope per recovery-operations-jobs.md §6);
- recovery-center UI (J5/J6);
- custom-role UI, arbitrary resource-policy language, or a generic
  `resolveScope(ctx, resource, permission)` engine (Phase 4);
- organization-wide Proctor permissions as a temporary shortcut;
- Redis, WebSocket/SSE, background workers, or Pub/Sub in the
  authorization path;
- multiTenant, SuperAdmin, tenant hierarchy/switcher,
  `organizationSlug` login, cross-tenant audit;
- pass-to-proceed API, service tokens, webhooks (Phase 4);
- identity invitation, SMTP password reset, account-lifecycle UI;
- system-generated incidents (reserved permission; future Job);
- candidate-facing incident reporting;
- `misconduct_mark` Incident action link (deferred per ADR-014 §7 until a
  stable append-only misconduct receipt exists).

## 1. Resource relationship model (§6.1)

The frozen minimum relationship:

```text
Proctor
  → explicitly assigned Exam
```

The following do **not** implicitly grant Exam-scoped Proctor authority:

```text
- Proctor role alone                      (role grants the capability preset,
                                           not the resource relationship)
- Course membership                       (no course→exam inheritance in J4)
- Organization membership                 (org is the tenant boundary, not a
                                           Proctor scope)
- historical assignment                   (a revoked assignment confers no
                                           authority; history is audit only)
- UI visibility                           (UI is a UX control; the backend
                                           resolver is the authority)
- URL knowledge                           (knowing an exam id authorizes
                                           nothing)
- Incident-creator identity               (creating an incident on an exam
                                           does not assign the proctor to it)
```

This list is exhaustive for J4: any future implicit path (e.g.
Teacher@Course → exams in that course) is a separate, later design decision,
not a J4-I1 implementation choice.

## 2. Admin authority (§6.2)

```text
Admin has organization-wide Exam authority.
Admin does not require fake exam assignment rows.
```

Admin bypass is an explicit product policy (ADR-010 compatibility superset;
recovery-operations-jobs.md §13 "Admin authority is not implemented by fake
Proctor assignments"). The resolver MUST short-circuit Admin before the
assignment check (§5). No code path may synthesize an
`exam_proctor_assignments` row for an Admin, and no test fixture may rely on
such a row to make Admin pass a scoped gate.

## 3. The Proctor triple (§6.3)

A Proctor executing any Exam-scoped operation MUST simultaneously satisfy:

```text
1. active Proctor role assignment      (a user_role_assignments row,
                                        role='Proctor', is_active=true)
AND
2. active Proctor-to-Exam assignment   (an exam_proctor_assignments row,
                                        status='active' for this exam+proctor)
AND
3. explicit permission                 (the capability is in the Proctor
                                        preset AND not in the deferred set)
```

Consequences:

- Exam assignment does **not** automatically grant any permission. A Proctor
  assigned to an exam still only holds the capabilities the Proctor preset
  grants (and, after J4-I1D, only the frozen low-risk subset activated).
- Permission does **not** automatically grant all exams. A Proctor with
  `ExamRoomView` may exercise it only on assigned exams.
- Role, permission, and resource relationship are three independent
  conditions; absence of any one denies. This is the invariant J4-I1B's
  resolver enforces.

The triple does **not** weaken the existing ownership-chain resolver: the
exam/attempt resolver's org + chain check (reality audit §4.3) still runs.
The Proctor-assignment check is an **additional** condition for Proctor
actors only.

## 4. Assignment aggregate (§6.4)

Frozen aggregate (proposal for J4-I1A):

```text
ExamProctorAssignment
  id                  text PK (house id() convention)
  organizationId      text NOT NULL  (tenant boundary; composite FK to exams)
  examId              text NOT NULL  (composite FK to exams)
  proctorUserId       text NOT NULL  (FK to users)
  status              text NOT NULL CHECK (status IN ('active','revoked'))
                      DEFAULT 'active'
  assignedBy          text NOT NULL  (actor; server-derived from ctx)
  assignedAt          timestamptz NOT NULL  (server time, fastify.now())
  revokedBy           text NULL      (actor; server-derived; NULL while active)
  revokedAt           timestamptz NULL
  reasonCode          text NULL  (≤100; optional on assign, optional on revoke)
  createdAt           timestamptz NOT NULL
  updatedAt           timestamptz NOT NULL
```

Decisions (frozen):

- **Representation:** `active` row + `revokedAt` / `revokedBy` / `status='revoked'`
  on the same row (status model, not append-only event rows). Rationale: a
  Proctor-to-Exam assignment is a simple active/revoked toggle, not a
  multi-step investigation lifecycle like an incident (ADR-014); the
  status-on-one-row model matches the simpler `user_role_assignments`
  `is_active` precedent and keeps the active-uniqueness arbiter
  straightforward (§6.7). A separate append-only **audit** trail (the
  existing `audit_logs`) records every assign/revoke as an immutable
  compliance fact (§6.14); the assignment table itself need not duplicate
  that history.
- **History preservation:** the row is **never physically deleted** through
  product APIs. Revocation sets `status='revoked'` + `revokedAt` + `revokedBy`;
  the row remains queryable for audit. Reassignment reactivates by creating
  a **new** active row (see below), leaving the revoked row as history.
- **Multiple historical assignments allowed:** the same
  `(organization, exam, proctor)` MAY appear in many rows over time
  (assign → revoke → reassign → revoke …). Each row is one assignment
  *episode*.
- **Current-active uniqueness:** at most **one** active row per
  `(organization_id, exam_id, proctor_user_id)`. Enforced by a partial
  unique index (§6.7), mirroring `user_role_assignments_active_primary_unique`.
- **Stable assignment ID:** each episode has its own stable `id`. There is
  no "global assignment identity" that survives revoke/reassign; the id
  identifies one episode.
- **No `version` column:** assignment has no concurrent-writer versioning
  need beyond the active-unique arbiter (assign/revoke are idempotent via
  `operationId`, not optimistic concurrency — §6.6). A `version` column
  would imply lost-update semantics that do not apply to a toggle.
- **Reactivation policy:** `assignProctorToExam()` on an already-active
  `(exam, proctor)` is an idempotent replay (§6.6), **not** a reactivation
  of a revoked row. A revoked row is never resurrected; reassign creates a
  new active episode. This keeps "revocation is monotonic" provable.

## 5. Canonical commands (§6.5)

Frozen write commands:

```text
assignProctorToExam(ctx, { operationId, examId, proctorUserId, reasonCode? })
revokeProctorFromExam(ctx, { operationId, assignmentId|examId+proctorUserId, reasonCode? })
```

Optional read commands (J4-I1C may add as needed):

```text
listExamProctors(ctx, examId)            → active assignments for an exam
listProctorExams(ctx, proctorUserId)     → active assignments for a proctor
getProctorExamAssignment(ctx, examId, proctorUserId)  → current active or null
```

**Forbidden command shapes** (must not exist):

```text
updateAssignment()
patchAssignment()
setScope()
bulkAssignProctors()        (a batch is N operationId-keyed assign calls)
```

### Per-write-command contract

| Decision | `assignProctorToExam` | `revokeProctorFromExam` |
| --- | --- | --- |
| `operationId` | REQUIRED (UUIDv4); command identity | REQUIRED (UUIDv4); command identity |
| Canonical payload | `{ operationId, examId, proctorUserId, reasonCode }` | `{ operationId, assignmentId, reasonCode }` (or `{examId, proctorUserId}` lookup form) |
| Replay | same operationId + same canonical payload → `idempotent_replayed`, return committed assignment, NO write | same operationId + same canonical payload → `idempotent_replayed`, NO write |
| Conflict | same operationId + different payload → 409 `IDEMPOTENCY_CONFLICT` | same operationId + different payload → 409 `IDEMPOTENCY_CONFLICT` |
| Duplicate assign (new operationId, already active) | `idempotent_replayed`-like outcome: return existing active assignment, NO new row (see §6.6 — frozen as **return existing**, not 409) | n/a |
| Revoke when already revoked (new operationId) | n/a | return the committed revoked assignment (`idempotent_replayed`-like), NO write |
| Actor | `ctx.actorId` (server-derived; NEVER from request body) | `ctx.actorId` (server-derived) |
| Audit | `exam.proctor_assigned` (atomic) | `exam.proctor_revoked` (atomic) |
| Transaction boundary | one transaction: validate → upsert-active → audit (§8) | one transaction: lock active row → set revoked → audit (§8) |

## 6. Idempotency (§6.6)

```text
Every write command carries operationId.
```

Frozen semantics (mirroring ADR-013 / ADR-014):

```text
same operationId + same canonical payload
  → idempotent replay (wire outcome idempotent_replayed; return committed
    assignment; NO write)

same operationId + different canonical payload
  → 409 IDEMPOTENCY_CONFLICT

new operationId + already-active same (exam, proctor) [assign]
  → explicit business outcome: return the existing active assignment
    (wire outcome idempotent_replayed), NO new row, NO audit

new operationId + revoke on an already-revoked assignment
  → return the committed revoked assignment (idempotent_replayed), NO write
```

**Duplicate-assign decision (frozen):** a duplicate assign under a *new*
`operationId` returns the **existing active assignment** (outcome
`idempotent_replayed`), NOT 409. Rationale: assign is a desired-state
operation ("this proctor should be assigned"); calling it twice with the
same intent should not require the caller to remember the first
`operationId`. The active-unique partial index (§6.7) makes two concurrent
assigns resolve to one winner and one 23505-recovery replay (§6.7 / §8),
both returning the same active row.

Canonical payload comparison trims strings (mirroring ADR-014's
canonicalization); J4-I1A ships the canonical comparator with tests.

## 7. Concurrency (§6.7)

### Required analysis (frozen outcomes)

| Race | Outcome |
| --- | --- |
| Two concurrent `assignProctorToExam` (same exam+proctor, different operationId) | The active-unique partial index admits exactly one INSERT winner; the loser hits 23505 on the named constraint → rollback → fresh-transaction query → returns the now-committed active row (`idempotent_replayed`). No split-brain active rows. |
| Two concurrent `assignProctorToExam` (same operationId — retry) | Operation-unique on the audit/event path: the second is a replay, returns the committed assignment, NO write. |
| Assign vs revoke (same exam+proctor) | The active-unique index means exactly one active row exists. Whichever transaction locks/inserts first wins; the other either replays (assign) or sees nothing active to revoke (revoke of a not-yet-committed active row → 404 `RESOURCE_NOT_FOUND`, which the caller may treat as "nothing to revoke"). |
| Two concurrent `revokeProctorFromExam` (same assignment) | The first UPDATE sets `status='revoked'`; the second locks the same row, sees `status='revoked'`, returns `idempotent_replayed`. |
| Reassign after revoke | A new `assignProctorToExam` INSERTs a new active episode (the old revoked row is history); the active-unique index is satisfiable because the old row is `status='revoked'` and excluded by the partial unique. |
| Role revocation racing a resource request | Per-request authority load means a concurrently-deactivated Proctor role is detected on the next request. The resolver runs after `authenticate`, so a request past `authenticate` but not yet past the gate completes within the same request — sub-request window, acceptable. |
| Exam-assignment revocation racing a resource request | Same model: the assignment check is in the per-request resolver path; revocation blocks the next request. No JWT-cached assignment (§6.10). |

### Frozen arbiters and locks

- **DB unique arbiter (assign):**
  `UNIQUE (organization_id, exam_id, proctor_user_id) WHERE status = 'active'`
  — partial unique index on `exam_proctor_assignments`, mirroring
  `user_role_assignments_active_primary_unique`. This is the final arbiter
  for "one active assignment per (org, exam, proctor)".
- **Operation arbiter:** the audit log row for `exam.proctor_assigned` /
  `exam.proctor_revoked` carries `operationId`; alternatively, a dedicated
  `exam_proctor_assignment_events` table with
  `UNIQUE (organization_id, operation_id)` (matching ADR-014's event
  table). J4-I1A picks one; the audit-log option is preferred to avoid a
  second table unless replay detection needs a dedicated event store. See
  §11.
- **Row lock object (revoke):** `SELECT ... FOR UPDATE` on the active
  `exam_proctor_assignments` row, inside the revoke transaction.
- **Isolation:** `REPEATABLE READ` (matching the incident commands and the
  `executeInTransaction` house default).
- **Fresh-transaction replay recovery:** on 23505 from the active-unique
  constraint, rollback the current transaction and, in a **fresh**
  transaction, query by `(org, exam, proctor)` for the active row; return
  it as `idempotent_replayed`. 23505 from the operation-unique follows the
  same recovery but compares canonical payload (`idempotent_replayed` vs
  `IDEMPOTENCY_CONFLICT`). 23505 from any other constraint is surfaced,
  never swallowed (mirrors ADR-014 §9).
- **Audit exactly once:** the audit row is written inside the same
  transaction as the assignment mutation; on replay no audit is written.
- **No split-brain active rows:** the partial unique index guarantees it.

## 8. Resource resolution (§6.8)

Frozen resolvers J4-I1B MUST provide:

```text
Exam ID            → Exam                     (existing createExamResolver)
Attempt ID         → Attempt.examId → Exam    (existing createAttemptResolver)
Incident ID        → Incident.examId → Exam   (NEW — does not exist today)
```

The Interruption→Attempt→Exam chain is already covered by the existing
attempt resolver (interruptions are attempt-scoped); no separate
interruption resolver is needed for J4.

### Resolver rules (every resolver)

- **tenant-scoped:** every read filters `organizationId = ctx.organizationId`.
- **server-derived:** exam/attempt/incident identity is read from
  authoritative rows, NEVER from the request body. The request carries
  identifiers only (`examId`, `attemptId`, `incidentId`).
- **fail-closed:** missing resource → `resource_not_found`; DB error →
  `resolver_error` → 503 `AUTHZ_UNAVAILABLE`; never fail open.
- **do not trust request-body examId:** for incident routes, the
  incident's `examId` is read from the incident row, not from the URL or
  body. A request cannot re-parent an incident by supplying a different
  `examId`.
- **no confused-deputy parent path:** the resolver validates the full
  ownership chain (attempt→exam→course→org; incident→exam→course→org);
  an inconsistency → `broken_parent_chain` → 403 (reality audit §4.3).

### Incident→Exam resolver (new)

J4-I1B adds a resolver that, given an `incidentId`, reads
`exam_incidents.exam_id` (and the incident's org) and reduces to
`Scope.Exam` with the exam chain. This is then wired into the incident
routes that currently run flat (reality audit §4.4 G3):
`GET /admin/incidents/:incidentId` and the 9 sub-routes. The list routes
`GET /admin/exams/:examId/incidents` already carry `examId` on the path
and can use the existing exam resolver.

### Proctor-assignment enforcement (new)

J4-I1B adds a check that runs **after** the capability check and **after**
the resource resolver, for Proctor actors only:

```text
if ctx.actor is Admin           → allow (short-circuit, §2)
else if ctx.actor holds active assignment to the resolved Exam
                               → allow
else                           → deny (403 PERMISSION_DENIED, or 404 per §9)
```

This check MUST be in the per-request path (the resolver/preHandler), not
in a JWT claim or a cached projection. It consults the
`exam_proctor_assignments` table (active row for
`(ctx.organizationId, resolvedExamId, ctx.actorId)`).

## 9. 403/404 policy (§6.9)

Frozen:

```text
resource missing                                  → 404 RESOURCE_NOT_FOUND
cross-organization resource                       → 404 RESOURCE_NOT_FOUND
                                                  (deliberately 404, not 403 —
                                                   anti-enumeration; matches
                                                   ADR-014 §13 and the existing
                                                   scoped preHandler)
resource exists but outside assigned Exam scope
  (Proctor, exam resolves in-org but no active    → 404 RESOURCE_NOT_FOUND
   assignment)                                      (NOT 403: revealing "the
                                                   exam exists but you are not
                                                   assigned" leaks existence)
actor has resource scope but lacks capability     → 403 PERMISSION_DENIED
```

This matches the existing `scopedCapability.ts` deny mapping (reality audit
§4.6 G7) and the ADR-014 §13 error contract. The Proctor-assignment miss
is folded into the `resource_not_found` bucket so a Proctor probing an
unassigned exam cannot distinguish "no such exam" from "not assigned".

**Rationale:** consistency with the house anti-enumeration norm. A 403 for
"not assigned" would let a Proctor enumerate exam ids by distinguishing
404 (no exam) from 403 (exam exists, not mine). The cost is that a
legitimately-assigned Proctor who loses the assignment gets an opaque 404 —
acceptable, and exactly the ADR-014 incident precedent.

## 10. Revocation semantics (§6.10)

```text
Revocation applies to all future authorization decisions immediately.
```

Decisions (frozen):

- **No JWT-cache dependency:** assignment state is NOT cached in the JWT
  or in `ctx.capabilities`. The resolver reads the assignment table per
  request. There is no "session refresh" lag.
- **Per-request authority:** the assignment check runs in the
  `preHandler`, after `authenticate`. A request that has already passed
  the gate completes; the **next** request is rejected. This is the same
  model as role revocation today (reality audit §4.6 G4).
- **No request-level cache:** the resolver does not memoize the assignment
  verdict across requests. Within one request the verdict may be reused
  (one DB read), but never across requests.
- **In-flight transaction:** an Exam-scoped command already inside its
  transaction when revocation lands completes normally (the gate ran
  before the transaction opened). New commands are rejected.
- **Polling UI:** the next polling refresh returns 404 for the now-
  unassigned exam — the UI removes it from the Proctor's list. No
  mid-poll inconsistency beyond the sub-request window.
- **Historical audit:** remains readable by Admin (`audit_log.view`); a
  revoked Proctor cannot read it (lacks the capability), but the audit
  rows are immutable and org-scoped.

## 11. Exam lifecycle interaction (§6.11)

Assignment is allowed in **any** exam status:

```text
draft       — assign allowed (pre-exam configuration is a primary use case)
published   — assign allowed
open        — assign allowed
closed      — assign allowed (post-exam review/investigation)
archived    — assign allowed (historical investigation)
canceled    — assign allowed
```

Rationale: assignments are commonly configured **before** an exam opens
(pre-exam staff planning), and post-exam investigation (ADR-014 incidents
are explicitly allowed in any exam status) may require assigning a
Proctor to a closed/archived exam. Restricting assignment by exam status
would block both. Revocation is likewise allowed in any status.

The resolver does **not** filter by exam status: an assignment to an
archived exam is still a valid assignment for incident-investigation
authority. Exam-status policy is an Exam-lifecycle concern, not an
assignment concern.

## 12. Proctor qualification (§6.12)

`assignProctorToExam()` MUST validate, before writing:

```text
- target user exists
- same organization as ctx (subject-mismatch → fail-closed)
- target user is active (!users.isActive → 400 VALIDATION_ERROR)
- target user has an active Proctor role assignment
  (a user_role_assignments row, role='Proctor', is_active=true)
```

Decisions (frozen):

- **Role-loss behavior:** if the user later loses the Proctor role, the
  `exam_proctor_assignments` row **remains** as the resource relationship
  (history + potential reactivation target), but runtime authority stops
  because the triple (§3) requires an active Proctor role. The assignment
  is **not** auto-revoked.
- **Role restoration:** if the user regains the Proctor role, the existing
  active assignment **automatically authorizes again** — no reassignment
  command needed. The assignment row stayed `status='active'`; only the
  role was absent.
- **No auto-revoke on role revocation:** role lifecycle and assignment
  lifecycle are **decoupled**. Coupling them would silently destroy
  assignment history and complicate audit. The triple check is the
  enforcement; the row is the relationship.

This deliberately does **not** couple role lifecycle to assignment
lifecycle (matches the ADR-014 §8 philosophy: "the assignment row can
remain as historical/resource relationship, but runtime requires both
active role and active assignment").

## 13. Initial Proctor capabilities (§6.13)

Frozen first-batch activation (applied by J4-I1D, **after** resolver
enforcement lands in J4-I1B):

```text
Allowed when assigned (frozen low-risk set):
  - view assigned Exam live status         (ExamRoomView)
  - view assigned Exam Attempts            (AttemptStatusView, AttemptTimelineView)
  - incident.view                           (NEW Proctor grant)
  - incident.create                         (NEW Proctor grant)
  - incident.investigate                    (NEW Proctor grant — start, note,
                                            severity, action/attempt/interruption links)
  - add Incident notes                      (incident.investigate)
  - link interruption/attempt evidence
    where permitted                         (incident.investigate)
```

```text
Still DENIED (deferred or forbidden):
  - incident.resolve                        (terminal judgment; Admin-only)
  - incident.dismiss                        (terminal judgment; Admin-only)
  - attempt.time.grant                      (deferred — dangerous; Admin-only;
                                            separate policy profile decision)
  - attempt.force_submit                    (deferred — dangerous; even though
                                            the Proctor preset currently grants
                                            it org-wide, J4-I1D MUST NOT
                                            activate it as a Proctor product
                                            capability until a separate
                                            policy decision)
  - misconduct final authority              (the suspected-misconduct *incident*
                                            is not the misconduct *mark*)
  - settings mutation                       (Admin-only)
  - Exam lifecycle mutation                 (publish/close/cancel/archive —
                                            Admin/Teacher)
  - grading.*                               (Grader domain)
  - score.all.view / score.export           (Admin/Teacher)
```

### Critical note on the pre-existing force-submit grant

The Proctor preset **already** grants `AttemptForceSubmit` and
`AttemptMisconductMark` org-wide (reality audit §4.2). J4-R0 does **not**
silently accept this as the Proctor product capability set. The frozen
policy is:

- J4-I1D does **not** activate `AttemptForceSubmit` or
  `AttemptMisconductMark` as named Proctor product capabilities in the
  initial batch. They remain in the preset (compatibility) but the
  **product activation** (UI, scoped route consumption) is deferred to a
  separate "dangerous permissions" policy profile (future Job).
- Until that profile lands, the J4-I1B resolver flip (§10 decomposition)
  makes those routes `requireScopedCapability`, so even a Proctor with the
  preset grant is restricted to assigned exams — closing reality-audit gap
  G1/G2 for the latent org-wide risk.
- A "suspected-misconduct incident" (`incident.type = suspected_misconduct`,
  ADR-014 §4) is **not** the same fact as an `attempt.misconduct.mark`
  command. J4-R0 does NOT grant the Proctor preset any new misconduct-mark
  authority, and does NOT wire a `misconduct_mark` Incident action link
  (that remains deferred per ADR-014 §7).

## 14. Audit (§6.14)

Frozen audit actions:

```text
exam.proctor_assigned
exam.proctor_revoked
```

Frozen audit payload (per event, bounded to the 4096-byte metadata limit,
ADR-006):

```text
organization       (ctx.organizationId)
examId             (the assignment's examId)
proctorUserId      (the assignment's proctorUserId)
assignmentId       (the episode id)
actorId            (ctx.actorId — server-derived; never from body)
operationId        (command identity)
assignedAt / revokedAt  (server time)
reasonCode         (where provided; ≤100 chars)
```

Rules:

- Free-text `reasonText`, if ever added, stays in a dedicated column, NOT
  in audit metadata.
- Candidate PII / candidate answers MUST NOT appear in assignment audit
  metadata (an assignment is a staff relationship, not a candidate fact).
- `reasonCode` is **optional** on both assign and revoke (the operator may
  omit it); a future policy may require it on revoke. Not frozen as
  required in V1.

## 15. Persistence proposal (§6.15) — design only, no migration

One table is sufficient (no separate event table required for V1):

```text
exam_proctor_assignments
  id                text PK                          (house id())
  organization_id   text NOT NULL                    (composite FK to exams/users)
  exam_id           text NOT NULL                    (composite FK to exams)
  proctor_user_id   text NOT NULL                    (FK to users)
  status            text NOT NULL
                    CHECK (status IN ('active','revoked')) DEFAULT 'active'
  assigned_by       text NOT NULL                    (FK to users)
  assigned_at       timestamptz NOT NULL
  revoked_by        text NULL                        (FK to users, NULL while active)
  revoked_at        timestamptz NULL
  reason_code       text NULL
  operation_id      uuid NOT NULL                    (command identity; first write)
  created_at        timestamptz NOT NULL
  updated_at        timestamptz NOT NULL

  -- one active episode per (org, exam, proctor)
  UNIQUE INDEX exam_proctor_assignments_active_unique
    ON (organization_id, exam_id, proctor_user_id)
    WHERE status = 'active'

  -- operation-id arbiter for replay detection (one row per command)
  UNIQUE INDEX exam_proctor_assignments_org_operation_unique
    ON (organization_id, operation_id)

  -- composite FKs reuse existing uniques (zero changes to existing tables),
  -- mirroring ADR-014 §12
  composite FK (organization_id, exam_id)      → exams (organization_id, id)
  composite FK (organization_id, proctor_user_id) → users (organization_id, id)  [if such unique exists; else plain FK on proctor_user_id → users(id)]

  indexes:
    (organization_id, exam_id, status)            -- listExamProctors
    (organization_id, proctor_user_id, status)    -- listProctorExams
```

### Why one table is sufficient

- The assignment has only two states (`active`/`revoked`); there is no
  multi-step investigation lifecycle (contrast ADR-014's incident, which
  has 4 statuses + 9 event types and needs a separate event store).
- History is preserved by keeping revoked rows (status model).
- Replay detection is satisfied by the `operation_id` unique on the
  assignment row itself (one row per command; a duplicate `operation_id`
  is the replay signal). If J4-I1A later decides a Proctor assignment
  needs richer event history (e.g. reason-text changes, reassignment
  chains as structured events), it MAY add an
  `exam_proctor_assignment_events` append-only table then — but V1 does
  not require it. This is the minimal sufficient model.

### Required column / constraint list (frozen for J4-I1A)

- **columns:** as above; `text` ids/actors, `uuid` operation_id, `timestamptz`
  times — matches ADR-014 §12 house conventions.
- **PK:** `id` (text).
- **tenant composite FKs:** `(organization_id, exam_id) → exams`; the
  proctor FK reuses an existing users unique where possible.
- **active uniqueness:** partial unique
  `(organization_id, exam_id, proctor_user_id) WHERE status='active'`.
- **operation uniqueness:** `(organization_id, operation_id)`.
- **indexes:** the two list indexes above.
- **checks:** `status IN ('active','revoked')`.
- **no-cascade policy:** NO `ON DELETE CASCADE`. Exam/User deletion fails
  closed while an assignment references them (assignments are durable
  records). This matches ADR-014 §12. J4-I1A MUST decide the Exam/User
  soft-delete interaction (see §19 retention) — likely the FK uses default
  no-action and Exam/User deletion is blocked while assignments exist, or
  the assignment rows are soft-revoked first by a migration helper.
- **rollback policy:** the table is additive (one new table, zero changes
  to existing tables, composite FKs reuse existing uniques). Rollback
  before any assignment row is written is a plain `DROP TABLE`. After
  activation, rollback MUST be data-preserving (mark deprecated / add a
  CHECK blocking new writes), mirroring the ADR-014 §14 rule.

## 16. API proposal (§6.16) — design only

Frozen Admin assignment API (REST style, matching the existing house
convention — `/admin/...` prefix, not `/api/admin/...`):

```http
POST   /admin/exams/:examId/proctors                        assign
GET    /admin/exams/:examId/proctors                        list (incident.view-equivalent read)
DELETE /admin/exams/:examId/proctors/:proctorUserId         revoke (idempotent)
```

**Decision: DELETE for revoke** (not a `POST .../revoke` command route).
Rationale:

- DELETE is the house idiom for "remove this resource" and the route is
  idempotent (deleting an already-revoked assignment returns the
  committed revoked state, `idempotent_replayed`).
- The Proctor-to-Exam assignment is a simple resource
  (`/exams/:examId/proctors/:proctorUserId`), not a multi-step command
  like an incident transition. REST semantics fit.
- The body still carries `operationId` (and optional `reasonCode`) so the
  idempotency contract (§6.6) holds; DELETE-with-body is supported by
  Fastify and is already used elsewhere in the codebase where an
  idempotent destructive op needs an operation id.
- The alternative `POST /admin/exams/:examId/proctors/:proctorUserId/revoke`
  is acceptable but adds a verb-suffix route for no semantic gain.

Responses project the assignment (including `status`, `assignedAt`,
`revokedAt`) plus the command outcome (`applied` | `idempotent_replayed`).

Proctor **resource-access** routes (incident read/create/investigate,
monitoring reads) reuse the **existing** `/admin/...` handlers under scoped
authority — no new `/proctor/...` runtime routes in J4. The recovery
centers (J5/J6) own any Proctor-facing URL surface.

### Error contract (frozen, matches ADR-014 §13 + house codes)

| Condition | HTTP | Code |
| --- | --- | --- |
| exam / proctor not found; cross-organization access | 404 | `RESOURCE_NOT_FOUND` |
| proctor lacks active Proctor role; user inactive | 400 | `VALIDATION_ERROR` |
| capability denied (non-Admin caller) | 403 | `PERMISSION_DENIED` |
| `operationId` reused with a different canonical payload | 409 | `IDEMPOTENCY_CONFLICT` |
| authorization service unavailable | 503 | `AUTHZ_UNAVAILABLE` (fail-closed) |

No new message-registry codes are required for the assignment API (the
above all exist). J4-I1C reuses them unchanged.

## 17. UI proposal (§6.17) — workflow sketch only, not implemented

Admin (J5) needs:

```text
- Exam staff/proctor assignment UI
  - list active + revoked proctors per exam
  - assign (user picker filtered to active Proctor-role users)
  - revoke (confirmation; optional reason)
  - audit link (jump to the exam.proctor_assigned/revoked audit row)
```

Proctor UI (J6) is out of scope for J4. The resolver + assignment
enforcement (J4-I1B) is what makes the eventual Proctor UI safe; the UI
itself is a separate Job.

## 18. Migration / backfill (§6.18)

Current deployments may have Proctor *role* users but have **no** Exam
assignments (none exist — reality audit §4.5).

Frozen policy:

```text
FAIL CLOSED by default.
```

- J4-I1 MUST NOT auto-assign all Proctors to all Exams.
- J4-I1 MUST NOT synthesize assignments from `users.role='Proctor'` or
  from `proctor.incident_marked` audit history (the audit-event-only
  marker is not an assignment fact — ADR-014 §15).
- After J4-I1 lands, a Proctor with the role but zero assignments sees
  **zero** exams (404 on every exam-scoped route). This is the correct
  fail-closed outcome.
- Bootstrap options an operator MAY use (not auto-run by J4-I1):
  - Admin explicitly assigns Proctors via the assignment API (the normal
    path);
  - an **optional**, operator-run, idempotent bootstrap script
    (`scripts/`-level, not a product API) that reads an org-supplied
    mapping and calls `assignProctorToExam()` with explicit operationIds;
  - development/test seed only (demo seed may add assignments for E2E);
  - **no production wildcard assignment** is permitted.

## 19. Retention and delete (§6.19)

Frozen:

```text
assignment history is NOT physically deleted through normal product APIs.
```

- Assignment rows are durable records (status model; revoked rows remain).
- Exam deletion: the composite FK to exams uses default no-action, so
  deleting an exam that still has assignment rows fails closed. The
  operator must soft-archive the exam (the house pattern) rather than hard
  -delete it; assignment rows then persist as historical references.
- User deletion / deactivation:
  - **deactivation** (`users.isActive = false`): the user cannot
    authenticate (gate at `authenticate`), so the assignment is inert.
    The assignment row is NOT auto-revoked (decoupled lifecycles, §12).
  - **hard delete** (`DELETE /users/:id`): blocked by the FK while
    assignments reference the user; the last-admin guard and existing
    user-delete protections already make hard-delete rare. J4-I1A MUST
    confirm the FK behavior and, if needed, add a guard that refuses
    user-delete while active assignments exist.
- **No cascade:** explicitly forbidden (§15 no-cascade policy).
- **Soft-revoke on exam archive:** not required. An assignment to an
  archived exam is a valid historical relationship (post-exam
  investigation, ADR-014).

## 20. Permission matrix (§7)

Final matrix. "Assigned Proctor" = a Proctor with an active
Proctor-to-Exam assignment to the exam in question. "Unassigned Proctor"
= a Proctor without such an assignment. Symbols: ✅ Yes · ❌ No · ⚠️
Deferred (separate policy profile, not in J4-I1D initial batch).

| Operation | Admin | Assigned Proctor | Unassigned Proctor | Teacher | Grader |
| --- | :---: | :---: | :---: | :---: | :---: |
| List Exam proctors | ✅ | ❌ | ❌ | ❌ | ❌ |
| Assign Proctor | ✅ | ❌ | ❌ | ❌ | ❌ |
| Revoke Proctor | ✅ | ❌ | ❌ | ❌ | ❌ |
| View Exam live status | ✅ | ✅ | ❌ (404) | ❌ | ❌ |
| View Exam Attempts (status/timeline) | ✅ | ✅ | ❌ (404) | ❌ | ❌ |
| View Incident | ✅ | ✅ | ❌ (404) | ❌ | ❌ |
| Create Incident | ✅ | ✅ | ❌ (404) | ❌ | ❌ |
| Investigate / add note / link evidence | ✅ | ✅ | ❌ (404) | ❌ | ❌ |
| Resolve / dismiss incident | ✅ | ❌ (Admin-only; terminal judgment) | ❌ | ❌ | ❌ |
| Grant time (`attempt.time.grant`) | ✅ | ⚠️ Deferred | ❌ (404) | ❌ | ❌ |
| Force submit (`attempt.force_submit`) | ✅ | ⚠️ Deferred | ❌ (404) | ❌ | ❌ |
| Mark misconduct (`attempt.misconduct.mark`) | ✅ | ⚠️ Deferred | ❌ (404) | ❌ | ❌ |
| Grading / score / result-publish | ✅ | ❌ | ❌ | (Teacher: scoped, separate M11) | (Grader: scoped, separate M11) |

This matrix is consistent with the ADR text: the deferred rows (⚠️) are
the dangerous-permission set that requires a separate policy profile
decision (§13). J4-I1D activates only the non-deferred Proctor grants
(`ExamRoomView`, `AttemptStatusView`, `AttemptTimelineView`,
`IncidentView`, `IncidentCreate`, `IncidentInvestigate`) and only behind
the resolver enforcement from J4-I1B.

## 21. Transaction table (§8)

Lock order is frozen; "implementation decides" is not acceptable.

| Command | Locks | Validation | Writes | Audit | Idempotency |
| --- | --- | --- | --- | --- | --- |
| `assignProctorToExam` | none beyond the new row (insert-arbiterated) | non-locking reads: exam exists in org; proctor exists, active, has active Proctor role; (optional) not already active | INSERT `exam_proctor_assignments` (status='active'); on 23505 active-unique → rollback → fresh-tx query → return existing active (`idempotent_replayed`); on 23505 operation-unique → rollback → fresh-tx query → replay/conflict | atomic `exam.proctor_assigned` in same tx (skipped on replay) | `operationId` + canonical payload; duplicate assign returns existing active |
| `revokeProctorFromExam` | `SELECT ... FOR UPDATE` on the active `exam_proctor_assignments` row | non-locking: assignment exists & is active (or already revoked → replay) | UPDATE row → status='revoked', revoked_at, revoked_by; inside the row lock | atomic `exam.proctor_revoked` in same tx (skipped on replay) | `operationId` + canonical payload; revoke of already-revoked → return committed revoked (`idempotent_replayed`) |

**Lock order (frozen):** the assignment transaction does **not** lock Exam
or Attempt rows. Exam/proctor existence and role validity are non-locking
reads. This keeps assignment operations deadlock-free against the ADR-013
chain (`Enrollment → Attempt → Exam`) and against ADR-014 incident
commands. If a future shared transaction ever locks both an assignment
row and an Exam row, the assignment lock MUST be taken strictly AFTER the
Exam lock (append-only extension; no reordering of the existing three).

## 22. Threat model (§9)

| Threat | Required invariant | Planned enforcement layer | Required test |
| --- | --- | --- | --- |
| ID guessing (Proctor probes unassigned exam id) | Unassigned exam is indistinguishable from missing | Resolver returns 404 for in-org-but-unassigned (§9) | Proctor GET assigned-exam-literal → 200; GET unassigned-exam-id → 404 (same shape as missing) |
| Cross-Exam Attempt access (Proctor uses an attempt id from another exam) | Attempt→Exam chain + assignment check | Attempt resolver + assignment check on the resolved exam (§8) | Proctor with assignment to exam A calls `/admin/attempts/:attemptOfB/...` → 404 |
| Cross-Exam Incident access | Incident→Exam resolver + assignment check | New incident resolver (§8) wired into all 11 incident routes | Proctor assigned to exam A reads `/admin/incidents/:incidentOfB` → 404 |
| Cross-organization resource access | Org filter on every read | Existing resolver org check + assignment table `organization_id` | Cross-org Proctor token → 404 |
| Role-only authorization bypass (Proctor role alone grants exam access) | Triple (§3) | Assignment check runs after capability check; capability alone insufficient | Proctor with role but zero assignments → 404 on all exam routes |
| Assignment-only bypass (active assignment but no Proctor role) | Triple (§3) | Per-request role load; assignment row without active role denies | User with active assignment but deactivated Proctor role → 404/403 |
| Stale session (JWT carries stale role/assignment) | Authority is per-request, not JWT-cached | `loadAssignmentAuthority` per request; assignment resolver per request (§10) | Revoke assignment → next request 404 (not 200) |
| Revocation race | Revocation effective on next request | Per-request resolver; no cross-request cache (§10) | Concurrent revoke + request → request either completes (gate already passed) or 404 (gate after revoke) |
| Duplicate assignment (two concurrent assigns) | One active row per (org, exam, proctor) | Partial unique index + 23505 recovery (§7) | Two concurrent assign → one winner, one `idempotent_replayed`, single active row |
| Concurrent assign/revoke | No split-brain active | Active-unique + row lock on revoke (§7) | assign vs revoke on same (exam,proctor) → ends in exactly one consistent state |
| Admin represented as fake assignment rows | Admin bypasses via short-circuit, not via rows | Resolver short-circuits Admin (§2); no `exam_proctor_assignments` row for Admin | Admin token works with zero assignment rows; assert no Admin assignment row exists |
| Route metadata not consumed at runtime (registry lies) | Wired preHandler matches registry | J4-I1B flips flat sensitive routes to `requireScopedCapability`; conformance test guards drift | Route-registry ↔ runtime conformance test (extend the existing whole-app lock) |
| UI-only filtering (backend does not enforce) | Backend resolver is authority | Resolver enforces regardless of UI | Direct API call by Proctor to unassigned exam → 404 (UI-independent) |
| Audit omission | Every assign/revoke audited exactly once | Atomic audit in same tx; skipped on replay | Concurrent assign → exactly one `exam.proctor_assigned` audit row |

## 23. Implementation decomposition (§10)

After ADR acceptance, the J4-I1 PR stack is frozen. Smaller is better; the
four slices MUST NOT collapse into one giant PR.

```text
J4-I1A — Persistence + domain contracts
  - migration for exam_proctor_assignments (one additive table; zero
    changes to existing tables; composite FKs reuse existing uniques)
  - domain types (ExamProctorAssignment, AssignmentStatus)
  - repository (ctx-first, organization-scoped, tx-bound factory)
  - assignProctorToExam() / revokeProctorFromExam() commands with
    operationId idempotency, canonical payload comparator, 23505 recovery
  - audit actions exam.proctor_assigned / exam.proctor_revoked
  - unit + concurrency + idempotency-replay tests
  - NO permission activation, NO resolver, NO route

J4-I1B — Scoped resolver runtime
  - Incident→Exam resolver (new)
  - Proctor-assignment enforcement layer in the per-request path
    (after capability check, after resource resolver, Proctor actors only;
    Admin short-circuit)
  - flip the flat sensitive routes to requireScopedCapability:
      POST /admin/attempts/:attemptId/misconduct
      POST /admin/attempts/:attemptId/force-submit
      (registry already declares Scope.Attempt / resolver "attempt")
      all 11 incident routes (add exam/incident resolver wiring)
  - extend the route-registry ↔ runtime conformance lock to cover the
    newly-scoped routes
  - NO Proctor permission activation yet (the resolver enforces, but the
    Proctor preset gains no incident.* permission in this slice)

J4-I1C — Admin assignment API
  - POST /admin/exams/:examId/proctors
  - GET  /admin/exams/:examId/proctors
  - DELETE /admin/exams/:examId/proctors/:proctorUserId
  - OpenAPI regeneration
  - integration tests (assign/revoke/list, idempotency, 403/404 policy,
    Proctor-role validation, cross-org denial)
  - Admin UI is OPTIONAL here or a separate PR (J5 owns the full UI)

J4-I1D — Proctor minimum activation
  - grant IncidentView / IncidentCreate / IncidentInvestigate to the
    Proctor preset (the ADR-014 §8 target grant)
  - confirm ExamRoomView / AttemptStatusView / AttemptTimelineView are
    reachable only through scoped routes (J4-I1B landed them)
  - DO NOT activate AttemptForceSubmit / AttemptMisconductMark /
    AttemptTimeGrant as Proctor product capabilities (deferred §13)
  - cross-Exam denial browser E2E
  - closeout audit + status updates
```

### Hard ordering rule (frozen)

```text
Do not activate Proctor permissions before resolver enforcement exists.
```

J4-I1D MUST land strictly after J4-I1B. J4-I1B (resolver flip) may land
before or after J4-I1A (persistence) — but J4-I1D requires both. The
recommended order is A → B → C → D.

## 24. Redis exclusion (§12 acceptance item)

Redis is **explicitly excluded** from the authorization authority path.
PostgreSQL is the sole source of truth for Proctor-to-Exam assignment and
for the capability/assignment resolver verdict. This matches ADR-010
(§Audit Boundary, §Redis Boundary) and the recovery-jobs rule "Redis used
for authorization" is a forbidden shortcut. Redis MAY be adopted later for
non-authority concerns (rate limiting, presence) only under the P7-D1 /
ADR-001 decision gate; it MUST NOT own assignment or capability state.

## 25. Consequences and acceptance

When accepted and implemented by J4-I1 (A→D):

- every Proctor Exam-scoped operation requires the triple — active role,
  active assignment, explicit permission — enforced per request;
- Admin remains organization-wide Exam authority without fake assignment
  rows;
- Proctor→Exam assignment is a durable, append-preserving aggregate with
  monotonic revocation and DB-arbiterated concurrency;
- the Incident→Exam resolver and the Proctor-assignment enforcement layer
  close reality-audit gaps G1–G3, G7;
- the pre-existing org-wide `AttemptForceSubmit`/`AttemptMisconductMark`
  Proctor grants are scoped by the resolver (J4-I1B) even though their
  product activation is deferred;
- ADR-014's "Proctor receives incident permission when J4/M11 lands scoped
  authority" condition is satisfied by J4-I1D;
- revocation (role or assignment) is effective on the next request, with
  no JWT-cache lag;
- 403/404 policy is uniform across all sensitive routes (anti-enumeration);
- assignment history is durable and never physically deleted through
  product APIs.

Acceptance of this ADR does **not** authorize J5/J6, system incidents,
custom roles, multiTenant, SuperAdmin, Redis, or any Phase 4 work.

## 26. Acceptance checklist (§12)

An ADR-015 reviewer MUST confirm every item before marking Accepted.

```text
[ ] assignment aggregate frozen (§4)
[ ] role + permission + resource triple frozen (§3)
[ ] Admin bypass policy frozen (§2)
[ ] 403/404 policy frozen (§9)
[ ] assign/revoke commands frozen (§5)
[ ] operationId semantics frozen (§6)
[ ] concurrency and unique arbiters frozen (§7)
[ ] revocation timing frozen (§10)
[ ] Exam/Attempt/Incident resolvers frozen (§8)
[ ] initial Proctor permission set frozen (§13)
[ ] dangerous permissions explicitly deferred or decided (§13)
[ ] audit payload frozen (§14)
[ ] persistence proposal frozen (§15)
[ ] API proposal frozen (§16)
[ ] migration/backfill policy frozen (§18)
[ ] retention/delete policy frozen (§19)
[ ] test matrix frozen (§22 threat model + §23 decomposition)
[ ] J4-I1 decomposition frozen (§23)
[ ] Redis explicitly excluded from authorization authority (§24)
```

## 27. Relationship to existing authority

- **ADR-010 (Scoped RBAC):** this ADR is the first concrete
  resource-relationship slice built on the ADR-010 infrastructure. It does
  not modify the capability model, the assignment-backed authority kernel,
  or the preset/permission catalog mechanics.
- **ADR-013 (interruption/time policy):** the lock order
  `Enrollment → Attempt → Exam` is unchanged; assignment transactions do
  not lock Exam/Attempt rows and do not reorder the chain.
- **ADR-014 (incident authority):** satisfies the ADR-014 §8 condition
  ("Proctor receives no Incident permission until J4/M11 lands scoped
  authority"). J4-I1D applies the ADR-014 §8 target Proctor grant
  (`incident.view/create/investigate`) together with the exam-scope
  enforcement from J4-I1B. The Proctor preset continues to NOT hold
  `incident.resolve`.

## 28. Alternatives considered

| Alternative | Verdict | Reason |
| --- | --- | --- |
| A. Organization-wide Proctor authority (status quo preset) | REJECT | ADR-014 forbids it for incidents; the preset's org-wide force-submit/misconduct are a latent risk (reality audit G1/G2); fails the recovery-jobs §13 forbidden-shortcut rule |
| B. `scope_type`/`scope_resource_id` columns on `user_role_assignments` | DEFER (not J4) | A general resource-scope dimension on the role table is a bigger change that implies Teacher@Course and Grader@Work too; J4 is deliberately the minimum Proctor→Exam slice. A dedicated `exam_proctor_assignments` table is simpler and matches the recovery-jobs §6 sketch |
| C. Append-only assignment events (no status column) | DEFER | Over-engineered for a 2-state lifecycle; the status-on-one-row model matches `user_role_assignments` and keeps the active-unique arbiter simple. An event table MAY be added later if richer history is needed (§15) |
| D. Dedicated `exam_proctor_assignments` table + status model | **ADOPTED** | minimal sufficient model; matches ADR-014 §12 additive-table discipline (zero changes to existing tables, composite FKs reuse existing uniques); monotonic revocation; clear active uniqueness |
| E. JWT-cached assignment claim | REJECT | revocation lag; violates §10 and ADR-010 per-request authority; stale-session threat (§22) |
| F. DELETE = fake assignment rows for Admin | REJECT | recovery-jobs §13 + §2 forbid; Admin short-circuit is the correct model |

---

**J4-I1 must not begin until this authority contract is independently
reviewed and accepted.**
