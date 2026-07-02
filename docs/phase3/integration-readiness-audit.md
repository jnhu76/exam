# Phase 3 集成就绪审计

> **目的：** 判定每个已实现的 Phase 3 能力是否真正接入了真实 MVP 考试流程，还是仅作为孤立基础设施存在。本审计停止随机 Middle 实现，并识别进一步工作前必须设计的内容。
>
> **日期：** 2026-07-02
>
> **MVP 流程基线：**
> 教师创建题目/试卷 → 教师发布考试 → 考生开始考试 → 考生作答 → 考生提交 → 后端冻结最终答案 → 阅卷员/教师评分 → 结果发布 → 考生查看结果 → 可选通知发送

---

## 1. 执行摘要

**核心发现：** 多数 Phase 3 能力作为测试充分的基础设施存在，但**未**接入真实 MVP 考试流程。代码库有强大的构建块——RBAC catalog、email outbox、audit 事件、proctor 监控 API、评分队列、人工评分引擎——但各自孤立运作。把它们连接起来需要 Large 设计文档，而非更多随机 Middle 实现。

**关键缺口（阻塞）：**

| 缺口 | 严重度 | 阻塞 |
|-----|----------|--------|
| Email outbox 无业务调用方 | 高 | 任何通知 |
| RBAC `requireCapability` 迁移未完成——约 80% 路由仍用 `requireRole` | 高 | Scoped 角色落地 |
| 主观题作答在前端不可渲染 | 高 | 端到端人工评分 |
| Proctor 监控为只读轮询——无实时、无权限动作角色边界 | 中 | 实时监考 |
| Redis 纯诊断——无业务用例证明其必要性 | 中 | Redis 边界清晰度 |
| `grading.detail_viewed` 审计触发，但评分 UI 中考生作答展示被前端作答渲染阻塞 | 中 | 阅卷员工作流 |

**已稳固且生产就绪：**
- 答案保存协议（版本化、幂等、冲突检测）
- 提交 + 冻结屏障（事务性、并发安全）
- 考试生命周期状态机（所有转换经命令函数）
- 题目快照（编辑不影响进行中 attempt）
- 结果发布模式（immediate / after_grading / manual）
- 审计事件基础设施（闭合 union、fire-and-forget、已校验）
- 评分队列 + 人工评分引擎（纯逻辑、已测试）
- Redis 降级守卫（考生流程从不触碰 Redis）

**存在但需设计接受：**
- RBAC 架构（ADR 状态：Proposed，未 Accepted）
- Email 通知触发点（基础设施就绪，无触发点设计）
- Proctor 权限设计（监控可用，角色边界未定义）

---

## 2. MVP 流程基线

```
教师创建题目/试卷
  └─ attempt 创建时题目快照 ✓
  └─ 题目 CRUD 含审计 ✓

教师发布考试
  └─ publishExam 命令 ✓
  └─ 审计：exam.publish ✓

考生开始考试
  └─ startOrRestoreAttempt ✓
  └─ 审计：attempt.start ✓

考生作答
  └─ processSaveAnswer（版本化、幂等） ✓
  └─ 审计：attempt.saveAnswer ✓
  └─ 主观作答输入 ✗（前端缺口）

考生提交
  └─ submitAndGradeAttempt（事务性） ✓
  └─ submitFreezeBarrier（并发安全） ✓
  └─ 审计：attempt.submit ✓

后端冻结最终答案
  └─ attempt 创建时快照冻结 ✓
  └─ 答案协议在提交时冻结 ✓

阅卷员/教师评分
  └─ 自动评分引擎 ✓
  └─ 人工评分队列 + API ✓
  └─ 评分详情页（admin） ✓
  └─ grading.score_entered / grading.finalized 审计 ✓
  └─ 评分 UI 中考生作答展示 ⚠️（后端就绪，前端被阻塞）

结果发布
  └─ publishResults 命令 ✓
  └─ computeResultVisibility（3 种模式） ✓
  └─ 审计：exam.publish_results ✓

考生查看结果
  └─ GET /scores/attempts/:attemptId ✓
  └─ 考生视图剥离 standardAnswer ✓
  └─ 发布门控强制 ✓

可选通知发送
  └─ Email outbox 基础设施 ✓
  └─ 业务流程调用方 ✗（无路由调用 enqueueEmail/enqueueBestEffort）
```

---

## 3. 能力接线矩阵

| 能力 | 基础设施已建 | 接入 MVP 流程 | 结论 |
|---|---|---|---|
| RBAC catalog（权限、预设、resolver） | 完整 | 部分——新路由用 `requireCapability`，legacy 用 `requireRole` | **部分** |
| RBAC 路由注册表 + shadow 模式 | 完整 | 活跃——shadow 比对并行运行 | **部分** |
| RBAC ADR（Scoped RBAC 架构） | Proposed | 未接受——基础已合并但 ADR 仍 Proposed | **未接受** |
| Email outbox（outboxService、notificationService、senders） | 完整 | 否——零业务调用方 | **否** |
| Email 诊断（/system/diagnostics 中 emailStatus） | 完整 | 是——admin 诊断页可见 | **是** |
| Redis（插件、ping、前缀隔离） | 完整 | 仅诊断——无业务用途 | **是（仅诊断）** |
| Redis 降级守卫 | 完整 | 是——考生流程证明 Redis 无关 | **是** |
| 诊断 API（/system/diagnostics） | 完整 | 是——admin 页、健康检查、扫描器状态 | **是** |
| 诊断前端（SystemDiagnosticsPage） | 完整 | 是——渲染 DB、Redis、email、worker 状态 | **是** |
| 审计事件（recordAudit、闭合 union） | 完整 | 是——所有主要路由发出审计事件 | **是** |
| 审计日志查询（GET /admin/audit-logs） | 完整 | 是——admin 审计日志页 | **是** |
| 评分队列 API | 完整 | 是——admin 评分队列页、人工评分流程 | **是** |
| 评分详情 API | 完整 | 是——admin 评分详情页 | **是** |
| 人工评分引擎（gradeQuestion、reconcileScores） | 完整 | 是——经评分队列 POST 端点 | **是** |
| 评分作答可见性（剥离 standardAnswer） | 完整 | 是——考生看到分数但看不到正确答案 | **是** |
| Proctor 监控 API（attempts、events） | 完整 | 部分——admin 页轮询，但尚无 Proctor 角色 | **部分** |
| Proctor 事件日志 v0 | 完整 | 部分——写审计事件，无 UI 动作流程 | **部分** |
| 答案保存协议 | 完整 | 是——考生保存端点、冲突检测 | **是** |
| 提交冻结屏障 | 完整 | 是——事务性提交 + 评分 | **是** |
| 考试生命周期状态机 | 完整 | 是——所有转换经命令 | **是** |
| 题目快照 | 完整 | 是——attempt 创建时快照 | **是** |
| 结果发布（3 种模式） | 完整 | 是——computeResultVisibility、publishResults | **是** |
| 主观作答渲染（前端） | 无 | 否——fill_blank 渲染文本输入，无富文本/画图 | **否** |
| Email 通知触发 | 无 | 否——无业务流程调用 enqueueEmail | **否** |

---

## 4. RBAC 接线状态

**已实现能力：**
- `packages/authz/` —— 完整权限 catalog（85 个权限）、每角色预设（6 个角色）、resolver、legacyMap
- Shadow 模式：`apps/api/src/authz/shadow.ts` —— 在同一函数内依次运行 `requireRole` 与 `requireCapability`，记录分歧（legacy 保持权威）
- 路由注册表：`apps/api/src/authz/routeRegistry.ts` —— 共 77 个路由，每个 legacy `requireRole` 路由映射到计划权限/作用域/resolver
- Admin 兼容预设：授予 Admin 所有 admin 权限（向后兼容；有意排除 Candidate-own 与 System-only 权限，如 ExamTake、Attempt*、ScoreOwnView、SystemAutoSubmit 等）
- RBAC ADR（`docs/phase3/rbac/adr-scoped-rbac-architecture.md`）—— 状态：**Proposed**（未 Accepted）
- RBAC 作业队列（`docs/phase3/rbac/RBAC-JOB-QUEUE.md`）—— 作业 0-16 已合并，作业 17（RBAC-M10-finish）仍 open

**当前产品入口：**
- 12 个路由迁移到 `requireCapability`：proctorMonitoring（3）、gradingQueue（3）、attempts.admin（6）
- 59 处 `requireRole(["Admin"])` 分布在 14 个路由文件：exam、question、candidate、user、settings、course、email、export、audit 等

**接入 MVP 了吗？** **部分** —— 新路由用能力门控；legacy 路由靠角色检查仅 Admin。ADR 为 Proposed，未 Accepted。

**缺失设计：**
- RBAC ADR 接受（状态：Proposed）—— 10 阶段迁移计划需正式接受
- RBAC-L7：Scoped 角色派单（Proctor 只见被分配考试、Grader 只见被分配 attempt）
- RBAC-M10：把 scope resolver 接入请求生命周期（resolver 存在且已测试，但从未被任何路由/插件构造或调用）
- Phase 3 角色（Teacher、Proctor、Grader）各需哪些路由的哪些权限？
- 何时把 `requireRole` 完全替换为 `requireCapability`？

**缺失实现：**
- 剩余 59 处 `requireRole` 路由迁移到 `requireCapability`
- Proctor 角色激活（当前仅 Admin）
- Grader 角色作用域（attempt 级还是考试级？）
- RBAC-M10 scope resolver 接线（作业 17 open）

**相关 Large Job：** RBAC-L7（Scoped RBAC 架构 + 权限矩阵）

**推荐下一步：** 在迁移更多路由前先接受 RBAC-L7 设计（当前 Proposed）。Shadow 模式正在发挥作用——在权限-角色矩阵设计完成且 ADR 被接受前，停止添加 `requireCapability` 调用。作业 17（RBAC-M10-finish）阻塞于 ADR 接受。

**暂不可做：**
- 不要创建 Proctor 角色 UI 或 proctor_assignments 表
- 不要无设计文档把 exam/question/candidate 路由迁移到 `requireCapability`
- 不要把 `requireCapability` 暴露给前端（useCapability hook 存在但只读）

---

## 5. Email / 通知接线状态

**已实现能力：**
- `apps/api/src/email/outboxService.ts` —— outbox worker（processDueEmails、retry、failure）
- `apps/api/src/email/notificationService.ts` —— enqueueEmail、enqueueBestEffort、enqueueTestEmail
- `apps/api/src/email/senders.ts` —— DisabledEmailSender（EMAIL_ENABLED=false）+ 真实 sender
- `apps/api/src/email/retryPolicy.ts` —— 指数退避
- `apps/api/src/email/sanitizeError.ts` —— 从错误信息中擦除密钥
- `apps/api/src/routes/email.ts` —— POST /email/test（仅 admin 测试端点）
- 审计事件：email.outbox_created、email.send_failed、email.send_retried

**当前产品入口：**
- POST /email/test —— admin 可发测试邮件
- GET /system/diagnostics —— 显示 emailStatus（启用/禁用、待发/已发/失败计数）
- **无业务流程调用 enqueueEmail 或 enqueueBestEffort**

**接入 MVP 了吗？** **否** —— 纯基础设施，零业务调用方。Worker 仅手动触发（无后台守护进程）。

**缺失设计：**
- Email-Template-L1：哪些 MVP 事件触发邮件？（考试发布、结果发布、密码重置？）
- Email-Trigger-L2：业务流程何处调用 enqueueBestEffort？
- Email-Worker-L3：后台守护进程还是手动触发？（当前仅手动）
- Email-Template-L4：i18n 模板（docs/phase3/emails/ 有草稿）

**EmailType 枚举实测：** 当前 `packages/domain/src/email.ts` 定义 7 个值：`registration_welcome`、`password_reset`、`admin_created_user`、`exam_notification`、`grade_notification`、`system_alert`、`test_email`。含 `grade_notification`，但**不含** `result_published`。

**缺失实现：**
- 业务流程集成点（考试发布 → 通知已报名考生，结果发布 → 通知考生）
- 后台 worker 守护进程（按间隔 processDueEmails）
- 邮件模板渲染（zh-CN 主题/正文）

**相关 Large Job：** Email-Template-L1（Email 通知设计）

**推荐下一步：** 设计哪些事件触发邮件、何时触发。基础设施已就绪——问题在发什么、何时发。

**暂不可做：**
- 不要无设计给业务路由加 enqueueBestEffort 调用
- 不要构建邮件模板渲染
- 不要实现后台 worker 守护进程
- 不要给 outbox schema 加新邮件类型

---

## 6. Redis 使用边界

**已实现能力：**
- `apps/api/src/plugins/redis.ts` —— Fastify Redis 插件（可选、优雅降级）
- `packages/db/src/testScope.ts` —— 测试用 Redis 前缀隔离
- `apps/api/src/routes/testRedis.ts` —— 测试 Redis setup helper
- `apps/api/src/routes/attempts/redis-fallback-guard.test.ts` —— 证明考生流程从不触碰 Redis
- `apps/api/src/routes/system.ts` —— 诊断显示 Redis 连接/延迟

**当前产品入口：**
- GET /system/diagnostics —— 显示 `redisStatus: { connected, latencyMs }`
- **无业务流程读写 Redis**
- **无考生、作答、评分、考试代码路径触碰 Redis**

**接入 MVP 了吗？** **是（仅诊断）** —— Redis 在诊断中可见，但从不用于业务逻辑

**缺失设计：**
- Redis-ADR-001 边界：Redis 是否曾用于会话缓存、考试计时器或限流？
- 未来任何缓存层用 Redis 还是 PostgreSQL？

**缺失实现：** 当前范围无 —— Redis 缺席是设计使然（ADR-001）

**相关 Large Job：** 无 —— Redis 边界是设计问题，非实现缺口

**推荐下一步：** 文档化 Redis 边界决策。当前 Redis 是"可用但业务逻辑未用"——对 Phase 1-3 是正确的。任何未来使用需设计文档。

**暂不可做：**
- 不要给考生流程加 Redis 读写
- 不要用 Redis 做会话管理
- 不要用 Redis 做考试计时器或倒计时
- 不要把 Redis 作为任何业务操作的依赖

---

## 7. 诊断 / 运维状态

**已实现能力：**
- `apps/api/src/routes/system.ts` —— GET /system/diagnostics（版本、uptime、DB 延迟、Redis、扫描器、email 状态）
- `apps/web/src/pages/admin/SystemDiagnosticsPage.tsx` —— 完整 admin 诊断 UI
- `packages/contracts/src/system.ts` —— DiagnosticsResponseSchema、EmailDiagnosticsStatusSchema
- 扫描器状态：心跳扫描器、截止扫描器（lastScanAt、interval、错误计数）
- Email 诊断：状态、待发/已发/失败计数、lastSentAt
- Authz：SystemDiagnosticsView 权限、Admin 门控

**当前产品入口：**
- Admin → System Diagnostics 页（每 30s 自动刷新）
- GET /system/diagnostics API

**接入 MVP 了吗？** **是** —— 完全接线、admin 可见、优雅降级

**缺失设计：** 当前范围无

**缺失实现：** 当前范围无

**相关 Large Job：** 无 —— 此能力对 Phase 3 完整

**推荐下一步：** 无需操作。诊断生产就绪。

**暂不可做：**
- 不要加面向考生的诊断
- 不要加诊断阈值的告警/通知
- 不要加诊断历史/趋势

---

## 8. 审计 / 监控状态

**已实现能力：**
- `packages/authz/src/auditActions.ts` —— 57 个审计 action 的闭合 union（AUDIT-M1）
- `apps/api/src/routes/audit.ts` —— recordAudit() fire-and-forget + GET /admin/audit-logs
- 审计事件覆盖：auth、attempt 生命周期、考试生命周期、题目 CRUD、用户 CRUD、考生 CRUD、评分、email、proctor 事件
- `apps/web/src/pages/admin/AuditLogPage.tsx` —— admin 审计日志查看器

**当前产品入口：**
- Admin → 审计日志页（按 action、targetType、日期范围过滤）
- 每个主要路由经 recordAudit() 发出审计事件

**接入 MVP 了吗？** **是** —— 所有 admin 与考生操作的全面审计链

**缺失设计：**
- 审计留存策略（audit_logs 保留多久？）
- 审计导出（合规要求？）
- 敏感读审计（grading.detail_viewed 已接线，但其他呢？）

**缺失实现：**
- 审计日志归档/清理机制
- 审计日志导出（合规用 CSV/PDF）

**相关 Large Job：** 当前范围无 —— 审计生产就绪

**推荐下一步：** 无即时操作。审计全面且生产就绪。留存/导出可后续设计。

**暂不可做：**
- 不要在未加入闭合 union 的情况下新增审计 action
- 不要在审计元数据中存考生作答内容（ADR §3.8）
- 不要加实时审计事件流

---

## 9. 评分可见性状态

**已实现能力：**
- 自动评分引擎：`packages/exam-engine/src/grading.ts`（readGradingSnapshot、computeGradingResult、finalizeGrading）
- 人工评分引擎：`packages/exam-engine/src/manualGrading.ts`（gradeQuestion、reconcileScores）
- 评分队列 API：`apps/api/src/routes/gradingQueue.ts`（GET 队列、GET 详情、POST grade-question）
- 评分详情页：`apps/web/src/pages/admin/GradingDetailPage.tsx`
- 评分队列页：`apps/web/src/pages/admin/GradingQueuePage.tsx`
- 结果可见性：`apps/api/src/routes/scores.ts` computeResultVisibility（3 种发布模式）
- 考生作答剥离：考生结果视图移除 standardAnswer

**当前产品入口：**
- Admin → 评分队列 → 评分详情 → 录入得分 → 保存
- Admin → 分数 → 查看个人结果（admin 见 standardAnswer，考生被剥离）
- 考生 → 查看结果 → 见分数/通过，无正确答案

**接入 MVP 了吗？** **是** —— 从队列到打分录入到结果可见性的完整评分工作流

**缺失设计：**
- 评分作答可见性：阅卷员应否在评分 UI 中看到考生提交的作答文本？（当前经评分详情中的 `candidateAnswer` 可见，但前端渲染被主观作答输入阻塞）

**缺失实现：**
- 前端主观作答渲染（见 §15）

**相关 Large Job：** Subjective-Answer-L1（富文本/画图作答设计）

**推荐下一步：** 评分后端完整。缺口在前端主观作答渲染。阻塞于 Subjective-Answer-L1 设计。

**暂不可做：**
- 不要无设计加评分得分区间或评分细则
- 不要加匿名评分（阅卷员不知考生身份）
- 不要加评分耗时跟踪

---

## 10. Proctor 事件状态

**已实现能力：**
- Proctor 监控 API：`apps/api/src/routes/proctorMonitoring.ts`
  - GET /admin/exams/:examId/proctor/attempts —— 实时 attempt 状态
  - GET /admin/attempts/:attemptId/proctor-events —— 事件时间线
  - POST /admin/attempts/:attemptId/proctor-incident —— 记录事件
- 契约：`packages/contracts/src/proctorMonitoring.ts`（ProctorAttemptStatus、ProctorAttemptEvent）
- Proctor 事件类型（`packages/contracts/src/attempt.ts`，共 4 种）：`suspicious_behavior_marked`、`network_issue_marked`、`identity_check_failed`、`manual_note_added`
- 审计事件：proctor.incident_marked（仅审计事件存储，无专门事件表）
- 前端：`apps/web/src/pages/admin/ProctorDashboardPage.tsx`（轮询考生状态、显示事件对话框，每 5s 轮询）

**当前产品入口：**
- Admin → Proctor Dashboard → 查看活跃 attempt → 标记事件
- API：POST /admin/attempts/:attemptId/proctor-incident

**接入 MVP 了吗？** **部分** —— 只读监控可用、事件记录写审计事件，但：
- 无 Proctor 角色（所有访问仅 Admin）
- 无实时推送（每 5s 轮询）
- 无权限动作的 Proctor 角色边界（force-submit、extend-time、misconduct 按钮在 dashboard 中存在，但经由 attempts.admin 路由以 Admin 身份执行，而非由独立的 Proctor 角色权限触发）
- 无事件解决或工作流

**缺失设计：**
- Proctor-L7：Proctor 角色、proctor_assignments、scoped RBAC
- Proctor-L8：实时 WebSocket 推送
- Proctor-L9：权限动作（force-submit、extend-time、违规标记）的角色授权边界
- Proctor-L10：事件生命周期（记录 → 调查 → 解决）

**缺失实现：**
- Proctor 角色激活
- 实时更新的 WebSocket/SSE
- 从 proctor dashboard 经 Proctor 角色触发 force-submit 与 extend-time（当前经 attempts.admin 路由仅 Admin）
- 事件解决工作流

**相关 Large Job：** Proctor-L7（Proctor 角色 + 权限设计）

**推荐下一步：** 设计 Proctor 角色与权限边界。监控基础设施已就绪——问题是谁能做什么。

**暂不可做：**
- 不要创建 proctor_assignments 表
- 不要为 proctor 实时加 WebSocket/SSE
- 不要无角色设计给 proctor dashboard 加 force-submit/extend-time 按钮
- 不要在 proctor dashboard 加考生作答查看

---

## 11. 作答 / 提交正确性缺口

**已实现能力：**
- 答案保存协议：`packages/exam-engine/src/answerProtocol.ts` —— 版本化、幂等、冲突检测
- 保存端点：POST /attempts/:attemptId/answers/:questionId —— 事务性保存
- 提交端点：POST /attempts/:attemptId/submit —— 事务性提交 + 自动评分
- 提交冻结屏障：`apps/api/src/routes/submitFreezeBarrier.test.ts` —— 并发安全
- 心跳：POST /attempts/:attemptId/heartbeat —— 防止中断超时
- 恢复：POST /attempts/:attemptId/restore —— 恢复中断 attempt

**当前产品入口：**
- 考生 → TakeExamPage → 每次变更保存作答 → 完成时提交
- 所有考生状态为 PostgreSQL 支撑（Redis 降级守卫已证明）

**接入 MVP 了吗？** **是** —— 完整且已测试

**缺失设计：** 当前范围无

**缺失实现：** 当前范围无

**相关 Large Job：** 无 —— 答案协议生产就绪

**推荐下一步：** 无需操作。答案协议稳固。

**暂不可做：**
- 不要加静态答案加密
- 不要加答案压缩
- 不要加批量答案保存

---

## 12. 考试生命周期缺口

**已实现能力：**
- 状态机：`packages/exam-engine/src/attemptStateMachine.ts` —— in_progress → submitted → grading → graded（另有 disrupted 状态）
- 考试状态：draft → published → open → closed → archived（+ canceled）。注：`extended` 不是状态；延长考试仅修改 `open` 考试的 `closeAt`，状态保持 `open`。
- 命令函数：publishExam、closeExam、cancelExam、extendExam、publishResults
- 对账：`apps/api/src/routes/reconciliation.ts` —— 自动转换陈旧考试
- 截止扫描器：自动提交过期 attempt

**当前产品入口：**
- Admin → 考试管理 → publish、close、cancel、archive、extend、publish results
- 所有转换经命令函数（无直接状态变更）

**接入 MVP 了吗？** **是** —— 完整生命周期管理

**缺失设计：** 当前范围无

**缺失实现：** 当前范围无

**相关 Large Job：** 无 —— 生命周期生产就绪

**推荐下一步：** 无需操作。

**暂不可做：**
- 不要加考试克隆
- 不要加考试模板
- 不要加批量考试操作

---

## 13. 题目 / 试卷版本化缺口

**已实现能力：**
- 题目快照：`packages/domain/src/types.ts` QuestionSnapshot —— attempt 创建时冻结
- 题目 CRUD：apps/api/src/routes/question.ts —— create、update、delete、import
- 题目类型：single_choice、multiple_choice、true_false、fill_blank（仅 4 种）
- 试卷构建器：考试试卷是题目快照的精选列表

**当前产品入口：**
- Admin → 题目管理 → 创建/编辑/删除/导入题目
- Admin → 考试设置 → 为试卷选题
- 考生 → attempt 创建时快照题目

**接入 MVP 了吗？** **是** —— 题目在 attempt 中被快照且不可变

**缺失设计：**
- 试卷随机化（从题库随机子集）
- 题目版本化（跟踪题目编辑历史）
- 题目标签/分类用于筛选

**缺失实现：**
- 试卷随机化（Phase 2 考试运营）
- 题目版本历史

**相关 Large Job：** Paper-Random-L2（随机试卷构建器——Phase 2）

**推荐下一步：** Phase 1-3 无需操作。试卷随机化是 Phase 2 考试运营特性。

**暂不可做：**
- 不要加题目版本化
- 不要加试卷随机化
- 不要加题目难度标签

---

## 14. 结果发布缺口

**已实现能力：**
- 3 种发布模式：immediate、after_grading、manual
- computeResultVisibility：两阶段门控（resultReady + 发布门控）
- publishResults 命令：设置 resultsPublishedAt 时间戳
- 考生结果视图：剥离 standardAnswer，尊重发布模式
- Admin 绕过：admin 在结果可计算时即见

**当前产品入口：**
- Admin → 考试详情 → 发布结果（manual 模式）
- 考生 → 结果页 → 见结果或 hiddenReason

**接入 MVP 了吗？** **是** —— 完整发布工作流

**缺失设计：**
- 结果发布通知（结果发布时邮件通知考生）
- 结果申诉流程（考生争议分数）
- 按考生结果导出（PDF 成绩单）

**缺失实现：**
- 结果发布邮件通知（阻塞于 Email-Template-L1）
- 结果 PDF 导出

**相关 Large Job：** Email-Template-L1（通知）、Result-Export-L4（PDF）

**推荐下一步：** 设计邮件通知触发点。发布逻辑完整。

**暂不可做：**
- 不要加结果申诉流程
- 不要无设计加结果 PDF 导出
- 不要加结果发布定时

---

## 15. 主观 / 富文本作答缺口

**已实现能力：**
- 后端评分引擎处理主观题（null standardAnswer → pending_manual）
- 评分队列列出含主观题的 attempt
- 评分详情对主观题返回 candidateAnswer 文本
- 人工评分引擎：gradeQuestion + reconcileScores
- fill_blank 题型支持文本输入

**当前产品入口：**
- Admin → 评分队列 → 评分详情 → 见考生作答 → 录入得分
- 考生 → TakeExamPage → fill_blank 渲染基础文本输入

**接入 MVP 了吗？** **否（前端缺口）** —— 后端就绪，但：
- fill_blank 渲染基础 `<input>`——无富文本、无画图、无文件上传
- 主观评分的 E2E 测试被跳过（"Phase 3 pending: subjective answer runtime"）
- 评分详情页把 `candidateAnswer` 作为原始文本展示——无富渲染
- 考生无法有意义地作答论述/主观题

**缺失设计：**
- Subjective-Answer-L1：需要哪些作答类型？（富文本、画图、文件上传？）
- Subjective-Answer-L2：作答存储格式（HTML？Markdown？画布 JSON？文件引用？）
- Subjective-Answer-L3：富作答的评分 UI（并排视图、标注？）

**缺失实现：**
- 主观作答的富文本编辑器组件
- 图示作答的画图/画布组件
- 文档作答的文件上传
- 渲染富作答的评分 UI

**相关 Large Job：** Subjective-Answer-L1（主观作答输入设计）

**推荐下一步：** 设计需要哪些主观作答类型及其存储格式。这是 MVP 评分流程中最大的功能缺口。

**暂不可做：**
- 不要无设计实现富文本编辑器
- 不要无存储设计加文件上传
- 不要无格式规格加画图画布
- 不要无设计更改作答存储 schema

---

## 16. 休眠能力

存在但应保持休眠直至 Large 设计被接受的能力：

| 能力 | 当前状态 | 阻塞于 |
|---|---|---|
| Email 通知触发 | 基础设施就绪，无调用方 | Email-Template-L1 设计 |
| Proctor 角色 + 派单 | 仅 admin 监控可用 | Proctor-L7 设计 |
| 实时 proctor 推送（WebSocket/SSE） | 轮询可用 | Proctor-L8 设计 |
| Proctor 权限动作 | 仅 admin 经 attempts.admin | Proctor-L9 设计 |
| 事件生命周期 | 仅审计事件记录 | Proctor-L10 设计 |
| 试卷随机化 | 未实现 | Paper-Random-L2 设计（Phase 2） |
| 题目版本化 | 未实现 | 暂无需设计 |
| 结果 PDF 导出 | 未实现 | Result-Export-L4 设计 |
| Email 后台 worker | 仅手动触发 | Email-Worker-L3 设计 |
| 主观富文本作答 | 后端就绪，前端缺口 | Subjective-Answer-L1 设计 |
| RBAC 全量迁移（requireRole → requireCapability） | Shadow 模式活跃 | RBAC-L7 设计 |
| Redis 业务用途 | 仅诊断 | Redis 边界设计（若需要） |
| 审计留存/归档 | 无清理机制 | 合规设计 |

---

## 17. 停止清单

不应作为随机 Middle 实现继续的工作：

1. **不要给业务路由加 enqueueBestEffort 调用** —— 邮件触发点需先设计（Email-Template-L1）

2. **不要把更多路由从 requireRole 迁移到 requireCapability** —— 权限-角色矩阵需先设计（RBAC-L7）

3. **不要创建 Proctor 角色 UI 或 proctor_assignments 表** —— Proctor 权限边界需先设计（Proctor-L7）

4. **不要给 proctor 监控加 WebSocket/SSE** —— 实时推送需先设计（Proctor-L8）

5. **不要为主观作答实现富文本编辑器** —— 作答类型与存储格式需先设计（Subjective-Answer-L1）

6. **不要给考生流程加 Redis 读写** —— Redis 边界是设计使然（ADR-001）

7. **不要加邮件模板渲染** —— 哪些事件触发邮件需先设计

8. **不要加审计日志留存/清理** —— 合规要求需澄清

9. **不要加结果 PDF 导出** —— 导出格式与触发需先设计

10. **不要加试卷随机化** —— 这是 Phase 2 考试运营特性

11. **不要给 proctor dashboard 加 force-submit/extend-time 按钮** —— Proctor 角色需先设计

12. **不要加匿名评分** —— 需先做评分工作流设计

---

## 18. 推荐的 Large 设计顺序

基于 MVP 流程影响与依赖链的优先级顺序：

| 优先级 | Large 设计 | 理由 |
|---|---|---|
| 1 | **Subjective-Answer-L1** —— 主观作答输入设计 | 最大功能缺口。阻塞端到端人工评分。无此能力，考生无法有意义作答论述题，评分队列半残。 |
| 2 | **Email-Template-L1** —— Email 通知设计 | 基础设施就绪。设计触发点解锁考生通知（考试发布、结果发布、密码重置）。 |
| 3 | **RBAC-L7** —— Scoped RBAC 架构 + 权限矩阵 | Phase 3 角色（Teacher、Proctor、Grader）激活前必需。Shadow 模式运行中——设计决定何时切换。 |
| 4 | **Proctor-L7** —— Proctor 角色 + 权限设计 | 依赖 RBAC-L7。定义 Proctor 能做什么（监控、标记、force-submit、extend-time）。 |
| 5 | **Result-Export-L4** —— 结果导出设计（PDF/CSV） | MVP 锦上添花。依赖结果发布稳定。 |

---

## 19. 设计后推荐的派生 Middle Job

每个 Large 设计被接受后，下列 Middle 作业可推进：

**Subjective-Answer-L1 之后：**
- M-Subjective-1：富文本编辑器组件
- M-Subjective-2：作答存储 schema 更新
- M-Subjective-3：评分 UI 富作答渲染
- M-Subjective-4：主观评分 E2E 测试重新启用

**Email-Template-L1 之后：**
- M-Email-1：邮件模板渲染（zh-CN）
- M-Email-2：业务流程集成（考试发布 → 通知）
- M-Email-3：后台 worker 守护进程
- M-Email-4：邮件投递状态跟踪 UI

**RBAC-L7 之后：**
- M-RBAC-1：路由迁移（requireRole → requireCapability）
- M-RBAC-2：Proctor 角色激活
- M-RBAC-3：Grader 角色作用域
- M-RBAC-4：前端能力驱动 UI 门控

**Proctor-L7 之后：**
- M-Proctor-1：proctor_assignments 表 + API
- M-Proctor-2：proctor dashboard 基于角色的过滤
- M-Proctor-3：从 proctor dashboard force-submit
- M-Proctor-4：从 proctor dashboard extend-time

---

## 20. 最终结论

**Phase 3 Middle 实现策略应从"构建更多基础设施"转向"构建前先设计"。**

代码库有强大、测试充分的构建块：
- 答案协议：生产就绪
- 提交 + 冻结：生产就绪
- 考试生命周期：生产就绪
- 题目快照：生产就绪
- 评分引擎（auto + manual）：生产就绪
- 审计事件：生产就绪
- 诊断：生产就绪
- Redis 边界：清晰且强制

缺失的是**接线**——经设计把基础设施连接到真实产品流程：
- Email 基础设施存在但零调用方
- RBAC catalog 存在但多数路由仍用 legacy 角色检查
- Proctor 监控存在但无基于角色的访问
- 评分后端存在但前端无法渲染主观作答

**下一步是设计，而非实现。** 接受 §18 列出的 5 份 Large 设计文档，然后执行 §19 的派生 Middle 作业。设计被接受前停止随机 Middle 工作。

---

*本审计基于截至 2026-07-02 的代码库检查。所有文件引用相对于 `/home/hoo/Source/exam/` 的 exam 仓库。*
