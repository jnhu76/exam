# otel-w964 workflow-attribution benchmark harness

观测性工作流归因基准（A/B harness），实现
[`docs/research/observability-workflow-audit/`](../../../docs/research/observability-workflow-audit/)
下 PROTOCOL 系列定义的 H1/H2/H3/H4 + S0/S1/S2 实验组：每配置独立干净
进程、仓库语义命令拥有数据库生命周期、外部 `/proc` 采样测量、逐操作 oracle、
配对相对增量 + 固定种子 bootstrap CI 聚合。协议血统 v1→v2→v3→v4；现行
manifest（configs.json）钉 **v4**（content 哈希 `6739a741…`，修订日志节除外；
v4 定参 P_CONC=1 / P_STEADY=300 / P_QUOTA=2100，见 `configs.json` protocol 字段）。

**授权边界（as-built 现状）**：harness 的存在不等于采样授权。PROTOCOL「角色与
授权」明确 Stage D–G（真实采样）另行授权。v3 分区已真实执行 pilot / campaign /
equivalence / w09 / b4-repro / profile / aggregate 的 harness 调用（产物见
`out/otel-w964/workflow-audit-v3/`，脱敏打包副本
[`docs/research/observability-workflow-audit/data-v3/`](../../../docs/research/observability-workflow-audit/data-v3/README.md)）；
但**正式预注册采样未启动**（freeze.json 缺席、H0 §6.6-3 等价性登记未定稿），
v3 战役全部三套件有效配对 = **0/0/0**（PERFORMANCE-REPORT §9），全部预算判定
维持 UNKNOWN。

## 运行环境

- Node ≥ 24（内置 fetch/undici、`node:*` 模块；runner 直接 `node` 可运行）。
- **零新增外部依赖**：唯一第三方模块 `postgres` 通过
  `createRequire(packages/db/package.json)` 从仓库既有依赖树解析
  （runner.js §3 `requirePostgres`），不安装任何包、不改 package.json。
- PostgreSQL 服务器来自仓库语义命令 `pnpm db:up`（docker-compose.dev.yml，
  testing.md §2.8 表第一行：developer-owned）；harness 从不发明第四套栈。
- 依赖安装与构建：仓库根 `pnpm install` + `pnpm build`（turbo 闭包，产出
  `apps/api/dist/server.js` —— manifest `startCommand` 的构建产物）。

## 数据库契约（唯一触达目标）

- 目标库：**`exam_e2e_w964`** —— testing.md §2.8 E2E worker-DB 家族
  （`exam_e2e_w<N>`），同时在 `packages/db/src/scripts/destructiveDbNameGuard.ts`
  的 full-reset allowlist 上（`isFullResetTarget` 允许 `exam_e2e_w<N>` 全量
  重置，仓库自有 truncate 实现因此可用）。槽位 964 大于 E2E runner 的
  16-shard 上限（`scripts/e2e/run.sh` `E2E_WORKERS≤16`），与 E2E shard 库
  不可能碰撞；与 dev `exam`（人工开发数据）、vitest `exam_test*` 无交集。
- **先解析再操作**（AGENTS.md §6）：连接串由 `DB_HOST_PORT`（单一端口所有权
  变量，testing.md §2.1）+ manifest 固定凭据构造；每次使用前
  `SELECT current_database()` 验证实际落点（runner.js `openVerified`），不一致
  立即 fail-loud，绝不做静默回退。
- 生命周期：ensure（缺库时 name-guard 后 `CREATE DATABASE`，一次）→
  converge（`pnpm --filter @exam/api exec tsx src/e2e-seed.ts` =
  reset→migrate→seed→demo→verify，scripts/e2e/run.sh:737 的仓库既有路径）→
  extend（harness 确定性直写：bench 用户/教师/角色分配/考生 profile/教师课程
  分配/克隆考试/选课 + W11 10000 条 ≥30d client-events）→ checksum →
  segment 后终态捕获 → 下一段重新 converge。PROTOCOL §4.1 明确授权
  "backdate/状态制备通过 harness seed 脚本直写测试库"。
- API 进程侧：`APP_MODE=e2e` + `TEST_DATABASE_URL`，显式 `unset
  DATABASE_URL`（scripts/e2e/run.sh:155-163 同一模型；e2e 分支名字守卫
  `test/e2e/ci` 通过，dev 分支不可达）。限流在 e2e 模式自动关闭；
  `REDIS_URL` 不设置（Redis 模式 off，testing.md §2.6 本地默认）。

## CLI 契约（机器解析，标记行总是最后一行）

```bash
node scripts/perf/otel-workflows/runner.js selftest
# 末行: ###SELFTEST###{"ok":bool,"checks":[{name,ok,detail}]}，退出码 0/1

node scripts/perf/otel-workflows/runner.js round --manifest <p> --round N --configs A,B[,…]
# N >= 0；N=0 为 pilot 轮（端到端走通用，数据不入正式统计）。**入口七项预检
# 门强制**（任一项失败 → 不启动任何段，###SUMMARY###.gate.ok=false，退出码 1）。
# 通过后按给定顺序执行、跨轮轮转起点（PROTOCOL §6.1）；每配置独立进程 +
# 独立 warmup + 逐段 re-seed。
# 产物写 out/otel-w964/workflow-audit-v3/rounds/round-N/<config>/：
#   ops.jsonl / segment-summary.json / samples.json / server-out.log /
#   server-err.log / seed-converge.log；round 索引 round.json。
# 末行: ###SUMMARY###{"round":N,"results":[{config,valid,ops,errors,cpuMsPerOp,
#        p50Ms,p95Ms,p99Ms,rssMb}],"driftNotes":"","gate":{ok,checks}}

node scripts/perf/otel-workflows/runner.js validate --round N
# N >= 0（0 = pilot 轮同样走完整 Oracle）。Oracle 重放（ops.jsonl 全量）+
# 每段终态快照断言 + 末段 live DB 复核（末段配置自己的 DB 血统）。
# 末行: ###VALIDATE###{"valid":bool,"violations":[]}，退出码 0/1

node scripts/perf/otel-workflows/runner.js aggregate
# 汇总全部有效轮（round 0 pilot 始终排除在正式统计之外）：**按 workflow 维度
# 分组**（mixed + 各 iso-*，R2-04 修复——不再硬编码 mixed；同轮同 workflow 内
# 配对，跨 workflow 永不交叉）：配对相对增量（vs 同轮同 workflow 的 H1）、
# 中位数、极差(cpuRangePct)、bootstrap 95% CI（10,000 次重采样、percentile 法、
# 固定种子 20261115，PROTOCOL §6.3 冻结）、效应量（配对 Δ% 中位数）、样本数 n。
# 写 out/otel-w964/workflow-audit-v3/aggregate.json。
# **as-built 边界（v3 实测）**：cmdAggregate 只读 rounds/（runner.js:5201）——
# pilot/campaign/equivalence 段一律不进聚合；v3 战役 rounds/ 为空 → rows=[]，
# campaign validPaired 0/0/0，全部单元 UNKNOWN（§6.4，n<6）。campaign 段的
# 聚合桥（PROTOCOL-v3 §6.5(a)/(b)）落地前，campaign 数字只能以
# data-v3/segments.jsonl + packaged-stats.mjs 的侦察级摘要呈现，不得当作
# aggregate 判定面。
# 末行: ###AGG###{"rows":[{workflow,config,comparable,cpuDeltaPct,p50DeltaPct,
#        p95DeltaPct,p99DeltaPct,rssDeltaMb,ciLow,ciHigh,n}],"notes":[]}

node scripts/perf/otel-workflows/runner.js pilot --config X [--attempt N]
# PROTOCOL-v2 §3.4 pilot：H1 混合档 C∈{25,50,100,200} 阶梯各 1 段（round 0
# 约定，不入 aggregate）。`--attempt N` 被容忍并忽略（调用方的重试标记，全命令
# 适用）。入口顺序：**端口单实例预检**（见「单实例与孤儿进程防御」节，fail-closed，
# 失败即拒绝且不进预检门）→ 七项预检门强制；K_pilot = 首个"p99 相对前档
# 增幅 >2×"档位的前一档（p99 形态信号——配额超窗档仍测得真实 p99，PROTOCOL-v3
# §4.3 规则 3）；阶梯内无拐点时不自动取值，写明需按 §3.4 资源耗尽
# fallback 由操作者分析。
# ok 语义（PROTOCOL-v3 §4.3 规则 3 对齐）：预检干净 + 门通过 + 全部 4 档跑完且
# **无结构性 invalid**（`steady window exceeded…` 配额超窗与段内 `1m loadavg…`
# 负载形态是登记过的侦察结局，不判 ok=false；oracle/seed/采样通道/进程早退/
# checksum/background-interference 等结构性原因 → 立即停阶梯、ok=false）+
# 全档 /proc CPU 通道有效（cpuSamplesValid）。round/campaign 正式段语义不变。
# **阶梯段客户端 op 预算 = LADDER_OP_TIMEOUT_MS=240s**（正式段保持 30s）：饱和
# 侦察域下 30s 客户端中止会制造幻影 oracle 违例（c100 实证 92/92 非 transport
# 违例前序为同 attempt transport 超时，产品响应为契约合形的 STALE_VERSION 拒绝）；
# 客户端 op 预算非协议冻结参数（PROTOCOL*.md 的 30s 均为 T9 关机预算/W09 tick/
# 故障注入语义，grep 核实）。
# 落盘 workflow-audit-v3/pilot.json（含吞吐/推荐三元组）。
# 末行: ###PILOT###{"ok":bool,"preflight":{ok,problems},"gate":{…},"config":"H1",
#       "ladder":[{concurrency,valid,ops,p99Ms,throughputOpsPerSec,maxLoad1,
#       cpuMsPerOp,preSteadySeconds,warmupSeconds,shutdownMs,collectMs,
#       quotaExceededExpected,invalidReasons}],"kPilot":number|null,
#       "throughput":[…],"recommended":{steadyMaxSeconds,quotaOps,concurrency,
#       basis[]}（H1-only 初步回填，min-over-arms 仍需 H2/H4 round-0 探针）,
#       "cpuSamplesValid":bool,"loadStats":"…","violations":[],"notes":[]}
# ，退出码 0/1

node scripts/perf/otel-workflows/runner.js campaign --suite mixed|isolated|knee [--concurrency N] [--target N]
# campaign 骨架（PROTOCOL-v3 草案组成，§6.2/§6.4 停机规则沿用）：配置交错（每
# sweep 轮转起点）、入口七项预检门 + 每段前干扰复查 + 每段前干扰复查：waitForQuietLoad1
# 先在 ≤5min 预算内等残余负载衰减（co-located runner 的上一段尾迹不是外部干扰，
# 2026-11-16 修复——此前 run1 被自己的尾迹 defer-starve）；仍未达标才推迟该段且
# 不烧 attempt，连续 3 次推迟判 starved）、每单元有效段计数（≥6 有效或 8 次尝试即
# 停）。--target N ∈ (6,12] 以 v2 §6.4 追加 replicate 通道 resume 既有 campaign
# （units/rounds/notes 从 campaign.json 恢复、sweep 编号续写、尝试上限 12）；
# fresh 运行在 campaign.json 已存在时拒绝（防覆盖既有证据，先归档或改用 --target）。v3 三套件：mixed=系统总成本套件 {H0,H1,H2,H3,H4}（H0 由 gate item 7
# 的 §6.6-3 等价性登记 fail-closed 把关，登记缺失即整 suite 拒绝启动）；\
# isolated=单工作流隔离套件 {H1,H2,H4} × {iso-C1 health, iso-C3 save-accepted,
# iso-C5 submit-grade}（类配额从冻结 quotas 投影）；knee=容量拐点套件 {H1,H4}
# **梯度负载**——默认档位 = K_pilot 括号 [⌊K/2⌋, K, min(2K,200)]（去重升序，
# 读 pilot.json），--concurrency 显式给定时钉单档；K_pilot 缺失且无
# --concurrency 则拒绝启动。单元 = config（mixed）或 config×隔离类（isolated）
# 或 config×档位（knee，键 `H1@c25`）。段落盘 workflow-audit-v3/campaign-<suite>/，
# 进度写 campaign.json。输出 `throughputSemantics` 字段 + notes 明示闭环语义
# （见「吞吐语义」节），防误读为恒定到达率延迟。
# 末行: ###CAMPAIGN###{"ok":bool,"suite":…,"gears":[…(knee)],
#       "units":{unit:{valid,attempts,…}},"rounds":[…],"gate":{…},
#       "stoppedReason":…,"throughputSemantics":…,"notes":[]}，退出码 0/1

node scripts/perf/otel-workflows/campaign-aggregate.mjs [--suite mixed|isolated|knee]
# §6.5(a) campaign 聚合桥（2026-11-16）：cmdAggregate 只读 rounds/，campaign 段
# 无机器配对路径——本桥把 campaign-<suite>/sweep-N 段喂给同一权威 aggregateCore
# （同 sweep 同 workflow 配对 vs H1、bootstrap 10000/种子 20261115），补 p99 CI
# （bootstrapCi）并按 v2 §6.4 规则表出判定（CI 上界 ≤+5 PASS / 下界 >+5 FAIL /
# 跨 +5 或 n<6 或 IQR>5pp UNKNOWN；CI 含 0 另标 INCONCLUSIVE@0）。统计零第二
# 实现。写 campaign-<suite>/aggregate-campaign.json；末行
# ###AGG-CAMPAIGN###<json>，退出码 0/1。
# 骨架边界：段执行复用 runSegment 原链路；Stage D–G 真实采样仍另行授权。

node scripts/perf/otel-workflows/runner.js equivalence [--rounds N] [--concurrency N] [--max-sweeps N]
# §6.6-3 oracle 等价性登记生产者（PROTOCOL-v2 §6.6-3；v3 §8.2-3、v4 §4 继承）：
# H0(cb1e614f 专用 checkout)+H1 成对段，默认 3 轮跨轮次执行，双血统对同一
# 冻结 §4.2 oracle 面逐段核对：per-op oracle（零违例，双 SHA）+ 跨 SHA 终态
# 字段一致（W03 hotReceipts 总数 / W05 submit-audit 增量 / W08 deadline 终态
# ——只取对 per-config seeded shuffle 不敏感的调度不变量；绝对期望属 validate
# 命令，不属跨 SHA 比较）。作废段（含窗超、capture 缺失）按 §6.4 整段作废
# 补跑，其部分数据不入任何判定（sweep 上限默认 24，与 campaign 饥饿守卫同值）；
# 任一有效配对出现 oracle 字段分歧 → 该 workload 判 NON_COMPARABLE、登记
# verified:false 并记录差异字段（诚实出口，不重跑洗白）。登记落盘
# out/otel-w964/workflow-audit-v3/h0-equivalence.json（每轮增量落盘），
# campaign gate item 7 在放行任何 H0 计量行之前消费它（fail-closed）。
# gate item 7 并发判据：H0 只随 manifest 冻结混合档（v4 §3 定参 P_CONC）
# 加入；v2 §3.4 "典型档 C=10" 字面值已被 v4 参数冻结取代（v3 §6.1 item 7
# 规范文本本就无并发字面值），非冻结档仍一律拒绝。
# 末行: ###EQUIVALENCE###{"ok":bool,"registerPath":…,"register":{verified,
#       workloads:{W01,W03,W05,W08},lineages,gear,rounds:[…],notes},
#       "gate":{…}}，退出码 0/1。

node scripts/perf/otel-workflows/runner.js w09 --config X [--pool N] [--delay-seconds S] [--wait-seconds S]
# W09 真实自动提交专池场景（B4 背景干扰隔离）：在自己的段、自己的池、可控
# deadline 下演练真实 deadline_scanner 自动提交，与计量池互不触碰。流程：
# converge+extend → boot → 标准 prep（哨兵池保持未来 deadline，隔离检查点证明
# 无 in_progress attempt 过期）→ 专池 deadline=now()+delay（整体在观察窗内跨过
# 过期点）→ 等待 3×扫描 tick → DB 断言：池内逐 attempt 终态且
# submission_reason='deadline'；池外新终态 attempt 记为 scanner 泄漏（必须
# 0）；计量哨兵保持 in_progress+未来 deadline。落盘 workflow-audit-v3/w09/。
# 末行: ###W09###{"ok":bool,"config":…,"pool":…,"delaySeconds":…,
#       "poolAttempts":{total,deadlineTerminal,deadlineReasonCount},
#       "sentinels":{total,untouched},"untouchedOk":…,"violations":[]，
#       "files":[…]}，退出码 0/1

node scripts/perf/otel-workflows/b4-race-test.mjs --label L --expect-violations true|false [--concurrency C] [--saves N] [--config X]
# B4/R2-03 定向竞态复现（same-attempt concurrent saves）：走 runner.js 导出的
# 真实 execOp+runOpStream 路径（不复刻被测代码），单 hot attempt 全碰撞，
# 每次运行前强制 converge re-seed（post /start 是 resume 语义——复用脏 attempt
# 会使全部 save 合法 STALE，第一轮 post-fix 证据因此作废重采，见
# b4-repro/invalid-first-attempt-resumed-attempt/）。--expect-violations true
# = 复现阶段（期望违例>0），false = 修复证明阶段（期望 0 违例 + accepted
# version 链连续）；两阶段都会附带跑 concurrent-save 批类（恰 1 赢家契约）。
# 证据落盘 out/otel-w964/workflow-audit-v3/b4-repro/<label>.json + ops.jsonl。
# 末行: ###B4RACE###{"result":{accepted,rejectedByReason,violationsTotal,
#       acceptedChainContiguous,finalServerVersion},"concurrentBatch":…}，
# 退出码 0 = 与期望一致。

node scripts/perf/otel-workflows/runner.js profile --config X --out <dir>
# 该配置带 --cpu-prof/--heap-prof 的一次采样 run + 轻量固定负载；报告落盘
# out 目录（*.cpuprofile / *.heapprofile），stdout 打印 JSON 行。

node scripts/perf/otel-workflows/otlp-sink.js --mode ok|reject|slow --port P
#   [--keep-bodies] [--dump-file <path>]
# 本地 OTLP/HTTP 接收器：计数请求/字节（按 /v1/traces|metrics|logs 路径）、
# 可转储 body（--keep-bodies，环形上限 SINK_MAX_BODIES；base64）。
# GET /_health /_counters /_dump；POST /_reset。H4 段由 runner 自动以 ok 模式
# 拉起；reject/slow（35s hold，PR #980 slow-read 场景）为 T8 故障注入手动通道。
```

`round` 可选 `--concurrency N`（默认取 manifest `workload.concurrency`；
v1 时 =10 = PROTOCOL §3.4 主验收档，v4 定参冻结后 = 1）。

## v3 分区与打包证据（R2-07/R2-09）

**分区纪律**：产物根 = `out/otel-w964/workflow-audit-v3/`（gitignored）。
旧根 `out/otel-w964/workflow-audit/`（v1/v2，45 段 0 有效）自 v3 起**只读**，
runner 不再写入，其数字只作参考不作判定（PROTOCOL-v4 分区条款）。

v3 分区布局（本战役实测产物）：

- `pilot/c25..c200/` + `pilot.json` + `pilot-register.json` —— H1 侦察阶梯
  （c25..c200 全部配额超窗 = 设计内侦察结局，段内 load1 5.2–6.24 > 4 → 全档
  knee 梯度面按 §4.1 机械规则剔除；K_pilot=100；P_CONC 回填 BLOCKED →
  v4 Owner 代理裁决 option (c)：B_self=6.8 / 增量限 1.5 / 绝对上限 8.0）。
- `campaign-mixed/`（不存在）—— mixed 套件从未启动：入口门唯一拒绝项 =
  H0 §6.6-3 等价性登记缺失（fail-closed 按设计工作）。
- `campaign-isolated/sweep-1..6/` + `campaign.json` —— 9 单元 × 8 attempts
  无一有效：51 段 invalidReasonCodes = 49×SEED_CONVERGE_DB_UNREACHABLE +
  1×SEED_CONVERGE_DB_STARTING（宿主 Docker Desktop 关闭窗）+
  1×CPU_PAIR_FAIL_CLOSED，另 3 defer/单元 starved；事件与阻断记录见分区内
  `BLOCKED-20261115-hostside-docker-desktop-shutdown.md`。
- `campaign-knee/sweep-1/` + `campaign.json` —— 梯度 [50,100,200]（K_pilot
  括号），6 单元中**恰 1 个 harness-valid 段 H1@c50**（ops=2100、oracle 零违例、
  CPU 通道有效、v4 双判据干扰判定通过：maxLoad1 5.64 ≤ 8.0 且外部增量 −1.16 ≤
  1.5）；其余单元被入口门 defer 至 starved。`campaign-knee-aborted-probe-…/`
  为误启动探针的中止归档（见分区内 INCIDENT 记录）。
- `equivalence-superseded-run{1,2,3-partial}/` + `h0-equivalence.superseded-*.json`
  —— §6.6-3 等价性登记的中间证据（最终 `h0-equivalence.json` 缺席 = 登记未
  定稿）：run3-partial 在中断前留有 1 对/工作流的 clean verified pair
  （H0/H1 各 2100 ops、0 oracle 违例、终态字段一致）；run2 的 sweep-2 出现
  W03/W05/W08 终态字段分歧 → 判 NON_COMPARABLE、verified:false（诚实出口，
  不重跑洗白）；run4 死于宿主 DB 不可达（分区内 BLOCKED 记录）。
- `rounds/` —— **空**（正式 round 未启动；round/validate 完整链路因此尚无
  真实运行产物，见「已知限制」）。
- `run-meta/<ts>-pid<N>-<cmd>.json` —— 每次调用的运行元数据（解析后
  sourceDir、逐配置 SHA、宿主事实；`archive/` 内为 round-0 探针/verify 存档）。
- `b4-repro/`、`w09/`、`profile-H0/`、`aggregate.json`、事件记录 —— 见
  「证据」节与 `data-v3/campaign-summary.json` 摘要。

**打包副本（评审通道，随 PR）**：[`docs/research/observability-workflow-audit/data-v3/`](../../../docs/research/observability-workflow-audit/data-v3/README.md)
由 `package-data-v3.mjs` 生成（73 段脱敏 JSONL + campaign 摘要 + aggregate 副本
+ 统计重算输出 + SHA256SUMS）；`packaged-stats.mjs --check` 可在**无本地 out/**
时逐字节复算统计；逐文件哈希与原始数据登记见
[`evidence-manifest.json`](../../../docs/research/observability-workflow-audit/evidence-manifest.json)
（`reviewable` + `localRaw` 双清单）。

## 单实例与孤儿进程防御

背景：2026-11-15 两次 pilot 调用相隔 73s 重叠——第一次已过门并运行 c25 段
（入口 loadavg 0.14），第二次的七项预检门在 1m loadavg 8.13 下正确拒绝
（§6.5 exclusion 1 / quiet-machine）；更早的被中止运行还遗留过孤儿 API server
占用 manifest 端口。门与硬剔除判据未变，补的是三层结构性防御：

1. **端口单实例预检**（`preflightPortsProblems`，pilot/round/campaign 入口、
   预检门之前）：本单元将绑定的每个 API 端口（及 OTLP 参与时 sink 端口）
   必须可绑定；已被占用 → fail-closed 拒绝启动，消息含端口与占用 pid
   （`ss -ltnp` 可识别时）。这是操作性中止，不是七项门的判定项——门仍为
   七项，与 PROTOCOL §6.1 一致。
2. **runner 内子进程登记与清理**（`trackChild`/`installOrphanDefense`）：
   spawnServer/startSink 的长生命子进程全部登记；runner 退出（exit 事件）与
   SIGINT/SIGTERM/SIGHUP 路径 SIGKILL 全部登记子进程，信号路径随后恢复默认
   处置自杀（退出语义不变）。
3. **父进程死亡 reaper**（`spawnParentDeathReaper`，仅 pilot/round/campaign/
   selftest/w09/profile 拉起）：detached 轮询进程监视 runner pid（SIGKILL 场景
   in-process 处理器无法覆盖）；runner 消失后读 `run-meta/children-<pid>.json`
   状态文件，对每个登记 pid 先验证 `/proc/<pid>/cmdline` 仍含登记 marker
   （防 pid 复用误杀）再 SIGKILL。runner 正常退出时状态文件删除。

## manifest（configs.json）

**可移植性契约（R2-06）**：configs.json 不携带任何机器专属绝对路径。
`sourceDir` 取值只能是 repo-root 相对路径（`"."` = 拥有本 harness 的
checkout，runner 按 manifest 所在目录 `../../..` 解析）或 `${ENV_NAME}`
模板（加载期解析；`EXAM_OTEL_H0_SOURCE_DIR` 缺省回落兄弟工作树约定
`../exam-otel-h0`）。解析出的绝对路径、逐配置 SHA 与宿主事实是**运行元数据**，
每次调用写 `out/otel-w964/workflow-audit-v3/run-meta/<ts>-pid<N>-<cmd>.json`
（gitignored），不入 manifest。H0 额外钉自己的 commitSha 血统
（cb1e614fe087…，pre-OTel 树），gate item 5 按 (sourceDir, commitSha) 逐
lineage 检查——checkout 缺席时明确 fail-closed，绝不静默。仓库 manifest 的
绝对路径由 selftest `portability-manifest` 守卫禁止；显式 `--manifest` 传入的
历史文件仍按原样解析（兼容，不再新增）。

每个配置携带完整 `{sourceDir, buildArtifact(构建产物), startCommand(启动命令),
port(端口), db(DB), env}`，组定义按 PROTOCOL §1.1：

| 配置 | TELEMETRY_* | 角色 |
| --- | --- | --- |
| H0 | （无——v0.0.15 无 TELEMETRY_* 键，env 空） | pre-OTel 历史基线（自带 seed 血统：sourceDir=`exam-otel-h0` 工作树、DB=`exam_e2e_w150` 专用槽；runner 按配置自身 sourceDir/db 解析 converge 与 DB 目标，其余配置回落全局字段） |
| H1 | `ENABLED=false` | 同 SHA Off 基线（T1–T4 唯一基线） |
| H2 | `ENABLED=true, EXPORTER=none, RATIO=1` | On/无导出（主 On 臂） |
| H3 | `ENABLED=true, EXPORTER=memory, RATIO=1, MEMORY_DUMP_FILE=<段目录>` | On/内存见证（span 证据） |
| H4 | `ENABLED=true, EXPORTER=otlp, OTLP_ENDPOINT=http://127.0.0.1:${SINK_PORT}, RATIO=1` | On/完整导出 |
| S0 | H2 臂 + `RATIO=0` | 采样维度 S0（plumbing 成本档） |
| S1 | H2 臂 + `RATIO=0.1` | 采样维度 S1 |
| S2 | H2 臂 + `RATIO=1` | 采样维度 S2 显式命名（env 与 H2 逐字节一致；PROTOCOL §1.3 "S2=主档已含"） |

ask 指定的 7 个名字里 S0/S1/S2 按主 On 臂（H2）落位；PROTOCOL §1.3 冻结的
`{H4,S0}`、`{H4,S1}` 组合 manifest 未含命名条目——加一条 configs 条目即可，
harness 无需改动（README 已声明，避免静默缩窄冻结子矩阵）。

模板变量：`${SEGMENT_DIR}`（H3 dump 落盘目录）、`${SINK_PORT}`（H4 端点）。
共享 env 冻结见 manifest `sharedEnv`；要点：`HEARTBEAT_TIMEOUT_MS=7200000`
（2h > 45min 轮预算上限 → 心跳扫描器不会与 workload 池竞争，W06 disrupted
由 harness 直写制备而非扫描器产生，行为确定性）、扫描 tick 5s、
`EMAIL_TRANSPORT=fake`（W12 drain；键名按 settings.ts:793-828 实测核实）。

## 测量方法（PROTOCOL §5 通道）

- **CPU time/op**（主验收指标）：`/proc/<pid>/stat` utime+stime 差分（Linux
  USER_HZ=100）÷ 稳态窗操作数。外部黑盒，零侵入；PID 即 `node
  apps/api/dist/server.js` 本体（不经 pnpm/tsx 包装，保证 /proc 目标唯一）。
  **采样 fail-closed 语义（R2-01 修复）**：sampler 注册即采样（首样本 t≈0），
  稳态窗只在真实首样本落地后开启、窗边界 = 首样本实际时刻（tMs）；
  末样本 = 流结束时最后有效样本；判定（`judgeSteadyWindow`，单一权威实现，
  selftest 注入矩阵共用）：首样本缺失（预算 5×tick 内无样本，如 PID 已死/
  事件循环饿死）→ 段无效；样本 <2（窗短于一个 tick，CPU 差分无两个观测点，
  不得静默报零成本）→ 段无效；utime+stime 计数非单调 → 段无效；oracle 违例
  >0 → 段无效（PROTOCOL-v2 §4.2 正确性失败作废整段）；进程在配额完成前退出
  → 段无效。`samples.json` 记录逐样本 `tMs`；summary 新增
  `cpuWindowMs = 末样本.tMs − 首样本.tMs`（CPU 窗以实际采样时刻为界）。
- **wall p50/p95/p99**：load generator 客户端计时（含网络/排队项；服务端
  分布黑盒不可测，G1 无 HTTP request metric——口径受限声明按 §5 原样保留）。
- **RSS**：`/proc/<pid>/status` VmRSS 每 1s 采样；summary `rssMb` = 稳态窗
  均值；`samples.json` 保留完整时序（斜率/极值可离线再算）。
- **GC**：perf 段禁用（`NODE_OPTIONS` 启动前清除；`--trace-gc` 有运行时
  开销，§5 划为专用通道旗标）。
- **干扰**：逐采样记录 `/proc/loadavg`（>4.0 硬剔除，§6.5）；采样 tick 单调
  钟偏差 >1s 判时钟跳变（硬剔除）；§6.5 其余硬/软项（容器重启、PG
  checkpoint 漂移、throttling）在 round 层面记录 driftNotes。
- **关机**：SIGTERM→exit 墙钟 + exit code（T9 预算 30s；`runtime.ts:94`
  as-built 3s flush deadline 一并记录）。
- **H3 span 证据**：`TELEMETRY_MEMORY_DUMP_FILE` shutdown JSONL witness；
  harness 记录 span 行数 + JSONL 可解析性（T6 每请求恰 1 server span 的
  精确计数留给真实采样后的离线审计，见"已知限制"）。
- **H4 导出面**：otlp-sink 计数器（请求/字节/状态码，按路径）。

## workload（混合档，PROTOCOL §3.1 冻结配额）

**expectedOps = 11000 ops/段**——由真实 `buildOpPlan` 输出推导
（`expectedWorkload()`，单一权威：预检门 item 1、selftest、campaign 隔离投影
全部调用它）。manifest 同时含 C4 组总额 `c4Rejects=1000` 与其四个子配额
（300/400/200/100）；对全部 17 个键朴素求和会重复计入组总额得 12000——这是
历史 PERFORMANCE-REPORT §3 的口径错误；`buildOpPlan` 只读 16 个逐类键，故
权威期望是 11000。按 kind 精确分布：health/ready/login/examList/saveAccepted
×1000；saveReplay 300 / saveStale 400 / saveConflicting 200 /
saveFuture 34 / saveInvalid 33 / saveClosed 33（c4Other=100 按 i%3 轮转）；
submitFresh 900 + submitDuplicate 100；takeFrozen 400 + takeUnchanged 600 +
restore 1000；heartbeat 1000 + passwordReset 1000。

C1 health/ready×1000+1000；C2 login×1000（≥100 用户轮换，候选池 3000）+
GET /exams×1000（教师池×4，teacher_course_assignments 授课程范围）；C3
answers accepted×1000（热池 20 attempt × 50 clientSeq）；C4 拒绝×1000
（重放 300 / STALE 400 / CONFLICTING 200 / 其它 100=FUTURE 40+INVALID
30+ALREADY_SUBMITTED 30）；C5 fresh submit+grade×900 + 重复 submit×100；
C6 take×1000（frozen 400：取前 1s 回拨 deadline 再 take，冻结归 take 自身；
unchanged 600 窗内幂等）+ restore×1000（bounded_grace 1050 直写制备池）；
C7 heartbeat×1000 + password-reset×1000（每用户至多 1 次，60s 冷却
不触发）。**池隔离（B4）**：2820 个制备槽位一一对应 3000 人候选池中的独立
候选人（`fixtureProblems` 强制 owners == slots），任何池的行都不与其它池共享。低频腿：W11 10000 条 ≥30d client-events 由 retention 插件启动收敛
pass 删除（DB 对账）；W12 drain 由 fake-transport outbox loop 异步完成
（total==配额且 dead==0 断言，sent 比例为关机时序函数，报告不断言）。
W09（后台 deadline 自动提交）**不在标准 gear 窗内发生**（B4 隔离：stale 池
保持未来 deadline，窗入口守卫 fail-closed），真实自动提交由 `w09` 专池命令
另行可控演练并 DB 对账。
业务操作全部走 HTTP API；制备（start attempt = W02 数据制备、backdate、
disrupt、冻结）按 PROTOCOL §4.1 直写测试库。

## Save Oracle 所有权与并发保存类（R2-03 / B4）

**每 attempt 的客户端保存状态单写者**（`withAttemptSaveLock`，按 attemptId
键控的 promise 链）：标准流中同一 attempt 的请求构建、HTTP await 与回执对账
全部发生在同一把 per-attempt 锁内——读-改-写横跨 await，两个 worker 快照同一
(seq, version) 会让服务端输家回 STALE_VERSION，这是 harness 交错制造的假阳性
（B4 竞态），不是产品违例。不同 attempt 不共享锁，流保持真实并发。修复前/
后的定向复现证据在 `b4-repro/`（pre-fix：24 发 7 中 15 STALE 假阳性 + 2 版本
错配；post-fix：24/24 accepted、0 违例、version 链 2..25 连续）。

**concurrent-save 独立实验类**（`execConcurrentSaveBatch`）：刻意绕开串行化
所有权，模拟 K 个真实客户端同时基于同一快照保存——引擎契约预测（answerProtocol
STALE/FRESH 判定序）：恰 1 个 accepted（FRESH seq + 当前 baseVersion），其余
全部 STALE_VERSION（fresh seq + baseVersion 落后）。批级 oracle（恰 1 赢家 /
输家全 STALE / 赢家 version=baseline+1 / 赢家 seq∈批窗口）归该类所有，
per-record `checkOp` 对 `expect.concurrentBatch` 记录豁免——断言是**转移**到
批级，不是删除。该类不进 `buildOpPlan`、不进任何标准流；批与标准 save 不得并
发跑同一 attempt（类契约）。

历史锁死条件的重述：v1 曾建议"concurrency ≤ prepPool.hotAttemptsC3（10<20）"
作为竞态安全不变量——在 per-attempt 锁落地后该关系只影响同 attempt 排队的
现实性（吞吐语义），不再影响正确性；knee 梯度档（>20）因此是安全的。

## 背景干扰隔离（B4）

**根因（round-0 行级证据，`b4-repro/b4-mechanism-round0.json`）**：历史
buildAttemptPlan 把 2820 个槽位按 `i % 1200` 压到 1200 个候选人上，而
`POST /attempts/:exam/start` 是 resume 语义——同一候选人的 in_progress
attempt 会被原样返回。结果不同池的槽位**共享同一条 attempt 行**：submit 池的
1000 次 submit、closed 池 prep 的回拨+冻结、takeFrozen 窗内回拨，全部打在
同时是 hot/unchanged/heartbeat 槽位的行上——这就是历史 B4"后台终态化"的
机制（save* 违例 100% ATTEMPT_ALREADY_SUBMITTED、heartbeat 14,874 条
INVALID_STATE_TRANSITION、takeUnchanged 9,294 条被改写），文档自标未证实的
"harness fixture × scanner 竞态"假说就此坐实；hotSaveState 不是原因（R2-03
已排除）。

修复（全部数据级，不改生产 loop 逻辑）：

- **每槽位独立候选人**：slot i → `bench-c{i+1}`，一一对应；
  BENCH.candidates = 3000 ≥ 2820 槽，`fixtureProblems` 以
  `owners === plan.length` 硬守卫 fail-closed（候选池不足即拒绝启动）。
- **标准池与 scanner 池分离**：runPrep 不再把 W09 stale 池（200 条）回拨进
  过去——保持 in_progress + 自然未来 deadline（45min ≫ 窗长），对标准 gear
  完全惰性；否则 deadline scanner（5s tick，deadlineScanner.ts 对
  in_progress 与 disrupted 都发现）会在计量窗内消费制备数据。W08 frozen 池
  的 1s 回拨保留："冻结归 take 自身"是 W08 的被测语义（读时冻结在请求内
  发生），回拨→take 之间的短暴露窗是生产工作流的固有竞争，文档化为残余项
  （round-0 修复后窗内 deadline 提交 106 条 = 该残余，且 oracle 零违例）。
- **窗入口 fail-closed 守卫**：runSegment 在 prep 后、稳态窗开启前执行
  `in_progress ∧ deadline_at < now()` 计数，>0 即段无效
  （`expiredInProgressAtWindowEntry`）。
- **W09 真实自动提交另设可控场景**：`w09` 命令（专池 + 受控未来 deadline +
  池外泄漏断言 + 计量哨兵 untouched 断言），与计量池互不触碰。
- **warmup 登录池**：warmup 用户 c0901..c1800 全部落入 3000 人候选池
  （历史 1200 人池下 c1201..c1400 不存在 → 每段 ~50 条 401 假阳性，已消）。

## 吞吐语义（闭环标注）

客户端是**闭环**负载发生器：C 个固定 worker 消费有限 op 计划，
`throughputOpsPerSec = C / 平均延迟`——它是固定并发下的饱和度量，**不是**
恒定到达率下的延迟测量；p50/p95/p99 是该并发下的逐操作客户端延迟样本。
每个 segment-summary.json、`###SUMMARY###`/`###AGG###`/`###CAMPAIGN###` 输出
（`throughputSemantics` 字段或 notes）与 aggregate notes 都带此标注。

## oracle 与 validate

- 逐操作（§4.2 判定面：状态码+业务结果）：`runner.js` §5 `checkOp` ——
  形状、枚举、协议不变量（accepted 必增 serverVersion；重放零写；
  frozen 必 `submittedAt==effectiveDeadline`；restore lifecycle 三值联合）。
- **ready 503 契约（对齐 PROTOCOL-v2 §W00 行）**："或超预算 503 且 body 只含
  gate answer" 为合形——readiness 门 fail-closed、探针预算 2000ms
  （apps/api/src/plugins/operabilityMonitor.ts `READINESS_PROBE_BUDGET_MS`），
  饱和下探针超预算而依赖实际可用是产品正确响应，`readyProbeMs ≥ 2000` 的
  503 gate answer 记录于 ops.jsonl 但不判违例、不作废段；**快速 503**
  （`readyProbeMs < 2000`，探针在预算内完成且发现依赖不可用）仍是真就绪
  丢失 → 违例；无 `readyProbeMs` 的旧记录无法证明超预算形态 → fail-closed
  判违例。此前的"基准期间任何非 200 一律违例"断言与协议 W00 行冲突，已按
  AGENTS.md §4 实现向权威收敛（2026-11-15，c25 段 3 条 ms≈2015-2053ms 的
  gate-answer 503 即超预算合形实证）。
- 段级 DB 终态（逐段关机后、下一段 re-seed 前捕获）：W05 submit 审计恰 1
  行/fresh submit（重复零写、auto-submit 无审计）；W08+W09 deadline-submitted
  下界；W06 bounded_grace adjustment 恰 1/episode；W12 outbox total/dead；
  W11 client-events==0；C3 回试行数与 accepted 份额对账（D2 记账）。
- `validate --round N` = (a) ops.jsonl oracle 全量重放对账 + (b) 段级快照
  断言 + (c) 仅末段 live DB 复核（更早段的终态已被后续 re-seed 破坏——
  逐段快照即证据链；live 复核发现 DB 已被新轮 re-seed 时输出
  `[warn]` 不计违规）。

## selftest 覆盖

1. `postgres-driver-from-repo-deps` —— 零新增依赖可解析；
2. `manifest-parseable` —— 8 配置、臂/维度区分、H4 端点成对模板、端口唯一；
3. `fixture-math` —— 配额加总（C4=300/400/200/100）、制备池 ≥ 配额、W09=200、
   W11=10000、§2.8 库名家族、expectedOps=11000（真实 buildOpPlan 推导，
   朴素 17 键和 12000 与其差 = c4Rejects 的不变量）；
4. `oracle-bad-sample` —— 注入 10 个坏样本（版本不增/重放写/reason 越枚举/
   冻结未发生/枚举外 lifecycle 等）全部被识别，14 个良形全部通过；
5. `aggregation-fixed-input` —— 固定输入闭式核对（中位/极差/n/无效段剔除/
   CI 含中位/固定种子确定性）；
5b. `expectedops-plan-distribution` —— 18 个业务 kind 的计划分布逐一精确
   （含 c4Other 轮转 34/33/33）；四个隔离档投影计划精确；
   `workloadPlanProblems` 对健康配额通过、对被破坏的 c4 组总额拒绝；
5c. `sampler-first-sample-regression` —— 对活进程实测：首样本在注册时落地
   （t+<100ms，R2-01 回归核心：修复前 cpuStart 恒 undefined）、`tMs` 存在、
   相邻 tick 计数单调；
5d. `cpu-pair-failclosed-injection` —— 真实子进程注入三态：短周期段
   （窗 < 1 tick → 判无效）、采样延迟段（tick 10s ≫ 300ms 预算 → 窗不开 →
   判无效）、进程提前退出段（oracle 违例 + exited-before-quota → 判无效），
   另有健康对照（窗 ≥ 1.5s → 有效 CPU 对，cpuWindowMs 与实际采样时刻一致）；
5e. `aggregate-workflow-dimensions` —— 跨 workflow 聚合闭式核对（mixed 与
   iso-C3 行各自手算中位数/p99/rss；无效段剔除；基线不出行；跨 workflow
   不交叉喂入；双跑 JSON 全等），CI 与独立重实现的固定种子 bootstrap 逐位
   一致（反事实）；
5f. `precheck-gate-counterexamples` —— 健康输入 7 项全过；注入反例逐一证明
   门会拒绝：c4 组总额破坏 → workload-plan-count、stale 池 199 →
   fixture-oracle、不可解析 commitSha → source-sha-env、dev 库名 "exam" →
   db-isolation、loadavg 5.0 → interference、H0 无 §6.6-3 等价性登记 →
   h0-comparability（有登记则过；H0 进 isolated 套件拒绝）；
5g. `pilot-ladder-rule3-injection` —— pilot 阶梯判定的单一权威纯函数
   `judgePilotLadder`（cmdPilot 与本用例共用）：A. 四档全部"配额超窗"→ 侦察
   结局 ok 可过、kPilot=100 由 p99 形态导出（前判据 ladder.every(valid) 在
   回填前放大的配额下永假——反例即此）；B. oracle 违例 → 结构性停阶梯；
   C. 采样通道失效 → cpuSamplesValid=false 且停；D. 段内 load1 超界 →
   该档 knee face 剔除登记、阶梯继续（§4.1 机械规则）；E. 混合原因
   1/1/1 分桶；
5h. `port-preflight-injection` —— 端口单实例预检（注入 probe/ownerLookup，
   不做真实 bind）：占用 3901（EADDRINUSE, pid 424242）→ fail-closed 问题含
   端口+占用者；空闲端口 → 零问题；
2b. `portability-manifest` —— 仓库 configs.json 零绝对 sourceDir 路径；
   "." 解析到 runner 所属 checkout 根；H0 模板按 env/兄弟约定解析且钉
   cb1e614f 独立血统（checkout 本机缺席不在此检查，gate item 5 采样期
   fail-closed）；
2c. `suites-v3-composition` —— 三套件组成逐字段核对（mixed=H0-H4、
   isolated=H1/H2/H4 × iso-C1/C3/C5、knee=H1/H4 梯度）+ 梯度括号数学
   （K=1/25/200 的去重/封顶行为）fail-closed 防漂移；
6. `seed-converge-extend-checksum` —— 仓库 converge + harness extend 真跑
   + checksum；
7. `oracle-live-smoke` —— 19 操作微型全 kind 实弹（真实 H1 boot + 真实
   引擎映射核对，含 FUTURE_VERSION/restore lifecycle/freeze 语义）；
7b. `background-isolation` —— prep 后 in_progress∧deadline 过期计数 = 0
   （scanner 不得在窗内发现制备数据；负对照已证查询对单条人为过期 attempt
   计数=1）；
7c. `save-serial-ownership` —— 6 个同 attempt 并发 saveAccepted（C=4，真实
   execOp+runOpStream 路径）6/6 accepted、version 链连续、0 违例
   （per-attempt 锁所有权，R2-03 回归核心）；
7d. `concurrent-save-class` —— 4 发未串行化同 attempt 批：恰 1 赢家
   （seq+1/version+1）、败者全 STALE_VERSION、0 批级违例（引擎契约形状）；
8. `stack-can-start`（+`boot-H1/H2/H3`）—— DB 解析验证、seed 后 H1/H2/H3
   真实 boot（health+ready+SIGTERM≤30s+exit 0），H3 附加 dump witness。

## 已知限制（v3 as-built，如实声明）

- **正式预注册采样未启动**：Stage D–G 另行授权；freeze.json 缺席、H0 §6.6-3
  等价性登记未定稿（仅 3 份 superseded 中间登记），正式 round 未执行
  （`rounds/` 空）。aggregate 在样本 <6 配对时按 §6.4 标注 UNKNOWN（notes
  自动带出）；v3 全部三套件有效配对 0/0/0，预算判定维持 UNKNOWN。
- **aggregate 的 campaign 段聚合桥未落地**（as-built）：`cmdAggregate` 只读
  `rounds/`（runner.js:5201），PROTOCOL-v3 §6.5(a)/(b) 的 campaign 单元聚合
  机器路径未实现 → campaign/isolated/knee 段不进 aggregate 行。其数字仅经
  data-v3 打包通道以侦察级摘要呈现（`package-data-v3.mjs` +
  `packaged-stats.mjs`），标签即排除依据。
- **协议成文状态**：PROTOCOL-v3.md / PROTOCOL-v4.md 已独立成文（v4 为现行
  manifest 钉定版本，content 哈希 `6739a741…`）；三套件组成（mixed H0-H4 /
  isolated H1,H2,H4 × health,save-accepted,submit-grade / knee H1,H4 梯度）的
  单一权威实现仍是 `SUITES`/`ISO_CLASSES`/`WORKFLOW_ORDER`（selftest
  `suites-v3-composition` 防漂移）。v1/v2 历史段（45 段 0 有效）原样保留于
  只读旧根，不回溯翻案。
- **pilot / campaign as-built 状态**：`pilot --config H1`（阶梯全档配额超窗 =
  侦察结局；K_pilot=100；P_CONC 回填 BLOCKED → v4 裁决）与
  `campaign --suite mixed|isolated|knee` 均已真实执行：mixed 被门拒绝（H0
  register 缺失）、isolated 全灭于宿主 Docker 关闭窗（ECONNREFUSED）、knee
  拿到全战役首个 harness-valid 段（H1@c50，见「v3 分区」节）。逐工作流正式
  数字仍无（配对 0）。
- **WARN 恰 1 条/拒绝 + reqId 对账**（W04）未进入自动 validate；server-out.log
  逐段落盘，可离线 grep 审计。
- **login argon2 成本进入 C2 测量口径**（每 verify ~tens of ms；对全部配置
  同等，属真实工作流成本，不影响配对差分方向）。
- **takeFrozen 每次操作附带 1 条未计时的 harness 侧 UPDATE**（deadline 回拨
  制备），对 PG 施加均等负载；这是保持"冻结归 take 自身"确定性的代价。
- **WSL2 探索级**（PROTOCOL §2 边界声明）：全部数字仅机制归因，不得外推
  生产容量。
- `round` 的 ops.jsonl 写入经 Node stream 背压（简易 `write` 返回值检查 +
  drain），11k 行/段量级下安全；更大规模需换阻塞写。
- `validate` 的 live DB 复核仅对"当前 DB 仍持有该轮终态"成立（见上）。

## 证据

- **v3 战役实测（2026-11-15，`out/otel-w964/workflow-audit-v3/` 分区；打包副本
  `docs/research/observability-workflow-audit/data-v3/`）**：73 个
  segment-summary（8 valid / 65 invalid）——pilot 阶梯 4 段（全档配额超窗侦察
  结局 + 段内 load1 超界剔除登记，K_pilot=100）；isolated 51 段无一有效
  （49 DB 不可达 + 1 DB starting + 1 CPU_PAIR_FAIL_CLOSED）；knee 1 段 valid
  （H1@c50：ops=2100、errors=0、oracle 零违例、cpuMsPerOp=96.2619、
  externalLoadIncrement=−1.16、expiredInProgressAtWindowEntry=0 —— R2-01/02/03
  修复与 v4 干扰判据在真实 boot 下的首个运行见证）；equivalence 9 段（7 valid，
  run3-partial 含 1 对/工作流 clean verified pair；run2 sweep-2 三工作流终态
  分歧 → NON_COMPARABLE 如实登记）；w09 专池 12/12 deadline 终态化 + 哨兵
  untouched；aggregate `rows:[]`（rounds 空 + campaign 桥未落地）。
  全部判定面维持 UNKNOWN（有效配对 0 < 6，PROTOCOL §6.4）；侦察级复算：
  `node scripts/perf/otel-workflows/packaged-stats.mjs --check`。
- **B4 机制确认 + round-0 前后对比**（`b4-repro/b4-mechanism-round0.json`）：
  池槽候选人复用（i%1200 × resume 语义）= 历史"后台终态化"根因的行级证据；
  修复前后各跑一个完整 round-0 H1 段（11k 配额，C=10）：修复前 411 条 oracle
  违例（heartbeat 145 / save 族 ATTEMPT_ALREADY_SUBMITTED 217 / warmup 登录
  401×50 / takeUnchanged 改写×10 / takeFrozen 漂移×12）+ 窗内 scanner deadline
  提交 169 条；修复后 **0 条 save/heartbeat/take/login 违例**
  （saveAccepted 155/155、saveReplay 49/49、窗内 deadline 提交降至 106 条 =
  文档化 W08 残余），唯二违例是 2 条 ready 503 not_ready——服务器在饱和窗
  t≈38-40s 的真实 readiness 翻转，产品行为观测而非 harness 假阳性。两段均因
  180s 窗未完成配额判 INVALID——与全部 v1 历史 H1 段一致（wall=180s 封顶、
  ops≈3800-4200、p50≈330-400ms），属 WSL2 探索级宿主的既有局限，非本次改动
  引入。
- **B4 / R2-03 竞态前后对比**（`out/otel-w964/workflow-audit-v3/b4-repro/`，
  2026-11-15，exam_e2e_w964，H1 boot，单 hot attempt 全碰撞，C=8，24 发
  saveAccepted，每轮 converge 后从 version 0 干净复现）：pre-fix
  （`pre-fix.json`）accepted=7、STALE_VERSION=15、violations=17（15 条
  reason 错配 + 2 条版本错配）、finalServerVersion=8；post-fix
  （`post-fix.json` / `post-fix-final.json`）24/24 accepted、
  **0 违例**、clientSeq 与 version 链 2..25 连续；concurrent-save 批类
  0 违例（恰 1 赢家 v+1、败者全 STALE）。第一轮 post-fix 证据
  （`invalid-first-attempt-resumed-attempt/`）因 post /start resume 语义复用
  脏 attempt 而作废重采——过程留档，复现脚本已改为强制 converge。
- **W09 专池实测**（2026-11-15，`w09 --config H1 --pool 12 --delay-seconds 3`）：
  gate 通过；专池 12/12 在受控窗内被真实 scanner 终态化且
  submission_reason 全部 ='deadline'；计量哨兵 4/4 untouched；池外泄漏 0；
  产物 `workflow-audit-v3/w09/w09-H1.json`。隔离守卫负对照（人为过期 1 条
  in_progress attempt）查询计数 0→1，还原后归零。
- **campaign fail-closed 演示**（2026-11-15）：`campaign --suite mixed` 因
  H0 §6.6-3 等价性登记缺失 + H0 checkout 缺席被 gate 拒绝（未启动任何段）；
  `campaign --suite knee` 因 pilot.json/K_pilot 缺失拒绝。三套件接线即此
  fail-closed 行为，真实采样仍另行授权。
- 本 harness 自检（R2-03/R2-06 修复后，2026-11-15）：`node scripts/perf/otel-workflows/runner.js selftest`
  → `###SELFTEST###{"ok":true,checks:[…22 项…]}`，退出码 0；22 项检查全部
  PASS，其中 `oracle-live-smoke` 为 19 操作微型全 kind 实弹（真实 H1 boot +
  真实引擎契约核对），`save-serial-ownership`（6/6 accepted、version 链
  [3..8] 连续、0 违例）与 `concurrent-save-class`（批 4：恰 1 赢家、0 违例）
  为 R2-03 回归核心；`background-isolation` 证明 prep 后无过期 in_progress
  attempt；`portability-manifest` 证明 configs.json 零绝对路径 + H0 模板
  解析；`suites-v3-composition` 钉死 v3 三套件组成与梯度括号数学；
  `cpu-pair-failclosed-injection` 三态注入全 fail-closed、健康对照有效；
  `boot-H3` 证明 TELEMETRY_MEMORY_DUMP_FILE witness 落盘且可解析；
  `precheck-gate-counterexamples` 证明七项门对六类注入反例全部拒绝。
- run-meta 抽样核验：w09/campaign 调用均在
  `workflow-audit-v3/run-meta/<ts>-pid<N>-<cmd>.json` 落盘（含解析后
  sourceDir、逐配置 SHA、宿主事实）。
- otlp-sink 三模式独立验证：ok（200 + 按路径请求/字节计数 + --keep-bodies
  base64 捕获 + SIGTERM dump-file）、reject（400）、slow（SINK_DELAY_MS 控制滞留
  后 200），/_health /_counters /_dump /_reset 均可用。
- profile 命令已按契约实跑一次（H1）：converge+extend→boot→固定轻负载→
  SIGTERM→*.cpuprofile/*.heapprofile 落盘。
- `round`/`validate` 的完整链路未实跑（Stage D–G 采样另行授权，PROTOCOL
  「角色与授权」）；其共享代码路径（seed、prep、op 流、oracle、关机、终态
  捕获）由 selftest 的 live smoke 覆盖，段级文件布局（ops.jsonl、samples.json、
  segment-summary.json、round.json）与采样/汇总尚无真实运行产物。
- 产物根：`out/otel-w964/workflow-audit-v3/`（.gitignore 需覆盖 `out/` 规则；
  v1 根 `out/otel-w964/workflow-audit/` 保存 R1/R2 审计证据，自本版本起
  **只读**，runner 不再向其写入）。打包复核通道：
  `docs/research/observability-workflow-audit/data-v3/`（SHA256SUMS 哈希锚定，
  已列 .prettierignore）+ `evidence-manifest.json` 双清单
  （reviewable=PR 内文件；localRaw=本地原始数据哈希 + 再生成命令）。
