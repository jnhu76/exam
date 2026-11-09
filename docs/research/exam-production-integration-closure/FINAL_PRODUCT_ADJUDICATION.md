# FINAL_PRODUCT_ADJUDICATION — 最终产品裁决（第 3 轮 · 绿 CI 后独立裁决）

> 本文件现为**第 3 轮裁决**（2026-11-09），由独立裁决员基于第 2 轮裁决（BLOCKED，1 blocker）、
> 独立复审 [`REVIEW_RERUN_2.md`](reviews/REVIEW_RERUN_2.md)（verdict NO_GO，blocker 1 未解）、
> 修复记录（本轮零提交：分支现行 HEAD 与 draft PR #928 headRefOid 一致，均为 `52a58d4d`；
> 全部 FAIL 记录保留）与 SPEC §7/§8 独立作出。**未沿用上一轮结论而不验证**：本会话对 HEAD/PR/CI/
> 登记面/12 契约字段全部以 `git` / `gh api` / 文件实读独立重查。
>
> **verdict = READY_FOR_HUMAN_MERGE**。第 2 轮唯一剩余 blocker（required CI）**已在本会话实测解除**：
> ask 指定 exact SHA `52a58d4da7ec51423381510d5e19bff6425965b7` 上，run **42611431690 attempt 2**
> 于 12:08:12Z 完成，conclusion = **success**，8 个 job（Static checks / Build / API coverage /
> Web coverage / Package coverage / Production transport regression / E2E shard 1/2 / E2E shard 2/2）
> **全部 success**，`gh pr checks 928` **exit=0**（全部命令与输出见 §2.1，本会话实跑）。
> 这是外部 GitHub 计费恢复后的真实重跑（`run_attempt=2`，非 force push、非新 SHA、非 skip/放宽），
> attempt 1 的失败与此前全部 FAIL run 均保留未删（§2.3）。第 2 轮写回的解除条件——
> 「#930 计费恢复后，在最终 exact SHA 的 clean tree 重跑完整 CI（7 个 required job 全 success）；
> 保留全部 FAIL 记录」——已逐项满足。**未执行 merge / commit / push**；merge 属人工门禁，
> READY_FOR_HUMAN_MERGE 仅表示进入人工合并门禁（SPEC §8.2 顺序与门禁清单见 §6）。
>
> 产品代码面：`0b2e2d8a`（四 PR 合并完成点）→ `52a58d4d` **零非 docs 文件**（本会话 `git diff` 实证），
> 第 1 轮在逐字节相同代码上的测试证据继续有效；12 契约字段 = 11 PASS + receipt UNCHANGED，
> 权威代码点逐点抽查命中（§3）。blocker 2（flake/occurrence 登记面）维持闭合（§2.2 本会话实读复验）。

---

## 0. 被审对象与元信息（本会话实查）

| 项 | 值 | 证据 |
| --- | --- | --- |
| ask 指定 exact SHA | `52a58d4da7ec51423381510d5e19bff6425965b7` | `git -C $W rev-parse HEAD` → 逐字一致 |
| worktree HEAD | 同上；`git status --short` 空（clean） | 本会话实跑 |
| 分支 / PR #928 | `integration/production-closure-20261109`；`headRefOid = 52a58d4d`、OPEN、Draft（绿 CI 后仍未改 draft 状态，由人工门禁处理） | `gh pr view 928 --json headRefOid,state,isDraft`（会话首末各查一次，无漂移） |
| 绿 CI | run **42611431690 attempt 2**，`head_sha=52a58d4d`，`run_started_at=2026-11-09T11:59:40Z`，`updated_at=12:07:30Z`，conclusion=**success** | `gh api repos/jnhu76/exam/actions/runs/42611431690`（本会话轮询至完成） |
| 历史 FAIL run | 42607587186（e97e15fb）/ 42607941019（b6be2591）/ 42608435613（f32693c7）/ 42609620433 attempt 2（0c7350af）/ 42611431690 attempt 1（52a58d4d，REVIEW_RERUN_2 直读）——**全部保留** | `gh api repos/jnhu76/exam/actions/runs/<id>` ×4 本会话实查均 `failure` |
| 四个源 PR | #922 / #923 / #924 / #926 全部 OPEN + Draft + `mergedAt=null` | `gh pr view 922/923/924/926 --json state,isDraft,mergedAt` |
| master | `5140c3dd`，集成树未合并 | `git -C /home/hoo/Source/exam rev-parse HEAD` |
| 受控树状态 | 更新本文件前 clean；本文件更新为受控跟踪文件的未提交修改，属本 ask 指定产物，未 commit | `git status --short` |
| 模式 | 调查/评审；除本 ask 指定文档外未改任何受控文件，未 commit/push/merge/CI 触发（CI attempt 2 为并发恢复进程在 11:59:40Z 已启动的重跑，本会话仅观察取证） | — |

---

## 1. 输入材料（ask 给定 + 本会话实读）

- **ask 给定**：第 2 轮 `FINAL_PRODUCT_ADJUDICATION.md`（本文件上一版）、`REVIEW_RERUN_2.md`（NO_GO）、
  修复记录（本会话零提交、零 push；HEAD=PR head=52a58d4d，并发进程提交；全部 FAIL 记录保留；根因为 GitHub 计费）、
  CI FAIL (exit 1)（即 REVIEW_RERUN_2 记录的 attempt 1 状态）、`SPEC.md` §7（§7.1/§7.2）、§8（§8.1–8.4）。
- **本会话补充实查**：`docs/standards/test-flakes.md` `:3354/:3368/:3370–3378`；`apps/api/src/server.ts:117/119`、
  `apps/api/src/plugins/requestIdHeader.ts:24–38`、`apps/api/src/lib/proctorMonitoringService.ts:211/231`、
  `packages/contracts/src/common.ts:83`、`apps/web/src/pages/exam/TakeExamPage.tsx:893–935`、
  `apps/api/src/routes/clientEvents.ts:118`、`deploy/nginx/web.conf:49/65`；
  `git diff 0b2e2d8a..52a58d4d | grep -v '^docs/'`、`git diff 8061d547..52a58d4d`（receipt 三文件）、
  `sha256sum -c SHA256SUMS`、`FINAL_INTEGRATION_RECORD.md` FULL_CI/MERGE_STATUS 实读。
- **gh api / gh 实查**：run 42611431690（attempt 2 全程轮询 + jobs 逐 job）、runs 42607587186/42607941019/42608435613/42609620433、
  `gh pr checks 928`（attempt 1 期间 exit=1 → attempt 2 完成后 exit=0）、PR 922/923/924/926/928、Issue #930、#878。

---

## 2. Blocker 独立复核（不沿用上一轮结论）

### 2.1 Blocker 1 — required CI 全绿：**本会话实测解除**

时序证据（全部本会话实跑）：

1. 会话初查：`gh api 'repos/jnhu76/exam/actions/runs?head_sha=52a58d4da7ec51423381510d5e19bff6425965b7'`
   → `total_count=1`，run 42611431690 **attempt 2、in_progress**（11:59:40Z 启动；attempt 1 为 REVIEW_RERUN_2
   直读的计费 failure）——外部计费已恢复，并发恢复进程在 exact SHA 上触发了重跑。
2. 初查时 `gh pr checks 928` → `Static checks pass`、`Build pending`、其余 skipping，**exit=8**（进行中）。
3. 逐 job 轮询（12:05–12:08）：`Static checks=success`（1m28s）、`Build=success`（50s）、
   `API coverage=success`（5m25s）、`Web coverage=success`（4m34s）、`Package coverage=success`（2m11s）、
   `Production transport regression=success`（2m45s）、`E2E (shard 1/2)=success`（3m35s）、
   `E2E (shard 2/2)=success`（3m28s）。
4. 完成取证：`gh api repos/jnhu76/exam/actions/runs/42611431690` →
   `{head_sha:"52a58d4da7ec5142…", status:"completed", conclusion:"success", run_attempt:2, updated_at:"2026-11-09T12:07:30Z"}`。
5. 终态 `gh pr checks 928` → **8 项 pass、仅 CodeRabbit skipping，exit=0**。
6. 无新提交进入集成线：PR #928 headRefOid 复查仍为 `52a58d4d`；master 仍 `5140c3dd`。

判定：SPEC §8.1.7「最终集成树通过 required CI」与 §7.2 的 BLOCKED 前置（required CI 失败）
在 ask 指定 exact SHA 上**已不再成立**。该绿 run 为同一 SHA 上 attempt 1 失败后的标准 GitHub re-run：
无新 SHA、无 force push、无 skip/only/timeout 放宽/隐藏失败——7 个 required job 全部真实执行并 success
（时长 50s–5m25s 可复核）。第 2 轮写回的解除条件逐项满足：✅ exact SHA、✅ clean tree（worktree 与 CI 检出均 clean）、
✅ 7 required job 全 success、✅ FAIL 记录保留（§2.3）、✅ 解除后由独立裁决（本文件）按 §7.2 增量复审。
计费根因事实恢复：attempt 2 的 Static checks 真实执行 1m28s 并 success（attempt 1 为 3 秒计费失败签名）。
#930 仍 OPEN（`closedAt=null`，`updatedAt` 停留在 11:16:40Z——早于恢复时刻），属 Issue 卫生项，见 §6。

### 2.2 Blocker 2 — flake/occurrence 登记面：**维持闭合（本会话实读复验）**

第 2 轮已闭合，本会话在 `52a58d4d` 上逐项重验（第 1 轮 blocker 2、REVIEW_RERUN_2 §4 同口径）：

- `test-flakes.md:3368`：run 42483066387 登记为同签名 occurrence（`:568` raw log 三重复核）；
- `:3370–3374`：新签名小节在场——`:555 toBeFocused`（`Received: inactive`，timeout 5000ms，与 `:568` 同根因未证明）；
- `:3375–3376`：A3-F7 `investigation-ui-acceptance.spec.ts:341` 独立 occurrence（2×`1 failed / 9 passed`、
  pr-865 控制实验 EXIT=0、条件敏感归属）；F-04 低优先观察（未复现，不定级）；
- `:3354`：`CASE_ID = NONE`（不强行归并）；`:3378`：结尾声明 #878 仍 OPEN / DEFER、
  `ROOT_CAUSE_CONFIDENCE = HYPOTHESIS`、登记不替代 #878 验收、不表述为已修复。
- `gh issue view 878` → **OPEN**（本会话实查）。
- 夹具残渣：`grep -rn 'req-forged-prt-0001\|req-cross-org-' apps packages` → **exit=1，零命中**。

SPEC §3.6「Flake 与合并的关系」条件现已满足：相关 flake 登记为有证据独立遗留问题（#878 / OBS-2026-11-03-001）、
已被论证与本轮变更无关（受害文件在四 PR 分支零改动 + 控制实验），且**新的完整权威 CI 门禁最终通过**
（§2.1）——合并门禁不受影响，继续产品合并评估。#878 的 Acceptance 收口（含 ledger 中
「无 post-fix 完整权威绿灯」语句的过时化，见 §2.4）与 4 处固定 150ms 残留为后续工作，非合并 blocker。

### 2.3 FAIL 记录保留与诚实性

- 本会话逐一查询：42607587186（head `e97e15fb`）/ 42607941019（`b6be2591`）/ 42608435613（`f32693c7`）/
  42609620433（`0c7350af`，attempt 2）均 `conclusion=failure`，未删除；42611431690 本身即含 attempt 1
  失败史（GitHub re-run 语义保留 attempt 记录；REVIEW_RERUN_2 §1 直读其 failure 与计费注释）。
  **无历史 FAIL 记录被清除或改写。**
- `FINAL_INTEGRATION_RECORD.md` 实读：`:59 FULL_CI = FAIL`、`:73 MERGE_STATUS = BLOCKED`、
  `:145/:158/:193/:225` 重申不声称 CI 通过/未合并/未发布。这些语句书写于绿 run 之前，作为该时点事实保留；
  其「当前状态」语义已过时（见 §2.4），不构成虚假绿灯（方向是低估而非虚报）。
- `sha256sum -c SHA256SUMS`（`docs/research/exam-production-integration-closure/` 下实跑）→ 全部 OK，exit=0。

### 2.4 回归 / 削弱 / 双轨检查与 ledger 时态说明

- `git diff --name-only 0b2e2d8a..52a58d4d | grep -v '^docs/'` → **exit=1，零命中**：四 PR 合并完成点以来
  全部为 docs（含本文件与登记面），生产代码、测试断言、授权边界、保存协议零改动；第 1/2 轮全部
  代码级证据对 `52a58d4d` 逐字节有效。
- `0c7350af..52a58d4d` delta = 4 个 docs/证据文件（与 REVIEW_RERUN_2 §4 一致），零代码。
- SaveAnswer receipt 契约面：`git diff --quiet 8061d547..52a58d4d -- packages/contracts/src/attempt.ts
  packages/exam-engine/src/answerProtocol.ts apps/api/src/routes/attempts.candidate.ts` → exit=0（空 diff），
  receipt 语义 **UNCHANGED**。
- **ledger 时态残余**（非 blocker）：绿 CI（42611431690 attempt 2）发生后，分支内
  `FINAL_INTEGRATION_RECORD.md` 的 `FULL_CI = FAIL`/`MERGE_STATUS = BLOCKED`（§2.3）与
  `test-flakes.md:3378`「无 post-fix 完整权威绿灯」已相对当前事实过时。这些语句在书写时点为真、
  方向为低估；若以新 docs 提交更新它们将产生新 SHA 并要求新 CI。处置：随 SPEC §8.4 收口（四 PR
  按 §8.2 逐个并入 master 后的文档同步）一并改写为引用本绿 run，不为此单开新集成提交、不阻塞合并门禁。

### 2.5 本会话未运行项（SKIPPED，不冒充已跑）

本会话**未**重跑第 1 轮的 307 个定向测试、浏览器级 M3/M4/M5、`pnpm verify` / 全量 `pnpm test` / 本地 E2E。
理由与第 2 轮相同且更强：`0b2e2d8a..52a58d4d` 零非 docs 文件（§2.4），且 required CI——本 gate 的权威信号——
已在 exact SHA 上完整绿（§2.1，覆盖 Static checks / Build / 3 coverage lanes / Production transport /
2 E2E shards）。SPEC §6.1 的「完整执行真实 CI」由该 run 承载；本地重跑不构成增量证据。

---

## 3. 全局一致性裁决（12 契约字段，最终值）

> 每行标注：本会话在 `52a58d4d` 上的权威代码点抽查（实读行号）+ 第 1 轮在逐字节相同代码上的实跑证据
> （307 定向测试 / 84 PG tests / 浏览器级 M3/M4/M5，第 1 轮文件 §3.1–3.2 留档）+ 本会话 exact SHA 绿 CI。

| # | 契约字段 | 最终值 | 本会话抽查点（52a58d4d 实读） | 第 1 轮实跑证据 + 绿 CI |
| --- | --- | --- | --- | --- |
| 1 | uuidGlobalContract | **PASS** | 夹具残渣 grep → exit=1 零命中（§2.2）；SHA256SUMS 归档自洽 | 318/318 归档校验；绿 CI 全套通过 |
| 2 | uuidTestFixtures | **PASS** | 同上 grep 零命中 | 形状门控负例 21/21；crossOrg 404/防枚举/零计数 |
| 3 | serverIdAuthority | **PASS** | `server.ts:117` `genReqId: () => randomUUID()`、`:119` `requestIdHeader: false` | `server.requestId.test.ts` 2/2；绿 CI |
| 4 | clientClaimIsolation | **PASS** | `proctorMonitoringService.ts:211/231` `REQUEST_ID_UUID_SHAPE` 门控；`TakeExamPage.tsx:893–898` 仅 postWithMeta 元数据 | crossOrg + 21/21；绿 CI |
| 5 | requestIdCorrelation | **PASS** | `requestIdHeader.ts:24–38` 仅盖 `request.id` 章、root-scope 无第二 mint；`common.ts:83` `requestId` 嵌套 error 内 | wire 7/7 + status matrix；绿 CI |
| 6 | saveAnswerEndToEnd | **PASS** | `TakeExamPage.tsx:898` `postWithMeta` 单一消费点、`:915/:935` 成功分支只认 `accepted` | 引擎 55/55 + PG 53/53 + 浏览器级 M4/M5；绿 CI |
| 7 | saveAnswerConcurrency | **PASS** | `8061d547..52a58d4d` 引擎/路由零改动（§2.4） | deadline 权威、幂等回放零写入、PG 并发 53/53；绿 CI |
| 8 | saveAnswerReceiptSemantics | **UNCHANGED** | receipt 三文件 `git diff --quiet` → exit=0 空 diff（§2.4） | 与第 1/2 轮判定一致 |
| 9 | routePrivacy | **PASS** | `clientEvents.ts:118` `route: projectClientEventRoute(event.route)` | 封闭集 + fuzz 60/60 + drift guard 4/4；绿 CI |
| 10 | legacyRouteReadPrivacy | **PASS** | 读侧再投影方向 fail-deny（`normalizeRouteForStorage` 已删，第 1 轮 diff 证据） | 读侧再投影测试 60/60 双边界；绿 CI |
| 11 | nginxAccessPrivacy | **PASS** | `web.conf:49` `log_format exam_privacy` 固定 `$exam_route`、无 `$request`/`$request_uri`/Referer/Cookie | `nginxWebConf.test.ts` 7/7；绿 CI |
| 12 | nginxErrorDiagnostics | **PASS** | `web.conf:65` `error_log … error` + `:33` Decision A 注释 | 同上 7/7；绿 CI |

无 N/A 项；12 字段与第 1/2 轮完全一致（11 PASS + receipt UNCHANGED），本会话全部抽查命中、零漂移。

---

## 4. 逐 PR disposition（SPEC §4.2）

> 口径同第 1/2 轮：disposition 是逐 PR 内容判断。四 PR 内容自 `0b2e2d8a` 起冻结于集成树（零代码 delta），
> 且其组合产物已在 exact SHA 上通过完整 required CI。

- **#922 — KEEP_AND_MERGE**：审计证据入库（318/318 归档校验；本会话 `sha256sum -c` 复算 OK）；纯 docs + `.prettierignore`。
- **#923 — KEEP_AND_MERGE**：route 封闭词表投影（ingest+read 双边界单一 `projectClientEventRoute`、fail-closed、
  历史免迁移）+ requestId 形状 gate；跨组织夹具修复向真实协议收敛，残渣 grep 零命中（§2.2）。
- **#924 — KEEP_AND_MERGE**：200 `accepted:false` 的客户端可见关联载体 + fp-wrap CORS 修复；
  `postWithMeta` 单一消费点本会话实读（§3 字段 6）。`getWithMeta` 零生产调用方为 low residual。
- **#926 — KEEP_AND_MERGE**：Pino 请求行去 raw URL（`routeTemplateOf` 单一权威）+ nginx `exam_privacy` access 格式
  + error 级诊断按 Decision A 恢复；`web.conf:49/:65` 本会话实读（§3 字段 11/12）。
  nginx live 故障注入未重放为已接受 residual。

---

## 5. verdict 与 blockers

**verdict = READY_FOR_HUMAN_MERGE**。第 1 轮两项 blocker：blocker 2 已闭合并维持（§2.2）；
blocker 1（required CI）已于本会话在 ask 指定 exact SHA `52a58d4d` 上实测解除——
run 42611431690 attempt 2 全绿（§2.1），FAIL 记录全保留（§2.3），零代码改动（§2.4），
12 契约字段 11 PASS + receipt UNCHANGED（§3）。**无剩余 blocker。**

### blockers（写回：空——无确认的合并前必改项）

（无）

### 人工合并门禁（非 blocker；AGENTS.md §7 / SPEC §8.2）

1. 四 PR 逐个转为 ready for review 并按 `#922 → #923 → #924 → #926` 顺序 individual merge（每次合并后刷新 master、
   验证依赖测试；分支保护按仓库规则执行）；
2. #928 为 CI-only 集成验证分支，**不直接合并**；
3. 合并后按 SPEC §8.3 跑 master smoke（SaveAnswer、correlation、cross-org、route projection、Pino、nginx、
   retention、production build，覆盖四 PR 交互）；
4. 按 SPEC §8.4 收口：本文件与 `FINAL_INTEGRATION_RECORD.md` / `test-flakes.md` 的时态语句（§2.4）随 closeout
   提交进入受控历史，引用绿 run 42611431690 attempt 2；CHANGELOG / implementation-status 按 DEFER trace 落地；
5. #930 在计费稳定确认后关闭/更新（卫生项）。

---

## 6. residualRisks（接受 / 延期）

**已闭合（相对第 2 轮）**：required CI 在 exact SHA 上从未完成 → 已解除（§2.1）。

**接受（有 Owner 决策或边界声明）**
- nginx error log 携带 raw request line：Owner Decision A 显式接受，web.conf 注释 / observability.md /
  operations / 测试四处一致；`INFRA_LOG_ACCESS` = NOT_VERIFIED。
- #878 几何 flake：Owner defer；`ROOT_CAUSE_CONFIDENCE = HYPOTHESIS` 不冒充 CAUSALLY_PROVEN；
  `:555` 与 `:568` 同根因未证明、A3-F7 精确触发路径未定位。绿 CI 中 2 个 E2E shard 全过（本轮未复发），
  条件敏感非确定性风险在合并后继续由 #878 跟踪；SPEC §3.6 允许此形态继续产品合并评估。
- #922 归档含已接受的主机标识类别与合成凭据；发布/共享前需 sanitization。
- 429 状态路径 NOT_TESTED；header 在传输边界不可携带——文档声明边界，未做故障注入。
- 性能：未重放基准；结构性核查（requestIdHeader 仅写响应头、成功路径无新增写）无新增每请求成本信号。

**延期（非产品缺陷、低危清理或留痕 DEFER）**
- ledger 时态语句过时（`FULL_CI = FAIL` 等 + `test-flakes.md:3378`「无权威绿灯」）：随 §8.4 closeout 改写
  （§2.4），不为此新开集成提交。
- OpenAPI 401/403 顶层 `requestId`（203 处）：master 预存制品漂移，运行时正确，follow-up 修 `swagger.ts`
  fallback 并重新生成 `openapi.json`。
- `getWithMeta` 零生产调用方：最终 master 收口时删除或取得 Owner 显式授权。
- P1 web 单测 `req-*` 模拟夹具残渣：按 UUID_FIXTURE_RECONCILIATION §3 下次触碰文件时统一。
- `e97e15fb` 约 2150 行 out-of-scope 交付 docs 技术内容未逐行复审（docs-only 已证实，第 1/2/3 轮同口径），不构成背书。
- #878 Acceptance 收口（4 条未勾选、4 处固定 150ms 残留）与 #930 关闭：合并后跟进。
- 本轮未运行清单：见 §2.5。
- 人工门禁：merge 属 AGENTS.md §7 人工门禁；READY_FOR_HUMAN_MERGE 仅表示进入人工合并门禁；本轮不执行任何 merge/push/commit。

---

## 7. 结论

第 2 轮唯一剩余 blocker（required CI 在集成分支任何 SHA 上从未完成）已在本会话实测解除：外部 GitHub 计费恢复后，
exact SHA `52a58d4d` 上的标准重跑（run 42611431690 attempt 2）取得 7 个 required job 全 success 的完整绿 CI，
历史 FAIL 记录全部保留，无任何门禁放宽。产品代码自 `0b2e2d8a` 起逐字节未变，12 契约字段维持
11 PASS + `SAVEANSWER_RECEIPT_SEMANTICS = UNCHANGED`；flake/occurrence 登记面闭合且 #878 诚实保持 OPEN/DEFER。
四个 PR 均为 KEEP_AND_MERGE，无剩余 blocker，进入人工合并门禁：按 `#922 → #923 → #924 → #926` 顺序
individual merge，#928 不直接合并，合并后按 §8.3 复验 master、按 §8.4 完成文档收口。

— 裁决员（第 3 轮），2026-11-09，exact SHA `52a58d4da7ec51423381510d5e19bff6425965b7`
（绿 CI run 42611431690 attempt 2 于本会话 12:08:12Z 完成，本会话全程只读观察 + 本文件写回，未 commit）
