# Visual Direction

> 本文档定义项目的视觉方向。所有 UI 实施必须遵守。

---

## 1. 设计系统名称

**Exam Ops UI System**

---

## 2. Design Read

Reading this as:

> a trust-first, operation-grade LAN exam platform
> for admins, teachers, proctors, and candidates
> with a calm enterprise-console language
> leaning toward shadcn/ui + Tailwind v4 + semantic tokens

---

## 3. 视觉论点

```
Quiet control console for administrators.
Focused, resilient exam surface for candidates.
Status clarity over decoration.
```

这不是营销网站、作品集、AI landing page 或视觉实验。

这是一个**可靠、冷静、结构化、可读、状态清晰、低噪声、操作级、考试聚焦**的产品。

---

## 4. 基础配置

| 属性 | 值 |
|------|-----|
| Base | Slate Neutral |
| Primary | Exam Blue |
| Status | Fixed semantic status colors |
| Typography | system CJK-first sans stack |
| Icons | lucide-react only |
| Motion | minimal and functional |
| Depth | border-first, shadow-light |
| Density | admin medium-density, exam runtime high-readability |
| Dark mode | deferred |

---

## 5. 颜色系统

### 5.1 默认调色板

```txt
background: #F8FAFC
foreground: #0F172A
card: #FFFFFF
card-foreground: #0F172A
muted: #F1F5F9
muted-foreground: #64748B
border: #E2E8F0
input: #CBD5E1
ring: #2563EB

primary: #2563EB
primary-foreground: #FFFFFF
primary-soft: #DBEAFE
primary-soft-foreground: #1E40AF

success: #047857
success-soft: #D1FAE5
info: #0369A1
info-soft: #E0F2FE
warning: #B45309
warning-soft: #FEF3C7
destructive: #DC2626
destructive-soft: #FEE2E2
neutral: #64748B
neutral-soft: #F1F5F9
```

### 5.2 颜色语义

| 颜色 | 含义 | 用途 |
|------|------|------|
| blue | primary action / active / current / informational | 按钮、链接、导航 active |
| green | success / saved / submitted / passed | 成功状态、保存成功、已提交、已通过 |
| amber | warning / recoverable abnormal state / expiring | 警告、断线、保存中、即将过期 |
| red | failure / destructive / irreversible | 失败、危险操作、不可逆 |
| gray | inactive / draft / closed / unknown | 禁用、草稿、已关闭、未知 |

### 5.3 颜色规则

- 状态颜色不能在每个页面重新定义
- 机构品牌不能改变状态颜色
- primary 颜色不能用作 success 颜色
- success 颜色不能用于导航
- warning 颜色不能用于装饰
- destructive 颜色必须保留给失败或不可逆操作

### 5.4 禁止的用法

```txt
AI-purple gradients
large decorative gradients
random saturated cards
warm luxury beige/cream as default
page-specific palettes
mixed warm/cool neutrals
bg-green-500 / text-red-600 / border-blue-400
```

---

## 6. 字体系统

### 6.1 字体栈

不使用外部 CDN 字体。使用系统 CJK-first 字体栈：

```css
--font-sans:
  ui-sans-serif,
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  "PingFang SC",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  "Noto Sans CJK SC",
  "Source Han Sans SC",
  Arial,
  sans-serif;

--font-mono:
  ui-monospace,
  SFMono-Regular,
  Menlo,
  Monaco,
  Consolas,
  "Liberation Mono",
  "Courier New",
  monospace;
```

### 6.2 字体角色

| 角色 | 大小 | 行高 | 字重 |
|------|------|------|------|
| page-title | 24px | 32px | 600 |
| section-title | 16px | 24px | 600 |
| card-title | 15px | 22px | 600 |
| body | 14px | 20px | 400 |
| body-large | 16px | 26px | 400 |
| exam-question | 17px or 18px | 28px or 30px | 400-500 |
| meta | 13px | 18px | 400 |
| code-or-log | mono | 12px or 13px | 400 |
| timer | tabular numbers | - | - |

### 6.3 字体规则

- Admin Console 可以是 medium-density
- Exam Runtime 必须更可读、更低密度
- Timer、scores、counts、attempt numbers 必须使用 tabular numbers
- 不要随机使用 text-xs/text-lg 而不指定角色
- 不要让重要正文变灰色
- 不要使用 serif 字体，除非明确批准

---

## 7. 图标系统

### 7.1 图标库

使用 `lucide-react` only。

### 7.2 图标规则

```txt
one icon family per project
default style: outline stroke icon
default strokeWidth: 2
sidebar nav icon: 18px
button icon: 16px
table action icon: 16px
status icon: 14-16px
empty state icon: 32-40px
icons inherit currentColor
no random icon colors
no mixed icon libraries
no emoji as status icons
decorative icons use aria-hidden
icon-only buttons require aria-label
```

### 7.3 BrandMark 和 SidebarCollapseButton

BrandMark 和 SidebarCollapseButton 必须是独立组件。

collapse icon 不能占据 logo slot。

---

## 8. 动画规则

### 8.1 动画必须是最小且功能性的

允许的动画：

```txt
short hover transition
focus ring transition
sidebar width transition
dropdown/dialog enter-exit transition
loading skeleton shimmer only if subtle
```

禁止的动画：

```txt
cinematic animation
looping attention animation
decorative page motion
large scroll effects
glow used as sophistication
everything floating with shadows
引入动画库（如 framer-motion、react-spring）
复杂 CSS 动画
全屏动画效果
```

### 8.2 过渡时间

| Token | Tailwind class | 用途 |
|-------|----------------|------|
| fast | `duration-150` | 悬停、聚焦 |
| normal | `duration-200` | 普通过渡 |
| slow | `duration-300` | 页面切换 |

---

## 9. 深度规则

### 9.1 深度必须来自边框和背景表面

- 使用 borders and background surfaces first
- 使用 shadow only for overlay, dropdown, dialog, or meaningful elevation
- 不要给每张卡片添加 shadow
- 不要使用 blur/glow 作为默认 premium 信号

### 9.2 Shadow 使用

| Token | Tailwind class | 用途 |
|-------|----------------|------|
| xs | `shadow-xs` | 按钮、输入框 |
| sm | `shadow-sm` | 卡片、下拉菜单 |
| md | `shadow-md` | 对话框、弹出层 |
| lg | `shadow-lg` | 模态框 |

---

## 10. 密度规则

### 10.1 Admin Console

- medium-density
- 适合管理后台
- 信息密度适中

### 10.2 Exam Runtime

- high-readability
- 适合考试答题
- 更可读、更低密度

### 10.3 间距节奏

| 区域 | 间距 | Tailwind class |
|------|------|----------------|
| 页面内边距 | 1.5rem | `p-6` |
| 区块间距 | 1rem | `gap-4` |
| 表单字段间距 | 0.75rem | `gap-3` |

---

## 11. 自我检查

在最终输出前检查：

- 是否在用户请求的范围内？
- 首次阅读是否在 3 秒内清晰？
- 布局是否在没有渐变和阴影的情况下仍然可信和平衡？
- 中性色是否足够冷静，让强调色有意义？
- 默认状态是否足够安静，为 focus、active、error 状态留出空间？
- 组件是否看起来相关但权重不同？
- 阴影和高光是否描述深度而不是制造模糊？
- 动画时间是否受控且简短？
- 动画是否强化交互逻辑而不是变成编舞？
- 布局是否平衡而不是追求注意力？
- 移动端是否保留相同的主要信息或操作？
- 升级是否移除了噪声而不是添加了更多样式？
