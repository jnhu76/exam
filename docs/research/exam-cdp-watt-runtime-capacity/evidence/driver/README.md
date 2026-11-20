# G1.2–G1.4 负载 driver（协议回放 + 开放式到达 + 来源拓扑 + 余量验证）

run 系列前缀 `G1-*`；全部产物在 `runs/<run_id>/`。冻结基线
`87510894728ee1ca20a530fc20e29fa1f51709b7`（协议 PROTOCOL.md §0）。
所有命令在 `cwd=/home/hoo/Source/exam` 下原样可执行（协议 §13 cmd.sh 契约）。

## 0. 结论速览

| 项 | 结论 | 证据 run |
| --- | --- | --- |
| 协议回放保真 | 两条流（A happy-path / B 刷新恢复）按 replay-spec `observedApiCalls` 的真实线缆节拍机械回放；心跳间隔实测 p50=**30001ms**（规格 30001）；改答链 clientSeq 1→2 / baseVersion 0→1；B 的 in-flight 遥测 POST 复刻“刷新中止”（发出后 40ms 销毁） | `G1-PILOT-full-direct-P2-S24-r4`（390/390 发出，387 verified + 3 个设计内 aborted） |
| 业务终态 DB oracle | 24/24 graded、submission_reason=manual、每 attempt 恰 12 条评分 entry、答案=最后接受版本、dupActive/dupTerminal=0 | `r4/oracle.json` |
| T-DIRECT（可区分来源） | **双侧核对通过**：driver 绑定 172.28.10.10+k → nginx access log `$remote_addr` 与 Fastify 审计 `ip_address` 逐一相同（24 考生 24 个独立 IP） | `G1-IP-DIRECT-sanity`、`r4/oracle.json`（distinctIPs=24） |
| T-SHARED（共享出口） | 全批同一出口（172.28.10.3）：login limiter 10/60s/IP 拒绝（8×200+5×429，固定窗语义吻合）；**全局 100/60s/IP 同样按共享 IP 计**——12 人全流程仅 5 人完整走完（2 login 429 + 19 global 429） | `G1-IP-SHARED-r2`、`G1-PILOT-full-shared-P1-S12-r1` |
| driver 余量（T6） | P2·S200·全混合节拍（3200 op/240s）：offered=sent=response=verified=**3200/3200**、丢样 0、发射滞后 p50=0/p95=1/**p99=3ms**（max 20）、driver CPU avg 2.63%/max 38.6%（单核口径；≈宿主 0.13%）、RSS 83MB | `G1-EMITCAL-direct-P2-S200-r3` |
| 同刻突发（P3）平台上限 | 200 op 同一毫秒：发射滞后 p99≈210ms；**4 进程分片各 100 op 并行不改善**（p99 126–172ms）→ 序列化在 Docker Desktop 容器网桥（vpnkit），非 driver CPU/单进程瓶颈（emit 同步段仅 ~9ms/200 op，CPU<40% 单核） | `G1-BURST-CEILING-witness/witness.log` |
| UI 透明性 | **已验证**（无浏览器能力缺口）：真实浏览器 2 考生全流程 UI 断言全过（保存 chip=已保存、刷新恢复回显、结果分）；endpoint mix 与规格逐项一致（探针缩短驻留致其未发出 heartbeat×1/client-events×3，driver 全量回放这些调用） | `G1-UIPROBE-r2/ui-probe.json` |

## 1. 拓扑修正记录（as-built 缺陷 → 修正，G1.3 核对的直接产物）

**发现**：G1.1 存档的 topology.md 声称“客户端源 IP 穿透两层到达审计”。本轮双侧核对实测推翻：

1. 本环境是 **Docker Desktop**（`host.docker.internal=192.168.65.254`，vpnkit）。
   nginx→API 这一跳在 API 侧 socket 对端是 **127.0.0.1**（api.log `remoteAddress` 实测），
   不在 `TRUSTED_PROXY_CIDRS=172.28.10.0/24` 内 → Fastify 不采信 XFF →
   **所有经 nginx 的客户端 `request.ip` 坍缩为 127.0.0.1**（G1.1 审计两行
   ip=127.0.0.1 即此，非“穿透”）。
2. 宿主机经 published port 127.0.0.1:8080 的连接在 nginx 侧 `$remote_addr`
   一律为 **172.28.10.1**（vpnkit SNAT）→ #550 的 127.0.0.k loopback 绑定手法
   在“必须经实际 nginx 容器”拓扑下不可用。

**修正**（均为研究 harness 所有权内的接线修正，产品默认不动）：

- `harness/topology.sh`：`TRUSTED_PROXY_CIDRS=172.28.10.0/24,127.0.0.1`
  （把 vpnkit 回环跳列为受信代理；nginx 仍以 `$remote_addr` **覆盖** XFF，
  driver 不发送 X-Forwarded-For——无伪造头）；新增 `api-restart` 子命令
  （只重启 API 不重建库，保播种世代）。
- `sources.sh`：driver 容器 `exam-cap-driver`（node:24.22.3-bookworm-slim，
  NET_ADMIN）接入 `exam-cap-net`，eth0 加 ≤200 个辅助 IP（172.28.10.10..209），
  每考生 socket 绑定独一源 IP —— **真实内核 socket 对端**。T-DIRECT 的 driver
  直连 nginx 容器 172.28.10.2:80（Host/Origin 仍为公共 origin 127.0.0.1:8080）；
  T-SHARED 不绑定（源=容器唯一 IP 172.28.10.3）。

修正后双侧观测链（T-DIRECT）：

```
driver bind 172.28.10.1k ──socket──▶ nginx $remote_addr=172.28.10.1k
nginx(172.28.10.2) ──vpnkit──▶ API socket peer 127.0.0.1 ∈ trusted
→ Fastify request.ip = XFF = 172.28.10.1k（limiter key 与审计同源）
```

核对命令与输出（`G1-IP-DIRECT-sanity`）：

```bash
awk '{print $1}' runs/G1-IP-DIRECT-sanity/nginx-access.log | sort | uniq -c
#   3 172.28.10.10 / 5 172.28.10.11 / 3 172.28.10.12（nginx 侧）
docker exec exam-dev-db-1 psql -U exam -d exam_550_e2e -tAc \
 "SELECT u.username,a.ip_address FROM audit_logs a JOIN users u ON u.id=a.actor_id \
  WHERE action='login.success' ORDER BY a.created_at DESC LIMIT 3"
# cap9same-c0002|172.28.10.10 …（Fastify 侧，逐一相同）
```

## 2. 文件

| 文件 | 职责 |
| --- | --- |
| `driver.mjs` | 零依赖回放 driver：从 `../g1-traces/replay-spec.json` 的 `observedApiCalls`（tRelMs/method/path）机械推导每流相对时间线（锚点=login POST），开放式定时发射；四级计数（计划到达/实际发出/取得响应/取得正确会话或终态）与时刻；自监控 CPU/事件循环/滞后/丢样。热路径写容器本地盘，结束由 run.sh docker cp 归档 |
| `sources.sh` | driver 容器与辅助源 IP 生命周期（`up [--sources N]`/`down`/`status`） |
| `run.sh` | 一键运行：topology 健康→新鲜考生切片（查 DB 排除已有 attempt）→容器内执行→docker cp 归档→截取 nginx 窗口日志 |
| `oracle.ts` | DB durable oracle（login 审计/IP、attempt 终态/归属/评分 entry、receipts 链 vs driver 最后接受值、双不变量） |
| `ui-probe.ts` | 真实浏览器 UI 探针（Playwright，经 published 入口）：A/B 各 1 考生全流程 UI 断言 + endpoint mix 对比 |
| `runs/<run_id>/` | `schedule.jsonl`（到达表，可 `--schedule=` 复放配对）、`samples.jsonl`（每 op 一行四级记录）、`driver-metrics.jsonl`（500ms 采样）、`driver.json`（汇总）、`oracle.json`、`nginx-access.log`、`candidates.json`、`run-meta.json` |

## 3. 启动方式（cwd=/home/hoo/Source/exam）

```bash
# 前置一次性（拓扑与来源池；幂等）
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/topology.sh up
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/topology.sh api-restart   # 应用 TRUSTED_PROXY 修正
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/driver/sources.sh up --sources 200

D=/home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/driver

# 正式形态全流程（T-DIRECT·P2·窗口 240s = 协议 §3 预注册形态）
bash $D/run.sh --run-id=<id> --scenario=full --topology=direct --n=200 \
  --profile=p2 --window-ms=240000 --tail-ms=30000 --flow=mix --b-share=0.1 --seed=9001021 --from=2

# DB oracle（同轮）
pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx $D/oracle.ts --run=<id>

# 发射能力标定（全部 op→公共 GET，隔离 SUT 成本）
bash $D/run.sh --run-id=<id> --scenario=emit-cal --topology=direct --n=200 \
  --profile=p2 --window-ms=240000 --tail-ms=30000 --flow=mix --b-share=0.1 --seed=9001021

# UI 探针（2 名未消耗考生；≤10/60s 共享登录预算内）
pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx $D/ui-probe.ts \
  --candidates=<idxA>,<idxB> --run-id=<id>

# 收尾（辅助 IP 随容器 netns 消失，无宿主残留）
bash $D/sources.sh down
```

配对实验（协议 §9.3）：同一 `--seed` 与参数生成相同到达表；或
`--schedule=runs/<前轮>/schedule.jsonl` 逐 op 复放（opId 序一致性校验内置）。

关键参数：`--scenario=full|login-only|emit-cal`；`--topology=direct|shared`；
`--profile=p1|p2|p3`（p1 均匀+抖动 / p2 ≥80% 入尾 30s / p3 同刻 ≤5ms 抖动）；
`--flow=a|b|mix`、`--b-share`；`--from`（manifest 切片起点；run.sh 自动跳过已消耗考生）。

## 4. run 台账（含失败轮，全部保留）

| run | 参数 | 结果 | 备注 |
| --- | --- | --- | --- |
| `G1-IP-DIRECT-sanity` | login-only direct n=3 p3 | 3/3 login 200 | 双侧 IP 核对通过（172.28.10.10/11/12） |
| `G1-IP-SHARED-r1` | login-only shared n=13 | **FAILED（driver）** | driver 提前退出丢 12 op（settle 条件按 offered 对齐的 bug）→ 修复；9 login ok |
| `G1-IP-SHARED-r2` | 同 r1（修复后） | 8×200+5×429 | 与 r1 合计 17 个审计行、固定窗语义吻合；nginx 全部 172.28.10.3 |
| `G1-PILOT-full-direct-P2-S24-r1` | full direct n=24 | **FAILED（driver）** | 语义在依赖等待前构建，`PENDING` 烤进 URL → 23/24 take 400；修复（保留为失败见证） |
| `G1-PILOT-…-r2` | 同 r1 | **FAILED（driver）** | depsOf(take) 自依赖 → 213 op 死等硬超时；修复（保留为失败见证） |
| `G1-PILOT-…-r3` | 同（修复后） | 390/390 发出，387 verified | lag 旧基线（无 WARMUP 偏移），cpu 公式 1000× bug 未修——功能性通过、度量作废 |
| `G1-PILOT-…-r4` | 同（全修复） | **PASS**；oracle 24/24 graded | 台账首行的正式见证 |
| `G1-PILOT-full-shared-P1-S12-r1` | full shared n=12 | 10 login ok（2×429）+ 19 global 429 | 共享出口可用性限制实证：12 人仅 5 人完整走完（3 attempt 遗留 in_progress，将由 deadline scanner 到点处置——非测量路径） |
| `G1-EMITCAL-direct-P2-S200-r1` | emit-cal S200 | **FAILED（driver）** | emit-cal 泄漏依赖门控（600/3200 发出）→ 修复 |
| `G1-EMITCAL-…-r2` | 同 | 3200/3200 发出；**cpu/lag 度量作废** | cpu 公式 1000× bug + 无 WARMUP（当时未发现） |
| `G1-EMITCAL-debug3..9` | emit-cal p3 n=50 | 调试序列 | 逐项定位：/proc 计账损坏、挂载 append 阻塞、公式 1000×、warmup、预热连接；每步修复见 §5 |
| `G1-EMITCAL-direct-P2-S200-r3` | emit-cal S200 p2 | **PASS（T6 正式证据）** | 见 §0 表 |
| `G1-BURST-CEILING-witness` | 微基准 | 平台上限刻画 | 200 op 同刻 p99≈210ms；4 进程分片不改善 → 网桥序列化 |
| `G1-UIPROBE-r1` | 浏览器 2 考生 | 流程跑通、写文件 ENOENT | 修复 mkdir；考生 110/111 已消耗 |
| `G1-UIPROBE-r2` | 浏览器 2 考生（112/113） | **PASS** | UI 断言 7/7；endpoint mix 逐项一致 |

### 4.1 复验记录（2026-11-20 04:0x–04:2x CST，独立会话重跑 §0 全部结论）

背景：该会话开始时发现 L2-ARRIVAL 系列在上游被中断（其 P2-S200-r1 因 API
中途不可用出现 499×502，DB 已于 03:46 重置重播、此后 SUT 空闲 ~8 分钟，
无并发 agent）。在确认无在跑 driver/浏览器进程后，按下表重跑了 G1.2–G1.4
全部检查，**四项全部通过**，与 §0 既有结论一致：

| run | 检查 | 结果 |
| --- | --- | --- |
| `G1-IP-DIRECT-sanity-r2` | G1.3 T-DIRECT 双侧 IP | 3 login 同秒自 172.28.10.10/.11/.12 到 nginx；Fastify audit `ip_address` 与逐考生绑定一一相同（.1=run.sh 健康检查 SNAT、.3=warmup） |
| `G1-REPLAY-verify-direct-P2-S8-r1` | G1.2 协议回放全流程 | offered=sent=resp=verified=**128/128**、丢样 0、login 8/8、sessionValid 8/8；oracle：8/8 graded+manual、12/12 评分 entry、answersMatchDriver 全 true、receipt clientSeq [1,2]、dupActive/dupTerminal=0 |
| `G1-EMITCAL-direct-P2-S200-r4` | G1.4 T6 余量（命名规模 S200·P2·240s·mix=3200 op） | offered=sent=resp=verified=**3200/3200**、丢样 0；emit lag p50=0/p95=1/**p99=3**/max=23ms、over50=0；driver CPU avg 2.2%/max 30.9% 单核（30.9% 尖峰孤立于 warmup 窗口 t≈0.5s——200 条预热连接；稳态 max **12.3%** 单核）；RSS 84MB；steady elDelayP99 max 30.7ms |
| `G1-UIPROBE-r3` | G1.2 UI 透明性 | 真实浏览器 2 考生（idx 10/11）：A 4/4 + B 3/3 UI 断言全过（save accepted serverVersion=1、chip=已保存、恢复回显 checked、结果分）；DB 双 graded；endpoint mix 差异仍仅驻留期 artifact（heartbeat/client-events，driver 全量回放） |
| `G1-IP-SHARED-r3` | G1.3 T-SHARED 共享出口 | 13 login 同刻全自 172.28.10.3（nginx 计 47 行同 IP）；**10×200 + 3×429**（生产 limiter 10/60s/IP 固定窗语义复现）；offered 45/resp 45/verified 42（3 个 429 的下游依赖取消） |

## 5. driver 余量（T6）与已修正的 driver 缺陷

T6 判据（协议 §8）：cpu<宿主 30%、无单核 >90%、滞后 p99<50ms、丢样=0。
正式证据 `G1-EMITCAL-direct-P2-S200-r3`（S200·P2·全混合节拍，3200 op/240s）：

```
offered/sent/gotResponse/verified = 3200/3200/3200/3200   dropped=0
emit lag（不含数据依赖等待）p50=0 p95=1 p99=3 max=20 ms   over50=0
driver CPU（process.cpuUsage，单核口径）avg=2.63% max=38.6%  → ≈宿主(20核) 0.13%
RSS max 83MB
```

全流程 pilot（真实 argon2 登录负载，r4）：24/24 login 200（p99 时延见
driver.json）、390 op 丢样 0、CPU max 5% 单核。

**修正过程记录**（LOAD_GENERATOR_BLOCKED→修正→复测，总纲 G1.4）：

1. settle 条件按 offered 对齐 → 提前退出丢 op（r1）→ 改为 schedule 全量对齐；
2. op 语义在依赖等待前构建 → `PENDING` 烤进 URL（r1）→ 依赖就绪后构建；
3. depsOf(take) 自依赖死等（r2）→ 依赖表与 opSemantics 对齐；
4. emit-cal 泄漏依赖门控（r1）→ emit-cal 跳过门控；
5. 自监控 CPU 公式量纲错（除以 dt 秒值，放大 1000×：1 核=100000%）→ 修正为
   CPU毫秒/墙钟毫秒（修正见证：27.3ms CPU/501ms tick = 5.5%）；
6. Docker Desktop VM `/proc/self/stat` 计账损坏（busy loop ~100ms 仅 +1 tick，
   后恒 0）→ 主读数换 `process.cpuUsage()`（校准：997ms/1000ms busy）；
   per-thread 读数停用（宿主侧 `docker stats` 抽样法记录于本条）；
7. 挂载盘逐样本 appendFileSync 阻塞事件循环 → 热路径改容器本地盘、结束一次性
   docker cp；
8. t=0 波次首执行 JIT + agent 首建 + 冷 connect 发起 → 2.5s WARMUP（预热
   GET/POST 路径、预建全部 agent；emit-cal 另预热每候选一条 keepAlive 连接，
   正式 flow 保持冷连接以保真 nginx 同刻 accept 风暴）。

**P3（同刻）平台上限（诚实刻画，非 driver 饱和）**：200 op 同一毫秒的发射
滞后 p99≈210ms；4 进程 ×100 op 并行各 p99 126–172ms（不改善）→ 序列化发生在
Docker Desktop 容器网桥（vpnkit）。driver 本身同刻 200 op 的同步发射段仅 ~9ms、
CPU<40% 单核。**含义**：P3·大 N 正式 run 的“同刻”精度受宿主网络栈限制
（≈1 op/ms 串行），应在 L2 设计中注明或用到达表定义同刻窗口宽度；
P1/P2 形态不受影响（p99 3ms）。

## 6. 判据与口径备忘

- **四级计数**：`plannedAtMs`（到达表）/`sentAtMs`+`lagMs`（实际发出；emit-only
  口径剔除 `depBlocked`——SUT 慢导致的数据依赖等待不算 driver 滞后）/
  `responseAtMs`+status/`verifiedAtMs`+`verifyKind`。取消的下游 op 记
  `cancelled:dep-failed:<op>`，计入 offered 不算丢样；driver 自身异常记
  `driver-error`/`never-completed` → 丢样（T6）。
- **login 成功判据**：200+auth-token cookie+role=Candidate；会话有效=同会话首个
  受保护资源 200（`sessionValidAt`）；独立成功人数以 DB `login.success` 审计
  行为准（oracle.ts）。
- **保存判据**：`accepted===true` 且 serverVersion 递增（STALE_VERSION 拒绝也是
  200——必要非充分不变量已内置）。
- **交卷判据**：HTTP 200 + body.status∈{submitted,graded}；权威终态=oracle
  唯一终态 + submission_reason + 每冻结题恰一条评分 entry + 答案=receipts 最后
  接受版本。
- **凭据**：CANDIDATE_PASSWORD 仅经 `docker exec -e` 注入进程环境，不写入任何
  输出文件；runs/ 内无 cookie/token/密码明文。
- **elDelay 口径**：本 VM 计时粒度使 monitorEventLoopDelay 的 p99 有 ~11ms 地板
  （分辨率假象）；超过地板的尖峰（如 276ms）为真实阻塞。CPU 单核口径=100%。

## 7. 交接给后续实验（L1/L2/O1/S1/M1）

- runner 即 `run.sh --scenario=full`（或 login-only）；L2 的 P1/P2/P3、S20–S200、
  T-DIRECT/T-SHARED、配对复放（`--schedule=`）全部参数化就绪；
- 到达表 `schedule.jsonl` 先落盘后执行（协议 §3“到达表以文件预生成并随 run
  归档”）；同 seed 同参数可复现；
- 每 run 消耗 maxAttempts=1 考生；同播种世代内 run.sh 自动跳过已消耗考生，
  200 同场考生耗尽后 `topology.sh reset` 重建（会重播种并更新
  seed-manifest.json，replay-spec 中的 examId 为历史世代的引用，driver 每轮
  从 manifest 取当前 examId）；
- P3 大 N 同刻 run 前先读 §5 平台上限段。
