# Migration Plan

> 本文档定义 Phase1.4 UI Foundation Reset 的 PR 拆分计划。每个 PR 有明确的范围和验证命令。

---

## PR 1: Documentation Convergence Only

### Scope

- 创建 `docs/ui/` 目录和所有文档
- 更新 `AGENTS.md`
- 不修改任何产品代码

### Out of scope

- 不修改 React 组件
- 不修改 CSS
- 不修改 Tailwind 配置
- 不修改 API
- 不修改数据库

### Files likely touched

- `docs/ui/00-ui-constitution.md`
- `docs/ui/01-design-tokens.md`
- `docs/ui/02-layout-system.md`
- `docs/ui/03-component-boundaries.md`
- `docs/ui/04-state-grammar.md`
- `docs/ui/05-page-templates.md`
- `docs/ui/06-accessibility-rules.md`
- `docs/ui/07-ui-bug-inventory.md`
- `docs/ui/08-migration-plan.md`
- `docs/ui/09-phase2-readiness.md`
- `AGENTS.md`

### Verification commands

```bash
ls -la docs/ui/
cat docs/ui/00-ui-constitution.md | head -20
```

### Known risks

- 无

### Expected success signal

- 所有文档文件存在
- 文档内容完整
- AGENTS.md 更新完成

---

## PR 2: Route Refresh / Title Loading / ErrorBoundary / App Bootstrap

### Scope

- 修复 title 一直显示"加载中"的问题
- 修复页面直接刷新后出现空白页的问题
- 确保 ErrorBoundary 正确包裹 App
- 确保 BrandProvider 有稳定的 fallback

### Out of scope

- 不改变路由结构
- 不改变认证流程
- 不改变品牌加载逻辑
- 不改变 UI 样式

### Files likely touched

- `apps/web/src/App.tsx`
- `apps/web/src/components/layout/AdminLayout.tsx`
- `apps/web/src/components/layout/BrandProvider.tsx`
- `apps/web/src/components/shared/ErrorBoundary.tsx`

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

### Known risks

- 可能影响现有路由行为
- 可能影响认证流程

### Expected success signal

- title 不再一直显示"加载中"
- 页面直接刷新后不再出现空白页
- ErrorBoundary 正确捕获错误
- BrandProvider fallback 正常工作

---

## PR 3: Sidebar / BrandMark / Navigation Collapse Rebuild

### Scope

- 修复 sidebar collapse uses logo slot 的问题
- 创建稳定的 BrandMark fallback
- 分离 BrandMark 和 SidebarCollapseButton

### Out of scope

- 不改变 sidebar 的宽度
- 不改变 sidebar 的折叠行为
- 不改变导航菜单的样式

### Files likely touched

- `apps/web/src/components/layout/AppSidebar.tsx`
- `apps/web/src/components/layout/BrandHeader.tsx`
- `apps/web/src/components/layout/BrandProvider.tsx`

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

### Known risks

- 可能影响 sidebar 的视觉效果
- 可能影响导航体验

### Expected success signal

- BrandMark 和 SidebarCollapseButton 分离
- collapsed sidebar 显示 BrandMark，不显示 collapse icon 伪装成 logo
- BrandMark 有稳定的 fallback

---

## PR 4: Design Tokens / CSS Cleanup / Status Grammar Implementation

### Scope

- 创建 `statusMeta` 集中定义状态颜色
- 创建 `StatusBadge` 组件消费统一 metadata
- 替换所有页面中的原始颜色为 StatusBadge

### Out of scope

- 不改变颜色值
- 不改变颜色语义
- 不改变状态定义

### Files likely touched

- `apps/web/src/lib/statusMeta.ts`（新建）
- `apps/web/src/components/shared/StatusBadge.tsx`（新建）
- 各个页面组件

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

### Known risks

- 可能影响页面的视觉效果
- 可能引入新的 bug

### Expected success signal

- `bg-green-500`、`text-red-600`、`border-blue-400` 从 components/ 中消除
- 所有状态使用 StatusBadge 组件
- 状态颜色一致

---

## PR 5: Shared Components Implementation

### Scope

- 实现 PageSection、FormSection、DataToolbar、DataTableShell 等共享组件
- 确保所有页面使用统一的 loading / error / empty 组件

### Out of scope

- 不改变页面结构
- 不改变数据流
- 不改变 API 调用

### Files likely touched

- `apps/web/src/components/shared/PageSection.tsx`（新建）
- `apps/web/src/components/shared/FormSection.tsx`（新建）
- `apps/web/src/components/shared/DataToolbar.tsx`（新建）
- `apps/web/src/components/shared/DataTableShell.tsx`（新建）

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

### Known risks

- 可能引入新的 bug
- 可能影响现有组件

### Expected success signal

- 所有共享组件可用
- 所有页面使用统一的 loading / error / empty 组件
- 组件风格一致

---

## PR 6: One Admin List Page Migration

### Scope

- 迁移一个 admin list page（如 ExamPage）到新模板
- 验证新模板的可用性

### Out of scope

- 不迁移所有 list page
- 不改变页面逻辑
- 不改变 API 调用

### Files likely touched

- `apps/web/src/pages/admin/ExamPage.tsx`

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

### Known risks

- 可能影响页面的视觉效果
- 可能引入新的 bug

### Expected success signal

- ExamPage 使用新模板
- Loading / Error / Empty 三态正常
- 页面风格一致

---

## PR 7: One Admin Detail/Settings Page Migration

### Scope

- 迁移一个 admin detail page（如 ExamDetailPage）到新模板
- 验证新模板的可用性

### Out of scope

- 不迁移所有 detail page
- 不改变页面逻辑
- 不改变 API 调用

### Files likely touched

- `apps/web/src/pages/admin/ExamDetailPage.tsx`

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

### Known risks

- 可能影响页面的视觉效果
- 可能引入新的 bug

### Expected success signal

- ExamDetailPage 使用新模板
- Loading / Error / Empty 三态正常
- 页面风格一致

---

## PR 8: Exam Runtime Shell Migration

### Scope

- 迁移 Exam Runtime Shell 到新模板
- 确保 Exam Runtime 不使用 Admin Sidebar

### Out of scope

- 不改变考试逻辑
- 不改变答题流程
- 不改变 API 调用

### Files likely touched

- `apps/web/src/components/layout/ExamLayout.tsx`
- `apps/web/src/pages/exam/TakeExamPage.tsx`

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

### Known risks

- 可能影响考试体验
- 可能引入新的 bug

### Expected success signal

- Exam Runtime 使用独立的 ExamShell
- Exam Runtime 不使用 Admin Sidebar
- 页面风格一致

---

## PR 9: UI Consistency Pass

### Scope

- 全站 UI 一致性检查
- 修复所有 UI bug inventory 中的问题
- 确保所有页面符合新模板

### Out of scope

- 不改变页面逻辑
- 不改变 API 调用
- 不改变数据流

### Files likely touched

- 所有页面组件
- 所有共享组件

### Verification commands

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
pnpm --filter web coverage
```

### Known risks

- 可能引入新的 bug
- 可能影响现有功能

### Expected success signal

- 所有 UI bug inventory 中的问题已修复
- 所有页面符合新模板
- 页面风格一致
- 覆盖率达标
