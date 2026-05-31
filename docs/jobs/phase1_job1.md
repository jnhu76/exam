# Job 1: Database Schema + Repository Layer

## Goal

Drizzle ORM setup with PostgreSQL/SQLite dual support, all Phase 1 tables, migrations tooling, and the repository pattern with RequestContext enforcement.

## Scope

- Drizzle ORM connection setup
- All Phase 1 schema tables
- Repository layer with RequestContext guard
- Migration scripts
- Tenant isolation enforcement

## Out of Scope

- Seed data (J4.1)
- API routes (J3+)
- Business logic

## Dependencies

J0 (Infrastructure), J0.5 (Domain types — schema must mirror domain types)

## Files to Create / Modify

- `packages/db/src/index.ts`
- `packages/db/src/schema.ts`
- `packages/db/src/repository/userRepo.ts`
- `packages/db/src/repository/organizationRepo.ts`
- `packages/db/src/repository/candidateRepo.ts`
- `packages/db/src/repository/candidateFieldRepo.ts`
- `packages/db/src/repository/courseRepo.ts`
- `packages/db/src/repository/questionRepo.ts`
- `packages/db/src/repository/examRepo.ts`
- `packages/db/src/repository/enrollmentRepo.ts`
- `packages/db/src/repository/attemptRepo.ts`
- `packages/db/src/repository/auditLogRepo.ts`
- `packages/db/src/repository/baseRepo.ts` (common query helpers with ctx)
- `packages/db/drizzle.config.ts`

## Data Model Changes

Creates all Phase 1 tables:

- `organizations` — id, name, slug, settings (JSON), createdAt, updatedAt
- `candidate_fields` — id, organizationId, name, label, fieldType, required, unique, sortOrder, createdAt
- `users` — id, organizationId, username, passwordHash, name, role, isActive, createdAt, updatedAt
- `candidate_profiles` — id, organizationId, userId, fields (JSON), createdAt, updatedAt
- `courses` — id, organizationId, name, code, description, createdAt, updatedAt
- `questions` — id, organizationId, courseId, type, content, options (JSON), standardAnswer, attachments (JSON), score, difficulty, tags (JSON), createdAt, updatedAt
- `exams` — id, organizationId, name, description, status, timingMode, durationMinutes, openAt, closeAt, passingScore, questionSelectionMode, questionSnapshot (JSON), controlFlags (JSON), retakePolicy, scoreStrategy, maxAttempts, createdAt, updatedAt
- `exam_enrollments` — id, organizationId, examId, candidateId, attemptCount, finalScore, finalPassed, finalAttemptId, createdAt, updatedAt
- `exam_attempts` — id, organizationId, examId, enrollmentId, candidateId, attemptNo, status, questionSnapshot (JSON), answers (JSON), totalScore, passed, startedAt, deadlineAt, submittedAt, gradedAt, lastActivityAt, createdAt, updatedAt
- `audit_logs` — id, organizationId, actorId, action, targetType, targetId, metadata (JSON), ipAddress, userAgent, createdAt

## API Contracts

None (database layer only).

## UI Tasks

None.

## TDD Plan

- Unit tests for each repository method verifying CRUD operations
- Integration test for tenant isolation: two orgs, confirm cross-tenant data invisible
- Test that bare `db.select()` usage would fail (repository is sole access point)

## Subtasks

- [ ] **1.1** Drizzle ORM setup + PostgreSQL/SQLite connection
  - Acceptance: `import { db }` works, can connect to SQLite file for dev, PostgreSQL via DATABASE_URL
  - Files: `packages/db/src/index.ts`, `packages/db/package.json`, `packages/db/tsconfig.json`
  - Verify: `pnpm --filter api dev` starts without db import errors

- [ ] **1.2** Schema: organizations + candidate_fields + users + candidate_profiles
  - Acceptance: All tables have `id` (UUID primary key), `organizationId`, `createdAt`. `candidate_profiles.fields` uses JSON column. `users` has `role` enum (SuperAdmin, Admin, Teacher, Candidate). `candidate_fields` defines per-org identity fields (name, label, fieldType, required, sortOrder). Enums mirror `packages/domain/src/enums.ts`.
  - Files: `packages/db/src/schema.ts`
  - Verify: `pnpm --filter db db:push` creates all 4 tables

- [ ] **1.3** Schema: courses + questions
  - Acceptance: `questions` has `organizationId` FK, `options` JSON column, `attachments` JSON column. `courses` has `organizationId` FK. Phase 1 question types only: `single_choice`, `multiple_choice`, `fill_blank`, `true_false`. `standardAnswer` column required for auto-grading.
  - Files: `packages/db/src/schema.ts`
  - Verify: `pnpm --filter db db:push` creates both tables

- [ ] **1.4** Schema: exams + exam_enrollments + exam_attempts
  - Acceptance: `exam_attempts` has `questionSnapshot` (JSON — copied at attempt creation), `answers` (JSON), `lastActivityAt` (heartbeat field), `attemptNo`. `exam_enrollments` has `attemptCount`, `finalScore`, `finalPassed`, `finalAttemptId`. Exams have `timingMode` (Phase 1: `timed_window` only), `status` enum (draft/published/open/closed/archived per SPEC.md §3.3), `questionSelectionMode` (Phase 1: `manual` only), `controlFlags` JSON column. Phase 1 retake policies: `unlimited`, `max_attempts`, `pass_then_stop` only (daily_limit/weekly_limit deferred to Phase 2).
  - Files: `packages/db/src/schema.ts`
  - Verify: `pnpm --filter db db:push` creates all 3 tables

- [ ] **1.5** Schema: audit_logs + drizzle config + scripts
  - Acceptance: `audit_logs` has `organizationId`, `actorId`, `action`, `targetType`, `targetId`, `metadata` (JSON), `ipAddress`, `userAgent`, `createdAt`. Drizzle config supports both PostgreSQL and SQLite. Scripts `db:push` and `db:studio` work.
  - Files: `packages/db/src/schema.ts`, `packages/db/drizzle.config.ts`
  - Verify: full `pnpm --filter db db:push` creates all tables; `pnpm --filter db db:studio` opens Drizzle Studio

- [ ] **1.6** Repository base + RequestContext enforcement
  - Acceptance: `baseRepo` provides common query helpers that inject organizationId from RequestContext. Every repo method takes `ctx: RequestContext` as first argument. RequestContext includes: `{ userId, organizationId, role, targetOrganizationId? }`. Route layer cannot access `db` directly — only through repo methods.
  - Files: `packages/db/src/repository/baseRepo.ts`
  - Verify: `pnpm typecheck` passes; repo method signatures all start with `(ctx, ...)`

- [ ] **1.7** Repository: all entity repos
  - Acceptance: All repos implement basic CRUD with ctx: `organizationRepo`, `userRepo`, `candidateRepo`, `candidateFieldRepo`, `courseRepo`, `questionRepo`, `examRepo`, `enrollmentRepo`, `attemptRepo`, `auditLogRepo`. All queries filter by organizationId (except SuperAdmin with explicit targetOrganizationId). No bare `db.select()` outside of repository files.
  - Files: `packages/db/src/repository/*.ts`
  - Verify: `pnpm typecheck` passes; write a test that calls `questionRepo.findById(ctx, id)` and confirms organizationId filtering works; write a test that attempts cross-tenant access and confirms it returns null/empty

## Acceptance Criteria

1. `pnpm --filter db db:push` creates all 10 tables
2. Every repository method takes `ctx: RequestContext` as first argument
3. Every business table query filters by `organizationId`
4. SuperAdmin cross-tenant operations require explicit `targetOrganizationId`
5. No bare `db.select()` in route handlers (enforced by code review)
6. Schema types mirror domain types from `packages/domain`
7. Repository layer tests verify tenant isolation
8. `pnpm typecheck` passes

## Verify Commands

```bash
pnpm install
pnpm typecheck
pnpm --filter db db:push
pnpm --filter db db:studio
pnpm test
```

## Review Checklist

- [ ] All 10 tables created with correct columns
- [ ] All enums mirror `packages/domain/src/enums.ts`
- [ ] Exam status has 5 states: draft/published/open/closed/archived
- [ ] AttemptStatus has: in_progress/submitted/graded/disrupted
- [ ] Every repo method signature starts with `(ctx, ...)`
- [ ] No `db.select()` outside repository files
- [ ] organizationId is NOT nullable on business tables
- [ ] JSON columns use typed interfaces from domain
- [ ] Migration scripts work for both PostgreSQL and SQLite
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
