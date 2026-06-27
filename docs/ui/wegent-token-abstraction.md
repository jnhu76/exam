# Wegent Token Abstraction

> Authority document for the 4-layer color token system in `apps/web`.
> Migrates the previous single-layer "literal `rgb()` in `@theme inline`" model
> to the Wegent raw-triplet model, fixing a latent dark-mode regression and
> establishing one source of truth per color.

## 1. Why this exists

Before this abstraction, `apps/web/src/index.css` declared every color as a
literal inside `@theme inline`:

```css
@theme inline {
  --color-primary: rgb(93 94 201);   /* literal */
}
.dark {
  --color-primary: rgb(118 119 218); /* dark redefinition */
}
```

This has a **silent dark-mode bug**. Empirically verified against this repo's
own Vite build (Tailwind CSS v4.3), a literal color value in `@theme inline`
is statically resolved into every utility at build time:

```css
/* generated */
.bg-primary { background-color: #5d5ec9; }   /* literal baked in */
.dark { --color-primary: #7677da; }           /* var redefined... */
```

Because `.bg-primary` is emitted with a literal `#5d5ec9` (not
`var(--color-primary)`), the `.dark` redefinition has **no effect** — primary
buttons never flip in dark mode. The same applies to `text-primary`,
`border-primary`, `bg-success`, etc.

The Wegent token abstraction fixes this by separating the color *fact* from the
Tailwind *bridge*, so utilities stay dynamic while opacity modifiers
(`/10`) still work.

## 2. The four layers

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1 — Raw facts      :root { --raw-primary: 93 94 201 } │
│           (bare triplets) .dark { --raw-primary: 118 119 ..}│
├─────────────────────────────────────────────────────────────┤
│ LAYER 2 — Bridge          @theme inline {                    │
│           (Tailwind v4)     --color-primary: rgb(var(--raw-…))│
│           }                                                  │
├─────────────────────────────────────────────────────────────┤
│ LAYER 3 — shadcn aliases  --background, --card, --primary …  │
│           (resolved via Layer 2; informational)             │
├─────────────────────────────────────────────────────────────┤
│ LAYER 4 — Admin aliases   --admin-primary: var(--color-…)    │
│           (admin-theme.css, alias forward — never a 2nd fact)│
└─────────────────────────────────────────────────────────────┘
```

### Layer 1 — Raw facts (`index.css` `:root` / `.dark`)

The single source of truth for every color. Stored as **bare
space-separated RGB triplets** (e.g. `93 94 201`), not `rgb(...)`.

- Why bare triplets: they can be wrapped by the Layer 2 bridge as
  `rgb(var(--raw-x))` and still participate in Tailwind v4's `color-mix()`
  opacity modifiers. They also remain dynamic — `.dark` only re-points the same
  `--raw-*` var.
- Naming convention: `--raw-<role>`. Roles: `bg-base`, `bg-surface`,
  `bg-muted`, `text-primary`, `text-secondary`, `text-muted`, `border`,
  `primary`, `success`, `warning`, `error`, `ring`, `sidebar-*`.
- Alpha components (e.g. hover tint strength) are separate tokens:
  `--raw-bg-hover-alpha`, `--raw-sidebar-active-soft-alpha`.

### Layer 2 — Tailwind v4 bridge (`index.css` `@theme inline`)

Maps each `--color-*` utility namespace to a Layer 1 raw triplet:

```css
@theme inline {
  --color-primary: rgb(var(--raw-primary));
  --color-accent: rgb(var(--raw-primary) / var(--raw-bg-hover-alpha));
}
```

This is the Tailwind v4 equivalent of Wegent's `withOpacity` bridge from
`tailwind.config.js`:

```js
// Wegent (Tailwind v3)
const withOpacity = (v) => `rgb(var(${v}) / <alpha-value>)`
colors: { primary: withOpacity('--color-primary') }
```

Verified output (local build):

```css
.text-primary { color: rgb(var(--raw-primary)); }              /* dynamic */
.bg-primary\/10 {
  background-color: color-mix(in oklab, rgb(var(--raw-primary)) 10%, transparent);
}
--raw-primary: 93 94 201;     /* :root */
--raw-primary: 118 119 218;   /* .dark — now actually flips utilities */
```

### Layer 3 — shadcn aliases

shadcn/ui components use the standard alias set (`background`, `foreground`,
`card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`,
`border`, `input`, `ring`). In this abstraction these aliases **are** the
Layer 2 `--color-*` namespace — there is no separate Layer 3 file. Components
consume them via Tailwind utilities (`bg-card`, `text-primary-foreground`,
`border-input`). No change required to shadcn primitives.

### Layer 4 — Admin aliases (`apps/web/src/styles/admin-theme.css`)

The admin namespace (`--admin-*`) was previously a **second set of color facts**
(`--admin-primary: rgb(93 94 201)` existed alongside `--color-primary`). This
violates single-source-of-truth. Layer 4 now declares every `--admin-*` color
as an **alias forward** to the Layer 2 bridge:

```css
@layer base {
  :root {
    --admin-primary: var(--color-primary);       /* alias, not a fact */
    --admin-primary-soft: rgb(var(--raw-primary) / 0.1);
    --admin-bg-page: var(--color-background);
    /* … */
  }
}
```

Non-color structural values (radius, layout metrics, shadow ink) remain literal
here — they are not colors and have no Layer 1 equivalent.

## 3. Empirical build evidence

The Tailwind v4 `@theme inline` behavior was verified by a controlled
in-repo build (not memory), testing four declaration strategies:

| Strategy | Declaration | `/N` alpha | `.dark` flips | Used? |
| --- | --- | --- | --- | --- |
| A | `--color-x: rgb(93 94 201)` literal | ✅ oklab | ❌ **baked** | was current (buggy) |
| B | `--color-x: rgb(var(--raw-x))` | ✅ color-mix | ✅ dynamic | **adopted** |
| C | `--color-x: rgb(var(--raw-x) / <alpha-value>)` | ✅ | ✅ | redundant |
| D | `--color-x: var(--raw-x)` (raw holds rgb) | ✅ | ✅ | viable, less explicit |

Strategy B is adopted — it is the most faithful port of Wegent's `withOpacity`
model and keeps the raw layer as pure triplets.

> Note: MCP/Context7 was unavailable for this task. Per AGENTS.md "If MCP Is
> Unavailable", the Tailwind v4 behavior above was confirmed via official docs
> (tailwindcss.com/docs/theme) plus local build inspection of generated CSS,
> not from memory.

## 4. File layout

| File | Layer | Role |
| --- | --- | --- |
| `apps/web/src/index.css` | L1 + L2 | raw `--raw-*` facts + `@theme inline` bridge |
| `apps/web/src/styles/admin-theme.css` | L4 | `--admin-*` aliases + structural metrics |
| `apps/web/src/components/ui/*` | L3 | shadcn primitives consume utilities (no edit) |
| `scripts/audit-wegent-token-abstraction.mjs` | guard | enforces layers, blocks regressions |

## 5. Rules for future edits

1. **Never put a literal `rgb(R G B)` on a `--color-*` token in `@theme inline`.**
   Always bridge via `rgb(var(--raw-x))`. The audit (`theme-literal-rgb`)
   blocks this — it is the dark-mode killer.
2. **Never declare a color fact twice.** A new admin color must alias an
   existing Layer 2 token (`var(--color-…)`) or, if genuinely new, get its own
   `--raw-*` triplet in Layer 1 first. The audit (`admin-literal-color`)
   blocks `--admin-*: rgb(literal)`.
3. **Never bypass tokens with hardcoded hex in classNames** (`text-[#5b8ff9]`)
   or Tailwind palette colors (`bg-blue-500`). Use semantic utilities. The
   audit (`hardcoded-hex-class`, `palette-color`) blocks these.
4. **No `divide-x` / `divide-y` table gridlines.** These reintroduce Koi-style
   gridlines. `border-r` / `border-l` for side panels, drawers, and sheets are
   allowed (not flagged).
5. **Raw triplets stay bare.** Do not wrap them in `rgb(...)` at Layer 1 —
   the bridge does the wrapping. A bare triplet is reusable for both
   `rgb(var(--raw-x))` and alpha composition.

## 6. Migration status

| Item | Status |
| --- | --- |
| Layer 1 raw facts (`:root` + `.dark`) | ✅ done |
| Layer 2 `@theme inline` bridge | ✅ done |
| Layer 4 `--admin-*` alias collapse | ✅ done |
| Dark-mode primary flip (latent bug) | ✅ fixed |
| `/N` opacity modifiers | ✅ verified working |
| shadcn primitives | ✅ unchanged (consume utilities) |
| Business-page hex debt (Dashboard/ScoreList) | ⏳ known debt, out of this PR's scope |

See `docs/ui/wegent-token-abstraction-report.md` for full verification evidence.
