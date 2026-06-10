# Phase 1.1 Job 05 — Account Settings + Change Password

## Goal

补齐 Admin / Teacher / Candidate 的账号自服务能力。

## Scope

- `/api/me`
- `/api/me/password`
- Account settings page
- change password form

## API

```txt
GET   /api/me
PATCH /api/me/password
```

## Requirements

### GET /api/me

返回：

```ts
{
  id: string;
  username: string;
  displayName: string;
  role: string;
  organizationId: string;
}
```

### PATCH /api/me/password

Request:

```ts
{
  currentPassword: string;
  newPassword: string;
}
```

Rules:

```txt
[ ] 需要登录
[ ] 校验旧密码
[ ] 新密码走既有 hash
[ ] 不能修改 role
[ ] 写入 AuditLog
[ ] 错误提示明确
```

## UI

新增“账号设置”：

```txt
- 当前账号信息
- 修改密码
- 保存 loading
- 成功 toast
- 失败 toast
```

## Tests

```txt
[ ] user can fetch me
[ ] wrong old password rejected
[ ] password can be changed
[ ] login works with new password
[ ] login fails with old password
[ ] candidate can change password
[ ] teacher can change password
[ ] admin can change password
```

## Acceptance

```txt
[ ] Admin/Teacher/Candidate 都有修改密码入口
```
