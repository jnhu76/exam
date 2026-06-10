# Review Profile: Backend DB Async

## 1. Applicable Scope

本 profile 适用于：

- repository async 化；
- SQLite / PostgreSQL 双方言支持；
- Drizzle query 构造；
- Fastify route handler 调用 repository；
- auth / tenant context 相关 DB 访问；
- audit log / heartbeat / background job；
- exam / candidate / enrollment / attempt 数据链路；
- repository contract 测试。

典型路径：

- `packages/db/src/repository/**`
- `apps/api/src/routes/**`
- `apps/api/src/plugins/**`
- `packages/exam-engine/src/**`
- `*.test.ts`

## 2. Technology Context

- TypeScript
- Fastify
- Drizzle ORM
- SQLite
- PostgreSQL
- Repository pattern
- Tenant / Request context

## 3. Core Risk Areas

### 3.1 Repository Nullable Contract

重点检查：

- `findById`
- `findByOrganizationAndId`
- `update`
- `delete`
- `create` 后重新读取

危险模式：

```ts
const x = await repo.findById(ctx, id) as Entity;
const x = (await repo.findById(ctx, id))!;
await repo.update(ctx, id, patch);
return { ok: true };
```

要求：

- nullable return 必须显式处理；
- `update()` 返回 `null` 时不能返回成功；
- `delete()` 返回 `false` 时不能返回成功；
- route 层应返回 domain error 或明确 HTTP status；
- 新增 null branch 必须有测试。

### 3.2 Async / Promise / Fire-and-forget

重点检查：

- async function 是否漏 `await`；
- fire-and-forget 是否 `.catch()`；
- background job 是否防重入；
- `setInterval(async () => ...)` 是否处理异常；
- audit 写入失败是否有结构化日志。

危险模式：

```ts
recordAudit(...);
setInterval(async () => {
  await scan();
}, interval);
void someAsyncCall();
```

要求：

- 故意 fire-and-forget 必须 catch；
- catch 必须使用结构化日志；
- 不允许 unhandled rejection；
- background job 需要重入保护。

### 3.3 Auth / Permission / DB Error Semantics

危险模式：

```ts
try {
  const payload = verifyJwt(token);
  const user = await userRepo.findByOrganizationAndId(...);
} catch {
  return reply.code(401).send(...);
}
```

要求：

- JWT invalid → 401；
- user not found → 401 / 404；
- permission denied → 403；
- repo / DB error → 500；
- 不允许把 DB error 当成 auth failure。

### 3.4 SQLite / PostgreSQL Dual Dialect

重点检查：

- SQLite schema column 是否误用于 PG branch；
- PG schema column 是否误用于 SQLite branch；
- boolean / date / json / count / returning 差异；
- `where` / `orderBy` / `limit` / `offset` / `count` 是否按方言构造；
- PG 分支是否有测试或至少有明确验证计划。

危险模式：

```ts
const finalWhere = eq(sqliteAttempts.passed, true);

if (isSqlite(db)) {
  return sqliteQuery.where(finalWhere);
}

return pgQuery.where(finalWhere);
```

要求：

- 方言分支内构造对应 schema 的条件；
- 不要跨方言复用 column expression；
- 对 PG 分支不能只依赖 SQLite 测试。

### 3.5 Query Scale / N+1 / Memory Pagination

重点检查：

- `list(ctx).filter(...)`；
- `select all` 后 `.length`；
- `select all` 后 `.sort()` / `.slice()`；
- 每个父对象循环 `findById`；
- import 前全表加载；
- 热路径里 JS 内存排序分页。

危险模式：

```ts
const all = await repo.list(ctx);
return all.filter(x => x.examId === examId);

const total = rows.length;

return Promise.all(items.map(item => repo.findById(ctx, item.id)));
```

要求：

- 热路径使用 SQL `WHERE` 下推；
- count 使用 SQL `count(*)`；
- pagination 使用 SQL `limit` / `offset`；
- enrichment 使用 batch query 或 `IN (...)`；
- 如果当前 PR 不处理性能债，必须记录 follow-up，不要顺手扩大范围。

### 3.6 Test Contract

重点检查：

- `rejects.toThrow()` 是否太宽；
- 是否断言具体 domain error；
- 是否覆盖 repo.update 返回 null；
- 是否覆盖 findById 返回 null；
- 是否覆盖 DB error；
- 是否覆盖 PG branch；
- 是否覆盖大 org / batch / import。

危险模式：

```ts
await expect(fn()).rejects.toThrow();
```

优先：

```ts
await expect(fn()).rejects.toThrow(ValidationError);
```

## 4. Known Historical Failure Patterns

本项目已经发生过或被 review 发现过：

- JWT 验证和 DB 查询放在同一个 try/catch，导致 DB error 被当成 401；
- `findById()` 返回 null 后被 `as Entity` 或 `!` 掩盖；
- `recordAudit()` fire-and-forget 未 catch rejection；
- SQLite where condition 被复用到 Postgres branch；
- `repo.update()` 返回 null 后上层仍返回成功；
- `rejects.toThrow()` 太泛，没有锁定具体错误类型；
- `list().filter()` 在 route 层造成全表加载；
- `select all` 后 `.length` / `.sort()` / `.slice()`；
- PG branch 没有被 SQLite-only 测试覆盖。

## 5. Review Output Requirement

当本 profile 被加载时，reviewer 必须使用：

| 文件/位置 | 问题 | 严重程度 | 当前 PR 引入？ | 是否 blocking | 处理决策 | 最小修复 |
|---|---|---|---|---|---|---|

处理决策只能是：

- `Fix now`
- `Add test now`
- `Defer issue`
- `Investigate`
- `Reject`

## 6. Scope Discipline

禁止：

- 把历史债标为当前 PR blocker；
- 没有证据就标 Critical；
- 因为性能债要求当前 PR 大重构；
- 把架构展望塞进当前 PR；
- 把误报沉淀为长期规则；
- 加载与当前 PR 无关的 profile sections。
