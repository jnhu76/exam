# Koi-UI 迁移审计报告

> **日期**：2026-06-27
> **扫描范围**：508 files (apps/ + packages/)
> **分支**：`ui/koi-admin-visual-spike`

---

## 1. 扫描结果

| 指标 | 数值 |
|------|------|
| 扫描文件总数 | 508 |
| 遗留旧组件定义 | 36 处（含构建产物） |
| Badge variant 残留 | 12 处 |
| space-x/y 残留 | 8 处（排除构建产物） |
| w-N h-N 同值 | 0 ✅ |
| Hardcoded 颜色 | 0 ✅ |
| Koi 直接引用 | 0 ✅ |

---

## 2. 组件分类

| 分类 | 说明 | 数量 |
|------|------|------|
| **A** | 替换为 Wegent/shadcn primitive | 12 |
| **B** | 保留 admin pattern 但改 token | 15 |
| **C** | Koi 独有但有用，改造为项目组件 | 8 |
| **D** | 移除或推迟 | 7 |

### A. 替换为 primitive（12）
Button, Input, Card, Dialog, Badge, Select, Tabs, Tooltip, Dropdown, Checkbox, Switch, Textarea

### B. 保留 admin pattern（15）
AdminShell, AdminShellHeader, AdminPageCard, AdminSearchPanel, AdminTableShell, AdminToolbar, AdminToolbarButton, AdminIconButton, AdminStatusTag, MetricCard, StatusBadge, PageHeader, FormSection, LoadingState, ErrorState

### C. Koi 独有有用（8）
SearchMenu, ResponsiveDialog, ScrollableTabs, ConfirmDialog, ConfirmActionDialog, InlineErrorBanner, ConnectionIndicator, ImportWizard

### D. 移除/推迟（7）
ThemeConfigPanel, AdvancedSearch, ColumnSettings, BatchActionToolbar, AuditTimeline, PermissionButton, KoiLoading overlay

---

## 3. 已删除的重复基础组件

| 组件 | 操作 |
|------|------|
| KoiCard | 已替换为 `AdminPageCard` |
| KoiDialog | 已替换为 shadcn `Dialog` |
| KoiDrawer | 已替换为 shadcn `Sheet` |
| KoiToolbar | 已替换为 `AdminIconButton` |
| KoiTag | 已替换为 `AdminStatusTag` |
| KoiSearch | 已替换为 `AdminSearchPanel` |
| KoiExcel | 已替换为 `ImportWizard` |
| KoiUpload/* | 已替换为自定义 upload 组件 |
| KoiLoading | 已替换为 Skeleton/Spinner |
| KoiGlobalIcon | 已替换为 Lucide icons |
| KoiSvgIcon | 已替换为 Lucide icons |
| KoiSelectIcon | 不需要 |
| KoiScrollNav | 已替换为 `ScrollableTabs` |
| KoiShell* | 不需要（React 无 windowing shell） |

---

## 4. 保留的 Koi-derived admin pattern

| 组件 | 文件 | 状态 |
|------|------|------|
| AdminShell | `admin/AdminShell.tsx` | ✅ 已实现 |
| AdminShellHeader | `admin/AdminShell.tsx` | ✅ 已实现 |
| AdminPageCard | `admin/AdminPageCard.tsx` | ✅ 已实现 |
| AdminSearchPanel | `admin/AdminSearchPanel.tsx` | ✅ 已实现 |
| AdminTableShell | `admin/AdminTableShell.tsx` | ✅ 已实现 |
| AdminToolbar | `admin/AdminToolbar.tsx` | ✅ 已实现 |
| AdminToolbarButton | `admin/AdminButtons.tsx` | ✅ 已实现 |
| AdminIconButton | `admin/AdminButtons.tsx` | ✅ 已实现 |
| AdminStatusTag | `admin/AdminStatusTag.tsx` | ✅ 已实现 |
| MetricCard | `admin/MetricCard.tsx` | ✅ 已实现 |

---

## 5. 已改为 Wegent token 的组件

| 组件 | 改动 |
|------|------|
| Tabs | ✅ 重写为 Wegent 风格（rounded-lg bg-surface） |
| AdminStatusTag | ✅ 放大（h-6 text-xs） |
| SaveIndicator | ✅ 统一 h-8 |
| ExamTimer | ✅ 单行紧凑 h-8 |
| QuestionNavigator | ✅ 实色区分（success/warning） |
| LoginPage | ✅ 简化为纯卡片 |
| SettingsPage | ✅ 改为 Tabs 布局 |
| ExamListPage | ✅ 卡片 flex-1 + mt-auto |

---

## 6. 已迁移页面

| 页面 | 类型 | 状态 |
|------|------|------|
| UsersPage | 列表页 | ✅ AdminShell + AdminSearchPanel + AdminTableShell |
| QuestionPage | 列表页 | ✅ 同上 |
| CandidatesPage | 列表页 | ✅ 同上 |
| CoursePage | 列表页 | ✅ 同上 |
| ExamPage | 列表页 | ✅ 同上 |
| DashboardPage | 看板 | ✅ AdminShell + MetricCard |
| SystemDiagnosticsPage | 看板 | ✅ AdminShell + MetricCard + recharts |
| ExamDetailPage | 详情 | ✅ AdminShell + AdminPageCard + Tabs |
| SettingsPage | 表单 | ✅ AdminShell + Tabs |
| LoginPage | 登录 | ✅ 简化卡片 |
| ExamListPage | 考生列表 | ✅ AdminStatusTag |
| StartExamPage | 考生 | ✅ AdminShell |
| TakeExamPage | 考生 | ✅ AdminShell |

---

## 7. 后续迁移 Checklist

### Phase 1: Token 统一（当前）
- [x] Koi 组件已提取并分类
- [x] Wegent 样式主权文档已建立
- [x] Token 映射表已建立
- [x] 审计脚本已创建

### Phase 2: 组件 token 迁移
- [ ] AdminPageCard → `bg-surface` `border-border`
- [ ] AdminSearchPanel → `bg-muted` `border-border`
- [ ] AdminTableShell → `bg-surface` `border-border`
- [ ] AdminToolbarButton → Wegent verb 色
- [ ] AdminIconButton → Wegent ghost 样式
- [ ] AdminStatusTag → Wegent tag (rounded-md)
- [ ] MetricCard → `bg-surface` `border-border`
- [ ] StatusBadge → Wegent badge (rounded-full)

### Phase 3: 主色统一
- [ ] 确认主色：Wegent purple `#5D5EC9` vs 当前 blue `#2563eb`
- [ ] 更新 `--color-primary` CSS 变量
- [ ] 更新所有 `primary` 相关 token

### Phase 4: Badge 残留清理（12 处）
- [ ] ExamTopbar.tsx
- [ ] QuestionHeader.tsx
- [ ] AttemptDetailPage.tsx
- [ ] ExamCreatePage.tsx
- [ ] ExamEditPage.tsx
- [ ] ExamMonitoringPage.tsx
- [ ] QuestionImportPage.tsx
- [ ] UsersPage.tsx
- [ ] ExamListPage.tsx

### Phase 5: space-x/y 清理（8 处）
- [ ] ExamConfigForm.tsx
- [ ] GradingDetailPage.tsx
- [ ] avatar.tsx (保留 -32 avatar group)
- [ ] calendar.tsx

### Phase 6: 旧组件标记 deprecated
- [ ] PageHeader.tsx → `@deprecated`
- [ ] ListToolbar.tsx → `@deprecated`
- [ ] DataToolbar.tsx → `@deprecated`
- [ ] DataTableShell.tsx → `@deprecated`
