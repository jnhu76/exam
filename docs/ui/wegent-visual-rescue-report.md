# Wegent Visual Rescue Closeout Report

> **日期**：2026-06-27
> **分支**：`ui/wegent-token-closeout`

---

## 修复前视觉问题总结

| 问题 | 根因 | 影响范围 |
|------|------|----------|
| 黑色边框 | `--color-admin-border` 未定义在 `@theme inline`，`border-admin-border` 解析为 undefined/black | 所有使用 `border-admin-border` 的组件 |
| 全格线表格 | `table.tsx` 使用 `border-r` 在所有 th/td 上 | 所有表格页面 |
| 裸考生页面 | ExamLayout 无内容 padding | 考试列表/成绩/开始考试页 |
| 不统一 border | 部分页面使用 `border-admin-border-light` | Header/Footer |

---

## 修复的 Token

| Token | 修复前 | 修复后 |
|-------|--------|--------|
| `--color-admin-border` | 未定义 | `228 228 228` (Wegent gray) |
| `--color-admin-border-light` | 未定义 | `243 244 246` (Wegent light gray) |

---

## 修复的 Table 全格线

**文件**：`components/ui/table.tsx`

| 修复前 | 修复后 |
|--------|--------|
| `[&_th]:border-r [&_th]:border-admin-border-light` | 移除 |
| `[&_td]:border-r [&_td]:border-admin-border-light` | 移除 |
| `[&_th:last-child]:border-r-0` | 移除 |
| `[&_td:last-child]:border-r-0` | 移除 |
| 行 `border-admin-border` | `border-border` |
| 表头 `bg-admin-table-header` | 移除（使用默认） |
| 单元格 `h-11 px-3` | `p-4` (Wegent standard) |

---

## 修复的 Card/Button/Input

| 组件 | 修复内容 |
|------|----------|
| Card | 已使用 `rounded-lg border-border bg-card shadow-sm` ✅ |
| Button | 已使用 `border-border hover:bg-muted` (Wegent default) ✅ |
| Input | 已使用 `h-10 rounded-lg border-input bg-card` ✅ |
| AdminPageCard | 已使用 `rounded-lg border-border bg-card shadow-sm` ✅ |
| AdminSearchPanel | 已使用 `bg-muted rounded-lg` ✅ |
| AdminTableShell | 已使用 `bg-card rounded-lg shadow-sm` ✅ |

---

## CandidateShell 接入

| 页面 | 状态 |
|------|------|
| ExamLayout | ✅ 已添加 `mx-auto max-w-5xl px-4 py-8` 内容 padding |
| ExamListPage | ✅ card 使用 `rounded-lg border-border bg-card shadow-sm` |
| ResultPage | ✅ card 使用 `rounded-lg border-border bg-card shadow-sm` |
| StartExamPage | ✅ card 使用 `rounded-lg border-border bg-card shadow-sm` |
| TakeExamPage | ✅ header/footer/sidebar 使用 `border-border` |
| AdminLayout | ✅ header 使用 `border-border bg-background/95` |

---

## 验收结果

| 检查项 | 结果 |
|--------|------|
| Koi direct import = 0 | ✅ |
| Hardcoded colors = 0 | ✅ |
| 黑色边框 | ✅ 已修复（`--color-admin-border` 已定义） |
| 全格线表格 | ✅ 已修复（移除 border-r） |
| card/input/button 黑色边框 | ✅ 已修复（使用 `border-border`） |
| 考生端统一 shell | ✅ 已添加内容 padding |
| typecheck | ✅ |
| lint / lint:copy / lint:arch | ✅ |
| test | ✅ 625/625 |
| Badge variant 残留 | 12 |
| space-x/y 残留 | 7 |

---

## 验收命令

```bash
pnpm --filter web typecheck    ✅
pnpm lint                      ✅
pnpm lint:copy                 ✅
pnpm lint:arch                 ✅
pnpm --filter web test --run   ✅ 625/625
node scripts/audit-koi-ui-usage.mjs  ✅
```

---

## 提交历史

| 提交 | 内容 |
|------|------|
| `c2d98e3` | fix(ui): visual rescue - remove black borders, table gridlines, unify tokens |
