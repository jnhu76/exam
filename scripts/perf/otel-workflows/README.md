# otel-w964 workflow-attribution benchmark harness

观测性工作流归因基准（A/B harness），实现
[`docs/research/observability-workflow-audit/PROTOCOL.md`](../../../docs/research/observability-workflow-audit/PROTOCOL.md)
（v1，sha256 `4eddc216…`）定义的 H1/H2/H3/H4 + S0/S1/S2 实验组：每配置独立干净
进程、仓库语义命令拥有数据库生命周期、外部 `/proc` 采样测量、逐操作 oracle、
配对相对增量 + 固定种子 bootstrap CI 聚合。

**授权边界**：harness 的存在不等于采样授权。PROTOCOL「角色与授权」明确 Stage
D–G（真实采样）另行授权；本 harness 目前仅自检（selftest）通过，未执行任何
真实 round。

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
# N >= 0；N=0 为 pilot 轮（端到端走通用，数据不入正式统计）。按给定顺序执行、
# 跨轮轮转起点（PROTOCOL §6.1）；每配置独立进程 + 独立 warmup + 逐段 re-seed。
# 产物写 out/otel-w964/workflow-audit/rounds/round-N/<config>/：
#   ops.jsonl / segment-summary.json / samples.json / server-out.log /
#   server-err.log / seed-converge.log；round 索引 round.json。
# 末行: ###SUMMARY###{"round":N,"results":[{config,valid,ops,errors,cpuMsPerOp,
#        p50Ms,p95Ms,p99Ms,rssMb}],"driftNotes":""}

node scripts/perf/otel-workflows/runner.js validate --round N
# N >= 0（0 = pilot 轮同样走完整 Oracle）。Oracle 重放（ops.jsonl 全量）+
# 每段终态快照断言 + 末段 live DB 复核（末段配置自己的 DB 血统）。
# 末行: ###VALIDATE###{"valid":bool,"violations":[]}，退出码 0/1

node scripts/perf/otel-workflows/runner.js aggregate
# 汇总全部有效轮（round 0 pilot 始终排除在正式统计之外）：配对相对增量
# （vs 同轮 H1）、中位数、极差(cpuRangePct)、bootstrap 95% CI（10,000 次
# 重采样、percentile 法、固定种子 20261115，PROTOCOL §6.3 冻结）、效应量
# （配对 Δ% 中位数）、样本数 n。
# 写 out/otel-w964/workflow-audit/aggregate.json。
# 末行: ###AGG###{"rows":[{workflow,config,comparable,cpuDeltaPct,p50DeltaPct,
#        p95DeltaPct,p99DeltaPct,rssDeltaMb,ciLow,ciHigh,n}],"notes":[]}

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

`round` 可选 `--concurrency N`（默认取 manifest `workload.concurrency`=10，
PROTOCOL §3.4 主验收档）。

## manifest（configs.json）

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

C1 health/ready×1000+1000；C2 login×1000（≥100 用户轮换，实测池 1200）+
GET /exams×1000（教师池×4，teacher_course_assignments 授课程范围）；C3
answers accepted×1000（热池 20 attempt × 50 clientSeq）；C4 拒绝×1000
（重放 300 / STALE 400 / CONFLICTING 200 / 其它 100=FUTURE 40+INVALID
30+ALREADY_SUBMITTED 30）；C5 fresh submit+grade×900 + 重复 submit×100；
C6 take×1000（frozen 400：取前 1s 回拨 deadline 再 take，冻结归 take 自身；
unchanged 600 窗内幂等）+ restore×1000（bounded_grace 1050 直写制备池）；
C7 heartbeat×1000 + password-reset×1000（1200 池每用户至多 1 次，60s 冷却
不触发）。低频腿：W09 200 条 stale attempt 由 5s deadline scanner 自动交卷
（DB 对账）；W11 10000 条 ≥30d client-events 由 retention 插件启动收敛
pass 删除（DB 对账）；W12 drain 由 fake-transport outbox loop 异步完成
（total==配额且 dead==0 断言，sent 比例为关机时序函数，报告不断言）。
业务操作全部走 HTTP API；制备（start attempt = W02 数据制备、backdate、
disrupt、冻结）按 PROTOCOL §4.1 直写测试库。

## oracle 与 validate

- 逐操作（§4.2 判定面：状态码+业务结果）：`runner.js` §5 `checkOp` ——
  形状、枚举、协议不变量（accepted 必增 serverVersion；重放零写；
  frozen 必 `submittedAt==effectiveDeadline`；restore lifecycle 三值联合）。
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
2. `manifest-parseable` —— 7 配置、臂/维度区分、H4 端点成对模板、端口唯一；
3. `fixture-math` —— 配额加总（C4=300/400/200/100）、制备池 ≥ 配额、W09=200、
   W11=10000、§2.8 库名家族；
4. `oracle-bad-sample` —— 注入 10 个坏样本（版本不增/重放写/reason 越枚举/
   冻结未发生/枚举外 lifecycle 等）全部被识别，14 个良形全部通过；
5. `aggregation-fixed-input` —— 固定输入闭式核对（中位/极差/n/无效段剔除/
   CI 含中位/固定种子确定性）；
6. `seed-converge-extend-checksum` —— 仓库 converge + harness extend 真跑
   + checksum；
7. `oracle-live-smoke` —— 19 操作微型全 kind 实弹（真实 H1 boot + 真实
   引擎映射核对，含 FUTURE_VERSION/restore lifecycle/freeze 语义）；
8. `stack-can-start`（+`boot-H1/H2/H3`）—— DB 解析验证、seed 后 H1/H2/H3
   真实 boot（health+ready+SIGTERM≤30s+exit 0），H3 附加 dump witness。

## 已知限制（v1，如实声明）

- **未执行真实采样**：Stage D–G 另行授权；aggregate 在样本 <6 配对时按
  §6.4 标注 UNKNOWN（notes 自动带出）。
- **`{H4,S0}`、`{H4,S1}` 无命名条目**（见上，manifest 可加）。
- **W13（outbound HTTP）/W14（失败路径遥测）不在混合档**（PROTOCOL §3 同样
  未纳入，属协议范围决定而非 harness 偷工）；W04 的 DEADLINE_EXCEEDED 注入
  天然与 5s scanner 竞争，C4"其它拒绝"改用 FUTURE_VERSION/INVALID_ANSWER/
  ATTEMPT_ALREADY_SUBMITTED 三确定形态。
- **T5 Off 态 30min 网络面审计、T6 每请求恰 1 server span 精确计数、T8 全部
  故障注入场景、T10 retention 探针（--expose-gc H0/H1 对照）、C8 RSS 斜率
  报告、隔离档与 K_pilot 专用程序**：harness 未实现专属流程（pilot 通过
  `round --round 0` 常规链路走通端到端，round 0 不入 aggregate；T6 可离线从
  H3 dump 审计；T8 可用 otlp-sink reject/slow 手动注入后走 round/validate；
  C8 斜率可从 samples.json 离线计算）——这些都列为真实采样阶段的操作程序，
  不是自动门禁。
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

- 本 harness 自检（2026-11-15，连续两次）：`node scripts/perf/otel-workflows/runner.js selftest`
  → `###SELFTEST###{"ok":true,checks:[…11 项…]}`，退出码 0；11 项检查全部
  PASS，其中 `oracle-live-smoke` 为 19 操作微型全 kind 实弹（真实 H1 boot +
  真实引擎契约核对，含 STALE/FUTURE 的 baseVersion 语义、restore episode
  证据链、deadline freeze 的 submittedAt==effectiveDeadline 等式），
  `boot-H3` 证明 TELEMETRY_MEMORY_DUMP_FILE witness 落盘且可解析。
- otlp-sink 三模式独立验证：ok（200 + 按路径请求/字节计数 + --keep-bodies
  base64 捕获 + SIGTERM dump-file）、reject（400）、slow（SINK_DELAY_MS 控制滞留
  后 200），/_health /_counters /_dump /_reset 均可用。
- profile 命令已按契约实跑一次（H1）：converge+extend→boot→固定轻负载→
  SIGTERM→*.cpuprofile/*.heapprofile 落盘。
- `round`/`validate` 的完整链路未实跑（Stage D–G 采样另行授权，PROTOCOL
  「角色与授权」）；其共享代码路径（seed、prep、op 流、oracle、关机、终态
  捕获）由 selftest 的 live smoke 覆盖，段级文件布局（ops.jsonl、samples.json、
  segment-summary.json、round.json）与采样/汇总尚无真实运行产物。
- 产物根：`out/otel-w964/workflow-audit/`（.gitignore 覆盖，`out/` 规则；
  `git check-ignore` 已验证）。
