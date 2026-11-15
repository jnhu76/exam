# COMPONENT-ATTRIBUTION — 组件/工作流级观测性成本归因

- **状态**：**BLOCKED** —— 无有效轮（有效 segment **0 / 44**），无任何可呈报的归因数字。本文件不携带归因数值表；只记录阻断原因、证据与可复现的阻断点。
- **记录时间**：2026-11-15（会话实测：本地 08:31 CST，UTC 00:31；`date` / `date -u` 输出）。
- **角色与授权**：本文件由归因记录员（调查/审计模式）撰写；只读取证 + 本文件写入。未执行任何采样、迁移、truncate、drop 或 Docker 生命周期操作。
- **输入材料**：
  - ask 给定背景：`experimentsPossible=true`、`有效轮=0`；
  - 同目录 `PROTOCOL.md`（v1）、`PROTOCOL-v2.md`、`REALITY.md`（§E1 per-signal 归因即本文件的目标产出）、`WORKFLOW-INVENTORY.md`（§1 W00–W15 组件矩阵）；
  - harness：`scripts/perf/otel-workflows/`（`runner.js`、`configs.json`、`otlp-sink.js`、`README.md`）；
  - 运行产物：`out/otel-w964/workflow-audit/`（gitignored，`.gitignore:77` `out/` 规则，`git status --short` 确认 `docs/research/observability-workflow-audit/` 与 `scripts/perf/` 为 untracked）。
- **证据等级约定**：沿用本目录约定——`MEASURED`＝本会话实际执行的命令/读取的产物；`CODE_VERIFIED`＝本会话读源码/文档定位；`转引`＝来自文件内既有记录，本会话未复核；`UNKNOWN`＝无法验证，禁止当事实使用。

---

## 1. BLOCKED 的准确含义（两层陈述，不得混读）

ask 口径"实验未执行/无有效轮"在本审计树中对应两个不同层次，必须同时如实记录：

1. **协议/授权层——正式实验未执行**：`PROTOCOL.md:4` 明确"执行（Stage D–G）另行授权。本协议本身不授权任何采样、数据库或 Docker 操作"。本会话在审计树内检索 Stage D–G 采样授权记录，仅命中协议自身的授权条款（`PROTOCOL.md:4`、`PROTOCOL-v2.md:4`），**未找到任何授权记录**【MEASURED｜grep "Stage D" 授权检索】。因此协议意义上的正式归因实验尚未被授权执行。
2. **harness 执行层——存在尝试性运行，但零有效轮**：磁盘上存在 10 轮 harness 运行产物（`round-0` pilot + `round-1..6` + `round-101..103`），共 **44 个 segment，0 个有效**（逐段 `valid:false`，见 §3.1）【MEASURED】。运行产物文件时间跨度 2026-11-15 04:40:01 +0800（最早：`round-0/H0/seed-converge.log`）至 08:26:52 +0800（最晚：`round-103/S0/samples.json`）【MEASURED｜stat】。这些运行端到端走完了 seed→boot→warmup→采样→关机→终态捕获的链条，但**每一段都同时命中三类段无效判定**（§4 B1/B2/B3），另有 15.5%–21.1% 的 oracle 正确性失败（§4 B4）。它们不构成协议意义上的有效实验数据。

`experimentsPossible=true` 的操作含义（本会话核实）：harness 可运行——`runner.js`/`otlp-sink.js` 通过 `node --check` 语法检查【MEASURED｜node v24.15.0，两文件均 OK】；manifest `configs.json` 可解析且 8 配置齐备【MEASURED】；harness README 记录 2026-11-15 selftest 11 项全 PASS（含真实 H1/H2/H3 boot 的 live smoke）【转引｜`scripts/perf/otel-workflows/README.md:215-231`，本会话未重跑 selftest】；44 个 segment 的产物证明该链路实际可执行。**"可行"指 harness 可执行；"零有效轮"指其产出不满足协议有效性判定。两者同时为真，正是 BLOCKED 而非 NOT_APPLICABLE 的原因。**

---

## 2. 归因目标与预期产出面（本应产出什么）

- **组件定义**：W00–W15 工作流（`WORKFLOW-INVENTORY.md` §1）× 遥测形态 H0–H4 与采样维度 S0–S2（`PROTOCOL.md:17-21` §1.1 组定义行、`:31-43` §1.3）。
- **目标产出**（全部依赖有效轮，当前无一存在）：
  - T1–T4 开销判定：H2/H4 vs 同 SHA H1 的稳态 CPU time/op 与 wall p99 ≤ +5%（`PROTOCOL.md:238-249` §7.1；判定规则 `:199-208` §6.4）；
  - 分位报告面与隔离档类级 CPU 归因（`PROTOCOL-v2.md:280`、`:105`）；
  - REALITY §E1 per-signal 成本归因——"instrumentation vs metric-aggregation vs export 的分量未在 granular runtime 上重推"，本目录最高优先实验（`REALITY.md:365-366`）；
  - T5/T6/T8/T9/T10 零面、span 计数、故障注入、关机预算与探针对照（`PROTOCOL.md:251-266` §7.2–§7.3）。
- **有效性前置**：每配置对比 ≥6 个有效配对重复（`PROTOCOL.md:190` §6.2）；有效配对 <6 → 该指标判 **UNKNOWN**（`PROTOCOL.md:206` §6.4）；样本不足禁止出 PASS、禁止把 INCONCLUSIVE 写成 0%（`PROTOCOL.md:275` §7.5）。当前有效配对 = 0 → **全部上述产出判 UNKNOWN**。

---

## 3. 执行现状（MEASURED）

### 3.1 轮次清单：44 segment / 0 有效

对 `out/otel-w964/workflow-audit/rounds/*/round.json` 逐轮逐段统计（本会话 python 脚本，输出完整核对）：

| 轮 | 配置顺序（round.json `order`） | segment 数 | 有效数 |
| --- | --- | --- | --- |
| round-0（pilot） | H0,H1,H2,H3,H4 | 5 | 0 |
| round-1 | H2,H3,H4,H0,H1 | 5 | 0 |
| round-2 | H4,H0,H1,H2,H3 | 5 | 0 |
| round-3 | H1,H2,H3,H4,H0 | 5 | 0 |
| round-4 | H3,H4,H0,H1,H2 | 5 | 0 |
| round-5 | H0,H1,H2,H3,H4 | 5 | 0 |
| round-6 | H2,H3,H4,H0,H1 | 5 | 0 |
| round-101 | S0,S1,S2 | 3 | 0 |
| round-102 | S2,S0,S1 | 3 | 0 |
| round-103 | S1,S2,S0 | 3 | 0 |
| **合计** | — | **44** | **0** |

44 段的 `invalidReasons` 分布（逐段字符串精确匹配计数）：**44/44 同时命中以下三条，无任何其他原因**：

1. `steady window exceeded 180s before quota completion (PROTOCOL §3.3: segment invalid)` —— 44/44；
2. `proc sampler produced no steady-window CPU pair` —— 44/44；
3. `1m loadavg <X> > 4 inside segment (§6.5 exclusion 1)` —— 44/44，X∈[4.48, 7.11]，均值 5.90。

段级测量值范围（44 段）：ops 3493–4165（均值 3856.6）；errorRate 15.508%–21.059%（均值 18.02%）；吞吐 19.307–23.054 ops/s（均值 21.35）；wallSeconds 180.054–181.349。

### 3.2 现存 aggregate.json 是先于轮次运行的陈旧产物

`out/otel-w964/workflow-audit/aggregate.json`：`rows: []`，notes 明言 `"no rounds found under …/rounds — nothing to aggregate"`。文件 mtime **2026-11-15 04:35:49 +0800**，早于最早轮产物（04:40:01）【MEASURED｜stat】；其内嵌 `generatedAt` 为 `2026-11-14T19:35:22.787Z`（= 本地 03:35:22 +0800），与文件 mtime 存在约 1 小时出入，本会话不解释该出入、按两个观察值原样记录【UNKNOWN｜成因未查】。要点：该文件的空 rows 只证明"生成时轮次目录不存在"，**不**代表后继轮次已被聚合——后继 44 段全部无效，重新聚合仍将得到 0 有效行，但该重算本会话未执行（§7 SKIPPED）。

### 3.3 协议版本与授权状态

- harness manifest 钉 **PROTOCOL v1**：`configs.json` `protocol.version="v1"`、`sha256=4eddc21683a5fae17913e35a59dbbf7dab57ebdd3429d5c22619ed31d0fee5be`、`manifestVersion=1`、`commitSha=1d689b4a2db3501810bfbfeb7b1a7c7c88c0cc65`（与 `/home/hoo/Source/exam` master HEAD 一致；audit 树 `git log -3` 实测同 SHA）【MEASURED】。
- 同目录存在 **PROTOCOL-v2**（2026-11-15 方法学评审修订，修订日志记录 v2 sha256 `e07b39d1…`，文件 mtime 03:03 早于轮次运行 04:40 起）【CODE_VERIFIED｜`PROTOCOL-v2.md:325-330`、stat】。**已执行的 44 段运行在 v1 manifest 下，而 v2 已是更新修订**——重跑前必须先裁决沿用版本（v2 §8.1 单调性：只能更严或更明确），本文件不代为裁决。
- 授权：见 §1 第 1 层。另注：harness README 记录"round/validate 完整链路未实跑、无真实运行产物"（`README.md:228-231`【转引】）——该记录撰写于轮次产物落盘之前，与 §3.1 磁盘现状的关系是"历史记录 vs 后继运行"，不是矛盾；本文件以磁盘产物为准。

---

## 4. 阻断点（每项：现象 → 机制 → 证据 → 复现）

以下 B1–B4 是 44/44 段无效的完整原因分解（与 §3.1 逐条对应；B5 是统计面封锁）。每项末尾给复现命令；本会话实际执行过的命令在 §7 标注。

### B1 —— 稳态窗内配额结构性不可完成（44/44 段）

- **规则**：稳态窗固定 180s 或配额完成先到者；配额未完成 → 段无效（`PROTOCOL.md:107` §3.3-4）。执行点：`runner.js:1874-1884`（`Date.now() - steadyStart > steadyMaxSeconds*1000` 即 push 该 invalidReason 并终止流）。
- **数字**：混合档配额合计 **12000 ops/段**（`configs.json` `workload.quotas` 逐项求和：c1 2000 + c2 2000 + c3 1000 + c4 1000（Replay 300 / Stale 400 / Conflicting 200 / Other 100）+ c5 1000 + c6 2000 + c7 2000；本会话脚本求和 = 12000）【MEASURED】；`steadyMaxSeconds=180`、`concurrency=10`、`warmupMaxSeconds=60`（同文件）。
- **观测**：44 段吞吐均值 21.35 ops/s（区间 19.31–23.05）。完成 12000 ops 需 ~562s（按均值）~520s（按最快段），**超出 180s 上限 3 倍以上** → 每段必然触发该判定。实测每段只完成 3493–4165 ops（约配额 29%–35%）即被 180s 上限截断。
- **性质**：结构性（配额 × 窗长 × 实测吞吐三者互斥），不是偶发慢段。即便 B3/B4 修复，本阻断点独立存在。
- **复现**：
  ```bash
  python3 -c "import json;q=json.load(open('scripts/perf/otel-workflows/configs.json'))['workload'];print(sum(q['quotas'].values()), q['steadyMaxSeconds'], q['concurrency'])"
  # → 12000 180 10
  python3 -c "import json;d='out/otel-w964/workflow-audit/rounds';import os;xs=[r for p in os.listdir(d) for r in json.load(open(os.path.join(d,p,'round.json')))['results']];print(min(x['throughputOpsPerSec'] for x in xs), max(x['throughputOpsPerSec'] for x in xs))"
  # → 观测吞吐区间；12000/吞吐 ≫ 180 即复现
  ```

### B2 —— CPU 主指标必然缺失：harness 采样时序缺陷（44/44 段，确定性）

- **现象**：44/44 段带 `proc sampler produced no steady-window CPU pair`。
- **机制（CODE_VERIFIED，行号实测）**：
  - `runner.js:87` `const PROC_SAMPLE_MS = 1_000;`（采样 tick 1000ms）；
  - `runner.js:142-144` `function sleep(ms)` —— 单位毫秒；
  - `runner.js:1857-1859`：启动 sampler 后 **`await sleep(60)`（60ms）** 随即取 `cpuStart = sampler.samples[sampler.samples.length - 1]`。60ms < 1000ms tick ⇒ 此时 `samples` 必为空数组 ⇒ `cpuStart` 必为 `undefined`；
  - `runner.js:1886` `cpuEnd` 取窗末样本（存在）；`runner.js:1896-1904`：`cpuStart` 为假 → 走 else 分支 push 该 invalidReason。**任何成功跑满 180s 的段都会带此原因**，与负载无关。
- **佐证（MEASURED）**：`round-0/H0/samples.json` 有 180 个样本、`cpuMs` 全部非空，时间跨度 20:42:03.981Z → 20:45:03.018Z 恰为 180s 稳态窗——首样本落在 steadyStart 后约 1s（首个 tick），而 `cpuStart` 在 +60ms 处读取，为空。**数据本身已被采样，但基线对在错误时刻捕获**。
- **影响**：CPU time/op 是 T1/T2 主验收指标（`PROTOCOL.md:163` §5、`:242-243` §7.1）。B2 不修，则即使 B1/B3/B4 全部解决，每段仍必然无效。不修 harness 而试图用现有 samples.json 离线重构 cpuStart 属于"替换测量通道"，按 `PROTOCOL.md:159` §5 须走 §8 修订，本文件不实施。
- **复现**：
  ```bash
  grep -n "await sleep(60)" scripts/perf/otel-workflows/runner.js        # :1858
  grep -n "PROC_SAMPLE_MS = " scripts/perf/otel-workflows/runner.js      # :87 = 1_000
  python3 -c "import json;s=json.load(open('out/otel-w964/workflow-audit/rounds/round-0/H0/samples.json'))['samples'];print(len(s), s[0]['t'], s[-1]['t'], all(x['cpuMs'] is not None for x in s))"
  # → 180 '2026-11-14T20:42:03.981Z' '2026-11-14T20:45:03.018Z' True
  ```

### B3 —— 宿主干扰：44/44 段 1m loadavg > 4.0（§6.5-1 硬剔除）

- **规则**：段内任一 1m loadavg 采样 > 4.0 → 段作废（`PROTOCOL.md:216-217` §6.5 硬剔除 1；4.0 ≈ 20 逻辑 CPU 的 ~20%，quiet-machine 要求见 `:186` §6.1）。执行点：`runner.js:89` `LOADAVG_HARD_LIMIT = 4.0`、`runner.js:1913-1916`。
- **观测**：44/44 段触发；段内 max(load1) ∈ [4.48, 7.11]，均值 5.90【MEASURED｜逐段 invalidReasons 提取】。`round-0/H0/samples.json` 内 load1 min/max = 3.32/5.88，首样本（窗起始 +1s）已达 5.26【MEASURED】。当前（运行结束后 08:31）`/proc/loadavg` = `0.08 1.91 3.79`、`nproc` = 20【MEASURED】——宿主此刻安静，但 04:40–08:26 运行窗内 44/44 全超，说明**该窗口内本机不满足 quiet-machine 纪律**。
- **性质与边界**：负载来源本会话**未定位**（UNKNOWN）。候选因素包括 harness 自身（并发 10 的 load generator + API + PostgreSQL 同机）、宿主侧其他负载（v2 §2.3 WSL2 宿主侧盲区）。不猜测归因；仅记录：在该环境下 C=10 档实测 load1 稳定越过 4.0，阈值是否可达属 Owner 裁决（v1 阈值冻结，修改须走 §8 修订）。
- **复现**：
  ```bash
  python3 - <<'EOF'
  import json,os
  d='out/otel-w964/workflow-audit/rounds'; ls=[]
  for p in os.listdir(d):
      for x in json.load(open(os.path.join(d,p,'round.json')))['results']:
          for s in x['invalidReasons']:
              if 'loadavg' in s: ls.append(float(s.split('loadavg ')[1].split(' >')[0]))
  print(len(ls), min(ls), max(ls), round(sum(ls)/len(ls),2))
  EOF
  # → 44 4.48 7.11 5.9
  ```

### B4 —— oracle 正确性失败 15.5%–21.1%（§4.2 整段作废；独立于 B1–B3 足以作废全部段）

- **规则**：任一 oracle 字段不符 = 正确性失败 → 不得剔除该样本、**整个 segment 作废**（`PROTOCOL.md:153` §4.2；§6.4 `:210`）；错误率 >1% 是资源耗尽标记（`PROTOCOL.md:121` §3.4）。实测段错误率 15.508%–21.059%，全部远超。
- **观测明细（round-0/H0 全量 ops.jsonl 逐行分类，4480 ops = 500 warmup + 3980 steady，731 violations）**【MEASURED】：

  | op 类 | 次数 | 观测形态 |
  | --- | --- | --- |
  | heartbeat | 360 | 期望 200 {ok,serverNow}，得 409 INVALID_STATE_TRANSITION"当前状态不允许执行此操作" |
  | takeUnchanged | 210 | attempt 被改写（status=graded，submittedAt 聚集在 2026-11-14T20:40:32 ≈ 稳态窗开始前 ~90s，即 warmup 窗内） |
  | login | 50 | 期望 200，得 401 AUTH_INVALID_CREDENTIALS |
  | takeFrozen | 39 | submittedAt ≠ effectiveDeadline（业务 deadline 权威被违反的断言失败） |
  | saveAccepted | 30 | 期望 accepted:true，得 200 accepted:false ATTEMPT_ALREADY_SUBMITTED |
  | saveStale / saveReplay / saveConflicting / saveFuture | 16/14/11/1 | 期望 reason STALE_VERSION / 幂等 accepted / CONFLICTING_PAYLOAD / FUTURE_VERSION，均得 ATTEMPT_ALREADY_SUBMITTED |

- **机制假说（标注为假说，非已证）**：与观测一致的读法是**后台 deadline auto-submit（W09 scanner，`DEADLINE_SCAN_INTERVAL_MS=5000`，`configs.json` sharedEnv）在 warmup/稳态窗内把 workload 池中本应保持 in-progress 的 attempt 置为终态**——heartbeat 409、takeUnchanged 被改写、save* 全部回退 ATTEMPT_ALREADY_SUBMITTED 三类形态同指向；heartbeat disrupt 扫描器已用 `HEARTBEAT_TIMEOUT_MS=7200000`（2h）显式中性化（sharedEnv note 原文"can never race the workload pools"），故上述改写不来自 disrupt 路径。旁证：round-0/H0 终态 `deadlineSubmitted=338` > W09 fixture `staleW09=200`【MEASURED｜segment-summary.json】。**哪些池重叠、为何 deadline 已过，本会话未深入 runner 制备代码核验 → 修复定位为 UNKNOWN。**
- **边界声明**：这些失败证明的是**fixture/harness 与运行时后台活动的失配导致段无效**；在根因定位前，它们**不构成任何产品缺陷或遥测缺陷的证据**，也不得读作"某形态业务行为错误"。
- **另一 fixture 交互（harness 自记）**：round-0/H0 notes：`W11: retention startup pass deleted the ≥30d fixture (rows==0 after boot)`——retention 启动 pass 在采样前清空了 W11 fixture【MEASURED｜segment-summary.json notes】。
- **login 401×50**：根因未定位（UNKNOWN），修复前 C2 login 数据不可信。
- **复现**：
  ```bash
  python3 - <<'EOF'
  import json,collections
  c=collections.Counter()
  for line in open('out/otel-w964/workflow-audit/rounds/round-0/H0/ops.jsonl'):
      line=line.strip()
      if line:
          r=json.loads(line)
          for v in r['violations']: c[r['op']]+=1
  print(dict(c))
  EOF
  # → {'login': 50, 'takeUnchanged': 210, 'heartbeat': 360, 'takeFrozen': 39, 'saveStale': 16, 'saveReplay': 14, 'saveConflicting': 11, 'saveAccepted': 30, 'saveFuture': 1}
  ```

### B5 —— 统计与判定面封锁（无有效配对 → 一切判定 UNKNOWN）

- 有效配对 = 0 < 6 → 每个配置对判 **UNKNOWN**（`PROTOCOL.md:206` §6.4）；预算规则下"如实报 UNKNOWN，不得以 4–5 个配对出 PASS"（`:211`），更不得以 0 个出任何判定；`§7.5`（`:275`）禁止把 INCONCLUSIVE 写成 0%。
- 对照 v2 采样预算（每统计单元 ≤12 segment 尝试，`PROTOCOL-v2.md:342` 修订条目 10）：H 组已耗 7/12、S 组 3/12——**预算未耗尽，但 B2 未修复前继续消耗预算只会重复产出无效段**。
- 附带：T5（Off 态 30min 网络零面）、T6（每请求恰 1 server span 实测计数）、T8（故障注入）、T9（关机 30s 预算——段级 shutdown 数据存在，round-0/H0 229ms exit 0，但整段无效后仅可作背景参考）、T10（#994 探针对照）在有效轮为零的现状下**均无判定依据，全部 UNKNOWN**。

---

## 5. 归因表 —— 无（显式空）

按 ask 约束，本文件**不呈现任何归因数值表**：当前不存在一行可填数据。若未来解除阻断，应产出的字段（aggregate 契约，`scripts/perf/otel-workflows/README.md:74-75`）为 `workflow, config, comparable, cpuDeltaPct, p50DeltaPct, p95DeltaPct, p99DeltaPct, rssDeltaMb, ciLow, ciHigh, n`——在 ≥6 有效配对轮被聚合出之前，这 11 个字段对每个 (workflow × config) 单元**均不存在**。现存 `aggregate.json` 的 `rows: []` 与此一致（但其生成先于轮次，见 §3.2）。

对已执行 44 段的原始观测值（ops/吞吐/错误率/loadavg/p50/p95/p99/RSS），本文件仅在 §3.1/§4 给出范围级汇总用于刻画阻断点；**这些数字来自无效段，禁止用于任何 H2/H4 vs H1 的开销推断**（§7.5）。

---

## 6. 解除阻断条件（按依赖顺序）

1. **修 B2（harness 缺陷，最高优先且低成本）**：`runner.js:1858` 的 `await sleep(60)` 改为等待 ≥ `PROC_SAMPLE_MS`（如 `await sleep(2 * PROC_SAMPLE_MS)`），或把 `cpuStart` 改取窗口内首个实际样本；以 pilot 轮验证 `cpuMsPerOp` 字段出现。
2. **解 B1（需协议修订决策，不可在采样中途改）**：三选一并按 `PROTOCOL.md:279` §8（或 v2 §8.2 采样开始前通道）落 vN：降低配额至 180s×实测吞吐可达、延长 `steadyMaxSeconds`、或经 K_pilot 程序提高并发档（`PROTOCOL.md:119-121` §3.4）。
3. **解 B3（quiet-machine）**：定位并消除运行窗内宿主负载（含评估 harness 自身贡献）；若 4.0 阈值在该环境 C=10 下不可达，阈值修订属 §8 权限，交 Owner 裁决，本文件不代改。
4. **解 B4（fixture×后台活动隔离 + login 401 根因）**：使 workload 池与 deadline scanner 活动互斥（池选择或扫描窗口），定位并修复 login 401×50，复核 W11 retention 与 fixture 时序；全部属 harness/fixture 层修改，不改产品代码。
5. **补协议层前提**：Stage D–G 采样授权留痕（`PROTOCOL.md:4`）；裁决 manifest 协议版本（v1 4eddc216… vs v2 e07b39d1…，v2 §8.1 单调性约束）。
6. **重跑后**：pilot 轮确认单段 `valid:true` → 正式轮至每配置 ≥6 有效配对 → `runner.js aggregate` → 此时才允许生成 §5 所列字段的真实归因表。

---

## 7. 本会话验证清单

**MEASURED（本会话实际执行）**：

1. 逐轮逐段有效性普查（python over `rounds/*/round.json`）：44 段 / 0 有效 / 三类原因各 44 / loadavg 4.48–7.11；
2. 段级指标范围统计（ops/errorRate/throughput/wallSeconds，44 段）；
3. `configs.json` 配额求和 = 12000、steadyMaxSeconds=180、concurrency=10、sharedEnv 全量 dump、manifest 协议钉 v1 sha 与 commitSha；
4. `round-0/H0/samples.json` 检查：180 样本、cpuMs 非空率 100%、首末样本时间戳、load1 min/max；
5. `round-0/H0/ops.jsonl` 全量违规分类（按 op 类计数 + 形态摘录）；
6. `round-0/H0/segment-summary.json` 通读（invalidReasons、notes、终态计数）；
7. 文件时间线：aggregate.json mtime 04:35:49 < 最早轮产物 04:40:01 < 最晚 08:26:52（stat）；
8. `node --version` v24.15.0；`node --check runner.js`、`node --check otlp-sink.js` 均 OK；
9. `nproc`=20、`cat /proc/loadavg`=0.08 1.91 3.79（运行结束后）；`.gitignore:77` `out/`；
10. audit 树 `git status --short` / `git log -3`（HEAD=1d689b4a，research 目录 untracked）；
11. 源码定位：`runner.js:87,89,142-144,1853-1859,1874-1884,1896-1904,1913-1916`；`PROTOCOL.md` §1.1/§3.3/§4.2/§5/§6/§7 对应行；`PROTOCOL-v2.md:4,105,280,314-346`；`REALITY.md:365-366`；`README.md`（harness）全篇；`WORKFLOW-INVENTORY.md` §1 组件行。
12. §4 B1/B2/B3/B4 的复现命令块已按本文件所载原文逐条执行，输出与所载"预期输出"逐字一致（B4 的 dict 键序为首次出现序，已按实测更正）。

**SKIPPED / 未执行（如实声明）**：

1. `node scripts/perf/otel-workflows/runner.js selftest` —— 需 DB 与三次真实 boot；README:217-222 记录的 2026-11-15 selftest PASS 本会话**未复核**【转引】。
2. `node scripts/perf/otel-workflows/runner.js aggregate` —— 会覆写 `out/` 现存 aggregate.json 证据；预期结果（rows=[]、全部段因 invalid 被剔除、n=0）由 §3.1 普查推得，未实际重算。
3. `runner.js validate --round N` —— Oracle 重放 + 末段 live DB 复核，触 `exam_e2e_w964`；本轮阻断刻画不需要，未执行。
4. B4 机制假说的 runner 制备代码深核（池重叠定位）、login 401 根因、B3 负载来源定位、aggregate.json generatedAt 与 mtime 1 小时出入的成因 —— 均 UNKNOWN，未调查至结论级。
5. 数据库连通性、Docker 状态、GitHub/CI 查询 —— 与本阻断刻画无关，未触碰。

---

## 8. 文件地位

- 本文件是**阻断状态记录**，不是实验结果。它取代任何"归因数字已产出"的暗示；也不预言重跑结果。
- 与 `PROTOCOL.md`/`PROTOCOL-v2.md` 的关系：协议仍为唯一实验契约；本文件仅记录"契约规定的产出面当前为零"及原因。
- 与 `REALITY.md` §E1 的关系：E1（per-signal 归因）保持最高优先 UNKNOWN；其"无可复现脚本（协议只在 untracked out/）"的前置（`REALITY.md:366`）已由 harness 落成（`scripts/perf/otel-workflows/`，untracked）部分解除，但"可运行"未转化为"有有效数据"。

---

## 9. 复核轮交叉注记（裁决分析员，2026-11-15；只加注记不改上文数字）

1. **44 vs 45 的时点解释（跨文档口径收敛）**：本文件 §1/§3.1 的"44 segment"撰写于 round-20 完成之前（本文件 mtime 08:43 < round-20 目录 mtime 09:10，stat 实测）。磁盘终态为 **45 个已记录 result**（11 轮目录逐轮 python 普查）+ 1 个中断段目录 `round-20/H2`（仅有 ops/日志、无 round.json 结果与 samples.json）。终态口径以 `PERFORMANCE-REPORT.md` §2.2 为准；§7-2 所记"aggregate 重算 SKIPPED"已被后继裁决会话实际执行（官方 `runner.js aggregate`，覆写前陈旧内容已先读并记录于 §3.2 与 PERFORMANCE-REPORT §2.1），重算结果与本文件 §3.1 推得一致（rows=[]、0 有效）。
2. **协议哈希双口径说明**：本文件 §3.3 所记 manifest 钉 v1 `sha256=4eddc216…` 为**内容哈希口径**（按修订日志约定"去除 §修订日志节"：`awk '/^### 修订日志$/{exit} {print}' PROTOCOL.md | sha256sum` → `4eddc21683a5fae17913e35a59dbbf7dab57ebdd3429d5c22619ed31d0fee5be`，复核轮实测成立）；而 PROTOCOL.md **全文件** `sha256sum` = `8bc7f7cd…`（ask 提供口径）。v2 修订日志自记 `e07b39d1…` 同法实测成立。两组值各自为真、口径不同，冻结正文未被篡改——不得将 8bc7f7cd ≠ 4eddc216 误读为协议文件被改。
