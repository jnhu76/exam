# PR #221 独立对抗性代码审查报告

## 基线确认

| 项目 | 值 |
|---|---|
| Head SHA | `a0c35901d0ca440e918897bc941529b91bff6ab6` |
| Base SHA (merge-base) | `55ee6de3ae5b7b27cd172c9397de44b7b2d622eb` (master, PR #219 已合并) |
| PR 状态 | **Draft** |
| CI | CodeRabbit 跳过（Draft detected）；无 GitHub Actions formal gate |
| 生产代码变更 | **无** — diff 仅含 formal model、runner、package scripts、文档 |

### Changed files 分类

| 类别 | 文件 |
|---|---|
| TLA+ module | `formal/tla/recovery/RecoveryProtocol.tla` |
| Target safety configs | `RecoveryProtocolSafety.cfg`, `RecoveryProtocolRouteSwitchSafety.cfg`, `RecoveryProtocolSubmissionSafety.cfg` |
| Liveness config | `RecoveryProtocolLiveness.cfg` |
| Expected-counterexample configs | `counterexamples/Legacy{WrongAttemptRestore,GlobalInFlight,StalePageLoad,NoReloadAfterPostFailure}.cfg` |
| Node runner | `scripts/formal/run-recovery-tlc.mjs` |
| Package scripts / ignore | `package.json` (+7 scripts), `.prettierignore` (+1), `formal/.gitignore` |
| README / architecture / audit | `formal/README.md`, `formal/AGENTS.md`, `formal/tla/TOOLCHAIN.md`, `formal/tla/recovery/README.md`, `counterexamples/README.md`, `docs/audits/REC-F1-*.md`, `docs/architecture/exam-system/candidate-recovery.md`, `docs/README.md` |

---

## Findings

### [P1] 审计文档保留已过时的 stacked-PR 上下文，与当前 PR 元数据矛盾

- **文件**: `docs/audits/REC-F1-RECOVERY-PROTOCOL-FORMAL-MODEL.md` 第 30–50 行
- **问题**: 审计文档仍包含：
  ```
  Stacked base branch : feat/rec-i3-disrupted-restore-ux
  PR base branch      : feat/rec-i3-disrupted-restore-ux  (NOT master — stacked on PR #219)
  Dependency          : PR #219 (REC-I3) must merge first
  Required post-merge : rebase REC-F1 onto master and change the PR base to master
  Merge status        : NOT MERGED — STACKED ON PR #219
  ```
  但 PR #221 当前 base 已是 `master`，PR #219 已合并，branch 已 rebase。这些信息放在"当前状态"段落中（无历史标记），会误导读者认为 PR 仍是 stacked 状态。
- **为什么 TLC PASS 没有发现**: 文档问题，不在模型检验范围内。
- **影响**: 审计文档作为 closeout 记录，若被后续 agent 或人类当作当前事实引用，会产生错误判断。
- **修复建议**: 将 stacked-PR 段落标记为 `[HISTORICAL — PR #220 context]`，并新增当前 PR #221 的实际 base/head 信息。

---

### [P1] `NoCrossAttemptRestoreBlocking` 是 liveness 性质，但被分类为 "Temporal SAFETY PROPERTIES" 且在 target safety config 中未检查

- **文件**: `RecoveryProtocol.tla` 第 657–694 行；`RecoveryProtocolRouteSwitchSafety.cfg`
- **问题**:
  1. 该性质使用 `[](... => <>(...))` 结构（leads-to），是 **liveness** 性质，不是 safety。模块注释将其归入 "TEMPORAL SAFETY PROPERTIES" 是分类错误。
  2. `RecoveryProtocolRouteSwitchSafety.cfg`（声称覆盖 cross-attempt race 的 config）**没有**检查此性质。它只在 `RecoveryProtocolLiveness.cfg` 中被检查。
  3. PR body 和 recovery README 声称 "NoCrossAttemptRestoreBlocking — checked as a liveness-style PROPERTY in the route-switch config"，但实际 cfg 中并不存在。
- **影响**: 在 target（所有 legacy flag = FALSE）模式下，`NoCrossAttemptRestoreBlocking` **从未被独立验证为 PASS**。它只在 liveness config 中与 `CurrentResumableAttemptEventuallyProgresses` 一起检查，而该 config 整体 FAILED。因此无法确认 target 模型是否满足此性质。
- **修复建议**: 将 `NoCrossAttemptRestoreBlocking` 加入 `RecoveryProtocolRouteSwitchSafety.cfg` 的 PROPERTY 列表（需确认 TLC 在 safety config 下是否能单独验证它——若需要 fairness 则必须留在 liveness config，但应明确记录）。修正模块注释分类。

---

### [P1] Liveness 反例根因：`LoseResponse` 无公平性约束，可无限循环消耗响应

- **文件**: `RecoveryProtocol.tla` 第 577–593 行（LivenessNext）、第 711–720 行（FairSpec）
- **问题**: 独立复现的反例 trace：
  ```
  s1: Init (route=A, disrupted, loading)
  s2: StartPageLoad (r2 in flight)
  s3-s4: DeadlinePasses(A), DeadlinePasses(B)
  s5-s6: DeadlineReconcile(B→submitted), DeadlineReconcile(A→submitted)
  s7-s8: GradeAttempt(A→graded), GradeAttempt(B→graded)
  s9: ServerReturnSnapshot (delivery frozen with "graded")
  s10: LoseResponse (delivery lost)
  → Back to s8 (loop: ServerReturnSnapshot → LoseResponse → repeat)
  ```
  在循环中 `uiState = "loading"` 永远不变。`WF_vars(StartPageLoad)` 被声明但 TLC 仍找到此反例，说明 fairness 集合不足以排除此行为。根因是 `LoseResponse` 无公平性约束且可在每个循环中消耗新产生的 delivery，形成无限 "produce-then-lose" 循环。
- **影响**: liveness PARTIAL 是真实的协议建模问题，不是 vacuous failure。但当前文档仅说 "fairness 尚不够"，未记录具体根因。
- **修复建议**:
  1. 在 liveness model 中移除 `LoseResponse`（环境最终会交付响应是合理的 liveness 假设），或
  2. 添加 `SF_vars(LoseResponse)` 使 loss 不能无限连续发生，或
  3. 将 `LoseResponse` 限制为每 request 至多 loss 一次（更精确的环境模型）。

  无论哪种，需在 README 和审计中记录根因。

---

### [P2] `NoStalePageLoadApply` 与 `NoStaleRestoreApply` 是完全相同的谓词

- **文件**: `RecoveryProtocol.tla` 第 634–640 行
- **问题**: 两者定义完全一致：
  ```tla
  NoStalePageLoadApply ==
    (clientSnapshotAttempt # NoSnapshot) =>
      (clientSnapshotAttempt = routeAttempt /\ clientSnapshotGen = clientGeneration)

  NoStaleRestoreApply ==
    (clientSnapshotAttempt # NoSnapshot) =>
      (clientSnapshotAttempt = routeAttempt /\ clientSnapshotGen = clientGeneration)
  ```
  名称暗示分别约束 page-load 和 restore 的 stale apply，但实际上 `ApplyAuthoritativeReload` 是唯一修改 `clientSnapshot*` 的 action。
- **修复建议**: 合并为一个 `NoStaleSnapshotApply`，或在注释中明确说明两者当前等价。

---

### [P2] `TimeGrantNeverDecreases` 在所有 gated config 中 vacuously true

- **文件**: `RecoveryProtocolSafety.cfg`, `RecoveryProtocolSubmissionSafety.cfg`
- **问题**: `GrantExtension` 是唯一修改 `timeGrant` 的 action，但它**不在任何 Next 变体中**。因此 `timeGrant` 在所有可达状态中恒为初始值 0，`TimeGrantNeverDecreases` 平凡成立。
- **影响**: PR 声称 "TimeGrantNeverDecreases is a real cross-state constraint" 不准确——它在当前模型中是 vacuous。
- **修复建议**: 将 `GrantExtension` 加入至少一个 config 的 Next，或在文档中明确标注 "vacuously true — GrantExtension deferred to REC-I4"。

---

### [P2] 审计文档列出不存在的性质 `RestoreDoesNotDirectlyChangeDeadline`

- **文件**: `docs/audits/REC-F1-RECOVERY-PROTOCOL-FORMAL-MODEL.md` "Safety properties checked" 段落
- **问题**: 该段落列出 `RestoreDoesNotDirectlyChangeDeadline` 作为被检查的性质，但 TLA+ 模块中**不存在**此名称的 INVARIANT 或 PROPERTY。
- **修复建议**: 从 "Safety properties checked" 列表中移除，改为在 "Runtime/model mismatches" 中说明。

---

### [P2] TOOLCHAIN.md TLC 版本号 rev 与实际不一致

- **文件**: `formal/tla/TOOLCHAIN.md` 第 14 行
- **问题**: TOOLCHAIN.md 记录 `rev: 5a47803`，但实际执行 TLC 输出为 `rev: 5a47802`（审计文档正确记录了 `5a47802`）。
- **修复建议**: 修正为 `5a47802`。

---

### [P2] `MarkDisrupted` 和 `GrantExtension` 定义但不可达

- **文件**: `RecoveryProtocol.tla` 第 340–349 行、第 449–458 行
- **问题**: 这两个 action 在模块中定义但不出现在任何 Next 变体中，是死代码。
- **修复建议**: 在模块注释中明确标注 "defined for completeness / future use; not in any gated Next"。

---

### [P3] `RetryRestore` 与 `StartRestore` 功能重叠

- **文件**: `RecoveryProtocol.tla` 第 226–264 行
- **问题**: `StartRestore` 的 guard 是 `uiState \in {"loading", "restore_failed"}`，已包含 `RetryRestore` 的 `uiState = "restore_failed"` 情况。两者除 guard 外完全相同。
- **修复建议**: 移除 `RetryRestore`（`StartRestore` 已覆盖），或记录保留原因。

---

### [P3] `formal:recovery:explore` 永远返回 0 的误用风险

- **文件**: `scripts/formal/run-recovery-tlc.mjs` 第 510–512 行
- **问题**: `explore` 模式无论 TLC 结果如何都 `process.exit(0)`。若有人将其放入 CI 或 `&&` 链中，会产生 "失败看起来像成功" 的误判。
- **修复建议**: 在 `package.json` 的 script 描述中加入 `[NON-GATED]` 前缀。

---

## Model coverage matrix

| Runtime behavior | Model action/state | Config | Property | Truly exercised? | Notes |
|---|---|---|---|---|---|
| Route-bound restore authority | `StartRestore` + guard | Core, RouteSwitch | `NoWrongAttemptRestore` | ✅ Yes | Counterexample reproduces |
| Generation token isolation | `NavigateTo` bumps gen | RouteSwitch | `NoStalePageLoadApply` | ✅ Yes | Counterexample reproduces |
| Stale response rejection | `ApplyAuthoritativeReload` + `IsCurrent(d)` | RouteSwitch | `NoStalePageLoadApply` | ✅ Yes | Delivery freezes state |
| POST-is-not-page-authority | `ConsumePostAck` vs `LegacyApplyPostOutcome` | Core | `PostOutcomeIsNotPageAuthority` | ✅ Yes | History variable |
| Cross-attempt non-blocking | `RestoreStartGuard` per-route | Liveness cfg only | `NoCrossAttemptRestoreBlocking` | ⚠️ Partial | Not independently PASS-verified |
| Terminal absorbing | `SubmitAttempt`, `DeadlineReconcile` | Submission | `TerminalNeverResurrects` | ✅ Yes | |
| Submitted snapshot freeze | `submittedSnapshot` | Submission | `SubmittedSnapshotImmutable` | ✅ Yes | |
| Server version monotonicity | `serverVersion` | All 3 | `ServerVersionNeverDecreases` | ✅ Yes | |
| Time grant monotonicity | `timeGrant` | Core, Submission | `TimeGrantNeverDecreases` | ❌ Vacuous | `GrantExtension` not in Next |
| Deadline wins race | `DeadlinePasses` + `RejectRestoreDeadlineWon` | Core | (implicit) | ✅ Yes | |
| Response loss + recovery | `LoseResponse` | Core, Liveness | (liveness) | ⚠️ Causes PARTIAL | |
| Time compensation (REC-I4) | NOT modeled | — | — | ❌ No | Documented mismatch |

---

## Command evidence

| 命令 | Exit code | 结果 | 状态数 / 深度 |
|---|---|---|---|
| `run-recovery-tlc.mjs safety` | 0 | PASS | 4,679 distinct, depth 25 |
| `run-recovery-tlc.mjs safety:route` | 0 | PASS | 20,796 distinct, depth 26 |
| `run-recovery-tlc.mjs safety:submission` | 0 | PASS | 88,936 distinct, depth 26 |
| `run-recovery-tlc.mjs counterexamples` | 0 | 4/4 EXPECTED_VIOLATION | 6 / 20,796 / 46 / 128 |
| `run-recovery-tlc.mjs liveness` | **1** | PARTIAL — temporal violated | 5,607 distinct |
| 缺少 `TLA2TOOLS_JAR` | 2 | 明确错误 | — |
| 无效 JAR 路径 | 2 | 明确错误 + 下载链接 | — |
| 无效 mode | 2 | 明确 usage | — |

TLC 版本实际输出: `TLC2 Version 2.19 of 08 August 2024 (rev: 5a47802)`

**未复现项**: `pnpm verify:static`、`pnpm format:check`（WSL pnpm 路径问题）；Java 无效路径测试；signal termination 测试。

---

## Merge verdict

## `COMMENT — non-blocking fixes`

**理由**:

1. **Safety 模型真实且有意义** — 三个 split config 全部独立复现 PASS；性质不是 tautology（counterexample 证明可被违反）；delivery 冻结服务器状态；NavigateTo 在 route-switch Next 中；legacy flag 只影响 action 不影响 property。
2. **无 P0 blocking finding** — 没有 vacuous truth、隐藏生产代码变更、runner 误判或虚假 PASS。
3. **P1 findings 是文档/分类问题**，不影响模型检验结论的正确性。
4. **Liveness PARTIAL 可以接受合并**，条件：记录根因 + 后续 issue + 保持 non-zero exit（当前已满足）。

**合并前建议修复**:
- 审计文档 stacked-PR 段落标记为历史
- `NoCrossAttemptRestoreBlocking` 分类修正 + 文档与 cfg 对齐
- TOOLCHAIN.md rev 号修正
- `RestoreDoesNotDirectlyChangeDeadline` 从 "checked" 列表移除

**模型未覆盖**: TypeScript refinement（明确声明）、REC-I4 时间补偿、Answer save protocol、RBAC、grading、>2 并发 attempt。

**有限 bounds 足以支持当前 claims**: 2 attempts 足够表达 cross-attempt race；3 RequestIds + MAX_DELIVERIES=2 足够表达乱序和 loss；状态空间 < 90K，TLC 穷举搜索。

**后续工作**: 关闭 liveness PARTIAL；REC-I4 后扩展 GrantExtension；考虑 CI 集成；统一重复谓词。
