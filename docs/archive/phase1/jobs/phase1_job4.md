# Job 4: Organization Settings + User + Candidate Management

## Goal

Build organization settings (branding, product display), organization CRUD, candidate field configuration, user management, candidate management with dynamic fields, and bulk CSV import.

## Scope

- Seed script for default org + super admin
- Platform & organization settings (branding config)
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

J1 (DB Schema + Repos), J3 (Auth System — middleware, RequestContext), J3.5 (UI Foundation Backfill — shared layout, page shell, empty/loading/error states)

## UI Strategy

This job must produce fully usable admin pages, not shells. Every page listed under UI Tasks must be complete enough for an admin to perform real workflows end-to-end. J10 will polish visual consistency; it will not build missing pages.

**Minimum UI per page:**

- Table with sort/filter where applicable
- Create/edit dialogs with form validation
- Delete confirmation dialog
- Empty state when no data exists
- Loading state while fetching
- Error state on failure
- All user-facing text in zh-CN

## Files to Create / Modify

- `packages/db/src/seed.ts`
- `packages/contracts/src/settings.ts`
- `apps/api/src/routes/settings.ts`
- `packages/db/src/repository/settingsRepo.ts`
- `apps/web/src/pages/admin/SettingsPage.tsx`
- `apps/web/src/components/layout/BrandProvider.tsx` (extend J2 implementation)
- `apps/web/src/components/settings/PlatformSettingsForm.tsx`
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

None (uses `organization_settings` table from J1).

## API Contracts

Uses `@exam/contracts` schemas (defined in J0.5):

- Organization CRUD
- User CRUD
- Candidate CRUD + import
- CandidateField CRUD

## UI Tasks

- Organization settings / branding page (§3.20)
- Organization management page (`/admin/organizations`, see §2.1)
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

- [ ] **4.2** Organization Settings API + settings page (see §3.20)
  - Acceptance: API returns public branding settings (`GET /api/settings/branding?organizationSlug=:slug`); `organizationSlug` selects the tenant before login and may be omitted for the deployment default organization; the public endpoint uses constrained `PublicBrandingContext` and returns only `BrandingView` fields; Admin can update product title, subtitle, footer text, org display name, timezone (`PATCH /api/admin/settings/branding`); UI page shows form with all fields and CandidateField-based identity preview; login page, sidebar, and candidate header read branding from API via `BrandProvider`; changes take effect immediately after save; fallback values when no settings exist
  - Files: `packages/contracts/src/settings.ts`, `apps/api/src/routes/settings.ts`, `packages/db/src/repository/settingsRepo.ts`, `apps/web/src/pages/admin/SettingsPage.tsx`, `apps/web/src/components/layout/BrandProvider.tsx`, `apps/web/src/components/settings/PlatformSettingsForm.tsx`
  - Verify: curl GET settings by organizationSlug after PATCH → updated values; browser save form → login page shows new product title; sidebar shows new product name; integration test for default-organization lookup and fallback branding when no settings exist

- [ ] **4.3** Organization CRUD routes + Admin page
  - Acceptance: SuperAdmin can list/create/update/delete Organizations; Admin sees only own org; admin page shows org list + create/edit dialog; Zod request/response schemas from `@exam/contracts`
  - Files: `apps/api/src/routes/organization.ts`, `apps/web/src/pages/admin/OrganizationPage.tsx`
  - Verify: curl full CRUD as SuperAdmin; browser create/edit/delete org; confirm Admin cannot access other orgs

- [ ] **4.4** CandidateField API + config page
  - Acceptance: Admin can define/modify/delete candidate fields per org; exactly one field marked as unique identifier; UI shows table (name, label, type, required, unique, sort) with drag-to-reorder; preview import template button generates CSV with configured field headers
  - Files: `apps/api/src/routes/candidateField.ts`, `apps/web/src/pages/admin/CandidateFieldPage.tsx`
  - Verify: curl configure fields; browser drag-reorder; download template and verify CSV headers match configured fields

- [ ] **4.5** User management API + page (Admin/Teacher/Proctor)
  - Acceptance: Admin can create/list/modify/disable non-candidate users; UI shows table (username, name, role badge, status, action buttons) with add user dialog; role shown as colored badge
  - Files: `apps/api/src/routes/user.ts`, `apps/web/src/pages/admin/UserPage.tsx`
  - Verify: browser add Admin, Teacher, and Proctor users; edit name/role; disable/enable account

- [ ] **4.6** Candidate management API + page + import
  - Acceptance: API supports manual create, bulk import (CSV), list query, modify, disable; UI table headers dynamically generated from CandidateField config; import button opens ImportWizard; ImportWizard flow: upload → preview (duplicate identifier marked "update", missing required marked "error") → confirm import
  - Files: `apps/api/src/routes/candidate.ts`, `apps/web/src/pages/admin/CandidatePage.tsx`, `apps/web/src/components/shared/ImportWizard.tsx`, `apps/web/src/components/shared/FileUpload.tsx`, `packages/import-export/src/csv.ts`
  - Verify: CSV import batch of candidates; dynamic table headers reflect CandidateField config; duplicate identifier rows show "update" status (not error); missing required field rows show "error"

## Acceptance Criteria

1. Seed script is idempotent
2. Branding settings API has proper fallback when no settings exist
3. Organization settings changes propagate to login page, sidebar, and candidate header
4. Organization CRUD works with tenant isolation
5. CandidateField config generates correct CSV template headers
6. User management with role validation works
7. CSV import handles duplicates and missing fields correctly
8. All routes use repository pattern with RequestContext
9. All routes use Zod validation from `@exam/contracts`
10. All user-facing strings in zh-CN
11. No hardcoded deployment-specific product copy in production code
12. `pnpm typecheck` passes

## Verify Commands

```bash
pnpm typecheck
pnpm lint:copy
pnpm test
pnpm --filter api db:seed
pnpm --filter api dev
pnpm --filter web dev
pnpm verify
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
- [ ] Settings branding endpoints tested with fallback values
- [ ] Public branding endpoint returns only BrandingView fields through PublicBrandingContext
- [ ] No hardcoded deployment-specific product copy (e.g., 校内/校园/大学/学生)
- [ ] `pnpm verify` passes
- [ ] Queries filter by organizationId
- [ ] AuditLog written where required
