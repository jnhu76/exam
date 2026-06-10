# Phase 1.1 Job 01 — API Empty Body + Error Handling

## Goal

修复无 body 请求带 `Content-Type: application/json` 导致 Fastify 报错的问题，并修正后端错误处理。

## Current Symptoms

- `POST /api/exams/:id/publish` 报 `FST_ERR_CTP_EMPTY_JSON_BODY`
- `DELETE /api/courses/:id` 报 `FST_ERR_CTP_EMPTY_JSON_BODY`
- Fastify 400 被包装成 500

## Files to Inspect

```txt
apps/web/src/lib/api.ts
apps/api/src/server.ts
apps/api/src/plugins/*
apps/api/src/routes/*
packages/contracts/src/*
```

## Requirements

### Frontend API Client

- 有 body 时才设置 `Content-Type: application/json`
- body 为 `undefined` 时不设置 content-type
- DELETE 无 body 时不传 `{}`
- POST publish 无 body 时发送真正空请求

### Backend Error Handler

- Fastify parser error 保持 400
- 不要把所有错误包成 500
- 统一错误格式：

```ts
{
  error: {
    code: string;
    message: string;
    details?: unknown;
  }
}
```

## Tests

```txt
[ ] api.post(path) 不设置 JSON content-type
[ ] api.delete(path) 不设置 JSON content-type
[ ] api.post(path, data) 设置 JSON content-type
[ ] publish 不再触发 empty JSON body
[ ] delete course 不再触发 empty JSON body
[ ] Fastify 400 不被包装成 500
```

## Acceptance

```txt
[ ] P0 empty body bug 修复
[ ] 无 body mutation 请求可用
[ ] 前端显示正确错误消息
[ ] pnpm test 通过
```
