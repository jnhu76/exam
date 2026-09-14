# 03 — Attempt 状态、时间权威、准入、提交/批改深审

> **REPORT-CORRECTIVE-1**：本报告**保留原样**（状态机/时间内核/准入/提交批改的事实与
> 锚点在 corrective 中复核未发现错误；F1-03/F2-03/F4-03/F5-03/F6-03/F7-03/F8-03 的
> 登记语义不变，统一登记见 11 报告）。corrective 变更见 13 报告。

scope：exam/enrollment/attempt 三个状态机的完整转换表、时间权威判定、answer save 协议、提交与批改不变量、准入架构。method：SA2 子代理逐文件推导（全部 OBSERVED_CODE，file:line 锚点），主 agent 复核关键结论并以隔离环境运行实验（MEASURED，报告 08 引用同一批实验）。confidence：高（结论均有双锚点或可执行测试）。

## 1. Exam 状态机（全部转换）

状态（`packages/domain/src/enums.ts:166-176`）：`draft, published, open, closed, canceled, archived`。
转换表（`examStateMachine.ts:5-12`，`assertTransition:26-35` 守卫）：

| from → to | 命令（写 owner） | 备注 |
| --- | --- | --- |
| draft → published | `publishExam`（examCommands.ts:101-250） | **在此冻结 questionSnapshot**（:244-247）+ 全量策略校验 |
| published → draft | `unpublishExam`（:334-348） | route 先 reconcile，拒绝 open |
| published → open | `openExam`（:252-267） | 亦有 lazy auto-open（`checkAndUpdateExamStatus:413-444`） |
| published → canceled / archived | `cancelExam`（:309-323）等 | |
| open → closed | `closeExam`（:278-297，对 closed 幂等） | closeAt 到期自动或手动 |
| closed/canceled → archived | — | archived 终态 |

写入口统一为 `executeAdminExamTransition`（`routes/examTransitionExecutor.ts:44-80`：Exam FOR UPDATE → reconcile → command → 原子审计）。`extendExam`（:360-393）非状态转换（open→open，closeAt 延长）。`publishResults`（:491-520）为 write-once 单赢家（resultsPublishedAt）。

## 2. Attempt 状态机（全部转换）

状态（`enums.ts:94-104`）：`not_started, queued, in_progress, disrupted, submitted, grading, graded, voided`。
其中 **`not_started/queued/voided` 为保留不可达**（全仓 grep 无生产 writer；`enums.spec.ts:46-49` 自认 reserved）；**`grading` 为幻影状态**（见 finding F2-03）。

| from : command → to | 写 owner | 触发者 |
| --- | --- | --- |
| in_progress : submit → submitted | `submitAttempt`（attemptCommands.ts:468-597） | 候选人提交 / scanner 自动 / admin 强制 |
| in_progress : disrupt → disrupted | `markDisrupted`（:633-702） | heartbeat 扫描器（plugins/heartbeat.ts:130-155） |
| disrupted : submit → submitted | 同 submitAttempt | 同上 |
| disrupted : restore → in_progress | `restoreAttemptState`（:738-767）/ `restoreInterruptedAttempt` | POST /attempts/:id/restore、start 路由恢复分支 |
| submitted : grade → grading | `finalizeTerminalGrading` 中的 transition()（grading.ts:259） | **表中有、落库无**：实际持久写 submitted→graded（grading.ts:278-301） |
| grading : complete_grading → graded | — | 不可达（无入口 writer） |

事务/锁：所有变更命令运行于调用方的 `executeInTransaction`（默认 REPEATABLE READ，`packages/db/src/types.ts:161-210`；40001/40P01 重试 ×3），持有 Attempt FOR UPDATE，经 **lockSeam 固定锁序 Enrollment→Attempt→Exam**（`lockSeam.ts:69-121`，含 affinity 断言 :138-154）。attempt-start 路由特例改用 READ COMMITTED（`attempts.candidate.ts:727-729`，RR 看不到并发 insert 会破坏双击开局幂等）。
DB 侧：`exam_attempts.status` 为裸 text 无 CHECK（finding F1-03）；唯一相关 CHECK 为 disrupted⇔interruption 指针一致性（pg.ts:639）；unique(org,enrollment,attemptNo)（pg.ts:533-537）。

## 3. Enrollment 状态机

状态（`enums.ts:158-162`）：`assigned, started, completed, blocked`。
转换：assigned→started（attempt start，同一 start 事务、Enrollment 锁内，attemptCommands.ts:424-433）；started→completed（批改 finalize 同事务投影，grading.ts:331-353）；blocked 无生产 writer（保留）。DB：unique(org,exam,candidate)，裸 text 无 CHECK。

## 4. 时间权威判定（规范核心问题的答案）

**裁决：存在 ONE 语义 kernel。**

- kernel = `exam-engine/src/timer.ts`：`computeEffectiveDeadline`（:29-55，min(exam.closeAt, attempt.deadlineAt)；只有 closeAt 无 deadline 属 fail-closed ValidationError；两者皆 null = 永不过期）+ `isAttemptDeadlineExpired`（:65-74，now >= ED）。
- 两条冻结路径都经过 kernel：**lazy reconciliation**（`deadlineReconciliation.ts:161-263`，take/save/submit/restore/grant 全部经过）与 **deadlineScanner**（`plugins/deadlineScanner.ts:147-273`，30s 周期，锁下用 kernel 复查 :191-197）。
- 全部"到期"判定点穷举（SA2）：(1) kernel 本体；(2) `answerProtocol.ts:140` 的内联比较——**唯一的字面重复谓词**，但其值来自 kernel 的 mutation context（语义等价 `>=`）；(3) take 视图 isEditable/canSubmit 投影（只读）；(4) start 窗口/late-entry/min-submit 准入守卫；(5) submit 的 min-submit 反向守卫；(6) grant 的 closeAt 上限；(7) exam 级 auto open/close；(8) enrollment 完成判定；(9) 心跳过期（disruption 权威，非 deadline）；(10) 准入批次计划（自述"QUEUE AUTHORITY IS NOT TIME AUTHORITY"，admissionCommands.ts:7-11）；(11) 客户端倒计时（TakeExamPage.tsx:958-999，UX only，服务端重判）。
- **无进程内存第二权威**：scanner/heartbeat 每 tick 无状态重建；sync deadline 是 exam 行的纯函数。

到期后发生什么：自动 submit+grade（submissionReason='deadline'）；save 由独立守卫阻止（扫描器 30s 滞后只延迟冻结，不延迟答案封笔）。lazy 路径 submittedAt=effectiveDeadline（业务时间），scanner 路径 submittedAt=tick now——同一 reason code 两种时间形状（F6-03）。

竞态结论（SA2 竞态分析 + EXAM-341 确定性竞态测试 `attemptLifecycleRaceTraces.test.ts`）：
- 截止前的 save 在行锁上排队、提交时已过线：**按请求到达时刻判定**（ADR-006 单 now 原则），有界、by design（F4-03）。
- save 与 submit 双赢情形由 E→A 锁 + 先 reconcile 序列化；提交后 save 不可达（ATTEMPT_ALREADY_SUBMITTED）。
- closeAt 缩短 PATCH vs 进行中的 save：save 路径**非加锁读 Exam**，一个请求生命周期内可用旧 closeAt 判定（F5-03，自愈）。

## 5. Answer Save 协议

持久化：`exam_attempts.answers` jsonb（草稿 AnswerRecord[]，含 clientSeq/clientSeqHistory 回执；无独立草稿表）。
守卫序（`answerProtocol.ts` processSaveAnswer :100-249）：身份绑定 → 冻结快照题目成员（P1）→ 状态（提交后 ATTEMPT_ALREADY_SUBMITTED）→ deadline（经 kernel 值）→ 规范化（#301）→ **幂等键 `questionId:clientSeq`**（同载荷重放=不写接受；异载荷=CONFLICTING_PAYLOAD）→ **CAS baseVersion**（STALE_VERSION/FUTURE_VERSION）→ 接受则 version+1。
并发：整个 RMW 在 E→A FOR UPDATE 之下 + repo-affinity 断言；重放/拒绝零写。
**裁决：协议强**——版本化、幂等、冲突检测、到期拦截、成员校验全部在案；无 post-submit 草稿写入路径。

## 6. 提交 / 冻结 / 批改

- 候选人提交 = 单 RR 事务（`orchestrators/submitAndGradeAttempt.ts:55-268`）：EA 锁 → 所有权 → 分支（graded 终态幂等；in_progress/disrupted 先 reconcile 再 submitAttempt；submitted 走崩溃恢复不重复提交）→ 冻结屏障（写 submitted_answers schemaVersion 1 + workset）→ 手改挂起（pending_manual）则停在 submitted，否则同事务 finalize。
- **双提交裁决：有保护**——行锁串行 + already-submitted-first 幂等路径（校验 workset 精确一致）+ zero-entries fail-closed + unique(org,enrollment,attemptNo)（SA2 §4）。无 operationId 回执（F8-03：够用，审计靠 audit_logs）。
- admin 强制提交为**回执优先**：`attempt_command_receipts` UNIQUE(org,operation_id) 为跨命令仲裁者，精确 23505 恢复 + 事务后置条件（已提交事实==存储 payload 否则回滚）（`forceSubmitExecution.ts`）。SA2 评价：very strong。
- 冻结点：`submitted_answers`（按快照序、未答=null）+ submissionReason + gradingStatus 分类 + grading workset，全部在 submit 事务、attempt 锁内；批改只读冻结真相（draft 兜底仅 legacy NULL 行，P3-L0-4 backfill 脚本在列）。
- 手动批改：entry.status 单向 pending_manual→completed_manual（status 为权威）；最后一份完成触发同事务 finalize；pending_manual 永不自动终结（grading.ts:399-404）。
- 结果可见性：`candidateResultVisibility.ts:55-103` 单一权威（两段：resultReady + 发布门 immediate/after_grading/manual+publishResults）；隐藏时分数真值仍在 DB，wire 层裁剪。

## 7. 准入架构

**裁决：durable-fact 正确设计。** 全部事实在 `exam_admissions` 行（joined_at 锚/admitted_at/consumed_at）；生命周期状态为时间戳推导（永不存储）；partial unique index 保证单活跃成员；join 幂等（onConflictDoNothing）；admitOnce CAS `WHERE admitted_at IS NULL`；consumeActive CAS 与 attempt 创建同事务（Enrollment 锁串行化，零行中止 fail-closed）；start-gate 仅 new-attempt 路径、requireQueue 时 fail-closed。操作员面只读（exam.ts:2195 明示无手动准入）。重启安全：批次计划可从行重建。
**放行触发（本审计补充的关键机制事实）**：`reconcileAdmission` 仅有的两个调用点均为考生请求驱动：POST /attempts/:examId/queue（`attempts.candidate.ts:597-598`）与 start 门的 `ensureStartAdmission`（`admissionCommands.ts:361` ← `attemptCommands.ts:316`，主 agent 复核 SA5 纠正后确认）——**没有后台循环物化放行**；真实前端以重发 queue 端点轮询（StartExamPage.tsx:71-94）。
MEASURED（报告 08）：停轮询后的积压批次在下次轮询时一次性补放（56 人同刻就绪）；分批节奏只在考生持续轮询时成立。此为 MINOR 级 finding（F-08 系列见 11 报告）。

## 8. 快照 / 冻结验证

- 发布冻结 questionSnapshot（examCommands.ts:244-247）；published 后 PATCH 仅 openAt/closeAt（exam.ts:926-962"questions/controlFlags/score policy are frozen"）。
- attempt 开局复制快照（shuffle 一次性，resume/restore 永不重随机，attemptCommands.ts:141-148）；interruption 策略快照列 CHECK 约束冻结。
- 题库后续修改不可触及运行中 attempt（快照为值拷贝；无生产路径向运行中 attempt 重读活题）。策略 profile 为 apply 时拷贝（copy-on-apply），运行时零依赖。
- **closeAt 例外（有意设计）**：发布后 closeAt 修改会通过 kernel 影响运行中 attempt（min(closeAt, deadlineAt)）。

## 9. 不变量仲裁者总表（节选）

| 命令 | 事务 | 行锁 | 约束/CAS | 幂等 |
| --- | --- | --- | --- | --- |
| attempt start | RR→READ COMMITTED（route 特例） | E→A FU（seam） | unique(org,enrollment,attemptNo) | seam+attemptNo 使双击返回既有 |
| answer save | RR | E→A FU | baseVersion CAS（锁+双保险） | questionId:clientSeq（持久化回执） |
| candidate submit | RR | E→A FU | unique + already-submitted 幂等 | 状态幂等（无回执表，F8-03） |
| deadline auto-submit | RR | E→A FU + Exam FU | 锁下 kernel 复查 | 状态复查 |
| admin force-submit / misconduct / time-grant | RR | E→A FU / Attempt FU | receipts UNIQUE(org,operation_id) / adjustments UNIQUE(org,operation_id) | operationId + 23505 精确恢复 + payload 相等校验 |
| admission admit/consume | 调用方 tx | Enrollment FU（start 路径） | partial unique + CAS | onConflictDoNothing；CAS 零行中止 |
| exam transitions / publishResults | RR | Exam FU | — | close 幂等 / resultsPublishedAt 单赢家 |

CHECK-THEN-ACT 扫描（SA2）：未发现缺 DB 后备者；风险模式全部有缓解（admission reconcile→CAS；submit update-by-id→调用方全部持锁已审计；flagMisconduct 无锁但 informational-only；save 路径 closeAt 非加锁读→F5-03）。

## 10. Findings（本报告范围；统一登记见 11）

| ID | 级别 | 摘要 |
| --- | --- | --- |
| F1-03 | MINOR（SA2 定 MEDIUM-candidate，主 agent 复核后降级：状态机单一写入口 + 结构性测试使风险主要在 raw SQL/新代码，不直接构成真实考试失败路径） | exam/enrollment/attempt status 裸 text 无 CHECK/enum，完整性仅应用层 |
| F2-03 | MINOR | `grading` 幻影状态：转换表有、落库无（崩溃窗口实际落在 submitted，已有恢复路径） |
| F3-03 | NOTE | voided/not_started/queued 保留无 writer，守卫面死代码；意图 UNKNOWN |
| F4-03 | NOTE（by design） | deadline 边界=请求到达时刻，非提交时刻；锁排队可致业务上"截止后落库"的合法 save |
| F5-03 | MINOR | save/lazy 路径非加锁读 closeAt；发布后缩短 closeAt 可被单请求绕过（自愈） |
| F6-03 | MINOR | 同一 submissionReason='deadline' 两种 submittedAt 语义（lazy=effectiveDeadline / scanner=tick） |
| F7-03 | CANDIDATE | scanner 发现查询 OR 条件无 status 覆盖索引，每 30s per-org 顺序扫描；大 attempt 量下成本未测 |
| F8-03 | NOTE | 候选人提交无持久 operationId（依赖锁+状态幂等；够用） |

## 11. Unknowns

- 多副本下 scanner 重复扫描实测（代码判定安全）。
- 生产数据中 legacy NULL submitted_answers 行数（backfill 未执行状态）。
- restore 的 bounded_grace 算术仅审到 seam 级（restoreInterruption.ts:322-380），未逐行。
- take GET（command-style GET + no-store）在反代/CDN 层的缓存行为（基础设施未知）。
