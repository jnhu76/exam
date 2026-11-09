# 性能实验结果（PERFORMANCE-RESULTS）

- 轮次：secure-correlation-audit（终稿交付物 7/10）
- 本文为 `performance/RESULTS.md` 的定稿呈现（内容一致，经独立性能裁决官逐格重算核对，见 `review/performance.md` §1）；原始 SHA `423f2945d9feef73a5413e498fb2772cc245c754`（A 变体即 master，B/C/D 为其上最小 diff，4 个 detached worktree @ /tmp/wt-perf-{a..d}，已清理）。
- 执行窗口：2026-11-07T21:44Z→22:22Z（主基准）+ 22:24Z→22:30Z（/dev/null pass）。

## 1. 变体定义与有效性验证（全部 live）

| 变体 | 实现 | diff | 有效性验证 |
|---|---|---|---|
| A | master 现状 | 无 | — |
| B | 全局 `x-request-id` 响应头：`onSend` hook 复用 `request.id`（genReqId UUIDv4），零存储 | server.ts +8 行 | logs/smoke-headers.txt：3202/3204 全响应带头（server 生成 UUID），3201/3203 无头 |
| C | `normalizeRouteForStorage` 最小清洗：opaque/非特殊 scheme→null → 已知 SPA route-root allowlist（wire 形态首段，防 %2F/%3F 伪造 root）→ 单次 decode 后再剥 [?#] → 控制字符剥离 → 500 截断；未入表一律 null | clientEvents.ts +41/−13 行 | 单元级 21 用例 + HTTP 级真实 server+PG（raw/unit-canary-c.out.txt、http-canary-c.txt） |
| D | B + C | 两文件 | 叠加 |

**重要限定**：C 是 #864-B 完整参数化方案的**门变体（root allowlist）**——对已测 canary 全 null，但按定义「合法 SPA 路由原样保留」意味着已知根下的任意尾段仍是客户端字节落库通道（性能裁决官 F4：unit-canary `LEAK_COUNT: 2`，RT-11/RT-15 类）。性能结论（该类清洗零开销）可外推到完整参数化；**安全完备性不成立，施工必须含动态段参数化并以 canary 矩阵验收**。

## 2. 环境规格（RESULTS.md §环境；性能裁决官核对 runtimeConfig.ts:710-713）

| 项 | 值 |
|---|---|
| OS / CPU / 内存 | WSL2 linux 6.18.54；AMD Ryzen 7 5800H 8 vCPU；16 GB（每变体 tsx worker ~145 MB RSS） |
| Node | v24.22.1（client 与 server 同机同版本） |
| API 拓扑 | 每 worktree `pnpm --filter @exam/api dev`（tsx watch），APP_MODE=e2e（限流结构性关闭），端口 3201–3204 |
| 数据库 | exam-dev-db-1 容器 PostgreSQL 18.4，单容器多库 `exam_ci_perf_{a,b,c,d}`，各自 migrate+seed:e2e |
| 背景噪声 | HEARTBEAT_TIMEOUT_MS=600000、SCAN_INTERVAL=60000（4 变体一致） |
| 负载 | scripts/load.mjs（node:http keepalive、无新依赖、4 变体同一脚本同一机器交错执行） |
| 场景 | answers 70%（版本化协议写）+ replay 15% + GET 10% + heartbeat 5%；reject（baseVersion 超前，全部 accepted:false+WARN）；httperr（404/400 轮转）；events（10 事件批/请求，C 的目标路径） |
| 档位/重复 | 并发 1/8/50；每配置 4×6s 预热 + 3×12s 测量；变体交错且 rep 轮转起始变体；中位 + 极差/中位离散度 |
| UUID 微基准 | crypto.randomUUID() 200k×5：中位 103.3 ns/op（41.2–159.3） |

## 3. A/B/C/D 指标表（12 配置中位，raw/snapshots.txt；裁决官独立重算逐格全等）

| 变体 | rps 中位 | p95 中位 | p99 中位 | respB 增量/请求 | Pino B/请求 |
|---|---|---|---|---|---|
| A（现状） | 185.2 | 42.0 ms | 47.0 ms | 0 | 491.0 |
| B（X-Request-Id 头） | 187.6 (+1.3%) | 41.1 ms | 46.9 ms | **+52.0 B**（每响应头行恰为 53B=15+36+2；52.0 为含响应混合的均值中位） | 491.0 |
| C（route 清洗门变体） | 188.3 (+1.7%) | 40.4 ms | 45.1 ms | 0.0 B | 490.9 |
| D（B+C） | 187.7 (+1.3%) | 41.3 ms | 47.0 ms | **+52.0 B** | 490.9 |

分场景（相对 A）：answers +0.3~+2.9%（CPU 差 ≤0.5ms 方向不一致，在 jiffy 10ms 粒度+GC 波动内）；reject ±2.2% 内；events（C 目标路径）全部落在 12–14% 离散度噪声带内；httperr B/C/D +5~+12% **判为环境共模偏差不可归属代码**（C 该场景零代码改动仍 +9%，逐 rep 与执行顺序无关）——该场景绝对值不用于结论。Pino 字节/请求：answers 522、reject 1091（#861 WARN 使 ×2.1）、httperr 460、events 451–452，变体间 Δ≤0.1%。pg xact/req：answers≈4.0 / reject≈3.8 / events≈2.8 / httperr≈0.7，四变体一致（C 不改 DB 交互）。

## 4. 置信区间与 INCONCLUSIVE 项（如实）

| 量 | 置信度 | 说明 |
|---| --- | --- |
| 响应字节增量（B/D +52B、C 0） | **高**（确定性：算术 53B/头行 + 观测均值 51.1–55.6B 聚拢） | — |
| 吞吐/延迟/CPU「无可测开销」 | **中高** | 每配置 3 重复中位、4 变体交错、单配置离散度 0.8–14.4%；全局声明 **>±3% 差值不声称可分辨**；events c=1（12–14%）分辨率差已明示 |
| pg 元组级读写 | **INCONCLUSIVE** | PG 异步 stats flush 跨 12s 窗口错记；xact_commit 趋势可信 |
| 日志 sink（file vs /dev/null） | **INCONCLUSIVE** | 差值 −4.2%~+5.1% 方向不一致（本地 ext4 缓冲写下 ≤1.9k rps 内 Pino 不构成瓶颈只可作弱推断） |
| 完整参数化投影 CPU（864-B 全量） | **INFERRED**（未直接测量） | 同量级纯字符串工作：估计 <10µs/事件 vs events 路径 2.3–2.9ms CPU/req（<0.5%），被 ±3% 噪声带封顶必然不可分辨 |

裁决官复核发现的三处报告级不准确（不动摇结论）：①「answers c=50 有 ~2% 409」实为 4.3–5.0%（四变体同分布，对比有效）；②httperr「+5~+12%」在 c=1 仅 +1.2~+2.6%（噪声内）；③「每响应精确 +51~55B」系均值与每响应值（恰 53B）混述。已在本定稿表格中修正表述。

## 5. 结论（与 RESULTS.md §结论 一致，经裁决官确认）

1. **B（全局 X-Request-Id 响应头，即 865-C 实测等价物）**：代价 = 每响应确定性 +53B 头行（均值 +52B）+ onSend 一次 `reply.header()`（亚微秒级 INFERRED，上界被噪声带封顶）；DB 绑定场景吞吐/延迟/CPU 变化全在 ±3% 噪声带内；日志字节与 DB 计数零变化。满足候选硬约束：复用 request.id、不新增 ID 生成/Correlation Service、不新增持久化 client_event。**约束提醒：onSend 内不得新增日志调用**，否则破坏「+52B 封顶」代价模型。
2. **C（route 投影清洗）**：目标路径与其余全部场景无可测开销；逐事件增量 = 根段切片 + Set 查找 + 1 次 decode + 2 次正则 + 截断。
3. **D=B+C**：代价可加，无交互放大。
4. 复现：`bash .tmp/secure-correlation-audit/performance/scripts/run-bench.sh`（144 测点原始数据 raw/bench.csv；裁决官从该 CSV 独立重算 48 格聚合与快照逐格全等，`summary mismatches: none`）。

已知局限（RESULTS.md §已知局限 + 裁决官补充）：测量拓扑为 dev 模式（tsx watch）+ 客户端同机——绝对值不代表生产构建，四变体条件同一故相对有效；B/C/D 源码 diff 未随 worktree 清理留档（仅 C 有 sha256 快照，复现性缺口 F10）；审计库 `exam_ci_perf_{a..d}` 按 runbook L4 保留未删。
