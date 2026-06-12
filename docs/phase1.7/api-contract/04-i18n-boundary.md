# i18n Boundary

## 当前阶段决定

- API `message` 默认使用 zh-CN。
- 本阶段不实现完整多语言系统。
- 不做 `Accept-Language` negotiation。
- 不要求前端立即实现多语言。
- API 必须先提供稳定 `code` / `reason`，未来 i18n 基于机器码本地化。
- 不引入运行时云翻译。
- 不要求全站 locale catalog。

## 规范

```text
MUST: frontend logic depends on code/reason
MUST NOT: frontend logic parses or compares message
MUST: route message comes from message registry, not inline string
SHOULD: message is zh-CN human-readable default
MAY: future frontend maps code/reason to localized text
```

## Server Default Message Registry

本阶段引入 **server default message registry**（不是完整 i18n catalog）：

- 它是 `code`/`reason` → 默认 zh-CN `message` 的映射表。
- **默认落点**：
  - `packages/contracts`：schema、enum、wire type 定义（如 `SaveAnswerRejectReason`、`ErrorResponseSchema`）**以及** save-answer 等特定 endpoint 的 message registry（`code/reason → zh-CN message` 映射）。registry 与 wire enum 同包，避免 API route 和 Web client 各自维护文案映射。
  - `packages/domain`：通用 response builder（构建 ErrorResponse / Command Result 的辅助函数）。domain 是 leaf node，不依赖 contracts，因此通用 builder 使用 domain 内部类型。
  - `apps/api`：只调用 registry/builder，不 inline message。
- **route 不允许散落 inline message**：所有错误和拒绝的 message 必须来自 registry 或由 registry 提供的 lookup 函数生成。
- 新增 code/reason 时必须同步注册对应 message。
- A01-A04 迁移时，将现有 inline message 收敛到 registry。
- 安全 Job（S04-S09）产生的错误也必须使用 registry，不得新增散落 inline message。

Registry 示例：

```typescript
const errorMessages: Record<string, string> = {
  VALIDATION_ERROR: "请求参数无效",
  AUTH_REQUIRED: "请先登录",
  AUTH_INVALID_CREDENTIALS: "用户名或密码错误",
  PERMISSION_DENIED: "没有操作权限",
  RESOURCE_NOT_FOUND: "请求的资源不存在",
  INTERNAL_ERROR: "服务器内部错误",
};

const conflictMessages: Record<string, string> = {
  STALE_VERSION: "服务器上存在更新的答案版本",
  ATTEMPT_ALREADY_SUBMITTED: "考试已提交，不能继续保存答案",
  ATTEMPT_CLOSED: "考试已结束",
  DEADLINE_EXCEEDED: "考试时间已到",
};
```

## API 规则

- 同一 code/reason 的 message 可以因上下文改善，不构成机器契约变更。
- message 应面向用户，避免直接暴露框架、数据库和内部状态名。
- 需要程序处理的值放入 `details`，不能嵌入 message。
- 服务端日志可以记录更具体的内部错误，但响应 message 必须经过安全处理。

## 前端规则

- `ApiError` 后续应保留 `code`、`details`、`requestId`。
- 页面可优先使用本地 code 映射，找不到映射时展示服务端 zh-CN message。
- 不使用 `message.includes(...)`、正则或完整句子比较决定跳转、重试、刷新或冲突合并。

## 测试规则

- 行为测试断言 status + code/reason + details。
- 文案存在性可断言 `message` 为非空字符串。
- 只有专门验证默认 zh-CN copy 的测试才绑定具体文案，并应集中维护。
- 不因标点或措辞调整让业务行为测试失败。

## 未来扩展点

A07 在稳定 code/reason + registry 基础上评估：

- 前端按 code/reason 映射本地文案。
- 服务端 message catalog（多语言扩展 registry）。
- `Accept-Language` negotiation。

这些选择均不属于 A00-A06 的必要前置。稳定机器码必须先于任何方案落地。
