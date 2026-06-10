# Job 2: Client Scaffold (Layout + Routing + Shared Components)

## Goal

React Router layout shells, role-based sidebar, API client with auth, shared UI components — all using types from `@exam/domain` and `@exam/contracts`.

## Scope

- Three layout modes (login, admin, exam)
- Role-based sidebar navigation
- API client with auth cookie handling
- Auth context + useAuth hook
- Shared UI components (PageHeader, EmptyState, ConfirmDialog, StatsCard, ConnectionIndicator, SaveIndicator)
- Branding context with generic fallback display values

## Out of Scope

- Actual page content (J3+)
- Business logic
- API route implementations

## Dependencies

J0 (Infrastructure), J0.5 (Domain + Contracts — types for API client and auth context)

## Files to Create / Modify

- `apps/web/src/App.tsx`
- `apps/web/src/pages/LoginPage.tsx` (shell only)
- `apps/web/src/components/layout/AdminLayout.tsx`
- `apps/web/src/components/layout/ExamLayout.tsx`
- `apps/web/src/components/layout/AppSidebar.tsx`
- `apps/web/src/components/layout/BrandProvider.tsx`
- `apps/web/src/components/layout/BrandHeader.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/hooks/useAuth.ts`
- `apps/web/src/contexts/AuthContext.tsx`
- `apps/web/src/components/shared/PageHeader.tsx`
- `apps/web/src/components/shared/EmptyState.tsx`
- `apps/web/src/components/shared/ConfirmDialog.tsx`
- `apps/web/src/components/shared/StatsCard.tsx`
- `apps/web/src/components/shared/ConnectionIndicator.tsx`
- `apps/web/src/components/shared/SaveIndicator.tsx`

## Data Model Changes

None.

## API Contracts

Uses types from `@exam/contracts` for API client response types.

## UI Tasks

- Layout shells with correct routing (§2.1)
- Sidebar navigation with role-based visibility (§2.2)
- Shared component inventory (§4.2, §6)

## TDD Plan

- Visual verification for each layout mode
- API client smoke test against `/api/health`
- Auth context state transitions (null → user → null)

## Subtasks

- [ ] **2.1** React Router setup + layout shells
  - Acceptance: Three layout modes work: (1) `/login` → fullscreen login layout, no sidebar; (2) `/admin/*` → Sidebar + Header layout (w-56 default, collapsible to w-14); (3) `/exam/*` → candidate minimal layout (thin top header only). Unmatched routes redirect to `/login`.
  - Files: `apps/web/src/App.tsx`, `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/components/layout/AdminLayout.tsx`, `apps/web/src/components/layout/ExamLayout.tsx`
  - Verify: browser route switching — all three layouts render correctly with distinct chrome

- [ ] **2.2** Branding shell + AppSidebar component + role-based navigation
  - Acceptance: `BrandProvider` exposes `BrandingView` with generic fallback values before J4 connects the settings API; `BrandHeader` is reusable by login, sidebar, and candidate header. Sidebar navigation grouped into: 题库 (Question Bank), 考试 (Exams), 管理 (Management). "管理" group visible only to Admin role. "机构管理" (Organization Management) visible only to SuperAdmin. Bottom section shows current user name + logout button. Sidebar collapses to icon-only mode (w-14). Active route is highlighted.
  - Files: `apps/web/src/components/layout/BrandProvider.tsx`, `apps/web/src/components/layout/BrandHeader.tsx`, `apps/web/src/components/layout/AppSidebar.tsx`
  - Verify: login with different roles, confirm correct menu items visible/hidden

- [ ] **2.3** API client + error handling + toast
  - Acceptance: `api.get('/health')` returns parsed data. 401 responses auto-redirect to `/login`. Network errors trigger sonner toast notification. Cookies auto-attached to every request (credentials: include). Base URL reads from Vite env, defaults to empty (uses proxy). Response types use `@exam/contracts` inferred types.
  - Files: `apps/web/src/lib/api.ts`
  - Verify: render a component that calls `api.get('/api/health')` and displays result

- [ ] **2.4** Auth context + useAuth hook
  - Acceptance: `useAuth()` returns `{ user, login, logout, isLoading }`. `user` type from `@exam/domain` User type. `user` is `null` when not logged in. `login(username, password)` calls API and stores user in context, then redirects to appropriate dashboard. `logout()` clears session and redirects to `/login`. `isLoading` reflects async state during login/logout.
  - Files: `apps/web/src/hooks/useAuth.ts`, `apps/web/src/contexts/AuthContext.tsx`
  - Verify: render a component that calls `useAuth()` and prints current state

- [ ] **2.5** Shared UI components
  - Acceptance: All shared components render correctly with shadcn/ui base: (1) **PageHeader** — title string + right-side action slot (ReactNode); (2) **EmptyState** — icon + title + description + optional action button; (3) **ConfirmDialog** — wraps AlertDialog with title, description, confirm/cancel callbacks, destructive variant support; (4) **StatsCard** — large number + label subtitle, optional trend indicator; (5) **ConnectionIndicator** — 3-color dot (green=connected, yellow=degraded, red=offline) + status text; (6) **SaveIndicator** — states: "保存中..." (spinner) → "✓ 已保存" (green) / "⚠ 保存失败" (red).
  - Files: `apps/web/src/components/shared/*.tsx`
  - Verify: render each component in `App.tsx`, visually confirm correctness

## Acceptance Criteria

1. Three layout modes render correctly
2. Branding shell renders generic fallback values and sidebar shows/hides items based on role
3. API client attaches cookies and handles 401
4. Auth context manages user state
5. All 6 shared components render
6. No type imports from anywhere except `@exam/domain` and `@exam/contracts`
7. `pnpm typecheck` passes

## Verify Commands

```bash
pnpm --filter web dev
pnpm lint:copy
pnpm typecheck
pnpm lint
pnpm verify
```

## Review Checklist

- [ ] No duplicate type definitions — all from packages
- [ ] Layout routing matches phase1-ui-design.md §2.1
- [ ] Sidebar items match §2.2
- [ ] Shared components match §4.2 and §6
- [ ] Role-based visibility uses Role enum from `@exam/domain`
- [ ] No duplicate DTOs (types imported from `@exam/domain` or `@exam/contracts`)
- [ ] No `any` / `as any`
- [ ] No `console.log` (use logger in api, nothing in packages)
- [ ] No unnecessary new dependencies
- [ ] No hardcoded deployment-specific product copy (e.g., 校内/校园/大学/学生)
- [ ] `pnpm verify` passes
