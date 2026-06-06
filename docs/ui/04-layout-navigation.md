# Layout & Navigation

## Layout Architecture

### Admin/Teacher Layout (AdminLayout)

```
┌─────────────────────────────────────────────┐
│ Topbar (h-14, border-b)                     │
├────────┬────────────────────────────────────┤
│        │                                    │
│ Side   │  Main Content (p-6)                │
│ bar    │                                    │
│ w-56   │                                    │
│        │                                    │
│        │                                    │
└────────┴────────────────────────────────────┘
```

### Candidate Layout (ExamLayout)

```
┌─────────────────────────────────────────────┐
│ Minimal Header (brand + user)               │
├─────────────────────────────────────────────┤
│                                             │
│  Full-width Content                         │
│                                             │
└─────────────────────────────────────────────┘
```

## Sidebar Rules

| Rule | Value |
|------|-------|
| Width (expanded) | `w-56` (224px) |
| Width (collapsed) | `w-14` (56px), icon-only |
| Brand display | Top of sidebar, show `productName` |
| Brand repeat in topbar | **Forbidden** — brand shown only in sidebar |
| Navigation groups | Separated by `Separator` + group label |
| Group label style | `text-xs text-muted-foreground uppercase tracking-wider` |
| Nav item default | `text-muted-foreground` icon + text |
| Nav item hover | `bg-accent text-foreground` |
| Nav item active | `bg-primary/10 text-primary` for both icon and text |
| Bottom area | User avatar + display name + logout |
| Icon library | lucide-react only, default gray |

### Sidebar Group Structure

```
── 题库 ──            ← muted group label
  课程管理            ← nav item
  题目管理
  题目导入

── 考试 ──
  考试管理
  成绩查询

── 管理 ──            ← Admin only
  机构管理            ← SuperAdmin only
  用户管理
  考生管理
  平台设置
  考生字段
  系统状态
```

## Topbar Rules

| Rule | Value |
|------|-------|
| Height | `h-14` (56px) |
| Border | `border-b` |
| Background | `bg-background` or `bg-card` |
| Content left | Page title or breadcrumb |
| Content right | Notifications icon (optional), user avatar dropdown |
| Brand name | **Do not repeat** — it's in the sidebar |

## Page Structure

Every admin page follows this pattern:

```
┌─────────────────────────────────────────┐
│ PageHeader                               │
│   title (text-2xl)  + action buttons    │
├─────────────────────────────────────────┤
│ Filter bar (optional)                    │
│   Select / Input / Search               │
├─────────────────────────────────────────┤
│ Content area                             │
│   Cards / Table / Form                   │
├─────────────────────────────────────────┤
│ Pagination (optional)                    │
├─────────────────────────────────────────┤
│ Stats bar (optional)                     │
│   Summary statistics                     │
└─────────────────────────────────────────┘
```

### PageHeader Component

- Title: `text-2xl font-semibold`
- Description: `text-sm text-muted-foreground` (optional)
- Actions: aligned right, primary button first

### Content Backgrounds

| Area | Background |
|------|-----------|
| Page background | `bg-background` (light gray) |
| Card / surface | `bg-card` (white) |
| Main content area | No explicit bg — inherits page |

## Empty / Loading / Error States

Every list page must handle three states:

- **Loading**: `<Skeleton />` placeholders
- **Empty**: `<EmptyState />` with icon, message, and CTA button
- **Error**: `<ErrorState />` with message and retry button

## Candidate-Facing Layout

Exam pages use minimal chrome:

- Header: product name left, user name right
- No sidebar, no navigation
- Full-width content area
- Answer page: fixed left panel (question nav) + scrollable right (question content)
