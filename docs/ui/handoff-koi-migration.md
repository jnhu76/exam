# Job: koi-ui 视觉风格全站迁移（交接文档）

> **状态**：进行中 · **分支**：`ui/koi-admin-visual-spike`（已 rebase 到 master，UI 独立，不污染 master）
> **最后更新**：2026-06-27
> **目标**：把 koi-ui（Vue3+ElementPlus）的"增删改查硬朗网格 + 数据看板"视觉精髓，移植到本项目 React/shadcn/Tailwind v4。**只改 UI，不改业务逻辑/API/路由/contract**。

任何接手者：先读本文件「验收标准」「迁移模式」「避坑」三节，再按「任务表」状态继续施工。

---

## 0. 参考资料

- **koi-ui 原仓库**（本地 clone）：`/home/hoo/Source/_refs/koi-ui`
  - CRUD 页样板：`src/views/system/{user,role,post,notice}/index.vue`
  - 数据看板样板：`src/views/home/`（`HomeStatCards` 是 metric 卡原型）
  - 表格/表单组件：`src/components/{KoiCard,KoiSearch,KoiToolbar,KoiTag,KoiDrawer,KoiDialog}/`
  - 主题变量：`src/styles/theme-vars.scss`（亮/暗色 CSS var）
- **本项目的视觉规范**：`docs/ui/00-ui-constitution.md` ~ `09-phase2-readiness.md`
- **技能约束**：`$shadcn`（className 只布局不改色 / `gap-*` 不用 `space-*` / `size-*` / `cn()` / 图标 `data-icon` / 语义色 token 不写死色值），`$tailwind-design-system`（v4 CSS-first `@theme`，`@custom-variant dark`）

---

## 1. 已完成（地基 + 试点，全部验证通过）

| 模块 | 文件 | 做了什么 |
|---|---|---|
| **tokens + 暗色** | `src/index.css` `src/styles/admin-theme.css` | `@custom-variant dark`；`--admin-*` 接入 `@theme inline`；完整 `.dark` 主题（koi `#141414`/`#1D1E1F`/`#414243`）；圆角词表（面板 8px / tab 6px / tag 4px） |
| **布局 shell** | `components/layout/{AdminLayout,AppSidebar,BrandHeader,BrandMark,ExamLayout}.tsx` | topbar 加 `ThemeToggle`；侧栏激活态改 koi 软底 `bg-sidebar-active-soft`；内容区 `bg-admin-page` |
| **暗色切换** | `components/theme/{ThemeProvider,ThemeToggle}.tsx` | `useTheme`（localStorage + `prefers-color-scheme`，**降级容错**无 provider 不报错）；`index.html` FOUC 防护脚本 |
| **admin 组件层** | `components/admin/*` `lib/statusMeta.ts` | 收敛 tone→class 三处重复到 `statusMeta.ts` 单源（`toneTagClass`）；`AdminTableShell`/`AdminPageCard`/`AdminSearchPanel`（8px 圆角 hairline）；`AdminToolbarButton`（动词色）+ `AdminIconButton` + `MetricCard` |
| **硬朗表格** | `components/ui/table.tsx` | **全格线竖线** + 表头硬背景 `bg-admin-table-header` + 表头 `font-semibold text-foreground` + 行 hover 实色 |
| **试点 CRUD** | `UsersPage` `QuestionPage` `CandidatesPage` `CoursePage` `ExamPage` | 套 `AdminShell > AdminShellHeader > AdminSearchPanel > AdminTableShell` |
| **诊断页** | `SystemDiagnosticsPage.tsx` | metric 卡网格 + recharts 资源趋势折线（CPU/内存） |
| **考试运行时** | `TakeExamPage` `ExamTimer` `QuestionNavigator` `ExamListPage` `ExamLayout` | 卡片对齐 admin-radius/hairline；状态改 soft 色 |
| **端口修复** | `apps/web/vite.config.ts` | proxy `3001→3000`，对齐 `.env APP_PORT=3000`（修了仓库既有 bug） |

**验证基线**：`typecheck` ✅ · `lint`/`lint:copy`/`lint:arch` ✅ · `web test` **616/616** ✅ · `build` ✅  
**本轮新增**：D1 (DashboardPage)、E1-E3 (ExamDetail/AttemptDetail/GradingDetail)、F-1~F-3 (ExamCreate/Edit/QuestionEdit)、X3-X5 (StartExam/Result/Settings)、S1-S2 (Login/Settings)、D2-D3 (ExamMonitoring/ProctorDashboard)、P3-1 (NotificationBell)

---

## 2. 迁移模式（已验证，照抄即可）

### 2.1 列表型 CRUD 页 — 标准解剖结构

```tsx
<AdminShell>
  <AdminShellHeader title="XX管理" actions={<AdminToolbarButton verb="add" icon={Plus}>新增</AdminToolbarButton>} />
  <AdminSearchPanel>{/* 内联筛选/搜索字段 */}</AdminSearchPanel>
  {empty ? <EmptyState/> : (
    <AdminTableShell>
      <Table>
        <TableHeader><TableRow>...</TableRow></TableHeader>
        <TableBody>{rows.map(...)}</TableBody>
      </Table>
    </AdminTableShell>
  )}
  <DataTablePagination ... />   {/* 有分页的才加 */}
</AdminShell>
```

**要点**：
- 旧 `PageHeader`/`ListToolbar`/`DataToolbar` → 换 `AdminShellHeader`/`AdminSearchPanel`
- 状态字段（纯文本/旧 Badge）→ 换 `AdminStatusTag`（status 走 `statusMeta`）
- 动作按钮（新增/导出）→ `AdminToolbarButton verb="add"|"import"|...`
- **不改**：业务逻辑、API 调用、Dialog/Sheet 交互、数据结构

### 2.2 动词色映射（koi plain 语义）
`add=primary` · `edit=success` · `delete=danger` · `export=warning` · `import=info` · `search=primary` · `reset=danger`

### 2.3 状态色（soft 软底）
所有状态统一走 `statusMeta.ts` → `AdminStatusTag`。tone：`primary/success/warning/destructive/info/muted/secondary`。

### 2.4 命令（施工 + 验收）
```bash
pnpm --filter web typecheck          # 必须通过
pnpm lint && pnpm lint:copy && pnpm lint:arch   # 必须通过
pnpm --filter web test -- --run      # 616+ 必须全绿（迁移不应减测试）
pnpm --filter web build              # 必须通过
```

---

## 3. 验收标准（Review Checklist）

**每个页面迁移后，逐项核对：**

- [ ] **结构**：`AdminShell > AdminShellHeader > AdminSearchPanel(可选) > AdminTableShell` 层级正确，无遗留 `<div className="flex flex-col gap-6">` 旧壳
- [ ] **无旧组件残留**：`grep` 该页无 `PageHeader`/`ListToolbar`/`DataToolbar`/`DataTableShell`（除非有意保留）
- [ ] **状态字段**：状态值用 `AdminStatusTag`，不是纯文本或旧 `Badge variant`
- [ ] **动作按钮**：新增/导出等用 `AdminToolbarButton` + 正确 `verb`；图标用 `data-icon="inline-start"`
- [ ] **零业务改动**：API 调用、数据结构、Dialog/Confirm 交互、事件处理函数**逐字未动**
- [ ] **中文字符串**：用户可见文案保持 zh-CN（`lint:copy` 会拦硬编码部署场景词）
- [ ] **暗色适配**：手动切 `.dark`，表格/卡片/状态色/按钮可读
- [ ] **shadcn 规范**：`gap-*` 非 `space-*`；`size-*` 非 `w- h-`；无写死色值（用 token）；无手写 z-index
- [ ] **测试**：该页 `*.test.tsx`（若有）全过；测试里断言的文案/`data-testid` 不得改动
- [ ] **回归**：`typecheck` + `lint*` + `pnpm --filter web test --run`（616+ 全绿）+ `build`

---

## 4. 任务表（Job Table）

状态：`DONE` / `TODO` / `SKIP`。优先级 P0=高 P1=中 P2=低。

| ID | 类别 | 页面/模块 | 文件 | 模式参考 | 优先级 | 状态 | 备注 |
|----|------|-----------|------|----------|--------|------|------|
| F1 | 地基 | tokens+暗色 | `index.css` `admin-theme.css` | — | P0 | DONE | |
| F2 | 地基 | 布局 shell | `components/layout/*` | — | P0 | DONE | |
| F3 | 地基 | admin 组件层 | `components/admin/*` | — | P0 | DONE | |
| F4 | 地基 | 硬朗表格 | `components/ui/table.tsx` | — | P0 | DONE | |
| F5 | 地基 | 暗色切换 | `components/theme/*` | — | P0 | DONE | |
| **L1** | 列表 | 用户管理 | `pages/admin/UsersPage.tsx` | §2.1 | P0 | **DONE** | 试点 |
| **L2** | 列表 | 题目管理 | `pages/admin/QuestionPage.tsx` | §2.1 | P0 | **DONE** | 试点 |
| **L3** | 列表 | 考生管理 | `pages/admin/CandidatesPage.tsx` | §2.1 | P0 | **DONE** | 试点 |
| **L4** | 列表 | 课程管理 | `pages/admin/CoursePage.tsx` | §2.1 | P0 | **DONE** | 试点 |
| **L5** | 列表 | 考试管理 | `pages/admin/ExamPage.tsx` | §2.1 | P0 | **DONE** | 试点 |
| L6 | 列表 | 审计日志 | `pages/admin/AuditLogPage.tsx` | §2.1 | P1 | DONE | |
| L7 | 列表 | 成绩列表 | `pages/admin/ScoreListPage.tsx` | §2.1 | P1 | DONE | 含 MetricCard 统计行 |
| L8 | 列表 | 评分队列 | `pages/admin/GradingQueuePage.tsx` | §2.1 | P1 | DONE | |
| L9 | 列表 | 导入日志 | `pages/admin/ImportLogsPage.tsx` | §2.1 | P2 | DONE | |
| L10 | 列表 | 成绩总览 | `pages/admin/ResultsOverviewPage.tsx` | §2.1 | P2 | DONE | |
| L11 | 列表 | 考生字段配置 | `pages/admin/CandidateFieldsPage.tsx` | §2.1 | P1 | DONE | |
| L12 | 列表 | 题目导入 | `pages/admin/QuestionImportPage.tsx` | §2.1 | P2 | DONE | |
| **D0** | 看板 | 系统监控 | `pages/admin/SystemDiagnosticsPage.tsx` | koi home | P0 | **DONE** | metric+recharts |
| **D1** | 看板 | 概览首页 | `pages/admin/DashboardPage.tsx` | koi home / D0 | P1 | **DONE** | MetricCard 网格 + AdminShell |
| D2 | 看板 | 考试监控 | `pages/admin/ExamMonitoringPage.tsx` | D0 | P2 | **DONE** | AdminShell + AdminShellHeader |
| D3 | 看板 | 监考面板 | `pages/admin/ProctorDashboardPage.tsx` | D0 | P2 | **DONE** | AdminShell + AdminStatusTag |
| **E1** | 详情 | 考试详情 | `pages/admin/ExamDetailPage.tsx` | §2.2 | P1 | **DONE** | AdminShell + AdminPageCard + AdminStatusTag |
| E2 | 详情 | 尝试详情 | `pages/admin/AttemptDetailPage.tsx` | §2.2 | P1 | **DONE** | |
| E3 | 详情 | 评分详情 | `pages/admin/GradingDetailPage.tsx` | §2.2 | P2 | **DONE** | |
| F-1 | 表单 | 新建考试 | `pages/admin/ExamCreatePage.tsx` | §2.2 | P2 | **DONE** | |
| F-2 | 表单 | 编辑考试 | `pages/admin/ExamEditPage.tsx` | §2.2 | P2 | **DONE** | |
| F-3 | 表单 | 编辑题目 | `pages/admin/QuestionEditPage.tsx` | §2.2 | P2 | **DONE** | |
| **X1** | 考生 | 答题页 | `pages/exam/TakeExamPage.tsx` | — | P0 | **DONE** | |
| **X2** | 考生 | 考试列表 | `pages/exam/ExamListPage.tsx` | — | P0 | **DONE** | |
| X3 | 考生 | 开始考试 | `pages/exam/StartExamPage.tsx` | X1 | P1 | **DONE** | 手写警告→Alert 组件 |
| X4 | 考生 | 成绩页 | `pages/exam/ResultPage.tsx` | X1 | P1 | **DONE** | 待评分卡→Alert |
| X5 | 考生 | 考试设置 | `pages/exam/ExamSettingsPage.tsx` | X1 | P2 | **DONE** | 无改动 |
| S1 | 杂项 | 登录页 | `pages/LoginPage.tsx` | — | P2 | **DONE** | 错误提示→Alert destructive |
| S2 | 杂项 | 平台设置 | `pages/admin/SettingsPage.tsx` | §2.2 | P2 | **DONE** | AdminShell + AdminShellHeader |
| P3-1 | phase3 | 通知铃铛 UI 占位 | `components/notification/NotificationBell.tsx` | koi SSE 通知 | P2 | **DONE** | **纯样式占位，无后端**；见 §6 |
| P3-2 | phase3 | 邮件模板 UI 占位 | （无对应页） | koi | P2 | SKIP | phase3 立项再做 |

### 2.2 详情/表单页模式（koi 详情面板风）
```tsx
<AdminShell>
  <AdminShellHeader title="XX详情" description="..." actions={<返回/编辑按钮>} />
  <div className="grid gap-4 lg:grid-cols-3">
    <AdminPageCard className="lg:col-span-2" title="主体">...</AdminPageCard>
    <AdminPageCard title="侧边信息">...</AdminPageCard>  {/* 状态/时间线 */}
  </div>
</AdminShell>
```

---

## 5. 避坑（已踩过的坑）

1. **端口**：`.env APP_PORT=3000`，vite proxy 必须指 `3000`（已修）。web 访问 **4173**。
2. **db dist 过期**：改了 `packages/db/src` 后必须 `pnpm --filter @exam/db build`，否则 api 的 `tsx` 解析到旧 dist 报 `does not provide an export named 'xxx'`。
3. **`ButtonProps` 没导出**：shadcn `button.tsx` 只导出 `Button`/`buttonVariants`。自定义按钮用 `ComponentProps<"button">`。
4. **`useTheme` 容错**：不能 `throw`（layout.test.tsx 不挂 ThemeProvider 直渲染 AdminLayout），用 fallback。
5. **`lint:copy`**：会拦硬编码部署场景词（"校内"/"大学"等）。中文文案保持通用。
6. **测试文案**：迁移页若改了 DOM 结构，检查 `*.test.tsx` 断言的 `data-testid` 和可见文案，**不得改动这些字符串**。
7. **暗色 token**：新加颜色必须同时在 `:root` 和 `.dark` 定义，否则暗色下失效。

---

## 6. phase3 占位说明（通知/邮件）

**约束**：按 AGENTS.md，phase3 功能（真实 SSE 通知、邮件发送）现在**只能做 UI 视觉占位**，不能实现真实逻辑/接后端。

**通知铃铛占位（P3-1）**建议：
- topbar 右侧加一个 ghost icon 按钮（Bell 图标）+ 红点角标
- 点击弹 `DropdownMenu`，里面是**写死的示例通知项**（"考试已发布"等），标注「演示数据」
- 无 API、无轮询、无真实推送；phase3 立项后替换为真实数据源

**邮件（P3-2）**：phase3 前无对应页面，SKIP。

---

## 7. 当前可用环境（接手者可直接跑）

```bash
docker compose -f docker-compose.dev.yml up -d db   # Postgres :15432（已起 + 已灌 e2e 数据）
pnpm --filter api dev    # API :3000（已起）
pnpm --filter web dev    # Web :4173（已起）
```

**登录账号**（e2e 种子）：
- Admin：`admin` / `admin123`（看管理后台 + 系统监控）
- 考生：`candidate1`/`candidate123`（进行中）、`candidate2`（可开始）、`candidate4`（已评分）

---

## 8. 施工顺序建议（给接手者）

1. ✅ ~~先扫一遍 P1 列表页（L6-L8, L11）~~ **全部已完成（L6-L12）**
2. ✅ ~~**D1 Dashboard**（metric 卡网格，参考 D0）~~ **已完成**
3. ✅ ~~**详情页 E1-E3**（考试/尝试/评分详情）~~ **全部已完成**
4. ✅ ~~**表单页 F-1~F-3**（创建/编辑考试、编辑题目）~~ **全部已完成**
5. ✅ ~~**考生剩余 X3-X5** + **杂项 S1-S2**~~ **全部已完成**
6. ✅ ~~**监控页 D2-D3**~~ **全部已完成**
7. ✅ ~~**phase3 占位 P3-1**~~ **已完成**

> **全表所有 TODO 已全部完成。** 当前：所有 P0/P1/P2 页面均已迁移，P3-2 仍 SKIP。

后续如有 UI 任务：
1. **验收全站一致性**——逐页对照 §3 验收标准核查
2. **统一状态色**——检查所有状态字段是否都用了 `AdminStatusTag` + `statusMeta`
3. **暗色适配**——全站手动切 `.dark` 逐页检查
4. **移动端响应式**——检查表格/表单在小屏下的表现
5. **Phase 3 立项后**——把 `NotificationBell` 占位替换为真实数据源
