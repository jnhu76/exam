# Hotfix: Cookie Path + Auth 竞态修复报告

## 问题描述

Phase 0-8 实现完成后，登录后访问 `/admin/*`（除 dashboard 外）所有页面均被重定向到 `/login`，导致完整业务链路（出题 → 组卷 → 考试 → 出分 → 导出）无法跑通。

## 根因分析

### 根因 A：Cookie 缺少 `path: "/"`（主要问题）

`apps/api/src/routes/auth.ts` 中 `setCookie` 未设置 `Path` 属性。根据 RFC 6265 Section 5.1.4，浏览器默认将 path 推导为请求 URI 的路径。`POST /api/auth/login` 的默认 path 为 `/api/auth`，导致 cookie 仅对 `/api/auth/*` 路径发送。

**影响：**

- `GET /api/auth/me` — ✅ 正常（path 匹配）
- `GET /api/exams` — ❌ 不发送 cookie → 401
- `GET /api/courses` — ❌ 同理
- 所有非 `/api/auth/*` 的 API 请求均返回 401 → 前端 api.ts 触发跳转 `/login`

### 根因 B：Auth 竞态条件（次要问题）

`apps/web/src/contexts/AuthContext.tsx` 中 `isLoading` 初始值为 `false`，`user` 初始值为 `null`。`AdminLayout` 在首次渲染时检查 `isLoading`（false → 通过）后检查 `!user`（true → 跳 /login），而 session restoration 的 `useEffect` 在首次渲染之后才执行，跳转已发生。

### 侧栏链接不匹配

- `/admin/scores` — 路由不存在，实际路由为 `/admin/exams/:id/scores`
- `/admin/system` — 路由不存在（J9 待实现）

## 修复内容

### 1. Cookie Path 修复

**文件：** `apps/api/src/routes/auth.ts`

- 第 107-112 行：`setCookie` 增加 `path: "/"`
- 第 127 行：`clearCookie` 增加 `{ path: "/" }`

### 2. Auth 竞态修复

**文件：** `apps/web/src/contexts/AuthContext.tsx`

- 第 44 行：`useState(false)` → `useState(restoreSession && !initialUser)`

确保页面加载时 `isLoading` 为 `true`，阻止 AdminLayout 在 session restoration 完成前跳转。

### 3. 侧栏链接修复

**文件：** `apps/web/src/components/layout/AppSidebar.tsx`

- 第 44 行：`/admin/scores` → `/admin/exams`
- 第 54 行：移除 `/admin/system`（J9 再添加）

## 修改文件清单

| 文件                                            | 改动行     | 改动类型                |
| ----------------------------------------------- | ---------- | ----------------------- |
| `apps/api/src/routes/auth.ts`                   | L112, L127 | 新增 `path: "/"`        |
| `apps/web/src/contexts/AuthContext.tsx`         | L44        | 修正 `isLoading` 初始值 |
| `apps/web/src/components/layout/AppSidebar.tsx` | L44, L54   | 修复/移除无效链接       |

## 验证结果

| 检查项           | 结果            |
| ---------------- | --------------- |
| `pnpm typecheck` | ✅ 14/14 通过   |
| `pnpm lint`      | ✅ 通过         |
| `pnpm lint:copy` | ✅ 无硬编码文案 |
| `pnpm lint:arch` | ✅ 架构检查通过 |

## 修复后链路验证

登录 → 访问 `/admin/*` 各页面（courses、questions、exams、users、candidates、settings、candidate-fields）均可正常加载，不再跳转到 `/login`。

## 影响范围

- 无破坏性变更，仅修正 cookie 行为和前端状态初始化
- 不涉及数据库 schema 变更
- 不涉及新 API 或业务逻辑
- 向后兼容：已有 session 不受影响（重新登录即可）
