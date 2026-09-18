# DESIGN.md — EXAM Admin Clarity System

> Project-owned visual authority for the EXAM frontend.
> Status: active.
> Dark mode is out of scope. Tailwind is the implementation substrate; semantic
> recipes and authoritative components are the product-facing visual language.

## Product character

EXAM is a bright, crisp, structured, data-oriented enterprise console. It is
high-density but readable, Chinese-first, operational rather than decorative,
and clear at browser zoom 100% and DPR 1.

The product must not use gradients, warm beige/bronze neutrals, pill-shaped
status everywhere, floating card grids, or shadow-based ordinary hierarchy.

## Authority chain

```text
semantic tokens
    → semantic recipes
    → authoritative components
    → business pages
```

Business pages own structural layout and responsive composition. They may not
recompose an appearance role already owned by a recipe or component, and they
may not redefine spatial semantics already owned by an archetype, authoritative
component contract, or shared mechanism — the normative boundary (what pages
may own, what they may not, and the promotion rule) is frozen in
[`docs/standards/ui-system.md`](docs/standards/ui-system.md)
§Spatial governance boundary.

## Token authority

All tokens live in `apps/web/src/index.css` `:root`. This table is the
document-of-record and MUST stay in sync with that file. Canvas is a very
light neutral grey so white content surfaces read as a distinct raised layer;
text roles use alpha-ink values over the surface; `text-muted` is the WCAG
body-text floor (≥4.5:1 on surface/canvas — gated by the axe
color-contrast baseline).

| Role | Value | Use |
| --- | --- | --- |
| canvas | `#f5f7fa` | application page behind business content |
| surface | `#ffffff` | cards, table shells, forms, toolbars |
| surface-subtle | `#f8fafc` | table headers, metadata strips, hover wells |
| surface-hover | `#f8fafc` | neutral hover state |
| surface-selected | `#eff6ff` | selected/info anchor |
| text | `rgba(0,0,0,0.88)` | primary text |
| text-secondary | `rgba(0,0,0,0.65)` | emphasized secondary text |
| text-muted | `#627287` | descriptions and metadata; ≥4.5:1 on surface/canvas |
| text-subtle | `rgba(0,0,0,0.25)` | non-essential decoration only |
| border (shell) | `#dfe3e8` | ordinary content boundary |
| border-strong (control) | `#d1d5db` | interactive boundary |
| border-header | `#e1e5ea` | table header bottom edge |
| border-divider / row | `#edf0f3` | internal separators |
| border-grid | `#f0f2f5` | weakest table per-cell grid line |
| primary | `#2563eb` | primary action and focus |
| primary-hover | `#1d4ed8` | primary hover |
| primary-active | `#1e40af` | primary pressed |
| primary-soft | `#eff6ff` | selected/info anchor |
| primary-soft-strong | `#dbeafe` | selected-row inset accent |
| primary-focus | `#93c5fd` | focus ring / outlines |
| danger | `#c8263c` | error feedback, destructive action (≥4.5:1 on canvas) |
| danger-hover | `#c41e33` | destructive hover |
| danger-soft | `#fdecef` | destructive soft surface |
| success | `#0e7a56` | correct/positive (≥4.5:1 on soft tints) |
| success-soft | `#e9f8f1` | positive soft surface |
| warning | `#8f560a` | caution (≥4.5:1 on soft tints) |
| warning-soft | `#fdf3e3` | caution soft surface |
| info | `#0e6dd9` | distinct from primary blue |
| info-soft | `#e8f1fd` | informational soft surface |
| table-header | `#f8fafc` | Koi header band fill |
| table-row-hover | `#f8fafc` | hovered row fill |
| table-row-focus | `#edf4ff` | focus-within row fill |
| table-row-selected | `#eff6ff` | selected row fill |
| action-hover | `#f8fafc` | row-action icon hover |
| table-action-rail | `#fbfcfd` | sticky right action rail surface |
| table-footer | `#fafbfc` | pagination band fill |
| status triples | neutral `#f4f6fa/#475467/#e4e8ee`, info `#e8f1fd/#0d64c4/#cfe0fa`, positive `#e9f8f1/#0e7a56/#bbe9d6`, caution `#fdf3e3/#8f560a/#f0dab2`, destructive `#fdecef/#c41e33/#f4c8cf` (bg/text/border) | StatusBadge tones AND the generic feedback tones (`data-feedback-tone`) |
| sidebar | `#fbfbfc` | light navigation chrome (`#181b21`-era dark rail is retired) |
| sidebar-hover | `#f4f5f7` | navigation hover |
| sidebar-active | `primary-soft` (`#eff6ff`) | navigation active (soft fill + primary accent) |
| sidebar-text | `text` | navigation text |
| sidebar-muted | `text-secondary` | inactive navigation text |

The danger/success/warning values above are the WCAG-driven runtime values
(the older `#dc2f45`/`#12936a`/`#c4770a` in earlier revisions failed the
documented contrast floors; see the index.css comments).

The canvas must be visibly distinct from business surfaces. Ordinary business
surfaces are white. A card must never look dirtier than the page behind it.

## Typography

The UI family is self-hosted `HarmonyOS Sans SC` (Regular/Medium/Bold faces =
weights 400/500/700, linked in `index.html`). `Noto Sans CJK SC` and the
OS-specific CJK families appear in the stack as resilient fallbacks only —
no Noto sans webfont is loaded. Weight 600 is forbidden because no 600 face
is loaded; `font-synthesis: none` is set on `body` so missing weights never
produce fuzzy synthetic bold. CJK 700 reads heavy/clunky at UI sizes, so
titles use 500 (medium); 700 is reserved for large numeric metrics only.

| Role | Contract |
| --- | --- |
| page title | 24/32, 500 |
| page description | 14/22, 400, muted |
| section title | 16/24, 500 |
| body | PENDING_VISUAL_A_B: `type-body`/`type-secondary` recipes are 14/22; the Tailwind `text-sm` token used by inputs/buttons currently renders 15/22.5 (current runtime, decision D2 open) |
| emphasized cell | 14/22, 500 |
| table header | PENDING_VISUAL_A_B: recipe renders 13/20/500 today (decision D4 open) |
| metadata | 12/18, 400, muted |
| metric | 28/34, 700, tabular numbers |
| button/label | follows `text-sm` → current runtime 15/22.5, 500 (bound to D2) |

Business pages select `type-*` recipes. They do not invent page-local font
families, arbitrary sizes, fractional typography, or opacity-weakened text.
Numeric scores, counts, durations, dates, and percentages use tabular numbers.

## Geometry and elevation

- Base radius: 8px. PENDING_VISUAL_A_B: the control family currently renders
  Buttons at 8px and Input/Select/Textarea at 6px (decision D3 open).
- Status radius: 6px.
- Spacing scale: 4, 8, 12, 16, 24, 32.
- Standard desktop control: 36px.
- Mobile direct-touch control: 44px.
- Table header: 44px (Question Management workbench uses an explicit compact
  density: 42px header, 44px minimum rows).
- Standard table row: 48px.
- Ordinary content has no shadow.
- Only overlays and the sticky topbar may own elevation. The floating-layer
  appearance (background/border/radius/elevation) is owned by the
  `surface-overlay` recipe family in `apps/web/src/surface/recipes.css`
  (see ui-system.md §Surface and elevation).

## Page containers

`PageContainer` owns all page widths. A page declares its container role
explicitly on the `PageContainer` it renders; layouts own only the responsive
gutter and never infer a container role from the URL.

| Role | Maximum | Use |
| --- | --- | --- |
| admin-standard | 1280px | dashboards and ordinary admin pages |
| admin-wide | 1536px | diagnostics and genuinely wide data |
| candidate | 896px | candidate-facing list, detail, and result pages |
| form | 896px | create/edit and focused forms |
| auth | 448px | authentication |
| exam-runtime | 1280px | task-focused candidate runtime |

The role vocabulary is closed. Containers are centered and full-width; the
surrounding layout owns the responsive gutter. Pages may not introduce
arbitrary per-page maximum widths.

## Component contracts

### PageHeader

One page title, optional description/status, and one action group. Desktop
aligns title left and actions right. Mobile stacks and gives direct actions
44px targets.

### Button

- `default` and compatibility alias `primary`: solid primary.
- `outline`/`secondary`: white surface with visible border.
- `ghost`: transparent contextual action.
- `destructive`: solid destructive action.
- `link`: text link.

One obvious primary action is expected where a page has a principal action.
Disabled state uses explicit surface/text colors, not opacity alone.

### Control disabled states

Two sanctioned patterns exist in the control family (policy in
ui-system.md §Disabled states): explicit semantic disabled colors
(Button, Input, SelectTrigger) and `disabled:opacity-50`
(Textarea, Checkbox, Switch). DESIGN explicitly mandates the first only for
Button and Input/Select; unifying the family is the deferred
VISUAL-DECISION-DISABLED-STATE choice. No third pattern may be introduced.

### Input and Select

White surface, strong border, 36px standard height, visible indigo
focus ring, readable placeholder, and explicit disabled state. Grey-on-grey
field composition is forbidden. Radius currently renders 6px via the control
recipe (PENDING_VISUAL_A_B, decision D3 — 6 vs 8).

### Card and content surface

White surface, 1px border, 8px radius, no ordinary shadow. Padding is owned by
the component or density role, not improvised per page.

### Admin toolbar

`DataToolbar` owns filter grouping, search, counts, reset/query controls, and
secondary actions. The toolbar is a white bordered surface with 8px radius,
coherent spacing, equal-height controls, and responsive wrapping. An empty
toolbar or a strip containing only a count is forbidden.

### Admin table shell

`DataTableShell` is mandatory for equivalent management tables. It owns the
complete outer boundary, optional title/description/count band, local overflow,
table area, and footer. Headers use `surface-subtle`, body rows use `surface`,
and row separators remain visible. Action columns are stable, right-aligned,
and use `RowActions` with accessible button targets.

### Status and feedback

`statusMeta.ts` owns domain status to tone. `StatusBadge` owns rendering.
Status badges are compact rectangles with 6px radius, 12/16 text, and soft
fills; height currently renders 22px (PENDING_VISUAL_A_B, decision D5 —
22 vs 24). Ordinary statuses are text-first; urgency/live statuses may show
an icon.

Generic repeated feedback meaning (saving / saved / warning / error /
destructive / informational chips, banners, timer wells) is NOT domain
status: it flows through the semantic feedback layer
(`data-feedback-tone`, `apps/web/src/feedback/recipes.css`), which reuses the
status-triple tokens — no page re-derives soft feedback colors from opacity
utilities.

### Statistics

`StatsCard` owns the KPI role: white bordered surface, compact padding, a
32×32 primary-soft icon anchor with visible border, muted label, and 28px metric.

### Icons

`AppIcon` is the single project entry point and owns the final size/stroke of
every icon it renders: badge/inline = 16px @ 1.5px physical stroke,
nav/metric = 20px @ 2px, large = 24px @ 2px, state = 32px @ 2px,
hero = 40px @ 2px (`absoluteStrokeWidth` always on). Integer dimensions and
layout coordinates where practical; no weak opacity; no scaled wrappers.
shadcn/Radix primitive-internal 16px icons carry a dedicated optical thinning
rule scoped to the primitive's own data-slots (`index.css`) — no broad global
selector may also catch AppIcon output. A different icon source may be
introduced only when unscaled DPR 1 crops prove a material gain.

## Responsive shell

The three-state shell remains authoritative:

- below `lg`: navigation drawer;
- `lg` to `xl`: compact rail;
- `xl` and above: full/collapsible sidebar.

No document-level horizontal overflow is allowed. Wide tables scroll locally.
Candidate exam runtime remains task-focused and does not inherit dense admin
table composition, but shares tokens, primitives, status, icons, and clarity.

Navigation shell continuity (current location stays discoverable while the
nav scrolls; the shell never changes shape when the route changes) is a
frozen contract: see `docs/standards/ui-system.md` §Navigation shell
continuity (NAV-1…NAV-6).

## Reference adaptation

Koi UI informs list-page discipline, search/filter grouping, table containment,
and operational density. Wegent informs clean technical surfaces and restrained
whitespace. Neither repository is a token source or component donor. EXAM owns
business semantics, Chinese typography, accessibility, and responsive behavior.

## Acceptance boundary

The system is not visually closed until identical before/after screenshots and
unscaled crops at browser zoom 100% demonstrate a materially brighter, clearer,
sharper, more structured, and more consistent product, followed by human visual
acceptance.
