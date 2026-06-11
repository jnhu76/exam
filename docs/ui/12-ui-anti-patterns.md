# UI Anti-Patterns

> 本文档记录项目中需要避免的 UI 反模式。

---

## 1. AI 生成风格反模式

### 1.1 AI-purple gradient dashboard

**问题**: 使用AI-purple渐变作为dashboard背景或装饰。

**为什么是反模式**: 这是LLM默认的"premium"信号，但实际上是AI生成的标志。

**正确做法**: 使用项目定义的semantic tokens，不使用渐变作为装饰。

---

### 1.2 Fake-premium glass cards

**问题**: 使用glassmorphism（毛玻璃效果）作为默认premium信号。

**为什么是反模式**: glassmorphism在dashboard中不适用，且是AI生成的常见模式。

**正确做法**: 使用border-first, shadow-light原则，不使用blur/glow作为默认premium信号。

---

### 1.3 Every metric in a floating card

**问题**: 每个metric都放在floating card中。

**为什么是反模式**: 过度使用card容器，导致视觉噪声。

**正确做法**: 使用项目定义的spacing tokens，相关元素靠近，不相关元素远离。

---

## 2. 布局反模式

### 2.1 Sidebar collapse icon used as logo

**问题**: collapse icon占据logo位置。

**为什么是反模式**: logo和collapse button混在一起，视觉混乱。

**正确做法**: BrandMark和SidebarCollapseButton必须是独立组件。

---

### 2.2 Generic spinner on blank screen

**问题**: 页面显示generic spinner而没有内容。

**为什么是反模式**: 用户不知道发生了什么，体验不专业。

**正确做法**: 使用统一的LoadingState组件，显示skeleton loading。

---

### 2.3 Title stuck at loading

**问题**: title一直显示"加载中"。

**为什么是反模式**: 用户无法知道当前在哪个页面。

**正确做法**: 检查routeTitles映射是否完整，添加fallback title。

---

### 2.4 Exam runtime inside admin sidebar

**问题**: Exam Runtime使用Admin Sidebar。

**为什么是反模式**: Exam Runtime是沉浸式考试环境，不是管理后台。

**正确做法**: Exam Runtime使用独立的ExamShell，不使用Admin Sidebar。

---

## 3. 颜色反模式

### 3.1 Per-page status colors

**问题**: 每个页面重新定义状态颜色。

**为什么是反模式**: 颜色不一致，难以维护。

**正确做法**: 使用项目定义的statusMeta，StatusBadge消费统一metadata。

---

### 3.2 Destructive action as normal blue button

**问题**: destructive action使用normal blue button。

**为什么是反模式**: 用户可能误操作不可逆操作。

**正确做法**: destructive action必须使用destructive颜色的button。

---

### 3.3 Status shown by color only

**问题**: 状态只通过颜色传达。

**为什么是反模式**: 色盲用户无法识别状态。

**正确做法**: 状态通过label + color + icon清晰传达。

---

## 4. 语义反模式

### 4.1 Hardcoded school-only copy

**问题**: 代码中写死"学生"、"学号"、"班级"、"院系"、"校园"、"教务"。

**为什么是反模式**: 项目是通用型LAN/on-premise exam platform，不是学校专用系统。

**正确做法**: 使用通用语义：考生、候选人、身份字段、组织、部门。

---

### 4.2 Fake Phase2 proctor dashboard

**问题**: 创建fake Phase2 proctor dashboard。

**为什么是反模式**: Phase2尚未开始，创建fake内容会误导用户。

**正确做法**: 只做文档准备，不实现Phase2功能。

---

## 5. 组件反模式

### 5.1 Business components in components/ui/

**问题**: 把业务组件（ExamCard、TaskStatusPanel等）放进components/ui/。

**为什么是反模式**: components/ui/只能放shadcn/ui primitives。

**正确做法**: 业务组件放components/shared/。

---

### 5.2 Raw CSS in business pages

**问题**: 在业务页面直接写bg-green-500、text-red-600、border-blue-400。

**为什么是反模式**: 颜色不一致，难以维护。

**正确做法**: 使用项目定义的semantic tokens，通过StatusBadge消费统一metadata。

---

### 5.3 Duplicate statusLabels

**问题**: 每个页面重复定义statusLabels。

**为什么是反模式**: 代码重复，难以维护。

**正确做法**: 使用项目定义的statusMeta，集中管理状态。

---

## 6. 动画反模式

### 6.1 Cinematic animation

**问题**: 使用cinematic animation。

**为什么是反模式**: 动画过多，分散用户注意力。

**正确做法**: 动画最小且功能性。

---

### 6.2 Looping attention animation

**问题**: 使用looping attention animation。

**为什么是反模式**: 动画过多，分散用户注意力。

**正确做法**: 动画最小且功能性。

---

### 6.3 Decorative page motion

**问题**: 使用decorative page motion。

**为什么是反模式**: 动画过多，分散用户注意力。

**正确做法**: 动画最小且功能性。

---

## 7. 深度反模式

### 7.1 Every card has shadow

**问题**: 每张卡片都有shadow。

**为什么是反模式**: 深度过多，影响视觉清晰度。

**正确做法**: 使用border-first, shadow-light原则。

---

### 7.2 Blur/glow as default premium signal

**问题**: 使用blur/glow作为默认premium信号。

**为什么是反模式**: 这是AI生成的常见模式。

**正确做法**: 使用border-first, shadow-light原则。

---

## 8. 审查检查清单

在每次UI审查时检查：

- [ ] 是否在用户请求的范围内？
- [ ] 首次阅读是否在3秒内清晰？
- [ ] 信息层级是否清晰？
- [ ] 间距是否有节奏感？
- [ ] 字体角色是否一致？
- [ ] 颜色语义是否一致？
- [ ] 状态是否清晰？
- [ ] 组件是否精确？
- [ ] 图标是否一致？
- [ ] 是否每个页面都有loading / error / empty三态？
- [ ] 动画是否最小且功能性？
- [ ] 深度是否克制？
- [ ] Admin Console和Exam Runtime是否完全分离？
- [ ] 是否符合WCAG 2.1 AA标准？
- [ ] 是否遵守了Phase2边界？
