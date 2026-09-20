# 05 — Findings

## Confirmed visual defects (2, one class, MINOR)

**F-1 · UsersPage role pill overflows its cell** — `/admin/users`, 1440 + 1100 (desktop table band).
The 角色 column renders `<Badge variant="outline">` (shadcn `badge`, not the governed TagBadge). For the admin row's `考试管理员` (5 CJK chars) the pill paints across the 角色|状态 column border into the 状态 cell.
- DOM probe (1440): pill right 1181.0 vs cell right 1174.5 → **overflow 6.5px**; gap to the 已启用 badge −6.5px.
- Judge pixel measurement (1100): pill x675–753 vs border x746.
- Evidence: `artifacts/screenshots/S4-users--1440x900.png`, `S4-users--1100x800.png`, crops `S4-users--*-table0-far-right.png`, `artifacts/badge-overflow-dom-probe.json`.
- Reproducible: every run. Cause: data width (long CJK role label) × fixed table layout × unowned page-local badge; not scroll-related.

**F-2 · AuditLog action pill overflows its cell** — `/admin/audit-logs`, 1440 + 1100 + 1023 (desktop table; log-diagnostic keeps the table below lg).
The 操作 column renders a hand-rolled `span.bg-primary-soft` pill. For `分配课程教师` (6 CJK chars) the pill crosses the 操作|对象 border and, at 1100/1023, reaches **0–1px from the adjacent cell's text** (`course`) — one pixel class from a text collision.
- DOM probe (1440): pill right 1215.0 vs cell right 1198.5 → **overflow 16.5px**; adjacent cell text `course`, gap −16.5px.
- Judge pixel measurements: 1100 → badge bg ends x786, `course` starts x787; 1023 → bg x708–798, border x~781, text x799.
- Evidence: `artifacts/screenshots/S8-audit-logs--{1440,1100,1023}x*.png` + far-right crops, `artifacts/badge-overflow-dom-probe.json`.
- Reproducible: every run (backend action label is deterministic). Cause: same class as F-1.

Both defects pre-date this audit (no authority repair in #579 covered page-local pill renderings) and are visible in the screenshots a human will use for D2–D7 A/B review — but they do not invalidate those comparisons (single-variable judgments are unaffected; the pills render at identical geometry in both A/B variants).

## Confirmed scroll defects

None. 30/30 captures clean (see 03-scroll-audit.md).

## Confirmed font-truth defects

None. HarmonyOS Sans SC confirmed in the runtime for the weights actually used (400/500); Bold correctly dormant (see 04-font-truth.md).

## Harness defects found and fixed inside the audit harness (not product)

- Take route param: `/exam/:attemptId/take` is keyed by attempt id; the harness first used the exam id and captured the runtime's load-failure card. Fixed; re-captured; runtime slice judged PASS ×9.
- Below-lg S7 flow: at 1023 the users page shows the mobile card representation; the dialog opener was re-targeted to the visible representation. Fixed.
- Font response route attribution: woff2 responses now tagged before navigation fires; cache-free network probe added for authoritative load evidence.

## Unknowns (honest)

- Glyph-level CJK font identity cannot be proven by advance-width (1em in all CJK fonts). Static argument (loaded subsets + first-in-stack matching) + visual review support HarmonyOS; a glyph-metrics proof was out of scope.
- Real-wheel scroll ergonomics unproven (no interactive browser backend); programmatic + geometry proof only.
- Visual states not captured: hover, focus ring rendering on real keyboard input (keyboard focus probe exists in the standing multimodal patrol, not re-run here), popover/select open states outside the dialog, error/toast styling.

## Follow-up candidates (issue needed? YES, one bounded issue)

**Issue needed: yes.** Bounded defect: "Wide CJK pills in governed tables paint across column borders — UsersPage 角色 column `<Badge variant="outline">` and AuditLogPage 操作 column hand-rolled `span.bg-primary-soft`; `table-layout: fixed` cells don't reserve pill width; overflow up to 16.5px / 0px-gap-to-text at 1100px." Bounded fix directions (for the implementation issue to decide, NOT fixed here): route both cells through the governed TagBadge/StatusBadge recipes (single ownership), and/or add min-width reservation or truncation for long CJK pill labels under fixed layout. Both defects are one class; one issue, two instances. Suggested verification: extend the DOM probe (`apps/e2e/scripts/probe-badge-overflow-582.mjs`) into a permanent Playwright gate per the patrol graduation rule (#494 §46).
