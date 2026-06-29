# Phase 1 Exam Lifecycle Exit Review

- 日期：2026-06-13
- 类型：Phase 1 考试生命周期出口审查（review-only，不加功能、不大重构）
- 范围：Attempt 状态、Deadline 契约、Grading 一致性、API 契约、前端一致性、文档一致性
- 关联前置：grading 修复（submit 走 tx+lock → readGradingSnapshot → computeGradingResult → finalizeGrading）

## 0. 背景与前提

本次审查基于以下已完成的 grading 修复：

- submit 路由采用 `submit(tx + lock) → readGradingSnapshot → computeGradingResult → finalizeGrading(tx + lock)`；
- `finalizeGrading` 原子更新 attempt 成绩与 enrollment final；
- submit 不再受 deadline guard 限制；
- save-answer 设计上仍在 deadline 后拒绝（见 §B 说明，发现一处与该前提矛盾的实现缺口）；
- deadline 后 submit 的语义是「提交服务器已保存答案」，而非「继续修改答案」；
- deadline auto-submit 暂不实现，进入 Phase 2。

本文档输出：

- A. Attempt State Matrix
- B. Endpoint Behavior Matrix
- C. Frontend Behavior Matrix
- D. Docs Consistency Checklist
- E. Phase 1 必须修复项
- F. Phase 2 backlog
- G. 待确认的最小修正

## 1. 关键结论（先读）

grading 修复基本属实，但存在一个与陈述直接矛盾的硬伤：

> 陈述称「save-answer 仍然在 deadline 后拒绝」—— 实际代码并未接线，`DEADLINE_EXCEEDED` 是死代码。

`processSaveAnswer`（`packages/exam-engine/src/answerProtocol.ts:47-58`）内含 deadline 拒绝逻辑，但 save-answer 路由构造 state 时只传了 `attemptStatus / answers / clientSeqMap`，**未传 `deadlineAt` 与 `now`**（`apps/api/src/routes/attempts.ts:644-658`）。而拒绝条件是 `if (state.deadlineAt && state.now && ...)`，两者恒为 `undefined`，因此该分支永不触发。contracts 测试注释（`packages/contracts/src/__tests__/contracts.test.ts:566-568`）亦自承 `DEADLINE_EXCEEDED` "not yet reachable through the HTTP route"。

其余关键发现：

- `grading` 状态在状态机里存在，但代码从不持久化它（`finalizeGrading` 校验 `submitted→grade` 合法后直接写 `graded`）。
- submit 后崩溃导致 attempt 卡在 `submitted` 时，无任何 API 出口可再次触发评分（submit 重试因 `submitted→submit` 非法返回 409，无 re-grade 端点）。
- 前端：`/restore` 端点全前端未调用；disrupted 尝试被直接跳转到 ResultPage 而非恢复。
- 多处 Phase 1.6 文档把「submit deadline → 409」列为已完成的验收标准，与代码实际行为相反。

## A. Attempt State Matrix

状态来源：`packages/domain/src/enums.ts:53-63`。迁移表：`packages/exam-engine/src/attemptStateMachine.ts:31-38`。

| 状态 | 进入路径 | 退出路径 | 是否终态 | Phase 1 实际行为 / 问题 |
|---|---|---|---|---|
| `not_started` | 枚举存在 | （无迁移） | — | 幽灵状态：代码从不创建此状态（start 直接建 `in_progress`）。无进入路径 |
| `queued` | 枚举存在 | （无迁移） | — | 幽灵状态：队列是内存 Map（`apps/api/src/routes/attempts.ts:70`），不入库。attempt 不经历此状态 |
| `in_progress` | start 创建（`attemptCommands.ts:117`）/ restore 回退（`attemptCommands.ts:219`） | submit→submitted / disrupt→disrupted | 否 | 正常。heartbeat 仅此状态放行（`apps/api/src/routes/attempts.ts:840`） |
| `disrupted` | in_progress→disrupt（`markDisrupted`） | submit→submitted / restore→in_progress | 否 | heartbeat 返回 409（`attempts.ts:840`）。restore 无 deadline 检查——deadline 后仍可恢复回 in_progress |
| `submitted` | in_progress/disrupted → submit（`attemptCommands.ts:160`） | finalize→graded | 否（中间态） | 死恢复风险：submit phase1 提交后若 phase4 崩溃，attempt 停留 submitted。重试 submit 因 `submitted→submit` 不在迁移表而 409；无任何 re-grade 端点（`gradeAttempt` 仅测试用） |
| `grading` | 状态机有 `submitted→grading`（`attemptStateMachine.ts:36`） | `grading→graded` | 否 | 幽灵状态：`finalizeGrading` 校验 `submitted→grade` 合法后直接写 `graded`（`grading.ts:108`），从不持久化 `grading`。全仓库无一处将 status 设为 `grading` |
| `graded` | finalize（`grading.ts:108`） | （无） | 是（合理） | 幂等：`finalizeGrading` 对已 graded 返回 false（`grading.ts:97-99`） |
| `voided` | 枚举存在 | （无迁移） | 是 | 无进入路径：状态机无任何 `→voided` 迁移，也无 admin void 端点。`ATTEMPT_CLOSED` 拒绝因此不可达 |

死状态判定：

- 无「无法继续」的终态死锁：`graded` / `voided` 是合理终态。
- 唯一真实死恢复状态 = `submitted` 卡死（见 §E-FIX-3）。这不是死状态，但属于「无 API 出口」，需修。
- `grading` / `not_started` / `queued` / `voided` 是枚举膨胀——Phase 1 不产生它们，属文档/契约层面的不一致，非功能缺陷。

## B. Endpoint Behavior Matrix

| 端点 | 文件:行 | deadline 行为 | 状态语义 | 问题 |
|---|---|---|---|---|
| POST `/attempts/:examId/start` | `attempts.ts:540` | 检查 exam open 窗口（`openAt`/`closeAt`），不检查 attempt deadlineAt | → in_progress | 正常 |
| POST `/attempts/:attemptId/answers/:questionId` (save-answer) | `attempts.ts:589` | 不拒绝。未把 `deadlineAt`/`now` 传入 `processSaveAnswer`（`:644`） | in_progress 接受；submitted/grading/graded → `ATTEMPT_ALREADY_SUBMITTED`；voided → `ATTEMPT_CLOSED` | `DEADLINE_EXCEEDED` 死代码（与陈述矛盾） |
| POST `/attempts/:attemptId/submit` | `attempts.ts:730` | 不受 deadline 限制（符合预期） | submit(tx+lock)→submitted；读快照→computeGradingResult→finalizeGrading(tx+lock)→graded；返回 graded attempt | ① 提交后崩溃卡 submitted 无出口 ② `submitted→submit` 重试 409 |
| POST `/attempts/:attemptId/heartbeat` | `attempts.ts:826` | 无 deadline 检查 | 仅 in_progress（其余 409） | deadline 后仍可心跳（可接受，timer 仅为展示） |
| POST `/attempts/:attemptId/restore` | `attempts.ts:857` | 无 deadline 检查 | disrupted→in_progress | deadline 后可恢复（轻微，Phase 2 收口） |
| GET `/attempts/:id` | `attempts.ts:571` | — | 返回完整 attempt（含 status） | OK |
| GET `/exams/:id/scores`（admin） | `scores.ts:120` | — | 仅 exam 结束且 gradedCount>0 才开放；返回 graded 列表 | OK |
| GET `/scores/attempts/:attemptId` | `scores.ts:197` | — | graded+可见→含成绩；否则→`{status, showResultImmediately:false, examTitle}` | response 含 status，但前端未用（见 §C） |

Response 能否区分 submitted/grading/graded/disrupted：`/attempts/:id` 与 `/scores/attempts/:id` 都返回 `status` 字段，后端足以区分。`grading` 因永不持久化，实际不会出现。

### Grading 一致性逐项核对

- `computeGradingResult` 是纯函数：确认。仅依赖入参（`grading.ts:70-82` → `gradingEngine.ts:131` 的 `gradeAnswers`），无 I/O、无 mutation。
- `finalizeGrading` 在一个事务中完成 attempt graded 写入和 enrollment final 更新：部分确认。调用方 submit 路由把它包在单个 `executeInTransaction`（`attempts.ts:794-805`）内；但函数内部 attempt 写入与 enrollment 写入是两次 `repo.update`，依赖外层事务保证原子，函数本身未自管事务。当前用法下原子性成立。
- `finalizeGrading` 对已 graded 幂等或稳定跳过：确认。`grading.ts:97-99` 见 `graded` 直接返回 false。
- submit 后崩溃导致 attempt 停在 submitted 时，可以再次触发 grading：不满足。无 re-grade 端点，重试 submit 因状态机迁移非法被 409 拒绝。见 §E-FIX-3。
- 并发 submit / grading 不会导致重复写入或不一致：基本满足。submit phase1 与 phase4 各自在 `findByIdForUpdate`（`attemptRepo.ts:22`）行锁内执行；`finalizeGrading` 对 graded 幂等。残余风险：phase1 与 phase4 之间锁释放窗口内若另一请求进入，仍由状态机（submitted→grade）+ 幂等兜底。

## C. Frontend Behavior Matrix

| 区域 | 文件:行 | 行为 | 契约一致性 |
|---|---|---|---|
| Submit 按钮（deadline 后） | `TakeExamPage.tsx:307,491` | 始终可点（无 deadline gate）；无「提交被拒」旧文案 | 符合 |
| deadline 自动交卷 | `TakeExamPage.tsx:204` `handleTimeout`→flush+submit | 客户端侧自动提交 | 符合；但服务端无 auto-submit（Phase 2），客户端崩溃则不触发 |
| save-answer 拒绝 UI | `TakeExamPage.tsx:164-171` | `ATTEMPT_ALREADY_SUBMITTED`/`ATTEMPT_CLOSED` 落入通用分支→`setIsDisconnected(true)` | 不一致：把「已交卷」误显示为「连接异常」；服务端 `message` 被丢弃 |
| ResultPage（score=null） | `ResultPage.tsx:169-176` | 非可见态统一渲染「已交卷，等待成绩公布」，忽略 status | 不一致：无法区分 submitted/grading/graded-hidden |
| 恢复流程（restore） | `TakeExamPage.tsx:68` | 仅 `in_progress` 放行，disrupted 直接跳转 ResultPage | 不一致：`/restore` 端点全前端未调用（grep 无命中）；disrupted 无法恢复 |
| 候选人考试列表 | `ExamListPage.tsx:13` | 本地类型无 `activeAttemptId`/status，disrupted/in_progress 不可见 | 不完整：列表层看不到进行中/中断的尝试 |
| Admin 成绩详情 | `AttemptDetailPage.tsx:79` | 非可见态统一报错「尚未完成评分」，忽略 status | 不一致：无法区分各中间态 |

注：`statusMeta.ts:49-56` 已定义全部状态标签（含 `disrupted`/`grading`/`submitted`），但无候选人侧页面消费它们。

## D. Docs Consistency Checklist

| 文档 | 位置 | 内容 | 判定 |
|---|---|---|---|
| `docs/SPEC.md` | L191 / L434 | 「交卷是否超时以服务端为准」 | 暗示 submit 有 deadline 检查，实际没有（SPEC 为权威，属未实现需求） |
| `docs/SPEC.md` | L475-476（§3.5） | reject enum 含 `DEADLINE_EXCEEDED` | STALE（Phase 1 死代码） |
| `docs/SPEC.md` | L123 | `grading | 正在批改` | STALE（grading 永不持久化） |
| `docs/SPEC.md` | L988 / L996 | timed_sync/deadline/untimed → Phase 2 | 一致 |
| `docs/dev/review-report-2026-06-09.md` | L57（BUG-01） | 「submit+grade 非事务，失败留 submitted」列为 Not Fixed | STALE——实际已修，应标 fixed。注意：该报告无 "I-6" 条目（全仓 grep `I-1..I-6` 零命中） |
| `docs/todo.md` | L28 | `[x] deadline 强制 409` | 不一致：标完成，但代码不做 submit 409 |
| `docs/archive/phase-1.6/jobs.md` | L29-32 | 验收标准 `now>deadlineAt → submit 409` | 不一致：与代码矛盾 |
| `docs/archive/phase-1.6/phase1.6-bridge-plan.md` | L55, 317, 334 | submit deadline 409 验收 | 不一致：与代码矛盾 |
| `docs/archive/phase-1.6/01-overview.md` | L28, 67 | submit deadline 409 出口标准 | 不一致：与代码矛盾 |
| `docs/archive/phase-1.6/s03a-status-adjustment.md` | L50 | 诚实承认「submit deadline 断言缺失」 | 一致：唯一说真话的文档 |
| `docs/archive/phase-1.6/phase1.6-bridge-plan.md` | L305 | auto-submit → Phase 2 | 一致 |
| `docs/api/reference.md` | L926-940 | submit 响应 `"status":"completed"` | 不一致：应为 `graded` |
| `docs/api/reference.md` | L884-922 | save-answer 无 `DEADLINE_EXCEEDED` | 与现状一致（但与 SPEC §3.5 矛盾） |
| `docs/api/reference.md` | — | restore / `/scores/attempts/:id` / `showResultImmediately` | 未文档化 |

未发现任何文档仍逐字写「deadline 后 submit 被拒绝」。最接近的是上述「submit 409」验收标准——它们描述的是一种未实现的预期，方向恰好相反：那些文档误以为 submit 会被 409 拒，而本次修复正是去掉这个限制。

## E. Phase 1 必须修复项

### FIX-1（最高优先，与陈述矛盾）接线 save-answer deadline 拒绝

- 现状：`apps/api/src/routes/attempts.ts:644` 构造 `processSaveAnswer` state 时漏传 `deadlineAt`/`now`。
- 修法（约 2 行）：补 `deadlineAt: lockedAttempt.deadlineAt, now: new Date()`。这样 Phase 1 deadline 语义 = 「deadline 后禁止继续保存答案」，与陈述一致。
- 影响：需补一条路由测试断言 deadline 后 save 返回 `DEADLINE_EXCEEDED`。
- 反向选项：若决定 Phase 1 不做 save-answer deadline 拒绝，则需同步修正 SPEC §3.5 与 contracts 测试注释，承认 `DEADLINE_EXCEEDED` 在 Phase 1 不接线，整体后移到 Phase 2。两种方向二选一。

### FIX-2 修正误称 submit 会 409 的文档

- 涉及：`docs/todo.md:28`、`docs/archive/phase-1.6/jobs.md:29-32`、`docs/archive/phase-1.6/phase1.6-bridge-plan.md:55,317,334`、`docs/archive/phase-1.6/01-overview.md:28,67`。
- 修法：把这些「submit deadline→409」验收标准改为反映真实语义（submit 不受 deadline 限制；deadline 仅限制 save-answer）。

### FIX-3（建议，防死恢复）让 submit 对已 submitted 幂等

- 现状：submit phase1 成功、phase4 崩溃 → attempt 卡 submitted，重试 submit 因 `submitted→submit` 非法返回 409，且无 re-grade 端点。
- 最小修法：submit 路由 phase1 内，若 `lockedAttempt.status === "submitted"` 则跳过 `submitAttempt` 迁移，直接进入后续 grading 流程（grading 对 submitted→graded 幂等）。无需新端点、无新架构，满足「崩溃后可再次触发 grading」。
- 风险：属行为变更（submit 语义从「单次迁移」变为「提交+评分的幂等聚合」），需确认。

### FIX-4 文档：标 BUG-01 已修 + reference.md 状态名

- `docs/dev/review-report-2026-06-09.md:57` BUG-01 → fixed。
- `docs/api/reference.md:926-940` submit 响应 `completed` → `graded`。

## F. Phase 2 backlog

| 项 | 说明 | 文档现状 |
|---|---|---|
| 服务端 deadline auto-submit | 当前仅客户端 `handleTimeout` 触发；客户端崩溃则不触发 | 已标 Phase 2（`phase1.6-bridge-plan.md:305`） |
| re-grade / admin 强制评分端点 | FIX-3 覆盖了「幂等重试」；完整 admin 重新评分入口留 Phase 2 | — |
| `grading` 状态持久化或从契约移除 | 当前是幽灵状态；Phase 2 异步评分时才真正需要 | SPEC L123 STALE |
| restore 后 deadline 收口 | 现可 deadline 后恢复 | — |
| 前端 restore UI 接线 | `/restore` 端点未被调用，disrupted 跳 ResultPage | — |
| 前端 save-answer 拒绝文案区分 | `ATTEMPT_ALREADY_SUBMITTED` 误显示为连接异常 | — |
| 前端 ResultPage/Admin 按 status 区分中间态 | status 字段已返回但未消费 | — |
| `not_started` / `queued` / `voided` 枚举落地或清理 | 无进入路径 | — |
| proctor force-submit / extend-time | Phase 2 监考面板 | 已标 Phase 2 |

## G. 待确认的最小修正

本次审查未修改任何代码或文档。建议优先级：

1. FIX-1（代码约 2 行 + 1 条测试）——这是唯一与陈述相悖的代码事实，应先确认方向：接线 save-answer deadline 拒绝，还是承认 Phase 1 不做并改文档。
2. FIX-2 / FIX-4（纯文档）——低风险，可直接改。
3. FIX-3（submit 幂等化）——防死恢复，改动小但属行为变更，建议单独评估。

推荐组合：先做 FIX-1 + FIX-2 + FIX-4（修正矛盾、对齐文档），FIX-3 单独评估。

## 审查方法说明

- 后端：直接阅读 `packages/domain/src/enums.ts`、`attemptStateMachine.ts`、`attemptCommands.ts`、`grading.ts`、`gradingEngine.ts`、`answerProtocol.ts`、`apps/api/src/routes/attempts.ts`、`scores.ts`、`packages/contracts/src/attempt.ts` 及相关测试。
- 前端：由 explore 子代理审计 `apps/web/src` 下 TakeExam / Result / ExamList / StartExam / AttemptDetail / ScoreList 页面与组件。
- 文档：由 explore 子代理审计 `docs/SPEC.md`、`docs/dev/review-report-2026-06-09.md`、`docs/archive/phase-1.6/*`、`docs/api/reference.md`、`docs/todo.md`。
- 本文为 review-only 产出，未引入新架构、未新增功能。

## H. Exit Fix 应用记录 (2026-06-13)

本节记录基于本审查执行的 Phase 1 Exit Fix（review FIX-1/2/3/4 已全部应用）。修复遵循「最小修正、无新端点、无新架构、不做 Phase 2 功能」原则。

### 已应用修复

| 任务编号 | 对应 review 项 | 内容 | 状态 |
|---|---|---|---|
| 任务 FIX-1 | review FIX-1 | save-answer 路由接线 `deadlineAt: lockedAttempt.deadlineAt, now: fastify.now()`；`DEADLINE_EXCEEDED` 现已在 HTTP route 可达 | ✅ 已应用 |
| 任务 FIX-2 | review FIX-3 | submit 路由幂等化：in_progress/disrupted→submitted；submitted→retry grading；graded→幂等返回；其余（voided/…）→409。消除「卡 submitted 无出口」死恢复 | ✅ 已应用 |
| 任务 FIX-3 | review FIX-2 + FIX-4 | 文档一致性：todo/jobs/bridge-plan/overview 去除「submit deadline→409」旧语义；review report BUG-01 标 fixed；reference.md submit status `completed`→`graded` + deadline 语义说明；contracts 测试注释更新 | ✅ 已应用 |

### Phase 1 最终 deadline 语义（权威）

- deadline 后**禁止继续保存答案**：`POST /attempts/:id/answers/:qid` → `200 { accepted:false, reason:"DEADLINE_EXCEEDED" }`。
- deadline 后**允许提交服务器已保存答案**：`POST /attempts/:id/submit` → `200`（submit 不受 deadline 限制）。
- submit 内联评分：in_progress/disrupted→submitted→graded；submitted→retry；graded→幂等。
- deadline auto-submit **不实现**（Phase 2）；grading background retry / admin regrade **不实现**（Phase 2，由 submit 幂等覆盖崩溃重试）。

### 新增/更新测试

- `attempts.test.ts`：`deadline contract (FIX-1)`——deadline 后 save-answer 被拒绝 + 已保存答案仍可 submit 评分。
- `attempts.test.ts`：`idempotent retry-grading (FIX-2)`——手动构造 submitted attempt，POST submit 应推进到 graded。
- `attempts.test.ts`：原 `rejects double submit`（graded）改为 `idempotent: re-submitting a graded attempt returns the graded result`。

### 验证

- `pnpm --filter @exam/exam-engine test`：138 passed。
- `attempts.test.ts`：29 passed。
- `exam-protocol-security.test.ts`：4 passed。

### Phase 2 backlog（最终）

| 项 | 说明 |
|---|---|
| 服务端 deadline auto-submit | 当前仅客户端 `handleTimeout`；客户端崩溃不触发 |
| grading background retry / admin regrade 端点 | submit 幂等已覆盖崩溃重试；独立 admin regrade 入口留 Phase 2 |
| `grading` 状态持久化或从契约移除 | 当前为幽灵状态（validate-only，从不持久化） |
| restore 后 deadline 收口 | 现可 deadline 后恢复 |
| 前端 restore UI 接线 / save-answer 拒绝文案区分 / ResultPage 按 status 区分中间态 | status 字段已返回但前端未消费 |
