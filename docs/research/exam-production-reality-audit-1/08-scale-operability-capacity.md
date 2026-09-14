# 08 — 规模、可运维性与容量（20/50/100/200）

scope：四个考试场景（S20/S50/S100/S200）下的可承载性与运维就绪。method：代码工作负载建模（MEASURED + OBSERVED_CODE）+ 隔离环境受控负载实验（MEASURED，/tmp 探针，未入仓库）+ 代码级瓶颈分析。实验环境：BASE 代码原样构建（tsx 运行 dev 模式）、isolated `exam_e2e` 数据库（仓库白名单库名，repo-owned seed 编排）、本机 20 vCPU / 15GiB WSL2、PostgreSQL 18.4 容器与 API 同机。**换算警告：单机同时承载 API/PG/负载源，绝对吞吐不可外推生产硬件；实验用于回答瓶颈性质。全部原始测量数字在 corrective 中未做任何修改。**

> **REPORT-CORRECTIVE-1**：① F-08-1 severity 统一为 MINOR（部署敏感），并按部署
> topology 拆分裁决（§4）；② health 模型拆分（§4）；③ 交卷风暴尾部延迟
> p95/p99/max = UNKNOWN（原始 notes 未持久化，禁止从 p50 外推）；④ 容量结论措辞
> 改为 "100-candidate generic exam workload SUPPORTED_WITH_GAPS under the
> measured single-instance topology"，不再写 "20–100 candidates proven"。

## 1. 工作负载模型（实测校准）

真实客户端行为（OBSERVED_CODE）：心跳 30s 间隔（TakeExamPage.tsx:917）；答题自动保存为事件驱动 +1.5s 防抖；take-view 刷新轮询（恢复/监控路径）。

实验 B 实测稳态（130 考生 × 180s，每 ~15s 保存一次 + 每 ~30s 心跳 + 偶尔 take 刷新）：
- **≈6.6 请求/考生/分钟**（2587 请求 / 130 人 / 3 min）。
- S20 ≈ 2.2 req/s；S50 ≈ 5.5 req/s；S100 ≈ 11 req/s；S200 ≈ 22 req/s（仅考生稳态）。
- 交卷风暴：突发 n 并发 submit（每请求含完整批改事务）。
- 后台固定成本：deadlineScanner 30s/轮 + heartbeat 30s/轮 + emailOutbox 轮询。

## 2. 实验记录（全部 MEASURED，隔离 exam_e2e）

探针：Node fetch 并发 + /proc CPU 采样 + pg_stat_activity 采样（`/tmp/exam-audit-notes/scenario.mjs`；服务端 `RATE_LIMIT_DISABLED=true` 以绕开实验自身同 IP 共享预算，限流本身另测见 §4）。

### 场景 A — 并发开局风暴（130 人 barrier 同刻 start）

```text
n=130 → 201×130, 409×0, 错误 0
p50=905ms p95=1070ms p99=1073ms max=1075ms   [TIER-2：终端观察转录，raw 未保留]
服务端 CPU 合计 0.89 core-seconds；pg 活跃连接≈1（池内排队）
```
裁决：130 并发开局全部成功；无重复/冲突错误；~1.1s 内完成。唯一约束是 postgres.js 连接池（max=10）上的串行化。**延迟百分位数按 corrective 的证据层级为 TIER-2（原报告正文转录，/tmp notes 无 START BURST 输出行）——与场景 D 同标准处理，不再标为 notes-retained MEASURED。**

### 场景 B — 稳态答题 + 心跳（130 人 × 180s）+ 场景 C — 监考轮询

**延迟证据层级（corrective 建立，本报告所有实验统一适用）**：

```text
TIER-1  RETAINED ARTIFACT   原始输出被保留在 /tmp/exam-audit-notes/，可独立重新推导
TIER-2  PROSE-TRANSCRIBED   审计时终端观察、转录进原报告正文；raw 未保留，单源存在
TIER-3  UNKNOWN             从未被任何载体记录（不得从其他分位数推导）
```

场景 B 的完整逐端点输出被保留（`steady-out.log`，TIER-1）。**corrective 从 retained artifact 重新推导**并按端点聚合（每端点 2 个样本，探针 report() 对 n=2 使 p50=p95=p99=max=该端点延迟）：

```text
请求：answers 780 端点、heartbeat 130、take-view 130 —— 错误 0、超时 0（各类一致）
answers  分布（端点延迟）：p50≈33ms  p90≈406ms  p95≈552ms  p99≈665ms  max≈708ms
heartbeat 分布：            p50≈126ms p90≈478ms  p95≈517ms  max≈560ms
take-view 分布：            p50≈32ms  p90≈89ms   p95≈95ms   max≈141ms
服务端 CPU 11.97 core-s / 180s ≈ 6.6% 单核
pg_stat_activity：maxConns=12，maxWaiting=10（池队列峰值，池上限 10）
```

**corrective 对原报告表述的修正**：原 "答案保存/心跳/take 逐端点 p50 17-30ms、p95 ≤30ms（无跨端点劣化）" **与 retained artifact 矛盾**（SA2 fresh-context 复核发现；正确分布如上：p90 即达 ~400ms，存在连接池排队造成的重尾）。CPU 余量结论（6.6% 单核）与零错误结论成立，但延迟形态改写为：**低载荷中位（~33ms）叠加池排队重尾（p90≈400ms 级），heartbeat 端点 p95≈517ms**——"余量巨大"仅指 CPU，连接池 max=10 是延迟尾部的来源（见场景 D 同源表现）。场景 C（监考轮询 p50=22ms/p95=28ms）为 TIER-2（转录，raw 未保留）。

> 注：2587 总请求数（≈14.4 req/s）来自 probe 终端汇总、转录于原报告（TIER-2）；api-server.log 的 1547 条 answers incoming-request 行与 780×2 端点样本量级互相印证。

### 场景 D — 交卷风暴（130 人 barrier 同刻 submit）

```text
n=130 → 200×130（全部含完整冻结+自动批改事务），错误 0
逐请求 p50≈1.3s（尾部排队），全部落库 graded（DB 权威核验：136 graded）
```

裁决：批改风暴通过；单请求 1.3s 主要是池串行化等待；结果一致性 100%（无 partial/丢分）。
**尾部延迟（corrective 诚实标注，按 §2 证据层级）**：探针 `report()` 内置 p50/p95/p99/max 计算，但 submit 模式的完整输出**未被持久化**到 notes（/tmp/exam-audit-notes 中无 SUBMIT BURST 输出行）。p50≈1.3s 属于 **TIER-2（原报告正文转录）**；p95/p99/max 属于 **TIER-3（从未记录）→ UNKNOWN**，禁止从 p50 推导尾部分布。对 p50 与尾部采用同一证据标准：整个分布来自未被保留的终端输出，p50 仅因被转录而存在。

### 场景 E — 准入队列（requireQueue，batchSize=20，batchInterval=15s，60 人）

```text
join 幂等；未报名者 404（反枚举）；未就绪 start 409（fail-closed）
停轮询期间积压批次在下次轮询一次性补放（56 人同刻 ready → 同时刻开局风暴）
重轮询下 start：201×36 + 200×76（恢复语义），p95=670ms  [p95 为 TIER-2 转录]
```
裁决：准入正确性与 fail-closed 语义全部成立；**分批放行节奏依赖考生持续轮询**（lazy reconcile 无后台驱动），停顿后补放会产生一整波开局风暴（F-08-2）。

### §4 限流边界（默认配置，RATE_LIMIT_DISABLED 未设）

```text
30 虚拟用户 / 单 IP（127.0.0.1）/ 干净 1min 窗口：
login: 10 成功后全部 429（路由级 max=10/min，auth.ts:120）
全局预算：10 login + 34 poll 通过后其余 429（全局 max=100/min，HMAC(ip) 键）
```
按实测 6.6 req/考生/分钟折算：**共享单一出口 IP 的考群约 15 人即触顶全局预算**；>10 人的同 IP 登录风暴（考试开始前的典型登录峰值）必然 429。生产 compose 把 EXAM_PORT 直接暴露给浏览器、无反代 X-Forwarded-For 接线（Dockerfile/compose 未见 trustProxy 配置）。

**Severity 统一（corrective）**：F-08-1 = **MINOR（部署敏感）**。原报告在 08 写 MAJOR、在 11 写 MINOR，属 severity 漂移；本 corrective 按部署 topology 分别裁决后统一为 MINOR——在仓库定义的默认拓扑（compose 直接暴露 EXAM_PORT、浏览器直连、每个考生一个真实 IP）下限流器按设计工作；失败需要一个特定的部署配置（共享出口 IP），属部署配置风险而非普遍 runtime 缺陷。原始测量数字不变：

| 部署 topology | Fastify 看到的 IP | 裁决 |
| --- | --- | --- |
| DIRECT LAN（默认 compose，EXAM_PORT 直连） | 每个真实客户端 IP 独立 | **PS：不触发**。单 IP 10 login/min 只约束同一人；稳态 6.6 req/min 远低于 100/min |
| SHARED NAT（多考生共享公网/源 IP） | 所有考生聚合为一个 IP | **受影响**：~15 人触顶全局 100/min；>10 人同刻登录触发 429。需要部署侧调 RATE_LIMIT_MAX 或身份维度限流键 |
| REVERSE PROXY WITHOUT TRUSTED CLIENT-IP WIRING | 反代 IP（全体共享） | **受影响且更隐蔽**：全体考生共享反代 IP，与 NAT 同等退化；需 trustProxy/XFF 接线后才能恢复按真实 IP 限流 |

Finding ID 统一表述：**DEFAULT RATE LIMIT IS TOPOLOGY-SENSITIVE**（不是 "100 candidates fail"）。

## 3. S20/S50/S100/S200 裁决（corrective 措辞：一律 "SUPPORTED_WITH_GAPS under the measured single-instance topology"，不写 "proven"）

| 场景 | 稳态需求（实测折算） | 实验证据 | 裁决 |
| --- | --- | --- | --- |
| S20（20+1+1） | ≈2.2 req/s；登录峰值 ≤10/min/IP | A/B/D @130 人全部通过，S20 是其子集 | **SUPPORTED_WITH_GAPS**（容量方向证据充分；登录限流对单 IP 小考群也无余量：10 登录/min 恰好覆盖 20 人分批登录） |
| S50（50+2+1） | ≈5.5 req/s | 同上（130 人实验覆盖 S50） | **SUPPORTED_WITH_GAPS**（共享 IP 拓扑下会被限流打断，见 §4 topology 表） |
| S100（100+3~5+1~2） | ≈11 req/s；登录峰值 ~100/min | A/B/C/D @130 人通过；池排队出现（maxWaiting=10）且错误 0，但延迟存在重尾（answer p90≈406ms，retained log） | **SUPPORTED_WITH_GAPS**：100-candidate generic exam workload 在实测单实例拓扑下可支撑（正确性 100%、CPU 余量大）；部署前提 = 限流拓扑确认与反代 X-Real-IP 接线（§4）；延迟尾部（池排队）在 100 人稳态下已可观测，200 人级需重新测量 |
| S200（stretch） | ≈22 req/s | 未实测 200 人；A/B/D @130 与代码路径同构外推 | **NOT_PROVEN**（无 200 级测量；风险点：池 max=10 的排队深度、心跳/扫描查询在 200 活跃 attempt 下的成本 F7-03） |

容量关键资源排序（按首先到达）：(1) **限流预算/每 IP**（部署语义问题，非算力——仅共享出口 IP 拓扑触发）；(2) **postgres.js 连接池 max=10**（`packages/db/src/postgres.ts` 默认，无 env 调节入口——未发现 pool size 配置面；延迟重尾的直接来源，corrective 后按 retained log 确认）；(3) CPU（实测余量 >90%）；(4) 扫描查询索引（F7-03，未测）。

### 3.1 显式 caveats（corrective 强制保留）

```text
single machine（WSL2 单机）
API + PG + 负载生成器 co-located（同一主机）
one app instance（单实例）
main load scenario disabled rate limit（RATE_LIMIT_DISABLED=true 于 A–E）
rate limiter separately tested（§4 单独实验）
refresh/reconnect storm not tested（考生刷新风暴形态未建模）
large historical dataset not tested（实验 DB 行数远小于真实学期数据）
200 not tested
production reverse-proxy topology unknown（trustProxy 语义未生产验证）
```

以上任何一条不成立时，相应裁决自动降级为 NOT_PROVEN。

## 4. 运维就绪（corrective 将 health 拆为五层分别裁决）

| 层 | 端点/机制 | 事实 | 裁决 |
| --- | --- | --- | --- |
| PROCESS LIVENESS | GET /api/health | 返回静态 ok，**不查 DB/Redis**（apiSurface.ts:42-53 注释："public liveness probe"） | **PROVEN**（按设计就是 liveness） |
| APPLICATION READINESS（DB-aware） | GET /api/system/health | 执行 `statsRepo.pingDb()` → `dbResponseMs` → `computeStatus({cpu,memory,dbResponseMs})`（system.ts:304-323） | **PROVEN** |
| OPERATOR DIAGNOSTICS | GET /api/system/diagnostics + /admin/system | 结构化日志 pino + REDACT_CONFIG + requestId（server.ts:102）；审计变更面闭合（04 §8） | **PROVEN** |
| DEPLOYMENT HEALTH GATING | compose healthcheck | 探活 = /api/health + SPA /（docker-compose.yml:87-96，"Proves the API and the SPA are both reachable"）；**不 gate 流量于 DB readiness**——DB 指空库时服务照常 listen、health 200（MEASURED api-fg.log） | **NOT PRESENT**（operability gap，非 ADR violation） |
| ACTIVE ALERTING | 外部/none | 无 metrics 推送、无告警接线；"出问题时 operator 靠 pull" | **NOT PRESENT**（operability gap） |

**不再使用 "health endpoint is DB-blind" 这种混合表述。** `/api/health` 是 liveness 且按设计如此；DB-aware readiness 由 `/api/system/health` 承担；真实缺口是 compose 健康门不 gate DB 就绪 + 无主动告警（F3-05/F4-05，均 MINOR）。

### 其余运维事实（preserved，corrective 未改）

| 项 | 事实 | 证据 |
| --- | --- | --- |
| 限流诊断 | RedisRuntime disabled 时降级内存 store，diagnostics 报告 disabled | `runtimeConfig.ts:101-111` |
| 邮件失败 | durable outbox + 重试/退避 + 锁超时恢复；不阻塞业务路径 | `emailOutboxLoop.ts` |
| graceful shutdown | 30s 预算契约 < compose 45s（门禁强制） | `server.ts:34-94` |
| 备份/恢复 | 9 个部署测试套件覆盖 compose 冒烟/fresh-install/launchpad/持久化+冷恢复/冷备/逻辑备/PITR/升级清理边界；backupRuns/restoreDrillRuns 表 + scripts/backup/ | `tests/deployment/`（9 个 .sh，corrective 复核计数）、`package.json test:deployment*` |

"考试进行中 operator 怎么知道系统坏了"：**主要靠结构化日志与 /admin/system 诊断页**；/api/health 不能反映 DB 故障（仅 liveness）；无外部 metrics/告警接线。DB 宕机时 API 进程存活（restart: unless-stopped 不触发），考生请求失败，恢复后自愈（无死信/半状态：事务原子性保证）。哪些 fail closed：授权解析失败 503、admission 消费零行中止、提交冻结屏障；哪些 log-and-continue：心跳写失败（"non-fatal"）、email 循环崩溃重试、扫描循环错误。

## 5. 故障模式审计（复用现有证据 + 实验观测）

- 考生刷新/断网：take 恢复 + restore 路径 + transientReducer；心跳 30s×超时阈值 → disrupted（可恢复）；**进程级 kill 测试存在**（`processRestartDeadline.process.test.ts` + `restartProcessHarness.ts` 真实子进程，非 app.close 等价物）——OBSERVED_CODE。
- 双提交/过期请求：锁+CAS+幂等键（03 报告）。
- API 重启：扫描计数器归零重建、admission 从行重建、email SKIP LOCKED 恢复、submitted 崩溃恢复路径（03 §6）。
- 未见覆盖的：DB 主故障切换、Redis 故障切换（Redis 可选，降级语义明确）、磁盘满。

## 6. Unknowns

- （SA5 复核补充）考生"刷新风暴"负载形态未建模/实测（实验 B 仅含低频 take 刷新）；正确性由代码判定安全，容量形态未验证。

- 200 人级与更大 DB 容量下的查询计划/索引行为。
- 多实例部署（compose 单实例之外的拓扑）。
- trustProxy/反代语义在生产部署的实际形态。
