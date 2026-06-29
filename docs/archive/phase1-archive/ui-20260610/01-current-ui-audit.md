# Current UI Audit

> Audited: 2026-06-07
> Verified: 2026-06-07 (J00 codebase verification)

## Tech Stack

| Item | Current Value |
|------|--------------|
| Framework | React 19 |
| Build tool | Vite 6 |
| CSS framework | Tailwind CSS v4.1 |
| Component library | shadcn/ui (new-york style, neutral base) |
| Icon library | lucide-react 1.17 |
| State management | React hooks (no external store) |
| Form handling | react-hook-form + zod |
| Monorepo | pnpm workspace |
| UI package dir | `apps/web/` |

## What's Already Installed

### shadcn/ui components (24)

alert-dialog, alert, badge, button, card, checkbox, dialog, dropdown-menu,
form, input, label, pagination, radio-group, select, separator, sheet,
skeleton, sonner, switch, table, tabs, textarea, tooltip, avatar

### Layout components (5)

- `AdminLayout.tsx` — sidebar + topbar + main content
- `ExamLayout.tsx` — minimal header for candidate-facing pages
- `AppSidebar.tsx` — admin navigation sidebar
- `BrandProvider.tsx` — platform/org branding context
- `BrandHeader.tsx` — brand display component

### Custom business components

- `ImportWizard.tsx` — CSV import dialog
- `QuestionNav.tsx` — exam question navigation sidebar
- `ExamTimer.tsx` — countdown display
- `SaveIndicator.tsx` — answer save status
- `QuestionRenderer.tsx` — renders question by type during exam
- `EnrollmentPicker.tsx` — exam enrollment candidate picker
- `EmptyState.tsx` — standardized empty state with icon, title, description, action
- `ErrorState.tsx` — error state with CircleAlert icon and retry button
- `LoadingState.tsx` — spinner with label and aria-busy
- `ConfirmDialog.tsx` — AlertDialog wrapper with destructive variant
- `ConnectionIndicator.tsx` — connection status dot + label
- `FileUpload.tsx` — CSV file upload trigger
- `PageHeader.tsx` — page title + action area
- `StatsCard.tsx` — dashboard statistics card

### Missing components (not yet created)

- `StatusBadge` — pass/fail/pending status badges with semantic colors (J03)

## Current CSS Theme

Tailwind v4 with inline `@theme` block using oklch colors:

- Background: `oklch(0.9857 0 0)` — very light gray
- Foreground: `oklch(0.1455 0 0)` — near-black
- Primary: `oklch(0.6432 0.2045 264.6062)` — **default blue** (shadcn default)
- Destructive: `oklch(0.631 0.2081 25.3312)` — red
- Muted: `oklch(0.9618 0 0)` — light gray

## Observed UI Problems

| # | Problem | Severity |
|---|---------|----------|
| 1 | Primary color is default shadcn blue — looks generic, not intentional | Medium |
| 2 | Body text and icons are near-pure-black — harsh contrast, heavy feel | Medium |
| 3 | Icon stroke weight feels heavy at default size | Low |
| 4 | Sidebar active state is gray background only — lacks clear hierarchy | Medium |
| 5 | Topbar redundantly shows brand name already visible in sidebar | Low |
| 6 | No visual layering between page background and card content | Medium |
| 7 | Tables and cards lack consistent spacing/border conventions | Medium |
| 8 | Pages look like default component assembly, not a unified product | High |
| 9 | No `success` or `warning` semantic color tokens defined | Medium |
| 10 | Chinese font stack not explicitly configured — depends on browser default | Medium |
| 11 | ConnectionIndicator uses hardcoded `bg-green-500`/`bg-yellow-500`/`bg-red-500` instead of semantic tokens | Low |
| 12 | Missing pages in migration plan: CoursePage, AttemptDetailPage, ResultsOverviewPage, QuestionImportPage, ExamSettingsPage | Low |

## J00 Verification Findings

Codebase verification on 2026-06-07 confirmed:

- All 24 shadcn/ui components listed are present in `components/ui/`
- EmptyState, ErrorState, LoadingState, ConfirmDialog, ConnectionIndicator, FileUpload all exist (were previously marked as unknown)
- QuestionRenderer and EnrollmentPicker exist but were not in the original component inventory
- 5 pages were missing from the migration plan (now added)
- `index.css` uses oklch values matching the audit record — default shadcn blue confirmed
- No font-family declaration found in `index.css`

## Font Configuration

Currently no explicit font-family declaration in `index.css`. The system relies on browser defaults for Chinese text rendering. This should be configured intentionally.

## Responsive Support

Exam system is desktop-first. Current code has basic responsive patterns but no mobile-first design. Phase 1 targets minimum 1024px width for exam interface.

## Accessibility

Some components have aria attributes (Dialog, AlertDialog). No systematic accessibility audit has been done. Keyboard shortcuts for exam pages are partially implemented.
