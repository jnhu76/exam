# L3-ADMISSION pilot 记录 + K/Q/W 锁定（协议 §9.1/§4 + 附录 §2.2）

Pilot run：`L3-ADMISSION-PILOT-B-P2-S200-r1`（arm=B，附录锁定场景 P2×S200×T-DIRECT
本身作 pilot 载荷；不入正式统计，单独归档）。执行时间 2026-11-20 12:1x–12:2x CST。

## 管线验证（全链通过）

- 四级计数 3258/3258/3258（planned=actuallySent=gotResponse），会话 200/200；
- login 200/200 成功（p50/p95/p99/max = 57/81/92/103ms，N=200），
  DB oracle 独立成功 200/200、200 graded、不变量违反 0、flowIncomplete 0；
- 拒绝分类全 0（0×429/0×401/0×503/0 网络层/0 丢样；29 个 designedAbortReplay
  为 flow-B 刷新中止回放，设计内单列）；
- driver T6 PASS（详见 run 目录 l2-metrics.json t6 节）；
- 臂状态双级校验：/proc/environ 实测 LOGIN_ADMISSION=1（K=4/Q=189/W=5000ms）+
  研究快照 loginAdmission.config 逐项一致（arm-check-pre/post.json）；
- 到达轨迹与 L2 P2×S200 同一：schedule.jsonl 归一化（candidateIdx/flow/kind/
  plannedOffsetMs/sourceIp）3258 op 逐位相同，0 差异（考生名随机 hex 后缀每代
  重生成，系列内所有 run 同此，非到达差异）。

## 准入机制观察（pilot 实测）

- acquireEntered=204（200 考生 + 4 次 admin/仪表登录）、admitted=released=204；
- **队长峰值 = 0**（FIFO 队列从未形成：P2 尾部最大 11 login/s、任意 100ms 窗
  ≤5 到达，远低于 μ≈38.5/s 的服务率；许可峰值 = 4 = K，瞬时触及但从未超）；
- queueFull=0、timeout=0、disconnected=0；run 结束 live 句柄全 0
  （activeTimers=0、activeDisconnectWatchers=0、waiting=0、permits=0）；
- 忙碌拒绝率预览 = 0/200（503 LOGIN_BUSY 未出现）。

## K/Q/W 锁定（正式配对采样固定值）

| 参数 | 锁定值 | 依据（协议 §4 候选空间内） |
| --- | --- | --- |
| K | **4** | L1-VERIFY 拐点主值（sizing.md §2：4→8 仅 +6% 吞吐而 p50 ×1.9；K=4 已达平台 94%）。候选 {1,2,4,8} |
| W | **5000 ms** | sizing.md §3 默认档。pilot 证实 P2×S200 轨迹队列峰值为 0 → W 在本场景惰性（任何候选档位都不会触发等待），取中位保守档 5s（候选 {2,5,10,15}s） |
| Q | **189** | 公式 Q=⌈μ·W⌉−K，μ=38.5/s（L1 实测低端）、W=5s → ⌈192.5⌉−4=189。校验点 {20,50,100,200} 语义下 189 落于 100–200 档内。pilot 队列峰 0 → Q 不触发 |

锁定方式与代码默认一致（`LOGIN_ADMISSION_PERMITS=4`、
`LOGIN_ADMISSION_QUEUE_CAPACITY=189`、`LOGIN_ADMISSION_WAIT_BUDGET_MS=5000`），
由 l3-run.sh 以 env 显式传入并在每 run arm-check 双级复核。

## 执行序列（附录 §2.2 指定臂序）

1. A/A 噪声地板：L3-ADMISSION-A-P2-S200-aa1 → aa2（同臂连续 2 轮 A，
   同场景同到达表，不入配对统计；PROTOCOL §9.2 的附录保留执行）；
2. 配对 3 对（交错）：对1 A→B（r1a→r1b）、对2 B→A（r2b→r2a）、对3 A→B
   （r3a→r3b）；每 run 完整 R1 重置 + fresh JWT（R3）+ 同到达表回放
   （seed=9001021, flow=mix, b-share=0.1, from=0）。

## pilot 附注

- pilot login p99=92ms 低于 L2 系列（跨会话）A 臂 P2×S200 的中位 135ms——
  跨会话不可比（背景状态不同），正式对比只在本系列同会话交错配对内进行；
- 该 pilot 同时是 B 臂在 P2×S200 真实到达流量下的首份「实质容量拒绝」证据：
  忙碌拒绝 0/200（附录 §4 口径下 T8 型实质拒绝在本场景不成立）。
