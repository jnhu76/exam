# Job Card — P3-L2 Scoped RBAC Architecture + Permission Matrix

> **Type:** Large Design Job / Grillme / ADR
> **Phase:** Phase 3 Pre-Implementation
> **Suggested branch:** `phase3/scoped-rbac-design`
> **Expected output:** Documentation only
> **Business behavior change:** None
> **Code behavior change:** None
> **DB schema change:** None
> **Primary goal:** Design a formal, non-toy Scoped RBAC model for Phase 3, including role presets, permission catalog, scope model, resource resolvers, route permission registry, admin compatibility policy, and migration plan.

---

# 0. Context

The project is a LAN / on-premise exam system.

Current authorization state:

```txt
authenticate
  -> requireRole(["Admin" | "Candidate"])
  -> handler logic
```

Existing facts from prior audits:

* Current product roles are only `Admin` and `Candidate`.
* `requirePermission()` exists but is not used by production routes.
* Current routes mostly use `requireRole(["Admin"])`, `requireRole(["Candidate"])`, or both.
* `users.role` is stored as plain text.
* There is no real scope model yet.
* Existing Admin behavior must not be broken.
* Proctor-like routes currently use Admin gate.
* Some proctor permissions already exist but are not granted to Admin, creating migration traps.
* Grading detail API already exposes candidate answers.
* Audit logs and client events are separate channels.
* Redis must not be used as authorization authority.
* Candidate runtime state machine and Answer Protocol v2 are separate Large Jobs.

This job must design the formal RBAC architecture before any implementation job begins.

---

# 1. Goal

Design a proper **Scoped RBAC** model.

The target model should support:

```txt
Actor
  -> Role Assignment
  -> Role
  -> Permission
  -> Scope
  -> Resource Resolver
  -> Audit Action
```

The model must support fixed Phase 3 role presets first:

```txt
Admin
Teacher
Proctor
Grader
Candidate
System Actor
```

But it must not be a toy role-string model.

The design must make it possible to later support:

```txt
Custom roles
Scoped role assignment
School/course/exam/attempt-level permissions
Double-blind grading
Proctor-only authority
Result-viewer role
School admin / organization admin / system admin split
```

without redesigning the whole permission system.

---

# 2. Non-Goals

Do **not** implement code.

Do **not** write migrations.

Do **not** modify DB schema.

Do **not** replace `requireRole()` yet.

Do **not** enforce `requirePermission()` yet.

Do **not** introduce CASL, Casbin, Oso, Permify, or another library in this job.

Do **not** build a custom role management UI.

Do **not** allow arbitrary user-defined permissions yet.

Do **not** solve Answer Protocol v2.

Do **not** solve WYSIWYG submit barrier.

Do **not** solve Frontend Exam State Machine.

Do **not** solve E2E full parallelization.

Do **not** merge audit logs and client telemetry.

Do **not** use Redis for authorization.

---

# 3. Main Design Questions

## 3.1 RBAC Model

Answer these questions:

1. Should Phase 3 use classic RBAC, scoped RBAC, ABAC, or a hybrid?
2. What is the minimum formal model that avoids a toy implementation?
3. What entities are required?

Candidate entities:

```txt
roles
permissions
role_permissions
user_role_assignments
scope_types
resource_resolvers
route_permission_registry
audit_actions
```

1. Should `users.role` remain as compatibility field?
2. Should `users.role` be deprecated in favor of `user_role_assignments`?
3. Should role presets be code-defined, DB-seeded, or both?
4. Should permissions be code constants, DB rows, or both?
5. How should the system prevent unknown permission strings?
6. How should the system prevent unknown role strings?
7. How should this work before custom RBAC UI exists?

Required conclusion:

```txt
Phase 3 must build a formal Scoped RBAC core.
Custom role UI can be deferred.
Role presets are product defaults, not authorization hardcoding.
```

---

## 3.2 Role Preset Model

Design the built-in role presets.

Minimum roles:

```txt
Admin
Teacher
Proctor
Grader
Candidate
System
```

For each role, define:

```txt
Purpose
Assignable?
Login allowed?
Default scope
Permission groups
Sensitive permissions
Explicitly forbidden abilities
Migration notes
```

Required role boundaries:

### Admin

Must answer:

1. Is Admin a compatibility superset in Phase 3?
2. Does Admin temporarily include Teacher / Proctor / Grader permissions?
3. Can Admin be scoped to organization/school later?
4. Should SuperAdmin be introduced now or deferred?
5. How does last-admin guard survive?
6. How do current Admin-only routes remain behavior-compatible?

Expected policy:

```txt
Admin remains a compatibility superset during migration.
Do not reduce existing Admin behavior in Phase 3 migration stage.
```

### Teacher

Must answer:

1. Can Teacher create courses?
2. Can Teacher manage questions?
3. Can Teacher create exams?
4. Can Teacher publish exams?
5. Can Teacher close exams?
6. Can Teacher manage enrollments?
7. Can Teacher view scores?
8. Can Teacher publish results?
9. Can Teacher view candidate answers?
10. Can Teacher grade answers?
11. Can Teacher proctor exams?

Required distinction:

```txt
Teacher is primarily an exam/course manager.
Teacher should not automatically be Grader or Proctor unless explicitly assigned.
```

### Proctor

Must answer:

1. Can Proctor view exam room status?
2. Can Proctor view proctor timeline?
3. Can Proctor mark misconduct?
4. Can Proctor extend time?
5. Can Proctor force submit?
6. Can Proctor view candidate answers?
7. Can Proctor view scores?
8. Can Proctor grade?
9. Can Proctor edit answers?
10. Can Proctor reopen attempts?

Required boundary:

```txt
Proctor can operate exam runtime authority.
Proctor cannot grade, view candidate answers, or publish results by default.
```

### Grader

Must answer:

1. Can Grader view grading queue?
2. Can Grader view grading detail?
3. Can Grader view candidate answer?
4. Can Grader write manual score?
5. Can Grader finalize grading?
6. Can Grader publish result?
7. Can Grader see candidate identity?
8. Can Grader see other graders' scores?
9. Should double-blind grading be supported later?
10. Is Grader scoped to exam, attempt, question, or grading task?

Required distinction:

```txt
VIEW_GRADING_DETAIL
VIEW_CANDIDATE_ANSWER
GRADE_ANSWER
FINALIZE_GRADING
```

must be modeled separately.

### Candidate

Must answer:

1. Is Candidate always own-scope only?
2. How is own attempt resolved?
3. How is own score resolved?
4. Can Candidate view unpublished result?
5. Can Candidate restore disrupted attempt?
6. Can Candidate submit after deadline?
7. Which decisions are permission decisions?
8. Which decisions are runtime state decisions?

Required boundary:

```txt
Permission determines whether the actor may perform an action.
Runtime state determines whether the attempt is currently in a legal phase.
```

### System Actor

Must answer:

1. Should deadline scanner be a System actor instead of Admin?
2. Should heartbeat scanner be a System actor instead of Admin?
3. Can System actor login?
4. Can System actor appear in user management UI?
5. Which system permissions exist?

Candidate permissions:

```txt
system.auto_submit
system.heartbeat_scan
system.lifecycle_reconcile
system.background_job.run
```

Required boundary:

```txt
System actor is not a human role.
System actor is not assignable.
System actor is not login-capable.
```

---

# 4. Permission Catalog v0

Design a permission catalog.

Permissions must be stable constants, not random string literals.

Use naming style:

```txt
domain.resource.action
```

or another documented convention.

Recommended draft catalog:

## 4.1 User / Organization

```txt
user.view
user.create
user.update
user.delete
user.role.assign
user.password.reset

organization.view
organization.update
settings.view
settings.update
audit_log.view
```

## 4.2 Candidate Management

```txt
candidate.view
candidate.create
candidate.update
candidate.import
candidate.delete

candidate_field.view
candidate_field.create
candidate_field.update
candidate_field.delete
```

## 4.3 Course / Question

```txt
course.view
course.create
course.update
course.delete

question.view
question.create
question.update
question.delete
question.import
```

## 4.4 Exam Lifecycle

```txt
exam.view
exam.create
exam.update
exam.publish
exam.unpublish
exam.close
exam.cancel
exam.archive
exam.delete
exam.extend
exam.result.publish
exam.enrollment.manage
```

## 4.5 Candidate Runtime

```txt
exam.take
attempt.view_own
attempt.start
attempt.answer.save
attempt.submit
attempt.restore
attempt.heartbeat.send
score.own.view
```

## 4.6 Proctor Runtime

```txt
exam_room.view
attempt.status.view
attempt.timeline.view
attempt.misconduct.mark
attempt.time.extend
attempt.force_submit
attempt.export
```

## 4.7 Grading

```txt
grading.queue.view
grading.detail.view
grading.answer.view
grading.score.write
grading.finalize
grading.identity.view
```

## 4.8 Scores / Results

```txt
score.all.view
score.export
result.publish
result.release_policy.manage
```

## 4.9 System / Diagnostics

```txt
system.health.view
system.diagnostics.view
system.info.view
system.auto_submit
system.heartbeat_scan
system.lifecycle_reconcile
```

For every permission, produce:

| Permission | Domain | Action | Sensitive? | Default Roles | Required Scope | Audit Required? | Notes |
| ---------- | ------ | ------ | ---------: | ------------- | -------------- | --------------: | ----- |

---

# 5. Scope Model v0

Design the scope enum.

Start from this candidate enum:

```txt
system
organization
school
course
exam
attempt
question
candidate
own_attempt
own_score
```

Must answer:

1. Is `school` required in Phase 3?
2. Is `organization` enough for current deployment?
3. Is `tenant` a separate scope or deferred?
4. Is `question` a scope or only a resource?
5. Is `grading_task` needed now or deferred?
6. Are `own_attempt` and `own_score` real scopes or special resolvers?
7. Should `system` scope exist?
8. Which scopes require DB resolvers?
9. Which scopes can be resolved from JWT/session context?
10. Which scopes are not yet enforceable without schema change?

Required output:

| Scope | Meaning | Example Resource | Resolver Needed? | Phase 3 Required? | Notes |
| ----- | ------- | ---------------- | ---------------: | ----------------: | ----- |

---

# 6. Resource Resolver Matrix

Design resource scope resolution.

Minimum resources:

```txt
user
candidate
course
question
exam
enrollment
attempt
answer
grading_entry
score
audit_log
client_event
system_diagnostics
```

For each resource, define:

| Resource | Parent Chain | Resolver Function | Required For Permission | Can Be Cached? | Source of Truth |
| -------- | ------------ | ----------------- | ----------------------- | -------------: | --------------- |

Example:

```txt
attempt -> exam -> course -> school -> organization
answer -> attempt -> exam -> course -> school -> organization
question -> course -> school -> organization
candidate -> school / organization
score -> attempt -> candidate + exam
```

Required invariant:

```txt
PostgreSQL is the source of truth for resource ownership.
Redis must not decide authorization.
```

---

# 7. Role → Permission Matrix

Produce a full matrix.

Minimum columns:

| Permission | Admin | Teacher | Proctor | Grader | Candidate | System | Scope | Sensitive? |
| ---------- | ----: | ------: | ------: | -----: | --------: | -----: | ----- | ---------: |

Use these symbols:

```txt
✅ allowed by default
⚠️ allowed only with explicit scoped assignment
❌ not allowed
SYS system-only
OWN own-resource only
```

The matrix must make these boundaries explicit:

1. Admin is compatibility superset.
2. Teacher does not automatically view candidate answers.
3. Teacher does not automatically grade.
4. Proctor cannot view candidate answers.
5. Proctor cannot grade.
6. Grader can grade but cannot publish results by default.
7. Candidate can only access own attempt / own score.
8. System actor is not assignable.

---

# 8. Route → Permission → Scope → Audit Registry

Design the future registry.

Registry entry shape:

```ts
type RoutePermissionRegistryEntry = {
  method: HttpMethod;
  path: string;
  currentGate: string;
  permission: PermissionKey;
  resource: {
    type: ResourceType;
    idSource: "params" | "body" | "query" | "ctx" | "none";
    idKey?: string;
  };
  scope: ScopeType;
  resolver: ResolverKey;
  auditAction?: AuditActionKey;
  sensitive: boolean;
  migrationStage: number;
};
```

Must cover route families:

```txt
auth
users
candidates
candidate fields
courses
questions
exams
enrollments
attempt candidate runtime
attempt admin/proctor operations
grading queue/detail/grade
scores/result publishing
exports
audit logs
settings
system diagnostics
client events
proctor monitoring
```

Minimum required entries:

| Route Family | Current Gate | Future Permission | Resource | Scope | AuditAction | Sensitive? |
| ------------ | ------------ | ----------------- | -------- | ----- | ----------- | ---------: |

Special required mappings:

```txt
POST /admin/attempts/:attemptId/force-submit
  -> attempt.force_submit
  -> attempt scope
  -> attempt.forceSubmit

POST /admin/attempts/:attemptId/extend-time
  -> attempt.time.extend
  -> attempt scope
  -> attempt.extendTime

POST /admin/attempts/:attemptId/misconduct
  -> attempt.misconduct.mark
  -> attempt scope
  -> attempt.misconductFlagged

GET /admin/attempts/:attemptId/grading-details
  -> grading.detail.view + grading.answer.view
  -> attempt scope
  -> grading.detail_viewed

POST /admin/attempts/:attemptId/grade-question
  -> grading.score.write
  -> attempt/question scope
  -> grading.score_entered

GET /scores/attempts/:attemptId
  -> score.own.view OR score.all.view
  -> own_score / attempt scope
```

---

# 9. Admin Compatibility Policy

Design the compatibility migration policy.

Must answer:

1. Which current Admin routes must remain accessible to Admin?
2. Should Admin initially receive all permissions?
3. How should Admin receive proctor permissions that are currently not assigned?
4. Should Admin receive grading permissions?
5. Should Admin receive system diagnostics permissions?
6. Should Admin receive candidate runtime permissions?
7. Should Admin receive System actor permissions?
8. How does last-admin guard survive role assignment migration?
9. Should current `users.role = "Admin"` map to an implicit Admin role assignment?
10. When can Admin stop being a superset?

Required conclusion:

```txt
During Phase 3 migration, Admin is a compatibility superset for all current Admin-gated APIs.
Admin must not receive Candidate own-runtime permissions or System-only permissions unless explicitly justified.
```

---

# 10. Shadow Permission Mode

Design a migration safety mechanism.

The system should be able to run both checks:

```txt
legacy requireRole result
new requireCapability result
```

and compare them before enforcement.

Required design:

```ts
shadowRequireCapability(ctx, {
  legacyGate: ["Admin"],
  permission: "attempt.force_submit",
  resource: { type: "attempt", id: attemptId },
});
```

It should record:

```txt
route
actorId
role
permissions
resource
legacyAllowed
capabilityAllowed
decision
reason
timestamp
```

Must answer:

1. Where should shadow results be logged?
2. Should shadow mismatch fail tests?
3. Should shadow mismatch fail production requests?
4. Which routes enter shadow mode first?
5. How long should shadow mode run before enforcement?
6. How to avoid leaking sensitive resource info in logs?
7. How to test shadow mode?

Required conclusion:

```txt
Shadow mode must not change production behavior.
Shadow mode exists to prove permission matrix compatibility before enforcement.
```

---

# 11. Audit Boundary

Design how RBAC interacts with audit.

Must answer:

1. Should permission checks write audit logs?
2. Should denied permission checks write audit logs?
3. Which sensitive reads need audit?
4. Should `grading.detail_viewed` be added?
5. Should `user.role.assign` be audited?
6. Should permission changes be audited?
7. Should audit action names be constants?
8. Should audit logs remain separate from client events?
9. Should monitoring events remain separate from audit logs?

Required conclusion:

```txt
AuditAction constants should exist before broad permission migration.
Sensitive reads like grading detail view need explicit audit.
Audit logs and client telemetry remain separate.
```

---

# 12. System Actor Policy

Design the future system actor model.

Must answer:

1. Is System actor a DB user?
2. Is System actor a synthetic actor ID?
3. Does System actor have role assignments?
4. Does System actor use permissions?
5. Which operations can System actor perform?
6. How should audit logs represent System actor?
7. How to replace hardcoded Admin role in scanners?
8. Should System actor be visible in UI?

Required conclusion:

```txt
System actor is not a human role.
System actor is non-login.
System actor should not be represented as Admin.
```

---

# 13. Data Model Proposal

This job must propose a future data model, but not implement it.

Minimum proposal:

```txt
roles
permissions
role_permissions
user_role_assignments
```

Optional proposal:

```txt
role_presets
permission_groups
custom_roles
scope_bindings
```

For each table, provide:

```txt
Purpose
Columns
Indexes
Uniqueness constraints
Migration strategy
Compatibility with current users.role
Open risks
```

Must compare at least three options:

## Option A — Keep `users.role` only

Explain why this is insufficient.

## Option B — `users.role` + permission mapping

Explain why this is better but still limited.

## Option C — roles / permissions / role_permissions / user_role_assignments

Explain why this is recommended.

## Option D — full custom RBAC platform immediately

Explain why UI-level custom RBAC can be deferred even if the backend model supports it.

Required conclusion:

```txt
Recommended model should support formal RBAC now and custom roles later.
Do not build only role-string gates.
```

---

# 14. Migration Plan

Produce a staged plan.

Required stages:

## Stage 0 — Audit Baseline

Use existing audit documents as source of truth.

## Stage 1 — Permission Catalog

Introduce permission constants and grouping.

No behavior change.

## Stage 2 — Role Preset Matrix

Define Admin / Teacher / Proctor / Grader / Candidate / System.

No behavior change.

## Stage 3 — Scope Resolver Spec

Define resource resolvers.

No route enforcement yet.

## Stage 4 — Route Permission Registry

Map routes to permission + scope + audit.

No route enforcement yet.

## Stage 5 — Shadow Permission Mode

Run legacy role gate and new capability check side by side.

No behavior change.

## Stage 6 — Enforce Low-Risk Admin Routes

Start with simple organization-scope Admin routes.

## Stage 7 — Enforce Sensitive Routes

Proctor, grading, result publishing, exports.

## Stage 8 — Role Assignment UI / Admin Console

Allow assigning built-in roles with scopes.

## Stage 9 — Custom Role Support

Only after matrix and enforcement are stable.

For each stage, include:

```txt
Goal
Non-goals
Inputs
Outputs
Acceptance criteria
Rollback strategy
Test requirements
```

---

# 15. Required Deliverables

Create the following document:

```txt
docs/phase3/adr-scoped-rbac-architecture.md
```

The document must include:

```txt
# ADR — Phase 3 Scoped RBAC Architecture

## Status
Proposed

## Context

## Current Problems

## Decision Summary

## Non-Goals

## Formal RBAC Model

## Role Presets

## Permission Catalog v0

## Scope Model v0

## Resource Resolver Matrix

## Role → Permission Matrix

## Route → Permission → Scope → Audit Registry

## Admin Compatibility Policy

## Candidate Own-Scope Policy

## Grader Visibility Policy

## Proctor Authority Policy

## System Actor Policy

## Audit Boundary

## Shadow Permission Mode

## Data Model Proposal

## Migration Plan

## Alternatives Considered

## Risks

## Open Questions

## Middle Job Breakdown
```

---

# 16. Middle Job Breakdown

The final ADR must break implementation into Middle Jobs.

Minimum jobs:

```txt
RBAC-M1 — Permission Catalog Constants
RBAC-M2 — Role Preset Matrix
RBAC-M3 — Scope Resolver Interfaces
RBAC-M4 — Route Permission Registry
RBAC-M5 — Shadow Permission Mode
RBAC-M6 — Admin Compatibility Permission Mapping
RBAC-M7 — User Role Assignment Schema Proposal
RBAC-M8 — Built-in Role Assignment Admin API
RBAC-M9 — Frontend Capability-Aware Navigation
RBAC-M10 — Sensitive Route Enforcement Batch
AUDIT-M1 — AuditAction Constants
AUDIT-M2 — Sensitive Read Audit Events
PROCTOR-M1 — Proctor Authority Enforcement
GRADING-M1 — Grader Visibility Enforcement
SYSTEM-M1 — System Actor Replacement
```

Each Middle Job must contain:

```txt
Goal
Non-goals
Inputs
Expected outputs
Files likely touched
Tests required
Acceptance criteria
Rollback strategy
Risk
```

---

# 17. Evidence Requirements

Every major claim must be backed by at least one of:

```txt
file path + line number
existing audit document reference
rg command output
test name
schema reference
route reference
```

Do not write unsupported claims.

If evidence is ambiguous, write:

```txt
Finding is inconclusive because ...
```

---

# 18. Commands to Run

This is a documentation job, but the author should still run evidence commands.

Minimum evidence commands:

```bash
rg "requireRole" apps/api/src/routes apps/api/src/plugins
rg "requirePermission" apps/api/src packages
rg "\"Admin\"|\"Candidate\"" apps/api/src apps/web/src packages
rg "recordAudit|createAuditLogRepo" apps/api/src
rg "candidateAnswer" apps/api/src apps/web/src packages
rg "role:" packages/db/src apps/api/src packages/contracts/src
```

No full test suite is required unless the job changes code.

If any code or test helper is changed accidentally, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

and document the result.

---

# 19. Acceptance Criteria

This job is complete only if:

* `docs/phase3/adr-scoped-rbac-architecture.md` exists.
* The ADR clearly states that Phase 3 will use formal Scoped RBAC.
* The ADR distinguishes RBAC core from custom role UI.
* Permission catalog v0 exists.
* Role preset matrix exists.
* Scope model v0 exists.
* Resource resolver matrix exists.
* Route permission registry draft exists.
* Admin compatibility policy exists.
* Candidate own-scope policy exists.
* Proctor authority policy exists.
* Grader visibility policy exists.
* System actor policy exists.
* Shadow permission mode design exists.
* Data model proposal compares at least 3 options.
* Migration plan Stage 0–9 exists.
* Middle Job breakdown exists.
* No code behavior changed.
* No DB schema changed.
* No API contract changed.
* No permission enforcement changed.
* No audit action renamed.
* Redis is explicitly ruled out as authorization authority.

---

# 20. Review Checklist

Reviewer must verify:

```txt
[ ] This is not a toy role-string model.
[ ] The design supports scoped role assignments.
[ ] Admin compatibility is preserved.
[ ] Proctor cannot view answers or grade by default.
[ ] Grader permissions are split into view detail / view answer / write score / finalize.
[ ] Candidate own-scope is explicit.
[ ] System actor is not Admin.
[ ] Redis is not used for AuthZ.
[ ] Route registry maps permission + resource + scope + audit.
[ ] Audit and client telemetry remain separate.
[ ] Custom RBAC UI is deferred but not made impossible.
[ ] Migration can happen route-by-route.
[ ] Shadow mode prevents behavior-breaking migration.
```

---

# 21. Expected Final Summary Format

```txt
Done:
- Created docs/phase3/adr-scoped-rbac-architecture.md
- Designed formal Scoped RBAC model
- Defined N role presets
- Defined N permission groups
- Defined N permissions
- Defined N scopes
- Drafted route → permission → scope → audit registry
- Proposed staged migration plan
- Proposed N Middle Jobs

Behavior changes:
- None

Schema changes:
- None

Tests/commands:
- <command>: pass/fail/not run and why

Top decisions:
1. ...
2. ...
3. ...

Top risks:
1. ...
2. ...
3. ...

Can implementation jobs start?
- Yes / No

Recommended first Middle Job:
- RBAC-M1 — Permission Catalog Constants
```

---

# 22. Global Risks / Cross-Cutting Requirements

The Scoped RBAC design must explicitly address the following global risks before implementation jobs begin.

---

## 22.1 Confused Deputy / Resource Re-parenting Risk

### Risk

Scope resolution depends on resource parent chains.

Example:

```txt
attempt -> exam -> course -> school -> organization
```

If one link in the chain is mutable or corrupted, authorization may be evaluated against the wrong scope.

Example failure mode:

```txt
A teacher is assigned to Course A.
An exam or attempt is accidentally re-parented from Course B to Course A.
The teacher may incorrectly gain access to attempts they should not control.
```

This is a classic **confused deputy** risk: the authorization checker trusts a resource resolver whose parent chain may have been manipulated.

### Required ADR Decisions

The ADR must answer:

1. Which resource parent links are immutable after creation?
2. Which resource parent links may change?
3. Which parent changes require audit logs?
4. Which parent changes require elevated permissions?
5. Which parent changes should be forbidden after exam publish/start?
6. Which resolver paths must validate organization consistency?
7. Should resolver results include a consistency proof or version?
8. Should attempt/exam/course parent references be denormalized for integrity or performance?
9. Should published exams freeze their course/school/organization ownership?
10. What happens if resolver detects inconsistent parent chains?

### Required Invariant

```txt
Authorization must never rely on a mutable parent chain without validating organization/scope consistency.
```

### Required Resolver Behavior

For sensitive resources, resolver must validate the full ownership chain.

Example:

```txt
resolveAttemptScope(attemptId)
  -> load attempt
  -> load exam
  -> load course if applicable
  -> verify attempt.organizationId === exam.organizationId
  -> verify exam.courseId belongs to same organization/school
  -> return scope chain
```

If inconsistency is detected:

```txt
deny authorization
record structured warning / monitoring event
do not silently allow
```

### Acceptance Criteria

The ADR must include a **Resource Parent Integrity Matrix**:

| Resource  | Parent Link | Mutable? | Freeze Point                  | Integrity Check Required? | Audit Required on Change? |
| --------- | ----------- | -------: | ----------------------------- | ------------------------: | ------------------------: |
| attempt   | exam        |       no | attempt creation              |                       yes |                       n/a |
| answer    | attempt     |       no | answer save                   |                       yes |                       n/a |
| exam      | course      |    maybe | publish/start                 |                       yes |                       yes |
| course    | school/org  |    maybe | course creation / migration   |                       yes |                       yes |
| candidate | school/org  |    maybe | enrollment / attempt creation |                       yes |                       yes |

---

## 22.2 Scope Resolver Performance / Observability

### Risk

Scoped RBAC introduces resource resolution cost.

A single permission check may require multiple DB reads:

```txt
attempt -> exam -> course -> school -> organization
```

If every route performs repeated uncached resolver calls, high-traffic paths such as save answer, heartbeat, proctor dashboard, grading queue, and score export may become slower or noisier.

### Required ADR Decisions

The ADR must answer:

1. Which resolvers are hot-path?
2. Which resolvers can be cached per request?
3. Which resolvers can be cached across requests?
4. Which resolver results must never be cached?
5. What is the cache invalidation rule?
6. Should resolver timing be recorded during shadow mode?
7. Should resolver query count be recorded during shadow mode?
8. What performance budget should a resolver target?
9. Which routes should not use heavyweight resolvers unless needed?
10. How should resolver performance regressions fail tests or CI?

### Required Invariant

```txt
PostgreSQL remains the source of truth.
Caching may optimize scope resolution but must not become authorization authority.
```

### Recommended Design

Implement request-local resolver caching first.

Example:

```txt
request.authzCache.resolveAttemptScope[attemptId]
```

Allowed:

```txt
same request
same actor
same resource
same transaction or stable read
```

Not allowed initially:

```txt
Redis-authoritative authorization cache
cross-request permission grant cache without invalidation
cache that outlives role assignment changes
```

### Shadow Mode Requirement

Shadow mode must collect resolver metrics:

```txt
route
permission
resourceType
resolverName
resolverCallCount
resolverDurationMs
dbQueryCount if available
cacheHit / cacheMiss
legacyAllowed
capabilityAllowed
```

### Acceptance Criteria

The ADR must include a **Resolver Performance Matrix**:

| Resolver            | Hot Path? | Request Cache? | Cross-Request Cache? | Expected Cost                 | Metrics Required? |
| ------------------- | --------: | -------------: | -------------------: | ----------------------------- | ----------------: |
| resolveAttemptScope |       yes |            yes |         no initially | attempt + exam lookup         |               yes |
| resolveExamScope    |       yes |            yes |          maybe later | exam lookup                   |               yes |
| resolveCourseScope  |    medium |            yes |          maybe later | course lookup                 |               yes |
| resolveOwnAttempt   |       yes |            yes |                   no | attempt + candidate match     |               yes |
| resolveGradingScope |    medium |            yes |                   no | attempt + question validation |               yes |

---

## 22.3 Runtime State Transitions Must Also Be Permissioned

### Risk

The design separates authorization from runtime state, which is correct. However, implementation must not forget that **state-changing runtime operations also require authorization**.

Example:

```txt
Permission answers: may this actor force-submit?
State machine answers: is force-submit legal from current attempt status?
```

Both must pass.

### Required Rule

Every runtime state transition must have:

```txt
permission check
+ state transition legality check
+ audit event if sensitive
```

### Examples

```txt
attempt.force_submit
  -> requires attempt.force_submit permission
  -> allowed only from in_progress / disrupted / maybe submitted depending policy
  -> writes attempt.forceSubmit audit

attempt.time.extend
  -> requires attempt.time.extend permission
  -> allowed only before closed / archived / terminal state
  -> writes attempt.extendTime audit

attempt.submit
  -> requires attempt.submit or own attempt submit permission
  -> allowed only from in_progress / disrupted and before deadline
  -> writes attempt.submit audit

exam.publish
  -> requires exam.publish permission
  -> allowed only from draft / closed depending lifecycle policy
  -> writes exam.publish audit

exam.result.publish
  -> requires result.publish permission
  -> allowed only after grading complete / exam closed
  -> writes exam.publish_results audit
```

### Required ADR Decisions

The ADR must answer:

1. Which state transitions exist?
2. Which permission protects each transition?
3. Which state machine guard protects each transition?
4. Which transitions are system-only?
5. Which transitions are admin/proctor/teacher/grader initiated?
6. Which transitions require audit?
7. Which transitions are idempotent?
8. Which transitions are irreversible?
9. Which transitions are forbidden after publish/start/submit/grade?
10. Which transitions belong to separate Large Jobs and are only referenced here?

### Required Invariant

```txt
No runtime state transition may be exposed as an API without a corresponding permission or explicit public/self-service policy.
```

### Acceptance Criteria

The ADR must include a **State Transition Permission Matrix**:

| Transition           | Actor Type    | Required Permission       | Required State Guard                | AuditAction           | Notes                  |
| -------------------- | ------------- | ------------------------- | ----------------------------------- | --------------------- | ---------------------- |
| attempt.start        | Candidate     | attempt.start / exam.take | own_attempt + available             | attempt.start         | self-service           |
| attempt.submit       | Candidate     | attempt.submit            | own_attempt + in_progress/disrupted | attempt.submit        | runtime guard required |
| attempt.force_submit | Proctor/Admin | attempt.force_submit      | attempt not terminal                | attempt.forceSubmit   | sensitive              |
| attempt.time.extend  | Proctor/Admin | attempt.time.extend       | exam/attempt open policy            | attempt.extendTime    | sensitive              |
| grading.score.write  | Grader/Admin  | grading.score.write       | pending_manual                      | grading.score_entered | sensitive              |
| exam.result.publish  | Teacher/Admin | result.publish            | grading complete / policy           | exam.publish_results  | sensitive              |

---

## 22.4 `requirePermission()` Compatibility Review

### Risk

The current `requirePermission()` exists but was designed for a flat permission list on `ctx.permissions`.

The new model requires resource-aware capability checks:

```txt
permission + resource + scope + resolver
```

Therefore the current helper may not satisfy Phase 3 requirements.

### Required ADR Decisions

The ADR must answer:

1. Should current `requirePermission(permission)` be kept?
2. Should it be deprecated?
3. Should it be renamed to `requireFlatPermission`?
4. Should new code use `requireCapability()` instead?
5. Should `ctx.permissions` remain as a flat cache?
6. Should `ctx.role` remain for compatibility only?
7. Should `ctx.roleAssignments` be introduced?
8. Should route preHandlers use registry-driven capability checks?
9. Should `requirePermission()` be forbidden for scoped resources?
10. Which routes, if any, can safely use flat permissions?

### Recommended Direction

Use a new resource-aware API:

```ts
requireCapability({
  permission: PermissionKey,
  resource: {
    type: ResourceType,
    id: string,
  },
});
```

or:

```ts
await authz.can(ctx, {
  permission: "attempt.force_submit",
  resourceType: "attempt",
  resourceId: attemptId,
});
```

Keep old `requirePermission()` only for:

```txt
system-level permissions
temporary compatibility
tests
non-resource-sensitive routes
```

Do not use old `requirePermission()` for:

```txt
attempt
exam
course
grading
score
candidate answer
proctor timeline
exports
```

### Required Invariant

```txt
Flat permission checks are insufficient for scoped resources.
All scoped resources must use resource-aware capability checks.
```

### Acceptance Criteria

The ADR must include a **Permission Helper Decision Table**:

| Helper                  | Current / New  | Resource-Aware? | Allowed Use                          | Forbidden Use                      |
| ----------------------- | -------------- | --------------: | ------------------------------------ | ---------------------------------- |
| requireRole             | current legacy |              no | compatibility only                   | new enforcement                    |
| requirePermission       | current flat   |              no | system/non-resource permissions only | attempt/exam/grading scoped routes |
| requireCapability       | new            |             yes | all scoped routes                    | n/a                                |
| shadowRequireCapability | new            |             yes | migration compatibility validation   | final enforcement only             |

---

# 23. Additional Review Checklist

Reviewer must verify:

```txt
[ ] ADR mentions confused deputy / resource re-parenting risk.
[ ] ADR defines immutable or frozen parent links for sensitive resources.
[ ] ADR requires organization/scope consistency checks in resolvers.
[ ] ADR discusses resolver performance.
[ ] ADR defines request-local resolver caching policy.
[ ] ADR requires resolver metrics in shadow mode.
[ ] ADR states every runtime state transition needs permission + state guard.
[ ] ADR includes State Transition Permission Matrix.
[ ] ADR reviews current requirePermission() signature.
[ ] ADR introduces or proposes resource-aware requireCapability().
[ ] ADR forbids flat permission checks for scoped sensitive resources.
```
