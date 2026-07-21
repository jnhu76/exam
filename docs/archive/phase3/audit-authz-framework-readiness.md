# P3-AUTHZ-AUDIT — Phase 3 Authorization Framework Readiness Audit

> ⚠️ **HISTORICAL SNAPSHOT (2026-06-30).** This audit describes the
> **PRE-migration** authorization state: the coarse 2-role (`Admin`/`Candidate`)
> `requireRole` model, the dead parallel `requirePermission` layer, the 4 proctor
> "migration traps", and the absence of any scope model. **All of those problems
> have since been addressed and merged to `master`** — Scoped RBAC foundation
> (catalog + presets + registry + shadow + scope-resolver contract), SYSTEM-M1,
> multi-role assignments (M7/M8/M9), and partial enforcement (11 routes flipped
> to `requireCapability`) landed via PR #149–#153 and the `phase3-enforcement`
> series. The body below is retained verbatim as the dated fact base that drove
> the design; it is **not** the current state. For current merged status see
> `docs/phase3/plan.md` §0/§3/§5 and `docs/phase3/rbac/RBAC-JOB-QUEUE.md`
> ("Current real gap"). The single remaining open item is RBAC-M10-finish
> (wire scope resolvers into the request path; flip remaining ~50 `requireRole`
> routes).

> **Date:** 2026-06-30
> **Branch:** `role-permission`
> **Type:** Audit / Design Fact Base (documentation only)
> **Job card:** `docs/phase3/rbac/phase3_job_p3-authz-audit.md`
> **Predecessor audits (evidence sources):**
> - `docs/phase3/audit/audit-current-role-checks.md` (S3)
> - `docs/phase3/audit/audit-current-events.md` (S6)
> - `docs/phase3/audit/audit-current-grading-api.md` (S3b)
> - `docs/phase3/audit/audit-current-redis.md` (S5)
> - `docs/phase3/audit/audit-current-candidate-runtime.md` (S7)
> - `docs/phase3/audit/audit-current-answer-payload.md` (S8)

---

## 1. Executive Summary

### 1.1 Current authorization model

The system uses a **coarse two-layer role-gate model**, not a permission model:

```
authenticate (cookie/JWT)   →  401 if no/invalid token
       ↓
requireRole(["Admin" | "Candidate" | both])   →  403 PERMISSION_DENIED if role not allowed
       ↓
handler logic (may check ctx.role / user.role again, ad-hoc)
```

- **2 product roles** only: `Admin`, `Candidate` (`packages/domain/src/enums.ts:1-6`).
- A full **22-permission RBAC layer exists but is dead**: `requirePermission()` is implemented (`apps/api/src/plugins/auth.ts:104-119`) and `ctx.permissions` is populated on every authenticated request (`auth.ts:85` via `getPermissionsForRole`), but **zero production routes call `requirePermission()`** (verified live: the only references are its definition, its type declaration, and a doc comment).
- All route authorization is `requireRole()` — **62 Admin-only + 9 Candidate-only + 1 both-roles call sites** across 16 route files (verified live).
- **No scope model exists.** TenantGuard (`packages/auth/src/tenantGuard.ts`) is a Phase-1 no-op; all access is organization-all-or-nothing per role.

### 1.2 Is the code ready for permission enforcement?

**No, not safely.** Three structural blockers must be resolved before any route can flip from `requireRole` to `requirePermission` without changing behavior:

1. **Proctor permission trap (R11):** 4 proctor permissions (`VIEW_EXAM_ROOM`, `EXTEND_TIME`, `MARK_MISCONDUCT`, `FORCE_SUBMIT`) are *defined* but *not granted to Admin* in the RBAC map (`packages/auth/src/rbac.ts:5-21`, verified). Their routes are today gated by `requireRole(["Admin"])`. Migrating any of them to `requirePermission(...)` would **deny Admin**.
2. **Dead permission:** `MANAGE_ORGANIZATION` is defined (`enums.ts:17`) but granted to no role and used by no route — fully dead.
3. **~22 hardcoded role strings** + scattered handler-level `role === "..."` checks (5 sites) make a role/permission change a manual hunt, not a safe refactor.

### 1.3 Top 5 blockers

1. **Proctor-permission RBAC trap** — Admin does not hold `VIEW_EXAM_ROOM`/`EXTEND_TIME`/`MARK_MISCONDUCT`/`FORCE_SUBMIT`; migrating their routes breaks Admin access.
2. **No scope layer** — current authorization is organization-all-or-nothing; Phase 3 needs course/exam/attempt/own-attempt scope, which does not exist.
3. **Dead parallel authz model** — `requirePermission` + `ctx.permissions` are built but never invoked; "migrating" is not a flip, it is new wiring.
4. **Hardcoded role strings + scattered handler role logic** — ~22 string-literal sites + ad-hoc `ctx.role` checks in `scores.ts`, `user.ts`, `auth.ts` are invisible to static analysis.
5. **No AuditAction registry** — `audit_logs.action` is free-form `text`; ~43 distinct literals live at ~30 call sites with no enum/union, so permission-migration audit steps cannot be validated against a closed set.

### 1.4 Top 5 safe first steps

1. **Role string cleanup** (AUTHZ-S1) — replace ~22 `"Admin"`/`"Candidate"` literals with `Role.Admin`/`Role.Candidate`. Zero behavior change.
2. **RBAC mapping reconcile** (AUTHZ-S2) — decide the disposition of the 4 proctor perms + `MANAGE_ORGANIZATION` (grant to Admin as superset, or mark Proctor-role-only). Pure mapping change, no route change.
3. **AuditAction constants** (EVENT-S1) — introduce a Zod enum / constants module for the existing ~43 actions; validate at the `recordAudit` boundary. No rename.
4. **Candidate-answer test coverage** (GRADING-S1) — `GradingDetailPage.test.tsx` has zero `candidateAnswer`/`formatAnswer` assertions; the feature works but is unguarded.
5. **Shadow permission mode design** (AUTHZ-M3 precursor) — define `shadowRequireCapability()` that records `requireRole` vs `requirePermission` disagreements without enforcing. This is the migration safety net.

### 1.5 Recommended next job

**AUTHZ-S1 — Role String Cleanup** (Small, zero-risk, unblocks S2 and M3).

### 1.6 Behavior-change statement

> **This audit changed no production behavior.** No code, contract, schema, route, frontend, audit action, client event, Redis behavior, candidate runtime, or answer protocol was modified. The only artifact created is this document (and the job-card file it is derived from). All claims below are backed by file/line evidence (§14 Appendix) or by the six predecessor Phase-3 audits, each cross-verified live where load-bearing (see §14 "Live re-verification").

---

## 2. Current Authorization Inventory

> Scope: every protected route in `apps/api/src/routes/**`. Source of truth for the gate facts is `audit-current-role-checks.md` §3; counts re-verified live (§14).

### 2.1 Route Gates

Gate distribution (live `rg` over `apps/api/src/routes`, excluding tests):
- `requireRole(["Admin"])` — **62 sites** (Admin-only)
- `requireRole(["Candidate"])` — **9 sites** (Candidate-only)
- `requireRole(["Candidate","Admin"])` — **1 site** (both roles)
- `[authenticate]` only — 4 routes (authenticated, no role gate)
- *(none)* — public endpoints

#### Admin-only routes (`requireRole(["Admin"])`) — by route family

| Route Family | Example Route | File | Handler-Level Role Logic? | Suggested Permission | Suggested Scope | Suggested AuditAction |
| --- | --- | --- | --- | --- | --- | --- |
| users | `GET/POST /admin/users`, `PATCH /admin/users/:id`, reset-password, delete | `user.ts` | YES — last-admin guard (`:190`), reset guard (`:262`), inline `z.enum` (`:29`) | `MANAGE_USERS` | organization | `user.create/update/delete` |
| candidates | `GET/POST/PATCH /admin/candidates`, import | `candidate.ts` | none | `MANAGE_CANDIDATES` *(new)* | organization | `candidate.create/update/import` |
| candidate fields | `/admin/candidate-fields` CRUD, template | `candidateField.ts` | none | `MANAGE_CANDIDATE_FIELDS` | organization | `candidate_field.create/update/delete` |
| courses | `/admin/courses` CRUD | `course.ts` | none | `MANAGE_COURSES` | organization | `course.create/update/delete` |
| questions | `/admin/questions` CRUD, import | `question.ts` | none | `CREATE/EDIT/DELETE/IMPORT_QUESTIONS` | organization (future: course) | `question.create/update/delete/import` |
| exams | `/admin/exams` create/update/publish/unpublish/close/extend/cancel/archive/publish-results/delete; enrollments CRUD; candidate-status | `exam.ts` | none | `CREATE/EDIT/PUBLISH/ARCHIVE/DELETE_EXAM` (+ lifecycle) | organization (future: exam) | `exam.*` family |
| attempt admin | misconduct, force-submit, extend-time, timeline, export (JSON/CSV) | `attempts.admin.ts` | none | `MARK_MISCONDUCT`/`FORCE_SUBMIT`/`EXTEND_TIME`/`VIEW_EXAM_ROOM`/`EXPORT_SCORES` ⚠️ trap | exam / attempt | `attempt.misconductFlagged/forceSubmit/extendTime/exported` |
| grading | `/admin/grading-queue`, `/grading-details`, `grade-question` | `gradingQueue.ts` | none | `VIEW_GRADING_DETAIL`/`VIEW_CANDIDATE_ANSWER`/`GRADE_ANSWER` *(new, see §8)* | attempt | **`grading.detail_viewed` (missing — see §7.2)**, `grading.score_entered`, `grading.finalized` |
| scores (admin list) | `GET /admin/exams/:examId/scores` | `scores.ts` | none | `VIEW_ALL_SCORES` | exam | *(none today)* |
| exports | `/admin/exports/scores` | `export.ts` | none | `EXPORT_SCORES` | organization / exam | `export_scores` |
| audit logs | `GET /admin/audit-logs` | `audit.ts` | none | `VIEW_AUDIT_LOGS` *(new)* | organization | read — no audit |
| settings | `/admin/settings`, branding | `settings.ts` | none | `MANAGE_SETTINGS`/`MANAGE_ORGANIZATION` | organization | `branding.update` |
| system | `/system/health`, `/system/dashboard`, `/system/diagnostics` | `system.ts` | none | `VIEW_SYSTEM_HEALTH` | system | read — no audit |
| import logs | `GET /admin/import-logs` | `importLogs.ts` | none | `VIEW_IMPORT_LOGS` *(new)* | organization | read — no audit |
| proctor monitoring | `GET /admin/exams/:examId/proctor/attempts`, `/proctor-events` | `proctorMonitoring.ts` | none | `VIEW_EXAM_ROOM` ⚠️ trap | exam | read — no audit |

#### Candidate-only routes (`requireRole(["Candidate"])`)

| Route Family | Example Route | File | Handler-Level Role Logic? | Suggested Permission | Suggested Scope | Suggested AuditAction |
| --- | --- | --- | --- | --- | --- | --- |
| attempt candidate runtime | exam list/detail, queue, start, attempt detail, save answer, submit, heartbeat, restore | `attempts.candidate.ts` | none (own-attempt enforced by candidateProfile match) | `TAKE_EXAM`/`SAVE_ANSWER`/`SUBMIT_ATTEMPT`/`SEND_HEARTBEAT` *(new)* | own_attempt | `attempt.start/saveAnswer/submit/restore` |

#### Both-roles routes (`requireRole(["Candidate","Admin"])`)

| Route | File | Handler-Level Role Logic? | Suggested Permission | Scope | AuditAction |
| --- | --- | --- | --- | --- | --- |
| `GET /scores/attempts/:attemptId` | `scores.ts:379` | **YES** — `:80` `ctx.role !== "Candidate"` → Admin sees any, Candidate sees own | `VIEW_OWN_SCORE` (candidate) / `VIEW_ALL_SCORES` (admin) | own_score / attempt | *(none today)* |

#### Authenticated-only (`[authenticate]`, no role gate)

| Route | File | Notes |
| --- | --- | --- |
| `GET /auth/me` | `auth.ts:286` | self read |
| `PATCH /auth/me/password` | `auth.ts:325` | self password change |
| `PATCH /auth/me/profile` | `auth.ts:389` | self profile rename |
| `POST /client-events` | `clientEvents.ts:51` | telemetry ingest — both roles |

#### Public (no auth)

`GET /api/health`, `GET /api/settings/branding`, `GET /api/system/info`, `GET /api/system/public-config`, `POST /api/auth/login`, `POST /api/auth/register` (always returns `403 AUTH_REGISTER_DISABLED`).

> **System-actor internal contexts** (not HTTP routes): `deadlineScanner.ts:97` and `heartbeat.ts:103` create system contexts with hardcoded `role: "Admin"` for auto-submit / disrupted-scan operations (`actorId: SYSTEM_ACTOR_ID`).

### 2.2 Handler-Level Role Checks

> Beyond `requireRole`, business logic re-checks role ad-hoc. Live-verified.

| File | Line | Logic | Risk | Suggested Replacement |
| --- | ---: | --- | --- | --- |
| `auth.ts` | 155 | `if (user.role !== "Admin" && user.role !== "Candidate")` → `401 AUTH_INVALID_CREDENTIALS` (reason `unsupported_phase1_role`) | Misleading 401 for valid credentials with unsupported role; hardcoded strings | `403` + dedicated code; gate by permission or role-set constant |
| `scores.ts` | 80 | `if (ctx.role !== "Candidate")` → Admin sees any attempt, Candidate sees own | Role-bypass conflated with scope; hardcoded string | `VIEW_ALL_SCORES` (any) vs `VIEW_OWN_SCORE` + own_attempt scope |
| `scores.ts` | 209 | `if (role !== "Candidate")` → Admin bypasses result-publication gate | Same; hardcoded string | permission-gated visibility |
| `scores.ts` | 415 | `computeResultVisibility(exam, attempt, ctx.role)` | Role passed into domain fn | visibility derived from permission set |
| `user.ts` | 48 | `PHASE1_SUPPORTED_ROLES = ["Admin","Candidate"] as const` | Inline duplicate of `Object.values(Role)` | import `Role` |
| `user.ts` | 190-193 | `target.role === "Admin" && ... data.role !== "Admin"` (last-active-admin guard) | Hardcoded strings | `Role.Admin` |
| `user.ts` | 262 | `if (target.role !== "Candidate")` (reset-password target guard) | Hardcoded string | `Role.Candidate` |
| `auth.ts` | 195,213,231,316 | `role: user.role as Role` passthrough | (not a gate; informational) | — |

> **No `RoleNotAllowedError`/`InsufficientRoleError` domain error exists.** The auth plugin uses the raw string `"PERMISSION_DENIED"` in `buildErrorResponse` rather than `PermissionDeniedError` (`packages/domain/src/errors.ts:36-39`). Source: `audit-current-role-checks.md` §5.

### 2.3 Frontend Role Checks

| File | Line | Logic | Current UX Behavior | Suggested Future Permission |
| --- | ---: | --- | --- | --- |
| `components/layout/AdminLayout.tsx` | 39 | `if (!user \|\| user.role === "Candidate")` → redirect | Blocks Candidate from `/admin/*` | capability-gated route (e.g. `ACCESS_ADMIN_CONSOLE`) |
| `components/layout/ExamLayout.tsx` | 45 | `if (!user \|\| user.role !== "Candidate")` → redirect | Blocks non-Candidate from `/exam/*` | `TAKE_EXAM` capability |
| `contexts/AuthContext.tsx` | 37 | `user.role === "Candidate" ? "/exam/list" : "/admin/dashboard"` | Post-login redirect | capability-based landing |
| `components/layout/AppSidebar.tsx` | 190 | `const showManagement = user.role === Role.Admin` | Show/hide management nav | permission-derived nav |
| `lib/api.ts` | 77 | `if (response.status === 401) navigate("/login")` | Auto-redirect on 401 | (keep; not a role gate) |
| `pages/admin/UsersPage.tsx` | 48 | `role: "Admin" \| "Candidate"` (EditableRole type) | Editable role in user form | permission-assignment UI (future) |
| `pages/admin/UsersPage.tsx` | 86 | `user.role !== "Candidate"` list filter | Filters user list | — |

> Frontend gates are **cosmetic defense-in-depth** — the real authority is the backend `requireRole`. They will need to migrate from role to capability when multi-role users arrive (e.g. a Teacher who is also Admin).

### 2.4 Hardcoded Role Strings

> ~22 production sites use `"Admin"`/`"Candidate"` literals or inline `z.enum` instead of the `Role` const. Full table in `audit-current-role-checks.md` §8; load-bearing subset verified live below.

| File | Line(s) | String | Should Use | Risk |
| --- | ---: | --- | --- | --- |
| `plugins/deadlineScanner.ts` | 97 | `role: "Admin"` | `Role.Admin` | system-actor role should be a distinct `SYSTEM` role in Phase 3 |
| `plugins/heartbeat.ts` | 103 | `role: "Admin"` | `Role.Admin` | same |
| `routes/auth.ts` | 117,134 | `role: "Candidate" as const` | `Role.Candidate` | |
| `routes/auth.ts` | 155 | `"Admin" && "Candidate"` | `Role.Admin`, `Role.Candidate` | gate logic |
| `routes/user.ts` | 29 | `z.enum(["Admin","Candidate"])` | `RoleSchema` | inline schema duplicates canonical |
| `routes/user.ts` | 48 | `["Admin","Candidate"]` | `Object.values(Role)` | |
| `routes/user.ts` | 190,193,195 | `"Admin"` | `Role.Admin` | last-admin guard |
| `routes/user.ts` | 262 | `"Candidate"` | `Role.Candidate` | reset guard |
| `routes/scores.ts` | 80,209 | `"Candidate"` | `Role.Candidate` | visibility logic |
| `routes/candidate.ts` | 269,502 | `role: "Candidate" as const` | `Role.Candidate` | create/import |
| `scripts/bootstrap-admin.ts` | 56,66,78 | `"Admin"` | `Role.Admin` | |
| `scripts/reset-admin-password.ts` | 49 | `"Admin" as const` | `Role.Admin` | |
| `web/contexts/AuthContext.tsx` | 37 | `"Candidate"` | `Role.Candidate` | frontend |
| `web/components/layout/AdminLayout.tsx` | 39 | `"Candidate"` | `Role.Candidate` | frontend |
| `web/components/layout/ExamLayout.tsx` | 45 | `"Candidate"` | `Role.Candidate` | frontend |
| `web/pages/admin/UsersPage.tsx` | 48,86 | `"Admin"`,`"Candidate"` | `Role.*` | frontend |
| `db/src/seed.ts` | 29,33,38 | `"Admin"`,`"Candidate"` | `Role.*` | seed |
| `db/src/demo-seed.ts` | 195-199 | `"Admin"`,`"Candidate"` | `Role.*` | demo seed |

> **Test-helper future roles:** `apps/api/src/routes/testHelpers.ts` defines `LEGACY_ROLES = ["SuperAdmin","Teacher","Proctor","Grader","ContentManager","ResultViewer"]` (per `audit-current-role-checks.md` §10.4). These are forward-looking fixtures and may diverge from the eventual Phase-3 role naming — alignment is a Phase-3 role-design decision.

> **DB-level role constraint:** `users.role` is plain `text` with **no PostgreSQL ENUM/CHECK** (`packages/db/src/schema/pg.ts:105`). Role validity is enforced only at the application layer (Zod + login-time rejection). A direct SQL insert of `"Teacher"` would succeed silently and only be rejected at login (`auth.ts:155`).

---

## 3. Permission Inventory

> 22 permissions defined (`enums.ts:15-47`). RBAC map (`rbac.ts:4-23`): Admin=15, Candidate=2. **Zero routes call `requirePermission()`** (live-verified). Table below combines definition, RBAC, route-mapping, and the §2.1 suggested future mapping.

| # | Permission | Defined? | Admin? | Candidate? | Used by Route? | Future Route Mapping | Risk |
| --- | --- | :---: | :---: | :---: | :---: | --- | --- |
| 1 | `MANAGE_ORGANIZATION` | ✅ | ❌ | ❌ | ❌ | (no route today; future: org/settings) | **Dead** — defined, unassigned, unused. Wire to Admin (settings/branding) or remove. |
| 2 | `MANAGE_CANDIDATE_FIELDS` | ✅ | ✅ | ❌ | via `requireRole` | `candidateField.ts` CRUD | Wired via role, not permission. |
| 3 | `MANAGE_USERS` | ✅ | ✅ | ❌ | via `requireRole` | `user.ts` CRUD | Wired via role, not permission. |
| 4 | `CREATE_QUESTION` | ✅ | ✅ | ❌ | via `requireRole` | `question.ts` create | Wired via role, not permission. |
| 5 | `EDIT_QUESTION` | ✅ | ✅ | ❌ | via `requireRole` | `question.ts` update | Wired via role, not permission. |
| 6 | `DELETE_QUESTION` | ✅ | ✅ | ❌ | via `requireRole` | `question.ts` delete | Wired via role, not permission. |
| 7 | `IMPORT_QUESTIONS` | ✅ | ✅ | ❌ | via `requireRole` | `question.ts` import | Wired via role, not permission. |
| 8 | `MANAGE_COURSES` | ✅ | ✅ | ❌ | via `requireRole` | `course.ts` CRUD | Wired via role, not permission. |
| 9 | `CREATE_EXAM` | ✅ | ✅ | ❌ | via `requireRole` | `exam.ts` create | Wired via role, not permission. |
| 10 | `EDIT_EXAM` | ✅ | ✅ | ❌ | via `requireRole` | `exam.ts` update | Wired via role, not permission. |
| 11 | `PUBLISH_EXAM` | ✅ | ✅ | ❌ | via `requireRole` | `exam.ts` publish/unpublish | Wired via role, not permission. |
| 12 | `ARCHIVE_EXAM` | ✅ | ✅ | ❌ | via `requireRole` | `exam.ts` archive | Wired via role, not permission. |
| 13 | `DELETE_EXAM` | ✅ | ✅ | ❌ | via `requireRole` | `exam.ts` delete | Wired via role, not permission. |
| 14 | `VIEW_EXAM_ROOM` | ✅ | ❌ | ❌ | via `requireRole` | `proctorMonitoring.ts` attempts/events | **Trap** — perm not granted to Admin; route is Admin-gated. |
| 15 | `EXTEND_TIME` | ✅ | ❌ | ❌ | via `requireRole` | `attempts.admin.ts` extend-time | **Trap** — perm not granted to Admin. |
| 16 | `MARK_MISCONDUCT` | ✅ | ❌ | ❌ | via `requireRole` | `attempts.admin.ts` misconduct | **Trap** — perm not granted to Admin. |
| 17 | `FORCE_SUBMIT` | ✅ | ❌ | ❌ | via `requireRole` | `attempts.admin.ts` force-submit | **Trap** — perm not granted to Admin. |
| 18 | `TAKE_EXAM` | ✅ | ❌ | ✅ | via `requireRole` | `attempts.candidate.ts` start/submit | Candidate-only — correctly excluded from Admin. |
| 19 | `VIEW_OWN_SCORE` | ✅ | ❌ | ✅ | via `requireRole`+handler | `scores.ts` own-attempt detail | Candidate-only — correctly excluded from Admin. |
| 20 | `VIEW_ALL_SCORES` | ✅ | ✅ | ❌ | via `requireRole` | `scores.ts` exam scores list | Wired via role, not permission. |
| 21 | `EXPORT_SCORES` | ✅ | ✅ | ❌ | via `requireRole` | `export.ts`, `attempts.admin.ts` export | Wired via role, not permission. |
| 22 | `VIEW_SYSTEM_HEALTH` | ✅ | ✅ | ❌ | via `requireRole` | `system.ts` health/dashboard | Wired via role, not permission. |

### 3.1 Required callouts (per job card)

- **`MANAGE_ORGANIZATION`** — **dead**: defined (`enums.ts:17`), granted to no role (`rbac.ts`), used by no route. Decide: wire to Admin (for settings/branding) or remove.
- **`VIEW_EXAM_ROOM` / `EXTEND_TIME` / `MARK_MISCONDUCT` / `FORCE_SUBMIT`** — **migration traps**: defined, *not granted to Admin*, but their routes are today `requireRole(["Admin"])`. Any naïve migration to `requirePermission(...)` denies Admin. (Live-verified: `rbac.ts:5-21` Admin set contains none of these.)
- **`TAKE_EXAM` / `VIEW_OWN_SCORE`** — Candidate-only; correctly excluded from Admin; remain Candidate-only.
- **`VIEW_ALL_SCORES` / `EXPORT_SCORES` / `VIEW_SYSTEM_HEALTH`** — Admin-only, correctly assigned.

### 3.2 Disposition answers

- **Dead permissions:** `MANAGE_ORGANIZATION` (1). The 4 proctor perms are *not* dead — they have routes — but they are *unassigned*.
- **Migration traps:** the 4 proctor permissions (above).
- **Which should Admin temporarily keep to preserve behavior?** Admin must keep behavior parity, so during migration either (a) grant the 4 proctor perms to Admin as a superset, **or** (b) keep those routes on `requireRole(["Admin"])` until a Proctor role is introduced. **Do NOT migrate them to `requirePermission` before reconcile** (AUTHZ-S2).
- **Which remain Candidate-only?** `TAKE_EXAM`, `VIEW_OWN_SCORE` (and future `SAVE_ANSWER`/`SUBMIT_ATTEMPT`/`SEND_HEARTBEAT` capabilities).

---

## 4. Proposed Permission Groups

> **Proposal only — not implemented.** Extends the existing 22 perms with the candidate-runtime, answer-protocol, grading, and audit/system gaps surfaced by this audit and the grading-API audit.

| Group | Permission | Purpose | First Enforced On | Scope | Sensitive? | Audit Required? |
| --- | --- | --- | --- | --- | :---: | :---: |
| users / organization | `MANAGE_USERS` | user CRUD | `user.ts` | organization | yes | yes (`user.*`) |
| | `MANAGE_ORGANIZATION` | org/settings + branding | `settings.ts` | organization | yes | yes (`branding.update`) |
| | `MANAGE_CANDIDATE_FIELDS` | candidate-field schema | `candidateField.ts` | organization | yes | yes |
| | `MANAGE_CANDIDATES` *(new)* | candidate CRUD + import | `candidate.ts` | organization | yes | yes |
| | `MANAGE_SETTINGS` *(new)* | platform settings | `settings.ts` | organization | yes | yes |
| course / question | `MANAGE_COURSES` | course CRUD | `course.ts` | organization | no | yes |
| | `CREATE/EDIT/DELETE/IMPORT_QUESTIONS` | question bank | `question.ts` | organization (future: course) | no | yes |
| exam lifecycle | `CREATE/EDIT/PUBLISH/ARCHIVE/DELETE_EXAM` | exam authoring + lifecycle | `exam.ts` | organization (future: exam) | no | yes (`exam.*`) |
| candidate runtime | `TAKE_EXAM` | start attempt | `attempts.candidate.ts` | own_attempt | no | yes (`attempt.start`) |
| | `SAVE_ANSWER` *(new)* | answer save protocol | save-answer route | own_attempt | no | yes (`attempt.saveAnswer`) |
| | `SUBMIT_ATTEMPT` *(new)* | candidate submit | submit route | own_attempt | no | yes (`attempt.submit`) |
| | `SEND_HEARTBEAT` *(new)* | heartbeat | heartbeat route | own_attempt | no | no |
| | `VIEW_OWN_SCORE` | own result | `scores.ts` (own) | own_score | no | read — optional audit |
| answer protocol | *(covered by `SAVE_ANSWER`/`SUBMIT_ATTEMPT`)* | — | — | own_attempt | — | see §11 |
| proctor runtime | `VIEW_EXAM_ROOM` | proctor status/events | `proctorMonitoring.ts` | exam | yes (candidate behavior) | read — recommend audit |
| | `EXTEND_TIME` | per-attempt extend | `attempts.admin.ts` | attempt | yes | yes (`attempt.extendTime`) |
| | `MARK_MISCONDUCT` | flag misconduct | `attempts.admin.ts` | attempt | yes | yes (`attempt.misconductFlagged`) |
| | `FORCE_SUBMIT` | force-submit | `attempts.admin.ts` | attempt | yes | yes (`attempt.forceSubmit`) |
| grading | `VIEW_GRADING_DETAIL` *(new)* | open grading detail page | `grading-details` route | attempt | **yes** | **yes (`grading.detail_viewed` — missing)** |
| | `VIEW_CANDIDATE_ANSWER` *(new)* | read candidate answer payload | (subset of grading detail) | attempt | **yes** | yes |
| | `GRADE_ANSWER` *(new)* | enter manual score | `grade-question` route | attempt | yes | yes (`grading.score_entered`) |
| score / result | `VIEW_ALL_SCORES` | all scores | `scores.ts` (list) | exam | yes | read — recommend audit |
| | `EXPORT_SCORES` | export | `export.ts` | organization/exam | yes | yes (`export_scores`) |
| | `PUBLISH_RESULTS` *(new)* | publish results | `exam.ts` publish-results | exam | yes | yes (`exam.publish_results`) |
| audit / system | `VIEW_AUDIT_LOGS` *(new)* | read audit log | `audit.ts` | organization | yes | read — recommend audit |
| | `VIEW_SYSTEM_HEALTH` | health/dashboard/diagnostics | `system.ts` | system | no | read — no audit |
| | `VIEW_IMPORT_LOGS` *(new)* | import logs | `importLogs.ts` | organization | no | read — no audit |
| settings | `MANAGE_SETTINGS` | (see users/org) | `settings.ts` | organization | yes | yes |
| system actor | `SYSTEM_AUTO_SUBMIT` *(new)* | deadline scanner auto-submit | scanner plugin | attempt | yes | yes (`attempt.autoSubmit`, actor=SYSTEM) |
| | `SYSTEM_HEARTBEAT_SCAN` *(new)* | disrupted detection | heartbeat plugin | attempt | yes | yes (`attempt.disrupted`, actor=SYSTEM) |

> The 4 "proctor" perms are grouped under **proctor runtime** because their *routes* are proctor-like, even though today they are Admin-gated. Proctor-as-a-**role** is Phase 3+; proctor-as-a-**monitoring domain** is already implemented (see §7) — do not confuse the two.

---

## 5. Scope Model Readiness

### 5.1 Scope types needed

There is **no scope layer today**. TenantGuard (`tenantGuard.ts`) validates only public-endpoint bypass; `validateTenantAccess` is a Phase-1 no-op (`audit-current-role-checks.md` §2.3). All authorization is organization-all-or-nothing per role. The own-attempt / own-score boundary is enforced ad-hoc inside handlers (`scores.ts:80`) and by `candidateProfile.id` matching, not by a scope resolver.

### 5.2 Route scope classification

| Scope | Meaning | Example Routes | Resolver Needed? | Notes |
| --- | --- | --- | :---: | --- |
| `organization` | tenant-wide | users, candidates, candidate-fields, courses, audit-logs, settings | no | current default |
| `course` | within a course | questions (future), course-scoped exam authoring | yes (course membership) | not required today (Admin owns all) |
| `exam` | within an exam | proctor monitoring, scores list, result publishing | yes (exam→org + assignment) | needed for Proctor/Teacher scope |
| `attempt` | a single attempt | extend-time, misconduct, force-submit, grading detail | yes (attempt→exam→org) | needed for Grader/Proctor scope |
| `candidate` | a candidate's data | candidate profile | yes (candidate→org) | |
| `own_attempt` | the actor's own attempt | start/save/submit/heartbeat | yes (attempt.candidateId === actor.candidateProfile.id) | currently enforced ad-hoc in handler |
| `own_score` | the actor's own result | `GET /scores/attempts/:id` (candidate branch) | yes (same as own_attempt) | currently `ctx.role !== "Candidate"` + ownership check |
| `system` | infra / diagnostics | `/system/health`, `/system/diagnostics` | no | role-gated today |

### 5.3 Cross-object scope resolution

- **`attempt → exam`**: needed for Grader/Proctor (resolve `examId` from `attemptId`).
- **`exam → course → org`**: needed for course-scoped Teacher.
- **`attempt → candidate`**: needed for own-score / own-attempt ownership.
- **`question → course`**: needed for course-scoped Question-bank editing.

### 5.4 Proposed initial scope enum (do not implement)

```
organization | course | exam | attempt | candidate | own_attempt | own_score | system
```

---

## 6. Route → Permission → Scope → Audit Registry Draft

> **Draft shape only.** Not implemented. `permission` references §4 proposed perms; `scope` references §5.4; `auditAction` references §7.1 existing literals (or proposed new ones, marked *(new)*).

```ts
type RouteRegistryEntry = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  permission: Permission;          // §4
  scope: Scope;                    // §5.4
  auditAction: AuditAction;        // §7.1
  sensitive: boolean;
};
```

| Route Family | Example Route | Permission | Scope | AuditAction | Sensitive? | Migration Priority |
| --- | --- | --- | --- | --- | :---: | --- |
| auth | `POST /auth/login` | *(public)* | system | `login.success`/`login.failure` | yes | low (public) |
| auth | `POST /auth/logout` | *(authenticated)* | system | `logout` | no | low |
| auth | `PATCH /auth/me/profile` | *(self)* | candidate | `auth.profile_update` | no | low |
| users | `POST /admin/users` | `MANAGE_USERS` | organization | `user.create` | yes | Stage 5 |
| users | `PATCH /admin/users/:id` | `MANAGE_USERS` | organization | `user.update` | yes | Stage 5 |
| users | `DELETE /admin/users/:id` | `MANAGE_USERS` | organization | `user.delete` | yes | Stage 5 |
| candidates | `POST /admin/candidates` | `MANAGE_CANDIDATES` | organization | `candidate.create` | yes | Stage 5 |
| candidates | `POST /admin/candidates/import` | `MANAGE_CANDIDATES` | organization | `candidate.import` | yes | Stage 5 |
| candidate fields | `/admin/candidate-fields` CRUD | `MANAGE_CANDIDATE_FIELDS` | organization | `candidate_field.*` | yes | Stage 5 |
| courses | `/admin/courses` CRUD | `MANAGE_COURSES` | organization | `course.*` | no | Stage 5 |
| questions | `/admin/questions` CRUD + import | `CREATE/EDIT/DELETE/IMPORT_QUESTIONS` | organization | `question.*` | no | Stage 5 |
| exams | `POST /admin/exams` | `CREATE_EXAM` | organization | `exam.create` | no | Stage 5 |
| exams | `POST /admin/exams/:id/publish` | `PUBLISH_EXAM` | exam | `exam.publish` | no | Stage 5 |
| exams | `POST /admin/exams/:id/publish-results` | `PUBLISH_RESULTS` | exam | `exam.publish_results` | yes | Stage 6 |
| enrollments | `POST /admin/exams/:id/enrollments` | `EDIT_EXAM` | exam | `enrollment.add` | no | Stage 5 |
| attempt (candidate runtime) | `POST /attempts/:id/start` | `TAKE_EXAM` | own_attempt | `attempt.start` | no | Stage 6 |
| attempt (candidate runtime) | `POST /attempts/:id/answers/:qid` | `SAVE_ANSWER` | own_attempt | `attempt.saveAnswer` | no | Stage 6 |
| attempt (candidate runtime) | `POST /attempts/:id/submit` | `SUBMIT_ATTEMPT` | own_attempt | `attempt.submit` | no | Stage 6 |
| attempt (admin/proctor) | `POST /admin/attempts/:id/misconduct` | `MARK_MISCONDUCT` ⚠️ | attempt | `attempt.misconductFlagged` | yes | Stage 6 |
| attempt (admin/proctor) | `POST /admin/attempts/:id/force-submit` | `FORCE_SUBMIT` ⚠️ | attempt | `attempt.forceSubmit` | yes | Stage 6 |
| attempt (admin/proctor) | `POST /admin/attempts/:id/extend-time` | `EXTEND_TIME` ⚠️ | attempt | `attempt.extendTime` | yes | Stage 6 |
| grading | `GET /admin/grading-queue` | `VIEW_GRADING_DETAIL` | organization/exam | read — recommend audit | yes | Stage 6 |
| grading | `GET /admin/attempts/:id/grading-details` | `VIEW_GRADING_DETAIL` (+`VIEW_CANDIDATE_ANSWER`) | attempt | **`grading.detail_viewed` (missing)** | **yes** | Stage 6 |
| grading | `POST /admin/attempts/:id/grade-question` | `GRADE_ANSWER` | attempt | `grading.score_entered` | yes | Stage 6 |
| scores | `GET /admin/exams/:id/scores` | `VIEW_ALL_SCORES` | exam | read — recommend audit | yes | Stage 6 |
| scores | `GET /scores/attempts/:id` | `VIEW_OWN_SCORE`/`VIEW_ALL_SCORES` | own_score/attempt | *(none today)* | no | Stage 6 |
| exports | `GET /admin/exports/scores` | `EXPORT_SCORES` | organization/exam | `export_scores` | yes | Stage 5 |
| audit logs | `GET /admin/audit-logs` | `VIEW_AUDIT_LOGS` | organization | read — recommend audit | yes | Stage 5 |
| settings | `PATCH /admin/settings/branding` | `MANAGE_ORGANIZATION`/`MANAGE_SETTINGS` | organization | `branding.update` | yes | Stage 5 |
| system diagnostics | `GET /system/diagnostics` | `VIEW_SYSTEM_HEALTH` | system | read — no audit | no | Stage 5 |
| client events | `POST /client-events` | *(authenticated)* | candidate | n/a (telemetry) | no | low |
| proctor monitoring | `GET /admin/exams/:id/proctor/attempts` | `VIEW_EXAM_ROOM` ⚠️ | exam | read — recommend audit | yes | Stage 6 |
| proctor monitoring | `GET /admin/attempts/:id/proctor-events` | `VIEW_EXAM_ROOM` ⚠️ | attempt | read — recommend audit | yes | Stage 6 |

> ⚠️ = trap permission (must reconcile RBAC in AUTHZ-S2 before any migration).

---

## 7. Audit / Monitoring Boundary

> There are **two deliberately separated event channels today**, plus a read-only diagnostics surface. Source of truth: `audit-current-events.md`. Verified live where load-bearing.

### 7.1 AuditAction Inventory

`audit_logs.action` is a **free-form `text` column** (`packages/db/src/schema/pg.ts:417-437`). **There is no `AuditAction` enum / union / constants module** anywhere in `packages/contracts` or `packages/domain` (live-verified: `rg AuditAction` returns nothing in contracts/domain). Helpers: `recordAudit()` (fire-and-forget, `apps/api/src/routes/audit.ts:25-63`) + direct `createAuditLogRepo().create()` (awaited, best-effort). **Do not rename any action in this audit.**

**~43 distinct static literals** (live-enumerated) + the dynamic `exam.<transition>` family (`reconciliation.ts:51`):

| Existing Action | Source File | Target Type | Trigger | Constant? | Rename? | Notes |
| --- | --- | --- | --- | :---: | :---: | --- |
| `login.success` | `auth.ts:217` | user | login ok | should-be | no | snake_case outlier (table is dot.case) |
| `login.failure` | `auth.ts:138,165` | login | bad creds / unsupported role | should-be | no | two reasons |
| `logout` | `auth.ts:270` | user | logout | should-be | no | |
| `auth.profile_update` | `auth.ts:430` | user | self rename | should-be | no | |
| `user.create/update/delete` | `user.ts:133,213,321` | user | user CRUD | should-be | no | |
| `candidate.password_reset` | `user.ts:281` | user | admin resets candidate pw | should-be | no | |
| `admin.bootstrap` | `scripts/bootstrap-admin.ts:86` | user | boot script (actor=system) | should-be | no | |
| `admin.password_reset.local` | `scripts/reset-admin-password.ts:72` | user | reset script (actor=system) | should-be | no | |
| `candidate.create/update/import` | `candidate.ts:304,384,526` | candidate/organization | candidate CRUD | should-be | no | import metadata {total,created,updated,errors} |
| `candidate_field.create/update/delete` | `candidateField.ts:101,165,218` | candidate_field | field schema | should-be | no | |
| `course.create/update/delete` | `course.ts:151,192,247` | course | course CRUD | should-be | no | |
| `question.create/update/delete/import` | `question.ts:219,309,354,493` | question/course | question bank | should-be | no | |
| `exam.create/update/publish/unpublish/close/cancel/archive/extend/publish_results/delete` | `exam.ts:*` | exam | exam lifecycle | should-be | no | `extend` is exam-level; per-attempt extend is `attempt.extendTime` |
| `exam.<transition>` *(dynamic)* | `reconciliation.ts:51` | exam | state-machine reconcile (e.g. `exam.open`, `exam.closed`) | n/a | no | double-transition emits both |
| `enrollment.add/remove` | `exam.ts:1331,1397` | enrollment | enroll CRUD | should-be | no | |
| `attempt.start/restore/saveAnswer/submit` | `attempts.candidate.ts:*` | attempt | candidate self-service | should-be | no | camelCase verb, dot.case |
| `attempt.forceSubmit` | `attempts.admin.ts:240` | attempt | proctor force-submit (direct) | should-be | **no** | job-card proposed `attempt.force_submitted` — **collision**, do NOT add |
| `attempt.misconductFlagged` | `attempts.admin.ts:98` | attempt | proctor misconduct (direct) | should-be | no | metadata {severity,notes} |
| `attempt.extendTime` | `attempts.admin.ts:329` | attempt | per-attempt extend (direct) | should-be | no | metadata {additionalMinutes} |
| `attempt.autoSubmit` | `plugins/deadlineScanner.ts:143` | attempt | deadline auto-submit (direct, actor=system) | should-be | no | metadata {source:deadline-scanner} |
| `attempt.disrupted` | `plugins/heartbeat.ts:146` | attempt | heartbeat disrupted (direct, actor=system) | should-be | no | metadata {source:heartbeat-scanner} |
| `attempt.exported` | `attempts.admin.ts:579` | attempt | single-attempt answer export (direct) | should-be | no | metadata {format} |
| `grading.score_entered` | `gradingQueue.ts:278` | attempt | manual score (direct) | should-be | **no** | job-card proposed `grading.score_submitted` — **collision**, reconcile instead |
| `grading.finalized` | `gradingQueue.ts:307` | attempt | attempt fully graded (direct) | should-be | no | |
| `export_scores` | `export.ts:133` | exam | bulk scores CSV | should-be | no | snake_case outlier |
| `branding.update` | `settings.ts:196` | organization | org display/title | should-be | no | |

### 7.2 Sensitive Missing Audit Events

| Operation | Route | Why Sensitive | Proposed AuditAction | Priority |
| --- | --- | --- | --- | --- |
| **grading detail view** | `GET /api/admin/attempts/:attemptId/grading-details` | Returns `candidateAnswer` (candidate answer payload) for every subjective question (`gradingQueue.ts:154-168`) | **`grading.detail_viewed`** *(new)* | High |
| candidate answer export (read) | grading export / single-attempt export | exposes candidate answers | *(extend `attempt.exported` or new `grading.answer_exported`)* | Medium |
| audit-log read by admin | `GET /admin/audit-logs` | compliance surface | *(recommend `audit_log.viewed`)* | Low |
| result view by candidate | `ResultPage` read | own-result access | *(optional `result.viewed`)* | Low |
| role/permission change | `PATCH /admin/users/:id` (role field) | privilege change — **no audit today** (`audit-current-role-checks.md` R10) | `user.role_changed` *(new)* | High |

> Live-verified: the `GET .../grading-details` handler (`gradingQueue.ts:111-180`) writes **no** `recordAudit`/`createAuditLog` — confirmed gap. Recommendation only; **not implemented.**

### 7.3 Monitoring Event Boundary

Three concerns are distinct and must **not** be mixed:

- **`audit_logs`** = compliance records of *actor actions on a target*. Server-authoritative, actor-bound. (`pg.ts:417-437`)
- **`client_events`** = browser-reported *observability telemetry*. Written only by the browser via `POST /client-events`; `kind` ∈ `log`/`exam_telemetry`/`proctor` (enum-constrained); `name` regex-only. (`pg.ts:452-508`)
- **monitoring / infra** = Redis/email/worker/scanner *health and background-job* events. **No natural table exists today** — Redis/email/worker events are not emitted at all; diagnostics is poll-only (`system.ts:184-238`).

The proctor timeline **reads from both `audit_logs` and `client_events` and merges them** into one `ProctorAttemptEvent[]` with a `source` tag (`proctorMonitoringService.ts`) — this is a read-time projection, not a write-time merge. They are **never written to the same table**.

> **Why infra monitoring must not go into `audit_logs`:** infra events have no actor (they are system/infra-originated); writing them into actor-bound compliance rows pollutes the audit trail. **Why not `client_events`:** that table is documented as *browser-reported* (`pg.ts:439-451` schema comment); server-originated rows would contradict its purpose.

| Option | Description | Pros | Cons | Recommendation |
| --- | --- | --- | --- | --- |
| **A. New `monitoring_events` table** | dedicated infra-health table + repo | cleanest separation (compliance / telemetry / infra each distinct); queryable from admin UI; supports M5 diagnostics | adds a 3rd event surface + repo + migration | **Recommended for EVENT-M1** |
| B. Reuse `client_events` with `kind: "infra"` | add a 4th kind | reuses ingest/storage; no new table | contradicts the *browser-reported* schema comment; server-originated rows blur the boundary | Not recommended |
| C. Structured `pino` logs only | no table; rely on log aggregation | cheapest; no schema change | not queryable from admin UI (conflicts with M5 "diagnostics page shows infra status"); scanners already log-only and that is a gap (R6) | Not recommended alone |

> Do **not** finalize the table choice in this audit. EVENT-M1 must produce a one-paragraph decision (likely A) before implementation. Full taxonomy deferred to L9.

---

## 8. Grading / Candidate Answer Sensitivity

> Source: `audit-current-grading-api.md` (S3b). Live-verified load-bearing claims.

### 8.1 Answers

- **Does grading detail return candidate answer?** **Yes.** `GET /api/admin/attempts/:attemptId/grading-details` (`gradingQueue.ts:111-180`) builds `answerByQuestion` from `attempt.answers` (`:154-156`) and maps it into `candidateAnswer` per subjective question (`:166-168`).
- **Where is `candidateAnswer` populated?** `gradingQueue.ts:166-168`, from `attempt.answers`.
- **Where is it stored?** `exam_attempts.answers` JSONB column (`packages/db/src/schema/pg.ts:299`); no separate answers table. Read via `attemptRepo.findById`.
- **Which frontend renders it?** `GradingDetailPage.tsx` via `formatAnswer()` (`:34-49`, `:208-215`) with i18n labels.
- **Which backend tests assert it?** `gradingQueue.test.ts` slice 12 asserts `candidateAnswer` equals the expected submitted answer.
- **Which frontend tests are missing?** **`GradingDetailPage.test.tsx` has zero `candidateAnswer`/`formatAnswer` assertions** (live-verified: `rg candidateAnswer|formatAnswer` in that test file returns nothing). Mock data omits `candidateAnswer`.
- **Which E2E specs are skipped?** `manual-grading.spec.ts` (`:40` `test.skip`, "Phase 3 pending…") and `fill-blank-e2e.spec.ts` (`:18` `test.skip`) — both Phase-3-pending (live-verified).

> ⚠️ **M1 premise correction (from S3b §10):** the candidate-answer display is **already implemented end-to-end** (API → contract `candidateAnswer: z.unknown().nullable()` at `score.ts:124` → frontend `formatAnswer()` → backend integration test). It is **not** a missing feature. The real gap is **test coverage + E2E enablement**, plus the WYSIWYG subjective *answering* runtime on the candidate side.

### 8.2 Required conclusion

> **`VIEW_GRADING_DETAIL`, `VIEW_CANDIDATE_ANSWER`, and `GRADE_ANSWER` should be modeled separately.**

Evidence supporting separation:
- **`VIEW_GRADING_DETAIL`** — opening the grading-detail page is a *sensitive read* that today writes **no audit** (§7.2). It should be its own permission + its own `grading.detail_viewed` audit. (Confirms agreement.)
- **`VIEW_CANDIDATE_ANSWER`** — the candidate-answer payload is the most privacy-sensitive field in the grading response. A future role might be allowed to view the grading *context* (question, max score) but not the candidate's literal answer (e.g. a result-viewer, a double-blind grader). Separating this capability lets Phase 3 scope it independently.
- **`GRADE_ANSWER`** — entering a manual score is a *write* (`grade-question` route → `grading.score_entered` audit). It is distinct from *viewing* the detail or the answer. Today all three are conflated under `requireRole(["Admin"])`.

This audit **agrees** with the required conclusion. No contrary evidence found.

| Endpoint | Current Gate | Sensitive Data | Future Permission | Audit Needed? | Test Gap |
| --- | --- | --- | --- | :---: | --- |
| `GET /grading-queue` | `requireRole(["Admin"])` | candidate identity | `VIEW_GRADING_DETAIL` | recommend | queue list covered |
| `GET /grading-details` | `requireRole(["Admin"])` | **candidateAnswer** | `VIEW_GRADING_DETAIL` + `VIEW_CANDIDATE_ANSWER` | **yes (missing)** | frontend test gap |
| `POST /grade-question` | `requireRole(["Admin"])` | score write | `GRADE_ANSWER` | yes (`grading.score_entered`) | backend covered |
| `GET /scores/attempts/:id` | `requireRole(["Candidate","Admin"])` + handler | own/all score | `VIEW_OWN_SCORE`/`VIEW_ALL_SCORES` | optional | — |

---

## 9. Redis Boundary

> **Stated invariant:** Redis must not be used as the source of truth for authorization. AuthZ decisions must be based on PostgreSQL / JWT / RequestContext. Redis may optimize rate limiting, presence, caching, or scanner coordination, but must not grant or deny business permissions. Source: `audit-current-redis.md` (S5); live-verified.

### 9.1 Redis independence from AuthZ

**Confirmed:** Redis is not in the authorization path. Live `rg fastify.redis|.redis.` over `auth.ts`, `tenant.ts`, `plugins/auth.ts` returns **no Redis access** in any authz component. The authenticate plugin reads `users` (PostgreSQL) + verifies JWT (stateless); `ctx.role`/`ctx.permissions` derive from the DB row via `getPermissionsForRole`, never from Redis.

### 9.2 Redis usage matrix

> Redis is connected in production but performs **almost no work** — only a diagnostics `ping()`. All business-critical features (heartbeat, rate limit, queue) use in-process alternatives.

| Redis Usage | Current Behavior | AuthZ Impact | Monitoring Impact | Recommendation |
| --- | --- | --- | --- | --- |
| connection plugin | `lazyConnect:true`, explicit `await connect()` (`redis.ts:40`); retry max 3 (200/400/600ms) then give up; `onClose` calls `quit()` | none (not in authz) | startup crash if `REDIS_URL` set & unreachable (no try/catch) | REDIS-S1: graceful degradation |
| startup failure | server **crashes** — `await client.connect()` throws, `server.ts` does not catch (`audit-current-redis.md` R1) | none (authz unaffected) | high (availability) | wrap connect in try/catch → decorate `null` |
| mid-session disconnect | after retry exhaustion ioredis emits `"error"`; **plugin has no error listener** → Node `uncaughtException` → process crash (R2) | none (authz unaffected) | high (availability) | add `"error"`/`"close"` listeners |
| diagnostics ping | `fastify.redis.ping()` in `/system/diagnostics` (`system.ts:205`), try/catch → `connected:false` | none | low (already correct) | no change |
| rate limit | `@fastify/rate-limit` **in-memory** store (`rateLimit.ts`) — **not Redis** | none | per-instance counters (R3) | Redis store only if multi-instance |
| heartbeat | **DB-backed** `setInterval` scanner (`heartbeat.ts`), reads `last_activity_at` from PG | none | DB load under concurrency (R4) | optional Redis sorted-set cache (PG authoritative) |
| deadline scanner | DB-backed scanner (`deadlineScanner.ts`); uses `SYSTEM_ACTOR_ID` Admin context for auto-submit | none | log-only on scanner error (R6) | monitoring event (EVENT-M1) |
| admission queue | **in-memory** `Map` (`attempts.candidate.ts:109`) — **not Redis**; lost on restart; Phase 2+ deferred | none | none (not wired) | DB-backed queue if required |
| test prefix cleanup | `testRedis.ts` SCAN+DEL only (never FLUSHALL); prefix `exam:test:<ns>:` | none | none | no change |

### 9.3 Confirmed invariant

```
Redis must never grant, deny, or own business permissions.
PostgreSQL / JWT / RequestContext remain authoritative for AuthZ.
```

All triggers for full Redis adoption (ADR-001 §Triggers) remain unmet in single-instance Phase-3 deployment; Redis is optional enhancement only.

---

## 10. Candidate Runtime Boundary

> Source: `audit-current-candidate-runtime.md` (S7). The exam runtime is `TakeExamPage` (15 `useState` + 8 `useRef` + 2 derived locals) + the `useSubmitFlush` hook (a second state layer in refs). State classifications below.

| Runtime State | AuthZ Concern? | Runtime State-Machine Concern? | Notes |
| --- | :---: | :---: | --- |
| `deadlinePassed` | no | **yes** | page deadline flag → overlay + hides controls; one of 3 deadline clocks |
| `isSubmitting` | no | **yes** | submit in-flight; button label/disabled |
| `isFlushing` | no | **yes** | pre-submit save flush in-flight |
| `isDisconnected` | no | **yes** | disconnect banner; flickers (any success clears it) |
| `saveRejection` | no | **yes** | server-rejected-save alert (DEADLINE_EXCEEDED etc.) |
| `autoSubmitFailed` | no | **yes** | deadline auto-submit failed → retry button |
| `showSubmitDialog` | no | **yes** | submit confirmation dialog |
| `flushResult` | no | **yes** | flush summary (pending/failed/timedOut) |
| `answers` (Map) | no | **yes** | local answer mirror; updated in 4 places by convention |
| `questionStates` | no | **yes** | navigator answered/unanswered/flagged; parallel mirror of `answers` |
| `saveState` | no | **yes** | global SaveIndicator (idle/saving/saved/error) |
| *(none of the above are AuthZ)* | — | — | candidate capabilities are gated server-side by `requireRole(["Candidate"])` + own-attempt ownership, not by these UI flags |

> **The candidate runtime has no authorization concerns today.** Whether a candidate *may* save/submit/heartbeat is decided server-side (role + own-attempt ownership). The runtime states above decide only whether the UI is *currently in a legal phase* to trigger an already-permitted action.

### 10.1 Required conclusion

```
Permission determines whether an actor may perform an action.
Runtime state determines whether the UI is currently in a legal phase to trigger it.
Do not merge these two concerns.
```

Concrete example:
- `Permission.SubmitAttempt` = the actor *may* submit this attempt (server-side, candidate + own-attempt).
- `submitPhase` / `deadlinePassed` / `isSubmitting` = the UI *may currently trigger* submit (client runtime state).

The frontend state-machine grillme (RUNTIME-L1) must **not** be absorbed into the authz design. This audit explicitly fences it off.

---

## 11. Answer Protocol Boundary

> Source: `audit-current-answer-payload.md` (S8). Live-verified load-bearing claims.

**Key facts:**
- **Save carries a payload; submit carries none.** `POST /attempts/:id/answers/:qid` sends `{ answer, clientSeq, clientSavedAt, baseVersion }`. `POST /attempts/:id/submit` sends **an empty body** and grades whatever is persisted on the attempt row.
- **Final answer = last-accepted `AnswerRecord.answer`** in the `exam_attempts.answers` JSONB (`pg.ts:299`). No separate final-answer table, no submit-time snapshot.
- **Versioning exists; hashing/canonicalization do not.** Monotonic `version` (server) + `clientSeq` (client); idempotency via structural `answersEqual`; **no content hash, no canonical form, no signature**.
- **`clientSeqHistory` is unbounded** — append-only receipt trail per question inside the JSONB, never pruned.
- **Three submit entry points converge on one engine core** (`submitAttempt` → `readGradingSnapshot` → `computeGradingResult` → `finalizeGrading`), all inside one locked transaction. Candidate submit uses `submitAndGradeAttempt`; force-submit reimplements inline; deadline scanner uses `gradeAttemptIdempotent`.

| Operation | Payload? | Reads Answers From | Permission (future) | Audit Need | V2 Risk |
| --- | :---: | --- | --- | --- | --- |
| save answer | ✅ `{answer,clientSeq,clientSavedAt,baseVersion}` | writes `attempt.answers` JSONB | `SAVE_ANSWER` | `attempt.saveAnswer` | whole-array rewrite; unbounded `clientSeqHistory`; no integrity |
| candidate submit | ❌ empty body | re-reads locked `attempt.answers` | `SUBMIT_ATTEMPT` | `attempt.submit` | no WYSIWYG (racing save can change graded answer) |
| admin force-submit | ❌ empty body | re-reads locked `attempt.answers` (inline) | `FORCE_SUBMIT` | `attempt.forceSubmit` | 3rd code path (duplication) |
| deadline auto-submit | ❌ n/a | re-reads locked `attempt.answers` | `SYSTEM_AUTO_SUBMIT` | `attempt.autoSubmit` | uses `gradeAttemptIdempotent` wrapper |
| manual grading detail view | n/a (read) | `attempt.answers` via `answerByQuestion` | `VIEW_CANDIDATE_ANSWER` | `grading.detail_viewed` (missing) | n/a |
| manual grade-question | ✅ `{questionId,score,comment}` | n/a (writes manual_grading_entries) | `GRADE_ANSWER` | `grading.score_entered` | n/a |
| result view | n/a (read) | `attempt.answers` + grading result | `VIEW_OWN_SCORE`/`VIEW_ALL_SCORES` | optional | n/a |

### 11.1 Required conclusion

```
Answer Protocol v2 is a separate Large job.
AuthZ may define capabilities around save/submit/view/grade, but must not implement
submit payload, answer snapshot, hash, canonicalization, or storage migration in this job.
```

The v2 concerns explicitly fenced off (ANSWER-L1 grillme): submitted answer snapshot, answer hash, canonicalization, submit-time payload, `clientSeqHistory` storage/bounding, `attempt_answers` table.

---

## 12. Recommended Migration Plan

> Incremental and safe. Each stage is independently reviewable. **No stage is implemented in this audit.**

### Stage 0 — Audit Baseline
This job. Produces the fact base.

### Stage 1 — Safe Cleanup (no behavior change)
- Role string cleanup (AUTHZ-S1): ~22 `"Admin"`/`"Candidate"` → `Role.*`.
- RBAC mapping reconcile (AUTHZ-S2): decide disposition of 4 proctor perms + `MANAGE_ORGANIZATION`.
- AuditAction constants (EVENT-S1): Zod enum for the ~43 existing actions; validate at `recordAudit` boundary. **No rename.**
- Protected-route registry draft (this document, §6).

### Stage 2 — AuthZ Skeleton (no enforcement)
- New `packages/authz` (leaf, no fastify/React/Drizzle).
- `Permission` constants (mirror §4), `Scope` constants (§5.4), `AuditAction` constants (§7.1).
- `authorize(ctx, perm, scope?)`, `requireCapability(perm, scope?)`, `shadowRequireCapability(...)`.

### Stage 3 — Route Registry
- `route → permission → scope → auditAction` declarative registry.
- Protected-route coverage test (every `requireRole` route has a registry entry).
- Registry-generated permission matrix (replaces ad-hoc `requireRole`).

### Stage 4 — Shadow Mode (no behavior change)
- `requireRole` remains authoritative.
- `shadowRequireCapability` records disagreements (role allowed but perm denied, or vice-versa) to logs/metrics.
- Run in CI/staging until zero disagreements.

### Stage 5 — Low-Risk Enforcement
- system diagnostics, audit-log view, settings, export, course/question/exam admin routes.
- These map cleanly to existing Admin perms with no trap.

### Stage 6 — Sensitive Enforcement
- grading detail (`VIEW_GRADING_DETAIL` + `VIEW_CANDIDATE_ANSWER`), candidate answer view, proctor operations (force-submit/extend-time/misconduct — **after** AUTHZ-S2 reconcile), publish results, own-score.
- Add `grading.detail_viewed` audit (§7.2).

### Stage 7 — Scoped Assignment UI
- Teacher scoped by course, Proctor scoped by exam, Grader scoped by exam/question, Candidate scoped to own attempt. Requires the scope resolvers (§5.3).

### Stage 8 — Advanced Permission Overrides
- grant/revoke individual permissions with reason + scope + audit; last-admin guard retained.

---

## 13. Follow-Up Job Cards

| Job | Type | Goal | Risk | Prerequisite |
| --- | --- | --- | --- | --- |
| **AUTHZ-S1** — Role String Cleanup | Small | replace ~22 role literals with `Role.*` | very low (no behavior change) | none |
| **AUTHZ-S2** — RBAC Mapping Reconcile | Small | decide 4 proctor perms + `MANAGE_ORGANIZATION` disposition | low (mapping only, no route change) | AUTHZ-S1 |
| **AUTHZ-M1** — AuthZ Package Skeleton | Middle | `packages/authz` + Permission/Scope/AuditAction constants + `authorize`/`requireCapability`/`shadowRequireCapability` | low (new package, no enforcement) | AUTHZ-S2 |
| **AUTHZ-M2** — Route Permission Registry | Middle | declarative `route→perm→scope→auditAction` + coverage test | medium (touches all routes) | AUTHZ-M1 |
| **AUTHZ-M3** — Shadow Permission Mode | Middle | shadow check records mismatches, `requireRole` stays authoritative | low (no behavior change) | AUTHZ-M2 |
| **EVENT-S1** — AuditAction Constants | Small | Zod enum for ~43 actions, validate at `recordAudit`; **no rename** | low | none |
| **EVENT-M1** — Monitoring Event Storage Decision | Middle | decide A/B/C for infra monitoring (likely A `monitoring_events`) | medium (new table/repo) | EVENT-S1 |
| **GRADING-S1** — Candidate Answer Visibility Test Coverage | Small | add `candidateAnswer`/`formatAnswer` tests to `GradingDetailPage.test.tsx`; unskip E2E | low (tests only) | none |
| **REDIS-S1** — Redis Graceful Degradation | Middle | try/catch connect + error/close listeners (no startup/mid-session crash) | medium (plugin behavior) | none |
| **RUNTIME-L1** — Candidate Runtime State Machine Grillme | Large | grillme → ADR/state-chart → split into Middle jobs | high (core UI) | fenced from authz (§10) |
| **ANSWER-L1** — Answer Protocol v2 Grillme | Large | grillme → ADR → snapshot/hash/WYSIWYG/table decisions | high (core protocol) | fenced from authz (§11) |

---

## 14. Evidence Appendix

### 14.1 Commands run

| Command | Result |
| --- | --- |
| `pnpm format:check` | **pass** — "All matched files use Prettier code style!" |
| `pnpm lint` (check-code-quality) | **pass** — "Code quality checks passed." |
| `pnpm lint:copy` | **pass** — "No hardcoded business copy found." |
| `pnpm lint:arch` | **pass** — "Architecture checks passed." |
| `pnpm lint:db-config` | **pass** — "DB/test-config regression guards passed." |
| `pnpm typecheck` | **pass** — 15/15 turbo tasks (all cached, clean) |
| `pnpm test` / `pnpm coverage` | **not available** — requires PostgreSQL container (`exam-db-1`), which is **down**; not started for this doc-only audit. See §14.5. |

### 14.2 Live re-verification of load-bearing claims

This audit re-verified the predecessor audits' load-bearing claims against the current `role-permission` branch (not blind trust):

```
Command:
rg -n 'requirePermission' apps packages --glob '!*.test.ts' --glob '!*.test.tsx'
Relevant output:
apps/api/src/types/fastify-auth.d.ts:18: requirePermission: (
apps/api/src/plugins/auth.ts:13: * ... {requirePermission}/{requireRole}
apps/api/src/plugins/auth.ts:104: fastify.decorate("requirePermission", (permission: Permission) => {
Conclusion: requirePermission is defined (auth.ts:104) but ZERO routes call it. Confirms dead parallel authz model.
```

```
Command: rg -c 'requireRole\(' apps/api/src/routes (per file)
Relevant output: 16 files; totals — Admin-only: 62 sites, Candidate-only: 9, both-roles: 1.
Conclusion: every protected route uses requireRole, never requirePermission. §2.1 distribution confirmed.
```

```
Command: cat packages/auth/src/rbac.ts (lines 4-23)
Relevant output: Admin = [MANAGE_USERS, MANAGE_CANDIDATE_FIELDS, MANAGE_COURSES, CREATE/EDIT/DELETE/IMPORT_QUESTIONS,
  CREATE/EDIT/PUBLISH/ARCHIVE/DELETE_EXAM, VIEW_ALL_SCORES, EXPORT_SCORES, VIEW_SYSTEM_HEALTH]  (15 perms)
Candidate = [TAKE_EXAM, VIEW_OWN_SCORE]  (2 perms)
Conclusion: Admin set contains NONE of {VIEW_EXAM_ROOM, EXTEND_TIME, MARK_MISCONDUCT, FORCE_SUBMIT, MANAGE_ORGANIZATION}.
Proctor-permission migration trap (§3, R11) and dead MANAGE_ORGANIZATION confirmed live.
```

```
Command: rg -n 'candidateAnswer|answerByQuestion' apps/api/src/routes/gradingQueue.ts
Relevant output: :154 answerByQuestion = new Map(attempt.answers...); :166-168 candidateAnswer: answerByQuestion...
Conclusion: grading-detail API returns candidate answer from attempt.answers JSONB. §8.1 confirmed.
```

```
Command: rg AuditAction|AuditActionEnum|auditAction in packages/contracts packages/domain
Relevant output: (none)
Conclusion: NO AuditAction enum/constants exist. §7.1 free-form-text claim confirmed.
```

```
Command: combined rg over audit action literals (apps/api/src, non-test)
Relevant output: ~43 distinct static actions (enumerated in §7.1) + dynamic exam.<transition> family
  (reconciliation.ts:51 auditActions.push(`exam.${transition}`)).
Conclusion: full AuditAction inventory captured. §7.1 confirmed.
```

```
Command: rg -n 'candidateAnswer|formatAnswer' apps/web/src/pages/admin/GradingDetailPage.test.tsx
Relevant output: (none)
Conclusion: frontend grading test has zero candidate-answer assertions. §8.1 / GRADING-S1 test gap confirmed.
```

```
Command: GET grading-details handler audit inspection (gradingQueue.ts:111-180)
Relevant output: no recordAudit / no createAuditLog in the GET handler.
Conclusion: grading.detail_viewed is a genuine missing-audit gap. §7.2 confirmed.
```

```
Command: rg 'fastify\.redis|\.redis\.' apps/api/src/plugins/auth.ts apps/api/src/plugins/tenant.ts apps/api/src/routes/auth.ts
Relevant output: (none)
Conclusion: Redis is not in the authorization path. §9.1 confirmed.
```

```
Command: rg 'test\.skip' manual-grading.spec.ts fill-blank-e2e.spec.ts
Relevant output: both skipped with "Phase 3 pending…"
Conclusion: grading/fill-blank E2E skipped. §8.1 confirmed.
```

### 14.3 Files inspected (evidence sources)

- **Predecessor Phase-3 audits (primary, cross-verified):** `audit-current-role-checks.md`, `audit-current-events.md`, `audit-current-grading-api.md`, `audit-current-redis.md`, `audit-current-candidate-runtime.md`, `audit-current-answer-payload.md`.
- **Live-inspected source:** `packages/domain/src/enums.ts`, `packages/auth/src/rbac.ts`, `apps/api/src/plugins/auth.ts`, `apps/api/src/routes/gradingQueue.ts`, `apps/api/src/routes/{auth,user,scores,candidate}.ts`, `apps/api/src/routes/{exam,reconciliation}.ts` (audit actions), `packages/db/src/schema/pg.ts` (via S3b/S6/S8 line refs).
- **Contracts:** `packages/contracts/src/{user,auth,score,audit,clientEvent,proctorMonitoring,attempt}.ts` (via predecessor audits).

### 14.4 Tests/commands result

All static checks **pass** (format, lint, lint:copy, lint:arch, lint:db-config, typecheck — 15/15). `pnpm test`/`coverage` not run (DB container down) — see §14.5.

### 14.5 Failures / not-available / inconclusive

```
Command unavailable: pnpm test  (and pnpm coverage / pnpm verify)
Reason: requires running PostgreSQL container `exam-db-1` (host port 15432),
  which is currently DOWN (docker ps shows no exam-db container). Tests are
  integration-style (worker-DB isolation against exam_test).
Impact: NONE on audit confidence. This audit is documentation-only; it modified
  no code, so the test suite cannot have been affected by it. Project static
  posture is clean (typecheck 15/15). Running the full test suite would only
  re-confirm the existing project state, not validate this document.
Decision: not starting the DB for a doc-only audit (per AGENTS.md DB discipline,
  starting/stopping the dev DB is a human-owned action). If the reviewer wants
  a green `pnpm verify`, start `pnpm db:up` first.
```

```
Finding is inconclusive: exact count of distinct audit actions.
The static-literal enumeration yields ~43 distinct actions, but the dynamic
  `exam.<transition>` family (reconciliation.ts:51) can emit any transition name
  (e.g. exam.open, exam.closed). The full closed set of transitions is determined
  by the exam state machine, not enumerated here. The §7.1 table is therefore
  authoritative for static literals; the dynamic family is marked as such.
```

### 14.6 Self-review checklist (passed)

- No production code modified (only `docs/phase3/rbac/phase3_job_p3-authz-audit.md` + this file created).
- No permission framework introduced; `requireRole` untouched; `requirePermission` still unused.
- No audit action renamed (§7.1 marks collisions as "do NOT add", not "rename").
- Redis explicitly ruled out as AuthZ authority (§9).
- Proctor-as-**role** (Phase 3+, deferred) distinguished from proctor-as-**monitoring domain** (already implemented) — §4 note, §7.
- Candidate answer treated as **already-implemented** (with test gap), not missing (§8.1, S3b §10).
- `VIEW_GRADING_DETAIL` / `VIEW_CANDIDATE_ANSWER` / `GRADE_ANSWER` modeled separately (§8.2).
- Runtime UI legality separated from authorization (§10.1).
- Answer Protocol v2 separated from AuthZ (§11.1).
- Every load-bearing claim carries file/line or live-`rg` evidence (§14.2).
