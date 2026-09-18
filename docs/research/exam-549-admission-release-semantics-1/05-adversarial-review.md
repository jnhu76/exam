# #549 — Fresh-context adversarial review

评审者：独立 fresh-context agent（未参与本分支工作），以 current-master 代码为
ground truth 逐项尝试证伪；A–O 全清单 + 调用图 line-level 抽查 + 文档一致性 +
harness 方法学审查。

## 结论

```text
OVERALL VERDICT: ACCEPT_WITH_MINORS
MAJOR REMAINING: 0
MINOR: 4（全部已修复，见处置表）
NIT: 4（全部已修复）
```

## A–O 逐项裁决（评审原文裁决摘录）

| # | 问题 | 裁决 |
| --- | --- | --- |
| A | release-at-T 是产品保证吗？ | **否**——SPEC §2.7 是资格节奏；§4.4 是 Phase-2 timed_sync 草图；CONFIRM KEEP_LAZY |
| B | 存在要求 admittedAt 无流量推进的观察者吗？ | **否**——admittedAt 在 engine/repo 外仅 admin 透传（exam.ts:2240）与 nullable wire 字段（contracts attempt.ts:984）；apps/web 无任何消费 |
| C | lazy reconcile 重启丢正确性？ | **否**——无进程内 admission 状态，全部路径由 durable 行+请求时 now 重算 |
| D | 双实例安全收敛？ | **是**——admitOnce CAS（examAdmissionRepo.ts:231-245） |
| E | admittedAt 被误读为资格时刻？ | **否**——estimatedWaitSeconds 谓词推导（admissionCommands.ts:279-288）；ready 源自持久状态 |
| F | burst-on-resume 正确性安全？ | **是**——canonical JSON 16/16 predicateMatches、0 错误；CAS write-once；DB check 对 |
| G | burst 成本报告诚实？ | **基本诚实**——确定性时钟取资格上界（方向保守）、池形状=生产、适配器同 8 个 repo 方法、语句数算术独立吻合；3 处引用卫生问题 → MINOR 处置 |
| H | B 能消除 burst 吗？ | **否**——请求 burst 两模型都有；B 只搬写时机并加扫描器负载 |
| I | B 复制谓词权威？ | **取决于形状**——集合化 SQL 内嵌资格判定=第二实现；逐行 reconcile=单权威但空转；无免费形状 |
| J | deadlineScanner 能承载 B 而不语义重复？ | **可行但不免费**——先例真实（30s tick）；文档主张的是"无需求出价"，成立 |
| K | B 停机后无界追赶？ | **是**——首 tick 目标含永不到场考生的行 |
| L | 改变 START/RESUME 语义？ | **否**——resume 在 gate 前返回（attemptCommands.ts:241-265 vs 301-322），test:614-631 钉住 |
| M | 持久权威离开 PostgreSQL？ | **否**（两选项皆否） |
| N | 无证据触发却提案 Redis/MQ？ | **否**——03/04 明示拒绝；#554 终裁 Redis 仅限限流 |
| O | #550 拿到精确可复现 workload？ | **基本完备**——矩阵/期望公式/oracle/metrics 齐；缺限流配置声明与 Δt 锚定 → MINOR 处置 |

调用图完整性（本决策的承重结构事实）经独立全仓检索复核：`reconcileAdmission`
生产调用方恰好 2 处（queue 路由 + ensureStartAdmission）；无后台调用方。

## 发现与处置

| # | 级别 | 发现 | 处置 |
| --- | --- | --- | --- |
| 1 | MINOR | 04 #550 contract 缺限流配置声明（100/min 全局 + 10/min login 会使生产模式 burst 429、oracle 失真） | 已修复：contract setup 增加 limiter 显式配置要求（settings.ts:694、auth.ts:120，行号已本地核实），limiter 行为划归 #550 NAT/限流维度 |
| 2 | MINOR | 04 引擎级基线引用未保留 run 的 394ms | 已修复：统一引用 canonical run 417ms |
| 3 | MINOR | "~10 语句/poll"仅是 engine 三连，生产 queue 路由另有 ~4 条 per-request 查询 | 已修复：02 解读 1 与 04 成本④ 显式限定 engine 层，HTTP 级真实数字归 #550 |
| 4 | MINOR | 02 的 "N20 p50≈43ms / 单查询 2–4ms" 不在 canonical 产物中 | 已修复：改用 canonical 数字（45.2–52.7ms；~4ms/语句在途） |
| 5 | NIT | 00 schema 行号 2512→2518 | 已修复 |
| 6 | NIT | 00 consume 行引用应为 attemptCommands.ts:410 | 已修复 |
| 7 | NIT | 复跑方差引用未保留 run | 已修复：明确标注"后一 run 的 JSON 未保留"，canonical 为准 |
| 8 | NIT | workload contract 的 Δt 未锚定 join anchor、pause 机制不具体 | 已修复：Δt 从 anchor 起算；注明 fastify.now 启动期装配、HTTP 层用真实 sleep/按 anchor 折算 |

评审者对 harness 方法学独立复核的要点（留档）：确定性固定 now 是资格集合的
**上界**（保守方向正确）；池 max=10 与生产一致（无 override）；内联适配器与生产
repoAdapters 逐方法对应；seeding 的 joinedAt=T0 在 joinActive 冲突路径下保真。
