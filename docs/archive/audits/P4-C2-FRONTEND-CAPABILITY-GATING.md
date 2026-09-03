# P4-C2 — Frontend Capability Route and Action Gating

> **Job:** `P4-C2 — Frontend Capability Route and Action Gating`
> **Type:** Frontend route-guard implementation + tests.
> **Branch:** `feat/phase4-rbac`
> **Pre-C2 base commit:** `3046bc9` (`refactor(authz): remove legacy authorization residue`)
> **Authority chain read first:** `AGENTS.md`, `docs/audits/P4-R0-MVP-ROLE-SWITCH-REALITY-AUDIT.md`
> (§8, §11.3 P4-G-02, §13 P4-C2), `docs/architecture/authorization.md`,
> `docs/architecture/frontend.md`, `docs/standards/ui-system.md`.
> **Depends on:** P4-V0 PASS (met). Independent of P4-C1.

---

## 1. Objective

Ensure that authenticated users who can enter the admin console can only render
`/admin/*` pages for which their capability union grants page access. Security
remains backend-authoritative; this stage fixes frontend consistency and
direct-URL UX (P4-G-02).

---

## 2. Route-guard architecture

```text
page access:       centralized route-level capability guard
                   (apps/web/src/lib/adminRouteCapabilities.ts)
                                ↓
                   AdminLayout consults it after the existing
                   canAccessAdminConsole shell-admission check
                                ↓
different privileged actions within one page:
                   per-action can(user, permission)  (unchanged — e.g. ExamDetailPage)
                                ↓
backend:           final authorization authority (unchanged)
```

Capabilities are read from `user.capabilities` (the assignment-backed union)
via the existing `can(...)` helper — **never** derived from `user.role`,
primary role, or `presetFor(user.role)`. Multi-role actors get the union.

## 3. Modified / new files

| File | Change |
| --- | --- |
| `apps/web/src/lib/adminRouteCapabilities.ts` | **New.** The SINGLE source of truth: `ADMIN_ROUTE_CAPABILITIES` maps every `/admin/*` route to its required capability. Plus a non-fragile pattern matcher (`matchAdminRoute`, longest static-prefix specificity) and the authoritative guard `canAccessAdminRoute(user, relativePath)`. |
| `apps/web/src/pages/admin/AccessDeniedPage.tsx` | **New.** The 403 / Access-Denied page. Renders no privileged content; offers a "back to your permitted surface" action resolved from `adminLandingPath(user)` (capability union, not primary role). Uses the existing `ErrorState` component. |
| `apps/web/src/components/layout/AdminLayout.tsx` | Added the per-route guard. After the existing `canAccessAdminConsole` shell-admission check, resolves the current route and renders `<AccessDeniedPage />` instead of `<Outlet />` when the actor lacks the route's capability. Shell still renders (the user is in the console); only the routed page is replaced. |
| `apps/web/src/i18n/locales/zh-CN.ts` | Added the `adminRouteGuard` namespace (`accessDenied`, `backToPermitted`). |
| `apps/web/src/lib/adminRouteCapabilities.test.ts` | **New.** 47 unit tests: matcher specificity, route→capability resolution, Teacher ALLOW/DENY (frozen P4 matrix), Candidate boundary, Grader/Proctor scoped surfaces, multi-role union, coverage integrity (every App.tsx route registered). |
| `apps/web/src/components/layout/layout.test.tsx` | Added 6 direct-URL integration tests: Teacher DENY /admin/users + /admin/grading-queue → 403; Teacher ALLOW /admin/exams + /admin/questions/import → page renders; Candidate redirected away from any /admin/*; multi-role primary-Candidate+secondary-Teacher reaches Teacher pages. |

## 4. Route metadata coverage

Every `/admin/*` child route declared in `App.tsx` is registered in
`ADMIN_ROUTE_CAPABILITIES` (enforced by a coverage-integrity test that lists
the canonical App.tsx route set and asserts each is present). Representative
mappings (frozen P4 matrix, P4-R0 §12 + the page's primary backend read
endpoint + the existing sidebar capability):

```text
dashboard                 → SystemHealthView
system / diagnostics      → SystemDiagnosticsView
courses                   → CourseView
questions                 → QuestionView
questions/new             → QuestionCreate
questions/:id/edit        → QuestionUpdate
questions/import          → QuestionImport
exams / exams/:id         → ExamView
exams/new                 → ExamCreate
exams/:id/edit            → ExamUpdate
exams/:id/scores          → ScoreAllView
results                   → ScoreAllView
grading-queue             → GradingQueueView
grading-queue/:id         → GradingDetailView
proctor / exams/:id/proctor(/monitor) → ExamRoomView
users                     → UserView
candidates                → CandidateView   (Teacher ALLOW: read-only CandidateView)
candidate-fields          → CandidateFieldView
settings                  → SettingsView
audit-logs / import-logs  → AuditLogView
attempts/:id              → AttemptTimelineView
"" (index)                → null (intentional — redirects to landing path)
```

Routes not in App.tsx are not registered; an unmapped `/admin/*` path is
**denied by default** (forces registration, safer than rendering an unproven
page).

## 5. Denial behavior (task §5.4)

```text
Unauthenticated:
  existing login redirect (unchanged)

Authenticated with NO admin-console capability:
  existing redirect to exam runtime or /login (unchanged — console-access
  check fires before the per-route guard)

Authenticated with SOME console capability but lacking the current page
  capability: render the 403 Access-Denied page (shell still renders; only
  the routed page is replaced). "Back to your permitted surface" resolves to
  adminLandingPath(user) — the capability-union landing, not a role string.
```

Requirements met: no partially rendered privileged page; no fetch-first-then-
generic-error; no redirect loop; no primary-role branching; multi-role union
works.

## 6. Per-action gating (task §5.5)

Unchanged. Pages that already gate every action on `can(...)` (notably
`ExamDetailPage` and `ExamPage`) are not touched. The route-level guard does
NOT replace per-action gating on those pages; it adds direct-URL page-access
protection. No redundant per-action gating was added to single-capability
pages.

## 7. Preserved behavior (task §5.6)

- No new product roles activated.
- No capability preset changed.
- Existing Proctor/Grader routes keep their existing capabilities; applying
  the centralized route guard is NOT product-role activation (it only
  enforces the already-existing capability on direct-URL access).
- Teacher ALLOW: Courses, Questions, Question Import, Exams, Results,
  Candidates (read-only CandidateView per P4-R0 §7.7).
- Teacher DENY: Dashboard, Grading, Proctor, Users, Settings, Audit,
  Diagnostics, candidate-fields, attempts admin.
- Candidate: exam runtime only unless a secondary assignment grants console
  capabilities.
- Multi-role actors: access is the union of capabilities, not the primary
  role (proven by `candidatePlusTeacher` tests).

## 8. Tests

| Suite | Command | Result |
| --- | --- | --- |
| Route capability unit (NEW) | `pnpm --filter @exam/web exec vitest run src/lib/adminRouteCapabilities.test.ts` | **47 passed / 0 skip** |
| Layout integration (direct-URL) | `pnpm --filter @exam/web exec vitest run src/components/layout/layout.test.tsx` | **47 passed / 0 skip** |
| Capabilities helper (no regression) | `pnpm --filter @exam/web exec vitest run src/lib/capabilities.test.ts` | **63 passed / 0 skip** |
| Full `@exam/web` suite | `pnpm --filter @exam/web test` | **95 files / 1221 tests passed** |

Test coverage (task §5.7):
```text
[x] Teacher ALLOW: /admin/courses, /admin/questions, /admin/questions/import,
    /admin/exams, /admin/results (+ /admin/candidates read-only)
[x] Teacher DENY: /admin/users, /admin/grading-queue, /admin/proctor,
    /admin/settings, /admin/system
[x] Candidate: cannot render an admin page (redirected away at shell boundary)
[x] Multi-role: primary Candidate + secondary Teacher reaches Teacher pages;
    primary Teacher + secondary Candidate retains both shells (layout.test.tsx)
[x] Direct URL: unauthorized → 403 page; authorized → page renders
[x] no role-string page guard (guard reads user.capabilities via can())
[x] no capability re-derivation from role preset
[x] no redirect loop (403 renders in place; shell stays)
```

## 9. C2 acceptance (task §5.8)

```text
[x] Every /admin/* page has a centralized page-capability contract
    (ADMIN_ROUTE_CAPABILITIES, coverage-integrity-enforced)
[x] Unauthorized direct URLs do not render privileged pages (403 page)
[x] Teacher allowed pages work
[x] Teacher denied pages produce the documented denial UX (403 page)
[x] Candidate console boundary holds (shell redirect)
[x] Multi-role capability union holds
[x] No role-string route guards exist (guard reads user.capabilities)
[x] Backend behavior is unchanged (frontend-only)
[x] Frontend tests pass
[x] pnpm verify passes
```

## 10. Diff self-review (task §5.8)

- No duplicated route metadata (single `ADMIN_ROUTE_CAPABILITIES` source).
- No fragile pathname matching (pattern-segment matcher with static-prefix
  specificity; `exams/new` correctly beats `exams/:id`).
- No primary-role checks (guard reads `user.capabilities` via `can()`).
- No out-of-scope Proctor/Grader activation (they keep existing capabilities;
  the guard only enforces them on direct-URL access).
- No unnecessary page rewrites (only `AdminLayout` + new guard module + 403
  page).

## 11. `pnpm verify`

Run after the C2 changes (full repository gate):

```bash
pnpm verify
```

**Result: PASS (exit 0).** All stages green:

```text
format:check        PASS — All matched files use Prettier code style!
lint (code-quality) PASS — Code quality checks passed.
lint:copy           PASS
lint:arch           PASS
lint:db-config      PASS
lint:ui-gates       PASS
lint:eslint         PASS — incl. all exam-ui/* rules
typecheck (turbo)   PASS — 17/17 tasks successful
coverage (turbo)    PASS — 16/16 tasks successful
build (turbo)       PASS — 9/9 tasks successful
```

Coverage-stage highlights:

| Package | Test Files | Result |
| --- | ---: | --- |
| `@exam/web` | **95** (was 94; +`adminRouteCapabilities.test.ts`) | passed (1221 tests) |
| `@exam/api` | 122 (unchanged from C1) | passed |
| `@exam/authz` | 9 | passed |
| `@exam/auth` | 2 | passed |
| `@exam/db` | 23 | passed |

No flake observed on this run.

## 12. Production behavior changes

```text
Backend:           NONE (frontend-only Job).
Catalog/presets:   NONE.
Schema/migrations: NONE.
Frontend runtime:  An authenticated console user who direct-URLs a /admin/*
                   page whose capability they lack now sees a 403 page
                   instead of the (subsequently backend-403-denied) page.
                   Previously the page rendered until the API call 403'd.
                   Sidebar navigation is unchanged.
```
