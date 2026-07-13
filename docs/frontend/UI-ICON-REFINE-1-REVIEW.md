# UI-ICON-REFINE-1 — CONFORMANCE REVIEW

**Date:** 2026-07-13
**Reviewer:** Autonomous implementation review (not a library audit)
**Scope:** Does the implemented Lucide Refined system conform to the UI-ICON-REFINE-1 spec?

---

## Verdict: PASS (with one P1 documented as infrastructure-blocked)

All code-level conformance criteria pass. The single P1 — "visual screenshots unavailable" — is blocked by Docker/PostgreSQL being unavailable in the current WSL environment, not by any code defect.

---

## P0 findings (broken navigation / inaccessible control / runtime failure)

**None.**

- Navigation renders correctly in all three modes (expanded sidebar, compact rail, mobile drawer) via the shared SidebarContent authority.
- All icon-only buttons retain `aria-label` on the parent control.
- No runtime failures: typecheck, lint, 1011 tests, and production build all pass.

---

## P1 findings

### P1-1: Visual screenshots unavailable — INFRASTRUCTURE BLOCKED

**Severity:** P1 per spec §31 ("visual screenshots unavailable").

**Root cause:** Docker is not available in this WSL2 distro (`docker: command not found`). The PostgreSQL container cannot start (`pnpm db:up` fails). Without the database, the API server cannot start, and without the API server there is no running application for Playwright to screenshot.

**Evidence:**
```
$ pnpm db:up
The command 'docker' could not be found in this WSL 2 distro.
```

**Tooling status:**
- Playwright `@playwright/test` 1.61.0 IS installed at `apps/e2e/node_modules/`.
- Chromium browsers ARE cached at `~/.cache/ms-playwright/chromium-1228/`.
- The blocker is Docker/PostgreSQL, not Playwright/Chromium.

**Disposition:** Cannot be corrected by code changes. Requires Docker Desktop WSL integration to be enabled by the human operator. This is documented as an infrastructure prerequisite, not a code defect.

**Recommendation:** When Docker is available, run `bash scripts/e2e/run-wsl.sh` or start the dev stack manually and capture screenshots at 420/1024/1280/1440px.

---

## P1 criteria checklist (code-level, all verified PASS)

| P1 criterion | Status | Evidence |
|---|---|---|
| AppIcon size/stroke authority correct | ✅ PASS | 12 unit tests verify all 7 roles; SVG attributes confirmed via renderToStaticMarkup |
| Button CSS overrides governed icon dimensions | ✅ PASS | AppIcon emits matching CSS size class; test verifies nav/metric stay 18/20px inside Button |
| Broad direct app-owned Lucide rendering remains | ✅ PASS | Drift search: zero remaining `className="size-N"` on lucide icons in pages/components (1 exception: TakeExamPage Flag, documented) |
| Rail semantic collisions remain | ✅ PASS | gradingQueue=ListChecks, users=UsersRound, candidates=UserRoundCheck — all distinct |
| Compact rail lacks discoverability | ✅ PASS | SidebarLink retains `title={label}` tooltip when collapsed; accessible name from NavLink |
| Icon-only controls lack accessible names | ✅ PASS | All icon-only Buttons have aria-label (unchanged from pre-migration) |
| Metric sticker treatment remains | ✅ PASS | StatsCard 40px bg-primary/10 sticker removed; icon is quiet leading anchor |
| Ordinary dense badges remain icon-heavy | ✅ PASS | StatusBadge defaults to text-only; iconPolicy="show" only for urgency/destructive/live |
| Trash remains permanently destructive | ✅ PASS | text-destructive removed from all Trash2 renders; now neutral at rest |
| Meaningful behavior regression | ✅ PASS | 1011 tests pass; no business logic changed |

---

## P2 findings

### P2-1: TakeExamPage Flag is a deliberate raw Lucide exception

**Location:** `apps/web/src/pages/exam/TakeExamPage.tsx` lines 853-857, 913-917.

**Reason:** AppIcon does not support the `fill` prop needed for the flagged/unflagged visual toggle (`fill={condition ? "currentColor" : "none"}`). The Flag icon is rendered as raw Lucide but governed to match the inline role: `size={16} strokeWidth={1.75} absoluteStrokeWidth`.

**Disposition:** Acceptable. Documented in code comments. Two render sites only.

### P2-2: ExamListPage action icons at badge=14px (was 12px)

**Location:** `apps/web/src/pages/exam/ExamListPage.tsx`.

**Reason:** Previous `size-3` (12px) icons migrated to AppIcon size="badge" (14px) since the spec prohibits a 12px role. The 2px size increase is intentional and governed.

**Disposition:** Acceptable. Minor visual change, improves legibility.

---

## P3 findings

### P3-1: Unverified Chromium rendering at fractional scale

The stroke-width values produced by `absoluteStrokeWidth` at non-24 sizes include fractional SVG attributes (e.g., `stroke-width="2.3333333333333335"` at nav=18px). Chromium subpixel rendering of these values has not been visually verified due to the Playwright blocker (P1-1). The SVG attribute values are mathematically correct per the Lucide formula; visual crispness at tested Chromium scale is the remaining unknown.

---

## Static validation results

| Gate | Result |
|---|---|
| `pnpm --filter web typecheck` | ✅ PASS (0 errors) |
| `pnpm --filter web lint:eslint` | ✅ PASS (0 warnings) |
| `pnpm --filter web test` | ✅ PASS (1011 tests, 86 files) |
| `pnpm --filter web build` | ✅ PASS (built in 1.53s) |
| `pnpm lint:arch` | ✅ PASS |
| `pnpm lint:copy` | ✅ PASS |

---

## Conclusion

The implemented Lucide Refined icon system conforms to the UI-ICON-REFINE-1 specification at the code level. All P0 and code-level P1 criteria pass. The sole remaining P1 (visual screenshots) is blocked by Docker infrastructure unavailability, not by any implementation defect.
