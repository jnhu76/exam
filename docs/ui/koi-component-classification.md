# Koi 组件分类审计

> **基于** `scripts/audit-koi-ui-usage.mjs` 扫描结果 + Wegent 视觉规范分析
> **最后更新**：2026-06-27

---

## 分类总览

| 分类 | 说明 | 数量 |
|------|------|------|
| A | 替换为 Wegent/shadcn primitive | 12 |
| B | 保留 admin pattern 但改 token | 14 |
| C | Koi 独有但有用，改造为项目组件 | 7 |
| D | 移除或推迟 | 6 |

---

## A. 替换为 Wegent/shadcn primitive

这些基础组件不应保留 Koi 版本，直接使用 shadcn/ui 或 Wegent 风格组件：

| 组件 | 当前位置 | Wegent 等价 | 操作 |
|------|----------|-------------|------|
| Button | `ui/button.tsx` | `ui/button.tsx` (Wegent variant: primary/secondary/ghost/destructive) | 保留 shadcn，调整 variant |
| Input | `ui/input.tsx` | `ui/input.tsx` (h-10 rounded-lg border-border) | 保留 shadcn，调整样式 |
| Card | `ui/card.tsx` | `ui/card.tsx` (variant: default/elevated/ghost) | 保留 shadcn，加 variant |
| Dialog | `ui/dialog.tsx` | `ui/dialog.tsx` (rounded-lg border border-border bg-base) | 保留 shadcn |
| Badge | `ui/badge.tsx` | `ui/badge.tsx` (rounded-full variant: default/success/error/warning/info) | 保留 shadcn |
| Select | `ui/select.tsx` | `ui/select.tsx` (h-10 rounded-lg) | 保留 shadcn |
| Tabs | `ui/tabs.tsx` | `ui/tabs.tsx` (h-9 rounded-lg bg-surface) | 重写为 Wegent 风格 |
| Tooltip | `ui/tooltip.tsx` | `ui/tooltip.tsx` (rounded-md bg-tooltip) | 保留 shadcn |
| Dropdown | `ui/dropdown-menu.tsx` | `ui/dropdown-menu.tsx` (rounded-lg bg-surface) | 保留 shadcn |
| Checkbox | `ui/checkbox.tsx` | `ui/checkbox.tsx` (h-4 w-4 rounded-sm) | 保留 shadcn |
| Switch | `ui/switch.tsx` | `ui/switch.tsx` (h-5 w-9 rounded-full) | 保留 shadcn |
| Textarea | `ui/textarea.tsx` | `ui/textarea.tsx` (min-h-[80px] rounded-lg) | 保留 shadcn |

---

## B. 保留 admin pattern 但改 token

这些组件保留机制，但必须改成 Wegent token 体系：

| 组件 | 当前位置 | 当前状态 | 改造目标 |
|------|----------|----------|----------|
| AdminShell | `admin/AdminShell.tsx` | ✅ 已实现 | 改用 Wegent 间距/gap |
| AdminShellHeader | `admin/AdminShell.tsx` | ✅ 已实现 | 保留，调整字号 |
| AdminPageCard | `admin/AdminPageCard.tsx` | ✅ 已实现 | 改用 `bg-surface` `border-border` |
| AdminSearchPanel | `admin/AdminSearchPanel.tsx` | ✅ 已实现 | 改用 `bg-muted` `border-border` |
| AdminTableShell | `admin/AdminTableShell.tsx` | ✅ 已实现 | 改用 `bg-surface` `border-border` |
| AdminToolbar | `admin/AdminToolbar.tsx` | ✅ 已实现 | 保留 |
| AdminToolbarButton | `admin/AdminButtons.tsx` | ✅ 已实现 | 改用 Wegent verb 色 |
| AdminIconButton | `admin/AdminButtons.tsx` | ✅ 已实现 | 改用 Wegent ghost 样式 |
| AdminStatusTag | `admin/AdminStatusTag.tsx` | ✅ 已实现 | 改用 Wegent tag 样式 (rounded-md) |
| MetricCard | `admin/MetricCard.tsx` | ✅ 已实现 | 改用 `bg-surface` `border-border` |
| StatusBadge | `shared/StatusBadge.tsx` | ✅ 已实现 | 改用 Wegent badge 样式 |
| PageHeader | `shared/PageHeader.tsx` | ⚠️ 旧组件 | 保留但标记为 legacy |
| FormSection | `shared/FormSection.tsx` | ✅ 已实现 | 保留 |
| LoadingState | `shared/LoadingState.tsx` | ✅ 已实现 | 改用 Wegent skeleton 样式 |
| ErrorState | `shared/ErrorState.tsx` | ✅ 已实现 | 保留 |

---

## C. Koi 独有但有用，改造为项目组件

这些是 Wegent 没覆盖但后台系统需要的组件：

| 组件 | 当前位置 | 说明 | 改造方案 |
|------|----------|------|----------|
| SearchMenu | `shared/SearchMenu.tsx` | 全局搜索 ⌘J | 保留，用 Wegent token |
| ResponsiveDialog | `shared/ResponsiveDialog.tsx` | 桌面 Dialog + 移动端 Drawer | 保留 |
| ScrollableTabs | `shared/ScrollableTabs.tsx` | 横向滚动标签 | 保留 |
| ConfirmDialog | `shared/ConfirmDialog.tsx` | 确认对话框 | 保留 |
| ConfirmActionDialog | `shared/ConfirmActionDialog.tsx` | 操作确认 | 保留 |
| InlineErrorBanner | `shared/InlineErrorBanner.tsx` | 内联错误 | 保留 |
| ConnectionIndicator | `shared/ConnectionIndicator.tsx` | 连接状态 | 保留 |
| ImportWizard | `shared/ImportWizard.tsx` | 导入向导 | 保留 |

---

## D. 移除或推迟

| 组件 | 位置 | 原因 |
|------|------|------|
| ThemeConfigPanel | (未实现) | Phase 3+ |
| AdvancedSearch | (未实现) | Phase 3+ |
| ColumnSettings | (未实现) | Phase 3+ |
| BatchActionToolbar | (未实现) | Phase 3+ |
| AuditTimeline | (未实现) | Phase 3+ |
| PermissionButton | (未实现) | Phase 3+ |
| KoiLoading overlay | (未使用) | 用 Skeleton/Spinner 替代 |

---

## 扫描发现的问题

### 1. 遗留旧组件定义（36 处）

主要集中在：
- `shared/PageHeader.tsx` — 定义 + 测试
- `shared/ListToolbar.tsx` — 定义 + 测试
- `shared/DataToolbar.tsx` — 定义 + 测试
- `shared/DataTableShell.tsx` — 定义 + 测试
- `apps/api/public/assets/` — 构建产物（忽略）

**操作**：保留定义文件（供测试兼容），但标记为 `@deprecated`。

### 2. Badge variant 残留（12 处）

应替换为 `AdminStatusTag` 或 Wegent `Badge`：
- `ExamTopbar.tsx` — `variant="outline"`
- `QuestionHeader.tsx` — `variant="secondary"` / `variant="outline"`
- `AttemptDetailPage.tsx` — `variant="outline"`
- `ExamCreatePage.tsx` — `variant="outline"` × 2
- `ExamEditPage.tsx` — `variant="outline"` × 2
- `ExamMonitoringPage.tsx` — `variant="secondary"`
- `QuestionImportPage.tsx` — `variant="outline"`
- `UsersPage.tsx` — `variant="outline"`
- `ExamListPage.tsx` — `variant="default"` (bestScore badge)

### 3. space-x/y 残留（8 处，排除构建产物）

- `ExamConfigForm.tsx:422` — `space-y-2`
- `GradingDetailPage.tsx` — `space-y-2` × 4, `space-y-4` × 1
- `avatar.tsx` — `-space-x-2` (avatar group)
- `calendar.tsx` — `space-y-1`

**操作**：替换为 `gap-*`。
