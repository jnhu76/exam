# Existing Token Semantic Audit — UI-TOKEN-TABLE-FOUNDATION-1 阶段二

> Evidence-based audit of the **existing** design-token system. Every value is
> extracted from real files (no idealized architecture). This stage audits; it
> does not rewrite tokens (corrective happens in stage 4, narrowly scoped).

## 1. Real implementation

| Concern | Fact | Location |
| --- | --- | --- |
| Tailwind version | **v4** (`^4.1.7`), CSS-first, **no config file** | `apps/web/package.json:31`, `apps/web/components.json` (`tailwind.config:""`) |
| Tailwind entry | `@import "tailwindcss";` | `apps/web/src/index.css:1` |
| v4 theme bridge | `@theme inline { --color-*: var(--semantic) }` | `index.css:39-105` |
| Global CSS (tokens) | `apps/web/src/index.css` (single file, 240 lines) | imported `main.tsx:5` |
| Recipe CSS (separate plain-CSS imports) | typography / surface / table / badge / control | `main.tsx:6-10` |
| shadcn config | style `new-york`, baseColor `neutral`, cssVariables true | `apps/web/components.json` |
| shadcn primitives | 28 components | `apps/web/src/components/ui/` |
| Dark mode | **absent** — no `ThemeProvider`, no `.dark` vars; `next-themes` only in `sonner.tsx` (inert) | `App.tsx` provider tree |
| `cn()` | `twMerge(clsx(...))` | `apps/web/src/lib/utils.ts:6` |
| cva | button / alert / badge / tabs variants | `components/ui/{button,alert,badge,tabs}.tsx` |

The system is **deliberately single-theme, light-only**. Six shadcn primitives
still carry inert `dark:` classes (tabs/checkbox/switch/textarea/radio-group/
dropdown-menu) — dead code (no `.dark` is ever set on `<html>`).

## 2. Token inventory (real values)

### A. Background / surface — `index.css:107-119`
| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#ffffff` | page canvas |
| `--surface` | `#ffffff` | card / table surface |
| `--surface-raised` | `#ffffff` | raised surface (border separates it) |
| `--surface-subtle` | `#f7f7f7` | table header, metadata strips |
| `--surface-soft` | `#f7f7f7` | (alias of subtle) |
| `--surface-muted` | `var(--surface-subtle)` | **alias** of subtle |
| `--surface-hover` | `#f7f7f7` | row/control hover |
| `--surface-selected` | `#eaf2fd` | selected row (primary-tinted) |

### B. Text — `index.css:120-123`
| Token | Value | Role |
| --- | --- | --- |
| `--text` | `#111827` | primary text (ink) |
| `--text-secondary` | `#374151` | secondary |
| `--text-muted` | `#627287` | muted / placeholders / metadata |
| `--text-subtle` | `#94a3b8` | subtlest (scanner dots, dividers) |

### C. Border — `index.css:124-131`
| Token | Value | Role |
| --- | --- | --- |
| `--border-shell` | `#dde2e8` | content surface border |
| `--border-raised` | `#d7dde5` | raised surface / header bottom |
| `--border-control` | `#cdd6e2` | input control border (= `--border-strong`) |
| `--border-divider` | `#edf0f3` | row dividers (lightest) |
| `--border-header` | `var(--border-raised)` | table header bottom (alias) |
| `--border-row` | `var(--border-divider)` | table row bottom (alias) |
| `--border` | `var(--border-shell)` | generic default (alias) |
| `--border-strong` | `var(--border-control)` | strong border (alias) |

### D. Primary / status — `index.css:132-178`
Primary family: `--primary #2563eb`, `-hover #1d4ed8`, `-active #1e40af`,
`-soft #eaf1ff`, `-soft-strong #d3e2ff`, `-focus #7aa7ff`.
Status families (bg/text/border triples): `--status-{neutral,info,positive,caution,destructive}-*`,
plus single `--danger/-success/-warning/-info` and `-*-soft` tints.

### E. Font — `index.css:18-37`
`--font-ui` (Noto Sans CJK SC primary → OS CJK fallbacks), `--font-reading-stack`
(= font-ui today), `--font-serif-stack` (Noto Serif SC), `--font-mono-stack`.
Self-hosted woff2 subsets (400/500/700 sans, 400/700 serif), `font-display:swap`,
`font-synthesis:none`.

### F. Geometry — `index.css:179`
`--radius: 0.5rem`. **No** global `--spacing` / `--shadow` tokens — shadows are
owned inline per surface recipe (documented elevation rule).

### G. Component-specific — `index.css:138-142` (table/action)
`--table-header #f7f7f7`, `--table-row-hover #f7f7f7`, `--table-row-focus #e6eefb`,
`--table-row-selected #eaf2fd`, `--action-hover #f7f7f7`. These are thin aliases
of `--surface-subtle`/`--surface-hover`/`--surface-selected` kept for table-recipe
readability — **not** an exploded `--table-*` hardcode set.

## 3. Consumption chain (foundation → semantic → utility → alias → recipe → page)

**Example 1 — primary button:**
`#2563eb` → `--primary` (index.css:132) → `@theme --color-primary` (:56) →
shadcn `button.tsx` `bg-primary ... hover:bg-[var(--primary-hover)]` →
`control/recipes.css` adds border+micro-shadow → page renders `<Button>`.

**Example 2 — page title:**
`#111827` → `--text` (:120) → `--color-foreground`/`--color-text-primary`
(:45,101) → `.type-page-title { color:var(--text); font-weight:500 }`
(typography/recipes.css:37) → `PageHeader.tsx` `<h1 className="type-page-title">`
→ page renders `<PageHeader/>`.

**Example 3 — table header:**
`#f7f7f7` → `--table-header` (:138) → `table/recipes.css`
`[data-slot=table-header]{background:var(--table-header)}` +
`[data-slot=table-head]{color:var(--text-muted);font-weight:500}` →
`DataTableShell` emits `data-slot=admin-table-shell`; primitive `Table` emits
`data-slot=table-header` → page renders table inside shell.

## 4. Business-code token-bypass statistics

| Bypass class | Count (business `*.tsx`, excl `components/ui` + token files) |
| --- | --- |
| raw palette (`text/bg/border-(gray\|slate\|zinc\|neutral\|red\|green\|amber\|blue)-*`) | **0** |
| hex / rgb() / hsl() / oklch() literals | **0** |
| `style={{color}}` literal | **0** |

**Exception — recipe-level bypass (1):** `badge/recipes.css:36-38`
`[data-slot="tag-badge"]` hardcodes `background:#f2f4f7; color:#475467` instead
of using a token. This is the **only** place a recipe evades its own token
foundation. Corrective: stage 4 routes it to `--surface-subtle`/`--text-secondary`.

## 5. KEEP / RENAME / MERGE / SPLIT / REMOVE / ADD decisions

| Token(s) | Decision | Reason |
| --- | --- | --- |
| all `--bg/--surface*/--text*/--border*/--primary*/--status-*` | **KEEP** | clean, well-named, consumed |
| `--surface-muted` = `--surface-subtle` | **MERGE (document)** | intentional alias; keep one name in recipes, document the equivalence |
| `--surface-soft` = `--surface-subtle` | **MERGE (document)** | same; consolidate consumers to `--surface-subtle` over time |
| `--border-header`/`--border-row`/`--border`/`--border-strong` | **KEEP** | semantic aliases aid recipe readability |
| `--table-*` / `--action-hover` | **KEEP** | thin aliases, not an exploded hardcode set; <6 tokens, multi-consumer |
| `tag-badge` hex `#f2f4f7`/`#475467` | **REMOVE** | replace with `--surface-subtle`/`--text-secondary` (stage 4) |
| shadcn `dark:` residue (6 files) | **REMOVE (cleanup)** | dead code, no dark theme |
| `--color-primary-contrast: #ffffff` etc. (6 hardcoded `#ffffff` in `@theme`) | **KEEP** | intentional contrast-pair constants, not themeable hues |
| **ADD** `--sidebar-*` light values | **ADD (stage 4)** | nav switches to light; rewrite the sidebar token set |

## 6. Wegent reference — absorb / reject

Wegent (`/home/hoo/Source/Wegent`, main `4a3df6e08`) is a **structural** reference only.

**Absorb (principles):**
- Multi-tier neutral surface ladder: base `255 255 255` → surface `249 249 249`
  → muted `243 244 246`; border `228 228 228`; text `51/99/147`. Mirrors our
  `--bg/--surface/--surface-subtle/--border-*/--text-*` intent.
- `--radius 0.5rem` — same as ours.
- Weight discipline (see typography audit): medium dominates, 600/700 rare.
- Badge `font-medium` + low-saturation soft background for neutral/info.
- Token layering: `:root` semantic vars → mapped to utilities; business code
  consumes semantic names, not raw hues.

**Reject (do not copy):**
- Brand purple `93 94 201` — our brand is product blue `#2563eb`.
- Its `globals.css` wholesale (it is `rgb()` space-separated v3-style; ours is
  hex `:root` + v4 `@theme inline` — different, intentional).
- Its Tailwind **v3** config + `tailwindcss-animate` — we are v4, do not downgrade.
- Product-specific layouts, deprecated selectors, its tech debt.

## 7. Corrective suggestions (forwarded to stage 4)

1. Route `tag-badge` off hardcoded hex onto `--surface-subtle`/`--text-secondary`.
2. Rewrite `--sidebar-*` to a light nav token set (nav→light decision).
3. Remove inert `dark:` residue from the 6 shadcn primitives.
4. Migrate the 11 `font-bold` metric sites to `.type-metric` (typography audit).
5. No new component-specific tokens; no parallel theme.
