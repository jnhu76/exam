# DOCUMENTATION_CONSISTENCY_AUDIT — 文档与静态一致性审计

- 状态：**最终交付文档**（SPEC §5.5 / §9 交付物 8）。记录本次交付对长期文档的核查、最小更新、全局一致性搜索与门禁命令结果。
- 集成 SHA：`a5df2c90ace6366e69c951e6660dc268327b6e8a`（任务给定 exact 集成 SHA；本会话 `git rev-parse HEAD` 一致）。
- 裁决权威：`FINAL_PRODUCT_ADJUDICATION.md`（verdict **BLOCKED**，required CI FAIL 外部计费；blocker 3 文档一致性已解决）。未合并、未发布。
- 证据纪律：下列每一项「实查」均为本会话实际执行的命令 / 读取；给定材料（评审、裁决、`pr-body.md`、`logs/`）单独标注，不冒充本会话实跑。

---

## 0. 四个文档一致性门禁（SPEC §5.5）

| Gate | 结论 | 依据 |
| --- | --- | --- |
| `DOC_CONTRACT_CONSISTENCY` | **PASS** | 9 份长期文档中 requestId / SaveAnswer / route / nginx / retention 的当前态表述与代码一致；发现 1 处示例参数名不一致并已修正（§1）。历史文档（研究/归档/历史 release notes）明确标注为历史证据，不作为当前权威。 |
| `DOC_OPERATIONAL_ACCURACY` | **PASS** | `save-failure-evidence.md` 补齐 worked example 与七结果矩阵；`operations/README.md` / `deployment/README.md` 的日志、轮转、脱敏、HTTPS/healthz 说明与 `deploy/nginx/web.conf` 一致；`testing.md` 命令与根 `package.json` scripts 一致。 |
| `DOC_SECURITY_BOUNDARIES` | **PASS** | 当前权威文档无「requestId 证明保存成功」「客户端 telemetry 是独立服务器证据」「nginx 所有日志彻底脱敏」等错误表述；两分法（access-log 隐私 vs error-log 已接受残余）在 4 处载体一致。 |
| `DOC_BUILD_AND_TEST_COMMANDS` | **PASS** | 全局搜索未发现当前权威文档引用不存在的命令；`pnpm test` / `pnpm test:integration` / `pnpm e2e` / `bash scripts/e2e/run.sh` / `pnpm verify` / `pnpm verify:static` / `pnpm format:check` / `pnpm docs:build` 均存在于根 `package.json`。 |

> 这四项是**文档一致性**门禁，不等于 CI 门禁：required CI 在 exact SHA 上仍 FAIL (exit 1)（外部 GitHub 计费，#930 OPEN）；不声称 CI 通过、不声称已合并、不声称已发布。

---

## 1. 九份长期文档：核查与最小更新（SPEC §5 列表）

| 文档 | 核查结果 | 本次动作 | 证据（本会话实查） |
| --- | --- | --- | --- |
| `docs/contracts/observability.md` | request-trace 表 / #865 载体段 / #925 双分法 / JSON 示例均与代码一致；`:34` 示例 `/api/attempts/:id/submit` 与真实路由参数名不符（REVIEW_ARCHITECTURE_DOCS F-02、最终裁决 §2.6 CONFIRMED） | **更新**：`:34` 改为 `:attemptId`；新增 §「Save success, retries and UNKNOWN」补齐 SPEC §5.1 的「保存成功与请求成功的区别 / 重新发送请求关联 / 网络中断 UNKNOWN」 | `grep -n 'attempts/:attemptId/submit' apps/api/src/routes/attempts.candidate.ts` → `:1154` 注释、`:1160` 真实 `"/attempts/:attemptId/submit"`；`git diff -- docs/contracts/observability.md` |
| `docs/contracts/api-contract.md` | §Standard response headers（`:93`）、CORS `exposedHeaders`（`:110`）、`strictPreflight` 400 无 `requestId`（`:141`）、Known follow-ups（`:656`）均当前且自洽 | **核查后无需改动** | 全文 `grep -n -i 'x-request-id\|requestId\|FST_ERR_BAD_URL\|exposedHeaders'`；`awk NR>=75..145 / 648..662` 实读 |
| `docs/operations/save-failure-evidence.md` | F1–F6 + UNKNOWN 矩阵、证据权威层级、#861 决策框均当前且无错误表述 | **更新**：新增 §「Worked example — 200 accepted:false → X-Request-Id → Pino WARN → receipt / domain verification」与七结果对照表（SPEC §5.2） | 全文 Read（149 行）；`git diff -- docs/operations/save-failure-evidence.md` |
| `docs/architecture/exam-system/security-model.md` | INV-CE-005（§15.7）写入/读取/历史三段与代码一致；§15.6 保留条款偏简 | **更新**：§15.6 补齐 SPEC §5.4 的 cutoff 边界、清理失败与补偿、备份恢复旧记录、备份保留期 UNKNOWN 的准确限制 | `grep -n 'INV-CE\|Retention' docs/architecture/exam-system/security-model.md`；`apps/api/src/plugins/clientEventRetention.ts:61-62, 136-186` 实读；`docs/architecture/exam-system/data-authority.md` §13.3；归档 `09-HISTORICAL-DATA-AND-BACKUP-BOUNDARY.md` |
| `docs/adr/ADR-025-http-request-correlation-identity.md` | Decision 1–6、#865 ACCEPTED (amended) 附录、#923 RECORDED (informational) 附录均当前；历史决策正文不得改写 | **只加附录**：新增「Addendum — 2026-11-09, delivery documentation closure (informational)」，`Status: RECORDED (informational)`、`amends nothing, supersedes nothing`、指向 as-built 证据索引、声明 decisions 1–6 不变；未改写任何历史决策 | 全文 Read（183 行）；`git diff -- docs/adr/ADR-025-…md` 仅 `+30` 行插入 |
| `docs/deployment/README.md` | 支持模型 / topology / HTTPS 激活 + port 80 处置 + `/healthz` 豁免 / trusted-proxy / 「release workflow runs no deployment simulation」与 `web.conf` 一致 | **核查后无需改动** | 全文 Read（226 行）；`grep -n 'healthz\|TRUSTED_PROXY_CIDRS\|deployment simulation'` |
| `docs/operations/README.md` | §Logs and Monitoring：access-log 无原始 URL / error 级 Decision A 残余 / 近主机 Docker 权限 / 显式轮转 / 共享前脱敏齐备；未声称「所有日志彻底脱敏」 | **核查后无需改动** | 全文 Read（164 行）；`grep -n -i '彻底脱敏\|fully redacted'` 零命中 |
| `docs/standards/testing.md` | §5 Local Test Matrix 的命令全部存在于根 `package.json`；无 requestId / UUID 过时条款 | **核查后无需改动** | `grep -n -i 'requestId\|UUID\|pnpm test\|pnpm e2e\|scripts/e2e'`；`awk NR>=660..785` 与 `package.json` scripts 比对 |
| `docs/standards/test-flakes.md` | OBS-2026-11-03-001 当前段（`:3352-3395`）与 #878 OPEN / DEFER / HYPOTHESIS / 4 处固定 150ms 一致、无过度声称；但 REVIEW_CI_FLAKE F2/F5 与最终裁决 §5 blocker 2 指出两条新签名未登记 | **更新**：补登 run 42483066387（本会话复核 `conclusion=failure` 且仅 `E2E (shard 2/2)` 失败；并发的 blocker-fix 轮次另外取得 raw log 正文 `128739753640/logs`，确认 `rich-content-overflow.spec.ts:568` `Received: 0` 同一签名，「同族待核」解除）+ `:555 toBeFocused` 与 A3-F7 `:341` 两条新签名 occurrence，并明确「补登只闭合登记信息面，#878 仍 OPEN / 无 post-fix 权威绿灯」；未改 `CASE_ID` / `CASE_STATE` / `ROOT_CAUSE_CONFIDENCE`、未表述为已修复 | `awk NR>=3340..3400` 实读；`gh api "repos/jnhu76/exam/actions/runs/42483066387/jobs?per_page=100"` → 仅 `E2E (shard 2/2)` failure、其余 success（本会话）；给定材料 REVIEW_CI_FLAKE §1.3/§1.7、最终裁决 §2.2/§2.3 |

`git diff --stat` 汇总（本会话）：上述 5 份长期文档 + 本目录交付物；`git diff --check` → exit 0（无空白/冲突标记）。

### 1.1 README / CHANGELOG / Release 文档的处置

- 仓库发布规范唯一权威 `docs/releasing.md`：§Standard release workflow 步骤 5–8 规定 **release-preparation PR** 才选择版本、把 `## [Unreleased]` 条目移入带日期小节、创建 `docs/releases/vMAJOR.MINOR.PATCH.md`；§Changelog contract 规定 CHANGELOG 保持简洁；`.github/workflows/release.yml:41-47` 校验带日期的 CHANGELOG 段与版本 notes。
- 本会话实查：`CHANGELOG.md` `## [Unreleased]` 为空，最新为 `## [0.0.12] - 2026-11-07`；`grep -nE '#92[2-9]|production-closure|x-request-id' CHANGELOG.md` → 零命中；`docs/status/implementation-status.md` 无 #922–#928 条目；`.release-version` 未变更。
- 事实：四个源 PR 全 `OPEN / isDraft=true / mergedAt=null`，PR #928 draft、未合并，无版本发布动作。**未发生发布事实** ⇒ 按任务约束「README/CHANGELOG 仅在仓库发布规范明确要求且事实已发生时更新」，本次**不更新** README / CHANGELOG / Release notes，`## [Unreleased]` 保持为空；这些收口属 `a5df2c90` 提交信息中显式 DEFER 的最终 master merge 条件（SPEC §8.4）。**不声称已发布。**
- 这同时解决了 `BASELINE_AND_OWNERSHIP.md` §9.5 / §13 的历史 UNKNOWN（「是否需要按发布规范更新 = UNKNOWN」）：规范已找到，且无发布事实，故不更新。

---

## 2. 全局一致性搜索（SPEC §5.5 / 任务 §4）

以下为本会话在**整个仓库**执行的搜索（当前权威文档 = `docs/` 中排除 `docs/research/` 与 `docs/archive/`；历史记录 = `docs/research/`、`docs/archive/`、`docs/releases/`、`.tmp`、`logs`）。

### 2.1 旧 requestId 机制描述

```
grep -rInE '无法获取 requestId|HTTP 200 无法|只能(用|使用)时间窗|时间窗调查|KEEP_DEFAULT_OPTION_B|Fastify 默认生成|默认请求 ID|成功保存后获取 requestId|requestId 证明|证明答案已保存|证明.*保存成功' --include='*.md' docs/ README.md README.zh-CN.md CHANGELOG.md | grep -v '^docs/archive/' | grep -v '^docs/research/'
```
命中 3 处，全部为**合法的历史/规范性引用**：`docs/contracts/observability.md:53`（`This supersedes the historical KEEP_DEFAULT_OPTION_B … proposal`）、`docs/adr/ADR-025…md:13`（`SUPERSEDES_RESEARCH_RECOMMENDATION=KEEP_DEFAULT_OPTION_B`）、`docs/adr/README.md:297`（ADR 索引同述）。**未发现**「HTTP 200 无法获取 requestId，只能使用时间窗调查」等旧机制描述。历史目录同样零命中。

### 2.2 旧 SaveAnswer 调查说明 / 错误升级

```
grep -rInE 'requestId.{0,30}(证明|作为).{0,20}(保存|成功)|(保存|成功).{0,30}requestId.{0,20}证明|客户端.{0,15}(遥测|telemetry).{0,30}(独立|服务器证据|权威)|telemetry.{0,30}(server (truth|evidence)|independent)' --include='*.md' docs/ README.md README.zh-CN.md | grep -v '^docs/archive/' | grep -v '^docs/research/'
```
当前权威文档**零命中**：不存在「requestId 证明答案已保存」「成功保存后获取 requestId」「客户端 telemetry 是独立服务器证据」。`docs/operations/save-failure-evidence.md:22` 明确 telemetry「Any server-side fact — it is advisory, never authority」，`:90-97` 明确须与服务端 request log 对照、0 匹配 = 证据缺口（F6）。

### 2.3 旧 nginx 日志等级 / 全部脱敏表述

```
grep -rInE '彻底脱敏|全部日志.*脱敏|所有日志.*脱敏|fully redacted|error_log.{0,20}(crit|warn|notice)|log level.{0,10}crit' --include='*.md' docs/ deploy/ | grep -v '^docs/archive/' | grep -v '^docs/research/'
```
当前权威文档**零命中**。`deploy/nginx/web.conf:65` 实查 = `error_log /var/log/nginx/error.log error;`（`:136` HTTPS 模板同为 `error`）；`:33` 注释记录 Owner Decision A。`crit` / `warn` / 「彻底脱敏」仅出现在**历史归档** `docs/research/exam-secure-observability-remediation/`（`07-NGINX-DIAGNOSTICS-AND-PRIVACY.md:5` 明确标注「未提交 Decision-A 工作树状态（该 commit 内仍是 `error_log … crit;`）」、`FINAL-OWNER-DECISIONS.md:41` 明确「不接受 `error_log crit`」），属历史证据，不是当前权威。

### 2.4 旧 route 存储行为

```
grep -rInE 'normalizeRouteForStorage|pathname-only|pathname only|原始 pathname|raw pathname|任意 route 原始' --include='*.md' docs/ | grep -v '^docs/archive/' | grep -v '^docs/research/'
```
当前权威文档命中 3 处，全部在 `docs/architecture/exam-system/security-model.md:317/323/329`，且均以「pre-#864 regime」「immutable」「never returned raw」「proven leakable」**明确标注为历史旧行为**（当前实现为 `projectClientEventRoute` 封闭词表）。`normalizeRouteForStorage` / pathname-only 作为当前实现的描述仅存在于历史归档 `docs/research/exam-secure-observability-remediation/`（`00-BASELINE.md:87`、`04-PERFORMANCE.md:13` 等，均为修复前取证），无当前权威文档残留。

### 2.5 过时测试命令

```
grep -rInE 'pnpm test:e2e|pnpm --filter @exam/e2e|npm (run )?test|yarn (test|e2e|verify)|pnpm run test|pnpm coverage:|pnpm lint:test|vitest run --config' --include='*.md' docs/ README.md README.zh-CN.md CONTRIBUTING.md | grep -v '^docs/archive/' | grep -v '^docs/research/'
```
当前权威文档零命中过时命令。`docs/standards/testing.md` §5 的 `pnpm test` / `pnpm --filter @exam/api test` / `pnpm --filter @exam/web test` / `bash scripts/e2e/run.sh` / `E2E_WORKERS` 覆盖，以及 `docs/releases/v0.0.2.md:82,148` 的 `pnpm test:deployment:upgrade`、`pnpm test:generate-env`（这两个脚本在当前 `package.json` 中已不存在）——后者是 **v0.0.2 历史 release notes**，属历史记录：命令已退役但文档是历史发布记录，按 AGENTS.md §9 不改写历史。当前权威文档的命令全部与根 `package.json` 一致。

### 2.6 PR / Issue 状态不一致

```
grep -rInE '(已合并|已经合并|已发布|已经发布|merge 完成|merged to master|shipped in master)' --include='*.md' docs/contracts docs/operations docs/architecture docs/adr docs/deployment docs/standards README.md README.zh-CN.md CHANGELOG.md | grep -v '^docs/archive/'
```
命中均为领域语义（`published` 考试状态）或历史 case（`#859` 已合并，真实且与本轮无关），**无**任何文档声称 #922/#923/#924/#926/#928 已合并或本轮已发布。本会话 `gh` 实查：四个源 PR 与 PR #928 全 `OPEN / isDraft=true / mergedAt=null`；#878 `OPEN`；#930 `OPEN`；master `5140c3dd…`；`git merge-base --is-ancestor a5df2c90 master` → exit 1。

### 2.7 历史记录 vs 当前权威的区分（明确清单）

| 类别 | 历史记录（只作证据，不作当前权威） | 当前权威 |
| --- | --- | --- |
| 阶段性研究文档 | 本目录 `BASELINE_AND_OWNERSHIP.md`（其 §2.1 PR head 为阶段一快照、§0 的 verdict 为当时 FAIL）、`REQUEST_ID_GLOBAL_CONTRACT.md`（§0「总体 verdict：FAIL」为阶段二快照）、`UUID_FIXTURE_RECONCILIATION.md`（§0「UUID_FIXTURE_CONTRACT 当前为 FAIL」为整改前快照）、`FLAKE_INVESTIGATION_AND_FIX.md`（§8.4「登记册更新未做」为当时状态，后由 `a5df2c90` 完成） | `FINAL_PRODUCT_ADJUDICATION.md`（verdict BLOCKED）+ 本次 6 份交付文档 + 9 份长期文档 |
| PR #922 证据归档 | `docs/research/exam-secure-observability-remediation/`（含修复前 `normalizeRouteForStorage` / `error_log crit` / 「全部脱敏」被否定的表述） | `docs/architecture/exam-system/security-model.md`、`docs/contracts/observability.md`、`deploy/nginx/web.conf` |
| 历史 release notes | `docs/releases/v0.0.2.md` 中的已退役测试命令；`docs/releases/v0.0.12.md` 记录 ADR-025（#860/PR #912），不含 #922–#926 | 根 `package.json` scripts；`CHANGELOG.md ## [Unreleased]`（当前为空） |
| 临时 / 未跟踪证据 | `.tmp/production-closure/`（SPEC、reviews、logs）、`test-results/`、`coverage/` | 本目录 `reviews/` 与 `SHA256SUMS` 已把证据纳入受控 Git 历史 |

`BASELINE_AND_OWNERSHIP.md` §2.1 的四个 PR head（7243aa5c / d3580f3e / e81b76a1 / 1dd4d206）与当前 `gh pr view` 实查的 head（d545983f / 1f29b614 / 9dd1d5f4 / 1dd4d206）不同 —— 前者是阶段一基线快照，后者是当前源 PR 头；两者都是各自时点的真实记录，不互相覆盖。`pr-body.md` 记录的 merge commits（0b1902d0 / 4919e534 / 9bba9fbf / 0b2e2d8a）进入集成树历史。

---

## 3. §9 交付物与证据纳入受控历史

- 保留 4 份研究文档：`BASELINE_AND_OWNERSHIP.md`、`REQUEST_ID_GLOBAL_CONTRACT.md`、`UUID_FIXTURE_RECONCILIATION.md`、`FLAKE_INVESTIGATION_AND_FIX.md`（未改动）。
- 新增 6 份：`PRODUCT_BEHAVIOR_MATRIX.md`、`SAVEANSWER_END_TO_END.md`、`SECURITY_AND_PRIVACY_VERIFICATION.md`、`DOCUMENTATION_CONSISTENCY_AUDIT.md`、`PERFORMANCE_AND_CI.md`、`FINAL_INTEGRATION_RECORD.md`。
- `FINAL_PRODUCT_ADJUDICATION.md` 以最新裁决为准：本会话先后观察到 18:46「第 3 轮」、18:57「基于四份 §7 独立评审」与 19:37「第 2 轮 · 修复后独立复审裁决」三次并发覆写，**全部裁决字段一致**（verdict BLOCKED、4× KEEP_AND_MERGE、11 PASS + receipt UNCHANGED、CI FAIL、未合并 / 未发布）。最终进入受控历史的是 19:37 的「第 2 轮」版本；该版本为裁决员整篇重写，未保留前版的「附录 D — 交付文档编辑附记」，因此交付编辑的并发/交付说明统一落在 `FINAL_INTEGRATION_RECORD.md` §7–§9，不再跨文件引用附录 D（避免悬空引用）。裁决正文未被本角色改写。
- `reviews/` 复制 7 份评审，字节一致（本会话 `cmp -s` 逐文件 OK）。
- `SHA256SUMS` 对本目录交付文件与 `reviews/` 取相对路径 sha256；`sha256sum -c SHA256SUMS` 验证结果见 §5。
- 以上把 SPEC §9「不能依赖未跟踪 `.tmp` 作为唯一交付依据」在**集成分支**上闭合；`CHANGELOG` / `implementation-status` / 四 PR 逐个合并 / 门禁绿后的 master smoke 仍属 SPEC §8.4 最终 master merge 条件，**未执行**。

---

## 4. 残留文档/一致性项（不隐瞒）

1. `apps/api/src/openapi/swagger.ts` 401/403 fallback schema 顶层 `requestId` 与 `openapi.json` 203 处顶层 `requestId`：master 预存制品漂移，四 PR 未触达（`git diff` 零改动），运行时 envelope 正确；单独 follow-up（修 `swagger.ts` 并重新生成）。
2. `api.getWithMeta` 无生产调用方，且 `observability.md` / `api.ts:411` 以「documented forward surface, not dead code」为其辩护，与 AGENTS.md §3 张力；删除或取得 Owner 显式授权属最终 master 收口，本轮文档角色不改产品代码。
3. P1 代表性夹具残差：web 单测以 `req-*` 模拟服务端 envelope/header（client 不校验形状，不导致集成红）；按 `UUID_FIXTURE_RECONCILIATION.md` §3 下次触碰时统一。
4. `docs/adr/README.md:297` ADR-025 索引行未提及 2026-11-09 informational 附录（informational 附录 amend nothing，不加行不算错误；可选改进）。
5. `docs/standards/test-flakes.md`：两条新签名已补登，但 #878 仍 OPEN/DEFER、4 条 Acceptance 未勾选、`CASE_ID = NONE`、无 instrumented 采样序列、无 post-fix 权威绿灯（外部计费）；登记 ≠ 闭合。
6. `CHANGELOG.md ## [Unreleased]`、`docs/status/implementation-status.md` 仍为空 / 无条目 —— 显式 DEFER 到最终 master merge（SPEC §8.4），非静默漂移。

---

## 5. SHA256SUMS

生成命令（在本目录内，相对路径）：

```bash
cd docs/research/exam-production-integration-closure
{ ls -1 *.md; ls -1 reviews/*.md; } | sort | xargs sha256sum > SHA256SUMS
sha256sum -c SHA256SUMS
```

校验结果：在 `SHA256SUMS` 最终生成后于本目录实跑 `sha256sum -c SHA256SUMS` → 全部条目 `OK`、`0 FAILED`、退出码 `0`（命令清单见 §6）。校验不修改任何被哈希文件，故结果对提交态成立。

---

## 6. 文档 / 静态检查（任务 §6，命令与退出码）

| 命令（本会话实跑，工作目录见各条） | 退出码 | 输出摘要 |
| --- | --- | --- |
| `pnpm format:check`（仓库根） | **`0`** | `prettier --check .` → `Checking formatting... All matched files use Prettier code style!`（`/tmp/closure-format-check.log`） |
| `pnpm docs:build`（仓库根） | **`0`** | `Projected 16 pages (8 canonical projections)`；vitepress `build complete in 7.49s.`；`check-site.mjs` 10 项全 PASS（allowlist 8/8、16 页哈希、16 路由、中英路由对应、380 内部链接与片段、16 路由可达、130 permalinks、404、search index en/zh 各 50 documents）→ `All documentation checks passed.`（`/tmp/closure-docs-build.log`） |
| `sha256sum -c SHA256SUMS`（本目录，最终生成后） | **`0`** | 全部条目 `OK`、`0 FAILED` |

> 说明：两条 `pnpm` 命令均取自根 `package.json` scripts，未用更快替代品；`docs:build` 生成物（`docs-site/content/`、`.vitepress/dist/`）被 `.gitignore` 忽略，`git status --short` 复核无新增受控文件。`pnpm format:check` 为 `prettier --check .`，而 `.prettierignore` 含 `*.md`，因此该门禁**不校验 Markdown 文件**；本目录交付物与长期文档均为 `.md`，故其 PASS 不代表对新文档做了格式校验，文档一致性依赖本审计的 review。`docs:build` 的 `project-content.mjs` 生成 `docs-site/content/`，`check-site.mjs` 校验站点导航/链接（本目录 research 文档不在 docs-site 的 16 页 allowlist 内，故不影响站点门禁）。

**attempt 1 复核（本 ask，全部 exit 0）**：`pnpm --filter @exam/api api:openapi:check` → `openapi.json is up to date.`（生成物无漂移）；`pnpm docs:build` → check-site.mjs 10 项全 PASS（380 内部链接与片段、16 路由、130 permalinks、search index en/zh 各 50 documents）；`pnpm format:check` → `All matched files use Prettier code style!`；`sha256sum -c SHA256SUMS` → 18 条目全 OK / 0 FAILED；`git diff --check` → 0。结论：**不存在文档 / 链接 / 生成物缺陷**；最终 exact-SHA CI FAIL（attempt 1，run `42608435613`，`Static checks fail 1s` + 6 required job `skipping` + `CodeRabbit skipping`）是外部 GitHub 计费导致 job 未启动，不是本类问题，不由代码/文档改动修复（#930 OPEN）。诊断、命令与处置见 `FINAL_INTEGRATION_RECORD.md` §8；四个文档一致性门禁仍 PASS，不声称 CI 通过、不声称已合并、不声称已发布。

**attempt 2 复核（本 ask，全部 exit 0，覆盖 CI Static checks 的完整作用域）**：实读 `.github/workflows/ci.yml:33-92`，CI 的 `Static checks` job 恰好执行 `pnpm verify:static`(:87) 与 `pnpm docs:build`(:92)。在 exact 树上本地实跑：`pnpm verify:static` → exit 0（`pnpm format:check && pnpm lint && pnpm lint:arch && pnpm lint:db-config && pnpm lint:db-journal && pnpm lint:env-contract && pnpm lint:env-surface && pnpm lint:eslint && pnpm typecheck && pnpm --filter @exam/api api:openapi:check`；`All matched files use Prettier code style!`、`Architecture checks passed.`、typecheck `Tasks: 17 successful, 17 total`、`openapi.json is up to date.`）；`pnpm docs:build` → exit 0（10 项 PASS）。⇒ **CI Static checks 作用域内不存在任何文档 / 链接 / 生成物缺陷**；attempt 2 的 FAIL（run `42609620433`）与 attempt 1 同签名，仍是外部计费使 job 未启动（ANNOTATIONS 原文见 `FINAL_INTEGRATION_RECORD.md` §9）。四个文档一致性门禁 **PASS** 保持不变；`DOC_BUILD_AND_TEST_COMMANDS` 由完整 `verify:static` 实跑进一步加固。不声称 CI 通过、不声称已合并、不声称已发布。

---

## 7. 结论

四个文档一致性门禁 **PASS**（§0），9 份长期文档全部核查、5 份最小更新（其中 ADR 只加信息性附录、registry 只补登记不改闭合状态），README/CHANGELOG 按发布规范不更新，全局搜索未发现当前权威文档残留旧机制描述，历史记录与当前权威已明确区分。required CI 仍 FAIL (exit 1)（外部计费）——这是**外部门禁**，与文档一致性 PASS 正交；不声称 CI 通过、不声称已合并、不声称已发布。

**并发写入说明（如实记录）**：本会话写入期间检测到同一 worktree 上还有其它代理进程活动——`FINAL_PRODUCT_ADJUDICATION.md` 被裁决进程先后覆写为三版（18:46「第 3 轮」/ 18:57「基于四份 §7 独立评审」/ 19:37「第 2 轮 · 修复后独立复审裁决」，裁决字段全部一致，最终入库的是 19:37 版；并发与口径差异见 `FINAL_INTEGRATION_RECORD.md` §9）；另一个 blocker-fix 轮次复核了 run 42483066387 的 raw log 正文并据实更新了 `docs/standards/test-flakes.md` 中该 occurrence 的措辞（「同族待核」解除，确认为同签名）。本提交以最终落盘状态为准；并发复核只加强证据，不改变 #878 OPEN / DEFER、verdict BLOCKED 或未合并 / 未发布结论。19:37 版整篇重写移除了前版的「附录 D」，故本节及交付清单中的跨文件引用已改指向 `FINAL_INTEGRATION_RECORD.md` §7–§9，避免悬空引用。
