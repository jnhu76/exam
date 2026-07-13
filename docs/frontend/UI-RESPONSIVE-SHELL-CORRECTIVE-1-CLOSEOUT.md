# UI-RESPONSIVE-SHELL-CORRECTIVE-1-CLOSEOUT

> Closeout for the responsive application-shell corrective.

## A. Final verdict

```
UI-RESPONSIVE-SHELL-CORRECTIVE-1: CLOSED
UI-VISUAL-REFINE-1-WAVE-1:         CLOSED
UI-VISUAL-REFINE-1-WAVE-2:         NOT STARTED
UI-ICON-DESIGN-AUDIT-1:            NOT STARTED
```

The admin shell is now responsive. The persistent 232px sidebar — which below
`lg` consumed more than half the viewport and compressed `<main>` to
408/188/158px at 640/420/390 — is removed from normal flow below `lg`. Below
`lg`, `<main>` receives the full viewport width and navigation lives in an
accessible left-opening drawer driven by the same navigation authority as the
desktop sidebar. No icon, color, typography, status, or Wave-2 work was done.

## B. Commit chain

| Hash | Message |
| --- | --- |
| `f533116` | `docs(ui): audit responsive shell failure and plan corrective` |
| `9f82382` | `fix(ui): repair responsive application shell` |
| `747f658` | `fix(ui): resolve responsive shell review findings (FIX-1)` |

Final HEAD: `747f658` on `feat/ui-visual-fixes`.

## C. Files changed

- `DESIGN.md` — §9 gains deterministic Responsive-shell rules + Shared
  navigation authority.
- `apps/web/src/components/layout/AdminLayout.tsx` — mobile drawer state,
  topbar menu trigger, `Sheet` drawer, focus-restore effect.
- `apps/web/src/components/layout/AppSidebar.tsx` — extracted shared
  `SidebarContent`; desktop `<aside>` root gains `hidden lg:flex`.
- `apps/web/src/components/layout/responsive-shell.test.tsx` (NEW) — structural
  tests for trigger/drawer/shared-authority/desktop presence.
- `apps/web/src/i18n/locales/zh-CN.ts` — `nav.actions` openMenu / closeMenu /
  menuTitle / menuDescription.
- `docs/frontend/UI-RESPONSIVE-SHELL-AUDIT-1.md` (NEW) — baseline audit.
- `docs/frontend/UI-RESPONSIVE-SHELL-CORRECTIVE-1-PLAN.md` (NEW) — plan.
- `docs/frontend/UI-RESPONSIVE-SHELL-CORRECTIVE-1-REVIEW.md` (NEW) — review.

`ExamLayout.tsx`, `sheet.tsx`, `button.tsx`, `table.tsx`, `badge.tsx`,
`statusMeta.ts`, and all business pages are **unchanged**.

## D. Responsive authority

Single breakpoint `lg` (1024px), encoded in DESIGN.md §9:

- **Desktop (`>=lg`):** persistent sidebar (232 expanded / 56 collapsed), main
  fills the rest.
- **Tablet & mobile (`<lg`):** sidebar `display:none` (removed from flow and
  tab order); left `Sheet` drawer; topbar menu trigger; main = full width;
  16px gutter.
- **Document overflow:** `scrollWidth <= clientWidth + 1` at every viewport.
- **Shared navigation authority:** desktop + mobile render one
  `SidebarContent`.

## E. Breakpoint behavior (verified at the exact boundary)

| Viewport | Sidebar | Trigger | Main width | Overflow |
| --- | --- | --- | --- | --- |
| 1023 (`<lg`) | `display:none` | visible | 1023 (full) | none |
| 1024 (`lg`) | `flex`, 232px | hidden | 792 | none |
| 1025 (`>lg`) | `flex`, 232px | hidden | 793 | none |

## F. Shared navigation ownership

One `SidebarContent` component (`AppSidebar.tsx`) renders brand + nav `groups`
+ role-gated `managementItems` + user identity + logout. Consumed by:
- desktop `AppSidebar` `<aside>` (with the collapse control);
- mobile drawer `SheetContent` (no collapse).

Single module-level `groups` / `managementItems` arrays — no duplicate nav
mapping. Guarded by `responsive-shell.test.tsx` "renders the same nav entries
… SidebarContent drives both surfaces from one component".

## G. Accessibility behavior (verified)

- Menu trigger: 40×40 (`icon-lg`), `aria-label`, `aria-expanded`,
  `aria-controls`, `aria-haspopup="dialog"`, visible Indigo focus ring.
- Drawer (Radix Dialog): focus trap while open; Escape closes; overlay click
  closes; background `overflow:hidden` scroll lock; route navigation closes.
- Focus restoration: explicit `useEffect` + `wasOpenRef` returns focus to the
  trigger on the open→close transition (Radix's own restore only fires when
  the opener is a DialogTrigger; this shell uses a controlled Sheet).
- Drawer exposes an sr-only `SheetTitle` (accessible name) and sr-only
  `SheetDescription` (FIX-1) — Radix Description warning resolved.
- Desktop sidebar links are `display:none` below `lg` → no duplicate tab stops.

Full interaction checklist (420px): trigger focusable ✓; Enter opens ✓; focus
enters drawer ✓; Tab stays trapped ✓; Escape closes ✓; focus restored ✓;
scroll lock ✓; route selection closes ✓.

## H. Overflow evidence

Final runtime probe, 28 viewport × route samples (admin dashboard/exams/
settings/system + candidate exam-list at 1440/1000/768/640/420/390):

```
TOTAL DOCUMENT OVERFLOW VIOLATIONS: 0
document.documentElement.scrollWidth <= clientWidth + 1  (every sample)
```

At the previously-defective 640/420/390, `<main>` width now equals the viewport
(640/420/390) instead of the old 408/188/158. Tables retain local
`overflow-x-auto` (Table primitive, untouched); the document root never
scrolls.

## I. Route/viewport matrix

| Route | 1440 | 1000 | 768 | 640 | 420 | 390 |
| --- | --- | --- | --- | --- | --- | --- |
| admin/dashboard | ok | ok | ok | **fixed** | **fixed** | **fixed** |
| admin/exams | ok | ok | ok | **fixed** | **fixed** | **fixed** |
| admin/settings | ok | ok | ok | **fixed** | **fixed** | **fixed** |
| admin/system | ok | ok | ok | **fixed** | **fixed** | **fixed** |
| exam/list (candidate) | ok | ok | ok | ok | ok | ok |
| /login | ok | — | — | — | ok (no regression) | — |

Screenshots captured out-of-repo at `/tmp/responsive-shots/final/` (not
committed): dashboard at 1440/1000/768/640/420/390, dashboard-drawer-open at
420 & 390, exams/settings/system at 420, candidate-exam-list-420, login-420.

## J. Tests and build gates

- `pnpm --filter web test`: **994 passed / 85 files** (incl. new
  `responsive-shell.test.tsx` 8 tests; existing `layout.test.tsx` 32 tests).
- `pnpm --filter web typecheck`: clean.
- `pnpm --filter web lint:eslint` (`--max-warnings=0`): clean.
- `pnpm format:check`, `pnpm lint`, `pnpm lint:arch`, `pnpm lint:copy`,
  `pnpm lint:db-config`: all clean.
- `pnpm --filter web build`: succeeds (1.82s).
- Runtime: Radix dialog warnings 1→0 after FIX-1.

## K. Review findings and disposition

- P0/P1: none.
- P2 (FIX-1): missing Radix Dialog `Description` → resolved with sr-only
  `SheetDescription`.
- P3 (no action): `aria-controls` references a conditionally-rendered id while
  the drawer is closed — accepted disclosure-widget pattern.

## L. Remaining P2/P3 issues

None from this corrective. Out-of-scope items deliberately deferred (per
non-goals): Settings desktop-whitespace excess, table visual redesign, Badge
redesign, icon aesthetic cleanup, Wave 2.

## M. Explicit next-phase boundary

Do **not** continue into: icon cleanup/replacement, table redesign (zebra,
numeric alignment), Badge redesign, statusMeta remapping, topbar/Settings IA
redesign, Wave 2, or Wave 3. Those remain `NOT STARTED`.

Final repository state: working tree clean; no temp screenshots/scripts
committed; dev DB (`exam`) data intact (4 exams / 5 users / 3 courses / 10
questions / 8 attempts — demo seed, unmodified); dev servers started by this
task stopped.
