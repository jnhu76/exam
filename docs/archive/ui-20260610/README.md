# UI Documentation

## Current UI Refactor Goal

Make the exam platform look like a clean, stable administrative tool — not a SaaS marketing page. The visual target is a well-organized government/enterprise internal system: readable, predictable, low-noise, and fully offline-capable.

## Document Structure

| File | Purpose |
|------|---------|
| `00-ui-principles.md` | UI design principles and forbidden patterns |
| `01-current-ui-audit.md` | Current UI status audit |
| `02-design-tokens.md` | Colors, typography, spacing, radius, shadows |
| `03-tech-stack.md` | Frontend tech stack with documentation references |
| `04-layout-navigation.md` | Sidebar, topbar, page shell layout rules |
| `05-component-inventory.md` | Full component list with status and ownership |
| `06-page-migration-plan.md` | Page-by-page migration order and status |
| `07-local-first-static-build.md` | Offline/local deployment requirements |
| `08-accessibility-readability.md` | Readability and accessibility standards |

## Source of Truth

The following documents are the current source of truth:

- `docs/ui/00-ui-principles.md`
- `docs/ui/02-design-tokens.md`
- `docs/ui/04-layout-navigation.md`
- `docs/ui/05-component-inventory.md`
- `docs/ui/jobs/*.md`

## Historical Reference

`docs/ui/archive/phase1-ui-design-archived.md` is the original Phase 1 UI planning document. It contains useful wireframes and interaction patterns, but should not be treated as the sole implementation spec. If it conflicts with current docs or job files, the current docs win.

## Job Execution Order

| Job | Branch | Description |
|-----|--------|-------------|
| J00 | `chore/ui-audit-plan` | Audit and plan (no code changes) |
| J01 | `feat/ui-foundation` | Tailwind tokens, shadcn setup, font, icons |
| J02 | `feat/ui-shell-layout` | AppSidebar, AppTopbar, PageShell |
| J03 | `feat/ui-dashboard-candidates` | Dashboard + candidate management as visual reference |
| J04 | `feat/ui-core-admin-pages` | Exam, question, score, user, org, settings pages |
| J05 | `feat/ui-exam-client-pages` | Candidate-facing exam list, start, take, result |
| J06 | `chore/ui-local-build-qa` | Local-first QA, build verification, accessibility |

## Rules for UI Branches

1. Read the corresponding job file before starting work.
2. Only modify files within the job's allowed scope.
3. Do not make opportunistic improvements outside the job scope.
4. Update the job status when the branch is complete.
5. Record verification commands and results in the job file.
6. If the job scope is insufficient, update the job file first — do not silently expand scope.
