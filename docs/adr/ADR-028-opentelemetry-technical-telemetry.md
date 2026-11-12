# ADR-028 — 采用 OpenTelemetry 作为 V1 技术遥测标准（默认 Off、有界启用）

## Status

- Status: **PROPOSED**（按 #964 W0.3 起草，提交 Owner 评审；**未接受前不构成施工授权，也不改变任何现行契约**。#964 范围内的探针与实现工作按 #964/#800 已有授权进行，本 ADR 接受与否不追认已施工内容。）
- Date: 2026-11-13（proposed）
- 基线：`2d38f69881d622661e0bbfbaab7874aacda8b01b`（origin/master，W0.1 冻结值，见 `out/otel-w0/w0.1/baseline.md`）
- Decision owners: project Owner（接受、生产启用分别裁决）
- Supersedes: none（本 ADR 不整体取代任何 ADR）
- 对既有权威的**限缩（prospective，仅在本 ADR 被 ACCEPTED 时生效）**：
  - **ADR-018** 的 Explicit anti-goals 段（"OpenTelemetry collectors, log shipping … Each would require its own ADR"）：本 ADR 即该段要求的"own ADR"。被限缩的部分仅为「当时里程碑与产品调查窗口内不引入 Collector / log shipping」这一时间范围性反目标；ADR-018 的 D2（六不变量）、D3（语义分类）、D4（关联方向与业务细节边界）、D6（基础设施执行在窗口外、归 Host 运维）、D7（逐数据源 ADR）继续完全有效，且是本 ADR 的约束来源。本 ADR 不触碰 ADR-018 已被 ADR-023 supersede 的 backup/restore-readiness/ops-policy 部分。
  - **#921**（CLOSED，2026-11-12 scope 注记，历史裁决 NO_GO_NOW）：限缩为「#964 授权范围内的应用侧 OTel 插桩、可选 OTLP 导出、独立 Drizzle/Postgres.js 插桩包」不再受 NO_GO 约束；原历史决策文本与裁决记录留档不删改。#921 其余范围（外网 SaaS 遥测、产品内日志库等）维持 NO_GO。
- Related: ADR-018（窗口契约，D2–D4/D6–D7 继续约束本决策）、ADR-025（server-owned UUIDv4 requestId 权威）、ADR-026（client-event 时间证据边界）、ADR-006/#961（时间权威）、#964（范围授权）、#921（历史 NO_GO 裁决）、#312（OTLP 外部日志导出，superseded by plan 并入 #964 W1/W6/W7）

---

## 1. Context（现有观察，全部来自 W0.1 实测）

以下为 as-built 事实（证据：`out/otel-w0/w0.1/baseline.md`、`out/otel-w0/w0.1/telemetry-inventory.md`，均含仓库路径与行号）：

1. **当前无任何 OTel 依赖、配置或注入点**。`pnpm-lock.yaml` 中 `@opentelemetry/api` 仅作为 drizzle-orm 与 vitest 的 optional peer 出现；生产入口 `docker-entrypoint.sh:45-48` 直接 `exec node dist/server.js`，无 `NODE_OPTIONS`/loader 注入。
2. **请求关联身份已由 ADR-025 冻结**：`genReqId: randomUUID` + `requestIdHeader: false`（`apps/api/src/server.ts:117-119`），`x-request-id` root-scope hook（`apps/api/src/plugins/requestIdHeader.ts:33-38`）。
3. **技术日志出口唯一**：Pino → stdout JSON，`REDACT_CONFIG` remove 策略 + err/req 白名单序列化（`apps/api/src/lib/logRedaction.ts:13-31,102-223`）；无远端导出。
4. **数据库**：`drizzle-orm@0.45.2` 经 `drizzle-orm/postgres-js` 接 `postgres@3.4.9`（`packages/db/src/postgres.ts:41-65`）；事务重试 `executeInTransaction`（`packages/db/src/types.ts:186` 起，40001/40P01，退避 20/40/80ms）经进程级 `transactionRetryLogger` 输出（无请求级关联，`apps/api/src/plugins/db.ts:32-35` 注释明示）；`CAPACITY_RESEARCH=1` 的研究性 wrapper（`apps/api/src/lib/capacityResearch.ts:43-61`）只统计 arrival，per-statement 时长显式 `NOT_DIRECTLY_OBSERVABLE`（:152-162），无生产消费者。
5. **后台循环与告警**：heartbeat / deadlineScanner / clientEventRetention / emailOutboxLoop 四类 loop + operabilityMonitor（15s tick）以 `setInterval` 运行，结构化 stdout 告警（`operability.*` 四族事件）是现有运维告警契约（`docs/operations/active-alerting.md`）；readiness 判定源 `probeApplicationReadiness`。
6. **业务证据独立于技术观测**：`audit_logs`（append-only，`metadata.requestId`/`operationId` 注入规则见 observability 契约）、业务收据/attempt version、`client_events`（ADR-026 时间边界）各有权威。
7. **关机预算**：约 30s 契约（audit drain 10s + DB end 10s + 2s exit assist，`apps/api/src/server.ts:44,52-66`）< Compose `stop_grace_period: 45s`。

## 2. Decision

采用 OpenTelemetry 作为 Exam V1 的**技术遥测**标准，按以下硬边界实施：

### D1. 默认 Off，部署边界不变

- 基础 LAN/on-premise 部署离线可用性不变：默认不引入 Collector、Exporter、遥测持久化或任何网络行为。Off 模式早返回：无遥测导出任务、无遥测网络请求、无新增运行时外部依赖。
- Collector、Exporter、采样与遥测持久化的任何故障**不得**改变 Exam 请求结果、readiness、事务、重试或关机语义；遥测缺失只支持诊断，读作 UNKNOWN。
- 启用（On）是部署级 opt-in，归 Host 运维权限（承接 ADR-018 D6：技术遥测基础设施不通过 Exam RBAC/管理 API 开放）。

### D2. 身份与业务事实权威不转移

- Fastify 继续生成 server-owned UUIDv4 `requestId` 并回传 `x-request-id`（ADR-025 不变）。Trace ID / Span ID 是新增的**技术关联**信号，不取代 requestId，也不取得任何身份权威。
- 客户端传入的 trace headers 不取得服务端默认父上下文或身份权威（默认 server root 策略，W1.1 实测验证）。
- `operationId`、`clientSeq`、receipt、attempt version、`occurredAt/receivedAt`（ADR-026）各守自己的契约；Domain 与 Exam Engine 不引入 OTel SDK 依赖。
- Audit、Receipt、Client Event、Operability 继续拥有业务事实、保留、权限与失败行为；Trace 时间不是业务时间权威（ADR-006/#961）。
- 后台任务 trace 从 loop 自身 root 启动，禁止用 HTTP requestId 伪造关联（observability 契约 §Background work 既有规则）。

### D3. 技术信号载体

- Traces / Metrics：OTel（HTTP 语义按 W1.1 实测选定的唯一 server span owner；HTTP/DB 指标优先采用确认过的 SemConv 词汇，自研同义指标按 W7 清单收敛）。
- Logs：Pino 仍是唯一服务端技术日志调用入口；每个部署模式**只选择一条**远端日志摄入路径（stdout 收集 或 应用侧 OTLP Logs，二选一，W1/W6 实测后定）；默认 stdout 运维合同保持可用。
- DB 插桩：独立 workspace 包（拟名 `@exam/otel-drizzle-postgresjs`），`@exam/db` 对 OTel SDK 保持独立。官方 `@opentelemetry/instrumentation-pg` 插桩目标为 `pg`/`pg-pool` 模块，与本项目驱动 `postgres`（postgres.js）结构性不匹配，**淘汰不引入**（证据：`out/otel-w0/w0.2/upstream-evidence.md` §5.3，源码 L177/L195 实测）。

### D4. 隐私与脱敏

- ADR-018 D2/D4 约束全部适用：遥测字段默认排除原始 SQL、绑定参数、URL query、凭据与业务 payload；Span 属性与 Pino 日志是**两个独立出口**，分别在 exporter 出口验证脱敏。
- 指标 labels 仅用低基数字段（route 模板、稳定操作名、SQLSTATE/固定结果类别）。

### D5. 启用与回滚条件

- **启用顺序**：本 ADR 被 Owner 接受 → W1–W7 按 #964 完成并通过各阶段独立审查 → W7.2 在同一候选上完成 Off / On-无导出 / On-完整导出三态对照与故障注入验收（预算见 §4 表三）→ 生产启用由 Owner 单独裁决（与 ADR 接受是两个独立决定）。
- **回滚**：遥测整体可通过配置回退到 Off（早返回路径）；回滚不要求业务 Schema 变更，audit、receipt、client event 行为保持原状。Collector 侧（W6 opt-in compose profile）独立启停，不影响默认 Compose。

### D6. 范围排除（与 #964 §1 一致）

业务事件新表、产品内日志库、原始日志查询 API、调查 UI、告警投递或 ACK 平台、外网 SaaS、分布式业务架构、timed_sync 激活、独立 npm 发布——均不在本 ADR 范围。#921 历史记录保留。

---

## 3. 决策支撑表

### 表一 · 技术信号 vs 业务事实的权威归属

| 信号 | 权威载体 | OTel 的新角色 | 禁止事项 |
| --- | --- | --- | --- |
| HTTP 请求身份 | `request.id` UUIDv4 + `x-request-id`（ADR-025） | Trace 关联字段（W1 关联不替换） | Trace ID 取代 requestId；client trace header 取得身份权威 |
| 保存/提交凭证 | receipt / attempt domain state（EXSEM） | 无 | 以 2xx/trace 存在推断保存成功（#924 契约） |
| 业务时间 | 服务端时间权威（ADR-006/#961） | 无（span 时间仅诊断） | 用 span timestamp 裁决业务时序 |
| 客户端事件时间 | `receivedAt` 服务端权威（ADR-026） | 无 | 用 trace 时间核对 occurredAt |
| 业务审计事实 | `audit_logs`（append-only） | 诊断关联（requestId↔trace_id 并存） | 以 trace 缺失否定审计事实 |
| 事务正确性 | `executeInTransaction` 及其测试 | 逻辑事务计量点（W2） | 计量改变重试/隔离/锁序语义 |
| readiness / 告警 | `probeApplicationReadiness` + `operability.*` stdout 契约 | 补充指标，不判定健康 | 停 Collector 改变 readiness/告警 |
| 技术耗时/错误分类 | （新增）OTel traces/metrics | 本 ADR 建立 | 高基数 label、raw SQL/参数 |

### 表二 · 实现选择点与选择条件

| 决策点 | 候选 | 选择条件 | 当前状态 |
| --- | --- | --- | --- |
| Pino 日志远端摄入 | ① stdout → 部署方/Collector filelog 收集；② `instrumentation-pino` log sending / `pino-opentelemetry-transport` → OTLP Logs | 每部署模式**唯一**一条远端路径；默认 stdout 合同不破坏；同一条日志不得双路摄入；脱敏路径（REDACT_CONFIG/serializers）在所选路径出口实测有效 | 第一轮只验证 correlation（`disableLogSending: true` 已核实的开关，出处 `out/otel-w0/w0.2/upstream-evidence.md` §3），摄入方式 W1/W6 实测后定；**当前未支持任何远端摄入** |
| HTTP SERVER span owner | ① `@fastify/otel`（request/handler/hook span）；② `@opentelemetry/instrumentation-http`（Node 层） | 每请求**恰好一个** server span（上游已知双插桩会重复，README 声明）；覆盖路由/hook/404；传播（client span→server 提取）完整 | W1.1 强制产出，实测前**未知**；禁止双 owner 上生产 |
| DB 插桩层级 | A：API/Drizzle 逻辑事务边界（事务、重试、SQLSTATE 分类）；B：A + postgres.js 语句执行点（经真实 PG 验证惰性/事务子连接/异常行为保持） | B 仅在能区分实际执行、覆盖 `sql.begin` 保留连接的 scoped sql、不破坏 Query 惰性（arrival≠发送≠settle，`out/otel-w0/w0.2/upstream-evidence.md` §5.1）、属性安全且单一计量时才启用；否则收缩为 A | W2.1 真实 PG 探针裁决，**当前未知** |
| DB 插桩实现 | 官方 `instrumentation-pg` vs 独立包 | 官方包目标模块 `pg`/`pg-pool` ≠ `postgres`，结构性不匹配 → 独立 workspace 包 | 已淘汰官方包（N 级证据，upstream-evidence §5.3） |

### 表三 · 三态验收与预算（W7.2 执行；实测前全部标未知）

| 维度 | Off | On / 无导出 | On / 完整导出 |
| --- | --- | --- | --- |
| 遥测网络请求 / 后台导出任务 | 必须为零（实测证明） | 无网络（exporter=none 或等效），SDK 已初始化 | 仅向配置的 Collector 端点 |
| 业务行为（Save/Submit/Deadline/Restore/审计 drain/关机 30s 预算） | 与基线一致 | 与基线一致 | 与基线一致 |
| CPU 额外开销（vs Off 基线） | 基线 | ≤5%（未知，待测） | ≤5%（未知，待测） |
| p99 额外开销（vs Off 基线） | 基线 | ≤5%（未知，待测） | ≤5%（未知，待测） |
| Span/日志重复 | — | 每请求 1 个 server span（实测计数） | 同左 + 单路日志摄入 |
| 故障注入（Collector 不可达/队列满/导出超时/关机 flush） | — | 不适用 | 业务结果、readiness、关机语义不变；观测缺失=UNKNOWN |

预算初始值来源 #964（CPU 与 p99 各 ≤5%）；样本不足或波动过大时报告未知，交 Owner 裁决。

---

## 4. 候选版本与外部出处

全部外部版本/API 事实引自 `out/otel-w0/w0.2/upstream-evidence.md` 与 `compatibility-matrix.md`（npm registry 实测 + 官方 README/spec 原文，含 primary_url 与 tag）。摘要：

- 候选代次：`@opentelemetry/api@1.10.0` + `sdk-node@0.301.2`（experimental 线，整组同步升级）+ `@fastify/otel@1.0.1`（Node ≥22.15.0，生产镜像 24.22.1 满足）+ `instrumentation-pino@0.71.0`（pino ≥5.14 <11，本项目 10.3.1 在区间内）；Collector 候选 `otelcol-contrib 0.165.0`（W6 opt-in）。
- ESM 启动约束：ESM 需 `--import` + loader hook，注入点唯一可行位置为 `docker-entrypoint.sh` exec 行 / `NODE_OPTIONS`（upstream-evidence §1.2）。
- **以上均为「npm 已发布 / 上游声明」级证据；本仓库的编译通过与运行通过均未发生（W1.1/W1.2 范围）。任何运行时行为（span 数、env 支持面、correlation 字段、Off 零导出）在实测前一律视为未知，不得写成已支持。**

## 5. Consequences

正面：技术观测获得统一标准与可选后端路径；requestId/audit/receipt/readiness 的既有权威全部保留；DB 插桩不污染 `@exam/db` 依赖面。

负面/风险：experimental 0.301.x 代次的 breaking 风险（锁定整组升级）；双 HTTP 插桩重复 span（上游已知，W1.1 必须裁决）；新增配置面与关机 flush 预算交互；Pino correlation 字段与现有 redact/serializers 的共存需实测。

回滚：见 D5。

## 6. Alternatives considered

1. **维持 Phase 2 最小合同（无 OTel）**。拒绝理由：#964 已授权受限范围；技术诊断长期依赖 grep stdout 与 CAPACITY_RESEARCH 研究夹具，无结构化 trace/metric。但该路径保持为 Off 默认态，本 ADR 不强制任何部署启用。
2. **引入官方 instrumentation-pg**。拒绝：目标模块不匹配（§D3），装上不产生任何 span。
3. **应用内自研 trace/metric 库**。拒绝：重复造轮子，违背成熟库复用原则，且无生态后端。
4. **本 ADR 直接授权生产启用**。拒绝：ADR 接受与生产启用分离（D5），启用以 W7.2 实测验收为前置。
