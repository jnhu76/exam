# Owner 评审修订：独立复跑记录（2026-11-20）

目的：回应 Owner 对 G3/G4 两次 `exit=1` 的质疑。所有命令在 `cwd=/home/hoo/Source/exam` 下执行；使用新 run ID；只触达 name-guarded 研究库与测试库，未读写开发/生产数据，未 push/merge。

## 环境与 DB 目标

- canonical topology：API `:3300`（`apps/api/dist`，`APP_MODE=production`，`DATABASE_URL=postgres://exam:exam@127.0.0.1:5432/exam_550_e2e`）、Nginx `:8080`、研究库 `exam_550_e2e`。
- 复跑前 `topology.sh status`：405 users、11 exams、24 questions；API health `{"status":"ok"}`。
- S2 r1 失败后执行 `topology.sh reset`（exit 0）：重建 name-guarded `exam_550_e2e`，canonical seed + 400 synthetic candidates、11 exams（12 questions each）、2 proctors；API 与 Nginx 重新就绪。
- L3 barrier runner 自建自清 name-guarded `exam_550_l3_barrier`；A 臂 `exam-cap-nginx` / `:3300` / `exam_550_e2e` 全程只做健康 witness，未被 L3 runner 触碰。

## S2-TIMING gate

### r1：前置条件失败（候选池耗尽）

```bash
node /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S2-TIMING/s2-gate.mjs \
  --run-id=S2-GATE-OWNER-RERUN-r1
```

- 退出码：**2**
- 首个失败点：`[s2-gate] FATAL Error: need 5 unused candidates, got 0 (from=0)`，位于 `evidence/S2-TIMING/s2-live.mjs:197`。
- 性质：候选池已被前序 run 消耗，属于 harness 前置条件失败；**未产生断言结果**，不是产品/时序断言失败。
- 日志：`s2-gate-OWNER-RERUN-r1.log`、`s2-gate-OWNER-RERUN-r1.exit`。

### 重置研究库

```bash
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/topology.sh reset
```

- 退出码：**0**
- 结果：`[seed] rebuilt exam_550_e2e (name-guarded exam_550_e2e)`；`[seed] data phase complete: 400 synthetic candidates, 11 exams (12 questions each), 2 proctors`。
- 日志：`topology-reset-before-s2.log`。

### r2：独立复跑通过

```bash
node /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S2-TIMING/s2-gate.mjs \
  --run-id=S2-GATE-OWNER-RERUN-r2
```

- 退出码：**0**
- 结果：`live: 38/38 pass`、`in-process: 36/36 pass`、`VERDICT: PASS (live=PASS, in-process=PASS)`。
- 产物：`evidence/S2-TIMING/S2-GATE-OWNER-RERUN-r2-live/`（`assertions.json` 38 total / 0 failed；DB `exam_550_e2e`）、`evidence/S2-TIMING/S2-GATE-OWNER-RERUN-r2-inproc/`（36 total / 0 failed；DB `exam_test_s2`，自建自清）。
- 日志：`s2-gate-OWNER-RERUN-r2.log`、`s2-gate-OWNER-RERUN-r2.exit`。
- **限制**：`s2-gate.mjs` 只复跑 live + in-process；浏览器案例（25/25）需要插桩代理与两次 api-restart，不由该 gate 复跑，仍以归档 `evidence/S2-TIMING/S2-BROWSER-r4/` 为准。不能声称浏览器案例被本次独立复跑覆盖。

## L3 barrier gate

```bash
node /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/l3-barrier-gate.mjs
```

- 退出码：**0**
- 结果：内联 vitest **17/17**（gate 9 + route 8）；real-Nginx runner **15/15**（A 断连 / B 队满 / C 等待到期，各 5 reps）；`[l3-barrier-gate] ALL BARRIER TESTS GREEN (17 vitest + 15 nginx reps)`。
- 产物：`evidence/L3/L3-BARRIER-NGINX-20261120T095755/`（`l3-barrier-nginx.json`、`api.log`）。
- 日志：`l3-barrier-gate-OWNER-RERUN-r1.log`、`l3-barrier-gate-OWNER-RERUN-r1.exit`。
- 备注：case A rep 5 耗时 **59.75s**，仍通过；该次耗时未单独归因。15/15 全绿。

## 结论

- 两个可运行 gate 在新的 run ID 下均独立通过。
- G3/G4 原 `exit=1` 的原因没有被当时的台账记录；在本环境下**不可复现**。S2 的 r1 显示了一个真实的前置条件失败（候选池耗尽），不是断言失败。
- S2 的浏览器 25/25 仍为归档证据，未被本次 gate 复跑；报告按此边界表述。
- 独立复跑不改变三项架构裁决；它把可运行部分的证据强度从「未独立复现」提升为「独立复现通过」。
