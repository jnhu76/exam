# Review Profile: API Auth Tenant

## 1. Applicable Scope

本 profile 适用于：

- Fastify auth plugin；
- route preHandler / request context；
- tenant / organization scoping；
- user / role / permission 校验；
- auth error 与 DB error 语义区分。

典型路径：

- `apps/api/src/plugins/auth.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/**`
- `packages/db/src/repository/userRepo.ts`

## 2. Core Risk Areas

### 2.1 Error Semantics

重点区分：

- token missing / invalid → 401；
- user not found → 401 或明确 404；
- permission denied → 403；
- repository / DB error → 500；
- tenant mismatch → 403 或 domain error。

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

- JWT 验证和 DB 查询不要放在同一个宽 catch 中；
- DB error 必须 log 并返回 server error；
- auth failure 不应吞掉 repository failure。

### 2.2 Tenant Context

重点检查：

- route handler 是否使用 request ctx；
- repo 调用是否传入正确 organizationId；
- 是否存在裸 userId / organizationId 绕过 Context；
- admin / platform 操作是否有明确边界。

危险模式：

```ts
repo.findById({ organizationId: input.organizationId }, id);
request["ctx"] as RequestContext;
request.ctx!;
```

要求：

- tenant-scoped repo 必须从可信 ctx 获取 organizationId；
- 不允许使用用户输入的 organizationId 作为唯一权限依据；
- `request.ctx!` / `request["ctx"] as ...` 应被类型扩展或明确 preHandler 保证。

### 2.3 Password / Credential Updates

重点检查：

- verifyPassword / hashPassword 调用顺序；
- update 返回 null 是否处理；
- 并发删除用户时是否返回成功；
- error message 是否泄漏账户存在性。

## 3. Known Historical Failure Patterns

- JWT 验证和 repo 查询放在同一个 try/catch，导致 DB error 被当成 401；
- `userRepo.update(...)` 返回 null 后仍返回 `{ ok: true }`；
- route 层使用 `request.ctx!` 依赖 preHandler 顺序。

## 4. Review Output Requirement

| 文件/位置 | 问题 | 严重程度 | 当前 PR 引入？ | 是否 blocking | 处理决策 | 最小修复 |
|---|---|---|---|---|---|---|

处理决策只能是：

- `Fix now`
- `Add test now`
- `Defer issue`
- `Investigate`
- `Reject`
