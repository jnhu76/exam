# #549 — Option A / Option B analysis

## Option A — KEEP_LAZY（逐项对照现行实现核验）

| 维度 | 主张 | 代码证据 | 结论 |
| --- | --- | --- | --- |
| AUTHORITY | eligibility 由 durable 事实+now 推导 | `computeBatchRelease` 纯函数；anchor=earliestJoinedAt（全部行） | 成立 |
| MATERIALIZATION | 候选人范围的权威交互触发 | 调用图仅 2 个需求触发器（00 §2） | 成立 |
| DURABILITY | PostgreSQL admitted_at | CAS `admitOnce`，partial unique 约束 | 成立 |
| RESTART | 无需追赶；下一请求重算 | 无后台 actor；restart 无 admission 补偿逻辑 | 成立 |
| MULTI-INSTANCE | 任一实例可 reconcile，CAS 收敛 | `admitOnce` write-once（admissionCommands.test Q5 钉住）；拓扑=1 实例（#554 终裁） | 成立 |
| IDEMPOTENCY | admitOnce 至多写一次 | CAS WHERE admitted_at IS NULL + 测试 | 成立 |
| FAILURE | reconcile 失败 ⇒ 有资格未物化；下次交互自然重试 | 无重试/无死信需求；fail-closed 仅在 start 门 | 成立 |
| BACKPRESSURE | 请求路径/池是天然压力边界 | 02：池饱和吸收 200 人风暴，0 错误 | 成立（实测） |
| CLOCK | 请求时服务器时钟求值谓词 | 路由 `fastify.now()`；服务端是时间权威 | 成立 |

### Option A 的真实代价（不隐藏）

1. **恢复期 burst**：长断线后的重连产生集中 reconcile 写（实测：N=200 全资格
   417ms 墙钟，池排队把单 poll 推到 ~400ms）。容量上可吸收，但**必须作为容量契约
   的一部分被 #550 在真实 HTTP 栈上压测**（本报告 04 §#550 workload contract）。
2. **admittedAt 记录的是物化时间**，不是资格边界 T。运维视图（admin admissions，
   只读持久行）在考生断线期间会显示 `waiting`（滞后于资格），直到该考生下一次交互。
   该视图的 as-built 语义就是"持久事实列表"，不是放行进度表——本文档 04 明文固化。
3. **语义措辞风险**：UI/文档的"放行/ready"若被读成"服务器在 T 写库"会误导读员。
   处置：exam-runtime §3.1.1 增补语义边界（本 PR 的 active-doc 更新），不改行为。
4. 每次恢复 poll ~10 条语句（02），高于理论最小值；属可接受的 KISS 成本，无证据
   触发优化（#550 若给出相反证据，走独立 issue）。

## Option B — MATERIALIZE_SERVER_SIDE（仅设计，不实施）

> 目的：把真实机器成本摆上桌面。结论在 04。

### Ownership（用哪台现有机器？）

唯一合理的现有形状是 `deadlineScanner` 式的进程内 bounded loop
（fastify plugin，`setInterval`，系统 actor，派生发现谓词 + 权威下复查；30s tick
是先例）。#554 终裁排除了 Redis/MQ/DB 队列作为承载体；新发明通用 scheduler 被
#549 非目标禁止。→ Option B = 新增/扩展一个进程内定时 actor。

### Enumeration / Query shape（谓词能否集合化而不复制权威？）

稳定序 = (joined_at, id) 在**全部行**（含 consumed）上的秩。集合化发现必然是：

```sql
SELECT id FROM (
  SELECT id,
         count(*) OVER (ORDER BY joined_at, id ROWS UNBOUNDED PRECEDING) - 1 AS ahead_all
  FROM exam_admissions
  WHERE organization_id=$1 AND exam_id=$2
) t
WHERE consumed_at IS NULL AND admitted_at IS NULL AND ahead_all + 1 <= $releasedCount;
```

- 现有索引 `exam_admissions_org_exam_created_idx (org, exam, joined_at, id)`
  支撑窗口排序；但扫描范围是**该考试全部 membership 行**（consumed 历史不可剔除，
  否则秩漂移、违反"ordinal 不因他人 start 改变"的已钉住契约）→ 每 tick
  O(考试总行数)，正是 #545 与之搏斗的那类 O(history) 发现。
- **Second-authority 陷阱（prompt §10）**：若扫描器在查询里实现
  `ahead_all <= releasedCount`，它就是资格谓词的**第二份实现**（引擎 computeBatchRelease
  之外）。唯一不复制权威的形状：扫描器只枚举 waiting 行（枚举可以不同），逐行调
  **同一个 `reconcileAdmission`** 让引擎判资格并 CAS——但那每 tick 对每个 waiting 行
  花 4 条语句 × tick 频率，绝大多数 tick 是纯浪费的空转写路径。
  两个方向一个复制谓词、一个空转，**没有免费的形状**。

### Multi-instance

supported 拓扑=1 实例（#554）。若 2 实例：`admitOnce` CAS 已保证写收敛（重复扫描
只浪费写，不错写）；要省浪费才需要 `FOR UPDATE SKIP LOCKED` 认领——新增机制购买
一个不存在拓扑上的效率。无正确性问题。

### Restart / catch-up

停机后恢复：扫描器第一 tick 会把全部 overdue 行列为目标。若不设上界 ⇒ 服务器自己
制造一次与考生无关的写风暴（含**永远不会来考生的行**——为无人观察的列推进写库）；
设上界（page bound + tick 间隔）⇒ 资格仍按 tick 波次推进，"approximately T" 的
保证密度反而低于"请求时 reconcile"。catch-up 语义需要额外设计与测试。

### Idempotency / Failure

- 重跑/崩溃后重扫：由 admitOnce CAS 收敛（同引擎命令）✓。
- 扫描器延迟/宕机：考生 start 门仍自带 reconcile（`ensureStartAdmission`）⇒
  **扫描器永远不是唯一物化权威**。同一语义跃迁存在两个触发器（demand + scanner）；
  可论证为可接受（同一引擎命令/CAS），但 B 的增量保证随之缩水为"只是提前写"，
  正确性增益 = 0。

### Operational impact（为什么这是真实成本）

新增 loop 生命周期（readiness 接线、健康指标、shutdown drain）、新发现谓词的
query-plan 证据义务（#545 标准）、逐 tick DB 负载加入固定池的争用预算（#554 池
证据）、测试面（真实 PG 上的 tick/catch-up/多实例语义）、以及一条新的失败模式
（扫描器写失败 → 等待行停留在已资格未物化，运维需区分"正常 lazy"与"扫描器坏"）。
按 #15 的举证责任：这些成本没有对应的需求买主。

## 结论输入

Option B 的全部设计空间收敛为：**新增一个自主写者，其唯一增量是让
`admitted_at` 在无人观察时推进**——正确性由同一 CAS 保证（已存在），资格由同一
谓词保证（已存在），restart 正确性由 durable 事实保证（已存在）。没有需求出价，
成本为正。
