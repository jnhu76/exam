# PROTOCOL-v2 — 观测性开销 A/B 实验预注册协议（v2，v1 方法学评审修订版）

- **状态**：v2 预注册协议。采样开始后，本文件全部条款均为冻结项，唯一例外是 §8.3 小版本通道（§3.4 K_pilot 落定与 §6.7 MDE 表落定）；其余修改只能按 §8.2 出 vN 新文件（旧版与旧哈希永久保留），并受 §8 总则单调性约束（只能更严或更明确，不得放宽）。第 6.4/6.5 判定与剔除阈值、第 6.6 可比性规则、第 7 节全部预算阈值为冻结核心。
- **角色与授权**：本协议由实验方法学（协议设计）角色在审计树 `/home/hoo/Source/exam-otel-audit` 内撰写；执行（Stage D–G）另行授权。本协议本身不授权任何采样、数据库或 Docker 操作。v2 依据 2026-11-15 方法学评审（13 项发现，high×1 / medium×7 / low×5）修订；v2 相对 v1 只收紧或更明确、不放宽（逐条映射见 §8 修订日志）。
- **参考输入**：同目录 `REALITY.md`（尤其 §0 基线、§3 运行态、§4 插桩语义、§8 基建与历史数据、§10『对实验设计的输入』E1–E12、§11 UNKNOWN 清单）；同目录 `WORKFLOW-INVENTORY.md`（§1 工作流矩阵含 Oracle 列、§4 高频/性能风险排序、§5 共性缺口 G1–G10、§6 抽查与未验证清单）；`docs/adr/ADR-028-opentelemetry-technical-telemetry.md`（PROPOSED，§3 表三 :93-104 为验收阈值唯一权威）；v1 版 `PROTOCOL.md` 及方法学评审意见。
- **证据等级约定**（沿用 REALITY.md 约定）：`MEASURED`＝会话实际执行的命令输出；`CODE_VERIFIED`＝会话读仓库源码/文档定位；`转引`＝来自 REALITY/WORKFLOW-INVENTORY/PR 记录等输入材料，本会话未复核；`UNKNOWN`＝无法验证，禁止当事实使用。
- **会话已执行的验证命令清单**见附录 A；未验证项汇总见附录 B。

---

## 1. 实验组与 commit SHA

### 1.1 SHA 与组定义

| 组 | SHA | SHA 身份（会话实测） | 遥测配置 | 组角色 |
| --- | --- | --- | --- | --- |
| **H0** | `cb1e614fe087e7ac158deef4a4de7f29268de292` | tag `v0.0.15`（`git describe --tags` 输出恰为 `v0.0.15`）；merge commit "Merge pull request #993 from jnhu76/release/v0.0.15"（2026-11-14 15:21 +0800）；是 H1 的祖先（`git merge-base --is-ancestor` 通过） | **唯一 arm**：仓库默认（该 SHA 无遥测代码，见 1.2）；不设置任何 `TELEMETRY_*` 变量（该 SHA 的 settings 无这些键，`git show cb1e614f:apps/api/src/config/settings.ts | grep -c TELEMETRY_` → 0） | pre-OTel 发布基线：量化"携带遥测特性代码但 Off"（H1）与"完全没有该特性"（H0）的差异，并承载 #994 修复的内存对照（§3 C8） |
| **H1** | `1d689b4a2db3501810bfbfeb7b1a7c7c88c0cc65` | `/home/hoo/Source/exam` master HEAD，`git rev-parse HEAD` 实测一致，`git status --short` 干净 | `TELEMETRY_ENABLED=false`（显式；与 unset 语义等价，`truthyLeaf` 对 unset 返回 false，`settings.ts:175-196,834`） | **同 SHA Off 基线**——全部验收开销对比的基线（§7） |
| **H2** | 同 H1 | — | `TELEMETRY_ENABLED=true`（或 `1`）+ `TELEMETRY_EXPORTER=none` | On/无导出（ADR-028 表三"On / 无导出"列）：全量 span 记录、无导出、无 MeterProvider【CODE_VERIFIED｜REALITY §3.2】；零远端导出面按 T5b 实测验收（§7.2） |
| **H3** | 同 H1 | — | `TELEMETRY_ENABLED=true` + `TELEMETRY_EXPORTER=memory` | On/内存见证：trace BSP 内存环（ring 1000、每 span ≤16 events）、无 metric 序列【CODE_VERIFIED｜REALITY §3.2】；承载 server-span 计数验收与 dump 文件 witness |
| **H4** | 同 H1 | — | `TELEMETRY_ENABLED=true` + `TELEMETRY_EXPORTER=otlp` + `TELEMETRY_OTLP_ENDPOINT=<collector 基址>`（endpoint 必填且成对，缺一/非 http(s)/含凭据/query/fragment 均 fail-fast，`apps/api/src/config/runtimeConfig.ts:776-831`） | On/完整 OTLP 导出（ADR-028 表三"On / 完整导出"列）：唯一有真 metric 序列的形态 |

共享配置（全部组）：`TELEMETRY_SERVICE_NAME=exam-api`（源码默认值，`settings.ts:835`）；其余业务/DB/Redis 环境按同一冻结 env 清单（harness 构建时固化并写入运行记录），除组定义变量与采样维度变量（1.3）外逐字节一致。

### 1.2 H0 的关键事实（决定可比性边界）

- **v0.0.15 不含遥测特性**：`git ls-tree cb1e614f --name-only apps/api/src/` 输出无 `telemetry/` 目录；`git show cb1e614f:apps/api/package.json | grep -c opentelemetry` → 0。【MEASURED】
- H1 相对 H0 的提交范围 `cb1e614f..1d689b4a` 共 **42 个提交**（`git rev-list --count` 实测），subject 逐一过滤（otel/telemetry/#964/#994/observability 之外零命中）全部属于 #964 OTel 战役（PR #973–#980，W1–W7）与 #994 修复（`f93e07ce`/`1d689b4a`）。因此 **H0↔H1 差异 = 遥测特性整体引入（Off 态携带成本）+ #994 修复**，不是单一修复的 A/B。
- 推论（冻结）：**On 态（H2/H3/H4）只在 H1 的 SHA 存在**；"H0 + On"组合不存在，任何此类比较判 `NON_COMPARABLE`（§6.6）。

### 1.3 采样敏感性维度（S）

以源码接受的配置格式为准【CODE_VERIFIED｜`apps/api/src/config/settings.ts:419-452`（`ratioLeaf`：严格 [0,1] 闭区间、`Number(trimmed)` 解析、允许小数、越界/非数值抛 `SettingsError` fail-fast 不 clamp、默认 1；`:838` `TELEMETRY_SAMPLE_RATIO: ratioLeaf(1)`）】：

| 维度 | `TELEMETRY_SAMPLE_RATIO` 值（env 字面量） | 语义 |
| --- | --- | --- |
| **S0** | `"0"` | 全部 root 决策 NOT_RECORD；但插桩 plumbing 成本仍在（cleanAttributes/shouldSample/context.with 照付，REALITY §4.2）【CODE_VERIFIED】 |
| **S1** | `"0.1"` | 10% root 采样 |
| **S2** | `"1"` | 全采样（源码默认值） |

- S 维度只施加于 On 态（H2/H4 主臂）；H0/H1（Off）无采样器效应，S 比较在 Off 态无意义（`NON_COMPARABLE`，§6.6）。H3 仅 S2（内存环容量与采样交互留待需要时修订）。
- S 子矩阵冻结为：`{H2,S0} {H2,S1} {H2,S2=主档已含} {H4,S0} {H4,S1} {H4,S2=主档已含}`，仅混合档/典型并发（§3.4），≥6 配对重复。
- 历史对照（背景，非会话实测）：PR #980 记录 pre-#994 栈上 `SAMPLE_RATIO=0` 无 CPU 改善（成本在 plumbing）【转引｜REALITY §4.2/§8.2】——本实验在 fixed stack（含 #994）上复测该结论。

---

## 2. 环境冻结

> ## ⚠️ WSL2 边界声明（显著标注，约束全部下游结论）
>
> 本实验全部运行在 **WSL2 单机开发环境**（Windows 宿主上的 Linux 子系统，Docker Desktop 链路），非生产硬件、非生产拓扑、非生产容量规模。**因此本协议产出的全部数字（CPU/p99/吞吐/RSS/collector 资源）结论等级为【探索级】：仅用于机制归因（per-signal 成本、形态间相对差、正确性验收），不冒充生产容量结论，不得直接外推为生产容量规划或生产 SLA 依据。** 生产化容量判断需要独立的生产形态复测。此前审计已有同域先例：`docs/research/db-test-post-649-perf-attribution.md` 明确 WSL2+Docker 测量能力边界【CODE_VERIFIED｜REALITY §8.3】。

### 2.1 冻结快照（ask 提供；撰写会话于 2026-11-15 复核一致）

| 项 | 冻结值 | 复核 |
| --- | --- | --- |
| Node | v24.15.0 | ✅ `node --version` |
| pnpm | 11.1.2 | ✅ `pnpm --version` |
| 内核 | `Linux WuJie 6.18.58.1-microsoft-standard-WSL2 #1 SMP PREEMPT_DYNAMIC Tue Oct 27 00:24:11 UTC 2026 x86_64 GNU/Linux` | ✅ `uname -a` 逐字段一致 |
| 逻辑 CPU | 20 | ✅ `nproc` |
| 内存 | 15Gi 总量（快照时刻 used 6.8Gi / free 5.4Gi / buff+cache 5.9Gi / available 8.7Gi；swap 4.0Gi，used 609Mi） | ✅ `free -h`（used/free/available 自然漂移 ±0.1Gi，总量与 swap 一致） |
| Docker | 29.9.3 | ✅ `docker --version` |
| Docker Compose | v5.7.0 | ✅ `docker compose version` |
| 容器拓扑 | `sharp_saha`（grafana/tempo:3.1.1，Up 40 hours）、`exam-dev-redis-1`（redis:7-alpine，Up 2 days, healthy）、`exam-dev-db-1`（postgres:18.4-bookworm，Up 2 days, healthy） | ✅ `docker ps --format …` 同名同镜像同健康态 |
| 负载基线 | 快照 1m/5m/15m loadavg 0.21/0.27/0.27 | ✅ 复核 0.20–0.24 / 0.26–0.27 / 0.27（同量级） |

- **PG 服务器版本冻结为 postgres:18.4-bookworm**（容器镜像）；实验数据库生命周期只按 `docs/standards/testing.md` §2/§2.8 契约触达测试契约所属测试库（§4.1）。
- 环境任一冻结项变化（版本、内核、CPU/内存、容器镜像与拓扑）触发 §8 修订，不静默续用。注意：`sharp_saha` 的**运行状态**自采样开始起由 §4.1 观测栈生命周期条款定义（撰写时快照仅记录其存在与镜像），其停止/启动不构成 §2.1 环境变化。

### 2.2 干扰监测基线（每 segment 前后强制记录）

记录项：1m/5m/15m loadavg（`cat /proc/loadavg`）、`free -h`、`docker stats --no-stream`（PG/Redis/collector 容器）、实验 API 进程 PID 与启动参数哈希；H4 窗另记观测栈启停状态（§4.1）。硬剔除与软标记阈值见 §6.5。

### 2.3 WSL2 测量效度声明（宿主侧盲区；v2 新增）

- §2.2 全部监测通道均为 Linux（WSL2）侧；**Windows 宿主侧负载（浏览器/系统更新/杀毒/索引服务的 CPU 挤占）对 WSL2 内 loadavg 不可见**——这是 WSL2 特有的测量效度威胁：quiet-machine 要求（§6.1）在宿主维度只能部分达成，本协议如实承认该盲区。
- 宿主侧代理通道（预冻结）：若 WSL2→Windows interop 可用（经 `powershell.exe` 调用 `Get-Counter '\Processor(_Total)\% Processor Time'`），每 segment 前后记录宿主侧总 CPU% 作代理护栏：单段 >60% → 软标记；连续两段 >60% → 暂停采样并按 §8 判定是否构成环境变化。interop 可用性 UNKNOWN（附录 B.8），不可用则本通道记 SKIPPED，且结果报告必须包含"宿主侧负载不可观测"效度声明。
- 时钟维度：WSL2 时钟漂移由 §6.5 硬剔除第 3 条（时钟跳变 >1s）覆盖。
- 本节不改变 WSL2 边界声明（探索级）的适用范围。

---

## 3. 固定 workload 定义

类别绑定按 `WORKFLOW-INVENTORY.md` §4 高频/性能风险排序（rank：W03=1、W01=2、W05=3、W10=4、W08=5、W06=6、W15=7、W02=8、W11=9、W14=10、W12=11、W00=12、W04=13、W09=14、W13=15【CODE_VERIFIED｜WORKFLOW-INVENTORY §4 表】）与 ask 指定的 8 类混合。**W13（outbound HTTP，NOT_IMPLEMENTED）与 W14（失败路径遥测，ask 8 类未单列）不在本版混合内**；如需纳入按 §8 修订。W02（start）仅作为数据制备机制（制备 in-progress attempt），不作为计量工作流。

### 3.1 类别 → 工作流绑定与操作数

| # | 类别（ask） | 绑定 W | 每段操作数/预算（冻结） | "有效操作"定义 |
| --- | --- | --- | --- | --- |
| C1 | 轻量 read/health | W00 | `GET /api/health` ×1000 + `GET /api/ready` ×1000（高频，≥1000 ✓） | 200/503 与 body 符合 §4 oracle |
| C2 | 真实 DB 读取 | W01 | `POST login` ×1000（轮换用户池 ≥100 用户）+ `GET /exams` ×1000（教师池；≥1000 ✓） | 200 + envelope + 语句计数符合 oracle |
| C3 | 高频答案保存 | W03 | `POST /attempts/:id/answers` accepted=true ×1000（≥1000 ✓） | accepted:true、serverVersion+1、receipt 行 |
| C4 | 拒绝/重复 | W04 | ×1000（≥1000 ✓）：STALE 400 / 幂等重放（零写 accepted）300 / CONFLICTING_PAYLOAD 200 / 其余拒绝（FUTURE_VERSION/DEADLINE_EXCEEDED/INVALID_ANSWER/ATTEMPT_CLOSED）100 | 拒绝形态 200 accepted:false + reason + 恰 1 WARN；重放零写 |
| C5 | Submit+Grade | W05 | fresh submit+grade ×900 + 重复 submit（alreadyGraded=true 零写）×100（≥1000 ✓） | 终态/audit/事务计数符合 oracle（§4） |
| C6 | deadline 路径 | W08 + W09 | W08：`GET take` ×1000（frozen ≥400 / unchanged ≥600）（≥1000 ✓）。W09：固定观测窗（≥10 min，默认 30s tick）内 seed 固定 200 条 stale attempt 全部被 auto-submit 且对账（低频，时间预算制） | submittedAt=effectiveDeadline；result∈{frozen,unchanged}；W09 no_op/submitted 投影一致 |
| C7 | 后台循环 + restore | W06 + W10 + W11 + W12 | W06：disrupted→`POST restore` ×1000（≥1000 ✓）。W10：`POST heartbeat` ×1000（≥1000 ✓）+ 后台 disrupt/incident 腿随段观测。W11：retention 启动 pass 观测（每段 seed ≥30d 旧 client-events 固定 10000 行，对账 deleted==10000；低频，时间预算制）。W12：password-reset enqueue ×1000（≥1000 ✓）+ fake 发送循环 drain 对账（发送模式冻结为 fake，具体配置键名 harness 构建时核实——UNKNOWN，见附录 B） | 各 W 按 §4 oracle |
| C8 | 长事务内存稳定性 | W05 freeze barrier + #994 探针 | W05 长事务（单事务 freeze barrier，持 Attempt 行锁）内存斜率：从 C5 段 RSS 时序计算，不设独立段。retention 探针（REALITY E6）：`--expose-gc` 专用 run，300 tx × 64KB 捕获，H0 与 H1 各一次（pre/post-fix 对照升级 MEASURED） | 探针存活计数与 REALITY §4.4 记录形态一致 |

每类低频项（W09 窗口、W11 启动 pass、W12 drain 对账、retention 探针、W15 关机计时）**单独时间预算、单独报告，不计入全局 p99 聚合**。

### 3.2 两种负载模式（冻结）

- **混合档**（acceptance 主档）：C1–C7 按上述配额组成单一混合流，C1–C5 为在线流、C6–C7 的 HTTP 部分并入在线流、后台循环常驻。验收判定（§7.1 T1–T4）按档位评估只用混合档。
- **隔离档**（attribution，服务 REALITY E1/E3 per-signal 归因）：单工作流独占段，仅 C3（W03）、C2（W01）、C5（W05）、C6-W08 四类，各 ≥1000 有效操作，configs 冻结为 H1/H2/H3/H4（H3 的 dump 为归因提供 span 证据）；**每 config×类 ≥6 有效配对重复（与 §6.2 同规则）**。隔离档结果不进入 T1–T4 数值判定，但按 §7.1 分位报告面强制附报并适用 FLAGGED-CLASS 规则。

### 3.3 段（segment）结构（冻结）

一个 segment = 一个配置的一次 replicate：

1. re-seed 到与其它 segment 逐字节相同的初态（§4.1），记录 checksum；
2. 启动该配置的**独立干净 API 进程**（每 segment 新进程，无跨段复用；`TELEMETRY_*` 按 §1 注入）；
3. warmup：固定 60s 墙钟（同一负载模式内所有配置臂一致；**不以操作数封顶**——避免慢臂获得更长 warmup 的非对称）；warmup 数据不入统计；每段记录 warmup 期完成操作数，配对两臂差 >20% → 软标记（预热不对称，只影响方差，不触发剔除）；
4. steady 稳态窗：混合档固定 180s（或全部配额操作完成，先到者；若配额未完成判段无效，见 §6.5）；隔离档 = 配额操作完成窗；
5. 关停：SIGTERM，记录 SIGTERM→exit 耗时与 exit code（W15/ADR-028 关机预算验收，§7.3 T9）；
6. 采集收尾：导出全部计数器、日志、dump（H3）/collector 侧（H4）产物。

### 3.4 并发档位（先估后 pilot 修正）

| 档 | 并发 | 冻结内容 |
| --- | --- | --- |
| 低 | C=1 | 混合档，H1/H2/H4，≥6 配对；**进入 T1–T4 按档合取（§7.1）** |
| 典型 | C=10 | **主评估档**：混合档全部组（H0–H4，S2）+ 隔离档 + S 子矩阵，≥6 配对；**进入 T1–T4** |
| 接近容量拐点 | C=K_pilot | 混合档，H1/H2/H4，≥6 配对；**进入 T1–T4 按档合取（§7.1）** |

- **K_pilot 先验**：W7.2 历史协议使用 lifecycle-S50 场景【转引｜REALITY §8.2】，先验取 **K_pilot≈50**。
- **pilot 程序（冻结）**：采样正式开始前，用 H1 混合档在 C∈{25,50,100,200} 阶梯各跑 1 段，取"p99 相对前档增幅首次 >2× 的档位的前一档"为 K_pilot；pilot 结果（含各档 p99 原始值）与最终 K 写入 **修订记录（v2.x 小版本记录，§8.3）**，此为预授权修订通道之一。pilot 不得修改阈值、操作数、oracle 与判定规则。
- 若 pilot 显示 C=200 仍未现拐点（资源先耗尽），以先耗尽的资源（CPU 饱和或错误率 >1%）所在档为 K_pilot 并如实记录——此时"接近容量拐点"读作"接近本 WSL2 环境资源上限"，仍受 §2 WSL2 边界声明约束。
- 低/拐点档无 H0（§6.2）：该两档仅评估 H1/H2/H4 对比，属评估面覆盖声明（§7.1）。

### 3.5 负载发生器模型（v2 新增，冻结）

- **模型**：closed-loop 固定 worker。"并发档位"（§3.4）= 固定 worker 数；每 worker 严格串行（上一响应完成后才发下一请求，无 pipelining），think time = 0ms；吞吐为被测系统的内生结果（测量值，非受控速率）。
- **工具**：harness 自有 Node 负载脚本（单一进程）。仓库当前无 committed 负载工具【CODE_VERIFIED｜REALITY §10 E1 指出无仓库内可复现脚本】——harness 必须在采样前把 load generator 与 seed 脚本落成于审计树指定目录（#964 DoD"性能 A/B 有可复现脚本"要求）；所有配置臂使用同一脚本、同一版本、同一操作 schedule 种子；两脚本的 sha256 记入运行记录。
- **混合流排布（冻结）**：按比例交织——每个在线 worker 按 §3.1 配额归一化的冻结权重表抽取下一操作类；**禁止分块相位**（blocked phases，如"先全部 health 再全部保存"）；配对两臂执行逐请求一致的确定性 schedule（同种子），消除类位置×段内漂移混淆。后台循环（heartbeat/scanner/outbox/retention 启动 pass）全程常驻。
- **可比性声明**：#980 历史数字的负载模型未在仓库内定义——该不可比性是 §6.6-5 背景声明的组成部分；本节模型产出的数字不与其直接并排比较。

---

## 4. 数据集初始化与 Oracle

### 4.1 数据集生命周期（所有权冻结）

- 唯一数据库契约：`docs/standards/testing.md` §2/§2.8【CODE_VERIFIED｜撰写会话已读】。实验数据集只落在 §2.8 契约内的测试库（`exam_test` 家族或显式 operator 声明的 `TEST_DATABASE_URL` 目标，名字守卫 test/e2e/ci）。**禁止触达 dev `exam` 库与人工开发数据；禁止用 demo seed 污染测试库**（`pnpm db:seed:demo` 只 seed dev 库，testing.md §2.8 表）【CODE_VERIFIED】。
- PG 服务器经仓库语义命令 `pnpm db:up`（docker-compose.dev.yml）提供【CODE_VERIFIED｜testing.md §2.8 表第一行】。
- **观测栈生命周期（v2 冻结）**：collector/tempo/grafana（含既有 `sharp_saha` tempo 容器）**仅 H4 segment 运行窗内启动**；非 H4 segment 与全部 T5/T5b 审计窗**停止**，启停状态记入 segment 基线记录（§2.2）。H4 组数字因此**包含同宿主 collector 的资源成本**——collector 是被测配置（完整 OTLP 导出形态）的组成部分，非混淆变量；H0–H3 组不承载该负载，组间背景不对称是设计使然，报告时注明。`sharp_saha` 在 §2.1 撰写时快照中的常驻状态自采样起由本条款取代；观测栈启停属实验资源操作，在采样授权下执行，run 结束恢复快照原状并记录。otelcol.yaml/compose 行级参数撰写会话未复核——转引 WORKFLOW-INVENTORY §6.1，harness 构建时必须先核实并记录。
- **每 segment 前 re-seed 到相同初态**：harness 自有确定性 seed 脚本（同一 seed token + 同一操作序列）；seed 完成后对种子表做行数/校验和记录，checksum 与期望不符 → 该 segment 判无效（§6.5），不得带病采样。
- seed 覆盖冻结：用户/教师池（C2 轮换）、in-progress attempts（C3/C5/C6 用，含每 attempt 题目快照）、disrupted attempts（C6-W06，backdate `last_activity_at`）、stale candidates（W09 窗口 200 条）、≥30d client-events（W11 10000 行）、outbox 可用态（W12）。所有 backdate/状态制备通过 harness seed 脚本直写测试库完成（制备属测试数据，不绕过运行时状态机——业务操作本身全部走 HTTP API）。

### 4.2 Oracle（每工作流，按 WORKFLOW-INVENTORY §1 Oracle 列核对）

判定面统一为四元组：**状态码 + 业务结果 + 事务/语句计数 + receipt/持久化**。下表为各绑定 W 的 oracle 要点（原文权威 = WORKFLOW-INVENTORY §1 对应行，本表为执行核对清单；标注〔转引〕者为盘点文件转写，执行时以盘点文件行为准）：

| W | 状态码/业务结果 | 事务/语句计数 | 持久化/audit/receipt |
| --- | --- | --- | --- |
| W00 | /health 200 无认证 0 条 DB 语句；/ready 200 {status:"ready"} 或超预算 503 且 body 只含 gate answer；事务计数 /ready 恰 1 SELECT、/health 0 | 如左 | 探针零 audit_logs 行〔转引〕 |
| W01 | 统一 401 同文（未知/停用/错密/无 authority）；authority 故障 503 AUTHZ_UNAVAILABLE；login/me/list 200 正常路径 | exam-list 语句计数 =1(scope)+2(page+count)+1(enrollments)+Σ每考试 2N；login/me/list 零显式事务 | login.success/failure 落 audit_logs（best-effort）〔转引〕 |
| W03 | 200 {accepted:true, serverVersion=旧+1, savedAt=服务端时钟}；rejected 形态见 W04 | NEW accept ≥4 语句、恰 1 UPDATE answers + 1 INSERT receipt 同事务；幂等重放零写仍 accepted | receipt 行落库；崩溃窗口=0 |
| W04 | 拒绝一律 200 accepted:false + reason∈SaveAnswerRejectReasonEnum（仅 STALE 附 details.serverAnswer）；每拒绝恰 1 WARN 且 reqId==x-request-id；重放（同 clientSeq 同 payload）accepted 零写 | 重放零写；其余拒绝零写 | 无持久 refusal（#861 有意）；痕迹=WARN+span（On 态） |
| W05 | fresh submit 200；重复 submit alreadyGraded=true；auto_graded 已终态再 grade-question →409 + span rejected + error_code=INVALID_STATE_TRANSITION | fresh submit 恰 1 事务（freeze barrier）；重复 submit 零写零 audit | 恰 1 行 attempt.submit audit；grade-question 1–2 行 audit |
| W08 | frozen：submittedAt=computeEffectiveDeadline（业务 deadline 非读时刻）、result=frozen；未到期 result=unchanged；已 submitted/graded 幂等不变 | 每请求恰 1 事务（repeatable read，40001/40P01 整事务重试） | audit_logs 恒 0 行（attempt.autoSubmit deprecated）；clientSeqByQuestion=receipt MAX 种子 |
| W06 | restore 200 {lifecycle∈restored/already_in_progress/terminal, compensation}；bounded_grace 恰 1 条 attempt_time_adjustments、重放复用同 adjustmentId；过期→同事务冻结 | restore 走 executeInTransaction | restore/take audit 恒 0 行（有意）；域证据=interruption episodes/events 每 episode 恰一 outcome |
| W09 | stale discovery=合法 no_op；result∈{submitted,skipped}；extendExam 竞态两线性化均合法 | 每 tick 恰 1 rooted cycle span + 每候选恰 1 事务 | audit_logs 恒 0 行（负例已钉）〔转引〕 |
| W10 | heartbeat 200 {ok,serverNow==路由单次 now}；非 in_progress→409 且 0 行更新；每 stale attempt 恰 1 episode+1 detected；重复 cycle 只 replay | 每 tick org×listInProgress 扫描 + 每 stale attempt 一事务 | 每已提交 episode 恰 1 System incident + 同事务恰 1 atomic audit 行 |
| W11 | 摄入 accepted==批大小（dedup 计 accepted）；不可证明引用 NULL 化但 accepted 不减；30d 严格 <（==cutoff 保留） | INSERT ON CONFLICT DO NOTHING，根池非事务 | 无 durable 台账（#544§9 有意）；删除数==RETURNING==work counter==日志三方一致 |
| W12 | 状态机 pending→processing→sent；attempt_count≤max_attempts；所有权丢失计 ownershipLost 不计 success | 每 poll 1 claim 事务（FOR UPDATE SKIP LOCKED）+1 recover+逐行 finalize+1 心跳 upsert | 死信 error 行不含收件人/正文；enqueue 与业务行+audit 同事务原子 |
| W15 | SIGTERM→业务/readiness/exit code 不变；collector 宕机业务 oracle 全部不变 | 事务相位不受 exporter 影响（benchmark 相位断言先例）〔转引〕 | audit drain 语义不变；观测缺失读作 UNKNOWN（§7.3 T8） |

**正确性失败处理**：任一 oracle 字段不符 = 正确性失败 → **不得剔除该样本**，整个 segment 作废并记录（作废原因 + 原始数据保留），按 §6.4 补跑。

---

## 5. 指标定义与测量方法学

**纪律**：下表"可测性"列是预注册承诺——凡标"受限/黑盒不可测"的指标**不得编造**，报告时如实写 SKIPPED/UNKNOWN 及原因；凡标"可测"的指标其测量通道必须与表中一致，替换通道按 §8 修订。

| 指标 | 定义 | 测量通道 | 可测性 |
| --- | --- | --- | --- |
| API CPU time/op | 稳态窗内 API 进程 utime+stime 增量 ÷ 有效操作数 | 外部 `/proc/<pid>/stat` 差分（黑盒，零侵入） | **可测**（主验收指标）。进程 CPU 为全局量：**混合档不可按操作类分派**，类级 CPU 归因只在隔离档可测（§7.1 报告面据此设计） |
| wall p50/p95/p99 | 在线操作单请求客户端时延分位（稳态窗，warmup 外全部有效操作；操作带类标签，支持按类分位） | load generator 客户端计时 | **可测，受限声明**：服务端时延分布黑盒不可直接测（G1 无 HTTP request metric【CODE_VERIFIED｜WORKFLOW-INVENTORY §5】）；客户端时延含网络/排队项，On 态可用 span 时长（H3 dump/H4 Tempo）做服务端侧旁证，二者口径分开报告、不混用 |
| 吞吐 | 稳态窗有效操作数 ÷ 窗时长 | load generator 计数 | **可测**（closed-loop 下为内生测量值，§3.5） |
| 错误率 | 非预期状态码/envelope ÷ 总操作（预期拒绝不算错误） | load generator + oracle | **可测** |
| RSS | API 进程常驻内存 | `/proc/<pid>/status` VmRSS，5s 采样 | **可测**（外部） |
| heap (heapUsed/heapTotal/external) | V8 堆内/堆外 | 需进程内 `process.memoryUsage()`——黑盒 API 进程**不可测**；仅 retention 探针专用 run（`--expose-gc`，既有探针自有输出）提供 heapUsed/external | **受限**：主实验报告 RSS；heap 仅 C8 探针 run 专属，不得冒充常规段数据 |
| GC | GC 次数/暂停分布 | Node `--trace-gc` stdout 解析（harness 启动旗标，非业务代码修改） | **可测但隔离**：仅在专用 GC 观察段启用（旗标有运行时开销，禁入 perf 段样本）；"可用则计"——若旗标与该 SHA 启动链不兼容，报 SKIPPED |
| 稳态内存斜率 | RSS 时序在稳态窗末 60s 的最小二乘斜率 | 上述 RSS 采样 | **可测** |
| DB statement/tx/retry 计数 | 每段语句数、事务数、40001/40P01 重试次数 | 进程内 `OtelDbTelemetryDiagnostics`（`submissions/settles/errors/byRole/scopedClosures`，`packages/otel-drizzle-postgresjs/src/index.ts:81-93`；`diagnostics()` 在 handle 上，`index.ts:122-123`，实现体 `:322`）**存在但黑盒不可达**【CODE_VERIFIED】→ 可行通道：(a) 测试库 PG 日志（`log_statement` 于测试库会话级设置）或 pg_stat_statements 扩展（仅测试库）解析；(b) pino "transaction retry" warn 计数（`packages/db/src/types.ts:262-265` 形态）【转引｜REALITY §4.3】 | **受限**：通道 (a)(b) 为权威计数；进程内 diagnostics() 仅 benchmark 离线断言可比对，不进黑盒段 |
| span 数 | 每段 span 总数、按名分布、每请求 server span 数 | H3：`TELEMETRY_MEMORY_DUMP_FILE` shutdown JSONL（既有缝：`settings.ts:854`、`runtimeConfig.ts:828` 撰写会话读源码核实；`runtime.ts:299-302,449-460` 行号转引 REALITY §8.1）【CODE_VERIFIED】；H4：collector 侧计数（Tempo 查询或 debug exporter）；Off 态恒 0（预期，实测证伪即 §7.2 T5 失败） | **可测（On 态）** |
| exporter 字节与请求数 | OTLP POST 次数/字节数（/v1/traces、/v1/metrics） | collector 侧（otelcol 自观测/debug）+ 主机 socket 计数（`ss -s`/容器网络计数）双通道交叉 | **可测（仅 H4）**；otelcol 自观测端口等行级参数 UNKNOWN（附录 B），harness 构建时核实 |
| collector 资源 | otelcol 容器 CPU%/Mem | `docker stats` 采样（仅 H4 运行窗，§4.1） | **可测（H4）** |
| 关机耗时 | SIGTERM→进程 exit 的墙钟 + exit code | 外部计时 + pino 关机日志对账 | **可测**；预算判据见 §7.3 T9（ADR-028 关机 30s 预算；as-built shutdownTelemetry 单一 3s 共享 deadline `SHUTDOWN_FLUSH_TIMEOUT_MS=3000`，`runtime.ts:94`【CODE_VERIFIED】） |
| Off 态网络面 | Off 进程遥测网络连接/发包/后台导出任务 | 固定 ≥30min 观测窗：`ss`/`strace` 连接审计 + 容器网络计数；一并覆盖两个 DB marker client（`installStatementSeam` marker 与 root-pool `sql.unsafe("select 1")` 懒 marker）无拨号确认（REALITY E12） | **可测**（§7.2 T5 验收） |
| H2 态网络面 | On/无导出 进程遥测网络连接/发包/导出定时器 | 同上通道，H2 段执行（v2 新增，§7.2 T5b） | **可测** |

---

## 6. 采样与统计

### 6.1 进程与交错纪律

- **每配置独立干净进程**：每个 segment 新启 API 进程（§3.3），禁止跨段复用进程或内存态。
- **轮内交错**：一轮（round）= 各配置各一个 segment，按轮转顺序连续执行（同轮总窗 ≤45 min），轮间配置顺序轮转并记录（消除 PR #980 r1–r3 型 host-load 相位污染【转引｜REALITY §8.2】）。
- **quiet-machine 要求**：采样期间宿主只运行实验相关负载；每 segment 前后记录 §2.2 基线项。宿主侧可达范围受 §2.3 盲区约束（WSL2 下 Windows 侧负载不可见）。

### 6.2 重复与配对

- 每个进入统计的配置对比 ≥**6 个有效配对重复**（pair = 同轮次同档同 workload 模式下的两配置 segment）；隔离档每 config×类同规则（§3.2）。
- H0 仅参与：主档混合、C8 探针、oracle 等价性核验（§6.6）；H0 不进隔离档/低档/拐点档（成本与可比性边界）。

### 6.3 统计量（冻结）

- 主效应量：**配对相对增量** Δ% = (X_处理 − X_H1) / X_H1（CPU、p99、吞吐、RSS 斜率等按指标逐一定义；X 为该 segment 的指标值）。
- 报告：配对 Δ% 的**中位数**与**极差（min–max）**；**bootstrap 95% CI**（对配对 Δ% 重采样 **10,000** 次，percentile 法，**固定种子 20261115**，预注册不得更改）。
- 跨 SHA 对比（H1 vs H0）同法计算，仅限语义等价子集（§6.6）。

### 6.4 判定规则（预冻结，§7 引用）

| 条件 | 判定 |
| --- | --- |
| 95% CI 上界 ≤ +5% | **PASS（预算内）**；若 CI 同时含 0，**禁止声称"零开销/0%"**——报告 CI，指标另标 `INCONCLUSIVE@0` |
| 95% CI 下界 > +5% | **FAIL（超预算）** |
| CI 跨越 +5% | **UNKNOWN** → 交 Owner 裁决 |
| 有效配对 <6 | **UNKNOWN**（样本不足）→ 交 Owner |
| 配对 Δ% 四分位距 IQR > 5 个百分点 | **UNKNOWN**（波动过大）→ 交 Owner |
| 任一指标 UNKNOWN | 该配置对的总体判定 UNKNOWN（各指标合取） |

- 正确性失败的样本不得剔除（§4.2）：整段作废并记录；作废段不计入 6 个有效配对，补跑补足。
- 环境干扰剔除（§6.5）与结果好坏无关；每次剔除记录原因 + 原始数据保留。
- **采样预算（v2 量化）**：每个统计单元（配置对比 × 档位 × 负载模式）最多 **12 个 segment 尝试**（≥6 有效配对 + ≤6 次剔除/作废补跑）；预算用尽仍 <6 有效配对 → 该单元停止补跑、判 UNKNOWN，不得以不足样本出 PASS。
- **追加 replicate（v2）**：任何单元可在 ≥6 之上追加 replicate（追加只收紧 CI，属收紧方向）；决定与理由记入运行记录，不触发 §8 修订。

### 6.5 干扰检测与剔除规则（预冻结）

**硬剔除**（段作废、记录原因、不计入统计）：
1. 段内任一 1m loadavg 采样 > **4.0**（20 逻辑 CPU 的 ~20%，探索级保守阈值；W7 相位污染教训的防复发）；
2. PG/Redis/collector 容器重启、连接拒绝或 seed 失败；
3. load generator 崩溃、时钟跳变 >1s（覆盖 WSL2 时钟漂移，§2.3）；
4. seed checksum 与期望不符（§4.1）。

**软标记**（保留数据、单独分析、不自动剔除）：5m/15m loadavg 上升趋势、CPU throttling 迹象（`docker stats` 容器 CPU% 饱和或 cgroup `cpu.stat` throttled_usec 可读时非零增长——WSL2 下该通道可用性 harness 构建时核实，不可用则记 SKIPPED 并以 loadavg/docker stats 代理）、PG checkpoint 统计漂移、buff/cache 骤降 >2GiB、collector 丢包计数 >0、宿主侧代理 CPU% >60%（§2.3，若通道可用）、配对 warmup 完成操作数差 >20%（§3.3）。

### 6.6 H0 语义等价子集与 NON_COMPARABLE 判定（预冻结）

1. **结构性 NON_COMPARABLE**：H0 上运行 On 态——组合不存在（§1.2），判 NON_COMPARABLE，不产出数字。
2. **S 维度 × Off 态**：H0/H1 上的 S0/S1/S2 对比——Off 无采样器效应，判 NON_COMPARABLE。
3. **H0↔H1 语义等价核验（v2 收紧）**：对每个纳入 workload，在两 SHA 上各跑 **≥3 段** oracle 核验集（§4.2），且 3 段分布在不同轮次/时间执行；**任一段**任一字段不一致 → 该 workload 对 H0 判 **NON_COMPARABLE** 并记录差异字段（非确定性/偶发分歧按 fail 处理）。核验背景：范围 `cb1e614f..1d689b4a` 内全部 42 提交（§1.2）均构成潜在语义差，等价性以 oracle 实测为准，不以 log 目测代替。
4. **跨 SHA 开销数字的使用边界**：H2/H4 vs **H0** 的差值含"特性引入+#994+范围内其他提交"，只作背景数据，**不进验收判定**（§7 验收基线冻结为同 SHA H1）。
5. **W7.2 历史 PR 数字**（不同 SHA 0e82e087、pre-#994 栈，且负载模型未定义 §3.5）：仅作背景引用（§7.4），不与本实验数值合并、不据其判定。

### 6.7 判定力与最小可检测效应 MDE（v2 新增）

- **已知局限（预注册声明）**：n=6 的 percentile bootstrap CI 存在小样本覆盖不足；本协议的诚实出口（<6、IQR>5pp、CI 跨阈值 → UNKNOWN）意味着弱判定力下 UNKNOWN 是可能常态结局。段内样本量充足（在线操作 ≈10,000/段），判定力瓶颈在 replicate 数。
- **预注册 MDE 程序**：pilot 段与前 2 个采样轮的有效配对 Δ% 给出配对标准差估计 σ̂；各指标预期 **MDE ≈ 2.80·σ̂/√n**（正态近似：z₀.₀₂₅+z₀.₂₀=1.96+0.84，对应 80% 功效、双侧 5% 显著；bootstrap 实际覆盖更保守，故 MDE 只作预期判定力量化，不作判定规则）。MDE 表与 σ̂ 原始值写入 v2.x 小版本记录（§8.3）。
- **判定力门槛**：若某 T1–T4 主判定指标的 MDE > +5%（即预算本身低于可检测阈值）→ 在继续该指标采样前作为判定力声明呈报 Owner（不静默继续）。

### 6.8 On 族内部比较的解释边界（v2 新增）

- **H4−H2 差值是多因素和，不是单因子成本**：H2 无 MeterProvider（§1.1）、H4 是唯一有真 metric 序列的形态——H4−H2 混杂 metric provider 装配与序列采集 + 序列化 + 导出 I/O + collector 端处理；**禁止**把 T2−T1 或"H4−H2"解释为"纯导出开销"。T2−T1 之差不是预注册指标，仅 T1..T4 各自 vs H1 是判定输入。
- **H3−H2 差值** = 内存环 BSP 成本（唯 exporter 不同，scrub 链与 BSP 队列两态均在），作背景解释，同样不进判定。
- per-signal 单因子归因需装配级 ablation（REALITY E1 设计），不在本协议产出面内；本协议产出组级对比 + §7.1 冻结报告面。
- 本条与 §6.6-4（H0 历史漂移边界）共同构成解释边界集：跨 SHA 比较、On 族内部比较均不得读作单因子归因。

---

## 7. 预冻结验收阈值

**唯一权威：ADR-028 §3 表三（`docs/adr/ADR-028-opentelemetry-technical-telemetry.md:93-104`，撰写会话已读原文）。** ADR-028 状态为 PROPOSED【CODE_VERIFIED｜REALITY §0.3，ADR:5】——本实验产出其评审输入，不构成生产启用授权。预算初始值来源 #964 §6（ADR-028:104 明示）【CODE_VERIFIED】。

### 7.1 性能预算（判定规则 = §6.4；v2：评估面扩展到全部冻结档位 + 强制分位报告面）

| 阈值 | 对比（冻结基线 = **同 SHA H1**） | 评估档位 | 指标 | 预算 |
| --- | --- | --- | --- | --- |
| T1 | H2 vs H1 | 低 / 典型 / 拐点（逐一） | 稳态 CPU time/op（混合档） | ≤ +5% |
| T2 | H4 vs H1 | 低 / 典型 / 拐点（逐一） | 稳态 CPU time/op（混合档） | ≤ +5% |
| T3 | H2 vs H1 | 低 / 典型 / 拐点（逐一） | 稳态 wall p99（客户端口径；span 派生口径另报不替代） | ≤ +5% |
| T4 | H4 vs H1 | 低 / 典型 / 拐点（逐一） | 稳态 wall p99（同上） | ≤ +5% |

- **按档合取（v2 收紧）**：每指标总体判定 = 其各档位判定之合取——任一档位 FAIL → FAIL；任一档位 UNKNOWN → 总体 UNKNOWN；全部档位 PASS → PASS。依据：ADR-028:99-100 的 ≤5% 预算**未限定并发档位**，v1 只评典型档属评估面收窄；v2 按全部冻结档位评估是收紧，不新增自由度。低/拐点档无 H0（§6.2），该两档覆盖 H1/H2/H4。
- **聚合掩蔽警示（冻结措辞）**：全局聚合可掩蔽单工作流回归——例：W03 占混合流 ~10% 操作、单类时延回归 +50% 时，全局分位可仅移动 ~+5%（恰在预算边缘）。**因此 T1–T4 PASS 不构成"无单工作流回归"的结论。**
- **分位报告面（v2 冻结，强制附报）**：每份结果报告必须包含：(a) 混合档按 C1–C7 类的配对时延（中位/p95/p99）相对增量中位数与 95% CI；(b) 隔离档每类的 CPU time/op 与时延配对增量（类级 CPU 归因仅隔离档可测——进程 CPU 为全局量，混合档不可分派，§5）。任一类 CI 上界 > +5% → 该类标 **`FLAGGED-CLASS`**，作为独立发现**强制呈报 Owner**。FLAGGED 不自动改写 T1–T4 数值判定（本协议无权创设 ADR 之外的类级预算——显式声明此权限边界，非静默豁免），但 Owner 在任何生产启用裁决前必须逐项处理全部 FLAGGED-CLASS 发现。
- On/无导出（H2）与 On/完整 OTLP 导出（H4）**分别对比**（ADR-028 表三两列独立）【CODE_VERIFIED｜ADR:99-100】；H3（memory）属"无远端导出"族，其数字作为 H2 列的附加证据报告，不单列预算。
- 跨 SHA（vs H0）数字仅背景（§6.6-4）；T2−T1 之差不是预注册指标（解释边界 §6.8）。
- 隔离档与 S 子矩阵**不进入 T1–T4 数值判定**，但隔离档进 §7.1 分位报告面（强制），S 子矩阵按 §1.3 附报；此为报告义务，非判定豁免。

### 7.2 零面与计数验收

| 阈值 | 内容 | 证明方式 |
| --- | --- | --- |
| T5 | **Off 态（H1）遥测网络请求/后台导出任务必须为零**——实测证明，不接受静态推演 | §5 Off 网络面通道：≥30min 连接/发包审计 + 无导出定时器确认；同时覆盖 DB marker 零拨号（E12）。ADR-028 表三 Off 列"必须为零（实测证明）"【CODE_VERIFIED｜ADR:97】。审计窗内观测栈停止（§4.1） |
| T5b（v2 新增） | **H2（On/无导出）零远端导出面**——实测证明：H2 段 ≥30min 网络/连接审计零遥测网络请求、零导出定时器/后台导出任务；"信号实际产生"以 span 数 >0（§5 span 数通道）旁证 | 背景：ADR-028:97 该列要求"显式禁用各信号的远端导出和自动配置，并以受控进程内观测确认信号实际产生"；:115 记录 NodeSDK 默认 OTLP 自动配置风险。本栈结构性无 sdk-node/NodeSDK【CODE_VERIFIED｜REALITY §1，structural test 断言】为静态旁证，本项以实测为准 |
| T6 | **每请求恰好 1 个 server span**（实测计数）——覆盖正常路由与 404 | H3 dump 或 H4 collector 侧计数，受控窗（W00+W03 各 ≥200 请求）。ADR-028 表二还要求覆盖 hook 与"入站头不成父"等项【CODE_VERIFIED｜ADR:89】；本实验**明确不覆盖**以下表二项并逐项预标 UNKNOWN 交 Owner（**封闭清单**，无开放式能力豁免）：(a) hook 路径下单 SERVER span 验证；(b) 入站 traceparent 不成为父上下文的运行时验证（静态有 serverRootPropagator 断言）；(c) pino 关联字段验证 |

### 7.3 正确性与故障注入验收

| 阈值 | 内容 |
| --- | --- |
| T7 | 全部 workload oracle（§4.2）逐段通过；正确性失败 → 整段作废记录（§4.2/§6.4） |
| T8（v2 补 readiness） | **故障注入**（Collector 不可达 / 假死 accept-but-never-answer / BSP 队列满 2048 / 导出超时 slow-read / 关机 flush 常态+挂死 receiver）下与基线一致：Save/Submit/Deadline/Restore 业务行为、**readiness**（/ready 结果与 503 gate-answer 形态不被 collector 故障翻转——ADR-028:81 明示"停 Collector 改变 readiness"属禁止的权威楔子【CODE_VERIFIED｜ADR:81】）、审计 drain、关机语义；**观测缺失读作 UNKNOWN**（ADR-028:102 原文同口径：业务结果/readiness/关机语义不变；观测缺失=UNKNOWN）。本实验未覆盖的其他故障注入维度（若有）逐项标 UNKNOWN 交 Owner。既有 4 场景注入（unreachable/500-reject/35s slow-read/blackhole，PR #980 记录）未覆盖假死与队列满【转引｜REALITY §10 E4】，本实验补齐 |
| T9 | **关机 30s 预算**（ADR-028 表三业务行为行【CODE_VERIFIED｜ADR:98】）：SIGTERM→exit ≤30s 且 exit code 与基线一致；as-built 参考值（shutdownTelemetry 3s 共享 deadline、server 层 bounded exit）同时记录【CODE_VERIFIED｜runtime.ts:94】 |
| T10（v2 明确判定力口径） | #994 探针对照（C8）：retention 探针为**单次内存对照 run（设计上 n=1）**——内存回收性判定（H0 pre-fix 存活形态 vs H1 post-fix 可回收形态，与 REALITY §4.4 记录一致）按 MEASURED 出具；**per-op CPU delta 恒报 INCONCLUSIVE**，不作为任何预算判定输入（探针设计不支持性能判定；如需多 replicate probe 按 §8 单调性约束另行收紧修订） |

### 7.4 W7 复测历史背景（PR #980 body 记录，非撰写会话实测【转引｜REALITY §8.2】）

> pre-fix（3×3 lifecycle-S50 replay）：On/no-export CPU +7.5~+12.4%、On/full-OTLP CPU +8.8~+16.4%。fixed stack（0e82e087，6 replicates，quiet-machine r4–r6 primary）：On/no-export CPU 中位 **+10.4%**、On/full-OTLP 中位 **+9.1%**——双双超 ≤5% 预算 → 判 FAIL → **生产启用 NO_GO**（默认保持 Off）；steady p99 中位 +2.7%/+2.1%（带宽边缘内）；RSS +5~+16% 为容量数据、不在 ≤5% 预算内。方法论局限：r1–r3 相位污染仅 r4–r6 主数据；`SAMPLE_RATIO=0` 无改善。

本实验在含 #994 的 H1 SHA 上复测，**不预设复现或推翻该结论**；两个结果同时呈报 Owner。

### 7.5 样本不足/波动过大

有效配对 <6、IQR>5pp、CI 跨越 +5% 之任一 → 该指标报 UNKNOWN 交 Owner 裁决（§6.4）；**禁止**以不足样本出 PASS，禁止把 INCONCLUSIVE 写成 0%。

---

## 8. 修订规则（v2 收敛冻结语义）

1. **单调性约束（总则）**：任何修订（vN 或 v2.x 小版本）相对前一版本**只能更严或更明确**——阈值数值只能保持或下调；判定/剔除/可比性规则只能收紧或细化；负载模型与测量通道只能收紧或精确化。放宽类修改不属于"修订"，只能作为新实验另行预注册。
2. **采样开始前**：环境变化、评审意见、oracle/操作数修正 → 按 §8.4 出 vN（实质变更）或小版本（措辞/非语义明确化）。
3. **采样开始后**：
   (a) §2.1 环境冻结项变化 → **立即暂停采样**，评估影响面，按 §8.4 出 vN+1 并重新冻结环境后以新版本继续；已采数据有效性按测量通道是否受影响判定（未受影响 → 沿用；受影响 → 作废重采并记录）；
   (b) §8.3 小版本通道（K_pilot 落定、MDE 表落定）保持可用；
   (c) **其余一切修改禁止**——不存在"采样中途出 vN 即可改阈值/判定规则/oracle/操作数"的路径。
4. **版本与哈希**：v1 = `PROTOCOL.md`（保留不覆写，冻结正文哈希见修订日志）；每次实质修订**新建 `PROTOCOL-vN.md`**；修订日志记录旧哈希→新哈希、触发原因、逐条变更点、已采数据有效性判定。哈希约定沿用：日志中的 sha256 = 该版本文件**去除 `### 修订日志` 节本身**内容的 sha256，验证命令 `awk '/^### 修订日志$/{exit} {print}' PROTOCOL-vN.md | sha256sum`。
5. **小版本通道**：v2.x 追加"修订记录"小节（K_pilot 落定、MDE 表落定）并更新日志行，不新开文件；此为采样中途唯一预授权修订。

### 修订日志

| 版本 | 日期 | sha256 | 说明 |
| --- | --- | --- | --- |
| v1 | 2026-11-15 | `4eddc21683a5fae17913e35a59dbbf7dab57ebdd3429d5c22619ed31d0fee5be` | 初版预注册协议（`PROTOCOL.md`，保留不覆写；其冻结语义矛盾与评估面收窄由 v2 收敛） |
| v2 | 2026-11-15 | `e07b39d18ed825785463aaf3f2d713d7eb69e230c83ac00d02c56fedab9b16ab` | 方法学评审修订（13 项发现，只收紧/更明确、零放宽） |

**v2 相对 v1 的逐条变更映射（对应评审发现）**：
1. **high：验收面单一档位+全局聚合掩蔽** → §7.1 重写：T1–T4 按低/典型/拐点三档逐一评估并按档合取（依据 ADR-028:99-100 未限定档位）；新增聚合掩蔽警示（含 W03 ~10% 操作 +50% 单类的 worked example）；新增冻结分位报告面（混合档按类时延 + 隔离档类级 CPU/时延）与 FLAGGED-CLASS 强制呈报规则；§3.4 档位表标注进入判定。
2. **medium：n=6 无功效分析** → 新增 §6.7：预注册 MDE 程序（σ̂ 来自 pilot+前 2 轮，MDE≈2.80·σ̂/√n，80% 功效双侧 5% 近似）、MDE>+5% 时采样前判定力声明、补采样只增不减条款；§8.3 通道扩展至 MDE 表落定。
3. **medium：负载发生器模型未冻结** → 新增 §3.5：closed-loop 固定 worker、串行无 pipelining、think time=0、工具冻结要求（harness Node 脚本 + sha256 记录 + 采样前落成）、混合流按比例交织禁止分块相位、两臂同种子确定性 schedule；§6.6-5 并入负载模型不可比声明。
4. **medium：冻结规则内部矛盾（:3 vs :284 vs :281）** → 头部状态行与 §8 重写：采样开始后唯一例外是 §8.3 小版本通道；环境冻结项变化 → 暂停采样→vN+1→恢复冻结→新版本继续（含已采数据有效性判定）；其余修改一律禁止；锁点明确覆盖 §6.4/§6.5/§6.6/§7 全部；新增 §8.1 单调性总则。
5. **medium：T8 缺 readiness** → §7.3 T8 补 readiness 维度（含 ADR-028:81 禁止楔子与 :102 三要素对照）+ 未覆盖维度显式 UNKNOWN 声明。
6. **medium：H2 零导出面无 T 项** → §7.2 新增 T5b（H2 ≥30min 网络审计零遥测请求/零导出任务 + 信号实际产生旁证 + ADR:97/:115 依据）；§5 增 H2 态网络面行。
7. **medium：H4−H2 解释限制缺失** → 新增 §6.8：H4−H2 多因素和禁止读作纯导出开销、H3−H2 边界、T2−T1 非预注册指标、单因子归因不在产出面；§7.1 引用。
8. **medium：WSL2 宿主侧盲区** → 新增 §2.3：盲区声明、宿主侧代理通道（powershell interop，可用性 UNKNOWN → 附录 B.8；不可用记 SKIPPED + 强制效度声明）、时钟漂移由 §6.5-3 覆盖声明；§6.1 交叉引用。
9. **low：隔离档 replicate 数未定** → §3.2 补"每 config×类 ≥6 有效配对（§6.2 同规则）"。
10. **low："预算耗尽"/"样本充分"未量化** → §6.4 新增采样预算（每统计单元 ≤12 segment 尝试）；T10 改为明确口径（探针 n=1，per-op CPU 恒 INCONCLUSIVE）。
11. **low：等价核验 1 段可能漏检偶发分歧** → §6.6-3 收紧为每 workload 每 SHA ≥3 段、跨轮次分布、任一段不符即 NON_COMPARABLE。
12. **low：collector/Tempo 生命周期未定义** → §4.1 新增观测栈生命周期冻结（仅 H4 窗运行；非 H4 段与 T5/T5b 审计窗停止；sharp_saha 常驻状态由本条款取代；H4 数字含同宿主 collector 成本并注明）；§2.1/§2.2 交叉引用。
13. **low：warmup 非对称** → §3.3-3 改为固定 60s 墙钟（不以操作数封顶），warmup 完成操作数记录 + 两臂差 >20% 软标记。
14. **low：T6 开放式能力豁免** → §7.2 T6 改封闭清单（3 项明确不覆盖并预标 UNKNOWN），删除"若不在本实验能力内"措辞。

---

## 附录 A：会话已执行的验证（MEASURED 清单）

**A.1 环境（§2.1 复核，v1 撰写会话）**：`node --version` → v24.15.0；`pnpm --version` → 11.1.2；`uname -a` → 与冻结值逐字段一致；`nproc` → 20；`free -h` → 15Gi 总量一致；`docker --version` → 29.9.3；`docker compose version` → v5.7.0；`docker ps --format '{{.Names}} {{.Image}} {{.Status}}'` → sharp_saha/grafana/tempo:3.1.1、exam-dev-redis-1/redis:7-alpine (healthy)、exam-dev-db-1/postgres:18.4-bookworm (healthy)；`cat /proc/loadavg` → 同量级。

**A.2 SHA 与可比性（§1，v1 撰写会话）**：`git rev-parse HEAD`（/home/hoo/Source/exam）→ `1d689b4a2db3501810bfbfeb7b1a7c7c88c0cc65`，`git status --short` 干净；`git cat-file -t cb1e614f…` → commit；`git describe --tags cb1e614f` → `v0.0.15`；`git merge-base --is-ancestor cb1e614f 1d689b4a` → 通过；`git rev-list --count cb1e614f..1d689b4a` → **42**，42 条 subject 逐一过滤（grep -iv otel/telemetry/#994/#964/observability）零命中；`git ls-tree cb1e614f --name-only apps/api/src/` → 无 `telemetry/`；`git show cb1e614f:apps/api/package.json | grep -c opentelemetry` → 0；`git show cb1e614f:apps/api/src/config/settings.ts | grep -c TELEMETRY_` → 0。

**A.3 源码定位（CODE_VERIFIED，v1 撰写会话）**：`settings.ts:419-452`（ratioLeaf 严格 [0,1] fail-fast）、`:175-196`（truthyLeaf 仅 "true"/"1" 为真、unset→false）、`:834-854`（TELEMETRY_ENABLED/SERVICE_NAME/SAMPLE_RATIO/EXPORTER enum none|memory|otlp 默认 none/OTLP_ENDPOINT/MEMORY_DUMP_FILE）；`apps/api/src/config/runtimeConfig.ts:776-831`（otlp+endpoint 成对、http(s)、无凭据、无 query/fragment）；`runtime.ts:94`（`SHUTDOWN_FLUSH_TIMEOUT_MS=3_000`）；`packages/otel-drizzle-postgresjs/src/index.ts:81-93`（Diagnostics 五计数器）与 `:122-123`/`:322`（handle.diagnostics()）；ADR-028 `:5,:81,:89,:93-104,:115`（PROPOSED 状态、readiness 楔子、表二 SERVER span 要求、表三全部行、NodeSDK 自动配置风险）；testing.md §2.1/§2.2/§2.8（数据库所有权、名字守卫、demo seed 只进 dev 库）。

**A.4 读入材料（v1 撰写会话）**：REALITY.md §0/§3/§4/§8/§10/§11；WORKFLOW-INVENTORY.md 全文；均为只读。

**A.5 v2 修订会话新增**：`awk '/^### 修订日志$/{exit} {print}' PROTOCOL.md | sha256sum` → `4eddc21683a5fae17913e35a59dbbf7dab57ebdd3429d5c22619ed31d0fee5be`（与 v1 日志记录一致——v1 文件未改动）；`git -C /home/hoo/Source/exam status --short | wc -l` → 0（主工作树仍未修改）；评审意见 13 项逐条对照（ask 材料）。

## 附录 B：UNKNOWN / 未验证清单（如实声明）

1. **otelcol.yaml / docker-compose.observability.yml 行级参数**（自观测端口、batch/queue 参数）——转引 WORKFLOW-INVENTORY §6.1（其自身亦未行级复核），会话未读。harness 构建时核实并记录，若与 §5 通道假设冲突按 §8 修订。
2. **W12 fake 发送模式的具体配置键名**——senders.ts 三态（disabled/fake/smtp）为 WORKFLOW-INVENTORY 转引，会话未读 senders.ts。harness 构建时核实。
3. **PG 18.4 统计视图名**（checkpointer/bgwriter 等软标记数据源）——会话未查询任何数据库实例（遵守"DB 操作只触达测试契约测试库"约束，dev 容器只做了非破坏性 `docker ps` 检查）。harness 在测试库上核实。
4. **`TELEMETRY_MEMORY_DUMP_FILE` 在 H3 高负载段的写完整性与 JSONL 行格式**——缝存在性 CODE_VERIFIED（REALITY §8.1），运行期完整性留实验确认。
5. **W09/W11/W12 的 interval 类 settings 键名与取值范围**——矩阵转引（settings.ts:743-746 等），会话未逐一打开；harness 构建时按源码核实，不改默认值除非按 §8 修订记录。
6. **K_pilot**——按 §3.4 pilot 程序产生，当前仅有先验 50。
7. **W7 性能原始 JSONL**——REALITY §11-2 已判 UNKNOWN（untracked 产物未定位）；本实验不依赖其存在。
8. **WSL2→Windows interop 可用性**（`powershell.exe` + `Get-Counter`，§2.3 宿主侧代理通道）——UNKNOWN；不可用则该通道 SKIPPED，结果报告强制携带"宿主侧负载不可观测"效度声明。
9. **cgroup `cpu.stat` throttled_usec 在本 WSL2/Docker 链路的可读性**（§6.5 软标记通道）——UNKNOWN；不可用则以 loadavg/docker stats 代理并记录。
