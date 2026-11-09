# FINAL_INTEGRATION_RECORD — 最终集成记录

- 状态：**最终交付文档**（SPEC §9 交付物 10 / §10 最终报告格式）。本文件是本次交付的记录与导航，不修改产品代码。
- 任务给定 exact 集成 SHA：`a5df2c90ace6366e69c951e6660dc268327b6e8a`。**本文件所在的交付提交是该 SHA 之上的纯文档提交**（见 §0 SHA 口径说明）。
- 裁决权威：`FINAL_PRODUCT_ADJUDICATION.md`（verdict **BLOCKED**，决定性理由 = required CI FAIL 外部 GitHub 计费；4× KEEP_AND_MERGE；产品契约 PASS / receipt UNCHANGED）。
- 证据纪律：`git` / `gh` 查询与代码锚点为本会话实跑/实读；测试与本地门禁数字来自给定材料（四份评审、两版裁决、`pr-body.md`、`.tmp/production-closure/logs/`），本会话未复跑；静态/文档检查的实跑命令与退出码见 `DOCUMENTATION_CONSISTENCY_AUDIT.md` §6 / `PERFORMANCE_AND_CI.md` §4。

---

## 0. SHA 口径说明（避免混淆）

| 名称 | 值 | 角色 |
| --- | --- | --- |
| `BASE_MASTER_SHA` / `FINAL_MASTER_SHA` | `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d` | master 基线，本会话 `git rev-parse master` 实查；**未发生合并**，故前后相同 |
| `EXACT_ADJUDICATED_SHA` | `a5df2c90ace6366e69c951e6660dc268327b6e8a` | 任务给定的 exact 集成 SHA；四份评审与两版裁决所审的代码/契约树；tree `736a38f6e37f8434a87a27594701c95096152f53`；CI FAIL 附着于此 |
| 四 PR 合并完成点 | `0b2e2d8a1653ebba59326517ec2fdc6b4c7cf4bc` | `a5df2c90` 的父提交；最新裁决以此作为「四 PR 合并完成点」。两 SHA 的产品代码逐字节一致（唯一差异 = 2 个 `.md` 文档提交） |
| `FINAL_DELIVERY_SHA` | **本提交（当前分支 HEAD）** | 在 `a5df2c90` 之上追加 §9 交付文档、reviews 副本、SHA256SUMS 与长期文档更新的**纯文档提交**；其值 = `git rev-parse HEAD` = PR #928 `headRefOid` = `FinalResult.finalSha` |

> 一个 Git 提交不能包含自身的 SHA，故本文件不内嵌 `FINAL_DELIVERY_SHA` 字面值；权威值是集成分支 ref、GitHub PR #928 的 `headRefOid` 与工作流结果 `FinalResult.finalSha`。本交付提交产品代码零改动 ⇒ 上述评审 / 裁决针对 `a5df2c90` 代码内容的结论对新 HEAD 的代码事实仍逐字节成立；但**新 HEAD 本身未重新取得 required CI 绿灯**，`gh pr checks 928` 在交付时点仍为 FAIL (exit 1)。

合并序列（`pr-body.md` 给定材料，与 `git log --oneline` 一致）：`0b1902d0` (#922) → `4919e534` (#923) → `9bba9fbf` (#924) → `0b2e2d8a` (#926)，无冲突；集成修复 `9dd1d5f4`（#924 夹具）、`ca7e62ec`（#923 E2E 夹具）、`1f29b614`（#923 几何 flake 部分修复）均为祖先。四个源 PR 当前 head（本会话 `gh pr view` 实查）：#922 `d545983f…`、#923 `1f29b614…`、#924 `9dd1d5f4…`、#926 `1dd4d206…`。

---

## 1. SPEC §10 最终报告（严格格式）

```text
BEGIN_EXAM_PRODUCTION_INTEGRATION_CLOSURE

BASE_MASTER_SHA = 5140c3dd0f9dbde1bdad8f5b757161f3ed96945d
FINAL_MASTER_SHA = 5140c3dd0f9dbde1bdad8f5b757161f3ed96945d
FINAL_INTEGRATION_SHA = a5df2c90ace6366e69c951e6660dc268327b6e8a

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
FLAKE_ISSUES_CREATED_OR_UPDATED = #878 (OPEN, 4 unchecked Acceptance; registry updated) / #930 (OPEN, GitHub billing)
REQUIRED_CI_FAILURES = 2 (runs 42572487639 / 42593850473: Static checks fail, 6 required jobs skipped, billing annotation; gh pr checks 928 = FAIL exit 1; 0 green runs)

GLOBAL_PRODUCT_CONSISTENCY = PASS
DOCUMENTATION_CONSISTENCY = PASS
PERFORMANCE = PASS

CLEAN_TREE_INTEGRATION = PASS
FULL_CI = FAIL
POST_MERGE_SMOKE = NOT_RUN

SECURITY_SUBAGENT = PASS
PROTOCOL_SUBAGENT = PASS
CI_SUBAGENT = BLOCKED
ARCHITECTURE_SUBAGENT = PASS

PR_922 = OPEN / draft / KEEP_AND_MERGE / not merged
PR_923 = OPEN / draft / KEEP_AND_MERGE / not merged
PR_924 = OPEN / draft / KEEP_AND_MERGE / not merged
PR_926 = OPEN / draft / KEEP_AND_MERGE / not merged

GITHUB_WRITEBACK = delivery docs committed + pushed to PR #928 branch; headRefOid == new HEAD; no Issue/PR body writeback in this ask
MERGE_STATUS = BLOCKED
RELEASE_STATUS = NOT_RELEASED

UNRESOLVED_BLOCKERS = blocker 1 (clean-tree exact-SHA required CI FAIL, external GitHub billing #930); blocker 2 (#878 flake/occurrence closure needs #878 Acceptance OR post-fix authoritative green CI, coupled with blocker 1)
ACCEPTED_RESIDUAL_RISKS = nginx error_log raw request line (Owner Decision A, bounded); #878 deferred geometry flake; #922 archive sanitization before sharing; OpenAPI 401/403 top-level requestId (pre-existing master drift, 203 occurrences); getWithMeta zero production callers; 429 status path NOT_TESTED; transport-boundary header fault injection not run; multi-instance log correlation NOT_VERIFIED; third-party log collector / INFRA_LOG_ACCESS NOT_VERIFIED; BACKUP_RETENTION UNKNOWN

END_EXAM_PRODUCTION_INTEGRATION_CLOSURE
```

> `FINAL_INTEGRATION_SHA` 在此严格格式块中指被审的 exact 集成树（`a5df2c90`，见 §0）；含交付文档的当前分支 HEAD 为 `FinalResult.finalSha`。`CLEAN_TREE_INTEGRATION = PASS` 指本交付提交后受控树干净（此前唯一未跟踪的裁决文档现已纳入受控历史）。`PERFORMANCE = PASS` 指既有 A/B 证据与四个评审未观察到回归，**不是** exact-SHA CI 门控下的新基准测量（required CI 仍 FAIL）。

---

## 2. 未合并 / 未发布的事实（本会话实查）

| 项 | 值 | 命令 |
| --- | --- | --- |
| 集成分支 | `integration/production-closure-20261109` | `git branch --show-current` |
| PR #928 | `state=OPEN, isDraft=true, mergeStateStatus=UNSTABLE, mergedAt=null, headRefOid=a5df2c90…, baseRefName=master` | `gh pr view 928 --json …` |
| 四个源 PR | #922/#923/#924/#926 全 `state=OPEN, isDraft=true, mergedAt=null` | `gh pr view 922/923/924/926 --json …` |
| #878 / #930 | 均 `state=OPEN` | `gh issue view 878` / `gh issue view 930` |
| master | `5140c3dd…`，集成树非其祖先 | `git rev-parse master`；`git merge-base --is-ancestor a5df2c90 master` → exit 1 |
| CI | `gh pr checks 928` → `PR_CHECKS_EXIT=1`；head_sha 唯一 run `42593850473` `conclusion=failure`；success-run 计数 `0` | `gh pr checks` / `gh api …/actions/runs?head_sha=…` |

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
| 15 | `FINAL_PRODUCT_ADJUDICATION.md` | 以最新裁决为准 + 附录 D 编辑附记 |
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

## 7. 推送后状态补记（本会话实查）

非 force 快进 push（`a5df2c90..e97e15fb`，`PUSH_EXIT=0`）后重新查询：

- PR #928 `headRefOid = e97e15fb604f33e5fc8e99c8c547004f9b05149d` = 本地 `git rev-parse HEAD` = 远端分支 ref（`gh api .../git/ref/heads/integration/production-closure-20261109`）；`state=OPEN, isDraft=true, mergedAt=null, baseRefName=master`。`git status --short` 为空（clean tree）。
- 新 HEAD 的 `gh api "repos/jnhu76/exam/actions/runs?head_sha=e97e15fb…&per_page=100"` → `total_count=0`（尚无 CI run）；`gh pr checks 928` 在本时点仅返回 `CodeRabbit skipping`、`PR_CHECKS_EXIT=0`。**这不是绿 CI**：7 个 required job 在新 HEAD 上零执行 / 零 success；`mergeStateStatus=CLEAN` 仅表示当前无挂起或失败的 check，不构成 required CI 通过证据。本交付提交后 required CI 仍未被触发完成。
- 被审 exact SHA 的 FAIL 记录仍在：分支 run 列表 `total_count=2`，`42593850473`(a5df2c90) 与 `42572487639`(0b2e2d8a) 均 `conclusion=failure`；全 SHA 范围 0 green run。外部 GitHub 账户计费故障（#930 OPEN）未解除，代码/文档改动不能修复。
- 因此 §1 的 `FULL_CI = FAIL` / `MERGE_STATUS = BLOCKED` / `RELEASE_STATUS = NOT_RELEASED` 与「未合并、未发布」结论**不变**。§1 / §2 中 `gh pr checks 928 → EXIT=1` 是**推送前**在 `a5df2c90` head 上本会话实跑的记录，作为该 SHA 的 CI 事实保留，不冒充新 HEAD 的当前检查状态。

> 最终 `FinalResult.finalSha` = 本分支最终 HEAD（含本补记提交）= PR #928 `headRefOid`；提交不能自含其 SHA，故以 Git ref / GitHub headRefOid 为权威。
