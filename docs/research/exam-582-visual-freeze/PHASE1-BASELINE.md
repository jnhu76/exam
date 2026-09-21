# EXAM #582 — Phase-1 Baseline (pre-A/B findings that still matter)

Phase-1 (`EXAM-582-VISUAL-CORRECTNESS-FONT-1`, merged via PR #588) was the prerequisite audit that qualified the product for the D2–D7 controlled A/B campaign. Its verdict was `READY_FOR_HUMAN_VISUAL_REVIEW`. This file preserves the Phase-1 conclusions that remain load-bearing; the full report set and the 5.8 MB screenshot forest live only in the raw evidence archive (`research/exam-582-visual-correctness-font-1/`, asset `exam-582-visual-research-evidence-v1.tar.gz`).

## Font truth — still the production authority

```text
HarmonyOS Sans SC = confirmed production font truth
```

- Runtime-confirmed (not assumed) for the weights actually in use: 400/500.
- Single computed font stack everywhere; no local override on any probed element.
- Cache-free network probe: HarmonyOS CSS 200 ×3, woff2 200 ×8, loaded faces @400 ×5 + @500 ×3.
- Latin render differential distinct from fallback in 30/30 captures; Bold(700) correctly dormant (no 700 text on audited surfaces).
- Honest UNKNOWN retained: per-glyph CJK identity (advance-width non-discriminative); static matching argument + visual review support HarmonyOS.

## Table / scroll audit — generally valid

- 20 governed table instances audited across `/admin/exams`, `/admin/questions`, `/admin/dashboard`, `/admin/users`, `/admin/audit-logs` at 1440/1100/1023/700 — no `MAJOR_VISUAL_DEFECT`, no `TABLE_COVERAGE_GAP`.
- Scroll audit `SCROLL_PASS` 30/30: vertical window scroll + sticky admin topbar verified; horizontal scroll-region ownership correct; document-level horizontal overflow false in 30/30.
- The two found defects (below) were bounded `MINOR_VISUAL_DEFECT`s that did **not** invalidate single-variable A/B comparison, because identical geometry renders in both arms — this is what allowed the campaign to proceed.

## Known cell-fitting defects — separated into #590

- Two instances of one defect class: page-local pill renderings painting across fixed-layout column borders (UsersPage role Badge `+6.5px`, AuditLogPage action span `+16.5px`, DOM-probed).
- Tracked as [issue #590](https://github.com/jnhu76/exam/issues/590) — **separate from #582**, not D5/D6 evidence, and explicitly not authorized by any D2–D7 freeze.
- Sequencing law: #590 is fixed **after** the frozen visual implementation lands (D2 14→15 raises text-width pressure; D6 400→500 may slightly change glyph width).

## Role in the campaign

Phase-1 evidence established the baseline that enabled D2–D7: table evidence visually valid, scroll behavior correct, runtime font truth confirmed. Every D2–D7 run then gated on that font truth (per-run font gates forcing HarmonyOS Sans SC subsets at the audited weights).

## Provenance

```text
branch:                    research/582-visual-correctness-font-1 (merged via PR #588)
product under test SHA:    3f5bd9c4c757daec2554de98ed06e4d4e2784c8b
evidence head SHA:         90367652cd47d9c7be5aa1e441950f52e73dc324
raw archive path:          research/exam-582-visual-correctness-font-1/
```
