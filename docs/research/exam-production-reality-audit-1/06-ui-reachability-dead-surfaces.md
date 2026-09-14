# 06 — UI 可达性与 dead surface

scope：apps/web 全部页面/路由的可达性与分类；复查历史上的 dead/hidden/recovery/proctor UI 传闻。method：App.tsx 路由表逐条 + 页面文件反向引用检查（主 agent）+ SA1 的 capability/UI 消费面（grep Permission.*）+ 运行时观测（考试流程实验）。UI 永远不算 capability 证据——每条分类追到服务端端点与 runtime effect。

> **REPORT-CORRECTIVE-1**：UI 裁决拆分——不再用单一 "UI COMPLETENESS = PROVEN / zero dead UI"。
> 拆为五个维度（见 §7）：UI_ROUTE_REACHABILITY（PROVEN / NONE DEAD FOUND）、
> DEAD_PAGE_CENSUS（ZERO）、UI_OPERATIONAL_COMPLETENESS（SUPPORTED_WITH_GAPS，
> 因为存在"服务端有但 UI 缺席"与"UI 暴露但服务端拒绝"两个反向缺口）、
> UI_CAPABILITY_AFFORDANCE（gap 清单见 §3）、UI_SECURITY_AUTHORITY（NOT APPLICABLE，
> 服务端始终是权威）。"NO DEAD PAGE ≠ UI COMPLETE"。

## 1. 路由面普查（App.tsx:79-157，OBSERVED_CODE）

**公开（5）**：/login、/launchpad、/invite/accept、/forgot-password、/reset-password。
**考生（4 + 2 跳转）**：/exam→/exam/list、/exam/list、/exam/settings、/exam/:examId/start、/exam/:attemptId/take、/exam/:attemptId/result。
**管理（36，/admin 下，AdminLayout 包裹）**：dashboard、system、operations、settings、candidate-fields、users、candidates、courses、questions(+new/:id/edit/import)、exams(+new/:id/:id/edit/:id/scores)、exam-profiles(+new/:id/edit)、exams/:id/proctor、proctor、exams/:id/proctor/monitor、results、grading-queue(+/:id)、audit-logs、permissions、import-logs、attempts/:id、recovery(+incidents/:id+attempts/:id+exams/:id)、proctor/recovery(+incidents/:id)、diagnostics(→/admin/system 重定向)、* →PlaceholderPage。

## 2. 分类（每个 page 追到 server endpoint 与 runtime effect）

| 分类 | 结果 |
| --- | --- |
| LIVE | 上述全部具名页面（每个都映射到 /api 端点；抽样运行时验证：登录、candidate exams、start/take/save/submit、admin exams/enrollments/monitoring/audit 均实测 200 且有持久效果） |
| LIVE_BUT_HIDDEN | 无导航入口但可达：/exam/settings（ExamLayout 内，考生档案设置）、/admin/operations（OperationsPage，权限门 SystemOpsPolicyView 后台可见性由 adminRouteCapabilities 决定） |
| ROLE_SCOPED | /admin 全部：服务端 capability 门（权威）+ 前端 adminRouteCapabilities.ts deny-by-default 门（UX）；Proctor 相关页对 Admin/Proctor 双角色可达 |
| FEATURE_GATED | 无前端 feature flag 门（FEATURE_* env 均为服务端/authoring 行为门） |
| BACKEND_ONLY | teacher/grader assignment 管理端点（无 UI）；system.auto_submit 族（System-only 无 UI） |
| UI_ONLY_BROKEN | 无发现（每页均有真实 API 消费；无纯壳页面） |
| DEAD_UNREACHABLE | **零**：88 个页面文件中，非测试文件全部被 App.tsx 路由或布局组件引用（主 agent 反向引用全查；唯一误报 InvitationsCard 经查 UsersPage.tsx:49,521 消费） |
| LEGACY | proctorMonitoring.ts:221 legacy proctor-incident 路由（服务端保留、UI 已换新入口；服务端 scoped 仍 Admin-only） |
| DEBUG_DEV_ONLY | 无发现 |
| INTENTIONAL_FUTURE_PLACEHOLDER | * 通配 → PlaceholderPage（有意兜底）；catalog 预留 capability（grading.finalize 等）对应 UI 缺席（BACKEND_ONLY/预留） |

## 3. 历史传闻复查

- **recovery UI**：RecoveryQueuePage/IncidentDetail/AttemptDetail/ExamDetail + ProctorRecovery 全部 LIVE（路由 + 权限门 IncidentRecoveryView + 服务端 recovery 端点 RecoveryQueue list（keyset 分页）+ incident 操作端点）。非 dead。
- **proctor UI**：ProctorWorkspacePage（/proctor）+ ProctorDashboardPage（exams/:id/proctor）+ ExamMonitoringPage（monitor）全部 LIVE，绑 proctorMonitoring 端点（assignment_scoped，实测 200）。
- **admin-only surface**：/admin/operations、/admin/system、audit-logs、permissions、import-logs 均 LIVE + 服务端 Admin-only capability。
- **not-implemented UI**：无"占位按钮"；发现的是反向问题——**UI 暴露但服务端拒绝**（ScoreListPage 导出按钮，F3-04）与**服务端存在但 UI 缺席**（assignment carriers，F2-04）。

## 4. UI 不是权威的运行时佐证

- 实验观测（08 报告 E 场景）：未就绪考生直接 POST start → 服务端 409（UI 无关）。
- 考生 take 流的 canSave/canSubmit/effectiveDeadline 全部来自服务端 take meta（OBSERVED_RUNTIME）。
- 前端 adminRouteCapabilities.ts:11-15 自带契约注释："NOT A SECURITY CONTROL"。

## 5. 客户端运行时行为（容量/恢复相关）

- 心跳 30s（TakeExamPage.tsx:917）；心跳连续失败计数 → client_events 遥测（heartbeat_failed/restored）。
- 客户端倒计时到期触发 auto-submit POST（:958-999）——UX only，服务端重判（03 §4）。
- 队列页轮询 = 重发 POST /attempts/:examId/queue（StartExamPage.tsx:71-94）。
- 断网恢复：useAttemptRestore + restore 端点 + transientReducer（LIVE）。

## 6. Findings / Unknowns

- F1-06 NOTE：/exam/settings 无显式导航入口（直接 URL 可达；服务端门控正常）。
- F2-06 NOTE：ProctorRecoveryIncidentDetailPage 与 admin RecoveryIncidentDetailPage 双入口并存（角色分流设计，非缺陷）。
- Unknown：懒加载/动态 import 是否存在（未发现 lazy()）；深链在权限门后的行为与直接路由一致（AdminLayout deny-by-default）。

## 7. UI 裁决拆分（corrective）

| 维度 | 裁决 | 依据 |
| --- | --- | --- |
| UI_ROUTE_REACHABILITY | **PROVEN / NONE DEAD FOUND** | 88 个页面文件全部被 App.tsx 路由或布局引用（§2 DEAD_UNREACHABLE=零）；无纯壳页面（UI_ONLY_BROKEN 无发现） |
| DEAD_PAGE_CENSUS | **ZERO** | 主 agent 反向引用全查；唯一误报 InvitationsCard 经查被 UsersPage 消费 |
| UI_OPERATIONAL_COMPLETENESS | **SUPPORTED_WITH_GAPS** | 两个反向缺口存在：teacher/grader assignment 管理零 UI（F1-04b）；ScoreListPage 导出按钮 UI 暴露但服务端 403 拒绝（F2-04）——产品操作面不完整 |
| UI_CAPABILITY_AFFORDANCE | **SUPPORTED_WITH_GAPS** | can() 门控 deny-by-default（adminRouteCapabilities.ts）正确；但存在 1 处按钮级 affordance 缺口（ScoreListPage 导出），及 carrier 管理页面整体缺席 |
| UI_SECURITY_AUTHORITY | **NOT APPLICABLE**（服务端始终是权威） | 前端 adminRouteCapabilities.ts:11-15 "NOT A SECURITY CONTROL"；所有 scope 列表都有服务端 SQL 过滤（04 §7）；UI 缺门不构成权限提升（F2-04 方向安全） |

**结论：不再允许 "UI COMPLETENESS = PROVEN（零 dead UI）" 这种单维表述。**
