# Migration Plan

> 本文档定义 Phase1.4 UI Foundation Reset 的 PR 拆分计划。PR 1 当前为 audit-only：只把真实前端证据写回文档，不修改产品代码。

---

## Sequencing Rules

- 每个 PR 只解决对应 bug group，不做 broad UI rewrite。
- 页面迁移从一个页面开始验证模板，不能批量迁移多页。
- `components/ui/` 继续只承载 shadcn/ui primitives，不放业务组件。
- 状态颜色和图标集中到项目级组件，不能散落到页面里。
- Exam Runtime 不能套 Admin Sidebar。
- Phase2 功能只允许出现在文档模板中，不能暴露 working route 或 fake UI。

---

## PR 1: Audit Only After Documentation Convergence

### Scope

- 审计当前 frontend routing、bootstrap、layout、branding、状态组件、CSS token 和 icon 使用。
- 使用 Context7 / official docs 校验 React 19、Vite、React Router、Tailwind CSS v4、shadcn/ui、Radix UI、lucide-react 对本仓库有影响的行为。
- 更新 `docs/ui/07-ui-bug-inventory.md` 和 `docs/ui/08-migration-plan.md`。
- 记录 `apps/web/src/globals.css` 不存在，当前全局样式入口是 `apps/web/src/index.css`。

### Out of scope

- 不修改 React 组件。
- 不修改 CSS。
- 不修改 Tailwind / Vite 配置。
- 不修改 API、数据库、认证、考试协议。
- 不实现 Phase2 功能。

### Files touched

- `docs/ui/07-ui-bug-inventory.md`
- `docs/ui/08-migration-plan.md`

### Verification commands

```bash
pnpm format:check
```

### Expected success signal

- Bug inventory 对 B01-B08 均包含 Symptom、Files involved、Likely root cause、Minimal fix direction、Risk、Recommended PR、Out of scope。
- Migration plan 明确下一 PR 的最小范围和验证信号。
- 无产品代码 diff。

### Known risks

- 本 PR 不修复 UI bug，只降低后续 PR 的误改风险。

---

## PR 2: Route Refresh / Title Loading / ErrorBoundary / App Bootstrap

### Bugs covered

- B01 title remains loading forever
- B02 direct refresh blank page

### Scope

- 为浏览器 `document.title` 增加集中同步逻辑，不能停留在 `apps/web/index.html` 的 `加载中`。
- 让 Admin topbar title 复用集中 route metadata，避免 `App.tsx` 和 `AdminLayout.tsx` 手工重复。
- 为未匹配或占位路由提供稳定 fallback title。
- 保持 `BrowserRouter` 路由结构不变。
- 保持顶层 `ErrorBoundary`，必要时补充 React 19 `createRoot` error hook 作为 diagnostics，但不引入外部 logging service。
- 验证 direct refresh 在 `/admin/dashboard`、`/admin/exams/:id`、`/exam/list`、`/exam/:id/start` 下至少出现 skeleton、登录页、错误页或实际内容之一。
- 验证生产 server fallback：`apps/api/src/server.ts` 在 `public/` 存在时对 non-API deep link 返回 `index.html`。

### Out of scope

- 不改变认证流程。
- 不改变 API 请求语义。
- 不改变页面布局视觉。
- 不为了详情页标题新增业务 API 拉取。

### Files likely touched

- `apps/web/src/App.tsx`
- `apps/web/src/main.tsx`（仅当加入 React 19 root diagnostics）
- `apps/web/src/components/layout/AdminLayout.tsx`
- `apps/web/src/components/layout/BrandProvider.tsx`
- `apps/web/src/components/shared/ErrorBoundary.tsx`
- `apps/web/src/lib/routes.ts`
- `apps/web/src/lib/pageMeta.ts`（新建，若采用集中 route metadata）
- 相关测试文件

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

### Expected success signal

- 浏览器 title 不再停留在 `加载中`。
- Admin topbar 对已知路由显示非空 title。
- 直接刷新深层路由不会空白。
- 认证恢复失败时跳转登录页或显示明确状态。
- ErrorBoundary fallback 可被测试覆盖。

### Known risks

- Title metadata 与路由定义再次漂移；需要测试覆盖所有 `App.tsx` route entries。
- 错误处理若吞掉真实错误，会降低调试能力；开发环境应保留详细信息。

---

## PR 3: Sidebar / BrandMark / Navigation Collapse Rebuild

### Bugs covered

- B03 sidebar collapse uses logo slot
- B04 no stable BrandMark fallback
- B08 SVG/icon usage inconsistent（BrandMark 部分）

### Scope

- 创建或重构 `BrandMark`，提供本地、离线可用、语义中立的图形 fallback。
- `BrandHeader` 展示 BrandMark + 品牌名称；compact 时只隐藏文字，不隐藏 BrandMark。
- 分离 `BrandMark` 与 `SidebarCollapseButton`，collapsed 状态下两者都可辨认。
- 保留现有 sidebar 宽度、菜单项和路由。
- 为 icon-only collapse button 保留 `aria-label`。

### Out of scope

- 不重写整个 AdminShell。
- 不改变导航信息架构。
- 不实现 logo 上传、远程图片裁剪或 CDN。
- 不迁移页面内容。

### Files likely touched

- `apps/web/src/components/layout/AppSidebar.tsx`
- `apps/web/src/components/layout/BrandHeader.tsx`
- `apps/web/src/components/layout/BrandProvider.tsx`
- `apps/web/src/components/layout/BrandMark.tsx`（新建，若拆分）
- `apps/web/src/components/layout/layout.test.tsx`
- `apps/web/src/components/layout/BrandProvider.test.tsx`

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

### Expected success signal

- expanded sidebar 显示 BrandMark + 品牌名称 + 独立 collapse button。
- collapsed sidebar 显示 BrandMark，collapse button 不伪装成 logo。
- `PanelLeft` 不再作为品牌 logo 使用。
- fallback 品牌不包含学校/学生等部署专属语义。

### Known risks

- 56px collapsed 宽度中同时容纳 mark 和 button 可能拥挤；先以稳定布局和可访问性为准，不追求视觉重做。

---

## PR 4: Design Tokens / CSS Cleanup / Status Grammar Implementation

### Bugs covered

- B05 scattered CSS / Tailwind status colors
- B08 SVG/icon usage inconsistent（status icon 部分）

### Scope

- 新建 `statusMeta`，集中定义 label、tone、icon。
- 新建项目级 `StatusBadge`，放在 `components/shared/`。
- 优先覆盖 ExamStatus、ExamEnrollment、ExamAttempt、Answer Save、connection status。
- 将高频页面中的状态 badge 从 `STATUS_LABELS` / `STATUS_VARIANT` 或局部 `StatusBadge` 迁移到统一组件。
- 保留非状态用途的 shadcn `Badge`，例如题型、标签、计数、普通分类。
- 继续使用 `apps/web/src/index.css` 中的 semantic tokens，不引入 raw palette。

### Out of scope

- 不改变状态机。
- 不改变 API status 字段。
- 不把所有 Badge 一次性替换。
- 不修改 `components/ui/badge.tsx` 的 shadcn primitive 语义。

### Files likely touched

- `apps/web/src/lib/statusMeta.ts`（新建）
- `apps/web/src/components/shared/StatusBadge.tsx`（新建）
- `apps/web/src/components/shared/ConnectionIndicator.tsx`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/pages/admin/DashboardPage.tsx`
- `apps/web/src/pages/admin/ExamPage.tsx`
- `apps/web/src/pages/admin/ResultsOverviewPage.tsx`
- `apps/web/src/pages/admin/ExamDetailPage.tsx`
- focused tests for touched components/pages

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
rg -n "bg-(green|red|yellow|blue|emerald|amber|orange|rose)-|text-(green|red|yellow|blue|emerald|amber|orange|rose)-|border-(green|red|yellow|blue|emerald|amber|orange|rose)-" apps/web/src
```

### Expected success signal

- 状态 label / tone / icon 不再由页面局部重复定义。
- `DashboardPage` 不再定义本地 `StatusBadge`。
- `ConnectionIndicator` 消费统一状态 metadata 或等价集中结构。
- `components/ui/` 未新增业务组件。

### Known risks

- 测试中依赖 `data-variant` 或 badge 文案的位置可能需要更新。

---

## PR 5: Shared Components Implementation

### Bugs covered

- B06 page loading/error states inconsistent

### Scope

- 实现 `PageSection`、`FormSection`、`DataToolbar`、`DataTableShell` 等项目级共享组件。
- 明确 page-level loading/error/empty 与 local-control loading/error 的边界。
- 补足共享组件测试。
- 不迁移大量页面，只让新组件可用并为 PR 6 做准备。

### Out of scope

- 不批量替换页面 markup。
- 不改变页面数据流。
- 不改变 API 调用。
- 不重写表单库或表格库。

### Files likely touched

- `apps/web/src/components/shared/PageSection.tsx`（新建）
- `apps/web/src/components/shared/FormSection.tsx`（新建）
- `apps/web/src/components/shared/DataToolbar.tsx`（新建）
- `apps/web/src/components/shared/DataTableShell.tsx`（新建）
- `apps/web/src/components/shared/*.test.tsx`

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

### Expected success signal

- 新共享组件使用 semantic tokens 和 `cn()`。
- 新共享组件不依赖 pages。
- 现有页面行为不变。

### Known risks

- 抽象过早。组件 API 必须保持窄，只覆盖已在页面中重复出现的结构。

---

## PR 6: One Admin List Page Migration

### Bugs covered

- B06 page loading/error states inconsistent（one-page proof）
- B05 status grammar follow-up（如选用考试列表）

### Scope

- 只迁移一个 admin list page，推荐 `apps/web/src/pages/admin/ExamPage.tsx`。
- 使用 PR 4 的 `StatusBadge` 和 PR 5 的 list-page template components。
- 保持原有 API 调用、筛选、删除确认和路由。
- 记录迁移前后测试覆盖。

### Out of scope

- 不迁移所有 list page。
- 不改变考试状态机或删除语义。
- 不调整视觉风格。

### Files likely touched

- `apps/web/src/pages/admin/ExamPage.tsx`
- `apps/web/src/pages/admin/ExamPage.test.tsx`
- shared component tests as needed

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

### Expected success signal

- `ExamPage` 使用统一 list template 和状态组件。
- loading/error/empty 行为保持测试覆盖。
- 其他页面未被顺手迁移。

### Known risks

- 一页迁移可能暴露 shared component API 不足；优先修共享组件，不扩大页面范围。

---

## PR 7: One Admin Detail / Settings Page Migration

### Scope

- 只迁移一个 admin detail/settings page，推荐 `SettingsPage` 或 `ExamDetailPage` 中较小范围。
- 验证 form/detail template 是否足够。
- 保持业务调用和权限语义不变。

### Out of scope

- 不实现 Phase2 right-side proctor/action panel。
- 不迁移所有 detail pages。
- 不引入新业务操作。

### Files likely touched

- `apps/web/src/pages/admin/SettingsPage.tsx` 或 `apps/web/src/pages/admin/ExamDetailPage.tsx`
- 对应测试
- shared component tests as needed

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

### Expected success signal

- 一个 detail/settings page 遵守页面模板。
- 无 Phase2 action UI。

### Known risks

- `ExamDetailPage` 较复杂，若风险过高应选择 `SettingsPage`。

---

## PR 8: Exam Runtime Shell Migration

### Bugs covered

- B07 admin runtime layout boundary unclear

### Scope

- 只整理 `/exam/*` runtime shell：Exam topbar、BrandMark、内容容器、答题页边界。
- 确保 `ExamLayout` 不引入 `AppSidebar`。
- 保留 Answer Save Protocol、server timer、heartbeat 和现有页面数据流。

### Out of scope

- 不实现 real ExamRoom management。
- 不实现 IP range UI。
- 不实现 proctor WebSocket dashboard。
- 不实现 candidate live cards。
- 不实现 force submit / extend time / misconduct actions。
- 不实现 timed_sync / deadline / untimed workflows。

### Files likely touched

- `apps/web/src/components/layout/ExamLayout.tsx`
- `apps/web/src/pages/exam/ExamListPage.tsx`
- `apps/web/src/pages/exam/StartExamPage.tsx`
- `apps/web/src/pages/exam/TakeExamPage.tsx`
- `apps/web/src/pages/exam/ResultPage.tsx`
- focused tests

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

### Expected success signal

- `/exam/*` 使用独立 ExamShell。
- 答题页面保存状态和 timer 行为未改变。
- 没有 Admin Sidebar 泄漏到考试运行时。

### Known risks

- `TakeExamPage` 是高风险考试链路页面；只做 shell 边界整理，不碰保存协议。

---

## PR 9: UI Consistency Pass

### Scope

- 检查剩余页面是否违反 token、status、icon、loading/error/empty、shell boundary 规则。
- 修小范围一致性问题。
- 更新审计记录中已完成 / 延后项。

### Out of scope

- 不做视觉 beautification。
- 不批量重写页面。
- 不实现 Phase2。

### Files likely touched

- Small focused frontend files only, based on residual audit.
- `docs/ui/07-ui-bug-inventory.md`
- `docs/ui/08-migration-plan.md`

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
pnpm lint:copy
```

### Expected success signal

- B01-B08 均关闭或有明确 defer 说明。
- 没有新增部署场景硬编码文案。
- Phase2 readiness 文档仍为 documentation-only。

### Known risks

- 一致性 pass 容易扩大范围；每个改动必须能追溯到 B01-B08 或 UI docs invariant。

---

## Phase2 Features Explicitly Forbidden During Phase1.4

- Real ExamRoom management
- IP range enforcement UI
- Proctor WebSocket dashboard
- Candidate live status cards
- Force-submit / extend-time / misconduct actions
- Random paper builder
- `timed_sync` / `deadline` / `untimed` workflows
- Pass Gate API UI
- Service token / API key management
- PDF export workflow
- Electron lockdown UI
- AI grading UI
- Adaptive degradation UI

---

## PR Completion Status

> 以下记录各 PR 的完成状态。最后更新：Phase1.4 UI Foundation Reset 完成后。

| PR | Scope | Status | Key Evidence |
|----|-------|--------|--------------|
| PR 1 | Audit Only | ✅ Done | 13 篇 `docs/ui/` 文档齐全 |
| PR 2 | Route Refresh / Title / ErrorBoundary | ✅ Done | `pageMeta.ts`, `AppTitle`, `ErrorBoundary` |
| PR 3 | Sidebar / BrandMark | ✅ Done | `BrandMark.tsx`, `BrandHeader` 独立 |
| PR 4 | Design Tokens / Status Grammar | ✅ Done | `statusMeta.ts`, `StatusBadge.tsx` |
| PR 5 | Shared Components | ✅ Done | `PageSection`, `FormSection`, `DataToolbar`, `DataTableShell` |
| PR 6 | One Admin List Page | ✅ Done | `ExamPage.tsx` 迁移 |
| PR 7 | One Admin Detail Page | ✅ Done | `SettingsPage.tsx` + `ExamDetailPage.tsx` 迁移 |
| PR 8 | Exam Runtime Shell | ✅ Done | `ExamLayout` 独立 shell |
| PR 9 | UI Consistency Pass | ✅ Done | B01-B08 全部修复，`constants.ts` 死代码清理 |
