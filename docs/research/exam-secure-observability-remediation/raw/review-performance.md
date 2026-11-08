# §review 性能裁决官审查 — performance/ 方法论与候选改动机器工作增量

- 裁决人角色：独立性能裁决官（只读审计；本文件为本阶段唯一新增产物，位于 `.tmp/secure-correlation-audit/review/`）。
- 审查对象：`.tmp/secure-correlation-audit/performance/`（RESULTS.md、raw/、scripts/、logs/、state-*.json）+ 仓库源码核对（master=423f2945d9feef73a5413e498fb2772cc245c754）。
- 审查日期：2026-11-08。git 跟踪文件零改动（`git status --short` 仅会话前已存在的 `?? test-results/`）。

## 0. 我实际执行的检查（命令级）

1. **raw CSV ↔ RESULTS.md/summary/snapshots 一致性重算**：用 node 从 `raw/bench.csv` 144 行独立重算每格（4 变体×4 场景×3 并发）中位数、极差离散度、Δvs A、12 配置快照中位——与 `raw/summary.csv`（48 行）、`raw/snapshots.txt`、RESULTS.md §快照/§分场景逐项比对。
2. 完整性检查：144 格（4×4×3×3）无缺失（重算脚本输出 `missing cells: none`）。
3. 执行日志核验：`logs/run-bench.stderr` 158 行——单次无中断运行 21:44:00Z→22:22:16Z，12 个配置全部有 warmup 标记，`grep -c "already measured"` = 0（无 resume 跳过）。
4. 脚本精读：`run-bench.sh`、`load.mjs`、`aggregate.mjs`、`run-devnull.sh`、`uuid-bench.mjs`、`unit-canary-c.mjs`（经 `raw/unit-canary-c.snippet.txt` 快照）。
5. 变体有效性证据核验：`logs/smoke-headers.txt`、`raw/unit-canary-c.out.txt`（含 LEAK_COUNT）、`raw/http-canary-c.txt`、`raw/httperr-c8-perrep.txt`、`raw/devnull-summary.txt`、`raw/bench-devnull.csv`、`raw/uuid-bench.txt`、`raw/cleanup.txt`、`raw/db-create.txt`、state-a.json（64 candidates）。
6. 源码核对（SOURCE_VERIFIED）：`apps/api/src/server.ts:107-113`（genReqId UUIDv4 / requestIdHeader:false）、`apps/api/src/config/runtimeConfig.ts:710-713`（e2e 限流结构性关闭）、`apps/api/src/routes/clientEvents.ts:31-46`（现状 normalizeRouteForStorage）、`packages/db/src/schema/pg.ts:1105-1172`（client_events 索引全集）、`packages/db/src/schema/pg.ts:1070-1085`（audit_logs）。
7. 409 占比重算：从 bench.csv status_counts 逐行统计 answers 场景各变体各并发 409 比例。

## 1. 数据一致性核对结果（必做项）

**结论：原始数据与报告完全一致，未发现任何编造或选择性呈现。**

- 48 行 summary.csv 的每格中位（rps/p50/p95/p99/respB/logBPerReq/cpuMsPerReq/pg_xact_per_req）与我从 bench.csv 的重算**逐格全等**（脚本输出 `summary mismatches: none`）。
- 快照表重算全等：A 185.2/42.0/47.0/491.0，B 187.6/41.1/46.9/491.0，C 188.3/40.4/45.1/490.9，D 187.7/41.3/47.0/490.9。
- respB 增量重算：B 各配置 +51.1~+54.7B（中位 52.0），D +51.3~+55.6B（中位 52.0），C 中位 0.0（逐配置 −1.1~+4.5B 均为响应混合内容波动，非头差异）。
- 分场景数字全部复现：logB/req（answers 522、reject 1091≈2.09×answers、httperr 460、events 451–452；变体间 Δ≤0.1%）；xact/req（answers≈4.0、reject≈3.8、events≈2.8、httperr≈0.7）；CPU（answers A 5.23–5.95 vs B/C/D 4.90–5.67）；D@reject,c=50 −4.71%/@离散度 13.9%；events c=1 离散度 12.0–14.4%；httperr c=8/50 变体 +5.0~+11.9%。
- devnull 汇总复核：file-sink 中位取自主 bench（answers,8,a 182.24→182.2 ✓；events,8,a 407.91→407.9 ✓），devnull 侧中位取自 bench-devnull.csv 3 rep 重算相符。

**发现的三处报告级不准确（均不动摇结论）**：

| # | RESULTS.md 原文 | 实测 | 影响 |
|---|---|---|---|
| R1 | §已知局限 3：「answers c=50 有 ~2% HTTP 409」 | 409 占比 4.3–5.0%（c=1/8/50 全部如此，四变体同分布逐格复算） | 归因（背景扫描竞争）未证实但合理（c=1 单 worker 也有 ~4.9%，排除了 worker 间冲突）；四变体同分布成立，对比有效性不受影响 |
| R2 | §分场景：「httperr……B/C/D 系统性 +5~+12%」 | c=8/50 为 +5.0~+11.9%；c=1 仅 +1.2~+2.6%（噪声内） | 共模偏差结论不受影响（排除依据是 C 零改动路径同幅 + 逐 rep 顺序无关，二者我均复核成立）；表述范围略宽 |
| R3 | §分场景：「B/D 每响应精确 +51~55B」 | 每响应头行增量**恰为 53B**（`x-request-id: `15 + UUID 36 + CRLF 2）；51~55B 是含响应混合比例波动的**每请求均值** | 「确定性增量」的结论正确；均值与每响应值的混述属措辞不严谨 |

## 2. 方法论评估（六维）

| 维度 | 事实 | 裁决 |
|---|---|---|
| 样本量 | 每格 3×12s（共 36s）+ 中位/极差离散度；全局声明「>±3% 差值不声称可分辨」；确定性量（respB/logB）不受样本量约束 | **足以支撑其声称的结论**。负结果（无可测开销）的分辨下限≈各格离散度（0.8–14.4%），报告按格如实披露且结论措辞未超出噪声带；events c=1（12–14%）分辨率差但已明示 |
| 预热 | 每配置 4×6s（每变体各 6s 于该 场景×并发）；stderr 日志证实 12 配置全预热、无 resume 跳过；每测量新起客户端进程但变体间对称 | **充分**（JIT/连接池/DB 缓冲均在测量前就位；客户端冷启动对四变体对称） |
| 重复测量 | 3 rep 交错 + rep 轮转起始变体（a 得位置 1/4/3，非完全平衡但充分打散时序漂移）；httperr 逐 rep 分析证明与时序无关的 per-process 系统差并正确排除该场景 | **充分**；httperr 排除论证（C 在该场景零代码改动仍 +9.59%，schema 校验层 400 不进 handler——我核对了 load.mjs 场景定义与 clientEvents.ts 验证顺序）成立 |
| 并发覆盖 | 1/8/50（单考生真实 → 饱和）；c=50 p50~270ms 进入 DB 写饱和区 | **对 LAN 考试拓扑充分**；单进程客户端同机限制已如实披露（局限 2），对 DB 绑定场景（answers/reject/events）影响小 |
| 日志受限场景 | 独立 /dev/null pass（重启同 env 契约、c=8、answers+events、3 rep 交错），结果 −4.2%~+5.1% 方向不一致 | **正确标注 INCONCLUSIVE**。弱点：单并发两场景、answers 内四变体全负（−1.1~−4.2%）呈场景内一致方向但无机制解释；「Pino stdout ≤1.9k rps 非瓶颈」只能作弱推断，报告未越界声称 |
| 环境规格 | 全记录（WSL2/5800H 8C/16G/Node 24.22.1/端口 3201-3204/每变体独立 worktree+exam_ci_perf_{a-d} 独立库/APP_MODE=e2e 限流关闭/扫描压噪一致）；我核对 runtimeConfig.ts:710-713 证实 e2e 下 rateLimit.enabled=false | **充分**。两点补充：(1) 测量拓扑为 dev 模式（tsx watch），绝对值不代表生产构建，相对增量因四变体条件同一而有效——RESULTS.md 已记录拓扑但未作为局限点名；(2) 变体 B/C/D 的源码 diff 随 worktree 清理未留档（仅 C 有 sha256 快照 + RESULTS.md 文字描述），精确复现需重构 diff |

指标采集本身：延迟为客户端 hrtime 全链路（含排队，负载测试标准做法）；respB 为重建线字节（增量用途可靠）；logB 为 stat 文件差（窗口对齐）；CPU 为 /proc jiffies（10ms 粒度已披露）；pg 为 pg_stat_database 累计差——**元组计数跨窗口错记已诚实标 INCONCLUSIVE（PG 异步 stats flush），xact_commit 趋势使用正确**。

**总裁决：performance/ 的证据链与报告纪律支撑其全部结论性主张；无需要推翻或降级为 INCONCLUSIVE 的度量（pg 元组与 sink 对比两处已由作者自行标注）。**

## 3. 候选改动机器工作增量（独立评估）

### #864 route 存储

- **A 维持现状**：零机器工作，但泄露已被证实（本次 perf 实验自身即为证据：`raw/http-canary-c.txt` 中变体 A 库存 `/password-reset/EXAMAUDIT-CANARY-PERF-a`、`/admin/exams%3Ftoken%3D…`、`EXAMAUDIT-CANARY-PERF-a@host/path`）。
- **B 投影模板**：实测的 gate 变体（root allowlist）在目标路径（events 10 事件批）及全部场景吞吐/p95/p99/CPU/xact 均无可测开销。逐事件增量 = 根段切片 + Set 查找 + 1 次 decode + 2 次正则 + 500 截断；完整参数化（已知根后动态段参数化）是同量级纯字符串工作（保守估计合计 <10µs/事件，对比 events 路径 2.3–2.9ms CPU/req，<0.5%），**该部分为 INFERRED（未直接测量）但受噪声下限约束必然不可分辨**。不新增 DB 写、不新增日志行；参数化模板与原路径长度同量级，存储字节无实质变化。不需要新抽象——扩展现有 `normalizeRouteForStorage`（#875 已建边界）即可。
- **C 有限 category/name**：机器工作为 B 的严格子集（root→category 映射后即止，无 decode/正则尾巴）。未单独测量，子集论证成立。
- **D 完全停存**：机器工作与存储字节双最小（删除每事件 normalize 调用与 route 列写入）。性能视角无任何反对；取舍在时间线信息价值（他线）。

### #865 请求关联

- **B 仅 SaveAnswer 头**：每请求 1 次 `reply.header()` + 53B 头行，与 C 同成本类，覆盖 1 条路由。
- **C 全站响应头**：实测（perf-B 即此选项）：**+52.0B/响应（中位，确定性）**；DB 绑定场景吞吐/延迟/CPU 全部在 ±3% 噪声带内；**日志字节 Δ≤0.1%（无新增日志行）、pg xact 零增量（无新增 DB 写）**——满足候选清单的硬约束「复用 request.id、不新增 ID 生成或 Correlation Service、不因响应头新增持久化 client_event」。`genReqId` UUIDv4（实测中位 103.3ns，sink 记录在案）是 A/B/C/D 共同存量成本，非 C 的新增。onSend 单次 header 设置为亚微秒级属 INFERRED，但其上界被噪声带（±3%）封顶。
- **D SaveAnswer 响应体加 requestId**：~50B 体序列化 + 双向 schema 校验 + 契约（@exam/contracts）变更；机器工作与头同量级，覆盖却只有 1 条路由——同代价下严格劣于 C 的响应头（头零解析成本、零契约变更、全站覆盖）。性能/最小机器工作视角无理由选 D。
- 约束提醒：若实现 C，onSend hook 内**不得**新增日志调用（实测零日志增量的前提），否则破坏「+52B 封顶」的代价模型。

### 调查工作流

- **基线（stdout/Pino + jq/时间窗/运维脚本）**：已被 correlation 阶段 live 验证可用（pb-s1：reqId 直查 2 行命中 0 误关联 + attemptId pivot + DB 归属核验）；产品侧机器工作为零；日志增长已被本实验量化（中位 491B/req；reject 因 #861 WARN ×2.09）。**继续作为默认。**
- **新增只读索引**：`packages/db/src/schema/pg.ts:1141-1172` 显示 client_events **已有 5 个复合 b-tree 索引 + 1 个唯一索引**（org+received_at / org+kind / org+attempt / org+exam / org+name / unique(org,user,eventId)）。events 热路径每请求 10 行 INSERT，是 DB 写密集路径（xact≈2.8/req，CPU 2.3–2.9ms/req）。第 7 个索引会为每次遥测批上报增加逐行索引维护——**未测量、且现有 (org, received_at) 已覆盖时间窗查询形态**。这正是「以罕见管理查询的热路径写放大换查询便利」，性能视角拒绝；若未来重提，须用同一 harness 做 A/B。
- **调查端点 / 管理 UI**：查询路径成本（读查询 + 权限裁决 + 每次调查查询的审计行写入，有界且非按考生请求发生），不触热路径；在候选清单所列门禁（Permission/租户/投影/限速/查询行为审计）满足且限速下，性能不是阻碍——但两者均未被测量，本次不授 GO。

## 4. 独立裁决

| 项 | 裁决 | 依据（一句话） |
|---|---|---|
| 864-A | NO_GO | 零性能收益挽留一个已实证的泄露面（http-canary 直证） |
| 864-B | GO | 目标路径实测零可测开销；完整参数化为同量级纯字符串工作（INFERRED 但被噪声带封顶）；须警惕实测 gate 变体≠完整实现 |
| 864-C | GO | B 的严格工作子集，未测但子集论证成立 |
| 864-D | GO | 机器工作与存储双最小；取舍在关联价值非性能 |
| 865-A | DEFER | 性能与 C 无可分辨差异，性能视角无区分度，由关联价值裁决（他线已证 200 响应无 requestId 载体） |
| 865-B | GO | 与 C 同成本类、更小覆盖；性能可接受 |
| 865-C | GO | 实测 +52B/响应、日志 Δ≤0.1%、DB 零增量、噪声带内；三条硬约束全满足 |
| 865-D | NO_GO | 同成本类却仅覆盖 1 路由 + 体序列化 + .strict() 契约变更；机器工作最小性劣于 C |
| investigation-baseline | GO | live 验证可用，产品侧零成本 |
| investigation-index | NO_GO | 第 7 索引叠加在 6 索引、10 行/请求的 DB 写密集热路径上，未测量的写放大 |
| investigation-endpoint | DEFER | 查询路径成本有界不触热路径；须满足清单门禁并自测查询成本后方可 GO |
| investigation-ui | DEFER | 同上，另加管理端渲染成本 |

- **issue864：GO**（性能非阻碍；条件：实现必须是完整 864-B 参数化——实测 gate 变体留有 2 条残余通道，见 §5-F4）。
- **issue865：REOPEN_RECOMMENDED**（性能视角：曾可成立的成本顾虑已被测量消除——+52B/响应、零日志/DB 增量、噪声带内；重开的正面理由来自关联阶段的 200-无-requestId 缺口证据，本裁决确认性能不再构成反对）。
- **performanceVerdict：PASS**（对已测候选：无可测回归，确定性代价 +52B/响应封顶；范围限定：dev 模式绝对值、未测候选不在此裁决内）。

## 5. 审查发现明细

- **F1（CONFIRMED, low, performance）**：bench.csv 144 行完整（4×4×3×3 无缺格），48 格聚合与快照数字与我独立重算逐格全等——报告无编造、无选择性呈现。`review/performance.md` §1；重算脚本内联于本审查过程。
- **F2（CONFIRMED, low, performance）**：方法论六维（样本量/预热/重复/并发/日志受限/环境规格）足以支撑「无可测开销」类结论；作者对分辨下限、INCONCLUSIVE 项（pg 元组、sink 对比）的披露诚实。§2。
- **F3（CONFIRMED, low, performance）**：httperr 场景 +5~12% 判为环境共模偏差的论证成立（C 零改动路径同幅 +9.59%；逐 rep 与执行顺序无关；我复核 load.mjs 的 400 请求在 schema 层拒绝、不进被改 handler）。`raw/httperr-c8-perrep.txt`、§1。
- **F4（REFUTED, medium, privacy）**：主张「实测 C 变体（root-gate）足以阻断全部 route 泄露通路」被打破：`raw/unit-canary-c.out.txt` 明确记录 `LEAK_COUNT: 2`——RT-11（`https://evil.example/exam/<canary>`→`/exam/<canary>`）与 RT-15（`/exam/take/<canary>` 原样入库）证明已知根之后的任意客户端字符串仍被持久化。RESULTS.md 正文未披露此计数（仅 raw 留痕）。性能结论（该类清洗零开销）仍成立并可外推到完整参数化；但**安全完备性不成立**——864-B 施工必须包含动态段参数化，并以该 21 用例矩阵为验收。
- **F5（CONFIRMED, low, performance）**：865-C 等价变体机器增量封顶为每响应 1 次 header 设置 + 53B 头行；日志字节 Δ≤0.1%、pg xact 零增量——候选清单三条硬约束（复用 request.id/不新增持久化/不新增 ID 生成）全部满足。`raw/bench.csv` log_bytes 与 pg 列、§3。
- **F6（CONFIRMED, medium, performance）**：client_events 已带 5 复合+1 唯一共 6 索引（pg.ts:1141-1172，SOURCE_VERIFIED），events 热路径 10 行 INSERT/请求为 DB 写密集——新增调查索引=未测量的每行索引维护写放大，性能视角 NO_GO。§3。
- **F7（REFUTED, low, performance）**：主张「answers c=50 409 占比 ~2%」与实测不符：4.3–5.0%（各并发、四变体同分布）。「四变体同分布」成立故对比有效，但归因（背景扫描）未证实（c=1 单 worker 亦 ~4.9%）。§1-R1。
- **F8（CONFIRMED, low, baseline）**：stdout/Pino→文件 vs /dev/null 的 sink 对比 −4.2%~+5.1% 无一致方向——「日志写非瓶颈」只可作弱推断，作者已如实标 INCONCLUSIVE；基线工作流维持可用。`raw/devnull-summary.txt`、§2。
- **F9（CONFIRMED, low, performance）**：测量拓扑为 dev 模式（tsx watch）+ 客户端/服务端同机——绝对值不代表生产构建；四变体条件同一故相对有效；RESULTS.md 记录了拓扑但未列为局限。§2。
- **F10（CONFIRMED, low, correlation）**：B/C/D 变体源码 diff 未随证据留档（worktree 已清；仅 C 有 sha256 快照+行数描述），精确复现需按 RESULTS.md 重构——复现性缺口，建议未来实验保留 `git diff` 产物。`raw/cleanup.txt`、§2。
- **F11（CONFIRMED, low, performance）**：每响应头行增量恰为 53B（15+36+2 算术 + 观测均值 51.1–55.6B 聚拢）；RESULTS.md「每响应精确 +51~55B」系均值/每响应值混述，不影响「确定性增量」结论。§1-R3。
- **F12（CONFIRMED, low, baseline）**：清理纪律合格——worktree 全清、master 全程未动（首尾 status 一致）、审计库保留未删符合 runbook L4；`exam-naming-cleanup` worktree 为会话前已存在（非本实验产物）。`raw/cleanup.txt`。
