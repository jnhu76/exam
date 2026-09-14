# 04 — RBAC：capability → 实现 → scope → API → UI

scope：从 capability catalog 到 UI affordance 的完整授权链。method：SA1 子代理全链推导 + 主 agent 对 MAJOR-candidate 发现的亲自复核（CONFIRMED）。UI 永远不是安全权威。证据均为 OBSERVED_CODE/OBSERVED_SCHEMA，附 file:line。

> **REPORT-CORRECTIVE-1**：本报告的 examProfile 相关结论已被推翻——F1-04 重新裁决为
> **REJECTED**（examProfile 是 organization-owned 资源，非 course resource；
> 原审计把 course ownership 错误投射到一个组织级资源上）。capability 总数统一为
> **89**（机械计数，见 §2）。详细 disposition 见 11 报告 REJECTED FINDINGS 与 13 报告。

## 1. 真实角色清单（代码验证，非文档）

`catalog.ts:234-244` 定义 7 个角色：**Admin, Teacher, Proctor, Grader, Candidate, Maintainer, System**。
- DB CHECK 约束 `user_role_assignments.role` 仅允许 6 个可分配键（System 排除，`pg.ts:1613-1644`）。
- System 为合成 actor：闭集 actor-id {system:deadline-scanner, system:heartbeat, system:incident-detector}，`createSystemRequestContext` 对集合外 id 抛错；不可登录、不可分配（`systemActor.ts:23-70`）。
- 多角色：同一用户可持多个活跃 assignment（恰一个 primary，partial unique index）；权限 = 活跃角色预设的并集（`assignmentAuthority.ts:227-233`）。
- **Admin∩Maintainer 双活跃 fail-closed**（`deriveAssignmentAuthority:221-223`）；写侧另有 advisory-lock seam + ≥1-活跃-Admin 后置条件（`adminMaintainerExclusion.ts`）。

## 2. Capability catalog（89 个闭集 key，机械计数确认）

`packages/authz/src/catalog.ts` `export const Permission = {…}` 对象体逐行机械计数（正则 `^\s{2}\w+:`）结果：**89**。中途 SA 输出的 74 为误计，本 corrective 统一使用 89；全报告集（04/12/Issue 摘要）不得再出现 74。scope 枚举：system/organization/course/exam/attempt/candidate/own_attempt/own_score（school/grading_task 延期）。角色预设复核：Admin=76 项授予（同文件机械计数一致）。

## 3. 角色预设矩阵（`presets.ts`，压缩）

| 角色 | cap 数 | 要点 |
| --- | --- | --- |
| Admin | 76 | 除 Candidate own-runtime、ScoreOwnView、system.auto_submit 族、system.incident.create、system.info.view 外全部 |
| Teacher | 18 | OrgView/CandidateView + Course/Question CRUD/Import + Exam view/create/update/publish/close/enrollment/result-publish + ScoreAllView（#286：非 Admin 时经 scopedCapability/LIST 过滤收窄到 course assignment） |
| Proctor | 6 | ExamRoomView, AttemptStatusView, AttemptTimelineView, IncidentView/Create/Investigate。misconduct/force-submit 已被 J4-I1B 移除；无 time-grant/grading/结果发布 |
| Grader | 4 | GradingQueueView/DetailView/AnswerView/ScoreWrite（Finalize/IdentityView 留空双盲） |
| Candidate | 8 | ExamTake + Attempt 自有族 + ScoreOwnView |
| Maintainer | 5 | SystemHealth/Diagnostics/Backup/RestoreReadiness/OpsPolicyView，**零业务权限**（exact-set pin 测试） |
| System | 4 | auto_submit/heartbeat_scan/lifecycle_reconcile/incident.create（仅合成路径） |

## 4. 运行时授权链（assignment 是唯一权威）

```text
JWT cookie → verifyJWT → DB 加载 user + ACTIVE user_role_assignments
  → deriveAssignmentAuthority（subject 锚点校验 / 恰一 primary / 未知角色 fail-closed / Admin∩Maintainer fail-closed / 并集）
  → ctx.capabilities
  → requireCapability（平铺）或 requireScopedCapability（capability→DB scope resolver→assignment gate）
  → 专用门：requireOwnAttempt（所有权，404 反枚举）/ requireExamEligibility（服务端推导）/ requireScoreCapability
→ 引擎命令信任调用方（无 actor 授权；仅 manualGrading grading_mode 与 systemIncidentCommands System 反伪造两处业务例外）
```

Deny 映射：无 assignment→401；resolver 失败→503（AUTHZ_UNAVAILABLE，绝不降级到 users.role）；跨 org/所有权不匹配→403；资源不存在→404（反枚举）。**未发现 fail-open 路径。**
Evidence：`plugins/auth.ts:60-207,128-131`；`assignmentAuthority.ts:145-246,262-278`；`plugins/authz.ts:132-193`；`scopedCapability.ts:182-468,251-279`。

## 5. 代表性路由门控图（capability | 形式 | 附加）

| 路由 | 门控 | 形式 |
| --- | --- | --- |
| attempts.admin: misconduct/force-submit/time-grants | AttemptMisconductMark/ForceSubmit/TimeGrant | scoped attempt，无 proctorAccess ⇒ Admin-only |
| attempts.admin: timeline | AttemptTimelineView | scoped + proctorAccess assignment_scoped（无 assignment→404） |
| exam publish/close/enrollment/results/update | 对应 cap | scoped + teacherAccess |
| exam unpublish/extend/cancel/archive/delete/export | 对应 cap | 平铺（cap 本身 Admin-only） |
| grading queue/details/score-write | Grading* | 平铺/ scoped + graderAccess；Grader 列表 SQL 先按 grader_exam_assignments 过滤再分页 |
| incidents create/list/investigate | Incident* | scoped + proctorAccess；resolve/dismiss=IncidentResolve（Admin-only） |
| proctorMonitoring | ExamRoomView 族 | 平铺（非 Admin 后端按 assignment 过滤）/ scoped + proctorAccess |
| roleAssignments CRUD | UserRoleAssign | + authority-invariant 包装（互斥锁 + Admin 存活后置条件） |
| attempts.candidate 全族 | ExamTake/AttemptViewOwn/… | requireExamEligibility / requireOwnAttempt |
| clientEvents POST | **仅 authenticate** | 无 capability/所有权门（F3-04 登记于 11） |
| examProfile 全部 5 路由（list/create/detail/update/delete，examProfile.ts:135,159,257,291,405） | ExamView/ExamCreate/ExamUpdate **平铺** | **意图明确的 org-owned resource（P7-M2 已文档化）**：profile 表无 courseId（pg.ts:403-470），`courseId` 被显式排除在 profile 语义外（exam-profile-templates.md §6），RBAC 复用是设计决定（§15 "no new permission family"），#286 的 teacher 收窄标记只应用于"resource lives under a course"的权限（presets.ts F-04 注释 marker boundary rule）。**F1-04 REJECTED —— 不是授权缺陷** |

结构锁：`routeRegistryConformanceWholeApp.test.ts` 证明真实 apiSurface 组合下 0 个 requireRole/legacy 门、每个受保护路由恰一个 capability/ownership 门、公开集闭包。

## 6. 分类矩阵（89 caps 汇总；分类**非互斥**，一行可同时属于多类，禁止求和为 partition）

| 分类 | 数量 | 代表 |
| --- | --- | --- |
| SERVER_ENFORCED | ≈85（89 中除 DECLARED_ONLY 外的余额按“至少有一个消费点”记；不保证每 key 逐一核对） | exam 生命周期、批改、incident、proctor ops、user/role 管理、candidate runtime（own-attempt 链）；含 examProfile 3 key（路由真实消费） |
| DECLARED_ONLY（无生产消费者） | 8 | system.auto_submit/heartbeat_scan/lifecycle_reconcile（扫描器从不评估 capability）；system.info.view（路由公开）；candidate.delete（Admin 授予但路由不存在）；grading.finalize + grading.identity.view（预留 M11 无消费者）；organization.view/update（授予无路由消费） |
| DEAD | 0 | （result.publish alias 已被 P4-C1 移除） |
| BACKEND_ONLY（有服务端消费、无 UI） | ≈6 | teacher/grader assignment 管理（无 UI）；proctor assignment manage 仅在恢复中心页面出现 |
| UI_EXPOSED | 37 | apps/web 全仓 `Permission.*` 引用去重 = 37 key（机械 grep，corrective 复核修正原"39"）；`adminRouteCapabilities.ts` deny-by-default + "NOT A SECURITY CONTROL" 契约（capabilities.ts:11-15） |

分类口径：SERVER_ENFORCED 的 ≈85 是"除 8 个 DECLARED_ONLY 外全部"的上界估计，未对 89 个 key 逐一做"至少一个路由消费"的穷举核对（09 报告 routeRegistryConformance 只证明"每受保护路由恰一门"，不证明"每 key 至少一门"）。此表是 non-disjoint 分类，不代表 partition；任何合计都不得与 89 直接相减。

## 7. 攻击模式结果（全部有证据）

| 模式 | 结果 |
| --- | --- |
| route 受保护但命令经旁路可达 | **未发现**（全 app 结构锁 + 单一 /api scope） |
| Admin 误继承 Maintainer / 反向 | **未发现**：Maintainer 集 ⊂ Admin 集且组合被禁止；写侧互斥 seam + 读侧 fail-closed |
| Proctor 达到 admin 级动作 | **未发现**：misconduct/force-submit/time-grant 均为 Proctor 所缺 cap；incident resolve Admin-only；proctorAuthorization.e2e.test.ts 全矩阵证明（含吊销/角色丧失/跨 exam 404） |
| Candidate 跨 org/跨所有者枚举 | **未发现**：org 锚来自 DB user 行；owner==actor；跨考生探测→404；repo 全部 organizationId 过滤 |
| System 身份伪造 | **未发现**：闭集 actor-id + DB CHECK + 引擎内二次校验；无 HTTP 路径铸造 System ctx |
| 仅由 UI 强制的 scope | **未发现**：每个 UI 作用域列表都有对应服务端 SQL 过滤 |

## 8. 审计轨迹

所有变更性 capability 使用 + 敏感读（批改详情、attempt/score/audit 导出、时间授予、强制提交、misconduct、角色变更×5、carrier 变更、ops policy）经闭合 AuditAction union 审计（fail-loud 边界断言）。**未审计**：普通 GET 读面（系统诊断、业务摘要、users/candidates 列表、审计日志 LIST 本身）、client-events 摄取。

## 9. Findings

| ID | 级别 | 摘要 | 主 agent 复核 |
| --- | --- | --- | --- |
| F1-04 | ~~MAJOR（CONFIRMED）~~ **REJECTED** | 原 claim：examProfile 5 路由平铺门控，Teacher 持 ExamView/Create/Update 且 #286 收窄仅实现在 exam 路由——Teacher 可读/创建/修改**任意 org 内**考试策略 profile | **REJECTED（corrective 重新取证）**：exam_policy_profiles 无 courseId（pg.ts:403-470）；P7-M2 契约显式定义 organization-owned authoring templates 且 §6 显式排除 courseId；§15 文档化"no new permission family"复用；#286 marker boundary rule（presets.ts F-04 注释）只标记 course-resident resource 权限。原审计把 course ownership 投射到 org-owned resource——interpretation error，不是 production authorization defect。完整 disposition 见 11 REJECTED appendix |
| F1-04b（原 F2-04） | MINOR | teacher/grader assignment 零 UI；proctor assignment UI 仅在恢复中心详情页且无逐按钮 can()（服务端正确强制） | — |
| F2-04（原 F3-04） | MINOR | ScoreListPage 导出按钮无 UI 门控；Teacher 点击得服务端 403（UI 暴露但服务端拒绝；方向安全） | — |
| F3-04（原 F4-04） | MINOR | POST /client-events 仅 authenticate，attemptId/examId 作为不透明遥测接受，无所有权校验（跨 attempt 遥测污染；读取 org-scoped；注释自认 by design） | — |
| F5-04 | NOTE | organization.view/update、legacyMap 为无消费者残留 | — |
| F6-04 | NOTE | Proctor sensitivePermissions 空为 J4-I1B 有意移除；AttemptTimeGrant 保持 Admin-only 陷阱权限 | — |

> ID 统一说明：11 报告 register 为 ID 唯一权威；本表的 F1-04b/F2-04/F3-04 即 register 中的对应项（原审计 04 报告的 F2-04/F3-04/F4-04 编号在 register 中发生过一次重编号，corrective 不再变动 register ID，只在 changelog 记录映射）。

## 10. Unknowns

- 读面是否由运维层（nginx/OTel 日志）补偿审计（INFRA UNKNOWN）。
- 生产 DB 是否存在非预设自定义角色（resolver 对不可分配键 fail-closed）。
- ~~F1-04 的意图：是否存在有意排除 profile 于 #286 之外的决策记录（未找到）。~~ → **已解决（corrective）**：意图有文档化决策记录——P7-M2 `docs/contracts/exam-profile-templates.md` §6（courseId 显式排除）+ §15（capability 复用为设计决定）+ route 注释 examProfile.ts:119-127。不存在未记录的排除。
