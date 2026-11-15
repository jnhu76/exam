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
- **协议哈希（v4，当前生效预注册；v3 修订轮 2026-11-15 21:42 +08:00 追加）**：PROTOCOL-v4.md 全文件 `sha256sum` = `1605a7ca79ff5fef4554989b1f0cef8c5851f6bf89fb24b800aec3c883a55059`（本会话实测）；harness manifest `configs.json` protocol 钉已指 v4（内容口径 `6739a741…`，本会话实读）。**v1（`8bc7f7cd…`）/v2（`7feefa72…`）/v3（全文件 `b564ba6a…`）全文与哈希原样保留**（三者本会话 `sha256sum` 实测逐字节一致）；**v4 为当前生效预注册**（Owner 2026-11-15 代理裁决选项 (c)，留 Owner 复核，`PROTOCOL-v4.md:3,34-41`）。§1–§9 为 v1/v2 时点记录原样保留；**v3 归因结果只在 §10 分区呈报**。
- **v3 状态（分区声明）**：v1/v2 的 **BLOCKED** 判定与 §1–§9 全部内容原样保留、不回溯翻案；v3 分区（`out/otel-w964/workflow-audit-v3/`）**仍未取得有效配对**（mixed=0/isolated=0/knee=0；仅 1 个 knee H1@c50 harness-valid 基线段）→ **组件级归因维持 INCONCLUSIVE**，见 §10。

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

- **规则**：稳态窗固定 180s 或配额完成先到者；配额未完成 → 段无效（`PROTOCOL.md:107` §3.3-4）。执行点：`runner.js:1874-1884`（撰写时点工作树行号；HEAD `7a2de31e` 实测 `steadyStart`=:1868、超窗判定=:1884、push=:1888，机制不变——`Date.now() - steadyStart > steadyMaxSeconds*1000` 即 push 该 invalidReason 并终止流；现行工作树经 R2 重构对应 `:2662-2666`）。
- **数字**：混合档权威配额 = **11000 ops/段**（`configs.json` `workload.quotas` 分解：c1 2000 + c2 2000 + c3 1000 + c4 1000（组总额，= Replay 300 / Stale 400 / Conflicting 200 / Other 100 之和，**不重复计入**）+ c5 1000 + c6 2000 + c7 2000 = 11000；`buildOpPlan` 只 push 16 个逐类键——R2-02 权威口径，`PROTOCOL-v3.md:21`、HEAD `7a2de31e` `runner.js:1392-1420` 实证）。撰写时点朴素 17 键 dict 求和 = 12000，系把 c4Rejects 组总额**重复计入**的口径错误【MEASURED（求和本身实测成立），但作为权威配额引用是错的——v3 复核轮修正】；`steadyMaxSeconds=180`、`concurrency=10`、`warmupMaxSeconds=60`（同文件）。
- **观测**：44 段吞吐均值 21.35 ops/s（区间 19.31–23.05）。完成 11000 ops 需 ~477–570s，最快段**超出 180s 上限 ≥2.65×** → 每段必然触发该判定。实测每段只完成 3493–4165 ops（≈权威配额 31.8%–37.9%）即被 180s 上限截断。【v3 复核轮修正（2026-11-15）：初版按 12000 口径写 "~562s/~520s、超窗 3 倍以上、约配额 29%–35%"——且同句分解求和（=11000）与"脚本求和=12000"自相矛盾——已按 R2-02 权威口径 11000 改写；结构性结论（配额×窗长×吞吐互斥）不变。】
- **性质**：结构性（配额 × 窗长 × 实测吞吐三者互斥），不是偶发慢段。即便 B3/B4 修复，本阻断点独立存在。
- **复现**：
  ```bash
  python3 -c "import json;q=json.load(open('scripts/perf/otel-workflows/configs.json'))['workload'];print(sum(q['quotas'].values()), q['steadyMaxSeconds'], q['concurrency'])"
  # → 12000 180 10（朴素 17 键和，含 c4Rejects 组总额重复计入——非权威配额）
  python3 -c "import json;q=json.load(open('scripts/perf/otel-workflows/configs.json'))['workload']['quotas'];print(sum(v for k,v in q.items() if k!='c4Rejects'))"
  # → 11000（leaf 16 键和 = buildOpPlan 权威配额，R2-02）
  python3 -c "import json;d='out/otel-w964/workflow-audit/rounds';import os;xs=[r for p in os.listdir(d) for r in json.load(open(os.path.join(d,p,'round.json')))['results']];print(min(x['throughputOpsPerSec'] for x in xs), max(x['throughputOpsPerSec'] for x in xs))"
  # → 观测吞吐区间；11000/吞吐 ≫ 180 即复现（最快 477/180 ≈ 2.65×）
  ```
  【v3 复核轮注记：第二条命令为本轮新增的权威口径复现；`configs.json` 现行工作树已按 v4 §3 等比缩放——对现行 manifest 运行第一条将得 `2290 300 1`（naive 2100+190 组总额，本轮实测）、第二条得 `2100`（leaf 和 = 现行 buildOpPlan 权威配额）；历史段判定以 v1/v2 时点 manifest 为准（11000/180/10）。】

### B2 —— CPU 主指标必然缺失：harness 采样时序缺陷（44/44 段，确定性）

- **现象**：44/44 段带 `proc sampler produced no steady-window CPU pair`。
- **机制（CODE_VERIFIED，行号实测）**：
  - `runner.js:87` `const PROC_SAMPLE_MS = 1_000;`（采样 tick 1000ms；撰写时点与 HEAD `7a2de31e` 一致）；
  - `runner.js:142-144` `function sleep(ms)` —— 单位毫秒；
  - `runner.js:1857-1859`：启动 sampler 后 **`await sleep(60)`（60ms）** 随即取 `cpuStart = sampler.samples[sampler.samples.length - 1]`。60ms < 1000ms tick ⇒ 此时 `samples` 必为空数组 ⇒ `cpuStart` 必为 `undefined`；
  - `runner.js:1886` `cpuEnd` 取窗末样本（存在）；`runner.js:1896-1904`：`cpuStart` 为假 → 走 else 分支 push 该 invalidReason。**任何成功跑满 180s 的段都会带此原因**，与负载无关。
  - 【v3 复核轮行号注记（2026-11-15）：除 `:87` 外的上文行号为撰写时点工作树行号（先于 HEAD 提交，与 HEAD 相差 +8~+9 行，成因未查 UNKNOWN）；HEAD `7a2de31e`（2026-11-15T11:02+08:00）实测：`sleep(60)`=:1866、`cpuStart` 取值=:1867（紧随其后）、CPU-pair invalid push=:1911（`:1896-1904` 对应）；现行工作树经 R2-01 重构 `sleep(60)` 已移除、fail-closed 采样判定矩阵替代。机制本身（60ms < PROC_SAMPLE_MS ⇒ cpuStart 必空 ⇒ 必走 invalid）经 HEAD 源码逐行复核成立。】
- **佐证（MEASURED）**：`round-0/H0/samples.json` 有 180 个样本、`cpuMs` 全部非空，时间跨度 20:42:03.981Z → 20:45:03.018Z 恰为 180s 稳态窗——首样本落在 steadyStart 后约 1s（首个 tick），而 `cpuStart` 在 +60ms 处读取，为空。**数据本身已被采样，但基线对在错误时刻捕获**。
- **影响**：CPU time/op 是 T1/T2 主验收指标（`PROTOCOL.md:163` §5、`:242-243` §7.1）。B2 不修，则即使 B1/B3/B4 全部解决，每段仍必然无效。不修 harness 而试图用现有 samples.json 离线重构 cpuStart 属于"替换测量通道"，按 `PROTOCOL.md:159` §5 须走 §8 修订，本文件不实施（后继 R2-01 已按正规通道修复，见 §10.2）。
- **复现**：
  ```bash
  git -C /home/hoo/Source/exam-otel-audit show HEAD:scripts/perf/otel-workflows/runner.js | grep -n "await sleep(60)"   # HEAD → :1866（撰写时点工作树 → :1858；R2-01 修复后现行工作树无命中）
  grep -n "PROC_SAMPLE_MS = " scripts/perf/otel-workflows/runner.js      # 撰写时点/HEAD → :87 = 1_000（现行工作树 → :93）
  python3 -c "import json;s=json.load(open('out/otel-w964/workflow-audit/rounds/round-0/H0/samples.json'))['samples'];print(len(s), s[0]['t'], s[-1]['t'], all(x['cpuMs'] is not None for x in s))"
  # → 180 '2026-11-14T20:42:03.981Z' '2026-11-14T20:45:03.018Z' True
  ```

### B3 —— 宿主干扰：44/44 段 1m loadavg > 4.0（§6.5-1 硬剔除）

- **规则**：段内任一 1m loadavg 采样 > 4.0 → 段作废（`PROTOCOL.md:216-217` §6.5 硬剔除 1；4.0 ≈ 20 逻辑 CPU 的 ~20%，quiet-machine 要求见 `:186` §6.1）。执行点：`runner.js:89` `LOADAVG_HARD_LIMIT = 4.0`（撰写时点与 HEAD `7a2de31e` 一致）、剔除判定块 `runner.js:1913-1916`（撰写时点工作树行号；HEAD 对应 `:1923`——loadavg push 携带同一常量；现行工作树已按 PROTOCOL-v4 §2 改为 `LOADAVG_HARD_LIMIT = 8.0` 绝对上限 + `SELF_LOAD_BASELINE = 6.8` + 外部增量判据，`runner.js:106-111`）。
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

1. **修 B2（harness 缺陷，最高优先且低成本）**：`runner.js:1858` 的 `await sleep(60)` 改为等待 ≥ `PROC_SAMPLE_MS`（如 `await sleep(2 * PROC_SAMPLE_MS)`），或把 `cpuStart` 改取窗口内首个实际样本（:1858 为撰写时点工作树行号，HEAD `7a2de31e` 对应 `:1866`，见 §4 B2 注记）；以 pilot 轮验证 `cpuMsPerOp` 字段出现。
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
3. `configs.json` 配额 17 键朴素求和 = 12000（含 c4Rejects 组总额重复计入；**权威配额 = buildOpPlan 派生 11000**，R2-02 修正，见 §4 B1 注记）、steadyMaxSeconds=180、concurrency=10、sharedEnv 全量 dump、manifest 协议钉 v1 sha 与 commitSha；
4. `round-0/H0/samples.json` 检查：180 样本、cpuMs 非空率 100%、首末样本时间戳、load1 min/max；
5. `round-0/H0/ops.jsonl` 全量违规分类（按 op 类计数 + 形态摘录）；
6. `round-0/H0/segment-summary.json` 通读（invalidReasons、notes、终态计数）；
7. 文件时间线：aggregate.json mtime 04:35:49 < 最早轮产物 04:40:01 < 最晚 08:26:52（stat）；
8. `node --version` v24.15.0；`node --check runner.js`、`node --check otlp-sink.js` 均 OK；
9. `nproc`=20、`cat /proc/loadavg`=0.08 1.91 3.79（运行结束后）；`.gitignore:77` `out/`；
10. audit 树 `git status --short` / `git log -3`（HEAD=1d689b4a，research 目录 untracked）；
11. 源码定位：`runner.js:87,89,142-144,1853-1859,1874-1884,1896-1904,1913-1916`（撰写时点工作树行号；HEAD `7a2de31e` 实测对应 :87/:89/:142-144 不变，:1866-1867/:1868-1888/:1910-1911/:1923——见 §4 B1/B2/B3 注记）；`PROTOCOL.md` §1.1/§3.3/§4.2/§5/§6/§7 对应行；`PROTOCOL-v2.md:4,105,280,314-346`；`REALITY.md:365-366`；`README.md`（harness）全篇；`WORKFLOW-INVENTORY.md` §1 组件行。
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

---

## 10. v3 归因章节（R2 修复与重跑；未取得有效配对，维持 INCONCLUSIVE；2026-11-15 21:42 +08:00）

> **分区纪律**：本节只使用 `out/otel-w964/workflow-audit-v3/` 分区数据；§1–§9 的 v1/v2 记录原样保留、不回溯翻案，其数字只作参考不作归因。

### 10.1 v3 执行状态：剖析+消融未启动，归因维持 INCONCLUSIVE（MEASURED）

- **campaign 有效配对 = 0**（mixed=0/isolated=0/knee=0，逐 campaign.json 实读，依据同 `PERFORMANCE-REPORT.md` §9.2）：mixed 被预检门拒绝（H0 §6.6-3 register 未定稿，`h0-equivalence.json` 不存在，仅 3 份 superseded 中间证据）；isolated **51 个已记录段全部无效**（49 `SEED_CONVERGE_DB_UNREACHABLE` ECONNREFUSED + 1 `SEED_CONVERGE_DB_STARTING` sweep-6/H1-iso-C1 + 1 `CPU_PAIR_FAIL_CLOSED` sweep-6/H2-iso-C1——该段 seed 收敛成功、382 ops/0 errors，因稳态窗样本 <2 fail-closed 作废，与 DB 无关；另 27 次 entry defer + 9 次 starved；`data-v3/segments.jsonl` 重算一致）；knee 6 单元仅 **1 个 H1@c50 harness-valid 基线段**，无任何处理臂（H4）有效段。
- **剖析（profiler）与消融（ablation）未启动**：其启动前置是 mixed `validPaired ≥ 6`（工作流程序序：先剖析排序候选、再顺序消融）；前置不满足 → 两个阶段整体跳过【MEASURED｜`run-meta/` 无 profile 调用（除 `profile-H0/` 一次 H0 单面 CPU/heap profile，17:50 +08:00 落盘——单面无配对，不构成归因证据）】。
- **聚合面**：`workflow-audit-v3/aggregate.json` `rows: []`（`cmdAggregate` 只读 `rounds/`，`runner.js:5201-5244`；campaign 单元聚合桥 §6.5(a) 未落地）；`rounds/` 空【MEASURED】。
- **结论**：§5（"归因表——无（显式空）"）的判定在 v3 分区**原样成立**：每组件的 CPU/内存贡献份额仍无任何可呈报数字 → **维持 INCONCLUSIVE**，REALITY §E1 per-signal 归因保持最高优先 UNKNOWN。

### 10.2 v3 唯一有效段的机制见证（非归因证据）

knee H1@c50（`campaign-knee/sweep-1/H1-c50/segment-summary.json`，全字段实读【MEASURED】）：`valid:true`、ops=2100= P_QUOTA、oracle 违例 0、`cpuMsPerOp=96.2619`（B2/R2-01 CPU 采样修复生效）、`expiredInProgressAtWindowEntry=0`（B4/R2-03 窗入口守卫生效）、maxLoad1=5.64 / externalLoadIncrement=−1.16（v4 §2 双判据通过）。**它证明的是 harness 修复链成立，不是任何组件的成本**；其为 H1（Off）基线、无配对、且 freeze.json 缺席（非预注册正式单元），禁止用于组件成本推断。

### 10.3 v3 组件归因表（成本列全部 INCONCLUSIVE；Confidence 与 Risk of removal 如实分列）

组件清单与接线事实沿用 `GAPS-AND-PRIORITIES.md` §8.2 处置分级（该表价值侧已证实、成本侧未测，v3 无变化）。**CPU/Allocation contribution 两列在 v3 无数字**（0 有效配对 + 消融未启动），一律 `INCONCLUSIVE`；禁止机械相加冒充总分。Confidence 双轴标注：接线/存在性（代码可证）vs 成本占比（无数据）。Risk of removal = 若移除/裁剪该组件将失去的已证能力（依据 COVERAGE-MATRIX 覆盖态，非成本判断）。

| Component | Evidence | CPU contribution | Allocation contribution | Affected workflows | Confidence | Optimization opportunity | Risk of removal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OTel SDK 核心 + @fastify/otel request/handler span | `runtime.ts:208` Off 早返回【CODE_VERIFIED】；W00–W14 request/handler 面运行见证【转引｜campaign】 | **INCONCLUSIVE** | **INCONCLUSIVE** | W00–W14（全链骨架） | 接线：CODE_VERIFIED；成本占比：**UNKNOWN** | 无数据支持任何裁剪 | 失去全链 trace 骨架与 reqId↔trace 对账面（W01 G6 实证） |
| 业务操作 span 层（exam.attempt.*，businessOperationSpan） | W03/W07/W09 三证 FULL【转引｜COVERAGE-MATRIX §2.1】 | **INCONCLUSIVE** | **INCONCLUSIVE** | W02/W03/W05/W06/W07/W08/W09 | 接线：CODE_VERIFIED；成本占比：**UNKNOWN** | 同上 | 失去唯一已证 FULL 的业务 outcome 矩阵面（W03 40001/40P01、W07 全 outcome、W09 三方对账） |
| db.statement 语句 span（packages/otel-drizzle-postgresjs + scrub） | 每 accepted-save trace 19 条语句 span（最大 span 量来源）【转引｜COVERAGE-MATRIX §3-5】；H4 metric {error,40001} 序列【转引】 | **INCONCLUSIVE**（结构上是最大 span 体量候选，但成本未测） | **INCONCLUSIVE** | W03（DB 故障定位唯一通道）、全部 DB 面 | 接线：CODE_VERIFIED；成本占比：**UNKNOWN**（"最大 span 量"是结构观察，非成本证明） | 第一裁剪参数候选＝非业务语句/preHandler 读（收益未量化，仅超预算时审议） | 失去 40001/40P01/锁等待端到端定位（W03 三证 FULL 的实现面）——全清单最高移除风险 |
| scrub processors（urlScrub/exceptionScrub） | 隐私边界 P1–P4 实现面【转引】；干净面大小写不敏感复验【转引｜GAPS §5】 | **INCONCLUSIVE** | **INCONCLUSIVE** | 全部（隐私边界） | 接线：CODE_VERIFIED；成本占比：**UNKNOWN** | 无 | 隐私边界失效（泄漏面直接暴露）——不可移除 |
| 后台 loop cycle span 全量 tick 面（exam.loop.*） | span 量 ∝ tick 频率（E2：13 cycle/短窗）【转引】 | **INCONCLUSIVE** | **INCONCLUSIVE** | W09/W10/W12 | 接线：CODE_VERIFIED；成本占比：**UNKNOWN** | 独立 cycle 采样比（SLIM 候选，收益未量化） | 失去后台决策链实时对账（W09 三方对账为其核心证据面） |
| metric provider + 4 生产 metric（仅 otlp 分支，`runtime.ts:373-394`） | 每 H4 段 6 metric posts【转引】 | **INCONCLUSIVE** | **INCONCLUSIVE** | W03/W09/W10/W12 metric 面 | 接线：CODE_VERIFIED；成本占比：**UNKNOWN** | 无 | 失去 work.count/error 直方图对账面（W09/W03 证据链组成） |
| OTLP exporter + batch processor + shutdownTelemetry flush | E4–E7 故障注入业务隔离【转引】；v3 knee 段 sink 全程 mode=ok【MEASURED】 | **INCONCLUSIVE**（H4−H2 差异含 batch/序列化/编码/背压多因素，不得命名纯网络成本） | **INCONCLUSIVE** | W15/导出面 | 接线：CODE_VERIFIED；成本占比：**UNKNOWN** | 无 | 失去 OTLP 导出面与 G4 故障隔离实证对象 |
| H3 memory exporter/ring（内存环 + shutdown dump） | 7/7 段 dump=1000 全解析（v1）【转引】；有界性见证 | **INCONCLUSIVE** | **INCONCLUSIVE** | 审计见证工具（非生产信号面） | 接线：CODE_VERIFIED；成本占比：**UNKNOWN**；生产用途：**UNKNOWN** | 定位为审计工具，非生产组件 | 低（当前合同不要求；移除只损失审计 dump 见证能力） |
| exporter 自诊断面（dropSpans/diag） | 现状为零（O5）【转引】 | n/a（不存在） | n/a | W15 | 存在性：CODE_VERIFIED（零命中） | P7 最小信号面建议（owner 裁决） | n/a |
| HTTP request rate/latency metric | 不存在（O3）【转引】 | n/a | n/a | W01 等 | 存在性：CODE_VERIFIED（缺失） | 是否引入属 owner 裁决 | n/a |
| filelog→Loki leg / collector→Tempo 部署面 | 合同禁用至真机验收（E11）/ ADR-028 PROPOSED（E12）【转引】 | n/a（未部署） | n/a | 部署面 | 合同状态：CODE_VERIFIED | 无（DISABLE_BY_DEFAULT） | n/a（本就禁用） |

**表级结论**：全部成本列 INCONCLUSIVE；**无任何组件可以以成本理由移除或裁剪**——移除风险列所列能力损失均有运行级证据，而成本收益全部未测。裁剪/替换决策的执行前置不变：G1 预算实验产出 ≥6 有效配对（`GAPS-AND-PRIORITIES.md:187`）。

### 10.4 解除归因阻断的剩余条件（v4 程序序，接续 §6）

1. **完成 H0 §6.6-3 等价登记**：≥3 verified pair/workload 跨轮次 → 定稿 `h0-equivalence.json`（run3 已有 1 对 verified 证据可续；run4 因宿主 Docker 关闭即死，恢复后重跑）。
2. **§6.5(a)/(b) 机器路径落地**（campaign 聚合桥 + knee 配对键）——在此之前 `aggregate` 对 campaign 段恒 `rows: []`。
3. **写 `run-meta/freeze.json`**（v4 §6 第 3 步）→ 确认段 → 正式采样（另行授权）≥6 有效配对。
4. **剖析 + 顺序消融**（前置 = mixed validPaired ≥ 6）：候选排序按 `PERFORMANCE-REPORT.md` §9.3 矩阵产出后确定；此前任何候选排序都是结构猜测，不启动。
