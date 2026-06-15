# Phase 1 Code Gap Audit

## 1. Scope

Audit report plus PR 1/PR 2 baseline-alignment notes. It compares current code against `docs/phase-roadmap.md` and `docs/SPEC.md` as the Phase 1 authorities, and records seed/demo/test fixture cleanup completed during `phase1-database-baseline-alignment` and the role/auth/RBAC convergence completed during `phase1-admin-candidate-role-boundary`.

Phase 1 target: single-tenant, multi-user Minimal Deliverable Exam System; one internal default organization; product roles Admin + Candidate only; no organizationSlug login; no tenant switcher; no SuperAdmin product path.

Scanned areas: auth/RBAC/session, runtime config, seed/bootstrap, candidate/question import-export, exam runtime, observability/audit/diagnostics, E2E, data fixtures, schema/migration/database baseline.

## 2. Phase 1 Acceptance Checklist

Status legend: `implemented` means the requirement is present in code, not that Phase 1 acceptance is fully verified; `aligned` means evidence matches the Phase 1 baseline; `partially-implemented` or `partially-aligned` means some parts exist but gaps remain; `conflicting` means current code contradicts the Phase 1 requirement; `missing` means no implementation was found; `unknown-needs-test` means the behavior cannot be confirmed without additional tests; other status labels mark narrow audit categories described by their row.

| Requirement | Status | Evidence / Gap |
| --- | --- | --- |
| Internal default organization | partially-implemented | `packages/db/src/seed.ts:41-99` creates slug `default`; `apps/api/src/config/runtimeConfig.ts:256-259` hardcodes default slug. Production creation policy is still unclear. |
| No organizationSlug login | aligned-by-PR2 | `LoginRequestSchema` no longer accepts `organizationSlug`; `auth.ts` always resolves `defaultTenantSlug`; web/E2E fixtures send username/password only. |
| No tenant switcher | aligned-by-PR3 | Web/UI no longer exposes a switcher and CI runs with `DEPLOYMENT_MODE=singleTenant`. Resolved by PR3: `runtimeConfig.ts` now rejects `DEPLOYMENT_MODE=multiTenant` at startup (Phase 1 single-tenant only) and `buildPublicConfig` no longer emits `tenantSwitcher`/`superAdminConsole`. See `## 3 → Runtime Config`. |
| No SuperAdmin product path | aligned-by-PR2 | `Role` enum and `RoleSchema` no longer include SuperAdmin/Teacher/Proctor; RBAC matrix is Admin + Candidate only; organization CRUD route + UI removed. Residue: legacy DB rows (see `## 3 → Known Residue`), rejected at login as `unsupported_phase1_role`. PR3 removed `exposeSuperAdmin` from the public config payload. |
| Admin + Candidate roles | aligned-by-PR2 | Domain `Role`, contracts `RoleSchema`, RBAC, all admin route `requireRole`, web UsersPage role selector, default test helper, and E2E seed are Admin+Candidate only. |
| Admin bootstrap | aligned-by-PR4 | `/auth/register` is disabled in Phase 1 (returns `AUTH_REGISTER_DISABLED`). First Admin created via local `bootstrap:admin` script (`apps/api/src/scripts/bootstrap-admin.ts`). Script uses default org, hashes password with argon2id, refuses if active Admin exists (unless `--force`), writes `admin.bootstrap` audit log. |
| Local admin reset-password script | aligned-by-PR4 | `reset:admin-password` script at `apps/api/src/scripts/reset-admin-password.ts`. Only resets Admin passwords; rejects Candidates. Writes `admin.password_reset.local` audit log without password/hash. |
| Candidate password reset | aligned-by-PR4 | `POST /users/:id/reset-password` endpoint in `apps/api/src/routes/user.ts`. Admin-only; only resets Candidate passwords; rejects Admin targets with `PASSWORD_RESET_TARGET_ROLE_NOT_ALLOWED`. Writes `candidate.password_reset` audit log. |
| Candidate create/import | aligned-by-PR2 | `requireRole(["Admin"])`; SuperAdmin/Teacher residue removed. |
| CandidateField config | aligned-by-PR2 | `requireRole(["Admin"])`. |
| Course create | aligned-by-PR2 | `requireRole(["Admin"])`. |
| Question CSV import | aligned-by-PR2 | `requireRole(["Admin"])`. |
| Exam create/publish | aligned-by-PR2 | `requireRole(["Admin"])`; archive endpoint remains for Phase 2 cleanup. |
| Candidate enrollment / assignment | partially-implemented | Enrollment exists; start flow can auto-create enrollment. |
| Candidate starts/saves/submits | implemented | Save and submit use row locks and protocol fields; needs blocking E2E evidence. |
| Result visible/export | aligned-by-PR5 | Score list + export are Admin-only; export header uses CandidateField.label with fallback to field.name. |
| Minimal AuditLog | partially-implemented | login.success/failure (with `unsupported_phase1_role`), publish, candidate import, submit, export, `admin.bootstrap`, `admin.password_reset.local`, `candidate.password_reset` exist; route-local error audit gaps remain (PR 6). |
| Structured logs/requestId | partially-implemented | Global ErrorResponse has requestId; route-local errors and logger schema are incomplete. |
| E2E artifacts/blocking CI | partially-implemented | Trace/screenshot/video configured; server.log/upload missing; CI disables E2E (PR 7 scope). |

## 3. Current Code Evidence (post-PR2)

### Auth / RBAC / Session

- `packages/domain/src/enums.ts:1-5`: `Role = { Admin, Candidate }` only.
- `packages/contracts/src/user.ts:6`: `RoleSchema = z.enum(["Admin", "Candidate"])`; `CreateUserRequestSchema.role = z.literal("Admin")`.
- `packages/contracts/src/auth.ts:25-29`: `LoginRequestSchema = { username, password }` (no `organizationSlug`).
- `packages/auth/src/rbac.ts`: `ROLE_PERMISSIONS` covers Admin and Candidate only.
- `packages/auth/src/tenantGuard.ts`: SuperAdmin platform-API branch removed; `validateTenantAccess` is now a public-endpoint passthrough.
- `apps/api/src/plugins/tenant.ts`: `x-target-org` SuperAdmin escalation removed; tenant guard hook only enforces public-endpoint passthrough.
- `apps/api/src/routes/auth.ts:83-241`: login resolves the default tenant slug only; rejects users whose role is not Admin or Candidate with a generic `AUTH_INVALID_CREDENTIALS` and an `unsupported_phase1_role` audit reason.
- `apps/api/src/plugins/heartbeat.ts:53`: system context role is `"Admin"`.
- `apps/api/src/routes/{auth,user,system,exam,course,question,scores,export,candidate,candidateField,settings,audit}.ts`: all admin `requireRole` are now `["Admin"]`; candidate-only `["Candidate"]`; shared score endpoint `["Candidate", "Admin"]`.
- `apps/api/src/routes/organization.ts` and `organization.test.ts`: deleted; `organizationRoutes` is no longer registered in `server.ts`/`openapi/swagger.ts`.

### Runtime Config

- `apps/api/src/config/runtimeConfig.ts`: Phase 1 runtime is single-tenant only. `parseDeploymentMode` rejects `DEPLOYMENT_MODE=multiTenant` at startup with a Phase 1 message (optional multiTenant is a Phase 4 platformization capability, not a current runnable mode); unknown values are also rejected. The `DeploymentMode` type is narrowed to `"singleTenant"`. `buildPublicConfig` no longer emits `tenantSwitcher` or `superAdminConsole` fields (omitted entirely, not emitted as `false`, to avoid implying the capability exists). `tenancy.exposeSuperAdmin` / `auth.exposeSuperAdmin` are locked to `false` constants. CORS origin comma-split already applies to all modes; rate-limit numeric parsing already rejects zero/negative/decimal/NaN (fallback strategy). Resolved by PR3.

### Seed / Bootstrap / Fixtures

- `packages/db/src/seed.ts`: Admin + Candidate users only.
- `packages/db/src/demo-seed.ts`: default org, Admin + Candidates only, no Phase-2 strict lockdown defaults.
- `apps/api/src/routes/testHelpers.ts`: default helper exposes Admin + Candidate; `createFutureRoleUserForTest(LegacyRole)` is the explicit, opt-in DB-residue fixture used only by tests that exercise rejection paths.

### Web UI

- `apps/web/src/contexts/AuthContext.tsx`: login posts `{ username, password }` only.
- `apps/web/src/pages/admin/UsersPage.tsx`: list filters to Admin/Candidate; create/edit form exposes only the Admin role; toggle is unconditional.
- `apps/web/src/pages/admin/OrganizationsPage.tsx` and `OrganizationsPage.test.tsx`: deleted.
- `apps/web/src/App.tsx`, `apps/web/src/components/layout/AppSidebar.tsx`, `apps/web/src/lib/{routes,pageMeta}.ts`: organization route + sidebar entry + page title removed.

### E2E

- `apps/e2e/lib/seed.ts`: login posts `{ username, password }`; seeds use Admin + Candidate.
- `apps/e2e/src/api-smoke.test.ts`: `Smoke — organization management` describe deleted; `createFutureRoleUserForTest` no longer imported.

### Tests Added / Updated

- `packages/contracts/src/__tests__/contracts.test.ts`: `Phase 1 role model` describe asserts `RoleSchema` accepts Admin/Candidate and rejects SuperAdmin/Teacher/Proctor; `LoginRequestSchema` does not model `organizationSlug`; `CreateUserRequestSchema` accepts Admin and rejects Teacher/SuperAdmin/Candidate.
- `packages/auth/src/rbac.test.ts`: asserts `Role` exports Admin+Candidate only and that legacy roles return empty permissions.
- `apps/api/src/routes/auth.test.ts`: `POST /api/auth/login rejects legacy future-role rows with generic auth failure` covers SuperAdmin and Teacher legacy DB rows.
- `apps/api/src/routes/audit.test.ts`: rebased onto the default organization + scoped reads; cross-org audit metadata test now reflects single-tenant `organizationId` storage.
- `apps/api/tests/security/tenant-isolation.test.ts`: SuperAdmin describe + cross-org assertion removed.
- `apps/api/tests/security/rbac-matrix.test.ts`: AC4 redefined as “organizations API removed in Phase 1”.
- `apps/web/src/pages/admin/UsersPage.test.tsx`: rewritten to assert Admin-only selector and Candidate filtering.
- `apps/web/src/components/layout/layout.test.tsx`: SuperAdmin/Teacher describe blocks removed.

### Known Residue

- DB `users.role` is `text` (not a Postgres enum), so legacy SuperAdmin/Teacher/Proctor rows can still be inserted directly. They are rejected by Phase 1 login (`unsupported_phase1_role`) and cannot be created through any Phase 1 contract or UI. This is recorded as `legacy-db-residue`.
- ~~`runtimeConfig.tenancy.exposeSuperAdmin` remains in the public config payload and is always `false` under singleTenant; multiTenant fail-fast is deferred to PR 5+/Phase 4.~~ Resolved by PR3: `DEPLOYMENT_MODE=multiTenant` now fails fast at startup, and `exposeSuperAdmin`/`tenantSwitcher`/`superAdminConsole` are no longer emitted by the public config payload.

## 4. Gap Table

| Area | Phase 1 Requirement | Current Evidence | Status | Gap | Suggested PR |
| --- | --- | --- | --- | --- | --- |
| Login contract | username/password only | auth contract, auth route, E2E seed, web client | aligned-by-PR2 | None. | — |
| Runtime mode | `multiTenant` fail-fast | `runtimeConfig.ts`, `docker-compose.yml`, `.env.example` | aligned-by-PR3 | multiTenant rejected at startup; Compose/env default to singleTenant. | — |
| SuperAdmin path | no SuperAdmin product path | seed, RBAC, routes, UsersPage | aligned-by-PR2 | DB residue only; no product surface. | — |
| Teacher/Proctor roles | future only | RBAC/routes/UsersPage | aligned-by-PR2 | DB residue only. | — |
| Admin bootstrap | default-org Admin bootstrap | `apps/api/src/scripts/bootstrap-admin.ts` | aligned-by-PR4 | `/auth/register` disabled; local bootstrap-admin script creates first Admin. | — |
| Admin recovery | local reset-password script | `apps/api/src/scripts/reset-admin-password.ts` | aligned-by-PR4 | Local script resets Admin password; Candidate reset via API. | — |
| Seed baseline | default org + Admin/Candidates | `packages/db/src/seed.ts` | aligned-by-PR1 | Default seed creates Admin + Candidates only. | — |
| Demo baseline | Phase 1 demo matches mock-data | `demo-seed.ts` | aligned-by-PR1 | Demo uses default org, Admin + Candidates, and avoids strict lockdown default exam. | — |
| Candidate import | Admin-only | `candidate.ts` | aligned-by-PR2 | None. | — |
| Question import | Admin-only | `question.ts` | aligned-by-PR2 | None. | — |
| Result export | Admin-only | `export.ts` | aligned-by-PR5 | Export header uses CandidateField.label with fallback to field.name. | — |
| Export columns | CandidateField contract stable | `export.ts`, docs | aligned-by-PR5 | label/name rule implemented and tested. | — |
| Assignment | assigned candidates only | start flow | partially-implemented | auto-enrollment can bypass assignment. | PR 5 |
| Save-answer | idempotent row-locked protocol | `attempts.ts`, `attemptRepo.ts` | implemented | Needs blocking E2E/integration evidence. | PR 5, PR 7 |
| Submit/grading | idempotent row-locked submit | `attempts.ts` | implemented | Needs blocking E2E/integration evidence. | PR 5, PR 7 |
| Phase boundary residue | no queue/archive workflow; restore backend only | attempts/exam routes | conflicting | Queue/archive product paths are exposed; restore should remain backend recovery support without Phase 2 UI/operation workflow. | PR 5 |
| Error responses | stable code + requestId | route-local attempt errors | partially-implemented | Some errors bypass shared shape. | PR 6 |
| Structured logs | pino fields + redaction | `server.ts` | partially-implemented | default logger only. | PR 6 |
| AuditLog | minimal action coverage | `audit.ts`, script writers | partially-implemented-by-PR4 | `admin.bootstrap`, `admin.password_reset.local`, `candidate.password_reset` added in PR4; route-local error audit gaps remain. | PR 6 |
| E2E CI | blocking happy/resume/flush | CI disabled | missing | E2E not blocking. | PR 7 |
| E2E fixture | Admin + Candidate only | E2E seed/smoke | aligned-by-PR2 | None. | — |
| Test isolation | `buildTestApp` reuses shared `exam_test` DB; some assertions couple on residue from sibling suites | `apps/api/src/routes/user.test.ts` list-pagination test | known | Pre-existing isolation coupling. See `docs/known-test-isolation-issues.md` (K-1). Reproduced on master before PR3/PR4. Not blocking; candidate for dedicated test-isolation PR or Phase 1 exit pass. | test-isolation cleanup |

## 5. Data Fixture Alignment Audit

| Area | File / Path | Expected Phase 1 Assumption | Current Evidence | Status | Gap | Suggested PR |
| --- | --- | --- | --- | --- | --- | --- |
| Mock default org | `docs/mock-data.md:21-37` | one internal default org | `org-default`, slug `default`. | aligned | None. | PR 0 |
| Seed org | `packages/db/src/seed.ts` | default org only | creates slug `default` with Admin + Candidates. | aligned-by-PR1 | None. | PR 1 |
| Demo org | `packages/db/src/demo-seed.ts` | default org fixture | creates slug `default`. | aligned-by-PR1 | None. | PR 1 |
| Multiple org fixtures | `tenant-isolation.test.ts`, candidate tests | not Phase 1 acceptance fixture | creates extra orgs. | future-only | keep as boundary tests, not acceptance data. | PR 1 |
| E2E orgSlug | `apps/e2e/lib/seed.ts` | no orgSlug login | E2E login sends username/password only. | aligned-by-PR1 | None (contract removed in PR 2). | PR 1 |
| API test orgSlug | `auth.test.ts`, `audit.test.ts`, `smoke.test.ts` | no orgSlug main path | login contract no longer accepts `organizationSlug`; register-only path still uses slug as Phase 3 concern. | aligned-by-PR2 | Register-path slug review tracked under Admin bootstrap. | PR 2 |
| SuperAdmin seed | `packages/db/src/seed.ts` | no SuperAdmin | default seed excludes SuperAdmin; Role enum/RBAC/routes/UI no longer expose SuperAdmin. | aligned-by-PR2 | Legacy DB rows possible; rejected at login as `unsupported_phase1_role`. | PR 1, PR 2 |
| Teacher seed | `packages/db/src/seed.ts` | no Teacher seeded, exposed, or required | default seed excludes Teacher; Role enum/RBAC/routes/UI no longer expose Teacher. | aligned-by-PR2 | Legacy DB rows possible; rejected at login as `unsupported_phase1_role`. | PR 1, PR 2 |
| Demo users | `packages/db/src/demo-seed.ts` | Admin + Candidates | demo users are Admin + Candidates only. | aligned-by-PR1 | None. | PR 1 |
| Test helper users | `apps/api/src/routes/testHelpers.ts` | Admin + Candidate helper | default helper creates Admin + Candidate only; future-role helper is explicit. | aligned-by-PR1 | Future role tests must opt in. | PR 1 |
| Candidate passwords | seed/demo/E2E | dev/test temp only | `candidate123`/weak defaults. | partially-aligned | production safety not enforced. | PR 1, PR 3 |
| mustChangePassword | schema/code | first-login policy if required | no field in users schema. | unknown-needs-test | account lifecycle not implemented. | PR 3 |
| CandidateField docs | docs mock/import | `candidateNo`, `department` | aligned docs. | aligned | none in docs. | PR 0 |
| CandidateField demo | `packages/db/src/demo-seed.ts` | align or mark future/demo | uses `candidateNo`, `department`. | aligned-by-PR1 | None. | PR 1 |
| Question CSV docs | `docs/import-export-format.md:149-179` | valid rows | valid after latest fix. | aligned | none found. | PR 0 |
| Question web template | `QuestionImportPage.tsx:177-183` | valid backend sample | uses option id `B`. | aligned-by-PR1 | None. | PR 1 |
| Mock JSON questions | `docs/mock-data.md:150-183` | clear executable fixture or illustrative sample | omits attachments/gradingRule required by DB. | partially-aligned | clarify or align with schema. | PR 1 |
| Phase 2 controls | `demo-seed.ts`, E2E seed | not Phase 1 default | default demo/E2E fixtures avoid queue/restrictIp/lockdown dependence. | aligned-by-PR1 | Product endpoints still need PR 5 cleanup. | PR 1, PR 5 |
| Result export fixture | `export.ts`, docs examples | Admin-only, CandidateField columns | export route is now Admin-only; header uses field.label with fallback to field.name. | aligned-by-PR5 | None. | — |
| Root fixture dirs | `seed/**`, `demo/**`, `fixtures/**`, `test-data/**` | scan if present | not found. | not-found | no action. | PR 0 |

## 6. Database Baseline Alignment Audit

| Area | File / Path | Current Evidence | Phase 1 Expected Baseline | Status | Required Action | Suggested PR |
| --- | --- | --- | --- | --- | --- | --- |
| Organizations schema | `packages/db/src/schema/pg.ts:31-42` | table with unique slug. | keep table as internal boundary. | aligned | no destructive deletion. | none |
| organizationId fields | `packages/db/src/schema/pg.ts` business tables | users/candidateFields/profiles/courses/questions/exams/enrollments/attempts/auditLogs have organizationId. | all business data scoped. | aligned | verify repo filters. | PR 5/6 |
| CandidateField schema | `packages/db/src/schema/pg.ts:62-81` | org+name unique. | belongs to default org. | aligned | no migration for baseline. | none |
| Candidate JSON uniqueness | `packages/db/src/schema/pg.ts:104-122` | JSONB fields; no DB unique on dynamic identity. | unique/required enforced in service/import. | legacy-compatible-no-action | test service-level enforcement. | PR 4 |
| Users schema | `packages/db/src/schema/pg.ts:83-102` | no mustChangePassword/sessionVersion. | local auth baseline plus future first-login policy. | schema-gap | forward migration likely if mustChangePassword is Phase 1 repair. | PR 3 |
| AuditLog schema | `packages/db/src/schema/pg.ts:266-277` | table exists. | minimal audit events. | aligned | add missing writers, not table. | PR 6 |
| Historical migration | `packages/db/migrations/postgres/0000_*.sql` | schema-only, no seed INSERTs. | do not edit historical migration. | do-not-edit-historical | use forward migration for schema changes. | PR 1/3 |
| Default org row | seed only | no migration baseline row; seed creates default. | default org created by bootstrap/startup/seed policy, not UI. | unknown-needs-test | define production owner for default org. | PR 1 |
| Seed data | `packages/db/src/seed.ts` | Admin + Candidate users only. | dev/test Admin + Candidates only. | aligned-by-PR1 | do not use as production bootstrap. | PR 1 |
| Demo data | `packages/db/src/demo-seed.ts` | default org, Admin + Candidates, no strict lockdown default. | Phase 1 default demo should match mock-data. | aligned-by-PR1 | keep future demos separate if added later. | PR 1 |
| E2E seed | `apps/e2e/lib/seed.ts` | username/password login, maxAttempts 1, minimal Phase 1 flags. | Admin + Candidate timed_window minimal. | aligned-by-PR1 | blocking CI still PR 7. | PR 1, PR 7 |
| Migration path | `packages/db/src/migrations/**` | not found. | actual migrations are under `packages/db/migrations/postgres`. | not-found | update references if needed. | PR 0 |
| Seed inside migration | postgres migration | no INSERT seed data. | migration should be schema-only. | aligned | no action. | none |

## 7. Canonical Phase 1 Test Data Contract

Phase 1 test/dev/E2E data should use:

- one internal default organization;
- one default Admin account for dev/test/E2E;
- multiple Candidate accounts;
- no SuperAdmin;
- no Teacher seeded, exposed, or required for Phase 1 acceptance;
- no organizationSlug login;
- one `timed_window` exam;
- explicitly assigned candidates;
- valid question snapshots;
- valid answer/grading samples;
- result export sample;
- import samples aligned with `docs/import-export-format.md`;
- E2E using Admin + Candidate only;
- no dependency on queue, restrictIp, lockdown, Teacher, SuperAdmin, multiTenant, pass-to-proceed, or service-token capabilities.

## 8. Canonical Phase 1 Database Baseline

- Exactly one internal default organization exists per deployment.
- The default organization is created by migration/bootstrap/app startup policy or dev/test seed, not by user-facing UI.
- Production does not rely on demo seed.
- Dev/test/E2E may seed one Admin and multiple Candidates.
- SuperAdmin is not seeded.
- Teacher is not seeded, exposed, or required for Phase 1 acceptance.
- CandidateField belongs to the default organization.
- Courses belong to the default organization.
- Questions belong to Courses and the default organization.
- Exams belong to the default organization.
- ExamEnrollments belong to the default organization.
- ExamAttempts belong to the default organization.
- Login does not require organizationSlug.
- Future multiTenant schema residue may remain if product paths are disabled.
- Do not drop `organizations` or `organizationId` as part of Phase 1 cleanup.

## 9. High-Risk Findings

| Finding | Evidence | Impact | Suggested PR | Blocks Phase 1 |
| --- | --- | --- | --- | --- |
| Phase 1 roles conflict with code | Pre-PR2: seed/RBAC/routes/UI exposed SuperAdmin/Teacher/Proctor. Post-PR1+PR2: domain Role enum, contracts, RBAC, routes, UsersPage, default test helpers, and E2E fixtures are Admin+Candidate only. | Resolved at the product surface; legacy DB rows remain `unsupported_phase1_role` at login. | PR 1, PR 2 | Resolved for product surface |
| Login contract still accepts organizationSlug | Pre-PR2: `LoginRequestSchema` accepted `organizationSlug`. Post-PR2: schema removed, `auth.ts` resolves only the default tenant slug, web/E2E send username/password only. | Resolved. | PR 2 | Resolved |
| Runtime can enter forbidden multiTenant mode | Pre-PR3: `runtimeConfig.ts` accepted `DEPLOYMENT_MODE=multiTenant`; `runtimeConfig.tenancy.exposeSuperAdmin` was emitted in the public config payload; Compose defaulted to multiTenant. Post-PR3: `DEPLOYMENT_MODE=multiTenant` fails fast at startup with a Phase 1 message; `exposeSuperAdmin`/`tenantSwitcher`/`superAdminConsole` are no longer emitted by the public config payload; Compose and `.env.example` default to singleTenant. | Resolved. Optional multiTenant remains a Phase 4 future capability. | PR3 | Resolved |
| Seed/mock/E2E data inconsistent | PR 1 aligned default seed/demo/E2E fixtures to Admin+Candidate default org. | Main fixture baseline represents Phase 1 acceptance. | PR 1 | Resolved for fixture baseline |
| Missing admin recovery path | No reset-password script found. | Production lockout recovery relies on weak/default seed or manual DB edits. | PR 3 | Yes |
| Import/export permission residue | Pre-PR2: candidate/question/export routes allowed SuperAdmin/Teacher. Post-PR2: all admin routes use `requireRole(["Admin"])`; export header now uses CandidateField.label. Post-PR5: field-name vs label contract resolved. | Permission residue resolved; export field contract resolved. | PR 2, PR 5 | Resolved |
| Phase 2 endpoints exposed in current runtime | queue and archive routes remain exposed; restore exists as backend recovery support. | Users/tests may depend on Phase 2 operation behavior before product scope. | PR 5 | Partially |
| RequestId/logging incomplete | Route-local errors omit requestId; logger has no standard fields/redaction. | Poor diagnosis and sensitive logging risk. | PR 6 | Yes for release hardening |
| E2E disabled in CI | `.github/workflows/ci.yml:83-86`. | Phase 1 acceptance signals are not blocking. | PR 7 | Yes |
| Save/submit/grading concurrency needs blocking proof | Implementation uses row locks, but CI E2E is disabled. | Regression risk in the most critical exam path. | PR 5, PR 7 | Yes |

## 10. Suggested PR Breakdown

### PR 0: phase1-code-gap-audit

Scope: this document only.

Verification:

```bash
pnpm format:check
pnpm lint:copy
```

The push hook also runs `turbo typecheck`; keep that as an additional submission check rather than a manual audit-doc command.

### PR 1: phase1-database-baseline-alignment

Scope: align seed/demo/test/E2E fixture data with one default organization and Admin + Candidate default data; remove/default-disable SuperAdmin/Teacher from Phase 1 default seed; clarify production default organization owner; optionally add forward migration only if required by final bootstrap/account design.

PR 1 status: default seed/demo/API test helpers/E2E seed have been aligned to Admin + Candidate default data. No schema gap was required for this baseline, so no migration was added.

Non-goals: no multiTenant, no Teacher scoped access, no destructive data wipe, no dropping organizations/organizationId.

### PR 2: phase1-singletenant-auth-rbac

Scope: username/password login only; remove organizationSlug from Phase 1 login/register path; fail fast for `DEPLOYMENT_MODE=multiTenant`; hide tenant switcher/SuperAdmin; constrain Phase 1 RBAC to Admin + Candidate.

### PR 3: phase1-admin-bootstrap-reset

Scope: first Admin bootstrap for the internal default organization; local Admin account reset-password script; Admin-managed Candidate password reset; reset audit/log evidence; no production reliance on weak seed.

### PR 4: phase1-import-export-permissions

Scope: Candidate import, Question import, and Result CSV export Admin-only; align CSV templates/samples with backend importer; resolve export field name vs label contract (completed in PR5); remove Teacher/SuperAdmin Phase 1 permission residue.

### PR 5: phase1-exam-core-flow

Scope: enforce explicit assignment; keep `timed_window` core flow; verify save-answer/submit/grade row lock and idempotency; hide/defer queue/archive product paths; keep restore as backend recovery support without Phase 2 UI/operation workflow.

### PR 6: phase1-audit-logs-requestid

Scope: standard requestId in route-local errors; structured pino log fields/redaction; complete minimal AuditLog coverage including reset-password execution; keep sensitive data out of logs.

### PR 7: phase1-e2e-reenable

Scope: blocking CI E2E for candidate happy path, resume attempt, and submit flush; Playwright Chromium install; server.log/screenshot/video/trace artifacts; E2E seed Admin + Candidate only; no organizationSlug/SuperAdmin/Teacher dependency.

## 11. Do-Not-Touch List

Phase 1 code repair should not:

- drop `organizations`;
- drop `organizationId`;
- remove role enum values unless explicitly approved;
- implement multiTenant;
- implement SuperAdmin product path;
- implement Teacher scoped access;
- implement permission registry;
- implement custom role UI;
- implement Proctor dashboard;
- implement email invitation;
- implement email password reset;
- implement pass-to-proceed API;
- implement service token / API key;
- implement webhook;
- implement queue admission;
- implement restrictIp;
- implement lockdown;
- rewrite all migrations;
- destroy production data;
- use seed as production bootstrap.

## 12. Verification Plan

Full Phase 1 repair verification should eventually include:

```bash
pnpm format:check
pnpm lint:copy
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @exam/db test
pnpm --filter @exam/api test
pnpm test:integration
pnpm test:e2e
pnpm verify
```

This audit PR should run only:

```bash
pnpm format:check
pnpm lint:copy
```
