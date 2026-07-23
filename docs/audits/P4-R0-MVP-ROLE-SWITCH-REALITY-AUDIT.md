# P4-R0 — Admin / Teacher / Candidate MVP Role-Switch Reality Audit

> **Job:** `P4-R0 — Admin / Teacher / Candidate MVP Role Switch Reality Audit`
> **Type:** Audit + evidence + matrix freeze + Gap Register + Corrective-Job plan **ONLY**.
> **Production code modified:** `no`.
> **Branch:** `feat/rbac-reality-audit` (rebased onto `origin/master` @ `6e492fb`,
> the docs-consistency PR #205 `5a83066`. That PR's edits to
> `docs/roadmap/phase-roadmap.md` and `docs/status/implementation-status.md`
> are non-substantive for this audit — it adds an explicit "Phase 1 is
> COMPLETE" status header, a P5 two-Job module explanation paragraph, and
> refines the P5-0 dependency-row wording; the module execution order
> `P4 → P5-0 → P3 → P5-N1 → P6`, the P4 dependency row, the Gate 0.5 PENDING
> note, and the 91/81/10 inventory this audit cites are all unchanged.)
> **Authority chain read first:** `AGENTS.md`, `docs/roadmap/phase-roadmap.md`,
> `docs/roadmap/phase3-open-items.md`, `docs/architecture/authorization.md`,
> `docs/status/implementation-status.md`,
> `docs/archive/phase3/p4-mvp-rbac-route-matrix.md` (historical; explicitly
> superseded by the current code — see §1.2).
>
> **Naming note.** This document's "P4" is the **Phase-3 module Job id**
> (`P4 — RBAC MVP role switch`) from `docs/roadmap/phase3-open-items.md`, **not**
> the roadmap's Phase 4 ("Platformization and Integration"). Throughout this
> report "P4" = the Admin/Teacher/Candidate MVP role-switch Job; "Phase 4" =
> platformization. They are unrelated.

---

## 1. Executive Summary

### 1.1 Verdict

```text
READY FOR CORRECTIVE IMPLEMENTATION (small surface)
```

The role-switch migration is **already substantially complete**. The
historical `P3-MOD-P4-1` matrix (`docs/archive/phase3/p4-mvp-rbac-route-matrix.md`,
commit `286e79d`) described a state in which ~57 routes were still on the
legacy `requireRole(["Admin"])` gate and the scope resolvers were "not wired".
**That state is obsolete.** The current code on this branch is:

- **91 route declarations under `apps/api/src/routes/`**; **81 capability/ownership-gated**; **0
  `requireRole` route preHandlers**; **0 `requirePermission` (dead legacy
  layer) route consumers**; **0 `users.role` authority decisions**.
- **Assignment-backed runtime authority is live.** Every capability decision
  reads `ctx.capabilities`, the union of the actor's *active
  `user_role_assignments`* presets (`loadAssignmentAuthority`), resolved at
  authenticate time. `users.role` and the JWT `role` claim are
  non-authoritative compatibility projections only.
- **Resource-aware candidate gates are wired** (R5 in the historical matrix is
  closed): `requireCandidateContext` / `requireExamEligibility` /
  `requireOwnAttempt` / `requireScoreCapability` are real Fastify decorators
  registered on the 10 candidate-runtime + 1 score routes. Ownership is a
  resolver decision (cross-candidate probe → 404 anti-enumeration), not a
  handler role-string branch.
- **Teacher is an enforceable product role.** The Teacher preset (18 perms:
  course/question authoring + exam authoring/lifecycle/enrollment +
  `ScoreAllView` + `ExamResultPublish`, **no grading, no proctor, no user/org
  management**) is granted at runtime when an Admin assigns a Teacher
  assignment. The frontend already shows Teacher a narrower capability-driven
  menu than Admin.

The remaining work is **not** a role migration. It is **product-path closure
and evidence hardening**: (a) the Teacher product path exists via supported
API (`POST /users { role: "Teacher" }` + role picker in `UsersPage`) but is
unproven end-to-end — no E2E, no `loginAsTeacher`; (b) several frontend pages
(Proctor/Grading actions, audit/settings/system pages) have no per-action
client-side capability gate (UX-only, backend-authoritative), and no per-route
capability guard in `AdminLayout`; (c) dead catalog keys and a dead legacy
RBAC module remain; (d) Gate 0.5 (M10-F post-PR-197 rerun) is still PENDING
and blocks future RBAC-sensitive changes.

### 1.2 Headline numbers

| Metric | Value | Evidence |
| --- | --- | --- |
| Route declarations under `apps/api/src/routes/` | **91** | Python-scraped unique `method + path` inventory across `apps/api/src/routes/` (non-test). The full normalized runtime inventory (including any plugin prefix and routes registered outside this directory) is a required output of P4-V0. |
| Capability/ownership-gated routes | **81** | 65 flat `requireCapability` + 5 `requireScopedCapability` + 1 `requireScoreCapability` + 1 `requireCandidateContext` + 3 `requireExamEligibility` + 6 `requireOwnAttempt` |
| Authenticate-only (self/telemetry) | **4** | `/me`, `/me/password`, `/me/profile`, `/client-events` |
| Public (no gate) | **6** | `/register` (disabled endpoint), `/login`, `/logout`, `/settings/branding`, `/system/info`, `/system/public-config` |
| `requireRole` route preHandlers | **0** | `rg preHandler.*requireRole|requireRole(\[` apps/api/src/routes/` (only comment hits remain) |
| `requirePermission` (dead layer) route consumers | **0** | `rg fastify.requirePermission(` apps/api/src/` |
| `ctx.role` / `users.role` authority decisions | **0** | §6.4 role-hardcode sweep — only the dead `requireRole` decorator (`auth.ts:220`) and `reset-admin-password.ts` read role strings; neither is a production route authority |
| Permission catalog size | **71** | `packages/authz/src/catalog.ts` |
| Registry entries | **81** | `ROUTE_PERMISSION_REGISTRY` (`routeRegistry.ts`) |
| Role presets | **6** | Admin / Teacher / Proctor / Grader / Candidate / System (`presets.ts`) |
| P0 gaps (authorization breach) | **0** | §11.1 |
| P1 gaps (MVP role flow incomplete) | **0** | §11.2 (all reclassified to P2) |
| P2 gaps (UX / test / consistency) | **8** | §11.3 (P4-G-01..08) |
| Blocking prerequisite gaps | **1** | §11.4 (P4-B-01 — Gate 0.5 baseline verification pending) |
| OUT-OF-SCOPE | **5** | §11.5 |
| REJECTED | **3** | §11.6 |

### 1.3 Highest-risk findings

1. **Teacher product path is not proven end-to-end.** A Teacher can be created
   by an Admin via `POST /users { role: "Teacher" }` or the role-assignment API
   (`POST /users/:id/role-assignments`), and `UsersPage` exposes a role picker
   including Teacher. The capability model is proven at the API
   unit/integration layer (`examAuthoringCapability`, `questionAuthoringCapability`,
   `permissionMatrix.*`), but the Admin→create-Teacher→Teacher-logs-in→
   Teacher-authors-exams product flow is unproven end-to-end. No E2E, no
   `loginAsTeacher`, no automated evidence of the full product path. (P4-G-01, P2)
2. **Frontend action gating is inconsistent.** `ExamDetailPage` and `ExamPage`
   gate every button on `can(...)`. But `ProctorDashboardPage`,
   `GradingDetailPage`, and ~10 management pages render action buttons purely
   on data/state with no `can(...)` check — they rely on nav visibility + a
   backend 403. Also: no per-route capability guard inside `AdminLayout` —
   direct-URL visits render the page until backend 403. This is a UX/consistency
   gap, not a security breach (backend is authoritative). (P4-G-02, P2)
3. **Gate 0.5 is PENDING.** The M10-F post-PR-197 re-verification is the
   documented blocker for any future RBAC-sensitive change. The route
   inventory in this audit is freshly re-derived from current code, but the
   formal Gate 0.5 closeout has not been re-run. (P4-B-01, blocking)

### 1.4 Recommended Corrective Job count: **5** (P4-V0 + P4-C1 + P4-C2 + P4-C3 + P4-R1)

See §13. The Jobs are small-surface and almost entirely evidence/cleanup, not
a gate migration.

---

## 2. Scope and Non-goals

### 2.1 In scope (this audit answers)

- What is the **current** authorization architecture (not the historical
  `286e79d` state)?
- What can Admin / Teacher / Candidate **actually** do today, with code
  evidence?
- Where are the role / capability / scope / frontend-gating seams?
- What Corrective Jobs does P4 still need?

### 2.2 In scope (P4 product — what the role-switch Job must deliver)

Per `docs/roadmap/phase3-open-items.md` §P4, P4 activates the **final MVP
product-role model** (Admin / Teacher / Candidate) on MVP routes:

- Who may call each MVP API.
- Who may enter each MVP page / see each menu / press each button.
- Who may perform each mutation.
- Who is restricted to their own resources.
- What must be denied.

### 2.3 Out of scope (P4 must NOT do — these are M11 / later Phase)

```text
Proctor product-role activation        (preset exists; product flow is Phase 2+ ops)
independent Grader product-role activation (preset exists; M11 scoped assignment)
ContentManager product role
custom roles                            (Phase 4 platformization)
permission registry UI
Teacher → Course scope                  (M11)
Teacher → Exam scope                    (M11)
Proctor → Exam scope                    (M11)
Grader → Work scope                     (M11)
teacher_exam_assignments / course_staff / exam_proctor / grading_assignment
scope_type / scope_resource_id columns
tenant switcher / organizationSlug login / SuperAdmin / multiTenant
cross-tenant access
```

Findings that would require any of the above are filed as **OUT-OF-SCOPE**
(§11.5) and are **not** P4 blockers.

### 2.4 Audit non-goals (this round)

This round does **not** modify production code, tests, schema, migrations,
capabilities, role presets, frontend navigation, or routes, and does not
implement M11. "Do not audit-and-fix."

---

## 3. Sources Reviewed

### 3.1 Authority documents

- `AGENTS.md` (workspace instructions).
- `docs/roadmap/phase-roadmap.md` (phase-scope authority; the **real** Phase 4
  is platformization — do not confuse with the P4 Job id).
- `docs/roadmap/phase3-open-items.md` (§P4 = this Job; module execution order
  P4 → P5-0 → P3 → P5-N1 → P6).
- `docs/architecture/authorization.md` (as-built authz model; asserts
  91/81/10 — verified by this audit).
- `docs/status/implementation-status.md` (Phase 3 partially implemented; Gate
  0.5 PENDING).
- `docs/archive/phase3/p4-mvp-rbac-route-matrix.md` (historical matrix,
  pre-cutover — **superseded**; used only to confirm what changed).
- `docs/adr/ADR-010-scoped-rbac-architecture.md` (catalog/scope/preset/ADR).

### 3.2 Code areas inspected (file:line evidence throughout §4–§12)

| Area | Path |
| --- | --- |
| Capability catalog | `packages/authz/src/catalog.ts` |
| Role presets | `packages/authz/src/presets.ts` |
| Resolver contract / legacy map | `packages/authz/src/resolver.ts`, `legacyMap.ts` |
| Assignment authority kernel | `apps/api/src/authz/assignmentAuthority.ts` |
| Route registry | `apps/api/src/authz/routeRegistry.ts` |
| Resource-aware capability gates | `apps/api/src/authz/{scopedCapability,scoreCapability,candidateContextCapability,examEligibilityCapability,ownAttemptCapability}.ts` + `apps/api/src/plugins/authz.ts` |
| Resolvers | `apps/api/src/authz/resolvers/{attemptResolver,examEligibilityResolver,ownAttemptResolver,scoreResolver}.ts` |
| Auth plugin (authenticate / gates) | `apps/api/src/plugins/auth.ts` |
| Last-admin guard | `apps/api/src/authz/adminInvariant.ts`, `packages/db/src/lock.ts` |
| Role sync | `apps/api/src/authz/roleSync.ts` |
| Route files (all) | `apps/api/src/routes/*.ts` (24 modules) |
| DB schema | `packages/db/src/schema/pg.ts` |
| Repositories | `packages/db/src/repository/userRoleAssignmentRepo.ts`, `userRepo.ts` |
| Migrations | `packages/db/migrations/postgres/0000..0015` |
| Seed / bootstrap / demo | `packages/db/src/seed.ts`, `demo-seed.ts`, `e2e-seed.ts`, `apps/api/src/scripts/bootstrap-admin.ts` |
| Frontend capability layer | `apps/web/src/lib/capabilities.ts` |
| Frontend auth projection | `apps/web/src/contexts/AuthContext.tsx`, `packages/contracts/src/auth.ts` |
| Frontend navigation | `apps/web/src/components/layout/AppSidebar.tsx`, `AdminLayout.tsx`, `ExamLayout.tsx`, `apps/web/src/App.tsx` |
| Frontend pages (gating) | `apps/web/src/pages/admin/{ExamDetailPage,ExamPage,ProctorDashboardPage,GradingDetailPage,UsersPage,...}.tsx` |
| Tests | `apps/api/src/authz/*.test.ts`, `apps/api/src/routes/*.test.ts`, `apps/web/src/lib/capabilities.test.ts`, `apps/e2e/**` |

---

## 4. Current Authorization Architecture

### 4.1 Layered model (as-built, this branch)

```text
cookie "auth-token"
   │  (verifyJWT)
   ▼
authenticate (plugins/auth.ts:60)
   ├─ load user row (findByOrganizationAndId)
   ├─ if !user.isActive  → 401 AUTH_REQUIRED            (disabled-user rejection)
   ├─ loadAssignmentAuthority(db, ctx, user.id)         (assignmentAuthority.ts)
   │     └─ userRoleAssignmentRepo.listActiveForUser(ctx, userId)
   │     └─ deriveAssignmentAuthority(rows, orgId, userId)
   │           ├─ subject-mismatch → fail closed
   │           ├─ no active assignment → {ok:false, no_active_assignments} → 401
   │           ├─ unknown role / multiple primary / zero primary → fail closed → 503
   │           └─ union of permissionsForRole(role) over active roles → capabilities
   ├─ DB/integrity error → 503 AUTHZ_UNAVAILABLE        (never falls back to users.role)
   └─ request.ctx = { actorId, organizationId, role(primary, compat),
                      roles(active), capabilities(authoritative), permissions([] legacy),
                      sessionId }
        ↓
preHandler gate (one of):
   requireCapability(perm)               flat capability  (65 routes)
   requireScopedCapability(perm,key,id)  capability + resource resolver (5 routes)
   requireScoreCapability()              capability + score ownership (1 route)
   requireCandidateContext(perm)         preset-only candidate gate (1 route)
   requireExamEligibility(perm,id,mode)  capability + exam+enrollment (3 routes)
   requireOwnAttempt(perm,id)            capability + attempt ownership (6 routes)
   non-capability routes:
     - authenticate-only: 4 (self/telemetry)
     - public/disabled: 6 (pre-login branding, public info, disabled register)
        ↓
handler → ensureTargetOrg(getRequestContext(request))    (helpers.ts)
        → repo.method(ctx, ...)                          ctx carries organizationId
```

### 4.2 Authority kernel — assignment-backed, fail-closed

`loadAssignmentAuthority` (`assignmentAuthority.ts:236`) is the single
authoritative source. It loads **all** active assignment rows for the subject
(no `.limit(1)`), then `deriveAssignmentAuthority` validates the exactly-one
active primary invariant, dedupes roles, and unions their preset
permissions. Failure modes (`assignmentAuthority.ts:92-98`):

- `no_active_assignments` → **401** (genuinely not authorized).
- `db_error` / `zero_primary_with_active` / `multiple_primary` /
  `unknown_role` / `subject_mismatch` → **503 AUTHZ_UNAVAILABLE** (operational
  failure, never masquerades as 401, never falls back to `users.role`).

### 4.3 Two permission inventories (migration fact, now resolved)

The historical matrix flagged two parallel inventories: legacy
`ctx.permissions` (from `packages/auth/src/rbac.ts`) and the new preset
capabilities. **Today**:

- `ctx.permissions` is set to `[]` on every runtime context (`auth.ts:172`).
- `requirePermission` (`auth.ts:238`) is the dead legacy decorator — **0
  route consumers** (`rg fastify.requirePermission(`).
- `packages/auth/src/rbac.ts` still exists but has **0 production importers**
  (`rg getPermissionsForRole` outside the legacy file itself returns nothing
  in production code). It is migration residue; its `Role`/`Permission` *types*
  are still imported from `@exam/domain` for compatibility type aliases, but
  its runtime map is unused.

### 4.4 Organization boundary

Single-tenant, one internal default organization. `organizationId` is on
`users`, `user_role_assignments`, and every business table
(`packages/db/src/schema/pg.ts`). Enforcement at three points (all carry
`ctx.organizationId`):

1. `ensureTargetOrg(getRequestContext(request))` at the top of every
   admin/teacher handler (`helpers.ts`).
2. Every repo method receives `ctx` and filters by `organizationId`
   (Repository pattern; architecture lint forbids bare `db.select()` in
   routes).
3. `userRoleAssignmentRepo.listActiveForUser` filters by
   `resolveOrganizationId(ctx)`; the pure authority kernel additionally
   rejects any row whose `(organizationId, userId)` ≠ the request's anchor as
   `subject_mismatch`.

### 4.5 Candidate own-resource boundary

No longer a handler role-string branch. The boundary is a **resolver decision**
inside the resource-aware capability preHandlers:

- `requireOwnAttempt` (`ownAttemptCapability.ts`) resolves the attempt under
  the org anchor and asserts `attempt.owner === actor`. A cross-candidate
  probe returns **404** (anti-enumeration), not 403.
- `requireScoreCapability` (`scoreCapability.ts`) arbitrates `ScoreAllView`
  (any same-org attempt) vs `ScoreOwnView` + ownership. Non-owner + only
  `ScoreOwnView` → **404**.
- `requireExamEligibility` resolves the exam + the candidate profile + the
  enrollment; missing profile/enrollment → 404 (resource_not_found mode) or
  403 (permission_denied mode) per route config.

The historical matrix's R4 ("do not collapse the ownership predicate into a
bare capability") concern is **moot**: ownership *is* the capability layer's
job now, via resolvers. The handler-level `findVisibleAttempt` in `scores.ts`
is explicitly defense-in-depth only (`scores.ts:70-89`), with the old
`ctx.role !== "Candidate"` branch removed.

### 4.6 Disabled-user behavior

`users.isActive` (boolean, no default) is the disabled flag; there is no
separate `status`/`disabled` column. Behavior:

- **Login**: `authenticate` rejects `!user.isActive` with 401 AUTH_REQUIRED
  (`auth.ts:111-115`). The `POST /auth/login` handler additionally rejects
  inactive credentials at the credential-check step.
- **Existing session**: a previously-issued JWT still verifies
  cryptographically, but the next request's `authenticate` loads the user
  row, sees `isActive=false`, and returns 401. No session revocation list is
  needed; the DB row is the truth.
- **Capability resolution**: `countEffectiveActiveUsersWithRole`
  (`userRepo.ts`) and the authority kernel both require
  `users.isActive = true AND assignment.isActive = true`. Flipping
  `users.isActive=false` removes the user from effective authority even if
  their assignment rows remain `is_active=true`.
- **Disable path** (`PATCH /users/:id { isActive: false }`, `user.ts:215`):
  flips only `users.isActive`; assignment rows are **not** deactivated, but
  are shadowed by the user-level flag in every authority read. Self-disable
  is rejected up-front (`CANNOT_DISABLE_SELF`); the mutation runs inside
  `mutateWithEffectiveAdminPostcondition`, so disabling the last effective
  Admin rolls back with `LAST_ACTIVE_ADMIN`.

> **Lifecycle note.** Full account activation/deactivation UI, SMTP password
> reset, and invitation are Phase 3 *future work*
> (`docs/roadmap/phase3-open-items.md` "Staff invitation + SMTP password reset
> + account lifecycle — NOT STARTED"). P4 must not implement lifecycle; it
> only records the current disable-path reality.

---

## 5. Current Role Reality

### 5.1 Admin — **fully usable, all MVP duties**

- Created by `bootstrap-admin.ts` (inserts `users` row + primary active Admin
  assignment **in one transaction**, `:78-96`) or by `POST /users`.
- Holds the **compatibility superset** preset: 58 perms = every Admin-route
  perm + 4 proctor trap perms + all grading perms + score export +
  system/diagnostics. Holds **no** Candidate-own perm and **no**
  System-only perm (`presets-boundaries.test.ts`, `adminCompatibility.test.ts`).
- Can: manage users + role assignments, configure org/system/branding, full
  candidate + candidate-field management, course/question CRUD + import, full
  exam lifecycle (incl. Admin-only `unpublish`/`extend`/`cancel`/`archive`/
  `delete`), enroll candidates, view all scores, export scores, grade, do all
  proctor ops, view audit/import/system diagnostics, send email test.
- Cannot: take an exam (no `ExamTake`), view own score (no `ScoreOwnView`).

### 5.2 Teacher — **enforceable; product path exists but lacks E2E proof**

- **Preset (18 perms)**: `OrganizationView`, `CandidateView`, `CourseView`/
  `Create`/`Update`, `QuestionView`/`Create`/`Update`/`Delete`/`Import`,
  `ExamView`/`Create`/`Update`/`Publish`/`Close`/`ExamResultPublish`/
  `EnrollmentManage`, `ScoreAllView` (`presets.ts:122-142`).
- **Explicitly NOT granted**: any `Grading*`, any proctor perm, `ExamUnpublish`,
  `ExamCancel`, `ExamArchive`, `ExamDelete`, `ExamExtend`, all `User*`-write,
  `Candidate*`-write, all `CandidateField*`, `Settings*`, `AuditLogView`,
  `SystemDiagnosticsView`, `ScoreExport`.
- **Runtime**: Teacher is a real enforceable role. When an Admin assigns a
  Teacher assignment (`POST /users/:id/role-assignments`) or creates a user
  with `role: "Teacher"` (`POST /users`), the next request for that user
  resolves `ctx.capabilities` containing the Teacher preset, and every
  capability gate admits/denies accordingly. The frontend shows Teacher a
  capability-driven menu (Courses, Questions + Import, Exams, Results; no
  Dashboard, Grading, Proctor, or Management section).
- **Product gap**: A Teacher is created through Admin-controlled user creation
  or role-assignment APIs (both supported). `UsersPage` exposes a role picker
  with Teacher as an option. There is **no seed, no demo data, and no E2E**
  that creates or logs in as a Teacher. The Teacher product path is proven at
  the API unit/integration layer (`examAuthoringCapability.test.ts`,
  `questionAuthoringCapability.test.ts`, `permissionMatrix.{exam,question}.test.ts`)
  but **not** end-to-end.

### 5.3 Candidate — **fully usable, own-scope only**

- Created by `POST /candidates` (inserts `users` row + primary active
  Candidate assignment + `candidate_profiles` row in one transaction,
  `candidate.ts:272-306`) or bulk import (`candidate.ts:564-597`).
- **Preset (8 perms)**: `ExamTake`, `AttemptViewOwn`, `AttemptStart`,
  `AttemptAnswerSave`, `AttemptSubmit`, `AttemptRestore`,
  `AttemptHeartbeatSend`, `ScoreOwnView`.
- Can: list/take their own enrolled exams, start/queue, view/take their own
  attempts, save/submit/heartbeat/restore, view their own score (subject to
  `resultVisibility`/`answerVisibility` policy).
- Cannot: any management mutation, any all-scope read, any grading, any
  proctor op, any user/org management. Cross-candidate access → 404
  (anti-enumeration) via the own-attempt/own-score resolvers.

### 5.4 Proctor / Grader / System (context, not P4 product roles)

- **Proctor** (6 perms, exam scope): `ExamRoomView`,
  `AttemptStatusView`/`TimelineView`/`MisconductMark`/`TimeExtend`/
  `ForceSubmit`. Preset exists; proctor **monitoring** routes are implemented
  (`proctorMonitoring.ts`); Proctor-as-assignable-product-role and 3 Proctor
  E2E specs exist. Proctor-as-distinct-product-role activation is Phase 2+
  ops / Phase 3 — **OUT-OF-SCOPE** for P4.
- **Grader** (4 perms, exam scope): `GradingQueueView`/`DetailView`/
  `AnswerView`/`ScoreWrite`. Preset exists; grading routes accept Grader via
  capability. `GradingFinalize`/`GradingIdentityView` are scoped
  (omitted-by-default) and are **not consumed by any route** today — they are
  reserved for M11 scoped grading assignment. **OUT-OF-SCOPE** for P4.
- **System** (3 perms, non-login, non-assignable): `SystemAutoSubmit`,
  `SystemHeartbeatScan`, `SystemLifecycleReconcile`. Bound to synthetic actor
  identities in `deadlineScanner` / `heartbeat` plugins; never reaches the
  assignment-authority path.

---

## 6. Capability Inventory

### 6.1 Catalog — 71 permissions (`packages/authz/src/catalog.ts`)

Grouped by ADR §4 domain: User/Org (11), Candidate (9), Course/Question (9),
Exam lifecycle (12), Candidate runtime (8), Proctor runtime (7), Grading (6),
Scores/Results (3), System/Diagnostics (6). Closed union (typo = compile
error; regression-tested by `catalog-closed-union.test.ts`).

### 6.2 Role preset grant summary (`presets.ts`, verified by
`presets.test.ts` + `presets-boundaries.test.ts`)

| Role | Perms | defaultScope | assignable | loginAllowed |
| --- | ---: | --- | --- | --- |
| Admin | 58 | Organization | yes | yes |
| Teacher | 18 | Course (MVP: org-global — no course-scope table) | yes | yes |
| Proctor | 6 | Exam | yes | yes |
| Grader | 4 | Exam | yes | yes |
| Candidate | 8 | OwnAttempt | yes | yes |
| System | 3 | System | **no** | **no** |

Invariants pinned by tests: Admin = compatibility superset (proctor trap +
grading, no Candidate-own, no System-only); Teacher ⊆ Admin; Teacher is not
Grader/Proctor; Candidate is own-scope only; System is non-login.

### 6.3 Dead / orphan permissions (catalog key with no route consumer)

| Symbol | Canonical | Disposition |
| --- | --- | --- |
| `ResultPublish` | `result.publish` | **Dead.** The live result-publish route uses `ExamResultPublish` (`exam.result.publish`). No route, no grant. (Historical carryover; same finding as the 2026 matrix.) |
| `SystemInfoView` | `system.info.view` | **Dead.** `GET /system/info` is public (no gate); no role needs the perm. |
| `CandidateDelete` | `candidate.delete` | **Orphan.** Granted to Admin; **no `DELETE /candidates/:id` route exists** (only `GET`/`POST`/`PATCH`/`POST /import`). |
| `GradingFinalize` | `grading.finalize` | **Reserved.** Omitted from all human presets by design (scoped). No route consumer; `grade-question` + `finalizeTerminalGrading` is invoked internally without a separate HTTP gate. Owner: M11 scoped grading. |
| `GradingIdentityView` | `grading.identity.view` | **Reserved.** Scoped (double-blind). No route consumer. Owner: M11. |
| `SystemAutoSubmit` / `SystemHeartbeatScan` / `SystemLifecycleReconcile` | `system.*` | **System-only.** Granted only to the non-login System preset; consumed by background scanners, not HTTP routes. Not dead — by design. |

These are severity-P2 cleanup or documentation findings covered by P4-G-04 through P4-G-07. They do not widen runtime access and are not authorization blockers. Reserved M11 capabilities must not be removed by P4-C1.
access.

### 6.4 Capability-name drift

No drift found. Frontend and backend both import `Permission` from
`@exam/authz` (`apps/web/src/lib/capabilities.ts:16` is the sole non-test web
importer). All values are dotted `domain.resource.action`; the legacy
`SCREAMING_SNAKE` map (`legacyMap.ts`) is migration residue with no runtime
consumer.

---

## 7. Backend Route Matrix (MVP routes)

> **Gate legend:** `RC` = flat `requireCapability`; `RSC` = `requireScopedCapability`;
> `RSC-Score` = `requireScoreCapability`; `RCC` = `requireCandidateContext`;
> `REE` = `requireExamEligibility`; `ROA` = `requireOwnAttempt`; `auth` =
> authenticate-only; `pub` = public.
> **Role legend:** ✓ Allow · ✗ Deny · ◐ Own (own-resource only) · — = n/a
> (role has no product entry). All gates read `ctx.capabilities` (assignment-backed
> union). Org anchor + ownership enforced as described in §4.4–4.5.

### 7.1 Auth / self / public (no role gate — out of registry by design)

| Method | Route | Gate | Admin | Teacher | Candidate | Notes |
| --- | --- | --- | :---: | :---: | :---: | --- |
| POST | `/register` | pub | — | — | — | always 403 AUTH_REGISTER_DISABLED; disabled endpoint |
| POST | `/login` | pub | — | — | — | credential check; inactive → 401 |
| POST | `/logout` | pub | — | — | — | clears cookie |
| GET | `/me` | auth | ✓ | ✓ | ✓ | returns role **+ capabilities** |
| PATCH | `/me/password` | auth | ✓ | ✓ | ✓ | self |
| PATCH | `/me/profile` | auth | ✓ | ✓ | ✓ | self; returns capabilities |
| POST | `/client-events` | auth | ✓ | ✓ | ✓ | telemetry, both roles |
| GET | `/settings/branding` | pub | — | — | — | pre-login branding |
| GET | `/system/info` | pub | — | — | — | public info |
| GET | `/system/public-config` | pub | — | — | — | pre-login config |

> **Note:** `/system/health` is capability-gated (`SystemHealthView`), NOT
> public. The original audit incorrectly listed it here. See §7.10 for its
> matrix entry. The total non-capability count is **10** (4 auth-only + 6
> public), confirming 81 + 10 = 91.

### 7.2 Candidate runtime (own-scope — resource-aware gates)

| Method | Route | Gate | Perm | Admin | Teacher | Candidate |
| --- | --- | --- | --- | :---: | :---: | :---: |
| GET | `/candidate/exams` | RCC | `ExamTake` | — | — | ◐ |
| GET | `/candidate/exams/:examId` | REE | `ExamTake` | — | — | ◐ |
| POST | `/attempts/:examId/queue` | REE | `AttemptStart` | — | — | ◐ |
| POST | `/attempts/:examId/start` | REE | `AttemptStart` | — | — | ◐ |
| GET | `/attempts/:id` | ROA | `AttemptViewOwn` | — | — | ◐ |
| GET | `/candidate/attempts/:attemptId/take` | ROA | `AttemptViewOwn` | — | — | ◐ |
| POST | `/attempts/:attemptId/answers/:questionId` | ROA | `AttemptAnswerSave` | — | — | ◐ |
| POST | `/attempts/:attemptId/submit` | ROA | `AttemptSubmit` | — | — | ◐ |
| POST | `/attempts/:attemptId/heartbeat` | ROA | `AttemptHeartbeatSend` | — | — | ◐ |
| POST | `/attempts/:attemptId/restore` | ROA | `AttemptRestore` | — | — | ◐ |

> Admin/Teacher are `—` because they lack `ExamTake` (their product entry is
> the admin endpoints). A multi-role user (e.g. primary Teacher + secondary
> Candidate) **would** be admitted — `ctx.capabilities` is the union. This is
> tested (`assignmentAuthorityRuntime.test.ts` E17/E18/E19).

### 7.3 Scores / results

| Method | Route | Gate | Perm | Admin | Teacher | Candidate |
| --- | --- | --- | --- | :---: | :---: | :---: |
| GET | `/scores/attempts/:attemptId` | RSC-Score | `ScoreOwnView`/`ScoreAllView` | ✓ (any same-org) | ✓ (any same-org, via `ScoreAllView`) | ◐ (own only; cross → 404) |
| GET | `/exams/:id/scores` | RC | `ScoreAllView` | ✓ | ✓ | ✗ |
| GET | `/exams/:id/export/scores` | RC | `ScoreExport` | ✓ | ✗ | ✗ |

### 7.4 Questions (P4-2B — flipped)

| Method | Route | Gate | Perm | Admin | Teacher | Candidate |
| --- | --- | --- | --- | :---: | :---: | :---: |
| GET | `/questions` | RC | `QuestionView` | ✓ | ✓ | ✗ |
| GET | `/questions/:id` | RC | `QuestionView` | ✓ | ✓ | ✗ |
| POST | `/questions` | RC | `QuestionCreate` | ✓ | ✓ | ✗ |
| PATCH | `/questions/:id` | RC | `QuestionUpdate` | ✓ | ✓ | ✗ |
| DELETE | `/questions/:id` | RC | `QuestionDelete` | ✓ | ✓ | ✗ |
| POST | `/questions/import` | RC | `QuestionImport` | ✓ | ✓ | ✗ |

### 7.5 Courses

| Method | Route | Gate | Perm | Admin | Teacher | Candidate |
| --- | --- | --- | --- | :---: | :---: | :---: |
| GET | `/courses` | RC | `CourseView` | ✓ | ✓ | ✗ |
| GET | `/courses/:id` | RC | `CourseView` | ✓ | ✓ | ✗ |
| POST | `/courses` | RC | `CourseCreate` | ✓ | ✓ | ✗ |
| PATCH | `/courses/:id` | RC | `CourseUpdate` | ✓ | ✓ | ✗ |
| DELETE | `/courses/:id` | RC | `CourseDelete` | ✓ | ✗ | ✗ |

### 7.6 Exams — authoring / lifecycle (P4-2C — flipped)

| Method | Route | Gate | Perm | Admin | Teacher | Candidate |
| --- | --- | --- | --- | :---: | :---: | :---: |
| GET | `/exams` | RC | `ExamView` | ✓ | ✓ | ✗ |
| GET | `/exams/:id` | RC | `ExamView` | ✓ | ✓ | ✗ |
| POST | `/exams` | RC | `ExamCreate` | ✓ | ✓ | ✗ |
| PATCH | `/exams/:id` | RC | `ExamUpdate` | ✓ | ✓ | ✗ |
| POST | `/exams/:id/publish` | RC | `ExamPublish` | ✓ | ✓ | ✗ |
| POST | `/exams/:id/close` | RC | `ExamClose` | ✓ | ✓ | ✗ |
| POST | `/exams/:id/publish-results` | RC | `ExamResultPublish` | ✓ | ✓ | ✗ |
| GET | `/exams/:examId/enrollments` | RC | `ExamEnrollmentManage` | ✓ | ✓ | ✗ |
| POST | `/exams/:examId/enrollments` | RC | `ExamEnrollmentManage` | ✓ | ✓ | ✗ |
| DELETE | `/exams/:examId/enrollments/:enrollmentId` | RC | `ExamEnrollmentManage` | ✓ | ✓ | ✗ |
| GET | `/admin/exams/:examId/candidates/status` | RC | `ExamEnrollmentManage` | ✓ | ✓ | ✗ |
| POST | `/exams/:id/unpublish` | RC | `ExamUnpublish` | ✓ | ✗ | ✗ |
| POST | `/exams/:id/extend` | RC | `ExamExtend` | ✓ | ✗ | ✗ |
| POST | `/exams/:id/cancel` | RC | `ExamCancel` | ✓ | ✗ | ✗ |
| POST | `/exams/:id/archive` | RC | `ExamArchive` | ✓ | ✗ | ✗ |
| DELETE | `/exams/:id` | RC | `ExamDelete` | ✓ | ✗ | ✗ |

### 7.7 Candidates / candidate-fields (Admin writes; Teacher read-only CandidateView)

| Method | Route | Gate | Perm | Admin | Teacher | Candidate |
| --- | --- | --- | --- | :---: | :---: | :---: |
| GET | `/candidates` | RC | `CandidateView` | ✓ | ✓ (read-only) | ✗ |
| POST | `/candidates` | RC | `CandidateCreate` | ✓ | ✗ | ✗ |
| PATCH | `/candidates/:id` | RC | `CandidateUpdate` | ✓ | ✗ | ✗ |
| POST | `/candidates/import` | RC | `CandidateImport` | ✓ | ✗ | ✗ |
| *(DELETE /candidates/:id)* | — | `CandidateDelete` | ✓ | ✗ | ✗ | **No route exists** (orphan perm, §6.3) |
| GET | `/candidate-fields` | RC | `CandidateFieldView` | ✓ | ✗ | ✗ |
| POST | `/candidate-fields` | RC | `CandidateFieldCreate` | ✓ | ✗ | ✗ |
| PATCH | `/candidate-fields/:id` | RC | `CandidateFieldUpdate` | ✓ | ✗ | ✗ |
| DELETE | `/candidate-fields/:id` | RC | `CandidateFieldDelete` | ✓ | ✗ | ✗ |
| GET | `/candidate-fields/template` | RC | `CandidateFieldView` | ✓ | ✗ | ✗ |

### 7.8 Attempt admin / proctor (Admin + Proctor; Teacher denied)

| Method | Route | Gate | Perm | Admin | Teacher | Candidate | Proctor |
| --- | --- | --- | --- | :---: | :---: | :---: | :---: |
| POST | `/admin/attempts/:attemptId/misconduct` | RC | `AttemptMisconductMark` | ✓ | ✗ | ✗ | ✓ |
| POST | `/admin/attempts/:attemptId/force-submit` | RC | `AttemptForceSubmit` | ✓ | ✗ | ✗ | ✓ |
| POST | `/admin/attempts/:attemptId/extend-time` | RC | `AttemptTimeExtend` | ✓ | ✗ | ✗ | ✓ |
| GET | `/admin/attempts/:attemptId/timeline` | RC | `AttemptTimelineView` | ✓ | ✗ | ✗ | ✓ |
| GET | `/admin/attempts/:attemptId/export` | RC | `AttemptExport` | ✓ | ✗ | ✗ | ✗ |
| GET | `/admin/attempts/:attemptId/export/csv` | RC | `AttemptExport` | ✓ | ✗ | ✗ | ✗ |
| GET | `/admin/proctor/exams` | RC | `ExamRoomView` | ✓ | ✗ | ✗ | ✓ |
| GET | `/admin/exams/:examId/proctor/attempts` | RSC | `ExamRoomView` | ✓ | ✗ | ✗ | ✓ |
| GET | `/admin/attempts/:attemptId/proctor-events` | RSC | `AttemptTimelineView` | ✓ | ✗ | ✗ | ✓ |
| POST | `/admin/attempts/:attemptId/proctor-incident` | RSC | `AttemptMisconductMark` | ✓ | ✗ | ✗ | ✓ |

### 7.9 Grading (Admin + Grader; Teacher denied by preset)

| Method | Route | Gate | Perm | Admin | Teacher | Candidate | Grader |
| --- | --- | --- | --- | :---: | :---: | :---: | :---: |
| GET | `/admin/grading-queue` | RSC | `GradingQueueView` | ✓ | ✗ | ✗ | ✓ |
| GET | `/admin/attempts/:attemptId/grading-details` | RSC | `GradingDetailView` | ✓ | ✗ | ✗ | ✓ |
| POST | `/admin/attempts/:attemptId/grade-question` | RSC | `GradingScoreWrite` | ✓ | ✗ | ✗ | ✓ |

> Teacher denial on grading is **by preset design**
> (`permissionMatrix.grading.test.ts`, `presets-boundaries.test.ts`).
> Manual grading in the MVP is the separate **Grader** assignment's job
> (multi-role), not a Teacher perm. Independent Grader product-role
> activation is **OUT-OF-SCOPE** (M11).

### 7.10 Users / role assignments / settings / audit / system / import-logs / email (Admin-only)

| Group | Routes | Gate perm(s) | Admin | Teacher | Candidate |
| --- | --- | --- | :---: | :---: | :---: |
| Users (5) | `GET/POST /users`, `PATCH /users/:id`, `POST /users/:id/reset-password`, `DELETE /users/:id` | `UserView/Create/Update/PasswordReset/Delete` | ✓ | ✗ | ✗ |
| Role assignments (5) | `GET /roles/assignable`, `GET/POST /users/:id/role-assignments`, `PATCH/DELETE /role-assignments/:id` | `UserRoleAssign` (+`UserView` on GET list) | ✓ | ✗ | ✗ |
| Settings (3) | `GET /admin/settings`, `GET/PATCH /admin/settings/branding` | `SettingsView`/`SettingsUpdate` | ✓ | ✗ | ✗ |
| Audit (1) | `GET /admin/audit-logs` | `AuditLogView` | ✓ | ✗ | ✗ |
| Import logs (1) | `GET /admin/import-logs` | `AuditLogView` | ✓ | ✗ | ✗ |
| System (3) | `GET /system/health`, `/system/dashboard`, `/system/diagnostics` | `SystemHealthView`/`SystemDiagnosticsView` | ✓ | ✗ | ✗ |
| Email (1) | `POST /email/test` | `SystemDiagnosticsView` | ✓ | ✗ | ✗ |

---

## 8. Frontend Route and Action Matrix

### 8.1 Capability plumbing (fully wired)

`/auth/me`, `/login`, `/me/profile` all return `capabilities: string[]`
(`auth.ts:429-445`, contracts `packages/contracts/src/auth.ts`). The web
stores them verbatim in `AuthContext.user.capabilities`
(`AuthContext.tsx:69-93`). The single capability helper module
`apps/web/src/lib/capabilities.ts` exports `can(user, perm)`
(`capabilities.ts:27`) and per-action predicates; it is the **only** non-test
`@exam/authz` importer in `apps/web/src`. Capabilities are **never** re-derived
client-side from `presetFor(user.role)` — the API array is the single source
(`capabilities.ts:4-13`).

### 8.2 Navigation visibility (sidebar — capability-gated)

`apps/web/src/components/layout/AppSidebar.tsx`. Each `NavItem.visible(user)`
is a `can(...)` predicate; filtering at `AppSidebar.tsx:243-248`. Management
section gated as a block via `canSeeManagement` (set check on
`UserView`/`AuditLogView`/`SettingsView`/`SystemHealthView`/`CandidateFieldView`;
`CandidateView` intentionally excluded so Teacher does not leak —
`capabilities.ts:84-88`).

| Nav item | Route | Permission | Admin | Teacher | Proctor | Grader | Candidate |
| --- | --- | --- | :---: | :---: | :---: | :---: | :---: |
| Dashboard | `/admin/dashboard` | `SystemHealthView` | ✓ | ✗ | ✗ | ✗ | ✗ |
| Courses | `/admin/courses` | `CourseView` | ✓ | ✓ | ✗ | ✗ | ✗ |
| Questions | `/admin/questions` | `QuestionView` | ✓ | ✓ | ✗ | ✗ | ✗ |
| Questions Import | `/admin/questions/import` | `QuestionImport` | ✓ | ✓ | ✗ | ✗ | ✗ |
| Exams | `/admin/exams` | `ExamView` | ✓ | ✓ | ✗ | ✗ | ✗ |
| Grading Queue | `/admin/grading-queue` | `GradingQueueView` | ✓ | ✗ | ✗ | ✓ | ✗ |
| Results | `/admin/results` | `ScoreAllView` | ✓ | ✓ | ✗ | ✗ | ✗ |
| Proctor Workspace | `/admin/proctor` | `ExamRoomView` | ✓ | ✗ | ✓ | ✗ | ✗ |
| Management block | `/admin/{users,candidates,import-logs,audit-logs,settings,candidate-fields,system}` | `UserView`/`AuditLogView`/`SettingsView`/`SystemHealthView`/`CandidateFieldView` | ✓ | ✗ | ✗ | ✗ | ✗ |

Candidate shell (`ExamLayout.tsx`): no sidebar; "My Exams" link only. Admitted
only if the actor holds `ExamTake` (`canAccessExamRuntime`).

### 8.3 Route guards

No `<ProtectedRoute>` / `<RequireRole>` / `<RequireCapability>` wrappers exist.
Guards are inline in the two layouts:

- `AdminLayout.tsx:99-111`: admit if `canAccessAdminConsole(user)` (holds any
  console capability), else redirect to exam runtime or `/login`.
- `ExamLayout.tsx:50-60`: admit if `canAccessExamRuntime(user)` (`ExamTake`),
  else redirect to console or `/login`.
- **No per-route capability guard inside `AdminLayout`.** Every `/admin/*`
  child route is URL-reachable by any user admitted to the console; the
  sidebar hides unauthorized pages, but a direct-URL visit renders the page
  until the backend 403s. (P4-G-02, P2)

### 8.4 Action / button gating ( divergence)

- **Fully gated** (`can(...)` on every action): `ExamDetailPage`
  (publish/close/publish-results/extend/unpublish/archive/cancel/delete/
  enrollment — `ExamDetailPage.tsx:143-152,408-534,695,773`), `ExamPage`
  (create/delete — `ExamPage.tsx:71-72,188,236`), `DateTimeContext`
  (`canSeeSettings`).
- **NOT client-side gated** (rely on nav + backend 403):
  `ProctorDashboardPage` (force-submit/extend/misconduct buttons —
  `ProctorDashboardPage.tsx:486-540`), `GradingDetailPage` (save — `:309`),
  and the management pages (`GradingQueuePage`, `ExamMonitoringPage`,
  `ScoreListPage`, `ResultsOverviewPage`, `QuestionImportPage`,
  `QuestionEditPage`, `AuditLogPage`, `AttemptDetailPage`,
  `CandidateFieldsPage`, `SettingsPage`, `SystemDiagnosticsPage`,
  `ProctorWorkspacePage`).
- **Role-string use** (intentional, domain-object not gate):
  `UsersPage.tsx` role picker (`EditableRole`, `EDITABLE_ROLES`,
  `user.role !== "Candidate"` list filter). The page is reachable only via
  the Admin-only Management nav; mutating endpoints are backend-gated.
- **Dead role helpers**: `isAdmin` is exported (`capabilities.ts:41`) but has
  **no production consumer** (only tests). `isCandidate` is used once for
  landing-path preference (`capabilities.ts:271`).

### 8.5 Frontend gating tests

`apps/web/src/lib/capabilities.test.ts` covers the full per-role nav matrix
(incl. Teacher = authoring/results, not grading/proctor/management), the exam
action matrix, default landing paths, and multi-role shell reachability.
`AuthContext.test.tsx`, `App.test.tsx`, `layout.test.tsx`, `UsersPage.test.tsx`,
`ExamDetailPage.test.tsx`, `ExamPage.test.tsx` reference Teacher.

---

## 9. Role Assignment and Fixture Reality

### 9.1 Authority — single source of truth, dual storage

- **Authoritative**: `user_role_assignments` table
  (`packages/db/src/schema/pg.ts:647-679`). Columns: `id, organizationId,
  userId, role, isPrimary, isActive, createdAt, updatedAt`. CHECK constraint
  `role IN ('Admin','Teacher','Proctor','Grader','Candidate')`. Partial unique
  index `(organizationId, userId) WHERE is_primary=true AND is_active=true`
  (≤1 active primary per user per org, DB backstop).
- **Compatibility cache**: `users.role` (text, **no CHECK**) is still written
  by `roleSync.ts` (mirrors the primary active assignment), bootstrap,
  `POST /users`, candidate create, and migration `0015` step 4. It is
  **non-authoritative**: 0 production authz decisions read it. The last-admin
  postcondition (`countEffectiveActiveUsersWithRole`) and the authority kernel
  both read assignments + `users.isActive`, not `users.role`.
- **NOT present** on `user_role_assignments`: `effectiveFrom`/`revokedAt`/
  `scope_type`/`scope_resource_id`. There is no temporal-validity or scoped
  model; only the boolean `isPrimary`/`isActive` pair. Scope columns are M11.

### 9.2 Default Admin / Candidate creation

- **Admin**: `bootstrap-admin.ts:78-96` inserts `users` (`role:"Admin"`) **and**
  the primary active Admin assignment **in one transaction** —
  authority-complete atomically. Refuses if an active admin already exists
  (assignment-backed check via `countEffectiveActiveUsersWithRole`), `--force`
  to override.
- **Candidate**: `candidate.ts:272-306` (single) and `:564-597` (bulk) create
  `users` + primary active Candidate assignment + `candidate_profiles` in one
  transaction per row.

### 9.3 Teacher creation — supported product path, missing end-to-end evidence

A Teacher is created through Admin-controlled user creation or role-assignment
APIs: `POST /users { role: "Teacher" }` (writes the user row + primary active
Teacher assignment + calls `roleSync`) or `POST /users/:id/role-assignments`.
Both product paths exist and are supported. No seed, demo, or E2E data
currently creates a Teacher (`seed.ts`, `demo-seed.ts`, `e2e-seed.ts` define
only admin + candidate(s)). The full product path (Admin → create/assign →
Teacher logs in → authors) is therefore **unproven end-to-end**. (P4-G-01)

### 9.4 Test fixture reality

Tests create Teacher/Proctor/Grader via `createAssignedUserForTest`
(`apps/api/src/routes/testHelpers.ts:367-414`): direct DB insert of `users` +
primary active assignment + JWT sign — **not** via the role-assignment API or
login. There is no `loginAsTeacher` E2E helper. The real product flow is not
exercised by tests. (P4-G-01)

---

## 10. Test Coverage Matrix

| Coverage area | Status | Evidence |
| --- | --- | --- |
| Admin positive authz (no regression) | ✅ COVERED | `adminSuperset.test.ts`, `adminCompatibility.test.ts`, every route happy-path test |
| Teacher positive — question CRUD + import | ✅ COVERED | `questionAuthoringCapability.test.ts:55-142`, `permissionMatrix.question.test.ts` |
| Teacher positive — exam authoring/lifecycle/publish/close/publish-results/enrollment | ✅ COVERED | `examAuthoringCapability.test.ts:113-348`, `permissionMatrix.exam.test.ts` |
| Teacher negative — grading | ✅ COVERED | `permissionMatrix.grading.test.ts` |
| Teacher negative — proctor | ✅ COVERED | `permissionMatrix.proctor.test.ts` |
| Teacher negative — users/role-assignments (10 routes) | ✅ COVERED | `permissionBoundary.test.ts:913-923` |
| Teacher negative — candidate-fields/settings/system/audit/email/candidates (17 routes) | ✅ COVERED | `m10dPermissionBoundary.test.ts` (68-cell matrix) |
| Teacher negative — Admin-only exam lifecycle (unpublish/extend/cancel/archive/delete) | ✅ COVERED | `examAuthoringCapability.test.ts:349-371`, `permissionBoundary.test.ts:365-375` |
| Candidate cross-candidate attack → 404 | ✅ COVERED | `candidateOwnership.test.ts:148-227`, `m10a.candidateRuntime.test.ts:257-342`, `scores.test.ts:1247` |
| Candidate denied on admin routes → 403 | ✅ COVERED | `permissionBoundary.test.ts`, `m10dPermissionBoundary.test.ts`, `system/audit/user.test.ts` |
| Disabled-user login rejection (isActive=false → 401) | ✅ COVERED (Admin only) | `auth.test.ts:249-323`. Role-agnostic logic; no dedicated disabled-Teacher/Candidate test. |
| Organization boundary (synthetic 2nd org) | ✅ COVERED | `candidateOwnership.test.ts:345-823` (full cross-org block + zero side-effect), `tenant-isolation.test.ts`, `proctorMonitoring.crossOrg.test.ts` |
| Assignment-backed authority (stale users.role, stale JWT, grant/revoke, inactive, multi-role union, fail-closed) | ✅ COVERED | `assignmentAuthorityRuntime.test.ts` E1–E19, `assignmentAuthority.test.ts` |
| Last-admin guard | ✅ COVERED | `adminInvariant.test.ts` (disable/delete/deactivate last Admin rejected; concurrent serialization) |
| Frontend navigation gating | ✅ COVERED | `apps/web/src/lib/capabilities.test.ts` |
| E2E — Teacher | ❌ MISSING | No `loginAsTeacher`; no Teacher-driven UI/navigation/authoring E2E. (P4-G-03) |
| Whole-app scan for residual `requireRole` routes | ❌ MISSING | `routeRegistryConformance.test.ts` asserts zero role handlers only on enumerated M10-B/C/D route sets, not globally. (P4-G-08) |

---

## 11. Gap Register

### 11.1 P0 — Authorization breach

```text
(none)
```

No P0 found. The assignment-backed fail-closed authority, the org anchor, and
the resolver-enforced own-resource boundary (cross-candidate → 404) are all
live and tested. No route reads `users.role` or the JWT `role` claim for
authority. No management mutation is reachable by Candidate/Teacher beyond
their preset. No unauthenticated path reaches a protected route.

### 11.2 P1 — MVP role flow incomplete

```text
(none)
```

All previously-classified P1 gaps have been reclassified to P2 (see §11.3).
The Teacher product path exists (`POST /users { role: "Teacher" }` + role
picker in `UsersPage`) but is not proven end-to-end; the frontend action
gating inconsistency is UX-only with authoritative backend enforcement. These
are evidence/consistency gaps, not product-path breaks.

### 11.3 P2 — UX / test / consistency gaps

#### P4-G-01 — Teacher product path is not proven end-to-end

- **Area**: Role assignment product path / E2E.
- **Evidence**: `UsersPage` exposes a role picker with Teacher as an option;
  `POST /users { role: "Teacher" }` and `POST /users/:id/role-assignments`
  both create a Teacher with a real assignment row. `seed.ts`, `demo-seed.ts`,
  `e2e-seed.ts` define only admin + candidate(s); no `"Teacher"` in any
  seed/demo/e2e. `apps/e2e/lib/login.ts` has `loginAsAdmin`/`loginAsCandidate`
  but **no** `loginAsTeacher`. Tests create Teacher via direct DB insert
  (`testHelpers.ts:367-414`), not the real flow.
- **Current behavior**: A Teacher **can** be created by an Admin via the
  supported `POST /users` or role-assignment API. The capability model is
  proven at the API unit/integration layer. The full product path (Admin
  creates Teacher → Teacher logs in → Teacher authors exam → publishes →
  views results) is **not** proven end-to-end — no E2E, no `loginAsTeacher`.
- **Expected behavior**: E2E evidence that the Admin→Teacher→authoring flow
  works through the real product interfaces (API or UI).
- **Impact**: P4's acceptance boundary ("Admin/Teacher/Candidate each complete
  their MVP duties") is not evidenced end-to-end, only at the API layer.
- **Likely correction boundary**: E2E only — **no** capability / preset /
  route / schema change. Do NOT add a default demo Teacher seed.
- **Dependencies**: P4-G-02 (consistent Teacher UX).
- **Status**: OPEN → P4-C3.

#### P4-G-02 — Frontend action gating inconsistency (Proctor/Grading/management pages)

- **Area**: Frontend action gating.
- **Evidence**: `ExamDetailPage`/`ExamPage` gate every button on `can(...)`;
  `ProctorDashboardPage` (force-submit/extend/misconduct), `GradingDetailPage`
  (save), and ~10 management pages render action buttons on data/state with
  **no** `can(...)` check (`apps/web/src/pages/admin/*`). No per-route
  capability guard inside `AdminLayout` — direct-URL visits render the page
  until backend 403.
- **Current behavior**: Buttons render for any user admitted to the console
  who reaches the page by URL; click → backend 403. Backend is authoritative.
- **Expected behavior**: Route-level capability guard for `/admin/*` pages
  (direct-URL → 403 or redirect); per-action `can(...)` only on pages where
  multiple distinct capabilities govern different buttons (e.g.
  `ExamDetailPage`).
- **Impact**: UX inconsistency; not a security breach (backend authoritative).
- **Likely correction boundary**: Frontend only — route metadata +
  `AdminLayout` guard; per-action gating on `ExamDetailPage` (already done).
  No backend change.
- **Dependencies**: none.
- **Status**: OPEN → P4-C2.

#### P4-G-03 — No E2E negative-authorization for the three-role world

- **Area**: E2E.
- **Evidence**: 18 E2E specs; only Admin, Candidate, and Proctor are
  exercised. No Teacher E2E (positive or negative). Blocking specs are all
  Candidate-runtime. No E2E proves Candidate is denied an admin route or
  Teacher is denied a grading/admin route at the UI→API boundary.
- **Current behavior**: Three-role authorization is proven only at the API
  layer.
- **Expected behavior**: At least one E2E proving Candidate denied ← admin
  route and Teacher denied ← grading/admin route at the UI→API boundary.
- **Impact**: Lower confidence that a frontend regression won't silently
  expose admin surface to Candidate/Teacher.
- **Likely correction boundary**: E2E only.
- **Dependencies**: P4-G-01 (Teacher fixture).
- **Status**: OPEN → P4-C3.

#### P4-G-04 — Dead catalog permissions (`ResultPublish`, `SystemInfoView`, `CandidateDelete`)

- **Area**: Capability catalog hygiene.
- **Evidence**: `catalog.ts` §6.3. `ResultPublish` (`result.publish`) — no
  route, no grant (live route uses `ExamResultPublish`). `SystemInfoView` —
  `/system/info` is public. `CandidateDelete` — granted to Admin but **no
  `DELETE /candidates/:id` route**.
- **Current behavior**: Dead keys confuse readers; `CandidateDelete` grants a
  perm with no enforcement surface (no widening — there is no route to call).
- **Expected behavior**: Either remove the dead keys or document them as
  reserved with an owner.
- **Impact**: None at runtime; consistency / future-mistake risk.
- **Likely correction boundary**: `packages/authz/src/catalog.ts` +
  `presets.ts` (remove `CandidateDelete` from Admin, remove `ResultPublish`/
  `SystemInfoView` or mark reserved). Test update.
- **Dependencies**: none.
- **Status**: OPEN → P4-C1.

#### P4-G-05 — Reserved grading perms (`GradingFinalize`, `GradingIdentityView`) have no route consumer

- **Area**: Catalog / M11 boundary.
- **Evidence**: §6.3. Both are scoped-by-default (omitted from human presets);
  no route consumes them. `grade-question` + `finalizeTerminalGrading` runs
  without a separate HTTP gate.
- **Current behavior**: Reserved keys for future M11 scoped grading.
- **Expected behavior**: Documented as M11-reserved (not P4 work).
- **Impact**: None.
- **Likely correction boundary**: Documentation only.
- **Dependencies**: M11.
- **Status**: OPEN (documentation) → P4-C1 note; implementation is OUT-OF-SCOPE.

#### P4-G-06 — Legacy RBAC residue (`packages/auth/src/rbac.ts`, `legacyMap.ts`, dead `requirePermission` decorator)

- **Area**: Migration residue.
- **Evidence**: `packages/auth/src/rbac.ts` has **0 production importers** of
  its runtime map; `legacyMap.ts` has no runtime consumer; `requirePermission`
  (`auth.ts:238`) has **0 route consumers**. `packages/auth/src/rbac.test.ts`
  still asserts the **legacy** map (`getPermissionsForRole("Teacher")` → `[]`),
  contradicting the real `@exam/authz` Teacher preset.
- **Current behavior**: Dead code; the legacy test is misleading.
- **Expected behavior**: Remove or explicitly mark as migration-residue-only;
  delete or rewrite the legacy `rbac.test.ts` assertion.
- **Impact**: Reader confusion; test contradiction. No runtime authority.
- **Likely correction boundary**: `packages/auth/` + `auth.ts` decorator +
  test. Type re-exports from `@exam/domain` may need to stay for compatibility.
- **Dependencies**: none.
- **Status**: OPEN → P4-C1.

#### P4-G-07 — `users.role` dual storage (compatibility cache) not deprecated

- **Area**: Schema / migration hygiene.
- **Evidence**: §9.1. `users.role` is still written by `roleSync.ts`,
  bootstrap, `POST /users`, candidate create, migration `0015`. It is
  non-authoritative but maintained.
- **Current behavior**: Dual storage (assignments authoritative, `users.role`
  mirror cache). No authz decision reads `users.role`.
- **Expected behavior**: Either keep the documented "migration window" cache
  or plan deprecation. Not a P4 blocker either way.
- **Impact**: None at runtime (assignments are authoritative).
- **Likely correction boundary**: Documentation, or a future deprecation Job
  (drop `users.role` writes + column). **Not** P4 scope to deprecate.
- **Dependencies**: none.
- **Status**: OPEN (documentation) → noted in P4-C1; deprecation is a later
  decision.

#### P4-G-08 — `routeRegistryConformance.test.ts` does not globally assert "0 requireRole routes"

- **Area**: Test conformance.
- **Evidence**: The conformance test asserts zero role handlers only on the
  enumerated M10-B/C/D route sets, not a whole-app scan. There is no
  regression test that fails if a new route is added with `requireRole`.
- **Current behavior**: A future route could re-introduce `requireRole`
  without a test failure.
- **Expected behavior**: A whole-app structural assertion (e.g. "0 route
  preHandlers carry `_isRequireRole`") to lock the migration.
- **Impact**: Regression risk for future RBAC-sensitive changes.
- **Likely correction boundary**: Test only (`apps/api/src/authz/`).
- **Dependencies**: none.
- **Status**: OPEN → P4-C1.

#### P4-G-09 — Gate 0.5 (M10-F post-PR-197 rerun) still PENDING

- **Area**: Process / verification.
- **Evidence**: `docs/status/implementation-status.md` Known limitations;
  `docs/architecture/authorization.md` Gate 0.5 caveat. The route inventory
  in this audit is freshly re-derived from current code, but the formal Gate
  0.5 closeout has not been re-run.
- **Current behavior**: Future RBAC-sensitive changes are blocked until Gate
  0.5 is re-run.
- **Expected behavior**: Gate 0.5 re-run and closed, or this audit's
  fresh inventory accepted as the new baseline.
- **Impact**: Process blocker for P4-C Jobs that touch RBAC.
- **Likely correction boundary**: Re-run the M10-F verification harness;
  documentation.
- **Dependencies**: none (process).
- **Status**: OPEN → P4-C1.

### 11.4 Blocking prerequisite

#### P4-B-01 — Gate 0.5 (M10-F post-PR-197 rerun) still PENDING

- **Area**: Process / verification.
- **Evidence**: `docs/status/implementation-status.md` Known limitations;
  `docs/architecture/authorization.md` Gate 0.5 caveat. The route inventory
  in this audit is freshly re-derived from current code, but the formal Gate
  0.5 closeout has not been re-run.
- **Current behavior**: Future RBAC-sensitive changes are blocked until Gate
  0.5 is re-run.
- **Expected behavior**: Gate 0.5 re-run and closed, with the route inventory
  formally accepted as the baseline.
- **Impact**: Process blocker for P4-C Jobs that touch RBAC. P4-V0 must pass
  before any RBAC-sensitive cleanup begins.
- **Likely correction boundary**: Re-run the M10-F verification harness;
  documentation.
- **Dependencies**: none (process).
- **Status**: OPEN → P4-V0.

### 11.5 OUT-OF-SCOPE (M11 / later Phase — not P4 blockers)

- **P4-OOS-01** — Teacher→Course / Teacher→Exam / Proctor→Exam / Grader→Work
  resource scope (M11). No junction tables, no `scope_type`/`scope_resource_id`
  columns. "Teacher global" today means org-global within the authenticated
  organization.
- **P4-OOS-02** — Proctor product-role activation (preset exists; product
  flow is Phase 2+ ops).
- **P4-OOS-03** — Independent Grader product-role activation (preset exists;
  M11 scoped assignment).
- **P4-OOS-04** — Custom roles / permission registry UI / SuperAdmin /
  multiTenant / tenant switcher / organizationSlug login / cross-tenant
  access (Phase 4 platformization).
- **P4-OOS-05** — Staff invitation / SMTP password reset / account lifecycle
  UI (Phase 3 future work, separate from P4 per `phase3-open-items.md`).

### 11.6 REJECTED (audit assumption not supported by code)

- **P4-REJ-01** — "Candidate management is Admin-only for writes." **Partially
  rejected**: Teacher holds `CandidateView` (read-only list/detail). This is
  the documented preset (`presets.ts:124`) and the route admits Teacher for
  `GET /candidates`. Teacher is denied `CandidateCreate/Update/Import/Delete`.
  The read-grant is intentional, not a gap.
- **P4-REJ-02** — "Teacher cannot publish/close/publish-results" (from the
  2026 matrix's open product questions). **Rejected**: the preset grants
  `ExamPublish`/`ExamClose`/`ExamResultPublish` to Teacher; routes are flipped;
  `examAuthoringCapability.test.ts` proves Teacher ALLOW. The historical
  "TEACHER_ALLOW" decision is now codified.
- **P4-REJ-03** — "Scope resolvers not wired (R5)". **Rejected**: the
  resource-aware decorators (`requireScopedCapability`,
  `requireScoreCapability`, `requireCandidateContext`, `requireExamEligibility`,
  `requireOwnAttempt`) are registered in `plugins/authz.ts` and consumed by the
  candidate-runtime, score, proctor, and grading routes. R5 is closed.

---

## 12. Target MVP Role Matrix (frozen)

> Vocabulary: **ALLOW** = role may access all in-org resources the capability
> permits · **DENY** = backend rejects · **OWN** = role may access only their
> own resources · **N/A** = role has no product entry · **UNRESOLVED** = needs
> product decision.

| Area | Action | Capability | Admin | Teacher | Candidate | Scope |
| --- | --- | --- | --- | --- | --- | --- |
| User mgmt | list/create/edit/delete users | `UserView/Create/Update/Delete` | ALLOW | DENY | DENY | org_global |
| User mgmt | reset password | `UserPasswordReset` | ALLOW | DENY | DENY | org_global |
| Role assignment | list assignable / assign / promote / deactivate / remove | `UserRoleAssign` (+`UserView`) | ALLOW | DENY | DENY | org_global |
| Org settings | view/update settings + branding | `SettingsView`/`SettingsUpdate` | ALLOW | DENY | DENY | org_global |
| Candidate fields | view/create/update/delete/template | `CandidateField*` | ALLOW | DENY | DENY | org_global |
| Candidates | list | `CandidateView` | ALLOW | **ALLOW** (read-only) | DENY | org_global |
| Candidates | create/update/import | `CandidateCreate/Update/Import` | ALLOW | DENY | DENY | org_global |
| Courses | view/create/update | `CourseView/Create/Update` | ALLOW | ALLOW | DENY | org_global |
| Courses | delete | `CourseDelete` | ALLOW | DENY | DENY | org_global |
| Questions | view/create/update/delete/import | `QuestionView/Create/Update/Delete/Import` | ALLOW | ALLOW | DENY | org_global |
| Exams | view/create/update | `ExamView/Create/Update` | ALLOW | ALLOW | DENY | org_global |
| Exams | publish / close / publish-results | `ExamPublish`/`ExamClose`/`ExamResultPublish` | ALLOW | ALLOW | DENY | org_global |
| Exams | enrollments list/add/remove/status | `ExamEnrollmentManage` | ALLOW | ALLOW | DENY | org_global |
| Exams | unpublish / extend / cancel / archive / delete | `ExamUnpublish`/`ExamExtend`/`ExamCancel`/`ExamArchive`/`ExamDelete` | ALLOW | DENY | DENY | org_global |
| Grading | queue / detail / score-write | `GradingQueueView`/`DetailView`/`ScoreWrite` | ALLOW | DENY | DENY | org_global (Grader role for scoped) |
| Proctor | discover / attempts / events / incident / misconduct / force-submit / extend-time / timeline / export | `ExamRoomView`/`Attempt*` | ALLOW | DENY | DENY | org_global (Proctor role for scoped) |
| Results | view all scores | `ScoreAllView` | ALLOW | ALLOW | DENY | org_global |
| Results | export scores | `ScoreExport` | ALLOW | DENY | DENY | org_global |
| Results | publish | `ExamResultPublish` | ALLOW | ALLOW | DENY | org_global |
| Audit / import-logs / system / diagnostics / email-test | view / send | `AuditLogView`/`SystemHealthView`/`SystemDiagnosticsView` | ALLOW | DENY | DENY | org_global |
| Candidate runtime | list own exams / start / take / save / submit / heartbeat / restore | `ExamTake`/`Attempt*` | N/A | N/A | **OWN** | own_attempt |
| Candidate result | view own score | `ScoreOwnView` | N/A | N/A | **OWN** | own_score |
| Cross-candidate access | read/submit/grade another's attempt/score | — | N/A | N/A | **DENY (404)** | — |

**Unresolved product decisions:**

```text
UNRESOLVED-P4-01: Should the catalog dead keys (ResultPublish, SystemInfoView,
                  CandidateDelete) be removed or kept as reserved? (P4-G-04)
```

No role-matrix ambiguity remains — every MVP route has a frozen Admin/Teacher/
Candidate verdict backed by preset + flipped gate + test evidence.

---

## 13. Corrective Job Plan (advisory split — not implemented this round)

> Each Job is small-surface and scoped by responsibility. No "fix all RBAC"
> monolith. Each lists target, Gap IDs, allowed scope, forbidden scope,
> dependencies, acceptance boundary.
>
> Execution order is a hard constraint:
>
> ```text
> P4-V0 (Gate 0.5 baseline)
>   → P4-C1 (cleanup)
>   → P4-C2 (frontend)
>   → P4-C3 (three-role E2E)
>   → P4-R1 (closeout)
> ```
>
> P4-V0 is a **blocking preflight** — no RBAC-sensitive change starts before
> Gate 0.5 PASS. P4-C1/C2/C3 are independent of each other but all depend on
> P4-V0. P4-R1 is the final re-audit and depends on C1..C3.

### P4-V0 — Gate 0.5 Baseline Verification

- **Target**: Establish the pre-change RBAC baseline. Resolve the route-count
  inventory; formally re-run M10-F / Gate 0.5.
- **Gap IDs**: P4-B-01 (Gate 0.5 PENDING).
- **Allowed scope**: Verification only — run the M10-F harness, produce a
  unique route inventory, confirm `0 requireRole`, confirm registry ↔ runtime
  alignment. No production code change.
- **Forbidden scope**: Any code change, preset, route, frontend, schema.
- **Dependencies**: None.
- **Acceptance boundary**: Gate 0.5 re-run **PASS**; the unique route
  inventory (91/81/10) is formally accepted as the baseline. Only then may
  RBAC-sensitive cleanup (P4-C1) begin.

### P4-C1 — Authorization Residue Cleanup and Regression Lock

- **Target**: Remove proven-dead migration residue; lock the migration with a
  global structural test; document intentionally reserved capabilities.
- **Gap IDs**: P4-G-04, P4-G-05, P4-G-06, P4-G-07, P4-G-08.
- **Allowed scope**:
  - **Remove** (proven dead, 0 consumer): `ResultPublish` catalog key (live
    route uses `ExamResultPublish`); `requirePermission` decorator from
    `auth.ts`; `packages/auth/src/rbac.ts` runtime map + its misleading
    `rbac.test.ts` legacy assertions.
  - **Document** (reserved, not P4 to delete): `GradingFinalize` /
    `GradingIdentityView` → M11 scoped grading; `SystemAutoSubmit` /
    `SystemHeartbeatScan` / `SystemLifecycleReconcile` → System actor only.
  - **Unresolved** (needs product decision, not P4 to delete): `CandidateDelete`
    (no route today; may be planned or dead); `SystemInfoView` (public route
    today; may become gated later).
  - **Add**: whole-app "0 `requireRole` routes" structural assertion in
    `routeRegistryConformance.test.ts` (to catch future regressions).
  - **Document**: `users.role` compatibility-projection policy.
- **Forbidden scope**: Route gates, frontend, schema, new capabilities, role
  preset grants to human roles, M11, deletion of `CandidateDelete` /
  `SystemInfoView` / `GradingFinalize` / `GradingIdentityView`.
- **Dependencies**: P4-V0 PASS.
- **Acceptance boundary**: `pnpm verify` green; new conformance assertion
  passes; no behavior change for any live route; dead-perm removal only
  affects keys with 0 route consumers.

### P4-C2 — Frontend Capability Route and Action Gating

- **Target**: Establish route-level capability guards for `/admin/*` pages;
  apply per-action `can(...)` only where a page has multiple distinct
  capability-governed actions.
- **Gap IDs**: P4-G-02.
- **Allowed scope**: `apps/web/src/components/layout/AdminLayout.tsx` (add
  route-level capability metadata + guard); `apps/web/src/pages/admin/`
  (per-action gating on pages with multiple distinct capabilities, e.g.
  `ExamDetailPage` already done). **Principle**: route-level guard first;
  per-action only where needed.
- **Forbidden scope**: Backend, capability catalog, role presets, schema,
  Proctor/Grader product-role activation.
- **Dependencies**: P4-V0. Independent of P4-C1.
- **Acceptance boundary**: Direct-URL `/admin/*` access by an unauthorized
  role shows 403 or redirects to the user's default landing page (not a
  partially-rendered page); `pnpm verify` green; `exam-ui/*` lint green.

### P4-C3 — Three-Role Product-Path and E2E Evidence

- **Target**: Prove the Admin/Teacher/Candidate product path end-to-end with
  real API/UI interactions.
- **Gap IDs**: P4-G-01, P4-G-03.
- **Allowed scope**: `apps/e2e/**` — add `loginAsTeacher` helper; Admin
  creates Teacher through a supported product interface (`POST /users` or
  role-assignment API, not direct DB insert); Teacher logs in via real login
  flow; Teacher sees the expected navigation capability-driven menu; Teacher
  performs a representative *already-supported* objective-question authoring
  and exam lifecycle path (no P2-1 text_response/rubric authoring); Teacher
  is rejected from grading, users, and diagnostics; Candidate is rejected
  from the admin console and management APIs. E2E test-fixture-only Teacher
  creation is acceptable (via real API, not DB insert). **No** default demo
  Teacher seed.
- **Forbidden scope**: `packages/db/src/demo-seed.ts` (no default Teacher
  account); `packages/db/src/e2e-seed.ts` (E2E fixture creates Teacher via
  API, not seed); schema, capability, preset, route changes; Proctor/Grader
  product-role activation; text_response/rubric authoring P2-1 flow; verifying
  manual/after_grading result visibility, answerVisibility, or standard-answer
  leak (these are P3).
- **Dependencies**: P4-V0. P4-C2 (clean Teacher UX) is desired but not a hard
  blocker.
- **Acceptance boundary**: Three-role E2E passes; the three named blocking
  specs still pass; Admin→Teacher→authoring→publish→results proven through
  the real product interface (objective-question only; result surface is
  the permitted API, not P3 publication strategy).

### P4-R1 — Final Independent Re-audit and Closeout

- **Target**: Re-audit after P4-C1..C3; re-run Gate 0.5; produce the P4
  closure record.
- **Gap IDs**: All.
- **Allowed scope**: Verification harness run; full route inventory; Gate 0.5
  re-run; full authorization tests; relevant frontend tests; new three-role
  E2E; `pnpm verify`; documentation.
- **Forbidden scope**: Any production change.
- **Dependencies**: P4-C1, P4-C2, P4-C3 closed.
- **Acceptance boundary**: Gate 0.5 PASS; 0 P0; 0 blocking P1; accepted P2
  documented; P3 handoff contract frozen; `pnpm verify` green; three-role E2E
  green. Closure record may state **P4 CLOSED** when all criteria pass.

---

## 14. P3 Handoff Contract

When P4 (the role-switch Job) closes, it hands the following to **P3
(result-publishing closeout)** — P3 verifies the result flow under the final
role model; it does **not** re-decide the matrix:

```text
result.publish owner:
    ExamResultPublish (exam.result.publish) — the canonical capability.
    Granted to: Admin, Teacher. Route: POST /exams/:id/publish-results
    (requireCapability, Exam scope). DEAD key ResultPublish (result.publish)
    is NOT an owner (P4-G-04 cleanup).

result.readAny owner (admin/teacher all-score view):
    ScoreAllView (score.all.view). Granted to: Admin, Teacher.
    Route: GET /exams/:id/scores.

result.readOwn behavior (candidate own-score view):
    ScoreOwnView (score.own.view) + own-attempt ownership arbitration via
    requireScoreCapability. Route: GET /scores/attempts/:attemptId.
    Candidate may view only their own attempt's score; cross-candidate → 404
    (anti-enumeration). Admin/Teacher with ScoreAllView see any same-org
    attempt. resultVisibility / answerVisibility policy still applies
    (P3 verifies the leak boundary).

result.export owner:
    ScoreExport (score.export). Granted to: Admin ONLY (Teacher denied).
    Route: GET /exams/:id/export/scores.

Admin / Teacher / Candidate route expectations for the result flow:
    Admin:    publish-results ✓, view all scores ✓, export ✓, view any attempt score ✓.
    Teacher:  publish-results ✓, view all scores ✓, export ✗, view any attempt score ✓.
    Candidate: publish-results ✗, view all scores ✗, export ✗, view OWN score only ✓.

Stable transaction / route boundary for P5-N1:
    The result-publication command and the GET /scores/attempts/:attemptId
    route are the seams P5-N1 extends. P4 does not change result semantics;
    P3 closes the publication flow and leak tests under this role model.
```

P3 is responsible for `resultVisibility`/`answerVisibility` E2E, manual /
`after_grading` publication, and standard-answer leak tests — **not** for
re-deciding who holds `ExamResultPublish` / `ScoreAllView` / `ScoreOwnView`.

---

## 15. Final Recommendation

```text
READY FOR CORRECTIVE IMPLEMENTATION
```

The role-switch migration itself is substantially complete (91 route declarations under `apps/api/src/routes/`, 81 capability-gated,
0 `requireRole`, assignment-backed authority, resource-aware candidate gates
wired, Teacher preset enforceable, frontend capability-driven). The remaining
P4 work is **product-path closure and evidence/cleanup** (P4-V0, P4-C1, P4-C2,
P4-C3, P4-R1), not a gate migration. The 3 former-P1 gaps are reclassified as
P2: the Teacher product path exists via supported API but is unproven
end-to-end; the frontend action gating is UX-only with authoritative backend
enforcement. There are **0 P1 gaps** and **0 P0 gaps**. Gate 0.5 must be
re-run as the **blocking preflight** P4-V0 — no RBAC-sensitive change starts
before it passes.

This report does **not** say "P4 CLOSED". P4-R1 may declare P4 CLOSED when
all closure criteria pass (0 P0, 0 blocking P1, accepted P2 documented, Gate
0.5 PASS, P3 handoff frozen).

---

## Appendix A — Verification commands and results

All commands run on branch `feat/rbac-reality-audit` (clean working tree at
start). This is a docs-only round; no production code was modified.

| Command | Result |
| --- | --- |
| `git diff --check` | **pass** — no whitespace/conflict-marker errors. |
| `pnpm format:check` | **pass** — "All matched files use Prettier code style!" |
| `rg fastify.<verb>( apps/api/src/routes/` (non-test) | **91** route declarations. |
| `rg preHandler.*requireRole\|requireRole(\[` (routes, non-test) | **0** (only comment hits in `user.ts`, `roleAssignments.ts`). |
| `rg fastify.requirePermission(` (non-test) | **0** — dead legacy layer confirmed unused. |
| `rg fastify.requireCapability\(` (routes, non-test, count) | **65** flat capability gates. |
| `rg fastify.require(Scoped\|Score\|CandidateContext\|ExamEligibility\|OwnAttempt)` (routes, non-test) | **5 + 1 + 1 + 3 + 6 = 16** resource-aware gates. |
| `rg ctx\.role ===\|user\.role ===\|roles\.includes\|isAdmin` (apps/api, non-test, non-comment) | Only `auth.ts:220` (dead `requireRole` decorator) + `reset-admin-password.ts:67` (assignment check). **0** production route authority decisions on role strings. |
| `rg getPermissionsForRole` (production, excluding `packages/auth/src/rbac.ts`) | **0** — legacy RBAC map has no production importer. |
| Registry entry count (`ROUTE_PERMISSION_REGISTRY`) | **81**. |
| `docker ps exam-db-1` | Up 3 days (healthy) — used only to confirm test infra availability. |

> `pnpm lint:docs` / `pnpm verify:docs` are **not defined** in `package.json`
> (verified) — this round ran `git diff --check` + `pnpm format:check` per the
> task's docs-only verification requirement.
>
> **Live authorization test evidence** (run against `exam_test` per AGENTS.md
> APP_MODE=test — to confirm the matrix is not just source-inferred):
>
> ```text
> APP_MODE=test npx vitest run \
>   src/routes/examAuthoringCapability.test.ts \
>   src/authz/assignmentAuthorityRuntime.test.ts
>
>  Test Files  2 passed (2)
>       Tests  24 passed (24)
>    Duration  11.83s
> ```
>
> - `src/authz/assignmentAuthorityRuntime.test.ts` — **15 passed** (E1–E19:
>   stale `users.role`, stale JWT, grant/revoke-next-request, inactive
>   assignment, no-assignment, multi-role union incl. E17 scoped-gate +
>   E19 score-gate `ScoreAllView` via secondary role, fail-closed corruption).
> - `src/routes/examAuthoringCapability.test.ts` — **9 passed** (Teacher
>   creates/lists/reads/updates/publishes/closes/publishes-results/views
>   scores + manages enrollments; Teacher denied on every Admin-only exam
>   lifecycle route; Candidate denied at the capability gate; Admin no
>   regression).
>
> These two files are the highest-signal three-role + assignment-authority
> proofs. The full api vitest suite (≥93 files) exceeds this round's
> time-boxed verification; a complete `pnpm --filter api test` run is
> recommended as the first step of P4-R1 closeout. The §10 coverage matrix
> is built from test-source evidence (test names + asserted verdicts); the
> live run above confirms the two most representative files.

Baseline failure classification: **NONE observed** in the evidence gathered.
No AUTHZ_MODEL_FAILURE, no REGISTRY_DRIFT failure, no ENVIRONMENT_FAILURE.

---

## Appendix B — Production changes

```text
Production code modified: no
```

This round created exactly one file:
`docs/audits/P4-R0-MVP-ROLE-SWITCH-REALITY-AUDIT.md` (this document) and the
new `docs/audits/` directory. No route gate, preset, Permission, registry,
route, frontend, test, script, schema, or migration was modified.

---

## Appendix C — Completion checklist (task §17)

- [x] All MVP API routes entered the matrix (§7).
- [x] All MVP frontend pages entered the matrix (§8).
- [x] Admin / Teacher / Candidate current capabilities have code evidence (§5).
- [x] Capability catalog and role preset fully inventoried (§6).
- [x] Role assignment authority confirmed (§9 — assignment-backed, `users.role`
      non-authoritative cache).
- [x] RequestContext capability resolution chain confirmed (§4.1–4.2).
- [x] All role hardcode searched and classified (§6.4, §1.2 — 0 production
      route authorities).
- [x] Organization boundary audited (§4.4).
- [x] Candidate own-resource boundary audited (§4.5).
- [x] Frontend/backend divergence registered (§8.4, P4-G-02).
- [x] Positive and negative test evidence registered (§10).
- [x] P4 vs M11 boundary explicit (§2.3, §11.5).
- [x] Target MVP Role Matrix frozen, with 1 unresolved catalog decision
      (§12).
- [x] Gap Register drives Corrective Jobs (§11, §13).
- [x] P3 result-publishing handoff contract defined (§14).
- [x] No production code modified.
