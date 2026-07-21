# UI-VISUAL-DESIGN-AUDIT-1 — Product-Wide Visual and Aesthetic Audit

> Mode: **READ ONLY**. No production code, CSS, tests, docs, tokens, components, lint rules, or
> configuration were modified to produce this report. The application was run against a local dev
> database seeded with the documented demo dataset; that is the intended human dev path and changes
> no production artifact. Screenshots are the primary visual evidence; source + computed-style +
> WCAG measurements corroborate them.

---

## A. Verdict

```text
UI-VISUAL-DESIGN-AUDIT-1: COMPLETE
```

```text
UI-VISUAL-REFINE-1:
READY FOR DESIGN DECISION
```

The product is functionally coherent and internally consistent at the *infrastructure* level
(semantic tokens, surface/typography recipes, a status-tone authority, a working elevation lint
boundary). It does **not** feel visually refined. The gap is aesthetic, not architectural: a
warm/cool undertone clash between the dark sidebar and the near-white canvas, a single arbitrary
`13px` table-head size, left-aligned numerics, a flat 8px radius everywhere, and a thin/low-contrast
neutral ladder that makes Chinese text read as "gray on gray." Three changes (neutral undertone
unification, a deliberate numeric/mono treatment, and a refined table + badge pass) would move the
product from "shadcn default" to "calm technical utility."

---

## B. Repository and runtime truth

### B.1 Git

```text
git status --short   → (clean)
git branch --show-current → feat/ui-visual-fixes
git rev-parse HEAD   → cd6cf5256f6d3caa6f7b0ea578c7a37f8a112b0c
```

Recent log (top of `feat/ui-visual-fixes`, merged from `feat/frontend-redesign` via PR #180):

```text
cd6cf52 Merge pull request #180 from jnhu76/feat/frontend-redesign
d89554f fix(ui-lint): address PR review — modifier check, dead code, redundant ternary
dda3293 fix(ui): resolve CodeRabbit review findings
a900ae4 fix(ci): fix shard arg pass-through and align test label with canonical i18n
ac6124a docs(ui): finalize closure HEAD hashes and verification evidence
…
9ea566c fix(ui-lint): close business shadow baseline and align detector
33a3045 refactor(ui): close registered business shadow debt
b4dae71 docs(ui): record typography authority reconstruction
```

### B.2 Frontend foundation (recorded truth, not inferred)

| Item | Value | Source |
| --- | --- | --- |
| Global CSS | `apps/web/src/index.css` (`@import "tailwindcss"`) | file |
| Recipe CSS | `apps/web/src/surface/recipes.css`, `apps/web/src/typography/recipes.css` (plain CSS, unlayered → wins over Tailwind utilities) | files |
| Theme block | `@theme inline` maps `--color-*` to semantic vars; `--font-sans/reading/serif/mono` | `index.css:39-86` |
| Root tokens | single `:root` block, **no `.dark` block anywhere** | `index.css:88-118` |
| Font stack (UI) | `"Noto Sans CJK SC", "Source Han Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif` | `index.css:19-21` |
| Serif stack | `"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif` (reading role only) | `index.css:32-33` |
| Mono stack | `ui-monospace, SFMono-Regular, Menlo, …` | `index.css:34-36` |
| Web fonts loaded | Noto Sans CJK SC **Regular(400) + Medium(500) + Bold(700)**, Noto Serif SC Regular+Bold — self-hosted, subset-split woff2 (18+ files per weight), `font-display:swap`, `local()` first | `index.html` + `public/fonts/...` |
| Root font-size | **14px**, weight 400, `antialiased` | `index.css:130-135` |
| Base headings | `h1,h2,h3 { font-weight: 700 }` (no 600 face exists; avoids synthetic bold) | `index.css:146-151` |
| Radius token | `--radius: 0.5rem` (8px) — single value | `index.css:117` |
| Border tokens | `--border:#e5e7eb` (hairline), `--border-strong:#d1d5db` (input) | `index.css:95-96` |
| Shadow tokens | **none as named tokens**; shadows are literal in `surface-overlay` and in shadcn primitives | `recipes.css`, `components/ui/*` |
| Light/dark | **Light only.** 14 `dark:` utilities exist in shadcn primitives but no `.dark` selector / no dark token map → those variants are inert | grep + `index.css` |
| Font smoothing | `antialiased` on `body` (`-webkit-font-smoothing: antialiased`) | `index.css:131` |

### B.3 Token map (active light values, `index.css:88-118`)

| Var | Value | Role |
| --- | --- | --- |
| `--bg` | `#f7f8fb` | canvas (warm-ish neutral) |
| `--surface` | `#ffffff` | card/content |
| `--surface-muted` | `#f9fafb` | subtle / zebra |
| `--text` | `#111827` | body (Tailwind gray-900) |
| `--text-muted` | `#6b7280` | muted (gray-500) |
| `--text-subtle` | `#9ca3af` | subtle (gray-400) — **contrast FAIL, see F.3** |
| `--border` | `#e5e7eb` | hairline (gray-200) |
| `--border-strong` | `#d1d5db` | input border (gray-300) |
| `--primary` | `#2563eb` | primary (blue-600) |
| `--primary-hover` | `#1d4ed8` | (blue-700) |
| `--primary-soft` | `#eff6ff` | primary badge bg (blue-50) |
| `--sidebar-bg` | `#102a43` | **dark slate-cyan** sidebar |
| `--sidebar-active` | `#1f4e79` | active nav (steel blue) |
| `--sidebar-text` | `#d9e2ec` | sidebar fg |
| `--sidebar-muted` | `#9fb3c8` | sidebar muted |
| `--sidebar-border` | `#1b3a57` | sidebar divider |
| `--danger` | `#b42318` | error (red-700-ish) |
| `--danger-soft` | `#fef3f2` | error bg |
| `--success` | `#047857` | success (emerald-700) |
| `--success-soft` | `#ecfdf5` | success bg |
| `--warning` | `#b54708` | warning (amber-700) |
| `--warning-soft` | `#fffbeb` | warning bg |
| `--info` | `#175cd3` | info (blue-700) |
| `--info-soft` | `#eff6ff` | info bg |

> **Token origin observation:** the content/neutral ladder is **Tailwind's `gray` family** (cool,
> slightly blue); the sidebar is a **separate cyan-slate family** (`#102a43/#1f4e79/#1b3a57` ≈ a
> Material/refined-blue scale, not Tailwind `slate`/`gray`). These are two different gray systems
> side by side (see F.4).

### B.4 Components audited (all read)

- `components/ui/*` — shadcn primitives (button, input, select, table, card, badge, dialog,
  alert-dialog, dropdown-menu, popover, sheet, tooltip, checkbox, radio-group, switch, tabs, …).
- `components/shared/*` — `StatusBadge`, `PageHeader`, `PageSection`, `DataTableShell`,
  `DataToolbar`, `StatsCard`, `ContentCard`, `EmptyState`, `ErrorState`, `FieldError`,
  `InlineErrorBanner`, `ConfirmDialog`, `RowActions`, `SearchInput`, `LoadingState`, `Skeleton`.
- `components/layout/*` — `AdminLayout`, `AppSidebar`, `BrandHeader`, `BrandMark`, `ExamLayout`.
- `lib/statusMeta.ts` — status → tone/icon authority.
- Representative pages: `DashboardPage`, `ExamPage` (list), `ExamDetailPage`, `ScoreListPage`,
  `SystemDiagnosticsPage`, `ProctorDashboardPage`, `QuestionPage`, `UsersPage`, `CandidatesPage`,
  `SettingsPage`, `ExamListPage` (candidate), `TakeExamPage`, `LoginPage`.

---

## C. Screenshot inventory

Captured live against `pnpm dev` (api :3000 + web :4173) with the demo-seeded `exam` DB. Browser:
Chromium (Playwright bundled build), platform WSL2 Linux. All routes verified by URL after login.

| # | Route | Viewport | Theme | Data state | Notable observations |
| --- | --- | --- | --- | --- | --- |
| 1 | `/login` | 1440×900 | light | n/a | Centered card on `#f7f8fb`; thin border; blue primary button; first-impression screen |
| 2 | `/admin/dashboard` | 1440×900 | light | demo | **4 flat StatsCards (surface-content) sit above a shadowed `<Card>` table** → mixed elevation on one screen |
| 3 | `/admin/exams` | 1440×900 | light | 5 exams | 8-col table, 13px gray headers, numerics **left-aligned**, soft-fill status badges |
| 4 | `/admin/exams/:id` | 1440×900 | light | demo | (captured via detail nav) titled sections, status badge in header |
| 5 | `/admin/results/scores` | 1440×900 | light | demo | Score table; pass/fail badges |
| 6 | `/admin/system` | 1440×900 | light | demo | Health rows, ok/degraded/unavailable badges |
| 7 | `/admin/proctor` | 1440×900 | light | demo | Phase-1 placeholder proctor surface |
| 8 | `/admin/questions` | 1440×900 | light | demo | Question bank table |
| 9 | `/admin/users` | 1440×900 | light | demo | Users table + role badges |
| 10 | `/admin/candidates` | 1440×900 | light | demo | Candidates table |
| 11 | `/admin/settings` | 1440×900 | light | demo | **Form-heavy**: sectioned fields, switches, inputs, primary Save |
| 12 | `/exam/list` | 1440×900 | light | candidate1 | Candidate exam list |
| 13 | `/exam/:id/start` | 1440×900 | light | candidate1 in-progress | **Take-exam runtime**: timer + question stem + answer area |
| 14 | `/admin/import-logs` | 1440×900 | light | empty | **Empty state** (dashed-border placeholder) |
| 15 | `/admin/dashboard` | 1000×900 | light | demo | Narrow desktop — grid reflows |
| 16 | `/admin/exams` | 420×900 | light | demo | Mobile — table scrolls horizontally (`overflow-x-auto`), no column collapse |

**Evidence location:** raw PNGs were captured to a scratch dir for this audit (not committed —
READ ONLY mode). Observations above are cross-referenced with source + computed styles below so the
report stands without the images. If image artifacts are later required as committed evidence, that
is a follow-up, not part of this audit.

> **Platform note (Windows Chromium):** the self-hosted Noto Sans CJK SC woff2 set is loaded
> identically on every platform (same `@font-face`), so Windows Chromium will render the **same**
> physical glyphs as the Linux/Chromium capture here — the audit's font conclusions transfer
> directly. macOS will also use Noto (it is first in the stack) unless a user has a `local()`
> "Noto Sans CJK SC" installed; PingFang SC is only a fallback. No macOS capture was available; no
> macOS-specific result is invented.

---

## D. Reference-design matrix

| Reference | Principle to borrow | Principle to reject | Relevant exam surfaces |
| --------- | ------------------- | ------------------- | ---------------------- |
| **OpenCode** | Warm-neutral canvas + near-black ink; low-contrast hairlines; minimal elevation; restrained color; technical calm | All-monospace typography; terminal branding; ASCII decoration; universal 4px geometry | Canvas, page chrome, tables, system diagnostics, code/log areas |
| **Cal.com** | Modern sans-serif UI type; white/soft-gray hierarchy; clean table & form geometry; 8px controls; **black/near-black primary actions** as a strong anchor | (Cal's heavier marketing card composition) | Forms, tables, buttons, settings, exam list/detail |
| **Linear** | One scarce accent color; technical precision; quiet neutral hierarchy; **strong, explicit focus states** | (Dark-by-default assumption; Linear's dense keyboard UI) | Focus rings, primary actions, badges, topbar, status |
| **Notion** | Humanist geometric type; restrained rectangular geometry; pastel semantic **status backgrounds**; clear badge text hierarchy | Colorful marketing-card composition imported into an admin product | Badges, status indicators, empty states, callouts |

---

## E. Typography audit

### E.1 Font loading and fallback (measured)

- **Computed `font-family` on body, h1, th, td, badge, button, input:** all resolve to
  `"Noto Sans CJK SC"` first (verified live via `getComputedStyle`). The self-hosted family loads
  correctly on the dev runtime.
- **Weights actually available:** 400 (Regular), 500 (Medium), 700 (Bold). **No 600 face exists**;
  base `h1/h2/h3` are therefore pinned to 700 to avoid synthetic-bold nearest-weight snap
  (`index.css:137-151`). This is a deliberate, correct decision.
- **Weights used in practice:** body/secondary/metadata = 400; section title / page title / metric
  = 700; table head & badge & button & active nav = 500. All map to loaded faces — **no synthetic
  bold** in the audited roles.
- **Mono:** real monospace stack; used only by `type-code`.
- **Root size:** 14px. Font smoothing: `antialiased`.

### E.2 Why the Chinese can read as "fuzzy / unstable"

Separating **FACT** from **LIKELY CAUSE**:

- **FACT:** the font family itself is correct and high-quality (Noto Sans CJK SC). Glyph strokes
  are not actually blurry at the pixel level.
- **FACT:** the body and table-cell colors are `#111827` (strong, 16.7:1) — fine.
- **FACT:** a large share of supporting text uses `--text-muted #6b7280` (gray-500). On `#f7f8fb`
  that is **4.55:1** — passes WCAG AA for body but is in the "thin/passing-but-weak" band.
- **LIKELY CAUSE of the "fuzzy" perception:** at 14px / weight 400, Chinese glyphs rendered in a
  mid-gray (`#6b7280`) on a near-white `#f7f8fb` canvas lack the tonal anchor that makes CJK read
  crisp. The combination of (a) small size, (b) weight 400, (c) gray-500 color, (d) a canvas that is
  *warm-ish* while the gray ladder is *cool* produces a slightly washed, low-snap impression —
  especially for secondary text, table headers, metadata, and the topbar title (which is also
  `text-sm font-medium text-muted-foreground` in `AdminLayout:58`). This is a *contrast/weight/size*
  problem, not a font-rendering problem.
- **LIKELY CAUSE (secondary):** there is no consistent numeric/mono treatment for digits, so numbers
  inline with Chinese shift width as they change, adding visual instability to counts/scores/timers.

### E.3 Type scale inventory (roles actually in use)

| Role | Font family | Size | Weight | Line height | Letter spacing | Color | Source |
| ---- | ----------- | ---: | -----: | ----------: | -------------: | ----- | ------ |
| page title | Noto Sans CJK SC | 24px | 700 | 32px | -0.01em | `#111827` | `type-page-title` (measured live: 24/700/32) ✓ |
| page description | " | 14px | 400 | 22px | normal | `#6b7280` | `type-page-description` |
| section title | " | 16px | 700 | 24px | normal | `#111827` | `type-section-title` |
| body | " | 14px | 400 | 22px | normal | `#111827` | `type-body` |
| secondary | " | 14px | 400 | 22px | normal | `#6b7280` | `type-secondary` |
| metadata | " | 12px | 400 | 18px | normal | `#6b7280` | `type-metadata` |
| table header | " | **13px** | 500 | ~18.6px | normal | `#6b7280` | `TableHead` (`text-[13px] font-medium`) — **arbitrary, non-recipe** |
| table cell | " | 14px | 400 (→500 with `font-medium`) | 20px | normal | `#111827` | `TableCell` (`text-sm font-normal`) |
| button | " | 14px (xs 12px) | 500 | normal | normal | context | `buttonVariants` |
| input/select | " | 14px (`md:text-sm`) | 400 | normal | normal | `#111827` | `input.tsx` / `select.tsx` |
| badge (status) | " | 12px | 500 | 16px | normal | tone color | `StatusBadge` (`text-xs font-medium`) |
| metric (stat value) | " | 30px (`text-3xl`) | 700 | normal | normal | `#111827` | `StatsCard` (`type-metric text-3xl`) |
| numeric/tabular | " | — | — | — | — | — | `type-numeric` (`font-variant-numeric: tabular-nums`) — **only applied where `type-metric` is** |
| code | mono | 12px | 400 | 20px | normal | context | `type-code` |
| topbar title | " | 14px | 500 | normal | normal | `#6b7280` | `AdminLayout:58` (raw `text-sm font-medium`) |
| sidebar nav label | " | 14px | 400 / 500 active | normal | normal | `#9fb3c8`/`#d9e2ec` | `AppSidebar` |
| sidebar group head | " | 12px | 400 | normal | `tracking-wider` + uppercase | `#9fb3c8` | `AppSidebar:248` |

**Findings:**

- **Visually indistinguishable:** `body` (14/400/`#111827`) vs `secondary` (14/400/`#6b7280`) differ
  *only* by color — easy to misuse. `page-description` and `secondary` are effectively the same.
- **Too light / weak:** muted text at 4.55:1; the **topbar page title is `text-muted-foreground`**
  (`AdminLayout:58`) — the single most important wayfinding label on every admin page is rendered in
  gray-500 at 14px. This reads as timid, not "calm."
- **Too dense:** none of the roles are pathologically dense; CJK line-heights (1.4–1.5 for UI, 1.7
  for reading) were already corrected in the recipe layer — that work holds.
- **Arbitrary size:** the **`13px` table header** is the one off-scale value on the whole product.
  It is the single most-called-out item in §8 and visibly shrinks the table's information hierarchy.
- **Requested weight not loaded:** none. All weights map to real faces.
- **`type-numeric` (tabular-nums) is under-deployed:** it is bundled into `type-metric` but is **not
  applied to table numeric columns, timers, or counts**, so those digits are proportional-nums and
  jitter as values change.

---

## F. Color-system audit

### F.1 Active semantic palette (with consumers)

| Semantic role | Token | Light value | Dark value | Actual consumers |
| ------------- | ----- | ----------- | ---------- | ---------------- |
| canvas | `--bg` | `#f7f8fb` | — (no dark) | `body`, `surface-page`, topbar behind |
| surface | `--surface` | `#ffffff` | — | cards, `surface-content`, sidebar? no |
| surface-muted | `--surface-muted` | `#f9fafb` | — | `surface-subtle`, `bg-muted` |
| surface-raised | (none) | — | — | **no raised token; elevation only via Card `shadow-sm` + overlay** |
| foreground / body | `--text` | `#111827` | — | body, titles, cells |
| muted text | `--text-muted` | `#6b7280` | — | secondary, metadata, th, topbar title, placeholders |
| subtle text | `--text-subtle` | `#9ca3af` | — | **rarely used; contrast FAIL (F.3)** |
| hairline | `--border` | `#e5e7eb` | — | card borders, table row borders, dividers |
| strong border | `--border-strong` | `#d1d5db` | — | input/select borders (`--color-input`) |
| primary | `--primary` | `#2563eb` | — | primary buttons, links, focus ring, active accents |
| primary hover | `--primary-hover` | `#1d4ed8` | — | button hover (inline var in `button.tsx`) |
| primary soft | `--primary-soft` | `#eff6ff` | — | primary badge bg |
| focus ring | `--ring`=`--primary` | `#2563eb` | — | `ring-ring` (buttons/inputs use `/30`–`/50`) |
| success | `--success` | `#047857` | — | success badge text, ok/pass badges |
| success soft | `--success-soft` | `#ecfdf5` | — | success badge bg |
| warning | `--warning` | `#b54708` | — | warning badge text |
| warning soft | `--warning-soft` | `#fffbeb` | — | warning badge bg |
| danger | `--danger` | `#b42318` | — | destructive btn, danger badge text, error surfaces |
| danger soft | `--danger-soft` | `#fef3f2` | — | danger badge bg, inline error banner |
| info | `--info` | `#175cd3` | — | info badge text |
| info soft | `--info-soft` | `#eff6ff` | — | info badge bg |
| disabled | (opacity) | `opacity-50` | — | disabled controls (no dedicated token) |
| selection | inline | `bg-primary` | — | input selection |
| table hover | `bg-muted/50` | `#f9fafb` @50% | — | `TableRow` hover |
| sidebar bg | `--sidebar-bg` | `#102a43` | — | `AppSidebar` aside |
| sidebar active | `--sidebar-active` | `#1f4e79` | — | active nav bg, avatar fallback |
| sidebar hover | `--sidebar-hover` | `rgb(255 255 255 / 8%)` | — | nav hover |
| sidebar text | `--sidebar-text` | `#d9e2ec` | — | primary nav label |
| sidebar muted | `--sidebar-muted` | `#9fb3c8` | — | inactive nav, group heads |
| sidebar border | `--sidebar-border` | `#1b3a57` | — | sidebar dividers |

### F.2 Palette problems

- **Warm canvas paired with cool borders + a cyan sidebar (temperature clash).** `--bg #f7f8fb` reads
  faintly warm (a hair of yellow), while the neutral ladder (`#e5e7eb/#d1d5db/#6b7280/#111827`) is
  **Tailwind `gray` (cool, blue-ish)**, and the sidebar is a separate **cyan-slate** scale. The eye
  perceives the sidebar as *blue-black*, the canvas as *warm-white*, and the borders as *cool-gray* —
  three temperatures on one frame. This is the single biggest contributor to "feels rough."
- **Two different gray systems.** Content neutrals = Tailwind `gray` (R≈G≈B with blue bias);
  sidebar = a hand-picked cyan-slate (`#102a43` has notably more blue than green). They were not
  drawn from one ladder.
- **No raised surface token.** "Surface-raised" is implicit-only (Card `shadow-sm`). There is no
  `--surface-raised`, so the visual step from canvas→card is carried by shadow, not by a tokenized
  background tier — making elevation feel optional rather than systematic.
- **Semantic colors are dark-on-pale-soft (good) but the *soft* backgrounds are very pale** (`#ecfdf5`,
  `#fffbeb`, `#fef3f2`, `#eff6ff`). At small badge sizes these read almost white, so badges lose
  chroma and several tones (primary/info, success, neutral) can look similar at a glance (see H).
- **Primary overuse / accent not scarce.** `--primary #2563eb` is used for: primary buttons, links,
  the focus ring, active sidebar accent, primary-status badges, the StatsCard icon chip
  (`bg-primary/10`), and selection. That is 6+ distinct roles on one blue → the accent is not
  "scarce" (contra the Linear principle).
- **Unrelated blues for link/focus/status.** Link `#2563eb`, focus ring `#2563eb` (at 30–50% alpha),
  info `#175cd3`, primary-soft `#eff6ff`, sidebar-active `#1f4e79`. Four blues, two families.
- **Border dominates content at table scale.** `#e5e7eb` at 1px on `#f7f8fb`/`#ffffff` is a
  high-contrast hairline *relative to the pale fills*; combined with full per-row `border-b` it makes
  tables read as "ruled paper" rather than a clean grid (see I).

### F.3 Contrast (measured, WCAG 2.1)

| Pair | Ratio | Verdict |
| --- | ---: | --- |
| body `#111827` on canvas `#f7f8fb` | **16.70** | PASS strong |
| body `#111827` on surface `#ffffff` | **17.74** | PASS strong |
| muted `#6b7280` on canvas `#f7f8fb` | 4.55 | PASS (thin) |
| muted `#6b7280` on surface `#ffffff` | 4.83 | PASS (thin) |
| **subtle `#9ca3af` on canvas `#f7f8fb`** | **2.39** | **FAIL (<3)** |
| table-head `#6b7280` on canvas | 4.55 | PASS (thin) |
| primary button `#fff` on `#2563eb` | 5.17 | PASS (thin) |
| destructive btn `#fff` on `#b42318` | 6.57 | PASS |
| Badge success `#047857` on `#ecfdf5` | 5.21 | PASS (thin) |
| Badge warning `#b54708` on `#fffbeb` | 5.23 | PASS (thin) |
| Badge destructive `#b42318` on `#fef3f2` | 6.05 | PASS |
| Badge primary `#1d4ed8` on `#eff6ff` | 6.16 | PASS |
| Badge muted `#6b7280` on `#f9fafb` | 4.63 | PASS (thin) |
| sidebar text `#d9e2ec` on `#102a43` | 11.18 | PASS strong |
| sidebar-muted `#9fb3c8` on `#102a43` | 6.80 | PASS |
| link `#2563eb` on canvas | 4.87 | PASS (thin) |
| placeholder `#6b7280` on `#ffffff` | 4.83 | PASS (thin) |

**Classification:**

- **Accessibility failure:** `--text-subtle #9ca3af` on canvas = **2.39:1**. It is defined as a token
  and used for the most de-emphasized text. Anywhere it lands on `--bg`/`--surface` it fails WCAG AA
  for *all* text sizes. This is the one hard defect.
- **Technically passing but visually weak:** muted text (4.55), table headers (4.55), badges
  (4.6–6.2), primary button (5.17), links (4.87). All sit just above 4.5 — compliant, but
  collectively they are the reason the UI reads as "gray-on-gray / low-snap."
- **Visually heavy despite passing:** none. Body text (16.7) and sidebar (11.2) are strong and good.

### F.4 Color harmony

- **Temperature:** mixed. Canvas slightly warm; content neutrals cool (gray); sidebar cyan-cool.
- **Hue families:** cool blue dominates (primary, info, focus, sidebar); semantic accents are
  red(700), emerald(700), amber(700) — all darkened "700" tones, which is a deliberate, coherent
  choice and the best harmony decision in the system.
- **Chroma:** low overall (good for "calm technical"). The only chroma noise is the 4 blues.
- **Lightness ladder:** content side has a clean 6-step gray ladder (50→900); sidebar has its own
  4-step ladder. Two ladders, not one.
- **Accent scarcity:** low — primary blue is overloaded (F.2).
- **Semantic balance:** good in *hue* (R/G/B/A distinct), weak in *prominence* (pale soft fills make
  all soft badges similar — F.2/H).

**One coherent neutral family or multiple accidental systems?** → **Multiple.** Content = Tailwind
`gray`; sidebar = cyan-slate; canvas = a one-off warm near-white. This is the root of the "not one
product" feeling.

### F.5 Candidate color directions (recommendation, not authority)

> No replacement values are finalized here. These are directions for the separate implementation
> plan to prototype and A/B against the live screenshots.

**Direction A — Warm Neutral + Indigo Accent (RECOMMENDED)**

- Mood: calm, warm, technical-but-human (closest to the stated "calm technical utility").
- Neutral undertone: a **single warm-neutral ladder** (warm gray, faintly greige), used for *both*
  canvas and a *re-tinted* dark sidebar so the sidebar reads as "deep warm graphite," not "blue
  steel." Unifies the two current gray systems.
- Primary accent: **indigo** (`#4f46e5`-family) — scarcer than the current blue, slightly richer,
  reserved for primary actions + focus only. Links/active badges use a *different* role so primary
  stops being overloaded.
- Status philosophy: keep the darkened "700" semantic tones; **raise soft-fill chroma** (less pale)
  so badges regain identity; reserve filled (solid) badges for truly destructive/active states.
- Advantages: directly fixes the temperature clash; warm neutrals flatter CJK strokes; indigo
  differentiates from generic shadcn-blue.
- Risks: warm neutrals can look "beige" if overdone; must validate against the dark sidebar.
- Samples (directional only): canvas `#faf9f7`, surface `#ffffff`, hairline `#eceae6`, body `#1c1b19`,
  muted `#5c5a55`, primary `#4f46e5`, primary-soft `#eef0ff`.

**Direction B — Neutral White + Technical Blue**

- Mood: precise, clinical, Cal/Linear-like.
- Neutral undertone: a **true cool-neutral ladder** (Tailwind `slate` or a custom neutral), canvas
  pure near-white; **retire the cyan sidebar** to a near-black slate so neutrals are one family.
- Primary accent: a single technical blue, but **de-scope it** from links/badges so it is scarce.
- Status philosophy: as in A, with slightly cooler soft fills.
- Advantages: lowest churn (closest to current grays); reads "developer tool."
- Risks: cool neutrals can make Chinese read starker/colder; "another blue admin UI."

**Direction C — Warm Graphite + Single Scarlet Accent**

- Mood: editorial, distinctive (OpenCode-leaning).
- Neutral undertone: warm graphite content + warm-black sidebar; very restrained.
- Primary accent: **one scarce near-black for primary actions** (Cal.com anchor), with a single
  scarlet reserved for destructive *and* the one true attention role.
- Advantages: strongest identity; warmest CJK rendering.
- Risks: biggest departure; scarlet-as-accent can fight the existing red-destructive semantics.

**Recommendation: Direction A.** It is the most evidence-aligned (fixes the measured temperature
clash and the overloaded primary while preserving the well-chosen 700-tone semantics), and it is
explicitly a *design recommendation*, not implemented authority.

---

## G. Border, radius and elevation audit

### G.1 Computed values by component role

| Component role | Border | Radius | Shadow | Assessment |
| -------------- | ------ | ------ | ------ | ---------- |
| Content card (`surface-content`) | `1px solid #e5e7eb` | `var(--radius)` = 8px (`rounded-lg`) | **none (flat)** | Clean, but flat vs. Card primitive |
| shadcn `Card` primitive | `1px solid #e5e7eb` (via `border-border`) | **`rounded-xl` (12px)** | **`shadow-sm`** | Different radius + has elevation |
| `ContentCard` | Card border | **`rounded-lg` (8px)** override | inherits `shadow-sm` | Overrides radius → 3rd value in play |
| `StatsCard` | surface-content border | 8px | **none (flat by design)** | Deliberately flat; comment-documented |
| Table header cell | row `border-b #e5e7eb` | — | — | No header background; relies on hairline |
| Table row | `border-b` per row | — | hover `bg-muted/50` | "Ruled paper" feel |
| Input / Select | `1px solid --border-strong #d1d5db` | `rounded-md` (6px) | `shadow-xs` | Controls are *tighter* radius than cards (8/12) |
| Button | context (outline: `border`) | size-driven: `rounded-lg`(default)/`rounded-md`(sm/xs) | `shadow-xs` (outline only) | Two button radii; matches input at sm |
| Status badge | none (transparent) | `rounded-md` (6px) | none | Compact rect — good (not a pill) |
| shadcn `Badge` primitive | `border-transparent` | **`rounded-full` (pill)** | none | **Pill** — conflicts with StatusBadge's 6px rect |
| Dialog / AlertDialog | `1px solid #e5e7eb` | `rounded-lg` (8px) | `shadow-lg` | Appropriate elevation ✓ |
| Popover / Dropdown / Select content | `1px solid #e5e7eb` | `rounded-md` (6px) | `shadow-md` | Appropriate ✓ |
| Sheet | (border via bg) | — | `shadow-lg` | Appropriate ✓ |
| Tooltip | `border` | `rounded-md` | none | Fine |
| Topbar (sticky) | `border-b` | — | **none (flat)** in `AdminLayout`; skeleton uses `shadow-xs` | Flat — consistent with "no business shadow" rule |
| Sidebar | `border-r #1b3a57` | — | none | Distinct dark surface; no elevation |
| Empty state | `border-dashed #e5e7eb` | `rounded-lg` | none | Dashed = good signal; own recipe, not surface-content |

### G.2 Findings

**Borders**
- Contrast: hairline `#e5e7eb` is high-contrast *relative to pale fills* → borders dominate tables.
- Temperature: hairline is cool-gray on a warm-ish canvas → slightly mismatched.
- Thickness: a single 1px everywhere (consistent, good); no 2px "strong" border despite a
  `--border-strong` token that is only used for inputs.
- Double-border: the Dashboard "recent exams" `<Card>` (border + shadow) wraps a table whose rows
  also border each other → nested hairlines stack.
- Table-grid roughness: per-row `border-b` + no header fill + no zebra → grid reads as rules.

**Radius**
- Active values: **6px (`rounded-md`), 8px (`rounded-lg`), 12px (`rounded-xl`), and `rounded-full`
  (badge pill).** Four geometries, not one. `--radius` (8px) is the stated system but inputs/buttons/
  badges use 6px and the Card primitive uses 12px.
- Controls (6px) are *tighter* than cards (8–12px) — the inverse of the usual "controls match their
  container" intuition, and the source of mild geometric inconsistency.
- Pills: the shadcn `Badge` primitive is `rounded-full` (pill) while `StatusBadge` (the actual status
  component in use) is `rounded-md` (6px rect). The pill geometry exists but is unused for status —
  good — yet remains a latent inconsistency.

**Elevation**
- Meaningful floating surfaces: Dialog/AlertDialog/Popover/Dropdown/Select/Sheet carry `shadow-md`/`lg`
  and `surface-overlay` owns this — **correct and well-disciplined.**
- Decorative shadows in business content: **0.** `exam-ui/no-business-shadow` is wired as an error
  and the business baseline is genuinely empty (verified: the 7 `shadow-sm` hits in `shared/`+`pages/`
  are all in *comments/tests*, not source). This is a real strength.
- Flat surfaces: `surface-content`, `StatsCard`, topbar, sidebar — all flat by rule. Good.
- Overlays: correct.
- Sticky navigation: topbar is flat (no shadow) per the elevation rule — consistent; only the loading
  *skeleton* of the topbar adds `shadow-xs` (harmless, transient).
- **The real elevation issue is not rule violation but *mixed metaphor*:** on the Dashboard, flat
  `StatsCard`s sit directly above a shadowed `<Card>` table. Both are "cards," but one is flat and
  one is lifted. The viewer cannot tell if elevation means hierarchy or nothing.

---

## H. Badge, tag and status audit

### H.1 Status treatments (all flow through `statusMeta` → `StatusBadge`)

`StatusBadge` renders: `inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium` +
tone class (soft-bg + tone-text) + a Lucide icon at `size-3.5`. The tone→class map:

| Tone | Background | Text | Used by (representative statuses) |
| ---- | ---------- | ---- | --------------------------------- |
| primary | `bg-primary-soft #eff6ff` | `text-primary-soft-foreground` = `--primary-hover #1d4ed8` | published, assigned, in_progress, grading |
| secondary | `bg-secondary` = `--surface #fff` | `text-secondary-foreground` = `--text #111827` | closed, completed, submitted, auto_graded |
| success | `bg-success-soft #ecfdf5` | `text-success #047857` | open, started, graded, saved, ok, passed, fully_graded |
| warning | `bg-warning-soft #fffbeb` | `text-warning #b54708` | queued, disrupted, saving, stale, pending_manual, misconduct_warning |
| destructive | `bg-destructive-soft #fef3f2` | `text-destructive #b42318` | blocked, voided, failed, expired, critical, infraUnavailable, misconduct_serious, not_passed |
| info | `bg-info-soft #eff6ff` | `text-info #175cd3` | (declared; few/no statuses mapped to it in `statusMeta`) |
| muted | `bg-neutral-soft` = `--surface-muted #f9fafb` | `text-muted-foreground #6b7280` | draft, archived, not_started, canceled, infraDisabled, infraUnknown, unknown |

### H.2 Per-status assessment

| Status | Current treatment | Contrast | Visual weight | Problem |
| ------ | ----------------- | -------: | ------------- | ------- |
| draft / archived / not_started | muted: `#f9fafb` bg + `#6b7280` text, icon | 4.63 | low | Fine as "quiet" — but identical to *unknown* and *canceled*, so 4 distinct states look the same |
| published / assigned / in_progress / grading | primary: `#eff6ff` + `#1d4ed8`, icon | 6.16 | medium | Primary-blue badge is visually the *loudest* soft badge — competes with primary buttons |
| open / started / graded / passed / ok | success: `#ecfdf5` + `#047857`, icon | 5.21 | medium | Good; but `#ecfdf5` is so pale it can read almost white at small size |
| closed / completed / submitted / auto_graded | secondary: **`#fff` bg + `#111827` text**, icon | 17.7 | **high (darkest text)** | "Completed/submitted" rendered as **black-on-white** is *heavier* than success — inverted hierarchy |
| queued / disrupted / saving / pending_manual | warning: `#fffbeb` + `#b54708`, icon | 5.23 | medium | Good tone; pale bg again |
| blocked / voided / failed / critical / not_passed | destructive: `#fef3f2` + `#b42318`, icon | 6.05 | medium-high | Good; appropriately the strongest soft tone |
| unknown / canceled | muted | 4.63 | low | same as draft |

### H.3 Problems found

- **Too-heavy filled backgrounds:** none — all badges are soft-fill + dark text (good, restrained).
  The opposite problem exists: **`secondary` is white-on-near-black text** → "completed/submitted"
  is the *heaviest* badge, heavier than success. Hierarchy is inverted.
- **Muddy pastel:** the soft fills (`#ecfdf5/#fffbeb/#fef3f2/#eff6ff/#f9fafb`) are all extremely
  pale; at `h-6 / 12px text` several become hard to tell apart (primary≈info bg identical `#eff6ff`;
  success/warning/destructive separated only by a faint hue). Badges lose identity.
- **Different semantic colors, similar appearance:** primary vs info (same bg), muted vs secondary
  (both near-neutral), success vs warning (both pale). At a glance, a table of badges looks like a
  row of near-white chips with colored text.
- **Status labels competing with primary content:** the icon-at-3.5 + text at 12px in `h-6` is
  compact, but *every* status carries an icon, so icon density adds noise in dense tables
  (e.g. proctor/diagnostics rows).
- **All statuses at the same prominence:** there is no filled/solid variant for the one truly
  destructive/active state. Everything is soft → nothing stands out when it must.
- **Pills vs rects:** StatusBadge is a 6px rect (good, "technical"); the unused shadcn `Badge` is a
  pill. Keep rects; document that pills are retired for status.

### H.4 Proposed status hierarchy (for the implementation plan, not tokens)

```text
NEUTRAL        — draft / archived / not_started / unknown / canceled / infraDisabled
INFORMATIONAL  — published / assigned / in_progress / grading / auto_graded / submitted / completed / closed
POSITIVE       — open / started / graded / saved / ok / passed / fully_graded / connected / infraAvailable
CAUTION        — queued / disrupted / saving / stale / pending_manual / degraded / infraDegraded / misconduct_warning
DESTRUCTIVE    — blocked / voided / failed / expired / critical / not_passed / offline / infraUnavailable / misconduct_serious
```

Design intent (not tokens): NEUTRAL = muted chip; INFORMATIONAL/POSITIVE/CAUTION = soft-fill chips
with *raised chroma* and distinct hue; DESTRUCTIVE = the **only** optionally *solid/filled* badge so
genuine danger is unmissable. Demote `secondary` (black-on-white) out of the status vocabulary so
"completed" stops outranking "success."

---

## I. Table audit

Table is the dominant admin surface (`ExamPage`, `ScoreListPage`, `QuestionPage`, `UsersPage`,
`CandidatesPage`, dashboard recent-exams, grading queue). All flow through the shared `Table`
primitive.

| Dimension | Current (measured) | Problem | Desired direction |
| --------- | ------------------ | ------- | ----------------- |
| Header text | **13px / weight 500 / `#6b7280`** (`TableHead: text-[13px] font-medium text-muted-foreground`) | Arbitrary non-recipe size; visibly smaller than 14px cells; gray-on-near-white is weak | 12px **uppercase + letter-spacing** *or* 13px at weight 600 ink-dark; pick one and own it as a recipe |
| Header background | **transparent** (no fill) | No header band → header relies solely on hairline + small gray text → reads weak | Subtle `surface-subtle` band (`#f9fafb`) OR a bottom 2px rule; give the header a job |
| Row height | `h-11` (44px) | Fine, maybe one step loose for dense admin | Keep 40–44px; offer a `dense` row (36px) for data-heavy pages |
| Cell padding | `px-3 py-2` (12/8) | OK | Keep; tighten `py` in dense variant |
| Column alignment | **all left** (default) | **Numerics (duration, counts, score) are left-aligned** — the #1 table defect | Right-align (or tabular-num center) all numeric columns; keep text left |
| Number alignment | proportional-nums (`type-numeric`/`tabular-nums` **not applied**) | Digits jitter as values change | Apply `type-numeric` (`tabular-nums`) to every numeric column + timers + counts |
| Date/time | `toLocaleDateString()` + " - " join | Locale-dependent; mixed Latin punctuation in CJK row | Consistent `YYYY-MM-DD` or `LL` via i18n; en-dash; mono-nums |
| Hover state | `hover:bg-muted/50` (`#f9fafb` @50%) | Very subtle (nearly invisible) | Slightly stronger row hover; keep muted |
| Selected state | `data-[state=selected]:bg-muted` | OK | Keep |
| Row separators | `border-b` per row (`#e5e7eb`) | "Ruled paper"; borders dominate | Drop row borders; use zebra (`surface-subtle` every other row) OR header rule + hover only |
| Empty state | `EmptyState` (dashed border) | Good, reusable | Keep; ensure inside table shell |
| Action column | ghost icon buttons (Eye/Trash), `flex gap-1` | Icon buttons can dominate narrow rows; delete icon in `text-destructive` is the only color | Right-align actions; tone down; reserve color for hover/active |
| Icon buttons | `size-icon` (32px) in 44px rows | Slightly large vs row | Consider `icon-sm` (32→ ok) consistent |
| Responsive | `overflow-x-auto` only | No column priority/collapse; mobile = horizontal scroll | Define a column-priority map; hide/stack low-priority columns <lg |

**How does the table feel?** → **Too gray, too bordered, too left-aligned.** Density itself is
healthy; the roughness is *tonal* (gray header on gray rules, left-aligned numerics, no header band,
pale hover). Fixing alignment + header treatment + row separators would transform it without touching
density.

---

## J. Form and control audit

| Control | Height | Border / radius | Focus | Hover / disabled | Findings |
| ------- | ------ | --------------- | ----- | ---------------- | -------- |
| Button (default) | `h-9` (36px) | outline: `border` + `shadow-xs`; `rounded-lg` | `focus-visible:border-ring focus-visible:ring-[3px] ring-ring/30` | hover bg; `disabled:opacity-50` | Good. **But `xs`(24px)/`sm`(32px) introduce 2 more heights + `rounded-md`** → 3 button heights/2 radii. Primary uses an *inline* `hover:bg-[var(--primary-hover)]` (var, not token utility) — inconsistent with token-driven peers. |
| Icon button | `size-8` / `icon-sm` / `icon-xs` | ghost/outline | same | hover `bg-muted` | Fine; `Eye`/`Trash` default to no explicit size class in some pages (relies on `[&_svg]:size-4`) — OK. |
| Input | `h-9` | `border-input #d1d5db` + `shadow-xs`; `rounded-md` (6px) | `ring-[3px] ring-ring/50` + border-ring | `disabled:opacity-50`; placeholder `#6b7280` | Solid. Radius (6px) < card radius (8/12px) — minor mismatch. `text-base md:text-sm` avoids iOS zoom — good. |
| Textarea | (ui/textarea) | input-like | same | same | Fine. |
| Select (trigger) | `h-9` (`sm` `h-8`) | input border + `shadow-xs`; `rounded-md` | same | placeholder muted | Chevron at `opacity-50`; consistent with input. |
| Checkbox / Radio / Switch | radix | accent `primary` | radix focus | — | Standard; switch uses `primary` for "on." |
| Tabs | underline/context | radix | — | — | Underline tabs would read cleaner than the default segmented look; verify per page. |
| Dialog actions | footer `border-t px-5 py-4` | — | — | — | Action grouping via `flex gap-2`; no explicit primary-on-right rule → easy to mis-order. |
| Form labels | `text-sm font-medium` (Label primitive) | — | — | — | Good weight; but label hierarchy (field vs section vs group) is flat — only one label size. |
| Help text | `text-sm text-muted-foreground` | — | — | — | Fine; sometimes re-composed per page (drift). |
| Errors | `FieldError` (canonical) + `InlineErrorBanner` | destructive | — | — | Authority exists and is used; tone consistent. |

**Component-level findings (with locations):**

- Three button heights (`xs/sm/default`) + `icon-xs/icon-sm/icon/icon-lg` = **7 size variants**;
  restraint needed — most pages only need `default` + `icon`.
- `button.tsx` primary hover uses an **arbitrary var** `hover:bg-[var(--primary-hover)]` while
  `--color-primary` exists as a token utility — should be a token utility, not an arbitrary bracket.
- Input/Select/Button all carry `shadow-xs` — a tiny elevation on flat controls. It is barely visible
  on light; either commit to it as a "control elevation" rule or remove for a flatter, more
  "calm/Linear" feel. Currently it is too faint to read as intent.
- Focus rings are `ring-ring/30` (button) vs `ring-ring/50` (input/select) — **two alpha values for
  the same role** → inconsistent focus emphasis (Linear principle: strong, explicit, *one* focus
  treatment).
- `FieldError` + `InlineErrorBanner` are well-owned; no issues.

---

## K. Layout and density audit

- **Page max width:** none enforced — content fills the area right of the 232px sidebar; on
  ultrawide, tables stretch edge-to-edge. A `max-w-*` page container would improve reading rhythm.
- **Outer padding:** `main.p-6 lg:p-8` (24/32px). Good.
- **Section gaps:** pages use `flex flex-col gap-6` (24px) between header/cards/tables. Consistent.
- **Card padding:** `surface-content` consumers vary: `PageSection`/`DataTableShell` header `px-5 py-4`
  + content `p-5`; `StatsCard` `p-6`; `Card` primitive `py-6` + `px-6`. **Three internal paddings
  (20/24/24-32)** for "a card." Mild inconsistency.
- **Table density:** healthy (44px rows, 12/8 padding). Not too dense, not too loose.
- **Form density:** `SettingsPage` sections at `gap-4`/`gap-6`; fields at `gap-1.5` (label-input) —
  good rhythm; not cramped.
- **Heading/content rhythm:** `PageHeader` (title 24/700 + description 14/400) → `gap-6` → sections.
  Good vertical cadence.
- **Toolbar alignment:** `DataToolbar` is `surface-content` (its own bordered box) sitting *above*
  `DataTableShell` (another bordered box) → **two adjacent bordered containers** with a 24px gap, no
  visual merge. Either merge toolbar into the shell's header slot or separate clearly.
- **Responsive collapse:** sidebar collapses to 56px (`w-14`) ✓. Tables scroll horizontally ✗ (no
  column priority). Page header stacks (`flex-col sm:flex-row`) ✓.

**Identified issues:** excess nesting is *not* a problem (pages are 2–3 layers deep). The issues are
(a) no page max-width, (b) adjacent bordered containers (toolbar + shell), (c) three card paddings,
(d) tables do not adapt below `lg`.

---

## L. Component consistency

| Role | Implementations found | Visual drift | Recommended owner |
| ---- | --------------------- | ------------ | ----------------- |
| Page header | `PageHeader` (shared) | low — widely used | keep `PageHeader` |
| Titled content container | `PageSection`, `DataTableShell`, `<Card><CardHeader>`, `ContentCard` | **high** — flat surface-content (8px) vs shadowed Card (12px+shadow) vs dashed EmptyState; 3 paddings | reconcile to **one titled-surface owner** (PageSection/DataTableShell via `surface-content`); retire ad-hoc `<Card>` for plain titled regions |
| Stat / KPI | `StatsCard` (shared, `type-metric text-3xl`) + ~20 raw `text-2xl/3xl font-bold` metric bypasses (deferred per AGENTS) | **medium-high** | migrate raw metrics to `StatsCard`/`type-metric` (deferred coverage) |
| Toolbar | `DataToolbar`, `ListToolbar` (collision group noted in AGENTS) | medium | merge to one toolbar owner |
| Filter bar | per-page composition inside `DataToolbar` | low | keep |
| Table | shared `Table` primitive everywhere | low | keep; fix alignment/header (§I) |
| Empty state | `EmptyState` (shared) | low | keep |
| Status badge | `StatusBadge` (shared) via `statusMeta` | low at component level; **high at color/prominence** (§H) | keep component; refine tone map |
| Action group | `RowActions` (shared) + ad-hoc `flex gap-1` | medium | standardize on `RowActions` |
| Dialog | `ConfirmDialog`/`ConfirmActionDialog` (shared) + shadcn `Dialog` | medium (collision group noted) | reconcile confirm-dialog owners |
| Form section | `FormSection`, `FormStack`, `FieldGroup` (shared) | low-medium | keep; ensure single padding scale |
| Inline error | `InlineErrorBanner`, `FieldError` | low | keep |
| Card radius | Card primitive `rounded-xl`, ContentCard `rounded-lg`, surface-content 8px, EmptyState `rounded-lg` | **high** | one radius scale owned by tokens/recipes |

---

## M. Aesthetic diagnosis

**What mood does it currently communicate?**
Functional, neutral, "shadcn-admin default." Competent but characterless; neither warm enough to
feel considered nor precise enough to feel engineered. The dark cyan sidebar gives a hint of
intended seriousness that the warm-white body doesn't follow through on.

**Why does the Chinese typography look fuzzy or unstable?**
- FACT: glyphs are correctly rendered Noto Sans CJK SC (no blur, no synthetic bold).
- LIKELY CAUSE: secondary/header/metadata text at 14px/400 in `#6b7280` (4.55:1) on a warm `#f7f8fb`
  canvas lacks tonal snap; cool-gray text on warm-white reads as "soft." Combined with proportional
  (non-tabular) digits that shift width, lines with numbers visibly jitter.
- DESIGN JUDGMENT: the type *system* is good (real CJK family, correct weights, CJK-aware leading);
  the *color/weight calibration* is what makes it feel unstable.

**Why do borders feel rough?**
- FACT: 1px `#e5e7eb` everywhere, including every table row.
- LIKELY CAUSE: cool-gray hairline on warm canvas + per-row rules + no header fill = "ruled paper."
  The border is doing the header's job because the header has no background.

**Why do badges feel crude?**
- FACT: all badges are pale-soft-fill + colored text + icon; `secondary` is near-black-on-white.
- LIKELY CAUSE: soft fills are *too* pale → badges lose identity and cluster near-white; `secondary`
  inverts hierarchy (completed > success); every badge has an icon → noise in dense rows.

**Where does color hierarchy fail?**
- Sidebar (cyan-slate) vs body (warm gray) — two systems.
- Primary blue overloaded across 6+ roles.
- Pale soft-fills collapse status identity.
- `secondary` badge outranks `success`.

**Which three changes would produce the largest visible improvement?**
1. **Unify the neutral undertone** (one warm-neutral ladder for canvas + re-tinted dark sidebar) and
   retire the cyan sidebar — kills the temperature clash in one move. *(Direction A)*
2. **Refactor the table**: right-align/tabular-num numerics, give the header a subtle band or a 2px
   rule, drop per-row borders (or zebra). Highest-traffic surface; biggest perceived polish gain.
3. **Re-peg the status system**: raise soft-fill chroma, demote `secondary` out of status, reserve
   one solid/filled treatment for DESTRUCTIVE. Makes state legible at a glance.

---

## N. Complexity diagnosis

| Infrastructure | Value | Cognitive cost | Recommendation |
| -------------- | ----- | -------------- | -------------- |
| Semantic color tokens (`:root` vars + `@theme inline`) | high | low | **Keep.** This is the right substrate. |
| Surface recipes (`surface-page/content/subtle/navigation/overlay/attention`) | high | low | **Keep.** Clean region ownership. |
| Typography recipes (`type-*`) | high | medium | **Keep, but finish migration.** ~20 metric bypasses + raw `text-sm` (73× in pages) still bypass recipes. The recipes are right; coverage is the debt. |
| `statusMeta` + `StatusBadge` tone authority | high | low | **Keep; refine the tone map** (§H). |
| `exam-ui/*` ESLint authority rules (no-business-shadow, no-arbitrary-typography, etc.) | high | **high** | **Keep existing; do NOT expand.** The wired rules are proven; adding more parsers/baselines/registries raises cognitive cost without visible payoff. |
| Elevation forward-rule + empty business-shadow baseline | high | medium | **Keep.** Working as intended. |
| Retired structural lint proxies (no-raw-typography, no-raw-surface-recipe, prefer-field-error) | n/a (retired) | — | **Do not resurrect.** Their false-semantic-overlap was real. |
| Two gray systems (Tailwind gray + cyan-slate sidebar) | **negative** | medium | **Remove** by unifying (Direction A). |
| 7 button sizes / 4 radii / 2 focus alphas | low | medium | **Consolidate** — reduce variants. |
| Self-hosted subset Noto CJK (3 weights × 18 subsets) | high | low | **Keep.** Correct offline-capable choice; weights are intentional. |
| 14 inert `dark:` utilities (no dark theme) | none | low | **Either implement dark properly (later) or strip the inert variants** to remove dead code. Not urgent. |

**Prohibition for the next phase:** do **not** add new lint rules, parsers, baseline systems, authority
registries, or closure workflows unless a *real safety defect* is proven. The infrastructure is
sufficient; the deficit is purely visual calibration. Every remaining improvement should be a
**token/value/component-recipe edit** visible to the user, not more meta-machinery.

---

## O. Recommended design direction

> Independent name. Not "make it look like X." A product-specific definition for the exam platform.

### Name: **"Quiet Graphite"** — calm technical utility, warm-neutral and precise

**Visual Theme & Atmosphere**
A quiet, warm-neutral admin tool with the precision of a developer console and the legibility of a
reading app. Calm, not clinical; technical, not terminal. One scarce accent; information density
without visual noise. Inspired by OpenCode's warmth + restraint, Cal.com's clean geometry, Linear's
focus discipline, and Notion's pastel-but-legible status. Rejects: all-mono typography, terminal
branding, colorful marketing composition, dark-by-default.

**Color Palette Philosophy**
One **warm-neutral ladder** owns canvas, surface, borders, text, *and* a re-tinted dark sidebar
(graphite, not cyan-steel) — ending the two-gray-systems clash. Semantic tones keep the current
darkened "700" family (a strength); soft fills **gain chroma** so badges regain identity. The
primary accent becomes **scarcer** (primary actions + focus only); links/active states use a
distinct role. (Borrows Linear's scarcity + Cal.com's near-black anchor option; rejects OpenCode's
mono-everything and Notion's marketing color blocks.)

**Chinese and Latin Typography Philosophy**
Noto Sans CJK SC stays as the project-owned CJK family (already correct). Raise the *snap* of
supporting text by (a) nudging muted text one step darker, (b) reserving weight 400 for body and
moving secondary/metadata to a slightly darker muted tier, (c) applying `tabular-nums` to **all**
numeric roles (tables, timers, counts, scores), and (d) **darkening the topbar page title to ink**
so the primary wayfinding label stops whispering. Latin and CJK share one family (already true); no
second UI family.

**Geometry**
A single **8px base radius** (`--radius`) owned by tokens; controls match their container (6px is
retired or 8px is adopted consistently). Cards/surfaces all 8px; overlays 8px. Pills are retired
from status (rects only). Spacing scale stays 4/8/12/16/24/32.

**Borders**
Warm-neutral hairline, one 1px weight for content, one 2px for emphasis (table header rule,
focused input). Table rows **drop per-row borders** in favor of zebra or header-rule + hover. Ends
the "ruled paper" look. (Borrows Cal.com's clean table geometry; rejects heavy grids.)

**Depth**
Flat by default; elevation owned by `surface-overlay` (dialogs/popovers/dropdowns/sheets) and the
Card primitive *only when a card genuinely lifts*. The Dashboard stops mixing flat StatsCards with a
shadowed table card — pick one metaphor per screen. (Borrows OpenCode/Linear minimal elevation;
rejects decorative shadows.)

**Tables**
Right-aligned tabular-num numerics; subtle header band (`surface-subtle`) or a 2px header rule;
40–44px rows with optional 36px dense; zebra or hover-only row separation; column-priority map for
responsive collapse below `lg`; actions right-aligned and toned down. (Borrows Cal.com/Linear;
rejects the current gray-on-gray ruled grid.)

**Forms**
One control height (36px default, 32px sm), one radius, one focus ring alpha. Labels: field (500),
section title (`type-section-title`), group caps (12px uppercase tracking). Primary action
right-aligned in dialog footers. (Borrows Cal.com control geometry.)

**Badges and Status**
Five-tier hierarchy (NEUTRAL/INFORMATIONAL/POSITIVE/CAUTION/DESTRUCTIVE). Soft fills with **raised
chroma**; DESTRUCTIVE eligible for the only solid/filled treatment. `secondary` (black-on-white)
retired from status. Icons optional per-tone (not mandatory on every badge) to cut dense-row noise.
(Borrows Notion's pastel-but-legible chips; rejects "all badges identical prominence.")

**Interaction States**
One focus treatment (`ring-ring` at one alpha), explicit and strong. Row hover one step more
visible. Disabled via tokenized `--disabled` (not bare opacity) eventually; opacity-50 acceptable
interim. (Borrows Linear's focus discipline.)

**Responsive Behavior**
Page `max-w` container for reading rhythm; sidebar collapses 232→56 ✓; tables get a column-priority
map (hide/stack low-priority columns <lg) instead of horizontal scroll; page headers stack ✓.

**Do's**
- Unify neutrals into one warm-neutral ladder (canvas + sidebar).
- Make numerics tabular-num and right-aligned everywhere.
- Give tables a header treatment and drop per-row rules.
- Raise badge soft-fill chroma; reserve one solid treatment for destructive.
- Darken the topbar title to ink; strengthen muted text one step.
- Keep the token + recipe + status-authority infrastructure as-is.

**Don'ts**
- Don't add lint rules / parsers / registries / baselines.
- Don't introduce a second UI font family.
- Don't mix flat and shadowed "cards" on the same screen.
- Don't overload the primary accent across links + badges + focus + icons + selection.
- Don't ship a dark theme half-implemented (inert `dark:` variants should be resolved intentionally).
- Don't copy any reference palette wholesale.

---

## P. Candidate DESIGN.md outline

For a future, project-owned `DESIGN.md` (concise, agent-friendly). **Not created here** — proposed
structure only.

```text
1. Product Visual Intent        — "Quiet Graphite": calm technical utility; warm-neutral; one accent
2. Color Roles                  — the single warm-neutral ladder + semantic 700-tones + scarce accent
3. Chinese and Latin Typography — Noto CJK first; weights 400/500/700; tabular-nums for numerics
4. Geometry and Spacing         — 8px radius base; 4/8/12/16/24/32 scale
5. Borders and Elevation        — 1px hairline / 2px emphasis; flat default; overlay owns shadow
6. Tables                       — header band/rule; right-aligned tabular numerics; zebra/hover; responsive column priority
7. Forms                        — one control height/radius/focus; label hierarchy; primary-right in dialogs
8. Status and Feedback          — 5-tier badge hierarchy; raised chroma; one solid destructive; FieldError/InlineErrorBanner
9. Navigation and Layout        — graphite sidebar; page max-w; topbar ink title; section cadence
10. Interaction States          — one focus ring; one hover step; tokenized disabled
11. Responsive Rules            — sidebar collapse; table column priority; header stacking
12. Do's and Don'ts             — carry forward §O Do's/Don'ts
```

---

## Q. Prioritized implementation waves

> Every wave produces a **visible** user-facing improvement. No infrastructure-only waves. Each wave
> is sequenced so it can be screenshot-A/B'd against the §C inventory.

### Wave 1 — Foundations: neutrals, accent scarcity, focus, radii

- **Visible outcome:** the whole product stops reading as "two gray systems"; sidebar harmonizes
  with body; one focus ring; one control radius.
- **Files/components affected:** `apps/web/src/index.css` (token values: `--bg/--surface/--border/
  --text-muted/--text-subtle/--sidebar-*`), button/input/select focus alphas, radius consolidation
  (Card `rounded-xl`→base, or adopt 8px everywhere).
- **Risk:** medium — token value changes touch every screen; must keep the existing semantic *names*
  (only values change) so recipes/components need no edits.
- **Required screenshot comparisons:** dashboard, exam list, settings, login, sidebar (all viewports).
- **Acceptance criteria:** one neutral undertone across sidebar+body (visual check); one focus alpha;
  `--text-subtle` contrast ≥ 3:1 (or retired); no radius drift between card/control.

### Wave 2 — Tables, badges, buttons

- **Visible outcome:** tables read as clean data grids (right-aligned tabular numerics, header
  treatment, no per-row rules); badges regain identity; destructive is unmissable.
- **Files/components affected:** `components/ui/table.tsx` (header size/treatment, numeric alignment
  hooks), `StatusBadge.tsx` + `statusMeta.ts` tone map (raised chroma, demote secondary, solid
  destructive option), `button.tsx` (consolidate sizes, token-based primary hover).
- **Risk:** medium — table primitive is widely consumed; badge tone-map change is visible everywhere.
- **Required screenshot comparisons:** exam list, score list, users, candidates, system diagnostics,
  proctor, dashboard.
- **Acceptance criteria:** numerics right-aligned + tabular; header has a band or 2px rule; row
  borders removed/zebra; 5-tier badge hierarchy legible; `secondary` no longer outranks `success`.

### Wave 3 — Page headers, cards, filters, dialogs

- **Visible outcome:** consistent titled-surface metaphor (no flat-vs-shadowed card mixing on one
  screen); page max-width rhythm; toolbar+shell no longer double-bordered; dialog action order
  consistent.
- **Files/components affected:** reconcile `PageSection`/`DataTableShell`/`Card`/`ContentCard`
  collision group; `DataToolbar`/`ListToolbar` merge; `PageHeader` + page `max-w`; dialog footer
  action ordering.
- **Risk:** low-medium — mostly composition/recipe selection, few token changes.
- **Required screenshot comparisons:** dashboard, exam list, settings, exam detail, grading queue,
  a dialog (confirm delete), empty state.
- **Acceptance criteria:** one titled-surface treatment per screen; no adjacent double borders;
  consistent card padding; dialog primary action right-aligned.

### Wave 4 — Responsive + polish

- **Visible outcome:** tables adapt below `lg` (column priority, not just scroll); dark-theme
  decision executed (implement properly OR strip inert `dark:` variants); topbar title inked; small
  focus/hover/density refinements.
- **Files/components affected:** table responsive column map, topbar title color, dark-theme
  resolution, metric-recipe migration coverage (the ~20 deferred bypasses).
- **Risk:** low — incremental polish after the structural waves.
- **Required screenshot comparisons:** exam list + dashboard at 1000 / 768 / 420; all Wave-1–3 pages
  re-captured for regression.
- **Acceptance criteria:** no horizontal table scroll <lg for primary surfaces; dark-theme ambiguity
  resolved; topbar title ≥ body-text contrast; metrics on `type-metric`.

---

## R. Risks and unknowns

- **Sidebar re-tint risk:** moving `#102a43` (a liked, recognizable dark) to a warm graphite could
  reduce the product's "serious exam tool" signal if the new graphite is too light or too warm.
  Mitigation: prototype 2–3 graphite values and A/B against the live dashboard screenshot before
  committing.
- **Token-value-only changes can still cascade:** the authority names are stable, but a hairline or
  muted-text change reaches every component. Mitigation: Wave 1 must be reviewed on *all* §C
  surfaces, not just dashboard.
- **No dark theme today:** the 14 `dark:` utilities are inert. Whether dark mode is a *goal* is a
  product decision, not an audit finding. If it is not a near-term goal, stripping the inert variants
  removes dead code; if it is, it is its own multi-wave effort (not in these 4 waves).
- **macOS rendering unverified:** no macOS capture was available. The font stack makes Noto Sans CJK
  SC primary on macOS too, so conclusions should transfer, but PingFang SC fallback behavior at
  small sizes was not measured. Do not claim macOS parity without a capture.
- **Vision-model caution:** automated image descriptions of the screenshots were used only as
  *secondary* corroboration; every visual claim in this report is grounded in source, computed
  styles, or measured WCAG ratios, not in vision-model impression.
- **Status semantic ownership boundary:** AGENTS notes `statusMeta` does not statically own *every*
  status-colored surface (categorical `<Badge>` labels, domain chips). Re-pegging the tone map
  (Wave 2) must respect that boundary — only true domain-status flows through `StatusBadge`.

---

## S. Next gate

```text
UI-VISUAL-REFINE-1:
READY FOR DESIGN DECISION
```

Decision needed before implementation:

1. **Confirm Direction A (Warm Neutral + Indigo) vs B/C** — pick one color direction.
2. **Confirm the sidebar re-tint** is in scope (the highest-impact, highest-risk change).
3. **Confirm dark theme is out of scope** for these 4 waves (strip inert variants later).
4. **Approve Wave 1 acceptance criteria** (token-value-only, all-surface screenshot review).

No production files were modified. No visual implementation was begun. Nothing was pushed.
