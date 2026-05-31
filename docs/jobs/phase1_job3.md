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

J0 (Infrastructure), J0.5 (Contracts — auth Zod schemas), J1 (DB — user/organization tables + repos)

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

## Subtasks

- [ ] **3.1** JWT plugin + password hashing
  - Acceptance: can hash a password, verify it matches; can sign a JWT token and verify it returns the correct payload
  - Files: `packages/auth/src/session.ts`, `packages/auth/src/password.ts`
  - Verify: unit test hash/verify round-trip; unit test JWT sign/verify round-trip

- [ ] **3.2** Auth routes: register + login + logout + me
  - Acceptance: POST /api/auth/register creates a user; POST /api/auth/login returns HTTP-only cookie; GET /api/auth/me returns current user; POST /api/auth/logout clears cookie; all inputs validated with Zod schemas from `@exam/contracts`
  - Files: `apps/api/src/routes/auth.ts`
  - Verify: curl complete login flow (register → login → me → logout → me returns 401)

- [ ] **3.3** Auth middleware: requireAuth + requireRole
  - Acceptance: unauthenticated request → 401; authenticated but wrong role → 403; correct role → request passes through with user on context
  - Files: `apps/api/src/plugins/auth.ts`
  - Verify: curl test all three cases against a protected route

- [ ] **3.4** Multi-tenant middleware: scopeToTenant
  - Acceptance: all requests inject organizationId into RequestContext; repository queries auto-filter by organizationId; different tenant users cannot see each other's data
  - Files: `packages/auth/src/tenantGuard.ts`, `apps/api/src/plugins/tenant.ts`
  - Verify: create two orgs with users, confirm cross-tenant data isolation via curl

- [ ] **3.5** Rate limiter middleware
  - Acceptance: login endpoint limited to 10 requests/minute; exceeding limit returns 429 with retry-after header
  - Files: `apps/api/src/plugins/rateLimit.ts`
  - Verify: rapid sequential curl requests to /api/auth/login trigger 429 after limit

- [ ] **3.6** Client: Login page
  - Acceptance: full-screen centered login card (max-w-sm); username + password inputs + login button; login failure shows red text below form (not alert); success redirect by role (Admin → /admin/dashboard, Candidate → /exam/list); product title and bottom text read from `BrandingView` in `BrandProvider`, using its generic fallback values until J4 connects the settings API
  - Files: `apps/web/src/pages/LoginPage.tsx`
  - Verify: full login flow in browser — wrong password shows inline error, correct login redirects to role-appropriate page

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

## Verify Commands

```bash
pnpm lint:copy
pnpm typecheck
pnpm test
pnpm db:generate && pnpm db:migrate && pnpm test:integration
pnpm --filter api dev
curl -X POST http://localhost:3000/api/auth/register -H 'Content-Type: application/json' -d '{"username":"test","password":"pass123","name":"Test","role":"Admin"}'
curl -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"test","password":"pass123"}' -c cookies.txt
curl http://localhost:3000/api/auth/me -b cookies.txt
curl -X POST http://localhost:3000/api/auth/logout -b cookies.txt
pnpm verify
```

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
- [ ] Queries filter by organizationId
- [ ] AuditLog written where required
