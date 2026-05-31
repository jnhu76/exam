# Exam System - Agent Instructions

## Project Context

University **LAN exam system** deployed on-premise. Multi-tenant: each department/lab runs its own exams independently. Supports open-book quizzes and strict closed-book proctored exams. Auto-graded, instant results, "pass to proceed" API for external systems.

**Read `docs/SPEC.md` first** — that is the constitutional document. If your implementation conflicts with it, the spec wins.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + Vite + TypeScript + shadcn/ui + TailwindCSS v4 |
| Backend | Bun + ElysiaJS + TypeBox validation |
| Database | SQLite (dev) / PostgreSQL (prod) via Drizzle ORM |
| Auth | @elysiajs/jwt, HTTP-only cookies, Bun.password (argon2id) |
| Monorepo | Bun workspaces: `client/`, `server/`, `shared/` |

## Commands

```bash
bun install                          # install all workspaces
bun run --filter server dev          # start backend (port 3000)
bun run --filter client dev          # start frontend (port 5173, proxies /api -> :3000)
bun run dev                          # start both
```

*(Build/test/lint commands to be added as tooling is set up.)*

## Project Structure

```
client/src/
  components/ui/   # shadcn/ui components (generated, do not hand-edit)
  pages/           # route-level components
  lib/             # utilities, API client
  hooks/           # shared React hooks

server/src/
  routes/          # Elysia route handlers, one file per domain
  middleware/      # auth, rate-limit, exam-session guards
  plugins/         # Elysia plugins (CORS, JWT, security headers)
  db/              # Drizzle schema, migrations, connection

shared/src/
  types.ts         # domain types (User, Exam, Question, ExamPaper, etc.)
                   # this is the single source of truth for data shapes

desktop/           # Electron shell (Phase 2, not started)
docs/              # design documents
```

## Key Constraints

- **LAN-only deployment**: no cloud dependencies, no CDN, no external APIs
- **Offline-capable**: system must work when campus internet is down
- **Multi-tenant**: all tables have `organizationId`; queries must scope to tenant
- **Security is core**: exam system security is not optional — see SPEC.md §5
- **Server is time authority**: never trust client timestamps for exam logic
- **Question snapshot**: ExamPaper copies questions at creation time; QuestionBank edits don't affect existing papers
- **"Pass to proceed"**: external systems can query exam results via API (e.g., lab access control)
- **Candidate ≠ Student**: examinee identity is defined per-organization via `CandidateField`, not hardcoded

## Exam-Specific Gotchas

- Answers must be saved to server on every change (not just on submit)
- Exam timer is server-side; client countdown is cosmetic only
- IP-based exam room restriction — check `ExamRoom.ipRange` before allowing exam start
- Fill-blank grading has configurable matching (exact vs. keyword) — not just string equality
- Multi-select scoring: all-correct = full, partial = half, any-wrong = zero (configurable per exam)
- `standardAnswer` on Question is required for auto-grading; questions without it cannot be used in auto-graded exams
- Open-book vs closed-book is a spectrum — `Exam.mode` sets defaults, each strictness flag can be overridden independently
- ExamPaper has a `disrupted` state — client heartbeat timeout auto-triggers it; recovery restores answers + remaining time from server
- `lastActivityAt` on ExamPaper is the heartbeat field — server uses it to detect disconnected students
- Four timing modes (`timed_sync`, `timed_window`, `deadline`, `untimed`) are independent of open/closed book mode
- Queued entry (`requireQueue` + `batchSize` + `batchInterval`) prevents exam-start traffic spikes
- Degradation: system auto-switches between normal/power-save/extreme modes based on resource usage — no features disabled, only batching/frequency changes
- Candidate identity fields are per-organization (`CandidateField`), not global — import templates are dynamically generated

## Conventions

- Use path aliases: `@/` maps to `client/src/`, `@elysia/` plugins for server middleware
- Domain types live in `shared/src/types.ts` — import from `shared`, never redefine
- API routes: `server/src/routes/<domain>.ts` (e.g., `routes/exam.ts`, `routes/question.ts`)
- DB schema: `server/src/db/schema.ts` — Drizzle schema mirrors shared types
- All user-facing strings in Chinese (zh-CN), code and comments in English
- No comments in code unless asked
