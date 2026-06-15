# UI Bug Inventory

> 本文档记录 Phase1.4 UI Foundation Reset 的当前前端审计结果。每条包含症状、涉及文件、可能根因、最小修复方向、风险、推荐 PR 和范围外说明。

---

## Audit Baseline

### Repository Evidence

- `apps/web/src/globals.css` 不存在；当前全局样式入口是 `apps/web/src/index.css`。
- `apps/web/src/main.tsx` 使用 React `createRoot` + `StrictMode` 渲染 `App`。
- `apps/web/src/App.tsx` 使用 `BrowserRouter`、嵌套路由、`BrandProvider loadRemote`、`AuthProvider restoreSession` 和顶层 `ErrorBoundary`。
- `apps/web/index.html` 的静态 `<title>` 仍是 `加载中`，代码中没有发现 `document.title`、Helmet 或等价标题同步逻辑。
- `apps/api/src/server.ts` 在 `public/` 存在时注册 `@fastify/static`，并用 not-found handler 返回 `index.html`。
- `rg` 未在 `apps/web/src` 生产代码中发现 `bg-green-*`、`text-red-*`、`border-blue-*` 等 raw palette 状态色，但状态 label / variant / icon 仍分散。

### Context7 / Official Docs Findings

- React 19：`createRoot` + `StrictMode` 是有效入口形态；React 19 可在 `createRoot` 上配置 `onUncaughtError` / `onCaughtError` 做诊断，但用户可见兜底仍需要 Error Boundary。
- React Router 7：当前 `BrowserRouter` + `Routes` + layout route + `Outlet` 模式符合 library-mode SPA 用法；直接刷新还依赖服务端或开发服务器把未知路径回退到 SPA entry。
- Tailwind CSS v4：`@import "tailwindcss"` 与 CSS-first `@theme` token 是 v4 推荐形态；状态色应通过语义 token 或集中组件消费。
- Vite：`index.html` 是 Vite 应用入口，dev server 能服务 SPA 入口；生产部署仍需后端/反向代理支持 history fallback。
- shadcn/ui：`components.json` 中 `tailwind.cssVariables: true` 对应 CSS variable theming，项目级业务组件不应放入 `components/ui/`。
- Radix UI：primitive 提供键盘和焦点管理基础，但项目层 icon-only button 仍必须提供可访问名称。
- lucide-react：图标是 tree-shakable React 组件，默认使用 `currentColor`，适合跟随 semantic token；不能把导航/折叠语义图标伪装为品牌标识。

---

## B01: title remains loading forever

### Symptom

浏览器标题停留在 `加载中`，页面顶部 title 对部分路由可能为空或过于宽泛。

### Files involved

- `apps/web/index.html`
- `apps/web/src/App.tsx`
- `apps/web/src/components/layout/AdminLayout.tsx`
- `apps/web/src/components/layout/BrandProvider.tsx`
- `apps/web/src/lib/routes.ts`

### Likely root cause

`apps/web/index.html` 静态 `<title>` 是 `加载中`，前端没有任何 `document.title` 同步逻辑。`AdminLayout.tsx` 的 `routeTitles` 只维护 topbar title，且与 `App.tsx` 的 route definitions 手工重复；`getTopbarTitle()` 对未匹配路径返回空字符串。动态详情页只按前缀返回通用标题，不能反映具体 `Exam.title`。

### Minimal fix direction

在 PR 2 增加小型 app title 同步机制：从 `BrandProvider` 读取产品标题作为 fallback，从集中 route metadata 读取当前页面标题，写入 `document.title`。同时让 topbar title 复用同一份 route metadata，未匹配时显示稳定 fallback，而不是空字符串。

### Risk

中。标题逻辑涉及品牌 fallback、登录页、管理端和考试端；若处理不当可能引入写死产品名或与组织配置冲突。

### Recommended PR

PR 2: Route Refresh / Title Loading / ErrorBoundary / App Bootstrap

### Out of scope

- 不改考试数据流。
- 不为了详情页 title 拉取额外业务数据。
- 不把产品标题写死成单一部署场景名称。

---

## B02: direct refresh blank page

### Symptom

用户直接刷新深层路由时可能看到空白页，或只有登录跳转/网络 toast 而缺少明确恢复状态。

### Files involved

- `apps/web/src/App.tsx`
- `apps/web/src/main.tsx`
- `apps/web/src/contexts/AuthContext.tsx`
- `apps/web/src/components/layout/BrandProvider.tsx`
- `apps/web/src/components/shared/ErrorBoundary.tsx`
- `apps/web/src/components/layout/AdminLayout.tsx`
- `apps/web/src/components/layout/ExamLayout.tsx`
- `apps/web/vite.config.ts`
- `apps/api/src/server.ts`
- `Dockerfile`

### Likely root cause

React Router route tree本身存在 catch-all 和 nested layouts，生产 Fastify 在 `public/` 存在时也会 fallback 到 `index.html`。因此更可能的根因是 bootstrap 期间 `BrandProvider loadRemote`、`AuthProvider restoreSession` 或页面首个 API 请求失败时，局部 loading / redirect / toast 没有统一兜底，导致用户误认为空白。另一个部署风险是生产镜像若没有正确复制 `apps/web/dist` 到 `/app/public`，`server.ts` 的 static fallback 不会注册。

### Minimal fix direction

在 PR 2 明确 App bootstrap 状态：保留顶层 `ErrorBoundary`，为 auth restore 和 branding fallback 写测试，确认 `/admin/*`、`/exam/*` 直接进入时始终显示 skeleton、登录页、错误页或实际内容之一。生产 smoke test 应验证 `public/index.html` 存在和 deep-link fallback。

### Risk

中。若把 401、网络失败和未登录状态混为一谈，可能改变认证体验；若改服务端 fallback，需要避免影响 `/api/*` 404。

### Recommended PR

PR 2: Route Refresh / Title Loading / ErrorBoundary / App Bootstrap

### Out of scope

- 不改变认证协议。
- 不改变 API 路由。
- 不引入 SSR 或在线依赖。

---

## B03: sidebar collapse uses logo slot

### Symptom

sidebar 折叠后，collapse button 与品牌区域挤在同一个 56px header 区域，用户难以区分品牌标识和展开控制。

### Files involved

- `apps/web/src/components/layout/AppSidebar.tsx`
- `apps/web/src/components/layout/BrandHeader.tsx`
- `apps/web/src/components/layout/layout.test.tsx`

### Likely root cause

`AppSidebar.tsx` 在同一 flex row 中渲染 `<BrandHeader compact={collapsed} />` 和 collapse button。expanded 状态用 `ml-auto` 把按钮推到右侧，collapsed 状态按钮紧跟 BrandHeader，二者共享极窄宽度。`BrandHeader` 又使用 `PanelLeft`，进一步混淆品牌与侧栏控制语义。

### Minimal fix direction

在 PR 3 拆出明确的 `BrandMark` 和 `SidebarCollapseButton` 区域。collapsed 状态仍渲染品牌图标，collapse button 独立可见，保留现有宽度和导航行为。添加布局测试覆盖 expanded/collapsed 下两个元素都存在且有独立 accessible label。

### Risk

低到中。主要风险是 56px collapsed sidebar 宽度不足，需要在不改变导航语义的前提下微调 header 内部尺寸。

### Recommended PR

PR 3: Sidebar / BrandMark / Navigation Collapse Rebuild

### Out of scope

- 不重做整个 sidebar 视觉。
- 不改变角色菜单项。
- 不迁移页面。

---

## B04: no stable BrandMark fallback

### Symptom

当前有文字 fallback，但没有稳定的独立 BrandMark 图形 fallback；远程品牌加载失败时只能显示 `PanelLeft` 图标 + fallback 文案。

### Files involved

- `apps/web/src/components/layout/BrandProvider.tsx`
- `apps/web/src/components/layout/BrandHeader.tsx`
- `apps/web/src/pages/LoginPage.tsx`
- `apps/web/src/components/settings/PlatformSettingsForm.tsx`

### Likely root cause

`BrandProvider.tsx` 已有 `fallbackBranding`，但 `BrandHeader.tsx` 没有真正的 BrandMark 组件或 logo asset/error fallback。`PanelLeft` 是 layout/collapse 语义图标，不是品牌标识。当前 `BrandingView` 也未在前端表现 logo URL / fallback mark 的边界。

### Minimal fix direction

PR 3 创建稳定 `BrandMark`：纯本地、离线可用、语义中立、使用 token 颜色；远程品牌失败时使用该 mark 和 `BrandProvider` fallback 文案。若未来支持 logo URL，先定义失败回退行为，不在本 PR 引入上传或远程依赖。

### Risk

中。品牌 fallback 容易误写为特定学校/机构语义；图标替换也可能影响登录页和考试端 header。

### Recommended PR

PR 3: Sidebar / BrandMark / Navigation Collapse Rebuild

### Out of scope

- 不实现 logo 上传。
- 不引入 CDN 或外部图片。
- 不实现多主题品牌系统。

---

## B05: scattered CSS / Tailwind status colors

### Symptom

状态显示仍分散在多个组件和页面中，虽然未发现明显 raw palette 状态色。

### Files involved

- `apps/web/src/lib/constants.ts`
- `apps/web/src/components/shared/ConnectionIndicator.tsx`
- `apps/web/src/pages/admin/DashboardPage.tsx`
- `apps/web/src/pages/admin/ExamPage.tsx`
- `apps/web/src/pages/admin/ResultsOverviewPage.tsx`
- `apps/web/src/pages/admin/ExamDetailPage.tsx`
- `apps/web/src/pages/admin/ScoreListPage.tsx`
- `apps/web/src/pages/admin/AttemptDetailPage.tsx`
- `apps/web/src/pages/exam/ExamListPage.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/index.css`

### Likely root cause

`STATUS_LABELS` / `STATUS_VARIANT` 只覆盖 ExamStatus，且用 shadcn `Badge` variant 表达 tone。Dashboard 又定义了本地 `StatusBadge`。Attempt、score、connection 等状态直接在页面或组件内决定 label / variant / className。当前没有覆盖 ExamEnrollment、ExamAttempt、Answer Save、connection 等完整状态语法的 `statusMeta`。

### Minimal fix direction

PR 4 新建 `apps/web/src/lib/statusMeta.ts` 和 `components/shared/StatusBadge.tsx`，覆盖 UI constitution 中定义的状态。先替换高频考试状态和连接状态，保留非状态类 badge（例如题型、标签）继续使用 shadcn `Badge`。

### Risk

中。一次性替换全部页面会扩大回归面；应先以状态语法为边界，不迁移无关标签/题型 badge。

### Recommended PR

PR 4: Design Tokens / CSS Cleanup / Status Grammar Implementation

### Out of scope

- 不改变状态机。
- 不改变 API 返回 status。
- 不把所有 Badge 都强制改成 StatusBadge。

---

## B06: page loading/error states inconsistent

### Symptom

多数页面已使用 `LoadingState` / `ErrorState` / `EmptyState`，但仍存在局部 skeleton、按钮内 loading 文案、toast-only 错误和页面内自定义状态混用。

### Files involved

- `apps/web/src/components/shared/LoadingState.tsx`
- `apps/web/src/components/shared/ErrorState.tsx`
- `apps/web/src/components/shared/EmptyState.tsx`
- `apps/web/src/components/layout/AdminLayout.tsx`
- `apps/web/src/components/layout/ExamLayout.tsx`
- `apps/web/src/pages/admin/DashboardPage.tsx`
- `apps/web/src/pages/admin/SystemHealthPage.tsx`
- `apps/web/src/pages/admin/QuestionPage.tsx`
- `apps/web/src/pages/admin/ExamDetailPage.tsx`
- `apps/web/src/pages/LoginPage.tsx`
- `apps/web/src/components/exam/EnrollmentPicker.tsx`
- `apps/web/src/components/settings/PlatformSettingsForm.tsx`

### Likely root cause

共享状态组件存在，但页面模板尚未统一。部分页面需要局部 loading（例如分页加载更多、保存按钮），部分页面需要 full-page loading/error/empty；当前没有明确区分页面级状态和局部控件状态，也没有 `PageSection` / `DataTableShell` 等模板组件承接重复结构。

### Minimal fix direction

PR 5 实现并约束共享页面模板组件，明确 page-level 与 local-control loading 的边界。PR 6 起只迁移一个 admin list page 验证模板，不在 PR 5 或 PR 6 批量迁移所有页面。

### Risk

中。把局部 loading 全部替换为页面级 `LoadingState` 会破坏交互；必须按页面模板分层处理。

### Recommended PR

PR 5: Shared Components Implementation；PR 6: One Admin List Page Migration

### Out of scope

- 不重写页面数据流。
- 不批量迁移所有页面。
- 不改变表单提交和保存协议。

---

## B07: admin runtime layout boundary unclear

### Symptom

当前代码已经有 `AdminLayout` 和 `ExamLayout` 两套 layout，但命名和文档仍需明确 Admin Console 与 Exam Runtime 的责任边界，防止后续页面误用 Admin Sidebar。

### Files involved

- `apps/web/src/App.tsx`
- `apps/web/src/components/layout/AdminLayout.tsx`
- `apps/web/src/components/layout/ExamLayout.tsx`
- `apps/web/src/components/layout/AppSidebar.tsx`
- `apps/web/src/pages/exam/ExamListPage.tsx`
- `apps/web/src/pages/exam/StartExamPage.tsx`
- `apps/web/src/pages/exam/TakeExamPage.tsx`
- `apps/web/src/pages/exam/ResultPage.tsx`

### Likely root cause

`App.tsx` 正确地将 `/admin` 挂在 `AdminLayout`，将 `/exam` 挂在 `ExamLayout`。风险不是当前 route tree 混用，而是后续 Phase2/考试运行时页面可能复用管理端组件或把操作面板塞入 `AdminLayout`。另外 `ExamLayout` 目前复用 `BrandHeader`，而 `BrandHeader` 的 BrandMark 问题会同时影响两套 shell。

### Minimal fix direction

PR 8 只迁移考试运行时 shell 的基础结构，保证 `/exam/*` 不引入 `AppSidebar`。PR 3 先修复共享 BrandMark，避免两套 shell 继续继承错误品牌语义。

### Risk

低。当前 route boundary 基本正确；主要风险来自后续功能扩展。

### Recommended PR

PR 3 修复共享 BrandMark；PR 8 执行 Exam Runtime shell migration

### Out of scope

- 不实现监考面板。
- 不实现 ExamRoom、实时考生卡片或强制交卷操作。
- 不实现 Phase2 考试灵活性工作流。

---

## B08: SVG/icon usage inconsistent

### Symptom

图标主要来自 `lucide-react`，整体依赖一致，但品牌图标、状态图标、按钮图标语义没有集中规则；`BrandHeader` 使用 `PanelLeft` 作为 logo 是最明显问题。

### Files involved

- `apps/web/src/components/layout/BrandHeader.tsx`
- `apps/web/src/components/layout/AppSidebar.tsx`
- `apps/web/src/components/shared/LoadingState.tsx`
- `apps/web/src/components/shared/ErrorState.tsx`
- `apps/web/src/components/shared/ErrorBoundary.tsx`
- `apps/web/src/components/shared/FileUpload.tsx`
- `apps/web/src/components/exam/SaveIndicator.tsx`
- `apps/web/src/pages/admin/*`
- `apps/web/src/pages/exam/*`
- `apps/web/src/components/ui/*`

### Likely root cause

项目已经采用 lucide，但没有把 BrandMark、status icon、action icon、shadcn primitive icon 的边界写成可执行组件约定。部分按钮使用 `data-icon`，部分 icon-only button 依赖 `aria-label`，状态图标散落在页面/组件中。

### Minimal fix direction

PR 3 先替换 `PanelLeft` 品牌误用。PR 4 随 `statusMeta` 集中状态图标。PR 9 做最后一致性 pass，只处理图标语义、大小、`aria-hidden` / `aria-label` 和 `currentColor` token 使用，不引入第二套 icon library。

### Risk

低到中。图标替换通常风险低，但状态图标集中化会影响测试快照和可访问名称。

### Recommended PR

PR 3、PR 4、PR 9

### Out of scope

- 不新增图标库。
- 不手绘大量 SVG。
- 不把 shadcn/ui generated primitives 改成业务组件。

---

## Completion Status

> 以下记录各 bug 的修复状态。最后更新：Phase1.4 UI Foundation Reset PR 1-9 完成后。

| Bug | Status | PR | Evidence |
|-----|--------|----|----------|
| B01 title remains loading forever | ✅ Fixed | PR 2 | `pageMeta.ts` 集中路由标题，`AppTitle` 同步 `document.title`，`index.html` 标题已改为"考试平台" |
| B02 direct refresh blank page | ✅ Fixed | PR 2 | `ErrorBoundary` 包裹顶层，`BrandProvider`/`AuthProvider` fallback 完备 |
| B03 sidebar collapse uses logo slot | ✅ Fixed | PR 3 | `BrandMark` 独立组件，`AppSidebar` 中 collapse button 与 brand 分离 |
| B04 no stable BrandMark fallback | ✅ Fixed | PR 3 | `BrandMark` 使用 `ClipboardCheck` 图标 + `bg-primary/10` 语义色，离线可用 |
| B05 scattered CSS/status colors | ✅ Fixed | PR 4, PR 9 | `statusMeta.ts` 集中定义，`StatusBadge` 统一组件，无 raw palette 散落 |
| B06 page loading/error states inconsistent | ✅ Fixed | PR 5, PR 6 | `LoadingState`/`ErrorState`/`EmptyState`/`PageSection`/`FormSection`/`DataToolbar`/`DataTableShell` 已创建并应用于主要页面 |
| B07 admin runtime layout boundary unclear | ✅ Fixed | PR 8 | `ExamLayout` 不使用 `AppSidebar`，独立 shell |
| B08 SVG/icon usage inconsistent | ✅ Fixed | PR 3, PR 4, PR 9 | `PanelLeft` 品牌误用已移除，`BrandMark` 独立，状态图标集中到 `statusMeta` |
