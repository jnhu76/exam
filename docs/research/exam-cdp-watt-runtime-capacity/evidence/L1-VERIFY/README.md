# L1-VERIFY 验密曲线（#900/#1021 容量战役 · G2/L1）

冻结协议：`../PROTOCOL.md`（SHA256 `442f0ec6…`，冻结基线 `87510894`）。
执行日期：2026-11-19/20。全部产物在本目录；主工作树全程 clean。

## 0. 结论速览（全部为实测，来源见 §3 台账）

**隔离 verify（直接调 `verifyPasswordOrDummy`，真实库取哈希，argon2id m=65536,t=3,p=4，每点 5 run × N=600，A/A≤1.1%）**

| C | 吞吐/s | CPU/op | 时长 p50/p99(max) ms | 平均忙线程 | VmHWM |
|---|---|---|---|---|---|
| 1 | 24.4 | 55.5ms | 40.7 / 48.4 (51.5) | 1.36 | 323MB |
| 2 | 35.1 | 87.2ms | 56.7 / 67.6 (71.6) | 3.06 | 338MB |
| 3 | 38.6 | 148.1ms | 77.4 / 89.5 (92.2) | 5.71 | 401MB |
| **4** | **41.8（平台）** | 202.4ms | 95.6 / 111.8 (112.3) | 8.48 | 465MB |
| 8 | 41.5 | 204.0ms | 192.9 / 214.3 (215.0) | 8.47 | 466MB |
| 16 | 40.8 | 209.2ms | 390.9 / 424.4 (447.0) | 8.55 | 465MB |
| 32 | 40.4 | 211.7ms | 790.9 / 828.2 (909.6) | 8.57 | 465MB |

- 吞吐在 **C=4 封顶**（41.8/s = 4 libuv 槽 × 1/95.7ms 争用时槽时长），此后零增长；
  C>4 的时长增长是纯排队（每翻倍 ≈ ×2）。
- 原生执行并发（可观测代理）：饱和时平均执行中哈希数 = 41.6/s × 95.7ms ≈ **3.98 ≈ 4**（=libuv 槽位上限，`UV_THREADPOOL_SIZE` 未设=默认 4）；C=4 的 maxInFlight=4；进程平均忙线程 8.5（argon2 内部 p=4 lanes 的线程也在烧 CPU）。
- **CPU/op 从 55.5ms（C=1）膨胀到 ~202-212ms（C≥4，3.7 倍）**：槽位间争用使单位哈希成本大增（效率：8.5 核只换来 1.71 倍吞吐）。膨胀机制（内存带宽/缓存/调度）**未归因**——L1 未装相应计数器，CPU 曲线不足以确诊（协议要求如实标注）。

**完整 HTTP login（经真实 nginx，T-DIRECT 每考生独一源 IP，闭环 C 并发 × N=200，每 run 完整 R1 重置+fresh API/JWT；快模式 run = 前后固定负载探针均 ≥21/s，n=5/点）**

| C | 成功吞吐/s | RTT p50/p99(max) ms | CPU/成功（活跃窗口） | API VmHWM | 429/401/丢样 |
|---|---|---|---|---|---|
| 1 | 18.6 | 52.5 / 79 (109) | 61.7ms | 321MB | 0 |
| 2 | 29.8 | 66 / 99 (102) | 84.8ms | 386MB | 0 |
| 3 | 34.9 | 85 / 107 (131) | 131.1ms | 449MB | 0 |
| **4** | **38.5（拐点）** | 102 / 126 (139) | 219.8ms | 513MB | 0 |
| 8 | 40.9 | 192 / 228 (246) | 263.6ms | 513MB | 0 |
| 16 | 41.1 | 377 / 447 (486) | 212.9ms | 513MB | 0 |
| 32 | 41.1 | 757 / 858 (879) | 209.5ms | 514MB | 0 |

- 60 个 HTTP run（r1-r10×5 点 + C=2,3×5）全部 `{'200': 200}`——**零 429（每 IP 恰 1 次 login，限流预算内）、零 401、零网络失败、零 driver 丢样**；DB oracle 每 run 恰 200 login.success / 200 独立考生 / 200 独立 IP。
- 拐点：边际收益 1→2 +59%、2→3 +18%、3→4 +10%、4→8 +6%、>8 ≈0；p50 从 102ms（K=4）到 192ms（K=8）翻近一倍只换 6%。
- 登录路径 **native-hash-bound**：HTTP 平台 41.0/s ≈ 隔离平台 41.8/s；主线程 ELU 代理（主线程 CPU/墙钟）C=32 仅 18.3%，event-loop 每秒窗口 p90 中位 1.5-2.7ms、max ≤110ms（未饱和）。nginx 增量时延 p50=0ms/max=4ms。
- RSS：C≥4 比 C=1 高 ~192MB ≈ 4×64MiB 原生哈希工作集（VmHWM 精确高水位；每 run fresh API 使读数独立）。

## 1. 环境模式事件（T4 排查记录，全保留）

首轮 HTTP r1-r5（无探针）出现 1.5-1.6× 整机降速段（C=1 p50 52→79ms；API CPU/成功同比例膨胀，pool/EL 无排队信号）。按 T4 排查：
- 机制探针（`L1-PROBE-env-*`，固定负载 argon2 C=1）：reset 后立即 24.12/s vs 冷机 23.55/s vs 60s 后 24.24/s → **非 reset/PG 风暴所致**；当时环境处于快模式。
- 归因：宿主侧（WSL2 与 Windows 共享物理机 i7-12700H）间歇降速/争用——**外源性，未再细分（未归因）**。
- 处置（协议 T4 允许的复测路径）：runner 增加前后固定负载探针（`<run-id>-envprobe-pre/post`），r6-r10 复测全快模式；探针值与 run 一同归档。慢模式 run 全部保留在台账（unprobed 组），正式读数取快模式 n=5。

## 2. 判据与口径

- offered=N（计划 login 数）；四级计数在 samples.jsonl；成功=DB oracle（fresh 库 ⇒ 计数即本 run）。CPU/成功 分子=活跃窗口 API 进程 `/proc/<pid>/stat` utime+stime（全线程）增量，分母=DB 独立成功数。
- 排队 vs 原生执行（分别标注）：原生 solo 执行=C=1 p50 40.7ms（隔离）；饱和槽内执行≈95.7ms（C=4 p50，4 槽全忙无排队）；C>4 的逐 op 时长−槽内执行≈排队（模型估计，非直接观测）。PG 池等待：postgres.js 3.4.9 未暴露 pending（快照 observedFields=[]）→ **NOT_DIRECTLY_OBSERVABLE（进程内）**，L1 未跑 pg_stat_activity 采样；间接证据（argon2 在查询间不占连接、RTT 可全由槽位排队解释）不构成直接观测。
- elDelay：本 VM ~11ms 计时粒度地板（G1 实证），超地板尖峰为真阻塞。

## 3. run 台账

正式：`L1-VERIFY-iso-c{1,2,3,4,8,16,32}-r{1..5}`（35）+ `L1-VERIFY-http-c{1,2,3,4,8,16,32}-r{1..10}`（70，r6-r10 含 envprobe 前后 run 目录）。Pilot：`L1-PILOT-*`。机制探针：`L1-PROBE-env-*`、`smoke-isolated-c1`。每 run 目录含 samples.jsonl / run-summary 或 driver.json / oracle.json（HTTP）/ api-sampler.jsonl + api-summary + api-research-snapshots（HTTP）/ run-meta.json / cmd.sh / nginx-access.log（HTTP）。SHA256 清单：`manifest-sha256.txt`。

## 4. 交接（candidateK / μ → L3 pilot-lock）

- **candidateK（按拐点+吞吐排序）**：`[4, 2, 8]`——K=4 在拐点上（38.5/s ≈ 平台的 94%，p50 102ms）；K=2 是效率优先备选（29.8/s ≈ 73% 平台，CPU/成功 84.8ms 仅为 K=4 的 39%）；K=8 是吞吐上限备选（+6% 吞吐，p50 ×1.9）。最终单一主值由 L3 pilot 按 §4 锁定（本目录不写 pilot-lock.md）。
- **μ（混合流量下登录服务率试算）**：准入段 μ ≈ K=4 时 38.5/s、平台上限 41/s（=4 槽 × 1/95.7ms 结构上限，非核数上限：饱和仅烧 8.5/20 核）。混合流量中保存/心跳不占 argon2 槽（无哈希），共享主线程（ELU≤18%）与 PG 池（max 10，未观测到等待但未直接观测）→ μ_login 混合下预计仍 38-41/s，除非主线程/PG 先饱和（G1 混合 pilot P2·S24 login p99 101ms 与 2-3 并发水平吻合）。Q 试算（Q=⌈μ·W⌉−K）：W=2s,K=4 → ⌈77⌉−4=73（校验点 100）；W=5s → ⌈192⌉−4=188（校验点 200）。

## 5. 已知限制

1. 快/慢环境模式由探针判别（阈值 21/s ≈ 基线 87%）；r1-r5 无探针只能按吞吐双峰事后分组，已单列不作正式读数。
2. CPU/op 膨胀机制、慢模式事件根因：未归因（无频率/带宽计数器；WSL2 不暴露 cpufreq）。
3. PG 池等待无进程内观测（见 §2）；如需直接证据须加 pg_stat_activity 采样器（后续实验可补）。
4. HTTP 组每 run 重置 ~15s、API 为 fresh 进程（含冷 JIT）：读数代表冷启动稳态窗口（N=200 足以摊平，快模式 A/A ≤2.7%）。
5. 隔离组与 HTTP 组不同 N（600 vs 200）：吞吐为速率可比；p99 样本量分别为 600/200，已随数同报。

## 6. 2026-11-20 会话复验（结果提交会话）

L2 中断后 SUT 重建（topology rebuild 2026-11-20 03:47 CST）的同一冻结 SHA（`87510894`，协议哈希 `442f0ec6…` 复核一致）上，独立复验既有证据并补 2 轮确认 run（不并入 §0 正式 n=5 统计）：

- **完整性复核**：`sha256sum -c manifest-sha256.txt` 1405/1405 OK；105 个正式 run 全部 oracle 通过（0 dropped / 0 login.failure / 200 独立考生 + 200 独立 IP / 每 run）；neutrality 测试重跑 4/4 绿（`pnpm -C .wt-capacity --filter @exam/api exec vitest run src/lib/capacityResearch.neutrality.test.ts`）。
- **独立复算**（不经 l1-analyze.py，直接从 samples.jsonl）：iso-c4 r1-r5 thr=41.62–41.95/s、p50 94.8–95.7ms、maxInFlight=4；http-c4 r6-r10（fast）thr=37.97–38.99/s、oracle 200/200——与 §0 表一致。
- **确认 run**：`L1-CONFIRM-iso-c4-r1`（C=4,N=600）thr=39.79/s、p50=99.9ms、cpu/op=217.1ms、busyThreads=8.64、verifyFalse=0；`L1-CONFIRM-http-c4-r1`（C=4,N=200,reset=1）verified=200/200、thr=34.19/s、p50/p99/max=115/155/163ms、oracle 200/200 独立考生+IP、driver CPU max 5.6% 单核（T6 过）。环境探针 C=1：21.74 / 22.04 / 21.44/s ≈ 快模式基线 89-92%（边界模式）。
- **判读**：确认 run 绝对值为正式系列的 ~89-95%，与探针比例（21.74/24.43=88.9%）成比例——拐点/平台结构（C=4 封顶 ≈ 4×libuv 槽、C>4 纯排队）复现，绝对值随 §1 已记录的外生宿主模式漂移。采样后已 `topology.sh reset`（fresh API pid 2290962，405 users/11 exams/24 questions，四项健康检查 OK），主工作树 clean。
- **口径勘误（CPU/成功列）**：§0 HTTP 表的 CPU/成功列 C=4/8 行（219.8/263.6ms）为 n=10 混合中位数（含 unprobed 慢段），与同表其余列的"快模式 n=5"口径不一致；快模式 n=5 中位数为 C=4=176.4ms、C=8=211.9ms、C=16=209.3ms、C=32=208.8ms（C=1/2/3 行本就是 fast n=5：61.7/84.8/131.1ms）。快模式平台段 HTTP CPU/成功 ≈ 209-212ms，与隔离组饱和 CPU/op（202-212ms）同量级收敛；两口径均保留于 analysis.json（`cpuPerSuccessActiveMs` n=10 与 fast 过滤重算见本节复验脚本输出）。
