# BASELINE_AND_OWNERSHIP

- 阶段：生产集成收口 · 阶段一（建立唯一可信基线）
- 生成者：基线管理员（workflow subagent）
- 生成时间：2026-11-09（命令执行窗口约 12:31–12:45 +0800）
- 任务书：`/home/hoo/Source/exam/.tmp/production-closure/SPEC.md`
  （从 `/home/hoo/.zcode/tmp/prompt-attachments/remote-server-a9db0a46-1850-4618-9610-802b3a763d76-home-hoo-Source-exam-59a40626/b9ee74e1-3cac-4696-b633-b135adc6ff8d/01-pasted-text-20261109-120840-be1470dd.txt` 复制；`.tmp/` 为 gitignored，不作为交付依据）
- 本文件位置：`integration/production-closure-20261109` worktree 的
  `docs/research/exam-production-integration-closure/BASELINE_AND_OWNERSHIP.md`
  （新建目录、未跟踪、未 commit）
- 调查性质：只读盘点。未修改产品代码，未 commit / push / merge，未删除任何 worktree 或未提交证据。
- 证据纪律：**dirty worktree 的结果不得冒充已提交代码的结果。** 本文件区分
  「PR/commit/CI 记录的事实」与「本次基线实际执行的检查」；未执行的检查明确标为 NOT_RUN。

---

## 0. 关键结论（先看这里）

1. `master` = `origin/master` = `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d`；根工作树 tracked 文件干净，仅有一个未跟踪目录 `test-results/`。
2. 四个 PR 均为 **Draft / OPEN / 无正式 review / 无 reviewDecision**；本地分支与远端 head 完全一致。
3. CI：**#922、#924、#926 的 8 个 check 全部 pass**；**#923 的 E2E (shard 1/2) fail**，其余 7 个 check pass。
   #923 的失败包含两个用例：一个确定性 UUID 夹具不匹配，一个已登记几何 flake（#878 / OBS-2026-11-03-001）。
4. 六组 PR 两两 `git merge-tree --write-tree` 均 exit 0，**无文本冲突**；唯一文件交集是 #924 ∩ #926 =
   `apps/api/src/server.ts`、`docs/contracts/observability.md`，且可自动合并。
5. **#923 与 #924 存在真实语义依赖**：`#923` 在 proctor metadata 投影中对 `requestId` 增加 UUID 形状 gate；
   `#924` 新增的跨组织测试与 E2E M3 仍使用非 UUID 形状的伪造 id，组合后会丢失正控制/断言。
   该夹具修复目前**只存在于本地未推送的 `final-closure-integration` 分支**（commit `3e97c497`），
   不在任何 PR 分支、不在 `origin`。
6. 第二个集成修复（`rich-content-overflow:568` 的 KaTeX 稳定态等待）同样只存在于
   `final-closure-integration`（commit `1f644725`），不在任何 PR 分支、不在 `origin`。
7. 未提交证据风险最高的是 **`s0-evidence` worktree**：`SHA256SUMS` 已修改（+255 行），
   256 个 dirty 条目（1 个 modified + 255 个 untracked）/ 318 个文件 / 约 2.8 MB，
   包含 07–10 交付物与多份 review/raw 证据。
   **任何 worktree remove / clean / reset 都会丢失这些证据。**
8. 基线期间检测到**并发代理活动**：`work/scratch` 分支在 12:32:57 由 `fd8e12a3` 前进到
   `aeea38be`（#927 相关提交）。该 worktree 不属于本轮四个 PR，不得抢占或清理。
9. `master` 没有任何 branch protection / required status checks（仓库 `protected: false`），
   因此「PR 全绿」本身不构成合并门禁；仍需满足任务书第 8 节与仓库 AGENTS.md 的人工门禁。
10. 本文件所在的新 worktree 已按任务书创建并验证：
    `/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`，
    分支 `integration/production-closure-20261109`，HEAD = `5140c3dd...`，工作树干净。

---

## 1. 仓库与 master 基线

| 项目 | 值 | 证据 |
| --- | --- | --- |
| 仓库 | `/home/hoo/Source/exam` | 环境给定工作目录 |
| 当前分支 | `master` | `git status --short --branch` |
| `master` HEAD | `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d` | `git rev-parse master` |
| `origin/master` | `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d` | `git rev-parse origin/master` |
| 远端同步 | `git fetch origin --prune` exit 0；master 与 origin/master 相等 | 重跑确认 |
| 根工作树 tracked 修改 | 无 | `git status --short` 仅 `?? test-results/` |
| 根工作树未跟踪 | `test-results/`（**未被 .gitignore 忽略**） | `git status --short`；`git check-ignore` 无输出 |
| `test-results/.last-run.json` | `{"status":"failed","failedTests":[]}`（45 B） | `cat` 该文件 |
| `git stash` | 空 | `git stash list` |
| Git 版本 | 2.53.0 | `git --version` |

### 1.1 master 的 CI 记录

- `gh api repos/jnhu76/exam/commits/5140c3dd0f9dbde1bdad8f5b757161f3ed96945d/check-runs` 返回**空列表**。
- 因此：**UNKNOWN** —— 无法从 check-runs 证明该 merge commit 上是否跑过 CI、是否通过；
  不得把任何 PR head 的绿色 CI 当作 master `5140c3dd` 的 CI 结果。

### 1.2 分支保护 / required checks

- `gh api repos/jnhu76/exam/branches/master` 返回：
  `"protected": false`，`protection.enabled = false`，`required_status_checks.checks = []`，
  `contexts = []`，`enforcement_level = "off"`。
- `gh api repos/jnhu76/exam/branches/master/protection` 返回 **403**
  （`Upgrade to GitHub Pro or make this repository public to enable this feature.`）。
- 结论：仓库当前**没有** GitHub 层面的 required checks / branch protection。
  任务书第 8.1 节第 12 条「GitHub branch protection 满足」在事实层面等同于「不存在额外保护门禁」，
  但仓库 AGENTS.md 第 7 节的人工门禁（merge 需当场人类确认）仍然有效。

---

## 2. 四个 PR 的精确 HEAD / branch / CI

### 2.1 精确 HEAD 与分支

| PR | 标题 | head branch | base | head SHA | Draft | mergeable | mergeStateStatus | reviewDecision | 领先 master |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #922 | `docs(research): secure-observability audit evidence archive` | `docs/secure-observability-evidence-archive` | `master` | `7243aa5c5ab46155d914907b6ff30acf9b51cbe4` | true | MERGEABLE | CLEAN | `""` | 4 commits |
| #923 | `fix(client-events): closed route-template projection (#864)` | `fix/security-client-event-route-projection` | `master` | `d3580f3e46e2292317dfe831efd982d475d163e8` | true | MERGEABLE | **UNSTABLE** | `""` | 5 commits |
| #924 | `feat(#865): server-owned x-request-id response header (scope 865-C)` | `feat/http-request-id-response-header` | `master` | `e81b76a17212c8e321a83f1b0522e54a049326f1` | true | MERGEABLE | CLEAN | `""` | 6 commits |
| #926 | `fix(#925): stop persisting raw client URLs in pino request lines and the nginx access log` | `fix/security-http-access-log-privacy` | `master` | `1dd4d2067fd81143268aaeea56d2e35ef715a6f3` | true | MERGEABLE | CLEAN | `""` | 6 commits |

- 四个 PR 的 merge-base 都是 `5140c3dd...`（`git merge-base origin/master <head>`），
  即 **0 behind / 4–6 ahead**。
- `git ls-remote origin --heads` 确认四个远端分支 SHA 与上表完全一致。
- 四个 PR 均无 review（`gh api .../pulls/<n>/reviews` 为空），无 review request。
- CodeRabbit 在四个 PR 上均为 `skipping`。

### 2.2 `gh pr checks` 结果

四个 PR 的 check 集合相同：`Static checks`、`Build`、`Web coverage`、`API coverage`、
`Package coverage`、`Production transport regression`、`E2E (shard 1/2)`、`E2E (shard 2/2)`。

| PR | 结果 | Workflow run |
| --- | --- | --- |
| #922 | 8/8 pass（CodeRabbit skipped） | `42447373825` |
| #923 | **E2E (shard 1/2) fail**；其余 7 个 pass | `42518523050` |
| #924 | 8/8 pass（CodeRabbit skipped） | `42517384651` |
| #926 | 8/8 pass（CodeRabbit skipped） | `42517918387` |

`gh api repos/jnhu76/exam/commits/<head>/check-runs` 逐 SHA 复查结果与 `gh pr checks` 一致，
确认这些 check 附着在上表 head SHA 上。

### 2.3 #923 E2E shard 1 失败详情（真实日志）

- Job URL：`https://github.com/jnhu76/exam/actions/runs/42518523050/job/128847373789`
- 获取方式：`gh api repos/jnhu76/exam/actions/jobs/128847373789/logs > /tmp/pr923-e2e-shard1.log`
- 日志结论：`2 failed`，两个失败用例分别如下。

1. **确定性契约失败（不是 flake）**
   - 用例：`[chromium] › e2e/investigation-ui-acceptance.spec.ts:738:3 › investigation UI browser acceptance (#856) › M3: save-fault banner, client-claimed telemetry labels, and monitoring dialog source badges`
   - 日志：`Expected substring: "req-forged-prt-0001"`
   - 位置：`apps/e2e/e2e/investigation-ui-acceptance.spec.ts:844:30`
   - 原因（as-built）：#923 在 `apps/api/src/lib/proctorMonitoringService.ts:211` 新增
     `REQUEST_ID_UUID_SHAPE` gate，只投影纯 UUID 形状的 claim；master/#923 分支上的 E2E 夹具
     `apps/e2e/e2e/investigation-ui-acceptance.spec.ts:765` 仍是 `"req-forged-prt-0001"`，
     被 gate 丢弃，导致 `expect(clientDialogText).toContain(forgedRequestId)` 失败。
   - 该失败在 #923 自己的 head 上即可复现，属于 #923 引入 gate 后未同步旧夹具的确定性缺口。

2. **已登记几何 flake（OPEN #878 / OBS-2026-11-03-001）**
   - 用例：`[chromium] › e2e/rich-content-overflow.spec.ts:528:3 › rich-content overflow contract › candidate take → rich answer → graded result: local scroll, keyboard, stable geometry`
   - 日志断言：`> 568 | expect(promptScrollAfter).toBeGreaterThan(promptScrollBefore);`
   - 位置：`apps/e2e/e2e/rich-content-overflow.spec.ts:568:31`
   - `docs/standards/test-flakes.md:3321` 已登记 `OBS-2026-11-03-001`，GitHub Issue **#878 OPEN**：
     `[CI][Flake] rich-content-overflow geometry: fixed 150ms wait races Chrome arrow-key scroll (scrollLeft 0 under 2-shard load)`。
   - 结论：这是真实 CI 中的非确定性失败，不能与上面的确定性夹具问题混为一谈，也不能用「历史 flake」跳过。

### 2.4 其他 PR 的 CI 事实

- #922：全部 8 个 check pass；其 PR body 声称 `SHA256SUMS` 覆盖 62 个文件且
  `sha256sum -c` 可复现（commit `6ff36aa1` 的 message 称 62/62 OK）。
  **本次基线未独立重跑该验证**（见 §12 UNKNOWN）。
- #924：全部 8 个 check pass。PR body 明确记录 `429` 在测试模式下限流关闭，状态矩阵中保持 `NOT_TESTED`。
- #926：全部 8 个 check pass。PR body 明确记录 `INFRA_LOG_ACCESS = NOT_VERIFIED`（第三方 collector /
  日志文件权限），以及 nginx error log 可能携带敏感 URL 的已接受残余风险（Owner Decision A）。

---

## 3. 每个变更的代码所有权

### 3.1 #922 — 安全审计证据归档（docs-only）

- 所有权范围：`docs/research/exam-secure-observability-remediation/**`（63 个 docs 文件）
  与 `.prettierignore`（新增 3 行，保护 evidence 字节不被格式化）；共 64 个变更文件。
  `SHA256SUMS` 覆盖 62 个文件（PR body / commit `6ff36aa1` 自述 62/62 OK）。
- 文件证据：`gh pr view 922 --json files`；`.prettierignore` diff。
- 无运行时代码、无 schema、无 API/contract 变更。
- 权威边界：这是历史审计证据归档，不是运行时事实 authority；不得用其覆盖当前代码/ADR/契约。

### 3.2 #923 — client_events route 封闭模板投影（#864 / 864-B）

- 单一词汇表权威：`packages/contracts/src/clientEventRoute.ts:34` `SPA_ROUTE_TEMPLATES`
  （49 个模板，镜像 `apps/web` 的 `App.tsx` 路由声明；drift guard
  `apps/web/src/lib/spaRouteTemplateVocabulary.test.ts:163` 钉住两者相等）。
- 投影实现：`packages/contracts/src/clientEventRoute.ts:142` `projectClientEventRoute`，
  输出必须 ∈ `SPA_ROUTE_TEMPLATES ∪ {null}`；未知路由 / 非 http(s) scheme / malformed URL 全部 fail-closed。
- 写入边界：`apps/api/src/routes/clientEvents.ts`（ingest 时投影）。
- 读取边界：`apps/api/src/lib/proctorMonitoringService.ts`（proctor timeline 读时对 legacy 行再投影；
  无数据迁移，满足 #875 的 immutability 先例）。
- 安全不变量：`docs/architecture/exam-system/security-model.md:257` `INV-CE-005`
  与 `:302` §15.7（仅存在于 #923 head，master 尚无）。
- 存储契约：`route` 仍为 `string | null`，无 schema/wire/migration 变化。
- **附加的 requestId 形状 gate（跨 PR 关键点）**：
  `apps/api/src/lib/proctorMonitoringService.ts:211-233` 在 `projectSafeMetadata` 中对
  `requestId` 字段只保留匹配
  `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` 的字符串；
  其他字符串/非字符串直接丢弃。该 gate 是「限制内容注入」，不是身份核验。

### 3.3 #924 — 服务端拥有的 `x-request-id` 响应头 + SaveAnswer 消费（#865 / 865-C）

- 服务端权威：`apps/api/src/server.ts:109-113`（master 已有）`genReqId: () => randomUUID()`、
  `requestIdHeader: false`；#924 不改变 id 生成方式，只新增响应头载体。
- 根作用域 hook：`apps/api/src/plugins/requestIdHeader.ts:24` `setupRequestIdHeader`，
  在 `apps/api/src/server.ts:131` 注册；`onRequest` 设置 `x-request-id: request.id`，
  使用 done-callback 形式（sync-void hook 会卡住 Fastify 生命周期，文件内有 PROTOCOL 注释）。
- CORS：`apps/api/src/plugins/cors.ts:31` `exposedHeaders: ["x-request-id"]`，仅对配置的 web origin。
- Web 客户端：`apps/web/src/lib/api.ts:306` `requestWithMeta` 为唯一核心；
  `request<T>` 行为不变；新增 opt-in `getWithMeta` / `postWithMeta`（`api.ts:421/426`）。
- SaveAnswer 消费：`apps/web/src/pages/exam/TakeExamPage.tsx:423` 新增 `saveRejectionRequestId` state；
  `:898` 改用 `api.postWithMeta`；`:1585` 在业务拒绝 Alert 中显示请求编号；
  同点写入 telemetry `answer_autosave_failed` 的 allowlisted `requestId`（client-claimed）。
- 文档所有权：`docs/contracts/observability.md`（第四载体）、`docs/contracts/api-contract.md`
  （Standard response headers）、`docs/operations/save-failure-evidence.md`、
  `docs/adr/ADR-025-http-request-correlation-identity.md`（dated addendum，非 supersession）、
  `docs/adr/README.md`（索引标注 amended）。
- 明确边界（PR body/代码注释）：`getWithMeta` 当前无生产调用方（documented forward surface）；
  header 在连接被销毁、socket framing 失败、Node timeout、`FST_ERR_BAD_URL` 等路径不可携带；
  客户端收到的 header 值不是凭据，也不能证明业务保存成功。

### 3.4 #926 — Pino / nginx 原始 URL 隐私（#925）

- Pino 权威：`apps/api/src/lib/logRedaction.ts:189` `routeTemplateOf`、
  `:214` `serializeReqForLog`；`apps/api/src/server.ts:126` 生产 logger 接入 req serializer。
- 19 处 authz/错误日志改用 `routeTemplateOf`：`apps/api/src/authz/*Capability.ts`、
  `apps/api/src/routes/scores.ts`、`apps/api/src/plugins/errors.ts`（行号见 §14 的检索输出）。
- root 404 策略：`apps/api/src/plugins/rootNotFoundBoundary.ts:30`，由
  `apps/api/src/server.ts:167-178` 根据是否存在 `public/` 选择静态 SPA fallback 或 API-only JSON 边界
  （二者都不记录原始 URL）。
- nginx：`deploy/nginx/web.conf:49` 显式 `log_format exam_privacy`，禁止 `$request` /
  `$request_uri` / 原始 `$uri` / Referer；`error_log` 按 Owner Decision A 保持 `error` 级以保留故障诊断，
  并明确接受其可能携带完整请求行的残余风险。
- 部署：`docker-compose.yml` healthcheck 改为 `http://127.0.0.1:80/healthz`（HTTPS 激活配方对该路径
  豁免 80→443 重定向）。
- 文档所有权：`docs/contracts/observability.md`、`docs/deployment/README.md`、`docs/operations/README.md`。

---

## 4. PR 之间的依赖

### 4.1 合并顺序依赖（任务书规定）

`#922 → #923 → #924 → #926`。四个 PR 都从 `5140c3dd` 分出；本地 `final-closure-integration`
分支已经按此顺序做过 4 次 merge（见 §7），可作为历史参考，但**本轮必须在新 worktree 重新建立整合树**。

### 4.2 #923 ↔ #924 的 requestId 夹具跨 PR 依赖（重点）

事实链：

1. #923 head `d3580f3e` 在 `apps/api/src/lib/proctorMonitoringService.ts:211` 引入 UUID 形状 gate。
2. #924 head `e81b76a1` 的跨组织正向控制使用非 UUID 形状的 claim：
   `apps/api/src/routes/proctorMonitoring.crossOrg.test.ts:229`
   `const claimedRequestId = \`req-cross-org-${randomUUID()}\`;`
   - `req-cross-org-<uuid>` 不匹配纯 UUID 正则，因此 #923 的投影会丢弃该 claim；
   - 该测试的正控制（owning org 管理员能看到 requestId）会被 void，组合后失败。
3. #924 head 的 E2E M3 使用非 UUID 形状的伪造 id：
   `apps/e2e/e2e/investigation-ui-acceptance.spec.ts:765`
   `const forgedRequestId = "req-forged-prt-0001";`
   并在 `:844`（telemetry 对话框）与 `:893`（detail 摘要）断言该字符串出现；
   #923 的 gate 会丢弃它，组合后失败。
4. #923 自己的 E2E shard 1 已经因为第 3 条失败（见 §2.3 第 1 项）。因此该依赖不是「只在组合时出现」，
   而是 **#923 单 PR 的 CI 已经红**；#924 单 PR 绿并不代表 #923+#924 绿。
5. 集成修复已存在但只在本地分支：
   - `3e97c497 test(integration): align claimed-requestId fixtures with #923 UUID shape-gate`
     （+5/-1 ×2：crossOrg 改为纯 `randomUUID()`；e2e 改为
     `00000000-0000-4000-8000-000000000bad`）；
   - 该 commit **不在** `origin`、不在 #923/#924 任一分支，只在本地
     `final-closure-integration`（`1f644725` 的父提交）。
6. 任务书 §2.4 建议的归属是「跨组织新增测试由 #924 负责；旧 E2E 夹具兼容由 #923 负责」。
   截至本基线，**两个 PR 分支都还没有承担各自那一半修复**；后续阶段必须决定：
   把对应 hunk 提交回各自 PR 分支，或在一个明确的集成提交中承载并记录归属，不能让修复只停留在
   未推送的本地分支。

### 4.3 其他依赖

- #922 仅文档，不依赖任何运行时 PR；但它是 #923/#924/#925 审计证据的引用来源（PR body 引用 #922）。
- #926 与 #923/#924 无语义依赖；与 #924 共享 `apps/api/src/server.ts` 与
  `docs/contracts/observability.md`，但 `git merge-tree` 自动合并成功（见 §5）。
- #926 的 root 404 策略与 #924 的 header hook 注册在同一 `main()` 初始化序列附近，
  文本不冲突；组合行为（所有响应路径都带 header，且 404/static 不泄露 URL）必须在集成树验证，
  不能仅凭两个 PR 各自绿推断。

---

## 5. 文件修改冲突

### 5.1 精确文件交集

用 `gh pr view <n> --json files` 取得文件清单后 `comm -12`：

| PR 对 | 交集文件 |
| --- | --- |
| #922 × #923 | 无 |
| #922 × #924 | 无 |
| #922 × #926 | 无 |
| #923 × #924 | 无（但存在 §4.2 的语义依赖） |
| #923 × #926 | 无 |
| #924 × #926 | `apps/api/src/server.ts`、`docs/contracts/observability.md` |

文件数：#922 64、#923 12、#924 25、#926 19。

### 5.2 `git merge-tree` 两两合并模拟

命令：`git merge-tree --write-tree --messages <a> <b>`（在 `/home/hoo/Source/exam` 执行）。

| PR 对 | exit | 结果 tree / 备注 |
| --- | --- | --- |
| #922 × #923 | 0 | `ac9dc8a736b438e68560eb1d991d3e043ee3a36c` |
| #922 × #924 | 0 | `b7ed6afb5bd43b920e2fec8b068dc1ea8e369fbc` |
| #922 × #926 | 0 | `3ecd154e8522627ec88ea3f824ba9c59097dbbcc` |
| #923 × #924 | 0 | `8cedaf4e6b29801be1e41ad0817fe34b28a107af` |
| #923 × #926 | 0 | `2b5eb362060e4f5b1e8af719c004be761386ad21` |
| #924 × #926 | 0 | `f52a4629f4f95d75c845e9a2ebe80313d4bd3b34`；输出 `Auto-merging apps/api/src/server.ts`、`Auto-merging docs/contracts/observability.md` |

结论：基线时**无文本合并冲突**。这不排除语义冲突（尤其 §4.2 与 §4.3 的组合行为）。

### 5.3 已识别的潜在组合风险（非文本冲突）

1. `apps/api/src/server.ts`：#924 在 `main()` 前部插入 `setupRequestIdHeader(app)`；
   #926 在同一文件的 logger 配置与 root 404 分支处修改。合并后需验证
   `setupRequestIdHeader` 仍在所有注册之前、root 404/static 布局仍只注册一个 root handler。
2. `docs/contracts/observability.md`：#924 改 requestId 行与 correlation bullet；
   #926 改 path/route 行与新增 #925 bullet。自动合并成功，但文档语义需整体复核
   （header 载体 + route template + 原始 URL 禁止，三者不能互相矛盾）。
3. `apps/api/src/server.requestId.test.ts`：只有 #926 修改；#924 的 wire contract 测试在
   `apps/api/src/routes/requestIdWireContract.test.ts` 等新文件。组合后两套 spawn/断言必须同时通过。
4. `apps/api/src/lib/proctorMonitoringService.ts`：只有 #923 修改；#924 的跨组织测试依赖其 gate 行为（§4.2）。

---

## 6. 已证明的功能与风险

> 说明：本节把「PR/commit/CI 声称的事实」与「本次基线实际验证的事实」分开。
> 本次基线**没有运行** `pnpm test` / `pnpm verify` / `pnpm e2e`，也没有做代码 review 或独立安全审计。
> 因此下列「功能已证明」仅指对应 head SHA 上的 CI/测试记录，不代表集成树或 master 已验证。

### 6.1 #922

- 声称：永久、已脱敏的审计证据归档；`SHA256SUMS` 钉住每个归档字节；
  `.prettierignore` 保护 evidence 完整性；凭据经显式 sanitization gate 排除；
  审计基线 `423f2945`，归档构建于 master `5140c3dd`。
- 已证明：PR head 的全部 8 个 CI check pass；文件清单与 diff 仅 docs + `.prettierignore`。
- 风险：
  - `SHA256SUMS` 的校验是手工步骤，CI 不检查（commit message 自述）；本次未独立重跑。
  - 归档含已明确接受的主机标识/地址类别（commit `e9c8f714` 的 boundary 说明），
    发布/共享前仍需按 README 的 sanitization 边界处理。
  - s0-evidence worktree 中存在**未提交的 07–10 交付物**，与 PR #922 的 00–06 归档不是同一集合（§7.2）。

### 6.2 #923

- 声称：封闭词汇表投影替换 #875 的 pathname-only 投影；写入与读取两个边界都投影；
  legacy 行读时再投影、不迁移；无 schema/wire 变化；每条事件成本 0.83–1.37µs。
- 已证明：除 E2E shard 1 外，其余 7 个 check pass；head diff 与 PR body 一致。
- 风险：
  - **自身 CI 红**（§2.3），且包含确定性缺口；在修复前不能进入集成树。
  - gate 正则是「任意 UUID 形状」，不是严格 UUIDv4 版本位/variant 校验；
    而服务端 `genReqId` 用 `randomUUID()` 生成 v4。读取端兼容历史格式的边界需要按任务书 §2.3
    明确记录（live 值保证 v4；读取投影是否只要求形状；历史 `req-*` 不应被收紧改写）。
  - 历史 at-rest 原始字节仍可能存在于数据库（不可变、保留期老化），读取端安全性依赖投影始终生效；
    该不变量已在 `INV-CE-005` 分 (a)/(b)/(c) 记录，但 master 尚无该文档（§9）。
- 结论：**FIX_BEFORE_MERGE 级别的风险**（CI 红 + 夹具归属未落地），不是单纯文档问题。

### 6.3 #924

- 声称：根作用域 `x-request-id` 响应头 = `request.id`；CORS 仅暴露给配置 origin；
  web `postWithMeta` 是唯一 SaveAnswer 调用面；200 `accepted:false` 的 header id 进入
  Alert 请求编号与 `answer_autosave_failed` telemetry（client-claimed）；
  不改变 envelope 权威、不新增 requestId DB 表/查询 API。
- 已证明：head 的 8 个 CI check 全部 pass；diff 与 PR body 一致。
- 风险：
  - `getWithMeta` 无生产调用方（documented forward surface），是否保留需在文档/评审中确认，
    避免后续被误判为死代码。
  - `429` 状态路径 `NOT_TESTED`（测试模式限流关闭）。
  - header 值可被中间层替换；文档已声明其不是凭据、不是业务成功证明。
  - 与 #923 组合的夹具依赖（§4.2）是当前最直接的集成阻塞。
- 结论：单独看 **KEEP_AND_MERGE 候选**；组合前必须修夹具并跑集成 CI。

### 6.4 #926

- 声称：Pino req 序列化器只记录 method + 匹配路由模板或 `(unrouted)`；19 处日志改用
  `routeTemplateOf`；nginx access log 使用 `exam_privacy`，禁止原始 URL/Referer；
  nginx error log 保持 `error` 级并接受敏感 URL 残余风险；部署/运维文档已更新。
- 已证明：head 的 8 个 CI check 全部 pass；diff 与 PR body 一致；`nginx -t` / live container canary
  为 PR body 自述，本次基线未重跑。
- 风险：
  - nginx error log 在 upstream/DNS 故障时可能包含完整请求行（已接受，必须文档化，不能声称“全部脱敏”）。
  - 第三方 log collector / 日志文件权限 `INFRA_LOG_ACCESS = NOT_VERIFIED`。
  - root 404 策略依赖 `public/` 是否存在；集成/E2E 两种布局都要验证。
  - `docker-compose.yml` healthcheck 改到 `/healthz`，依赖 nginx 配置的 80 豁免；部署验证属于真实资源操作，
    后续阶段需按仓库语义命令执行，不得自行重建拓扑。
- 结论：单独看 **KEEP_AND_MERGE 候选**；集成时需验证与 #924 的 header/404 交互。

---

## 7. 尚未提交的修复与证据（不得丢弃）

### 7.1 两处集成测试修复（本地已提交、未推送）

工作树：`/home/hoo/Source/exam-gap-worktrees/integration-final`
分支：`final-closure-integration`（**local-only**；`git ls-remote origin refs/heads/final-closure-integration` 为空）
HEAD：`1f644725d574dd669081b3008a73122c1a55641c`（0 behind / 30 ahead of master，工作树 clean）

| commit | 内容 | 影响文件 | 与任务书的关系 |
| --- | --- | --- | --- |
| `3e97c4977ca4e5f8b3fe30f4adeddb39269b8981` | `test(integration): align claimed-requestId fixtures with #923 UUID shape-gate` | `apps/api/src/routes/proctorMonitoring.crossOrg.test.ts`（+4/-1）、`apps/e2e/e2e/investigation-ui-acceptance.spec.ts`（+4/-1） | 承载 §4.2 的跨 PR 夹具修复 |
| `1f644725d574dd669081b3008a73122c1a55641c` | `test(e2e): await the settled KaTeX prompt before the overflow scroll probe` | `apps/e2e/e2e/rich-content-overflow.spec.ts`（+10） | 针对 #878 / OBS-2026-11-03-001 的 flake 修复候选 |

补充事实：

- 任务书称「两处测试修复只存在于 dirty worktree」；**as-built 已不是 dirty 文件**，
  而是上述两个本地 commit。它们仍不在任何 PR 分支、不在 `origin`，因此任务书的实质风险判断
  （修复未进入受控 Git 历史）仍然成立，但表述需按本文件更正。
- 之前的集成 SHA `a84b416a0c58cd73a7143eef274ef2c68f0f4fcc` 是 `1f644725` 的祖先
  （`a84b416a` = merge `1dd4d206` into `final-closure-integration`）。
- `final-closure-integration` 已包含四个 PR head 的祖先检查：
  `7243aa5c`、`d3580f3e`、`e81b76a1`、`1dd4d206` 均 `git merge-base --is-ancestor <head> 1f644725` = true。
- **不得**把该分支的 `clean` 状态误读为「改动已进入受控远端历史」；它仍未推送。

### 7.2 `s0-evidence` worktree 的未提交证据（高风险）

工作树：`/home/hoo/Source/exam-gap-worktrees/s0-evidence`
分支：`docs/secure-observability-evidence-archive` @ `7243aa5c5ab46155d914907b6ff30acf9b51cbe4`
（与 `origin/docs/secure-observability-evidence-archive` 一致）

- `git status --short`：**dirty**
  - `M docs/research/exam-secure-observability-remediation/SHA256SUMS`（+255 行）
  - 17 个顶层未跟踪条目；`git status --porcelain=v1 -uall` 共 256 条
    （1 个 modified + 255 个 untracked）：
    - `07-NGINX-DIAGNOSTICS-AND-PRIVACY.md`
    - `08-CLIENT-EVENT-RETENTION-VERIFICATION.md`
    - `09-HISTORICAL-DATA-AND-BACKUP-BOUNDARY.md`
    - `10-INTEGRATION-CI-AND-PERFORMANCE.md`
    - `BASELINE.md`、`TASK-CONTRACT.md`、`FINAL-ADJUDICATION.md`、`FINAL-OWNER-DECISIONS.md`
    - `SAVEANSWER-CORRELATION-E2E.md`、`SAVEANSWER-PROTOCOL-REGRESSIONS.md`
    - `review-security.md`、`review-saveanswer-protocol.md`、`review-nginx-operations.md`、
      `review-architecture-performance.md`
    - `raw/nginx-fault-injection/`、`raw/perf-ab/`、`raw/saveanswer-e2e/`
- 规模：研究目录约 **2.8 MB**、**318 个文件**（`du -sh` / `find -type f | wc -l`）。
- 本次仅做路径/大小清点，**未读取未跟踪文件内容**，避免接触潜在敏感证据。
- **这些文件不在 PR #922 的提交中**（PR #922 的文件清单只含 00–06、README、SHA256SUMS 与 raw 的既有集合）。
  它们属于本轮之前审计的后续交付物草稿，是否应提交、合并到哪个 PR/分支，必须由后续阶段明确决定。
- **禁止**在该 worktree 执行 `git clean`、`git reset --hard`、`git worktree remove` 或任何整仓恢复。

### 7.3 根工作树未跟踪产物

- `test-results/`（根）：未跟踪、**未被 .gitignore 忽略**；`test-results/.last-run.json`
  内容为 `{"status":"failed","failedTests":[]}`（45 B）。不得删除或误提交。
- `.tmp/`（gitignored）：
  - `.tmp/production-closure/`（84 KB）：本轮 SPEC + `workflow.dwf.ts` + `reviews/`（空）。
  - `.tmp/secure-correlation-audit/`（60 MB）：上一轮审计证据（BASELINE-AND-SOURCE-MAP、
    FINAL-VERDICT、REQUEST-CORRELATION-MATRIX、performance/raw 等）。
  - `.tmp/final-remediation-report/`（180 KB）：最终 remediation 报告与 SHA256SUMS。
  - `.tmp/ui-patrol/`（54 MB）与 `.tmp/nav-evidence/`（4.8 MB）：UI/导航巡检证据。
- `.artifacts/adjudication/`（2.0 MB，gitignored）：含 `final-integration/` 的 merge receipts、
  integration sequence、reviewer A/B、verify-chain 日志等历史集成证据。
- 上述 `.tmp` / `.artifacts` 不是交付 authority（任务书 §9 明确不能把未跟踪 `.tmp` 作为唯一交付依据），
  但它们是证据，**不得以清理为名删除**。

### 7.4 各 worktree 的 gitignored 测试产物

| worktree | 证据类目录 |
| --- | --- |
| 根 `/home/hoo/Source/exam` | `apps/e2e/blob-report/`、`apps/e2e/test-results-patrol/`、`gui-test-screenshots/`、`apps/api/public/` |
| `integration-final` | `apps/e2e/test-results/`、`apps/e2e/blob-report/`、`apps/api/public/` |
| `pr-865` | `apps/e2e/test-results/`、`apps/e2e/blob-report/`、`apps/api/public/` |
| `pr-864` | 无证据类目录 |
| `pr-log-privacy` | 无证据类目录 |
| `s0-evidence` | 无额外 ignored 证据目录 |
| `perf-baseline` | 无证据类目录 |
| `.worktrees/work/scratch` | `.zcode/`（工具配置，非本轮证据） |

### 7.5 并发活动告警

基线执行期间（12:32:57 +0800），`/home/hoo/Source/exam/.worktrees/work/scratch` 的
`work/scratch` 分支从 `fd8e12a3faeb172aa69d2bb7a979b7247f8a4c4a` 前进到
`aeea38be96ff1e99f16de91cb8da35d3f8c33410`（commit：
`refactor: disrupt/restore legality via transition table (F03) (#927)`）。
该 worktree 之前显示的 4 个修改文件已随提交消失，当前 clean。

- 该分支与本轮四个 PR 无关，属于 #927（隐式状态机审计）的并行工作。
- 这是**活跃的并发写入者**：后续任何 worktree 操作、`git worktree add/remove`、分支创建都必须假设
  外部代理可能同时改动仓库；不要抢占、不要清理、不要对该 worktree 执行任何写操作。
- 本基线不把 `work/scratch` 的内容纳入四 PR 集成范围。

---

## 8. 本地全部 worktree 清单

`git worktree list --porcelain`（基线时）：

| 路径 | HEAD | 分支 | 状态 | 归属 / 备注 |
| --- | --- | --- | --- | --- |
| `/home/hoo/Source/exam` | `5140c3dd...` | `master` | tracked clean；`?? test-results/` | 主工作树；不得在此开发（任务书 §0.2 禁止） |
| `/home/hoo/Source/exam-gap-worktrees/integration-final` | `1f644725...` | `final-closure-integration` | clean | 历史集成分支；含四个 PR + 两处本地测试修复；**未推送** |
| `/home/hoo/Source/exam-gap-worktrees/perf-baseline` | `5140c3dd...` | detached HEAD | clean | 性能基线 witness worktree；无分支，勿在其上 commit |
| `/home/hoo/Source/exam-gap-worktrees/pr-864` | `d3580f3e...` | `fix/security-client-event-route-projection` | clean | #923 工作树；与 origin 一致 |
| `/home/hoo/Source/exam-gap-worktrees/pr-865` | `e81b76a1...` | `feat/http-request-id-response-header` | clean | #924 工作树；与 origin 一致 |
| `/home/hoo/Source/exam-gap-worktrees/pr-log-privacy` | `1dd4d206...` | `fix/security-http-access-log-privacy` | clean | #926 工作树；与 origin 一致 |
| `/home/hoo/Source/exam-gap-worktrees/s0-evidence` | `7243aa5c...` | `docs/secure-observability-evidence-archive` | **DIRTY**（证据） | #922 工作树 + 未提交 07–10 等证据（§7.2） |
| `/home/hoo/Source/exam/.worktrees/work/scratch` | `aeea38be...` | `work/scratch` | clean（基线中期由 dirty 变为 clean） | 并发 #927 工作树；不属本轮，勿动 |
| `/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109` | `5140c3dd...` | `integration/production-closure-20261109` | clean | **本轮新建**；从 `origin/master` 创建；上游 `origin/master` |

新建命令（已执行，exit 0）：

```bash
git -C /home/hoo/Source/exam worktree add \
  -b integration/production-closure-20261109 \
  /home/hoo/Source/exam-gap-worktrees/integration-closure-20261109 \
  origin/master
```

验证：

- `git -C .../integration-closure-20261109 rev-parse HEAD`
  = `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d`
- `git -C .../integration-closure-20261109 branch --show-current`
  = `integration/production-closure-20261109`
- `git -C .../integration-closure-20261109 status --short --branch`
  = `## integration/production-closure-20261109...origin/master`（无 dirty 条目）
- `git worktree list` 显示该路径已注册。

---

## 9. 文档漂移（master vs PR heads）

> 判定标准：以 master 的当前文档为「合并前权威」；下列条目在合并对应 PR 后会过期，
> 或者 PR 声称的长期文档变更尚未进入 master。

### 9.1 requestId / 响应头

| 文档 | master 现状 | PR 变更 | 漂移风险 |
| --- | --- | --- | --- |
| `docs/contracts/observability.md:32` | requestId 载体只列 error envelope、Pino、HTTP audit；无 `x-request-id` 响应头 | #924 增加响应头载体与 web 消费说明 | 合并后 master 若不更新该行，会低估真实载体 |
| `docs/contracts/observability.md:34`（master 表格 path/route 行） | `pino default` | #926 改为 `routeOptions.url` 模板 / `(unrouted)` | #924 与 #926 都改该文件；合并后需整体复核 |
| `docs/contracts/observability.md:43` | 实现状态只写 requestId/method/path/...（Pino default） | #924/#926 未同步该实现状态行 | 可能仍然过期；需在 doc 收口时核对 |
| `docs/contracts/api-contract.md` | **没有** `Standard response headers` 章节（`grep` 无结果） | #924 新增 8 行 | 合并前 master 无响应头契约 |
| `docs/operations/save-failure-evidence.md:21` | 明确写「200 `accepted:false` rejection body deliberately carries no `requestId` — correlate by attemptId + questionId + clientSeq + time」 | #924 改为「header 是客户端可见的同一 request id 载体；body 仍无 requestId」 | 合并后若不更新，会与产品行为矛盾；注意 body 与 header 的区别 |
| `docs/operations/save-failure-evidence.md:83-88` | 只描述 envelope / client-claimed 两种来源 | #924 增加 rejection alert 请求编号的直接搜索路径 | 调查 runbook 需要同步 |
| `docs/adr/ADR-025-http-request-correlation-identity.md` | Status: ACCEPTED；无 response header 附录 | #924 增加 dated addendum（非 supersession） | ADR 历史不可改写；必须保留原决策 + 附录 |
| `docs/adr/README.md` ADR 索引行 | 只写 `ACCEPTED` | #924 改为 `ACCEPTED, amended (2026-11-08: x-request-id response header, #865)` | 索引与 ADR 正文需一致 |

### 9.2 route / client_events

| 文档 | master 现状 | PR 变更 | 漂移风险 |
| --- | --- | --- | --- |
| `docs/architecture/exam-system/security-model.md` | **没有** `INV-CE-005`（`git grep` 无结果） | #923 在 `:257` 增加不变量、`:302` 增加 §15.7 | 合并前安全模型缺少该不变量 |
| `docs/contracts/observability.md:73-79` | 说明 client-claimed `metadata.requestId` 是未核验 claim | #923 增加 UUID 形状 gate（内容注入限制） | 文档需说明 gate 只限制形状、不核验身份 |
| `docs/research/exam-secure-observability-remediation/` | master 不存在 | #922 新增完整归档 | 合并 #922 后才有该目录；s0-evidence 的 07–10 仍未提交 |

### 9.3 日志 / 部署

| 文档 | master 现状 | PR 变更 | 漂移风险 |
| --- | --- | --- | --- |
| `docs/contracts/observability.md` | 无 #925 的 Pino/nginx 原始 URL 禁令与 error log 残余风险 | #926 增加两段 | 合并前文档不反映隐私边界 |
| `docs/deployment/README.md` | 未包含 nginx log format / healthcheck / error log 说明 | #926 +10 行 | 部署 runbook 需同步 |
| `docs/operations/README.md` | 未包含 #925 运维诊断边界 | #926 +16 行 | 运维文档需同步 |

### 9.4 状态 / flake 文档

| 文档 | master 现状 | 漂移 |
| --- | --- | --- |
| `docs/status/implementation-status.md` | 只有 `:21` 的通用 requestId 描述；四个 PR 均未修改该文件 | 合并后实现状态不会自动反映 #864/#865/#925；这是明确的 closeout 漂移 |
| `docs/standards/test-flakes.md:3321` | 已登记 `OBS-2026-11-03-001`（`rich-content-overflow.spec.ts:568`），Issue #878 OPEN | 集成修复 `1f644725` 尚未回写该 case / Issue；修复归属未落地 |
| `docs/standards/test-flakes.md:257` | `CASE-2026-11-03-CI-COVERAGE-BUDGETS` 标记 REPAIRED（#859 已合并） | 与 #923 的新失败无直接关系；不得把新 occurrence 自动归入旧 case |
| 仓库 README / CHANGELOG / Release notes | 四个 PR 均未修改 | 是否需要按发布规范更新 = **UNKNOWN**（任务书 §5 要求核查，但基线未找到明确触发条件） |

### 9.5 文档一致性门禁（待后续阶段）

任务书 §5.5 要求全局搜索旧 requestId / SaveAnswer / nginx / route 描述。
基线已确认至少以下 master 文本在合并后会过期：

- `docs/operations/save-failure-evidence.md:21` 的「200 rejection 只能靠 attemptId+questionId+clientSeq+时间」；
- `docs/contracts/observability.md:34` 的 `pino default`（route/path）；
- `docs/contracts/observability.md:43` 与 `:238` 的实现状态表；
- `docs/contracts/api-contract.md` 缺少 response headers 章节；
- `docs/architecture/exam-system/security-model.md` 缺少 INV-CE-005。

---

## 10. CI / 评审门禁现状

| 项目 | 状态 |
| --- | --- |
| 四个 PR 状态 | 全部 Draft / OPEN |
| 正式 review | 无（reviews 空；reviewDecision 空；review requests 空） |
| CodeRabbit | 四个 PR 均 `skipping`，不构成 review 证据 |
| PR #922 CI | 8/8 pass |
| PR #923 CI | 7/8 pass；E2E shard 1 fail（2 failed，见 §2.3） |
| PR #924 CI | 8/8 pass |
| PR #926 CI | 8/8 pass |
| master `5140c3dd` CI | check-runs 为空 → **UNKNOWN** |
| branch protection | `protected: false`；无 required checks |
| 人工门禁 | 仓库 AGENTS.md 第 7 节：merge / force-push 必须当场获得人类确认；任务书 §0.2 也保留该门禁 |

---

## 11. 相关 Issue 状态（基线查询）

| Issue / PR | 标题 | 状态 | 与本轮关系 |
| --- | --- | --- | --- |
| #800 | `[Research][Observability] Exam Event, Error & Audit V2` | OPEN | #922 归档的父研究 |
| #864 | `[Decision Gate][Observability] A1-F8 — client_event route 服务端收敛、隐私与关联稳定性` | OPEN | #923 对应；合并后需 closeout |
| #865 | `[Decision Gate][Observability] A2-F9 — SaveAnswer 200 响应 requestId 合同与可调查性` | OPEN | #924 对应；合并后需 closeout |
| #875 | `[Decision Gate][Security][Evidence] A5-F4 — client_events metadata 入库结构收敛与隐私预算` | CLOSED | #923 的前序决策（immutability 先例） |
| #919 | `[Audit][Security][P2] client_events.user_agent 原始持久化的必要性与最小化边界` | OPEN | 明确不并入 #926（PR body） |
| #920 | `[Audit][Build][P2] stale-dist 混跑导致 proctor-events 500` | OPEN | 明确不并入 #926（PR body） |
| #921 | `[Decision][Observability] NO_GO_NOW：暂不建设新日志平台、requestId 查询 API 或管理调查 UI` | CLOSED | 仍约束 #924 范围（不建查询 API/平台） |
| #925 | `[Security][Observability] HTTP 访问日志隐私：Pino 请求行与 nginx access log 不得落盘原始 URL` | OPEN | #926 对应；合并后需 closeout |
| #858 | `[CI][Flake] RichTextAnswerInput 'editor not mounted' repeats under full Web coverage on multiple PR heads` | CLOSED（2026-11-03） | 历史上已由 #859 修复；与 #923 新失败不是同一 case |
| #878 | `[CI][Flake] rich-content-overflow geometry: fixed 150ms wait races Chrome arrow-key scroll (scrollLeft 0 under 2-shard load)` | **OPEN** | #923 E2E 失败第 2 项的既有登记；集成 commit `1f644725` 是修复候选 |
| #927 | `[Audit][Architecture] exam 隐式状态机静态审计：43 个隐式生命周期清单（基准 5140c3dd）` | OPEN | `work/scratch` 的并发工作；不属本轮四 PR |

- 所有查询到的 Issue `labels` 为空数组；本文件不臆造优先级标签。
- 任务书提到的 #919/#920/#921 与 #926 的关系在 #926 PR body 中已明确「deduped；不混合范围」。

---

## 12. 风险登记（证据丢失 / 分支归属 / 工作树冲突）

| ID | 风险 | 证据 | 影响 | 处置要求（后续阶段） |
| --- | --- | --- | --- | --- |
| R1 | `s0-evidence` dirty 且含 255 个未跟踪证据文件（+1 个修改的 SHA256SUMS，共 256 条） | `git status --porcelain=v1 -uall`；`du -sh` 2.8 MB；`find` 318 files | 任何 clean/reset/worktree remove 会永久丢失 07–10 交付物与 review/raw 证据 | 禁止清理；先决定提交归属（PR #922 追加 or 新分支）；保留 SHA256SUMS 修改 |
| R2 | 两处集成修复只在本地 `final-closure-integration` | `git ls-remote` 空；commit `3e97c497`、`1f644725` | 未推送 → 不在受控 Git 历史；误删 worktree 即丢失；也容易被误归到某个 PR | 在本轮授权下推送到明确分支/PR，或在新集成分支重新提交并记录归属 |
| R3 | 并发代理正在改 `work/scratch` | reflog：12:32:57 从 `fd8e12a3` 到 `aeea38be` | git 操作竞争、worktree 状态在盘点后变化 | 不碰该 worktree；创建/合并前重新检查 `git worktree list` 与分支 head |
| R4 | 根 `test-results/` 未跟踪且未被 ignore | `git status`；`git check-ignore` 无输出 | 可能被误 commit 或误删 | 保留；后续决定是否加入 ignore 或作为证据归档（不在本阶段修改） |
| R5 | `#923` 当前 CI 红；`#924` 的夹具依赖未落到 PR 分支 | §2.3、§4.2 | 按 `922→923→924→926` 直接合并会在集成树红 | 先修 #923 E2E 夹具/承担归属，再验证 #923+#924 组合 |
| R6 | 无 branch protection / required checks | `gh api branches/master` | 「PR 全绿」不是合并门禁；无 GitHub 层强制 | 以任务书 §8.1 + AGENTS.md 人工门禁为准，不能把绿 check 当唯一证据 |
| R7 | `.tmp` / `.artifacts` 证据是 gitignored，不是交付 authority | 任务书 §9；`git check-ignore` | 最终交付若只引用 `.tmp`，clean checkout 不可恢复 | 最终 deliverable 必须进入受控 Git 历史（任务书 §9） |
| R8 | master `5140c3dd` 无 check-runs | `gh api commits/<sha>/check-runs` 空 | 不能声称 master CI 已绿 | 后续以 exact integration SHA 的完整 CI 为准 |
| R9 | 文档漂移（§9） | `git grep` / 文件读取 | 合并后产品行为与文档矛盾 | doc 收口阶段按任务书 §5 更新并全局搜索旧表述 |
| R10 | 相似 worktree 名称混淆：`integration-final` vs `integration-closure-20261109` | `git worktree list` | 可能在错误 worktree 施工/验证 | 后续命令必须使用完整绝对路径；不要复用 `integration-final` 的 dirty/clean 状态冒充新树 |
| R11 | #922 的 `SHA256SUMS` 未在本次基线独立验证 | PR body/commit message 自述 62/62；本次未跑 | 证据完整性只有作者声明 | 后续在 clean checkout 上跑 `sha256sum -c` 并留证 |
| R12 | s0-evidence 未提交文件可能含敏感证据内容 | 本次未读取内容 | 若直接提交可能带入不应归档的字节 | 提交前按 #922 已建立的 sanitization gate 逐项审查 |

---

## 13. UNKNOWN（不猜测）

1. `master` `5140c3dd...` 是否实际跑过 CI、结果如何：check-runs API 为空，**UNKNOWN**。
2. `final-closure-integration` 的 `3e97c497` / `1f644725` 是否为最终版修复，还是仍需调整：**UNKNOWN**
   （本次只读 commit 内容与消息，未跑测试）。
3. `s0-evidence` 的 07–10 与 review/raw 文件应归属哪个 PR/分支、是否应在本轮提交：**UNKNOWN**。
4. `docs/status/implementation-status.md`、README、CHANGELOG、Release 文档是否必须在本轮更新：
   四个 PR 均未修改它们；仓库发布策略未在本次读取范围内给出明确触发条件：**UNKNOWN**。
5. 两处集成修复是否已在本地/CI 上通过（`3e97c497` 的夹具修复、`1f644725` 的 KaTeX 等待）：
   本次**未运行** E2E；只确认 commit 存在且工作树 clean：**NOT_RUN / UNKNOWN**。
6. `test-results/.last-run.json` 的 `status: failed` 对应哪次运行、哪个测试：`failedTests` 为空：**UNKNOWN**。
7. 是否有其他未列出的远端分支/PR 与本轮冲突：本次只过滤查询了四个 PR 与相关分支；
   `gh pr list` 全量未拉取：**UNKNOWN**。
8. `.env` / `.env.production` 等文件的实际内容与测试数据库目标：按任务要求**未读取、未打印**；
   后续真实资源验证前必须按 `docs/standards/testing.md` §2.8 解析实际连接目标：**UNKNOWN**。
9. #922 归档是否独立通过 `sha256sum -c`：**NOT_RUN**（本次未在 clean checkout 重跑）。
10. #926 的 nginx live 容器探针、`nginx -t`、`EXAMAUDIT-CANARY` 结果：PR body 自述，本次**未重跑**。

---

## 14. 本次基线实际执行的命令（可复核）

> 下列命令均在 `/home/hoo/Source/exam` 或指定 worktree 执行；未执行任何测试、构建、数据库或 Docker 操作。

```bash
# 仓库状态
git -C /home/hoo/Source/exam fetch origin --prune
git -C /home/hoo/Source/exam status --short --branch
git -C /home/hoo/Source/exam rev-parse HEAD origin/master
git -C /home/hoo/Source/exam branch --show-current
git -C /home/hoo/Source/exam worktree list --porcelain
git -C /home/hoo/Source/exam stash list

# PR 元数据 / CI
gh pr view 922 --repo jnhu76/exam --json number,title,headRefName,headRefOid,baseRefName,state,isDraft,mergeable,mergeStateStatus,reviewDecision,url
gh pr view 923 --repo jnhu76/exam --json ...
gh pr view 924 --repo jnhu76/exam --json ...
gh pr view 926 --repo jnhu76/exam --json ...
gh pr view <n> --repo jnhu76/exam --json files
gh pr checks 922 --repo jnhu76/exam
gh pr checks 923 --repo jnhu76/exam
gh pr checks 924 --repo jnhu76/exam
gh pr checks 926 --repo jnhu76/exam
gh api repos/jnhu76/exam/commits/<sha>/check-runs?per_page=100
gh api repos/jnhu76/exam/actions/jobs/128847373789/logs
gh api repos/jnhu76/exam/branches/master
gh issue view <n> --repo jnhu76/exam --json number,title,state,labels,updatedAt,url

# 分支 / 祖先 / 远端
git merge-base origin/master <head>
git rev-list --left-right --count origin/master...<ref>
git merge-base --is-ancestor <head> 1f644725
git ls-remote --heads origin | grep -E 'secure-observability|client-event-route|http-request-id|access-log-privacy|final-closure|integration|work/scratch'
git show-ref | grep integration/production-closure-20261109

# 冲突模拟
git merge-tree --write-tree --messages 7243aa5c d3580f3e
git merge-tree --write-tree --messages 7243aa5c e81b76a1
git merge-tree --write-tree --messages 7243aa5c 1dd4d206
git merge-tree --write-tree --messages d3580f3e e81b76a1
git merge-tree --write-tree --messages d3580f3e 1dd4d206
git merge-tree --write-tree --messages e81b76a1 1dd4d206

# 代码/文档检索
git grep -n -E 'req-cross-org|req-forged-prt' origin/master -- apps packages
git grep -n -E 'req-cross-org|req-forged-prt' d3580f3e -- apps packages
git grep -n -E 'req-cross-org|req-forged-prt' e81b76a1 -- apps packages
git grep -n 'INV-CE-005' origin/master -- docs
git grep -n 'INV-CE-005' d3580f3e -- docs
git grep -n -E 'REQUEST_ID_UUID_SHAPE|SPA_ROUTE_TEMPLATES|projectClientEventRoute' d3580f3e -- packages apps
git grep -n -E 'serializeReqForLog|routeTemplateOf|registerRootNotFoundBoundary' 1dd4d206 -- apps
git grep -n 'log_format' 1dd4d206 -- deploy/nginx/web.conf
git grep -n -E 'rich-content-overflow|editor not mounted|getClientRects' origin/master -- docs/standards/test-flakes.md
git diff origin/master...<head> -- <path>

# 证据目录清点
git status --short --branch  # 每个 worktree
git -C /home/hoo/Source/exam-gap-worktrees/s0-evidence status --porcelain=v1 -uall | wc -l
du -sh <evidence-dir>
find <evidence-dir> -type f | wc -l
cat /home/hoo/Source/exam/test-results/.last-run.json

# 新建集成 worktree（唯一写操作，任务书授权）
git -C /home/hoo/Source/exam worktree add \
  -b integration/production-closure-20261109 \
  /home/hoo/Source/exam-gap-worktrees/integration-closure-20261109 \
  origin/master
```

---

## 15. 后续阶段约束（本基线发现的硬约束）

1. **不得**使用 dirty worktree（尤其 `s0-evidence`）的运行结果作为集成/合并证据；
   exact-SHA 验证必须来自 committed code + clean worktree。
2. **不得**删除、clean、reset 或 remove：`s0-evidence`、`integration-final`、`perf-baseline`、
   `.worktrees/work/scratch`、根 `test-results/`、`.tmp/`、`.artifacts/`。
3. **不得**把 `integration-final` 的 `1f644725` 当作已推送/已评审的集成 SHA；它只是本地历史证据。
4. **不得**在 `master` 工作树开发；本轮集成必须使用
   `/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`。
5. **不得**在 #923 修复前按顺序直接合并；#923 自身 E2E 红，且 #923+#924 夹具依赖未落到 PR 分支。
6. **不得**声称 master CI 已绿；master SHA 没有 check-runs 记录。
7. **不得**声称两处集成修复已验证；本次只读，未运行测试。
8. 任何涉及 merge 的步骤仍受仓库 AGENTS.md 第 7 节人工门禁约束：必须当场获得人类确认。

---

## 16. 本阶段产物位置

- 任务书副本：`/home/hoo/Source/exam/.tmp/production-closure/SPEC.md`（28,260 B）
- review 目录：`/home/hoo/Source/exam/.tmp/production-closure/reviews/`（已创建，空）
- 本基线文件：`/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109/docs/research/exam-production-integration-closure/BASELINE_AND_OWNERSHIP.md`（未跟踪）
- 集成 worktree：`/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`
- 集成分支：`integration/production-closure-20261109`（HEAD `5140c3dd...`，上游 `origin/master`）
