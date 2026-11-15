# PERFORMANCE-REPORT — 观测性工作流性能实验报告（裁决版）

- **裁决角色**：首席性能工程师（成本/价值最终裁决）。
- **协议哈希（双口径声明，复核轮修订）**：①全文件口径（`sha256sum` 实测）：PROTOCOL.md = `8bc7f7cdf06353b80d149336e492cbb41b0896a844a5781a34ee03fdee80df63`（与 ask 提供值一致）、PROTOCOL-v2.md = `7feefa72a81c12b6af8f34d8385565f6e878032ca9b882aed1721be92a204977`；②内容哈希口径（按修订日志约定"去除修订日志节"：`awk '/^### 修订日志$/{exit} {print}' | sha256sum`，本会话实测）：PROTOCOL.md = `4eddc21683a5fae17913e35a59dbbf7dab57ebdd3429d5c22619ed31d0fee5be`（= harness manifest `configs.json` 所钉值）、PROTOCOL-v2.md = `e07b39d18ed825785463aaf3f2d713d7eb69e230c83ac00d02c56fedab9b16ab`（= v2 修订日志自记值）。**两组值各自为真、口径不同；冻结正文未被篡改**，不得将 8bc7f7cd ≠ 4eddc216 误读为协议文件被改。版本裁决（v1 vs v2）未决，见 §2.3。
- **数据源**：`out/otel-w964/workflow-audit/aggregate.json` 与 `rounds/`（本会话自行读取）。
- **实验状态：BLOCKED** —— 45 个已记录 segment（含 1 个中断段目录），**0 个有效**（§3）。聚合行 `rows: []`（§2.1）。全部预算判定（T1–T4）无判定依据。
- **证据等级约定**：`MEASURED`＝本会话实际执行的命令/读取的产物；`CODE_VERIFIED`＝本会话读源码/文档定位；`转引`＝来自既有记录（REALITY/WORKFLOW-INVENTORY/PR 记录/同目录文档），本会话未复核；`UNKNOWN`＝无法验证，禁止当事实使用。

---

## 1. 环境边界声明（WSL2 探索级）

本实验全部运行于 **WSL2 单机开发环境**（Windows 宿主 Linux 子系统 + Docker Desktop 链路），非生产硬件、非生产拓扑、非生产容量规模（PROTOCOL §2 边界声明，`PROTOCOL.md:49-51`）。**本报告全部数字（含 §5 未配对探索值）结论等级为【探索级】：仅用于机制归因，不冒充生产容量结论，不得外推为生产容量规划或 SLA 依据。** 生产化容量判断需要独立的生产形态复测。

环境冻结快照（Node v24.15.0 / 20 逻辑 CPU / 15Gi RAM / postgres:18.4-bookworm）复核记录见 `PROTOCOL.md:53-66`【转引｜撰写会话复核】。

---

## 2. 数据源与聚合状态

### 2.1 aggregate.json 现状（本会话重算）

本会话执行仓库语义命令 `node scripts/perf/otel-workflows/runner.js aggregate`（harness 唯一聚合入口，`runner.js:3119,3167-3171`），对现存全部轮次重算，产物写回 `out/otel-w964/workflow-audit/aggregate.json`【MEASURED】：

- `rows: []` —— **零条可呈报对比行**；
- notes：逐段剔除记录——40 个正式段全部因三类无效原因被排除（§3），round-0 5 段按 pilot 排除（"pilot data never enters statistics"），round-20 仅 1 个已记录结果（H1，中断轮）。

**透明性声明**：重算前该文件为陈旧产物（生成于轮次落盘之前，`rows: []`、内嵌 note "no rounds found"、`generatedAt=2026-11-14T19:35:22.787Z`）。重算前内容已由本会话先行读取确认，并在 `COMPONENT-ATTRIBUTION.md` §3.2 有独立记载；重算不改变结论（重算前由其空 rows 无法证明轮次已聚合，重算后由逐段剔除记录证明 0 有效）。原始文件为 `out/`（gitignored，`.gitignore:77`）运行产物，可由 `rounds/` 随时再生成。

### 2.2 轮次清单（MEASURED，逐轮读取 `rounds/*/round.json`）

| 轮 | 配置顺序 | 已记录 segment | 有效 |
| --- | --- | --- | --- |
| round-0（pilot） | H0,H1,H2,H3,H4 | 5 | 0 |
| round-1..6（6 轮） | 每轮 5 配置轮转 | 30 | 0 |
| round-20（中断） | H1,H2,H0 | 1（H2 目录仅有 ops/日志，无 samples/summary） | 0 |
| round-101..103 | S0,S1,S2 轮转 | 9 | 0 |
| **合计** | — | **45** | **0** |

### 2.3 协议版本

harness manifest 钉 PROTOCOL v1（`configs.json` `protocol.version="v1"`、`sha256=4eddc216…`（**内容哈希口径**，去除修订日志节，本会话 `awk` 实测精确成立；非全文件哈希 8bc7f7cd…，见文件头双口径声明）、commitSha `1d689b4a…` 与主仓 HEAD 一致）【MEASURED｜复核轮重读 manifest protocol 字段】；同目录存在 v2 修订（全文件 sha256 `7feefa72…`；其修订日志自记内容哈希 `e07b39d1…` 同法实测成立）。版本裁决（v1 vs v2 §8.1 单调性）属 Owner，本报告不代决。

---

## 3. 无效判定统计（为何 BLOCKED）

45 个已记录段全部 `valid:false`，**45/45 全部命中三类原因**（含 round-0 pilot 5 段与中断轮 round-20/H1；非 pilot 正式段 40/40）【MEASURED，逐段读取；复核轮修正：初版"44/44 正式段"为混合口径且与同句括号自相矛盾，已改】：

1. **`steady window exceeded 180s before quota completion`**（PROTOCOL §3.3：配额未完成判段无效）：混合档配额合计 **12000 ops/段**、`steadyMaxSeconds=180`、`concurrency=10`（`configs.json:30,33,35`；本会话脚本求和 = 12000）。45 段吞吐 19.31–23.05 ops/s → 完成 12000 ops 需 ~520–620s，**超窗 3 倍以上，结构性互斥**（B1）。
2. **`proc sampler produced no steady-window CPU pair`**：harness 采样时序缺陷——`runner.js:1858` `await sleep(60)`（60ms）后即取 `cpuStart`，而采样 tick `PROC_SAMPLE_MS = 1_000`（`runner.js:87`）⇒ `samples` 必空 ⇒ `cpuStart` 必 `undefined` ⇒ `runner.js:1896-1904` 走 invalid 分支。**任何跑满 180s 的段都必然带此原因，与负载无关**（B2，本会话读源码逐行确认【CODE_VERIFIED】）。samples.json 内 180 个样本、cpuMs 非空率 100%【MEASURED｜round-0/H1 等抽查】——数据已采样，基线对在错误时刻捕获。
3. **`1m loadavg X > 4 inside segment (§6.5 exclusion 1)`**：45/45 已记录段段内 max load1 ∈ [4.48, 7.11]，均值 5.90（含 pilot；非 pilot 40 段均值 5.97）（阈值 4.0，`runner.js:89,1913-1916`）——运行窗内宿主不满足 quiet-machine 纪律（B3）。负载来源未定位（UNKNOWN）。
4. **oracle 正确性失败 15.51%–21.06%**（PROTOCOL §4.2：整段作废）：round-0/H1 全量分类 = heartbeat 409×351（INVALID_STATE_TRANSITION 竞态）、takeUnchanged 被改写×218、login 401×50、takeFrozen deadline 断言×33、save* 回 ATTEMPT_ALREADY_SUBMITTED×74（saveAccepted 36 + saveStale 18 + saveReplay 14 + saveConflicting 5 + saveFuture 1）【MEASURED，逐行统计，复核轮修正初版 ~210/~60】。跨配置同量级、无遥测单调关系——逐文件违规计数中位数（口径：全部 46 个已落盘 ops.jsonl，含 pilot 与中断段 round-20/H2；复核轮修正初版均值口径错配）：W10-heartbeat H0 330 / H1 341 / H2 326 / H3 342 / H4 323；W08-take H0 239 / H1 260 / H2 249 / H3 252 / H4 233；W01-login 恒 50/文件；W03/W04-save H0 72 / H1 104 / H2 62 / H3 103 / H4 120——**与遥测形态无单调关系，指向 harness fixture × 后台 deadline scanner 竞态**（机制假说见 `COMPONENT-ATTRIBUTION.md` §4 B4，未证实）（B4）。

**统计后果**：有效配对 = 0 < 6 → 每个配置对判 UNKNOWN（PROTOCOL §6.4 `:206`）；"如实报 UNKNOWN，不得以 4–5 个配对出 PASS"（`:211-212`），禁止把 INCONCLUSIVE 写成 0%（§7.5 `:275`）。**T1–T4 全部无判定依据；T5/T6/T8/T10 在本实验内未完成或未执行。**

解除阻断路径（harness/协议层，均非产品代码修改）：见 `COMPONENT-ATTRIBUTION.md` §6（修 B2 → 解 B1 → 解 B3 → 解 B4 → Stage D–G 授权留痕 → 重跑）。

---

## 4. 性能主表（协议口径：配对相对增量 vs 同轮 H1）

主表按 ask 要求列出；**因 0 有效配对，全部 Δ/CI 单元无数据**。段落级 p50/p95/p99/RSS 原始值见 §5 探索表。

| Workflow | H0 | H1 | H2 | H3 | H4 | CPU Δ | p50 Δ | p95 Δ | p99 Δ | RSS Δ | CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W00 探针（health/ready） | — | 基线 | — | — | — | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED** |
| W01 认证/考试列表 | — | 基线 | — | — | — | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED** |
| W02 start（仅数据制备） | — | 基线 | — | — | — | 不计量 | 不计量 | 不计量 | 不计量 | 不计量 | 无 | NOT_APPLICABLE（计量外） |
| W03 答案保存 accepted | — | 基线 | — | — | — | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED** |
| W04 保存拒绝面 | — | 基线 | — | — | — | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED** |
| W05 Submit+Grade | — | 基线 | — | — | — | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED** |
| W06 中断与 Restore | — | 基线 | — | — | — | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED** |
| W07（编号空洞） | — | — | — | — | — | — | — | — | — | — | — | NOT_APPLICABLE（无定义） |
| W08 take 冻结对账 | — | 基线 | — | — | — | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED** |
| W09 deadline auto-submit | — | 基线 | — | — | — | 时间预算制，未跑 | 未跑 | 未跑 | 未跑 | 未跑 | 无 | **BLOCKED** |
| W10 heartbeat/disruption | — | 基线 | — | — | — | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED** |
| W11 retention | — | 基线 | — | — | — | 启动 pass 观测失效（fixture 被启动 pass 清空，notes "rows==0 after boot"） | — | — | — | — | 无 | **BLOCKED** |
| W12 password-reset/outbox | — | 基线 | — | — | — | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED** |
| W13 outbound HTTP | — | — | — | — | — | — | — | — | — | — | — | NOT_APPLICABLE（NOT_IMPLEMENTED） |
| W14 HTTP 失败路径 | — | — | — | — | — | — | — | — | — | — | — | NOT_APPLICABLE（不在本版混合，PROTOCOL §3） |
| W15 exporter/关机 | — | 基线 | — | — | — | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED**（关机计时背景见 §7） |
| **全局混合档**（aggregate 口径） | — | 基线 | — | — | — | `rows: []` | `rows: []` | `rows: []` | `rows: []` | `rows: []` | 无 | **BLOCKED** |

"无配对"＝该单元的 11 字段 aggregate 契约（`workflow, config, comparable, cpuDeltaPct, p50DeltaPct, p95DeltaPct, p99DeltaPct, rssDeltaMb, ciLow, ciHigh, n`，harness `README.md:74-75`【转引】）不存在任何实例。

---

## 5. 未配对探索性观测（明确声明：**非判定证据**）

以下数字来自 **无效段**（配额未完成、loadavg 超限、oracle 失败 15–21%、CPU 饱和域 ~100% 单核占用）。按 PROTOCOL §7.5，它们**禁止用于任何 H2/H4 vs H1 的开销推断与验收判定**；仅作机制方向参考与未来重跑的先验。计算方法（本会话；复核轮补齐口径声明）：`samples.json` 首末样本 cpuMs 差 ÷ ops（CPU ms/op）、÷ 窗长秒（单核占用 %）；分位数取 round.json harness 自计值；**剔除 pilot round-0**；**纳入中断轮 round-20/H1**（其样本窗完整 180s、181 样本，`samples.json` 实测，故 H1 列 n=7）；中断段 round-20/H2 无 round.json 结果与 samples.json，**不在任何列中**；中位数跨段统计；**未配对**（各配置来自不同轮次，无同轮 H1 配对）。表内 load1 列与本表其余列同口径（剔除 pilot 后重算，复核轮修正初版该列误用含 pilot 值）。

| 配置 | n | CPU ms/op（中位） | 单核占用%（中位） | p50 ms | p95 ms | p99 ms | 吞吐 ops/s | RSS max MB | 段内 max load1（中位） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H0 | 6 | 45.2 | 99.9 | 375.6 | 1348.7 | 1802.6 | 21.80 | 736.4 | 6.06 |
| H1（基线） | 7 | 45.4 | 100.0 | 373.8 | 1358.6 | 1825.9 | 21.79 | 848.5 | 5.86 |
| H2 | 6 | 46.9 | 101.1 | 364.9 | 1411.8 | 1862.4 | 21.52 | 801.8 | 5.61 |
| H3 | 6 | 46.6 | 100.4 | 369.7 | 1373.7 | 1857.5 | 21.34 | 791.1 | 5.79 |
| H4 | 6 | 50.3 | 101.2 | 418.9 | 1462.2 | 1953.2 | 19.97 | 795.2 | 5.94 |
| S0（ratio=0，仅 On 态语义） | 3 | 46.9 | 100.2 | 394.9 | 1378.5 | 1854.9 | 20.93 | 841.7 | 6.79 |
| S1（ratio=0.1） | 3 | 45.3 | 100.9 | 360.7 | 1370.3 | 1784.6 | 22.17 | 816.3 | 6.30 |
| S2（ratio=1） | 3 | 47.1 | 101.3 | 382.6 | 1368.8 | 1880.8 | 21.27 | 822.0 | 5.81 |

未配对点差（中位-对-中位，**不作判定**）：H0 vs H1 −0.3%；H2 vs H1 +3.3%；H3 vs H1 +2.7%；H4 vs H1 +10.8% CPU ms/op。

### 5.1 历史漂移与 OTel 增量分开陈述（ask 约束）

- **历史漂移（H1 − H0，跨 SHA `cb1e614f..1d689b4a`）**：该范围包含整个 OTel 战役（PR #973–#980）+ #994 修复 + 范围内其他提交（PROTOCOL §1.2），**不是单一修复的 A/B**。本实验未产出任何可用的 H1−H0 数字（0 有效配对）；探索点差 −0.3% 仅说明在饱和域内两 SHA 混合档吞吐/单核成本同量级，**不构成漂移测量**。H0 上不存在 On 态（PROTOCOL §1.2），"H0+On" 组合判 NON_COMPARABLE。
- **OTel 增量（H2/H3/H4 − H1，同 SHA）**：正式判定全 UNKNOWN（0 配对）。探索点差 H2 +3.3% / H3 +2.7% / H4 +10.8%（饱和域，见上）。历史背景（**转引**，PROTOCOL §7.4，PR #980 记录，pre-#994 与 fixed stack 0e82e087，非本实验）：On/no-export CPU 中位 **+10.4%**、On/full-OTLP 中位 **+9.1%**——双双超 ≤5% 预算 → 当时判 FAIL → NO_GO；steady p99 中位 +2.7%/+2.1%；`SAMPLE_RATIO=0` 无改善（成本在 plumbing）。本实验不预设复现或推翻该结论（§7.4）；两个结果（历史 FAIL 记录与本实验 UNKNOWN）同时呈报 Owner。
- **H4 − H2 差异的命名约束（ask 约束，遵守）**：H4 与 H2 之差**不得命名为"纯网络导出成本"**。H4 相对 H2 同时包含：batch span processor 出队/序列化/OTLP 编码、metric provider（H2 无 MeterProvider，`runtime.ts:373-394` 仅 otlp 分支【CODE_VERIFIED｜转引链】）、shutdownTelemetry flush 路径、以及与导出交互的队列背压效应；网络传输只是其中一段且本实验未采集字节/连接面（sink 仅计请求数）。任何"H4−H2≈网络成本"的读法都是归因越界。

---

## 6. 内存 / GC 发现

- **RSS（探索级，未配对，无效段）**：RSS max 中位 H0 736.4 / H1 848.5 / H2 801.8 / H3 791.1 / H4 795.2 MB；**45/45 段段末 RSS < 段内 max**；段末 RSS 全距 546.9–766.7 MB（round.json `rssMb` 字段口径；按 `samples.json` 末样本 `rssKb` 口径为 543.6–773.3；剔除 pilot 后两口径均不变，中位 633.1）——180s 窗内无单调增长形态，但窗口过短且段无效，**不构成斜率或长期稳定性证据**（复核轮修正：初版"~598–657 MB"不可复现，已改）。W7.2 历史 RSS +5~+16%（转引 §7.4）未被复测。
- **H3 memory ring**：ring 容量 1000、每 span ≤16 events（PROTOCOL §1.1）。7 个 H3 段（round-0..6）shutdown dump 全部 `h3DumpParsedOk=true`、`h3DumpSpans=1000`【MEASURED｜逐段 round.json】；抽读 `round-0/H3/telemetry-memory-dump.jsonl` = 1000 行 span 记录（traceId/spanId/parentSpanId/attributes，db.statement 行含 `exam.db.connection.role/outcome` 属性，无 SQL 文本/绑定参数）【MEASURED】。ring 有界性得到运行见证；其**成本**未隔离测量。
- **GC**：本实验**未采集任何 GC 指标**（无 `--expose-gc` 探针运行、无 v8 heap 统计通道）。C8 长事务内存稳定性探针（PROTOCOL §3.1：`--expose-gc` 专用 run，300 tx × 64KB，H0/H1 各一次）**未执行** → #994 探针对照（T10）无判定依据。**GC 面 = SKIPPED（未运行）**。
- **长稳内存判定（Gate 3 输入）**：INCONCLUSIVE——无长稳 run（最长观测 181s）、无 C8 探针、无 RSS 斜率统计。

---

## 7. exporter / 网络面 / 关机发现

### 7.1 sink 请求面（MEASURED，逐段 sinkCounters）

otlp-sink（`scripts/perf/otel-workflows/otlp-sink.js`，`--mode ok|reject|slow` 三态）全部段 `mode="ok"`、`delayMs=0`——**本实验未执行任何故障注入**（T8 未重跑）。

sink 计数按轮内累计（每轮内各段 dump 的是同一 sink 的累计值；证据：round-1 顺序 H2,H3,H4,H0,H1 → H4 段 dump 2484，其后 H0/H1 段 dump 恰同值 2484，精确相等排除了"每段独立计数"解释）。**轮内不变量：H4 段之后的所有 H0/H1/H2/H3 段对 sink 的请求数增量恒为 0**【MEASURED｜7 轮全部一致】：

| 轮（顺序） | H4 段贡献 | 其后段累计增量 |
| --- | --- | --- |
| round-0（H0,H1,H2,H3,H4） | 2452 traces + 6 metrics | （H4 为段尾） |
| round-1（H2,H3,H4,H0,H1） | 2478+6 | H0/H1 = 0 |
| round-2（H4,H0,H1,H2,H3） | 2485+6 | H0/H1/H2/H3 = 0 |
| round-3（H1,H2,H3,H4,H0） | 2497+6 | H0 = 0 |
| round-4（H3,H4,H0,H1,H2） | 2509+6 | H0/H1/H2 = 0 |
| round-5（H0,H1,H2,H3,H4） | 2504+6 | （H4 为段尾） |
| round-6（H2,H3,H4,H0,H1） | 2493+6 | H0/H1 = 0 |

- **Off/无导出态零遥测请求的正面信号**：H0（v0.0.15，无遥测代码，PROTOCOL §1.2【CODE_VERIFIED｜转引链】）、H1（Off）、H2（On/no-export）、H3（On/memory）在所有轮次中对 OTLP sink 的请求增量为零。**但 T5 正式验收未完成**：T5 要求 ≥30min 连接/发包审计（PROTOCOL §7.2），本实验段仅 180s 且段无效；sink 只覆盖 OTLP endpoint HTTP 面，不审计任意出站连接。→ T5 = **INCONCLUSIVE（部分正面信号，验收通道未执行）**。
- H4 段导出速率 ≈ 2452–2509 trace posts + 6 metric posts / 180s ≈ **13.6–14.0 posts/s**；字节量、payload 大小分布、collector 侧资源**均未采集**（sink 默认不 keep bodies）→ 全栈运行成本（Gate 2）无数据。

### 7.2 关机计时（背景信号）

全部 45 段 SIGTERM→exit **exit code = 0**、耗时 53–1222 ms（最大 round-4/H0 1222ms）【MEASURED｜逐段 shutdown 字段】——远小于 30s 预算（T9/ADR-028 表三业务行为行）。段无效使该观测不进正式验收，但作为 T9 方向性背景信号：**未见任何关机预算风险**。与 campaign 记录一致（挂死 collector 下整进程 exit 5.10–5.23s，`COVERAGE-MATRIX.md` §3-4【转引】）。

### 7.3 server-err.log

全部段 server-err.log 为 0 字节（round-0 H1/H2/H4 抽查 + 全 H4 段 grep 无命中）【MEASURED】——无 exporter 错误输出，与 `mode=ok`（无故障注入）一致。

---

## 8. 结论

1. **本实验 BLOCKED**：45 段 0 有效（B1 配额结构性不可完成 + B2 harness CPU 采样缺陷 + B3 quiet-machine 违反 + B4 oracle 失败），`rows: []`，T1–T4 预算判定全部 UNKNOWN。
2. **历史漂移（H1−H0）与 OTel 增量（H2/H3/H4−H1）均无本实验数字**；历史 PR #980 记录（转引）为唯一同族开销数据（+10.4%/+9.1%，超预算）；本实验未配对探索值（H2 +3.3% / H4 +10.8%，饱和域）方向与历史一致但**不作判定**。
3. 正面运行信号（非判定）：Off/无导出态零 OTLP sink 请求（7 轮不变量）；H3 ring dump 7/7 有界解析；全部段关机 exit 0 且 ≤1222ms。
4. GC/C8/#994 探针：未运行（SKIPPED）。
5. 解除阻断路径：`COMPONENT-ATTRIBUTION.md` §6（B2 修复最高优先低成本；B1/B3/B4 需协议修订与 Owner 裁决）。
