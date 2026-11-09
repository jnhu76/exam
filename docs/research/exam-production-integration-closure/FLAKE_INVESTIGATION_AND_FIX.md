# Flake Investigation & Fix — `rich-content-overflow.spec.ts` 几何采样 flake（PR #923 / #878 / OBS-2026-11-03-001）

调查执行时间：2026-11-09。执行者：flaky E2E 调查员（dynamic-workflow subagent）。
授权文档：`/home/hoo/Source/exam/.tmp/production-closure/SPEC.md` §3（先调查再归因 / 修复验收 / 禁止处理方式）。

---

## 0. 结论摘要

- **失败探针**：`apps/e2e/e2e/rich-content-overflow.spec.ts:528`（`candidate take → rich answer → graded result: local scroll, keyboard, stable geometry`）的 `:568` 断言 `expect(promptScrollAfter).toBeGreaterThan(promptScrollBefore)`，CI 权威失败签名 `Expected: > 0 / Received: 0`。
- **分类**：非确定性执行失败（ORACLE_SYNC：几何证明依赖固定 150ms 时间预算），**不是**确定性契约失败。本轮中唯一的确定性契约失败是 `investigation-ui-acceptance.spec.ts` 的 forged requestId 形状违规，已由本分支既有 commit `ca7e62ec` 修复，与本调查分离。
- **修复**：commit `1f29b614`（已 push 到 `fix/security-client-event-route-projection`，非 force）。所有者 = 测试同步策略：settled KaTeX 状态等待 + 显式条件等待（`expect.poll scrollLeft > before`）替换固定 `waitForTimeout(150)`。断言零删除、零降低；无 retry、无全局 timeout 放大、无 skip。
- **验证**：修复后同配置（`E2E_WORKERS=2 E2E_WORKER_BASE_PORT=21000 bash scripts/e2e/run.sh rich-content-overflow`）**5/5 PASS** + 一次全量 2-shard E2E **PASS**（EXIT=0）。
- **诚实边界**：本地未能复现修复前失败（probe 1×、全量 1× 均 PASS）；根因置信级别按 `docs/standards/test-flakes.md` 纪律为 **HYPOTHESIS→机制方向有测量证据**（见 §4），未做负载下 instrumented scrollLeft 采样序列。推送后的权威 CI 对照被 **GitHub Actions 账户计费故障**阻断（run 42567527001 所有 job 未启动，非代码失败），未获得修复后 CI 绿灯。

---

## 1. 基线、命令与环境

```text
GIT_SHA（修复前调查基线） = ca7e62ecca578c5a7b100b81102bd2d56d3d67d3
GIT_SHA（修复 commit）    = 1f29b6148ff881700bb1d2c1b047653f6c44340c
BRANCH = fix/security-client-event-route-projection（PR #923）
WORKTREE = /home/hoo/Source/exam-gap-worktrees/pr-864

命令（ask 指定的仓库唯一入口）：
  E2E_WORKERS=2 E2E_WORKER_BASE_PORT=21000 bash scripts/e2e/run.sh rich-content-overflow
  E2E_WORKERS=2 E2E_WORKER_BASE_PORT=21000 bash scripts/e2e/run.sh   # 全量

测试拓扑（与 CI 接近）：
  2 个 Playwright shard（--shard=i/2），每 shard workers=1（apps/e2e/playwright.config.ts，
  retries: 0，fullyParallel: false，chromium only），每 shard 独立 exam_e2e_w{i} 库 +
  独立 API server（端口 21000/21001，node dist/server.js）。
  CI 差异：CI 两 shard 各占一台 runner；本地两 shard 共享宿主（负载保真度高于 CI per-runner）。

宿主环境：WSL2（networkingMode=mirrored），8 CPU，Windows 动态端口范围 1024-14999；
dev 依赖栈 exam-dev（PostgreSQL 127.0.0.1:5432 / Redis 127.0.0.1:6379）由 run.sh 复用。
```

`E2E_WORKER_BASE_PORT=21000` 是 run.sh 文档化配置值（非拓扑变体）。选择 21000 的原因见 §3.2 环境旁支发现。

---

## 2. 修复前证据（先保全，再诊断）

### 2.1 CI 权威失败（AUTHORITATIVE_RUN = FAIL，不可被重跑改写）

| # | run / job | head | shard | 签名 |
|---|---|---|---|---|
| 1 | run 42518523050 / job 128847373789 | `d3580f3e` | 1/2 | `:568 Expected: > 0 / Received: 0`（另有 1 个确定性失败 investigation-ui-acceptance，见 §3.1） |
| 2 | run 42564029701 / job 128987131154 | `ca7e62ec`（本调查起点 HEAD） | 1/2 | `:568 Expected: > 0 / Received: 0`（唯一失败） |
| 3（本调查新发现） | run 42563996915 / job 128987063313 | `9dd1d5f4`（PR #924） | **2/2** | `:568 Expected: > 0 / Received: 0` |

日志取证命令：`gh api /repos/jnhu76/exam/actions/jobs/<id>/logs`（存档 `/tmp/pr923-flake/*.log`）。

Occurrence #3 的意义：同一签名跨 **4 个 head**（含 release-metadata-only 的 #918，见 #878 comment）复现，且 **shard 1 与 shard 2 都出现过** —— 失败与文件在 shard 内的位置无关，是纯时序/负载非确定性。CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（VACUOUS/CONTROLLED_EXCLUSION：#918 全 diff 为 release metadata，#924 未触达该 spec）。

### 2.2 本地复现尝试（未复现，如实记录）

| 尝试 | 命令 | 结果 |
|---|---|---|
| pre-run4 | `E2E_WORKERS=2 E2E_WORKER_BASE_PORT=21000 bash scripts/e2e/run.sh rich-content-overflow` | **PASS**（双 shard 通过，EXIT=0） |
| pre-run5 | `E2E_WORKERS=2 E2E_WORKER_BASE_PORT=21000 bash scripts/e2e/run.sh`（全量 2-shard） | **PASS**（EXIT=0） |

（pre-run1/2/3 因本地环境端口瞬态占用在 server 启动阶段中止，未进入测试阶段，见 §3.2。）

**不声称复现**。基于 CI 日志继续分析（ask 预授权路径）。

---

## 3. 确定性契约失败 vs 非确定性执行失败（区分结论）

### 3.1 确定性契约失败（不属于本 flake，已另行修复）

`investigation-ui-acceptance.spec.ts`（run 42518523050 shard 1 的第 2 个失败）：M3 fixture 注入 legacy `req-forged-prt-0001`，被 #864 自身引入的 timeline UUID shape gate 正确拒绝（`Expected substring: "req-forged-prt-0001"` 未出现在投影）。这是 **确定性契约失败**（测试夹具违反真实协议），已由分支 commit `ca7e62ec`（`test(#923): use RFC 4122 UUIDv4 forged requestId in investigation E2E`）修复；修复后的 run 42564029701 不再出现该失败。与几何 flake 无关，不并入本次修复。

### 3.2 环境旁支发现（本地 E2E 端口中止，非仓库缺陷）

pre-run1/2/3 分别在 3100、3201、3400 端口启动 shard API server 时 `EADDRINUSE`，且失败端口数秒后即空闲（`ss` 无监听者）。取证：

- `/mnt/c/Windows/System32/netsh.exe int ipv4 show dynamicport tcp` → **启动端口 1024，端口数 13977**（Windows 动态端口范围 1024-14999，非默认 49152+）；
- `/etc/wsl.conf`（`/mnt/c/Users/*/.wslconfig`）→ `networkingMode=mirrored`：Linux 侧绑定与 Windows 侧临时出站连接共享端口空间；
- `netsh interface ipv4 show excludedportrange protocol=tcp` → 排除区间不含 3100/3201/3400（排除 Hyper-V 静态保留假设）。

结论：3000-3400 段落在 Windows 临时端口范围内，被瞬时出站连接随机占用，属**本地环境属性**。缓解：本地运行选 `E2E_WORKER_BASE_PORT` 在 14999 以上（本调查用 21000）。**未对仓库做任何修改**（run.sh 本身行为正确）。

---

## 4. 根因

### 4.1 机制

失败点 `:560-568`（修复前）的采样策略：

```ts
const promptScrollBefore = await promptViewport.evaluate((el) => el.scrollLeft);
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(150);                     // ← 固定时间预算
const promptScrollAfter = await promptViewport.evaluate((el) => el.scrollLeft);
expect(promptScrollAfter).toBeGreaterThan(promptScrollBefore);   // :568
```

两个已证事实（均为本会话测量/源码取证）：

1. **Chrome 对键盘滚动的容器滚动是动画的**：同文件 `:334-346` 既有 `scrollToHorizontalEnd` helper，注释明确 `Chrome animates arrow-key scrolling`，以"两次相同采样"判定落定；该 helper 只被 `:755`/`:1193`（修复前编号）使用。
2. **采样表面可瞬态切换（KaTeX lazy swap）**：被测 block viewport 的内容由 `MathRenderer`（`apps/web/src/components/shared/content/MathRenderer.tsx:12`，`lazy(() => import("./KatexHtmlRenderer")`）渲染，fallback 是原始 LaTeX `<code>`。本会话用 pinned KaTeX 0.18.4 + Chromium 实测（scratch probe，已删除）：**渲染后 LONG_MATH 固有宽度 571px；fallback 原始 LaTeX（213 字符 monospace）≈2000px+**。swap 落地会改变 viewport 的 scrollWidth 乃至 interactive 状态（`ContentScrollViewport.tsx:112-152` 的 MutationObserver/fonts 重测只更新事实，不保证采样时点已 settle）。同文件 `:741-748`（结果页流程）已把该陷阱写成先例："the raw LaTeX fallback is wider than the rendered formula, so a range measured mid-swap would be a false target"。

组合机制：**固定 150ms 墙钟预算对两个异步过程（滚动动画首帧提交 / lazy chunk swap+web font）竞速**。CI 2-vCPU runner 上 KaTeX chunk 解析、React commit、字体布局与渲染器拥堵可把动画首帧推迟到 150ms 之后（采样到 0），或让 swap 恰落在采样窗口内改变采样表面。本地 8 核空载下窗口从不触发（4 次尝试全 PASS），与"负载敏感"观测一致。

### 4.2 置信级别（按 test-flakes STEP 6）

```text
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS（机制方向有源码与测量证据；缺负载下 instrumented scrollLeft 采样序列）
NONDETERMINISM_CONFIRMED = YES（同签名隔离重跑通过 × 多次；CI 负载失败 × 4 heads）
CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（CONTROLLED_EXCLUSION：#918 纯 release metadata diff、#924 未触达该文件）
```

升级阻断项：本地无法复现失败（§2.2），无法做失败/成功执行的 FIRST_CAUSAL_DIVERGENCE 对照。未解决项见 §8。

### 4.3 已排除假设

- **不是产品滚动语义回归**：隔离重跑长期 PASS；#848 `ffa9e745` 之后该 spec 与 `ContentScrollViewport` 未被四个 obs PR 触达（登记册既有证据 + 本轮 #918/#924 对照）。
- **不是 fail-fast 伪失败**：shard 2 的 cancelled 均为对侧失败的结果；occurrence #3 是 shard 2 的真实独立失败。
- **swap-clamp 归零（渲染后公式放而下采样到 0）在本站不成立**：take 页两种状态都 overflow（本地渲染宽度 571px < take 页内容列宽；若渲染后 fit，本地早 swap 场景将确定性失败于 `:547` data-overflowing 断言，而本地 4 次全 PASS）。swap 在本站的作用是把采样表面/scroll range 瞬态化，不是归零机制。
- **焦点转移**：`toBeFocused` 通过后到 press 之间只有 CDP evaluate（无点击、无路由跳转），React 重渲染不替换 viewport 节点；无焦点丢失路径。

---

## 5. 修复（所有者层：测试同步策略）

commit `1f29b6148ff881700bb1d2c1b047653f6c44340c`（`test(e2e): settled-state sampling for rich-content-overflow geometry (#878)`，已 push 非 force：`ca7e62ec..1f29b614`）。

改动（`apps/e2e/e2e/rich-content-overflow.spec.ts`，+18/-5，仅失败站点 `:560-568`）：

1. **KaTeX settled-state**（采用 ask 预授权的既有等价思路，即同文件 `:741-748` 结果页先例）：`await expect(promptViewport.locator(".katex")).toHaveCount(1)` + `document.fonts.ready`，再重新断言 `toBeFocused` + `data-overflowing=true` —— 保证采样发生在真实渲染表面，且该表面仍是 interactive 溢出区。
2. **显式条件等待**（#878 scope 点名的两种等价修复之一）：`await expect.poll(() => promptViewport.evaluate((el) => el.scrollLeft), { timeout: 5_000 }).toBeGreaterThan(promptScrollBefore)` 替换 `waitForTimeout(150)` + 单次采样。

Oracle 核对：

- 断言语义不变（scrollLeft 必须超越 before），**未删除、未降低任何断言**；新增 settled 前置断言是**加强**。
- `expect.poll` 是显式有界条件（5s 预算，100ms 轮询），非 sleep、非全局 timeout 放大、非 retry；与同文件既有 helper 的"两次相同采样"同属落定条件策略。
- 通过构造同时覆盖两个瞬态变体（动画首帧延迟 → poll 会等到动画推进；swap 落窗 → settle 等待先消除表面切换）。
- 无 skip/todo、无重试配置、无 shard 并发降低。

---

## 6. 验证（同配置重复）

命令：`E2E_WORKERS=2 E2E_WORKER_BASE_PORT=21000 bash scripts/e2e/run.sh rich-content-overflow`（head `1f29b614`，每 run 独立 migrate+seed+双 shard）。

| run | 结果 |
|---|---|
| postfix-run1 | PASS（EXIT=0） |
| postfix-run2 | PASS（EXIT=0） |
| postfix-run3 | PASS（EXIT=0） |
| postfix-run4 | PASS（EXIT=0） |
| postfix-run5 | PASS（EXIT=0） |
| postfix-full（`bash scripts/e2e/run.sh` 全量 2-shard，最接近 CI 的本地命令） | PASS（双 shard ✓，EXIT=0） |

日志：`/tmp/pr923-flake/postfix-run{1..5}.log`、`/tmp/pr923-flake/postfix-full.log`。

修复前对照（同 head `ca7e62ec`）：probe 1× PASS、全量 1× PASS（本地未复现）。

---

## 7. #858（editor not mounted）独立调查结论

- **CI 侧**：枚举 2026-11-03（#859 merge `8deafb46`）以来的全部失败 CI run（`gh api /actions/runs?created=>=2026-11-03&status=failure`，20 个），失败 job 仅落在 E2E shard、Static checks、Build；**无任何 Web coverage 失败** → 观察窗内 `editor not mounted` 签名 **零复发**。
- **本地侧**：head `1f29b614` 上 `pnpm --filter @exam/web exec vitest run src/components/exam/RichTextAnswerInput.readTrust.test.tsx` → **9/9 通过**（R1 842ms，预算 5s；#859 修复形态 = 模块加载期 `await import` + 定点 5s 预算，`RichTextAnswerInput.readTrust.test.tsx:14,151-157`）。
- **登记侧**：`docs/standards/test-flakes.md:257` `CASE-2026-11-03-CI-COVERAGE-BUDGETS = REPAIRED`（含 merge 后强制 coverage 绿证据）。
- **结论**：#858 的 F1-F6 机制已修复且无复发证据；#858 收口时的 residual（E2E 几何 flake）正是本报告的修复对象（owner #878）。#858 与本次几何 flake **不同根因**（coverage 冷加载预算 vs E2E oracle 同步），不混并。

---

## 8. 未解决项

1. **修复后权威 CI 对照未获得**：push 后 run 42567527001 全部 job 未启动 —— GitHub Actions 计费故障（"recent account payments have failed or your spending limit needs to be increased"，check-run annotation）。账单恢复后需重跑 CI；`MERGE_READINESS` 的 CI 门禁在此前不能声称满足。
2. **同 pattern 其余 4 处固定 150ms 采样**（当前行号 `:934`/`:1011`/`:1092`/`:1133`，viewport-matrix / admin authoring / grader 测试）未在已记录运行中失败，属 #878 scope 的整体收口，未纳入本次最小修复（超出本次失败证据范围）。它们尚未修复的事实**不构成安全证据**（登记册原话）。
3. **根因置信级别未到 CAUSALLY_PROVEN**：缺负载下 instrumented scrollLeft 采样序列（FIRST_CAUSAL_DIVERGENCE）。方向上由修复的构造性消除 + 571px/2000px 测量支撑。
4. **登记册更新未做**：OBS-2026-11-03-001 的新 occurrence（本报告 §2.1 #1/#2/#3）与 `CURRENT_INTERPRETATION` 更新属 docs 变更，未获本次 ask 授权；#878 验收条件含此项，需单独授权的受控 docs commit。
5. 本地环境项（§3.2）：Windows 动态端口范围 1024-14999 在 mirrored WSL 下会瞬态占用 3xxx 段；属宿主环境事实，仓库无需变更，但本地并行 E2E 应选 ≥15000 的 `E2E_WORKER_BASE_PORT`。
