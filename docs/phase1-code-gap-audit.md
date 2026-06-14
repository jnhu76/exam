# Phase 1 Code Gap Audit

## 1. Scope

Audit-first report only. This round does not change implementation code. It compares current code against `docs/phase-roadmap.md` and `docs/SPEC.md` as the Phase 1 authorities.

Phase 1 target: single-tenant, multi-user Minimal Deliverable Exam System; one internal default organization; product roles Admin + Candidate only; no organizationSlug login; no tenant switcher; no SuperAdmin product path.

Scanned areas: auth/RBAC/session, runtime config, seed/bootstrap, candidate/question import-export, exam runtime, observability/audit/diagnostics, E2E, data fixtures, schema/migration/database baseline.

## 2. Phase 1 Acceptance Checklist

Status legend: `implemented` means the requirement is present in code, not that Phase 1 acceptance is fully verified; `aligned` means evidence matches the Phase 1 baseline; `partially-implemented` or `partially-aligned` means some parts exist but gaps remain; `conflicting` means current code contradicts the Phase 1 requirement; `missing` means no implementation was found; `unknown-needs-test` means the behavior cannot be confirmed without additional tests; other status labels mark narrow audit categories described by their row.

| Requirement | Status | Evidence / Gap |
| --- | --- | --- |
| Internal default organization | partially-implemented | `packages/db/src/seed.ts:41-99` creates slug `default`; `apps/api/src/config/runtimeConfig.ts:256-259` hardcodes default slug. Production creation policy is still unclear. |
| No organizationSlug login | conflicting | `packages/contracts/src/auth.ts:25-28`, `apps/api/src/routes/auth.ts:87-99`, and `apps/e2e/lib/seed.ts:18-23` still support/send `organizationSlug`. |
| No tenant switcher | partially-implemented | CI sets singleTenant; runtime still exposes switcher when multiTenant is accepted in `runtimeConfig.ts:222-264`. |
| No SuperAdmin product path | conflicting | `apps/api/src/routes/auth.ts:162-194` blocks SuperAdmin login in singleTenant, but seed/RBAC/routes/UI still expose it. |
| Admin + Candidate roles | partially-implemented | Candidate attempt routes are Candidate-only; admin APIs still allow Teacher/SuperAdmin. |
| Admin bootstrap | partially-implemented | `/auth/register` exists in `apps/api/src/routes/auth.ts:28-81`, but requires `organizationSlug` and uses SuperAdmin ctx. |
| Local admin reset-password script | missing | No reset script found; required by roadmap and operation manual. |
| Candidate create/import | partially-implemented | Exists and writes audit; permissions still include SuperAdmin. |
| CandidateField config | partially-implemented | CRUD/template via ctx exists; permissions still include SuperAdmin. |
| Course create | partially-implemented | Exists; permissions include Teacher/SuperAdmin. |
| Question CSV import | partially-implemented | Exists; web template has invalid single-choice sample. |
| Exam create/publish | partially-implemented | Exists and writes `exam.publish`; Teacher/SuperAdmin permissions and archive endpoint remain. |
| Candidate enrollment / assignment | partially-implemented | Enrollment exists; start flow can auto-create enrollment. |
| Candidate starts/saves/submits | implemented | Save and submit use row locks and protocol fields; needs blocking E2E evidence. |
| Result visible/export | partially-implemented | Result/export exists; Teacher/SuperAdmin permission residue and export column mismatch remain. |
| Minimal AuditLog | partially-implemented | login failure, publish, candidate import, submit, export exist; reset-password audit missing. |
| Structured logs/requestId | partially-implemented | Global ErrorResponse has requestId; route-local errors and logger schema are incomplete. |
| E2E artifacts/blocking CI | partially-implemented | Trace/screenshot/video configured; server.log/upload missing; CI disables E2E. |

## 3. Current Code Evidence

### Auth / RBAC / Session

- `packages/contracts/src/auth.ts:7-13`: register requires `organizationSlug`.
- `packages/contracts/src/auth.ts:25-28`: login accepts optional `organizationSlug`.
- `apps/api/src/routes/auth.ts:87-99`: login resolves organization from request slug or default slug.
- `apps/api/src/routes/auth.ts:162-194`: SuperAdmin is blocked only at login time in singleTenant.
- `packages/domain/src/enums.ts`, `packages/contracts/src/user.ts`, and `packages/auth/src/rbac.ts`: SuperAdmin/Teacher/Proctor remain modeled and permissioned.
- `apps/web/src/pages/admin/UsersPage.tsx:43-58,271-273`: SuperAdmin/Teacher/Proctor are visible/createable in UI.

### Runtime Config

- `apps/api/src/config/runtimeConfig.ts:129-135`: accepts `DEPLOYMENT_MODE=multiTenant`.
- `apps/api/src/config/runtimeConfig.ts:222-264`: multiTenant enables tenant switcher/SuperAdmin flags.
- `docker-compose.yml:15`: defaults to `DEPLOYMENT_MODE=${DEPLOYMENT_MODE:-multiTenant}`.
- `.github/workflows/ci.yml:37-43`: CI uses `DEPLOYMENT_MODE: singleTenant`.
- `apps/api/src/config/runtimeConfig.ts:266-270`: parses `RATE_LIMIT_DISABLED`; E2E still retries 429, so enforcement needs test.

### Seed / Bootstrap / Fixtures

- `packages/db/src/seed.ts:22-39`: seeds SuperAdmin/Admin/Teacher/Candidate with weak defaults.
- `packages/db/src/seed.ts:81-99`: creates default organization slug `default`.
- `packages/db/src/demo-seed.ts:23,102-121`: creates demo organization slug `demo`.
- `packages/db/src/demo-seed.ts:61-74`: includes Phase 2-like `requireLockdown: true` strict controls.
- No local admin reset-password script found under `apps/api/src/scripts/**`, `scripts/**`, or `**/*reset*`.

### Candidate / Import / Export

- `apps/api/src/routes/candidateField.ts:161-173`: template uses CandidateField via ctx.
- `apps/api/src/routes/candidate.ts:329-425`: candidate import uses configured fields and writes audit.
- `apps/api/src/routes/export.ts:15-18`: score export allows Admin/SuperAdmin/Teacher.
- `apps/api/src/routes/export.ts:35-48`: export headers use CandidateField `name`, while docs examples use labels such as `编号`.
- `apps/web/src/pages/admin/QuestionImportPage.tsx:177-183`: template uses `single_choice,...,2,...`; backend expects an option ID such as `B`.
- `packages/import-export/src/csv.ts`: only CSV generation is shared; question CSV parsing is duplicated in web.

### Exam Runtime

- `apps/api/src/routes/attempts.ts:619-702`: save-answer uses transaction, `findByIdForUpdate`, `clientSeq`, `baseVersion`.
- `apps/api/src/routes/attempts.ts:751-850`: submit is idempotent, row-locked, and finalizes grading.
- `apps/api/src/routes/attempts.ts:472`: queue endpoint is exposed.
- `apps/api/src/routes/attempts.ts:886`: restore backend route exists as server-side recovery support; full disrupted recovery UI and operational adjudication are Phase 2.
- `apps/api/src/routes/exam.ts:443-457`: archive endpoint is exposed; richer lifecycle is Phase 2.

### Observability / Audit / E2E

- `apps/api/src/lib/errorResponse.ts:44-55` and `apps/api/src/plugins/errors.ts:40-65`: global requestId response path exists.
- `apps/api/src/routes/attempts.ts:611-616,869-874`: route-local errors omit requestId.
- `apps/api/src/server.ts:36`: default Fastify logger only; no custom logger/redaction schema found.
- `packages/db/src/schema/pg.ts:266-277`: AuditLog table exists.
- `apps/e2e/e2e/candidate-happy-path.spec.ts`, `resume-attempt.spec.ts`, `submit-flush.spec.ts`: target E2E tests exist.
- `.github/workflows/ci.yml:83-86`: E2E disabled.
- `apps/e2e/lib/seed.ts:18-23`: E2E sends organizationSlug.
- `apps/e2e/src/api-smoke.test.ts`: still uses SuperAdmin and Teacher paths.

## 4. Gap Table

| Area | Phase 1 Requirement | Current Evidence | Status | Gap | Suggested PR |
| --- | --- | --- | --- | --- | --- |
| Login contract | username/password only | auth contract, auth route, E2E seed | conflicting | organizationSlug remains in API/tests/E2E. | PR 2 |
| Runtime mode | `multiTenant` fail-fast | `runtimeConfig.ts`, `docker-compose.yml` | conflicting | multiTenant accepted and Compose defaults to it. | PR 2 |
| SuperAdmin path | no SuperAdmin product path | seed, RBAC, routes, UsersPage | conflicting | Login guard is insufficient; seed/UI/API still expose it. | PR 1, PR 2 |
| Teacher/Proctor roles | future only | RBAC/routes/UsersPage | conflicting | Teacher/Proctor are createable/authorized. | PR 2, PR 4 |
| Admin bootstrap | default-org Admin bootstrap | `apps/api/src/routes/auth.ts:28-81` | partially-implemented | Uses org slug and SuperAdmin ctx. | PR 3 |
| Admin recovery | local reset-password script | not found | missing | No recovery path independent of seed. | PR 3 |
| Seed baseline | default org + Admin/Candidates | `packages/db/src/seed.ts` | conflicting | SuperAdmin/Teacher + weak defaults. | PR 1 |
| Demo baseline | Phase 1 demo matches mock-data | `demo-seed.ts` | conflicting | demo org, Teachers, strict lockdown. | PR 1 |
| Candidate import | Admin-only | `candidate.ts` | partially-implemented | SuperAdmin allowed. | PR 4 |
| Question import | Admin-only | `question.ts` | conflicting | Teacher/SuperAdmin allowed. | PR 4 |
| Result export | Admin-only | `export.ts` | conflicting | Teacher/SuperAdmin can export. | PR 4 |
| CSV samples | match importer | `QuestionImportPage.tsx` | conflicting | invalid single-choice standardAnswer sample. | PR 4 |
| Export columns | CandidateField contract stable | `export.ts`, docs | partially-implemented | name vs label mismatch. | PR 4 |
| Assignment | assigned candidates only | start flow | partially-implemented | auto-enrollment can bypass assignment. | PR 5 |
| Save-answer | idempotent row-locked protocol | `attempts.ts`, `attemptRepo.ts` | implemented | Needs blocking E2E/integration evidence. | PR 5, PR 7 |
| Submit/grading | idempotent row-locked submit | `attempts.ts` | implemented | Needs blocking E2E/integration evidence. | PR 5, PR 7 |
| Phase boundary residue | no queue/archive workflow; restore backend only | attempts/exam routes | conflicting | Queue/archive product paths are exposed; restore should remain backend recovery support without Phase 2 UI/operation workflow. | PR 5 |
| Error responses | stable code + requestId | route-local attempt errors | partially-implemented | Some errors bypass shared shape. | PR 6 |
| Structured logs | pino fields + redaction | `server.ts` | partially-implemented | default logger only. | PR 6 |
| AuditLog | minimal action coverage | no reset script audit | partially-implemented | reset action missing; export action naming drift. | PR 3, PR 6 |
| E2E CI | blocking happy/resume/flush | CI disabled | missing | E2E not blocking. | PR 7 |
| E2E fixture | Admin + Candidate only | E2E seed/smoke | conflicting | orgSlug/SuperAdmin/Teacher residue. | PR 1, PR 7 |

## 5. Data Fixture Alignment Audit

| Area | File / Path | Expected Phase 1 Assumption | Current Evidence | Status | Gap | Suggested PR |
| --- | --- | --- | --- | --- | --- | --- |
| Mock default org | `docs/mock-data.md:21-37` | one internal default org | `org-default`, slug `default`. | aligned | None. | PR 0 |
| Seed org | `packages/db/src/seed.ts:41-99` | default org only | creates slug `default`. | partially-aligned | same seed creates future roles. | PR 1 |
| Demo org | `packages/db/src/demo-seed.ts:23,102-121` | default org fixture | creates slug `demo`. | conflicting | demo diverges from mock-data. | PR 1 |
| Multiple org fixtures | `tenant-isolation.test.ts`, candidate tests | not Phase 1 acceptance fixture | creates extra orgs. | future-only | keep as boundary tests, not acceptance data. | PR 1 |
| E2E orgSlug | `apps/e2e/lib/seed.ts:3-23` | no orgSlug login | sends organizationSlug. | conflicting | E2E contract conflicts. | PR 7 |
| API test orgSlug | `auth.test.ts`, `audit.test.ts`, `smoke.test.ts` | no orgSlug main path | tests send slug. | conflicting | old login contract in tests. | PR 2 |
| SuperAdmin seed | `packages/db/src/seed.ts:22-73` | no SuperAdmin | includes superadmin. | conflicting | remove/default-disable. | PR 1 |
| Teacher seed | `packages/db/src/seed.ts:29-65` | no Teacher seeded, exposed, or required | includes teacher. | conflicting | remove or future-only fixture. | PR 1 |
| Demo users | `packages/db/src/demo-seed.ts:199-233` | Admin + Candidates | SuperAdmin and Teachers. | conflicting | mixed Phase 3/4 demo. | PR 1 |
| Test helper users | `apps/api/src/routes/testHelpers.ts:36-95` | Admin + Candidate helper | includes teacher/superAdmin tokens. | conflicting | future roles baked into helper. | PR 1 |
| Candidate passwords | seed/demo/E2E | dev/test temp only | `candidate123`/weak defaults. | partially-aligned | production safety not enforced. | PR 1, PR 3 |
| mustChangePassword | schema/code | first-login policy if required | no field in users schema. | unknown-needs-test | account lifecycle not implemented. | PR 3 |
| CandidateField docs | docs mock/import | `candidateNo`, `department` | aligned docs. | aligned | none in docs. | PR 0 |
| CandidateField demo | `packages/db/src/demo-seed.ts:147-173` | align or mark future/demo | uses `employeeId`, `phone`. | partially-aligned | acceptable only if not Phase 1 default. | PR 1 |
| Question CSV docs | `docs/import-export-format.md:149-179` | valid rows | valid after latest fix. | aligned | none found. | PR 0 |
| Question web template | `QuestionImportPage.tsx:177-183` | valid backend sample | uses answer `2`. | conflicting | should use option id `B`. | PR 4 |
| Mock JSON questions | `docs/mock-data.md:150-183` | clear executable fixture or illustrative sample | omits attachments/gradingRule required by DB. | partially-aligned | clarify or align with schema. | PR 1 |
| Phase 2 controls | `demo-seed.ts`, E2E seed | not Phase 1 default | lockdown/queue fields present. | conflicting | move out of default acceptance fixture. | PR 1, PR 5 |
| Result export fixture | `export.ts`, docs examples | Admin-only, CandidateField columns | permissions allow Teacher/SuperAdmin; columns use names. | conflicting | permission and column contract mismatch. | PR 4 |
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
| Seed data | `packages/db/src/seed.ts` | creates future role users. | dev/test Admin + Candidates only. | seed-conflict | align seed; do not use as production bootstrap. | PR 1 |
| Demo data | `packages/db/src/demo-seed.ts` | demo org, Teachers, strict lockdown. | Phase 1 default demo should match mock-data. | fixture-conflict | split future demo data or mark as future-only. | PR 1 |
| E2E seed | `apps/e2e/lib/seed.ts` | orgSlug, maxAttempts 3, queue fields. | Admin + Candidate timed_window minimal. | e2e-data-conflict | align with Phase 1 contract. | PR 7 |
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
| Phase 1 roles conflict with code | Seed/RBAC/routes/UI expose SuperAdmin/Teacher/Proctor. | Users and tests can exercise non-Phase 1 paths, hiding Admin/Candidate gaps. | PR 1, PR 2, PR 4 | Yes |
| Login contract conflicts with docs and E2E | `LoginRequestSchema` accepts `organizationSlug`; E2E sends it. | Cannot prove no organizationSlug login or re-enable E2E safely. | PR 2, PR 7 | Yes |
| Runtime can enter forbidden multiTenant mode | `runtimeConfig.ts` accepts multiTenant; Compose defaults to it. | Production compose can boot in Phase 4-only mode. | PR 2 | Yes |
| Seed/mock/E2E data inconsistent | docs use Admin+Candidate default org; seed/demo/E2E use SuperAdmin/Teacher/demo org. | Test data does not represent Phase 1 acceptance. | PR 1 | Yes |
| Missing admin recovery path | No reset-password script found. | Production lockout recovery relies on weak/default seed or manual DB edits. | PR 3 | Yes |
| Import/export permission residue | Candidate/question/export routes allow SuperAdmin/Teacher. | Future roles can mutate/export Phase 1 data. | PR 4 | Yes |
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

Non-goals: no multiTenant, no Teacher scoped access, no destructive data wipe, no dropping organizations/organizationId.

### PR 2: phase1-singletenant-auth-rbac

Scope: username/password login only; remove organizationSlug from Phase 1 login/register path; fail fast for `DEPLOYMENT_MODE=multiTenant`; hide tenant switcher/SuperAdmin; constrain Phase 1 RBAC to Admin + Candidate.

### PR 3: phase1-admin-bootstrap-reset

Scope: first Admin bootstrap for the internal default organization; local Admin account reset-password script; Admin-managed Candidate password reset; reset audit/log evidence; no production reliance on weak seed.

### PR 4: phase1-import-export-permissions

Scope: Candidate import, Question import, and Result CSV export Admin-only; align CSV templates/samples with backend importer; resolve export field name vs label contract; remove Teacher/SuperAdmin Phase 1 permission residue.

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
