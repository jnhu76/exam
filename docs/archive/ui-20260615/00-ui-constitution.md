# UI 宪法

> 本文档定义 Phase1.4 UI Foundation Reset 的不变原则。所有后续 UI 实施必须遵守。

---

## 1. 本次 Reset 的目标

Phase1.4 UI Foundation Reset **不是美化任务**，是**基础设施稳定化任务**。

目标是解决以下真实问题：

1. title 一直显示"加载中"
2. 页面直接刷新后出现空白页
3. nav 折叠行为混乱
4. logo 区域和 sidebar collapse icon 混用
5. 没有稳定的 BrandMark / logo fallback
6. SVG / icon 使用混乱
7. CSS / Tailwind class 写得分散、随意、不成体系
8. shadcn/ui primitive 和项目级组件边界不清楚
9. Admin Console 和 Exam Runtime 没有明确布局边界

**完成标志**：以上问题全部解决，UI 基础设施可支撑后续页面开发。

---

## 2. 不变原则

### 2.1 不是美化

- 本次 Reset 不做视觉 beautification
- 不引入新设计风格
- 不做全站重写
- 不引入图表库、动画库

### 2.2 不是 Phase2

- 本次 Reset 不实现任何 Phase2 功能
- Phase2 只能在 Phase1.4 + Phase1.5 + Phase1.6 + Phase1.7 入口条件完成后开始
- 文档中出现 Phase2 模板只是**文档准备**，不是实施

### 2.3 不写死学校语义

- 不能写死"学生"、"学号"、"班级"、"院系"、"校园"、"教务"
- 不能写死 "University"、"Campus"、"Student"
- 考生身份由各机构自定义，代码中使用通用语义：考生、候选人、身份字段、组织、部门

### 2.4 不能随意写 CSS

- 不能在业务页面直接写 `bg-green-500`、`text-red-600`、`border-blue-400`
- 状态颜色必须通过 StatusBadge 等统一组件消费
- 所有颜色必须使用 CSS variables / Tailwind tokens

### 2.5 不能污染 shadcn/ui

- `components/ui/` 只能放 shadcn/ui primitives
- 不能把业务组件（ExamCard、TaskStatusPanel 等）放进 `components/ui/`
- 业务组件放 `components/shared/`

### 2.6 状态必须统一

- 所有 loading / error / empty / status 必须使用统一组件
- 状态 label / color / icon / tone 不能散落在页面里
- 必须集中到 statusMeta 或等价结构

---

## 3. 布局边界

### 3.1 Admin Console

- 使用 AdminShell（AppSidebar + AppTopbar + PageContainer）
- Sidebar 是导航入口，logo 和 collapse 是独立 slot
- 不同角色看到不同菜单项

### 3.2 Exam Runtime

- 使用 ExamShell（ExamTopbar + 考试区域）
- **不能强行套 Admin Sidebar**
- Exam Runtime 是沉浸式考试环境，不是管理后台

### 3.3 品牌标识

- BrandMark 是独立 slot，不是 collapse button 的伪装
- collapsed sidebar 显示 BrandMark，不显示 collapse icon 伪装成 logo
- BrandMark 有稳定的 fallback（当远程加载失败时）

---

## 4. 组件边界

### 4.1 四层结构

| 目录 | 职责 | 允许内容 |
|------|------|----------|
| `components/ui/` | shadcn/ui primitives | button, card, dialog, input, table, tabs, badge, dropdown-menu 等 |
| `components/shared/` | 项目级可复用组件 | PageHeader, StatusBadge, EmptyState, ErrorState, LoadingState, ConfirmDialog, FormSection, DataToolbar, DataTableShell |
| `components/layout/` | Shell / Sidebar / Topbar / Layout | AdminLayout, ExamLayout, AppSidebar, BrandHeader, BrandProvider |
| `pages/` | 路由级组合 | 每个路由对应一个页面组件 |

### 4.2 禁止事项

- 禁止在 `components/ui/` 放业务组件
- 禁止在 `pages/` 里直接写复杂业务逻辑（应提取到 hooks 或 service）
- 禁止在 `components/layout/` 里放业务组件

---

## 5. 状态语法

### 5.1 考试相关状态

| 状态 | 含义 | 颜色 tone |
|------|------|-----------|
| `draft` | 草稿 | muted |
| `published` | 已发布 | primary |
| `open` | 开放中 | success |
| `closed` | 已关闭 | secondary |
| `archived` | 已归档 | muted |

### 5.2 考试资格状态

| 状态 | 含义 | 颜色 tone |
|------|------|-----------|
| `assigned` | 已分配 | primary |
| `started` | 已开始 | success |
| `completed` | 已完成 | secondary |
| `blocked` | 已阻止 | destructive |

### 5.3 答题记录状态

| 状态 | 含义 | 颜色 tone |
|------|------|-----------|
| `not_started` | 未开始 | muted |
| `queued` | 排队中 | warning |
| `in_progress` | 答题中 | primary |
| `disrupted` | 断线 | warning |
| `submitted` | 已交卷 | secondary |
| `grading` | 批改中 | primary |
| `graded` | 已出分 | success |
| `voided` | 已作废 | destructive |

### 5.4 保存状态

| 状态 | 含义 | 颜色 tone |
|------|------|-----------|
| `saving` | 保存中 | warning |
| `saved` | 已保存 | success |
| `failed` | 保存失败 | destructive |

### 5.5 其他状态

| 状态 | 含义 | 颜色 tone |
|------|------|-----------|
| `cancelled` | 已取消 | muted |
| `expired` | 已过期 | destructive |
| `stale` | 过期数据 | warning |
| `unknown` | 未知 | muted |

### 5.6 集中管理

所有状态的 label / color / icon / tone **不能散落在页面里**，必须集中到 `statusMeta` 或等价结构。`StatusBadge` 只能消费统一 metadata。

---

## 6. 刷新/加载/Error 兜底原则

### 6.1 App Bootstrap

- App 启动时显示 loading skeleton
- BrandProvider 加载失败时使用 fallback（"考试平台"）
- AuthContext 恢复 session 失败时跳转登录页

### 6.2 页面加载

- 每个页面必须有 loading / error / empty 三态
- 使用统一的 LoadingState / ErrorState / EmptyState 组件
- 不能只写 `<div>Loading...</div>`

### 6.3 直接刷新

- 页面直接刷新后不能出现空白页
- 必须有 ErrorBoundary 兜底
- 必须有 loading 状态过渡

### 6.4 考试答题

- 断线后恢复答案和剩余时间（disrupted 状态）
- 保存失败时显示明确提示
- client timer 只是 cosmetic，server time 才是权威

---

## 7. 后续 Codex 施工边界

### 7.1 可以做的

- 定义 UI 基础设施规则
- 定义组件边界
- 定义 CSS/token 规则
- 定义 Shell/nav/logo 结构
- 定义页面模板
- 定义状态语法
- 定义刷新/加载/error 兜底原则
- 实施 Phase1.4 中的 UI job

### 7.2 不能做的

- 不能提前实现 Phase2 功能
- 不能做全站重写
- 不能引入新 UI 框架
- 不能修改业务 API 调用语义
- 不能重写页面数据流
- 不能写死学校/学生/学号语义
- 不能随意写 CSS

---

## 8. 权威顺序

文档判断按以下顺序：

1. `docs/SPEC.md` 的不变原则
2. 当前 phase plan / job docs
3. `AGENTS.md` 的 agent 执行规则
4. `docs/ui/*` 的 UI 规范
5. 当前代码事实

SPEC 的不变原则不能违反。Phase2 是否开始、哪些功能暂缓，以当前 phase plan 为准。如果 SPEC 提到了未来功能，但当前 plan 暂缓它，不要把它写成当前要实现的功能。
