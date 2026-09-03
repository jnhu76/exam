# ADR-015 — Proctor-to-Exam Resource Scope Authority

## Status

**Accepted** — 2026-08-02

This ADR is **Accepted** and is the binding authority contract for
`M11-PROCTOR-EXAM-ASSIGNMENTS` (J4-I1).

It was authored as Proposed and reviewed through four independent
review rounds on PR #245 (head `58777282`), each round closing specific
contract-level blockers; the final independent review (the acceptance
evidence) confirmed all §26 checklist items. Acceptance authorizes J4-I1
to implement the frozen contract below per the §23 decomposition
(A → B → C → D). Acceptance does **not** itself implement any schema,
command, route, permission, preset, resolver, or UI behavior, and it does
not authorize J5/J6, system incidents, Redis, custom roles,
multiTenant, or SuperAdmin.

### Acceptance record

| Field | Value |
| --- | --- |
| Accepted | 2026-08-02 |
| Decision owner | jnhu76 |
| Review evidence | PR #245 final independent review (head `58777282`, 6 commits) — four review rounds; three-document adversarial consistency audit (10 criteria, all PASS) |
| Reality audit | [`docs/archive/audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md`](../archive/audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md) |
| Acceptance checklist | §26 (all items closed) |

## Metadata

| Field | Value |
| --- | --- |
| Date | 2026-08-02 |
| Accepted | 2026-08-02 |
| Decision owners | jnhu76 |
| Supersedes | none |
| Superseded by | — |
| Related decisions | ADR-010 (Scoped RBAC), ADR-013 (interruption/time policy), ADR-014 (incident authority) |
| Reality audit | [`docs/archive/audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md`](../archive/audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md) |
| Roadmap job | [`docs/archive/roadmap/recovery-operations-jobs.md`](../archive/roadmap/recovery-operations-jobs.md) §6 (J4) |
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

The recovery workstream (`docs/archive/roadmap/recovery-operations-jobs.md`) requires
that the **minimum** resource-relationship slice — Proctor → assigned Exam —
be frozen before any runtime work begins, so that J4-I1 implements frozen
semantics instead of inventing them. This ADR is that freeze. It is built
directly on the reality audit
([`M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md`](../archive/audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md)),
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
docs/archive/roadmap/recovery-operations-jobs.md §13 "Admin authority is not implemented by fake
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

Frozen two-table model (status episode table + append-only command-receipt
event table). The single-table approach considered in earlier drafts was
**rejected** on review: one `operation_id` column on the assignment row
cannot record both endpoints of an episode (the assign opId AND the revoke
opId), cannot record a `no_change` receipt for a duplicate-assign or
already-revoked call submitted under a *new* opId, and cannot serve as the
idempotency arbiter (the existing `audit_logs` has no `operation_id`
column — `packages/db/src/schema/pg.ts:831-851`). The model below mirrors
the ADR-014 precedent: a state-bearing parent table
(`exam_incidents` ↔ `exam_proctor_assignments`) plus an append-only
command-receipt table (`exam_incident_events` ↔
`exam_proctor_assignment_events`) whose
`UNIQUE (organization_id, operation_id)` is the idempotency arbiter.

### 4.1 `exam_proctor_assignments` — current episode state

```text
exam_proctor_assignments
  id                text PK                          (house id())
  organization_id   text NOT NULL                    (tenant boundary)
  exam_id           text NOT NULL
  proctor_user_id   text NOT NULL
  status            text NOT NULL  DEFAULT 'active'
  assigned_by       text NOT NULL
  assigned_at       timestamptz NOT NULL
  revoked_by        text NULL                        (NULL while active)
  revoked_at        timestamptz NULL                 (NULL while active)
  created_at        timestamptz NOT NULL
  updated_at        timestamptz NOT NULL
```

**No `operation_id` and no `reason_code` on this row.** operationId lives
on the event table (§4.2); reasonCode lives only inside the event's
`canonical_payload` (single source of truth, §4.2).

Constraints (frozen):

- `UNIQUE (organization_id, id)` — required so the event table can
  composite-FK to it. Mirrors `exam_incidents_org_id_unique`
  (`packages/db/src/schema/pg.ts:1234`).
- Partial unique `exam_proctor_assignments_active_unique`
  `ON (organization_id, exam_id, proctor_user_id) WHERE status='active'`.
- Named CHECK constraints (frozen verbatim — J4-I1A MUST use these names):

  ```sql
  CONSTRAINT exam_proctor_assignments_status_check
    CHECK (status IN ('active','revoked')),
  CONSTRAINT exam_proctor_assignments_revocation_shape_check
    CHECK (
      (status = 'active'  AND revoked_at IS NULL     AND revoked_by IS NULL)
      OR
      (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
    )
  ```

- Plain FKs `proctor_user_id`, `assigned_by`, `revoked_by` → `users(id)`,
  all `ON DELETE NO ACTION` (tenant consistency for users is enforced by
  command/repository, NOT by a DB composite tenant FK — see §15).
- Composite FK `(organization_id, exam_id) → exams(organization_id, id)`.
- Indexes:
  `(organization_id, exam_id, status)` (listExamProctors),
  `(organization_id, proctor_user_id, status)` (listProctorExams),
  `(organization_id, exam_id, proctor_user_id, status, revoked_at DESC, id DESC)`
  (revoke-target episode resolution — §6).

### 4.2 `exam_proctor_assignment_events` — append-only command receipts

```text
exam_proctor_assignment_events
  id                uuid PK
  organization_id   text NOT NULL
  assignment_id     text NOT NULL                    (FK to assignment episode)
  command_type      text NOT NULL  IN ('assign','revoke')
  operation_id      uuid NOT NULL
  canonical_payload jsonb NOT NULL
  outcome           text NOT NULL  IN ('applied','no_change')
  actor_id          text NOT NULL                    (FK to users; NEVER null)
  created_at        timestamptz NOT NULL
```

Constraints (frozen):

- `UNIQUE (organization_id, operation_id)` — **the idempotency arbiter**.
  This table (not `audit_logs`) is the sole replay/conflict authority.
- `assignment_id text NOT NULL`; **composite FK**
  `(organization_id, assignment_id) → exam_proctor_assignments(organization_id, id)`,
  mirroring `exam_incident_events_incident_fk`
  (`packages/db/src/schema/pg.ts:1319-1323`). NOT NULL is sound: every
  event acquires its `assignment_id` in the same transaction that creates
  or resolves the episode (applied assign = `INSERT episode → read id →
  INSERT event`; duplicate/already-revoked = resolve existing episode →
  INSERT event). There is no anonymous/actor-less event path.
- `actor_id text NOT NULL`, FK → `users(id)` `ON DELETE NO ACTION`. Assign
  and revoke are Admin human commands; there is no anonymous actor. If a
  future System-actor path is introduced it requires a separate authority
  decision — a nullable `actor_id` is not a back door.
- Index `(organization_id, assignment_id, created_at)`.

**Single source of truth for `reasonCode`:** it lives ONLY inside
`canonical_payload`. There is no separate `reason_code` column on either
table. The canonical payload is normalized as:

```text
assign canonical payload : { examId, proctorUserId, reasonCode }
revoke canonical payload : { examId, proctorUserId, reasonCode }
```

(`reasonCode` is trimmed-or-null in both cases.) `operationId` is **not**
part of the canonical payload — it is the unique key on the event row.
Replay/conflict comparison is `commandType + normalized canonicalPayload`;
reusing the same opId across command types (e.g. an opId first used for an
assign then re-submitted as a revoke) → 409 `IDEMPOTENCY_CONFLICT`.

### 4.3 Aggregate decisions (frozen)

- **Two-table model:** `exam_proctor_assignments` carries current episode
  state (active/revoked); `exam_proctor_assignment_events` is the
  append-only command-receipt store and the idempotency arbiter. The
  existing `audit_logs` records the compliance fact exactly once per
  applied state change (§14) but is NOT the replay arbiter.
- **History preservation:** an assignment row is **never physically
  deleted** through product APIs. Revocation sets `status='revoked'` +
  `revoked_at` + `revoked_by`; the row remains queryable. Reassignment
  creates a **new** active episode row, leaving the revoked row as history.
- **Multiple historical episodes allowed:** the same
  `(organization, exam, proctor)` MAY appear in many rows over time
  (assign → revoke → reassign → revoke …). Each row is one assignment
  *episode*.
- **Current-active uniqueness:** at most **one** active row per
  `(organization_id, exam_id, proctor_user_id)`. Enforced by the partial
  unique index (§4.1), mirroring `user_role_assignments_active_primary_unique`.
- **Stable assignment ID:** each episode has its own stable `id`. There is
  no "global assignment identity" that survives revoke/reassign; the id
  identifies one episode. Idempotent replay returns the **original**
  episode the operation created/resolved (see §6), which is why
  `assignment_id` on the event row is NOT NULL and why the events table is
  required — without it, a replayed assign opId cannot distinguish the
  first episode from a later reassign episode.
- **No `version` column:** assignment has no concurrent-writer versioning
  need beyond the active-unique arbiter and the event operation-unique
  arbiter (assign/revoke are idempotent via `operationId`, not optimistic
  concurrency — §6).
- **Reactivation policy:** `assignProctorToExam()` on an already-active
  `(exam, proctor)` is an idempotent `no_change` receipt (§6), **not** a
  reactivation of a revoked row. A revoked row is never resurrected;
  reassign creates a new active episode. This keeps "revocation is
  monotonic" provable.

## 5. Canonical commands (§6.5)

Frozen write commands:

```text
assignProctorToExam(ctx, { operationId, examId, proctorUserId, reasonCode? })
revokeProctorFromExam(ctx, { operationId, examId, proctorUserId, reasonCode? })
```

The revoke identity is **frozen to `{ operationId, examId, proctorUserId }`**.
The `assignmentId | examId+proctorUserId` alternation and the "lookup form"
from earlier drafts are removed: the API surface is `examId + proctorUserId`
(see §16), and the repository resolves the target episode internally (active
episode if one exists, else the most-recent revoked episode — §6). The
revoke transaction locks that resolved episode row.

Optional read commands (J4-I1C may add as needed):

```text
listExamProctors(ctx, examId, { status, limit, cursor })
  → status='active' (default) | 'all' | 'revoked'; keyset-paginate on
    (created_at, id); history statuses ('all'|'revoked') are Admin-only
    (ExamProctorAssignmentView).

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
| Canonical payload | `{ examId, proctorUserId, reasonCode }` (operationId is the event key, NOT in payload) | `{ examId, proctorUserId, reasonCode }` |
| Replay | same operationId + same canonical payload → `idempotent_replayed`, return the **original** episode the operation created/resolved, NO write | same operationId + same canonical payload → `idempotent_replayed`, return the **original** episode the operation revoked (the event row's `assignment_id`), NO write |
| Conflict | same operationId + different `commandType` or different canonical payload → 409 `IDEMPOTENCY_CONFLICT` | same |
| Duplicate assign (new operationId, already active) | write a `no_change` event receipt referencing the current active episode; return that active episode; NO episode mutation, NO audit (§6) | n/a |
| Revoke when already revoked (new operationId) | n/a | write one `no_change` event receipt referencing the most-recent revoked episode; return that episode; NO assignment mutation; NO compliance audit (§6) |
| Actor | `ctx.actorId` (server-derived; NEVER from request body; recorded as event `actor_id`, NOT NULL) | `ctx.actorId` (server-derived; NOT NULL) |
| Audit | `exam.proctor_assigned` (atomic, ONLY when applied) | `exam.proctor_revoked` (atomic, ONLY when applied) |
| Transaction boundary | one transaction: validate → INSERT episode (active) → read id → INSERT event(applied) → audit (§8) | one transaction: lock resolved episode → set revoked → INSERT event(applied) → audit (§8) |

## 6. Idempotency (§6.6)

```text
Every write command carries operationId.
```

Frozen semantics (mirroring ADR-013 / ADR-014, arbiter = events table):

```text
same operationId + same commandType + same canonical payload
  → idempotent replay: return the ORIGINAL episode the operation
    created/resolved (the event row's assignment_id), NO write.

same operationId + different commandType, or different canonical payload
  → 409 IDEMPOTENCY_CONFLICT.

new operationId + assign + already-active (exam, proctor)
  → no_change receipt: INSERT event(outcome=no_change, assignment_id=
    current active episode); return that active episode; NO episode
    mutation, NO audit.

new operationId + revoke + active episode exists
  → applied: lock+revoke the active episode; INSERT event(outcome=applied);
    audit once.

new operationId + revoke + NO active episode but ≥1 revoked episode
  → no_change receipt: resolve the most-recent revoked episode by
    (revoked_at DESC, id DESC) for (org, exam, proctor); INSERT event(
    outcome=no_change, assignment_id=that episode); return it; NO
    assignment mutation; NO compliance audit.

new operationId + revoke + NO episode of any kind for (org, exam, proctor)
  → 404 RESOURCE_NOT_FOUND.
```

### Episode-resolution table (frozen — every scenario has a deterministic assignment_id)

The NOT NULL `assignment_id` on every event row is sound because every
scenario resolves a concrete episode:

| Scenario | `assignment_id` referenced by the event | outcome | writes |
| --- | --- | --- | --- |
| applied assign | newly created episode (INSERT episode → read id → INSERT event) | applied | episode row + event(applied) + audit |
| duplicate assign, new opId, already active | current active episode | no_change | event(no_change) only |
| applied revoke | the active episode | applied | episode (→revoked) + event(applied) + audit |
| already-revoked, new opId | most-recent revoked episode by `(revoked_at DESC, id DESC)` for `(org, exam, proctor)` | no_change | event(no_change) only |
| revoke with NO episode of any kind for `(org, exam, proctor)` | — | — | 404 RESOURCE_NOT_FOUND |
| genuine network replay (same opId) | none — `(org, opId)` unique rejects; fresh-tx lookup returns the prior event + its payload | replay / conflict | none |

The multi-episode `already-revoked` rule is the reason the assignment table
carries the `(organization_id, exam_id, proctor_user_id, status, revoked_at
DESC, id DESC)` index (§4.1): without a frozen tie-break, the repository
would have to invent which historical revoked episode a `no_change`
receipt refers to. Reusing the `(org, exam, proctor, status)` index and
accepting the in-memory sort is acceptable, but the **query rule** is
frozen here, not left to J4-I1A.

**Why a duplicate assign is a `no_change` receipt, not 409:** assign is a
desired-state operation ("this proctor should be assigned"); calling it
twice with the same intent should not require the caller to remember the
first `operationId`. The active-unique partial index makes two concurrent
assigns resolve to one winner and one 23505-recovery receipt (§7), both
returning the same active episode — but the loser still writes its own
durable `no_change` event so a later replay of the loser's opId has
permanent evidence.

Canonical payload comparison trims strings (mirroring ADR-014's
canonicalization); J4-I1A ships the canonical comparator with tests.

## 7. Concurrency (§6.7)

### Required analysis (frozen outcomes)

| Race | Outcome |
| --- | --- |
| Two concurrent `assignProctorToExam` (same exam+proctor, different operationId) | The active-unique partial index admits exactly one INSERT winner; the loser hits 23505 on the named constraint and runs the §7 recovery algorithm, which writes the loser's own `no_change` event receipt referencing the recovery-snapshot episode (the active episode if one is visible in the fresh recovery transaction's MVCC snapshot, else the most-recent visible episode of any status by the frozen `(created_at DESC, id DESC)` order). No split-brain active rows; both operationIds leave permanent evidence. |
| Two concurrent `assignProctorToExam` (same operationId — retry) | The events-table `(org, opId)` unique admits exactly one event; the second is a replay (returns the original episode), NO write. |
| Assign vs revoke (same exam+proctor) | The active-unique index means exactly one active row exists. Whichever transaction locks/inserts first wins; the other either writes a `no_change` receipt (assign loser, per §7) or resolves the most-recent revoked episode (revoke when the active row was already revoked by the winner). |
| Two concurrent `revokeProctorFromExam` (same resolved episode) | The first UPDATE sets `status='revoked'` and writes an `applied` event; the second locks the same row, sees `status='revoked'`, writes a `no_change` event referencing that episode, NO audit. |
| Reassign after revoke | A new `assignProctorToExam` INSERTs a new active episode (the old revoked row is history); the active-unique index is satisfiable because the old row is `status='revoked'` and excluded by the partial unique. |
| Role revocation racing a resource request | Per-request authority load means a concurrently-deactivated Proctor role is detected on the next request. The resolver runs after `authenticate`, so a request past `authenticate` but not yet past the gate completes within the same request — sub-request window, acceptable. |
| Exam-assignment revocation racing a resource request | Same model: the assignment check is in the per-request resolver path; revocation blocks the next request. No JWT-cached assignment (§6.10). |

### Frozen arbiters and locks

- **DB unique arbiter (one active episode):**
  `exam_proctor_assignments_active_unique`
  `ON (organization_id, exam_id, proctor_user_id) WHERE status='active'`
  — partial unique index, mirroring
  `user_role_assignments_active_primary_unique`. Final arbiter for "one
  active assignment per (org, exam, proctor)".
- **Idempotency arbiter (replay/conflict):**
  `exam_proctor_assignment_events` with
  `UNIQUE (organization_id, operation_id)`. **The events table — NOT
  `audit_logs` — is the sole replay/conflict authority.** `audit_logs` has
  no `operation_id` column (`packages/db/src/schema/pg.ts:831-851`) and
  cannot serve as the operation arbiter. This is no longer a J4-I1A choice.
- **Row lock object (revoke):** `SELECT ... FOR UPDATE` on the resolved
  episode row (active if present, else most-recent revoked), inside the
  revoke transaction.
- **Isolation:** `REPEATABLE READ` (matching the incident commands and the
  `executeInTransaction` house default).
- **Audit exactly once:** the compliance audit row is written inside the
  same transaction as the assignment mutation, ONLY when `outcome=applied`;
  on `no_change` and on replay no audit is written.
- **No split-brain active rows:** the partial unique index guarantees it.

### 23505 loser-receipt recovery algorithm (frozen)

On a 23505 from the active-unique constraint during a competing
`assignProctorToExam`, the loser MUST form its own durable `no_change`
receipt — it MUST NOT simply fresh-read the winner and return. Otherwise
the loser's `operationId` leaves no permanent evidence, and a later replay
of that opId cannot be distinguished from a fresh command.

```text
1. rollback the failed transaction;
2. enter a fresh transaction;
3. query the event row by (organizationId, operationId):
     found → compare commandType + canonical payload
            → replay (idempotent_replayed) or IDEMPOTENCY_CONFLICT;
4. otherwise resolve an episode from the fresh recovery transaction's
     Repeatable Read snapshot — the active episode if one is visible,
     else the most-recent visible episode of any status by
     `(created_at DESC, id DESC)`. The referenced episode is a durable
     recovery anchor, not necessarily the physical row that triggered the
     original unique violation (Amendment A1);
5. INSERT event row:
     commandType      = assign
     assignmentId     = the recovery-snapshot episode resolved in step 4
     operationId      = the LOSING command's operationId
     canonicalPayload = the LOSING command's payload
     outcome          = no_change;
6. write NO compliance audit (no state change);
7. commit; return the no_change / idempotent-style outcome + the resolved episode.
```

Step 5 may itself race another recoverer using the same `operationId` →
event operation-unique 23505 → rollback → fresh-tx lookup → replay/conflict
(same recovery as step 3). This mirrors the PR #242 incident-operation
race pattern: the unique constraint is the final arbiter, but **every
losing operation still forms its own durable receipt**. 23505 from any
constraint other than the active-unique or the event operation-unique is
surfaced, never swallowed (mirrors ADR-014 §9).

> **Amendment A1 (2026-08-02, J4-I1A review):** Recovery resolves an episode
> from the fresh Repeatable Read transaction's fixed MVCC snapshot. It selects
> the active episode if one is visible; otherwise the most-recent visible
> episode of any status under the frozen order `(created_at DESC, id DESC)`.
> The selected episode is a durable recovery anchor and is **not** guaranteed
> to be the physical row that triggered the original unique violation. A
> reassignment committed before the recovery snapshot may be selected; one
> committed after the snapshot cannot be selected.
>
> The recovery snapshot is established by the first statement of the fresh
> transaction (`findEventByOperationId`). No application time bound is used.
> (The earlier formulation — `SELECT now()` as the snapshot bound plus a
> `created_at < bound` filter — was withdrawn: `now()` is the transaction-start
> timestamp, not the snapshot establishment time, and the filter compared a
> database clock against an application-supplied `created_at`, which reopened
> the no-evidence hole under host clock skew. The MVCC snapshot itself is the
> race window.) When no active episode is visible (e.g. the winner was revoked
> before the recovery snapshot) the fallback to the most-recent visible episode
> of any status guarantees the loser still leaves permanent evidence.
>
> The invariant — every operationId that loses an assignment race leaves one
> durable receipt referencing a deterministic episode visible to its recovery
> snapshot — is unchanged. A later replay of the loser's `operationId` returns
> the same episode via the receipt's `assignment_id`.

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

### `proctorAccess` — Proctor route-access policy (frozen)

`proctorAccess` describes whether and how a Proctor actor may reach a
route. It does **not** replace target-resource existence, tenant, or
parent-chain validation. An `admin_only` route may still use
`requireScopedCapability` — `admin_only` is a *product-access* label
(Proctor cannot reach the route), not a directive to downgrade the gate to
flat `requireCapability`.

The route registry carries a frozen 5-valued `proctorAccess` field on
every route whose permission is — or will be — reachable by a Proctor:

```ts
proctorAccess:
  | "assignment_scoped"                 // resource resolver + Proctor
                                        // assignment enforcement
  | "assignment_filtered_collection"    // collection; Proctor sees only
                                        // the active-assignment-filtered set
  | "admin_only"                        // permission NOT in Proctor preset;
                                        // Proctor-unreachable
  | "deferred"                          // future policy profile; Proctor-
                                        // unreachable at runtime
  | "not_applicable";
```

The full Proctor-reachable route inventory (frozen, derived from the
reality audit §4.4) and each route's `proctorAccess` + gate:

| Route | `proctorAccess` | Gate (always scoped where a resource id exists) |
| --- | --- | --- |
| `GET /admin/proctor/exams` | `assignment_filtered_collection` | Admin → all in-org exams; Proctor → only exams with an active assignment (`WHERE EXISTS active assignment`). No single-resource resolver; the filter is the enforcement. |
| `GET /admin/exams/:examId/proctor/attempts` | `assignment_scoped` | `requireScopedCapability(..., "exam", "examId")` + Proctor-assignment enforcement |
| `GET /admin/attempts/:attemptId/proctor-events` | `assignment_scoped` | `requireScopedCapability(..., "attempt", "attemptId")` + Proctor-assignment enforcement |
| `GET /admin/attempts/:attemptId/timeline` | `assignment_scoped` | flip flat → `requireScopedCapability(..., "attempt", "attemptId")` + enforcement |
| `POST /admin/attempts/:attemptId/misconduct` | `admin_only` | flip flat → `requireScopedCapability(AttemptMisconductMark, "attempt", "attemptId")` — **stays scoped**; grant removed from Proctor preset in J4-I1B (§13) |
| `POST /admin/attempts/:attemptId/force-submit` | `admin_only` | flip flat → `requireScopedCapability(AttemptForceSubmit, "attempt", "attemptId")` — stays scoped; grant removed in J4-I1B (§13) |
| `POST /admin/attempts/:attemptId/proctor-incident` | `admin_only` (deprecated) | **stays** `requireScopedCapability(AttemptMisconductMark, "attempt", "attemptId")`; `x-role:["Admin"]`, OpenAPI `deprecated:true`; NOT flat. Legacy audit-only marker, not `createExamIncident()` (§16). |
| incident view / create / investigate / note / severity / link-evidence routes | `assignment_scoped` | `requireScopedCapability(...)` + Incident→Exam resolver + Proctor-assignment enforcement |
| incident `resolve` / `dismiss` routes | `admin_only` | `requireScopedCapability(...)` — Admin-only (terminal judgment); permission NOT in Proctor preset |

### Structural `proctorAccess` conformance test (frozen, machine-checkable)

J4-I1B ships a conformance test that replaces hand-maintained route counts.
**Every route-registry entry MUST declare a `proctorAccess` value, and the
conformance test enumerates EVERY registry entry** — not only permissions
currently granted to Proctor. This is deliberate: J4-I1B *removes*
`AttemptForceSubmit`/`AttemptMisconductMark` from `PROCTOR_PERMISSIONS`, so
enumerating only the post-removal preset would silently drop the three
`admin_only` attempt routes (`misconduct`, `force-submit`,
`proctor-incident`) from coverage. The registry is the enumeration source
of truth; the preset is not.

Per-value checks, applied to every registry entry:

1. every entry MUST declare a `proctorAccess` value;
2. `assignment_scoped` consumers MUST wire
   `requireScopedCapability` + the Proctor-assignment enforcement layer;
3. `assignment_filtered_collection` consumers MUST prove their query
   contains the active-assignment filter (the Admin branch MAY
   organization-wide short-circuit);
4. `admin_only` routes' permissions MUST NOT appear in the Proctor preset
   (so the route is unreachable to a Proctor actor);
5. `deferred` routes MUST NOT be Proctor-reachable at runtime;
6. `not_applicable` routes carry no Proctor-specific invariant.

The test MUST cover — at minimum — every route in the §8 matrix, including
the three `admin_only` attempt routes and the incident terminal routes. If
the registry is not extended globally, an explicit frozen allow-list
`PROCTOR_ACCESS_POLICY_ROUTES` (containing exactly the §8 matrix routes)
MAY substitute; the post-removal `PROCTOR_PERMISSIONS` alone MUST NOT.

Dedicated assertions:

- `GET /admin/proctor/exams` — Admin token sees all in-org exams; Proctor
  token sees only exams with an active assignment (filter proven, not
  single-resource resolver).
- incident `resolve`/`dismiss` — `admin_only`, and the corresponding
  permissions are NOT in the Proctor preset.

This test extends the existing route-registry ↔ runtime conformance lock.

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
  - incident.resolve                        (terminal judgment; Admin-only;
                                            proctorAccess = admin_only)
  - incident.dismiss                        (terminal judgment; Admin-only;
                                            proctorAccess = admin_only)
  - attempt.time.grant                      (deferred — dangerous; Admin-only;
                                            separate policy profile decision)
  - attempt.force_submit                    (REMOVED from Proctor preset by
                                            J4-I1B — see critical note below;
                                            proctorAccess = admin_only)
  - attempt.misconduct.mark                 (REMOVED from Proctor preset by
                                            J4-I1B — see critical note below;
                                            proctorAccess = admin_only)
  - misconduct final authority              (the suspected-misconduct *incident*
                                            is not the misconduct *mark*)
  - settings mutation                       (Admin-only)
  - Exam lifecycle mutation                 (publish/close/cancel/archive —
                                            Admin/Teacher)
  - grading.*                               (Grader domain)
  - score.all.view / score.export           (Admin/Teacher)
```

### Critical note on the pre-existing force-submit / misconduct grants

The Proctor preset **already** grants `AttemptForceSubmit` and
`AttemptMisconductMark` (`packages/authz/src/presets.ts:151-160`,
`238-249`). The preset marks the role `assignable: true` and
`loginAllowed: true`, and `loadAssignmentAuthority` resolves capabilities
per request from active `user_role_assignments` rows; Admin can assign the
Proctor role via the role-assignment API today. The "deferred but not
activated" framing in earlier drafts is therefore **fictional**: any user
granted the Proctor role can already exercise these two capabilities
organization-wide. This is a current, reachable risk, not a future-only
one (reality audit §4.2 / G1 / G2 — reclassified).

The frozen policy is:

- **J4-I1B removes `AttemptForceSubmit` and `AttemptMisconductMark` from
  `PROCTOR_PERMISSIONS` atomically with the resolver flip.** The grants
  are *removed from the preset*, not "kept-but-inactive". A future
  dangerous-permissions policy profile must re-add them with its own
  activation gate; that profile is out of J4 scope.
- The affected route groups (the three attempt routes
  `POST /admin/attempts/:attemptId/misconduct`,
  `POST /admin/attempts/:attemptId/force-submit`,
  `POST /admin/attempts/:attemptId/proctor-incident`, and the incident
  terminal routes `resolve`/`dismiss`) become `proctorAccess = admin_only`
  (§8 matrix). They keep `requireScopedCapability` (the attempt/exam
  resolver still validates target existence, tenant, and parent chain) —
  `admin_only` does NOT downgrade the gate to flat.
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

The frozen two-table model is specified in full in §4.1 (`exam_proctor_assignments`)
and §4.2 (`exam_proctor_assignment_events`). This section records the
contract-level guarantees J4-I1A MUST satisfy; the column/constraint list
in §4 is authoritative.

### Tenant FK contract (frozen — corrected on review)

The earlier "composite FK `(organization_id, proctor_user_id) →
users(organization_id, id)` [if such unique exists; else plain FK]" wording
is **removed**. The reality is:

- `users` has only PK `id` and `users_org_username_unique` on
  `(organization_id, username)`; there is **no** `(organization_id, id)`
  unique (`packages/db/src/schema/pg.ts:111-138`), and every existing user
  reference in the repo is a plain single-column FK to `users(id)`.
- Therefore the proctor/assigned-by/revoked-by references use **plain
  single-column FKs → `users(id)`** (`ON DELETE NO ACTION`), matching the
  existing repo pattern. Tenant consistency for users is enforced by
  command/repository (`ctx.organizationId` equality check before write and
  on every read), NOT by a DB composite tenant FK.
- The composite FK `(organization_id, exam_id) → exams(organization_id, id)`
  is retained — `exams` carries the required `(organization_id, id)`
  unique.

### "No changes to existing tables" — retained and made truthful

This migration adds **two new tables** and edits **zero existing tables**.
The "no changes to existing tables" claim is therefore TRUE under the
plain-user-FK decision and is retained. What is removed is the false
sub-claim "all composite FKs reuse existing uniques" (false for the user
dimension) and any implication that the DB enforces tenant consistency for
all user references (it does not — that is an accepted application-level
trade-off).

### Required contract list (frozen for J4-I1A — see §4 for the full text)

- **two tables:** `exam_proctor_assignments` (episode state) +
  `exam_proctor_assignment_events` (append-only command receipts).
- **columns:** `text` ids/actors, `uuid` operation_id and event id,
  `timestamptz` times, `jsonb` canonical_payload — matches ADR-014 §12
  house conventions. **No `operation_id` and no `reason_code` column on
  the assignment table** (operationId lives on events; reasonCode lives
  only inside `canonical_payload`).
- **assignment PK + (org,id) unique:** `id` (text) PK, plus
  `UNIQUE (organization_id, id)` so events can composite-FK to it.
- **active uniqueness:** partial unique
  `(organization_id, exam_id, proctor_user_id) WHERE status='active'`.
- **named CHECKs:** `exam_proctor_assignments_status_check` and
  `exam_proctor_assignments_revocation_shape_check` (§4.1, frozen verbatim).
- **idempotency arbiter:** events table
  `UNIQUE (organization_id, operation_id)`; events → assignment composite
  FK `(organization_id, assignment_id)`; `assignment_id NOT NULL`;
  `actor_id NOT NULL` + FK→users(id).
- **indexes:** the three assignment indexes (list + list + revoke-target)
  and the event `(org, assignment_id, created_at)` index (§4).
- **no-cascade policy:** NO `ON DELETE CASCADE`. User/Exam deletion fails
  closed while an assignment references them. User hard-delete is blocked
  by the plain FK while assignment/event rows reference the user; the
  existing last-admin guard and user-delete protections already make
  hard-delete rare (§19).
- **rollback policy:** the two tables are additive and touch no existing
  table. Rollback before any assignment row is written is a plain
  `DROP TABLE` of both. After activation, rollback MUST be data-preserving
  (mark deprecated / add a CHECK blocking new writes), mirroring the
  ADR-014 §14 rule.

## 16. API proposal (§6.16) — design only

Frozen Admin assignment API (REST style, matching the existing house
convention — `/admin/...` prefix, not `/api/admin/...`):

```http
POST   /admin/exams/:examId/proctors                              assign
GET    /admin/exams/:examId/proctors                              list
POST   /admin/exams/:examId/proctors/:proctorUserId/revoke        revoke (idempotent)
```

**Decision: `POST .../revoke` for revoke** (not `DELETE`). The earlier
draft's "DELETE-with-body house precedent" is **false**: the existing
role-assignment DELETE (`apps/api/src/routes/roleAssignments.ts:287-335`)
carries NO body and NO `operationId`. DELETE-with-body is unreliably
supported by clients, proxies, and generators, and the revoke command
must carry `operationId` + optional `reasonCode`. A command route
`POST .../revoke` mirrors the operationId-command idiom used by the
ADR-014 incident transitions and gives the body first-class support.

Revoke request body: `{ operationId: UUIDv4, reasonCode?: string≤100 }`.
Responses project the assignment (including `status`, `assignedAt`,
`revokedAt`) plus the command outcome (`applied` | `no_change` |
`idempotent_replayed`).

### Assignment-API capability (frozen catalog strings, NO per-permission defaultScope)

The permission catalog is a closed set of strings; `Scope` is a separate
model and there is no per-permission `defaultScope` attribute. (The
`defaultScope` field that exists in the codebase lives on `RolePreset`,
e.g. Admin/Proctor/Grader at `packages/authz/src/presets.ts`, NOT on the
`Permission` string keys in `catalog.ts`. J4-I1C does not invent a
per-permission scope field.) The contract is frozen as:

```text
Permission keys:  exam.proctor_assignment.manage  (TS ExamProctorAssignmentManage)
                  exam.proctor_assignment.view    (TS ExamProctorAssignmentView)
Preset grant:     Admin only (NOT Proctor / Teacher / Grader)
Route registry:   scope = Scope.Exam, resolver = "exam"
Runtime:          requireScopedCapability(<permission>, "exam", "examId")
```

Route → permission:

```text
GET  /admin/exams/:examId/proctors                            → ExamProctorAssignmentView
POST /admin/exams/:examId/proctors                            → ExamProctorAssignmentManage
POST /admin/exams/:examId/proctors/:proctorUserId/revoke      → ExamProctorAssignmentManage
```

Admin short-circuits the assignment triple (§2) but does NOT skip the
target Exam existence + tenant check — the exam resolver still runs on
all three routes.

Proctor **resource-access** routes (incident read/create/investigate,
monitoring reads) reuse the **existing** `/admin/...` handlers under scoped
authority — no new `/proctor/...` runtime routes in J4. The recovery
centers (J5/J6) own any Proctor-facing URL surface.

### Legacy `POST /admin/attempts/:attemptId/proctor-incident` disposition (frozen)

The existing route (`apps/api/src/routes/proctorMonitoring.ts:200-286`)
is scoped (`requireScopedCapability(AttemptMisconductMark, "attempt",
"attemptId")`) but its handler writes only an audit-only
`ProctorIncidentMarked` marker — it does NOT call the ADR-014
`createExamIncident()` command. It is therefore **not** a safe Incident
creation path. Frozen disposition, applied in J4-I1B:

- the route **stays** `requireScopedCapability(AttemptMisconductMark,
  "attempt", "attemptId")` — it is NOT downgraded to a flat
  `requireCapability` gate (Admin still benefits from the attempt
  tenant/parent-chain check; the route registry and runtime do not drift);
- after J4-I1B removes `AttemptMisconductMark` from the Proctor preset
  (§13), only Admin holds the capability, so the route is effectively
  Admin-only;
- `x-role` becomes `["Admin"]` and OpenAPI marks the route `deprecated:
  true`;
- the sole incident-creation path available to an assigned Proctor is
  `createExamIncident()` via `POST /admin/exams/:examId/incidents`
  (J4-I1D grants `IncidentCreate`).

### Error contract (frozen, matches ADR-014 §13 + house codes)

| Condition | HTTP | Code |
| --- | --- | --- |
| exam / proctor not found; cross-organization access | 404 | `RESOURCE_NOT_FOUND` |
| proctor lacks active Proctor role; user inactive | 400 | `VALIDATION_ERROR` |
| capability denied (non-Admin caller) | 403 | `PERMISSION_DENIED` |
| `operationId` reused with a different `commandType` or canonical payload | 409 | `IDEMPOTENCY_CONFLICT` |
| authorization service unavailable | 503 | `AUTHZ_UNAVAILABLE` (fail-closed) |

No new message-registry codes are required for the assignment API (the
above all exist). J4-I1C reuses them unchanged.

## 17. UI proposal (§6.17) — workflow sketch only, not implemented

Admin (J5) needs:

```text
- Exam staff/proctor assignment UI
  - list proctors per exam via the parametrized read command
    `listExamProctors(ctx, examId, { status, limit, cursor })` (§5);
    default `status='active'`, with a history toggle (`status='all'|'revoked'`,
    Admin-only) and keyset pagination on `(created_at, id)`
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

- Assignment rows are durable records (status model; revoked rows remain);
  the named CHECKs `exam_proctor_assignments_status_check` and
  `exam_proctor_assignments_revocation_shape_check` (§4.1) keep
  `status`/`revoked_at`/`revoked_by` mutually consistent at the DB level.
- Exam deletion: the composite FK to exams uses default no-action, so
  deleting an exam that still has assignment rows fails closed. The
  operator must soft-archive the exam (the house pattern) rather than hard
  -delete it; assignment rows then persist as historical references.
- User deletion / deactivation (plain `users(id)` FK, §15):
  - **deactivation** (`users.isActive = false`): the user cannot
    authenticate (gate at `authenticate`), so the assignment is inert.
    The assignment row is NOT auto-revoked (decoupled lifecycles, §12).
  - **hard delete** (`DELETE /users/:id`): blocked by the plain
    `users(id)` FK (`ON DELETE NO ACTION`) while assignment OR event rows
    reference the user; the last-admin guard and existing user-delete
    protections already make hard-delete rare. J4-I1A MUST confirm the FK
    behavior and, if needed, add a guard that refuses user-delete while
    active assignments exist.
- **No cascade:** explicitly forbidden (§15 no-cascade policy).
- **Soft-revoke on exam archive:** not required. An assignment to an
  archived exam is a valid historical relationship (post-exam
  investigation, ADR-014).

## 20. Permission matrix (§7)

Final matrix. "Assigned Proctor" = a Proctor with an active
Proctor-to-Exam assignment to the exam in question. "Unassigned Proctor"
= a Proctor without such an assignment. Symbols: ✅ Yes · ❌ No · ⛔
Removed from Proctor preset by J4-I1B (§13) · ⚠️ Deferred (separate
policy profile, not in J4-I1D initial batch).

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
| Force submit (`attempt.force_submit`) | ✅ | ⛔ Removed (`proctorAccess=admin_only`) | ❌ | ❌ | ❌ |
| Mark misconduct (`attempt.misconduct.mark`) | ✅ | ⛔ Removed (`proctorAccess=admin_only`) | ❌ | ❌ | ❌ |
| Grading / score / result-publish | ✅ | ❌ | ❌ | (Teacher: scoped, separate M11) | (Grader: scoped, separate M11) |

This matrix is consistent with the ADR text. The ⚠️ Deferred row
(`attempt.time.grant`) is the one dangerous permission that remains
Admin-only and awaits a separate policy profile decision (§13). The ⛔
Removed rows (`attempt.force_submit`, `attempt.misconduct.mark`) are
deleted from `PROCTOR_PERMISSIONS` by J4-I1B (§13) — they are NOT
deferred Proctor capabilities; their routes become
`proctorAccess = admin_only` while keeping the scoped gate (§8). J4-I1D
activates only the non-deferred, non-removed Proctor grants
(`ExamRoomView`, `AttemptStatusView`, `AttemptTimelineView`,
`IncidentView`, `IncidentCreate`, `IncidentInvestigate`) and only behind
the resolver enforcement from J4-I1B.

## 21. Transaction table (§8)

Lock order is frozen; "implementation decides" is not acceptable.

| Command | Locks | Validation | Writes | Audit | Idempotency |
| --- | --- | --- | --- | --- | --- |
| `assignProctorToExam` | none beyond the new episode row (insert-arbiterated) | non-locking reads: exam exists in org; proctor exists, active, has active Proctor role; (optional) not already active | INSERT `exam_proctor_assignments` (active) → read id → INSERT `exam_proctor_assignment_events` (command=assign, assignment_id=new, outcome=applied); on 23505 active-unique → run §7 loser-receipt algorithm (fresh-tx `no_change` event referencing the committed active episode); on event operation-unique 23505 → fresh-tx lookup → replay/conflict | atomic `exam.proctor_assigned` in same tx, ONLY when `outcome=applied` | `operationId` + `commandType` + canonical payload; duplicate assign writes a `no_change` event referencing the current active episode |
| `revokeProctorFromExam` | `SELECT ... FOR UPDATE` on the resolved episode (active if present, else most-recent revoked) | non-locking: resolve target episode per §6 | if active: UPDATE episode → revoked + INSERT event(outcome=applied); if already revoked: INSERT event(outcome=no_change) referencing the most-recent revoked episode; if no episode of any kind: 404 RESOURCE_NOT_FOUND | atomic `exam.proctor_revoked` in same tx, ONLY when `outcome=applied` | `operationId` + `commandType` + canonical payload; revoke of already-revoked writes a `no_change` event referencing the most-recent revoked episode |

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
| Duplicate assignment (two concurrent assigns) | One active row per (org, exam, proctor) | Partial unique index + 23505 loser-receipt recovery (§7) | Two concurrent assign (different operationIds) → one `applied` + one `no_change`, one active assignment row, **two** durable operation receipts (the loser writes its own `no_change` event in a fresh tx) |
| Concurrent assign/revoke | No split-brain active | Active-unique + row lock on revoke (§7) | assign vs revoke on same (exam,proctor) → ends in exactly one consistent state |
| Admin represented as fake assignment rows | Admin bypasses via short-circuit, not via rows | Resolver short-circuits Admin (§2); no `exam_proctor_assignments` row for Admin | Admin token works with zero assignment rows; assert no Admin assignment row exists |
| Route metadata not consumed at runtime (registry lies) | Wired preHandler matches registry | J4-I1B flips flat sensitive routes to `requireScopedCapability`; conformance test guards drift | Route-registry ↔ runtime conformance test (extend the existing whole-app lock) |
| UI-only filtering (backend does not enforce) | Backend resolver is authority | Resolver enforces regardless of UI | Direct API call by Proctor to unassigned exam → 404 (UI-independent) |
| Audit omission | Every **applied** assign/revoke is audited exactly once; `no_change` and replay produce **no** compliance audit | Atomic audit in same tx, only when `outcome=applied`; skipped on `no_change` and replay | Two concurrent assign → one `applied` event + one `no_change` event + exactly one `exam.proctor_assigned` audit row |

## 23. Implementation decomposition (§10)

After ADR acceptance, the J4-I1 PR stack is frozen. Smaller is better; the
four slices MUST NOT collapse into one giant PR.

```text
J4-I1A — Persistence + domain contracts
  - migration for the two-table model: exam_proctor_assignments (with the
    named status/revocation CHECKs, partial active-unique, (org,id)
    unique, the revoke-target index, plain users(id) FKs, composite
    exam FK) + exam_proctor_assignment_events (with the (org,opId)
    unique, NOT NULL assignment_id + composite FK, NOT NULL actor_id +
    FK)
  - domain types (ExamProctorAssignment, AssignmentStatus,
    ExamProctorAssignmentEvent, CommandType, Outcome)
  - repository (ctx-first, organization-scoped, tx-bound factory);
    tenant consistency for users enforced at command/repository layer
  - assignProctorToExam() / revokeProctorFromExam() commands with
    operationId idempotency, canonical payload comparator (reasonCode in
    payload only), the §6 episode-resolution table, and the §7 23505
    loser-receipt recovery algorithm
  - audit actions exam.proctor_assigned / exam.proctor_revoked (atomic,
    only on outcome=applied)
  - unit + concurrency + idempotency-replay tests
  - NO permission activation, NO resolver, NO route

J4-I1B — Scoped resolver runtime + dangerous-permission removal
  - Incident→Exam resolver (new)
  - Proctor-assignment enforcement layer in the per-request path
    (after capability check, after resource resolver, Proctor actors only;
    Admin short-circuit)
  - flip the flat sensitive routes to requireScopedCapability:
      POST /admin/attempts/:attemptId/misconduct
      POST /admin/attempts/:attemptId/force-submit
      GET  /admin/attempts/:attemptId/timeline
      all 11 incident routes (add exam/incident resolver wiring)
  - remove AttemptForceSubmit + AttemptMisconductMark from the Proctor
    preset (PROCTOR_PERMISSIONS) atomically with the resolver flip (§13)
  - legacy POST /admin/attempts/:attemptId/proctor-incident → Admin-only
    (x-role:["Admin"]) + OpenAPI deprecated:true; STAYS
    requireScopedCapability(AttemptMisconductMark, "attempt", "attemptId")
    (NOT flat) (§16)
  - add the 5-valued proctorAccess field to the route registry (§8) and
    ship the structural proctorAccess conformance test (§8), extending
    the route-registry ↔ runtime conformance lock
  - NO Proctor incident.* permission activation yet (resolver enforces,
    but Proctor preset gains no incident.* permission in this slice)

J4-I1C — Admin assignment API
  - new permissions exam.proctor_assignment.manage /
    exam.proctor_assignment.view (catalog + Admin-only preset grant)
  - POST   /admin/exams/:examId/proctors
  - GET    /admin/exams/:examId/proctors  (parametrized listExamProctors:
    status active|all|revoked, keyset pagination)
  - POST   /admin/exams/:examId/proctors/:proctorUserId/revoke
  - all three routes: requireScopedCapability(<permission>, "exam",
    "examId"); Admin short-circuits the triple but the exam resolver
    still runs
  - OpenAPI regeneration
  - integration tests (assign/revoke/list, idempotency + no_change
    receipts, 403/404 policy, Proctor-role validation, cross-org denial)
  - Admin UI is OPTIONAL here or a separate PR (J5 owns the full UI)

J4-I1D — Proctor minimum activation
  - grant IncidentView / IncidentCreate / IncidentInvestigate to the
    Proctor preset (the ADR-014 §8 target grant)
  - confirm ExamRoomView / AttemptStatusView / AttemptTimelineView are
    reachable only through scoped routes (J4-I1B landed them)
  - AttemptForceSubmit / AttemptMisconductMark are already removed from
    the Proctor preset by J4-I1B; AttemptTimeGrant remains Admin-only
  - cross-Exam denial browser E2E
  - closeout audit + status updates
```

### Mandated delivery order (frozen)

```text
Do not activate Proctor permissions before resolver enforcement exists.
The mandated delivery order for review and deployment safety is:
A → B → C → D.
```

The true dependency graph is `A → B`, `A → C`, `B + C → D`: B's
Proctor-assignment enforcement and the events table are queried from A's
tables (so B cannot land without A); C depends on A (commands/repo) and on
the route/capability definitions from B; D depends on both B and C. The
linear order above is a safety choice to reduce parallel-PR review risk,
not a claim that C technically requires B.

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
- Proctor→Exam assignment is a durable, append-preserving two-table
  aggregate (episode state + append-only command-receipt events) with
  monotonic revocation, the events table as idempotency arbiter, and
  DB-arbiterated concurrency where every losing 23505 operation still
  writes its own `no_change` receipt;
- the Incident→Exam resolver and the Proctor-assignment enforcement layer
  close reality-audit gaps G1–G3, G7;
- the pre-existing org-wide `AttemptForceSubmit`/`AttemptMisconductMark`
  Proctor grants are **removed from the Proctor preset** by J4-I1B
  (closing the current, reachable risk), and the affected route groups
  become `proctorAccess = admin_only` while keeping their scoped gate;
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

All items were confirmed closed by the final independent review on PR #245
(head `58777282`, 2026-08-02) before this ADR was marked Accepted.

```text
[x] assignment aggregate frozen (§4)
[x] role + permission + resource triple frozen (§3)
[x] Admin bypass policy frozen (§2)
[x] 403/404 policy frozen (§9)
[x] assign/revoke commands frozen (§5)
[x] operationId semantics frozen (§6)
[x] concurrency and unique arbiters frozen (§7)
[x] revocation timing frozen (§10)
[x] Exam/Attempt/Incident resolvers frozen (§8)
[x] initial Proctor permission set frozen (§13)
[x] dangerous permissions explicitly deferred or decided (§13)
[x] audit payload frozen (§14)
[x] persistence proposal frozen (§15)
[x] API proposal frozen (§16)
[x] migration/backfill policy frozen (§18)
[x] retention/delete policy frozen (§19)
[x] test matrix frozen (§22 threat model + §23 decomposition)
[x] J4-I1 decomposition frozen (§23)
[x] Redis explicitly excluded from authorization authority (§24)

Reviewer-driven items (added during the design-contract revision):
[x] two-table persistence frozen: exam_proctor_assignments (episode
    state, named status/revocation CHECKs, partial active-unique,
    (org,id) unique) + exam_proctor_assignment_events (append-only,
    (org,opId) unique = idempotency arbiter, NOT NULL assignment_id +
    composite FK, NOT NULL actor_id + FK→users(id)) (§4, §15)
[x] audit_logs is NOT the idempotency arbiter (no operation_id column);
    the events table is the sole replay/conflict authority (§7)
[x] episode-resolution table frozen incl. multi-episode already-revoked
    tie-break (revoked_at DESC, id DESC) and 404 when no episode exists
    (§6)
[x] 23505 loser writes its own no_change event receipt in a fresh
    transaction (§7 recovery algorithm)
[x] full Proctor-reachable route inventory frozen with the 5-valued
    proctorAccess field + machine-checkable structural conformance test
    enumerating every route-registry entry (§8)
[x] AttemptForceSubmit + AttemptMisconductMark removed from the Proctor
    preset by J4-I1B (§13, §23)
[x] legacy POST /admin/attempts/:attemptId/proctor-incident Admin-only +
    deprecated, STAYS requireScopedCapability (NOT flat) (§16, §23)
[x] tenant FK = plain users(id) + command/repository tenant check; no
    user-composite FK; "no changes to existing tables" retained (§15, §19)
[x] revoke canonical identity frozen to {operationId, examId,
    proctorUserId}; revoke API = POST .../proctors/:id/revoke (§5, §16)
[x] mandated delivery order A → B → C → D (true graph A→B, A→C, B+C→D)
    (§23)
[x] assignment-API capability = new exam.proctor_assignment.manage/view;
    registry scope=Exam/resolver="exam"; NO per-permission defaultScope
    (§16)
[x] listExamProctors active-default + history (all|revoked, Admin-only)
    + keyset pagination frozen (§5, §17)
[x] named assignment CHECKs frozen verbatim
    (exam_proctor_assignments_status_check,
    exam_proctor_assignments_revocation_shape_check) (§4)
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
| A. Organization-wide Proctor authority (status quo preset) | REJECT | ADR-014 forbids it for incidents; the preset's org-wide force-submit/misconduct are a **current, reachable** risk (reality audit G1/G2, reclassified); fails the recovery-jobs §13 forbidden-shortcut rule |
| B. `scope_type`/`scope_resource_id` columns on `user_role_assignments` | DEFER (not J4) | A general resource-scope dimension on the role table is a bigger change that implies Teacher@Course and Grader@Work too; J4 is deliberately the minimum Proctor→Exam slice. A dedicated `exam_proctor_assignments` table is simpler and matches the recovery-jobs §6 sketch |
| C. Single assignment table only (one `operation_id` column on the episode row; audit log as replay arbiter) | REJECT (design-contract revision) | Cannot record both endpoints of an episode (assign opId AND revoke opId); cannot record a `no_change` receipt for duplicate-assign or already-revoked under a new opId; `audit_logs` has no `operation_id` column (`packages/db/src/schema/pg.ts:831-851`) and cannot be the arbiter. |
| D. **Two-table model: status episode table + append-only command-receipt events** (formerly split as "C append-only" vs "D status") | **ADOPTED** | The merged model: `exam_proctor_assignments` carries episode state (active/revoked + named CHECKs + partial active-unique + `(org,id)` unique); `exam_proctor_assignment_events` is the append-only receipt store and the idempotency arbiter (`(org,opId)` unique, NOT NULL `assignment_id` + composite FK, NOT NULL `actor_id` + FK). Mirrors the ADR-014 `exam_incidents` + `exam_incident_events` precedent (`pg.ts:1234`, `pg.ts:1319`). Two new tables, zero existing-table edits; user dimension uses plain `users(id)` FK with application-level tenant check. |
| E. JWT-cached assignment claim | REJECT | revocation lag; violates §10 and ADR-010 per-request authority; stale-session threat (§22) |
| F. DELETE = fake assignment rows for Admin | REJECT | recovery-jobs §13 + §2 forbid; Admin short-circuit is the correct model |
| G. DELETE-with-body revoke API | REJECT | the claimed "house precedent" is false (role-assignment DELETE has no body, no operationId — `roleAssignments.ts:287-335`); DELETE-with-body is unreliably supported by clients/proxies/generators and must still carry operationId. ADOPTED instead: `POST .../proctors/:proctorUserId/revoke`. |
| H. Per-permission `defaultScope` attribute for the new assignment permissions | REJECT | the permission catalog is a closed string set; `Scope` is a separate model with no per-permission `defaultScope`. The contract is frozen via registry `scope=Scope.Exam, resolver="exam"` + Admin-only preset grant. |

---

**J4-I1 must not begin until this authority contract is independently
reviewed and accepted.**
