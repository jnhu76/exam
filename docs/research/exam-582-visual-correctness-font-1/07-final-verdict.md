# 07 — Final Verdict

```text
EXAM-582-VISUAL-CORRECTNESS-FONT-1

BASE_SHA:  3f5bd9c4c757daec2554de98ed06e4d4e2784c8b (origin/master)
HEAD_SHA:  3f5bd9c4c757daec2554de98ed06e4d4e2784c8b + additive audit-only files
BRANCH:    research/582-visual-correctness-font-1

ENVIRONMENT:
browser:      Chromium (Playwright 1.61.0, chromium revision 1228)
viewport matrix: 1440x900 / 1100x800 / 1023x800 (+700x800 overflow probe)
DPR:          1
zoom:         100%
OS:           Linux 6.18.33.2-microsoft-standard-WSL2 x64
theme:        light (reduced motion)

SURFACES AUDITED:
/admin/dashboard, /admin/exams, /admin/questions, /admin/users (+assignment
dialog), /admin/settings, /admin/audit-logs, /exam/list,
/exam/:attemptId/take — 30 captures, 24 screenshots-verified slices.

TABLE AUDIT: 20 governed table instances audited.
- /admin/exams            1440/1100/1023/700  PASS
- /admin/questions        1440/1100/1023/700  PASS
- /admin/dashboard        1440/1100/1023      PASS
- /admin/users            1440/1100           MINOR_VISUAL_DEFECT (role pill crosses column border, DOM-probed +6.5px)
- /admin/users            1023                PASS (clean below-lg card switch)
- /admin/audit-logs       1440/1100/1023      MINOR_VISUAL_DEFECT (action pill crosses column border, DOM-probed +16.5px, 0–1px to text at 1100)
- /admin/audit-logs       700                 PASS (far-right reachable)
No MAJOR_VISUAL_DEFECT; no TABLE_COVERAGE_GAP.

SCROLL AUDIT: SCROLL_PASS — 30/30 captures.
Vertical window scroll + sticky admin topbar verified everywhere; horizontal
scroll region ownership correct; machinery proven where it engages (700x800
overflow probe: scrollLeft full-range, data-scroll-end, last cell reachable);
document-level horizontal overflow false in 30/30.

FONT TRUTH: HARMONY_CONFIRMED for the runtime (weights 400/500 actually in use).
- Single computed stack everywhere, no local override on any probed element.
- Cache-free network probe: HarmonyOS CSS 200 x3, woff2 200 x8, loaded faces
  @400 x5 + @500 x3.
- Latin render differential distinct from fallback in 30/30 captures.
- Bold(700) correctly dormant (no 700 text exists in audited surfaces).
- Honest UNKNOWN: per-glyph CJK identity (advance-width non-discriminative);
  static matching argument + visual review support HarmonyOS.

GLOBAL FINDINGS:
- Confirmed visual defects: 2 (one class — page-local pill renderings painting
  across fixed-layout column borders: UsersPage role Badge, AuditLogPage
  action span; MINOR, reproducible, data-width-driven).
- Confirmed scroll defects: none.
- Confirmed font-truth defects: none.
- Unknowns: CJK glyph-level metrics proof; real-wheel ergonomics (Browser Use
  backend unavailable — SKIPPED); hover/popover open states not captured.

FOLLOW-UP CANDIDATES:
- Issue needed: yes — one bounded issue, two instances (wide CJK pills in
  governed tables cross column borders; route page-local pills through the
  governed badge recipes / reserve or truncate under fixed layout). Detail
  in 05-findings.md. Not fixed in this evidence branch.

READY STATE FOR #582 A/B ADJUDICATION:
READY

FINAL VERDICT:
READY_FOR_HUMAN_VISUAL_REVIEW
```

Decision rule applied (task §12): table evidence is visually valid (two bounded MINOR defects do not invalidate single-variable A/B comparisons — identical geometry renders in both variants), scroll behavior is correct, and runtime font truth is confirmed rather than assumed. Phase 2 (D2–D7 controlled A/B + multimodal adjudication) may proceed on this baseline. Nothing here freezes any D2–D7 value.
