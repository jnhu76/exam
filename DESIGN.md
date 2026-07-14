# DESIGN.md — EXAM Admin Clarity System

> Project-owned visual authority for the EXAM frontend.
> Status: active authority for `UI-SYSTEM-ROOT-CORRECTIVE-1`.
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
recompose an appearance role already owned by a recipe or component.

## Token authority

All tokens live in `apps/web/src/index.css` `:root`. This table is the
document-of-record and MUST stay in sync with that file. Canvas and surfaces
follow the Radix UI slate scale (cool-neutral, perceptually uniform); semantic
colors are perceptually uniform at mid-high lightness (L≈52-60%).

| Role | Value | Use |
| --- | --- | --- |
| canvas | `#fcfcfd` | application page behind business content |
| surface | `#ffffff` | cards, table shells, forms, toolbars |
| surface-subtle | `#f9f9fb` | table headers, metadata strips |
| surface-hover | `#f0f0f3` | neutral hover state |
| surface-selected | `#eaf2fd` | selected/info anchor |
| text | `#111827` | primary text |
| text-secondary | `#374151` | emphasized secondary text |
| text-muted | `#627287` | descriptions and metadata; ≥4.5:1 on canvas |
| text-subtle | `#94a3b8` | non-essential decoration only |
| border | `#dde2e8` | ordinary content boundary |
| border-strong | `#cdd6e2` | interactive boundary |
| primary | `#2563eb` | primary action and focus |
| primary-hover | `#1d4ed8` | primary hover |
| primary-active | `#1e40af` | primary pressed |
| primary-soft | `#eaf1ff` | selected/info anchor |
| danger | `#dc2f45` | error feedback, destructive action |
| success | `#12936a` | correct/positive |
| warning | `#c4770a` | caution |
| info | `#0e6dd9` | distinct from primary blue |
| sidebar | `#181b21` | persistent navigation |
| sidebar-hover | `#20242b` | navigation hover |
| sidebar-active | `#262a32` | navigation active (lighter than hover) |
| sidebar-text | `#f5f7fa` | active navigation text |
| sidebar-muted | `#aeb6c2` | inactive navigation text |

The canvas must be visibly distinct from business surfaces. Ordinary business
surfaces are white. A card must never look dirtier than the page behind it.

## Typography

The UI family is self-hosted `Noto Sans CJK SC`. Only intentional weights 400,
500, and 700 are allowed. Weight 600 is forbidden because no 600 face is loaded.

| Role | Contract |
| --- | --- |
| page title | 24/32, 700 |
| page description | 14/22, 400, muted |
| section title | 16/24, 700 |
| body | 14/22, 400 |
| emphasized cell | 14/22, 500 |
| table header | 14/20, 500, muted |
| metadata | 12/18, 400, muted |
| metric | 28/34, 700, tabular numbers |
| button/label | 14/20, 500 |

Business pages select `type-*` recipes. They do not invent page-local font
families, arbitrary sizes, fractional typography, or opacity-weakened text.
Numeric scores, counts, durations, dates, and percentages use tabular numbers.

## Geometry and elevation

- Base radius: 8px.
- Status radius: 6px.
- Spacing scale: 4, 8, 12, 16, 24, 32.
- Standard desktop control: 36px.
- Mobile direct-touch control: 44px.
- Table header: 44px.
- Standard table row: 48px.
- Ordinary content has no shadow.
- Only overlays and the sticky topbar may own elevation.

## Page containers

`PageContainer` owns all page widths.

| Role | Maximum | Use |
| --- | --- | --- |
| admin-standard | 1280px | dashboards and ordinary admin pages |
| admin-wide | 1536px | diagnostics and genuinely wide data |
| form | 896px | create/edit and focused forms |
| auth | 448px | authentication |
| exam-runtime | 1280px | task-focused candidate runtime |

Containers are centered and full-width with shell-owned responsive gutters.
Pages may not introduce arbitrary per-page maximum widths.

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

### Input and Select

White surface, strong border, 8px radius, 36px standard height, visible indigo
focus ring, readable placeholder, and explicit disabled state. Grey-on-grey
field composition is forbidden.

### Card and content surface

White surface, 1px border, 8px radius, no ordinary shadow. Padding is owned by
the component or density role, not improvised per page.

### Admin toolbar

`DataToolbar` and `ListToolbar` own filter grouping, search, counts, reset/query
controls, and secondary actions. The toolbar is a white bordered surface with
8px radius, coherent spacing, equal-height controls, and responsive wrapping.
An empty toolbar or a strip containing only a count is forbidden.

### Admin table shell

`DataTableShell` is mandatory for equivalent management tables. It owns the
complete outer boundary, optional title/description/count band, local overflow,
table area, and footer. Headers use `surface-subtle`, body rows use `surface`,
and row separators remain visible. Action columns are stable, right-aligned,
and use `RowActions` with accessible button targets.

### Status

`statusMeta.ts` owns domain status to tone. `StatusBadge` owns rendering. Status
badges are 24px-high compact rectangles with 6px radius, 12/16 text, and soft
fills. Ordinary statuses are text-first; urgency/live statuses may show an icon.

### Statistics

`StatsCard` owns the KPI role: white bordered surface, compact padding, a
32×32 primary-soft icon anchor with visible border, muted label, and 28px metric.

### Icons

`AppIcon` is the single project entry point. Governed small roles use integer
16px or 20px dimensions, integer layout coordinates where practical, 2px
absolute strokes, no weak opacity, and no scaled wrappers. A different icon
source may be introduced only when unscaled DPR 1 crops prove a material gain.

## Responsive shell

The three-state shell remains authoritative:

- below `lg`: navigation drawer;
- `lg` to `xl`: compact rail;
- `xl` and above: full/collapsible sidebar.

No document-level horizontal overflow is allowed. Wide tables scroll locally.
Candidate exam runtime remains task-focused and does not inherit dense admin
table composition, but shares tokens, primitives, status, icons, and clarity.

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
