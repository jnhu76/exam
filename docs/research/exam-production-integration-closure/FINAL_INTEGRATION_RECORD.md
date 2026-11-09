# FINAL_INTEGRATION_RECORD — 最终集成记录

- 状态：**最终交付文档**（SPEC §9 交付物 10 / §10 最终报告格式）。本文件是本次交付的记录与导航，不修改产品代码。
- **当前权威状态：§1 报告与 §10（第 3 轮收口，2026-11-09）**。§0 与 §2–§9 是 `a5df2c90…f32693c7` 各时点的历史记录（含 FAIL run 取证），其时态结论已被第 3 轮裁决与本轮收口取代/推进；历史 FAIL run 记录全部保留。
- 任务给定 exact 集成 SHA（本轮）：`52a58d4da7ec51423381510d5e19bff6425965b7`（= worktree HEAD = PR #928 headRefOid；绿 CI run 42611431690 attempt 2 附着于此）。此前轮次的 exact SHA 演进：`a5df2c90` → `e97e15fb` → `b6be2591` → `f32693c7` → `0c7350af` → `52a58d4d`（自四 PR 合并完成点 `0b2e2d8a` 起全部为纯 docs 提交）。**本文件所在的交付提交是该 SHA 之上的纯文档提交**（见 §0 SHA 口径说明与 §10）。
- 裁决权威：`FINAL_PRODUCT_ADJUDICATION.md` — **verdict = READY_FOR_HUMAN_MERGE**（第 3 轮，2026-11-09；唯一 blocker required CI 已由 exact SHA `52a58d4d` 上 run 42611431690 attempt 2 全绿解除；12 契约字段 11 PASS + receipt UNCHANGED；4× KEEP_AND_MERGE）。merge 属 AGENTS.md §7 人工门禁，本轮未执行。
- 证据纪律：`git` / `gh` 查询与代码锚点为本会话实跑/实读；测试与本地门禁数字来自给定材料（四份评审、历版裁决、`pr-body.md`、`.tmp/production-closure/logs/`），本会话未复跑；静态/文档检查的实跑命令与退出码见 `DOCUMENTATION_CONSISTENCY_AUDIT.md` §6 / §8 与 `PERFORMANCE_AND_CI.md` §4 / §8。

---

## 0. SHA 口径说明（避免混淆）

> 本节为 `a5df2c90` 时点记录（当时的 ask 给定 SHA）；本轮收口后 exact 集成 SHA 推进为 `52a58d4d`、`FINAL_DELIVERY_SHA` 为本提交，见 §10。

| 名称 | 值 | 角色 |
| --- | --- | --- |
| `BASE_MASTER_SHA` / `FINAL_MASTER_SHA` | `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d` | master 基线，本会话 `git rev-parse master` 实查；**未发生合并**，故前后相同 |
| `EXACT_ADJUDICATED_SHA` | `a5df2c90ace6366e69c951e6660dc268327b6e8a` | 任务给定的 exact 集成 SHA；四份评审与两版裁决所审的代码/契约树；tree `736a38f6e37f8434a87a27594701c95096152f53`；CI FAIL 附着于此 |
| 四 PR 合并完成点 | `0b2e2d8a1653ebba59326517ec2fdc6b4c7cf4bc` | `a5df2c90` 的父提交；最新裁决以此作为「四 PR 合并完成点」。两 SHA 的产品代码逐字节一致（唯一差异 = 2 个 `.md` 文档提交） |
| `FINAL_DELIVERY_SHA` | **本提交（当前分支 HEAD）** | 在 `a5df2c90` 之上追加 §9 交付文档、reviews 副本、SHA256SUMS 与长期文档更新的**纯文档提交**；其值 = `git rev-parse HEAD` = PR #928 `headRefOid` = `FinalResult.finalSha` |

> 一个 Git 提交不能包含自身的 SHA，故本文件不内嵌 `FINAL_DELIVERY_SHA` 字面值；权威值是集成分支 ref、GitHub PR #928 的 `headRefOid` 与工作流结果 `FinalResult.finalSha`。本交付提交产品代码零改动 ⇒ 上述评审 / 裁决针对 `a5df2c90` 代码内容的结论对新 HEAD 的代码事实仍逐字节成立；但**新 HEAD 本身未重新取得 required CI 绿灯**，`gh pr checks 928` 在交付时点仍为 FAIL (exit 1)。

合并序列（`pr-body.md` 给定材料，与 `git log --oneline` 一致）：`0b1902d0` (#922) → `4919e534` (#923) → `9bba9fbf` (#924) → `0b2e2d8a` (#926)，无冲突；集成修复 `9dd1d5f4`（#924 夹具）、`ca7e62ec`（#923 E2E 夹具）、`1f29b614`（#923 几何 flake 部分修复）均为祖先。四个源 PR 当前 head（本会话 `gh pr view` 实查）：#922 `d545983f…`、#923 `1f29b614…`、#924 `9dd1d5f4…`、#926 `1dd4d206…`。

---

## 1. SPEC §10 最终报告（严格格式；当前值，2026-11-09 第 3 轮收口后）

```text
BEGIN_EXAM_PRODUCTION_INTEGRATION_CLOSURE

BASE_MASTER_SHA = 5140c3dd0f9dbde1bdad8f5b757161f3ed96945d
FINAL_MASTER_SHA = 5140c3dd0f9dbde1bdad8f5b757161f3ed96945d
FINAL_INTEGRATION_SHA = 52a58d4da7ec51423381510d5e19bff6425965b7

UUID_GLOBAL_CONTRACT = PASS
UUID_TEST_FIXTURES = PASS
UUID_FORGED_CLAIM_ISOLATION = PASS
REQUEST_ID_CORRELATION = PASS

SAVEANSWER_END_TO_END = PASS
SAVEANSWER_CONCURRENCY = PASS
SAVEANSWER_RECEIPT_SEMANTICS = UNCHANGED

ROUTE_PRIVACY = PASS
LEGACY_ROUTE_READ_PRIVACY = PASS
NGINX_ACCESS_LOG_PRIVACY = PASS
NGINX_ERROR_LOG_DIAGNOSTICS = PASS

FLAKE_INVESTIGATION = PARTIAL
FLAKES_FIXED = 2 deterministic UUID-fixture contract failures (ca7e62ec / 9dd1d5f4) + partial #878 geometry fix 1f29b614 (1/5 probes)
FLAKES_DEFERRED = 1 (#878 geometry flake, OPEN/DEFER, 4 residual fixed-150ms waits, ROOT_CAUSE_CONFIDENCE=HYPOTHESIS) + 2 new signatures registered (:555 toBeFocused, A3-F7 :341) + run 42483066387 occurrence
FLAKE_ISSUES_CREATED_OR_UPDATED = #878 (OPEN, 4 unchecked Acceptance; registry updated, temporal statements rewritten at closure to cite green run) / #930 (OPEN; recovery documented in comments, closure pending)
REQUIRED_CI_FAILURES = 6 FAIL runs retained and never deleted (42572487639 / 42593850473 / 42607941019 / 42608435613 / 42609620433 / 42611431690 attempt 1), all external GitHub billing signature; RESOLVED by run 42611431690 attempt 2 = success on exact SHA 52a58d4d (8/8 jobs, 2026-11-09T12:07:30Z); FAIL records retained

GLOBAL_PRODUCT_CONSISTENCY = PASS
DOCUMENTATION_CONSISTENCY = PASS
PERFORMANCE = PASS

CLEAN_TREE_INTEGRATION = PASS
FULL_CI = PASS (on exact SHA 52a58d4d: run 42611431690 attempt 2, 8 required jobs all success; re-run semantics, no force push / no skip / no relaxation; the docs-only closure commit on top records its own CI outcome in §10)
POST_MERGE_SMOKE = NOT_RUN

SECURITY_SUBAGENT = PASS
PROTOCOL_SUBAGENT = PASS
CI_SUBAGENT = PASS (billing blocker F1 resolved by green run and independently re-verified; original BLOCKED / NO_GO records preserved in reviews/)
ARCHITECTURE_SUBAGENT = PASS

PR_922 = OPEN / draft / KEEP_AND_MERGE / not merged
PR_923 = OPEN / draft / KEEP_AND_MERGE / not merged
PR_924 = OPEN / draft / KEEP_AND_MERGE / not merged
PR_926 = OPEN / draft / KEEP_AND_MERGE / not merged

GITHUB_WRITEBACK = delivery docs committed + pushed to PR #928 branch; headRefOid == new HEAD; no Issue/PR body writeback in this ask
MERGE_STATUS = READY_FOR_HUMAN_MERGE (merge is the human gate per AGENTS.md §7 / SPEC §8.2; NOT merged in this ask)
RELEASE_STATUS = NOT_RELEASED

UNRESOLVED_BLOCKERS = (none — round-3 adjudication READY_FOR_HUMAN_MERGE; human merge gate pending)
ACCEPTED_RESIDUAL_RISKS = nginx error_log raw request line (Owner Decision A, bounded); #878 deferred geometry flake (single green run is not root-cause elimination); #922 archive sanitization before sharing; OpenAPI 401/403 top-level requestId (pre-existing master drift, 203 occurrences); getWithMeta zero production callers; 429 status path NOT_TESTED; transport-boundary header fault injection not run; multi-instance log correlation NOT_VERIFIED; third-party log collector / INFRA_LOG_ACCESS NOT_VERIFIED; BACKUP_RETENTION UNKNOWN

END_EXAM_PRODUCTION_INTEGRATION_CLOSURE
```

> `FINAL_INTEGRATION_SHA` 在此严格格式块中指被审的 exact 集成树（`52a58d4d`，绿 CI 附着点；见 §0 与 §10）；含交付文档的当前分支 HEAD 为 `FinalResult.finalSha`（其相对 `52a58d4d` 为纯 docs 提交）。`FULL_CI = PASS` 指 required CI 在 exact SHA `52a58d4d` 上的 run 42611431690 attempt 2 全绿（本会话 `gh api` / `gh pr checks 928` 实查 exit=0）；交付提交自身触发的新 run 的结局见 §10 记录，不在本块内预支。`PERFORMANCE = PASS` 指既有 A/B 证据与四个评审未观察到回归，**不是**新基准测量。本报告取代 §7–§9 中「所有已完成 run 全 FAIL」的不变量表述与 `FULL_CI = FAIL` 时态值；那些段落的其余取证内容作为历史记录保留。

---

## 2. 未合并 / 未发布的事实（本会话实查）

> 本节为 `a5df2c90` 时点记录；当前 CI 状态（绿 run 42611431690 attempt 2、`gh pr checks 928` exit=0）与本轮收口值见 §10。「未合并、未发布」结论在本轮仍然成立（第 3 轮收口后复核）。

| 项 | 值 | 命令 |
| --- | --- | --- |
| 集成分支 | `integration/production-closure-20261109` | `git branch --show-current` |
| PR #928 | `state=OPEN, isDraft=true, mergeStateStatus=UNSTABLE, mergedAt=null, headRefOid=a5df2c90…, baseRefName=master` | `gh pr view 928 --json …` |
| 四个源 PR | #922/#923/#924/#926 全 `state=OPEN, isDraft=true, mergedAt=null` | `gh pr view 922/923/924/926 --json …` |
| #878 / #930 | 均 `state=OPEN` | `gh issue view 878` / `gh issue view 930` |
| master | `5140c3dd…`，集成树非其祖先 | `git rev-parse master`；`git merge-base --is-ancestor a5df2c90 master` → exit 1 |
| CI | `gh pr checks 928` → `PR_CHECKS_EXIT=1`；head_sha 唯一 run `42593850473` `conclusion=failure`；success-run 计数 `0` | `gh pr checks` / `gh api …/actions/runs?head_sha=…` |
| 最终 exact-SHA CI（attempt 1） | 本 ask 给定 state FAIL；本会话复核 run `42608435613` `conclusion=failure`（head_sha `f32693c7…`），`Static checks fail 1s` + 6 required job `skipping` + `CodeRabbit skipping`，`gh pr checks 928` → `EXIT=1`，ANNOTATIONS = 账户计费 job 未启动 | `gh api …/runs/42608435613`、`gh run view`、`gh pr checks 928`；见 §8 |

`pr-body.md:3` 明示本分支 `Draft PR for CI only — do not merge directly`。**未合并、未发布、未授权任何 merge / release。**

---

## 3. 交付物清单（SPEC §9，全部位于本目录）

| # | 文件 | 状态 |
| --- | --- | --- |
| 1 | `BASELINE_AND_OWNERSHIP.md` | 保留（阶段一基线，历史证据） |
| 2 | `REQUEST_ID_GLOBAL_CONTRACT.md` | 保留（阶段二契约审计，历史证据） |
| 3 | `UUID_FIXTURE_RECONCILIATION.md` | 保留（整改建议，历史证据） |
| 4 | `FLAKE_INVESTIGATION_AND_FIX.md` | 保留（调查过程，历史证据） |
| 5 | `PRODUCT_BEHAVIOR_MATRIX.md` | 新增 |
| 6 | `SAVEANSWER_END_TO_END.md` | 新增 |
| 7 | `SECURITY_AND_PRIVACY_VERIFICATION.md` | 新增 |
| 8 | `DOCUMENTATION_CONSISTENCY_AUDIT.md` | 新增 |
| 9 | `PERFORMANCE_AND_CI.md` | 新增 |
| 10 | `FINAL_INTEGRATION_RECORD.md` | 新增（本文件） |
| 11–14 | `reviews/REVIEW_SECURITY.md`、`REVIEW_PROTOCOL.md`、`REVIEW_CI_FLAKE.md`、`REVIEW_ARCHITECTURE_DOCS.md` | 复制（字节一致） |
| 附 | `reviews/REVIEW_FIXTURES_FLAKE.md`、`REVIEW_RERUN_1.md`、`REVIEW_RERUN_2.md` | 复制（字节一致） |
| 15 | `FINAL_PRODUCT_ADJUDICATION.md` | 以最新裁决为准（19:37「第 2 轮 · 修复后独立复审裁决」版本，裁决字段与前两版一致）；交付编辑附记见本文件 §7–§9 |
| 16 | `SHA256SUMS` | 新增（本目录交付文件与 reviews 的相对路径 sha256） |

---

## 4. 长期文档更新（SPEC §5 / 任务 §3）

更新 5 份（详见 `DOCUMENTATION_CONSISTENCY_AUDIT.md` §1）：`docs/contracts/observability.md`（F-02 参数名 + §5.1 补述）、`docs/operations/save-failure-evidence.md`（§5.2 worked example）、`docs/architecture/exam-system/security-model.md`（§5.4 retention 四要素）、`docs/adr/ADR-025-http-request-correlation-identity.md`（只加信息性附录，历史正文未改写）、`docs/standards/test-flakes.md`（补登两条新签名 + 1 个 occurrence，不改闭合状态）。核查后无需改动 4 份：`docs/contracts/api-contract.md`、`docs/deployment/README.md`、`docs/operations/README.md`、`docs/standards/testing.md`。README / CHANGELOG / Release notes 按 `docs/releasing.md` 发布规范**不更新**（无发布事实，`## [Unreleased]` 保持为空）。

---

## 5. 中文回答（SPEC §10 九问）

1. **是否统一了 UUID 与 requestId 全局契约？** 是，在集成树层面：服务端单一 `randomUUID()` 铸造（`server.ts:117`），四载体同源（响应头 / envelope / pino / audit），客户端声明受形状门控且永不升级为身份；两处 P0 夹具向真实协议收敛；ADR-025 decisions 1–6 不变，仅加信息性附录。制品漂移（OpenAPI 401/403 顶层 `requestId`）是 master 预存、四 PR 未触达的 residual。
2. **测试为什么使用这些 UUID fixture？** `00000000-0000-4000-8000-000000000bad` 与 `randomUUID()` 是带 version/variant 位的合法 UUIDv4，使伪造声明真正穿过 #923 形状门控并接受「合法形状仍不可信 / 不授予跨组织可见性」的完整检验；旧 `req-*` 值会被门控正确丢弃导致正控空转通过。形状合法 ≠ 已核验身份，注释与 ADR 附录均钉住。
3. **哪些 flake 得到真正修复，哪些留下 Issue？** 两个确定性契约失败（UUID 夹具）已修复；#878 几何 flake 仅 `1f29b614` 部分修复（1/5 探针），仍 OPEN/DEFER、4 条 Acceptance 未勾选、4 处固定 150ms 残留、`HYPOTHESIS` 置信、无 post-fix 权威绿灯；新签名 `:555` 与 A3-F7 `:341` 及 run 42483066387 已在本次交付补登登记册（信息面），不构成闭合。计费阻断登记于 #930。
4. **这四个 PR 为产品带来哪些实际收益？** #922 审计证据入版本控制（318/318 SHA256 可复算）；#923 封闭词表投影消除任意 route 原始字串落库 + 形状门控；#924 补齐 2xx 侧第四载体、CORS 真实缺陷修复、200 业务拒绝可关联；#926 应用侧与 nginx access log 不再落原始 URL、error 级诊断按 Owner Decision A 恢复。四者均为 KEEP_AND_MERGE（内容判断），与全局 BLOCKED 门禁正交。
5. **最终 master 的安全与业务语义是否一致？** 集成树一致（12 个契约面 PASS、receipt UNCHANGED、跨组织隔离不新增能力）；但**尚未合并到 master**，master 仍是 `5140c3dd…`。「最终 master」的 smoke / 收口属 SPEC §8.3/§8.4，未执行。
6. **文档是否全面更新？** 是，在集成分支与长期文档范围：9 份长期文档全部核查、5 份最小更新，4 个文档一致性门禁 PASS，全局搜索无当前权威文档残留旧机制描述，历史记录与当前权威已明确区分，§9 交付物与 reviews 已纳入受控 Git 历史 + SHA256SUMS。CHANGELOG / implementation-status 按显式 DEFER 留到最终 master merge。
7. **四个 Subagent 发现了哪些问题、如何修复？** A 安全 GO（无 HIGH/MEDIUM，2 个 LOW 流程项）；B 协议 GO（2 个 low/P3）；C CI/Flake **BLOCKED**（F1 计费门禁、F2 新签名、F3 过程缺口、F5 缺 occurrence）；D 架构/文档 GO（F-01 `getWithMeta`、F-02 参数名、F-03 门禁条件、F-04 一次性并行失败、F-05 可选索引）。实质文档项 F-02（本次已修）、F-01 登记册（由 `a5df2c90` 已落地）、F-02/F-03 ADR 附录（`a5df2c90` 已落地）；本次补登两条 occurrence；其余 low 残差如实登记未隐瞒。
8. **最终哪些 PR 已合并，哪些仍被阻塞？** **没有任何 PR 已合并**。#922/#923/#924/#926 与集成 PR #928 全为 OPEN / draft / `mergedAt=null`；全部被 blocker 1（required CI FAIL，外部计费）阻塞，blocker 2（flake 闭合）耦合。
9. **是否还有需要后续 Owner 决策的事项？** 有：账单恢复后重跑完整 CI 取得 7 个 required job 全 success + 新 SHA 增量复审；#878 下轮按 Acceptance 闭合或维持 defer；四 PR 按 `#922 → #923 → #924 → #926` 顺序人工合并（AGENTS.md §7 人工门禁）与 §8.3 master smoke；CHANGELOG / implementation-status / Release notes 最终 master 收口；OpenAPI 顶层 requestId、`getWithMeta`、P1 `req-*` 夹具、429 路径、nginx live 故障注入等 follow-up。

---

## 6. 结论

`GLOBAL_PRODUCT_CONSISTENCY = PASS`、`DOCUMENTATION_CONSISTENCY = PASS`、产品契约面全 PASS，但 `FULL_CI = FAIL`（外部 GitHub 计费）、`MERGE_STATUS = BLOCKED`、`RELEASE_STATUS = NOT_RELEASED`。本次交付把证据与文档纳入受控 Git 历史，不改变裁决 verdict，不完成最终 master 收口，**不声称 CI 通过、不声称已合并、不声称已发布**。

— 交付文档编辑，2026-11-09，分支 `integration/production-closure-20261109`（Draft PR #928）

---

## 7. 推送后状态补记（本会话实查，时间无关表述）

本轮交付产生两次非 force 快进 push：`a5df2c90..e97e15fb`、`e97e15fb..<final>`（`PUSH_EXIT=0`）。以下结论不依赖「某个瞬间是否已有新 run」，因为提交不能自含其 SHA、且每次 push 都可能触发新的 CI run：

- **分支与 PR 同一性**（可复核）：PR #928 `headRefOid` = 本地 `git rev-parse HEAD` = `gh api .../git/ref/heads/integration/production-closure-20261109` 的 `object.sha`，三者始终相等；`state=OPEN, isDraft=true, mergedAt=null, baseRefName=master`；`git status --short` 为空（clean tree）。最终 HEAD 的 SHA = `FinalResult.finalSha`，以 Git ref / GitHub headRefOid 为权威。
- **required CI 在本分支任何 SHA 上从未取得绿灯**：本会话观察到的所有已完成 run —— 例如 `42572487639`(0b2e2d8a)、`42593850473`(a5df2c90)、`42607941019`、`42608435613`(最终 exact SHA `f32693c7…`，attempt 1，见 §8) —— 全部 `conclusion=failure`；`Static checks` 因外部 GitHub 账户计费未启动（1–2s 失败、日志 404），6 个 required job 全部 `skipped`，0 success job / 0 green run；阻断登记于 Issue **#930**（OPEN）。`gh pr checks 928` 在最后查询为 `PR_CHECKS_EXIT=1`；`mergeStateStatus=UNSTABLE`。每次新的 push 都会在同一外部条件下触发新的 FAIL run，故该清单按「所有已完成 run 全 FAIL」的不变量表述，不穷举瞬时 run。
- **瞬时态的正确读法**：若某个新 push 之后 GitHub 尚未触发 run，`gh pr checks 928` 可能短暂只显示 `CodeRabbit skipping`、`EXIT=0`、`mergeStateStatus=CLEAN`。这**不是绿 CI**：7 个 required job 零执行 / 零 success，`CLEAN` 只表示当前无挂起或失败的 check，不构成 required CI 通过证据。一旦 run 触发，其结论仍为本节上一条的 FAIL（外部计费，代码/文档改动不能修复）。
- 因此 §1 的 `FULL_CI = FAIL` / `MERGE_STATUS = BLOCKED` / `RELEASE_STATUS = NOT_RELEASED` 与「未合并、未发布」结论**不变**；§1 / §2 中 `gh pr checks 928 → EXIT=1` 是推送前在 `a5df2c90` head 上本会话实跑的记录，作为该 SHA 的 CI 事实保留。外部计费恢复后须在 clean tree 的 exact SHA 上重跑完整 CI、取得 7 个 required job 全 success，并按 SPEC §7.2 产生新 SHA 与独立复审；在此之前维持 draft / OPEN。

> 最终 `FinalResult.finalSha` = 本分支最终 HEAD（含本补记提交）= PR #928 `headRefOid`；提交不能自含其 SHA，故以 Git ref / GitHub headRefOid 为权威。

---

## 8. attempt 1 — 最终 exact-SHA CI FAIL 的记录与处置（本 ask）

**ask 给定材料**：「最终 exact-SHA CI 未通过（attempt 1，state FAIL）」及 `gh pr checks 928` 输出尾部：`Static checks fail 1s`（run `42608435613` / job `129130254392`）；`API coverage / Build / CodeRabbit / E2E / Package coverage / Production transport regression / Web coverage` 全部 `skipping`。

**本会话独立复核（命令与输出）**：

| 命令 | 输出 |
| --- | --- |
| `gh api "repos/jnhu76/exam/actions/runs/42608435613"` | `{"conclusion":"failure","event":"pull_request","head_sha":"f32693c7c6e6e46b2dd273a0bee54d087f4d7d21","id":42608435613,"status":"completed"}`，created `2026-11-09T11:21:47Z` |
| `gh api "…/runs/42608435613/jobs?per_page=100" --jq '[.jobs[]\|{name,conclusion}]'` | `Static checks=failure`（started 11:21:48、completed 11:21:49，1s）+ `Build / Web coverage / API coverage / E2E / Package coverage / Production transport regression` = 6 × `skipped` |
| `gh run view 42608435613 --repo jnhu76/exam` | ANNOTATIONS 原文 *"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"* |
| `gh pr checks 928 --repo jnhu76/exam` | `Static checks fail 1s` + 6 required `skipping` + `CodeRabbit skipping`；`PR_CHECKS_EXIT=1`（与 ask 给定输出一致） |

**诊断（CI 可解释的文档问题）**：这是**外部 GitHub 账户计费**导致 `Static checks` job 根本未启动（无 runner、1s 即失败、日志 404），6 个 required job 因依赖 `skipped`。它不是代码失败，也不是文档 / 链接 / 生成物失败；仓库侧的文档、链接与生成物门禁（下表）全部通过，CI 层面不存在可由文档修改修复的缺陷。按本 ask「只修文档/链接/生成物/CI 可解释的文档问题；不得改产品代码或放宽测试」，本次**零产品代码、零测试改动、零测试放宽**，仅做文档准确性修正：

1. §1 `REQUIRED_CI_FAILURES`、§2 CI 行、§7 run 清单补入 `42608435613`（attempt 1），并把「所有已完成 run 全 FAIL、0 green run」固化为时间无关不变量（每次 push 的新 run 仍 FAIL）；
2. `FINAL_PRODUCT_ADJUDICATION.md`（当时的交付编辑附记，后由并发裁决覆写为「第 2 轮」版本并移除该附记；并发与口径差异见 §9）、`PERFORMANCE_AND_CI.md` §1、`DOCUMENTATION_CONSISTENCY_AUDIT.md` §6 同步补记；
3. 新增本节记录 attempt 1 的 FAIL 与诊断；重新生成 `SHA256SUMS`（文档字节变更）。

**本会话实跑的文档 / 链接 / 生成物检查（全部 exit 0，均为根 `package.json` 语义命令）**：

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `pnpm --filter @exam/api api:openapi:check` | **`0`** | `openapi.json is up to date.`（生成物无漂移） |
| `pnpm docs:build` | **`0`** | `check-site.mjs` 10 项全 PASS：allowlist 8/8、16 页哈希、16 路由、中英路由对应、**380 内部链接与片段**、16 路由可达、**130 permalinks**、404、search index en/zh 各 50 documents → `All documentation checks passed.` |
| `pnpm format:check` | **`0`** | `All matched files use Prettier code style!`（注意：`.prettierignore` 含 `*.md`，不校验 Markdown） |
| `sha256sum -c SHA256SUMS`（本目录） | **`0`** | 18 条目全 `OK` / `0 FAILED` |
| `git diff --check` | **`0`** | 无空白 / 冲突标记 |

**结论**：verdict 仍 **BLOCKED**（blocker 1 required CI FAIL 决定性未解，外部计费 #930 OPEN；blocker 2 与之耦合）；4× KEEP_AND_MERGE 不变；`FULL_CI = FAIL`、`POST_MERGE_SMOKE = NOT_RUN`、`MERGE_STATUS = BLOCKED`、`RELEASE_STATUS = NOT_RELEASED`。外部计费恢复后须在 clean tree 的 exact SHA 上重跑完整 CI、取得 7 个 required job 全 success 并按 SPEC §7.2 产生新 SHA 与独立复审；在此之前维持 draft / OPEN。**未合并、未发布。**

> 附注：本 ask 期间检测到未跟踪 scratch `/home/hoo/Source/exam/.tmp/production-closure/reviews/REVIEW_RERUN_1.md` 被外部进程改写（`cmp -s` 与 `reviews/` 内已提交副本不一致）。`reviews/` 副本是受控 Git 历史中的交付快照、由 `SHA256SUMS` 钉住字节，依 SPEC §9「不能依赖未跟踪 `.tmp` 作为唯一交付依据」不从 scratch 重新复制，避免注入未经复核的内容。

— 交付文档编辑，2026-11-09，attempt 1

---

## 9. attempt 2 — 外部计费门禁的收敛结论（本 ask）

**ask 给定材料**：「最终 exact-SHA CI 未通过（attempt 2，state FAIL）」及 `gh pr checks 928` 输出尾部：`Static checks fail 2s`（run `42609620433` / job `129134382843`）；`API coverage / Build / CodeRabbit / E2E / Package coverage / Production transport regression / Web coverage` 全部 `skipping`。该 run 是 attempt 1 的非 force push 所触发。

**本会话独立复核**：

| 命令 | 输出 |
| --- | --- |
| `gh api "repos/jnhu76/exam/actions/runs/42609620433"` | `{"conclusion":"failure","event":"pull_request","head_sha":"0c7350af10df34ed4506f2769b7c33526c7d10d5","id":42609620433,"status":"completed"}`，created `2026-11-09T11:30:45Z` |
| `gh api "…/runs/42609620433/jobs?per_page=100" --jq '[.jobs[]\|{name,conclusion}]'` | `Static checks=failure` + `Build / E2E / Package coverage / Web coverage / API coverage / Production transport regression` = 6 × `skipped` |
| `gh run view 42609620433 --repo jnhu76/exam` | ANNOTATIONS 原文 *"The job was not started because recent account payments have failed or your spending limit needs to be increased…"* |
| `gh pr checks 928 --repo jnhu76/exam` | `Static checks fail 2s` + 6 required `skipping` + `CodeRabbit skipping`；`PR_CHECKS_EXIT=1`（与 ask 给定输出一致） |

**CI Static checks 的实际命令（本会话实读 `.github/workflows/ci.yml:33-92`）**：该 job 的两个步骤是 `run: pnpm verify:static`（:87）与 `run: pnpm docs:build`（:92）。在 exact 树 `0c7350af…` 上本地实跑这两条**完整**命令：

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `pnpm verify:static` | **`0`** | 展开为 `pnpm format:check && pnpm lint && pnpm lint:arch && pnpm lint:db-config && pnpm lint:db-journal && pnpm lint:env-contract && pnpm lint:env-surface && pnpm lint:eslint && pnpm typecheck && pnpm --filter @exam/api api:openapi:check`（日志首行实证）；`All matched files use Prettier code style!`、`Architecture checks passed.`、`Tasks: 17 successful, 17 total`（typecheck）、`openapi.json is up to date.` |
| `pnpm docs:build` | **`0`** | check-site.mjs 10 项全 PASS → `All documentation checks passed.` |

⇒ **CI Static checks 作用域内不存在任何文档 / 链接 / 生成物缺陷**：两条 CI 命令在本地对同一棵树全部 exit 0。CI 侧的 FAIL 完全由外部 GitHub 账户计费引起（`Static checks` job 根本未启动、无 runner、1–2s 失败、日志 404），6 个 required job 因依赖 `skipped`。按本 ask 允许范围（只修文档/链接/生成物/CI 可解释的文档问题），**没有可修的产品性文档缺陷**：本次仅补记该收敛结论、把两条完整 CI 命令的本地 exit 0 证据写入交付记录，并重新生成 `SHA256SUMS`；**零产品代码、零测试改动、零测试放宽**。

**收敛结论（时间无关，不再逐次枚举 run ID）**：每次非 force push 都会在同一外部计费条件下触发一个新的 FAIL run（attempt 1 → `42608435613`，attempt 2 → `42609620433`，后续同理），§7 的「所有已完成 run 全 FAIL、0 green run / 0 success job」不变量已覆盖全部此类 run；继续为每一个新 run ID 追加文档提交会形成无限循环，且不能产生绿 CI，**不属本 ask 的可修范围，不再执行**。解除条件是外部账户计费恢复（Issue #930 OPEN）后，在 clean tree 的 exact SHA 上重跑完整 CI、取得 7 个 required job 全 success，并按 SPEC §7.2 产生新 SHA 与独立复审；这不是任何代码 / 文档改动能替代的。

verdict 仍 **BLOCKED**；4× KEEP_AND_MERGE 不变；`FULL_CI = FAIL`、`POST_MERGE_SMOKE = NOT_RUN`、`MERGE_STATUS = BLOCKED`、`RELEASE_STATUS = NOT_RELEASED`；**未合并、未发布**。

### 9.1 并发裁决覆写（本 ask 期间，如实记录）

attempt 2 执行期间检测到未跟踪的并发裁决进程**整篇覆写** `FINAL_PRODUCT_ADJUDICATION.md`（mtime 2026-11-09 19:37，21811 B，174 行），版本标题由「本轮 · 基于四份 §7 独立评审」变为「**第 2 轮 · 修复后独立复审裁决**」。本会话已完整实读该版本（174 行）并逐项核对：

- **裁决字段一致**：verdict `BLOCKED`、4× `KEEP_AND_MERGE`、12 契约字段 11 PASS + `SAVEANSWER_RECEIPT_SEMANTICS = UNCHANGED`、required CI FAIL（外部计费 #930 OPEN）、`未合并 / 未发布`、不执行 merge / commit / push —— 与 18:46「第 3 轮」、18:57「基于四份 §7 独立评审」两版在全部裁决字段上一致；差异仅在 blocker 2 口径（见下）与证据台账。按任务「以最新裁决为准」，本次提交把 19:37 版作为权威裁决纳入受控历史。
- **口径差异（不静默改写）**：19:37 版把 blocker 2 定义为「flake/occurrence **登记面**」并判为**已闭合**（`test-flakes.md` 三条补登已落地、#878 仍 OPEN/DEFER、green-CI 前置与 blocker 1 耦合）；本文件 §1 / §4 沿用第 1 轮口径，把 blocker 2（含 #878 Acceptance 或 post-fix 权威绿灯前置）列为与 blocker 1 耦合未闭合。两版对**唯一决定性 blocker 1 未解、verdict BLOCKED、未合并 / 未发布**完全一致；此处仅记录差异，不伪造任一方的结论。
- **悬空引用修复（本 ask 的文档/链接问题）**：19:37 版整篇重写移除了前版的「附录 D — 交付文档编辑附记」，使 `DOCUMENTATION_CONSISTENCY_AUDIT.md` §3/§7 与本文件 §3/§8 共 4 处跨文件引用失效。本次已把这 4 处引用改指向本文件 §7–§9，并在此记录版本演进；`SHA256SUMS` 按最终落盘字节重新生成（生成前 `sha256sum -c` 曾因该覆写报 `FINAL_PRODUCT_ADJUDICATION.md: FAILED`，如实记录）。
- 本角色**未改写裁决正文**，也未提交任何未经实读的内容；裁决文件的逐字节状态由 `SHA256SUMS` 钉住。

— 交付文档编辑，2026-11-09，attempt 2

---

## 10. 第 3 轮收口 — 绿 CI 与 READY_FOR_HUMAN_MERGE（本 ask，2026-11-09）

**ask 给定材料**：exact 集成 SHA `52a58d4da7ec51423381510d5e19bff6425965b7`、四份 §7 独立评审、第 3 轮裁决
（`FINAL_PRODUCT_ADJUDICATION.md`，verdict **READY_FOR_HUMAN_MERGE**）、修复记录（零代码提交；`52a58d4d` 由并发进程
提交并 push）与 CI FAIL (exit 1)（即 `reviews/REVIEW_RERUN_2.md` 直读的 run 42611431690 **attempt 1** 计费失败）。

### 10.1 绿 CI 独立复核（本会话实跑，未沿用裁决结论）

| 命令 | 输出 |
| --- | --- |
| `gh api repos/jnhu76/exam/actions/runs/42611431690` | `{"id":42611431690,"head_sha":"52a58d4da7ec5142…","status":"completed","conclusion":"success","run_attempt":2,"run_started_at":"2026-11-09T11:59:40Z","updated_at":"2026-11-09T12:07:30Z","event":"pull_request","head_branch":"integration/production-closure-20261109"}` |
| `gh api …/runs/42611431690/jobs?per_page=100` | 8 job 全 `success`：`Static checks / Build / API coverage / Web coverage / Package coverage / Production transport regression / E2E (shard 1/2) / E2E (shard 2/2)` |
| `gh pr checks 928 --repo jnhu76/exam` | 8 项 `pass`（Static checks 1m28s / Build 50s / API coverage 5m25s / Web coverage 4m34s / Package coverage 2m11s / Production transport 2m45s / E2E 3m35s+3m28s）+ `CodeRabbit skipping`；`PR_CHECKS_EXIT=0` |
| `gh pr view 928` | `state=OPEN, isDraft=true, mergeStateStatus=CLEAN, mergedAt=null, headRefOid=52a58d4d…, baseRefName=master` |
| `gh pr view 922/923/924/926` | 四源 PR 全 `state=OPEN, draft=true, mergedAt=null` |
| `gh issue view 878` / `gh issue view 930` | 均 `OPEN`；#930 12:09:48Z 新评论记录 #929 头 `4162bfde` 上 run 42607359553 attempt 2 同样取得 success（外部计费恢复的另一佐证），Issue 本身仍 OPEN（卫生项） |
| `git rev-parse HEAD` / `git merge-base --is-ancestor 52a58d4d master` | HEAD = `52a58d4d…`；exit 1（集成树未并入 master `5140c3dd`） |

判定与裁决一致：SPEC §8.1.7 required CI 门禁在 exact SHA `52a58d4d` 上已满足（attempt 2 为同一 SHA 的标准 re-run，
非 force push、非 skip/放宽；attempt 1 与全部历史 FAIL run 保留未删）。**merge 未执行**（人工门禁），
`RELEASE_STATUS = NOT_RELEASED` 维持，§1 严格格式报告已按本节值更新。

### 10.2 交付面更新（本 ask 实际改动）

1. **`reviews/` 快照更新**：按 ask 把 `.tmp/production-closure/reviews/` 七份评审复制入库。`REVIEW_SECURITY / PROTOCOL /
   CI_FLAKE / ARCHITECTURE_DOCS / FIXTURES_FLAKE` 五份与已提交副本逐字节一致（`cmp -s` OK）；`REVIEW_RERUN_1.md`（改审
   `b6be2591`，verdict BLOCKED）与 `REVIEW_RERUN_2.md`（改审 `52a58d4d` attempt 1，verdict NO_GO）为复审员的同名新版，
   覆盖前确认旧版（审 `a5df2c90`）已在受控 Git 历史中无损保留（`git show 52a58d4d:<path>` 可恢复），新版各自头部含
   覆写说明。此前 §8 附注「不从 scratch 复制」的保守立场由本 ask 的显式指令取代：复制对象经 `cmp`/verdict 逐项核对，
   与第 2/3 轮裁决引用的复审版本一致。
2. **时态语句改写（裁决 §2.4 处置的落地）**：本文件 §1 严格格式报告与头部改为引用绿 run（本节值）；§0/§2 加时点指针。
   `docs/standards/test-flakes.md` 两处「无 post-fix 权威绿灯（GitHub 账户计费）」（`:3378`、`:3388-3389`）改为引用
   run 42611431690 attempt 2，同时保持 #878 OPEN / DEFER、`HYPOTHESIS`、「绿 run ≠ 根因消除」与「登记不表述为已修复」。
   其余 8 份长期文档核查无漂移（`DOCUMENTATION_CONSISTENCY_AUDIT.md` §8）。
3. **CHANGELOG / README / implementation-status 不更新**：`## [Unreleased]` 仍为空，无发布事实；收口仍属 SPEC §8.4
   最终 master merge 条件。**不声称已发布。**
4. `SHA256SUMS` 按最终落盘字节重新生成（`DOCUMENTATION_CONSISTENCY_AUDIT.md` §8 记录命令与校验）。

### 10.3 本会话实跑的静态 / 文档检查

| 命令（集成 worktree 内实跑） | 退出码 | 结果 |
| --- | --- | --- |
| `pnpm format:check` | **`0`** | `All matched files use Prettier code style!`（`.prettierignore` 含 `*.md`，不校验 Markdown） |
| `pnpm docs:build` | **`0`** | check-site.mjs 10 项全 PASS：allowlist 8/8、16 页哈希、16 路由、中英路由对应、380 内部链接与片段、16 路由可达、130 permalinks、404、search index en/zh 各 50 documents → `All documentation checks passed.` |
| `sha256sum -c SHA256SUMS`（本目录，最终生成后） | **`0`** | 全部条目 `OK`、`0 FAILED` |
| `git diff --check` | **`0`** | 无空白 / 冲突标记 |

> 执行环境说明：`format:check` 必须在本集成 worktree 内运行。主 checkout `/home/hoo/Source/exam` 的同名命令在本 ask 期间
> exit 2，原因是该树内存在与本分支无关的外来未跟踪产物（`.worktrees/*` 构建产物、`test-results/.last-run.json`）被
> prettier 扫描；集成 worktree 不含这些路径，命令干净通过。本 ask 未清理、未修改他树文件。

### 10.4 交付提交自身的 CI（如实声明）

本节所在交付提交是 `52a58d4d` 之上的**纯 docs 提交**（`git diff 52a58d4d..HEAD --name-only` 全部位于
`docs/`；push 后 `FinalResult.finalSha` = PR #928 新 `headRefOid`）。提交不能自含其 SHA，故本文件不内嵌该值；
push 后每个新 commit 都会触发一个新 CI run，其结局（含可能的 transient billing 复发）不在本文件内预支、
由 GitHub run 历史承载。绿 CI 证据锚定在 exact SHA `52a58d4d`；四 PR 合并的人类门禁按裁决 §5（#922 → #923 →
#924 → #926 逐个 ready + merge，#928 不直接合并）执行。

— 交付文档编辑，2026-11-09，第 3 轮收口（绿 CI 后）
