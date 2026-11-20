# Exam #900/#1021 容量实验协议（G0 预注册 · v1.0）

状态：**FROZEN（预注册）**。本文件在正式容量采样开始前冻结（总纲 G0 要求）。冻结日期 2026-11-19。

- 冻结基线 SHA：`87510894728ee1ca20a530fc20e29fa1f51709b7`（origin/master；原始 A 与一切候选臂从同一 SHA 构建；基线草案曾对照 `bc138396`，以本 SHA 为准）。
- 环境事实（硬件/OS/Node/argon2/PG/依赖版本/libuv/池/测试哈希参数）：[`evidence/env-freeze.md`](evidence/env-freeze.md)，为本文组成部分。
- **修订规则**：预注册条目与阈值不得事后为通过而修改（#900）。如确需修订，另立 `PROTOCOL-vN.md` 并重新计算哈希、附变更理由；已采样数据不得用新阈值重判。pilot 只允许锁定参数空间内早已列出的候选（§4），不允许引入新候选。

## 0. 上位文件与范围

上位依据：战役总纲（Exam-900-1021-Capacity-Workflow-Prompt）、#900（运行时容量裁决，默认 KEEP）、#1021（登录 Argon2 测量，MEASURE_FIRST）、#587 入场裁决与终局（窗口化到达；未授权任何拓扑/线程池/参数变更——本轮实验即其要求的自带 policy freeze 的 bounded 研究）、#586（KEEP_POOL_10）、#668（FOR SHARE 读者，PR #804）、#672（四层对抗测试与真实考试时间形态）。语义权威以当前代码与 `docs/architecture/exam-runtime.md`、`docs/architecture/exam-semantic-boundaries.md`、`docs/contracts/` 为准。

本协议覆盖 G0 预注册清单：场景与 cohort、候选 K/S/Q/W/D、到达分布、拒绝与失败口径、主指标、阈值、重复次数、重置步骤、停止条件、证据目录约定。**产品容量认证、客户 SLA、是否迁移运行时，全部留给 Owner 裁决（G6）**；本协议所有阈值均为研究性阈值。

关键语义边界（实验必须遵守，来自本轮侦察）：

1. 登录来源限流 10 次/60s/IP（`apps/api/src/routes/auth.ts:122`）与全局 100 次/60s/IP 是硬契约：任何实验禁止关闭、放宽或绕过 limiter；禁止伪造转发头。
2. 仓库无 `503 LOGIN_BUSY`/`Retry-After` 契约（前端映射与后端均不存在）——L3/L4 属**研究分支上的新契约**，其结果不得表述为既有产品语义。
3. `timed_sync` 未激活（canonical validator 阻断）：同刻开考只能用已认证考生在同一时刻发起合法 `startOrRestoreAttempt`（`timed_window`）。
4. 客户端到点自动交卷契约：先 `GET /take` 做服务端到期验证，仅当服务端已冻结才补 POST；验证窗口内的手动 submit 归手动（S2 预期表必须计入）。
5. 断连在现状 A 不取消登录 POST（Fastify `request.signal` 零消费）：断连成本照常计入测量；L3 的"断开后 0 次哈希"是 B 分支新增行为，需 barrier 验证。
6. 前端登录错误为 catch-all 原样文案、无重试：**UI 文案不能作为成功/拒绝判据**，一律 DB/会话 oracle。
7. `#587` 终局未授权拓扑/参数变更：本轮 Argon2 参数（argon2id v=19 m=65536,t=3,p=4）冻结，B/C 臂严禁修改 Argon2 参数或任何安全/语义政策。
8. `REDIS_URL` 未设时限流为进程内内存窗口：多 Worker/多进程对照前必须固定 Redis 共享窗口，否则限流预算 ×N，判 COMPARISON_INVALID。

## 1. 环境与 canonical 采样配置

环境事实全部引用 [`evidence/env-freeze.md`](evidence/env-freeze.md)（WSL2 单机、20 核 i7-12700H 无 cgroup 配额、15GiB+4GiB、Node v24.15.0、pnpm 11.1.2、argon2 0.41.1、postgres.js 3.4.9 池 max=10、fastify 5.8.5、libuv 默认 4 线程）。canonical run law（每个正式容量 run 一致）：

- `APP_MODE=production`：生产 limiter ON，默认预算（全局 100/min/IP、登录 10/min/IP），`REDIS_MODE=optional` 且 Redis 可达（共享限流窗口）。429 是合法测量结果，保留并分类，不重跑掩盖。
- PG 池 max=10 不动（`apps/api/src/plugins/db.ts:26` 链，postgres.js 默认）；`UV_THREADPOOL_SIZE` 不设（默认 4）。
- Argon2 参数冻结（见 §0.7）；测试哈希只记算法/版本与 m/t/p，不归档明文、完整哈希、cookie、token。
- `CAPACITY_RESEARCH=1`（观测插桩，默认 OFF；`apps/api/src/lib/capacityResearch.neutrality.test.ts` 钉住其只计数不触碰查询——每批实验前该 neutrality 测试必须绿）。
- 后台循环全部开启、默认参数（deadline/heartbeat scanner 30s/60s、email outbox 5s、client-event retention、operability monitor 15s），不放宽任何 timeout、不膨胀任何预算。
- **容量采样独占 SUT**：采样窗口内本机不共跑其他测试/负载/构建。driver 与 SUT 同机（WSL2 单机）为拓扑边界，driver 余量按 §8 T6 每轮验证并随证据归档。

## 2. 场景与 cohort 定义

### 2.1 cohort 台阶 S_N

S_N ∈ {1, 20, 50, 100, 130, 200}（沿用 #900/#550 台阶；**是并发台阶，不是支持人数承诺**）。cohort 全部为合成考生（合成 username/password，仅存在于可重置研究库）。分工：

- L2 正式点：S20 / S50 / S100 / S200；S130 为边界补测点（当 S100→S200 之间出现指标拐点时补测）。
- L1 的并发轴与 S_N 无关（§4）。
- M1/W 场景沿用 #900 场景矩阵：W1 稳态、W2 登录突发 vs 错峰、W3 同场交卷热点（对照跨场）、W4 混合、W5 重连/重试、W6 新库 vs 历史数据。

### 2.2 来源拓扑（G1.3）

- **T-DIRECT**（主拓扑）：可区分来源——每合成考生绑定独立真实 loopback 源 IP（`127.0.0.<k>`，真实内核 socket 对端，非伪造头；复用 #550 DIRECT_LAN 模式）。
- **T-SHARED**（对照拓扑）：整批共享同一出口 IP。该拓扑下登录 10/min/IP 将先于容量机制拒绝（同分钟第 11 起即 429）：结果**单列为该拓扑的可用性限制**，不并入容量结论；可行的哈希、开考、交卷实验继续跑。
- 正式拓扑必须**经实际 Nginx**（`deploy/nginx/web.conf`，唯一公网入口；XFF 用 `$remote_addr` 覆盖、无 nginx 层 limit_req）。#550 `run-topology.ts` 的自建 XFF 代理不满足该要求；G1 需新接线（§15 缺口）。G1.3 必须核对 Nginx 与 Fastify 两侧实际观察到的 `request.ip`，防负载生成器落入被信任 CIDR（默认 `172.28.0.0/24`）造成身份漂移。

### 2.3 考试 fixture

- 同场组：一场考试 × S_N 人；跨场组：预注册拆分 **200 = 10 场 × 20 人**，各场同蓝图（相同题量、相同评分配比、相同改答量与到达序列）。
- 仅 `timed_window`；开考/截止窗口按各实验场景表配置。
- 稳态节拍沿用 #550：保存 ~5s±2 / 考生、心跳 ~15s±5 / 考生、监考读取 ~3s（2 名监考）。
- 每 run 1 名合成 admin/proctor（seed 与监考读取），不参与成功比例统计。

### 2.4 身份与判据

合成考生如上；一切成功/拒绝判定用 DB/会话 oracle（§5），前端 catch-all 文案不作为判据。

## 3. 到达分布（本轮合成负载）

> **标注：以下到达形态均为本轮合成负载（SYNTHETIC），不是客户实测分布，也不构成对真实考试流量的承诺。**「4 分钟窗口」「最后 30 秒集中」「S200」为合成参数。P1 近似 #587 入场裁决描述的产品预期形态（数百~数千考生分散在数分钟入场窗口）；P2/P3 为压力/对抗形态（#672：开考突发 → 稳态 → 最后 30 秒提交风暴）。

| 形态 | 定义 | 用途 |
| --- | --- | --- |
| P1 窗口分散 | 240 秒窗口内均匀到达（加抖动） | L2、O1 错峰臂、M1-W2 |
| P2 尾部集中 | 240 秒窗口，≥80% 到达压缩在最后 30 秒 | L2、O1、M1-W2、L3 配对负载 |
| P3 同刻突发 | 全部请求于 T0 同刻发出 | L2、S1 交卷、M1-W3、O1 集中臂 |

到达表（arrival schedule）以文件预生成并随 run 归档；配对实验**回放同一到达表**。交卷侧同义：P3 = 同刻集中交卷；叠加臂另加固定速率保存/心跳/监考读取（§2.3 节拍）。

## 4. 候选参数空间 K/S/Q/W/D

S 有双义，本文消歧：**S_N** = cohort 台阶（§2.1）；**S_sub** = S3 手动交卷全局上限。

| 参数 | 含义 | 预注册候选 | 锁定方式与依据 |
| --- | --- | --- | --- |
| K | L3 服务端准入：完整登录路径（含真实/dummy argon2 验证）的并发执行许可数 | {1, 2, 4, 8} | L1 吞吐拐点 + pilot 锁定单一主值，正式 A/B 前锁死。候选量级依据：libuv 4 线程 + 登录路径 3 次 PG 顺序读；K 管控的是完整路径，不得等同于正在执行的原生哈希数 |
| Q | L3 等待队列容量（等待请求数上限） | 公式 **Q = ⌈μ·W⌉ − K**，校验点 {20, 50, 100, 200} | μ = pilot 代表性混合流量下的服务率（成功/s）；不变量：等待数 ≤ Q、许可数 ≤ K（barrier 断言） |
| W | L3 服务端排队等待预算（单调时钟超时） | {2, 5, 10, 15} s | pilot 锁定。依据：单次成功登录服务时延量级（比较项 121–550ms，待核查）与 S200 批次排空时间量级覆盖；**历史"登录 7–10 秒"只是比较项，不是 W 的依据** |
| D | L4 客户端总预算：收到 503 LOGIN_BUSY 后等待最短时间+抖动，至多再发一次 | {15, 30, 60} s，约束 D > W | 机制验证主值 30s。依据：入场窗口为分钟级（#587），单次重试应能在窗口内完成；D ≤ W 无意义（客户端先于服务端放弃） |
| S_N | cohort 台阶 | {1, 20, 50, 100, 130, 200} | §2.1 |
| S_sub | S3 事务前全局手动交卷上限 | {2, 4, 8}（均 < 池 10） | 条件触发后先筛 S_sub=4，再视结果向 2/8 夹逼 |
| Watt workers | #900 C 臂 Worker 数 | {1, 2, 4} | 仅按 §10 RT 门槛触发，预注册自 #900 |
| L1 并发轴 | 验密/登录闭环并发 | {1, 4, 8, 16, 32}，必要时拐点补测 | 固定；隔离 verify 与完整 HTTP login 各一组 |

μ、W、Q、K 的最终锁定值记入 `evidence/<实验ID>/pilot-lock.md`（附录形式；只允许取上表已列候选，不引入新值）。

## 5. 拒绝与失败口径

### 5.1 offered / achieved / 独立成功

- **offered** = 预注册到达表中的计划请求数（考生操作数）。以下全部计入 offered，不得剔除：429、401、503、网络层失败（connection reset/refused/timeout）、driver 发送滞后与丢样（另列"计划到达 / 实际发出 / 取得响应 / 取得正确会话或终态"四级计数，丢样不从 offered 扣除）。
- **achieved-response** = 取得完整 HTTP 响应（任意状态码）。
- **achieved-success（操作级成功）** 按端点以 DB/会话 oracle 判定；HTTP 200 必要非充分：
  - 登录：`login.success` 审计行 + 会话有效（以该会话调用受保护资源验证）。**独立成功人数** = 窗口内至少一次登录成功的不同合成考生数（不是 200 计数、不是 UI 文案）。L3/L4 的"考生点一次、原 POST 短等、全程只有一次有效成功跳转"由真实浏览器断言 + DB oracle 双证。
  - 开考：attempt 创建且归属正确（candidateId 匹配、enrollment attemptCount 正确、questionSnapshot 已冻结）。
  - 保存：DB 中该题最后被接受版本与 receipt = 客户端最后确认值（spot-check per candidate）。
  - 交卷（权威确认）：唯一终态（submitted/graded）+ submittedAt/submissionReason 符合契约 + submitted_answers = 服务端最后接受集合 + 每冻结题恰好一条 grading entry + 审计副作用次数符合预期。不得凭一个 200 推断最后改答已保存。
- **C 臂重试口径**：offered 仍按考生操作数计；实际 HTTP 发出数单列；**新增请求放大量 = (C 实际发出数 − A 同负载发出数) / A 发出数**。
- **断连口径**：A 现状断连不取消（argon2 + 3 次 PG 读照跑）。断连请求的 CPU 与池占用计入分子与池测量，分母只含成功——CPU/成功 被如实抬高并单独标注断连数；L3 barrier 验证 B 分支"断开后 0 次哈希"为新行为。

### 5.2 拒绝分类（每 run 全量分类计数）

| 类 | 语义 | 处置 |
| --- | --- | --- |
| 429 RATE_LIMITED | 来源限流（per-IP） | 合法结果；按 per-IP 归属分析（T-SHARED 主导时单列） |
| 401 AUTH_INVALID_CREDENTIALS | 凭据/账号类统一 401 | **正确凭据负载下出现即为语义错误信号 → 计入 T5** |
| 503 AUTHZ_UNAVAILABLE | authz 运营故障 | 单列；不混入凭据错 |
| 503 RATE_LIMIT_UNAVAILABLE | required 模式 fail-closed | 单列 |
| 503 LOGIN_BUSY | 仅 B/C 研究臂签发前容量拒绝 | **非产品语义**；与 401/429 严格分开计数 |
| 网络层失败 | reset/refused/timeout | 计入 offered 与拒绝分类 |
| driver 丢样 | 计划到达未发出 | 计入 offered；违反 T6 时该轮作废 |

### 5.3 CPU/成功的分子与分母

分子 = 采样窗口 API 进程 CPU 时间增量（utime+stime，含全部线程；后台循环开销包含其中——混合负载的进程 CPU 同时含其他动作，故纯登录测量单列，或用"同负载无登录"的配对差分估计登录增量）；分母 = DB oracle 确认的独立成功人数（非 HTTP 200 数）。同录：宿主 CPU、API 峰值 RSS、event-loop utilization/delay、driver 自身 CPU。混合负载下归因不凭 CPU 曲线单点下结论（#900：high latency ≠ 单线程瓶颈；overall CPU high ≠ EL saturated）。

## 6. 主指标（每实验核心读数）

通用观测（每 run 必采）：Nginx upstream 延迟、主线程 ELU/delay、进程与宿主 CPU、PG 池等待（capacityResearch 语句到达计数 + 客户端 RT 分解）与 lock wait（pg_stat_activity 采样）、scanner 行为、driver 余量（offered/achieved/发送滞后/丢样/driver CPU）。

| 实验 | 核心读数 |
| --- | --- |
| L1 验密曲线 | 成功吞吐、CPU/成功、verify 调用 wall time、实际原生执行并发（或其可观测代理）、峰值 RSS、调度/限额证据、ELU/delay；**排队时间与原生执行时间分别标注**；隔离 verify 与完整 HTTP login 两组，1/4/8/16/32 并发 |
| L2 入场分布 | 首次点击→成功 p50/p95/p99（同报 max 与 N）、窗口内独立成功人数及比例、各原因拒绝分类、最后一人完成时间、**进行中考生**保存/心跳 p99 |
| O1 开考 | start 端到端 p99、借连接等待、主线程、attempt 创建数与正确归属；错峰 vs 集中；再与 L2 登录+开考叠加对照 |
| S1 交卷 | HTTP→权威确认时延（含 COMMIT 后两次事务外读）、事务时长、借连接等待、PG lock wait 与阻塞者、保存/心跳尾延迟、最终已确认答案数、唯一终态数 |
| M1 运行时 | W1–W5 按动作容量与主因；W6 新库 vs 代表性历史数据（记录 scanner 行为；无代表性历史数据时标注外推限制） |
| S2 时序 | 每交错案例"预期（先写）vs 实测"：UI、DB 状态/原因/时间、答案版本、评分、审计副作用数 |
| S3 准入 | 交卷完成数、末位权威确认时间、混合 QoS（保存/心跳）、S2 全部业务结果不回归 |
| L3 服务端准入 | L2 全套 + 队长峰值、执行许可峰值（断言 ≤Q / ≤K）、忙碌拒绝与凭据错误严格分离 |
| L4 客户端重试 | 各分支实际发送次数（双击/离页/预算到期/401/来源 429/其他 503/丢响应分别断言）、任一时刻单操作至多一个在途请求、旧响应不覆盖新操作、已有他账号 cookie 不误认成功 |

**小样本纪律**：所有 p99 一律同报最大值与样本量；每 run 原始分布（samples.jsonl）保留，含失败轮。

## 7. 历史比较项（仅待核查，非阈值、非门禁）

| 比较项 | 来源 | 地位 |
| --- | --- | --- |
| Login CPU/成功 低并发 ~121ms → 高并发 ~550ms；Node 24 vs 26 差异 ±0.8%（Login is native-hash-bound） | #1018/#1021 已记录事实 | 待核查比较项 |
| 登录 7–10 秒、交卷 1–4 秒 | #550/#584 历史观察（特定 WSL 拓扑） | 待核查比较项，非跨硬件承诺 |
| #668 同场交卷进程内 p99 改善 ~62–68% | #668（PR #804） | 进程内证据，非 HTTP 端到端承诺；旧结果不代表当前 HEAD |

仓库无客户 SLA；**产品容量认证与任何 SLA 承诺留给 Owner**。上述数值只用于与本轮实测并列对照，不作为通过/失败门禁。

## 8. 预注册研究性阈值（含依据）

| 编号 | 判定 | 阈值（预注册） | 依据 |
| --- | --- | --- | --- |
| T1 | #1021 登录候选采纳门禁 | 高并发下 Login p99 **或** CPU/成功 改善 **≥10%**（配对中位数，相对同轮 A）；峰值 RSS 增幅 **<10%**；success/error/认证语义不变 | #1021 Issue 正文预注册门禁，本协议引用 |
| T2 | #900 Watt/拓扑工程阈值 | p99 **或**可持续吞吐实益 **≥15%**；其他关键 QoS 无实质回归（=T3）；零新语义错误（=T5）；资源预算可接受（进程峰值 RSS 增幅 <15%、宿主 CPU 总量增幅 <10%） | #900 正文候选工程阈值（15% 为 #900 原文）；括号内资源预算操作化为本协议选择 |
| T3 | 混合 QoS 无实质回归（操作化） | 已开考考生 save p99 与 heartbeat p99 的配对中位数相对恶化 **<10%** | 本协议操作化：与 T1 对称的最小可感知变化；非产品 SLA |
| T4 | A/A 噪声门 | 同臂连续 run 主指标相对极差 < 预期收益一半（T1 类 5 个百分点、T2 类 7.5 个百分点）；超出 → 排查并复测（至多再 3 轮），仍超 → INCONCLUSIVE | 总纲 G0"A/A 波动足以吞没预期收益时，先排查、复测，证据不足就标不确定" |
| T5 | 零新语义错误 | 配对同 offered 下，B/C 出现 A 未出现的错误类、或正确凭据负载出现 401、或 S2 任一不变量失败 → 该候选**暂停性能采纳**，保存最小见证 | #900"零新语义错误" |
| T6 | driver 余量 | 采样窗口内 driver 进程组 CPU < 宿主 30%（20 核）、无单核 >90%、计划到达发送滞后 p99 <50ms、丢样 =0；任一违反 → 该轮作废并判 LOAD_GENERATOR_BLOCKED，修正后重跑 | 总纲 G1.4"验证 driver 有余量"的操作化 |
| T7 | S3 触发条件 | S1 交卷窗口内（首提交请求起至最后权威确认 +10s）：(a) 交卷事务借连接等待 p99 ≥100ms，**或** (b) 同窗 save/heartbeat 等待/RT p99 相对无交卷对照恶化 ≥2× 且绝对值 ≥50ms。满足 (a) 或 (b) 才启动 S3 | 总纲 G4 条件实验触发词"持续 pool wait 且同期保存/心跳尾延迟恶化"的操作化；结构依据：单池 max=10、交卷事务全程占连接 |
| T8 | L4 扩大条件 | 仅当 B 在**真实到达流量**（非 barrier 注入）中出现实质容量拒绝（503 LOGIN_BUSY + 排队超时拒绝合计 ≥1% offered）才扩大 B/C 配对并评估收益 | 总纲 L4"只在 B 的真实到达流量中存在实质容量拒绝时，扩大 B/C 配对" |

统计口径（与阈值配套，预注册）：配对相对效应 Δ_i=(臂_i − A_i)/A_i，报告 **中位数 [min, max]**（离散度）与方向一致性（≥4/5 对同向）；p99 一律同报 max 与 N；结论不单独依赖 p 值。

## 9. 统计与配对规程

1. **Pilot**：每实验正式采样前 ≥1 个 pilot run（S20 或等比缩小），验证 harness、oracle、artifact 管线与 T6；pilot 数据不入正式统计，单独归档。pilot 兼作 §4 参数锁定（→ pilot-lock.md）。
2. **A/A**：每个实验系列正式采样开始前，同臂连续 ≥2 run 建立噪声地板，对照 T4。A/A 可复用该系列前两轮正式 A run（同臂连续）。
3. **交错配对**：对照型实验（P1 vs P2、错峰 vs 集中、同场 vs 跨场、A vs B、A vs S_sub、新库 vs 历史）按对交错臂序（奇数对 A→B、偶数对 B→A），消除时间漂移；**每 run 之间完全重置**（§11），配对回放同一到达表文件。
4. **重复数**：默认每个对比 **≥5 个独立配对**；T4 触发复测时至多追加至 8 对，仍不足 → INCONCLUSIVE。特性描述型实验（L1 各并发点、L2 单形态、M1-W1/W6）每预注册点 ≥5 独立 run（前 2 轮兼作 A/A）。
5. **按 run 分析**：每 run 独立产出一套指标 → 每对计算效应量 → 跨对报告中位数与区间；禁止把多 run 样本合并后当作独立样本。失败轮保留（标 FAILED + 原因），不计入但不静默删除；因 T6 作废的轮次重跑后计入。
6. **机制型实验**（S2、L3 barrier、L4 浏览器断言）非统计实验：每案例 ≥5 次重复以显稳定性，断言全过为准；故障注入/机制验证与性能采样**分开运行**，不混在同一轮。

## 10. 各实验规程

> ID 前缀即证据目录名（§13）。所有实验列必须有处置：实际运行 / 由上游证据判定未触发（引用 run ID）/ 记录具体阻塞。到达型正式采样（L2/O1/S1/M1/L3/L4 收益评估）以 G1 闭环为前置；机制类（L1 闭环扫描、S2、真实 PG 事务测试）可并行推进。

**G1-FIDELITY（前置门）**：① Playwright/CDP 经实际 Nginx 跑两轨迹——登录→等候→开考→改答→保存确认→交卷→查看结果；保存后刷新/重连→恢复→提交——对照 DB 验证身份、答案版本、attempt 终态、评分工作集（复用 `apps/e2e/e2e/candidate-happy-path.spec.ts`、`refresh-during-exam.spec.ts` 与 `lib/flow.ts` helpers）。② 从真实轨迹复用请求顺序/cookie/请求体/身份/保存节拍/重试行为，构建少量 UI 探针 + 协议回放，对比 endpoint mix、payload、响应、业务终态；正式到达流量按预定时刻开放式发出，记录计划到达/实际发出/取得响应/取得正确会话或终态。③ 双拓扑（T-DIRECT/T-SHARED）核对 Nginx 与 Fastify 实际观察 `request.ip`。④ driver 余量（T6）。浏览器能力有缺口时保留协议级证据并标明 UI 透明性未验证。

**L1-VERIFY**：真实库、冻结 m/t/p；并发 {1,4,8,16,32}（拐点补测）；隔离 verify（直接调 `hashPassword`/`verifyPasswordOrDummy`）与完整 HTTP login 各一组，各 ≥5 独立 run。读数见 §6。闭环扫描只用于找机制拐点。

**L2-ARRIVAL**：P1/P2/P3 × {S20,S50,S100,S200} × T-DIRECT；T-SHARED 在代表性点（P2×S100）单列。pilot 先行（P2×S20）。每形态每点 ≥5 独立 run；P1 vs P2 为交错配对对比（≥5 对）。

**O1-START**：已认证会话，同一份合法开考动作（`timed_window`，同刻 `startOrRestoreAttempt`）分别错峰（P1）与集中（P3）执行——交错配对 ≥5 对；再与 L2（P2 登录 + 同刻开考）叠加对照 ≥5 run。开考成本定位（两把 Exam FOR UPDATE 串行点、questionSnapshot 拷贝、PG 等待分解）完成前不讨论预创建。

**S1-SUBMIT**：预先认证并准备等量独立 attempts；200 同场 vs 200 跨场（10×20），相同题量/改答量/评分配比/到达序列，交错配对 ≥5 对；各跑纯交卷（P3）与叠加固定速率保存/心跳/监考两组。读数见 §6；T7 判定在此产出。

**S2-TIMING（必跑）**：A 上用受控服务端时钟、确定性 barrier 与真实 PG 事务（`TEST_DATABASE_URL` slot lease 平台或等价隔离 harness）排列总纲 G4 表四类交错：保存后提交/保存在途提交；跨截止取时（手动 vs scanner 先得锁，覆盖恰在边界比较符）；双击/重试/响应丢失；重启两窗口（入事务前/已提交未送达，可控 failpoint 或隔离代理）。**每案例先写预期表**（按当前代码契约：UI、提交原因、submittedAt、最终答案、副作用次数，含客户端"到点先 GET /take 验证再补 POST"契约），再与实测比对；每案例 ≥5 次重复。发现新语义错误 → T5 暂停候选并保存最小见证。生产取时（fastify.now()）与单调排队时钟分别记录。

**S3-ADMIT（条件：T7）**：未触发则引用 S1 run ID 记录"未触发"。触发后：事务前全局手动交卷上限 S_sub ∈ {2,4,8}（先筛 4）；同轮总人数、到达流量、池大小、取时位置、事务重试策略与 A 一致；队满/过期明确表示该手动请求尚未执行；scanner、autosave、heartbeat 须可独立运行。比较 A vs S3 配对 ≥5 对（交错）；交卷完成数、末位确认、混合 QoS、S2 全部业务结果。按 examId 串行、微批、202、宽限、异步评分、扩池**不作为默认干预**。若只有同场退化，先定位真实等待的锁及持有者。

**M1-RUNTIME**：W1/W2/W3/W4/W5 保持原始 A（复用 #550 lifecycle 相位：LOGIN_BURST/START_BURST/STEADY 90s/RECONNECT_SILENCE 15s/RECONNECT_RESTORE/RECONNECT_FIRST_SAVE/SUBMIT_BURST + durable oracles）；W6 用同一关键场景对照新库与代表性历史数据（#550 run-longlived 组成数据集），记录 scanner 行为；历史数据不具代表性时标注 W6 外推限制。每场景 ≥5 独立 run（W6 配对 ≥5 对）。

**L3-ADMISSION（B 臂）**：可丢弃实验分支上，单 Fastify 实例共享 FIFO 准入，位于来源限流与请求校验**之后**、查租户/用户**之前**，许可覆盖至真实/dummy 验证结束；入队前不查询/保留账号快照，等待不占 PG 连接；全部账号密码登录共享预算；K 按 §4，单调时钟排队超时 W。A vs B 在代表性 L2 负载（P2）配对 ≥5 对，回放同一到达表。确定性 barrier 单独验证（非统计）：body 读完后可在线等待；经真实 Nginx 两人排队、一人断连——B 分支须实现断连后 0 次哈希（订阅 `request.signal`），另一人正常登录；队满/等待到期/释放许可/断连同时发生只结算一次；验证开始后断开直到 native promise settle 才释放许可；等待 ≤Q、许可 ≤K；请求结束无残留监听器/计时器；正确密码/错误密码/未知/禁用账号/未知租户全覆盖；忙碌拒绝不混入凭据错误；排队中修改账号状态后验证读取最新可见状态；角色/会话/失败/审计语义与 A 一致。

**L4-RETRY（C 臂）**：机制正确性与是否值得采用分开验证。拟议契约（研究分支）：签发前容量拒绝返回 `503 LOGIN_BUSY` + 整秒 `Retry-After`（现状无此契约）。浏览器仅对此在预算 D 内等待最短时间+抖动、最多再发一次；双击、离页、预算到期、401、来源 429、其他 503、丢响应分别断言实际发送次数；任一时刻单操作至多一个 HTTP 请求；旧响应不覆盖新操作结果；已有其他账号 cookie 不误认成功。真实浏览器验证一次点击。**扩大条件 T8**：仅当 B 真实到达流量出现实质容量拒绝，才扩大 B/C 配对，分别记独立成功人数与新增请求放大量。生产 limiter 先挡住共享 NAT 流量时，直接报告该拓扑可用性限制。

**RT-B-WATT / RT-C-WATT（条件：#900 门禁顺序）**：G2 归因非 Node 主 Event Loop 瓶颈 → STOP_WATT（可做低成本 B 测包装 overhead，不继续 C）。仅当 G2 发现可由多 Event Loop 缓解的瓶颈且多 Worker 业务 owner 契约先证明可行（background task singleton/leader、outbox lease、scheduler、DB migrations、连接池总量、limiter/client-IP、日志 request identity、readiness/graceful shutdown 等价性），才进 C；Worker {1,2,4}；不等价 → SEMANTICALLY_BLOCKED（只做明确标注 mechanism-only 的隔离 HTTP 微实验）。资源归一化：N×pool 隐性扩容必须分别报告部署默认视图与归一化视图；Redis 全局限流窗口必须有效（§1）。多 Worker 有实益才考虑同预算普通多进程对照（PREFER_SIMPLER_TOPOLOGY 比较项）。

## 11. 重置步骤

R0（四步前置，AGENTS.md §6，每批实验首次触库前执行）：① 确认生命周期所有者——研究 harness（每 run 自建自清，非 dev/prod 生命周期）；② 解析并查询进程实际连接的数据库（`SELECT current_database()`，不得凭 .env 文件名猜测）；③ 名称守卫——唯一 HTTP 采样库为 `exam_550_e2e`（复用 #550 harness lib 的 name-guard 与 DROP/CREATE/migrate/seed 生命周期，守卫不符即拒绝执行）；S2 类进程内事务测试走 `TEST_DATABASE_URL` 契约的 `exam_test` worker-slot lease（testing.md §2.8），用后归还；④ 证明目标为测试/E2E 库后方可 drop/create。

R1（每 run 之间，完整重置）：loud DROP/CREATE `exam_550_e2e`（守卫内）→ `migratePostgres` → canonical seed（仅合成考生）→ 起 fresh API 进程（canonical 配置 §1，fresh JWT secret）→ 采样 → durable oracle（fresh PG 连接直读，不经 API）→ 停 API → 归档 artifacts（§13）→ 确认主工作树 clean。

R2（失败轮）：保留数据 + FAILED 标注与原因；重置后重跑计入配对数；禁止静默丢弃或 `|| true` 吞错。

R3（浏览器/会话）：每 run fresh JWT secret；浏览器轨迹与 artifacts 归档前清理认证材料（cookie/token/密码）。

R4（运行位置纪律）：一切新代码/runner/文档落在 worktree `.wt-capacity`（分支 `research/capacity-900-1021`）；#550 主树路径的 runner 会向主树 `results/` 写文件，**禁止在主树路径运行**，一律使用 worktree 内 harness 副本/新 runner；主工作树全程保持 clean，禁止 push/merge/rebase/force-push。

## 12. 停止条件与裁决映射

| 观察 | 裁决/动作 |
| --- | --- |
| driver 先饱和 / offered 与 achieved 不一致 / T6 违反 | LOAD_GENERATOR_BLOCKED：修正 driver 后重跑，不算结果 |
| PG lock/pool 受限且主 EL 有余量 | KEEP_CURRENT_RUNTIME_DB_BOUND（停止 Watt 推进） |
| Argon2/libuv 压力但主 EL 未饱和 | KEEP_CURRENT_RUNTIME_HASH_BOUND（交回 #587 线索） |
| B 回归或 C 违契约 | REJECT_WATT / SEMANTICALLY_BLOCKED |
| 收益来自隐性扩容（N×pool 等） | COMPARISON_INVALID |
| 简易多进程相当 | PREFER_SIMPLER_TOPOLOGY |
| 充分证明多 Event Loop 实益 | PROPOSE_WATT_ADR（独立 Owner gate，非自动迁移） |
| A/A 噪声吞没收益（T4）且复测无效 | INCONCLUSIVE（精确写明缺什么） |
| S2 新语义错误 | 该候选暂停性能采纳（T5），保存最小见证 |
| G2 归因非主 EL 瓶颈 | STOP_WATT（仅可做 B 包装 overhead 低成本测） |
| L3/L4 无实质容量拒绝或无增益 | A 满足目标即保留 A（NO_GO_NOW，#1021） |
| 安全前置失败（R0 守卫不符、主树意外变脏） | 立即停止采样，如实记录 blocked 与所缺条件 |

禁止事项（全程）：不得用预测值、空白模板或人工构造的成功记录充当结果；不得为绿灯扩大 timeout/无界重试/降低断言/换 mock；不得在实验中修改产品语义政策（Argon2 参数、limiter 预算、池大小以外的任何安全边界——池大小也只在预注册的归一化视图中报告，不改产品默认）。

## 13. 证据目录与归档约定

根目录：`/home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/`。

```
evidence/
  env-freeze.md                  # 已冻结（G0 筹备）
  PROTOCOL.md.sha256             # 本协议哈希（冻结见证）
  <实验ID>/<run_id>/             # 实验ID ∈ {G1-FIDELITY, L1-VERIFY, L2-ARRIVAL, O1-START,
                                 #   S1-SUBMIT, S2-TIMING, S3-ADMIT, M1-RUNTIME,
                                 #   L3-ADMISSION, L4-RETRY, RT-B-WATT, RT-C-WATT}
    samples.jsonl                # 每 HTTP 请求一行：ts/phase/endpoint/status/latency_ms/error_class/timeout
    run-meta.json                # 完整命令行、env（脱敏）、head SHA、DB 名、臂与参数（K/Q/W/S_N/S_sub/D）、起止时间
    oracle.json                  # DB durable oracle 结果
    driver.json                  # offered/achieved/发送滞后分布/丢样/driver CPU
    api.log                      # 脱敏 API 日志（无凭据/cookie/token）
    cmd.sh                       # 精确复跑命令（见下）
  <实验ID>/pilot-lock.md         # §4 参数锁定记录（pilot 后、正式采样前）
```

- run_id 约定：`<实验ID>-<关键参数>-r<重复序号>`（如 `L2-ARRIVAL-P2-S100-r3`、`S1-SUBMIT-same-r2`）。
- **cmd.sh 契约**：命令必须在 `cwd=/home/hoo/Source/exam` 下原样可执行。新 runner 一律位于 worktree harness 目录，调用形如：
  `pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/<runner>.ts --…`
  （#550 harness 的复用组件以副本形式置于该目录，保持其"输出路径随文件位置解析、cwd 无关"的性质；禁止指向主树 `docs/research/exam-550-final-capacity-reproof-1/` 路径运行会写 `results/` 的 runner。）
- 脱敏：不归档密码明文、完整密码哈希、cookie、token 等可复用凭据；测试哈希只记算法/版本与 m/t/p；浏览器轨迹归档前清理认证材料。
- 采样数据落 worktree 研究目录（未跟踪或研究分支内提交）；**run 仍在写入时不得 git add/commit 该 run 的 artifacts**（#550 lint-staged 教训）；每 run 归档后附 SHA256 manifest。

## 14. 结果出口

结果写入 `docs/research/exam-cdp-watt-runtime-capacity/RESULTS.md`（G6 结构：一页裁决、实测容量表、交卷时序表、实验台账、可复现证据），图表只用真实数据，复跑一个代表性样例并从原始数据重算报告数值。本协议不预填任何结果字段。

## 15. 已知缺口（前置构建项，预注册）

来自本轮 harness 侦察，作为开工前的构建清单；任一项到阶段仍未备齐则该实验记 blocked 与所缺条件：

1. 真实 Nginx 负载接线（G1.3；#550 run-topology 自建代理不满足）；
2. L1 隔离验密 runner（隔离 verify 与完整 HTTP login 两组、并发拐点扫描）；
3. S1 同场 vs 跨场预注册配对 runner 与保存/心跳叠加控制；
4. S2 受控时钟/barrier/failpoint 事务交错 harness（可参考 `apps/api/src/routes/attempts/` 既有 concurrency 测试模式）；
5. L3 服务端 FIFO 准入原型与 L4 客户端透明重试原型（实验分支）；
6. 配对统计工具（A/A、交错 A/B、效应量/区间/样本量计算——#550 aggregate.ts 只做单场景汇总）；
7. O1 错峰 vs 集中对照扩展（start 端到端 p99 + PG 等待/attempt 创建分解）。

#550 harness 既有资产的可复用性已由侦察核实到导入级与离线复算级（lib 导入 smoke 5/5、summarize 对 1623 样本 drift ok、analyze-rotation PASS、`scripts/e2e/run.sh --help` exit 0）；压测类 runner 未实际启动（侦察阶段禁触 DB 生命周期），其运行性结论以本轮正式 pilot 为准。
