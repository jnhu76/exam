# FINAL_PRODUCT_ADJUDICATION — 最终产品裁决（第 2 轮 · 修复后独立复审裁决）

> 本文件现为**第 2 轮裁决**（2026-11-09），由独立裁决员基于第 1 轮裁决（BLOCKED，2 blockers）、
> 独立复审 [`REVIEW_RERUN_1.md`](reviews/REVIEW_RERUN_1.md)（verdict BLOCKED，blocker 1 未解 / blocker 2 已解）、
> 修复记录 `e97e15fb`（+ 补记提交 `b6be2591`、`f32693c7`）、CI FAIL (exit 1) 与 SPEC §7/§8 独立作出。
> **未沿用上一轮结论而不验证**：两个 blocker 的当前状态均在本会话以 `gh api` / 文件实读 / git diff 独立复核；
> 第 1 轮正文（verdict BLOCKED、4×KEEP_AND_MERGE、307 定向测试 + 318/318 归档校验 + 浏览器级 M3/M4/M5 实跑）
> 作为历史证据保留于 Git 历史与 `reviews/` 入库副本，其全部裁决字段与本轮一致或被本轮逐项复核。
>
> **verdict = BLOCKED**。唯一剩余 blocker 是 required CI：集成分支**任何 SHA 上从未取得完成的绿 CI**
> （外部 GitHub 账户计费故障，#930 OPEN；本会话在 ask 指定 exact SHA `b6be2591` 与当前 HEAD `f32693c7`
> 上分别独立复核，`gh pr checks 928` = FAIL exit 1）。**Blocker 2（flake/occurrence 登记面）已按合同闭合**
> （`test-flakes.md:3368/3374/3375/3376/3377` 逐项验证，单一 ledger，来源诚实，#878 保持 OPEN/DEFER 无违规表述）。
> 产品代码面：`0b2e2d8a`（四 PR 合并完成点）→ `f32693c7` 全部为 docs-only（本会话 `git diff` 实证零非 docs 文件），
> 第 1 轮在逐字节相同代码上的测试证据继续有效；本会话另对 12 个契约字段的权威代码点逐点抽查命中。
> 不执行 merge / commit / push。四个 PR disposition = KEEP_AND_MERGE（与全局 verdict 正交，不表示门禁已绿）。
>
> **并发写入说明**：本会话写入本文件时检测到一次并发恢复（文件在读取与写入之间被还原为 HEAD 版本，
> 内容与第 1 轮 18:57 版一致后本版覆盖）；与本会话相同的先例见第 1 轮「并发写入说明」。最终以进入
> 受控 Git 历史的一版为准；本版与第 1 轮在 4×KEEP_AND_MERGE、11 PASS + receipt UNCHANGED、CI FAIL、
> 未合并、未发布等全部裁决字段上一致，差异仅在 blocker 2 状态（第 1 轮未闭合 → 本轮已闭合）与证据台账。

---

## 0. 被审对象与元信息（本会话实查）

| 项 | 值 | 证据 |
| --- | --- | --- |
| ask 指定 exact SHA | `b6be2591dfe28b2fe17e53d84d11b37330a81f40`（= 第 1 轮复审对象；修复提交 `e97e15fb` + 补记 `b6be2591`） | `git log --oneline -5` |
| worktree HEAD | ask 时点为 `f32693c7c6e6…`；本会话执行期间并发进程推进为 `0c7350af10df…`（record attempt-1 exact-SHA CI FAIL）——`f32693c7` = `b6be2591` + docs 补记（3 files ±9 行），`0c7350af` 再 + docs 记录（5 files，全 docs），已推送为 PR #928 head | `git rev-parse HEAD`（会话首末各一次）；`git diff --name-only b6be2591..f32693c7` / `f32693c7..0c7350af \| grep -v '^docs/'` 均零命中 |
| 代码同一性 | `0b2e2d8a`（四 PR 合并完成点）→ `f32693c7`：`git diff --name-only 0b2e2d8a..f32693c7 \| grep -v '^docs/'` → **零命中**（20 files 全为 docs） | 本会话实跑；全部被审 SHA 的产品代码逐字节一致 |
| 分支 / PR #928 | `integration/production-closure-20261109`；GitHub Draft、OPEN、head=`f32693c7`、CI-only（do not merge directly） | `gh pr view 928 --json state,isDraft,headRefOid` |
| 四个源 PR | #922 / #923 / #924 / #926 全部 OPEN + Draft + `mergedAt=null`（#922 `mergeStateStatus=CLEAN` 为本会话观察值） | `gh pr view 922/923/924/926 --json state,isDraft,mergedAt` |
| master | `5140c3dd`，集成树未合并 | `git -C /home/hoo/Source/exam rev-parse HEAD` |
| 受控树状态 | 更新本文件前干净（`git status --short` 空）；本文件更新为受控跟踪文件的未提交修改，属本 ask 指定产物，未 commit | `git status --short` |
| 模式 | 调查/评审；除本 ask 指定文档外未改任何受控文件，未 commit/push/merge | — |

---

## 1. 输入材料（ask 给定 + 本会话实读）

- **ask 给定**：第 1 轮 `FINAL_PRODUCT_ADJUDICATION.md`（本文件上一版）、`REVIEW_RERUN_1.md`、修复记录 `e97e15fb604f33e5fc8e99c8c547004f9b05149d`、CI FAIL (exit 1)、`SPEC.md` §7（§7.1 独立性 / §7.2 修复—复审闭环）、§8（合并前最终条件 / 合并顺序 / 合并后验证 / 文档收口）。
- **本会话补充实读/实查**：`docs/standards/test-flakes.md`（OBS-2026-11-03-001 节与新签名小节，`:3318–3377`）、`apps/api/src/server.ts`、`apps/api/src/plugins/requestIdHeader.ts`、`packages/contracts/src/common.ts`、`apps/web/src/pages/exam/TakeExamPage.tsx`、`deploy/nginx/web.conf`、`apps/api/src/lib/proctorMonitoringService.ts`、`apps/api/src/routes/clientEvents.ts`、`docs/contracts/observability.md`、`FINAL_INTEGRATION_RECORD.md` §1/§7/§8。
- **gh api / gh 实查**：runs 42607941019（exact SHA）、42608435613（HEAD）及其 jobs；check-run 129128580103 及其 annotations；`gh pr checks 928`；`gh issue view 930`、`gh issue view 878`；PR 922/923/924/926/928。

---

## 2. Blocker 独立复核（不沿用上一轮结论）

### 2.1 Blocker 1 — required CI 全绿：**未解决（决定性，外部条件）**

本会话命令与输出：

- `gh api 'repos/jnhu76/exam/actions/runs?head_sha=b6be2591dfe28b2fe17e53d84d11b37330a81f40'` → 唯一 run **42607941019**，`status=completed, conclusion=failure`。
- `gh api repos/jnhu76/exam/actions/runs/42607941019/jobs` → `Static checks=failure`；`Build / API coverage / Web coverage / Package coverage / E2E (shard) / Production transport regression` 全部 `skipped`（6 个 required job 零执行）。
- `gh api repos/jnhu76/exam/check-runs/129128580103` → `{name:"Static checks", head_sha:"b6be2591dfe28b2fe17e53d84d11b37330a81f40", conclusion:"failure"}`（check-run 确属 exact SHA）；`…/annotations` → 原文：*"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"*。
- 当前 HEAD：`gh api '…/runs?head_sha=f32693c7c6e6…'` → 唯一 run **42608435613**，`failure`；jobs 明细同签名（Static checks failure + 6 required skipped）。
- 会话末新 HEAD：`gh api '…/runs?head_sha=0c7350af10df…'` → run **42609620433**，`failure`（本会话实查；并发 docs 提交 push 后的又一次 FAIL，同一不变量再证）。
- `gh pr checks 928` → `Static checks fail (1s)` + 7 项 `skipping`，**exit=1**。
- `gh issue view 930` → **OPEN**（billing/spending limit，2026-11-09）。

判定：SPEC §7.2「required CI 失败必须 BLOCKED」/ §8.1.7「最终集成树通过 required CI」在 `b6be2591`（及一切集成分支 SHA）上**从未满足**：0 success required job、0 绿 run。根因是外部 GitHub 账户计费（#930 OPEN），任何代码/文档改动不能修复。**BLOCKED 维持。**

诚实性正面确认：`FINAL_INTEGRATION_RECORD.md` §7/§1 在 HEAD 上如实声明 `FULL_CI = FAIL`、`MERGE_STATUS = BLOCKED`、「每次新的 push 都会在同一外部条件下触发新的 FAIL run」、「不声称 CI 通过、不声称已合并、不声称已发布」（实读）；`f32693c7` 把 run 清单固化为时间无关不变量（`REQUIRED_CI_FAILURES = 4+`，含 42608435613）。**无虚假绿灯。**

### 2.2 Blocker 2 — flake/occurrence 登记面：**已解决**

修复载体唯一：`docs/standards/test-flakes.md`（`e97e15fb` 内 +11 行；`b6be2591`/`f32693c7` 未再触该文件）。本会话逐项实读验证：

| 子项 | 落点（本会话实读行号） | 验证结果 |
| --- | --- | --- |
| (a) run 42483066387 登记为同签名 occurrence | `test-flakes.md:3368` | ✓ HEAD `872a244f`、`conclusion=failure`、仅 shard 2/2 失败、raw log 命中 `:568:31 toBeGreaterThan / Received: 0 / --shard=2/2`；「同族待核」已解除 |
| (b1) 新签名 `:555 toBeFocused` | `test-flakes.md:3370,3374` | ✓ 小节「新签名 occurrence（条件敏感非确定性，均未登记、均未闭合）」；`Received: inactive`、timeout 5000ms、`3 did not run`、证据路径、与 `:568` 同族但同根因未证明，如实 |
| (b2) 新签名 A3-F7 `investigation-ui-acceptance.spec.ts:341` | `test-flakes.md:3375` | ✓ 明确为不同 spec 文件的独立 occurrence；2 次 `1 failed / 9 passed`、pr-865 @ `9dd1d5f4` 控制实验 EXIT=0、M3/M4/M5 通过、条件敏感非确定性归属、精确触发路径未定位 |
| (b3) `CASE_ID` 保持 NONE（不强行归并） | `:3370` 正文 | ✓ 「不并入 CASE（`CASE_ID` 仍 NONE）」 |
| (c) F-04 web 单测一次性失败 → 低优先观察 | `:3376` | ✓ 「本轮未复现，不定级」 |
| (d) 结尾声明：#878 OPEN/DEFER、无 fixed 表述 | `:3377` | ✓ 「#878 仍 OPEN / DEFER、…无 post-fix 完整权威绿灯…登记不替代 #878 验收，也不替代 required CI 绿灯；本条目不表述为已修复」 |

结构检查：新小节是既有 `OBS-2026-11-03-001`（`:3321`）节内的小节扩展，**单一登记权威未被复制**（grep `OBS-2026-11-03-001` → `:257/:1133/:3321` 既有引用，无第二套机制）。来源诚实：`:3373` 明确写「本轮交付编辑**未在本会话复跑**这两条失败，登记依据为下列给定证据材料」——不把转述冒充复现。状态一致：`gh issue view 878` → **OPEN**（本会话实查）。反向验证：第 1 轮时 `grep '555\|toBeFocused'` 为 0 命中，本会话同 grep 命中 `:3374` 等处——登记缺口确实闭合。

结论：第 1 轮 blocker 2 的「两条新签名 + 一条补登 + F-04 观察 + 不违规表述」各子项**全部落地且来源诚实**，登记信息面按 SPEC §7.2 闭合。其最终关闭前置（#878 Acceptance 或其 defer 依赖的完整权威绿灯）与 blocker 1 耦合，不再是独立 blocker。

### 2.3 回归 / 削弱 / 双轨检查

- `git diff --name-only 0b2e2d8a..f32693c7 | grep -v '^docs/'` → 零命中：两轮修复（`e97e15fb`、`b6be2591`、`f32693c7`）**零代码改动**，生产代码、测试断言、授权边界、保存协议无从削弱；`test-flakes.md` 改动方向是新增登记（事实面收紧），未放宽任何门槛。
- SaveAnswer receipt 契约面：`git diff 8061d547..f32693c7 -- packages/contracts/src/attempt.ts packages/exam-engine/src/answerProtocol.ts apps/api/src/routes/attempts.candidate.ts` → **空 diff**（本会话实跑），receipt 语义 UNCHANGED 维持。
- 无重复实现/新双轨（§2.2 结构检查）；无虚假绿灯记录（§2.1 诚实性确认）。

### 2.4 第 1 轮复审遗留说明（如实转记）

`e97e15fb` 在 in-scope 的 `test-flakes.md` 之外携带约 2150 行 docs（ADR-025 附录、security-model、observability 契约、save-failure-evidence、7 份评审与 6 份交付记录入库）。REVIEW_RERUN_1 §4 已确认其全部 docs-only，但**未复审其技术内容**，本会话亦未逐行复审——如实记为残余，不构成背书，也不构成 blocker。其中可独立验证的两项本会话抽查通过：`observability.md:34` 路由示例已改为 `:attemptId`（第 1 轮 residual 闭合）；Save/retry/UNKNOWN 语义新增段与 `TakeExamPage.tsx` 成功判定权威一致。

### 2.5 本会话未运行项（SKIPPED，不冒充已跑）

本会话**未**重跑第 1 轮的 307 个定向测试、`sha256sum -c SHA256SUMS`、浏览器级 E2E（M3/M4/M5）、`pnpm verify` / 全量 `pnpm test` / 全量 E2E。理由：`0b2e2d8a..f32693c7` 零非 docs 文件（§2.3），第 1 轮测试证据作用于逐字节相同的代码；CI 是本 gate 的权威信号且其状态已由 `gh api` 直接取得。契约字段的当前依据 = 本会话权威代码点抽查（§3 逐行标注）+ 第 1 轮对相同字节码的实跑记录（第 1 轮文件 §3.1，`reviews/` 与 Git 历史留档）。

---

## 3. 全局一致性裁决（12 契约字段，最终值）

> 每行标注：本会话权威代码点抽查（实读行号）+ 第 1 轮在逐字节相同代码上的实跑证据（307 tests / 84 PG tests / 浏览器级 M3/M4/M5，见第 1 轮 §3.1–3.2）。代码零改动 ⇒ 字段值不变。

| # | 契约字段 | 最终值 | 本会话抽查点 | 第 1 轮实跑证据 |
| --- | --- | --- | --- | --- |
| 1 | uuidGlobalContract | **PASS** | 夹具残渣 `grep -rn 'req-forged-prt-0001\|req-cross-org-' apps packages` → **0 命中**；`SHA256SUMS` 归档 | 318/318 归档校验；跨组织夹具修复 `9dd1d5f4` 经 `proctorMonitoring.crossOrg` 实跑 |
| 2 | uuidTestFixtures | **PASS** | 同上 grep 0 命中 | 形状门控负例 21/21（`proctorMonitoringService.test.ts`）；crossOrg 404/防枚举/零计数实跑 |
| 3 | serverIdAuthority | **PASS** | `server.ts:117` `genReqId: () => randomUUID()`、`:119` `requestIdHeader: false`（实读） | `server.requestId.test.ts` 2/2（生产 boot：伪造双 header 被忽略、reqId 全 v4） |
| 4 | clientClaimIsolation | **PASS** | `proctorMonitoringService.ts:211` `REQUEST_ID_UUID_SHAPE` 门控（实读）；`TakeExamPage.tsx:894–898` 仅 postWithMeta 元数据（实读） | crossOrg（合法 UUID claim 不开跨组织可见性）+ 21/21（prose/嵌入 UUID/32KB 全丢弃） |
| 5 | requestIdCorrelation | **PASS** | `requestIdHeader.ts` root-scope 无第二 mint（实读）；`common.ts:83` `requestId` 嵌套 `error` 内（实读） | wire 7/7 + status matrix（200/204/401/403/409/500 header==envelope）+ WARN `reqId === header` |
| 6 | saveAnswerEndToEnd | **PASS** | `TakeExamPage.tsx:898` `postWithMeta` 单一消费点、成功分支只认 `accepted`（实读） | 引擎 55/55 + PG 53/53 + `requestIdSaveRejection` + 浏览器级 M4（CONFLICTING_PAYLOAD 全链）/M5 |
| 7 | saveAnswerConcurrency | **PASS** | `8061d547..f32693c7` 引擎/路由零改动（§2.3） | deadline 权威 vs 并发 closeAt、幂等回放零写入、回放 receipt（PG 并发套件 53/53） |
| 8 | saveAnswerReceiptSemantics | **UNCHANGED** | `git diff 8061d547..f32693c7` 于 attempt.ts / answerProtocol.ts / attempts.candidate.ts → 空 diff（本会话实跑） | 与第 1 轮判定一致 |
| 9 | routePrivacy | **PASS** | `clientEvents.ts:118` `route: projectClientEventRoute(event.route)`（实读） | 封闭集不变量 + fuzz 60/60 + SPA 词表 drift guard 4/4 |
| 10 | legacyRouteReadPrivacy | **PASS** | 读侧再投影方向 fail-deny（第 1 轮 diff 证据；`normalizeRouteForStorage` 已删） | 读侧再投影测试（clientEventRoute 60/60 覆盖 ingest+read 双边界） |
| 11 | nginxAccessPrivacy | **PASS** | `web.conf:49` `log_format exam_privacy` 固定 `$exam_route`、禁 `$request`/`$request_uri`/Referer/Cookie（实读） | `nginxWebConf.test.ts` 7/7（HTTPS 模板去注释钉住） |
| 12 | nginxErrorDiagnostics | **PASS** | `web.conf:65` `error_log … error` + Decision A 注释（实读） | 同上 7/7；Owner Decision A 边界四处一致 |

无 N/A 项；12 字段与第 1 轮完全一致（11 PASS + receipt UNCHANGED）。

---

## 4. 逐 PR disposition（SPEC §4.2）

> 口径同第 1 轮：disposition 是逐 PR 内容判断，与全局 verdict（BLOCKED，外部门禁驱动）正交。两轮修复零代码改动，四 PR 内容与第 1 轮被审内容逐字节一致，第 1 轮内容级结论全部维持。

- **#922 — KEEP_AND_MERGE**：审计证据入库（318/318 归档校验第 1 轮实跑复算）；纯 docs + `.prettierignore`，零运行时代码；归档 sanitization 边界为已接受 residual。
- **#923 — KEEP_AND_MERGE**：route 封闭词表投影（ingest+read 双边界单一 `projectClientEventRoute`、fail-closed、历史免迁移）+ requestId 形状 gate；跨组织夹具修复向真实协议收敛，残渣 grep 本会话 0 命中（§3 字段 1/2）。其历史 CI 红属 flake/计费外因。
- **#924 — KEEP_AND_MERGE**：200 `accepted:false` 业务拒绝的客户端可见关联载体 + fp-wrap CORS 修复；`postWithMeta` 单一消费点本会话实读（§3 字段 6）。`getWithMeta` 零生产调用方为 low residual。
- **#926 — KEEP_AND_MERGE**：Pino 请求行去 raw URL（`routeTemplateOf` 单一权威）+ nginx `exam_privacy` access 格式 + error 级诊断按 Decision A 恢复；`web.conf` 与 `observability.md` 本会话实读一致（§3 字段 11/12）。nginx live 故障注入未重放为已接受 residual。

---

## 5. verdict 与 blockers

**verdict = BLOCKED**。唯一驱动因素：**required CI 在集成分支任何 SHA 上从未完成**（SPEC §7.2 / §8.1.7 明文；本会话在 `b6be2591` 与 `f32693c7` 上分别以 `gh api` 独立复核，`gh pr checks 928` = FAIL exit 1，#930 OPEN）。第 1 轮 blocker 2 已闭合（§2.2）；产品代码面 12 契约字段 11 PASS + receipt UNCHANGED（§3）。

### blockers（仍存在，写回）

1. **owner=ci — required CI 在 exact SHA 上从未完成（外部 GitHub 账户计费，#930 OPEN）**
   - summary：ask 指定 exact SHA `b6be2591` 上唯一 run 42607941019 为 failure（Static checks 因 billing 未启动、6 个 required job 全部 skipped，check-run 129128580103 注释原文已核）；其上已推送 HEAD `f32693c7` 的 run 42608435613 同签名 failure；`gh pr checks 928` exit=1；0 绿 run。
   - evidence：§2.1 全部命令与输出（本会话实跑）；`FINAL_INTEGRATION_RECORD.md` §7 如实声明 FAIL/BLOCKED；Issue #930 OPEN（updatedAt 2026-11-09T11:16Z）。
   - fix：#930 计费恢复后，在最终 exact SHA 的 clean tree 重跑完整 CI（Static checks + Build + 3 coverage lanes + Production transport + 2 E2E shards 全部 success）；保留全部 FAIL 记录；取得绿 CI 后按 SPEC §7.2 做增量独立复审（期间若有新提交进入集成线则产生新 SHA）。本地 `pnpm verify`/`pnpm e2e` 绿灯不替代 required CI。

> 不列为 blocker 的已确认项：#878 处理（登记面已闭合，剩余 Acceptance/defer 与 blocker 1 耦合，非独立 blocker）；`e97e15fb` 约 2150 行 out-of-scope docs 内容未逐行复审（docs-only 已证实，REVIEW_RERUN_1 §4 同口径，残余见 §6）；本文件本次更新未提交（本 ask 指定产物，须随 closeout 提交进入受控历史，并入合并条件而非本轮 blocker）。

---

## 6. residualRisks（接受 / 延期）

**已闭合（相对第 1 轮）**：`observability.md:34` 路由示例参数名——`e97e15fb` 已改为 `:attemptId`（本会话实读）；两条新签名 occurrence 登记缺口——已闭合（§2.2）。

**接受（有 Owner 决策或边界声明）**
- nginx error log 携带 raw request line：Owner Decision A 显式接受，web.conf 注释 / observability.md / operations / 测试四处一致；`INFRA_LOG_ACCESS` = NOT_VERIFIED。
- #878 几何 flake：Owner defer；`ROOT_CAUSE_CONFIDENCE = HYPOTHESIS` 不冒充 CAUSALLY_PROVEN；`:555`/`:341` 同根因未证明、A3-F7 精确触发路径未定位（登记在案，条件画像留待下轮）。
- 429 状态路径 NOT_TESTED；header 在传输边界不可携带——文档声明边界，未做故障注入。
- #922 归档含已接受的主机标识类别与合成凭据；发布/共享前需 sanitization。
- 性能：未重放基准；结构性核查（requestIdHeader 仅写响应头、成功路径无新增写）无新增每请求成本的信号。

**延期（非产品缺陷、低危清理或留痕 DEFER）**
- OpenAPI 401/403 顶层 `requestId`（203 处）：master 预存制品漂移，运行时正确，follow-up 修 `swagger.ts` fallback 并重新生成 `openapi.json`。
- `getWithMeta` 零生产调用方：最终 master 收口时删除或取得 Owner 显式授权。
- P1 web 单测 `req-*` 模拟夹具残渣：按 UUID_FIXTURE_RECONCILIATION §3 下次触碰文件时统一（client 不校验形状，不导致集成红）。
- `e97e15fb` 约 2150 行 out-of-scope 交付 docs：docs-only 已证实（REVIEW_RERUN_1 §3 + 本会话 `grep -v '^docs/'` 零命中），技术内容未逐行复审，不构成背书。
- 合并路径：四 PR 按序 individual merge（`#922 → #923 → #924 → #926`，SPEC §8.2）；#928 CI-only 不直接合并；本文件更新须随 closeout 提交进入受控历史；合并后按 §8.3 跑 master smoke；CHANGELOG / implementation-status 按 DEFER trace 在最终 master merge 落地（§8.4）。
- 本轮未运行清单：见 §2.5（307 定向测试 / sha256sum / 浏览器级 E2E / verify / 全量 lint 等均以代码逐字节同一 + 第 1 轮记录为依据，SKIPPED 如实）。
- 人工门禁：merge 属 AGENTS.md §7 人工门禁；READY_FOR_HUMAN_MERGE 仅表示进入人工合并门禁；本轮不执行任何 merge/push/commit。

---

## 7. 结论

第 1 轮的两项 blocker 中，**blocker 2（flake/occurrence 登记面）已按合同闭合**且无回归、无虚假绿灯、无双轨；**blocker 1（required CI）未解决**，且为本轮唯一剩余阻塞——其先决条件（#930 billing 恢复）是外部账户条件，代码与文档侧已无未闭合工作。产品代码自 `0b2e2d8a` 起逐字节未变，12 契约字段维持 11 PASS + `SAVEANSWER_RECEIPT_SEMANTICS = UNCHANGED`。billing 恢复 → 最终 exact SHA clean tree 完整绿 CI → 按 §7.2 增量复审 → 台账前置（#878 defer 所依赖的权威绿灯）随之成立后，四个 KEEP_AND_MERGE 进入人工合并门禁（按 `#922 → #923 → #924 → #926` 顺序，SPEC §8.2/§8.3 复验）。

— 裁决员（第 2 轮），2026-11-09，exact SHA `b6be2591`（会话期间 HEAD 由 `f32693c7` 推进至 `0c7350af`，两次推进均 docs-only 已实证；代码面结论对其逐字节成立）
