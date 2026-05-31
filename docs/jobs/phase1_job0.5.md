# Job 0.5: Domain + Contracts Skeleton

## Goal

Establish the shared type foundation for the entire system. All domain types, API contracts (Zod schemas), and cross-package interfaces are defined here so that J1 (DB), J2 (Client), and J5+ (API routes) never define their own divergent types.

## Scope

- `packages/domain` — core domain types, enums, constants
- `packages/contracts` — Zod schemas for all API request/response DTOs
- `packages/exam-engine` — exam state machine command signatures (types only, no logic)
- `packages/import-export` — package skeleton (empty index.ts)
- Cross-package type exports via index.ts barrel files

## Out of Scope

- Database schema (J1)
- API route implementations (J3+)
- Business logic implementations
- Frontend code
- Test files (types only — tests come with logic jobs)

## Dependencies

J0 (Infrastructure Setup — package.json files must exist)

## Files to Create / Modify

- `packages/domain/src/types.ts`
- `packages/domain/src/enums.ts`
- `packages/domain/src/index.ts`
- `packages/contracts/src/auth.ts`
- `packages/contracts/src/organization.ts`
- `packages/contracts/src/user.ts`
- `packages/contracts/src/candidate.ts`
- `packages/contracts/src/course.ts`
- `packages/contracts/src/question.ts`
- `packages/contracts/src/exam.ts`
- `packages/contracts/src/attempt.ts`
- `packages/contracts/src/score.ts`
- `packages/contracts/src/common.ts` (pagination, sorting, error response)
- `packages/contracts/src/index.ts`
- `packages/exam-engine/src/types.ts`
- `packages/exam-engine/src/index.ts`
- `packages/import-export/src/index.ts`

## Data Model Changes

None (types only, no database).

## API Contracts

This job IS the API contracts. Defines Zod schemas for:

- Auth: register, login, logout, me
- Organization: CRUD
- User: CRUD
- Candidate: CRUD, import
- Course: CRUD
- Question: CRUD, import
- Exam: CRUD, publish, archive
- Attempt: start, load, saveAnswer, submit, heartbeat, restore
- Score: list, detail, export

## UI Tasks

None.

## TDD Plan

- No unit tests for pure type definitions
- Validation: `pnpm typecheck` must pass across all packages
- Verify Zod schemas parse/infer types correctly (can be simple smoke tests)

## Subtasks

- [ ] **0.5.1** Domain enums and constants
  - Acceptance: `Role`, `Permission`, `QuestionType`, `AttemptStatus`, `EnrollmentStatus`, `ExamStatus`, `TimingMode`, `QuestionSelectionMode`, `ScoreStrategy`, `RetakePolicy`, `MultiSelectScoring`, `FillBlankMatchMode`, `ControlFlag` all defined as const enums or string literal unions
  - Files: `packages/domain/src/enums.ts`
  - Verify: `pnpm typecheck` passes; enums are importable from `@exam/domain`

- [ ] **0.5.2** Core domain types
  - Acceptance: Define all types listed below. Every type uses enums from 0.5.1. No `any`. No Fastify dependency. Types must match SPEC.md §3 data models.
  - Types: `Organization`, `User`, `Candidate`, `CandidateField`, `Course`, `Question`, `QuestionSnapshot`, `Exam`, `ExamEnrollment`, `ExamAttempt`, `AnswerRecord`, `SaveAnswerRequest`, `SaveAnswerResponse`, `ScoreResult`, `QuestionScoreResult`, `AuditLog`, `RequestContext`, `GradingRule`, `ControlFlags`
  - Files: `packages/domain/src/types.ts`
  - Verify: `pnpm typecheck` passes; types are importable from `@exam/domain`

- [ ] **0.5.3** Common contract schemas
  - Acceptance: Zod schemas for `PaginationParams`, `PaginatedResponse<T>`, `SortParams`, `ErrorResponse`, `ValidationErrorDetail` — reusable across all API contracts
  - Files: `packages/contracts/src/common.ts`
  - Verify: `pnpm typecheck` passes

- [ ] **0.5.4** Auth contract schemas
  - Acceptance: Zod schemas for register/login/logout/me request and response bodies; inferred TypeScript types exported alongside schemas
  - Files: `packages/contracts/src/auth.ts`
  - Verify: `pnpm typecheck` passes; schemas importable from `@exam/contracts`

- [ ] **0.5.5** Organization + User + Candidate contract schemas
  - Acceptance: Zod schemas for CRUD request/response for organization, user, candidate, candidateField; candidate import request schema
  - Files: `packages/contracts/src/organization.ts`, `packages/contracts/src/user.ts`, `packages/contracts/src/candidate.ts`
  - Verify: `pnpm typecheck` passes

- [ ] **0.5.6** Course + Question contract schemas
  - Acceptance: Zod schemas for CRUD request/response for course and question; question import request schema; question type-specific validation
  - Files: `packages/contracts/src/course.ts`, `packages/contracts/src/question.ts`
  - Verify: `pnpm typecheck` passes

- [ ] **0.5.7** Exam + Attempt contract schemas
  - Acceptance: Zod schemas for exam CRUD/publish/archive; attempt start/load/saveAnswer/submit/heartbeat/restore; SaveAnswerRequest/SaveAnswerResponse schemas match SPEC.md §3.5 Answer Save Protocol
  - Files: `packages/contracts/src/exam.ts`, `packages/contracts/src/attempt.ts`
  - Verify: `pnpm typecheck` passes; SaveAnswerRequest has clientSeq, baseVersion; SaveAnswerResponse has accepted, serverVersion, conflict

- [ ] **0.5.8** Score contract schemas
  - Acceptance: Zod schemas for score list query, score detail, export request
  - Files: `packages/contracts/src/score.ts`
  - Verify: `pnpm typecheck` passes

- [ ] **0.5.9** Exam engine type signatures
  - Acceptance: Type-only signatures for command functions: `startAttempt()`, `submitAttempt()`, `gradeAttempt()`, `restoreAttempt()`, `markDisrupted()`, `publishExam()`, `archiveExam()` — parameter types and return types defined, no implementation
  - Files: `packages/exam-engine/src/types.ts`
  - Verify: `pnpm typecheck` passes; signatures importable from `@exam/exam-engine`

## Acceptance Criteria

1. `packages/domain` does not depend on Fastify
2. `packages/contracts` does not depend on Fastify
3. All shared types are exported from `@exam/domain` or `@exam/contracts`
4. `apps/api` and `apps/web` do not redefine core DTOs — they import from packages
5. `pnpm typecheck` passes across all packages
6. Every domain type from SPEC.md §3 has a corresponding TypeScript type
7. SaveAnswerRequest includes `clientSeq`, `baseVersion`, `clientSavedAt`
8. SaveAnswerResponse includes `accepted`, `serverVersion`, `conflict?`

## Verify Commands

```bash
pnpm install
pnpm lint:copy
pnpm typecheck
pnpm --filter domain typecheck
pnpm --filter contracts typecheck
pnpm --filter exam-engine typecheck
pnpm build
```

## Review Checklist

- [ ] No Fastify import in packages/domain
- [ ] No Fastify import in packages/contracts
- [ ] All types match SPEC.md §3 data models
- [ ] Exam status enum includes all 5 states: draft/published/open/closed/archived
- [ ] AttemptStatus includes: in_progress/submitted/graded/disrupted
- [ ] SaveAnswerRequest/SaveAnswerResponse match SPEC.md §3.5
- [ ] Barrel exports (index.ts) are clean
- [ ] Zod schemas use `.describe()` for API documentation where helpful
- [ ] No duplicate DTOs (types imported from `@exam/domain` or `@exam/contracts`)
- [ ] No `any` / `as any`
- [ ] No `console.log` (use logger in api, nothing in packages)
- [ ] No unnecessary new dependencies
- [ ] No hardcoded deployment-specific product copy (e.g., 校内/校园/大学/学生)
- [ ] `pnpm verify` passes
