# 原生可观测信号契约提案（#1001：模块边界、事件/字段目录与多组织上下文）

> Status: **PROPOSED**（2026-11-17 起草，提交 Owner 架构评审；未接受前不构成施工授权，不改变任何现行契约，不修改 `docs/contracts/observability.md` 等已生效文档的效力。）
> Baseline: master@`4e0f02d6835df68fa3ce96032b01169e7f6737a5`（含 PR #1014 合入的 #998 修复）
> 来源：#1001（DESIGN_ONLY / OWNER_GATE）、umbrella #1000、研究基线 #999、策略提案 [ADR-029](../adr/ADR-029-exam-native-observability.md)（PROPOSED）
> 消费对象：#1002–#1013 共 12 个后续 Issue 的设计输入；它们仍需各自授权后才可施工。

本文是 #1001 的完整设计提案：所有权图（§1）、E01–E12 字段目录（§2）、组织上下文威胁矩阵（§3）、模块方案 A/B/C 与 EXTRACT/NO_EXTRACT 证据（§4）、closed-field 示例与失败/容量/测试策略（§5）、与 #1012 的并行边界（§6）、留给 Owner 的决定清单（§7）。文中所有 as-built 断言均附 `file:line` 证据（按 Baseline SHA 现场核对）；所有量化预算均标注为**提案/目标**，没有任何一项已测 PASS。

## 0. 冻结边界（本提案自身遵守，并约束它推荐的任何后续实施）

继承 #1001 正文与 umbrella #1000 的 Stop 条款，本提案不引入、不推荐引入：

1. OTel、Collector、日志数据库、新默认容器、遥测网络、C++ addon、workspace package、通用事件总线；
2. 对 Audit/Receipt、考试时钟权威、DB 锁序/事务隔离/重试、命令幂等、邮件 ownership fencing、退避、at-least-once、shutdown budget 的任何修改；
3. 新的 tenant-facing 日志查询 API、租户切换、SuperAdmin 或可运行 multiTenant 模式（当前产品边界是一部署一机构）；
4. 无界 map/queue/buffer；高基数身份（tenant/user/attempt/operation ID）做 metric label；
5. 对 #1010（日志频率）、#1011（审计激活）、#1013（清理任务）的任何顺便实施。

技术日志是 best-effort 信号：不得成为业务成功/失败的判定依据（业务事实权威是 audit_logs / receipt / 领域状态，见 §1.1 S5）。requestId 只属于真实 HTTP 请求；operationId、tickId、workerInstanceId、retryOrdinal 各有独立语义，禁止互相冒充或伪造 HTTP 身份（现行契约 `docs/contracts/observability.md` "Background work" 条款）。

---

## 1. A1 — 信号所有权图

### 1.1 as-built 所有权图

每个信号一行：生产模块 → 部署宿主 → 数据来源 → sink → 持久化 → 权限 → 生命周期。行号按 Baseline SHA 核对。

| # | 信号 | 生产模块（file:line） | 部署宿主 | 数据来源 | sink | 持久化 | 权限 | 生命周期 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | HTTP 请求日志 | `apps/api/src/server.ts:120-128`（Pino + REDACT_CONFIG + req/err serializer；serializer 在 `apps/api/src/lib/logRedaction.ts`） | API 进程 | Fastify request/reply | stdout JSON（Docker 捕获） | 无 | Host 运维读取，不经 Exam RBAC（ADR-018 D6） | 随进程；无缓冲 |
| S2 | requestId（UUIDv4） | `apps/api/src/server.ts:117`（`genReqId`）、`:119`（`requestIdHeader:false`）；响应头 `apps/api/src/plugins/requestIdHeader.ts`；审计载体 `apps/api/src/audit/auditWriter.ts:83` | API 进程 | node:crypto | pino reqId / 错误 envelope / `x-request-id` / 审计 `metadata.requestId` | 仅随审计行 | 生成无权限；ADR-025 权威 | 每请求一个；非业务身份 |
| S3 | 全局错误处理 | `apps/api/src/plugins/errors.ts:89-140` | API 进程 | 抛出的 error + request.id | `request.log.error({err})`（经 #998 白名单 serializer）+ JSON envelope | 无 | 错误响应本身不鉴权 | 每请求 |
| S4 | DB 事务重试 warn | `packages/db/src/types.ts:106`（模块级单例 logger）、`:217-225`（warn `{attempt, sqlstate}`）；接线 `apps/api/src/plugins/db.ts:35`（每进程一次） | API 进程（standalone worker 不接线：`apps/api/src/workers/emailDeliveryWorker.ts:173` 后无 `setTransactionRetryLogger` 调用，全仓唯一接线点是 db.ts:35） | executeInTransaction catch（40001/40P01，`types.ts:86-89`） | 进程 root logger（Pino） | 无 | 无 | 模块级单例；scripts/tests 下静默 |
| S5 | 审计（业务事实权威） | `apps/api/src/audit/auditWriter.ts`（HTTP `:81-84` 注入 `metadata.requestId`；system `:111-134` 注入 `metadata.operationId`，冲突即抛）；策略 `apps/api/src/audit/auditPolicy.ts:755-772`（email actions reserved）、`:1068-1073`（`assertActiveAuditAction` 对 reserved 抛错）；drain `apps/api/src/plugins/auditLifecycle.ts` | API 进程 | RequestContext / SystemAuditContext | `audit_logs` 表（append-only） | 是（PostgreSQL） | 写入经业务授权；读取 Admin（`GET /api/admin/audit-logs`） | best-effort drain，shutdown 受 10s 超时 |
| S6 | /system/health、/system/diagnostics | `apps/api/src/routes/system.ts:281-302`（health 直接 `pingDb()` :297，无本地失败边界）、`:355-379` + `buildOperationalDiagnostics`（同样直接调用）；schema `packages/contracts/src/system.ts` | API 进程 | 进程内 metrics + DB | JSON 响应 | 无（读时计算） | SystemHealthView / SystemDiagnosticsView（Admin+Maintainer）；integrity 块 Admin-only（`:372-376`） | 每请求 |
| S7 | /api/ready、/api/health | `apps/api/src/routes/apiSurface.ts:80-99`；探针 `apps/api/src/plugins/operabilityMonitor.ts:117-153`（2s 预算） | API 进程 | pingDb + redisRuntime | 200/503 | 无 | 公开（无鉴权） | 每请求；单一 readiness 权威（#547） |
| S8 | heartbeat scanner tick | `apps/api/src/plugins/heartbeat.ts:53-88`（进程内 counters，重启重置）、tick 逐组织（system ctx `:144-146`） | API 进程 | DB（逐 org） | Pino + 进程内 counters | counters 无持久化 | System actor context | setInterval unref；进程重启计数清零 |
| S9 | deadline scanner tick | `apps/api/src/plugins/deadlineScanner.ts:66-99`（metrics）、`:442-450`（仅 `submitted>0‖failed>0` 才记汇总行）、`:451-454`（tick throw） | API 进程 | DB（逐 org） | Pino + 进程内 counters | 无 | System actor（逐 org ctx） | 同 S8 |
| S10 | operability.* 告警 | `apps/api/src/plugins/operabilityMonitor.ts:285-292`（固定事件枚举 readiness/background_loop/business_failure/tick_failure）、转移去重 `:234-252` | API 进程 | S8/S9 metrics + readiness probe | Pino（`event/component/state` 固定字段） | 无（进程内去重状态，重启可重发） | 无 | unref interval 15s |
| S11 | 邮件投递（in-process 宿主） | `apps/api/src/plugins/emailOutboxLoop.ts:43`（workerInstanceId）、`:45-54`（log → fastify.log/Pino）、`:60-76`（heartbeat 写失败 warn，error 字段为原始 message）、`:80-91`（单 org orgScope） | API 进程 | DB outbox + sender | Pino + `worker_heartbeats` 行 | heartbeat 是（DB） | 后台循环；System org scope | workerInstanceId 每进程启动新随机；shutdown budget |
| S12 | 邮件投递（standalone 宿主） | `apps/api/src/workers/emailDeliveryWorker.ts:43-56`（`JSON.stringify` 直接写 stdout/stderr，**不经 Pino/redact/serializer**）、`:264-283`（成功心跳）、`:289-307`（poll 失败心跳+日志，error=原始 message）、`:370-377`（入口失败含 stack）、`:170-172`（databaseUrl 正则打码后仍输出） | 独立 node 进程 | DB outbox + sender | stdout/stderr JSON + `worker_heartbeats` 行 | heartbeat 是（DB） | 无（Host 面，不经 Exam RBAC） | 自持 signal handler；入口失败 exit(1) |
| S13 | 邮件错误脱敏（共享纯函数） | `apps/api/src/email/sanitizeError.ts:22-62`（**保留 name/message/code/command/responseCode/response 自由文本**，仅擦已知密码字面量与 password/bearer 正则形状 `:71-92`） | 两宿主共享 | 任意 thrown value | 消费者：`apps/api/src/email/outboxService.ts:124`（→ `email_outbox.lastError`）、`apps/api/src/email/senders.ts:176`、`apps/api/src/routes/email.ts:81`（/email/test 响应体） | 经消费者持久化 | 无（纯函数） | 无状态 |
| S14 | SMTP sender 包装 | `apps/api/src/email/senders.ts:160-169`（recipient rejected 构造含 `message.to` 的 EmailSendError）、`:172-177`（其他错误先扁平化为字符串再包装）、`:190-195`（EmailSendError） | 两宿主 | transporter.sendMail / SendInfo | 抛出（message 为自由文本） | 无 | 无 | transporter 生命周期随宿主 |
| S15 | worker heartbeat（**部署级**） | `packages/db/src/repository/workerHeartbeatRepo.ts:46-76`（upsert ON CONFLICT(workerInstanceId)）、`:82-92`（`findLatestByName` 按 workerName 全局最新，**无 organizationId**）、`:94-97`（仅两方法，无 delete） | 两宿主写；API 读 | 宿主循环 | `worker_heartbeats` 表 | 是 | 写无鉴权（内部）；读经 /system/diagnostics（Admin+Maintainer） | 每次进程重启新增一行（E12 缺口） |
| S16 | 诊断投影中的 lastError | `apps/api/src/routes/system.ts:100`（findLatestByName）、`:112`（`lastError = heartbeat.lastError` 原样进响应）、`:113-121`（workerStatus 判定）；schema `packages/contracts/src/system.ts:101`（`lastError: z.string().nullable()`） | API 进程 | worker_heartbeats 行（含历史脏值） | JSON 响应 | 无 | SystemDiagnosticsView（Admin+Maintainer） | 每请求读取 |
| S17 | 保存拒绝 WARN（#861） | `apps/api/src/routes/attempts.candidate.ts:1124-1138`（organizationId/actorId/actorRole/attemptId/questionId/clientSeq/reason/serverVersion，无答案内容） | API 进程 | saveAnswer 冲突结果 | Pino | 无 | 已认证候选 | 每拒绝一次 |
| S18 | admin 命令 receipt | `apps/api/src/routes/attempts.admin.ts:175-206`（force-submit）、`:251-309`（time-grant）；orchestrator 拥有 receipt/outcome；路由 handler 不记录 outcome 日志 | API 进程 | orchestrator 已验证 outcome/operationId | HTTP 响应（receipt）+ 审计（事务内） | receipt/ledger 持久化 | scoped capability + Admin x-role；403/404 早退（`apps/api/src/authz/scopedCapability.ts:344-350` anti-enumeration 404，无专用日志） | 每命令 |

**重点核对结论**（每条附证据，不以注释代替实现）：

1. **DB root retry logger 是进程级接线，不保存请求身份 — 属实。** `packages/db/src/types.ts:106` 模块级可变单例；`apps/api/src/plugins/db.ts:35` 每进程接线一次；warn payload `types.ts:217-225` 仅 `{attempt, sqlstate}`。调用点（如 `apps/api/src/routes/attempts.candidate.ts` save 事务、`apps/api/src/orchestrators/submitAndGradeAttempt.ts:62`）与 logger 之间无 per-call 通道（见 §2 E05 的两条路线比较）。
2. **worker heartbeat 是部署级记录 — 属实。** `workerHeartbeatRepo.ts:82-92` 按 workerName 全局取最新，无 organizationId；两宿主写同一 workerName `"email-delivery"`（`emailOutboxLoop.ts`、`emailDeliveryWorker.ts:32`）。与 org-scoped 的 `email_outbox`（`apps/api/src/email/outboxService.ts` 经 repo `resolveOrgId`）形成明确作用域差；未来多租户设计必须显式标记（§3）。
3. **SMTP sender 包装不能把安全代码塞进自由文本 — 属实。** `senders.ts:160-169`（recipient 地址进 message）与 `:172-177`（任意错误扁平化成字符串）证明下游只能拿到字符串；`outboxService.ts:135-138` 注释宣称 lastError 为 "category/stable-code only" 与 sanitizer 实际行为（`sanitizeError.ts:28-35` 保留 message）不符——注释缺陷，由 #1012 收敛。
4. **"经 Pino 即安全"仅对 `err` 序列化通道成立 — 属实。** #998 后 `serializeErrorForLog` 将 message 固定为 `[redacted error message]`、stack 恒空、code 仅封闭集合（`apps/api/src/lib/logRedaction.ts:232-257`、safeCodeOf 封闭集合校验）。但 S11/S12 的自定义 `error:` 字符串字段不经过该通道——这是 E11 的核心缺口。
5. **两个邮件宿主不共享 transport — 属实。** in-process 经 `fastify.log`（Pino，受 REDACT_CONFIG + serializer 保护）；standalone 经 `process.stdout/stderr.write(JSON.stringify(...))`（`emailDeliveryWorker.ts:43-56`），完全绕过 Pino 的 redact/serializer。两条序列化路径不等价，未来测试须分别采集真实字节（§5.3）。

### 1.2 proposed 所有权图（本提案推荐）

原则：**所有现有 owner 不变**；新增的只是各 owner 内部的发射点（typed local adapter，方案 A，§4），加上邮件模块内一个已获 #1012 授权方向的单一隐私策略 owner。不新建中央模块、不新建包、不新建目录。

| 变更 | owner（不变） | 新增内容（PROPOSED，待 Owner 批准后由对应 Issue 实施） | 依赖方向 |
| --- | --- | --- | --- |
| P1 | 邮件模块（`apps/api/src/email/*`） | 单一隐私策略 owner（封闭分类 + 受控 code 集合，替换 `sanitizeError.ts` 的自由文本语义）；两个宿主保留各自 transport adapter（Pino / stdout JSON）；读侧历史投影在 `routes/system.ts`。实施细节以 #1012 PR 为准（§6） | email 模块内闭环；宿主 → email 模块（既有方向） |
| P2 | `packages/db`（executeInTransaction） | 可选 `correlation` 显式参数（closed 对象：`requestId?/attemptId?/operationId?`），由已有 ctx 的调用方显式传入；模块级 logger 机制不变（E05） | 调用方 → db（既有方向）；无全局变量 |
| P3 | submit/grade orchestrator | commit 后单行 outcome 日志（E06）：发射点只在 `submitAndGradeAttempt.ts` 事务提交后（as-built 返回点 `:251-262`） | orchestrator 内部；无新依赖 |
| P4 | admin 路由 + orchestrator | commit 后 outcome 行；拒绝侧只记 closed category，不记被拒目标业务细节（E07） | 同上 |
| P5 | heartbeat/deadline scanner plugins | tick 完成行仅非空结果发射 + tickId（one-cycle）（E08）；E03 只加 diagnostics 投影字段 | plugin 内部 |
| P6 | auth plugin | 401 closed reason 枚举 + 洪泛预算（计数器优先，转移才发射）（E04） | plugin 内部 |
| P7 | system 路由 / contracts | E01 失败边界的技术日志（响应形状不变）；E02 语义澄清为 contracts 决策；E03 投影字段 | contracts 变更走对应 Issue |
| P8 | email 循环两宿主 | E09 默认不新增 always-on 行（复用 heartbeat 持久化活性）；转移行为 HOLD 待 #1010；E12 无新事件，测量先行（#1013） | 无 |

不变量（proposed 图仍必须满足）：领域层（`packages/domain`）与考试引擎不引入观测依赖（ADR-029 §4）；审计/回执写入路径不接受观测回调注入；readiness 判定源不变；技术日志 best-effort。

---

## 2. A2 — E01–E12 字段目录

### 2.1 字段准入规则（closed-field 规则，目录中每一行都受它约束）

1. **event 名是固定枚举**：点分小写（沿用 `operability.*` 词汇风格），一个 event 名只允许一个封闭 outcome 集合。
2. **code 只接受被审核的封闭集合**：SQLSTATE 现行封闭集合为 {40001, 40P01}（retry，`packages/db/src/types.ts:86-89`）与 #998 serializer 的 RECOGNIZED 集合（23505/40001/23503/42P01 + framework codes，`logRedaction.ts` safeCodeOf）；SMTP code 集合由 #1012 审核冻结（候选：连接类/认证类/recipient-rejected 类的受控值），形状匹配不等于值安全。
3. **原始 name/message/stack/response/SQL/binds/URL/body/答案/邮件内容一律不得直接成为技术信号**（现行先例：#998 serializer `logRedaction.ts:243-248`；email 侧缺口由 #1012 修复）。
4. **elapsed 使用单调时钟**（`performance.now()` 差值，现行先例 `packages/db/src/repository/systemStatsRepo.ts:153-159`），且只在后续获准实施处添加；与 `fastify.now()`（业务时间权威，ADR-006 考试时钟体系）严格区分，不建立第二套考试时钟，不复用业务时间戳当耗时。
5. **缺测（missing/null）、未知（unknown）、失败（failed）、0 四值必须区分**：投影字段 nullable + 显式 unknown 枚举；禁止用 0 填充未知数量（E08 核心规则）。
6. **高基数身份（attemptId/userId/orgId/operationId/requestId/workerInstanceId/tickId）只允许作为日志行内的关联字段，禁止作为 metric label 或无界 map 的 key**（现行先例：operability.* 用 `component/state` 固定字段，`operabilityMonitor.ts:285-292`）。
7. **新增行必须声明频率上界与单行大小上界**（目标值见 §5.2，均为提案目标，非实测）。

### 2.2 目录总表（12 行）

| 项 / Issue | 诊断问题 | owner（调用点） | 新事件？ | 候选固定事件名 | closed outcome | disposition |
| --- | --- | --- | --- | --- | --- | --- |
| E01 / #1002 | pingDb 失败时 health/diagnostics 为 500，与 ready 的有界探针不可对照 | `routes/system.ts:297` 及 diagnostics 内 pingDb 调用 | 是（仅失败时） | `db.probe.failed` | `failed`（+sqlstate 封闭集合） | 响应形状不变；200+degraded/nullable 不预批 |
| E02 / #1003 | oldestPendingAge 只算 due-pending 且单位为秒，含义易误读 | `routes/system.ts:126-132` + `packages/contracts/src/system.ts:111` | 否（字段语义问题） | — | — | contracts 迁移单独决策 |
| E03 / #1004 | 已有 incident 计数未进诊断投影 | `heartbeat.ts:67-68` → `system.ts` 投影 | 否（只读 projection） | — | — | 投影字段 + 进程级属性标注 |
| E04 / #1005 | pre-auth 401 无理由区分且可被洪泛 | `plugins/auth.ts:61-116`、`:123-127`、`:158-165` | 是（转移式） | `auth.denied` | reason 封闭枚举 | 计数器优先；组织字段禁止 |
| E05 / #1006 | DB retry warn 无法关联请求/业务 attempt | `packages/db/src/types.ts:217-225`、`plugins/db.ts:35` | 否（扩展现有行字段） | 沿用 `transaction retry` | retry outcome（隐含） | 显式 correlation 参数；禁止全局身份 |
| E06 / #1007 | 最终提交 outcome 无 commit 后单行 | `orchestrators/submitAndGradeAttempt.ts:251-262` | 是 | `attempt.submit.completed` | graded / pending_manual / replay_no_change / recovered | 仅 commit 后发射 |
| E07 / #1008 | admin 命令 outcome/拒绝无技术日志关联 | `routes/attempts.admin.ts:175-206,:251-309` | 是 | `admin.command.completed` / `admin.command.denied` | applied / replay_no_change；denied: forbidden / not_found / conflict | 拒绝行不带目标业务细节 |
| E08 / #1009 | scanner tick 空/行动/部分失败/throw 不可区分 | `plugins/deadlineScanner.ts:442-455`、`plugins/heartbeat.ts` tick | 是（仅非空结果） | `scanner.tick.completed` | empty / acted / partial_failure | throw 沿用现有 error 行；未知数量≠0 |
| E09 / #1010 | email 循环活性在空轮询时无 stdout 信号 | `emailOutboxLoop.ts:134-142`、`emailDeliveryWorker.ts:264-272` | HOLD | （候选 `email.worker.transition`，HOLD） | idle / active / error_enter / error_clear | 复用 heartbeat 持久化；不默认 5s 一行 |
| E10 / #1011 | reserved email audit 是否激活 | `auditPolicy.ts:755-772,:1068-1073` | 否 | — | — | 策略决策归 #1011，不是补 callback |
| E11 / #1012 | 邮件错误原始文本可达日志/DB/诊断 | `email/sanitizeError.ts:22-62`、两宿主出口、`system.ts:112` | 否（隐私策略，非新事件） | — | 封闭分类枚举（#1012 冻结） | 实施以 #1012 PR 为准（§6） |
| E12 / #1013 | worker_heartbeats 无限增长 | `workerHeartbeatRepo.ts:94-97`（无 delete） | 否 | — | — | 测量先行；retention Gate 归 #1013 |

### 2.3 逐项说明

**E01 / #1002 — pingDb 失败边界**
owner：`routes/system.ts`（health `:283-302`、diagnostics）。诊断问题：pingDb 抛错时 health/diagnostics 直接进全局 500（`errors.ts` 兜底），而 /api/ready 有 2s 预算探针（`operabilityMonitor.ts:117-153`）——三个面口径不可对照。
提案：在 owner 内加有界技术信号（失败时一行 `db.probe.failed`，字段：`probe ∈ {health, diagnostics, ready}` 封闭枚举、`sqlstate`（仅封闭集合，缺失则省略）、`elapsedMs`（单调时钟，可选））；响应形状**不变**（500 照旧）。不预先批准 200+degraded 或 nullable response（contracts 变更留给 #1002 的 Owner 决策）。
sink：Pino；频率上界：仅失败转移时发射（目标，见 §5.2）；敏感字段：无；高基数字段：无；Gate：#1002。

**E02 / #1003 — oldestPendingAge 语义**
owner：`routes/system.ts:126-132` + `packages/contracts/src/system.ts:111`。as-built：秒整数、仅 due-pending 最老行（`findDuePending`，repo 层带 organizationId 过滤）。
提案：这是对外字段语义问题，不是日志问题。建议 #1003 将其作为 contracts 兼容决策处理（候选：保留现名并文档化 due-pending+秒语义，或迁移为 `oldestDuePendingAgeSeconds`/新增全 pending 口径字段——后者是对外契约变更，需单独 Owner 批准）。本目录不预设结论。无新事件、无新日志。
Gate：#1003（contracts 决策）。

**E03 / #1004 — 已有计数只读投影**
owner：`plugins/heartbeat.ts:67-68`（`systemIncidentsCreated`/`systemIncidentConflicts`）→ `routes/system.ts` 投影 + `packages/contracts/src/system.ts` schema。
提案：只读 projection，无新事件。投影必须携带进程级属性（计数随进程重启清零，`heartbeat.ts:53-88` 注释即此语义），避免读者把进程内计数当持久事实。区分规则：计数字段为非负整数，"自进程启动以来"语义写进字段文档。
sink：diagnostics JSON 响应；频率：每请求读时计算，零新增日志；敏感/高基数：无；Gate：#1004（contracts 变更）。

**E04 / #1005 — pre-auth 401 理由**
owner：`plugins/auth.ts`（missing cookie `:68-77`、invalid JWT `:82-86`、inactive user `:112-116`、authEpoch `:123-127`、authority 401 `:158-165`——后者已带 closed reason 枚举 `AUTHORITY_401_REASONS` 与 `log.warn`）。
提案：为全部 401 出口定义封闭 reason 枚举（missing_cookie / invalid_token / epoch_mismatch / inactive_user / authority_denied），但**洪泛预算优先于逐请求日志**：进程内 per-reason 计数器（有界：枚举大小固定）+ 仅状态转移（首次出现/恢复）时发射一行 `auth.denied`。organizationId **禁止**出现在 pre-auth 401 信号中（无可信租户，§3）；不记录 IP 推断的租户。
sink：Pino；频率上界：转移式发射（目标：每 reason 每 state 一行）；敏感字段：无（不带 token/cookie 内容）；高基数：无；负例测试：注入合成 marker 确认无 org 字段、无凭据内容；Gate：#1005。

**E05 / #1006 — DB retry 关联**
owner：`packages/db`（`types.ts:106/217-225`）+ 调用方（save `attempts.candidate.ts`、submit `submitAndGradeAttempt.ts:62`）。
诊断问题：retry warn 行只有 `{attempt, sqlstate}`，进程级单 logger 无法区分并发请求；`attempt` 字段语义是 retry 序号（1..3），与业务 attemptId 无关。
提案：保留现有字段名与行（避免字段迁移），新增**可选显式参数**：`executeInTransaction(db, fn, { correlation })`，`correlation` 为封闭对象 `{ requestId?: string; attemptId?: string; operationId?: string }`，只由调用方从自己已持有的 ctx 显式传入；模块级 logger 机制不变。禁止用全局变量/模块状态保存请求身份（§0；两路线比较见 §4.4）。retryOrdinal（现有 `attempt` 字段）与业务 attemptId 的区分写进字段文档。
sink：Pino（root logger）；频率：现状不变（仅 retry 时）；敏感：无；高基数：requestId/attemptId 为行内关联字段（允许，非 metric label）；Gate：#1006。

**E06 / #1007 — 提交后 outcome（commit-authoritative）**
owner：`orchestrators/submitAndGradeAttempt.ts`。关键结构事实：整个 body 在 executeInTransaction 内（可重试、可回滚），**事务内发射的日志会在 40001 重试/回滚时重复或虚报**；唯一安全发射位置是事务提交后——as-built 返回点 `:251-262`。
提案：在返回点发射单行 `attempt.submit.completed`，outcome ∈ {`graded`, `pending_manual`, `replay_no_change`（对应 alreadyGraded 幂等重放）, `recovered`（crash-recovery 分支）}；字段：`attemptId`、`requestId`（有 HTTP 请求时）、outcome。rollback/retry 的中间结果不得作为已提交事实发射。
sink：Pino；频率：每次 submit 一行（业务动作频率，非 always-on）；大小：≤ 256B（目标）；敏感：无答案/分数内容（分数属业务事实，见 receipt）；高基数：attemptId/requestId 行内关联；Gate：#1007。

**E07 / #1008 — admin 命令 outcome 与拒绝关联**
owner：`routes/attempts.admin.ts` + orchestrator（receipt/outcome 权威在 orchestrator，事务内审计）。as-built：handler 不记 outcome 日志；403/404 早退（`scopedCapability.ts:344-350` anti-enumeration 404）无专用日志；409 经 `errors.ts:118-122` 亦无分类日志。
提案：与 E06 同构——commit 后单行 `admin.command.completed`（outcome ∈ {`applied`, `replay_no_change`}，字段：command ∈ {force_submit, time_grant}、operationId、attemptId、requestId）。拒绝侧**至多**一行 `admin.command.denied`（outcome ∈ {`forbidden`, `not_found`, `conflict`}，字段：command、requestId；**不带被拒目标的 attemptId/业务细节**——Admin 身份不授予记录越权目标细节的许可，§3）。技术行 best-effort，receipt/审计仍是业务权威，禁止从技术日志反构业务事实。
sink：Pino；频率：每命令 ≤1 行；Gate：#1008。

**E08 / #1009 — scanner tick 因果与四态**
owner：`plugins/deadlineScanner.ts` / `plugins/heartbeat.ts`。as-built：汇总行仅 `submitted>0‖failed>0`（`deadlineScanner.ts:442-450`）；tick throw 有 error 行（`:451-454`）+ `consecutiveThrowTicks` 计数；空 discovery 与全 no-op 在 stdout 不可区分。
提案：tick 完成行 `scanner.tick.completed` 仅在**非空结果**（有候选发现、有动作、或部分失败）时发射；outcome ∈ {`acted`, `partial_failure`}；字段：`scanner ∈ {heartbeat, deadline}`、`tickId`（per-tick UUID，one-cycle，不持久化、不跨 tick 复用）、计数（非负整数）。四态映射：空成功=不发射（diagnostics 计数已表达）；acted=发射；partial_failure=发射且**未知数量必须显式 unknown**（某组织腿失败时其余组织的聚合数不再可信，禁止用部分和冒充总数，禁止用 0 填充）；throw=沿用现有 error 行 + `consecutiveThrowTicks`。tickId 与 operationId、workerInstanceId 不互相冒充（tickId 只标识一个扫描周期）。
sink：Pino；频率：tick 间隔由 runtime config 决定（默认 30000ms，`config/settings.ts:702`；deadline 默认继承 heartbeat，`:704-705`），仅非空结果发射（目标：远低于每 tick 一行）；大小：≤ 512B；Gate：#1009。

**E09 / #1010 — email 循环活性**
owner：两宿主循环。as-built：空轮询无 stdout 行，但 **heartbeat 每 poll 均写**（`emailDeliveryWorker.ts:276-283`；in-process 同构）——`lastSuccessAt`/`lastPollAt` 已是持久化活性信号，诊断投影（S16）已消费。
提案：**HOLD，不新增 always-on 行**。默认答案是复用 heartbeat 持久化 + diagnostics 投影；poll 默认 5000ms（`config/settings.ts:783`）下无条件每轮一行 ≈ 17,280 行/天/实例，不默认启用（#1010 已明确）。候选（HOLD 待 #1010 决策）：进程内状态转移行 `email.worker.transition`（idle↔active、error 进入/清除，有界去重状态，重启重置——与 `operabilityMonitor.ts:234-252` 的转移去重同型）。
Gate：#1010。

**E10 / #1011 — reserved email audit**
owner：`audit/auditPolicy.ts:755-772`（EmailOutboxCreated/EmailSendFailed/EmailSendRetried 均 reserved）+ `:1068-1073`（`assertActiveAuditAction` 对非 active 抛错——as-built 已验证：任何接线尝试都会在生命周期断言处失败）。
提案：本目录只记录事实与边界：激活是**策略决策**（reserved→active 的 durability/lifecycle 变更），不是"补一个 callback"；若 #1011 决定激活，审计行是业务事实权威，技术日志不得复制其内容；#1012 的修复不得顺手接线（auditEmitter 在两宿主装配处均未传入，as-built 无生产接线）。本提案不预设决策。
Gate：#1011（Owner 策略决策）。

**E11 / #1012 — 邮件错误隐私（与 Job B 并行，实施以 #1012 PR 为准）**
owner（方向已获 #1012 授权）：邮件模块内**单一隐私策略 owner**（扩展/替换 `email/sanitizeError.ts` 的纯策略边界），两个宿主保留各自 transport（Pino / stdout JSON），读侧历史投影在 `routes/system.ts`（null 保持 null；固定状态可精确识别；历史自由文本映射到固定安全分类）。
本目录约束（与 #1012 PR 的合同一致性，实施细节以其为准）：
- 封闭分类枚举 + 经审核的有限 SMTP/DB code 集合；原始 name/message/stack/response 不再成为技术信号（现行缺口证据：S12/S13/S14）；
- `email_outbox.lastError`、`worker_heartbeats.lastError` 新写入只来自安全表示，保持 `string | null` 形状（无 migration）；
- `bootstrap_pending` 保持可识别固定状态（`emailDeliveryWorker.ts:34-35`）；
- 诊断投影 workerStatus 判定不得因隐私投影变健康（`system.ts:113-121` 语义保持）；
- standalone worker 的 `databaseUrl` 日志（`:170-172`）按 #1012 处理（本提案不新增 URL 脱敏框架）。
无新事件；sink：既有两 transport + 两持久化 + 诊断投影；Gate：#1012（实施中）。

**E12 / #1013 — heartbeat 增长**
owner：`workerHeartbeatRepo.ts:94-97`（仅 upsert/findLatestByName，无 delete）。as-built：workerInstanceId 每进程启动随机（`emailOutboxLoop.ts:43`、`emailDeliveryWorker.ts:153`），每次重启留一行永久行；#800 现状 CONFIRMED_LOW_MEASURE_FIRST 未变。
提案：**无新事件、无清理循环**。#1013 的顺序是测量（部署级增长率）→ retention 政策决策（Owner Gate）→ 才谈实施。诊断投影可加一个有界测量字段（行计数，读时计算），属 contracts 小变更，由 #1013 决策。
Gate：#1013。

---

## 3. A3 — 组织上下文来源与威胁矩阵

身份权威与 organizationId 允许性逐场景判定。总规则：**organizationId 只来自服务端已授权 request context（JWT→assignment authority 解析）或明确的 DB/worker scope（orgScope/system ctx）；绝不来自 query/header、错误对象、correlation ID 推断或 IP。**

| 场景 | 身份权威 | 允许 organizationId？ | 允许字段 | 读取者 | 省略时机 | 负例测试 | 不可推导结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 已认证 HTTP | JWT→user→assignment authority（`plugins/auth.ts:79-153`）；ctx 由 authenticate 填充 | **是**——仅 `request.ctx.organizationId` | actorId/actorRole + 业务关联字段（先例 S17 字段集） | Host 日志；诊断面 Admin/Maintainer | pre-auth、序列化失败路径 | 合成 marker 注入答案/凭据字段，断言不出现在日志 | requestId≠授权证明（ADR-025） |
| 未认证 HTTP（pre-auth 401） | 无（无 cookie/JWT） | **否**——无可信租户 | request.id + route 模板 + closed reason（E04） | Host 日志 | 401 早退时 ctx 未建 | 断言 401 信号无 org 字段、无 IP 推断租户 | 不能从 IP/UA/路径推断 org |
| Admin 跨组织访问/拒绝 | scoped capability resolver（`authz/scopedCapability.ts`）服务端解析目标 org | 是（resolver 结果），但**拒绝路径不得记录被拒目标的业务细节** | 拒绝信号只带 closed category + command + requestId（E07） | Host 日志 | 403/404/409 拒绝 | 越权请求注入 marker，断言目标 attemptId/org 不出现 | Admin 身份不授予记录他 org 细节的许可（ADR-018 D4 延续） |
| scanner 逐组织循环 | `createSystemRequestContext(organizationId, SYSTEM_ACTOR_ID)`（`heartbeat.ts:144-146`；deadlineScanner 同构） | 是——每 org 一个显式 ctx | org + attemptId（per-candidate error 行） | Host 日志 | — | 双 org fixture 交错扫描，断言行不串 org | 进程级计数不可拆为某 org 独立运行状态 |
| email in-process 宿主 | `waitForSingleOrganization` → orgScope `{organizationId}`（`emailOutboxLoop.ts:80-91`） | 是（单 org scope；repo 层 resolveOrgId 强制） | outboxId/attemptCount 等非 PII 字段 | Host 日志 | — | 双 org fixture 交错投递，断言 outbox 数据不串 org | email_outbox 是 org-scoped；heartbeat 不是（S15） |
| email standalone 宿主 | 同上（`emailDeliveryWorker.ts` bootstrap 解析） | 是（同 orgScope） | 同上 | Host 面（stdout 不经 Exam RBAC） | — | 同上 + 真实 stdout 字节检查 | 同上 |
| bootstrap 未完成 | `resolveOptionalBrandingTenant` 无 org | **否** | 固定串 `bootstrap_pending`（`emailDeliveryWorker.ts:34-35`） | 诊断面 worker.lastError | — | 历史脏值投影测试（#1012 B3） | bootstrap_pending 是可识别固定状态，不是租户状态 |
| 多组织误配置 | `waitForSingleOrganization` 契约：>1 org 抛 fatal | — | fatal 行 | Host | — | 维持既有失败行为，不为测试解除 | 不因测试便利改契约 |
| 进程重启 | — | 部署级信号（heartbeat 新行、计数清零） | workerInstanceId（每次新随机） | 诊断面/Host | — | 滚动升级新旧写者混存场景（findLatestByName 取 lastPollAt 最新，S15） | 新旧行并存不构成多租户状态 |
| 交错并发 | requestId 每请求唯一（`server.ts:117`）；DB retry logger 无请求身份（S4） | retry 行当前无法携带身份（E05 缺口） | 仅 attempt/retry 序号/sqlstate | Host | — | 并发请求 + 注入 retry，断言现有行不串身份 | 不能从 retry warn 反推请求/org（E05 修复前的诚实边界） |
| 异常包装 | Drizzle 包装 → #998 serializer 白名单化 Pino err 通道（`logRedaction.ts:232-257`） | — | — | — | — | 非 Error rejection、循环 cause、toString/toJSON 边界用例（#1012 B1） | "经 Pino 即安全"仅对 err 通道成立；自定义 `error:` 字符串字段是独立出口（S11/S12） |

**特别声明**（#1001 要求的显式结论）：

1. **host-level heartbeat/counter 可以作为授权运维投影，但不得包装为某租户独立运行状态**：`worker_heartbeats` 是部署级记录（S15 证据），诊断投影中的 worker 状态是 host 信号；当前产品单租户（一部署一机构），不存在"某组织的 email worker 状态"这一事实，也不得创造字段暗示它。
2. **不新增 tenant-facing log query API**：日志读取保持 Host 运维面（ADR-018 D6）。未来若需要 tenant-facing 查询能力，是独立的 RBAC/capability 架构决策，不在本提案范围。
3. **不因 Admin 身份记录拒绝访问目标的业务细节**（矩阵第 3 行）：拒绝信号只有 closed category，anti-enumeration 语义（404 无日志现状）不被诊断需求推翻。
4. 多组织 fixture（A/B org）只用于验证数据边界的负例测试，不代表新增多租户运行模式。

---

## 4. A4 — 模块方案 A/B/C 与 EXTRACT/NO_EXTRACT 证据

### 4.1 真实共享规则（as-built 证据）

**真的被多方共享的代码**只有三类：

| 共享物 | 消费者 | 证据 |
| --- | --- | --- |
| 邮件隐私纯策略（`sanitizeEmailError`） | 3 方：outbox 持久化（`outboxService.ts:124`）、sender 包装（`senders.ts:176`）、/email/test 响应（`email.ts:81`） | S13 |
| EmailOutboxService 业务循环（claim/retry/dead/fence） | 两宿主逐字复用 | `emailOutboxLoop.ts` 装配处注释明言 "reusing the same semantics verbatim" |
| workerHeartbeatRepo | 两宿主写、API 读 | S15 |

**不被共享的**（且不应强行统一）：transport（Pino vs stdout JSON，S11/S12）、时钟（`fastify.now()` vs `new Date()`）、生命周期（Fastify onClose + supervisor vs signal handler + exit(1)）、DB 连接（app pool vs 自建）。

**未来可能需要共享的**只是**词汇与规则**（closed-field 枚举、dedupe 模式、预算形态），不是**行为实现**。

### 4.2 三方案对比

| 维度 | A：owner 内 typed local adapter | B：`apps/api/src/observability/*` 最小内部边界 | C：`@exam/observability` workspace 包 |
| --- | --- | --- | --- |
| 真实共享规则匹配 | 匹配 as-built：要共享的只有 email 纯策略（已在 email 模块单实现权威下）与词汇一致性 | 把"词汇一致"升级为"中心模块"，超出当前共享事实 | 假设有两个独立消费者需要同一稳定接口——as-built 不成立 |
| 调用者 | 各 owner 自己（零新调用图） | 所有发射 owner → 新内部模块 | 全 workspace 可见 |
| 独立演进 | owner 各自演进，目录（§2）+ 评审纪律维持词汇一致 | 演进要过中心模块，易形成瓶颈/框架化 | 包级 API 冻结成本，需要版本纪律 |
| 依赖方向 | 无新方向（packages/domain 不受影响自动满足） | 新增 owner→observability 内部依赖；`packages/db` 若用它则引入对 apps 侧词汇的倒挂风险（E05 场景 db 是被调用方） | workspace 级新节点；`packages/db` → `@exam/observability` 需要新边界裁决 |
| 迁移面积 | 最小：每个 Issue 在自己 owner 内加发射点 | 中：先建目录再迁移现有发射点（无迁移必要性证据） | 大：包脚手架 + 边界检查 + 模块解析接入（ADR-029 §3 明言 Stage D 前不建） |
| 测试可行性 | 就近测试 + 传输层字节级采集（§5.3） | 集中可测，但测的是新框架而非业务信号 | 同 B，外加包级集成测试负担 |
| 成本 | 低（无运行时新面） | 中（维护一个目前只有词汇的模块） | 高（包治理成本前置） |
| 与冻结边界关系 | 合规（不建包/目录/空壳） | 合规但与"默认 NO_EXTRACT"张力 | 需显式 Owner/ADR 决策，当前无证据支持 |

### 4.3 推荐与 EXTRACT/NO_EXTRACT 结论

**推荐：方案 A 为主，附一个具体化子项**——email 模块内单一隐私策略 owner + 两宿主 transport adapter（即 #1012 已授权方向，它本身就是 A 的实例：策略在 owner 模块内，不外提）。

**NO_EXTRACT 结论（对 C）**，证据：

1. #999 研究结论 EXTRACT=0（#1001 正文引用）；
2. as-built 唯一真实的跨宿主共享（email 纯策略 + 业务循环）已经在 `apps/api/src/email/*` 单一实现权威下解决，两宿主共享**模块**不构成共享**传输/包接口**的需求（§4.1）；
3. 两个 entrypoint 使用同一邮件模块不是抽包的充分理由（brief §一.4；两 transport 序列化路径不等价，§1.1 结论 5）；
4. ADR-029 §3 已冻结"Stage D 架构评审给出结论并获 Owner GO 前不创建该包"。

**B 判 HOLD**（不否决、不现在建）：触发条件写死——当 ≥2 个 owner 需要相同的**行为**（不只是命名），例如 closed-field 校验/转移去重/预算控制在 ≥3 处出现重复实现且有测试缺口时，重新评估最小内部边界。在此之前建目录属于"用结构证明设计"，本提案不做。

本提案自身不创建任何目录、types、runtime adapter 或包（DESIGN_ONLY）。

### 4.4 explicit propagation vs AsyncLocalStorage（E05 的两条路线）

| 维度 | explicit（推荐） | AsyncLocalStorage |
| --- | --- | --- |
| 正确性 | 数据流显式可见；并发语义不依赖隐式上下文 | 跨 await 传播依赖框架语义全覆盖；漏包一处即静默丢身份 |
| 签名扩散 | 有成本：调用方逐层传 correlation（E05 只需在 executeInTransaction opts 一层，扩散面小且可测） | 零签名扩散，但把身份放进进程级隐式状态，与"禁止共享可变身份"（#1001 决策 3）存在张力 |
| 测量需求 | 无新测量 | ALS 上下文进出成本未冻结；ADR-029 §8 的预算门槛要求先测后用 |
| standalone worker 适配 | 同一参数直接可用 | 需要为无 Fastify 生命周期的进程建第二套 ALS 根，路径分叉 |

**结论：默认 explicit，不引入 ALS。** ALS 仅当签名扩散被实测证明不可接受且 Owner 单独批准时重议（Owner 决定清单 §7.6）。

### 4.5 失败隔离

1. 观察路径 fail-open（ADR-029 §6.3 方向）：发射失败时丢弃信号并递增**有界丢弃计数器**（进程内、枚举大小、重启重置），不阻塞、不向业务路径抛出。
2. **禁止递归记录 logger 失败**：logger/序列化失败的再日志化是无限递归入口；唯一允许的自报告是最小路径一次性固定串（如 stderr 单行）+ 计数器，且不重试。
3. **不承诺同步 try/catch 已解决异步 stream 故障**：stdout/stderr 异步写故障（EPIPE/背压）只通过 stream error 监听 + 计数覆盖已验证范围，不做宽泛 catch 掩盖；同步发射边界内的故障注入测试是 #1012 B4 的要求，本提案将其列为未来实施的通用验收项（§5.2）。
4. 真实 DB/SMTP/配置错误的传播语义不变：失败隔离只包住观察行为本身。

---

## 5. A5 — closed-field 示例、失败/容量/测试策略

### 5.1 closed-field 示例（全部合成数据；非真实输出）

API 进程 Pino（E06 提交后单行）：

```json
{"level":"info","time":1730000000000,"reqId":"synthetic-req","event":"attempt.submit.completed","outcome":"pending_manual","attemptId":"synthetic-attempt"}
```

DB retry（E05，correlation 由调用方显式传入）：

```json
{"level":"warn","time":1730000000000,"attempt":2,"sqlstate":"40001","correlation":{"requestId":"synthetic-req","attemptId":"synthetic-attempt"},"msg":"transaction retry"}
```

Standalone worker stdout（E11 方向：封闭分类，无原始 message；实施以 #1012 为准）：

```json
{"ts":"2026-11-17T00:00:00.000Z","level":"error","worker":"email-delivery","event":"email.poll.failed","category":"smtp_permanent","code":"recipient_rejected","workerInstanceId":"synthetic-host-1-1-synthetic-uuid"}
```

Scanner tick（E08，部分失败时未知数量显式 unknown）：

```json
{"level":"warn","time":1730000000000,"event":"scanner.tick.completed","scanner":"deadline","tickId":"synthetic-tick-uuid","outcome":"partial_failure","submittedCount":2,"failedCount":1,"discoveredCount":"unknown"}
```

反例（禁止形态）：`"error":"network down"`、`"error":"Recipient a***@example.com was rejected"`、`"stack":"..."`、`"response":"535 5.7.8 Error: authentication failed"`、`"sql":"SELECT ... WHERE id = $1"`、`"binds":[...]`、`"url":"/api/attempts/synthetic/answers?token=..."`。其中前六类在 as-built 邮件路径可达（S12/S13/S14 证据），修复属 #1012。

### 5.2 失败与容量策略（全部为提案/目标，**无任何一项已测**）

| 项 | 提案目标 | 说明 |
| --- | --- | --- |
| 单行大小 | ≤ 1 KiB（E06/E07 行 ≤ 256B，E08 ≤ 512B） | 与 audit truncate 常规同量级；实现时以截断+固定 marker 兜底 |
| 新增 always-on 日志行 | 0（E09 HOLD；E08 仅非空；E04 转移式） | 无条件 per-tick/per-poll 行不启用 |
| 每事件频率上界 | 转移式或失败式发射，每源每状态 ≤1 行/转移 | E04/E09 候选共用此形态 |
| 丢弃计数器 | 每发射点 1 个整数，无队列无缓冲 | §4.5 |
| 进程内存 | 不新增无界 map/queue/buffer；去重状态 = 固定枚举 × 状态 | operability 同型先例 `operabilityMonitor.ts:234-252` |
| 性能预算 | 若未来任一实施引入常驻观测成本，先冻结测量方案再实施（ADR-029 §8：CPU ≤5%、p99 ≤5% 为目标门槛） | 本提案不声称任何成本数字 |

### 5.3 测试策略（未来获准实施时的验收要求，非本次执行）

1. **API 宿主**：用真实 Fastify/Pino 序列化路径在真实错误调用点采集日志字节断言 closed-field（`logger:false` 测试只能证明业务行为，不能证明日志隐私——`emailOutboxLoop.test.ts` 现状即此局限）。
2. **Standalone 宿主**：覆盖真实 stdout/stderr JSON writer（含 fatal 入口与 sender close）；不得用 Pino 测试代替。
3. **DB 语义**：真实 PostgreSQL 读取实际写入的 heartbeat / outbox 行；历史脏值 fixture 不经新安全 writer 预处理。
4. **负例测试**（每行信号至少一条）：注入合成 marker（SQL、binds、SMTP response、recipient、答案内容、URL）断言不出现；401 信号无 org 字段；拒绝信号无目标细节；双 org fixture 不串 org。
5. **四值区分**：E08 未知数量、E02/E03 nullable 语义的显式断言（unknown ≠ 0 ≠ null ≠ failed）。
6. **单调时钟**：elapsed 字段的测试用可控时钟注入，禁止 sleep。
7. **TDD**：行为已知的实施先建失败测试再实现（repo §7）；本提案本身无测试（DESIGN_ONLY，未运行任何仓库门禁）。

---

## 6. 与 #1012（Job B）的并行边界

#1012 是已授权的安全修复（GO_SECURITY），与本提案并行、不互相依赖：

- **#1012 不等待本提案的模块选择**：其隐私策略 owner 在 email 模块内部落地，本就兼容方案 A（§4.3）；若未来 Owner 改选 B/C，迁移是词汇搬迁，不是语义重做。
- **本提案不复制 #1012 的实施细节**：E11 行只锁定契约方向（单一隐私策略 owner、两 transport adapter、读侧历史投影、封闭分类），实施细节以 #1012 PR 为准；两份 PR 合并后以 #1012 的 as-built 修订 `docs/contracts/observability.md`（该文件不在本 PR 修改，写者归属由协调者指定）。
- **共享不变量**（两 Job 共同遵守）：bootstrap_pending 可识别、lastError `string|null` 形状不变、无 migration、不接线 auditEmitter、不激活 reserved actions、诊断 workerStatus 判定不变健康。

## 7. 留给 Owner 的决定清单

| # | 决定项 | 本提案立场（供裁决，非决定） |
| --- | --- | --- |
| 1 | 模块方案采纳：A（推荐）/ A+组合 / B（HOLD+触发条件）/ C（当前 NO_EXTRACT） | 推荐A；B 触发条件见 §4.3；C 需新证据 |
| 2 | E01 是否允许 200+degraded / nullable response（contracts 变更） | 不预设；本提案只提日志信号 |
| 3 | E02 oldestPendingAge 字段迁移方向（保留语义 vs 拆分新字段） | 不预设 |
| 4 | E04 洪泛预算具体形态（纯计数器 vs 计数器+转移行） | 倾向计数器+转移行，值待定 |
| 5 | E05 correlation 字段词汇与传入边界（requestId/attemptId/operationId 三选几） | 倾向全可选、调用方显式传 |
| 6 | E05 若签名扩散不可接受，是否重议 ALS | 默认否（§4.4） |
| 7 | E06/E07/E08 outcome 枚举词汇冻结 | 候选值见 §2.3，待冻结 |
| 8 | E09 转移行是否启用（当前 HOLD） | 默认不启用，复用 heartbeat |
| 9 | E10 reserved email audit 激活策略 | 归 #1011，本提案无立场 |
| 10 | E11 实施确认：隐私策略 owner + 读侧投影（与 #1012 PR 对齐） | 方向已授权，细节以 #1012 为准 |
| 11 | E12 retention 政策与测量字段 | 归 #1013（测量先行） |
| 12 | §5.2 预算目标值的冻结与未来测量方案（ADR-029 §8 引用） | 值为提案目标，待冻结后才有验收力 |
| 13 | 未来 tenant-facing log query API 是否立项 | 不在本提案范围；需独立 RBAC/capability 决策 |
