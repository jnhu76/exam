# P7 Role / RBAC Reality Audit

Full-stack authority consistency audit of the current Role / RBAC implementation.

```text
P7 ROLE / RBAC REALITY AUDIT

Baseline:   8a2c9edf6787382f73c0b03e4e05d7afa600e569  (Merge pull request #282 from jnhu76/feat/p7-e-operational-control-plane)
Audit date: 2026-08-13
Working tree: clean (no uncommitted changes on master at audit start)
Audit SHA:  8a2c9edf6787382f73c0b03e4e05d7afa600e569 (audit performed at this SHA; no fixes applied)

Authority precedence:
1. docs/adr/ADR-017-operational-authority-maintainer-boundary.md — Status: ACCEPTED (2026-08-12, PR #281 review), D2/D14 amend ADR-010 role set
2. docs/adr/ADR-010-scoped-rbac-architecture.md (as amended by ADR-017)
3. Current code reality (this document's primary evidence)
4. Current product behavior (test evidence)
5. Current tests (all four suites green at audit SHA)
6. Roadmap/status docs (docs/roadmap/P7-system-readiness-and-exam-modes.md, docs/roadmap/current.md)
7. Historical/archive prose (incl. "Phase 1 only Admin/Candidate" statements superseded by ADR-017 D2)
```

---

## 1. Executive verdict

**Is the current Role/RBAC architecture coherent? — YES WITH FIXES**

The P7-E merge (PR #282) landed a genuinely assignment-backed, capability-driven RBAC
kernel. The runtime authority formula is uniform and fail-closed, the Admin/Maintainer
mutual exclusion is enforced transactionally on every mutation path with a shared
advisory-lock fence, `users.role` no longer authorizes anything, and the frontend is
capability-driven. The residual issues are **contract/source-of-truth duplication and
documentation drift** (P2) plus **hardening gaps** (P3) — no P0/P1 exploit path was
proved reachable.

```text
P0: 0
P1: 0
P2: 4   (F-01 frontend role-catalog duplication, F-02 OpenAPI x-role drift,
         F-03 role-based user-list hides Teacher/Proctor/Grader,
         F-04 Teacher course-scope not enforced)
P3: 7   (F-05..F-11 — defense-in-depth + hygiene, see §11)
```

---

## 2. Canonical role model observed (CODE REALITY)

```text
User
 ├─ primary assignment   (user_role_assignments row: is_primary = true, is_active = true)
 ├─ secondary assignments (0..n rows: is_primary = false, is_active = true)
 │
 └─ effective permissions = UNION( permissionsForRole(role)   for every ACTIVE assignment )
                            (users.role  = compatibility cache = primary active assignment role)
```

Observed facts:

1. **Authority source**: `user_role_assignments` rows, re-resolved **per HTTP request**
   from PostgreSQL (`apps/api/src/plugins/auth.ts` → `loadAssignmentAuthority`,
   `apps/api/src/authz/assignmentAuthority.ts`). No permission/role snapshot in the JWT
   or the session; the JWT `role` claim is telemetry only.
2. **Primary role** = exactly-one active primary assignment (enforced by repo
   transactions + a partial unique index + a fail-closed resolver branch). It is used
   only for compatibility projections: login response `role`, `/me` `role`, JWT claim,
   audit/log display, frontend shell classification.
3. **`users.role`** = compatibility projection, synced by
   `apps/api/src/authz/roleSync.ts` (`syncUsersRoleFromPrimary`) after every
   primary-authority mutation. Never read by any authorization gate.
4. **System** = synthetic in-memory actor (`packages/authz/src/systemActor.ts`),
   closed actor-id set, non-login, non-assignable, never a DB row.
5. **Admin ∩ Maintainer = ∅** is the only cross-role exclusion. All other combinations
   are allowed and produce a plain preset union.

---

## 3. Role inventory

| Role | authz preset | assignable | login | default scope | DB CHECK (assignments) | contract schema | frontend selector | OpenAPI |
|---|---|---|---|---|---|---|---|---|
| Admin | yes | yes | yes | organization | yes | yes | yes | yes |
| Teacher | yes | yes | yes | course | yes | yes | yes | yes (course/exam routes) |
| Proctor | yes | yes | yes | exam | yes | yes | yes | yes |
| Grader | yes | yes | yes | exam | yes | yes | yes | yes |
| Candidate | yes | yes | yes | own_attempt | yes | yes | **no (by design, managed via candidate import)** | yes |
| Maintainer | yes | yes | yes | system | yes (since migration 0030) | yes | yes | partial (only 3 of 5 routes) |
| System | yes | **no** | **no** | system | **no** | **no** | **no** | no |

There is **one canonical permission/preset source** (`packages/authz`: `catalog.ts`
closed unions + `presets.ts` `ROLE_PRESETS`) and **several duplicated closed role
enums** that mirror it:

| Surface | Source | Notes |
|---|---|---|
| Permission catalog | `packages/authz/src/catalog.ts` `Permission` | canonical |
| Preset matrix | `packages/authz/src/presets.ts` `ROLE_PRESETS` | canonical |
| DB assignable set | `packages/db/src/schema/pg.ts` `ASSIGNABLE_ROLES` (line 1445) + CHECK (line 1497) | duplicate, documented by-design ("db cannot depend on contracts") |
| Contract assignable set | `packages/contracts/src/user.ts` `AssignableRoleSchema` | duplicate, documented by-design |
| Authority-kernel mirror | `apps/api/src/authz/assignmentAuthority.ts` lines 56–64 `ASSIGNABLE_ROLE_KEYS` | duplicate, comment says "MUST stay in sync" |
| Login-role set | `apps/api/src/routes/auth.ts` lines 50–57 `ASSIGNABLE_LOGIN_ROLES` | duplicate |
| User-list filter | `apps/api/src/routes/user.ts` line 65 `PHASE1_SUPPORTED_ROLES = ["Admin","Candidate","Maintainer"]` | **subset** — filters the admin user list |
| Frontend role selector | `apps/web/src/pages/admin/UsersPage.tsx` lines 68–77 `EDITABLE_ROLES` | **duplicate, self-deprecated comment**; `GET /roles/assignable` unused |
| OpenAPI `x-role` | per-route `schema["x-role"]` arrays | manual metadata, drift-prone (see F-02) |

Not found anywhere: `SuperAdmin`, `ContentManager`, `ResultViewer`, old
`PHASE1_SUPPORTED_ROLES` as an authorization source, or a `role_presets` DB table
(presets exist only in `@exam/authz` code; ADR language "role_presets seed" describes
the code preset, not a table).

---

## 4. Capability matrix (built-in roles × permission domains)

Legend: ✓ granted · — not granted · (sc) scoped-by-design note

| Capability domain | Admin | Maintainer | Teacher | Proctor | Grader | Candidate | System |
|---|---|---|---|---|---|---|---|
| user.* (view/create/update/delete/role.assign/password.reset) | ✓ | — | — | — | — | — | — |
| organization.* / settings.* | ✓ | — | org.view | — | — | — | — |
| audit_log.view | ✓ | — | — | — | — | — | — |
| candidate.* / candidate_field.* | ✓ | — | candidate.view (sc) | — | — | — | — |
| course.* / question.* | ✓ | — | ✓ (sc) | — | — | — | — |
| exam.* lifecycle (create/update/publish/close/cancel/archive/delete/extend/unpublish) | ✓ | — | subset (sc) | — | — | — | — |
| exam.result.publish | ✓ | — | ✓ (sc) | — | — | — | — |
| exam.enrollment.manage | ✓ | — | ✓ (sc) | — | — | — | — |
| exam.take / attempt.own / score.own | ✓ | — | — | — | — | ✓ | — |
| exam_room / attempt.status / attempt.timeline | ✓ | — | — | ✓ | — | — | — |
| attempt.force_submit / time.grant / misconduct | ✓ | — | — | — | — | — | — |
| attempt.export | ✓ | — | — | — | — | — | — |
| grading.queue/detail/answer/score.write | ✓ | — | — | — | ✓ | — | — |
| grading.finalize / identity.view | ✓ | — | — | — | — | — | — |
| score.all.view / score.export | ✓ | — | score.all (sc) | — | — | — | — |
| incident.view/create/investigate | ✓ | — | — | ✓ | — | — | — |
| incident.resolve | ✓ | — | — | — | — | — | — |
| incident.recovery.view | ✓ | — | — | — | — | — | — |
| exam.proctor_assignment.* | ✓ | — | — | — | — | — | — |
| system.health.view | ✓ | ✓ | — | — | — | — | — |
| system.diagnostics.view | ✓ | ✓ | — | — | — | — | — |
| system.business_integrity.view | ✓ | — | — | — | — | — | — |
| system.business_summary.view | ✓ | — | — | — | — | — | — |
| system.backup.view | ✓ | ✓ | — | — | — | — | — |
| system.restore_readiness.view | ✓ | ✓ | — | — | — | — | — |
| system.ops.policy.view | ✓ | ✓ | — | — | — | — | — |
| system.ops.policy.manage | ✓ | — | — | — | — | — | — |
| system.email.test | ✓ | — | — | — | — | — | — |
| system.info.view | — (no route consumer) | — | — | — | — | — | — |
| system.auto_submit / heartbeat_scan / lifecycle_reconcile | — | — | — | — | — | — | ✓ (synthetic only) |

**Answers to the Phase B questions:**

- **Admin** = business owner (full business CRUD) **+ operational observation subset
  (all five Maintainer reads) + operational intent (policy manage) + email test**. It is
  **not** an infrastructure super-user: there is no backup trigger, no restore/PITR, no
  restart, no secret/DB-credential read surface reachable by any capability (proved by
  `adversarialAudit.test.ts` — all such routes 404). Verdict: Admin is
  *business owner + limited operational observation + operational intent* (ADR-017
  D1/D9), as designed.
- **Maintainer** = operational observation only. **Business permission count = 0.**
  `MAINTAINER_PERMISSIONS` (`presets.ts` lines 221–229) = exactly 5 capabilities, all
  `system.*.view` reads.
- **Teacher / Proctor / Grader** = preset-bundled roles with route gates aligned to
  their presets; no legacy broad-authority residue on their surfaces; scope narrowing
  is enforced for Proctor/Grader via resolvers, **not for Teacher** (see F-04).
- **Candidate** = own-attempt/own-score + exam.take only.
- **System** = non-login, non-assignable, synthetic-only (proved: not in
  `ASSIGNABLE_ROLES`/CHECK/schema/login set/frontend selector; `systemActor.ts`
  enforces a closed actor-id set).

---

## 5. Source-of-truth map

```text
AUTHORITY SOURCE                     MIRRORS / CACHES
─────────────────────────────────    ─────────────────────────────────────────────
packages/authz Permission union  →   (no mirror; every gate imports Permission)
packages/authz ROLE_PRESETS      →   db ASSIGNABLE_ROLES, contracts
                                      AssignableRoleSchema, authz kernel mirror,
                                      login set, OpenAPI x-role (manual),
                                      frontend EDITABLE_ROLES (duplicate)
user_role_assignments (DB)       →   users.role (compatibility cache, roleSync.ts)
active assignments               →   login/me `role` + `capabilities` (fresh)
JWT role claim                   →   telemetry only (drift logged, never enforced)
route schema["x-role"]           →   OpenAPI documentation only (not runtime)
```

The one true authorization authority is **`ctx.capabilities` = union of active
assignment presets, resolved per request**. Everything else is a projection or
documentation.

---

## 6. Full-stack consistency matrix

| Concern | DB | authz catalog | API runtime | OpenAPI | Frontend | Verdict |
|---|---|---|---|---|---|---|
| Admin | users.role free-text; assignments CHECK ✓ | preset ✓ | capability union ✓ | x-role ✓ | capability-driven ✓ | CONSISTENT |
| Maintainer | CHECK ✓ (0030) | preset ✓ (5 ops perms) | gates ✓ | **x-role drift on /system/health, /system/diagnostics** (F-02) | nav + landing ✓ | CONSISTENT except OpenAPI |
| System | no rows | non-assignable, non-login | no path | absent | absent | CONSISTENT |
| Assignable roles | CHECK = 6 | presets assignable = 6 | kernel mirror = 6 | n/a | **EDITABLE_ROLES duplicate (F-01)**; user-list subset (F-03) | DRIFT-RISK |
| Effective permissions | — | union semantics | per-request union ✓ | n/a | capabilities from login/me ✓ | CONSISTENT |
| Role lifecycle | partial unique idx ✓; no zero-primary/DB-level exclusion | — | repo invariants + fail-closed resolver ✓ | n/a | UI = create/edit only | CONSISTENT (app-level) |
| Admin/Maintainer exclusion | **application-only** (no DB constraint) | — | txn + org advisory lock, all mutation paths + login read-side ✓ | n/a | n/a | SOUND, DB not enforced (accepted) |

---

## 7. Admin vs Maintainer — are they two independent first-class RBAC roles?

**YES on every layer that matters:**

- **Authorization**: distinct presets; Admin has business + ops + intent; Maintainer
  has exactly 5 operational read capabilities and zero business. Runtime gates are
  capability-based, so the two roles never collide in the enforcement layer.
- **Assignment**: both are in the assignable set (CHECK, schema, contracts, kernel
  mirror, login set). Maintainer is provisioned through the ordinary user path
  (`operationalBoundary.test.ts` "Maintainer is provisioned through the approved user
  path").
- **Login**: both login; login response carries the primary role + capability union.
- **Mutual exclusion**: D14 is enforced transactionally (create/activate/promote/
  replace), read-side at login, and by seed fail-loud guards.
- **Frontend**: Maintainer lands on `/admin/operations` (not the Admin dashboard —
  `defaultLandingPath`/`adminLandingPath`, `capabilities.ts`), sees an "运维" nav
  group, and is denied every business page by the per-route capability guard (403
  page) — **both frontend and backend deny** business surfaces.
- **URL/product semantics**: Maintainer's home is `/admin/operations`. The `/admin`
  URL namespace is historical/code organization (all console pages live under
  `apps/web/src/pages/admin/`); it carries **no authorization semantics** — the guard
  is capability-based. Classification: **PRODUCT SEMANTICS / URL debt, not a security
  bug** (do not re-flag; consider a future rename only as IA hygiene).
- **OpenAPI**: inconsistent — 3 of 5 Maintainer-accessible routes declare
  `x-role: [Admin, Maintainer]`, 2 declare `x-role: [Admin]` (F-02).

Residual nuance: the shared `/admin` shell renders the same sidebar for both; the
"管理" group leaks one item ("系统监控") to Maintainer (F-08) — cosmetic.

---

## 8. Role composition findings

The assignment surface allows any combination except {Admin, Maintainer} on one actor
(D14) and System (non-assignable). Composition semantics = plain preset union
(`deriveAssignmentAuthority`). Results:

| Combination | Status | Effective authority | Assessment |
|---|---|---|---|
| Admin + anything | ALLOWED | Admin (compatibility superset already contains the rest) | benign |
| Maintainer + Teacher/Proctor/Grader/Candidate | ALLOWED | ops reads + business subset of the second role | **contradicts the Maintainer zero-business design intent** — a Maintainer who also holds Teacher gains business authoring. This is intentional per the union model (only Admin∩Maintainer is forbidden), but should be a documented, conscious policy. See F-12 note. |
| Teacher + Proctor | ALLOWED | course/exam authoring + exam-room runtime (their union) | plausible intended "proctoring teacher" persona; no capability outside the two presets |
| Teacher + Grader | ALLOWED | authoring + manual grading | plausible "grading teacher" |
| Proctor + Grader | ALLOWED | exam-room monitoring + grading | plausible |
| Candidate + Teacher/Proctor/Grader | ALLOWED | own-scope + staff surface | needed for e.g. candidate-primary + staff-secondary accounts |

No combination produces a capability that no single preset grants, and no combination
creates an out-of-design persona beyond the union. **No dangerous composition found.**
The only sharp edge is documented in §12 (Maintainer zero-business is a preset
property, not a cross-role property).

---

## 9. Route authorization findings

Whole-app conformance (`apps/api/src/authz/routeRegistryConformanceWholeApp.test.ts`,
green) asserts: **124 primary routes; zero `requireRole`/`requirePermission` gates
anywhere; every protected route carries exactly one capability or ownership gate; all
gate permissions exist in the catalog.** The `requireRole` decorator survives only as
the conformance test's negative-control seam (0 production consumers —
`plugins/auth.ts` lines 230–238).

Route matrix highlights (method path → runtime gate → x-role → verdict):

| Route | Runtime gate | x-role | Verdict |
|---|---|---|---|
| GET /system/health | SystemHealthView (Admin+Maintainer) | [Admin] | **DRIFT (F-02)** — Maintainer authorized at runtime, documented Admin-only |
| GET /system/diagnostics | SystemDiagnosticsView (Admin+Maintainer); `integrity` block server-side gated by SystemBusinessIntegrityView | [Admin] | **DRIFT (F-02)** — same; integrity split is server-side and correct (D8) |
| GET /system/backups | SystemBackupView (Admin+Maintainer) | [Admin, Maintainer] | consistent |
| GET /system/ops-policy | SystemOpsPolicyView (Admin+Maintainer) | [Admin, Maintainer] | consistent |
| PUT /system/ops-policy | SystemOpsPolicyManage (Admin only) | [Admin] | consistent |
| GET /system/restore-readiness | SystemRestoreReadinessView (Admin+Maintainer) | [Admin, Maintainer] | consistent |
| GET /system/dashboard | SystemBusinessSummaryView (Admin only) | [Admin] | consistent |
| POST /email/test | SystemEmailTest (Admin only — D7) | [Admin] | consistent; Maintainer 403 (tested) |
| /users*, /roles/*, /candidates*, /courses*, /questions*, /exams*, /admin/grading-*, /admin/attempts/*, /admin/incidents*, /admin/recovery/* | Admin-only capabilities | [Admin] | consistent today |
| /candidate/*, /attempts (own), /scores/attempts/:id | candidate-context / exam-eligibility / own-attempt / score gates | declared | consistent |

No route uses a role-shortcut that bypasses the capability catalog. No scope
enforcement gaps on Proctor/Grader/incident surfaces (resolver-backed, tested).

---

## 10. Frontend findings

- **Navigation** (`AppSidebar.tsx`): every nav item is capability-gated; groups are
  filtered; backend remains authoritative. Maintainer sees the "运维" group and —
  due to `canSeeManagement` passing on `system.health.view` — the "管理" group with a
  single "系统监控" item (F-08). No dead nav (each visible item's route capability is
  held by construction).
- **Route guards** (`AdminLayout.tsx` + `lib/adminRouteCapabilities.ts`): per-route
  capability guard, deny-by-default for unmapped paths, dedicated 403 page. Direct
  URL access by Maintainer to business routes is denied in the UI **and** by the
  backend.
- **Login projection**: `/login` and `/me` return `role` (primary) + `capabilities`
  (union). `AuthContext` stores them; session restore via `/me` refreshes capabilities
  — no frontend role-preset re-derivation, so secondary-role capabilities are not
  hidden.
- **Role selectors**: `UsersPage` hardcodes `EDITABLE_ROLES` (F-01) and filters the
  list to `role !== "Candidate"`; combined with the backend `PHASE1_SUPPORTED_ROLES`
  subset, **Teacher/Proctor/Grader users are invisible in the admin user list** (F-03).
- **`role === "Admin"` usage**: only `isAdmin`/`isCandidate` shell classification
  (`capabilities.ts` lines 41–48, documented non-authoritative) and one UX button
  (`ProctorDashboardPage.tsx` line 1909 extend-time button, backend still enforces
  `attempt.time.grant` — F-09). No authorization decision reads `user.role`.
- **Labels**: zh-CN i18n maps Maintainer → "维护者" (`zh-CN.ts` line 692); no
  "管理员" mislabeling found for Maintainer surfaces.

---

## 11. Vulnerabilities / findings

### F-01 — Frontend role catalog duplicated (P2)
- **Severity**: P2 (contract drift risk)
- **Domain**: frontend/backend contract
- **Evidence**: `apps/web/src/pages/admin/UsersPage.tsx` lines 68–77 `EDITABLE_ROLES`;
  `GET /roles/assignable` (`apps/api/src/routes/roleAssignments.ts`) exists, sourced
  from `ROLE_PRESETS`, but has **zero frontend consumers** (verified by rg).
- **Exploit / failure path**: none today (backend validates via
  `AssignableRoleSchema`); future role additions silently diverge the selector.
- **Impact**: adding a future assignable role requires touching the frontend array;
  a stale array hides valid roles or offers roles the backend never accepts.
- **Why tests did not catch it**: no test cross-checks the web role list against
  `/roles/assignable` (frontend tests mock the API).
- **Minimum remediation**: have `UsersPage` fetch `/roles/assignable` and derive the
  selector (plus labels) from it; delete `EDITABLE_ROLES`.
- **Must fix before P7-F**: NO (P2 — human disposition).

### F-02 — OpenAPI x-role drift on the two Maintainer-read routes (P2)
- **Severity**: P2 (OpenAPI authority metadata wrong)
- **Domain**: OpenAPI / docs
- **Evidence**: `apps/api/src/routes/system.ts` — `GET /system/health` x-role
  `["Admin"]` (line 308) with gate `SystemHealthView` (Maintainer preset holds it);
  `GET /system/diagnostics` x-role `["Admin"]` (line 380) with gate
  `SystemDiagnosticsView` (Maintainer preset holds it). The structural OpenAPI test
  pins `x-role` presence/values per route and asserts Admin/Teacher/Admin-only sets,
  but contains **no Maintainer-parity assertion** for these two routes.
- **Exploit / failure path**: none at runtime (x-role is documentation metadata; the
  runtime gate is capability-based). Misleads SDK consumers/security reviewers into
  believing Maintainer cannot read health/diagnostics.
- **Impact**: documentation falsehood; future tooling that reads x-role (e.g.
  generated SDKs, permission linters) would enforce the wrong surface.
- **Why tests did not catch it**: the OpenAPI structural test only asserts the
  declared arrays exist and match hand-written expectations; nothing reconciles
  x-role with preset membership.
- **Minimum remediation**: correct the two `x-role` arrays to `["Admin","Maintainer"]`
  (or derive x-role from the preset set at spec build time) and extend the structural
  test to assert Maintainer parity for every route whose gate permission is in the
  Maintainer preset.
- **Must fix before P7-F**: NO (P2).

### F-03 — User list is role-projection-filtered; Teacher/Proctor/Grader invisible (P2)
- **Severity**: P2 (product behavior drift / users.role-vs-assignments surface)
- **Domain**: API contract + frontend user management
- **Evidence**: `apps/api/src/routes/user.ts` line 65
  `PHASE1_SUPPORTED_ROLES = ["Admin","Candidate","Maintainer"]`; `GET /users` filters
  `users.role IN (...)` (`userRepo.listPaginatedByRoles`); `UsersPage` additionally
  filters `role !== "Candidate"` (line 102). A user created with role Teacher/Proctor/
  Grader (all valid via `POST /users` + the frontend selector) disappears from the
  list: cannot be edited, disabled, or password-reset via the UI.
- **Exploit / failure path**: none (read-visibility only; authority unaffected).
- **Impact**: account lifecycle management blind spot; the list contradicts the
  assignable catalog it is fed by.
- **Why tests did not catch it**: the HTTP boundary test asserts Maintainer appears
  in the list; no test asserts Teacher/Proctor/Grader visibility.
- **Minimum remediation**: make the list assignment-based (list users with any active
  assignment) or extend `PHASE1_SUPPORTED_ROLES` to the full assignable set; align the
  frontend filter.
- **Must fix before P7-F**: NO (P2).

### F-04 — Teacher course-scope narrowing is declared but not enforced (P2)
- **Severity**: P2 (scope enforcement gap on a future product persona)
- **Domain**: scoped RBAC
- **Evidence**: Teacher preset `defaultScope: Scope.Course` (`presets.ts` line 284),
  but `user_role_assignments` has **no scope/resource columns**; Teacher-gated routes
  (`GET /courses`, `/courses/:id`, `/questions*`, `/exams*`, …) use flat
  `requireCapability` (registry: `resolver: organization` / flat) with org scope —
  a Teacher can list/read every org course/question/exam. Proctor/Grader surfaces
  instead resolve attempt/exam/incident scope before checking.
- **Exploit / failure path**: a Teacher account (assignable today via
  `POST /users`/role-assignment surface, `permissionMatrix.exam.test.ts` exercises
  Teacher authoring) reads org-wide business data beyond any assigned course.
- **Impact**: over-scope for the Teacher persona relative to ADR-010's scoped model;
  in the current milestone Teacher is a preset-with-UI-surface but not yet a
  first-class product persona, so reachability is limited — but the surface exists.
- **Why tests did not catch it**: permission matrix tests assert the capability gate
  (pass/fail), not per-resource scope filtering for Teacher.
- **Minimum remediation**: either (a) gate Teacher surfaces behind a course-scope
  resolver once course-scope assignments exist, or (b) explicitly document Teacher as
  org-scoped in this milestone and defer narrowing to the Phase-3 scope-bundle work.
- **Must fix before P7-F**: NO (P2 — disposition needed; do not silently rebuild
  scoping in P7-F).

### F-05 — Dual-role read-side exclusion not re-checked on the authenticated request path (P3)
- **Severity**: P3 (defense-in-depth gap; unreachable through product paths)
- **Domain**: authentication/session
- **Evidence**: `loadAssignmentAuthority` only rejects dual Admin+Maintainer when
  `failClosedOnDualRole` is set. Login sets it (`routes/auth.ts` line 126);
  `plugins/auth.ts` `authenticate` calls with **no options** (line 129). A hand-edited
  DB row set (the exact Scenario 4 state) would therefore fail login (401) but an
  already-issued JWT would still authenticate with the union authority.
- **Exploit / failure path**: requires direct DB write access (all API mutation paths
  + seeds + login guard prevent the state); with DB write access the attacker already
  controls everything.
- **Impact**: defense-in-depth only; no reachable escalation.
- **Why tests did not catch it**: the dual-role test asserts login 401 only; no test
  asserts authenticated-request denial for the same state.
- **Minimum remediation**: pass `failClosedOnDualRole: true` in `authenticate` (and
  unit-test it) or add a per-request exclusion post-check.
- **Must fix before P7-F**: NO (P3).

### F-06 — `users.role` can go stale when the last active primary is removed (P3)
- **Severity**: P3 (display-only)
- **Domain**: compatibility cache
- **Evidence**: `syncUsersRoleFromPrimary` leaves `users.role` untouched when no
  primary active assignment exists (`roleSync.ts` line 31). A user whose final
  assignment is deactivated keeps a stale role string in the list UI; login and
  authentication fail closed (no active assignments), so the stale value never
  authorizes.
- **Impact**: cosmetic; the user list may show a role for a locked-out account.
- **Minimum remediation**: on zero-primary sync, clear or mark the stale role.
- **Must fix before P7-F**: NO (P3).

### F-07 — Stale comment referencing a nonexistent route (P3)
- **Severity**: P3 (docs wording)
- **Domain**: hygiene
- **Evidence**: `apps/api/src/routes/system.ts` lines 744–748 docstring mentions
  `GET /system/operational-diagnostics` (operational projection, Maintainer); no such
  route exists — the D8 split is implemented as a field-level projection inside
  `GET /system/diagnostics`.
- **Impact**: reviewer confusion.
- **Minimum remediation**: update the comment.
- **Must fix before P7-F**: NO (P3).

### F-08 — Maintainer sees a stray "管理" nav group with one item (P3)
- **Severity**: P3 (product semantics / IA)
- **Domain**: frontend navigation
- **Evidence**: `AppSidebar.tsx` `managementItems` includes "系统监控"
  (`canSeeSystemDiagnostics`); `canSeeManagement` passes on `system.health.view`
  (capabilities.ts `MANAGEMENT_SURFACE_PERMS`). Maintainer therefore sees the
  "管理" group containing only "系统监控" in addition to the "运维" group.
- **Impact**: cosmetic IA confusion; both items are operational surfaces and their
  route guards are capability-correct.
- **Minimum remediation**: exclude the system item from the management group for
  non-Admin holders (e.g. gate the group on an Admin-only permission) or move
  "系统监控" into the operations group.
- **Must fix before P7-F**: NO (P3).

### F-09 — `isAdmin()` UX gating on the extend-time button (P3)
- **Severity**: P3 (UX-only)
- **Domain**: frontend
- **Evidence**: `ProctorDashboardPage.tsx` line 1909 gates the time-grant button on
  `isAdmin(user)` (primary-role check) instead of
  `can(user, Permission.AttemptTimeGrant)`. A multi-role actor whose primary role is
  not Admin but who holds the capability (Admin secondary) loses the button; backend
  enforces `attempt.time.grant` anyway.
- **Impact**: cosmetic for a hypothetical multi-role actor.
- **Minimum remediation**: switch to `can(user, Permission.AttemptTimeGrant)`.
- **Must fix before P7-F**: NO (P3).

### F-10 — Duplicated closed role enums across packages (P3 — accepted, monitored)
- **Severity**: P3 (future drift risk; currently in sync)
- **Domain**: source-of-truth
- **Evidence**: the 6-role assignable set exists in db `ASSIGNABLE_ROLES`, contracts
  `AssignableRoleSchema`, api kernel mirror, login set, and (subset) `PHASE1_SUPPORTED_ROLES`;
  two of the duplicates carry "keep in sync" comments. The 0030 migration had to
  hand-edit the DB CHECK for Maintainer.
- **Impact**: adding a role requires coordinated edits; a missed one fails loudly
  (CHECK/unknown-role fail-closed) rather than silently.
- **Minimum remediation**: later consolidation is desirable (contracts↔db are
  structurally blocked by dependency layering; a shared `@exam/authz` export could be
  the single source the others import).
- **Must fix before P7-F**: NO (P3).

### F-11 — `users.role` has no DB CHECK and backfill skips non-assignable roles (P3 — accepted)
- **Severity**: P3 (accepted fail-closed design)
- **Domain**: DB
- **Evidence**: `users.role` is `text NOT NULL` with no CHECK (`schema/pg.ts` line 128);
  migration 0011 backfills only roles in the assignable set and documents the skip
  (SuperAdmin/System/ContentManager/ResultViewer rows get no assignment → login
  `unknown_role`/`no_active_assignments` fail-closed). `reset-admin-password` script
  checks active assignments, not `users.role`.
- **Impact**: a garbage `users.role` string cannot widen authority (assignments are
  the source); listed as accepted behavior.
- **Minimum remediation**: optionally add a CHECK for documentation rigor.
- **Must fix before P7-F**: NO (P3).

---

## 12. False positives / explicitly accepted behavior

Recorded so future reviewers do not re-report:

- **Maintainer exists in Phase 1** — ADR-017 D2 (ACCEPTED) amends ADR-010's role set;
  "Phase 1 only Admin/Candidate" prose is superseded. Maintainer is a first-class
  built-in assignable, login-capable role with an operational-only preset.
- **Admin can view Operations / set desired RPO** — ADR-017 D1/D9: Admin is the
  business owner and the sole operational-policy intent owner; the policy record is
  intent-only (never binds infrastructure).
- **Host Maintainer is not an app role** — host-side backup/restore scripts
  (`scripts/`, P7-C) run as OS-level operators, outside the application RBAC; the app
  surface exposes only evidence reads. This boundary is deliberate (D4/D5).
- **Admin is a compatibility superset** — Admin holds every business capability
  (including proctor/grading reads) by design (D1); this is not a "super-user" defect
  in the business plane, and the infrastructure plane is absent for everyone.
- **Seed/demo-seed bypass the advisory-lock seam** — they run only in dev/test
  (`assertNotProductionSeed`), are idempotent, never overwrite existing assignments,
  and fail loudly on D14 violations; they cannot create a dual-role state.
- **`/roles/assignable` is Admin-only** — `UserRoleAssign` is Admin-only in presets;
  non-Admin roles (Maintainer) getting 403 on it is correct.
- **Login response omits `assignments`/`primaryRole`** — `role` + `capabilities`
  suffice for all consumers; no contract defect.
- **`/admin/operations` URL** — historical code/URL naming, no authorization
  semantics; the runtime guard is capability-based. Classification: PRODUCT SEMANTICS
  / URL debt, not security.
- **`requireRole` decorator still exists** — intentional negative-control test seam;
  zero production consumers (whole-app conformance test asserts 0).
- **x-role is not runtime authority** — it is documentation metadata; its drift (F-02)
  is a docs defect, not a runtime authorization bypass.
- **Maintainer + a business role is allowed** — only Admin∩Maintainer is forbidden
  (D14). A Maintainer-with-Teacher account holds the union; this is the designed union
  model. Operators should treat "Maintainer zero-business" as a **preset property**,
  not a cross-role guarantee.

---

## 13. P7-F gate

```text
P0: 0
P1: 0
P2: 4  (F-01, F-02, F-03, F-04)
P3: 7  (F-05..F-11)

P7-F STATUS: READY AFTER FIXES (P2 human disposition required)
```

Per the audit rules: P0 > 0 → BLOCKED; P1 > 0 → BLOCKED; P2 → human disposition
required. There are no P0/P1 findings, so P7-F is **not blocked** by this audit, but
the four P2 items (catalog duplication, OpenAPI drift, user-list projection, Teacher
scope) should receive an explicit human disposition (fix now vs. schedule) before or
alongside P7-F work.

---

## 14. Recommended fix slices (for future rounds — NOT implemented here)

| Slice | Scope | Files | Risk | Tests needed |
|---|---|---|---|---|
| R1 — Role catalog authority cleanup | Frontend consumes `GET /roles/assignable`; delete `EDITABLE_ROLES`; label source from API | `apps/web/src/pages/admin/UsersPage.tsx`, contracts | low | web UsersPage test with mocked assignable-roles API |
| R2 — OpenAPI/contract alignment | Correct x-role on /system/health + /system/diagnostics; add Maintainer-parity structural assertion; optionally derive x-role from preset membership | `apps/api/src/routes/system.ts`, `apps/api/src/openapi/openapi.structural.test.ts` | low | structural spec test |
| R3 — Assignment-based user list | List users by active assignments (or full assignable set); align frontend filter; reconcile stale `users.role` display | `apps/api/src/routes/user.ts`, `packages/db/src/repository/userRepo.ts`, `UsersPage.tsx` | medium (repo query change) | user list API tests + web tests |
| R4 — Teacher scope disposition | Either course-scope resolver for Teacher routes or explicit org-scope documentation | `apps/api/src/routes/course.ts|question.ts|exam.ts`, docs | medium-high if enforced | permission-matrix scope tests |
| R5 — Lifecycle/audit hardening | `failClosedOnDualRole` on authenticate; optional users.role CHECK; stale-comment fix | `apps/api/src/plugins/auth.ts`, schema, `system.ts` | low | auth fail-closed tests |
| R6 — Maintainer IA polish | Move "系统监控" out of the management group for non-Admin; switch extend-time button to `can()` | `AppSidebar.tsx`, `ProctorDashboardPage.tsx` | low | layout tests |

---

## 15. Final verdict

```text
P7 ROLE / RBAC REALITY AUDIT

Baseline: 8a2c9edf6787382f73c0b03e4e05d7afa600e569 (PR #282 merged, P7-E in master)
Audit SHA: 8a2c9edf6787382f73c0b03e4e05d7afa600e569

Role model:      assignment-backed; EffectivePermissions = UNION(active assignment presets),
                 per-request DB resolution; users.role = compatibility cache only
Admin/Maintainer separation:  true first-class separation (distinct presets, assignment,
                 login, frontend landing/nav, server-side projection split, D14 exclusion)
Effective authority:          union of active assignments, fail-closed (zero/multiple
                 primary, unknown role, disabled user, no active assignment → 401/503)
Frontend/backend consistency: capability-driven nav + per-route guards + 403 page;
                 backend authoritative; remaining drift = EDITABLE_ROLES duplicate,
                 user-list role filter, one isAdmin() UX gate
OpenAPI consistency:          3/5 Maintainer routes correct; 2 drifted (health, diagnostics)
Role composition safety:      only Admin∩Maintainer forbidden; all unions safe;
                 no out-of-design persona found
Lifecycle safety:             repo invariants + partial unique index + fail-closed resolver;
                 D14 + last-Admin enforced transactionally under one org advisory lock
Session authority safety:     no stale authority (per-request resolution); JWT telemetry only

P0: 0
P1: 0
P2: 4  (F-01 frontend catalog duplicate · F-02 OpenAPI x-role drift ·
         F-03 user-list role projection · F-04 Teacher scope not enforced)
P3: 7  (F-05..F-11: dual-role authenticate hardening, stale users.role, stale
         comment, nav IA, isAdmin UX gate, enum duplication, missing DB CHECK)

P7-F gate: READY AFTER FIXES — P2 human disposition required (not BLOCKED; no P0/P1)
```

---

## Tests / commands (evidence collected at audit SHA)

```bash
pnpm --filter @exam/authz test   # 10 files, 79 tests  — PASS
pnpm --filter @exam/db test      # 42 files, 566 tests — PASS
pnpm --filter @exam/api test     # 162 files, 2173 tests (7 skipped) — PASS
pnpm --filter @exam/web test     # 116 files, 1627 tests — PASS
```

Key role/RBAC suites observed green: `operationalBoundary.test.ts` (Maintainer
boundary, D7/D8/D14 at HTTP), `adminMaintainerExclusion.test.ts` (write-skew races),
`adminInvariant.test.ts` (last-effective-Admin + concurrency), `adversarialAudit.test.ts`
(no restore/PITR/secret/restart surfaces; no secrets in operational responses),
`routeRegistryConformanceWholeApp.test.ts` (124 routes, zero legacy gates).

---

## Critical questions — explicit answers

1. **Maintainer 是不是真正的一等 RBAC role？** 是。内置 preset（仅 5 个 operational 读权限）、可分配、可登录、有专属 landing 与导航组、HTTP 层有完整边界测试。
2. **Maintainer 是否真正独立于 Admin？** 是。权限面互斥（D14），preset 无交集（Admin∩Maintainer 在 active 层为 ∅）；唯一残留是 OpenAPI 2 个路由的 x-role 标注漂移（F-02）与共享 /admin shell 的一个导航项（F-08）。
3. **Admin 是否仍是事实 superuser？** 在业务面上是兼容超集（设计如此，D1）；在基础设施面上不是——restore/PITR/backup trigger/restart/secret 全部无 surface（404，测试锁定）。
4. **frontend 是否仍把 Maintainer 当 Admin 子类型？** 否。能力驱动导航/路由守卫；Maintainer 落点 /admin/operations；无 "管理员" 标签误用。仅残留 isAdmin() 一处 UX 按钮门（F-09）。
5. **UsersPage 是否重复硬编码角色闭集？** 是（F-01）：EDITABLE_ROLES 硬编码且带自弃用注释；GET /roles/assignable 零前端消费。
6. **/roles/assignable 是否应成为 frontend role catalog authority？** 应。建议 R1。
7. **users.role 是否还被错误用于 authorization？** 否。全部授权走 active assignments 的 capability union；requireRole 零生产消费者；users.role 仅作兼容缓存/展示。
8. **effective authority 是否真的是 active assignments union？** 是（assignmentAuthority.ts deriveAssignmentAuthority；逐请求 DB 解析）。
9. **secondary assignments 是否存在 privilege composition 风险？** 未发现。唯一禁止组合 Admin∩Maintainer；其余组合均为合法 preset union，无超设计 persona。
10. **Admin/Maintainer mutual exclusion 是否覆盖所有 path + concurrency？** 是。create/assign/activate/promote/replace/deactivate/delete/user enable/seed/demo-seed/backfill-guard + login 读侧 + 同一 org advisory lock 防 write-skew（有并发测试）。
11. **Teacher/Proctor/Grader 多角色组合是否安全？** 组合本身安全（union 模型）；独立发现 Teacher 课程 scope 未强制（F-04，P2，需 human disposition）。
12. **OpenAPI 与 runtime capability 是否一致？** 5 条 Maintainer 路由中 3 条一致，2 条漂移（health/diagnostics，F-02）。
13. **Maintainer 是否可能读取任何不该看的业务数据？** 否。5 个 operational 读权限对应 5 条只读路由；integrity 块由服务端 capability 过滤（D8），业务仓库在 Maintainer 可达路由上从不查询（边界测试覆盖）。
14. **session 是否可能保留已经撤销的 authority？** 否。每请求从 DB 重算；JWT 仅身份+telemetry；撤销 assignment/禁用账号在下一个请求即生效。
15. **在进入 P7-F 前，必须修哪些东西？** 无 P0/P1；P2 四项（F-01/F-02/F-03/F-04）需 human disposition（建议 R1–R4 在 P7-F 内或前收口），P3 七项（R5/R6）可顺手。
