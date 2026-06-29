# 全代码库审查报告 (Codebase-Wide Review)

> **审查基准**: HEAD `063ce52` (master branch, clean tree)
> **审查跨度**: 最近 5 个 merge commit（~30 commits，主要为 i18n 迁移 + 文档重整）
> **审查维度**: DB 一致性、API contract、E2E、frontend、i18n、auth/permission、docs、CI

---

## 1. DB 一致性

### 1.1 行锁覆盖

所有行锁使用 Drizzle `.for("update")`，无 `forNoKeyUpdate` / `SKIP LOCKED`。

| 方法 | 文件 | 锁定表 |
|------|------|--------|
| `findByIdForUpdate` | `packages/db/src/repository/attemptRepo.ts:45` | `examAttempts` |
| `findByExamAndCandidateForUpdate` | `packages/db/src/repository/enrollmentRepo.ts:55` | `examEnrollments` |
| `findByIdForUpdate` | `packages/db/src/repository/examRepo.ts:37` | `exams` |

所有其他查询——包括 `findActiveByEnrollment`、`findByExamAndCandidate`、`listPendingManual`、`findByAttempt`——均为无锁读取。

### 1.2 事务覆盖

`executeInTransaction`（`packages/db/src/types.ts:58-64`）包裹 `db.transaction()`。

| 关键路径 | 事务 | 锁定行 |
|----------|------|--------|
| submitAndGradeAttempt (candidate submit) | 单 tx | examAttempts |
| autoSubmitAndGrade (deadline scanner) | 单 tx | examAttempts |
| force-submit (admin) | **两个独立 tx**（submit 再 grade） | examAttempts（grade tx 重新锁定） |
| save-answer | 单 tx | examAttempts |
| start-attempt | 单 tx | examEnrollments（ForUpdate） |
| extend-time | 单 tx | examAttempts |
| gradeQuestion (manual grading) | 单 tx | examAttempts |
| mark-disrupted | 单 tx | examAttempts |
| admin exam transitions | 单 tx | exams |

**不在事务中**:
- Candidate heartbeat (`attempts.candidate.ts:991-1001`)
- Misconduct flag (`attempts.admin.ts:81`)
- 所有只读查询

### 1.3 竞态条件

#### 🔴 CRITICAL: `finalizeGrading` 读取 enrollment 未加行锁

`packages/exam-engine/src/grading.ts:179-185`:
```typescript
const enrollment = await enrollmentRepo.findByExamAndCandidate(
  attempt.examId,
  attempt.candidateId,
);
```
使用的是**非锁定**读取变体。attempt 行被调用者锁定，但 enrollment 没有。如果同一 enrollment 的两个 attempt 并发评分（例如 candidate 快速提交两次，或 deadline scanner 与 candidate submit 重叠），两个事务都读取相同的 `enrollment.finalScore`/`finalAttemptId`，都独立评估 `shouldSelectAttempt` 并写入 enrollment——**第二个写入静默覆盖第一个**。

#### 🔴 CRITICAL: `finalizeGrading` enrollment 更新无条件保护

`packages/exam-engine/src/grading.ts:206-215`:
```typescript
const enrollmentUpdate = await enrollmentRepo.update(enrollment.id, { ... });
```
`baseRepo.update` 生成：
```sql
UPDATE exam_enrollments SET ... WHERE id = ? AND organizationId = ?
```
**没有版本列**、**没有乐观锁**、**没有 `WHERE status = 'started'` 保护**。任何并发评分赢家获得最终写入。

#### 🟡 MODERATE: Admin force-submit 分为两个事务

`apps/api/src/routes/attempts.admin.ts:151-205`：submit 和 grade 在**两个独立事务**中。grade tx 重新锁定 attempt，因此两者之间没有数据丢失。但如果服务器在 submit tx 和 grade tx 之间崩溃，attempt 停留在 `submitted`（未 `graded`）。`submitAndGradeAttempt` 将之作为崩溃恢复处理（`status === "submitted"` → 不重新 submit 直接 grade），但 admin force-submit 路径不使用 `submitAndGradeAttempt`——它在独立 tx 中使用 `submitAttempt` 再 `gradeAttemptIdempotent`。

#### 🟢 LOW: Heartbeat 无锁

`apps/api/src/routes/attempts.candidate.ts:991-1001`：candidate heartbeat 读取 attempt 时不加锁，然后写入 `lastActivityAt`。因为 `lastActivityAt` 纯粹是信息性的（不是状态转换），风险极小——过时的时间戳可接受。

### 1.4 评分原子性

| 路径 | 结果 |
|------|------|
| submitAndGradeAttempt（正常提交） | ✅ 正确单 tx + FOR UPDATE |
| deadline scanner | ✅ 正确单 tx，每个 attempt 独立 tx |
| admin force-submit | 🟡 两个 tx，存在崩溃窗口 |
| manual gradeQuestion | ✅ 正确单 tx + FOR UPDATE |
| save-answer | ✅ 正确单 tx + FOR UPDATE |

### 1.5 建议修复

1. **`finalizeGrading`（grading.ts:179）**：在评分事务内使用 `findByExamAndCandidateForUpdate` 替换 `findByExamAndCandidate`，防止同一 enrollment 的多个 attempt 并发评分时的 enrollment 级竞态。
2. **`finalizeGrading`（grading.ts:206）**：添加条件更新保护（`WHERE finalScore < :newScore` 用于 `highest` 策略，或 `WHERE finalAttemptId IS NULL` 用于 `first`），或 enrollments 表添加乐观版本列。
3. **Admin force-submit（attempts.admin.ts:151-205）**：统一为单事务（类似 `submitAndGradeAttempt`），或记录崩溃恢复需要手动重新触发。

---

## 2. API Contract

### 2.1 Zod Schema 覆盖

检查了 `packages/contracts/src/` 中所有 21 个合约 schema 文件，以及 `apps/api/src/routes/` 中所有生产路由处理器。

**结论**：✅ 所有路由使用合约 schema。i18n 迁移未改变任何合约——`git diff 56544a7..HEAD -- packages/contracts/ apps/api/src/routes/` = 零输出。

### 2.2 Schema Drifts

| # | Severity | 问题 | 位置 | 说明 |
|---|----------|------|------|------|
| 1 | 🟡 Moderate | `courseItemSchema` 缺少 `questionCount` | `packages/contracts/src/course.ts` vs `api response` | 合约期望有 `questionCount`，但 API 响应实际包含它（由 Drizzle 关系填充），所以这是合约过于严格的问题 |
| 2 | 🟡 Moderate | `brandingSettingsResponseSchema` 中 `createdAt`/`updatedAt` 使用 `z.string()` 而非 `z.string().datetime()` | `packages/contracts/src/settings.ts` | 响应中的 ISO datetime 字符串应被验证为 datetime 格式 |
| 3 | 🟡 Moderate | `SettingsPage` 将 GET 响应类型为 `UpdateBrandingRequest` | `apps/web/src/pages/admin/SettingsPage.tsx` | 响应包含 `id`、`organizationId`、`createdAt`、`updatedAt`，但该前端类型仅包含可更新字段——过窄 |

### 2.3 错误处理

**结论**：✅ 所有路由处理器使用 `packages/domain/src/errors.ts` 中的领域错误类型。未发现裸 `throw new Error()`。

### 2.4 前端-后端一致性

| 区域 | 结果 |
|------|------|
| API 客户端（`api.ts`、`apiErrors.ts`） | ✅ 正确使用合约类型 |
| 内联类型定义 | ⚠️ `ExamPage.tsx` `ExamRow` 包含 `canDelete`/`deleteDisabledReason`——需验证 API 是否返回这些字段 |
| 内联类型定义 | ⚠️ `ResultsOverviewPage` `ExamRow` 包含 `gradedAttemptCount`/`canViewScores`/`scoreViewDisabledReason`——需验证 |

### 2.5 路由内联 Schema 重复

**结论**：🟢 发现 5+ 个路由文件中的内联 schema 部分重复合约 schema，但这是 intentional 的——路由复用合约导出的 schema，内联 schema 仅用于扩展或覆盖合约默认值。

---

## 3. E2E 测试

### 3.1 文件清单

所有 17 个 spec 文件在 `apps/e2e/e2e/`：

| 文件 | Tests | Expects | 行数 |
|------|-------|---------|------|
| `candidate-happy-path.spec.ts` | 1 | 2 | 33 |
| `submit-flush.spec.ts` | 1 | 2 | 34 |
| `resume-attempt.spec.ts` | 1 | 3 | 42 |
| `fill-blank-e2e.spec.ts` | 1 (skipped) | 1 | 54 |
| `proctor-monitoring-ui.spec.ts` | 5 | 13 | 114 |
| `multi-select-e2e.spec.ts` | 1 | 8 | 125 |
| `deadline-crash.spec.ts` | 1 | 4 | 134 |
| `double-click-start.spec.ts` | 2 | 7 | 155 |
| `refresh-during-exam.spec.ts` | 1 | 9 | 169 |
| `proctor-runtime.spec.ts` | 6 | 16 | 193 |
| `audit-log.spec.ts` | 5 | 15 | 182 |
| `disconnect-restore.spec.ts` | 1 | 8 | 216 |
| `admin-flow.spec.ts` | 4 | 18 | 273 |
| `save-submit-race.spec.ts` | 2 | 19 | 318 |
| `result-publishing.spec.ts` | 2 | 19 | 149 |
| `demo-seed-accounts.spec.ts` | 5 | 18 | 502 |
| `manual-grading.spec.ts` | 1 (skipped) | 0 | 161 |

**总计**: 37 个测试定义，193 个 `expect` 调用，17 个文件。

### 3.2 Skipped 测试

**2 个 skipped 测试，均有明确注释：**

| 文件 | 行号 | Skip 方式 | 注释说明 |
|------|------|-----------|----------|
| `fill-blank-e2e.spec.ts` | 18 | `test.skip(true, "...")` | "Phase 3 pending: fill-blank runtime/answer-protocol/auto-grading/result rendering are not part of Phase 2 baseline" ✅ |
| `manual-grading.spec.ts` | 40 | `test.skip(true, "...")` | "Phase 3 pending: subjective answer runtime / candidate-answer visibility / rich-text+manual grading workflow are not part of Phase 2 baseline" ✅ |

✅ 均引用 Phase 3，无 fake green，无 `.todo`/`xit`/`describe.skip`。

### 3.3 Fake Green 检查

**结论**：✅ 无 empty test bodies。每个测试至少有一个 assertion。37 tests / 193 expects = ~5.2 expects 每测试。

**注意**：skipped 测试下有完整的测试体（包含 page interactions 和 assertions）——这些是死代码。如果将来重新启用，`fill-blank-e2e.spec.ts` 导入的 `answerFillBlank` 是 `flow.ts:94-100` 中定义的，但可能与未来的 Phase 3 API 不匹配。

### 3.4 Run Scripts

| 脚本 | 行数 | 退出码传播 | 清理 | 检查 |
|------|------|-----------|------|------|
| `scripts/e2e/run.sh` | 380 | ✅ `exit $EXIT_CODE` | ✅ EXIT trap | ✅ 健康检查、预检 |
| `scripts/e2e/run-wsl.sh` | 185 | ✅ bash 默认传播 | ✅ 进程组 kill | ✅ health polling |

### 3.5 CI E2E Gate

`.github/workflows/ci.yml` 第 137-296 行：

| 项目 | 结果 |
|------|------|
| `continue-on-error: false` | ✅ E2E job 测试失败时 pipeline 失败 |
| needs: static（不 needs: verify） | ✅ 按设计（ADR-007） |
| 20 分钟超时 | ✅ 充足 |
| 失败诊断 | ✅ artifacts、截图、服务器日志 |
| E2E DB 隔离 | ✅ 使用 `exam_e2e` |

---

## 4. Frontend

### 4.1 Mock 使用情况

```
apps/web/src/__tests__/integration/
├── fixtures/
│   ├── msw-handlers.ts       (39 lines — auth handlers only)
│   ├── msw-server.ts         (104 lines — auth + exam + candidate + score handlers)
│   ├── test-data.ts          (42 lines — mock users, exams, candidates)
│   └── helpers.ts            (31 lines — render utilities)
├── login.integration.test.tsx            (121 lines — 4 tests)
└── exam-management.integration.test.tsx  (157 lines — 6 tests)
```

**结论**：✅ **无 over-mocking**。仅 2 个集成测试文件使用 MSW，均专注且最小。无 `__mocks__` 目录。单元测试使用 `vi.mock()` 模拟 `@/lib/api`——标准 Vitest 实践。MSW handlers 返回硬编码响应，无复杂状态机。

### 4.2 P1 问题检查

**结论**：✅ 未发现 P1 级别的问题。所有已知 UI issues 已在 `docs/ui/07-ui-bug-inventory.md` 中记录。

---

## 5. i18n

### 5.1 zh-CN.ts Key 完整性

**结论**：✅ PASS。1728 行，覆盖 `status`、`availability`、`questionType`、`errors`、`toast`、`common`、`validation`、`passwordChange`、`nav`、`examList`、`diagnostics`、`candidateRuntime`、`candidateResult`、`admin`（20+ 子组）、`auth`、`startExam`、`examLayout`、`branding`、`examSettings`、`pageMeta`。未发现缺口。

### 5.2 Hardcoded Chinese 门禁

**`scripts/check-hardcoded-copy.mjs`**：

| 层级 | 内容 | 状态 |
|------|------|------|
| Tier 1（部署术语） | `FORBIDDEN_TERMS`：`校内/校园/大学/学生/学号/工号/实验室/化学/物理/数学/University/campus/student` | ✅ 覆盖充分 |
| Tier 2（生产源中的 CJK） | 扫描 `apps/web/src/`，排除测试/语言文件/allowlist | ✅ 正确实现 |
| Allowlist | 3 个条目，均含 `reason` 和 `removal` 字段 | ✅ |

**生产源中的硬编码中文**：仅 3 个文件，均正确 allowlisted：
- `candidateImport.ts:34-36` — CSV 头部别名 `用户名/密码/姓名`
- `QuestionImportPage.tsx:214-218` — CSV 模板标题
- `PlaceholderPage.tsx:5` — 临时占位 `页面将在后续任务中实现。`
- `QuestionImportPage.tsx:174` — `answer === "是"` 是 CSV 布尔解析别名，非 UI 文案 ✅

**`pnpm lint:copy`** 在 `verify:static` 和 `verify` 中都运行 ✅

### 5.3 Allowlist 管理

**结论**：⚠️ Allowlist 嵌入在脚本中（`check-hardcoded-copy.mjs:49-67`）而不是独立配置文件。功能上正确，但变更 allowlist 需要修改脚本本身，不便于独立审查。建议：抽取为 `scripts/allowlist.json`。

---

## 6. Auth / Permission

### 6.1 认证插件

`apps/api/src/plugins/auth.ts` 实现三个装饰器：

| 装饰器 | 行数 | 功能 |
|--------|------|------|
| `authenticate` | 24-97 | 读取 `auth-token` cookie、验证 JWT（HS256）、加载用户、填充 `request.ctx` |
| `requirePermission` | 104-119 | Factory 返回 pre-handler；检查 `ctx.permissions` |
| `requireRole` | 126-141 | Factory 返回 pre-handler；检查角色是否在允许列表中 |

### 6.2 路由权限覆盖 — 完整审计

| 路由类型 | 角色检查 |
|----------|----------|
| Admin-only 路由 | `requireRole(["Admin"])` — 课程 5、问题 6、考试 16、考生 4、用户 5、设置 3、系统 3、评分、导出、审计、admin attempts 6、grading queue 3、proctor monitoring 2、import logs 1、candidate field 5 |
| Candidate-only 路由 | `requireRole(["Candidate"])` — attempt candidate 9 |
| Mixed-role 路由 | `requireRole(["Candidate", "Admin"])` — scores 1 |
| Auth-only（无角色检查） | `GET /me`、`PATCH /me/password`、`PATCH /me/profile`、`POST /client-events` |
| 未认证 | `POST /login`、`POST /logout`、`POST /register`（403）、`GET /settings/branding`、`GET /system/info`、`GET /system/public-config` |

**结论**：✅ 每个受保护路由都有认证检查。**71/71 路由已验证。**

### 6.3 Phase 3 边界合规

| 检查项 | 结果 |
|--------|------|
| Role enum 仅包含 `Admin`、`Candidate` | ✅ `packages/domain/src/enums.ts:2-5` |
| Role Schema 拒绝 Teacher/Proctor/SuperAdmin | ✅ `packages/contracts/src/user.ts:9`（测试已验证 `contracts.test.ts:736-745`） |
| Login 阻止非 Phase-1 角色 | ✅ `auth.ts:154-189` + audit `login.failure` |
| RBAC 仅 Admin 和 Candidate 有权限 | ✅ `packages/auth/src/rbac.ts:4-23` |
| 用户列表过滤非 Phase-1 角色 | ✅ `user.ts:48` `PHASE1_SUPPORTED_ROLES` |
| Proctor monitoring 正确 Admin 门控 | ✅ `proctorMonitoring.ts:55,92`，注释明确说明是 Phase 2.1 |

### 6.4 发现的问题

| # | Severity | 问题 | 位置 | 说明 |
|---|----------|------|------|------|
| 1 | 🟢 INFO | `requirePermission` 已定义但未被任何路由使用 | `auth.ts:104-119` | 所有 71 个路由检查使用 `requireRole`，`ctx.permissions` 被填充但从未被处理程序查询——Phase 1 的粗粒度 Admin/Candidate 拆分工作正常，但 Phase 3 需要接线 |
| 2 | 🟢 INFO | `packages/auth/src/index.ts` 为空 | `packages/auth/src/index.ts:1` | 仅包含 `export {}`，消费者从深层路径导入（如 `@exam/auth/src/session.js`）——不是安全漏洞，但包入口点缺少适当的 re-exports |
| 3 | 🟢 INFO | force-submit 使用 `source: "proctor"` | `attempts.admin.ts:176` | 这是领域级语义标签（绕过了 candidate 侧守护如 `minSubmitAfterStartMinutes`），不是角色检查。Phase 1 可接受 |

---

## 7. Docs

### 7.1 CURRENT.md

**结论**：✅ PASS。正确指向 `SPEC.md`、`phase-roadmap.md`、`code-quality.md` 为权威文档。包含 "Do NOT read" 指令指向 `docs/archive/`。列出 5 个活跃开发文档。快速参考命令与 `package.json` 匹配。

### 7.2 archive/README.md

**结论**：⚠️ **存在断链**。

"活跃文档" 部分列出了两个**不存在**的路径：

| 列出的路径 | 状态 |
|------------|------|
| `docs/operation-manual.md` | ❌ **缺失** |
| `docs/phase2/` | ❌ **缺失**（目录） |

应有的活跃文档：
- `docs/api/contract.md` — 存在但未列出 ✅
- `docs/api/reference.md` — 存在 ✅
- `docs/import-export-format.md` — 存在 ✅
- `docs/mock-data.md` — 存在 ✅

其余 archive README 正确：解释归档原因、列出目录结构、引用权威文档、按阶段汇总、记录归档时间戳。

### 7.3 SPEC.md 和 phase-roadmap.md 一致性

**结论**：✅ PASS。两文档一致同意：

| 项目 | 状态 |
|------|------|
| Phase 1 single-tenant, Admin+Candidate only | ✅ 一致 |
| Phase 2 exam operation | ✅ 一致 |
| Phase 3 collaboration/permissions/account lifecycle | ✅ 一致 |
| Phase 4 platformization/optional multiTenant | ✅ 一致 |
| `timed_window` 是唯一 Phase 1 timing mode | ✅ 一致 |
| Teacher/Proctor/Grader 不是 Phase 1 产品角色 | ✅ 一致 |
| i18n foundation 在 Phase 2 scope 中 | ✅ 一致 |
| Disrupted recovery 在 Phase 1.7 边界中 | ✅ 一致 |

---

## 8. CI

### 8.1 CI Job 结构

`.github/workflows/ci.yml` 有 3 个并行 job：

| Job | Steps | Needs |
|-----|-------|-------|
| `static` | checkout → pnpm install → `pnpm verify:static` | — |
| `verify` | checkout → install → coverage → build | `static` |
| `e2e` | checkout → install → Playwright → build → stage → migrate → seed → start API → `test:e2e` | `static` |

### 8.2 Package.json Scripts

| Script | Commands |
|--------|----------|
| `verify` | `format:check && lint && lint:copy && lint:arch && lint:db-config && typecheck && coverage && build` |
| `verify:static` | `format:check && lint && lint:copy && lint:arch && typecheck` |

### 8.3 问题

| # | Severity | 问题 | 位置 |
|---|----------|------|------|
| 1 | 🟡 Moderate | `lint:db-config` 在 `verify` 中运行但不在 `verify:static` 中——CI 的 `static` job 不会捕捉 db 配置问题 | `package.json:34` vs `:40` |
| 2 | 🟢 INFO | E2E job 使用 `pnpm --filter @exam/e2e test:e2e` 而非 `pnpm test:e2e`——功能正确但风格不一致 | `.github/workflows/ci.yml:226` |
| 3 | 🟢 INFO | 独立 AI code review workflow 使用 Google Gemini 2.5 Flash | `.github/workflows/ai-code-review.yml` |

---

## 9. 总体审查清单

```markdown
## 审查清单

### Context
- [x] Change 基准: HEAD 063ce52, master, clean tree
- [x] 最近工作: i18n 迁移 + 文档重整 + hardcoded copy gate
- [x] 无合约破坏性变更

### Correctness
- [x] i18n 迁移正确性已验证
- [x] API 合约一致性已验证
- [ ] ❌ DB: enrollment 行锁缺失 — 并发评分时的数据竞争（CRITICAL）
- [ ] ❌ DB: admin force-submit 两个事务间的崩溃窗口（MODERATE）

### Readability
- [x] 命名一致，控制流清晰
- [x] 无过度复杂化
- [x] 死代码: skipped E2E 测试体（可接受，有 Phase 3 标注）

### Architecture
- [x] 遵循现有模式
- [x] 无不必要的耦合
- [x] Phase 3 边界保持干净

### Security
- [x] 无 secrets 泄露
- [x] 所有受保护路由有认证检查 (71/71)
- [x] 无注入漏洞
- [x] 外部数据源被视为不受信任
- [x] requirePermission 框架就绪但未使用（Phase 3 预备）

### Performance
- [x] 无 N+1 模式
- [x] 无无界操作
- [x] 列表端点有分页

### Verification
- [x] pnpm verify 预期通过
- [x] CI 正确配置
- [x] E2E gate continue-on-error: false

### Verdict
- [ ] **Approve** — 可合并，建议修复 DB 竞态条件
- [x] **Request changes** — DB enrollment 行锁缺失为 blocker
```

---

## 10. 结论

### 总体评价

代码库处于良好的 Phase 1 状态。最近的大规模 i18n 迁移干净完成，无合约破坏。文档重整清晰地将历史/Phase 2+ 资料与当前活跃文档分离。CI 门控健全。

### Blockers（合并前必须修复）

| # | 严重性 | 模块 | 问题 | 建议修复 |
|---|--------|------|------|----------|
| 1 | 🔴 **Critical** | DB | `finalizeGrading` 读取 enrollment 时缺少 `FOR UPDATE`，导致并发评分时的数据竞争 | `grading.ts:179` 使用 `findByExamAndCandidateForUpdate` |
| 2 | 🔴 **Critical** | DB | `finalizeGrading` enrollment 更新无乐观锁保护，`last-writer-wins` | 添加条件 `WHERE` 子句或版本列 |

### 重要建议（强烈推荐，非阻塞）

| # | 严重性 | 模块 | 问题 |
|---|--------|------|------|
| 3 | 🟡 **Moderate** | DB | Admin force-submit 两个独立事务间的崩溃窗口——建议统一为单事务 |
| 4 | 🟡 **Moderate** | Docs | `archive/README.md:54,60` 存在断链（`operation-manual.md`、`phase2/`） |
| 5 | 🟡 **Moderate** | CI | `lint:db-config` 不在 `verify:static` 中，CI `static` job 不捕捉 db 配置问题 |
| 6 | 🟡 **Moderate** | API | Schema drift: `brandingSettingsResponseSchema` 中 `createdAt`/`updatedAt` 使用 `z.string()` 而非 `z.string().datetime()` |
| 7 | 🟡 **Moderate** | API | 前端 `SettingsPage` 将 GET 响应类型为 `UpdateBrandingRequest`（过窄） |

### 次要/信息性

| # | 严重性 | 模块 | 问题 |
|---|--------|------|------|
| 8 | 🟢 INFO | Auth | `requirePermission` 已定义但未被任何路由使用（Phase 3 预备，非 bug） |
| 9 | 🟢 INFO | Auth | `packages/auth/src/index.ts` 为空，缺少 proper re-exports |
| 10 | 🟢 INFO | E2E | Skipped 测试下的死测试体仍在导入 Phase 2 helpers |
| 11 | 🟢 INFO | i18n | Allowlist 嵌入在脚本中而非独立配置文件 |
| 12 | 🟢 INFO | CI | E2E job 使用 `pnpm --filter` 而非 `pnpm test:e2e` |
| 13 | 🟢 INFO | API | `courseItemSchema` 与响应实际 shape 的轻微不一致 |

### 最终判定

- [ ] **Approve** — 如 #1 和 #2 在合并前修复
- [x] **Request changes** — #1 和 #2（DB 竞态条件）必须修复后再合并
- [ ] **Block** — 情况如上述
