# UI-TABLE-FLOW-AND-COLOR-FINISH-1 — Adversarial Review

## Verdict

PASS after one implementation corrective. No P0 or P1 finding remains. This is a narrow review of table flow and the final color/surface finish, not a new UI-system audit.

## Evidence reviewed

- DPR 1 full-page matrix: Dashboard, Exams, Questions, Users, Courses, Candidates, and System at 420, 1024, 1280, 1440, and 1920px.
- DPR 2 comparison matrix: the same seven routes at 1440px.
- Unscaled crops for Exam table, duration/date/score cells, row hover, row focus, action hover, Dashboard StatsCard, Question toolbar/table, and System KPI/information/scanner cards.
- Runtime probes in `/tmp/ui-table-finish/after/visual-matrix-probe-dpr1.json`, `/tmp/ui-table-finish/after/visual-matrix-probe-dpr2.json`, and `/tmp/ui-table-finish/after-exam-corrective/exam-width-probe.json`.
- Static migration guard covering every production `Table` consumer.

## P0 findings

None.

## P1 findings and corrections

### P1-1 — nested table container intercepted local overflow

Initial post-implementation probing found that `DataTableShell` declared the local overflow region, but the generated shadcn `Table` container retained its own `overflow-x-auto`. At 1024px the outer region was 902px wide and the table was 982px wide, while the outer `scrollWidth` remained 902px. Scrolling was visually local, but the declared owner was not the actual owner.

Correction: the semantic table recipe now sets the nested `[data-slot="table-container"]` to `overflow-x: visible` only inside `DataTableShell`. The shell region now reports `clientWidth 902 / scrollWidth 982` at 1024px and `386 / 982` at 420px. No document-level overflow was introduced.

Status: CLOSED by `1a85dfe`.

## Validation-harness findings

- Repeated full-page reloads exceeded the development API's global 100-request/minute limit. The matrix was changed to one authenticated React session with SPA route transitions and was split into bounded batches.
- `page.screenshot({ fullPage: true })` intermittently produced black compositor blocks despite computed `html/body/#root` backgrounds of `rgb(244, 247, 251)`. Final deliverables use `body` element screenshots with Chromium GPU compositing disabled. These were harness artifacts, not product CSS findings.
- Route readiness now requires the exact page heading and the page-specific business surface, preventing a previous route's table from satisfying the next route's wait condition.

## P1 checklist

| Gate | Result | Evidence |
| --- | --- | --- |
| Short atomic values never wrap | PASS | 0 wrapping atomic cells across 35 DPR 1 and 7 DPR 2 entries |
| Duration/score/actions resist compression | PASS | Exam widths remain 88/88/104px at all probed widths |
| Narrow tables scroll locally | PASS | 1024: 902→982px; 420: 386→982px |
| No document overflow | PASS | 0 matrix entries with document overflow |
| Equivalent tables use column contracts | PASS | 18 production consumers; no raw `TableHead`/`TableCell` consumer bypass |
| Three line levels remain distinct | PASS | header `#c9d5e3`, shell `#d6e0eb`, row `#e6ecf3` |
| Header separates from rows | PASS | `#f6f9fd` header against white rows |
| Rows have restrained interaction life | PASS | hover/focus/selected surfaces plus 120ms color/elevation-free transition |
| Actions are neutral at rest | PASS | neutral icon color and transparent background; tone appears on hover/focus |
| Generic `#2563eb` is retired | PASS | no active source occurrence; cobalt authority is `#2e6afd` |
| Dashboard StatsCard is controlled, not flat | PASS | shell border, approved micro-depth, 32px soft-blue icon anchor |
| Question toolbar differs from table | PASS | governed `quiet` toolbar with lighter row border and reduced vertical density |
| Sparse lists avoid excess stretch | PASS | Users uses `admin-sparse` / `max-w-5xl` |
| Status/tag geometry is final | PASS | 24px height, 6px radius, semantic soft surface and border |
| DPR 1 clarity is stable | PASS | unscaled crops show crisp 16px actions and 20px KPI icons |
| Business behavior changed | PASS (none) | no route, API, state, authorization, or handler changes |

## Remaining P2/P3 observations

- P2: diagnostics timestamps still follow the host locale and can render US date order with `AM/PM`; localization is existing behavior and outside this visual-finish scope.
- P3: on platforms with overlay scrollbars, a 420px table relies on native horizontal-scroll affordance. The content remains reachable and the page itself never overflows; a persistent scroll hint could be evaluated separately.

Neither observation blocks human visual acceptance.
