# Job 3: Auth System (Server + Login Page)

## Goal

Implement full authentication pipeline: JWT session management, password hashing, auth routes with Zod validation, multi-tenant scoping, rate limiting, and the login page.

## Scope

- JWT plugin + argon2/bcrypt password hashing
- Auth routes: register, login, logout, me
- Auth middleware: requireAuth + requireRole
- Multi-tenant middleware: scopeToTenant
- Rate limiter on login
- Login page UI

## Out of Scope

- OAuth / LDAP / SSO
- Password reset flow
- Account lockout beyond rate limiting
- User management pages (J4)

## Dependencies

J0 (Infrastructure), J0.5 (Contracts — auth Zod schemas), J1 (DB — user/organization tables + repos), J2 (db:seed 脚本 — 提供测试用户)

## Files to Create / Modify

- `packages/auth/src/session.ts`
- `packages/auth/src/password.ts`
- `packages/auth/src/tenantGuard.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/plugins/auth.ts`
- `apps/api/src/plugins/tenant.ts`
- `apps/api/src/plugins/rateLimit.ts`
- `apps/web/src/pages/LoginPage.tsx` (replace shell with full implementation)

## Data Model Changes

None (uses existing users/organizations tables from J1).

## API Contracts

Uses `@exam/contracts` auth schemas (defined in J0.5):

- `POST /api/auth/register` — register request/response
- `POST /api/auth/login` — login request/response (sets HTTP-only cookie)
- `POST /api/auth/logout` — clears cookie
- `GET /api/auth/me` — returns current user

## UI Tasks

- Login page (§3.1): full-screen centered login card, username + password, role-based redirect

## TDD Plan

- Unit: password hash/verify round-trip
- Unit: JWT sign/verify round-trip
- Integration: full register → login → me → logout → me returns 401
- Integration: wrong role → 403
- Integration: cross-tenant data isolation

**测试数据**：所有集成测试和 curl 验证使用 `pnpm db:seed` 创建的用户（admin/teacher/candidate），不要在测试中硬编码创建用户。

## Subtasks

- [ ] **3.1** JWT plugin + password hashing
  - Acceptance: can hash a password, verify it matches; can sign a JWT token and verify it returns the correct payload
  - Files: `packages/auth/src/session.ts`, `packages/auth/src/password.ts`
  - Verify: unit test hash/verify round-trip; unit test JWT sign/verify round-trip

- [ ] **3.2** Auth routes: register + login + logout + me
  - Acceptance: POST /api/auth/register creates a user; POST /api/auth/login returns HTTP-only cookie; GET /api/auth/me returns current user; POST /api/auth/logout clears cookie; all inputs validated with Zod schemas from `@exam/contracts`
  - Files: `apps/api/src/routes/auth.ts`
  - Verify: 使用 seed 用户 (admin/admin123) 测试完整登录流程: login → me → logout → me returns 401

- [ ] **3.3** Auth middleware: requireAuth + requireRole
  - Acceptance: unauthenticated request → 401; authenticated but wrong role → 403; correct role → request passes through with user on context
  - Files: `apps/api/src/plugins/auth.ts`
  - Verify: 使用 seed 用户测试三种情况: admin (通过), candidate 访问 admin 路由 (403), 无 cookie (401)

- [ ] **3.4** Multi-tenant middleware: scopeToTenant
  - Acceptance: all requests inject organizationId into RequestContext; repository queries auto-filter by organizationId; different tenant users cannot see each other's data
  - Files: `packages/auth/src/tenantGuard.ts`, `apps/api/src/plugins/tenant.ts`
  - Verify: 使用 seed 用户确认同组织数据隔离，创建第二个组织用户确认跨组织隔离

- [ ] **3.5** Rate limiter middleware
  - Acceptance: login endpoint limited to 10 requests/minute; exceeding limit returns 429 with retry-after header
  - Files: `apps/api/src/plugins/rateLimit.ts`
  - Verify: rapid sequential curl requests to /api/auth/login trigger 429 after limit

- [ ] **3.6** Client: Login page
  - Acceptance: full-screen centered login card (max-w-sm); username + password inputs + login button; login failure shows red text below form (not alert); success redirect by role (Admin → /admin/dashboard, Candidate → /exam/list); product title and bottom text read from `BrandingView` in `BrandProvider`, using its generic fallback values until J4 connects the settings API
  - Files: `apps/web/src/pages/LoginPage.tsx`
  - Verify: 使用 seed 用户在浏览器测试完整登录流程 — admin → /admin/dashboard, candidate → /exam/list

## Acceptance Criteria

1. Complete register → login → me → logout flow works
2. HTTP-only cookie set on login, cleared on logout
3. requireAuth returns 401 for unauthenticated
4. requireRole returns 403 for wrong role
5. Multi-tenant isolation: cross-org data invisible
6. Rate limiting: 429 after 10 login attempts/minute
7. Login page redirects by role
8. All routes use Zod validation from `@exam/contracts`
9. `pnpm typecheck` passes
10. 集成测试和 curl 验证使用 `pnpm db:seed` 创建的用户，不硬编码测试用户

## Verify Commands

```bash
pnpm lint:copy
pnpm typecheck
pnpm test
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm test:integration
pnpm --filter api dev
# 使用 seed 用户测试登录流程
curl -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' -c cookies.txt
curl http://localhost:3000/api/auth/me -b cookies.txt
curl -X POST http://localhost:3000/api/auth/logout -b cookies.txt
# 测试注册新用户
curl -X POST http://localhost:3000/api/auth/register -H 'Content-Type: application/json' -d '{"username":"test","password":"pass123","name":"Test","role":"Admin"}'
pnpm verify
```

### Seed 用户

`pnpm db:seed` 创建以下测试用户：

| Username    | Password       | Role       |
| ----------- | -------------- | ---------- |
| `admin`     | `admin123`     | SuperAdmin |
| `teacher`   | `teacher123`   | Teacher    |
| `candidate` | `candidate123` | Candidate  |

## Review Checklist

- [ ] Password hashing uses argon2 or bcrypt (not plain text)
- [ ] JWT secret from env var, not hardcoded
- [ ] HTTP-only + Secure + SameSite cookie flags
- [ ] Zod schemas imported from `@exam/contracts`, not redefined
- [ ] RequestContext populated with userId, organizationId, role
- [ ] Rate limit only on login, not all routes
- [ ] Login page uses role enum from `@exam/domain` for redirect
- [ ] No duplicate DTOs (types imported from `@exam/domain` or `@exam/contracts`)
- [ ] No `any` / `as any`
- [ ] No bare `db.select()` in routes (repository pattern only)
- [ ] No complex business logic in route handlers
- [ ] Repository methods receive RequestContext with organizationId
- [ ] State changes via command functions
- [ ] Errors use domain error types from `packages/domain/src/errors.ts`
- [ ] No `console.log` (use logger in api, nothing in packages)
- [ ] No unnecessary new dependencies
- [ ] No hardcoded deployment-specific product copy (e.g., 校内/校园/大学/学生)
- [ ] `pnpm verify` passes
- [ ] 集成测试使用 `pnpm db:seed` 用户，不硬编码测试凭证
- [ ] Queries filter by organizationId
- [ ] AuditLog written where required
