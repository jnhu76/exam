# PERFORMANCE-REPORT — 观测性工作流性能实验报告（裁决版）

- **裁决角色**：首席性能工程师（成本/价值最终裁决）。
- **协议哈希（双口径声明，复核轮修订）**：①全文件口径（`sha256sum` 实测）：PROTOCOL.md = `8bc7f7cdf06353b80d149336e492cbb41b0896a844a5781a34ee03fdee80df63`（与 ask 提供值一致）、PROTOCOL-v2.md = `7feefa72a81c12b6af8f34d8385565f6e878032ca9b882aed1721be92a204977`；②内容哈希口径（按修订日志约定"去除修订日志节"：`awk '/^### 修订日志$/{exit} {print}' | sha256sum`，本会话实测）：PROTOCOL.md = `4eddc21683a5fae17913e35a59dbbf7dab57ebdd3429d5c22619ed31d0fee5be`（= harness manifest `configs.json` 所钉值）、PROTOCOL-v2.md = `e07b39d18ed825785463aaf3f2d713d7eb69e230c83ac00d02c56fedab9b16ab`（= v2 修订日志自记值）。**两组值各自为真、口径不同；冻结正文未被篡改**，不得将 8bc7f7cd ≠ 4eddc216 误读为协议文件被改。版本裁决（v1 vs v2）未决，见 §2.3。
- **协议哈希（v4，当前生效预注册；v3 修订轮 2026-11-15 21:42 +08:00 追加）**：PROTOCOL-v4.md 全文件 `sha256sum` = `1605a7ca79ff5fef4554989b1f0cef8c5851f6bf89fb24b800aec3c883a55059`（本会话实测）；harness manifest `configs.json` protocol 钉已指 v4（`version="v4"`、内容口径 `6739a741…`=去修订日志节哈希，本会话实读）。**v1（全文件 `8bc7f7cd…`）/v2（`7feefa72…`）/v3（全文件 `b564ba6a…`）全文与哈希原样保留**（三者本会话 `sha256sum` 实测逐字节一致，未被任何后继会话改动）；**v4 为当前生效预注册**（Owner 2026-11-15 代理裁决选项 (c)：干扰口径重定义为外部增量，B_self=6.8 / 段内绝对上限 8.0 / 入口门 4.0 不变；全部条款留 Owner 复核，`PROTOCOL-v4.md:3,34-41`）。本文件 §1–§8 为 v1/v2 时点历史记录，原样保留不作回溯改写；**v3 结果只在 §9 分区呈报**。
- **数据源**：`out/otel-w964/workflow-audit/aggregate.json` 与 `rounds/`（v1/v2 章节；本会话自行读取）。**v3 数据源**：`out/otel-w964/workflow-audit-v3/aggregate.json`、`campaign-isolated/campaign.json`、`campaign-knee/campaign.json`、`campaign-knee/sweep-1/H1-c50/segment-summary.json`、`pilot.json`、`run-meta/`（v3 修订轮本会话自行读取；旧根 `workflow-audit/` 只读未触碰）。
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

1. **`steady window exceeded 180s before quota completion`**（PROTOCOL §3.3：配额未完成判段无效）：混合档权威配额 = **11000 ops/段**（R2-02 权威口径：`buildOpPlan` 只 push 16 个逐类键，`c4Rejects=1000` 是 c4 子类组总额、不重复计入；`PROTOCOL-v3.md:21`、HEAD `7a2de31e` `runner.js:1392-1420` 实证）——撰写时点按朴素 17 键求和得 12000，系把组总额重复计入的口径错误。`steadyMaxSeconds=180`、`concurrency=10`（撰写时点 manifest 锚点 `configs.json:30,33,35`）。45 段吞吐 19.31–23.05 ops/s → 完成 11000 ops 需 ~477–570s，最快段超窗 **≥2.65×**，结构性互斥（B1）。【v3 复核轮修正（2026-11-15）：初版按 12000 口径写 "~520–620s / 超窗 3 倍以上"，与本战役 R2-02 修正后的权威口径冲突，已按 11000 改写（数字修口径，不动原始段数据）；结构性结论不变。】
2. **`proc sampler produced no steady-window CPU pair`**：harness 采样时序缺陷——`await sleep(60)`（60ms）后即取 `cpuStart`，而采样 tick `PROC_SAMPLE_MS = 1_000`（`runner.js:87`）⇒ `samples` 必空 ⇒ `cpuStart` 必 `undefined` ⇒ 走 invalid 分支。**任何跑满 180s 的段都必然带此原因，与负载无关**（B2，逐行读源码确认【CODE_VERIFIED】）。samples.json 内 180 个样本、cpuMs 非空率 100%【MEASURED｜round-0/H1 等抽查】——数据已采样，基线对在错误时刻捕获。【v3 复核轮行号注记：下文锚点为撰写时点工作树行号（先于 HEAD 提交）：`sleep(60)`=:1858、invalid 分支=:1896-1904；HEAD `7a2de31e`（2026-11-15T11:02+08:00）实测对应 `:1866`/`:1911`（`PROC_SAMPLE_MS` 仍 `:87`；两时点间 8–12 行漂移成因未查，UNKNOWN）；R2-01 修复后现行工作树 `sleep(60)` 已移除，由 fail-closed 采样判定矩阵替代——机制本身经 HEAD 源码逐行复核成立。】
3. **`1m loadavg X > 4 inside segment (§6.5 exclusion 1)`**：45/45 已记录段段内 max load1 ∈ [4.48, 7.11]，均值 5.90（含 pilot；非 pilot 40 段均值 5.97）（阈值 4.0，`runner.js:89` 与 HEAD 一致；剔除判定块撰写时点 `:1913-1916`、HEAD 对应 `:1923`；现行工作树已按 v4 §2 改为绝对上限 8.0 + B_self=6.8，`runner.js:106,111`——本条为 v2 口径历史记录）——运行窗内宿主不满足当时 quiet-machine 纪律（B3）。负载来源未定位（UNKNOWN）。
4. **oracle 正确性失败 15.51%–21.06%**（PROTOCOL §4.2：整段作废）：round-0/H1 全量分类 = heartbeat 409×351（INVALID_STATE_TRANSITION 竞态）、takeUnchanged 被改写×218、login 401×50、takeFrozen deadline 断言×33、save* 回 ATTEMPT_ALREADY_SUBMITTED×74（saveAccepted 36 + saveStale 18 + saveReplay 14 + saveConflicting 5 + saveFuture 1）【MEASURED，逐行统计，复核轮修正初版 ~210/~60】。跨配置同量级、无遥测单调关系——逐文件违规计数中位数（口径：全部 46 个已落盘 ops.jsonl，含 pilot 与中断段 round-20/H2；save 口径 = saveStale/Replay/Conflicting/Accepted/Future/Invalid/Closed 7 类；take 口径 = takeUnchanged+takeFrozen；复核轮修正初版均值口径错配）：W10-heartbeat H0 330 / H1 341 / H2 326.5 / H3 342 / H4 323；W08-take H0 239 / H1 260 / H2 249 / H3 252 / H4 233；W01-login 各配置中位数恒 50/文件（46 文件中 44 个恰 50；例外：round-1/H0=17、round-0/H3=49）；W03/W04-save H0 72 / H1 104.5 / H2 62 / H3 103 / H4 120——**与遥测形态无单调关系，指向 harness fixture × 后台 deadline scanner 竞态**（机制假说见 `COMPONENT-ATTRIBUTION.md` §4 B4，后经 R2-03 行级坐实并修复）（B4）。【v3 复核轮修正（2026-11-15）：初版 heartbeat H2 写 326、save H1 写 104，系对中位数 326.5/104.5 向下截断而非四舍五入（46 文件全量复算），已改；初版"W01-login 恒 50/文件"逐字不成立，已改为"各配置中位数恒 50 + 例外明细"。】

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

以下数字来自 **无效段**（配额未完成、loadavg 超限、oracle 失败 15–21%、CPU 饱和域 ~100% 单核占用）。按 PROTOCOL §7.5，它们**禁止用于任何 H2/H4 vs H1 的开销推断与验收判定**；仅作机制方向参考与未来重跑的先验。计算方法（本会话；复核轮补齐口径声明）：`samples.json` 首末样本 cpuMs 差 ÷ ops（CPU ms/op）、÷ **样本跨度秒**（单核占用 %——分母为 `samples.json` 首末样本时间差，中位 ~179.0s（实测 179.034s）；**非** `round.json` `wallSeconds`（中位 ~180.8s，实测 180.796s；以之为分母单核占用系统性低 0.54–1.07pp——逐配置中位差复核轮重算实测）；本表单核占用列以跨度分母逐值精确复现【v3 复核轮复算】）；分位数取 round.json harness 自计值；**剔除 pilot round-0**；**纳入中断轮 round-20/H1**（其样本窗完整 180s、181 样本，`samples.json` 实测，故 H1 列 n=7）；中断段 round-20/H2 无 round.json 结果与 samples.json，**不在任何列中**；中位数跨段统计；**未配对**（真实原因 = 45 段全部无效、0 有效段，无任何同轮 H1 配对可用——轮次结构本身每轮配置齐备：round-1..6 每轮含全部 H0–H4、round-101..103 每轮含全部 S0–S2，`rounds/*/round.json` `order` 实测）。表内 load1 列与本表其余列同口径（剔除 pilot 后重算，复核轮修正初版该列误用含 pilot 值）。【v3 复核轮修正（2026-11-15）：初版"各配置来自不同轮次，无同轮 H1 配对"前半句与轮次事实不符（同轮配置齐备，见上），已改；初版"÷ 窗长秒"措辞与实际分母（样本跨度）不符，已改并注明两种分母的差异。】

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

sink 计数按轮内累计（每轮内各段 dump 的是同一 sink 的累计值；证据：round-1 顺序 H2,H3,H4,H0,H1 → H4 段 dump `requests {traces: 2478, metrics: 6}`，其后 H0/H1 段 dump 恰同值（逐段 `rounds/round-1/round.json` sinkCounters 实测）——精确相等排除了"每段独立计数"解释）。**轮内不变量：H4 段之后的所有 H0/H1/H2/H3 段对 sink 的请求数增量恒为 0**【MEASURED｜7 轮全部一致】。**v3 复核轮修正（2026-11-15）：初版 prose 写 "2484"，与本文 §7.1 表格行（2478+6）及原始 sinkCounters 不符——2484 实为 `statusCodes {"200": 2484}` 的总 HTTP 请求计数（=2478+6），requests 拆分为 2478 trace + 6 metric，已改；不变量本身成立。**

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

---

## 9. v3 章节（R2 修复与重跑；PROTOCOL-v3/v4 分区，2026-11-15 21:42 +08:00）

> **分区纪律**：本节只呈报 `out/otel-w964/workflow-audit-v3/` 分区的 v3 结果。§1–§8 的 v1/v2 无效段（45 段 0 有效）**原样保留、不回溯翻案**（PROTOCOL-v4 `:3`），其数字**只作参考不作判定**；本节判定依据只来自 v3 分区本会话实读产物。

### 9.1 v3 数据源、协议与 harness 状态（MEASURED）

- **协议**：manifest `configs.json` protocol 钉 v4（`version="v4"`、内容哈希 `6739a741…`）【MEASURED｜本会话实读】；PROTOCOL-v4 全文件 sha256 `1605a7ca79ff5fef4554989b1f0cef8c5851f6bf89fb24b800aec3c883a55059`【MEASURED｜`sha256sum`】。定参：P_CONC=1、P_STEADY=300、P_QUOTA=2100（逐键等比缩放）、B_entry=1.24、B_self=6.8、段内绝对上限 8.0、外部增量限 1.5、入口门 4.0 不变（`configs.json` `workload.steadyMaxSeconds=300/concurrency=1` 实读一致）。
- **harness 修复已落地**（R2-01/02/03/04/06 + v4 §7 判据）：selftest 23/23 全 PASS（`PROTOCOL-v4.md:131` 附录 A.3 记录；本会话未重跑 selftest【转引｜落盘记录】）。
- **aggregate 现状**：`out/otel-w964/workflow-audit-v3/aggregate.json`（generatedAt 2026-11-15T12:45:53.316Z，官方 `runner.js aggregate` 产物，run-meta `1794746753316-pid432896-aggregate.json` 同秒）——`rows: []`，`workflows = ["mixed","iso-C1","iso-C3","iso-C5"]`，内嵌注记 `"no rounds found under …/workflow-audit-v3/rounds — nothing to aggregate"`；`rounds/` 目录为空【MEASURED｜本会话实读 + `ls`】。as-built 原因：`cmdAggregate` 只读 `ROUNDS_DIR`（`runner.js:5201-5244`），campaign 单元聚合桥（PROTOCOL-v3 §6.5(a)）未落地 → campaign 段不进聚合。
- **freeze.json 不存在**（`run-meta/freeze.json` 缺席，`ls` 实测）——v4 §6 程序序的冻结标记未到达，正式预注册采样未启动。
- **H0 等价性登记（§6.6-3）未定稿**：`h0-equivalence.json` 不存在；仅存 3 份 superseded 中间证据（run1/run2/run3-partial；run3 在用户中断前留下 H0/H1 各 2100 ops、0 oracle 违例、终态字段一致（submitAuditDelta 172/172、deadlineSubmitted 116/116、hotReceiptsTotal 211/211）的 verified-pair 证据，run4 因 Docker Desktop 关闭 `connect ECONNREFUSED 127.0.0.1:5432` 即死，`BLOCKED-20261115-hostside-docker-desktop-shutdown.md:9-24`【MEASURED｜文件实读；其中 gh/宿主检查为该会话执行，本会话未复跑】）。

### 9.2 v3 campaign 执行状态（MEASURED，逐 campaign.json 实读）

| 套件 | 有效配对（validPaired 口径） | 逐单元实况 | 证据 |
| --- | --- | --- | --- |
| **mixed** | **0** | 全程零段启动：预检门拒绝（唯一拒绝项 = H0 §6.6-3 register 缺失，门 6/7 过；`BLOCKED-…md:34-36`）；无 `campaign-mixed/` 目录、`rounds/` 空【MEASURED】 | run-meta `1794745651376` 等多次 `campaign --suite mixed` 调用记录 |
| **isolated** | **0** | **51 个已记录段全部无效**，精确分解 = **49** `SEED_CONVERGE_DB_UNREACHABLE`（`connect ECONNREFUSED 127.0.0.1:5432`，Docker Desktop 关闭窗；sweep-1..5 全部 45 段 + sweep-6 的 4 段）+ **1** `SEED_CONVERGE_DB_STARTING`（sweep-6/H1-iso-C1：`PostgresError: the database system is starting up`）+ **1** `CPU_PAIR_FAIL_CLOSED`（sweep-6/H2-iso-C1：seed 收敛**成功**、steady 窗 0.64s 完成 382 ops / 0 errors，因稳态窗样本 <2 fail-closed 作废——与 DB 不可达无关）；另 27 次 entry-gate defer（按 sweep 分布 6×3 / 7×9 / 8×9 / 9×6；loadavg 4.39×12 + 4.04×15，均 > 4.0 入口门；defer 不产生段目录——`campaign.json` notes 逐条计数实测）+ 9 次 starved（每单元 1 次）；valid 全 0【MEASURED｜`sweep-*/H*/segment-summary.json` 逐段分类（51/51）+ `campaign.json`（totalAttempts 72、totalDeferrals 27）+ `data-v3/segments.jsonl` 重算一致】 | generatedAt 2026-11-15T12:32:33.737Z（sweep-6 段落盘至 20:28–20:32 +08:00） |
| **knee** | **0** | 6 单元（H1/H4 @ c50/c100/c200）：**H1@c50 恰 1 个 valid 段**；H1@c100、H1@c200、H4@c50/c100/c200 valid=0（原因 `starved by repeated interference recheck failures`；大量 entry 门 defer：`1m loadavg 4.01 > 4 at entry`）→ 配对 0【MEASURED｜`campaign-knee/campaign.json` 全量实读】 | generatedAt 2026-11-15T12:45:53.255Z |

> 【v3 复核轮修正（2026-11-15）：初版 isolated 行写"9 单元 × 8 attempts 全部 ECONNREFUSED"，为对 MEASURED 记录的过度概括——51 段中 49 段 ECONNREFUSED、1 段 DB-starting、1 段 CPU-pair fail-closed（该段 seed 收敛成功且 0 errors），已按逐段分类改写；valid=0 与裁决不变。】

**knee 的 1 个 harness-valid 段（唯一有效段，逐字段实读 `campaign-knee/sweep-1/H1-c50/segment-summary.json`）**：`valid:true`、ops=2100（= P_QUOTA，300s 窗内完成）、errors=0 / errorRate=0（oracle 零违例）、cpuMsPerOp=**96.2619**（CPU 配对通道存在——B2/R2-01 修复生效的直接运行见证）、p50 4963.4 / p95 10858.3 / p99 12168.2 ms、吞吐 9.81 ops/s（`throughputSemantics: closed-loop` 显式标注）、rssMaxMb=2527.33、maxLoad1=5.64、externalLoadIncrement=**−1.16**（v4 §2 双判据通过）、`expiredInProgressAtWindowEntry=0`（B4/R2-03 窗入口守卫生效）、shutdown exit 0 / 7045ms、sinkCounters.requests={}（H1=Off 零 OTLP 请求，与 v1 §7.1 不变量一致）。notes 中 `W11: retention startup pass deleted the ≥30d fixture (rows==0 after boot)` 仍复现（W11 fixture 与 retention 启动 pass 时序问题未修）【MEASURED】。

**该段的定性（重要，不得升格）**：它是 **knee 梯度档的 harness-valid 侦察段**，**不是**预注册正式采样单元——freeze.json 缺席（v4 §6 第 3 步未到达）、knee 聚合机器路径 §6.5(b) 未落地（`aggregateCore` 同键覆盖/as-built 恒 mixed 维度，`PROTOCOL-v3.md:207`）、且为无配对的 H1 基线单段。**它不产生任何预算判定数字**；其价值是证明 R2 harness 修复（CPU 采样 fail-closed、配额口径、oracle 所有权、窗入口守卫）在真实 boot 下成立。

### 9.3 每工作流成本矩阵（v3，源自 `workflow-audit-v3/aggregate.json`）

aggregate 契约 11 字段（`workflow, config, comparable, cpuDeltaPct, p50DeltaPct, p95DeltaPct, p99DeltaPct, rssDeltaMb, ciLow, ciHigh, n`）在本分区**零实例**（`rows: []`，MEASURED）。Δ 单元格无数据；**"无配对"＝该单元不存在 aggregate 行**（其缺席本身为 MEASURED）：

| Workflow | H0 | H1 | H2 | H3 | H4 | CPU Δ | p50 Δ | p95 Δ | p99 Δ | RSS Δ | CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mixed（C1–C7 混合流） | 0 段（register 缺失，零段启动） | 0 段 | 0 段 | 0 段 | 0 段 | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED**（H0 register 缺失 → 套件拒绝启动） |
| iso-C1（health 隔离） | 不适用（H0 进 isolated 被门拒绝，`PROTOCOL-v3.md:194` item 7） | 0/8 有效 | 0/8 有效 | 不适用 | 0/8 有效 | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED**（valid=0；本单元 17 段 = 15 UNREACHABLE + 1 DB_STARTING（H1，sweep-6）+ 1 CPU_PAIR_FAIL_CLOSED（H2，sweep-6，seed 收敛成功）——非全部 ECONNREFUSED，见 §9.2） |
| iso-C3（save-accepted 隔离） | 同上 | 0/8 有效 | 0/8 有效 | 不适用 | 0/8 有效 | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED**（valid=0；本单元 16 段全部 UNREACHABLE） |
| iso-C5（submit-grade 隔离） | 同上 | 0/8 有效 | 0/8 有效 | 不适用 | 0/8 有效 | 无配对 | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED**（valid=0；本单元 18 段全部 UNREACHABLE） |
| knee 梯度（H1/H4 @ c50/c100/c200；campaign-only，aggregate 无此维度） | 不适用（同上拒绝） | **1 段 valid（H1@c50 基线）** | 不适用 | 不适用 | 0/8 有效（c50） | 无配对（且 §6.5(b) 落地前封锁） | 无配对 | 无配对 | 无配对 | 无配对 | 无 | **BLOCKED**（配对 0；拐点不可判定） |
| **aggregate 汇总行** | — | — | — | — | — | `rows: []` | `rows: []` | `rows: []` | `rows: []` | `rows: []` | 无 | **BLOCKED**（n=0 < 6，全部指标 UNKNOWN，PROTOCOL §6.4） |

**campaign 有效数（ask 口径，逐字如实）**：**mixed=0 / isolated=0 / knee=0**（validPaired=各单元 valid 最小值：knee 的 1 个 H1@c50 valid 段不构成配对，min(1,0,0,0,0,0)=0）。历史 v1/v2 数字（§4/§5）只作参考不作判定。【v3 复核轮定义注记（2026-11-15）：**"min over units" 是 as-built 实现定义**（`packaged-stats.mjs:188-196` 自注 "PERFORMANCE-REPORT §9.2 口径"、`stats-output.json` `campaignValidPaired={0,0,0}` 同源），**不是** PROTOCOL-v3 §6.5(a)/§6.3 的协议配对语义（逐 (suite, workflow, gear, config) 同 sweep 同档位 vs 同轮 H1 配对）——本数据集两个定义同值 0；一般情形可分叉（例：H1@c50 与 H4@c50 各 1 有效段时，协议配对口径=1、min-over-units=0）。knee 的 1 个 H1@c50 valid 段在两个定义下都不构成配对（无处理臂有效段 + §6.5(b) 封锁）。】

### 9.4 v3 指标等级清单（每指标 MEASURED / UNKNOWN / SKIPPED）

| 指标 | 等级 | 依据 |
| --- | --- | --- |
| CPU 配对采样通道（首末样本对） | **MEASURED**（通道存在） | knee H1@c50 `cpuMsPerOp=96.2619`——B2/R2-01 修复后首例 harness-valid CPU 差分【MEASURED】 |
| CPU time/op 配对增量（H2/H3/H4 vs H1） | **UNKNOWN** | 有效配对 0 < 6（PROTOCOL §6.4 `:206`）；禁止出 PASS、禁止写 0% |
| p50/p95/p99 配对增量 | **UNKNOWN** | 同上；单段分位（H1@c50 4963/10858/12168 ms，closed-loop C=50 语义）仅侦察参考【MEASURED｜单段】 |
| RSS 单段 | **MEASURED** | knee H1@c50 rssMaxMb=2527.33（C=50 档，与 v1 C=10 档 ~800MB 不可直接比较，档位不同） |
| RSS 斜率/长稳稳定性 | **UNKNOWN** | 无长稳 run；单段无斜率 |
| 吞吐（closed-loop） | **MEASURED**（单段） | 9.81 ops/s @c50；探针阶梯 ŷ 9.7–11.3 ops/s 全档后端饱和（`PROTOCOL-v4.md:28`）【转引｜v4 会话实测，本会话未复跑】 |
| oracle/错误率 | **MEASURED** | errors=0、oracle 违例 0（B4/R2-03 修复后首例干净段） |
| 干扰判据（v4 口径） | **MEASURED** | maxLoad1=5.64 ≤ 8.0、externalLoadIncrement=−1.16 ≤ 1.5、entry 门 defer 记录在 campaign notes |
| GC / C8 / #994 探针（T10） | **SKIPPED** | 无 `--expose-gc` 探针运行（目录普查，`run-meta` 无探针调用） |
| exporter 字节面 / collector 资源（G2 输入） | **SKIPPED** | v3 无 H4 valid 段；sink 只计请求数；`docker stats` 干扰监测未执行 |
| T5（≥30min 网络零面）/ T5b / T6 / T8 / T9 正式验收 | **SKIPPED**（T9 有单段背景信号：exit 0 / 7045ms < 30s） | 正式采样未启动；T8 无注入（sink 全程 mode=ok） |
| S 子矩阵（采样率敏感性） | **SKIPPED** | v3 §3.5 显式收缩，不在采样面 |
| knee 拐点判定 | **UNKNOWN** | 1/6 单元、无 H4 梯度点、§6.5(b) 封锁 |

### 9.5 v3 结论

1. **v3 campaign 全部三套件有效配对 = 0**（mixed=0/isolated=0/knee=0）：mixed 被预检门正确拒绝（H0 §6.6-3 register 未定稿——fail-closed 语义按设计工作）；isolated 51 个已记录段全无效（49 ECONNREFUSED + 1 DB-starting + 1 CPU-pair fail-closed；27 defer + 9 starved，见 §9.2）；knee 拿到 **v3 战役首个 harness-valid 段**（H1@c50，oracle 0 违例、CPU 对齐、v4 干扰判据通过）但仅基线单段，无配对。
2. **T1–T4 预算判定维持 UNKNOWN**；历史 PR #980 数字（+10.4%/+9.1%，§5.1 转引）与 v1 探索值（§5）**只作参考不作判定**。
3. **正面机制见证（非判定）**：R2-01/02/03 修复 + v4 判据在真实 boot 下产生了全战役第一个 `valid:true` 段；`expiredInProgressAtWindowEntry=0`、oracle 0 违例、entry 门对 loadavg 4.01 的 defer 行为正确（INCIDENT 记录确认为 Docker Desktop 恢复期负载峰，真阳性）。
4. **解除条件收敛为一条链**：完成 §6.6-3 H0 等价登记（≥3 verified pair/workload，续 run3 已有 1 对）→ 写 `run-meta/freeze.json` → 确认段 → 正式采样 ≥6 有效配对 → `aggregate`（需 §6.5(a)/(b) 机器路径落地）→ 方可产出 §9.3 矩阵的真实 Δ/CI。
