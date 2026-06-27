# Wegent 样式主权文档

> **权威来源**：`/home/hoo/Source/_refs/wegent/frontend/`
> **最后更新**：2026-06-27
> **原则**：Wegent-style token 是唯一视觉来源。Koi-derived 组件只能使用项目 token。

---

## 1. Token 体系

### 1.1 颜色 Token（RGB triplet 格式）

项目使用 space-separated RGB triplet（无逗号），支持 alpha blending：

```css
rgb(var(--token) / <alpha-value>)
```

#### Light Theme (`:root`)

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-bg-base` | `255 255 255` | 页面背景 |
| `--color-bg-surface` | `249 249 249` | 卡片/面板背景 |
| `--color-bg-muted` | `243 244 246` | 弱背景（搜索面板/表头） |
| `--color-bg-hover` | `93 94 201 / 0.06` | hover 状态（紫色 6%） |
| `--color-border` | `228 228 228` | 默认边框 |
| `--color-border-strong` | `200 200 200` | 强边框 |
| `--color-border-light` | `243 244 246` | 弱边框 |
| `--color-text-primary` | `51 51 51` | 主文字 |
| `--color-text-secondary` | `99 99 99` | 次级文字 |
| `--color-text-muted` | `147 147 147` | 弱文字 |
| `--color-text-inverted` | `255 255 255` | 反色文字 |
| `--color-primary` | `93 94 201` | 主色（紫色） |
| `--color-primary-contrast` | `255 255 255` | 主色上的文字 |
| `--color-focus-ring` | `93 94 201` | 焦点环 |
| `--color-success` | `34 197 94` | 成功 |
| `--color-error` | `239 68 68` | 错误 |
| `--color-warning` | `245 158 11` | 警告 |
| `--color-link` | `93 94 201` | 链接 |

#### Dark Theme (`[data-theme='dark']`)

| Token | 值 |
|-------|-----|
| `--color-bg-base` | `14 15 15` |
| `--color-bg-surface` | `26 28 28` |
| `--color-bg-muted` | `33 36 36` |
| `--color-bg-hover` | `118 119 218 / 0.1` |
| `--color-border` | `42 45 45` |
| `--color-text-primary` | `212 212 212` |
| `--color-primary` | `118 119 218` |

### 1.2 圆角 Token

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius` | `0.5rem` (8px) | 基础圆角 |
| `rounded-lg` | `var(--radius)` | 按钮/卡片/输入/对话框 |
| `rounded-md` | `calc(var(--radius) - 2px)` = 6px | Toast/Tabs/Select items |
| `rounded-sm` | `calc(var(--radius) - 4px)` = 4px | Checkbox |
| `rounded-full` | 9999px | Badge/Switch/Spinner |

### 1.3 阴影 Token

| Token | 值 | 用途 |
|-------|-----|------|
| `--shadow-popover` | `0 12px 32px rgba(93,94,201,0.12)` | Popover（紫色调） |
| `--shadow-sidebar` | `0 4px 30px rgba(93,94,201,0.1)` | Sidebar（紫色调） |
| `shadow-md` | Tailwind 默认 | Dialog/Elevated card |
| `shadow-lg` | Tailwind 默认 | Select/Dropdown/Tooltip |

### 1.4 间距模式

| 场景 | 值 |
|------|-----|
| 页面内边距 | `p-4` ~ `p-6` |
| 卡片内边距 | `p-3` (sm) / `p-4` (default) / `p-6` (lg) |
| 表格单元格 | `p-4` (cell) / `px-6` (head) |
| 输入框 | `px-4 py-3` |
| 按钮 | `px-4 py-2` (default) / `px-3` (sm) / `px-8` (lg) |
| 表单项间距 | `space-y-2` 或 `gap-2` |
| 区块间距 | `gap-4` |
| 行内间距 | `gap-1` / `gap-2` |

---

## 2. 组件规范

### 2.1 Button

```
Variants: default | primary | secondary | outline | ghost | link | destructive
Sizes: default (h-10) | sm (h-9) | lg (h-11) | icon (h-10 w-10)
Base: rounded-lg text-sm font-medium ring-offset-base focus-visible:ring-2 focus-visible:ring-primary
```

### 2.2 Card

```
Variants: default (border-border) | elevated (shadow-md) | ghost (border-transparent)
Base: rounded-lg border bg-surface text-text-primary
Sub: CardHeader, CardTitle (text-base font-semibold), CardContent, CardFooter
```

### 2.3 Table

```
Base: w-full text-sm
Header: h-10 px-6 font-medium text-text-muted, border-b
Row: border-b hover:bg-surface-hover/50
Cell: p-4
```

### 2.4 Input

```
Base: h-10 rounded-lg border border-border bg-surface px-4 py-3 text-sm
Focus: ring-2 ring-inset ring-primary
```

### 2.5 Badge

```
Variants: default (bg-primary) | success | error | warning | info | secondary
Base: rounded-full text-xs font-medium
Sizes: default (h-5 px-2) | sm (h-4) | lg (h-6)
```

### 2.6 Tabs

```
List: h-9 rounded-lg bg-surface p-1 text-text-muted
Trigger: rounded-md px-3 py-1 text-sm font-medium
Active: bg-base text-text-primary shadow
Inactive: text-text-secondary hover:text-text-primary
```

### 2.7 Tag

```
Base: inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium
Variants: default (bg-surface) | success/error/warning/info (10% bg, 20% border)
```

---

## 3. 禁止规则

### 3.1 禁止在业务页面直接 import Koi 组件

```tsx
// ❌ 禁止
import { KoiCard } from "@/components/koi";
import { KoiSearch } from "@/components/koi";

// ✅ 正确
import { AdminPageCard } from "@/components/admin";
import { AdminSearchPanel } from "@/components/admin";
```

### 3.2 禁止使用 raw Koi 颜色/阴影/圆角

```tsx
// ❌ 禁止
className="bg-#141414"           // Koi 暗色
className="shadow-[0_4px_16px]"  // Koi 阴影
style={{ borderRadius: "8px" }}   // Koi 圆角

// ✅ 正确
className="bg-surface"           // Wegent token
className="shadow-md"            // Wegent shadow
className="rounded-lg"           // Wegent radius
```

### 3.3 禁止新增 hard-coded 颜色

```tsx
// ❌ 禁止
className="text-gray-500"
className="bg-blue-100"
className="border-red-300"

// ✅ 正确
className="text-text-muted"
className="bg-primary/10"
className="border-error/30"
```

---

## 4. 组件层级

```
src/components/
├── ui/              # shadcn/ui primitive（底层）
├── admin/           # Admin pattern（中间层，Koi-derived 改 token）
├── shared/          # 共享业务组件
├── layout/          # 布局组件
├── settings/        # 设置相关
├── exam/            # 考试运行时
├── question/        # 题目相关
└── notification/    # 通知
```

业务页面导入顺序：
1. `@/components/ui` — shadcn primitive
2. `@/components/admin` — admin pattern
3. `@/components/shared` — 共享组件
4. `@/components/layout` — 布局
5. `@/lib/*` — 工具函数
