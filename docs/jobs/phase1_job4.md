# Job 4: Organization + User + Candidate Management

## Goal

Build organization CRUD, candidate field configuration, user management, candidate management with dynamic fields, and bulk CSV import.

## Scope

- Seed script for default org + super admin
- Organization CRUD (SuperAdmin)
- CandidateField configuration per org
- User management (Admin/Teacher/Proctor)
- Candidate management with dynamic fields
- CSV candidate import

## Out of Scope

- Tree-structured organization hierarchy (Phase 2)
- LDAP/OAuth user provisioning
- Bulk user operations beyond CSV import

## Dependencies

J1 (DB Schema + Repos), J3 (Auth System — middleware, RequestContext)

## Files to Create / Modify

- `packages/db/src/seed.ts`
- `apps/api/src/routes/organization.ts`
- `packages/contracts/src/organization.ts` (extend if needed)
- `apps/web/src/pages/admin/OrganizationPage.tsx`
- `apps/api/src/routes/candidateField.ts`
- `apps/web/src/pages/admin/CandidateFieldPage.tsx`
- `apps/api/src/routes/user.ts`
- `apps/web/src/pages/admin/UserPage.tsx`
- `apps/api/src/routes/candidate.ts`
- `apps/web/src/pages/admin/CandidatePage.tsx`
- `apps/web/src/components/shared/ImportWizard.tsx`
- `apps/web/src/components/shared/FileUpload.tsx`
- `packages/import-export/src/csv.ts`

## Data Model Changes

None (uses existing tables from J1).

## API Contracts

Uses `@exam/contracts` schemas (defined in J0.5):
- Organization CRUD
- User CRUD
- Candidate CRUD + import
- CandidateField CRUD

## UI Tasks

- Organization management page (§3.13)
- CandidateField config page (§3.13)
- User management page (§3.17)
- Candidate management page (§3.18)
- Candidate import dialog (§3.16)

## TDD Plan

- Integration: seed idempotency (run twice → no duplicates)
- Integration: org CRUD with tenant isolation
- Integration: candidate field CRUD + dynamic template generation
- Integration: user management with role validation
- Integration: CSV import with duplicate/missing field handling

## Subtasks

- [ ] **4.1** Seed script: default organization + super admin
  - Acceptance: `pnpm --filter api db:seed` creates default Organization and SuperAdmin user; running again is idempotent
  - Files: `packages/db/src/seed.ts`, `apps/api/package.json` (add db:seed script)
  - Verify: run seed → database has exactly 1 org + 1 super_admin user; run again → no duplicates

- [ ] **4.2** Organization CRUD routes + Admin page
  - Acceptance: SuperAdmin can list/create/update/delete Organizations; Admin sees only own org; admin page shows org list + create/edit dialog; Zod request/response schemas from `@exam/contracts`
  - Files: `apps/api/src/routes/organization.ts`, `apps/web/src/pages/admin/OrganizationPage.tsx`
  - Verify: curl full CRUD as SuperAdmin; browser create/edit/delete org; confirm Admin cannot access other orgs

- [ ] **4.3** CandidateField API + config page
  - Acceptance: Admin can define/modify/delete candidate fields per org; exactly one field marked as unique identifier; UI shows table (name, label, type, required, unique, sort) with drag-to-reorder; preview import template button generates CSV with configured field headers
  - Files: `apps/api/src/routes/candidateField.ts`, `apps/web/src/pages/admin/CandidateFieldPage.tsx`
  - Verify: curl configure fields; browser drag-reorder; download template and verify CSV headers match configured fields

- [ ] **4.4** User management API + page (Admin/Teacher/Proctor)
  - Acceptance: Admin can create/list/modify/disable non-candidate users; UI shows table (username, name, role badge, status, action buttons) with add user dialog; role shown as colored badge
  - Files: `apps/api/src/routes/user.ts`, `apps/web/src/pages/admin/UserPage.tsx`
  - Verify: browser add Admin, Teacher, and Proctor users; edit name/role; disable/enable account

- [ ] **4.5** Candidate management API + page + import
  - Acceptance: API supports manual create, bulk import (CSV), list query, modify, disable; UI table headers dynamically generated from CandidateField config; import button opens ImportWizard; ImportWizard flow: upload → preview (duplicate identifier marked "update", missing required marked "error") → confirm import
  - Files: `apps/api/src/routes/candidate.ts`, `apps/web/src/pages/admin/CandidatePage.tsx`, `apps/web/src/components/shared/ImportWizard.tsx`, `apps/web/src/components/shared/FileUpload.tsx`, `packages/import-export/src/csv.ts`
  - Verify: CSV import batch of candidates; dynamic table headers reflect CandidateField config; duplicate identifier rows show "update" status (not error); missing required field rows show "error"

## Acceptance Criteria

1. Seed script is idempotent
2. Organization CRUD works with tenant isolation
3. CandidateField config generates correct CSV template headers
4. User management with role validation works
5. CSV import handles duplicates and missing fields correctly
6. All routes use repository pattern with RequestContext
7. All routes use Zod validation from `@exam/contracts`
8. All user-facing strings in zh-CN
9. `pnpm typecheck` passes

## Verify Commands

```bash
pnpm typecheck
pnpm test
pnpm --filter api db:seed
pnpm --filter api dev
pnpm --filter web dev
```

## Review Checklist

- [ ] Seed script uses repository methods (not bare SQL)
- [ ] All routes use `repo.method(ctx, ...)` pattern
- [ ] CandidateField template CSV headers match configured fields
- [ ] Import handles UTF-8 with BOM for Excel compatibility
- [ ] Role validation prevents non-Admin from accessing user management
- [ ] Organization CRUD restricted to SuperAdmin
- [ ] All API errors return proper error codes (not stack traces)
- [ ] No duplicate DTOs (types imported from `@exam/domain` or `@exam/contracts`)
- [ ] No `any` / `as any`
- [ ] No bare `db.select()` in routes (repository pattern only)
- [ ] No complex business logic in route handlers
- [ ] Repository methods receive RequestContext with organizationId
- [ ] State changes via command functions
- [ ] Errors use domain error types from `packages/domain/src/errors.ts`
- [ ] No `console.log` (use logger in api, nothing in packages)
- [ ] No unnecessary new dependencies
- [ ] `pnpm verify` passes
- [ ] Queries filter by organizationId
- [ ] AuditLog written where required
