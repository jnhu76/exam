# data-v3 — 观测性工作流审计 v3 数据包（脱敏、哈希锚定、可复核）

本目录是 `out/otel-w964/workflow-audit-v3/`（gitignored 原始证据根，
`.gitignore:77`）的**脱敏打包副本**，随 PR 交付。目标：评审者**无需本地
`out/`** 即可复核 v3 战役的聚合状态与统计重算；原始数据本体由
[`evidence-manifest.json`](../evidence-manifest.json) 的 `localRaw` 部分以
本地路径 + sha256 + 再生成命令登记（R2-09 双清单）。

打包时间：2026-11-16（v3.1 重打包：正式 mixed campaign 落地后）；打包者：`scripts/perf/otel-workflows/package-data-v3.mjs`。
原始根当日状态：130 个 `segment-summary.json`（63 valid / 67 invalid）。v3.1 新增：`campaign-mixed/` 正式段（49 段，47 valid）、最终 H0 等价登记 `h0-equivalence.json`（verified，3 sweeps × W01/W03/W05/W08 全 0 oracle 违规、终态字段 H0/H1 逐项相等）、`campaign-mixed/aggregate-campaign.json`（§6.5(a) 聚合桥判定）。

## 文件清单

| 文件 | 内容 |
| --- | --- |
| `segments.jsonl` | 130 行、每段一行：`suite / status / workflow / config / rep / unit / concurrency / valid / ops / errors / cpuMsPerOp / p50Ms / p95Ms / p99Ms / rssMb / rssMaxMb / throughputOpsPerSec / wallSeconds / maxLoad1 / externalLoadIncrement / expiredInProgressAtWindowEntry / invalidReasonCodes / invalidReasons / source`。无效段对应字段为 `null`（不补数）。`source` 指回原始段目录（仓库相对路径）。 |
| `campaign-summary.json` | 三套件 + pilot + 等价性登记 + 配套证据的脱敏摘要：mixed（**正式判定单元：10 sweeps、47 valid/49 段、H2 n=10 / H3 n=9 / H4 n=8 有效配对；含 §6.5(a) 聚合桥的判定行**；Owner 指令停止于 sweep-10 中途，`stoppedByOwner: true`；run1 defer-starve 前史见 `prehistory`）、isolated（51 段全无效：49 `SEED_CONVERGE_DB_UNREACHABLE` + 1 `SEED_CONVERGE_DB_STARTING` + 1 `CPU_PAIR_FAIL_CLOSED`；27 次 entry defer + 9 次 starved——逐段明细见 `segments.jsonl` 的 `invalidReasonCodes`）、knee（6 单元、恰 1 个 valid 段 H1@c50）、knee 中止探针、equivalence（**最终登记 verified=true**：3 sweeps × 4 工作流 0 违规 + 3 份 superseded 中间登记）、b4-repro / w09 / profile-H0 摘要、事件记录索引。 |
| `aggregate.json` | 官方 `runner.js aggregate` 产物的脱敏副本（notes 中绝对路径改写为仓库相对路径，其余逐字）+ `packagingProvenance`（来源、再生成命令、as-built 解释：`cmdAggregate` 只读 `rounds/`（`runner.js:5201`），v3 `rounds/` 无轮次清单 → `rows: []`）。 |
| `stats-output.json` | `packaged-stats.mjs` 的重算输出：总数、按 suite 的无效原因码直方图、valid 段按 (suite, workflow, config) 的中位数（侦察级描述统计）、formal aggregate 行（**mixed-campaign 正式配对：H2/H3/H4 vs H1 与 H0 血缘行，含 bootstrap CI 与 IQR，评审侧自含重算=对权威实现的交叉验证**）、campaign validPaired（mixed=8 / isolated=0 / knee=0）、knee 侦察段字段。 |
| `SHA256SUMS` | 本目录 5 个数据文件的 sha256（`sha256sum -c` 兼容格式；不含自身）。 |

## 生成链（原始 → 打包，顺序固定）

```bash
# 0) 原始证据（不随 PR；由 harness 各命令产生，见下「原始分区与再生成」）
# 1) 打包（读 out/otel-w964/workflow-audit-v3/，写 segments.jsonl + campaign-summary.json + aggregate.json）
node scripts/perf/otel-workflows/package-data-v3.mjs
# 2) 统计重算（只读本目录 segments.jsonl + campaign-summary.json，写 stats-output.json）
node scripts/perf/otel-workflows/packaged-stats.mjs
# 3) 清单与 SHA256SUMS（写本目录 SHA256SUMS + ../evidence-manifest.json）
node scripts/perf/otel-workflows/gen-evidence-manifest.mjs
```

## 复核方法（无需本地 out/）

```bash
# 1) 哈希完整性（或对照 evidence-manifest.json reviewable.dataV3.files 逐项 sha256sum）
cd docs/research/observability-workflow-audit/data-v3 && sha256sum -c SHA256SUMS

# 2) 统计重算（输出必须与已提交的 stats-output.json 逐字节一致）
node scripts/perf/otel-workflows/packaged-stats.mjs --check

# 3) 脱敏断言（必须零命中；任何命中都是打包缺陷。--exclude=README.md：
#    README 自引本命令文本，非数据泄漏面）
grep -RnE --exclude=README.md "/home/|file://|postgres(ql)?://|PASSWORD|SECRET|Bearer " .

# 4) 语义交叉核对（抽样三点，与 PERFORMANCE-REPORT §9 对账）
#    a. aggregate.json rows == []（formal rounds 为空 → 零可呈报行）
#    b. stats-output.json campaignValidPaired == {"mixed":0,"isolated":0,"knee":0}
#    c. knee 侦察段 H1@c50：ops=2100 / cpuMsPerOp=96.2619 / p50=4963.399 /
#       p95=10858.279 / p99=12168.209 / rssMaxMb=2527.33（§9.2 逐字段一致）
jq '.totals, .campaignValidPaired, .kneeRecon.segments' stats-output.json
```

## 判读纪律（继承协议，打包不重开）

1. `status` 字段给每段打标签：pilot=侦察阶梯（永不入统计）、isolated/knee=
   campaign 通道（as-built 不进 `cmdAggregate`）、equivalence=superseded 中间
   登记（非判定通道）、probe-archive=round-0 探针存档。**标签即排除依据**，
   打包不删除证据、也不把它升格为判定。
2. formal aggregate `rows: []` + 有效配对 0/0/0 < 6 → **每个聚合单元
   UNKNOWN**（PROTOCOL §6.4）；禁止写 0% 或 PASS。
3. `validSegmentsBySuiteWorkflowConfig` 与 `kneeRecon` 是**侦察级描述统计**
   （equivalence 组为 P_CONC=1 等价性侦察、knee 组为 C=50 单段）——不构成
   H2/H3/H4 vs H1 的开销判定，更不外推生产容量（WSL2 探索级边界，
   PROTOCOL §2）。
4. 全部数字只覆盖 `workflow-audit-v3/` 分区；v1/v2 无效段（45 段 0 有效）
   在 `evidence-manifest.json` `localRaw.v1` 登记，原样保留、不回溯翻案
   （PROTOCOL-v4）。

## 脱敏声明

- 路径：原始文本中的本机绝对前缀（审计树根、`/home`）统一改写为
  `<audit-tree>` / `<home>` 占位符，`file://` 令牌整体删除；`source` 字段保留
  仓库相对路径。
- 凭据：这些产物不序列化连接串/密钥（DB 目标以库名与 checksum 表示，
  launchEnv 以哈希表示）；复核第 3 步的 grep 是打包缺陷断言，不是免责声明。
- 无效原因：原文保留语义（脱敏 + 截断 240 字符），另给封闭码表
  （`SEED_CONVERGE_DB_UNREACHABLE` / `SEED_CONVERGE_DB_STARTING` /
  `SEED_CONVERGE_FAILED_OTHER` / `QUOTA_NOT_COMPLETED_IN_STEADY_WINDOW` /
  `LOADAVG_IN_WINDOW_EXCEEDED` / `CPU_PAIR_FAIL_CLOSED` / `ORACLE_VIOLATIONS` /
  `PROCESS_EXITED_EARLY` / `STARVED_INTERFERENCE_RECHECK` /
  `DEFERRED_ENTRY_LOADAVG` / `OTHER`）。

## 原始分区与再生成命令（摘自 evidence-manifest.json localRaw）

| 分区 | 内容 | 再生成 |
| --- | --- | --- |
| `out/otel-w964/workflow-audit-v3/` | 本包的全部来源 | `node scripts/perf/otel-workflows/runner.js selftest`；`… runner.js pilot --config H1`；`… runner.js campaign --suite isolated|knee`；`… runner.js equivalence`；`… runner.js w09 --config H1 …`；`node scripts/perf/otel-workflows/b4-race-test.mjs …`；`… runner.js profile --config H0 --out <dir>`；`… runner.js aggregate`。真实采样（Stage D–G）另行授权；mixed 套件本轮被门拒绝（H0 等价性登记未定稿）；isolated 51 段全无效（49 DB 不可达 + 1 DB starting + 1 CPU-pair fail-closed，事件记录见 campaign-summary）。 |
| `out/otel-w964/workflow-audit/` | v1/v2 历史原始证据（45 段 0 有效，只读） | 历史 PROTOCOL.md/v2 会话产物；v3 起该根只读，runner 不再写入；如需重跑须按其协议版本与当时 configs 重建（不再由现行 configs.json 直接复现）。 |
| `out/out/`、`out/pilot-h0/` | 误嵌套副本 / H0 pilot 草稿脚本（草稿态，非证据） | 不再生成；仅为完整性登记。 |
