# UI-RESPONSIVE-SHELL-CORRECTIVE-1-REVIEW

> Independent adversarial review of the responsive-shell fix.
> Commits under review: `f533116` (docs), `9f82382` (code).

## A. Verdict

**PASS.** All 18 review questions clear with evidence; no P0/P1 findings. One
substantive P2 (missing Radix Dialog `Description`) and two P3 notes (both
verified safe / accepted patterns). The fix is surgical: 4 source files + i18n,
no scope leak into tables, badges, status, icons, or state frameworks.

## B. Methodology

Independent read-only review: read `AdminLayout.tsx`, `AppSidebar.tsx`,
`responsive-shell.test.tsx`, `zh-CN.ts`, `DESIGN.md` §9, `sheet.tsx`,
`button.tsx`, `ExamLayout.tsx`, `DashboardPage.tsx`, `table.tsx` in full;
ran the test suite (32 layout/responsive tests pass); empirically resolved the
tailwind-merge width classes for the drawer.

## C. Review-question findings

| # | Question | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Desktop sidebar unchanged at lg+ | PASS | `AppSidebar.tsx` keeps `lg:flex` + collapse buttons + `w-[232px]/w-14`; `groups`/`managementItems` byte-identical |
| 2 | Mobile sidebar removed from flow (<lg) | PASS | root `hidden lg:flex` → `display:none`, removed from tab order |
| 3 | Same nav authority (no duplicate arrays) | PASS | one `SidebarContent` consumes one set of module constants; both surfaces render it |
| 4 | No document-level horizontal scroll | PASS | `min-w-0 flex-1` content column; 0 overflow violations across 28 viewport×route samples |
| 5 | Main receives adequate width (<lg) | PASS | full viewport width (640/420/390 → main 640/420/390, was 408/188/158) |
| 6 | Topbar trigger accessible | PASS | `icon-lg`=40px, `aria-label`, `aria-expanded`, `aria-controls`, `aria-haspopup`, Indigo ring |
| 7 | Drawer focus trapping | PASS | Radix Dialog traps focus |
| 8 | Focus restoration to trigger | PASS | explicit `useEffect` + `wasOpenRef`; fires only on open→close |
| 9 | Body scroll lock | PASS | Radix Dialog scroll lock |
| 10 | Page actions reachable | PASS | no shell overflow-hidden; actions flow in `min-w-0 flex-1` column |
| 11 | Dashboard cards collapse | PASS | grid classes untouched by this commit |
| 12 | Tables own local scroll | PASS | `table.tsx` `overflow-x-auto` untouched |
| 13 | ExamLayout not broken / not ignored | PASS | not modified; no sidebar; never defective; correctly scoped out |
| 14 | No icon redesign | PASS | only `Menu`/`X` added; existing imports unchanged |
| 15 | No Wave 2 work | PASS | `git diff --name-only` shows only 4 source files + i18n + 2 docs |
| 16 | No new global state framework | PASS | only `useState`/`useRef`/`useEffect` |
| 17 | No content hidden to pass width | PASS | nav moves to drawer, fully reachable; nothing deleted |
| 18 | No desktop/1000px regression | PASS | trigger `lg:hidden`, sidebar `lg:flex`; 1000px is <lg → mobile path, no compression |

## D. Potential-bug analysis

- **Focus-restore steals focus on mount/re-render?** No. `wasOpenRef` guard
  suppresses mount and non-transition runs; effect deps are `[mobileNavOpen]`
  only. Verified across all state transitions.
- **Duplicate nav arrays drifting?** No. Both desktop `AppSidebar` and the
  mobile drawer render the same `<SidebarContent>`, which reads the same
  module-level `groups`/`managementItems`. One source of truth, guarded by
  `responsive-shell.test.tsx`.
- **Drawer width tailwind-merge conflict?** No. twMerge drops `w-3/4` (keeps
  `w-[18rem]`) and drops `sm:max-w-sm` (keeps
  `sm:max-w-[calc(100vw-3rem)]`); final = `min(18rem, 100vw-3rem)` at all
  viewports, matching DESIGN.md §9.
- **`aria-controls` references absent id when closed?** Minor (P3). The
  controlled element is conditionally rendered, so its id is absent while
  closed. This is the standard accepted disclosure-widget pattern (Radix's own
  primitives do this); strict validators may flag it but it is not a functional
  issue.
- **TypeScript `any`/lint violations?** None. The `t(item.labelKey as never)`
  cast pre-exists as the project's typed-catalog pattern.

## E. Findings by category

**FACT:** `lg` breakpoint behavior is deterministic (1023 → mobile, 1024 →
desktop), verified at the exact boundary.

**ACCESSIBILITY DEFECT (P2):** Missing Radix Dialog `Description`. On open,
Radix logs `Missing Description or aria-describedby`. The drawer provides an
sr-only `SheetTitle` (satisfies `aria-labelledby`) but no description. Fix: add
an sr-only `SheetDescription` or `aria-describedby={undefined}` on
`SheetContent`. Does not affect focus/scroll-lock/escape.

**RESPONSIVE AUTHORITY VIOLATION:** none.

**IMPLEMENTATION DEFECT:** none beyond the P2 above.

**PRE-EXISTING PAGE DEFECT:** none surfaced.

**DESIGN JUDGMENT:** single `lg` breakpoint is the simplest deterministic
choice and matches the brief's preferred tablet behavior (full-width, drawer
nav). A compact persistent rail at `md` was considered and rejected as
unnecessary complexity for no benefit.

## H. Human visual review (post-PASS) — found a regression; FIX-2

A human visual review of the PASSed implementation found that the single-`lg`
model produces a **regression at 1024px**: at 1024 the expanded 232px sidebar
starves `<main>` to 792px — *narrower than the 1000px full-width state*
(main=1000). Concrete symptoms at 1024px: dashboard metric labels truncated
("考试进行中" → "考试进…"); exam-list action column pushed against / beyond the
container edge. 1000px (drawer, 2×2 cards) looked better than 1024px.

Verdict: 420 drawer PASS; 768–1000 drawer PASS; exam runtime PASS;
**1024–1279 desktop shell FAIL — breakpoint corrective required.**

### FIX-2 — three-state shell (resolved)

Replaced the two-state shell with a deterministic **three-state** shell across
two breakpoints (`lg`=1024, `xl`=1280), reusing the existing 56px collapsed
sidebar as the compact rail:

| Viewport | State | Sidebar | mainW |
| --- | --- | --- | --- |
| `<lg` (<1024) | mobile/tablet drawer | `display:none` | viewport |
| `lg … <xl` (1024–1279) | compact desktop | 56px rail | viewport − 56 |
| `>=xl` (≥1280) | full desktop | 232px (user-collapsible) | viewport − 232 |

Verified at the boundary: 1023→drawer (main 1023), 1024→rail (main 968),
1279→rail (main 1223), 1280→expanded (main 1048). 1000→1024 now narrows main
by only ~32px (was 208px). Dashboard main@1024 has **0 clipped leaf elements**
(was truncated); exam-list@1024 has **8 action buttons, last at right=943
within the 1024 viewport** (was clipped). No document overflow at any tested
viewport. 994 web tests pass; all static gates + build clean.

The user-controlled collapse (232→56) now lives only at `xl+` (the band where
232px is affordable); in the compact band the sidebar IS the rail, so no
expand control is shown there.

## F. Severity summary

- P0: none
- P1: none
- P2: missing Dialog Description (Radix warning) — FIX
- P3: `aria-controls` to absent id when closed (accepted pattern, no action)

## G. Disposition

Overall: **PASS**. The P2 (Dialog Description) is a real but non-blocking
accessibility-polish item. It is addressed in a narrow corrective
(UI-RESPONSIVE-SHELL-CORRECTIVE-1-FIX-1) rather than blocking closure.
