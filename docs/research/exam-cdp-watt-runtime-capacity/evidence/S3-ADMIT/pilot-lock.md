# S3-ADMIT pilot-lock（PROTOCOL §4/§9.1 + PROTOCOL-ADDENDUM §2.4）

锁定日期：2026-11-20（正式采样前写定）。触发依据：S1-SUBMIT 的 T7 判定
（PROTOCOL §8 T7(a)∧(b) 同时成立；见 `evidence/S1-SUBMIT/README.md`）：
交卷窗口借连接等待 p99 估计 2056–2254ms、叠加臂 save p99 1560/1582ms vs 基线
46/41ms、heartbeat 300/964ms vs 31ms。

## 1. 锁定参数（只取 PROTOCOL §4 S_sub 候选空间 {2,4,8}）

| 参数 | 锁定值 | 依据 |
| --- | --- | --- |
| S_sub | **4** | ADDENDUM §2.4「先筛 4」；PROTOCOL §10「先筛 S_sub=4」。均 < 池 10 |
| Q_sub（等待队列容量） | **200** | 预注册 P3×S200 到达表为 200 同时刻手动交卷；S_sub=4 时最多 196 等待者，Q=200 使**全部**合法手动交卷可排队而不因队满被拒——队满只作有界失败保护 |
| W_sub（排队等待预算） | **15000 ms** | 单调时钟。上界推算：200 人 / 4 许可 = 50 波；S1 实测交卷事务跨度 851–1033ms/200 并发（含池排队）；S3 下每波事务应显著更短（池内事务并发 ≤4 + 背景），50 波 ≪ 15s。选 15s = L3 W 候选空间上界，留足余量且仍能在病态滞留下有界拒绝 |

> Q_sub/W_sub 不是 S3 的预注册候选（§4 只预注册 S_sub）；本表在正式采样前
> 写定，采样后不改。二者不改变 S_sub 的干预语义：任何时刻进入手动交卷事务
> 的并发 ≤4；等待者不持 PG 连接、不查询、不写任何业务状态。

## 2. 干预实现（研究分支，disposable）

- `apps/api/src/lib/submitAdmission.ts`：进程级 FIFO 信号量；`SUBMIT_ADMISSION=1`
  才生效，否则 `getSharedSubmitAdmission()` 返回 null，A 路径逐字不变。
- 位置：`POST /api/attempts/:attemptId/submit` handler 内，认证/归属/参数校验
  之后，candidate profile 查询与 `submitAndGradeAttempt` 事务之前；许可覆盖
  整个手动交卷操作（查询 + 事务 + 提交后读）。
- 拒绝语义：队满或等待到期 → `503 SUBMIT_BUSY` + `Retry-After`；**该手动
  请求未执行**（无 attempt 状态变化、无 attempt.submit 审计、无评分副作用）。
  scanner、autosave（save answer）、heartbeat、监考读取均不经过该门，独立运行。
- 不做（ADDENDUM/协议明示）：按 examId 串行、微批、返回 202、增加宽限、
  异步评分、扩 PG 池。
- 事务重试策略、取时位置（route-entry `fastify.now()`）、池 max=10、limiter、
  Argon2 参数全部与 A 一致。

## 3. 固定矩阵与臂切换

| 序 | run id | 臂 | 配置 |
| --- | --- | --- | --- |
| P | `S3-ADMIT-PILOT-S4-P3-S20-overlay-r1` | S4 | pilot S20 × overlay（不入统计） |
| A/A-1 | `S3-ADMIT-A-P3-S200-overlay-aa1` | A | 同场 200 × P3 × overlay |
| A/A-2 | `S3-ADMIT-A-P3-S200-overlay-aa2` | A | 同上（噪声地板） |
| 对1 | `S3-ADMIT-A-P3-S200-overlay-r1a` → `S3-ADMIT-S4-P3-S200-overlay-r1b` | A→S4 | 交错臂序 |
| 对2 | `S3-ADMIT-S4-P3-S200-overlay-r2b` → `S3-ADMIT-A-P3-S200-overlay-r2a` | S4→A | 交错臂序 |
| 对3 | `S3-ADMIT-A-P3-S200-overlay-r3a` → `S3-ADMIT-S4-P3-S200-overlay-r3b` | A→S4 | 交错臂序 |

- 配置选择：同场 × P3 交卷 × 叠加固定速率 save 5s±2 / heartbeat 15s±5（20 名
  跨场背景考生）+ 2 名监考 3s 轮询。理由：T7(b) 的混合 QoS 恶化正是该配置
  实测到的；纯交卷轮无法产出混合 QoS 读数。每 run 之间 R1 完整重置 + fresh
  JWT；到达表 = `arrival-p3-200.json`（与 S1 逐字节相同，SHA256 见证据清单）。
- A 臂 = 冻结 SHA 构建 `apps/api/dist`（与 S1 完全一致的产物，SHA256 记入
  run-meta）；S4 臂 = `apps/api/dist-s3`（研究分支 tsc 构建）+ `SUBMIT_ADMISSION=1`。
- 每 run pre/post 双臂校验：`/proc/<pid>/environ` 实测 + `/api/research/capacity`
  快照 `submitAdmission` 字段（A 必须为 null，S4 必须 config=4/200/15000）。

## 4. S2 全业务结果在 S3 下的重验

- 用 S2-TIMING 的 `s2-gate.mjs` 在 S4 臂（`SUBMIT_ADMISSION=1`）上重跑全部
  可复跑案例：live 协议案例 ①-a/①-b/①-b'/③-a/③-b（真实 nginx + PG 锁
  barrier）+ in-process 案例 ②-a…②-e（受控时钟 + 真实 PG `exam_test_s2`）。
- 判据：与 S2-GATE-r1-live / S2-GATE-r1-inproc 的断言集逐项一致，全部 PASS；
  任何失败按 T5 处理并保存最小见证。
