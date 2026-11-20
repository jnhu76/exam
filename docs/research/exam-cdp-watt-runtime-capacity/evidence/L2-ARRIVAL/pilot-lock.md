# L2-ARRIVAL pilot 记录（协议 §9.1）

Pilot run：`L2-PILOT-P2-S20-r1`（协议 §10 指定 pilot 点 P2×S20；不入正式统计，单独归档）。

结论：管线全链通过——

- 四级计数 326/326（offered=sent=gotResponse，丢样 0）；
- login 20/20 成功（p50/p95/p99/max = 56/63/63/63ms），DB oracle 独立成功 20/20、
  20 graded、无不变量违反；
- driver T6 PASS（emit lag p99=3ms/max=13ms，driver CPU max 2.6% 单核，丢样 0）；
- 采样器 286 快照 0 错误（API /proc + /api/research/capacity）；
- 拒绝分类 0（设计内 aborted 回放 3 个单列）。

## 参数锁定（L2 无 §4 自由候选需锁定）

- 到达形态 P1/P2/P3、窗口 240s、尾部 30s：协议 §3 冻结定义，driver.mjs 原样实现；
- cohort 台阶 S20/S50/S100/S200：协议 §2.1 预注册（S130 仅拐点补测，未触发）；
- flow=mix b-share=0.1、seed=9001021、from=0：沿用 G1 保真回放约定（README §3），
  全 run 一致；
- 每.run R1 完整重置（topology.sh reset）+ fresh JWT（R3）。

## 执行序列（交错配对臂序，协议 §9.3）

每尺寸 5 对：奇数对 A=P1→B=P2，偶数对 B=P2→A=P1；执行序
P1r1,P2r1 | P2r2,P1r2 | P1r3,P2r3 | P2r4,P1r4 | P1r5,P2r5
（run2→3、run4→5 为同臂连续邻接，兼作系列内 A/A 见证；P3 系列 r1/r2 连续亦为 A/A）。

## pilot 产物勘误（保留原样）

pilot 首轮 l2-run.sh 曾把编排 meta 写到 `run-meta.json` 覆盖 driver 的
run-meta（startedAt 丢失）；已修正脚本改写 `l2-run-meta.json`，pilot 目录中该文件
已改名为 `l2-run-meta.json`，driver epoch 以 samples 的 plannedEpoch 确定性重建
（见 l2-metrics.py fallback）。后续 run 不再发生。
