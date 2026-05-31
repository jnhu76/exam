# Phase 1 Implementation Plan

> 基于 `docs/SPEC.md` §6 Phase 1 清单，拆分为可执行的 jobs。
> 每个 job 独立可验证，可由单个 agent session 完成。

---

## Dependency Graph

```
J0 Infrastructure ─────────────────────────────────────────────┐
   │                                                            │
   ├── J1 DB Schema ──┐                                         │
   │                  ├── J3 Auth System ──┐                    │
   │                  │                    ├── J5 Core Routes ──┤
   │                  │                    │                    │
   │                  └── J4 Seed Data     │                    │
   │                                       │                    │
   └── J2 Client Scaffold ────────────────┘                    │
                                           │                    │
                                           ├── J6 Exam Engine ──┤
                                           │                    │
                                           ├── J7 Grading ──────┤
                                           │                    │
                                           └── J8 Export ───────┤
                                                                │
                                                                ▼
                                                           J9 Docker
```

**并行**：J1 + J2 可以同时进行。J6/J7/J8 可以同时进行。
**串行**：J0 → J1 → J3 → J5 是硬依赖链。

---

## J0: Infrastructure Setup

> 搭建 monorepo 基础，让 `bun run dev` 能同时启动前后端。

- [ ] **J0.1** Server package.json + tsconfig.json
  - Acceptance: `bun run --filter server dev` 启动 ElysiaJS，`GET /api/health` 返回 `{ status: "ok" }`
  - Files: `server/package.json`, `server/tsconfig.json`
  - Verify: `curl http://localhost:3000/api/health`

- [ ] **J0.2** Server entry point + CORS + security headers plugin
  - Acceptance: CORS 限制 localhost，安全响应头（X-Content-Type-Options, X-Frame-Options, X-XSS-Protection）出现在响应中
  - Files: `server/src/index.ts`, `server/src/plugins/cors.ts`, `server/src/plugins/security.ts`
  - Verify: `curl -I http://localhost:3000/api/health` 检查 headers

- [ ] **J0.3** Client entry files (index.html, main.tsx, App.tsx, index.css)
  - Acceptance: `bun run --filter client dev` 启动 Vite，浏览器看到空白页面，TailwindCSS 生效
  - Files: `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`, `client/src/index.css`
  - Verify: 浏览器访问 `http://localhost:5173`

- [ ] **J0.4** Root workspace wiring + `.env.example`
  - Acceptance: `bun run dev` 同时启动前后端；`/api/health` 代理到后端
  - Files: `package.json`（update）, `.env.example`, `server/.env`
  - Verify: `bun run dev`，浏览器访问 `http://localhost:5173/api/health`

- [ ] **J0.5** shadcn/ui initialization + first component (Button)
  - Acceptance: `npx shadcn@latest add button` 成功，页面渲染出一个 shadcn Button
  - Files: `client/components.json`, `client/src/lib/utils.ts`, `client/src/components/ui/button.tsx`
  - Verify: 在 App.tsx 里放一个 Button，页面上渲染正确

---

## J1: Database Schema (Drizzle ORM)

> 把 `shared/src/types.ts` 的领域模型落地为 Drizzle schema。

- [ ] **J1.1** Drizzle ORM setup + SQLite connection
  - Acceptance: `import { db } from "./db"` 能连接 SQLite 文件，`db.select().from(organizations)` 不报错
  - Files: `server/src/db/index.ts`, `server/package.json`（add drizzle-orm, better-sqlite3）
  - Verify: `bun run --filter server dev` 启动无报错

- [ ] **J1.2** Schema: organizations + candidate_fields + users + candidate_profiles
  - Acceptance: 所有表有 `id` (UUID primary key) + `createdAt`；`candidate_profiles.fields` 用 JSON 列
  - Files: `server/src/db/schema.ts`
  - Verify: `bun run --filter server drizzle-kit push` 建表成功

- [ ] **J1.3** Schema: courses + questions + question_options
  - Acceptance: `questions` 有 `organizationId` 外键；`question_options` 用 JSON 列存 options 数组
  - Files: `server/src/db/schema.ts`（append）
  - Verify: `drizzle-kit push` 建表成功

- [ ] **J1.4** Schema: exams + exam_sections + exam_papers + answers
  - Acceptance: `exam_papers` 有 `questionSnapshot` (JSON 列)、`answers` (JSON 列)、`lastActivityAt`；`attemptNumber` 默认 1
  - Files: `server/src/db/schema.ts`（append）
  - Verify: `drizzle-kit push` 建表成功

- [ ] **J1.5** Schema: audit_logs
  - Acceptance: `audit_logs` 有 `organizationId`、`userId`、`action`、`resource`、`ip`、`timestamp`
  - Files: `server/src/db/schema.ts`（append）
  - Verify: 完整 `drizzle-kit push` 所有表成功

- [ ] **J1.6** Drizzle config + migration script
  - Acceptance: `bun run --filter server db:push` 执行 schema push；`bun run --filter server db:studio` 可打开 Drizzle Studio
  - Files: `server/drizzle.config.ts`, `server/package.json`（add scripts）
  - Verify: `bun run --filter server db:push` && `bun run --filter server db:studio`

---

## J2: Client Scaffold

> 搭建前端基础：路由、布局、API client、auth hooks。

- [ ] **J2.1** React Router setup + layout shell
  - Acceptance: 访问 `/login` / `/admin` / `/exam` 显示不同占位页面；顶层 Layout 有 header + main 区域
  - Files: `client/src/App.tsx`（update）, `client/src/pages/LoginPage.tsx`, `client/src/pages/admin/AdminLayout.tsx`, `client/src/pages/exam/ExamLayout.tsx`
  - Verify: 浏览器切换路由，页面切换正确

- [ ] **J2.2** API client (fetch wrapper + error handling)
  - Acceptance: `api.get('/health')` 返回数据；401 自动跳转登录页；网络错误 toast 提示
  - Files: `client/src/lib/api.ts`
  - Verify: 在组件里调用 `api.get('/api/health')` 打印结果

- [ ] **J2.3** Auth hooks (useAuth, useCurrentUser)
  - Acceptance: `useAuth()` 返回 `{ user, login, logout, isLoading }`；未登录时 `user` 为 null
  - Files: `client/src/hooks/useAuth.ts`, `client/src/contexts/AuthContext.tsx`
  - Verify: 在组件里调用 `useAuth()` 打印状态

---

## J3: Auth System (Server)

> JWT 认证 + 角色鉴权中间件。

- [ ] **J3.1** JWT plugin setup + password hashing utility
  - Acceptance: `Bun.password.hash/verify` 可用；JWT sign/verify 可用
  - Files: `server/src/plugins/jwt.ts`, `server/src/lib/password.ts`
  - Verify: 写一个测试路由 sign + verify 一个 token

- [ ] **J3.2** Auth routes: register + login + logout + me
  - Acceptance: `POST /api/auth/register` 创建用户；`POST /api/auth/login` 返回 HTTP-only cookie；`GET /api/auth/me` 返回当前用户；`POST /api/auth/logout` 清除 cookie
  - Files: `server/src/routes/auth.ts`
  - Verify: curl 完整登录流程

- [ ] **J3.3** Auth middleware: requireAuth + requireRole
  - Acceptance: 未登录访问受保护路由返回 401；无权限返回 403；正确角色放行
  - Files: `server/src/middleware/auth.ts`
  - Verify: curl 测试三种情况

- [ ] **J3.4** Multi-tenant middleware: scopeToTenant
  - Acceptance: 所有请求自动注入当前用户的 `organizationId`；查询自动加 `WHERE organizationId = ?`
  - Files: `server/src/middleware/tenant.ts`
  - Verify: 不同租户用户查询数据互相不可见

- [ ] **J3.5** Rate limiter middleware
  - Acceptance: 登录接口 10 次/分钟限制；超限返回 429；其他接口 100 次/分钟
  - Files: `server/src/middleware/rateLimit.ts`
  - Verify: 连续请求超限后返回 429

---

## J4: Seed Data + Organization Setup

> 初始化数据：默认机构 + 管理员 + 演示题库。

- [ ] **J4.1** Seed script: create default organization + super admin
  - Acceptance: `bun run --filter server db:seed` 创建一个默认 Organization 和 SuperAdmin 账号
  - Files: `server/src/db/seed.ts`, `server/package.json`（add script）
  - Verify: 执行 seed 后，数据库有 1 个 org + 1 个 super_admin 用户

- [ ] **J4.2** Organization CRUD routes
  - Acceptance: SuperAdmin 可以 CRUD Organization；普通 Admin 只能看自己的
  - Files: `server/src/routes/organization.ts`
  - Verify: curl 完整 CRUD

- [ ] **J4.3** Admin API: CandidateField CRUD
  - Acceptance: Admin 可以为本机构定义/修改/删除考生字段；唯一标识字段只能有一个
  - Files: `server/src/routes/candidateField.ts`
  - Verify: curl 完整 CRUD

- [ ] **J4.4** User/Candidate management routes
  - Acceptance: Admin 可以手动创建用户、批量导入（Excel/CSV）、列表查询、修改、禁用
  - Files: `server/src/routes/user.ts`
  - Verify: curl 创建用户 + Excel 导入测试

---

## J5: Core Domain Routes

> 题库 + 组卷 + 考试管理 API。

- [ ] **J5.1** Course CRUD routes
  - Acceptance: Teacher/Admin 可以 CRUD Course；按 organizationId 隔离
  - Files: `server/src/routes/course.ts`
  - Verify: curl 完整 CRUD

- [ ] **J5.2** Question CRUD routes
  - Acceptance: 创建/编辑/删除/列表题目；按 courseId 和 tags 筛选；题型校验（选择题必须有 options 和 standardAnswer）
  - Files: `server/src/routes/question.ts`
  - Verify: curl 创建各种题型

- [ ] **J5.3** Question import routes (Excel/CSV/JSON)
  - Acceptance: 上传 xlsx/csv 文件 → 解析 → 预览（返回识别出的题目 + 异常标记）→ 确认导入
  - Files: `server/src/routes/question.ts`（extend）, `server/src/lib/import.ts`
  - Verify: 用测试 Excel 文件完整走一遍导入流程

- [ ] **J5.4** Exam CRUD routes
  - Acceptance: 创建/编辑/发布/删除考试；组卷时选择手动选题或随机抽题；发布时生成 ExamPaper 快照
  - Files: `server/src/routes/exam.ts`
  - Verify: curl 完整创建→组卷→发布流程

- [ ] **J5.5** ExamPaper generation logic (question snapshot + shuffle)
  - Acceptance: 发布考试时为每个考生生成 ExamPaper；题目快照深拷贝；按配置决定是否乱序题目和选项
  - Files: `server/src/lib/examPaper.ts`
  - Verify: 创建考试后检查数据库中的 ExamPaper 快照数据

---

## J6: Exam Engine (Taking Exam)

> 考生答题全流程：进入考试 → 答题 → 保存 → 交卷。

- [ ] **J6.1** ExamPaper routes: start exam + get paper
  - Acceptance: `POST /api/papers/:examId/start` 创建/恢复 ExamPaper（检查时间窗口、考试次数、状态）；`GET /api/papers/:id` 返回题目（不含标准答案）
  - Files: `server/src/routes/paper.ts`
  - Verify: curl 模拟考生开始考试

- [ ] **J6.2** Answer save route (per-question auto-save)
  - Acceptance: `PUT /api/papers/:id/answers` 保存单题答案；校验 ExamPaper 状态必须是 in_progress；更新 `lastActivityAt`
  - Files: `server/src/routes/paper.ts`（extend）
  - Verify: curl 保存答案，检查数据库

- [ ] **J6.3** Submit exam route
  - Acceptance: `POST /api/papers/:id/submit` 标记 ExamPaper 为 submitted；校验所有必答题已答（或确认跳过）；触发自动批改
  - Files: `server/src/routes/paper.ts`（extend）
  - Verify: curl 交卷，状态变为 submitted

- [ ] **J6.4** Heartbeat + disrupted detection
  - Acceptance: `POST /api/papers/:id/heartbeat` 更新 `lastActivityAt`；服务端定时任务扫描超过 60s 无心跳的 ExamPaper 标记为 disrupted
  - Files: `server/src/routes/paper.ts`（extend）, `server/src/middleware/heartbeat.ts`
  - Verify: 启动后不心跳，等 60s，检查状态变为 disrupted

- [ ] **J6.5** Client: exam taking page (question navigator + answer components)
  - Acceptance: 左侧题号导航（颜色标记已答/未答/已标记）；右侧题目 + 答题组件（Radio/Checkbox/TextInput）；自动保存；交卷确认弹窗
  - Files: `client/src/pages/exam/TakeExamPage.tsx`, `client/src/components/exam/QuestionNav.tsx`, `client/src/components/exam/QuestionRenderer.tsx`, `client/src/components/exam/AnswerComponents.tsx`
  - Verify: 手动创建一个考试，走完答题→交卷全流程

- [ ] **J6.6** Client: exam list + start exam flow
  - Acceptance: 考生看到可参加的考试列表；点击"开始考试"→ 确认弹窗 → 进入答题页面；显示剩余时间
  - Files: `client/src/pages/exam/ExamListPage.tsx`, `client/src/pages/exam/StartExamPage.tsx`
  - Verify: 完整走一遍流程

---

## J7: Auto-Grading

> 客观题自动批改 + 即时出分。

- [ ] **J7.1** Grading engine: single choice + true/false
  - Acceptance: 答案与 standardAnswer 精确匹配 → 计算得分；不匹配 → 0 分
  - Files: `server/src/lib/grading.ts`
  - Verify: 单元测试覆盖正确/错误/空答案

- [ ] **J7.2** Grading engine: multiple choice
  - Acceptance: 全对满分、少选半分、错选零分（可配置为其他策略）
  - Files: `server/src/lib/grading.ts`（extend）
  - Verify: 单元测试覆盖全对/少选/多选/错选/混合

- [ ] **J7.3** Grading engine: fill-in-blank
  - Acceptance: 精确匹配模式（忽略首尾空格）+ 关键词匹配模式（可配置）
  - Files: `server/src/lib/grading.ts`（extend）
  - Verify: 单元测试覆盖精确匹配、大小写、空格、关键词

- [ ] **J7.4** Grading trigger + score calculation
  - Acceptance: 交卷时自动触发批改；汇总每题得分 → 计算 ExamPaper.score 和 passed；更新状态为 graded
  - Files: `server/src/lib/grading.ts`（extend）, `server/src/routes/paper.ts`（integrate）
  - Verify: 完整答题→交卷→查看成绩流程

- [ ] **J7.5** Client: result page + score display
  - Acceptance: 交卷后显示得分、是否通过、每题作答情况（如果 `showResultImmediately` 开启）；否则显示"等待公布"
  - Files: `client/src/pages/exam/ResultPage.tsx`
  - Verify: 交卷后查看结果页

---

## J8: Export & Score Management

> 成绩导出 + 题库导出 + 考生导出。

- [ ] **J8.1** Score query routes (teacher/admin view)
  - Acceptance: `GET /api/exams/:id/scores` 返回所有考生成绩列表（支持分页、排序、筛选通过/未通过）；`GET /api/papers/:id` 返回单份答卷详情
  - Files: `server/src/routes/score.ts`
  - Verify: curl 查询成绩列表

- [ ] **J8.2** Excel/CSV export: score sheet
  - Acceptance: `GET /api/exams/:id/export/scores?format=xlsx` 下载成绩单 Excel；列头按机构 CandidateField 动态生成
  - Files: `server/src/routes/export.ts`, `server/src/lib/exportExcel.ts`
  - Verify: curl 下载并用 Excel 打开验证

- [ ] **J8.3** PDF export: score report (using pdfkit/jsPDF)
  - Acceptance: `GET /api/papers/:id/export/pdf` 下载单份成绩 PDF（含考试名称、考生信息、每题得分、总分、通过状态）
  - Files: `server/src/lib/exportPdf.ts`, `server/src/routes/export.ts`（extend）
  - Verify: curl 下载 PDF，浏览器打开验证

- [ ] **J8.4** Excel export: question bank backup
  - Acceptance: `GET /api/courses/:id/questions/export?format=xlsx` 下载题库 Excel（可再导入）
  - Files: `server/src/routes/export.ts`（extend）
  - Verify: 导出 → 修改 → 重新导入，验证数据完整

- [ ] **J8.5** Client: score management page (teacher view)
  - Acceptance: Teacher 可以查看考试成绩列表、筛选、导出；点击某个考生查看答卷详情
  - Files: `client/src/pages/admin/ScoreListPage.tsx`, `client/src/pages/admin/PaperDetailPage.tsx`
  - Verify: 完整查看+导出流程

---

## J9: Degradation + Docker

> 自适应降级 + Docker 部署。

- [ ] **J9.1** Server health monitor (CPU / memory / DB response time)
  - Acceptance: `GET /api/system/health` 返回当前 CPU%、内存%、DB 响应时间、当前降级档位
  - Files: `server/src/plugins/health.ts`, `server/src/lib/systemMonitor.ts`
  - Verify: curl 查看健康状态

- [ ] **J9.2** Degradation middleware: auto-switch based on thresholds
  - Acceptance: 模拟高负载（或手动设低阈值）→ 档位自动切换为省电/极限；答案保存策略自动调整（攒批写入）；恢复后自动回弹
  - Files: `server/src/middleware/degradation.ts`, `server/src/lib/degradationStore.ts`
  - Verify: 手动设阈值触发各档位切换

- [ ] **J9.3** Client: system health indicator (admin)
  - Acceptance: Admin 页面顶栏显示系统档位（正常/省电/极限）；健康仪表盘展示 CPU/内存/连接数
  - Files: `client/src/pages/admin/SystemHealthPage.tsx`
  - Verify: 打开页面观察数据

- [ ] **J9.4** Dockerfile (single container: Bun + SQLite)
  - Acceptance: `docker build -t exam . && docker run -p 3000:3000 exam` 启动完整服务
  - Files: `Dockerfile`, `.dockerignore`
  - Verify: Docker 内访问 `http://localhost:3000/api/health`

- [ ] **J9.5** Docker Compose (app + PostgreSQL)
  - Acceptance: `docker compose up` 一键启动 app + PostgreSQL；`.env` 切换数据库
  - Files: `docker-compose.yml`, `docker-compose.prod.yml`
  - Verify: `docker compose up`，完整走一遍登录→考试→出分

---

## Execution Order

```
Week 1:  J0 → J1 → J2 (parallel J1+J2)
Week 2:  J3 → J4
Week 3:  J5
Week 4:  J6 → J7
Week 5:  J8 → J9
```

**Checkpoint after each Job**: 所有 verify 步骤通过才能进入下一个 Job。
