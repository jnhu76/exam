# S3 — Current Role Check Audit

> **Date:** 2026-06-29
> **Branch:** `phase3/role-check-audit`
> **Scope:** All role / permission / authorization checks across `apps/` and `packages/`

---

## 1. Role Type System — Single Source of Truth

| Layer | File | Mechanism |
|-------|------|-----------|
| Domain | `packages/domain/src/enums.ts:1-6` | `Role = { Admin: "Admin", Candidate: "Candidate" } as const` |
| Contracts | `packages/contracts/src/user.ts:9` | `RoleSchema = z.enum(["Admin", "Candidate"])` |
| Contracts | `packages/contracts/src/user.ts:35,46` | `CreateUserRequestSchema.role = z.literal("Admin")`, Update same |
| Contracts | `packages/contracts/src/auth.ts:49-56,65-71` | `LoginResponse` / `MeResponse` carry `RoleSchema` |
| DB schema | `packages/db/src/schema/pg.ts:105` | `role: text("role").notNull()` — **plain text, no DB-level enum/check** |
| RBAC | `packages/auth/src/rbac.ts:3-22` | `ROLE_PERMISSIONS: Record<Role, Permission[]>` — Admin=15 perms, Candidate=2 perms |
| DB types | `packages/db/src/types.ts:2,13,21` | `TenantContext.role: Role`, `PlatformContext.role: Role` |
| Domain types | `packages/domain/src/types.ts:2,67,459` | `User.role: Role`, `RequestContext.role: Role` |

**Current roles (2):** `Admin`, `Candidate`.

**Absent roles (explicitly deferred to Phase 3+):** Teacher, Proctor, Grader, SuperAdmin, ContentManager, ResultViewer.

> `packages/auth/src/index.ts` exports nothing — auth consumed via direct file imports.

---

## 2. Auth Middleware Architecture

### 2.1 Authentication Plugin — `apps/api/src/plugins/auth.ts`

| Line | Function | Behavior |
|------|----------|----------|
| 24-94 | `authenticate` preHandler | Cookie `auth-token` → verifyJWT → load user → populate `request.ctx` |
| 31-35 | missing token | → `401 AUTH_REQUIRED` |
| 46-49 | invalid/expired JWT | → `401 AUTH_REQUIRED` |
| 75-79 | inactive user | → `401 AUTH_REQUIRED` |
| 81-87 | success | `ctx = { actorId, organizationId, role, permissions, sessionId }` |
| 104-119 | `requirePermission` | No ctx → 401; permission missing → 403 **PERMISSION_DENIED** — **unused by any route** |
| 126-141 | `requireRole` | No ctx → 401; role not in allowed list → 403 **PERMISSION_DENIED** |

> **Key finding:** `requirePermission` is fully implemented but **zero routes call it**. All authorization goes through `requireRole`.

### 2.2 Tenant Plugin — `apps/api/src/plugins/tenant.ts`

| Line | Behavior |
|------|----------|
| 42-55 | `onRoute` hook detects `_isAuthenticate` marker, auto-injects tenantGuardHook after authenticate |
| 57-58 | Creates `tenantHandler` wrapper around `tenantGuardHook` |
| 16 | `tenantGuardHook` calls `validateTenantAccess` from `tenantGuard.ts` |

### 2.3 Tenant Guard — `packages/auth/src/tenantGuard.ts`

| Line | Behavior |
|------|----------|
| 10-14 | `DEFAULT_PLATFORM_APIS`: `GET /api/auth/me`, `PATCH /api/auth/me`, `GET /api/system/health` (3 entries) |
| 32-38 | `isPublicEndpoint`: `/api/health`, `/api/settings/branding`, `/api/system/public-config`, `/api/system/info` |
| 45-52 | `validateTenantAccess` — **Phase 1 no-op**: only checks public endpoints |

### 2.4 Security Plugin — `apps/api/src/plugins/security.ts`

| Line | Behavior |
|------|----------|
| 134-157 | CSRF origin enforcement: non-safe methods without valid origin → `403 CSRF_ORIGIN_REJECTED` |

### 2.5 Internal System Contexts (hardcoded `role: "Admin"`)

| File | Line | Purpose |
|------|------|---------|
| `apps/api/src/plugins/deadlineScanner.ts:97` | `role: "Admin"` | Auto-submit system actor context |
| `apps/api/src/plugins/heartbeat.ts:103` | `role: "Admin"` | Heartbeat scanner system actor context |

---

## 3. Route-Level Authorization — Complete Inventory

### 3.1 Authorization Patterns

All protected routes use one of these `preHandler` patterns:

| Pattern | Meaning |
|---------|---------|
| `[authenticate, requireRole(["Admin"])]` | Admin-only |
| `[authenticate, requireRole(["Candidate"])]` | Candidate-only |
| `[authenticate, requireRole(["Candidate", "Admin"])]` | Both roles |
| `[authenticate]` | Authenticated, no role gate |
| *(none)* | Public |

### 3.2 Public Endpoints (no auth)

| Route | File | Notes |
|-------|------|-------|
| `GET /api/health` | — | Health check |
| `GET /api/settings/branding` | `settings.ts` | Public branding |
| `GET /api/system/info` | `system.ts` | System info |
| `GET /api/system/public-config` | `system.ts` | Public config |
| `POST /api/auth/register` | `auth.ts:42-63` | Always returns `403 AUTH_REGISTER_DISABLED` |
| `POST /api/auth/login` | `auth.ts:65-237` | Public login |

### 3.3 Admin-Only Routes (`requireRole(["Admin"])`)

| File | Routes |
|------|--------|
| `attempts.admin.ts` | misconduct, force-submit, extend-time, timeline, export (JSON), export (CSV) |
| `audit.ts` | audit-logs list |
| `candidate.ts` | list, create, update, import |
| `candidateField.ts` | list, create, update, delete, template |
| `course.ts` | list, detail, create, update, delete |
| `exam.ts` | list, detail, create, update, publish, close, unpublish, extend, cancel, archive, publish-results, delete, enrollments (CRUD), candidate-status |
| `export.ts` | score export |
| `gradingQueue.ts` | list, grading-details, grade-question |
| `importLogs.ts` | import-logs list |
| `proctorMonitoring.ts` | proctor attempts, proctor events |
| `question.ts` | list, detail, create, update, delete, import |
| `scores.ts` | exam scores list |
| `settings.ts` | settings list, branding (admin), branding update |
| `system.ts` | health, dashboard, diagnostics |
| `user.ts` | list, create, update, reset-password, delete |

### 3.4 Candidate-Only Routes (`requireRole(["Candidate"])`)

| File | Routes |
|------|--------|
| `attempts.candidate.ts` | exam list, exam detail, queue, start, attempt detail, save answer, submit, heartbeat, restore |

### 3.5 Both Roles (`requireRole(["Candidate", "Admin"])`)

| File | Route | Handler-level logic |
|------|-------|---------------------|
| `scores.ts:379` | `GET /scores/attempts/:attemptId` | Admin sees any attempt; candidate sees only own (line 80: `ctx.role !== "Candidate"`) |

### 3.6 Authenticated, No Role Gate (`authenticate` only)

| File | Route |
|------|-------|
| `auth.ts:286` | `GET /me` |
| `auth.ts:325` | `PATCH /me/password` |
| `auth.ts:389` | `PATCH /me/profile` |
| `clientEvents.ts:51` | `POST /client-events` (telemetry) |

---

## 4. Handler-Level Role Logic (beyond `requireRole`)

### 4.1 Login — legacy role rejection

**`apps/api/src/routes/auth.ts:155`**

```ts
if (user.role !== "Admin" && user.role !== "Candidate") {
  // Audit logs with reason: "unsupported_phase1_role"
  // Returns 401 AUTH_INVALID_CREDENTIALS
}
```

> **Hardcoded role strings:** `"Admin"`, `"Candidate"` — does not use `Role` const values.

### 4.2 Scores — role-conditional visibility

**`apps/api/src/routes/scores.ts:80`**

```ts
if (ctx.role !== "Candidate") {
  // Admin sees any attempt
} else {
  // Candidate sees only own attempts
}
```

**`apps/api/src/routes/scores.ts:209`**

```ts
if (role !== "Candidate") {
  return { visible: true }; // Admin bypasses publication gate
}
```

> **Hardcoded role string:** `"Candidate"` — should use `Role.Candidate`.

### 4.3 Users — inline schema, last-admin guard, reset-password guard

**`apps/api/src/routes/user.ts:29`**

```ts
role: z.enum(["Admin", "Candidate"]) // Inline schema, duplicates RoleSchema
```

**`apps/api/src/routes/user.ts:48`**

```ts
const PHASE1_SUPPORTED_ROLES = ["Admin", "Candidate"] as const;
```

**`apps/api/src/routes/user.ts:189-201`**

```ts
const willDisableAdmin =
  target.role === "Admin" && target.isActive &&
  ((data.isActive !== undefined && data.isActive === false) ||
   (data.role !== undefined && data.role !== "Admin"));
if (willDisableAdmin) {
  const activeAdminCount = await repo.countActiveByRole(ctx, "Admin");
  if (activeAdminCount <= 1) {
    throw new ValidationError("...", { reason: "LAST_ACTIVE_ADMIN" });
  }
}
```

**`apps/api/src/routes/user.ts:262`**

```ts
if (target.role !== "Candidate") {
  // Password reset only for Candidate users
  return reply.code(400).send(buildErrorResponse(..., "PASSWORD_RESET_TARGET_ROLE_NOT_ALLOWED"));
}
```

> **Hardcoded role strings:** `"Admin"`, `"Candidate"` throughout. Inline `z.enum` duplicates `RoleSchema`.

---

## 5. Domain Error Types

| Error Class | File | HTTP | Code |
|-------------|------|------|------|
| `PermissionDeniedError` | `packages/domain/src/errors.ts:36-39` | 403 | `PERMISSION_DENIED` |
| `TenantAccessDeniedError` | `packages/domain/src/errors.ts:43-47` | 403 | `TENANT_ACCESS_DENIED` |

> **Notable:** No `RoleNotAllowedError` or `InsufficientRoleError`. The auth plugin uses the raw string `"PERMISSION_DENIED"` in `buildErrorResponse` rather than the domain error class.

---

## 6. Client-Side Role Checks

### 6.1 Route Guards

| File | Line | Logic |
|------|------|-------|
| `AdminLayout.tsx:39` | `if (!user \|\| user.role === "Candidate")` | Blocks Candidate from `/admin/*` |
| `ExamLayout.tsx:45` | `if (!user \|\| user.role !== "Candidate")` | Blocks non-Candidate from `/exam/*` |

### 6.2 Role-Based Navigation

| File | Line | Logic |
|------|------|-------|
| `AuthContext.tsx:37` | `user.role === "Candidate" ? "/exam/list" : "/admin/dashboard"` | Post-login redirect |

### 6.3 Conditional UI

| File | Line | Logic |
|------|------|-------|
| `AppSidebar.tsx:190` | `const showManagement = user.role === Role.Admin;` | Management nav section |

### 6.4 API Client

| File | Line | Logic |
|------|------|-------|
| `api.ts:77` | `if (response.status === 401) { navigateFn?.("/login"); }` | Auto-redirect on 401 |

### 6.5 Users Page

| File | Line | Logic |
|------|------|-------|
| `UsersPage.tsx:48` | `role: "Admin" \| "Candidate"` | EditableRole type |
| `UsersPage.tsx:86` | `user.role !== "Candidate"` | Filters list |

> **Hardcoded role strings on frontend:** `"Candidate"`, `"Admin"` appear as string literals, not imported from `Role` const.

---

## 7. Database — Role Storage

**`packages/db/src/schema/pg.ts:105`:** `role: text("role").notNull()` — plain text column, **no PostgreSQL ENUM or CHECK constraint**.

Role validity enforced only at application layer (Zod schemas, domain `Role` const).

### 7.1 Role-Related Queries

| File | Method | Notes |
|------|--------|-------|
| `packages/db/src/repository/userRepo.ts:73-98` | `listPaginatedByRoles(ctx, roles)` | `inArray(users.role, roles)` |
| `packages/db/src/repository/userRepo.ts:100-118` | `countActiveByRole(ctx, role)` | `eq(users.role, role) + eq(users.isActive, true)` |

No other repository filters by role. All others scope by `organizationId`.

---

## 8. Hardcoded Role String Inventory

Every occurrence of `"Admin"`, `"Candidate"`, or inline `z.enum(["Admin", "Candidate"])` outside of the canonical `Role` definition and `RoleSchema`:

| Location | Line(s) | String(s) | Should use |
|----------|---------|-----------|------------|
| `apps/api/src/plugins/auth.ts:97` | 104 | `role: user.role` | ✅ OK (from DB) |
| `apps/api/src/plugins/deadlineScanner.ts:97` | 97 | `role: "Admin"` | `Role.Admin` |
| `apps/api/src/plugins/heartbeat.ts:103` | 103 | `role: "Admin"` | `Role.Admin` |
| `apps/api/src/routes/auth.ts:117,134` | 117, 134 | `role: "Candidate" as const` | `Role.Candidate` |
| `apps/api/src/routes/auth.ts:155` | 155 | `"Admin" && ... "Candidate"` | `Role.Admin`, `Role.Candidate` |
| `apps/api/src/routes/user.ts:29` | 29 | `z.enum(["Admin", "Candidate"])` | `RoleSchema` |
| `apps/api/src/routes/user.ts:48` | 48 | `["Admin", "Candidate"]` | `Object.values(Role)` |
| `apps/api/src/routes/user.ts:190,193` | 190, 193 | `target.role === "Admin"`, `data.role !== "Admin"` | `Role.Admin` |
| `apps/api/src/routes/user.ts:195` | 195 | `countActiveByRole(ctx, "Admin")` | `Role.Admin` |
| `apps/api/src/routes/user.ts:262` | 262 | `target.role !== "Candidate"` | `Role.Candidate` |
| `apps/api/src/routes/scores.ts:80` | 80 | `ctx.role !== "Candidate"` | `Role.Candidate` |
| `apps/api/src/routes/scores.ts:209` | 209 | `role !== "Candidate"` | `Role.Candidate` |
| `apps/api/src/routes/candidate.ts:269` | 269 | `role: "Candidate" as const` | `Role.Candidate` |
| `apps/api/src/routes/candidate.ts:502` | 502 | `role: "Candidate" as const` | `Role.Candidate` (import flow) |
| `apps/api/src/scripts/bootstrap-admin.ts:56,66,78` | 56, 66, 78 | `role: "Admin"`, `"Admin"` (countActiveByRole) | `Role.Admin` |
| `apps/api/src/scripts/reset-admin-password.ts:49` | 49 | `role: "Admin" as const` | `Role.Admin` |
| `apps/web/src/contexts/AuthContext.tsx:37` | 37 | `user.role === "Candidate"` | `Role.Candidate` |
| `apps/web/src/components/layout/AdminLayout.tsx:39` | 39 | `user.role === "Candidate"` | `Role.Candidate` |
| `apps/web/src/components/layout/ExamLayout.tsx:45` | 45 | `user.role !== "Candidate"` | `Role.Candidate` |
| `apps/web/src/pages/admin/UsersPage.tsx:48,86` | 48, 86 | `"Admin"`, `"Candidate"` | `Role.Admin`, `Role.Candidate` |
| `packages/db/src/seed.ts:29,33,38` | 29, 33, 38 | `"Admin"`, `"Candidate"` | `Role.Admin`, `Role.Candidate` |
| `packages/db/src/demo-seed.ts:195-199` | 195-199 | `"Admin"`, `"Candidate"` | `Role.Admin`, `Role.Candidate` |

**Count:** ~22 sites with hardcoded role strings outside the canonical definition.

---

## 9. Permission System — Defined, Partially Wired, Mostly Dead

### 9.1 Permission Enum

`packages/domain/src/enums.ts:15-47` defines **22 permissions** across 8 groups:

```
Organization:  MANAGE_ORGANIZATION, MANAGE_CANDIDATE_FIELDS
Users:         MANAGE_USERS
Question Bank: CREATE_QUESTION, EDIT_QUESTION, DELETE_QUESTION, IMPORT_QUESTIONS
Course:        MANAGE_COURSES
Exam:          CREATE_EXAM, EDIT_EXAM, PUBLISH_EXAM, ARCHIVE_EXAM, DELETE_EXAM
Proctor:       VIEW_EXAM_ROOM, EXTEND_TIME, MARK_MISCONDUCT, FORCE_SUBMIT
Candidate:     TAKE_EXAM, VIEW_OWN_SCORE
Scores:        VIEW_ALL_SCORES, EXPORT_SCORES
System:        VIEW_SYSTEM_HEALTH
```

### 9.2 RBAC Mapping (`packages/auth/src/rbac.ts:4-22`)

| Role | Granted (count) | Granted permissions |
|------|-----------------|---------------------|
| **Admin** | **15** | MANAGE_USERS, MANAGE_CANDIDATE_FIELDS, MANAGE_COURSES, CREATE_QUESTION, EDIT_QUESTION, DELETE_QUESTION, IMPORT_QUESTIONS, CREATE_EXAM, EDIT_EXAM, PUBLISH_EXAM, ARCHIVE_EXAM, DELETE_EXAM, VIEW_ALL_SCORES, EXPORT_SCORES, VIEW_SYSTEM_HEALTH |
| **Candidate** | **2** | TAKE_EXAM, VIEW_OWN_SCORE |

**Not granted to Admin (7 permissions):**

| Permission | Group | Why notable |
|-----------|-------|-------------|
| `MANAGE_ORGANIZATION` | Organization | Defined but **granted to no role** and **used by no route** — fully dead |
| `VIEW_EXAM_ROOM` | Proctor | Route exists (`proctorMonitoring.ts`) but gated by `requireRole(["Admin"])`, not by this permission |
| `EXTEND_TIME` | Proctor | Route exists (`attempts.admin.ts` extend-time) but gated by `requireRole(["Admin"])` |
| `MARK_MISCONDUCT` | Proctor | Route exists (`attempts.admin.ts` misconduct) but gated by `requireRole(["Admin"])` |
| `FORCE_SUBMIT` | Proctor | Route exists (`attempts.admin.ts` force-submit) but gated by `requireRole(["Admin"])` |
| `TAKE_EXAM` | Candidate | Candidate-only — correctly excluded from Admin |
| `VIEW_OWN_SCORE` | Scores | Candidate-only — correctly excluded from Admin |

> **Critical:** The 4 "Proctor" permissions + `MANAGE_ORGANIZATION` are defined in the enum but **not wired into the RBAC mapping**. If Phase 3 migrates any proctor route from `requireRole(["Admin"])` to `requirePermission(Permission.EXTEND_TIME)`, **Admin would be denied** because Admin does not hold that permission. See R11 below.

### 9.3 Complete Permission Inventory — Definition, RBAC, and Route Mapping

| # | Permission | Group | Admin | Cand. | Route that SHOULD map to it | Actual route gate | Gap? |
|---|-----------|-------|:-----:|:-----:|-----------------------------|-------------------|------|
| 1 | `MANAGE_ORGANIZATION` | Org | — | — | *(no route exists)* | N/A | **Dead**: defined, unassigned, unused |
| 2 | `MANAGE_CANDIDATE_FIELDS` | Org | ✅ | — | `candidateField.ts` CRUD | `requireRole(["Admin"])` | Wired via role, not permission |
| 3 | `MANAGE_USERS` | Users | ✅ | — | `user.ts` CRUD | `requireRole(["Admin"])` | Wired via role, not permission |
| 4 | `CREATE_QUESTION` | Q-Bank | ✅ | — | `question.ts` create | `requireRole(["Admin"])` | Wired via role, not permission |
| 5 | `EDIT_QUESTION` | Q-Bank | ✅ | — | `question.ts` update | `requireRole(["Admin"])` | Wired via role, not permission |
| 6 | `DELETE_QUESTION` | Q-Bank | ✅ | — | `question.ts` delete | `requireRole(["Admin"])` | Wired via role, not permission |
| 7 | `IMPORT_QUESTIONS` | Q-Bank | ✅ | — | `question.ts` import | `requireRole(["Admin"])` | Wired via role, not permission |
| 8 | `MANAGE_COURSES` | Course | ✅ | — | `course.ts` CRUD | `requireRole(["Admin"])` | Wired via role, not permission |
| 9 | `CREATE_EXAM` | Exam | ✅ | — | `exam.ts` create | `requireRole(["Admin"])` | Wired via role, not permission |
| 10 | `EDIT_EXAM` | Exam | ✅ | — | `exam.ts` update | `requireRole(["Admin"])` | Wired via role, not permission |
| 11 | `PUBLISH_EXAM` | Exam | ✅ | — | `exam.ts` publish/unpublish | `requireRole(["Admin"])` | Wired via role, not permission |
| 12 | `ARCHIVE_EXAM` | Exam | ✅ | — | `exam.ts` archive | `requireRole(["Admin"])` | Wired via role, not permission |
| 13 | `DELETE_EXAM` | Exam | ✅ | — | `exam.ts` delete | `requireRole(["Admin"])` | Wired via role, not permission |
| 14 | `VIEW_EXAM_ROOM` | Proctor | — | — | `proctorMonitoring.ts` attempts | `requireRole(["Admin"])` | **Trap**: perm not granted to Admin |
| 15 | `EXTEND_TIME` | Proctor | — | — | `attempts.admin.ts` extend-time | `requireRole(["Admin"])` | **Trap**: perm not granted to Admin |
| 16 | `MARK_MISCONDUCT` | Proctor | — | — | `attempts.admin.ts` misconduct | `requireRole(["Admin"])` | **Trap**: perm not granted to Admin |
| 17 | `FORCE_SUBMIT` | Proctor | — | — | `attempts.admin.ts` force-submit | `requireRole(["Admin"])` | **Trap**: perm not granted to Admin |
| 18 | `TAKE_EXAM` | Candidate | — | ✅ | `attempts.candidate.ts` start/submit | `requireRole(["Candidate"])` | Wired via role, not permission |
| 19 | `VIEW_OWN_SCORE` | Scores | — | ✅ | `scores.ts` own attempt detail | `requireRole(["Candidate","Admin"])` + handler | Wired via role, not permission |
| 20 | `VIEW_ALL_SCORES` | Scores | ✅ | — | `scores.ts` exam scores list | `requireRole(["Admin"])` | Wired via role, not permission |
| 21 | `EXPORT_SCORES` | Scores | ✅ | — | `export.ts`, `attempts.admin.ts` export | `requireRole(["Admin"])` | Wired via role, not permission |
| 22 | `VIEW_SYSTEM_HEALTH` | System | ✅ | — | `system.ts` health/dashboard | `requireRole(["Admin"])` | Wired via role, not permission |

**Summary:** 22 permissions defined → 17 assigned to at least one role → **5 unassigned** (MANAGE_ORGANIZATION + 4 Proctor). Zero routes use `requirePermission()`. All 22 are enforced exclusively through coarse `requireRole()`.

### 9.4 Permission Lifecycle — Where Permissions Appear in Code

| Stage | File | Line(s) | What happens |
|-------|------|---------|--------------|
| **Definition** | `packages/domain/src/enums.ts` | 15-48 | `Permission` const + type — 22 values |
| **RBAC mapping** | `packages/auth/src/rbac.ts` | 4-22 | `ROLE_PERMISSIONS: Record<Role, Permission[]>` — Admin=15, Candidate=2 |
| **RBAC lookup** | `packages/auth/src/rbac.ts` | 26-28 | `getPermissionsForRole(role)` → returns `Permission[]` |
| **JWT payload** | `packages/auth/src/session.ts` | 6-9 | `JwtPayload = Omit<RequestContext, "permissions" \| ...>` — **permissions NOT in JWT** |
| **Context type (domain)** | `packages/domain/src/types.ts` | 460 | `RequestContext.permissions: Permission[]` |
| **Context type (db)** | `packages/db/src/types.ts` | 13, 21 | `TenantContext.permissions`, `PlatformContext.permissions` |
| **Population at auth** | `apps/api/src/plugins/auth.ts` | 85 | `permissions: getPermissionsForRole(user.role)` — computed per-request from DB role |
| **Enforcement decorator** | `apps/api/src/plugins/auth.ts` | 104-119 | `requirePermission(perm)` → checks `ctx.permissions.includes(perm)` |
| **Actual enforcement** | *(none)* | — | **Zero routes call `requirePermission()`** — all use `requireRole()` |
| **Tests** | `packages/auth/src/rbac.test.ts` | 1-35 | Tests Admin/Candidate/future-role permission sets |
| **Tests (context)** | `packages/db/src/__tests__/context-types.test.ts` | 22, 44 | Uses permission strings in test contexts |

### 9.5 Key Observation

The permission system is a **parallel authorization model that shadows the real one**:

- The **real** authorization is `requireRole()` — coarse, 2 roles, all-or-nothing.
- The **shadow** authorization is `requirePermission()` — fine-grained, 22 permissions, RBAC-mapped — but **never invoked**.
- `ctx.permissions` is populated on every authenticated request (auth.ts:85) but **never read** except inside the dead `requirePermission` decorator.
- Migrating from role-gate to permission-gate is not a flip — 5 permissions have no role assignment, so those routes would break.

---

## 10. Test Coverage for Role Checks

### 10.1 Security Test Suites

| File | What it tests |
|------|---------------|
| `apps/api/src/routes/permissionBoundary.test.ts` | All protected endpoints → unauthenticated gets 401; Candidate gets 403 on admin APIs |
| `apps/api/tests/security/rbac-matrix.test.ts` | Role-based 403 matrix across endpoints |
| `apps/api/tests/security/unauthorized-access.test.ts` | Candidate 403 on admin APIs + error code verification |
| `apps/api/tests/security/tenant-isolation.test.ts` | Cross-org rejection |

### 10.2 Route-Level 403 Tests

20+ individual route test files verify candidate-role rejection. See `apps/api/src/routes/*.test.ts` for per-route coverage.

### 10.3 E2E 403 Assertions

| File | Assertion |
|------|-----------|
| `apps/e2e/e2e/proctor-monitoring-ui.spec.ts:105-113` | Candidate cannot access proctor dashboard |
| `apps/e2e/e2e/proctor-runtime.spec.ts:174-180` | Candidate cannot access candidate status |

### 10.4 Test Helpers

`apps/api/src/routes/testHelpers.ts` provides:

- `TestContext.adminToken` / `TestContext.candidateToken`
- `createFutureRoleUserForTest()` with `LEGACY_ROLES` array: `["SuperAdmin", "Teacher", "Proctor", "Grader", "ContentManager", "ResultViewer"]`

> `LEGACY_ROLES` ensures forward compatibility — future Phase 3 roles are testable today.

---

## 11. Current Authorization Model Summary

```
                    ┌──────────────────────┐
                    │  authenticate plugin │  → 401 if no/invalid token
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  requireRole plugin   │  → 403 if role not in [allowed]
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  handler logic         │  → business rules (may check role again)
                    └──────────────────────┘
```

**Model:** Coarse role-gate (`requireRole`) at route level + ad-hoc role checks in handlers. No fine-grained permission checks. No scoped access (all-or-nothing per role).

---

## 12. Risk Points

### R1 — No DB-level role constraint
`role` column is `text` with no CHECK/ENUM. A direct SQL insert of `"Teacher"` would succeed silently and be accepted by the application only at login time (rejected with `unsupported_phase1_role`).

### R2 — Hardcoded role strings everywhere
~22 sites use string literals `"Admin"` / `"Candidate"` instead of `Role.Admin` / `Role.Candidate`. Adding a new role requires finding and updating all these sites manually.

### R3 — Permission system is dead code
`requirePermission` exists but is never called. All routes use `requireRole`. `ctx.permissions` is populated on every request (auth.ts:85) but never read. If Phase 3 introduces scoped permissions, the current `requireRole`-only approach must be augmented or replaced.

### R4 — Handler-level role logic is scattered
`scores.ts:80`, `scores.ts:209`, `user.ts:189-201`, `user.ts:262`, `auth.ts:155` each contain ad-hoc `role === "X"` checks. These are invisible to static analysis tools and easy to miss when adding new roles.

### R5 — System contexts claim `role: "Admin"`
`deadlineScanner.ts` and `heartbeat.ts` create system contexts with `role: "Admin"`. When Phase 3 adds scoped roles, system actors should have their own role or a distinct `SYSTEM` role.

### R6 — Login rejects future roles with 401
`auth.ts:155` returns `401 AUTH_INVALID_CREDENTIALS` for unsupported roles. This is technically misleading — the credentials are valid, the role is unsupported. Should be `403` with a dedicated error code.

### R7 — User creation schema locks to `z.literal("Admin")`
`CreateUserRequestSchema.role = z.literal("Admin")` in contracts. Phase 3 staff invitation with `Teacher` / `Proctor` / `Grader` roles requires changing the contract.

### R8 — TenantGuard is a no-op
`validateTenantAccess` does nothing for Phase 1. Phase 3 scoped access must decide whether to enhance this or build a separate scope-enforcement layer.

### R9 — `LEGACY_ROLES` in test helpers
`["SuperAdmin", "Teacher", "Proctor", "Grader", "ContentManager", "ResultViewer"]` — these are pre-named but may diverge from Phase 3 actual role names. Needs alignment when Phase 3 role design is finalized.

### R10 — No role audit on mutation
No audit log is recorded when a user's role is changed via `PATCH /users/:id`. Adding audit trail for role changes is a Phase 3 requirement.

### R11 — Proctor permissions are a migration trap
Four "Proctor" group permissions (`VIEW_EXAM_ROOM`, `EXTEND_TIME`, `MARK_MISCONDUCT`, `FORCE_SUBMIT`) are defined in `enums.ts` but **not granted to Admin** in `rbac.ts`. Their routes (`proctorMonitoring.ts`, `attempts.admin.ts` misconduct/force-submit/extend-time) are currently gated by `requireRole(["Admin"])`. If Phase 3 migrates any of these routes to `requirePermission(Permission.EXTEND_TIME)`, **Admin would be denied** because Admin's permission set does not include these values. The RBAC mapping must be reconciled before any permission-gate migration.

### R12 — `MANAGE_ORGANIZATION` is fully dead
`MANAGE_ORGANIZATION` is defined in `enums.ts:17` but granted to no role and used by no route. It is the only permission with zero consumers in both the RBAC mapping and the route layer. Phase 3 must decide whether to wire it to Admin or remove it.

---

## 13. Files Containing Role/Permission Checks

### Production Code

| File | Type |
|------|------|
| `packages/domain/src/enums.ts` | Role + Permission definitions |
| `packages/domain/src/types.ts` | User.role, RequestContext.role |
| `packages/domain/src/errors.ts` | PermissionDeniedError, TenantAccessDeniedError |
| `packages/contracts/src/user.ts` | RoleSchema, user creation/update schemas |
| `packages/contracts/src/auth.ts` | LoginResponse, MeResponse (role field) |
| `packages/auth/src/rbac.ts` | ROLE_PERMISSIONS mapping |
| `packages/auth/src/session.ts` | JWT payload (includes role) |
| `packages/auth/src/tenantGuard.ts` | Public endpoint / platform API bypass |
| `packages/db/src/schema/pg.ts` | users.role column (text) |
| `packages/db/src/repository/userRepo.ts` | listPaginatedByRoles, countActiveByRole |
| `packages/db/src/seed.ts` | Seed credentials (Admin, Candidate) |
| `packages/db/src/demo-seed.ts` | Demo seed (Admin + 4 Candidates) |
| `apps/api/src/plugins/auth.ts` | authenticate, requireRole, requirePermission |
| `apps/api/src/plugins/tenant.ts` | Tenant hook injection |
| `apps/api/src/plugins/security.ts` | CSRF enforcement |
| `apps/api/src/plugins/deadlineScanner.ts` | System context |
| `apps/api/src/plugins/heartbeat.ts` | System context |
| `apps/api/src/scripts/bootstrap-admin.ts` | Admin bootstrap |
| `apps/api/src/scripts/reset-admin-password.ts` | Admin password reset (hardcoded role) |
| `apps/api/src/routes/auth.ts` | Login role rejection |
| `apps/api/src/routes/user.ts` | Inline schema, last-admin guard, reset guard |
| `apps/api/src/routes/scores.ts` | Role-conditional visibility |
| `apps/api/src/routes/candidate.ts` | Candidate creation with hardcoded role |
| `apps/api/src/routes/attempts.admin.ts` | Admin-only routes |
| `apps/api/src/routes/attempts.candidate.ts` | Candidate-only routes |
| `apps/api/src/routes/exam.ts` | Admin-only routes |
| `apps/api/src/routes/course.ts` | Admin-only routes |
| `apps/api/src/routes/question.ts` | Admin-only routes |
| `apps/api/src/routes/audit.ts` | Admin-only routes |
| `apps/api/src/routes/candidateField.ts` | Admin-only routes |
| `apps/api/src/routes/export.ts` | Admin-only routes |
| `apps/api/src/routes/gradingQueue.ts` | Admin-only routes |
| `apps/api/src/routes/importLogs.ts` | Admin-only routes |
| `apps/api/src/routes/proctorMonitoring.ts` | Admin-only routes |
| `apps/api/src/routes/settings.ts` | Admin-only routes |
| `apps/api/src/routes/system.ts` | Admin-only routes |
| `apps/api/src/routes/clientEvents.ts` | Authenticated, no role gate |
| `apps/web/src/contexts/AuthContext.tsx` | Role-based navigation |
| `apps/web/src/components/layout/AdminLayout.tsx` | Candidate block |
| `apps/web/src/components/layout/ExamLayout.tsx` | Non-Candidate block |
| `apps/web/src/components/layout/AppSidebar.tsx` | Role-based nav rendering |
| `apps/web/src/pages/admin/UsersPage.tsx` | Role filter/display |
| `apps/web/src/lib/api.ts` | 401 redirect |

### Test Code

| File | Type |
|------|------|
| `apps/api/src/routes/permissionBoundary.test.ts` | Systematic 401/403 matrix |
| `apps/api/src/routes/testHelpers.ts` | TestContext, role tokens, LEGACY_ROLES |
| `packages/auth/src/rbac.test.ts` | RBAC mapping assertions (Admin/Candidate/future roles) |
| `apps/api/tests/security/rbac-matrix.test.ts` | RBAC assertions |
| `apps/api/tests/security/unauthorized-access.test.ts` | Unauthorized access |
| `apps/api/tests/security/tenant-isolation.test.ts` | Cross-org rejection |
| `apps/e2e/lib/login.ts` | Role-based login helpers |
| `apps/e2e/lib/flow.ts` | Role-based flow helpers |
| `apps/e2e/lib/seed.ts` | Admin seed for E2E |
| `apps/e2e/e2e/proctor-monitoring-ui.spec.ts` | Candidate 403 |
| `apps/e2e/e2e/proctor-runtime.spec.ts` | Candidate 403 |
| 20+ individual `*.test.ts` files | Per-route candidate rejection |

---

## 14. Input for Phase 3 Large Job (Permission Model Design)

Questions the Large permission-model job must answer:

1. **Role granularity:** Will Phase 3 introduce new roles (Teacher, Proctor, Grader, ContentManager) or only modify the permission mapping for existing Admin/Candidate?
2. **Role vs. Permission:** Should Phase 3 migrate from `requireRole` to `requirePermission`? If so, what is the migration strategy — gradual (both gates) or big-bang?
3. **Scope model:** What is the scope granularity — organization-wide, course-scoped, exam-scoped, candidate-group-scoped? How does scope interact with permission?
4. **System actor:** Should system actors (deadline scanner, heartbeat) get a distinct `SYSTEM` role instead of `Admin`?
5. **Role change audit:** What audit events are required when a user's role or permissions change?
6. **DB constraint:** Should `role` column get a PostgreSQL ENUM or CHECK constraint?
7. **Hardcoded strings migration:** Is consolidating ~22 hardcoded `"Admin"`/`"Candidate"` strings to use `Role` const values a prerequisite for the permission model?
8. **LEGACY_ROLES alignment:** Do the test-helper `LEGACY_ROLES` names match the Phase 3 role naming decision?
9. **Login behavior for future roles:** Should unsupported roles get `403` instead of `401 AUTH_INVALID_CREDENTIALS`?
10. **TenantGuard evolution:** Does Phase 3 enhance `tenantGuard.ts` for scope enforcement, or is scope a separate layer?
11. **Frontend guard migration:** How should `AdminLayout` / `ExamLayout` / `AppSidebar` adapt to multi-role users (e.g., a Teacher who is also an Admin)?
12. **Contract changes:** How do `RoleSchema`, `CreateUserRequestSchema`, and response DTOs change when new roles are added?
13. **Permission audit:** Phase 3 requires "Permission audit explains who granted which capability and why" — what data model supports this?
14. **Scoping + `requireRole` coexistence:** During migration, can `requireRole(["Admin"])` coexist with `requirePermission(MANAGE_EXAMS, { scope: "course:xyz" })`?
15. **Proctor permission gap (R11):** The 4 Proctor permissions (`VIEW_EXAM_ROOM`, `EXTEND_TIME`, `MARK_MISCONDUCT`, `FORCE_SUBMIT`) are defined but not granted to Admin. Before migrating these routes from `requireRole` to `requirePermission`, the RBAC mapping must be reconciled — otherwise Admin loses access. Should these be granted to Admin as a superset, or should a Proctor role be introduced with these permissions?
16. **Dead permission cleanup (R12):** `MANAGE_ORGANIZATION` is defined but unassigned and unused. Wire it to Admin (for org-settings routes), or remove it from the enum?
17. **Permission-to-route traceability:** 22 permissions are defined but none have a documented 1:1 mapping to their route(s). Should Phase 3 introduce a declarative permission registry (route → required permission(s)) that replaces ad-hoc `requireRole` calls?
