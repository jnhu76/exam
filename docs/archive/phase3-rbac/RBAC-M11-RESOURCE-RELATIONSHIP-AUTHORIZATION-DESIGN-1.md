# RBAC-M11 RESOURCE-RELATIONSHIP AUTHORIZATION — DESIGN BACKLOG

**Status:** DEFERRED — NOT IMPLEMENTED

**Created by:** RBAC-M10-B-SINGLE-TENANT-CORRECTIVE-2

---

## Purpose

This is a design backlog note, not an implementation task. It records the
known requirement for resource-level assignment authorization that M10-B
explicitly deferred.

M10-B established flat capability-based authorization for 28 admin/management
routes. It did NOT implement resource-scope enforcement (Teacher-to-course,
Teacher-to-exam, Proctor-to-exam, Grader-to-work).

---

## Current state (post M10-B)

```text
IMPLEMENTED:
- authentication
- flat capability preset
- single-organization data context
- handler/service existence checks
- handler/service state invariants

IMPLEMENTED ELSEWHERE:
- Candidate self-owned access through the M10-A candidate-runtime route set
  (GET /candidate/exams; exam detail/queue/start; attempt view/take/
  answer-save/submit/heartbeat/restore). These routes use the
  candidate_context, exam_eligibility, and own_attempt capability gates
  declared in apps/api/src/authz/routeRegistry.ts and wired in
  apps/api/src/routes/attempts.candidate.ts.

NOT IMPLEMENTED / DEFERRED:
- Teacher resource assignment (Teacher-to-course, Teacher-to-exam)
- Proctor resource assignment (Proctor-to-exam)
- Grader resource assignment (Grader-to-work)
- general resource-scope resolver execution for admin/management routes
```

Candidate ownership enforcement is implemented for the M10-A candidate-runtime
route set. Broader ownership hardening, if any, requires separate evidence.

---

## Existing assignment infrastructure (do not conflate)

The repository already contains **user-to-role** assignment infrastructure
(RBAC-M7 schema + RBAC-M8 admin API). This is distinct from
**actor-to-resource** assignment and must not be erased or misrepresented:

```text
EXISTS (RBAC-M7 / RBAC-M8):
- table: user_role_assignments
  (packages/db/src/schema/pg.ts)
  columns: organizationId, userId, role, isPrimary, isActive
  Note: scoped to (organization, user, role) only — there is NO
  scope_type / scope_resource_id column, so this table does NOT model
  Teacher-to-course, Proctor-to-exam, or Grader-to-work assignment.
- repository: createUserRoleAssignmentRepo
  (packages/db/src/repository/userRoleAssignmentRepo.ts)
- admin API surface for role assignment (RBAC-M8)

DOES NOT EXIST:
- Teacher-to-course / Teacher-to-exam assignment enforcement
- Proctor-to-exam assignment enforcement
- Grader-to-work assignment enforcement
- a general resource-scope resolver for admin/management routes
- junction tables such as course_staff, teacher_course, teacher_exam,
  exam_proctor, grading_assignment
```

User-to-role assignment exists. Teacher-to-course, Teacher-to-exam,
Proctor-to-exam, and Grader-to-work resource assignment enforcement is not
active for the M10-B route set.

---

## Design decisions required

### Admin

- Organization-wide authority is the current assumption.
- No change required unless a future scope-limit policy is introduced.

FUTURE POLICY DECISION:

When resource-scope enforcement is implemented, determine whether Admin
bypasses resource assignment checks organization-wide. The current M10-B
route set runs flat capability gates only — no resource-scope check executes
at runtime, so there is no active Admin bypass behavior to document as
"current behavior". Formalizing Admin scope behavior belongs to the resource
authorization milestone, not to M10-B.

### Teacher

- Decision: global academic operator or assigned-resource role?
- If assigned: what schema? `course_staff`, `teacher_course`, `teacher_exam`?
- Resource inheritance: Teacher assigned to course → all exams in that course?
- Admin bypass policy (see FUTURE POLICY DECISION above).

### Proctor

- Decision: global proctor operator or exam-assigned role?
- If assigned: `exam_proctor` table?
- What resources does proctor see? Only assigned exams? All open exams?
- Admin bypass policy (see FUTURE POLICY DECISION above).

### Grader

- Decision: global grader or assignment-based role?
- If assigned: `grading_assignment` table?
- What resources does grader see? Pending queue for assigned exams only?
- Admin bypass policy (see FUTURE POLICY DECISION above).

### Candidate

- Self-owned: enrollment → attempt → answer → result.
- Currently enforced by the M10-A candidate-runtime route set (see
  "Current state" above).
- No change expected unless the ownership chain needs hardening beyond the
  M10-A route set.

---

## Future work items

1. **Assignment schema design**

   - Define the data model for resource-scope assignments.
   - Tables: `course_staff`, `exam_proctor`, `grading_assignment`, etc.

2. **Resource inheritance rules**

   - Teacher assigned to course → inherits all exams in that course?
   - Proctor assigned to exam → sees all attempts in that exam?
   - Grader assigned to exam → sees all pending grading entries?

3. **Resolver API**

   - Generic `resolveScope(ctx, resource, permission)` → resource list.
   - Integration with `requireCapability` preHandler.

4. **Admin bypass policy**

   - Formalize whether Admin bypasses resource-scope checks organization-wide.
   - This is a future policy decision; the M10-B route set has no active
     scope check for Admin to bypass today.

5. **403 versus 404 policy**

   - When a resource exists but is not in the actor's scope: 403 or 404?
   - Anti-enumeration considerations.

6. **Assignment revocation**

   - What happens when a Teacher is removed from a course mid-exam?
   - What happens when a Proctor is removed from an exam mid-exam?

7. **Historical data migration**

   - Existing data has no actor-to-resource assignment records.
   - How to seed initial assignments for existing deployments?

8. **Route-family migration order**

   - Which route families migrate first? (Course CRUD? Exam lifecycle? Proctor? Grader?)
   - Migration order must respect the route registry's `migrationStage` field.

---

## Route registry fields reserved for this milestone

The following fields in `ROUTE_PERMISSION_REGISTRY` are PLANNED metadata
for resource-scope enforcement. They are NOT consumed at runtime by the
current "flat" capability preHandler on the M10-B route set:

- `scope` — the scope type the capability check resolves against.
- `resolver` — the resolver key that reduces the resource to the scope.
- `resource` — resource specification (single or list).
- `migrationStage` — the ADR migration stage that will enforce this entry.

The route registry header states explicitly that the registry is metadata +
a coverage test and does not enforce anything at runtime.

---

## Scope boundary

This milestone must NOT implement:

- Multi-tenant infrastructure (Phase 4).
- Cross-organization authorization.
- SuperAdmin role.
- Tenant switcher.
