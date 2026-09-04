# Exam 项目代理协作契约

本文件规定整个仓库内编码代理必须遵守的工作方式、项目边界和文档路由。它不是第二份产品规格、架构文档、测试手册或阶段状态表。更具体的目录级 `AGENTS.md` 可以增加局部约束，但不得静默削弱本文件、Accepted ADR、产品契约或安全边界。

本仓库只维护一份 agent instruction 的语义权威：本文件。支持 `AGENTS.md` 的 harness 直接加载；需要专用入口文件的工具只能通过薄适配引用本文件，禁止复制正文形成第二套规则。若工具不会自动读取 `AGENTS.md`，调用者必须显式注入或桥接本文件后再施工。

规范词“必须”“禁止”“应当”“可以”具有约束含义。

## 1. 项目定位

Exam 是面向局域网和本地部署的通用考试与测评平台。一个部署代表一个机构；当前运行模式是单租户、多用户，`organizationId` 是内部数据归属边界，不代表已经提供多租户产品能力。

项目不得硬编码学校、大学、学生、学号、工号或某一门课程等单一使用场景：

- 产品标题、机构名称和品牌信息来自部署设置；
- 考试名称来自领域数据；
- Candidate 是通用考生身份，其字段由 `CandidateField` 定义；
- Course 可以表示课程、培训模块、认证类别或准入领域；
- 场景化文字只能出现在文档、测试、Story 或明确的演示数据中。

运行时必须保持 LAN/on-premise 和离线可用，不得顺手加入云端 API、CDN、外部遥测服务或在线服务依赖。外部工具可以用于代理侧研究，不能因此成为产品运行依赖。

## 2. 工作模式与授权

开始任务时先判断当前处于哪一种模式：

- **调查/审计**：只读取、复现、测量和报告，不修改文件；
- **设计**：提出边界、备选方案、风险和验证方法，不实施；
- **施工**：只有得到明确修改授权后才进入；`/tdd` 可以作为施工授权；
- **评审**：检查现有 diff、证据和风险，不擅自替作者继续扩展功能。

施工前必须：

1. 检查 `git status --short`、当前分支和基线，保护已有改动；
2. 阅读相关代码、测试以及本文件第 4 节路由到的权威文档；
3. 明确预期行为、改动边界和验证信号；
4. 如果存在会实质改变产品或架构的多个合理方案，先等待人类确认；
5. 对根因未知的问题先建立可重复证据，不猜测后直接改代码。

未经明确要求，禁止 commit、push、merge、rebase、force-push、切换他人分支或执行破坏性 Git 操作。不得使用 `git reset --hard`、`git clean` 或整仓恢复来处理不属于当前任务的文件。

## 3. 长期修改原则

- 优化项目全生命周期的正确性、可维护性、认知复杂度和变更风险。
- AI 写代码快不代表代码没有成本；代码量、抽象、依赖、迁移和理解成本都是真实成本。
- 先寻找和扩展已有正确结构，避免为同一职责建立第二条实现路径。
- 同一种事实只保留一个权威写入口；派生信息应由代码生成、引用权威来源或删除。
- 结构性问题在结构层解决，不用特例、吞错、无界重试或宽泛兜底掩盖根因。
- 替换完成后删除旧实现，不长期保留新旧双轨、兼容壳和无调用代码。
- 遵循 KISS；选择满足当前需求的最小长期正确设计，不为了理论纯粹性扩大系统。
- 只修改完成当前任务所必需的邻近结构；无关问题记录为后续工作，不顺手扩大范围。
- 优先使用清晰的类型、Schema、状态机和模块边界表达约束，禁止用 `any`、类型断言或重复 DTO 绕过设计问题。
- 单一调用不是禁止 helper 的理由；仅在 helper 形成清晰语义边界、隔离生命周期/错误边界或显著降低认知负担时抽取。
- 单文件超过 2000 行触发结构审查，不触发机械拆分。按独立变化原因、生命周期、领域边界和可测试性决定是否拆分；生成文件和声明式表格单独判断。
- 成熟第三方库能显著降低自维护复杂度，且依赖成本合理时优先复用；简单稳定的能力不为“禁止造轮子”而强行引入依赖。

## 4. 信息权威与任务路由

文档入口和冲突处理规则见 [`docs/README.md`](docs/README.md)。不同类型的事实由不同载体负责，不使用一个全局优先级比较所有信息。

| 信息 | 权威来源 |
| --- | --- |
| 特定架构决策 | Accepted ADR |
| 对外行为和数据格式 | `docs/contracts/`、OpenAPI 和契约测试 |
| 产品不变量与领域模型 | `docs/SPEC.md` |
| 当前实现架构 | `docs/architecture/` 与生产代码 |
| 阶段边界 | `docs/roadmap/phase-roadmap.md` |
| 当前施工顺序与 disposition | `docs/README.md` 中的 active roadmap tracker 指针 |
| 当前任务的 scope / acceptance / non-goals | 被当前 roadmap 指定的 OPEN Issue |
| 当前实现状态 | `docs/status/implementation-status.md` 与 as-built evidence |
| 测试、环境变量和数据库生命周期 | `docs/standards/testing.md` |
| 代码质量和依赖边界 | `docs/standards/code-quality.md` |
| 前端视觉系统 | `docs/architecture/frontend.md`、`docs/standards/ui-system.md` |
| 实际命令与 CI 接线 | `package.json` scripts、`.github/workflows/` |
| 修改历史 | Git、已关闭 Issue、已合并 PR 与 `docs/archive/` |

OPEN Issue 是施工合同，不是运行时事实 authority。开始施工前必须用 current master 对 Issue 做 reality audit；Issue body、评论或旧 checkpoint 与当前实现冲突时，先刻画 as-built，再更新任务契约。Closed Issue、merged PR、审计报告和 Archive 只作为历史证据，不得覆盖当前代码、Accepted ADR 或产品契约。

如果同一事实在两个来源中不一致，必须把冲突视为缺陷：先用代码、测试或精确静态论证描述 as-built 行为，再确认哪个权威来源过期或被违反，最后一起收敛。禁止挑选最方便的一份，也禁止为了让文字一致而伪造实现状态。

### Issue 同步协议

有对应 GitHub Issue 的施工必须保持 Issue 与代码同步：

1. 开工前记录 current-master reality；Issue 明显过时时先更新 scope、acceptance 或 disposition。
2. 施工中若 root cause、contract、scope 或决策发生实质变化，及时更新 Issue，不等最终 closeout。
3. 新发现但不属于当前 closure 的问题，不静默塞进当前 PR；关联已有 Issue 或建立 focused follow-up。
4. PR ready 前确认代码、测试、长期文档、Issue 和 PR 描述表达同一个系统现实。
5. merge 后写 closeout；只有 acceptance criteria 完整满足才关闭 Issue。若存在当前 roadmap tracker，再写一次 campaign checkpoint，不逐 commit spam。

按任务只加载相关文档，不需要遍历全部 `docs/`；表中列出的文档也只读取解决当前问题所需的章节，不默认全文预加载：

| 任务类型 | 施工前必须阅读 |
| --- | --- |
| 产品范围、角色、领域语义 | `docs/SPEC.md`、`docs/roadmap/phase-roadmap.md`、当前状态文档 |
| 状态机、答题、恢复、批改 | `docs/architecture/exam-runtime.md`、相关 Accepted ADR/契约 |
| 权限、角色、scope | `docs/architecture/authorization.md`、相关 Accepted ADR |
| 数据库、测试隔离、CI、flake | `docs/standards/testing.md`、`docs/standards/test-flakes.md` |
| 前端结构和视觉修改 | `docs/architecture/frontend.md`、`docs/standards/ui-system.md`、`DESIGN.md` |
| 产品文案与 i18n | `docs/standards/i18n-copy-policy.md`、部署设置与 locale 的权威实现 |
| 部署、备份、升级 | `docs/deployment/` 中对应 runbook/contract |
| 形式化模型 | `formal/AGENTS.md`、`formal/README.md` 和相应模型说明 |
| Docker、pnpm、Node、框架升级 | 本地配置与锁文件；行为仍不确定时再查对应版本的官方文档 |

## 5. 不可绕过的产品与架构边界

- PostgreSQL 是唯一支持的数据库。
- 所有业务数据访问必须通过 repository；repository 方法显式接收 `RequestContext`，route 禁止直接查询数据库。
- `organizationId` 来自当前请求的内部组织边界；禁止暴露 `organizationSlug` 登录、租户切换器、SuperAdmin 或可运行的 `multiTenant` 模式，除非对应平台化任务得到明确批准。
- Exam 和 ExamAttempt 不是普通 CRUD；状态变化必须通过领域 command/engine，禁止直接写 status 绕过状态机、授权、审计或事务。
- 服务端是时间与考试规则权威；客户端倒计时仅用于显示。
- 发布/开始考试后的题目、评分规则和相关策略必须使用冻结快照，不能被题库或配置的后续修改反向改变。
- 答案保存遵循版本化、幂等和冲突检测协议；不得用最后写入覆盖、仅在交卷时保存或客户端时间替代服务端版本。
- API 输入/输出 Schema 和 DTO 来自 `@exam/contracts`；领域类型来自 `@exam/domain`，不得重新定义同义类型。
- `packages/domain` 不依赖 Fastify、React、Drizzle 或其他内部 package；`apps/web` 不得直接依赖数据库或服务端 package。完整依赖图以代码质量文档和 `pnpm lint:arch` 为准。
- 安全相关业务变更必须保持统一错误、结构化日志、权限边界和所需审计，不通过隐藏错误或降低校验来换取绿灯。

## 6. 数据库与真实资源安全

数据库生命周期的唯一完整契约是 [`docs/standards/testing.md` §2](docs/standards/testing.md#2-environment-variable-contract)，尤其是 §2.8。代理不得在本文件中维护另一套环境变量或数据库创建/清理流程。

执行迁移、seed、truncate、drop、reset 或 E2E 清理前必须：

1. 确认命令的生命周期所有者和允许目标；
2. 解析并查询进程实际连接的数据库，不能只根据 `.env` 文件名猜测；
3. 证明目标是测试/E2E 数据库，或取得清理人工开发数据的明确授权；
4. 使用仓库已有脚本和名称安全保护，不发明第四套数据库或临时清理协议。

禁止让测试读写人工开发数据库，禁止用 demo seed 污染测试数据库，禁止以静默 `|| true`、吞错或后台遗留连接掩盖清理失败。

## 7. 开发与测试策略

默认使用 TDD，但不把它变成仪式：

- 行为已知的新功能和 Bug：先建立会在修改前失败的测试或最小复现，再实现和重构；
- 根因未知、性能、并发、时序或工具链问题：先调查、测量和建立 characterization，再进入修复；
- 测试必须覆盖真实契约，不通过过度 mock 复刻实现；优先把 mock 放在架构外部边界；
- 单元/组件测试可以覆盖下一层真实依赖，更深的外部边界再隔离；数据库语义使用真实 PostgreSQL；
- 时间和并发测试使用可控时钟、barrier、deferred promise 或显式生命周期信号，禁止用长 sleep、重试和扩大 timeout 证明正确性；
- 修复 flake 时必须找到非确定性来源和生命周期所有者，不以增加等待、重跑或降低并发作为完成条件。

开发循环运行最小相关测试，不在每次局部修改后机械执行全量门禁。完成后依据变更影响逐级扩大：

1. 相关测试文件或 package；
2. 相关 lint、typecheck、架构/契约检查；
3. 涉及数据库、E2E、部署或真实用户路径时运行对应真实资源验证；
4. 公共契约、共享基础设施、发布候选或合并门禁要求时运行 `pnpm verify`/E2E。

命令以根 `package.json` 为唯一来源。常用入口包括：

```bash
pnpm format:check
pnpm lint
pnpm lint:eslint
pnpm lint:arch
pnpm typecheck
pnpm test
pnpm verify:static
pnpm verify
bash scripts/e2e/run-wsl.sh
pnpm e2e:docker
```

不得把未执行的门禁报告为 PASS；工具不可用或测试不适用时，明确记录 `SKIPPED` 和原因。

## 8. 前端任务路由

前端视觉事实不在本文件重复。修改业务页面前按顺序检查：

1. `apps/web/src/components/ui/` 中的 shadcn/Radix primitive；
2. `apps/web/src/components/shared/` 中的权威业务组件；
3. `apps/web/src/typography/`、`apps/web/src/surface/` 和语义 token；
4. `docs/standards/ui-system.md` 的组件职责和 Tailwind 边界。

存在同一语义角色的组件时必须扩展其权威实现，不得局部复制第二套。业务页面可以使用 Tailwind 负责布局和响应式结构，但受治理的排版、surface、elevation 和 domain status 必须经过相应 recipe、component 或 mapping。不得手写 Radix/shadcn 已负责的 focus trap、Dialog、Select、Popover 等复杂交互 primitive。

前端可见权限只改善 UX；后端授权始终是安全权威。

## 9. 注释与文档

代理必须阅读修改区域附近的现有注释，但应结合类型、代码、测试和契约验证，不能无条件相信注释。

禁止：

- 复述显然控制流、类型或变量名的注释；
- Issue、PR、Job、Phase、修复记录和版本迁移等历史型生产注释；
- 用长注释弥补职责混乱、命名不清或无法测试的结构。

应当保留：

- `WHY`：无法从实现可靠推导的设计原因；
- `INVARIANT`：状态、顺序、边界和必须始终成立的条件；
- `OWNERSHIP`：资源、事务、任务和生命周期所有者；
- `LOCK ORDER`：并发锁序、唤醒和 happens-before 约束；
- `PROTOCOL` / `INTENTIONAL`：协议限制以及看似可简化但不能修改的原因。

能够通过类型、Schema、assertion、测试或静态检查表达的约束应优先可执行化；注释只保留不可执行的原因和边界。修改相关代码时必须同步审查附近注释，失效注释属于缺陷。

文档负责概念、架构、契约、导航和代码无法自然表达的唯一信息，不复述实现流程。产品代码和长期文档描述当前完整状态，不包含施工报告、补丁说明或“本次修改了什么”；历史和过程属于 Git、Issue、PR 或 Archive。

## 10. 依赖与外部研究

外部研究遵循**最小充分证据**原则，按成本从低到高升级：

1. 先检查当前代码、相关测试、配置、锁文件、生成产物和错误输出；
2. 本仓库已有权威文档或契约能够回答时，读取与当前问题直接相关的章节；
3. 只有存在明确且尚未解决的版本特定行为、外部标准或第三方语义缺口时，才查询对应版本的精确官方资料；
4. 只有任务本身需要 prior art / current external evidence，或精确官方资料仍不足时，才扩大为更广泛的外部研究。

当前决策已经有充分证据时必须停止升级；不得为了“可能有帮助”继续扩大上下文、搜索范围或工具调用。外部示例只是参考，不能高于仓库契约；禁止盲目复制。若无法访问所需官方资料，明确说明只使用了本地证据。

密钥、令牌和生产凭证不得进入版本控制，即使仓库是私有的；使用环境变量、密钥管理或被忽略的本地配置。

## 11. 交付与复核

每个可交付变更必须语义内聚、可独立回滚，并保持仓库可构建、可运行。提交前至少检查：

- 是否产生架构分叉、重复真相源或新旧双轨；
- 是否混合职责、遗留无效代码或引入无价值抽象；
- 是否扩大任务范围、增加过度兜底或隐藏失败；
- 类型、契约、实现、测试、注释和文档是否一致；
- 最终 diff 是否只包含授权范围内的修改；
- 工作树中的既有文件是否完整保留。

非平凡任务的完成报告必须基于实际证据；具体字段以 [`docs/standards/code-quality.md` §17](docs/standards/code-quality.md#17-ai-coding-rules) 的“每个 Job 完成后必须输出”为唯一清单。不得用“应该通过”“看起来正确”或“CI 会检查”代替证据。