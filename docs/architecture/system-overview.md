# System Overview

> Reconstructed from production code at the verified commit. Not a copy of any
> old phase plan.

```text
STATUS:          CURRENT
AUTHORITY:        Architecture
SCOPE:            Whole system: packages, runtimes, boundaries, tech stack
OWNER:            Architecture
BASELINE SYSTEM COMMIT:
                 e7af792815e8cf4bcff122a3d1d8db500b9d6eff (PR #197)
                 The codebase state this overview was reconstructed from.
LAST VERIFIED REPOSITORY COMMIT:
                 c0dde8f1c11d05e78cf9dfb871afd3bbdee6daa2
                 The baseline system commit is NOT the final verification
                 commit of the reorganized repository.
SUPERSEDES:       —
RELATED ADRS:     ADR-001, ADR-002, ADR-003, ADR-004, ADR-005, ADR-006, ADR-008
```

## 1. Shape

The exam platform is a pnpm-workspace monorepo that builds a single-tenant,
LAN / on-premise, offline-capable exam and assessment system. One deployment
represents one organization. The Phase 1 product path is **Admin + Candidate**
only; proctor authority actions, Teacher-like roles, and account lifecycle are
deferred (see `docs/roadmap/current.md`).

```text
apps/
  api/    Fastify 5 API (Node LTS, TypeScript, vitest) — sole runtime authority
  web/    React 19 + Vite + TypeScript + shadcn/ui + TailwindCSS v4
  (desktop/ is NOT started — see ADR-004)

packages/
  domain          domain types + errors + grading engine + enums (LEAF, no deps)
  contracts       Zod DTOs + API contracts (deps: domain + zod)
  db              PostgreSQL via Drizzle — schema + repositories + migrations
  auth            server-only auth infra: argon2 password, JWT session, tenantGuard
  authz           permission language + resolver (LEAF-shaped: deps only domain)
  exam-engine     exam runtime kernel: state machines, grading, timer, answer protocol
  import-export   zero-dependency CSV codec
```

External runtime stack (api only): `fastify`, `@fastify/{cookie,cors,jwt,rate-limit,sensible,static,swagger,swagger-ui}`, `fastify-plugin`, `fastify-type-provider-zod`, `drizzle-orm`, `postgres`, `ioredis`, `nodemailer`, `zod`. Web adds `react`, `react-dom`, `vite`, `tailwindcss v4`, `radix-ui`, `lucide-react`. No cloud, no CDN, no external API calls at runtime.

## 2. Dependency direction

```text
domain (leaf — no internal package deps, no fastify/react/drizzle)
   ↑
contracts (domain + zod; no fastify)
   ↑
db        (domain; drizzle + postgres; repository boundary — NO api/web deps)
authz     (domain only; permission language — no fastify/drizzle/react)
exam-engine (domain only; runtime kernel — no fastify/drizzle/react)
import-export (no internal deps; pure codec)
   ↑
apps/api   (fastify; consumes all packages; sole place fastify may appear)
apps/web   (react; consumes contracts + domain + authz; NEVER imports db)
```

Enforced boundaries (see `docs/code-quality.md` §6 and `pnpm lint:arch`):

- `packages/domain` may not depend on `fastify`, `react`, `drizzle-orm`, or any internal package.
- `packages/contracts` may not depend on `fastify`.
- `packages/exam-engine` may not depend on `fastify`.
- `fastify` may appear only in `apps/api`.
- `apps/web` may not import from `packages/db` directly.
- All repository access goes through `repo.method(ctx, …)` — bare `db.select()` in routes is forbidden.

## 3. Package roles (verified from code)

| Package | Role | Consumers | Notes |
|---------|------|-----------|-------|
| `domain` | Domain types, errors, enums, pure grading engine | api, web, db, contracts, auth, authz, exam-engine | Leaf. No framework deps. |
| `contracts` | Zod request/response DTOs, API message registry | api, web | Serializes the domain for the wire. No fastify. |
| `db` | Drizzle schema + repositories + migrations + seed | api | Repositories take `ctx`. Deep-import shape `./src/*` is legacy and slated for explicit-subpath cleanup (Wave 2). |
| `auth` | argon2 password hashing, JWT session, tenant guard | api (deep-imports); db seed scripts (devDependency only) | Barrel is `export {}` (dead). Merge into `apps/api` is conditional on a DB-seed dependency audit — see scan review §2.4. **Do not merge in Wave 1.** |
| `authz` | Permission catalog, role presets, resolver, system actor | api (runtime enforcement), web (UI capability checks) | Authority for "what permissions exist". Framework-agnostic. `legacyMap.ts` has zero external callers (Wave 2 cleanup). |
| `exam-engine` | Exam/enrollment/attempt state machines, commands, grading, timer, answer protocol, deadline reconciliation, lock seam | api | Framework-agnostic runtime kernel. `types.ts` is dead (Wave 1 mechanical delete). |
| `import-export` | CSV encode/decode codec | api (2 routes) | Zero internal deps. Provisional; future multi-runtime consumers possible. |

## 4. API shape

`apps/api/src/routes/` holds one file per domain aggregate, each with a
co-located test. Production route wiring goes through
`routes/registerApiRoutes.ts`. Domain route files include: `auth`, `candidate`,
`candidateField`, `course`, `question`, `exam`, `attempts.*` (candidate/admin/shared),
`enrollment`, `gradingQueue`, `proctorMonitoring`, `scores`, `export`, `audit`,
`reconciliation`, `clientEvents`, `roleAssignments`, `settings`, `system`,
`email`, `importLogs`, `user`.

`apps/api/src/authz/routeRegistry.ts` (1061 LOC) is **test-only metadata** — it
has zero production importers and is consumed by route-authorization
conformance tests. It is not runtime enforcement. It must not be deleted or
auto-generated blindly; see `docs/architecture/authorization.md`.

## 5. Web shape

React 19 + Vite + TypeScript. Route-level pages live in `apps/web/src/pages/`
(`admin/*` and `exam/*` for candidate runtime). Web imports only `@exam/contracts`,
`@exam/domain`, and `@exam/authz` — it never reaches into `db`, `auth`, or
`exam-engine`. Visual language authority lives in `docs/frontend/` (see index).

## 6. Persistence and time authority

- **PostgreSQL is the only supported database.** Drizzle ORM is the access layer.
  Three local databases keep dev / test / e2e isolated (`exam`, `exam_test`,
  `exam_e2e`); see `AGENTS.md` "Local Database Discipline".
- **The server is the time authority.** `fastify.now()` (from
  `apps/api/src/plugins/now.ts`) is the single runtime clock API; raw
  `new Date()` / SQL `now()` is banned in strict business zones (ADR-006,
  enforced by a structural test).
- **ExamAttempt is the core entity**, not ExamPaper. Question snapshots are
  copied at attempt creation; later QuestionBank edits do not affect existing
  attempts.

## 7. Deferred infrastructure (present but dormant)

- **Redis** — adapter, compose service, and diagnostics ping exist. **No
  production business path uses Redis.** Default deployment is disabled;
  activation is gated on the first approved Redis-backed slice (ADR-001).
- **Email** — full SMTP/outbox/retry plumbing exists under `apps/api/src/email/`
  but is gated off by default (`EMAIL_ENABLED=false`).
- **WebSocket / SSE** — not present; proctor dashboard uses HTTP polling
  (ADR-002).
- **Job queue** — not present; all work is synchronous / request-scoped
  (ADR-003).
- **Desktop / Electron** — `apps/desktop/` does not exist (ADR-004).
- **OCR** — not present.

See `docs/status/implementation-matrix.md` for the code-evidenced capability
status, and `docs/roadmap/current.md` for what is authorized next.
