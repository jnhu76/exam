# EXAM #590 — Dense-Table Cell Fitting

Issue: [#590](https://github.com/jnhu76/exam/issues/590) — bounded follow-up to
the #582 visual freeze. Task `EXAM-590-DENSE-TABLE-CELL-FITTING-1`.

```text
BASE_SHA            df5d1ad5beb6b6cfd7df2fdfa9a749ca16afca64 (authoritative starting master)
IMPLEMENTATION      fix/590-dense-table-cell-fitting-1 (recipes tokens + derivation fixture + guards)
E2E REGRESSION      apps/e2e/e2e/dense-table-cell-fitting.spec.ts (8 tests, permanent)
BEFORE ARTIFACT     docs/research/exam-582-visual-freeze/final-baseline-table-micro.png (reused, not duplicated)
AFTER ARTIFACT      before-after-contact-sheet.png (this directory)
```

Environment of every number below: canonical E2E seed (`exam_e2e`, reset),
`APP_MODE=e2e`, production web build served by the API dev server, Chromium
DPR 1, locale zh-CN, production HarmonyOS Sans SC, viewports 1440x900 and
1100x800.

## Failure classifications (final baseline input truth)

```text
CROSS_CELL_BOUNDARY   users role pill 考试管理员 (/admin/users)
CROSS_CELL_BOUNDARY   exam date range (/admin/exams, all canonical rows)
CROWDED_BUT_CONTAINED recovery relation 1 条关联 (/admin/recovery)
CROWDED_BUT_CONTAINED long datetime (/admin/audit-logs)
NO_DEFECT             2-tag cluster (/admin/questions)
COVERAGE GAP          3+ tag cluster / +N chip (no canonical-seed instance; the
                      new spec closes the 2-tag case deterministically via the
                      question PATCH API)
```

Only the two CROSS_CELL_BOUNDARY cases are production defects under #590. The
contained cases are negative controls: their production geometry is
byte-unchanged by this task (`RECOVERY_RELATION_PRODUCTION_DIFF = NONE`).

## Root causes

Both defects are **allocation failures**: locked-column width tokens are bare
numbers calibrated 2026-07-15 under the 14px cell font with no fixture bound
to their content vocabulary — unlike `status` 8.5rem, which derives from
`statusFixture.ts` and turns red when its vocabulary grows.

- **role pill**: `type` 5.5rem was calibrated when the widest users-role label
  was 管理员 (54px pill). The vocabulary grew to 考试管理员 (78px pill) on
  2026-08-13 with no contract reaction. 78px pill in a 55px content box → the
  nowrap line paints 6.5px past the shared 角色/状态 border.
- **date range**: 12.5rem left ~1px of margin at the 14px font. The #582 D2
  decision (cell typography 14px → 15px) grew the fixed 23-character
  `YYYY-MM-DD — YYYY-MM-DD` grammar to 195px against a 167px content box →
  11.5px spill into the 时长 duration column padding, every row, identical at
  1440 and 1100 (locked columns never reflow).

As-built correction recorded during diagnosis: a nowrap line with negative
free space ignores `text-align: right` in Chromium and overflows toward the
inline-end (right). The recovery relation cell therefore ends flush at its
right border (ink pixel-scan: last ink column = border column; line-box
advance overshoots the ink by ~2.5px of trailing-glyph side-bearing). It is
contained with **zero margin** — one font metric from a visible crossing —
which the negative-control test pins.

## Chosen mechanisms (per-defect; adversarially gated)

- **role pill — derived locked-width correction**: `type` 5.5rem → **7.25rem**.
  Derivation (status precedent): widest badge estimate = 5 × 12.4px CJK glyph
  + 16px badge padding + 2px border = 80px; token = 80 + 32 (px-4 × 2) +
  1 (border) + slack → 7.25rem = 116px → content box 83px ≥ 80. The universe
  is auto-derived by the new `typeFixture.ts` (role labels via
  `AssignableRoleSchema` + `unknown`, question types in both namespaces,
  candidate-field type/required labels, import-log types, incident severities,
  × `SUPPORTED_LOCALES`) with a structural guard and the E2E containment
  assertion as the two-level gate.
- **date range — derived locked-width correction**: `date-range` 12.5rem →
  **14.5rem**. Derivation: measured widest legal form 195.5px (fixed
  23-character grammar at the D2-frozen 15px tabular-nums) + 32 + 1 + ~3.5px
  slack = 232px. Exactly one consumer app-wide (ExamPage timeWindow); exams
  Σmin 928 → 960 stays under the 978px container at 1100 → no new local scroll
  at the pinned widths.
- **relation / datetime / 2-tag cluster — no production change**; permanent
  containment tests only.

Rejected alternatives: page-local width overrides (second allocation truth),
presenter truncation (contract-illegal for nowrap roles; identity-critical
label), compacting the date grammar (test-pinned product language; #590 §18),
two-line range (row-rhythm break), cell-level clipping (never-silent
contract), typography change (D2 frozen). A type-role split (label-pill vs
machine-string) is the structurally correct end-state but fixes neither
proven defect — recorded as follow-up, not done here.

## Geometry before → after (fresh runtime probes)

```text
users role pill   1440 + 1100: cell 88 → 116px, pill 78px unchanged,
                  spill 6.5px → 0.00px; status neighbor unchanged
exam date range   1440 + 1100: cell 200 → 232px, text 195px unchanged,
                  spill 11.5px → 0.00px on EVERY row; no intersection with
                  the duration cell; no local scroll at the pinned widths
relation          72px / 58px line box / flush-at-border ink: UNCHANGED
long datetime     168px / 152px, contained: UNCHANGED
2-tag cluster     contained: UNCHANGED (tag column reflows 268.7 → 259.3px as
                  the flexible distribution absorbs the wider type column)
document          documentElement.scrollWidth == clientWidth on all tested
                  surfaces at 1440 and 1100, before and after
header/body       column edges aligned (drift ≤ 1px) on all tested surfaces
RowActions        reachable, not clipped
frozen #582       D2 cell 15px, D4 head 13px/20px/500, D5 StatusBadge 22px,
                  D6 TagBadge weight 500 — asserted at runtime by the spec
```

## Known narrow local-scroll bands (accepted, disclosed)

The +28px/+32px locked-column growth raises content minima: /admin/questions
enters the shell's designed local-scroll band for viewports ≈1024–1045 and
/admin/exams for ≈1050–1081 (both previously fit). Inside the band the local
scroll region + fade/hint affordance own the overflow exactly as designed;
document-level overflow stays clean. The spec now includes an in-band guard
(exams @1065) asserting containment + clean document + the owned affordance.

## Follow-ups (outside #590's proven scope, recorded not fixed)

- audit-log action pills (`admin.audit.filterActions.*`, widest
  关闭考试（自动） ≈ 112px > 83px content box) and raw audit action-key /
  target-type strings cross in the type column on /admin/audit-logs —
  pre-existing, not a baseline-classified defect; needs the type-role
  vocabulary decision.
- InvitationsCard `expiresAt` renders a `toLocaleString()` datetime in the
  type role (semantically a date-role column) — pre-existing misdeclaration.
- `recipes.css` status derivation comment says "content box 104px"; the
  border-subtracting arithmetic (statusFixture, guards) uses 103px —
  pre-existing comment inconsistency, recorded here only.
- recovery relation containment has zero margin; any future widening pressure
  on the `number` role must re-derive it (the negative-control test will red).

## Verification

```text
structural      visual-finish.test.ts + table-contract-guards.test.ts  26/26
e2e geometry    dense-table-cell-fitting.spec.ts                       8/8
                (pre-fix on master: 5 failed / 2 passed — red reproduced)
static          pnpm verify:static                                     PASS
full gate       pnpm verify                                            PASS
adversarial     SUBAGENT_D_ADVERSARIAL_VERDICT: MINOR (no blockers)
```

## Artifact

```text
sha256(before-after-contact-sheet.png)
203b41c2519f5a2da51b147a933424ca5465079cce2dc8ff45eac36e0d629e03
```
