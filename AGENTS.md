# Exam Platform - Agent Instructions

## Project Context

Configurable **LAN/on-premise exam and assessment platform**. It is not hardcoded to a university, school, lab, or single course scenario. Deployments may include departments, training centers, labs, enterprises, associations, or any organization that needs internal exams or certification workflows.

**Phase 1 is a single-tenant, multi-user Minimal Deliverable Exam System.** One deployment represents one organization. The current Phase 1 product path is Admin + Candidate only: Admin configures candidates, courses, questions, exams, assignments, grading, diagnostics, and exports; Candidate logs in, takes assigned exams, submits attempts, and views allowed results.

Strict closed-book proctored exam operation is Phase 2+. Teacher-like roles, Proctor, Grader, scoped permissions, invitation, and email account lifecycle are Phase 3. Pass-to-proceed APIs, service tokens, external integrations, optional multiTenant, and SuperAdmin are Phase 4 platformization/integration.

**Read `docs/SPEC.md` and `docs/phase-roadmap.md` first** — they are the specification and phase authority documents. If implementation conflicts with them, the spec and roadmap win.

## Product Generalization Rules

- Do not hardcode product title such as "校内考试", "校园内网考试平台", "University LAN exam system", or any single deployment scenario.
- Product title, subtitle, footer, and organization display name come from deployment settings / `OrganizationSettings`; organization display name falls back to the internal default `Organization.displayName`. This must not imply an organization creation UI in Phase 1.
- Exam titles come from `Exam.title`, set by Admin in Phase 1. Teacher-like roles are Phase 3 scoped role bundles.
- Candidate identity comes from the internal default organization's `CandidateField`; never assume Student, 学生, 学号, 工号, department, or class.
- Course may mean course, training module, certification category, access qualification, or assessment domain. Keep the code generic.
- Scenario-specific words may appear only in docs, tests, stories, or demo seed data.

## Phase 1.x Single-Tenant Rule

- Phase 1.x is single-tenant, multi-user.
- Phase 1 product roles are Admin and Candidate only.
- Teacher / Proctor / Grader are future role bundles, not Phase 1 product roles.
- organization table and organizationId are kept as internal data boundary.
- default organization is kept as the only organization.
- Do not expose organizationSlug login.
- Do not implement tenant switcher.
- Do not expose SuperAdmin.
- Do not allow DEPLOYMENT_MODE=multiTenant as current runnable mode.
- multiTenant / SuperAdmin / cross-tenant management can only be implemented in Phase 4 platformization, not in current tasks.

## Tech Stack

| Layer    | Tech                                                               |
| -------- | ------------------------------------------------------------------ |
| Frontend | React 19 + Vite + TypeScript + shadcn/ui + TailwindCSS v4          |
| Backend  | Node.js LTS + Fastify + TypeScript + Zod validation                |
| Database | PostgreSQL via Drizzle ORM |
| Auth     | HTTP-only Cookie + JWT, argon2/bcrypt password hashing             |
| Monorepo | pnpm workspace: `apps/`, `packages/`                               |

### Database Notes

- PostgreSQL is the only supported database.
- Repository and service code must remain database-agnostic.
- Run migrations, integration tests, and smoke tests against PostgreSQL before any release.

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

## MCP / External Research Rules

MCP tools are for agent-side research, verification, and codebase navigation only. They must not introduce runtime cloud dependencies into the product. The exam platform itself must remain LAN/on-premise and offline-capable.

### Required MCP Usage

Before modifying files, the agent must use available MCP/search tools when the task involves any of the following:

- Docker, Docker Compose, multi-stage builds, image size, cache behavior, or runtime entrypoints
- pnpm workspace behavior, `pnpm deploy`, lockfile issues, package filters, or workspace symlinks
- Node.js ESM/CJS resolution, `package.json` `exports`, `main`, `type`, or module resolution errors
- TypeScript build configuration, tsconfig output, test files leaking into `dist`, or declaration/map generation
- Vite, React, Tailwind, shadcn/ui, Fastify, Drizzle, Zod, argon2/bcrypt, or PostgreSQL behavior
- CI, GitHub Actions, lint/test/build failures, dependency upgrades, or package manager changes
- Any error message that the agent cannot fully explain from the current repository evidence

### MCP Tool Priority

Use tools in this order:

1. **Local repository search / filesystem tools**
   Inspect the actual project files first: `package.json`, `pnpm-workspace.yaml`, Dockerfile, compose files, entrypoints, tsconfig files, source imports, generated `dist`, and relevant docs.

2. **Context7 or official documentation search**
   Use this for framework/tool behavior. Prefer official docs over memory.

3. **GitHub code search / gh_grep**
   Use this only for implementation examples and patterns. Do not copy external code blindly.

4. **General web search**
   Use only when official docs and repo evidence are insufficient.

### Mandatory Research Workflow

For Docker, pnpm, Node module resolution, CI, dependency, or build-system problems, do not edit first. The agent must first produce:

1. Current error symptom
2. Root-cause hypothesis
3. Repository evidence
4. Official documentation or MCP search finding, when applicable
5. Minimal proposed change
6. Verification commands
7. Expected success signal

Only after this analysis should files be modified.

### No Guessing Rules

The agent must not:

- Guess Docker, pnpm, Node ESM, or package manager behavior from memory when MCP/search tools are available.
- Hand-write workspace dependency closure in Dockerfile unless `pnpm deploy` or the package manager solution has been proven unsuitable.
- Use fragile one-line shell pipelines that hide failure causes.
- Use `tail`, `grep`, or `|| true` in a way that masks the real error during diagnosis.
- Treat external GitHub examples as authoritative over this repository or `docs/SPEC.md`.
- Add cloud services, CDN usage, external APIs, telemetry, or online-only behavior to the product runtime.

### If MCP Is Unavailable

If MCP/search tools are unavailable, the agent must say so explicitly and continue using local repository evidence only. It must not pretend that official behavior has been verified.

### Verification Requirements for Build / Docker Changes

For Docker, pnpm workspace, or runtime image changes, verification must include:

```bash
docker build -t exam-app:latest .
docker run --rm --entrypoint sh exam-app:latest -lc 'pwd; find /app -maxdepth 3 -type d | sort | head -100'
docker run --rm --entrypoint sh exam-app:latest -lc 'node -e "console.log(require.resolve(\"@exam/db/package.json\"))"'
docker compose up -d --build
docker compose logs app --tail=100
```

If the entrypoint path changes, also verify the actual runtime files:

```bash
docker run --rm --entrypoint sh exam-app:latest -lc 'test -f /app/dist/server.js && test -f /app/dist/scripts/migrate.js'
```

For image-size work, verification must include:

```bash
docker image inspect exam-app:latest --format '{{.Size}}'
docker history exam-app:latest
docker run --rm --entrypoint sh exam-app:latest -lc 'du -sh /app /app/node_modules 2>/dev/null || true'
```

Do not mix image-size inspection and application smoke tests into one fragile command.

## Project Structure

```txt
apps/
  web/src/
    components/ui/       # shadcn/ui components (generated, do not hand-edit)
    components/shared/   # shared business components
    components/layout/   # layout components (sidebar, header)
    components/settings/ # platform & organization settings components
    pages/               # route-level components
    lib/                 # utilities, API client
    hooks/               # shared React hooks
  api/src/
    routes/              # Fastify route handlers, one file per domain
    plugins/             # Fastify plugins (auth, CORS, security headers)
    server.ts            # Fastify entry point
  desktop/               # Electron shell (Phase 2, not started)

packages/
  domain/src/
    types.ts             # domain types (ExamAttempt, ExamEnrollment, etc.)
    errors.ts            # domain error types (AppError, NotFoundError, etc.)
    examStateMachine.ts  # exam state machine commands
    gradingEngine.ts     # auto-grading logic
    retakePolicy.ts      # retake/score strategy logic
  contracts/src/
    *.ts                 # Zod schemas, DTO types, API contracts
  db/src/
    schema.ts            # Drizzle schema mirrors domain types
    migrations/          # Drizzle migrations
    repository/          # data access layer — every method must receive ctx
  auth/src/
    session.ts           # session/JWT management
    rbac.ts              # role-based access control
    tenantGuard.ts       # organization data boundary guard
  exam-engine/src/
    timer.ts             # server-side time authority
    answerProtocol.ts    # answer save protocol (versioned, idempotent)
    grading.ts           # grading engine integration
  import-export/src/     # CSV/Excel/PDF import/export

docs/                    # design documents
```

## Key Constraints

- **LAN/on-premise deployment**: no cloud dependencies, no CDN, no external APIs
- **Offline-capable**: system must work when external internet is unavailable
- **Single-tenant data boundary**: all business tables have `organizationId`; all repo methods must receive `ctx` — never access db directly from routes. organizationId comes from internal default organization.
- **Security is core**: exam system security is not optional — see SPEC.md §6
- **Server is time authority**: never trust client timestamps for exam logic
- **Question snapshot**: ExamAttempt copies questions at creation time via `QuestionSnapshot`; QuestionBank edits don't affect existing attempts
- **"Pass to proceed"**: external systems can query exam results via API (e.g., access control) [Phase 4]
- **Candidate is a configurable examinee identity**, not Student — defined by the internal default organization's `CandidateField`
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
- `lastActivityAt` on ExamAttempt is the heartbeat field — server uses it to detect disconnected examinees
- Phase 1 only implements `timed_window` timing mode; other modes deferred to Phase 2
- Queued entry (`requireQueue` + `batchSize` + `batchInterval`) is Phase 2 exam operation, not Phase 1
- Degradation deferred to Phase 2; Phase 1 only does basic health check
- Candidate identity fields come from the internal default organization's `CandidateField` — import templates are dynamically generated

## Dependency Rules

- `packages/domain` cannot depend on `fastify`, React, Drizzle, or internal packages
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
- **Copy guard** — `pnpm lint:copy` prevents hardcoded deployment-specific business copy
- **Repository pattern** — no bare `db.select()` in routes; all repo methods take `ctx`
- **Command functions** — no direct status mutation; state changes via `publishExam()`, `startAttempt()`, etc.
- **Unified errors** — use `packages/domain/src/errors.ts` domain error types, not `throw new Error()`
- **Structured logging** — pino in api, no `console.log` anywhere in packages
- **No duplicate DTOs** — import from `@exam/domain` or `@exam/contracts`, never redefine
- **Route handler simplicity** — read request → validate → create ctx → call command/service/repo → return response
- **AI coding rules** — see `docs/code-quality.md` §17
- **Research before toolchain changes** — Docker, pnpm, Node module resolution, CI, package manager, and build-system changes require MCP/doc search + local repo verification before editing. Do not guess.

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

---

## Current Roadmap Authority

- **Current work is documentation realignment for Phase 1 Minimal Deliverable Exam System.**
- Next work: **Phase 1 singleTenant cleanup**.
- Then: **E2E re-enable** for happy path / resume / submit-flush as blocking CI.
- **Phase2 has not started.**
- **Phase plans control implementation schedule.**
- **SPEC and `docs/phase-roadmap.md` win over implementation details.**
- **Phase 2 does NOT implement multi-tenant.** Multi-tenant is Phase 4 platformization only.

---

## Phase1.4 UI Foundation Reset (Historical / Reference)

### Purpose

Phase1.4 UI Foundation Reset is a **UI foundation stabilization reference**, not the current roadmap authority. It is NOT:

- A visual beautification task
- A Phase2 implementation task
- A full site rewrite

### Problems Being Solved

1. Title remains loading forever
2. Direct refresh shows blank page
3. Sidebar/nav/collapse instability
4. Logo slot and collapse icon conflict
5. No stable BrandMark / logo fallback
6. Scattered CSS / Tailwind status colors
7. Inconsistent page loading/error states
8. Admin Console vs Exam Runtime layout boundary unclear
9. SVG/icon usage inconsistent

### Documentation Reference

All UI foundation rules are defined in `docs/ui/`:

- `docs/ui/00-ui-constitution.md` — UI constitution and invariant principles
- `docs/ui/01-design-tokens.md` — CSS variables and Tailwind tokens
- `docs/ui/02-layout-system.md` — Shell, sidebar, topbar, and layout rules
- `docs/ui/03-component-boundaries.md` — Component layer boundaries
- `docs/ui/04-state-grammar.md` — Status grammar and集中 management
- `docs/ui/05-page-templates.md` — Page templates (list, detail, form, exam runtime)
- `docs/ui/06-accessibility-rules.md` — Accessibility rules
- `docs/ui/07-ui-bug-inventory.md` — Known UI bugs
- `docs/ui/08-migration-plan.md` — PR migration plan
- `docs/ui/09-phase2-readiness.md` — Phase2 documentation readiness

### Migration Plan

See `docs/ui/08-migration-plan.md` for PR拆分:

- PR 1: Documentation convergence only
- PR 2: Route refresh / title loading / ErrorBoundary / App bootstrap
- PR 3: Sidebar / BrandMark / navigation collapse rebuild
- PR 4: Design tokens / CSS cleanup / status grammar implementation
- PR 5: Shared components implementation
- PR 6: One admin list page migration
- PR 7: One admin detail/settings page migration
- PR 8: Exam runtime shell migration
- PR 9: UI consistency pass

---

## Phase2-Ready, Not Phase2-Implemented

### Allowed in Documentation

- Shared status grammar
- Page templates (AdminShell / ExamShell rules)
- Future proctor panel template documentation
- Future export/integration template documentation

### Forbidden During UI Reset

Do NOT implement or expose:

- Real ExamRoom management
- Real IP range enforcement UI
- Real proctor WebSocket dashboard
- Real candidate live status cards
- Real force-submit / extend-time / misconduct actions
- Real random paper builder
- Real timed_sync / deadline / untimed workflows
- Real Pass Gate API UI
- Real API key / service token management
- Real PDF export workflow
- Real Electron lockdown UI
- Real AI grading UI
- Real adaptive degradation UI

### Phase2 Modules (Documentation Only)

| Module | Scope |
|--------|-------|
| Phase2A Exam Operation | Detail page + right-side status panel + audit timeline |
| Phase2B Proctor Panel | Dashboard page + status cards + event stream + action confirmation |
| Phase2C Exam Flexibility | Form sections + rule builder + snapshot preview |
| Phase2D Integration Export | Settings page + key management table + export job status |
