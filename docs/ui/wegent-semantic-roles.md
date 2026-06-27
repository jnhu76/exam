# Wegent Semantic Roles — 最高执行规范

> **权威级别**：UI 改造的最高执行规范。本文件优先级高于任何外观直觉。
> **视觉来源**：`/home/hoo/Source/_refs/wegent/frontend/`（Apache-2.0，仅作 token/ primitive 参考）
> **最后更新**：2026-06-27
> **配套文档**：`docs/ui/wegent-style-authority.md`（token 清单）、`docs/ui/koi-to-wegent-token-map.md`

---

## 0. 核心原则

```
Token 不是设计系统本身。
Semantic Role 才是设计系统。
```

**不要直接按外观选择 class。** 任何 UI 元素必须先判断它在 Wegent semantic role 体系中的角色，再选择组件与 token。

错误流程（按外观套 class）：

```
看到 card → 套 bg-card border-border
看到 table → 套 Table
看到 button → 套 outline
看到 status → 套 Badge
```

正确流程（先判断 semantic role）：

```
这个区域是 page / panel / toolbar / list-card / elevated / muted-surface？
这个文本是 page-title / section-title / body / secondary-body / meta / metric-value？
这个操作是 primary-action / secondary-action / ghost-action / danger-action？
这个状态是 success-state / warning-state / error-state / info-state / muted-state？
然后再选 component 与 token。
```

```
Wegent  = visual language（视觉来源）
shadcn  = primitive implementation（底层实现）
Koi     = component decomposition reference（仅组件拆分参考）
项目自己的 components/admin 与 components/ui = 最终公共边界
```

---

## 1. Surface Semantic（表层语义）

定义页面/容器/面板的背景与边界语义。

| Role          | 含义        | Tokens / classes                                       | Do（用于）         | Don't（禁止）           |
| ------------- | ---------- | ----------------------------------------------------- | ----------------- | --------------------- |
| `page`        | 页面底层背景     | `bg-background text-foreground`                       | 页面根容器             | 不要加 card 边框           |
| `panel`       | 主内容容器      | `bg-card border-border shadow-sm rounded-lg`          | 表格 / list / form 主容器 | 不要强边框                 |
| `toolbar`     | 搜索/筛选/动作区   | `panel` 内部 top area `gap-2`                          | 与内容同属一个卡片节奏       | 不要单独大灰盒               |
| `muted-surface` | 弱背景        | `bg-muted`                                            | 表头 / 提示 / 轻分组      | 不要大面积铺满页面             |
| `hover-surface` | hover      | `hover:bg-muted/50` / `hover:bg-accent`               | row / menu / button hover | 不要 gray/blue hardcode |
| `elevated`    | 浮层         | `bg-popover shadow-popover border-border`             | dialog / dropdown / popover | 不要用普通 panel 阴影        |

### 规则

1. 搜索区不是独立大灰盒，优先作为 `list-card` 内部 `toolbar`。
2. 表格外层是 `list-card`，表格本身不做强边界（无竖线、无黑边）。
3. hover 必须轻，不要高饱和色块。
4. 页面底色不要灰得太重（`--color-background` = `255 255 255` 白，非灰）。

### Token 对应（来自 `index.css`）

| Wegent semantic role | 当前项目 token                                |
| -------------------- | ------------------------------------------- |
| `page` 背景           | `--color-background` (`255 255 255`)         |
| `panel` 背景          | `--color-card` (`249 249 249`)               |
| `muted-surface` 背景  | `--color-muted` (`243 244 246`)              |
| `hover-surface`      | `hover:bg-muted/50`（轻 tint）                  |
| `elevated` 背景       | `--color-popover` (`255 255 255`)            |
| 边框                  | `--color-border` (`228 228 228`)             |
| 弱边框                 | `--color-admin-border-light` / `border-border` |

---

## 2. Content Semantic（内容语义）

定义文字层级。

| Role             | 含义        | Classes                                                 |
| ---------------- | ---------- | ------------------------------------------------------- |
| `page-title`     | 页面标题       | `text-xl font-semibold tracking-tight text-foreground`  |
| `page-description` | 页面说明       | `text-sm text-muted-foreground`                         |
| `section-title`  | 卡片/区块标题    | `text-base font-semibold text-foreground`               |
| `body`           | 普通正文       | `text-sm text-foreground`                               |
| `secondary-body` | 次级正文       | `text-sm text-muted-foreground`                         |
| `meta`           | 时间/数量/辅助信息 | `text-xs text-muted-foreground`                         |
| `table-header`   | 表头         | `text-xs font-medium text-muted-foreground`             |
| `metric-value`   | 数据值        | `text-2xl font-semibold tabular-nums text-foreground`   |
| `placeholder`    | 输入提示       | `placeholder:text-muted-foreground`                     |

### 规则

1. 不要所有文字都用同一个 text color/size。
2. 数字列使用 `tabular-nums`（分数、人数、时长、及格分）。
3. 时间、数量、描述属于 `meta`/`secondary-body`，不要抢主信息。
4. 页面标题不宜过大；Wegent 风格克制清晰（`text-xl`，非 `text-2xl/3xl`）。

---

## 3. Action Semantic（操作语义）

定义按钮/操作的层级。

| Role              | 示例          | Variant / 实现                              |
| ----------------- | ----------- | ---------------------------------------- |
| `primary-action`  | 新增、创建、提交、保存 | `Button variant="primary"`（实心紫）           |
| `secondary-action` | 导入、导出、重置、取消 | `Button variant="outline"` / `secondary` |
| `ghost-action`    | 查看、编辑、更多    | `Button variant="ghost" size="icon"`     |
| `danger-action`   | 删除、撤销       | 列表内 `ghost` + `text-destructive`；确认弹窗内才 `destructive` |
| `navigation-action` | 返回列表        | `ghost` / `secondary`                    |

### 规则

1. **每个页面最多一个 `primary-action`。**
2. 表格行操作默认 `ghost-action`（ghost icon button）。
3. **删除操作不要在列表中用高饱和实心红按钮**——用 ghost + `text-destructive`，确认弹窗内才 `destructive`。
4. **主操作必须使用 Wegent primary purple token**（`--color-primary` = `93 94 201`）。
5. 不允许使用 Koi 动词色 outline 体系作为默认视觉。
6. **`primary-action` 不能看起来像普通 outline button**——必须是实心紫填充。

### Button variant 与 semantic role 映射（当前项目 `ui/button.tsx`）

| Button variant | 对应 Action Semantic | 视觉                          |
| -------------- | ------------------- | --------------------------- |
| `primary`      | `primary-action`    | `bg-primary text-primary-foreground`（实心紫） |
| `outline`/`secondary` | `secondary-action`  | `border border-border` 透明底，`hover:bg-muted` |
| `ghost`        | `ghost-action`      | 透明底，`hover:bg-muted`         |
| `destructive`  | `danger-action`（仅确认弹窗） | `bg-destructive` 实心红         |
| `link`         | `navigation-action` | 下划线链接                        |
| `default`      | （历史遗留，等同 outline）   | 不推荐显式用作主操作；主操作必须显式 `primary` |

---

## 4. State Semantic（状态语义）

定义状态标签。

| Role           | 示例            | Style                                          |
| -------------- | ------------- | ---------------------------------------------- |
| `success-state` | 已通过、开放中、连接正常   | `bg-success/10 border-success/20 text-success` |
| `warning-state` | 待评分、连接不稳、即将过期  | `bg-warning/10 border-warning/20 text-warning` |
| `error-state`  | 失败、严重、已过期     | `bg-destructive/10 border-destructive/20 text-destructive` |
| `info-state`   | 已发布、进行中、提示    | `bg-primary/10 border-primary/20 text-primary` |
| `muted-state`  | 草稿、未知、未开始     | `bg-muted border-border text-muted-foreground` |

### StatusTag 结构契约（强制）

`AdminStatusTag` / `WegentStatusTag` 必须满足：

```txt
inline-flex
items-center
gap-1
whitespace-nowrap
min-w-fit
h-6
rounded-md
border
px-2
text-xs
font-medium
```

### 状态映射表（业务 status → semantic state）

| 业务 status                                  | Wegent semantic state |
| ------------------------------------------ | --------------------- |
| `open` / `active` / `passed` / `healthy` / `connected` / `ok` / `started` / `graded` / `available` / `saved` / `passed` | `success-state`       |
| `pending` / `grading` / `queued` / `disrupted` / `degraded` / `stale` / `saving` / `import_partial` / `pending_manual` / `submitted_pending_grade` / `misconduct_warning` / `not_started_yet`(部分) | `warning-state`       |
| `failed` / `expired` / `critical` / `blocked` / `voided` / `offline` / `not_passed` / `max_attempts_exhausted` / `unavailable` / `misconduct_serious` | `error-state`         |
| `published` / `in_progress` / `running` / `resumable` / `info` / `assigned` | `info-state`          |
| `draft` / `unknown` / `not_started` / `canceled` / `archived` / `closed` / `completed` / `auto_graded` | `muted-state`         |

> 现有 `lib/statusMeta.ts` 的 `toneTagClass` 已实现 soft 10%/20% 配色。`primary`/`info` tone 统一映射到 `info-state`（Wegent `--color-primary`）。

### 禁止

1. 状态标签换行。
2. 状态标签竖排。
3. 高饱和大色块（实心 success/warning/error）。
4. 黑边胶囊。
5. 状态 icon 和文字被拆开（必须 `inline-flex gap-1` 同行）。

---

## 5. Data List / Table Semantic（数据列表语义）

```
Table is a data list, not an Excel grid.
```

| Role                 | 含义      | Style                                             |
| -------------------- | ------- | ------------------------------------------------- |
| `list-card`          | 列表外层容器  | `bg-card border-border shadow-sm rounded-lg overflow-hidden` |
| `list-toolbar`       | 搜索/筛选/动作栏 | `flex gap-2 p-4`（toolbar 在 list-card 内）         |
| `table-header-row`   | 表头行     | `bg-muted/50 text-muted-foreground`（轻 tint，非重灰）  |
| `table-row`          | 数据行     | `border-b border-border hover:bg-muted/50`        |
| `table-cell-primary` | 主字段     | `text-foreground font-medium`                     |
| `table-cell-secondary` | 次字段     | `text-muted-foreground`                           |
| `table-cell-meta`    | 时间/辅助值  | `text-muted-foreground tabular-nums`              |
| `table-actions`      | 行操作     | `flex justify-end gap-1`                          |

### 规则

1. **不使用全格线**（禁止 `border-r` / `border-l` / `divide-x` 默认）。
2. 不默认使用竖线。
3. **不使用黑色边框**。
4. 表格外层 `list-card` 提供边界，表格本身轻量。
5. 行之间只用轻分隔（`border-b border-border`）。
6. 操作列固定宽度，icon button hover 才显眼。
7. 空表格使用 `EmptyState`，不用空白 table。
8. 数字列使用 `tabular-nums`。

### 列宽与固定列

- 状态列固定宽度（`w-24` 或 `w-28`），保证标签不换行也不撑开。
- 操作列固定宽度（`w-28` ~ `w-36`），icon 按钮右对齐。
- 主名称列（考试名称/课程名称）自适应，`min-w-0`。
- 时间/分数/人数等数值列使用 `tabular-nums`。

---

## 6. Page Pattern Semantic（页面模式语义）

### 6.1 列表页（CoursePage / ExamPage）

```tsx
<WegentPage>
  <WegentPageHeader
    title=""
    description=""
    primaryAction={}      // 最多一个 primary-action
  />
  <WegentListCard>
    <WegentListToolbar>   // 搜索/筛选 = list-card 内 toolbar
      <WegentSearchInput />
      <SecondaryFilters />
    </WegentListToolbar>
    <WegentDataTable />   // 或 <AdminTableShell> + <Table>
  </WegentListCard>
</WegentPage>
```

要点：
- 搜索框放入 `list-toolbar`，不单独成大灰盒。
- `AdminToolbar`（summary/批量动作）作为 list-card 内轻量元数据条。
- 空态用 `EmptyState`。

### 6.2 详情页

```tsx
<WegentPage>
  <WegentPageHeader
    title=""
    description=""
    secondaryActions={}   // 返回/编辑（secondary/ghost）
    primaryAction={}      // 保存/发布（primary）
  />
  <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
    <MainDetailPanel />   // 主信息 panel
    <SideMetaPanel />     // 元数据 side panel
  </div>
</WegentPage>
```

### 6.3 设置页

```tsx
<WegentPage narrow>
  <WegentPageHeader title="账号设置" description="管理你的账号安全与偏好" />
  <WegentFormCard />      // = AdminPageCard
</WegentPage>
```

### 6.4 考生端页面

```tsx
<CandidateShell>
  <CandidatePageHeader />
  <CandidateContentCard />
</CandidateShell>
```

> 考生端本次不改（Phase 4 仅 CoursePage + ExamPage）。

---

## 7. Koi Boundary（Koi 边界）

### Koi 可以参考

1. 组件职责拆分（SearchPanel / TableShell / PageHeader / MetricCard 的职责划分）
2. ResponsiveDialog / SearchMenu / ImportWizard 这类组件职责
3. 后台管理系统的信息架构（页面分层）

### Koi 不再参考（停止使用的视觉规则）

1. ❌ 硬朗网格视觉
2. ❌ 全格线表格（`border-r`/`border-l`/`divide-x`）
3. ❌ 动词色 outline button（每个 CRUD verb 一个边框色）
4. ❌ 黑边胶囊 tag
5. ❌ 大灰搜索盒
6. ❌ 传统后台模板感

> **`AdminToolbarButton` 的 `verb` 系统**：保留 API（`verb`/`icon`/`size` props 不破坏），但视觉实现改为 Wegent semantic——`add`→`primary-action`（实心紫），`export`/`import`→`secondary-action`（outline），`delete`/`reset`→`secondary-action` 或 danger。**不再使用每个 verb 一个边框色的 Koi 视觉。**

---

## 8. Review Checklist（每页迁移必答）

每个页面迁移必须逐条回答：

1. [ ] 页面里的 `primary-action` 是哪个？是否唯一？
2. [ ] 哪些内容是 `primary content`（table-cell-primary）？
3. [ ] 哪些内容是 `meta content`（table-cell-meta）？
4. [ ] 哪些区域是 `panel`？
5. [ ] 哪些区域是 `toolbar`（是否在 list-card 内，而非独立灰盒）？
6. [ ] 表格是否是 data list，而不是 Excel grid（无竖线/黑边/全格线）？
7. [ ] 状态标签是否 soft + single-line（`whitespace-nowrap`）？
8. [ ] 是否有 hardcoded color（`text-gray-500` / `bg-blue-100` / hex）？
9. [ ] 是否误用了 Koi 视觉（动词色 outline）？
10. [ ] 是否保留了 `data-testid` 与所有 `aria-label`？
11. [ ] 是否没有改业务逻辑（API/路由/权限/状态机/表单 schema）？
12. [ ] 数字列是否 `tabular-nums`？

---

## 9. 当前项目实施映射

| Wegent semantic primitive | 当前项目组件（最终公共边界）             | 状态         |
| ------------------------- | ---------------------------- | ---------- |
| WegentPage                | `AdminShell`                 | ✅ 已有，补 page 背景语义 |
| WegentPageHeader          | `AdminShellHeader`           | ✅ 已有，补 description 语义 |
| WegentListCard            | `AdminTableShell`            | ✅ 已有      |
| WegentListToolbar         | `AdminSearchPanel` / `AdminToolbar` | ✅ 已有（toolbar 模式） |
| WegentSearchInput         | `SearchInput`（shared）        | ✅ 已有      |
| WegentDataTable           | `AdminTableShell` + `Table`  | ✅ 已有      |
| WegentActionButton        | `AdminToolbarButton` / `Button` | ⚠️ 改 verb 视觉实现 |
| WegentStatusTag           | `AdminStatusTag`             | ✅ 已有，补 `whitespace-nowrap min-w-fit` |

> 策略：不新增 `Wegent*` 命名组件（避免与现有 `Admin*` 并存造成混乱），而是**让现有 `Admin*` 组件具备同等 semantic 职责**，并修正其视觉实现以符合 Wegent semantic role。新增组件会触发“既有 Admin 又有 Wegent”的双轨混乱，违反“项目自己的 components/admin 是最终边界”。

---

## 10. 安全契约（不可破坏）

### 业务安全（禁止修改）

1. API contract
2. 后端代码
3. 路由语义
4. 权限判断
5. `data-testid`
6. 测试语义（`aria-label`、按钮文案、占位符文案）
7. 表单 schema
8. 数据请求逻辑
9. 业务状态机
10. E2E 用户流程

### 代码安全（必须保持）

1. Koi direct import = 0
2. Hardcoded color = 0
3. 不新增大型 UI 库
4. 不直接复制 Wegent/Koi 业务代码
5. 不破坏 shadcn primitive exports
6. TypeScript 类型完整（no `any`）
7. dark mode 不崩
8. mobile 不溢出
9. 可访问性不倒退

---

## 11. 参考来源与 attribution

- **视觉 token 来源**：`/home/hoo/Source/_refs/wegent/frontend/`（SPDX-License-Identifier: Apache-2.0，Copyright 2025 Weibo, Inc.）
  - 仅移植 token / theme / global CSS / primitive visual class（Level 0–1，适配 Tailwind v4，改名项目 token）
  - 不复制 Wegent 的 route/store/API/feature 业务代码（Level 3）
- **shadcn primitive 校验**：Context7 `/shadcn-ui/ui`（Button/Table/Card/Badge API）
- **当前项目 token 清单**：`docs/ui/wegent-style-authority.md`、`apps/web/src/index.css`
- **Koi token 映射**：`docs/ui/koi-to-wegent-token-map.md`
