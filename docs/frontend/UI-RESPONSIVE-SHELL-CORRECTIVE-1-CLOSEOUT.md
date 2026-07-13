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
| _(pending)_ | `fix(ui): three-state responsive shell (FIX-2)` |

Final HEAD: _pending FIX-2 commit_ on `feat/ui-visual-fixes`.

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
- `apps/web/src/hooks/useMediaQuery.ts` (NEW, FIX-2) — SSR/jsdom-safe
  matchMedia hook used to select the xl band.
- `docs/frontend/UI-RESPONSIVE-SHELL-AUDIT-1.md` (NEW) — baseline audit.
- `docs/frontend/UI-RESPONSIVE-SHELL-CORRECTIVE-1-PLAN.md` (NEW) — plan.
- `docs/frontend/UI-RESPONSIVE-SHELL-CORRECTIVE-1-REVIEW.md` (NEW) — review.

`ExamLayout.tsx`, `sheet.tsx`, `button.tsx`, `table.tsx`, `badge.tsx`,
`statusMeta.ts`, and all business pages are **unchanged**.

## D. Responsive authority

**Three-state shell across two breakpoints** (`lg`=1024, `xl`=1280), encoded
in DESIGN.md §9. (FIX-2: the original single-`lg` model regressed at 1024px —
232px sidebar starved main to 792px, worse than 1000px full-width; the
three-state model, reusing the existing 56px collapsed sidebar as a compact
rail, removes the regression.)

- **Mobile/tablet (`<lg`, <1024):** sidebar `display:none` (removed from flow
  and tab order); left `Sheet` drawer; topbar menu trigger; main = full width;
  16px gutter.
- **Compact desktop (`lg … <xl`, 1024–1279):** persistent **56px icon rail**
  (collapsed sidebar); no user expand here; main = viewport − 56.
- **Full desktop (`>=xl`, ≥1280):** persistent **232px sidebar**; the
  user-controlled collapse (232→56) is available only here; main = viewport −
  232 (or − 56 when user-collapsed).
- **Document overflow:** `scrollWidth <= clientWidth + 1` at every viewport.
- **Shared navigation authority:** desktop + mobile render one
  `SidebarContent`.

## E. Breakpoint behavior (verified at the exact boundary, three-state)

| Viewport | State | Sidebar | Trigger | Main width | Overflow |
| --- | --- | --- | --- | --- | --- |
| 1000 | drawer | `display:none` | visible | 1000 | none |
| 1023 (`<lg`) | drawer | `display:none` | visible | 1023 | none |
| 1024 (`lg`) | **rail** | `flex`, 56px | hidden | 968 | none |
| 1100 | rail | `flex`, 56px | hidden | 1044 | none |
| 1279 (`<xl`) | rail | `flex`, 56px | hidden | 1223 | none |
| 1280 (`xl`) | **expanded** | `flex`, 232px | hidden | 1048 | none |
| 1440 | expanded | `flex`, 232px | hidden | 1208 | none |

The 1000→1024 transition now narrows main by only ~32px (was 208px under the
single-`lg` model); dashboard metric labels and the exam-list action column are
no longer clipped at 1024.

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
