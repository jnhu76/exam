# Phase 1 Implementation Plan

> 基于 `docs/SPEC.md` §7 Phase 1 清单 + `docs/phase1-ui-design.md` UI 设计 + `docs/code-quality.md` 质量门禁。
> 每个 job 独立文件：`docs/jobs/phase1_job*.md`，含子任务、验收标准、TDD 记录、review 结果。

---

## Dependency Graph

```
J0  Infrastructure Setup
  ↓
J0.5  Domain + Contracts Skeleton
  ↓ ↓
  J1  DB Schema + Repository Layer    J2  Client Scaffold
  ↓                                   ↓
  J3  Auth System (Server + Login) ───┘
  ↓
  J4  Organization Settings + User + Candidate Management
  ↓
  J5A Course + Question Bank
  ↓
  J5B Exam Management + Manual Paper Builder
  ↓
  J6  Exam Taking Flow
  ↓
  J7  Auto-Grading + Result Page
  ↓
  J8  Score Management + CSV Export
  ↓
  J9  Health Check + Dashboard + Docker Compose
```

**并行**：J1 + J2 可以在 J0.5 之后同时进行。
**串行**：

- J0 → J0.5 是硬前置
- J0.5 → J1 → J3 是数据库+认证链
- J3 → J4 → J5A → J5B → J6 → J7 → J8 → J9 是业务功能链
- J6 → J7 → J8 必须串行（J7 依赖 J6 的 submitted attempt，J8 依赖 J7 的 score result）

---

## Jobs

| Job  | File                                      | Description                                            | Status         |
| ---- | ----------------------------------------- | ------------------------------------------------------ | -------------- |
| J0   | [phase1_job0.md](jobs/phase1_job0.md)     | Infrastructure Setup                                   | 🔄 In Progress |
| J0.5 | [phase1_job0.5.md](jobs/phase1_job0.5.md) | Domain + Contracts Skeleton                            | ⬜ Pending     |
| J1   | [phase1_job1.md](jobs/phase1_job1.md)     | Database Schema + Repository Layer                     | ⬜ Pending     |
| J2   | [phase1_job2.md](jobs/phase1_job2.md)     | Client Scaffold (Layout + Routing + Shared Components) | ⬜ Pending     |
| J3   | [phase1_job3.md](jobs/phase1_job3.md)     | Auth System (Server + Login Page)                      | ⬜ Pending     |
| J4   | [phase1_job4.md](jobs/phase1_job4.md)     | Organization Settings + User + Candidate Management    | ⬜ Pending     |
| J5A  | [phase1_job5a.md](jobs/phase1_job5a.md)   | Course + Question Bank                                 | ⬜ Pending     |
| J5B  | [phase1_job5b.md](jobs/phase1_job5b.md)   | Exam Management + Manual Paper Builder                 | ⬜ Pending     |
| J6   | [phase1_job6.md](jobs/phase1_job6.md)     | Exam Taking Flow                                       | ⬜ Pending     |
| J7   | [phase1_job7.md](jobs/phase1_job7.md)     | Auto-Grading + Result Page                             | ⬜ Pending     |
| J8   | [phase1_job8.md](jobs/phase1_job8.md)     | Score Management + CSV Export                          | ⬜ Pending     |
| J9   | [phase1_job9.md](jobs/phase1_job9.md)     | Health Check + Dashboard + Docker Compose              | ⬜ Pending     |

---

## Phase 1 Scope (from SPEC.md §7)

> Phase 1 仅实现以下功能，其余全部暂缓。

- 单机构或轻量多租户（平铺 Organization，不做树形层级）
- 平台/机构展示配置（产品标题、副标题、页脚、机构显示名）由管理员配置，不在代码中硬编码
- 本地账号登录（用户名 + 密码）
- Admin / Teacher / Candidate 三类角色
- 题库 CRUD（手动创建 + CSV 导入）
- CSV 导入考生（按 CandidateField 动态模板）
- 手动组卷（从题库选题）
- **timed_window 一种计时模式**（其他模式 Phase 2）
- 客观题答题界面（单选/多选/判断/填空）
- 答案自动保存（Answer Save Protocol）
- 服务端计时
- 自动批改（Grading Engine）
- 成绩 CSV 导出
- Docker Compose 部署（app + PostgreSQL）

### Phase 1 暂缓

- 随机抽题 → Phase 2
- PDF / Word 导出 → Phase 2
- WebSocket 监考面板 → Phase 2
- Electron 锁屏 → Phase 2
- 自适应三档降级 → Phase 2（Phase 1 仅基本健康检查）
- timed_sync / deadline / untimed → Phase 2
- 复杂重考策略（daily_limit / weekly_limit）→ Phase 2

---

## Execution Order

```
Week 1:  J0 → J0.5 → J1 + J2 (parallel after J0.5)
Week 2:  J3 → J4
Week 3:  J5A → J5B
Week 4:  J6 → J7
Week 5:  J8 → J9
```

**Checkpoint after each Job**: 所有 verify 步骤通过才能进入下一个 Job。每个 Job 必须通过 `docs/code-quality.md` 定义的 Code Quality Review Checklist。

---

## Key Architecture Notes

- **ExamAttempt** replaces old ExamPaper — supports multiple attempts per exam
- **ExamEnrollment** tracks qualification + attempt count + final score
- **Answer Save Protocol** — versioned, idempotent saves with conflict detection
- **Repository pattern** — all db access via `repo.method(ctx, ...)`, never bare SQL in routes
  - Route 层禁止直接访问 db
  - 所有 repository 方法必须接收 RequestContext
  - 所有业务表查询必须带 organizationId
  - SuperAdmin 跨租户操作必须显式传 targetOrganizationId
- **Command functions** — all exam state changes via `publishExam()`, `startAttempt()`, etc.
- **packages/domain cannot depend on Fastify**
- **packages/contracts cannot depend on Fastify**
- **apps/api 和 apps/web 不允许各自重复定义核心 DTO** — 所有共享类型从 packages/domain 或 packages/contracts 导出
- **统一错误处理** — 所有 domain error 使用 `packages/domain/src/errors.ts` 定义的类型
- **结构化日志** — 使用 pino，禁止 console.log
- **环境变量校验** — Zod 校验，启动时 fail fast
- **配置驱动 UI 文案** — 登录页标题、侧栏产品名、页脚、机构名称、考试名称均来自 Organization/Platform settings 或业务数据；生产代码不得硬编码"校内/校园/大学/实验室/学生/工号/化学"等场景词

### Database Rollout

- J1-J8 默认使用 SQLite：本地开发、CI、集成测试和单机演示先共用一套轻量数据库链路。
- J9 增加 PostgreSQL schema、migration、repository adapter 和 Docker Compose 生产部署。
- J9 必须在 PostgreSQL 上跑完整 migration、integration test 和 smoke test，重点检查 JSON、时间戳、布尔值、唯一约束、事务和并发写入差异。
- Phase 1 发布时 PostgreSQL 为生产默认；SQLite 继续用于 dev/demo。首次 PostgreSQL 切换不得推迟到 Phase 2。

---

## Product Generalization Decisions

Phase 1 必须把"考试系统"做成可适配不同机构、不同考试类型的通用产品，而不是写死为校内考试、实验室考试或某一门课程考试。

### 配置边界

| 内容            | 来源                                                                                  | Phase 1 要求                               |
| --------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| 产品标题        | `OrganizationSettings.productName`，没有则使用系统默认值                              | 登录页、侧栏、考生端页头统一读取           |
| 产品副标题/页脚 | `OrganizationSettings.productSubtitle/footerText`                                     | 登录页底部展示，可为空                     |
| 机构显示名      | `OrganizationSettings.organizationDisplayName`，没有则使用 `Organization.displayName` | 后台 header、SuperAdmin 机构列表展示       |
| 考试名称        | `Exam.title`                                                                          | 由管理员/教师创建考试时设置                |
| 考生身份字段    | `CandidateField`                                                                      | 不预设"学生/学号/工号"，导入模板动态生成   |
| 课程/分类名称   | `Course.name`                                                                         | 可表达课程、培训、认证、岗位准入等不同场景 |

### 生产代码禁区

生产 UI 和 API 默认文案不得写死以下场景词：

```text
校内 / 校园 / 大学 / 学生 / 学号 / 工号 / 实验室 / 化学 / 物理 / 数学
```

这些词只能出现在：

1. 文档示例；
2. Storybook 示例；
3. 测试 fixture；
4. 明确标记为 demo seed 的数据。

### Phase 1 最小实现

J4 必须增加"平台与机构设置"能力，至少支持：

- `productName`：产品标题，例如"内网考试平台"；
- `productSubtitle`：副标题，例如"机构内部测评与准入认证"；
- `footerText`：登录页或页脚说明；
- `organizationDisplayName`：机构显示名；
- `timezone`：默认时区；
- `candidateIdentityPreview`：根据 CandidateField 生成导入模板预览。

---

## Code Quality Gate

> 详见 `docs/code-quality.md`。每个 Job 必须满足以下门禁。

### Verify 命令（根目录）

```bash
pnpm verify
# 等价于:
pnpm format:check && pnpm lint && pnpm lint:copy && pnpm lint:arch && pnpm typecheck && pnpm test && pnpm coverage && pnpm build
```

### 按 Job 类型额外运行

| Job 类型                | 额外命令                                                       |
| ----------------------- | -------------------------------------------------------------- |
| 涉及数据库 (J1, J3-J8)  | `pnpm db:generate && pnpm db:migrate && pnpm test:integration` |
| 涉及 UI 主流程 (J6, J7) | `pnpm test:e2e`                                                |
| Phase 1 完成 (J9)       | `pnpm smoke`                                                   |

### Code Quality Review Checklist

每个 Job Review 必须检查（详见 `docs/code-quality.md` §16）：

1. 是否有重复 DTO？
2. 是否有 `any` / `as any`？
3. Route 是否直接访问 db？
4. Route 是否包含复杂业务逻辑？
5. Repository 是否接收 RequestContext？
6. 查询是否带 organizationId？
7. 状态变更是否通过 command function？
8. 答案保存是否幂等？
9. 错误是否使用统一 domain error type？
10. 是否写入必要 AuditLog？
11. 是否有测试？覆盖率是否达标？
12. 是否存在硬编码场景文案？产品标题、考试标题、考生字段是否配置驱动？
13. 是否有 console.log？
14. 是否引入了不必要依赖？
15. 是否通过 `pnpm verify`？

---

## UI Task Summary

每个有 UI 的任务都标注了 `UI Ref` 指向 `phase1-ui-design.md` 的具体章节。

| Job | UI 页面                                                                         | UI Ref                            |
| --- | ------------------------------------------------------------------------------- | --------------------------------- |
| J2  | Layout shells, Sidebar, Shared components                                       | §2.1, §2.2, §4.2, §6              |
| J3  | Login page                                                                      | §3.1                              |
| J4  | Organization settings, CandidateField config, User mgmt, Candidate mgmt, Import | §3.20, §3.13, §3.17, §3.18, §3.16 |
| J5A | Course mgmt, Question list, Question edit (4 types), Question import            | §3.14, §3.3, §3.4, §3.5           |
| J5B | Exam create, Exam detail                                                        | §3.6, §3.11                       |
| J6  | Exam list, Start exam, Take exam (core)                                         | §3.7, §3.10, §3.8                 |
| J7  | Result page (2 variants)                                                        | §3.9                              |
| J8  | Score list, Attempt detail                                                      | §3.19, §3.12                      |
| J9  | Dashboard, System health                                                        | §3.2, §3.15                       |
