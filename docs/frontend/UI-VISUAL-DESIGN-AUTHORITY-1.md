# UI-VISUAL-DESIGN-AUTHORITY-1 — Evidence & Decision Report

> Companion to **`DESIGN.md`** (v1.1, the operational authority), **`docs/frontend/design-preview.html`**
> (the visual specimen), and **`docs/frontend/UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1.md`** (the
> corrective record). This is the evidence/decision record, not a second authority — `DESIGN.md`
> remains the single source of truth for appearance.
>
> **Corrected by UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1.** The original authority claimed PASS
> prematurely. The corrected status is recorded in §A below. Stale claims from the original report
> (weight-600 support, disabled-text contrast, touch-target PASS, swatch count, state coverage,
> optional control shadow, status determinism, components front-matter, preview coverage) have been
> corrected throughout this document.

---

## A. Verdict

```text
UI-VISUAL-DESIGN-AUTHORITY-1:
PASSED ONLY AFTER CORRECTIVE-1
(currently: REAUDIT REQUIRED)

UI-VISUAL-REFINE-1:
BLOCKED

QUIET-GRAPHITE-DIRECTION:
RETAINED
```

The original authority established the Quiet Graphite direction and palette correctly but contained
internal contradictions (a `font-weight: 600` used in roles while only 400/500/700 are loaded; an
11px sidebar-group-label although Chinese is permitted there; a focus rule that changed border width
on inputs; an `elevation.control` token despite the "controls are flat" rule; an incomplete status
mapping that left semantic decisions to pages; a missing `components:` front-matter despite claiming
it). Corrective-1 resolved all of them. **The authority is now internally consistent and validated.**
The next gate is adversarial **reaudit**.

---

## B. Files

| File | Purpose | Status |
| --- | --- | --- |
| `DESIGN.md` (repo root) | **Operational authority** (v1.1). Stitch/VoltAgent format: token front-matter (incl. `components:`) + 12 prose sections + validation table + complete status mapping. | CORRECTED |
| `docs/frontend/design-preview.html` | **Standalone specimen.** 41 color roles (grouped), static state specimens, ZEBRA table, no FAB. | CORRECTED |
| `docs/frontend/UI-VISUAL-DESIGN-AUTHORITY-1.md` | **This evidence/decision report.** | CORRECTED |
| `docs/frontend/UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1.md` | **Corrective record** — disposition of every review finding. | NEW |

**Not created/modified (forbidden):** lint rules, parsers, registries, baselines, token generators,
schema systems, test frameworks, production React components, production CSS, dark theme, FAB
component, new responsive UX, new status framework, a second design direction. Production files
(`apps/**`, `packages/**`, `statusMeta.ts`, etc.) untouched.

---

## C. Inputs consumed

- `docs/frontend/UI-VISUAL-DESIGN-AUDIT-1.md` — evidence + diagnosis.
- Current frontend implementation (`index.css`, recipes, `components/ui/*`, `components/shared/*`).
- **`apps/web/src/lib/statusMeta.ts`** — read in full; all **41 status keys** extracted for the
  one-to-one mapping (DESIGN.md §8.4).
- **VoltAgent/awesome-design-md** (Context7) — DESIGN.md format + reference anchors (OpenCode warm
  canvas/ink, Supabase elevation tiers, Resend focus pattern). No external palette copied.

---

## D. Final design decisions (corrected)

| Decision | Operationalization |
| --- | --- |
| Quiet Graphite | Warm-neutral canvas `#faf9f7` + graphite sidebar `#26241f` + scarce indigo `#4f46e5`. |
| Sidebar re-tint IN SCOPE | Cyan-slate `#102a43` retired → warm graphite (hue 42.9°, same family as canvas). |
| Weights 400/500/700 ONLY | **All 600 removed.** table-header/topbar-title/sidebar-group-label/label → 500. (No 600 face; Corrective-1.) |
| No 13px role | Every former 13px use → 12px (metadata/help/badge/annotation) or 14px (body/popover/desc/button). |
| 12px Chinese floor (absolute) | sidebar-group-label raised 11px→**12px/500** (Chinese permitted there). |
| Focus = stable 1px border + indigo color + ring | **No focus-time border-width change on any control** (Corrective-1). Destructive also uses indigo focus. |
| Controls FLAT | `elevation.control` **removed**; controls `box-shadow: none`. Depth only for popover/dropdown/sheet/dialog/modal. |
| Table = ZEBRA, no per-row borders | row-hover `#efe9df`, row-selected `#e8e1d3` (warm, distinct, overrides by source order). |
| Disabled TEXT = ink-muted | ink-muted on disabled-surface = **5.03:1 AA**. ink-disabled restricted to non-text decorative. |
| Buttons 36px (no 32px variant) | default AND small = 36px; icon = 36×36; touch-min 36×36. |
| Status mapping deterministic | 41 keys → 5 tiers, one-to-one (DESIGN.md §8.4). No per-page semantic decisions. |
| Destructive SOLID allowlist | critical / misconduct_serious / infraUnavailable-blocking only (DESIGN.md §8.3). |
| `components:` front-matter | Added — 21 component entries referencing token names (Corrective-1). |
| Dark theme OUT OF SCOPE | No dark token map. 14 inert `dark:` variants flagged for later. |
| Production FORBIDDEN | Zero production files modified. |

---

## E. Exact palette summary

```text
canvas #faf9f7 · surface #fff · surface-subtle #f4f2ef · surface-raised #fff
ink #1f1d1b · ink-secondary #3d3a36 · ink-muted #6b6760 (muted + DISABLED TEXT) · ink-disabled #8a857b (NON-TEXT)
hairline #e6e2dc · hairline-strong #d3cec5
primary #4f46e5 · hover #4338ca · active #3730a3 · soft #eef0fb · on-primary #fff
link #1d6fdb · link-hover #1559b8
focus #4f46e5 · selection #eef0fb · row-hover #efe9df · row-selected #e8e1d3 · disabled-surface #f4f2ef
sidebar-canvas #26241f · surface #2e2c26 · hover #38352e · active #4a4538 · ink #ece9e3 · muted #a8a299 · hairline #3a372f
neutral #6b6760/#f1ede7 · informational #155bbf/#e3edfb · positive #047857/#dcf5e9
caution #b54708/#fdefd9 · destructive #b23a17/#fbddcf · destructive-solid #c2410c · on-destructive #fff
```

**Color-role count: 41** (programmatically counted from DESIGN.md front-matter; the preview shows
all 41; this count matches exactly — not hand-written).

---

## F. Reference principles — BORROWED / ADAPTED / PROJECT-SPECIFIC / REJECTED

| Reference | Borrowed | Adapted | Project-specific | Rejected |
| --- | --- | --- | --- | --- |
| OpenCode | warm canvas; near-black ink; flat surfaces; quiet hairlines; restrained chroma | cream→`#faf9f7`; text ladder→warm-ink | warm graphite sidebar | mono UI; terminal; ASCII; 4px geometry; marketing |
| Cal.com | form geometry; control sizing; neutral anchors; primary anchor | control h-36; 8px control radius | indigo primary | marketing cards; Cal Sans/palette |
| Linear | scarce accent; explicit focus; deliberate selected states | single accent→indigo; one focus alpha 0.25 | graphite-bronze active nav | dark-first; compressed density; lavender |
| Notion | warm minimalism; restrained geometry; low-chroma status | status→5 tiers, raised-chroma soft, AA-verified | solid-destructive-only policy | marketing cards; illustration; pill overuse |

No external palette copied. **Quiet Graphite is project-specific.**

---

## G. Contrast results (recomputed for every actual text pair — Corrective-1)

Full table in `DESIGN.md §Validation`. Highlights:

- **All ordinary-text pairs meet AA-normal (≥4.5):** ink on every row background 12.9–16.8 (AAA);
  ink-muted 4.66–5.62 across canvas/surface/subtle/**disabled-surface (5.03)**/row-hover;
  all 5 status tier text-on-soft 4.66–5.42; on-primary 6.29; on-destructive 5.18; sidebar-muted 6.12;
  links 4.59–6.33.
- **`ink-disabled` (#8a857b) = 3.28:1** — the only sub-4.5 value. **Explicitly NON-TEXT decorative
  only** (meets 3:1 graphical-object threshold). **Disabled TEXT uses `ink-muted` (5.03:1, AA).**
- The recomputation **supersedes** any earlier contrast number stated in the original report or the
  adversarial review. (The review's stated `2.97:1` is not reused — see Corrective record C-03; the
  accessibility conclusion — disabled-as-text was a defect — remains valid and is now fixed.)

---

## H. Validation performed (task §7, rerun after corrective)

| Check | Method | Result |
| --- | --- | --- |
| All color pairs contrast | Python relative-luminance | PASS — all ordinary-text AA; ink-disabled decorative-only |
| Normal-text WCAG AA | as above | PASS (4.59–16.8) |
| Disabled text = ink-muted on disabled-surface | recomputed | **5.03 AA-normal** |
| No `font-weight: 600` | grep across DESIGN.md + preview | PASS — only 400/500/700 |
| No visible 11px Chinese | preview audit (sidebar-group-label = 12px) | PASS |
| No visible 13px | preview audit (all chrome 12/14) | PASS |
| Visible focus, stable width | preview focus rule + bbox check | PASS — color change only, width 1px throughout |
| primary vs informational distinction | hue (indigo 249° vs blue 214°) + specimen | PASS |
| 5 status-tier distinction | specimen + vision check | PASS — distinct hues; solid most prominent |
| Chinese legibility 12/14/16px | specimen Noto CJK at all three | PASS — 12px floor enforced |
| Tabular numerics | specimen table/metric/timer | PASS |
| Geometry: every button ≥36×36 | bbox (Chromium) — §Validation rerun | PASS — no 32px interactive variant |
| Focus does not change bbox / shift content | bbox diff at focus | PASS — stable 1px border |
| Table states distinct (odd/even/hover/selected) | computed styles + vision | PASS — zebra + row-hover + row-selected all distinct |
| Sidebar/body temperature harmony | hue/chroma (36–43° warm) + ladder | PASS — one family |
| Desktop + narrow render (1440/1000/420) | headless Chromium, 0 errors | PASS — renders all widths |
| Every DESIGN.md color role has a visible specimen | preview enumeration = 41 = front-matter count | PASS (41 = 41) |
| `components:` front-matter exists | YAML parse | PASS — 21 entries |
| No FAB | preview audit | PASS — removed |

**Validation tooling note:** the task suggested "the DESIGN.md validator used by the reference
format." Context7 confirmed VoltAgent/awesome-design-md ships **no standalone validator** (it is a
curated collection, not a tool). Validation was done with standard WCAG relative-luminance +
headless-Chromium bbox/computed-style checks. **No validator dependency was added to the project.**

---

## I. Preview coverage (corrected)

`docs/frontend/design-preview.html` includes all required elements and the Corrective-1 additions:

1. ✅ **All 41 color roles** grouped into: surfaces / text-ink / borders / primary states / link
   states / interaction states / sidebar states / status foregrounds / status backgrounds / on-color
   foregrounds (10 groups).
2. ✅ Neutral ladder beside graphite sidebar ladder.
3. ✅ Typography hierarchy (Chinese/English/mixed) — weights 400/500/700 only, no 600, no 13px.
4. ✅ Numeric samples (scores/%/durations/dates/timer/counts) — all tabular.
5. ✅ Buttons in every state — **with permanent static specimens** (`.is-hover`/`.is-active`/
   `.is-focus`/`.is-disabled`) mirroring pseudo-classes.
6. ✅ Inputs/select/checkbox/radio/switch — with static state specimens (default/focus/invalid/
   invalid+focus/disabled).
7. ✅ Card/surface hierarchy — all flat.
8. ✅ Table — text/numeric/status/action columns + zebra + hover + selected (clean source order, no
   `!important`) + solid-destructive example.
9. ✅ All 5 status tiers + the solid-destructive allowlist example.
10. ✅ Dialog + popover (the only elevated surfaces).
11. ✅ Empty/loading/warning/error states.
12. ✅ Expanded + collapsed sidebar (group label 12px/500; focus = indigo ring).
13. ✅ Narrow/mobile (420px) — **no FAB**, existing controls only.

**Static interaction specimens:** permanent `.is-hover/.is-active/.is-focus/.is-selected/.is-invalid`
classes mirror their pseudo-classes exactly (the pseudo-classes are also kept). A static screenshot
is sufficient to inspect every state.

**Render verification:** headless Chromium at 1440/1000/420, **0 console errors, 0 failed font
requests**, every permanent state specimen visible, no FAB, Chinese at 12px readable, graphite and
canvas harmonious, no status-tier collapse. (Full rerun in Corrective-1 record §J.)

---

## J. Unresolved risks

1. **macOS/Safari Noto at 12px** unverified (highest-risk unknown). The 12px Chinese floor is
   calibrated for Chromium; do not claim macOS parity without a capture.
2. **Sidebar re-tint** is the highest-risk visual change; must be A/B'd against the live dashboard
   before Wave 1.
3. **`dark:` variant ambiguity** (14 inert utilities) unresolved — dark theme out of scope; a later
   cleanup must implement-or-strip.
4. **Selected-row text rule:** `row-selected` (#e8e1d3) is warm and more prominent than hover, but
   `ink-muted` on it is 4.32 (AA-large). The authority therefore requires **selected-row text =
   `ink` (not ink-muted)** — implementation must enforce this so every selected-row pair clears
   AA-normal. (Recorded in DESIGN.md §7.)
5. **Serif reading recipes** uncalibrated against Quiet Graphite (deferred).
6. **Proctor density** (Phase-1 placeholder) re-specified at Phase 2.
7. **Vision-model caveat:** automated image descriptions used only as secondary corroboration;
   every claim grounded in source/computed-styles/measured-WCAG.

---

## K. Confirmation: no production code or CSS modified

```text
git status --short
?? DESIGN.md
?? docs/frontend/UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1.md
?? docs/frontend/UI-VISUAL-DESIGN-AUTHORITY-1.md
?? docs/frontend/UI-VISUAL-DESIGN-AUDIT-1.md
?? docs/frontend/design-preview.html
```

Only **new** documentation/specimen files. No `apps/**`, `packages/**`, `statusMeta.ts`, tests, lint
rules, config, fonts, or production CSS changed. The preview is a standalone HTML no application code
imports. Corrective-1 modified only the 3 allowed authority files + created the corrective record.

---

## L. Stop condition

Stop after the authority + preview + evidence report are corrected and the corrective record is
created and validated. **Wave 1 is NOT begun; `UI-VISUAL-REFINE-1` stays BLOCKED.**

```text
UI-VISUAL-DESIGN-AUTHORITY-1:
PASSED ONLY AFTER CORRECTIVE-1 — REAUDIT REQUIRED
```

The next task is adversarial **reaudit** of the corrected DESIGN.md + preview.
