# Authorization Architecture

> Current authority for the platform's capability-based authorization model.
> This describes what is **implemented** today (Phase 2 + Phase 3 infrastructure),
> not future scoped-role-bundle product work — see
> [`docs/roadmap/phase3-open-items.md`](../roadmap/phase3-open-items.md) for that.

## Authority

- Formal decision: [ADR-010 — Scoped RBAC Architecture](../adr/ADR-010-scoped-rbac-architecture.md)
- Phase scope: [`docs/roadmap/phase-roadmap.md`](../roadmap/phase-roadmap.md) (Phase 3)

## Model

Authorization is **capability-based**, not `requireRole`-based. Every protected
route declares a capability requirement; the runtime resolves whether the actor
holds that capability via assignment-backed authority.

```text
actor (session)
   │
   ▼
permission catalog  ── capability enum (Permission.*)
   │
   ▼
role presets        ── role → capability set (admin, candidate, proctor, grader, ...)
   │
   ▼
assignment-backed   ── loadAssignmentAuthority(ctx) → derived authority for this request
runtime authority      (multi-role union, last-admin invariant, fail-closed)
   │
   ▼
route guard         ── requireCapability / requireScopedCapability / requireOwnAttempt / ...
```

## Implemented primitives

All of the following are live in `packages/authz/` and `apps/api/src/authz/`:

| Primitive | Purpose |
| --- | --- |
| `requireCapability(perm)` | Flat capability gate (most admin/system routes) |
| `requireScopedCapability(perm)` | Scope-aware capability gate |
| `requireScoreCapability()` | Arbitrates `ScoreOwnView` vs `ScoreAllView` and enforces attempt ownership |
| `requireCandidateContext` | Candidate-context ownership gate |
| `requireExamEligibility` | Exam-eligibility gate (candidate may start) |
| `requireOwnAttempt` | Attempt-ownership gate (candidate owns the attempt) |
| `loadAssignmentAuthority(ctx)` | Loads assignment-backed runtime authority for the request |
| permission catalog | Enum of all capabilities (`Permission.*`) |
| role presets | Built-in role → capability mappings (admin, candidate, proctor, grader, ...) |

## Assignment-backed runtime authority

The authority kernel is **assignment-backed**, not `users.role`-based:

- `user_role_assignments` is the source of truth for which capabilities an actor holds.
- `loadAssignmentAuthority` derives the request authority by unioning all active
  role assignments for the actor in the current organization.
- **Last-admin invariant**: an advisory lock prevents removing the last admin,
  so a deployment can never lock itself out.
- **Multi-role union**: an actor may hold multiple roles; their capabilities union.
- **Fail-closed contract**: when authority cannot be resolved, the request is
  rejected (401 unauthenticated / 503 fail-closed), never allowed.

## `users.role` and JWT-role compatibility policy

There are three role-bearing surfaces. Only the first is an authority:

| Surface | Role in authorization | Read at runtime? |
| --- | --- | --- |
| `user_role_assignments` | **Runtime authorization source of truth.** `loadAssignmentAuthority` reads active assignments and unions their preset capabilities into `ctx.capabilities`. Every capability gate consults this. | Yes — authoritative. |
| `users.role` | **Compatibility / display projection** of the active primary assignment, mirrored by `roleSync` on every primary-active assignment mutation. | **No.** Zero runtime authorization decisions widen or deny based on `users.role`. The column is retained as a non-authoritative cache; deprecating it is a later decision, not Phase-3/P4 scope. |
| JWT `role` claim | **Identity / display projection and drift telemetry only.** A mismatch between the JWT claim and the assignment-backed primary role is logged at debug level and explicitly must never widen access. | **No.** Telemetry only. |

This policy was made explicit in P4-C1 (see
[`docs/audits/P4-C1-AUTHORIZATION-RESIDUE-CLEANUP.md`](../audits/P4-C1-AUTHORIZATION-RESIDUE-CLEANUP.md)).
The permanent whole-application regression lock
(`routeRegistryConformanceWholeApp.test.ts`) guards against any future route
re-introducing a role-based gate.



## Route coverage

Per the M10-A through M10-F migration series and the P4-V0 Gate 0.5
re-verification:

- **91 primary runtime routes** in the `registerApiRoutes` composition.
- **81 capability/ownership-gated protected routes**.
- **10 non-capability routes**: 4 authenticate-only, 5 public, and
  1 intentionally disabled public endpoint.
- **0 `requireRole` consumers**.
- **0 `requirePermission` route consumers**.
- **0 `users.role` authority decisions**.
- **0 JWT-role authority decisions**.

Fastify additionally generates 40 `HEAD` aliases for `GET` routes; these are
excluded from the primary application-route count.

> **Gate 0.5 caveat.** The post-PR-197 re-verification (Gate 0.5, M10-F rerun)
> is **PASS** (verified 2026-07-24 on commit `f2a7a80`). The runtime route tree
> was re-captured via a Fastify `onRoute` hook over the full production
> composition and reconciles exactly to the inventory above (91 primary routes
> = 131 raw registrations including 40 auto-generated HEAD aliases; 81
> capability/ownership-gated; 10 non-gated; 81/81 registry ↔ runtime MATCH with
> zero drift; 0 `requireRole` / `requirePermission` / `users.role`-authority).
> The final repository gate `pnpm verify` was executed in full during the P4-V0
> re-issue and **passed (exit 0)**. Full evidence:
> [`docs/audits/P4-V0-GATE-0.5-BASELINE-VERIFICATION.md`](../audits/P4-V0-GATE-0.5-BASELINE-VERIFICATION.md).
> The route inventory above may now be cited as freshly re-verified evidence.

## MVP product-role boundary

The active MVP product-role model is **Admin / Teacher / Candidate**. This model
is **CLOSED** (P4 — RBAC MVP role switch, 2026-07-24, tested commit `b4dc1d6`;
see [`docs/audits/P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT.md`](../audits/P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT.md)).

- **Admin**: full system, user, configuration, examination, grading,
  proctoring, result-publication, export, audit, and diagnostics capabilities
  within the internal default organization.
- **Teacher**: course and question authoring, exam authoring and selected
  lifecycle operations, candidate enrollment management, result publication,
  and all-score viewing. Teacher does not receive grading, proctoring,
  user-management, organization-management, diagnostics, or score-export
  capabilities.
- **Candidate**: exam eligibility and own-resource capabilities only,
  including own attempts and own results. Cross-candidate resource probes are
  denied with anti-enumeration semantics.

Frontend navigation and route gating are UX controls; backend capability and
resource gates remain the security authority.

## Non-goals (Phase 3 product work, not implemented)

The following are not implemented in the current MVP authorization model:

- Resource-relationship authorization (M11) beyond the Proctor→Exam slice:
  Teacher→Course, Teacher→Exam, and Grader→Work assignment remain deferred.
  The Proctor→Exam slice **is implemented** per ADR-015 (Accepted 2026-08-02,
  PR #245; reality audit
  [`docs/audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md`](../audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md)):
  `exam_proctor_assignments` + `exam_proctor_assignment_events` persistence,
  the `assignProctorToExam` / `revokeProctorFromExam` commands, the Admin
  assignment API, the Incident→Exam resolver, per-request Proctor-assignment
  enforcement (Admin short-circuit; missing assignment → 404), the
  `proctorAccess` route-registry policy, and the minimum Proctor incident
  activation (view/create/investigate — resolve stays Admin-only). Closeout:
  [`docs/audits/M11-I1-PROCTOR-EXAM-ASSIGNMENTS-CLOSEOUT.md`](../audits/M11-I1-PROCTOR-EXAM-ASSIGNMENTS-CLOSEOUT.md).
- Scoped role-assignment storage such as `scope_type`, `scope_resource_id`,
  `course_staff`, `teacher_exam_assignments`, and `grading_assignment`.
- Full scoped Proctor and Grader product workflows (Proctor Recovery Center
  UI is J6; Grader scoping is a separate M11 slice).
- Staff invitation, SMTP password reset, and account-lifecycle UI.
- Custom roles, permission-management UI, multi-tenant switching,
  SuperAdmin, and cross-tenant authorization.

Built-in global role assignments and the Admin / Teacher / Candidate MVP role
model already exist; the deferred work is resource-level scoping, not basic
Teacher activation.
