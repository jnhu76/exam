# UI-SYSTEM-ROOT-CORRECTIVE-1 — ADVERSARIAL REVIEW

Review basis: final rendered runtime after implementation, not the implementation narrative  
Review date: 2026-07-13  
Verdict: **PASS — no open P0 or P1 findings**

## Evidence set

- Admin screenshots: `/tmp/ui-system-root/after/{dashboard,users,exams,questions,system}-{420,1024,1280,1440,1920}.png` where applicable.
- Candidate screenshots: `/tmp/ui-system-root/after/candidate-{list,result,runtime-locked}-{420,1440}.png`.
- DPR screenshots: `/tmp/ui-system-root/after/users-dpr-{1,1.25,2}.png`.
- Unscaled crops: `/tmp/ui-system-root/crops/*-1440-dpr1.png`.
- Measurements: `/tmp/ui-system-root/after/browser-audit.json`, `candidate-browser-audit.json`, `dsf-audit.json`.

## P0 review

No data loss, security regression, navigation failure, inaccessible primary workflow, or business-behavior change was found. No P0 was opened.

## P1 review and corrective iterations

| Finding | Evidence | Correction | Final signal |
| --- | --- | --- | --- |
| Canvas/surface inversion | Pivot used white canvas under grey cards. | Restored `#f5f7fa` canvas and white surfaces through tokens/primitives. | Runtime computed colors are `rgb(245,247,250)` and `rgb(255,255,255)`. |
| Default action looked secondary | Default Button was transparent/bordered. | Default and primary now own the same solid blue contract. | New-user/create/import actions are visibly primary. |
| Equivalent tables diverged | Users, results, logs and queue had naked/card-local tables. | Migrated list semantics to `DataTableShell` + Table + RowActions. | Every equivalent management table has the same border/header/row geometry. |
| Header blended into rows | Table header fill was removed. | `thead` owns `surface-subtle`. | Computed header background is `rgb(248,250,252)`. |
| Count-only toolbar | Exam count occupied a disconnected strip. | Count moved to the table-shell header; empty toolbar removed. | No count-only toolbar in ExamPage test/runtime. |
| Sparse 1920px user page stretched | One row consumed unconstrained width. | `PageContainer` standard role caps at 1280px. | 1920px measurement: page/table 1280px, centered. |
| Statuses looked like consumer pills | 20px/full-round treatment. | 24px rectangular soft StatusBadge. | Runtime badge: 52×24, `rounded-md`; structural test rejects `rounded-full`. |
| Row density exceeded contract | Initial corrective still rendered 53–57px rows due cell padding. | Removed vertical cell padding in Table primitive while preserving 48px cell height. | All measured representative rows are exactly 48px; headers 44px. |
| Muted canvas text missed AA | `#64748b` on canvas measured 4.43:1. | Adjusted muted ink to `#627287`. | 4.58:1 on canvas and 4.92:1 on white. |

## Required failure checklist

| Gate | Result |
| --- | --- |
| Canvas/surface distinguishable | PASS |
| Business cards clean white | PASS |
| Equivalent table borders consistent | PASS |
| No bare equivalent management table | PASS |
| Table headers distinct | PASS |
| Default Button primary | PASS |
| One clear page action where applicable | PASS |
| Exam empty count strip absent | PASS |
| Toolbars connected | PASS |
| Sparse 1920 page constrained | PASS |
| Statuses rectangular and clear | PASS |
| Small icons sharp at zoom 100% / DPR 1 | PASS in unscaled crops |
| Chinese text sharp at zoom 100% / DPR 1 | PASS with local Noto Sans CJK SC |
| No broad fractional-transform drift | PASS; no icon transforms/scaled wrappers |
| No copied reference implementation | PASS |
| No parallel UI authority | PASS |
| Mobile/responsive shell | PASS at 420/1024/1440/1920 |
| Business behavior unchanged | PASS |
| Before/after materially different | PASS |

## Runtime measurements

At 1440px, the full sidebar leaves a 1144px standard content region; at 1920px the standard region caps at 1280px and diagnostics caps at 1536px. Representative tables match their container width. Headers are 44px, rows 48px, ordinary controls/actions 36px, and mobile PageHeader actions receive a 44px minimum. No measured page has document-level horizontal overflow. All visible buttons have accessible names and all measured direct actions remain reachable.

Final authenticated admin pass: 0 console errors, 0 failed responses, 0 page errors. Candidate pass: 0 console errors, 0 failed responses, 0 page errors. The initial unauthenticated `/api/auth/me` 401 and a development global-rate-limit 429 were excluded by rerunning the authenticated page matrix after the limiter window; neither reproduced in the final evidence.

Focus traversal produced a visible 3px focus ring on the sidebar collapse button at DPR 1, 1.25, and 2. DPR changes did not change CSS geometry or introduce overflow.

## Remaining P2/P3

- P2: flexible table columns can place an SVG container at a fractional x/y coordinate even though icon width/height and stroke authority are integer and no transform is applied. Unscaled DPR 1 crops show no visible jaggedness, so no layout-distorting pixel snap was introduced.
- P2: Chromium was the runtime authority. Non-Chromium font rasterization remains a human/browser-matrix acceptance item.
- P2: the candidate runtime screenshot uses a real graded/locked attempt to avoid mutating dev data. Active attempt behavior remains covered by the existing runtime tests; active-state visual acceptance may be repeated against the disposable `exam_e2e` database.

These are not P0/P1 and do not create a second visual system.
