# Frontend UI System Replan

**Date:** 2026-06-15
**Scope:** PR-UI-0 plan only
**Input authority:** `docs/ui/frontend-ui-audit-report.md`

## Executive summary

The frontend already has a usable shadcn/ui + Tailwind v4 foundation: configured shadcn primitives, CSS variables, and a real `components/shared/` layer. The next step is not a broad rewrite, a new UI library, or a generic CRUD framework.

Revised direction:

1. Recalibrate visual direction before token cleanup.
2. Define narrow shared component contracts before page migrations.
3. Pilot on a low-risk Admin page before migrating larger CRUD pages.
4. Migrate page by page with dev server visual QA.
5. Keep Exam Runtime separate from Admin CRUD migration.

PR-UI-0 must not modify product code.

## Document authority reset

| Source | Authority | Use |
|---|---:|---|
| `docs/ui/frontend-ui-audit-report.md` | High | Current factual audit source for shadcn adoption, component inventory, CRUD repetition, and page risk. |
| This document | High | Execution plan, sequencing, constraints, and guardrails. |
| Older / archived UI docs | None for current visual direction | Historical archive only; do not use as current visual authority. |
| `docs/SPEC.md` | Highest | Product invariants and Phase 1 boundaries win. |
| `docs/phase-roadmap.md` | Highest | Phase 1 remains Admin + Candidate only. |
| shadcn/ui docs | High technical | shadcn primitives are project source components composed with Tailwind CSS variables. |

## Re-evaluation of audit recommendations

| Report recommendation | Decision | Reason | Revised action |
|---|---|---|---|
| Continue shadcn/ui | Keep | Already configured and used. | No UI library migration. |
| Keep Tailwind v4 + CSS variables | Keep | Matches current setup. | Tailwind remains token/layout/state styling language. |
| `components/ui/` as primitives | Keep | Correct shadcn boundary. | Keep app wrappers out of `components/ui/`. |
| `components/shared/` for reusable project components | Keep | Existing shared layer is useful. | Continue here for project-level components. |
| Replace hardcoded colors immediately | Modify | Current color direction is not validated. | Recalibrate first, then token cleanup. |
| Keep current colors | Reject | Current colors are inputs, not final truth. | Reassess color direction. |
| Add shadow/radius tokens early | Modify | Useful after density/elevation decisions. | Include after visual calibration. |
| Create `AdminDataTable<T>` early | Modify | Premature generic CRUD risk. | Start with narrow table shell, toolbar, pagination, row-action contracts. |
| Create `useAdminList` early | Reject for now | Risks hiding page-specific business behavior. | Keep page logic local until repeated behavior is proven. |
| Start with `CandidatesPage` | Modify | High value but higher risk. | Start with `UsersPage`; migrate `CandidatesPage` second. |
| Add Command / Calendar / Popover / Combobox early | Modify | Add only when a real page needs them. | No baseline component shopping. |
| Standardize Exam Runtime | Keep later | Runtime has exam invariants. | Separate PR after Admin patterns stabilize. |
| Avoid broad rewrite | Keep | Reduces regression risk. | Page-by-page migration only. |

## Why component-first is valid now

The audit shows enough foundation to proceed component-first:

- shadcn/ui is already installed and used by key pages.
- Core primitives already exist: Button, Input, Label, Card, Table, Dialog, AlertDialog, Sheet, DropdownMenu, Select, Badge, Pagination, Skeleton, Alert, Sonner, Tooltip, Separator, Checkbox, RadioGroup, Textarea, Form, Avatar, Switch, Tabs.
- Shared components already exist: PageHeader, EmptyState, LoadingState, ErrorState, ConfirmDialog, StatusBadge, DataTableShell, DataToolbar, FieldGroup, FormSection, PageSection, StatsCard, ErrorBoundary.
- CRUD repetition is real across Candidates, Users, Course, Question, and Exam pages.

The goal is to tighten the existing system with small contracts and verified migrations.

## What component-first must not become

Do not create:

- `ResourcePage<T>`
- one universal CRUD framework
- a large generic `AdminDataTable<T>` before page evidence exists
- generic form engines that hide page-specific validation
- shared hooks that own API calls or business decisions too early
- abstractions that make simple pages harder to read

Extract small stable UI contracts first; promote only after reuse is proven.

## Color recalibration plan

Current colors are audit inputs, not final decisions.

| Goal | Meaning |
|---|---|
| Serious | Suitable for LAN/on-premise exams and internal assessment workflows. |
| Clear | Primary, destructive, and status actions are unambiguous. |
| Calm | Avoid noisy color usage in dense admin pages. |
| Generic | Avoid school-only or student-only visual assumptions. |
| Accessible | Preserve contrast, focus visibility, and state clarity. |

| Category | Current input | Recalibration action | Output |
|---|---|---|---|
| Background / surface | `#f7f8fb`, `#ffffff`, `#f9fafb` | Check page density and table readability. | Confirm or adjust neutral scale. |
| Primary | `#2563eb` | Test saturation and action hierarchy. | Final primary / hover / soft tokens. |
| Sidebar | `#102a43`, `#1f4e79` | Reassess contrast, active state, collapse state, brand neutrality. | Final sidebar token set. |
| Destructive | `#b42318` | Ensure destructive hierarchy without red overuse. | Final destructive / soft tokens. |
| Success / warning / info | Current semantic colors | Validate badge readability and noise level. | Final semantic state tokens. |
| Radius / shadow | Partial or missing | Decide density and elevation after screenshots. | Minimal radius/shadow token set. |

PR-UI-1 acceptance:

- Dev server visual comparison covers representative Admin and Candidate pages.
- Color changes use semantic tokens, not raw one-off colors.
- Hardcoded color cleanup happens only after direction is chosen.
- No business logic changes.

## Shared component contract plan

| Component route | Layer | Purpose | First validation | Rule |
|---|---|---|---|---|
| `components/ui/*` | shadcn primitive | Copied primitive components. | Existing usage | Keep project wrappers out. |
| `components/shared/SearchInput.tsx` | project | Search + clear action spacing. | `UsersPage` | Promote after reuse. |
| `components/shared/ListToolbar.tsx` or `DataToolbar` extension | project | Search, filters, primary action layout. | `UsersPage` | No data ownership. |
| `components/shared/DataTablePagination.tsx` | project | Pagination presentation. | `QuestionPage` or first paged list | Callbacks only. |
| `components/shared/RowActions.tsx` | project | Row action spacing and variants. | `UsersPage` | No hidden permissions. |
| `components/shared/ConfirmActionDialog.tsx` | project | Sensitive/destructive confirmation. | `UsersPage` | Build on existing `ConfirmDialog`. |
| `components/shared/FormStack.tsx` / `FieldStack.tsx` | project | Dialog form spacing. | `UsersPage` | Layout only. |
| `components/shared/AdminTableShell.tsx` | project, later | Thin table shell. | After 2 pages | Not generic CRUD. |

Business components not promoted:

| Pattern | Keep local because |
|---|---|
| Candidate import workflow | Candidate-specific import semantics. |
| Candidate field configuration | Tied to configurable identity fields. |
| Exam timer / answer save UI | Exam runtime invariants are business-critical. |
| Question renderer and inputs | Domain-specific question behavior. |
| Exam publish / lifecycle actions | Must stay aligned with state machine. |
| Settings forms | Deployment settings and validation differ. |

## Page-by-page migration strategy

| Page | Pros | Risks | Decision |
|---|---|---|---|
| `UsersPage` | Smaller, low risk, enough CRUD/search/dialog/action patterns. | Does not cover import or complex filters. | First pilot. |
| `CandidatesPage` | Highest value, covers import/status/toggle/identity fields. | Larger and higher regression risk. | Second migration. |
| `CoursePage` | Moderate CRUD complexity, low risk. | Less pagination/filter coverage. | Third or near Candidates. |
| `QuestionPage` | Filters, pagination, tags, type badges. | More page-specific behavior. | Later after list contracts stabilize. |
| `ExamPage` | Status/action page. | State transitions must not be blurred. | Later with strict state-machine boundary. |
| `SettingsPage` | Good form standardization target. | Not CRUD. | Separate form-pattern PR. |
| Exam Runtime pages | Important visual consistency. | Must not affect save/timer/heartbeat/submit. | Separate runtime pass. |

Rules:

- One page or one tightly related pair per PR.
- Preserve API calls, data shape, permissions, routes, and visible behavior unless scoped.
- Move repeated JSX before moving business logic.
- Keep pages as route-level composition.
- Every migrated page must be checked in the dev server.

## Dev server visual QA loop

Every UI migration PR must include:

- Dev server starts.
- Target page loads without blank screen.
- No new browser console runtime errors.
- Main action is visually clear.
- Secondary actions are less prominent.
- Destructive actions use destructive styling and confirmation when appropriate.
- Search/filter layout is aligned and not cramped.
- Table density and row actions are consistent.
- Empty/loading/error states render correctly.
- Dialogs/sheets have visible titles and accessible close/cancel actions.
- Keyboard focus is visible.
- Desktop responsive widths are acceptable.
- Focused tests and typecheck pass.

Suggested final verification per UI PR:

```bash
pnpm --filter @exam/web typecheck
pnpm --filter @exam/web exec vitest run
pnpm verify
```

## Revised PR sequence

| PR | Name | Scope | Likely files | Acceptance | Do not do |
|---|---|---|---|---|---|
| PR-UI-0 | Frontend UI System Replan | Plan only. | `docs/ui/frontend-ui-system-replan.md` | Document accepted. | No product code changes. |
| PR-UI-1 | Visual Direction Recalibration | Reassess color/sidebar/status/radius/shadow/density. | Docs and possibly `apps/web/src/index.css` if approved | Final token direction chosen. | Do not blindly preserve current colors. |
| PR-UI-2 | Shared Component Contract | Add/refine narrow shared UI contracts. | `components/shared/*` | Small presentation-focused components. | No universal CRUD framework or generic hooks. |
| PR-UI-3 | First Page Pilot: UsersPage | Apply contracts to one low-risk Admin CRUD page. | `UsersPage.tsx`, selected shared components | Visual QA and behavior preserved. | Do not touch Candidates import or exam logic. |
| PR-UI-4 | CandidatesPage Migration | Apply proven contracts to larger Candidate CRUD page. | `CandidatesPage.tsx`, shared components | Import/toggle/search/dialogs/errors still work. | Do not change candidate identity semantics. |
| PR-UI-5 | Course / Question Migration | Extend list/filter/pagination patterns. | `CoursePage.tsx`, `QuestionPage.tsx` | Behavior preserved. | Do not introduce generic data framework. |
| PR-UI-6 | Exam / Settings Admin Pass | Standardize remaining Admin pages and form layouts. | `ExamPage.tsx`, `SettingsPage.tsx` | State/settings behavior unchanged. | Do not mutate exam status directly. |
| PR-UI-7 | Exam Runtime Visual Pass | Align runtime pages while preserving TakeExam semantics. | `apps/web/src/pages/exam/*` | Save/timer/heartbeat/submit untouched. | No Phase 2 UI. |

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Tokenizing wrong colors | Locks in poor visual direction. | Recalibrate before token cleanup. |
| Premature generic CRUD abstraction | Hides page differences. | Start narrow and pilot one page. |
| Candidate page regression | Breaks import/identity workflows. | Migrate after UsersPage pilot. |
| Exam runtime regression | Could affect core exam reliability. | Separate runtime PR and forbid semantic changes. |
| Phase creep | Violates roadmap. | Keep Phase 1 Admin + Candidate only. |
| Visual QA skipped | UI can regress despite tests. | Require dev server visual QA. |
| shadcn primitives hand-edited into app wrappers | Harder future updates. | Keep wrappers in `components/shared/`. |

## Do-not-do list

- Do not modify product code in PR-UI-0.
- Do not migrate away from shadcn/ui.
- Do not add daisyUI, Ant Design, MUI, Chakra UI, or another UI framework.
- Do not create `ResourcePage<T>`.
- Do not create a large generic CRUD framework.
- Do not create `useAdminList` until repeated behavior is proven.
- Do not treat current colors as final without recalibration.
- Do not tokenize old visual mistakes.
- Do not batch-migrate all Admin pages.
- Do not mix Admin CRUD migration with Exam Runtime migration.
- Do not change API contracts, permissions, backend logic, exam state machine, answer save protocol, timers, heartbeat, or submit behavior.
- Do not expose Teacher, Proctor, SuperAdmin, organization switcher, organizationSlug login, or multiTenant UI.
- Do not add Phase 2-only UI.

## Immediate next PR prompt

```text
Implement PR-UI-1: Visual Direction Recalibration.

Inputs:
- Use docs/ui/frontend-ui-audit-report.md as the audit source.
- Use docs/ui/frontend-ui-system-replan.md as the execution plan.
- Do not use archived UI docs as current visual authority.

Scope:
- Reassess color, sidebar, semantic status, radius, shadow, and density direction.
- Use the dev server to inspect representative Admin and Candidate pages.
- Produce a small decision note with final token direction and examples.
- Only change CSS tokens if the direction is clear and low-risk.

Constraints:
- Keep shadcn/ui and Tailwind v4.
- Do not modify business logic, API contracts, permissions, backend logic, or exam state machine.
- Do not introduce SuperAdmin, Teacher, Proctor, multiTenant, organization switcher, or Phase 2-only UI.

Verification:
- Run focused visual QA.
- Run pnpm --filter @exam/web typecheck.
- Run pnpm --filter @exam/web exec vitest run if code changes.
- Run pnpm verify before completion if code changes are made.
```
