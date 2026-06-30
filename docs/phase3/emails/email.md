# M3 — Email Outbox + SMTP Backend Foundation

## Type

Middle+

## Goal

建立 exam 平台的后端邮件基础设施，为后续考试通知、成绩通知、异常提醒、注册通知、密码重置通知做准备。

本 Job 要完成：

* email outbox 持久化
* fake sender
* disabled/no-op sender
* SMTP sender
* worker skeleton
* pending / sent / failed 状态机
* retry count / last error / next retry time
* 后端 test email 能力
* `.env` 控制邮件配置
* 测试保证 email 失败不 rollback 主业务事务

核心原则：

> 邮件不能在 API 请求里直接同步发送。业务事务只写入 outbox，worker 异步发送。邮件失败可以重试，但不能影响考试、注册、重置密码、用户创建等主业务成功。

---

## Background

当前系统没有 email 设置，也没有统一邮件发送能力。

邮件能力应该按 outbox 模式建设：

```txt
business transaction
  -> write email_outbox
  -> commit business transaction
  -> worker processes pending emails
  -> fake / disabled / smtp sender
  -> sent / retry / failed
```

不要让业务路由直接调用 SMTP。

> **Worker 触发模型（Phase 3）：** 上面流程图里的 "worker processes pending
> emails" 是逻辑顺序，**不要求本 Job 引入常驻后台进程**。Phase 3 的 worker
> 是**手动触发**的 service 方法（`processDueEmails({ now, limit })`）：
> 测试 / script / API 直接触发它处理一批 due email。周期扫描的常驻 daemon
> 是未来增强项（`processDueEmails` 的 `limit` 参数已为将来批量 / 周期扫描
> 留好接口）。

本 Job 不使用 `fastify-mailer` 作为核心依赖。邮件发送采用：

```txt
nodemailer + project-owned EmailSender abstraction
```

Fastify 只负责：

* 加载 `.env` 配置
* 注入 email service
* 暴露后端 test email API 或 script

---

## Scope

实现：

* `email_outbox` 表或等价结构
* EmailOutboxRepo
* EmailOutboxService
* EmailNotificationService
* EmailSender abstraction
* DisabledEmailSender
* FakeEmailSender
* SmtpEmailSender
* worker skeleton
* retry policy
* backend test email capability
* disabled-by-default email config
* `.env.example` email 配置说明
* tests 验证 email 失败不 rollback 主业务

可能涉及：

```txt
packages/db
apps/api
packages/contracts
docs/phase3
.env.example
```

---

## Non-goals

本 Job 不做：

* 前端 UI
* 复杂邮件模板系统
* 多租户发件人配置
* delivery analytics
* 邮件打开率 / 点击率
* 第三方邮件服务集成，例如 SES、SendGrid、Mailgun
* CI 依赖真实 SMTP
* 自动化测试依赖 secret
* 自动化测试真实发送外部邮件
* 改变核心考试事务语义
* 大规模重构 auth / user / exam 主流程

---

## Migration Note

该 Job 涉及 DB migration，必须：

* 单独分支
* 单独合并
* 不和其他 migration job 并行合并
* migration 必须可重复应用
* migration 必须能被现有 test DB lifecycle 正常执行

不要把本 Job 和其他 DB schema 改动混在一个 PR。

---

## Required Dependency

在 API 包中新增：

```bash
pnpm --filter @exam/api add nodemailer
```

如 TypeScript 需要类型包，再补：

```bash
pnpm --filter @exam/api add -D @types/nodemailer
```

不要引入：

```txt
fastify-mailer
```

---

## Environment Variables

当前项目已有 `.env`，本 Job 需要新增 email 相关变量，并同步更新：

* `.env.example`
* config loader
* config schema / runtime config 校验，如果项目已有
* test env 默认配置

### Base email config

```env
EMAIL_ENABLED=false
EMAIL_TRANSPORT=fake
EMAIL_FROM=no-reply@example.local
EMAIL_FROM_NAME=Exam Platform

EMAIL_MAX_ATTEMPTS=3
EMAIL_RETRY_BASE_SECONDS=60
```

### Fake sender config

```env
EMAIL_FAKE_MODE=success
```

可选值：

```txt
success
failure
```

含义：

| Value     | Behavior                  |
| --------- | ------------------------- |
| `success` | fake sender 永远成功          |
| `failure` | fake sender 稳定抛错，便于测试失败路径 |

### SMTP config

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=

SMTP_REQUIRE_TLS=true
SMTP_TLS_REJECT_UNAUTHORIZED=true
SMTP_TLS_SERVERNAME=

SMTP_CONNECTION_TIMEOUT_MS=10000
SMTP_GREETING_TIMEOUT_MS=10000
SMTP_SOCKET_TIMEOUT_MS=10000
```

---

## SMTP Config Semantics

### `SMTP_SECURE`

```env
SMTP_SECURE=true
```

表示连接一开始就使用 TLS。

通常用于：

```txt
465
```

---

```env
SMTP_SECURE=false
```

表示连接开始时不是 implicit TLS。

通常用于：

```txt
587 + STARTTLS
```

如果同时设置：

```env
SMTP_REQUIRE_TLS=true
```

则要求 SMTP 服务器必须升级到 STARTTLS，否则发送失败。

---

### `SMTP_REQUIRE_TLS`

默认建议：

```env
SMTP_REQUIRE_TLS=true
```

含义：

* `SMTP_SECURE=false` 时要求 STARTTLS
* 如果服务器不支持 STARTTLS，发送失败
* 避免明文 SMTP 发送账号密码或邮件内容

---

### `SMTP_TLS_REJECT_UNAUTHORIZED`

默认必须是：

```env
SMTP_TLS_REJECT_UNAUTHORIZED=true
```

含义：

* 校验证书链
* 自签名证书、过期证书、域名不匹配会失败

只允许本地调试时临时设置：

```env
SMTP_TLS_REJECT_UNAUTHORIZED=false
```

生产环境不允许关闭。

---

### `SMTP_TLS_SERVERNAME`

用于 TLS 证书校验的 servername。

当 `SMTP_HOST` 是 IP、内网别名、代理地址，但证书签发给真实域名时，可以设置：

```env
SMTP_TLS_SERVERNAME=smtp.example.com
```

---

## Safe Defaults

默认配置必须安全：

```env
EMAIL_ENABLED=false
EMAIL_TRANSPORT=fake
SMTP_REQUIRE_TLS=true
SMTP_TLS_REJECT_UNAUTHORIZED=true
```

默认情况下：

* 不发送真实邮件
* 不需要 SMTP secret
* 测试不会访问外部网络
* CI 不需要任何 email 配置

---

## Email Transport Selection

实现 sender factory：

```ts
createEmailSender(config, logger): EmailSender
```

行为：

| Condition                                    | Sender                |
| -------------------------------------------- | --------------------- |
| `EMAIL_ENABLED=false`                        | `DisabledEmailSender` |
| `EMAIL_ENABLED=true && EMAIL_TRANSPORT=fake` | `FakeEmailSender`     |
| `EMAIL_ENABLED=true && EMAIL_TRANSPORT=smtp` | `SmtpEmailSender`     |

非法配置必须 fail fast，例如：

* `EMAIL_TRANSPORT=smtp` 但缺少 `SMTP_HOST`
* `SMTP_PORT` 不是数字
* `SMTP_SECURE` 不是 boolean
* `EMAIL_FAKE_MODE` 不是 `success/failure`
* `EMAIL_MAX_ATTEMPTS < 1`
* `EMAIL_RETRY_BASE_SECONDS < 1`

---

## EmailSender Abstraction

新增接口：

```ts
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
```

### DisabledEmailSender

行为：

* no-op
* 不抛错
* 不访问网络
* 可记录 debug/info 日志

### FakeEmailSender

行为：

* `success` 模式：直接 resolve
* `failure` 模式：稳定抛错

固定错误消息：

```txt
Fake email sender failure
```

方便测试断言 `lastError`。

### SmtpEmailSender

内部使用：

```ts
nodemailer.createTransport(...)
```

必须支持：

* host
* port
* secure
* auth user/password
* requireTLS
* tls.rejectUnauthorized
* tls.servername
* connectionTimeout
* greetingTimeout
* socketTimeout

必须避免：

* 日志输出 `SMTP_PASSWORD`
* 错误消息泄露密码
* 把完整 SMTP config stringify 到日志
* 业务代码直接引用 nodemailer

### 统一错误包装（`EmailSendError`）

实现一个 sender 内部使用的错误包装类型：

```ts
class EmailSendError extends Error {
  constructor(message: string) { super(message); this.name = "EmailSendError"; }
}
```

要求：

* 所有 sender 在 send 失败时把底层错误经过 `sanitizeEmailError(...)` 处理
  后，包成 `EmailSendError` 再抛
* `EmailSendError.message` 永远是已脱敏的安全字符串
* worker 把 `err.message` 直接写进 outbox 的 `lastError`，因此保证
  `lastError` 字段不可能包含密码 / token / 完整 transporter config

这样错误链对所有 transport（fake / smtp）是统一、可断言的：测试可以直接
断言 `lastError` 不含密码、且 fake failure 的 `lastError` 是固定字符串。

### Transporter 生命周期（`close()`）

`SmtpEmailSender` 必须暴露：

```ts
close(): void
```

* 内部调用 `transporter.close()` 释放 pooled SMTP 连接
* 由 Fastify `onClose` hook 触发（在 `plugins/email.ts` 里注册），避免
  进程退出时连接泄漏
* `DisabledEmailSender` / `FakeEmailSender` 不持有 transporter，无需
  `close()`（plugin 里用 `instanceof SmtpEmailSender` 守卫即可）

---

## Sanitized Error

实现：

```ts
sanitizeEmailError(error): string
```

允许保留：

* error name
* error message
* SMTP response code，如果有
* command，如果有

禁止保留：

* password
* auth token
* raw transporter options
* full `.env`
* full SMTP config

---

## Email Outbox Schema

新增 `email_outbox` 表。

建议字段：

```txt
id
type
recipientEmail
subject
bodyText
bodyHtml nullable

status
attempts
maxAttempts
lastError nullable
nextRetryAt nullable
sentAt nullable

createdAt
updatedAt
```

### 单租户数据边界（`organizationId`）

本项目所有业务表都带 `organizationId`，`email_outbox` 不例外（见
`packages/db/src/schema/pg.ts` 的 `emailOutbox`）。必须：

* 增加 `organizationId` 列，引用 `organizations.id`
* 所有 repo 方法接收 `ctx`，并用 `ctx.organizationId`（来自内部默认
  organization）做查询 scope，与其他 repo 一致
* worker 的 `findDuePending` 查询必须按 `organizationId` 过滤

这是项目既有的 single-tenant 数据边界规则，不是本 Job 新增约束。上面的
字段清单省略了 `organizationId` 只是为了聚焦邮件语义；实现时**必须**按
项目 tenant boundary 规则补上。

### Status

```txt
pending
sent
failed
```

### Type examples

```txt
registration_welcome
password_reset
admin_created_user
exam_notification
grade_notification
system_alert
test_email
```

不要在 outbox 表中保存 SMTP 密码。

---

## EmailOutboxRepo

新增 repository，至少支持：

```ts
createEmailOutboxItem(input)
findDuePendingEmails(now, limit)
markSent(id, sentAt)
markRetryScheduled(id, attempts, lastError, nextRetryAt)
markFailed(id, attempts, lastError)
findById(id)
```

如果项目已有 repo 命名规范，按现有风格实现。

---

## Retry Policy

实现简单、确定、可测试的 retry 策略。

建议使用指数退避：

```txt
nextRetryAt = now + EMAIL_RETRY_BASE_SECONDS * 2 ** (attempts - 1)
```

注意：

* 这里的 `attempts` 是失败后更新的 attempts
* 如果 `maxAttempts=3`，第三次失败后直接进入 `failed`
* 最终 failed 后 `nextRetryAt = null`

示例：

| Failed attempts | Retry delay |
| --------------: | ----------: |
|               1 |         60s |
|               2 |        120s |
|               3 |      failed |

测试必须断言具体时间。

---

## EmailOutboxService / Worker Skeleton

新增：

```ts
EmailOutboxService.processDueEmails(options)
```

行为：

1. 查询 due pending email。
2. 对每封邮件调用 sender。
3. 成功：

   * `status = sent`
   * `sentAt = now`
4. 失败且 attempts 未达上限：

   * `attempts += 1`
   * `lastError = sanitized error`
   * `nextRetryAt = retryPolicy(now, attempts)`
   * `status = pending`
5. 失败且 attempts 达上限：

   * `attempts += 1`
   * `lastError = sanitized error`
   * `status = failed`
   * `nextRetryAt = null`

要求：

* 单封邮件失败不能阻止其他邮件处理
* worker 失败不能影响主业务事务
* 测试必须可以注入 clock
* 不要直接使用裸 `Date.now()`
* 如果项目已有 `fastify.now()` 模式，优先复用
* worker skeleton 可以是手动触发 service，不要求本 Job 引入常驻后台进程

---

## EmailNotificationService

新增：

```ts
EmailNotificationService
```

它只负责 enqueue，不直接发送 SMTP。

### 方法形态（两种等价实现，按项目风格选一种）

形态 A — **通用 enqueue 入参**（本项目采用）：

```ts
enqueueEmail(input: EnqueueEmailInput): Promise<EmailOutboxRow>
enqueueTestEmail(ctx, to): Promise<EmailOutboxRow>
enqueueBestEffort(input): Promise<EmailOutboxRow | null>  // 推荐业务流程使用
```

`EnqueueEmailInput` 携带 `type / recipientEmail / subject / bodyText /
bodyHtml?`，`type` 取自 `EmailType` 枚举（见 outbox schema）。业务方按
事件选择 `type`，无需为每种邮件写一个方法。本项目选这种形态，因为
Phase 1 尚无注册 / 重置密码 / 管理员建号等真实事件点，先暴露通用入队
能力即可。

形态 B — **按事件命名的方法**（当业务事件点成型后再补，作为便利方法）：

```ts
enqueueRegistrationWelcomeEmail(...)
enqueuePasswordResetEmail(...)
enqueueAdminCreatedUserEmail(...)
enqueueExamNotificationEmail(...)
enqueueGradeNotificationEmail(...)
enqueueSystemAlertEmail(...)
```

这些命名方法是“建议”，不是本 Job 的硬性要求。当后续 Phase 引入对应
业务流程时，可在形态 A 的通用 enqueue 之上封装这些便利方法（内部仍只
调用通用 enqueue）。本 Job 只需交付形态 A + `enqueueTestEmail`。

业务路由只能调用 notification service。

不要让业务代码直接调用：

```ts
smtpSender.send(...)
nodemailer.sendMail(...)
```

---

## Business Integration

本 Job 可以挂已有流程，但不要新建大型 auth 系统。

### 1. Registration success

如果已有注册流程：

* 用户创建成功后 enqueue welcome email
* enqueue 失败不 rollback user creation

### 2. Password reset request

如果已有密码重置流程：

* reset token 创建成功后 enqueue password reset email
* enqueue 失败不 rollback token creation
* 不改变现有“用户不存在时的安全响应”语义

### 3. Admin-created user

如果已有管理员创建用户流程：

* 用户创建成功后 enqueue account-created email
* enqueue 失败不 rollback user creation

### 4. Exam / grade notification

如果已有明确事件点，可以只加 service 方法和测试，不强行接入复杂业务流程。

### Best-effort pattern

本项目把 best-effort 封装进 `EmailNotificationService.enqueueBestEffort`，
业务路由**优先使用**这个封装方法：

```ts
await emailNotificationService.enqueueBestEffort({
  ctx,
  type: "registration_welcome",
  recipientEmail: user.email,
  subject: "Welcome",
  bodyText: "...",
});
// 内部已 try/catch：outbox 写失败时只记 warn 日志并返回 null，不抛错
```

等价的手写 try/catch（不要在业务路由里展开，直接用 `enqueueBestEffort`）：

```ts
try {
  await emailNotificationService.enqueueEmail({
    ctx,
    type: "registration_welcome",
    recipientEmail: user.email,
    subject: "Welcome",
    bodyText: "...",
  });
} catch (error) {
  request.log.warn(
    { err: sanitizeEmailError(error) },
    "failed to enqueue registration email",
  );
}
```

不要因为 email enqueue 失败返回 500。`enqueueBestEffort` 是首选。

---

## Backend Test Email Capability

本 Job 需要支持“后端发送测试邮件”。

优先实现 API：

```http
POST /api/email/test
```

本项目所有业务路由统一挂在 `/api` 前缀下（见 `server.ts` 的
`app.register(emailRoutes, { prefix: "/api" })`），不存在 `/admin` 前缀。
Admin 权限由路由级 `requireRole(["Admin"])` 强制，而非路径前缀区分。
其他部署若使用不同的 route prefix，按其约定调整。

### Request

```json
{
  "to": "someone@example.com"
}
```

### Behavior

* 需要 Admin 权限：本项目用 cookie-based session auth（HTTP-only cookie +
  JWT），路由级 `preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])]`
  强制 Admin，**不使用** `Authorization: Bearer` header。OpenAPI security
  scheme 标为 `cookieAuth`
* 使用当前 `.env` 配置创建 sender
* 发送一封简单测试邮件
* `EMAIL_ENABLED=false` 时不抛出 500，应返回明确 no-op/disabled 结果
* SMTP 失败时返回 sanitized error
* 不返回 SMTP password、auth detail、完整 transporter config

### Suggested response

Success:

```json
{
  "ok": true,
  "status": "sent"
}
```

Disabled:

```json
{
  "ok": true,
  "status": "disabled"
}
```

Failure:

```json
{
  "ok": false,
  "status": "failed",
  "error": "SMTP connection failed"
}
```

如果项目 API 错误格式已有统一规范，必须使用现有格式。

---

## Optional CLI

如果项目已有 scripts 风格，也可以额外加：

```bash
pnpm --filter @exam/api email:test -- --to someone@example.com
```

但本 Job 不强制要求 CLI。

如果 API 和 CLI 二选一，优先 API。

---

## Required Tests

自动化测试不能依赖真实 SMTP、secret、外部网络。

### DB tests

至少覆盖：

* repo insert pending outbox
* query due pending emails
* mark sent
* mark retry scheduled
* mark failed
* attempts / lastError / nextRetryAt 持久化正确
* migration 可重复应用

### Service / worker tests

至少覆盖：

* fake sender success
* fake sender failure
* disabled sender no-op
* worker sends pending email via fake sender
* success 后标记 sent
* failure 后标记 failed 或 retry scheduled
* retry count 增加
* last error 记录
* next retry time 更新
* max attempts 后进入 failed
* 单封邮件失败不阻塞其他 pending email
* config disabled 时 worker 安全 no-op

### SMTP tests

不访问真实 SMTP。

至少覆盖：

* SMTP sender factory accepts valid SMTP config
* invalid SMTP config fails fast
* SMTP error is sanitized
* password never appears in thrown public error
* password never appears in logs if logs are testable

如果可以注入 mock transport，则覆盖：

* SMTP sender calls transport with expected from/to/subject/text/html
* SMTP transport failure becomes sanitized error

### Test email API tests

如果实现 API：

* disabled mode returns disabled/no-op success
* fake success mode returns success
* fake failure mode returns sanitized failure
* non-admin cannot send test email, if existing admin auth applies
* invalid email address rejected

### Business safety tests

至少覆盖：

* email failure 不 rollback 已提交业务事务
* fake sender failure 不 rollback user creation
* password reset request still succeeds when email enqueue/send fails, if password reset flow exists
* registration/user creation still succeeds when email enqueue/send fails, if registration flow exists

### 测试文件归属（本项目实际落位）

为了让 reviewer 知道每类测试去哪找，本项目的测试落位如下：

| 测试类别 | 文件 |
| --- | --- |
| DB / repo（insert pending、find due、mark sent/retry/failed、持久化、migration） | `packages/db/src/repository/emailOutboxRepo.test.ts` |
| Sender 抽象（disabled / fake success+failure / smtp factory + sanitize + 不泄密） | `apps/api/src/email/senders.test.ts` |
| `sanitizeEmailError`（脱敏规则、密码不外泄） | `apps/api/src/email/sanitizeError.test.ts` |
| Retry policy（`computeNextRetryAt` 指数退避确定性） | `apps/api/src/email/retryPolicy.test.ts` |
| Worker / `processDueEmails`（sent / retry scheduled / failed / 单封失败不阻塞 / disabled no-op） | `apps/api/src/email/outboxService.test.ts` |
| `EmailNotificationService`（enqueue / `enqueueBestEffort` 吞错 / `enqueueTestEmail`） | `apps/api/src/email/notificationService.test.ts` |
| Test email API（disabled / fake success / fake failure / 非 admin 被拒 / 非法地址） | `apps/api/src/routes/email.test.ts` |

> 本 Job 尚未挂载到真实注册 / 密码重置 / 管理员建号流程（这些事件点在
> Phase 1 未引入），因此“业务安全”测试以 **outbox 写失败不抛进业务路由**
> 的形式覆盖在 `notificationService.test.ts`（`enqueueBestEffort` 吞错）
> 与 `routes/email.test.ts`（API 不因 enqueue 失败返回 500）里。等后续
> Phase 引入真实业务事件点后，再在对应业务路由测试里补“enqueue 失败不
> rollback 主事务”的端到端断言。

---

## Suggested Validation

```bash
pnpm --filter @exam/db test -- email
pnpm --filter @exam/api test -- email
pnpm --filter @exam/api test -- outbox
pnpm verify
```

本项目不存在 `verify:fast` 脚本。可用的验证命令（见根 `package.json`）：

* `pnpm verify` — 完整门禁：`format:check` + `lint` + `lint:copy` +
  `lint:arch` + `lint:db-config` + `typecheck` + coverage + build（用 `exam_test` DB）
* `pnpm verify:static` — 不跑测试，只跑静态检查（适合快速本地检查）
* `pnpm verify:nodb-tests` — 只跑不依赖 DB 的 turbo coverage（本 Job 涉及 DB，**不适用**）

如果项目 test 命令不同，使用现有最接近命令，并在施工报告里记录实际运行命令。

---

## Manual SMTP Validation

自动化测试不要求真实 SMTP。

本地可以手动验证：

```bash
EMAIL_ENABLED=true \
EMAIL_TRANSPORT=smtp \
EMAIL_FROM=no-reply@example.com \
EMAIL_FROM_NAME="Exam Platform" \
SMTP_HOST=smtp.example.com \
SMTP_PORT=587 \
SMTP_SECURE=false \
SMTP_REQUIRE_TLS=true \
SMTP_TLS_REJECT_UNAUTHORIZED=true \
SMTP_USER=your-user \
SMTP_PASSWORD=your-password \
pnpm --filter @exam/api dev
```

然后调用：

```bash
curl -X POST http://localhost:<port>/api/email/test \
  -H "Content-Type: application/json" \
  --cookie "session=<admin-session-cookie-value>" \
  -d '{"to":"someone@example.com"}'
```

本项目认证方式为 **HTTP-only cookie + JWT**（`fastify.authenticate` +
`requireRole(["Admin"])`），不使用 `Authorization: Bearer` header。
`session` cookie 的名字、值、过期策略按项目现有 auth 约定获取
（先通过 Admin 登录流程拿到 cookie）。其他部署若使用不同的 auth
scheme，按其约定调整。

---

## Security Requirements

必须满足：

* 不记录 SMTP 密码
* 不把完整 `.env` 打到日志
* 不把 nodemailer transporter config 直接 stringify
* `SMTP_TLS_REJECT_UNAUTHORIZED` 默认必须为 true
* `SMTP_REQUIRE_TLS` 默认建议为 true
* 生产环境不要允许关闭 TLS 校验
* test email API 必须走 admin 权限，如果项目已有 admin auth
* test email API 不能变成开放邮件中继
* `to` 必须校验为合法 email
* subject/body 不允许从未认证用户输入直接透传到任意收件人

---

## Acceptance Criteria

必须满足：

* `email_outbox` 表结构清楚
* migration 可重复应用
* `.env.example` 增加 email / SMTP 配置
* Email config loader 支持 disabled/fake/smtp
* 默认 `EMAIL_ENABLED=false`
* 使用 `nodemailer` 实现 SMTP sender
* 不引入 `fastify-mailer`
* 有 `EmailSender` abstraction
* 有 `DisabledEmailSender`
* 有 `FakeEmailSender`
* 有 `SmtpEmailSender`
* 有 EmailOutboxRepo
* 有 EmailOutboxService
* 有 EmailNotificationService
* worker 可测试
* pending -> sent 测试通过
* pending -> retry scheduled 测试通过
* pending -> failed 测试通过
* retry count / lastError / nextRetryAt 行为明确
* disabled config 时 worker 安全 no-op
* fake failure 可重复测试
* 自动化测试不需要 SMTP secret
* 自动化测试不访问真实 SMTP
* 邮件失败不 rollback 主业务事务
* 后端 test email 能力可用
* 无前端 UI 改动
* 无复杂邮件模板系统
* 无 delivery analytics
* `pnpm verify` 通过

---

## Review Standard

Reviewer 必须检查：

1. 邮件发送是否完全通过 `EmailSender` abstraction。
2. 业务代码是否没有直接调用 nodemailer。
3. SMTP 是否完全由 `.env` 控制。
4. TLS 配置是否明确：

   * `SMTP_SECURE`
   * `SMTP_REQUIRE_TLS`
   * `SMTP_TLS_REJECT_UNAUTHORIZED`
   * `SMTP_TLS_SERVERNAME`
5. 默认配置是否 disabled。
6. 测试是否完全不依赖真实 SMTP。
7. retry 行为是否确定、可断言。
8. `lastError` 是否记录 sanitized error。
9. 日志和错误是否不泄露 `SMTP_PASSWORD`。
10. test email API 是否有 admin 权限保护。
11. test email API 是否不会成为开放邮件中继。
12. 邮件失败是否不会 rollback 主业务事务。
13. outbox 状态转换是否清晰：

    * pending -> sent
    * pending -> pending with retry
    * pending -> failed
14. migration 是否单独分支、单独合并。
15. 是否没有引入前端 UI、复杂模板系统、delivery analytics。
16. 是否符合项目现有 repo/service/config/test 风格。
