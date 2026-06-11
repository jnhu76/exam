# Layout System

> 本文档定义项目的布局系统规则。所有 UI 实施必须遵守。

---

## 1. 两套 Shell

项目有两套独立的 Shell，分别服务不同的用户场景：

| Shell | 服务对象 | 用途 |
|-------|----------|------|
| AdminShell | Admin / Teacher / SuperAdmin | 管理后台 |
| ExamShell | Candidate | 考试答题 |

**核心规则**：Exam Runtime 不能强行套 Admin Sidebar。两套 Shell 完全独立。

---

## 2. AdminShell

### 2.1 结构

```
AdminShell
├── AppSidebar (左侧导航)
│   ├── BrandMark (logo slot)
│   ├── SidebarCollapseButton (折叠按钮)
│   ├── NavItem[] (导航项)
│   └── UserSection (用户信息 + 退出)
├── AppTopbar (顶部栏)
│   ├── PageTitle (页面标题)
│   └── UserMenu (用户菜单)
└── PageContainer (内容区域)
    └── <Outlet /> (子路由)
```

### 2.2 组件职责

| 组件 | 职责 | 文件位置 |
|------|------|----------|
| AdminLayout | Shell 容器，管理 collapsed 状态 | `components/layout/AdminLayout.tsx` |
| AppSidebar | 左侧导航，包含 logo 和菜单 | `components/layout/AppSidebar.tsx` |
| BrandHeader | 品牌标识 slot | `components/layout/BrandHeader.tsx` |
| BrandProvider | 品牌信息上下文 | `components/layout/BrandProvider.tsx` |

### 2.3 Sidebar 结构

```tsx
<aside className="flex min-h-screen shrink-0 flex-col border-r bg-card transition-[width]">
  {/* 顶部区域：BrandMark + CollapseButton */}
  <div className="flex min-h-14 items-center px-2">
    <BrandHeader compact={collapsed} />
    {onCollapse && !collapsed && (
      <Button variant="ghost" size="icon" onClick={onCollapse}>
        <ChevronLeft />
      </Button>
    )}
    {onCollapse && collapsed && (
      <Button variant="ghost" size="icon" onClick={onCollapse}>
        <ChevronRight />
      </Button>
    )}
  </div>

  {/* 导航区域 */}
  <nav className="flex-1 flex flex-col gap-1 overflow-y-auto px-2 py-2">
    {/* 分组导航 */}
  </nav>

  {/* 底部区域：用户信息 + 退出 */}
  <div className="p-2">
    {/* 用户头像 + 名字 */}
    {/* 退出按钮 */}
  </div>
</aside>
```

### 2.4 Topbar 结构

```tsx
<header className="flex h-14 items-center border-b bg-card px-6">
  <h2 className="text-sm font-medium text-muted-foreground">
    {topbarTitle}
  </h2>
</header>
```

---

## 3. ExamShell

### 3.1 结构

```
ExamShell
├── ExamTopbar (顶部栏)
│   ├── BrandMark (logo)
│   ├── Navigation (导航链接)
│   └── UserSection (用户信息 + 退出)
└── ExamContent (考试内容区域)
    └── <Outlet /> (子路由)
```

### 3.2 组件职责

| 组件 | 职责 | 文件位置 |
|------|------|----------|
| ExamLayout | Shell 容器 | `components/layout/ExamLayout.tsx` |

### 3.3 Topbar 结构

```tsx
<header className="flex h-14 items-center justify-between border-b bg-card px-6">
  <BrandHeader />
  <div className="flex items-center gap-2">
    {/* 导航链接 */}
    {/* 分隔线 */}
    {/* 用户信息 */}
    {/* 退出按钮 */}
  </div>
</header>
```

---

## 4. BrandMark / Logo

### 4.1 独立 Slot

BrandMark 是一个**独立 slot**，不是 collapse button 的伪装。

### 4.2 当前实现

```tsx
// BrandHeader.tsx
export function BrandHeader({ compact = false }: { compact?: boolean }) {
  const branding = useBranding();

  return (
    <div className={cn("flex items-center gap-2", compact && "justify-center")}>
      <PanelLeft className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className={cn("text-sm font-semibold", compact && "sr-only")}>
        {branding.productName}
      </span>
    </div>
  );
}
```

### 4.3 问题

1. 使用 `PanelLeft` 图标作为 logo，这是 collapse icon 的语义
2. collapsed 时显示 sr-only 文字，但 logo 区域被 collapse button 占据
3. 没有独立的 logo slot

### 4.4 期望行为

- expanded sidebar：显示 logo + 品牌名称
- collapsed sidebar：只显示 logo 图标
- collapse button 在 logo 区域之外
- BrandMark 有稳定的 fallback（当远程加载失败时）

---

## 5. SidebarCollapseButton

### 5.1 独立 Control

SidebarCollapseButton 是一个**独立 control**，不能占据 logo 位置。

### 5.2 当前实现

```tsx
// AppSidebar.tsx
{onCollapse && !collapsed && (
  <Button variant="ghost" size="icon" className="ml-auto" onClick={onCollapse}>
    <ChevronLeft />
  </Button>
)}
{onCollapse && collapsed && (
  <Button variant="ghost" size="icon" onClick={onCollapse}>
    <ChevronRight />
  </Button>
)}
```

### 5.3 问题

1. collapse button 在 BrandHeader 旁边，视觉上和 logo 混在一起
2. collapsed 时 collapse button 占据了 logo 的位置

### 5.4 期望行为

- collapse button 始终在 BrandMark 旁边，但不在 BrandMark 内部
- collapsed 时 BrandMark 仍然显示（只是缩小为图标）
- collapse button 在 collapsed 状态下仍然可见

---

## 6. NavItem

### 6.1 结构

```tsx
<NavLink
  to={item.to}
  end={item.end}
  title={collapsed ? item.label : undefined}
  className={({ isActive }) =>
    cn(
      "flex min-h-10 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
      isActive && "bg-primary/10 font-medium text-primary",
    )
  }
>
  <Icon className="size-4 shrink-0" aria-hidden="true" />
  {!collapsed && <span>{item.label}</span>}
</NavLink>
```

### 6.2 规则

- 所有 NavItem 必须有 icon
- collapsed 时只显示 icon，expanded 时显示 icon + label
- active 状态使用 `bg-primary/10 text-primary`
- hover 状态使用 `bg-accent text-foreground`

---

## 7. PageContainer

### 7.1 结构

```tsx
<main className="p-6">
  <Outlet />
</main>
```

### 7.2 规则

- 所有页面内容必须放在 PageContainer 内
- PageContainer 使用 `p-6` 作为内边距
- 页面内容不能直接写在 Shell 内

---

## 8. Loading 状态

### 8.1 AdminShell Loading

```tsx
if (isLoading) {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="flex w-56 shrink-0 flex-col border-r bg-card">
        <div className="p-2">
          <Skeleton className="h-5 w-16" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center border-b bg-card px-6">
          <Skeleton className="h-4 w-24" />
        </header>
        <main className="flex flex-col gap-4 p-6">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </main>
      </div>
    </div>
  );
}
```

### 8.2 ExamShell Loading

```tsx
if (isLoading) {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 items-center justify-between border-b bg-card px-6">
        <BrandHeader />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="mx-2 h-4 w-px" />
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-8 w-12 rounded-md" />
        </div>
      </header>
    </div>
  );
}
```

---

## 9. 响应式规则

### 9.1 Sidebar

- 默认宽度：`w-56`（expanded）/ `w-14`（collapsed）
- 使用 `transition-[width]` 做平滑过渡
- 使用 `shrink-0` 防止被压缩

### 9.2 内容区域

- 使用 `min-w-0 flex-1` 确保内容区域不会溢出
- 使用 `overflow-y-auto` 允许滚动

### 9.3 最小宽度

- 页面最小宽度：`min-h-screen`
- 内容区域最小宽度：`min-w-0`
