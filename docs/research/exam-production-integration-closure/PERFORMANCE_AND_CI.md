# PERFORMANCE_AND_CI — 性能与 CI 状态记录

- 状态：**最终交付文档**（SPEC §6.2 / §6.3 / §9 交付物 9）。记录 exact-SHA CI 事实、既有性能证据与未运行边界，不修改产品代码。
- 集成 SHA：`a5df2c90ace6366e69c951e6660dc268327b6e8a`（任务给定 exact 集成 SHA；本会话 `git rev-parse HEAD` 一致；tree `736a38f6…`，父 `0b2e2d8a…` = 四 PR 合并完成点，二者产品代码逐字节一致）。
- 裁决权威：`FINAL_PRODUCT_ADJUDICATION.md` — verdict **BLOCKED**（唯一决定性理由为 required CI 失败，外部 GitHub 计费）。未合并、未发布。

---

## 1. exact-SHA required CI：FAIL (exit 1)（本会话独立实跑）

| 命令 | 输出 |
| --- | --- |
| `gh pr checks 928 --repo jnhu76/exam` | `Static checks	fail	2s`；`API coverage / Build / CodeRabbit / E2E / Package coverage / Production transport regression / Web coverage` 全部 `skipping`；`PR_CHECKS_EXIT=1` |
| `gh api "repos/jnhu76/exam/actions/runs?head_sha=a5df2c90…&per_page=100" --jq '{total_count, runs:[…]}'` | `{"total_count":1, "runs":[{"conclusion":"failure","event":"pull_request","head_sha":"a5df2c90…","id":42593850473,"status":"completed"}]}` |
| 同上 `--jq '[.workflow_runs[]\|select(.conclusion=="success")]\|length'` | `0`（该 exact SHA 无任何 green run） |
| `gh pr view 928 --json …` | `state=OPEN, isDraft=true, mergeStateStatus=UNSTABLE, mergedAt=null, headRefOid=a5df2c90…, baseRefName=master` |

给定材料（四份评审、两版裁决、`logs/ci-static-job.log`）逐条一致地记录：run `42572487639`（`0b2e2d8a`）与 `42593850473`（`a5df2c90`）均 `failure`，`Static checks` 2s 失败且日志 `BlobNotFound` (HTTP 404)，6 个 required job 全 `skipped`，`gh run view` ANNOTATIONS 原文 *"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"*；0 success job / 0 green run；分支仅 2 条 FAIL run、无新 SHA run。阻断已登记 Issue **#930**（本会话 `gh issue view 930` → `OPEN`，标题 `[CI][Infra] GitHub Actions jobs fail pre-start — account billing/spending limit (2026-11-09)`）。

**判定**：这是**外部账户计费条件，非代码失败**，但门禁事实未变：clean-tree exact-SHA required CI **FAIL**。按 SPEC §7.2（required CI 失败必须 BLOCKED）、§8.1.7、§6.2、§3.6（「新 Issue 不是 CI 豁免」），`FULL_CI = FAIL`、`MERGE_STATUS = BLOCKED`。本地 `pnpm verify` / `pnpm e2e` 绿灯不替代 required CI（`pr-body.md` §Notes 自述）。

---

## 2. 本地门禁证据（给定材料，本会话未复跑）

| Gate | 命令 | 结果（给定材料） |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | `logs/install.log` exit 0 |
| Verify | `pnpm verify` | `pr-body.md` §Local gates / `logs/verify.log` exit 0（format:check、lint + arch/db-config/db-journal/env-contract/env-surface、eslint、typecheck、openapi check、coverage 真实 PostgreSQL、build、prod-resolution） |
| E2E | `bash scripts/e2e/run.sh`（`pnpm e2e`） | `logs/e2e.log` `E2E_EXIT=0`，2 shard 全 ✓（真实 PostgreSQL `exam_e2e_w0/w1`） |

诚实边界（来自给定材料与裁决 §6/§7）：
- `logs/verify.log` 中 db coverage 为 turbo `cache hit, replaying logs`（重放），日志未内嵌 SHA 标记；
- 这些本地绿灯**不替代** required CI，且**本会话未复跑**；
- 裁决员会话实跑的 307 / 342 个定向测试（含真实 PostgreSQL）与浏览器级 M3/M4/M5 亦属给定材料，本会话未复跑；
- 本会话实跑的静态/文档检查见 §4。

---

## 3. 性能裁决（SPEC §6.3，基于既有证据）

**verdict：PASS（未观察到回归）**，依据为既有 A/B 证据 + 四个独立评审的结构性核查；**INCONCLUSIVE** 仅限「exact-SHA CI 门控下的性能确认」，因 required CI 为 FAIL（外部计费），且本会话未重放基准。

| 关注项（SPEC §6.3） | 既有证据结论 | 依据 |
| --- | --- | --- |
| 每请求数据库写入 | 未新增 | `requestIdHeader.ts` 只写响应头；#924 成功路径无新增 DB 写（REVIEW_PROTOCOL §3.5）；`git diff` 证实 SaveAnswer engine/route 零改动 |
| 成功 SaveAnswer 遥测写入 | 未新增 | `TakeExamPage.tsx` 成功分支不写 `answer_autosave_success` 的 requestId、成功遥测不含 requestId；200 body `.strict()` 无 requestId |
| 不必要的 React render | 未新增 | #924 web 侧仅一个 state + 三处清写 + 一处展示（REVIEW_PROTOCOL §3.5） |
| 重复 HTTP 调用 | 未新增 | `requestWithMeta` 共享内核、`postWithMeta` 单一生产调用点 `TakeExamPage.tsx:898` |
| 额外 Correlation Runtime | 未新增 | 单一 `genReqId: randomUUID()` + 一个 root-scope hook；ADR-025 无 ID service / registry / OTel |
| 无界日志写入 | 未新增 | Case D header/envelope 分歧 warn 由固定窗口限流封顶；nginx 有显式轮转要求（`operations/README.md`） |
| 热路径开销 | route 投影实测 +397.9~520.2 ns/事件（realistic-mix +502.8 ns），占 events 路径 ~0.1%，两 phase 无可分辨差 | 归档 `docs/research/exam-secure-observability-remediation/10-INTEGRATION-CI-AND-PERFORMANCE.md:217`（给定材料，A/B 实测） |
| 明显 CPU / 内存 / 延迟回归 | 未报告 | REVIEW_ARCHITECTURE_DOCS §3.8「未发现失控」；`a5df2c90` 为纯文档提交（2 个 `.md`、75+/13-、零代码文件） |

`a5df2c90` 相对 `0b2e2d8a` 的唯一差异是 2 个 `.md`（ADR-025 + test-flakes.md）；`packages/contracts/src/attempt.ts` / `packages/exam-engine/src/answerProtocol.ts` / `apps/api/src/routes/attempts.candidate.ts` 自 master `5140c3dd` 起零改动 ⇒ 本轮**无热路径代码改动需要新基准**。本会话未运行任何性能基准，不把既有 A/B 结果报为本会话实跑。

---

## 4. 本会话实跑的静态 / 文档检查（任务 §6）

| 命令 | 退出码 | 输出摘要（本会话实跑） |
| --- | --- | --- |
| `pnpm format:check` | **`0`** | `prettier --check .` → `Checking formatting... All matched files use Prettier code style!`（完整输出 `/tmp/closure-format-check.log`） |
| `pnpm docs:build` | **`0`** | `Projected 16 pages (8 canonical projections) into docs-site/content/`；vitepress `build complete in 7.49s.`；`check-site.mjs` 全 PASS：`allowlist completeness (8/8)`、`content and source hashes (16 pages)`、`built route set (16 routes)`、`English/Chinese route sets`、`internal links and fragments (380 links checked)`、`all 16 routes reachable`、`repository permalinks pinned (130 links)`、`404 page`、`search index en (50 documents)`、`search index zh (50 documents)` → `All documentation checks passed.`（完整输出 `/tmp/closure-docs-build.log`） |

两条命令均在仓库根 `package.json` 定义的语义命令上实跑，未使用替代品；`docs:build` 的生成物（`docs-site/content/`、`.vitepress/dist/`）被 `.gitignore` 忽略，`git status --short` 复核无新增受控文件。

`pnpm format:check` 为 `prettier --check .`；`.prettierignore` 含 `*.md`，因此该门禁**不校验 Markdown 文件**（本目录交付物与长期文档均为 `.md`）。`pnpm docs:build` = `node docs-site/scripts/project-content.mjs && vitepress build docs-site && node docs-site/scripts/check-site.mjs`；生成物 `docs-site/content/`、`.vitepress/cache/`、`.vitepress/dist/` 均被 `.gitignore` 忽略，不进入受控树。

---

## 5. 四个 Subagent / 复审 / 裁决的 CI 相关结论（给定材料）

| 来源 | 结论 | 与 CI 的关系 |
| --- | --- | --- |
| `reviews/REVIEW_SECURITY.md` | GO（安全范围无阻塞；2 个 LOW 流程项） | 164 定向测试实跑；未跑全量门禁 |
| `reviews/REVIEW_PROTOCOL.md` | GO（2 个 low/P3 观察） | 306 定向测试实跑；未跑全量门禁 |
| `reviews/REVIEW_CI_FLAKE.md` | **BLOCKED** | F1 clean-tree exact-SHA CI 从未完成（计费）；F2 修复后新签名 `:555` 非确定性失败（1F/2P） |
| `reviews/REVIEW_ARCHITECTURE_DOCS.md` | GO（架构与文档范围） | 合并前须闭环 F-03 三项门禁条件（外部 CI / clean tree / 最终合并交付物） |
| `reviews/REVIEW_FIXTURES_FLAKE.md` | GO（夹具/flake 范围） | 两个命名验证实跑通过 |
| `reviews/REVIEW_RERUN_1.md` / `REVIEW_RERUN_2.md` | 均 NO_GO | 决定性 blocker 1 未解、`gh pr checks 928` 仍 FAIL (exit 1) |
| `FINAL_PRODUCT_ADJUDICATION.md`（18:57 最新 / 18:46 第 3 轮） | **BLOCKED** | 两版裁决字段一致；blocker 1（CI）+ blocker 2（flake/occurrence 台账）；4× KEEP_AND_MERGE |

---

## 6. Flake 与 CI 的关系（不混淆）

- #878 几何 flake：Owner 2026-11-09 明确 defer；`1f29b614` 为 1/5 探针的部分修复（settled-state 等待 + 有界 `expect.poll`，未删断言、无 retry/skip/timeout 膨胀）；4 处同族固定 150ms 残留；`ROOT_CAUSE_CONFIDENCE = HYPOTHESIS`；本会话 `gh issue view 878` → `OPEN`，`--json body | grep -cE '^\s*- \[ \]'` → `4`（4 条 Acceptance 未勾选）。
- 本次交付已在 `docs/standards/test-flakes.md` 补登 run 42483066387 与两条新签名（`:555 toBeFocused`、A3-F7 `:341`），但**不表述为已修复 / 完整 CI 通过**；blocker 2 的闭合仍依赖 #878 Acceptance 或 defer 前置的完整权威绿灯（与 blocker 1 共享 green-CI 前置）。
- 两个确定性契约失败（UUID 夹具 `req-forged-prt-0001` / `req-cross-org-*`）已修复且未被登记为 flake（SPEC §3.1 红线）。

---

## 7. 未运行 / 未知边界（诚实声明）

- 本会话**未复跑**：`pnpm verify`（全量）、`pnpm test`（turbo 全量）、`pnpm e2e` / `bash scripts/e2e/run.sh`（浏览器 E2E）、全量 `lint:*` / `typecheck` / `build`、性能基准、nginx 容器故障注入、`candidate-save-deadline-race.concurrency.test.ts` 单独复跑、GitHub 账单恢复（外部账户条件，本会话无法解除）。
- GitHub 计费故障何时恢复、能否取得 7 个 required job 全 success 的绿 CI 属外部条件，本会话无法验证，亦无法由任何代码/文档改动解决。
- `pnpm format:check` 的 PASS 不覆盖 `.md`（见 §4），文档一致性依赖 `DOCUMENTATION_CONSISTENCY_AUDIT.md` 的 review。
- 本会话未做负载下 instrumented `scrollLeft` 采样序列，故不对 flake 机制作独立因果裁决。
- **未合并、未发布**：四个源 PR 与 PR #928 仍 OPEN/draft，master 仍 `5140c3dd…`，`git merge-base --is-ancestor a5df2c90 master` → exit 1。
