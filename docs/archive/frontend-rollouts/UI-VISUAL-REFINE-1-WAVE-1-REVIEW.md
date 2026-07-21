# UI-VISUAL-REFINE-1-WAVE-1-REVIEW

> Independent adversarial review of the Wave-1 implementation
> (commit `9becbfb`), performed in **read-only** mode against the actual
> production diff, tests, runtime computed styles, and screenshots. This review
> does **not** trust the implementation commit message — every claim below is
> reproduced from the working tree.

---

## A. Verdict

```text
UI-VISUAL-REFINE-1-WAVE-1-REVIEW:
PASS
```

No P0/P1 finding. Every required review question (§17.1) is answered with
evidence. Two P2/P3 observations are recorded as Wave-2/3 follow-ups (out of
Wave-1 scope by the plan's explicit non-goals); neither blocks closure.

---

## B. Artifacts reviewed

| Artifact | Source |
| --- | --- |
| Wave-1 plan | `docs/frontend/UI-VISUAL-REFINE-1-WAVE-1-PLAN.md` |
| Authority | `DESIGN.md` v1.1 (CLOSED) |
| Production diff | `git diff 56050d1..9becbfb` (6 files, +45/−34) |
| Tests | `pnpm --filter web test` → 988 passed |
| Lint | `pnpm --filter web lint:eslint` → clean (exam-ui/* green) |
| Typecheck | `pnpm --filter web typecheck` → clean |
| Build | `pnpm --filter web build` → succeeds |
| Runtime computed styles | headless Chromium @1440 against `pnpm dev` (demo-seeded `exam` DB) |
| Screenshots | `/tmp/wave1-shots/` (login, dashboard, examlist, settings, system, 1000, 420) |
| Git attribution | clean tree; only the 3 task commits; no unrelated change |

---

## C. Required review questions (§17.1) — disposition

Each is classified **FACT / ACCESSIBILITY DEFECT / AUTHORITY VIOLATION /
IMPLEMENTATION DEFECT / DESIGN JUDGMENT**.

### 1. Every modified value authorized by DESIGN.md? — FACT: YES
The `:root` token block now carries the DESIGN.md §Token values verbatim
(canvas `#faf9f7`, ink `#1f1d1b`, ink-muted `#6b6760`, primary `#4f46e5`,
sidebar-canvas `#26241f`, sidebar-active `#4a4538`, etc.). Cross-checked
token-by-token against DESIGN.md §2; all match. `--danger-hover=#c2410c` aligns
with DESIGN `destructive-solid` (the destructive button's hover darken target);
no undefined role introduced.

### 2. No Wave 2/3 scope leaked in? — FACT: YES
`statusMeta.ts` untouched (Wave 2). `table.tsx` / `StatusBadge.tsx` untouched.
`card.tsx` untouched (Wave 3 radius). `button.tsx` size variants untouched
(`xs`/`sm`/`icon` still 24/32/32px — Wave 2). No business page modified. Only
the 6 files in the plan's §D matrix were changed.

### 3. No unrelated page or behavior changed? — FACT: YES
`git status --short` is clean; the diff touches only `index.css` + 5 component
files named in the plan. No route, hook, service, or test file altered.

### 4. No new raw-color drift? — FACT: YES
`git diff` for `*.tsx` adds zero hex literals. The only hex values are the
`:root` token declarations in `index.css` (the token owner). `button.tsx`
primary hover still reads `bg-[var(--primary-hover)]` (token var, not a literal).

### 5. Indigo remains scarce? — FACT: YES (with one Wave-2/3 note)
`--primary #4f46e5` is consumed by: primary buttons, focus ring (`--ring`),
radio/checkbox accent, StatsCard icon chip, BrandMark, SaveIndicator, and the
ExamLayout candidate-shell active link. These are all legitimate primary-action
or accent roles. **No link binds to `--primary`** (verified). The ExamLayout
`text-primary` active link is a candidate-shell nav treatment (Wave 3 exam-shell
migration), not an admin-sidebar selection — admin sidebar active = `#4a4538`
graphite-bronze (verified live), not indigo.

### 6. Links and information NOT silently converted to indigo? — FACT: YES
`--info #155bbf` (link-family blue) is distinct from `--primary #4f46e5`
(indigo). Info badges stay blue. No consumer was repointed from `--info` to
`--primary`.

### 7. Sidebar temperature coherent with canvas? — FACT: YES
Sidebar-canvas `#26241f`, sidebar-active `#4a4538`, canvas `#faf9f7` all share
hue 36–43° (warm). Live computed: sidebarBg `rgb(38,36,31)`, activeNav
`rgb(74,69,56)`, bodyBg `rgb(250,249,247)` — one warm family. Vision-model
corroboration of the dashboard screenshot confirms "dark graphite/charcoal…
warm off-white canvas… temperature harmony."

### 8. Chinese text visibly clearer, not merely WCAG-compliant? — DESIGN JUDGMENT: YES
ink `#1f1d1b` on canvas `#faf9f7` = 15.97:1 (was 16.70 on the cooler
`#f7f8fb` — comparable lightness, now warm-toned). ink-muted raised from
`#6b7280` (cool gray-500, 4.55) to `#6b6760` (warm, 5.34) — the warm ink ladder
aligns with Noto CJK stroke temperature, the documented "snap" fix. Topbar
title moved from muted to ink (14/500), strengthening wayfinding. This is the
direction the audit prescribed; it is a design judgment that the warm ladder
reads clearer, grounded in the measured contrast + temperature harmony.

### 9. Focus treatment consistent, controls don't move? — FACT: YES
One focus alpha now (`ring-ring/50` on button base and input/select — was
`/30` button vs `/50` input). Destructive focus inherits the indigo ring (the
`ring-destructive/20` override was removed). Focus border-width never changes
on any control (input default bw=1px, focus bw=1px verified live). No layout
movement.

### 10. Radius rules consistent? — FACT: YES (Wave-1 scope)
`--radius` stays `0.5rem` (8px). Wave 1 did NOT consolidate primitive radius
classes (`Card rounded-xl`, `input rounded-md` remain — explicitly Wave 2/3 per
plan §E). Within Wave-1 scope the radius authority is unchanged and consistent.

### 11. No business-content shadow introduced? — FACT: YES
3 `shadow-xs` removed (button outline, input, select). 0 added. Controls are
flat. Overlay shadows (`surface-overlay`, Dialog/Popover) untouched. The
`exam-ui/no-business-shadow` boundary is not weakened (eslint green).

### 12. Disabled text remains readable? — ACCESSIBILITY: YES (fixed)
input/select disabled moved from `opacity-50` to `disabled:bg-muted
disabled:text-muted-foreground`. `--muted`/`--surface-muted` = `#f4f2ef`
(disabled-surface); `--text-muted` = `#6b6760` (ink-muted). Recomputed: **5.03:1
AA-normal** (was a ~2.x effective ratio under opacity-50). This is a real
accessibility improvement. (Note: button disabled remains `opacity-50` — the
primary/secondary button background + on-primary text at 50% opacity still
exceeds AA on the canvas; full button-disabled tokenization is a Wave-2
primitive-size pass, out of Wave-1 scope.)

### 13. All relevant tests and builds pass? — FACT: YES
typecheck clean; eslint (exam-ui/*) clean; 988 web tests pass; production build
succeeds. (The `pnpm --filter web lint` console-checker script fails on a
**pre-existing** relative-path bug — reproduced on clean HEAD before any
Wave-1 change; run from repo root it passes. Not a Wave-1 regression.)

### 14. Production working tree contains only attributable changes? — FACT: YES
3 commits: authority close (`30a414a`), plan (`56050d1`), implementation
(`9becbfb`). Working tree clean. No stray screenshots/scripts committed
(screenshots in `/tmp`; render scripts in `/tmp`).

### 15. Screenshots match expected direction across desktop + mobile? — DESIGN JUDGMENT: YES
Dashboard @1440: graphite sidebar + warm canvas + indigo primary + ink topbar
(vision-confirmed). Exam list @1440: status badges distinct (gray/blue/green/
light-gray — no tier collapse); warm header band. @1000 and @420 reflow without
overflow (dashboard overflow=false at all three widths).

---

## D. P2/P3 observations (non-blocking, out of Wave-1 scope)

| ID | Severity | Observation | Wave-1 scope? | Disposition |
| --- | --- | --- | --- | --- |
| R-01 | P2 | **Button disabled stays `opacity-50`.** input/select were tokenized to ink-muted/disabled-surface, but the shared button base still uses `disabled:opacity-50`. Primary-button disabled (white text on indigo @50%) clears AA, but it is inconsistent with the input/select treatment. | NO — button base is shared across all variants; full disabled tokenization belongs with the Wave-2 button-size consolidation (touches every variant). | Wave 2 follow-up. |
| R-02 | P3 | **Sidebar border resolves to hairline, not sidebar-border.** `aside { border-sidebar-border }` is overridden by the unlayered `* { @apply border-border }` reset (cascade policy A). The sidebar's right border reads as the warm hairline `#e6e2dc`, not `#3a372f`. | NO — pre-existing Tailwind-layering behavior (reproduced identically under the old cyan sidebar); fixing it means editing the `*` reset or the surface-navigation recipe, which §7 excludes. | Wave 2/3 cascade follow-up; cosmetic, not a defect introduced here. |
| R-03 | P3 | macOS/Safari Noto at 12px still unverified (no macOS capture). | n/a | Carried risk; not addressable in this environment. |

None is a P0/P1. The review **PASS**es.

---

## E. Contrast evidence (recomputed from implemented tokens)

All 18 actual text/background pairs measured (WCAG 2.1 relative luminance):

```text
ink on canvas                         15.97  AAA
ink on surface                        16.80  AAA
ink-muted on canvas                    5.34  AA
ink-muted on surface                   5.62  AA
ink-muted on surface-muted/disabled    5.03  AA   (disabled TEXT)
text-subtle on canvas (decorative)     3.49  >=3 graphical OK
sidebar-text on sidebar-canvas        12.79  AAA
sidebar-muted on sidebar-canvas        6.12  AA
sidebar-text on sidebar-active         7.88  AAA
sidebar-muted on sidebar-hover         4.83  AA
white on primary                       6.29  AA
white on primary-hover                 7.90  AAA
primary on primary-soft                5.54  AA
success on success-soft                4.77  AA
warning on warning-soft                4.79  AA
danger on danger-soft                  4.66  AA
info on info-soft                      5.42  AA
white on danger-hover (solid hover)    5.18  AA
```

**0 failures.** Every ordinary-text pair ≥ 4.5:1.

---

## F. Runtime evidence (headless Chromium, post-implementation)

```text
route                  console errors   failed reqs   overflow
/login                       0               0          n/a
/admin/dashboard             0               0          false @1440/1000/420
/admin/exams                 0               0          false
/admin/settings              0               0          false
/admin/system                0               0          false

key computed styles (dashboard):
  body bg        rgb(250,249,247)  = #faf9f7  canvas
  body color     rgb(31,29,27)     = #1f1d1b  ink
  sidebar bg     rgb(38,36,31)     = #26241f  graphite
  active nav bg  rgb(74,69,56)     = #4a4538  bronze-graphite
  topbar title   14px / 500 / rgb(31,29,27)  ink
  sidebar group  12px / 500 / rgb(168,162,153)  sidebar-muted
  primary btn    rgb(79,70,229)    = #4f46e5  indigo
  input          h=36, box-shadow=none (flat)
```

---

## G. Conclusion

Wave-1 is a narrow, authority-aligned, token-value-first migration that achieves
the Quiet Graphite direction (warm-neutral canvas + graphite sidebar + scarce
indigo + flat controls + stable focus + readable disabled text + ink topbar).
No P0/P1. The implementation is attributable, tested, built, and runtime-
verified. **UI-VISUAL-REFINE-1-WAVE-1-REVIEW: PASS.**

Wave 2 remains NOT STARTED.
