# EXAM — Web 前端实现审计报告（senior-frontend skill）

> **Senior Frontend Skill Audit — `apps/web`**
> 审计对象：`jnhu76/exam` @ master `d3e74dd4860dd5bcbae1c50fe7c58af175a22594`（独立 detached worktree `/tmp/exam-frontend-audit`，审计全程零文件修改，主工作树中未提交改动不在审计范围内）
> 工作模式：READ-ONLY / EVIDENCE-FIRST / NO IMPLEMENTATION
> 审计方法论：[davila7/claude-code-templates](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/skills/development/senior-frontend) 的完整 `senior-frontend` skill（v2.0.0，含 `SKILL.md` + `references/{ui-checklist,react-patterns,NOTICE}.md` + `scripts/{check_ui,page-audit}.md`，MIT；文件清单经真实 Chrome CDP 访问 GitHub 核对，sparse clone 下载后逐文件审读，两个脚本经安全审查后使用）
> 审计执行：4 个只读 subagent 并行覆盖「可访问性/语义 HTML」「React 状态与数据」「设计系统治理」「状态矩阵/i18n/内容处理」四维度（并发上限 2）；全部 P1 与关键 P2 由主审逐文件复核；真实浏览器验证（React dev 栈 + skill 自带 `check_ui.mjs`/`page-audit.mjs` + axe-core 4.10.2 + Tab 焦点走查 + 18 张 375/1280px 截图）

---

## A. Executive Summary

**总体判断：这是一个纪律性显著高于平均水平的前端代码库。** 项目自建并真实执法了一套治理体系：`LoadingState/ErrorState/EmptyState` 统一状态词汇表（自带 `role="status"`/`role="alert"`/`aria-busy`）、`ApiError→i18n` 的编译器强制全映射（C3：Web i18n 为浏览器文案权威）、`console.*` 全禁（`check-code-quality.mjs` 执法）、自研 `exam-ui` ESLint 规则集（baseline 为空、全 error 级）、表格列宽分配单一权威链、以及 TakeExamPage 接近范本级的 save/submit/recovery 机制。门禁证据：**typecheck ✅ / eslint `--max-warnings=0` ✅ / vitest 194 文件 2838 用例全过 ✅；axe WCAG 2.2 AA 在 9 个登录后页面 0 违规；375px 全部页面 0 横向溢出；Tab 走查 22/36 个停靠点全部可见焦点**。

**最高风险（5 项 P1）**：不在"页面好不好看"，而在 **1 个考生数据丢失窗口、1 个已死的页面功能、一族键盘/读屏阻断**：

1. **答题防抖保存在卸载时被丢弃**（1.5s 窗口内离开页面 = 永久丢键入，且无任何提示）；
2. **表格行激活仅鼠标可用**（`<tr onClick>`/`<div onClick>`，Tab 走查实证无任何行可达）；
3. **权限注册表页的"用户权限检查器"整体不可用**（请求了不存在的 API 路由 404，且 `catch` 静默吞错为空列表）；
4. **权限矩阵的"已授予"图标对读屏器不可见**（`aria-hidden` 吃掉了唯一状态信号）；
5. **`CourseSearchSelect` 手写 Combobox + 第二套防抖计时器**（治理层面双边权威，违反项目自己的 §Forbidden dependencies）。

另发现 16 项 P2、37 项 P3，以及 2 处治理文档与实现的漂移。未发现服务端语义越权（前端未重实现业务规则；`deriveTakeExamView` 保持纯投影）。

**建议**：F-01（数据丢失）与 F-03（死功能）应作为正确性修复优先立项；F-02/F-04/F-06/F-07 作为可访问性批次收口；stale-response 守卫家族（与 #961 H-01/#959 同族）建议建立 focused follow-up 一次清完。

---

## B. Repository Reality

| 项 | 值 |
|---|---|
| BASE_SHA | `d3e74dd4860dd5bcbae1c50fe7c58af175a22594`（master，与 origin/master 同步；主工作树的未提交改动排除在外） |
| 审计载体 | 独立 detached worktree `/tmp/exam-frontend-audit`；审计结束时对受控文件零修改（仅 gitignored `.env` 供 dev server 使用） |
| 审计范围 | `apps/web`：158 个非测试 `.tsx` / ~4.1 万行 + `index.html` + 治理文档（frontend.md、ui-system.md 736 行全读、visual-foundation.md、DESIGN.md） |
| 技术栈（冻结，frontend.md） | React 19 / Vite 8 / TS 5.8 strict / Tailwind v4 / shadcn on radix-ui / react-router 7 / react-hook-form+zod / i18next / TipTap 3 / sonner |
| 工具链证据 | Node v24.15.0；typecheck exit 0；`eslint . --max-warnings=0` exit 0；`vitest run` 194 files / **2838 tests 全过**（首轮 72 个 suite 失败经排查为审计环境 worktree node_modules 符号链接遗漏所致，补齐后全绿，非 master 缺陷） |
| 运行时验证环境 | 本机 dev 栈：dev PostgreSQL/Redis（已在运行的常规开发容器，只读使用，未 seed/reset/truncate）；API dev server（主仓）+ web dev server（worktree）；因 3000 端口被宿主占用，API 改绑 3100 |
| 证据限制（SKIPPED） | 见 §I |

---

## C. 验证证据（真实浏览器）

按 skill 第 6 步执行，全部在真实 Chromium（Playwright 1.61，与仓库 E2E 同款）进行：

| 检查 | 结果 |
|---|---|
| `check_ui.mjs`（skill 原版脚本）@ `/login`，375+1280px | 0 控制台错误、0 溢出、0 未命名控件、0 无标签输入框；焦点走查 4/4 停靠点可见焦点 |
| 登录后 9 页 × {1280, 375} 驱动审计（复用 skill `page-audit.mjs` 纯函数 + UI 登录 + storageState） | **横向溢出：9 页全部 0px（375 与 1280）**；issue 命中见 §D/§F |
| axe-core 4.10.2（wcag2a/2aa/21aa/22aa）@ 9 个登录后页面（1280px） | **0 违规**（佐证 index.css token 对比度工程与"axe color-contrast gates StatusBadge"声明） |
| Tab 焦点走查 @ dashboard(36 stops)/grading-queue(22 stops) | **全部停靠点可见焦点**；但**没有任何表格行成为停靠点**（F-02 实证）；登录页 4/4 |
| 控制台错误 | 1280 轮全 0（permissions 页 2×404 → F-03）；首轮 375 轮触发 API 限流 429 污染数据，**已带节流重跑修正**（重跑后除 F-03 外全 0） |
| 截图 | 18 张全页截图（375+1280），逐张人工审读：移动卡片视图、表格分配、徽章、分页、空态、dashboard 卡片构成均正常 |

**运行时新发现**：F-03（权限页 404）为浏览器验证捕获、静态审计未发现的功能性缺陷——验证了 skill "必须在真实浏览器里看" 的核心规则。

---

## D. P1 发现（5 项）

**F-01 · 答题防抖保存在卸载/切域时被丢弃 —— 考生数据丢失窗口** 🌐🔍 → ✅代码复核
`apps/web/src/hooks/useSubmitFlush.ts:316-324`（scope 切换同型 :293-310）：
```ts
return () => {
  mountedRef.current = false;
  const scope = activeScopeRef.current;
  for (const entry of scope.pending.values()) clearTimeout(entry.timer);  // 清掉未触发的防抖保存
  scope.pending.clear();
};
```
`DEBOUNCE_MS = 1500`（:10）。考生键入后 1.5s 内经浏览器返回/页内导航/关标签离开，未触发的保存被直接清除——服务端保留旧值，恢复后即旧值；全库无 `pagehide`/`beforeunload` 答案 flush（`pagehide` 仅存在于 `clientEventBuffer.ts` 遥测路径）。丢弃静默，保存指示器不显示任何异常。
**修复**：unmount/scope 切换时 drain pending → inflight（复用现有 `runSave` 链）+ `fetch keepalive` 或 `pagehide` flush 兜底；至少要把"跳过的保存"变成可见状态。

**F-02 · 表格行/移动卡片激活仅鼠标可用 —— 键盘与读屏双重阻断** 🌐 → ✅代码复核
- `components/shared/DesktopDataTable.tsx:239-240`：`onRowClick` 渲染为 `<TableRow className="cursor-pointer" onClick={...}>`，`<tr>` 不可聚焦、无 role、无 Enter/Space；行导航（如 GradingQueuePage → `/admin/grading-queue/:id`）仅鼠标可达。
- `pages/admin/AuditLogPage.tsx:545-552`、`pages/admin/ImportLogsPage.tsx:225-231`：同型 `<TableRow onClick>` 展开行，无 `aria-expanded`。
- `components/shared/MobileRecordCard.tsx:33-35`：整卡激活用 `<div onClick>`。
**浏览器实证**：grading-queue Tab 走查 22 个停靠点无一可达行；audit-logs/grading-queue 各 59-61 个"clickable-looking non-interactive element"命中。
**修复**：行首单元格放真 `<Link>`/`<button>`（或 stretch link）；展开行用 disclosure button + `aria-expanded`；MobileRecordCard 内容包进 button/Link。

**F-03 · 权限注册表页"用户权限检查器"整体不可用（404 被静默吞掉）** 🌐 → ✅代码复核
`pages/admin/PermissionRegistryPage.tsx:110` 请求 `GET /api/admin/users?pageSize=100` → **404**（后端集合路由是 `/api/users`，见 `apps/api/src/routes/user.ts:89` 与 `UsersPage.tsx:275` 的实际用法；`/api/admin/users` 只有嵌套的 `:id/...` 子路由）。catch 分支（:114-116）静默 `setUsers([])`，无错误、无重试。浏览器复现：每次进入页面 2×404，检查器用户选择器恒为空 → "选择用户查看有效权限"功能死亡。注释（:105-106"与用户页同一读面"）已失真。
**修复**：改用 `/api/users`（对齐分页契约），失败走 `InlineErrorBanner`/ErrorState 可见路径，并修复注释。

**F-04 · 权限矩阵"已授予"状态对读屏器不可见** 🔍 → ✅代码复核
`pages/admin/PermissionRegistryPage.tsx:270-275` 给 `AppIcon` 传 `aria-label`，但 `AppIcon`（`components/shared/AppIcon.tsx:82-104`）是封闭联合：`aria-label` 仅在 `decorative={false} label={...}` 分支生效，默认分支硬编码 `aria-hidden="true"` 且不透传（该调用点还过不了 `AppIconProps` 类型）。矩阵单元格的唯一状态信号（图标）对 SR 消失，对低视力用户仅剩颜色。
**修复**：`<AppIcon icon={BadgeCheck} decorative={false} label={t("admin.permissions.roles.granted")} />`。

**F-05 · `CourseSearchSelect` 手写 Combobox + 第二套防抖计时器（治理级双边权威）** 🔍 → ✅代码复核
`components/question/CourseSearchSelect.tsx:52-316`：自实现 WAI-ARIA listbox 语义、`activeIndex` 键盘导航（Arrow/Home/End/Enter/Escape）+ 私有 `searchTimeout` 防抖（:64,:80-81,:112-113）。违反 `ui-system.md` §Forbidden dependencies（禁手写 Combobox/Select 类交互原语，必须来自 shadcn/Radix）与 §Toolbar filters（文本提交编排唯一所有者 `hooks/useDataViewTextCommit.ts`，不得出现第二套防抖）。
**修复**：迁到 Radix/shadcn combobox 语义或提级为共享 owner，文本提交并入 `useDataViewTextCommit`；如确有例外理由，按 visual-foundation.md §3 的显式例外流程在 Issue 中裁决。

---

## E. P2 发现（16 项）

| ID | 位置 | 问题 → 修复 | 验证 |
|---|---|---|---|
| F-06 | `components/ui/button.tsx:8`（同型 `input.tsx:11`/`select.tsx:40`/`badge.tsx:8`） | 焦点环实际对比度 ≈1.2-1.8:1：`focus-visible:ring-[3px] ring-ring/25`，`--color-ring: var(--primary-focus)` = `#93c5fd`（`index.css:161`）25% 不透明度混白后 ~1.3:1，违反 WCAG 1.4.11（3:1）；checkbox/radio/switch 用 `/50` 仍不足 → 用全不透明 `ring-ring` 或 ≥3:1 的专用 focus token | ✅代码复核 |
| F-07 | `components/shared/RowActions.tsx:152` + 各页 action 声明 | 全表行操作按钮同名：浏览器实证「编辑用户×17 / 禁用×11 / 更多操作×6 / 编辑考生×20 / 查看详情×20 / 删除考试×20」；SR 行导航听到的是重复同样的名字 → 在声明处插值行实体（如 `viewDetailFor: {title}`），或 RowActions 增加 `entityLabel` 组合 per-row `aria-label` | 🌐+🔍 |
| F-08 | `components/exam/SaveIndicator.tsx:62-74` | 答案自动保存状态（保存中/已保存/失败）无 `role="status"`/`aria-live="polite"`，考中状态变化对 SR 静默（同文件族 `TakeExamPage.tsx:1615-1616` 已有正确范式）→ 补 `role="status" aria-live="polite"` | 🔍 |
| F-09 | `components/layout/AppSidebar.tsx:279-293` | 折叠 rail 下导航链接仅剩 `title`（不可靠可达名）→ 恒定 `aria-label={label}` | 🔍 |
| F-10 | `pages/admin/GradingQueuePage.tsx:51-68` | 分页/刷新无 stale-response 守卫，快速翻页慢响应可覆盖新页数据（#961 H-01/#959 已修 ScoreListPage，本页为同族漏网；UsersPage.tsx:157-159 注释自证该契约）→ 补 `usersGenRef` 式 generation guard | 🔍 |
| F-11 | `pages/admin/GradingDetailPage.tsx:231-235,:389-407` | 并发判分允许（per-question pending），但两次 POST 后的权威重读 `refreshFromServer()` 无守卫：慢的 q1 GET 后到会把已提交的 q2 判分在 UI 上回退为可编辑 → 同上 generation/seq 守卫（对照 `reconcileAfterPostError` 的严谨度） | 🔍 |
| F-12 | `GradingQueuePage.tsx:48`、`UsersPage.tsx:153`、`CandidatesPage.tsx:121,139` | 页码/搜索/过滤状态仅 `useState` 不入 URL（对照 QuestionPage:298-303 全 URL 治理）：刷新/后退丢失查询状态，`listReturnNavigation` 契约对这三页失效 → 迁移到 searchParams | 🔍 |
| F-13 | `ProctorDashboardPage.tsx:1352,:1439,:1595`、`RecoveryAttemptDetailPage.tsx:652,:677` | 手写 warning `role="alert"` 横幅 ≥4 处重复（`border-warning/40 bg-warning/10` 恰为 feedback/recipes.test.tsx 自认的"M4 残留待迁移"）；`exam-ui/prefer-inline-error-banner` 只覆盖 destructive 对，warning 逃逸 → 给 feedback 层加 caution tone 并迁移 | 🔍 |
| F-14 | `pages/exam/StartExamPage.tsx:384-393` | 内联消息三元 class 拼接再造反馈三层（primary/destructive），同 M4 残留类 → 迁 feedback tone 层 | 🔍 |
| F-15 | `pages/admin/AttemptDetailPage.tsx:197-201` vs `ExamMonitoringPage.tsx:505-513` | 同一"遥测 level→颜色"映射在两页各写一份（bg+text 无 border，绕过 R6 派生 guard）→ 一处共享 level→`data-feedback-tone` 投影 | 🔍 |
| F-16 | `components/notifications/NotificationBell.tsx:158` | 直渲染 `<Bell className="size-4" />` 绕过 AppIcon 尺寸/描边权威（§Icons；无已声明例外）→ `<AppIcon icon={Bell} size="inline" />` | 🔍 |
| F-17 | 全库（0 命中） | **无任何 `prefers-reduced-motion` 处理**：`animate-spin` 8+ 处、Radix overlay tw-animate 动画，对前庭障碍用户无降级（ui-system NAV-2 只写了 minimal-motion 意图，无 gate）→ 全局 reduced-motion 规则/`motion-reduce:` 变体 + 可执行检查 | 🔍 |
| F-18 | `pages/exam/ResultPage.tsx:83-157,:623` | 页面本地"attempt 生命周期→色调"动态投影，绕过 `statusMeta.ts`/StatusBadge 单一权威（ui-system 自认此类"dynamically not statically enforceable"）→ 收敛进 statusMeta 或 EmptyState/ErrorState 族 | 🔍 |
| F-19 | `pages/admin/ExamDetailPage.tsx:429,:445,:504` | 关闭/下架/延期失败 toast 固定文案 `closeFailed/unpublishFailed/extendFailed`，未走 `getApiErrorMessage`（同文件 `handlePublish` :409-416 是对的）：`EXAM_CLOSE_NOT_ALLOWED + UNRESOLVED_ATTEMPTS_EXIST（activeAttemptCount）` 已有现成本地化文案但永不展示 → 与 publish 一致包装 | 🔍 |
| F-20 | `components/exam/wizard/wizardState.ts:195`、`ExamEditPage.tsx:94-96`、`ExamCreatePage.tsx:858` | 考试排期时间 seam 绕过 DateTimeContext：`datetime-local` 墙钟串按浏览器 TZ↔ISO 往返，而向导确认预览用 org TZ formatter 渲染同一字符串——org TZ ≠ 浏览器 TZ 时**确认页显示的时刻与实际存储/列表显示时刻不一致** → 墙钟↔instant 统一收敛到 `lib/dateTime.ts` 的产品 TZ 感知 seam | 🔍 |
| F-21 | `pages/admin/UsersPage.tsx:1030-1032,:1190` | 分页（20/页）+搜索过滤后的选项目录之外的分配目标显示为裸 UUID（`course ? name : a.courseId`）→ 分配 GET 投影携带 name/code，或按 id 补查 | 🔍 |

---

## F. P3 发现（37 项）

**可访问性/语义（9）**
- A9 `AdminLayout.tsx:166`、`ExamLayout.tsx:122` 双 shell 均无 skip link → 加 `sr-only focus:not-sr-only` 首锚点
- A10 `ui/dialog.tsx:96`、`ui/sheet.tsx:90` 关闭 X 无尺寸类 ≈16px 目标（<24px WCAG 2.5.8）→ `size-8 -m-2`
- A11 `DataTablePagination.tsx:75-83` 页码用 `<a href="#">` 执行动作 → 改 `<button>`（上一页/下一页已是 Button）
- A12 `DataTableContract.tsx:471-501` 截断/clamp 单元格 `tabIndex={0}` span 无 role，成为静默 Tab 停靠点 → 视觉隐藏全文（`sr-only`）替代 tabIndex
- A13 `NotificationBell.tsx:151-157` 静态 `aria-label` 覆盖徽章内未读数 → 名称含 count、徽章 `aria-hidden`
- A14 `TakeExamPage.tsx:1680-1690` 考试运行页无 `<h1>`（其余页面全有）→ 状态行提级或以考试名作 h1
- A15 `QuestionPage.tsx:846-852` `+N` 溢出 span 裸 `aria-label`（通用 span 上不可靠）→ `role="img"` 或 sr-only 文本
- A16 `SingleChoiceInput.tsx:34`、`TrueFalseInput` radio `name` 硬编码同组名——当前单题渲染不可达，多题同屏（预览/复看）即为产品 bug → `useId()` 派生（潜伏）
- A17 `ui/table.tsx:63-73`（及 PermissionMatrixTable 使用处）`<th>` 无 `scope="col"`（当前简单表头自动推断成立，矩阵表有跨行类单元格）→ 防御性补上

**React 状态/数据（7）**
- R5 `TakeExamPage.tsx:1709` ExamTimer 经 ref prop 收 `serverOffsetMs`，心跳校正后 `setIsDisconnected(false)` 在已 false 时 bail out 不重渲——倒计时显示可持续带未校正偏差（截止权威不受影响，display 级）→ offset 入 state 或 getter
- R6 `exam/transientReducer.ts:52-55` 并行保存下 q1 的 SAVE_SUCCESS 置 idle、q2 的 SAVE_FAILED 撞 `state==="saving"` 守卫被吞（页面另有 side-channel 与 per-question banner 兜底，但 transient 机终态错误）→ 引用计数或从 useSubmitFlush 状态派生
- R7 `ProctorDashboardPage.tsx:389-407` 轮询无 stale guard（F-10 同族）
- R8 `SystemDiagnosticsPage.tsx:113-180` `loadHealth/loadDiag` 自重叠轮询无守卫/AbortController（对照组：`useRecoveryProjection.ts:121-227` 为库内范本）
- R9 `contexts/DateTimeContext.tsx:27-46` 身份切换时旧 fetch 可后到写回前用户时区；`api.get` 支持 `signal` 未用
- R10 `QuestionEditPage.tsx:54-60` 课程列表与题目详情两个独立 GET 串行 → `Promise.all`（对照 QuestionPage:607）
- R11 `lib/api.ts:334-338,:350` 200 + 非法 JSON 落进同一 catch 被归类网络错误并计入网络失败限流 → 解析独立 try/catch

**设计系统治理（8）**
- G8 `TakeExamPage.tsx:1923,:1990` 裸 `<Flag fill strokeWidth>` 绕过 AppIcon：有 in-code 例外注释但未按 visual-foundation §3 在 Issue 裁决，且注释口径已过期（1.5 vs 2.25）→ 扩 AppIcon fill 角色或补裁决 Issue
- G9 模板字符串条件 class 8 处（`QuestionPage.tsx:946`、`StartExamPage.tsx:385`、`ResultPage.tsx:623`、`AttemptDetailPage.tsx:360`、`ExamMonitoringPage.tsx:512`、`TrueFalseInput.tsx:33`、`MultipleChoiceInput.tsx:43`、`SingleChoiceInput.tsx:30`）→ `cn()`
- G10 `QuestionPage.tsx:946` `min-w-[5.5rem]` 页面私有宽度无 token 出处 → 命名常量/recipe 或声明例外
- G11 `ExamLayout.tsx:89-97` DropdownMenuTrigger 内裸 `<button>`（AdminLayout 用 Button，chrome 不一致）
- G12 未命名 shell 尺寸：`AdminLayout.tsx:177` 抽屉 `w-[18rem]`（NAV-6 只冻结了 56/232）、`DatePicker.tsx:51` `w-[160px]` → 纳入宽度词汇表
- G13 `index.html` 无 `<meta name="theme-color">`；`next-themes` 仅被 `ui/sonner.tsx` 引用，近死依赖（暗色按 DESIGN.md 合同 out of scope，非违规）→ 清理或标注
- G14 文档漂移：`ui-system.md:723` 称"Six rules"，`apps/web/eslint.config.ts:116-124` 实为九条 error 规则 → 更新 §Active lint
- G15 文档表述：`ui-system.md:541-542`"recipes.css carries no width rules"不精确——结构 gate（`table/visual-finish.test.ts:211-218`）只禁列块内 width，文件仍有非列宽规则（row-actions icon 宽、fade 宽、presenter min-width:0）→ 收紧措辞

**状态矩阵/文案/i18n/内容（13）**
- S4 `ScoreListPage.tsx:327-330,:356-361` `passFilter` 过滤后 0 行仍显示"该考试暂未有已评分的答卷"（事实错误；对照 ExamPage:558-571 有 noMatch+清除筛选）→ 过滤感知文案 + 清除动作
- S5 `ResultPage.tsx:450-471` attempt→attempt 导航无 stale guard/_pending 门，旧 attempt 的标题/总分在加载中展示（F-10 同族）
- S6 `QuestionPage.tsx:647` 删除失败 toast 旁路错误码映射（`RESOURCE_CONFLICT` 语义丢失；对照 ExamPage:314、UsersPage:358）
- S7 `ResultPage.tsx:56,:60` 用户可见 CJK 顿号 `join("、")` 硬编码 → 入 locale
- S9 `DatePicker.tsx:58` date-fns 浏览器 TZ 格式化，绕过产品时间权威（F-20 同族轻症）
- S10 `zh-CN.ts:305` `loadingState:"加载中..."`（带注释自认与 `:301` `加载中…` 有别）vs ~18 处在途文案混用 ASCII 点 → 统一"…"
- S11 `PlaceholderPage.tsx:6` 用户可见中文硬编码（`// i18n-copy-allow: temporary` 但在线上路径）→ 入 catalog
- S12 `QuestionImportPage.tsx:223-230` CSV 模板表头+示例行文案硬编码在 tsx → hoist 到 locale
- S13 `MobileRecordCard.tsx:53` 不可点击页（如 UsersPage 移动态）长值 3 行 clamp 后无完整值通道（可点击页走详情页没问题）→ `title` 或 disclosure
- S14 `ConfirmDialog.tsx:78-88` + `RowActions.tsx:277-280` 确认删除后焦点落 `<body>`（Radix 回 trigger，trigger 已卸载）→ 删除成功后聚焦下一行动作或状态 live region
- S15 `StartExamPage.tsx:138-152` 准入队列 `while` 2s 无界轮询，无取消/无上限升级文案，考生只有浏览器 Back 可逃 → 取消入口 + 阶梯文案
- S16 `ExamListPage.tsx:312-364` 分区条件渲染，考试在 canTake→history 迁移时卡片视觉跳变（cosmetic）
- B2 🌐 `audit-logs` 2 个过滤输入框不在 `<form>` 内（Enter 不提交；skill 规则 3；浏览器 auditDom 命中）

---

## G. 页面状态矩阵（静态审查 + 浏览器复核）

| 页面 | Loading | Empty | Error | Pending 动作 | 长内容 |
|---|---|---|---|---|---|
| UsersPage | ✓ LoadingState(role=status) | ✓ 含引导 | ✓ ErrorState+重试 | ✓ saving/togglingId/busy-close | 部分（截断✓，但 F-21 裸 UUID） |
| CandidatesPage | ✓ | ✓ noMatch+清除+CTA | ✓ | ✓ loadedKeyRef 门 | ✓ min-w-0 truncate |
| ExamPage | ✓ | ✓ empty/noMatch+清除筛选 | ✓ 按查询键控+重试 | ✓ pendingSummary/无 stale 行（B12） | ✓ 列分配系统 |
| QuestionPage | ✓ | ✓ | ✓ | ✓ 删除确认/加载 ref | ✓ |
| ScoreListPage | ✓ | 部分（F-4→S4 文案失真） | ✓ + 返回入口 | ✓ exporting 禁用/gen guard | ✓ |
| ResultsOverviewPage | ✓ | ✓ | ✓ | ✓ 禁用带原因 | ✓ |
| GradingQueuePage | ✓ | ✓ | ✓ | n/a（只读） | ✓ |
| DashboardPage | ✓ 骨架镜像布局 | ✓+创建动作 | ✓ | ✓ 卡片独立部分失败 | ✓ |
| ExamListPage | ✓ | ✓ | ✓ 重试 | n/a | ✓ min-w-0 break-words |
| StartExamPage | ✓ | n/a | ✓ 错误码逐一映射 | ✓ isStarting+排队面板 | ✓ |
| TakeExamPage | ✓ 有标签 | n/a | ✓ ErrorState+恢复失败面自聚焦重试 | ✓ 提交禁用 while flushing+override 通道 | ✓ ContentRenderer+min-w-0 |
| ResultPage（考生） | ✓ | n/a | ✓ 重试 | n/a | ✓ AnswerDisclosure 可键盘操作 |

---

## H. ✓ 通过清单（正面信号，均经验证方法确认）

**浏览器级**：9 页 375/1280 双宽度 0 横向溢出；axe WCAG 2.2 AA（2A/2AA/21AA/22AA）9 页 0 违规；全部 Tab 停靠点可见焦点（含登录页）；1280 轮除 F-03 外 0 控制台错误；移动卡片视图/表格构成/徽章/分页视觉正常。

**结构级（静态验证）**：
- 派生而非同步：`useEffect` 直拷 props→state 全库 0 命中；`view = useMemo(deriveTakeExamView(snapshot))` 纯投影，零业务规则重实现
- 组件内定义组件：0 命中（全部模块级；GradingDetailPageRoute 还用 `key={id}` 防跨 attempt 状态复用）
- 异步状态封闭联合（SaveStatus/TransientState/RestoreState/CatalogStatus/loadState），无不可能布尔组合
- 无乐观更新故无回滚债；判分失败 `reconcileAfterPostError` 按丢失响应歧义对账服务端（范式级）
- 考试运行时：截止服务端权威（到期仅展示，auto-submit 必须 `isDeadlineFrozenSnapshot` 服务端复验，defer+单调钟冷却）；per-question 保存串行链+代际+`baseVersion/clientSeq`，`STALE_VERSION` 对账；submit 对话框 flush 前禁用
- 变更纪律：`RowActions` 对 destructive 无 confirm 在 dev 直接 throw；全部对话框 busy-close 契约；双击提交三重防护
- 错误面：`console.*` 全禁且有执法；`ERROR_CODE_KEYS` 编译器强制覆盖全部错误码，未知码回落 serverMessage→`errors.unknown`（C3 合同精确落地）
- 治理：usage 文件 0 颜色字面量；AppIcon 仅 2 处例外（F-16/G8）；`PageHeader` 35 页采用、无第二表格壳/第二分页实现（除 F-05）；`shadow` 仅授权 owner；NAV 契约成立（`SidebarContent` 双壳复用、`navMatch.ts` 单一 authority、恰一 `aria-current`）；`transition-all` 仅 shadcn 原语层 2 处
- 表格链：`DataTableShell`/`DataWorkbench` 共享 `TableScrollSurface`，测量顺序固定、governed 表格外无回退（fail loud）
- `<img>` 全库 0（vacuous pass）；无 `window.confirm/alert`；无禁用依赖（antd/MUI/Chakra/Headless UI）
- token 工程：index.css 语义 token + @theme inline，对比度带历史注释与下限值；焦点环问题只在 opacity 用法（F-06），token 本身有工程

---

## I. SKIPPED / 未覆盖范围（如实披露）

1. **考生答题运行时未做浏览器实操**（TakeExamPage 静态已深读 + 单测 2838 全绿覆盖）：启动真实 attempt 会向 dev 数据库写入业务数据，本轮坚持只读浏览，未创建/提交 attempt。F-01 的浏览器级复现（键入→1.5s 内离开→resume 比对）留待修复 PR 验证时执行。
2. **候选端页面未以 Candidate 身份实操**（Admin 访问 `/exam/list` 被 capability 路由重定向回管理端 dashboard，属按设计行为）；结果页/开始页的浏览器截图缺失。
3. **读屏实机（NVDA/VoiceOver）、真机触控目标、`focus-appearance` axe 规则**（不在默认 tag 集）未覆盖；F-06 的精确对比度为计算值。
4. **i18n**：仅 zh-CN 单 locale，en 缺 key 对比 N/A；`translate="no"` 用法未发现需求场景。
5. **暗色模式**：DESIGN.md 明确 out of scope，未审（G13 的 theme-color/next-themes 仅作 hygiene 记录）。
6. **E2E lane / coverage 全量 / `pnpm verify`** 未执行（非本轮目标；apps/web vitest 已全绿）。首轮 375 浏览数据被 API 限流（429）污染，已节流重跑替换；截图与报告以重跑数据为准。

## J. 与既有 Issue 的关系

- **#961 / #959（H-01 家族）**：ScoreListPage 竞态已修；本审计发现 **GradingQueuePage（F-10）、ProctorDashboardPage（R7）、SystemDiagnosticsPage（R8）、DateTimeContext（R9）、ResultPage（S5）** 为同族"last-settled-response-wins"扩展面，建议并入该家族的 focused follow-up 一次性补齐守卫，避免逐页打补丁。
- **PermissionRegistryPage**：#961 已修 `loadAuthority` 竞态（本审计确认 `authorityGenerationRef` 在位）；F-03（user-picker 404）与 F-04（图标 aria）为独立新缺陷。
- 本 Issue 为只读审计报告，不携带施工授权；各发现立项时应按 AGENTS.md 走 OPEN Issue 授权流程。

## K. 修复优先级建议

1. **正确性**：F-01（考生数据丢失窗口，建议带"键入→离开→resume"回归测试）＋ F-03（一行 URL 修复 + 失败可见化）。
2. **可访问性阻断**：F-02 + F-04（键盘/SR 可达）→ F-06 + F-07（焦点环对比度、行操作命名，影响全应用）。
3. **结构收口**：F-17（reduced-motion 全局规则 + gate）＋ F-10 守卫家族 focused follow-up ＋ F-05/F-13/F-14/F-15（反馈层与 combobox 治理归一）。
4. **批量小项**：P3 按域分批（a11y 一批、状态守卫一批、治理/文案一批）；G14/G15 文档漂移可随手修。

---

## 附录：方法与重现

**Skill 获取**：真实 Chrome（CDP `--remote-debugging-port`，Chrome for Testing 149）访问 GitHub 目录页核对完整文件清单 → `git clone --depth 1 --filter=blob:none --sparse davila7/claude-code-templates` + `sparse-checkout set cli-tool/components/skills/development/senior-frontend`；`SKILL.md`/`references/*` 全文审读作为审计准则；`scripts/*.mjs` 逐行安全审查后使用。

**运行时验证重现**：
```bash
# API（主仓，3100 以避让宿主 3000 占用）+ Web（worktree 源码）
DEV_API_PORT=3100 pnpm --filter @exam/api dev &
cd /tmp/exam-frontend-audit/apps/web && ./node_modules/.bin/vite &
# skill 原版检查器（公共页）
cd apps/e2e && node <skill>/scripts/check_ui.mjs http://localhost:5173/login --out /tmp/ui-check/login --widths 375,1280
# 登录后页面驱动审计（UI 登录 → storageState → auditDom/axe/focusWalk × 9 页 × 2 宽度）
node /tmp/audit-browser.mjs
```
**门禁**：`tsc -p tsconfig.typecheck.json`（exit 0）；`eslint . --max-warnings=0`（exit 0）；`vitest run`（194 files / 2838 tests passed）。
**证据文件**（临时目录，不入库）：`/tmp/ui-check/`（18 张截图、authed-report.json、rerun-375.json、login/report.json、axe 摘要）；`/tmp/audit-{tc,eslint,vitest2}.log`。

**证据可信度标注**：🌐=真实浏览器复现；🔍=静态审计发现（4 个只读 subagent）；✅代码复核=主审打开文件核实（全部 P1 与关键 P2 均经复核；subagent 的 load-bearing 断言抽查未发现事实错误）。
