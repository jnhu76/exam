# Job 0: Infrastructure Setup

## Goal

Root monorepo, Fastify API server, React + Vite frontend, shadcn/ui component library — all wired up and verified.

## Scope

- pnpm workspace monorepo with all packages
- Fastify API server with health endpoint
- CORS + security headers
- React 19 + Vite + TailwindCSS v4 client
- Root dev script for concurrent frontend + backend
- shadcn/ui component library initialized

## Out of Scope

- Domain types (J0.5)
- Database setup (J1)
- Auth (J3)
- Any business logic

## Dependencies

None.

## Files to Create / Modify

- `pnpm-workspace.yaml`
- `package.json` (root)
- `turbo.json`
- `apps/web/package.json`, `apps/api/package.json`
- `packages/domain/package.json`, `packages/contracts/package.json`, `packages/db/package.json`, `packages/auth/package.json`, `packages/exam-engine/package.json`, `packages/import-export/package.json`
- `apps/api/src/server.ts`, `apps/api/tsconfig.json`
- `apps/api/src/plugins/cors.ts`, `apps/api/src/plugins/security.ts`
- `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/index.css`, `apps/web/vite.config.ts`
- `.env.example`
- `apps/web/components.json`, `apps/web/src/lib/utils.ts`, `apps/web/src/components/ui/*.tsx`

## Data Model Changes

None.

## API Contracts

- `GET /api/health` → `{ status: "ok" }`

## UI Tasks

None.

## TDD Plan

- Verify each subtask via curl / browser before marking done
- No unit tests in this job — infrastructure wiring only

## Subtasks

- [ ] **0.1** Root monorepo setup
  - Acceptance: `pnpm install` succeeds, all workspace packages resolve
  - Verify: `pnpm ls --depth 0`

- [ ] **0.2** Fastify API server entry
  - Acceptance: `pnpm --filter api dev` starts, `GET /api/health` returns `{ status: "ok" }`
  - Verify: `curl http://localhost:3000/api/health`

- [ ] **0.3** Fastify CORS + security headers plugin
  - Acceptance: CORS restrict to `localhost`, security headers present (`X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`)
  - Verify: `curl -I http://localhost:3000/api/health` shows headers

- [ ] **0.4** Client entry files + TailwindCSS v4
  - Acceptance: `pnpm --filter web dev` starts Vite, TailwindCSS utility classes work
  - Verify: browser `http://localhost:5173`, Tailwind classes render

- [ ] **0.5** Root dev script + .env.example
  - Acceptance: `pnpm dev` starts both frontend and backend concurrently; `.env.example` documents all required env vars (`DATABASE_URL`, `JWT_SECRET`, etc.)
  - Verify: `pnpm dev`, then browser `http://localhost:5173/api/health` proxies through

- [ ] **0.6** shadcn/ui initialization
  - Acceptance: shadcn/ui configured, all listed components installed and importable
  - Components: button, input, label, select, textarea, checkbox, radio-group, card, table, dialog, dropdown-menu, badge, tabs, separator, sonner, avatar, skeleton, alert, sheet, form, pagination, tooltip, alert-dialog, switch
  - Verify: render a `<Button>` + `<Card>` in `App.tsx`

## Acceptance Criteria

1. `pnpm install` succeeds with zero errors
2. `pnpm dev` starts both frontend (port 5173) and backend (port 3000)
3. `GET /api/health` returns `{ status: "ok" }`
4. Vite proxy forwards `/api` → `:3000`
5. CORS + security headers present
6. shadcn/ui components render

## Verify Commands

```bash
pnpm install
pnpm lint:copy
pnpm --filter api dev
pnpm --filter web dev
pnpm dev
curl http://localhost:3000/api/health
curl -I http://localhost:3000/api/health
```

## Review Checklist

- [ ] All workspace packages listed in pnpm-workspace.yaml
- [ ] No stale Bun/ElysiaJS references
- [ ] tsconfig paths configured correctly
- [ ] .env.example documents all required vars
- [ ] Proxy config in vite.config.ts forwards /api
- [ ] No duplicate DTOs (types imported from `@exam/domain` or `@exam/contracts`)
- [ ] No `any` / `as any`
- [ ] No `console.log` (use logger in api, nothing in packages)
- [ ] No unnecessary new dependencies
- [ ] No hardcoded deployment-specific product copy (e.g., 校内/校园/大学/学生)
- [ ] `pnpm verify` passes
