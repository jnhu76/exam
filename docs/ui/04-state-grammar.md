# State Grammar

> 本文档定义项目的状态语法规则。所有 UI 实施必须遵守。

---

## 1. 状态集中管理

所有状态的 label / color / icon / tone **不能散落在页面里**，必须集中到 `statusMeta` 或等价结构。

`StatusBadge` 只能消费统一 metadata。

### 1.1 实现方式

```ts
// statusMeta 集中定义
export const statusMeta = {
  draft: { label: "草稿", color: "muted", icon: "FileEdit" },
  published: { label: "已发布", color: "primary", icon: "Globe" },
  open: { label: "开放中", color: "success", icon: "LockOpen" },
  closed: { label: "已关闭", color: "secondary", icon: "Lock" },
  archived: { label: "已归档", color: "muted", icon: "Archive" },
  assigned: { label: "已分配", color: "primary", icon: "UserPlus" },
  started: { label: "已开始", color: "success", icon: "Play" },
  completed: { label: "已完成", color: "secondary", icon: "CheckCircle" },
  blocked: { label: "已阻止", color: "destructive", icon: "Ban" },
  not_started: { label: "未开始", color: "muted", icon: "Circle" },
  queued: { label: "排队中", color: "warning", icon: "Clock" },
  in_progress: { label: "答题中", color: "primary", icon: "Edit" },
  disrupted: { label: "断线", color: "warning", icon: "WifiOff" },
  submitted: { label: "已交卷", color: "secondary", icon: "Send" },
  grading: { label: "批改中", color: "primary", icon: "Loader" },
  graded: { label: "已出分", color: "success", icon: "Check" },
  voided: { label: "已作废", color: "destructive", icon: "Trash" },
  saving: { label: "保存中", color: "warning", icon: "Loader" },
  saved: { label: "已保存", color: "success", icon: "Check" },
  failed: { label: "保存失败", color: "destructive", icon: "X" },
  cancelled: { label: "已取消", color: "muted", icon: "XCircle" },
  expired: { label: "已过期", color: "destructive", icon: "Clock" },
  stale: { label: "过期数据", color: "warning", icon: "AlertTriangle" },
  unknown: { label: "未知", color: "muted", icon: "HelpCircle" },
} as const;

export type StatusKey = keyof typeof statusMeta;
```

### 1.2 StatusBadge 组件

```tsx
import { statusMeta } from "@/lib/statusMeta";
import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: StatusKey }) {
  const meta = statusMeta[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
        meta.color === "primary" && "bg-primary/10 text-primary",
        meta.color === "secondary" && "bg-secondary text-secondary-foreground",
        meta.color === "success" && "bg-success/10 text-success",
        meta.color === "warning" && "bg-warning/10 text-warning",
        meta.color === "destructive" && "bg-destructive/10 text-destructive",
        meta.color === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {meta.label}
    </span>
  );
}
```

---

## 2. 考试相关状态

### 2.1 Exam 状态

| 状态 | 含义 | 颜色 tone | 图标 |
|------|------|-----------|------|
| `draft` | 草稿 | muted | FileEdit |
| `published` | 已发布 | primary | Globe |
| `open` | 开放中 | success | LockOpen |
| `closed` | 已关闭 | secondary | Lock |
| `archived` | 已归档 | muted | Archive |

### 2.2 ExamEnrollment 状态

| 状态 | 含义 | 颜色 tone | 图标 |
|------|------|-----------|------|
| `assigned` | 已分配 | primary | UserPlus |
| `started` | 已开始 | success | Play |
| `completed` | 已完成 | secondary | CheckCircle |
| `blocked` | 已阻止 | destructive | Ban |

### 2.3 ExamAttempt 状态

| 状态 | 含义 | 颜色 tone | 图标 |
|------|------|-----------|------|
| `not_started` | 未开始 | muted | Circle |
| `queued` | 排队中 | warning | Clock |
| `in_progress` | 答题中 | primary | Edit |
| `disrupted` | 断线 | warning | WifiOff |
| `submitted` | 已交卷 | secondary | Send |
| `grading` | 批改中 | primary | Loader |
| `graded` | 已出分 | success | Check |
| `voided` | 已作废 | destructive | Trash |

---

## 3. 保存状态

### 3.1 Answer Save Protocol 状态

| 状态 | 含义 | 颜色 tone | 图标 |
|------|------|-----------|------|
| `saving` | 保存中 | warning | Loader |
| `saved` | 已保存 | success | Check |
| `failed` | 保存失败 | destructive | X |

### 3.2 实现规则

- 保存状态必须显示在答题页面
- 保存中显示 loading 图标
- 保存成功显示绿色勾
- 保存失败显示红色叉 + 重试按钮

---

## 4. 其他状态

### 4.1 通用状态

| 状态 | 含义 | 颜色 tone | 图标 |
|------|------|-----------|------|
| `cancelled` | 已取消 | muted | XCircle |
| `expired` | 已过期 | destructive | Clock |
| `stale` | 过期数据 | warning | AlertTriangle |
| `unknown` | 未知 | muted | HelpCircle |

### 4.2 页面加载状态

| 状态 | 含义 | 颜色 tone | 图标 |
|------|------|-----------|------|
| `loading` | 加载中 | muted | Loader |
| `error` | 错误 | destructive | AlertTriangle |
| `empty` | 空状态 | muted | Inbox |

---

## 5. 状态流转规则

### 5.1 ExamAttempt 状态机

```
not_started → queued → in_progress → submitted → grading → graded
                                      ↑                    ↓
                                      └── disrupted   voided
```

### 5.2 ExamEnrollment 状态机

```
assigned → started → completed
                  ↘ blocked
```

### 5.3 Answer Save 状态机

```
idle → saving → saved
             ↘ failed → saving → saved
```

---

## 6. 状态显示规则

### 6.1 列表页

- 每行显示 StatusBadge
- StatusBadge 只显示当前状态
- 不显示状态流转历史

### 6.2 详情页

- 页面顶部显示 StatusBadge + 状态 label
- 可选显示状态流转历史（timeline）
- 可选显示状态变更操作按钮

### 6.3 考试答题页

- 顶部显示保存状态
- 使用 ConnectionIndicator 显示连接状态
- 使用 ExamTimer 显示倒计时

---

## 7. 禁止事项

### 7.1 禁止散落状态颜色

```tsx
// 禁止
<div className="bg-green-500 text-white">已通过</div>
<div className="text-red-600">未通过</div>
<div className="border-blue-400">进行中</div>

// 正确
<StatusBadge status="graded" />
```

### 7.2 禁止重复定义状态

```tsx
// 禁止
const statusLabels = {
  draft: "草稿",
  published: "已发布",
  // ...
};

// 正确
import { statusMeta } from "@/lib/statusMeta";
```

### 7.3 禁止使用原始颜色

```tsx
// 禁止
<span className="text-green-600">成功</span>
<span className="text-red-600">失败</span>
<span className="text-yellow-600">警告</span>

// 正确
<StatusBadge status="graded" />
<StatusBadge status="failed" />
<StatusBadge status="warning" />
```
