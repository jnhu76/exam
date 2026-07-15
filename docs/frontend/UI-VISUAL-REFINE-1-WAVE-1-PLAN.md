# UI-VISUAL-REFINE-1-WAVE-1-PLAN

> Wave-1 implementation plan for the **Quiet Graphite** visual authority. The
> authority is **CLOSED** (`UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1-READUDIT`).
> This plan proves Wave-1 stays narrow and lists the exact token-value and
> minimal-primitive edits that move the live application from the current audit
> baseline (cool-gray + cyan sidebar + indigo-overloaded blue) onto the Quiet
> Graphite direction.

---

## A. Verdict and scope

**Wave 1 = foundations only, expressed overwhelmingly through token values.**

The single highest-leverage edit is the `:root` token block in
`apps/web/src/index.css`. Most of the visual transformation is achieved by
changing **values**, not names — every recipe, primitive, and page reads the
semantic tokens, so a value change cascades without per-page edits.

In scope (§7):

```text
neutral token values        (canvas / surface / subtle / ink / muted / hairline)
text token values           (ink, ink-secondary, ink-muted; retire text-subtle drift)
border token values         (hairline, hairline-strong)
sidebar re-tint             (cyan-slate → warm graphite ladder)
primary/link/focus split    (primary→indigo; link→technical blue; focus→indigo ring)
status color token values   (where already token-owned: success/warning/danger/info)
radius                      (--radius already 8px; confirm)
stable focus treatment      (one alpha; controls flat)
flat control elevation      (remove shadow-xs on button/input/select)
topbar title color/weight   (muted → ink)
disabled text treatment     (opacity-50 → ink-muted on disabled-surface)
```

Out of scope (Wave 2/3/4, §7 — DO NOT touch in Wave 1):

```text
table layout redesign           (header band, zebra, right-align numerics)
numeric-column migration        (per-page tabular-nums)
statusMeta semantic remapping   (tone-class vocabulary stays; only token VALUES change)
badge icon-policy migration
toolbar merging
card composition migration      (Card rounded-xl→8px; surface-content reconciliation)
page max-width changes
dialog action reordering
mobile column-priority redesign
button SIZE variant consolidation (xs/sm/icon 32px→36px)   ← Wave 2
radius-class consolidation on primitives (input rounded-md→8px) ← Wave 2
new responsive behavior
```

> **Critical boundary on status semantics:** the Quiet Graphite §8.4 status
> *tier* remapping (e.g. `completed→POSITIVE`, `submitted→INFORMATIONAL`,
> retiring `secondary`) is a **semantic** change to `statusMeta.ts` tone classes.
> That is **Wave 2** (statusMeta semantic remapping is explicitly excluded by
> §7). Wave 1 only changes the **token VALUES** behind the existing tone
> vocabulary (`--success`, `--warning`, `--danger`, `--info`), so the existing
> tone→class map keeps working while its colors move onto Quiet Graphite's
> darkened-700 + raised-chroma-soft values. A narrow correctness exception: if a
> production status would render with a hard contrast failure under the new
> tokens, a minimal compatibility value is permitted — but no key→tier remap.

---

## B. Authority inputs

| Input | Role |
| --- | --- |
| `DESIGN.md` (v1.1) | **Sole visual authority** — token values, §2 color roles, §3 typography, §5 focus, §6 components, §Validation. |
| `docs/frontend/UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1-READUDIT.md` | Reaudit = CLOSED; 41 colors verified, 41 status mappings verified. |
| `docs/frontend/UI-VISUAL-DESIGN-AUDIT-1.md` | Current-state baseline (the values being replaced). |
| `apps/web/src/index.css` | Token `:root` owner + `@theme inline` map. |
| `apps/web/src/surface/recipes.css` / `typography/recipes.css` | Recipe owners (read var() tokens — cascade automatically). |
| `components/ui/{button,input,select,card}.tsx` | Primitive owners (read tokens via Tailwind `bg-*`/`text-*`/`border-*` utilities → `@theme inline`). |
| `components/layout/{AdminLayout,AppSidebar}.tsx` | Topbar title + sidebar group label. |

---

## C. Current-to-target token matrix

All target values are copied verbatim from `DESIGN.md` §Token (the authority).
Migration mechanism is uniformly "change the value in `index.css:88-118`";
consumers need no edit because they reference the token name.

| Token (index.css) | Current value (audit baseline) | Target DESIGN.md role | Target value | Consumers | Mechanism | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| `--bg` | `#f7f8fb` (warm-ish cool) | canvas | `#faf9f7` | body, surface-page, topbar behind | value edit | low — same lightness tier |
| `--surface` | `#ffffff` | surface | `#ffffff` (unchanged) | cards, surface-content | none | none |
| `--surface-muted` | `#f9fafb` | surface-subtle | `#f4f2ef` | zebra, table-header band, surface-subtle | value edit | low |
| `--text` | `#111827` (gray-900) | ink | `#1f1d1b` (warm) | body, titles, cells | value edit | low (16.8→16.8 AAA) |
| `--text-muted` | `#6b7280` (gray-500) | ink-muted | `#6b6760` (warm) | secondary, metadata, th, topbar, placeholders, **disabled text** | value edit | low (5.03–5.62 AA) |
| `--text-subtle` | `#9ca3af` (**2.39 FAIL**) | (retire from text use) | `#8a857b` (ink-disabled, decorative-only) | rarely used; keep token but it is non-text | value edit + verify no readable text uses it | medium — must confirm no readable text depends on it |
| `--border` | `#e5e7eb` (cool gray) | hairline | `#e6e2dc` (warm) | card borders, dividers | value edit | low |
| `--border-strong` | `#d1d5db` (gray-300) | hairline-strong | `#d3cec5` (warm) | input/select borders | value edit | low |
| `--primary` | `#2563eb` (blue-600) | primary (indigo) | `#4f46e5` | primary buttons, focus ring, `--ring` | value edit | **medium** — scarcer accent; verify links are NOT on primary |
| `--primary-hover` | `#1d4ed8` | primary-hover | `#4338ca` | button hover | value edit | low |
| `--primary-soft` | `#eff6ff` | primary-soft | `#eef0fb` | primary badge bg | value edit | low |
| `--ring` | `= --primary` | focus | `= --primary` (indigo) | focus ring | inherits | none |
| `--sidebar-bg` | `#102a43` (**cyan-slate**) | sidebar-canvas | `#26241f` (graphite) | AppSidebar aside | value edit | **HIGH** — highest-risk visual change; A/B mandatory |
| `--sidebar-active` | `#1f4e79` (steel blue) | sidebar-active | `#4a4538` (bronze-graphite) | active nav bg, avatar fallback | value edit | **HIGH** — active state hue change |
| `--sidebar-active-soft` | `#edf5fa` | (no DESIGN role) | retire / leave unused | (unused in practice) | verify | low |
| `--sidebar-hover` | `rgb(255 255 255 / 8%)` | sidebar-hover | `#38352e` | nav hover | value edit | medium (alpha→solid) |
| `--sidebar-text` | `#d9e2ec` | sidebar-ink | `#ece9e3` | nav primary text | value edit | low |
| `--sidebar-muted` | `#9fb3c8` | sidebar-muted | `#a8a299` | inactive nav, group heads | value edit | low |
| `--sidebar-border` | `#1b3a57` | sidebar-hairline | `#3a372f` | sidebar dividers | value edit | low |
| `--danger` | `#b42318` | destructive | `#b23a17` (warm red-orange) | destructive btn, danger badge text | value edit | low |
| `--danger-hover` | `#912018` | (primary-active family) | `#c2410c`* alignment / keep | button hover | value edit | low |
| `--danger-soft` | `#fef3f2` | destructive-soft | `#fbddcf` | danger badge bg, inline error | value edit | low |
| `--success` | `#047857` | positive | `#047857` (**unchanged**) | success badge text | none | none |
| `--success-soft` | `#ecfdf5` | positive-soft | `#dcf5e9` (raised chroma) | success badge bg | value edit | low |
| `--warning` | `#b54708` | caution | `#b54708` (**unchanged**) | warning badge text | none | none |
| `--warning-soft` | `#fffbeb` | caution-soft | `#fdefd9` (raised chroma) | warning badge bg | value edit | low |
| `--info` | `#175cd3` | informational (link-family blue) | `#155bbf` | info badge text | value edit | low |
| `--info-soft` | `#eff6ff` | informational-soft | `#e3edfb` | info badge bg | value edit | low |
| `--radius` | `0.5rem` (8px) | base | `0.5rem` (8px) (**unchanged**) | all recipes | none | none |

\* `--danger-hover` is consumed only by the destructive button hover
(`button.tsx: hover:bg-[var(--danger-hover)]`). DESIGN does not define a
separate destructive-hover; the destructive button is `destructive-solid` and
has no hover token in §6. To stay minimal, keep `--danger-hover` aligned with
`destructive-solid` (`#c2410c`) so the hover is a subtle darken of the solid
fill, not a new role. (No new token introduced.)

### Net additions / retirements

- **No new tokens.** Every change is a value edit to an existing root token.
- **No token retired.** `--sidebar-active-soft` and `--text-subtle` remain
  defined (recipes/primitives may still reference them) but `--text-subtle` is
  reclassified to the decorative `ink-disabled` value and its readable-text use
  is verified absent.

---

## D. Exact files to modify

| File | Change | Why (Wave-1 rule) |
| --- | --- | --- |
| `apps/web/src/index.css` | Edit `:root` token VALUES (lines ~88-118) per matrix §C. | §7 neutral/text/border/sidebar/primary/link/focus/status token values. |
| `apps/web/src/components/ui/button.tsx` | (a) remove `shadow-xs` from `outline` variant → flat; (b) unify focus alpha: `focus-visible:ring-ring/30` → `focus-visible:ring-ring/50` (match input); (c) keep sizes/radii untouched (Wave 2). | §11.5 stable focus (one alpha); §11.6 flat controls. |
| `apps/web/src/components/ui/input.tsx` | (a) remove `shadow-xs` → flat; (b) disabled: `disabled:opacity-50` → `disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100` (tokenized disabled text, AA). Keep `rounded-md`, `h-9` (Wave 2). | §11.6 flat; §11.7 disabled text = ink-muted on disabled-surface. |
| `apps/web/src/components/ui/select.tsx` | Same two edits as input on the trigger: remove `shadow-xs`, disabled → tokenized. | §11.5 / §11.6 / §11.7. |
| `apps/web/src/components/layout/AdminLayout.tsx` | Topbar title `text-muted-foreground` → `text-foreground` (ink); keep `text-sm font-medium` (14/500). | §11.3 topbar title = 14/500/ink. |
| `apps/web/src/components/layout/AppSidebar.tsx` | Sidebar group label `tracking-wider` (no weight) → add `font-medium` (12/500). Active nav already `font-medium`. | §11.3 sidebar-group-label = 12/500. |

**Explicitly NOT modified in Wave 1** (Wave 2/3):
`components/ui/card.tsx` (radius/shadow), `button.tsx` size variants,
`table.tsx`, `StatusBadge.tsx` tone map, `statusMeta.ts`, any business page,
`@theme inline` (the indirection layer — it already maps names to tokens, so
changing token values is sufficient).

---

## E. Explicit non-goals

1. Do **not** remap `statusMeta.ts` tone classes (e.g. `completed` secondary→
   positive). That is Wave 2. Only token VALUES change.
2. Do **not** consolidate button size variants (`xs`/`sm`/`icon` 32px→36px).
   Wave 2.
3. Do **not** change `Card` radius (`rounded-xl`) or `surface-content`
   composition. Wave 3.
4. Do **not** redesign the table (header band, zebra, numeric alignment). Wave 2.
5. Do **not** add lint rules, parsers, registries, baselines, token generators,
   screenshot infra, dark-theme infra, fonts, or dependencies (§3.2).
6. Do **not** introduce indigo on links, status badges, sidebar selection, or
   icons (§11.2). Links stay on a distinct blue (`--info` family) — verify no
   link currently binds to `--primary`.
7. Do **not** add `font-weight: 600` anywhere (§11.3).
8. Do **not** change focus border-WIDTH on any control (§11.5) — only color +
   ring alpha unification.

---

## F. Component-specific changes (detail)

### F.1 Buttons (`button.tsx`)
- `outline` variant: drop `shadow-xs` (flat). The default/secondary/ghost
  variants already have no shadow.
- Focus alpha: the base cva string has `focus-visible:ring-ring/30`; the
  `destructive` variant overrides to `focus-visible:ring-destructive/20`.
  DESIGN §5.5 mandates ONE ring alpha (0.25) on every control including
  destructive. Unify: base → `ring-ring/50`; destructive → drop its
  `/20` override so it inherits the indigo ring at the unified alpha (DESIGN:
  destructive uses INDIGO focus, not red). This is the minimal edit that
  achieves "one ring, one alpha" without restructuring variants.
- Primary hover `bg-[var(--primary-hover)]`: keep as-is (it already reads the
  token; only the value changes). Not a Wave-1 concern.
- Sizes/radii: untouched.

### F.2 Input (`input.tsx`) / Select (`select.tsx`)
- Remove `shadow-xs` (flat controls).
- Disabled: replace `disabled:opacity-50` with
  `disabled:bg-muted disabled:text-muted-foreground` (and keep
  `disabled:cursor-not-allowed`). `--muted`/`--surface-muted` becomes
  `surface-subtle #f4f2ef` = `disabled-surface`; `--text-muted` becomes
  `ink-muted #6b6760` → **5.03 AA-normal** (DESIGN §11.7 / §2).
- Keep `rounded-md` (6px) and `h-9` — radius consolidation is Wave 2.
- Focus border-width already stable at 1px (`focus-visible:border-ring` changes
  color only). No width change. PASS, no edit needed beyond alpha (input already
  at `/50`).

### F.3 Topbar title (`AdminLayout.tsx:58`)
- `<h2 className="text-sm font-medium text-muted-foreground">` →
  `<h2 className="text-sm font-medium text-foreground">`. 14/500/ink.

### F.4 Sidebar group label (`AppSidebar.tsx:248,261`)
- `text-xs uppercase tracking-wider text-sidebar-muted` → add `font-medium`.
  Result: 12/500/UPPER/`sidebar-muted` (matches DESIGN sidebar-group-label).

---

## G. Risk analysis

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Sidebar re-tint reads "muddy" or too dark vs canvas | medium | high (most-visible change) | A/B screenshot dashboard before/after at 1440+420; values are DESIGN-authoritative (closed authority), so revert only on a reproducible contrast/harmony defect, not preference. |
| `--primary` indigo over-saturates existing blue consumers (links, selection) | medium | medium | Pre-scan all `text-primary`/`bg-primary`/`ring-primary` consumers; classify each as primary-action (keep) vs link/info (should NOT be primary). If a link binds to `--primary`, route it to `--info` (Wave-1 correctness, not new scope). |
| `--text-subtle` reclassification breaks a readable-text consumer | low | medium (contrast) | grep all `text-subtle`/`subtle` consumers; confirm none carries readable text. If any does, migrate it to `--text-muted` (Wave-1 correctness). |
| Focus alpha unification changes destructive-button focus appearance | low | low | DESIGN explicitly mandates indigo focus on destructive; the `/20`→unified change is the intended direction. |
| Disabled tokenization changes disabled-button contrast | low | low | Recompute: ink-muted `#6b6760` on `#f4f2ef` = 5.03 AA. Verified. |
| Token value edit cascades to an unreviewed page | medium | low | Wave-1 validation screenshots span login, dashboard, exam list, settings, system, candidate list, exam runtime (§14). |

---

## H. Test and lint gates

```text
pnpm --filter web typecheck        (baseline green; must stay green)
pnpm --filter web lint             (exam-ui/* rules must stay green)
pnpm --filter web test             (recipe/typography/status authority tests)
pnpm --filter web build            (production build)
```

Focused first, then broader. No new tests required (§3.2 forbids new test
frameworks); existing authority tests (`recipe`/`typography`/`StatusBadge`)
guard the structure. If an existing test asserts a literal old color value, it
is updated to the new DESIGN value (the test was asserting the old baseline, not
the authority).

Record exact commands + results in the closeout.

---

## I. Screenshot matrix

Before/after at three viewports, captured via headless Chromium against
`pnpm dev` (demo-seeded `exam` DB, credentials in `.env`):

```text
1440×900  1000×900  420×900
```

Surfaces:

```text
/login
/admin/dashboard
/admin/exams
/admin/settings
/admin/system
/exam/list
/exam runtime (candidate1 in-progress)
```

Focus states (1440):

```text
primary button · secondary button · input · invalid input · select · sidebar item
```

Screenshots stored OUTSIDE the repo (`/tmp`) unless committed evidence is later
required.

---

## J. Rollback / commit structure

Single narrow implementation commit:

```text
feat(ui): implement Quiet Graphite wave 1 foundations
```

If the adversarial review (Phase E) finds a defect, add a corrective commit
(`fix(ui): resolve wave 1 review findings`) — do not amend.

Rollback = `git revert <wave-1 commit>` (token-only change is fully reversible;
no schema/migration/dependency change is introduced).

---

## K. Acceptance criteria

1. **One warm-neutral temperature** across canvas, surface, hairline, ink, AND
   the graphite sidebar (hue 36–43°). No cyan sidebar residue.
2. **Indigo scarce**: primary actions + focus only. Links/informational stay on
   the `--info` blue family. Sidebar active = graphite-bronze, not indigo.
3. **Weights 400/500/700 only.** No 600 introduced.
4. **Topbar title** = 14/500/ink.
5. **Focus**: one alpha (0.25 ≈ `/50` at the rendered indigo), border width
   stable at 1px on every control, destructive uses indigo focus.
6. **Controls flat** (no `shadow-xs` on button/input/select).
7. **Disabled text** = `ink-muted` on `disabled-surface` = 5.03 AA.
8. **No new tokens, lint rules, parsers, dependencies, fonts.**
9. All gates (typecheck/lint/test/build) green.
10. `statusMeta.ts` tone→class map unchanged (only token values moved).

---

## L. Stop condition

Wave-1 implementation stops when:
- all §K acceptance criteria are met AND verified by the adversarial review
  (Phase E → `UI-VISUAL-REFINE-1-WAVE-1-REVIEW: PASS`), OR
- a genuine blocker under §21 is proven.

Wave 2 is NOT started.
