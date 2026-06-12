# Phase1.7 API Contract Convergence

## 定位

Phase1.6 完成 PostgreSQL-only、事务边界和 attempt 并发语义后，API 层需要把已经存在的行为收敛为稳定、可验证的 contract。

API contract 是以下工作的共同基础：

- Web UI 与 API client 的稳定集成
- OpenAPI 文档与未来 client 生成
- 路由、contract、集成测试之间的一致性
- 错误处理与未来 i18n
- command endpoint 的业务拒绝语义

本目录是 **Phase1.7 的 API Contract Convergence 规划包**，与
[`security-completion-plan.md`](../security-completion-plan.md) 并列，不替代现有
Phase1.7 安全计划。实施排期需要在 Phase1.7 总计划中统一协调。

## 本阶段原则

1. 先定义规则和迁移顺序，再按模块修改代码。
2. 不要求一次性迁移全部 endpoint。
3. 不强制全系统使用统一 JSON envelope。
4. 普通资源、列表、command、204、文件与错误响应分别建模。
5. 前端和测试依赖稳定 `code` / `reason`，不依赖自然语言 `message`。
6. OpenAPI 必须描述实际行为，不能成为另一份手工维护且失真的 endpoint 清单。

## 本次文档 Job 边界

本次仅完成 A00 文档落地：

- 不修改 `apps/api/src/`
- 不修改 `apps/web/src/`
- 不修改 `packages/`
- 不修改测试
- 不改变任何现有接口行为
- 不引入 Swagger/OpenAPI 运行时依赖
- 不实现完整 i18n

后续代码迁移必须按 [`06-migration-plan.md`](./06-migration-plan.md) 单独执行和验收。

## 文档索引

| 文件 | 内容 |
| --- | --- |
| [`00-current-state-audit.md`](./00-current-state-audit.md) | 当前实现、旧文档和测试的事实审计 |
| [`01-response-shapes.md`](./01-response-shapes.md) | 响应形态分类 |
| [`02-error-response.md`](./02-error-response.md) | `ErrorResponse v0` 与错误码规则 |
| [`03-command-result.md`](./03-command-result.md) | command result 与答案保存拒绝语义 |
| [`04-i18n-boundary.md`](./04-i18n-boundary.md) | 当前阶段的 i18n 边界 |
| [`05-openapi-rules.md`](./05-openapi-rules.md) | OpenAPI 编写与验证规则 |
| [`06-migration-plan.md`](./06-migration-plan.md) | A00-A07 迁移 Job Cards |

## 权威顺序

1. [`docs/SPEC.md`](../../SPEC.md) 的不变原则
2. 已批准的 Phase 计划和 endpoint contract
3. `packages/contracts` 中实施后的 schema
4. 路由实现与自动化测试
5. [`docs/api/reference.md`](../../api/reference.md) 的历史参考

当前代码与本文档中的目标 contract 不一致时，不代表应在本次文档 Job 中修改代码；
应记录到对应迁移 Job，实施时再同步 contract、路由、测试、OpenAPI 和前端 client。
