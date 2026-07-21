# Phase 3 MVP RBAC Route Matrix

> **Job card:** `P3-MOD-P4-1 — MVP RBAC Route → Permission → Role Matrix` (pasted task).
> **Type:** Audit + Design **ONLY**. No production route gating, preset, Permission,
> routeRegistry, route, or frontend navigation was modified. The only artifact created
> by this job is this document.
> **Predecessor commit:** `286e79d test(P3): verify admin frozen result view`.
> **Authority documents read:** `AGENTS.md`, `docs/phase3/plan.md` (§8 = the P4 module),
> `docs/phase3/exam-protocol.md` (§2 exam lifecycle), `docs/phase3/rbac/adr-scoped-rbac-architecture.md`
> (via the catalog/preset/resolver source comments), `docs/phase3/rbac/audit-authz-framework-readiness.md`
> (PRE-migration historical fact base — explicitly superseded), `docs/phase3/rbac/RBAC-JOB-QUEUE.md`
> (current-gap tracker).
> **Currency note:** the historical `audit-authz-framework-readiness.md` describes the
> PRE-migration 2-role `requireRole` model. That state is **obsolete**. This report is
> built entirely from the **current** code on commit `286e79d`: the merged Scoped RBAC
> foundation (PR #149–#153), SYSTEM-M1 (#151), M7/M8/M9 (#153), and the `phase3-enforcement`
> series that flipped 14 grading/proctor/attempts-admin routes to `requireCapability`.

---

## A. Verdict

```text
P3-MOD-P4-1: PASS
```

Rationale:

- Runtime route inventory is complete (91 routes; 77 in the registry + 14 public/self/auth-only routes that are correctly out of registry scope).
- Registry ↔ runtime alignment is characterized: the **77-registry claim is exactly correct**, zero duplicate keys, and the only registry↔runtime gaps are the 14 deliberately-unregistered public/self/authenticated-only routes.
- Every MVP route's target permission and role decision is fixed by real `Permission` symbols + real preset grants (no guessing).
- Teacher scope (`org_global` within the authenticated organization) and Candidate ownership enforcement (`getOwnedAttempt` / `findByIdAndCandidate` query) are both pinned with file:line evidence.
- P4-2A / P4-2B / P4-2C slices are mechanically executable from the tables in §I/§J/§K.
- Both genuine ambiguities the task demanded resolved have a single, evidenced answer:
  - **Exam close → `TEACHER_ALLOW`** (§F.1).
  - **publish-results → `TEACHER_ALLOW`** (§F.2).
- Grading cutover (P4-2A) is **already merged** — grading/proctor/attempts-admin flipped to `requireCapability` in the `phase3-enforcement` series. P4-2A is therefore a *verification + ownership-resolver-wiring* job, not a gate-flip job (see §I).
- This report does **not** require any route to have already completed cutover; it only requires the matrix to be complete and unambiguous, which it is.

The one structural caveat (not a PASS blocker, recorded for P4-2 owners): `requireCapability` today is a **flat role-preset membership check** — the scope resolvers (`attemptResolver.ts` / `examResolver.ts`) exist and are unit-tested but are **not wired into the request path**. So on the 14 already-flipped routes, "scope" is implicit (preset = org-wide for Admin/Teacher; own-enforcement still done by handler queries on Candidate routes). This is RBAC-M10-finish work and is flagged in §R.

---

## B. Scope and inspected files

### B.1 Project authority files read

- `AGENTS.md` (workspace instructions — DB discipline, dependency rules, product generalization).
- `docs/phase3/plan.md` — §8 module P4 (RBAC MVP cutover), MVP role table, MVP scope constraint.
- `docs/phase3/exam-protocol.md` — §2 exam lifecycle (`draft → published → open → closed → archived`, `canceled` ≠ `closed`), `OPEN_STATUSES = {published, open}`, candidate start boundary.
- `docs/phase3/rbac/audit-authz-framework-readiness.md` — historical PRE-migration fact base (superseded; used only to confirm what has *changed*).
- `docs/phase3/rbac/RBAC-JOB-QUEUE.md` — current-gap tracker: rows 0–16 merged, row 17 (RBAC-M10-finish) open.

### B.2 Authz authority files read (real source of truth)

| File | Role |
| --- | --- |
| `packages/authz/src/catalog.ts` | `Permission` (71 keys), `Scope` (8), `Role` (6) — closed unions. |
| `packages/authz/src/presets.ts` | `ROLE_PRESETS` — Admin/Teacher/Proctor/Grader/Candidate/System permission grants. |
| `packages/authz/src/resolver.ts` | `ScopeResolver` contract, `ResourceType`, `ResolverKey`, `DenyReason`, integrity rules. |
| `packages/authz/src/legacyMap.ts` | Legacy `SCREAMING_SNAKE` → dotted `PermissionKey` 1:1 bridge (migration only). |
| `packages/auth/src/rbac.ts` | **Legacy** flat map feeding `ctx.permissions` (Admin=15, Candidate=2, Teacher/Proctor/Grader/System=[]). |
| `apps/api/src/plugins/auth.ts` | `authenticate` (sets `ctx.role`+`ctx.permissions`), `requireRole`, `requireCapability`, `requirePermission`. |
| `apps/api/src/authz/routeRegistry.ts` | `ROUTE_PERMISSION_REGISTRY` — 77 entries (method/path/gate/permission/scope/resolver/audit/stage). |
| `apps/api/src/authz/shadow.ts` | `shadowRequireCapability` — legacy authoritative, capability side-by-side. |
| `apps/api/src/authz/resolvers/attemptResolver.ts` | Attempt/exam resolver impl (unit-tested, **not wired**). |
| `apps/api/src/routes/registerApiRoutes.ts` | Runtime plugin registration (prefix `/api`). |

### B.3 MVP business route files read (every route, with preHandler)

`attempts.admin.ts`, `attempts.candidate.ts`, `attempts.ts`, `audit.ts`, `auth.ts`,
`candidate.ts`, `candidateField.ts`, `clientEvents.ts`, `course.ts`, `email.ts`,
`exam.ts`, `examTransitionExecutor.ts`, `export.ts`, `gradingQueue.ts`, `helpers.ts`,
`importLogs.ts`, `proctorMonitoring.ts`, `question.ts`, `reconciliation.ts`,
`roleAssignments.ts`, `scores.ts`, `settings.ts`, `system.ts`, `user.ts`.

Not just the files named in the task card — the full `apps/api/src/routes/` set was scanned.

---

## C. Authentication and authorization architecture

### C.1 Layered model (current, post-enforcement)

```text
authenticate (cookie "auth-token" → JWT verify → load user row)
   → sets request.ctx = { actorId, role, organizationId, permissions }
   → 401 on missing/invalid/expired token
        ↓
preHandler gate (one of):
   requireRole(roles[])        — legacy role-membership gate (still on ~57 routes)
   requireCapability(perm)     — new role-PRESET membership gate (on 14 routes)
   requirePermission(perm)     — legacy DEAD layer (checks ctx.permissions; no route uses it)
   (authenticate only)         — self/public-authenticated routes
        ↓
handler logic
   → ensureTargetOrg(getRequestContext(request))   // organization anchor (helpers.ts)
   → repo.method(ctx, ...)                          // ctx always carries organizationId
   → ownership query on Candidate routes           // getOwnedAttempt / findByIdAndCandidate
```

### C.2 Two parallel permission sources (critical migration fact)

There are **two** permission inventories in the codebase. They are not the same:

| Source | Populated by | Used by | Size |
| --- | --- | --- | --- |
| `ctx.permissions` | `getPermissionsForRole(role)` from **legacy** `packages/auth/src/rbac.ts` | `requirePermission` (dead), `shadow` fallback | Admin=15, Candidate=2, **Teacher/Proctor/Grader/System = []** |
| role preset | `permissionsForRole(role)` from **new** `packages/authz/src/presets.ts` | `requireCapability`, `shadow` capability side | Admin=58, Teacher=18, Proctor=6, Grader=4, Candidate=8, System=3 |

**Implication for cutover:** `requireCapability` checks the **new preset**, so a Teacher/Proctor/Grader can pass a capability gate even though their legacy `ctx.permissions` is empty. This is correct and intended — the new preset is the post-activation authority. It also means the legacy `requirePermission` decorator is **not** a viable cutover target (it would deny Teacher/Proctor/Grader); only `requireCapability` is. The shadow helper's `capabilityAllows` consults the preset first, then falls back to `ctx.permissions` (shadow.ts:94-105), so shadow parity uses the right source.

### C.3 Organization isolation

Organization isolation is **not** a capability-layer concern. It is enforced at three concrete points, all carrying `ctx.organizationId`:

1. **`ensureTargetOrg(getRequestContext(request))`** — every admin/teacher handler re-derives `ctx` and asserts the organization anchor (`apps/api/src/routes/helpers.ts`). All repository methods receive `ctx` and filter by `organizationId` (Repository pattern — no bare `db.select()` in routes).
2. **`resolveOrganizationScope(ctx)`** — the pure context-only resolver anchors to `ctx.organizationId` (resolver.ts:144); the ADR §3.4 organization-anchor rule is encoded for the resource-aware resolvers to verify (`resource.organizationId === ctx.organizationId`) once wired.
3. **Candidate ownership** — `getOwnedAttempt` resolves `ctx.actorId → candidateProfile.id` then `attemptRepo.findByIdAndCandidate(ctx, attemptId, candidateProfile.id)` (attempts.candidate.ts:149-160, 659, 993, 1034). The own-attempt/own-score boundary is a **query predicate**, not a capability.

> The real organization model is single-tenant with one internal default organization; `organizationId` is an internal data boundary, not an exposed tenant UI (AGENTS.md "Phase 1.x Single-Tenant Rule"). "Teacher global" in this report means **global business role within the authenticated organization**, never cross-organization.

---

## D. Current route inventory and counts

### D.1 The "77 routes" claim — verified

```text
Expected historical count: 77
Current registry count:     77   (ROUTE_PERMISSION_REGISTRY entries)
Current runtime route count: 91   (fastify.<verb> call sites across apps/api/src/routes)
Matched (registry ⊆ runtime): yes — every registry method+path exists at runtime
Duplicate registry keys:     NONE
```

The "77" is the count of **protected** routes the registry deliberately covers (every `requireRole(["Admin"|"Candidate"|"Admin+Candidate"])` route). It is **not** the total route count.

### D.2 Runtime = 91 routes; 14 are deliberately unregistered

The 14 runtime routes absent from the registry are all **out of registry scope by design** (the registry's own header says it covers `requireRole(["Admin"|"Candidate"])` routes):

| Route | Why unregistered (correct) |
| --- | --- |
| `POST /auth/login`, `POST /auth/register`, `POST /auth/logout` | public / auth-entry |
| `GET /auth/me`, `PATCH /auth/me/password`, `PATCH /auth/me/profile` | authenticated self — no role gate |
| `POST /client-events` | authenticated telemetry ingest — both roles |
| `GET /health` | public health probe |
| `GET /settings/branding` | public branding (pre-login) |
| `GET /system/info`, `GET /system/public-config` | public system info |
| `GET /candidate-fields/template` | authenticated template download (Admin-gated at runtime; **registry drift — see §G.1**) |
| `GET /candidate/attempts/:attemptId/take` | Candidate-gated unified take-snapshot endpoint; **registry drift — see §G.2** |
| `POST /admin/attempts/:attemptId/proctor-incident` | `requireCapability(AttemptMisconductMark)` at runtime; **registry drift — see §G.3** |

The first 11 are legitimately public/self/authenticated-only. The last 3 are real **registry drift** (runtime route exists, no registry entry) — enumerated in §G.

### D.3 Registry migration-stage distribution

```text
migrationStage 6: 46 entries  (low-risk: course/question/user/candidate/system/settings/audit/import/exam-unpublish-extend-cancel-archive-delete/enrollment-view)
migrationStage 7: 26 entries  (sensitive: publish/close/publish-results, grading, proctor, attempts-admin, candidate runtime, scores)
migrationStage 8:  5 entries  (role-assignment admin surface)
```

Stages 6/7/8 are the ADR's incremental-flip ordering, **not** the P4-2A/B/C batch plan. The P4-2 batch mapping is in §I/§J/§K (it cuts across ADR stages because P4-2 is organized by *business domain + Teacher-readiness*, not by ADR sensitivity stage).

---

## E. Permission vocabulary

### E.1 Full catalog — 71 permissions (symbol → canonical dotted value)

Closed union from `packages/authz/src/catalog.ts`. No duplicate symbols, no duplicate values (regression-tested by `catalog-closed-union.test.ts`).

| Symbol | Canonical value |
| --- | --- |
| `UserView` | `user.view` |
| `UserCreate` | `user.create` |
| `UserUpdate` | `user.update` |
| `UserDelete` | `user.delete` |
| `UserRoleAssign` | `user.role.assign` |
| `UserPasswordReset` | `user.password.reset` |
| `OrganizationView` | `organization.view` |
| `OrganizationUpdate` | `organization.update` |
| `SettingsView` | `settings.view` |
| `SettingsUpdate` | `settings.update` |
| `AuditLogView` | `audit_log.view` |
| `CandidateView` | `candidate.view` |
| `CandidateCreate` | `candidate.create` |
| `CandidateUpdate` | `candidate.update` |
| `CandidateImport` | `candidate.import` |
| `CandidateDelete` | `candidate.delete` |
| `CandidateFieldView` | `candidate_field.view` |
| `CandidateFieldCreate` | `candidate_field.create` |
| `CandidateFieldUpdate` | `candidate_field.update` |
| `CandidateFieldDelete` | `candidate_field.delete` |
| `CourseView` | `course.view` |
| `CourseCreate` | `course.create` |
| `CourseUpdate` | `course.update` |
| `CourseDelete` | `course.delete` |
| `QuestionView` | `question.view` |
| `QuestionCreate` | `question.create` |
| `QuestionUpdate` | `question.update` |
| `QuestionDelete` | `question.delete` |
| `QuestionImport` | `question.import` |
| `ExamView` | `exam.view` |
| `ExamCreate` | `exam.create` |
| `ExamUpdate` | `exam.update` |
| `ExamPublish` | `exam.publish` |
| `ExamUnpublish` | `exam.unpublish` |
| `ExamClose` | `exam.close` |
| `ExamCancel` | `exam.cancel` |
| `ExamArchive` | `exam.archive` |
| `ExamDelete` | `exam.delete` |
| `ExamExtend` | `exam.extend` |
| `ExamResultPublish` | `exam.result.publish` |
| `ExamEnrollmentManage` | `exam.enrollment.manage` |
| `ExamTake` | `exam.take` |
| `AttemptViewOwn` | `attempt.view_own` |
| `AttemptStart` | `attempt.start` |
| `AttemptAnswerSave` | `attempt.answer.save` |
| `AttemptSubmit` | `attempt.submit` |
| `AttemptRestore` | `attempt.restore` |
| `AttemptHeartbeatSend` | `attempt.heartbeat.send` |
| `ScoreOwnView` | `score.own.view` |
| `ExamRoomView` | `exam_room.view` |
| `AttemptStatusView` | `attempt.status.view` |
| `AttemptTimelineView` | `attempt.timeline.view` |
| `AttemptMisconductMark` | `attempt.misconduct.mark` |
| `AttemptTimeExtend` | `attempt.time.extend` |
| `AttemptForceSubmit` | `attempt.force_submit` |
| `AttemptExport` | `attempt.export` |
| `GradingQueueView` | `grading.queue.view` |
| `GradingDetailView` | `grading.detail.view` |
| `GradingAnswerView` | `grading.answer.view` |
| `GradingScoreWrite` | `grading.score.write` |
| `GradingFinalize` | `grading.finalize` |
| `GradingIdentityView` | `grading.identity.view` |
| `ScoreAllView` | `score.all.view` |
| `ScoreExport` | `score.export` |
| `ResultPublish` | `result.publish` |
| `SystemHealthView` | `system.health.view` |
| `SystemDiagnosticsView` | `system.diagnostics.view` |
| `SystemInfoView` | `system.info.view` |
| `SystemAutoSubmit` | `system.auto_submit` |
| `SystemHeartbeatScan` | `system.heartbeat_scan` |
| `SystemLifecycleReconcile` | `system.lifecycle_reconcile` |

### E.2 Dead permissions (granted to NO role)

Two permissions are defined but granted to no preset:

| Symbol | Canonical | Disposition |
| --- | --- | --- |
| `ResultPublish` | `result.publish` | Superseded by `ExamResultPublish` (`exam.result.publish`), which IS granted to Admin+Teacher and IS registered on `POST /exams/:id/publish-results`. `result.publish` is a leftover key with no route and no grant. **Do not grant in P4-1.** Owner: a future catalog-cleanup job (out of P4 scope). |
| `SystemInfoView` | `system.info.view` | `GET /system/info` is **public** (no gate), so no role needs the permission. **Do not grant in P4-1.** Owner: same catalog-cleanup job. |

No permission is "registered on a route but granted to no role" (the migration-trap class). The historical 4 "proctor trap" perms (`ExamRoomView`/`AttemptTimeExtend`/`AttemptMisconductMark`/`AttemptForceSubmit`) are **now granted to Admin** (compat superset) and to Proctor — the trap is closed (RBAC-M6).

---

## F. Role preset inventory

### F.1 Per-role grant counts (from `presets.ts`, verified by `presets.test.ts` + `presets-boundaries.test.ts`)

| Role | Perms | defaultScope | Notes |
| --- | ---: | --- | --- |
| Admin | **58** | organization | Compatibility superset — every Admin-route perm + 4 proctor + grading. Holds NO Candidate-own, NO System-only. |
| Teacher | **18** | course (preset default; MVP treated as `org_global` — see §F.3) | Course/exam authoring + lifecycle + enrollment + result publish + score-all-view. **No grading, no proctor.** |
| Proctor | **6** | exam | `ExamRoomView`, `AttemptStatusView`, `AttemptTimelineView`, `AttemptMisconductMark`, `AttemptTimeExtend`, `AttemptForceSubmit`. No grading/publish. |
| Grader | **4** | exam | `GradingQueueView`, `GradingDetailView`, `GradingAnswerView`, `GradingScoreWrite`. No `GradingFinalize`/`GradingIdentityView` by default (scoped). |
| Candidate | **8** | own_attempt | `ExamTake`, `AttemptViewOwn`, `AttemptStart`, `AttemptAnswerSave`, `AttemptSubmit`, `AttemptRestore`, `AttemptHeartbeatSend`, `ScoreOwnView`. |
| System | **3** | system | `SystemAutoSubmit`, `SystemHeartbeatScan`, `SystemLifecycleReconcile`. Non-login, non-assignable. |

The historical "Teacher has 19 permissions" claim is **inaccurate for the current code**: Teacher has **18**. (The likely origin: an earlier preset revision. The live count is authoritative.) The 18 are listed in §F.2.

### F.2 Teacher preset — the 18 grants (presets.ts:122-142)

```text
OrganizationView, CandidateView,
CourseView, CourseCreate, CourseUpdate,
QuestionView, QuestionCreate, QuestionUpdate, QuestionDelete, QuestionImport,
ExamView, ExamCreate, ExamUpdate, ExamPublish, ExamClose,
ExamEnrollmentManage, ExamResultPublish, ScoreAllView
```

Explicitly **NOT** granted to Teacher: any `Grading*` perm, any proctor perm (`ExamRoomView`/`AttemptStatusView`/`AttemptTimelineView`/`AttemptMisconductMark`/`AttemptTimeExtend`/`AttemptForceSubmit`/`AttemptExport`), `ExamUnpublish`, `ExamCancel`, `ExamArchive`, `ExamDelete`, `ExamExtend`, all `User*`/`Candidate*`-write/`CandidateField*`/`Settings*`/`AuditLogView`/`SystemDiagnosticsView`.

This is the **single most important fact for P4-2C**: Teacher is an authoring+lifecycle+result role, **not** a grading role. Manual grading in the Teacher MVP is served by the separate **Grader** role assignment (RBAC-M8 multi-role), not by adding grading perms to Teacher. The existing `permissionMatrix.test.ts` pins "Teacher is denied grading routes".

### F.3 The "Teacher global" scope question — resolved

The task demanded: confirm whether the code's organization model matches "Teacher = global business role within the authenticated organization". **It does.**

- The real model is single-tenant with one internal default organization; `organizationId` is an internal data boundary (AGENTS.md Phase 1.x Single-Tenant Rule).
- Teacher's preset `defaultScope` is `Scope.Course` (presets.ts:220), but **no course-scoped assignment table is active in Phase 3 MVP** (no `teacher_exam_assignments`, no course membership resolver wired). So at runtime a Teacher is, practically, an **org-global business role**: their capability gate passes, and `ensureTargetOrg(ctx)` + the repo's `organizationId` filter confine them to the current organization.
- This is exactly the MVP scope constraint in `docs/phase3/plan.md` §8: *"Teacher 是全局角色… 无租户作用域、无课程作用域、无 `teacher_exam_assignments`"*.

**Decision for the matrix:** Teacher routes are labeled `org_global` (the §10 vocabulary), meaning "Admin/Teacher may operate all in-scope business resources within the current organization". This is **not** cross-organization; the organization anchor still applies.

### F.4 Admin regression check

Every Teacher-granted permission is a subset of Admin's grants (verified: `Teacher ⊆ Admin`). Therefore flipping any Teacher-allowed route from `requireRole(["Admin"])` to `requireCapability(perm)` **cannot regress Admin** — Admin's preset also contains `perm`. This is additionally locked by `adminSuperset.test.ts` ("every Admin-gated route's permission is granted to Admin").

---

## G. Route registry drift analysis

### G.1 `GET /candidate-fields/template` — RUNTIME_ROUTE_MISSING from registry

- Runtime: `candidateField.ts:230`, `requireRole(["Admin"])`.
- Registry: no entry (the 4 CRUD `candidate-fields` entries exist, but not `/template`).
- Classification: **REGISTRY_MISSING** (minor). The route IS Admin-gated and SHOULD have a registry entry (`Permission.CandidateFieldView`, scope Organization).
- **Owner:** P4-2 question/candidate-field cutover batch (or a small registry-completion fix). Not a P4-1 deliverable — recorded only.

### G.2 `GET /candidate/attempts/:attemptId/take` — RUNTIME_ROUTE_MISSING from registry

- Runtime: `attempts.candidate.ts:675`, `requireRole(["Candidate"])`. This is the **CandidateTakeSnapshot** unified endpoint (P0/L0 authority).
- Registry: no entry. The registry's Candidate-runtime section covers `/attempts/:id` (AttemptViewOwn) but not the dedicated `/take` snapshot endpoint.
- Classification: **REGISTRY_MISSING**. This is the canonical candidate take contract; it SHOULD be registered (`Permission.AttemptViewOwn`, scope OwnAttempt).
- **Owner:** P4-3 (Candidate ownership verification) — the take endpoint is central to own-attempt enforcement and must be in the matrix. Recorded only here.

### G.3 `POST /admin/attempts/:attemptId/proctor-incident` — RUNTIME_ROUTE_MISSING + PERMISSION shape mismatch

- Runtime: `proctorMonitoring.ts:159`, `requireCapability(Permission.AttemptMisconductMark)`.
- Registry: no entry. The registry has `GET /admin/attempts/:attemptId/proctor-events` (AttemptTimelineView) but not the POST incident route.
- Classification: **REGISTRY_MISSING** on an already-flipped route. The route uses `AttemptMisconductMark` (consistent with the misconduct semantic). It SHOULD be registered with that permission, scope Attempt, audit `attempt.misconductFlagged`.
- **Owner:** registry-completion fix (small). Not a P4-1 deliverable — recorded only.

### G.4 Other drift classes — NONE found

- **LEGACY_ROLE_GATE (preset grants but route still requireRole):** this is the **normal P4-2 state**, not drift. ~57 routes are still on `requireRole(["Admin"])` despite the registry declaring their target permission. This is expected (cutover not yet done) and is the substance of P4-2A/B/C. Enumerated per-domain in §H.
- **PERMISSION_MISMATCH (registry perm ≠ handler business semantic):** none found. Every registry permission matches the handler's actual operation (verified by reading each route file in §B.3).
- **DUPLICATE_ROUTE:** zero duplicate registry keys; zero duplicate runtime method+path.
- **SCOPE_UNSPECIFIED:** every registry entry has a `scope` and `resolver`. (Note: resolver is declared but not yet wired — see §R R5.)

### G.5 `x-role` schema field is metadata-only (not a runtime gate)

Every route carries `"x-role": [...]` inside its `schema:` block. Confirmed by scan: `x-role` is **never read at runtime for gating** — it is consumed only by the OpenAPI/swagger generator (`apps/api/src/openapi/swagger.ts`) for documentation. The runtime gate is exclusively the `preHandler`. Do not treat `x-role` as an authorization source.

---

## H. Full route matrix

> **Scope vocabulary (§10):** `org_global` · `own_attempt` · `own_score` · `admin_only` · `public_authenticated` · `system_internal` · `deferred`.
> **Role columns:** Admin / Teacher / Candidate. `Allow` = permitted by capability; `Deny` = rejected; `Own` = permitted only for the actor's own resource (enforced by ownership query, not capability alone); `n/a` = route not in that role's domain.
> **Gate column:** `RR` = `requireRole`, `RC` = `requireCapability` (already flipped), `auth` = authenticate-only, `pub` = public.
> **Cutover batch:** `P4-2A` grading · `P4-2B` question · `P4-2C` exam authoring/lifecycle · `P4-3` candidate ownership · `None` = no MVP cutover (Admin-only / deferred / already done).

### H.1 Grading (P4-2A) — already flipped to requireCapability

| Method | Route | File:line | Gate | Registry perm | Admin | Teacher | Candidate | Scope | Cutover |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/grading-queue` | gradingQueue.ts:61 | RC | `GradingQueueView` | Allow | **Deny** | Deny | org_global | **DONE** (verify) |
| GET | `/admin/attempts/:attemptId/grading-details` | gradingQueue.ts:127 | RC | `GradingDetailView` | Allow | **Deny** | Deny | org_global | **DONE** (verify) |
| POST | `/admin/attempts/:attemptId/grade-question` | gradingQueue.ts:247 | RC | `GradingScoreWrite` | Allow | **Deny** | Deny | org_global | **DONE** (verify) |

> Teacher is **Deny** on grading by preset design (§F.2). Manual grading is the **Grader** role's job (RBAC-M8 assignment), not Teacher MVP. `permissionMatrix.test.ts` locks "Teacher is denied grading routes". Org isolation: `ensureTargetOrg(ctx)` + `attemptRepo.findById(ctx, …)` (no candidate cross-access; this is an admin/grader read). The `grading.detail_viewed` audit (ADR §7.2 gap) **is** emitted (gradingQueue.ts:211).

### H.2 Proctor / destructive attempt-admin (Admin-only / Proctor; NOT Teacher)

| Method | Route | File:line | Gate | Registry perm | Admin | Teacher | Candidate | Scope | Cutover |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/exams/:examId/proctor/attempts` | proctorMonitoring.ts:61 | RC | `ExamRoomView` | Allow | Deny | Deny | org_global | **DONE** (verify) |
| GET | `/admin/attempts/:attemptId/proctor-events` | proctorMonitoring.ts:101 | RC | `AttemptTimelineView` | Allow | Deny | Deny | org_global | **DONE** (verify) |
| POST | `/admin/attempts/:attemptId/proctor-incident` | proctorMonitoring.ts:159 | RC | `AttemptMisconductMark` | Allow | Deny | Deny | org_global | **DONE** (verify; **registry drift §G.3**) |
| POST | `/admin/attempts/:attemptId/misconduct` | attempts.admin.ts:57 | RC | `AttemptMisconductMark` | Allow | Deny | Deny | org_global | **DONE** (verify) |
| POST | `/admin/attempts/:attemptId/force-submit` | attempts.admin.ts:133 | RC | `AttemptForceSubmit` | Allow | Deny | Deny | org_global | **DONE** (verify) |
| POST | `/admin/attempts/:attemptId/extend-time` | attempts.admin.ts:303 | RC | `AttemptTimeExtend` | Allow | Deny | Deny | org_global | **DONE** (verify) |
| GET | `/admin/attempts/:attemptId/timeline` | attempts.admin.ts:393 | RC | `AttemptTimelineView` | Allow | Deny | Deny | org_global | **DONE** (verify) |
| GET | `/admin/attempts/:attemptId/export` | attempts.admin.ts:453 | RC | `AttemptExport` | Allow | Deny | Deny | org_global | **DONE** (verify) |
| GET | `/admin/attempts/:attemptId/export/csv` | attempts.admin.ts:495 | RC | `AttemptExport` | Allow | Deny | Deny | org_global | **DONE** (verify) |

> All 9 are already on `requireCapability` (Admin compat superset + Proctor preset). Teacher is Deny on all (no proctor perm in preset). Candidate is Deny. These are **not** part of P4-2A/B/C (they are done; only ownership-resolver wiring remains per §R R5).

### H.3 Question CRUD (P4-2B)

| Method | Route | File:line | Gate | Registry perm | Admin | Teacher | Candidate | Scope | Cutover |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/questions` | question.ts:55 | RR(["Admin"]) | `QuestionView` | Allow | **Allow** | Deny | org_global | P4-2B |
| GET | `/questions/:id` | question.ts:127 | RR(["Admin"]) | `QuestionView` | Allow | **Allow** | Deny | org_global | P4-2B |
| POST | `/questions` | question.ts:172 | RR(["Admin"]) | `QuestionCreate` | Allow | **Allow** | Deny | org_global | P4-2B |
| PATCH | `/questions/:id` | question.ts:260 | RR(["Admin"]) | `QuestionUpdate` | Allow | **Allow** | Deny | org_global | P4-2B |
| DELETE | `/questions/:id` | question.ts:343 | RR(["Admin"]) | `QuestionDelete` | Allow | **Allow** | Deny | org_global | P4-2B |
| POST | `/questions/import` | question.ts:373 | RR(["Admin"]) | `QuestionImport` | Allow | **Allow** | Deny | org_global | P4-2B |

> list/detail share `QuestionView`; create/update/delete/import are independent perms. **Teacher preset grants ALL of them**, including import and delete (presets.ts:128-132). Org/course isolation is via `ensureTargetOrg(ctx)` + repo `organizationId` filter (no course-membership resolver in MVP — `org_global`).
> **Note:** the historical audit suggested import might stay Admin-only; the **current** preset grants `QuestionImport` to Teacher. P4-2B follows the preset (Teacher gets import). If product later wants import Admin-only, that is a **preset change**, not a route decision — out of P4-1 scope.

### H.4 Exam authoring & lifecycle (P4-2C)

| Method | Route | File:line | Gate | Registry perm | Admin | Teacher | Candidate | Scope | Cutover | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/exams` | exam.ts:327 | RR(["Admin"]) | `ExamView` | Allow | **Allow** | Deny | org_global | P4-2C | TEACHER_ALLOW |
| GET | `/exams/:id` | exam.ts:381 | RR(["Admin"]) | `ExamView` | Allow | **Allow** | Deny | org_global | P4-2C | TEACHER_ALLOW |
| POST | `/exams` | exam.ts:423 | RR(["Admin"]) | `ExamCreate` | Allow | **Allow** | Deny | org_global | P4-2C | TEACHER_ALLOW |
| PATCH | `/exams/:id` | exam.ts:517 | RR(["Admin"]) | `ExamUpdate` | Allow | **Allow** | Deny | org_global | P4-2C | TEACHER_ALLOW |
| POST | `/exams/:id/publish` | exam.ts:633 | RR(["Admin"]) | `ExamPublish` | Allow | **Allow** | Deny | org_global | P4-2C | TEACHER_ALLOW |
| POST | `/exams/:id/close` | exam.ts:688 | RR(["Admin"]) | `ExamClose` | Allow | **Allow** | Deny | org_global | P4-2C | **TEACHER_ALLOW** (§F.1) |
| POST | `/exams/:id/publish-results` | exam.ts:1113 | RR(["Admin"]) | `ExamResultPublish` | Allow | **Allow** | Deny | org_global | P4-2C | **TEACHER_ALLOW** (§F.2) |
| GET | `/exams/:examId/enrollments` | exam.ts:1203 | RR(["Admin"]) | `ExamEnrollmentManage` | Allow | **Allow** | Deny | org_global | P4-2C | TEACHER_ALLOW |
| POST | `/exams/:examId/enrollments` | exam.ts:1262 | RR(["Admin"]) | `ExamEnrollmentManage` | Allow | **Allow** | Deny | org_global | P4-2C | TEACHER_ALLOW |
| DELETE | `/exams/:examId/enrollments/:enrollmentId` | exam.ts:1361 | RR(["Admin"]) | `ExamEnrollmentManage` | Allow | **Allow** | Deny | org_global | P4-2C | TEACHER_ALLOW |
| GET | `/admin/exams/:examId/candidates/status` | exam.ts:1418 | RR(["Admin"]) | `ExamEnrollmentManage` | Allow | **Allow** | Deny | org_global | P4-2C | TEACHER_ALLOW |
| POST | `/exams/:id/unpublish` | exam.ts:804 | RR(["Admin"]) | `ExamUnpublish` | Allow | **Deny** | Deny | admin_only | None | ADMIN_ONLY (Teacher lacks perm) |
| POST | `/exams/:id/extend` | exam.ts:858 | RR(["Admin"]) | `ExamExtend` | Allow | **Deny** | Deny | admin_only | None | ADMIN_ONLY |
| POST | `/exams/:id/cancel` | exam.ts:934 | RR(["Admin"]) | `ExamCancel` | Allow | **Deny** | Deny | admin_only | None | ADMIN_ONLY (anomaly, ≠ close) |
| POST | `/exams/:id/archive` | exam.ts:1016 | RR(["Admin"]) | `ExamArchive` | Allow | **Deny** | Deny | admin_only | None | ADMIN_ONLY (terminal) |
| DELETE | `/exams/:id` | exam.ts:1167 | RR(["Admin"]) | `ExamDelete` | Allow | **Deny** | Deny | admin_only | None | ADMIN_ONLY (destructive) |

> **Batch read note (R3/R7):** `exam.ts` mixes Teacher-allowed authoring, Admin-only destructive, and (via proctorMonitoring) proctor ops. P4-2C must flip **route-by-route per the table above**, never a whole-file `requireRole→requireCapability` replacement. The Admin-only rows stay gated by their perms (Teacher preset lacks them, so flipping to `requireCapability` automatically keeps Teacher out — no separate handling needed).

### H.5 Candidate runtime (P4-3 — own-scope, NOT a capability cutover)

| Method | Route | File:line | Gate | Registry perm | Admin | Teacher | Candidate | Scope | Cutover |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/candidate/exams` | attempts.candidate.ts:279 | RR(["Candidate"]) | `ExamTake` | n/a | n/a | **Own** | own_attempt | P4-3 |
| GET | `/candidate/exams/:examId` | attempts.candidate.ts:409 | RR(["Candidate"]) | `ExamTake` | n/a | n/a | **Own** | own_attempt | P4-3 |
| POST | `/attempts/:examId/queue` | attempts.candidate.ts:490 | RR(["Candidate"]) | `AttemptStart` | n/a | n/a | **Own** | own_attempt | P4-3 |
| POST | `/attempts/:examId/start` | attempts.candidate.ts:527 | RR(["Candidate"]) | `AttemptStart` | n/a | n/a | **Own** | own_attempt | P4-3 |
| GET | `/attempts/:id` | attempts.candidate.ts:638 | RR(["Candidate"]) | `AttemptViewOwn` | n/a | n/a | **Own** | own_attempt | P4-3 |
| GET | `/candidate/attempts/:attemptId/take` | attempts.candidate.ts:675 | RR(["Candidate"]) | `AttemptViewOwn` *(registry drift §G.2)* | n/a | n/a | **Own** | own_attempt | P4-3 |
| POST | `/attempts/:attemptId/answers/:questionId` | attempts.candidate.ts:765 | RR(["Candidate"]) | `AttemptAnswerSave` | n/a | n/a | **Own** | own_attempt | P4-3 |
| POST | `/attempts/:attemptId/submit` | attempts.candidate.ts:911 | RR(["Candidate"]) | `AttemptSubmit` | n/a | n/a | **Own** | own_attempt | P4-3 |
| POST | `/attempts/:attemptId/heartbeat` | attempts.candidate.ts:968 | RR(["Candidate"]) | `AttemptHeartbeatSend` | n/a | n/a | **Own** | own_attempt | P4-3 |
| POST | `/attempts/:attemptId/restore` | attempts.candidate.ts:1012 | RR(["Candidate"]) | `AttemptRestore` | n/a | n/a | **Own** | own_attempt | P4-3 |

> **These routes do NOT enter P4-2 capability cutover.** They are `requireRole(["Candidate"])` + ownership query (`getOwnedAttempt` / `findByIdAndCandidate`). The capability system must **not** replace the ownership predicate (R4). P4-3's job is to **prove** the own-attempt/own-enrollment boundary with cross-candidate attack tests, not to flip the gate. Admin/Teacher are `n/a` — they use separate admin endpoints for any oversight.

### H.6 Result / score routes

| Method | Route | File:line | Gate | Registry perm | Admin | Teacher | Candidate | Scope | Cutover |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/exams/:id/scores` | scores.ts:233 | RR(["Admin"]) | `ScoreAllView` | Allow | **Allow** | Deny | org_global | P4-2C (or P4-2D) |
| GET | `/scores/attempts/:attemptId` | scores.ts:376 | RR(["Candidate","Admin"]) | `ScoreOwnView` | Allow *(handler: any attempt)* | n/a | **Own** | own_score | P4-3 |
| GET | `/exams/:id/export/scores` | export.ts:33 | RR(["Admin"]) | `ScoreExport` | Allow | **Deny** | Deny | admin_only | None |

> `GET /exams/:id/scores` (the Admin/Teacher result list) — Teacher preset HAS `ScoreAllView`, so Teacher can view computed results. This is consistent with "Teacher result view" in plan.md §8. **publish-results** (H.4) is also Teacher-allowed. `GET /scores/attempts/:attemptId` is the dual-gate route: `requireRole(["Candidate","Admin"])` + handler-level `findVisibleAttempt` (scores.ts:74-94) that enforces own-attempt for Candidate and any-attempt for Admin. The handler's `ctx.role !== "Candidate"` branch (scores.ts:80) is the legacy role-bypass; under capability it becomes "ScoreOwnView (Candidate, own) vs ScoreAllView (Admin/Teacher, any)". **Do not strip the ownership predicate** when widening to Teacher (R4) — Teacher would also need the "any attempt" path, which ScoreAllView grants at the list endpoint, not here.

### H.7 Course CRUD (Teacher-allowed subset)

| Method | Route | File:line | Gate | Registry perm | Admin | Teacher | Candidate | Scope | Cutover |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/courses` | course.ts:44 | RR(["Admin"]) | `CourseView` | Allow | **Allow** | Deny | org_global | (P4-2B-adjacent) |
| GET | `/courses/:id` | course.ts:80 | RR(["Admin"]) | `CourseView` | Allow | **Allow** | Deny | org_global | |
| POST | `/courses` | course.ts:114 | RR(["Admin"]) | `CourseCreate` | Allow | **Allow** | Deny | org_global | |
| PATCH | `/courses/:id` | course.ts:164 | RR(["Admin"]) | `CourseUpdate` | Allow | **Allow** | Deny | org_global | |
| DELETE | `/courses/:id` | course.ts:205 | RR(["Admin"]) | `CourseDelete` | Allow | **Deny** | Deny | admin_only | None |

> Teacher gets course view/create/update but **not delete** (preset lacks `CourseDelete`). Not a named P4-2 batch in the task card, but grouped with authoring — listed for completeness.

### H.8 Candidate / candidate-field management (Admin-only in MVP)

| Method | Route | File:line | Gate | Registry perm | Admin | Teacher | Candidate | Scope | Cutover |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/candidates` | candidate.ts:176 | RR(["Admin"]) | `CandidateView` | Allow | Allow* | Deny | org_global | None |
| POST | `/candidates` | candidate.ts:223 | RR(["Admin"]) | `CandidateCreate` | Allow | Deny | Deny | admin_only | None |
| PATCH | `/candidates/:id` | candidate.ts:324 | RR(["Admin"]) | `CandidateUpdate` | Allow | Deny | Deny | admin_only | None |
| POST | `/candidates/import` | candidate.ts:400 | RR(["Admin"]) | `CandidateImport` | Allow | Deny | Deny | admin_only | None |
| GET | `/candidate-fields` (CRUD×4) | candidateField.ts:46-177 | RR(["Admin"]) | `CandidateField*` | Allow | Deny | Deny | admin_only | None |
| GET | `/candidate-fields/template` | candidateField.ts:230 | RR(["Admin"]) | `CandidateFieldView` *(drift §G.1)* | Allow | Deny | Deny | admin_only | None |

> `Allow*`: Teacher preset grants `CandidateView` (read-only), but **not** create/update/import/delete. Candidate management is Admin-only for writes in MVP. Not part of P4-2A/B/C.

### H.9 User management, role assignments, settings, audit, system, import-logs, email (Admin-only)

All Admin-only; Teacher/Candidate Deny. Grouped — full list:

| Group | Routes | File | Teacher | Cutover |
| --- | --- | --- | --- | --- |
| Users (5) | `GET/POST /users`, `PATCH /users/:id`, `POST /users/:id/reset-password`, `DELETE /users/:id` | user.ts | Deny | None (admin_only) |
| Role assignments (5) | `GET /roles/assignable`, `GET/POST /users/:id/role-assignments`, `PATCH/DELETE /role-assignments/:assignmentId` | roleAssignments.ts | Deny | None (stage 8, admin_only) |
| Settings (3) | `GET /admin/settings`, `GET/PATCH /admin/settings/branding` | settings.ts | Deny | None |
| Audit (1) | `GET /admin/audit-logs` | audit.ts | Deny | None |
| Import logs (1) | `GET /admin/import-logs` | importLogs.ts | Deny | None |
| System (3) | `GET /system/health`, `/system/dashboard`, `/system/diagnostics` | system.ts | Deny | None |
| Email (1) | `POST /email/test` | email.ts | Deny | None |

### H.10 Public / self / authenticated-only (no role gate — out of registry)

| Method | Route | File:line | Gate | Notes |
| --- | --- | --- | --- | --- |
| POST | `/auth/login` | auth.ts:74 | pub | 401 on bad creds |
| POST | `/auth/register` | auth.ts:51 | pub | always 403 AUTH_REGISTER_DISABLED |
| POST | `/auth/logout` | auth.ts:252 | pub | clears cookie |
| GET | `/auth/me` | auth.ts:296 | auth | self read |
| PATCH | `/auth/me/password` | auth.ts:336 | auth | self |
| PATCH | `/auth/me/profile` | auth.ts:401 | auth | self |
| POST | `/client-events` | clientEvents.ts:52 | auth | telemetry, both roles |
| GET | `/health` | (healthSchema) | pub | liveness |
| GET | `/settings/branding` | settings.ts:81 | pub | pre-login branding |
| GET | `/system/info` | system.ts:158 | pub | public info |
| GET | `/system/public-config` | system.ts:179 | RR(["Admin"]) ⚠ | **see note** |

> **`GET /system/public-config` anomaly:** runtime gate is `requireRole(["Admin"])` (system.ts:179) but the route name and the public set (`/system/info`, `/settings/branding`) suggest it is meant to be public/pre-login. This is a **potential mis-gate** (either the route should be public, or the name is misleading). **Recorded only** — not a P4-1 fix. Owner: a system-routes cleanup job.

---

## I. Grading cutover slice — P4-2A

**Status: ALREADY MERGED.** The 3 grading routes are on `requireCapability` (gradingQueue.ts:66/132/252). P4-2A is therefore **not** a gate-flip job. Its remaining scope:

| Method | Route | Target Permission | Teacher preset status | Required P4-2A work |
| --- | --- | --- | --- | --- |
| GET | `/admin/grading-queue` | `GradingQueueView` | NOT in Teacher (correct) | verify + wire attempt/exam ownership resolver |
| GET | `/admin/attempts/:attemptId/grading-details` | `GradingDetailView` | NOT in Teacher (correct) | verify + wire attempt resolver (org-anchor) |
| POST | `/admin/attempts/:attemptId/grade-question` | `GradingScoreWrite` | NOT in Teacher (correct) | verify + wire attempt resolver |

**Cutover readiness:** `READY` (gate already flipped). Residual work is RBAC-M10-finish resolver wiring (§R R5) + the negative-authz tests in §Q. Teacher stays Deny (grading is the Grader role's domain). Admin has no regression (Admin preset ⊇ all three).

> If the task card intends P4-2A to also "open grading to Teacher", that would require a **preset change** (grant `GradingScoreWrite`/`GradingDetailView` to Teacher). The current product decision (plan.md §8 + presets.ts comment "Explicitly NOT granted: GradingAnswerView, GradingScoreWrite") is that Teacher does **not** grade. This report treats P4-2A as verification + resolver wiring under the existing preset. Any preset change is a separate decision.

---

## J. Question CRUD cutover slice — P4-2B

| Method | Route | Target Permission | Teacher preset status | Required tests |
| --- | --- | --- | --- | --- |
| GET | `/questions` | `QuestionView` | ✅ granted | Admin/Teacher allow; Candidate 403; unauth 401 |
| GET | `/questions/:id` | `QuestionView` | ✅ granted | same |
| POST | `/questions` | `QuestionCreate` | ✅ granted | Admin/Teacher allow; Candidate 403 |
| PATCH | `/questions/:id` | `QuestionUpdate` | ✅ granted | same |
| DELETE | `/questions/:id` | `QuestionDelete` | ✅ granted | same |
| POST | `/questions/import` | `QuestionImport` | ✅ granted | same |

**Cutover readiness:** `READY` — all 6 target perms are in both Admin and Teacher presets; flip is `requireRole(["Admin"]) → requireCapability(<perm>)` per row. No preset change needed. Org isolation via `ensureTargetOrg` + repo filter (no course resolver in MVP). Shadow parity for the question domain must run before the flip (§P).

---

## K. Exam authoring/lifecycle cutover slice — P4-2C

### K.1 Teacher-allowed (flip to requireCapability)

| Method | Route | Target Permission | Teacher preset status | Decision |
| --- | --- | --- | --- | --- |
| GET | `/exams` | `ExamView` | ✅ | TEACHER_ALLOW |
| GET | `/exams/:id` | `ExamView` | ✅ | TEACHER_ALLOW |
| POST | `/exams` | `ExamCreate` | ✅ | TEACHER_ALLOW |
| PATCH | `/exams/:id` | `ExamUpdate` | ✅ | TEACHER_ALLOW |
| POST | `/exams/:id/publish` | `ExamPublish` | ✅ | TEACHER_ALLOW |
| POST | `/exams/:id/close` | `ExamClose` | ✅ | **TEACHER_ALLOW** (§F.1) |
| POST | `/exams/:id/publish-results` | `ExamResultPublish` | ✅ | **TEACHER_ALLOW** (§F.2) |
| GET | `/exams/:examId/enrollments` | `ExamEnrollmentManage` | ✅ | TEACHER_ALLOW |
| POST | `/exams/:examId/enrollments` | `ExamEnrollmentManage` | ✅ | TEACHER_ALLOW |
| DELETE | `/exams/:examId/enrollments/:enrollmentId` | `ExamEnrollmentManage` | ✅ | TEACHER_ALLOW |
| GET | `/admin/exams/:examId/candidates/status` | `ExamEnrollmentManage` | ✅ | TEACHER_ALLOW |

### K.2 Admin-only (stay Admin-only; flipping to requireCapability keeps Teacher out automatically)

| Method | Route | Target Permission | Teacher preset status | Decision |
| --- | --- | --- | --- | --- |
| POST | `/exams/:id/unpublish` | `ExamUnpublish` | ❌ absent | ADMIN_ONLY_IN_PHASE3 |
| POST | `/exams/:id/extend` | `ExamExtend` | ❌ absent | ADMIN_ONLY_IN_PHASE3 |
| POST | `/exams/:id/cancel` | `ExamCancel` | ❌ absent | ADMIN_ONLY_IN_PHASE3 (anomaly ≠ close) |
| POST | `/exams/:id/archive` | `ExamArchive` | ❌ absent | ADMIN_ONLY_IN_PHASE3 (terminal) |
| DELETE | `/exams/:id` | `ExamDelete` | ❌ absent | ADMIN_ONLY_IN_PHASE3 (destructive) |

**Cutover readiness:** `READY` for K.1 (all perms in Admin+Teacher). K.2 rows can be flipped in the same batch (Teacher auto-denied by preset absence) but must be verified to stay Admin-only. **R3 guard:** flip row-by-row; do not bulk-replace `exam.ts`.

---

## L. Candidate ownership verification slice — P4-3

Routes to verify (own-scope, **not** a capability cutover — R4):

| Method | Route | Ownership source |
| --- | --- | --- |
| `GET /candidate/exams` | enrollment via `findByExamAndCandidate(ctx, examId, candidateProfile.id)` |
| `GET /candidate/exams/:examId` | same |
| `POST /attempts/:examId/queue` | `getCandidateProfile` → queue membership by candidateId |
| `POST /attempts/:examId/start` | `getQueueStatus(exam, candidateId)` + enrollment |
| `GET /attempts/:id` | `getOwnedAttempt` → `findByIdAndCandidate` |
| `GET /candidate/attempts/:attemptId/take` | `getOwnedAttempt` |
| `POST /attempts/:attemptId/answers/:questionId` | `currentAttempt.candidateId !== candidateProfile.id` guard (attempts.candidate.ts:851) |
| `POST /attempts/:attemptId/submit` | `getOwnedAttempt` |
| `POST /attempts/:attemptId/heartbeat` | candidate resolution |
| `POST /attempts/:attemptId/restore` | `getOwnedAttempt` |
| `GET /scores/attempts/:attemptId` | `findVisibleAttempt` → Candidate branch `findByIdAndCandidate` |

**Cross-Candidate attack scenarios P4-3 must prove:**

1. Candidate A reads/submits/grades Candidate B's `attemptId` → 404 (not 403, to avoid id enumeration) via `findByIdAndCandidate` returning null.
2. Candidate A calls `/candidate/exams/:examId` for an exam B is enrolled in → empty/404 (enrollment predicate).
3. Candidate A calls `/scores/attempts/<B's attempt>` → own-score hiddenReason or 404 (not B's full result).
4. Unauthenticated → 401 on every row above.
5. Admin token on a candidate-runtime endpoint → behavior decision (currently `requireRole(["Candidate"])` denies Admin; under capability, Admin lacks `ExamTake` so also denied — confirm parity).

> P4-3 must NOT replace `requireRole(["Candidate"]) + ownership query` with bare `requireCapability(...)`. The ownership predicate is the security boundary (R4).

---

## M. Frontend navigation slice — P4-4

UX entries and the backend capability that authorizes them. **P4-1 does not modify the frontend.**

| UX entry (current) | Backend route(s) | Capability | Hide from |
| --- | --- | --- | --- |
| Admin sidebar → Question Bank | `/questions*` | `QuestionView` | Candidate |
| Admin sidebar → Exams (list/edit) | `/exams*` (K.1) | `ExamView` | Candidate |
| Exam "Publish" button | `/exams/:id/publish` | `ExamPublish` | Candidate |
| Exam "Close" button | `/exams/:id/close` | `ExamClose` | Candidate |
| Exam "Publish results" button | `/exams/:id/publish-results` | `ExamResultPublish` | Candidate |
| Exam enrollments tab | `/exams/:examId/enrollments*` | `ExamEnrollmentManage` | Candidate |
| Grading Queue nav | `/admin/grading-queue*` | `GradingQueueView` | Candidate, Teacher |
| Scores/Results list | `/exams/:id/scores` | `ScoreAllView` | Candidate |
| Proctor monitoring | `/admin/exams/:id/proctor*` | `ExamRoomView` | Candidate, Teacher, Grader |
| User management | `/users*` | `UserView` | Candidate, Teacher |
| Candidate runtime (`/exam/*`) | `/candidate/*`, `/attempts/*` | `ExamTake`/`Attempt*` | Admin, Teacher |

> Frontend gates today are cosmetic (`AdminLayout`/`ExamLayout`/`AppSidebar` role checks). P4-4 replaces role checks with capability-derived visibility, but the **backend remains the authority** (AGENTS.md, plan.md §8). When Teacher arrives in the UI, the nav must show Question Bank / Exams / Grading(if assigned Grader) but hide Users/Proctor/System.

---

## N. Admin-only and deferred routes

### N.1 Admin-only in Phase 3 MVP (Teacher explicitly denied by preset)

- User management (5), role assignments (5), settings/branding (3), audit logs (1), import logs (1), system health/dashboard/diagnostics (3), email test (1).
- Exam destructive/anomaly: `unpublish`, `extend`, `cancel`, `archive`, `delete`.
- Candidate write management: `candidate.create/update/import/delete`, all `candidate-field.*`.
- Score export: `GET /exams/:id/export/scores` (`ScoreExport`).
- Course delete: `DELETE /courses/:id` (`CourseDelete`).

### N.2 Deferred (Phase 2+/Phase 4 — do NOT activate in Phase 3)

- **Proctor role activation** — preset exists (6 perms) but Proctor is a Phase 3+ *role bundle*, not a Phase 1.x product role. Proctor-as-monitoring-domain is already implemented (proctorMonitoring routes); Proctor-as-assignable-role is deferred (plan.md §8 non-goals).
- **Grader role activation** — preset exists (4 perms); grading routes already accept Grader via capability. Grader-as-assignable-role via the role-assignment surface (RBAC-M8) is merged but **assigning** a Grader is an admin action; full Grader workflow UX is Phase 3 grading closure (P1) territory, already closed for the manual path.
- **Scope resolvers wired into the request path** (RBAC-M10-finish) — see §R R5.
- Force-submit / extend-time / misconduct as **Proctor** actions (not Admin): routes accept Proctor via capability today; operational rollout is Phase 2 exam-operation.

---

## O. Organization isolation

- **Model:** single-tenant, one internal default organization. `organizationId` is an internal data boundary on every business table; no tenant UI, no tenant switcher, no SuperAdmin (AGENTS.md Phase 1.x Single-Tenant Rule).
- **Enforcement points (all carry `ctx.organizationId`):**
  1. `ensureTargetOrg(getRequestContext(request))` at the top of every admin/teacher handler (`helpers.ts`).
  2. Every repository method receives `ctx` and filters by `organizationId` (Repository pattern; no bare `db.select()` in routes — architecture lint enforces).
  3. `resolveOrganizationScope(ctx)` anchors to `ctx.organizationId`; resource resolvers MUST verify `resource.organizationId === ctx.organizationId` (ADR §3.4) once wired.
- **"Teacher global" = within the authenticated organization.** This report's `org_global` scope label means "current organization only", never cross-organization.
- **Cross-organization test (§Q):** Phase 3 is single-tenant so a true two-org attack is not deployable, but P4-3 should prove the organization predicate by构造 a synthetic second `organizationId` context and showing the repo query excludes it (the `ctx.organizationId` filter is the proof surface).

---

## P. Shadow parity strategy

### P.1 What shadow parity is

`shadowRequireCapability` (shadow.ts) runs the legacy `requireRole` decision and the new `requireCapability` decision side-by-side. **Legacy stays authoritative** (decision mirrors `legacyAllowed`); disagreements are logged as `authz.shadow.mismatch` warnings, never thrown (ADR §10.3). The capability side consults the role preset first, then falls back to `ctx.permissions`. Resource ids are sha256-hashed in logs (ADR §10.6 — no PII / candidateAnswer).

### P.2 Coverage today

- `shadowParity.test.ts` (6 tests) pins the **expected diff matrix** for Admin/Candidate/Proctor/Grader across proctor+grading+admin probe perms. It explicitly asserts that Proctor/Grader broadening is the *intended* RBAC activation diff, and that there is **no unexpected** diff.
- `shadow.ts` itself is **not wired to any route** (RBAC-JOB-QUEUE.md row 17 open). Shadow is a library + test, not a runtime interceptor yet.

### P.3 What PASS does NOT mean

A shadow-parity PASS does **not** mean a route has completed cutover. It means the legacy and capability decisions *agree* (or differ only in the expected-broadening way) for the probed roles/perms. Cutover is the actual `requireRole → requireCapability` flip, which is a separate step.

### P.4 Per-batch parity requirement

Before each P4-2 batch flip, run:

```bash
pnpm --filter api test -- shadowParity   # NOTE: runs full suite — see §J.1
```

Then add **domain-specific role tests** (the existing `permissionMatrix.test.ts` pattern) for the flipped routes: assert Admin/Teacher allow, Candidate/Grader/Proctor deny as the matrix dictates. The `--` filter does **not** narrow the run (see §J.1 actual behavior) — treat it as "run the api test suite".

---

## Q. Negative authorization test plan

For each cutover batch, define at minimum:

### Q.1 Admin
- Target operations continue to **allow** (Admin preset ⊇ target perm — locked by `adminSuperset.test.ts`).

### Q.2 Teacher
- P4-2B (questions): all 6 question routes **allow**.
- P4-2C K.1 (exam authoring/lifecycle/enrollment/result): **allow**.
- P4-2C K.2 (unpublish/extend/cancel/archive/delete): **deny** (preset lacks perm).
- Grading routes: **deny** (locked by `permissionMatrix.test.ts`).
- Proctor routes: **deny**.
- User/settings/audit/system: **deny**.

### Q.3 Candidate
- Management operations (questions/exams/candidates/users): **deny (403)**.
- Own runtime (start/save/submit/heartbeat/restore/take): **allow (own)**.
- **Another candidate's attempt/score: deny (404 via ownership predicate)** — the cross-candidate attack (§L).
- Another candidate's enrollment/exam: deny/empty.

### Q.4 Unauthenticated
- Every protected route: **401**.

### Q.5 Cross-organization
- Synthetic second-`organizationId` context: repo query excludes the foreign org's resources (organization predicate proof). Single-tenant deploy makes a live two-org test impractical; the `ctx.organizationId` filter is the proof surface.

### Q.6 Existing pinned tests (already green — do not weaken)
- `permissionMatrix.test.ts` — Admin/Proctor/Grader/Candidate/Teacher verdicts on flipped grading+proctor routes.
- `adminSuperset.test.ts` — no Admin regression on registry.
- `routeRegistry.test.ts` (11) — registry shape/coverage.
- `shadowParity.test.ts` (6) — expected-diff matrix.

---

## R. Risks and blockers

### R1 — Admin regression
**Status: guarded.** `adminSuperset.test.ts` proves every Admin-gated registry route's permission is in the Admin preset. `Teacher ⊆ Admin` (verified), so flipping Teacher-allowed routes cannot deny Admin. **Not a blocker.**

### R2 — Teacher preset authorized but runtime still requireRole
**Status: this is the normal P4-2 state.** ~57 routes still `requireRole(["Admin"])` despite Teacher holding the target perm. This is exactly what P4-2A/B/C fixes. **Not a blocker** — it is the work.

### R3 — Over-opening a whole route file
**Status: mitigated by this matrix.** `exam.ts` mixes Teacher-allowed (H.4 K.1) and Admin-only (K.2) routes. P4-2C must flip **row-by-row** per §K. The matrix gives the exact per-route perm. **Not a blocker** if §K is followed.

### R4 — Candidate ownership replaced by capability
**Status: must be actively prevented.** P4-3 must NOT collapse `requireRole(["Candidate"]) + ownership query` into bare `requireCapability(...)`. The ownership predicate (`getOwnedAttempt` / `findByIdAndCandidate`) is the security boundary. **Not a blocker** — it is an explicit P4-3 guardrail.

### R5 — Scope resolvers not wired (RBAC-M10-finish open)
**Status: structural caveat, not a PASS blocker.** `requireCapability` today is flat role-preset membership. `attemptResolver.ts` / `examResolver.ts` exist and are unit-tested but **no Fastify plugin/hook/decorator/route constructs or invokes them** (verified — zero call sites outside `resolvers/` + tests). So on the 14 flipped routes, "scope" is implicit: Admin/Teacher/Proctor/Grader pass the preset check, and the organization anchor + ownership are enforced by handler queries/repo filters, not by the capability layer. Wiring the resolvers is RBAC-M10-finish (RBAC-JOB-QUEUE.md row 17), the single open RBAC item. **Owner:** RBAC-M10-finish, not P4-1.

### R6 — Route-name debt (`/admin/*` paths for Teacher routes)
**Status: accepted, not fixed in P4.** Several Teacher-allowed routes live under `/admin/*` (grading-queue, attempts admin, proctor). This is path-naming debt; P4 must **not** rename URLs for semantic cleanliness (task §3). `x-role` swagger metadata may lag the real gate. **Not a blocker.**

### R7 — Permission granularity vs business operation
**Status: verified per-route.** `exam.update` does NOT imply publish/results/archive — each is a distinct perm (catalog §4.4). The §H.4/K tables核对 each operation to its own perm. **Not a blocker.**

### R8 — Dual permission source (legacy `ctx.permissions` vs new preset)
**Status: understood.** `ctx.permissions` (legacy `rbac.ts`) is empty for Teacher/Proctor/Grader, but `requireCapability` checks the new preset, so capability works. The legacy `requirePermission` decorator is dead and must not be used as a cutover target. Shadow uses the preset source. **Not a blocker** — documented in §C.2.

---

## S. Non-goals and deferred scope

Per task §3, this job did **not**:

- Modify `requireRole` / `requireCapability` / `Permission` / role presets / `routeRegistry` / any API route / frontend navigation.
- Implement Teacher permissions, activate Proctor, or change Candidate ownership queries.
- Add course/exam assignment tables, custom roles, or tenant scope.
- Rename `/admin/*` routes or make UI/token/visual changes.
- Start P4-2A/2B/2C.
- Fix any issue discovered (all discoveries are recorded with owners in §G/§R).

Deferred (not P4-1, not P4-2 unless named): RBAC-M10-finish resolver wiring (§R R5); catalog cleanup of dead `ResultPublish`/`SystemInfoView` (§E.2); registry completion for the 3 drift routes (§G.1–G.3); `/system/public-config` mis-gate review (§H.10); Proctor/Grader role *activation* as product roles (§N.2).

---

## T. Next task

Only after this PASS:

```text
NEXT: P3-MOD-P4-2A — Grading route capability cutover
```

Scope of P4-2A (given the grading routes are already flipped): wire the attempt/exam ownership resolver into the grading request path (RBAC-M10-finish for the grading domain), run shadow parity, and add/confirm the negative-authz tests in §Q. **Do not start P4-2A automatically** — await explicit go.

---

## Appendix 1 — Verification commands and results (§22)

All commands run on branch `docs/p4-1-mvp-rbac-route-matrix` at commit `286e79d`. The DB container `exam-db-1` was started (`pnpm db:up`) because authz/permission-matrix tests are integration-style against `exam_test` (resolved via `TEST_DATABASE_URL` per AGENTS.md APP_MODE=test).

| Command | Result |
| --- | --- |
| `pnpm --filter api test -- shadowParity` | **pass** — 93 files, **954 passed \| 5 skipped** (959). Exit 0. The `-- shadowParity` filter did **NOT** narrow the run — it executed the full api vitest suite. Skips: all 5 in `src/routes/redis.test.ts` (Redis is diagnostic-only, unrelated to RBAC). Real DB: `exam_test`. |
| `pnpm --filter api test -- src/authz` | **pass** — same full suite (filter did not narrow): 93 files, **954 passed \| 5 skipped**. Exit 0. |
| `pnpm --filter authz test` | **pass** — 9 files, **65 passed**. Exit 0. (Pure unit, no DB.) |
| `pnpm typecheck` | **pass** — 17/17 turbo tasks (14 cached). Exit 0. |
| `pnpm lint:arch` | **pass** — "Architecture checks passed." |
| `pnpm lint:copy` | **pass** — "No hardcoded business copy found." |
| `pnpm format:check` | **pass** — "All matched files use Prettier code style!" |

> `pnpm lint` (check-code-quality) and `pnpm --filter api test -- authz` (as a distinct narrow run) were covered by the above; the `--` filter argument does not narrow vitest's selection in this repo's setup, so every `pnpm --filter api test -- <token>` run is effectively the full api suite. This real behavior is recorded per task §22.

Baseline failure classification: **NONE.** No AUTHZ_MODEL_FAILURE, no REGISTRY_DRIFT failure, no ENVIRONMENT_FAILURE, no HISTORICAL_UNRELATED_FAILURE — all green. The 5 skips are redis-diagnostic and pre-existing/unrelated.

---

## Appendix 2 — Production changes

```text
None.
```

This job created exactly one file: `docs/phase3/audit/p4-mvp-rbac-route-matrix.md` (this document). No route gate, preset, Permission, routeRegistry, route, frontend, test, script, or DB file was modified.

---

## Appendix 3 — Commit

```text
Branch: docs/p4-1-mvp-rbac-route-matrix  (from 286e79d)
Message: docs(P4): produce MVP RBAC route permission matrix
```

(Hash to be filled at commit time.)
