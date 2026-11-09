# 独立复审 · 第 1 轮（REVIEW_RERUN_1）

## 0. 复审对象与边界

- 被审 exact SHA：`a5df2c90ace6366e69c951e6660dc268327b6e8a`
- 工作树：`/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`（下称 `W`）
- 模式：评审/调查（只读）。不改受控文件、不 commit、不 push、不 merge。本轮唯一写入为本 ask 指定的复审文档；其路径命中 `.gitignore:39:.tmp/`，不污染受控树。
- 依据材料：本轮 ask 给出的「本轮修复记录」与「原 blockers」三项结论（前一轮裁决），以及本轮在 exact SHA 上**实读/实跑**的代码、文档与 `gh` 数据。按 persona 限制「不阅读前一轮裁决的结论以外材料」，未阅读 `reviews/` 目录下前轮 `REVIEW_*.md`。
- 判定口径沿用前一轮：**verdict 的唯一正当理由为 blocker 1**（clean-tree exact-SHA required CI 门禁）；blocker 3 的文档一致性问题为 medium/low，明示「不单独构成 BLOCKED 判据」。

## 1. HEAD 确认（PASS）

| 命令 | 输出 |
| --- | --- |
| `git -C "$W" rev-parse HEAD` | `a5df2c90ace6366e69c951e6660dc268327b6e8a` |
| `git -C "$W" log -1 --format='%H%n%s%n%an%n%ci'` | 同 SHA / `docs(closure): align ADR-025 touchpoints and OBS registry with delivered code` / `jnhu` / `2026-11-09 17:28:49 +0800` |
| `git -C "$W" rev-parse a5df2c90^` | `0b2e2d8a1653ebba59326517ec2fdc6b4c7cf4bc`（与前轮集成 SHA 一致，快进前提成立） |
| `gh api repos/jnhu76/exam/git/ref/heads/integration/production-closure-20261109 --jq '.object.sha'` | `a5df2c90ace6366e69c951e6660dc268327b6e8a` |
| `gh pr view 928 --repo jnhu76/exam --json ...` | `headRefOid=a5df2c90...`, `isDraft=true`, `state=OPEN`, `baseRefName=master`, `mergedAt=null`, `mergeStateStatus=UNSTABLE`, `headRefName=integration/production-closure-20261109` |

**结论：HEAD == 指定 SHA == PR #928 headRefOid == 远端分支 ref；draft、OPEN、未合并。**

## 2. 变更范围（PASS，与修复记录一致）

| 命令 | 输出 |
| --- | --- |
| `git -C "$W" show --numstat --format= a5df2c90` | `41 5 docs/adr/ADR-025-...md`、`34 8 docs/standards/test-flakes.md`（合计 75 insertions / 13 deletions） |
| `git -C "$W" diff-tree --no-commit-id --name-status -r a5df2c90` | `M docs/adr/ADR-025-http-request-correlation-identity.md` + `M docs/standards/test-flakes.md` |
| `git -C "$W" diff --name-status 0b2e2d8a..a5df2c90` | 同上，仅 2 个 `M` 的 `.md` 文件 |
| `git -C "$W" diff --check 0b2e2d8a..a5df2c90` | `EXIT=0`（无空白错误） |
| `grep -nE '^(<<<<<<<|=======|>>>>>>>)'` 两文件 | `EXIT=1`（无冲突标记） |

→ **本修复是纯文档提交**：无生产代码、无测试代码、无 `@exam/contracts` / API Schema、无 SaveAnswer 契约、无授权代码改动。
提交信息正文含显式 **DEFER trace**（4 份研究文档落地路径、SPEC §9 四项交付物 `PRODUCT_BEHAVIOR_MATRIX` / `SAVEANSWER_END_TO_END` / `SECURITY_AND_PRIVACY_VERIFICATION` / `DOCUMENTATION_CONSISTENCY_AUDIT`、CHANGELOG / implementation-status 收口，均留至最终 master merge，不伪造）与 **external-blocker note**（计费故障，非代码可修）。按 AGENTS.md §9（历史过程/临时叙事属 Git），把 defer 与外部阻塞留在提交信息而非长期文档正文，方向正确。

## 3. 原 blockers 逐项核对

### blocker 3（docs，medium/low）→ 已解决 ✅

**F-02（ADR-025 Normative touchpoints 改写为当前态）** — `git -C "$W" show --format= a5df2c90 -- docs/adr/ADR-025-...md` 的 `@@ -140,8 +172,12 @@`：删除了 `in-flight / until they merge / currently carry superseded default-generator wording or placeholder examples`，改为 `These files state the current UUIDv4 id, the #865 x-request-id carrier ... and are consistent with this ADR. If a future change makes one of them diverge, this ADR remains the authority`。独立核验该「旧断言为假」的前提：

- `nl -ba "$W/docs/contracts/api-reference.md" | sed -n '68,76p'` → `:72 "requestId": "550e8400-e29b-41d4-a716-446655440000"`（已是 UUID 示例）。
- `git -C "$W" diff 5140c3dd..0b2e2d8a -- docs/contracts/api-reference.md | wc -l` → `0`（空 diff）。
- `nl -ba "$W/docs/contracts/observability.md" | sed -n '49,65p'` → `:51-55` UUIDv4 / `crypto.randomUUID()` 取代 `KEEP_DEFAULT_OPTION_B`；`:61-62` `Historical logs/audit rows still contain legacy req-<base36> values; do not rewrite them or infer provenance solely from ID shape`。
- `grep -n -iE 'uuid|#865|x-request-id|req-' "$W/docs/contracts/api-contract.md"` → `:93` `x-request-id | every request-lifecycle response (#865) ... ADR-025 UUIDv4 request.id`。
- `nl -ba "$W/docs/deployment/mvp-deployment-runbook.md" | sed -n '1050,1058p'` → `:1054-1056` `server-issued UUIDv4 ... Historical logs may still contain Fastify's old req-<base36> IDs` + UUID 示例。
- 新引入引用的 `docs/operations/save-failure-evidence.md`：`ls` 存在；`:21` 含 `x-request-id` / #924 / allowlisted `requestId` 措辞，`:88` 含 `x-request-id header value`。→ 改写未引入新的不实文件引用。

→ Normative touchpoints 当前文本（`ADR-025:171-183`）已无施工语言、无「被 supersede」假断言，F-02 真实解决。

**F-03（#923 shape gate 入权威文档）** — 同 diff 的 `@@ -100,6 +100,38 @@` 新增 `## Addendum — 2026-11-09, #923`（`ADR-025:103-133`），`Status: RECORDED (informational)`、`amends nothing, supersedes nothing, introduces no new product behavior`。独立核验其关键事实断言：

- `nl -ba "$W/apps/api/src/lib/proctorMonitoringService.ts" | sed -n '205,240p'` → `:211 const REQUEST_ID_UUID_SHAPE = /^...$/i;`；`:219 export function projectSafeMetadata`；`:230-234` `if (key === "requestId") { if (typeof val === "string" && REQUEST_ID_UUID_SHAPE.test(val)) out[key]=val; continue; }`。与附录所记权威位置完全一致。
- `grep -rniE 'requestId' "$W/apps/api/src/authz" "$W/apps/api/src/routes/attempts"` 命中**全部**为 `*.test.ts`；`grep -v '\.test\.ts' | wc -l` → `0`。→ 授权 / SaveAnswer 生产路径无该值读者，附录「形状≠身份（decisions 4-5）」「No authorization or SaveAnswer production path reads client-claimed telemetry requestId」成立。
- 更宽的 `grep -rn 'requestId' "$W/apps/api/src" --include='*.ts' | grep -v '\.test\.ts' | grep -iE 'metadata|claim|client|telemetry|allowlist'` 命中 6 处，逐条核对均为**非**客户端遥测读取：`apps/api/src/routes/audit.ts:86-93,126` 是审计 CSV 导出按 metadata KEY 渲染（注释明写 `no historical rewrite, no shape-based reclassification`）、`apps/api/src/audit/auditWriter.ts:42` 明写 `metadata.requestId is the HTTP writer's key, never fabricated for system rows`、`requestIdHeader.ts:7` 明写 `requestIdHeader: false`、`:152-161` 是 allowlist 的 TRUST 注释。这些恰好**佐证**附录的「stored history vs live projection 两个表面」读法，不构成反例。
- 附录明确写 `**Decision 6 is not narrowed**`、`Narrowing decision 6 ... would require its own superseding decision ... left open here`，未修改/未 supersede 任何 decision；正好对应前轮 F-03 要求「写明是否收窄 decision 6」。

**F-10（§9 交付物 / 研究文档 / CHANGELOG）** — 提交信息以显式 DEFER 留痕，符合前轮 fix 允许的「或显式 DEFER 留痕」路径；且 `git -C /home/hoo/Source/exam merge-base --is-ancestor a5df2c90 master` → `IS_ANCESTOR_EXIT=1`、master 仍为 `5140c3dd`（`Merge pull request #917 ...`）、`mergedAt=null` → 确实未合并到 master，defer 项被真正留到最终 master merge，而非静默丢弃。

→ **blocker 3 的三项（F-02 / F-03 / F-10）均已按前轮要求解决。**

### blocker 2（ci，flake 修复→复审闭环，与 blocker 1 耦合）→ 部分解决 ⚠️

**已解决的一半（F-01 登记册同步，PASS）** — `git -C "$W" show --format= a5df2c90 -- docs/standards/test-flakes.md` 两处 hunk，`nl -ba "$W/docs/standards/test-flakes.md" | sed -n '3340,3395p'` 当前态：

- `:3352 ROOT_CAUSE_CONFIDENCE = HYPOTHESIS`、`:3353 FIRST_CAUSAL_DIVERGENCE = 未执行`、`:3354 CASE_ID = NONE`、`:3356 ISSUE_STATE = OPEN（#878，4 条 Acceptance 未勾选）`、`:3357 OWNER_DECISION = 2026-11-09 明确 defer ... 禁止 retry / 提高 timeout / 减少 shard / 跳过断言`。
- `:3359-3367` 增列 5 个后续权威 occurrence（42378974125 / 42389069178 / 42518523050 / 42564029701 / 42563996915）；`gh api repos/jnhu76/exam/issues/878/comments?per_page=100 --jq '[.[].body] | join("\n")' | grep -oE '...'` → 5 个 run ID **全部**出现在 #878 评论中。
- `:3369-3378` 记录 `1f29b614` 部分修复（1/5 探针、有界 `expect.poll`、未删断言/未加 retry/timeout/skip），并**明确**写「不是 closure」「修复后无 ... post-fix 权威 CI 绿灯（GitHub 账户计费故障，外部非代码）」「本地 pnpm e2e 通过不构成 flake-rate 证明」。
- `:3385-3388` 当前缓解改为「无掩盖性缓解」；`:3390-3395` NEXT_DIAGNOSTIC_ACTION 保持 OPEN / DEFER，「不表述为『已修复』或『完整 CI 通过』」。
- 源码侧：`grep -n 'waitForTimeout(150)' "$W/apps/e2e/e2e/rich-content-overflow.spec.ts"` → `:934/:1011/:1092/:1133`，`grep -c` → `4`（与登记册一致）；`git -C "$W" show --stat --format='%H%n%s' 1f29b614` → 单文件 `rich-content-overflow.spec.ts`，18+/5-；其 diff 显示把该处固定 sleep 换成 `expect.poll(... timeout 5_000).toBeGreaterThan(...)` 并**新增**两处断言（`.katex` count、focused/overflowing 复核），原 `toBeGreaterThan` 断言保留 → 「未删除/放宽断言」属实。
- `gh issue view 878 --repo jnhu76/exam --json number,state,title` → `state=OPEN`；`--json body --jq '.body' | grep -cE '^\s*- \[ \]'` → `4`；`gh api .../issues/878/comments` 末条（2026-11-09T06:29:28Z）明写 `Owner decision (2026-11-09): Further flaky-E2E work is deferred for this round` 且 `no post-fix authoritative CI run has completed because the account is currently blocked by GitHub billing (external, non-code)`。

**未满足的一半（blocker 2 选项 (b) 的「完整权威绿灯」）** — 前轮 fix (b) 要求「修复后新 exact SHA 的完整权威绿灯 + 独立复审」。本轮独立复审确已发生，但「完整权威绿灯」未取得，见 §4.4。故 **blocker 2 未闭合**（登记册本身已诚实标注 OPEN / DEFER，未把 #878 表述为已修复或完整 CI 通过，这一点合规）。

### blocker 1（ci，决定性）→ 未解决 ❌

前轮 blocker 1 的 fix 明确要求「账单恢复后，在 clean tree 的新 exact SHA 重跑完整 CI，取得 **7 个 required job 全部 success** 的真实记录；保留 FAIL 记录不抹除；按 SPEC §7.2 产生新 SHA → 独立复审」，并注明「外部账户条件，代码改动本身不能修复」。本轮产生的新 exact SHA 是 `a5df2c90`，**但 CI 门禁仍未通过**，详见 §4.4。修复记录与提交信息自己也承认 `External blocker NOT fixed by this commit (no code change can fix it)`、`Local pnpm verify / pnpm e2e are green but do not replace CI`。

→ **决定性 blocker 未被解决；这是不能给出 GO 的唯一且充分理由。**

## 4. 四项逐项确认（本轮实跑）

### 4.1 最小修复是否真正解决根因 → **部分：文档类根因已解决，决定性根因未解决**

- 文档一致性根因（blocker 3 的 F-02/F-03/F-10、blocker 2 的 F-01）已通过 2 个文档的定向编辑 + 显式 DEFER 留痕真实解决，且本轮把每一条新文档断言都对照生产代码/权威契约实读核验（§3），未发现新的不实陈述。修复是最小化的：未扩展功能、未改代码。
- **决定性根因**（clean-tree exact-SHA required CI 全绿）**未解决**：CI 在 `a5df2c90` 上仍 `FAIL (exit 1)`，且新 SHA 无任何 green run（§4.4）。该根因是 GitHub 账户计费外部故障，纯文档提交不可能解决，提交信息亦明示。
- 因此「阻塞项已解决」这一复审前提**不成立**。

### 4.2 是否削弱测试/授权/保存语义 → **否（PASS）**

- `git -C "$W" diff --name-status 0b2e2d8a..a5df2c90` → 仅 2 个 `.md`；本修复**未触碰**任何测试文件、E2E 断言、授权代码、SaveAnswer 契约或 `@exam/contracts` Schema。
- 登记册 `:3357` / `:3387-3388` 明写并保留「禁止 retry / 提高 timeout / 减少 shard / 跳过断言」；`1f29b614`（前轮既有、本轮未改）diff 实证：断言未删未放宽、无 skip、无全局 timeout/retry（仅该探针用 5s 有界 `expect.poll` 取代固定 sleep，且新增 2 处断言）。
- 授权语义：附录明写「形状≠身份」「No authorization or SaveAnswer production path reads client-claimed telemetry requestId」，并用 `grep` 实证 authz / attempts 生产路径读者数 = 0（`apps/api/src/authz`、`apps/api/src/routes/attempts` 全部命中为 `*.test.ts`）；decision 6 未被收窄。
- 结论：**未削弱测试/授权/保存语义**。

### 4.3 是否引入重复实现或新双轨 → **否（PASS）**

- 本提交零代码改动，不可能引入第二条实现路径。附录为 `RECORDED (informational)`、`amends nothing, supersedes nothing`，只记录**已存在**的单一 shape gate（`proctorMonitoringService.ts:211` + `:230-234`），并以「两个不同表面（stored history vs live projection）」的精确静态论证收敛前轮 F-03 所记张力；`docs/contracts/observability.md:61-62` 与 `apps/api/src/routes/audit.ts:86-93`（`no shape-based reclassification`）从代码/契约侧佐证该读法，非「挑最方便的一份」。
- ADR-025 仍被声明为唯一权威（`:173-183`），未建立第二权威文档；decision 6 收窄问题被显式留给未来 superseding decision，符合 AGENTS.md §4 的收敛与 authority precedence 要求。
- `git -C "$W" status --porcelain` → 仅 `?? docs/research/exam-production-integration-closure/FINAL_PRODUCT_ADJUDICATION.md`；`ls` 文件存在（38773 bytes, 2026-11-09 17:00）；`git -C "$W" ls-files --error-unmatch <that file>` → `LS_FILES_EXIT=1`（未被跟踪）。→ 前轮既存未跟踪裁决产物**未被暂存/提交/删除**，受控树干净。
- 结论：**无重复实现、无新双轨、既有改动保留完整**。

### 4.4 CI 是否在新 SHA 上通过 → **FAIL (exit 1)，未通过** ❌

| 命令 | 输出 |
| --- | --- |
| `gh pr checks 928 --repo jnhu76/exam` | `Static checks fail 2s`；`API coverage / Build / E2E / Package coverage / Production transport regression / Web coverage` 全部 `skipping`（CodeRabbit 亦 `skipping`）；`PR_CHECKS_EXIT=1` |
| `gh api "repos/jnhu76/exam/actions/runs?head_sha=a5df2c90ace6366e69c951e6660dc268327b6e8a&per_page=100" --jq '{total_count, runs:[...]}'` | `total_count=1`；唯一 run `42593850473`，`conclusion=failure`，`status=completed`，`event=pull_request`，`head_sha=a5df2c90...` |
| `gh api "repos/jnhu76/exam/actions/runs/42593850473/jobs?per_page=100" --jq '[.jobs[] | {name, conclusion}]'` | `Static checks=failure`；`Build / Production transport regression / Package coverage / API coverage / Web coverage / E2E` = 6 × `skipped` |
| 同上 `--jq '[.jobs[] | select(.conclusion=="success")] | length'` | `0`（7 个 required job 无一个 success） |
| 同上 head_sha 查询 `--jq '[.workflow_runs[] | select(.conclusion=="success")] | length'` | `0`（该 exact SHA 无任何 green run） |
| `gh run view 42593850473 --repo jnhu76/exam` | `ANNOTATIONS: X The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings` |
| `gh api "repos/jnhu76/exam/actions/jobs/129081662165/logs"` | `<?xml ...><Code>BlobNotFound</Code> ... gh: HTTP 404`（失败 job 日志不可取，与前轮 `ci-static-job.log` 现象一致） |

→ 新 SHA 的唯一 CI run 为 `failure`，Static checks 因**外部账户计费故障**未启动、6 个 required job 全 skipped、`gh pr checks` = **FAIL (exit 1)**、7 个 required job success 数 = 0、green run 数 = 0。这是**外部非代码**失败，但门禁事实未变：clean-tree exact-SHA required CI 仍未通过，前轮 blocker 1 的「7 个 required job 全部 success」条件未满足。

## 5. 未执行 / 无法验证项（如实记录，不计入 PASS）

- **本轮未自行运行** `pnpm verify` / `pnpm e2e` / `pnpm test` / `pnpm typecheck` / `pnpm lint:*` / `pnpm format:check`。提交信息所述「Local pnpm verify / pnpm e2e are green」与修复记录中的本地绿灯属**给定材料**，本轮未复跑，不作为本轮证据。本修复为纯文档提交，构建/类型/测试层无可回归面；但按证据纪律不把它们报为 PASS。
- `PUSH_EXIT=0` / 「non-force fast-forward push `0b2e2d8a..a5df2c90`」为修复记录给定材料，历史 push 退出码本轮不可复现；本轮仅验证 `a5df2c90^ == 0b2e2d8a` 且远端分支 ref == `a5df2c90`，与快进一致。
- 「无新建分支」：本轮仅确认 PR #928 的 `headRefName` 仍为 `integration/production-closure-20261109` 且 `mergedAt=null`，未枚举远端全部分支做穷尽核对。
- GitHub 计费故障**何时恢复、能否取得全绿 CI** 属外部条件，本轮无法验证，亦无法由任何代码改动解决。
- F-10 的 4 份研究文档与 SPEC §9 四项交付物的**最终落地**按显式 DEFER 留至最终 master merge；本轮不预判其最终形态，仅确认 defer 已留痕且未伪造。
- 未阅读 `reviews/` 下前轮 `REVIEW_*.md`（persona 限制），前轮结论仅取本 ask 给出的「原 blockers」文本。

## 6. 裁决

**verdict = NO_GO**（等价于维持前轮因 blocker 1 未消除的阻塞状态；复审本身已完整执行，不是「无法复审」）。

理由，按证据分层：

1. **可修复的阻塞项已真实解决、且无回归**：blocker 3（F-02 / F-03 / F-10）与 blocker 2 的登记册同步（F-01）全部按前轮要求落地并逐条实读核验；最小修复未削弱测试/授权/保存语义、未引入重复实现或新双轨、未触碰生产/测试代码、保留既存未跟踪产物、受控树干净。这部分修复质量合格。
2. **决定性阻塞项未解决**：CI 在新 exact SHA `a5df2c90` 上仍 `FAIL (exit 1)`（run 42593850473 failure，Static checks 计费故障、6 required job skipped、0 success、0 green run），`gh pr checks 928` 退出码 1。前轮明示「verdict 的正当理由仅为 blocker 1」，blocker 1 的 fix 要求「7 个 required job 全部 success」未满足；blocker 2 选项 (b) 的「修复后完整权威绿灯」同样未满足。
3. 因此「阻塞项已解决且未引入回归」的前半句不成立 → 不能给出 GO。该剩余阻塞是**外部 GitHub 计费故障**，修复记录与提交信息亦已诚实承认，任何进一步的代码/文档轮次都不能替代权威 CI 绿灯。

**GO 的必要条件（非本轮可执行）**：账单恢复后，在 clean tree 上对该 exact SHA（或按 SPEC §7.2 产生的新 exact SHA）重跑完整 CI，取得 7 个 required job 全部 `success` 的真实记录（保留 42572487639 / 42593850473 等 FAIL 记录不抹除），再触发一次独立复审；同时按 #878 Owner defer 的后续条件决定是否闭合 flake 登记册。在此之前维持 draft / OPEN、不合并到 master。
