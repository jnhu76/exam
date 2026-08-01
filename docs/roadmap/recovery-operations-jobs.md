# Exam Recovery and Operations Jobs

<!-- markdownlint-disable MD024 -->

> Status: ACTIVE — J1 CLOSED; J2 CLOSED (ADR-014 ACCEPTED);
> J3 REC-I6-I1-INCIDENT-PERSISTENCE-COMMANDS **CLOSED** (PR #242 merged);
> **J4-R0 IN REVIEW** — Proctor-to-Exam Scope Authority Contract
> (ADR-015 Proposed; `M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md`).
> **J4-I1 BLOCKED** until ADR-015 is independently reviewed and Accepted.
>
> Updated: 2026-08-02
>
> Context: J3 (REC-I6-I1) is closed on master via PR #242 (merge commit
> `5b653c13`, 2026-08-01). This document defines the recommended work order for
> completing the interruption-recovery and operator-response system before
> starting Redis adoption work.
>
> Scope: single deployment, single organization, LAN/on-premise.
>
> Important boundary: Candidate self-service disrupted-attempt recovery is
> already implemented under REC-I3. The work below completes the operator /
> proctor / incident / recovery-center side of the system.

---

## 1. Why these Jobs come before Redis

Redis is not the current blocker.

The immediate architectural gaps are:

- who may intervene in an active examination;
- which resource scope authorizes that intervention;
- how incidents, time grants, forced submissions, and misconduct facts relate;
- how operator actions are made idempotent and auditable;
- what administrators and proctors can see and do during a live incident;
- how partial or interrupted operations are reconciled after a process failure.

Redis may later improve shared coordination, multi-instance behavior, rate
limiting, admission queues, presence, and operational fan-out. It should not be
introduced before the authority and recovery semantics it would coordinate are
stable.

Recommended order:

```text
REC-I6-R0 Incident Authority Contract
  → REC-I6-I1 Incident Persistence and Commands
  → M11 Proctor-to-Exam Scope Minimum
  → REC-OPS Admin Recovery Center
  → REC-OPS Proctor Recovery Center
  → REC-OPS Audit and Recovery Closeout
  → Recovery Authority Gate
  → P7-D1 Redis Adoption Decision
```

---

## 2. Job Index

| Job | Name | Primary result | Depends on |
| --- | --- | --- | --- |
| J1 | `REC-I4-I3B2-OPERATOR-TIME-GRANT-API` | **CLOSED** — Admin authorized, idempotent API and Dashboard product path | Existing `grantAttemptTime()` engine seam |
| J2 | `REC-I6-R0-INCIDENT-AUTHORITY-CONTRACT` | **CLOSED** — incident lifecycle, authority, relationships, and action semantics accepted in ADR-014 (ACCEPTED) | J1 design knowledge; no implementation dependency |
| J3 | `REC-I6-I1-INCIDENT-PERSISTENCE-COMMANDS` | **CLOSED — PR #242 merged** — Admin incident model, event history, commands, action links, and API are live on master | J2 |
| J4-R0 | `M11-PROCTOR-EXAM-SCOPE-CONTRACT` | **IN REVIEW** — Proctor-to-Exam scope authority design contract only (ADR-015 Proposed; no runtime implementation before acceptance) | J2; existing RBAC baseline |
| J4-I1 | `M11-PROCTOR-EXAM-ASSIGNMENTS` | **BLOCKED** until ADR-015 Accepted — Proctor-to-Exam runtime: assignment persistence, commands, resolver, API, and resource-scope enforcement | J4-R0 accepted |
| J5 | `REC-OPS-ADMIN-RECOVERY-CENTER` | Admin can inspect and operate the live recovery workflow through UI | J1, J3 |
| J6 | `REC-OPS-PROCTOR-RECOVERY-CENTER` | Proctor UI is activated with resource-scoped permissions | J3, J4, reusable J5 components |
| J7 | `REC-OPS-AUDIT-AND-RECOVERY-CLOSEOUT` | Real incident scenarios, crash recovery, audit, and E2E are closed | J1–J6 |
| Gate | `RECOVERY-AUTHORITY-GATE` | Recovery authority and operator workflows are safe enough to build shared infrastructure around | J1–J7 |
| J8 | `P7-D1-REDIS-ADOPTION-DECISION` | Measured adopt/decline decision under ADR-001 | Recovery Authority Gate |

---

## 3. J1 — REC-I4-I3B2 Operator Time Grant API

**CLOSED.** Closeout audit (closeout docs merged in PR #240):
[`REC-I4-I3B2-OPERATOR-TIME-GRANT-API-CLOSEOUT.md`](../audits/REC-I4-I3B2-OPERATOR-TIME-GRANT-API-CLOSEOUT.md).

Authority result:

- `Permission.AttemptTimeGrant` is activated for the Admin preset only. Do not
  grant it organization-wide to Proctor before J4 establishes Proctor-to-Exam
  scope.
- Attempt-scoped `POST /admin/attempts/:attemptId/time-grants` calls the
  canonical `grantAttemptTime()` command inside one locked transaction
  (Enrollment → Attempt → Exam lock order), with operation-ID idempotency
  (`granted` / `idempotent_replay` / `terminal`), cross-Attempt race recovery,
  and an atomic `attempt.timeGrant` audit. No route-local deadline calculation
  exists.
- `incidentId` remained null end to end at J1 closeout; the optional Admin
  incident linkage path was later activated by J3 (REC-I6-I1) through PR #242.
  Incident linkage is still reserved for the J2/J3 authority contract — only
  the Admin surface is now live.

Remaining dependencies handed forward:

- Proctor time grant requires J4 (M11 Proctor-to-Exam scope).
- Non-null `incidentId` requires J2 authority and J3 persistence.
- Admin/Proctor Recovery Center UI (J5/J6) and Redis (J8) remain out of scope.

The full contract, request/response examples, invariants, acceptance, and test
inventory are owned by the closeout audit, OpenAPI, and
[`docs/contracts/api-reference.md`](../contracts/api-reference.md).

---

## 4. J2 — REC-I6-R0 Incident Authority Contract

**CLOSED.**

ADR-014 was accepted on 2026-08-01.

Authority:
- [`ADR-014-exam-incident-authority.md`](../adr/ADR-014-exam-incident-authority.md) (ACCEPTED)
- [`incident-authority.md`](../architecture/exam-system/incident-authority.md) (Admin runtime IMPLEMENTED — J3 CLOSED, PR #242)
- [`REC-I6-R0-INCIDENT-AUTHORITY-REALITY-AUDIT.md`](../audits/REC-I6-R0-INCIDENT-AUTHORITY-REALITY-AUDIT.md) (baseline)

## Purpose

Freeze what an examination incident is before adding tables, APIs, or UI.

An incident records an operational fact and its investigation. It is not itself
an Attempt state, punishment, score change, or time grant.

## Proposed aggregate

```text
ExamIncident
- id
- examId
- attemptId?
- candidateId?
- type
- severity
- status
- occurredAt
- detectedAt
- reportedBy
- description
- resolution?
- resolvedAt?
- resolvedBy?
- version
- createdAt
- updatedAt
```

## Proposed lifecycle

```text
open
  → investigating
  → resolved

open
  → dismissed

investigating
  → resolved

investigating
  → dismissed
```

Do not add many statuses before real workflows require them.

## Proposed incident types

```text
network_interruption
device_failure
power_failure
candidate_unable_to_continue
suspected_misconduct
operator_error
system_outage
environmental_disruption
other
```

## Proposed severity

```text
info
minor
major
critical
```

Severity informs prioritization. It must not silently trigger punishment or
Attempt mutation.

## Authority rules

- An incident is a durable operational fact.
- An incident does not directly mutate Attempt status.
- An incident does not directly change score.
- An incident does not itself grant time.
- Time grant is a separate canonical command.
- Force submit is a separate canonical command.
- Misconduct marking is a separate canonical command.
- Operator notes/events are append-only history.
- One incident may reference multiple operator actions.
- One operator action may reference at most one incident.
- Editing the current incident summary must not rewrite historical events.
- Incident deletion should not be supported for normal operators.
- Dismissal is a terminal business outcome, not row deletion.

## Actors

Initial recommendation:

| Actor | Create | Investigate | Resolve/dismiss | Execute linked action |
| --- | ---: | ---: | ---: | ---: |
| Admin | Yes | Yes | Yes | According to permission |
| Assigned Proctor | Yes | Yes | Policy-dependent | According to scoped permission |
| Teacher | No by default | Read only if explicitly authorized | No | No |
| Grader | No | No | No | No |
| Candidate | No direct operator incident creation | No | No | No |
| System | May create system incidents through a distinct system command | No | No | System-only actions |

Candidate reports, if added later, should be a separate report/input protocol
that an operator may convert into an incident.

## Required decisions

J2 must freeze:

- aggregate identity;
- state machine;
- event history;
- actor and permission model;
- relationship to Exam, Attempt, Candidate, and Interruption;
- relationship to time grants, force submit, and misconduct;
- optimistic concurrency/versioning;
- audit and privacy rules;
- retention;
- which fields are mutable;
- which transitions require reason text;
- whether system-generated incidents exist in the first implementation.

## Deliverables

- accepted ADR or architecture decision document;
- state diagram;
- command inventory;
- permission matrix;
- transaction-boundary table;
- API contract proposal;
- migration proposal;
- UI workflow sketch;
- explicit non-goals.

## Non-goals

- persistence implementation;
- recovery center UI;
- Redis;
- automatic punishment;
- attachment/evidence binary storage unless separately designed;
- arbitrary user-defined incident statuses or types.

## Acceptance

- Every incident transition has one command owner.
- Incident and Attempt lifecycles remain orthogonal.
- Time grants, force submit, and misconduct are modeled as linked actions, not
  incident state mutations.
- Actor/resource authorization is explicit.
- Historical events are append-only.
- Concurrency and idempotency expectations are defined.
- J3 can be implemented without inventing semantics.

---

## 5. J3 — REC-I6-I1 Incident Persistence and Commands

**CLOSED — PR #242 merged (merge commit `5b653c13`, 2026-08-01).**

The accepted ADR-014 contract is implemented on master: five additive tables
(migration `0023`), domain types/errors, repositories, nine canonical write
commands, Admin-only permissions, API routes, audit actions, and the
`grantAttemptTime()` optional `incidentId` operator path. Closeout audit:
[`REC-I6-I1-INCIDENT-RUNTIME-CLOSEOUT.md`](../audits/REC-I6-I1-INCIDENT-RUNTIME-CLOSEOUT.md).

Implemented invariants: Incident and Attempt lifecycles remain orthogonal;
terminal status is monotonic; event history is append-only; the scope
quadruple is server-derived; `operationId` idempotency is arbitrated by the
operation unique constraint; duplicate links are rejected deterministically;
grant + Incident link is one atomic transaction; Proctor Incident authority is
unchanged (none granted); system incidents remain disabled; `misconduct_mark`
action link is deferred.

Explicit remaining boundaries (NOT IMPLEMENTED, handed to J4-R0 and later
jobs): Recovery Center UI (J5), Proctor-to-Exam resource scope and Proctor
Incident permissions (J4 / M11), system-generated incidents, Redis
coordination, background/startup reconciliation, and the `misconduct_mark`
Incident action link.

**J4 begins with a mandatory R0 design-contract job
(`M11-PROCTOR-EXAM-SCOPE-CONTRACT`). No runtime implementation is authorized
before R0 acceptance.** After acceptance, the runtime job is
`M11-PROCTOR-EXAM-ASSIGNMENTS` (J4-I1).

The sections below are the pre-ADR planning sketch; where they differ from
[`ADR-014-exam-incident-authority.md`](../adr/ADR-014-exam-incident-authority.md)
(§12–§14 persistence/API/migration, §18 decomposition) and
[`incident-authority.md`](../architecture/exam-system/incident-authority.md),
the ADR and architecture document win.

## Purpose

Implement the incident aggregate, append-only event history, canonical commands,
and links to operator actions.

## Persistence

Suggested tables (five additive tables; zero changes to existing tables —
ADR-014 §12 is authoritative):

```text
exam_incidents
exam_incident_events
exam_incident_actions
exam_incident_attempts
exam_incident_interruption_links
```

Possible responsibilities:

### `exam_incidents`

Current materialized incident state.

### `exam_incident_events`

Append-only event history:

```text
incident_created
investigation_started
note_added
severity_changed
incident_resolved
incident_dismissed
action_linked
attempt_linked
interruption_linked
```

Each event row carries `event_sequence` (ordering authority), the
`operation_id` / `command_type` pair (idempotency arbiter), and
`before_version` / `after_version` (verifiable version chain) — ADR-014 §5.

### `exam_incident_actions`

Links an incident to a separately authoritative action:

```text
time_grant
force_submit
```

Store action identity and type, not duplicated mutable action state.
`misconduct_mark` is deferred until a stable append-only action receipt
exists (its jsonb flag is overwritten on re-flag); J3 rejects it with
400 — ADR-014 §7.

### `exam_incident_attempts`

Append-only affected-attempt membership for exam-wide incidents only
(anchor XOR membership — ADR-014 §7).

### `exam_incident_interruption_links`

Append-only interruption-episode evidence links; the interruption ledger
remains authoritative for compensated time (ADR-014 §7).

## Canonical commands

Recommended commands:

```text
createExamIncident()
startIncidentInvestigation()
addIncidentNote()
changeIncidentSeverity()
resolveExamIncident()
dismissExamIncident()
linkIncidentAction()
linkIncidentAttempt()
linkIncidentInterruption()
```

Every command carries an `operationId`; mutating transitions additionally
carry `expectedVersion` (ADR-014 §9).

Do not create one universal `updateIncident()` endpoint that can perform every
transition and edit every field.

## API

Suggested routes:

```http
POST   /admin/exams/:examId/incidents
GET    /admin/exams/:examId/incidents
GET    /admin/incidents/:incidentId
POST   /admin/incidents/:incidentId/investigate
POST   /admin/incidents/:incidentId/notes
POST   /admin/incidents/:incidentId/severity
POST   /admin/incidents/:incidentId/resolve
POST   /admin/incidents/:incidentId/dismiss
POST   /admin/incidents/:incidentId/actions
POST   /admin/incidents/:incidentId/attempts
POST   /admin/incidents/:incidentId/interruptions
```

Proctor routes may reuse the same handlers after J4 provides scoped
authorization.

## Concurrency

- Use a version or expected revision for mutable state transitions.
- Every write command carries an `operationId`; retries reuse it, and
  `UNIQUE (organization_id, operation_id)` on `exam_incident_events` is the
  single arbiter (same identity + same canonical payload → replay; same
  identity + different payload → 409 `IDEMPOTENCY_CONFLICT`) — ADR-014 §9.
- Two simultaneous resolve/dismiss commands must not both win.
- Notes may be independently appendable, each under its own `operationId`.
- Linked action IDs must be unique; attempt and interruption evidence links
  have their own uniques (ADR-014 §6).
- Every link satisfies the scope quadruple (same organization, same exam,
  attempt anchor null-or-matching, candidate null-or-matching), derived server-side — ADR-014 §7.

## Integration with J1

A time grant may carry:

```text
incidentId
```

The grant remains authoritative in the time-adjustment ledger. The incident
only records the relationship.

The combined grant+link model is **one transaction** (ADR-014 §10): the
time-grant route accepts an optional `incidentId`, validates the full scope
quadruple (org, exam, attempt, candidate) against the authoritative rows,
then writes the ledger row, deadline update, action link, and audit
atomically under the grant's existing `operationId` idempotency. A
retroactive link without a concurrent grant uses a separate idempotent
`linkIncidentAction()` transaction. A linked action MUST NOT exist only in
UI memory.

## Audit

Every command records:

- actor;
- resource scope;
- operation ID or version;
- before and after state;
- reason;
- timestamp;
- request/correlation ID where applicable.

## Non-goals

- recovery center UI;
- Proctor assignment model;
- Redis;
- automatic incident classification;
- media evidence storage;
- arbitrary workflow customization.

## Acceptance

- Migration and repositories exist.
- Canonical commands enforce the frozen lifecycle.
- Event history is append-only.
- Linked time grants are queryable from the incident timeline.
- Concurrent terminal transitions are safe.
- Unauthorized users cannot read or mutate incidents.
- Incident state can be reconstructed and explained from events/actions.
- API, repository, integration, concurrency, and audit tests pass.

---

## 6. J4 — M11 Proctor-to-Exam Scope Minimum

> **J4-R0 (design contract) is IN REVIEW.** ADR-015
> ([`docs/adr/ADR-015-proctor-exam-scope-authority.md`](../adr/ADR-015-proctor-exam-scope-authority.md))
> is Proposed and is the candidate authority contract. Reality audit:
> [`M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md`](../audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md).
> The design PR is documentation-only and changes no runtime code. **J4-I1
> (runtime) is BLOCKED until ADR-015 is independently reviewed and
> Accepted.** Once ADR-015 is Accepted, where the planning sketch below
> differs from ADR-015, the ADR wins; until then the ADR remains Proposed
> and J4-I1 stays BLOCKED.

## Purpose

Introduce the minimum resource-relationship authorization required before
Proctor recovery operations can be activated safely.

## Scope

Implement:

```text
Proctor → assigned Exam
```

This is a deliberately small slice of M11.

## Required model

Possible relationship:

```text
exam_proctor_assignments
- examId
- userId
- assignedBy
- assignedAt
- revokedAt?
```

The exact schema should follow the accepted M11 architecture.

## Authorization rule

```text
Admin
  → all exams in the deployment

Proctor
  → only explicitly assigned exams

Teacher
  → no implicit recovery authority

Grader
  → no recovery authority
```

For an Attempt or Incident operation, resource scope is derived through:

```text
Attempt → Exam
Incident → Exam
Proctor assignment → Exam
```

## Initial Proctor capabilities

Possible scoped capabilities:

```text
ExamMonitor
IncidentView
IncidentCreate
IncidentInvestigate
MisconductMark
```

Time grant and force submit should remain separately configurable:

```text
AttemptTimeGrant
AttemptForceSubmit
```

A strict profile may require Admin approval even when the Proctor can create and
investigate an incident.

## Non-goals

- complete M11 Teacher@Course and Grader@Work implementation;
- custom roles;
- arbitrary resource policy language;
- organization-wide Proctor permissions;
- Redis authorization;
- recovery UI.

## Required invariants

- A Proctor cannot access an unassigned Exam by guessing IDs.
- An assigned Exam grants no capability beyond the explicit permission set.
- Revoking the assignment immediately blocks future commands.
- Historical audit remains readable according to retention policy.
- Admin authority is not implemented by fake Proctor assignments.
- Resource checks occur server-side, not only by hiding UI.

## Acceptance

- Admin can assign/revoke a Proctor to/from an Exam.
- Assigned Proctor can perform only permitted operations on that Exam.
- Proctor receives 403/404 behavior consistent with security policy for other
  Exams.
- Cross-Exam Attempt and Incident access is denied.
- Assignment changes are audited.
- Permission and resource-scope integration tests pass.

---

## 7. J5 — REC-OPS Admin Recovery Center

## Purpose

Provide a real administrator workflow for discovering, understanding, and
resolving operational examination incidents.

## Entry points

Recommended routes/pages:

```text
/admin/recovery
/admin/exams/:examId/recovery
/admin/incidents/:incidentId
/admin/attempts/:attemptId/operations
```

## Dashboard sections

### Active anomalies

- disrupted Attempts;
- restore failures;
- unresolved interruption episodes;
- open/critical incidents;
- Attempts near deadline;
- stuck grading;
- failed/dead Email work;
- reconciliation warnings;
- backup/recovery warnings when those capabilities exist.

### Filters

- Exam;
- Candidate;
- Attempt;
- status;
- severity;
- incident type;
- time range;
- assigned Proctor;
- unresolved only.

## Attempt detail

Display:

- Candidate and Exam identity;
- current Attempt status;
- effective deadline;
- interruption policy snapshot;
- active and historical interruptions;
- time-adjustment ledger;
- incident timeline;
- operator actions;
- grading/publication state;
- relevant audit events;
- current allowed actions.

## Admin actions

- create incident;
- investigate;
- add note;
- resolve/dismiss;
- grant time;
- force submit;
- mark misconduct;
- retry/reconcile supported stuck work;
- navigate to authoritative related records.

Every action must invoke its canonical command.

## Safety UX

- reason is required for dangerous operations;
- show before/after state;
- confirmation for force submit and misconduct;
- operation ID generated and retained across retry;
- disable only as convenience—server authority remains decisive;
- on completion, reload the authoritative snapshot/timeline;
- terminal state is clearly shown;
- failures are classified and retry-safe;
- no optimistic fake success.

## Non-goals

- Proctor access;
- full backup center;
- generic system settings;
- Redis presence/live updates;
- arbitrary SQL repair tools;
- manual mutation of raw status fields.

## Acceptance

- Admin can complete the supported incident and recovery workflows without
  direct database access.
- UI state comes from authoritative APIs.
- Duplicate clicks do not duplicate actions.
- Every action appears in the incident/Attempt/audit timeline.
- Accessibility, loading, empty, error, and mobile/responsive baselines pass.
- Representative browser E2E covers time grant, incident lifecycle, force
  submit, and permission denial.

---

## 8. J6 — REC-OPS Proctor Recovery Center

## Purpose

Activate a restricted Proctor-facing recovery workflow using J4 resource scope
and reusable J5 components.

## Scope

The Proctor sees only assigned Exams and the Attempts/Incidents within them.

Suggested Proctor pages:

```text
/proctor/exams
/proctor/exams/:examId/live
/proctor/incidents/:incidentId
```

## Proctor capabilities

Recommended baseline:

| Capability | Default |
| --- | --- |
| View assigned Exam live status | Allowed |
| View assigned Exam Attempts | Allowed |
| Create incident | Allowed |
| Investigate/add notes | Allowed |
| Mark suspected misconduct | Allowed |
| Grant time | Policy-dependent |
| Force submit | Policy-dependent |
| Resolve/dismiss incident | Policy-dependent |
| Change Exam/system settings | Denied |
| View unassigned Exams | Denied |
| Delete history | Denied |

## Policy interaction

Exam policy/profile may resolve whether Proctor can:

- grant time directly;
- request Admin approval;
- force submit;
- resolve incidents;
- perform only documentation actions.

The UI must display the effective policy and disabled reason, but authorization
must be enforced server-side.

## Live view

Without Redis, initial implementation may use:

- periodic polling;
- existing PostgreSQL projections;
- bounded refresh intervals;
- explicit stale-data indicator.

Do not block J6 on Redis presence or Pub/Sub.

## Non-goals

- organization-wide Proctor access;
- replacing Admin recovery center;
- live Redis presence;
- arbitrary role customization;
- lockdown client implementation.

## Acceptance

- Assigned Proctor can operate within one assigned Exam.
- Unassigned Exam access is denied.
- Effective policy controls dangerous actions.
- Admin retains broader authority.
- Shared UI components do not bypass role/resource checks.
- Cross-role and cross-Exam browser E2E passes.

---

## 9. J7 — REC-OPS Audit and Recovery Closeout

## Purpose

Prove the recovery system under real operational scenarios, retries, races, and
partial failures.

## Scenario matrix

### Scenario A — Candidate reconnects normally

```text
heartbeat timeout
→ interruption episode
→ Candidate `canResume`
→ explicit self-restore
→ strict/bounded-grace policy
→ restored event
→ authoritative snapshot reload
```

Expected result:

- no operator action required;
- incident optional;
- timeline complete;
- no duplicate compensation.

### Scenario B — Device failure requires additional time

```text
Proctor/Admin creates incident
→ operator grants time
→ adjustment ledger committed
→ action linked to incident
→ Candidate snapshot reflects new deadline
```

Expected result:

- one grant per operation ID;
- before/after deadline evidence;
- incident and adjustment records agree.

### Scenario C — Candidate cannot continue

```text
incident
→ force submit
→ grading workset/result flow
→ notification/publication according to policy
```

Expected result:

- no reopened Attempt;
- repeated force-submit safely returns committed outcome;
- grading is not duplicated.

### Scenario D — Suspected misconduct

```text
incident
→ evidence/note
→ misconduct mark
→ review/resolution
```

Expected result:

- misconduct fact does not silently change score unless an explicit separate
  policy/command does so;
- full actor/reason/timestamp trail.

### Scenario E — API crashes during operator action

Test crash points such as:

```text
after command validation
after ledger insert
after Attempt update
after incident action link
before response
```

Expected result:

- committed state is replay-safe;
- uncommitted work rolls back;
- reconciliation detects supported partial states;
- client retry does not duplicate mutation.

### Scenario F — PostgreSQL temporarily unavailable

Expected result:

- authoritative writes fail clearly;
- UI does not show fake success;
- operation ID can be safely retried;
- no local-only incident/action state becomes authoritative.

### Scenario G — Recovery UI reload or route change race

Expected result:

- stale request cannot overwrite a newer Attempt/Incident page;
- command result is not confused with page authority;
- authoritative reload wins.

## Startup reconciliation

Define and implement supported checks:

- active interruption pointer without a valid open episode;
- expired active Attempt;
- terminal Attempt with unresolved interruption;
- action link missing after a committed action, if the chosen transaction model
  permits this;
- incident in invalid terminal combination;
- processing work with expired ownership;
- result/grading/notification inconsistencies already supported by canonical
  repair commands.

Reconciliation must call canonical commands or narrowly defined repair
procedures. It must not perform generic ad-hoc status writes.

## Audit closeout

Prove that operators can answer:

- what happened;
- when it happened;
- who observed/reported it;
- who performed each action;
- why the action was taken;
- what changed;
- whether it was a replay;
- which Exam/Attempt/Incident it affected;
- the final outcome.

## Test requirements

- engine unit tests;
- repository tests;
- route integration tests;
- permission and resource-scope tests;
- idempotency tests;
- concurrency/race tests;
- transaction rollback tests;
- startup reconciliation tests;
- browser E2E for Admin and Proctor;
- audit timeline assertions;
- structural tests preventing direct status/deadline writes from routes/UI
  services.

## Acceptance

- All supported scenario paths complete through real UI/API.
- Every dangerous action is permission-checked and resource-scoped.
- Every action is idempotent or deterministically repeatable.
- Crash/retry tests prove no duplicate irreversible mutation.
- Operator timelines explain the outcome.
- Candidate self-recovery remains intact.
- No Redis dependency is required.

---

## 10. Recovery Authority Gate

Redis planning may proceed only after this gate passes.

## Gate requirements

### Candidate recovery

- REC-I3 Candidate self-service recovery remains operational.
- `canResume` is the action capability.
- Restore command result is not treated as the page authority.
- Candidate reloads the authoritative take snapshot.

### Operator commands

- Admin time grant route and permission are live.
- Force submit has one canonical command.
- Misconduct marking has one canonical command.
- No route or UI service writes Attempt status/deadline directly.

### Incident authority

- Incident lifecycle is implemented.
- Incident history is append-only.
- Incident and Attempt states remain orthogonal.
- Operator actions are linked without duplicating authority.

### Resource authorization

- Proctor is scoped to explicitly assigned Exams.
- Cross-Exam access is denied.
- Dangerous actions have explicit capabilities and policy checks.

### UI and operations

- Admin recovery center is usable.
- Proctor recovery center is usable for assigned Exams.
- Every action reloads authoritative data.
- Failure and retry states are visible.

### Recovery and audit

- Operation IDs prevent duplicate irreversible actions.
- Crash-point tests pass.
- Startup reconciliation handles the supported partial states.
- Audit timelines explain all supported actions and outcomes.

## Gate result

```text
PASS
  → begin P7-D1 Redis adoption decision

FAIL
  → continue recovery/authority closeout
```

Passing this gate does not mean Redis must be adopted. It only means the
business authority is stable enough to evaluate Redis safely.

---

## 11. J8 — P7-D1 Redis Adoption Decision

## Purpose

After the Recovery Authority Gate, measure whether one or more concrete Redis
responsibilities are justified under ADR-001.

## Decision inputs

Measure:

- single-instance API headroom;
- in-memory rate-limit limitations;
- admission queue restart/multi-instance requirements;
- scanner duplicate-work cost;
- operator dashboard freshness requirements;
- presence requirements;
- deployment topology;
- RPO/RTO expectations;
- operational ability to run Redis safely.

## Possible outcomes

### Adopt one responsibility

Examples:

- global rate limiting;
- admission queue;
- presence projection;
- scanner coordination.

Each accepted responsibility requires:

- data class;
- authority;
- persistence;
- eviction;
- failure policy;
- fallback/degraded mode;
- observability;
- backup/recovery if durable;
- rollback;
- multi-instance proof.

### Decline adoption

Record:

- measured evidence;
- why the current architecture is sufficient;
- concrete future re-evaluation triggers.

Decline is a valid outcome.

## Recommended first candidate

If a measured trigger exists:

```text
Redis-backed global rate limiting
```

Why:

- naturally ephemeral;
- low coupling to exam authority;
- simple multi-instance proof;
- useful for login, recovery, operator actions, imports, and abuse control.

Do not use Redis adoption as a prerequisite for completing J1–J7.

---

## 12. Recommended PR Breakdown

```text
PR-1  J1 — CLOSED
PR-2  J2 — CLOSED — ADR-014 ACCEPTED
PR-3  J3 — CLOSED — PR #242 merged
PR-4  J4-R0 — M11-PROCTOR-EXAM-SCOPE-CONTRACT — IN REVIEW (design contract only;
       ADR-015 Proposed, reality audit landed; no runtime code)
       ↳ after R0 acceptance: J4-I1 — M11-PROCTOR-EXAM-ASSIGNMENTS (runtime)
         J4-I1 is sliced A→B→C→D per ADR-015 §23; the hard ordering rule is
         "do not activate Proctor permissions before resolver enforcement exists"
PR-5  REC-OPS-ADMIN-RECOVERY-CENTER — PLANNED
PR-6  REC-OPS-PROCTOR-RECOVERY-CENTER — PLANNED
PR-7  REC-OPS-AUDIT-AND-RECOVERY-CLOSEOUT — PLANNED
PR-8  P7-D1-REDIS-ADOPTION-DECISION — DECISION-GATED
```

## Parallelism

J1 is closed. J2 (REC-I6-R0) is CLOSED — ADR-014 is ACCEPTED.
J3 (REC-I6-I1) is CLOSED on master via PR #242. J4-R0 (design contract) is
IN REVIEW (ADR-015 Proposed); J4-I1 (runtime) is BLOCKED until ADR-015 is
Accepted.

## Next Job

Independent review of ADR-015 (`M11-PROCTOR-EXAM-SCOPE-CONTRACT` / J4-R0),
then — only after acceptance — J4-I1 (`M11-PROCTOR-EXAM-ASSIGNMENTS`)
runtime implementation per the ADR-015 §23 decomposition. No runtime
implementation is authorized before R0 acceptance.

---

## 13. Global Rules for Every Job

Every Job must state:

- current reality;
- scope;
- non-goals;
- dependencies;
- command owner;
- actor and permission;
- resource scope;
- authoritative storage;
- transaction boundary;
- lock ordering;
- idempotency/replay behavior;
- crash behavior;
- audit evidence;
- API/UI contracts;
- migration/backfill;
- tests;
- rollback/degradation behavior.

## Forbidden shortcuts

- direct status writes from routes;
- direct deadline writes from routes;
- UI-only authorization;
- organization-wide Proctor authority as a temporary shortcut;
- incident state used as an Attempt state;
- incident resolution silently changing score;
- one giant endpoint that updates incident, Attempt, score, and audit at once;
- Redis used for authorization;
- Redis used to hide unresolved state-machine semantics;
- marking a feature complete because only an API or environment variable exists.
