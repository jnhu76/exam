# i18n Boundary

## 当前阶段决定

- API `message` 默认使用 zh-CN。
- 本阶段不实现完整多语言系统。
- 不做 `Accept-Language` negotiation。
- 不要求前端立即实现多语言。
- API 必须先提供稳定 `code` / `reason`，未来 i18n 基于机器码本地化。
- 不引入运行时云翻译。
- 不要求全站 locale catalog。

## 产品语言策略（A07 完成）

### 当前语言支持

| Locale | 状态 | 说明 |
|--------|------|------|
| `zh-CN` | **默认且唯一** | 服务端 message、前端 UI 文案、错误提示均使用简体中文 |

### Fallback 链

```text
前端: resolveErrorMessage(error)
  → ApiError.code 已知 → getMessageForLocale(code)（按 locale 查 catalog）
  → ApiError.message（服务端 zh-CN 默认值）
  → fallbackMessages.operationFailed（"操作失败，请重试"）
  → 通用 Error.message
  → fallbackMessages.operationFailed

前端: api.ts request error path（构建 ApiError.message 时）
  → error.code 在 registry → getMessageForLocale(code)（registry 优先）
  → error.code 未注册 + 服务端 message 非空 → 服务端 message 兜底
  → 否则 → `${status} Request failed`

服务端: buildErrorResponse(requestId, code)
  → getErrorMessage(code)（从 registry 查找 zh-CN message）
  → fallbackMessages.unknownError（"未知错误"，仅在 code 未注册时）
```

`fallbackMessages` 集中维护兜底文案，便于未来加入新 locale 时统一翻译。

### Ordering rationale（registry-first）

为什么前端在已知 code 时优先使用 registry，而不是服务端 message：

- **`code`/`reason` 是机器契约**，是跨服务、跨语言的稳定标识。
- **registry 是展示文案的唯一来源**，集中维护、便于扩展 locale、便于审计文案。
- **服务端 message 仅是 unknown code 的兜底**：当前端 registry 落后于服务端（服务端引入了新 code 但前端尚未更新 catalog），服务端 zh-CN message 可作为合理 fallback，避免落到 `"${status} Request failed"` 这种英文字符串。
- **不要用服务端 message 做"更详细的产品文案"**：如果 registry 文案不够好，应该改 registry，或拆分出更具体的 code/reason，而不是让服务端临时返回不同 message。后者会在引入第二 locale 时立即崩塌。
- **未来扩展点**：更细的业务文案应通过 (a) 更具体的 code/reason，或 (b) 未来在 ErrorResponse 中引入 `metadata` / interpolation 参数实现。本阶段不引入 metadata/interpolation。

### 扩展新 Locale 的步骤

1. 在 `packages/contracts/src/messageRegistry.ts` 的 `SUPPORTED_LOCALES` 数组中添加新 locale（如 `"en"`）
2. 创建对应 catalog（如 `enErrorMessages: typeof errorMessages = { ... }`）
3. 在 `localeCatalogs` 注册新 catalog（如 `"en": enErrorMessages`）
4. 同步在新 catalog 中翻译 `fallbackMessages` 字段
5. 前端 `resolveErrorMessage` 无需修改（通过 `getMessageForLocale` 自动走新 catalog）

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

A07 已完成基础 i18n 基础设施：

- [x] 前端按 code/reason 映射本地文案（`resolveErrorMessage()` in `apps/web/src/lib/i18n.ts`）
- [x] 服务端 message registry 支持 locale 查询（`getMessageForLocale()` in `packages/contracts`）
- [x] `SupportedLocale` 类型和 `DEFAULT_LOCALE` 常量
- [x] 兜底文案集中常量（`fallbackMessages` in `packages/contracts`）
- [x] 多 locale catalog 注册表（`localeCatalogs` in `packages/contracts`，当前只含 zh-CN）
- [ ] `Accept-Language` negotiation（需要产品明确需求）
- [ ] 第二个 locale catalog（如 `en`、`ja` 等）
- [ ] 前端 UI 文案国际化（约 200+ 硬编码字符串）

稳定机器码必须先于任何方案落地。
