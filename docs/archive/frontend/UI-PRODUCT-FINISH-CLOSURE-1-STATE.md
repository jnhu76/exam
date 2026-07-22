# UI-PRODUCT-FINISH-CLOSURE-1 — Living Execution State

> Operational continuity ledger. Updated after every commit/review iteration.
> Not a narrative report. The next agent resumes from "Next exact action".

## Branch / HEAD

- branch: `feat/ui-visual-fixes`
- HEAD: `7c6669365fe29ec27ae746bf3ced99bab9b3019f` (clean at start; advanced as commits land)
- working tree: clean

## Frozen authorities

- `DESIGN.md` — project-owned visual authority (read, do not reopen wholesale).
- Responsive shell: <1024 drawer · 1024–1279 56px rail · ≥1280 sidebar.
- Table mechanics: `DataTableShell` + `DataTableColumns/Head/Cell` + semantic roles + atomic nowrap + width contracts.
- Time authority: deterministic formatter (`lib/dateTime.ts`), 24h, YYYY-MM-DD HH:mm:ss.
- Icon authority: Lucide via `AppIcon`, integer dims, no fractional scaling.
- Visual foundation: neutral canvas `#f5f7fa`, white surfaces, flat/raised/instrument roles, thin neutral borders, quiet toolbars, `statusMeta`+`StatusBadge`.

## Route inventory (authoritative, from App.tsx)

### Auth
- `/login` — LoginPage
- `*` → redirect to /login

### Admin (AdminLayout)
- `/admin` → redirect dashboard
- `/admin/dashboard` — DashboardPage (golden)
- `/admin/system` — SystemDiagnosticsPage (golden); `/admin/diagnostics` → redirect system
- `/admin/settings` — SettingsPage (form)
- `/admin/candidate-fields` — CandidateFieldsPage
- `/admin/users` — UsersPage (list)
- `/admin/candidates` — CandidatesPage (list)
- `/admin/courses` — CoursePage (list)
- `/admin/questions` — QuestionPage (list, golden)
- `/admin/questions/new` + `/admin/questions/:id/edit` — QuestionEditPage (form)
- `/admin/questions/import` — QuestionImportPage
- `/admin/exams` — ExamPage (list, golden)
- `/admin/exams/new` — ExamCreatePage (form)
- `/admin/exams/:id` — ExamDetailPage (detail)
- `/admin/exams/:id/edit` — ExamEditPage (form)
- `/admin/exams/:id/scores` — ScoreListPage (list)
- `/admin/exams/:id/proctor` — ProctorDashboardPage
- `/admin/exams/:id/proctor/monitor` — ExamMonitoringPage
- `/admin/results` — ResultsOverviewPage (list)
- `/admin/grading-queue` + `/admin/grading-queue/:id` — GradingQueuePage / GradingDetailPage
- `/admin/audit-logs` — AuditLogPage (list)
- `/admin/import-logs` — ImportLogsPage (list)
- `/admin/attempts/:id` — AttemptDetailPage (detail)
- `*` → PlaceholderPage

### Candidate (ExamLayout)
- `/exam` → redirect list
- `/exam/list` — ExamListPage
- `/exam/settings` — ExamSettingsPage
- `/exam/:examId/start` — StartExamPage
- `/exam/:attemptId/take` — TakeExamPage
- `/exam/:attemptId/result` — ResultPage

## Capture / DB notes (safety)

- Dev `exam` DB: 4 exams, 5 users, 10 questions, 8 attempts — **ALL graded, no enrollments, no candidate workflow data.** Preserved untouched throughout.
- Admin capture: isolated Vite dev on port **4180** (proxies /api → existing human API on 3000 → `exam` DB). Does NOT touch the human's 4173/3000 session.
- Candidate workflow capture: disposable **`exam_e2e`** DB (created+migrated+e2e-seeded), isolated API on **3200**, isolated Vite dev on **4181** (absolute `@` alias via `/tmp/ui-product-finish/vite-e2e.config.ts`, root=apps/web). **DROP `exam_e2e` at closeout.** Never seeded `exam` or `exam_test`.
- e2e-seed credentials: candidate1=in_progress/resume, candidate2=available/start, candidate3=disrupted/resume, candidate4=graded/result. Real IDs captured in `capture-cand.mjs`.
- Capture scripts in `/tmp/ui-product-finish/`: `capture.mjs` (list routes, env CAP_ROLE/CAP_WIDTHS/CAP_OUTPUT), `capture-id.mjs` (param routes), `capture-cand.mjs` (per-candidate workflow). Run from `apps/e2e` (ESM needs node_modules); copies at `apps/e2e/scripts/cap-finish*.mjs` (cleanup at closeout). All produce `overflow-*.json` reporting document overflow + nav/console errors per shot.

## Baseline verdict (1280 width, all route families)

Frontend is **already well-built** from prior phase work: list/detail/form/candidate pages render coherently with established authority (DataTableShell, PageHeader, StatsCard, StatusBadge, deterministic dates, AppIcon). No document overflow at 1280. The remaining work is **completeness and polish across the full viewport+state matrix**, not structural rebuild.

## Wave status

| Wave | Scope | Status |
| --- | --- | --- |
| 0 | Baseline + ledger + backlog | CLOSED |
| 1 | Golden admin (Dashboard, Exams, Questions, System) | IN PROGRESS |
| 2 | All admin lists | NOT STARTED |
| 3 | Forms/create-edit/settings | NOT STARTED |
| 4 | Detail/workflow pages | NOT STARTED |
| 5 | Candidate experience | NOT STARTED |
| 6 | State coverage (loading/empty/error/offline) | NOT STARTED |
| 7 | Responsive product pass | NOT STARTED |
| 8 | 100% zoom / rendering clarity | NOT STARTED |
| 9 | Accessibility & keyboard | NOT STARTED |
| 10 | Consistency sweep + DESIGN update | NOT STARTED |
| Final | Adversarial review + closeout | NOT STARTED |

## Baseline findings (1280 width, admin)

All admin list pages render coherently with established authority. No document overflow at 1280. Findings are predominantly P2/P3 polish, not structural.

### Data-state (NOT visual defects)
- dashboard: totalCandidates=0 (seed data; 401 on a sub-request — auth/data, not layout).
- results / grading-queue / import-logs: empty states (correct EmptyState rendering; no data in DB).
- candidate start-exam / result: render 404/error because `exam` DB has zero enrollments/attempts for candidate1.

### Backlog (actionable, by wave)
| ID | Wave | Route | Defect | Severity | Status |
| --- | --- | --- | --- | --- | --- |
| B1 | 1 | system | metric cards share near-identical card structure; instrument role not strongly distinct from admin list card | P2 | NOT STARTED |
| B2 | 1 | system | minor spacing inconsistency between info groups | P3 | NOT STARTED |
| B3 | 2 | results/grading-queue/import-logs | empty states render correctly but cannot validate populated density without data | P2 (data-blocked) | NOT STARTED |
| B4 | 5 | candidate start/take/result | no enrollment data in `exam` DB; must seed `exam_e2e` to capture | P1 (coverage blocker) | NOT STARTED |

## Screenshot dirs

- before: `/tmp/ui-product-finish/before/` (baseline captured)
- after: `/tmp/ui-product-finish/after/`
- crops: `/tmp/ui-product-finish/crops/`
- probes: `/tmp/ui-product-finish/probes/`

## Test status

- `pnpm --filter web typecheck`: PASS (clean baseline)
- `pnpm --filter web build`: PASS (no errors)

## Commits

(pending — visual language refinement: palette + wrong-answer neutralizing + icon refinement)

## Hard blockers

(none)

## Next exact action

After committing the visual language refinement slice, resume the full-product route/viewport/state matrix from Wave 1 (golden admin pages across 420/768/1024/1280/1440/1920), then Wave 2+ (all admin lists, forms, detail/workflow, candidate experience, state coverage, responsive, rendering clarity, accessibility, consistency sweep, final adversarial review).

## Visual language refinement (in-progress slice)

User feedback (3 concrete defects) + Koi-UI palette research → token-level visual language refinement:
- **Palette**: `index.css` `:root` rebuilt — canvas `#eef1f6` (deeper, cards visibly float), text/border aligned to DESIGN.md (drift eliminated), semantic colors perceptually-uniform at mid-high lightness (success `#12936a`, warning `#c4770a`, danger `#dc2f45`, info `#0e6dd9`), sidebar lightness ascending fixed, DESIGN.md synced.
- **Wrong-answer marking**: AttemptDetailPage answer badge `destructive`→`secondary`+× icon (correct→`success`); ResultPage wrong `CircleX` `text-destructive`→`text-muted-foreground` (neutral grey). Real error feedback (FieldError/alerts/aria-invalid) preserved.
- **Delete icon**: AppIcon inline/badge stroke `2`→`1.5` (stroke-width attr 3→2.25, crisp at 16px); 2 raw Lucide renders (QuestionForm Trash2, RuntimeActionBar Flag) → AppIcon.
- **Verification**: web test 1058 pass, typecheck/lint/lint:copy/lint:arch/format clean, build OK. After-screenshots confirm card-layer separation visible + wrong answers calm/neutral. Dev `exam` DB untouched.

Koi-UI reference (https://github.com/leepandar/koi-ui, https://github.com/KoiKite/koi-ui) studied for palette wisdom: HSL space, mid-high lightness semantic colors, ascending dark sidebar. Used as design input only — no code/token copied, no runtime dependency added (LAN/offline constraint preserved).
