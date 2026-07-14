# Typography & Visual-Weight Audit — UI-TOKEN-TABLE-FOUNDATION-1 阶段三

> Diagnoses why the UI can read heavy/jagged ("毛躁") at 100% zoom. Evidence
> from real files + a Wegent reference census. This stage audits + recommends;
> corrective is stage 4.

## 1. Font source

- `--font-ui` = `"Noto Sans CJK SC", "Source Han Sans SC", -apple-system,
  BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui,
  sans-serif` (`index.css:19-21`). **Project-owned self-hosted CJK sans is
  primary**; OS CJK fonts are resilient fallbacks only (deliberate, so the same
  typeface renders across Windows/macOS/Linux).
- Web fonts ARE loaded, self-hosted: `index.html:6-10` links
  `/fonts/noto-sans-cjk-sc/css/{regular,medium,bold}.css` +
  `/fonts/noto-serif-sc/css/{regular,bold}.css`. Subsetted woff2 with
  `unicode-range` + `font-display:swap` + `local()`.
- **Weights shipped: 400 / 500 / 700 (sans), 400 / 700 (serif).** No 600 face.
- `body { font-size:14px; font-weight:400; font-synthesis:none }`
  (`index.css:194-201`). `font-synthesis:none` **forbids synthetic bold** — a
  missing weight (e.g. 600) snaps to the nearest real face rather than blurring.

## 2. font-weight census (real counts, business `*.tsx` excl `components/ui`)

| Utility | Count | Notes |
| --- | --- | --- |
| `font-thin/extralight/light` | 0 | — |
| `font-normal` | 12 | acceptable overrides on elements that would inherit medium |
| `font-medium` | 47 (9 pages, 2 shared, 7 exam, 4 layout) | **intended default emphasis** |
| `font-semibold` | 0 | **forbidden** by `consistency.test.tsx:46` + `exam-ui/no-heavy-font-weight` |
| `font-bold` | **11** | legal 700 weight, but **bypasses `.type-metric` recipe** — flagged |
| `font-extrabold/black`, arbitrary `font-[…]`, `style={{fontWeight}}` | 0 | — |

### The 11 `font-bold` defect sites (metric typography recomposed from primitives)

| File:line | Code | Defect |
| --- | --- | --- |
| `AttemptDetailPage.tsx:718,728,737` | `text-3xl font-bold tabular-nums` (total/earned/passing score) | bypasses `.type-metric` |
| `ExamDetailPage.tsx:548,562,574,634,646,658` | `text-2xl font-bold` (6 stat cards) | bypasses `.type-metric`; `StatsCard` exists and correctly uses it |
| `ResultPage.tsx:105` | `text-5xl font-bold` (final score) | bypasses `.type-metric` |
| `ExamTimer.tsx:42` | `font-mono text-xl font-bold leading-tight tabular-nums` (timer) | bypasses metric/numeric recipe |

`font-bold` == 700, which `.type-metric` also uses — so the **weight** is legal.
The defect is structural: pages hand-roll `text-Nxl font-bold tabular-nums`
instead of the recipe (which fixes size at `1.75rem`, line-height `2.125rem`),
producing inconsistent metric sizing (`text-2xl`/`3xl`/`5xl` across pages vs the
canonical 28px).

## 3. Existing typography recipes (`typography/recipes.css`)

| Recipe | size / weight / line-height / color |
| --- | --- |
| `type-page-title` | 1.5rem / 500 / 2rem / `--text` (`letter-spacing:-0.01em`) |
| `type-page-description` | 0.875rem / 400 / 1.375rem / `--text-muted` |
| `type-section-title` | 1rem / 500 / 1.5rem / `--text` |
| `type-body` | 0.875rem / 400 / 1.375rem / `--text` |
| `type-secondary` | 0.875rem / 400 / 1.375rem / `--text-muted` |
| `type-metadata` | 0.75rem / 400 / 1.125rem / `--text-muted` |
| `type-reading` | 1.25rem / 500 / 2rem / `--text` (`--font-reading`) |
| `type-long-response` | 0.875rem / 400 / 1.625rem / `--text` (pre-wrap) |
| `type-metric` | 1.75rem / **700** / 2.125rem / `--text` (tabular-nums) |
| `type-numeric` | tabular-nums only |
| `type-code` | 0.75rem / 400 / 1.25rem / `--font-mono` |

This is a sound, CJK-aware recipe set (snug line-heights 1.4–1.7, weight palette
400/500/700 matching shipped faces). The gap is **migration coverage**, not the
recipes themselves.

## 4. Icon stroke-width

- Governed icon system = `AppIcon.tsx` SIZE_CONFIG: `badge/inline`=16px stroke
  **1.5**; `nav/metric`=20px stroke **2**; `large/state/hero`=24/32/40px stroke
  **2**. All pass `absoluteStrokeWidth`.
- CSS backstop (`index.css:231-239`): ungoverned 16px svgs inside shadcn
  primitives (select/checkbox/dropdown/dialog/sheet/pagination) forced to
  `stroke-width:1.5` to match the governed inline weight.
- **Only 2 ad-hoc** `strokeWidth={1.5}` exist (`TakeExamPage.tsx:855,915`) —
  acceptable. Distinct stroke values used system-wide: **1.5 and 2** only.

## 5. Other jaggedness sources (checked, all clean)

`transform:scale()` = 0; `filter`/`backdrop-filter` = 0; `text-shadow` = 0;
forced `-webkit-font-smoothing` = none (`@apply antialiased` on body is
standard, not an override); `letter-spacing` anomalies = none in production
(`type-page-title -0.01em` is intentional tightening; dev-only lab used
`0.04em uppercase`, now deleted).

## 6. Root-cause summary

| Rank | Cause | Evidence |
| --- | --- | --- |
| **Primary** | 11 sites recompose metric typography from `text-Nxl font-bold tabular-nums` instead of `.type-metric`, yielding inconsistent large-number sizing that reads as visual noise | §2 table |
| Secondary | `tag-badge` recipe hardcodes `#f2f4f7/#475467` (token-bypass, non-themeable) | token audit §4 |
| Tertiary | Inert `dark:` residue on 6 primitives (harmless but dead) | token audit §1 |

The weight palette itself is **already disciplined** (400/500/700, semibold
forbidden, synthesis off). The "heavy" feeling is not from over-use of 600/700
globally — it is from the metric-recipe bypass cluster.

## 7. Wegent weight reference (real census, `/home/hoo/Source/Wegent`)

`grep -roF` across `frontend/src`:

| Utility | Wegent count |
| --- | --- |
| `font-medium` | **896** (dominant) |
| `font-normal` | 35 |
| `font-semibold` | 161 (mostly workbench titles, chat bubbles) |
| `font-bold` | 22 |

**Comparison (structure only, not values):** Wegent's distribution confirms the
target direction — medium (500) is the workhorse, normal (400) for de-emphasis,
and 600/700 are genuinely rare. Our palette (400/500/700, semibold banned) is
*more* restrained than Wegent's, which is appropriate for a proctored exam
console. Wegent's `globals.css` body: `font-family 'Google Sans Flex'…`,
`-webkit-font-smoothing:antialiased`; status via `--color-success/error/warning`
(not bg/text/border triples). **We absorb the weight discipline and the neutral
surface ladder; we reject their brand purple and v3 config.**

## 8. Recommended corrective (→ stage 4)

1. Migrate the 11 `font-bold` metric sites to `.type-metric` (or a thin
   metric-size variant if a page genuinely needs a non-28px metric — recorded).
2. `ResultPage` final score (`text-5xl`) — if 28px is too small for a hero
   score, add a **named** recipe extension rather than another ad-hoc utility.
3. Fix `tag-badge` token bypass (token audit §7).
4. Do **not** blanket-flatten weights to 400 — the audit shows weights are
   already correct by role; only the metric cluster needs structural migration.

## 9. Claim discipline

Proven facts: §1–§6 (file-sourced). Wegent §7 is sourced from the live local
clone. Unproven visual hypotheses: none outstanding — the root cause is
structural (recipe bypass), not a subjective "feels heavy" claim.
