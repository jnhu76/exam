# 独立复核：夹具与 flake 修复提交（fixtures/flake）

- 复核人：夹具独立复核员（独立 subagent，只读 + 最小验证）
- 日期：2026-11-09
- 范围：#924 crossOrg 夹具提交；#923 E2E 夹具提交 + rich-content-overflow flake 提交
- 对象工作树（集成树尚未定稿，按 ask 在 PR 工作树核对）：
  - `/home/hoo/Source/exam-gap-worktrees/pr-865` @ `9dd1d5f428ce3373cc6ef02158eb252e4f7dab55`
  - `/home/hoo/Source/exam-gap-worktrees/pr-864` @ `1f29b6148ff881700bb1d2c1b047653f6c44340c`（含 `ca7e62ecca578c5a7b100b81102bd2d56d3d67d3`）

## 结论

**GO（fixtures/flake 范围）**。三个提交均只改测试文件、只改预期文件、不削弱任何安全语义；两个命名验证均在本会话实际运行且通过。

## 逐项确认

### 1. #924 crossOrg 夹具（pr-865 @ 9dd1d5f4）— 通过

- diff 仅 1 个文件：`apps/api/src/routes/proctorMonitoring.crossOrg.test.ts`（+4/−1，`git show 9dd1d5f4 --stat`）。
- 仍提交合法 UUIDv4 claim：`proctorMonitoring.crossOrg.test.ts:232` `const claimedRequestId = randomUUID();`，`randomUUID` 来自 `node:crypto`（`proctorMonitoring.crossOrg.test.ts:1`）。claim 仍以客户端遥测 metadata 形式提交（:241-264，`requestId: claimedRequestId` 写入 `answer_autosave_failed` metadata）。
- 仍断言跨组织不可读：`proctorMonitoring.crossOrg.test.ts:292-298` 断言跨组织 proctor GET timeline 返回 404 + `RESOURCE_NOT_FOUND`。正向对照保留（:270-288）：同组织 admin 200 且 `metadata.requestId` 投影可见。未删除任何断言。
- 修复不是"伪造 claim 被信任"：新注释（:229-231）明确 "UUIDv4 is the shape the server mints (ADR-025), not proof of it: a well-formed value is still an unverified client claim"。变更实质是把 claim 换成**最强合法形状**仍证明不授予访问——比原 `req-*` 更严格而非更松。
- 变更是必要的向前对齐：#923 的服务端 shape gate（pr-864 @ d3580f3e，`proctorMonitoringService.ts:211` `REQUEST_ID_UUID_SHAPE`，:230-231 仅 UUID 字符串通过投影）在集成树合入后，`req-cross-org-*` 会被投影丢弃，正向对照断言（:288）会失败；UUIDv4 通过该正则（本会话用 node 程序化验证：matches UUIDv4 regex: true）。注意 pr-865 分支本身尚不含 d3580f3e（`git merge-base --is-ancestor` 验证），此夹具变更是对集成树的预对齐，不构成双轨或冲突。

### 2. #923 E2E 夹具（pr-864 @ ca7e62ec）— 通过

- diff 仅 1 个文件：`apps/e2e/e2e/investigation-ui-acceptance.spec.ts`（+8/−3）。
- 仍是未核验 claim：`investigation-ui-acceptance.spec.ts:770` `const forgedRequestId = "00000000-0000-4000-8000-000000000bad"`（本会话程序化验证：长度 36、version nibble `4`、variant nibble `8`，匹配 UUIDv4 正则——语法合法、语义仍是 FORGED）。它只作为注入 500 fault envelope 的字段（:771-787）随客户端保存路径进入遥测；:762-769 注释明确 "shape legality is form only, not verification — it stays a forged, unverified client claim and must never be promoted to server authority"。
- banner 断言保留：:800-803 断言 `server-fault-alert` 可见、含 "服务器错误" 与 `错误编号：${forgedRequestId}`。
- telemetry 断言保留：:789-795 等待真实 `/api/client-events` POST 成功响应；:811-814 断言 `accepted >= 1`（服务端接受遥测行），**不是**用 requestId 证明保存成功——保存本身被注入为 500 失败，测试从未把 requestId 当作保存成功的权威证据（grep 全文件 13 处 requestId 用法，全部为：注入 fault envelope、banner 文本、未核验标签文本断言，无一处作为保存结果证据）。
- 来源徽标断言保留：:844-849 客户端遥测行必须含 "客户端声明，未经服务端核验" 且含 forgedRequestId（伪造 id 只能出现在未核验分组）；:851-859 audit 行必须含 "操作"、不含 "前端"、不含客户端声明标签；detail 页同语义（:891-906）；390px 无溢出断言保留（:912-921）。

### 3. flake 修复（pr-864 @ 1f29b614）— 通过

- diff 仅 1 个文件：`apps/e2e/e2e/rich-content-overflow.spec.ts`（+18/−5）。
- 等待 settled state，非扩大 timeout：修复在采样前等待渲染后的公式与 overflow 事实——`.katex` count==1（:564）、`document.fonts.ready`（:565-567）、重断言仍聚焦（:569）与 `data-overflowing="true"`（:570）；随后用显式有界条件 `expect.poll(scrollLeft).toBeGreaterThan(before)`（:577-581）替代原固定 `page.waitForTimeout(150)`（旧代码 `HEAD~2` 版本 :564-568）。断言强度不变（仍要求 scrollLeft 严格递增）。`playwright.config.ts` 未设 `expect.timeout`（框架默认 5s），`expect.poll` 的 `timeout: 5_000` 与框架默认一致，非超时膨胀；config `retries: 0`，无 retry；无 skip。该模式与同文件既有 settled-state 先例一致（:757-767 result-page 流程）。
- 原失败在未修复代码上可解释：旧代码在 ArrowRight 后固定 150ms 单点采样 `scrollLeft` 再断言 `> 0`（`git show HEAD~2` 版本 :564-568，断言行号恰为提交信息引用的 :568）。提交信息引用的三个失败 run/job 均经 `gh api repos/jnhu76/exam/actions/jobs/{128847373789,128987131154,128987063313}` 核实为失败状态（run 42518523050 conclusion=failure，失败 step "Run E2E tests (1/2)"）。'Expected: > 0 / Received: 0' 日志正文已过保留期无法取回（`gh run view --log` 返回空）——但机制本身从旧代码结构可解释：固定 150ms 预算与 Chrome 动画化方向键滚动竞争、且未等待懒加载 KaTeX 投影（回退 raw-LaTeX ~2000px vs 渲染公式 571px，采样面可中途变化）。
- 范围观察（低优先级，不阻塞）：旧文件还有 4 处同模式的 `waitForTimeout(150)` + ArrowRight 断言（`HEAD~2` 版本 :921、:998、:1079、:1120），本次未一并修复。提交信息引用的失败全部在 :568，按"只修被证据指向的失败点"是合理收敛；但这 4 处属同类潜在竞态，可考虑后续 focused follow-up。

### 4. diff 卫生 — 通过

- `git status --porcelain` 两个工作树均为空（无未提交夹具、无 dirty state 依赖）。
- pr-865 `git diff HEAD~1 HEAD --name-only`：仅 `apps/api/src/routes/proctorMonitoring.crossOrg.test.ts`。
- pr-864 `git diff HEAD~2 HEAD --name-only`：仅 `apps/e2e/e2e/investigation-ui-acceptance.spec.ts`、`apps/e2e/e2e/rich-content-overflow.spec.ts`。

## 运行验证（本会话实际执行）

| # | 检查 | 命令 | 结果 |
| --- | --- | --- | --- |
| 1 | #924 crossOrg API 测试 | `cd /home/hoo/Source/exam-gap-worktrees/pr-865/apps/api && pnpm vitest run src/routes/proctorMonitoring.crossOrg.test.ts` | **PASS**，exit 0：`Test Files 1 passed (1)`、`Tests 7 passed (7)`（vitest 4.1.7，4.06s） |
| 2 | #923 rich-content-overflow spec | `cd /home/hoo/Source/exam-gap-worktrees/pr-864 && bash scripts/e2e/run.sh rich-content-overflow` | **PASS**，exit 0：`shard 1/2 通过 ✓`、`shard 2/2 通过 ✓`（runner 自建 `exam_e2e_w0/w1` 库并在结束后停止 API server；`playwright test rich-content-overflow --list` 确认 4 tests in 1 file，含修复所在的 :528 测试） |
| 3 | UUIDv4 形状验证 | `node -e` 正则 + nibble 检查 | forged id 与 `randomUUID()` 均匹配 UUIDv4（version=4，variant=8） |
| 4 | CI 失败证据 | `gh api repos/jnhu76/exam/actions/jobs/{128847373789,128987131154,128987063313}` | 三 job 均 failure（run 42518523050 failure）；日志正文不可取（NOT_AVAILABLE，已过保留期），失败机制由旧代码结构解释 |

## 边界与未覆盖项

- 集成工作树 `/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109` 未定稿，按 ask 在 PR 工作树核对；合并后的组合行为（#924 夹具 × #923 shape gate 同树）由正则匹配静态论证（两者形状兼容），未在集成树运行。
- E2E 运行使用 runner 默认并行（2 shard）；运行的是 rich-content-overflow 单 spec（4 tests），非全量 E2E。
- investigation-ui-acceptance.spec.ts（M3 测试）未运行（E2E 运行为命名单 spec）；其语义审查基于源码逐行核对。
