# UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1

> Corrective record for the Quiet Graphite design authority, disposing of every finding from the
> adversarial review. Modifies only the allowed authority files
> (`DESIGN.md`, `docs/frontend/design-preview.html`, `docs/frontend/UI-VISUAL-DESIGN-AUTHORITY-1.md`)
> and creates this record. **No production files modified.**

---

## A. Verdict

```text
UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1:
PASS

UI-VISUAL-DESIGN-AUTHORITY-1:
REAUDIT REQUIRED

UI-VISUAL-REFINE-1:
BLOCKED
```

All review findings are disposed of below. The authority is now internally consistent and validated.
Wave 1 is **not** marked ready.

---

## B. Scope and file attribution

| File | Change | Attribution |
| --- | --- | --- |
| `DESIGN.md` | Rewritten to v1.1: removed every `font-weight: 600`; sidebar-group-label 11→12px/500; added `components:` front-matter (21 entries); added complete 41-key status mapping (§8.4); fixed focus authority (stable 1px border); removed `elevation.control`; fixed table model (ZEBRA + row-hover/selected values); destructive-SOLID allowlist (§8.3); disabled text = ink-muted. | Corrective-1 |
| `docs/frontend/design-preview.html` | Rewritten: all 41 roles grouped; static `.is-*` state specimens; stable-width focus on every control; ZEBRA selectors (no `!important`); no 13px/600/11px-Chinese; removed FAB; controls flat. | Corrective-1 |
| `docs/frontend/UI-VISUAL-DESIGN-AUTHORITY-1.md` | Rewritten: verdict = "passed only after Corrective-1"; corrected counts (41 roles); corrected claims throughout. | Corrective-1 |
| `docs/frontend/UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1.md` | NEW (this file). | Corrective-1 |

Forbidden scopes untouched: `apps/**`, `packages/**`, `tests/**`, `eslint/**`, config files, font
files, production CSS, production React components, `statusMeta.ts` (read-only for the status
mapping only).

---

## C. Review findings disposition

> Format per finding: **accepted / accepted-with-factual-correction / downgraded / rejected** +
> exact corrective action. Errata items the task named explicitly (C-01/C-03/C-05/C-06) are marked.

### C-01 — `font-weight: 600` used in roles although only 400/500/700 are loaded
- **ACCEPTED WITH FACTUAL CORRECTION.**
- **Erratum (do not reproduce the review's incorrect explanation):** the review correctly identified
  that 600 roles are unavailable, but **incorrectly claimed they "resolve to 500."** A requested
  `font-weight: 600` does **not** produce a true 600 face, and we do **not** claim it resolves to any
  specific face.
- **Corrective:** **all roles previously declared 600 → changed to 500.** No 600 face added.
  `table-header` 12/500; `topbar-title` 14/500; `sidebar-group-label` 12/500; `label` 14/500. Every
  `font-weight: 600` removed from DESIGN.md and the preview. Only 400/500/700 remain.

### C-02 — 11px sidebar-group-label although Chinese is permitted there
- **ACCEPTED.** The 12px Chinese floor is absolute; Chinese may appear in sidebar group labels.
- **Corrective:** sidebar-group-label = **12px / 500** in DESIGN.md and preview. No 11px Chinese
  anywhere. Also documented that `text-transform: uppercase` affects **only the Latin portion** of
  mixed CJK/Latin labels (Chinese has no case; uppercase does not change Chinese glyphs).

### C-03 — Disabled-contrast number unverified
- **ACCEPTED WITH FACTUAL CORRECTION.**
- **Erratum:** the review's stated contrast number is **not reused without recalculation.** Every
  actual foreground/background pair was recomputed from the final tokens.
- **Corrective:** disabled **text** = `ink-muted #6b6760` on `disabled-surface #f4f2ef` = **5.03:1
  (AA-normal)**. `ink-disabled #8a857b` (3.28:1) restricted to **non-text decorative** only. The
  accessibility conclusion (disabled-as-text was a defect) **remains valid** and is now fixed.
- All wording like "ink-disabled text (non-text)" removed.

### C-04 — 13px text in the preview (notes, descriptions, small buttons, popovers, errors)
- **ACCEPTED.** There is **no 13px product typography role.**
- **Corrective:** every visible 13px use replaced — preview note → 14px; section descriptions → 14px;
  small buttons → 14px (size = 36px, no 32px variant); popover content → 14px; error descriptions →
  14px; annotations/metadata → 12px. No 13px exception created.

### C-05 — Focus changed border WIDTH (input went 1px→2px at focus)
- **ACCEPTED WITH FACTUAL CORRECTION.**
- **Erratum:** the review stated the old preview **button** focus changed border width. That is
  inaccurate — the old **button** focus changed border **color** only; the old **input** focus
  changed border **width** (1px→2px). The net problem (border-width change somewhere) was real.
- **Corrective:** the corrected design **never changes border width during focus on ANY control.**
  Focus = `1px` border (width stable) + indigo **color** + `0 0 0 3px rgb(79 70 229 / 0.25)` ring.
  Verified by Chromium bbox diff (§J): no bounding-box change at focus.

### C-06 — Missing `components:` front-matter despite the report claiming it
- **ACCEPTED WITH FACTUAL CORRECTION.**
- **Erratum:** there is **no universal external schema violation.** The VoltAgent/awesome-design-md
  repo does not mandate a `components:` block (Context7 confirmed it is a curated collection, not a
  schema). The actual problem was **internal inconsistency**: this project's evidence report claimed
  a tokenized `components:` section that did not exist.
- **Corrective:** a minimal `components:` entry added to DESIGN.md front-matter (21 entries), each
  referencing existing token names (`button-primary … popover`). No separate component schema or
  generator created.

### C-07 — Incomplete / non-deterministic status mapping ("or POSITIVE where appropriate" etc.)
- **ACCEPTED.** The implementation agent must not decide semantic mappings.
- **Corrective:** a complete **one-to-one** mapping of all **41** `statusMeta.ts` keys → 5 tiers
  added to DESIGN.md §8.4. At minimum the required resolutions applied: `completed→POSITIVE`,
  `submitted→INFORMATIONAL`, `closed→NEUTRAL`, `auto_graded→POSITIVE`, `degraded→CAUTION`,
  `infraUnknown→NEUTRAL`. All "or POSITIVE where appropriate / as needed / depending on context"
  wording removed.

### C-08 — Destructive-solid policy too broad (each page could choose)
- **ACCEPTED.**
- **Corrective:** DESIGN.md §8.3 — SOFT is the default for destructive states; **SOLID permitted
  only for immediate, high-attention operational danger**, with an exclusive allowlist:
  `critical`, `misconduct_serious`, `infraUnavailable` (only when blocking an active exam op). All
  other destructive statuses stay SOFT. Pages do not choose independently.

### C-09 — Swatch count not programmatically verified; not every role shown
- **ACCEPTED.**
- **Corrective:** the 41 color roles were programmatically enumerated from the DESIGN.md front-matter
  (node script). The preview now visibly shows **all 41**, grouped into 10 groups (surfaces / text /
  borders / primary / link / interaction / sidebar / status fg / status bg / on-color). The
  evidence-report count = 41 = front-matter count = preview count.

### D-01 — Interactive target sizes (32px button variant; relying on row height for hit target)
- **ACCEPTED.**
- **Corrective:** default button = 36px, **small button = 36px** (no 32px interactive variant),
  icon button = 36×36, touch-min = 36×36. The authority no longer claims a child 32px button
  inherits a 36px hit target from a 44px row. Visual icon inside a button may remain 16px.

### D-02 — Optional control shadow (`elevation.control`) contradicts "controls are flat"
- **ACCEPTED.**
- **Corrective:** `elevation.control` **removed**. Ordinary controls (buttons/inputs/selects) are
  **flat: `box-shadow: none`**. Depth reserved for popover/dropdown/sheet/dialog/modal only. The
  authority no longer describes an ordinary control shadow as optional.

### D-03 — Table state model not a single explicit choice
- **ACCEPTED.**
- **Corrective:** DESIGN.md §7 — **TABLE ROW SEPARATION: ZEBRA; PER-ROW BORDERS: NONE.** Final
  warm-neutral values: `row-hover #efe9df`, `row-selected #e8e1d3`. Preview CSS rebuilt with clean
  source-order selectors (selected last) — **no `!important`**.

### D-04 — Static interaction specimens relied only on pseudo-classes (a screenshot couldn't show states)
- **ACCEPTED.**
- **Corrective:** preview now has permanent `.is-hover / .is-active / .is-focus / .is-selected /
  .is-invalid` classes that mirror their pseudo-classes exactly (pseudo-classes kept too). A static
  screenshot is sufficient to inspect every state.

### D-05 — Mobile preview invented a FAB (new product interaction)
- **ACCEPTED.**
- **Corrective:** the sticky FAB is **removed** from the preview. No elevation exception for it.
  The mobile specimen demonstrates only: page gutters, stacked header/actions, card stacking, table
  responsive representation, sidebar collapse, existing control sizes, status hierarchy. No new
  product interaction behavior.

### D-06 — Preview chrome used 11px/13px/600, contradicting the authority
- **ACCEPTED.**
- **Corrective:** all preview explanatory chrome now uses the defined 12px or 14px roles (no 11px,
  no 13px, no 600). Chrome may be visually separated from product specimens but introduces no
  contradictory examples.

---

## D. Font and typography corrections

- **Weights:** only 400 / 500 / 700 (the only faces the repo loads). `font-weight: 600` forbidden.
- **600→500 roles:** table-header, topbar-title, sidebar-group-label, label.
- **13px removed:** no 13px role exists; former 13px uses → 12px (metadata/help/badge/annotation) or
  14px (body/popover/description/button).
- **11px Chinese removed:** sidebar-group-label = 12px/500 (Chinese permitted there); 12px floor is
  absolute.
- **uppercase semantics:** `text-transform: uppercase` affects ONLY Latin in mixed CJK/Latin labels;
  it does not change Chinese glyphs.

## E. Accessibility and disabled-state corrections

- Disabled **text** = `ink-muted #6b6760` on `disabled-surface #f4f2ef` = **5.03:1 (AA-normal)** —
  applies to disabled button/input/select/menu-item text.
- `ink-disabled #8a857b` (3.28:1) restricted to **non-informational decorative glyphs, disabled
  borders (where contrast permits), ornamental graphics** — **never** text labels, placeholders, or
  explanatory text.
- All status-tier text-on-soft recomputed: all AA-normal (4.66–5.42).
- Selected-row text mandated = `ink` (12.92:1) because `ink-muted` on `row-selected` (4.32) is only
  AA-large.

## F. Geometry and focus corrections

- **Focus (every control):** border **width 1px** (stable — never changes at focus); border **color**
  indigo; ring `0 0 0 3px rgb(79 70 229 / 0.25)`. No content movement. Destructive controls also use
  **indigo** focus (no red focus authority). Invalid input = destructive 1px validation border; a
  **focused** invalid input = destructive border **+** indigo ring (error vs focus distinguishable).
- **Control sizes:** default button 36px, small button 36px, icon button 36×36, touch-min 36×36.
  No 32px interactive variant.
- **Control elevation:** `elevation.control` removed; controls flat (`box-shadow: none`).
- Applied to: primary/secondary/ghost/destructive/icon button, input, textarea, select, checkbox,
  radio, switch, tabs, sidebar navigation.

## G. Table-state corrections

- **Row separation: ZEBRA.** Even rows `surface-subtle #f4f2ef`; odd rows `surface #ffffff`.
  **No per-row borders.**
- `row-hover #efe9df` (warm; differs visibly from surface AND surface-subtle; both parities change).
- `row-selected #e8e1d3` (warm; more prominent than hover; overrides zebra + hover by **CSS source
  order**, no `!important`).
- Contrast: ink on each = 12.9–16.8 (AAA); ink-muted on hover = 4.66 (AA); selected rows use ink.

## H. Complete status mapping

See `DESIGN.md §8.4` — all **41** keys mapped one-to-one. Required resolutions applied:
`completed→POSITIVE`, `submitted→INFORMATIONAL`, `closed→NEUTRAL`, `auto_graded→POSITIVE`,
`degraded→CAUTION`, `infraUnknown→NEUTRAL`. For each key: tier, soft/solid, icon-in-normal,
icon-in-dense-table, reason. Deterministic — no per-page decisions.

## I. Preview completeness corrections

- All **41** color roles shown, grouped into 10 groups.
- Static state specimens for default/hover/active/focus/disabled/invalid/selected/destructive.
- ZEBRA table with all row states (no `!important`).
- No FAB. Chrome uses 12px/14px only.
- Counts: preview roles = 41 = DESIGN.md front-matter = evidence report.

## J. Validation evidence

### Structural
- DESIGN.md YAML front-matter **parses** (node `js-yaml`-free parse of the fenced block).
- `components:` **exists** (21 entries).
- **No duplicate** color-role keys (41 unique).
- Preview `--var` values **match** DESIGN.md exactly (every value cross-checked).
- Every DESIGN.md color role has a visible specimen (**41 = 41**).
- Evidence-report count (41) = computed count (41).

### Typography
- **No `font-weight: 600`** in DESIGN.md or preview (grep verified).
- **No visible 11px Chinese** (sidebar-group-label = 12px).
- **No visible 13px** (chrome is 12/14).
- Only 400/500/700 design-role weights.
- sidebar-group-label = 12px/500.
- Per the task: **font-face weight is NOT inferred from `getComputedStyle()` alone** — the loaded-
  face inventory (400/500/700) is trusted.

### Contrast (recomputed for every actual text pair)
- Disabled text (ink-muted on disabled-surface) = **5.03 AA-normal**.
- Status text on soft (all 5 tiers) = 4.66–5.42 AA-normal.
- White on primary = 6.29; white on destructive-solid = 5.18.
- Sidebar text: default (sidebar-muted on sidebar-canvas) 6.12; hover (on sidebar-hover) 4.83;
  active (sidebar-ink on sidebar-active) 7.88.
- Links 4.59–6.33; placeholders (ink-muted) 5.03–5.62; focused-invalid (destructive border + indigo
  ring — distinguishable); selected rows (ink) 12.92.
- **All ordinary-text pairs ≥ 4.5:1.**

### Geometry (Chromium bounding boxes)
- Every button target **≥ 36×36**; every icon button **= 36×36**.
- **Focus does not change the bounding box** (border width stable at 1px → no layout shift).
- Focus does not shift text or icon position.

### Table (computed styles)
- Odd-row normal: `surface`; even-row zebra: `surface-subtle`; odd-row hover: `row-hover`; even-row
  hover: `row-hover`; selected: `row-selected`; selected+hover: `row-selected`. All six states
  visually distinct.

### Preview render (1440 / 1000 / 420)
- **No console errors.**
- **No failed font requests** (Noto resolved from `../../apps/web/public/fonts/…`).
- Every permanent state specimen visible.
- **No FAB.**
- No horizontal preview overflow unrelated to the table specimen.
- Chinese at 12px readable.
- Graphite and canvas harmonious.
- No status-tier collapse.

> Temporary scripts and screenshots remained outside the repository (`/tmp`).

## K. Remaining risks

1. macOS/Safari Noto at 12px unverified.
2. Sidebar re-tint highest-risk; A/B vs live dashboard before Wave 1.
3. 14 inert `dark:` variants unresolved (dark theme out of scope).
4. Selected-row text must be enforced as `ink` (not ink-muted) so all selected-row pairs clear AA.
5. Serif reading recipes uncalibrated (deferred).
6. Proctor density re-specified at Phase 2.
7. Vision-model descriptions used only as secondary corroboration.

## L. Stop condition

```text
UI-VISUAL-DESIGN-AUTHORITY-CORRECTIVE-1:
PASS — ADVERSARIAL REAUDIT
```

DESIGN.md, preview, and evidence report are corrected; the corrective record is created; validation
is rerun. **No production files modified. UI-VISUAL-REFINE-1 remains BLOCKED.** Wave 1 is not begun.

The next task is adversarial **reaudit** of the corrected authority.
