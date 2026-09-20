# 02 — Table Visual Audit

Method: every capture carries deterministic DOM facts (`collectShellFacts` + per-table geometry from the patrol), full and cropped screenshots; three independent multimodal visual-judge passes reviewed the rendered PNGs (25 + 18 + 9 files across the passes), and both flagged findings were then re-confirmed by a deterministic DOM probe (`apps/e2e/scripts/probe-badge-overflow-582.mjs`, output `artifacts/badge-overflow-dom-probe.json`).

## Table inventory (final run)

20 governed table instances across the capture matrix (archetype/tier per `data-table-*`):

| Surface | Archetype / tiers rendered | Body rows |
| --- | --- | --- |
| S1 Dashboard | management-list (standard @1440, compact below) | 9 |
| S2 Exams | management-list (standard @1440, compact @1100/1023, compact @700 hidden→cards) | 9 |
| S3 Questions | management-list (standard @1440, compact @1100/1023, compact @700 hidden→cards) | 20 |
| S4 Users | management-list (standard @1440, compact below) | 6 |
| S8 Audit log | log-diagnostic (standard @1440/1023, compact @1100, compact+overflow @700) | 20 |
| S7 (behind dialog) | management-list | 6 |

S6 exam list renders candidate cards (no governed table); S5 settings is a form page. No TABLE_COVERAGE_GAP occurred: every declared table surface rendered rows under the seed.

## Per-table verdicts

| Route | Viewport | Verdict | Findings |
| --- | --- | --- | --- |
| /admin/exams | 1440 / 1100 / 1023 / 700 | PASS | header/body columns aligned; type/status pills inside cells; action cells clean; pagination intact |
| /admin/questions | 1440 / 1100 / 1023 / 700 | PASS | 20 rows with type tags + status badges; no tag overflow; action cells clean; page-bottom reachable |
| /admin/dashboard | 1440 / 1100 / 1023 | PASS | management-list table clean at standard + compact tiers |
| /admin/users | 1440 | **MINOR_VISUAL_DEFECT** | role pill `考试管理员` (shadcn `Badge variant="outline"`) crosses the 角色\|状态 column border into the 状态 cell — DOM probe: pill right 1181 vs cell right 1174.5 → **+6.5px overflow**, gap to 已启用 badge −6.5px |
| /admin/users | 1100 | **MINOR_VISUAL_DEFECT** | same defect (pill x675–753 vs border x746; judge pixel measurement) |
| /admin/users | 1023 | PASS | below-lg mobile card representation renders cleanly (no desktop table shown) |
| /admin/audit-logs | 1440 | **MINOR_VISUAL_DEFECT** | action pill `分配课程教师` (hand-rolled `span.bg-primary-soft`) crosses the 操作\|对象 border — DOM probe: pill right 1215 vs cell right 1198.5 → **+16.5px overflow**, adjacent cell text `course`, gap −16.5px |
| /admin/audit-logs | 1100 | **MINOR_VISUAL_DEFECT** | same defect; judge pixel measurement: badge glyphs x710–777 cross border x770; background ends x786, `course` starts x787 (0px gap) |
| /admin/audit-logs | 1023 | **MINOR_VISUAL_DEFECT** | same defect persists on the desktop table kept below lg (badge bg x708–798 crosses dashed border x~781; `course` at x799, ~0–1px gap); no horizontal clipping otherwise |
| /admin/audit-logs | 700 | PASS | overflowing table scrolled to far right: rightmost columns fully visible, no clipped content (crop `S8-audit-logs--700x800--table0-far-right.png`) |

Checks that passed on every table: header/body column alignment; no cell-content overlap; no action-cell collision; no mid-glyph clipping; no unexpected row-height explosion (equal-class rows render equal heights); pagination/footer intact; sticky detail-comparison first column n/a (no detail-comparison table rendered under this seed); content stays inside containers except the two overflow findings above.

## Root cause (both defects, one class)

Both overflowing pills are **page-local badge renderings, not the governed TagBadge recipe**:

- UsersPage 角色 column: `<Badge variant="outline">` (`apps/web/src/components/ui/badge.tsx`).
- AuditLogPage 操作 column: inline `span.inline-flex ... bg-primary-soft px-2 py-0.5 text-xs font-medium` (`apps/web/src/pages/admin/AuditLogPage.tsx`).

With `table-layout: fixed` + fixed column min-widths, a 5–6 character CJK pill wider than the reserved cell box neither wraps nor truncates — it paints across the column border into the adjacent cell. Severity: MINOR (border-crossing overlap; no text-on-text collision at 1440, but the 1100 audit-logs case reaches 0px gap to the adjacent cell's text, one pixel class away from a collision). Reproducible on every run; caused by data width (long CJK action/role labels), not by scroll behavior.

Not fixed in this evidence branch — recorded as a follow-up candidate (see 05-findings.md).
