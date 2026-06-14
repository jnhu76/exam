# Phase1.7 密码策略（S07-lite Baseline）

## 范围

S07-lite 的目标是把零散在多个 schema 里的密码长度限制（min 6）集中到一个统一策略源，并把最低长度从 6 抬到 8。

S07-lite **不**包含：

- 运行时 env 可调（`PASSWORD_MIN_LENGTH=12` 之类）
- Organization 级动态策略（每个组织自己设强度）
- 复杂度规则（必须含大小写/数字/符号）
- 历史密码黑名单
- 账号锁定 / 强制改密 / Have-I-Been-Pwned 比对

上述全部留给 Phase2 做完整密码强度策略时统一设计。

## 当前实现

`packages/contracts/src/passwordPolicy.ts` 是单一权威：

- `DEFAULT_PASSWORD_POLICY = { minLength: 8, maxLength: 100 }`
- `passwordField(policy?)` —— 给"用户提供新密码"的所有 schema 用，强制 min/max
- `passwordLoginField(policy?)` —— 给登录 schema 用，**不**做 min length

## 应用范围

| Schema                            | 字段          | 工厂              |
| --------------------------------- | ------------- | ----------------- |
| `RegisterRequestSchema`           | `password`    | `passwordField()` |
| `ChangePasswordRequestSchema`     | `newPassword` | `passwordField()` |
| `CreateUserRequestSchema`         | `password`    | `passwordField()` |
| `CreateCandidateRequestSchema`    | `password`    | `passwordField()` |
| `LoginRequestSchema`              | `password`    | `passwordLoginField()` |

`LoginRequestSchema.password` 改为 `passwordLoginField()`：保留"非空 + max 长度上限（DoS）"，**不**做 min length 校验。

`ChangePasswordRequestSchema.currentPassword` 仍是 `z.string().min(1)`，与 login 同源理由：旧账号若曾用 6 位密码，currentPassword 必须能进入 argon2 比对路径（错则统一 401），不能在 schema 层因长度被拒。只有 `newPassword` 受新策略约束。

`CandidateImportRowSchema.password` 是 `z.string().optional()`，行级输入不做长度校验；最终入库前由后端路由对每行密码补默认值或拒绝（详见 `routes/candidate.ts` import 流程）。

## 为什么 login 不做 min length

让登录 schema 拒绝短密码会带来两个负面后果：

1. **暴露策略历史**：旧账号若曾用 6 位密码注册（迁移自历史数据/Phase1 早期），抬高 schema 阈值后他们登录直接 400 而非 401，等于把"这个账号有效但密码短"的信号泄露给攻击者。
2. **改变错误语义**：登录错误必须统一回 `INVALID_CREDENTIALS`，不能因为长度差异落到 `VALIDATION_ERROR`。
认证失败的 timing 与状态码必须一致，避免给暴力枚举提供旁路通道。

因此：
- 登录 schema 仅校验非空 + max 长度（DoS 上限）
- 真正的"密码错误"判定由 `auth.ts` 在 argon2/bcrypt 比对失败时统一返回 401 + `INVALID_CREDENTIALS`

## 演进路径（Phase2）

如要做运行时策略：

1. 在 `apps/api` 启动时读 `PASSWORD_MIN_LENGTH` env，构造 `RuntimePasswordPolicy`
2. 在路由层用 `passwordField(runtimePolicy)` 重新构造 schema 实例（zod schema 是值，可以按需创建）
3. 前端通过 `GET /api/system/password-policy` 拿到当前策略，用于注册/改密界面提示
4. Organization 级策略需要 `OrganizationSettings.passwordPolicy` JSON 字段 + 同接口 per-org 返回

但这些**不**属于 S07-lite。S07-lite 只做集中化与 min 8 抬升两件事。

## 验证

- `packages/contracts/src/__tests__/passwordPolicy.test.ts` —— 工厂行为边界
- `packages/contracts/src/__tests__/contracts.test.ts` 末段 `password policy enforcement at boundary` —— 4 个 schema 的 7-char/8-char 拒绝/接受边界，以及 `LoginRequestSchema` 短密码仍接受

种子用户密码（`admin123`、`teacher123`、`candidate123`）全部 ≥ 8，不受 min 抬升影响。
