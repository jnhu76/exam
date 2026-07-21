# UI-RESPONSIVE-SHELL-CORRECTIVE-1-PLAN

> Implementation plan for `UI-RESPONSIVE-SHELL-CORRECTIVE-1`.
> Baseline: `UI-RESPONSIVE-SHELL-AUDIT-1`. Authority: `DESIGN.md` §9
> (Responsive shell, deterministic — added in this corrective's Phase B).

## A. Verdict

Narrow, surgical corrective. One breakpoint (`lg` = 1024px). One shared
navigation-content component. One mobile drawer built on the existing `Sheet`
primitive. One topbar menu trigger. Minimal main-content containment already
exists (`min-w-0 flex-1`); no business-page restructuring.

## B. Baseline and authority

- Baseline defect: `UI-RESPONSIVE-SHELL-AUDIT-1` — persistent 232px sidebar in
  normal flow below `lg`, compressing `<main>` to 408/188/158px at 640/420/390.
- Authority: `DESIGN.md` §9 Responsive shell (desktop persistent sidebar at
  `lg+`; below `lg` sidebar removed from flow, modal drawer, mobile topbar
  trigger, main `min-width:0`, document-overflow prohibition, local table
  scroll ownership).
- Tailwind v4 breakpoints (confirmed via Context7): `sm`=640, `md`=768,
  `lg`=1024; `max-lg` = `<1024px`.

## C. Layout ownership map

```
AdminLayout (owner of mobileNavOpen state)
├── DesktopSidebar   <aside class="hidden lg:flex ..."> wraps SidebarContent
├── MobileTopbarTrigger  <button class="lg:hidden ..."> (menu, in header)
├── <header>  (title, unchanged content; trigger prepended at <lg)
├── <main>    (unchanged)
└── MobileNavDrawer  <Sheet side="left" class="lg:hidden"> wraps SidebarContent
```

`SidebarContent` is the shared authority: BrandHeader + nav groups +
management (role-gated) + user identity + logout. Single source for entries,
groups, active-route logic, labels, icons, role visibility.

## D. Breakpoint behavior

| Viewport | Sidebar | Drawer | Trigger | Main |
| --- | --- | --- | --- | --- |
| `>=lg` (≥1024) | persistent, in flow (232/56 collapse) | not rendered | not rendered | fills remaining width |
| `<lg` (<1024) | removed from flow (`hidden`) | available (closed by default) | visible | 100% width |

Drawer width: `min(18rem, 100vw - 3rem)` via `w-[18rem] max-w-[calc(100vw-3rem)]`.

## E. Exact files to modify

| File | Change | Risk |
| --- | --- | --- |
| `apps/web/src/components/layout/AppSidebar.tsx` | Extract nav-content into `SidebarContent`; keep `AppSidebar` as the desktop `<aside>` wrapper with `hidden lg:flex` + collapse. Export `SidebarContent`. | low — pure refactor of existing JSX; nav arrays stay here |
| `apps/web/src/components/layout/AdminLayout.tsx` | Add `mobileNavOpen` state; render desktop `AppSidebar` (now `hidden lg:flex`), a topbar menu trigger (`lg:hidden`), and a mobile `Sheet` drawer wrapping `SidebarContent`. Close drawer on route change. | medium — core shell; tested by layout.test + new tests |
| `apps/web/src/components/layout/layout.test.tsx` | Keep existing tests green; `AppSidebar` stays testable (desktop). | low |
| `apps/web/src/components/layout/responsive-shell.test.tsx` (NEW) | Structural tests: trigger exists, drawer open/close, shared nav authority, hidden desktop nav not focusable. | low |
| `apps/web/src/i18n/locales/zh-CN.ts` | Add `nav.actions.openMenu` / `closeMenu` / `menuTitle` keys. | low |

**Files NOT modified:** `ExamLayout.tsx` (not defective), `sheet.tsx` (primitive
already supports `side="left"`), `index.css` (no token changes), any business
page, any table primitive, any icon, `statusMeta`, `StatusBadge`.

## F. Shared navigation strategy

`SidebarContent` props: `{ user, collapsed?, onLogout, onNavigate? }`.
- Renders `BrandHeader` (compact when `collapsed`), nav `groups`, role-gated
  `managementItems`, user identity region, logout button.
- `onNavigate` fires after a `NavLink` is activated — used by the mobile drawer
  to close on navigation. Desktop passes nothing (no-op).
- The nav arrays `groups` + `managementItems` and the `SidebarLink` component
  move into `SidebarContent` (or remain in the module and are consumed by both).
  Single source of truth — no second array.

Desktop `AppSidebar` continues to take `collapsed` + `onCollapse` and wraps
`SidebarContent` in the `<aside>` with the collapse button. Mobile drawer
renders `SidebarContent` with `collapsed={false}` inside `SheetContent`.

## G. Overflow ownership strategy

- Sidebar removed from flow below `lg`: `AppSidebar` root gets `hidden lg:flex`
  (was always `flex`). No width is consumed below `lg`.
- Main wrapper: already `min-w-0 flex-1` — unchanged; now receives full width
  below `lg` because the sidebar sibling is `display:none`.
- No shell-level `overflow-x:auto`. Tables keep their own `overflow-x-auto`
  wrapper (Table primitive, unchanged).
- Document root: with the sidebar `hidden` below `lg`, `document.scrollWidth`
  equals `clientWidth` (verified by runtime matrix in Phase E).

## H. Accessibility behavior

Implemented via the existing `Sheet` (Radix Dialog), which provides natively:
- focus trap while open;
- Escape to close;
- focus restoration to the trigger;
- background scroll lock;
- `aria-expanded`/`aria-controls` wiring (trigger `aria-controls` → sheet
  content id; `aria-haspopup="dialog"`).

We add explicitly:
- menu trigger `aria-label` = `t("nav.actions.openMenu")`, ≥36×36 (`size="icon-lg"`),
  visible Indigo focus ring (`focus-visible:ring-2 focus-visible:ring-ring`);
- `SheetTitle` with `t("nav.actions.menuTitle")` (sr-only acceptable; provides
  the accessible name);
- drawer `SheetContent` carries `data-testid="mobile-nav-drawer"`;
- desktop sidebar is `hidden` below `lg` (not just visually hidden), so its
  links are removed from the tab order — no duplicate tab stops.

`onNavigate` closes the drawer after a route selection.

## I. Route and viewport test matrix

Routes: `/admin/dashboard`, `/admin/exams`, `/admin/settings`, `/admin/system`,
`/exam/list` (candidate, regression check), `/login` (regression check).

Viewports: 1440, 1000, 768, 640, 420, 390.

Pass: `document.documentElement.scrollWidth <= clientWidth + 1` at every cell;
main width == viewport below `lg`; desktop sidebar present at `>=lg`.

## J. Unit/structural test plan

`responsive-shell.test.tsx` (jsdom — DOM structure, not layout):
1. AdminLayout renders a menu trigger with an accessible name.
2. The trigger has `aria-expanded="false"` initially and toggles to `"true"`
   when activated.
3. Activating the trigger renders the mobile drawer (`data-testid`).
4. The drawer contains the same nav links as the desktop sidebar (shared
   authority) — assert a known label is present in both.
5. Desktop sidebar is present (still rendered in DOM; CSS hides it).
6. Existing `layout.test.tsx` suite stays green.

CSS/layout assertions (breakpoint visibility, width) are validated at runtime
in Phase E via Playwright, not jsdom.

## K. Runtime screenshot plan

Capture out-of-repo at `/tmp/responsive-shots/` (NOT committed):
`admin-dashboard-{1440,1000,768,640,420,390}`, `admin-dashboard-420-drawer-open`,
`admin-{exams,settings,system}-420`, `candidate-exam-list-420`, `login-420`.

## L. Risks and rollback

- **Risk:** Drawer focus/scroll-lock regressions. **Mitigation:** rely on Radix
  Dialog (proven), add interaction assertions; rollback = revert the
  `AdminLayout`/`AppSidebar` commit.
- **Risk:** Existing layout tests break if `AppSidebar` signature changes.
  **Mitigation:** keep `AppSidebar`'s public props (`user`, `collapsed`,
  `onCollapse`, `onLogout`) unchanged; only its root className gains
  `hidden lg:flex`. `SidebarContent` is the new internal export.
- **Risk:** Hiding the desktop sidebar removes the collapse button below `lg`.
  **Mitigation:** intended — below `lg` navigation is the drawer, not collapse.
- **Rollback:** `git revert <fix commit>`; no schema/migration/contract change.

## M. Explicit non-goals

Table redesign, zebra rows, numeric alignment, statusMeta remapping, Badge
redesign, icon-family change, icon cleanup, card-shadow redesign, Settings IA,
topbar IA, toolbar merging, page max-width redesign, business-page
restructuring, dark theme, typography redesign, token changes, routing/auth
changes, API/DB changes, Wave 2/3 visual work.

## N. Acceptance criteria

1. At 640/420/390: desktop sidebar is not in normal flow; main width ≈ viewport.
2. At 1440/1000/768: desktop sidebar present (768 is below `lg` so drawer mode
   applies — 768 tablet uses the drawer per the brief's preferred behavior).
   Desktop (≥1024) keeps the persistent sidebar unchanged.
3. Mobile menu trigger visible below `lg`; opens a left drawer with full nav.
4. Drawer: closes on Escape, on overlay click, on route navigation; traps focus;
   restores focus; locks scroll.
5. `document.documentElement.scrollWidth <= clientWidth + 1` at every viewport.
6. Tables retain local horizontal scroll; no document-level scroll from tables.
7. `pnpm verify` passes (format, lint, lint:copy, lint:arch, lint:eslint,
   typecheck, coverage, build). New layout tests pass.
8. No icon, color, typography, status, or Wave-2 change.

## O. Stop condition

Implementation done when N.1–N.8 hold and Phase F adversarial review returns
PASS (no P0/P1). Then closeout (`UI-RESPONSIVE-SHELL-CORRECTIVE-1-CLOSEOUT.md`).
