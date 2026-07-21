# UI-OPTICAL-FINISH-1 — Human Corrective Review

Review date: 2026-07-14  
Review method: independent screenshot-first acceptance, followed by implementation and focused-test verification  
Final verdict: **PASS — no open P0, P1, P2, or P3 findings**

## 1. Review boundary

The initial visual verdict was formed before reading repository files, tests, runtime evidence, reports, git state, or prior reviewer messages. Every PNG in `/tmp/ui-optical-human-corrective/after/` was inspected at original resolution. Ambiguous or merely subtle cues were treated as failures.

Implementation, tests, and capture evidence were inspected only after the screenshot-first verdict had been sent.

## 2. Screenshot-first initial verdict

The first complete crop set **failed** one acceptance condition.

The following requested distinctions already passed:

- `dashboard-stats-card.png` read as a deliberately raised StatsCard.
- `course-toolbar.png` was visibly quieter than `course-table.png`.
- `system-role-comparison.png` distinguished raised metrics, flat information blocks, scanner panels, and disabled infrastructure panels.
- `exam-table-default.png`, `exam-row-hover.png`, `exam-action-hover.png`, and `exam-action-keyboard-focus.png` showed distinct rest, row-hover, neutral-action-hover, and keyboard-focus states for identical data.
- `question-destructive-action-hover.png` was unmistakably destructive and clearly different from the neutral action hover.
- `question-tags-actions.png` kept metadata tags visually separate from domain statuses.
- `sidebar-active-inactive.png` used a narrow active rail plus active icon/text treatment rather than a filled selection slab.

The blocking failure was horizontal-scroll presentation. In the first `table-scroll-start.png`, `table-scroll-middle.png`, and `table-scroll-end.png` set, grey edge fades read as curtains. The middle crop showed them on both sides, and the end crop showed a left curtain over the clipped edge. Although the table remained usable, the acceptance requirement explicitly prohibited grey curtains and cues that visibly covered content. The initial verdict was therefore **FAIL**.

## 3. Corrective iterations

1. The narrow-table direction hint was made state-aware and persistent while overflow exists:
   - start: `向右滑动查看更多`;
   - middle: `左右滑动查看更多`;
   - end: `向左滑动查看更多`.
2. The direction hint remained a separate 24px strip below the scrolling table, so it did not overlay rows, headers, tags, or actions.
3. The first edge treatment remained too visually heavy in the blind review. It was reduced from the visible two-stop grey treatment to a single 8px fade with only 4% maximum muted-ink opacity.
4. The DPR 1 crop set was recaptured after the final treatment, and the three scroll-state crops were re-reviewed independently before implementation discussion resumed.

## 4. Final screenshot verdict

**PASS.** In the final crops, the grey-curtain effect is no longer visibly perceptible and no affordance visibly veils table content.

| Crop | Final visual signal | Result |
| --- | --- | --- |
| `table-scroll-start.png` | Right-aligned `向右滑动查看更多`; table content remains uncovered | Pass |
| `table-scroll-middle.png` | Centered `左右滑动查看更多`; ordinary viewport clipping at both edges, with no visible curtain | Pass |
| `table-scroll-end.png` | Left-aligned `向左滑动查看更多`; tags and actions remain uncovered | Pass |

The partial glyphs at the viewport edges in the middle and end crops are normal horizontal-scroll clipping, not affordance coverage. An unbriefed human can identify all three states from the separate direction strip without relying on the edge fade.

The complete final crop set also retained all of the distinctions that passed in the initial review. The final human-corrective visual gate therefore passes as a whole.

## 5. Frozen-boundary verification

Repository inspection after the visual verdict found no frozen-boundary regression.

### Table mechanics

- `DataTableContract` column roles and allocations are unchanged.
- Frozen widths are unchanged, including date range `14rem` (224px), duration `5.5rem` (88px), score `5.5rem` (88px), and actions `6.5rem` (104px).
- Compact, standard, and wide minimum table widths remain `45rem`, `61.25rem`, and `75rem`.
- Atomic columns retain `white-space: nowrap`, normal word breaking, and normal overflow wrapping.
- `DataTableShell` remains the sole local horizontal-overflow owner through `data-overflow-owner="local"` and `overflow-x-auto`.
- The nested generated table container remains `overflow-x: visible`, avoiding a second scroll owner.
- Overflow state calculation, start/end thresholds, ResizeObserver handling, resize handling, and scroll handling are unchanged. The corrective only changes the rendered affordance and its labels.

### Date and time

The shared date/time formatter and its tests are unchanged. The established explicit `zh-CN`, `h23`, `YYYY-MM-DD`, `HH:mm:ss`, date-range, duration, and time-zone precedence behavior remains intact.

### Business behavior

No API, repository, database, authorization, route, exam state-machine, grading, answer-save, or candidate-runtime file changed in this corrective. The diagnostics changes add presentational role/emphasis attributes around already-rendered values; they do not alter data fetching, polling, health interpretation, or business decisions. Toolbar, sidebar, badge, StatsCard, action, surface, and table changes remain within shared visual/component authority.

## 6. Capture correctness

The final evidence set is current and internally consistent:

- All 23 PNGs in `/tmp/ui-optical-human-corrective/after/` were freshly captured together at DPR 1 and reviewed at original resolution.
- The harness fixes the browser viewport, device scale factor, light color scheme, and reduced motion.
- Hover evidence uses real pointer hover and waits for the transition to settle.
- Keyboard-focus evidence reaches the exact action through repeated `Tab` traversal and fails capture if that element is not the active element; it is not produced by calling `.focus()` directly.
- Destructive-hover evidence verifies the exact enabled destructive action, confirms `:hover`, confirms membership in `RowActions`, and records the computed destructive background and foreground.
- Start, middle, and end crops use the same live local scroll region and dispatch scroll events after setting the real horizontal position.
- `runtime.json` records DPR `1`, zoom `1`, document overflow `0`, `tableOverflowOwner: "local"`, a true overflowing state, and the final end position (`scrollStart: "false"`, `scrollEnd: "true"`). It also records the final left fade as a 4% single-stop gradient and no right fade at the end state.
- The final crop timestamps form one contiguous capture run, so the accepted scroll crops are not stale relative to the other interaction evidence.

## 7. Test corroboration

Focused final verification passed:

```text
Test Files  3 passed (3)
Tests       87 passed (87)
Duration    4.82s
```

The focused run covered shared visual owners and overflow state, System Diagnostics roles, and table visual-finish authority. It directly checks non-overflow behavior, start/middle/end affordance state, overflow-to-fit resize, direction-specific narrow hints, local overflow ownership, zero document overflow, diagnostics role markers, the 8px fade width, and the final 4% opacity token.

No coverage run or full `pnpm verify` was performed as part of this independent corrective review; those broader gates remain reported by the owning implementation workflow. The focused tests corroborate but do not replace the screenshot-first visual verdict.

## 8. Severity findings

- P0: none.
- P1: none.
- P2: none.
- P3: none.

The initial horizontal-scroll curtain was a blocking visual acceptance failure, but it is closed in the final evidence and is not an open finding.

## 9. Final acceptance statement

UI-OPTICAL-FINISH-1 human corrective review is **PASS**. The final rendered evidence makes every required role and interaction state recognizable, preserves scroll discoverability without visible grey curtains or content coverage, and leaves the frozen table, date/time, overflow-owner, and business-behavior boundaries unchanged.
