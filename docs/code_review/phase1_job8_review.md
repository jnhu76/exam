# Job 8 代码评审报告

## 评审范围

评审 `phase1-job8-score-management` 合并到 `dev` 的变更，涵盖：

- 成绩列表 API（分页、排序、筛选、统计）
- CSV 导出 API（动态表头、审计日志）
- 成绩管理页面（ScoreListPage）
- 成绩详情页面（AttemptDetailPage）
- Repository 层扩展（attemptRepo）
- CSV 工具库（import-export/csv）

## 评审结果

发现 3 个需修复的问题（2 个 Important，1 个 Critical），修复后分支可合并。

## 需修复问题

### R1: listGradedByExam 参数未生效

**严重程度:** Critical

`attemptRepo.listGradedByExam` 接受 `sortBy`、`sortOrder`、`limit`、`offset` 参数，但实现中完全没有使用这些参数。所有调用方传入的分页、排序、筛选参数被静默忽略，导致：

- 成绩列表 API 的分页不生效（始终返回全部数据）
- 排序参数无效
- 分页参数无效

**修复:** 在 `(db as any)` 查询链中应用这些参数。

### R2: scores.ts 重复查询全量数据

**严重程度:** Important

`GET /api/exams/:id/scores` 路由中，为计算统计数据调用了两次 `listGradedByExam`：

- 第一次带分页参数获取 `results`
- 第二次不带参数获取 `allGraded` 来计算平均分、最高分、最低分、及格率

这导致每次请求都会执行两次数据库查询，其中一次是全量扫描。

**修复:** 改为单次查询获取统计数据（使用 SQL 聚合函数），或在单次全量查询后在内存中分页。

### R3: export.ts 缺少审计日志

**严重程度:** Important

`GET /api/exams/:id/export/scores` 路由导出 CSV 后没有写入 AuditLog。任务要求明确规定导出操作必须记录审计日志。

**修复:** 导出完成后调用 `auditLogRepo.create` 记录操作。

## 已修复问题（评审期间）

无。

## 验证结果

- `pnpm typecheck`：通过
- `pnpm test`：通过（API 89、Web 100、DB 17、Auth 8）
- `pnpm verify`：通过
- `git diff --check`：通过

## 建议改进（非阻塞）

### S1: (db as any) 类型断言

`attemptRepo.ts` 中使用了 `(db as any)` 来绕过 Drizzle 的类型检查。虽然功能正确，但降低了类型安全性。建议后续找机会用正确的 Drizzle 类型替代。
