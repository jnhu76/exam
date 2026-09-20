# 03 — Scroll Audit

Source: `artifacts/scroll-audit.json` (per-capture facts) + `artifacts/scroll-audit` figures below. Scroll ownership facts come from the patrol's `collectShellFacts` (single implementation shared with the standing patrol harness).

## Ownership model (verified in DOM)

- **Vertical page scroll**: window-owned on admin pages (`main` has no own overflow container). Sticky topbar (`header.sticky.top-0.z-40`, h-14).
- **Horizontal table scroll**: each `[data-slot="admin-table-shell"]` owns a local `[data-slot="table-scroll-region"]` (`overflow-x: auto`, `data-overflow-owner="local"`), with edge fades + a scroll-hint row that appear only while overflowing.
- **Candidate runtime**: page scrolls in window; exam header intentionally NOT sticky (`ExamLayout` header is a plain `flex h-14` — by design, not a regression).

## Results — 30/30 captures, 0 scroll defects

### Vertical page scroll — PASS everywhere

- Every page with `scrollHeight > clientHeight` was programmatically scrolled to the bottom: `scrollY > 0` after scroll in all 21 scrollable captures; page-bottom screenshots captured.
- Admin sticky topbar: after full scroll, topbar `y = 0` in every admin-layout capture (verified per capture); page-bottom screenshots show pagination/footer/submit controls not permanently covered.
- Candidate take page bottom: save/submit controls reachable at all three widths (visual-judge confirmed).

### Horizontal table scroll — machinery PASS (exercised where it engages)

- At 1440/1100/1023: **no governed table overflowed** (`scrollWidth ≤ clientWidth + 1` on all 27 desktop-band instances) — tier negotiation (compact 720 / standard 980 min-widths) keeps every table inside its container at these widths. Document-level horizontal overflow: `false` in 30/30 captures.
- 700×800 probe (below `lg`, where log-diagnostic keeps a desktop table): S8 audit-logs overflow engaged — `scrollWidth 720 / clientWidth 666`. Programmatic test: `scrollLeft 0 → 54` (full range), `data-scroll-end` flipped to `"true"`, **last body cell reachable inside the visible region** (`lastCellReachable: true`), far-right crop shows rightmost columns fully rendered. Fades/hint attributes behaved per state (`data-scroll-start`/`data-scroll-end`).
- Management-list surfaces at 700×800 switch to the mobile card representation (CSS `lg:` switch) — no horizontal scroll region exists there by design; cards render without overflow (visual-judge PASS).

### Nested scroll

Only one nested-scroll relationship exists in the audited matrix: window (vertical) × table scroll region (horizontal) on audit-logs at <lg. The scroll region is the horizontal owner; the window is the vertical owner; they are disjoint axes, so wheel/trackpad axis selection is structurally unambiguous. Wheel ergonomics itself was NOT exercised by real wheel input (no browser backend for interactive sessions) — programmatic `scrollLeft` + geometry proof only, as the task contract permits.

## Verdict

| Route set | Viewport | Verdict |
| --- | --- | --- |
| All surfaces | 1440 / 1100 / 1023 | SCROLL_PASS (no overflow present; vertical scroll + sticky topbar verified) |
| /admin/audit-logs | 700 | SCROLL_PASS (overflow engaged; far-right reachable; container correct) |
| /admin/exams, /admin/questions | 700 | SCROLL_PASS (mobile card representation; no dead scroll region) |

No dead scroll regions, no phantom hidden columns, no clipped last columns, no clipped action buttons were found in any capture.
