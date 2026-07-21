# ADR — Phase 3 Scoped RBAC Architecture

> **Type:** Large Design Job / Grillme / ADR (documentation only)
> **Phase:** Phase 3 Pre-Implementation
> **Job card:** `docs/archive/phase3/P3-L2-scoped-rbac-job-card.md`
> **Status:** Proposed
> **Date:** 2026-06-30
> **Branch:** `role-permission`

## Status

**Accepted — infrastructure implemented.** The capability-based authorization
model, permission catalog, role presets, scope model, and resolver matrix
described in this ADR are **implemented and live** (`packages/authz/`,
`apps/api/src/authz/`). Every production route is capability-gated; legacy
`requireRole` and `users.role` authority have been removed (M10-A through
M10-F, all merged). See [`docs/architecture/authorization.md`](../architecture/authorization.md)
for the implemented model.

> **What is NOT implemented** is the Phase 3 *product* work built on top of this
> infrastructure: scoped Teacher/Proctor/Grader role bundles as product roles,
> resource-relationship assignment (M11), staff invitation, SMTP password reset,
> and account-lifecycle UI. Those are tracked in
> [`docs/roadmap/phase3-open-items.md`](../roadmap/phase3-open-items.md).
>
> **Gate 0.5 caveat:** the post-PR-197 re-verification (M10-F rerun) is PENDING.
> The infrastructure is live; the PASS closure verdict is not freshly
> re-verified. See [`docs/status/implementation-status.md`](../status/implementation-status.md).

This ADR is documentation-only — it changes no code by being written. It records
the architecture decisions that the implementation then realized.

---

## Context

The platform is a **LAN / on-premise exam system** (`docs/SPEC.md`, `AGENTS.md`). Phase 1 is single-tenant, multi-user, with two product roles: `Admin` and `Candidate` (`packages/domain/src/enums.ts:1-6`). Phase 3 must introduce Teacher / Proctor / Grader / System-like authority without breaking current Admin behavior or violating the single-tenant boundary (`AGENTS.md` §"Phase1.4", "Phase2-Ready").

This ADR is the formal authorization design that **must** exist before any Phase 3 role/permission implementation job begins (job card §1). It is built directly on top of the fact base produced by the Phase 3 audits:

- `docs/archive/phase3/audit-authz-framework-readiness.md` (P3-AUTHZ-AUDIT) — primary evidence source
- `docs/archive/phase3/audit-current-role-checks.md` (S3)
- `docs/archive/phase3/audit-current-events.md` (S6)
- `docs/archive/phase3/audit-current-grading-api.md` (S3b)
- `docs/archive/phase3/audit-current-redis.md` (S5)
- `docs/archive/phase3/audit-current-candidate-runtime.md` (S7)
- `docs/archive/phase3/audit-current-answer-payload.md` (S8)

All load-bearing claims in this ADR cite a file path + line number, an audit section, or a live `rg` result (job card §17). Where evidence is ambiguous, this ADR says so explicitly.

---

## Current Problems

> ⚠️ **Historical snapshot.** This section and the Evidence Appendix below
> describe the **pre-migration** state that motivated this ADR (the coarse
> 2-role `requireRole` model, the dead `requirePermission` layer, the 4 proctor
> migration traps). Those problems have since been **addressed and merged**
> (Scoped RBAC foundation, SYSTEM-M1, multi-role assignments, 11 flipped routes
> — PR #149–#153 + enforcement series). The text is retained verbatim because it
> is the ADR's problem statement; it is **not** the current state. For current
> status see `docs/status/implementation-status.md` and `docs/archive/phase3/RBAC-JOB-QUEUE.md` ("Current real
> gap"). The single remaining open item is RBAC-M10-finish (resolver wiring +
> remaining route flips).

> Verbatim from the fact base, each re-verified live for this ADR.

1. **Two-role coarse gate, not a permission model.** Authorization is `authenticate → requireRole(["Admin" | "Candidate"]) → handler`. Distribution (live `rg`): **62 Admin-only + 9 Candidate-only + 1 both-roles** call sites across 16 route files (`audit-authz-framework-readiness.md` §2.1; re-verified: see §Evidence Appendix of this ADR).

2. **Dead parallel AuthZ layer.** `requirePermission()` is implemented (`apps/api/src/plugins/auth.ts:104-119`) and `ctx.permissions` is populated on every authenticated request (`auth.ts:85` via `getPermissionsForRole`), but **zero production routes call `requirePermission()`**. Live re-verification: the only references are its definition, its type declaration (`apps/api/src/types/fastify-auth.d.ts:18`), and a doc comment.

3. **Proctor-permission migration trap (R11).** Four proctor permissions — `VIEW_EXAM_ROOM`, `EXTEND_TIME`, `MARK_MISCONDUCT`, `FORCE_SUBMIT` — are *defined* (`packages/domain/src/enums.ts:34-38`) but **not granted to Admin** in `ROLE_PERMISSIONS` (`packages/auth/src/rbac.ts:4-23`). Their routes today are gated by `requireRole(["Admin"])`. A naïve migration to `requirePermission(...)` would therefore **deny Admin**.

4. **Dead permission.** `MANAGE_ORGANIZATION` is defined (`enums.ts:17`) but granted to no role and used by no route — fully dead.

5. **No scope layer.** `TenantGuard` (`packages/auth/src/tenantGuard.ts`) validates only public-endpoint bypass; `validateTenantAccess` is a Phase-1 no-op (`tenantGuard.ts:45-52`). All access is organization-all-or-nothing per role. The own-attempt / own-score boundary is enforced ad-hoc inside handlers (`apps/api/src/routes/scores.ts:80`) and by `candidateProfile.id` matching, not by a scope resolver.

6. **Hardcoded role strings + scattered handler-level role logic.** ~22 production sites use `"Admin"`/`"Candidate"` literals or inline `z.enum` instead of the `Role` const; ~5 handler sites re-check `ctx.role`/`user.role` ad-hoc (`audit-authz-framework-readiness.md` §2.2, §2.4).

7. **No `AuditAction` registry.** `audit_logs.action` is free-form `text`; ~43 distinct literals live at ~30 call sites with no enum/union (`audit-authz-framework-readiness.md` §7.1).

8. **System work masquerades as Admin.** Background scanners synthesize a `RequestContext` with hardcoded `role: "Admin"` (`apps/api/src/plugins/deadlineScanner.ts:97`, `apps/api/src/plugins/heartbeat.ts:103`). This conflates a non-human actor with the human-admin role.

9. **Sensitive reads with no audit.** `GET /admin/attempts/:attemptId/grading-details` returns the candidate's answer payload (`candidateAnswer`) but writes no audit event (`audit-authz-framework-readiness.md` §7.2).

---

## Decision Summary

1. **Phase 3 adopts a formal Scoped RBAC model** — actor → role assignment → role → permission → scope → resource resolver → audit action — **not** a role-string gate and **not** a flat permission-list gate.
2. **Roles are product presets, not authorization hardcoding.** `Admin`, `Teacher`, `Proctor`, `Grader`, `Candidate`, `System` are defined as data (code constants seeded as DB rows), and `users.role` becomes a compatibility cache backed by `user_role_assignments`.
3. **`requireCapability()` replaces `requireRole()` and flat `requirePermission()` for all scoped resources.** Flat permission checks remain allowed only for system-level / non-resource routes.
4. **Admin is a compatibility superset during migration.** Existing Admin behavior is preserved. Migration is route-by-route behind a shadow mode.
5. **PostgreSQL is the authorization source of truth.** Redis is explicitly ruled out as an AuthZ authority (§Audit Boundary, §Redis Boundary).
6. **Custom role UI is deferred, not made impossible.** The backend model supports custom roles; the Admin Console UI for them is Phase 4.
7. **RBAC and the domain state machine are two independent checks.** Every runtime state transition requires *both* a permission check and a state-machine legality check, plus an audit event when sensitive (§22.3). This is a global invariant, restated below.

> **Cross-cutting invariant — RBAC does not replace the domain state machine.**
>
> RBAC answers *who may request a transition.*
> The state machine answers *whether the transition is legal now.*
> Both are required.
>
> Concretely: `attempt.force_submit` (a permission) is necessary but not sufficient; the attempt must also be in a non-terminal status (a state guard). A granted permission never authorizes a transition that the state machine forbids, and a legal state never authorizes a transition the actor lacks permission for. This invariant is enforced at every sensitive transition in §22.3 and fences AuthZ cleanly from the candidate runtime (§Candidate Own-Scope Policy).

---

## Non-Goals

(Same as job card §2, restated for completeness.)

- Do **not** implement code, write migrations, modify DB schema, replace `requireRole()`, or enforce `requirePermission()` in this job.
- Do **not** introduce CASL / Casbin / Oso / Permify or any external AuthZ library.
- Do **not** build a custom-role management UI.
- Do **not** allow arbitrary user-defined permissions.
- Do **not** solve Answer Protocol v2, the WYSIWYG submit barrier, the frontend exam state machine, or E2E full parallelization — these are separate Large Jobs and are only *referenced* here, fenced off as in the readiness audit §10–§11.
- Do **not** merge audit logs and client telemetry.
- Do **not** use Redis for authorization.

---

## Formal RBAC Model

### Model choice: Scoped RBAC (hybrid, resource-aware)

| Question (job §3.1.1) | Decision | Rationale |
| --- | --- | --- |
| Classic RBAC? | No | Classic RBAC is role→permission only; it cannot express "this Teacher may grade *attempts in their course*" without an out-of-band check. The platform needs course/exam/attempt-level scoping (readiness §5). |
| Scoped RBAC? | **Yes (core)** | Permission grants are scoped to a resource boundary; a scope resolver reduces a concrete resource to the granted scope before the capability check. |
| ABAC? | No (deferred) | Full attribute-based policies are over-engineering for Phase 3 and would couple AuthZ to arbitrary resource attributes. The resource resolver gives *most* of ABAC's value (resource-aware checks) without the policy-language complexity. |
| Hybrid? | Yes — Scoped RBAC + resource-aware capability check | The capability check `requireCapability({permission, resource})` is the resource-aware seam. It is "scoped RBAC + a thin resource-resolution step", not pure ABAC. |

**Conclusion:** Phase 3 builds a formal **Scoped RBAC** core with a resource-aware capability check on top. This is the minimum formal model that avoids a toy implementation (job §3.1 required conclusion).

### Minimum formal entities

```
Actor
  └─ User (human) or System Actor (synthetic, non-login)
Role Assignment (user_role_assignments)
  └─ binds an actor to a Role at a Scope, optionally scoped to a resource
Role (preset: Admin/Teacher/Proctor/Grader/Candidate/System)
  └─ grants a set of Permissions
Permission (domain.resource.action constant)
Scope (system/organization/course/exam/attempt/own_attempt/own_score/...)
Resource Resolver (reduces a concrete resource id → scope + ownership chain)
Route Permission Registry (method+path → permission + scope + audit)
Audit Action (constant)
```

### Required decisions (job §3.1.2–3.1.7)

1. **Should `users.role` remain?** **Yes, as a compatibility cache.** `users.role` (`packages/db/src/schema/pg.ts:105`, plain `text`, no DB ENUM/CHECK) stays for the Phase 1/2 login path and the last-admin guard (`apps/api/src/routes/user.ts:189-201`). It is *derived* from `user_role_assignments`, not authoritative, once assignments exist.
2. **Deprecate `users.role`?** **Phase 3: no.** It is read on every authenticate (`auth.ts:84`) and by 5+ handler sites. Removing it is a separate migration (RBAC-M7). Mark it *compatibility-only* in code/docs now.
3. **Role presets: code, DB, or both?** **Both.** Defined as code constants (source of truth, type-safe) and seeded as immutable DB rows (`role_presets.is_system = true`). Custom roles (Phase 4) are DB-only with `is_system = false`.
4. **Permissions: code constants, DB rows, or both?** **Both.** Code constants are the closed set (prevents unknown permission strings — job §3.1.5). Seeded as DB rows in `permissions` for queryability and for the future `role_permissions` join. A DB row whose key is not in the code constants is a **load-time error** — this is how unknown permissions are prevented.
5. **Prevent unknown permission strings?** A `Permission` const object (closed union) + a startup self-check that every `permissions` row maps to a known constant. The route registry keys off the union type, so a typo is a compile error.
6. **Prevent unknown role strings?** Same pattern: `Role` const union + startup check that every `role_presets` row maps to a known key. `users.role` accepts only the union (today enforced only at the app layer via Zod + login rejection at `auth.ts:155` — RBAC-M7 adds a DB CHECK/ENUM).
7. **Before custom-RBAC UI exists?** Role presets are product defaults assigned via the existing user-management surface (Admin assigns the built-in role). No custom-role editor is shipped in Phase 3. The model *supports* custom roles; the UI for them is Phase 4.

> **Required conclusion (job §3.1):** Phase 3 builds a formal Scoped RBAC core. Custom role UI is deferred. Role presets are product defaults, not authorization hardcoding.

---

## Role Presets

> Minimum set: `Admin`, `Teacher`, `Proctor`, `Grader`, `Candidate`, `System` (job §3.2). All boundaries below are *defaults* (preset grants); scoped assignment (job §3.2 "scoped role assignment") can narrow them per resource.

### Admin

| Field | Value |
| --- | --- |
| Purpose | Platform-wide configuration & migration-compatibility superset. |
| Assignable? | **Yes** — human assignment only. |
| Login allowed? | Yes. |
| Default scope | organization. |
| Permission groups | All organization-scope management perms (users, candidates, candidate-fields, courses, questions, exams lifecycle, settings, audit-log view, system-health view, scores view/export) **+ all current Admin-gated proctor/grading perms during migration** (see Admin Compatibility Policy). |
| Sensitive permissions | `MANAGE_USERS`, `FORCE_SUBMIT`, `EXTEND_TIME`, `MARK_MISCONDUCT`, `VIEW_CANDIDATE_ANSWER`, `GRADE_ANSWER`, `EXPORT_SCORES`, `user.role.assign`. |
| Explicitly forbidden | Candidate own-runtime perms (`attempt.start`, `attempt.answer.save`, `attempt.submit`, `attempt.heartbeat.send`, `score.own.view`); System-only perms (`system.auto_submit`, `system.heartbeat_scan`). |
| Migration notes | Today 15 perms in `ROLE_PERMISSIONS` (`rbac.ts:5-21`); migration adds the 4 proctor perms + grading perms as a **compatibility superset** so `requireRole(["Admin"])` routes keep working when flipped to `requireCapability`. See Admin Compatibility Policy. |

**Decisions (job §3.2 Admin):**
1. Is Admin a compatibility superset in Phase 3? **Yes.**
2. Does Admin temporarily include Teacher/Proctor/Grader perms? **Yes, during migration stage**, so behavior parity holds. Removed only when scoped roles are live and shadow mode shows parity.
3. Can Admin be scoped to organization/school later? **Yes** — the model supports `organization` scope today and `school` later (deferred, see Scope Model).
4. SuperAdmin now or deferred? **Deferred (Phase 4 platformization).** Phase 3 ships `Admin` (organization scope) only; `AGENTS.md` forbids exposing SuperAdmin now.
5. Last-admin guard survival? **Retained.** `user.ts:189-201` calls `countActiveByRole(ctx, "Admin")`; RBAC-M6/M7 must keep an equivalent guard over `user_role_assignments` (count actors with an active Admin-scope assignment). See Admin Compatibility Policy §9.
6. Admin-only routes remain behavior-compatible? **Yes** — that is the entire purpose of the compatibility superset + shadow mode (§Shadow Permission Mode).

### Teacher

> Required distinction (job §3.2): *Teacher is primarily an exam/course manager. Teacher should not automatically be Grader or Proctor unless explicitly assigned.*

| Capability | Decision | Notes |
| --- | --- | --- |
| Create courses | ⚠️ scoped | Allowed only with a course-creation grant; default scope organization. |
| Manage questions | ✅ (scoped to course) | `question.*` at course scope. |
| Create exams | ✅ | `exam.create`. |
| Publish exams | ⚠️ scoped | `exam.publish` only on exams in courses they own/teach. |
| Close exams | ⚠️ scoped | `exam.close`. |
| Manage enrollments | ⚠️ scoped | `exam.enrollment.manage`. |
| View scores | ⚠️ scoped | `score.all.view` at exam/course scope. |
| Publish results | ⚠️ scoped | `result.publish`. |
| View candidate answers | ❌ by default | Requires explicit `VIEW_CANDIDATE_ANSWER` grant (separate from grading-detail view). |
| Grade answers | ❌ by default | Requires explicit `GRADE_ANSWER` grant — Teacher ≠ Grader. |
| Proctor exams | ❌ by default | Requires explicit proctor grant — Teacher ≠ Proctor. |

| Field | Value |
| --- | --- |
| Purpose | Course/exam authoring & lifecycle manager. |
| Assignable? | Yes — scoped to course/exam. |
| Login allowed? | Yes. |
| Default scope | course. |
| Sensitive permissions | `exam.publish`, `exam.close`, `result.publish`, `score.all.view`. |
| Explicitly forbidden (by default) | `VIEW_CANDIDATE_ANSWER`, `GRADE_ANSWER`, `FORCE_SUBMIT`, `EXTEND_TIME`, `MARK_MISCONDUCT`. |
| Migration notes | New role; no current route is Teacher-gated. First becomes enforceable after scoped assignment UI (Stage 8). |

### Proctor

> Required boundary (job §3.2): *Proctor can operate exam runtime authority. Proctor cannot grade, view candidate answers, or publish results by default.*

| Capability | Decision | Notes |
| --- | --- | --- |
| View exam room status | ✅ | `exam_room.view` (today `VIEW_EXAM_ROOM`). |
| View proctor timeline | ✅ | `attempt.timeline.view`. |
| Mark misconduct | ✅ | `attempt.misconduct.mark` (today `MARK_MISCONDUCT`). |
| Extend time | ✅ | `attempt.time.extend` (today `EXTEND_TIME`). |
| Force submit | ✅ | `attempt.force_submit` (today `FORCE_SUBMIT`). |
| View candidate answers | ❌ | Forbidden by default — distinct from runtime authority. |
| View scores | ❌ | Forbidden by default. |
| Grade | ❌ | Forbidden by default. |
| Edit answers | ❌ | Never (answers are append-only/versioned; no role may mutate). |
| Reopen attempts | ❌ | Forbidden by default (admin-only lifecycle action). |

| Field | Value |
| --- | --- |
| Purpose | Exam-room runtime authority during a live exam. |
| Assignable? | Yes — scoped to exam. |
| Login allowed? | Yes. |
| Default scope | exam. |
| Sensitive permissions | `attempt.force_submit`, `attempt.time.extend`, `attempt.misconduct.mark`. |
| Explicitly forbidden | `VIEW_CANDIDATE_ANSWER`, `GRADE_ANSWER`, `result.publish`, `score.all.view`, `exam.publish`. |
| Migration notes | Today the 4 proctor perms are Admin-gated (`attempts.admin.ts`, `proctorMonitoring.ts`). AUTHZ-S2 reconcile decides whether Admin keeps them (yes, as superset) **and** Proctor gains them by assignment. |

### Grader

> Required distinction (job §3.2): `VIEW_GRADING_DETAIL`, `VIEW_CANDIDATE_ANSWER`, `GRADE_ANSWER`, `FINALIZE_GRADING` **must be modeled separately.**

| Capability | Decision | Notes |
| --- | --- | --- |
| View grading queue | ✅ | `grading.queue.view` (scoped to exam/assignment). |
| View grading detail (question, max score, context) | ✅ | `grading.detail.view` — sensitive read, **audits `grading.detail_viewed`** (missing today, §7.2 of readiness audit). |
| View candidate answer payload | ✅ | `grading.answer.view` — the most privacy-sensitive field; separate so a result-viewer/double-blind grader can be denied it. |
| Write manual score | ✅ | `grading.score.write` (today conflated under `requireRole(["Admin"])` → `grade-question`). |
| Finalize grading | ⚠️ | `grading.finalize` — separate capability; not all graders finalize. |
| Publish result | ❌ by default | `result.publish` — Grader cannot publish; that is Teacher/Admin. |
| See candidate identity | ❌ by default | `grading.identity.view` — separate capability for double-blind grading (Phase 3+; modeled now, enforced later). |
| See other graders' scores | ❌ by default | separate capability. |
| Double-blind grading later? | Yes — the split above *is* the prerequisite. | |
| Scope: exam / attempt / question / grading task? | **exam** for queue; **attempt** for detail/grade. `grading_task` scope deferred. | |

| Field | Value |
| --- | --- |
| Purpose | Manual scoring of subjective questions. |
| Assignable? | Yes — scoped to exam (queue) / attempt (grade). |
| Login allowed? | Yes. |
| Default scope | exam (queue), attempt (grade). |
| Sensitive permissions | `grading.detail.view`, `grading.answer.view`, `grading.score.write`, `grading.finalize`. |
| Explicitly forbidden | `result.publish`, `exam.publish`, `attempt.force_submit`, `exam.create`. |
| Migration notes | Today grading routes are `requireRole(["Admin"])` (`gradingQueue.ts:48,113,200`). Splitting into 4 capabilities is the core Phase 3 grading change. |

### Candidate

> Required boundary (job §3.2): *Permission determines whether the actor may perform an action. Runtime state determines whether the attempt is currently in a legal phase.* (Also the cross-cutting invariant above and readiness §10.)

| Capability | Decision | Notes |
| --- | --- | --- |
| Always own-scope only? | **Yes.** Every Candidate capability is scoped to `own_attempt` or `own_score`. |
| Resolve own attempt? | resolver `resolveOwnAttempt(attemptId)` = `attempt.candidateId === actor.candidateProfile.id`. Today enforced ad-hoc in handler (`scores.ts:80`) + candidateProfile match. |
| Resolve own score? | same ownership chain. |
| View unpublished result? | ❌ | Gated by result-publication policy (`ResultPublicationMode`, `enums.ts:115-121`) **+** `score.own.view`. Permission AND state. |
| Restore disrupted attempt? | ✅ | `attempt.restore` — own scope, allowed only from `disrupted` status (state guard). |
| Submit after deadline? | ❌ (state) | Permission `attempt.submit` grants the *capability*; the deadline is a **state guard** (`ConflictReason.DeadlineExceeded`, `enums.ts:232`). This is exactly the RBAC≠state-machine invariant. |
| Permission vs runtime-state decisions | See invariant: permission = may; state = legal-now. | |

| Field | Value |
| --- | --- |
| Purpose | The examinee identity; takes assigned exams. |
| Assignable? | Yes — implicit on candidate creation (`candidate.create` assigns Candidate role). |
| Login allowed? | Yes. |
| Default scope | own_attempt / own_score. |
| Permission groups | candidate runtime (`exam.take`, `attempt.start`, `attempt.answer.save`, `attempt.submit`, `attempt.restore`, `attempt.heartbeat.send`, `score.own.view`). |
| Sensitive permissions | none (all own-scope, low blast radius). |
| Explicitly forbidden | every non-own capability; any write to another actor's attempt. |
| Migration notes | Today `requireRole(["Candidate"])` + ad-hoc ownership. Migration adds `own_attempt`/`own_score` scope resolvers. |

### System Actor

> Required boundary (job §3.2, §12): *System actor is not a human role. It is not assignable. It is not login-capable. It should not be represented as Admin.*

| Field | Value |
| --- | --- |
| Purpose | Non-human background work: deadline auto-submit, heartbeat disrupted-scan, lifecycle reconciliation. |
| Assignable? | **No.** |
| Login allowed? | **No.** |
| Default scope | system (cross-cutting; operates on attempts). |
| Permission groups | `system.auto_submit`, `system.heartbeat_scan`, `system.lifecycle_reconcile`, `system.background_job.run`. |
| Sensitive permissions | all of them (they mutate attempts without a human in the loop). |
| Explicitly forbidden | login, appearance in user-management UI, any human-facing capability. |
| Migration notes | **Today scanners synthesize `role: "Admin"` contexts** (`deadlineScanner.ts:97`, `heartbeat.ts:103`) with synthetic `actorId` (`system:heartbeat`, `system:deadline-scanner`). RBAC-M.../SYSTEM-M1 replaces these with a real `System` role + system-only perms so audit logs stop mislabeling system work as Admin. |

**Decisions (job §12):**
1. Is System a DB user? **No** — a synthetic actor identity, not a row in `users`.
2. Synthetic actor ID? **Yes** — stable IDs like `system:heartbeat` (already used).
3. Role assignments? **Implicit** — the System role is bound to the synthetic actor identity at code level, not via `user_role_assignments`.
4. Uses permissions? **Yes** — system-only perms, to keep the capability model uniform.
5. Operations? auto-submit, disrupted-scan, lifecycle reconcile, background-job run.
6. Audit representation? `audit_logs.actorId = "system:..."` (already so for `attempt.autoSubmit`/`attempt.disrupted`, readiness §7.1) — **not** `Admin`.
7. Replace hardcoded Admin role in scanners? **Yes** — SYSTEM-M1.
8. Visible in UI? **No.**

---

## Permission Catalog v0

> Naming convention: `domain.resource.action` (dotted, lowercase). This supersedes the current `SCREAMING_SNAKE` keys (`enums.ts:15-47`) — the catalog maps each new dotted key to its legacy constant for migration. Permissions are stable constants; unknown strings are a load-time error (Formal Model §5–6).

### 4.1 User / Organization

| Permission | Domain | Action | Sensitive? | Default Roles | Required Scope | Audit Required? | Notes |
| --- | --- | --- | :---: | --- | --- | :---: | --- |
| `user.view` | user | view | yes | Admin | organization | read-opt | list/detail |
| `user.create` | user | create | yes | Admin | organization | yes (`user.create`) | |
| `user.update` | user | update | yes | Admin | organization | yes (`user.update`) | |
| `user.delete` | user | delete | yes | Admin | organization | yes (`user.delete`) | last-admin guard |
| `user.role.assign` | user | role.assign | **yes** | Admin | organization | **yes (`user.role_changed` — missing, §7.2)** | privilege change |
| `user.password.reset` | user | password.reset | yes | Admin | organization | yes (`candidate.password_reset`) | candidate-only target today |
| `organization.view` | organization | view | no | Admin, Teacher | organization | read-opt | |
| `organization.update` | organization | update | yes | Admin | organization | yes (`branding.update`) | supersedes dead `MANAGE_ORGANIZATION` |
| `settings.view` | settings | view | no | Admin | organization | read-opt | |
| `settings.update` | settings | update | yes | Admin | organization | yes (`branding.update`) | |
| `audit_log.view` | audit | view | yes | Admin | organization | read-opt (`audit_log.viewed` opt) | new |

### 4.2 Candidate Management

| Permission | Domain | Action | Sensitive? | Default Roles | Required Scope | Audit Required? | Notes |
| --- | --- | --- | :---: | --- | --- | :---: | --- |
| `candidate.view` | candidate | view | yes | Admin, Teacher | organization/course | read-opt | |
| `candidate.create` | candidate | create | yes | Admin | organization | yes (`candidate.create`) | |
| `candidate.update` | candidate | update | yes | Admin | organization | yes (`candidate.update`) | |
| `candidate.import` | candidate | import | yes | Admin | organization | yes (`candidate.import`) | |
| `candidate.delete` | candidate | delete | yes | Admin | organization | yes | |
| `candidate_field.view` | candidate_field | view | no | Admin | organization | read-opt | |
| `candidate_field.create` | candidate_field | create | yes | Admin | organization | yes (`candidate_field.create`) | |
| `candidate_field.update` | candidate_field | update | yes | Admin | organization | yes (`candidate_field.update`) | |
| `candidate_field.delete` | candidate_field | delete | yes | Admin | organization | yes (`candidate_field.delete`) | |

### 4.3 Course / Question

| Permission | Domain | Action | Sensitive? | Default Roles | Required Scope | Audit Required? | Notes |
| --- | --- | --- | :---: | --- | --- | :---: | --- |
| `course.view` | course | view | no | Admin, Teacher | organization/course | read-opt | |
| `course.create` | course | create | no | Admin, Teacher | organization | yes (`course.create`) | |
| `course.update` | course | update | no | Admin, Teacher | course | yes (`course.update`) | |
| `course.delete` | course | delete | yes | Admin | course | yes (`course.delete`) | |
| `question.view` | question | view | no | Admin, Teacher | organization/course | read-opt | |
| `question.create` | question | create | no | Admin, Teacher | course | yes (`question.create`) | |
| `question.update` | question | update | no | Admin, Teacher | course | yes (`question.update`) | |
| `question.delete` | question | delete | yes | Admin, Teacher | course | yes (`question.delete`) | |
| `question.import` | question | import | yes | Admin, Teacher | course | yes (`question.import`) | |

### 4.4 Exam Lifecycle

| Permission | Domain | Action | Sensitive? | Default Roles | Required Scope | Audit Required? | Notes |
| --- | --- | --- | :---: | --- | --- | :---: | --- |
| `exam.view` | exam | view | no | Admin, Teacher | organization/exam | read-opt | |
| `exam.create` | exam | create | no | Admin, Teacher | course | yes (`exam.create`) | |
| `exam.update` | exam | update | no | Admin, Teacher | exam | yes (`exam.update`) | only in `draft` |
| `exam.publish` | exam | publish | yes | Admin, Teacher | exam | yes (`exam.publish`) | state guard |
| `exam.unpublish` | exam | unpublish | yes | Admin | exam | yes (`exam.unpublish`) | |
| `exam.close` | exam | close | yes | Admin, Teacher | exam | yes (`exam.close`) | state guard |
| `exam.cancel` | exam | cancel | yes | Admin | exam | yes (`exam.cancel`) | abnormal |
| `exam.archive` | exam | archive | yes | Admin | exam | yes (`exam.archive`) | terminal-ish |
| `exam.delete` | exam | delete | yes | Admin | exam | yes (`exam.delete`) | |
| `exam.extend` | exam | extend | yes | Admin | exam | yes (`exam.extend`) | exam-level window extend |
| `exam.result.publish` | exam | result.publish | **yes** | Admin, Teacher | exam | yes (`exam.publish_results`) | state: grading complete |
| `exam.enrollment.manage` | exam | enrollment.manage | yes | Admin, Teacher | exam | yes (`enrollment.add/remove`) | |

### 4.5 Candidate Runtime

| Permission | Domain | Action | Sensitive? | Default Roles | Required Scope | Audit Required? | Notes |
| --- | --- | --- | :---: | --- | --- | :---: | --- |
| `exam.take` | exam | take | no | Candidate | own_attempt | yes (`attempt.start`) | entry to runtime |
| `attempt.view_own` | attempt | view_own | no | Candidate | own_attempt | read-opt | |
| `attempt.start` | attempt | start | no | Candidate | own_attempt | yes (`attempt.start`) | state: not_started/queued |
| `attempt.answer.save` | attempt | answer.save | no | Candidate | own_attempt | yes (`attempt.saveAnswer`) | Answer Protocol |
| `attempt.submit` | attempt | submit | no | Candidate | own_attempt | yes (`attempt.submit`) | state guard + deadline |
| `attempt.restore` | attempt | restore | no | Candidate | own_attempt | yes (`attempt.restore`) | state: disrupted |
| `attempt.heartbeat.send` | attempt | heartbeat.send | no | Candidate | own_attempt | no | hot path |
| `score.own.view` | score | own.view | no | Candidate | own_score | read-opt | + publication policy |

### 4.6 Proctor Runtime

| Permission | Domain | Action | Sensitive? | Default Roles | Required Scope | Audit Required? | Notes |
| --- | --- | --- | :---: | --- | --- | :---: | --- |
| `exam_room.view` | exam_room | view | yes | Admin (compat), Proctor | exam | read-opt | ⚠️ legacy `VIEW_EXAM_ROOM` trap |
| `attempt.status.view` | attempt | status.view | yes | Admin (compat), Proctor | exam | read-opt | |
| `attempt.timeline.view` | attempt | timeline.view | yes | Admin (compat), Proctor | attempt | read-opt | merged audit+client_events projection |
| `attempt.misconduct.mark` | attempt | misconduct.mark | **yes** | Admin (compat), Proctor | attempt | yes (`attempt.misconductFlagged`) | ⚠️ legacy `MARK_MISCONDUCT` |
| `attempt.time.extend` | attempt | time.extend | **yes** | Admin (compat), Proctor | attempt | yes (`attempt.extendTime`) | ⚠️ legacy `EXTEND_TIME`; per-attempt |
| `attempt.force_submit` | attempt | force_submit | **yes** | Admin (compat), Proctor | attempt | yes (`attempt.forceSubmit`) | ⚠️ legacy `FORCE_SUBMIT`; state guard |
| `attempt.export` | attempt | export | yes | Admin | attempt | yes (`attempt.exported`) | single-attempt answer export |

### 4.7 Grading

| Permission | Domain | Action | Sensitive? | Default Roles | Required Scope | Audit Required? | Notes |
| --- | --- | --- | :---: | --- | --- | :---: | --- |
| `grading.queue.view` | grading | queue.view | yes | Admin, Grader | exam | read-opt | candidate identity visible |
| `grading.detail.view` | grading | detail.view | **yes** | Admin, Grader | attempt | **yes (`grading.detail_viewed` — missing, §7.2)** | sensitive read |
| `grading.answer.view` | grading | answer.view | **yes** | Admin, Grader | attempt | yes | candidate answer payload |
| `grading.score.write` | grading | score.write | yes | Admin, Grader | attempt | yes (`grading.score_entered`) | manual score |
| `grading.finalize` | grading | finalize | yes | Admin | attempt | yes (`grading.finalized`) | |
| `grading.identity.view` | grading | identity.view | **yes** | Admin | attempt | yes | candidate identity; double-blind denies |

### 4.8 Scores / Results

| Permission | Domain | Action | Sensitive? | Default Roles | Required Scope | Audit Required? | Notes |
| --- | --- | --- | :---: | --- | --- | :---: | --- |
| `score.all.view` | score | all.view | yes | Admin, Teacher | exam/course | read-opt | |
| `score.export` | score | export | yes | Admin | organization/exam | yes (`export_scores`) | |
| `result.publish` | result | publish | **yes** | Admin, Teacher | exam | yes (`exam.publish_results`) | alias of `exam.result.publish` |

### 4.9 System / Diagnostics

| Permission | Domain | Action | Sensitive? | Default Roles | Required Scope | Audit Required? | Notes |
| --- | --- | --- | :---: | --- | --- | :---: | --- |
| `system.health.view` | system | health.view | no | Admin | system | read-opt | `/system/health` |
| `system.diagnostics.view` | system | diagnostics.view | yes | Admin | system | read-opt | `/system/diagnostics` |
| `system.info.view` | system | info.view | no | *(public)* | system | no | `/system/info` |
| `system.auto_submit` | system | auto_submit | **yes** | **System only** | attempt | yes (`attempt.autoSubmit`) | SYS |
| `system.heartbeat_scan` | system | heartbeat_scan | **yes** | **System only** | attempt | yes (`attempt.disrupted`) | SYS |
| `system.lifecycle_reconcile` | system | lifecycle_reconcile | yes | **System only** | exam | yes (`exam.<transition>`) | SYS |

> Symbols used in matrices: ✅ allowed by default · ⚠️ allowed only with explicit scoped assignment · ❌ not allowed · **SYS** system-only · **OWN** own-resource only.

---

## Scope Model v0

> Start from the candidate enum (job §5). Decisions below.

| Scope | Meaning | Example Resource | Resolver Needed? | Phase 3 Required? | Notes |
| --- | --- | --- | :---: | :---: | --- |
| `system` | infra / diagnostics / cross-cutting system work | `/system/health`, scanner targets | no | yes | role-gated today; System actor operates here |
| `organization` | tenant-wide (the internal default org) | users, candidates, courses, settings, audit-logs | no | yes | current default; single-tenant (`AGENTS.md`) |
| `school` | a sub-org unit | future school-scoped admin | yes | **no (deferred)** | no `school` table exists; deferred to multi-unit Phase 4 |
| `course` | within a course | questions, course-scoped exams | yes (course membership) | yes (Teacher) | needed for Teacher scoping |
| `exam` | within an exam | proctor monitoring, scores list, result publish | yes (exam→org + assignment) | yes | needed for Proctor/Teacher/Grader |
| `attempt` | a single attempt | extend-time, misconduct, force-submit, grading detail | yes (attempt→exam→org) | yes | needed for Grader/Proctor |
| `question` | a single question | (future) question-level edit lock | yes (question→course) | **resource only** | treated as a resource, not an enforced scope, in Phase 3 |
| `candidate` | a candidate's data | candidate profile | yes (candidate→org) | yes | |
| `own_attempt` | the actor's own attempt | start/save/submit/heartbeat | yes (attempt.candidateId === actor.candidateProfile.id) | yes | today enforced ad-hoc in handler (`scores.ts:80`) |
| `own_score` | the actor's own result | `GET /scores/attempts/:attemptId` (candidate branch) | yes (same as own_attempt) | yes | today `ctx.role !== "Candidate"` + ownership |
| `grading_task` | a grading assignment unit | (future) per-grader task | yes | **no (deferred)** | not needed until double-blind / per-task assignment |

**Required decisions (job §5.1–5.10):**
1. Is `school` required in Phase 3? **No** — no `school` table; deferred (`AGENTS.md` single-tenant).
2. Is `organization` enough for current deployment? **Yes** — single internal default org.
3. Is `tenant` a separate scope or deferred? **Deferred** — `organization` is the Phase 3 boundary; `tenant` is Phase 4 multiTenant (`AGENTS.md`).
4. Is `question` a scope or only a resource? **Resource only** in Phase 3 (no question-level scope enforcement yet); modeled so it can become a scope later.
5. Is `grading_task` needed now? **No** — deferred until per-task/double-blind grading.
6. Are `own_attempt`/`own_score` real scopes or special resolvers? **Real scopes with dedicated resolvers** (`resolveOwnAttempt`, `resolveOwnScore`) — they are first-class because Candidate is always own-scope-only.
7. Should `system` scope exist? **Yes** — for diagnostics and System actor work.
8. Which scopes require DB resolvers? `course`, `exam`, `attempt`, `candidate`, `own_attempt`, `own_score` (all need ownership-chain reads).
9. Which scopes resolve from JWT/session context? `system`, `organization` (already in `RequestContext.organizationId`, `types.ts:456-463`).
10. Which scopes are not yet enforceable without schema change? `school`, `grading_task` (no tables); `course`/`exam`/`attempt` are enforceable today from existing FKs but need resolver wiring.

> **Required invariant:** PostgreSQL is the source of truth for resource ownership. Redis must not decide authorization (re-verified: Redis is not in any authz path — `audit-current-redis.md` §1.2, readiness §9).

---

## Resource Resolver Matrix

> Minimum resources (job §6). Parent chains reflect current FKs in `packages/db/src/schema/pg.ts`.

| Resource | Parent Chain | Resolver Function | Required For Permission | Can Be Cached? | Source of Truth |
| --- | --- | --- | --- | :---: | --- |
| `user` | → organization | `resolveUserScope` | `user.*` | request-local | `users.organizationId` |
| `candidate` | → organization | `resolveCandidateScope` | `candidate.*` | request-local | candidate profile org |
| `course` | → organization | `resolveCourseScope` | `course.*`, `question.*` | request-local | `courses.organizationId` |
| `question` | → course → organization | `resolveQuestionScope` | `question.*` | request-local | question→course FK |
| `exam` | → course → organization | `resolveExamScope` | `exam.*`, proctor, scores, result | request-local | `exams.courseId` → org |
| `enrollment` | → exam → course → organization | `resolveEnrollmentScope` | `exam.enrollment.manage` | request-local | enrollment→exam FK |
| `attempt` | → exam → course → organization | `resolveAttemptScope` | attempt admin/proctor, grading | request-local | `attempts.examId` |
| `answer` | → attempt → exam → course → organization | `resolveAnswerScope` | `grading.answer.view` | request-local | `attempt.answers` JSONB on attempt |
| `grading_entry` | → attempt → exam → ... | `resolveGradingScope` | `grading.score.write` | request-local | manual_grading_entries→attempt FK |
| `score` | → attempt → candidate + exam | `resolveScoreScope` | `score.own.view`/`score.all.view` | request-local | attempt ownership |
| `audit_log` | → organization | `resolveAuditLogScope` | `audit_log.view` | none | org-scoped rows |
| `client_event` | → organization | `resolveClientEventScope` | (telemetry ingest) | none | org-scoped rows |
| `system_diagnostics` | (none) | `resolveSystemScope` | `system.*` | none | n/a |

Example chains (job §6):
```
attempt -> exam -> course -> organization
answer  -> attempt -> exam -> course -> organization
question -> course -> organization
candidate -> organization
score -> attempt -> candidate + exam
```

**Confused-deputy / re-parenting handling** — see §22.1 (Resource Parent Integrity Matrix). Every sensitive resolver validates the full ownership chain and denies on inconsistency.

---

## Role → Permission Matrix

> Symbols: ✅ allowed by default · ⚠️ allowed only with explicit scoped assignment · ❌ not allowed · **SYS** system-only · **OWN** own-resource only.

| Permission | Admin | Teacher | Proctor | Grader | Candidate | System | Scope | Sensitive? |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | --- | :---: |
| `user.view` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | organization | yes |
| `user.create` / `update` / `delete` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | organization | yes |
| `user.role.assign` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | organization | **yes** |
| `user.password.reset` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | organization | yes |
| `organization.update` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | organization | yes |
| `settings.update` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | organization | yes |
| `audit_log.view` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | organization | yes |
| `candidate.view` | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | org/course | yes |
| `candidate.create` / `update` / `import` / `delete` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | organization | yes |
| `candidate_field.*` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | organization | yes |
| `course.view` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | org/course | no |
| `course.create` | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | organization | no |
| `course.update` / `delete` | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | course | yes(delete) |
| `question.*` | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | course | no |
| `exam.view` | ✅ | ✅ | ⚠️ | ❌ | ❌ | ❌ | org/exam | no |
| `exam.create` | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | course | no |
| `exam.update` | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | exam | no |
| `exam.publish` / `close` | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | exam | yes |
| `exam.cancel` / `archive` / `delete` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | exam | yes |
| `exam.extend` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | exam | yes |
| `exam.result.publish` | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | exam | **yes** |
| `exam.enrollment.manage` | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | exam | yes |
| `exam.take` | ❌ | ❌ | ❌ | ❌ | ✅ OWN | ❌ | own_attempt | no |
| `attempt.start` | ❌ | ❌ | ❌ | ❌ | ✅ OWN | ❌ | own_attempt | no |
| `attempt.answer.save` | ❌ | ❌ | ❌ | ❌ | ✅ OWN | ❌ | own_attempt | no |
| `attempt.submit` | ❌ | ❌ | ❌ | ❌ | ✅ OWN | ❌ | own_attempt | no |
| `attempt.restore` | ❌ | ❌ | ❌ | ❌ | ✅ OWN | ❌ | own_attempt | no |
| `attempt.heartbeat.send` | ❌ | ❌ | ❌ | ❌ | ✅ OWN | ❌ | own_attempt | no |
| `score.own.view` | ❌ | ❌ | ❌ | ❌ | ✅ OWN | ❌ | own_score | no |
| `exam_room.view` | ✅ (compat) | ❌ | ✅ | ❌ | ❌ | ❌ | exam | yes |
| `attempt.status.view` | ✅ (compat) | ❌ | ✅ | ❌ | ❌ | ❌ | exam | yes |
| `attempt.timeline.view` | ✅ (compat) | ❌ | ✅ | ❌ | ❌ | ❌ | attempt | yes |
| `attempt.misconduct.mark` | ✅ (compat) | ❌ | ✅ | ❌ | ❌ | ❌ | attempt | **yes** |
| `attempt.time.extend` | ✅ (compat) | ❌ | ✅ | ❌ | ❌ | ❌ | attempt | **yes** |
| `attempt.force_submit` | ✅ (compat) | ❌ | ✅ | ❌ | ❌ | ❌ | attempt | **yes** |
| `attempt.export` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | attempt | yes |
| `grading.queue.view` | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | exam | yes |
| `grading.detail.view` | ✅ (compat) | ❌ | ❌ | ✅ | ❌ | ❌ | attempt | **yes** |
| `grading.answer.view` | ✅ (compat) | ❌ | ❌ | ✅ | ❌ | ❌ | attempt | **yes** |
| `grading.score.write` | ✅ (compat) | ❌ | ❌ | ✅ | ❌ | ❌ | attempt | yes |
| `grading.finalize` | ✅ | ❌ | ❌ | ⚠️ | ❌ | ❌ | attempt | yes |
| `grading.identity.view` | ✅ | ❌ | ❌ | ⚠️ | ❌ | ❌ | attempt | **yes** |
| `score.all.view` | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | exam/course | yes |
| `score.export` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | org/exam | yes |
| `system.health.view` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | system | no |
| `system.diagnostics.view` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | system | yes |
| `system.auto_submit` | ❌ | ❌ | ❌ | ❌ | ❌ | **SYS** | attempt | **yes** |
| `system.heartbeat_scan` | ❌ | ❌ | ❌ | ❌ | ❌ | **SYS** | attempt | **yes** |
| `system.lifecycle_reconcile` | ❌ | ❌ | ❌ | ❌ | ❌ | **SYS** | exam | yes |

**Boundary checks (job §7):**
1. ✅ Admin is a compatibility superset (every Admin-gated route's permission is ✅ or ✅(compat)).
2. ✅ Teacher does not automatically view candidate answers (`grading.answer.view` = ❌ for Teacher by default).
3. ✅ Teacher does not automatically grade (`grading.score.write` = ❌ for Teacher by default).
4. ✅ Proctor cannot view candidate answers (`grading.answer.view` = ❌ for Proctor).
5. ✅ Proctor cannot grade (`grading.score.write` = ❌ for Proctor).
6. ✅ Grader can grade but cannot publish results by default (`exam.result.publish` = ❌ for Grader).
7. ✅ Candidate can only access own attempt / own score (every Candidate perm is OWN-scoped).
8. ✅ System actor is not assignable (SYS-only perms; no human role holds them).

---

## Route → Permission → Scope → Audit Registry

> **Draft shape (job §8).** Not implemented. Registry entry (job §8 + readiness §6):

```ts
type RoutePermissionRegistryEntry = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  currentGate: string;                 // e.g. 'requireRole(["Admin"])'
  permission: PermissionKey;           // §Permission Catalog
  resource: {
    type: ResourceType;
    idSource: "params" | "body" | "query" | "ctx" | "none";
    idKey?: string;
  };
  scope: ScopeType;                    // §Scope Model
  resolver: ResolverKey;              // §Resource Resolver Matrix
  auditAction?: AuditActionKey;        // §Audit Boundary
  sensitive: boolean;
  migrationStage: number;              // §Migration Plan
};
```

> Verified live for this ADR — current gates from `rg requireRole` over `apps/api/src/routes` (§Evidence Appendix). ⚠️ = trap permission; must reconcile RBAC (AUTHZ-S2) before enforcement.

### Registry draft (minimum entries)

| Route Family | Current Gate | Future Permission | Resource | Scope | AuditAction | Sensitive? |
| --- | --- | --- | --- | --- | --- | :---: |
| auth | `POST /auth/login` *(public)* | *(public)* | none | system | `login.success`/`login.failure` | yes |
| auth | `POST /auth/logout` *(auth)* | *(authenticated)* | none | system | `logout` | no |
| auth | `PATCH /auth/me/profile` *(auth)* | *(self)* | user(ctx) | candidate | `auth.profile_update` | no |
| users | `GET/POST /admin/users` `requireRole(["Admin"])` | `user.view`/`user.create` | user | organization | `user.create` | yes |
| users | `PATCH/DELETE /admin/users/:id` `requireRole(["Admin"])` | `user.update`/`user.delete` | user(params.id) | organization | `user.update`/`user.delete` | yes |
| users | reset-password `requireRole(["Admin"])` | `user.password.reset` | user(params.id) | organization | `candidate.password_reset` | yes |
| candidates | `/admin/candidates` CRUD `requireRole(["Admin"])` | `candidate.*` | candidate | organization | `candidate.*` | yes |
| candidate fields | `/admin/candidate-fields` CRUD `requireRole(["Admin"])` | `candidate_field.*` | candidate_field | organization | `candidate_field.*` | yes |
| courses | `/admin/courses` CRUD `requireRole(["Admin"])` | `course.*` | course | organization/course | `course.*` | no |
| questions | `/admin/questions` CRUD+import `requireRole(["Admin"])` | `question.*` | question | organization(course) | `question.*` | no |
| exams | `/admin/exams` create/update `requireRole(["Admin"])` | `exam.create`/`exam.update` | exam | organization(exam) | `exam.create`/`exam.update` | no |
| exams | `POST /admin/exams/:id/publish` `requireRole(["Admin"])` | `exam.publish` | exam(params.id) | exam | `exam.publish` | no |
| exams | `POST /admin/exams/:id/publish-results` `requireRole(["Admin"])` | `exam.result.publish` | exam(params.id) | exam | `exam.publish_results` | **yes** |
| exams | enrollments `requireRole(["Admin"])` | `exam.enrollment.manage` | exam(params.id) | exam | `enrollment.add/remove` | no |
| attempt (candidate) | `POST /attempts/:attemptId/start` `requireRole(["Candidate"])` | `attempt.start` | attempt(params.id) | own_attempt | `attempt.start` | no |
| attempt (candidate) | `POST /attempts/:attemptId/answers/:qid` `requireRole(["Candidate"])` | `attempt.answer.save` | attempt(params.id) | own_attempt | `attempt.saveAnswer` | no |
| attempt (candidate) | `POST /attempts/:attemptId/submit` `requireRole(["Candidate"])` | `attempt.submit` | attempt(params.id) | own_attempt | `attempt.submit` | no |
| attempt (candidate) | heartbeat `requireRole(["Candidate"])` | `attempt.heartbeat.send` | attempt(params.id) | own_attempt | *(none)* | no |
| attempt (admin/proctor) | `POST /admin/attempts/:attemptId/misconduct` `requireRole(["Admin"])` | `attempt.misconduct.mark` ⚠️ | attempt(params.id) | attempt | `attempt.misconductFlagged` | **yes** |
| attempt (admin/proctor) | `POST /admin/attempts/:attemptId/force-submit` `requireRole(["Admin"])` | `attempt.force_submit` ⚠️ | attempt(params.id) | attempt | `attempt.forceSubmit` | **yes** |
| attempt (admin/proctor) | `POST /admin/attempts/:attemptId/extend-time` `requireRole(["Admin"])` | `attempt.time.extend` ⚠️ | attempt(params.id) | attempt | `attempt.extendTime` | **yes** |
| attempt (admin/proctor) | timeline `requireRole(["Admin"])` | `attempt.timeline.view` ⚠️ | attempt(params.id) | attempt | read-opt | yes |
| attempt (admin/proctor) | single-attempt export `requireRole(["Admin"])` | `attempt.export` | attempt(params.id) | attempt | `attempt.exported` | yes |
| grading | `GET /admin/grading-queue` `requireRole(["Admin"])` | `grading.queue.view` | exam(query) | exam | read-opt | yes |
| grading | `GET /admin/attempts/:attemptId/grading-details` `requireRole(["Admin"])` | `grading.detail.view` **+** `grading.answer.view` | attempt(params.id) | attempt | **`grading.detail_viewed` (missing)** | **yes** |
| grading | `POST /admin/attempts/:attemptId/grade-question` `requireRole(["Admin"])` | `grading.score.write` | attempt(params.id) | attempt | `grading.score_entered` | yes |
| scores | `GET /admin/exams/:examId/scores` `requireRole(["Admin"])` | `score.all.view` | exam(params.examId) | exam | read-opt | yes |
| scores | `GET /scores/attempts/:attemptId` `requireRole(["Candidate","Admin"])` | `score.own.view` **OR** `score.all.view` | attempt(params.id) | own_score/attempt | *(none today)* | no |
| exports | `GET /admin/exports/scores` `requireRole(["Admin"])` | `score.export` | exam(query) | organization/exam | `export_scores` | yes |
| audit logs | `GET /admin/audit-logs` `requireRole(["Admin"])` | `audit_log.view` | none | organization | read-opt (`audit_log.viewed` opt) | yes |
| settings | `PATCH /admin/settings/branding` `requireRole(["Admin"])` | `settings.update`/`organization.update` | none | organization | `branding.update` | yes |
| system | `/system/health`/`dashboard`/`diagnostics` `requireRole(["Admin"])` | `system.health.view`/`system.diagnostics.view` | none | system | read-opt | no/diag |
| import logs | `GET /admin/import-logs` `requireRole(["Admin"])` | `audit_log.view`*(extend)* | none | organization | read-opt | no |
| client events | `POST /client-events` *(auth)* | *(authenticated)* | none | candidate | n/a (telemetry) | no |
| proctor monitoring | `GET /admin/exams/:id/proctor/attempts` `requireRole(["Admin"])` | `exam_room.view` ⚠️ | exam(params.id) | exam | read-opt | yes |
| proctor monitoring | `GET /admin/attempts/:attemptId/proctor-events` `requireRole(["Admin"])` | `attempt.timeline.view` ⚠️ | attempt(params.id) | attempt | read-opt | yes |

### Special required mappings (job §8)

```
POST /admin/attempts/:attemptId/force-submit
  -> attempt.force_submit
  -> attempt scope (resolveAttemptScope)
  -> attempt.forceSubmit   [state guard: attempt not terminal]

POST /admin/attempts/:attemptId/extend-time
  -> attempt.time.extend
  -> attempt scope (resolveAttemptScope)
  -> attempt.extendTime    [state guard: exam/attempt still open]

POST /admin/attempts/:attemptId/misconduct
  -> attempt.misconduct.mark
  -> attempt scope (resolveAttemptScope)
  -> attempt.misconductFlagged

GET /admin/attempts/:attemptId/grading-details
  -> grading.detail.view + grading.answer.view
  -> attempt scope (resolveAttemptScope)
  -> grading.detail_viewed   [currently MISSING — §7.2]

POST /admin/attempts/:attemptId/grade-question
  -> grading.score.write
  -> attempt/question scope (resolveAttemptScope)
  -> grading.score_entered   [state guard: pending_manual]

GET /scores/attempts/:attemptId
  -> score.own.view OR score.all.view
  -> own_score / attempt scope
```

> **Mechanism note (Context7-verified):** a registry-driven guard maps cleanly onto Fastify's per-route `preHandler` array (the codebase already uses `[fastify.authenticate, fastify.requireRole(...)]`). Fastify also supports an `onRoute` hook that can inject a registry-derived preHandler from route `config` — the recommended non-invasive path for RBAC-M4.

---

## Admin Compatibility Policy

> Required conclusion (job §9): *During Phase 3 migration, Admin is a compatibility superset for all current Admin-gated APIs. Admin must not receive Candidate own-runtime permissions or System-only permissions unless explicitly justified.*

1. Which current Admin routes must remain accessible to Admin? **All of them.** Every `requireRole(["Admin"])` route (62 sites) maps to a permission the Admin preset holds (✅ or ✅(compat) in the matrix).
2. Should Admin initially receive all permissions? **All *current-Admin-behavior* permissions — yes.** Not Candidate-own-runtime, not System-only.
3. How should Admin receive proctor permissions currently not assigned? **Via the compatibility superset grant** (AUTHZ-S2 reconcile). Today `rbac.ts:5-21` omits `VIEW_EXAM_ROOM`/`EXTEND_TIME`/`MARK_MISCONDUCT`/`FORCE_SUBMIT`; the new preset grant adds them so flipping the gate does not deny Admin.
4. Grading permissions? **Yes** (`grading.detail.view`, `grading.answer.view`, `grading.score.write`) — preserves current Admin grading access.
5. System diagnostics? **Yes** (`system.diagnostics.view`) — current `/system/diagnostics` is Admin-gated.
6. Candidate runtime permissions? **No.** Admin must not hold `attempt.start`/`attempt.answer.save`/`attempt.submit`/`attempt.heartbeat.send`/`score.own.view`. (No current Admin route needs them.)
7. System-only permissions? **No.** Admin must not hold `system.auto_submit`/`system.heartbeat_scan`/`system.lifecycle_reconcile`. Scanners migrate to the System actor (SYSTEM-M1).
8. Last-admin guard survival? **Retained.** Today `user.ts:189-201` blocks demoting/disabling the last active Admin via `countActiveByRole(ctx,"Admin")`. RBAC-M6/M7 must implement an equivalent over `user_role_assignments` (count actors holding an active organization-scope Admin assignment) **before** `users.role` is deprecated.
9. Should `users.role = "Admin"` map to an implicit Admin assignment? **Yes, as a backfill** in RBAC-M7: every existing `users.role` row is mirrored into a `user_role_assignments` row at organization scope. `users.role` then becomes a derived cache.
10. When can Admin stop being a superset? **Only after** scoped roles (Teacher/Proctor/Grader) are live, shadow mode shows zero disagreements, and Admin-scoping is introduced (Phase 4 organization/school admin split). Not in Phase 3.

---

## Candidate Own-Scope Policy

> Required boundary (job §3.2 Candidate): *Permission determines whether the actor may perform an action. Runtime state determines whether the attempt is currently in a legal phase.* Reinforces the cross-cutting invariant.

1. Is Candidate always own-scope only? **Yes.** Every Candidate permission is `own_attempt` or `own_score`.
2. How is own attempt resolved? `resolveOwnAttempt(attemptId)` = `attempt.candidateId === ctx.actor → candidateProfile.id`. Today enforced ad-hoc (`scores.ts:80`) + candidateProfile match in `attempts.candidate.ts`.
3. How is own score resolved? same chain via `resolveOwnScore`.
4. Can Candidate view unpublished result? **No.** Capability `score.own.view` AND result-publication policy (`ResultPublicationMode`, `enums.ts:115-121`). Permission ≠ state.
5. Can Candidate restore disrupted attempt? **Yes** — `attempt.restore` from `disrupted` status (state guard).
6. Can Candidate submit after deadline? **No** — `attempt.submit` capability is granted, but the deadline is a **state guard** (`ConflictReason.DeadlineExceeded`). This is the canonical RBAC≠state-machine case.
7. Which decisions are permission decisions? Whether the actor *may* start/save/submit/restore/heartbeat/view-own-score.
8. Which decisions are runtime state decisions? Whether the attempt is *currently* in a legal phase (status, deadline, window). Fenced from AuthZ — this is the RUNTIME-L1 frontier (readiness §10).

> **RBAC does not replace the domain state machine.** RBAC answers *who may request a transition* (e.g. this Candidate may submit). The state machine answers *whether the transition is legal now* (e.g. the attempt is `in_progress` and before the deadline). Both are required.

---

## Grader Visibility Policy

> Required conclusion (readiness §8.2, job §3.2 Grader): `VIEW_GRADING_DETAIL`, `VIEW_CANDIDATE_ANSWER`, `GRADE_ANSWER`, `FINALIZE_GRADING` are separate.

- **Why split:** today all grading routes are `requireRole(["Admin"])` (`gradingQueue.ts:48,113,200`), conflating "see the queue", "see the candidate's literal answer", "enter a score", and "finalize". Splitting enables double-blind grading, result-viewer roles, and least-privilege Grader assignment.
- **`grading.detail.view`** — sensitive read; **must audit `grading.detail_viewed`** (missing today, readiness §7.2; the `GET .../grading-details` handler writes no audit).
- **`grading.answer.view`** — the candidate-answer payload (`candidateAnswer`, populated at `gradingQueue.ts:166-168` from `attempt.answers`) is the most privacy-sensitive field. A future double-blind Grader holds `grading.score.write` but **not** `grading.identity.view` nor necessarily `grading.answer.view` context.
- **`grading.identity.view`** — candidate identity; denied in double-blind mode.
- **Double-blind grading later?** Yes — the split *is* the prerequisite; enforcement is a later Middle Job (GRADING-M1 + double-blind variant).

---

## Proctor Authority Policy

> Required boundary (job §3.2 Proctor): *Proctor can operate exam runtime authority. Proctor cannot grade, view candidate answers, or publish results by default.*

- Proctor holds: `exam_room.view`, `attempt.status.view`, `attempt.timeline.view`, `attempt.misconduct.mark`, `attempt.time.extend`, `attempt.force_submit`.
- Proctor is **denied by default**: `grading.answer.view`, `grading.score.write`, `exam.result.publish`, `score.all.view`.
- Every Proctor authority action is a **runtime state transition** and therefore also requires a state guard (§22.3): e.g. `attempt.force_submit` requires the attempt be non-terminal; `attempt.time.extend` requires the exam/attempt still open. Proctor-M1 enforces both.
- Proctor timeline reads from **both** `audit_logs` and `client_events` as a read-time projection (`proctorMonitoringService.ts`); the two tables are never written together (readiness §7.3).

---

## System Actor Policy

> Required conclusion (job §12): *System actor is not a human role. It is non-login. It should not be represented as Admin.*

- Today scanners synthesize `role: "Admin"` contexts (`deadlineScanner.ts:97`, `heartbeat.ts:103`) with synthetic actorIds (`system:heartbeat`, `system:deadline-scanner`). Audit logs already record `actorId = "system:..."` for `attempt.autoSubmit`/`attempt.disrupted` (readiness §7.1) — but the *role* is mislabeled Admin.
- Phase 3 introduces a real `System` role (non-login, non-assignable, non-UI-visible) bound to synthetic actor identities, holding **only** `system.auto_submit`/`system.heartbeat_scan`/`system.lifecycle_reconcile`/`system.background_job.run`.
- SYSTEM-M1 replaces the hardcoded `role: "Admin"` in scanners with the System role + system-only perms.
- Audit representation: `actorId = "system:..."`, role = `System` — **never** `Admin`.

---

## Audit Boundary

> Required conclusion (job §11, readiness §7): *AuditAction constants should exist before broad permission migration. Sensitive reads like grading detail view need explicit audit. Audit logs and client telemetry remain separate.*

1. Should permission checks write audit logs? **No** — checks are high-frequency; logging every check is noise. Only *state-changing* and *sensitive-read* actions audit.
2. Should denied permission checks write audit logs? **Only for sensitive resources** (grading detail, candidate answer, force-submit attempts) — optional for routine 403s. Decision deferred to AUDIT-M2.
3. Which sensitive reads need audit? `grading.detail.view` (→ `grading.detail_viewed`, missing), candidate-answer export, audit-log read, role/permission change.
4. Should `grading.detail_viewed` be added? **Yes** — readiness §7.2, High priority.
5. Should `user.role.assign` be audited? **Yes** — `user.role_changed` (missing; privilege change has no audit today, `audit-current-role-checks.md` R10).
6. Should permission changes be audited? **Yes**.
7. Should audit action names be constants? **Yes** — AUDIT-M1 introduces a Zod enum / constants module for the ~43 existing actions, validated at the `recordAudit` boundary. **No rename.**
8. Should audit logs remain separate from client events? **Yes.** `audit_logs` = actor-bound compliance; `client_events` = browser-reported telemetry (`pg.ts:452-508`). Never written to the same table.
9. Should monitoring events remain separate from audit logs? **Yes.** Infra events have no actor; they belong in a separate `monitoring_events` surface (readiness §7.3 Option A, decision deferred to EVENT-M1), not in actor-bound `audit_logs`.

> Naming collision guard (readiness §7.1): the job card proposed `attempt.force_submitted` and `grading.score_submitted`, but the live action names are `attempt.forceSubmit` and `grading.score_entered`. **Do not add the proposed duplicates** — reconcile to the existing names. No audit action is renamed in this ADR.

---

## Shadow Permission Mode

> Required conclusion (job §10): *Shadow mode must not change production behavior. It exists to prove permission matrix compatibility before enforcement.*

```ts
shadowRequireCapability(ctx, {
  legacyGate: ["Admin"],
  permission: "attempt.force_submit",
  resource: { type: "attempt", id: attemptId },
});
```

Recorded fields: `route, actorId, role, permissions, resource, legacyAllowed, capabilityAllowed, decision, reason, timestamp` (+ resolver metrics, §22.2).

**Decisions (job §10.1–10.7):**
1. Where logged? Structured `pino` logs + optional `monitoring_events` (not `audit_logs` — no actor action). Aggregated in CI/staging.
2. Should shadow mismatch fail tests? **Yes in dedicated shadow-mode tests** — a mismatch is a matrix bug. Not in the general suite.
3. Should shadow mismatch fail production requests? **No** — shadow never blocks; legacy gate stays authoritative.
4. Which routes first? The 4 proctor-perm traps (`attempts.admin.ts` force-submit/extend-time/misconduct, `proctorMonitoring.ts`) — highest migration risk — then grading detail.
5. How long before enforcement? Until **zero disagreements** across a full CI + staging run including E2E.
6. Leaking sensitive resource info? Log `resource.type` + opaque id hash, never the candidate answer payload.
7. How to test? Synthetic actors with each role preset; assert `legacyAllowed === capabilityAllowed` for every protected route across the role matrix.

---

## Data Model Proposal

> Job §13: propose, do not implement. Compare 4 options.

### Option A — Keep `users.role` only

- **Why insufficient:** it is a toy role-string model. Cannot express scope (course/exam/attempt), cannot split grading capabilities, cannot add Teacher/Proctor/Grader without more string columns, no permission grants. The current "dead parallel AuthZ layer" (readiness §1.2) is exactly this ceiling. **Rejected.**

### Option B — `users.role` + permission mapping

- `users.role` → flat permission list (today's `rbac.ts`), enforced via `requirePermission`.
- **Why better but limited:** still flat — no scope, no resource-aware checks. Cannot do "Teacher may grade attempts in their course". The 4-proctor-perm trap shows the fragility (perms defined but unassigned). **Rejected as the target** (acceptable only as an intermediate during migration).

### Option C — `roles` / `permissions` / `role_permissions` / `user_role_assignments`  ✅ **Recommended**

```
roles            (key PK, label, is_system, description)
permissions      (key PK, domain, action, sensitive, description)
role_permissions (role_key, permission_key)   -- join
user_role_assignments (actor_id, role_key, scope_type, scope_resource_id?, is_active, ...)
```

- Presets seeded as `is_system = true` immutable rows; permissions seeded from the code constants (closed union, load-time check).
- `users.role` becomes a derived compatibility cache (backfilled in RBAC-M7) — kept until all readers migrate, then deprecated.
- Supports scope (`scope_type` + optional `scope_resource_id`) → enables Teacher-by-course, Proctor-by-exam, Grader-by-exam, Candidate own-scope.
- **Why recommended:** formal RBAC now; custom roles later (Phase 4 just adds `is_system = false` rows + UI). Not a toy string model.

Per-table sketch (job §13 format) for the four core tables:

| Table | Purpose | Key Columns | Indexes | Uniqueness | Migration strategy | Compat with `users.role` | Open risks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `roles` | role catalog | `key` PK, `label`, `is_system`, `description` | (is_system) | `key` unique | seed presets from code constants | `users.role` ∈ `roles.key` | naming drift between code union and rows |
| `permissions` | permission catalog | `key` PK, `domain`, `action`, `sensitive`, `description` | (domain) | `key` unique | seed from code constants; load-time check | none | dead perms if not pruned |
| `role_permissions` | grant join | `role_key`, `permission_key` | (role_key), (permission_key) | (role_key, permission_key) unique | seed from preset matrix | `getPermissionsForRole` reads this | matrix drift if seeded manually |
| `user_role_assignments` | actor↔role@scope | `actor_id`, `role_key`, `scope_type`, `scope_resource_id`, `is_active`, `assigned_at`, `assigned_by` | (actor_id), (role_key, scope_type) | (actor_id, role_key, scope_type, scope_resource_id) unique | backfill from `users.role` (RBAC-M7) | replaces last-admin guard target | last-admin guard must move here first |

### Option D — Full custom RBAC platform immediately

- Options C's schema + `role_presets`/`permission_groups`/`custom_roles`/`scope_bindings` + a custom-role management UI.
- **Why deferred:** the backend model (Option C) *supports* custom roles; the Admin Console UI for creating/assigning them is Phase 4 platformization (`AGENTS.md`). Building the UI now adds risk without Phase 3 value. **Backend now, UI later.**

> **Required conclusion (job §13):** the recommended model supports formal RBAC now and custom roles later. Do not build only role-string gates.

---

## Migration Plan

> Staged (job §14). Each stage: Goal / Non-goals / Inputs / Outputs / Acceptance / Rollback / Tests.

### Stage 0 — Audit Baseline
- **Goal:** fact base. **Non-goals:** any change. **Inputs:** the 7 Phase 3 audits. **Outputs:** this ADR + readiness audit. **Acceptance:** ADR exists, evidence-backed. **Rollback:** n/a (docs). **Tests:** none.

### Stage 1 — Permission Catalog Constants
- **Goal:** introduce `Permission`/`Scope`/`AuditAction` constants (dotted keys mapped to legacy). **Non-goals:** enforcement, route change. **Outputs:** new `packages/authz` constants. **Acceptance:** `pnpm verify` passes; constants compile; mapping table present. **Rollback:** delete the package. **Tests:** unit tests assert the closed union + legacy mapping.

### Stage 2 — Role Preset Matrix
- **Goal:** define Admin/Teacher/Proctor/Grader/Candidate/System presets as data. **Non-goals:** enforcement. **Outputs:** preset grant table (mirrors §Role→Permission Matrix). **Acceptance:** matrix compiles; every legacy perm mapped. **Rollback:** revert. **Tests:** matrix coverage test.

### Stage 3 — Scope Resolver Interfaces
- **Goal:** define resolver *interfaces* + ownership-chain validation rules (§22.1). **Non-goals:** route enforcement. **Outputs:** resolver signatures + integrity rules. **Acceptance:** types compile. **Rollback:** revert. **Tests:** interface conformance stubs.

### Stage 4 — Route Permission Registry
- **Goal:** declarative `route→permission→scope→audit` registry + coverage test. **Non-goals:** enforcement. **Outputs:** registry; coverage test (every `requireRole` route has an entry). **Acceptance:** coverage test green. **Rollback:** revert. **Tests:** coverage test.

### Stage 5 — Shadow Permission Mode
- **Goal:** run legacy `requireRole` + new `requireCapability` side-by-side; log disagreements + resolver metrics. **Non-goals:** behavior change. **Outputs:** `shadowRequireCapability` + metrics. **Acceptance:** zero disagreements in CI/staging. **Rollback:** disable shadow. **Tests:** shadow parity tests per role.

### Stage 6 — Enforce Low-Risk Admin Routes
- **Goal:** flip organization-scope Admin routes (users, candidates, courses, questions, exams lifecycle, settings, audit-log, system, exports) to `requireCapability`. **Non-goals:** sensitive routes. **Inputs:** shadow parity. **Acceptance:** Admin still passes; others still 403. **Rollback:** revert to `requireRole`. **Tests:** role-matrix route tests.

### Stage 7 — Enforce Sensitive Routes
- **Goal:** enforce proctor (force-submit/extend-time/misconduct — **after** AUTHZ-S2 reconcile), grading detail/answer/grade (+ add `grading.detail_viewed`), result publish, own-score. **Non-goals:** scoped assignment UI. **Acceptance:** boundary checks (§7) hold. **Rollback:** revert. **Tests:** sensitive-route tests + audit assertions.

### Stage 8 — Role Assignment UI / Admin Console
- **Goal:** assign built-in roles with scope (Teacher@course, Proctor@exam, Grader@exam). **Inputs:** scope resolvers live. **Acceptance:** scoped roles enforce. **Rollback:** disable UI. **Tests:** scoped-assignment E2E.

### Stage 9 — Custom Role Support
- **Goal:** `is_system = false` custom roles. **Only after** matrix + enforcement stable. **Acceptance:** custom role grants enforce. **Rollback:** hide UI. **Tests:** custom-role tests.

---

## Alternatives Considered

- **Classic RBAC (no scope):** rejected — cannot express course/exam/attempt scoping (§Formal Model).
- **Full ABAC / a policy language (Cedar / Oso Polar):** rejected as the *implementation* for Phase 3 — over-engineered; the resource resolver gives most of ABAC's value without a policy engine or its learning curve. The model is, however, **deliberately isomorphic to the SOTA ABAC/RBAC tuple** (see §SOTA Validation).
- **External library (CASL / Casbin / Oso / Permify / Cedar):** explicitly forbidden *in this job* (job §2). The §SOTA Validation cross-check confirms our in-repo `constants + resolver` design reproduces their core abstractions; LAN/offline + minimal-dependency constraints argue against adding a runtime policy engine. (Custom-role UI in Phase 4 may *revisit* a library — not Phase 3.)
- **Flat `requirePermission` enforcement:** rejected for scoped resources (§22.4) — insufficient for attempt/exam/grading; kept only for system-level/non-resource routes.
- **Option A (role-string only) / Option B (role+flat perms):** rejected (Data Model §A, §B).

---

## SOTA Validation

> Job §17 evidence rule + AGENTS.md "MCP/External Research": before finalizing a home-grown authorization model, cross-check it against the established SOTA libraries' abstractions. **Research only — no runtime dependency is introduced.** Sources: Context7 (`/stalniy/casl`, `/apache/casbin-node-casbin`, `/websites/osohq_oss`) and Cedar/AVP documentation.

The industry-canonical authorization decision is a four-tuple:

```
authorize(principal, action, resource, context) -> allow | deny
```

(Cedar / Amazon Verified Permissions; Oso `authorize(actor, action, resource)`; CASL `ability.can(action, subject[, field])`; Casbin `enforce(sub, obj, act[, domain])`.) Our `requireCapability({permission, resource:{type,id}})` + RequestContext is the same tuple: principal = `ctx.actor` + role assignments; action = `permission`; resource = `{type, id}`; context = scope + ownership chain from the resolver.

### Cross-check vs SOTA abstractions

| Concern | SOTA library | SOTA abstraction | This ADR's design | Verdict |
| --- | --- | --- | --- | --- |
| Resource-aware check (not role-only) | CASL | `can(action, subjectInstance)` with **conditions** `{authorId: user.id}` | `requireCapability(...)` + resolver returning ownership | **Equivalent** — resolver = CASL conditions, evaluated server-side against normalized data |
| Scoped / domain RBAC | Casbin | `rbac_with_domains`: `g = _,_,_` (user, role, **domain**); `getRolesForUserInDomain` | `user_role_assignments(actor, role, scope_type, scope_resource_id)` | **Equivalent & more general** — Casbin "domain" = our `scope_type+resource_id`; we allow `course`/`exam`/`attempt` scopes, not just flat tenant |
| Role hierarchy / inheritance | Casbin | `addNamedDomainMatchingFunc` (wildcard/glob); entity parent links (Cedar) | Admin compatibility superset; org→course→exam→attempt scope chain via resolver | **Same concept** — we express hierarchy through the resolver parent chain rather than wildcard matching (easier to audit, matches our FK structure) |
| Field-level / partial visibility (double-blind grader) | CASL | `can('read','Article','field')` per-field grants | split permissions: `grading.detail.view` / `grading.answer.view` / `grading.identity.view` | **Equivalent in intent** — we split the *permission* (a grader may hold `grading.score.write` but not `grading.identity.view`) rather than masking a payload field; better fit for a checkpoint model |
| List-route data filtering | Oso | `authorized_resources(actor, action, Class)` — policy pushed down to DB query | *(not yet designed)* — registry is single-resource | **Gap acknowledged** — see §Risks #8 + §Open Questions; RBAC-M4/GRADING-M1 must design list-scope filtering |
| Policy testability | Oso | `query_rule_once('has_role', user, role, repo)` | shadow-mode parity tests across the role matrix | **Equivalent** — shadow parity = Oso rule unit tests |

### Conclusion

Our in-repo model reproduces the load-bearing SOTA abstractions (resource-aware check, scoped/domain RBAC, role hierarchy, partial visibility, testable policies) without a runtime policy engine. One real gap surfaced: **list-route data filtering** ("return only attempts in this grader's exams") is a first-class concept in Oso/CASL that our single-resource registry does not yet model. This is recorded as a risk + open question and assigned to RBAC-M4 (list-scope registry entries) and GRADING-M1 (grading-queue filtering), so it is designed for rather than retrofitted.

---

## Risks

1. **Proctor-perm migration trap** — flipping the 4 proctor routes to capability checks without the compatibility superset denies Admin. Mitigation: AUTHZ-S2 reconcile + shadow mode (Stage 5) before Stage 6/7.
2. **Confused deputy / resource re-parenting** — a mutable parent link could grant wrong scope (§22.1). Mitigation: ownership-chain validation in every sensitive resolver; deny-on-inconsistency.
3. **Resolver performance on hot paths** — save-answer/heartbeat/proctor dashboard may multiply DB reads (§22.2). Mitigation: request-local resolver cache; resolver metrics in shadow mode.
4. **Last-admin guard erosion** — moving off `users.role` before the guard moves to `user_role_assignments` could allow demoting the last Admin. Mitigation: RBAC-M6/M7 ordering.
5. **Audit coverage gap** — sensitive reads (grading detail) and privilege changes (role assign) are unaudited today. Mitigation: AUDIT-M1/M2.
6. **System-as-Admin mislabeling** — scanners using `role:"Admin"` pollute audit attribution. Mitigation: SYSTEM-M1.
7. **RBAC vs state-machine conflation** — granting a permission must not bypass state legality. Mitigation: the cross-cutting invariant + §22.3 matrix + per-transition state guards.
8. **List-route data filtering gap (SOTA)** — single-resource `requireCapability` does not cover *list* routes (grading queue, scores list, candidate list) where a scoped actor must see only their authorized subset (Oso `authorized_resources` / CASL filtered queries solve this natively). Mitigation: RBAC-M4 designs list-scope registry entries (a "filter spec", not a single id); GRADING-M1 applies it to the grading queue; covered in §SOTA Validation.

---

## Open Questions

1. `monitoring_events` table decision (readiness §7.3 Option A) — deferred to EVENT-M1.
2. Exact `users.role` deprecation timeline (after Stage 8 scoped roles + shadow parity).
3. Whether `question` becomes an enforced scope (Phase 3: resource only) or stays deferred.
4. Double-blind grading enforcement depth (modeled now, enforced in a GRADING variant).
5. Whether routine 403s on sensitive resources should audit (AUDIT-M2 decision).
6. **List-route data-filtering shape (SOTA gap)** — how list routes (grading queue, scores list, candidate list, proctor attempts) express "filter to the actor's authorized scope" (cf. Oso `authorized_resources`). RBAC-M4 must define a list-scope registry entry (filter spec) vs. single-resource entry; GRADING-M1 is the first consumer.

---

## Confused Deputy / Resource Re-parenting (§22.1)

> Required invariant: *Authorization must never rely on a mutable parent chain without validating organization/scope consistency.*

### Resource Parent Integrity Matrix

| Resource | Parent Link | Mutable? | Freeze Point | Integrity Check Required? | Audit Required on Change? |
| --- | --- | :---: | --- | :---: | :---: |
| attempt | exam | **no** | attempt creation | yes | n/a |
| answer | attempt | **no** | answer save | yes | n/a |
| grading_entry | attempt | **no** | grading entry creation | yes | n/a |
| exam | course | maybe | publish/start | yes | yes |
| course | organization | maybe | course creation/migration | yes | yes |
| candidate | organization | maybe | enrollment/attempt creation | yes | yes |
| enrollment | exam | **no** | enrollment creation | yes | n/a |
| question | course | maybe | question use in published exam | yes | yes |

### Decisions (job §22.1)
1. Immutable after creation: `attempt→exam`, `answer→attempt`, `enrollment→exam`, `grading_entry→attempt`.
2. Mutable (with audit): `exam→course`, `course→organization`, `candidate→organization`, `question→course`.
3. Parent changes requiring audit: all mutable links above.
4. Parent changes requiring elevated permissions: `exam→course` reparent requires Admin (`exam.update` at minimum, likely a dedicated action).
5. Forbidden after publish/start: `exam→course` reparent after `exam.publish`/`exam.open`; `question→course` after the question is used in a published exam's snapshot.
6. Resolver paths validating org consistency: all sensitive resolvers (`resolveAttemptScope`, `resolveExamScope`, `resolveGradingScope`, `resolveOwnAttempt`).
7. Consistency proof/version: **Phase 3 — no** (no version column on parent links); resolver re-reads the chain per request. Versioning is a Phase 4 candidate.
8. Denormalization for integrity/performance: **Phase 3 — no**; rely on FK validation. Denormalized ownership is a Phase 4 optimization behind metrics.
9. Freeze published exam ownership: **Yes** — once published, `exam.courseId` is frozen.
10. Inconsistent parent chain detected → **deny authorization + structured monitoring event; never silently allow**.

### Resolver behavior (sensitive resources)
```
resolveAttemptScope(attemptId)
  -> load attempt
  -> load exam
  -> load course if applicable
  -> verify attempt.organizationId === exam.organizationId
  -> verify exam.courseId belongs to same organization
  -> return scope chain  (or DENY + monitor on mismatch)
```

---

## Scope Resolver Performance / Observability (§22.2)

> Required invariant: *PostgreSQL remains the source of truth. Caching may optimize scope resolution but must not become authorization authority.*

### Resolver Performance Matrix

| Resolver | Hot Path? | Request Cache? | Cross-Request Cache? | Expected Cost | Metrics Required? |
| --- | :---: | :---: | :---: | --- | :---: |
| `resolveAttemptScope` | yes | yes | no initially | attempt + exam lookup | yes |
| `resolveExamScope` | yes | yes | maybe later | exam lookup | yes |
| `resolveCourseScope` | medium | yes | maybe later | course lookup | yes |
| `resolveOwnAttempt` | yes | yes | no | attempt + candidate match | yes |
| `resolveGradingScope` | medium | yes | no | attempt + question validation | yes |
| `resolveUserScope` | low | yes | no | user lookup | optional |
| `resolveSystemScope` | n/a | n/a | n/a | none | no |

### Decisions (job §22.2)
1. Hot-path resolvers: `resolveAttemptScope`, `resolveExamScope`, `resolveOwnAttempt` (save-answer, heartbeat, proctor dashboard, grading queue).
2. Per-request cache: **yes** for all resolvers (`request.authzCache`).
3. Cross-request cache: **no initially**; maybe later for `resolveExamScope`/`resolveCourseScope` with explicit invalidation on role-assignment change.
4. Never cached: `resolveOwnAttempt` (ownership must be live), `resolveSystemScope`.
5. Cache invalidation rule: request-local cache is per-request (auto-invalidated); any future cross-request cache must invalidate on role-assignment / scope-binding change.
6–7. Resolver timing/query-count recorded in shadow mode: **yes**.
8. Performance budget: target ≤ 2 DB reads per resolver on the hot path (e.g. `resolveAttemptScope` = attempt + exam).
9. Routes avoiding heavyweight resolvers unless needed: organization-scope Admin routes use no resolver.
10. Regression guard: shadow-mode metrics + a resolver-query-count test in CI.

### Shadow-mode resolver metrics
```
route, permission, resourceType, resolverName,
resolverCallCount, resolverDurationMs, dbQueryCount,
cacheHit/cacheMiss, legacyAllowed, capabilityAllowed
```

---

## Runtime State Transitions Must Also Be Permissioned (§22.3)

> Required invariant (cross-cutting + job §22.3): *No runtime state transition may be exposed as an API without a corresponding permission or explicit public/self-service policy.* And: **RBAC does not replace the domain state machine. RBAC answers who may request a transition. The state machine answers whether the transition is legal now. Both are required.**

Every state-changing runtime operation needs: **permission check + state-machine legality check + audit event (if sensitive).**

### State Transition Permission Matrix

| Transition | Actor Type | Required Permission | Required State Guard | AuditAction | Notes |
| --- | --- | --- | --- | --- | --- |
| `attempt.start` | Candidate | `attempt.start` / `exam.take` | own_attempt + available/not_started/queued | `attempt.start` | self-service |
| `attempt.submit` | Candidate | `attempt.submit` | own_attempt + in_progress/disrupted + before deadline | `attempt.submit` | runtime guard required |
| `attempt.answer.save` | Candidate | `attempt.answer.save` | own_attempt + in_progress/disrupted | `attempt.saveAnswer` | Answer Protocol |
| `attempt.restore` | Candidate | `attempt.restore` | own_attempt + disrupted | `attempt.restore` | recovery |
| `attempt.force_submit` | Proctor/Admin | `attempt.force_submit` | attempt not terminal | `attempt.forceSubmit` | sensitive |
| `attempt.time.extend` | Proctor/Admin | `attempt.time.extend` | exam/attempt still open | `attempt.extendTime` | sensitive |
| `attempt.misconduct.mark` | Proctor/Admin | `attempt.misconduct.mark` | attempt exists, non-terminal preferred | `attempt.misconductFlagged` | sensitive |
| `attempt.auto_submit` | System | `system.auto_submit` | deadline reached, not terminal | `attempt.autoSubmit` | SYS; replaces Admin-mislabel |
| `grading.score.write` | Grader/Admin | `grading.score.write` | pending_manual | `grading.score_entered` | sensitive; state guard |
| `grading.finalize` | Admin | `grading.finalize` | all questions scored | `grading.finalized` | |
| `exam.publish` | Teacher/Admin | `exam.publish` | draft/closed per lifecycle | `exam.publish` | |
| `exam.close` | Teacher/Admin | `exam.close` | published/open | `exam.close` | |
| `exam.result.publish` | Teacher/Admin | `exam.result.publish` | grading complete / policy | `exam.publish_results` | sensitive |

### Decisions (job §22.3)
1. State transitions exist: the attempt lifecycle (`AttemptStatus`, `enums.ts:71-81`), exam lifecycle (`ExamStatus`, `enums.ts:144-153`), grading (`GradingStatus`, `enums.ts:94-99`), result publication (`ResultPublicationMode`, `enums.ts:115-121`).
2. Permission per transition: see matrix.
3. State-machine guard per transition: see matrix (commands `publishExam`, `startAttempt`, `submitAttempt`, etc. — `AGENTS.md` "Exam is not CRUD").
4. System-only transitions: `attempt.auto_submit`, `attempt.disrupted` (heartbeat).
5. Admin/proctor/teacher/grader-initiated: see Actor Type column.
6. Transitions requiring audit: all sensitive (marked).
7. Idempotent transitions: `attempt.answer.save` (Answer Protocol idempotency), `attempt.auto_submit` (`gradeAttemptIdempotent`).
8. Irreversible transitions: `exam.archive`, `exam.delete`, `attempt.void`.
9. Forbidden after publish/start/submit/grade: exam reparent, question reparent into a used snapshot, attempt.submit after terminal.
10. Belonging to separate Large Jobs (referenced only here): candidate runtime state machine (RUNTIME-L1), Answer Protocol v2 (ANSWER-L1) — fenced off per readiness §10–§11.

---

## `requirePermission()` Compatibility Review (§22.4)

> Required invariant: *Flat permission checks are insufficient for scoped resources. All scoped resources must use resource-aware capability checks.*

### Permission Helper Decision Table

| Helper | Current / New | Resource-Aware? | Allowed Use | Forbidden Use |
| --- | --- | :---: | --- | --- |
| `requireRole` | current legacy | no | compatibility only (until Stage 6/7 flip) | new enforcement |
| `requirePermission` | current flat | no | system/non-resource permissions only; tests; temporary compat | attempt/exam/course/grading/score/candidate-answer/proctor-timeline/export scoped routes |
| `requireCapability` | **new** | **yes** | all scoped routes | n/a |
| `shadowRequireCapability` | **new** | **yes** | migration compatibility validation | final enforcement only |

### Decisions (job §22.4)
1. Keep `requirePermission(permission)`? **Yes, deprecated-scoped** — only for system-level/non-resource routes during migration.
2. Deprecate? **Yes** for scoped resources.
3. Rename to `requireFlatPermission`? **Optional** — recommended to make the limitation explicit.
4. New code uses `requireCapability()`? **Yes.**
5. `ctx.permissions` remain a flat cache? **Yes, as a compatibility cache** derived from role assignments; not the authority for scoped checks.
6. `ctx.role` remain? **Yes, compatibility only** (`types.ts:459`).
7. Introduce `ctx.roleAssignments`? **Yes** (RBAC-M1) — the authority for scoped capability checks.
8. Route preHandlers use registry-driven capability checks? **Yes** (RBAC-M4, via Fastify `preHandler`/`onRoute` — Context7-verified).
9. `requirePermission()` forbidden for scoped resources? **Yes** (enforced by lint/registry coverage test).
10. Routes that can safely use flat permissions? Public/system endpoints with no resource id.

### Recommended resource-aware API
```ts
requireCapability({
  permission: PermissionKey,
  resource: { type: ResourceType; id: string },
});
// or service-level:
await authz.can(ctx, {
  permission: "attempt.force_submit",
  resourceType: "attempt",
  resourceId: attemptId,
});
```

---

## Evidence Appendix

> ⚠️ **Historical snapshot.** The `rg` results below were captured at ADR
> authoring time against the pre-migration codebase. Counts like "62 Admin-only"
> and "zero production `requirePermission` callers" no longer hold —
> `requireCapability` is live on 11 routes and ~50 routes remain on
> `requireRole`. Retained verbatim as the ADR's evidence base; for current
> counts re-run the commands.

> Job §17/§18: every major claim backed by file:line, audit reference, or live `rg`. Commands re-run for this ADR.

### Commands run

| Command | Result |
| --- | --- |
| `rg "requireRole" apps/api/src/routes apps/api/src/plugins` (non-test) | **16 files; 62 Admin-only + 9 Candidate-only + 1 both-roles** call sites. Confirms readiness §2.1 distribution. Sample: `attempts.admin.ts:56,129,273,...`; `attempts.candidate.ts:359,489,...`; `scores.ts:381` (both). |
| `rg "requirePermission" apps/api/src packages` (non-test) | **Only**: `plugins/auth.ts:13` (doc comment), `:104` (definition), `types/fastify-auth.d.ts:18` (type decl). **Zero production route callers.** Confirms dead parallel AuthZ layer. |
| `cat packages/auth/src/rbac.ts` (lines 4-23) | Admin = 15 perms (excludes `VIEW_EXAM_ROOM`/`EXTEND_TIME`/`MARK_MISCONDUCT`/`FORCE_SUBMIT`/`MANAGE_ORGANIZATION`); Candidate = `[TAKE_EXAM, VIEW_OWN_SCORE]`. Confirms proctor-perm trap. |
| `cat packages/domain/src/enums.ts` (lines 1-48) | `Role = {Admin, Candidate}`; `Permission` has 22 keys incl. the 4 proctor perms (`:34-38`) + dead `MANAGE_ORGANIZATION` (`:17`). |
| `rg "role" packages/db/src/schema/pg.ts` | `users.role` is plain `text().notNull()` (`:105`); **no DB ENUM/CHECK**. Confirms readiness §2.4. |
| `rg "recordAudit|createAuditLogRepo|AuditAction" apps/api/src` (non-test) | `recordAudit` helper + direct `createAuditLogRepo().create()`; **no `AuditAction` enum anywhere** in contracts/domain. Confirms readiness §7.1. |
| `rg "candidateAnswer|answerByQuestion" apps/api/src/routes/gradingQueue.ts` | `candidateAnswer` populated `:166-168` from `attempt.answers`; `GET .../grading-details` writes **no** audit. Confirms §7.2 gap. |
| `rg "role|SYSTEM_ACTOR_ID" apps/api/src/plugins/{deadlineScanner,heartbeat}.ts` | Both synthesize `role: "Admin"` (`deadlineScanner.ts:97`, `heartbeat.ts:103`) with synthetic actorIds. Confirms System-as-Admin mislabel. |
| `rg "last.?admin\|countActiveByRole" apps/api/src/routes/user.ts` | Last-admin guard at `user.ts:189-201` via `countActiveByRole(ctx,"Admin")`. |
| Context7 `/fastify/fastify` — preHandler / onRoute | Confirms per-route `preHandler` array + `onRoute` hook for registry-driven guards (matches existing `[authenticate, requireRole])` pattern). |

### Inconclusive findings

- **`question` as enforced scope:** whether Phase 3 enforces question-level scope or keeps it resource-only is an open product decision (§Open Questions) — evidence (no question-membership table today) suggests resource-only is safe for Phase 3.
- **`monitoring_events` table:** readiness §7.3 recommends Option A but defers the final decision to EVENT-M1; this ADR does not finalize it.

---

## Middle Job Breakdown

> Job §16. Each Middle Job: Goal / Non-goals / Inputs / Outputs / Files likely touched / Tests required / Acceptance / Rollback / Risk.

### RBAC-M1 — Permission Catalog Constants
- **Goal:** introduce `Permission`/`Scope`/`Role`/`AuditAction` constants (dotted keys) in a new leaf `packages/authz`, with a legacy-key mapping table. **Non-goals:** enforcement, route change, schema. **Inputs:** this ADR §Permission Catalog, §Scope Model. **Outputs:** constants + mapping. **Files:** `packages/authz/src/catalog.ts`, `packages/authz/src/legacyMap.ts`. **Tests:** closed-union + mapping unit tests. **Acceptance:** `pnpm verify` green; mapping covers all 22 legacy perms. **Rollback:** delete package. **Risk:** low (additive).

### RBAC-M2 — Role Preset Matrix
- **Goal:** define the 6 presets as data mirroring §Role→Permission Matrix. **Non-goals:** enforcement. **Inputs:** RBAC-M1. **Outputs:** preset grant module. **Files:** `packages/authz/src/presets.ts`. **Tests:** matrix coverage. **Acceptance:** every preset's grants match the matrix. **Rollback:** revert. **Risk:** low.

### RBAC-M3 — Scope Resolver Interfaces
- **Goal:** resolver *interfaces* + ownership-chain integrity rules (§22.1). **Non-goals:** route enforcement, DB impl. **Inputs:** §Resource Resolver Matrix, §22.1. **Outputs:** interfaces + deny-on-inconsistency contract. **Files:** `packages/authz/src/resolver.ts`. **Tests:** conformance stubs. **Acceptance:** types compile; integrity rules documented in code. **Rollback:** revert. **Risk:** medium (integrity rules are security-critical).

### RBAC-M4 — Route Permission Registry
- **Goal:** declarative `route→permission→scope→audit` registry + coverage test (every `requireRole` route has an entry). **Non-goals:** enforcement. **Inputs:** §Route Registry, RBAC-M1/M3. **Outputs:** registry + coverage test; optional Fastify `onRoute` wiring. **Files:** `apps/api/src/authz/routeRegistry.ts`, coverage test. **Tests:** coverage test green. **Acceptance:** 72 protected routes covered. **Rollback:** revert. **Risk:** medium (touches route metadata).

### RBAC-M5 — Shadow Permission Mode
- **Goal:** `shadowRequireCapability` records `requireRole` vs `requireCapability` disagreements + resolver metrics; legacy stays authoritative. **Non-goals:** behavior change. **Inputs:** RBAC-M4. **Outputs:** shadow helper + metrics. **Files:** `apps/api/src/authz/shadow.ts`. **Tests:** shadow parity per role. **Acceptance:** zero disagreements in CI/staging. **Rollback:** disable. **Risk:** low (no behavior change).

### RBAC-M6 — Admin Compatibility Permission Mapping
- **Goal:** make Admin a compatibility superset (add 4 proctor perms + grading perms to Admin preset) so Stage 6/7 flips preserve behavior. **Non-goals:** Candidate-own or System-only perms. **Inputs:** §Admin Compatibility Policy. **Outputs:** preset update + last-admin-guard-over-assignments plan. **Files:** `packages/authz/src/presets.ts`. **Tests:** Admin passes all current routes. **Acceptance:** shadow parity for Admin. **Rollback:** revert. **Risk:** medium (migration trap).

### RBAC-M7 — User Role Assignment Schema Proposal
- **Goal:** propose (not implement) the `roles`/`permissions`/`role_permissions`/`user_role_assignments` schema + `users.role` backfill + last-admin guard migration. **Non-goals:** migration execution. **Inputs:** §Data Model Option C. **Outputs:** migration design doc. **Files:** `docs/archive/phase3/` (historical) and `docs/adr/`. **Tests:** n/a (design). **Acceptance:** design reviewed. **Rollback:** n/a. **Risk:** high if guard moves late.

### RBAC-M8 — Built-in Role Assignment Admin API
- **Goal:** API to assign built-in roles with scope; retains last-admin guard. **Non-goals:** custom roles. **Inputs:** RBAC-M7 (executed). **Outputs:** assignment endpoints + audit (`user.role_changed`). **Files:** `apps/api/src/routes/userRole.ts`. **Tests:** assignment + guard tests. **Acceptance:** scoped roles enforce. **Rollback:** revert. **Risk:** medium.

### RBAC-M9 — Frontend Capability-Aware Navigation
- **Goal:** derive nav/landing from permissions, not `user.role` (readiness §2.3). **Non-goals:** custom-role UI. **Inputs:** RBAC-M8. **Outputs:** capability hooks. **Files:** `apps/web/src/hooks/`, `components/layout/`. **Tests:** nav tests. **Acceptance:** nav reflects capabilities. **Rollback:** revert. **Risk:** low (defense-in-depth; backend is authority).

### RBAC-M10 — Sensitive Route Enforcement Batch
- **Goal:** enforce proctor/grading/result-publish/own-score routes (Stage 7) behind capability checks + add `grading.detail_viewed` audit. **Non-goals:** scoped assignment UI. **Inputs:** RBAC-M5 parity, RBAC-M6. **Outputs:** enforced routes + audit. **Files:** `attempts.admin.ts`, `gradingQueue.ts`, `scores.ts`, `exam.ts`. **Tests:** sensitive-route + audit tests. **Acceptance:** §7 boundary checks hold. **Rollback:** revert to `requireRole`. **Risk:** high (sensitive).

### AUDIT-M1 — AuditAction Constants
- **Goal:** Zod enum / constants for the ~43 existing actions; validate at `recordAudit` boundary. **No rename.** **Non-goals:** new actions. **Inputs:** readiness §7.1. **Outputs:** `AuditAction` constants + validation. **Files:** `packages/authz/src/auditActions.ts`, `apps/api/src/routes/audit.ts`. **Tests:** validation tests. **Acceptance:** unknown action rejected. **Rollback:** revert. **Risk:** low.

### AUDIT-M2 — Sensitive Read Audit Events
- **Goal:** add `grading.detail_viewed`, `user.role_changed`, optional `audit_log.viewed`. **Inputs:** readiness §7.2. **Outputs:** new audited sensitive reads. **Files:** `gradingQueue.ts`, `user.ts`. **Tests:** audit assertions. **Acceptance:** sensitive reads audited. **Rollback:** revert. **Risk:** low.

### PROCTOR-M1 — Proctor Authority Enforcement
- **Goal:** enforce `exam_room.view`/`attempt.misconduct.mark`/`attempt.time.extend`/`attempt.force_submit` with **both** permission + state guard (§22.3). **Inputs:** RBAC-M10, AUTHZ-S2 reconcile. **Outputs:** enforced proctor routes. **Files:** `attempts.admin.ts`, `proctorMonitoring.ts`. **Tests:** proctor capability + state-guard tests. **Acceptance:** Admin (compat) + Proctor pass; Grader/Candidate denied; state guards block illegal transitions. **Rollback:** revert. **Risk:** high (sensitive, state-coupled).

### GRADING-M1 — Grader Visibility Enforcement
- **Goal:** split `grading.detail.view`/`grading.answer.view`/`grading.score.write`/`grading.finalize`; enforce at attempt scope; add `grading.detail_viewed` audit. **Inputs:** RBAC-M10, AUDIT-M2. **Outputs:** enforced grading routes. **Files:** `gradingQueue.ts`. **Tests:** grader capability + double-blind-ready tests. **Acceptance:** Grader grades but cannot publish; candidate-answer view audited. **Rollback:** revert. **Risk:** high (privacy).

### SYSTEM-M1 — System Actor Replacement
- **Goal:** replace hardcoded `role: "Admin"` in scanners with a `System` role + system-only perms; audit `actorId = "system:..."`. **Non-goals:** login/UI visibility. **Inputs:** §System Actor Policy. **Outputs:** System role + scanner contexts. **Files:** `plugins/deadlineScanner.ts`, `plugins/heartbeat.ts`, `packages/authz/src/systemActor.ts`. **Tests:** scanner context tests. **Acceptance:** audit no longer mislabels system work as Admin. **Rollback:** revert. **Risk:** medium (scanner behavior).

---

## Acceptance Criteria (job §19)

- ✅ `docs/adr/ADR-010-scoped-rbac-architecture.md` exists (this ADR, formerly at `docs/phase3/rbac/adr-scoped-rbac-architecture.md`).
- ✅ The ADR clearly states Phase 3 will use formal Scoped RBAC (Formal Model).
- ✅ Distinguishes RBAC core from custom role UI (Data Model Option C vs D; Non-Goals).
- ✅ Permission catalog v0 exists (§Permission Catalog, 9 groups).
- ✅ Role preset matrix exists (§Role Presets + §Role→Permission Matrix).
- ✅ Scope model v0 exists (§Scope Model).
- ✅ Resource resolver matrix exists (§Resource Resolver Matrix).
- ✅ Route permission registry draft exists (§Route Registry).
- ✅ Admin compatibility policy exists (§Admin Compatibility Policy).
- ✅ Candidate own-scope policy exists (§Candidate Own-Scope Policy).
- ✅ Proctor authority policy exists (§Proctor Authority Policy).
- ✅ Grader visibility policy exists (§Grader Visibility Policy).
- ✅ System actor policy exists (§System Actor Policy).
- ✅ Shadow permission mode design exists (§Shadow Permission Mode).
- ✅ Data model proposal compares 4 options (§Data Model A/B/C/D).
- ✅ Migration plan Stage 0–9 exists (§Migration Plan).
- ✅ Middle Job breakdown exists (15 jobs).
- ✅ No code behavior changed. ✅ No DB schema changed. ✅ No API contract changed. ✅ No permission enforcement changed. ✅ No audit action renamed.
- ✅ Redis explicitly ruled out as authorization authority (§Scope Model invariant, §9 re-verification).

## Review Checklist (job §20 + §23)

```
[x] Not a toy role-string model.
[x] Supports scoped role assignments.
[x] Admin compatibility preserved.
[x] Proctor cannot view answers or grade by default.
[x] Grader permissions split into view detail / view answer / write score / finalize.
[x] Candidate own-scope explicit.
[x] System actor is not Admin.
[x] Redis not used for AuthZ.
[x] Route registry maps permission + resource + scope + audit.
[x] Audit and client telemetry remain separate.
[x] Custom RBAC UI deferred but not made impossible.
[x] Migration can happen route-by-route.
[x] Shadow mode prevents behavior-breaking migration.
[x] ADR mentions confused deputy / resource re-parenting risk (§22.1).
[x] Defines immutable/frozen parent links for sensitive resources (§22.1 matrix).
[x] Requires organization/scope consistency checks in resolvers (§22.1).
[x] Discusses resolver performance (§22.2).
[x] Defines request-local resolver caching policy (§22.2).
[x] Requires resolver metrics in shadow mode (§22.2).
[x] Every runtime state transition needs permission + state guard (§22.3 + cross-cutting invariant).
[x] Includes State Transition Permission Matrix (§22.3).
[x] Reviews current requirePermission() signature (§22.4).
[x] Introduces/proposes resource-aware requireCapability() (§22.4).
[x] Forbids flat permission checks for scoped sensitive resources (§22.4).
```

---

## Cross-Cutting Architectural Invariants

> The ADR already satisfies P3-L2. This section adds implementation invariants to prevent ambiguity in later Middle Jobs. Every rule below is a **must-implement constraint** for the implementation jobs that follow; none changes the design decisions above.

---

### 3.1 `users.role` Compatibility Cache Consistency

After `user_role_assignments` exists and is backfilled, it becomes the authoritative source of role grants. `users.role` is a denormalized compatibility cache only. Any write that changes effective role assignments must update `user_role_assignments` and `users.role` in the same transaction until `users.role` is removed. New authorization reads from `user_role_assignments`; legacy code may temporarily read `users.role`.

**Concretely:**

1. Stage 0–5 before backfill: `users.role` is the only source. No behavioral change.
2. Stage 7+ after `user_role_assignments` exists and backfill completes: `user_role_assignments` is authoritative; `users.role` is a read-only compatibility cache.
3. Any role-change operation (`user.role.assign`, `candidate.create` implicit Candidate assignment, disable-user demotion) must update **both** `user_role_assignments` and `users.role` in the **same database transaction** until `users.role` is removed entirely.
4. New AuthZ code reads `user_role_assignments`. Legacy code (pre-migration routes, handlers not yet flipped) may temporarily read `users.role`.
5. A **consistency check** (CI test + startup assertion) must detect:
   - `users.role = 'Admin'` but no active Admin-scope assignment in `user_role_assignments`.
   - Active Admin-scope assignment exists but `users.role ≠ 'Admin'`.
6. Consistency-check failure:
   - CI / test environments: **fail** (hard break).
   - Production startup: log a **critical warning** and enter **degraded mode** (exact degraded-mode behavior is decided by RBAC-M7).

---

### 3.2 Last-Admin Guard Migration Contract

After `user_role_assignments` is introduced, the last-admin guard means:

> Within the current organization, there must remain at least one actor whose user account is active, login is not disabled, and who holds an **active organization-scope Admin assignment** in `user_role_assignments`.

**Constraints:**

1. This check must execute **before** any operation that could reduce the Admin count:
   - disable user
   - delete user
   - remove Admin assignment
   - deactivate Admin assignment
   - change Admin role to non-Admin
2. The check must execute **within the same transaction** as the mutation.
3. This check **replaces** the current `countActiveByRole(ctx, "Admin")` (`user.ts:189-201`) once `user_role_assignments` is live.
4. **System actor does not count** toward the last-admin guard.
5. Candidate / Teacher / Proctor / Grader do **not** count toward the last-admin guard unless they also hold an active organization-scope Admin assignment.

---

### 3.3 List Route Filter Registry Extension

The single-resource route registry (`§Route → Permission → Scope → Audit Registry`) is insufficient for list pages. List APIs must filter rows to the actor's authorized scope — a scoped Grader must see only attempts in their assigned exams, a scoped Teacher must see only courses they teach.

**Extension point:**

```ts
type RoutePermissionRegistryEntry = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  requirement: PermissionRequirement;
  resource: SingleResourceSpec | ListResourceSpec;
  scope: ScopeType;
  resolver: ResolverKey;
  auditAction?: AuditActionKey;
  sensitive: boolean;
  migrationStage: number;
};

type ListResourceSpec = {
  type: "list";
  listOf: ResourceType;
  filterSpec: FilterSpecKey;
};
```

**List routes requiring `filterSpec`:**

| Route | filterSpec Purpose |
| --- | --- |
| `GET /admin/grading-queue` | filter attempts to Grader's assigned exams |
| `GET /admin/exams/:examId/scores` | filter scores to exam scope |
| `GET /admin/candidates` | filter candidates to org/course scope |
| `GET /admin/exams/:id/proctor/attempts` | filter attempts to Proctor's assigned exam |
| `GET /admin/questions` | filter questions to Teacher's assigned courses |
| `GET /admin/exams` | filter exams to Teacher's assigned courses |
| `GET /admin/audit-logs` | filter to org scope (always full for Admin) |

RBAC-M4 must reserve this extension point. RBAC-M4 does not need to implement all filters. Business-specific list filtering may be implemented in later route enforcement jobs (GRADING-M1 for grading queue is the first consumer).

---

### 3.4 Organization Anchor Invariant

Every sensitive resource resolver must explicitly validate `resource.organizationId === ctx.organizationId`.

**Rules:**

1. Even though Phase 3 is single-tenant, every sensitive resolver must **explicitly** verify the organization anchor. Single-tenant deployment is not a reason to omit organization checks; it is the safest time to make them structural.
2. A resolver must **not** rely only on the parent chain to implicitly infer organization membership. The final check `resource.organizationId === ctx.organizationId` (or equivalent org-consistency check through the parent chain) must be explicit.
3. For attempt / exam / course / candidate / grading / score / audit-log resources, the resolver must confirm the resolved resource belongs to the current `ctx.organizationId`.
4. If an inconsistency is detected:
   - **Deny** the request.
   - Record a structured warning / monitoring event.
   - Do **not** silently allow.
5. This is a **preventive invariant** against future Phase 4 multi-tenant IDOR vulnerabilities. Making the check structural now means Phase 4 multi-tenant cannot accidentally ship without it.

---

### 3.5 Frontend AuthZ Hydration Strategy

The frontend must not independently infer scoped permissions. Backend remains the authority for all authorization decisions.

**Rules:**

1. Backend is the authorization authority. Frontend capability state is only a rendering hint.
2. For resource detail/list APIs, the backend **may** include a `_capabilities` object in the response DTO.
3. `_capabilities` must **not** be used as the authorization basis for any server API call. All server APIs call `requireCapability` regardless of frontend state.
4. UI hiding a button is not a security boundary. A determined user can call the API directly; the server must deny independently.
5. The frontend must **not** call `/authz/check` per-button to avoid API explosion. Capability state is hydrated from the business DTO.
6. Recommended: capability-aware DTOs carry scoped capabilities inline.

**Example DTO shape:**

```json
{
  "attemptId": "...",
  "status": "in_progress",
  "_capabilities": {
    "canForceSubmit": true,
    "canExtendTime": false,
    "canMarkMisconduct": true,
    "canViewCandidateAnswer": false
  }
}
```

RBAC-M9 should design capability-aware navigation and button rendering using backend-provided hints, but all server APIs still call `requireCapability`.

---

### 3.6 Bulk Operation AuthZ Strategy

Bulk APIs (batch force-submit, batch extend-time, batch enrollment, batch export, batch grading assignment) require set-based authorization, not item-loop authorization.

**Rules:**

1. Bulk API must **not** check only the first resource and assume the rest are equivalent.
2. Bulk API must **not** loop N times through a single-resource resolver (N+1 performance cliff).
3. Bulk API must use a **batch resolver / list resolver** that resolves the entire requested set in one query.
4. Strategy:
   - Resolve the actor's visible/authorized resource-id whitelist (set-based).
   - Compare requested IDs against allowed IDs.
   - If any unauthorized ID exists: **fail-all by default**.
   - Partial success is allowed **only** if the API explicitly declares partial semantics (returns per-item success/failure).
5. The unauthorized delta must be **audited** or recorded as a security warning.
6. Applicable scenarios: batch force-submit, batch extend-time, batch enrollment, batch export, batch grading assignment.

> Bulk authorization is set-based, not item-loop based.

---

### 3.7 AuthZ State Propagation / Revocation Policy

Permission changes must take effect with well-defined timing. Revocation semantics are part of security — if a permission is revoked, the system must define when the revocation becomes effective.

**Rules:**

1. Do **not** store long-lived effective permissions inside JWT. JWT may carry identity and role for routing/teaching, but authorization must resolve from DB-backed role assignments at request time.
2. Request-time authorization must read from DB-backed role assignments or a cache with a defined invalidation policy.
3. Request-local cache is allowed (per-request, auto-invalidated).
4. Cross-request cache is **not** allowed in Phase 3 unless an explicit invalidation policy is implemented.
5. Permission changes must take effect **no later than the next authenticated request** for request-local resolution. Cross-request caching (if introduced) must respect this bound.
6. High-risk revocations (e.g., removing Admin from the last-qualified actor) may require session invalidation — this is a later Middle Job decision, not a Phase 3 blocker.
7. Real-time cross-pod invalidation / Redis pub-sub is a **Phase 4 consideration**, not a Phase 3 blocker.
8. Redis may broadcast invalidation in the future but must **not** become the AuthZ authority.

---

### 3.8 Audit Sanitization and Tamper-Evidence Boundary

Audit logs must be safe to store and review without leaking sensitive payloads. Tamper-evidence is a Phase 4 hardening concern, not a Phase 3 blocker.

#### Phase 3 hard rules

1. Audit metadata must **not** contain:
   - Candidate answer payload (`candidateAnswer`, `answerByQuestion`)
   - Raw rich-text answer
   - ID number (national ID, student number beyond opaque actor/candidate ID)
   - Phone number
   - Email (unless strictly required for the audit action)
   - Password / token / session secret
   - Full PII snapshot
2. Audit metadata **should** contain:
   - Resource IDs (attempt ID, exam ID, course ID — opaque, not PII)
   - Action name (constant)
   - Old/new scalar state when safe (e.g., `oldStatus: "in_progress"`, `newStatus: "submitted"`)
   - Reason code
   - Actor ID
   - Timestamp
3. Sensitive reads (grading detail view, candidate-answer view) must audit the **fact of access**, not the content accessed.
4. `grading.detail_viewed` metadata must **not** include `candidateAnswer`.

#### Phase 4 hardening (future consideration, not a Phase 3 blocker)

- Insert-only DB permissions on `audit_logs`
- Append-only audit storage
- Hash chain / tamper-evident audit log
- External compliance log sink

Do **not** make hash chain a Phase 3 blocker.

---

### 3.9 AuthZ Failure Mode Invariant

AuthZ components must never fail open. However, operational failures should not be reported as ordinary 403 permission denial. A resolver or AuthZ infrastructure failure should surface as a distinct service-unavailable error so the UI and operators can distinguish "not allowed" from "authorization service failed."

**Failure categories:**

| Category | Example | Response | HTTP Status |
| --- | --- | --- | --- |
| Permission denied | Actor lacks the required permission | Return structured denial | **403** `PERMISSION_DENIED` |
| AuthZ unavailable | Resolver DB query timeout; resolver throws unexpected error; role assignment lookup unavailable; registry inconsistent | Return service-unavailable | **503** `AUTHZ_UNAVAILABLE` |
| Scope inconsistency | Resource parent chain inconsistent; org mismatch detected | Return denial or conflict | **403** or **409** (implementation job decides) |

**Rules:**

1. AuthZ components must **never** fail open (deny by default).
2. Operational failures (DB timeout, resolver crash, registry corruption) must **not** masquerade as 403 — they must surface as 503 so operators can distinguish "unauthorized" from "broken."
3. Scope inconsistency (org mismatch, broken parent chain) must deny. Whether the response is 403 or 409 is decided by the implementation job; it must **not** allow.
4. The UI must handle 503 `AUTHZ_UNAVAILABLE` distinctly from 403 `PERMISSION_DENIED` (different user-facing messaging).

---

## Phase 4 Considerations (Non-Blocking)

The following are **not** Phase 3 blockers. They are recorded here for completeness and future hardening only:

- Automatic Admin downscoping based on audit log heuristics
- Full HATEOAS framework
- Bulk operation implementation (design above; execution is a later job)
- Real-time cross-pod revocation
- Redis pub/sub invalidation
- Audit hash chain
- Insert-only DB role hardening
- External compliance log sink
- `monitoring_events` table (deferred to EVENT-M1)
- `school` / `grading_task` scope enforcement
- Custom-role management UI (Phase 4 platformization)
- SuperAdmin / multi-tenant cross-tenant management (Phase 4)

---

## Legacy Role Reconciliation Strategy

Phase 3 backfill is **exact and conservative**:

- `users.role = Admin` → organization-scope Admin assignment in `user_role_assignments`
- `users.role = Candidate` → own-scope Candidate assignment in `user_role_assignments`

The system must **not** automatically demote Admins based on heuristics. An optional future migration report may analyze audit logs to recommend least-privilege role changes, but:

- Audit logs may be incomplete.
- Historical behavior does not prove future responsibility.
- Automatic demotion may lock administrators out.
- Least-privilege migration must be human-reviewed.

This is a safety guarantee: the backfill is a faithful mirror, not an inference engine.
