# P4-C3 — Three-Role Product-Path and E2E Evidence

> **Job:** `P4-C3 — Three-Role Product-Path and E2E Evidence`
> **Type:** E2E test evidence (production behavior already exists; this Job proves it).
> **Branch:** `feat/phase4-rbac`
> **Pre-C3 base commit:** `87583a3` (`feat(web): enforce capability route guards`)
> **Authority chain read first:** `AGENTS.md`, `docs/audits/P4-R0-MVP-ROLE-SWITCH-REALITY-AUDIT.md`
> (§5.2, §9.3, §11.3 P4-G-01 / P4-G-03, §13 P4-C3),
> `docs/architecture/authorization.md`.
> **Depends on:** P4-V0 PASS (met). P4-C2 (clean Teacher UX) is in place.
> **Status:** Original C3 (`93f9249`) received an independent-review verdict of
> **FAIL** (F-1 BLOCKER: no browser-side Teacher mutation). **CORR1** (this
> revision) corrects F-1 (browser mutation), F-2 (MAJOR: explicit 200/409
> contract), F-3 (MINOR: UI-denial hardening), and F-4 (NOTE: this report's
> framing). See `docs/audits/P4-C3-INDEPENDENT-REVIEW.md` and
> `docs/audits/P4-C3-CORRECTIVE-1.md`. The independent re-review owns the final
> corrected C3 verdict.

---

## 1. Objective

Prove the real Admin / Teacher / Candidate product boundaries end-to-end
through SUPPORTED product interfaces. Closes P4-G-01 (Teacher product path not
proven E2E) and P4-G-03 (no three-role negative-authorization E2E).

Allowed code scope (task §6.1): `apps/e2e/**` only. **No application source
was modified by C3.**

---

## 2. Teacher fixture discipline (task §6.2)

The Teacher is created through the SUPPORTED Admin product interface
(`POST /api/users { role: "Teacher" }`), NOT by direct DB insertion, and NOT
via a default demo/e2e seed. Admin authenticates via the real `/api/auth/login`
flow; the Teacher logs in via the real `/login` UI.

- **No** `Teacher` added to `demo-seed.ts` / `e2e-seed.ts` (verified:
  `rg -n "Teacher|teacher" packages/db/src/e2e-seed.ts` returns nothing).
- Each spec call mints a unique Teacher identity
  (`e2e-teacher-<stamp>-<rand>`) so repeated runs / shards do not collide.
- New helper: `apps/e2e/lib/teacher.ts` (`createTeacherViaApi`, `teacherApiToken`).
- New login helper: `loginAsTeacher` in `apps/e2e/lib/login.ts` (lands on the
  capability-driven `/admin/exams`, not a role string).

## 3. Modified / new files (apps/e2e/** only)

| File | Change |
| --- | --- |
| `apps/e2e/lib/login.ts` | Added `loginAsTeacher(page, username, password)` + `TEACHER_LANDING` (/admin/exams, the Teacher capability-driven surface). |
| `apps/e2e/lib/teacher.ts` | **New.** `createTeacherViaApi` (POST /api/users {role:"Teacher"} as Admin) + `teacherApiToken` (API login). |
| `apps/e2e/e2e/teacher-product-path.spec.ts` | **New.** Positive Teacher E2E. **CORR1 (F-1, F-2):** the exam create + publish mutations are now driven through the rendered browser UI (`ExamCreatePage` → `ExamDetailPage`); the result-surface assertion pins the explicit `200 \| 409 RESOURCE_CONFLICT { details.reason: "EXAM_NOT_FINISHED" }` contract. Course + objective question remain API setup. |
| `apps/e2e/e2e/teacher-authorization-boundary.spec.ts` | **New.** Teacher negative E2E (UI + API 403). **CORR1 (F-3):** the UI-denial loop now also asserts, per denied route, the current URL is unchanged, the Teacher remains in the `admin-layout` shell, and the representative privileged heading is absent. |
| `apps/e2e/e2e/candidate-admin-boundary.spec.ts` | **New.** Candidate admin-console boundary + anti-enumeration. |

No production source, capability, preset, route, schema, or migration changed by
C3 or CORR1. CORR1 scope is `apps/e2e/**` + this report +
`docs/audits/P4-C3-CORRECTIVE-1.md`.

## 4. Positive Teacher E2E (`teacher-product-path.spec.ts`)

Proves (task §6.3):
- Admin creates a Teacher via `POST /api/users { role: "Teacher" }`.
- Teacher logs in through the real `/login` UI → lands on `/admin/exams`
  (capability-driven, not a role string).
- Teacher sees the ALLOWED navigation: Courses, Questions (+ Import), Exams,
  Results.
- Teacher does NOT see the DENIED navigation: Dashboard, Grading, Proctor,
  Users, Settings.
- **Prerequisite course + objective `true_false` question data may be created
  through the supported Teacher APIs** (`CourseCreate` / `QuestionCreate` —
  **no text_response/rubric**, the removed P2-1 scope). These remain setup only.
- **The representative Teacher exam mutation is performed through the rendered
  browser UI**: the Teacher clicks the capability-gated `创建考试` action on
  `/admin/exams` (gated by `canCreateExam` === `ExamCreate`), fills the real
  `ExamCreatePage` form (title input, `手动选题` dialog to add the objective
  question), submits as draft through the rendered `保存草稿` button, opens the
  created exam's detail page, and clicks the capability-gated `发布考试`
  action (gated by `canPublishExam` === `ExamPublish`). **Exam creation AND
  publication both travel through the browser UI**; this satisfies the
  browser-product-path requirement.
- Teacher reaches the permitted result surface: `GET /api/exams/:id/scores` is
  authorized under the explicit `200` or `409 RESOURCE_CONFLICT` with
  `details.reason === "EXAM_NOT_FINISHED"` contract (see §7), and
  `/admin/results` renders (not the 403 page).

Constraints honored: no text_response/rubric authoring; no manual/after_grading
publication semantics; no answerVisibility / standard-answer-leak / notification
verification (these are P3); result access verifies authorization only.

> **Corrective history (CORR1 / F-1, F-4).** The initial C3 implementation used
> API calls (`request.post`) for every Teacher authoring mutation (course,
> question, exam create, exam publish). Independent review classified this as a
> **BLOCKER** because the existing UI supports Teacher exam creation and
> publication (`ExamCreatePage.tsx`, `ExamDetailPage.tsx`), and the Teacher
> lands on `/admin/exams` where the capability-gated create action renders.
> CORR1 moves the representative exam mutation (create + publish) into the
> rendered browser flow; course + question creation remain API setup. API
> mutations alone do **not** satisfy the browser-mutation acceptance criterion.

## 5. Teacher negative E2E (`teacher-authorization-boundary.spec.ts`)

Proves at BOTH the UI and API boundaries (task §6.4):

UI (P4-C2 route guard renders the 403 page on direct URL — Teacher stays in the
console shell):
- `/admin/users`, `/admin/grading-queue`, `/admin/proctor`, `/admin/settings`,
  `/admin/system`, `/admin/audit-logs` → 403 page.

API (backend capability gate returns 403):
- `GET /api/users` → 403
- `GET /api/admin/grading-queue` → 403
- `GET /api/admin/proctor/exams` → 403
- `GET /api/system/diagnostics` → 403
- `GET /api/roles/assignable` → 403 (cannot assign roles)
- `GET /api/exams/:id/export/scores` → 403 (cannot export scores; capability
  gate runs before the resource resolver, so a synthetic uuid still yields 403)

## 6. Candidate boundary E2E (`candidate-admin-boundary.spec.ts`)

Proves (task §6.5):
- Candidate logs in normally and reaches the exam runtime.
- Direct-URL `/admin/users`, `/admin/exams`, `/admin/grading-queue` → redirected
  to `/exam/list` (no admin-console capability; AdminLayout's console-access
  check fires before the per-route guard). No privileged admin content renders.
- API: `GET /api/users` → 403, `GET /api/exams` → 403,
  `GET /api/admin/grading-queue` → 403.
- **Anti-enumeration preserved**: a second candidate's attempt/score probe →
  **404** (not 403), so the actor cannot tell whether the resource exists.

Per task §6.5, one browser/API boundary proof is sufficient — detailed API
ownership tests already exist (`candidateOwnership.test.ts`,
`scores.test.ts`, `m10a.candidateRuntime.test.ts`).

## 7. E2E verification (task §6.7)

Environment / command (the repository's real E2E lifecycle):
```bash
E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh \
  teacher-product-path teacher-authorization-boundary candidate-admin-boundary \
  candidate-happy-path resume-attempt submit-flush
```

Result:

| browser/project | chromium |
| --- | --- |
| spec files | 6 (3 new C3 + 3 existing blocking) |
| tests | 7 (candidate-happy-path has 2) |
| passes | **7** |
| skips | 0 |
| retries | 0 (retries: 0 in config) |
| duration | 17.1s |
| failures | 0 |

Per-spec:

| # | spec | result | duration |
| ---: | --- | --- | ---: |
| 1 | candidate-admin-boundary | ✓ PASS | 2.3s |
| 2 | candidate-happy-path (happy) | ✓ PASS | 3.3s |
| 3 | candidate-happy-path (text_response) | ✓ PASS | 3.3s |
| 4 | resume-attempt | ✓ PASS | 3.5s |
| 5 | submit-flush | ✓ PASS | 1.5s |
| 6 | teacher-authorization-boundary | ✓ PASS | 1.6s |
| 7 | teacher-product-path | ✓ PASS | 1.1s |

The three existing blocking specs (candidate-happy-path, resume-attempt,
submit-flush) still pass — **no regression** from C1/C2/C3.

> **One initial failure, root-caused and fixed (test-only, not a product
> defect).** The first run of `teacher-product-path` asserted
> `GET /api/exams/:id/scores === 200`; it returned **409** (business conflict —
> the freshly-published exam had no attempts yet). 409 ≠ 403 proves the
> Teacher WAS authorized (the capability gate admitted `ScoreAllView`); the 409
> is publication-state, which P3 owns. No production source was modified.
>
> **CORR1 (F-2) narrowed the assertion.** The initial C3 correction only
> asserted `not 403`, which would also pass on `401/404/422/500/503`. CORR1
> pins the explicit contract: the response must be **`200`** (scores ready) or
> **`409 RESOURCE_CONFLICT`** with **`details.reason === "EXAM_NOT_FINISHED"`**
> (the post-gate business conflict for a freshly-published, attempt-less exam).
> The assertion now fails on `401/403/404/422/500/503`. The 409 body shape is
> asserted against the actual API error contract
> (`buildErrorResponse` → `{ error: { code, message, details: { reason }, requestId } }`).

> **CORR1 re-run (six-spec, fresh reseed).** The full C3 + blocking set was
> re-run after the corrective edits through the same `run-wsl.sh` lifecycle
> (fresh `exam_e2e` reseed, workers=1):

```text
project             chromium
spec files selected  6 (3 C3 + 3 existing blocking)
tests               7 (candidate-happy-path has 2)
passes              7
skips               0
retries             0 (retries: 0 in config)
duration            19.0s
exit code           0
```

Per-spec (CORR1 re-run):

| # | spec | result | duration |
| ---: | --- | --- | ---: |
| 1 | candidate-admin-boundary | ✓ PASS | 2.3s |
| 2 | candidate-happy-path (happy) | ✓ PASS | 3.5s |
| 3 | candidate-happy-path (text_response) | ✓ PASS | 3.5s |
| 4 | resume-attempt | ✓ PASS | 3.6s |
| 5 | submit-flush | ✓ PASS | 1.5s |
| 6 | teacher-authorization-boundary | ✓ PASS | 1.8s |
| 7 | teacher-product-path | ✓ PASS | 2.1s |

The corrected `teacher-product-path` (browser mutation + narrowed result
assertion) and the hardened `teacher-authorization-boundary` (per-route URL /
shell / privileged-heading-absence assertions) both pass on a fresh reseed. The
three existing blocking specs remain green — **no regression**.

## 8. C3 acceptance (task §6.8)

```text
[x] Teacher created through supported API/UI, not direct DB insertion
    (POST /api/users { role: "Teacher" } as Admin)
[x] Teacher logs in through real auth flow (loginAsTeacher via /login UI)
[x] Teacher allowed navigation is proven (Courses/Questions/Import/Exams/Results)
[x] Teacher representative allowed mutation is proven through the browser UI
    (CORR1 F-1: exam create + publish driven through ExamCreatePage +
    ExamDetailPage; course + objective question are API setup only)
[x] Teacher result-surface access is proven with an explicit contract
    (CORR1 F-2: GET /api/exams/:id/scores is 200 or 409 RESOURCE_CONFLICT with
    details.reason === "EXAM_NOT_FINISHED"; fails on 401/403/404/422/500/503;
    /admin/results renders)
[x] Teacher UI denial is proven (6 denied routes → 403 page; CORR1 F-3 adds
    per-route URL / admin-shell / privileged-heading-absence assertions)
[x] Teacher backend 403 denial is proven (6 denied APIs → 403)
[x] Candidate admin-console denial is proven (redirected to /exam/list)
[x] Candidate management API denial is proven (403)
[x] Candidate anti-enumeration remains intact (cross-candidate → 404)
[x] Existing blocking E2E specs still pass (candidate-happy-path, resume-attempt, submit-flush)
[x] pnpm verify passes
[x] No production source was modified by C3 or CORR1
```

> **CORR1 note.** The original C3 acceptance item "At least one meaningful
> Teacher mutation uses browser UI when supported" **failed** in independent
> review (F-1 BLOCKER) because every Teacher mutation was an API call. CORR1
> corrects this by moving exam create + publish into the rendered browser UI;
> the F-2 MAJOR (broad `!== 403`) and F-3 MINOR (UI-denial hardening) findings
> are also addressed. See `docs/audits/P4-C3-CORRECTIVE-1.md`. The independent
> re-review owns the final corrected C3 verdict.

## 9. C3 self-review (task §6.8)

- No direct-DB Teacher creation (verified: `createTeacherViaApi` uses POST /api/users).
- No default seed pollution (no Teacher in e2e-seed.ts / demo-seed.ts).
- No P2-1 authoring expansion (objective true_false only; no text_response/rubric).
- No P3 result-semantic expansion (authorization-only on the result surface).
- No Proctor/Grader product activation (only the MVP three roles exercised).
- No flaky waits (all assertions use observable UI/API completion conditions;
  Playwright auto-waiting on role/text/URL; CORR1 F-1 uses `waitForResponse`
  for the create/publish mutations to capture the exam id + assert network
  success, paired with observable UI-state assertions — no `page.waitForTimeout`).
- No test-data leakage (unique Teacher identity per call; seeded exams are
  scoped to the e2e DB which is reseeded every run-wsl.sh run).

> **CORR1 self-review addendum.** The representative exam mutation is driven
> through the rendered browser UI (F-1): the `创建考试` button, `ExamCreatePage`
> form fields, `手动选题` dialog, `保存草稿` button, and `ExamDetailPage`
> `发布考试` button are all interacted with via Playwright role/placeholder/
> text locators — no `request.post`/`fetch` for the exam create or publish
> mutation. Course + objective question remain API setup (allowed prerequisite
> fixture data). The result-surface assertion (F-2) now pins the explicit
> `200 | 409 RESOURCE_CONFLICT { details.reason: "EXAM_NOT_FINISHED" }`
> contract. The Teacher UI-denial loop (F-3) now asserts per route: current
> URL unchanged, admin shell (`admin-layout` testid) still rendered, and the
> representative privileged heading absent.

## 10. Production behavior changes

```text
None. C3 is test-only (apps/e2e/**). No production source, capability, preset,
route, frontend, schema, or migration was modified.
```

## 11. `pnpm verify`

```bash
pnpm verify
```

**Result: PASS (exit 0).** All stages green (format/lint/lint:copy/lint:arch/
lint:db-config/lint:ui-gates/lint:eslint/typecheck 17-17/coverage 16-16/build
9-9). The new E2E specs typecheck cleanly under `@exam/e2e:typecheck`; the
E2E runtime evidence is in §7 (run via the repository's real `run-wsl.sh`
lifecycle, not part of `pnpm verify`'s vitest stages per AGENTS.md).
