# 04 — Structural Effects

Layout/overflow consequences of moving the D2 tier, measured per arm (raw: `artifacts/D2/structural.json`). These are facts for the adjudicator, not aesthetics.

## Document & table overflow (B11)

- Document horizontal overflow: **false in 10/10 measured surface×variant×viewport records** (1440 and 1100).
- Governed table scroll regions: `data-overflowing=false` wherever the attribute is present; `data-scroll-end=true`; last body cell reachable in every record. The questions-shell rows record `overflowing=null` (attribute absent — no overflow state to report at these widths), consistent with Phase-1's tier negotiation (standard tier ≥ content width).
- No cell clipping, no action-cell collision, no scroll-region engagement appeared in either arm at either audited viewport.

## Row heights (B11)

First five body rows of every governed table: **48px in every record, both arms, both viewports.** Table cell line-height is a fixed rem value (22px), so the +1px glyph size is absorbed by existing cell padding — **no row-height explosion, no density regime change in the tables.**

## Known pill defects (B10)

Phase-1's two MINOR defects (UsersPage role pill +6.5px overflow at 1440/1100; AuditLogPage action pill +16.5px at 1440/1100, 0–1px from adjacent text) were re-measured under both arms:

- Measured deltas between arms: **0.0px everywhere** (all four page×viewport probes).
- Explanation: both pills render **12px `text-xs` metadata text** — outside the D2 body/control tier — and their column geometry is fixed by `table-layout: fixed`. D2 does not move them.
- Conclusion for adjudication: the pill defects are **not** D2 evidence and neither arm makes them materially worse; they remain the separate bounded follow-up issue proposed in Phase-1 (`05-findings.md` of `exam-582-visual-correctness-font-1`).

## Text-driven geometry propagation (expected, recorded)

Control heights `h-9` (inputs/buttons) are identical across arms. Text-driven containers (labels, running-text blocks) change height with their line-height (15↔14px fonts): labels ~+1px, `text-sm` text blocks ~+1.5px line-height (22.5 vs 21). Sidebar/nav and table rows are height-stable. Dialog and runtime surfaces show no layout side effects beyond these text boxes.

## New defects

None observed: no new overflow, no clipped text, no collision introduced by either arm at either audited viewport.

**STRUCTURAL SAFETY = PASS**
