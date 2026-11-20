# S1-SUBMIT 集中交卷实验（#900/#1021；协议 §10 S1-SUBMIT，降采样矩阵 PROTOCOL-ADDENDUM §2.1）

冻结基线 `87510894728ee1ca20a530fc20e29fa1f51709b7`；全部命令在
`cwd=/home/hoo/Source/exam` 下原样可执行（cmd.sh 契约，协议 §13）。

## 0. 结论速览

| 项 | 结论 | 证据 run |
| --- | --- | --- |
| T7(a) 同场集中交卷造成持续 pool wait | **成立（两臂皆然）**：借连接等待 p99 估计 2056–2254ms（阈 100ms），T7 窗内 PG 池 10/10 会话满载持续 3–6 个 250ms 采样 | 5 个正式 run 全部 |
| T7(b) 同期保存/心跳尾延迟恶化 | **成立（两臂皆然）**：叠加臂 save p99 1560/1582ms vs 同 run 基线 46/41ms（34–39×，≥50ms）；heartbeat 300/964ms vs 31ms；监考读 1929/1777ms vs 39ms | `S1-SUBMIT-same-overlay-r1`、`S1-SUBMIT-cross-overlay-r1` |
| S3 触发判定（T7=a∨b） | **触发**（a、b 同时成立；同场/跨场同因：池竞争，非同场特有） | 上两行 |
| 同场 vs 跨场（#668 之后） | 单对差分 +5.6%（纯）/+2.2%（叠加），**均 < 2×A/A 噪声地板 7.4%（p99 3.7%）→ INCONCLUSIVE**，不足以宣称同场更慢；两臂 T7 窗 lock wait 均为 **0**（exam 行 FOR SHARE 读者共存，#668 语义复现） | ①②③④⑤ |
| 交卷权威确认 | 5×200/200 唯一终态 graded、reason=manual、12/12 评分 entry、receipts [1,2]、审计 1/考生、dupActive/dupTerminal=0 | 各 run `oracle.json` |
| 交卷吞吐形态 | P3 交卷风暴 200 发射宽度 22–26ms（lag p99 10–21ms）；COMMIT 跨度同场 851–1033ms / 跨场（每场 448–910ms ×10 并行）；HTTP 末位确认 2274–2414ms（COMMIT 后两次事务外读也在池中排队） | `driver.json`/`oracle.json` |
| 池等待观测边界 | postgres.js 3.4.9 不暴露 reserved/pending（L2 系列快照同为空）→ 池证据 = sqlDelta 到达 + RT 分解 + pg_stat_activity 会话占用三路（协议 §6 预注册口径） | 各 run `api-research-snapshots.jsonl`、`pg-activity.jsonl` |

## 1. 矩阵与台账（ADDENDUM §2.1；每轮 R1 完整重置 + fresh JWT）

| 序 | run | 配置 | 结果 |
| --- | --- | --- | --- |
| ① | `S1-SUBMIT-cross-pure-r1` | 跨场 10×20 × 纯交卷 P3 | PASS：200/200，p99 2263ms，drain 2275ms |
| ② | `S1-SUBMIT-same-pure-r1` | 同场 200 × 纯交卷 P3 | PASS：200/200，p99 2389ms，drain 2414ms |
| ③ | `S1-SUBMIT-same-pure-r2` | 同场 × 纯交卷（A/A 参照轮） | PASS：200/200，p99 2301ms，drain 2316ms |
| ④ | `S1-SUBMIT-same-overlay-r1` | 同场 × 叠加（save 5s±2 / hb 15s±5 ×20 人 + 监考 3s×2） | PASS：200/200，p99 2383ms；saveT7 p99 1560ms |
| ⑤ | `S1-SUBMIT-cross-overlay-r1` | 跨场 × 叠加（同④节拍） | PASS：200/200，p99 2331ms；saveT7 p99 1582ms |
| P | `S1-PILOT-same-pure-P3-S20` | pilot（S20，不入统计） | PASS（harness/oracle 验证；发现 3 个 harness bug 并修复，见 pilot-lock.md） |
| P | `S1-PILOT-cross-overlay-P3-S20` | pilot（S20，不入统计） | PASS（叠加臂/监考/背景节拍验证） |

失败轮：无（5 正式 + 2 pilot 全部完成；R2 未触发）。

## 2. 分析口径与关键数（s1-analysis.json / 每 run s1-metrics.json）

- **到达表** `arrival-p3-200.json`：mulberry32(9001021)（与 G1/L2 同法），offsets
  0–4ms，跨臂跨 run 复放；实测发射宽度 22–26ms、emit lag p99 10–21ms（T6 PASS）。
- **T7 窗口** = 首提交请求 → 最后权威确认 +10s；基线窗 = [T0−60s, T0)（同 run
  同负载，无交卷对照）。
- **借连接等待分解**（measurement-neutrality law 禁止进程内逐请求观测）：
  `borrowP99 ≈ submitHTTP_p99 − (pgTx_p99[T7 窗] + 无事务请求 RT_p99[监考读])`；
  冷进程含 submit 路径首触 JIT 残差，故 T7(a) 判定另要求池满载协同证据
  （`pgSide.pollsAtMax10 > 0`）。5 轮 borrowP99Est 2056–2254ms、pollsAtMax10 3–6。
- **CPU/交卷**（§5.3：分子=T7 窗 API 进程 CPU 增量，分母=oracle 确认 200）：
  8.6–16.1ms/交卷；主线程占进程 CPU 83–88%，T7 窗内主线程近满载（无 EL 长阻塞，
  busy 而非 blocked）——#900 侧线索，归 M1（已裁撤）对照参考。
- **lock wait**：T7 窗内两臂 5 轮全 0；PREP 窗（非测量）存在 exam 行 FOR SHARE
  的 Lock:tuple 短等待（≤207ms，10 场/1 场两臂皆有）——同场未放大到测量窗。
- **小样本纪律**：saveT7 n=45–47、hbT7 n=13–15（p99=max 已同报，原始分布见
  s1-metrics.json `bg.*.sortedMs`）；submit n=200（sorted 数组在 driver.json）。

## 3. 复跑

```bash
# cwd=/home/hoo/Source/exam（每 run cmd.sh 同内容）
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S1-SUBMIT/s1-run.sh \
  --run-id=S1-SUBMIT-same-pure-r1 --arm=same --mode=pure --n=200 --reset=1
# oracle（run 内自动执行；单独重跑）
pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
  /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S1-SUBMIT/s1-oracle.ts --run=S1-SUBMIT-same-pure-r1
# 分析（5 轮一起）
python3 /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S1-SUBMIT/s1-analyze.py \
  S1-SUBMIT-cross-pure-r1 S1-SUBMIT-same-pure-r1 S1-SUBMIT-same-pure-r2 S1-SUBMIT-same-overlay-r1 S1-SUBMIT-cross-overlay-r1
```

代表性复算已做（协议 G6.5）：从 `S1-SUBMIT-same-overlay-r1/samples.jsonl` 原始行
重算 submit p99=2383/verified=200、saveT7 p99=1560、hbT7 p99=300，与
s1-metrics.json 一致；nginx access log rt p99（2.362/2.315/2.384s）与 driver
submit p99 逐 run 对上（第二源核对）。

## 4. 边界与不适用

- 单机 WSL2 拓扑（协议 §1 注明的边界）；P3 同刻精度受 vpnkit 桥 ~1op/ms 限制
  ——本轮 200 交卷发射宽度 22–26ms，未触及该上限（连接经 T0 前心跳保温）。
- A/A 参照仅 1 对（ADDENDUM 缩减），方向一致性不可评估；同场 vs 跨场的
  ±2–6% 差异全部落入噪声区 → INCONCLUSIVE，不得引用为“同场更慢/不慢”的证据。
- pgTx 时长为 250ms 采样下界（短事务可能整段错过），跨轮方差大（90–179ms），
  只作机制参考，不作臂间判据。
- S3-ADMIT（事务前全局手动交卷上限，先筛 S_sub=4，≥3 配对）由 T7 判定触发，
  属后续实验；本目录不预填其结果。
