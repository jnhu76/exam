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

The **living source of truth** for the route inventory is the permanent
whole-application regression lock
(`apps/api/src/authz/routeRegistryConformanceWholeApp.test.ts`): it captures
the real `registerApiRoutes` composition through a Fastify `onRoute` hook on
every test run and asserts the primary/protected/non-protected split plus the
per-addition comment chain. Treat any count in prose (including below) as a
snapshot — cite the test, not the number.

Current snapshot (as of #296, PR #348, commit `ac79c695`):

- **132 primary runtime routes** in the `registerApiRoutes` composition.
- **116 capability/ownership-gated protected routes**.
- **16 non-capability routes** (authenticate-only + public + one intentionally
  disabled public endpoint; the test's intentional closed sets enumerate them
  exactly).
- **0 `requireRole` consumers**.
- **0 `requirePermission` route consumers**.
- **0 `users.role` authority decisions**.
- **0 JWT-role authority decisions**.

Fastify additionally generates one `HEAD` alias per `GET` route; aliases are
excluded from the primary application-route count.

> **Historical baseline (Gate 0.5, 2026-07-24, commit `f2a7a80`).** The
> M10-A through M10-F migration series and the P4-V0 Gate 0.5 re-verification
> reconciled the then-current tree to **91 primary routes (81 protected +
> 10 non-gated)**, 81/81 registry ↔ runtime MATCH with zero drift, and a full
> `pnpm verify` pass. Full evidence:
> [`docs/audits/P4-V0-GATE-0.5-BASELINE-VERIFICATION.md`](../audits/P4-V0-GATE-0.5-BASELINE-VERIFICATION.md).
> That inventory is a **historical record**; the conformance test above is the
> current authority (the count has grown with each subsequent route addition —
> see the test's comment chain).

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

> **Built-in assignable set has widened since the P4 MVP.** Proctor and Grader
> are built-in assignable roles (preset-bundled, route-gated), and **P7-E2A
> (ADR-017) added Maintainer** — the sixth assignable human role (the seventh
> built-in preset counting the synthetic, non-assignable System actor) — a
> **read-only Operational Observer** (system health/diagnostics/backup/
> restore-readiness/ops-policy views; zero business permissions; zero write
> permissions). Admin ∩ Maintainer = ∅ is enforced server-side (D14).
> **ADR-017 revision 4 (PROPOSED)** narrows the Maintainer to an observer (not
> a controller) and **ADR-018 (PROPOSED)** defines the read-only Observability
> Window contract. Admin remains the Exam business owner (考试管理员) and never
> holds infrastructure execution authority; the Host Operator (not Exam RBAC)
> performs real infrastructure maintenance.
>
> Since the S1 role-correctness campaign (#286 / PR #347, #296 / PR #348),
> Teacher authority is additionally **course-assignment-scoped**
> (`teacher_course_assignments`) and Grader grading authority is
> **exam-assignment-scoped** (`grader_exam_assignments`); Admin remains
> org-wide. See *Current scoped-role status* below.

## Current scoped-role status (M11 resource-relationship authorization)

**Implemented** — scoped authority is live for all three staff roles:

- **Proctor → Exam** per ADR-015 (Accepted 2026-08-02, PR #245; reality audit
  [`docs/audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md`](../audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md)):
  `exam_proctor_assignments` + `exam_proctor_assignment_events` persistence,
  the `assignProctorToExam` / `revokeProctorFromExam` commands, the Admin
  assignment API, the Incident→Exam resolver, per-request Proctor-assignment
  enforcement (Admin short-circuit; missing assignment → 404), the
  `proctorAccess` route-registry policy, and the minimum Proctor incident
  activation (view/create/investigate — resolve stays Admin-only). Closeout:
  [`docs/audits/M11-I1-PROCTOR-EXAM-ASSIGNMENTS-CLOSEOUT.md`](../audits/M11-I1-PROCTOR-EXAM-ASSIGNMENTS-CLOSEOUT.md).
- **Teacher → Course** (#286, PR #347 — `teacher_course_assignments` carrier,
  `teacherAccess: "course_assignment_scoped"` gates, SQL-side LIST filtering
  before pagination/count across courses, questions, exams, candidates, and
  scores, Admin assignment API + UsersPage dialog).
- **Grader → Exam** (#296, PR #348 — `grader_exam_assignments` carrier,
  `graderAccess: "exam_assignment_scoped"` gates on grading detail/write,
  grading-queue LIST filtering before pagination/count, Admin assignment API +
  UsersPage dialog).

The shared contract across all three slices: **authority = capability ×
assignment** — the scope row alone grants zero capabilities; scopes resolve
fresh from the database on every request (revocation effective on the next
request); LIST endpoints filter in SQL **before** pagination and total count;
direct-ID out-of-scope probes fold into the canonical 404
(anti-enumeration).

**Still deferred** (Phase 3 product work, not implemented):

- Scoped role-assignment storage generalizations such as `scope_type`,
  `scope_resource_id`, `course_staff`, `teacher_exam_assignments`, and
  `grading_assignment` — each implemented slice deliberately uses its own
  narrow carrier table instead.
- Full scoped Proctor product workflows; the Proctor Recovery Center UI is
  J6.
- Staff invitation and Email password reset are implemented (#297):
  identity tokens are single-use hashed-token rows consumed by CAS in the
  identity commands; deactivation revokes via `auth_epoch` plus the
  per-request `is_active` check. Permission/audit visibility surfaces stay
  with #298.
- Custom roles, permission-management UI, multi-tenant switching,
  SuperAdmin, and cross-tenant authorization.

Built-in global role assignments and the Admin / Teacher / Candidate MVP role
model already exist; the deferred work is product lifecycle and workflow
completion, not basic Teacher/Grader activation and no longer
resource-level scoping (implemented for all three staff roles above).
