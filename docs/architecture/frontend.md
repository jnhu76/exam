# Frontend Architecture

> Current as-built authority for the `apps/web` frontend. Describes what is
> implemented today, not future work. For UI visual-system constraints, see
> [`docs/standards/ui-system.md`](../standards/ui-system.md). Current UI product
> work is Issue-tracked via [`docs/roadmap/post-mvp-issues.md`](../roadmap/post-mvp-issues.md)
> (notably #305–#308); the former `ui-open-items` file is historical evidence only.

## Tech stack (frozen)

| Layer | Tech |
| --- | --- |
| Framework | React 19 (`react` / `react-dom` `^19.1.0`) |
| Build / dev server | Vite (`^8.0.16`) |
| Language | TypeScript (`^5.8.3`, strict) |
| Styling | TailwindCSS v4 (`^4.1.7`, CSS-only, no JS config; utility classes only) |
| Primitives | shadcn/ui (new-york style) on `radix-ui` (`^1.4.3`); `react-day-picker` for calendars |
| Icons | `lucide-react` (wrapped by `AppIcon`) |
| Toasts | `sonner` |
| i18n | `i18next` + `react-i18next` |
| Routing | `react-router` `^7.6.1` (`<BrowserRouter>` + `<Routes>`) |
| Class composition | `cn()` (clsx + tailwind-merge) |
| Path alias | `@/` → `apps/web/src/` |

The stack is frozen. Introducing Ant Design / MUI / Chakra / Headless UI or any
other component framework, or replacing Tailwind, is forbidden. See
[`docs/standards/ui-system.md`](../standards/ui-system.md) §Forbidden dependencies.

## Frontend package boundaries

`apps/web` declares **only** `@exam/contracts` and `@exam/domain` as workspace
dependencies. It **must not** import `@exam/db` or any server-side package — all
data access goes through the API client. Database access is repository-pattern
server-side (`repo.method(ctx, …)`).

## Application shell and layout boundary

There are **two layout boundaries**, both React components in
`apps/web/src/components/layout/`:

- `AdminLayout` (`/admin/*`) — the admin-console chrome.
- `ExamLayout` (`/exam/*`) — the candidate exam-runtime chrome.

The two layouts are distinct chrome surfaces; the candidate exam runtime is
task-focused and does not inherit the dense admin-table composition.

`AdminLayout` renders a sticky topbar that owns `shadow-xs` — the only
non-overlay elevation owner (excluded from the `exam-ui/no-business-shadow` rule
via the `layoutGlobs` config).

## Routing

React Router v7 nested layout routes (`apps/web/src/App.tsx`):

- `/login` → `LoginPage` (no layout).
- `/admin` → `<AdminLayout>` layout route; index (`AdminIndexRoute`, redirects by
  capability) plus child routes: `dashboard`, `system`, `settings`,
  `candidate-fields`, `users`, `candidates`, `courses`, `questions` (+ new/edit/import),
  `exams` (+ new/detail/edit/scores/proctor/monitor), `proctor`, `results`,
  `grading-queue` (+ detail), `audit-logs`, `import-logs`, `attempts/:id`, `*`.
- `/exam` → `<ExamLayout>` layout route; child routes: `list`, `settings`,
  `:examId/start`, `:attemptId/take`, `:attemptId/result`, `*`.
- `*` → redirect to `/login`.

`AdminIndexRoute` resolves `adminLandingPath(user)` and navigates there. Page
titles sync to `document.title` via `AppTitle`.

The root `App` wraps everything in `ErrorBoundary` → `BrowserRouter` →
`BrandProvider loadRemote` → `AuthProvider restoreSession` → `DateTimeProvider`
→ `AppTitle` + `AppRoutes` + `<Toaster>`.

## Responsive structure and spatial authority map

The admin shell is a **three-state** layout using the `lg` / `xl` boundaries:

- **below `lg`**: a navigation drawer (`Sheet`, reusing the same `SidebarContent`
  as the desktop rail); topbar trigger is a `lg:hidden` button.
- **`lg` to `xl`**: fixed compact desktop rail (`w-14`, 56px — no expanded
  state at this width).
- **`xl` and above**: full sidebar (`w-[232px]`), user-controlled collapse to
  the 56px rail.

No document-level horizontal overflow; wide tables scroll locally.
Management-list tables switch between the desktop table and a mobile card list
at `lg` (CSS-only, both representations derived from one column declaration);
other table archetypes keep local scroll at every width. The candidate
exam runtime shares tokens, primitives, status, icons, and clarity but stays
task-focused.

The normative contract for everything spatial lives in
[`docs/standards/ui-system.md`](../standards/ui-system.md) (§Spatial
governance boundary, §Page geometry, §Tables). Implementation ownership:

| Contract | Owning module (`apps/web/src/`) |
| --- | --- |
| page-root width, closed six-role vocabulary | `components/shared/PageContainer.tsx` (`roleClasses`; pages declare, layouts never infer from route) |
| table archetype + tier negotiation + mobile eligibility | `components/shared/DataTableShell.tsx` (`TableArchetype`, `negotiateTier`, `ARCHETYPE_TIER_BOUNDS`, `isMobileRepresentationAllowed`) |
| ordinary table-page surface composition | `DataTableShell` (title band / scroll frame / fades / hint / footer) |
| continuous workbench surface composition | `components/shared/DataWorkbench.tsx` (toolbar → table → footer as one shell; Question Management) |
| column role/overflow/priority + presenters | `components/shared/DataTableContract.tsx` (`ROLE_OVERFLOW`, `ROLE_ALLOWED_OVERFLOW`, `DataTableOverflowText`, `middleTruncate`) |
| viewport representation switch (the only owner of the table representation-switch `lg` policy) | `components/shared/ResponsiveRepresentation.tsx` |
| mobile card list + priority→slot derivation | `components/shared/MobileRecordList.tsx` (`deriveMobileCardFields`) / `MobileRecordCard.tsx` |
| container-overflow facts (the only ResizeObserver) | `hooks/useOverflowObservation.ts` (facts only — no tier/archetype/representation vocabulary) |
| physical column widths, tier floors, sticky context column | `table/recipes.css` (fixed layout + col width/min-width; `detail-comparison` sticky first child) |
| desktop table rendering | `components/shared/DesktopDataTable.tsx` (TanStack stays a row/header model — no column sizing) |

`DataTableShell` and `DataWorkbench` differ in **visual composition only**
(stack of bordered surfaces vs one continuous surface). They must share the
semantic authorities above — `DataWorkbench` imports tier negotiation and
mobile eligibility from `DataTableShell` and consumes the same
`ResponsiveRepresentation` + `useOverflowObservation`; forking a second
breakpoint, tier, or measurement policy is a governance violation.

Measurement order is fixed: `ResponsiveRepresentation` decides the
representation first (viewport); only the desktop branch enters table
measurement — overflow observation → tier negotiation → local scroll. Mobile
cards are siblings of, never descendants of, the measurement node, so they
cannot participate in overflow or tier decisions.

## API client boundary

- **Single HTTP client** in `apps/web/src/lib/api.ts` (`ApiError` + `request<T>`
  with get/post/patch/delete helpers). Supporting modules: `apiErrors.ts`, telemetry
  (`clientEvents.ts` / `clientEventBuffer.ts` / `clientSessionId.ts` /
  `sanitizeClientEvent.ts`), `download.ts`, `examTelemetry.ts`, `dateTime.ts`,
  `pageMeta.ts`, `routes.ts`, `logger.ts`.
- **Cookie-based auth.** Every request sets `credentials: "include"`. No
  `Authorization: Bearer` header, no client-side token storage.
- **401 handling.** On HTTP 401 the client calls a registered
  `navigateFn?.("/login")`. Error codes come from `@exam/contracts`
  (`isErrorCode`, `ErrorResponse`); known-code presentation resolves through
  Web i18n (C3 browser message authority) and the server compatibility
  message is only the unknown-code fallback.
- **Base URL** from `import.meta.env.VITE_API_BASE_URL`.

## Authentication and authorization projection

- **Auth context:** `AuthProvider restoreSession`
  (`apps/web/src/contexts/AuthContext.tsx`) exposes `useAuth()` → `{ user, … }`.
  `user` carries role + capability set.
- **Capability-derived shell nav.** `apps/web/src/lib/capabilities.ts` is the
  frontend UX authority. It is **UX-only**: hidden nav entries remain reachable
  by direct URL; the backend 403/404s them. `adminLandingPath(user)` resolves
  the first admin surface a principal may land on; nav grouping
  (Exams = Admin + Teacher; Grading queue = Admin + Grader; Results = Admin +
  Teacher; Proctor monitoring = Admin + Proctor) is derived from the
  **capability set**, not role labels. Role labels (`user.role`) are used only
  where the contract genuinely keys on role.

## State and data ownership

- **No global store library** (no zustand / redux / jotai). State is plain React:
  server state fetched via the API client and held in page/component state;
  cross-tree concerns use React Context providers (`AuthContext`,
  `DateTimeContext`, `BrandProvider`).
- **Exam runtime uses a reducer, not a store.**
  `apps/web/src/exam/transientReducer.ts` is the exam-runtime transient state
  machine.
- **`deriveTakeExamView` is a pure projection function**
  (`apps/web/src/exam/deriveTakeExamView.ts`):
  `deriveTakeExamView(snapshot: CandidateTakeSnapshot): TakeExamView`. The
  backend snapshot is the business truth source; this function never copies raw
  DB state and never invents business rules — it projects the snapshot's
  derived-capability fields (`isLocked`, `canSave`, `canSubmit`, `canResume`,
  `showResult`, `showAnswers`, `effectiveDeadline`, per-question `disabled`).
- **Answer protocol client** flows through the API client against the backend
  answer endpoints; the exam runtime composes `transientReducer` for optimistic
  UI with snapshot-derived truth. The answer protocol contract lives in
  `@exam/contracts`; the frontend never re-implements business rules.

## Page composition

Business pages (`apps/web/src/pages/admin/**`, `apps/web/src/pages/exam/**`) are
route-level components that compose **shared business components** from
`apps/web/src/components/shared/` plus shadcn primitives. Pages never hand-write
interaction state machines or focus traps — those come from Radix/shadcn
primitives. See [`docs/standards/ui-system.md`](../standards/ui-system.md)
§Component authority for the per-component role ownership.
