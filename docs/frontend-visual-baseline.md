# Frontend Visual Baseline

本文档定义 Phase 1 前端产品视觉契约。目标不是装饰，而是把后台和考试端稳定到可长期使用的产品基线。

## 1. 产品方向

### Admin Panel

后台是成熟、清爽、日常使用的管理系统：低饱和蓝灰、清楚的侧栏、表格优先、操作层级明确。禁止营销页、AI SaaS、游戏 UI 或 raw backend template 质感。

关键词：

- mature admin panel
- clean administrative system
- low-saturation blue
- slate gray
- daily-use management system
- table-first layout
- clear action hierarchy

### Exam Taking UI

考试端和后台端不共用同一套密度。考试端目标是低干扰、高可读、专注答题，并清楚展示保存、网络、倒计时和交卷风险。

## 2. Layout Baseline

后台页面统一结构：

```txt
AppShell
  Sidebar
  Topbar
  Main
    Breadcrumb optional
    PageHeader
      title
      description
      actions
    Toolbar
      search
      filters
      reset
    ContentCard
      table / form / detail
```

### Sidebar

- 固定左侧；默认宽度 232px，折叠宽度 56px。
- 背景使用低饱和蓝黑。
- active item 清楚，但不使用高饱和亮蓝。
- icon + label 对齐，文字 14px。
- hover 使用低对比浅色变化。
- logo 区保持简洁，不使用复杂随机图形。

### Main

- 主内容背景：`--bg` / `--background`，浅灰。
- 内容 card：白底，细边框，轻阴影或无阴影。
- page padding：24px，宽屏可使用 32px。
- section gap：24px。
- card padding：20px 或 24px。
- toolbar gap：12px。
- form field gap：16px。

## 3. Color Baseline

全局 token 使用清爽蓝色主操作与低饱和蓝灰布局。primary/default 按钮统一使用登录页同款蓝色；sidebar 保持深蓝灰；success / warning / info / danger 必须继续使用独立语义色，不能全部套用 primary。语义 token 映射如下：

```css
:root {
  --bg: #f7f8fb;
  --surface: #ffffff;
  --surface-muted: #f9fafb;

  --text: #111827;
  --text-muted: #6b7280;
  --text-subtle: #9ca3af;

  --border: #e5e7eb;
  --border-strong: #d1d5db;

  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --primary-soft: #eff6ff;

  --sidebar-bg: #102a43;
  --sidebar-active: #1f4e79;
  --sidebar-text: #d9e2ec;
  --sidebar-muted: #9fb3c8;
  --sidebar-border: #1b3a57;

  --danger: #b42318;
  --danger-hover: #912018;
  --danger-soft: #fef3f2;
  --danger-border: #fecdca;

  --success: #047857;
  --success-soft: #ecfdf5;
  --warning: #b54708;
  --warning-soft: #fffbeb;
  --info: #175cd3;
  --info-soft: #eff6ff;
}
```

禁止使用偏紫主色和大面积鲜红。primary 用于主要操作与当前焦点状态；danger 仅用于危险操作和错误提示；warning 仅用于警告；info 仅用于普通提示；success 仅用于成功状态。错误、警告、提示、成功信息必须通过语义色区分，不得统一渲染成 primary 蓝。

## 4. Typography Baseline

字体栈：

```css
font-family:
  "Noto Sans CJK SC",
  "Source Han Sans SC",
  "PingFang SC",
  "Microsoft YaHei UI",
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

要求：

| 场景 | 字号 | 字重 |
| --- | ---: | ---: |
| Admin page h1 | 24px | 600 |
| Admin h2 | 18px | 600 |
| Card title | 16px | 600 |
| Admin body | 14px/15px | 400 |
| Table body | 14px | 400 |
| Table header | 13px | 500 |
| Button | 14px | 500 |
| Helper text | 12px/13px | 400 |
| Field error | 13px | 400/500 |

禁止裸用 SimHei / 黑体。标题不要使用 700/800，表头不要过黑。

## 5. Button Baseline

后台按钮语义只有 primary、secondary、ghost、danger、icon。

- Primary：新增、保存、发布、确认导入、开始考试。一个操作区域最多一个 primary。高度 36px 或 40px，圆角 8px，14px/500。
- Secondary：返回、取消、导入、下载模板、查看。白底、灰边、深色文字，hover 浅灰。
- Ghost：清除搜索、重置筛选、表格轻操作、展开/收起。无边框，不抢主操作注意力。
- Danger：删除、禁用、归档、移除、强制提交。必须二次确认，确认文案包含目标对象名，普通页面优先 outline/ghost，确认弹窗中使用 danger solid。
- Icon：32px x 32px，必须有 `aria-label`，主要操作不能只用 icon。

所有 async button 在执行中必须 disabled 并显示 loading text，成功后 toast / close dialog / refresh / navigate，失败后显示具体错误。

## 6. Toast / Error / Validation Baseline

Toast 默认位置：`top-center`。可接受 `top-right`，禁止 `left-top`。

自动关闭时间：

| 类型 | 自动关闭时间 | 手动关闭 |
| --- | ---: | --- |
| success | 3.5s - 4s | yes |
| info | 5s | yes |
| warning | 8s | yes |
| error | 8s - 10s | yes |
| critical inline error | 不自动关闭或 10s+ | yes |
| field error | 不自动关闭，随输入变化 | no toast |

错误展示规则：

- 字段错误显示在字段下方。
- form-level error 显示在表单顶部或按钮区域前。
- 页面级错误使用 inline alert。
- 保存失败 / 发布失败 / 导出失败不能只靠 toast。
- 已知后端 `ApiError.message` 不得被 generic fallback 覆盖。
- `VALIDATION_ERROR.details.fields` 应尽量映射到字段。
- 网络错误可以 generic fallback；未知错误才使用 generic fallback。

## 7. Search / Filter / Empty State Baseline

搜索和筛选必须有恢复路径：

- search input 不能在 no-result 时消失。
- search input 必须有 clear X。
- filter 必须有 reset。
- empty state 必须有恢复按钮。
- no-result 和 true-empty 必须区分。
- 如果 client-side search 只搜索当前页，文案必须明确“仅搜索当前页”，或改成 server-side / URL-bound。

True empty 示例：暂无考生，可以通过「新增考生」或「导入考生」创建考生。

No-result 示例：未找到匹配考生，没有符合「张三」的考生，提供「清除搜索」。

## 8. Table Baseline

- table header：13px / 500 / muted。
- table body：14px / 400。
- row height：44px - 48px。
- 只保留横向分隔线。
- row hover 使用极浅灰。
- 状态使用 Badge。
- 操作列右对齐。
- 表格必须有 responsive overflow wrapper。
- 表格 loading 使用 skeleton 或 inline loading，不默认 full-page spinner。
- 表格错误状态要有 retry。

## 9. Form Baseline

- label 必须关联 input。
- required 使用明确标识。
- field error 在字段下方。
- form error 在表单顶部或 submit 区域前。
- submit button async 时 loading + disabled。
- submit 失败保留用户输入。
- submit 成功后 close dialog / refresh / toast / navigate。
- cancel 在 saving 中 disabled，或需要确认。
- server field errors 映射到字段，无法映射的放 form-level。

## 10. Exam Taking UI Baseline

必须保留：顶部考试名、倒计时、保存状态、网络状态、题号导航、当前题高亮、已答 / 未答 / 已标记状态、上一题 / 下一题、标记本题、交卷、交卷确认弹窗、未答题摘要、已标记题摘要、未保存或保存失败提示。

后续能力预留：

- 题干字号放大 / 缩小。
- 左侧题号导航折叠。
- 右侧信息栏如出现也必须可折叠。
- 主观题大文本输入。
- 公式题 KaTeX / MathJax 展示区域。
- 画图题 drawing canvas / 图片上传布局。
- 附件题上传 / 预览区域。

默认字号：题干 18px，选项 16px，说明文字 14px，按钮 16px，题号按钮 16px。

## 11. Phase Boundary

Phase 1 不暴露随机选题、queue admission、IP restriction、lockdown、真实 proctor dashboard、force submit、extend time、misconduct marking、pass gate API、service token、API key 或操作日志可用功能。相关能力只能作为文档中的未来能力保留。
