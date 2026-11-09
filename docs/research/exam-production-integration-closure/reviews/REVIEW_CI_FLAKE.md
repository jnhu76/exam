# REVIEW_CI_FLAKE — Subagent C：CI / Flake 可靠性独立终审

- 审查对象：exact 集成 SHA `0b2e2d8a1653ebba59326517ec2fdc6b4c7cf4bc`
- 工作树：`/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`（分支 `integration/production-closure-20261109`，PR #928 draft）
- 审查时间：2026-11-09（UTC 18:00–18:40 前后）
- 方法：只读集成树 + GitHub Issue/Actions 原始证据 + 本机同配置实跑；未读取任何其他评审文档。
- **VERDICT = BLOCKED**（required CI 门禁未满足，外部计费原因；另发现修复后测试仍有一次非确定性失败的新签名）

---

## 0. SHA 核对（首个必须项，结果为偏差）

`git rev-parse HEAD` → `a5df2c90ace6366e69c951e6660dc268327b6e8a`，**不等于**要求的 `0b2e2d8a`。

- 差异 = 1 个 docs-only 提交 `a5df2c90`（`docs/adr/ADR-025-http-request-correlation-identity.md` +42/-4、`docs/standards/test-flakes.md` +37/-5，`git diff --stat 0b2e2d8a a5df2c90` = 2 files, +75/-13，零代码/测试文件）。
- 另有 1 个未跟踪文件 `docs/research/exam-production-integration-closure/FINAL_PRODUCT_ADJUDICATION.md`（上一轮裁决产物，docs 产物，非测试夹具、非构建依赖）。
- 结论：**代码与测试层面 HEAD 与 exact SHA 完全一致**（docs-only 偏差），三个修复提交均为 `0b2e2d8a` 祖先（`git merge-base --is-ancestor` 实测通过：`ca7e62ec`、`9dd1d5f4`、`1f29b614`）。本评审对代码/测试的结论同时适用于 exact SHA；CI 层面的证据按 SHA 分别引用。

---

## 1. 已验证事实（全部为本会话实跑/实读）

### 1.1 flake 修复本身（commit `1f29b614`）质量：合格，未放宽 oracle

- `git show 1f29b614 --stat`：仅 1 文件 `apps/e2e/e2e/rich-content-overflow.spec.ts`，+18/-5，与报告声称完全一致。
- diff 核对：删除 `waitForTimeout(150)` + 单次采样 `expect(promptScrollAfter).toBeGreaterThan(promptScrollBefore)`；改为 (a) settled 前置：`:564 toHaveCount(1)`（`.katex`）+ `document.fonts.ready` + `:569 toBeFocused()` + `:570 data-overflowing=true`（新增 3 条断言，**加强** oracle）；(b) `:577-581 expect.poll(scrollLeft, {timeout: 5s}).toBeGreaterThan(promptScrollBefore)`（断言语义不变，有界条件等待）。
- 无 retry（`apps/e2e/playwright.config.ts:26 retries: 0` 实读）、无 skip/fixme（grep 0 命中）、无全局 timeout、无 shard 减少。符合 #878 scope 点名的等价修复（`expect.poll` 到 `scrollLeft > before`）与 SPEC §3.4 禁令。
- 登记册同步（`a5df2c90` 对 `docs/standards/test-flakes.md` 的更新）如实标注：部分修复、#878 仍 OPEN、`ROOT_CAUSE_CONFIDENCE = HYPOTHESIS`、无 post-fix 权威 CI 绿灯、"本地 pnpm e2e 通过不构成 flake-rate 证明"。未发现过度声明。

### 1.2 两个 UUID 夹具修复：确定性契约失败，归类正确，未登记为 flake

- `ca7e62ec`：`investigation-ui-acceptance.spec.ts` M3 forged requestId 从 `req-forged-prt-0001` 改为合法 UUIDv4（`00000000-0000-4000-8000-000000000bad`）。CI 证据（本会话从 `/tmp/pr923-flake/job128847373789.raw.log` 实读）：run 42518523050 失败签名 `Expected substring: "req-forged-prt-0001"`（`investigation-ui-acceptance.spec.ts:844`）——夹具违反 #923 投影 UUID shape gate，属**确定性契约失败**。修复后 run 42564029701 shard 1 为 `1 failed / 21 passed`，唯一失败是 `:568` flake——M3 失败消失，修复有效。
- `9dd1d5f4`：`proctorMonitoring.crossOrg.test.ts:229` claimedRequestId 从 `req-cross-org-*` 改为 `randomUUID()`，使 positive control 走真实投影形状。该 PR 最终头 run 42563996915 所有非 E2E lane（Static/Build/API coverage/Web coverage/Package coverage/Production transport）全部 success。
- `docs/standards/test-flakes.md` 全文 grep `req-forged|forged|UUIDv4|shape gate` = 0 命中：**UUID 夹具问题未被登记为 flake**，符合 SPEC §3.1 红线。ADR-025 增编（informational，`a5df2c90`）与该 gate 语义一致（shape ≠ identity，decision 6 未收窄）。

### 1.3 原始 flake 失败的权威证据链：真实、多 head、已核实

本会话逐一用 `gh api` 核实并从 `/tmp/pr923-flake/*.raw.log` 实读签名 `:568 Expected: > 0 / Received: 0`：

| run / job | head | shard | 核实结果 |
|---|---|---|---|
| 42518523050 / 128847373789 | d3580f3e | 1/2 | failure，`:568` 签名 + M3 UUID 确定性失败 |
| 42564029701 / 128987131154 | ca7e62ec | 1/2 | failure，仅 `:568`（1 failed/21 passed） |
| 42563996915 / 128987063313 | 9dd1d5f4 | 2/2 | failure，仅 `:568` |
| **42483066387 / 128739753640**（评审新发现） | 872a244f | **2/2** | failure，同一 `:568` 签名（本会话 `gh api` 日志实读） |

加上登记册既有 41611378188、42378974125、42389069178，同签名跨 ≥8 个 head；#878 评论记录同 head rerun 双 shard 通过（复跑通过 ≠ 根因消除）。非确定性成立，归类为 flake 有充分权威证据。本地未复现（调查员 4 次 PASS，报告如实记录"不声称复现"）。

### 1.4 clean-tree exact-SHA CI：**不完整**（BLOCKED 主因）

- exact SHA `0b2e2d8a` 上的 CI run 42572487639（PR #928 base push，event=pull_request，conclusion=failure）job 明细实读：`Static checks | failure`；`Build / E2E / API coverage / Web coverage / Production transport regression / Package coverage` 全部 `skipped`。
- Static checks 失败原因 = check-run 129014326750 annotation 原文："**The job was not started because recent account payments have failed or your spending limit needs to be increased.**"；job 时长 2 秒、无 runner、日志 BlobNotFound（404）。**非代码失败，是 job 根本未启动**。
- 计费阻断至今未解除：本评审时点最新 run 42593850473（a5df2c90，09:29Z 触发，10:04Z 执行）同一 annotation、同样 6 required job skipped；run 42567527001（1f29b614 push 后）与 42583847375（work/scratch）同签名。即：**修复 commit `1f29b614` 与 exact 集成树从未获得任何完成的 CI 运行**。
- 该阻断已登记 Issue **#930**（OPEN，2026-11-09）；`a5df2c90` 提交信息与登记册均如实声明"MERGE_READINESS 的 CI 门禁在此前不能声称满足"。登记诚实。

### 1.5 PR 合并顺序的 CI 缺口（过程性）

`git merge-base --is-ancestor` 实测：`1f29b614` 经 4919e534（PR #923 merge）、`9dd1d5f4` 经 9bba9fbf（PR #924 merge）进入 exact SHA。两个 PR 最终头的 CI：非 E2E lane 全绿，但 E2E 因 `:568` flake 失败（42564029701、42563996915）或被计费阻断（42567527001）——**两 PR 均在最终头无绿 E2E 的情况下被合并**，兜底依赖 #928 集成门禁，而该门禁现被计费阻断（见 1.4）。此为 Owner 已知并书面 defer 的路径，但结果状态是：exact 树的 required E2E 从未在任何 CI 上执行。

### 1.6 五个修复后运行：同配置属实，同 HEAD 为间接证据

`/tmp/pr923-flake/postfix-run{1..5}.log` + `postfix-full.log`（本会话实读）：全部为同一 `scripts/e2e/run.sh` 输出形态，`E2E_WORKERS=2`（"并行模式：E2E_WORKERS=2，每 shard 独立 DB + server"）、端口 21000/21001（即 `E2E_WORKER_BASE_PORT=21000`）、每 run 独立 migrate+seed、双 shard ✓；`postfix-summary.txt` 记录 6×EXIT=0。
限制：日志**未内嵌 HEAD SHA**；postfix-run1（13:29 文件时间）晚于 `1f29b614` 提交时间（13:27:56 +0800），同 HEAD 主张依赖时间线与报告，非日志直接证据。

### 1.7 本评审独立实跑（同配置，a5df2c90，代码与 exact SHA 一致）

命令：`E2E_WORKERS=2 E2E_WORKER_BASE_PORT=21000 bash scripts/e2e/run.sh rich-content-overflow`（仓库唯一 E2E 入口）。

| run | 结果 | 证据 |
|---|---|---|
| verify-run1 | **FAIL**（EXIT=1）：`:555 await expect(promptViewport).toBeFocused()` 超时 5s，`Received: inactive`；`3 did not run`；shard 2 通过 | `/tmp/review-ciflake/verify-run1-FAIL-555.log` |
| verify-run2 | PASS（EXIT=0，双 shard ✓） | `/tmp/review-ciflake/verify-run2.log` |
| verify-run3 | PASS（EXIT=0，双 shard ✓） | `/tmp/review-ciflake/verify-run3.log` |

关键刻画：

1. run1 失败点 `:555` 是**修复未触及的原有断言**（修复新增代码在 `:560-581`，本 run 根本未执行到——修复的 poll 采样未被走到）。
2. 失败签名（focus 从未建立）与 CI 权威签名（`:568 scrollLeft=0`）**不同**，发生在同一测试 `:528 stable geometry`、同一 2-shard 负载拓扑。
3. 同代码同配置 1 FAIL / 2 PASS → **非确定性**，非确定性来源在修复后仍然活跃；"flake 已修复"在**测试层面不成立**，`#878` 保持 OPEN 是正确状态。
4. 合并全部 post-fix 本地记录：调查员 5/5 + full 1× + 本评审 1/3 = **1 失败 / 9 次运行**。样本不构成 flake-rate 证明（登记册原话仍有效）。
5. 该新签名**未登记**于 #878 与登记册（两者只记录 `:568` 签名）。按 SPEC §7.2 需进入 Finding → Reproduction → 登记/修复闭环（本评审无写授权，登记为移交项）。

### 1.8 dirty state 与夹具

- 集成树 `git status --porcelain`：仅 1 个未跟踪 docs 文件（FINAL_PRODUCT_ADJUDICATION.md，上一轮裁决产物）。无未提交代码、无未提交测试夹具。
- CI 证据均来自 pushed SHA（PR #928），本地未跟踪文件不影响 clean-tree 判定。
- 主仓 `/home/hoo/Source/exam` 存在未跟踪 `test-results/`（Playwright 产物目录，非本工作树，未评审）。

### 1.9 E2E 失败全量清点（近期窗口，2026-11-08 至今）

所有 CI failure 均可解释：`:568` flake（≥5 次权威 occurrence，#878）；UUID 夹具确定性失败（1 次，已修复）；Fastify "Not found handler already set" 启动失败（run 42444103594，PR #926 中间头 d7c85b59，同 PR 后续头 1dd4d206 绿，属 PR 内迭代修复，非 flake，未登记也无需登记）；计费未启动（4 次，#930）。**除本评审 1.7 的新签名外，无不可解释失败。**

---

## 2. 发现清单

| # | 严重度 | 发现 | 证据 |
|---|---|---|---|
| F1 | **高（门禁性）** | clean-tree exact-SHA required CI 从未完成：Static checks 未启动（计费 annotation），6 个 required job 全部 skipped；至评审时点仍未解除（最新 run 42593850473 同签名）。`1f29b614` 修复与集成树均无完成的 CI 运行 | `gh api` runs 42572487639 / 42593850473 jobs + check-run 129014326750 annotation（原文见 §1.4） |
| F2 | 中 | 修复后同一测试仍非确定性失败：本评审 run1 于 `:555 toBeFocused`（修复未触及断言）失败，run2/3 PASS；新签名未登记 | `/tmp/review-ciflake/verify-run1-FAIL-555.log` + run2/run3 EXIT=0；命令见 §1.7 |
| F3 | 中 | PR #923/#924 最终头无绿 E2E 即合并（flake 失败或计费阻断），兜底的 #928 集成门禁被 F1 阻断 | `gh api` runs 42564029701/42563996915/42567527001 jobs；`git merge-base --is-ancestor` |
| F4 | 低 | 工作树 HEAD = exact SHA + 1 docs 提交 + 1 未跟踪裁决文档；代码一致但与"HEAD 等于该 SHA"的核对前提不符 | `git rev-parse HEAD`；`git diff --stat` |
| F5 | 低 | 登记册"后续权威 occurrence"清单缺 run 42483066387（同 `:568` 签名，shard 2/2，head 872a244f） | `gh api` 该 run job 128739753640 日志 |
| F6 | 低 | postfix-run{1..5} 日志未内嵌 HEAD SHA；同 HEAD 主张依赖时间戳与报告（同配置已由日志直接证实） | `/tmp/pr923-flake/postfix-*.log` |

未发现：测试放宽（1.1 反证）、UUID 问题误登记为 flake（1.2 反证）、重跑掩盖（retries=0、无 skip；rerun 证据均被标注"不构成根因消除"）。

---

## 3. 复现步骤（F2）

```bash
cd /home/hoo/Source/exam-gap-worktrees/integration-closure-20261109   # HEAD a5df2c90（代码=0b2e2d8a）
E2E_WORKERS=2 E2E_WORKER_BASE_PORT=21000 bash scripts/e2e/run.sh rich-content-overflow
# 观测：多次运行；失败形态 = shard 1 `stable geometry` :555 toBeFocused 超时（Received: inactive）
# 本评审实测：run1 FAIL（EXIT=1）、run2 PASS、run3 PASS
```

F1 复现：`gh api /repos/jnhu76/exam/actions/runs/42572487639/jobs`（6× skipped）+ `gh api /repos/jnhu76/exam/check-runs/129014326750/annotations`（billing 原文）。

---

## 4. 推荐最小后续（移交，非本评审执行）

1. 计费恢复后重跑 #928 required CI（含 Static checks），取得 exact 树的完整绿 CI——F1 解除的唯一路径；在此之前不得声称 MERGE_READINESS 的 CI 门禁满足（与登记册/提交信息一致）。
2. 将 §1.7 新签名（`:555 toBeFocused` 超时、`Received: inactive`、2-shard 同拓扑）作为后续 occurrence 登记进 #878 与 `test-flakes.md` OBS-2026-11-03-001（同测试、同负载拓扑、不同站点；不与新 case 合并，除非证明独立根因）。
3. 补登 run 42483066387 occurrence（F5，一行即可）。
4. #878 下轮按既定验收：2-shard 负载 instrumented `scrollLeft` 采样 + 5 处固定 150ms 全量收口（当前 `:934/:1011/:1092/:1133` 仍为固定等待，本会话 grep 实证）+ 达到 flake 门槛。

---

## 5. 未知边界

- post-fix 权威 CI 绿灯不可得（计费，外部）；本地 PASS 不构成 flake-rate 证明。
- `:555` 表现与 `:568` 是否同根因（KaTeX swap / focus 丢失路径）未证明——无 instrumented 序列；1/9 样本不估计比率。
- Static checks 在 exact 树从未真正执行，集成树的静态门禁同样未被 CI 验证过。
- `9dd1d5f4` 夹具修复以 diff + 该 PR 最终头非 E2E lane 全绿佐证，未单独实跑该 API 测试。
- 计费恢复时点未知；重跑后 E2E 是否绿未知。

## 6. VERDICT

**BLOCKED**。理由：SPEC §7.2 "required CI 失败，必须 BLOCKED"——exact 树 required CI 因外部计费从未完成（F1），且本评审以同配置实跑取得修复后测试仍非确定性失败的新证据（F2），两者均未解除。F2 不属于确定性契约失败（1 FAIL/2 PASS 表征为非确定性），不推翻 #878 的 OPEN/DEFER 处置；产品代码层面未发现由本轮引入的确定性回归信号。
