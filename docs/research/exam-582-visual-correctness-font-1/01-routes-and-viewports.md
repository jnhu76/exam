# 01 — Routes and Viewports

All captures come from `patrol/ui-visual-correctness-582.spec.ts` (5 tests, all passing) in run
`.tmp/ui-patrol/visual-correctness/3f5bd9c4-1789863570806/` (retained copy under `artifacts/` in this directory).

## Surface × viewport matrix (30 captures)

| Surface | Route | 1440×900 | 1100×800 | 1023×800 | 700×800 |
| --- | --- | --- | --- | --- | --- |
| S1 Dashboard | `/admin/dashboard` | ✓ | ✓ | ✓ | — |
| S2 Exam list | `/admin/exams` | ✓ | ✓ | ✓ | ✓ (below-lg card representation) |
| S3 Question management | `/admin/questions` | ✓ | ✓ | ✓ | ✓ (below-lg card representation) |
| S4 Users / assignment admin | `/admin/users` | ✓ | ✓ | ✓ | — |
| S5 Settings form | `/admin/settings` | ✓ | ✓ | ✓ | — |
| S6 Candidate exam list | `/exam/list` | ✓ | ✓ | ✓ | — |
| S6 Candidate runtime | `/exam/:attemptId/take` | ✓ | ✓ | ✓ | — |
| S7 Assignment dialog (form controls) | `/admin/users` + dialog open | ✓ | ✓ | ✓ | — |
| S8 Audit log (log-diagnostic table) | `/admin/audit-logs` | ✓ | ✓ | ✓ | ✓ (forced horizontal overflow) |

Per capture: full-viewport screenshot (`artifacts/screenshots/<surface>--<vp>.png`), page-bottom screenshot when the page scrolls vertically (`--page-bottom.png`), far-right table crop when a governed table exists (`artifacts/crops/<surface>--<vp>--table0-far-right.png`), dialog crop for S7 (`--crop.png`), plus machine evidence JSON (computed styles, font truth, scroll facts).

## Route correction recorded during the audit

The candidate take route is keyed by **attempt id** (`App.tsx`: `path=":attemptId/take"`), not exam id. The first harness draft navigated to `/exam/<examId>/take` and captured the load-failure card ("无法加载答题记录，请检查连接后重试"); this was a harness defect, fixed before adjudication. The corrected captures show the real runtime (question stem, options, timer, save/submit).

## Governance invariants respected

- No production visual value changed; no D2–D7 token/recipe touched; no font change shipped.
- The only repo-tree additions: the patrol spec (evidence collector), the confirmatory DOM probe, and this research directory.
