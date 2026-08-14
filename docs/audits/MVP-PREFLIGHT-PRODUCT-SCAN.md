# MVP Preflight Product Scan

> One focused preflight scan of the CURRENT MVP product before the human
> performs the formal "First Real Exam" acceptance test. This is NOT a formal
> acceptance pass: it used the existing dev stack with demo/e2e data and
> fixed only the obvious, reproduced rough edges of the current MVP.

## A. Baseline

```text
BASE_SHA   2ede3303b873065af40ff82d05851586d4548e65
VERIFIED_CODE_SHA  64cba7633c80e00b5b13a52a18ee58a980673c23
            (the exact code+tests commit on which the verification in §G was
            executed; the later docs commit that writes this SHA advances the
            PR head but does not invalidate VERIFIED_CODE_SHA)
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
candidate dialog uses (`apps/web/src/pages/admin/CoursePage.tsx`).

**Tests:** `CoursePage.test.tsx` label matchers updated for the new accessible
names (regex match); 18/18 pass.

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

All verification below was executed on `VERIFIED_CODE_SHA` (see §A).

```text
pnpm verify:static                      PASS (incl. prettier, eslint, arch,
                                        copy guards, openapi, e2e-runner)
pnpm test                               PASS — 2214 passed / 7 skipped
                                        (164 files, 16 tasks)
pnpm build                              PASS (9 tasks)
pnpm verify                             PASS (full coverage chain; one
                                        @exam/db coverage run hit the
                                        documented BUG-FLAKE-002 cross-package
                                        turbo contention and passed on rerun
                                        and standalone — see
                                        docs/standards/test-flakes.md)
pnpm --filter @exam/api test candidate-start  15/15 PASS (snapshot
                                        authority cases A/B/C included)
pnpm --filter @exam/web test layout responsive-shell  67/67 PASS
E2E (scripts/e2e/run-wsl.sh):
  required subset (candidate-happy-path, admin-flow, exam-wizard-product,
  admin-shell-viewport)                 15/15 PASS
  full suite (2 shards)                 122 PASS / 0 FAIL / 0 FLAKY
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

## H. Verdict

```text
READY_FOR_HUMAN_MVP_ACCEPTANCE
```

The obvious, reproduced rough edges on the MVP critical paths have been
removed (wizard born-in-error state, candidate result mislabel, raw enum
labels, false draft question count, missing required markers) without any
design-system migration, behavior redesign, or future-feature work. The next
step is the human "First Real Exam" acceptance test on a fresh deployment.
