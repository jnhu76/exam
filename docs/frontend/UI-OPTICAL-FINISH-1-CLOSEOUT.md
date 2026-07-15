# UI-OPTICAL-FINISH-1 — Closeout

## A. Final verdict

UI-OPTICAL-FINISH-1 is **READY FOR HUMAN VISUAL ACCEPTANCE**. Optical finish is implemented, table mechanics and business behavior are unchanged, and full visual closure remains pending human acceptance.

## B. Branch and HEAD

- Branch: `feat/ui-visual-fixes`
- Starting HEAD: `871c924fe3082a6300dcee8007b3f594d03646ed`
- Production implementation HEAD: `06a49df` (`fix(ui): align row action optical spacing`)
- Final evidence-tooling HEAD: `3a0fe59` (`test(ui): make optical capture route selectable`)
- The final documentation commit containing this closeout is recorded in the final handoff report.

## C. Commit chain

1. `3e3eddd feat(ui): establish final neutral and surface finish`
2. `b4947c0 refactor(ui): refine table optical hierarchy and actions`
3. `14b49fe feat(ui): establish deterministic date time authority`
4. `47c9c98 feat(ui): add table overflow discoverability`
5. `06a49df fix(ui): align row action optical spacing`
6. `3a0fe59 test(ui): make optical capture route selectable`
7. `docs(ui): close optical finish phase`

## D. Optical root causes

The previous cobalt finish was internally consistent but mechanically uniform: the blue-cast canvas, blue-neutral borders, repeated 8px white bordered boxes, minimal role-specific depth, and broadly blue-grey icons gave unrelated components the same visual weight. The correction separates neutral canvas, clean business surfaces, neutral line levels, restrained primary use, and explicit flat, raised, and instrument roles.

## E. Final neutral and primary tokens

| Role | Value |
| --- | --- |
| canvas | `#f7f8fa` |
| surface / surface-raised | `#ffffff` |
| surface-subtle | `#fafbfc` |
| surface-soft | `#f6f8fa` |
| surface-hover | `#f7faff` |
| surface-selected | `#eef4ff` |
| text | `#182230` |
| text-secondary | `#344054` |
| text-muted | `#667085` |
| text-subtle | `#98a2b3` |
| primary | `#2563eb` |
| primary-hover | `#1d4ed8` |
| primary-active | `#1e40af` |
| primary-soft | `#eff4ff` |
| primary-soft-strong | `#dbe7ff` |
| focus | `#84adff` |

Measured contrast includes 16.03:1 for primary text on white, 10.46:1 for secondary text, and 4.97:1 for muted text. `text-subtle` remains restricted to non-essential decoration.

## F. Surface-role authority

- Canvas: neutral page background without border or shadow.
- Flat business surface: white, 8px, shell border, no shadow; used by tables, toolbars, forms, and ordinary information panels.
- Raised business surface: white, 10px, raised border, controlled two-step micro-depth and inner highlight; used by StatsCard and high-priority summary roles.
- Instrument surface: clean white operational presentation with role-specific internal hierarchy; diagnostics metric, information, scanner, and disabled infrastructure roles no longer share one header treatment.

## G. Border hierarchy

`border-control #cfd7e2` > `border-raised #d7dde5` > `border-shell #dde2e8` > `border-divider #edf0f3`. Ordinary boundaries are neutral rather than blue-tinted, and nested complete boxes were reduced.

## H. Table optical changes

Tables now use a `#fafbfc` header, `#d7dde5` header boundary, white rows, `#edf0f3` dividers, restrained hover/focus/selected states, 13px muted headers, 14px body text, medium-weight name cells, and tabular numerics. RowActions are transparent at rest with 32px desktop targets, 44px touch targets, 16px icons, 4px gaps, role-specific hover feedback, and a visible focus ring.

The 48px row contract, semantic columns, atomic nowrap, Exam widths (`224 / 88 / 88 / 104`), minimum widths, and local overflow ownership remain unchanged.

`DataTableShell` now centrally owns state-aware left/right edge fades and an optional narrow touch hint. It exposes `data-overflowing`, `data-scroll-start`, and `data-scroll-end`, observes container/content resize, does not intercept input, and creates no document overflow. The deterministic correction is **CLOSED**.

## I. Toolbar and controls

List and data toolbars use the quiet flat role, 56px minimum height, 10px/12px padding, no shadow, and fewer nested outlines. Inputs and filters use white surfaces, neutral control borders, compact radii, and clear focus. Primary, outline, hover, and focus button treatments now have distinct but restrained weight.

## J. Tags and statuses

Tags use `#f8fafc`, `#e4e7ec`, `#475467`, 22px height, 5px radius, and 12/16 regular typography. Status badges retain `StatusMeta` semantics while using compact 5px geometry, 12/16 medium typography, and quiet semantic borders.

## K. StatsCard finish

StatsCard uses the raised role, 10px geometry, 16px padding, compact blue-soft icon anchors, tight label/metric grouping, stable metric baselines, and micro-depth visible only at close inspection. No gradients or decorative strips were added.

## L. Diagnostics hierarchy

Metrics are raised with strong values and quiet labels; information cards are flat with compact key/value structure; scanner cards have stronger timestamp and interruption hierarchy; disabled infrastructure cards use a quiet readable surface without opacity fading. Diagnostics timestamps now render through the shared product formatter as `YYYY-MM-DD HH:mm:ss` and cannot change to host-locale AM/PM or date ordering. Time-zone precedence is organization authority, deployment configuration, then documented browser fallback. The deterministic time correction is **CLOSED**.

## M. Sidebar finish

The navigation structure is unchanged. The sidebar now uses `#15171b`, hover `#202329`, active `#252830`, text `#f5f7fa`, muted `#aeb6c2`, and divider `#2b2f36`, with a restrained active inset highlight and improved inactive icon/text balance.

## N. Page migration matrix

| Page | Applied authority |
| --- | --- |
| Dashboard | raised StatsCards; separated white title band and subtle table header |
| Exams | refined rows, statuses, action states, deterministic date ranges |
| Questions | quiet toolbar, compact tags/actions, local overflow affordance |
| Courses | quiet toolbar and primary table hierarchy |
| Candidates | neutral table/status/action finish |
| Users | sparse composition with schema-appropriate table width |
| System Diagnostics | metric/information/scanner/infrastructure roles; deterministic time |
| Other date-bearing product surfaces | shared date/time authority replacing uncontrolled locale rendering |

## O. Tests and build

- Focused optical/shared/date-time/table tests: passing.
- Full web suite: 92 files, 1058 tests passing.
- `pnpm verify`: 16/16 tasks successful, including formatting, ESLint, architecture lint, copy lint, typecheck, full coverage, and production build.
- Production build: 2,990 modules transformed; successful.
- Shared date-time authority has 100% statement/function/line coverage; host-locale invariance and time-zone precedence are directly tested.

## P. Before/after matrix

- Before: `/tmp/ui-optical-finish/before/` — Dashboard, Exams, Questions, Courses, Candidates, Users, and System Diagnostics at 1024, 1280, 1440, and 1920.
- After: `/tmp/ui-optical-finish/after/` — the same routes at 420, 1024, 1280, 1440, and 1920.
- Both matrices use browser zoom 100%, DPR 1, and stable route/data/scroll conditions.

## Q. DPR 1 crops

`/tmp/ui-optical-finish/crops/` contains StatsCard, dashboard table, Exam row/action/status states, Question toolbar/tags/actions, Course toolbar/table, Candidate table, sparse User table, diagnostics role cards, sidebar states, control interaction states, and overflow start/middle/end crops. `runtime.json` records DPR 1, zoom 1, document overflow 0, and local table overflow ownership.

## R. Independent review findings

The separate screenshot-first adversarial review is recorded in `docs/frontend/UI-OPTICAL-FINISH-1-REVIEW.md`. Verdict: PASS, with no P0/P1. Deterministic time and horizontal-scroll discoverability are both CLOSED.

## S. Corrective iterations

1. Replaced the cold canvas and blue-neutral line system with neutral authorities.
2. Separated flat, raised, and diagnostics instrument roles.
3. Refined table typography, row life, focus, actions, tags, and statuses while freezing mechanics.
4. Removed a residual filled-looking keyboard action state and recaptured the interaction crop.
5. Aligned the final RowActions gap from 6px to the specified 4px and recaptured the complete evidence matrix.
6. Migrated uncontrolled frontend locale rendering to a shared explicit product formatter.
7. Added and verified state-aware local table overflow discoverability.

## T. Remaining P2/P3

None in the accepted technical scope. The former host-locale timestamp and overlay-scrollbar discoverability observations are **CLOSED** and are not deferred.

## U. Human visual acceptance boundary

The technical, test, responsive, DPR 1, and independent adversarial gates pass. This phase stops at **READY FOR HUMAN VISUAL ACCEPTANCE**. The frontend is not declared visually closed until a human accepts the rendered product.
