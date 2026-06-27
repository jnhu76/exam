# Koi → Wegent Token 映射表

> **用途**：将 Koi-derived 组件中的 Koi 颜色/阴影/圆角替换为 Wegent token
> **格式**：Koi 值 → Wegent CSS 变量 → Tailwind 类

---

## 1. 颜色映射

### 1.1 背景色

| Koi 原始 | 值 (Light) | Wegent Token | Tailwind 类 |
|----------|-----------|--------------|-------------|
| 页面背景 `#f7f8fb` | 浅灰 | `--color-bg-base` | `bg-base` |
| 卡片背景 `#ffffff` | 白色 | `--color-bg-surface` | `bg-surface` |
| 搜索面板 `#f3f4f6` | 灰色 | `--color-bg-muted` | `bg-muted` |
| 表头背景 `#f9fafb` | 浅灰 | `--color-bg-muted` | `bg-muted` |
| hover `primary-light-9` | 紫色 6% | `--color-bg-hover` | `bg-hover` |
| 暗色卡片 `#1D1E1F` | 深灰 | `--color-bg-surface` | `bg-surface` (dark) |
| 暗色搜索 `#262626` | 深灰 | `--color-bg-muted` | `bg-muted` (dark) |
| 暗色页面 `#000000` | 黑色 | `--color-bg-base` | `bg-base` (dark) |

### 1.2 文字色

| Koi 原始 | 值 (Light) | Wegent Token | Tailwind 类 |
|----------|-----------|--------------|-------------|
| 主文字 `#303133` / `#111827` | 近黑 | `--color-text-primary` | `text-text-primary` |
| 次级文字 `#606266` / `#6b7280` | 中灰 | `--color-text-secondary` | `text-text-secondary` |
| 弱文字 `#9ca3af` | 浅灰 | `--color-text-muted` | `text-text-muted` |
| 暗色主文字 `#CFD3DC` | 浅色 | `--color-text-primary` | `text-text-primary` (dark) |
| 暗色次级 `#A3A6AD` | 中灰 | `--color-text-secondary` | `text-text-secondary` (dark) |

### 1.3 边框色

| Koi 原始 | 值 (Light) | Wegent Token | Tailwind 类 |
|----------|-----------|--------------|-------------|
| 默认边框 `#e5e7eb` | 灰色 | `--color-border` | `border-border` |
| 强边框 `#d1d5db` | 深灰 | `--color-border-strong` | `border-border-strong` |
| 弱边框 `#f0f1f3` | 浅灰 | `--color-border-light` | `border-border-light` |
| 暗色边框 `#414243` | 深灰 | `--color-border` | `border-border` (dark) |

### 1.4 主色

| Koi 原始 | 值 | Wegent Token | Tailwind 类 |
|----------|-----|--------------|-------------|
| primary `#2563eb` | 蓝色 | `--color-primary` | `bg-primary` / `text-primary` |
| primary-soft `#eff6ff` | 浅蓝 | `--color-primary / 0.1` | `bg-primary/10` |
| primary-hover `#1d4ed8` | 深蓝 | `--color-primary / 0.9` | `bg-primary/90` |
| **Wegent primary** | **`#5D5EC9` 紫色** | `--color-primary` | `bg-primary` |

> **注意**：Wegent 主色是紫色 `#5D5EC9`，不是蓝色。当前项目使用蓝色 `#2563eb`，需要统一。

### 1.5 语义色

| Koi 原始 | 值 | Wegent Token | Tailwind 类 |
|----------|-----|--------------|-------------|
| success `#047857` | 绿色 | `--color-success` | `bg-success` |
| success-soft `#ecfdf5` | 浅绿 | `--color-success / 0.1` | `bg-success/10` |
| danger `#b42318` | 红色 | `--color-error` | `bg-error` |
| danger-soft `#fef3f2` | 浅红 | `--color-error / 0.1` | `bg-error/10` |
| warning `#b54708` | 橙色 | `--color-warning` | `bg-warning` |
| warning-soft `#fffbeb` | 浅橙 | `--color-warning / 0.1` | `bg-warning/10` |
| info `#175cd3` | 蓝色 | `--color-primary` | `bg-primary` |

---

## 2. 圆角映射

| Koi 原始 | 值 | Wegent Token | Tailwind 类 |
|----------|-----|--------------|-------------|
| `--admin-radius` | 8px | `--radius` | `rounded-lg` |
| `--admin-radius-sm` | 6px | `calc(--radius - 2px)` | `rounded-md` |
| Tags `rounded-[4px]` | 4px | `calc(--radius - 4px)` | `rounded-sm` |
| Badges `rounded-full` | 9999px | — | `rounded-full` |

---

## 3. 阴影映射

| Koi 原始 | 值 | Wegent Token | Tailwind 类 |
|----------|-----|--------------|-------------|
| `--admin-shadow-card` | `0 1px 3px rgb(0 0 0 / 0.04)` | — | `shadow-sm` |
| `--admin-shadow-search` | `0 1px 2px rgb(0 0 0 / 0.03)` | — | `shadow-none` (hairline) |
| Popover `0 4px 16px` | 黑色 | `--shadow-popover` | `shadow-popover` |
| Sidebar | — | `--shadow-sidebar` | `shadow-sidebar` |

---

## 4. 字号映射

| Koi 用法 | Wegent 标准 |
|----------|-------------|
| `text-[11px]` (tag) | `text-xs` (12px) |
| `text-[13px]` (label) | `text-sm` (14px) |
| `text-sm` (body) | `text-sm` (14px) ✅ |
| `text-base` (card title) | `text-base` (16px) ✅ |
| `text-lg` (page title) | `text-lg` (18px) ✅ |
| `text-xl` (metric value) | `text-lg` (18px) 或 `text-xl` (20px) |

---

## 5. 间距映射

| Koi 用法 | Wegent 标准 |
|----------|-------------|
| `gap-3` (紧凑) | `gap-2` 或 `gap-3` |
| `gap-4` (默认) | `gap-4` ✅ |
| `gap-5` (宽松) | `gap-4` 或 `gap-6` |
| `gap-6` (区块) | `gap-4` 或 `gap-6` |
| `p-4` (卡片) | `p-4` ✅ |
| `p-5` (页面) | `p-4` 或 `p-6` |
| `space-y-*` | `gap-*` (flex) 或 `space-y-*` (block) |

---

## 6. 迁移检查清单

每个 Koi-derived 组件迁移时，逐项核对：

- [ ] 背景色：`bg-card` → `bg-surface`，`bg-admin-search` → `bg-muted`
- [ ] 边框色：`border-admin-border` → `border-border`
- [ ] 文字色：`text-muted-foreground` → `text-text-muted`
- [ ] 圆角：`rounded-[var(--admin-radius)]` → `rounded-lg`
- [ ] 阴影：`shadow-admin-card` → `shadow-sm` 或 `shadow-none`
- [ ] 主色：确认使用 Wegent purple `#5D5EC9`
- [ ] 间距：`gap-*` 统一，无 `space-*`
- [ ] 字号：`text-[11px]` → `text-xs`，`text-[13px]` → `text-sm`
