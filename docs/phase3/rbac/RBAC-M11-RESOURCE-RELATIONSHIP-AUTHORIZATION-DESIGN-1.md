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
Teacher-to-exam, Proctor-to-exam, Grader-to-work, Candidate-to-own).

---

## Current state (post M10-B)

```
IMPLEMENTED:
- authentication
- flat capability preset
- single-organization data context
- handler/service existence checks
- handler/service state invariants

NOT IMPLEMENTED:
- Teacher resource assignment
- Proctor resource assignment
- Grader resource assignment
- Candidate self-owned resource enforcement
- general resource-scope resolver execution
```

---

## Design decisions required

### Admin

- Organization-wide authority is the current assumption.
- No change required unless a future scope-limit policy is introduced.

### Teacher

- Decision: global academic operator or assigned-resource role?
- If assigned: what schema? `course_staff`, `teacher_course`, `teacher_exam`?
- Resource inheritance: Teacher assigned to course → all exams in that course?
- Admin bypass: does Admin assignment override or is Admin always org-wide?

### Proctor

- Decision: global proctor operator or exam-assigned role?
- If assigned: `exam_proctor` table?
- What resources does proctor see? Only assigned exams? All open exams?
- Admin bypass policy.

### Grader

- Decision: global grader or assignment-based role?
- If assigned: `grading_assignment` table?
- What resources does grader see? Pending queue for assigned exams only?
- Admin bypass policy.

### Candidate

- Self-owned: enrollment → attempt → answer → result.
- Currently enforced by candidate-runtime routes (M10-A).
- No change expected unless the ownership chain needs hardening.

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
   - Admin always passes all scope checks (current behavior).
   - Formalize as a policy, not just a side effect.

5. **403 versus 404 policy**
   - When a resource exists but is not in the actor's scope: 403 or 404?
   - Anti-enumeration considerations.

6. **Assignment revocation**
   - What happens when a Teacher is removed from a course mid-exam?
   - What happens when a Proctor is removed from an exam mid-exam?

7. **Historical data migration**
   - Existing data has no assignment records.
   - How to seed initial assignments for existing deployments?

8. **Route-family migration order**
   - Which route families migrate first? (Course CRUD? Exam lifecycle? Proctor? Grader?)
   - Migration order must respect the route registry's `migrationStage` field.

---

## Route registry fields reserved for this milestone

The following fields in `ROUTE_PERMISSION_REGISTRY` are PLANNED metadata
for resource-scope enforcement. They are NOT consumed at runtime by the
current "flat" capability preHandler:

- `scope` — the scope type the capability check resolves against.
- `resolver` — the resolver key that reduces the resource to the scope.
- `resource` — resource specification (single or list).
- `migrationStage` — the ADR migration stage that will enforce this entry.

---

## Scope boundary

This milestone must NOT implement:

- Multi-tenant infrastructure (Phase 4).
- Cross-organization authorization.
- SuperAdmin role.
- Tenant switcher.