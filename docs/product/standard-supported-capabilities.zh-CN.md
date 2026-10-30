# Standard Exam — 受支持能力与保证

> **性质：REVIEWED PRODUCT PROJECTION（经评审的产品投影）** — 描述当前
> Standard Exam 产品实际支持内容的版本绑定说明。本页**不是**新的语义权威：
> 跨边界考试语义仍属 [EXSEM](../architecture/exam-semantic-boundaries.md) /
> 已采纳 [ADR](../adr/README.md)，产品不变量属 [SPEC](../../docs/SPEC.md)，
> 对外行为属 [contracts](../contracts/) 与生成的 OpenAPI，as-built 实现状态
> 属 [implementation-status.md](../status/implementation-status.md)。若本页与
> 规范权威出现分歧，以规范权威为准，分歧按缺陷收敛处理——不得据此重新解释。

**适用版本：** master `511e6e60`（2026-10-27）——`v0.0.10` 发布**之后**的
开发版本。以下事实均针对该代码树核对；本投影**不**宣称所有内容适用于已
发布的 `v0.0.10`。文档失效条件见 §1。

---

## 1. 适用性（Applicability）

- **版本绑定。** 本投影描述 master 提交
  `511e6e60dd332f376f15ea0326f95fcefddaeb84`（2026-10-27）——`v0.0.10`
  release tag（commit `5d005a58`，2026-10-23，早 12 个提交）**之后**的开发
  版本。二者不是同一个产品保证版本：tag 早于 master 上的 ADR-023 备份
  证据子系统移除与 Maintainer 权限重定基（移除提交
  `91dc6ad6`/`bdc59b3c`/`cc318dd5` 均在 tag 之后）。对更早的构建或已发布
  的 `v0.0.10` release，以下陈述不自动成立。
- **证据拓扑。** 部署事实描述随附的单机 Docker Compose 生产拓扑
  （`docker-compose.yml`，project `exam-prod`）。可靠性事实引用 #817
  故障注入实验，其实验环境与该拓扑同构（web + app + db，PGDATA 宿主机
  bind mount），但属于一次性研究环境。
- **单组织、单部署。** 一个部署服务一个机构。`organizationId` 是内部数据
  归属边界；产品是单租户。多租户平台能力（租户登录、租户切换器、
  SuperAdmin）未实现。
- **仅 Standard 组合。** 当前唯一已交付的产品配置是
  "Standard"（[ADR-022](../adr/ADR-022-product-capability-composition.md)
  Phase 1）。"Minimal" preset 是已采纳的设计，不是可选运行时。
- **语言。** 产品 Web UI 仅有简体中文（zh-CN），没有英文界面，也没有语言
  切换器。
- **文档何时失效。** 出现以下任一情况时本页视为过期：更新的 master 状态
  或 release tag 取代 `511e6e60` 且行为发生变化；[ADR-022](../adr/ADR-022-product-capability-composition.md)
  Phase 2–4 落地（写入门禁、Minimal 运行时、持久化部署配置）；
  [#293](https://github.com/jnhu76/exam/issues/293) Controlled/Strict 落地；
  R4 可靠性决策（[#813](https://github.com/jnhu76/exam/issues/813)、
  [#827](https://github.com/jnhu76/exam/issues/827)、
  [#828](https://github.com/jnhu76/exam/issues/828)）被采纳；或
  [ADR-012](../adr/ADR-012-candidate-recovery-contract.md) 的持久化本地草稿
  （`DurableAnswerDraft` / outbox）被实现。

## 2. 受支持的部署形态

As-built（来源：`docker-compose.yml`、`deploy/nginx/web.conf`、
[部署说明](../deployment/README.md)、
[runbook](../deployment/mvp-deployment-runbook.md)）：

- **单机、Docker Compose。** 默认三个服务：`web`（nginx 边缘——唯一公共
  入口，托管静态 SPA 并代理 `/api/**`）、`app`（Fastify API；启动时执行
  数据库迁移；承载进程内邮件 outbox 循环）、`db`
  （`postgres:18.4-bookworm`）。Redis 可选（`redis` profile），仅承载共享
  限流状态。
- **存储。** PostgreSQL 数据位于宿主机 bind mount
  `${EXAM_DATA_ROOT:-./data}/postgres`。宿主机持久化**不等于**备份。
  `app` 与 `db` 不发布宿主机端口；仅 `web` 对外暴露（`EXAM_PORT`，默认
  80）。
- **传输。** 受控 LAN 上的 HTTP 是随附且受支持的模式。HTTPS 是部署方
  （operator）责任：镜像内置 nginx 配置中有注释模板（证书 + 覆盖挂载 +
  443 端口）；应用不终结 TLS，也不附带证书自动化。
- **备份 / 恢复 = Host Operator 责任。** 唯一受支持的机制是通过
  `scripts/db-backup.sh` 执行 `pg_dump -Fc` / `pg_restore`，由部署方自行
  计划与保留（cron/systemd、异地副本）。产品**不**内置备份计划器、目录、
  证据台账或保留策略（[ADR-023](../adr/ADR-023-remove-backup-evidence-subsystem.md)
  已移除备份证据子系统；runbook §17）。
- **不支持：** 多实例 / HA 部署（进程内 scanner 假设单一 API owner）、外部
  PostgreSQL、多节点拓扑、水平扩展、任何云端托管依赖。不存在实测的生产
  RPO/RTO 数值；容器健康启动不构成可用性或持久性保证。

## 3. 考试生命周期

已交付流程（权威：[exam-runtime.md](../architecture/exam-runtime.md)、
[ADR-008](../adr/ADR-008-submit-answer-freeze.md)、
[ADR-006](../adr/ADR-006-exam-time-authority.md)）：

```text
Author → Configure → Publish → Enroll → Start → Save → Submit → Grade → Publish Results
```

- **出题（Author）。** 五种题型：单选、多选、判断、填空、文本作答（含
  rubric）。富内容（题干与选项）使用冻结的 Rich V1 content-document 语法
  （[ADR-019](../adr/ADR-019-content-document-model.md)），支持公式、表格、
  代码，且始终可派生纯文本投影。题目必须归属课程；CSV 导入仅支持 Plain
  内容（可创建 text_response 题目，随后即产生人工评分义务）。
- **配置（Configure）。** 每场考试的 policy：计时模式（`timed_window` /
  `deadline` / `untimed`；`timed_sync` 已由契约冻结但未启用）、时长、重考
  策略与次数上限、分数策略（最高 / 最新 / 首次）、成绩公布方式（即时 /
  评分完成后 / 手动）、中断恢复策略（strict / bounded grace /
  operator incident）、及格分。策略模板（profile）为 copy-on-apply 预填。
- **发布即冻结点。** 发布时一次性构建 `QuestionSnapshot`（内容、选项、
  答案、rubric）；attempt 创建时物化 per-attempt 冻结快照（含乱序决策）。
  之后对题库的修改**不会**影响已发布或进行中的考试；评分只读取冻结
  rubric。
- **准入（Enroll / admission）。** Admin 将考生指派到已发布考试（考试详情
  页选择器）；账户准入是标准路径。持久化准入队列以每考试 policy 存在
  （`requireQueue`，仅 API 开关——无 UI 切换）。
- **时间权威。** 考试时间与截止时间由服务端权威
  （[ADR-006](../adr/ADR-006-exam-time-authority.md)）；客户端倒计时仅用于
  显示。中断补偿遵循
  [ADR-013](../adr/ADR-013-interruption-time-compensation-policy.md)。
- **保存 / 提交。** 答案通过带版本号、幂等、冲突检测的协议保存（§5）。
  提交冻结 attempt：`submitted_answers` 成为评分权威
  （[ADR-008](../adr/ADR-008-submit-answer-freeze.md)）；提交 + 冻结 +
  工作集物化 + 自动评分在单事务中完成，事务提交后崩溃可幂等恢复
  （landed-but-ungraded）。
- **评分（Grade）。** 客观题自动评分。文本作答进入人工评分工作集（显示
  rubric、分数 + 可选评语、逐题不可撤销提交）。未完成的待人工评分是派生
  义务——在依赖评分的结果公布模式下不可跳过。
- **结果（Publish Results）。** 按考试 `resultPublicationMode` 公布；即使
  评分稍后完成，也遵守发布时冻结的模式。结果公布后考生可见及格判定与
  逐题明细。

## 4. Admin 配置面

Admin 今天实际可配置的内容（来源：`apps/web` 页面 + API 路由；能力权威：
[product-capability-composition.md](../architecture/product-capability-composition.md)）：

- **已有真实 Admin UI：** 平台设置与品牌、考生字段、用户（员工 + 考生、
  考生 CSV 导入、员工邀请）、课程、题目（5 题型、Rich 编辑器、仅 Plain
  的 CSV 导入）、考试向导（policy、题目、时间安排）、考试生命周期操作
  （发布 / 撤回 / 关闭 / 延长 / 取消 / 归档 / 发布成绩）、报名（enrollment）、
  评分队列与评分、成绩总览与导出、恢复中心、监考工作台、审计日志、诊断。
- **有 API 支持但 UI 薄弱：** 准入队列开关（`requireQueue`）与批量
  大小 / 间隔（通过 API PATCH 草稿；无 UI 输入）；Proctor → Exam 指派
  （恢复考试详情页有 UI，但需要手动输入用户 ID——不像用户页的
  Teacher/Grader 那样有选择对话框）；admissions 管理视图。
- **静态目录，不是开关。** `packages/domain/src/productCapabilities.ts`
  中的 13 个 `ProductCapabilityId` 是 **Standard 所支持能力的只读投影**
  ——不是 13 个部署开关。resolver 是 fail-closed 的，只接受完整
  Standard 集合；当前没有任何写路径查询该目录（Phase 2 写入门禁未实现）。
  两个 per-exam 旋钮（`requireQueue`、`resultPublicationMode`）是考试
  policy 选择，不是部署能力开关。
- **未实现：** Minimal / 子集组合（Phase 3）、带 revision/CAS 的持久化
  部署配置（Phase 4）、任何逐项能力开关。

## 5. 答案保存语义

考生编辑器将当前答案保存在 React state 中，并以约 1500 ms 防抖保存
（`apps/web/src/hooks/useSubmitFlush.ts`，`DEBOUNCE_MS = 1500`）。保存指示
器恰好有四种 UI 状态：idle（等待保存）、saving（保存中）、saved（已保存）、
error（保存失败）（`apps/web/src/components/exam/SaveIndicator.tsx`）。
下表是解释性分类——这些是理解类别，不是五个已实现的独立 UI 状态：

| 状态 | 用户可以得出的结论 |
| --- | --- |
| 编辑中 / 待发送（防抖窗口内） | 编辑仅存在于浏览器中。**尚未**被服务器接受，刷新或关闭标签页即可能丢失。 |
| 在途（请求已发送） | 保存请求正在处理。结果未知；仅 HTTP 传输成功不能证明业务层已接受。 |
| 失败 / 不确定 | 未可靠保存。UI 显示错误；页面存活期间会自动重试。不得宣称"已保存"。 |
| 服务器 ACK 已接受 | 服务器返回 `accepted: true` 与 `serverVersion`；该答案版本按版本化 / 幂等 / 冲突检测协议持久化。这是 UI 显示"已保存"的唯一条件。 |
| 已提交 / 终态 | attempt 已冻结：`submitted_answers` 是评分权威；生命周期与评分事实遵循提交冻结与终态权威（[ADR-008](../adr/ADR-008-submit-answer-freeze.md)）。 |

每个概念意味着什么——和不意味着什么：

- **UI"已保存" = 服务器 ACK。** 仅当 API 返回 `accepted: true` +
  `serverVersion`（或 STALE_VERSION 对账返回了服务器权威答案）后，指示器
  才切换为"已保存"。
- **HTTP 成功 ≠ 业务接受。** 只有结构化响应作数；客户端跟踪
  `serverVersion` 用于冲突检测，并在 `STALE_VERSION` 时对账。
- **未发送的编辑可能丢失。** 在防抖窗口内刷新（或请求发出前的任何丢失）
  会丢失内存中的编辑。#817 D7 实测：四次防抖前真实刷新全部丢失未发送
  编辑。
- **保存与提交是不同协议阶段。** 自动保存将服务器确认的草稿保存在
  `exam_attempts.answers`；提交冻结 `exam_attempts.submitted_answers`，
  评分只读取后者。
- **没有持久化本地草稿。** ADR-012 的 `DurableAnswerDraft` / 保存 outbox
  是已采纳的**目标**设计，不是已交付功能；浏览器当前不保存任何持久答案
  日志。

## 6. 恢复与故障域

证据基础：#817 故障注入实验（2026-10-28 关闭；真实 Docker + 真实
Chrome/CDP，逐答案 value/version oracle，探索性样本量，
`HISTORICAL_MEASURED`）。其结果**仅描述被测故障域**——不是生产保证，也不
延伸到未测故障模式（断电、磁盘损坏、主机丢失、恶意存储）。

| 故障域 | #817 观察结果 | 证据质量 |
| --- | --- | --- |
| 浏览器刷新（D0，服务器 ACK 后） | ACKed 答案从服务器快照精确恢复；UI ⇄ SQL 对账一致 | HISTORICAL_MEASURED（逐答案 oracle） |
| App 容器停止 / SIGKILL（D1/D2） | ACKed 答案在 PostgreSQL 中保留；防抖内未发送编辑与在途未知请求保持区分 | HISTORICAL_MEASURED |
| PostgreSQL 重启 / SIGKILL 且 PGDATA 完整（D3/D4） | WAL 崩溃恢复；ACKed 答案精确保留（D3：2 次试验；D4：3 次试验——#819 报告的第一阶段 D0+D4 各臂共 40/40） | HISTORICAL_MEASURED |
| 容器重建（同一 bind mount 上 `compose down`/`up`）（D5） | 一次试验结果为 UNKNOWN——其浏览器恢复 / 重新加载环节为 NOT_RUN。**D5 不得并入笼统的崩溃恢复 PASS。** | HISTORICAL_MEASURED，含 UNKNOWN 残留 |
| 恢复较旧的 `pg_dump` 快照（D6） | 恢复出的数据库在**dump 时点**内部自洽，并静默缺失 dump 之后服务器已 ACK 的全部答案（两次试验均缺失 4 条 post-dump ACKed 更新）。这是恢复点回滚，不是 PG 崩溃持久性缺陷。 | HISTORICAL_MEASURED（2 次试验） |
| 未发送的浏览器编辑 + 刷新（D7） | 四次防抖前切断全部丢失未发送编辑；请求 / ACK 均未到达服务器。属本地 pre-ACK 丢失，不是服务器缺陷。 | HISTORICAL_MEASURED（4/4） |
| 终态提交被 app/db 崩溃打断（D8） | 在受测崩溃域内，提交 / 终态与评分完整性保留；证据带明确的重放来源限制，不得推广到旧快照恢复。 | HISTORICAL_MEASURED（有保留） |
| 主机 / 存储销毁、断电、磁盘损坏 | **未测试。** 此时恢复完全取决于部署方的备份节奏与异地副本。上限是最后一个可用的**恢复点**（部署方最近一次可验证的备份）；潜在数据丢失窗口由故障时刻与该恢复点之间的时间决定。当前没有已采纳的生产 RPO 保证，产品也不管理、不度量它。 | NOT_VERIFIED |

产品侧确实存在的恢复功能：基于心跳的异常 attempt 检测、考生自助恢复冻结
的 attempt 快照、Admin/Proctor 恢复中心、operator 时间补偿——均为服务端
权威（[ADR-012](../adr/ADR-012-candidate-recovery-contract.md)、
[ADR-013](../adr/ADR-013-interruption-time-compensation-policy.md)、
[ADR-014](../adr/ADR-014-exam-incident-authority.md)）。

## 7. 明确不保证项

逐项说明产品当前**不**承诺的内容：

1. **没有持久化离线考试客户端。** 没有 IndexedDB 日志、本地 outbox、
   离线出题 / 作答模式（ADR-012 目标 / ADR-016 延期；#827 仅研究）。
2. **不保证恢复未发送的浏览器编辑。** 防抖内及其他未发送的编辑仅存于
   内存（#817 D7 实测丢失）。
3. **没有生产范围零丢失声明。** #817 覆盖的是探索性样本量下的受控故障
   域；不构成对生产或未测故障模式的零数据丢失保证。
4. **没有已采纳的 Host RPO/RTO SLO。**
   [#828](https://github.com/jnhu76/exam/issues/828) 中所有 RPO/RTO 数值
   都是候选决策场景；无一被采纳。
5. **不保证旧备份恢复后保留此后的 ACKed 历史。** 恢复较旧的 dump 只会
   得到 dump 时点状态；此后服务器 ACK 的答案在恢复后的权威中不存在
   （#817 D6）。如何检测 / 处置该回滚是尚未决定的 R4 议题
   （[#813](https://github.com/jnhu76/exam/issues/813)）。
6. **没有 HA 或任意多实例部署保证。** 设计上即单实例。
7. **没有多租户平台。** 一个部署 = 一个机构；没有租户切换器、SuperAdmin
   或 `organizationSlug` 登录。
8. **没有任意逐项能力开关。** 13 项能力目录是只读的；不存在部署级开关
   （ADR-022 Phase 2/4 未实现）。
9. **没有已实现的 Minimal 部署。** Minimal preset 是已采纳设计，不是可选
   运行时。
10. **没有交付 Controlled/Strict 高保障。** 没有锁定浏览器、设备 / 会话
    绑定、二次身份核验或持续监控运行时
    （[#293](https://github.com/jnhu76/exam/issues/293)：未启动）。
11. **没有产品管理的自动化灾难恢复控制面。** Host Operator 负责备份执行、
    计划、保留、验证与演练
    （[ADR-023](../adr/ADR-023-remove-backup-evidence-subsystem.md)）；产品
    不提供备份 UI、台账或 RPO/RTO 投影。
12. **没有基于 IP 的身份证明。** IP/CIDR 限制、设备绑定与单会话强制均未
    实现（runbook §16）；IP 地址不能证明考生身份。
13. **不可由"提交成功"推出"在任何服务器灾难下都不丢"。** 提交冻结保护
    业务 / 评分语义；它不是存储持久性承诺（见 §6）。

## 8. 支持与证据矩阵

产品状态与证据强度分列。`EXECUTED_VERIFIED` 保留给本次文档施工中实际
运行产生的证据——没有——因此不出现。`TEST_ASSERTED` = 仓库中存在具名
测试 / 规范证据（本次未重跑）；`HISTORICAL_MEASURED` = #817 实测试验；
`SOURCE_INSPECTED` = 在锚定提交上读取当前源码。

| 能力 / 保证 | 状态 | 前提 | 适用版本 | 证据类型 | 规范来源 | 限制 |
| --- | --- | --- | --- | --- | --- | --- |
| 5 种题型 + rubric | SUPPORTED | — | 511e6e60（post-v0.0.10） | TEST_ASSERTED + SOURCE_INSPECTED | domain `enums.ts`、发布不变量、#678 审计 | CSV 导入仅 Plain |
| 富内容（题干 / 选项 / 答案，公式 / 表格 / 代码） | SUPPORTED | Rich V1 语法 | 511e6e60（post-v0.0.10） | TEST_ASSERTED + SOURCE_INSPECTED | [ADR-019](../adr/ADR-019-content-document-model.md)、rich-content 语义契约 | 非 Rich 渲染走纯文本投影 |
| 考试生命周期 + 发布冻结 | SUPPORTED | — | 511e6e60（post-v0.0.10） | TEST_ASSERTED + SOURCE_INSPECTED | [exam-runtime.md](../architecture/exam-runtime.md)、[ADR-008](../adr/ADR-008-submit-answer-freeze.md) | 已发布考试仅可改时间安排 |
| 版本化 / 幂等 / 冲突检测答案保存 | SUPPORTED | 页面存活（客户端） | 511e6e60（post-v0.0.10） | TEST_ASSERTED + SOURCE_INSPECTED | answer 协议；[ADR-012](../adr/ADR-012-candidate-recovery-contract.md) | 约 1.5 s 防抖；刷新丢失未发送编辑（D7） |
| UI"已保存"= 服务器 ACK 语义 | SUPPORTED | — | 511e6e60（post-v0.0.10） | SOURCE_INSPECTED | `SaveIndicator.tsx`、`TakeExamPage.tsx` | 不存在独立的"已本地保存"UI 状态 |
| ACKed 答案在 app/PG 重启（PGDATA 完整）、刷新后保留 | SUPPORTED（受测范围） | 随附 Compose 拓扑；bind mount 完整 | 511e6e60（post-v0.0.10） | HISTORICAL_MEASURED（#817 D0–D4） | [#817](https://github.com/jnhu76/exam/issues/817) | 探索性样本量；无断电 / 磁盘 / 主机丢失覆盖；D5 部分 UNKNOWN |
| 人工评分工作集 + rubric 评分 | SUPPORTED | 存在 text_response | 511e6e60（post-v0.0.10） | TEST_ASSERTED + SOURCE_INSPECTED | grading kernel；#678 审计 | 逐题评分提交不可撤销 |
| 成绩公布模式 | SUPPORTED | — | 511e6e60（post-v0.0.10） | TEST_ASSERTED + SOURCE_INSPECTED | `resultPublicationMode` 权威 | 发布时冻结；per-exam policy，不是能力开关 |
| 考生中断恢复、恢复中心 | SUPPORTED | — | 511e6e60（post-v0.0.10） | TEST_ASSERTED + SOURCE_INSPECTED | [ADR-012/013/014](../adr/)、recovery contract | 仅服务端权威；无本地草稿捞回 |
| 准入队列（`requireQueue`） | SUPPORTED（policy） | 仅 API 开关 | 511e6e60（post-v0.0.10） | TEST_ASSERTED + SOURCE_INSPECTED | admission runtime #292 | 无 UI 开关；关闭后排空（drain）是 Phase 4 义务 |
| 单机 Compose 部署、HTTP LAN | SUPPORTED | Docker 主机、LAN | 511e6e60（post-v0.0.10） | SOURCE_INSPECTED + runbook §11 冒烟 | [部署说明](../deployment/README.md) | HTTPS = 部署方模板；无 ACME |
| 部署方备份 / 恢复（`db-backup.sh`） | SUPPORTED（host 路径） | 由部署方执行 | 511e6e60（post-v0.0.10） | SOURCE_INSPECTED + HISTORICAL_MEASURED（#812 G0 DB 路径恢复） | runbook §17、[ADR-023](../adr/ADR-023-remove-backup-evidence-subsystem.md) | 仅数据库路径演练；无应用启动验收、无产品 RPO/RTO |
| 旧快照恢复完整性 | PARTIAL | — | 511e6e60（post-v0.0.10） | HISTORICAL_MEASURED（#817 D6） | [#817](https://github.com/jnhu76/exam/issues/817)、[#828](https://github.com/jnhu76/exam/issues/828) | 旧备份恢复会丢失之后的 ACKed 答案；回滚处置未决 |
| TLS / HTTPS 入口 | PARTIAL | 部署方证书 + nginx 覆盖 | 511e6e60（post-v0.0.10） | SOURCE_INSPECTED | 部署说明 "Network / TLS" | 无证书自动化；模板须逐镜像应用 |
| `timed_sync` 计时模式 | DEFERRED | B2 产品决策 | 511e6e60（post-v0.0.10） | NOT_VERIFIED | [timed-sync-semantics.md](../contracts/timed-sync-semantics.md) | 契约已冻结，未启用 |
| 持久化本地答案草稿 / 离线客户端 | NOT_SUPPORTED | — | — | NOT_VERIFIED | [ADR-012](../adr/ADR-012-candidate-recovery-contract.md)（目标）、[ADR-016](../adr/ADR-016-future-offline-resilient-client-data-and-recovery-model.md)（延期）、#827（研究） | 研究 / 决策阶段 |
| Minimal / 子集组合、逐项能力开关 | NOT_SUPPORTED | — | — | NOT_VERIFIED | [ADR-022](../adr/ADR-022-product-capability-composition.md) Phase 2–4、#678 | 设计已采纳，未实现 |
| Controlled/Strict 高保障（设备绑定、锁定浏览器、持续监控） | NOT_SUPPORTED | — | — | NOT_VERIFIED | [#293](https://github.com/jnhu76/exam/issues/293) | umbrella tracker；#315/#316/#317 未启动 |
| 多租户平台 | NOT_SUPPORTED | — | — | NOT_VERIFIED | [SPEC](../SPEC.md)、Phase 4 路线图 | — |
| HA / 多实例 | NOT_SUPPORTED | — | — | SOURCE_INSPECTED | runbook §16 | 设计上单一 API owner |
| 产品 RPO/RTO SLO | NOT_SUPPORTED | — | — | NOT_VERIFIED | [#828](https://github.com/jnhu76/exam/issues/828)（仅候选值） | 无已采纳阈值 |
| 主机丢失 / 断电持久性 | NOT_SUPPORTED（未测试） | — | — | NOT_VERIFIED | [#817](https://github.com/jnhu76/exam/issues/817) 范围限制 | 取决于部署方备份 |

---

*投影评审：本页为 [#751](https://github.com/jnhu76/exam/issues/751) 针对
master `511e6e60` 编写并经对抗性复审。修正应先落在规范权威；规范变化时
本页必须重新核对。*
