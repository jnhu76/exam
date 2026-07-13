# UI-SYSTEM-ROOT-CORRECTIVE-1 — CLOSEOUT

## A. Final verdict

**IMPLEMENTATION AND ADVERSARIAL CLOSURE PASS; READY FOR HUMAN VISUAL ACCEPTANCE.**

One project-owned admin clarity system now governs tokens, typography, primitives, page widths, toolbars, management tables, metrics, statuses and icons. No open P0/P1 remains.

## B. Branch and HEAD

Branch: `feat/ui-visual-fixes`  
Start HEAD: `ac8bce93677c4cbc353cd4bf3e0bafce9696a816`  
Closeout base HEAD: `d759125`  
Final HEAD: the `docs(ui): close UI system root corrective` commit containing this document; the full SHA is recorded by the final repository check and handoff.

## C. Commit chain

1. `792754c docs(ui): record UI root audit and pinned references`
2. `efcb891 feat(ui): rebuild visual tokens and primitive hierarchy`
3. `3e0197c refactor(ui): establish authoritative admin page and table system`
4. `f51d484 refactor(ui): implement golden admin list and dashboard`
5. `7494502 refactor(ui): migrate full admin frontend to shared UI authority`
6. `e279b34 refactor(ui): align auth surface with shared authority`
7. `d759125 fix(ui): resolve UI root review findings`
8. `docs(ui): close UI system root corrective` (this document)

## D. Prior-change matrix

| Change | Decision |
| --- | --- |
| AppIcon project entry point | KEEP |
| Lucide whole-pixel role sizing | KEEP / REWORK |
| Ordinary-status icon reduction | KEEP |
| Cool-neutral palette intent | REWORK |
| White-canvas/grey-card inversion | REVERT |
| Transparent default Button | REVERT |
| Removed table-header fill / increased cell padding | REVERT |
| 20px rounded-full statuses | REVERT |
| Page-local equivalent list shells | REPLACE THROUGH SHARED OWNER |
| Premature pivot review/preview artifacts | REVERT |

## E. References

- Koi UI `master` at `ef1ce4a46c017eb58808f11f7816fbdb8de90d61`.
- Wegent `main` at `1a5e21c5c71ac92a2be2dbe7f14398902e04eb98`.
- Source-path mapping: `UI-SYSTEM-ROOT-REFERENCE-MAP-1.md`.
- Reference repositories remain under `/tmp` and are not committed or required at runtime.

## F. Root causes

The pivot changed tokens and generated primitives before completing shared ownership and full-page migration. That inverted layer brightness, removed default action hierarchy, weakened tables, created status pills and amplified pre-existing page drift. Pages then composed the same semantics through different local structures.

## G. Final token authority

Canvas `#f5f7fa`; surface `#ffffff`; subtle `#f8fafc`; hover `#f1f5f9`; text `#111827`; secondary `#374151`; muted `#627287`; subtle text `#94a3b8`; border `#dfe3e8`; strong border `#cbd5e1`; primary `#2563eb`; hover `#1d4ed8`; active `#1e40af`; primary soft `#eff6ff`; sidebar `#17191d`; sidebar interaction `#24272d`.

## H. Typography and 100% clarity

Noto Sans CJK SC remains locally hosted and centrally owned. Metric is fixed at 28/34. Runtime at zoom 100% / DPR 1 shows sharp text; measured primary and muted contrast pass AA on their governed surfaces. No page-local font stack, fractional font size or typography conflict was added.

## I. Icon source

Lucide remains the source. `AppIcon` remains the only product entry point. Role sizes are integer 16/20/24/32/40px with 2px absolute stroke; no CSS scale or fractional transform is used. Unscaled DPR 1 crops did not justify a library migration.

## J–O. Shared contracts

- Primitives: solid default Button; bordered white fields/cards; local-overflow dense tables; rectangular soft badges.
- Page container: 1280px standard, 1536px wide, 896px form, 448px auth, 1280px runtime.
- Toolbar: `DataToolbar`/`ListToolbar` own grouped search, filters, count and secondary actions; empty/count-only strips are forbidden.
- Table: `DataTableShell` owns equivalent management lists; 44px subtle header, 48px rows, visible outer/separator borders and `RowActions`.
- Status: `statusMeta` + `StatusBadge`, including centralized active/inactive account status.
- Statistics: `StatsCard` owns white surface, 32px icon anchor, muted label and 28px metric.

## P. Golden pages

Dashboard and UsersPage pass at 420, 1024, 1280, 1440 and 1920. Dashboard metrics and recent exams share clear hierarchy. UsersPage reproduces and resolves the sparse 1920 failure with a centered 1280px container and structured table shell.

## Q. Full-product migration

Equivalent list tables migrated: Dashboard recent exams, users, candidates, courses, questions, exams, results overview, score list, grading queue, audit logs, import logs and candidate fields. Score KPIs migrated to StatsCard. Auth uses the auth PageContainer. Create/edit/settings routes receive the form role. Candidate list/result/runtime retain task-specific semantics while sharing the corrected tokens and primitives. Embedded workflow/detail/dialog tables remain documented exceptions and share the Table primitive.

## R. Tests, coverage and build

- `pnpm verify`: PASS.
- Web: 88 files, 1018 tests passed.
- Web coverage: 77.94% statements, 71.48% branches, 71.71% functions, 80% lines.
- New structural tests: PageContainer role widths; Card clean surface; Button hierarchy/action targets; StatusBadge geometry; StatsCard hierarchy; DataTableShell header/surface ownership; migrated page-shell contracts.
- Production web build: PASS, 2983 modules transformed.
- Known pre-existing test stderr: React `act(...)` warnings in TakeExam/GradingDetail coverage paths; they did not fail verification and are unrelated to this visual corrective.

## S. Before/after screenshot matrix

Stable before evidence:

- `/tmp/ui-system-root/before/dashboard-420.png`
- `/tmp/ui-system-root/before/users-1920.png`
- `/tmp/ui-system-root/before/login-1440.png`

Final admin evidence:

- `/tmp/ui-system-root/after/dashboard-{420,1024,1280,1440,1920}.png`
- `/tmp/ui-system-root/after/users-{420,1024,1280,1440,1920}.png`
- `/tmp/ui-system-root/after/{exams,questions,system}-{1024,1280,1440,1920}.png`
- `/tmp/ui-system-root/after/login-{420,1024,1440}.png`

Candidate evidence:

- `/tmp/ui-system-root/after/candidate-{list,result,runtime-locked}-{420,1440}.png`

## T. DSF=1 crops

- `/tmp/ui-system-root/crops/dashboard-stats-1440-dpr1.png`
- `/tmp/ui-system-root/crops/dashboard-table-shell-1440-dpr1.png`
- `/tmp/ui-system-root/crops/users-table-shell-1440-dpr1.png`
- `/tmp/ui-system-root/crops/{dashboard,users,system}-page-title-1440-dpr1.png`
- `/tmp/ui-system-root/crops/system-system-card-1440-dpr1.png`

DPR comparison: `/tmp/ui-system-root/after/users-dpr-{1,1.25,2}.png`.

## U. Review and corrections

The adversarial review corrected two findings discovered after initial implementation: real rows were 53–57px instead of the 48px contract, and baseline muted text was 4.43:1 on the canvas. The Table primitive now renders measured 48px rows, and muted ink is `#627287` at 4.58:1. The final authenticated admin and candidate passes have zero console errors, failed responses and page errors.

## V. Remaining P2/P3

See `UI-SYSTEM-ROOT-CORRECTIVE-1-REVIEW.md`: localized fractional flexible-column positions without visible blur; non-Chromium rasterization; active runtime screenshot may be repeated on disposable `exam_e2e` data.

## W. Human acceptance boundary

Human acceptance should compare the exact stable before images against the final dashboard, users, questions, system, login, candidate list/result and DPR 1 crops above without reading this report first. Acceptance asks whether the product immediately looks brighter, clearer, sharper, more structured, more consistent and recognizably enterprise-admin.

No API, backend, database schema, repository, business command or runtime dependency changed. No dev data was reset or reseeded.
