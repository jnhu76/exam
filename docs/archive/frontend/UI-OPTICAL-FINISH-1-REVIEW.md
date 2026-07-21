# UI-OPTICAL-FINISH-1 — Independent Adversarial Visual Review

## Verdict

**PASS — no P0 or P1 findings.** UI-OPTICAL-FINISH-1 is ready to stop at the human visual acceptance boundary.

This review was performed in a separate context that did not author the implementation. The reviewer inspected the rendered evidence first, before reading implementation files, tests, commits, or reports.

## Screenshot-first evidence inspected

- Before matrix: `/tmp/ui-optical-finish/before/`
- After matrix: `/tmp/ui-optical-finish/after/`
- DPR 1 crops and runtime evidence: `/tmp/ui-optical-finish/crops/`
- Routes: Dashboard, Exams, Questions, Courses, Candidates, Users, and System Diagnostics
- Widths: 1024, 1280, 1440, 1920, plus the after-state at 420
- Interaction crops: row hover, action hover, keyboard focus, button hover, input focus
- Overflow crops: start, middle, and end
- Runtime evidence: DPR `1`, browser zoom `1`, document overflow `0`, table overflow owner `local`

The complete after matrix and interaction crops were re-inspected after commit `06a49df` corrected RowActions to the final 4px gap and refreshed the focus-state evidence. The final System Diagnostics 1920 capture was inspected again after the evidence request window reset; it contains no stale-data banners and retains exact 24-hour/date-time output.

## P0 findings

None.

## P1 findings

None.

The explicit P1 checklist was evaluated as follows:

| P1 condition | Result | Evidence |
| --- | --- | --- |
| Canvas remains visibly blue | Pass | The after matrix reads as neutral light grey; white tables, toolbars, and cards separate cleanly from it. |
| Surfaces remain mechanically identical | Pass | Flat table/toolbar surfaces, raised dashboard/metric cards, scanner cards, and quiet disabled infrastructure cards have distinct weights. |
| Ordinary borders remain blue-tinted | Pass | Lines read neutral and thin across every inspected route. |
| Toolbar and table look like equal cards | Pass | Question/Course crops show quiet, unshadowed toolbars with more negative space; the table remains the principal data surface. |
| Table rows remain inert | Pass | Rest, hover, focus-within, and action-hover crops show restrained but visible state changes without geometry changes. |
| Action buttons appear selected at rest | Pass | Default actions are transparent; hover/focus treatment appears only in the corresponding interaction crops. |
| Tags look like default outlined pills | Pass | Question tags are compact, low-weight rounded rectangles rather than saturated or fully rounded pills. |
| StatsCards remain generic bordered boxes | Pass | Dashboard cards show the raised role, 10px geometry, icon anchor, tighter label/metric grouping, and controlled micro-depth. |
| Diagnostics hierarchy remains undifferentiated | Pass | Metric, information, scanner, and disabled infrastructure cards are visibly distinct. |
| Sidebar remains disconnected | Pass | Neutral-dark sidebar, quieter inactive rows, contained active surface, restrained dividers, and aligned brand/icon treatment match the refined product. |
| Primary blue leaks into ordinary UI | Pass | Blue is reserved for primary actions, selected/status information, focus, and metric icon anchors. |
| Micro-depth is applied everywhere | Pass | Depth is limited to raised roles; tables, toolbars, information cards, and scanner cards remain flat. |
| Large shadows or decorative gradients | Pass | No large business-surface shadows or decorative gradients are visible. The only inspected gradient is the narrow functional table-edge affordance. |
| DPR 1 regresses | Pass | All authoritative crops are crisp at DPR 1. |
| Table flow/nowrap regresses | Pass | Date ranges, durations, scores, statuses, and actions remain atomic in the desktop matrix and scroll locally at 420. |
| Responsive overflow regresses | Pass | The 420 matrix has no document-level horizontal overflow; wide tables remain locally scrollable. |
| Business behavior changes | Pass | Review of the change boundary after visual inspection found presentation/formatting/overflow-state changes only; no API, authorization, route, state-machine, grading, or exam behavior change was identified. |
| Before/after difference is not material | Pass | The combined neutral canvas, neutral line hierarchy, raised summary cards, quieter table treatment, role-specific diagnostics, interaction feedback, and refined sidebar create a visible product-level change rather than a token-only recolor. |

## Deterministic date/time corrective

**CLOSED.** System Diagnostics renders 24-hour `HH:mm:ss` refresh times and `YYYY-MM-DD HH:mm:ss` scanner timestamps in the after screenshots; no AM/PM or host-locale date ordering remains. Repository inspection after the screenshot review confirmed one shared project formatter with explicit `zh-CN`, explicit `h23`, and the precedence organization time zone → deployment time zone → browser fallback. Migrated product surfaces do not directly call uncontrolled locale formatting.

The focused formatter tests prove stable `2026-07-14 09:02:03` output for the same selected time zone across host-locale inputs and cover date, time, date-time, date range, duration integration, and time-zone precedence.

## Horizontal-scroll discoverability corrective

**CLOSED.** The start crop shows a right-edge cue and the compact touch hint; the middle crop shows both edge cues; the end crop shows the left-edge cue. The cues are narrow, non-decorative, and do not cover actionable content. The hint and fades are non-interactive, and no fake scrollbar is introduced.

`DataTableShell` remains the sole local owner. Its semantic attributes expose overflow, start, and end state; ResizeObserver, resize, child changes, and scroll updates feed that state. Focused tests cover non-overflow, start/middle/end, overflow-to-fit resize, narrow touch hint, local scrolling, and zero document overflow. Runtime evidence records `tableOverflowOwner: "local"` and `documentOverflow: 0`.

## Table mechanics and business behavior

- Frozen semantic column roles and the Exam widths (date range 224, duration 88, score 88, actions 104) remain unchanged.
- Atomic nowrap and local overflow ownership remain intact.
- Row height remains 48px in the interaction crops.
- No API, database, authorization, routing, exam-state, grading, or answer-save behavior was changed.

## Test corroboration

After the initial visual review, the web suite was run independently: **92 test files passed, 1058 tests passed**. After the final 4px RowActions correction, the focused shared-owner suite passed **65 tests** and the complete final interaction/DPR 1 evidence was recaptured and re-inspected. These results corroborate the date/time, table shell, diagnostics, and shared-component contracts; they do not substitute for the visual verdict above.

## P2 findings

None.

## P3 findings

None.

## Human acceptance boundary

The implementation clears the independent technical and adversarial visual gate. Full visual closure remains explicitly pending human acceptance; this review does not declare the frontend visually closed.
