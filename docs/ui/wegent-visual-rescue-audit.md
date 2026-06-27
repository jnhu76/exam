# Wegent Visual Rescue Audit

> **日期**：2026-06-27
> **问题**：迁移后视觉退化 — 黑色边框、全格线表格、原生按钮感

---

## 黑色边框来源

**根因**：`@theme inline` 块中缺少 `--color-admin-border` 和 `--color-admin-border-light` 定义。

Tailwind v4 的 `border-admin-border` 工具类查找 `--color-admin-border`，但该 token 未在 `@theme inline` 中定义，导致解析为 undefined/black。

| 文件 | 问题 |
|------|------|
| `index.css` | 缺少 `--color-admin-border` 和 `--color-admin-border-light` |
| `admin-theme.css` | 定义了 `--admin-border` 但 Tailwind 不识别（需要 `--color-admin-border`） |

## 全格线表格来源

| 文件 | 行 | 问题 |
|------|-----|------|
| `table.tsx:15` | `[&_th]:border-r [&_th]:border-admin-border-light` | 表头竖线 |
| `table.tsx:15` | `[&_td]:border-r [&_td]:border-admin-border-light` | 单元格竖线 |

## 原生按钮感来源

Button 已迁移到 Wegent 风格（transparent + border），但部分页面仍使用旧的 `variant="default"` 期望 solid bg。

## 裸页面来源

考生端页面（ExamListPage, ResultPage, StartExamPage）没有统一 shell，直接使用裸 `<div>` 布局。

## 需要修复的文件

| 文件 | 修复内容 |
|------|----------|
| `index.css` | 添加 `--color-admin-border` / `--color-admin-border-light` |
| `table.tsx` | 移除全格线，改为行分隔线 |
| `AdminTableShell.tsx` | 确认 token 正确 |
| `ExamListPage.tsx` | 统一 card 样式 |
| `ResultPage.tsx` | 统一 card 样式 |
| `StartExamPage.tsx` | 统一 card 样式 |
| `TakeExamPage.tsx` | 统一 border 样式 |
| `ExamLayout.tsx` | 统一 border 样式 |
