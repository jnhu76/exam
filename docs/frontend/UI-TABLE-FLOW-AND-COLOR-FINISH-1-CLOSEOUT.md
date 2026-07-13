# UI-TABLE-FLOW-AND-COLOR-FINISH-1 — Closeout

## A. Final verdict

Implementation is ready for human visual acceptance. Atomic wrapping is closed, semantic column authority is active, the cobalt/blue-neutral finish is implemented, and business behavior is unchanged. Visual closure remains with the human screenshot reviewer.

## B. Branch and implementation HEAD

- Branch: `feat/ui-visual-fixes`
- Task start: `27b04b793021b5408f8ad78b8d280b64d6811f18`
- Reviewed implementation HEAD before closeout documentation: `1a85dfe`
- The final documentation commit and final repository HEAD are reported in the task's final response.

## C. Commit chain

1. `59e1105 fix(ui): establish deterministic table column flow`
2. `7d5c0d8 refactor(ui): apply semantic column contracts to management tables`
3. `95c365f refactor(ui): align embedded tables with column authority`
4. `3a57f97 feat(ui): refine table interaction and line hierarchy`
5. `e3fe0cd feat(ui): apply cobalt visual finish system`
6. `54d0b86 refactor(ui): polish dashboard and diagnostics surfaces`
7. `1a85dfe fix(ui): restore table shell overflow ownership`

## D. Table compression root cause

The Exam duration column used an undersized 64px allocation while cells had 32px combined horizontal padding, leaving about 32px for `90分钟`. The table used browser automatic allocation (`table-layout: auto`), and atomic cells had no nowrap/minimum-width authority. Wider flexible columns consumed the remaining width while duration stayed compressed. The defect was therefore a combination of undersized widths, missing atomic wrap policy, and browser auto allocation—not `table-layout: fixed` or page max-width alone.

## E. Atomic/flexible authority

Atomic roles are `status`, `date`, `date-range`, `duration`, `number`, `score`, `short-id`, `type`, and `actions`. They emit `white-space: nowrap`, `word-break: normal`, and `overflow-wrap: normal`; numeric/date roles also use tabular numerals. Flexible roles are `primary-text`, `secondary-text`, `long-text`, `description`, and `tag-list`.

## F. Column-contract API

- `DataTableColumns` emits a typed semantic `colgroup`.
- `DataTableHead` and `DataTableCell` emit `data-column-role` and the derived atomic/flexible wrap contract.
- `DataTableShell` owns compact/standard/wide minimum table widths and the sole local overflow region.
- CSS recipes map semantic roles to stable widths/minimum widths. Pages do not provide arbitrary width utility strings as their primary authority.

## G. Per-table migration matrix

| Family | Consumers | Contract notes |
| --- | --- | --- |
| Dashboard/Exam | `DashboardPage`, `ExamPage` | flexible title; stable status/date/duration/number/score/actions |
| Exam embedded/detail | `ExamCreatePage`, `ExamEditPage`, `ExamDetailPage`, `AttemptDetailPage` | question/enrollment/audit detail tables use contextual semantic roles |
| Question | `QuestionPage`, `QuestionImportPage` | compact type, flexible content/tags, stable score/difficulty/actions |
| People | `UsersPage`, `CandidatesPage`, `CandidateFieldsPage` | identifiers/status/actions atomic; Candidates uses wide contract; Users uses sparse page role |
| Course | `CoursePage` | flexible name/description, atomic code/actions |
| Grading/results | `GradingQueuePage`, `ScoreListPage`, `ResultsOverviewPage`, `ResultPage` | identifiers/status/date/score/actions remain atomic |
| Operations | `AuditLogPage`, `ImportLogsPage` | timestamp/status/type/actions remain atomic |

`GradingDetail` and proctor views do not currently render the shared `Table` primitive, so there was no equivalent-table bypass to migrate. The migration test enumerates every production `Table` consumer and rejects raw `TableHead`/`TableCell` usage.

## H. Final color tokens

| Role | Value |
| --- | --- |
| canvas | `#f4f7fb` |
| surface | `#ffffff` |
| surface subtle | `#f7f9fc` |
| surface hover | `#f4f8ff` |
| text | `#162033` |
| text secondary | `#3f4d63` |
| text muted | `#66758b` |
| text subtle | `#94a3b8` |
| primary | `#2e6afd` |
| primary hover | `#2458d6` |
| primary active | `#1d46b3` |
| primary soft | `#edf3ff` |
| primary soft strong | `#dce8ff` |
| primary focus | `#7aa2ff` |

The proposed `#2f6bff` primary measured 4.4988:1 against white. It was minimally darkened to `#2e6afd`, which measures 4.569:1 and remains in the same cobalt family. Ordinary text/surface ratios range from 4.69:1 (`text-muted`) to 16.30:1 (`text`). Status text/surface pairs range from 5.08:1 to 6.98:1.

## I. Border hierarchy

- Header boundary: `#c9d5e3` (strongest internal line)
- Shell boundary: `#d6e0eb`
- Repeated row divider: `#e6ecf3` (lightest)
- Control boundary: `#c7d2df`

No default vertical grid lines were introduced.

## J. Row interaction behavior

Rows are white at rest, `#f5f9ff` on hover, `#f2f7ff` on focus-within, and `#edf4ff` when selected. Focus/selection uses an inset 2px `primary-soft-strong` leading accent with no layout shift. Background and box-shadow transitions are 120ms; dimensions never animate.

## K. Action-cell behavior

Action columns are 104px in the Exam golden contract and right aligned. Icon actions are 36×36px on desktop and 44×44px for direct-touch pointers, with 16px icons, 6px radius, and 6px group gap. Rest state is transparent and neutral. Neutral hover/focus uses cobalt soft blue; destructive hover/focus uses soft red. Text actions retain intrinsic width and gain a 44px touch minimum height.

## L. Tag/status refinements

`TagBadge` owns ordinary-tag presentation: 24px height, 6px radius, 6px horizontal padding, 12px regular text, subtle neutral fill, and row-border color. `StatusBadge` retains centralized status semantics and now adds the same compact geometry plus tone-specific soft borders. Informational status is no longer a solid primary pill.

## M. Dashboard refinements

`StatsCard` uses a white surface, shell border, the approved micro-depth, a 32px primary-soft icon anchor with primary-soft-strong border, and a 20px icon. Label/value/supporting state form one compact group. Recent Exams uses the final table contract and line system.

## N. Sparse-list roles

`PageContainer` now exposes `admin-sparse` (`max-w-5xl`, approximately 1024px). Users selects it because its five-column schema otherwise produces excessive horizontal dead space. Width selection is schema-based, not row-count-based.

## O. Diagnostics hierarchy

- KPI: shared `StatsCard`, dominant number, compact label/state, approved micro-depth.
- Information: flat white key/value surface with light header boundary.
- Scanner: flat detail card with stronger tinted header and explicit scanner role.
- Disabled infrastructure: quiet subtle surface and row border while remaining readable.

## P. Tests/build

- Focused visual/contract tests: 90/90, then corrective subset 68/68.
- Full Web test suite: 91 files, 1047 tests passed.
- Web coverage: 77.98% statements, 71.68% branches, 71.89% functions, and 80.03% lines.
- API coverage: 93 files, 942 tests passed and 5 skipped; 83.64% statements, 70.63% branches, 87.42% functions, and 84.75% lines.
- Web production build: passed; 2987 modules transformed.
- Formatting, ESLint, architecture lint, copy lint, and root code-quality lint: passed.
- Final repository-wide `pnpm verify`: passed with 16/16 coverage tasks and 9/9 build tasks successful.

## Q. Table runtime probes

| Viewport | Shell client | Shell scroll | Table | Primary | Date range | Duration | Score | Actions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 420 | 386 | 982 | 982 | 220 | 224 | 88 | 88 | 104 |
| 1024 | 902 | 982 | 982 | 220 | 224 | 88 | 88 | 104 |
| 1280 | 982 | 982 | 982 | 220 | 224 | 88 | 88 | 104 |
| 1440 | 1142 | 1142 | 1142 | 380 | 224 | 88 | 88 | 104 |
| 1920 | 1278 | 1278 | 1278 | 516 | 224 | 88 | 88 | 104 |

Across 35 DPR 1 entries (30 table instances) and 7 DPR 2 entries (6 table instances): zero atomic wraps, zero document overflows, zero incorrect overflow owners. `90分钟`, `45分钟`, `30分钟`, `60分钟`, `15/25`, `12/18`, `20/31`, and `10/13` all measured one line.

## R. Screenshot matrix

- Before Exam baseline: `/tmp/ui-table-finish/before/exams-{1024,1280,1440,1920}.png`
- Final DPR 1 full pages: `/tmp/ui-table-finish/after/{dashboard,exams,questions,users,courses,candidates,system}-{420,1024,1280,1440,1920}.png`
- Final DPR 2 comparison: `/tmp/ui-table-finish/after/{dashboard,exams,questions,users,courses,candidates,system}-1440-dpr2.png`
- Final crops: `/tmp/ui-table-finish/crops/`
- Golden corrective widths: `/tmp/ui-table-finish/after-exam-corrective/exam-width-probe.json`

## S. Review findings and corrections

The adversarial review found one product P1: nested shadcn table overflow intercepted the declared shell owner. It was corrected and re-probed. Validation also found API-rate-limit batching and headless screenshot-compositor issues; the harness was changed to bounded SPA batches, incremental probes, exact route readiness, disabled GPU composition, and `body` element screenshots. See the review document for the full checklist.

## T. Remaining P2/P3

- P2: diagnostics timestamps still use host-locale formatting and may show US date order/AM-PM.
- P3: native local horizontal scrolling has no additional persistent hint on overlay-scrollbar platforms.

## U. Human visual acceptance boundary

Automated structure, behavior, contrast, runtime widths, wrapping, overflow, DPR clarity, and adversarial P0/P1 gates pass. The complete UI must not be declared visually closed until a human accepts the supplied screenshots.
