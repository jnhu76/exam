# Phase 1.7 Exam Lifecycle 全局一致性扫描

> 生成日期：2026-06-14
> 扫描范围：branch `phase1.7-config-baseline-review` (HEAD `3ff67ef`)
> 扫描员声明：本文件为证据扫描，不做最终决策，不提出大重构方案。

## 扫描的文件清单

### 后端 API 路由
- `apps/api/src/routes/exam.ts` — Exam CRUD + publish/archive + enrollment
- `apps/api/src/routes/attempts.ts` — Attempt lifecycle (start, save answer, submit, heartbeat, restore)
- `apps/api/src/routes/scores.ts` — Score/result viewing
- `apps/api/src/routes/question.ts` — Question CRUD + import
- `apps/api/src/routes/export.ts` — CSV score export

### 领域层 / Exam Engine
- `packages/domain/src/types.ts` — Domain types (Exam, ExamAttempt, AnswerRecord, etc.)
- `packages/domain/src/enums.ts` — Enum definitions (AttemptStatus, ExamStatus, ConflictReason, etc.)
- `packages/domain/src/errors.ts` — Domain error types
- `packages/domain/src/gradingEngine.ts` — Grading logic
- `packages/exam-engine/src/examCommands.ts` — publishExam, openExam, closeExam, archiveExam
- `packages/exam-engine/src/attemptCommands.ts` — startAttempt, submitAttempt, markDisrupted, restoreAttempt
- `packages/exam-engine/src/attemptStateMachine.ts` — State transition table
- `packages/exam-engine/src/answerProtocol.ts` — processSaveAnswer
- `packages/exam-engine/src/grading.ts` — readGradingSnapshot, computeGradingResult, finalizeGrading, gradeAttempt
- `packages/exam-engine/src/timer.ts` — calculateDeadlineAt, getRemainingSeconds
- `packages/exam-engine/src/systemMonitor.ts` — System health

### 契约层
- `packages/contracts/src/exam.ts` — Exam create/update schemas
- `packages/contracts/src/attempt.ts` — Attempt/answer/save schemas
- `packages/contracts/src/score.ts` — Score/result schemas
- `packages/contracts/src/common.ts` — Pagination/error schemas

### 数据库层
- `packages/db/src/repository/examRepo.ts`
- `packages/db/src/repository/attemptRepo.ts`
- `packages/db/src/repository/enrollmentRepo.ts`
- `packages/db/src/repository/candidateRepo.ts`
- `packages/db/src/repository/baseRepo.ts`
- `packages/db/src/schema/pg.ts`

### 前端
- `apps/web/src/App.tsx` — Route definitions
- `apps/web/src/lib/routes.ts` — Route path constants
- `apps/web/src/lib/examTypes.ts` — Frontend types
- `apps/web/src/lib/api.ts` — API client
- `apps/web/src/pages/admin/ExamPage.tsx` — Admin exam list
- `apps/web/src/pages/admin/ExamCreatePage.tsx` — Admin exam create
- `apps/web/src/pages/admin/ExamDetailPage.tsx` — Admin exam detail/publish/enrollment
- `apps/web/src/pages/admin/ScoreListPage.tsx` — Admin score list
- `apps/web/src/pages/admin/AttemptDetailPage.tsx` — Admin attempt detail
- `apps/web/src/pages/admin/ResultsOverviewPage.tsx` — Admin results overview
- `apps/web/src/pages/exam/ExamListPage.tsx` — Candidate exam list
- `apps/web/src/pages/exam/StartExamPage.tsx` — Candidate pre-exam/start
- `apps/web/src/pages/exam/TakeExamPage.tsx` — Candidate exam runtime
- `apps/web/src/pages/exam/ResultPage.tsx` — Candidate exam result
- `apps/web/src/components/exam/ExamConfigForm.tsx` — Exam config form
- `apps/web/src/components/exam/QuestionRenderer.tsx` — Question type dispatcher
- `apps/web/src/components/exam/SingleChoiceInput.tsx`
- `apps/web/src/components/exam/MultipleChoiceInput.tsx`
- `apps/web/src/components/exam/TrueFalseInput.tsx`
- `apps/web/src/components/exam/FillBlankInput.tsx`
- `apps/web/src/components/exam/ExamTimer.tsx`
- `apps/web/src/components/exam/SaveIndicator.tsx`
- `apps/web/src/components/exam/QuestionNav.tsx`
- `apps/web/src/components/exam/EnrollmentPicker.tsx`
- `apps/web/src/hooks/useSubmitFlush.ts`

### 测试
- `apps/api/src/routes/exam.test.ts` — Exam CRUD + publish API tests
- `apps/api/src/routes/examStateMachine.test.ts` — Exam state machine API tests
- `apps/api/src/routes/attempts.test.ts` — Attempt lifecycle API tests (29 tests)
- `apps/api/src/routes/enrollment.test.ts` — Enrollment API tests
- `apps/api/src/routes/question.test.ts` — Question CRUD + import tests
- `apps/api/src/routes/scores.test.ts` — Score/result API tests
- `apps/api/src/routes/inputValidation.test.ts` — Input validation tests
- `apps/api/tests/concurrency/attempt-concurrency.test.ts` — Concurrency tests
- `apps/api/tests/security/exam-protocol-security.test.ts` — Security baseline tests
- `packages/exam-engine/src/examCommands.test.ts`
- `packages/exam-engine/src/attemptCommands.test.ts`
- `packages/exam-engine/src/attemptStateMachine.test.ts`
- `packages/exam-engine/src/gradingEngine.test.ts`
- `packages/exam-engine/src/grading.test.ts`
- `packages/exam-engine/src/gradingRefactor.test.ts` (untracked)
- `packages/exam-engine/src/answerProtocol.test.ts`
- `packages/exam-engine/src/timer.test.ts`
- `packages/exam-engine/src/systemMonitor.test.ts`
- `packages/domain/src/__tests__/state-lifecycle.spec.ts`
- `packages/db/src/repository/attemptEnrollment.test.ts`
- `apps/web/src/pages/exam/TakeExamPage.test.tsx`
- `apps/web/src/pages/exam/StartExamPage.test.tsx`
- `apps/web/src/pages/exam/ExamListPage.test.tsx`
- `apps/web/src/pages/exam/ResultPage.test.tsx`
- `apps/web/src/pages/admin/ExamPage.test.tsx`
- `apps/web/src/pages/admin/ExamCreatePage.test.tsx`
- `apps/web/src/pages/admin/ExamDetailPage.test.tsx`
- `apps/web/src/pages/admin/AttemptDetailPage.test.tsx`
- `apps/web/src/pages/admin/ScoreListPage.test.tsx`
- `apps/web/src/pages/admin/ResultsOverviewPage.test.tsx`
- `apps/web/src/components/exam/examComponents.test.tsx`
- `apps/web/src/components/exam/ExamConfigForm.test.tsx`
- `apps/web/src/components/exam/EnrollmentPicker.test.tsx`
- `apps/web/src/components/exam/SingleChoiceInput.test.tsx`
- `apps/web/src/components/exam/MultipleChoiceInput.test.tsx`
- `apps/web/src/lib/statusMeta.test.ts`
- `apps/web/src/__tests__/integration/exam-management.integration.test.tsx`
- `packages/contracts/src/__tests__/contracts.test.ts`

### E2E
- `apps/e2e/src/api-smoke.test.ts` — Vitest API smoke tests
- `apps/e2e/src/smoke.test.ts` — Vitest core smoke tests
- `apps/e2e/src/e2e/auth.setup.ts` — Playwright auth setup
- `apps/e2e/src/e2e/auth.spec.ts` — Playwright auth browser tests
- `apps/e2e/src/e2e/browser.spec.ts` — Playwright browser nav tests

### 文档
- `docs/SPEC.md`
- `docs/todo.md`
- `docs/api/reference.md`
- `docs/dev/exam-data-chain.md`
- `docs/dev/phase1-exam-lifecycle-exit-review-2026-06-13.md` (untracked)
- `docs/archive/phase-1.7/security-completion-plan.md`
- `docs/archive/phase-1.7/security-baseline-validation.md`
- `docs/archive/phase-1.7/api-contract/` (7 files)

## 未扫描的相关文件

- `packages/domain/src/__tests__/` — 除 state-lifecycle.spec.ts 外未深入扫描
- `packages/db/src/repository/` — 未扫描 schema 变更相关（非 Exam 表）
- `apps/web/src/components/layout/` — 布局组件非直接 Exam 逻辑
- `apps/web/src/components/settings/` — 设置页面非 Exam 生命周期
- `apps/api/src/plugins/` — 插件层（auth/tenant/security）仅间接相关

---

## 1. Evidence Table

| ID | 类型 | 文件 | 行号 | 观察到的事实 | 置信度 |
| -- | -- | -- | -- | ------ | --- |
| E01 | State | `packages/domain/src/enums.ts` | 53-63 | `AttemptStatus` 枚举有 8 个值：`not_started`, `queued`, `in_progress`, `disrupted`, `submitted`, `grading`, `graded`, `voided` | High |
| E02 | State | `packages/domain/src/enums.ts` | 74-81 | `ExamStatus` 枚举有 5 个值：`draft`, `published`, `open`, `closed`, `archived` | High |
| E03 | State | `packages/domain/src/enums.ts` | 65-72 | `EnrollmentStatus` 枚举有 4 个值：`assigned`, `started`, `completed`, `blocked` | High |
| E04 | State | `packages/exam-engine/src/attemptStateMachine.ts` | 31-38 | 状态机仅定义 6 条有效迁移：`in_progress:submit→submitted`, `in_progress:disrupt→disrupted`, `disrupted:submit→submitted`, `disrupted:restore→in_progress`, `submitted:grade→grading`, `grading:complete_grading→graded` | High |
| E05 | State | `packages/exam-engine/src/attemptStateMachine.ts` | 40-58 | `transition()` 函数不再接受 `guards` 参数（因 deadline guard 已移除） | High |
| E06 | State | `packages/exam-engine/src/attemptCommands.ts` | 149-162 | `submitAttempt()` 移除了 deadline 检查，不再抛 `AttemptDeadlineExceededError` | High |
| E07 | State | `packages/exam-engine/src/answerProtocol.ts` | 47-58 | `processSaveAnswer` 中包含 `DEADLINE_EXCEEDED` 检查：当 `state.deadlineAt` 和 `state.now` 都存在且 `now > deadlineAt` 时拒绝保存 | High |
| E08 | State | `apps/api/src/routes/attempts.ts` | 648-666 | save-answer 路由处理器传入 `deadlineAt` 和 `now` 到 `processSaveAnswer` | High |
| E09 | State | `apps/api/src/routes/attempts.ts` | 775-838 | submit 路由处理器改为 4 阶段：Phase1 提交(sql tx)→Phase2 读快照(无锁)→Phase3 算分(纯 CPU)→Phase4 落库(sql tx+行锁) | High |
| E10 | State | `apps/api/src/routes/attempts.ts` | 784-796 | submit 幂等处理：`in_progress/disrupted→submitted`, `submitted→重试评分`, `graded→直接返回`, 其他状态→`InvalidStateTransitionError` | High |
| E11 | State | `packages/exam-engine/src/grading.ts` | 64-82 | `finalizeGrading()` 直接验证 `status→grade` 转换并写入 `graded`——不再经过 `grading` 中间状态 | High |
| E12 | State | `packages/exam-engine/src/grading.ts` | 103-135 | `finalizeGrading()` 内重新读取 attempt 当前状态做转换校验（不是依赖外部传入的状态），避免竞态 | High |
| E13 | State | `packages/exam-engine/src/grading.ts` | 108-112 | `finalizeGrading()` 对已 `graded` 的 attempt 返回 `false`（幂等 guard） | High |
| E14 | Endpoint | `apps/api/src/routes/attempts.ts` | 738-859 | `POST /attempts/:attemptId/submit` — 返回 `200` + `LoadAttemptResponseSchema`（含 `status: "graded"`），非 `204` 或 `409` | High |
| E15 | Endpoint | `apps/api/src/routes/attempts.ts` | 861-890 | `POST /attempts/:attemptId/heartbeat` — 返回 `{ ok: true }`（200），非 `204 No Content` | High |
| E16 | Endpoint | `apps/api/src/routes/attempts.ts` | 892-930 | `POST /attempts/:attemptId/restore` — 返回 `LoadAttemptResponseSchema`，无 deadline 检查 | High |
| E17 | Endpoint | `apps/api/src/routes/scores.ts` | 227-255 | `GET /scores/attempts/:attemptId` — Candidate 可见结果仅当 `controlFlags.showResultImmediately=true`；非 Candidate 角色始终可见 | High |
| E18 | Frontend | `apps/web/src/pages/exam/TakeExamPage.tsx` | 248-261 | 心跳每 30s 发送到 `/api/attempts/:attemptId/heartbeat`，失败仅设 `isDisconnected(true)` 显示横幅告警 | High |
| E19 | Frontend | `apps/web/src/pages/exam/TakeExamPage.tsx` | N/A | **`restore` 路径不存在**——整个文件中无 `restore` 或 `disrupted` 相关调用 | High |
| E20 | Frontend | `apps/web/src/pages/exam/TakeExamPage.tsx` | 342-377 | 新增 `saveRejection` alert，根据 `reason` 显示不同消息（`DEADLINE_EXCEEDED`/`ATTEMPT_ALREADY_SUBMITTED`/`ATTEMPT_CLOSED`/fallback） | High |
| E21 | Docs | `docs/api/reference.md` | 935 | submit 响应样例从 `"status": "completed"` 改为 `"status": "graded"` | High |
| E22 | Docs | `docs/api/reference.md` | 944 | 新增 Phase 1 语义说明：submit 不受 deadline 限制，幂等处理 submitted/graded | High |
| E23 | Docs | `docs/api/reference.md` | 946-950 | Heartbeat 仍被文档记载为 `204 No Content`（实际路由返回 `{ ok: true }` 200） | High |
| E24 | Docs | `docs/api/reference.md` | 911-922 | Save-answer 冲突错误仍被文档记载为自然语言 `"Server has newer version"`（实际代码用 `STALE_VERSION` code） | High |
| E25 | Test | `apps/api/src/routes/attempts.test.ts` | 703-718 | 原 "rejects double submit" 测试改为 "re-submitting a graded attempt returns graded result (FIX-2)"，断言 `statusCode=200, status=graded` | High |
| E26 | Test | `apps/api/src/routes/attempts.test.ts` | 720-800 | 新增 FIX-2 测试块：模拟 crash 后 attempt 卡在 `submitted`，再次 POST submit 应推进到 `graded` | High |
| E27 | Test | `apps/api/src/routes/attempts.test.ts` | 802-889 | 新增 FIX-1 测试块：deadline 后 save-answer 应返回 `DEADLINE_EXCEEDED`，submit 仍应成功评分 | High |
| E28 | Test | `apps/api/tests/security/exam-protocol-security.test.ts` | 236-260 | AC1 测试从 "Submit after deadline returns 409" 改为 "Submit after deadline succeeds" | High |
| E29 | Test | `packages/exam-engine/src/attemptStateMachine.test.ts` | 90-115 | deadline guard 测试全部删除，改为 "submit is not deadline-guarded" 简化测试 | High |
| E30 | Test | `packages/exam-engine/src/gradingRefactor.test.ts` | 全文件 | 新增 untracked 文件：测试 `readGradingSnapshot`, `computeGradingResult`, `finalizeGrading` | Medium |
| E31 | Config | `apps/e2e/playwright.config.ts` | 1-50 | Playwright 配置定义 3 个 project（setup/auth/admin），2 个 webServer（api:3000 + web:5173），`baseURL: "http://localhost:5173"` | High |
| E32 | Test | `apps/e2e/src/e2e/browser.spec.ts` | 1-84 | Playwright 浏览器 e2e 仅测试 admin 导航 + candidate 不能访问 admin 路由，**没有 candidate 完整考试流程测试** | High |
| E33 | Test | `apps/e2e/src/smoke.test.ts` | 全文件 | Vitest API smoke 包含"完整考试生命周期"测试（创建→发布→报名→开始→答题→提交→查分），但通过 API 直接调用，非浏览器 | High |
| E34 | State | `packages/exam-engine/src/examCommands.ts` | 17-23 | Exam 状态迁移表：`draft→[published]`, `published→[open, archived]`, `open→[closed]`, `closed→[archived]`, `archived→[]` | High |
| E35 | Docs | `docs/dev/phase1-exam-lifecycle-exit-review-2026-06-13.md` | 48-63 | Exit review 指出 4 个 ghost state：`not_started`, `queued`, `grading`, `voided`（代码不会产生这些状态） | High |
| E36 | Frontend | `apps/web/src/pages/exam/StartExamPage.tsx` | 47-100 | StartExamPage 支持队列轮询（`requireQueue` 时每秒轮询 `/api/attempts/:examId/queue`） | High |
| E37 | Endpoint | `apps/api/src/routes/exam.ts` | 401-440 | `POST /exams/:id/publish` — 调用 `publishExam()` 命令，返回 `toExamResponse(updated)` | High |
| E38 | Endpoint | `apps/api/src/routes/exam.ts` | 442-459 | `POST /exams/:id/archive` — 调用 `archiveExam()` 命令，返回 `toExamResponse(archived)` | High |
| E39 | Endpoint | `apps/api/src/routes/exam.ts` | 461-489 | `DELETE /exams/:id` — 仅当 status=`draft` 时可删除，返回 `204` | High |
| E40 | State | `packages/exam-engine/src/grading.ts` | 143-177 | `gradeAttempt()` 保留为旧版包装器，内部调用 `readGradingSnapshot` → `computeGradingResult` → `finalizeGrading` | High |

---

## 2. Behavior Matrix

| ID | 对象 | 当前行为 | 触发条件 | 返回/展示结果 | 证据 |
| -- | -- | ---- | ---- | ------- | -- |
| B01 | POST /attempts/:examId/start | 创建新 attempt（`in_progress`），或返回已存在的 active attempt（幂等） | exam 状态=open, 时间窗口内, retake 策略未超限 | 201 + `LoadAttemptResponseSchema`（不含 standardAnswer）或 409 error | E09/attempts.ts:494-573 |
| B02 | POST /attempts/:attemptId/answers/:questionId | 按 Answer Save Protocol 版本化保存答案 | attempt 在 `in_progress`, deadline 未超（可选） | 200 + `SaveAnswerAcceptedSchema` 或 `SaveAnswerRejectedSchema` | E07/E08/answerProtocol.ts:21-106 |
| B03 | POST /attempts/:attemptId/submit (4-Phase) | Phase1: 提交（`submitted`, sql tx+行锁）→ Phase2: 读快照(无锁) → Phase3: 算分(纯CPU) → Phase4: 落库（`graded`, sql tx+行锁） | attempt 在 `in_progress`/`disrupted`/`submitted`/`graded`, 无 deadline 限制 | 200 + `LoadAttemptResponseSchema`（含 scored/passed）or 409 ErrorResponse for other states | E09/E10/E11/attempts.ts:738-859 |
| B04 | POST /attempts/:attemptId/heartbeat | 更新 `lastActivityAt`（无 deadline 检查） | attempt 在 `in_progress` | 200 `{ ok: true }`，其他状态 409 | E15/E18/attempts.ts:861-890 |
| B05 | POST /attempts/:attemptId/restore | 恢复 disrupted→in_progress，保留答案和剩余时间（无 deadline 检查） | attempt 在 `disrupted` | 200 + `LoadAttemptResponseSchema` | E16/attempts.ts:892-930 |
| B06 | GET /scores/attempts/:attemptId | 返回评分结果（含每问详情）或隐藏结果 | attempt 已 `graded` 且 `showResultImmediately=true` | `VisibleAttemptResultSchema` 或 `HiddenAttemptResultSchema`（仅含 status/showResultImmediately/examTitle） | E17/scores.ts:227-255 |
| B07 | POST /exams/:id/publish | draft→published, 构建 QuestionSnapshot, 记录 audit | exam 在 draft, 有至少1题, 校验通过 | 200 + `toExamResponse(updated)` | E37/exam.ts:401-440 |
| B08 | POST /exams/:id/archive | closed/published→archived | exam 在 published/closed | 200 + `toExamResponse(archived)` | E38/exam.ts:442-459 |
| B09 | DELETE /exams/:id | 删除 exam | exam 在 draft | 204 | E39/exam.ts:461-489 |
| B10 | 客户端心跳机制 | 每30s POST heartbeat, 失败显示"连接异常"横幅，不重试，不触发 restore | attempt 在 `in_progress` | isDisconnected=true → 红色告警横幅 | E18/E19/TakeExamPage.tsx:248-261 |
| B11 | 客户端 save rejection 处理 | 按 `reason` 区分显示：DEADLINE_EXCEEDED→"已到截止时间", ATTEMPT_ALREADY_SUBMITTED→"考试已结束" | 服务器返回 `accepted:false` | 不同类型 alert 图标+标题+描述 | E20/TakeExamPage.tsx:342-377 |
| B12 | 客户端 submit 前 flush | 调用 `useSubmitFlush` 将所有 pending 保存立即执行（不清除 debounce），等待所有 inflight 完成（10s 超时），然后才执行 submit | 用户点击"交卷" | 先完成所有保存，失败则显示 flush 结果对话框，阻止普通提交或允许"仍然提交" | hooks/useSubmitFlush.ts:125-178 |

---

## 3. Consistency Matrix

| ID | 代码行为 | 前端行为 | 文档声明 | 测试覆盖 | 是否一致 | 证据 |
| -- | ---- | ---- | ---- | ---- | ---- | -- |
| C01 | 答案保存 deadline 拒绝：route 传入 deadlineAt+now, answerProtocol 检查 DEADLINE_EXCEEDED | 前端显示 saveRejection alert "已到截止时间" | SPEC§3.5: deadline 后 save-answer 被拒绝；api/reference.md: deadline 后返回 DEADLINE_EXCEEDED | FIX-1 测试：deadline 后 save-answer → accepted:false, reason=DEADLINE_EXCEEDED | **Consistent** | E07/E08/E20/E27 |
| C02 | submit 无 deadline 限制：state machine/command/route 都不检查 deadline | 前端 submit 按钮始终可用 | api/reference.md: "submit 不受 deadline 限制"；todo.md: "deadline 仅限制保存答案" | FIX-2 测试：deadline 后 submit → 200 graded；AC1 改为 submit 成功 | **Consistent** | E05/E06/E14/E25/E26/E27/E28/E29 |
| C03 | submit 返回 `status: "graded"` | TakeExamPage submit 后导航到 result page | api/reference.md 已更新为 `"status": "graded"` | attempts.test.ts 断言 `body.status === "graded"` | **Consistent** | E14/E21/E25 |
| C04 | Heartbeat 返回 `{ ok: true }` (200) | 前端处理 200 设 isDisconnected=false | api/reference.md 仍写 `204 No Content` | 无直接 heartbeat route 的测试 | **Inconsistent (docs outdated)** | E15/E23 |
| C05 | Save-answer conflict reason code=`STALE_VERSION` | 前端不直接显示 reason，通过 saveRejection 区分 | api/reference.md 写自然语言 `"Server has newer version"` | attempts.test.ts 断言 reason=`STALE_VERSION` | **Inconsistent (docs outdated)** | E24 |
| C06 | 4-phase submit 重构：submit→readSnapshot→computeGrading→finalizeGrading | 前端无需变化（原有 submit 调用不变） | api-contract/03-command-result.md 已定义该设计 | gradingRefactor.test.ts + grading.test.ts 覆盖 | **Consistent** | E09/E10/E11/E12/E30 |
| C07 | submit 幂等：submitted→重试评分，graded→直接返回 | 前端只有一个 submit 按钮（有 double-submit guard） | api/reference.md 新加说明："submit 内联完成评分...再次 POST submit 会重试评分" | FIX-2 测试：模拟 submitted crash→POST submit→graded；graded re-submit→返回不变 | **Consistent** | E10/E14/E25/E26 |
| C08 | restore 无 deadline 检查 | **前端无 restore 调用路径** | SPEC§: restore 是 disrupted 恢复路径 | 无 restore 前端测试 | **Missing frontend evidence** | E16/E19 |
| C09 | Heartbeat 无 deadline 检查 | 前端每30s发送 heartbeat | SPEC§: 心跳超时自动标记 disrupted | 无 deadline 相关的 heartbeat 测试 | **Missing test evidence** | E15/E18 |
| C10 | grad 已拆分为 3 函数，不再写 `grading` 状态 | 前端不涉及 | exit review：grading 是 ghost state | gradingRefactor.test.ts 覆盖 finalizeGrading 直接写 graded | **Consistent** | E11/E12/E13 |
| C11 | Exam 状态机：draft→published→open→closed→archived | admin detail 页面显示 publish/archive 按钮 | SPEC.md line 400-403 | examStateMachine.test.ts + examCommands.test.ts | **Consistent** | E34 |
| C12 | `not_started`, `queued`, `grading`, `voided` 在枚举中存在但代码不产生 | 前端不涉及 | exit review 指出为 ghost state | state-lifecycle.spec.ts 测试覆盖这些枚举值但无进入路径 | **Consistent with exit review** | E04/E35 |
| C13 | Candidate 查分逻辑：仅当 `showResultImmediately=true` 且 graded | ResultPage 根据响应显示详情或等待状态 | SPEC§: 支持 showResultImmediately 控制 | scores.test.ts: 隐藏结果测试 + 管理员可见测试 | **Consistent** | E17/ResultPage.tsx |
| C14 | Playwright e2e: 仅 admin 导航 + candidate 无法访问 admin | 无 candidate 完整考试流程 e2e | security-completion-plan.md: S08-lite 安全测试覆盖 | api-smoke.test.ts 有 API 级别完整考试生命周期 | **Missing frontend e2e evidence** | E32/E33 |
| C15 | DELETE exam: 仅 draft 可删除，返回 204 | ExamPage 中 delete 按钮仅 draft 时启用 | SPEC§: draft 可删除 | exam.test.ts: DELETE 返回 204, DELETE published → 409 | **Consistent** | E39/exam.ts:461-489 |

---

## 4. Gap Table

| ID | 缺口 | 影响范围 | 建议归属 | 证据 |
| -- | -- | ---- | ---- | -- |
| G01 | **前端无 restore 调用路径**：TakeExamPage 从不调用 `/api/attempts/:attemptId/restore`。Disrupted attempt 无法从前端恢复。初始加载时 non-in_progress 状态被导向 result page。 | Candidate 考试的 disruption 恢复能力缺失 | Phase 2 backlog | E19/attempts.ts:892-930/TakeExamPage.tsx |
| G02 | **Heartbeat 无 deadline 检查**：服务端接受 deadline 后的 heartbeat，前端 30s 心跳不因 deadline 停止。可能导致 deadline 后仍延长 lastActivityAt。 | Deadline 语义弱化（虽 timer 仅展示性） | Phase 2 backlog | E15/E18/attempts.ts:884-886 |
| G03 | **Playwright e2e 缺少 candidate 考试流程**：无浏览器端"开始考试→答题→保存→提交→查分"完整流程。`browser.spec.ts` 仅测 admin 导航和 candidate 路由限制。 | 无端到端的用户验收测试 | Phase 1 candidate | E32/browser.spec.ts:1-84 |
| G04 | **Heartbeat 文档过时**：`docs/api/reference.md` 仍记载 `204 No Content`，实际返回 `{ ok: true }` (200)。 | API 文档与实际不一致 | Phase 1 candidate | E15/E23 |
| G05 | **Save-answer 冲突文档过时**：`docs/api/reference.md` 使用自然语言 `"Server has newer version"`，实际 code=`STALE_VERSION`。 | API 文档与实际不一致 | Phase 1 candidate | E24 |
| G06 | **4 个 Ghost State**：`not_started`, `queued`, `grading`, `voided` 枚举存在但 Phase 1 代码不产生。`queued` 仅内存 Map、不持久化。`grading` 已通过重构消除。`voided` 无进入路径。 | 代码复杂度冗余，枚举膨胀 | Needs human decision | E04/E35/attemptStateMachine.ts:31-38 |
| G07 | **Submit submitted→grading 转化潜在竞态**：Phase 1 提交松开行锁后，到 Phase 4 重新拿锁之间，另一个请求可能已进入 finalizeGrading（当前通过 at-most-once + idempotent guard 缓解）。 | 极端并发下可能 double-finalize（目前幂等安全） | Phase 2 backlog | E09/E10/grading.ts:103-135 |
| G08 | **Open/Close exam 无前端路径**：`openExam`/`closeExam` 命令存在，但前端 admin 页无对应按钮。Exam 只能由定时窗口隐式变更状态。 | Admin 无法手动打开/关闭 exam | Phase 2 backlog | examCommands.ts:119-149/exam.ts |
| G09 | **score list 仅在 exam closed 后可见**：Admin 必须在 exam 结束（closed）后才可查看成绩列表。没有"实时查看"或"提前开放"机制。 | Admin 无法在考试进行中查看进度 | Phase 2 backlog | scores.ts:120-195 |
| G10 | **E2E 配置不完整**：`apps/e2e/` 无 `tsconfig.json`，Playwright `.auth/` 目录不存在（被 gitignore），CI/CD 无配置文件。 | E2E 测试无法在 CI 中可靠运行 | Phase 1 candidate | E31 |
| G11 | **smoke 命令无实现**：turbo.json 定义 `smoke` pipeline 但无 package 提供该 script。 | Root 命令 `pnpm smoke` 无实际效果 | Phase 1 candidate | 扫描证据 |

---

## 扫描总结

### 1. 高置信度事实

- **FIX-1 (deadline enforcement) 已完备**：`processSaveAnswer` 的 DEADLINE_EXCEEDED 检查已正确连线，路由传入 `deadlineAt`+`now`，前端显示适当的 deadline rejection alert。
- **FIX-2 (submit idempotent retry) 已完备**：submit 改为 4-phase 架构，`submitted`→重试评分，`graded`→幂等返回，`grading` ghost state 已消除。
- **grading 重构完成**：`gradeAttempt` 拆分为 `readGradingSnapshot`+`computeGradingResult`+`finalizeGrading`，状态转换 + 落库与读快照分离，事务边界清晰。
- **submit deadline 语义已统一**：state machine/command/route 都不检查 deadline，文档已更新确认 submit 不受 deadline 限制。
- **前端 saveRejection alert 已实现**：按 `reason` 区分显示 `DEADLINE_EXCEEDED` / `ATTEMPT_ALREADY_SUBMITTED` / `ATTEMPT_CLOSED`。
- **API 文档已部分更新**：submit 返回 status 从 `completed`→`graded`，新增 submit deadline 语义说明。

### 2. 发现的不一致

| # | 不一致 | 文件 | 证据 |
| -- | --- | ---- | -- |
| INC-01 | Heartbeat 文档写 204，代码返回 `{ok:true}` (200) | `docs/api/reference.md:946-950` vs `attempts.ts:861-890` | E15/E23 |
| INC-02 | Save-answer 冲突文档写自然语言，代码用 code | `docs/api/reference.md:911-922` vs `answerProtocol.ts` | E24 |
| INC-03 | 前端无 restore 路径，但服务端 restore 端点已实现 | `TakeExamPage.tsx` vs `attempts.ts:892-930` | E19/E16 |
| INC-04 | Playwright e2e 无 candidate 考试流程（仅 admin 导航） | `browser.spec.ts:1-84` | E32 |

### 3. 需要主审模型或人类裁决的问题

1. **Ghost state 处理**：`not_started`, `queued`, `grading`, `voided` 4 个状态在枚举中存在但代码不产生。是否应：
   - 留待 Phase 2 解决（届时可能使用 `queued`, `voided`）
   - 立即从枚举移除冗余状态
   - 或保持现状

2. **前端 restore 缺失**：disrupted 恢复机制在后端已完整实现，但前端无任何调用路径。这是否应列为 Phase 1 剩余工作，还是推迟到 Phase 2 的 Proctor Panel 一起实现？

3. **Heartbeat deadline 检查**：当前心跳在 deadline 后仍被接受。是否应该：
   - 在 deadline 后拒绝 heartbeat（自动触发 disrupted）
   - 保持现状（heartbeat 仅用于检测连接，不与 deadline 耦合）

4. **分数列表开放时机**：当前 admin 只能在 exam `closed` 后查看分数列表。是否应在 Phase 1 就支持"考试进行中实时查看分数"？或留待 Phase 2？

5. **Open/Close 手动操作路径**：`openExam`/`closeExam` 命令存在但前端无入口。Exam 的状态迁移完全依赖定时窗口。是否应在前端添加手动 open/close 按钮？
