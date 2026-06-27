# Wegent 本地差异审计

> **基于**：本地 Wegent 源码 (`/home/hoo/Source/_refs/wegent/frontend/`) vs 当前项目代码
> **最后更新**：2026-06-27

---

## 0.1 Token 对照

| 领域 | 当前项目 | Wegent 本地源码 | 决策 |
|------|----------|-----------------|------|
| **page background** | `#f7f8fb` (`--bg`) | `255 255 255` (`--color-bg-base`) | adopt/wegent |
| **surface background** | `#ffffff` (`--surface`) | `249 249 249` (`--color-bg-surface`) | adopt/wegent |
| **muted background** | `#f9fafb` (`--surface-muted`) | `243 244 246` (`--color-bg-muted`) | adopt/wegent |
| **hover** | `--primary-soft` (#eff6ff) | `93 94 201 / 0.06` (purple 6%) | adopt/wegent |
| **border** | `#e5e7eb` (`--border`) | `228 228 228` (`--color-border`) | adopt/wegent |
| **border-strong** | `#d1d5db` (`--border-strong`) | `200 200 200` (`--color-border-strong`) | adopt/wegent |
| **primary (light)** | `#2563eb` (blue) | `93 94 201` (purple `#5D5EC9`) | adopt/wegent |
| **primary (dark)** | `#2992ff` (blue) | `118 119 218` (brighter purple) | adopt/wegent |
| **success** | `#047857` | `34 197 94` (`#22c55e`) | adopt/wegent |
| **error** | `#b42318` | `239 68 68` (`#ef4444`) | adopt/wegent |
| **warning** | `#b54708` | `245 158 11` (orange-500) | adopt/wegent |
| **text primary** | `#111827` | `51 51 51` (`#333333`) | adopt/wegent |
| **text secondary** | `#6b7280` | `99 99 99` (`#636363`) | adopt/wegent |
| **text muted** | `#9ca3af` | `147 147 147` (`#939393`) | adopt/wegent |
| **radius** | `0.5rem` (8px) | `0.5rem` (8px) | keep/current ✅ |
| **shadow** | `0 1px 3px` (card) | `shadow-md` (card) | adopt/wegent |
| **focus ring** | `var(--primary)` | `93 94 201` (purple) | adopt/wegent |
| **dark: page** | `#000000` | `14 15 15` (`#0e0f0f`) | adopt/wegent |
| **dark: surface** | `#1d1e1f` | `26 28 28` (`#1a1c1c`) | adopt/wegent |
| **dark: muted** | `#262626` | `33 36 36` (`#212424`) | adopt/wegent |
| **dark: border** | `#414243` | `42 45 45` (`#2a2d2d`) | adopt/wegent |

---

## 0.2 基础组件对照

| 组件 | 当前项目文件 | Wegent 参考文件 | 关键差异 | 迁移级别 |
|------|-------------|-----------------|----------|----------|
| **Button** | `ui/button.tsx` | `ui/button.tsx` | default=solid primary vs transparent+border; sizes h-9/h-10 vs h-10; ring-offset | Level 1 |
| **Card** | `ui/card.tsx` | `ui/card.tsx` | rounded-xl vs rounded-lg; bg-card vs bg-surface; no variant system vs 3 variants; padding system | Level 1 |
| **Input** | `ui/input.tsx` | `ui/input.tsx` | h-9 rounded-md vs h-10 rounded-lg; bg-transparent vs bg-surface; ring-offset-base vs ring-offset-background | Level 1 |
| **Badge** | `ui/badge.tsx` | `ui/badge.tsx` | variants: default/secondary/destructive/outline vs default/success/error/warning/info/secondary; size system | Level 1 |
| **Tabs** | `ui/tabs.tsx` | `ui/tabs.tsx` | bg-card border-admin-border vs bg-surface; active: bg-primary-soft vs bg-base shadow; custom variant vs no variant | Level 1 |
| **Dialog** | `ui/dialog.tsx` | `ui/dialog.tsx` | bg-background vs bg-base; rounded-lg vs sm:rounded-lg; overlay bg-black/50 vs bg-black/80; slide animations | Level 1 |
| **Dropdown** | `ui/dropdown-menu.tsx` | (不存在) | 当前项目有，Wegent 没有 | keep/current |
| **Tooltip** | `ui/tooltip.tsx` | `ui/tooltip.tsx` | bg-foreground text-background vs bg-tooltip text-tooltip-foreground; no border vs border-border; no shadow vs shadow-md | Level 1 |
| **Textarea** | `ui/textarea.tsx` | `ui/textarea.tsx` | min-h-16 rounded-md vs min-h-[80px] rounded-lg; bg-transparent vs bg-surface; field-sizing-content | Level 1 |
| **Select** | `ui/select.tsx` | `ui/select.tsx` | rounded-md vs rounded-lg; bg-transparent vs bg-transparent (same); content rounded-md vs rounded-xl | Level 1 |

---

## 0.3 Admin pattern 对照

| 当前项目组件 | Wegent 可参考 pattern | 是否迁移 | 说明 |
|-------------|----------------------|----------|------|
| AdminShell | layout shell (features/layout/) | yes | 学习 padding/gap rhythm |
| AdminShellHeader | header pattern | yes | 学习 title/description/actions spacing |
| AdminPageCard | card/panel | yes | 改用 bg-surface rounded-lg |
| AdminSearchPanel | search panel | yes | 改用 bg-muted rounded-lg |
| AdminTableShell | table container | yes | 改用 bg-surface rounded-lg |
| MetricCard | dashboard stat card | yes | 学习 icon bg + value layout |
| AdminStatusTag | tag/badge | yes | 改用 Wegent tag 样式 (rounded-md) |
| AdminToolbarButton | action button | yes | 改用 Wegent button variants |
| AdminIconButton | icon button | yes | 改用 Wegent ghost button |

---

## 0.4 禁止迁移列表

| Wegent 文件/目录 | 原因 |
|------------------|------|
| `features/layout/*` | 业务布局（路由/状态管理/权限） |
| `features/tasks/*` | 业务模块 |
| `features/knowledge/*` | 业务模块 |
| `features/settings/*` | 业务模块 |
| `features/theme/*` | 业务主题配置（含 pet/onboarding） |
| `contexts/*` | 业务状态管理 |
| `hooks/*` (业务) | 业务 hooks |
| `i18n/*` | 业务文案 |
| `app/**` | 业务路由和页面 |
| `public/fonts/*` | 品牌字体（需 license 确认） |
| wework/ 子应用 | 独立应用，不同主色 |
