# Current UI Audit

> Audited: 2026-06-07

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

## Font Configuration

Currently no explicit font-family declaration in `index.css`. The system relies on browser defaults for Chinese text rendering. This should be configured intentionally.

## Responsive Support

Exam system is desktop-first. Current code has basic responsive patterns but no mobile-first design. Phase 1 targets minimum 1024px width for exam interface.

## Accessibility

Some components have aria attributes (Dialog, AlertDialog). No systematic accessibility audit has been done. Keyboard shortcuts for exam pages are partially implemented.
