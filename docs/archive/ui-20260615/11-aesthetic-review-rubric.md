# Aesthetic Review Rubric

> 本文档定义 UI 审美审查标准。每次 UI 审查必须使用此 rubric。

---

## 审查维度

### 1. Scope Discipline（范围纪律）

**Good**: 组件保持组件，卡片集保持bounded module，section保持section，page只在被要求时才成为page。

**Failure**: 将component request变成full page、dashboard shell或landing layout。

**Review question**: 是否在用户请求的范围内？是否添加了未请求的hero copy、marketing paragraphs、navigation、footer、feature sections、badges、CTA clusters？

**Blocking threshold**: 输出超出了用户请求的范围。

---

### 2. First-Read Clarity（首次阅读清晰度）

**Good**: 首次阅读在3秒内清晰。用户知道这是什么、在哪里、该做什么。

**Failure**: 布局混乱，信息层级不清晰，用户需要仔细阅读才能理解。

**Review question**: 首次阅读是否在3秒内清晰？如果去掉所有样式，结构是否仍然清晰？

**Blocking threshold**: 用户需要超过3秒才能理解页面的主要目的。

---

### 3. Information Hierarchy（信息层级）

**Good**: 信息层级清晰，主要信息突出，次要信息退后。标题、正文、辅助文字有明确的视觉权重差异。

**Failure**: 所有信息权重相同，没有明确的阅读顺序。equal-weight modules with no clear reading order。

**Review question**: 信息层级是否清晰？是否有一个明确的阅读顺序？

**Blocking threshold**: 没有明确的信息层级，所有元素权重相同。

---

### 4. Spacing Rhythm（间距节奏）

**Good**: 间距有节奏感，相关元素靠近，不相关元素远离。间距使用项目定义的token。

**Failure**: 间距不一致，有些地方太紧，有些地方太松。使用随机间距值。

**Review question**: 间距是否有节奏感？是否使用了项目定义的spacing tokens？

**Blocking threshold**: 间距不一致，影响阅读体验。

---

### 5. Typography Role Consistency（字体角色一致性）

**Good**: 每个字体大小和字重都有明确的角色。page-title、section-title、body、meta等角色一致使用。

**Failure**: 随机使用text-xs/text-lg而不指定角色。重要正文变灰色。使用serif字体。

**Review question**: 字体角色是否一致？是否使用了项目定义的typography roles？

**Blocking threshold**: 字体角色不一致，影响可读性。

---

### 6. Color Semantics（颜色语义）

**Good**: primary、success、warning、destructive、neutral有稳定的含义。颜色使用项目定义的semantic tokens。

**Failure**: 页面使用绿色作为active nav，蓝色作为success，红色作为normal emphasis。使用原始颜色如bg-green-500。

**Review question**: 颜色语义是否一致？是否使用了项目定义的semantic tokens？

**Blocking threshold**: 状态颜色在多个页面中硬编码不同。

---

### 7. Status Clarity（状态清晰度）

**Good**: 状态通过label + color + icon清晰传达。StatusBadge使用统一的statusMeta。

**Failure**: 状态只通过颜色传达，没有label或icon。状态颜色散落在页面里。

**Review question**: 状态是否清晰？是否使用了统一的StatusBadge组件？

**Blocking threshold**: 状态只通过颜色传达，没有统一的statusMeta。

---

### 8. Component Precision（组件精度）

**Good**: 组件精确，相关控件共享兼容的高度、padding逻辑和radius discipline。

**Failure**: 组件粗糙，相关控件看起来不相关。hover、focus、active、error状态不清晰。

**Review question**: 组件是否精确？相关控件是否共享兼容的样式？

**Blocking threshold**: 组件粗糙，影响用户体验。

---

### 9. Icon Consistency（图标一致性）

**Good**: 图标来自lucide-react，大小一致，颜色继承currentColor。icon-only button有aria-label。

**Failure**: 图标来自多个库，大小不一致，颜色随机。icon-only button没有aria-label。

**Review question**: 图标是否一致？是否使用了项目定义的icon rules？

**Blocking threshold**: 图标不一致，影响视觉一致性。

---

### 10. Loading/Error/Empty Quality（加载/错误/空状态质量）

**Good**: 每个页面都有loading / error / empty三态。使用统一的LoadingState / ErrorState / EmptyState组件。

**Failure**: 页面没有loading状态，没有error状态，没有empty状态。使用generic spinner on blank screen。

**Review question**: 是否每个页面都有loading / error / empty三态？是否使用了统一组件？

**Blocking threshold**: 页面缺少loading / error / empty状态。

---

### 11. Motion Restraint（动画克制）

**Good**: 动画最小且功能性。hover、focus、sidebar width transition简短且有用。

**Failure**: cinematic animation、looping attention animation、decorative page motion。

**Review question**: 动画是否最小且功能性？是否强化了交互逻辑？

**Blocking threshold**: 动画过多或过于花哨，分散用户注意力。

---

### 12. Depth Restraint（深度克制）

**Good**: 深度来自border和background surface。shadow只用于overlay、dropdown、dialog。

**Failure**: 每张卡片都有shadow。使用blur/glow作为默认premium信号。everything floating with shadows。

**Review question**: 深度是否克制？是否使用了border-first, shadow-light原则？

**Blocking threshold**: 深度过多，影响视觉清晰度。

---

### 13. Admin/Exam Runtime Separation（管理/考试运行时分离）

**Good**: Admin Console使用AdminShell，Exam Runtime使用ExamShell。两套Shell完全独立。

**Failure**: Exam Runtime使用Admin Sidebar。两套Shell混用。

**Review question**: Admin Console和Exam Runtime是否完全分离？

**Blocking threshold**: Exam Runtime使用了Admin Sidebar。

---

### 14. Accessibility（可访问性）

**Good**: icon-only button有accessible label。dialog有title/description。form label关联input。color不是唯一状态信号。

**Failure**: icon-only button没有aria-label。dialog没有title。form label不关联input。color是唯一状态信号。

**Review question**: 是否符合WCAG 2.1 AA标准？

**Blocking threshold**: 违反WCAG 2.1 AA标准。

---

### 15. Phase2 Boundary（Phase2边界）

**Good**: 没有实现Phase2功能。没有fake routes、fake dashboards、fake live states。

**Failure**: 实现了Phase2功能。创建了fake routes、fake dashboards、fake live states。

**Review question**: 是否遵守了Phase2边界？

**Blocking threshold**: 实现了Phase2功能或创建了fake内容。

---

## 审查流程

1. 从最大的结构失败开始，不要从CSS细节开始
2. 解释问题是hierarchy、density、component quality、state behavior、palette、depth还是motion
3. 将每个发现与readability、trust、focus或action clarity联系起来
4. 优先使用直接修正而不是通用taste语言

## 审查输出格式

```
Dimension: [维度名称]
Good: [良好表现]
Failure: [失败表现]
Review question: [审查问题]
Blocking threshold: [阻塞阈值]
Finding: [发现]
Fix: [修正建议]
```
