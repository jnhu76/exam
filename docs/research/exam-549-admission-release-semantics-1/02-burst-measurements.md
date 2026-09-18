# #549 — Burst-on-resume measurements（F-08-2 确定性复现）

## Harness

- 位置：[`harness/burst-on-resume.ts`](harness/burst-on-resume.ts)（research-only，
  不接线 package.json；`SCENARIOS=` 环境变量可过滤场景）。
- 原理：真实 `examAdmissionRepo`（PostgreSQL，exam_test 库 + 仓库自有 per-run 隔离
  schema，跑完即 drop）+ 真实 engine 命令序列 `joinAdmissionQueue →
  reconcileAdmission → previewAdmissionStatus`（与 queue 路由逐条对应）。
  连接池 = postgres.js 默认 max=10（生产形状，#554 P1 同一池证据）。
- 确定性时钟：所有行 `joined_at = T0`；恢复时刻的 `now` 固定为 `T0+Δt`（对资格
  集合取上界；真实 burst 期间 now 会推进、批次陆续释放——那属于 #550 的 HTTP 级验证）。
- 计数：包裹 `sql.unsafe` 单漏斗，只统计 burst 窗口；`pg_stat_activity` 采样器
  独立连接测量活跃会话峰值。
- 运行：
  `pnpm --filter @exam/db exec tsx docs/research/exam-549-admission-release-semantics-1/harness/burst-on-resume.ts`
- 原始产物：[`harness/results/burst-2026-09-18T15-05-54-574Z.json`](harness/results/burst-2026-09-18T15-05-54-574Z.json)
  （16 场景完整矩阵，本报告引用该 canonical run）。
  池队列语义注记：`queryTimeMsTotal` 是每条语句"入队到完成"的在途
  时间总和（含池排队），故可超过 wall×连接数。

## 结果（batchSize=20，batchInterval=15s，全部 0 错误、0 超时，canonical run）

| 场景 | 等待人数 | Δt | 资格@恢复（预测=实测） | 恢复期物化写 | burst 墙钟 | poll p50/p95/max (ms) | 查询/poll | 池活跃峰值 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-f082-repro（4 人已消费） | 56 | 45s | 56 = 56 | 56 | 219ms | 210/216/218 | 10.0 | 8 |
| N20-dt1batch | 20 | 15s | 20 = 20 | 20 | 54ms | 53/54/54 | 10.0 | 10 |
| N50-dt1batch（部分） | 50 | 15s | 40 = 40 | 40 | 116ms | 113/116/116 | 9.8 | 10 |
| N50-dtall | 50 | 45s | 50 = 50 | 50 | 109ms | 106/108/109 | 10.0 | 10 |
| N100-dt1batch（部分） | 100 | 15s | 40 = 40 | 40 | 200ms | 189/199/199 | 9.4 | 10 |
| N100-dtall | 100 | 75s | 100 = 100 | 100 | 241ms | 234/241/241 | 10.0 | 10 |
| N130-dt1batch（部分） | 130 | 15s | 40 = 40 | 40 | 246ms | 230/245/245 | 9.3 | 10 |
| N130-dtall | 130 | 105s | 130 = 130 | 130 | 281ms | 269/280/281 | 10.0 | 10 |
| N200-dt1batch（部分） | 200 | 15s | 40 = 40 | 40 | 378ms | 358/377/378 | 9.2 | 10 |
| N200-dtall | 200 | 150s | 200 = 200 | 200 | 417ms | 400/415/416 | 10.0 | 10 |

（6/6/7-batch 中间档位与全部 16 行见原始 JSON；`dt1batch` 行同时覆盖了"未资格
考生只读不写"路径：queriesPerPoll 9.2–9.8 = 缺失的 `admitOnce` UPDATE。）

16/16 场景 `predicateMatches=true`：`computeBatchRelease` 预测的资格数与恢复期
实际 CAS 写入数、preview `ready` 数完全一致——**谓词是权威，物化收敛于谓词**。

## 解读

1. **成本模型（engine 三连）**：每次恢复 poll 在引擎层恰好 ~10 条语句
   （join: INSERT..ON CONFLICT+SELECT；reconcile: SELECT×3 + 条件 UPDATE；preview: SELECT×4），
   其中物化写只对资格候选人发生一次（后续 poll 被 `admittedAt !== null` 短路 +
   CAS 幂等）。生产 queue 路由在此之上还有 per-request 的 profile/exam/enrollment/
   active-attempt 查询与 auth（attempts.candidate.ts:558-579）——HTTP 级每 poll
   语句数更高，真实数字由 #550 在真实栈上测量。
2. **瓶颈是连接池，不是查询**：单语句无争用在途 ~4ms（canonical：N20 p50
   45.2–52.7ms / 10 条语句）；N=200 时池饱和（活跃=10），每 poll 端到端 ~400ms
   全部是池排队，**零错误、零超时**，整个 200 人恢复风暴在 ~417ms 内收敛。
   130 人审计实验的"DB-pool 排队尾部"（#550 维度）在同一形状下重现并被有界吸收。
3. **两种 burst 的区分（prompt §7）**：资格 burst 是纯数学（无需写）；请求 burst
   才产生写。KEEP_LAZY 的真实成本 = **需求触发的 burst**（本表），它受请求路径/
   池的自然背压约束；MATERIALIZE_SERVER_SIDE 的成本 = 服务器定时写（无人观察也写，
   见 03）。选择不是"burst vs 无 burst"，而是"需求触发 burst vs 服务器排程写负载"。
4. **对 F-08-2 的裁决**：56 人同刻 ready 复现为 ~219ms 墙钟、56 次 CAS 写、0 错误。
   该行为是 Model A 的**容量契约组成部分**（下接 #550），不是正确性缺陷。
5. **运行间稳定性**：独立复跑观察到 ~5% 墙钟差异（R: 203→219ms；
   N200-dtall: 394→417ms；后一 run 的 JSON 未保留），无正确性漂移；本表以
   canonical run 为准。
