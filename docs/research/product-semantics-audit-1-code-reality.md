# EXAM-BOUNDED-PRODUCT-SEMANTICS-AUDIT-1 — Phase 1: Code Reality

- BASE = `0b8932621a17259e5808db1fcc3bf9e7dcbe65e4` (master, clean)
- CODE_REALITY_FREEZE_SHA = `0b8932621a17259e5808db1fcc3bf9e7dcbe65e4`
- Method: CODE FIRST. 本报告全部结论来自代码、Schema、迁移、测试断言；注释不作为证据（报告中出现的注释仅标注为“与代码矛盾/一致”的观察对象）。规范文档（SPEC/architecture/ADR）在 Phase 2 之前未读取。
- Evidence key: `file:line` at BASE. 测试证据标注层级 UNIT / INTEGRATION（real PG）/ PROCESS（真实子进程）/ E2E / STRUCTURAL / NONE。

---

## 1. Executive summary

产品实际承诺的语义核心（状态机、冻结快照、身份化评分、服务端时钟、可见性门、幂等命令、持久准入）有强代码所有权和强可执行证据。但全仓普查发现四类系统性问题：

1. **Latent policy 群**：`controlFlags` 中 6/10 个旗标（`shuffleQuestions`、`shuffleOptions`、`detectTabSwitch`、`disableCopyPaste`、`restrictIp`、`requireLockdown`）对运行时行为零门控，但可 authored、被存储、随 API 裸暴露给考生端。其中切屏检测/复制粘贴为“旗标仅门控横幅、检测行为存在但无条件采集”（L-3/L-4，exam-policy-authority.md:115-116 已裁决为 LATENT client hint）；shuffle/restrictIp/requireLockdown 为纯零读者。（初版“UI 承诺不存在的检测”的表述经 adversarial review 证伪并已修订——检测管线见 SC-23。）
2. **timed_sync 半成品**：运行时机制完整（T0 门、共享 deadline、`sync_started_at` 列），但 authoring 枚举排除它、策略校验器拒绝它，且宣称持久化 T0 的“operator start command (B2)”在 apps/api 中**不存在**（timer.ts:84 注释与代码矛盾——正是“只信代码”原则的实例）。
3. **Admission 的双计数呈现**：调度序数（全量行）与 UI 位置（活跃行）是两个事实；位置随他人开考“改善”是实现结构产物。历史 batch 产能不足时，晚加入者/重考生可立即获准——无 owner 声明这是否是产品意图。
4. **第二权威群**：API route 层重复实现终态集合、“考试已结束”谓词、过期比较；web 层重复枚举词表。当前全部对齐，但无共享 seam 防漂移。

Top 20 风险排序见 §9。

---

## 2. Code semantic map（Policy → Command → Owner → Persistence → Projection → Observable）

按域（只列权威写入口与持久化，投影省略为 API/web）：

```text
Exam
  policy: validateExamPolicyInput (create/update, examPolicy.ts:339) + assertExamPolicyValid (publish, examCommands.ts:151)
  commands: publishExam/openExam/closeExam/idempotent/cancelExam/unpublishExam/extendExam/archiveExam/publishResults (examCommands.ts)
  status owner: EXAM_VALID_TRANSITIONS (examStateMachine.ts:5-12); lazy reconcile: checkAndUpdateExamStatus (examCommands.ts:413-444)
  persistence: exams row (status/timing_mode/duration/open_at/close_at/question_snapshot/control_flags/…)
  observable: admin exam pages; candidate exam list/detail; scores gates

Enrollment
  state machine: enrollmentStateMachine.ts:5-13 (assigned→started→completed; blocked⇄started)
  writers: attemptCommands.ts:408-414 (start), grading.ts:340-353 (finalize)
  persistence: exam_enrollments (status, attempt_count, final_*)

Attempt
  state machine: attemptStateMachine.ts:39-46 (仅 submit/grade 经 transition()；disrupt/restore/graded 直接 repo 写)
  commands: startOrRestoreAttempt (attemptCommands.ts:169) / submitAttempt (:452) / markDisrupted (:617) / restore (attemptCommands.ts:743; restoreInterruption.ts:207)
  persistence: exam_attempts (status/deadline_at/answers/submitted_answers/question_snapshot/interruption_*_snapshot)
  observable: take snapshot GET /candidate/attempts/:id/take (route-side projection attempts.shared.ts:137)

Admission (#292)
  commands: joinAdmissionQueue / reconcileAdmission / ensureStartAdmission / consumeActive (admissionCommands.ts)
  schedule math: computeBatchRelease (:141-157) anchor=earliest joined_at over ALL rows
  persistence: exam_admissions (joined_at/admitted_at/consumed_at/consumed_attempt_id; 无状态列, lifecycle 由时间戳派生 :165-172)
  observable: POST /attempts/:examId/queue; GET /admin/exams/:id/admissions (只读)

Answer
  protocol: processSaveAnswer (answerProtocol.ts:100-249) 守卫序: voided→closed→submitted→deadline→canonicalize→idempotency→version
  persistence: exam_attempts.answers (draft, versioned) / submitted_answers (freeze-once, schemaVersion 1)

Submission
  freeze: buildSubmittedAnswersSnapshot (answerProtocol.ts:545-564, 按 snapshot.order 排序) + materializeGradingWorkset (attemptCommands.ts:578)

Grading
  auto/manual predicate: question.type === "text_response" (gradingEngine.ts:192-194)
  score authority: gradingWorkset terminal aggregation (:405-529, 冻结快照序)
  finalize: finalizeTerminalGrading (grading.ts:226-359); 手工完成同路径 (manualGrading.ts:185-240); 无 regrade

Result
  visibility: resolveCandidateResultVisibility (candidateResultVisibility.ts:55-103); enrollment 级 (:114-127)
  publication: publishResults (examCommands.ts:466-517) 唯一 resultsPublishedAt 写者; 无自动发布

Incident/Recovery
  incident versioned CAS (incidentCommands.ts:1047-1166); terminal={resolved,dismissed} (:155)
  restore: strict/bounded_grace math (interruptionPolicy.ts:173-262); operator grant (operatorGrant.ts:180-505, 需 policy=operator_incident, 无 terminal override)
  system actors: heartbeat + deadline scanners (apps/api plugins); 扰动判定 elapsed >= timeout (attemptCommands.ts:639-644)

Authorization
  catalog: 88 permissions (authz/catalog.ts:22-191), 7 roles, presets (presets.ts:295-404)
  route 声明: routeRegistry (每 route 恰一个 capability gate, whole-app 144 routes anchor 测试)
  system actor 闭集: SYSTEM_ACTOR_IDS (systemActor.ts:23-26)

Audit
  durability classes: atomic|synchronous_sensitive_read|best_effort|domain_history (auditPolicy.ts:11-15)
  system 事件无 IP/UA; 扫描器状态转换不写 audit 表（attempt 行为域状态 owner）
```

---

## 3. Semantic cards（material 22 张）

格式压缩为：`SURFACE / QUESTION / AUTHORITY(file:line) / MECHANISM / PERSISTENCE / FREEZE_POINT / OBSERVABILITY / FAILURE / EVIDENCE / STATUS / CONFIDENCE`。

### SC-01 Exam lifecycle 状态机
- SURFACE: exam status 六态; QUESTION: 谁能从哪个状态到哪。
- AUTHORITY: `EXAM_VALID_TRANSITIONS` examStateMachine.ts:5-12。draft→published; published→[draft,open,canceled,archived]; open→[closed,canceled]; closed→archived; canceled→archived; archived 终态。
- MECHANISM: assertTransition 抛 InvalidStateTransitionError (:30-34); closeExam 幂等 (:288-290), cancelExam 不幂等 (:307-322)。
- FREEZE: archived 后唯一不可回。EVIDENCE: examStateMachine.test; STRUCTURAL+UNIT。STATUS: ACTIVE / HIGH。
- 备注：published→open 为惰性转换（见 SC-14）。

### SC-02 Attempt 状态机（部分装饰性）
- SURFACE: 8 态, TRANSITION_TABLE attemptStateMachine.ts:39-46。
- AUTHORITY: 表仅覆盖 submit/grade; **disrupt/restore/graded 由直接 repo update 实施**（attemptCommands.ts:676-680, :743-748; grading.ts:278-301）——transition() 从未被传入 disrupt/restore/complete_grading。`grading` 中间态从不持久化。`DEADLINE_EXCEEDED` reason 声明 (:14) 但永不返回。`voided` 无生产者（见 §8）。
- EVIDENCE: attemptStateMachine.test + 各命令 suite。STATUS: ACTIVE 但表≠唯一权威（SECOND_AUTHORITY 群，见 §6）/ HIGH。

### SC-03 时间权威 = 服务端注入时钟
- SURFACE: 所有引擎命令显式收 `now: Date`（startOrRestoreAttempt:169, submitAttempt:452, grantAttemptTime:180…）; API 侧 fastify.now()。
- MECHANISM: 有效 deadline = min(closeAt, deadlineAt)（timer.ts:37-55）; 过期判定 `now >= effectiveDeadline`（timer.ts:65-73, SOLE authority）; deadline 冻结 submittedAt=effectiveDeadline 而非墙钟（deadlineReconciliation.ts:217-227）。
- ACCIDENT: answerProtocol.ts:110 `state.now ?? new Date()` 隐藏墙钟回退。
- EVIDENCE: deadlineReconciliation.test:383; process-restart suite A/B/C。STATUS: ACTIVE / HIGH。

### SC-04 四种 timing mode 的实际差异
- timed_window: 个人 deadline=start+duration（attemptCommands.ts:340-342）；timed_sync: 需 syncStartedAt（:200-208），deadline=min(T0+duration, closeAt)（timer.ts:94-110），**无 T0 写者→不可达**（§8 D-1）；deadline: deadlineAt=null，有效 deadline=closeAt；untimed: 永不过期、不可 extend（examCommands.ts:384-386）、不自动关闭（:435-437）。
- AUTHORING: PhaseATimingModeEnum 仅 3 态（contracts/exam.ts:31）；校验器对 timed_sync 无条件拒绝（examPolicy.ts:276-279）。
- EVIDENCE: attemptCommands.timingModes.test; timing-modes.spec E2E（仅 3 可 author 模式）。STATUS: 3 ACTIVE + timed_sync LATENT / HIGH。

### SC-05 minSubmitAfterStart 双点强制
- start 可行性: earliestSubmitAt >= effectiveDeadline → infeasible（严格 < 才合法, attemptCommands.ts:355-368）; submit: 仅 source=candidate 受限（:520-533）; deadline_scanner 绕过。
- EVIDENCE: attemptCommands.test:1435-1477; candidate-save-submit.test:770。STATUS: ACTIVE / HIGH。

### SC-06 Admission 批次调度（#292 as-built）
- anchor = 全体成员（含 consumed）最早 joined_at（admissionCommands.ts:76-79）；releasedBatches = floor(elapsed/interval)+1（首批在 anchor 时刻即释放, :141-157）；**underfilled batch 照时刻表释放产能**（:156; test :216-224）。
- ordinal = 全量行 count+1（不变量：consumption 不改变, :175-189）；batchNumber=ceil(ordinal/batchSize)；释放条件 batchNumber <= releasedBatches（:338-340）→ admitOnce CAS（:101-106）。
- ensureStartAdmission fail-closed：无 admitted → QueueAdmissionRequiredError（:355-366）；**无 lazy join**（:287-293）；resume/restore 不过 admission（attemptCommands resume 提前返回 :229-253 + test :614-631）；consume 与 attempt create 同事务（attemptCommands.ts:393-406）。
- EVIDENCE: T1-T6/C1-C4 单元 + examAdmissionRepo real-PG + admissions.candidate.test + SIGKILL 进程级 D1-D3 + E2E queue-admission.spec；mutation M4（恢复 active-anchor 复现加速 bug）。STATUS: ACTIVE / HIGH。
- 未拥有语义：见 §7 H-1/H-2。

### SC-07 位置/估计等待 = 双计数呈现
- UI position = 活跃行 count+1（:191-206，“他人开考后位次改善”）；estimatedWait = (batchNumber−releasedBatches)×interval（:278-288，基于全量序数）。两个事实并存，route 侧再派生 `status: ready?"ready":"waiting"`（attempts.candidate.ts:115）。
- ACCIDENTAL: 无活跃行时返回 position:1, waitCount:0, estimatedWait:0, ready:false（:252-263）。EVIDENCE: 单元断言存在；route 层无数值断言（§8 U-1）。STATUS: PARTIAL / MEDIUM。

### SC-08 发布冻结快照
- publish: buildQuestionSnapshot 按 questionIds 序, order=index, 缺题拒绝（examCommands.ts:62-95）；不复制 Option.isCorrect（grading 不需要）。
- start: attempt.questionSnapshot = exam.questionSnapshot **逐字数组拷贝，无 per-candidate 重排**（attemptCommands.ts:381）——这是唯一的 per-candidate 快照 seam（#294 插入点）。
- 发布后 PATCH 仅允许 openAt/closeAt（exam.ts:929-953）；controlFlags/question 冻结。EVIDENCE: examCommands.test:132/167/485; scores.test:1437/1876（real PG）。STATUS: ACTIVE / HIGH。

### SC-09 身份化答题与评分（index 无关）
- save P1: snapshot.find(originalQuestionId === questionId)（answerProtocol.ts:472-479）; grading: answerMap by questionId（gradingEngine.ts:241-246）; workset unique(attempt,question)（DB m/0013:27）; freeze 按 order 排序（answerProtocol.ts:553）; result 投影按快照序（gradingWorkset.ts:504-519）。
- EVIDENCE: gradingAggregation.test:584（行序=快照序≠DB 序）; answerProtocol.test:553。STATUS: ACTIVE / HIGH。
- GAP: 无“故意错位 index 仍按 id 匹配”的直接测试（§8 U-2 弱缺口）。

### SC-10 答案版本协议
- 守卫序 + 幂等键 `${questionId}:${clientSeq}`；同键同 payload→replay 不写；同键异 payload→CONFLICTING_PAYLOAD；baseVersion < current→STALE_VERSION；接受→version+1（answerProtocol.ts:171-231）。save 使用**上下文有效 deadline**而非 attempt.deadlineAt（:495-510）。
- EVIDENCE: saveAnswer.test 1-6 + route 层 stale/replay/concurrent（submitFreezeBarrier, ADR-008）。STATUS: ACTIVE / HIGH。

### SC-11 评分公式与精度
- single/true_false: 严格等值; multiple: 去重排序后比较, partial_half 半分, all_correct_full 全对才得分（gradingEngine.ts:41-65）; fill_blank: `|` 备选、trim、caseSensitive ?? false、keyword=includes; text_response 手工分 [0,max] 且 Number.isFinite（manualGrading.ts:157-159）。
- **无任何 round/toFixed**：总分=原始浮点求和（gradingEngine.ts:247-250）; passed = total >= passingScore。
- ACCIDENTAL: 多选 Set 去重使 "A,A,B"≡"A,B"（:45-53, UI 无法产生重复, API 可）。
- EVIDENCE: gradingEngine/gradingScoreIdentity/partialScoreBranch; real-PG 路由测试。U: 小数累加无测试（§8 U-2）。STATUS: ACTIVE / MEDIUM(精度未证明)。

### SC-12 手工评分 hold/completion，无 regrade
- freeze 时 requiresManualGrading→pending_manual（attemptCommands.ts:558-560）; 自动 finalize 拒绝 pending（grading.ts:399-404）; completion 在最后一条 manual 完成时驱动同一 closure（manualGrading.ts:185-240）; completed_manual 状态即权威、不可修订（:142-153）; graded attempt 永不重投影（grading.ts:216-221）。
- EVIDENCE: manualGradingHold/Completion; E2E manual-grading*。STATUS: ACTIVE / HIGH。

### SC-13 结果可见性真值表
- not graded→hidden(not_graded); graded+pending_manual→hidden; immediate→visible; after_grading→需 fully_graded; manual→resultsPublishedAt != null; **view==="all"（admin）绕过 publication gate**（candidateResultVisibility.ts:90-101）。
- retake deferral: pass_then_stop 下 deferred 期间 passed/failed 行为一致（RetakeDeferredError 先于 finalPassed 检查, attemptCommands.ts:278-286）。
- EVIDENCE: 可见性真值表 UNIT + L1-L6 route real-PG + J5a-1..9 + cross-proof（admin 见/candidate 隐藏）。STATUS: ACTIVE / HIGH。

### SC-14 published 与 open 对考生等价
- start 门 `OPEN_STATUSES = {"published","open"}`（attemptCommands.ts:122, :185）+ openAt/closeAt 窗口检查（:191-193）。published→open 是读/写时惰性 reconcile（examCommands.ts:426-429）。两状态对考生行为无差别，仅 operator 可见命名差异。
- EVIDENCE: STRONGLY IMPLIED（无显式“published 即可开考”测试; 由代码序直接可证）。STATUS: ACCIDENTAL 候选 / MEDIUM。

### SC-15 扰动检测与恢复
- heartbeat: 仅 in_progress; `elapsed >= timeout` 即扰动（相等含入, attemptCommands.ts:639-644）; under-lock recheck（fresh_under_lock）; 创建 episode+detected 事件。
- restore: 严格身份验证（detected.occurredAt===interruptedAt 等, restoreInterruption.ts:261-318）; strict/operator_incident→零补偿; bounded_grace: added=min(eligible, perIncident, perAttempt−prior, closeRoom)（interruptionPolicy.ts:232-248）; 每 interruption 恰一 bounded 调整（DB partial unique m/0021:116-118）。
- EVIDENCE: restoreInterruption suite + disconnect-restore E2E + 进程级重启。STATUS: ACTIVE / HIGH。

### SC-16 操作员命令 = 5 个，无 resume/terminal-override
- force_submit（receipt 幂等, 真实转换才 audit）、misconduct_mark、time_grant（需 policy=operator_incident; 超过 closeAt 直接拒绝不 clamp（operatorGrant.ts:457-463）; terminal 不可 escape（:351-354））、incident investigate/resolve/dismiss。restore 是 candidate-only。
- force_submit 到已 terminal: submitted/grading/graded→no_change receipt; not_started/queued/voided→409（route 层 planForceSubmitExecution 复制终态集, forceSubmitExecution.ts:347-370, §6 A-1）。
- EVIDENCE: admin-force-submit 三层 + 并发矩阵 A-E。STATUS: ACTIVE / HIGH。

### SC-17 审计双轨（人/系统）与 durability 分级
- 闭集 system actor（authz/systemActor.ts:23-26, 运行时拒绝越集）; systemEvent 无 IP/UA; 扫描器转换不写 audit 表（attempt 行为 canonical owner）; force_submit 仅真实转换写 audit。
- EVIDENCE: auditPolicy strict-schema tests + audit route 套件 + auditArchitecture STRUCTURAL。STATUS: ACTIVE / HIGH。

### SC-18 RBAC 每 route 单 gate + 反枚举 404
- whole-app anchor: 144 routes = 124 protected + 20 non; 每保护 route 恰一个 capability gate; scoped resolver 折叠为 404（ownAttempt/scoreCapability 等）。
- EVIDENCE: routeRegistryConformanceWholeApp.test（real PG）+ 各 anti-enumeration 测试。STATUS: ACTIVE / HIGH。

### SC-19 客户端-服务器对账
- 客户端 countdown/自动交卷仅为显示与触发，服务端在 submit/take/heartbeat 均以 engine 权威重判；terminal 信号（save 拒绝词表 + heartbeat 409 INVALID_STATE_TRANSITION）触发 single-flight 快照重读；restore POST 结果不被信任、总是重读。
- 心跳: 客户端 30s 硬编码; 服务端超时默认 60s（heartbeat.ts:20, 部署可配）。2:1 容忍比为隐式策略, 无 owner。
- EVIDENCE: E2E force-submit-convergence-probe E1/E2 + take 快照 no-store + process tests。STATUS: ACTIVE / HIGH（30s/60s 比值为 UNDERSPECIFIED）。

### SC-20 控制旗标缺省物化（Zod v3 依赖）
- create 时 `controlFlags: ControlFlagsSchema.default({})`（contracts/exam.ts:262）。安装版 zod 3.25.76 的 `ZodDefault._parse`（v3/types.js）: undefined→取 defaultValue→**仍过 innerType._parse**（与 zod v3 官方文档一致；v4 文档改为“短路急切返回”）。故向导（不发 controlFlags）创建的考试落库为**全 10 旗标物化默认值**（batchSize:10, batchInterval:3, 其余 false, showResultImmediately:true），并裸透传给考生端（attempts.candidate.ts:277）。
- 升级隐患: v4 语义下会存 `{}`→`controlFlags.requireQueue` 变 undefined/falsy→requireQueue 考试静默失去准入门。（v4 类型系统会在编译期拒绝 `.default({})`，缓解但值得记录。）
- STATUS: LATENT 载体 / HIGH（机制证实）。

### SC-21 心跳超时为部署配置
- DEFAULT_HEARTBEAT_TIMEOUT_MS=60_000（heartbeat.ts:20）, 从 settings 读 heartbeatTimeoutSeconds。扰动阈值是**部署配置**而非考试策略；考试级无任何心跳/监控策略字段。
- STATUS: ACTIVE / HIGH（归属明确）；产品语义（监控容忍度是否应 per-exam）未决。

### SC-22 无操作员准入动作
- 唯一 admin 准入端点为只读 GET /admin/exams/:examId/admissions（exam.ts:2198）；全仓无 manualAdmit/skipQueue 写路径（rg 证实）。发布后 controlFlags 冻结→错误配置的队列（batchSize/interval）无运行期补救，只有 unpublish→draft→改→重发布路径，且重发布对已有 exam_admissions 行的影响无任何代码处理（§7 H-3）。
- STATUS: 有意的缺失（代码注释自称 by design——注释与代码缺席一致）+ 周边语义未决 / HIGH。

### SC-23 客户端遥测与监考监控域（adversarial review 补录）
- SURFACE: 考生端考试遥测（`exam_telemetry`/`log`，批量 20/5s/上限 200，clientEventBuffer.ts:5-17）→ POST /client-events（clientEvents.ts:53-79，认证 + 大小/深度/批量上限 clientEvent.ts:24-36）→ `client_events` append-only 表 → 只读监考面。
- AUTHORITY: proctorMonitoringService.ts——`COUNTED_EVENT_NAMES`（:83-84 起，含 visibility_lost/browser_offline/save_failed/submit_failed 等）、在线判定 online/stale/offline（阈值 30s/90s，proctorMonitoring.ts:26-27）、`computeWarningLevel`（:206-233，任一计数>0 → warning 级）。
- OBSERVABILITY: GET /admin/exams/:id/proctor/attempts + GET /admin/attempts/:id/proctor-events（proctorMonitoring.ts:109/:141）；web ExamMonitoringPage 15s 轮询。
- AUTHORIZATION: 绑定权威 ADR-015（Accepted，2026-08-02）assignment-scoped。
- KEY SEMANTIC: 遥测采集**不受任何 controlFlags 门控**（无条件采集）；controlFlags 只门控考生侧提示横幅（L-3/L-4）。
- EVIDENCE: 路由/服务层代码直读 + contracts/proctorMonitoring schema；E2E proctor-monitoring-ui.spec。STATUS: ACTIVE / HIGH（SPEC §4.5 “Phase 1 不实现” 为过期表述，见 Phase-2）。

---

## 4. Latent policies（字段存在/可存储/可观察，运行时无读者）

| # | 字段 | 声明 | 存储 | 可 authored | 运行时读者 | 观察 |
|---|---|---|---|---|---|---|
| L-1 | `shuffleQuestions` | contracts/exam.ts:61 | control_flags jsonb | legacy form :434（向导不可） | **0** | #294 的既存载体；裸暴露给考生 |
| L-2 | `shuffleOptions` | exam.ts:62 | 同上 | legacy form :445 | **0** | 同上 |
| L-3 | `detectTabSwitch` | exam.ts:63 | 同上 | legacy form :454 | StartExamPage:253 **仅门控警告横幅** | **旗标≠行为解耦**：切屏检测管线存在且**不受旗标门控**——TakeExamPage.tsx:928-947 无条件发送 `visibility_lost/visibility_restored`（含 durationMs）→ POST /client-events（clientEvents.ts:53-79）持久化 → proctorMonitoringService.ts:83-84 计入 `COUNTED_EVENT_NAMES`、:206-233 `computeWarningLevel`（visibilityLostCount>0 → "warning"）→ 监考 API 呈现。旗标无法关闭检测；无 incident/处置流（SPEC:1046 标 Phase 2）。exam-policy-authority.md:115 已裁决为 LATENT（"client hint, not enforcement"） |
| L-4 | `disableCopyPaste` | exam.ts:64 | 同上 | legacy form :465 | StartExamPage:260 **仅警告横幅** | 无 onCopy/onPaste/contextmenu 处理（TakeExamPage grep 证实）；exam-policy-authority.md:116 已裁决为 LATENT（"client hint"）——SPEC:316/1047 “前端禁用…”为过期表述（见 Phase-2） |
| L-5 | `restrictIp` | exam.ts:68 | 同上 | legacy form（类型仅在） | **0**（连 UI 显示都无） | 纯 latent |
| L-6 | `requireLockdown` | exam.ts:69 | 同上 | 同上 | **0** | 纯 latent |
| L-7 | `questionSelectionMode:"random"` | contracts exam.ts:36, DB 列 | exams.question_selection_mode | 否（向导硬编码 manual, wizardState.ts:191） | publish 硬拒绝非 manual（examCommands.ts:125-129） | 死面 |
| L-8 | `timed_sync` 全链 | 见 SC-04 | exams.sync_started_at (m/0041) | 否 | start 门/timer/support 存在 | **T0 写者不存在**（rg 证实 apps/api 无 syncStartedAt 写入；timer.ts:84 注释声称的 B2 命令不在代码中） |
| L-9 | `GradingFinalize`/`GradingIdentityView`/`CandidateDelete` permissions | authz/catalog.ts:103-104,44 | — | — | 无对应 route / 无人工 preset 授予 | 权限目录中的 latent 项 |
| L-10 | `InputModeEnum`/`GradingModeEnum`（attempt.ts:1048/1059） | contracts | — | — | 0 importer | 死契约面 |
| L-11 | `RetakePolicyEnum` 的 `daily_limit`/`weekly_limit` | exam.ts:40-41 | — | — | Phase1 gate 拒绝 + PG CHECK 仅 3 值 | 死成员 |
| L-12 | `InterruptionDetectionSource:"migration_backfill"` | interruption.ts:18 | DB CHECK 含 | — | 仅 backfill 工具 | INTERNAL_ONLY |

---

## 5. Accidental semantics（行为存在 = 实现结构产物，无命名 owner）

| # | 行为 | 机制 | observable? | persisted? | tested? | 有意? | 冻结风险 |
|---|---|---|---|---|---|---|---|
| A-1 | 队列位置随他人开考“改善” | ordinal(全量行) vs position(活跃行) 双计数（admissionCommands.ts:175-206） | 是（考生页） | 否（派生） | 是（断言“shrinks”） | **有 owner**：exam-runtime.md:277 明文记载（“UI position 可因他人 start 提前，entitlement 不变”）；属已文档化呈现语义 | 低：已文档化 |
| A-2 | estimatedWait 只按整 batch 数（floor），不插值 | :278-288 | 是 | 否 | 部分（值仅单元级断言） | 未声明 | 低 |
| A-3 | published≡open（考生视角） | OPEN_STATUSES + 惰性 reconcile | 是（状态标签区分, 行为不区分） | 是 | 隐含 | 未声明 | 中 |
| A-4 | 边界方向不一致：heartbeat `>=`、deadline `>=`、lateEntry 严格 `>`、minSubmit 可行性严格 `<` | 各处 | 是（边界一秒之差） | 否 | 各自有边界测试 | 约定未命名 | 中 |
| A-5 | 多选答案 Set 去重 | gradingEngine.ts:45-53 | API 层可观察 | 否 | 隐含 | 未声明 | 低 |
| A-6 | admission 平序按 id 字典序 | :393-398 | 同毫秒加入可观察 | 否 | 无 | 未声明（实现细节，评审建议降出 Top 20） | 低 |
| A-7 | 无活跃行队列视图 position:1/ready:false | :252-263 | 是 | 否 | 无 | 未声明 | 低 |
| A-8 | 向导 passingScore 默认 = round(total×0.6)（客户端启发式成为持久策略） | ExamCreatePage.tsx:444 | 是 | 是 | 无 | UI 产物 | **中高**：60% 及格线悄悄变成 per-exam 契约 |
| A-9 | `state.now ?? new Date()` 隐藏墙钟回退 | answerProtocol.ts:110 | 理论上（测试可触发不同 now） | 否 | 无 | 实现产物 | 低 |
| A-10 | ~~UI 承诺不存在的检测~~ **修订（adversarial review）**：检测管线存在且不受旗标门控（见 L-3）——真实残留是“旗标仅门控横幅、行为无条件”的解耦，且已被 exam-policy-authority.md:115 记录 | 见 L-3 | 是 | — | — | 已文档化 LATENT | 低（残留为文案对齐决策） |
| A-11 | 历史产能不足时晚加入者/重考生立即获准（与 §7 H-1/H-2 合并计数） | batchNumber<=releasedBatches | 是 | 否 | 无（未作为意图断言） | 未声明 | **高**：可被利用（等待人人有份后插队零成本） |

---

## 6. Second authorities（同一决策多点实现）

| # | 语义 | OWNER_A | OWNER_B | 分歧可能 | 现状 |
|---|---|---|---|---|---|
| S-1 | attempt 终态集合 | attemptStateMachine | forceSubmitExecution.ts:347-370 + submitAndGradeAttempt.ts:92-104/156-180 + terminalAttemptSignal(web) + attempts.shared.ts:165-179 lockReason | 是（新增终态需改 4+ 处） | 对齐 |
| S-2 | “考试已结束”谓词（closed/archived/closeAt 已过） | 无 engine owner | scores.ts:142-157 与 exam.ts:193-233 **两份 route 内联** | 是（互为副本） | 对齐 |
| S-3 | 过期比较 `now>=effectiveDeadline` | timer.ts isAttemptDeadlineExpired（自称 SOLE） | attempts.shared.ts:151 route 内联 | 是 | 对齐 |
| S-4 | passingScore<=totalScore | examPolicy.ts:128-134 | examCommands.ts:240-242（publish 复查） | 低（有意双检） | 对齐 |
| S-5 | timed_sync 拒绝 | examPolicy.ts:276-279 | examCommands.ts:122-124 | 是（且与运行时支持矛盾, L-8） | 对齐地拒绝 |
| S-6 | retake 终止谓词 | attemptCommands.ts:259-286 | grading.ts:61-85 | 中（max_attempts/pass_then_stop 双写） | 对齐 |
| S-7 | 开窗判定 | attemptCommands.ts:191 | examCommands.ts:426-437 | candidateExamSummary.ts:51-53 | 三处 | 低 |
| S-8 | interruption caps 规则 | 域 leaf examPolicy.ts:164-203 | interruptionPolicy resolver/evaluator | 中 | 对齐 |
| S-9 | canonical payload 相等 | incidentCommands.ts:311-326 | attemptCommandPayload.ts:70-90 | 低 | 对齐 |
| S-10 | 状态→显示词表 | 服务端 enums | web statusMeta.ts 全量平行 map + save-rejection 词表 + terminal 词表 | 是（漂移→显示错, 不影响行为） | 对齐 |
| S-11 | Question type 五元组 | contracts/question.ts:8 | contracts 内部 attempt.ts:69, score.ts:108/:230 再声明 | 低 | 对齐 |
| S-12 | availability/primaryAction 联合 | contracts/candidate.ts:12-34 | engine candidateExamSummary.ts:4-21 逐字重decl | 是 | 对齐 |
| S-13 | 结果发布双载体 | resultPublicationMode（权威） | controlFlags.showResultImmediately（legacy, 存储保留, 读侧仅 mode 生效） | 中（legacy flag 仍被存储与回读） | 单写者解析 |

---

## 7. Semantic holes（多语义可行、无 owner 裁决）

- **H-1 晚加入 vs 历史空转产能**：设 batchSize=10、interval=30s、前 5 分钟只有 2 人排队。T+5min 新 joiner ordinal=3 → batch 1 → releasedBatches≥11 → 立即获准。多个可行语义（按实际等待人数推进 vs 按时刻表推进）中代码选择了后者（releasedCount 与实际人数无关, :156），无测试把它断言为产品意图。
- **H-2 重考插队**：retake=fresh membership（T6 证实排在既有行后），但若 elapsed 已远超其 batch 边界则立即获准。“重考是否应重新等待完整 interval”无 owner。
- **H-3 unpublish→republish 对存量 exam_admissions 的影响**：无任何代码触及（republish 不清 queue、不清 anchor）。是否重置 epoch 属产品决策。
- **H-4 队列故障运行期补救缺失**（SC-22）：发布后 batchSize/interval 冻结、无 manual admit。卡死队列的唯一出路是 unpublish（副作用 H-3 未定义）。
- **H-5 心跳容忍度归属**：部署配置（默认 60s）vs 客户端 30s 硬编码，2:1 为隐式；考试级监控策略字段不存在。“网络抖动多久算失联”是产品问题，当前由部署默认值代答。
- **H-6 deadline-vs-candidate-submit 竞点**：candidate 到点提交由“先 reconcile 后 submit”顺序裁决（submitAndGradeAttempt.ts:146-180），答案取 deadline 时刻冻结值——语义自洽且有测试，但“candidate 恰在 deadline 提交是否计入其最后答案”这一产品问题的答案分散在实现顺序里，无命名权威。

---

## 8. Dead / internal-only / unproven

**DEAD**：`voided`（无生产者；全仓仅消费者：save 守卫、restore、force-submit 409、lockReason、backfill 脚本查询）；`daily_limit`/`weekly_limit`；`InputModeEnum`/`GradingModeEnum`；`questionSelectionMode:"random"`；`ENG/types.ts:4-20` 的 `loadAttempt/gradeAttempt/voidAttempt` declare 存根（无实现）；`DEADLINE_EXCEEDED` reject reason（声明不返回）。

**INTERNAL_ONLY**：`migration_backfill` detection source；system actor 权限空集的 Scanner/Heartbeat。

**UNPROVEN / 弱证据**：
- U-1 `estimatedWaitSeconds` 数值仅单元级（in-memory repo）；route 层无数值断言。
- U-2 分数小数累加精度：无 round 逻辑（代码证实）+ 无累加精度测试（如 partial_half 与奇数分配和）。
- U-3 published 状态下直接开考（不经 reconcile）无显式测试。
- U-4 “force-submit 与并发扰动”交互仅 E2E E2（UI 级），无 API 级单测。
- U-5 Zod v3 default-through-parse 依赖（SC-20）：由安装源码+官方文档证实，但仓库无防升级护栏测试。

---

## 9. Code-derived invariant candidates（仅代码/测试证据）

| # | 不变量 | 状态 | 证据 |
|---|---|---|---|
| C1 | terminal attempt 拒绝答案变更且零副作用 | PROVEN | saveAnswer.test:187/209; candidate-save-submit.test:1205/1230（real PG, DB 不变量） |
| C2 | resume ≠ fresh start（同一 attempt、同一 deadline、补偿式） | PROVEN | restoreInterruption.test:317/370/459; processRestartDeadline A |
| C3 | admission 只 gate 新 attempt 的 START；resume/restore 免检 | PROVEN | admissionCommands.test:614-631; attemptCommands.ts:229-253 序; D3 进程测试 |
| C4 | question/option 身份（非 presentation index）拥有 save/grade/result | PROVEN | answerProtocol P1; gradingAggregation:584; answerProtocol.test:553 |
| C5 | 发布冻结快照；开考逐字拷贝；发布后编辑不影响已开考 | PROVEN | examCommands.test:485; scores.test:1437/1876 |
| C6 | 评分只读 submitted_answers（非 draft） | PROVEN | grading.test:489; gradingWorkset.test:386 |
| C7 | 服务端时钟唯一权威；deadline 冻结 submittedAt=effectiveDeadline | PROVEN | timer.ts; deadlineReconciliation.test:383 |
| C8 | 可见性真值表（mode×gradingStatus×publishedAt；admin all-view 绕过） | PROVEN | 真值表 UNIT + L1-L6/J5a real-PG |
| C9 | force-submit operationId 幂等收据；仅真实转换产生 audit | PROVEN | 并发矩阵 A-E（real PG） |
| C10 | 每 (org,exam,candidate) 至多一条活跃队成员；consume 与开考同事务原子 | PROVEN | m/0042 partial unique; Q6/C3 |
| C11 | 批次调度锚=全体最早 join；consumption 不加速 | PROVEN | T1/T2 + M4 mutation + real-PG C4 |
| C12 | 手工评分 hold：pending_manual 不可自动 finalize；全部完成才 terminal | PROVEN | manualGradingHold/Completion |
| C13 | 发布后策略冻结（PATCH 仅 openAt/closeAt） | PROVEN | exam.ts:929-953 + web scheduleOnly + 冻结测试 |
| C14 | minSubmit: 开考可行性严格 <；candidate 受限；scanner 绕过 | PROVEN | attemptCommands.test:1435-1477 |
| C15 | 无 manual admit 写路径 | PROVEN（absence, rg 全仓） | exam.ts:2191-2205 只读端点 |
| C16 | untimed 永不自动关闭、不可 extend | PROVEN | examCommands.ts:384-386/435-437 |
| C17 | published/open 对 start 等价 | STRONGLY IMPLIED | attemptCommands.ts:122/:185（无显式测试） |
| C18 | 分数无舍入（原始浮点和） | PROVEN（代码 grep）| 精度行为 U-2 无测试 |
| C19 | detection: elapsed>=timeout 即扰动（含相等） | PROVEN | attemptCommands.ts:639-644 + heartbeat tests |
| C20 | 答案保存幂等键 `${questionId}:${clientSeq}`，版本单调 | PROVEN | saveAnswer.test 1-6 + route replay 测试 |

---

## 10. #292 Admission appendix（as-built 判定）

| 项 | 判定 |
|---|---|
| batch anchor=全体最早 join（consumption 不移动锚） | **真产品语义**（mutation-proven 后固定）；建议由 #292 closeout 或后续决策明确文档化 |
| ordinal 全量行、不可变 | 真产品语义（测试作为契约断言） |
| 晚加入 → 下一未释放 batch 边界 | 真产品语义（T5） |
| underfilled batch 照时刻表释放 | 代码有意（:216-224 测试），但“时刻表推进 vs 人数推进”的产品含义未声明 → **需产品确认** |
| 历史 batch 产能不足 → 晚加入/重考立即获准 | **实现产物，无 owner**（H-1/H-2）→ 需产品决策 |
| retake=fresh membership 排队尾 | 有意（T6）；其立即获准推论同上未决 |
| queue epoch 生命周期=考试终身（无重置路径） | 未拥有（H-3） |
| position(活跃) vs ordinal(全量) 双计数 | A-1 实现产物；UI 已当展示承诺 |
| estimatedWaitSeconds 公式 | 展示层实现选择（A-2），精度无契约 |
| operator manual-admit 缺席 | 有意缺失（SC-22），但故障补救路径未决（H-4） |

---

## 11. #294 readiness appendix（不实现）

**已有语义权威（READY_FOR_IMPLEMENTATION 的机制面）**：
- 身份体系端到端 id-based（C4），选项快照无 isCorrect 泄漏，多选评分排序后比较（顺序不敏感）→ shuffle-safe。
- 冻结模型：publish 快照 + 开考逐字拷贝（attemptCommands.ts:381 是唯一 per-candidate seam）；freeze/grading/result 全部按 `order` 字段或 id 寻址 → per-candidate 重排只需改开考拷贝点，下游天然兼容。
- resume：per-attempt 快照持久化 → 重排后 resume 自然稳定（C5/C2）。
- 客户端不重排（快照序即展示序）→ 服务端序即可。

**BLOCKED_BY_SEMANTIC_GAP（策略面）**：
1. **旗标归属**：`shuffleQuestions/shuffleOptions` 已存在、legacy UI 可 authored、默认 false、考生可见、零运行时语义。#294 若引入新旗标即成 SECOND_AUTHORITY。**最小产品问题**：既有 controlFlags 两旗标是否升格为本特性的策略载体？向导是否需要可 authored？
2. **seed 契约**：全仓无 seed 字段。per-candidate 确定性重排需要持久 seed（attempt 列 or 快照内字段）+ 决定确定性范围（per-attempt / per-sitting / per-exam）与算法暴露面（是否可复现审计）。
3. **冻结点确认**：shuffle 应发生在开考拷贝点并随 attempt 快照冻结（产品语义“开考后顺序不变”——代码已隐含，需声明）。
4. **timed_sync 交互**（若未来启用）：sitting 级 vs candidate 级顺序，随 L-8 一起决策。

---

## 12. 与注释矛盾的代码事实（按“只信代码”原则单列）

1. `timer.ts:84`“operator start command (B2) persists T0”——**代码中无此命令**（timed_sync 不可达）。
2. `examStateMachine` 表暗示 disrupt/restore/complete_grading 经 transition()——**实际直接 repo update**。
3. `timer.ts:23` 自称 SOLE authority——attempts.shared.ts:151 存在第二实现（当前对齐）。
4. `exam.ts:2191`“no manual-admit product semantic exists”——与代码缺席一致（本例注释可信）。
5. `examPolicy.ts` 及 contracts 注释称 timed_sync“rejected … by the ONE matrix authority”——与运行时支持（attemptCommands:200-208）并存，是“拒绝口径”而非“无机制”。
6. **exam-policy-authority.md:118**（binding 文档）“Queue admission: **none at runtime** — LATENT (Phase 2)”——#292 后过期：requireQueue 运行时已交付（attemptCommands.ts:297-310 准入门 + exam_admissions 表）。同文档 ：122 行（untimed/deadline 标 NOT IMPLEMENTED）同为前-#291/前-#292 旧现实。
7. **SPEC §4.5（:827-829）“监考端 Phase 1 不实现”**——只读监考监控面已交付（SC-23，ADR-015 Accepted）；SPEC:1046-1047 “防切屏 Phase 1 minimal behavior / 排队分批 Phase 2”中排队分批同样已交付。

---

（Phase 1 结束。本报告冻结于 BASE=0b893262。规范文档对比见 Phase-2 报告：product-semantics-audit-1-authority-diff.md）
