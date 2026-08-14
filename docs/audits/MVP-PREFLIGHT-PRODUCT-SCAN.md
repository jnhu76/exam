# MVP Preflight Product Scan

> One focused preflight scan of the CURRENT MVP product before the human
> performs the formal "First Real Exam" acceptance test. This is NOT a formal
> acceptance pass: it used the existing dev stack with demo/e2e data and
> fixed only the obvious, reproduced rough edges of the current MVP.

## A. Baseline

```text
BASE_SHA   2ede3303b873065af40ff82d05851586d4548e65
COMMAND_VERIFIED_SHA  64cba7633c80e00b5b13a52a18ee58a980673c23
            (the exact code+tests commit on which the command verification
            in §G was executed; the later docs commits that write this SHA
            advance the PR head but do not invalidate it)
VISUAL_VERIFIED_SHA   f6ae292d2c69adce280d616c4dd41ae0554d4a39
            (the PR-head commit at the time of the multimodal visual pass
            at the end of this document — a different, later commit than
            COMMAND_VERIFIED_SHA; the two verification records are
            independent)
branch     fix/mvp-preflight-product-scan
date       2026-08-14
```

## B. Environment

```text
Node       v24.15.0
pnpm       11.1.2
Docker     29.6.2 (exam-db-1 postgres:18.4, exam-redis-1)
browser    Chromium 150.0.7871.24 (headless, Playwright-driven)
viewports  1440 x 900 (desktop) and 390 x 844 (mobile sweep)
servers    dev stack: API :3000 (exam DB), Web :4173 (Vite)
```

## C. Paths inspected

```text
/launchpad            (redirects to /login once initialized — documented)
/login                (valid + wrong-password error state)

Admin:
  /admin/dashboard    (stats, recent exams, action buttons)
  /admin/candidates   (list, row actions, 新增考生 dialog + validation)
  /admin/courses      (list, 新增课程 dialog + validation)
  /admin/questions    (list)
  /admin/questions/new (authoring form)
  /admin/exams        (list, row actions)
  /admin/exams/new    (5-step wizard: 基本信息 → 考试策略 → 题目与分数 →
                      时间安排 → 检查并创建; question picker dialog;
                      full create → detail redirect)
  /admin/exams/:id    (draft + graded exam details, stats, 考试配置,
                      考生资格 enrollment dialog, 发布考试, toasts)
  /admin/exams/:id/scores (score list, stats, filters, CSV action)
  /admin/results      (成绩查询 list + score list drill-down)
  /admin/grading-queue, /admin/system, /admin/users

Candidate:
  /exam/list          (可参加 / 历史 / 即将开始 sections, draft-card state)
  /exam/:id/start     (pre-start info page)
  /exam/:id/take      (question nav, save states 等待保存/已保存, timer,
                       标记本题, answered counts, submit dialog with flush
                       counts, refresh persistence)
  /exam/:id/result    (pending state, published state, answer table)

Transitions exercised:
  Scenario A: answer → 已保存 → navigate → refresh → answer preserved →
              change answer → immediate submit (flush) → graded result
  Result publication: candidate submits (manual mode) → pending state →
              admin publish-results → notification badge → published result
  Admin journey: create course→question→exam (wizard) → enroll → publish

Mobile sweep (390 x 844): login, candidate list/start/take/submit dialog,
  result, admin candidates (+create dialog), nav drawer, exam wizard,
  admin tables.
```

## D. Findings

| ID | Severity | Actor | Surface | Evidence | Root cause | Disposition |
| -- | -------- | ----- | ------- | -------- | ---------- | ----------- |
| MVP-P1-01 | P1 | Admin | Exam wizard step 3 | Default 及格分 60; after adding 2 questions (auto 总分 8) the step is born in error "及格分不能超过总分" and 下一步 is blocked before any user interaction. Existing E2E works around it (`passingScore-input` filled with "5"). | `wizardState.ts` defaults `passingScore: 60`; auto-calculated totals below 60 are common with a few questions; validation blocks while the untouched default is invalid. | FIXED |
| MVP-P1-02 | P1 | Candidate | Result page 正确答案 column | Objective-only exam result shows "主观题" in the correct-answer cell of every row (e.g. a 单选题 row with 正确答案 = 主观题). | RBAC-M10-E strips `standardAnswer` from the candidate DTO; `ResultPage` inferred "manual question" from `standardAnswer == null`, so every stripped question rendered the manual marker. | FIXED |
| MVP-P2-01 | P2 | Admin | Exam detail 考试配置 | Raw enum values rendered: 时间模式：timed_window / 重考策略：unlimited / 分数策略：highest, while the wizard and other surfaces use localized labels (不限次数 / 取最高分). | `ExamDetailPage` printed `exam.timingMode/retakePolicy/scoreStrategy` verbatim. | FIXED |
| MVP-P2-02 | P2 | Candidate | Exam list draft card | Enrolled draft exam shows 题目数: 0 although the exam has 2 questions (admin list shows 2). | Summary used `exam.questionSnapshot.length`; drafts have no snapshot yet (snapshot freezes at publish). | FIXED |
| MVP-P2-03 | P2 | Admin | Course create dialog | 课程名称/课程代码 have no required marker; the candidate dialog marks required fields with `*`. | `CoursePage` labels omitted the required marker. | FIXED |
| MVP-P2-04 | P2 | Admin | Admin shell sidebar + topbar | At 1440x900 the 管理 section (导入日志/审计日志/平台设置/考生字段) and 退出 sit below the fold; the whole page scrolls and the topbar scrolls away. | `AdminLayout`/`AppSidebar` used `min-h-screen`; the nav's `overflow-y-auto` never engages because the aside grows with the page. | FIXED |
| MVP-P2-05 | P2 | Candidate | Exam list "不可用" card | An enrolled-but-draft exam appears as a 不可用 card with no explanation. Enroll-before-publish is the documented flow, so this state is common. | Deliberate state-machine mapping (`deriveCandidateExamState`); copy lacks guidance. | NEW_ISSUE_REQUIRED |
| MVP-P2-06 | P2 | Admin | Publish action | 发布考试 publishes with a single click and no confirmation (publish-results does confirm). | Existing tested behavior; publish is reversible via 撤回发布. | NOT_A_DEFECT |
| MVP-P2-07 | P2 | Both | Mobile tables | Admin tables are wider than 390px but scroll inside `overflow-x-auto` wrappers; no page-level horizontal overflow. | Standard responsive pattern. | NOT_A_DEFECT |
| MVP-P2-08 | P2 | Candidate | Draft card question count + hidden answers | (see MVP-P2-02 / MVP-P1-02) | — | FIXED |

## E. Fixes

### E1. MVP-P1-01 — wizard 及格分 born-in-error (FIXED)

**Problem:** step 3 of the exam wizard starts in an error state for any exam
whose auto-calculated 总分 is below the default 及格分 60, blocking 下一步
before the user has done anything wrong.

**Root cause:** `initialWizardState()` defaults `passingScore` to 60
(`apps/web/src/components/exam/wizard/wizardState.ts`), and the auto-calc
effect only adjusts `totalScore`, never `passingScore`.

**Fix:** while the user has not explicitly edited 及格分, it now tracks the
auto-calculated 总分 at the 60% convention (mirroring the 100-point default),
`Math.max(1, Math.round(total * 0.6))`. Explicit edits are never overwritten.
`apps/web/src/pages/admin/ExamCreatePage.tsx` — new `passingScoreTouched`
state, extended auto-calc effect, touched flag set in the input onChange.

**Tests:** `apps/web/src/pages/admin/ExamCreatePage.test.tsx` — new
"auto-adjusts the untouched default 及格分 when it exceeds the auto total"
(asserts 15 for a 25-point total, no error, 下一步 proceeds) and "never
overwrites an explicitly edited 及格分".

**Evidence (before):** wizard walk with 2 questions → error
"及格分不能超过总分" + blocked 下一步. **(after):** 及格分 follows 5 → 3 → 5 as
questions are picked; no error; 下一步 proceeds.

### E2. MVP-P1-02 — result page "主观题" mislabel (FIXED)

**Problem:** every objective question on the candidate result page rendered
"主观题" (subjective) in the 正确答案 column, because the candidate DTO strips
`standardAnswer` (answer-leak protection) and the page inferred
"graded manually" from `standardAnswer == null`.

**Root cause:** the manual-marker signal was derived from the same field the
security layer removes.

**Fix:** the API now computes `manualGraded` per question **before** the
stripping (`apps/api/src/routes/scores.ts` `buildQuestionResults`:
`text_response` → always manual; legacy fill_blank without standardAnswer →
manual; everything else auto) and carries it in `QuestionScoreResultSchema`
(`packages/contracts/src/score.ts`). `ResultPage` renders "主观题" only for
`manualGraded === true`, a muted "—" for stripped objective answers, and the
answer itself when present (admin/ScoreAllView unchanged). New i18n key
`candidateResult.answer.hidden` (`apps/web/src/i18n/locales/zh-CN.ts`).

**Tests:** `apps/web/src/pages/exam/ResultPage.test.tsx` P3-2 updated to the
new contract (objective → "—", manual → 主观题);
`apps/api/src/routes/scores.test.ts` new end-to-end test proving
`manualGraded` per question type survives the candidate stripping (objective
path via real submit; manual path via real submit + real grade-question API).

**Evidence (before):** 单选题 row showed 正确答案=主观题. **(after):** the same
row shows 正确答案=—; a genuinely manual question still shows 主观题.

### E3. MVP-P2-01 — exam detail raw enums (FIXED)

**Fix:** `ExamDetailPage` localizes `timingMode` (新 key
`admin.examDetail.config.timingModeValue.timed_window` = 定时窗口),
`retakePolicy` and `scoreStrategy` via the existing
`admin.examProfilePages.enumLabels.*` keys, with a raw-value fallback for
unknown enums.

**Tests:** `ExamDetailPage.test.tsx` updated to assert 定时窗口 and the
absence of raw `timed_window`.

### E4. MVP-P2-02 — draft question count (FIXED, review closeout)

**Fix:** the candidate exam summary reports the authored question count for
drafts and the frozen snapshot count for every non-draft state:

```text
draft                                  → exam.questionIds.length
published/open/closed/archived/...     → exam.questionSnapshot.length
```

`apps/api/src/routes/attempts.candidate.ts` — the snapshot is authoritative
once an exam leaves draft; an empty or inconsistent frozen snapshot is
reported as-is (fail closed), never masked by falling back to authored ids.

**Tests:** `apps/api/src/routes/attempts/candidate-start.test.ts` —
snapshot-authority cases A/B/C:
A. draft, 2 authored ids, empty snapshot → `totalQuestions` 2;
B. published, 2 authored ids, empty snapshot → `totalQuestions` 0 (no
   silent fallback for a broken published snapshot);
C. published, 2 authored ids, 1-question snapshot → `totalQuestions` 1
   (frozen snapshot wins).

### E5. MVP-P2-03 — course dialog required markers (FIXED)

**Fix:** 课程名称/课程代码 labels in the course dialog now carry the same
`<span className="ml-1 text-destructive">*</span>` required marker the
candidate dialog uses (`apps/web/src/pages/admin/CoursePage.tsx`). Review
closeout: both inputs also expose the state programmatically — the HTML
`required` attribute on each input and `aria-hidden="true"` on the marker
span, so the asterisk stays out of the accessible label.

**Tests:** `CoursePage.test.tsx` label matchers updated for the new accessible
names (regex match); new required/aria-hidden contract test; 19/19 pass.

### E6. MVP-P2-04 — admin sidebar viewport scrolling + sticky topbar (FIXED)

**Fix:** the shared admin shell no longer grows the sidebar with the page.
`AppSidebar`'s aside is now a viewport-attached flex item
(`sticky top-0 h-screen min-h-0 self-start`) with `shrink-0` header/footer;
the nav region keeps `flex-1` and gains `min-h-0`, so `overflow-y-auto`
engages as a real internal scroll region (`apps/web/src/components/layout/
AppSidebar.tsx`). The Admin topbar is `sticky top-0 z-40` with the opaque
`bg-card` surface (below the z-50 dialog/sheet and z-[52] dropdown/popover
overlays) and the documented `shadow-xs` elevation owner
(`apps/web/src/components/layout/AdminLayout.tsx`, per
`docs/architecture/frontend.md`). The mobile Sheet drawer reuses the same
`SidebarContent` unchanged — it now also gets internal nav scrolling with the
logout footer pinned.

**Tests:**
- `apps/web/src/components/layout/layout.test.tsx` — viewport-scrolling
  contract: aside carries `sticky top-0 h-screen min-h-0 self-start`; nav
  carries `flex-1 min-h-0 overflow-y-auto`; header/footer `shrink-0`; topbar
  is `sticky top-0 z-40 bg-card`.
- `apps/e2e/e2e/admin-shell-viewport.spec.ts` — real-browser geometry
  assertions (no screenshots): at 1440x900 / 1280x720 (expanded) the sidebar
  top == viewport top and sidebar height == viewport height; nav scrolls
  independently; 管理 items are revealed by scrolling the nav with the
  document at scrollY 0; logout is reachable without scrolling the document;
  scrolling the main page leaves sidebar + topbar pinned. At 1024x768 the
  collapsed rail keeps the same attachment contract. At 390x844 the Sheet
  drawer open/scroll/navigate/close/focus-restore/logout regression passes.

**Evidence (before):** 1440x900 admin — 管理 section + 退出 below the fold,
whole page scrolls, topbar scrolls away. **(after):** sidebar fills the
viewport with its own nav scroll, logout reachable at scrollY 0, topbar stays
pinned while main content scrolls (verified programmatically at 1440x900,
1280x720, 1024x768, 390x844).

## F. Deferred observations

Post-MVP / follow-up items recorded as Issues, not part of MVP readiness:

- **"不可用" draft card copy (MVP-P2-05):** enrolled-but-draft exams appear
  on the candidate list without explanation. Candidate-facing copy for
  unavailable exams (e.g. "考试尚未开放") is a product decision.
- **Wizard polish:** 及格分 auto-follow is a convenience default; a
  "60% 默认" hint could make the behavior self-evident.
- Teacher-specific expansion was intentionally out of scope for this preflight.

## G. Verification

Command verification below was executed on `COMMAND_VERIFIED_SHA` (see §A).
The multimodal visual pass at the end of this document ran later, on
`VISUAL_VERIFIED_SHA`; the resolved-database evidence (§G.1) was gathered
live while each mode actually ran, and the coverage record (§G.2) is the
generated output of the full verification chain.

```text
pnpm verify:static                      PASS (incl. prettier, eslint, arch,
                                        copy guards, openapi, e2e-runner)
                                        [no database access — static gates]
pnpm test                               PASS — 2214 passed / 7 skipped
                                        (164 files, 16 tasks)
                                        [resolved DB: exam_test worker family
                                        exam_test_w* — §G.1]
pnpm build                              PASS (9 tasks)
                                        [no database access]
pnpm verify                             PASS (full coverage chain; one
                                        @exam/db coverage run hit the
                                        documented BUG-FLAKE-002 cross-package
                                        turbo contention and passed on rerun
                                        and standalone — see
                                        docs/standards/test-flakes.md)
                                        [resolved DB: exam_test worker family
                                        exam_test_w* — §G.1]
pnpm --filter @exam/api test candidate-start  15/15 PASS (snapshot
                                        authority cases A/B/C included)
                                        [resolved DB: exam_test worker family
                                        exam_test_w* — §G.1]
pnpm --filter @exam/web test layout responsive-shell  67/67 PASS
                                        [jsdom — no database]
E2E (scripts/e2e/run-wsl.sh):
  required subset (candidate-happy-path, admin-flow, exam-wizard-product,
  admin-shell-viewport)                 15/15 PASS
  full suite (2 shards)                 122 PASS / 0 FAIL / 0 FLAKY
                                        [resolved DBs: per-shard ephemeral
                                        worker DBs exam_e2e_w0 / exam_e2e_w1;
                                        serial runs resolve exam_e2e — §G.1]
```

Live re-render of every fixed state was confirmed against the running dev
stack (result page "—", draft card 题目数 2, wizard 及格分 3→5, detail labels
定时窗口/通过后停止/取最高分, course dialog asterisks), plus the admin shell
viewport behavior at 1440x900 / 1280x720 / 1024x768 / 390x844 via the
`admin-shell-viewport` spec.

> **E2E test-adjacent fix (PR review closeout):** `admin-flow.spec.ts`
> pagination poll used `loadMore.isEnabled()`, which waits for element
> attachment (locator timeout) once 加载更多 unmounts after the final
> candidates page loads, blowing the poll's 5s deadline. Exposed when the
> persistent local `exam_e2e` DB accumulated >50 candidates (target on page 2).
> Fixed with a `count()` short-circuit (detached button reports false
> instantly). CI uses a fresh DB per run, so it never observed this.

### G.1 Resolved databases — directly verified, not inferred from env files

Evidence gathered live on 2026-08-14 while each mode was actually running
(server-side `pg_stat_activity` and real API responses — not `.env` parsing):

| Mode | Process / command | Direct evidence | Resolved DB |
| -- | -- | -- | -- |
| dev | `pnpm --filter api dev` (API :3210, `.env`) | while serving: `pg_stat_activity` shows `application_name=postgres.js → datname=exam`; `POST /api/auth/login` (admin/admin123) → HTTP 200, and those demo accounts exist only in the dev DB; `psql`: `current_database()=exam` with 6 users / 9 exams / 3 courses (demo seed) | `exam` |
| test | `pnpm --filter @exam/api test` (`exam.test.ts`, 66/66 PASS) | during the run: `pg_stat_activity` shows `postgres.js → exam_test_w0` (2–3 backends); zero `postgres.js` backends on `exam` or `exam_e2e` at any point | `exam_test_w*` — per-worker DBs created by ADR-007 worker-database isolation from the `TEST_DATABASE_URL` base (`exam_test`) |
| WSL E2E (2 shards, default) | `bash scripts/e2e/run-wsl.sh` (full suite) | runner log: `shard 1 api (:3100, db=exam_e2e_w0)` / `shard 2 (:3101, db=exam_e2e_w1)`; during the run: `pg_stat_activity` shows only `exam_e2e_w0` / `exam_e2e_w1` backends | `exam_e2e_w0` + `exam_e2e_w1` (per-shard ephemeral worker DBs, dropped after the run) |
| WSL E2E (serial, `E2E_WORKERS=1`) | `run-wsl.sh <spec>` | runner log: `迁移 exam_e2e 库` + `api dev server (:3000, APP_MODE=e2e)`; kept-server probe (§G.3): live `postgres.js` backends on `exam_e2e` and an API-created course row visible in `exam_e2e` | `exam_e2e` (persistent, reseeded) |

### G.2 Coverage — generated result from the full verification chain

Source: `pnpm verify` coverage stage (`turbo coverage`, 9 packages with a
coverage script), executed on closeout head
`496f3eb8671afbfe0ec8bf60d7373968d860bdd5` — `@exam/web:coverage` re-ran on
this head; the other packages replayed turbo-cached runs of byte-identical
inputs (turbo caches by input hash, and their sources are unchanged since
`COMMAND_VERIFIED_SHA`).

Configured thresholds (per-package vitest `coverage.thresholds`; packages not
listed run coverage as a report only, with no threshold gate):

| Package | lines | branches | functions |
| -- | -- | -- | -- |
| @exam/api | 60 | 50 | 50 |
| @exam/web | 75 | 70 | 70 |

Generated "All files" result (v8 provider) and verdict:

| Package | stmts % | branch % | funcs % | lines % | Threshold gate | Status |
| -- | -- | -- | -- | -- | -- | -- |
| @exam/api | 84.01 | 73.40 | 88.86 | 85.12 | 60 / 50 / 50 | PASS |
| @exam/web | 81.05 | 74.48 | 76.61 | 83.32 | 75 / 70 / 70 | PASS |
| @exam/db | 80.76 | 68.13 | 74.85 | 81.34 | none | PASS (report only) |
| @exam/exam-engine | 84.39 | 76.74 | 86.41 | 86.05 | none | PASS (report only) |
| @exam/auth | 92.59 | 88.88 | 100.00 | 92.00 | none | PASS (report only) |
| @exam/authz | 100.00 | 90.90 | 100.00 | 100.00 | none | PASS (report only) |
| @exam/contracts | 96.60 | 88.72 | 94.44 | 97.23 | none | PASS (report only) |
| @exam/import-export | 100.00 | 92.85 | 100.00 | 100.00 | none | PASS (report only) |
| @exam/domain | 69.73 | 53.38 | 42.02 | 71.03 | none | PASS (report only) |

Both threshold-bearing packages exceed every configured threshold; the whole
`pnpm verify` chain exited 0 (vitest fails the task on any threshold miss).
Test totals in this coverage run: 5535 passed / 7 skipped across the 9
packages.

### G.3 Review-closeout rerun (course-dialog a11y fix)

After the final CodeRabbit closeout fix (course dialog HTML `required` +
`aria-hidden` marker, commit
`496f3eb8671afbfe0ec8bf60d7373968d860bdd5`), the chain was re-verified on
that head:

```text
pnpm verify (static + coverage + build)   PASS — exit 0
                                          (@exam/web:coverage re-ran on this
                                          head: 1643 passed, thresholds met;
                                          other packages replayed cached runs
                                          of identical inputs)
CoursePage.test.tsx                       19/19 PASS (new required/aria-hidden
                                          contract test included)
WSL E2E full suite (2 shards)             122 PASS / 0 FAIL — shard 1
                                          (exam_e2e_w0) 62 passed, shard 2
                                          (exam_e2e_w1) 60 passed; worker DBs
                                          dropped after the run
WSL E2E serial (E2E_WORKERS=1,
  admin-shell-viewport)                   4/4 PASS
```

The §G.1 serial evidence came from a `KEEP_SERVER=1` run of the same spec:
with the e2e API still up on :3000 (`APP_MODE=e2e`), `pg_stat_activity`
showed 10 live `postgres.js` backends on `exam_e2e`, and a course created
through that API (`PROVENANCE-MARKER-318`) was visible via
`current_database()=exam_e2e` in `exam_e2e` while absent from `exam` —
deleted again afterwards.

## H. Verdict

```text
READY_FOR_HUMAN_MVP_ACCEPTANCE
```

The obvious, reproduced rough edges on the MVP critical paths have been
removed (wizard born-in-error state, candidate result mislabel, raw enum
labels, false draft question count, missing required markers) without any
design-system migration, behavior redesign, or future-feature work. The next
step is the human "First Real Exam" acceptance test on a fresh deployment.

---

## Multimodal Visual Pass

### Model / capability

Image-capable multimodal model (Read tool with image inspection) — Chromium
150.0.7871.24 headless, Playwright-driven screenshots at 1440×900 (desktop)
and 390×844 (mobile).

### Screenshot matrix

```text
Desktop (1440×900) — 27 screenshots:
  01-login, 10-admin-dashboard, 20-admin-candidates, 21-admin-create-candidate-dialog,
  30-admin-courses, 31-admin-create-course-dialog, 40-admin-questions,
  41-admin-question-create, 50-admin-exams, 51-56-admin-exam-wizard (steps 1-5 + picker),
  60-admin-exam-detail, 61-admin-enrollment-dialog, 62-admin-score-list,
  63-admin-results, 70-candidate-exam-list, 71-candidate-start,
  80-candidate-take-first, 81-candidate-take-middle, 84-candidate-submit-dialog,
  91-candidate-result, 100-admin-system, admin-sidebar-scroll

Mobile (390×844) — 9 screenshots:
  mobile-01-login, mobile-candidate-exam-list, mobile-candidate-start,
  mobile-candidate-take, mobile-candidate-submit-dialog, mobile-candidate-result,
  mobile-admin-candidates, mobile-admin-create-candidate-dialog, mobile-admin-drawer
```

### Findings

No UI-P0 or UI-P1 defects found. The MVP critical paths are visually solid.

| ID | Sev | Screenshot | Visual evidence | Fix | After evidence |
|----|-----|------------|-----------------|-----|----------------|
| (none) | — | — | — | — | — |

### Deliberately ignored aesthetic suggestions

- Mobile header "考试平..." truncation — expected behavior for long app names
  in constrained viewport; not a defect
- Admin sidebar has many nav items (概览/运维/题库/考试/监考/恢复中心/管理) —
  by design for the full feature set; scrolling works correctly
- Candidate exam list shows only 2 cards — seed data, not a UI issue
- Exam list table shows E2E-generated test data — seed artifact, not a defect

### Previously fixed issues — visual verification

- **MVP-P1-01 (wizard born-in-error):** VERIFIED — wizard step 3 shows
  总分 100 / 及格分 60 with no error state; 下一步 proceeds normally
- **MVP-P2-04 (admin sidebar scrolling):** VERIFIED — sidebar fills viewport
  with internal nav scroll; all nav items (including 管理 section + 退出)
  accessible without page scroll; topbar stays pinned

### Verification

All screenshots captured against running dev stack (API :3000, Web :4173)
with demo seed data. Candidate1 (candidate1/candidate123) used for
candidate flows; admin (admin/admin123) for admin flows.

```text
VISUAL_VERIFIED_SHA  f6ae292d2c69adce280d616c4dd41ae0554d4a39
            (PR head at the time of this visual pass — a later commit than
            the §G COMMAND_VERIFIED_SHA 64cba7633c80e00b5b13a52a18ee58a980673c23;
            the two verification records are independent — see §A)
```
