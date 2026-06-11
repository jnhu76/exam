# Component Boundaries

> 本文档定义项目的组件边界规则。所有 UI 实施必须遵守。

---

## 1. 四层结构

项目采用四层组件结构，每层有明确的职责边界：

| 目录 | 职责 | 依赖关系 |
|------|------|----------|
| `components/ui/` | shadcn/ui primitives | 无项目依赖 |
| `components/shared/` | 项目级可复用组件 | 可依赖 `components/ui/` |
| `components/layout/` | Shell / Sidebar / Topbar / Layout | 可依赖 `components/ui/` 和 `components/shared/` |
| `pages/` | 路由级组合 | 可依赖所有组件层 |

---

## 2. components/ui/ — shadcn/ui Primitives

### 2.1 允许内容

`components/ui/` 只能放 shadcn/ui primitives。这些组件由 `npx shadcn@latest add` 生成，**不要手动修改**。

当前组件：

| 组件 | 文件 | 用途 |
|------|------|------|
| button | `button.tsx` | 按钮 |
| card | `card.tsx` | 卡片 |
| dialog | `dialog.tsx` | 对话框 |
| input | `input.tsx` | 输入框 |
| table | `table.tsx` | 表格 |
| tabs | `tabs.tsx` | 标签页 |
| badge | `badge.tsx` | 徽章 |
| dropdown-menu | `dropdown-menu.tsx` | 下拉菜单 |
| alert-dialog | `alert-dialog.tsx` | 警告对话框 |
| alert | `alert.tsx` | 警告 |
| avatar | `avatar.tsx` | 头像 |
| checkbox | `checkbox.tsx` | 复选框 |
| form | `form.tsx` | 表单 |
| label | `label.tsx` | 标签 |
| pagination | `pagination.tsx` | 分页 |
| radio-group | `radio-group.tsx` | 单选组 |
| select | `select.tsx` | 选择器 |
| separator | `separator.tsx` | 分隔线 |
| sheet | `sheet.tsx` | 抽屉 |
| skeleton | `skeleton.tsx` | 骨架屏 |
| sonner | `sonner.tsx` | 通知 |
| switch | `switch.tsx` | 开关 |
| textarea | `textarea.tsx` | 文本域 |
| tooltip | `tooltip.tsx` | 提示 |

### 2.2 禁止内容

以下组件**不能**放在 `components/ui/`：

| 组件 | 原因 |
|------|------|
| ExamCard | 业务组件 |
| TaskStatusPanel | 业务组件 |
| QuestionEditor | 业务组件 |
| SubmissionReviewPanel | 业务组件 |
| CandidateImportTable | 业务组件 |
| ProctorDashboard | 业务组件 |
| ExamRoomCard | 业务组件 |
| StatusBadge | 项目级组件，应放 `components/shared/` |
| PageHeader | 项目级组件，应放 `components/shared/` |
| EmptyState | 项目级组件，应放 `components/shared/` |

### 2.3 使用规则

- 新增 shadcn/ui 组件使用 `npx shadcn@latest add <component-name>`
- 不要手动修改 `components/ui/` 下的文件
- 所有 shadcn/ui 组件使用项目定义的 CSS variables
- 颜色通过 `className` 传递，如 `className="bg-primary"`

---

## 3. components/shared/ — 项目级可复用组件

### 3.1 允许内容

`components/shared/` 放项目级可复用组件。这些组件**可以跨页面复用**。

当前组件：

| 组件 | 文件 | 用途 |
|------|------|------|
| PageHeader | `PageHeader.tsx` | 页面标题 |
| EmptyState | `EmptyState.tsx` | 空状态 |
| ErrorState | `ErrorState.tsx` | 错误状态 |
| LoadingState | `LoadingState.tsx` | 加载状态 |
| ErrorBoundary | `ErrorBoundary.tsx` | 错误边界 |
| ConfirmDialog | `ConfirmDialog.tsx` | 确认对话框 |
| StatusBadge | `StatusBadge.tsx` | 状态徽章 |
| PageSection | `PageSection.tsx` | 页面区块 |
| FormSection | `FormSection.tsx` | 表单区块 |
| DataToolbar | `DataToolbar.tsx` | 数据工具栏 |
| DataTableShell | `DataTableShell.tsx` | 数据表格壳 |
| StatsCard | `StatsCard.tsx` | 统计卡片 |
| ConnectionIndicator | `ConnectionIndicator.tsx` | 连接指示器 |
| FieldError | `FieldError.tsx` | 字段错误 |
| FieldGroup | `FieldGroup.tsx` | 字段组 |
| FileUpload | `FileUpload.tsx` | 文件上传 |
| ImportWizard | `ImportWizard.tsx` | 导入向导 |

### 3.2 使用规则

- 组件必须可跨页面复用
- 组件必须使用项目定义的 design tokens
- 组件必须使用 `cn()` 合并 className
- 组件必须有清晰的 props 类型定义

---

## 4. components/layout/ — Shell / Sidebar / Topbar / Layout

### 4.1 允许内容

`components/layout/` 放 Shell / Sidebar / Topbar / Layout 组件。

当前组件：

| 组件 | 文件 | 用途 |
|------|------|------|
| AdminLayout | `AdminLayout.tsx` | 管理后台 Shell |
| ExamLayout | `ExamLayout.tsx` | 考试答题 Shell |
| AppSidebar | `AppSidebar.tsx` | 左侧导航 |
| BrandHeader | `BrandHeader.tsx` | 品牌标识 |
| BrandProvider | `BrandProvider.tsx` | 品牌信息上下文 |

### 4.2 使用规则

- Layout 组件不能放业务组件
- Layout 组件不能放业务逻辑
- Layout 组件只负责 Shell 结构

---

## 5. pages/ — 路由级组合

### 5.1 允许内容

`pages/` 放路由级页面组件。每个路由对应一个页面组件。

当前页面：

| 页面 | 文件 | 用途 |
|------|------|------|
| LoginPage | `LoginPage.tsx` | 登录页 |
| PlaceholderPage | `PlaceholderPage.tsx` | 占位页 |
| DashboardPage | `admin/DashboardPage.tsx` | 仪表盘 |
| ExamPage | `admin/ExamPage.tsx` | 考试列表 |
| ExamDetailPage | `admin/ExamDetailPage.tsx` | 考试详情 |
| ExamCreatePage | `admin/ExamCreatePage.tsx` | 新建考试 |
| QuestionPage | `admin/QuestionPage.tsx` | 题目列表 |
| QuestionEditPage | `admin/QuestionEditPage.tsx` | 编辑题目 |
| QuestionImportPage | `admin/QuestionImportPage.tsx` | 导入题目 |
| CoursePage | `admin/CoursePage.tsx` | 课程管理 |
| UsersPage | `admin/UsersPage.tsx` | 用户管理 |
| CandidatesPage | `admin/CandidatesPage.tsx` | 考生管理 |
| CandidateFieldsPage | `admin/CandidateFieldsPage.tsx` | 考生字段 |
| SettingsPage | `admin/SettingsPage.tsx` | 平台设置 |
| OrganizationsPage | `admin/OrganizationsPage.tsx` | 机构管理 |
| SystemHealthPage | `admin/SystemHealthPage.tsx` | 系统健康 |
| ScoreListPage | `admin/ScoreListPage.tsx` | 成绩查询 |
| ResultsOverviewPage | `admin/ResultsOverviewPage.tsx` | 结果概览 |
| AttemptDetailPage | `admin/AttemptDetailPage.tsx` | 答题详情 |
| ExamListPage | `exam/ExamListPage.tsx` | 考试列表 |
| StartExamPage | `exam/StartExamPage.tsx` | 开始考试 |
| TakeExamPage | `exam/TakeExamPage.tsx` | 答题 |
| ResultPage | `exam/ResultPage.tsx` | 结果 |

### 5.2 使用规则

- 页面组件只负责组合和路由
- 页面组件不能放复杂业务逻辑（应提取到 hooks 或 service）
- 页面组件必须有 loading / error / empty 三态
- 页面组件必须使用统一的 LoadingState / ErrorState / EmptyState 组件

---

## 6. 依赖关系

### 6.1 允许的依赖

```
pages/ → components/layout/
pages/ → components/shared/
pages/ → components/ui/

components/layout/ → components/shared/
components/layout/ → components/ui/

components/shared/ → components/ui/
```

### 6.2 禁止的依赖

```
components/ui/ → components/shared/  ❌
components/ui/ → components/layout/  ❌
components/ui/ → pages/              ❌
components/shared/ → pages/          ❌
components/layout/ → pages/          ❌
```

---

## 7. 文件命名规则

### 7.1 组件文件

| 类型 | 命名规则 | 示例 |
|------|----------|------|
| React 组件 | PascalCase | `Button.tsx`, `Card.tsx` |
| 工具函数 | camelCase | `utils.ts`, `helpers.ts` |
| 类型定义 | camelCase | `types.ts` |
| 测试文件 | `*.test.tsx` | `Button.test.tsx` |
| Story 文件 | `*.stories.tsx` | `Button.stories.tsx` |

### 7.2 目录命名

| 类型 | 命名规则 | 示例 |
|------|----------|------|
| 组件目录 | kebab-case | `ui/`, `shared/`, `layout/` |
| 页面目录 | kebab-case | `admin/`, `exam/` |
| 工具目录 | kebab-case | `lib/`, `hooks/` |

---

## 8. 导入规则

### 8.1 路径别名

```ts
// apps/web/src/lib/utils.ts
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

```tsx
// 使用路径别名
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
```

### 8.2 禁止的导入

```tsx
// 禁止相对路径导入
import { Button } from "../../components/ui/button";

// 禁止导入业务组件到 ui 目录
import { ExamCard } from "@/components/ui/ExamCard";
```
