# Candidate Exam State — Correctness Audit

**Audit date**: 2026-06-16
**Auditor**: Architecture audit agent (read-only, no code changes)
**Scope**: Candidate exam lifecycle — list → start → take → submit → result
**Verdict source**: repository evidence only (routes, engine, repos, schema, seed, frontend pages). No code modified, no tests run, no seed mutated.

---

## 1. Summary

**结论：`partial`**

核心状态机在后端是**正确且强制执行的**（`startAttempt` 真正检查 `maxAttempts` / window / active attempt 并抛 `MaxAttemptsReachedError` 等），所以 "已考 2/2 次的考试" 在后端**无法真正开考**。但**列表/详情 API 返回的状态字段不足以让前端做正确分类**，前端被迫用 `isAvailable` / `isEnded` 两个布尔推断，导致：

- 次数用尽的考试仍出现在 "可参加考试"（后端 `isAvailable` 只看 status+window，不看 attempts）
- 进行中 / 断线可恢复 / 已提交待评分 / 已出成绩 没有区分桶
- 详情页没有 bestScore / latestAttemptStatus，已考过也无法展示历史成绩
- `findActive*` 只匹配 `in_progress`，**不匹配 `disrupted`** → candidate3 的 "断线恢复" seed 实际无法恢复，重新 start 会创建第 2 次尝试（次发 bug，P0）

UI 层的三个视觉问题（sidebar 间距、navigator 图例、确认弹窗标记数）是**展示层未实现**，不是状态合同错误，但 navigator 图例缺失导致状态映射对考生不可见，属 P1。

**允许进入下一步判断见 §8。**

---

## 2. Current API Matrix

证据来源：
- `apps/api/src/routes/attempts.ts:368-471`（list + detail）
- `apps/api/src/routes/attempts.ts:496-572`（start）
- `apps/api/src/routes/attempts.ts:732-846`（submit + grade）
- `apps/api/src/routes/scores.ts:195-245`（result）
- `packages/contracts/src/attempt.ts:188-215`（CandidateExamDetailResponseSchema）
- `packages/exam-engine/src/attemptCommands.ts:60-136`（startAttempt 强制项）

| API | Returned State Fields | Missing Fields | Backend Enforced? | Frontend Depends On |
| --- | --- | --- | --- | --- |
| `GET /candidate/exams` (list) | `attemptCount`, `maxAttempts`, `finalScore`, `finalPassed`, `finalAttemptId`, `isAvailable`, `isEnded` | `availabilityStatus`, `primaryAction`, `latestAttemptId`, `latestAttemptStatus`, `bestScore`(独立于 finalScore), `activeAttemptId`, `canResume`, `canViewResult` | **部分**。`isAvailable` 仅由 `exam.status in (published,open) && openAt<=now<closeAt` 计算（attempts.ts:402-405），**不含 attempts/maxAttempts/activeAttempt**。`isEnded = now>=closeAt`。 | `ExamListPage` 仅按 `isAvailable` / `isEnded` 分两桶（ExamListPage.tsx:138-173） |
| `GET /candidate/exams/:examId` (detail) | `currentAttempts`, `maxAttempts`, `activeAttemptId`(仅 in_progress), `canStartNewAttempt`, `blockingReason`(`max_attempts_reached`/`already_passed`) | `bestScore`, `latestAttemptId`, `latestAttemptStatus`, `availabilityStatus`, `primaryAction`, `windowStartAt/EndAt`, `resumableAttemptId` | **是**（`canStartNewAttempt` + `blockingReason` 由 `buildCandidateExamDetail` 计算，attempts.ts:325-366）。但 `activeAttemptId` 仅当 `findActiveByExamAndCandidate` 命中 `in_progress` 时返回（**disrupted 不命中**）。 | `StartExamPage` 用 `canStartNewAttempt`/`blockingReason`/`activeAttemptId` 决定按钮（StartExamPage.tsx:86-121）。**无历史成绩显示**。 |
| `POST /attempts/:examId/start` | 返回完整 `LoadAttemptResponse` | — | **是，强制**。engine `startAttempt` 检查：(1) exam.status ∈ {published,open}；(2) `now<openAt \|\| now>=closeAt` → `ExamNotOpenError`；(3) 已有 active attempt → 直接返回（**仅 in_progress**）；(4) `retakePolicy=max_attempts && attemptCount>=maxAttempts` → `MaxAttemptsReachedError`；(5) `pass_then_stop && finalPassed` → `ExamAlreadyPassedError`（attemptCommands.ts:60-108）。 | `StartExamPage` catch `MAX_ATTEMPTS_REACHED`/`EXAM_ALREADY_PASSED`/`EXAM_NOT_OPEN`（StartExamPage.tsx:64-83）。 |
| `GET /attempts/:id` (load/take) | `status`, `answers`, `questionSnapshot`, `deadlineAt`, `score`(graded), `passed` | — | 是（按 attemptId 归属校验，getOwnedAttempt） | `TakeExamPage` 若 `status!==in_progress` 立即跳 result（TakeExamPage.tsx:117-120）。**disrupted 不在 take 页处理**——会直接跳走。 |
| `POST /attempts/:attemptId/submit` | graded 后返回带 score/passed 的 attempt | — | 是。`in_progress`/`disrupted` → `submitted` → 同步 grade → `graded`（attempts.ts:766-827） | `TakeExamPage` 提交后 navigate result |
| `POST /attempts/:attemptId/restore` | restored attempt (in_progress) | — | 是（engine `restoreAttempt`，`disrupted→in_progress`） | **无前端入口调用 restore**。candidate3 无法触发恢复。 |
| `GET /scores/attempts/:attemptId` (result) | `showResultImmediately`, `totalScore`, `passed`, `questionResults` 或 "已提交等待评分" 文案 | best/历史 attempt 列表 | 是。Candidate 看 `showResultImmediately`，false 时只给状态文案（scores.ts:225-237） | `ResultPage` 按 `showResultImmediately` 分支（ResultPage.tsx:89-194） |

**关键缺口**：没有任何 API 返回 `availabilityStatus` / `primaryAction` / `latestAttemptStatus` / `bestScore`（独立于 enrollment.finalScore）。前端只能在 detail 页靠 `canStartNewAttempt`+`blockingReason`+`activeAttemptId` 三个字段拼，列表页只有两个布尔。

---

## 3. Seed Account Matrix

证据来源：`packages/db/src/demo-seed.ts:891-1141` + `packages/db/src/demo-seed-verify.ts`。

| Account | Expected State (说明) | Actual State (seed) | Status | Notes |
| ------- | -------------------- | ------------------ | ------ | ----- |
| `candidate1` | 进行中的考试 | enrollOpen1: exam1(安全培训考核 A, open, window 内) attemptCount=1, status=started；attempt#1 `in_progress`, deadlineAt=+20min | ✅ 符合 | list: isAvailable=true（仅看 window）。detail: activeAttemptId 返回，canStartNewAttempt=false（有 active）。StartExam 显示 "继续考试"。**正确**。 |
| `candidate2` | 可开始考试 | enrollOpen2: exam1 attemptCount=0, status=assigned；无 attempt 记录 | ✅ 符合 | list: isAvailable=true。detail: canStartNewAttempt=true。StartExam 显示 "开始考试"。**正确**。 |
| `candidate3` | 断线恢复 | enrollOpen3: exam1 attemptCount=1, status=started；attempt#1 **`disrupted`** | ⚠️ **seed 符合描述，但运行时行为错** | `findActiveByExamAndCandidate` 只查 `in_progress`（attemptRepo.ts:109-127），**不命中 disrupted**。后果：(a) detail `activeAttemptId=undefined`，不显示 "继续"；(b) StartExam 调 `/start` → engine 也用 `findActiveByEnrollment`(只 in_progress) 未命中 → `attemptCount(1)>=maxAttempts(2)` 为 false → **创建 attempt#2**，原 disrupted 答案丢失上下文。**P0**：断线恢复链路在 candidate 侧实际不可达，restore API 无前端调用点。 |
| `candidate4` | 已出成绩 | enrollOpen4: exam1 attemptCount=1, status=completed；attempt#1 `graded`, score=openC4Grading.totalScore, passed；**但 enrollment 未写 finalScore/finalPassed/finalAttemptId**（demo-seed.ts:909-913） | ⚠️ **部分符合** | list: isAvailable=true（window 内，status=open）→ **仍出现在 "可参加考试"**，且 `finalScore=null`（ExamCard 不显示成绩 Badge，需 `finalPassed` truthy，ExamListPage.tsx:54-59）。detail: canStartNewAttempt=true（attemptCount 1<2，无 active，未 passed）→ 可再考。**这是用户报告的根因之一**：已出成绩的考试未被识别为已完成/已出成绩，且 seed 没回写 enrollment 决算字段。 |
| "已考 2/2 次" (candidate1 on exam4 技能认证历史考试) | 已结束 / 次数用尽 | enrollClosed1: exam4(closed, window 已过) attemptCount=2, finalScore=highest, finalPassed | ⚠️ **分类错** | list: `isEnded=true`（now>=closeAt）→ 落 "已结束" 桶，**不**在 "可参加"。**但用户报告出现在 "可参加"** —— 用户指的是 exam1(安全培训考核 A) 对某 candidate 已考 2/2。exam1 maxAttempts=2，seed 中无人对 exam1 考过 2 次（c1/c3 各 1 次未交，c4 1 次已 graded）。**用户观察到的 "已考 2/2 仍在可参加" 来自运行时真实作答后**：candidate 把 exam1 考满 2 次后，`isAvailable` 仍只看 window（24h 内仍 true），所以仍显示 "开始考试"，**点进去 detail 才知 blockingReason=max_attempts_reached**（StartExamPage.tsx:111-121 会显示文案，但列表层已误导）。**P0**：list 层缺少 attempts 维度。 |

**seed 验证脚本**（demo-seed-verify.ts）只校验 "存在性 + finalScore=highest"（§18，仅对 closed exam 的 c1），**未校验**：
- candidate4 的 open exam enrollment 是否回写 finalScore（实际未回写）
- candidate3 的 disrupted attempt 是否可被恢复路径命中
- list API 对各 candidate 的分类是否符合预期桶

**结论**：seed 数据本身 "存在且符合字段描述"，但 (a) candidate4 enrollment 缺决算字段、(b) candidate3 恢复链路不可达、(c) list 分类规则不含 attempts，三者叠加造成 UI 误导。**未伪造 seed 通过**，但 seed 验证覆盖度不足。

---

## 4. Exam Availability Classification Matrix

`now` = 当前时间。预期分类基于考生视角的合理 UX；当前行为基于代码实证。

| Condition | Expected Category | Expected Action | Backend Enforcement (list/detail) | Current Behavior |
| --------- | ----------------- | --------------- | --------------------------------- | ---------------- |
| 无 attempt, window 内, 次数未满 | available | start | list `isAvailable=true`；detail `canStartNewAttempt=true` | ✅ 一致 |
| 进行中 attempt (in_progress) | in_progress | resume | detail 返回 `activeAttemptId`；list **无此桶**（仍 isAvailable=true，按钮="开始"→实际 navigate take） | ⚠️ list 层不区分，按钮文案错（显示 "开始考试" 而非 "继续"） |
| 断线 / 可恢复 attempt (disrupted) | resumable | resume (restore) | **detail 不返回 activeAttemptId**（findActive 不含 disrupted）；list 无桶 | ❌ **不可达**。前端无 restore 入口，/start 会建新 attempt。 |
| 已提交待评分 (submitted, 未 graded) | submitted_pending_grade | view_result (等待) | attempt 级 status 存在，但 list/detail **不暴露 latestAttemptStatus**；result API 给 "已提交等待评分" 文案 | ⚠️ list 仍可能 isAvailable=true（若 window 未过且次数未满），误导 |
| 已出成绩 (graded) | graded | view_result / view_history | enrollment.finalScore/finalPassed/finalAttemptId 存在时 list 返回，但 `isAvailable` 不据此变 false；detail 无 bestScore 字段 | ❌ 若 window 内且次数未满，仍落 "可参加"；candidate4 因 seed 未回写决算字段，连 Badge 都不显示 |
| attemptsUsed < maxAttempts (未满) | available / in_progress | start / resume | list `isAvailable` **不含 attempts 判断** | ❌ 次数将满但未满时，list 无法提示 "最后一次" |
| attemptsUsed >= maxAttempts (用尽) | max_attempts_exhausted | view_result / none | list `isAvailable` **不含此判断**；detail `blockingReason=max_attempts_reached`、`canStartNewAttempt=false` | ❌ **list 仍显示 "开始考试"**，点进去才报错。用户报告根因。 |
| 窗口开始前 (now < openAt) | not_started_yet | none | list `isAvailable=false`（now<openAt）；`isEnded=false` → **既不在 available 也不在 ended，列表直接不显示** | ⚠️ 考生看不到 "即将开始" 的考试（ExamListPage 只渲染 available+ended 两桶） |
| 窗口结束后 (now >= closeAt) | expired | view_result(若有) / none | list `isEnded=true` → 落 "已结束" 桶；若有 finalAttemptId 显示 "查看结果" | ✅ 基本一致，但若未交卷（无 finalAttemptId）则无按钮 |
| 不在窗口且 status=draft | unavailable | none | list 不返回 draft（candidate 只看 enrolled exams，draft 通常未 enroll） | ✅ |

**核心结论**：`isAvailable` / `isEnded` 二元分类无法覆盖 9 种状态中的 6 种。必须由后端输出 `availabilityStatus` 枚举。

---

## 5. UI Gap List

证据：`apps/web/src/pages/exam/*`, `apps/web/src/components/exam/QuestionNavigator.tsx`, `apps/web/src/components/layout/AppSidebar.tsx`。

| Page | Gap | Risk | Blocking? | Suggested Fix |
| ---- | --- | ---- | --------- | ------------- |
| `ExamListPage` | 只有 `available` / `ended` 两桶；无 `in_progress` / `resumable` / `graded` / `max_attempts_exhausted` / `not_started_yet` 桶；按钮文案不区分 resume/view_result | 考生误点、找不到进行中考试、已考满仍显示开始 | **P0**（E2E blocking） | 改用后端 `availabilityStatus` 分桶；按钮用 `primaryAction` |
| `ExamListPage` (ExamCard) | 成绩 Badge 只在 `finalPassed` truthy 时显示 `finalScore`（ExamListPage.tsx:54-59）；不显示 bestScore / 最近成绩 / 未通过成绩 | 已考未过、已出成绩但 finalPassed=false 的考生看不到任何成绩入口 | P1 | 用 `bestScore` + `latestAttemptStatus` 展示 |
| `StartExamPage` | 已考过无任何历史成绩显示（无 bestScore 字段，UI 也未读） | 考生不知上次成绩，体验差 | P1 | detail 增 `bestScore`/`latestAttemptStatus`，UI 展示 |
| `StartExamPage` | candidate3（disrupted）不显示 "恢复考试"，因为 `activeAttemptId` 未返回；UI 也无 restore 调用 | 断线恢复链路对 candidate 不可达 | **P0** | detail 返回 `resumableAttemptId`；UI 调 `/restore` |
| `TakeExamPage` | 进入时若 `status!==in_progress` 直接跳 result（TakeExamPage.tsx:117-120）；**disrupted 状态会跳走**，但实际应提示恢复 | 断线考生被踢出 | P1 | 允许 disrupted 进入并提示 restore |
| `QuestionNavigator` | legend `<span>未作答/已作答/已标记</span>` 只是纯文字（QuestionNavigator.tsx:81-85），**无色块 swatch 映射**三种 stateMeta 颜色 | 考生看不懂题号颜色含义（用户报告问题 2） | P1 | legend 每项前置一个对应 stateMeta 的小色块 |
| `QuestionNavigator` | 只有 `unanswered/answered/flagged` 三态；**无 `unsaved` / `saveFailed`** 表达 | 保存失败/未保存的题无法在导航定位 | P1 | 扩展 navigator state 或在 swatch 旁加保存状态指示 |
| 提交确认弹窗 | 能显示 "有 N 题已标记"（TakeExamPage.tsx:548-552），但未显示 "未保存/保存失败" 的题号定位 | 考生不知哪些题保存失败 | P2 | 弹窗列出失败题号或可跳转 |
| `ResultPage` | 只能从 list 的 "查看结果" 或 take 提交后进入；无 "历史成绩/历次尝试" 入口 | 多次尝试无对比 | P2（Phase1 可接受） | Phase2 view_history |
| `AppSidebar`（admin） | nav item 间无 padding/margin，hover/active 背景紧贴（AppSidebar.tsx:149 `gap-1` + 无 my-） | 视觉差（用户报告问题 1） | P2（非状态合同问题） | nav 容器 `gap-1`→`gap-1.5` 或 link 加 `my-0.5`；或 section 间加 py |

---

## 6. Backend Gap List

| Area | Gap | Risk | Blocking? | Suggested Fix |
| ---- | --- | ---- | --------- | ------------- |
| `GET /candidate/exams` list | `isAvailable` 不含 attempts/active/graded 维度（attempts.ts:402-405） | 已考满/已出成绩仍标 available | **P0** | 改返回 `availabilityStatus` + `primaryAction`（见 §合同缺口） |
| `GET /candidate/exams` list | 不返回 `activeAttemptId` / `resumableAttemptId` / `latestAttemptId` / `latestAttemptStatus` / `bestScore` | 前端无法正确分桶与展示 | **P0** | 同上，统一进 CandidateExamSummary |
| `GET /candidate/exams/:examId` detail | 无 `bestScore` / `latestAttemptStatus` / `windowStartAt/EndAt` / `resumableAttemptId` | 已考无成绩显示，disrupted 不可恢复 | **P0** | 扩 CandidateExamDetailResponse 或与 list 合并为 CandidateExamSummary |
| `attemptRepo.findActiveBy*` | 只匹配 `status=in_progress`，**不含 `disrupted`**（attemptRepo.ts:39-55, 109-127） | disrupted attempt 不可恢复，/start 建新 attempt 覆盖上下文 | **P0** | findActive 改为 `in('in_progress','disrupted')`，或新增 findResumable；engine startAttempt 同步 |
| `startAttempt` (engine) | 用 `findActiveByEnrollment`（只 in_progress）跳过 active；disrupted 会被当新建 | 同上 | **P0** | 同上，"active" 应含 disrupted |
| restore 路径 | `/attempts/:id/restore` 存在且 engine 正确（disrupted→in_progress），但**无前端调用点**，且 list/detail 不暴露 resumableAttemptId | 断线恢复全链路断裂 | **P0** | 前端 StartExam 在 `resumableAttemptId` 时调 restore |
| seed (candidate4, open exam) | enrollOpen4 未回写 `finalScore/finalPassed/finalAttemptId`（demo-seed.ts:909-913），尽管 attempt#1 已 graded | list 不显示成绩 Badge，分类不准 | P1 | seed 回写决算字段（按 scoreStrategy=highest） |
| seed verify | 未校验 candidate3 恢复可达、candidate4 决算回写、list 分类正确 | seed "通过" 但行为错 | P1 | 扩展 verify 断言 |
| submit | 同步 grade 正确；但 `submitted` 中间态在 list 不可见（无 latestAttemptStatus） | 考生看不到 "待评分" | P1 | 同 CandidateExamSummary |
| `showResultImmediately=false` | result API 正确返回等待文案；但 list 不反映 "submitted_pending_grade" | 同上 | P1 | 同上 |

---

## 7. Test Gap List

证据：`apps/api/src/routes/attempts.test.ts`, `smoke.test.ts`, `candidateInvariant.test.ts`；`apps/web` 各 *.test.tsx。

| Missing Test | Layer | Why Needed |
| ------------ | ----- | ---------- |
| list API：attemptsUsed>=maxAttempts 且 window 内 → 应非 available（当前会失败） | api integration | 锁定 P0：分类不含 attempts |
| list API：graded enrollment（finalPassed true/false）在 window 内 → 应落 graded 桶，非 available | api integration | 锁定 candidate4 场景 |
| list API：disrupted attempt 存在 → 应返回 resumableAttemptId 且 availabilityStatus=resumable | api integration | 锁定 candidate3 恢复链路 |
| detail API：返回 bestScore / latestAttemptStatus / resumableAttemptId | api contract | 合同变更回归 |
| start API：已有 disrupted attempt 时 /start 应返回该 attempt（恢复）而非新建 attempt#2 | api integration | 锁定 findActive 含 disrupted 的修复 |
| restore API：candidate 自助恢复端到端（前端→restore→take） | e2e | 锁定全链路 |
| seed verify：candidate4 open exam enrollment finalScore 回写 | seed | 防止 seed 退化 |
| seed verify：candidate3 disrupted attempt 可被 findResumable 命中 | seed | 防止恢复链路退化 |
| ExamListPage：渲染 availabilityStatus 多桶（in_progress/graded/exhausted/not_started_yet） | component | 前端合同消费回归 |
| StartExamPage：显示 bestScore；disrupted 显示 "恢复考试" 按钮 | component | 前端合同消费回归 |
| QuestionNavigator：legend 含色块 swatch；保存失败态可见 | component | 展示层回归 |
| AppSidebar：item 间视觉间距快照 | component（visual） | 防止回归（可选） |

---

## 8. Final Decision

**不可以直接进入 E2E 编写（candidate exam flow）。必须先修 P0。**

理由：当前 candidate exam 的状态分类在 list 层是错的（次数用尽/已出成绩/断线恢复都不正确呈现），写 E2E 只会固化错误行为或大面积失败。具体阻断项：

**P0（必须先修，才能写 candidate exam flow E2E）**：
1. 后端 list/detail 改为返回 `availabilityStatus` + `primaryAction` + `latestAttemptId` + `latestAttemptStatus` + `bestScore` + `resumableAttemptId`（即落地 §合同缺口的 CandidateExamSummary）。
2. `attemptRepo.findActiveBy*` 与 engine `startAttempt` 的 "active" 判定纳入 `disrupted`，使 candidate3 恢复链路可达。
3. 前端 `ExamListPage` 按 `availabilityStatus` 分桶、按钮用 `primaryAction`；`StartExamPage` 消费 `bestScore` 与 `resumableAttemptId`（调 restore）。
4. seed：candidate4 open exam enrollment 回写决算字段；seed verify 增补上述断言。

**可以写的**：与 candidate exam state 无关的 smoke（auth、admin CRUD、health）可继续；现有 3 个 Playwright spec（happy-path / submit-flush / resume-attempt）中 **resume-attempt spec 需重新评估**——它可能依赖了错误的 "disrupted 不可达" 行为或走了 admin 介入路径，须先核对再决定是否保留。

**P1/P2（可并入同一 PR 或紧随）**：QuestionNavigator legend 色块、TakeExamPage 接纳 disrupted、AppSidebar 间距、ResultPage 历史入口（Phase2）。

---

## 9. Contract Gap — Recommended CandidateExamSummary

> 本节是修复建议，不是当前实现。落地时需同步改 `packages/contracts/src/attempt.ts` 与 list/detail 路由，并让前端消费。

当前前端被迫到处猜：`attemptsUsed < maxAttempts && now < endAt`。应由后端返回明确状态。

```ts
// packages/contracts/src/attempt.ts (建议新增)

export const CandidateExamAvailabilityStatusSchema = z.enum([
  "available",                 // 无 active attempt, window 内, 次数未满, 未通过-stop
  "in_progress",               // 有 in_progress attempt
  "resumable",                 // 有 disrupted attempt（可恢复）
  "submitted_pending_grade",   // 最近 attempt=submitted, 未 graded
  "graded",                    // 最近 attempt=graded（无论通过）
  "max_attempts_exhausted",    // attemptsUsed>=maxAttempts 且无 active
  "not_started_yet",           // now < openAt
  "expired",                   // now >= closeAt 且无 active
  "unavailable",               // 其它（如 status=draft, 未 enroll）
]);
export type CandidateExamAvailabilityStatus = z.infer<
  typeof CandidateExamAvailabilityStatusSchema
>;

export const CandidateExamPrimaryActionSchema = z.enum([
  "start",
  "resume",        // 进入 in_progress attempt
  "restore",       // 恢复 disrupted attempt（调 /restore）
  "view_result",
  "view_history",
  "none",
]);
export type CandidateExamPrimaryAction = z.infer<
  typeof CandidateExamPrimaryActionSchema
>;

export const CandidateExamSummarySchema = z.object({
  examId: z.string().uuid(),
  title: z.string(),
  windowStartAt: z.string().datetime(),
  windowEndAt: z.string().datetime(),
  durationMinutes: z.number().int().positive(),
  totalQuestions: z.number().int().min(0),
  passingScore: z.number(),
  totalScore: z.number(),
  attemptsUsed: z.number().int().min(0),
  maxAttempts: z.number().int().positive(),
  latestAttemptId: z.string().uuid().optional(),
  latestAttemptStatus: z.enum([
    "in_progress", "disrupted", "submitted", "graded",
  ]).optional(),
  activeAttemptId: z.string().uuid().optional(),      // in_progress
  resumableAttemptId: z.string().uuid().optional(),    // disrupted
  bestScore: z.number().nullable(),                    // 按 scoreStrategy 决算，null=未考过
  bestPassed: z.boolean().nullable(),
  availabilityStatus: CandidateExamAvailabilityStatusSchema,
  primaryAction: CandidateExamPrimaryActionSchema,
});
export type CandidateExamSummary = z.infer<typeof CandidateExamSummarySchema>;
```

**后端计算规则（建议在 `buildCandidateExamSummary` 单一函数内集中，禁止前端再推断）**：

```
let availabilityStatus, primaryAction
if now < openAt                       -> not_started_yet, none
else if activeAttemptId (in_progress) -> in_progress, resume
else if resumableAttemptId (disrupted)-> resumable, restore
else if latestAttemptStatus=submitted -> submitted_pending_grade, view_result
else if now >= closeAt:
   if latestAttemptId                 -> expired(graded), view_result
   else                               -> expired, none
else if attemptsUsed >= maxAttempts   -> max_attempts_exhausted,
                                           (latestAttemptId? view_result : none)
else if retakePolicy=pass_then_stop && bestPassed -> graded, view_result
else if latestAttemptStatus=graded    -> graded, start   (仍可重考)
else                                  -> available, start
```

**前端消费**：`ExamListPage` 用 `availabilityStatus` 分桶（available / in_progress+resumable / graded / max_attempts_exhausted / not_started_yet / expired），按钮 label 与 onClick 完全由 `primaryAction` 决定。前端可展示 bestScore，但**不拥有最终判断权**。

---

**Audit end. No code or tests were modified.**
