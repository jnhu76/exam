# REVIEW_RERUN_1 — 独立复审（第 1 轮，修复后 exact SHA）

- 复审对象 exact SHA：`b6be2591dfe28b2fe17e53d84d11b37330a81f40`
- Worktree：`/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`
- 复审日期：2026-11-09
- 复审性质：只读独立复审。只依据本轮实际执行的命令与输出、及 ask 给定的前轮裁决结论；不引用其他历史材料。
- **Verdict：BLOCKED**（Blocker 1 未解决：required CI 在 exact SHA 上仍未完成，同一外部 billing 故障；Blocker 2 已正确解决；无回归引入）

## 0. SHA 确认

```
$ cd /home/hoo/Source/exam-gap-worktrees/integration-closure-20261109 && git rev-parse HEAD
b6be2591dfe28b2fe17e53d84d11b37330a81f40        # ✓ 与 ask 一致
$ git status --short
(空 — 工作树干净)
$ git log --oneline -3
b6be2591 docs(closure): record post-push CI state in final record   ← HEAD
e97e15fb docs(closure): deliver final integration records ...       ← 本轮修复 commit（HEAD 父提交）
a5df2c90 docs(closure): align ADR-025 touchpoints and OBS registry with delivered code
```

注意：HEAD 在修复 commit `e97e15fb` 之上还有一个补记 commit `b6be2591`（改 `FINAL_INTEGRATION_RECORD.md` / `FINAL_PRODUCT_ADJUDICATION.md` / `SHA256SUMS`，全为 closure 记录文档）。二者均在被审 SHA 内。

## 1. Blocker 1 复审：required CI 全绿 — **未解决（high）**

前轮要求：billing 恢复后在最终 exact SHA 上完整复跑 CI（Static checks + Build + 3 coverage lanes + Production transport + 2 E2E shards all success），SPEC §7.2/§8.1.7 硬门禁。

本轮实查（全部为本会话执行）：

```
$ gh api 'repos/jnhu76/exam/actions/runs?head_sha=b6be2591dfe28b2fe17e53d84d11b37330a81f40'
→ 唯一 run 42607941019, name=CI, event=pull_request, status=completed,
  conclusion=failure, created_at=2026-11-09T11:18:12Z, head_branch=integration/production-closure-20261109

$ gh api repos/jnhu76/exam/actions/runs/42607941019/jobs
→ Static checks                       = failure
  Build                               = skipped
  E2E (shard ${{…}}/${{…}})           = skipped
  Web coverage                        = skipped
  Package coverage                    = skipped
  API coverage                        = skipped
  Production transport regression     = skipped

$ gh api repos/jnhu76/exam/check-runs/129128580103/annotations
→ failure: "The job was not started because recent account payments have failed
  or your spending limit needs to be increased. Please check the 'Billing & plans'
  section in your settings"     ← 与前两轮失败逐字相同的 billing 注释；job steps 为空（从未启动）

$ gh pr checks 928 ; echo exit=$?
→ Static checks fail；Build / API coverage / E2E shard / Package coverage /
  Production transport regression / Web coverage 全部 skipping
→ exit=1

$ gh issue view 930 --repo jnhu76/exam --json number,state,title
→ {"number":930,"state":"OPEN","title":"[CI][Infra] GitHub Actions jobs fail pre-start — account billing/spending limit (2026-11-09)"}
```

判定：

1. SPEC §7.2 要求的 required-CI 全绿在 `b6be2591` 上**从未发生**：0 个 success 的 required job，`gh pr checks 928` 语义为 FAIL（exit 1），与前轮失败形态同源（同一 billing annotation）。
2. 外部条件未恢复：#930（billing）仍 OPEN。这不是任何代码/文档改动可修复的条件，与本轮修复记录的自述一致（修复记录仅声称闭合 blocker 2 的登记信息面，未声称 CI 已绿）。
3. **诚实性正面确认**：HEAD commit `b6be2591` 的补记（`docs/research/exam-production-integration-closure/FINAL_INTEGRATION_RECORD.md` §7）明确写有「**这不是绿 CI**：7 个 required job 在新 HEAD 上零执行 / 零 success」「`FULL_CI = FAIL` / `MERGE_STATUS = BLOCKED` … **不变**」「不声称 CI 通过、不声称已合并、不声称已发布」。最终记录如实反映 CI 状态，无虚假绿灯。
4. 已知自洽限制：commit 无法自含自身 SHA 的 run 记录——补记记录的是 `e97e15fb` 时点（当时 0 runs）；`b6be2591` push 后触发的 run 42607941019（failure）由本复审补录在案。

结论：Blocker 1 维持 **BLOCKED**，性质与前轮相同（外部 GitHub 账户计费）。gate 未过，不可放行合并。

## 2. Blocker 2 复审：flake/occurrence 登记面 — **已解决**

in-scope 文件唯一：`docs/standards/test-flakes.md`（e97e15fb 中 +11 行，diff 已逐行核读）。逐项对账修复记录：

| 修复记录子项 | 落点（工作树行号） | 本轮验证 |
| --- | --- | --- |
| (a) run 42483066387 入「后续权威 occurrence」列表 | `docs/standards/test-flakes.md:3368`（`### 后续权威 occurrence（同签名，均 2-shard 负载）` 列表项） | ✓ 登记 HEAD `872a244f`、`conclusion=failure`、仅 shard 2/2 失败、raw log（job 128739753640）命中 `:568:31 toBeGreaterThan(expected) / Received: 0 / --shard=2/2`；原「同族待核」hedge 已解除为「确认为同签名 occurrence」——与前轮复审员 refinement 一致 |
| (b) 新签名小节：`:555 toBeFocused` | `docs/standards/test-flakes.md:3370,3374` | ✓ 小节标题「新签名 occurrence（条件敏感非确定性，均未登记、均未闭合）」；`:555` 签名细节（`Received: inactive`，timeout 5000ms，`3 did not run`）、证据路径、与 `:568` 同族但签名不同、**同根因未证明**均如实写入 |
| (b) 新签名小节：A3-F7 `investigation-ui-acceptance.spec.ts:341` | `docs/standards/test-flakes.md:3375` | ✓ 明确为**不同 spec 文件**的独立 occurrence，未声称与 `:568` 同测试；登记 2 次复现 `1 failed / 9 passed`、pr-865 @ `9dd1d5f4` 控制实验 EXIT=0、M3/M4/M5 通过、条件敏感非确定性归属论证、「精确触发路径未定位」 |
| (b) CASE_ID 保持 NONE | `:3370` 正文与 `:3377` | ✓ 「不并入 CASE（`CASE_ID` 仍 NONE）」；全文件 `CASE_ID` grep 确认无新增归并 |
| (c) F-04 web 单测一次性失败为低优先观察 | `docs/standards/test-flakes.md:3376` | ✓ 「低优先观察项一并裁定；本轮未复现，不定级」 |
| (d) 结尾声明保持 #878 OPEN/DEFER、无 fixed/complete 表述 | `docs/standards/test-flakes.md:3377` | ✓ 「#878 仍 OPEN / DEFER、4 条 Acceptance 未勾选、`ROOT_CAUSE_CONFIDENCE = HYPOTHESIS`、4 处固定 150ms 残留、无 post-fix 完整权威绿灯（GitHub 账户计费，外部非代码）」「登记不替代 #878 验收，也不替代 required CI 绿灯；本条目不表述为已修复」 |

补充验证：

- 新小节归属既有 `OBS-2026-11-03-001`（`:3321` 节内）的小节扩展，不是第二套登记机制。
- 新小节内违规表述检查：`sed -n '3365,3378p' | grep '已修复\|已闭合\|完整 CI 通过' | grep -v '不\|均未\|解除'` → 无命中（出现的「不表述为已修复」均为负面声明）。
- `gh issue view 878 --json state` → `OPEN`，与文档声明一致。
- 登记来源诚实性：`:3374/:3375` 明确写「本轮交付编辑**未在本会话复跑**这两条失败，登记依据为下列给定证据材料，如实标注来源」——不把转述证据冒充复现，符合证据纪律。

## 3. 回归 / 削弱 / 双轨检查

```
$ git diff --name-only a5df2c90..b6be2591 | grep -v '^docs/'
→ (none)        # 两轮修复全量 diff 仅 docs/，20 个文件，零代码改动
```

- **测试/授权/保存语义**：零代码改动，生产代码、测试断言、授权边界、保存协议均未被触碰，无从削弱。`test-flakes.md` 的改动方向是**新增登记**（事实面收紧），未放宽任何验收门槛。
- **重复实现 / 新双轨**：新签名登记以 `OBS-2026-11-03-001` 内小节形式扩展既有 ledger，单一登记权威未被复制；`:555`/`:341` 未被强行并入 `:568` 的 case（同根因未证明就不归并），与「同一条规则单一权威、多边界独立校验」原则一致。
- **最小修复是否解决根因**：blocker 2 的根因是「两处新签名 occurrence 未登记」，登记补齐即闭合该信息面——本轮逐项验证登记完整且来源诚实，**已解决**。blocker 1 的根因是外部 billing（非代码），修复声明本身也未主张已解决，如实。

## 4. Out-of-scope 混杂（low，如实记录）

`e97e15fb` 在 in-scope 的 `test-flakes.md`（+11 行）之外携带约 2150 行非本复审授权范围的 docs：ADR-025 touchpoints、`security-model.md`、`observability.md` 契约、`save-failure-evidence.md`、7 份 research/closure 记录（含前轮 REVIEW_* 文档入库）。本轮仅确认这些文件全部为 docs-only（见 §3 diff 检查），**未复审其技术内容正确性**——不构成对其内容的背书。修复记录已事先声明该混杂交付事实，本复审如实转记。

## 5. 结论

| 项 | 结果 |
| --- | --- |
| HEAD = b6be2591dfe28b2fe17e53d84d11b37330a81f40 | ✓ 确认 |
| Blocker 1（required CI 全绿） | **未解决** — run 42607941019 failure，同一 billing annotation，6 required jobs skipped，`gh pr checks 928` exit=1，#930 OPEN |
| Blocker 2（occurrence 登记面） | **已解决** — 6 个子项全部落地，来源诚实，#878 保持 OPEN，无违规表述 |
| 削弱测试/授权/保存语义 | 未发生（a5df2c90..b6be2591 零代码改动） |
| 重复实现 / 新双轨 | 未发生（既有 OBS ledger 扩展） |
| 虚假绿灯记录 | 未发现（FINAL_INTEGRATION_RECORD §7 如实声明 FAIL/BLOCKED） |

**Verdict：BLOCKED**。唯一剩余阻塞为 SPEC §7.2 required CI 在 exact SHA 上全绿，其先决条件（#930 billing 恢复）为外部账户条件，代码与文档侧工作（blocker 2）已按合同闭合且无回归。billing 恢复后在最终 SHA 复跑完整 CI 并全绿后，本 gate 可重审。

## 6. 未执行项声明（SKIPPED）

- 本轮未复跑本地 `pnpm verify` / `pnpm e2e`：CI 是本 gate 的权威信号，且集成线两轮修复零代码改动，本地复跑不改变结论；如实记为 SKIPPED，不冒充已跑。
- out-of-scope docs（约 2150 行）内容未复审，原因见 §4。
- #930 billing 恢复的确切时点未知：仅确认截至 run 42607941019（2026-11-09T11:18Z）annotation 显示故障仍在。
