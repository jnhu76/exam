# Phase 1 Job 0-5 Review - Codex

## Review Metadata

- command: `review`
- model: `codex`
- report_language: `zh-CN`
- target: `dev` at `f3ccaac`
- base: `master` at `37405b1`
- feature: `phase1-job0-to-job5`
- scope: Job 0、0.5、1、2、3、3.5、4、5A、5B
- auto_fix_allowed: `false`

## Executive Summary

当前实现可以完成 TypeScript 构建，现有测试也能通过，但还不能把 Job 0-5 视为完成。主要阻断项集中在多租户登录、停用账号、组织设置读取、CandidateField 驱动的考生管理、题目更新校验、跨租户外键关联、Phase 1 考试约束和质量门禁失真。

## Findings

### RF-001 - High - 多租户登录无法可靠定位租户

**Evidence**

- `packages/db/src/schema/sqlite.ts:85` 允许不同机构使用相同用户名。
- `packages/db/src/repository/userRepo.ts:12` 的 `findByUsername(username)` 不接收 `RequestContext` 或机构标识，直接返回全库首个匹配用户。
- `packages/contracts/src/auth.ts:22` 和 `apps/web/src/contexts/AuthContext.tsx:54` 的登录请求没有 `organizationSlug`。

**Risk**

同名账号存在于多个机构时，登录结果依赖数据库返回顺序。用户可能无法登录自己的机构，或者在密码相同的情况下进入错误租户，违反租户隔离原则。

**Suggested fix**

登录前先用机构 slug 解析租户，再使用 `(organizationId, username)` 查询用户。为部署默认机构保留显式 fallback，并增加双租户同名账号测试。

### RF-002 - High - 禁用账号仍可登录并继续使用旧会话

**Evidence**

- `apps/api/src/routes/auth.ts:51` 登录后只校验密码，没有检查 `user.isActive`。
- `apps/api/src/plugins/auth.ts:18` 验证 JWT 后直接写入上下文，没有重新确认用户是否仍然启用。
- `apps/api/src/routes/user.ts:87` 已支持将用户设为禁用。

**Risk**

管理员执行“禁用”后，账号仍可新建会话，旧 cookie 也会继续访问系统。

**Suggested fix**

登录时拒绝禁用账号；认证 middleware 每次根据 token 中的用户 ID 读取租户内用户并检查 `isActive`。增加禁用前后登录和旧 cookie 回归测试。

### RF-003 - High - 机构设置页面和动态品牌传播链路不可用

**Evidence**

- `apps/web/src/pages/admin/SettingsPage.tsx:26` 请求 `GET /api/admin/settings/branding`。
- `apps/api/src/routes/settings.ts:31` 只实现了该路径的 `PATCH`，没有管理端 `GET`。
- `apps/web/src/components/layout/BrandProvider.tsx:11` 只提供静态 fallback，从未调用公开品牌 API。

**Risk**

设置页加载后会进入错误态；保存后的标题、副标题和机构显示名不会传播到登录页、侧栏或考生页，未满足 Job 4.2。

**Suggested fix**

增加管理端读取接口；让 `BrandProvider` 根据当前租户 slug 加载 `/api/settings/branding`，保存设置后刷新 provider。增加 API 和 Web 集成测试。

### RF-004 - High - CandidateField 没有成为考生身份数据的权威定义

**Evidence**

- `apps/api/src/routes/candidateField.ts:38` 和 `:58` 可创建或修改任意数量 `unique: true` 的字段，没有执行“恰好一个唯一标识字段”约束。
- `apps/api/src/routes/candidate.ts:50` 创建考生时没有按 CandidateField 校验必填、类型或唯一标识。
- `apps/api/src/routes/candidate.ts:101` 导入仍硬编码 `username/password/name`，`apps/api/src/routes/candidate.ts:133` 永远返回 `updated: 0`。
- 没有实现 `PATCH /candidates/:id` 或禁用考生接口。
- `apps/web/src/pages/admin/CandidateFieldsPage.tsx:55`、`CandidatesPage.tsx:62` 和 `:63` 的主要操作按钮是空回调。

**Risk**

机构无法配置并依赖自己的考生身份字段；重复身份、缺失必填项和导入更新策略都无法正确处理。Job 4 的核心工作流尚未完成。

**Suggested fix**

在 service/repository 层集中校验 CandidateField；增加唯一标识约束、动态模板、preview/confirm 导入、重复更新、修改和禁用接口。完成对应 UI 对话框和动态列。

### RF-005 - High - 题目更新可以绕过题型校验，创建校验也不足以保证可自动批改

**Evidence**

- `packages/contracts/src/question.ts:94` 创建 schema 调用了 `superRefine(validateQuestionType)`。
- `packages/contracts/src/question.ts:113` 更新 schema 没有执行同样的题型校验，也没有与现有记录合并后再校验。
- `packages/contracts/src/question.ts:29` 只要求 `standardAnswer` 非 `null`/`undefined`；空字符串、空数组、指向不存在选项的答案仍可进入题库。

**Risk**

题目可在编辑后变成无效状态，发布考试时仍会冻结到快照中，后续自动批改会得到错误结果或无法稳定处理。

**Suggested fix**

按题型建立严格 schema，校验答案数量、答案值和选项对应关系；更新时合并现有题目后复用完整校验器。补充编辑后非法状态和发布快照测试。

### RF-006 - High - 跨租户关联 ID 没有在业务层校验

**Evidence**

- `apps/api/src/routes/question.ts:129` 创建题目时直接接受 `courseId`。
- `apps/api/src/routes/exam.ts:103` 创建考试时直接接受 `courseId` 和 `questionIds`。
- `packages/db/src/schema/sqlite.ts:124` 和 `:155` 的普通外键只保证记录存在，不保证关联实体与当前记录属于同一 `organizationId`。

**Risk**

租户 A 可以提交租户 B 的课程 ID，创建跨租户题目或考试关联。即使列表查询仍按租户过滤，数据模型已经违反隔离不变量，并会污染后续统计、删除和发布逻辑。

**Suggested fix**

增加租户内父实体查找和关联一致性检查；发布时确认题目均属于考试课程。补充双租户恶意 ID 测试。

### RF-007 - High - Phase 1 考试约束没有在 API 边界收紧

**Evidence**

- `packages/contracts/src/exam.ts:12` 允许 `timed_sync/deadline/untimed`。
- `packages/contracts/src/exam.ts:18` 允许 `random` 选题。
- `packages/contracts/src/exam.ts:20` 允许 `daily_limit/weekly_limit`。
- `apps/api/src/routes/exam.ts:103` 创建考试时直接持久化这些值。

**Risk**

外部调用方可以创建 Phase 1 执行链路不支持的考试配置。J6 只实现 `timed_window` 时会面对无法正确执行的持久化数据。

**Suggested fix**

为 Phase 1 create/update contract 使用收窄枚举，只接受 `timed_window`、`manual` 和 `unlimited/max_attempts/pass_then_stop`。增加拒绝 Phase 2 值的 API 测试。

### RF-008 - Medium - 归档状态变更绕过状态机 command

**Evidence**

- `packages/exam-engine/src/examCommands.ts:107` 已定义 `archiveExam()`。
- `apps/api/src/routes/exam.ts:249` 在路由中重复判断状态，随后于 `:258` 直接写入 `{ status: "archived" }`。

**Risk**

状态机规则会逐渐在路由和 domain command 之间漂移，违反“Exam is not CRUD”约束。

**Suggested fix**

像发布路由一样构造 adapter 并调用 `archiveExam()`。后续 open/close 入口也只调用 command。

### RF-009 - High - `pnpm verify` 的 lint、架构检查和 API coverage 是占位命令

**Evidence**

- 根 `package.json:12` 的 `lint:arch` 只是 `echo`。
- `apps/api/package.json:9`、`apps/web/package.json:9` 以及多数 package 的 `lint` 只是 `echo 'lint: TODO'`。
- `apps/api/package.json:11` 的 coverage 也是占位命令。
- 生产代码仍有大量显式 `any`，例如 `apps/api/src/plugins/auth.ts:8`、`apps/api/src/routes/question.ts:26`。

**Risk**

`pnpm verify` 显示成功，但没有执行 `docs/code-quality.md` 要求的 ESLint、`no-explicit-any`、复杂度检查、依赖边界检查或 API coverage。CI 会产生错误安全感。

**Suggested fix**

配置 ESLint 和 dependency-cruiser，将 API coverage 纳入真实执行并设定阈值；CI 增加 `lint:arch` 和 coverage。修复现存 `any` 后再把 Job 标记完成。

### RF-010 - High - API 没有统一错误处理，多个校验路径会返回 500

**Evidence**

- `apps/api/src/server.ts:22` 没有注册 domain/Zod error handler。
- 多个路由直接调用 `.parse()`，例如 `apps/api/src/routes/candidate.ts:94`、`course.ts:84`、`settings.ts:42`。
- 唯一的格式化逻辑 `apps/api/src/routes/helpers.ts:11` 只在少数 `safeParse()` 路径手工使用。

**Risk**

无效请求、唯一约束冲突和 domain error 会产生不一致响应，部分客户端错误会被表现为 500；也无法稳定保证不泄露内部细节。

**Suggested fix**

在 Fastify 注册统一 error handler，将 Zod 和 domain errors 映射为稳定错误 DTO；路由只负责 parse 和调用 service。补充错误响应契约测试。

### RF-011 - Medium - Job 4 管理 UI 仍是只读壳层

**Evidence**

- `apps/web/src/pages/admin/OrganizationsPage.tsx:53` 的“新增机构”按钮为空回调。
- `apps/web/src/pages/admin/UsersPage.tsx:61` 的“新增用户”按钮为空回调。
- `apps/web/src/pages/admin/CandidateFieldsPage.tsx:55` 的“添加字段”按钮为空回调。
- 这些页面没有编辑、删除、禁用、排序、模板下载或确认对话框。

**Risk**

API 即使部分可用，管理员也无法通过产品 UI 完成 Job 4 要求的端到端工作流。

**Suggested fix**

按 Job 4 UI strategy 完成创建/编辑表单、删除确认、禁用操作、动态列、拖拽排序和导入向导，并用交互测试覆盖真实动作而非仅检查按钮存在。

### RF-012 - Medium - Question import 不是 preview/confirm 流程，且未复用共享导入组件

**Evidence**

- `apps/web/src/pages/admin/QuestionImportPage.tsx:173` 点击导入后直接调用服务端。
- `apps/api/src/routes/question.ts:312` 服务端在校验每一行后立即写库。
- `apps/api/src/routes/question.ts:249` 的 `warnings` 初始化后从未增加。
- Job 4 要求的 `ImportWizard.tsx`、`FileUpload.tsx` 和 `packages/import-export/src/csv.ts` 不存在。

**Risk**

用户无法在落库前确认异常行；warning 状态不可达；候选人和题目导入各自重复实现 CSV 行为。

**Suggested fix**

建立共享 CSV parser 和 ImportWizard，服务端拆分 preview 与 confirm，或使用经过确认的导入 token。增加 BOM、引号、换行、warning 和部分失败测试。

### RF-013 - Medium - 登录限流配置与 Job 3 要求不一致

**Evidence**

- `apps/api/src/plugins/rateLimit.ts:6` 注册全局 `100/min` 限流。
- `apps/api/src/routes/auth.ts:47` 的登录路由没有 `10/min` 专用配置。

**Risk**

暴力尝试防护弱于设计值，同时所有业务路由受到不必要的全局限制。

**Suggested fix**

将登录路由设为 `10/min`，按需要为导入等高风险入口单独配置。增加第 11 次登录返回 429 和 `Retry-After` 的测试。

### RF-014 - Medium - JWT secret 存在可预测 fallback

**Evidence**

- `packages/auth/src/session.ts:4` 在未配置环境变量时使用固定值 `"change-me-in-production"`。

**Risk**

部署遗漏 `JWT_SECRET` 时，攻击者可自行签发任意角色 token。

**Suggested fix**

生产启动时强制要求高熵 secret；测试通过显式环境变量注入固定 secret。

### RF-015 - Medium - 审计日志表存在，但已完成管理操作没有写日志

**Evidence**

- `packages/db/src/repository/auditLogRepo.ts:5` 提供 repo。
- 生产路由中没有任何 `createAuditLogRepo` 调用。

**Risk**

用户管理、候选人导入、题库修改和考试发布等敏感操作不可追溯。

**Suggested fix**

明确 Phase 1 必须审计的动作，在 service/command 层统一写日志，并增加发布考试和批量导入的审计测试。

### RF-016 - High - 公开注册流程既不可用，也会在修通后形成匿名提权入口

**Evidence**

- `apps/api/src/routes/auth.ts:17` 将 `/register` 暴露为无需认证的公开接口。
- `apps/api/src/routes/auth.ts:31` 使用 `{} as RequestContext` 调用租户 repository。
- `packages/db/src/repository/baseRepo.ts:19` 对非 SuperAdmin 直接返回 `ctx.organizationId`，因此空上下文会产生缺失的 `organizationId`。
- `apps/api/src/routes/auth.ts:34` 固定创建 `Admin` 角色。

**Risk**

当前注册请求会在写数据库时失败。若只补上组织 ID，任何匿名调用者都可创建机构管理员账号。

**Suggested fix**

明确注册模型：如果仅由管理员建用户，则移除公开注册；如果保留初始化注册，则只允许一次性 bootstrap token 或受控邀请，并显式绑定租户。补充匿名注册拒绝测试。

### RF-017 - High - Web 会话无法在刷新后恢复，路由也缺少角色守卫

**Evidence**

- `apps/web/src/contexts/AuthContext.tsx:41` 仅从 `initialUser` 初始化用户状态，没有启动时调用 `/api/auth/me`。
- `apps/web/src/components/layout/AdminLayout.tsx:11` 未登录时直接返回 `null`，没有跳转登录页。
- `apps/web/src/components/layout/ExamLayout.tsx:4` 不检查用户是否登录或是否为 Candidate。
- `apps/web/src/App.tsx:26` 和 `:43` 直接挂载 `/admin/*` 与 `/exam/*`。

**Risk**

用户刷新页面后即使 cookie 有效，管理端也会显示空白页。候选人和管理端路由没有前端角色隔离，后续 J6 页面接入后会出现错误角色可直接打开页面的问题。

**Suggested fix**

在 AuthProvider 启动时加载 `/api/auth/me`；增加 RequireAuth 和 RequireRole 路由守卫；未登录跳转 `/login`，错误角色跳到对应首页或 403 页面。服务端权限校验仍保留为最终防线。

### RF-018 - Medium - 核心身份、资格和尝试记录缺少数据库唯一约束

**Evidence**

- `packages/db/src/schema/sqlite.ts:92` 的 `candidate_profiles` 没有限制 `userId` 唯一。
- `packages/db/src/schema/sqlite.ts:198` 的 `exam_enrollments` 没有限制 `(organizationId, examId, candidateId)` 唯一。
- `packages/db/src/schema/sqlite.ts:218` 的 `exam_attempts` 没有限制 `(organizationId, enrollmentId, attemptNo)` 唯一。

**Risk**

同一用户可拥有多个考生档案，同一考生可重复获得同一考试资格，同一次尝试编号也可重复。J6-J8 的次数限制、最终成绩和恢复逻辑会失去可靠基础。

**Suggested fix**

增加对应 unique indexes 和迁移，并在 repository/service 层将冲突映射为稳定 domain error。补充重复写入测试。

### RF-019 - Medium - Job 5A/5B 的管理 UI 仍缺少验收要求中的关键能力

**Evidence**

- `apps/web/src/pages/admin/QuestionPage.tsx:81` 只读取默认第一页，在 `:103` 对本地数组筛选；缺少 difficulty、tags 筛选和分页控件。
- `apps/web/src/pages/admin/ExamPage.tsx:110` 的列表没有参与人数。
- `apps/web/src/pages/admin/ExamDetailPage.tsx:103` 只展示配置卡片，没有实时统计和候选人列表。
- `apps/web/src/components/exam/ExamConfigForm.tsx:235` 没有控制模式预设按钮，也没有编辑 `batchSize`、`batchInterval`、`restrictIp` 和 `requireLockdown`。

**Risk**

教师无法完成 Job 文档要求的题库筛选、分页、考试配置和考试详情工作流。J10 只能做视觉优化，不能补建这些缺失功能。

**Suggested fix**

按 Job 5A/5B UI Strategy 补齐服务端筛选参数、分页控件、考试统计 DTO、候选人列表和全部控制项，并增加交互测试。

### RF-020 - Medium - 题目批量导入没有行数限制或专用限流

**Evidence**

- `apps/api/src/routes/question.ts:12` 的导入 schema 使用 `z.array(...).min(1)`，没有 `.max(...)`。
- `apps/api/src/routes/question.ts:225` 的题目导入路由没有 import-specific rate-limit 配置。
- `apps/api/src/routes/question.ts:252` 在请求处理期间逐行校验并同步写数据库。

**Risk**

单个请求可提交大量题目并占用事件循环和数据库写入时间，LAN 环境中也可造成服务不可用。

**Suggested fix**

像考生导入一样增加明确批次上限和专用限流；将 schema 放入 `@exam/contracts`；增加超限返回 400/413 和限流测试。

### RF-021 - Medium - 删除含题目的课程依赖外键异常，没有返回稳定的业务冲突

**Evidence**

- Job 5A.1 要求存在题目时阻止删除课程。
- `apps/api/src/routes/course.ts:145` 直接调用通用 repository 删除。
- `packages/db/src/schema/sqlite.ts:124` 的题目课程外键会阻止删除，但没有 route/service 层预检查或 domain error 映射。

**Risk**

用户删除含题目的课程时会收到未知数据库错误路径，通常表现为 500，而不是可理解的 409 冲突。

**Suggested fix**

增加 repository 计数或 service 校验，使用稳定冲突错误返回 409，并增加含题目课程删除测试。

### RF-022 - Medium - 测试应用没有复现生产插件组合，部分权限测试断言也无法证明行为正确

**Evidence**

- `apps/api/src/routes/testHelpers.ts:38` 只注册 cookie、DB 和 auth plugin，没有注册 tenant、rate-limit、security 或统一错误处理。
- `apps/api/src/routes/course.test.ts:120` 接受 `[200, 201, 403]` 任一结果，无法证明 Teacher 权限行为。
- 根 `pnpm test:integration` 当前只触发 `packages/db` 的测试。

**Risk**

生产组合中的租户、限流和错误映射回归不会被现有 API 测试捕获；部分测试即使行为错误也会通过。

**Suggested fix**

抽取与生产一致的 `buildApp()`，测试通过依赖注入替换 DB；将 API suite 接入 integration 入口；收紧权限断言。

### RF-023 - Medium - 考试发布校验不足以保证可执行配置

**Evidence**

- `packages/exam-engine/src/examCommands.ts:67` 只校验题目非空、及格分为正数和时长为正数。
- 没有校验 `openAt < closeAt`、`passingScore <= totalScore`、题目分值合计与 `totalScore` 一致，或题目是否属于考试课程。
- `apps/api/src/routes/exam.ts:196` 发布时按 ID 查题，但没有检查题目数量是否完整、课程一致性或自动批改可用性。

**Risk**

可以发布时间窗口无效、及格分高于总分、总分不一致或混入其他课程题目的考试。J6/J7 执行和批改会面对不一致快照。

**Suggested fix**

在 exam command/service 中集中执行发布前验证，route 只负责装配依赖。补充每个非法配置的发布拒绝测试。

### RF-024 - Medium - 统一 domain error 类型尚未按质量规范建立

**Evidence**

- `docs/code-quality.md:260` 要求权限、租户、答题冲突、考试开放状态和超时等稳定 domain errors。
- `packages/domain/src/errors.ts:1` 目前仅定义 `AppError`、`ValidationError`、`NotFoundError` 和 `InvalidStateTransitionError`。

**Risk**

后续 J6-J8 若各自临时定义错误响应，API 合同会漂移，也难以由统一 Fastify error handler 做稳定映射。

**Suggested fix**

补齐规范中的错误类和 HTTP 映射测试，在后续答题链路实现前固定错误合同。

## Missing Tests

- 双租户相同用户名登录与跨租户关联 ID 拒绝测试。
- 禁用账号重新登录、旧 cookie 访问拒绝测试。
- 匿名注册拒绝或受控 bootstrap 注册测试。
- 完整 `register -> login -> me -> logout -> me 401` API 测试。
- Web 刷新后通过 `/api/auth/me` 恢复会话、未登录跳转和角色守卫测试。
- 管理端品牌设置读取与 BrandProvider 刷新测试。
- CandidateField 唯一标识、必填校验、重复导入更新测试。
- CandidateProfile、Enrollment 和 Attempt 重复写入约束测试。
- 题目更新后完整题型校验测试。
- 题目导入批次上限和专用限流测试。
- 含题目课程删除返回 409 测试。
- Phase 2 考试枚举值拒绝测试。
- 发布考试的时间窗口、总分、课程一致性测试。
- 登录第 11 次请求返回 429 测试。
- Web 管理页面真实增删改导入交互测试。

## Validation Evidence

- `pnpm verify`: passed, but the result is not a complete quality signal because several lint/architecture/coverage tasks are placeholders.
- `pnpm test:integration`: passed; only `@exam/db` ran (`10` tests). API integration suites are not wired into this command.
- Existing test totals observed during `pnpm verify`: API `55`, Web `91`, DB `10`, Auth `8` including duplicated `dist` tests, Exam Engine `16`.
- Continuation review attempted local Fastify injection with `tsx --eval`; the first run was blocked by sandbox IPC permissions and the escalated run did not reach application logic because `tsx --eval` could not resolve workspace `@exam/db/src/*.js` subpaths. The added findings are grounded in static code evidence.
- `code_review/` is not listed in `.gitignore`; per Review Forge rules, recommend ignoring it before committing workflow artifacts.

## Review Status

- status: `open`
- status_label: `待处理`
- fixes_applied: `none`
