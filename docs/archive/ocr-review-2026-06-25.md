# OCR Code Review Report

**日期：** 2026-06-25
**审查工具：** [open-code-review](https://github.com/alibaba/open-code-review) (`ocr`)
**审查目标：** commit `57593789` on branch `fix/unify-diagnostics-pages`
**背景：** 合并 DiagnosticsPage 和 SystemHealthPage 为统一的 SystemDiagnosticsPage，更新路由、侧边栏、AuditLogPage 布局及配置文件

---

## 审查概要

| 指标 | 值 |
|------|-----|
| 审查文件数 | 12 |
| 生成评论数 | 8 |
| Token 消耗 | ~188,560（输入 ~168,424，输出 ~20,136） |
| 耗时 | 1m30s |

---

## 完整审查评论

### 1. apps/web/vite.config.ts:25 — `VITE_PORT=0` 误退回

**问题：** `Number(process.env.VITE_PORT) || 4173` 中，0 在 JS 中是 falsy 值，当 VITE_PORT 设为 '0'（有效端口号，用于随机端口分配）时会错误地回退到 4173。

**原代码：**
```ts
port: Number(process.env.VITE_PORT) || 4173,
```

**修复后：**
```ts
port: process.env.VITE_PORT ? Number(process.env.VITE_PORT) : 4173,
```

**优先级：** Medium — 边缘情况

---

### 2. apps/web/src/pages/admin/AuditLogPage.tsx:143-144 — PageHeader "缺失"

**问题：** LLM 认为 PageHeader 在重构后被移除，仅出现在删除了的早期返回空状态中，未加入新的主渲染结构。

**实际代码验证：** ⚠️ **假阳性** — PageHeader 实际存在于 line 145：
```tsx
<PageHeader title="审计日志" description="查看系统操作审计记录" />
```

**结果：** 已丢弃

---

### 3. apps/web/src/pages/admin/AuditLogPage.tsx:140-141 — `data` 空值检查缺失

**问题：** LLM 认为原有顶层 `data` 的 null 检查被移除，如果 `data` 为 null，`items = data.items` 会抛出 TypeError。

**实际代码验证：** ⚠️ **假阳性** — line 138 使用了可选链：
```tsx
const items = data?.items ?? [];
```
`data?.items ?? []` 确保即使 data 为 null/undefined 也安全默认到 `[]`。

**结果：** 已丢弃

---

### 4. apps/web/src/pages/admin/AuditLogPage.tsx:188-193 — 日期反转逻辑重复

**问题：** 两个 DatePicker 的 onChange 处理器中有类似的日期反转逻辑（from > to 时交换），违反 DRY 原则。

**重复代码：**
```tsx
// fromDate onChange (line 187-195)
onChange={(d) => {
  if (d && toDate && d > toDate) {
    setFromDate(toDate);
    setToDate(d);
  } else {
    setFromDate(d);
  }
  setPage(1);
}}

// toDate onChange (line 201-208)
onChange={(d) => {
  if (d && fromDate && d < fromDate) {
    setToDate(fromDate);
    setFromDate(d);
  } else {
    setToDate(d);
  }
  setPage(1);
}}
```

**修复后：**
```tsx
const handleDateChange = useCallback(
  (newDate: Date | undefined, isStartDate: boolean) => {
    if (isStartDate && newDate && toDate && newDate > toDate) {
      setFromDate(toDate);
      setToDate(newDate);
    } else if (!isStartDate && newDate && fromDate && newDate < fromDate) {
      setToDate(fromDate);
      setFromDate(newDate);
    } else if (isStartDate) {
      setFromDate(newDate);
    } else {
      setToDate(newDate);
    }
    setPage(1);
  },
  [fromDate, toDate],
);

<DatePicker
  aria-label="开始日期"
  placeholder="开始日期"
  value={fromDate}
  onChange={(d) => handleDateChange(d, true)}
/>
<DatePicker
  aria-label="结束日期"
  placeholder="结束日期"
  value={toDate}
  onChange={(d) => handleDateChange(d, false)}
/>
```

**优先级：** Medium — 代码质量（DRY）

---

### 5. apps/web/src/pages/admin/SystemDiagnosticsPage.tsx:69-75 — 轮询错误静默吞掉（健康检查）

**问题：** `loadHealth` 的 catch 块在初始加载完成后静默吞掉所有轮询错误。用户将看到过期的健康数据而无任何提示。

**原代码：**
```tsx
const loadHealth = useCallback(async () => {
  try {
    setHealth(await api.get<SystemHealthResponse>("/api/system/health"));
  } catch {
    if (!initialLoadDone.current) setError("加载系统健康数据失败");
  }
}, []);
```

**修复后（Stale Warning 方案）：**
```tsx
const loadHealth = useCallback(async () => {
  try {
    setHealth(await api.get<SystemHealthResponse>("/api/system/health"));
    setStaleWarning(null);
  } catch {
    if (!initialLoadDone.current) setError("加载系统健康数据失败");
    else setStaleWarning("系统状态刷新失败，当前显示上次成功数据");
  }
}, []);
```

**优先级：** Medium — 影响用户体验

> **设计决策：** 未使用 `console.error`（被代码质量检查 `scripts/check-code-quality.mjs` 禁止），改为 UI stale warning banner。

---

### 6. apps/web/src/pages/admin/SystemDiagnosticsPage.tsx:77-90 — 轮询错误静默吞掉（诊断数据）

**问题：** 同上，`loadDiag` 的 catch 块在初始加载完成后静默吞掉轮询错误。

**原代码：**
```tsx
} catch {
  if (!initialLoadDone.current) setError("加载诊断数据失败");
}
```

**修复后：**
```tsx
} catch {
  if (!initialLoadDone.current) setError("加载诊断数据失败");
  else setStaleWarning("诊断数据刷新失败，当前显示上次成功数据");
}
```

**优先级：** Medium

---

### 7. apps/web/src/pages/admin/SystemDiagnosticsPage.tsx:140-147 — 状态色号类名重复

**问题：** 组件主体和 MetricCard 组件中有相同 pattern 的 tone → Tailwind class 映射逻辑。

**重复代码（组件主体）：**
```tsx
className={cn(
  "flex items-center gap-1 text-sm font-medium",
  statusView.tone === "success" && "text-success",
  statusView.tone === "warning" && "text-warning",
  statusView.tone === "destructive" && "text-destructive",
)}
```

**重复代码（MetricCard）：**
```tsx
className={cn(
  "mt-1 flex items-center gap-1 text-xs font-medium",
  meta.tone === "success" && "text-success",
  meta.tone === "warning" && "text-warning",
  meta.tone === "destructive" && "text-destructive",
)}
```

**修复后（statusMeta.ts 新增 `getToneTextColor`）：**
```ts
export function getToneTextColor(tone: StatusTone): string {
  return cn(
    tone === "success" && "text-success",
    tone === "warning" && "text-warning",
    tone === "destructive" && "text-destructive",
  );
}
```

**使用：**
```tsx
className={cn(
  "flex items-center gap-1 text-sm font-medium",
  getToneTextColor(statusView.tone),
)}
```

**优先级：** Medium — 代码质量（DRY）

---

### 8. apps/web/src/pages/admin/SystemDiagnosticsPage.tsx:334-341 — MetricCard 中相同重复

**问题：** 同上，MetricCard 组件中 status tone → Tailwind class 映射逻辑重复。

**修复后：**
```tsx
className={cn(
  "mt-1 flex items-center gap-1 text-xs font-medium",
  getToneTextColor(meta.tone),
)}
```

**优先级：** Medium

---

## 处理决策总结

| 评论 | 优先级 | 处理方式 | 理由 |
|------|--------|----------|------|
| #1 VITE_PORT=0 | Medium | ✅ 已修复 | 明确的边缘 bug |
| #2 PageHeader 缺失 | 假阳性 | ❌ 已丢弃 | 代码中存在 PageHeader |
| #3 data null check | 假阳性 | ❌ 已丢弃 | 使用可选链 `?.` |
| #4 日期逻辑重复 | Medium | ✅ 已修复 | 抽取 `handleDateChange` |
| #5 轮询错误静默（健康） | Medium | ✅ 已修复 | 添加 stale warning UI banner |
| #6 轮询错误静默（诊断） | Medium | ✅ 已修复 | 同上 |
| #7 状态色号重复（主体） | Medium | ✅ 已修复 | 抽取 `getToneTextColor()` |
| #8 状态色号重复（MetricCard） | Medium | ✅ 已修复 | 同上 |

---

## 验证结果

| 检查 | 结果 |
|------|------|
| `pnpm lint` | ✅ 通过 |
| `pnpm lint:copy` | ✅ 无硬编码业务文案 |
| `pnpm lint:arch` | ✅ 架构检查通过 |
| `pnpm typecheck` | ✅ 15/15 任务通过 |

---

## 已知限制

1. **前端无日志设施：** 轮询失败后未使用 `console.error`（被 `scripts/check-code-quality.mjs` 禁止），前端无集中日志采集设施，改用 UI stale warning 方案
2. **状态色号抽取有限：** `getToneTextColor` 仅覆盖 success/warning/destructive 三种 tone，其他 tone（primary/secondary/info/muted）未覆盖
