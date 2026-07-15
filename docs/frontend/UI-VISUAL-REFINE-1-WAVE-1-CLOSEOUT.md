# UI-VISUAL-REFINE-1-WAVE-1-CLOSEOUT

> Closure record for Wave-1 of the Quiet Graphite visual refinement. The
> implementation review PASSED (`UI-VISUAL-REFINE-1-WAVE-1-REVIEW`). This
> document is the authoritative closeout: commit chain, file changes,
> authority-to-implementation matrix, validation evidence, and the explicit
> Wave-2 boundary.

---

## A. Final verdict

```text
UI-VISUAL-DESIGN-AUTHORITY-1:
CLOSED

UI-VISUAL-REFINE-1-WAVE-1:
CLOSED

UI-VISUAL-REFINE-1-WAVE-2:
NOT STARTED
```

Wave-1 delivered a narrow, token-value-first migration onto the Quiet Graphite
authority. No P0/P1 finding survived the adversarial review. Wave 2 was not
started.

---

## B. Commit chain

```text
9becbfb  feat(ui): implement Quiet Graphite wave 1 foundations   (IMPLEMENTATION)
56050d1  docs(ui): plan visual refinement wave 1                 (PLAN)
30a414a  docs(ui): close Quiet Graphite design authority          (AUTHORITY)
--- base: cd6cf52 (Merge PR #180 feat/frontend-redesign) ---
```

All on branch `feat/ui-visual-fixes`. No force-push, no history rewrite, no
squash. Each commit is narrow and logically scoped.

| commit | purpose | files | +/− |
| --- | --- | --- | --- |
| `30a414a` | Close the design authority (reaudit PASSED) | 6 docs (DESIGN.md, audit, authority, corrective, reaudit, preview) | +4488 |
| `56050d1` | Wave-1 plan (proves narrow scope) | 1 doc (WAVE-1-PLAN) | +318 |
| `9becbfb` | Wave-1 implementation | index.css + button/input/select/AdminLayout/AppSidebar | +45/−34 |

---

## C. Files changed (production)

| File | Change |
| --- | --- |
| `apps/web/src/index.css` | `:root` token VALUES → Quiet Graphite (canvas/surface/ink/hairline/sidebar/primary/status). Semantic names unchanged. |
| `apps/web/src/components/ui/button.tsx` | outline `shadow-xs` removed (flat); focus `/30`→`/50` (one alpha); destructive focus `/20` override removed (inherits indigo ring). |
| `apps/web/src/components/ui/input.tsx` | `shadow-xs` removed (flat); disabled `opacity-50` → tokenized ink-muted/disabled-surface. |
| `apps/web/src/components/ui/select.tsx` | same two edits as input on the trigger. |
| `apps/web/src/components/layout/AdminLayout.tsx` | topbar title muted→ink; `<h2>`→`<div>` so base h2{700} stops overriding 500. |
| `apps/web/src/components/layout/AppSidebar.tsx` | sidebar group labels add `font-medium` (12/500). |

No other production file touched. No page, route, hook, service, test, lint
rule, font, dependency, or migration changed.

---

## D. Authority-to-implementation matrix (token values)

| DESIGN.md role | Token | Old (audit baseline) | Implemented | Authority value | Match |
| --- | --- | --- | --- | --- | --- |
| canvas | `--bg` | `#f7f8fb` | `#faf9f7` | `#faf9f7` | ✓ |
| surface | `--surface` | `#ffffff` | `#ffffff` | `#ffffff` | ✓ |
| surface-subtle | `--surface-muted` | `#f9fafb` | `#f4f2ef` | `#f4f2ef` | ✓ |
| ink | `--text` | `#111827` | `#1f1d1b` | `#1f1d1b` | ✓ |
| ink-muted | `--text-muted` | `#6b7280` | `#6b6760` | `#6b6760` | ✓ |
| ink-disabled (decorative) | `--text-subtle` | `#9ca3af` (2.39 FAIL) | `#8a857b` | `#8a857b` | ✓ |
| hairline | `--border` | `#e5e7eb` | `#e6e2dc` | `#e6e2dc` | ✓ |
| hairline-strong | `--border-strong` | `#d1d5db` | `#d3cec5` | `#d3cec5` | ✓ |
| primary (indigo) | `--primary` | `#2563eb` | `#4f46e5` | `#4f46e5` | ✓ |
| primary-hover | `--primary-hover` | `#1d4ed8` | `#4338ca` | `#4338ca` | ✓ |
| primary-soft | `--primary-soft` | `#eff6ff` | `#eef0fb` | `#eef0fb` | ✓ |
| sidebar-canvas | `--sidebar-bg` | `#102a43` | `#26241f` | `#26241f` | ✓ |
| sidebar-active | `--sidebar-active` | `#1f4e79` | `#4a4538` | `#4a4538` | ✓ |
| sidebar-hover | `--sidebar-hover` | `rgb(255 255 255/8%)` | `#38352e` | `#38352e` | ✓ |
| sidebar-ink | `--sidebar-text` | `#d9e2ec` | `#ece9e3` | `#ece9e3` | ✓ |
| sidebar-muted | `--sidebar-muted` | `#9fb3c8` | `#a8a299` | `#a8a299` | ✓ |
| sidebar-hairline | `--sidebar-border` | `#1b3a57` | `#3a372f` | `#3a372f` | ✓ |
| destructive | `--danger` | `#b42318` | `#b23a17` | `#b23a17` | ✓ |
| destructive-soft | `--danger-soft` | `#fef3f2` | `#fbddcf` | `#fbddcf` | ✓ |
| positive | `--success` | `#047857` | `#047857` | `#047857` | ✓ (unchanged) |
| positive-soft | `--success-soft` | `#ecfdf5` | `#dcf5e9` | `#dcf5e9` | ✓ |
| caution | `--warning` | `#b54708` | `#b54708` | `#b54708` | ✓ (unchanged) |
| caution-soft | `--warning-soft` | `#fffbeb` | `#fdefd9` | `#fdefd9` | ✓ |
| informational | `--info` | `#175cd3` | `#155bbf` | `#155bbf` | ✓ |
| informational-soft | `--info-soft` | `#eff6ff` | `#e3edfb` | `#e3edfb` | ✓ |
| base radius | `--radius` | `0.5rem` | `0.5rem` | `0.5rem` | ✓ (unchanged) |

**25/25 token values match DESIGN.md.** (Two DESIGN-derived alignments:
`--danger-hover=#c2410c` = destructive-solid hover darken target;
`--sidebar-active-soft=#3a372f` = sidebar-hairline, retiring the stale light-blue
`#edf5fa`. Neither introduces a new role.)

---

## E. Token changes (summary)

- **Neutral system unified**: canvas/surface-subtle/hairline/ink/ink-muted all
  moved onto one warm-neutral ladder (hue 36–43°). Cool Tailwind-gray retired.
- **Sidebar re-tinted**: cyan-slate (`#102a43`/`#1f4e79`/`#1b3a57`) → warm
  graphite (`#26241f`/`#4a4538`/`#38352e`/`#3a372f`).
- **Primary → indigo** (`#4f46e5`), scarce; **informational/link blue** stays
  distinct (`#155bbf`).
- **Disabled text** reclassified: `--text-subtle` from a failing 2.39 to the
  decorative `#8a857b`; readable disabled text now uses ink-muted (5.03 AA).
- **Status softs** raised chroma (success/warning/danger/info-soft less pale).

---

## F. Primitive / recipe changes

- **Flat controls**: removed `shadow-xs` from button outline, input, select
  (3 removals, 0 additions). Controls are now `box-shadow: none`.
- **One focus alpha**: button `ring-ring/30` → `/50` (matches input/select);
  destructive no longer overrides to `/20` — inherits the unified indigo ring.
  Focus border-width never changes.
- **Disabled tokenized**: input/select `disabled:opacity-50` →
  `disabled:bg-muted disabled:text-muted-foreground` (5.03 AA).
- **Topbar title**: `text-muted-foreground` → `text-foreground`; element
  `<h2>` → `<div>` so the base `h1,h2,h3 { font-weight: 700 }` rule stops
  forcing 700 over `font-medium` (now a true 14/500/ink).
- **Sidebar group label**: added `font-medium` (12/500).

Recipes (`surface/recipes.css`, `typography/recipes.css`) needed **no edit** —
they read the token vars and cascaded automatically.

---

## G. Tests and commands

```text
pnpm --filter web typecheck        → clean (exit 0)
pnpm --filter web lint:eslint      → clean (exam-ui/* green, 0 warnings)
pnpm --filter web test             → 988 passed (84 files)
pnpm --filter web build            → succeeds (dist 81.62 kB CSS)
node scripts/check-code-quality.mjs (from root) → passed
```

Pre-existing, NOT a Wave-1 regression: `pnpm --filter web lint` (the
console-checker script) fails on a relative-path bug (`apps` resolved from
`apps/web/`); reproduced identically on clean HEAD. The authoritative ESLint
gate (`lint:eslint`) is green.

---

## H. Runtime routes verified

Headless Chromium @1440/1000/420 against `pnpm dev` (demo-seeded `exam` DB;
admin/admin123 + candidate1-4/candidate123). 0 console errors, 0 failed
requests on every route:

```text
/login              body #faf9f7 / ink #1f1d1b / input flat h=36 / primary #4f46e5
/admin/dashboard    sidebar #26241f graphite / active #4a4538 bronze / topbar 14/500/ink
/admin/exams        status badges distinct (gray/blue/green/light-gray); warm header band
/admin/settings     inputs h=36, flat, tokenized disabled
/admin/system       health rows render; sidebar graphite
/exam/list          (candidate shell) warm canvas
```

---

## I. Screenshot coverage

Stored OUTSIDE the repo in `/tmp/wave1-shots/` (per §15; not committed):

```text
login-1440.png       dashboard-1440.png    examlist-1440.png
settings-1440.png    system-1440.png       dashboard-1000.png    dashboard-420.png
```

Vision-model corroboration (dashboard): dark graphite sidebar, warm off-white
canvas, indigo primary button, ink topbar title, no beige content surfaces,
sidebar/body temperature harmony. Exam list: status badges visually distinct.

---

## J. Review findings and disposition

`UI-VISUAL-REFINE-1-WAVE-1-REVIEW: PASS` — 0 P0/P1.

| ID | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| R-01 | P2 | button disabled stays `opacity-50` (input/select tokenized, button base not) | Wave 2 (button-size consolidation touches every variant) |
| R-02 | P3 | sidebar border resolves to hairline (`*` reset cascade overrides `border-sidebar-border`) | Wave 2/3 cascade; pre-existing, not introduced here |
| R-03 | P3 | macOS/Safari Noto @12px unverified | Carried risk; no macOS capture available |

No corrective loop (§18) was required — the review PASSED on first pass.

---

## K. Remaining known gaps (Wave 2+)

1. **statusMeta tone remap** (e.g. `completed` secondary→positive, retire
   `secondary`) — Wave 2. Wave 1 only moved token VALUES; the tone→class
   vocabulary is unchanged.
2. **Button size consolidation** (`xs` 24px / `sm`+`icon` 32px → 36px) — Wave 2.
   Includes full button-disabled tokenization (R-01).
3. **Card radius** (`rounded-xl` 12px → 8px) + surface-content reconciliation —
   Wave 3.
4. **Table redesign** (header band, zebra, right-align + tabular numerics,
   column priority) — Wave 2.
5. **Sidebar border cascade** (R-02) — Wave 2/3.
6. **Exam-shell active link** (`ExamLayout` `text-primary`) semantics — Wave 3.
7. **14 inert `dark:` variants** — later cleanup.
8. **macOS/Safari** Noto @12px capture — environment-limited.

---

## L. Explicit Wave-2 boundary

Wave 2 (NOT STARTED) is expected to cover:

```text
table layout redesign + numeric alignment/tabular migration
statusMeta semantic tone remap (retire secondary; completed→positive etc.)
badge icon-policy migration (dense-table icon omission)
button size consolidation (xs/sm/icon → 36px) + full disabled tokenization
toolbar merging (DataToolbar/ListToolbar)
```

Wave 2 must not begin without a separate plan + review cycle.

---

## M. Stop condition met

```text
UI-VISUAL-DESIGN-AUTHORITY-1 = CLOSED
UI-VISUAL-REFINE-1-WAVE-1   = CLOSED
UI-VISUAL-REFINE-1-WAVE-2   = NOT STARTED
```

Wave 2 was not started while the user is away.
