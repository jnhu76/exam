# Exam Platform - Agent Instructions

## Project Context

Configurable **LAN/on-premise exam and assessment platform**. It is not hardcoded to a university, school, lab, or single course scenario. Deployments may include departments, training centers, labs, enterprises, associations, or any organization that needs internal exams or certification workflows.

**Phase 1 is a single-tenant, multi-user Minimal Deliverable Exam System.** One deployment represents one organization. The current Phase 1 product path is Admin + Candidate only: Admin configures candidates, courses, questions, exams, assignments, grading, diagnostics, and exports; Candidate logs in, takes assigned exams, submits attempts, and views allowed results.

Strict closed-book proctored exam operation is Phase 2+. Teacher-like roles, Proctor, Grader, scoped permissions, invitation, and email account lifecycle are Phase 3. Pass-to-proceed APIs, service tokens, external integrations, optional multiTenant, and SuperAdmin are Phase 4 platformization/integration.

**Read `docs/SPEC.md` and `docs/roadmap/phase-roadmap.md` first** — they are the specification and phase authority documents. If implementation conflicts with them, the spec and roadmap win.

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

### Local Database Discipline (READ THIS BEFORE TOUCHING ANY DB)

The local dev Postgres container (`pnpm db:up`) intentionally runs **three databases**. They have **separate, non-overlapping purposes**. An agent MUST keep them separate — mixing them corrupts dev state or breaks tests.

| Database | Env var | Purpose | Seeded by | Used by |
| --- | --- | --- | --- | --- |
| `exam` | `DATABASE_URL` | **Dev runtime** — what `pnpm dev` and humans read/write | `pnpm db:seed:demo` (full demo data) | API/web dev servers, manual UI testing |
| `exam_test` | `TEST_DATABASE_URL` | **vitest runtime only** — isolated, disposable | nothing persistent (tests create/truncate their own data via worker-DB isolation) | `pnpm test`, `pnpm test:integration`, `pnpm verify`, `pnpm coverage` |
| `exam_e2e` | `DATABASE_URL` (only inside `run-wsl.sh`) | **WSL Playwright E2E only** — fast local e2e without building the Docker image; reseeded every run | `scripts/e2e/run-wsl.sh` (baseline + demo seed, idempotent; `--no-reseed` to skip) | `bash scripts/e2e/run-wsl.sh` |

> **Why `exam_e2e` is a third DB:** WSL E2E reseeds every run to a known demo state. Pointing it at `exam` would clobber the human's manual dev data; pointing it at `exam_test` would collide with vitest's worker-DB isolation. A dedicated `exam_e2e` keeps fast-iteration e2e, dev, and unit tests all isolated. The Docker E2E path (`scripts/e2e/run.sh` + `docker-compose.test.yml`) uses its own throwaway container volume instead and does NOT touch any of these host databases.

**Connection facts:**

- Container: `exam-db-1` (postgres:18.4), host port `15432` → container `5432`, user/pass `exam`/`exam`.
- `exam_test` is created once at first container init by `docker/db/init/01-create-databases.sql`. It MUST exist (the test name-safety guard in `packages/db/src/testDb.ts` refuses any name without `test`/`e2e`/`ci`).
- The DB name is resolved by APP_MODE: `test`/`ci`/`e2e` → `TEST_DATABASE_URL` (fail-fast, never falls back to `DATABASE_URL`); otherwise → `DATABASE_URL`. See `packages/db/src/databaseUrl.ts`.

**Agent rules — do NOT deviate:**

1. **`pnpm dev` uses `exam`, period.** Do not point the dev server at `exam_test`. The human's manual data lives in `exam`; polluting it with test fixtures or truncating it is a bug.
2. **`pnpm test` / `verify` use `exam_test`, period.** They never read or write `exam`. Tests manage their own data (worker-DB isolation / per-test truncate); an agent must not pre-seed `exam_test` with demo data.
3. **`pnpm db:seed:demo` seeds `exam` only.** It is the one command that fills the dev DB with the demo dataset (org, users, courses, questions, exams, settings). Never run it against `exam_test`.
4. **Do not invent a fourth database.** The three-DB split (`exam` / `exam_test` / `exam_e2e`) is the contract. Do not create `exam_dev`, `exam_local`, or any other name.
5. **Env-var priority (SOTA: shell > `.env.local` > `.env`).** This is Vite/dotenv native behavior and is NOT negotiable:
   - `process.env` (shell export) always wins; `.env` files never overwrite it.
   - `.env` MUST define **both** `DATABASE_URL` (→ `exam`) and `TEST_DATABASE_URL` (→ `exam_test`) with local defaults, so a bare `pnpm verify` / `pnpm test` / `pnpm dev` works with **zero** shell setup. Never comment out `TEST_DATABASE_URL` in `.env` — doing so breaks bare `pnpm verify`.
   - An agent must NOT rely on a shell `export` to fix a missing `.env` value. If `.env` is missing a required DB URL, fix `.env`, not the shell.
   - Shell env residue is per-session only and does not persist; treat any inherited `DATABASE_URL`/`TEST_DATABASE_URL`/`APP_MODE` as suspect. When in doubt, prefix the command with an explicit `unset` or the intended values, e.g.:

     ```bash
     # Bare run (relies on .env — preferred):
     pnpm verify
     # Force dev DB explicitly when a stale shell var is present:
     DATABASE_URL="postgresql://exam:exam@localhost:15432/exam" pnpm dev
     ```

6. **Always verify the resolved DB, never assume.** Before trusting that dev uses `exam` or tests use `exam_test`, prove it:

   ```bash
   # Which DB does a process actually see? Query it, don't guess from .env:
   docker exec exam-db-1 psql -U exam -d exam -tAc "SELECT current_database(), count(*) FROM exams;"
   docker exec exam-db-1 psql -U exam -d exam_test -tAc "SELECT current_database(), count(*) FROM exams;"
   ```

7. **Resetting `exam_test` is allowed and expected** (tests are disposable). Resetting `exam` wipes the human's working demo data — only do it if explicitly asked, and re-run `pnpm db:seed:demo` afterward.
8. **If unsure which DB a running process is using, prove it by querying the API or the DB directly** — never guess from `.env` alone.

## Commands

```bash
pnpm install
pnpm --filter api dev
pnpm --filter web dev
pnpm dev

pnpm format:check
pnpm lint              # code-quality checker (not ESLint)
pnpm lint:eslint       # ESLint on the web package
pnpm lint:copy
pnpm lint:arch
pnpm typecheck
pnpm test
pnpm coverage
pnpm test:integration  # compatibility alias of `pnpm test`
pnpm test:e2e          # existing-env-only: needs migrated DB + seeded E2E data + running API/web
pnpm e2e:docker        # managed Docker E2E lifecycle
pnpm smoke             # lightweight PR smoke gate (single E2E spec)
pnpm build
pnpm verify
```

- `pnpm lint` runs `scripts/check-code-quality.mjs` (copy, architecture, UI
  guards). It is **not** ESLint; use `pnpm lint:eslint` for ESLint.
- `pnpm lint:quality` is the canonical alias for `pnpm lint`.
- `pnpm test:integration` is a compatibility alias for `pnpm test`; both invoke
  `vitest run` with the same files.
- `pnpm test:e2e` and `pnpm smoke` are **existing-environment-only**: they assume
  an already-running API + web server and a migrated, E2E-seeded database. For a
  managed lifecycle, use `pnpm e2e:docker` or `bash scripts/e2e/run-wsl.sh`.

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
- See `docs/standards/code-quality.md` §6 for full dependency graph

## Code Quality

**Read `docs/standards/code-quality.md` before implementing any Job.** Key rules:

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
- **AI coding rules** — see `docs/standards/code-quality.md` §17
- **Research before toolchain changes** — Docker, pnpm, Node module resolution, CI, package manager, and build-system changes require MCP/doc search + local repo verification before editing. Do not guess.
- **Frontend visual authority** — see the "Frontend Visual Authority" section below

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

## Frontend Visual Authority

**Authority documents** (read before any frontend visual work):

- `docs/architecture/frontend.md` — as-built frontend architecture (shell, routing, layouts, API client, auth projection, state/data ownership, page composition, package boundaries, tech stack, responsive structure).
- `docs/standards/ui-system.md` — as-built UI system constraints (design tokens, fonts, typography recipes, surface/elevation, component authority, Tailwind boundary, status color, icons, tables, accessibility, forbidden dependencies, active `exam-ui/*` lint).
- `docs/roadmap/ui-open-items.md` — unfinished visual-authority migration work (blocked on UI-PILOT-1 / UI-MIGRATE-N).

The historical construction-stage UI documents (`P3-UI-*`, audits, recons, closures, plans) live under `docs/archive/frontend/` and are not current guidance. Do **not** treat `docs/ui/*` or `docs/frontend/P3-UI-*` paths as current authority — those directories no longer exist in the active tree; references to them are historical/archive only.

### Authority chain

```text
semantic tokens
    ↓
semantic recipes
    ↓
authoritative components
    ↓
business pages
```

Tailwind remains the implementation substrate. This model makes Tailwind a substrate, not the business-facing visual language. It does **not** mean "business pages must not use Tailwind" (see the boundary below).

### Component discovery rule

Before creating or locally recreating a visual structure, inspect these in order:

```text
apps/web/src/components/ui          # shadcn primitives (generated, do not hand-edit)
apps/web/src/components/shared      # authoritative shared business components
existing semantic recipes           # apps/web/src/typography/recipes.css (type-*) + apps/web/src/surface/recipes.css (surface-*)
the recipe ownership registry       # apps/web/src/typography/recipeRegistry.ts (single canonical source)
```

The per-component role → owner mapping is documented in `docs/standards/ui-system.md` §Component authority.

Distinguish **component does not exist** from **component exists but appears insufficient**. The latter triggers the insufficiency protocol below — it is **not** a license to bypass the authority. Writing local Tailwind is never, by itself, justification to bypass an existing visual authority.

### Component insufficiency protocol

When an existing authoritative component or recipe appears insufficient:

1. identify the missing semantic, structural, interaction, or accessibility requirement;
2. determine whether the requirement belongs to the existing visual role;
3. extend the existing authority when the semantic role is unchanged;
4. introduce a distinct role only when the semantics genuinely differ.

Do not create a second implementation of the same visual role. Known collision groups to reconcile (not duplicate): `PageSection` / `ContentCard` / `DataTableShell` (titled content containers), the multiple "stat/KPI" presentations, `ListToolbar` / `DataToolbar`, `ConfirmDialog` / `ConfirmActionDialog`.

### Tailwind boundary

Business pages **may** use Tailwind for structural layout and responsive behavior. Normal structural Tailwind includes:

```text
flex / grid / block / hidden
relative / absolute / fixed / sticky
items-* / justify-* / grid-cols-* / col-span-*
w-* / h-* / min-* / max-* / overflow-* / gap-* / space-* / responsive variants
```

Business pages **must not** independently compose reusable governed appearance recipes from primitive typography, surface, elevation, or domain-status utilities when a semantic recipe, variant, or authoritative component owns that role. Do not recreate, with primitive utilities, a recipe that an authority already owns.

### Typography guidance

- Chinese font selection is intentional and centrally owned in `apps/web/src/index.css` (`--font-sans`). Agents must **not** introduce page-local `font-family` stacks.
- Agents must **not** invent one-off typography recipes in business pages. The semantic typography recipe layer (`apps/web/src/typography/recipes.css`) exists and owns governed font-size / weight / line-height combinations per role (`type-page-title`, `type-section-title`, `type-body`, `type-metric`, etc.). Select a recipe by name; do not recompose a role it owns from primitive text / font / leading / tracking utilities.
- Serif usage is restricted to explicitly approved reading roles; none are approved yet.

### Status authority

Domain status presentation must use the authoritative status mapping and components:

- `apps/web/src/lib/statusMeta.ts` — the status → tone authority.
- `apps/web/src/components/shared/StatusBadge.tsx` — the status presentation component.

Distinguish **domain status** (must flow through `statusMeta` + `StatusBadge`) from **generic UI feedback** (field errors, form-submit alerts, validation messages). Destructive / error colors remain valid for genuine field-error or alert feedback — this rule does not prohibit them there.

### Elevation guidance

Ordinary business content must **not** invent shadow-based elevation. Shadows are reserved for visual roles that intentionally own elevation — especially overlay / floating surfaces and the sticky topbar. This is a forward authority rule. The business-shadow baseline is empty, and any business-page `shadow-*` utility is a real, unshielded error. Elevation in ordinary content must come from an authoritative component primitive (e.g. the `Card` primitive, which owns `shadow-sm`) or be absent when the surface is flat (e.g. `surface-content`). Do not add `shadow-*` to business pages, and do not assume all current shadow usage is already compliant — `components/ui` (generated primitives) and `components/layout` (sticky topbar) are the only exempt scopes.

### Enforcement

Deterministic enforcement of the high-confidence boundaries above is provided by the `exam-ui/*` ESLint rules (see `apps/web/src/lint/exam-ui/`), wired as errors in `apps/web/eslint.config.ts` for business / feature / layout source.

**Active enforcement** (rules wired as errors today):

- `exam-ui/prefer-inline-error-banner` — a `<div role="alert">` carrying a rounded utility + multiple destructive-surface utilities must use `InlineErrorBanner` (narrowed in UI-MIGRATE-N-W2 to require `role="alert"`, which excludes destructive control-state/status surfaces that merely reuse the color).
- `exam-ui/no-business-shadow` — no `shadow-*` in ordinary business content. The business-shadow baseline is **empty** (UI-MIGRATE-N-W4B closed all 7 registered signatures: 28 redundant Card `shadow-sm` removed via the Card primitive authority, 1 TakeExam `shadow-sm` removed via the flat `surface-content` contract). The detector is variant-aware (W4B): it matches `shadow-sm`, `shadow-md/lg/xl/2xl`, variant-prefixed forms (`hover:shadow-md`, `md:shadow-lg`, `data-[state=open]:shadow-lg`, `group-hover:shadow-lg`), and the arbitrary-bracket form (`shadow-[0_2px_8px_…]`) via the shared bracket-aware candidate parser (RECON-1). `drop-shadow-*` (a CSS filter, not elevation) is NOT matched.
- `exam-ui/no-arbitrary-typography` — no new arbitrary typography values: `text-[…]` (font-size, excl. color), `leading-[…]`, `tracking-[…]`, `font-[…]` (weight/family), arbitrary-property forms (`[font-size:…]`, `[line-height:…]`, …), slash line-height modifiers, under all variant forms. Built on a shared bracket-aware Tailwind candidate parser (RECON-1). Text-color arbitrary values are OUT of policy here (color/token authority); ambiguous `var(--x)`/`calc()` are review-only.
- `exam-ui/no-arbitrary-inline-typography` — no one-off typography via inline `style={{fontSize/lineHeight/letterSpacing/fontWeight/fontFamily/…}}` (static literal values; dynamic is review-only). De-dups against the conflict rule.
- `exam-ui/no-typography-authority-conflict` — when a `type-*` recipe is selected on a JSX node, a sibling self-target utility (or inline-style key) that touches a recipe-OWNED property is a conflict (RECON-1). Semantic-free: the recipe class IS the declaration; no role inference. Cascade policy A (proven): unlayered recipes WIN over layered utilities, so a self-target owned-property utility is dead (or, with `!`, authority-piercing). Descendant/pseudo-element variants do not conflict; color participates (most recipes own `color`).

**Deferred enforcement** (semantic roles that still lack migration coverage or deterministic static detection):

- Broader typography recipes (`type-metric`, `type-body`, `type-secondary`, …) — authority exists, migration coverage does not (`StatsCard` has one consumer; ~20 metric bypasses unmigrated). Blocked on UI-PILOT-1 / UI-MIGRATE-N.
- Component-authority bypasses (`PageSection` vs `<Card><CardHeader>`, `StatsCard` vs `text-2xl font-bold`) — authority exists, migration coverage does not. Blocked on UI-PILOT-1 / UI-MIGRATE-N.
- Domain-status-color authority — authority exists (`statusMeta` + `StatusBadge`), but the bypass shape is dynamic-`className` / data-flow, not statically token-detectable without unacceptable false positives against categorical `<Badge>` labels. Enforced by review and migration, not by lint. The semantic-ownership boundary (which semantic domains `statusMeta` owns vs. which are distinct domains that merely reuse the `StatusTone` vocabulary) is documented in `docs/standards/ui-system.md` §Status color.
- Field-error authority (`FieldError`) — authority exists and is the canonical owner of "form field validation error", but the former `exam-ui/prefer-field-error` structural lint rule was **retired** in UI-FIELD-ERROR-AUTHORITY-CLOSURE-1 (§8): its recipe (`<p> + text-destructive + text-size`) could not deterministically distinguish FieldError ownership from DOMAIN_WARNING / CONTROL_STATE_FEEDBACK / INLINE_OPERATION_ERROR roles (4/4 remaining hits were false-semantic-overlap). All known same-role bypasses have been migrated; ownership is now enforced by semantic migration review + `FieldError.test.tsx`, not a structural lint proxy. Do **not** re-introduce a structural field-error lint rule without a proven deterministic ownership detector.
- `type-section-title` / `surface-content` recipe recomposition — authority exists and is canonical, but the structural lint proxies (`exam-ui/no-raw-typography`, `exam-ui/no-raw-surface-recipe`) were **retired** in UI-MIGRATE-N-W3 (§12-§13): after the proven same-role migrations every remaining hit was false-semantic-overlap (TOPBAR / QUESTION / RUNTIME / OVERLAY titles; SIDEBAR surface), and no sound NARROW AST boundary could distinguish the owner role from those distinct roles. All known same-role bypasses have been migrated; recipe/component ownership is enforced by semantic migration review + the recipe authority tests, not a structural lint proxy. Do **not** re-introduce these structural recipe lint rules without a proven deterministic ownership detector. (Note: RECON-1 added `exam-ui/no-typography-authority-conflict`, which is a DIFFERENT, sound rule — it fires only when a `type-*` recipe IS explicitly selected, so there is no role-inference surface. It does not replace the retired raw-node proxies, which remain retired.)

Do **not** claim that all typography or all surface recipes are lint-enforced — they are not. The wired ESLint config is the implementation fact; these docs must match it.

---

## Current Roadmap Authority

- **E2E is enabled and runs as blocking CI.** The `e2e` job in `.github/workflows/ci.yml` (sharded) gates every PR; the three named blocking specs (candidate-happy-path, resume-attempt, submit-flush) run and pass.
- **Phase 2 (Exam Operation) gate items are implemented** — proctor visibility/event-stream/polling/incident-logging, force-submit, extend-time, misconduct flag, attempt timeline, manual grading queue, retake policy, score strategy, diagnostics, result publishing, telemetry, and the candidate/admin permission boundary are in place. `timed_window` is the only timing mode.
- **Phase 3 is partially implemented.** The authorization *infrastructure* (permission catalog, role presets, scoped/scored capability resolvers, assignment-backed runtime authority, candidate/admin permission boundary) is live. The Phase 3 *product* work (scoped Teacher/Proctor/Grader role bundles as product roles, staff invitation, SMTP reset, account lifecycle UI, fill-blank/subjective runtime, WYSIWYG submit) is not done. See `docs/roadmap/phase3-open-items.md`.
- **Gate 0.5 (M10-F post-PR-197 rerun) is PENDING** — it blocks future RBAC-sensitive changes only.
- **Phase plans control implementation schedule.**
- **SPEC and `docs/roadmap/phase-roadmap.md` win over implementation details.**
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

### Documentation Reference (Historical / Archive)

The `docs/ui/` paths below were the Phase1.4 reference set. **That directory no longer exists** — these entries are retained as historical pointers only; archived copies may exist under `docs/archive/`. For current frontend visual authority, use the documents named in the "Frontend Visual Authority" section above (`docs/architecture/frontend.md`, `docs/standards/ui-system.md`, `docs/roadmap/ui-open-items.md`).

Historical Phase1.4 reference filenames (archive only, not current authority):

- `docs/ui/00-ui-constitution.md` — UI constitution and invariant principles
- `docs/ui/01-design-tokens.md` — CSS variables and Tailwind tokens
- `docs/ui/02-layout-system.md` — Shell, sidebar, topbar, and layout rules
- `docs/ui/03-component-boundaries.md` — Component layer boundaries
- `docs/ui/04-state-grammar.md` — Status grammar and central management
- `docs/ui/05-page-templates.md` — Page templates (list, detail, form, exam runtime)
- `docs/ui/06-accessibility-rules.md` — Accessibility rules
- `docs/ui/07-ui-bug-inventory.md` — Known UI bugs
- `docs/ui/08-migration-plan.md` — PR migration plan
- `docs/ui/09-phase2-readiness.md` — Phase2 documentation readiness

### Migration Plan (Historical / Archive)

The Phase1.4 migration plan below is retained for history. It references the now-archived `docs/ui/` set; it is **not** the current UI foundation sequence. The current authority is `docs/architecture/frontend.md` + `docs/standards/ui-system.md`.

Historical Phase1.4 PR split:

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
