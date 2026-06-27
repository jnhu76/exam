# Wegent-first UI Reset — 结果报告

> **范围**：CoursePage + ExamPage 两个样板页 + 支撑它们的 admin primitives / shadcn primitives
> **执行日期**：2026-06-27
> **执行规范**：`docs/ui/wegent-semantic-roles.md`（最高执行规范）
> **分支**：`ui/wegent-token-closeout`

---

## 1. 是否使用 Context7

**是。** 通过 Context7 查询了权威资料，未凭记忆猜测框架行为。

## 2. Context7 查询了哪些资料

1. **Tailwind CSS**（`/tailwindlabs/tailwindcss.com`）— v4 theme token / CSS variable / dark mode 写法，确认 `@theme inline` 与 `rgb(var(--token) / <alpha>)` 模式。
2. **shadcn/ui**（`/shadcn-ui/ui`）— Button 组件 variants（`default | primary | secondary | outline | ghost | destructive | link`）、sizes（`default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`）、CVA 用法，以及“不破坏现有 variant API”的最佳实践。

**Context7 与当前项目的差异**：
- Context7 / shadcn 官方 `default` variant = `bg-primary text-primary-foreground`（实心主色）。
- 本项目 `default` variant = `bg-transparent border border-border`（透明边框，历史遗留等同 outline）。
- **决策**：以项目兼容性优先，**不改 `default` 的语义**（会静默改变全站每个未显式声明 variant 的 `<Button>`）。主操作必须显式用 `variant="primary"`。差异已在 `docs/ui/wegent-semantic-roles.md` §3 说明。

## 3. 是否使用 shadcn skill

**是。** 加载了 `shadcn` skill（以及 `tailwind-design-system`、`web-design-guidelines`），用于：
1. 确认 primitive 结构（Button / Card / Table / Badge）符合官方 CVA 写法。
2. 确认未破坏 primitive exports。
3. 应用其硬性规则：`gap-*` 而非 `space-x/y`、`size-*` 而非 `w-N h-N`、`cn()` 而非手写三元、semantic token 而非 raw 颜色。

## 4. shadcn primitive 是否保持兼容

**是，全部兼容，未破坏任何 export。** 改动仅限视觉 class/类型导出：

| Primitive | 改动 | API 兼容性 |
| --------- | ---- | ---------- |
| `button.tsx` | 新增 `export type ButtonProps`；提取为独立类型供 `AdminButtons` 复用 | ✅ `{ Button, buttonVariants }` 导出不变；新增导出 |
| `table.tsx` | `TableHead` 加 `bg-muted/50`、修复无效类 `text-muted-nowrap` → `whitespace-nowrap`、`px-4`、`text-xs` | ✅ 所有 export 与 props 不变 |
| `card.tsx` | 未改（已符合 Wegent `variant: default/elevated/ghost`） | ✅ |
| `input.tsx` | 未改（已符合 `h-10 rounded-lg border-border`） | ✅ |
| `badge.tsx` | 未改（`AdminStatusTag` 承担状态语义，`Badge` 保留普通标签） | ✅ |
| `tabs.tsx` | 未改（已符合 Wegent `h-9 rounded-lg bg-muted`） | ✅ |
| `dialog.tsx` / `dropdown-menu.tsx` | 未改（本次两页未涉及） | ✅ |

**关键**：`button.test.tsx`、`table` 相关测试全部通过（625 tests passed）。

## 5. 本地 Wegent 源码路径

```
/home/hoo/Source/_refs/wegent/frontend/
```

重点阅读（Level 0/1 primitive 参考）：
- `tailwind.config.js`（token 体系，Apache-2.0）
- `src/app/globals.css`（`:root` / `[data-theme='dark']` token、license 头）
- `src/components/ui/button.tsx`
- `src/components/ui/table.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/tag.tsx`（StatusTag soft 色 `border-{tone}/20 bg-{tone}/10 text-{tone}` 模式来源）

## 6. 本地 Koi-UI 源码路径

```
/home/hoo/Source/_refs/koi-ui/
```

本次仅作组件职责拆分参考（Level 2）。**未引用任何 Koi 视觉规则。**

## 7. 直接复制了哪些 Wegent 片段

**仅 Level 0 token / theme 层，且已适配项目命名：**
- Wegent `toneTagClass` 模式（`bg-{tone}/10 text-{tone}`）→ 增补 `border-{tone}/20`，改名项目 token（`lib/statusMeta.ts`）。Wegent `tag.tsx` 是该 soft-border 模式的来源，已加 attribution。
- Wegent Table header（`bg-muted/50`、`text-text-muted`、`hover:bg-surface-hover/50`）→ 适配项目 token（`ui/table.tsx`）。

所有 token 早已在 `index.css` 完成移植（先前 commit `9ccfea4` 已处理 `rgb()` 包装问题），本次未复制原始 CSS 变量定义。

## 8. 改写了哪些 Wegent 片段

- Wegent `button.tsx`：未直接移植；保留本项目 CVA 结构，仅新增类型导出。
- Wegent `tag.tsx`：未直接移植；模式融入现有 `AdminStatusTag` + `toneTagClass`。
- Wegent `table.tsx`：未整体替换；仅修正 `TableHead` 视觉与无效类。

## 9. 明确没有迁移哪些 Wegent 文件

- ❌ `src/features/tasks/**`（业务逻辑，Level 3）
- ❌ `src/features/knowledge/**`（业务逻辑，Level 3）
- ❌ `src/features/settings/**`（业务逻辑，Level 3）
- ❌ `src/features/layout/**`（sidebar / TopNavigation 业务，Level 2，本次 layout 未动）
- ❌ `src/components/common/**`（业务组件，Level 3）
- ❌ Wegent route tree / store / API / auth / onboarding / 文案 / logo（Level 3 禁止复制）

## 10. Koi 哪些内容仅作为结构参考

仅作为**组件职责拆分参考**（Level 2），未引用视觉：
1. SearchPanel / TableShell / PageHeader / MetricCard 的职责划分
2. ResponsiveDialog / SearchMenu / ImportWizard 组件职责
3. 后台管理系统的信息架构（page header → toolbar → list-card → table 分层）

## 11. 停止使用了哪些 Koi 视觉规则

全部停止（见 `docs/ui/wegent-semantic-roles.md` §7）：
1. ❌ **动词色 outline button 体系** — `AdminButtons.tsx` 的 `VERB_VARIANT`（每个 verb 一个边框色）已删除，改为 Wegent action-semantic 映射（`add`→`primary` 实心紫，`export`/`import`→`outline`，`delete`/`reset`→`outline` + `text-destructive`）。
2. ❌ 硬朗网格视觉
3. ❌ 全格线表格（`border-r`/`border-l`/`divide-x`）
4. ❌ 黑边胶囊 tag
5. ❌ 大灰搜索盒
6. ❌ 传统后台模板感

## 12. 新增/修改了哪些 semantic roles

**新增规范文档** `docs/ui/wegent-semantic-roles.md`，定义 6 类 semantic role：
1. **Surface Semantic** — `page / panel / toolbar / muted-surface / hover-surface / elevated`
2. **Content Semantic** — `page-title / page-description / section-title / body / secondary-body / meta / table-header / metric-value / placeholder`
3. **Action Semantic** — `primary-action / secondary-action / ghost-action / danger-action / navigation-action`
4. **State Semantic** — `success-state / warning-state / error-state / info-state / muted-state` + 状态映射表 + StatusTag 结构契约（强制 `whitespace-nowrap min-w-fit border`）
5. **Data List / Table Semantic** — `list-card / list-toolbar / table-header-row / table-row / table-cell-primary / table-cell-secondary / table-cell-meta / table-actions`
6. **Page Pattern Semantic** — 列表页 / 详情页 / 设置页 / 考生端模板

## 13. 新增/修改了哪些 admin primitives

**策略**：不新增平行 `Wegent*` 命名组件（避免与现有 `Admin*` 双轨混乱），而是让现有 `Admin*` 具备 Wegent semantic 职责。

| Primitive | 改动 | semantic role |
| --------- | ---- | ------------- |
| `AdminShell` | `gap-4`→`gap-5` 统一 section 节奏 | page 容器 |
| `AdminShellHeader` | title 加 `tracking-tight`；description 间距；actions 容器加 `gap-2` | page-title / page-description |
| `AdminStatusTag` | 加 `whitespace-nowrap min-w-fit border`；icon 加 `shrink-0` | state semantic（防换行/竖排） |
| `AdminButtons` | 删除 `VERB_VARIANT`；改为 `VERB_CONFIG` action-semantic 映射 | primary/secondary/danger-action |
| `AdminToolbar` | 未改（已符合 lightweight meta toolbar） | list-toolbar |
| `AdminTableShell` | 未改（已符合 `list-card`） | list-card |
| `AdminSearchPanel` | 未改（已支持 toolbar 内嵌 + summary） | list-toolbar |
| `AdminPageCard` | 未改（已符合 `panel`） | panel |

## 14. CoursePage 改造内容

按 Review Checklist（`wegent-semantic-roles.md` §8）逐条落实：

1. **primary-action 唯一**：「新增课程」= `AdminToolbarButton verb="add"` → 实心紫 `primary-action`（Phase 2 改 verb 实现）。
2. **page-title + description**：加 `description="维护课程库，作为题库与考试的基础分类。"`。
3. **搜索区不再是独立大灰盒**：`SearchInput` 移入 `AdminTableShell` 内部作为 `AdminSearchPanel` toolbar（`rounded-none border-b bg-card`），与表格同属一个 list-card 节奏。
4. **toolbar 带 meta**：右侧 `共 N 门课程`（meta semantic）。
5. **表格是 data list**：无竖线、无黑边；表头 `bg-muted/50`（Phase 3）。
6. **cell 语义**：课程名称 `text-foreground font-medium`（primary）；课程代码 `tabular-nums text-muted-foreground`（meta）；描述 `secondary-body`。
7. **行操作**：ghost icon button（编辑）；删除 `ghost` + `text-destructive`（error token，非实心红）。
8. **空态**：`EmptyState`（无课程 / 搜索无结果两种）。
9. **保留全部 data-testid / aria-label**：「新增课程」「编辑课程」「删除课程」「搜索课程」「清除课程搜索」「清除搜索」、Label「课程名称/课程代码」、占位符全部不变。
10. **未改业务逻辑**：API、表单校验、CRUD、状态机全部不动。

## 15. ExamPage 改造内容

1. **primary-action 唯一且醒目**：「创建考试」从 `<Button>`（default 弱）→ `variant="primary"`（实心紫 primary-action）。
2. **page-title + description**：加 `description="创建、发布并管理组织内的考试场次。"`。
3. **状态标签 single-line**：`AdminStatusTag` Phase 2 加 `whitespace-nowrap min-w-fit border`，状态列固定 `w-28`——**不再换行/竖排**。
4. **表格 data list**：无竖线、无黑边；表头 `bg-muted/50`；数值列右对齐 `text-right`。
5. **cell 语义层级**：考试名称 `text-foreground font-medium`（primary，自适应宽）；时间窗口 `tabular-nums text-sm text-muted-foreground`（meta）；时长/题目数/参与人数/及格分全部 `tabular-nums text-muted-foreground`（meta）。
6. **行操作**：`RowActions` 统一；查看 ghost icon；删除 `ghost` + `text-destructive`（error token）；禁用删除带 Tooltip（保留原有交互与 aria-label「删除考试」）。
7. **保留 `AdminToolbar summary`**：「共 N 场考试」meta 条。
8. **保留全部 data-testid / aria-label**：「删除考试」「查看详情」「考试管理」「共 2 场考试」全部不变。
9. **未改业务逻辑**：导航、删除、canDelete 判断全部不动。

## 16. Koi direct import 是否仍为 0

**是 = 0。** `audit-koi-ui-usage.mjs` → `## Koi-UI references (informational): 0 issues ✅`。

## 17. Hardcoded color 是否仍为 0

**是 = 0。** `audit-koi-ui-usage.mjs` → `## Hardcoded colors (should use tokens): 0 issues ✅`。

## 18. Badge variant 剩余数量

**13 处**（全站，均不在本次两页范围内）：
- `components/exam/ExamTopbar.tsx`、`QuestionHeader.tsx`（考试运行时，非本次范围）
- `pages/admin/AttemptDetailPage.tsx`、`ExamCreatePage.tsx`、`ExamEditPage.tsx`、`ExamMonitoringPage.tsx`、`QuestionImportPage.tsx`、`UsersPage.tsx`（后续迁移页）
- `pages/exam/ExamListPage.tsx`（考生端，后续）

> 按 §15 后续顺序，这些页面的 Badge variant→AdminStatusTag 迁移留待对应批次。本次两页已全部使用 `AdminStatusTag`。

## 19. space-x/y 剩余数量及保留理由

**7 处**（全站源码，均不在本次两页范围内）：

| 位置 | 次数 | 保留理由 |
| ---- | ---- | -------- |
| `GradingDetailPage.tsx` | 4 | 后续迁移页（不在本次范围），留待其批次转 `gap-*` |
| `ExamConfigForm.tsx` | 1 | 考试运行时组件（非本次范围） |
| `ui/calendar.tsx` (`month_grid: space-y-1`) | 1 | shadcn primitive 内部 `react-day-picker` 主题类，属于 primitive 内部实现，不强行改 |
| `ui/avatar.tsx` (`-space-x-2` avatar group 重叠) | 1 | **故意重叠**——avatar group 需要负 margin 制造堆叠效果，`gap-*` 无法实现，属合理保留 |

> 本次 CoursePage / ExamPage 自身 **0 处** `space-x/y`（已全部用 `gap-*` / `RowActions`）。

## 20. 验收命令结果

| 命令 | 结果 |
| ---- | ---- |
| `pnpm format:check` | ✅ All matched files use Prettier code style |
| `pnpm lint` | ✅ Code quality checks passed |
| `pnpm lint:copy` | ✅ No hardcoded business copy found |
| `pnpm lint:arch` | ✅ Architecture checks passed |
| `pnpm --filter web typecheck` | ✅ `tsc --noEmit` 通过 |
| `pnpm build` | ✅ 8/8 tasks successful（web + api 全量构建通过） |
| `pnpm --filter web test` | ✅ **61 test files / 625 tests passed**（含 CoursePage、ExamPage、button、statusMeta、及所有使用 AdminToolbarButton 的页面） |
| `node scripts/audit-koi-ui-usage.mjs` | ✅ Koi refs=0, Hardcoded=0；CoursePage/ExamPage 无任何审计项 |

## 21. 后续页面迁移 checklist

按 `wegent-semantic-roles.md` §8 Review Checklist，后续批次顺序（`docs/ui/wegent-semantic-roles.md` §6 页面模式 + 本报告遗留项）：

```
CoursePage + ExamPage ✅（本次完成）
↓
QuestionPage
↓
UsersPage / CandidatesPage
↓
ImportLogs / AuditLogs
↓
Dashboard / SystemDiagnostics
↓
ExamDetail / ExamCreate / ExamEdit
↓
AttemptDetail / GradingDetail / GradingQueue / ScoreList
↓
Candidate pages（ExamListPage 等）
↓
Exam runtime 组件（ExamTopbar / QuestionHeader / ExamConfigForm）
```

每页迁移必答 12 项 checklist（见 `wegent-semantic-roles.md` §8）。Dashboard 故意排在列表页之后（避免滑回 Koi 数据看板风格）。

---

## License / Attribution 处理

- **Wegent**（`/home/hoo/Source/_refs/wegent/frontend/`）：SPDX-License-Identifier: **Apache-2.0**，Copyright 2025 Weibo, Inc.。与本项目兼容。本次仅移植 Level 0/1 token 与 primitive 视觉 class 模式，已在 `wegent-semantic-roles.md` §11 与 `wegent-style-authority.md` 记录来源。未复制任何 Wegent 业务代码、route、store、API、文案、logo。
- **Koi-UI**：仅作 Level 2 组件职责参考，未复制任何代码。
- **本次未引入**：新大型 UI 库、云依赖、CDN、外部 API（符合 LAN/on-premise 约束）。

---

# 附录 B：视觉修复批次（6 项 Bug + 字体纠偏）

> 在 CoursePage/ExamPage 基线之后，针对实际浏览发现的 4 个视觉 bug + 主题切换 + 字体进行的修复批次。本附录是该批次的结果记录。

## B1. Badge「单选」竖排（root cause + 修复）

**现象**：`/admin/questions` 题型 badge「单选」两字上下竖排。
**根因**：`ui/badge.tsx` 的 `badgeVariants` 基础类缺 `whitespace-nowrap`；固定高度 `h-5` + `inline-flex justify-center` 在窄宽下把 2 个汉字堆叠。
**修复**：`badgeVariants` 加 `whitespace-nowrap`（与 StatusTag 结构契约一致，`wegent-semantic-roles.md` §4）。

## B2. 系统页硬编码色（root cause + 修复）

**现象**：`/admin/system` MetricCard 用 `#5ad8a6/#5b8ff9/#9270ca`；图表 `stroke="#5ad8a6"`；图表还引用了不存在的 `var(--primary)`/`var(--border)`/`var(--text-muted)`/`var(--surface)`（项目实际变量是 `--color-*`，原引用解析失败→回退黑色）。
**根因**：双 bug——硬编码 hex + 错误 CSS 变量名。
**修复**（`SystemDiagnosticsPage.tsx`）：
- CPU → `bg-primary/10 text-primary`，图表线 `var(--color-primary)`
- 内存 → `bg-success/10 text-success`，图表线 `var(--color-success)`
- DB → `bg-warning/10 text-warning`
- 图表 grid/axis/tooltip 全部从错误的 `var(--primary/border/text-muted/surface)` 改为正确的 `var(--color-primary/color-border/color-muted-foreground/color-card)`。
- **刷新行为不动**（按你的决定：只修颜色）。

## B3. 侧栏配色（root cause + 修复）

**现象**：侧栏是生硬海军蓝 `#102a43`。
**根因**：`--sidebar-*` 用裸 hex，与 Wegent 浅色体系无关。仅 `AppSidebar.tsx` 消费（考生端 ExamLayout 零影响）。
**修复**（决策=浅色 Wegent）：`index.css` 7 个 `--sidebar-*`（light+dark）改为 Wegent 浅色（`--sidebar-bg` 白、`--sidebar-active` 紫、hover `bg-muted`）；`AppSidebar.tsx` 激活态 `bg-sidebar-active-soft text-sidebar-active`，hover `hover:text-sidebar-text`；avatar 改用 `text-sidebar-accent-foreground`（对比度修复）。

## B4. 筛选区灰色大盒（root cause + 修复）

**现象**：筛选区 `bg-muted rounded-lg border` 是 Wegent 禁止的「独立灰色表单盒」。
**根因**：`AdminSearchPanel` 自带 `bg-muted border rounded-lg`。
**修复**：`AdminSearchPanel` 基础类去掉 `bg-muted border rounded-lg`，改为透明 `list-toolbar`（`flex flex-wrap items-center gap-2 p-4`）。结构性安全嵌套的页面（CoursePage/QuestionPage/ImportLogsPage）把 panel 嵌入 `AdminTableShell` 内并加 `border-b border-border` 分隔；三元/双表结构（QuestionImportPage/AuditLogPage/CandidatesPage）保持透明同级（已去灰盒，不强行重构以免破坏 panel-always-renders 逻辑）。

## B5. 设置页 tab+panel（root cause + 修复）

**现象**：`/admin/settings` Tabs 内容裸浮无边框，「保存」按钮弱。
**根因**：每个 `TabsContent` 没包 panel。
**修复**：每个 `TabsContent` 用 `AdminPageCard` 包裹；「保存」改 `variant="primary"` primary-action。保留 `data-testid="profile-save-btn"` 与全部表单逻辑。

## B6. 主题切换 + 字体（关键纠偏）

**主题切换**：`ThemeToggle.tsx` 从裸 `Button ghost size=icon`（size-10）改为 Wegent 带边框小方块（`size-8 border border-border rounded-[7px] bg-background hover:bg-muted`，icon `size-3.5`，目标模式图标）。**保留功能**（`useTheme`、aria-label、tooltip、localStorage `exam-theme`）。

**字体（纠偏说明）**：
- 原 Batch 6 计划「打包离线 Google Sans」经核实**不可行**：Google Sans 是**专有字体、不可重分发**（即使 Wegent 参考仓库也只 ship 了 CSS、未打包实际 woff2 二进制）。为 LAN/离线产品打包它会是许可证违规。
- **真实诊断**：项目已打包 `Noto Sans CJK SC`（SIL OFL，可重分发，覆盖中文+Latin+数字，~48MB），但它排在 `--font-sans` 第 7 位、且 Vite dev 不代理 `/fonts`，导致中文实际回退到系统雅黑。
- **最终修复**（决策=提升 Noto Sans CJK SC，零新依赖、零许可证风险）：
  1. `--font-sans` 把 `"Noto Sans CJK SC"` 提到栈**最前**（Latin/数字/CJK 全覆盖，Wegent 一致）。
  2. `vite.config.ts` 加 `/fonts` → `localhost:3000` 代理（顺带修好现有 Noto 字体 dev 缺口）。
- **未做**：未引入 Inter / Google Sans / 任何新字体包。中文已是 OFL 合规的 Noto Sans CJK SC。

## B7. 验收结果

| 命令 | 结果 |
| ---- | ---- |
| `pnpm format:check` | ✅ All matched files use Prettier code style |
| `pnpm lint` / `lint:copy` / `lint:arch` | ✅ 全部通过 |
| `pnpm --filter web typecheck` | ✅ 通过 |
| `pnpm build` | ✅ 8/8 successful |
| `pnpm --filter web test` | ✅ **625/625 passed**（含本批改动的 QuestionPage/SettingsPage/ImportLogsPage/CoursePage/sidebar） |
| `node scripts/audit-koi-ui-usage.mjs` | ✅ Koi refs=0, Hardcoded=0（SystemDiagnostics hex 已清零） |

剩余审计项（32 legacy components / 12 Badge variant / 7 space-x-y）均在本批 6 项范围**之外**（exam-runtime 组件及其它页），留待 §15 后续顺序。

## B8. 不变契约复核

- 未改 API contract / 路由 / 权限 / 业务状态机 / data-testid / aria-label / 表单 schema / 系统页刷新行为。
- 未破坏 shadcn primitive exports（Badge 仅加 `whitespace-nowrap`）。
- 未引入 Google Sans（许可证不可重分发）；中文用 OFL 合规的 Noto Sans CJK SC。
