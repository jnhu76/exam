# 独立复审·第 2 轮（exact SHA 52a58d4d）— REVIEW_RERUN_2

- 复审对象：exact 集成 SHA `52a58d4da7ec51423381510d5e19bff6425965b7`
- 受审工作树：`/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`，branch `integration/production-closure-20261109`
- 模式：**只读复审**。本轮未修改受审工作树任何文件，未 commit / push，未触发任何 CI 重跑。唯一写入是本文（主工作区 `.tmp/...` 下 ask 指定的复审产物路径）。
- 本轮修复记录（ask 原文给定）：本会话零提交、零 push；分支现行 HEAD 与 draft PR #928 headRefOid 一致，均为 52a58d4da7…（由并发进程提交并 push，非本会话所为）；全部 FAIL 记录保留；blocker 根因是 GitHub 账户计费故障，不属仓库文件可修复范畴。
- **裁决：NO_GO**。原 blocker 1（required CI 在集成分支任何 SHA 上从未完成）**未解决**：exact SHA 52a58d4d 上唯一 run 42611431690 为 failure，Static checks 失败注释与原 blocker 引用的计费签名**逐字相同**，6 个 required job 全部 skipped，`gh pr checks 928` 实跑 FAIL（exit 1），#930 仍 OPEN，该 SHA 上 0 绿 run。本轮零文件 delta ⇒ 未引入任何回归，但零改动不构成 closure。

> 证据纪律：以下每条结论均附本轮实跑命令与输出；`W` = `/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`。未执行的检查明确标注「未运行」。
> 路径说明：本文件覆盖了上一轮（复审对象 a5df2c90）的同名 `.tmp` 复审产物；覆盖前已确认其与提交树 `52a58d4d:docs/research/exam-production-integration-closure/reviews/REVIEW_RERUN_2.md`（e97e15fb 引入）逐字节一致（`diff` exit=0，sha256 `f2147bd6…`），历史证据在受控 Git 历史中无损保留。

---

## 0. 确认 HEAD 等于指定 SHA（通过）

```
$ git -C "$W" rev-parse HEAD
52a58d4da7ec51423381510d5e19bff6425965b7
$ git -C "$W" branch --show-current
integration/production-closure-20261109
$ git -C "$W" status --short
（空输出 —— 工作树 clean，无未提交修改）
$ gh pr view 928 --repo jnhu76/exam --json headRefOid,state,baseRefName,title
{"baseRefName":"master","headRefOid":"52a58d4da7ec51423381510d5e19bff6425965b7","state":"OPEN","title":"Integration verification: production closure"}
```

判定：HEAD 与 ask 指定 SHA **完全一致**；PR #928 headRefOid 与之相同（与修复记录声明一致）；工作树 clean，无未提交改动。

## 1. exact SHA 上的 CI（未通过 —— 决定性 blocker 仍在）

```
$ gh api 'repos/jnhu76/exam/actions/runs?head_sha=52a58d4da7ec51423381510d5e19bff6425965b7' --jq '.total_count, ...'
total_count = 1
→ {id:42611431690, name:"CI", status:"completed", conclusion:"failure", run_attempt:1,
   created_at:"2026-11-09T11:44:41Z", head_branch:"integration/production-closure-20261109"}

$ gh api 'repos/jnhu76/exam/actions/runs/42611431690/jobs?per_page=100' --jq '.jobs[] | {name, status, conclusion, started_at}'
Static checks                       → failure（started 11:44:41，约 3 秒即失败）
Build                               → skipped
Production transport regression     → skipped
Web coverage                        → skipped
E2E (shard …)                       → skipped
API coverage                        → skipped
Package coverage                    → skipped

$ gh api repos/jnhu76/exam/check-runs/129140558158 --jq '{head_sha, conclusion}'
{head_sha:"52a58d4da7ec51423381510d5e19bff6425965b7", conclusion:"failure"}
annotations（failure 级）原文：
"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"
（另有一条 ubuntu-latest 迁移 notice，与本裁决无关）

$ gh pr checks 928 --repo jnhu76/exam; echo "exit=$?"
Static checks                     fail      3s
API coverage / Build / CodeRabbit / E2E (shard …) / Package coverage /
Production transport regression / Web coverage   skipping  0
exit=1
```

判定：exact SHA 上**恰好 1 个 run 且为 failure**；失败签名与原 blocker 引用的签名完全一致（Static checks 未启动 + 6 个 required job 全 skipped + 计费注释逐字相同）。`gh pr checks 928` = **FAIL（exit 1）**。该 SHA 上 0 个绿 run、7 个 required job 中 0 个 success。

## 2. 计费根因与 #930（未解决）

```
$ gh issue view 930 --repo jnhu76/exam --json state,title,closedAt
{"closedAt":null,"state":"OPEN","title":"[CI][Infra] GitHub Actions jobs fail pre-start — account billing/spending limit (2026-11-09)"}
```

判定：计费故障 Issue #930 仍 **OPEN**；新 SHA 上 Static checks 的失败注释即计费签名 ⇒ 根因（外部账户计费）在复审时刻**仍未恢复**。修复记录声明的达成条件——「#930 计费恢复后，在最终 exact SHA 的 clean tree 重跑完整 CI（7 个 required job 全 success）」——**未达成**。

## 3. FAIL 记录保留（通过）

```
$ gh api repos/jnhu76/exam/actions/runs/<id> --jq '{id, head_sha, status, conclusion, run_attempt, created_at}'
42607587186 → head_sha=e97e15fb604f…，conclusion=failure，attempt 1，2026-11-09T11:15:38Z
42607941019 → head_sha=b6be2591dfe2…，conclusion=failure，attempt 1，2026-11-09T11:18:12Z
42608435613 → head_sha=f32693c7c6e6…，conclusion=failure，attempt 1，2026-11-09T11:21:47Z
42609620433 → head_sha=0c7350af10df…，conclusion=failure，attempt 2，2026-11-09T11:30:45Z
42611431690 → head_sha=52a58d4da7ec…，conclusion=failure，attempt 1，2026-11-09T11:44:41Z
```

判定：修复记录列出的全部 run（含 42609620433 attempt 2 与 52a58d4d 的 42611431690）**均未删除**，conclusion 均保持 failure。无历史 FAIL 记录被清除或改写。

## 4. 本轮 delta 回归审查（无回归）

此前复审所据 HEAD 为 0c7350af10df34ed4506f2769b7c33526c7d10d5；当前 HEAD 52a58d4d 由并发进程把 4 个未提交 docs 修改提交而成。对二者做 diff：

```
$ git -C "$W" diff --stat 0c7350af10df34ed4506f2769b7c33526c7d10d5..52a58d4da7ec51423381510d5e19bff6425965b7
 docs/research/exam-production-integration-closure/DOCUMENTATION_CONSISTENCY_AUDIT.md |   6 +-
 docs/research/exam-production-integration-closure/FINAL_INTEGRATION_RECORD.md        |  43 ++-
 docs/research/exam-production-integration-closure/FINAL_PRODUCT_ADJUDICATION.md      | 291 ++++++++-------------
 docs/research/exam-production-integration-closure/SHA256SUMS                         |   6 +-
 4 files changed, 152 insertions(+), 194 deletions(-)
```

- **测试/授权/保存语义**：delta 仅含 4 个 docs/证据文件（含其哈希清单），未触任何生产代码、测试、契约或授权路径 ⇒ 无削弱、无绕过。
- **重复实现/新双轨**：delta 为纯文档，未引入任何第二条实现路径或兼容壳。
- **证据自洽性**（本轮实跑）：
  - `git grep -E 'FULL_CI|MERGE_STATUS' 52a58d4d -- …/FINAL_INTEGRATION_RECORD.md`：line 59 `FULL_CI = FAIL`、line 73 `MERGE_STATUS = BLOCKED`，line 145/158/193/225 重申 verdict BLOCKED、未合并、未发布，**无虚假绿灯**。
  - `sha256sum -c SHA256SUMS`（在 `docs/research/exam-production-integration-closure/` 下实跑）：18 项全部 `OK`，exit=0，提交的证据包自洽。
- 附带发现：提交树内 `reviews/REVIEW_RERUN_2.md` 是**上一轮**（复审对象 a5df2c90）的历史复审文档（由 e97e15fb 提交），非伪造、非本轮同名预写；与本文件的关系见文首「路径说明」。

## 5. 逐项确认结论

| 复审项 | 结论 |
| --- | --- |
| 最小修复是否真正解决根因 | **否**。根因为 GitHub 账户计费故障，本轮零提交属合理（无仓库文件可修），但计费未恢复、exact SHA 上仍是 0 绿 run，达成条件未满足 |
| 是否削弱测试/授权/保存语义 | 否。delta 为 4 个 docs/证据文件，未触代码、测试或契约 |
| 是否引入重复实现或新双轨 | 否。同上，纯文档 delta |
| CI 是否在新 SHA 上通过 | **未通过**。唯一 run 42611431690 failure，6 个 required job skipped；`gh pr checks 928` = FAIL（exit 1） |

## 6. 未运行项

- 本轮未运行本地 `pnpm verify` / `pnpm e2e`：ask 未要求，且原 blocker 明确「本地绿灯不替代 required CI」；裁决仅依赖 required CI 事实。
- 未验证查询时刻之后是否会有新的自动触发 run：截至查询时刻 `head_sha=52a58d4d` 恰好 1 个 run；若后续在该 SHA 上出现新 run，不在本轮证据内。
- 计费恢复的确切时间/原因未查：属 GitHub 账户侧信息，仓库与 gh 侧不可见（仅能确认 #930 OPEN 与失败注释签名）。

## 7. 裁决

**NO_GO**。blocker 1（required CI）在 exact SHA 52a58d4d 上仍为 FAIL，根因（外部计费）未恢复，达成条件（7 个 required job 全 success 的绿 CI）未满足；FINAL_INTEGRATION_RECORD 自身亦如实维持 `FULL_CI = FAIL` / `MERGE_STATUS = BLOCKED`。本轮零 delta ⇒ 无回归。解除条件不变：#930 计费恢复后，在最终 exact SHA 的 clean tree 取得完整 required CI 绿灯（Static checks + Build + 3 coverage lanes + Production transport + 2 E2E shards 全 success），保留全部 FAIL 记录，并按 SPEC §7.2 做增量独立复审。
