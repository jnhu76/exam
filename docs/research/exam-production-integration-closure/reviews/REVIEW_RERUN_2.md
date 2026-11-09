# 独立复审（第 2 轮）— REVIEW_RERUN_2

- 复审对象：exact 集成 SHA `a5df2c90ace6366e69c951e6660dc268327b6e8a`
- 受审工作树：`/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`，branch `integration/production-closure-20261109`
- 模式：**只读复审**。未修改受审工作树任何文件；未 commit / push / merge / force-push / reset；未触发 CI 重跑。唯一写入是本文（主工作区 `.tmp/...` 下的复审产物）。
- 本轮修复记录（ask 原文给定）：`NO_COMMIT (HEAD a5df2c90) / none (no tracked file changed; no commit)`；`git -C ... status --short` → 仅 `?? docs/research/exam-production-integration-closure/FINAL_PRODUCT_ADJUDICATION.md`（既有 adjudicator 产物，读取但未修改，按 owner 指令保护）；`git diff --stat` → 空；HEAD 未变。
- 原 blockers（ask 原文给定）：blocker 1（ci，决定性）= clean-tree exact-SHA required CI FAIL（run 42593850473 failure，Static checks 因 GitHub 计费故障未启动、6 个 required job 全 skipped，`gh pr checks 928` = EXIT=1，0 success job / 0 green run）；blocker 2（ci）= flake 修复→复审闭环未闭合 / #878 仍 OPEN / 无 post-fix 完整权威绿灯。
- **裁决：NO_GO**。两个原 blockers 均未解决；命名检查 `gh pr checks 928` 实跑仍为 FAIL（exit 1）。本轮零改动 ⇒ 未引入任何回归，但零改动不构成 closure；外部计费故障属代码/文档轮次之外，复审只能确认其当前 FAIL 状态，不能产出绿灯。

> 证据纪律：以下每条结论都附本轮实跑命令与输出；`W` = `/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`。未执行的检查明确标注「未运行」。

---

## 0. 先确认 HEAD 等于指定 SHA（通过）

```
$ git -C "$W" rev-parse HEAD
a5df2c90ace6366e69c951e6660dc268327b6e8a          EXIT=0
$ git -C "$W" rev-parse 'HEAD^{tree}'
736a38f6e37f8434a87a27594701c95096152f53
$ git -C "$W" branch --show-current
integration/production-closure-20261109
$ git -C "$W" log -1 --format='%H%n%P%n%ci%n%s'
a5df2c90ace6366e69c951e6660dc268327b6e8a
0b2e2d8a1653ebba59326517ec2fdc6b4c7cf4bc
2026-11-09 17:28:49 +0800
docs(closure): align ADR-025 touchpoints and OBS registry with delivered code
$ git -C "$W" status --short
?? docs/research/exam-production-integration-closure/FINAL_PRODUCT_ADJUDICATION.md
$ git -C "$W" status --porcelain=v1
?? docs/research/exam-production-integration-closure/FINAL_PRODUCT_ADJUDICATION.md
$ git -C "$W" diff --stat                → 空（diff_exit=0）
$ git -C "$W" diff --cached --stat       → 空
$ gh pr view 928 --repo jnhu76/exam --json number,state,headRefOid,headRefName,baseRefName
{"baseRefName":"master","headRefName":"integration/production-closure-20261109","headRefOid":"a5df2c90ace6366e69c951e6660dc268327b6e8a","number":928,"state":"OPEN"}
```

判定：HEAD 与指定 SHA **完全一致**；PR #928 的 headRefOid 亦为该 SHA。工作树除 1 个未跟踪文档外 clean，无 tracked 改动、无 staged 改动、无新 commit、**无新 exact SHA**（log 顶部仍是 a5df2c90，父提交为 0b2e2d8a）。tree hash `736a38f6…` 即 a5df2c90 的树，与第 1 轮复审所据 SHA 为同一提交 ⇒ 本轮不存在任何树级 delta。

---

## 1. 命名检查：CI 是否在新 SHA 上通过 → **FAIL (exit 1)**（实跑）

```
$ gh pr checks 928 --repo jnhu76/exam ; echo "PR_CHECKS_EXIT=$?"
Static checks	fail	2s	https://github.com/jnhu76/exam/actions/runs/42593850473/job/129095858743
API coverage	skipping	0	https://github.com/jnhu76/exam/actions/runs/42593850473/job/129095878711
Build	skipping	0	https://github.com/jnhu76/exam/actions/runs/42593850473/job/129095878610
CodeRabbit	skipping	0	https://coderabbit.ai?utm_source=cr_app&utm_medium=github
E2E (shard ${{ matrix.shardIndex }}/${{ matrix.shardTotal }})	skipping	0	.../job/129095879681
Package coverage	skipping	0	.../job/129095879088
Production transport regression	skipping	0	.../job/129095879355
Web coverage	skipping	0	.../job/129095878701
PR_CHECKS_EXIT=1
```

即：1 个 `fail`（Static checks）+ 7 个 `skipping`（其中 6 个是 GitHub required job，另 1 个是外部 CodeRabbit）；`PR_CHECKS_EXIT=1` ⇒ **FAIL**。

```
$ gh api "repos/jnhu76/exam/actions/runs?head_sha=a5df2c90ace6366e69c951e6660dc268327b6e8a&per_page=100" \
    --jq '{total_count, runs:[.workflow_runs[]|{id,conclusion,status,event,head_sha}]}'
{"runs":[{"conclusion":"failure","event":"pull_request","head_sha":"a5df2c90ace6366e69c951e6660dc268327b6e8a","id":42593850473,"status":"completed"}],"total_count":1}

$ gh api "repos/jnhu76/exam/actions/runs?head_sha=a5df2c90ace6366e69c951e6660dc268327b6e8a&per_page=100" \
    --jq '[.workflow_runs[]|select(.conclusion=="success")]|length'
0

$ gh api "repos/jnhu76/exam/actions/runs/42593850473/jobs?per_page=100" --jq '[.jobs[]|{name,conclusion}]'
[{"conclusion":"failure","name":"Static checks"},
 {"conclusion":"skipped","name":"Build"},
 {"conclusion":"skipped","name":"Web coverage"},
 {"conclusion":"skipped","name":"API coverage"},
 {"conclusion":"skipped","name":"Package coverage"},
 {"conclusion":"skipped","name":"Production transport regression"},
 {"conclusion":"skipped","name":"E2E (shard ${{ matrix.shardIndex }}/${{ matrix.shardTotal }})"}]

$ gh api "repos/jnhu76/exam/actions/runs/42593850473/jobs?per_page=100" \
    --jq '[.jobs[]|select(.conclusion=="success")]|length'
0

$ gh run view 42593850473 --repo jnhu76/exam       # ANNOTATIONS 段
X The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings
Static checks: .github#1

$ gh api "repos/jnhu76/exam/actions/runs?branch=integration/production-closure-20261109&per_page=20" \
    --jq '{total_count, runs:[.workflow_runs[]|{id,head_sha,conclusion,status,event,created_at}]}'
{"runs":[{"conclusion":"failure","created_at":"2026-11-09T09:29:45Z","event":"pull_request","head_sha":"a5df2c90ace6366e69c951e6660dc268327b6e8a","id":42593850473,"status":"completed"},
         {"conclusion":"failure","created_at":"2026-11-09T06:20:59Z","event":"pull_request","head_sha":"0b2e2d8a1653ebba59326517ec2fdc6b4c7cf4bc","id":42572487639,"status":"completed"}],"total_count":2}
```

判定：head_sha 唯一 run 42593850473 = `failure`；success-run 计数 **0**、success-job 计数 **0**、head_sha green-run 计数 **0**；分支仅 2 个 run（42572487639 / 42593850473）均 failure，无第三个（新 SHA）run，无绿灯。**不存在「新 exact SHA」**（§0），blocker 1 fix 条件「账单恢复后在 clean tree 的新 exact SHA（或同 SHA 权威 gate run）上重跑完整 CI、7 个 required job 全部 success」未执行也未满足。

补充一致性：ask 原 blockers 记录的 FAIL run、6× skipped、0 green、计费注解，本轮逐条实跑复现，未发现状态被抹除或改写（42572487639 / 42593850473 两条 FAIL 记录仍在）。

---

## 2. #878 / flake 闭环状态（blocker 2，实跑）

```
$ gh issue view 878 --repo jnhu76/exam --json number,state,title
{"number":878,"state":"OPEN","title":"[CI][Flake] rich-content-overflow geometry: fixed 150ms wait races Chrome arrow-key scroll (scrollLeft 0 under 2-shard load)"}

$ gh issue view 878 --repo jnhu76/exam --json body --jq '.body' | grep -cE '^\s*- \[ \]'
4

$ gh api "repos/jnhu76/exam/issues/878/comments?per_page=100" --jq '.[-1]|{created_at,user:.user.login,body}'
{"created_at":"2026-11-09T06:29:28Z","user":"jnhu76","body":"... 'Why this is not closure' ... 'this issue stays OPEN' ... 'no post-fix authoritative CI run has completed because the account is currently blocked by GitHub billing (external, non-code)' ... 'Further flaky-E2E work is deferred for this round' ..."}
```

登记册（受审树 `docs/standards/test-flakes.md`）实读：

- `:3356` `ISSUE_STATE = OPEN（#878，4 条 Acceptance 未勾选）`
- `:3357` `OWNER_DECISION = 2026-11-09 明确 defer：本轮不再扩展 flaky-E2E 工作；禁止 retry / 提高 timeout / 减少 shard / 跳过断言`
- `:3369` 标题 `### 已交付的部分修复（不是 closure，#878 仍 OPEN）`
- `:3374` `未删除/放宽断言，未加 retry、全局 timeout 或 skip。`
- `:3379-3381` `同一族其余 4 处固定 150ms（修复后 :934/:1011/:1092/:1133）未纳入；FIRST_CAUSAL_DIVERGENCE 仍未执行；修复后无 2-shard 负载下 instrumented 采样证据，也无 post-fix 权威 CI 绿灯（GitHub 账户计费故障，外部非代码）。本地 pnpm e2e 通过不构成 flake-rate 证明。`
- `:3392-3395` `本条目保持 OPEN / DEFER，不表述为「已修复」或「完整 CI 通过」。`

`git -C "$W" diff 0b2e2d8a..HEAD -- docs/standards/test-flakes.md` 实读：a5df2c90 对登记册的改动正是新增上述 OPEN / defer / 5 个 occurrence / 1f29b614 部分修复 / NEXT_DIAGNOSTIC_ACTION 措辞，未把 CASE_ID 从 NONE 改掉、未标 CASE_STATE、未写「已修复/完整 CI 通过」。即 F-01 登记册同步保持准确，**无过度声称**。

判定：blocker 2 的两条路径都未闭合 —— (a) 按 #878 Acceptance 闭合：4 条 acceptance 全未勾选、CASE_ID = NONE、无 instrumented 采样序列、无 5 处统一、无 ≥5 次连续通过；(b) 维持 defer：defer 自身成立，但其前置条件「修复后新 exact SHA 的完整权威绿灯 + 独立复审」中绿灯未取得（§1，0 green run）。两个 blockers 相互耦合，决定性 blocker 1 未解 ⇒ blocker 2 亦未解。

---

## 3. 逐项确认（ask 要求四点）

### 3.1 最小修复是否真正解决根因 → **否**

本轮修复记录为 `NO_COMMIT / none`：§0 已证零 tracked 改动、零 staged 改动、零 commit、HEAD 与 tree 均未变，`git show --stat HEAD` 显示 a5df2c90 自身只改 2 个文档（`docs/architecture/.../ADR-025-...md` 46 行、`docs/standards/test-flakes.md` 42 行）。因此**不存在可被评估的「最小修复」**；根因未被任何修复动作触及：

- blocker 1 根因 = 外部 GitHub 账户计费故障（§1 注解实读），其 fix 要求「账单恢复后重跑完整 CI 取得 7 个 required job 全 success 的真实记录」；零改动 + 当前 FAIL 表明该条件未满足。ask 原记录亦自认「External blocker NOT fixed by this commit (no code change can fix it)」。
- blocker 2 根因 = #878 未闭合 / 无 post-fix 完整权威绿灯（§2）；同样未满足。
- Owner (A) 指令「无 root-cause code fix 存在」与零改动一致；但按 AGENTS.md 第 7/11 节，零改动只能如实报告为「未闭合」，不能表述为 closure。

### 3.2 是否削弱测试 / 授权 / 保存语义 → **否（本轮未引入任何削弱）**

- `git diff --stat` 与 `git diff --cached --stat` 均为空；HEAD tree `736a38f6…` 与第 1 轮所据 SHA 为同一提交 ⇒ 无树级 delta，授权/保存/答题状态机/版本化答案等语义文件零改动。
- 测试语义实读：`grep -c 'waitForTimeout(150)' "$W/apps/e2e/e2e/rich-content-overflow.spec.ts"` → **4**（`grep_exit=0`），行号 `:934 / :1011 / :1092 / :1133`；`grep -nE 'test\.skip|describe\.skip|retries|setTimeout\(|test\.setTimeout|expect\.poll|waitForTimeout\(150\)'` 另见 `:436 test.setTimeout(180_000)`。
- 溯源 `git blame`：`:436`、`:934`、`:1092`、`:1133` 来自 `d3405acfd`（2026-11-02 04:45:54），`:1011` 来自 `ffa9e745c`（2026-11-02 05:11:50），**全部早于** `1f29b614` 与本轮，非本轮引入；`test.setTimeout(180_000)` 是既有的 per-test 超时，不是本轮新增的全局 timeout。
- 登记册 `docs/standards/test-flakes.md:3374` 明载 1f29b614「未删除/放宽断言，未加 retry、全局 timeout 或 skip」，`:3386-3388`「无掩盖性缓解…禁止用调大 timeout / 加 retry / 减少 shard 掩盖」。未发现 skip / retry / 降低断言 / 替换真实依赖的迹象。

### 3.3 是否引入重复实现或新双轨 → **否**

零改动 ⇒ 无新代码路径、无兼容壳、无第二条实现。`git show --stat HEAD` 仅收敛既有两份长期文档的措辞（ADR-025 touchpoints、OBS 登记册），未新增文件、未新增 helper、未保留新旧双轨。唯一未跟踪文件 `FINAL_PRODUCT_ADJUDICATION.md` 是 adjudicator 产物、未纳入交付树；本复审仅 `stat` 读取（`size=40120 mtime=2026-11-09 17:54:32.597717073 +0800`），**未修改**。

### 3.4 CI 是否在新 SHA 上通过 → **FAIL (exit 1)**

见 §1：`gh pr checks 928` → `PR_CHECKS_EXIT=1`；head_sha 唯一 run 42593850473 = failure，0 success job / 0 green run，计费注解「recent account payments have failed」。且「新 SHA」本身不存在（§0），因此 blocker 1 fix 要求的「新 exact SHA 上重跑完整 CI」没有任何执行记录。本地 `pnpm verify` / `pnpm e2e` **本轮未运行**（见 §4），按 blocker 1 定义与 AGENTS.md 第 7 节，本地绿灯不能替代 required CI 权威绿灯；ask 原记录中「Local pnpm verify / pnpm e2e are green but do not replace CI」的声称本轮未复核、也不作为通过依据。

---

## 4. 未运行 / 无法核验（如实列出）

1. **本地 `pnpm verify` / `pnpm e2e`：未运行**。ask 命名的检查是权威 CI gate（`gh pr checks 928` + head_sha run 查询），本人按「Run the check the ask names」实跑；本地套件不是该检查，运行它并当作 CI 结果属于以更快替代品冒充命名检查，故不运行、不引用。修复记录中「local green」的声称本复审未复核。
2. **未触发 `gh run rerun` / 未产生新权威 run**：计费故障属外部账户条件，重跑不会生成 required job 全 success 的记录；且触发 CI 属写操作，超出只读复审范围。
3. **外部账单状态与恢复时间**：不可查、超出复审范围；只能确认 §1 的 FAIL 与计费注解。
4. **未跟踪文件 `FINAL_PRODUCT_ADJUDICATION.md` 是否在修复轮被改动**：无基线哈希（主工作树 `/home/hoo/Source/exam/docs/research/exam-production-integration-closure/` 下无同名文件可比对），因此**无法证明**它「读取但未修改」；可确认的是它未纳入交付树、本复审未修改、按 owner 指令保持保护。
5. **未对全仓授权/保存语义做全量静态审计**：本轮零改动，按 SHA 同一性（tree `736a38f6…`）判定无新增语义变更；未做全量代码审计，也不把「未逐文件审计」表述为已审计。
6. **未阅读前一轮裁决结论以外的材料**：未打开 `.tmp/production-closure/reviews/` 下其它 REVIEW_*.md；本复审只依据 ask 给定的 blockers 原文与对 exact SHA 的实跑/实读。

---

## 5. 结论

- **NO_GO**。两个原 blockers 均未解决：决定性 blocker 1 的权威 CI 仍是 FAIL（exit 1），0 success job / 0 green run / 无新 SHA；blocker 2 的 #878 仍 OPEN、4 条 acceptance 未勾选、无 post-fix 完整权威绿灯。
- **未引入回归**：本轮零 tracked 改动、零 commit，tree 与第 1 轮所据 SHA 相同；测试/授权/保存语义无削弱，无重复实现或新双轨，登记册与「已交付部分修复 + defer + OPEN」一致、无「已修复/完整 CI 通过」的过度声称。但「无回归」不等于「阻塞项已解决」。
- 外部计费故障是任何代码/文档轮次都无法替代的条件；按 blocker 1 的 fix，必须等账单恢复后在新 clean-tree exact SHA（或同 SHA 权威 gate run）上取得 7 个 required job 全 success 的真实记录，保留 42572487639 / 42593850473 两条 FAIL 不抹除，再按 SPEC §7.2 产生新 SHA 并重新独立复审。当前状态不满足该条件。
