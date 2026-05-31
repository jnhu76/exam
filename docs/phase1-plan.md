# Phase 1 Implementation Plan

> 基于 `docs/SPEC.md` §6 Phase 1 清单 + `docs/phase1-ui-design.md` UI 设计。
> 每个 job 独立可验证，可由单个 agent session 完成。
> UI 任务引用 `phase1-ui-design.md` 的 wireframe 章节，实现时严格对照。

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
                                            ├── J8 Export ───────┤
                                            │                    │
                                            └── J9 Docker ───────┘
```

**并行**：J1 + J2 可以同时进行。
**串行**：J0 → J1 → J3 → J5 是硬依赖链。

---

## J0: Infrastructure Setup

> 搭建 monorepo 基础，让 `bun run dev` 能同时启动前后端。

- [ ] **J0.1** Server package.json + tsconfig.json + ElysiaJS entry
  - Acceptance: `bun run --filter server dev` 启动 ElysiaJS，`GET /api/health` 返回 `{ status: "ok" }`
  - Files: `server/package.json`, `server/tsconfig.json`, `server/src/index.ts`
  - Verify: `curl http://localhost:3000/api/health`

- [ ] **J0.2** Server CORS + security headers plugin
  - Acceptance: CORS 限制 localhost，安全响应头（X-Content-Type-Options, X-Frame-Options, X-XSS-Protection）出现在响应中
  - Files: `server/src/plugins/cors.ts`, `server/src/plugins/security.ts`
  - Verify: `curl -I http://localhost:3000/api/health` 检查 headers

- [ ] **J0.3** Client entry files + TailwindCSS v4
  - Acceptance: `bun run --filter client dev` 启动 Vite，浏览器看到空白页面，TailwindCSS 生效
  - Files: `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`, `client/src/index.css`
  - Verify: 浏览器访问 `http://localhost:5173`

- [ ] **J0.4** Root workspace wiring + `.env.example`
  - Acceptance: `bun run dev` 同时启动前后端；`/api/health` 代理到后端
  - Files: `package.json`（update）, `.env.example`, `server/.env`
  - Verify: `bun run dev`，浏览器访问 `http://localhost:5173/api/health`

- [ ] **J0.5** shadcn/ui initialization + install all Phase 1 components
  - Acceptance: 所有组件安装成功；页面渲染出一个 shadcn Button + Card + Table
  - Files: `client/components.json`, `client/src/lib/utils.ts`, `client/src/components/ui/*.tsx`
  - Components to install: `button, input, label, select, textarea, checkbox, radio-group, card, table, dialog, dropdown-menu, badge, tabs, separator, sonner, avatar, skeleton, alert, sheet, form, pagination, tooltip, alert-dialog, switch`
  - Verify: 在 App.tsx 里放几个组件，页面渲染正确

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
  - Verify: `bun run --filter server db:push` 建表成功

- [ ] **J1.3** Schema: courses + questions
  - Acceptance: `questions` 有 `organizationId` 外键；`options` 用 JSON 列存 options 数组；`attachments` 用 JSON 列
  - Files: `server/src/db/schema.ts`（append）
  - Verify: `db:push` 建表成功

- [ ] **J1.4** Schema: exams + exam_sections + exam_papers
  - Acceptance: `exam_papers` 有 `questionSnapshot` (JSON 列)、`answers` (JSON 列)、`lastActivityAt`、`attemptNumber` 默认 1
  - Files: `server/src/db/schema.ts`（append）
  - Verify: `db:push` 建表成功

- [ ] **J1.5** Schema: audit_logs + drizzle config
  - Acceptance: `audit_logs` 有 `organizationId`、`userId`、`action`、`resource`、`ip`、`timestamp`；`db:push` 和 `db:studio` 脚本可用
  - Files: `server/src/db/schema.ts`（append）, `server/drizzle.config.ts`
  - Verify: 完整 `db:push` 所有表成功 && `db:studio` 可打开

---

## J2: Client Scaffold (Layout + Routing + Shared Components)

> 搭建前端基础架构。对照 `phase1-ui-design.md` §2 Navigation Structure。

- [ ] **J2.1** React Router setup + two layout shells
  - UI Ref: §2.1 Layout Tree, §2.2 Sidebar Navigation
  - Acceptance:
    - `/login` 渲染全屏登录布局（无侧栏）
    - `/admin/*` 渲染 Sidebar + Header 布局（侧栏 `w-56`，可折叠 `w-14`）
    - `/exam/*` 渲染考生端 minimal 布局（只有顶部薄 header）
    - 未匹配路由 redirect 到 `/login`
  - Files: `client/src/App.tsx`, `client/src/pages/LoginPage.tsx`, `client/src/pages/admin/AdminLayout.tsx`, `client/src/pages/exam/ExamLayout.tsx`, `client/src/components/layout/AdminLayout.tsx`, `client/src/components/layout/ExamLayout.tsx`
  - Verify: 浏览器切换路由，三个布局各自渲染正确

- [ ] **J2.2** AppSidebar component + role-based navigation
  - UI Ref: §2.2 Sidebar Navigation
  - Acceptance:
    - 侧栏按分组显示导航（题库/考试/管理）
    - "管理"分组只对 Admin 可见
    - "机构管理"只对 SuperAdmin 可见
    - 底部显示当前用户名 + 退出按钮
    - 可折叠为 icon-only 模式
  - Files: `client/src/components/layout/AppSidebar.tsx`
  - Verify: 不同角色登录，侧栏显示不同的菜单项

- [ ] **J2.3** API client + error handling + toast
  - Acceptance: `api.get('/health')` 返回数据；401 自动跳转登录页；网络错误 toast 提示（sonner）；请求自动带 cookie
  - Files: `client/src/lib/api.ts`
  - Verify: 在组件里调用 `api.get('/api/health')` 打印结果

- [ ] **J2.4** Auth context + useAuth hook
  - Acceptance: `useAuth()` 返回 `{ user, login, logout, isLoading }`；未登录时 `user` 为 null；login 自动 redirect
  - Files: `client/src/hooks/useAuth.ts`, `client/src/contexts/AuthContext.tsx`
  - Verify: 在组件里调用 `useAuth()` 打印状态

- [ ] **J2.5** Shared UI components: PageHeader, EmptyState, ConfirmDialog, StatsCard, ConnectionIndicator
  - UI Ref: §4.2 Component Inventory, §6 Empty/Error/Loading States
  - Acceptance:
    - `PageHeader`: 标题 + 右侧操作按钮区
    - `EmptyState`: icon + title + description + action button
    - `ConfirmDialog`: 基于 AlertDialog，支持标题/描述/确认/取消
    - `StatsCard`: 数字 + label 的统计卡片
    - `ConnectionIndicator`: 三色圆点（绿/黄/红）+ 文字
  - Files: `client/src/components/shared/PageHeader.tsx`, `client/src/components/shared/EmptyState.tsx`, `client/src/components/shared/ConfirmDialog.tsx`, `client/src/components/shared/StatsCard.tsx`, `client/src/components/shared/ConnectionIndicator.tsx`
  - Verify: 在 App.tsx 里渲染每个组件，视觉正确

---

## J3: Auth System (Server + Login Page)

> JWT 认证 + 角色鉴权 + 登录页 UI。

- [ ] **J3.1** JWT plugin + password hashing
  - Acceptance: `Bun.password.hash/verify` 可用；JWT sign/verify 可用
  - Files: `server/src/plugins/jwt.ts`, `server/src/lib/password.ts`
  - Verify: 写一个测试路由 sign + verify 一个 token

- [ ] **J3.2** Auth routes: register + login + logout + me
  - Acceptance: `POST /api/auth/register` 创建用户；`POST /api/auth/login` 返回 HTTP-only cookie；`GET /api/auth/me` 返回当前用户；`POST /api/auth/logout` 清除 cookie
  - Files: `server/src/routes/auth.ts`
  - Verify: curl 完整登录流程

- [ ] **J3.3** Auth middleware: requireAuth + requireRole
  - Acceptance: 未登录返回 401；无权限返回 403；正确角色放行
  - Files: `server/src/middleware/auth.ts`
  - Verify: curl 测试三种情况

- [ ] **J3.4** Multi-tenant middleware: scopeToTenant
  - Acceptance: 所有请求自动注入 `organizationId`；查询自动加 `WHERE organizationId = ?`
  - Files: `server/src/middleware/tenant.ts`
  - Verify: 不同租户用户查询数据互相不可见

- [ ] **J3.5** Rate limiter middleware
  - Acceptance: 登录接口 10 次/分钟限制；超限返回 429
  - Files: `server/src/middleware/rateLimit.ts`
  - Verify: 连续请求超限后返回 429

- [ ] **J3.6** Client: Login page
  - UI Ref: §3.1 登录页
  - Acceptance:
    - 全屏居中登录卡片（`max-w-sm`）
    - 用户名 + 密码输入 + 登录按钮
    - 登录失败表单下方红色提示文字（非 alert）
    - 登录成功按角色 redirect（Admin→/admin/dashboard, Candidate→/exam/list）
    - 底部显示"校园内网考试平台 v1.0"
  - Files: `client/src/pages/LoginPage.tsx`（update from placeholder）
  - Verify: 完整登录流程，错误密码显示提示，正确登录跳转

---

## J4: Organization + User Management (Admin Pages)

> 初始化数据 + 机构/用户/考生管理页面。对照 `phase1-ui-design.md` §3.13, §3.17, §3.18, §3.16。

- [ ] **J4.1** Seed script: default organization + super admin
  - Acceptance: `bun run --filter server db:seed` 创建默认 Organization 和 SuperAdmin
  - Files: `server/src/db/seed.ts`, `server/package.json`（add script）
  - Verify: seed 后数据库有 1 org + 1 super_admin

- [ ] **J4.2** Organization CRUD routes + Admin page
  - UI Ref: （简单 CRUD，无独立 wireframe，在管理分组下）
  - Acceptance: SuperAdmin 可以 CRUD Organization；Admin 只能看自己的；Admin 页面列表+新建/编辑弹窗
  - Files: `server/src/routes/organization.ts`, `client/src/pages/admin/OrganizationPage.tsx`
  - Verify: curl + 浏览器完整 CRUD

- [ ] **J4.3** CandidateField API + config page
  - UI Ref: §3.13 考生字段配置页
  - Acceptance:
    - API: Admin 可定义/修改/删除考生字段；唯一标识字段只能有一个
    - UI: 表格展示所有字段（名称、显示名、类型、必填、唯一标识、排序）；拖拽排序；预览导入模板按钮
  - Files: `server/src/routes/candidateField.ts`, `client/src/pages/admin/CandidateFieldPage.tsx`
  - Verify: curl + 浏览器配置字段，下载模板验证列头

- [ ] **J4.4** User management API + page (Admin/Teacher/Proctor)
  - UI Ref: §3.17 用户管理页
  - Acceptance:
    - API: 创建/列表/修改/禁用非考生用户
    - UI: 表格（用户名、姓名、角色badge、状态、操作按钮）；添加用户弹窗
  - Files: `server/src/routes/user.ts`, `client/src/pages/admin/UserPage.tsx`
  - Verify: 浏览器添加 Admin/Teacher/Proctor

- [ ] **J4.5** Candidate management API + page + import
  - UI Ref: §3.18 考生管理页 + §3.16 考生导入弹窗
  - Acceptance:
    - API: 手动创建考生、批量导入（Excel/CSV）、列表查询、修改、禁用
    - UI: 表格列头按 CandidateField 动态生成；导入按钮弹出 ImportWizard
    - ImportWizard: 上传→预览（工号重复标记为"更新"、必填缺失标记为"错误"）→确认导入
  - Files: `server/src/routes/candidate.ts`（or extend user.ts）, `client/src/pages/admin/CandidatePage.tsx`, `client/src/components/shared/ImportWizard.tsx`, `client/src/components/shared/FileUpload.tsx`, `server/src/lib/import.ts`
  - Verify: 用 Excel 导入一批考生，表格列头动态显示，重复工号更新而非报错

---

## J5: Question Bank + Exam Management (Admin Pages)

> 题库 + 组卷 + 考试管理。对照 `phase1-ui-design.md` §3.3-§3.6, §3.11, §3.14。

- [ ] **J5.1** Course API + management page
  - UI Ref: §3.14 课程管理页
  - Acceptance:
    - API: Teacher/Admin CRUD Course，按 organizationId 隔离
    - UI: 简单表格（课程名称、代码、题目数统计、操作按钮）
  - Files: `server/src/routes/course.ts`, `client/src/pages/admin/CoursePage.tsx`
  - Verify: curl + 浏览器完整 CRUD

- [ ] **J5.2** Question API + management page
  - UI Ref: §3.3 题目管理页
  - Acceptance:
    - API: 创建/编辑/删除/列表题目；按 courseId、tags、type、difficulty 筛选；题型校验
    - UI: 筛选栏（课程/题型/难度/标签 Select + 搜索 Input）；表格（选择框、题型 badge、题干截断、标签 chip、分值）；新建/导入按钮；分页
  - Files: `server/src/routes/question.ts`, `client/src/pages/admin/QuestionPage.tsx`
  - Verify: curl 创建各种题型 + 浏览器筛选和翻页

- [ ] **J5.3** Question create/edit page (all 4 question types)
  - UI Ref: §3.4 新建/编辑题目页（三个 wireframe: 单选/多选、填空、判断）
  - Acceptance:
    - 单选/多选: 选项行内标记正确答案（点击 ○/●），无底部重复字段
    - 填空: 题干用 `____` 标记空位；标准答案按空输入，支持 `|` 分隔多个可接受答案；匹配模式选择
    - 判断: 二选一标记正确/错误
    - 底部实时预览区（考生视角）
    - 题型切换时整个选项/答案区动态替换
  - Files: `client/src/pages/admin/QuestionEditPage.tsx`, `client/src/components/question/QuestionForm.tsx`, `client/src/components/question/QuestionPreview.tsx`
  - Verify: 创建所有 4 种题型的题目，预览区实时更新

- [ ] **J5.4** Question import page
  - UI Ref: §3.5 题目导入页
  - Acceptance:
    - Step 1: 拖拽上传区 + 下载模板按钮
    - Step 2: 预览表格（状态 ✅/⚠️/❌、题型、题干摘要、异常原因）
    - 底部汇总（有效/警告/错误计数）
    - 复用 ImportWizard 组件
  - Files: `client/src/pages/admin/QuestionImportPage.tsx`（或复用 ImportWizard + 专用配置）
  - Verify: 用测试 Excel 走一遍导入流程

- [ ] **J5.5** Exam API + create page (组卷)
  - UI Ref: §3.6 新建考试页（两个 wireframe: 手动选题 + 随机抽题）
  - Acceptance:
    - API: 创建/编辑/发布/删除考试；组卷选题
    - UI: 分区表单（基本信息→考试设置→管控设置→选择题目→预览发布）
    - 管控设置: 模式预设按钮切换后自动填充复选框，可单独改
    - 手动选题: 已选题目表格 + 从题库添加弹窗
    - 随机抽题: 抽题规则表格（题型/数量/难度/标签）+ 题库匹配提示
    - 底部固定操作栏：预览考试、保存草稿、发布考试
  - Files: `server/src/routes/exam.ts`, `server/src/lib/examPaper.ts`, `client/src/pages/admin/ExamCreatePage.tsx`, `client/src/components/exam/ExamConfigForm.tsx`
  - Verify: 用两种方式各创建一个考试

- [ ] **J5.6** Exam detail page (teacher view) + exam list page
  - UI Ref: §3.11 考试详情页
  - Acceptance:
    - 列表页: 考试表格（名称、状态 badge、时间、参与人数、操作）
    - 详情页: 考试配置摘要 + 实时统计 + 考生列表（工号、姓名、状态、得分、操作）
  - Files: `client/src/pages/admin/ExamPage.tsx`, `client/src/pages/admin/ExamDetailPage.tsx`
  - Verify: 发布一个考试，查看详情页的考生列表

---

## J6: Exam Engine (Candidate Pages)

> 考生答题全流程。对照 `phase1-ui-design.md` §3.7, §3.8, §3.10。

- [ ] **J6.1** ExamPaper routes: start exam + get paper
  - Acceptance: `POST /api/papers/:examId/start` 创建/恢复 ExamPaper（检查时间窗口、考试次数、状态）；`GET /api/papers/:id` 返回题目（不含 standardAnswer）
  - Files: `server/src/routes/paper.ts`
  - Verify: curl 模拟考生开始考试

- [ ] **J6.2** Answer save + submit routes
  - Acceptance:
    - `PUT /api/papers/:id/answers` 保存单题答案；校验状态必须 in_progress；更新 `lastActivityAt`
    - `POST /api/papers/:id/submit` 标记 submitted；触发自动批改
  - Files: `server/src/routes/paper.ts`（extend）
  - Verify: curl 保存答案 + 交卷

- [ ] **J6.3** Heartbeat + disrupted detection
  - Acceptance: `POST /api/papers/:id/heartbeat` 更新 `lastActivityAt`；定时任务扫描 60s 无心跳标记 disrupted
  - Files: `server/src/routes/paper.ts`（extend）, `server/src/middleware/heartbeat.ts`
  - Verify: 不心跳 60s 后检查状态为 disrupted

- [ ] **J6.4** Client: exam list page (candidate)
  - UI Ref: §3.7 考生端考试列表
  - Acceptance:
    - 考试卡片列表（考试名称、计时方式/时长/及格线、开放时间、考试次数/最高分）
    - 分区："可参加的考试" + "已结束"
    - 已通过显示 ✅ 和分数
    - 按钮：开始考试 / 查看结果
  - Files: `client/src/pages/exam/ExamListPage.tsx`
  - Verify: 浏览器查看考试列表

- [ ] **J6.5** Client: start exam confirmation page + queue
  - UI Ref: §3.10 开始考试确认页（含排队状态）
  - Acceptance:
    - 确认页: 考试配置摘要（计时方式/时长/及格分/题目数/管控措施/已考次数）
    - 警告文字："开始后倒计时立即启动，中途不可暂停"
    - 排队状态（requireQueue 时）: 等待人数、预计时间、进度条、"请勿关闭此页面"
    - 轮到时自动跳转答题页面
  - Files: `client/src/pages/exam/StartExamPage.tsx`
  - Verify: 走一遍确认→开始流程

- [ ] **J6.6** Client: exam taking page (核心答题界面)
  - UI Ref: §3.8 答题界面
  - Acceptance:
    - 全屏模式，无侧栏无导航
    - 顶部工具栏: 考试名称、倒计时（ExamTimer，<5min 变红，=0 自动交卷）、已答进度、交卷按钮
    - 左侧题号栏 (`w-20`): 颜色标记（●已答/○未答/◉标记），当前题高亮，50+ 题两列排列+滚动
    - 右侧答题区: QuestionRenderer 根据题型渲染组件
    - 底部导航: ◀上一题 / ⚑标记 / 下一题▶
    - 底部状态栏: 已答/未答/标记/总数统计
    - 自动保存: 答题变更后去抖 1-2s 保存，旁显示"保存中...→✓已保存 / ⚠保存失败"
    - 交卷确认弹窗: 显示未答题数+已标记数+"交卷后不可修改"
  - Files: `client/src/pages/exam/TakeExamPage.tsx`, `client/src/components/exam/QuestionNav.tsx`, `client/src/components/exam/QuestionRenderer.tsx`, `client/src/components/exam/SingleChoiceInput.tsx`, `client/src/components/exam/MultipleChoiceInput.tsx`, `client/src/components/exam/FillBlankInput.tsx`, `client/src/components/exam/TrueFalseInput.tsx`, `client/src/components/exam/ExamTimer.tsx`
  - Verify: 完整答题→交卷全流程

---

## J7: Auto-Grading + Result Page

> 客观题自动批改 + 结果页。对照 `phase1-ui-design.md` §3.9。

- [ ] **J7.1** Grading engine: single choice + true/false
  - Acceptance: 答案与 standardAnswer 精确匹配 → 得分；不匹配 → 0 分
  - Files: `server/src/lib/grading.ts`
  - Verify: 单元测试覆盖正确/错误/空答案

- [ ] **J7.2** Grading engine: multiple choice
  - Acceptance: 全对满分、少选半分、错选零分（可配置）
  - Files: `server/src/lib/grading.ts`（extend）
  - Verify: 单元测试覆盖全对/少选/多选/错选

- [ ] **J7.3** Grading engine: fill-in-blank
  - Acceptance: 精确匹配（忽略首尾空格）+ 关键词匹配模式
  - Files: `server/src/lib/grading.ts`（extend）
  - Verify: 单元测试覆盖精确/大小写/空格/关键词

- [ ] **J7.4** Grading trigger + score calculation
  - Acceptance: 交卷触发批改；汇总 → score + passed；状态 → graded
  - Files: `server/src/lib/grading.ts`（extend）, `server/src/routes/paper.ts`（integrate）
  - Verify: 完整答题→交卷→查看成绩

- [ ] **J7.5** Client: result page (双态)
  - UI Ref: §3.9 考试结果页（变体A: 即时出分 + 变体B: 等待公布）
  - Acceptance:
    - `showResultImmediately=true`: 大卡片显示总分+通过状态+及格线；答题详情表格（题号/题型/你的答案/正确答案/得分，✅绿色/❌红色）；填空答案过长截断 hover 显示全文
    - `showResultImmediately=false`: 只显示"已交卷 ✅ 等待成绩公布"
    - 底部"返回考试列表"按钮
  - Files: `client/src/pages/exam/ResultPage.tsx`
  - Verify: 两种模式分别测试

---

## J8: Score Management + Export (Admin Pages)

> 成绩管理 + 导出。对照 `phase1-ui-design.md` §3.10, §3.12。

- [ ] **J8.1** Score query API
  - Acceptance: `GET /api/exams/:id/scores` 返回成绩列表（分页/排序/筛选通过/未通过）；`GET /api/papers/:id` 返回答卷详情
  - Files: `server/src/routes/score.ts`
  - Verify: curl 查询成绩列表

- [ ] **J8.2** Client: score management page
  - UI Ref: §3.10 成绩管理页
  - Acceptance:
    - 导出按钮组（Excel/CSV/PDF）
    - 筛选栏（全部/通过/未通过 + 搜索）
    - 成绩表格（列头按 CandidateField 动态生成 + 得分 + 通过状态 + 提交时间 + 操作）
    - 底部统计行（平均/最高/最低/通过率）
    - 点击"详情"跳转答卷详情页
  - Files: `client/src/pages/admin/ScoreListPage.tsx`
  - Verify: 浏览器查看成绩 + 筛选 + 翻页

- [ ] **J8.3** Client: paper detail page (teacher view)
  - UI Ref: §3.12 答卷详情页
  - Acceptance:
    - 顶部得分摘要（考生姓名+考试名+得分+通过状态+提交时间）
    - 答题详情表格（题号/题型/考生答案/正确答案/得分）
    - 多选题部分正确显示扣分
    - 导出 PDF + 返回按钮
  - Files: `client/src/pages/admin/PaperDetailPage.tsx`
  - Verify: 点击成绩列表的"详情"，查看完整答卷

- [ ] **J8.4** Server: Excel/CSV export (score sheet + question bank + candidate list)
  - Acceptance:
    - 成绩单: `GET /api/exams/:id/export/scores?format=xlsx`，列头按 CandidateField 动态生成
    - 题库: `GET /api/courses/:id/questions/export?format=xlsx`
    - 考生名单: `GET /api/candidates/export?format=xlsx`
  - Files: `server/src/routes/export.ts`, `server/src/lib/exportExcel.ts`
  - Verify: curl 下载各类型 Excel

- [ ] **J8.5** Server: PDF export (score report)
  - Acceptance: `GET /api/papers/:id/export/pdf` 下载单份成绩 PDF（考试名称、考生信息、每题得分、总分、通过状态）
  - Files: `server/src/lib/exportPdf.ts`, `server/src/routes/export.ts`（extend）
  - Verify: curl 下载 PDF，浏览器打开验证

---

## J9: Degradation + Dashboard + Docker

> 降级 + 仪表盘 + 部署。对照 `phase1-ui-design.md` §3.2, §3.15。

- [ ] **J9.1** Server health monitor + degradation middleware
  - Acceptance: `GET /api/system/health` 返回 CPU%/内存%/DB 响应时间/降级档位；自动三档切换；答案保存策略自适应
  - Files: `server/src/plugins/health.ts`, `server/src/lib/systemMonitor.ts`, `server/src/middleware/degradation.ts`, `server/src/lib/degradationStore.ts`
  - Verify: curl 查看健康状态；手动设低阈值触发切换

- [ ] **J9.2** Client: admin dashboard page
  - UI Ref: §3.2 Admin Dashboard
  - Acceptance:
    - 4 个 StatsCard（题目总数/考试进行中/考生总数/今日考试）
    - 最近考试表格（名称、状态 badge、参与情况）
  - Files: `client/src/pages/admin/DashboardPage.tsx`
  - Verify: 有数据时仪表盘正确显示

- [ ] **J9.3** Client: system health page
  - UI Ref: §3.15 系统健康页
  - Acceptance:
    - 当前档位指示（🟢正常/🟡省电/🔴极限）+ 手动切换下拉
    - 4 个指标卡片（CPU/内存/DB响应/活跃连接），10s 刷新
    - 降级阈值配置（可编辑）
    - 最近事件流（档位变化、考试开始等）
  - Files: `client/src/pages/admin/SystemHealthPage.tsx`, `client/src/components/shared/DegradationIndicator.tsx`
  - Verify: 打开页面观察实时数据

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
Week 1:  J0 → J1 → J2 (J1+J2 parallel after J0)
Week 2:  J3 → J4
Week 3:  J5
Week 4:  J6 → J7
Week 5:  J8 → J9
```

**Checkpoint after each Job**: 所有 verify 步骤通过才能进入下一个 Job。

---

## UI Task Summary

每个有 UI 的任务都标注了 `UI Ref` 指向 `phase1-ui-design.md` 的具体章节。

| Job | UI 页面 | UI Ref |
|-----|---------|--------|
| J2  | Layout shells, Sidebar, Shared components | §2.1, §2.2, §4.2, §6 |
| J3  | Login page | §3.1 |
| J4  | CandidateField config, User mgmt, Candidate mgmt, Import | §3.13, §3.17, §3.18, §3.16 |
| J5  | Course mgmt, Question list, Question edit (4 types), Question import, Exam create, Exam detail | §3.14, §3.3, §3.4, §3.5, §3.6, §3.11 |
| J6  | Exam list, Start exam, Take exam (core) | §3.7, §3.10, §3.8 |
| J7  | Result page (2 variants) | §3.9 |
| J8  | Score list, Paper detail | §3.10, §3.12 |
| J9  | Dashboard, System health | §3.2, §3.15 |
