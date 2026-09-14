# 11 — Findings Register（统一登记 · REPORT-CORRECTIVE-1 重建）

severity 语义（按审计规范）：BLOCKER=可致真实考试不可安全运行；MAJOR=真实 100 人场景可能造成显著正确性/可用性/可运维性失败；MINOR=真实缺陷但不单独阻止考试；NOTE=可维护性/文档/未来风险；CANDIDATE=证据不足。**REPORT_CORRECTIVE**=审计报告自身的错误（非 production defect）。

> **REPORT-CORRECTIVE-1**：本登记已重建。原登记 "0 BLOCKER / 1 MAJOR / 12 MINOR /
> 12 NOTE" 不再有效。corrective 后的机械重算：**0 BLOCKER / 0 MAJOR / 12 MINOR /
> 16 NOTE + 7 REPORT_CORRECTIVE（RPT-01..07）**，另附 REJECTED FINDINGS appendix
> （F1-04、F1-10 两条历史误报，不抹除、可追溯）。重算依据：
> - F1-04（examProfile teacher scope 缺失）→ **REJECTED**（org-owned resource，非 course resource；见 REJECTED appendix）
> - F1-10（ADR-010 状态漂移）→ **REJECTED**（legacy header 误读为当前状态）
> - F2-10 → 重写为 TRACKER_POINTER_DRIFT（#498 CLOSED 仍被引用为 current + #534 前置文本未 reconcile；文档/治理 finding）
> - F3-05 → reframed（health 五层拆分，liveness/readiness/diagnostics PROVEN，gating/alerting NOT PRESENT）
> - ADR-018 CODE_BEHIND_ADR → 移除（ADR-018 明确 /system/* = current realization；OTel/Prometheus 为 anti-goal）
> - F-08-1 → severity 统一为 MINOR（部署敏感；08 §4 topology 表分别裁决）
> - 新增 5 条 consolidated NOTE：F2-06/F1-09/F2-09/F3-10/F5-05（存在于各分报告，原登记遗漏——登记完整性修正，非新 finding）

复核规则：所有 MAJOR/BLOCKER 经主 agent 亲自再取证（分类：CONFIRMED/DOWNGRADED/REJECTED/UNKNOWN）。本登记共 **0 BLOCKER、0 MAJOR、12 MINOR、16 NOTE**，审计与 corrective 期间未修任何 production code。

---

## MINOR

### F1-03 · exam/enrollment/attempt status 裸 text 无 CHECK（DOWNGRADED 自 MEDIUM-candidate）
- claim：三个状态列无 DB CHECK/enum（pg.ts:521-531,492-517,271+；对照 0018 迁移 email_outbox_status_check）。impact：raw SQL/新代码可写坏状态；现网唯一写入口=引擎命令+结构测试。why tests：TS 类型仅覆盖编译期。confidence 高。disposition：加 CHECK 迁移（一次性）。
- 主 agent 复核：现网写入面收敛于 engine + 结构锁，真实考试路径不直接暴露 → **MINOR**。

### F1-05 · client_events 无 retention
- claim：insert-only repo（clientEventRepo 无 delete 路径），retention_runs 仅备份证据；无界增长。impact：长周期部署磁盘/表膨胀；telemetry 表增大不阻塞业务查询。code：pg.ts:1047-1103、clientEventRepo。confidence 高。disposition：retention 策略 + 清理循环（script 有先例）。

### F2-05 · system-incident reconcile 无界历史扫描
- claim：每 30s 对全部历史 heartbeat episode 发现（attemptInterruptionEventRepo.ts:180-240），代码自述接受 LAN-scale cost。impact：学期级数据积累后扫描成本线性增长（与 30s 循环叠加）。confidence 高（代码）/中（增长速率 UNKNOWN）。disposition：扫描窗口下界（active/近期 episode）。

### F3-05 · 部署健康门不 gate DB 就绪 + 运维知识全 pull（reframed，原"/api/health DB-blind"）
- claim（corrective 后按五层拆分）：**PROCESS LIVENESS（/api/health）= PROVEN**（按设计静态 ok，apiSurface.ts:42-53）；**DB-AWARE READINESS（/api/system/health，DB ping + dbResponseMs）= PROVEN**（system.ts:304-323）；**OPERATOR DIAGNOSTICS = PROVEN**；**DEPLOYMENT HEALTH GATING = NOT PRESENT**（compose healthcheck 在 PG 宕机时仍 healthy，本审计实测：DB 指空库时服务照常 listen、health 200）；**ACTIVE ALERTING = NOT PRESENT**。
- impact："考试进行中 operator 不知道系统坏了"风险（正文 08 §4），方向 = pull-only 运维。confidence 高（MEASURED）。disposition：compose healthcheck 接线 DB-readiness 门 + 部署 runbook 标注 pull-only；**不构成 ADR-018 violation**。

### F4-05 · 无 metrics/告警面（operability gap，非 ADR violation）
- claim：无 Prometheus/OTel；扫描指标进程内存、重启归零（heartbeat.ts:50-55, deadlineScanner.ts:60-70）。impact：检测停摆无推送通知，依赖人查日志/诊断页。confidence 高。disposition：**与 ADR-018 D7 对齐**（未来按 per-source ADR 接入 metrics/事件源），生产上先接日志告警。

### F-08-1 · 每 IP 限流对共享出口 NAT 考群不安全（部署敏感；severity 统一为 MINOR）
- claim：限流键=HMAC(request.ip)（rateLimitKey.ts:24-30），全局 100 req/min；login 路由 10/min。实测（08 §4）：30 用户/单 IP → 登录 10 后 429；按实测 6.6 req/人/min 折算单 IP ≈15 人触顶。
- operational impact（按 topology，08 §4 表）：**DIRECT LAN（默认 compose）不触发**；**SHARED NAT ≈15 人触顶**；**反代无 XFF 接线 = 全体现共享反代 IP**。finding 统一表述：**DEFAULT RATE LIMIT IS TOPOLOGY-SENSITIVE**（不是 "100 candidates fail"）。confidence 高（MEASURED）。disposition：部署 runbook 明确"每 IP 人数上限/调 RATE_LIMIT_MAX/trustProxy 接线"；或限流键加入身份维度。

### F-08-2 · 准入批次放行依赖考生轮询（lazy reconcile）
- claim：reconcileAdmission 的两个调用点均为考生请求驱动（POST /queue 的 attempts.candidate.ts:597-598 + start 门 ensureStartAdmission，admissionCommands.ts:361←attemptCommands.ts:316），无后台物化；实测停轮询后积压批次一次性补放（56 人同刻 ready）。impact：批量放行的节奏承诺在考生关闭页面时失效，恢复轮询时产生开局冲击波（与 S100 开局风暴叠加）。why tests：durability 测试证明事实正确性，不测轮询节奏依赖。confidence 高（MEASURED）。disposition：接受为语义（文档化）或放行物化交给扫描器。

### F1-04b（原 F2-04）· assignment carriers UI 缺席
- claim：teacher/grader assignment 端点零 UI；proctor assignment UI 仅恢复中心且无逐按钮 can()（RecoveryExamDetailPage.tsx:62,158）；服务端强制正确。impact：admin 无法通过产品完成 teacher/grader 分配（操作性缺口）。confidence 高。disposition：补 UI 或文档化 API-only。

### F2-04（原 F3-04）· ScoreListPage 导出按钮 UI 暴露但服务端拒绝
- claim：按钮无 can() 门（ScoreListPage.tsx:229-234）；Teacher 点击得 403（export.ts:39）。impact：UX 缺陷（安全方向正确）。confidence 高。disposition：补 can(ScoreExport)。

### F3-04（原 F4-04）· client-events 无所有权校验
- claim：POST /client-events 仅 authenticate，attemptId/examId 作为不透明遥测（注释自认 by design，clientEvents.ts:30-43）。impact：跨 attempt 遥测污染（读取 org-scoped，无权限提升）。confidence 高。disposition：接受为已声明风险或加轻量归属校验。

### F5-03 · save 路径 closeAt 非加锁读
- claim：deadlineReconciliation.ts:192,336 非锁定读 exam.closeAt；发布后缩短 closeAt 的 PATCH 可被单请求寿命内的旧值绕过（scanner 路径锁 Exam，自愈）。impact：极小窗口的 save 边界偏差。confidence 高。disposition：接受（有界、自愈）或统一加锁。

### F2-03 · `grading` 幻影状态
- claim：转换表有（attemptStateMachine.ts:44）落库无（grading.ts:278-301 直写 graded）。impact：未来代码可能假设可恢复的 grading 状态存在；崩溃窗口实际落在 submitted（已有恢复）。confidence 高。disposition：清理表项或实现持久化。

## NOTE

### F3-03 · voided/not_started/queued 保留无 writer
守卫面死代码；意图 UNKNOWN（是否有 incident 路径计划写 voided）。disposition：记录意图或清理。

### F4-03 · deadline 边界=请求到达时刻
by design（ADR-006）；锁排队可致业务上"截止后落库"的合法 save（有界）。disposition：无需动作；文档已在锚点注明。

### F6-03 · 同一 reason 两种 submittedAt 语义
lazy=effectiveDeadline / scanner=tick now（deadlineReconciliation.ts:210-227 vs deadlineScanner.ts:249-253）。disposition：统一或文档化。

### F7-03 · scanner 发现查询无覆盖索引（CANDIDATE→NOTE）
OR(closeAt≤now, deadlineAt≤now) per-org 顺序扫描每 30s；大表成本未测。disposition：容量实测后再定索引。

### F8-03 · 候选人提交无持久 operationId
行锁+状态幂等已足；审计经 audit_logs。disposition：无需动作。

### F5-04 · organization.view/update + legacyMap 无消费者
残留 vocabulary。disposition：清理或接线。

### F6-04 · Proctor sensitivePermissions 空
J4-I1B 有意移除（presets.ts:345-348）。disposition：无需动作。

### F1-06 · /exam/settings 无导航入口
直接 URL 可达、服务端门控正常。disposition：无需动作。

### F2-10 · TRACKER_POINTER_DRIFT（重写；原"#534 tracker 漂移 + #498/#534 双语义位"）
- 重写后 claim：**CLOSED TRACKER STILL REFERENCED AS CURRENT**（#498 于 2026-09-11 CLOSED，但 README.md:134、README.zh-CN.md:121、CONTRIBUTING.md:9、docs/README.md:28,52、docs/roadmap/current.md:6,15,28,40,61、post-mvp-issues.md:5,11,70 仍标为 live tracker）+ **POST-#516 TRACKER TEXT NOT RECONCILED**（#534 OPEN 自称 MEMORY ROADMAP，但 "current execution authority remains #516 until closed" 的前置文本在 #516 关闭后未更新）。
- 明确**不构成** duplicate execution authority。#534 自述非执行权威；#498 已关闭。文档/治理 finding，非 runtime finding。disposition：人工收敛 docs 的 tracker 指针（corrective 不修改）。

### F6-05 · email 进程内循环 + 独立 worker 入口并存
逃生舱设计（at-least-once 安全）。disposition：文档化为 escape hatch（已有注释）。

### F7-05 · systemMonitor 容器内读宿主机 CPU/内存
INFERRED（os.cpus() 在容器语义）。disposition：cgroup 感知或标注。

### F5-05 · 扫描循环无 leader 选举（consolidated，原 05 报告 LOW）
多副本安全（事务收敛）但重复做工；部署契约单容器。disposition：单容器契约内无需动作；多实例拓扑另行裁决。

### F1-09 · 仓库无容量/负载测试 harness（consolidated，原 09 报告）
本审计以 /tmp 一次性探针补做（08），未入仓（按审计规范不新建 LoadTestFramework）。disposition：容量承诺随生产部署验收建立。

### F2-09 · E2E spec 细目未逐条核（consolidated，原 09 报告）
57 个 Playwright spec 存在且 CI 全绿（09 §4.2），但覆盖矩阵未逐条审计。disposition：后续按 report 覆盖矩阵核对。

### F3-10 · status 文档未逐条对账（consolidated，原 10 报告）
docs/status/implementation-status.md 未逐行与 as-built 对账（时间盒外）。disposition：下一轮审计或需求时对账。

### F2-06 · ProctorRecovery 双入口并存（consolidated，原 06 报告）
角色分流设计，非缺陷。disposition：无需动作。

---

## REPORT_CORRECTIVE（审计报告自身错误，非 production defect）

| ID | 原错误 | corrective disposition | 证据 |
| --- | --- | --- | --- |
| RPT-01 | false resource-scope projection：F1-04 把 course ownership 投射到 organization-owned 的 examProfile 资源 | CONFIRMED（报告错误）；F1-04 撤销 | pg.ts:403-470（无 courseId）；exam-profile-templates.md §6/§8/§15；presets.ts F-04 marker boundary rule |
| RPT-02 | ADR status parsing error：legacy header（`> **Status:** Proposed`）被当作当前状态 | CONFIRMED；ADR-010 = ALIGNED | ADR-010-scoped-rbac-architecture.md:6 vs :10-12；无机制消费 header |
| RPT-03 | tracker state freshness error：#498 已 CLOSED（2026-09-11）被报 OPEN | CONFIRMED；#498 = CLOSED | gh issue view 498（COMPLETED）；13 处 live docs 引用（6 文件） |
| RPT-04 | authority-vs-operability category error：ADR-018 被当成"承诺未落地"（CODE_BEHIND_ADR） | CONFIRMED；ADR-018 = ALIGNED，保留 operability gaps | ADR-018 D1/D5/anti-goals；observability.md Non-goals |
| RPT-05 | TEST_EXISTS / TEST_EXECUTED conflation："454 单测 + 57 E2E" 被当作 executed functional evidence | CONFIRMED；corpus/executed 分离（09 §1/§4.2） | 09 报告 |
| RPT-06 | internal capability count inconsistency：74（SA 输出）与 89（机械计数）并存 | CONFIRMED；统一 89 | catalog.ts 机械计数（89 keys） |
| RPT-07 | branch ancestry 不真实：audit commit 未 root 于声明 BASE b9b0e08c（merge-base=cc3f2c） | CONFIRMED；corrective 分支真正基于 b9b0e08c | git merge-base / rev-list --left-right |

---

## REJECTED FINDINGS（历史误报，保留可追溯）

| ID | 原始 claim | final disposition | why rejected | evidence |
| --- | --- | --- | --- | --- |
| F1-04 | MAJOR CONFIRMED：examProfile 5 路由平铺门控，Teacher 可读/创建/修改组织内**任意课程**的考试策略 profile，偏离 #286 teacher course-assignment 收窄模型 | **REJECTED**（从 active findings 移除） | The audit incorrectly projected course ownership onto an organization-owned profile resource. `exam_policy_profiles` 无 courseId；P7-M2 契约定义 organization-owned authoring templates 且**显式排除 courseId**（§6）；RBAC 复用 ExamView/ExamCreate/ExamUpdate 是文档化设计（§15 "no new permission family"）；#286 的 teacher scope 标记边界规则只覆盖 "permission whose resource lives under a course"（presets.ts F-04 注释），profile 不是 course resource。**interpretation error，不是 production authorization defect** | pg.ts:403-470；exam-profile-templates.md §6/§8/§15；examProfile.ts:119-127（route 注释）；presets.ts F-04 marker boundary rule |
| F1-10 | NOTE：ADR-010 状态 Proposed vs 已全面实现（状态未翻转 → ADR_BEHIND_CODE） | **REJECTED**（从 active findings 移除） | 文件头部 `> **Status:** Proposed` 是 legacy/历史元数据；当前权威 Status 节明确 "**Accepted — infrastructure implemented**"（:10-12）。文件内存在 stale historical metadata near header，但不构成 architecture drift；无 repository machinery 消费该 header | ADR-010-scoped-rbac-architecture.md:6（header）, :10-12（Status 节）；无脚本读取 ADR status（scripts/ 与 package.json 检查） |

---

## 统计（corrective 机械重算）

| 级别 | 数量 |
| --- | --- |
| BLOCKER | 0 |
| MAJOR | 0 |
| MINOR | 12 |
| NOTE | 16 |
| REPORT_CORRECTIVE（RPT） | 7 |
| REJECTED（appendix） | 2 |

证据完整性：每个 MINOR ≥2 独立锚点或 1 个可执行复现（F-08-1/F-08-2/F3-05 附 MEASURED 实验）；REJECTED 附完整 reappraisal 证据。