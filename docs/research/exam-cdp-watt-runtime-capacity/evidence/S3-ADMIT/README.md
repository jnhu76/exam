# S3-ADMIT 条件实验（#900/#1021；PROTOCOL §10 S3-ADMIT + PROTOCOL-ADDENDUM §2.4）

**触发依据**：S1-SUBMIT 的 T7(a)∧(b) 同时成立（`evidence/S1-SUBMIT/README.md`：
交卷窗口借连接等待 p99 估计 2056–2254ms；叠加臂 save p99 1560/1582ms vs 基线
46/41ms，heartbeat 300/964ms vs 31ms）。S2 未发现新语义错误。

**臂**：A = 冻结 SHA `87510894` 的 `apps/api/dist`；S4 = 研究分支 `dist-s3` +
`SUBMIT_ADMISSION=1`（事务前全局手动交卷上限 **S_sub=4**，Q_sub=200，
W_sub=15000ms；先筛 4，ADDENDUM §2.4）。参数锁定见 `pilot-lock.md`。
scanner、autosave、heartbeat、监考读取不经过该门。

全部命令在 `cwd=/home/hoo/Source/exam` 下原样可执行；每 run 的 `cmd.sh` 即该轮
完整复跑命令。

## 0. 结论速览

| 项 | 实测 | 证据 |
| --- | --- | --- |
| 交卷完成数 | **A 200/200、S4 200/200**，3 对全部相同；8 个正式 run 全部 `graded`、0 个 503、0 丢样 | 各 run `oracle.json`/`driver.json` |
| 末位权威确认（T0→最后 HTTP 终态响应） | A 中位 **2109ms**（2030–2255）；S4 中位 **2813ms**（2695–2866）；配对中位 **+33.4%**（3/3 同向） | `s3-analysis.json` |
| 混合 QoS · save p99（T7 窗） | A 1518ms（1288–1615）→ S4 **143ms**（44–153）；配对中位 **−90.6%**（3/3） | 同上 |
| 混合 QoS · heartbeat p99 | A 1564ms（32–1619）→ S4 **20ms**（20–126）；配对中位 **−98.8%**（3/3） | 同上 |
| 混合 QoS · 监考读 p99 | A 1636ms（1579–1788）→ S4 **35ms**（34–36）；配对中位 **−97.8%**（3/3） | 同上 |
| PG 池占用（T7 窗 250ms 采样） | A：`maxBusySessions=10` 每轮、`pollsAtMax10=4–5`；S4：**5/6/6**、**0** | 各 run `pg-sampler-summary.json` |
| 交卷 HTTP 分布 | A p50 2036ms / p99 2088ms；S4 p50 **1620ms（−20.9%）** / p99 **2791ms（+33.7%）** | `s3-analysis.json` |
| 拒绝语义（队满/过期） | 2 个机制 run 共 20/20 断言 PASS：4×200+2×503（timeout）、5×200+1×503（queue_full），503 均为 `SUBMIT_BUSY` + `Retry-After`，**被拒 attempt 完全未执行**（in_progress、0 audit、0 receipt、0 评分 entry） | `S3-ADMIT-REJECT-*` |
| S2 全部业务结果（S3 下重验） | live **38/38**、in-process **36/36**、browser **25/25** 全 PASS，与基线逐断言同序、同 expected/pass（仅动态时间戳不同） | `s2-reverify.json` + `S2-GATE-r1-*` + `S2-BROWSER-r1` |
| 驱动余量 T6 | 8 个正式 run 全 PASS：丢样 0、发射滞后 p99 8–22ms、driver CPU max ≤15.9% 单核 | 各 run `driver.json` |

**一句话**：S_sub=4 把交卷对 PG 池的冲击限制在 4 个事务以内，混合 QoS 尾延迟
回到接近无交卷基线（save 90–97%、heartbeat 92–99%、监考读 98% 改善），交卷
完成数不变；代价是末位确认时间 +29–34%、提交 p99 +29–34%（等待从 PG 池转移到
有界的准入队列），提交 p50 反而 −21%。S2 业务语义零回归。

## 1. 实验设计（采样前锁定）

- **固定载荷**：同场组 200 人 × P3 同刻交卷 + 20 名跨场背景考生（save 5s±2 /
  heartbeat 15s±5）+ 2 名监考 3s 轮询；`arrival-p3-200.json` 与 S1 逐字节相同
  （见 §6 哈希），跨臂逐 run 回放；n=200 与 bg=20 两臂一致。
- **同轮不变量**：总人数、到达流量、PG 池 max=10、取时位置（route-entry
  `fastify.now()`）、事务重试策略均与 A 相同；只改事务前的手动交卷并发上限。
- **矩阵**：pilot S20（1 轮，不入统计）→ A/A（同臂连续 2 轮）→ 3 对交错配对
  （对1 A→S4、对2 S4→A、对3 A→S4）；每 run 之间 R1 完整重置 + fresh JWT。
- **门位置**：`POST /api/attempts/:attemptId/submit` handler 内，认证/归属/
  参数校验之后、candidate 查询与 `submitAndGradeAttempt` 事务之前；等待者不持
  PG 连接、不查询。许可覆盖整个手动交卷操作（查询 + 事务 + 提交后读）。
- **环境隔离**：A 臂跑冻结 `dist`（SHA 及模块哈希见 `build-manifest.json`）；
  S4 臂跑 `dist-s3`（同文件记录构建命令与哈希）。两臂每次 run 前后用
  `/proc/<pid>/environ` + `/api/research/capacity` 快照双层校验（A 的
  `submitAdmission=null`；S4 的 config 必须为 4/200/15000）。

## 2. 运行台账（每 run 的 `cmd.sh` 可复跑）

| run | 臂 | 交卷 p50/p99/max (ms) | 末位确认 (ms) | save T7 p99 | hb T7 p99 | 监考 T7 p99 | PG maxBusy / polls@10 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `…A…aa1` | A | 1949 / 2009 / 2012 | 2030 | 1302 | 32 | 1627 | 10 / 4 |
| `…A…aa2` | A | 2174 / 2231 / 2235 | 2255 | 1615 | 1397 | 1788 | 10 / 4 |
| `…A…r1a` (对1) | A | 2016 / 2081 / 2081 | 2086 | 1518 | 1564 | 1579 | 10 / 4 |
| `…S4…r1b` (对1) | S4 | 1550 / 2675 / 2683 | 2695 | 143 | 126 | 34 | 5 / 0 |
| `…S4…r2b` (对2) | S4 | 1620 / 2791 / 2807 | 2813 | 44 | 20 | 36 | 6 / 0 |
| `…A…r2a` (对2) | A | 2036 / 2088 / 2089 | 2109 | 1288 | 1613 | 1636 | 10 / 5 |
| `…A…r3a` (对3) | A | 2055 / 2126 / 2132 | 2138 | 1536 | 1619 | 1679 | 10 / 5 |
| `…S4…r3b` (对3) | S4 | 1626 / 2845 / 2860 | 2866 | 153 | 20 | 35 | 6 / 0 |
| `…PILOT-S4…S20` | S4 | 199 / 300 / 300 | 305 | 46 | 21 | 24 | 2 / 0 |

（完整 run id 见目录名；save/hb/监考 p99 的 n 分别为 47–51 / 11–16 / 8–9，
p99=max；原始分布保存在各 run `s3-metrics.json` `bg.*.sortedMs` 与
`samples.jsonl`。）

**交卷权威确认**：8 个正式 run × 200 全部唯一终态 `graded`、
`submission_reason=manual`、每 attempt 12/12 评分 entry、receipts 链 [1,2]、
`attempt.submit` 审计 1 次/考生、dupActive/dupTerminal=0；20 名背景考生全部
保持 `in_progress`。S4 的 3 个 run 门计数均为
`acquireEntered=admitted=released=200`、`queueFull=timeout=disconnected=0`、
峰值 `waiting=192 / permits=4`、结束时 live 句柄全 0。

## 3. 配对效应（每对 `(S4−A)/A`，3 对）

| 指标 | 中位 | [min, max] | 同向 |
| --- | --- | --- | --- |
| 交卷 p99 | **+33.7%** | [+28.5, +33.8] | 3/3 |
| 交卷 p50 | **−20.9%** | [−23.1, −20.4] | 3/3 |
| 交卷 drain / 末位确认 | **+33.4%** | [+29.2, +34.1] | 3/3 |
| 完成数（verified/offered） | 0.0% | [0, 0] | 3/3（均 200/200） |
| save T7 p99 | **−90.6%** | [−96.6, −90.0] | 3/3 |
| heartbeat T7 p99 | **−98.8%** | [−98.8, −91.9] | 3/3 |
| 监考读 T7 p99 | **−97.8%** | [−97.9, −97.8] | 3/3 |
| PG 事务 p99（250ms 采样） | 0.0% | [−63.6, +89.2] | 0/3（方向不一致，见 §5） |
| T7 窗 SQL 到达数 | +3.4% | [+3.3, +3.7] | 3/3 |

**A/A 噪声地板**（`aa1→aa2`）：submit p99 +11.1%、p50 +11.5%、drain +11.0%、
save T7 p99 +24.0%、监考 +9.9%；heartbeat T7 p99 的相对差无意义
（aa1 p99=32ms / aa2=1397ms，n=11 vs 13，p99=max；该指标对采样窗口敏感）。
按 ADDENDUM §2.1/§4.2「单对差分 < 2×噪声地板 → INCONCLUSIVE」：submit p99
效应 +33.7% > 2×11.1%=22.2%，方向与量级明确；save 改善 −90% 远超 24% 噪声。
heartbeat 不能用 p99 相对差作判据，改用原始分布：A 臂 5 轮 T7 hb p99=
{32, 1397, 1564, 1613, 1619}ms，S4 臂={126, 20, 20}ms，除 aa1 的 32ms
（11 个样本恰好避开饱和窗）外完全分离。

**机制解释**：A 臂 200 个交卷事务同时进入 postgres.js 池（max=10），250ms 采样
每次都看到 10 个 busy 会话（4–5 次采样在 10）；S4 臂任意时刻只有 4 个交卷请求
在池内，busy 峰值 5–6、从未到 10。S4 的提交 p99 变慢不是池竞争，而是**有意的
准入排队**：200 人 / 4 许可 = 50 波，后段请求在进程内 FIFO 等待（借连接等待
估计公式因此把队列等待记进了 `borrowP99Est`，不能再读作 PG 池等待）。p50 变快
是因为前半数请求拿到早许可、且池内无争用。

## 4. 拒绝语义（机制验证，与性能采样分开）

`pilot-lock.md` 锁定 Q=200/W=15s 下，正式 run 的队满/过期均为 0（全部 200 人
可排队并完成）。503 路径用两个独立机制 run（修改 Q/W，仅机制验证，PROTOCOL
§9.6）实测：

| run | 参数 | 结果 | 断言 |
| --- | --- | --- | --- |
| `S3-ADMIT-REJECT-timeout-r1` | Q=200, W=1ms | 4×200（92–100ms）+ 2×503 `SUBMIT_BUSY`（38ms） | 10/10 PASS |
| `S3-ADMIT-REJECT-queuefull-r1` | Q=1, W=15000ms | 5×200（85–123ms，其中 1 个经队列）+ 1×503 `SUBMIT_BUSY`（34ms） | 10/10 PASS |

两个 run 均验证：503 带 `Retry-After`；被拒 attempt 仍是 `in_progress`、
`submitted_at=null`、`attempt.submit` 审计 0、receipt 0、评分 entry 0；被接收
的 attempt 全部 `graded/manual/audit1/entries12`。原始数据在各自
`results.json`/`samples.jsonl`；API 日志直接给出拒绝原因（2×reason=timeout、
1×reason=queue_full），摘录见 `api-admission-events.log`。

## 5. S2 全部业务结果在 S3 下的重验

在 S4 臂（`SUBMIT_ADMISSION=1`，S_sub=4/Q=200/W=15000）上重跑 S2-TIMING 的
全部可复跑套件（`s2-reverify.json`）：

| 套件 | 基线 | S3 下 | 结果 |
| --- | --- | --- | --- |
| live 协议（①-a/①-b/①-b'/③-a/③-b，真实 nginx + PG 锁 barrier） | 38/38 PASS | **38/38 PASS** | 断言同序；唯一差异是 ③-b 的 `submittedAt` 动态时间戳；pass 值全同 |
| in-process 时序（②-a…②-e，受控时钟 + 真实 PG `exam_test_s2`） | 36/36 PASS | **36/36 PASS** | 断言同序；6 处差异均为动态 `submittedAt` 期望值；pass 值全同 |
| 真实浏览器 fault-injection（①-b-browser/③-c/③-d/④-A/④-B，Chromium + 隔离代理 + 2 次 API restart） | r3/r4 各 25/25 PASS | **25/25 PASS** | 与 r3/r4 同序、同 pass；API 重启进程均继承 S3 env |

S3 臂在重验期间 arm-check（`/proc` + 快照 config）均 OK；live/browser 的
单笔提交全部立即获准（未触发 503），说明门在非并发场景下不改变业务路径。

## 6. 复跑与原始数据

```bash
# 单 run（示例；--reset=1 执行 R1 完整重置）
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S3-ADMIT/s3-run.sh \
  --run-id=S3-ADMIT-S4-P3-S200-overlay-r1b --arm=s4 --mode=overlay --n=200 --reset=1
# 分析（全部 run；产出每 run s3-metrics.json + s3-analysis.json）
python3 /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S3-ADMIT/s3-analyze.py \
  S3-ADMIT-A-P3-S200-overlay-aa1 S3-ADMIT-A-P3-S200-overlay-aa2 \
  S3-ADMIT-A-P3-S200-overlay-r1a S3-ADMIT-S4-P3-S200-overlay-r1b \
  S3-ADMIT-S4-P3-S200-overlay-r2b S3-ADMIT-A-P3-S200-overlay-r2a \
  S3-ADMIT-A-P3-S200-overlay-r3a S3-ADMIT-S4-P3-S200-overlay-r3b
# S2 重验（S3 API 已由 topology.sh 以 S3 env 启动）
SUBMIT_ADMISSION=1 SUBMIT_ADMISSION_PERMITS=4 SUBMIT_ADMISSION_QUEUE_CAPACITY=200 \
SUBMIT_ADMISSION_WAIT_BUDGET_MS=15000 node \
  .wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S2-TIMING/s2-gate.mjs \
  --run-id=S3-ADMIT-S2-GATE-r1
# 拒绝机制（重启 API 时设置对应 Q/W）
pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
  /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S3-ADMIT/s3-reject-mechanism.mjs \
  --run-id=S3-ADMIT-REJECT-timeout-r1 --scenario=timeout
# S2 浏览器重验（instrument 拓扑：nginx:8080 → proxy:3300 → S3 API:3301）
export CAPACITY_API_DIST=dist-s3
export CAPACITY_API_EXTRA_ENV="SUBMIT_ADMISSION=1,SUBMIT_ADMISSION_PERMITS=4,SUBMIT_ADMISSION_QUEUE_CAPACITY=200,SUBMIT_ADMISSION_WAIT_BUDGET_MS=15000"
bash .wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/topology.sh reset
CAPACITY_API_PORT=3301 bash .wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/topology.sh api-restart
S2_PROXY_PORT=3300 S2_CONTROL_PORT=8092 S2_UPSTREAM_PORT=3301 nohup node \
  .wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S2-TIMING/s2-proxy.mjs >/tmp/s3-s2-proxy.log 2>&1 &
pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
  /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S2-TIMING/s2-browser.ts \
  --run-id=S3-ADMIT-S2-BROWSER-r1
```

- 到达表：`arrival-p3-200.json` / `arrival-p3-20.json`，与
  `evidence/S1-SUBMIT/` 同名文件 SHA256 相同：
  `3a92b998…e39703` / `210fb96f…b740a4`。
- 构建溯源：`build-manifest.json`（A `dist` 来自冻结 SHA 的既有构建；
  `dist-s3` 由 `pnpm exec tsc -p tsconfig.build.json --outDir dist-s3` 构建；
  A/S4 的 `attempts.candidate.js` 哈希分别为 `501604d5…` / `591970a1…`）。
- 分析器口径：T7 窗 = 首提交 → 最后终态响应 +10s；基线窗 = [T0−60s,T0)；
  借连接等待公式沿用 S1（仅对 A 有效，S4 读数含准入队列等待，见 §3）；
  p99 同报 max 与 n。

## 7. 边界、偏差与不适用

- **仅 S_sub=4**：ADDENDUM §2.4 明确不再向 2/8 夹逼；本证据不能回答 S_sub=2/8
  的收益/代价曲线。
- **n=3 配对**（降采样）：中位/区间已报，方向一致性 3/3；置信度受样本量限制。
  A/A 仅 1 对且 submit p99 噪声 11.1%、heartbeat p99 受小样本影响大；所有
  结论均标了绝对量与原始分布，不依赖单一 p99 点估计。heartbeat 的“改善”在
  aa1（A 臂 32ms）这一轮上不成立，报告保留该反例。
- **同场 × overlay 单一配置**：未测跨场 S3；S1 显示两臂同因（池竞争），但本
  实验未重复跨场配对。
- **A 构建与 S4 构建的源代码谱系不同**：A 是冻结 SHA 的既有 `dist`；S4 来自
  共享 worktree 当时 HEAD `21276e0e`（含 L3 登录准入原型，`LOGIN_ADMISSION`
  未设置、inert）+ S3 补丁。有效臂差 = 手动交卷门；A 臂行为与 S1 一致。
  研究源码改动留在 worktree（未 commit），主工作树全程 clean。
- **分支偏差**：共享 worktree 在本任务开始时已由 L3 实验置于
  `research/capacity-900-1021-l3-admission`（HEAD `21276e0e`）。为不删除该
  分支已跟踪的 L3 证据文件，本次未切回 `research/capacity-900-1021`；新增
  S3 源码/证据均只在 `.wt-capacity` 工作树内，未 commit、未 push。
- **Q_sub/W_sub 非 §4 预注册候选**（§4 只预注册 S_sub）：二者在采样前写入
  `pilot-lock.md`、采样后未改；仅影响“何时算队满/过期”，不改变 S_sub 语义。
- **单进程拓扑**：门是进程内全局；多 Worker 下的全局上限未被验证（RT-C 已裁撤）。
- **`503 SUBMIT_BUSY` 是新研究契约**，不是现有产品语义；本实验不构成合并建议。
  为使 `reply.code(503)` 通过 Fastify 类型检查，S4 构建在 submit 路由的响应
  schema 中声明了 503；因此 `dist-s3` 的生成 OpenAPI 与仓库已提交的
  `apps/api/openapi.json` 不同（未重新生成/提交，研究构建限定）。
- 单机 WSL2 拓扑（driver 与 SUT 同宿主），P3 发射经 vpnkit 桥；T6 每轮 PASS。
- 采样结束后已执行 `topology.sh reset` 回到 canonical A（研究库重建、fresh JWT）；
  `S3-FINAL-ARMCHECK-A.json` 证明 reset 后 API 无 `submitAdmission` 字段。
