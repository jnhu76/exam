# 07 — 持久化、并发与恢复架构

> **REPORT-CORRECTIVE-1**：本报告**保留原样**（事务/锁/CAS/恢复仲裁表在 corrective
> 中复核未发现错误）。corrective 变更见 13 报告。

scope：correctness-critical 命令的事务/锁/约束/CAS/幂等/恢复路径与不变量仲裁者；second authority 与竞态扫描。method：SA2 §6 全表 + SA3+4 恢复证据 + 主 agent 复核。全部 OBSERVED_CODE 除非另注。

## 1. 事务基础设施

- `executeInTransaction`（packages/db/src/types.ts:161-210）：默认 **REPEATABLE READ**，40001/40P01 指数退避重试 ×3（20/40/80ms）；23505 不全局重试（由调用方按语义精确恢复）。
- attempt-start 路由显式降级 **READ COMMITTED**（attempts.candidate.ts:727-729；注释解释 RR 看不见并发 insert 会破坏双击开局幂等——types.ts:141-148）。
- 锁序 **Enrollment→Attempt→Exam** 全仓统一（`lockSeam.ts:69-121`，含 DO-NOT-REORDER 注释、capability witness、repo-affinity 断言 :138-154）；`lint` 级结构测试 `lock-order.structural.test.ts` 锁定。未发现 Exam→Attempt 倒置。

## 2. 不变量仲裁者总表

| 命令 | 事务 | 行锁 | 约束/CAS | 幂等键/语义 | 恢复路径 |
| --- | --- | --- | --- | --- | --- |
| attempt start | READ COMMITTED | E→A FU（seam） | unique(org,enrollment,attemptNo) | seam+attemptNo：双击返回既有 attempt | — |
| answer save | RR | E→A FU + affinity 断言 | baseVersion==current（CAS） | questionId:clientSeq 持久化回执（jsonb） | 重放零写 |
| candidate submit | RR | E→A FU | unique + workset 精确一致校验 | already-submitted-first 幂等 | submitted 崩溃恢复=补批改不重提交 |
| deadline 自动提交 | RR | E→A FU + Exam FU | 锁下 kernel 复查 | 状态复查 | SIGKILL 进程测试：重启 ≤30s 追赶（MEASURED：runtime/processRestartDeadline.process.test.ts） |
| admin force-submit / misconduct / time-grant | RR | E→A FU / Attempt FU | **attempt_command_receipts UNIQUE(org,operation_id)**；time adjustments UNIQUE(org,operation_id)+delta CHECK | operationId + 23505 精确恢复 + 已提交事实==payload 后置条件（否则回滚） | receipt 重放/冲突分类 |
| heartbeat | 无事务（单原子 UPDATE） | 行写锁隐含 | status-qualified WHERE（TOCTOU 封闭）+ RETURNING | last-write-wins 时间戳 | — |
| disruption | RR | Attempt FU | 指针 CHECK（disrupted⇔interruption） | 锁下 staleness 复查（fresh_under_lock / state_changed_before_lock） | restore |
| restore | RR | E→A FU + Exam FU + episode FU | adjustment bounded unique per interruptionId | episode/event 身份校验 + 既有 outcome 拒绝 | bounded_grace 补偿复用 |
| grading finalize | RR | Attempt 经 capability；Enrollment 写锁 | workset unique(attempt,question) | graded 早退 + pending_manual 永不自动终结 | — |
| manual gradeQuestion | RR | Attempt FU（调用方） | workset unique | entry.status 单向权威（无幂等键，one-way） | — |
| admission join/admit/consume | 调用方 tx（join=逐句自动提交；start=同事务） | Enrollment FU（start 路径） | partial unique 活跃成员；admitOnce/consumeActive CAS | onConflictDoNothing；CAS 零行→中止 fail-closed | 从行重建批次计划 |
| exam transitions / publishResults | RR | Exam FU | — | close 幂等 / resultsPublishedAt write-once 单赢家 | — |
| email outbox | RR | SKIP LOCKED + 锁超时恢复 | worker_heartbeats 行 | at-least-once | recoverAbandoned |

## 3. Second authority / 竞态扫描结论

- **SECOND AUTHORITY：未发现**。扫描器指标、限流内存计数均为显式非权威；in-memory examQueues 已被 exam_admissions 表取代（start 路由注释 #292）。
- **CHECK-THEN-ACT**：全部有 DB 后备（admission reconcile→CAS；submit update-by-id→四调用方全部持锁已审计；flagMisconduct 无锁但 informational-only；save 路径 closeAt 非加锁读→F5-03；receipt 预读仅为 advisory、INSERT 为仲裁者）。
- **重试改变语义**：RR 重试只作用于 40001/40P01（序列化冲突），重试体内 now 由路由入口采样单次注入——重试不改变业务时间语义；23505 按命令精确恢复而非盲目重试。
- **process-local completion**：无。唯一进程态（audit 写缓冲）在 shutdown drain ≤10s，超时显式记日志放弃（auditLifecycle）。
- DB 级状态列无 CHECK（F1-03）：完整性由"唯一写入口=引擎命令+锁"保证，raw SQL/新代码可绕过——与 email_outbox_status_check（0018 迁移）形成对照。

## 4. 恢复架构

| 故障 | 恢复 |
| --- | --- |
| 候选人刷新/断网 | take GET（no-store）+ restore 端点恢复已存答案与剩余时间；disrupted 由心跳扫描标记、start/restore 恢复 |
| API 崩溃（SIGKILL 级） | 全部真相在 DB：重启后 deadlineScanner ≤30s 追赶自动提交（真实子进程测试证明）；admission 从行重建；email SKIP LOCKED 领锁恢复；submitted 状态补批改 |
| in-flight 事务 | PG 原子性：单事务（冻结+批改）要么全有要么全无；submit 半途崩溃落在 submitted（有恢复路径）或未提交 |
| 双实例 | 事务收敛（锁+CAS+unique）；扫描重复但无害；部署契约为单容器 |
| DB 不可用 | 请求失败、进程存活、后台循环退避重试（log-and-continue）；恢复后自愈 |
| 备份/恢复 | 冷备/逻辑备/PITR/升级 9 个部署测试 + backup_runs DB 强制真实性（备份成功⇒校验 CHECK）；RPO/RTO 显式 UNKNOWN/NOT_ENFORCED 诚实投影 |

## 5. Findings

继承 03/05 的相关 finding（F1-03 状态列、F5-03 closeAt 非加锁读、F8-03 无提交回执、F6-05 email 双轨）；无新增 BLOCKER/MAJOR。

## 6. Unknowns

- bounded_grace 补偿算术逐行审计未做（seam 级已审）。
- 大数据量下 RR 长事务与 vacuum 交互（未测）。
