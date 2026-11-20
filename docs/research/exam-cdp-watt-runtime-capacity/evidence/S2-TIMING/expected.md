# S2-TIMING 预期表（先写后测 · PROTOCOL §10 S2-TIMING + ADDENDUM §2.3）

状态：**PRE-REGISTERED**。写定于任何 S2 测量之前（2026-11-20，冻结基线 87510894，
分支 research/capacity-900-1021 工作树）。本文按**当前代码契约**预写四类交错的预期
（UI、提交原因、submittedAt、最终答案集合、评分与审计副作用次数），实测后逐行比对。
依据文件与行号全部来自冻结 SHA 的工作树源码。

## 0. 代码契约事实（预期的推导依据）

### 0.1 生产服务端取时位置（wall clock `fastify.now()` = `new Date()`）

| 路径 | 取时位置 | 代码 |
| --- | --- | --- |
| 手动交卷 POST /attempts/:id/submit | **route 入口一次**，先于事务与任何锁 | apps/api/src/routes/attempts.candidate.ts:1207（`const now = fastify.now()` → submitAndGradeAttempt） |
| 保存 POST /attempts/:id/answers/:qid | **route 入口一次**，贯穿 deadline 守卫与 savedAt | attempts.candidate.ts:986 |
| take GET /candidate/attempts/:id/take | 事务内（reconcile，:902）+ 快照（:935）各一次 | attempts.candidate.ts:902,935 |
| deadline scanner | **每候选重采样** `nowFn()`（= fastify.now()），先于其事务 | apps/api/src/plugins/deadlineScanner.ts:389,419 |
| now 插件 | `new Date()`；`setNowOverride` 仅测试钩子，生产不设 | apps/api/src/plugins/now.ts:25-30 |

**单调排队时钟**：产品服务端路径不用单调时钟做排队/到期判定（无该代码）；唯一单调钟在
前端 auto-submit 冷却（`performance.now()`，TakeExamPage.tsx:1370-1371）与本 harness 的
事件排序记录。S2 实测中两类时钟分别记录（wall=PG/ISO/submittedAt；mono=harness
`performance.now()` 时间线）。

### 0.2 锁与事务结构（EA 顺序）

- 保存/交卷/take/restore 事务均先 `lockEnrollmentAndAttempt`：**Enrollment FOR UPDATE →
  Attempt FOR UPDATE**（apps/api/src/orchestrators/submitAndGradeAttempt.ts:155-159；
  attempts.candidate.ts:1017-1021）；deadline 决策再加 Exam 锁：候选路径 FOR SHARE
  （#668），scanner FOR UPDATE（deadlineScanner.ts:252）。
- scanner 每 tick `listDeadlineCandidates` 发现 → 每候选 `autoSubmitAndGrade` 锁下重判
  （deadlineScanner.ts:409-419,215-369）；interval = `heartbeat.deadlineScanIntervalMs`
  （默认 30s，deadlineScanner.ts:462）。
- 保存与交卷在同一 EA 锁缝上串行化：**先提交者赢**；后到的 save 见 status=submitted →
  `ATTEMPT_ALREADY_SUBMITTED`（answerProtocol.ts:159-166，HTTP 200 + accepted:false）。

### 0.3 交卷语义（submitAndGradeAttempt，orchestrator）

- 状态分支：graded → `replay_no_change`（幂等零写）；in_progress/disrupted/submitted →
  reconcile → （若被冻结）`deadline_frozen`；否则 submitAttempt → pending_manual 停在
  submitted；否则 readGradingSnapshot+finalizeGrading → `graded`/`recovered`
  （submitAndGradeAttempt.ts:169-333）。
- **手动交卷**：submitAttempt(source="candidate")，submissionReason 默认 **'manual'**，
  `submittedAt = now`（route 入口样本）（packages/exam-engine/src/attemptCommands.ts:698-702）。
- **截止冻结**（reconcile 或 scanner）：submitAttempt(source="deadline_scanner",
  submissionReason=**'deadline'**, 提交时间=**effectiveDeadline D**（业务回填，非墙钟）；
  观察瞬刻 `now` 只进 interruption 事件（deadlineReconciliation.ts:240-263；
  deadlineScanner.ts:333-349；attemptCommands.ts:604-616）。scanner 绕过
  minSubmitAfterStartMinutes（attemptCommands.ts:653-654 source-gated + ADR-005）。
- **审计副作用**：`attempt.submit` 审计行**仅在 submitAttempt 真正执行时写**（新鲜手动
  交卷 1 次；replay_no_change / deadline_frozen / recovered 均 0 次）
  （submitAndGradeAttempt.ts:272-278）；COMMIT 后同步 emit `attempt.submit.completed`
  日志行（outcome 分类），先于事务外重读（:340-354）。已知盲区：COMMIT 与 emit 之间进程
  崩溃丢日志行，业务事实以 DB 为准（:76-79）。
- **冻结评分工作集**：submitAttempt 冻结 submitted_answers（draft 快照）+ 每冻结题恰一条
  grading entry（attemptCommands.ts:682-712）；true_false 全客观题 → 立即 auto-graded
  → 终态 graded + enrollment finalScore/finalPassed/finalAttemptId（finalizeGrading）。
- **响应构成**：POST submit 200 = 事务外重读的 attempt 投影（submitAndGradeAttempt.ts:
  356-365）；保存 200 = accepted/rejected 联合（**200 ≠ 已保存**）。

### 0.4 边界比较符（恰在截止时刻）

- 权威过期判定：`now.getTime() >= effectiveDeadline.getTime()`（**≥**）
  packages/exam-engine/src/timer.ts:65-74。
- 保存 deadline 守卫同一比较符（answerProtocol.ts:168-180，先 status 守卫后 deadline
  守卫；DEADLINE_EXCEEDED）。
- effectiveDeadline = min(exam.closeAt, attempt.deadlineAt)（timer.ts:29-55）；timed_window
  尝试 deadlineAt = startedAt + durationMinutes（attemptCommands.ts:459-465）。

### 0.5 前端契约

- 交卷对话框：打开即 flush 待保存队列 → 确认后 POST submit（TakeExamPage.tsx:1192-1206）；
  `submittingRef` 同步守卫：同一交卷 episode 内重复点击**零额外 POST**（:1113-1115）。
- 提交失败：toast「提交失败，请重试」，释放守卫可重试（:1146-1157；zh-CN.ts:628）。
- 到点自动交卷：本地到期 → flush → **GET /take 服务端验证** → 仅当快照被 deadline 冻结
  （lockReason='deadline'）或已终态才 POST submit；否则 defer 重新武装（1s 单调冷却）
  （TakeExamPage.tsx:1342-1488）。验证窗口内的手动交卷归 manual。
- 保存指示：SaveIndicator per-question revision 状态；「已保存」以服务端 receipt 为准。

## 1. 案例①：最后改答保存成功后提交 / 保存在途时点击交卷

### ①-a 保存成功 → 提交（live HTTP，真实 nginx）

| 维度 | 预期 |
| --- | --- |
| 保存 | save v1（true）→ 200 accepted:true + serverVersion；save v2（false）→ 200 accepted:true v2。DB receipts clientSeq=[1,2] |
| 提交 | POST submit → 200；DB status=**graded**、submissionReason=**manual**、submittedAt=route 入口样本（≈HTTP 时延前） |
| 冻结答案集 | submitted_answers = **v2（false）**；12 题 grading entries 恰 12 条；score 按 v2 计算 |
| 审计 | attempt.submit 审计行 **恰 1**；attempt.submit.completed outcome=**graded** 1 行 |
| UI（浏览器对照） | 保存指示「已保存」；交卷确认对话框 flush 后提交 → 结果页显示成绩（immediate 发布） |

### ①-b 保存在途时点击交卷 —— save 先取得锁（live HTTP + enrollment FOR UPDATE barrier）

排列：外部事务持 enrollment FOR UPDATE → 发 save v2（阻塞在锁队列）→ 发 submit（排其
后）→ 释放锁 → save 先提交、submit 后提交。

| 维度 | 预期 |
| --- | --- |
| save 响应 | 200 accepted:true serverVersion=2（锁释放后先落账） |
| submit 响应 | 200；outcome=graded |
| 冻结答案集 | submitted_answers 含 **v2**（save 先于 submit 提交） |
| 审计/评分 | attempt.submit 审计 1；grading entries 12；submit.completed outcome=graded |

### ①-b' 保存在途时点击交卷 —— submit 先取得锁（live HTTP + barrier）

排列：外部事务持锁 → 发 submit（队列首位）→ 发 save v2（其后）→ 释放 → submit 先提交。

| 维度 | 预期 |
| --- | --- |
| submit 响应 | 200 outcome=graded，冻结答案集 = **v1**（不含 v2） |
| save 响应 | **HTTP 200 + accepted:false**，reason=**ATTEMPT_ALREADY_SUBMITTED**（不得凭 200 推断已保存；serverVersion 回 1） |
| DB | receipts clientSeq=[1]（v2 无 receipt）；answers JSONB 停在 v1；submit 审计 1 |
| UI（浏览器） | 保存失败文案/状态可见；交卷成功进入终态视图 |

### ①-b-browser（真实浏览器，经隔离代理延迟 save 响应）

排列：浏览器改答（save 在途，代理 hold 响应）→ 点交卷 → 对话框 flush 等待 → 释放 save
响应 → flush 完成 → 确认提交。

| 维度 | 预期 |
| --- | --- |
| UI | 对话框 flush 阶段等待；save 确认后 flush 完成；提交成功 → 结果页 |
| DB | receipts 含该 clientSeq；submitted_answers 含该改答；审计 1 |
| 单操作单请求 | flush 串行队列 → save 恰 1 POST、submit 恰 1 POST（nginx 日志计数） |

## 2. 案例②：截止前服务端已取时，提交处理跨截止（in-process 真路由 + 受控时钟）

工具：buildTestApp（真实路由 + setNowOverride 受控服务端时钟）+ 外部 PG
enrollment FOR UPDATE barrier + 真实 PG（exam_test_s2，harness 自建自清）。API 主进程
停止期间执行（无背景 scanner 竞争；scanner 侧用真函数 `autoSubmitAndGrade` 显式调用）。
live 侧补充记录：route 取时位置（0.1 表）已由代码引用固定。

### ②-a 手动交卷先取得必要锁（取时在截止前，处理跨截止）

排列：attempt.deadline_at=T（SQL 精确设置）→ setNow(T-2s) → inject POST submit（阻塞在
外部持有的 enrollment 锁）→ 实时钟过 T（+1s）→ 释放锁。

| 维度 | 预期 |
| --- | --- |
| 提交原因 | **manual**（reconcile 用 route 样本 now=T-2s：T-2s < T 未过期 → 走手动路径） |
| submittedAt | **= T-2s**（route 入口样本，非锁获得时刻） |
| 终态 | graded；冻结答案集 = 此前已提交的 v1；grading entries 12 |
| 公平性记录 | 业务上「请求已取时在截止前」→ 记为 candidate-wins 线性化；对照：同刻新请求（now>T）会得 deadline 冻结。**落差观察项**：submittedAt 早于实际提交时刻 3s+，审计/时间线按 route 样本记录 |
| UI（由①③浏览器类推） | 200 已提交视图；本案例浏览器面按附录由事务测试覆盖 |

### ②-b scanner 先取得必要锁

排列：deadline_at=T → 实时钟过 T → 调真实 `autoSubmitAndGrade(now=T+1s)`（立即得锁）→
完成后 setNow(T-0.5s) inject POST submit（模拟手动请求取时早但排队晚）。

| 维度 | 预期 |
| --- | --- |
| scanner 效果 | submittedAt=**T（effectiveDeadline 回填）**、reason=**deadline**、graded；scanner 绕过 minSubmit |
| 手动 submit 响应 | 200；orchestrator outcome=**replay_no_change**（锁下重读已 graded）；**零新增写** |
| 审计 | attempt.submit 审计 **0**（scanner 无 audit handle；手动路径未执行 submitAttempt）；submit.completed outcome=replay_no_change 1 行 |
| 冻结答案集 | scanner 时刻的 draft（v1）；之后任何 save → ATTEMPT_ALREADY_SUBMITTED |
| 公平性记录 | scanner 先到 → 手动请求被归并为「已按截止提交」；考生看到 deadline 视图与原 submittedAt=T |

### ②-c 恰在边界：now == effectiveDeadline（受控时钟）

| 维度 | 预期 |
| --- | --- |
| POST submit（now=T 恰等） | **deadline 冻结**（≥ 比较符）：outcome=deadline_frozen、reason=deadline、submittedAt=**T**、审计 0 |
| 依据 | timer.ts:72 `now>=D`；deadlineReconciliation.ts:229-263 |

### ②-d 恰在边界：now = effectiveDeadline − 1ms

| 维度 | 预期 |
| --- | --- |
| POST submit（now=T-1ms） | **手动提交**：outcome=graded、reason=manual、submittedAt=**T-1ms**、审计 1 |

### ②-e 保存侧恰在边界（同一比较符）

| 维度 | 预期 |
| --- | --- |
| POST save（now=T 恰等） | 200 accepted:false reason=**DEADLINE_EXCEEDED**（answerProtocol.ts:173 ≥） |
| POST save（now=T-1ms） | 200 accepted:true（新 receipt+版本） |
| 状态守卫优先级 | 若已 submitted → ATTEMPT_ALREADY_SUBMITTED 先于 DEADLINE_EXCEEDED |

## 3. 案例③：同一 attempt 双击、重试、前一次已提交但响应丢失

### ③-a 协议级双击（live HTTP，两 POST 几乎同刻；barrier 保证顺序）

| 维度 | 预期 |
| --- | --- |
| 第一 POST | 200 outcome=graded；审计 1；submit.completed outcome=graded |
| 第二 POST（排队后） | 200 outcome=**replay_no_change**；**零新增写**（submittedAt/reason/答案集/评分不变）；审计仍 **1**；submit.completed outcome=replay_no_change |
| 唯一业务效果 | 恰一次 submit、恰一套 grading（12）、恰一行审计 |

### ③-b 响应丢失后恢复（live HTTP，经隔离代理吞掉 submit 响应）

| 维度 | 预期 |
| --- | --- |
| 客户端所见 | 连接被重置（无 HTTP 响应）——客户端**不能**据此判断成败 |
| 权威恢复读 | GET /attempts/:id → status=graded/submitted 投影（已提交已评分分别核对：DB status + grading entries + enrollment finalScore） |
| 重试 POST submit | 200 outcome=replay_no_change；审计仍 1；无重复评分 |
| DB | submittedAt/reason 与第一次提交一致（不被重试改写） |

### ③-c 浏览器双击（真实浏览器）

| 维度 | 预期 |
| --- | --- |
| 实际发送数 | 提交确认按钮连击 → **恰 1 个** POST /submit（submittingRef 同步守卫；nginx 日志计数=1） |
| UI | 一次提交成功 → 结果页；无二次提交 UI |

### ③-d 浏览器响应丢失 + 重试（真实浏览器，经隔离代理）

| 维度 | 预期 |
| --- | --- |
| UI | submit POST 响应被吞 → toast「提交失败，请重试」；页面仍在考试视图 |
| 重试 | 再点提交 → 1 个新 POST → 200 replay 幂等 → 结果页显示**已评分**成绩 |
| DB | 审计 1、grading 12、finalScore 写入恰一次 |

## 4. 案例④：服务重启发生在入事务前 / 已提交但响应未送达（隔离代理 + topology api-restart）

### ④-A 重启在入事务前（代理 hold 请求未转发 → api-restart → 转发）

| 维度 | 预期 |
| --- | --- |
| 重启后、转发前 PG 重读 | attempt 仍 **in_progress**（内存等待/自动保存不能证明已提交） |
| 转发后 | 新进程完成交卷：200 outcome=graded、reason=manual、审计 1 |
| 重启不产生业务副作用 | 重启窗口内无 submit 审计/评分/状态变化 |

### ④-B 已提交但响应未送达（代理吞响应 → api-restart → 断开客户端）

| 维度 | 预期 |
| --- | --- |
| PG（重启后重读） | status=graded、submittedAt=第一次提交样本、reason=manual、审计 1、评分 12、finalScore 已写（COMMIT 已发生，与进程存活无关） |
| 浏览器恢复 | 会话随 JWT secret 轮换失效（研究拓扑 R3 每启动轮换；**产品部署 secret 固定则会话存活**——记为拓扑差异）。重登后考试列表/结果页显示已提交已评分；再取 /take → 终态冻结视图（lockReason submitted/deadline） |
| 重试 POST | replay_no_change 幂等 |

## 5. 判据与记录纪律

- 「已保存/已提交/已评分」分别核对：receipts+answers JSONB（保存）、status+submittedAt+
  submissionReason+审计行（提交）、grading entries+enrollment finalScore（评分）。
- 每案例实测记录 wall（PG now()/ISO/submittedAt）与 mono（harness performance.now()
  时间线）两类时钟；生产路径不用单调钟的事实单列。
- 任何与上表不符的实测 → semanticErrors（最小见证路径）+ 与既有语义/产品公平性的落差
  分别记录。

## 6. 实测后回填

（实测结果见 s2-findings.json / RESULTS 引用；本文预期部分实测后不修改——修订需另行
留痕。）
