# FINAL-ADJUDICATION — 契约 §7/§10 独立最终联合裁决

- 裁决角色：独立最终裁决员（未参与实现；未与施工方、四路评审共享上下文）
- 裁决日期：2026-11-09
- 裁决对象：契约 `TASK-CONTRACT.md`（特别是 §7.4 修复—复审闭环、§9 交付物、§10 最终输出与“最终成功条件”）
- 裁决方式：只读复核 + 独立执行关键失败复现 + 重算证据校验和；**未修改产品代码，未 commit/push，未创建 GitHub Issue**

## 七要素（本文自证）

| 要素 | 值 |
| --- | --- |
| 真实代码 SHA | master `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d`；最终集成 `a84b416a0c58cd73a7143eef274ef2c68f0f4fcc`（`final-closure-integration`）；PR #922 `7243aa5c5ab46155d914907b6ff30acf9b51cbe4` / #923 `d3580f3e46e2292317dfe831efd982d475d163e8` / #924 `e81b76a17212c8e321a83f1b0522e54a049326f1` / #926 `1dd4d2067fd81143268aaeea56d2e35ef715a6f3` |
| 运行环境 | WSL2 Linux 6.18.54.1-microsoft-standard-WSL2；Node v24.22.1；pnpm 11.1.2；vitest 4.1.7；PostgreSQL 18.4（容器 `exam-dev-db-1`，测试经 `TEST_DB_ISOLATION=worker-database` 隔离）；GitHub CLI 查询远端 CI |
| 执行命令 | 见 §7“本裁决员实际执行的检查”；关键命令与输出逐条列出 |
| 关键测试结果 | exact SHA clean tree `crossOrg.test.ts` = **1 failed / 6 passed**；工作树同文件 = 7 passed；web 54/54；nginxWebConf 7/7；requestIdSaveRejection 2/2；retention contract 8/8；LEGACY 1 passed；shape-gate unit 21/21；`gh pr checks 923` = E2E shard 1 **fail** |
| 原始证据路径 | 本目录 07/08/09/10、四份 `review-*.md`、`SAVEANSWER-*.md`、`FINAL-OWNER-DECISIONS.md`、`raw/nginx-fault-injection/`、`raw/perf-ab/`、`raw/saveanswer-e2e/`、`/tmp/final-adj-a84`（exact-SHA 纯净导出，用后已清理）；集成 worktree `/home/hoo/Source/exam-gap-worktrees/integration-final` |
| 已知边界 | 未运行完整 `pnpm verify`、完整 `pnpm e2e`、全量 `pnpm test`、nginx live 故障注入、生产构建逐字节比对；E2E M3 未由本裁决员重跑（CI 日志 + 已提交断言 + gate 行为构成只读证明）；部署侧/备份侧无访问权，维持 UNKNOWN/NOT_VERIFIED |
| 结论可信度 | **阻断判定：高**（exact SHA 上亲手复现 1 failed；PR CI 直接查询）；**代码语义：高**（保护路径 diff 为空 + 定向测试实跑）；**浏览器 M4/M5：中高**（实跑证据由编纂会话归档，本裁决员未重跑）；**性能：中高**（归档原始数据逐项核对，未复跑 A/B）；**部署/备份：低/UNKNOWN**（无访问权，未虚构） |

---

## 0. 裁决摘要（先给结论）

```text
FINAL_REMEDIATION_MERGE_READY = NOT_MET
PR_MERGE_READINESS = BLOCKED
MERGE_STATUS = NOT_MERGED
RELEASE_STATUS = NOT_RELEASED
FULL_INTEGRATION_CI = FAIL
SUBAGENT_FINDINGS_UNRESOLVED = 5
```

**一句话结论**：四个 PR 的**产品语义与安全修复本身**经四路独立评审与本次定向复跑，未发现 P0/P1 级产品漏洞或 SaveAnswer 语义回归；但**最终交付状态不自洽**——exact SHA `a84b416a` 的已提交测试自身红（`crossOrg.test.ts` 1 failed / 6 passed），E2E M3 夹具与 #923 形状 gate 冲突，`#923` 最终 head 的 GitHub CI E2E shard 1 红，而两处夹具修复仅存在于 integration worktree 的**未提交**改动中，且集成 SHA 无远端承载、组合门禁无同一 SHA 的归档原始日志、证据文档仍未入库。契约“最终成功条件”中的「组合 CI 与性能门禁通过」「关键 findings 已修复并复审」「所有证据可追溯至最终 exact SHA」均不满足，故不得宣布 `FINAL_REMEDIATION_MERGE_READY`。

---

## 1. 四路独立评审 verdict 复核

| 角色 | 评审 verdict | 本裁决员复核 | 依据与限定 |
| --- | --- | --- | --- |
| Security / Privacy Red Team | `PASS` | **同意其领域结论**：0 P0/P1/P2，3×P3 + 1 INFO；#923 封闭输出无绕过、legacy 无未保护读取端、requestId 非凭据、失败遥测无答案泄露、access log 无原始 URL、error log 风险记录准确、跨租户负例成立 | 评审对象是 `5d4b2773`；其 F2（requestId 形状 gate）修复在 `d3580f3e`，但 **exact SHA `a84b416a` 的夹具与 gate 矛盾**（见 §2）。评审正文的 PASS 不自动等于 F2 在最终 SHA 已闭合 |
| SaveAnswer Protocol & Concurrency | `PASS` | **同意其领域结论**：§3.7 七项门禁满足；六类结果区分正确；保存/重试/协调/并发/ACK 丢失语义未回归；4×P3（其中 F1/F2 为 master 既有 UI 语义） | 评审对象是 `5d4b2773`；其 F4 已由 `e81b76a1` 补 2 例（本轮实跑 13/13，含心跳负例）。F2 的 exact-SHA 夹具问题见 §2 |
| Linux/Nginx/Ops Reliability | `CONDITIONAL` | **同意**：核心交付成立（access 隐私 22 次 + 独立复现；error 级诊断价值；warn 不升级；retention 8/8；生产 symlink→docker logs 落点验证；部署/备份 UNKNOWN 诚实） | 条件 (1) Mode B 80 端口配方已由 `1dd4d206` 修复（web.conf/compose/README + pin 测试，本轮 7/7）；条件 (2) **compose `logging:` 上限未落地**，仍为 Owner 决策项。故仍为 `CONDITIONAL` |
| Architecture & Performance | `PASS` | **同意其领域结论**：无过度抽象、无重复 Fetch/解析、SaveAnswer 协议 diff 为空、React 净增 1 状态槽且契约授权、保护四指标独立复核成立、日志净缩 | 其 ARCH-PERF-1（4 组数字与归档不符）已在 `10-INTEGRATION-CI-AND-PERFORMANCE.md` 顶部“数字勘误”按归档 JSON 修正（本裁决员逐项复核归档值一致）；ARCH-DUP-1/2 已处置；ARCH-CI-1/ARCH-EVID-1 **仍未完成**（见 §2/§4） |

**结论**：四路 verdict 的领域判断可以采信；但“评审通过”不能替代契约 §7.4 要求的“新 exact SHA 复审”。F2 的最终 SHA 复审未闭合，且 #923 CI 红，因此总体合并就绪受阻断。

---

## 2. 五条“复审未解决项”逐条裁决

> 先给分类口径：
> - **真实阻断**：使契约“最终成功条件”无法成立、或使 exact SHA 自身不可复现/不可合并；
> - **可接受 P2-P3**：有明确边界、Owner 已有风险接受或属非阻断 follow-up；
> - **复审视角差异**：跨角色复核他人领域条目产生的谨慎标注，不构成额外缺陷。
>
> 本轮 5 条未解决项**不是 5 个独立缺陷**：它们全部指向**同一根因**——`#923` `d3580f3e` 的 requestId 形状 gate 已提交，但与之配套的两处测试夹具修正**未提交**（只存在于 `integration-final` 工作树）。因此 5 条均判 **真实阻断（交付自洽性/可追溯性）**，而非产品语义回归；其底层 finding 严重度仍为 P3，但当前 disposition 不能按 P3 接受。

### U1. [security] F2：requestId 形状 gate 在 exact SHA 上使 crossOrg 测试红

- **分类：真实阻断（交付自洽性；非产品漏洞，非语义回归）**
- 证据（本裁决员亲手执行）：
  - gate 已提交且正确：`apps/api/src/lib/proctorMonitoringService.ts:211`（`REQUEST_ID_UUID_SHAPE`）、`:230-235`（仅 UUID string 投影）；单测 `src/lib/proctorMonitoringService.test.ts` **21/21 passed**。
  - exact SHA 的 committed fixture 仍是前缀形式：`git show a84b416a:apps/api/src/routes/proctorMonitoring.crossOrg.test.ts` 第 229 行 `const claimedRequestId = \`req-cross-org-${randomUUID()}\`;`，第 285 行 `expect(claimedRow!.metadata.requestId).toBe(claimedRequestId);`。
  - 在 `/tmp/final-adj-a84`（`git archive a84b416a` 纯净导出 + node_modules 软链）实跑
    `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=1 ./node_modules/.bin/vitest run src/routes/proctorMonitoring.crossOrg.test.ts`
    → **Test Files 1 failed | Tests 1 failed | 6 passed**，`AssertionError: expected undefined to be 'req-cross-org-6b2ef55b-…'` at `crossOrg.test.ts:285`。
  - 同一 worktree（含未提交 fixture 修正）实跑 → **7/7 passed**。
- 判定：安全修复本体有效；但 exact SHA 的测试红是**已提交事实**，不能把工作树的 7/7 当成 exact SHA 已闭合。按契约 §7.4，必须提交夹具修正、生成新 exact SHA 后重跑。

### U2. [protocol] F2 + E2E 夹具：committed M3 断言与 gate 冲突，#923 CI 红

- **分类：真实阻断（同一根因；交付自洽性）**
- 证据：
  - committed E2E：`git show a84b416a:apps/e2e/e2e/investigation-ui-acceptance.spec.ts` 第 765 行 `const forgedRequestId = "req-forged-prt-0001";`；第 844/896 行断言时间线文本 `toContain(forgedRequestId)`。
  - gate 只投影 UUID 形状；`req-forged-prt-0001` 必然被丢弃（`proctorMonitoringService.ts:230-235`）。
  - `gh pr checks 923`（本裁决员实跑）→ `E2E (shard 1/2) | fail`，PR 状态 `UNSTABLE`；`gh api …/jobs/128847373789/logs` 日志明确 `Expected substring: "req-forged-prt-0001"` at `investigation-ui-acceptance.spec.ts:844`。
  - 工作树已把 forged id 改为 `00000000-0000-4000-8000-000000000bad`（`git diff` :762 附近），但 `git log --all -S "00000000-0000-4000-8000-000000000bad"` 输出为空 → 无任何 commit 包含该修复。
- 判定：E2E 未由本裁决员重跑（需完整 docker + Playwright），但 CI 日志 + 已提交断言 + gate 行为已构成**只读证明**；这是 #923 不能合并的直接原因。

### U3. [protocol 新发现 N1] integration-final 工作树 dirty，exact SHA 非自洽

- **分类：真实阻断（交付状态/可追溯性）**
- 证据：
  - `git -C integration-final status --short` → `M apps/api/src/routes/proctorMonitoring.crossOrg.test.ts`、`M apps/e2e/e2e/investigation-ui-acceptance.spec.ts`；`HEAD = a84b416a…`。
  - `git log --all -S "00000000-0000-4000-8000-000000000bad"` 为空；两处修改不在任何 PR head 中。
  - 工作树上的两处修改恰为 gate 所需 remedy：crossOrg 改为裸 `randomUUID()`（worktree:232）、E2E 改为 UUID 形状（worktree:768）。
- 判定：契约 §7.4 第 7 步要求“更新集成 SHA”后复审；目前是“同一 SHA + 未提交改动”。不提交即无法把“修复后门禁”归因到任何 exact SHA，故阻断。

### U4. [ops] F2 同一根因：纯净树 crossOrg 1 failed

- **分类：真实阻断（同一根因；与 U1 重复）**
- 证据：ops 评审以 `git archive a84b416a` 纯净树实跑 crossOrg → 1 failed / 6 passed；本裁决员在 `/tmp/final-adj-a84` 独立复现**完全相同结果**（同一断言、同一行号）；工作树 7/7。结论一致，非环境偶发。
- 判定：ops 的“未解决”标注正确；不需要新的 ops 结论，只需提交夹具。

### U5. [architecture] F2 + #923 CI：修复未完整交付

- **分类：真实阻断（同一根因；含 CI 证据）**
- 证据：
  - `gh pr checks 923` → E2E shard 1 fail（run `42518523050` / job `128847373789`）。
  - `git branch -r --contains a84b416a` 输出为空 → 集成 SHA 无远端分支/无组合 CI。
  - `git diff --stat 5d4b2773..a84b416a` 共 10 文件 +388/−33（评审修复）；两处夹具修正不在其中。
- 判定：架构评审的 ARCH-CI-1 与 F2 收尾在同一处：必须先提交夹具，再冻结新 SHA 并跑组合门禁。

### 2.1 分类汇总

| # | 来源 | 分类 | 底层严重度 | 是否需要代码/测试改动 | 阻断合并？ |
| --- | --- | --- | --- | --- | --- |
| U1 | security F2 | 真实阻断（交付自洽性） | P3（安全 finding 本身） | 是：提交 crossOrg fixture | 是 |
| U2 | protocol F2/E2E | 真实阻断（同一根因） | P3 | 是：提交 E2E fixture | 是 |
| U3 | protocol N1 | 真实阻断（未提交状态） | 流程 | 是：提交两处 fixture | 是 |
| U4 | ops F2 | 真实阻断（同一根因） | P3 | 是（同上） | 是 |
| U5 | architecture F2/CI | 真实阻断（同一根因 + CI） | P3 | 是（同上）+ 重跑 CI | 是 |

**没有一条属于“复审视角差异”**：四路评审对 F2 的标注互相独立，且本裁决员用 exact-SHA 纯净树与 CI 日志分别复现了同一失败。**也没有一条可以按“可接受 P2-P3”豁免**：产品漏洞本身是 P3，但 exact SHA 自身红 + PR CI 红 + 修复未提交，已经越过契约的合并门禁。

---

## 3. 契约“最终成功条件”逐条核对

契约 §10 末尾列出 10 项最终成功条件。逐条判定如下（“证据”列只引用本裁决员读过或跑过的内容）：

| # | 最终成功条件 | 判定 | 证据 |
| --- | --- | --- | --- |
| 1 | 真实 SaveAnswer 调用方能够使用响应头 requestId | **PASS** | `TakeExamPage.tsx:898` 唯一 `api.postWithMeta<SaveAnswerResponseDTO>`；`api.ts:306-338` 读 `x-request-id` 进 `meta.requestId`；`git grep` 全文件仅 1 个保存调用点；M4 浏览器证据同一 UUID 三处互证 |
| 2 | HTTP 200 业务拒绝可以精确关联服务器日志 | **PASS** | `requestIdSaveRejection.test.ts` 2/2（真实 PG；header == WARN `reqId`、body 无 requestId）；M4 真实 200 `CONFLICTING_PAYLOAD`：UI `请求编号` == 服务器 WARN `reqId` == 时间线 client-claimed 值（`e0289b97-…`） |
| 3 | 成功、拒绝、协调、网络失败和并发路径未发生语义回归 | **PASS**（附注） | `git diff --stat 5140c3dd..HEAD -- apps/api/src/routes/attempts.candidate.ts packages/exam-engine packages/db packages/contracts/src/attempt.ts apps/web/src/hooks apps/web/src/exam` **为空**；web 54/54（含 STALE 协调零失败遥测、transport 不伪造 id、旧 attempt 隔离、心跳×拒绝 id 负例）；协议评审 PASS。**附注**：exact SHA 的 crossOrg 红是测试夹具与 gate 的组合问题，不是保存语义回归（见 §2） |
| 4 | nginx 保留必要的原生故障诊断 | **PASS** | `web.conf:65` `error_log … error`；归档 24 次运行中 S02–S07 七类上游/解析故障 error 级均可辨识根因（本裁决员 grep：could not be resolved / Connection refused / timed out / prematurely closed 全命中）；crit 变体全部 0 行 |
| 5 | access log 仍保持安全字段投影 | **PASS** | `web.conf:49-52` 仅 `$request_method $exam_route` + status/bytes/rt/up/reqid；`runs/*/access.log` 24 个运行目录 canary 命中 **0**；`$request/$request_uri/$uri/$http_referer|cookie|authorization` 被 `nginxWebConf.test.ts` pin（7/7 实跑） |
| 6 | 历史路由读取安全、30 天清理机制已验证 | **PASS** | retention contract **8/8**（本裁决员实跑，真实 PG 18.4 + 可控时钟 + trigger 故障注入 + 双连接 + advisory-lock shutdown）；`proctorMonitoring.test.ts -t LEGACY` **1 passed**；读取端唯一带出 route 的 SELECT 仍强制 `projectClientEventRoute`（`proctorMonitoringService.ts:72`） |
| 7 | 剩余部署和备份风险明确标记 | **PASS** | `07 §3` 六项部署 UNKNOWN；`09` 备份保留/加密/权限/离线副本 UNKNOWN；`INFRA_LOG_ACCESS = NOT_VERIFIED`、`BACKUP_RETENTION = UNKNOWN` 均如实标注，未虚构 VERIFIED |
| 8 | 组合 CI 与性能门禁通过 | **FAIL** | 性能：NOT_DETECTED（归档数据复核成立）。**组合 CI：失败**——exact SHA `a84b416a` clean tree crossOrg **1 failed / 6 passed**（本裁决员实跑）；#923 head `d3580f3e` E2E shard 1 **fail**（`gh pr checks`）；集成 SHA 无远端分支（`git branch -r --contains` 空）；证据库无同一 SHA 的完整组合门禁原始日志（10 号文档 CI-2 / O4 自认） |
| 9 | 四个独立 Subagent 完成审查，关键 findings 已修复并复审 | **PARTIAL** | 四份 review 均完成且归档；F1（07 标注）已补注、F3/F4 已修（13/13、54/54 实跑）、ARCH-DUP 已处置、ARCH-PERF-1 已在 10 号文档勘误；**但 F2 的 exact-SHA 复审未闭合**（U1–U5），ops 条件 (2) compose logging 未决。契约 §7.4 要求“新的 exact SHA 复审”，目前没有新 SHA |
| 10 | 所有证据可追溯至最终 exact SHA | **FAIL** | 两处使测试转绿的夹具修改不在任何 commit（`git status` M；`git log --all -S` 空）；“修复后门禁”只能在 dirty worktree 上成立；integration SHA 无远端承载；s0-evidence 的 07/08/09/10、BASELINE、TASK-CONTRACT、raw/nginx-fault-injection、raw/perf-ab、raw/saveanswer-e2e、四份 review-* 仍为 untracked（`git status --short`），SHA256SUMS 为 M |

**核对结果**：条件 1–7 成立，条件 9 PARTIAL，条件 8、10 FAIL。**不满足全部条件**，故不能宣布 `FINAL_REMEDIATION_MERGE_READY`。

---

## 4. 合并就绪判定

```text
PR_MERGE_READINESS = BLOCKED
```

### 4.1 为什么不是 READY / PARTIAL

- `READY_FOR_HUMAN_MERGE` 不成立：exact SHA 自身测试红、PR #923 CI 红，合并后 CI 必然红。
- `PARTIAL` 也不足以描述：PARTIAL 适用于“功能已满足、只有非阻断 follow-up”。当前阻断项是**合并门禁本身**（exact SHA 不可自洽、修复未提交、证据不可追溯），不是可选优化。按契约“不满足时必须给出准确的 BLOCKED/PARTIAL”，选 **BLOCKED**。

### 4.2 精确的解阻断路径（最小、可复核）

1. 将 integration-final 工作树已有的两处夹具修正**提交**到相应 PR 分支（推荐：`crossOrg.test.ts` 归 #924，因为该第 7 例由 #924 新增；E2E `investigation-ui-acceptance.spec.ts` 归 #924 或 #923）：
   - `crossOrg.test.ts`：`claimedRequestId = randomUUID()`（裸 UUID）；
   - `investigation-ui-acceptance.spec.ts`：`forgedRequestId = "00000000-0000-4000-8000-000000000bad"`（UUID 形状）。
2. push 后重跑/等待 #923、#924 的 GitHub CI 至 E2E shard 1/2 全绿（当前 #923 红；#924 绿）。
3. 用新的四 PR exact head 重新生成 integration SHA（按 #922→#923→#924→#926 顺序），确认工作树 clean。
4. 在新 exact SHA 上重跑并归档至少：`crossOrg.test.ts` 7/7、E2E M3（或等价 pin）、`pnpm verify`、`bash scripts/e2e/run.sh`；把原始日志归档到证据库（不是 `/tmp` 唯一存放）。
5. 由原发现者或另一独立 Subagent 对新 exact SHA 复审 F2（契约 §7.4 第 7 步），确认 5 条未解决项关闭。
6. 由 #922 收口提交把本目录全部证据（07/08/09/10、raw/、四份 review、本裁决、SHA256SUMS）入库；Owner 对 compose `logging:` 上限作出落地或书面接受决定。

完成 1–6 后，才可重新评估 `FINAL_REMEDIATION_MERGE_READY`。当前**不得**按既定顺序人工合并。

---

## 5. 剩余风险与部署/备份 UNKNOWN

### 5.1 已接受风险（Owner 决策，文档已如实记录）

1. **error log 原始 URL 风险（Decision A）**：error 级下 7 个上游/解析故障场景的 error 行含完整请求行（部分含 `upstream:` URL 二次泄露）；`warn` 还会额外泄露 malformed 请求行。Owner 明确接受，且与 access-log 隐私分开声明。`NGINX_ERROR_LOG_RAW_URL_RISK = ACCEPTED`。
2. **历史 client_events.route 原始字节（Decision B）**：在线层 at-rest 残留仍存在（`raw/replay-db-routestorage.txt` 真实 dump 证明）；读取端强制投影，30 天机制自然老化；备份层保留期由 operator 决定。`HISTORICAL_AT_REST_RISK = ACCEPTED`。

### 5.2 部署侧 UNKNOWN（无部署访问权，未虚构 VERIFIED）

- Docker daemon 日志驱动与轮转参数、`/var/lib/docker/containers/**.log` 的宿主权限与读取主体、systemd/journald 是否接管、第三方日志收集器、真实部署是否激活 HTTPS —— 全部 UNKNOWN。
- `docker-compose.yml` / `docker-compose.dev.yml` **无任何 `logging:` 上限**（本裁决员 grep `logging|max-size|max-file|log-driver` 零命中）；`docs/operations/README.md:133-134` 自认“bundled compose file does not cap log growth”。因此 error log 的磁盘增长与原始 URL 留存时长在仓库内**无上限**，取决于宿主 daemon 默认。
- 结论：`INFRA_LOG_ACCESS = NOT_VERIFIED` 成立；Owner 需在 #925/#926 收口时落地 `logging:` 上限或书面接受 daemon 默认。

### 5.3 备份侧 UNKNOWN

- 唯一受支持机制为 `scripts/db-backup.sh`（`pg_dump -Fc` / `pg_restore`；runbook §17）。
- 备份保留期/加密/dump 文件权限/离线副本/第三方收集：全部 UNKNOWN；`pg_restore` 全库恢复会使 dump 时点未过期的旧行重新 at-rest（读取端仍投影）。`BACKUP_RETENTION = UNKNOWN`，不是 VERIFIED/PARTIAL。

### 5.4 其他残余观察（非本轮阻断，不得静默豁免）

- #923 CI 的第二条失败 `rich-content-overflow.spec.ts:568`（滚动几何）与本轮四 PR 无已知因果通道，但**未归因**；按契约 §6“不得因 historically flaky 自动豁免”，合并前应确认其是否独立 flake。
- `10-INTEGRATION-CI-AND-PERFORMANCE.md` 的“66 文件”与实际 `raw/perf-ab/` **70 文件**存在计数差异（归档文件齐全、校验和覆盖 70 项）；属文档计数瑕疵，不影响判定。
- 调度交接的性能摘要引用了修正前的旧数字（+48.5ns 等）；**以 `10-INTEGRATION-CI-AND-PERFORMANCE.md` 的“数字勘误”与归档 JSON 为准**（+162.7ns 等），方向与判定不变。

---

## 6. NEW_ISSUE_CANDIDATE / OWNER_ACCEPT_CANDIDATE 汇总

> 仅描述，不创建 Issue，不借本轮扩大代码范围。状态以本裁决时点为准。

### 6.1 NEW_ISSUE_CANDIDATE（建议独立 follow-up）

1. **P3（master 既有行为）跨题成功保存清空 rejection 对**：任意题 accepted 后无条件 `setSaveRejection(null)` / `setSaveRejectionRequestId(null)`（`TakeExamPage.tsx:922`），另一题仍在生效的拒绝 alert+编号会消失；失败未漏报（`failedQuestionIds` banner 仍在），id/copy 不错配。与 master `:902` 同型，非本轮回归；修复需先定“alert 属于哪道题”的产品语义。
2. **P3（master 既有行为）断连期间 rejection alert 被隐藏**：`saveRejection && !isDisconnected` 门控（`TakeExamPage.tsx:1571` 附近）；恢复后原样重现，编号不丢。非本轮回归；如改善可独立调整门条件。

### 6.2 OWNER_ACCEPT_CANDIDATE（需 Owner 明确决定）

3. **P2 compose 日志上限**：`docker-compose.yml` 已在 #926 diff 内（healthcheck 改动），但无 `logging:`；需 Owner 决定加 `max-size`/`max-file`，或书面接受 daemon 默认并记录理由。这是 Decision A“避免无限保留”的隔离条件，未落地前 `INFRA_LOG_ACCESS` 只能保持 NOT_VERIFIED。
4. **P2/P3 集成验证与证据入库（收口动作，非代码缺陷）**：
   - 在新的 exact SHA 上补跑并归档完整 §6 组合门禁（当前集成 SHA 无远端 CI；本裁决员已实跑 exact-SHA crossOrg 复现红）；
   - 由 #922 收口提交把本目录全部证据入库（当前 07/08/09/10、BASELINE、TASK-CONTRACT、raw/nginx-fault-injection、raw/perf-ab、raw/saveanswer-e2e、四份 review-* 均 untracked；SHA256SUMS 为 M）。**本裁决员不 commit/push，故该动作留给主执行方/Owner。**

### 6.3 已关闭/无需新 Issue 的候选（复核确认）

5. **ARCH-PERF-1（性能数字溯源）**：`10-INTEGRATION-CI-AND-PERFORMANCE.md` 顶部“数字勘误”已按归档 JSON 修正四组数字（`httperr` B/A = 1.2355；`postWithMeta` = +162.7 ns / +2.95%；route projection = +397.9~520.2 ns/事件；React = 5994→7978 ns/render，+1984 ns）。本裁决员逐项读取 `analysis.json` / `micro-*.json`，与修正后文本一致。**无需新 Issue；不得反向篡改原始 JSON。**
6. **security F1（07 号文档受测对象标注歧义）**：07 号文档头部与 §7 已补注——受测快照是 `raw/nginx-fault-injection/confs/web-error.conf`（sha256 `4edca523…`，未提交 Decision-A 状态），最终交付 `1dd4d206` 为 `90214ace…`，二者仅两处注释不同、指令逐字节一致。**已闭合，无需新 Issue。**
7. **ARCH-DUP-1/2（无消费面）**：`ApiError.headerRequestId` 已删除（`api.ts:242-265` 改为函数内局部变量，仅保留 mismatch warn）；`getWithMeta` 保留并标注 `DOCUMENTED FORWARD SURFACE`（`api.ts:411-425`），`docs/contracts/observability.md` 已记录。**已按推荐方案处置。**

---

## 7. 本裁决员实际执行的检查（可复核）

> 除非特别注明，均在 `/home/hoo/Source/exam-gap-worktrees/integration-final` 或本证据目录执行。数据库测试使用 `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=1`，未触碰 `exam` 开发库。

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | `git status --short` / `git rev-parse HEAD`（integration-final） | `M apps/api/src/routes/proctorMonitoring.crossOrg.test.ts`、`M apps/e2e/e2e/investigation-ui-acceptance.spec.ts`；HEAD `a84b416a…` |
| 2 | `git archive a84b416a \| tar -x -C /tmp/final-adj-a84`（+ node_modules 软链） | 纯净 exact-SHA 树；committed `crossOrg.test.ts:229` 为 `req-cross-org-${randomUUID()}`，E2E `:765` 为 `req-forged-prt-0001` |
| 3 | 在 `/tmp/final-adj-a84/apps/api`：`TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=1 ./node_modules/.bin/vitest run src/routes/proctorMonitoring.crossOrg.test.ts` | **1 failed \| 6 passed**；`expected undefined to be 'req-cross-org-…'` @ `crossOrg.test.ts:285` |
| 4 | 在 `integration-final/apps/api`：同命令（工作树含未提交修正） | **7 passed** |
| 5 | `gh pr view 922/923/924/926 --json headRefOid,state,mergeStateStatus` | heads 与冻结事实一致；#923 `UNSTABLE`，其余 `CLEAN` |
| 6 | `gh pr checks 922/923/924/926` | #922/#924/#926 全 pass；**#923 E2E shard 1 fail**，其余 pass |
| 7 | `gh api repos/jnhu76/exam/actions/jobs/128847373789/logs` | M3 `Expected substring: "req-forged-prt-0001"` @ `:844`；另有 `rich-content-overflow:568` 失败（未归因） |
| 8 | `git branch -r --contains a84b416a` | 空（集成 SHA 无远端承载） |
| 9 | `git log --all -S "00000000-0000-4000-8000-000000000bad"` | 空（UUID 形状 forged id 不在任何 commit） |
| 10 | `git diff --stat 5140c3dd..HEAD -- apps/api/src/routes/attempts.candidate.ts packages/exam-engine packages/db packages/contracts/src/attempt.ts apps/web/src/hooks apps/web/src/exam` | 空（保存协议权威路径未动） |
| 11 | `git grep -n "postWithMeta" HEAD -- apps/web/src/pages/exam/TakeExamPage.tsx` | 仅 `:898` 一个调用点（另 `:893` 注释） |
| 12 | `git grep -n "setSaveRejectionRequestId" HEAD -- TakeExamPage.tsx` | `:423` 声明 / `:737` 路由重置 / `:922` accepted 清除 / `:952` STALE 清除 / `:972` 拒绝写入 |
| 13 | `grep -rn "headerRequestId" apps/web/src`（排除 test） | 仅 `api.ts:242/245/246/265` 函数内局部变量与 warn payload，无属性；`getWithMeta` 仅 `api.ts:411-425` 定义/注释 |
| 14 | `apps/web`：`./node_modules/.bin/vitest run src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx src/lib/api.test.ts` | **2 files / 54 tests passed**（含新增 2 条心跳/断连负例，共 13 例） |
| 15 | `apps/api`：`./node_modules/.bin/vitest run src/nginxWebConf.test.ts` | **7 passed**（含 80 端口配方 + compose healthcheck pin） |
| 16 | `apps/api`：`TEST_DB_ISOLATION=worker-database … ./node_modules/.bin/vitest run src/routes/attempts/requestIdSaveRejection.test.ts` | **2 passed**（真实 PG；header == WARN reqId、body 无 requestId） |
| 17 | `apps/api`：`… vitest run src/plugins/clientEventRetention.contract.test.ts` | **8 passed**（真实 PG 18.4；含启动补偿/失败隔离/恢复/并发/shutdown） |
| 18 | `apps/api`：`… vitest run src/routes/proctorMonitoring.test.ts -t "LEGACY"` | **1 passed / 15 skipped** |
| 19 | `apps/api`：`./node_modules/.bin/vitest run src/lib/proctorMonitoringService.test.ts` | **21 passed**（含 UUID 形状 gate） |
| 20 | 归档 nginx：`cat runs/*/access.log \| grep -c EXAMAUDIT`；逐目录 error grep；crit 行数；warn s09 | access **0**；24 个运行目录；S02–S07 error 根因全命中；crit 非 notice **0**；warn S09 泄露 1 行 |
| 21 | `python3 -I` 读 `raw/perf-ab/analysis.json` / `micro-api-wrapper.json` / `micro-projection.json` / `micro-react-state.json` | `httperr` ratioBA **1.2355**；postWithMeta **+162.7ns/2.95%**；projection **397.9~520.2ns**；React **5994→7978ns**；protection receipts≡accepted（11316/11316、11534/11534）、successTelemetryWrites 0 |
| 22 | `sha256sum raw/saveanswer-e2e/*` | 与 `raw/saveanswer-e2e/README.md` 内列校验和逐项一致 |
| 23 | `grep -n "logging\|max-size\|max-file\|log-driver" docker-compose.yml docker-compose.dev.yml` | 零命中（exit 1） |
| 24 | `git -C s0-evidence status --short -- docs/research/exam-secure-observability-remediation` | 07/08/09/10、BASELINE、FINAL-OWNER-DECISIONS、SAVEANSWER-*、TASK-CONTRACT、raw/nginx-fault-injection、raw/perf-ab、raw/saveanswer-e2e、四份 review-* 均 untracked；SHA256SUMS 为 `M` |

**未执行（如实声明，不冒充 PASS）**：

- 完整 `pnpm verify`、完整 `pnpm test`、`bash scripts/e2e/run.sh`（全量真实浏览器 E2E）、nginx live-container 故障注入、生产构建逐字节一致性比对。
- exact-SHA 的 E2E M3 未由本裁决员重跑（需完整 docker 栈 + Playwright）；其失败由 #923 CI 日志 + committed 断言 + gate 行为证明。
- 部署侧日志驱动/轮转/权限/journald/收集器/HTTPS 激活、备份保留/加密/权限：无访问权，未验证，维持 UNKNOWN/NOT_VERIFIED。

---

## 8. 结论可信度

| 结论 | 可信度 | 理由 |
| --- | --- | --- |
| exact SHA `a84b416a` 的 crossOrg 测试红 | **高** | 在 `git archive` 纯净树实跑，1 failed / 6 passed；工作树 7/7 对照；断言行号与 fixture 行号可直接读取 |
| 两处夹具修复未提交、无 commit 包含 | **高** | `git status` + `git log --all -S` + PR head 查询三重证据 |
| #923 CI E2E shard 1 红 | **高** | `gh pr checks` + job 日志直接下载 |
| SaveAnswer 六类语义未回归 | **高** | 保护路径 diff 为空；协议评审 + 定向 web/API 测试实跑 |
| 30 天 retention 8/8 | **高** | 本裁决员在真实 PG 18.4 上实跑 |
| 性能 NOT_DETECTED | **中高** | 归档原始数据逐项核对；未复跑 A/B；确定性指标 spread≈0% |
| 浏览器 M4/M5 证据 | **中高** | 归档截图/日志/同一 UUID 三处互证；本裁决员未重跑浏览器 |
| 部署/备份 UNKNOWN | **确定其为 UNKNOWN** | 无部署访问权；文档未虚构 VERIFIED |

---

## 9. 按契约 §10 顺序的判定清单

```text
BEGIN_EXAM_FINAL_OBSERVABILITY_CLOSURE

MASTER_SHA = 5140c3dd0f9dbde1bdad8f5b757161f3ed96945d
INTEGRATION_SHA = a84b416a0c58cd73a7143eef274ef2c68f0f4fcc

PR_922_HEAD = 7243aa5c5ab46155d914907b6ff30acf9b51cbe4
PR_923_HEAD = d3580f3e46e2292317dfe831efd982d475d163e8
PR_924_HEAD = e81b76a17212c8e321a83f1b0522e54a049326f1
PR_926_HEAD = 1dd4d2067fd81143268aaeea56d2e35ef715a6f3

SAVEANSWER_REAL_CLIENT_CONSUMPTION = PASS
SAVEANSWER_200_REJECTION_CORRELATION = PASS
SAVEANSWER_HTTP_ERROR_CORRELATION = PASS
SAVEANSWER_SUCCESS_SEMANTICS = PASS
SAVEANSWER_STALE_RECONCILIATION = PASS
SAVEANSWER_CONCURRENT_SCOPE_ISOLATION = PASS
SAVEANSWER_UNKNOWN_SEMANTICS = PASS

REQUEST_ID_SERVER_AUTHORITY = PASS
REQUEST_ID_AUTHORIZATION_BOUNDARY = PASS

NGINX_ACCESS_LOG_PRIVACY = PASS
NGINX_ERROR_LOG_DIAGNOSTIC = PASS
NGINX_ERROR_LOG_LEVEL = error
NGINX_ERROR_LOG_RAW_URL_RISK = ACCEPTED
INFRA_LOG_ACCESS = NOT_VERIFIED

RETENTION_30D_CONTRACT = PASS
RETENTION_STARTUP_CONVERGENCE = PASS
RETENTION_FAILURE_RECOVERY = PASS
RETENTION_TENANT_ISOLATION = PASS
LEGACY_ROUTE_READ_PRIVACY = PASS
HISTORICAL_AT_REST_RISK = ACCEPTED
BACKUP_RETENTION = UNKNOWN

SECURITY_SUBAGENT_REVIEW = PASS
PROTOCOL_SUBAGENT_REVIEW = PASS
OPS_SUBAGENT_REVIEW = CONDITIONAL
ARCHITECTURE_SUBAGENT_REVIEW = PASS
SUBAGENT_FINDINGS_UNRESOLVED = 5

PERFORMANCE_VERDICT = PASS
FULL_INTEGRATION_CI = FAIL

GITHUB_WRITEBACK = NOT_RUN_BY_ADJUDICATOR（本裁决员未改 PR/Issue；主执行方已有 #922/#923/#924/#926 回写记录）
PR_MERGE_READINESS = BLOCKED
MERGE_STATUS = NOT_MERGED
RELEASE_STATUS = NOT_RELEASED

REMAINING_RISKS = 部署侧日志驱动/轮转/权限/journald/收集器/HTTPS 激活 UNKNOWN；compose 无 logging 上限；备份保留/加密/权限 UNKNOWN；nginx error 级原始 URL 泄露为 Owner Decision A 接受；历史 client_events.route 原始字节在线层 at-rest（读取端投影 + 30 天老化）；#923 另一条 rich-content-overflow 失败未归因
BLOCKERS = exact SHA a84b416a clean tree crossOrg 1 failed|6 passed；committed E2E M3 夹具 req-forged-prt-0001 与新 gate 冲突、#923 CI E2E shard 1 红；两处夹具修复仅存于未提交工作树；集成 SHA 无远端组合 CI；证据文档/raw 未入库

END_EXAM_FINAL_OBSERVABILITY_CLOSURE
```

> 注：上方 `SUBAGENT_FINDINGS_UNRESOLVED = 5` 的逐条分类见 §2；`FULL_INTEGRATION_CI = FAIL` 不代表性能回归（性能为 PASS/NOT_DETECTED），而是指 exact SHA 的测试与 CI 组合门禁失败。

---

## 10. 中文解释（契约 §10 后 1..10）

1. **SaveAnswer 的真实客户端消费链路是否完整**：完整。`TakeExamPage.tsx:898` 是唯一保存调用点，且使用 `api.postWithMeta<SaveAnswerResponseDTO>`；`api.ts` 的 `requestWithMeta` 从真实响应头读 `x-request-id` 并放入 `meta.requestId`；200 拒绝时 `TakeExamPage.tsx:967-987` 把 `meta.requestId` 写入 `saveRejectionRequestId` 并在 Alert 显示“请求编号”。M4 真实浏览器运行中，考生 UI 的编号、服务器 Pino WARN 的 `reqId`、管理员时间线的 client-claimed 值三处是同一个 UUID（`e0289b97-f55e-4ee6-8864-6472faf51116`）。

2. **实际 HTTP 200 业务拒绝是否能精确定位服务器请求**：能。真实 PostgreSQL 的 `requestIdSaveRejection.test.ts` 2/2 通过，断言 200 拒绝响应头 `x-request-id` 等于该请求 WARN `Answer save rejected` 行的 `reqId`，且响应体不携带 requestId；M4 用真实服务端判定 `CONFLICTING_PAYLOAD` 复现了同一 UUID 的三处互证。注意：这是“精确关联”，不是“requestId 成为身份或授权凭据”。

3. **是否保持全部保存、重试和恢复语义**：保持。`attempts.candidate.ts`、`packages/exam-engine`、`packages/db`、`packages/contracts/src/attempt.ts`、`apps/web/src/hooks`、`apps/web/src/exam` 与 master 的 diff 为空；`clientSeq/baseVersion` 计算未动；STALE 协调分支零失败遥测；transport 失败不伪造 id；旧 attempt 迟到响应有 `scopeGenAtSchedule`/`saveStale()` 守卫；新增的 2 条心跳×拒绝 id 负例与原有 11 例共 13 例、web 54/54 实跑通过。exact SHA 的 crossOrg 红是测试夹具问题，不是保存语义回归。

4. **nginx 原始错误日志提供了哪些新增诊断能力**：error 级恢复了上游故障与解析故障的原生根因信息——S02 解析失败（`could not be resolved (2: Server failure)`）、S03 连接拒绝（`connect() failed (111: Connection refused)`）、S04 超时（`upstream timed out (110)`）、S05 上游提前关闭、S06 resolver 超时、S07 不存在主机；crit 级下这些场景全部静默、无法定位根因。access log 仍只记 `method + 固定路由类别 + status + bytes + rt + up + reqid`，24 次运行 canary 0 命中。

5. **原始 error log 的敏感 URL 风险如何被接受和限制**：Owner Decision A 明确接受 error 级可能包含完整请求行（7 个上游/解析故障场景实测命中，部分还含 `upstream:` URL 的二次泄露；warn 级还会经 `using uninitialized "exam_route"` 泄露 malformed 请求行），并与 access-log 隐私分开声明、禁止合并成“所有 nginx 日志已脱敏”。限制手段是：不升 warn、不退回 crit；读取主体限于本地管理员/排障角色；排障材料先脱敏；建议配置日志轮转上限。但真实部署的 daemon 驱动/轮转/宿主权限/journald/收集器仍未验证，故 `INFRA_LOG_ACCESS = NOT_VERIFIED`；compose 也没有 `logging:` 上限，需 Owner 决定。

6. **30 天清理机制的实际证明**：不是只看代码。`clientEventRetention.contract.test.ts` 在真实 PostgreSQL 18.4 上以可控时钟、BEFORE DELETE trigger 故障注入、双物理连接并发、advisory-lock 门控 shutdown 实跑 8/8 通过，覆盖 29 天保留、超过 30 天删除、恰好 cutoff 保留、多组织、单组织失败隔离、下一轮恢复、重启补偿、空清理、启动/完成/失败日志与指标、并发写与清理、shutdown 等待在飞 pass。必须同时说明：到达可删除年龄不等于已从所有介质删除；最坏删除延迟约一个 sweep 间隔（停机时再加停机时长 + 启动 pass）。

7. **历史数据库和备份的剩余风险**：在线层 `client_events.route` 的 pre-#864 原始字节仍可能 at-rest（真实 dump 证明），读取端强制投影为安全模板或 null（LEGACY 用例 1 passed），过期行由 30 天机制删除；但备份层 `pg_dump -Fc` 的保留期、加密、文件权限、离线副本全部 UNKNOWN，`pg_restore` 会让 dump 时点未过期的旧行重新 at-rest，读取端仍投影但字节仍在。`HISTORICAL_AT_REST_RISK = ACCEPTED`（Decision B），`BACKUP_RETENTION = UNKNOWN`；文档没有隐藏这一事实。

8. **四个 Subagent 分别发现、修复了什么**：Security 发现 3 个 P3 + 1 个 INFO：07 号文档受测对象标注歧义（已补注）、proctor timeline 的 client-claimed `requestId` 无形状 gate（已由 `d3580f3e` 加 UUID 形状 gate + 7 条单测）、心跳/断连×拒绝 id 缺直接负例（已由 `e81b76a1` 补 2 例）、历史 at-rest/备份边界记录（as-designed）。Protocol 发现 4 个 P3：跨题成功清除 rejection alert、断连隐藏 alert（两者均为 master 既有语义，列 follow-up）、`getWithMeta`/`headerRequestId` 无消费面（已删除 header 属性、getWithMeta 文档化留痕）、心跳交错缺测试（已补）。Ops 发现 2 个 P2 + 2 个 P3：Mode B 缺 80 端口处置 + healthcheck 冲突（已由 `1dd4d206` 修）、compose 无日志上限（未决）、malformed URI error 级静默（as-designed，已接受）。Architecture 发现 1 个 P2 + 4 个 P3：性能报告 4 组数字与归档不符（已在 10 号文档勘误）、两个未消费 API 面（已处置）、集成 SHA 无组合 CI（未完成）、证据未入库（未完成）。**F2 的代码与单测已修复，但 exact SHA 的夹具未提交，复审未闭合（5 条未解决项）。**

9. **修改后的性能和运行成本**：`PERFORMANCE_VERDICT = PASS`（原判定 NOT_DETECTED）。保护主目标 SaveAnswer 的吞吐/时延/CPU/xact/写入计数均在噪声带内，`receipts ≡ accepted:true` 逐笔相等（11316/11316、11534/11534），`NEW_SUCCESS_TELEMETRY_WRITES = 0`、`NEW_REQUEST_ID_DB_WRITES = 0`、`SAVEANSWER_DOMAIN_WRITES = UNCHANGED`。确定性成本已量化、不宣称零成本：每响应 +53B `x-request-id` 头、dev 默认 origin 下另 +~136B CORS 头、404 微路径 CPU +36µs/req（6/6 同向）、route 投影 +397.9~520.2ns/事件、`postWithMeta` +162.7ns/请求、1 个额外 React 状态槽 +1984ns/render 且 0 额外 re-render；这些在 DB 绑定路径（≥7ms/req）低于本机分辨率。确定性收益：Pino 每请求 −4.9%~−13.7% 字节、nginx access log −36%~−57% 且 query/深链秘密不再入档、reject 场景 CPU 6/6 更省。注意调度摘要中的 +48.5ns 等旧数字已被归档数据勘误为 +162.7ns 等，方向不变。

10. **四个 PR 是否可以按照既定顺序人工合并**：**当前不可以（BLOCKED）**。产品语义与安全修复本身没有发现 P0/P1 回归，但 exact SHA `a84b416a` 的已提交 crossOrg 测试自身红（1 failed / 6 passed，本裁决员在纯净树实跑），committed E2E M3 夹具 `req-forged-prt-0001` 与 #923 的 UUID 形状 gate 冲突并导致 #923 CI E2E shard 1 红；使测试转绿的两处夹具修复只存在于 integration worktree 的未提交改动，任何 commit 都不含它们；集成 SHA 也不在任何远端分支，组合门禁没有同一 SHA 的归档原始日志；证据文档仍未入库。正确顺序：先提交两处夹具修正到相应 PR 分支 → push 并让 #923/#924 CI 绿 → 按 #922→#923→#924→#926 重新生成 clean 的集成 SHA → 重跑并归档 crossOrg 7/7、E2E M3、`pnpm verify`、完整 `pnpm e2e` → 由独立 Subagent 对新 SHA 复审 F2 → 由 #922 收口提交入库全部证据 → 才可重新评估 `FINAL_REMEDIATION_MERGE_READY` 并交人工合并。

---

## 11. 证据校验和

`SHA256SUMS` 已由本裁决员**重新生成**（唯一最终写入者）：覆盖本目录除 `SHA256SUMS` 自身以外的全部常规文件（含 §9 的 12 个可哈希交付物、四份 review、07/08/09/10、`FINAL-OWNER-DECISIONS.md`、`SAVEANSWER-*.md`、`raw/nginx-fault-injection/`、`raw/perf-ab/`、`raw/saveanswer-e2e/` 及本文件）。`SHA256SUMS` 自身无法自哈希，故不列入自身清单；这是既有格式与工具约束，不是遗漏。生成后自证：

```bash
cd /home/hoo/Source/exam-gap-worktrees/s0-evidence/docs/research/exam-secure-observability-remediation
sha256sum -c SHA256SUMS
# 期望：全部 OK（316+ 项，具体计数见本次生成输出）
```
