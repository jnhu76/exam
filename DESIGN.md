# DESIGN.md — Quiet Graphite

> **Project-owned visual design authority for the EXAM frontend.**
> Status: **AUTHORITY (corrected by UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1).** This is the single
> source of truth for appearance. Tokens, typography recipes, surface recipes, and components must
> conform to it. Supersedes the directional recommendations in
> `docs/frontend/UI-VISUAL-DESIGN-AUDIT-1.md`.
>
> Direction: **Quiet Graphite** — calm, technical, precise, Chinese-first legible, warm-neutral
> without becoming beige, distinct from generic shadcn-blue admin templates.
>
> **Implementation status:** DESIGN AUTHORITY ONLY. No production code or CSS has been modified to
> produce this document. The migration of the live codebase is a separate, gated task
> (`UI-VISUAL-REFINE-1`, currently BLOCKED on reaudit).
>
> **Corrective-1 changes vs the original authority:** all `font-weight: 600` removed (only 400/500/700
> are loaded; 600 was never a real face); sidebar-group-label raised to 12px/500 (Chinese is allowed
> there, 11px is forbidden for Chinese); focus border WIDTH is now stable on every control (no focus-
> time border-width change, ever); ordinary control elevation removed (controls are flat);
> `elevation.control` token deleted; table state model fixed to ZEBRA + explicit row-hover/row-
> selected values; complete one-to-one status-key → tier mapping (no per-page semantic decisions);
> destructive-SOLID reduced to a narrow allowlist; `components:` front-matter added; `secondary`
> retired from disabled text (disabled text = `ink-muted`, AA on `disabled-surface`); small button
> height raised to 36px (no 32px interactive variant).

---

## Token (machine-readable)

```yaml
---
version: "1.1"
name: Quiet-Graphite
direction: warm-neutral canvas + graphite sidebar + scarce indigo accent
dark_theme: out-of-scope
weights_available: [400, 500, 700]   # the ONLY font weights the repo loads; 600 is forbidden
notes: |
  canvas, surface, hairline, ink, and the graphite sidebar are ONE warm-neutral temperature
  model (hue 30–43°). Indigo is the single scarce accent (primary actions + focus only). Link
  and informational use a distinct technical BLUE so primary indigo is not overloaded. All
  ordinary-text pairs meet WCAG AA (>=4.5). See DESIGN.md §Validation for the recomputed table.

colors:
  # --- warm-neutral canvas + content ---
  canvas:           "#faf9f7"   # app background (warm near-white, NOT beige)
  surface:          "#ffffff"   # cards / content surfaces
  surface-subtle:   "#f4f2ef"   # zebra rows, table-header band, read-only wells, disabled-surface
  surface-raised:   "#ffffff"   # raised == surface tint; elevation comes from shadow only

  # --- warm ink ladder (warm near-black, same temperature as canvas) ---
  ink:              "#1f1d1b"   # primary text
  ink-secondary:    "#3d3a36"   # section titles, emphasized secondary
  ink-muted:        "#6b6760"   # muted text AND disabled TEXT (AA on canvas/surface/subtle/disabled)
  ink-disabled:     "#8a857b"   # NON-TEXT DECORATIVE ONLY (glyphs/borders/ornaments; never text)

  # --- warm hairlines (NOT cool gray) ---
  hairline:         "#e6e2dc"   # default 1px border
  hairline-strong:  "#d3cec5"   # 2px emphasis, input border

  # --- indigo accent (scarce: primary actions + focus only) ---
  primary:          "#4f46e5"   # indigo-600
  primary-hover:    "#4338ca"   # indigo-700
  primary-active:   "#3730a3"   # indigo-800
  primary-soft:     "#eef0fb"   # pale indigo wash (primary chip bg)
  on-primary:       "#ffffff"

  # --- link (distinct technical BLUE, so primary stays scarce) ---
  link:             "#1d6fdb"
  link-hover:       "#1559b8"

  # --- focus + selection + row states ---
  focus:            "#4f46e5"   # == primary indigo (border color + ring color)
  selection:        "#eef0fb"   # == primary-soft bg for ::selection
  row-hover:        "#efe9df"   # warm; visibly differs from surface AND surface-subtle
  row-selected:     "#e8e1d3"   # warm; more prominent than hover; overrides zebra+hover by source order
  disabled-surface: "#f4f2ef"   # == surface-subtle

  # --- GRAPHITE sidebar (one temperature model with canvas) ---
  sidebar-canvas:   "#26241f"   # deep warm graphite
  sidebar-surface:  "#2e2c26"   # elevated sidebar element
  sidebar-hover:    "#38352e"   # nav hover
  sidebar-active:   "#4a4538"   # active nav (warm graphite-bronze; NOT indigo)
  sidebar-ink:      "#ece9e3"   # sidebar primary text
  sidebar-muted:    "#a8a299"   # inactive nav / group labels
  sidebar-hairline: "#3a372f"   # sidebar dividers

  # --- status tiers (5 levels; darkened 700-tones, raised-chroma soft fills) ---
  neutral:          "#6b6760"
  neutral-soft:     "#f1ede7"
  informational:    "#155bbf"   # technical blue (link family)
  informational-soft: "#e3edfb"
  positive:         "#047857"   # emerald-700
  positive-soft:    "#dcf5e9"
  caution:          "#b54708"   # amber-700
  caution-soft:     "#fdefd9"
  destructive:      "#b23a17"   # warm red-orange (text on soft)
  destructive-soft: "#fbddcf"
  destructive-solid: "#c2410c"  # SOLID allowed only per §8.3 allowlist (white text)
  on-destructive:   "#ffffff"

typography:
  family-ui: 'Noto Sans CJK SC, "Source Han Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  family-reading: 'Noto Serif SC, "Source Han Serif SC", "Songti SC", "SimSun", serif'
  family-mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
  # ONLY 400 regular, 500 medium, 700 bold are loaded. weight 600 is FORBIDDEN (no face exists).
  page-title:        { size: 24px, weight: 700, line-height: 32px, tracking: -0.01em, color: ink }
  page-description:  { size: 14px, weight: 400, line-height: 22px, tracking: 0,      color: ink-muted }
  section-title:     { size: 16px, weight: 700, line-height: 24px, tracking: 0,      color: ink }
  body:              { size: 14px, weight: 400, line-height: 22px, tracking: 0,      color: ink }
  secondary:         { size: 14px, weight: 400, line-height: 22px, tracking: 0,      color: ink-muted }
  metadata:          { size: 12px, weight: 400, line-height: 18px, tracking: 0,      color: ink-muted }
  table-header:      { size: 12px, weight: 500, line-height: 16px, tracking: 0.04em, transform: uppercase, color: ink-muted }
  table-cell:        { size: 14px, weight: 400, line-height: 20px, tracking: 0,      color: ink }
  label:             { size: 14px, weight: 500, line-height: 20px, tracking: 0,      color: ink }
  help-text:         { size: 12px, weight: 400, line-height: 18px, tracking: 0,      color: ink-muted }
  button:            { size: 14px, weight: 500, line-height: 20px, tracking: 0,      color: context }
  badge:             { size: 12px, weight: 500, line-height: 16px, tracking: 0,      color: tier-text }
  metric:            { size: 30px, weight: 700, line-height: 36px, tracking: -0.02em, color: ink, feature: tabular-nums }
  numeric:           { feature: tabular-nums }   # applied to ANY numeric: scores/counts/timers/%/durations/dates
  timer:             { size: 16px, weight: 700, line-height: 24px, tracking: -0.01em, color: ink, feature: tabular-nums }
  code:              { family: mono, size: 12px, weight: 400, line-height: 20px, color: ink-secondary }
  topbar-title:      { size: 14px, weight: 500, line-height: 20px, tracking: 0,      color: ink }  # INK, not muted
  sidebar-label:     { size: 14px, weight: 400, line-height: 20px, tracking: 0,      color: sidebar-muted }
  sidebar-label-active: { size: 14px, weight: 500, line-height: 20px, tracking: 0,   color: sidebar-ink }
  sidebar-group-label: { size: 12px, weight: 500, line-height: 16px, tracking: 0.06em, transform: uppercase, color: sidebar-muted }
  # NOTE on text-transform: uppercase affects ONLY the Latin portion of mixed CJK/Latin labels.
  #   It does NOT change Chinese glyphs (Chinese has no case). sidebar-group-label is 12px/500
  #   because Chinese IS permitted there; 11px is forbidden for any Chinese.

rounded:
  base:    8px   # cards, content surfaces, dialogs, the system radius (--radius)
  control: 8px   # inputs, selects, buttons — MATCH their container (no 6px controls)
  overlay: 8px   # popovers, dropdowns, sheets — same base
  chip:    6px   # status chips ONLY (compact rectangle; deliberately tighter than base)
  none:    0px
  # pill/full: RETIRED for status.

spacing:
  xxs: 4px
  xs:  8px
  sm:  12px
  md:  16px
  lg:  24px
  xl:  32px
  page-gutter: 24px      # main padding (32px at lg+)
  section-gap: 24px
  card-padding: 20px     # uniform internal card padding (header px-5 py-4; content p-5)
  table-cell-px: 12px
  table-cell-py: 8px
  control-height: 36px   # default AND small buttons share 36px (no 32px interactive variant)
  icon-size: 16px        # visual icon inside a control
  touch-min: 36px        # NO interactive target smaller than 36×36

elevation:
  flat:       "none"                                              # default for ALL content AND ordinary controls
  overlay:    "0 4px 6px -1px rgb(31 29 27 / 0.10), 0 2px 4px -2px rgb(31 29 27 / 0.10)"
  overlay-lg: "0 16px 48px rgb(31 29 27 / 0.12)"                  # dialogs/modals only
  # NOTE: elevation.control is REMOVED. Ordinary controls are flat (box-shadow: none).
  # FORBIDDEN: any shadow on ordinary business content or controls (enforced by exam-ui/no-business-shadow).

focus:
  border-width: 1px        # UNCHANGED on focus — never 2px, never changes at focus time
  border-color: primary    # indigo border on focus (destructive controls ALSO use indigo focus)
  ring: "0 0 0 3px rgb(79 70 229 / 0.25)"   # the ONLY focus ring; single alpha
  # invalid input: destructive 1px border (validation) + indigo ring (focus). See §5.5.

components:
  button-primary:     { background: primary, color: on-primary, border: "none", rounded: base, height: control-height, typography: button, hover-background: primary-hover, active-background: primary-active, focus: focus }
  button-secondary:   { background: surface, color: ink, border: "1px solid hairline", rounded: base, height: control-height, typography: button, hover-background: surface-subtle, focus: focus }
  button-ghost:       { background: transparent, color: ink, border: none, rounded: base, height: control-height, typography: button, hover-background: surface-subtle, focus: focus }
  button-destructive: { background: destructive-solid, color: on-destructive, border: none, rounded: base, height: control-height, typography: button, focus: focus }   # focus is INDIGO, not red
  button-icon:        { width: control-height, height: control-height, icon: icon-size, focus: focus }
  input:              { background: surface, color: ink, border: "1px solid hairline-strong", rounded: base, height: control-height, typography: body, placeholder-color: ink-muted, focus-border-color: focus, focus-border-width: 1px, focus-ring: focus.ring, invalid-border-color: destructive }
  select:             { ref: input, chevron-color: ink-muted, content-shadow: overlay, content-rounded: base }
  content-surface:    { background: surface, border: "1px solid hairline", rounded: base, shadow: flat }
  table:              { header-background: surface-subtle, header-typography: table-header, cell-typography: table-cell, cell-padding: "table-cell-px table-cell-py", row-height: 44px, row-separation: zebra, per-row-borders: none }
  table-header:       { background: surface-subtle, typography: table-header, border: none }
  table-row:          { background: transparent, hover-background: row-hover, selected-background: row-selected, per-row-border: none, zebra-alt-background: surface-subtle }
  status-neutral:            { background: neutral-soft, color: neutral, rounded: chip, typography: badge, shadow: flat, solid: false }
  status-informational:      { background: informational-soft, color: informational, rounded: chip, typography: badge, shadow: flat, solid: false }
  status-positive:           { background: positive-soft, color: positive, rounded: chip, typography: badge, shadow: flat, solid: false }
  status-caution:            { background: caution-soft, color: caution, rounded: chip, typography: badge, shadow: flat, solid: false }
  status-destructive-soft:   { background: destructive-soft, color: destructive, rounded: chip, typography: badge, shadow: flat, solid: false }
  status-destructive-solid:  { background: destructive-solid, color: on-destructive, rounded: chip, typography: badge, shadow: flat, solid: true }   # allowlist only — §8.3
  sidebar-item:        { background: transparent, color: sidebar-muted, hover-background: sidebar-hover, hover-color: sidebar-ink, rounded: base, height: 40px, typography: sidebar-label, focus: focus }
  sidebar-item-active: { background: sidebar-active, color: sidebar-ink, weight: 500, rounded: base, height: 40px, typography: sidebar-label-active }
  dialog:              { background: surface, border: "1px solid hairline", rounded: base, shadow: overlay-lg, footer-border-top: hairline, primary-action: right }
  popover:             { background: surface, border: "1px solid hairline", rounded: base, shadow: overlay }
---
```

---

## 1. Product visual intent

- **Atmosphere.** A quiet, warm-neutral admin tool with the precision of a developer console and the
  legibility of a reading app. Calm, not clinical; technical, not terminal. Density without noise.
- **Product character.** A serious examination platform — credible, restrained, instrument-like. The
  graphite sidebar signals "controlled environment"; the warm canvas signals "readable, not harsh."
- **Density.** High information density is allowed and expected (tables, diagnostics, proctoring),
  achieved through tight rhythm and tabular numerics, **never** through shrinking text below the
  type scale or stacking hairlines.
- **Contrast philosophy.** Body/ink is near-black (≥12:1) for snap; muted text clears AA-normal
  (≥4.5:1) on every background it appears on, including disabled-surface. Disabled TEXT uses
  `ink-muted` (not `ink-disabled`).
- **Chinese-first legibility.** Noto Sans CJK SC is the primary family on every platform (kept).
  **12px is the absolute floor for any Chinese text** — including sidebar group labels. 14px is the
  body floor.
- **Accent scarcity.** Indigo (`#4f46e5`) is reserved for **primary actions + focus only**. It does
  NOT own links, status badges, sidebar selection, or icons.
- **Must never resemble.** A generic shadcn-blue admin template; a beige/tan "vintage" UI; a
  terminal/ASCII aesthetic; a colorful marketing landing page; a dark-themed developer tool.

## 2. Exact color roles

> All values are FINAL. Temperature rule: canvas, surface, hairline, ink, AND the graphite sidebar
> are one warm-neutral model (hue 30–43°, low chroma). Every foreground/background pair is measured
> in §Validation.

| Role | Token | Value | Permitted for text? |
| --- | --- | --- | --- |
| canvas | `canvas` | `#faf9f7` | no (background) |
| surface | `surface` | `#ffffff` | no |
| surface-subtle | `surface-subtle` | `#f4f2ef` | no (zebra/header/disabled-surface) |
| surface-raised | `surface-raised` | `#ffffff` | no |
| ink | `ink` | `#1f1d1b` | **yes — primary text** |
| ink-secondary | `ink-secondary` | `#3d3a36` | **yes — section titles / emphasized** |
| ink-muted | `ink-muted` | `#6b6760` | **yes — secondary/metadata AND disabled TEXT (AA on all row/disabled bg)** |
| ink-disabled | `ink-disabled` | `#8a857b` | **NO — NON-TEXT DECORATIVE ONLY** (glyphs/borders/ornaments) |
| hairline | `hairline` | `#e6e2dc` | no (border) |
| hairline-strong | `hairline-strong` | `#d3cec5` | no (input border / 2px emphasis) |
| primary | `primary` | `#4f46e5` | yes (accent text on light; primary btn bg) |
| primary-hover / -active | `primary-hover`/`primary-active` | `#4338ca`/`#3730a3` | (states) |
| primary-soft | `primary-soft` | `#eef0fb` | no (chip bg) |
| on-primary | `on-primary` | `#ffffff` | yes (text on primary) |
| link / link-hover | `link`/`link-hover` | `#1d6fdb`/`#1559b8` | **yes — links (blue; ≠ indigo)** |
| focus | `focus` | `#4f46e5` | (border + ring color; == primary) |
| selection | `selection` | `#eef0fb` | no (::selection bg) |
| row-hover | `row-hover` | `#efe9df` | no (table row hover) |
| row-selected | `row-selected` | `#e8e1d3` | no (table row selected) |
| disabled-surface | `disabled-surface` | `#f4f2ef` | no |
| sidebar-canvas | `sidebar-canvas` | `#26241f` | no (graphite bg) |
| sidebar-surface / -hover | `sidebar-surface`/`sidebar-hover` | `#2e2c26`/`#38352e` | no |
| sidebar-active | `sidebar-active` | `#4a4538` | no (graphite-bronze, NOT indigo) |
| sidebar-ink | `sidebar-ink` | `#ece9e3` | **yes (on dark)** |
| sidebar-muted | `sidebar-muted` | `#a8a299` | **yes (on dark; AA 6.1:1)** |
| sidebar-hairline | `sidebar-hairline` | `#3a372f` | no |
| neutral | `neutral` / `neutral-soft` | `#6b6760` / `#f1ede7` | yes / no |
| informational | `informational` / `informational-soft` | `#155bbf` / `#e3edfb` | yes / no |
| positive | `positive` / `positive-soft` | `#047857` / `#dcf5e9` | yes / no |
| caution | `caution` / `caution-soft` | `#b54708` / `#fdefd9` | yes / no |
| destructive | `destructive` / `destructive-soft` | `#b23a17` / `#fbddcf` | yes (text on soft) / no |
| destructive-solid | `destructive-solid` | `#c2410c` | bg of the SOLID tier (allowlist §8.3) |
| on-destructive | `on-destructive` | `#ffffff` | yes (text on solid) |

**Disabled-state color rule (corrective):** disabled button/input/select/menu-item **text** uses
`ink-muted` (`#6b6760`) on `disabled-surface` (`#f4f2ef`) = **5.03:1, AA-normal**. `ink-disabled`
(`#8a857b`) is restricted to **non-informational decorative glyphs, disabled borders (where contrast
permits), and ornamental graphics** — **never** text labels, placeholders, or explanatory text.

## 3. Typography

Family: **Noto Sans CJK SC** is the single UI/CJK family. **Only weights 400, 500, 700 are loaded.**
`font-weight: 600` is **forbidden** in every design role (no 600 face exists; do not claim it
resolves to any face — simply do not use it).

| Role | Family | Size | Weight | Line height | Tracking | Color | Allowed contexts | Forbidden substitutions |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| page-title | UI | 24px | 700 | 32px | -0.01em | ink | one per page (PageHeader) | weight <700; arbitrary `text-[…]` |
| page-description | UI | 14px | 400 | 22px | 0 | ink-muted | directly under page/section title | re-using body color |
| section-title | UI | 16px | 700 | 24px | 0 | ink | card/section header | weight 600 |
| body | UI | 14px | 400 | 22px | 0 | ink | running text, table cells | 13px (no such role exists) |
| secondary | UI | 14px | 400 | 22px | 0 | ink-muted | descriptive secondary | using ink color |
| metadata | UI | 12px | 400 | 18px | 0 | ink-muted | timestamps, IDs, record facts, **preview annotations** | Chinese <12px |
| table-header | UI | 12px | **500** | 16px | 0.04em UPPER | ink-muted | table column headers | **13px; weight 600/400** |
| table-cell | UI | 14px | 400 | 20px | 0 | ink | table body (selected row uses ink, not ink-muted) | left-aligning numerics |
| label | UI | 14px | 500 | 20px | 0 | ink | form field labels | weight 700 |
| help-text | UI | 12px | 400 | 18px | 0 | ink-muted | under a field | re-composing per page |
| button | UI | 14px | 500 | 20px | 0 | context | controls (incl. small buttons) | 13px button text |
| badge | UI | 12px | 500 | 16px | 0 | tier text | status chips | pill radius; per-tier color drift |
| metric | UI | 30px | 700 | 36px | -0.02em | ink | KPI/stat value (one per card) | proportional nums |
| numeric | UI | — | — | — | — | — | a FEATURE applied to any numeric | proportional-nums on data |
| timer | UI | 16px | 700 | 24px | -0.01em | ink | countdown / elapsed | proportional nums |
| code | mono | 12px | 400 | 20px | 0 | ink-secondary | code/logs/JSON | UI family for code |
| topbar-title | UI | 14px | **500** | 20px | 0 | **ink** | page label in topbar | **muted color; weight 600** |
| sidebar-label | UI | 14px | 400 | 20px | 0 | sidebar-muted | nav item (inactive) | — |
| sidebar-label-active | UI | 14px | 500 | 20px | 0 | sidebar-ink | nav item (active) | indigo text |
| sidebar-group-label | UI | **12px** | **500** | 16px | 0.06em UPPER | sidebar-muted | nav group heading (Chinese permitted) | **11px; weight 600** |

**Explicit rules:**

- **`tabular-nums` is mandatory** for scores, counts, timers, percentages, durations, dates.
- **Numeric alignment:** numeric table columns are **right-aligned**; text left-aligned.
- **Chinese/Latin mixed lines:** one family handles both; `tabular-nums` when digits are present.
- **Monospace** only for `code`, never UI text.
- **12px is the absolute floor for Chinese.** Chinese is permitted in sidebar group labels, so
  sidebar-group-label is **12px/500** (not 11px).
- **`text-transform: uppercase`** affects ONLY the Latin portion of mixed CJK/Latin labels. It does
  **not** change Chinese glyphs (Chinese has no case). It is applied for Latin emphasis only.
- **No 13px role exists.** Anywhere 13px appeared before (preview notes, descriptions, small
  buttons, popovers, error descriptions) it is replaced by 12px (metadata/help/badge/annotation) or
  14px (body/popover/descriptive/button).
- **No `font-weight: 600`** anywhere. `table-header`, `topbar-title`, `sidebar-group-label`,
  `label` all use 500.

## 4. Geometry and spacing

- **Base radius:** 8px (`--radius`). Cards, content surfaces, dialogs, sheets, popovers, **controls**
  all use 8px.
- **Control radius:** 8px — controls match their container. (6px controls are retired.)
- **Overlay radius:** 8px.
- **Status-chip radius:** 6px — the one deliberate tighter radius, status chips only.
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32.
- **Page gutters:** 24px (32px at `lg+`).
- **Section gaps:** 24px.
- **Card padding:** uniform 20px (`px-5 py-4` header, `p-5` content).
- **Table cell padding:** 12px × 8px; dense mode 12px × 4px.
- **Control heights:** **default AND small buttons = 36px (`h-9`). Icon buttons = 36×36.** There is
  **no 32px interactive button variant.** A visual icon inside a button may remain 16px.
- **Touch-target minimum:** **36×36** — no interactive target is smaller. (Do NOT claim a child
  32px button inherits a 36px hit target from a 44px row — it does not. Buttons are 36px directly.)

## 5. Borders and depth

- **Default hairline:** `1px solid #e6e2dc` (warm).
- **Strong border:** `1px solid #d3cec5` on inputs/selected emphasis; `2px solid #d3cec5` for
  table-header emphasis only (not at focus time).
- **Table-header emphasis:** a `surface-subtle` band OR a `2px solid hairline-strong` bottom rule
  (pick one per table; never both).

### 5.5 Focus authority (corrective — single, stable rule)

```text
focus border width:  1px   (NEVER changes at focus time — no 2px-on-focus, ever)
focus border color:  primary indigo (#4f46e5)
focus outer ring:    0 0 0 3px rgb(79 70 229 / 0.25)
```

**Rules (applied to EVERY control: primary/secondary/ghost/destructive/icon button, input, textarea,
select, checkbox, radio, switch, tabs, sidebar navigation):**

- **No focus-time border-width change.** Border width stays 1px before/during/after focus.
- **No content movement.** Stable border width → no layout shift, no icon/text reposition.
- **Normal controls use indigo focus.** **Destructive buttons ALSO use indigo focus** (not a red
  focus). There is no separate red focus authority.
- **Invalid inputs retain a destructive VALIDATION border** (`1px destructive`) at rest.
- **A focused invalid input =** destructive `1px` border **+** indigo outer focus ring. The error
  state (red border) and keyboard focus (indigo ring) remain visually distinguishable.
- **One ring, one alpha (0.25).**

### 5.6 Control elevation (corrective — controls are FLAT)

- **`elevation.control` is REMOVED.** Ordinary controls (buttons/inputs/selects) are **flat:
  `box-shadow: none`.** Do not describe an ordinary control shadow as "optional" — it does not exist.
- Depth remains reserved for **popover, dropdown, sheet, dialog, modal** (`overlay`/`overlay-lg`).
- **Forbidden shadows:** any `shadow-*` on ordinary business content OR controls. Enforced by
  `exam-ui/no-business-shadow`.
- **When a card may be visually raised:** only genuine overlays. Ordinary content cards are flat.
  Never mix flat and raised versions of the same semantic surface on one screen.

## 6. Component specifications

> Rules reference §Token roles directly. Variants are named. Each control: default/hover/focus/
> active/selected/disabled/destructive/invalid where relevant. **Focus never changes border width on
> any control. Controls are flat. Small button = 36px.**

### Buttons (all 36px; flat; indigo focus on every variant)

- **primary-button**: bg `primary`, text `on-primary`, 8px, h-36, `button` type. hover→`primary-hover`;
  active→`primary-active`; focus→indigo border + ring (1px, stable); disabled→bg `disabled-surface`,
  text **`ink-muted`** (AA 5.03:1).
- **secondary-button**: bg `surface`, text `ink`, `1px hairline` border, **flat**. hover→`surface-subtle`;
  focus→indigo border+ring; disabled as above.
- **ghost-button**: transparent, text `ink`. hover→`surface-subtle`; focus→indigo border+ring.
- **destructive-button**: bg `destructive-solid`, text `on-destructive`. focus→**indigo** border+ring
  (not red); disabled as above.
- **icon-button**: 36×36, ghost or secondary shell. focus→indigo border+ring.
- **Sizes:** default 36px, small 36px (no 32px variant). Visual icon inside may be 16px.

### Inputs / Selects / Textarea (36px; 8px; flat; stable-width indigo focus)

- **text-input**: h-36, bg `surface`, `1px hairline-strong` border (width never changes), 8px,
  `body` type, placeholder `ink-muted`. focus→border **color** `primary` (width stays 1px) + indigo
  ring; invalid→`1px destructive` border (+ indigo ring when also focused); disabled→bg
  `disabled-surface`, text **`ink-muted`**.
- **textarea**: as text-input, min-height per content.
- **select**: trigger as text-input; chevron `ink-muted`; content popover `overlay` + 8px.
- **checkbox/radio**: accent `primary`; focus→indigo ring (stable box).
- **switch**: on=`primary`, off=`hairline-strong`; focus→indigo ring.
- **tabs**: underline — active `2px primary` underline + `ink`; inactive `ink-muted`; hover
  `ink-secondary`; focus→indigo ring on the tab.

### Surfaces

- **page-header**: `page-title` + `page-description`; actions right; stacks narrow.
- **content-surface** (`surface-content`): bg `surface`, `1px hairline`, 8px, **flat**.
- **stats-card**: `surface-content` + `metric` + `secondary` + optional `metadata`. **Flat.**
- **data-toolbar**: merges INTO DataTableShell header (no double border).
- **table**: §7.
- **status-badge**: §8.

### States / feedback

- **empty-state**: `surface-content` + `1px dashed hairline` inner panel; `ink-muted` icon,
  `section-title` title, `secondary` description, optional action.
- **inline-error**: `InlineErrorBanner` — destructive border + `destructive-soft` bg + `destructive`
  text. Field errors via `FieldError` (`destructive`, `metadata`).
- **dialog**: `overlay-lg`, 8px, `hairline` border. Footer `border-t hairline`; **primary action
  right-aligned**, destructive left of primary, cancel leftmost.
- **dropdown/popover**: `overlay`, 8px.
- **sidebar-navigation-item**: 40px, 8px, `sidebar-label`; hover→`sidebar-hover` bg + `sidebar-ink`;
  active→`sidebar-active` bg + `sidebar-ink` weight 500; focus→**indigo ring** (stable width).

## 7. Table system

**Row-separation model (corrective — ONE explicit choice):**

```text
TABLE ROW SEPARATION: ZEBRA
PER-ROW BORDERS:     NONE
```

- **Header:** a `surface-subtle` band OR a `2px solid hairline-strong` bottom rule (one per table).
  Header typography: `table-header` (12px / 500 / uppercase / 0.04em / ink-muted).
- **Zebra:** even rows = `surface-subtle` (`#f4f2ef`); odd rows = `surface` (`#ffffff`). **No
  per-row `border-b`.**
- **Row height:** 44px default; dense mode 36px.
- **Hover:** `row-hover` `#efe9df` — warm; **visibly differs from BOTH `surface` (#fff) AND
  `surface-subtle` (#f4f2ef)**; **both odd and even rows visibly change on hover**.
- **Selected:** `row-selected` `#e8e1d3` — warm; **more prominent than hover**; overrides zebra and
  hover **by CSS source order** (no `!important`). Selected-row text uses **`ink`** (not
  `ink-muted`) so every selected-row text pair clears AA-normal.
- **Numeric columns:** right-aligned + `tabular-nums` (mandatory). Proportional jitter forbidden.
- **Text columns:** left-aligned.
- **Date/time:** ISO `YYYY-MM-DD` or `LL`; tabular-nums; en-dash ranges.
- **Action column:** right-aligned; ghost icon buttons (36×36); destructive icon shows
  `destructive` only on hover/active.
- **Empty state:** §6 empty-state inside the shell.
- **Responsive:** column-priority map; mobile must NOT rely exclusively on horizontal scroll.

**Final warm-neutral values & contrast consequences** (recomputed):

| Row state | Value | L* | ink on it | ink-muted on it |
| --- | --- | ---: | ---: | ---: |
| surface (odd) | `#ffffff` | 1.000 | 16.80 AAA | 5.62 AA |
| surface-subtle (zebra) | `#f4f2ef` | 0.950 | 15.04 AAA | 5.03 AA |
| row-hover | `#efe9df` | 0.916 | 13.91 AAA | 4.66 AA |
| row-selected | `#e8e1d3` | 0.884 | 12.92 AAA | 4.32 (selected rows use **ink**, not ink-muted) |

All four are warm (hue 36–41°, chroma ≤0.098) — same family as canvas. **Not beige.**

## 8. Status system

Exactly **five** tiers. **SOFT fill is default; SOLID is allowlisted (§8.3).** The previous
black-on-white `secondary` is RETIRED.

| Tier | Background | Foreground | Border | Solid? | Icon (normal) | Icon (dense table) |
| --- | --- | --- | --- | --- | --- | --- |
| NEUTRAL | `neutral-soft #f1ede7` | `neutral #6b6760` | none | no | optional | no |
| INFORMATIONAL | `informational-soft #e3edfb` | `informational #155bbf` | none | no | optional | no |
| POSITIVE | `positive-soft #dcf5e9` | `positive #047857` | none | no | optional | no |
| CAUTION | `caution-soft #fdefd9` | `caution #b54708` | none | no | optional | no |
| DESTRUCTIVE (soft) | `destructive-soft #fbddcf` | `destructive #b23a17` | none | no | optional | no |
| DESTRUCTIVE (solid) | `destructive-solid #c2410c` | `on-destructive #ffffff` | none | **YES** | optional | no |

**Prominence (low → high):** NEUTRAL < INFORMATIONAL ≈ POSITIVE < CAUTION < DESTRUCTIVE.

**Icon policy:** icons are OPTIONAL per tier. In **normal** contexts an icon may be shown; in
**dense tables** icons are omitted to reduce noise. Status chips remain **6px rectangles, not pills.**

### 8.3 Destructive SOLID policy (narrow allowlist)

```text
SOFT DESTRUCTIVE:
  default representation for destructive states in ordinary lists and tables.
SOLID DESTRUCTIVE:
  permitted ONLY for immediate, high-attention operational danger.
```

**SOLID allowlist (exclusive):**

| status key | solid? | reason |
| --- | --- | --- |
| `critical` | **SOLID** | health/system critical — operational danger |
| `misconduct_serious` | **SOLID** | serious misconduct — immediate attention |
| `infraUnavailable` | **SOLID** *only when it blocks an active examination operation* | blocks ops; otherwise SOFT |

**All other destructive statuses are SOFT unless explicitly listed here.** Pages do NOT choose
independently.

### 8.4 Complete status-key → tier mapping (one-to-one, deterministic)

> Source of keys: `apps/web/src/lib/statusMeta.ts` (41 keys, read in full). Every key appears
> **exactly once**. The implementation agent does NOT decide semantic mappings.

| status key | Quiet Graphite tier | soft/solid | icon (normal) | icon (dense table) | reason |
| --- | --- | --- | --- | --- | --- |
| `draft` | NEUTRAL | soft | yes | no | not yet active — quiet |
| `published` | INFORMATIONAL | soft | yes | no | available/scheduled info |
| `open` | POSITIVE | soft | yes | no | actively available |
| `closed` | NEUTRAL | soft | yes | no | normal end-of-life, not a warning |
| `archived` | NEUTRAL | soft | no | no | dormant, quiet |
| `assigned` | INFORMATIONAL | soft | yes | no | record created, info |
| `started` | POSITIVE | soft | yes | no | underway, good |
| `completed` | **POSITIVE** | soft | yes | no | finished successfully (was `secondary` — retired) |
| `blocked` | DESTRUCTIVE | soft | yes | no | cannot proceed |
| `not_started` | NEUTRAL | soft | no | no | pending, quiet |
| `queued` | CAUTION | soft | yes | no | waiting, attention |
| `in_progress` | INFORMATIONAL | soft | yes | no | active info |
| `disrupted` | CAUTION | soft | yes | no | degraded, attention |
| `submitted` | **INFORMATIONAL** | soft | yes | no | entered (was `secondary` — retired) |
| `grading` | INFORMATIONAL | soft | yes | no | processing info |
| `graded` | POSITIVE | soft | yes | no | success |
| `voided` | DESTRUCTIVE | soft | yes | no | invalidated |
| `saving` | CAUTION | soft | yes | no | transient, attention |
| `saved` | POSITIVE | soft | yes | no | confirmed |
| `failed` | DESTRUCTIVE | soft | yes | no | error state |
| `canceled` | NEUTRAL | soft | yes | no | withdrawn, quiet |
| `expired` | DESTRUCTIVE | soft | yes | no | no longer valid |
| `stale` | CAUTION | soft | yes | no | outdated, attention |
| `connected` | POSITIVE | soft | yes | no | healthy link |
| `degraded` | **CAUTION** | soft | yes | no | impaired, attention |
| `offline` | DESTRUCTIVE | soft | yes | no | link down |
| `ok` | POSITIVE | soft | yes | no | healthy |
| `critical` | DESTRUCTIVE | **SOLID** | yes | no | operational danger (§8.3 allowlist) |
| `infraAvailable` | POSITIVE | soft | yes | no | healthy infra |
| `infraDegraded` | CAUTION | soft | yes | no | impaired infra |
| `infraUnavailable` | DESTRUCTIVE | **SOLID** (only when blocking active exam op) / SOFT otherwise | yes | no | blocks ops (§8.3) |
| `infraDisabled` | NEUTRAL | soft | no | no | off, quiet |
| `infraUnknown` | **NEUTRAL** | soft | no | no | indeterminate, quiet |
| `unknown` | NEUTRAL | soft | no | no | fallback, quiet |
| `passed` | POSITIVE | soft | yes | no | success |
| `not_passed` | DESTRUCTIVE | soft | yes | no | did not pass |
| `auto_graded` | **POSITIVE** | soft | yes | no | graded successfully (was `secondary` — retired) |
| `pending_manual` | CAUTION | soft | yes | no | awaits action |
| `fully_graded` | POSITIVE | soft | yes | no | complete success |
| `misconduct_warning` | CAUTION | soft | yes | no | warning, attention |
| `misconduct_serious` | DESTRUCTIVE | **SOLID** | yes | no | serious, immediate (§8.3 allowlist) |

**Mapping rules:** no "or POSITIVE where appropriate", no "as needed", no "depending on context."
The table above is the complete, deterministic mapping.

## 9. Layout and responsive behavior

**Responsive shell (deterministic).** The application shell adapts at one
breakpoint — `lg` (1024px). Below it the persistent sidebar is removed from the
document flow and navigation moves into a modal drawer.

- **Desktop — `lg` and above (`>=1024px`):** persistent sidebar in normal flow
  (expanded 232px; existing user-controlled collapse to 56px stays). Mobile
  drawer is not rendered. Main fills the remaining width.
- **Tablet & mobile — below `lg` (`<1024px`):** persistent sidebar is **absent
  from normal flow**. Navigation lives in a left-opening modal drawer (`Sheet`,
  `side="left"`, `width = min(18rem, 100vw - 3rem)`). A topbar menu trigger is
  visible; the drawer is closed by default after navigation and reload.
- **Main-content containment:** every shell main owner is
  `width:100% / min-width:0 / max-width:100%`. No shell-level
  `overflow-x:auto` shortcut. Local scrollable regions (tables, code blocks)
  own their own `overflow-x:auto` + `max-width:100%`.
- **Document overflow:** `document.documentElement.scrollWidth` must be
  `<= clientWidth + 1` at every supported viewport. A table wrapper MAY have
  `scrollWidth > clientWidth`; the document root may NOT.
- **Mobile topbar trigger:** ≥36×36, visible Indigo focus ring,
  `aria-expanded` / `aria-controls`, accessible name.
- **Mobile page gutter:** 16px below `lg` (24px at `md+` per "Outer gutters").

**Widths and composition.**

- **Sidebar widths:** expanded 232px; collapsed 56px.
- **Page max-width by surface type:**
  - reading/form pages (exam edit, question edit, settings): `max-w` 880–960px.
  - data-table pages (exam list, scores, questions, users, candidates, grading queue, audit):
    **full-width**.
  - exam runtime: centered `max-w` ~1100px; timer fixed top-right.
  - diagnostic/monitoring (system diagnostics, proctor): full-width status-card grid.
- **Outer gutters:** 24px (32px `lg+`); 16px below `lg` (see Responsive shell).
- **Toolbar/table composition:** toolbar INSIDE DataTableShell header (no double border).
- **Page-header stacking:** stacks <`sm`; title+status left, actions right at `sm+`.
- **Table column priority:** per-table map; critical (title/status/actions) always visible.
- **Mobile action behavior:** existing control sizes only; row actions collapse into a kebab menu.
  (**No FAB.** No new product interaction behavior is invented by the preview.)
- **Dialog sizing:** sm max-w-xs, default max-w-lg; full-width minus 32px on mobile.
- **Touch targets:** ≥36×36 everywhere.

**Shared navigation authority.** Desktop sidebar and mobile drawer render the
SAME navigation source (entries, groups, active-route logic, labels, icons,
role visibility, user identity/logout). Do not maintain two nav arrays.

## 10. Do and do not

**DO**
- Use ONE warm-neutral temperature model across canvas, surface, hairline, ink, AND the graphite sidebar.
- Use only weights 400 / 500 / 700 (never 600).
- Keep all Chinese ≥12px (12px floor; sidebar group labels included).
- Reserve indigo for primary actions + focus only.
- Right-align + tabular-num every numeric column, timer, count, score, %, duration, date.
- Give every table a header treatment (subtle band OR 2px rule); ZEBRA separation, no per-row borders.
- Use the 5-tier status map (§8.4); SOLID only per the §8.3 allowlist.
- Keep ALL content AND ordinary controls FLAT; elevation belongs to overlays only.
- Use 8px as the structural radius; 6px for status chips only.
- Ink the topbar page title (wayfinding, 14px/500).
- Keep disabled TEXT at `ink-muted` (AA); keep `ink-disabled` for non-text only.
- Keep focus border WIDTH at 1px on every control (change color, not width).

**DON'T**
- Don't use `font-weight: 600` anywhere.
- Don't render Chinese below 12px (no 11px sidebar group labels).
- Don't use 13px for any text (use 12px or 14px).
- Don't change border width at focus time on any control.
- Don't put a shadow on ordinary business content OR ordinary controls.
- Don't mix two gray systems or use a cyan/cool-gray sidebar.
- Don't use indigo for links, status badges, sidebar selection, or icons.
- Don't left-align numeric columns or use proportional-nums on data.
- Don't use the black-on-white `secondary` status.
- Don't invent per-page SOLID-destructive usage; follow the §8.3 allowlist.
- Don't use 6px / 12px / pill radii on cards, inputs, or buttons.
- Don't add lint rules, parsers, registries, baselines, token generators, or schema systems.

## 11. Agent prompt guide

**Implementing a new form page:**
> "Build `<FormPage>` with `PageHeader` (`page-title`/`page-description`) → 24px gap → `FormSection`
> (`surface-content`, `section-title`) of `FieldGroup`s: `label` + control + `help-text`. Controls
> h-36, 8px, FLAT (no shadow), focus = indigo **1px border color** + ring (width never changes).
> Errors via `FieldError` (`destructive`, `metadata`). Primary action right-aligned. Content column
> `max-w` 880–960. Weights 400/500/700 only. Validate every label/help-text pair is AA on `surface`."

**Implementing a new data-table page:**
> "Build `<ListPage>`: `PageHeader` → 24px gap → `DataTableShell` (`surface-content`) with toolbar IN
> its header. `Table`: header = `table-header` (12/500/UPPER) on `surface-subtle` band; rows 44px;
> **ZEBRA** (no per-row borders); numerics right + `numeric` (tabular); text left; actions right
> (ghost icon 36×36). Status via `StatusBadge` §8.4 map. Empty → `EmptyState`. Full page width.
> Column-priority map for `<lg`."

**Implementing a status-heavy monitoring page:**
> "Full-width grid of `StatsCard`s + status tables. Map every status through §8.4 (one-to-one,
> deterministic). SOLID only for `critical` / `misconduct_serious` / `infraUnavailable`-blocking
> (§8.3). Omit badge icons in dense rows. Rows: zebra, no per-row border, hover `row-hover`,
> selected `row-selected` (text→`ink`). Distinct tiers, distinct prominence."

**Reviewing an existing page for visual drift:**
> "Check vs §10: (1) one warm-neutral temperature? (2) weights only 400/500/700 (no 600)? (3) Chinese
> ≥12px (no 11px)? (4) no 13px? (5) indigo only primary+focus? (6) numerics right+tabular? (7) table
> zebra, no ruled-paper, header treatment? (8) status via §8.4, SOLID per §8.3? (9) no shadow on
> content/controls? (10) focus border width stable at 1px? (11) one 8px radius system (chip 6px)?
> (12) topbar title inked 14/500? (13) disabled text = ink-muted? Flag every violation with the role
> it should use."

## 12. Iteration guide and known gaps

- **Add a component variant:** define it in §6 with explicit states + §Token role references; add a
  `components:` entry. No new token/registry/parser. Re-validate its color pairs.
- **Validate contrast:** recompute WCAG for the actual pair (relative-luminance). Normal text ≥4.5,
  large/UI ≥3.0. Update §Validation.
- **Compare screenshots:** before/after at 1440 + 1000 + 420 per Wave, vs the audit §C inventory.
- **New token justified only if:** no existing role fits semantically AND reused ≥3 places AND its
  contrast is measured. Otherwise extend an existing role.
- **Do NOT infer selected font-face weight from `getComputedStyle()` alone** — it reports the
  requested weight, not the resolved face. Trust the loaded-face inventory (400/500/700).
- **Unverified:** macOS/Safari Noto at 12px (highest-risk unknown); no macOS capture taken.
- **Deferred:** dark theme (out of scope — the 14 inert `dark:` variants resolved later, not here);
  serif reading-recipe calibration; metric-recipe migration coverage (~20 bypasses); proctor
  density (Phase-2).

## Validation

> Recomputed WCAG 2.1 for every actual text pair (Corrective-1). Method: relative luminance,
> ratio = (L1+0.05)/(L2+0.05).

| Pair | Ratio | Verdict |
| --- | ---: | --- |
| ink `#1f1d1b` on canvas `#faf9f7` | 15.97 | AAA |
| ink on surface `#ffffff` | 16.80 | AAA |
| ink on surface-subtle `#f4f2ef` | 15.04 | AAA |
| ink on row-hover `#efe9df` | 13.91 | AAA |
| ink on row-selected `#e8e1d3` | 12.92 | AAA |
| ink-secondary `#3d3a36` on canvas | 10.75 | AAA |
| ink-muted `#6b6760` on canvas | 5.34 | AA-normal |
| ink-muted on surface | 5.62 | AA-normal |
| ink-muted on surface-subtle | 5.03 | AA-normal |
| **ink-muted on disabled-surface `#f4f2ef` (DISABLED TEXT)** | **5.03** | **AA-normal** |
| ink-muted on row-hover | 4.66 | AA-normal |
| sidebar-ink `#ece9e3` on sidebar-canvas `#26241f` | 12.79 | AAA |
| sidebar-ink on sidebar-active `#4a4538` | 7.88 | AAA |
| sidebar-muted `#a8a299` on sidebar-canvas | 6.12 | AA-normal |
| sidebar-muted on sidebar-hover `#38352e` | 4.83 | AA-normal |
| ink-disabled `#8a857b` on disabled-surface | 3.28 | **DECORATIVE/NON-TEXT ONLY** (not text) |
| link `#1d6fdb` on canvas | 4.59 | AA-normal |
| link-hover `#1559b8` on canvas | 6.33 | AA-normal |
| primary `#4f46e5` on canvas (accent text) | 5.98 | AA-normal |
| primary on primary-soft `#eef0fb` | 5.54 | AA-normal |
| on-primary `#fff` on primary | 6.29 | AA-normal |
| on-primary on primary-hover `#4338ca` | 7.90 | AAA |
| on-destructive `#fff` on destructive-solid `#c2410c` | 5.18 | AA-normal |
| informational `#155bbf` on informational-soft `#e3edfb` | 5.42 | AA-normal |
| positive `#047857` on positive-soft `#dcf5e9` | 4.77 | AA-normal |
| caution `#b54708` on caution-soft `#fdefd9` | 4.79 | AA-normal |
| destructive `#b23a17` on destructive-soft `#fbddcf` | 4.66 | AA-normal |
| neutral `#6b6760` on neutral-soft `#f1ede7` | 4.82 | AA-normal |

**Result:** every ordinary-text pair meets AA-normal (≥4.5). `ink-disabled` (3.28) is the only
sub-4.5 value and is explicitly **non-text decorative** (meets the 3:1 graphical-object threshold;
not permitted for text). **Disabled text uses `ink-muted` (5.03:1, AA-normal).**

**Temperature harmony:** canvas/surface-subtle/hairline/ink/row-hover/row-selected/sidebar all share
hue **36–43° (warm)** at chroma ≤0.098 — one coherent warm-neutral family.

**Reference principles applied** (BORROWED / ADAPTED / PROJECT-SPECIFIC / REJECTED): OpenCode warm
canvas + flat surfaces + restrained chroma (BORROWED), cream→`#faf9f7` (ADAPTED, less beige);
Cal.com control geometry + primary anchor (BORROWED); Linear scarce accent + explicit focus (BORROWED,
indigo not lavender); Notion warm minimalism + low-chroma status (ADAPTED to 5 AA-verified tiers).
REJECTED: all-monospace UI, terminal branding, marketing composition, dark-first, pill overuse,
copying any external palette. Quiet Graphite is project-specific.
