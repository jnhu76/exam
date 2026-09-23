# Visual Foundation — Authority Map and Frozen Contract

> Status: active. Issue #601 Step-1 closure (non-table foundation).
> This document is the Visual Foundation **index and decision record**. It does
> not duplicate mutable numbers: every fact names its owning authority, and the
> named authority wins. It must not grow into a second numerical authority.

## 0. Role of this document

Issue #601 originally proposed this file as a self-contained Phase-C numerical
contract (`01 Typography` … `15 Rendering`). The repository instead converged
its visual facts into governed authorities: `DESIGN.md` (product-facing token
and component authority), [`docs/standards/ui-system.md`](../standards/ui-system.md)
(system constraints and component-authority record), machine-readable
registries under `apps/web/src/`, and executable gates. This file therefore
records four things only:

1. **where each visual fact is governed** (§1 — the authority map);
2. **the frozen Phase-B/C decisions that have no other active home** (§2);
3. **Agent-facing MUST / SHOULD / MUST NOT rules** with their enforcers (§3);
4. **the Phase-F table boundary** intentionally left open by Step 1 (§4).

## 1. Authority map

A future agent must be able to answer each question below without consulting
Koi/Element Plus screenshots or archived research.

| Question | Authority |
| --- | --- |
| Where is typography governed? | `DESIGN.md` §Typography (role table) + `docs/standards/ui-system.md` §Typography recipes; machine registry `apps/web/src/typography/recipeRegistry.ts`; implementation `apps/web/src/typography/recipes.css` |
| Where is the font source / fallback contract governed? | `docs/standards/ui-system.md` §Fonts (bundled-source authority, fallback chain, allowed weights 400/500/700, `font-synthesis: none`); assets `apps/web/public/fonts/harmonyos-sans-sc/`; regeneration `scripts/fonts/bundled-font-sources.mjs`; gate `apps/web/src/docs/fontAuthority.test.ts` |
| Where are text/color roles governed? | Token source `apps/web/src/index.css` `:root` + `@theme inline`; document-of-record table `DESIGN.md` §Token authority; enforcement `scripts/check-token-bypass.mjs`, `scripts/check-raw-color-usage.mjs` |
| Where are surfaces/borders governed? | `apps/web/src/surface/recipes.css` + `docs/standards/ui-system.md` §Surface and elevation (elevation vocabulary) + `DESIGN.md` §Token authority (border roles) |
| Where is spacing governed? | `DESIGN.md` §Geometry and elevation (scale) + `docs/standards/ui-system.md` §Spatial governance boundary (who may own what); no semantic spacing-token layer exists by design |
| Where is radius governed? | `DESIGN.md` §Geometry and elevation (base 8, control family 6, status 6) implemented via `--radius` and `apps/web/src/control/recipes.css` |
| Where are icons governed? | `apps/web/src/components/shared/AppIcon.tsx` (single size/stroke entry, `data-app-icon` marker) + `docs/standards/ui-system.md` §Icons; gate `apps/web/src/components/shared/AppIconStrokeCascade.test.tsx`; direct-import ban for action icons `scripts/check-row-action-icons.mjs` |
| Where is component geometry governed? | The authoritative component/recipe for each family (see `docs/standards/ui-system.md` §Component authority), shadcn/Radix primitives in `apps/web/src/components/ui/`, recipes in `apps/web/src/{control,badge,feedback,table}/recipes.css`, dialog size vocabulary `docs/standards/ui-system.md` §Dialogs, control disabled-state policy §Disabled states (gate `apps/web/src/components/ui/primitiveContracts.test.tsx`) |
| Where are responsive/density rules governed? | Shell contract NAV-1…NAV-6 `docs/standards/ui-system.md` §Navigation shell continuity; page-width roles §Page geometry (`apps/web/src/components/shared/PageContainer.tsx`); density roles `apps/web/src/surface/density-vocabulary.ts`; table archetypes §Tables (non-table rules only) |
| Where are theme rules governed? | `DESIGN.md` header: **light-theme only; dark mode is out of scope.** No theme-switch surface exists |
| Where are accessibility rules governed? | `docs/standards/ui-system.md` §Accessibility + baseline checklist; gate `apps/e2e/e2e/a11y-baseline.spec.ts` (axe); contrast floors recorded in `DESIGN.md` §Token authority |
| Where is rendering/DPI policy governed? | §5 below (validation dimension, never a geometry input); historical evidence `docs/research/exam-582-visual-freeze/` |

## 2. Frozen decisions (Phase-B/C findings — active guidance)

Established by the #582/#601 visual campaigns and retained unchanged. Their
implementation owners are listed; do not re-tune them inside ordinary tasks.

- **Nested surfaces are allowed.** What makes "plates on plates" is same
  background + same border prominence + too-small padding/gap at successive
  nesting levels — not nesting itself.
- **Fewer borders is NOT a quality rule.** Hierarchy comes from the
  combination of color, border, spacing, and radius; the current border
  strategy (shell / control / header / divider / grid roles) is retained.
- **Ordinary business surfaces do not gain arbitrary shadows.** Elevation is a
  three-role vocabulary (`none` / `overlay` / `sticky`) owned by
  `docs/standards/ui-system.md` §Surface and elevation; enforcement
  `exam-ui/no-business-shadow`.
- **The current control geometry is retained**: the 36px desktop control
  family, 44px mobile direct-touch targets, 6px control radius.
- **The one-surface workbench composition is retained** (`DataWorkbench` —
  toolbar → table → footer as one continuous surface; shares every semantic
  authority with `DataTableShell`).
- **The primary brand color is retained** (`--primary #2563eb` and its
  hover/active/soft/focus family; owner `DESIGN.md` §Token authority).
- **Table optical facts frozen by #602** (body-row baseline 52px; header
  14/20/500; 44px/42px header bands) remain owned by
  `docs/standards/ui-system.md` §Tables and `apps/web/src/table/` recipes.
- **Representative adoption** is the dense admin table trio (users /
  questions / exams) on the `admin-dense` container role (#602).
- **Koi-UI and Element Plus are historical/reference evidence only** — never a
  token source, component donor, or authoring input (`DESIGN.md` §Reference
  adaptation). Representative pages must be reconstructible from this
  repository's tokens, recipes, primitives, compositions, and governance
  alone; that reconstructibility — not screenshot imitation — is the #601
  success condition.

## 3. Agent-facing rules

MUST / SHOULD / MUST NOT for any agent producing or reviewing UI in this
repository. Numbers live in the named authorities; these rules say where the
authority is and when a change needs an explicit decision.

### MUST NOT

- invent arbitrary font weights (600 does not exist in the loaded family; 700
  is recipe-owned metric emphasis only) — authority: `docs/standards/ui-system.md`
  §Fonts; gates: `exam-ui/no-heavy-font-weight`, `scripts/check-high-font-weight.mjs`;
- rely on a host OS font as the primary UI typography, or reintroduce a
  host `local()` font source ahead of the bundled WOFF2 — authority: §Fonts +
  `scripts/fonts/bundled-font-sources.mjs`; gate: `fontAuthority.test.ts`;
- define arbitrary SVG stroke widths or sizes outside `AppIcon` roles, or
  author CSS that claims AppIcon output — authority: `AppIcon.tsx`; gate:
  `AppIconStrokeCascade.test.tsx` (covers real primitive ancestry);
- invent arbitrary component heights, per-page max-widths, private
  breakpoints, or per-page table behavior — authority: `DESIGN.md` §Component
  contracts + `docs/standards/ui-system.md` §Spatial governance boundary /
  §Page geometry (review-enforced);
- use raw gray/blue palette utilities or hex/rgb literals where a semantic
  role exists — gates: `scripts/check-token-bypass.mjs`,
  `scripts/check-raw-color-usage.mjs`;
- repair visual hierarchy by blindly adding shadow, border, or font-weight,
  and never treat "fewer borders" as a quality rule — see §2;
- let a page invent visual rhythm or component geometry outside the authority
  chain (`semantic tokens → recipes → authoritative components → pages`) —
  authority: `DESIGN.md` §Authority chain; promotion rule in
  `docs/standards/ui-system.md` §Spatial governance boundary.

### SHOULD

- prefer extending the existing authoritative component/recipe for a role over
  creating a parallel one; propose promotion through the recurrence rule when
  a shared policy is missing;
- add a proportionate executable gate when a load-bearing rule currently
  exists only in prose.

**Explicit-exception rule (the #601 success criterion):** a page cannot
casually introduce a new visual rhythm or component geometry outside the
existing authority; when it must, the exception is declared and adjudicated in
an Issue, not absorbed silently into page-local classes.

## 4. Phase-F boundary (intentionally open)

The only #601 acceptance criteria not closed by Step 1 are table-first:

- table column semantics / allocator enforcement (heterogeneous
  column-minimum allocation, width-allocation and sizing algorithm);
- table overflow policy closure;
- narrow / normal / wide table fixtures;
- full Phase-F table behavioral verification and the table
  horizontal-scroll correctness campaign.

The #602 optical facts listed in §2 stay frozen meanwhile; Step 2 must not
re-open them either.

## 5. Rendering / DPI policy

- Component geometry is CSS-contract-driven. DPI, device pixel ratio, and OS
  display scaling are **validation dimensions only** — no page or component
  may key geometry off DPR.
- The standing validation matrix (Windows Chrome 100% / 125% / 150% / 200%,
  Edge 150%) was completed by the #582 campaign; evidence:
  `docs/research/exam-582-visual-freeze/`.
- Changes that touch **font-source authority** or **icon stroke ownership**
  require targeted native-Windows re-validation (bundled-font resolution for
  400/500/700; effective AppIcon stroke in pagination/dropdown paths; no
  typography/icon regression at 100% / 125% / 150%) without repeating the full
  campaign.
