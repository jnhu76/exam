# Exam Platform - Agent Instructions

## Project Context

Configurable **LAN/on-premise exam and assessment platform**. It is not hardcoded to a university, school, lab, or single course scenario. Deployments may include departments, training centers, labs, enterprises, associations, or any organization that needs internal exams, certification, access checks, or pass-to-proceed workflows.

Multi-tenant: each organization runs exams independently. Supports open-book quizzes and strict closed-book proctored exams. Auto-graded, optionally instant results, and Phase 2 exposes a pass-to-proceed API for external systems such as access control or training workflow gates.

**Read `docs/SPEC.md` first** — that is the specification document. If your implementation conflicts with it, the spec wins.

## Product Generalization Rules

- Do not hardcode product title such as “校内考试”, “校园内网考试平台”, “University LAN exam system”, or any single deployment scenario.
- Product title, subtitle, footer, organization display name, and candidate identity fields are configurable.
- Exam titles come from `Exam.title`, set by Admin/Teacher.
- Candidate identity comes from per-organization `CandidateField`; never assume Student, 学生, 学号, 工号, department, or class.
- Course may mean course, training module, certification category, access qualification, or assessment domain. Keep the code generic.
- Scenario-specific words may appear only in docs, tests, stories, or demo seed data.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + Vite + TypeScript + shadcn/ui + TailwindCSS v4 |
| Backend | Node.js LTS + Fastify + TypeScript + Zod validation |
| Database | PostgreSQL (prod default) / SQLite (dev/demo only) via Drizzle ORM |
| Auth | HTTP-only Cookie + JWT, argon2/bcrypt password hashing |
| Monorepo | pnpm workspace: `apps/`, `packages/` |

## Commands

```bash
pnpm install
pnpm --filter api dev
pnpm --filter web dev
pnpm dev

pnpm format:check
pnpm lint
pnpm lint:copy
pnpm lint:arch
pnpm typecheck
pnpm test
pnpm coverage
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm verify
```

## Project Structure

```
apps/
  web/src/
    components/ui/
    components/shared/
    components/layout/
    components/settings/
    pages/
    lib/
    hooks/
  api/src/
    routes/
    plugins/
    server.ts
  desktop/

packages/
  domain/src/
    types.ts
    errors.ts
    examStateMachine.ts
    gradingEngine.ts
    retakePolicy.ts
  contracts/src/
  db/src/
    schema.ts
    migrations/
    repository/
  auth/src/
    session.ts
    rbac.ts
    tenantGuard.ts
  exam-engine/src/
    timer.ts
    answerProtocol.ts
    grading.ts
  import-export/src/

docs/
```

## Key Constraints

- LAN/on-premise deployment: no cloud dependencies, no CDN, no external APIs.
- Offline-capable: system must work when external internet is unavailable.
- Multi-tenant: all business tables have `organizationId`; all repo methods must receive `ctx`.
- Security is core: exam system security is not optional.
- Server is time authority: never trust client timestamps for exam logic.
- Question snapshot: `ExamAttempt` copies questions at creation time via `QuestionSnapshot`; QuestionBank edits do not affect existing attempts.
- Candidate is a configurable examinee identity, not Student.
- Exam is not CRUD: all state changes go through command functions such as `publishExam`, `startAttempt`, and `submitAttempt`.
- Answer Save Protocol: answers use versioned, idempotent saves with conflict detection.
- Repository pattern: all db access through `repo.method(ctx, ...)`; direct `db.select()` in routes is forbidden.

## Exam-Specific Gotchas

- Answers must be saved to server on every change via Answer Save Protocol, not only on submit.
- Exam timer is server-side; client countdown is cosmetic only.
- `ExamAttempt` is the core entity and supports multiple attempts per exam.
- `ExamEnrollment` tracks qualification, attempt count, and final score selected by `scoreStrategy`.
- Fill-blank grading has configurable matching, such as exact vs keyword.
- Multi-select scoring: all-correct = full, partial = half, any-wrong = zero, configurable per exam.
- `standardAnswer` is required for auto-grading; questions without it cannot be used in auto-graded exams.
- Open-book vs closed-book is a spectrum; control flags can be overridden independently.
- `ExamAttempt` has a `disrupted` state; heartbeat timeout auto-triggers it. Recovery restores answers and remaining time from server.
- `lastActivityAt` is the heartbeat field.
- Phase 1 only implements `timed_window`; other timing modes are Phase 2.
- Queued entry prevents exam-start traffic spikes.
- Degradation is Phase 2; Phase 1 only does basic health check.
- Candidate import templates are dynamically generated from per-organization `CandidateField`.

## Dependency Rules

- `packages/domain` cannot depend on `fastify`, React, Drizzle, or internal packages.
- `packages/contracts` cannot depend on `fastify`.
- `packages/exam-engine` cannot depend on `fastify`.
- `fastify` can only appear in `apps/api`.
- `packages/db` repository methods must receive `ctx`.
- `apps/web` cannot import from `packages/db` directly.
- See `docs/code-quality.md` §6 for the full dependency graph.

## Code Quality

Read `docs/code-quality.md` before implementing any Job. Key rules:

- TypeScript strict mode: no `any`, no `as any`.
- Prettier + ESLint: `pnpm verify` must pass.
- Architecture lint: `pnpm lint:arch` checks dependency boundaries.
- Copy guard: `pnpm lint:copy` prevents hardcoded deployment-specific business copy.
- Repository pattern: no bare `db.select()` in routes.
- Command functions: no direct status mutation.
- Unified errors: use domain error types, not `throw new Error()`.
- Structured logging: pino in api, no `console.log` in packages.
- No duplicate DTOs: import from `@exam/domain` or `@exam/contracts`.
- Route handler simplicity: read request → validate → create ctx → call command/service/repo → return response.

Every Job completion requires:

1. List of modified files
2. List of new tests
3. Coverage result
4. `pnpm verify` result
5. Any known limitations

## Conventions

- Use path aliases: `@/` maps to `apps/web/src/`.
- Domain types live in `packages/domain/src/types.ts`; import from `@exam/domain`.
- API contracts live in `packages/contracts/src/`.
- API routes: `apps/api/src/routes/<domain>.ts`.
- DB schema: `packages/db/src/schema.ts`.
- DB repository: `packages/db/src/repository/<entity>Repo.ts`; each repo method takes ctx as first arg.
- All user-facing strings in Chinese (zh-CN), code and comments in English.
- No comments in code unless asked.
