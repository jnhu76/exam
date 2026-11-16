# ADR-029 — Exam Native Observability: Incremental Enhancement of Existing Facilities

## Status

- Status: **PROPOSED**（2026-11-16 起草，提交 Owner 评审；**未接受前不构成施工授权，也不改变任何现行契约**。本文档只确定研究方向与硬约束边界。）
- Date: 2026-11-16（proposed）
- 基线：v0.0.15 产品基线（`cb1e614fe087e7ac158deef4a4de7f29268de292`）+ ADR-028 REJECTED（2026-11-16）
- Decision owners: project Owner（方向接受与任何后续实施授权分别裁决）
- Supersedes: none
- Related: ADR-018（operational observability window，ACCEPTED，继续完全有效）、ADR-023（ACCEPTED）、ADR-025（requestId 权威，ACCEPTED）、ADR-026（client-event 时间边界，ACCEPTED）、ADR-027（ACCEPTED）、ADR-028（OpenTelemetry 技术遥测，REJECTED 2026-11-16；其研究产出是本文 §7 的输入）、`docs/contracts/observability.md`（现行观测契约）、#964（umbrella，方向已改为 Native Observability Audit & Simplification）、#800/#961（各自独立职责，不在本文范围）

---

## 1. Motivation

ADR-028（REJECTED）证明了在当前证据与成本形态下引入完整 OpenTelemetry 平台不满足生产启用 Gate：同 SHA 配对实测 CPU 增量在 On/无导出态已达 +3.91%（CI 上界超 5% 预算）、On/全 OTLP 态 +10.14%，且带来整组 experimental 依赖与 opt-in 观测容器栈的部署复杂度。

同时，技术诊断的真实需求仍然存在，且现有设施已覆盖大部分场景：

- 请求级问题可以由 requestId 贯穿（error envelope、`x-request-id`、Pino、audit metadata）定位；
- 业务状态迁移有 audit_logs append-only 权威；
- 后台循环有 scannerMetrics / `/system/diagnostics` / `operability.*` stdout 告警契约；
- DB 事务重试有 `transactionRetryLogger`。

尚未被现有设施结构化覆盖的缺口集中在**因果与归因**层：跨层耗时归因（一个慢请求的时间花在哪个边界）、事务/语句因果关系（一次 `sql.begin` 内每条语句的时长与失败归属）、后台执行因果关系（一次 scanner tick 触发的每个下游动作）与有界的指标聚合。这些缺口正是 ADR-028 战役试图用 OTel 解决、但其平台成本不可接受的部分。

本 ADR 提出的方向：**不引入新平台**，基于 Exam 原有设施做最小增量设计，先审计、先研究、后裁决、最后才实施。

## 2. Existing Facilities（复用面，全部保持权威）

| 设施 | 权威 | 本方向的角色 |
| --- | --- | --- |
| Pino → stdout JSON 日志（REDACT_CONFIG 脱敏） | `docs/contracts/observability.md` | 唯一服务端技术日志出口；任何增量必须经同一出口与脱敏边界 |
| requestId / `x-request-id`（server UUIDv4） | ADR-025 | 唯一请求身份权威；任何未来关联信号只能作为其**伴随字段**，不取得身份权威 |
| `audit_logs` / Receipt / attempt version | observability 契约、EXSEM | 业务事实权威，不可被观测信号替代或修改语义 |
| `/system/health`、`/system/diagnostics`、`operability.*` | ADR-018/024、active-alerting 契约 | readiness 与运维告警权威；观测增量不得改变其判定源 |
| `transactionRetryLogger`（40001/40P01 重试日志） | `packages/db` `executeInTransaction` | DB 重试诊断的现行出口；增量目标是**补充因果上下文**，不改变重试语义 |
| Heartbeat / Deadline Scanner 诊断（scannerMetrics、consecutiveFailedTicks） | #886/#862 契约 | 后台循环诊断权威；后台因果增量必须挂接在既有 tick 生命周期上 |
| `CAPACITY_RESEARCH` 研究性 wrapper（默认 Off） | `apps/api/src/lib/capacityResearch.ts` | 语句到达计数的既有研究缝；若需要语句级观测，优先评估扩展此缝而非新建平行缝 |

## 3. Decision Direction

研究方向（每项单独评审、单独授权，本文不预设任何一项必做）：

1. **Cross-layer latency attribution**：在现有 Pino 请求日志上，以**有界的、进程内的**阶段计时（如 handler/repo/DB/事务边界）补充结构化耗时字段，使一个 requestId 内的耗时分布可读。候选载体是既有日志行（新增字段）而非新信号平台。
2. **Transaction / statement causality**：扩展 `executeInTransaction` / `transactionRetryLogger` 与（若评估通过）`CAPACITY_RESEARCH` 缝，使事务内语句时长、SQLSTATE 分类与重试事件可携带同一个请求或后台工作标识。约束：单一边界计量，不改变 Query 惰性、重试、隔离或锁序语义。
3. **Background execution causality**：为后台循环 tick 内触发的下游动作补充 tick 级因果标识（workerInstanceId/operationId 既有词汇的延伸），禁止伪造 HTTP requestId（observability 契约既有规则）。
4. **Bounded metrics aggregation**：研究进程内、固定槽位、有上界的聚合计数器（如 route × outcome × SQLSTATE），经由 `/system/diagnostics` 或结构化 stdout 周期性暴露。默认替代方案是"不加"——只有当 grep stdout 被证明不可维护时才引入。

未来若多个增量共享稳定的观测接口，可将其抽象为独立 workspace 包（**拟名** `@exam/observability`）。该名称与任何具体接口**均未获得最终裁决**；在 Stage D 架构评审（#964）给出结论并获 Owner GO 之前，不创建该包。

## 4. Ownership Boundaries

- 现行权威（§2 表格所列）各自保留；观测增量是**伴随信号**，不得在任何边界上替代业务事实、身份、时间或 readiness 权威。
- 领域层（`packages/domain`）与考试引擎不引入观测依赖；观测缝只存在于 API 装配层、DB 客户端缝与插件生命周期，遵守既有 workspace 依赖边界（`docs/standards/code-quality.md` §6）。
- Audit / Receipt 写入路径不接受观测回调注入；观测代码不得进入业务事务关键路径的语义。
- 部署边界：技术观测基础设施归 Host 运维（ADR-018 D6 延续），不经 Exam RBAC/管理 API 暴露。

## 5. Non-goals（本 ADR 不授权）

- 新日志平台 / 远程日志摄入（stdout 契约不变）。
- 新业务数据库表、新 Collector、新 Docker 服务、新默认容器（默认新增容器 = 0）。
- 新 OTLP / OpenTelemetry 依赖、外部遥测网络（默认远程观测网络 = 0）。
- C++ Addon / Sidecar 等原生运行时组件。
- 大规模代码迁移或对现有日志/审计代码的重写。
- 任何生产环境的遥测启用（无生产 OTel）。
- 修改 ADR-018/023/025/026/027 的既有权威。

## 6. Risks

1. **侵入性蔓延**：阶段计时与因果标识的穿线可能扩散到大量函数签名。缓解：优先选择进程内 context 载体与既有缝扩展；每个增量单独评审其接触面。
2. **开销重蹈覆辙**：即使不引入 OTel，无界缓冲/同步序列化同样可能造成可观开销。缓解：§7 硬约束中的预算与上界在实现前即为验收条件。
3. **观测故障影响业务**：缓冲满、序列化异常、sink 阻塞都可能反压业务。缓解：观测路径必须 fail-open（观测失败丢弃信号并计数，不阻塞、不抛出到业务路径）。
4. **隐私回退**：新字段可能把参数值、原始 URL 或业务 payload 带入日志。缓解：一律经既有 REDACT_CONFIG/白名单序列化边界，新增字段逐项过隐私评审。ADR-028 战役发现的 **D1 缺陷（500 路径 err.message 携带全列 SQL + 绑定参数值）是现有日志通道的未决隐私缺陷，须独立修复**，不因本 ADR 而延迟。
5. **重复真相源**：同一耗时/计数若同时出现在日志字段、diagnostics 与未来包中，可能漂移。缓解：单一权威写入口，派生视图由权威源投影。

## 7. Research Questions（Stage B 研究输入；结论不改现状）

来自 ADR-028 战役的可复用问题（证据归档：tag `archive/pr996-otel-research`，PR #996，closed NOT_MERGED）：

1. 跨层耗时归因的最小充分粒度是什么？（战役覆盖矩阵显示 W01/W03/W07/W09 等 4 条高频链路 FULL 可验证，可作为归因设计的锚点工作负载。）
2. 事务/语句因果是否可以完全在既有 `executeInTransaction` + capacityResearch 缝上表达，还是需要驱动层缝？（战役的 `@exam/otel-drizzle-postgresjs` 实现保留了可审查的缝设计，但其成本数据（CPU +3.9%–10.1%，WSL2 探索级）表明任何缝扩展必须重新计价。）
3. 有界指标聚合的最小槽位词汇是什么？（战役冻结的背景/业务/DB 指标词汇可作为候选起点，但需按本方向重新收敛。）
4. D1 日志隐私缺陷的修复契约归属与最小修复形态。
5. 进程内缓冲的内存上界取值与淘汰策略（何种上界在 LAN 单实例部署下可证明无风险）。

## 8. Acceptance Gates（未来验收目标，非已取得结论）

任一后续实施项获 Owner GO 后，其验收至少包括（预算值为**目标**，不是已取得的实验结论）：

| Gate | 要求 |
| --- | --- |
| 部署形态 | 默认部署新增容器 = 0；默认远程观测网络 = 0 |
| 业务语义 | 不改变考试业务语义；Audit / Receipt 权威不变；readiness/告警判定源不变 |
| 性能预算 | 稳态 CPU 额外开销 ≤5% 且 p99 额外开销 ≤5%（vs Off 基线，同 SHA 配对测量） |
| 资源上界 | 缓冲与内存开销有明确、可验证的上界；超界行为为丢弃 + 计数，不阻塞 |
| 故障隔离 | 观测故障不得阻塞业务请求、事务、重试、readiness 或关机语义（关机预算 30s 契约不变） |
| 隐私 | 新增日志字段全部经既有脱敏边界；无 raw SQL、绑定参数值、原始 URL、凭据、答案内容 |
| 依赖 | 不引入 §5 排除项；workspace 依赖边界检查通过 |

测量方法学与样本量要求在具体实施授权时另行冻结（参照 #964 战役的预注册协议经验：先冻结判定规则，再执行测量）。
