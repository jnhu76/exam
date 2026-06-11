# Design Tokens

> 本文档定义项目的 CSS variables / Tailwind tokens 规则。所有 UI 实施必须遵守。

---

## 参考

- 视觉方向和完整调色板：`docs/ui/10-visual-direction.md`
- 审美审查标准：`docs/ui/11-aesthetic-review-rubric.md`
- UI 反模式：`docs/ui/12-ui-anti-patterns.md`

---

## 1. Token 架构

### 1.1 CSS Variables（定义在 index.css）

项目使用 TailwindCSS v4 的 `@theme inline` 语法定义 design tokens。所有颜色使用 oklch 色彩空间。

```css
@theme inline {
  --color-background: oklch(0.9857 0 0);
  --color-foreground: oklch(0.2 0 0);
  --color-card: oklch(1 0 0);
  --color-card-foreground: oklch(0.2 0 0);
  --color-popover: oklch(1 0 0);
  --color-popover-foreground: oklch(0.2 0 0);
  --color-primary: oklch(0.5 0.16 255);
  --color-primary-foreground: oklch(1 0 0);
  --color-secondary: oklch(0.9618 0 0);
  --color-secondary-foreground: oklch(0.2 0 0);
  --color-muted: oklch(0.9618 0 0);
  --color-muted-foreground: oklch(0.551 0 0);
  --color-accent: oklch(0.9618 0 0);
  --color-accent-foreground: oklch(0.2 0 0);
  --color-destructive: oklch(0.631 0.2081 25.3312);
  --color-destructive-foreground: oklch(1 0 0);
  --color-success: oklch(0.62 0.17 150);
  --color-success-foreground: oklch(1 0 0);
  --color-warning: oklch(0.78 0.14 75);
  --color-warning-foreground: oklch(0.2 0 0);
  --color-border: oklch(0.9235 0 0);
  --color-input: oklch(0.9235 0 0);
  --color-ring: oklch(0.5 0.16 255);
}
```

### 1.2 Token 层次

| 层次 | 用途 | 示例 |
|------|------|------|
| Semantic tokens | 语义化颜色 | `bg-primary`, `text-muted-foreground` |
| Status tokens | 状态颜色 | 通过 StatusBadge 组件消费 |
| Raw tokens | 原始颜色值 | 禁止在业务页面直接使用 |

---

## 2. 颜色规则

### 2.1 允许的用法

```tsx
// 使用语义化 token
<div className="bg-primary text-primary-foreground">
<div className="text-muted-foreground">
<div className="border-border">

// 使用 StatusBadge 组件
<StatusBadge status="graded" />
<StatusBadge status="disrupted" />
<StatusBadge status="submitted" />
```

### 2.2 禁止的用法

```tsx
// 禁止直接使用原始颜色
<div className="bg-green-500 text-white">
<div className="text-red-600">
<div className="border-blue-400">
<div className="bg-yellow-100">
<div className="text-emerald-600">
<div className="bg-amber-100">
```

### 2.3 状态颜色集中管理

所有状态的 label / color / icon / tone **不能散落在页面里**，必须集中到 `statusMeta` 或等价结构。

推荐实现方式：

```ts
// statusMeta 集中定义
export const statusMeta = {
  draft: { label: "草稿", color: "muted", icon: "FileEdit" },
  published: { label: "已发布", color: "primary", icon: "Globe" },
  open: { label: "开放中", color: "success", icon: "LockOpen" },
  closed: { label: "已关闭", color: "secondary", icon: "Lock" },
  // ...
} as const;
```

---

## 3. 字体规则

### 3.1 字体栈

```css
body {
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif;
}
```

### 3.2 字体大小

| Token | 用途 | Tailwind class |
|-------|------|----------------|
| xs | 辅助文字 | `text-xs` |
| sm | 正文/标签 | `text-sm` |
| base | 正文 | `text-base` |
| lg | 小标题 | `text-lg` |
| xl | 标题 | `text-xl` |
| 2xl | 页面标题 | `text-2xl` |

### 3.3 字重

| Token | 用途 | Tailwind class |
|-------|------|----------------|
| normal | 正文 | `font-normal` |
| medium | 强调 | `font-medium` |
| semibold | 标题 | `font-semibold` |
| bold | 重要标题 | `font-bold` |

---

## 4. 间距规则

### 4.1 基础间距

| Token | 值 | Tailwind class |
|-------|-----|----------------|
| 1 | 0.25rem | `p-1`, `gap-1`, `m-1` |
| 2 | 0.5rem | `p-2`, `gap-2`, `m-2` |
| 3 | 0.75rem | `p-3`, `gap-3`, `m-3` |
| 4 | 1rem | `p-4`, `gap-4`, `m-4` |
| 6 | 1.5rem | `p-6`, `gap-6`, `m-6` |
| 8 | 2rem | `p-8`, `gap-8`, `m-8` |

### 4.2 页面间距

| 区域 | 间距 | Tailwind class |
|------|------|----------------|
| 页面内边距 | 1.5rem | `p-6` |
| 区块间距 | 1rem | `gap-4` |
| 表单字段间距 | 0.75rem | `gap-3` |

---

## 5. 圆角规则

| Token | 值 | Tailwind class | 用途 |
|-------|-----|----------------|------|
| sm | 0.25rem | `rounded-sm` | 小元素 |
| md | 0.375rem | `rounded-md` | 按钮、输入框、卡片 |
| lg | 0.5rem | `rounded-lg` | 大卡片、对话框 |
| full | 9999px | `rounded-full` | 头像、圆形按钮 |

---

## 6. 阴影规则

| Token | Tailwind class | 用途 |
|-------|----------------|------|
| xs | `shadow-xs` | 按钮、输入框 |
| sm | `shadow-sm` | 卡片、下拉菜单 |
| md | `shadow-md` | 对话框、弹出层 |
| lg | `shadow-lg` | 模态框 |

---

## 7. shadcn/ui 配置

### 7.1 components.json

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

### 7.2 使用规则

- 新增 shadcn/ui 组件使用 `npx shadcn@latest add <component-name>`
- 不要手动修改 `components/ui/` 下的文件
- 所有 shadcn/ui 组件使用项目定义的 CSS variables
- 颜色通过 `className` 传递，如 `className="bg-primary"`

---

## 8. cn() 工具函数

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### 8.1 使用规则

- 所有 className 合并必须使用 `cn()` 函数
- 不要直接拼接字符串
- 不要用模板字符串拼接 className

### 8.2 示例

```tsx
// 正确
<div className={cn("flex items-center", isActive && "bg-primary")}>

// 错误
<div className={`flex items-center ${isActive ? "bg-primary" : ""}`}>
```

---

## 9. 动画规则

### 9.1 允许的动画

- 过渡动画：`transition-all`, `transition-colors`, `transition-opacity`
- 聚焦动画：`focus-visible:ring-3`
- 悬停动画：`hover:bg-accent`

### 9.2 禁止的动画

- 禁止引入动画库（如 framer-motion、react-spring）
- 禁止写复杂 CSS 动画
- 禁止做全屏动画效果

### 9.3 过渡时间

| Token | Tailwind class | 用途 |
|-------|----------------|------|
| fast | `duration-150` | 悬停、聚焦 |
| normal | `duration-200` | 普通过渡 |
| slow | `duration-300` | 页面切换 |

---

## 10. 响应式规则

### 10.1 断点

| 断点 | Tailwind class | 用途 |
|------|----------------|------|
| sm | `sm:` | 小屏幕（手机横屏） |
| md | `md:` | 中屏幕（平板） |
| lg | `lg:` | 大屏幕（桌面） |
| xl | `xl:` | 超大屏幕（宽屏） |

### 10.2 最小宽度

- 页面最小宽度：`min-w-0`（防止 flex 子元素溢出）
- Sidebar 最小宽度：`w-14`（collapsed）/ `w-56`（expanded）
- 内容区域最小宽度：`min-w-0 flex-1`
