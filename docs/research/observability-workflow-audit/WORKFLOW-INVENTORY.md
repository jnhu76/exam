# WORKFLOW-INVENTORY — 观测性工作流盘点（合成）

- **产出**：本文件由 15+1 条工作流分块审计记录（调度方以 JSON 提供）合成。
- **基线**：`/home/hoo/Source/exam` @ `1d689b4a`（master，"fix(telemetry): stop retaining sql.begin scoped handler closures (#994)"）；审计树 `/home/hoo/Source/exam-otel-audit` 同 commit（本次 `git log` 证实）。
- **输入数量声明**：ask 声明 16 条记录，**实际 JSON 数组含 15 条**（W00–W06、W08–W15）。编号序列缺 **W07**，其内容未提供，本文档不覆盖；W07 是否已并入其他记录 **UNKNOWN**。矩阵按实收 15 条编写。
- **证据标注约定**：未加注的 `path:line` 为分块审计记录转引（本文未逐条复核）；标注〔抽查✓〕的为本文本次读码/grep 复核。记录中对 REALITY.md（同目录 `REALITY.md`）的章节引用目标已确认存在〔抽查✓：`grep -n "^#" REALITY.md` 命中 §0.1–§11 全部被引节〕。
- **覆盖态口径**：15 条记录 coverage 字段全部为 `TEST_ONLY`（W13 为 `NOT_IMPLEMENTED`）；各记录均声明其 chunk 未运行测试，既往实测结果（REALITY §0.2：structural+signals 22 passed、backgroundLoopSpans 13 passed、otelDbTelemetry 10 passed，commit 1d689b4a）为转引，**本文亦未运行任何测试**。
- **生产默认态前提**〔抽查✓〕：遥测默认 Off——`initTelemetry` 在 `!config.enabled` 时早返回 null（apps/api/src/telemetry/runtime.ts:208），`server.ts` 注释明示 "Default is Off"（apps/api/src/server.ts:128-131），且 fastifyOtelPlugin 仅在有 telemetry handle 时注册（server.ts:167-169）。

---

## 1. 工作流矩阵

图例：覆盖态=记录 coverage 字段；频率/风险=记录 frequency/perfRisk 字段；缺失列 `Gx` 见 §5 共性缺口索引；"无裁决"指仓库内无 Owner 决策记录。

| ID | 工作流 | 入口链 | Oracle（要点） | 信号面 | 测试锚 | 覆盖态 | 缺失 | 频率 | 性能风险 |
|---|---|---|---|---|---|---|---|---|---|
| W00 | 轻量 HTTP 探针（/api/health、/api/ready，附 /system/info、/public-config） | Compose healthcheck/LB→`GET /api/health` apiSurface.ts:50（纯 handler 零 DB）、`GET /api/ready` :80→operabilityMonitor.ts:117 probeApplicationReadiness（budget race :130-139，READINESS_PROBE_BUDGET_MS）→systemStatsRepo.ts:153-159 pingDb=SELECT organizations LIMIT 1→200 {status:"ready"}/503 {status:"not_ready"}（:90-98）；/system/info、/public-config 无 DB（system.ts:233-273）；REDIS_MODE=required 且 limiter 不可用→fail-closed 503（apiSurface.ts:72-86） | /health 200 无认证 0 条 DB 语句、HEAD 200；/ready ping 超预算→503 且 body 只含 gate answer；两种 503 形态均有契约；事务计数 /ready 恰 1 SELECT、/health 0；探针零 audit_logs | request+handler span〔@fastify/otel，instrumentHooks:false 收敛 2 span/请求〕；db.statement（仅 /ready，otel index.ts:243〔抽查✓ 调用点形态〕）；db.client.operation.duration（index.ts:165/200-215，仅 otlp 态真序列）；pino request completed + x-request-id；telemetry.init_failed（runtime.ts:218-226〔抽查✓〕） | readiness.test.ts:25-145；apiSurface.test.ts:213-239,269-270,347；requestIdWireContract.test.ts:100-160；telemetrySignals.test.ts:107-206（合成路由 /w12/boom）；serverTelemetryWiring.structural.test.ts（17 项，REALITY §0.2 记 17 passed 转引） | TEST_ONLY | G1 G2 G3 G4 G5 + telemetrySignals 未钉真实探针路由（同 G6） | high | low |
| W01 | 认证、会话、考试列表读取（login/logout/me/exams + authenticate 装饰器） | auth.ts:119-443 login（org SELECT :147、findByOrganizationAndUsername :177、verifyPasswordOrDummy argon2 :182-185、loadAssignmentAuthority :229→assignmentAuthority.ts:272-289、loginAllowed :344、signJWT :384-392）、:445-524 logout（CAS advanceAuthEpochIfCurrent :481-493）、:526-574 me；exam.ts:454-536 /exams（teacherScope.ts:17-27→examRepo.listFiltered :125-157 并行 page+count、空集短路 :130-132、每考试 candidates findById×N+count :495-513）；限流 10/60s（rateLimit.ts:42）；authenticate plugins/auth.ts:61-208（epoch CAS :123、fail-closed 401/500/503 :102-173）；login/me/list 零显式事务 | 未知用户/停用/错密/无 assignment 统一 401 同文（防枚举恒时）；authority 故障 503 AUTHZ_UNAVAILABLE 不伪装 401；login.success/failure 落 audit_logs（best-effort）；authEpoch 不符→401、DB 错→500、loader 抛错→503，绝不回退 users.role；exam-list COUNT+page 同 WHERE、Teacher SQL 侧 pre-pagination；语句计数=1(scope)+2(page+count)+1(enrollments)+Σ(每考试 2N) | request+handler span；db.statement（role=root，全部 SELECT 与 audit INSERT）；db.transaction（仅 PATCH /me/password 走 executeInTransaction）；histogram（仅 otlp）；security.authentication 结构化日志 7 分支（auth.ts:154,192,258,296,312,362,402）；auth.role_drift（plugins/auth.ts:192-201）；logout.invalid_token | auth.test.ts:46-870（含 epoch R1-R3 :740-870）；exam.test.ts:85-98 + teacher scope 用例；teacherCourseAssignmentRepo.test + teacherCourseMatrix.test；otelDbTelemetry.test.ts（REALITY §0.2 记 10 passed 转引）；telemetrySignals（合成路由） | TEST_ONLY | G1 G2 G3 G5 G6 + 无认证计数 metric（401/403/503 分布无聚合序列）+ N+1 放大无每请求 span 上限护栏 | high | medium |
| W02 | 考生开始考试（POST /attempts/:examId/start，新开/续考/恢复） | attempts.candidate.ts:666（preHandler authenticate+requireExamEligibility :669-675）→span exam.attempt.start :716→executeInTransaction :721-775（types.ts:221-279，40001/40P01 整事务重试+退避）→attemptCommands.ts:279 startOrRestoreAttempt（lockEnrollment :304、锁下重读 :364、admission consumeActive :520、INSERT exam_attempts :496、enrollment update :537）→201 new/200 restored（:799-814） | 201/200+LoadAttemptResponseSchema；span exam.op.result∈{new_attempt,restored}；事务计数=1 logical+1..4 attempt+N statement 且 submissions==settles（benchmark.test.ts:210-226 已钉，转引）；双击 start 仅 1 个 active attempt（candidate-start.test.ts:55）；4xx→span rejected+error_code 零 mutation；无 audit（持久化终态即凭据，grep 零 audit 引用） | exam.attempt.start（attempts.candidate.ts:716；词汇 start=:28〔抽查✓〕）；db.transaction(.attempt)（transactionSeam.ts:132/158）；db.statement；histogram；pino transaction retry warn（types.ts:262-265）+transaction.retry event | businessOperationSpans.test.ts:331-351（start span：仅 201/new_attempt 路径）；candidate-start.test.ts:36-229；startCloseConcurrency.test；attemptCommands.test；telemetrySignals:159-206（REALITY §0.2 记 5 passed 转引）；e2e candidate-happy-path:29-61 | TEST_ONLY | G1 G3 G5 G10 G7（restored 分支无 span 断言；db span 挂业务 span 父链仅 submit 用例断言） | medium | medium |
| W03 | 答案保存 accepted=true（版本化幂等保存接受路径） | attempts.candidate.ts:1014-1020（authenticate+requireOwnAttempt）→span exam.attempt.answer_save :1055-1061（client_seq 属性）→executeInTransaction :1063（repeatable read）→lockSeam.ts:68 EA 能力锁→deadlineReconciliation.ts:345→answerProtocol.ts:379 saveAnswer（P1 快照校验 :414-421、replay receipt :430、幂等重放 :209-231、STALE_VERSION :238-248、FUTURE_VERSION :255-265）→UPDATE answers :477-480+INSERT receipt :481-484 同协议提交同滚（:466-470）→attemptRepo.ts:244-259→200 {accepted:true,serverVersion+1,savedAt} :1188-1194 | serverVersion=旧+1、savedAt=服务端单点时钟；accepted NEW ≥4 语句、恰 1 UPDATE+1 INSERT 同事务（崩溃窗口=0）；幂等重放零写仍 accepted（saveAnswerReceipts.test.ts:63）；rejected→200 accepted:false+恰 1 WARN+零写；span 无法区分 new-accept 与幂等重放（均 success/accepted） | exam.attempt.answer_save（:1055；词汇 answer_save=:30〔抽查✓〕，ATTR_OP_CLIENT_SEQ=:71〔抽查✓〕）；db.transaction(.attempt)/db.statement；histogram；"Answer save rejected" WARN（:1206-1220）；transaction retry | businessOperationSpans:353-404（accepted+STALE 两态 span）；candidate-save-submit.test（48 it，含 rejected WARN 断言 :621-626,670）；answerProtocol.test（35 it）；saveAnswerReceipts.test（8 it）；requestIdSaveRejection.test.ts:170；otelDbTelemetry（10 passed 转引）；e2e happy-path/refresh-during-exam | TEST_ONLY | G1 G3 G5 G10 G7（重放接受无 span 级断言；span 无 zero-write 标记）+ NOOP histogram 每 settle 仍分配标签（otel index.ts:207-214）；W7.2 实测 On/no-export CPU 中位 +10.4% 超 ≤5% 预算→生产 NO_GO（PR #980，REALITY §8.2 转引） | high | medium |
| W04 | 答案保存协议拒绝面（stale/重放/CONFLICTING_PAYLOAD 等） | 同 W03 入口；决策核 processSaveAnswer answerProtocol.ts:137-288（ATTEMPT_CLOSED :150/ALREADY_SUBMITTED :159/DEADLINE_EXCEEDED :173/INVALID_ANSWER :189/幂等重放 :209-222/CONFLICTING_PAYLOAD :223-231/STALE :238-248/FUTURE :255-265）→200 value-shaped rejected（:1221-1231，仅 STALE 附 details.serverAnswer）；WARN :1206-1220；无持久 refusal（#861 有意决策） | 拒绝一律 200 accepted:false+reason∈SaveAnswerRejectReasonEnum（contracts/src/attempt.ts:50），无 4xx；重放=同 clientSeq 同 canonical identity→accepted 零写、异 payload→CONFLICTING_PAYLOAD；每拒绝恰 1 WARN 且 reqId==x-request-id（#924）；value-shaped 拒绝不设 span ERROR、无 error_code；thrown 4xx AppError→rejected+error_code | exam.attempt.answer_save（outcome=rejected+result=reason）；"Answer save rejected" WARN（唯一持久面之外的痕迹） | businessOperationSpans:353-404（STALE span 形态）；candidate-save-submit:491,591-593,618,645-674,1311-1328；requestIdSaveRejection.test；saveAnswer.test/answerProtocol.test/saveAnswerReceipts.test/saveAnswer.timingModes.test（engine 层）；answerSaveReceiptSummary/richAnswerProtocol/deadline-race | TEST_ONLY | G1 G5 G7 + 其余 5 拒绝原因（CONFLICTING_PAYLOAD/FUTURE_VERSION/DEADLINE_EXCEEDED/INVALID_ANSWER/ATTEMPT_CLOSED）无 span 级断言；拒绝仅有 WARN+span 可对账（无持久 audit，#861 有意） | high | low |
| W05 | 考生主动 Submit+Grade 编排（freeze barrier 单事务 + pending_manual 人工评分） | POST /attempts/:id/submit attempts.candidate.ts:1241-1258→span :1279→submitAndGradeAttempt.ts:54-263（单事务 freeze barrier :62 ADR-008；幂等闸已 graded 零写零 audit :93-95；submitted crash-recovery 补 grade :100-104；reconcile :157；submitAttempt attemptCommands.ts:578-660；recordAtomicHttpAudit attempt.submit :191-197；finalizeGrading grading.ts:360）→200 ‖ POST /admin/attempts/:id/grade-question gradingQueue.ts:307-333（requireScopedCapability）→span exam.attempt.grade :380→manualGrading.ts:89→audit grading.score_entered(+fullyGraded 追加 grading.finalized) :426-448→200 | fresh submit 恰 1 事务=attempt UPDATE+audit INSERT 1 行+workset 物化+（无主观题）终态 UPDATE；重复 submit alreadyGraded=true 零写零 audit；并发 saveAnswer 被状态翻转后 ATTEMPT_ALREADY_SUBMITTED 拒绝；grade-question=1 事务+1-2 audit；auto_graded 评分→409+span rejected+error_code=INVALID_STATE_TRANSITION（businessOperationSpans.test.ts:548-553 实证，转引） | exam.attempt.submit（:1279；词汇 submit=:32〔抽查✓〕）、exam.attempt.grade（gradingQueue.ts:380；词汇 grade=:34〔抽查✓〕）；db.transaction 父链挂 submit span（businessOperationSpans:406-442 断言）；audit_logs 行 | businessOperationSpans:406-442,520-602；candidate-save-submit:847（FIX-2 幂等）,911（retry-grading）；candidate-submit-rollback.test；gradingConcurrency/manualGradingClosure/gradingQueue.test（37 用例）；manualGradingCompletion/Hold/gradingScoreIdentity/attemptCommands（engine 层） | TEST_ONLY | G1 G5 G7 G9 + 幂等重放/crash-recovery 分支无 span 区分（outcome 恒 success 无 result）；内嵌 deadline reconcile 无独立观测点（有意单一测量 :1275-1278）；audit 回滚路径无专项断言；freeze barrier 单事务持 Attempt 行锁的锁集中风险（业务锁，非遥测） | high | medium |
| W06 | 考试中断与 Restore（心跳超时→disrupted→restore 恢复 / take 读时冻结） | heartbeat.ts:342 setInterval→cycle span exam.loop.heartbeat :359→scanForDisruptedAttempts :113→markAttemptDisrupted :175→markDisrupted attemptCommands.ts:751（FOR UPDATE :760、episode create :795、detected 事件 :798、status→disrupted :814）；恢复 POST /attempts/:id/restore attempts.candidate.ts:1378→span :1409→executeInTransaction :1413→lockEnrollmentAndAttempt :1430→restoreInterruption.ts:233（身份校验 :307-343、bounded_grace 补时+幂等 :363-429、strict/operator_incident 零补时 :430-445、过期→deadlineReconciliation.ts:168 终态化）→200 RestoreAttemptResponse :1485；take 读时冻结 :904/:949（同 W08） | restore 200 {lifecycle∈restored/already_in_progress/terminal, compensation}；bounded_grace 恰 1 条 attempt_time_adjustments、重放复用同一 adjustmentId；恢复时已过期→submittedAt=effectiveDeadline+reason=deadline 同事务冻结；restore/take 的 audit_logs 恒 0 行（auditPolicy.ts:251-256 AttemptRestore=deprecated/domain_history，有意）；审计替代=interruption episodes/events 每 episode 恰一 outcome+occurredAt clamp | exam.attempt.restore（:1409；词汇 restore=:36〔抽查✓〕）、exam.attempt.deadline_reconcile、exam.loop.heartbeat；db.transaction(.attempt)/statement；exam.loop.* metric（仅 otlp）；"Marked stale exam attempts as disrupted" 聚合日志（heartbeat.ts:375-381） | businessOperationSpans:444-466（restore span）、:468-518（reconcile 双态）；candidate-save-submit:1429-1542；restoreInterruption.test:381-673；attemptCommands.test；crashAtomicity.test:518-664；heartbeat.test；candidate-take.test:38-224；candidateRuntimeAuthority.test:317；e2e refresh-during-exam:99-151 | TEST_ONLY | G1 G3 G5 G10 + markDisrupted 无独立业务 span（词汇外，仅 cycle span+聚合日志）；restore/take 无 current audit（domain_history，非缺陷）；故障注入证据止于测试层（PR #980 SKIPPED 形态） | high | medium |
| W08 | Take 页面 Deadline Reconcile（GET take 快照内读时冻结） | web TakeExamPage.tsx:575→GET /candidate/attempts/:id/take attempts.candidate.ts:869-887→span exam.attempt.deadline_reconcile :904-906→executeInTransaction :908→deadlineReconciliation.ts:168（Exam FOR SHARE :222→isAttemptDeadlineExpired :229 唯一到期裁决→submitAttempt :252-263（submissionReason=deadline, submittedAt=effectiveDeadline）→finalizeGrading :283）→200 CandidateTakeSnapshot+Cache-Control no-store :1003-1005，exam.op.result=frozen|unchanged :961-966 | 冻结时 submittedAt=computeEffectiveDeadline（业务 deadline 非读时刻）；已 submitted/graded 幂等不变；每请求恰 1 事务（repeatable read，40001/40P01 整事务重试）；audit_logs 中 attempt.autoSubmit 恒 0 行（auditPolicy.ts:324 deprecated，零写点）；clientSeqByQuestion=receipt MAX(clientSeq) 种子；未到期 result=unchanged、到期 result=frozen | exam.attempt.deadline_reconcile（词汇 deadline_reconcile=:42-43〔抽查✓〕）；db.transaction(.attempt)/db.statement；histogram；pino 请求行（server.ts:137-148〔抽查✓ genReqId/serializers〕） | businessOperationSpans:468-490（unchanged）、:492-518（frozen）、:233-328（helper 5 形态）；candidate-take.test:37-227（无 reconcile 显式断言，grep 'reconcil' 0 命中）；candidate-take-temporal-sampling/deadline-reconciliation-interruption-temporal/candidate-deadline-authority.concurrency（命中未逐行读）；lock-order/deadline-authority 结构钉 | TEST_ONLY | G1 G3 G4 G5 G10 + take 特定 rejected/exception 分类（404 ownership :967-969、并发重试）无 take 端到端 span 断言（helper 级已测）；candidate-take.test 不含 reconcile 断言 | high | medium |
| W09 | 后台 Deadline Auto Submit（deadline_scanner 循环） | setInterval deadlineScanner.ts:485（默认 30s，settings.ts:743-746）→cycle span exam.loop.deadline_scanner :404-408（自根 parentSpanId=null）→discovery organizationRepo.list :417+listDeadlineCandidates :432→autoSubmitAndGrade :442→span exam.attempt.deadline_auto_submit :227-229→executeInTransaction :231→EA 锁 :249→Exam FOR UPDATE :262（对 extendExam 序列化点）→isAttemptDeadlineExpired :274-283（唯一裁决，stale→no_op）→submitAttempt :350-366（source=deadline_scanner）+gradeAttemptIdempotent :371-378→result=submitted|skipped、outcome no_op :385-390 | submittedAt=computeEffectiveDeadline；stale discovery=合法 no_op 非拒绝；extendExam 竞态两线性化均合法（T7 负例 :361）；audit_logs 中 attempt.autoSubmit 恒 0 行（负例 :171-265）；每 tick 恰 1 rooted cycle span+N 业务 span 父=cycle、cycle.count/work.count 投影 ScanResult（backgroundLoopSpans.test.ts:481-540 断言，REALITY §0.2 记 13 passed 转引）；每候选恰 1 事务 | exam.loop.deadline_scanner、exam.attempt.deadline_auto_submit（词汇 auto_submit=:45-46〔抽查✓〕）；db.transaction(.attempt)/statement；exam.loop.cycle.duration/count+work.count（backgroundLoopSpan.ts:84-96,127-152，仅 otlp 真序列）；3 类日志（per-candidate error :445-453、有产出 info :508-515、tick throw :517-519）+operability.* 进程内告警 | backgroundLoopSpans:481-540,598/629/671/708（quiet/全失败/exception 投影）；businessOperationSpans:708-762（直调 self-rooted+no_op）；deadline-scanner.test:35-520；deadlineScanner.test:29-230；lock-order/deadline-authority 结构钉 | TEST_ONLY | G1 G3 G4 G5 G10 + setInterval 真实 tick→cycle span 接线无 span 级测试（遥测测试直调 scan/autoSubmitAndGrade）；单候选 exception 组合未单独钉 | medium | low |
| W10 | Heartbeat/Disruption/Incident（心跳保活→后台 disrupt→System incident 对账→restore） | ①POST /attempts/:id/heartbeat attempts.candidate.ts:1310→refreshLastActivityIfInProgress attemptRepo.ts:476（greatest 单调 :464-472）→200 {ok,serverNow} :1358（状态已变→409 :1352-1356）；②tick heartbeat.ts:342→cycle span :359→markDisrupted attemptCommands.ts:751；③同 tick incident 腿 :387→reconcileSystemIncidents systemIncidentDelivery.ts:134（账本读 attemptInterruptionEventRepo.ts:187+仲裁探针 incidentRepo.ts:347+isMatchingCommittedOperation :177-185）→createSystemIncidentFromHeartbeatEpisode systemIncidentCommands.ts:145（preReadOperationId replay :235-238）+recordAtomicSystemAudit :77-87；④restore :1378（同 W06） | serverNow==路由单次 fastify.now()（ADR-006）；last_activity_at 单调不减、非 in_progress→409 且 0 行更新；每 stale attempt 恰 1 episode+1 detected（detection_source=heartbeat_timeout，缺快照 fail-closed :787-792）；每已提交 episode 恰 1 System incident、重复 cycle 只 replay（C1/C2）、人机撞占→conflict 计数+error 日志（C5）；同事务恰 1 atomic audit 行；每 tick 1 rooted cycle span+work 投影（heartbeat allowlist 6 work，backgroundLoopSpans:583-741） | exam.loop.heartbeat、exam.attempt.restore；db.transaction(.attempt)/statement；exam.loop 3 metric；6 类日志（聚合 :375-381、per-attempt :310-313、incident 聚合 :404-411、conflict :414-417、tick throw :443、per-episode/org :240-257）；入站 traceparent 不采信（serverRootPropagator.ts:29-50） | heartbeat.test（插件全分支/stall facts）；attempts/heartbeat.test；heartbeat-lastactivity-monotonicity.test（R-04）；backgroundLoopSpans:583-741；systemIncidentDelivery.test（C1-C6）；incidentOperationRecovery.test（ADR-014§9）；businessOperationSpans:444-465；incidents.admin/proctorRecovery/concurrency | TEST_ONLY | G1 G5 G10 + 心跳 HTTP 路由无业务 span（词汇外）；人驱 incident 命令路由（incidents.admin.ts:473-1252）无业务 span、未单列工作流；每 tick org×listInProgress 全量扫描+每 stale attempt 一事务的开销未测 | high | medium |
| W11 | Client Event Retention（低信任摄入 + 30 天保留清理） | ①POST /client-events clientEvents.ts:65（authenticate-only）→ClientEventBatchSchema :83→prove-or-NULLify 引用信任边界（clientEventReferenceNormalizer.ts:206→loadReferenceEvidence :134 批量归属证明）→createMany clientEventRepo.ts:87（INSERT ON CONFLICT DO NOTHING，根池非事务）→200 accepted=inserted+dedup :142；②retention 插件 runPass clientEventRetention.ts:196（启动即跑 :239+24h interval :241-245）→cycle span exam.loop.client_event_retention :118→cutoff=now-30d :72-76→逐 org deleteOlderThan clientEventRepo.ts:288（走 org_received_at 索引）→countWork(deleted/failed_org) :172-173→outcome :174-179 | accepted==批大小（dedup 计 accepted 防重发循环）；organizationId/userId 来自认证 ctx 非 payload、receivedAt=服务端 now；不可证明引用 NULL 化但 accepted 不减；同 (org,user,eventId) 不重插；30d 严格 <（==cutoff 保留，contract.test :276）；单 org 失败隔离下轮收敛（:356/:418）；重启补偿 startup pass（:432）；删除数==RETURNING==work counter==日志三方一致 | exam.loop.client_event_retention（词汇 retention loop=:62-63，转引）；db.statement（role=root）；request+handler span；exam.loop 3 metric（仅 otlp）；3 类日志（deleted>0 :146-155、单 org 失败 :160-168、tick throw :220-223） | clientEvents.test（最小化 #875/投影 #864/幂等 #863/可写性 #874）；clientEvents.referenceTrust.test；clientEventRetention.test（cutoff/隔离/shutdown join/hung pass）；clientEventRetention.contract.test（边界/补偿/并发/join）；backgroundLoopSpans:742-838 | TEST_ONLY | G1 G5 G8 G10 + 摄入无业务 span 且 handler 无显式业务日志（clientEvents.ts:78-143 无 fastify.log）；保留循环有意无 durable evidence（#544§9 非缺陷）；大表每日 DELETE 锁/IO 形态未测（仅索引静态证据） | medium | medium |
| W12 | Email Outbox（业务事务内 enqueue→in-process loop 投递→SMTP→所有权栅栏终态） | 4 个 enqueue 业务事务：password-reset auth.ts:859→outbox.create :960-968+audit :970-976；invitation invitation.ts:66→:121-128+audit :129-135；publish-results exam.ts:1856→notificationService.ts:143-158（发布事务内）；enrollments exam.ts:2060→:310-326 ‖ 后台 emailOutboxLoop.ts:128-187（supervised :190-207、有界关机 :209-250）→cycle span exam.loop.email_outbox :135→processDueEmails outboxService.ts:74-194（claimDue CTE FOR UPDATE SKIP LOCKED emailOutboxRepo.ts:252-278→sender.send :100-105→markSent :327-355/markRetryWait :367-396（指数退避 retryPolicy.ts:15）/markDead :407-435；poll 前 recoverAbandoned :293-317）→SMTP nodemailer net/tls（senders.ts:146-152；三态 disabled/fake/smtp :226-258）；worker_heartbeats 心跳（:73-89）；诊断面 system.ts:53,124,136,498 | enqueue 与业务行+audit 同事务原子（identityLifecycle.test.ts:59-68 转引）；状态机 pending→processing→sent（provider_message_id/sent_at 落库）；attempt_count≤max_attempts、lastError 脱敏、next_attempt_at 指数退避；每 poll 恰 1 claim 事务+1 recover+逐行 finalize+1 心跳 upsert；死信 error 行不含收件人/正文（outboxService.test:375-449）；所有权丢失计 ownershipLost 不计 success（:114-120）；⚠ 生产 auditEmitter 未接线（emailOutboxLoop.ts:106-119 不传） | exam.loop.email_outbox cycle span（自根）；db.statement/transaction(.attempt)；exam.loop 3 metric（仅 otlp）；pino loop/死信日志（emailOutboxLoop.ts:121-181+outboxService.ts:139-146）；SMTP 无 span/metric | emailOutboxLoop.test:175-224；outboxService.test:105-507；emailOutboxRepo.test:760,816（SKIP LOCKED 并发）；backgroundLoopSpans:839-1010（真 loop 进程内）；serverTelemetryWiring.structural:250,263；identityLifecycle:47-68,535-539；senders.test（无网络）；e2e identity-lifecycle:18-67（不经 SMTP，spec :13-15 归属注释） | TEST_ONLY | G1 G5 G10 + 生产 auditEmitter 死缝（email.send_failed/send_retried 仅测试装配）；SMTP 无专属 span/metric（时延只能 cycle 内时窗推断）；独立 worker 进程 emailDeliveryWorker.ts 全文无遥测 init（读码确认）；e2e 不驱动真实投递；无 email 业务 span（设计：loop cycle+work 计数承担） | high | low |
| W13 | 服务端 outbound HTTP / 外部依赖 | N/A——负证据 grep（apps/api/src、apps/web/src、packages/{db,domain,contracts,otel-drizzle-postgresjs}/src 排除 *.test.ts）14 行命中全非业务出站 HTTP（浏览器侧 fetch×3、ioredis connect/disconnect、测试 harness）；服务端唯一出站 HTTP=遥测 OTLP exporter 自身（runtime.ts:373-394，基建非业务）；HttpInstrumentation 已装 outbound-only（sdkBundle.ts:203-208）但业务零调用 | N/A（NOT_IMPLEMENTED=有意边界，AGENTS.md §1 LAN/on-premise/离线）；未来引入时应核对：响应状态+业务持久化+outbound client span（已就位）+W3C inject 传播（sdkBundle.ts:187-195） | 无 | 无 | NOT_IMPLEMENTED | 相邻缺口：Redis（ioredis redisRuntime.ts:1）作为 TCP 外部依赖无 OTel span/metric，仅 4 条状态日志（:293,372,407,420）——按 ask 口径不展开；运行态网络面核验留 Stage G | low | low |
| W14 | HTTP 失败路径遥测（404/4xx/5xx/取消与超时） | request root（server.ts:167-169〔抽查✓〕；@fastify/otel index.js:429-445 创建，转引）→分支A 404：apiSurface.ts:106/rootNotFoundBoundary.ts:10-15/staticFrontend.ts:76，finalizeNotFoundSpanHook 仅写 status_code 不置 ERROR（index.js:466-481）；分支B 4xx：AppError→classifyRejected（businessOperationSpan.ts:133-148〔抽查✓ 4xx→rejected+error_code〕）→setErrorHandler errors.ts:90（Zod :93-104/AppError :106-111/generic 4xx :112-117/SQLSTATE 23505·40001→409 :118-122）；分支C 5xx：recordErrorInSpanHook（index.js:512-537）→errors.ts:135-138→finalizeResponseSpanHook 补 bare ERROR（:487-510）→scrub 链→exporter；Cancel/Timeout：无 capture（PR #980 W5 行 'nothing implemented'；server.ts:133-154 未配 requestTimeout/connectionTimeout〔抽查✓ 该区间无 timeout 配置〕） | envelope code（RESOURCE_NOT_FOUND/VALIDATION_ERROR/RESOURCE_CONFLICT/INTERNAL_ERROR）+body requestId==x-request-id（server.requestId.test.ts:168）；4xx 零持久化+业务 span outcome=rejected 且 error_code 与 envelope 同源（normalizeErrorCode）；throwing handler→500 恰 1 root span status=error（telemetrySignals:169-177）；错误文本不入 span（exceptionScrub :86-97）；失败语句 span 带 db.response.status_code=40001/23505（otelDbTelemetryRetry:169-201 转引）；取消/超时无 oracle | request span（404 不置 ERROR、5xx ERROR）；9 处业务 span 调用点（〔抽查✓ grep：attempts.candidate.ts:716,904,1055,1279,1409、attempts.admin.ts:209,303、gradingQueue.ts:380、deadlineScanner.ts:227〕）；db.statement；db.transaction(.attempt)+transaction.retry event；Unhandled request error 日志（errors.ts:127-138） | errors.test.ts:58-201（9 例）；telemetrySignals:169-177,136-167,179-206；apiSurface.test:108-227；staticFrontend.test:84-104；server.requestId.test:168,302；serverTelemetryWiring.structural（REALITY §0.2 记 structural+signals 22 passed 转引） | TEST_ONLY | G1 G5 G6 G9 G10 + 4xx root span 不置 ERROR（失败率只能业务 span rejected 推导）；404 scrub 后 url.path=(unrouted) 无法按目标归因扫描流量（隐私取舍，无可观测替代面） | high | low |
| W15 | Exporter/Collector 故障面与 Shutdown 信号 | TELEMETRY_ENABLED+otlp+endpoint 成对守卫 fail-fast（runtimeConfig.ts:776-831）→BSP 2048/5s/30s/512（runtime.ts:100-114；队列满即丢 sdk BatchSpanProcessorBase.mjs:63-76、失败批次不回队 :92-110）→RetryingTransport 5 次（otlp-exporter-base@0.301.2:3；429/502/503/504+网络错）→POST /v1/traces+/v1/metrics（sdkBundle.ts:120-145）→collector（deploy/observability/otelcol.yaml〔抽查✓ 文件存在，行级转引〕：memory_limiter 500MiB、batch 5s/512/1024、tempo sending_queue 2000×4 retry 60s、prometheus metric_expiration 5m、health_check :13133；compose restart unless-stopped）→失败可见性应用层零信号（无 diag.setLogger/setGlobalErrorHandler；dropSpans 接 NOOP meter runtime.ts:380-383）‖ SIGINT/SIGTERM（server.ts:115-116〔抽查✓〕）→close()（auditWrites.stopAccepting :57→app.close :58→drainAuditWrites :62-71）→shutdownTelemetry（runtime.ts:253-315：db 插件 disable :262-268→seam null :269→单一 3s 共享 deadline :278-285→memory JSONL :287-303,449-460→allSettled 双 face :326-337）→业务/readiness/exit code 不变（ADR-028 D1） | healthy collector 两 face 按前缀到达（OtlpExportPaths:62-65）；hanging collector shutdown 返回 2500-3600ms、双 face 到达差<600ms（SlowReceiver:71-85）；trace face 失败不取消 metric face、首 rejection 重抛（Composition:15-55）；collector 宕机业务不变（runbook technical-telemetry.md:289-292+PR #980 4 场景注入，均非本次实测）；事务相位不受 exporter 影响（benchmark:210-214）；memory+TELEMETRY_MEMORY_DUMP_FILE shutdown JSONL witness；SIGTERM bounded exit<5s exit 0（server.shutdown:240,307-312，PG_DESCRIBE 门控未运行）；队列压力/假死稳态无 oracle | telemetry.init_failed（runtime.ts:218-226〔抽查✓〕）/telemetry.db_init_failed（:421-426）/audit.drain_timeout（server.ts:64-70）；后台 cycle span；db span；exam.loop.*+db metric（仅 otlp 真序列）；（缺口）exporter 失败/队列丢弃零应用信号 | telemetryShutdownSlowReceiver:28-89；telemetryShutdownComposition:15-55；telemetryRuntime:37-59；telemetryInitFailure:23；telemetryOtlpExportPaths:29-69；telemetryConfigFailFast:24-133；server.shutdown:240,306-329；shutdown 系列 ask 与 REALITY §0.2 记录均未实跑 | TEST_ONLY | G4 G5 G8 G10 + 队列压力（2048 满）与 collector 假死稳态无测试（PR #980 4 场景未覆盖假死+队列满）；3s deadline 到期放行路径无实测（E10）；DB-death+SIGTERM 形态 SKIPPED；collector 侧为配置审查（validate 声明非本次执行） | medium | medium |

---

## 2. 调用图（文字版）

三条骨架 + 每工作流挂靠点。`db.*`/遥测产生点集中在骨架，避免逐工作流重复。

### 2.1 HTTP 同步链骨架（挂靠：W00 W01 W02 W03 W04 W05 W06③④ W08 W10①④ W11① W12① W14）

```
客户端请求
 └→ [遥测] @fastify/otel request root span（SERVER）
 │    唯一创建：apps/api/src/telemetry/sdkBundle.ts:232-234；注册为第一插件 server.ts:167-169〔抽查✓〕
 │    入站 traceparent 不采信（serverRootPropagator.ts:29-50）；x-request-id 回写 requestIdHeader.ts:34-38
 │    handler 子 span 同插件产出（instrumentHooks:false → 恰 2 HTTP span/请求）
 └→ [限流] plugins/rateLimit.ts:42（默认内存 store；仅 REDIS_MODE=required 走 Redis；
 │    required 且不可用 → fail-closed 503 RATE_LIMIT_UNAVAILABLE，apiSurface.ts:72-86）
 └→ [路由匹配] ──未匹配→ 404 出口（W14 分支A：apiSurface.ts:106 / rootNotFoundBoundary.ts:10-15 / staticFrontend.ts:76；
 │              @fastify/otel finalizeNotFoundSpanHook 只写 status_code 不置 ERROR）
 └→ [认证] plugins/auth.ts:61-208（verifyJWT→users SELECT→authEpoch CAS :123→authority fail-closed 401/500/503）【W01】
 └→ [授权] requireCapability / requireOwnAttempt / requireExamEligibility / requireScopedCapability
 └→ handler
     ├─[业务 span 挂靠点 · 恰 9 处生产调用点，抽查✓ grep 复核]
     │   withBusinessOperationSpan(exam.attempt.*)（helper businessOperationSpan.ts:159-193〔抽查✓〕：
     │   provisional success :174；4xx AppError→rejected+error_code :133-148〔抽查✓〕；其余→exception+ERROR 不落消息；
     │   span 机器损坏→NON_RECORDING 降级 :186-192，业务结果不变）
     │   ├ W02 exam.attempt.start        attempts.candidate.ts:716
     │   ├ W08 exam.attempt.deadline_reconcile  attempts.candidate.ts:904
     │   ├ W03/W04 exam.attempt.answer_save     attempts.candidate.ts:1055
     │   ├ W05 exam.attempt.submit              attempts.candidate.ts:1279
     │   ├ W06/W10 exam.attempt.restore         attempts.candidate.ts:1409
     │   ├ attempts.admin.ts:209,303（time_grant / force_submit，相邻工作流，本次 15 条记录未单列）
     │   ├ W05 exam.attempt.grade               gradingQueue.ts:380
     │   └ W09 exam.attempt.deadline_auto_submit deadlineScanner.ts:227（后台，经 §2.2 触达）
     │   └→ executeInTransaction（packages/db/src/types.ts:221-279；默认 repeatable read；
     │       40001/40P01 整事务重试+20/40/80ms 退避；pino "transaction retry" warn types.ts:262-265）
     │       ├─[遥测] db.transaction span（transactionSeam.ts:132；含 transaction.retry event :184）
     │       │         └─ db.transaction.attempt（:158，每尝试 1 个）└─ db.statement（otel index.ts:243，
     │       │            标签 db.system/exam.db.connection.role/exam.db.outcome[+db.response.status_code]）
     │       ├─[metric] db.client.operation.duration（index.ts:165 创建、:200-215 每 settle 记录〔抽查✓ 创建点〕；
     │       │            仅 exporter=otlp 态为真序列，none/memory 态 NOOP 但仍构造标签对象 :207-214）
     │       └─ 引擎命令（exam-engine：attemptCommands / answerProtocol / restoreInterruption /
     │            manualGrading / deadlineReconciliation / systemIncidentCommands）
     │            + audit 写点：有 audit_logs——W05 attempt.submit/grading.score_entered(+finalized)、
     │            W10 incident atomic audit、W12 enqueue 路由（password-reset/invitation）；
     │            无 audit_logs（设计，域表/receipt 表为凭据）——W02/W03/W04/W06/W08/W09/W11
     ├─[无业务 span 入口 · 词汇外]
     │   W00 探针（apiSurface.ts:50 /health 零 DB、:80 /ready→operabilityMonitor.ts:117→systemStatsRepo.ts:153 pingDb）
     │   W01 auth·exams（auth.ts:119-574、exam.ts:454-536；逐条 root 池语句，login/me/list 零显式事务）
     │   W10① 心跳（attempts.candidate.ts:1310→attemptRepo.refreshLastActivityIfInProgress:476，greatest 单调）
     │   W11① 摄入（clientEvents.ts:65→clientEventRepo.createMany:87，根池非事务）
     │   W12① enqueue 路由（auth.ts:859、invitation.ts:66、exam.ts:1856,2060→outbox.create 同事务+audit）
     └→ [错误出口] errors.ts:90 setErrorHandler（W14 分支B/C：Zod 400/AppError/generic 4xx/SQLSTATE 23505·40001→409/
     │   500 INTERNAL_ERROR + request.log.error）
     └→ [响应] envelope 带 request.id + x-request-id 响应头
     └→ [日志] pino "request completed"（server.ts:146-147 req 序列化为 route 模板〔抽查✓ serializers〕；
         trace_id/span_id 注入 sdkBundle.ts:219 correlation-only；disableLogSending，日志无 OTLP 出口）
```

### 2.2 后台循环骨架（挂靠：W06② W09 W10②③ W11② W12②）

```
setInterval tick（heartbeat.ts:342 · deadlineScanner.ts:485 默认 30s · clientEventRetention.ts:241-245 每 24h+启动即跑 ·
                 emailOutboxLoop.ts:128-187 常驻 poll，supervised）
 └→ withLoopCycleSpan(exam.loop.*)（backgroundLoopSpan.ts:181 startActiveSpan；自根 parentSpanId=null，
 │    名称冻结 backgroundLoopVocabulary.ts:72-77：heartbeat/deadline_scanner/client_event_retention/email_outbox）
 ├→ discovery 只读语句（db.statement span；W09: organizationRepo.list+listDeadlineCandidates；
 │    W10②: organizationRepo.list+attemptRepo.listInProgress——org×全量扫描）
 ├→ per-item executeInTransaction（每候选/每 stale attempt/每 org 恰 1 事务）
 │    业务 span 经 ambient AsyncLocalStorage 自动挂 cycle span 之下（businessOperationSpan.ts:29-34 +
 │    backgroundLoopSpan.ts:22-30）；仅 W09 有业务 span exam.attempt.deadline_auto_submit（deadlineScanner.ts:227）；
 │    W06② markDisrupted、W10②③、W11②、W12② 无业务 span，观测=cycle span+work 计数+结构化日志
 ├→ countWork(exam.loop.work.* allowlist)（backgroundLoopVocabulary.ts:157-179；W12: recovered/processed/sent/
 │    retry_wait/dead/ownership_lost；W10 heartbeat: marked/disruption_failed/incident_created/replayed/failed/conflict）
 └→ settle 边界 recordCycleMetrics（backgroundLoopSpan.ts:127-152；exam.loop.cycle.duration/cycle.count/work.count；
     仅 otlp 态真序列，none/memory 态 NOOP memoized）

W12 专属 SMTP 腿：claimDue（FOR UPDATE SKIP LOCKED）→ SmtpEmailSender.send（nodemailer net/tls，senders.ts:146-152——
                  零插桩，任何 exporter 形态都无 SMTP span/metric）→ markSent / markRetryWait / markDead
W10③ 专属 incident 腿：账本读+仲裁探针（operationId 唯一行）→ createSystemIncidentFromHeartbeatEpisode（replay 幂等）
                       → recordAtomicSystemAudit 同事务审计（systemIncidentDelivery.ts:77-87）
```

### 2.3 遥测导出与关停骨架（挂靠：W15，横切全部工作流）

```
span onEnd
 └→ UrlScrubSpanProcessor.onEnd（urlScrubSpanProcessor.ts:60-74〔抽查✓〕：有 http.route→url.path=route 模板；
 │    无→写 "(unrouted)" 占位，无类型判别 → 全部 db.*/业务/后台 span 被打伪路由属性（G3）；删 url.full/query/search/http.url）
 └→ ExceptionScrubSpanProcessor（exceptionScrubSpanProcessor.ts:80-98：status.message→(redacted)、删 exception.*/error.type）
 └→ BatchSpanProcessor（2048 队列/5s delay/30s timeout/512 批，runtime.ts:100-114；队列满即丢、失败批次不回队，应用层零信号 G4）
     ├─ exporter=off（生产默认）：initTelemetry 早返回 null，零 span/metric（runtime.ts:208〔抽查✓〕）
     ├─ exporter=memory：BoundedMemorySpanExporter ring 1000（boundedMemorySpanExporter.ts）
     │    + shutdown 时 TELEMETRY_MEMORY_DUMP_FILE JSONL 追加（runtime.ts:299-302,449-460）
     └─ exporter=otlp：OTLP/HTTP POST <endpoint>/v1/traces 与 /v1/metrics（sdkBundle.ts:120-145）
          → collector :4318（deploy/observability/otelcol.yaml〔抽查✓ 存在〕）→ Tempo（traces）+ Prometheus（metrics）
          → 仅此形态 metric 面为真序列（runtime.ts:373-394）；collector→Tempo/Prometheus 段属部署面，未运行验证（ADR-028 PROPOSED）
SIGINT/SIGTERM（server.ts:115-116〔抽查✓〕）
 └→ auditWrites.stopAccepting（server.ts:57）→ app.close（:58）→ drainAuditWrites（:62-71，超时 audit.drain_timeout）
 └→ shutdownTelemetry（runtime.ts:253-315：dbTelemetry.disable 还原原型 :262-268→setTransactionSeam(null) :269
     →单一 3s 共享 deadline race :278-285→memory flush+JSONL→composeSdkShutdown allSettled（trace/metric 双 face 互不取消，
       首 rejection 重抛 :326-337））→ 业务结果/readiness/exit code 全不变（ADR-028 D1）
```

---

## 3. 『最坏故障下能否定位』初判

**方法**：每工作流构造一个最坏合理故障场景，按三个部署形态评估定位能力。等级：**A** 可定位（结构化证据可归因根因）；**B** 部分可定位（能发现并缩小范围，根因需推测/旁证）；**C** 仅外部证据（只能靠 DB 终态/主机/部署面推断）；**D** 不可定位（无信号，或信号面自身静默失效）。本节是**初判**：基于记录内证据的推演，非实测复测。

**前提**（证据）：
1. 生产默认 Off〔抽查✓ runtime.ts:208 + server.ts:128-131〕——记录 W00/W01/W11 明确：Off 态整链零 span/metric，生产排障只剩 pino 结构化日志 + x-request-id + audit_logs + 域表/receipt 表；
2. 生产启用被否决：W7.2 实测 On/no-export CPU 中位 +10.4% 超 ≤5% 预算 → NO_GO（PR #980，记录 W01/W03 转引 REALITY §8.2）；ADR-028 PROPOSED + 启用裁决 NO_GO（记录 W08/W11 转引 REALITY §0.3）；
3. On 态已知盲区：G1（无 HTTP request metric）、G3（url.path 污染）、G4（exporter 故障零信号）、G7（重放/恢复分支 span 不可分）、G9（cancel/timeout 无 capture）、G10（metric 仅 otlp 态真序列且远端链未验证）。

| W | 最坏故障场景（初判构造） | 生产默认 Off | On+memory | On+otlp | 最大盲区 |
|---|---|---|---|---|---|
| W00 | DB 慢/降级→/ready 503 翻转、探针风暴 | **B**：503 body gate answer+pino 行+x-request-id；无延迟分布 | **A**：span+histogram 见证 | **A** | budget 内"慢而未超"的 ping 在 Off 态无任何序列可见（G1） |
| W01 | 登录风暴 401/503、exam-list 慢查询 | **B+**：security.authentication 7 分支日志+audit_logs+envelope；时延维度 **C** | **A-** | **A** | 401/403/503 分布与登录速率无聚合序列（On 态也无认证计数 metric）；N+1 慢查询无 metric |
| W02 | start 死锁重试风暴/双击并发 | **B**：transaction retry warn+pino 行+DB 终态 | **A**：span 链+result=new_attempt | **A** | restored vs new 在 Off 态只能 DB 推断；restored 分支 span 断言缺失（G7） |
| W03 | 版本冲突风暴/误拒绝（autosave 失效） | **A-**：WARN 含 reason/serverVersion/clientSeq+x-request-id+receipt 表对账 | **A**（STALE span 形态已钉） | **A** | new-accept vs 幂等重放**任何形态**都不可区分（G7）；保存速率无序列（G1） |
| W04 | 同 W03 拒绝面 + CONFLICTING_PAYLOAD | **A-**：WARN 是唯一服务端痕迹+receipt 表反证零写 | **B+** | **B+** | 7 个拒绝原因中仅 STALE 有 span 级断言；无持久 refusal（#861 有意） |
| W05 | 交卷高峰锁等待/提交超时 | **C+**：audit 行数+DB 终态+409/500 envelope；无时延、无锁等待可见性 | **B+**：span 时长可派生；锁等待仍需 PG 侧 | **B+** | 性能类：所有形态无 HTTP 时延聚合（G1）；长事务 span 线性放大反而增加噪音 |
| W06 | 中断误标/补时争议/恢复丢失 | **B**：attempt_interruption_episodes/events 域证据（detected vs outcome 对）+聚合日志 | **A** | **A** | markDisrupted 无独立业务 span，单 attempt 归因靠域表还原 |
| W08 | 读时冻结争议（谁/何时冻结） | **B**：DB 终态 submittedAt=effectiveDeadline+submission_reason=deadline+pino 行 | **A**：result=frozen\|unchanged | **A** | Off 态无请求级冻结见证；take 的 rejected/exception 无端到端 span 断言 |
| W09 | 扫描停摆/漏提交（tick 不触发） | **B**：per-candidate error+有产出 info+operability.* 进程内告警+DB 冻结行反推 | **A-**：cycle span；metric NOOP | **A** | interval→cycle span 接线无 span 级测试；none/memory 态无 metric 序列（G10）；停摆本身只有"无日志/无冻结行"的缺席证据 |
| W10 | incident 重复/风暴/人机冲突 | **A-**：exam_incidents+events+atomic audit 可对账 C1-C6+per-episode/conflict 日志 | **A** | **A** | 心跳路由与人驱 incident 路由无业务 span；tick 扫描开销未测 |
| W11 | 摄入风暴/清理落后（表膨胀） | **B**：响应 accepted+stdout 日志+DB 行数三方对账；无 durable 台账（#544§9 有意） | **A-** | **A-** | 摄入 handler 无业务日志；Loki leg 禁用（G8）→日志对账只留 stdout 本地 |
| W12 | SMTP 故障积压/死信堆积 | **B+**：outbox 行状态机+死信脱敏日志+worker_heartbeats+/system/diagnostics——Off 态证据面最全的工作流之一 | **A-** | **A-** | SMTP 腿**任何形态**无 span/metric（时延只能时窗推断）；生产 auditEmitter 死缝（email.send_failed/retried 无审计行） |
| W13 | N/A（无出站 HTTP）；相邻：Redis 故障 | **B-**：redis.ready/recovering/unavailable/closing 4 条状态日志 | 同 | 同 | Redis 无 OTel 面（按口径未展开） |
| W14 | 客户端中途断连/请求悬挂 | **C**：应用零信号（响应未完成，无 envelope/pino 完成行之外的证据） | **C**：span 终态 UNKNOWN | **C** | cancel/timeout 全形态无 capture（G9，PR #980 W5 行）；唯一观测束在 OS/反代层，仓库内不可证 |
| W15 | collector 假死+队列满（观测面自身故障） | **D**（无遥测面；业务不受影响） | **D**：应用层零信号，仅 shutdown JSONL witness | **D**：仅 Tempo/Prometheus"数据停止到达"这一部署面外证 | exporter 故障全形态不可定位（G4）；队列压力/假死稳态无测试；3s 到期放行路径无实测（E10） |

**初判结论**：

1. **业务正确性类故障**（状态机、保存协议、幂等、incident 对账）：Off 态大多 **A-/B**——pino 结构化日志 + audit_logs + 域表/receipt 表足以发现且多数可归因；On 态升 **A**。这是当前默认形态下定位能力最好的故障类。
2. **性能类故障**（时延、锁竞争、吞吐）：**所有形态弱**。无 HTTP request metric（G1）；exam.loop.*/db metric 仅 otlp 态真序列（G10）且生产 Off。Off 态只能靠 DB/OS 侧外证（**C**）；On(otlp) 也只能 span 派生（**B**）。
3. **遥测自身故障**（W15）：**全形态 D**。应用层零信号（无 diag、dropSpans 接 NOOP）+假死稳态无测试；唯一进程内 witness=memory 态 shutdown JSONL dump。
4. **客户端断连/取消**（W14）：**全形态 C/UNKNOWN**——capture 未实现（G9）。
5. **总体**：生产默认形态的定位承重面 = pino 结构化日志 + x-request-id + audit_logs + 域表/receipt 表；遥测三态价值边界清晰——memory=诊断见证（ring+dump），otlp=唯一有 metric 序列的形态但远端链未运行验证且生产 NO_GO。最坏组合（collector 假死 + 生产流量异常）下，观测面会先于业务面失效且不可自证（W15 是全清单唯一的 D 级自身故障工作流）。

---

## 4. 高频/性能风险排序

**方法**：基础分 = 频率权重（high=3/medium=2/low=1）× 性能风险权重（high=3/medium=2/low=1）（两字段均来自记录）；同分按记录内的放大器证据排序。**初判排序**（基于记录字段与记录内证据，非实测复测）。

| 排名 | W | 频率 | 风险 | 基础分 | 放大器/依据（记录内证据） |
|---|---|---|---|---|---|
| 1 | W03 答案保存 | high | medium | 6 | 全平台最高频写路径（客户端自动保存）；每 accepted ≥4 语句→≥4 span+record；NOOP histogram 每 settle 仍分配标签对象（otel index.ts:207-214）；**唯一有实测 CPU 数据的工作流**：W7.2 On/no-export CPU 中位 +10.4% 超 ≤5% 预算→生产 NO_GO（PR #980） |
| 2 | W01 认证/考试列表 | high | medium | 6 | exam-list 每页 N+1（每考试 candidates findById×N+1 count，exam.ts:495-513）；认证每请求 2-3 语句；遥测放大器作用于既有查询形状且无每请求 span 数量上限护栏 |
| 3 | W05 submit+grade | high | medium | 6 | freeze barrier 把 submit+snapshot+score+finalize 折进单事务持 Attempt 行锁（submitAndGradeAttempt.ts:36-52），交卷高峰锁竞争集中；长事务上每语句 1 span 线性放大；cancel/timeout 无 capture |
| 4 | W10 心跳/disruption/incident | high | medium | 6 | 每 tick org×listInProgress 全量扫描+每 stale attempt 一事务+incident 腿（记录明示"开销未在本会话测量"）；HTTP 心跳高频 |
| 5 | W08 take 冻结 | high | medium | 6 | 每 take 页加载触发 repeatable read 事务+Exam FOR SHARE 序列化点（deadlineReconciliation.ts:222）；exam 页面为高频读路径 |
| 6 | W06 中断/restore | high | medium | 6 | 与 W10 共享常驻 heartbeat tick；restore 携带补时+冻结写，频率受故障率约束 |
| 7 | W15 exporter/shutdown | medium | medium | 4 | BSP 2048 队列+30s 超时+5 次重试的稳态内存/时延占用；shutdown 3s 共享 deadline；风险主轴是观测面静默失效而非业务 CPU |
| 8 | W02 start | medium | medium | 4 | questionSnapshot 冻结+admission 消费单事务；频率受开考节奏约束 |
| 9 | W11 client-events/retention | medium | medium | 4 | 每日大表 DELETE 的锁/IO 形态未测（仅 org_received_at 索引静态证据）；摄入批量证明 SELECT |
| 10 | W14 失败路径 | high | low | 3 | 错误路径条件性开销；但 404 扫描流量高频穿过 request span+scrub 链 |
| 11 | W12 email outbox | high | low | 3 | 每 poll 1 claim 事务+逐行 finalize；SMTP 腿无插桩故无遥测放大；enqueue 走业务事务（增量 1 INSERT+1 audit） |
| 12 | W00 探针 | high | low | 3 | /health 0 DB、/ready 1 SELECT，设计上最便宜；budget race 恒在但代价有界 |
| 13 | W04 保存拒绝 | high | low | 3 | 拒绝/重放均为零写路径，开销=决策核纯函数+1 WARN |
| 14 | W09 deadline 扫描 | medium | low | 2 | 30s tick，每 tick 每组织 2 类只读 discovery；有产出才写 |
| 15 | W13 outbound HTTP | low | low | 1 | NOT_IMPLEMENTED（有意边界），N/A |

**跨工作流共性放大器**（排序时已计入各行的即来自此处）：
- 全局 On 开销实测：W7.2 On/no-export CPU 中位 +10.4%（PR #980，REALITY §8.2 转引）→生产默认 Off 的根因（对应 REALITY §10 E1 per-signal 成本归因待实验）。
- NOOP 形态仍有分配：none/memory 态 histogram 每 settle 构造标签对象（otel index.ts:207-214；backgroundLoopSpan.ts:69-78,98-101 memoized）——"关导出"不等于"零成本"。
- UrlScrub 对每条 span 无条件写 url.path（urlScrubSpanProcessor.ts:60-74〔抽查✓〕）——成本固定小额，主要风险是 G3 聚合污染而非 CPU。
- 逐语句 span/record 放大既有查询形状：N+1（W01）、长事务（W05）、逐候选事务（W09/W10）均按语句数线性转成 span+record，无上限护栏。

---

## 5. 共性缺口索引（矩阵"缺失"列引用）

- **G1 — HTTP request metric 不存在**：全仓生产 metric 创建点恰 4 处（backgroundLoopSpan.ts:84,89,93 + otel-drizzle-postgresjs index.ts:165）〔抽查✓ grep 复核〕；HTTP/business 时延与计数只能 span 派生；"结构性缺失 vs 有意排除"无裁决（REALITY §6.4、§10 E9）。
- **G2 — 业务 span 词汇覆盖窄**：冻结词汇恰 9 名（businessOperationVocabulary.ts:28-46〔抽查✓〕），生产调用点恰 9 处〔抽查✓〕；W00 探针、W01 auth/exam-list、W10 心跳与人驱 incident 路由、W11 摄入、W12 email 均在词汇外——是否应扩充无裁决记录。
- **G3 — url.path="(unrouted)" 跨类型污染**：UrlScrubSpanProcessor.onEnd 无类型判别，全部非 HTTP span（db.*/业务/后台）被写伪路由属性（urlScrubSpanProcessor.ts:60-74〔抽查✓〕；REALITY §4.3）；按 url.path 聚合产生伪路由桶（下游影响 REALITY §10 E8）。
- **G4 — exporter/collector 故障应用层零信号**：无 diag.setLogger/setGlobalErrorHandler（sdkBundle.ts:244-248 明示不装，记录转引）；BSP dropSpans 接 NOOP self-obs meter（runtime.ts:380-383）；队列丢弃/重试耗尽/collector 假死运行态完全静默（REALITY §4.5、§10 E4 桥接候选）。
- **G5 — 生产默认 Off 且启用被 NO_GO**：runtime.ts:208 早返回〔抽查✓〕+server.ts:128-131〔抽查✓〕；W7.2 +10.4% CPU→NO_GO（PR #980）；ADR-028 PROPOSED。本文所有 span/metric 信号均为 On 态形态，生产当前不存在。
- **G6 — 真实路由×遥测联合断言缺口**：telemetrySignals 的 span 形状断言跑在合成路由 /w12/boom 上；auth/exam 等业务契约测试在 Off 下跑；两条链未在同一条真实请求上闭环。
- **G7 — 幂等重放/恢复分支 span 形态缺口**：new-accept vs 幂等重放（W03/W04，span 无 zero-write 标记）、alreadyGraded/crash-recovery（W05）、restored（W02）无 span 级区分或断言——区分只能靠事务计数+DB 行数。
- **G8 — 日志远端 leg 禁用**：filelog→Loki 合同 PENDING VERIFICATION、必须保持禁用（technical-telemetry.md:36-53，记录转引；REALITY §7.2）；三类信号中日志无远端面，跨进程/跨机对账只留 stdout 本地。
- **G9 — 请求取消/超时 capture NOT_IMPLEMENTED**：PR #980 W5 行原文 "nothing implemented"（记录转引）；server.ts:133-154 未配置 requestTimeout/connectionTimeout〔抽查✓ 该区间无 timeout 配置〕；@fastify/otel 无 abort/destroy/clientError 处理面（记录 grep 0 命中，转引）——断连请求 span 终态 UNKNOWN。
- **G10 — otlp 远端链未运行验证 + metric 真序列仅 otlp 态**：collector→Tempo/Prometheus 段属部署面未验证（ADR-028 PROPOSED + NO_GO，REALITY §0.3）；exam.loop.* 与 db metric 在 none/memory 态为 NOOP（但仍构造标签对象）——缺省 On(none) 部署实际无任何可读 metric 序列。

---

## 6. 本次抽查与未验证清单

### 6.1 本次执行的命令与结果（全部只读；主工作树未修改，写入仅限本审计树指定输出）

1. `ls docs/research/observability-workflow-audit/`（审计树）+ `git log --oneline -1`（两树）→ 目录仅含 REALITY.md；两树同 commit `1d689b4a`；本文件为新建。
2. `grep -rn "withBusinessOperationSpan(" apps/api/src --include='*.ts'` → 生产调用点恰 9 处（gradingQueue.ts:380、attempts.admin.ts:209/303、deadlineScanner.ts:227、attempts.candidate.ts:716/904/1055/1279/1409），与记录一致 ✓（attempts.admin 两处属相邻工作流，15 条记录未单列）。
3. `grep -rn "createCounter(\|createHistogram(\|createGauge(" apps/api/src packages --include='*.ts'` → 生产创建点恰 4 处（backgroundLoopSpan.ts:84/89/93、otel index.ts:165），另有 2 个测试探针，与"G1 恰 4 处"一致 ✓。
4. Read `businessOperationVocabulary.ts` → 9 个冻结名与属性键确认；**行号修正**：answer_save=:30（W03 记录引 :33 偏差）、submit=:32、grade=:34、restore=:36（W10 记录引 :48 偏差）；内容语义一致 ✓。
5. Read `urlScrubSpanProcessor.ts:54-79` → onEnd 无类型判别写 url.path=route 或 "(unrouted)" ✓（G3 成立）。
6. Read `businessOperationSpan.ts:133-148,159-193` → classifyThrown 4xx→rejected+error_code、其余 exception+ERROR；helper provisional success + broken-machinery NON_RECORDING 降级 ✓。
7. Read `runtime.ts:202-228` → `!config.enabled` 早返回 null（:208）+ telemetry.init_failed stderr（:218-226，endpoint 脱敏）✓。
8. Read `server.ts:110-204` → SIGINT/SIGTERM :115-116；fastifyOtelPlugin 第一插件 :167-169；后台插件 :182-186；operabilityMonitor :190；apiSurface /api 前缀 :198；"Default is Off" 注释 :128-131 ✓。
9. `grep -n "^#" REALITY.md`（审计树）→ 被引章节 §0.2/§0.3/§3.2/§3.3/§4.3/§4.5/§5.3/§5.4/§6.4/§7.2/§8.2/§8.5/§10（E1-E12）/§11 全部存在 ✓。
10. `ls deploy/observability/` → otelcol.yaml、otelcol.logs.yaml、prometheus.yml、tempo.yaml、loki-config.yaml、docker-compose.observability.yml(.logs.yml)、grafana/ 存在 ✓（行级内容未复核）。

### 6.2 SKIPPED / UNKNOWN

- **SKIPPED：未运行任何测试套件**。本任务为静态合成；15 条记录 coverage 均为 TEST_ONLY 且各自声明 chunk 未运行；REALITY §0.2 记录的既往实测（22/13/10 passed）为转引，非本次执行。
- **SKIPPED：W07 记录未提供**。ask 声明 16 条，实收 15 条（W00–W06、W08–W15）；W07 内容不存在于输入，本文档不覆盖。
- **UNKNOWN：W07 的去向**（是否并入其他记录/另行审计）——输入内无信息可判。
- **UNKNOWN：断连/取消请求的 request span 终态**（G9；无代码与测试证据）。
- **UNKNOWN："HTTP request metric 缺失是有意排除还是结构性缺口"**（无裁决记录；REALITY §6.4/E9 待实验）。
- **转引未复核**：PR #980 验收表原文；otelcol.yaml/docker-compose.observability.yml 行级参数；node_modules 内 @fastify/otel / otlp-exporter-base / sdk-* 行级；各测试文件内部断言行为（benchmark.test.ts:210-226、telemetrySignals.test.ts 等）——均为分块审计记录转引，本文未逐条打开复核。
