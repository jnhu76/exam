# Koi-UI 视觉风格迁移参考（唯一文档）

> **状态**：Phase 1 迁移完成 · **分支**：`ui/koi-admin-visual-spike`
> **最后更新**：2026-06-27
> **目标**：把 koi-ui（Vue3 + ElementPlus）的"硬朗网格 + 数据看板"视觉风格，通过 shadcn/ui + Tailwind v4 实现到 React。**只改 UI，不改业务逻辑/API/路由/contract**。

---

## 0. 速查索引

| 章节 | 内容 |
|------|------|
| §1 | 已完成模块清单 |
| §2 | 迁移模式（列表/详情/看板页模板） |
| §3 | 验收标准 |
| §4 | 任务表（全 DONE） |
| §5 | koi-ui 组件 → shadcn 映射（18 个组件） |
| §6 | 视觉 Token 对照表 |
| §7 | 布局/主题/动画/登录/仪表盘模式 |
| §8 | shadcn + Tailwind 实现模式 |
| §9 | Web Design Guidelines 合规 |
| §10 | React Hooks 提取（watermark/throttle/adaptive） |
| §11 | 避坑指南 |
| §12 | 环境与账号 |

---

## 1. 已完成模块

| 模块 | 文件 | 做了什么 |
|------|------|----------|
| tokens + 暗色 | `index.css` `admin-theme.css` | `@custom-variant dark`；`--admin-*` 接入 `@theme inline`；`.dark` 完整主题 |
| 布局 shell | `components/layout/*` | topbar `ThemeToggle`；侧栏 `bg-sidebar-active-soft`；内容区 `bg-admin-page` |
| 暗色切换 | `components/theme/*` | `useTheme`（localStorage + `prefers-color-scheme`，降级容错） |
| admin 组件层 | `components/admin/*` `lib/statusMeta.ts` | `AdminTableShell`/`AdminPageCard`/`AdminSearchPanel`/`AdminStatusTag`/`MetricCard` |
| 硬朗表格 | `components/ui/table.tsx` | 全格线竖线 + 表头 `bg-admin-table-header` |
| 试点 CRUD | Users/Question/Candidates/Course/ExamPage | `AdminShell > AdminShellHeader > AdminSearchPanel > AdminTableShell` |
| 诊断页 | `SystemDiagnosticsPage.tsx` | metric 卡网格 + recharts 折线 |
| 考试运行时 | TakeExamPage/ExamTimer/QuestionNavigator 等 | 卡片对齐 admin-radius/hairline |
| 端口修复 | `vite.config.ts` | proxy `3001→3000` |
| **新 shadcn 组件** | `ui/command.tsx` `ui/drawer.tsx` `ui/context-menu.tsx` | Command 搜索菜单 + Drawer 移动端抽屉 + ContextMenu 右键 |
| **Hooks** | `hooks/*.ts` | useWatermark/useAdaptiveHeight/useThrottle/useDebounce/useCopyToClipboard/useMediaQuery |
| **共享组件** | `components/shared/SearchMenu.tsx` `ResponsiveDialog.tsx` `ScrollableTabs.tsx` | 搜索菜单 + 响应式对话框 + 可滚动标签 |

**验证基线**：`typecheck` ✅ · `lint`/`lint:copy`/`lint:arch` ✅ · `web test` 616+ ✅ · `build` ✅

---

## 2. 迁移模式

### 2.1 列表型 CRUD 页

```tsx
<AdminShell>
  <AdminShellHeader
    title="XX管理"
    actions={<AdminToolbarButton verb="add" icon={Plus}>新增</AdminToolbarButton>}
  />
  <AdminSearchPanel>
    <Input placeholder="搜索..." />
    <AdminToolbarButton verb="search" icon={Search}>搜索</AdminToolbarButton>
    <AdminToolbarButton verb="reset" icon={RotateCcw}>重置</AdminToolbarButton>
  </AdminSearchPanel>
  <AdminTableShell>
    <Table>
      <TableHeader><TableRow>...</TableRow></TableHeader>
      <TableBody>{rows.map(...)}</TableBody>
    </Table>
  </AdminTableShell>
  <DataTablePagination ... />
</AdminShell>
```

### 2.2 详情/表单页

```tsx
<AdminShell>
  <AdminShellHeader title="XX详情" actions={<Button>返回</Button>} />
  <div className="grid gap-4 lg:grid-cols-3">
    <AdminPageCard className="lg:col-span-2" title="主体">...</AdminPageCard>
    <AdminPageCard title="侧边信息">...</AdminPageCard>
  </div>
</AdminShell>
```

### 2.3 看板页

```tsx
<AdminShell>
  <AdminShellHeader title="概览" />
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <MetricCard label="总考生" value={1234} icon={Users} iconBg="bg-primary-soft" iconColor="text-primary" />
    ...
  </div>
  <AdminPageCard title="数据趋势">
    <ResponsiveContainer><LineChart>...</LineChart></ResponsiveContainer>
  </AdminPageCard>
</AdminShell>
```

### 2.4 动词色映射

`add=primary` · `edit=success` · `delete=danger` · `export=warning` · `import=info` · `search=primary` · `reset=danger`

### 2.5 验证命令

```bash
pnpm --filter web typecheck
pnpm lint && pnpm lint:copy && pnpm lint:arch
pnpm --filter web test -- --run
pnpm --filter web build
```

---

## 3. 验收标准

- [ ] 结构：`AdminShell > AdminShellHeader > AdminSearchPanel(可选) > AdminTableShell`
- [ ] 无旧组件：无 `PageHeader`/`ListToolbar`/`DataToolbar`/`DataTableShell`
- [ ] 状态字段：`AdminStatusTag` + `statusMeta`
- [ ] 动作按钮：`AdminToolbarButton verb="..."` + `data-icon="inline-start"`
- [ ] 零业务改动
- [ ] 暗色适配：手动切 `.dark` 全页检查
- [ ] shadcn 规范：`gap-*` 非 `space-*`；`size-*` 非 `w- h-`；`cn()` 条件类
- [ ] 测试：该页 `*.test.tsx` 全过
- [ ] 回归：`typecheck` + `lint*` + `test` + `build`

---

## 4. 任务表

所有 P0/P1/P2 页面均已迁移完成（见 §1 清单）。P3-2（邮件模板）SKIP。

---

## 5. koi-ui 组件 → shadcn 映射

### 5.1 KoiCard → `AdminPageCard`

```tsx
<AdminPageCard title="标题" actions={<Button>操作</Button>}>
  {children}
</AdminPageCard>
```

### 5.2 KoiDialog → shadcn `Dialog`

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="sm:max-w-[650px]">
    <DialogHeader>
      <DialogTitle>编辑用户</DialogTitle>
      <DialogDescription>修改用户信息</DialogDescription>
    </DialogHeader>
    <div className="max-h-[60vh] overflow-auto">{form}</div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
      <Button onClick={handleSave}>确认</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### 5.3 KoiDrawer → shadcn `Sheet`

```tsx
<Sheet open={open} onOpenChange={setOpen}>
  <SheetContent className="sm:max-w-[450px]">
    <SheetHeader><SheetTitle>详情</SheetTitle></SheetHeader>
    <div className="flex-1 overflow-auto py-4">{content}</div>
    <SheetFooter>
      <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
      <Button onClick={handleSave}>确认</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

### 5.4 KoiToolbar → `AdminIconButton`

```tsx
<div className="flex items-center gap-2">
  <AdminIconButton onClick={toggleSearch} aria-label="搜索">
    <Search className="size-4" />
  </AdminIconButton>
  <AdminIconButton onClick={refresh} aria-label="刷新">
    <RefreshCw className="size-4" />
  </AdminIconButton>
</div>
```

### 5.5 KoiTag → `AdminStatusTag`

```tsx
<AdminStatusTag status="published" />
<AdminStatusTag status="draft" size="md" />
```

### 5.6 KoiSearch → `AdminSearchPanel`

```tsx
<AdminSearchPanel>
  <Input placeholder="搜索..." />
  <AdminToolbarButton verb="search" icon={Search}>搜索</AdminToolbarButton>
</AdminSearchPanel>
```

### 5.7 KoiExcel → `ImportWizard`

```tsx
<Dialog open={showImport} onOpenChange={setShowImport}>
  <DialogContent>
    <DialogHeader><DialogTitle>导入数据</DialogTitle></DialogHeader>
    <ImportWizard onImport={handleImport} />
  </DialogContent>
</Dialog>
```

### 5.8 KoiUpload/* → shadcn + custom upload

```tsx
{/* Single image upload (KoiUpload/Image equivalent) */}
<div className="relative size-[120px] overflow-hidden rounded-[6px] border-2 border-dashed border-admin-border">
  {imageUrl ? (
    <img src={imageUrl} className="size-full object-contain" />
  ) : (
    <div className="flex items-center justify-center text-muted-foreground">
      <Upload className="size-7" />
    </div>
  )}
</div>
```

### 5.9 KoiTagFilter → toggle chips

```tsx
<div className="flex flex-wrap gap-2">
  {options.map(opt => (
    <button
      key={opt.value}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        selected === opt.value
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-primary-soft text-primary border-primary/30 hover:bg-primary hover:text-primary-foreground"
      )}
      onClick={() => onSelect(opt.value)}
    >
      {opt.label}
    </button>
  ))}
</div>
```

### 5.10 KoiScrollNav → `ScrollableTabs`

**文件**：`components/shared/ScrollableTabs.tsx`

```tsx
import { ScrollableTabs } from "@/components/shared/ScrollableTabs";

<ScrollableTabs height="40px" scrollStep={200}>
  {items.map(item => (
    <button key={item.id} className="inline-flex h-8 shrink-0 items-center rounded-md px-3 text-sm">
      {item.label}
    </button>
  ))}
</ScrollableTabs>
```

### 5.11 KoiLoading → shadcn `Skeleton` / `Spinner`

```tsx
<LoadingState />          {/* page-level */}
<Spinner className="size-4" />  {/* inline */}
<Skeleton className="h-4 w-[200px]" />  {/* placeholder */}
```

### 5.12 KoiSearchMenu → `SearchMenu` (Command)

**文件**：`components/shared/SearchMenu.tsx`
**基于**：shadcn `Command` + `CommandDialog`，快捷键 ⌘J

### 5.13 KoiDialog/KoiDrawer → `ResponsiveDialog`

**文件**：`components/shared/ResponsiveDialog.tsx`
**基于**：shadcn `Dialog`（桌面）+ `Drawer`（移动端）+ `useMediaQuery`

### 5.14 KoiGlobalIcon / KoiSvgIcon / KoiSelectIcon / KoiShell* → Not needed

Lucide icons cover all icon needs. No windowing shell in React SPA.

---

## 6. 视觉 Token 对照表

### 6.1 koi-ui → admin token

| koi CSS var | Light | Dark | admin token |
|-------------|-------|------|-------------|
| `--el-bg-color` | `#FFF` | `#1D1E1F` | `--admin-bg-card` |
| `--el-fill-color-light` | `#F5F7FA` | `#262626` | `--admin-bg-search` |
| `--el-border-color` | `#E5E7ED` | `#414243` | `--admin-border` |
| `--el-color-primary` | `#409EFF` | `#409EFF` | `--admin-primary` |
| `--el-text-color-primary` | `#303133` | `#CFD3DC` | `--admin-text` |

### 6.2 Radius 词汇

| 元素 | koi | admin token |
|------|-----|-------------|
| 面板/卡片 | 8px | `--admin-radius` |
| Tabs/按钮 | 6px | `--admin-radius-sm` |
| Tags/Badges | 4px | `rounded-[4px]` |

### 6.3 Shadow 词汇

| 元素 | 值 |
|------|-----|
| 卡片 | `--admin-shadow-card` |
| 搜索面板 | `--admin-shadow-search` |

### 6.4 状态色 Tone

| Tone | 背景 | 文字 | 场景 |
|------|------|------|------|
| primary | `bg-primary-soft` | `text-primary` | 进行中 |
| success | `bg-success-soft` | `text-success` | 通过/开放 |
| warning | `bg-warning-soft` | `text-warning` | 排队/断线 |
| destructive | `bg-destructive-soft` | `text-destructive` | 失败/严重 |
| muted | `bg-neutral-soft` | `text-muted-foreground` | 草稿/未知 |

---

## 7. 布局/主题/动画/登录/仪表盘模式

### 7.1 布局结构（koi LayoutVertical）

```
┌─────────────────────────────────────────┐
│ container (100vw × 100vh)               │
│  ┌──────────┬──────────────────────────┐│
│  │ sidebar  │ header (56px)            ││
│  │ (Logo)   │  left: collapse+breadcrumb││
│  │ (Menu)   │  right: toolbar (glass)  ││
│  │          ├──────────────────────────┤│
│  │          │ main (flex:1, overflow)  ││
│  └──────────┴──────────────────────────┘│
└─────────────────────────────────────────┘
```

### 7.2 暗色模式色值

```css
.dark {
  --admin-bg-page: #0f1117;
  --admin-bg-card: #1D1E1F;
  --admin-bg-search: #262626;
  --admin-bg-table-header: #1f1f1f;
  --admin-border: #414243;
  --admin-text: #CFD3DC;
  --admin-text-muted: #A3A6AD;
}
```

### 7.3 动画（CSS keyframes）

```css
/* 页面过渡 */
.fade-enter { opacity: 0; }
.fade-enter-active { transition: opacity 0.3s ease-in-out; }

/* Hover 微动画 */
.koi-scale:hover { animation: koi-scale 0.6s forwards; }
@keyframes koi-scale {
  0% { transform: scale(1); }
  50% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

/* 浮动图片（登录页） */
@keyframes float-picture {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-16px); }
}

/* 背景光斑（登录页） */
@keyframes bg-float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(15px, -10px) scale(1.05); }
}
```

### 7.4 登录页玻璃拟态

```css
.glass-overlay {
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(40px);
  border-right: 1px solid rgba(255, 255, 255, 0.15);
}
.dark .glass-overlay {
  background: rgba(0, 0, 0, 0.25);
}

/* 浮动光斑 */
.bg-shape {
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.5;
  animation: bg-float 18s infinite ease-in-out;
}

/* 登录按钮悬浮 */
.login-btn {
  box-shadow: 0 4px 14px rgba(primary-rgb, 0.35);
  transition: all 0.3s;
}
.login-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(primary-rgb, 0.45);
}
```

### 7.5 仪表盘网格

```css
/* 4 列统计卡 */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
}
@media (width <= 992px) { grid-template-columns: repeat(2, 1fr); }
@media (width <= 576px) { grid-template-columns: 1fr; }

/* 5:7 图表面板 */
.panel-grid {
  display: grid;
  grid-template-columns: 5fr 7fr;
  gap: 20px;
}
@media (width <= 992px) { grid-template-columns: 1fr; }
```

### 7.6 Header 玻璃工具栏

```css
.toolbar {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}
.dark .toolbar {
  background: rgba(30, 30, 30, 0.65);
  border-color: rgba(255, 255, 255, 0.12);
}
```

### 7.7 Tabs 样式

```css
/* 玻璃卡片 tab */
.tab-item {
  border: 1px solid var(--admin-border);
  border-radius: 6px;
  transition: all 0.15s ease;
}
.tab-item:hover:not(.active) {
  background: var(--admin-bg-search);
  border-color: color-mix(primary 42%, border);
}
.tab-item.active {
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
  border-color: var(--admin-primary);
}
```

### 7.8 菜单激活指示器

```css
.menu-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 20px;
  border-radius: 0 4px 4px 0;
  background: var(--admin-primary);
}
```

---

## 8. shadcn + Tailwind 实现模式

### 8.1 对话框（模仿 KoiDialog）

```tsx
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// shadcn Dialog 自动处理：
// - 背景遮罩 + 点击关闭
// - ESC 键关闭
// - 焦点陷阱
// - 响应式宽度（sm:max-w-*）
// - 无障碍（aria-describedby）
```

### 8.2 侧边抽屉（模仿 KoiDrawer）

```tsx
import {
  Sheet, SheetContent, SheetDescription,
  SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";

// shadcn Sheet 自动处理：
// - 右侧滑出动画
// - 遮罩 + 点击关闭
// - 焦点陷阱
// - overscroll-behavior: contain
```

### 8.3 表单布局（模仿 koi el-form）

```tsx
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { FieldError } from "@/components/shared/FieldError";

<FieldGroup>
  <Field>
    <Label htmlFor="name">姓名</Label>
    <Input id="name" value={name} onChange={...} />
    <FieldError>{error}</FieldError>
  </Field>
</FieldGroup>

// 关键规则：
// - gap-* 不用 space-*
// - size-* 不用 w- h-
// - cn() 条件类
// - data-invalid + aria-invalid 验证状态
```

### 8.4 按钮系统（模仿 koi 动词色）

```tsx
import { Button } from "@/components/ui/button";

// shadcn Button variants:
// default, destructive, outline, secondary, ghost, link

// koi 动词色 → shadcn outline + 语义色
<Button variant="outline" className="border-primary/40 text-primary">新增</Button>
<Button variant="outline" className="border-success/40 text-success">编辑</Button>
<Button variant="outline" className="border-destructive/40 text-destructive">删除</Button>
```

### 8.5 表格（模仿 koi 硬朗网格）

```tsx
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";

// koi 特色：
// - 全格线（border 在 Table/TableRow/TableHead/TableCell）
// - 表头背景 bg-admin-table-header
// - 行 hover bg-muted/50
// - font-semibold text-foreground 表头
```

### 8.6 状态标签（模仿 koi KoiTag）

```tsx
// 使用 AdminStatusTag + statusMeta（已实现）
import { AdminStatusTag } from "@/components/admin";

<AdminStatusTag status="published" />   // → 已发布 (primary)
<AdminStatusTag status="graded" />      // → 已出分 (success)
<AdminStatusTag status="disrupted" />   // → 断线 (warning)
```

### 8.7 Toast 通知（模仿 koi ElNotification）

```tsx
import { toast } from "sonner";

toast.success("保存成功");
toast.error("操作失败，请重试");
toast.warning("文件格式不正确");

// shadcn sonner 自动处理：
// - 堆叠显示
// - 自动消失
// - 暗色适配
```

### 8.8 确认对话框（模仿 koi ElMessageBox.confirm）

```tsx
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

<AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>确认删除？</AlertDialogTitle>
      <AlertDialogDescription>此操作不可撤销</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>取消</AlertDialogCancel>
      <AlertDialogAction onClick={handleDelete}>确认</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### 8.9 搜索菜单（模仿 koi SearchMenu）

**文件**：`components/shared/SearchMenu.tsx`
**基于**：shadcn `Command` + `CommandDialog`

```tsx
import { SearchMenu } from "@/components/shared/SearchMenu";

// 用法：顶部栏全局搜索 ⌘J
<SearchMenu groups={[
  { heading: "页面", items: [
    { label: "用户管理", icon: Users, onClick: () => navigate("/admin/users") },
    { label: "考试管理", icon: FileText, onClick: () => navigate("/admin/exams") },
  ]},
  { heading: "操作", items: [
    { label: "新建考试", icon: Plus, onClick: () => navigate("/admin/exams/new") },
  ]},
]} />
```

### 8.10 响应式对话框（桌面 Dialog + 移动端 Drawer）

**文件**：`components/shared/ResponsiveDialog.tsx`
**基于**：shadcn `Dialog` + `Drawer` + `useMediaQuery`

```tsx
import { ResponsiveDialog } from "@/components/shared/ResponsiveDialog";

// 用法：桌面端弹窗，移动端底部抽屉
<ResponsiveDialog
  open={open}
  onOpenChange={setOpen}
  title="编辑用户"
  description="修改用户信息"
  maxWidth="sm:max-w-[425px]"
>
  <ProfileForm />
</ResponsiveDialog>
```

### 8.11 可滚动标签页（模仿 koi KoiScrollNav）

**文件**：`components/shared/ScrollableTabs.tsx`

```tsx
import { ScrollableTabs } from "@/components/shared/ScrollableTabs";

// 用法：标签页过多时左右滚动
<ScrollableTabs height="40px">
  {tabs.map(tab => (
    <button key={tab.id} className={cn("inline-flex h-8 shrink-0 items-center rounded-md px-3 text-sm", active === tab.id && "bg-primary text-primary-foreground")}>
      {tab.label}
    </button>
  ))}
</ScrollableTabs>
```

### 8.12 Context Menu（右键菜单）

```tsx
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";

// 用法：表格行右键操作
<ContextMenu>
  <ContextMenuTrigger asChild>
    <TableRow>...</TableRow>
  </ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem onClick={handleEdit}>编辑</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem onClick={handleDelete} className="text-destructive">删除</ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

---

## 9. Web Design Guidelines 合规

基于 Vercel Web Interface Guidelines 审查，以下规则已应用：

### 9.1 Accessibility ✓

- Icon-only 按钮有 `aria-label`
- 装饰图标有 `aria-hidden="true"`
- `<button>` 用于操作，`<a>` 用于导航
- 语义 HTML（`<table>`, `<label>`, `<button>`）

### 9.2 Focus States ✓

- 使用 `focus-visible:ring-*` 焦点样式
- 不使用 `outline: none` 无替代
- Dialog/Sheet 自动焦点陷阱

### 9.3 Forms ✓

- Input 有 `<label>` 或 `aria-label`
- 错误信息内联显示
- 提交按钮在请求期间禁用 + spinner

### 9.4 Animation ✓

- 使用 `transform`/`opacity` 动画（合成器友好）
- 不使用 `transition: all`
- 页面过渡 0.2-0.3s
- Hover 微动画 0.15-0.6s

### 9.5 Typography ✓

- 加载状态以 `…` 结尾（"保存中…"）
- 数字列使用 `tabular-nums`
- 标题使用 `text-wrap: balance`

### 9.6 Content Handling ✓

- 文本容器处理长内容（`truncate`, `line-clamp-*`）
- Flex 子元素 `min-w-0` 允许截断
- 空状态使用 `EmptyState` 组件

### 9.7 Dark Mode ✓

- `color-scheme: dark` 在 `<html>`
- 所有 token 同时定义 `:root` 和 `.dark`
- 暗色下所有文本/背景/边框可读

### 9.8 Touch & Interaction ✓

- 按钮有 `hover:` 状态
- Active 状态 `scale-95` 反馈
- Dialog/Sheet 有 `overscroll-behavior: contain`

---

## 10. React Hooks（已实现）

所有 hooks 位于 `apps/web/src/hooks/`，统一导出见 `hooks/index.ts`。

### 10.1 useWatermark — 考试页面安全水印

**文件**：`hooks/useWatermark.ts`
**模仿**：koi `v-waterMarker` 指令

```tsx
import { useWatermark } from "@/hooks";

// 用法：考试页面添加考生姓名水印
useWatermark({
  text: `${user.name} ${new Date().toISOString()}`,
  opacity: 0.3,
  rotate: -20,
});
```

### 10.2 useAdaptiveHeight — 表格/表单自适应高度

**文件**：`hooks/useAdaptiveHeight.ts`
**模仿**：koi `v-adaptive` 指令

```tsx
import { useAdaptiveHeight } from "@/hooks";

// 用法：表格自动填满剩余视口高度
const tableRef = useAdaptiveHeight(80); // 底部偏移 80px
<div ref={tableRef}>
  <Table>...</Table>
</div>
```

### 10.3 useThrottle — 按钮防重复点击

**文件**：`hooks/useThrottle.ts`
**模仿**：koi `v-throttle` 指令

```tsx
import { useThrottle } from "@/hooks";

// 用法：搜索按钮 500ms 节流
const handleSearch = useThrottle(() => { fetchData(); }, 500);
<Button onClick={handleSearch}>搜索</Button>
```

### 10.4 useDebounce — 输入框防抖

**文件**：`hooks/useDebounce.ts`
**模仿**：koi `v-debounceInput` 指令

```tsx
import { useDebounce } from "@/hooks";

// 用法：搜索输入 300ms 防抖
const debouncedSearch = useDebounce((value: string) => { search(value); }, 300);
<Input onChange={(e) => debouncedSearch(e.target.value)} />
```

### 10.5 useCopyToClipboard — 一键复制

**文件**：`hooks/useCopyToClipboard.ts`
**模仿**：koi `v-copy` 指令

```tsx
import { useCopyToClipboard } from "@/hooks";

// 用法：点击复制考试链接
const copy = useCopyToClipboard();
<Button onClick={() => copy(examUrl)}>复制链接</Button>
```

### 10.6 useMediaQuery — 响应式断点

**文件**：`hooks/useMediaQuery.ts`

```tsx
import { useMediaQuery } from "@/hooks";

// 用法：桌面用 Dialog，移动端用 Drawer
const isDesktop = useMediaQuery("(min-width: 768px)");
```

---

## 11. 避坑指南

1. **端口**：`.env APP_PORT=3000`，vite proxy 指 `3000`，web 访问 `4173`
2. **db dist**：改了 `packages/db/src` 后必须 `pnpm --filter @exam/db build`
3. **ButtonProps**：shadcn `button.tsx` 不导出 `ButtonProps`，用 `ComponentProps<"button">`
4. **useTheme 容错**：不能 `throw`，用 fallback（测试不挂 ThemeProvider）
5. **lint:copy**：拦截硬编码部署场景词（"校内"/"大学"等）
6. **测试文案**：迁移页不改 `data-testid` 和可见文案
7. **暗色 token**：新颜色必须同时在 `:root` 和 `.dark` 定义
8. **cn()**：条件类用 `cn()`，不用模板字符串三元
9. **gap vs space**：用 `gap-*`，不用 `space-*`
10. **size vs w/h**：等宽高用 `size-*`，不用 `w- h-`

---

## 12. 环境与账号

```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm --filter api dev
pnpm --filter web dev
```

- Admin：`admin` / `admin123`
- 考生：`candidate1`/`candidate123`、`candidate2`、`candidate4`

---

## 附录 A：koi-ui 原始组件清单

| # | 组件 | 文件 | 类别 | 状态 |
|---|------|------|------|------|
| 1 | KoiCard | `KoiCard/Index.vue` | Layout | → AdminPageCard ✓ |
| 2 | KoiDialog | `KoiDialog/Index.vue` | Overlay | → shadcn Dialog ✓ |
| 3 | KoiDrawer | `KoiDrawer/Index.vue` | Overlay | → shadcn Sheet ✓ |
| 4 | KoiToolbar | `KoiToolbar/Index.vue` | Layout | → AdminIconButton ✓ |
| 5 | KoiTag | `KoiTag/Index.vue` | Data Display | → AdminStatusTag ✓ |
| 6 | KoiSearch | `KoiSearch/Index.vue` | Layout | → AdminSearchPanel ✓ |
| 7 | KoiLoading | `KoiLoading/Index.vue` | Feedback | → Skeleton/Spinner ✓ |
| 8 | KoiExcel | `KoiExcel/Index.vue` | Data Import | → ImportWizard ✓ |
| 9 | KoiUpload/Files | `KoiUpload/Files.vue` | Data Import | → custom upload ✓ |
| 10 | KoiUpload/Image | `KoiUpload/Image.vue` | Data Import | → custom upload ✓ |
| 11 | KoiUpload/Images | `KoiUpload/Images.vue` | Data Import | → custom upload ✓ |
| 12 | KoiScrollNav | `KoiScrollNav/Index.vue` | Navigation | → ScrollableTabs ✓ |
| 13 | KoiGlobalIcon | `KoiGlobalIcon/Index.vue` | Utility | Lucide 覆盖 |
| 14 | KoiSvgIcon | `KoiSvgIcon/Index.vue` | Utility | Lucide 覆盖 |
| 15 | KoiSelectIcon | `KoiSelectIcon/Index.vue` | Form | Phase 1 不需要 |
| 16 | KoiTagFilter | `KoiTagFilter/Index.vue` | Filter | → toggle chips ✓ |
| 17 | KoiShellHeaderActions | `KoiWindowShell/` | Window Shell | 不需要 |
| 18 | KoiShellMinimizedDock | `KoiWindowShell/` | Window Shell | 不需要 |
| 19 | KoiSearchMenu | (header component) | Navigation | → SearchMenu (Command) ✓ |

## 附录 B：koi-ui 源码参考路径

```
/home/hoo/Source/_refs/koi-ui/src/
├── components/          # 18 个组件（详见 §5 + 附录 A）
├── layouts/             # 6 种布局模式（vertical/horizontal/columns/classic/optimum/mobile）
├── styles/
│   ├── theme-vars.scss  # 亮/暗/反转主题变量
│   ├── transition.scss  # 10+ 动画 keyframes
│   ├── reset.scss       # 全局重置
│   └── variable.scss    # 布局尺寸变量
├── views/
│   ├── home/            # 仪表盘（stat cards + charts）
│   ├── login/           # 登录页（玻璃拟态 + 浮动光斑）
│   └── system/          # CRUD 页面样板
├── directives/          # throttle/debounce/copy/watermark/draggable/adaptive
└── composables/         # useKoiWindowShell
```
