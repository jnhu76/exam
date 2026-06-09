# UI Job Cards (U01–U04)

> 本文档是 `phase1.4-bridge-plan.md` 的展开。若发生冲突，以 bridge plan 为准。

---

## P1.4-U01: UI Design System Baseline

### Purpose

提取共享常量、统一 semantic token、增加 ErrorBoundary，为样板页建立基础。

### Background

- `statusLabels` 在 4+ 页面重复定义
- 颜色用 `bg-green-500` 而非 semantic token
- `BrandProvider.tsx` fallback 硬编码中文 `"内网考试平台"`
- 无 ErrorBoundary
- `/exam/settings` 路由不可达
- `CandidateFieldsPage.tsx` 用原生 `<select>`

### Scope

1. 新建 `apps/web/src/lib/constants.ts`：提取共享常量
2. 统一颜色到 semantic token
3. 修复 BrandProvider fallback → 通用英文
4. 新建 ErrorBoundary，包裹 App
5. 修复 `/exam/settings` 路由
6. CandidateFieldsPage 原生 select → shadcn Select

### Explicit Non-goals

- 不做 dark mode
- 不引入新 UI 框架
- 不做全站重写
- 不引入图表库 / 动画库

### Allowed Changes

- `apps/web/src/lib/constants.ts` — 新建
- `apps/web/src/components/shared/ErrorBoundary.tsx` — 新建
- `apps/web/src/App.tsx`
- `apps/web/src/components/layout/BrandProvider.tsx`
- `apps/web/src/components/exam/QuestionNav.tsx`
- `apps/web/src/components/shared/ConnectionIndicator.tsx`
- `apps/web/src/pages/admin/CandidateFieldsPage.tsx`
- 各使用 statusLabels/typeLabels 的页面

### Forbidden Changes

- 禁止修改 `components/ui/` 下 shadcn generated 组件
- 禁止引入新 UI 框架
- 禁止做全站重写

### Acceptance Criteria

- [ ] `statusLabels` 无本地重复定义
- [ ] `bg-green-500` / `bg-yellow-500` / `bg-red-500` 从 components/ 中消除
- [ ] ErrorBoundary 包裹 App
- [ ] `/exam/settings` 路由可达或链接移除
- [ ] BrandProvider fallback 无中文场景词
- [ ] `pnpm typecheck` + `pnpm lint:copy` 通过

### Required Tests

- `constants.test.ts`, `ErrorBoundary.test.tsx`, `BrandProvider.test.tsx`

### Required Docs / Screenshots

- 共享常量清单
- Design token 使用指南

### Dependencies

无

### Estimated Duration

1 天

### Risk

Medium

---

## P1.4-U02: Admin Dashboard Sample

### Purpose

以 Dashboard 为样板建立 Admin 页面视觉基准。

### Background

- Stats 卡片密度低
- 状态无彩色 Badge
- 无快捷操作
- `AttemptDetailPage.tsx:114` 显示 totalScore 而非得分

### Scope

- Stats 一行 4 个，紧凑
- 状态 Badge 统一颜色
- 快捷操作按钮（创建考试、导入题目）
- 1280px 检查
- 修复 AttemptDetailPage 分数 bug

### Explicit Non-goals

- 不新增后端筛选 API
- 不引入图表库
- 不引入动画库

### Allowed Changes

- `DashboardPage.tsx`, `AttemptDetailPage.tsx`
- 可能新增共享组件

### Forbidden Changes

- 禁止引入图表库 / 动画库
- 禁止一次改多个页面

### Acceptance Criteria

- [ ] Dashboard 截图 review 通过
- [ ] 1280px 下 stats 一行 4 个
- [ ] 状态 Badge 有统一颜色
- [ ] AttemptDetailPage 分数正确
- [ ] Loading / Empty / Error 三态正常

### Required Tests

- `DashboardPage.test.tsx`, `AttemptDetailPage.test.tsx`

### Required Docs / Screenshots

- Dashboard 截图（1280px + 1920px）
- 页面结构说明
- 组件复用清单

### Dependencies

U01

### Estimated Duration

1.5 天

### Risk

Medium

---

## P1.4-U03: Exam Detail Sample

### Purpose

以 Exam Detail 为样板建立详情页模式。

### Background

- 信息层级不清晰
- `ScoreListPage.tsx:129` export URL 缺 `/api` 前缀

### Scope

- 分区布局：Stats → Config → Tabs（报考/成绩）
- 操作日志 Tab 可 **placeholder**，不提前实现完整审计 UI
- 修复 ScoreListPage export URL

### Explicit Non-goals

- 不实现完整审计日志 UI
- 不增加新 API 调用

### Allowed Changes

- `ExamDetailPage.tsx`, `ScoreListPage.tsx`

### Forbidden Changes

- 禁止提前实现完整审计日志 UI（操作日志 tab 可 placeholder）

### Acceptance Criteria

- [ ] Exam Detail 截图 review 通过
- [ ] Stats → Config → Tabs 三区
- [ ] ScoreListPage CSV export 可正常下载

### Required Tests

- `ExamDetailPage.test.tsx`, `ScoreListPage.test.tsx`

### Required Docs / Screenshots

- Exam Detail 截图

### Dependencies

U01

### Estimated Duration

1.5 天

### Risk

Medium

---

## P1.4-U04: Take Exam Sample

### Purpose

以 Take Exam 为样板建立考生端体验基准。

### Background

- 固定 viewport 布局不适配小屏
- Timer 不够醒目
- 保存状态反馈弱
- `ExamConfigForm.tsx:85` useEffect 缺依赖

### Scope

- 安静高可读布局、1024px 适配
- Timer 剩余 5 分钟变红
- 保存状态强反馈
- 修复 ExamConfigForm useEffect 依赖
- **submit flush 不属于 U04，属于 S03b**

### Explicit Non-goals

- **不实现 submit flush**（S03b owns this）
- 不引入动画库
- 不做全屏模式
- 不做 Proctor 行为

### Allowed Changes

- `TakeExamPage.tsx`（视觉和布局）
- `ExamTimer.tsx`, `SaveIndicator.tsx`, `QuestionNav.tsx`
- `ExamConfigForm.tsx`

### Forbidden Changes

- 禁止实现 submit flush
- 禁止实现 full screen mode
- 禁止实现 proctor behavior
- 禁止引入动画库

### Acceptance Criteria

- [ ] Take Exam 截图 review 通过
- [ ] 1024px 下答题区可用
- [ ] Timer 剩余 5 分钟变红
- [ ] 保存状态有明显图标变化
- [ ] ExamConfigForm useEffect 依赖完整
- [ ] Loading / Error / Disconnected 三态正常

### Dependencies

U01

U04 must not implement submit flush. S03b owns submit flush and may update TakeExamPage later. Final Take Exam acceptance may require both U04 visual baseline and S03b protocol behavior.

### Required Tests

- `TakeExamPage.test.tsx`, `ExamConfigForm.test.tsx`

### Required Docs / Screenshots

- Take Exam 截图（1920px + 1024px）
- 考生端 UI 规范说明

### Estimated Duration

1.5 天

### Risk

Medium
