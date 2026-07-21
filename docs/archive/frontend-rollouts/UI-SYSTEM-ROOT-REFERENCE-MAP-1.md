# UI-SYSTEM-ROOT-REFERENCE-MAP-1

Status: pinned and applied selectively  
Fetched: 2026-07-13T21:11:39+08:00

## Pinned repositories

| Reference | Branch | Commit | Local research path |
| --- | --- | --- | --- |
| Koi UI | `master` | `ef1ce4a46c017eb58808f11f7816fbdb8de90d61` | `/tmp/exam-ui-reference/koi-ui` |
| Wegent | `main` | `1a5e21c5c71ac92a2be2dbe7f14398902e04eb98` | `/tmp/exam-ui-reference/wegent` |

The repositories are research inputs only and are not vendored, linked, or required at runtime.

## Extracted evidence

| Concern | Source path | Observed context | EXAM decision |
| --- | --- | --- | --- |
| Dense data hierarchy | Koi `src/styles/element.scss` | Element table overrides preserve visible header/row hierarchy. | Adopt a subtle header fill, 44px header and 48px rows through the Table primitive. |
| Theme variables | Koi `src/styles/theme-vars.scss` | Borders and state variables are centrally governed. | Keep semantic CSS variables; do not copy Element variables. |
| Search grouping | Koi `src/components/KoiSearch/Index.vue` | Search fields/actions are composed as a connected control region. | Use `ListToolbar`/`DataToolbar`, not detached controls. |
| Table actions | Koi `src/components/KoiToolbar/Index.vue` and system list pages | Dense list actions occupy a stable toolbar/action region. | Use `RowActions` and right-aligned action cells. |
| Clean content surface | Wegent `frontend/src/app/globals.css` | Neutral canvas/surface vocabulary is centralized. | Use a cool canvas and white business surfaces, with stronger EXAM separation. |
| Primitive cards and controls | Wegent `frontend/src/components/ui/*` | Low-radius bordered primitives suit admin software. | Retain shadcn/Radix implementation and adopt the contextual geometry only. |

## Rejected copying

- Wegent's grey-on-white panel relationship was rejected outside its original context; EXAM uses `#f5f7fa` canvas under white cards.
- Wegent focus-outline removal was rejected. EXAM keeps keyboard-visible focus rings.
- Koi's Element Plus implementation and SCSS variable system were not copied; only density and hierarchy evidence informed project-owned React primitives.
- No reference product wording, branding, cloud dependency, remote asset, component implementation, or runtime package was introduced.

## Context7 findings

Official Tailwind CSS v4 documentation confirms that semantic aliases which reference other CSS variables belong in `@theme inline`. Official shadcn documentation confirms its CSS-variable theming model and Tailwind v4 inline token mapping. Official React documentation supports retaining native semantic controls and accessible names. These findings validated the existing substrate; they did not justify copying reference code.

## Final source-to-owner mapping

| Reference insight | Project-owned implementation |
| --- | --- |
| Cool neutral layer separation | `apps/web/src/index.css` tokens |
| Conventional primary hierarchy | `components/ui/button.tsx` |
| Bordered white fields | `components/ui/input.tsx`, `select.tsx` |
| Clean business cards | `components/ui/card.tsx` |
| Dense structured tables | `components/ui/table.tsx`, `DataTableShell.tsx` |
| Connected filters/counts | `DataToolbar.tsx`, `ListToolbar.tsx` |
| Stable row actions | `RowActions.tsx` |
| Semantic status presentation | `statusMeta.ts`, `StatusBadge.tsx` |
| Whole-pixel project icons | `AppIcon.tsx` |
