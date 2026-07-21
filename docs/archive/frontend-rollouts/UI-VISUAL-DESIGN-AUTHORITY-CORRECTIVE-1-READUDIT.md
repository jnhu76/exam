# UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1-READUDIT

> Independent adversarial **reaudit** of the Quiet Graphite design authority
> (`DESIGN.md` v1.1 + `docs/frontend/design-preview.html` + the authority /
> corrective records). This record is the result of a fresh, from-scratch
> reproduction of findings C-01…C-09 and D-01…D-06 against the current working
> tree — it does **not** trust the prior PASS declarations.
>
> Scope: authority + preview only. **No production files modified** to produce
> this record. All programmatic checks were run against the live working tree
> (token front-matter, preview CSS, headless-Chromium runtime). Temporary
> scripts/screenshots stayed in `/tmp`.

---

## A. Verdict

```text
UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1:
ADVERSARIAL REAUDIT PASSED

UI-VISUAL-DESIGN-AUTHORITY-1:
CLOSED

UI-VISUAL-REFINE-1:
READY FOR WAVE-1 IMPLEMENTATION PLAN
```

All prior P1 findings (C-01…C-09, D-01…D-06) are independently reproduced as
**closed**. No P0/P1 remains. The authority is internally consistent and
validated. Wave-1 may proceed.

---

## B. Re-audit method

Each §5 subcheck was reproduced **from the working tree**, not from the prior
reports. Tooling: Node scripts parsing the `DESIGN.md` YAML front-matter and the
preview `<style>` block; a WCAG relative-luminance recompute; and a headless
Chromium render (cached `chromium-1228`, CDP over WebSocket — no new project
dependency) at 1440×900 that captured computed styles, bounding boxes, console
output, and network requests. Every number below is the independently measured
value.

---

## C. Findings reproduced (C-01 … C-09, D-01 … D-06)

| ID | Finding | Reproduction | Verdict |
| --- | --- | --- | --- |
| C-01 | `font-weight: 600` in roles although only 400/500/700 are loaded | Active YAML front-matter weights used: **400, 500, 700 only** (0× `weight: 600`). Every remaining `600` token in DESIGN.md/preview is in **prose that forbids it** ("`font-weight: 600` is forbidden …"). | CLOSED |
| C-02 | 11px sidebar-group-label although Chinese permitted there | sidebar-group-label = **12px / 500** (preview runtime: `fs:12px, fw:500`). No active 11px declaration. | CLOSED |
| C-03 | Disabled-contrast unverified | Recomputed: ink-muted `#6b6760` on disabled-surface `#f4f2ef` = **5.03 AA-normal**; ink-disabled `#8a857b` = 3.28 (decorative-only). Matches DESIGN.md §Validation. | CLOSED |
| C-04 | 13px text in preview | No active 13px role. Every `13px` in DESIGN.md is in "forbidden-substitution" / "no such role" prose. Preview chrome comment: "12px / 14px only". | CLOSED |
| C-05 | Focus changed border WIDTH | Runtime: input default `border-width: 1px`; `.input.is-focus` `border-width: 1px`. Button focus only adds `box-shadow` ring. No focus-time border-width change on any control. | CLOSED |
| C-06 | Missing `components:` front-matter | `components:` block present — **21 entries** (button-primary … popover), all referencing existing token names. | CLOSED |
| C-07 | Non-deterministic status mapping | DESIGN.md §8.4 maps **all 41** production `statusMeta.ts` keys one-to-one (verified: 41 prod keys == 41 mapped). The only "where appropriate / as needed" occurrence is the **prohibition line** (`no "or POSITIVE where appropriate"…`). | CLOSED |
| C-08 | Destructive-solid too broad | §8.3 exclusive allowlist: `critical`, `misconduct_serious`, `infraUnavailable`-blocking only. All other destructive = SOFT. | CLOSED |
| C-09 | Swatch count unverified | DESIGN.md color-role count **41** == preview CSS color vars **41** == visible `.sw` specimens **41**; names + hex values **identical** (programmatic cross-check, 0 mismatches). | CLOSED |
| D-01 | 32px interactive target / hit-target inheritance | All controls 36px: primary btn h=36, icon btn 36×36, input h=36 (runtime). No `height:32px` on any interactive control (the only `height:32px` is a decorative empty-state illustration SVG + `line-height:32px` typography). | CLOSED |
| D-02 | Optional control shadow (`elevation.control`) | No `elevation.control` declaration (only prose: "elevation.control is REMOVED"). Controls `box-shadow:none`. Elevation = `overlay`/`overlay-lg` only. | CLOSED |
| D-03 | Table state model not single-choice | ZEBRA + no per-row borders; `row-hover #efe9df`, `row-selected #e8e1d3`. Preview CSS: `is-selected` rule **last** in source order; **zero `!important`** in actual declarations (3 `!important` tokens are all in CSS comments). | CLOSED |
| D-04 | Static interaction specimens pseudo-class-only | Permanent `.is-hover/.is-active/.is-focus/.is-disabled/.is-selected/.is-invalid` classes mirror pseudo-classes (runtime specimen counts: hover 5, active 1, focus 8, disabled 5, selected 1, invalid 2). | CLOSED |
| D-05 | Mobile FAB invented | No FAB: `document.querySelector('.fab,[class*="fab"]')` → none. Narrow specimen uses existing controls only. | CLOSED |
| D-06 | Preview chrome used 11/13/600 | Chrome is 12px/14px only (comment-documented); weights 400/500/700 only. | CLOSED |

---

## D. Required-resolution spot checks (§5.9)

| status key | DESIGN §8.4 tier | Required | Result |
| --- | --- | --- | --- |
| `completed` | POSITIVE | POSITIVE | OK |
| `submitted` | INFORMATIONAL | INFORMATIONAL | OK |
| `closed` | NEUTRAL | NEUTRAL | OK |
| `auto_graded` | POSITIVE | POSITIVE | OK |
| `degraded` | CAUTION | CAUTION | OK |
| `infraUnknown` | NEUTRAL | NEUTRAL | OK |
| `critical` | DESTRUCTIVE (SOLID) | DESTRUCTIVE | OK |
| `misconduct_serious` | DESTRUCTIVE (SOLID) | DESTRUCTIVE | OK |
| `infraUnavailable` | DESTRUCTIVE (SOLID-conditional) | DESTRUCTIVE | OK |

Production `statusMeta.ts` = **41 keys, 0 duplicates**; DESIGN §8.4 = **41 mapped,
0 duplicates, 0 missing, 0 extra**. Deterministic tier + soft/solid + icon policy
for every key.

---

## E. Runtime evidence (headless Chromium, 1440×900)

```text
console errors:        0
page exceptions:       0
failed requests:       0 / 76
Noto 400/500/700:      loaded + ready (document.fonts.check → true)
swatch specimens:      41 (== DESIGN color-role count)
FAB present:           false
page overflow @1440:   false (docWidth == viewWidth)

primary button:        h = 36
icon button:           36 × 36
input:                 h = 36, border-width = 1px
input.is-focus:        border-width = 1px           (width stable on focus)
invalid + focus:       border-color rgb(178,58,23) [destructive]
                       + box-shadow rgba(79,70,229,0.25) 0 0 0 3px [indigo ring]
button focus ring:     rgba(79,70,229,0.25) 0 0 0 3px
sidebar item:          h = 40  (≥36; DESIGN sidebar-item spec = 40px)

body:                  font-family "Noto Sans CJK SC"…
                       background rgb(250,249,247) = #faf9f7 (canvas)
                       color rgb(31,29,27) = #1f1d1b (ink)
table header:          bg rgb(244,242,239) = surface-subtle
                       fw 500, fs 12px, color ink-muted
topbar-title:          14px / 500 / ink (not muted)
sidebar-group-label:   12px / 500

table row states (computed):
  odd default:         rgb(255,255,255)        = surface
  is-hover:            rgb(239,233,223)        = row-hover #efe9df
  is-selected:         rgb(232,225,211)        = row-selected #e8e1d3
  even zebra:          rgb(244,242,239)        = surface-subtle
  (selected overrides hover+zebra by source order; no !important)
```

Note on the focus bounding-box: the default primary button (text "创建考试
Create") measures 137×36 while the `.is-focus` specimen (text "创建考试")
measures 90×36. The width difference is the **different label text**, not a
focus-time geometry change — each element's own border-width is 1px before and
during focus (verified on the input pair).

---

## F. Contrast recompute (WCAG 2.1 relative luminance)

Reproduced independently; matches DESIGN.md §Validation:

| Pair | Ratio | Verdict |
| --- | ---: | --- |
| ink on canvas | 15.97 | AAA |
| ink on surface | 16.80 | AAA |
| ink-muted on surface-subtle | 5.03 | AA |
| **ink-muted on disabled-surface (disabled TEXT)** | **5.03** | **AA** |
| ink-muted on row-hover | 4.66 | AA |
| sidebar-muted on sidebar-canvas | 6.12 | AA |
| link on canvas | 4.59 | AA |
| on-primary on primary | 6.29 | AA |
| on-destructive on destructive-solid | 5.18 | AA |
| informational / positive / caution / destructive / neutral (text on soft) | 4.66–5.42 | AA |
| ink-disabled on disabled-surface | 3.28 | decorative/non-text only |

All ordinary-text pairs ≥ 4.5:1. `ink-disabled` is the only sub-4.5 value and is
explicitly non-text decorative.

---

## G. Git attribution (§5.1)

```text
git status --short
?? DESIGN.md
?? docs/frontend/UI-VISUAL-DESIGN-AUDIT-1.md
?? docs/frontend/UI-VISUAL-DESIGN-AUTHORITY-1.md
?? docs/frontend/UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1.md
?? docs/frontend/design-preview.html
(+ this reaudit record, added in the same authority commit)
```

No file under `apps/`, `packages/`, or `tests/` is modified. The authority
remains documentation-only. Branch: `feat/ui-visual-fixes`.

---

## H. Remaining known limitations (carried forward, not blockers)

1. **macOS/Safari** Noto at 12px still unverified (no macOS capture).
2. **Sidebar re-tint** is the highest-risk Wave-1 visual change — A/B vs the live
   dashboard is mandated by the Wave-1 plan.
3. **14 inert `dark:` variants** remain (dark theme out of scope).
4. **Selected-row text = `ink`** must be enforced at implementation time.
5. **Serif reading recipes** uncalibrated (deferred).

None of these is an authority defect; all are implementation/runtime follow-ups.

---

## I. Stop condition

```text
UI-VISUAL-DESIGN-AUTHORITY-1 = CLOSED
```

Wave-1 implementation planning may begin. Wave 2/3/4 remain NOT STARTED.
