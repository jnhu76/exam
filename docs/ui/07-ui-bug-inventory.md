# UI Bug Inventory

> 本文档记录当前 UI 的已知问题。每条包含症状、原因分析、影响、修复方向和范围外说明。

---

## B01: title 一直显示"加载中"

### Symptom

页面加载后，title（页面标题）一直显示"加载中"，即使数据已经加载完成。

### Likely area

- `AdminLayout.tsx` 中的 `getTopbarTitle` 函数
- `routeTitles` 映射不完整
- 某些路由没有匹配到对应的 title

### Why it matters

- 用户无法知道当前在哪个页面
- 体验不专业
- 可能导致用户迷失

### Expected fix direction

1. 检查 `routeTitles` 映射是否完整
2. 检查 `getTopbarTitle` 函数是否有遗漏的路由
3. 添加 fallback title（如使用页面组件的 title 或默认 title）

### Out of scope

- 不改变 title 的显示位置
- 不改变 title 的样式
- 不改变路由结构

---

## B02: 页面直接刷新后出现空白页

### Symptom

页面直接刷新后，内容区域显示空白，没有任何内容或错误提示。

### Likely area

- `App.tsx` 中的 `ErrorBoundary` 配置
- `BrandProvider` 或 `AuthProvider` 的初始化
- 路由配置问题

### Why it matters

- 用户刷新页面后无法继续使用
- 没有任何错误提示
- 可能导致用户误以为系统崩溃

### Expected fix direction

1. 检查 `ErrorBoundary` 是否正确包裹 App
2. 检查 `BrandProvider` 加载失败时的 fallback
3. 检查 `AuthProvider` 恢复 session 失败时的行为
4. 确保所有页面都有 loading 状态

### Out of scope

- 不改变路由结构
- 不改变认证流程
- 不改变品牌加载逻辑

---

## B03: sidebar collapse uses logo slot

### Symptom

sidebar 折叠时，collapse button 占据了 logo 的位置，导致 logo 区域混乱。

### Likely area

- `AppSidebar.tsx` 中的 BrandHeader 和 collapse button 布局
- `BrandHeader.tsx` 的 compact 模式

### Why it matters

- logo 和 collapse button 混在一起，视觉混乱
- 用户无法区分 logo 和功能按钮
- collapsed 状态下无法识别品牌

### Expected fix direction

1. 将 BrandMark 和 SidebarCollapseButton 分离
2. BrandMark 始终显示（expanded 时显示 logo + 名称，collapsed 时只显示 logo）
3. SidebarCollapseButton 在 BrandMark 旁边，但不在 BrandMark 内部

### Out of scope

- 不改变 sidebar 的宽度
- 不改变 sidebar 的折叠行为
- 不改变导航菜单的样式

---

## B04: no stable BrandMark fallback

### Symptom

BrandMark 没有稳定的 fallback，当远程加载失败时显示异常。

### Likely area

- `BrandProvider.tsx` 中的 fallback 配置
- `BrandHeader.tsx` 的显示逻辑

### Why it matters

- 远程加载失败时用户无法识别品牌
- 体验不专业
- 可能导致用户不信任系统

### Expected fix direction

1. 确保 `BrandProvider` 有稳定的 fallback（"考试平台"）
2. 确保 `BrandHeader` 在 fallback 时显示正确的品牌名称
3. 确保 fallback 不包含学校专属语义

### Out of scope

- 不改变品牌加载逻辑
- 不改变品牌配置
- 不改变品牌显示样式

---

## B05: scattered CSS / Tailwind status colors

### Symptom

状态颜色散落在各个页面中，没有集中管理。

### Likely area

- 各个页面组件中的 CSS class
- `bg-green-500`、`text-red-600`、`border-blue-400` 等原始颜色

### Why it matters

- 颜色不一致
- 难以维护
- 难以统一修改

### Expected fix direction

1. 创建 `statusMeta` 集中定义状态颜色
2. 创建 `StatusBadge` 组件消费统一 metadata
3. 替换所有页面中的原始颜色为 StatusBadge

### Out of scope

- 不改变颜色值
- 不改变颜色语义
- 不改变状态定义

---

## B06: page loading/error states inconsistent

### Symptom

页面加载状态和错误状态不一致，有些页面有 loading，有些没有。

### Likely area

- 各个页面组件中的 loading/error 处理
- `LoadingState`、`ErrorState`、`EmptyState` 组件的使用

### Why it matters

- 用户体验不一致
- 有些页面加载时没有提示
- 有些页面出错时没有提示

### Expected fix direction

1. 确保所有页面都有 loading / error / empty 三态
2. 使用统一的 `LoadingState`、`ErrorState`、`EmptyState` 组件
3. 确保所有页面在加载时显示 skeleton

### Out of scope

- 不改变 loading 的样式
- 不改变 error 的样式
- 不改变 empty 的样式

---

## B07: admin runtime layout boundary unclear

### Symptom

Admin Console 和 Exam Runtime 的布局边界不清楚。

### Likely area

- `AdminLayout.tsx` 和 `ExamLayout.tsx` 的结构
- `AppSidebar` 在 Exam Runtime 中的使用

### Why it matters

- 用户可能混淆管理后台和考试答题
- Exam Runtime 可能错误地使用 Admin Sidebar
- 布局不专业

### Expected fix direction

1. 确保 Exam Runtime 使用独立的 ExamShell
2. 确保 Exam Runtime 不使用 Admin Sidebar
3. 确保两套 Shell 的布局完全独立

### Out of scope

- 不改变 Admin Layout 的结构
- 不改变 Exam Layout 的结构
- 不改变导航菜单

---

## B08: SVG/icon usage inconsistent

### Symptom

SVG / icon 使用混乱，有些地方用 lucide-react，有些地方用其他图标库。

### Likely area

- 各个组件中的 icon 导入
- `BrandHeader.tsx` 中使用 `PanelLeft` 作为 logo

### Why it matters

- 图标不一致
- 难以维护
- 可能导致图标丢失

### Expected fix direction

1. 统一使用 lucide-react 图标库
2. 确保所有 icon 有 aria-hidden="true"
3. 确保 icon-only button 有 aria-label

### Out of scope

- 不改变图标库
- 不改变图标样式
- 不改变图标大小

---

## B09: routeTitles mapping incomplete

### Symptom

`routeTitles` 映射不完整，某些路由没有对应的 title。

### Likely area

- `AdminLayout.tsx` 中的 `routeTitles` 定义

### Why it matters

- 某些页面的 title 显示为空
- 用户无法知道当前在哪个页面

### Expected fix direction

1. 检查所有路由是否都有对应的 title
2. 添加缺失的路由映射
3. 添加 fallback title

### Out of scope

- 不改变路由结构
- 不改变 title 的显示位置
- 不改变 title 的样式

---

## B10: CandidateFieldsPage uses native select

### Symptom

`CandidateFieldsPage.tsx` 使用原生 `<select>` 而不是 shadcn Select。

### Likely area

- `CandidateFieldsPage.tsx` 中的 select 元素

### Why it matters

- 样式不一致
- 体验不专业
- 难以维护

### Expected fix direction

1. 将原生 `<select>` 替换为 shadcn Select
2. 确保样式和交互一致

### Out of scope

- 不改变表单逻辑
- 不改变数据流
- 不改变页面结构
