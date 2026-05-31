# Exam System - Agent Instructions

## Project Context

University **LAN exam system** deployed on-premise. Multi-tenant: each department/lab runs its own exams independently. Supports open-book quizzes and strict closed-book proctored exams. Auto-graded, instant results, "pass to proceed" API for external systems.

**Read `docs/SPEC.md` first** — that is the specification document. If your implementation conflicts with it, the spec wins.

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
pnpm install                          # install all workspaces
pnpm --filter api dev                 # start backend (port 3000)
pnpm --filter web dev                 # start frontend (port 5173, proxies /api -> :3000)
pnpm dev                              # start both (via turbo)

# Code Quality (see docs/code-quality.md)
pnpm format:check                     # Prettier check
pnpm lint                             # ESLint across all packages
pnpm lint:arch                        # Architecture boundary check (dependency-cruiser)
pnpm typecheck                        # TypeScript strict mode check
pnpm test                             # Vitest unit tests
pnpm coverage                         # Vitest coverage (v8)
pnpm test:integration                 # Integration tests
pnpm test:e2e                         # Playwright E2E tests
pnpm build                            # Build all packages
pnpm verify                           # Full quality gate: format + lint + arch + typecheck + test + coverage + build
```

## Project Structure

```
apps/
  web/src/
    components/ui/     # shadcn/ui components (generated, do not hand-edit)
    components/shared/ # shared business components
    pages/             # route-level components
    lib/               # utilities, API client
    hooks/             # shared React hooks
  api/src/
    routes/            # Fastify route handlers, one file per domain
    plugins/           # Fastify plugins (auth, CORS, security headers)
    server.ts          # Fastify entry point
  desktop/             # Electron shell (Phase 2, not started)

packages/
  domain/src/
    types.ts           # domain types (ExamAttempt, ExamEnrollment, etc.)
                        # this is the single source of truth for data shapes
    errors.ts          # domain error types (AppError, NotFoundError, etc.)
    examStateMachine.ts # exam state machine commands
    gradingEngine.ts   # auto-grading logic
    retakePolicy.ts    # retake/score strategy logic
  contracts/src/
    *.ts               # Zod schemas, DTO types, API contracts
  db/src/
    schema.ts          # Drizzle schema mirrors domain types
    migrations/        # Drizzle migrations
    repository/        # data access layer — every method must receive ctx
  auth/src/
    session.ts         # session/JWT management
    rbac.ts            # role-based access control
    tenantGuard.ts     # multi-tenant isolation
  exam-engine/src/
    timer.ts           # server-side time authority
    answerProtocol.ts  # answer save protocol (versioned, idempotent)
    grading.ts         # grading engine integration
  import-export/src/   # CSV/Excel/PDF import/export

docs/                   # design documents
```

## Key Constraints

- **LAN-only deployment**: no cloud dependencies, no CDN, no external APIs
- **Offline-capable**: system must work when campus internet is down
- **Multi-tenant**: all tables have `organizationId`; all repo methods must receive `ctx` — never access db directly from routes
- **Security is core**: exam system security is not optional — see SPEC.md §6
- **Server is time authority**: never trust client timestamps for exam logic
- **Question snapshot**: ExamAttempt copies questions at creation time via `QuestionSnapshot`; QuestionBank edits don't affect existing attempts
- **"Pass to proceed"**: external systems can query exam results via API (e.g., lab access control) [Phase 2]
- **Candidate ≠ Student**: examinee identity is defined per-organization via `CandidateField`, not hardcoded
- **Exam is not CRUD**: all state changes go through command functions (`publishExam`, `startAttempt`, `submitAttempt`, etc.) — never mutate status directly
- **Answer Save Protocol**: answers use versioned, idempotent saves with conflict detection — see SPEC.md §3.5
- **Repository pattern**: all db access through `repo.method(ctx, ...)` — `db.select()` directly in routes is forbidden

## Exam-Specific Gotchas

- Answers must be saved to server on every change via Answer Save Protocol (not just on submit)
- Exam timer is server-side; client countdown is cosmetic only
- `ExamAttempt` (not ExamPaper) is the core entity — supports multiple attempts per exam
- `ExamEnrollment` tracks qualification + attempt count + final score (selected by scoreStrategy)
- Fill-blank grading has configurable matching (exact vs. keyword) — not just string equality
- Multi-select scoring: all-correct = full, partial = half, any-wrong = zero (configurable per exam)
- `standardAnswer` on Question is required for auto-grading; questions without it cannot be used in auto-graded exams
- Open-book vs closed-book is a spectrum — control flags can be overridden independently
- ExamAttempt has a `disrupted` state — client heartbeat timeout auto-triggers it; recovery restores answers + remaining time from server
- `lastActivityAt` on ExamAttempt is the heartbeat field — server uses it to detect disconnected students
- Phase 1 only implements `timed_window` timing mode; other modes deferred to Phase 2
- Queued entry (`requireQueue` + `batchSize` + `batchInterval`) prevents exam-start traffic spikes
- Degradation deferred to Phase 2; Phase 1 only does basic health check
- Candidate identity fields are per-organization (`CandidateField`), not global — import templates are dynamically generated

## Dependency Rules

- `packages/domain` cannot depend on `fastify`
- `packages/contracts` cannot depend on `fastify`
- `packages/exam-engine` cannot depend on `fastify`
- `fastify` can only appear in `apps/api`
- `packages/db` repository methods must receive `ctx` — no bare SQL in routes
- `packages/domain` has no internal package dependency (leaf node)
- `apps/web` cannot import from `packages/db` directly
- See `docs/code-quality.md` §6 for full dependency graph

## Code Quality

**Read `docs/code-quality.md` before implementing any Job.** Key rules:

- **TypeScript strict mode** — no `any`, no `as any`, see `tsconfig.base.json`
- **Prettier + ESLint** — `pnpm verify` must pass
- **Architecture lint** — `pnpm lint:arch` checks dependency boundaries
- **Repository pattern** — no bare `db.select()` in routes; all repo methods take `ctx`
- **Command functions** — no direct status mutation; state changes via `publishExam()`, `startAttempt()`, etc.
- **Unified errors** — use `packages/domain/src/errors.ts` domain error types, not `throw new Error()`
- **Structured logging** — pino in api, no `console.log` anywhere in packages
- **No duplicate DTOs** — import from `@exam/domain` or `@exam/contracts`, never redefine
- **Route handler simplicity** — read request → validate → call command → return response
- **AI coding rules** — see `docs/code-quality.md` §17

Every Job completion requires:
1. List of modified files
2. List of new tests
3. Coverage result
4. `pnpm verify` result
5. Any known limitations

## Conventions

- Use path aliases: `@/` maps to `apps/web/src/`
- Domain types live in `packages/domain/src/types.ts` — import from `@exam/domain`, never redefine
- API contracts live in `packages/contracts/src/` — Zod schemas for request/response validation
- API routes: `apps/api/src/routes/<domain>.ts` (e.g., `routes/exam.ts`, `routes/question.ts`)
- DB schema: `packages/db/src/schema.ts` — Drizzle schema mirrors domain types
- DB repository: `packages/db/src/repository/<entity>Repo.ts` — each repo method takes ctx as first arg
- All user-facing strings in Chinese (zh-CN), code and comments in English
- No comments in code unless asked
