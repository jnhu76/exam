# Exam #932 · P2 B0 — 证据勘误与完整性记录（归档）

> **归档说明**：本文是 #932 UI 验证战役 B0 阶段（GO_P2 执行会话，2026-11-11）的证据勘误记录，按 Owner P4 授权（GO_P4_IMPLEMENTATION，PR-4）归档至 `docs/archive/audits/`。归档做了三类调整，均以不改动原稿结论为界：① §6 第 3 条原稿含测试账号密码字面值，已替换为指向本地凭据文件的引用（凭据值不入版本控制）；② /tmp 与 gitignored 会话目录路径保留为历史溯源，不保证继续存在；③ 三处标注「后续状态」的补注（归档时补写）把本记录与后续 GO_P3/GO_P4 裁决衔接，补注以外正文为原稿如实存档。基线 master `983313b64108aaedc2dbc008d8bc396800700dbf`，主工作树 clean（`git status --short` 实查）。本文件只记录证据修正，不修改生产代码，不修改 #932 权威合同。
>
> P0 原始证据位置：`/tmp/exam-ui-932-983313b/`（一次性 scratch，B0 会话逐项核实**当时可访问**；关键 before 截图已复制归档至会话工作目录 `before-archive/`，gitignored，不可进入 commit）。

## 1. P0 证据可访问性核查（GO_P2 前置）

| 项 | 结果 |
|---|---|
| FINAL-REPORT.md（114,603 B） | 可读，结构完整（§0–§13） |
| 关键 before 锚点截图 | 可访问且逐张目视核验（见 §2.4 归档清单） |
| fixture-state.json | 可读；凭据文件（credentials-note.md、verify-creds.json、invite-token.txt）mode 600 本地保留，未上传 |
| 运行环境 | dev DB/Redis 容器 healthy；API :3000 与 Vite :5173（master 源码）存活；隔离 Chrome CDP :9222 存活（Chrome/149.0.7827.55，P0 同实例参数） |

## 2. cross 族证据勘误（B0 合同项）

### cross-14 — `/admin/questions/new` 768/390 截图污染

- **声明**：`forms/shots/admin-questions-new-empty-768x1024.png` 与 `-390x844.png` 实为登录页（KICKED 后残留），details.md 计入 TESTED 失真。
- **本会话核实**：两张截图逐张目视检查，均为"考试平台 / 内部考核与准入控制 / 登录"页——**污染声明成立**。
- **处置**：覆盖率口径修正——`/admin/questions/new` 在 768×1024 与 390×844 两个视口的状态从 TESTED 改标 **NOT_RUN**（P0 意义上）。重拍：本会话 Phase 3 取证窗口内以 admin 登录态补拍（产物记入会话工作目录 `shots/recap/`，见 §4）；若补拍失败则维持 NOT_RUN 并注明原因。污染文件本体不删除，改标 `POLLUTED-DO-NOT-USE`。
- **对 P2 的影响**：无——questions/new 不在两页原型范围内，该勘误仅恢复覆盖率记录的真实性。

### cross-15 — `/admin/dashboard` 区块顺序断言错误

- **声明**：admin-shell details.md 曾断言"todo 位于 KPI 之上已落地"，与源码相反。
- **本会话核实**：`apps/web/src/pages/admin/DashboardPage.tsx` 实读——StatsCard 网格 :179-200 **先于** todo section :202-254，其后为快捷动作 :256-268、近期考试 :270-305；before 截图 `admin-dashboard-seeded-1440x900.png` 目视一致（KPI 4 卡在最上）。**声明成立**。
- **处置**：覆盖率口径修正——P1 §7.1 before 线框已是修正后口径（KPI→todo→actions→近期考试），P2 两方案（A/B）以该 as-built 为唯一现状起点；admin-shell/details.md 的原断言在 P0 存档中标注为 superseded（见 §4 重拍/标注清单）。后续裁决：本勘误的 as-built 顺序正是 #932 P2/P3 两方案改造的起点，GO_P4 已裁决采纳 A（todo → KPI → 近期考试），本文为该决策保留了 before 顺序的权威记录。

### cross-16 — `/admin/exams/:id/scores` 429 错误态截图失实

- **声明**：results/details.md 引用 `score-list-imm-passfilter-failed-desktop.png` 作为"429 真实错误态（整页 ErrorState）"证据，实际该图为正常 passFilter 不及格空态（PageHeader/统计卡/表格俱全）。
- **本会话核实**：该截图逐张目视检查——显示"考试 - 成绩管理"+统计卡+"不及格"筛选+"暂无成绩"空态，**无任何 ErrorState/429 文案**。声明成立：F1 的 429 视觉证据缺失。
- **处置**：覆盖率口径修正——results 族"429 真实错误态 TESTED"改标 **NOT_RUN（视觉证据缺失）**；F1 的 429 视觉证据主张撤销。代码根因（ScoreListPage.tsx:138-162 错误态吞没）经 P0 复核独立成立，不受影响。429 态重摄需人为耗尽共享限流窗口（100 req/60s/IP），与 P2 主取证共用同一 IP 桶，安排在全部 P2 截图完成之后的独立窗口尝试；无法安全完成则维持 NOT_RUN（见 §4）。

### 其余证据完整性观察

- P0 已自我声明并修正的 1 条 refuted finding（runtime-1"katex 裁切"证伪）与 12 条 verified——本会话抽查 cross-14/15/16 之外不再重复复核，以 P0 报告状态口径为准。
- P0 截图总量约 702 张；本次仅归档 P2 两页引用的 before 锚点（§2.4）。未归档截图仍属一次性 /tmp 资产，如后续批次需要，按 §4 重摄命令重建。

## 3. M1/M2/M4/M5 测试口径修订（真人 vs 自动化）

P1 §8.1 的 M1/M2/M4/M5 由自动化脚本测量。**口径修订：自动化交互时间 ≠ 真人任务完成时间**，两者分开记录、不得互相替代：

| 指标 | P2 可交付（本会话） | 仅 P3 可交付（真人研究） |
|---|---|---|
| M1 到达主 CTA 时间 | **自动化交互时间**：起点=登录完成且被测页首帧稳定渲染；终点=目标元素 DOM click 完成（Playwright 点击日志）。标签必须写明 `automated` | 真人任务完成时间（N=5，屏幕/键鼠录制，含理解与犹豫） |
| M2 主任务成功率 | **自动化脚本成功率**：脚本按既定路径可达目标即成功；分母=脚本数，非人数 | 真人成功率（N=5，同脚本任务书） |
| M4 错误恢复可发现性 | **自动化探针**：注入 429/500 后找到重试/返回的脚本时长与可达性 | 真人发现时间与误操作 |
| M5 KPI 可达性 | **自动化口径**：点击次数（不含滚动）与脚本时长；阈值 ≤ before +2s 或 +1 次点击交互，任一超线即 FAIL | 真人浏览路径时长（P3） |

规则：任何 P2 报告若引用 M1/M2/M4/M5 数字，必须带 `automated` 标注；不得声称"任务效率提升"仅凭自动化数字——那是 P3 真人研究才能下的结论。S1/S2/S3 主观量表全部属 P3，P2 不执行。后续状态（GO_P3 记录，此处一并归档）：真人任务与 S1-S3 量表 **NOT_RUN**（无真实参与者）；P3 以明确标注 EXPERT 的专家走查交付，不冒充真人盲评。

## 4. 重摄清单（本会话执行记录）

| # | 项 | 命令/来源 | 状态 |
|---|---|---|---|
| R1 | before 截图归档（12 张 + fixture 引用） | `cp` 自 /tmp/exam-ui-932-983313b → 会话工作目录 `before-archive/` | DONE |
| R2 | 脱敏 fixture manifest | `fixture-manifest-sanitized.json`（会话工作目录） | DONE |
| R3 | cross-14 重拍 questions/new 768/390 | admin 登录态 + CDP 截图 → `shots/recap/recap-admin-questions-new-{768x1024,390x844}.png` + `recap-cross14-result.json`（h1 新增题目、overflow=false、consoleErr=2 基线） | **DONE（RECAPTURED）** —— 覆盖率口径从 NOT_RUN 恢复为 TESTED；首次尝试拍到限流错误态已作废重拍 |
| R4 | cross-16 重拍 scores 429 态 | ① 真实限流窗耗尽尝试：burst 429 达成但 429 命中 auth 流，会话被踢回登录（cross-01 模式新证据，`recap-cross16-result.json`）；② 结构化 429 route-mock 精确注入 scores 端点：UI 渲染完整 ErrorState「请求过于频繁 + 重试 + 返回成绩查询」（`shots/recap/recap-scores-429-mocked-1440x900.png` + `recap-cross16-mock-result.json`） | **DONE（证据链闭环）** —— 原截图污染维持撤销；mock 复现表明该页对结构化 429 正确渲染 ErrorState，P0「ScoreListPage 吞 429」的代码根因断言应降级为「待对真实限流响应体复核」（B8） |
| R5 | P0 各族重摄命令（未归档截图的重建路径） | P0 报告 §11 索引：各族 seed 脚本（seed-fixture.mjs / seed-queue.mjs / highrisk/seed-fixture.cjs）+ probe/verify 脚本，均驻留 /tmp/exam-ui-932-983313b | 记录在案 |
| R6 | admin-shell/details.md cross-15 断言标注 superseded | P0 存档只读，勘误以本文件为准 | DONE（本文件 §2） |

## 6. 采集期事件记录（P2 会话，证据可信度相关）

1. **共享限流窗口（100 req/60s/IP）**：并发采集曾引发 429 与登录失败（即 P0 candidate-4/cross-01 模式的再次现场复现）；处置=严格串行 + 登录 3 次重试 + 受影响切片全部重采。
2. **候选首视口 404**：Vite 依赖预优化（zod）触发的一次性整页重载伪影；后续全部视口/状态采集 consoleErr 恒为基线 2 条，确认非产品代码问题。
3. **fixture 密码勘误**：fam932 考生当前密码为 P0 settings 流程修改后的新密码（字面值仅存本地 mode-600 fixture-state.json，不入版本控制），P2 采集已按其执行。
4. **数据态漂移**：P0 会话探针编辑过考试窗口；fam932-RES 进行中尝试在 P2 采集前被截止扫描器自动评分（「继续考试」→「开始考试+0 分已评分」）。漂移发生于 before/A/B 三方采集之前，同态对照成立；P3 前建议重建新鲜 fixture。后续状态：GO_P3 已按此重建新鲜 fixture（create-only Admin API 种子），P2 漂移缺陷未再复现。

## 5. A/B 对照冻结条件

见会话工作目录 `FROZEN-CONDITIONS.md`（Phase 2 实施前冻结；含浏览器、viewport、locale、DPR、数据状态、测试任务与服务器端口映射）。归档时点该文件属 gitignored 会话资产；冻结参数已由 P3 报告（环境记录节）完整转述。
