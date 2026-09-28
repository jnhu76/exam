# EXAM-303-PROCTOR-RECOVERY-REALITY-AUDIT-1 — Proctor Recovery Center 代码现实审计

- BASE = `347bc18a14d6450c806c27b864c260208ffdb281`（master，含 #294/PR #523 合入）
- 模式：调查/审计（READ-ONLY）。无功能实现、无 UI 构建、无新状态机。
- 可执行证据：临时探针 `apps/api/src/routes/probe303.reality.test.ts`（8/8 PASS，审计后删除；日志 `/tmp/probe303-run2.log`）+ 已提交测试 `proctorScope.test.ts`、`proctorMonitoring.crossOrg.test.ts`。
- 方法：Phase 1 仅代码（3 路并行 census + 人工复核承重文件）→ 可执行探针 → Phase 2 对照规范（#303/#516、SPEC、authorization.md、ADR-014/015）。

---

## 1. Executive summary

1. **Proctor 的 scoped authority 已经在 API 层完整存在**：6 项 permission（`exam_room.view`、`attempt.status.view`、`attempt.timeline.view`、`incident.view/create/investigate`），全部受 `exam_proctor_assignments` active-episode 作用域约束。incident 的 create/investigate/note/severity/link 全家桶对 assigned Proctor 开放且走 canonical command + canonical audit（探针 R6 证明 actor=真实 Proctor 身份）。
2. **缺失的是产品表面，不是 authority**：Proctor 今天能触达的 3 个页面（Workspace launcher / ProctorDashboard / ExamMonitoring）全部只是监控读面；没有任何 Proctor 可达页面调用 incident 端点——incident 文档化能力目前是 API-only。这正是 #303 的 title gap。
3. **读面有两个真实缺口**（决定实现形状）：
   - Proctor 没有跨"我的 assigned exams"的 incident worklist 端点（Admin 队列是 `incident.recovery.view` org-wide，Proctor 明确不持有）；
   - Proctor 可读的 incident GET 只返回**行**（`IncidentResponseSchema`），notes/事件史/action/link 只存在于 Admin-only 的 recovery aggregate——**notes 对 Proctor 今天是 write-only**。
4. **Anti-enumeration 与冻结政策一致**：ADR-015 §9 的 404 政策（missing ≡ cross-org ≡ unassigned → 404 RESOURCE_NOT_FOUND；capability 缺失 → 403）在代码与 8/8 探针中全部成立。
5. **未发现安全缺陷**；发现 1 个 Admin 面正确性缺陷（AttemptDetailPage misconduct 400，见 §11）→ 已按 interruption rule 开 focused issue，不进入 #303。
6. `NEW_RECOVERY_STATE_MACHINE_REQUIRED = no`。`AUTHORITY_FREEZE = READY_FOR_IMPLEMENTATION`。

---

## 2. Proctor authority matrix

Verdict 词表：`PROCTOR_SUPPORTED / ADMIN_ONLY / SHARED_SAME_SEMANTICS / SHARED_DIFFERENT_SCOPE / LATENT / ABSENT`。READ 与 ACTION 已拆分（§5）。

| Capability | Proctor today (READ / ACTION) | Admin today | Owner (file:line) | Scope check | Audit | UI | Verdict |
|---|---|---|---|---|---|---|---|
| exam list/read | READ: `GET /admin/proctor/exams`（assignment 过滤，status ∈ published/open/closed） | org 全量 + 生命周期路由 | `examRepo.listProctorDiscoverable`（examRepo.ts:35-73）；路由 proctorMonitoring.ts:59-91 | SQL EXISTS `exam_proctor_assignments` active | — | ProctorWorkspacePage | SHARED_DIFFERENT_SCOPE |
| exam recovery context | — | READ: `GET /admin/recovery/exams/:id` | recoveryRepo.getExamRecoveryContext（incidents.admin.ts:1672） | `incident.recovery.view`（Admin-only） | sensitive-read 审计口径同 recovery 族 | RecoveryExamDetailPage | ADMIN_ONLY |
| candidate/enrollment visibility | READ: 仅嵌入监控行/timeline 的最小身份 | 完整 enrollment 管理 | buildProctorAttemptStatuses（apps/api/src/lib/proctorMonitoringService.ts） | assignment_scoped | — | ProctorDashboard 行渲染 | SHARED_DIFFERENT_SCOPE（读最小；无管理） |
| attempt list/read | READ: `GET /admin/exams/:examId/proctor/attempts`（live in_progress/disrupted） | 同路由 org-wide + recovery 上下文 + export | proctorMonitoring.ts:101-138 | assignment_scoped | — | ProctorDashboard / ExamMonitoring | SHARED_DIFFERENT_SCOPE |
| attempt detail (timeline/evidence) | READ: timeline + proctor-events | 同左 + `GET /admin/recovery/attempts/:id` 全 ledger | attempts.admin.ts:331-390; proctorMonitoring.ts:149-205 | assignment_scoped | 敏感读口径 | AttemptDetail(Admin) / 无 Proctor incident 面 | SHARED_DIFFERENT_SCOPE（recovery 上下文 ADMIN_ONLY） |
| heartbeat / disruption state | READ: onlineState/lastHeartbeatAt/warningLevel（DERIVED_SIGNAL） | 同左 + interruption episode 全史（recovery 上下文） | apps/api/src/lib/proctorMonitoringService.ts:207-285 | assignment_scoped | scanner 不写 compliance audit（heartbeat.ts:157 注释） | ExamMonitoring | SHARED_DIFFERENT_SCOPE |
| incident list/read | READ: `GET /admin/exams/:examId/incidents`、`GET /admin/incidents/:id`（仅行字段，无 notes/事件史） | 同左 + recovery aggregate（events/notes/actions/links/auditRefs） | incidents.admin.ts:569,607; recoveryRepo.getIncidentAggregate(:614) | assignment_scoped | — | 仅 Admin Recovery 页 | SHARED_DIFFERENT_SCOPE（aggregate 读 ADMIN_ONLY） |
| incident worklist（跨 assigned exams） | **无端点** | `GET /admin/recovery/incidents`（org-wide 队列） | recoveryRepo.listIncidentQueue(:422) | `incident.recovery.view` Admin-only | — | RecoveryQueuePage | ADMIN_ONLY（Proctor 变体 = #303 缺口） |
| incident evidence (notes/事件史) | **无读端点**（notes 今天 write-only） | recovery aggregate 读 | recoveryRepo.ts:1075-1078（notes 由事件派生） | Admin-only | — | RecoveryIncidentDetailPage | ADMIN_ONLY（读） |
| mark misconduct（attempt 旗标） | — | ACTION: `POST /admin/attempts/:id/misconduct` | attempts.admin.ts:63-122 | `attempt.misconduct.mark` Admin-only（J4-I1B 移除 Proctor） | `attempt.misconductFlagged` | AttemptDetailPage（**当前 400，见 §11**） | ADMIN_ONLY |
| add note / documentation | ACTION: notes/severity/investigate/link×3 | 同左 | incidents.admin.ts:642-1210 | `incident.investigate` assignment_scoped | `incident.*` 族 | **无 Proctor UI**（= #303） | PROCTOR_SUPPORTED（API），UI ABSENT |
| create incident | ACTION: `POST /admin/exams/:examId/incidents` | 同左 | incidents.admin.ts:457; incidentCommands.ts:448 | `incident.create` assignment_scoped | `incident.created` | 无 Proctor UI | PROCTOR_SUPPORTED（API），UI ABSENT |
| extend time | — | ACTION: `POST /admin/attempts/:id/time-grants` | attempts.admin.ts:219-321 | `attempt.time.grant` Admin-only | `attempt.timeGrant`（仅 granted） | ProctorDashboard 隐藏 | ADMIN_ONLY |
| force submit | — | ACTION: `POST /admin/attempts/:id/force-submit` | attempts.admin.ts:145-206; forceSubmitExecution.ts | `attempt.force_submit` Admin-only | `attempt.forceSubmit`（no_change 不写） | ProctorDashboard 隐藏 | ADMIN_ONLY |
| restore/resume | —（candidate 自助：`POST /attempts/:id/restore` own_attempt） | —（无 operator restore 路由） | attempts.candidate.ts:1226; restoreInterruption.ts:207 | `attempt.restore` own_attempt | attempt 行+interruption 事件为域记录 | TakeExamPage REC-I3 | CANDIDATE_ONLY（Proctor/Admin 均无 operator 入口） |
| void | ABSENT（状态被引用，无 command/route） | ABSENT | attemptStateMachine.ts; forceSubmitExecution.ts:363 | — | — | — | ABSENT |
| reopen | ABSENT（批改单向，无 regrade） | ABSENT | manualGrading.ts:104-153 | — | — | — | ABSENT |
| terminal correction | — | force-submit（terminal no-op 语义）+ exam close/cancel/archive | attempts.admin.ts; exam.ts | 各自 Admin 权限 | 对应 audit | Admin 面 | ADMIN_ONLY |
| manual grading | — | Admin + Grader（exam-assignment-scoped） | gradingQueue.ts; manualGrading.ts:86 | `grading.*` | `grading.*` | GradingQueue/Detail | ADMIN_ONLY（对 Proctor） |
| result publication | — | Admin + Teacher(course-scoped) | exam.ts:1715-1817 | `exam.result.publish` | `exam.publish_results` | — | ADMIN_ONLY（对 Proctor） |
| queue admission visibility | — | #292 admissions admin 端点 | admissions 路由 | Admin 权限 | — | — | ADMIN_ONLY |
| proctor assignment manage | — | assign/list/revoke | proctorAssignments.admin.ts:176,279,325 | `exam.proctor_assignment.*` Admin-only | `exam.proctor_assigned/revoked` | — | ADMIN_ONLY |

死授权注记：`attempt.status.view` 在 Proctor preset 中但**零路由消费者**（catalog/presets 之外无 `requireCapability(AttemptStatusView)`）——LATENT 授权，见 §11。

## 3. Assignment scope owner（PROCTOR_ASSIGNMENT_AUTHORITY）

**唯一 canonical owner**：`packages/db/src/repository/proctorAssignmentRepo.ts`
- 谓词 `findActiveByExamAndProctor`（:123-140）：`organization_id = ctx.org AND exam_id = ? AND proctor_user_id = ctx.actorId AND status = 'active'`；
- 布尔门 `hasActiveAssignment`（:419-427）。

**载体**：`exam_proctor_assignments`（pg.ts:1984-2085）：`(organization_id, exam_id, proctor_user_id) WHERE status='active'` 唯一索引（一.active-episode 仲裁）；`status ∈ ('active','revoked')`；append-only 回执表 `exam_proctor_assignment_events`（pg.ts:2294-2335）。

**接线**：
- 路由门：`scopedCapability.ts buildScopedCapabilityPreHandler`（:291-343）——capability（stage 1）→ resolver（存在/租户/父链）→ **Admin 短路**（:304）→ 非 Admin 走 `proctorAssignment.check`（每请求查表，无 JWT/无跨请求缓存，ADR-015 §10）；
- 列表门：`listProctorDiscoverable` SQL EXISTS（分页前过滤）；
- incident 的 examId 一律取**权威 incident 行**（incidentResolver.ts:23-33），URL/body 不可重挂父级。

**assigned / unassigned 精确谓词**：
- assigned ≡ 存在 `(org, exam, proctor, status='active')` 行（且 exam 在同 org、status ∈ published/open/closed 才可 list 发现）；
- unassigned ≡ 不存在该行 → 一切 assignment_scoped 路由 404（见 §4）。撤销即时生效于下一请求（探针+proctorScope.test.ts:228-285 证明 revoke→404、reassign→200）。

**写入口**：Admin-only `POST /admin/exams/:examId/proctors`（assign 校验目标持 active Proctor 角色，proctorAssignments.admin.ts:256-264）；command `assignProctorToExam/revokeProctorFromExam`（proctorAssignmentCommands.ts:266,382）。

## 4. Anti-enumeration reality

`scopedCapability.ts:251-279` deny 映射（人工复核原文）：

| resolver 结果 | HTTP | error code |
|---|---|---|
| `resource_not_found` | 404 | RESOURCE_NOT_FOUND |
| `organization_mismatch` / `ownership_mismatch` / `broken_parent_chain`（同 org 链损坏 fail-closed） | 403 | PERMISSION_DENIED |
| `resolver_error`（DB 故障） | 503 | AUTHZ_UNAVAILABLE |
| assignment miss（同 org、无 active 行） | 404 | RESOURCE_NOT_FOUND（:338-342） |

关键事实：三个 chain repo（examRepo.ts:112-132、attemptRepo.ts:59-88、incidentRepo.ts:154-183）的 SQL **都以根行 `organization_id = ctx.org` 锚定**——跨 org 资源根本不会加载，走 `resource_not_found` → 404，`organization_mismatch→403` 分支只对同 org 数据链损坏可达（fail-closed，不构成跨 org 存在性 oracle）。`crossOrg` 测试的 "MUTATION B KILL POINT" 注释即证此点。

这与 **ADR-015 §9 冻结政策逐条一致**：missing/cross-org/unassigned → 404（故意非 403，防枚举）；"actor has resource scope but lacks capability" → 403。探针 9 组对照（§10 ANTI-ENUM）全部 404 + 同一 error code + 同一 body 形状（`buildErrorResponse(request.id, code)`）。

**结论：UNASSIGNED ≈ NONEXISTENT ≈ FOREIGN_ORG 在 Proctor 表面成立（应用层）**。时间维度：unassigned 多一次 assignment 查表（两次小索引查询 vs 一次），属应用层可接受范围（任务书明确不要求 timing 密码学不可区分）。

Admin-only action 路径亦无泄漏：capability 检查先于资源查找，resolve 不存在的 incident 与存在的 incident 同为 403（探针 R7 ghost 分支）。

## 5. READ vs ACTION authority 拆分（核心防混淆）

| 资源 | Proctor READ_AUTHORITY | Proctor ACTION_AUTHORITY | TERMINAL_AUTHORITY |
|---|---|---|---|
| assigned exam | ✅（列表行 + 监控） | ❌（无生命周期/配置动作） | ❌ |
| attempt（assigned） | ✅（监控行/timeline/proctor-events） | ❌（force-submit/misconduct/time-grant 全无） | ❌ |
| incident（assigned） | ✅（行字段；aggregate 读无） | ✅（create + investigate×6：start/note/severity/link-action/attempt/interruption） | ❌（resolve/dismiss 无） |
| disruption episode | 仅经 attempt status/监控行派生 | ❌（restore 是 candidate own_attempt 权） | ❌ |
| time adjustment ledger | ❌（Admin recovery 上下文内） | ❌ | ❌ |

"能看到 disrupted attempt" ≠ "能 restore"；"能建/查 incident" ≠ "能 resolve"；"能看到 deadline" ≠ "能 extend"——三条边界在 preset、路由 proctorAccess 与探针 R7 三层一致。

## 6. Admin Recovery capability map（ADMIN_RECOVERY_CAPABILITIES）

| 面 | 分类裁决 |
|---|---|
| Recovery 队列/aggregate/exam 上下文读（J5-I1A，`incident.recovery.view`） | **generic 读语义、当前 Admin-only 暴露**——数据源是已有 truth，Proctor 变体必须经 assignment 谓词重新投影，不得复用 Admin 路由 |
| incident resolve/dismiss | **genuinely Admin-only**（ADR-014 §8 terminal judgment；preset 敏感位） |
| attempt.force_submit / misconduct.mark / time.grant | **genuinely Admin-only**（J4-I1B 从 Proctor preset 移除，ADR-015 §13："NOT deferred Proctor capabilities"） |
| incident create/investigate 族 | **generic 语义、已对 assigned Proctor 授权**（ADR-014 §8 target grant 已激活）——Admin UI 只是没把它做进 Proctor 表面 |
| proctor assignment 管理 | genuinely Admin-only（ADR-015 §16） |
| grading / result publish / exam 生命周期 | genuinely Admin(-Teacher/Grader) 语义，与 Proctor 无关 |

## 7. Reusable Admin components / read models

| 组件/模型 | 分类 | 依据 |
|---|---|---|
| `useRecoveryOperation`（命令生命周期 hook：operationId 冻结、indeterminate/confirmed 分类） | REUSE_AS_IS | authority 无关；写面幂等语义完全同构（incident 命令同为 operationId 幂等） |
| `RecoveryCommandDialog`（纯 presentation 受控对话框） | REUSE_AS_IS | 零 API/零权限假设 |
| `lib/recovery.ts` status 映射、badge/status 呈现件 | REUSE_AS_IS | 纯映射 |
| wire 驱动 `allowedActions` 渲染模式（服务端算权、UI 不推导） | REUSE_AS_IS（模式） | `deriveAllowedActionsForCaller`（incidents.admin.ts:297-329）本就按 caller capability ∩ 状态候选计算，对 Proctor 天然收敛 |
| `recoveryRepo.listIncidentQueue / getIncidentAggregate` | REUSE_READ_MODEL_ONLY | 语义可复用，但必须以 assignment 谓词重新限定作用域 + 新的 Proctor 授权端点；**禁止**给 Proctor 开 `incident.recovery.view` |
| incident 明细呈现（events/notes 时间线渲染） | REUSE_VISUAL_COMPONENT_ONLY | 数据必须来自 Proctor 授权投影（今天不存在） |
| RecoveryAttemptDetailPage 的 force-submit/misconduct/time-grant 面板、resolve/dismiss UI、proctor assignment UI、Admin 队列页 | DO_NOT_REUSE | Admin terminal/管理语义 |
| pendingForceSubmit/pendingMisconduct/pendingGrant localStorage 权威 | DO_NOT_REUSE（v1） | 绑定 Admin 命令族；Proctor v1 动作为 incident 写，仅需相同 operationId 模式 |

**禁止推导**成立："Admin 组件存在"不构成"Proctor 可用该动作"——每个动作以 preset × proctorAccess × 探针为准。

## 8. Incident / evidence model

**Incident 是什么**（ADR-014 §2 + 0023 迁移）：operator 创建的运营事件聚合（网络中断/设备故障/涉嫌舞弊 `suspected_misconduct`/…9 型），status ∈ open/investigating/resolved/dismissed（后两者 terminal），severity 4 级，version 乐观并发，append-only 事件史（含 note_added，notes 即事件、无独立表）。warning/client telemetry/心跳中断**不自动等于** incident：client_events 是遥测（DERIVED_SIGNAL），disruption 是 interruption 域对象（可 link 不等同）。

- Who creates：`incident.create` 持有人（Admin org-wide；Proctor assignment-scoped）——**今天只有 human actor**（system.incident.create 仅为 ADR-014 §8 名称保留，#304 范围）。
- Who reads：`incident.view`（scoped）读行；aggregate 读 Admin-only。
- Who mutates：`incident.investigate`（open/investigating 态；terminal 拒绝）。
- Who resolves：`incident.resolve` Admin-only（盖章 resolvedBy/resolvedAt/resolutionSummary）。
- Terminal：resolved / dismissed。
- Evidence vs judgment：事件史/links = documentation evidence；resolve/dismiss = terminal judgment（两者不同权限、不同审计类）。

**Evidence 清单**（§13 分类）：

| 数据 | 表 | 分类 |
|---|---|---|
| incident 行 + 事件史（notes/reason/actor/operationId） | `exam_incidents`、`exam_incident_events` | CANONICAL_EVIDENCE（append-only） |
| action/attempt/interruption links | `exam_incident_actions/attempts/interruption_links` | CANONICAL_EVIDENCE |
| 中断 episode + 事件（detected/restored/terminalized、detection_source、reason_code） | `attempt_interruptions(+_events)` | CANONICAL_EVIDENCE |
| 时间调整 ledger（source/policy/actor/reason、incident_id） | `attempt_time_adjustments` | CANONICAL_EVIDENCE |
| attempt 命令回执（force_submit/misconduct_mark、actor、result_payload） | `attempt_command_receipts` | CANONICAL_EVIDENCE |
| 舞弊旗标投影 | `exam_attempts.misconduct` jsonb | CANONICAL_EVIDENCE 的投影（回执为权威史） |
| client 遥测（visibility/browser/heartbeat 事件；无 paste/copy 监听） | `client_events` | CANONICAL_EVIDENCE（observability）→ Proctor 面呈现为 DERIVED_SIGNAL |
| 心跳 | 无独立表；`exam_attempts.last_activity_at` 单时间戳 | CANONICAL_EVIDENCE（无历史） |
| compliance audit | `audit_logs` | AUDIT_TRAIL |
| 监控行（onlineState/warningLevel 阈值 30s/90s） | 计算值 | DERIVED_SIGNAL |
| 截图/附件/webcam/录像 | 无表无路由 | ABSENT |

**本轮不发明**任何新 evidence store / generic evidence object / event bus（F10）。

## 9. Command catalog（recovery 相关 COMMAND CARD 摘要）

格式：NAME — ACTOR/PERMISSION — 前置/转换 — 幂等 — 审计 — PROCTOR_ALLOWED。

| Command | Card 摘要 | PROCTOR_ALLOWED |
|---|---|---|
| `createExamIncident`（incidentCommands.ts:448） | ACTOR: Admin/Proctor·`incident.create`·assignment_scoped；PRE: exam 同 org（attempt 锚定时候选人取自权威 attempt 行）；IDEM: `(org,operation_id)` 事件唯一仲裁 + version；AUDIT: `incident.created`（事务内） | **yes** |
| `startIncidentInvestigation`（:1168） | open→investigating；IDEM 同上；AUDIT `incident.investigated` | **yes** |
| `addIncidentNote`（:610） | note_added 事件（noteId=event.id）；AUDIT `incident.note_added` | **yes** |
| `changeIncidentSeverity`（:1211） | open/investigating→severity 变更；AUDIT `incident.severity_changed` | **yes** |
| `linkIncidentAction`（:669） | action_type ∈ time_grant/force_submit（misconduct_mark 显式拒绝，ADR-014 §7）；一 action ≤1 incident | **yes**（文档化 link；action 本身只能由 Admin 命令产生） |
| `linkIncidentAttempt`（:816）/ `linkIncidentInterruption`（:923） | membership(affected/referenced) / episode link；scope quadruple 校验 | **yes** |
| `resolveExamIncident`（:1264）/ `dismissExamIncident`（:1316） | ACTOR Admin·`incident.resolve`；open/investigating→terminal；盖章 resolvedBy=actor；AUDIT `incident.resolved/dismissed` | **no（terminal）** |
| `planForceSubmitExecution`（forceSubmitExecution.ts:347） | Admin·`attempt.force_submit`；in_progress/disrupted→submitted|graded（按快照是否需手工批改）；submitted/grading/graded→no_change（无审计）；voided/not_started/queued→409；receipt `(org,operation_id)` 幂等 + 提交事实=回执 postcondition | **no** |
| `misconductMarkWithOperationRaceRecovery`（misconductMarkExecution.ts:712） | Admin·`attempt.misconduct.mark`；informational（不改状态）；receipt 幂等；AUDIT `attempt.misconductFlagged` | **no** |
| `grantAttemptTime`（operatorGrant.ts:180） | Admin·`attempt.time.grant`；14 步冻结序；要求快照 policy `operator_incident`；deadline 终态优先；ledger append；AUDIT 仅 granted | **no** |
| `restoreInterruptedAttempt`（restoreInterruption.ts:207） | ACTOR candidate（EA own-attempt capability）；disrupted→in_progress；bounded_grace 自动补偿（唯一 bounded 行/episode）；strict/operator_incident 零补偿 | **no（candidate 权）** |
| `markDisrupted`（attemptCommands.ts:633，heartbeat 扫描器调用） | system 触发；行锁复检；episode+detected 事件；不写 compliance audit（attempt 行为域记录） | system-only |
| `gradeQuestion`（manualGrading.ts:86）/ `publishResults`（examCommands.ts:491）/ `extendExam`（:360） | Admin/Grader·grading；Admin(+Teacher)·publish；Admin·exam.extend | **no** |
| `assignProctorToExam`/`revokeProctorFromExam`（proctorAssignmentCommands.ts:266,382） | Admin·`exam.proctor_assignment.manage` | **no** |

结构 vs 路由（§16）：incident 命令全部是 **generic command + Admin 路由同源**——同一 command 经 assignment_scoped preHandler 同时服务 Admin 与 assigned Proctor（ROUTE_PLACEMENT 在 `/admin/*` 下不改变 command 语义归属；这是 ADR-014 §8 明确设计）。terminal 命令（resolve/dismiss/force-submit/time-grant/misconduct-mark）是 **Admin-only command semantics**（preset 无 grant + proctorAccess=admin_only 双保险）。仓库内**零** `if (role==='Proctor')` 平行权威（唯一 role 字符串判定是 assign 时对目标用户的目标校验与 shell UX 分类，非授权）。

## 10. Reality probes（可执行证据）

探针文件：`apps/api/src/routes/probe303.reality.test.ts`（**临时**，审计后删除；真实 PostgreSQL worker 库 `TEST_DB_ISOLATION=worker-database`，8/8 PASS，`/tmp/probe303-run2.log`）。已提交回归证据：`proctorScope.test.ts`（assigned 200×3 / unassigned 404 / missing≡unassigned / revoke-reassign）、`proctorMonitoring.crossOrg.test.ts`（cross-org 404 mutation kill、角色矩阵、legacy marker 403）。

| # | 探针 | 结果 |
|---|---|---|
| R1 | P1 `GET /admin/proctor/exams` → 恰含 assigned exam；P2 → 空 items | ✅ 200，assignment SQL 过滤生效 |
| R2 | P1 `GET /admin/exams/:examA/proctor/attempts` | ✅ 200 |
| R3 | P1 timeline + proctor-events（assigned attempt） | ✅ 200/200 |
| R4 | P2 读 assigned exam 的 attempt（timeline/proctor-events） | ✅ 404 RESOURCE_NOT_FOUND ×2 |
| R5 | P1 读 incidentA 200；P2 读 incidentA 404；P1 列 examU incidents 404、examA incidents 200 | ✅ |
| R6 | P1 在 assigned exam create incident（applied）+ note + severity；audit `incident.created` 恰 1 行且 **actorId = P1 用户 id** | ✅ canonical command + canonical audit + 真实身份 |
| R7 | P1（assigned!）调 resolve/dismiss/force-submit/misconduct/time-grants/proctor-incident + 4 个 recovery 读 → 全 403 PERMISSION_DENIED；resolve 不存在 incident 亦 403（capability 先于查找，无存在性泄漏）；DB 效果：status/version 不变、0 事件追加 | ✅ 10/10 拒绝、零副作用 |
| R8/ANTI-ENUM | 9 组对照：exam 读 × {unassigned, foreign-org, nonexistent}、incident 读 ×3、incident create ×3 → **全部 404 RESOURCE_NOT_FOUND，同一 body 形状**；examU 无泄漏行 | ✅ UNASSIGNED ≈ FOREIGN ≈ NONEXISTENT |

## 11. Security / correctness findings

1. **SECURITY_DEFECT_FOUND = no**。anti-enumeration 符合 ADR-015 §9 冻结政策（代码+探针双证）。fail-closed 面完整：gate 未接线/无 exam 身份/DB 故障/未知 deny 一律 503 AUTHZ_UNAVAILABLE，绝不 fail-open。
2. **CURRENT_PRODUCT CORRECTNESS DEFECT（Admin 面，非 #303 范围）**：`apps/web/src/pages/admin/AttemptDetailPage.tsx:520-545` `handleFlag` 向 `POST /admin/attempts/:id/misconduct` 提交 `{severity, notes}`，而路由 body 契约 `MisconductMarkWithOperationRequestSchema`（contracts/attempt.ts:596-603，`.strict()`）**必填 `operationId`** → 每次使用 400、UI 只显 "flagFailed"。根因：该页未随 J5-I1C0 durable-receipt 契约迁移（ProctorDashboardPage:1170 与 RecoveryAttemptDetailPage:208 均已携带 operationId）。处置：按 correctness interruption rule 开 focused issue（不影响 #303 冻结；Proctor 无此路由权限，边界不受影响）。
3. **LATENT 授权**：`attempt.status.view` 在 Proctor preset 但零路由消费者。非缺陷、不阻塞；建议 #303 实现中**不得**顺手为其接消费者（要么维持 LATENT，要么由权限卫生任务单独裁决）。
4. **DOC_STALE（低）**：SPEC.md:19/109/260/267 的 Phase 叙事仍称 Proctor 为未来角色，而 authorization.md `Current scoped-role status` 已如实记载 Proctor→Exam scoped authority 已实现（M11/ADR-015）。live authority 以 authorization.md + presets 为准；建议后续文档收敛任务处理，不阻塞 #303。

## 12. Candidate implementation boundary（候选最小实现边界）

**推荐形状 = Option C（bounded projection endpoint + 既有 canonical commands + UI 页）**：
- 现实缺口只有读面：① 跨 assigned exams 的 incident worklist（今日无 Proctor 端点）；② incident aggregate（notes/事件史）的 Proctor 读投影（今日 write-only）。
- 动作面零缺口：6 个 incident 写端点已存在、已授权、已审计（探针 R6）。
- 因此实现 = 新增 1-2 个 assignment 谓词限定的只读投影端点（复用 `recoveryRepo` 查询逻辑、`deriveAllowedActionsForCaller` 按 Proctor capability 自然收敛）+ 1 个 Proctor 导航页复用既有呈现件；全部 mutation 打既有 incident 端点。**不新增** command/state/audit/表。

### Freeze（PRE-IMPLEMENTATION AUTHORITY FREEZE）

- **F1 Scope owner**：assigned ≡ `exam_proctor_assignments` active episode（proctorAssignmentRepo 谓词）。禁止以 "same organization" 代替 assigned scope。
- **F2 Anti-enumeration**：unassigned/foreign/nonexistent 在 Proctor 表面外部不可区分（404 RESOURCE_NOT_FOUND，ADR-015 §9 canonical）。禁止新造 `NOT_ASSIGNED_TO_PROCTOR` 等泄漏码。
- **F3 Read surface**（HUMAN-GATE CORRECTIVE 2026-09-12 收窄）：Proctor projection **MAY** expose：incident row、incident events/notes、incident attempt/interruption/action links、assigned-exam/attempt summaries（已在 Proctor read authority 内者）。**MUST NOT** 因 "recoveryRepo 已包含" 而暴露：time-adjustment ledger/summaries、auditRefs、Admin recovery-only operational details、force-submit/misconduct/grant 执行明细。指向 Admin-only action 的 incident action link，v1 仅暴露 link 元数据本身（type / linked id / relationship——incident 域自有字段），除非另一既有 Proctor permission 授权底层动作明细。不承诺不存在的数据（无附件/截图）。
- **F4 Actions**：且仅限今日已授权集 = `incident.create` + `incident.investigate` 族（start/note/severity/link-action/link-attempt/link-interruption）。Recovery Center 不因"应该有"而扩权。
- **F5 Admin-only 不可泄漏清单（实物）**：`attempt.force_submit`、`attempt.misconduct.mark`、`attempt.time.grant`、`incident.resolve`（含 dismiss）、`incident.recovery.view`、`exam.proctor_assignment.view/manage`、`grading.*`、`exam.extend/publish-results/close/cancel/archive`、`attempt.export`。以上不得经 Recovery Center 可调用或以可执行形式可见。
- **F6 State model**：NO NEW RECOVERY STATE MACHINE——Recovery Center 是既有 attempt/interruption/incident authority 之上的产品表面。
- **F7 Command reuse**：全部 mutation 走既有 incident command/端点；禁止路由直改行、UI 模拟恢复态。
- **F8 Audit**：全部继承 `recordAtomicHttpAudit` canonical 机制；actor 保持真实 Proctor 身份（探针已证）。禁止第二份 audit。
- **F9 UI reuse**：仅复用 presentation/read 同义组件（RecoveryCommandDialog、useRecoveryOperation、状态映射、wire 驱动 allowedActions 模式）；Admin 动作面板不复用。
- **F10 Non-goals**：无 #304 检测器/系统 incident/规则引擎/风暴抑制；无组织级 Proctor 可见性；无新 incident/evidence store；无通用恢复工作流框架。

### Q1–Q10

- **Q1 assigned = ?** exam_proctor_assignments 中 `(org, exam, proctorUserId, status='active')` 行存在（§3 谓词）。
- **Q2 可读资源？** assigned exam 列表/监控/timeline/proctor-events/incident 行（+ F3 新投影的既有 truth；**F3 corrective 后不含 time-adjustment ledger/auditRefs/Admin operational details**）；无 recovery org-wide 上下文、无 export。
- **Q3 今日可执行动作？** incident create + investigate×6（全部 assignment_scoped、幂等、审计）。
- **Q4 禁止动作？** F5 清单全部。
- **Q5 已有 incident/evidence 数据？** §8 表格所列（全部已持久化、可投影）。
- **Q6 需要新持久化状态？** 否。
- **Q7 需要新状态机？** 否。
- **Q8 canonical anti-enumeration 响应？** 404 + RESOURCE_NOT_FOUND（同一 error body 形状）。
- **Q9 canonical audit 路径？** 命令事务内 `makeAudit` → `recordAtomicHttpAudit`，strict payload，actor=真实操作者。
- **Q10 Admin UI 可复用什么？** §7 分类表（presentation/hook/模式 AS-IS；read model 仅投影复用；动作面板禁用）。

---

## FINAL REPORT

```text
EXAM-303-PROCTOR-RECOVERY-REALITY-AUDIT-1
BASE=347bc18a14d6450c806c27b864c260208ffdb281

PROCTOR_REALITY:
  permissions=exam_room.view, attempt.status.view(死授权零消费者), attempt.timeline.view,
              incident.view, incident.create, incident.investigate
  assigned_scope_owner=proctorAssignmentRepo.findActiveByExamAndProctor / hasActiveAssignment
                       (exam_proctor_assignments active-episode; scopedCapability 门; Admin 短路)
  current_routes=13 条 assignment_scoped/collection 读+incident 写（§2 矩阵）
  current_ui=ProctorWorkspacePage(启动器)/ProctorDashboardPage(监控,动作隐藏)/ExamMonitoringPage;
             无任何 Proctor 可达 incident 页面（API-only gap = #303 title）
  current_reads=assigned exam 列表、监控行、timeline、proctor-events、incident 行
  current_actions=incident create/investigate×6（canonical command+audit，探针 R6 证）

ADMIN_RECOVERY_REALITY:
  read_surfaces=/admin/recovery/{incidents,incidents/:id,attempts/:id,exams/:id}（IncidentRecoveryView）
  commands=resolve/dismiss、force-submit、misconduct-mark、time-grant、grading、publish、
           exam 生命周期、proctor assignment 管理
  terminal_actions=incident.resolve/dismiss、attempt.force_submit、attempt.time.grant、
                   attempt.misconduct.mark（全部 genuinely Admin-only）
  reusable_components=§7 分类表（AS-IS: RecoveryCommandDialog/useRecoveryOperation/状态映射/
                      allowedActions 模式；READ_MODEL_ONLY: recoveryRepo；其余 DO_NOT_REUSE）

ANTI_ENUMERATION:
  assigned=200/正常语义
  unassigned=404 RESOURCE_NOT_FOUND
  foreign_org=404 RESOURCE_NOT_FOUND（chain repo org 锚定 SQL，行不加载）
  nonexistent=404 RESOURCE_NOT_FOUND
  externally_indistinguishable=yes（应用层；body 同形；ADR-015 §9 冻结政策一致）

INCIDENT:
  canonical_model=exam_incidents(+events append-only) ADR-014；9 型 4 级 4 态（2 terminal）
  create_authority=incident.create（Admin org-wide / Proctor assignment-scoped）；仅 human actor
  read_authority=incident.view scoped 读行；aggregate 读 Admin-only
  mutate_authority=incident.investigate（open/investigating；terminal 拒绝）
  resolve_authority=incident.resolve Admin-only（terminal judgment）

EVIDENCE:
  canonical_sources=incident events/notes、interruption episodes(+events)、time-adjustment ledger、
                    attempt_command_receipts、client_events、last_activity_at
  derived_signals=监控行 onlineState/warningLevel（30s/90s 阈值）
  audit_sources=audit_logs（strict payload；disruption/auto-submit 故意无 compliance audit）
  absent=附件/截图/webcam（无表无路由，不得在 #303 承诺）

COMMANDS:
  proctor_allowed=incident create/investigate×6（§9 表）
  admin_only=resolve/dismiss、force-submit、misconduct-mark、time-grant、grading、publish、
             lifecycle、assignment 管理
  canonical_owner=packages/exam-engine incidentCommands.ts / attemptCommands.ts / orchestrators/*

AUDIT:
  actor_identity=ctx.actorId 真实操作者（R6 证 actor=Proctor userId）
  canonical_writer=recordAtomicHttpAudit / makeAudit 事务内；strict per-action payload

STATE_MODEL:
  new_recovery_state_machine_required=no

REALITY_PROBES:
  R1=PASS(列表=恰 assigned;P2 空) R2=PASS(200) R3=PASS(200/200) R4=PASS(404×2)
  R5=PASS(200/404/404/200) R6=PASS(applied+note+severity+audit actor=Proctor)
  R7=PASS(10×403 零副作用;ghost resolve 403) R8=PASS(9 组全 404 同形)
  证据=probe303.reality.test.ts 8/8（临时，审计后删）+ proctorScope/crossOrg 已提交回归

SECURITY_DEFECT_FOUND=no
NEW_BUG_ISSUE=#524: AttemptDetailPage misconduct 缺 operationId 恒 400（Admin 面）

AUTHORITY_DIFF:
  code_drift=无实质（proctorAccess 运行时↔registry 一致性有 conformance 测试钉住）
  doc_stale=SPEC Phase 叙事未反映 M11 已落地的 scoped Proctor authority（低；authorization.md 为 live authority）
  underspecified=无阻塞项

PRE_IMPLEMENTATION_FREEZE:
  scope=assigned-scope only（exam_proctor_assignments active episode）
  reads=F3 清单（既有 truth，经 bounded projection）
  actions=incident.create + incident.investigate×6
  admin_only=F5 实物清单（不得泄漏）
  anti_enumeration=404 RESOURCE_NOT_FOUND 同形（ADR-015 §9）
  command_reuse=既有 incident commands/routes，零新命令
  audit=canonical recordAtomicHttpAudit，真实 Proctor actor
  state_model=NO NEW RECOVERY STATE MACHINE
  ui_reuse=§7 分类（presentation AS-IS / read-model 投影 / 动作面板禁用）

IMPLEMENTATION_SHAPE_RECOMMENDATION=Option C：
  1-2 个 assignment 谓词限定的只读投影端点（worklist + incident aggregate）
  + 1 个 Proctor 导航页（复用呈现件）
  + mutation 全走既有 incident 端点

SUBAGENT_REVIEW=PASS（fresh-context 对抗复核：8/8 问题逐项以 file:line 证实；无承重事实错误；#524 缺陷与 Option C 读面缺口前提均独立复核成立）
REVIEWER_COUNT=1

FINAL_VERDICT=READY_FOR_IMPLEMENTATION
STOP_BEFORE_IMPLEMENTATION=yes
```
