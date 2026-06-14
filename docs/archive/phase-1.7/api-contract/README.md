# Phase1.7 API Contract Convergence

## 定位

Phase1.6 完成 PostgreSQL-only、事务边界和 attempt 并发语义后，API 层需要把已经存在的行为收敛为稳定、可验证的 contract。

API contract 是以下工作的共同基础：

- Web UI 与 API client 的稳定集成
- OpenAPI 文档与未来 client 生成
- 路由、contract、集成测试之间的一致性
- 错误处理与未来 i18n
- command endpoint 的业务拒绝语义
- **安全 baseline 的错误响应格式基础**

本目录是 **Phase1.7-A（API Contract Convergence）** 的规划包。Phase1.7 拆成两条线：

1. **Phase1.7-A**: API Contract Convergence（本目录）
2. **Phase1.7-S**: Security Completion Baseline（[`security-completion-plan.md`](../security-completion-plan.md)）

### 双线依赖关系

```text
Phase1.7-A (API Contract)
  ↓ 提供稳定的 response shape / ErrorResponse / Command Result / code·reason·message registry
Phase1.7-S (Security Baseline)
  ↓ 安全补丁复用已有 contract，不引入新的 response shape 漂移
Phase2 Entry Gate
```

**API contract 是安全 baseline 的前置**：安全补丁会大量产生 400/401/403/409/500 response。如果不先固定 ErrorResponse v0、Command Result、code/reason/message 规则，安全实现会继续产生散落的错误结构和自然语言 message，导致后续 A02/A06 返工。

例外：S03b（Client Submit Flush Protocol）与 A01（attempts save/submit）强相关，安排在 A01 之后、完整安全 baseline 之前完成。

### 推荐总顺序

```text
A00  API Contract Constitution + Endpoint Inventory
  → A01  Attempts Save/Submit Contract Vertical Slice
  → S03b Client Submit Flush Protocol（与 A01 强相关，前置到此处）
  → A02  Auth/Users/Candidates ErrorResponse Vertical Slice
  → A03  Exams/Questions Command/Resource Response Vertical Slice
  → A04  Import/Export Response Vertical Slice
  → A05  OpenAPI Schema Completion + Drift Test
  → A06  Web API Client Error/Command Handling Convergence
  → S04-lite Auth Session Security Baseline
  → S05-lite CSV + Security Headers + CSRF Origin Check
  → S06-lite Audit Log Completion Baseline
  → S07-lite Password Policy + Account Security Baseline
  → S08-lite Red-Team Security Test Suite
  → S09-lite Security Baseline Validation
  → A07  i18n Systematization（已完成 baseline 2026-06-13；不阻塞 Phase2 Entry Gate）
```

如果发现安全任务必须提前做，必须说明它不会引入新的 response shape 漂移，并复用已有 code/message registry。

## 本阶段原则

1. 先定义规则和迁移顺序，再按模块修改代码。
2. 不要求一次性迁移全部 endpoint。
3. 不强制全系统使用统一 JSON envelope。
4. 普通资源、列表、command、204、文件与错误响应分别建模。
5. 前端和测试依赖稳定 `code` / `reason`，不依赖自然语言 `message`。
6. OpenAPI 必须描述实际行为，不能成为另一份手工维护且失真的 endpoint 清单。
7. **代码迁移按 endpoint family 纵切**：每个 family 从 contract → domain → route → test → frontend → OpenAPI 全链路完成后再进入下一个。不允许横向切层（先改全部 contract 再改全部 route）。
8. **route 不允许散落 inline error message**：所有 message 必须来自 server default message registry。

## 文档阶段 vs 代码阶段

**文档阶段**按 response taxonomy 分类：Resource Response、List Response、Command Result、Empty Response / 204、File Response、ErrorResponse。

**代码阶段**按 endpoint family 纵切：

```text
选定 endpoint family
  → contract schema（packages/contracts）
  → domain/protocol builder（packages/domain, packages/exam-engine）
  → message/code registry entry
  → route response（apps/api/src/routes）
  → route tests
  → affected frontend client（apps/web/src）
  → OpenAPI entry or pending marker
  → pnpm verify
```

每完成一块，系统必须保持可运行。**禁止横向切层迁移。**

## 禁止事项

- 不允许 route 散落 inline error message（必须来自 message registry）。
- 不允许前端根据 message 做逻辑判断。
- 不允许 204 返回 JSON body。
- 不允许用 `accepted:false` 表示认证失败、校验失败、资源不可见或服务端异常。
- 不允许为了测试通过删除 schema parse 或放宽 contract。
- 不允许安全 Job 新增一套独立错误格式（必须复用 ErrorResponse v0 和 code/message registry）。
- 不允许 OpenAPI 成为和实际 route 漂移的手写文档。

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
| [`01-response-shapes.md`](./01-response-shapes.md) | 响应形态分类 + HTTP status 规则 |
| [`02-error-response.md`](./02-error-response.md) | `ErrorResponse v0`、错误码规则、HTTP status 映射 |
| [`03-command-result.md`](./03-command-result.md) | command result 与答案保存/提交拒绝语义 |
| [`04-i18n-boundary.md`](./04-i18n-boundary.md) | i18n 边界与 server default message registry |
| [`05-openapi-rules.md`](./05-openapi-rules.md) | OpenAPI 编写与验证规则 |
| [`06-migration-plan.md`](./06-migration-plan.md) | A00-A07 + S03b-S09 迁移 Job Cards 与总顺序 |
| [`07-endpoint-inventory.md`](./07-endpoint-inventory.md) | 当前所有 endpoint 的施工地图 |

## 权威顺序

1. [`docs/SPEC.md`](../../SPEC.md) 的不变原则
2. 已批准的 Phase 计划和 endpoint contract
3. `packages/contracts` 中实施后的 schema
4. 路由实现与自动化测试
5. [`docs/api/reference.md`](../../api/reference.md) 的历史参考

当前代码与本文档中的目标 contract 不一致时，不代表应在本次文档 Job 中修改代码；
应记录到对应迁移 Job，实施时再同步 contract、路由、测试、OpenAPI 和前端 client。
