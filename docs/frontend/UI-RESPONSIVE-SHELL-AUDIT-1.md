# UI-RESPONSIVE-SHELL-AUDIT-1

> Responsive application-shell failure audit. Authoritative baseline for
> `UI-RESPONSIVE-SHELL-CORRECTIVE-1`.

## A. Verdict

**CONFIRMED SHELL DEFECT.** At 640px / 420px / 390px the admin shell renders a
persistent 232px sidebar in normal document flow. The sidebar consumes more
than half of the mobile viewport and compresses `<main>` to 408px (640),
188px (420), and 158px (390). Main content, cards, and table cells are clipped;
there is no mobile navigation drawer and no menu trigger. This is the exact
failure described in the corrective brief.

The defect is a **shell composition defect**, not a color/typography/icon/status
defect. The Quiet Graphite visual direction (UI-VISUAL-REFINE-1-WAVE-1, CLOSED)
is authoritative and is not reopened by this audit.

Secondary observation: the clipped `<main>` does not always produce a
*document-level* horizontal scrollbar because the `admin-layout` flex container
itself clips at the viewport edge. The user-visible symptom is therefore
**content clipping** (truncated text, unreachable actions, unreadable tables)
rather than a document scrollbar. Both manifestations are the same root cause:
the persistent sidebar is not removed from flow below the desktop breakpoint.

```
UI-RESPONSIVE-SHELL-AUDIT-1:   COMPLETE
UI-RESPONSIVE-SHELL-CORRECTIVE-1: READY FOR PLAN
```

## B. Repository attribution

| Owner file | Role | Relevant code |
| --- | --- | --- |
| `apps/web/src/components/layout/AdminLayout.tsx` | Admin shell owner | Renders `<AppSidebar />` then a `min-w-0 flex-1` main column; no breakpoint logic |
| `apps/web/src/components/layout/AppSidebar.tsx` | Sidebar content + container | `<aside class="... min-h-screen shrink-0 ... w-[232px] / w-14">`; always rendered; nav `groups` + `managementItems` arrays are the single navigation authority |
| `apps/web/src/components/layout/ExamLayout.tsx` | Candidate shell owner | Top header + `<main>`; no sidebar — already full-width, no shell overflow |
| `apps/web/src/components/ui/sheet.tsx` | Drawer primitive (unused by shell today) | Radix Dialog; supports `side="left"`; provides focus trap, Esc close, scroll lock natively |
| `apps/web/src/index.css` | Token + base layer | No responsive shell rules |
| `DESIGN.md` §9 | Layout authority | States sidebar widths (232/56), gutters, max-widths; **lacks** deterministic shell breakpoint rules, mobile-drawer rule, `min-width:0` rule, and document-overflow prohibition |

## C. Layout ownership map

```
AdminLayout  (data-testid="admin-layout", flex min-h-screen)
├── AppSidebar  (data-testid="app-sidebar", aside, in normal flow, w-[232px]|w-14)
│   ├── BrandHeader  (brand mark + name)
│   ├── nav  (groups: overview, questionBank, exams; + management if Admin)
│   └── footer region  (avatar, name, logout)
└── div.min-w-0.flex-1
    ├── header  (h-14, page title only — no menu trigger)
    └── main  (p-6 lg:p-8, Outlet)
```

```
ExamLayout  (data-testid="exam-layout", min-h-screen)
├── header  (h-14, brand + myExams link + account dropdown)
└── main  (Outlet)   ← no sidebar; already responsive; NOT defective
```

Navigation authority: `groups` (3 groups, 7 items) + `managementItems`
(7 items, Admin-only) in `AppSidebar.tsx`. This is the single source today; no
mobile duplicate exists (because no mobile nav exists).

## D. Viewport matrix (reproduced, admin dashboard)

Measured via Playwright against the running dev server (`api` :3000, web :4173,
dev `exam` DB with demo seed). Each value is the freshly-loaded route.

| Viewport | docClient | docScroll | asideWidth | mainWidth | mainLeft | Failure |
| --- | --- | --- | --- | --- | --- | --- |
| 1440×900 | 1440 | 1440 | 232 | 1208 | 232 | none (desktop) |
| 1000×900 | 1000 | 1000 | 232 | 768 | 232 | none (desktop) |
| 768×900 | 768 | 768 | 232 | 536 | 232 | marginal — sidebar still persistent, main only 536px |
| 640×900 | 640 | 640 | 232 | 408 | 232 | **YES — main 408px, sidebar >⅓ viewport** |
| 420×900 | 420 | 420 | 232 | 188 | 232 | **YES — main 188px (45%), no drawer, no trigger** |
| 390×844 | 390 | 390 | 232 | 158 | 232 | **YES — main 158px (41%), no drawer, no trigger** |

Full per-route matrix (`/admin/dashboard`, `/admin/exams`, `/admin/settings`,
`/admin/system`, `/exam/list`) is identical in shape: every admin route is
shell-broken below the breakpoint; `/exam/list` (candidate) is not broken at any
viewport. Baseline JSON: `audit2.json` (captured at audit time, archived with
the reviewer artifacts; not committed to the repository).

## E. Reproduced failure evidence

Dedicated 420px probe (`admin` → `/admin/dashboard`, freshly loaded):

```json
{
  "asideExists": true,
  "asideDisplay": "flex",
  "asideVisibility": "visible",
  "asidePosition": "static",
  "asideWidth": "232px",
  "asideOffsetParent": true,
  "navLinks": 14,
  "adminLayoutRect": { "w": 420, "h": 1070 },
  "mainRect": { "w": 188, "left": 232 },
  "docScroll": 478,
  "docClient": 420
}
```

Interpretation: the sidebar is a normal-flow static element 232px wide; main is
squeezed to 188px starting at x=232. `docScroll` (478) exceeds `docClient` (420)
on first paint, then settles to equality once the flex container clips. The
user-facing damage — 188px main, clipped cards, unreachable actions — is real.

Screenshots captured out-of-repo at `/tmp/responsive-shots/`:
`admin-dashboard-{1440,1000,768,640,420,390}.png`,
`admin-{exams,settings,system}-{…}.png`, `candidate-exam-list-{…}.png`.

## F. Overflow-source matrix

| Overflow / clip owner | Causal CSS | Classification | In scope? |
| --- | --- | --- | --- |
| `AppSidebar` `<aside>` | `shrink-0` + `w-[232px]`, always rendered, normal flow | **SHELL DEFECT** | YES |
| `AdminLayout` `<div class="min-w-0 flex-1">` | correct `min-w-0` (good), but starved by sibling aside | SHELL DEFECT (sibling) | YES |
| `AdminLayout` `<header>` | `px-6` fixed; no menu trigger | SHELL DEFECT (missing trigger) | YES |
| `ExamPage` table inside `DataTableShell` | table intrinsic width > container | **EXPECTED LOCAL SCROLL** | NO (owned by Table primitive `overflow-x-auto`) |
| `DashboardPage` recent-exams `<Table>` | same — scrolls inside its Card | EXPECTED LOCAL SCROLL | NO |
| `DashboardPage` stats grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` | already responsive | not defective | NO |
| `PageHeader` `flex-col sm:flex-row` | already responsive | not defective | NO |

No document-level scrollbar is produced by tables — the Table primitive wraps
content in `overflow-x-auto`, which is the correct local-scroll owner.

## G. Accessibility and interaction defects

At 640/420/390px today:

1. **No mobile navigation exists.** There is no menu trigger, no drawer, no
   Sheet. Navigation is only reachable via the desktop sidebar, which is
   cramped but still keyboard-focusable — so a mobile keyboard user can tab
   through 14 tiny links inside a 232px column.
2. **No focus trap / scroll lock** — N/A (no drawer to trap).
3. **No menu trigger** — no `aria-expanded`/`aria-controls`, no 36×36 target.
4. **Topbar has no menu affordance** — only a static page title.
5. Touch targets inside the cramped sidebar (`min-h-10` = 40px) technically
   meet the 36px floor but are visually compressed; the real issue is that the
   entire sidebar should not be visible.

These are all consequences of the missing responsive shell, fixed together.

## H. In-scope corrective requirements

1. Below the breakpoint, remove the persistent sidebar from normal flow.
2. Provide a mobile navigation drawer (left-opening `Sheet`) driven by the
   **same** `groups` / `managementItems` navigation authority as the desktop
   sidebar (extract a shared nav-content component; do not duplicate the arrays).
3. Add a topbar menu trigger visible only below the breakpoint; ≥36×36; Indigo
   focus ring; `aria-expanded`/`aria-controls`; accessible name.
4. Drawer: closes on route navigation, on Escape, on overlay click; traps focus;
   restores focus to the trigger; locks background scroll; exposes an accessible
   name. Prefer the existing `Sheet` primitive (Radix) — do not hand-roll.
5. Main-content containment: `width:100% / min-width:0 / max-width:100%` at the
   shell boundary. No shell-level `overflow-x:auto` shortcut.
6. Document root: `document.documentElement.scrollWidth <= clientWidth + 1` at
   every required viewport.
7. Mobile page gutter 16px; desktop gutters unchanged.
8. Constrain the corrective to the admin shell (`AdminLayout` + `AppSidebar` +
   a small shared nav component). `ExamLayout` is not defective and is touched
   only if a shared change is strictly necessary (it is not expected to be).

## I. Explicit non-goals

(per corrective brief §3.2 — not reopened here)

Table visual redesign; zebra rows; numeric-column alignment; statusMeta
remapping; Badge redesign; icon-family replacement / icon aesthetic cleanup;
card-shadow redesign; Settings IA redesign; topbar IA redesign; toolbar merging;
page max-width redesign beyond responsive containment; business-page
restructuring; dark theme; typography redesign; token palette changes; routing
or authorization changes; API or DB changes; Wave 2 / Wave 3 visual work.

A table may remain horizontally scrollable inside its own bounded container.
The **whole document** may not horizontally scroll because of the shell, and
**main content may not be clipped below a usable width**.

## J. Stop condition

Audit complete when: the failure is reproduced with computed evidence (DONE),
the owning elements and causal CSS are identified (DONE), and the in-scope
requirements are unambiguous (DONE). Proceed to PHASE B (responsive authority)
and PHASE C (plan).
