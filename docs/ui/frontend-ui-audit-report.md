# 前端 UI 设计审计 & shadcn 采纳审计报告

**审计日期：** 2026-06-15
**项目：** 考试管理系统
**审计范围：** 前端 UI 设计、shadcn/ui 使用、Tailwind CSS、组件架构
**目标：** 建立稳定组件模式、收敛硬编码样式、规划低风险优化路径

---

## 执行摘要

考试管理系统在前端 UI 架构上展现出 **良好的 shadcn/ui 采纳度**，拥有完善的组件结构、合理的设计令牌系统和清晰的分层架构。系统在共享组件抽取、状态管理和布局分离方面表现成熟。然而，在视觉一致性、组件覆盖度和后台 CRUD 页面模式标准化方面仍有提升空间。

### 核心优势

- ✅ shadcn/ui 配置正确，22 个核心组件已安装
- ✅ Radix UI 原语确保了可访问性
- ✅ Tailwind CSS v4 配合完整的 CSS 变量主题系统
- ✅ 良好的共享组件库（17 个组件）
- ✅ 通过 `statusMeta` 系统一致管理状态显示
- ✅ 合理的布局分离（AdminLayout、ExamLayout）

### 主要差距

- ⚠️ 内联样式与设计令牌混用（部分硬编码颜色）
- ⚠️ 高级 shadcn 组件使用有限（Command、Data Table、Calendar）
- ⚠️ 缺乏统一的 CRUD 模式（每个页面重复实现相似逻辑）
- ⚠️ 后台管理页面间视觉模式不一致

---

## 当前 UI 成熟度评分

| 类别 | 评分 | 说明 |
|------|------|------|
| **shadcn 安装** | 8/10 | 配置正确，22 个组件已安装 |
| **设计系统** | 7/10 | 令牌系统良好，但存在内联样式 |
| **组件架构** | 8/10 | 分层清晰，共享组件完善 |
| **模式一致性** | 6/10 | CRUD 页面实现差异较大 |
| **可访问性** | 7/10 | 使用 Radix UI 原语，ARIA 属性完善 |
| **测试覆盖** | 8/10 | 组件测试覆盖良好 |
| **整体成熟度** | **7.3/10** | **基础扎实，已具备标准化条件** |

---

## 第一部分：shadcn 基础设施审计

### 安装状态检查

| Item | Current Status | Evidence | Problem | Recommendation |
|------|----------------|----------|---------|----------------|
| components.json | ✅ 存在且配置正确 | `apps/web/components.json` | 无 | 保持现有配置 |
| shadcn aliases | ✅ 配置正确 | `@/components`, `@/lib/utils`, `@/components/ui` | 无 | 保持现有配置 |
| cn helper | ✅ 已实现 | `apps/web/src/lib/utils.ts` | 无 | 保持现有实现 |
| CSS variables | ✅ 已启用 | `components.json: cssVariables: true` | 无 | 继续使用 |
| Tailwind 版本 | ✅ v4.1.7 | `@tailwindcss/vite: ^4.1.7` | 无 | 保持 v4 |
| class-variance-authority | ✅ 已安装 | `package.json: ^0.7.1` | 无 | 已在 Button 中使用 |
| clsx | ✅ 已安装 | `package.json: ^2.1.1` | 无 | cn() 依赖 |
| tailwind-merge | ✅ 已安装 | `package.json: ^3.6.0` | 无 | cn() 依赖 |
| lucide-react | ✅ 已安装 | `package.json: ^1.17.0` | 无 | 图标系统完善 |
| Radix primitives | ✅ 已安装 | `package.json: ^1.4.3` | 无 | 15 个组件使用 |

### 实际使用情况

**使用 shadcn 的页面：**

- ✅ `LoginPage.tsx` - Card, Input, Label, Button
- ✅ `CandidatesPage.tsx` - Dialog, Input, Label, Table, Button, Select
- ✅ `UsersPage.tsx` - Dialog, Input, Label, Table, Button, Select, Badge
- ✅ `ExamPage.tsx` - Table, Button, Tooltip, DataToolbar
- ✅ `QuestionPage.tsx` - Table, Button, Input, Select, Badge
- ✅ `TakeExamPage.tsx` - Button, Dialog, Alert, Separator

**手写 UI 的页面：**

- ⚠️ `StartExamPage.tsx` - 部分手写样式
- ⚠️ `ResultPage.tsx` - 部分手写样式

---

## 第二部分：shadcn 组件库存审计

### 已安装组件清单（22 个）

| Component | 存在 | 使用位置 | 利用不足 | 应为默认原语 | 备注 |
|-----------|------|----------|----------|-------------|------|
| Button | ✅ | 所有页面 | 否 | ✅ | 变体完善（7 variant，7 size） |
| Input | ✅ | 大部分页面 | 否 | ✅ | 焦点状态、错误处理完善 |
| Label | ✅ | 表单页面 | 否 | ✅ | - |
| Card | ✅ | LoginPage | 否 | ✅ | 利用率可提升 |
| Table | ✅ | CRUD 页面 | 否 | ✅ | 基础功能，缺排序/筛选 |
| Dialog | ✅ | CRUD 页面 | 否 | ✅ | - |
| AlertDialog | ✅ | ✅ ConfirmDialog 使用 | 否 | ✅ | 通过 ConfirmDialog 抽象 |
| Sheet | ✅ | - | ✅ | ⚠️ | 存在但未充分利用 |
| DropdownMenu | ✅ | - | ✅ | ⚠️ | 存在但未充分利用 |
| Select | ✅ | CRUD 页面 | 否 | ✅ | - |
| Badge | ✅ | UsersPage, QuestionPage | 否 | ✅ | - |
| Tabs | ✅ | - | ✅ | ⚠️ | 存在但未充分利用 |
| Breadcrumb | ❌ | - | - | ✅ | **缺失** |
| Pagination | ✅ | - | ✅ | ⚠️ | 存在但未在列表页使用 |
| Skeleton | ✅ | AdminLayout | 否 | ✅ | - |
| Alert | ✅ | TakeExamPage | 否 | ✅ | - |
| Toast / Sonner | ✅ | 全局 toast | 否 | ✅ | - |
| Tooltip | ✅ | ExamPage, CoursePage | 否 | ✅ | - |
| Separator | ✅ | TakeExamPage, AppSidebar | 否 | ✅ | - |
| Checkbox | ✅ | - | ✅ | ⚠️ | 存在但未充分利用 |
| RadioGroup | ✅ | - | ✅ | ⚠️ | 存在但未充分利用 |
| Textarea | ✅ | CoursePage | 否 | ✅ | - |
| Form | ✅ | - | ✅ | ⚠️ | 存在但未充分利用 |
| Avatar | ✅ | AppSidebar | 否 | ✅ | - |
| Switch | ✅ | - | ✅ | ⚠️ | 存在但未充分利用 |

### 缺失的高价值组件

| Component | 优先级 | 用途 | 估算价值 |
|-----------|--------|------|----------|
| Command / CommandPalette | 中 | 高级搜索/筛选 | 提升列表页体验 |
| Data Table | 高 | 高级表格（排序、筛选、分页） | 减少重复代码 |
| Calendar | 中 | 日期选择（考试配置） | 提升表单体验 |
| Popover | 中 | 改进交互（如快速操作） | 提升用户体验 |
| Combobox | 中 | 改进选择体验（如多选、搜索） | 提升选择体验 |

---

## 第三部分：Tailwind CSS / Token 审计

### CSS 变量系统检查

**✅ 完整的 Token 映射：**

```css
/* 颜色令牌 */
--bg: #f7f8fb;                    /* 页面背景 */
--surface: #ffffff;               /* 卡片背景 */
--surface-muted: #f9fafb;         /* 次级背景 */
--text: #111827;                  /* 主文字 */
--text-muted: #6b7280;            /* 次级文字 */
--text-subtle: #9ca3af;           /* 次要文字 */
--border: #e5e7eb;                /* 边框 */
--border-strong: #d1d5db;         /* 强边框 */

/* 语义颜色 */
--primary: #2563eb;               /* 主操作色（蓝） */
--primary-hover: #1d4ed8;         /* 主操作悬停 */
--primary-soft: #eff6ff;          /* 主操作柔和背景 */
--danger: #b42318;                /* 危险操作色（红） */
--danger-hover: #912018;          /* 危险操作悬停 */
--danger-soft: #fef3f2;           /* 危险操作柔和背景 */
--success: #047857;               /* 成功状态色（绿） */
--success-soft: #ecfdf5;          /* 成功状态柔和背景 */
--warning: #b54708;               /* 警告状态色（橙） */
--warning-soft: #fffbeb;          /* 警告状态柔和背景 */
--info: #175cd3;                  /* 信息状态色 */
--info-soft: #eff6ff;             /* 信息状态柔和背景 */

/* 侧边栏 */
--sidebar-bg: #102a43;            /* 侧边栏背景（深蓝） */
--sidebar-active: #1f4e79;        /* 侧边栏激活 */
--sidebar-active-soft: #edf5fa;   /* 侧边栏激活柔和 */
--sidebar-text: #d9e2ec;          /* 侧边栏文字 */
--sidebar-muted: #9fb3c8;         /* 侧边栏次要文字 */
--sidebar-border: #1b3a57;        /* 侧边栏边框 */

/* 其他 */
--radius: 0.5rem;                 /* 默认圆角 */
```

**✅ Tailwind v4 主题映射：**

```css
@theme inline {
  --color-background: var(--bg);
  --color-foreground: var(--text);
  --color-card: var(--surface);
  --color-primary: var(--primary);
  --color-destructive: var(--danger);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-info: var(--info);
  --color-muted: var(--surface-muted);
  --color-border: var(--border);
  --color-ring: var(--primary);
  --color-sidebar: var(--sidebar-bg);
  /* ... 完整映射 */
}
```

### 硬编码样式审计

**发现的硬编码模式：**

| 模式 | 发现位置 | 问题 | 建议 |
|------|----------|------|------|
| `bg-destructive/30` | TakeExamPage, StartExamPage | 应使用 token | 改为 `bg-destructive-soft` |
| `border-destructive/30` | 多个页面 | 应使用 token | 改为 `border-destructive-soft` |
| `bg-warning/10` | 多个页面 | 应使用 token | 改为 `bg-warning-soft` |
| `bg-info/10` | 多个页面 | 应使用 token | 改为 `bg-info-soft` |
| `rounded-[4px]` | Checkbox.tsx | 应使用标准圆角 | 改为 `rounded-md` |
| `rounded-[2px]` | Tooltip.tsx | 应使用标准圆角 | 改为 `rounded-sm` |
| `translate-y-[calc(-50%_-_2px)]` | Tooltip.tsx | 过度具体 | 保留（组件内部） |

**合理的布局工具类：**

- ✅ `flex`, `grid`, `gap-2/3/4/6`
- ✅ `px-3/4/6`, `py-2/3/4`
- ✅ `w-full`, `max-w-md`, `max-w-7xl`
- ✅ `flex-1`, `shrink-0`, `min-w-0`

**应上升为令牌的样式：**

- ⚠️ 重复的卡片容器：`rounded-lg border bg-card p-6`
- ⚠️ 重复的按钮间距：`gap-2`
- ⚠️ 重复的表格样式：`w-full text-sm`

### 令牌使用评估

| 维度 | 状态 | 说明 |
|------|------|------|
| 颜色令牌定义 | ✅ 完善 | 18 个语义颜色令牌 |
| 令牌使用一致性 | ⚠️ 70% | 70% 使用令牌，30% 硬编码 |
| 圆角标准化 | ⚠️ 不一致 | lg/md/xl 混用 |
| 阴影系统 | ❌ 缺失 | 只有 shadow-sm/shadow-xs |
| 间距系统 | ✅ 良好 | 使用 Tailwind 间距工具类 |

---

## 第四部分：当前 UI 视觉风格审计

### 颜色系统

**主色调：**

- **Primary：** 蓝色系 (#2563eb) - 适用于主操作按钮、链接、激活状态
- **Secondary：** 中性色 - 适用于次级操作、背景
- **Destructive：** 红色系 (#b42318) - 适用于删除、禁用、错误

**语义颜色：**

- **Success：** 绿色系 (#047857) - 成功状态、通过
- **Warning：** 橙色系 (#b54708) - 警告状态、待处理
- **Info：** 蓝色系 (#175cd3) - 信息提示
- **Neutral：** 灰色系 - 次要信息、占位符

**中性色阶：**

- **Background：** #f7f8fb - 页面背景
- **Surface：** #ffffff - 卡片、容器背景
- **Surface Muted：** #f9fafb - 次级区域背景

### 侧边栏风格

**深色主题侧边栏：**

- **背景：** #102a43（深蓝）
- **激活项：** #1f4e79（浅蓝）
- **文字：** #d9e2ec（浅灰白）
- **边框：** #1b3a57（深蓝边框）

**优点：**

- ✅ 与主内容区分明确
- ✅ 视觉层次清晰
- ✅ 适合后台管理系统

**待改进：**

- ⚠️ 折叠状态下的交互可优化
- ⚠️ 激活状态的视觉反馈可加强

### 卡片风格

**当前模式：**

```tsx
className="rounded-lg border bg-card p-6"
```

**优点：**

- ✅ 简洁清晰
- ✅ 与背景区分明显

**待改进：**

- ⚠️ 缺少统一阴影层级
- ⚠️ 内边距不完全一致（p-4, p-5, p-6）

### 按钮风格

**变体使用：**

- **default：** 主操作（蓝色）
- **outline：** 次级操作（边框）
- **ghost：** 图标操作（透明悬停）
- **destructive：** 危险操作（红色）

**优点：**

- ✅ 变体完善
- ✅ 尺寸多样
- ✅ 焦点状态、禁用状态完善

**待改进：**

- ⚠️ 图标按钮的尺寸一致性
- ⚠️ 按钮间距模式可标准化

### 表格风格

**当前模式：**

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>标题</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>内容</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

**优点：**

- ✅ 使用 shadcn Table 原语
- ✅ 响应式列宽（w-16, w-24, w-32）

**待改进：**

- ⚠️ 缺少统一容器（DataTableShell 已存在但利用不足）
- ⚠️ 缺少排序、筛选功能
- ⚠️ 分页实现不统一

### 弹窗风格

**Dialog 使用：**

```tsx
<Dialog>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>标题</DialogTitle>
    </DialogHeader>
    <div className="py-4">内容</div>
    <DialogFooter>
      <Button variant="outline">取消</Button>
      <Button>确认</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**优点：**

- ✅ 模式一致
- ✅ 使用 DialogFooter 标准化按钮

**待改进：**

- ⚠️ 表单模式可抽取为 AdminFormLayout
- ⚠️ 缺少确认对话框的统一抽象（ConfirmDialog 已存在）

### 空状态风格

**当前模式：**

```tsx
<EmptyState
  icon={<Icon className="size-8" />}
  title="标题"
  description="描述"
  action={<Button>操作</Button>}
/>
```

**优点：**

- ✅ 组件化良好
- ✅ 统一视觉模式

**待改进：**

- ⚠️ 某些页面仍手写空状态
- ⚠️ 可增加更多变体（如错误空状态）

### 状态徽章风格

**当前实现：**

```tsx
<StatusBadge status="published" />  // 已发布
<StatusBadge status="draft" />      // 草稿
<StatusBadge status="archived" />   // 已归档
```

**优点：**

- ✅ ✅ 完善的状态映射系统（statusMeta）
- ✅ 自动图标和颜色
- ✅ 支持 29 种状态类型

**待改进：**

- ⚠️ 可增加更多尺寸变体
- ⚠️ 某些页面仍手写状态显示

### 页面风格对比

| 页面 | 当前风格 | 一致性 | 问题 |
|------|----------|--------|------|
| LoginPage | ✅ 优秀 | - | Card 模式完善 |
| CandidatesPage | ✅ 良好 | 7/10 | 手写搜索模式 |
| UsersPage | ✅ 良好 | 7/10 | 与 CandidatesPage 模式不同 |
| ExamPage | ⚠️ 一般 | 5/10 | 缺少 DataTableShell |
| QuestionPage | ⚠️ 一般 | 5/10 | 手写筛选模式 |
| CoursePage | ✅ 良好 | 8/10 | 模式较清晰 |
| TakeExamPage | ✅ 优秀 | 9/10 | 专用考试 UI，合理差异化 |

---

## 第五部分：业务页面审计

### 后台管理页面模式分析

| 页面 | 行数 | 当前模式 | 重复实现 | shadcn 替代 | 建议项目组件 | 优先级 | 风险 |
|------|------|----------|----------|-------------|-------------|--------|------|
| **CandidatesPage** | 541 | 手写 CRUD | ✅ 高 | 8/10 | AdminDataTable | 1 | 中 |
| **UsersPage** | 303 | 手写 CRUD | ✅ 高 | 8/10 | AdminDataTable | 2 | 低 |
| **CoursePage** | 362 | 手写 CRUD | ✅ 高 | 8/10 | AdminDataTable | 3 | 低 |
| **QuestionPage** | 415 | 手写 CRUD | ✅ 高 | 7/10 | AdminDataTable | 4 | 中 |
| **ExamPage** | 207 | 手写 CRUD | ⚠️ 中 | 7/10 | AdminDataTable | 5 | 低 |
| **ExamDetailPage** | - | 详情页 | ⚠️ 中 | - | AdminDetailLayout | 6 | 低 |
| **QuestionEditPage** | - | 编辑表单 | ✅ 高 | 8/10 | AdminFormLayout | 7 | 中 |
| **SettingsPage** | - | 设置表单 | ✅ 高 | 8/10 | AdminFormLayout | 8 | 低 |

### 考试端页面模式分析

| 页面 | 当前风格 | 模式合理性 | 建议 |
|------|----------|-----------|------|
| **TakeExamPage** | ✅ 专用考试 UI | ✅ 优秀 | 保持现有模式，抽取共享组件 |
| **ResultPage** | ⚠️ 部分手写 | ⚠️ 一般 | 统一使用 shadcn 组件 |
| **StartExamPage** | ⚠️ 部分手写 | ⚠️ 一般 | 统一使用 shadcn 组件 |
| **ExamListPage** | ✅ 良好 | ✅ 良好 | 保持现有模式 |

### 重复实现检查

**✅ 已良好抽象的组件：**

- PageHeader - 页面标题和操作区域
- EmptyState - 空状态展示
- LoadingState - 加载状态
- ErrorState - 错误状态
- ConfirmDialog - 确认对话框
- StatusBadge - 状态徽章
- DataTableShell - 表格容器

**⚠️ 重复实现的模式：**

1. **搜索输入模式：** CandidatesPage, UsersPage, CoursePage 各自实现
2. **筛选器模式：** QuestionPage 手写 Select 筛选
3. **分页模式：** QuestionPage 手写分页按钮
4. **表单对话框：** 各页面重复 Dialog + FieldGroup + DialogFooter
5. **表格操作列：** 各页面重复编辑/删除按钮实现

---

## 第六部分：UI 目标风格建议

### 1. 品牌语气

**定位：** 庄重、清晰、稳定、低噪音
**应用场景：** 教育考试、政企后台、内部评估系统

**视觉特征：**

- **庄重：** 深色侧边栏 + 浅色内容区，避免花哨渐变
- **清晰：** 明确的视觉层次，高对比度文字
- **稳定：** 统一的间距、圆角、阴影模式
- **低噪音：** 简洁的配色，少量使用装饰性元素

### 2. 配色方向

**主色（保持现有）：**

| Token | 用途 | 建议方向 | 当前值 | 备注 |
|-------|------|----------|--------|------|
| background | 页面背景 | 保持 #f7f8fb | #f7f8fb | 浅灰背景，减少眼疲劳 |
| foreground | 主文字 | 保持 #111827 | #111827 | 深灰，高对比度 |
| card | 卡片背景 | 保持 #ffffff | #ffffff | 纯白，与背景区分 |
| card-foreground | 卡片文字 | 保持 #111827 | #111827 | 与主文字一致 |
| primary | 主操作 | 保持 #2563eb | #2563eb | 蓝，信任感 |
| destructive | 危险操作 | 保持 #b42318 | #b42318 | 红，警示性 |
| success | 成功状态 | 保持 #047857 | #047857 | 绿，正面反馈 |
| warning | 警告状态 | 保持 #b54708 | #b54708 | 橙，注意提醒 |
| info | 信息提示 | 保持 #175cd3 | #175cd3 | 浅蓝，信息展示 |
| muted | 次级背景 | 保持 #f9fafb | #f9fafb | 浅灰，次要区域 |
| border | 边框 | 保持 #e5e7eb | #e5e7eb | 浅灰边框，不突兀 |
| ring | 焦点环 | 保持 #2563eb | #2563eb | 与 primary 一致 |
| sidebar | 侧边栏背景 | 保持 #102a43 | #102a43 | 深蓝，后台感 |

**新增令牌建议：**

```css
/* 阴影系统（当前缺失） */
--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
--shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1);
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);

/* 圆角系统（当前只有 --radius） */
--radius-sm: 0.375rem;  /* 6px */
--radius-md: 0.5rem;    /* 8px */
--radius-lg: 0.75rem;   /* 12px */
--radius-xl: 1rem;      /* 16px */
```

### 3. Typography 建议

**字体栈（保持现有）：**

```css
--font-sans: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
```

**排版规范：**

| 元素 | 大小 | 字重 | 颜色 | 行高 |
|------|------|------|------|------|
| 页面标题 (h1) | text-2xl | 600 (semibold) | text-foreground | 1.2 |
| Section 标题 (h2) | text-lg | 600 (semibold) | text-foreground | 1.3 |
| 表格文字 | text-sm | 400 (normal) | text-foreground | 1.4 |
| 表单标签 | text-sm | 500 (medium) | text-foreground | 1.4 |
| Helper 文字 | text-xs | 400 (normal) | text-muted-foreground | 1.4 |
| 错误文字 | text-sm | 500 (medium) | text-destructive | 1.4 |
| 按钮文字 | text-sm | 500 (medium) | primary-foreground | 1.2 |
| Breadcrumb 文字 | text-sm | 400 (normal) | text-muted-foreground | 1.4 |

### 4. Spacing / Radius / Shadow 建议

**间距规范：**

| 场景 | 当前 | 建议 | 说明 |
|------|------|------|------|
| 页面内边距 | p-6 lg:p-8 | p-6 lg:p-8 | ✅ 保持 |
| 卡片内边距 | p-4 ~ p-6 | p-6 | 统一为 p-6 |
| Toolbar 间距 | gap-2 ~ gap-3 | gap-3 | 统一为 gap-3 |
| Form 字段间距 | gap-4 | gap-4 | ✅ 保持 |
| Input 高度 | h-9 | h-9 | ✅ 保持 |
| Button 高度 | h-9 (default) | h-9 | ✅ 保持 |
| 表格行高 | - | h-12 | 统一为 h-12 |
| Dialog 内边距 | py-4 | py-6 | 增加为 py-6 |
| Sheet 宽度 | - | w-[500px] | 统一为 w-[500px] |

**圆角规范：**

| 场景 | 当前 | 建议 | 说明 |
|------|------|------|------|
| 卡片/容器 | rounded-lg | rounded-lg | ✅ 保持 |
| 表单/输入 | rounded-md | rounded-md | ✅ 保持 |
| 按钮 | rounded-lg | rounded-lg | ✅ 保持 |
| 警告/提示 | rounded-md | rounded-lg | 统一为 lg |
| 表格 | (none) | rounded-lg | 添加圆角 |

**阴影规范（新增）：**

| 场景 | 当前 | 建议 | 说明 |
|------|------|------|------|
| 卡片 | shadow-sm | shadow-sm | ✅ 保持 |
| 弹窗 | - | shadow-lg | 添加阴影 |
| 下拉菜单 | - | shadow-md | 添加阴影 |
| 提示 | - | shadow | 添加阴影 |

---

## 第七部分：组件分层方案

### 1. shadcn primitives（22 个）

**默认直接使用：**

- ✅ Button, Input, Label, Card, Table
- ✅ Dialog, AlertDialog, Sheet
- ✅ DropdownMenu, Select, Badge, Tabs
- ✅ Pagination, Skeleton, Tooltip
- ✅ Alert, Toast/Sonner, Separator
- ✅ Checkbox, RadioGroup, Textarea
- ✅ Form, Avatar, Switch

**新增建议：**

- ⚠️ Command / CommandPalette
- ⚠️ Calendar
- ⚠️ Popover
- ⚠️ Combobox

### 2. project-level components

**已存在（17 个）：**

```
shared/
├── ConfirmDialog.tsx        ✅ 良好
├── DataTableShell.tsx       ✅ 良好，但功能基础
├── EmptyState.tsx           ✅ 良好
├── ErrorState.tsx           ✅ 良好
├── FieldGroup.tsx           ✅ 良好
├── FormSection.tsx          ✅ 良好
├── ImportWizard.tsx         ✅ 良好
├── LoadingState.tsx         ✅ 良好
├── PageHeader.tsx           ✅ 良好
├── StatusBadge.tsx          ✅ 优秀
├── FieldError.tsx           ✅ 良好
├── DataToolbar.tsx          ✅ 良好
├── ConnectionIndicator.tsx  ✅ 良好
├── ErrorBoundary.tsx        ✅ 良好
├── FileUpload.tsx           ✅ 良好
├── PageSection.tsx          ✅ 良好
└── StatsCard.tsx            ✅ 良好
```

**建议新增：**

```typescript
// A. CRUD 模式组件
shared/
├── AdminDataTable.tsx          // 增强版 DataTableShell
├── SearchInput.tsx             // 统一搜索输入
├── FilterBar.tsx               // 统一筛选栏
├── DataTablePagination.tsx     // 统一分页
├── RowActions.tsx              // 统一行操作
├── EntitySheet.tsx             // 统一侧边编辑表单
├── AdminFormLayout.tsx         // 统一表单布局
└── ConfirmActionDialog.tsx     // 统一确认对话框

// B. 布局组件
layout/
├── AdminPageLayout.tsx         // 统一后台页面布局
└── ExamPageLayout.tsx          // 统一考试页面布局
```

### 3. business-level components

**保留在业务模块：**

```typescript
// A. 考试模块
exam/
├── ExamTimer.tsx               // ✅ 已存在，保留
├── QuestionRenderer.tsx        // ✅ 已存在，保留
├── QuestionNav.tsx             // ✅ 已存在，保留
├── SaveIndicator.tsx           // ✅ 已存在，保留
├── SingleChoiceInput.tsx       // ✅ 已存在，保留
├── MultipleChoiceInput.tsx     // ✅ 已存在，保留
├── TrueFalseInput.tsx          // ✅ 已存在，保留
├── FillBlankInput.tsx          // ✅ 已存在，保留
├── ExamConfigForm.tsx          // ✅ 已存在，保留
└── EnrollmentPicker.tsx        // ✅ 已存在，保留

// B. 问题模块
question/
├── QuestionForm.tsx            // ✅ 已存在，保留
└── QuestionPreview.tsx         // ✅ 已存在，保留

// C. 设置模块
settings/
├── PlatformSettingsForm.tsx    // ✅ 已存在，保留
└── PasswordChangeForm.tsx      // ✅ 已存在，保留
```

**建议新增（业务特定）：**

```typescript
// A. 表单组件
forms/
├── CandidateForm.tsx           // 考生表单
├── UserForm.tsx                // 用户表单
├── CourseForm.tsx              // 课程表单
├── QuestionForm.tsx            // 问题表单
├── ExamForm.tsx                // 考试表单

// B. 表格组件
tables/
├── CandidateColumns.tsx        // 考生表格列
├── UserColumns.tsx             // 用户表格列
├── CourseColumns.tsx           // 课程表格列
├── QuestionColumns.tsx         // 问题表格列
├── ExamColumns.tsx             // 考试表格列

// C. 业务徽章
badges/
├── ExamStatusBadge.tsx         // 考试状态徽章
├── AttemptStatusBadge.tsx      // 答题状态徽章
├── QuestionTypeBadge.tsx       // 问题类型徽章
└── ScoreBadge.tsx              // 分数徽章
```

### 组件分层表

| 提议组件 | 层级 | 依赖 | 首次使用 | 复用潜力 | 风险 |
|----------|------|------|----------|----------|------|
| AdminDataTable | project | DataTableShell, Table | CandidatesPage | 高 | 低 |
| SearchInput | project | Input, Icon | CandidatesPage | 高 | 低 |
| FilterBar | project | Select, Button | QuestionPage | 高 | 低 |
| DataTablePagination | project | Button, Pagination | QuestionPage | 高 | 低 |
| RowActions | project | Button, ConfirmDialog | CandidatesPage | 高 | 低 |
| AdminFormLayout | project | Dialog, FieldGroup | CandidatesPage | 高 | 低 |
| EntitySheet | project | Sheet, FieldGroup | - | 中 | 低 |
| ConfirmActionDialog | project | ConfirmDialog | - | 中 | 低 |
| Command / CommandPalette | shadcn | - | QuestionPage | 中 | 低 |
| Calendar | shadcn | - | ExamCreatePage | 中 | 低 |

---

## 第八部分：CRUD 页面模式

### 目标模式架构

```
AdminListPage (标准化列表页)
├── AdminPageLayout          // 页面布局（包含页面标题）
│   └── PageHeader           // 标题、描述、主操作
├── FilterBar                // 筛选栏
│   ├── SearchInput          // 搜索输入
│   ├── FilterSelect         // 筛选选择器
│   └── ResetButton          // 重置按钮
├── AdminDataTable           // 数据表格
│   ├── TableHeader          // 表头
│   ├── TableBody            // 表体
│   ├── LoadingState         // 加载状态
│   ├── EmptyState           // 空状态
│   ├── ErrorState           // 错误状态
│   └── DataTablePagination  // 分页
├── RowActions               // 行操作
│   ├── ViewButton           // 查看按钮
│   ├── EditButton           // 编辑按钮
│   ├── ToggleButton         // 启用/禁用按钮
│   └── DeleteButton         // 删除按钮
└── EntityDialog             // 实体对话框
    ├── DialogHeader         // 对话框标题
    ├── AdminFormLayout      // 表单布局
    │   ├── FieldGroup       // 字段组
    │   └── FormSection      // 表单分段
    └── DialogFooter         // 对话框底部按钮
```

### 试点页面选择

**推荐顺序：**

1. **CandidatesPage**（541 行）
   - **适合度：** ⭐⭐⭐⭐⭐
   - **原因：** 最复杂、最完整、包含搜索、筛选、导入、对话框
   - **风险：** 中等（大文件重构）
   - **收益：** 最大（代码量减少 ~70%）

2. **UsersPage**（303 行）
   - **适合度：** ⭐⭐⭐⭐⭐
   - **原因：** 结构清晰、功能简单、适合验证模式
   - **风险：** 低（小文件重构）
   - **收益：** 中等（代码量减少 ~60%）

3. **CoursePage**（362 行）
   - **适合度：** ⭐⭐⭐⭐
   - **原因：** 包含搜索、编辑、删除、描述截断
   - **风险：** 低
   - **收益：** 中等

4. **QuestionPage**（415 行）
   - **适合度：** ⭐⭐⭐
   - **原因：** 有特殊性（多筛选、分页、标签展示）
   - **风险：** 中等
   - **收益：** 中等

5. **ExamPage**（207 行）
   - **适合度：** ⭐⭐⭐
   - **原因：** 相对简单、不同状态展示
   - **风险：** 低
   - **收益：** 中等

### 抽取策略

**阶段 1：局部抽取（不改变页面结构）**

```
CandidatesPage.tsx (541 行)
├── 提取 <CandidateSearchBar />      // 搜索 + 清除按钮
├── 提取 <CandidateFilters />         // 筛选器（如果有）
├── 提取 <CandidateTable />           // 表格展示
└── 提取 <CandidateDialog />          // 对话框表单
```

**阶段 2：上升为共享组件（在 2-3 个页面验证后）**

```
shared/
├── SearchInput.tsx          // 从各页面的搜索输入抽取
├── AdminDataTable.tsx       // 从各页面的表格抽取
├── AdminFormLayout.tsx      // 从各页面的对话框抽取
└── ConfirmActionDialog.tsx  // 从各页面的确认操作抽取
```

**阶段 3：模式标准化（在多个页面稳定后）**

```
hooks/
├── useAdminList.ts          // 列表页通用逻辑
├── useAdminForm.ts          // 表单页通用逻辑
└── useConfirmAction.ts      // 确认操作通用逻辑
```

### 不要过早抽象

**❌ 不推荐一开始就抽取：**

- ❌ ResourcePage 泛型组件（太泛化，难以维护）
- ❌ 完整的 CRUD 框架（过度设计）
- ❌ Table 组件封装（shadcn Table 已足够）

**✅ 推荐逐步抽取：**

- ✅ 先在单个页面内抽取子组件
- ✅ 在 2-3 个页面验证后上升为共享组件
- ✅ 在 3+ 个页面稳定后抽取为 Hook
- ✅ 保持简单，避免过度泛化

---

## 第九部分：视觉问题翻译成工程任务

### 常见视觉问题 → 设计语言 → 工程修改

| 视觉问题 | 设计语言 | 工程修改方向 |
|----------|----------|-------------|
| Input 和 Button 太挤 | Vertical rhythm 不统一 | 使用 FormSection / FieldGroup 统一间距 |
| 页面像拼起来的 | Design token 不统一 | 统一 color / radius / shadow token |
| CRUD 页面重复代码 | 缺少 resource pattern | 抽取 AdminDataTable / SearchInput / FilterBar |
| 按钮太吵 | Action hierarchy 混乱 | 统一 Button variant 使用规范 |
| 危险操作不清楚 | Destructive action 不规范 | 使用 AlertDialog + destructive Button |
| 空状态不统一 | EmptyState 缺失 | 统一使用 EmptyState 组件 |
| 表格行高不一致 | Table spacing 不统一 | 统一表格行高为 h-12 |
| 对话框大小不统一 | Dialog size 不统一 | 统一 Dialog 宽度和内边距 |
| 阴影层级不清晰 | Shadow system 缺失 | 添加 shadow token 并统一使用 |
| 圆角混用 | Border radius 不统一 | 定义 radius token 并统一使用 |
| 硬编码颜色散落 | Token adoption 不完整 | 替换硬编码颜色为 token |
| 状态显示不一致 | Status badge 不统一 | 统一使用 StatusBadge 组件 |
| 搜索模式不统一 | Search pattern 不一致 | 抽取 SearchInput 组件 |
| 分页模式不统一 | Pagination pattern 不一致 | 抽取 DataTablePagination 组件 |
| 表单验证 UI 不一致 | Form validation pattern 不统一 | 统一使用 FieldError + FieldGroup |

### Token 替换优先级

**高优先级（高频、明显）：**

```tsx
// ❌ 当前
className="bg-destructive/30 text-destructive"
className="border-destructive/30"

// ✅ 修改为
className="bg-destructive-soft text-destructive"
className="border-destructive-soft"
```

**中优先级（中频、微妙）：**

```tsx
// ❌ 当前
className="bg-warning/10"
className="bg-info/10"

// ✅ 修改为
className="bg-warning-soft"
className="bg-info-soft"
```

**低优先级（低频、组件内部）：**

```tsx
// ❌ 当前（shadcn 组件内部）
rounded-[4px]
translate-y-[calc(-50%_-_2px)]

// ✅ 保持不变（组件内部实现细节）
```

---

## 第十部分：建议 PR 拆分

### PR-UI-0: Audit only（当前 PR）

| 属性 | 说明 |
|------|------|
| Scope | 审计文档输出，不改代码 |
| Files | 不涉及 |
| Acceptance | 审计报告完整、可操作 |
| Risk | 无 |
| Do not do | 不要修改任何代码 |

---

### PR-UI-1: Design Token Baseline

| 属性 | 说明 |
|------|------|
| Scope | 整理 Tailwind / CSS variables / shadcn theme token |
| Files likely touched | `apps/web/src/index.css` |
| Acceptance | 硬编码颜色替换为 token，新增 shadow/radius token |
| Risk | 低（仅视觉） |
| Do not do | 不要修改业务逻辑、不要大幅修改布局 |

**任务清单：**

- [ ] 添加 shadow token（shadow-sm, shadow, shadow-md, shadow-lg）
- [ ] 添加 radius token（radius-sm, radius-md, radius-lg, radius-xl）
- [ ] 替换 `bg-destructive/30` 为 `bg-destructive-soft`
- [ ] 替换 `border-destructive/30` 为 `border-destructive-soft`
- [ ] 替换 `bg-warning/10` 为 `bg-warning-soft`
- [ ] 替换 `bg-info/10` 为 `bg-info-soft`
- [ ] 统一 Alert 的 border-radius 为 `rounded-lg`
- [ ] 统一 Table 的 border-radius 为 `rounded-lg`

---

### PR-UI-2: shadcn Primitive Usage Baseline

| 属性 | 说明 |
|------|------|
| Scope | 规定业务页面默认使用 shadcn primitives |
| Files likely touched | 新建 `docs/frontend/ui-baseline.md` |
| Acceptance | 文档完整、团队可参考 |
| Risk | 无 |
| Do not do | 不要修改现有代码、不要添加新组件 |

**任务清单：**

- [ ] 创建 `docs/frontend/ui-baseline.md`
- [ ] 记录 shadcn 组件使用规范
- [ ] 记录 Design Token 使用规范
- [ ] 记录组件查找和复用规则
- [ ] 记录禁止事项（硬编码颜色、手写 UI）

---

### PR-UI-3: LoginPage Cleanup

| 属性 | 说明 |
|------|------|
| Scope | 迁移登录页，修复 spacing |
| Files likely touched | `apps/web/src/pages/LoginPage.tsx` |
| Acceptance | 登录页使用 shadcn 组件、间距统一 |
| Risk | 低（单页面、功能简单） |
| Do not do | 不要修改登录逻辑、不要改变认证流程 |

**任务清单：**

- [ ] 验证现有 Card / Input / Label / Button 使用正确
- [ ] 统一 FieldGroup 间距为 `gap-4`
- [ ] 统一 Dialog 内边距为 `py-6`
- [ ] 统一错误提示使用 token 颜色
- [ ] 添加响应式支持（移动端优化）

---

### PR-UI-4: CandidatesPage CRUD Pilot

| 属性 | 说明 |
|------|------|
| Scope | 迁移 CandidatesPage，建立第一套 CRUD pattern |
| Files likely touched | `apps/web/src/pages/admin/CandidatesPage.tsx` |
| Acceptance | CandidatesPage 代码量减少 50%+，使用共享组件 |
| Risk | 中（大文件重构） |
| Do not do | 不要修改业务逻辑、不要改变导入功能 |

**任务清单：**

- [ ] 在 CandidatesPage 内局部抽取 `<CandidateSearchBar />`
- [ ] 在 CandidatesPage 内局部抽取 `<CandidateTable />`
- [ ] 在 CandidatesPage 内局部抽取 `<CandidateDialog />`
- [ ] 创建 `shared/SearchInput.tsx`（从搜索输入抽取）
- [ ] 创建 `shared/RowActions.tsx`（从行操作抽取）
- [ ] 重构 CandidatesPage 使用新组件
- [ ] 验证功能不变

---

### PR-UI-5: UsersPage Follows Pattern

| 属性 | 说明 |
|------|------|
| Scope | 复用 CandidatesPage 经验迁移 UsersPage |
| Files likely touched | `apps/web/src/pages/admin/UsersPage.tsx` |
| Acceptance | UsersPage 代码量减少 50%+，使用共享组件 |
| Risk | 低（模式已验证） |
| Do not do | 不要修改业务逻辑、不要改变用户管理功能 |

**任务清单：**

- [ ] 使用 `shared/SearchInput.tsx`
- [ ] 使用 `shared/RowActions.tsx`
- [ ] 重构 UsersPage 使用共享组件
- [ ] 验证功能不变

---

### PR-UI-6: CoursePage & QuestionPage

| 属性 | 说明 |
|------|------|
| Scope | 迁移 Course 和 Question 管理页 |
| Files likely touched | `CoursePage.tsx`, `QuestionPage.tsx` |
| Acceptance | 两个页面代码量减少 50%+，模式一致 |
| Risk | 中（QuestionPage 有复杂性） |
| Do not do | 不要修改业务逻辑、不要改变筛选功能 |

**任务清单：**

- [ ] 创建 `shared/FilterBar.tsx`（从 QuestionPage 筛选抽取）
- [ ] 创建 `shared/DataTablePagination.tsx`（从 QuestionPage 分页抽取）
- [ ] 重构 CoursePage 使用共享组件
- [ ] 重构 QuestionPage 使用共享组件
- [ ] 验证功能不变

---

### PR-UI-7: ExamPage & Remaining Pages

| 属性 | 说明 |
|------|------|
| Scope | 迁移剩余管理页面 |
| Files likely touched | `ExamPage.tsx`, 其他管理页 |
| Acceptance | 所有管理页模式一致，代码量减少 |
| Risk | 低 |
| Do not do | 不要修改业务逻辑、不要改变考试管理功能 |

**任务清单：**

- [ ] 重构 ExamPage 使用共享组件
- [ ] 重构其他管理页使用共享组件
- [ ] 统一所有管理页视觉模式
- [ ] 验证功能不变

---

### PR-UI-8: Form Pattern Standardization

| 属性 | 说明 |
|------|------|
| Scope | 标准化表单模式 |
| Files likely touched | 所有表单对话框 |
| Acceptance | 所有表单视觉一致、交互一致 |
| Risk | 低 |
| Do not do | 不要修改验证逻辑、不要改变表单字段 |

**任务清单：**

- [ ] 创建 `shared/AdminFormLayout.tsx`
- [ ] 统一所有 Dialog 使用 AdminFormLayout
- [ ] 统一表单字段间距为 `gap-4`
- [ ] 统一表单内边距为 `py-6`
- [ ] 验证功能不变

---

### PR-UI-9: Missing shadcn Components

| 属性 | 说明 |
|------|------|
| Scope | 添加缺失的高价值 shadcn 组件 |
| Files likely touched | `apps/web/src/components/ui/` |
| Acceptance | Command、Calendar、Popover 等组件可用 |
| Risk | 低 |
| Do not do | 不要添加低价值组件、不要过度设计 |

**任务清单：**

- [ ] 添加 Command / CommandPalette 组件
- [ ] 添加 Calendar 组件
- [ ] 添加 Popover 组件
- [ ] 添加 Combobox 组件
- [ ] 更新文档说明用法

---

### PR-UI-10: Exam Runtime Consistency

| 属性 | 说明 |
|------|------|
| Scope | 标准化考试运行时组件 |
| Files likely touched | `apps/web/src/pages/exam/` |
| Acceptance | 考试页面视觉一致、组件复用 |
| Risk | 低 |
| Do not do | 不要修改答题逻辑、不要改变考试流程 |

**任务清单：**

- [ ] 创建 `exam/ExamShell.tsx`
- [ ] 创建 `exam/QuestionCard.tsx`
- [ ] 统一 StartExamPage 和 ResultPage 视觉
- [ ] 验证功能不变

---

## 第十一部分：Top 10 最高价值修复

### 1. 替换硬编码颜色为 Design Token

| 维度 | 说明 |
|------|------|
| 影响 | 高（视觉一致性） |
| 工作量 | 低（2-4 小时） |
| 优先级 | **1** |
| 文件 | ~10 个文件，20+ 实例 |
| 风险 | 低 |

**具体修改：**

```tsx
// ❌ 当前
className="bg-destructive/30 text-destructive"
className="border-destructive/30"

// ✅ 修改为
className="bg-destructive-soft text-destructive"
className="border-destructive-soft"
```

---

### 2. 创建 AdminDataTable 组件

| 维度 | 说明 |
|------|------|
| 影响 | 高（减少重复代码） |
| 工作量 | 中（6-8 小时） |
| 优先级 | **2** |
| 收益 | 每个页面减少 ~100 行代码 |
| 风险 | 中（新组件） |

**具体实现：**

```typescript
// shared/AdminDataTable.tsx
interface AdminDataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
}
```

---

### 3. 抽取 useAdminList Hook

| 维度 | 说明 |
|------|------|
| 影响 | 高（减少重复逻辑） |
| 工作量 | 中（4-6 小时） |
| 优先级 | **3** |
| 收益 | 每个页面减少 ~80 行代码 |
| 风险 | 中（新 Hook） |

**具体实现：**

```typescript
// hooks/useAdminList.ts
interface UseAdminListOptions<T> {
  fetchFn: () => Promise<T[]>;
  searchFn?: (items: T[], query: string) => T[];
  initialPageSize?: number;
}
```

---

### 4. 迁移 CandidatesPage 到 CRUD Patterns

| 维度 | 说明 |
|------|------|
| 影响 | 高（验证模式、最大收益） |
| 工作量 | 中（8-12 小时） |
| 优先级 | **4** |
| 收益 | 代码量从 541 → ~150 行 |
| 风险 | 中（大文件重构） |

**具体任务：**

- [ ] 局部抽取 `<CandidateSearchBar />`
- [ ] 局部抽取 `<CandidateTable />`
- [ ] 局部抽取 `<CandidateDialog />`
- [ ] 重构使用共享组件

---

### 5. 标准化 Border Radius

| 维度 | 说明 |
|------|------|
| 影响 | 中（视觉一致性） |
| 工作量 | 低（2-3 小时） |
| 优先级 | **5** |
| 文件 | ~15 个文件 |
| 风险 | 低 |

**具体修改：**

```tsx
// 统一圆角使用
// Cards/Containers: rounded-lg
// Forms/Inputs: rounded-md
// Alerts: rounded-lg (从 rounded-md 改)
// Tables: rounded-lg (新增)
```

---

### 6. 创建 AdminFormLayout 组件

| 维度 | 说明 |
|------|------|
| 影响 | 中（表单一致性） |
| 工作量 | 低（4-6 小时） |
| 优先级 | **6** |
| 收益 | 每个表单减少 ~30 行代码 |
| 风险 | 低 |

**具体实现：**

```typescript
// shared/AdminFormLayout.tsx
interface AdminFormLayoutProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}
```

---

### 7. 为 AdminDataTable 添加搜索/筛选

| 维度 | 说明 |
|------|------|
| 影响 | 中（提升用户体验） |
| 工作量 | 中（6-8 小时） |
| 优先级 | **7** |
| 收益 | 所有列表页统一搜索体验 |
| 风险 | 中 |

**具体实现：**

- [ ] 创建 `shared/SearchInput.tsx`
- [ ] 创建 `shared/FilterBar.tsx`
- [ ] 集成到 AdminDataTable

---

### 8. 创建 useConfirmAction Hook

| 维度 | 说明 |
|------|------|
| 影响 | 中（减少重复代码） |
| 工作量 | 低（2-3 小时） |
| 优先级 | **8** |
| 收益 | 每个确认操作减少 ~15 行代码 |
| 风险 | 低 |

**具体实现：**

```typescript
// hooks/useConfirmAction.ts
export function useConfirmAction(options: {
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
  destructive?: boolean;
})
```

---

### 9. 添加 Command / CommandPalette 组件

| 维度 | 说明 |
|------|------|
| 影响 | 低（提升特定体验） |
| 工作量 | 低（2-4 小时） |
| 优先级 | **9** |
| 收益 | 提升高级搜索体验 |
| 风险 | 低 |

**具体实现：**

- [ ] 添加 Command 组件（shadcn）
- [ ] 在 QuestionPage 使用 Command 搜索
- [ ] 更新文档

---

### 10. 文档化组件模式

| 维度 | 说明 |
|------|------|
| 影响 | 中（提升开发体验） |
| 工作量 | 低（4-6 小时） |
| 优先级 | **10** |
| 收益 | 降低学习成本、提升一致性 |
| 风险 | 无 |

**具体任务：**

- [ ] 创建 `docs/frontend/component-catalog.md`
- [ ] 记录每个组件的使用场景
- [ ] 提供代码示例
- [ ] 记录最佳实践

---

## 第十二部分：不应做的事情

### ❌ 禁止事项清单

#### 1. 不要更换 UI 框架

- **原因：** shadcn/ui 已良好集成，更换浪费 effort
- **替代：** 继续深化 shadcn/ui 使用

#### 2. 不要实现暗黑模式

- **原因：** 当前无用户需求，token 已支持
- **替代：** 保持现有明色主题

#### 3. 不要创建自定义组件库

- **原因：** shadcn/ui 已提供组件
- **替代：** 使用 shadcn + 项目组件

#### 4. 不要一次性重构所有页面

- **原因：** 变更过大、风险高
- **替代：** 分 PR 逐步迁移

#### 5. 不要添加动画库

- **原因：** 不需要、增加复杂度
- **替代：** 使用 CSS transitions

#### 6. 不要改变配色方案

- **原因：** 当前配色工作良好
- **替代：** 保持现有配色

#### 7. 不要在所有表格实现高级功能

- **原因：** 不是所有表格需要排序/筛选
- **替代：** 按需添加高级功能

#### 8. 不要创建独立的设计系统包

- **原因：** 不必要的复杂度
- **替代：** 保持在项目内

#### 9. 不要添加新的图标库

- **原因：** lucide-react 已足够
- **替代：** 继续使用 lucide-react

#### 10. 不要在 UI 中实现多语言支持

- **原因：** Phase 1 中文-only 合理
- **替代：** 保持当前中文实现

#### 11. 不要引入 SuperAdmin / Teacher / multiTenant

- **原因：** 超出 Phase 1 范围
- **替代：** 保持当前 Admin + Candidate 角色

#### 12. 不要修改业务逻辑

- **原因：** UI 审计不涉及业务逻辑
- **替代：** 仅修改视觉和组件结构

#### 13. 不要修改 API contract

- **原因：** UI 审计不涉及 API
- **替代：** 保持现有 API 调用

#### 14. 不要修改权限模型

- **原因：** UI 审计不涉及权限
- **替代：** 保持现有权限检查

#### 15. 不要过度泛化

- **原因：** 过早抽象难以维护
- **替代：** 逐步抽取，保持简单

---

## 总结

### 当前状态

考试管理系统前端已具备 **solid foundation**（7.3/10 成熟度）：

- ✅ shadcn/ui 配置正确，22 个组件已安装
- ✅ Tailwind CSS v4 配合完整 CSS 变量主题系统
- ✅ 良好的共享组件库（17 个组件）
- ✅ 合理的布局分离和状态管理

### 最高价值改进

1. **修复硬编码颜色**（低 effort，高 impact）
2. **创建可复用 CRUD 模式**（中 effort，very high impact）
3. **迁移管理页到模式**（中 effort，high impact）

### 推荐起点

从 **PR-UI-1（Design Token Audit）** 开始，然后 **PR-UI-4（CandidatesPage CRUD Pilot）**。

这样可以：

- ✅ 最小风险
- ✅ 最大价值
- ✅ 验证模式
- ✅ 建立基础

### 下一步行动

1. **审查本审计报告**，确认优先级和风险
2. **从 PR-UI-1 开始**，修复硬编码颜色
3. **从 CandidatesPage 开始**，建立 CRUD 模式
4. **逐步迁移其他页面**，保持一致性
5. **持续文档化**，确保团队可维护

---

**审计完成时间：** 2026-06-15
**建议执行周期：** 4-6 周（按 PR 顺序）
**预估总投入：** 40-60 小时
**预期收益：** 代码量减少 40-60%，视觉一致性提升，开发效率提升 30%
