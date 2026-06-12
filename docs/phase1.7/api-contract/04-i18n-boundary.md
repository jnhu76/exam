# i18n Boundary

## 当前阶段决定

- API `message` 默认使用 zh-CN。
- 本阶段不实现完整多语言系统。
- 不做 `Accept-Language` negotiation。
- 不引入 message catalog。
- 不要求前端立即实现多语言。
- API 必须先提供稳定 `code` / `reason`，未来 i18n 基于机器码本地化。

## 规范

```text
MUST: frontend logic depends on code/reason
MUST NOT: frontend logic parses message
SHOULD: message is zh-CN human-readable default
MAY: future frontend maps code/reason to localized text
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

未来引入 i18n 时可选择：

- 前端按 code/reason 映射本地文案。
- 服务端 message catalog。
- `Accept-Language` negotiation。

这些选择均不属于 A00-A06 的必要前置。稳定机器码必须先于任何方案落地。
