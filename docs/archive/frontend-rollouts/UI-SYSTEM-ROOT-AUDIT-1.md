# UI-SYSTEM-ROOT-AUDIT-1

Status: implemented corrective baseline, pending final human visual acceptance  
Audit date: 2026-07-13  
Branch at audit start: `feat/ui-visual-fixes`  
HEAD at audit start: `ac8bce93677c4cbc353cd4bf3e0bafce9696a816`

## Root-cause verdict

The product had sound semantic building blocks, but an uncommitted Koi/Wegent pivot changed the lowest-level tokens and generated primitives without completing the authority chain. It inverted canvas and surface (`--bg: #ffffff`, `--surface: #f9f9f9`), demoted the default button to an outline, removed table-header separation, enlarged table padding, made statuses small rounded pills, and left equivalent list pages on different shells. Those changes compounded at runtime: cards appeared dirtier than the page, primary actions lost emphasis, sparse pages stretched without structure, and tables differed by route.

The corrective keeps the existing behavior, React architecture, shadcn/Radix accessibility, `AppIcon`, `statusMeta`, and semantic recipe model. It replaces the incomplete visual composition through shared owners.

## Git attribution and prior-change disposition

| Source | Disposition | Reason |
| --- | --- | --- |
| `fb26361` AppIcon authority | KEEP | One project icon entry point is the correct ownership boundary. |
| `3939633` dense status icon reduction | KEEP | Text-only ordinary statuses reduce dense-table noise. |
| `3d85e6e`, `6eb2967`, `4eda94c`, `f64dc75` Lucide refinements | KEEP / REWORK | Keep Lucide and role sizing; retain whole-pixel sizes and strengthen governed contexts. |
| Uncommitted token pivot | REWORK | Keep cool-neutral intent; restore canvas/surface ordering and final specified values. |
| Uncommitted default transparent button | REVERT | It destroyed conventional primary-action hierarchy. |
| Uncommitted input/select cleanup | REWORK | Keep clean fields; restore explicit boundary, focus and disabled states. |
| Uncommitted grey card treatment | REVERT | Business surfaces must be white above the canvas. |
| Uncommitted table header/padding changes | REVERT | Header hierarchy and admin density regressed. |
| Uncommitted pill status treatment | REVERT | Dense admin status requires compact rectangular geometry. |
| Page-local table/card compositions | REPLACE THROUGH SHARED OWNER | Equivalent list semantics now use `DataTableShell`, `Table`, `RowActions`, and `StatusBadge`. |
| Uncommitted pivot closeout/review/preview artifacts | REVERT | They claimed closure before runtime evidence and conflict with the final authority. |

## Ownership map

| Concern | Final owner |
| --- | --- |
| Global color, spacing aliases, font stack | `apps/web/src/index.css` |
| Product visual contract | `DESIGN.md` |
| Typography roles | `typography/recipeRegistry.ts` + `typography/recipes.css` |
| Buttons, inputs, selects, cards, badges, tables | `components/ui/*` primitives |
| Page width | `PageContainer` selected by layouts |
| Page heading and actions | `PageHeader` |
| List filter/search surfaces | `DataToolbar` / `ListToolbar` |
| Equivalent management tables | `DataTableShell` + `Table` |
| Table-row actions | `RowActions` |
| Metrics | `StatsCard` |
| Domain status | `statusMeta.ts` + `StatusBadge` |
| Product icons | `AppIcon` + Lucide |
| Navigation and breakpoints | `AdminLayout` + `AppSidebar` |
| Forms and dialogs | existing shared form roles + shadcn/Radix primitives |
| Loading/error/empty | `LoadingState`, `ErrorState`, `EmptyState` |

## Token audit

| Token | Pivot value | Final value | Finding / role |
| --- | --- | --- | --- |
| `--bg` | `#ffffff` | `#f5f7fa` | Was incorrectly the brightest layer; now page canvas. |
| `--surface` | `#f9f9f9` | `#ffffff` | Was dirtier than canvas; now dominant business surface. |
| `--surface-muted` / subtle | light grey | `#f8fafc` | Governed table header and section strip. |
| `--surface-hover` | light grey | `#f1f5f9` | Row/control hover only. |
| `--text` | near-black | `#111827` | Primary text. |
| `--text-secondary` | inconsistent alias | `#374151` | Strong supporting text. |
| `--text-muted` | `#6b7280` | `#627287` | Corrected from the baseline to pass 4.5:1 on the canvas. |
| `--text-subtle` | `#9ca3af` | `#94a3b8` | Placeholder/low-emphasis text. |
| `--border` | mixed | `#dfe3e8` | Ordinary boundary. |
| `--border-strong` | mixed | `#cbd5e1` | Inputs and stronger separation. |
| `--primary` | `#2563eb` | `#2563eb` | Kept; clear action blue. |
| `--primary-hover` | `#1d4ed8` | `#1d4ed8` | Kept. |
| `--primary-active` | incomplete | `#1e40af` | Added deterministic pressed state. |
| `--primary-soft` | `#eff6ff` | `#eff6ff` | Status/icon anchor only. |
| `--sidebar-*` | mixed neutral | `#17191d` / `#24272d` / `#3b82f6` | One dark navigation hierarchy. |
| success/warning/danger/info | semantic aliases | retained semantic families | Remain domain-state authority, not page decoration. |

## Page-family inventory

All admin routes receive their container from `AdminLayout`; all candidate routes retain the task-specific `ExamLayout`. `PH` = `PageHeader`, `DT` = `DataToolbar`/`ListToolbar`, `DTS` = `DataTableShell`, `RA` = `RowActions`, `SB` = `StatusBadge`, `AI` = `AppIcon`.

| Route | Family | Container | Header / toolbar | Data/card owner | Status / icon | Responsive behavior and resolved drift |
| --- | --- | --- | --- | --- | --- | --- |
| `/admin/dashboard` | Dashboard | standard | PH / page actions | StatsCard + DTS | SB / AI | 1→2→4 metrics; recent table now governed. |
| `/admin/users` | management list | standard | PH | DTS + RA | SB / AI | Local table overflow; sparse row no longer naked. |
| `/admin/candidates` | management list | standard | PH / DT | DTS + RA | SB / AI | Dynamic columns scroll locally; shared status. |
| `/admin/courses` | management list | standard | PH / ListToolbar | DTS + RA | categorical Badge / AI | Search/count connected to list; shared shell. |
| `/admin/questions` | management list | standard | PH / DT | DTS + RA | categorical Badge / AI | Filter/table structure unified. |
| `/admin/exams` | management list | standard | PH / DT | DTS + RA | SB / AI | Empty count strip removed; count belongs to shell. |
| `/admin/results` | management list | standard | PH | DTS + RA | SB / AI | Card-wrapped table duplication removed. |
| `/admin/exams/:id/scores` | dense result list | standard | PH / DT | StatsCard + DTS + RA | SB / AI | KPI and pagination use shared owners. |
| `/admin/grading-queue` | management list | standard | PH | DTS | SB / AI | Bare list normalized. |
| `/admin/audit-logs` | logs | standard | PH / DT | DTS | SB / AI | Detached filters and local border removed. |
| `/admin/import-logs` | logs | standard | PH / DT | DTS | SB / AI | Detached filters and bare table removed. |
| `/admin/system` | diagnostics | wide | PH | Card / Table | SB / AI | Explicit wide role; diagnostic density retained. |
| `/admin/settings` | form | form | PH | Card + shared fields | feedback roles / AI | Narrow readable form role; mobile actions full width. |
| `/admin/candidate-fields` | configuration | form | PH | DTS + dialogs | categorical Badge / AI | Configuration table now governed. |
| `/admin/questions/new` | form | form | PH | form sections | feedback roles / AI | Deterministic readable width. |
| `/admin/questions/:id/edit` | form | form | PH | form sections | feedback roles / AI | Deterministic readable width. |
| `/admin/questions/import` | form/workflow | form | PH | workflow cards/tables | feedback roles / AI | Embedded preview tables remain workflow-local. |
| `/admin/exams/new` | form | form | PH | form cards + embedded picker | SB / AI | Embedded tables are form internals, not list pages. |
| `/admin/exams/:id/edit` | form | form | PH | form cards + embedded picker | SB / AI | Same form width and embedded-table exception. |
| `/admin/exams/:id` | detail | standard | PH | PageSection/Card | SB / AI | Detail tables remain section-owned. |
| `/admin/attempts/:id` | detail | standard | PH | Card + detail table | SB / AI | Detail comparison is not a management-list bypass. |
| `/admin/grading-queue/:id` | grading detail | standard | PH | PageSection/form | SB / AI | Task-specific grading layout retained. |
| `/admin/exams/:id/proctor` | proctor | standard | PH | Card | SB / AI | Existing operational behavior retained. |
| `/admin/exams/:id/proctor/monitor` | proctor | standard | PH | Card/table | SB / AI | Operational layout retained; Phase 2 behavior not added. |
| `/login` | authentication | auth | BrandHeader | Card + shared fields | feedback roles / AI | 448px governed max, centered, 44px-safe mobile action. |
| `/exam/list` | candidate list | ExamLayout | candidate heading | Card | availability Badge / AI | Candidate semantic badges remain distinct from domain status. |
| `/exam/settings` | candidate form | ExamLayout | page heading | Card + fields | feedback roles / AI | Existing 2xl readable width retained. |
| `/exam/:examId/start` | candidate workflow | ExamLayout | page heading | Card | SB / AI | Existing 2xl task width retained. |
| `/exam/:attemptId/result` | candidate result | ExamLayout | page heading | Card/table | SB / AI | Existing 5xl result width retained. |
| `/exam/:attemptId/take` | exam runtime | runtime | runtime topbar | task panels | save/runtime roles / AI | Separate 7xl runtime boundary retained. |

## Primitive and density findings

- Default/primary is solid blue; outline and secondary are white bordered; ghost is contextual; destructive is explicit.
- Inputs/selects are 36px desktop controls with white surfaces, strong borders, visible focus rings and explicit disabled states.
- Cards are white, bordered, 8px radius, and do not add business-page shadows.
- Table headers are 44px on `surface-subtle`; ordinary rows target 48px with separators and local horizontal overflow.
- Status badges are 24px high rectangular soft badges, not 20px consumer pills.
- `StatsCard` owns a 32px icon anchor and fixed 28/34 metric recipe.
- Icon roles remain whole-pixel Lucide sizes. No CSS transform is used to sharpen icons.

## Embedded-table exceptions

Exam create/edit question pickers, question-import previews, exam-detail question lists, and attempt-detail comparisons are embedded workflow/detail structures. They share the `Table` primitive but intentionally do not claim management-list `DataTableShell` semantics. Dialog tables remain overlay-owned.

## Safety boundary

No API, database schema, repository, exam command, auth behavior, or business contract was changed. The dev `exam` database was queried only for evidence and was not reset or reseeded. `exam_test` was not seeded.
