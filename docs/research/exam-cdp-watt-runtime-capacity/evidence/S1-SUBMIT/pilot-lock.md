# S1-SUBMIT pilot 记录（协议 §9.1；ADDENDUM §2.1 降采样矩阵）

Pilot run ×2（S20 缩小规模，不入正式统计，单独归档）：

## S1-PILOT-same-pure-P3-S20（same 臂 · 纯交卷）

- 链路全通：prep 20/20（login/start/take/save:1/save:2，闭式并发 10）；
  P3 突发 20/20 verified；oracle terminal-ok 20/20（graded、reason=manual、
  12/12 评分 entry、receipts 链 [1,2]、审计副作用 1/考生、dupActive/dupTerminal=0）；
  db-oracle：20 graded / 20 submit 审计 / 40 receipts / distinct IP 21。
- driver T6：丢样 0、CPU max 10.1%（1 核口径）；emit lag 首版量纲 bug
  （漏减 prepDonePerf，报 1197ms）——修复后真实发射宽度 4ms、按点准时
  （DB submitted_at 跨度 123ms 佐证）。
- 发现并修复：①lag 量纲 bug（见上）；②postgres.js 3.4.9 不暴露 pool
  reserved/pending（capacityResearch 探测为空，L2 系列快照同样为空）——
  池等待证据改按协议 §6 预注册的三路：sqlDelta 语句到达计数 + 客户端 RT
  分解 + pg_stat_activity 会话占用（pgSide.busy）。
- 热基线探针（窗口外一次性见证，消耗 1 名合成考生）：路径已热、无竞争时
  单次 submit 全链 56ms（nginx+auth+前置读+事务+两次事务外读）。

## S1-PILOT-cross-overlay-P3-S20（cross 臂 · 叠加保存/心跳/监考）

- 链路全通：prep 42/42（20 交卷 + 20 背景 + 2 监考）；steady 节拍落地
  （save 5s±2 / hb 15s±5 / 监考 3s×2；pre 窗 60s：save n=237、hb n=97、
  proctor n=40，与理论速率一致）；P3 交卷 20/20 verified；oracle：
  20 graded + 背景 20 in_progress（未交卷）+ invariants 0。
- 发现并修复：③submit 发射 delay 误用绝对 performance.now()（与 now() 相对域
  混算）→ 全体提前 t0Perf≈39ms（lag=-39ms 佐证）；修复为 now() 域。
- n=20 下无叠加外溢（saveT7 p99 45ms vs pre 48ms）——符合预期（该规模交卷
  风暴未达池压）；正式矩阵在 S200 观察。
- borrow 分解残差在冷进程下含 submit 路径首触 JIT（~100ms 量级）——正式
  判定以 pgSide 池满载（pollsAtMax10）协同佐证，不以残差单独定论。

## 参数锁定（§4 无 S1 自由候选；以下为本 harness 的执行常量）

- 到达表 arrival-p3-200.json：mulberry32(9001021) 与 G1/L2 driver 同法，
  offsets 0-4ms，跨臂跨 run 复放；pilot 用同流前 20 值。
- PREP 闭式并发 10（fixture 准备，非测量流量）；steady lead 75s（≥60s 纯
  背景基线窗）；pure quiet 40s；HB 波 [T0-25s,T0-8s]（保持 lastActivityAt
  新鲜 <60s 超时 + 连接温热，均在测量窗口外）。
- 背景 cohort=20（same 臂取 crossField[0] 前 20；cross 臂取 sameField 前 20；
  两臂规模/节拍一致、与交卷者永不同场）；监考轮询固定 proctorA→same 场、
  proctorB→cross01。
- 每轮 R1 完整重置（topology.sh reset）+ fresh JWT（R3）。
