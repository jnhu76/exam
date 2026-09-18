# EXAM-549-ADMISSION-RELEASE-SEMANTIC-DECISION-1

```text
BASE_SHA: 1eff3f49b6dc13336d4e17593c120d77c680e080
HEAD_SHA: (见 PR；research 分支 research/549-admission-release-semantics-1)
BRANCH:   research/549-admission-release-semantics-1

CURRENT AUTHORITY:
  PostgreSQL exam_admissions 是唯一持久权威；资格 = 纯谓词
  computeBatchRelease(anchor=earliestJoinedAt(全部行), now, batchSize, batchInterval)
  对稳定序 ceil(countAllAhead+1 / batchSize) ≤ releasedBatches；
  物化 = admitOnce CAS（write-once），仅由两条需求路径触发
  （queue 轮询 join→reconcile→preview；start 门 ensureStartAdmission 事务内）。
  eligibility != admittedAt（资格时间可推导；admitted_at 是物化事实时间戳）。

CURRENT MATERIALIZATION TRIGGERS:
  1. candidate POST /attempts/:examId/queue（每 2s 前端 poll loop）
  2. candidate POST /attempts/:examId/start（事务内 reconcile）
  无后台触发器（repo-wide 证实）；restart 无需追赶。

PRODUCT REQUIREMENT:
  ELIGIBILITY_AT_T
  （MATERIALIZED_AT_T：无现行契约要求；现行 as-built 语义即需求驱动，见 01）

OBSERVABLE DIFFERENCE (A vs B，无考生流量时):
  - 候生端：不可观察（UI ready 来自持久事实；断线即无请求）。
  - 监考端：不可观察（proctor 服务不触及 exam_admissions）。
  - 指标/审计/外部集成：不存在（消费者审计 00 §3）。
  - start 门：不可观察（start 自带 reconcile，语义与 B 下相同）。
  - admin admissions 视图：**唯一可观察面**——它读持久行，断线期间会显示
    waiting（资格已到但未物化）。其 as-built 契约是"持久事实列表"而非放行进度；
    本 PR 明文固化该语义，不构成 B 的需求。

BURST EVIDENCE:
  scenarios:  16 场景矩阵（N=20/50/100/130/200 × Δt∈{1,6,全部} 批 + F-08-2 复现
              R：56 等待/4 已消费/Δt=45s），B=20 I=15s，16/16 谓词=实测，0 错误
  measurements: 恢复 poll 恒定 ~10 条语句（资格者含 1 次 CAS 写）；
              N=56 → 219ms 墙钟；N=130 → 281ms；N=200 全资格 → 417ms（p95=415ms，
              池活跃峰值=10，全饱和但零错误零超时）
  bottleneck:  postgres.js 池（max=10，生产形状），非查询本身（单查询 2–4ms；
              大 N 下端到端延迟 ≈ 池排队）。原始 JSON 与 harness 见 02。

OPTION A — KEEP_LAZY:
  authority:        资格=纯谓词（引擎唯一实现）；物化=CAS 持久事实
  restart:          零追赶（下一请求由 durable 事实重算）
  multi-instance:   CAS 收敛；supported 拓扑=1 实例（#554 终裁）
  idempotency:      admitOnce write-once（Q5 测试钉住）
  backpressure:     请求路径/连接池天然边界（实测吸收 200 人风暴）
  failure:          reconcile 失败 ⇒ 有资格未物化，下次交互自然重试；start 门 fail-closed
  admittedAt 语义:  物化/对账时间戳（≈ 首次权威交互时刻），非资格边界、非 SLA、
                    非排序/截止/计费权威（消费者审计 00 §3：无任何消费者如此解释）
  costs:            ①恢复期需求触发 burst（容量契约，#550 必测）②admin 视图在断线
                    期间显示滞后于资格的持久状态 ③"放行"措辞需语义边界文档
                    ④每 poll 引擎三连 ~10 语句（HTTP 级另有 per-request 查询/auth，
                    真实数字归 #550 测量；无证据触发优化）

OPTION B — MATERIALIZE_SERVER_SIDE:
  owner:              进程内 bounded loop（deadlineScanner 形状；#554 排除 Redis/MQ/队列）
  enumeration:        waiting 行按 (joined_at,id)——集合化资格判定需窗口函数秩
  query shape:        每 tick O(考试全部行)（consumed 历史不可剔除，否则秩漂移）
  transaction:        逐行 reconcile（或 SKIP LOCKED 认领——后者仅 2 实例拓扑才有收益）
  idempotency:        同一 admitOnce CAS 收敛（与 demand 路径同一引擎命令）
  multi-instance:     CAS 保证正确；效率机制属假设拓扑投资
  restart:            需要 page bound + tick 间隔的追赶设计，否则服务器自制造写风暴
                      （含永不到场考生的行）
  backpressure:       需新设（tick 频率 × 页大小）——与请求路径背压脱钩
  failure:            扫描器延迟 ⇒ start 门仍自 reconcile ⇒ 扫描器非唯一权威；
                      同一跃迁两个触发器，B 的正确性增益 = 0，只剩"提前写"
  operational cost:   loop 生命周期/指标/readiness/drain、query-plan 证据义务、
                      固定池新增争用、tick/catch-up/多实例测试面、新失败模式
  second-authority risk: 查询内实现资格谓词 ⇒ 第二份实现（被 §10 禁止）；
                      逐行 reconcile ⇒ 单权威但空转浪费。无第三形状。

DECISION:
  KEEP_LAZY

AUTHORITY DIAGRAM:
  engine.computeBatchRelease（纯谓词，唯一资格权威）
      ▲ 重算输入 = durable 行 + 请求时服务器 now
      │
  exam_admissions（PostgreSQL 唯一持久权威；admitted_at=物化事实，CAS write-once）
      ▲ admitOnce CAS
      │
  ┌───┴────────────────────────────┐
  │ candidate demand（仅有的两个） │
  │  queue poll：join→reconcile→preview
  │  start gate：ensureStartAdmission（事务内，fail-closed，START 专用）
  └────────────────────────────────┘
  （无后台 actor；本决策明示不添加）

FAILURE / RESTART SEMANTICS:
  - 请求失败/进程重启：无任何持久损害；下一次权威交互按 durable 事实重算并补物化。
  - 长断线：资格随墙钟推进（数学事实），物化保持 NULL 直至交互——这是契约，
    不是缺陷。
  - 恢复风暴：需求触发、池背压有界（实测 N=200 → 417ms / 0 错误）；作为容量契约
    交由 #550 在真实 HTTP 栈复验。
  - START 语义不变：admission 只 gate 新 attempt 的 START；resume/restore 永不过门。
    durable 权威全程不出 PostgreSQL；无 Redis/MQ/新基础设施。

#550 ADMISSION WORKLOAD CONTRACT:
  ADMISSION_CAPACITY_SCENARIO（供 #550 直接复用的规范负载，HTTP 级）:
    setup:    requireQueue=true 的已发布考试；N 名考生完成登录+报名。
              限流配置必须显式声明：全局 limiter 默认 100/min/IP（settings.ts:694）、
              login 10/min（auth.ts:120），生产模式下的脚本化 burst 会被 429
              并使 start oracle 失真——在 e2e 模式或等价授权配置下运行，limiter
              本身的行为另属 #550 的 NAT/限流维度，不在本 workload 内混测。
    phase 1:  join burst——N 并发 POST /attempts/:examId/queue（入队锚点=join
              burst 的 wall-clock 起点，Δt 一律从 anchor=最早 joined_at 起算）
    phase 2:  poll pause——全部考生停止轮询 Δt；HTTP 栈无时钟注入点（fastify.now
              在启动时装配），用真实 sleep 或按 anchor 折算的等待实现
    phase 3:  resume burst——N 并发恢复 POST /queue，然后全部 ready 者 POST /start
    矩阵:     N ∈ {20,50,100,130,200}；batchSize=20, batchInterval=15s；
              Δt ∈ {15s, 90s, ceil(N/20)×15s}
    expected:  资格数 = min(waiting, (floor(Δt/15)+1)×20)；durable 写数 = 资格数
              （每资格者恰 1 次 CAS；重复轮询零额外写）
    success oracle: 无 5xx/超时；start 201/200 语义正确（fail-closed 409 对未资格者）；
              DB 权威核验 admitted_at 数 = 资格数；preview.ready 数 = 资格数
    metrics:  p50/p90/p95/p99/max（queue 与 start 分开）、DB pool active/waiting、
              errors/timeouts、恢复期墙钟
    引擎级基线: 本分支 02 表（N=200 全资格 417ms/0 错误，canonical run）——HTTP
              栈不得劣于同数量级（同一池形状），劣化即暴露 API 层问题。

IMPLEMENTATION REQUIRED:
  NO
  （research 报告 + active 语义文档 + harness/产物；零生产行为变更，零 schema 变更）

VERDICT:
  READY_FOR_HUMAN_DECISION_REVIEW
```

## 决策依据（一段话）

现行产品契约只承诺**资格边界**（ELIGIBILITY_AT_T）：批次时刻 T 之后，考生的下一次
权威交互必然被放行。没有任何观察者需要在考生不交互时看到 admitted_at 推进；
唯一例外是 admin 只读视图，其 as-built 契约是持久事实列表而非放行进度。恢复期
burst 是需求触发、池背压有界、0 错误（16 场景实测），且 restart/多实例/幂等正确性
全部已由 CAS + durable 事实承载。添加自主写者（Option B）不购买任何正确性
（start 门自带 reconcile，扫描器永远非唯一权威），却引入枚举成本、second-authority
风险、追赶设计与运维面。按 #15 举证规则，举证责任未满足 → KEEP_LAZY。
