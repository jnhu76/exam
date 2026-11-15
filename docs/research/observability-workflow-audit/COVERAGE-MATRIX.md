# COVERAGE-MATRIX — 观测性工作流 × 必需信号覆盖矩阵（运行时收敛版）

- **产出**：覆盖矩阵综合员（本 campaign 的收敛步骤）。任务：以运行时证据为准，把 `WORKFLOW-INVENTORY.md` 的静态 coverage 收敛为最终覆盖态，并产出 16 条修订 WorkflowRecord（经调度方 schema 返回）。
- **输入**：
  1. 静态清单：同目录 `WORKFLOW-INVENTORY.md`（@`1d689b4a`，其 §6.1 记录了自身抽查命令与结果）；
  2. 运行时证据：ask 提供的 JSON（三族 agent 在本 campaign 内产出）——**业务与HTTP族**（引用格式 `【G族/…】`）、**数据库与事务族**（`【DB族/…】`）、**导出与基础设施族**（`【导出族/…】`）。
- **基线**：`/home/hoo/Source/exam` @ `1d689b4a`（本次 `git log --oneline -1` 复核：`1d689b4a fix(telemetry): stop retaining sql.begin scoped handler closures (#994)`）。
- **性质声明**：本文件是**收敛合成**，不是新的实验报告。全部运行时证据（H2/H3/H4 会话、OTLP sink 解码、故障注入、采样/关停矩阵）为三族 agent 产出、经 ask 输入 JSON 转入；**本合成步骤不重跑注入/导出实验**。v1 版验证：读 `WORKFLOW-INVENTORY.md` 全文；`grep -rn "W07"` 审计树（确认 W07 无任何定义，见 §4）；`grep -n` 抽查关键静态锚点（`sdkBundle.ts:206/219/233`、`runtime.ts:208`、`businessOperationSpan.ts:133`、`transactionSeam.ts:64`、`packages/otel-drizzle-postgresjs/src/index.ts:165`、`urlScrubSpanProcessor.ts:17/35/50-52/66`、`backgroundLoopSpan.ts:171`、`packages/exam-engine/src/{attemptCommands,answerProtocol}.ts` 与 `apps/api/src/plugins/{heartbeat,deadlineScanner,emailOutboxLoop,clientEventRetention}.ts` 文件存在性），全部命中，无幽灵引用。
- **复核轮修订（v2）**：按复核意见修订，全部落盘核实（复核轮独立核实 + 本合成步骤以下命令复现，输出一致）：
  1. run2 dump：`wc -l /tmp/w964-gfamily/h3/telemetry-memory-dump.jsonl` → **781**；`grep -c unrouted` → **695**（修正 v1 的 694 笔误）；`grep -o '"name":"request"[^}]*auth/login'` → **12** 个 login request root。
  2. E1 otlp 保留体全量解码（python3 base64→OTLP/JSON，14 kept bodies）：**836 spans**；`exam.attempt.start`=**0**、`handler - authRoutes`=**0**、/api/exams 路由=**0**；request root 仅 3 条路由（answers/heartbeat/submit）；`exam.attempt.answer_save`=**1**、`exam.attempt.submit`=**1**；`exam.loop.email_outbox`=64、`exam.loop.deadline_scanner`=13、`exam.loop.heartbeat`=13、`exam.attempt.deadline_auto_submit`=2。`report.json` sinkCountersAfterWait：`requests {traces:18, metrics:1}`、`bodiesKept=14`、`bodiesDroppedForCap=5`（**v1 引"19 trace posts/首批 184 spans/save×2"失实，已修正**）。
  3. D1 样本：`grep -n 'params:' /tmp/w964-gfamily/h3/server-out.log` → **:99**，err.message 含全列 SQL **且绑定参数值** `params: 5f4f1b4d-079b-458d-ac20-43af732cc116,bench-\u0000bad`（org ID+用户名；v1"不含绑定参数值"刻画失实，见 GAPS D1）。
  4. W04 拒绝面落盘：`ops-on-dump.jsonl` 含 STALE_VERSION×1+FUTURE_VERSION×1；on-dump dump face（`on-dump/telemetry-memory-dump.jsonl`，**187** spans）含 2 条拒绝行。run2 G4 的 save-stale/save-future 实际命中幂等重放（`ops2b.jsonl` s2/s4 的 `body.accepted` 均 **true**——反常为**两次**未拒，非一次）。
  5. 扫描器缺陷：`analyze.mjs:203` sqlKeywords 模式大写——D1 小写泄漏漏报（`sqlKeywords.log=0` 假阴性）；`analyze.mjs:258` 过滤器要求 span 名含 `POST`+`auth/login` 而 root 实名 `request`——`G9.loginRequestRootSpansInDump=[]` 为坏过滤器伪影，**不作证据**；B1 改用重建口径（本次复现：login incoming=12、持 `request completed` 行=10、缺 completed 的 reqId 恰 2 个 af082ffa/974abd78）。
- **W07 归位修订（v3，2026-11-15）**：调度方补发 W07 定义与 CoverageCheck JSON（8 条 `W07-*` 项 + `D1-STATUS`）后，按 `PROTOCOL-v3.md` §8.3 归位规则（R2-05）落矩阵行；本合成步骤执行了以下独立验证（除注明外 @主仓 `1d689b4a` clean，`git log --oneline -1` 复核一致）：
  1. **静态锚点抽查**（CODE_VERIFIED，全部命中，无幽灵引用）：`grep -n`/`sed -n` 核对 `attempts.admin.ts`（force-submit 路由 :155、time-grants 路由 :243、preHandler `requireScopedCapability(Permission.AttemptForceSubmit/AttemptTimeGrant)` :163-167/:253-257、biz span :210/:304、orchestrator 调用 :216/:310、`no_change` 不变更契约注释 :136-141）；`routeRegistry.ts:518/:530`（auditAction `attempt.forceSubmit`/`attempt.timeGrant`、proctorAccess `admin_only`/`deferred`、migrationStage 7）；`businessOperationVocabulary.ts:38/:40/:61-79`；`forceSubmitExecution.ts`（receipt-first 注释 :22-30、disrupted reasonCode :26-27、23505 恰一次恢复 :33、audit 仅 applied 不变量 :844 区域）；`operatorGrantExecution.ts:344-347`（Incident scope-quadruple，ADR-014 §10）/:543；`operatorGrant.ts:184`（grantAttemptTime，冻结序 1-14 注释，第 5 步 operator_incident 门、第 11 步 closeAt 上限拒绝）/:297-309；`attemptCommands.ts:578`、`grading.ts:411`；contracts `attempt.ts:601`（operationId uuid+reason 1..500 `.strict()`）/:791/:827/:885、`common.ts:65`；`auditPolicy.ts:283-292`（timeGrant 审计 granted-only + adjustmentId 必填 UUID）；`presets.ts:276-277`；`runtime.ts:291-303`（memory dump flush-first 门）；`schema/pg.ts:397`（`exams_interruption_policy_caps_check`）；测试文件 `ls` 在场 + `businessOperationSpans.test.ts:653-704`、`auditPolicy.test.ts:104/:196`、`auditWriter.test.ts:157`、e2e `cross-tab-pending-grant.spec.ts:145`（page.route 截获真实 time-grants 端点）。
  2. **运行产物复核**（/tmp/w07-coverage，campaign W07 会话一次性见证产物）：dump 字节/行数 `wc`：run2=407 行/130303 B、run1=380 行/122401 B（与证据一致）；`node /tmp/w07-coverage/analyze-dump.mjs` 复跑两 dump：run2 `exam.attempt.time_grant`×4 恰=granted/idempotent_replay/terminal/rejected+IDEMPOTENCY_CONFLICT（全 outcome 矩阵）、`exam.attempt.force_submit`×5 恰=applied/idempotent_replay/no_change/rejected+IDEMPOTENCY_CONFLICT/applied(expired)、全部 parentName=`handler - attemptRoutes` 且 parentRoute 恰为其路由、bizSpansWithoutRequestRoot=0、bizSpansWithScrubViolations=0、biz span urlPath=`(unrouted)`（D2 全局缺陷复现）；run1 time_grant×4 全部 rejected+INVALID_STATE_TRANSITION（bounded_grace 策略拒绝链）；granted trace `3f6c8af4…` 构成恰 25 spans（request+handler+biz+db.transaction+db.transaction.attempt+20 db.statement）；`checks.json` 28 项恰 2 fail（tg/fs-conflict-reqid-echo，detail 实证 envelope.requestId==响应头 x-request-id==服务端生成值、≠客户端所发 sent——服务端不采纳客户端 x-request-id，驱动误设非产品缺陷）；`responses.jsonl` 11 条四/五形态对账（force-submit applied resultPayload beforeStatus=in_progress→afterStatus=graded）。
  3. **产品码等价**：`git -C /home/hoo/Source/exam-otel-audit diff 1d689b4a --stat -- apps packages` → **空输出**（审计树被测产品码 = 主仓 HEAD）。
  4. **测试层独立复跑**（当前 SHA）：`pnpm --filter @exam/api exec vitest run src/routes/attempts/businessOperationSpans.test.ts src/routes/attempts/admin-time-grants.concurrency.test.ts src/routes/attempts/admin-force-submit.concurrency.test.ts`（仓库语义命令，API 测试库 testing.md §2.8 契约内）→ **Test Files 3 passed (3), Tests 25 passed (25)**（8.74s；输出尾部 schema drop cascade 为文件级隔离 teardown 通知，非失败）。
  5. **D1 状态 gh 复核**（只读）：与 `D1-STATUS` CoverageCheck 一致，记录见 `GAPS-AND-PRIORITIES.md` §1 修复状态小节。
- **R2-08 拆账落位**：R2-08 finding 原文不在审计树（`PROTOCOL-v3.md:41` verdict 表、`:316` A.6 负证据 grep）；本次按 ask 指令落为 **§5 G4 证据拆账**（campaign 历史证据 vs 当前 SHA 独立验证，各配证据等级），与 v3 §8.3 对 R2-05 的落法同构。四维分账（覆盖普查/实际运行/故障诊断/生产验收）落为 **§2.4**。
- **形态前提**：运行时结论全部限定遥测 **On 态形态**（H2=none / H3=memory / H4=otlp）。生产默认 Off（`runtime.ts:208` 早返回；启用被 W7.2 On/no-export CPU 中位 +10.4% 超 ≤5% 预算 NO_GO，PR #980）——Off 态无任何 span/metric 观察面，本矩阵不对其作运行见证声明。

---

## 0. 覆盖态规则与判定口径

- **FULL_RUNTIME_VERIFIED**：同一工作流满足三证——①**真实运行见证**（真实服务 + 真实流量/注入中观察到该工作流的必需信号）；②**导出见证**（export face：OTLP sink 解码 body 或 memory dump face 确认信号到达导出面）；③**故障定位见证**（该工作流的故障/失败路径被注入或真实触发，且诊断链可归因）。三证缺一 → **PARTIAL_RUNTIME_VERIFIED**。仅有测试断言、无本 campaign 运行证据 → **TEST_ONLY**。产品能力不存在（有意边界）→ **NOT_IMPLEMENTED**（`applicable=false`）。
- 必需信号面取自 WORKFLOW-INVENTORY §1"信号面"列，逐工作流判定。
- **证据等级约定（沿用 `PROTOCOL-v3.md:6`）**：`MEASURED`＝本会话实际执行的命令输出；`CODE_VERIFIED`＝读仓库源码/文档定位；`转引`＝来自既有记录/ask 材料，本会话未复核；`UNKNOWN`＝无法验证，禁止当事实使用。§5 G4 拆账按此给『campaign 历史证据』与『当前 SHA 独立验证』分别配级。
- **四维分账（v3，R2-08 配套；§2.4 落表）**：覆盖态（三证收敛）之外按四个独立维度逐工作流记账——①**覆盖普查完成度**（必需信号面静态普查 + 锚点核对）；②**实际运行覆盖**（三证之①+②：真实运行 + 导出见证的形态矩阵）；③**故障诊断覆盖**（三证之③：故障注入/真实故障 + 诊断链归因）；④**生产验收覆盖**（otlp-face/metric 面、On 态启用判定、部署面/真机/预算）。**四维彼此独立，禁止把 FULL_RUNTIME_VERIFIED 行（三证收敛）推论为整体全面覆盖**：④为全局未验收（On NO_GO、E11/E12/E13 全部缺位，§2.4 全局行），三证 FULL 不改变这一点。
- Gap 五分类（defect / out_of_scope_v1 / evidence_gap / inherent_blindspot / privacy_omitted）定义与汇总见 `GAPS-AND-PRIORITIES.md`。
- Priority = WORKFLOW-INVENTORY §4 高频/性能风险排序的 rank（1 最高）。

---

## 1. 主矩阵（16 行 × 6 信号列 + 覆盖态）

图例：✓=满足；◐=部分满足；✗=未满足/未见证。证据 ID 见文件头引用格式；W07 行证据 = 文件头 v3 归位修订所列 CoverageCheck（`W07-*`）+ 本会话复现命令。

| W | 工作流 | Implemented | Runtime witnessed | Export witnessed | Fault diagnosis | Gap classification | Priority (freq/risk) | 最终覆盖态 |
|---|---|---|---|---|---|---|---|---|
| W00 | 轻量 HTTP 探针 health/ready | ✓（request+handler span `sdkBundle.ts:206,233`；/ready db.statement `index.ts:243`） | ◐【G族/候选缺口4】run2 实测 /api/health、/api/ready 恰 request+handler 两 span 零业务 span；【G族/G1】43/43 请求唯一 SERVER span 覆盖其形态 | ✓（H3 dump face：run2 dump nameInventory 含探针路由——候选缺口4）；OTLP 保留体不含探针路由（仅 3 条 attempts 路由 root，解码复核） | ✗ 503 翻转 / budget race 未注入（Off 态初判 B：503 body+pino） | evidence_gap（故障面）；G1/G3 | 12（high/low） | **PARTIAL_RUNTIME_VERIFIED** |
| W01 | 认证/会话/考试列表 | ✓ | ✓【G族/G4】login 401/200、exam-list 403、NUL 500 分类矩阵；【G族/G6】Login denied WARN trace_id/reqId 逐字节相等；【G族/候选缺口4】词汇外实证 | ✓（**H3 memory dump face**：run2 dump 12 login request root + authRoutes handler span——复核独立核实+本次 grep 复现）。~~E1 otlp sink 解码~~ **原引用不实已撤**：保留体经 sink cap 淘汰不含 login/examList | ✓ 401/500 诊断链运行见证（统一 envelope + WARN 带 trace_id + request span ERROR）；无认证 metric（On 态亦无） | **defect**（G12→D1：日志通道 SQL **及绑定参数值**泄漏，落在本工作流 500 路径）；out_of_scope_v1（无认证/时延 metric、词汇外无业务 span）；evidence_gap（login/examList 的 otlp-face 导出未见证） | 2（high/medium） | **FULL_RUNTIME_VERIFIED**（②经修正后以 H3 dump face 满足） |
| W02 | 考生 start | ✓ | ✓【G族/G2】start×5 业务 span→db.transaction 父链；【G族/G4】corrupt-exam start 500 exception 分类；【G族/G5】start=27 spans breakdown | ✓（H3 dump face：run2 dump start×5——G2）；E1 otlp 保留体 `exam.attempt.start`=0（**v1 的 E1 引用不实，已撤**） | ◐ 500 exception 路径见证；restored 分支 / 双击并发未运行注入 | evidence_gap（restored/并发见证缺）；G7（restored 无 span 断言） | 8（medium/medium） | **PARTIAL_RUNTIME_VERIFIED** |
| W03 | 答案保存 accepted | ✓ | ✓【G族/G2】answer_save×6 父链；【G族/G4】accepted/value-shaped/thrown/exception 全分类；【G族/G5】24-span breakdown；【DB族/FI:40001\|40P01\|rollback\|lockwait】四注入全 PASS | ✓（E1 保留体含 exam.attempt.answer_save**×1**——两次 save 之一；posts=18 trace+1 metric、bodiesKept=14）；【DB族/候选缺口3】H4 `db.client.operation.duration` {error,40001} count=2 真序列（h4-decoded.json 精确复核） | ✓ 40001 端到端（语句 span error+sqlstate→attempt-0→transaction.retry event→逻辑 span unset→2 条 pino warn→直方图 error 桶）；哨兵回滚零写；3s 锁等待 settle 窗实测 2992.4ms | G7（new-accept vs 幂等重放 span 同形，run2 实证）；evidence_gap（2b 两次未拒反常未根因，E9）；NO_GO 上下文（+10.4% CPU） | 1（high/medium） | **FULL_RUNTIME_VERIFIED** |
| W04 | 保存协议拒绝面 | ✓ | ✓ STALE_VERSION/FUTURE_VERSION 落盘于 **on-dump 会话**（ops-on-dump.jsonl c2→STALE_VERSION、c4→FUTURE_VERSION）；CONFLICTING_PAYLOAD/INVALID_ANSWER+thrown 400/409 见证于 run2（G4）；【G族/G6】拒绝 WARN reqId==x-request-id。**修正**：run2 G4 的 save-stale/save-future 实际命中幂等重放（accepted:true，即 E9 反常本体），不构成拒绝见证 | ✓（H3 dump face：on-dump/telemetry-memory-dump.jsonl 187 spans 含拒绝 span——本次 grep 2 条命中） | ◐ 拒绝诊断链（恰 1 WARN+envelope+span result）见证；ATTEMPT_ALREADY_SUBMITTED 未获干净运行证据；2b 两次未拒反常未根因 | evidence_gap（ATTEMPT_ALREADY_SUBMITTED、E9）；G7；无持久 refusal 属有意设计（#861） | 13（high/low） | **PARTIAL_RUNTIME_VERIFIED** |
| W05 | Submit+Grade 编排 | ✓ | ✓【G族/G2】submit×2 父链 | ✓（E1 保留体含 exam.attempt.submit×1——解码复核） | ✗ alreadyGraded 幂等 / crash-recovery / freeze barrier 锁竞争未运行注入；grade leg（gradingQueue.ts:380）未在本 campaign 运行中出现 | G7（幂等/crash 分支 span 无区分）；evidence_gap（grade leg + 故障分支） | 3（high/medium） | **PARTIAL_RUNTIME_VERIFIED** |
| W06 | 中断与 Restore | ✓ | ✓【G族/G2】restore×2 父链；【G族/G4】restored/already_in_progress 结果分类见证 | ✓（H3 dump face：run2 dump restore×2——G2）；otlp 保留体不含 restore | ✗ disruption（markDisrupted）、terminal lifecycle、bounded_grace 补时/重放未运行见证（2b 序列中止于 take-c0002） | evidence_gap（terminal/disruption）；G2（markDisrupted 词汇外） | 6（high/medium） | **PARTIAL_RUNTIME_VERIFIED** |
| W07 | Admin 强制交卷 + 操作员补时（`POST /admin/attempts/:attemptId/force-submit`、`:time-grants`；调度方 2026-11-15 补发定义，inventory §2.1 候选点名转正——W07-STATIC） | ✓（静态普查：路由/registry/编排器/引擎/词汇/契约/审计/测试全锚点命中——W07-STATIC + 文件头 v3 抽查复现） | ✓【W07-RUN-TIMEGRANT/W07-RUN-FORCESUBMIT】两段真实运行（harness 导出驱动，exam_e2e_w964 §2.8 家族槽；被测产品码=主仓 HEAD，文件头 v3-3 diff 为空）：time-grant 合法授予（200 granted+addedSeconds=300+DB deadline 实差恰 +300s+ledger 恰 1 行）/同 opId 重放（idempotent_replay 零写）/异 payload 409（零写）/终态 terminal；force-submit applied（in_progress→graded）/idempotent_replay（resultPayload 逐字节同事实）/no_change（零写，attempts.admin.ts:136-141 契约实测成立）/409（零写）/expired-applied（manual 终态）；run1 bounded_grace 下 4×409 策略拒绝（operatorGrant.ts:297-309 operator_incident 门，INVALID_STATE_TRANSITION）；DB 对账 receipts 恰 3 行全 force_submit、attempt.timeGrant 审计=1（仅 granted）、attempt.forceSubmit 审计=2（恰 2 次 applied） | ✓【W07-EXPORT-H3】H3 dump face：run2 407 spans 中 time_grant×4 恰覆盖全 outcome 矩阵、force_submit×5 全形态（**本会话 analyze-dump.mjs 复现**）；biz span 全部挂 `handler - attemptRoutes` 且 parentRoute 恰配、request root 在场（bizSpansWithoutRequestRoot=0）、scrub 卫生=0；**otlp-face 未运行**（W07-RESIDUAL(e)，E18） | ✓【W07-DIAG】409=IDEMPOTENCY_CONFLICT：envelope.requestId==响应头 x-request-id==pino reqId 逐字节互证 + pino trace_id↔biz span traceId 精确互证 + 冲突后 DB 零写；404/403 信封 + request span（dump 见证，409 request span status=error code=409）；测试层故障注入（23505 竞态恢复）三文件 25/25（campaign 实跑 + **本会话同命令复跑 PASS**） | evidence_gap（残留形态 E17、otlp-face/metric E18）；**D2**（biz span url.path="(unrouted)"，全局已裁决缺陷，两 dump 复现）；观察项：admin 409 无 WARN 级日志（不同于 W04 save 的拒绝 WARN，未裁决为缺陷） | n/a（inventory §4 rank 表未含 W07；admin_only 低频） | **FULL_RUNTIME_VERIFIED**（②经 H3 dump face 满足；残留如实分列，同 W01/W03/W09 先例） |
| W08 | Take 读时冻结 reconcile | ✓ | ✓【G族/G2】deadline_reconcile×1 父链；【G族/G5】unchanged=20 spans breakdown | ✓（H3 dump face：run2 dump deadline_reconcile×1 + unchanged breakdown——G2/G5）；otlp 保留体不含 take 路由 root | ✗ frozen 形态未运行见证（本 campaign 冻结走 W09 扫描器，非 take 读时）；404 ownership 未注入 | evidence_gap（frozen/rejected 端到端）；G7 | 5（high/medium） | **PARTIAL_RUNTIME_VERIFIED** |
| W09 | 后台 Deadline Auto Submit | ✓ | ✓【G族/Deadline自动提交观察】HTTP start→回拨 deadline→3.0s 内 DB graded + span outcome=result=submitted、attempt_id 一致；【G族/G2】auto_submit 挂 cycle 父链；真实 setInterval tick→cycle span 接线运行级闭环 | ✓（E1 otlp 保留体解码 exam.loop.deadline_scanner×13 + exam.attempt.deadline_auto_submit×2）；【DB族/候选缺口3】H4 `exam.loop.work.count` deadline_scanner/submitted=1 真序列 | ✓ 注入故障（错过 deadline 的 in-progress attempt）端到端定位 + 终态/属性/metric 三方对账（复核轮判定三证完整） | evidence_gap（tick-throw/per-candidate-error/quiet no_op 形态、skipped 结果未见证）；G10 | 14（medium/low） | **FULL_RUNTIME_VERIFIED** |
| W10 | Heartbeat/Disruption/Incident | ✓ | ◐【G族/候选缺口4】heartbeat 路由 200 仅 2 HTTP span 零业务 span（词汇外实证）；【导出族/E2】heartbeat cycle×2 自根 | ✓（E1 otlp 保留体解码 exam.loop.heartbeat×13 + heartbeat 路由 request root）；【DB族/候选缺口3】H4 work.count heartbeat/incident_created=1（incident 腿 metric 面见证） | ✗ disruption 误标 / 人机冲突（C5）未运行注入；incident 创建仅 metric 面见证，span/日志级未逐条解码 | G2（词汇外）；evidence_gap（disruption/冲突）；tick 全量扫描开销未测 | 4（high/medium） | **PARTIAL_RUNTIME_VERIFIED** |
| W11 | Client Event Retention | ✓（代码+测试锚） | ✗ 本 campaign 零运行证据（三族均未触达 client-events） | ✗ | ✗ | **evidence_gap（整工作流）**；G8（日志仅 stdout 本地）；无 durable 台账属有意设计（#544§9） | 9（medium/medium） | **TEST_ONLY**（维持） |
| W12 | Email Outbox | ✓ | ✓【导出族/E2】email cycle×13 全部自根；【G族/G2】email_outbox×16 cycle 父链；【DB族/候选缺口3】H4 work.count email_outbox/processed+sent=1（真实密码重置邮件经 fake SMTP 全链，fi-run.mjs:301-305/h4-run.txt:11 落盘复核） | ✓（E1 otlp 保留体解码 exam.loop.email_outbox×64 + H4 metric 面） | ◐ 成功投递端到端见证；retry_wait/dead/ownership-lost 故障路径未注入 | **defect**（worker_heartbeats upsert 逃逸 cycle 上下文：E2 中 13 条 root db.statement 恰等于 13 个 cycle，见 GAPS D3）；SMTP 零插桩（词汇边界）；生产 auditEmitter 死缝（inventory 已记） | 11（high/low） | **PARTIAL_RUNTIME_VERIFIED** |
| W13 | 服务端 outbound HTTP | ✗ 负证据（inventory grep：业务零出站 HTTP；唯一出站=遥测 exporter 自身） | n/a | n/a | n/a | 有意边界（LAN/on-premise）；相邻 Redis 无 OTel 面（inventory 已记，按口径不展开） | 15（low/low） | **NOT_IMPLEMENTED**（维持，applicable=false） |
| W14 | HTTP 失败路径 | ✓ | ✓【G族/G1】404 unrouted 恰 1 span 无双根；【G族/G4】thrown 400/409 request span status=ERROR + 500 分类（与 inventory W14 行冲突，见 §3-1）；【G族/取消/客户端中断】两种注入实证取消不可见——**复核重建口径**：dump 12 login request root vs server-out.log 10 条 completed（本次 reqId 交叉复现：incoming 12/持 completed 10/缺 completed 恰 2 = af082ffa、974abd78）；`G9.loginRequestRootSpansInDump=[]` 系 analyze.mjs:258 坏过滤器伪影，不作证据 | ✓（H3 dump face：404 unrouted 形态与取消 span 均在 run2 dump——G1/取消 check）；otlp 保留体不含 404/取消形态（cap 淘汰） | ◐ 4xx/5xx 分类链见证；**cancel/timeout 确认不可诊断**（span+日志双通道静默，运行实证） | inherent_blindspot（取消，运行实证）；privacy_omitted（404 raw path 永不保留→不可归因扫描流量）；**defect（文档）**（inventory W14 "4xx 不置 ERROR" 行与实测不符） | 10（high/low） | **PARTIAL_RUNTIME_VERIFIED** |
| W15 | Exporter/Collector 故障面与 Shutdown | ✓ | ✓【导出族/E4 reject、E5 slow-hang、E6 queue-pressure、E7 memory、SIGTERM 全形态矩阵、E8 配对】 | ✓ E1 healthy 两 face + shutdown flush 到达；E6 全损/静默在接收器侧实证 | ✗（第三证不成立）exporter 自身故障应用层零信号（候选7 FAIL：out+err 日志 telemetrySignalLines=[]；无 diag/dropSpans 面 whatsoever） | out_of_scope_v1（ADR-028 D1 有意 containment）；evidence_gap（queue-level 精确丢弃数不可观测）；精度修正（挂死下整进程 exit 5.10–5.23s，见 §3-4） | 7（medium/medium） | **PARTIAL_RUNTIME_VERIFIED** |

---

## 2. 覆盖升级台账（TEST_ONLY 基线 → 最终态）

基线：WORKFLOW-INVENTORY §1 记录 15 条 coverage 全部为 TEST_ONLY（W13 为 NOT_IMPLEMENTED）。收敛结果（v3 归位后）：**FULL×4（W01/W03/W07/W09）、PARTIAL×10、TEST_ONLY×1（W11）、NOT_IMPLEMENTED×1（W13）**——v1/v2 的 W07=UNKNOWN 占位已由调度方补发定义解除（§4）；FULL 行仅收敛三证口径，不推论为整体全面覆盖（§2.4 四维分账）。

### 2.1 升级为 FULL_RUNTIME_VERIFIED（三证核查）

**W03 答案保存 accepted**
- ①真实运行：【G族/G2】run2/on-dump answer_save×6 全部 parent=handler-attemptRoutes；【G族/G4】accepted、STALE/FUTURE/CONFLICTING/INVALID value-shaped、thrown 400、500 exception 全分类；【G族/G5】accepted save=24 spans 逐 trace breakdown；【DB族】40001（wallMs≈970ms 重试到成功）、40P01（隔离真死锁）、哨兵回滚（零写）、锁等待（3s，settle 窗 2992.4ms）四注入全 PASS。
- ②导出（复核轮修正计数）：【导出族/E1】save accepted 经 otlp sink——posts=**18 trace+1 metric**、bodiesKept=14（cap 淘汰 5），保留体全量解码 836 spans 含 exam.attempt.answer_save×1（两次 save 之一；v1 的"save×2/19 posts/184 spans"表述失实，已撤）；【DB族/候选缺口3】H4 解码 `db.client.operation.duration` 3 条序列含 {transaction,error,40001} count=2（h4-decoded.json 精确复核）；无重复计量等式：records 侧 281 经 metric 精确核实，"statement spans=281" 右侧出自 DB 族报告（h4 span dump 未落盘于本审计树，未独立重解码——如实标注）。
- ③故障定位：40001 全链（失败语句 span error+db.response.status_code=40001 → attempt-0 ERROR → transaction.retry event {failed_attempt:1} → 逻辑 span unset 不误标 → 服务端恰 2 条 "transaction retry" warn → H4 直方图 error 桶）；回滚场景零写由 DB before/after 证实。
- 残留缺口（不降级，如实记录）：new-accept vs 幂等重放 span 形态完全相同（G7，run2 save-accepted-1 与 save-replay-1 实证）；2b STALE/FUTURE **两次**未拒反常未根因（ops2b.jsonl s2/s4 均 accepted:true；"归因同胞争用"为未证实猜想，留 owner 跟进）。

**W01 认证/考试列表**
- ①真实运行：【G族/G4】login 401（错密）/200、GET /api/exams 403、NUL 字节 login 500；【G族/G6】115 条 pino 行 60 带 trace_id，Login denied WARN reqId==x-request-id 逐字节相等；【G族/候选缺口4】词汇外（零业务 span）运行实证。
- ②导出（复核轮修正）：~~E1 otlp sink 解码~~ **撤**——E1 保留体经 sink body cap 淘汰（requests=18 trace+1 metric、bodiesKept=14、bodiesDroppedForCap=5，`otlp-sink.js` cap 淘汰最早 posts 恰为 login/examList 流量），全量解码 836 spans 中 `handler - authRoutes`=0、/api/exams=0，login/examList span 不存在于任何落盘保留体。改引 **H3 memory dump face**（TELEMETRY_MEMORY_DUMP_FILE shutdown JSONL = H3 形态的导出面 witness，`runtime.ts:299-302,449-460`；§0 规则允许）：run2 dump 12 个 login request root + authRoutes handler span（复核轮独立核实 + 本次 `grep` 复现 12）。
- ③故障定位：401 统一 envelope + security.authentication WARN（trace_id+reqId）；500 envelope INTERNAL_ERROR + pino "Unhandled request error" 带 trace_id + request span status=error——失败分类矩阵 G4 判 PASS。
- 残留缺口：无认证失败/时延聚合 metric（G1/候选2，On 态也只能 span 派生）；exam-list N+1 放大；**D1**：日志通道泄漏全列 SQL **及绑定参数值**（server-out.log:99，含 org ID+用户名）落在本工作流 500 路径；login/examList 的 **otlp-face 导出**未见证（H3 face 已满足②，otlp-face 为如实限制）。

**W09 后台 Deadline Auto Submit**
- ①真实运行：【G族/Deadline自动提交观察】HTTP start（bench-c0104）→ 直写回拨 deadline_at=now()-30s（PROTOCOL §4.1 制备）→ 3.0s 内 DB status=graded、submission_reason=deadline；span exam.attempt.deadline_auto_submit outcome=success result=submitted、parent=exam.loop.deadline_scanner、attempt_id 与回拨一致；setInterval 真实 tick→cycle span 接线由此运行级闭环（关闭 inventory 所记"接线无 span 级测试"的运行侧缺口）。
- ②导出：【DB族/候选缺口3】H4 `exam.loop.cycle.duration`×4 序列 + `exam.loop.work.count` deadline_scanner/submitted=1 真实导出并解码；【导出族/E1】sink 解码含 exam.loop.deadline_scanner + exam.attempt.deadline_auto_submit。
- ③故障定位：注入的故障即"错过 deadline 的 in-progress attempt"，端到端（span 属性 + metric 投影 + DB 终态）三方对账一致。
- 残留缺口：tick-throw、per-candidate error、quiet/no_op、skipped 结果形态未见证。

**W07 Admin 强制交卷 + 操作员补时（v3 归位；证据 = 调度方 CoverageCheck `W07-*` + 文件头 v3 本会话复现）**
- ①真实运行：【W07-RUN-TIMEGRANT】两段真实运行（harness 导出驱动，两段真实 H3 boot 于 exam_e2e_w964 §2.8 家族槽；`git diff 1d689b4a -- apps packages` 空=被测产品码即主仓 HEAD——本会话复核）。run2（converge 后 exam 置 operator_incident、grace caps 置 NULL 满足 `exams_interruption_policy_caps_check`，schema/pg.ts:397）time-grant 四形态：合法授予 200 granted（adjustment.addedSeconds=300、DB deadline 前后实差恰 +300s、attempt_time_adjustments 恰 1 行 source=operator）；同 opId 同 payload 重放 200 idempotent_replay（adjustment.id 与首次相同、ledger 仍 1 行、deadline 不变=零写）；同 opId 异 payload 409 IDEMPOTENCY_CONFLICT（ledger 仍 1 行=零写）；终态路径（deadline 回拨后授予）200 terminal（adjustment=null、attempt 终态 graded、submission_reason=deadline、该 opId ledger 0 行）。run1（bounded_grace）4 次 time-grant 探针全 409=策略拒绝链（operatorGrant.ts:297-309 冻结序第 5 步 operator_incident 门），其 H3 dump 4 条 span 全部 outcome=rejected+error_code=INVALID_STATE_TRANSITION（本会话 analyze-dump.mjs 复现）——运行+导出双见证。【W07-RUN-FORCESUBMIT】force-submit 五形态：fresh 200 applied（resultPayload before=in_progress after=graded、DB status=graded 且 submitted_at/graded_at 落库）；同 opId 同 reason 重放 200 idempotent_replay（resultPayload 与首次逐字节相同、receipt 无新行）；已终态上新 opId 200 no_change（before==after==graded，attempts.admin.ts:136-141 "never mutates behind a no_change fact" 契约实测成立）；同 opId 异 reason 409 IDEMPOTENCY_CONFLICT（零写）；过期 attempt force-submit 200 applied（终态 graded、submission_reason=manual，as-observed）。DB 对账：attempt_command_receipts 恰 3 行全 force_submit（applied/no_change/applied，replay 不新增行）；audit_logs attempt.forceSubmit=2（恰 2 次 applied；replay/no_change/conflict 零审计行，与 forceSubmitExecution.ts:844-846 注释一致）、attempt.timeGrant=1（仅 granted，auditPolicy.ts:283-292 granted-only 不变量实测成立）。
- ②导出（H3 dump face；口径同 §0/§2.2 注）：run2 dump 407 spans——exam.attempt.time_grant×4 恰覆盖全 outcome 矩阵（granted/idempotent_replay/terminal/rejected+IDEMPOTENCY_CONFLICT）、exam.attempt.force_submit×5（applied/idempotent_replay/no_change/rejected+IDEMPOTENCY_CONFLICT/applied-expired）；每条 biz span parentName=`handler - attemptRoutes` 且 parentRoute 恰为其路由、同 trace request root 在场（bizSpansWithoutRequestRoot=0）；granted trace `3f6c8af4…` 构成恰 25 spans（request+handler+biz+db.transaction+db.transaction.attempt+20 db.statement）；scrub 卫生 bizSpansWithScrubViolations=0（无 url.full/query/http.url/exception.* 属性、statusMessage 无 SQL 文本）。**otlp-face（H4）未运行**——W07-RESIDUAL(e) 如实残留（同 W01 先例：H3 face 已满足②，otlp-face 为如实限制，不作"已导出"声明）。
- ③故障定位：【W07-DIAG】409 冲突链端到端：`{error:{code:"IDEMPOTENCY_CONFLICT",…}}` 嵌套信封（common.ts:65）＋ envelope.error.requestId==响应头 x-request-id 逐字节相等（tg 409：9633697b-…；fs 409：31b6cf2d-…）＋ pino "request completed" 行 reqId↔trace_id↔span_id 与 biz span traceId 精确互证（granted 请求 reqId=01e403f4↔granted span 所在 trace、200；conflict 请求 reqId=9633697b↔trace_id=7b993fd7…、409）＋ 冲突后 DB 零写；404=RESOURCE_NOT_FOUND、403=PERMISSION_DENIED 信封（发生早于 span 窗：无 biz span，request root span 仍见证，dump 中 404/403 request span code 对应）。测试层故障注入：campaign 实跑三文件 25/25 + **本会话同命令复跑 PASS**（文件头 v3-4），含 23505 (org,operation_id) 竞态恢复（replay vs IdempotencyConflictError 二选一）与 span 形态断言。驱动记录的 2 个 FAIL（tg/fs-conflict-reqid-echo）为驱动误设（服务端不采纳客户端 x-request-id，本会话 checks.json detail 读取确认），非产品缺陷。
- 残留缺口（不降级，如实分列，GAPS E17/E18）：deadline 上限拒绝（operatorGrant.ts 冻结序第 11 步 AttemptDeadlineExceedsExamCloseError）、incidentId scope-quadruple 校验路径（operatorGrantExecution.ts:344-347，本次请求未携带 incidentId）、disrupted attempt 的 force-submit 终态化（forceSubmitExecution.ts:26 reasonCode=admin_force_submit_terminalization，本次仅 in_progress 与过期 in_progress）、并发同 identity 23505 竞态 harness HTTP 级复现（仅有 vitest 并发测试）、otlp-face、业务 metric 面（词汇面 9 span 无 metric 配对；db metric memory 态 NOOP=G10 语义）；D2 url.path="(unrouted)" 适用于 W07 biz span（两 dump 实证，全局已裁决缺陷）。

### 2.2 升级为 PARTIAL_RUNTIME_VERIFIED（缺哪一证；②列已按复核轮修正）

| W | ①真实运行 | ②导出 | ③故障定位 | 缺证 |
|---|---|---|---|---|
| W00 | ✓（候选缺口4：health/ready 2-span 形态） | ✓（H3 dump face：run2 nameInventory 含探针路由）；otlp-face 不含 | ✗（503/budget 未注入） | 故障 |
| W02 | ✓（G2 start×5；G4 500 exception） | ✓（H3 dump face：run2 dump start×5）；otlp-face `exam.attempt.start`=0 | ◐（仅 exception 路径；restored/并发未注入） | 故障（部分） |
| W04 | ✓（on-dump 会话 STALE/FUTURE 拒绝 + run2 CONFLICTING/INVALID/thrown；run2 stale/future 操作=重放非拒绝，已修正） | ✓（H3 dump face：on-dump dump 187 spans 含拒绝 span） | ◐（ATTEMPT_ALREADY_SUBMITTED 未干净见证；两次未拒反常未根因） | 故障（部分） |
| W05 | ✓（G2 submit×2） | ✓（E1 保留体 submit×1） | ✗（幂等/crash/锁竞争未注入；grade leg 未运行） | 故障 |
| W06 | ✓（G2 restore×2；G4 restored/already_in_progress） | ✓（H3 dump face：run2 dump restore×2）；otlp-face 不含 | ✗（disruption/terminal/补时未见证） | 故障 |
| W08 | ✓（G2 reconcile×1；G5 unchanged=20） | ✓（H3 dump face：run2 dump）；otlp-face 不含 take root | ✗（frozen/404 ownership 未注入） | 故障 |
| W10 | ◐（heartbeat 路由形态✓；disruption/incident span 级未见证） | ✓（E1 保留体 exam.loop.heartbeat×13 + 路由 root；H4 work.count incident_created=1） | ✗（C5 冲突/误标未注入） | 故障 |
| W12 | ✓（E2 cycle×13 自根；G2 ×16 父链；H4 processed+sent=1） | ✓（E1 保留体 exam.loop.email_outbox×64 + H4 metric 面） | ◐（成功投递✓；retry/dead/ownership-lost 未注入） | 故障（部分） |
| W14 | ✓（G1 404；G4 thrown 4xx/5xx；取消注入实证盲区，重建口径见 §1 行） | ✓（H3 dump face：404/取消形态在 run2 dump）；otlp-face 不含 | ◐（4xx/5xx✓；cancel=已证实盲区） | 故障（cancel 侧为已证实盲区） |
| W15 | ✓（E4/E5/E6/E7/SIGTERM 矩阵/E8——report.json 落盘复核） | ✓（E1 healthy flush；E6 全损） | ✗（exporter 故障应用层零信号——候选7 FAIL，第三证结构性不成立） | 故障 |

**注（导出证 face 纪律，复核轮）**：memory dump face 按 §0 规则计为导出证（H3 形态的导出面 = bounded memory exporter + shutdown JSONL，`runtime.ts:299-302,449-460`）。E1 otlp 保留体受 sink body cap 限制（bodiesKept=14 / 总 19 posts，`otlp-sink.js` cap 淘汰最早 posts）——保留体"解码不含 X"仅证明落盘保留体不含，**不证明 X 未导出**；任何 sink 引用必须基于全量保留体解码（本次 836 spans），不得引"首批"部分样本。受此影响：W01/W02/W06/W08/W14 的 otlp-face 见证缺失已如实标注（②由 H3 face 满足）；v1 对 W01/W02 的 E1 引用失实已撤。

### 2.3 维持

- **W11 = TEST_ONLY**：三族均未触达 client-events 摄入/retention；无任何运行/导出证据。
- **W13 = NOT_IMPLEMENTED**：业务出站 HTTP 不存在（inventory 负证据 grep）；非缺陷，属 LAN/on-premise 有意边界。

### 2.4 四维分账（v3，R2-08 配套；覆盖态之外逐维记账）

四维定义见 §0。记号：✅=完成/完整；◐=部分；✗=零/缺失；n/a=不适用。本表是既有证据（§1/§2.1-2.3 + W07 CoverageCheck）的**重新组织**，不新增运行声明；每格证据同矩阵行。**本表存在的理由：禁止把 FULL_RUNTIME_VERIFIED（三证收敛）推论为整体全面覆盖**——三证只覆盖②③两维，①是静态普查、④是生产验收，均独立记账。

| W | ① 覆盖普查完成度 | ② 实际运行覆盖（运行+导出见证） | ③ 故障诊断覆盖 | ④ 生产验收覆盖 |
|---|---|---|---|---|
| W00 | ✅ 清单+锚点 | ◐ 2-span 形态 ✓（H3 face）；otlp-face 无 | ✗ 503 翻转/budget race 未注入 | ✗ 未验收；otlp-face 无、metric 无 |
| W01 | ✅ | ✅ 三证口径完整（H3 face）；otlp-face 缺（如实限制） | ✅ 401/500 诊断链 | ✗ 未验收；otlp-face 无、无认证/时延 metric |
| W02 | ✅ | ◐ start×5/500 ✓；restored/双击并发缺 | ◐ 仅 exception 路径 | ✗ 未验收；otlp-face 无 |
| W03 | ✅ | ✅ 完整（含 otlp-face answer_save×1 + H4 metric） | ✅ 40001/40P01/哨兵回滚/锁等待 | ✗ 未验收（otlp-face 有 ≠ 验收；E11/E12/E13 全局缺） |
| W04 | ✅ | ◐ 拒绝面落盘 ✓（on-dump+run2）；ATTEMPT_ALREADY_SUBMITTED 缺 | ◐ 拒绝链 ✓；E9 反常未根因 | ✗ 未验收；otlp-face 无（cap 淘汰） |
| W05 | ✅ | ◐ submit×2 成功链 ✓；幂等/crash/grade leg 缺 | ✗ 未注入 | ✗ 未验收；otlp-face 有（submit×1） |
| W06 | ✅ | ◐ restore×2 ✓；terminal/disruption/补时缺 | ✗ 未注入 | ✗ 未验收；otlp-face 无 |
| W07 | ✅ W07-STATIC 全锚点（本会话抽查复现） | ✅ 三证口径完整（H3 face，全 outcome 矩阵）；otlp-face 缺（E18） | ✅ 409/404/403 链 + 23505 测试注入 | ✗ 未验收；otlp-face 无、业务 metric 无（E18） |
| W08 | ✅ | ◐ reconcile×1/unchanged ✓；frozen/404 ownership 缺 | ✗ 未注入 | ✗ 未验收；otlp-face 无 |
| W09 | ✅ | ✅ 完整（含 otlp-face scanner×13+auto_submit×2 + H4 metric） | ✅ 注入端到端三方对账 | ✗ 未验收（全局同上）；otlp-face+metric 有 |
| W10 | ✅ | ◐ heartbeat 路由/cycle ✓；incident span 级缺 | ✗ C5 冲突/误标未注入 | ✗ 未验收；otlp-face+incident metric 有 |
| W11 | ✅（代码+测试锚） | ✗ 三族零触达（TEST_ONLY） | ✗ | ✗ 未验收 |
| W12 | ✅ | ◐ 成功链 ✓（cycle×13/×16 + H4 metric）；故障腿缺 | ◐ 成功投递 ✓；retry/dead/ownership-lost 缺 | ✗ 未验收；otlp-face+metric 有；D3 碎片化削弱 |
| W13 | ✅ 负证据普查 | n/a | n/a | n/a |
| W14 | ✅ | ◐ 4xx/5xx/404/取消形态 ✓（取消=盲区 B1）；otlp-face 无 | ◐ 4xx/5xx ✓；cancel=已证盲区 | ✗ 未验收；otlp-face 无 |
| W15 | ✅ | ✅ 运行矩阵（E4-E8）+ 导出 face | ✗ exporter 故障应用层零信号（O5 结构性不成立） | ✗ 未验收；E10/E11/E12 直接落在本维 |

**全局行（④的统一上界）**：On 态启用 = NO_GO（+10.4% CPU，PR #980）；Loki leg 合同禁用至真机验收（E11，WSL2 排除）；collector→Tempo/Prometheus 部署面缺失（E12，ADR-028 PROPOSED）；正式预算判定 UNKNOWN（E13）。→ **16 行的 ④ 全部为"未验收"**：FULL×4（W01/W03/W07/W09）只收敛运行级可观测性证据，不构成任何生产验收结论；④的推进以 D1 修复为先决（GAPS §1 修复状态：BLOCKER 存续），先于任何 On 态启用讨论。

---

## 3. 与 WORKFLOW-INVENTORY 的冲突与精度修正（收敛产物，按实测证据裁定）

1. **W14 行 "4xx root span 不置 ERROR" 与实测不符**。【G族/G4】实测 thrown-error 路径的 400（VALIDATION_ERROR）/409（INVALID_STATE_TRANSITION）request span status=**error**；仅 401/403/404 等非 throw 路径保持 unset。inventory 该行应按此修订（失败率可部分由 request span ERROR 推导，与原记载相反）。属**文档缺陷**（GAPS D4）。
2. **§2.2 "discovery 只读语句挂 cycle" 与实测不符**。【G族/G2】run2 19/563 条 db.statement parentSpanId=null 各自成 solo trace（18 根池 role + 1 transaction role，均后台 discovery 逃逸 cycle 上下文）；【导出族/E2】email worker_heartbeats upsert 13/13 逃逸（恰等于 13 个 cycle）。两类同属"非业务 span 传播空洞"缺陷（GAPS D3），inventory 相关记载需修订。
3. **G4 共性缺口 "dropSpans 接 NOOP meter（runtime.ts:380-383）" 与 as-built 不符**。【导出族/候选7】全仓 grep setGlobalErrorHandler/diag.setLogger/dropSpans 零命中——比 inventory 记载更弱：连 NOOP 自观测 meter 钩子都不存在。inventory 该行需按"无任何自诊断面"修订。
4. **W15 "SIGTERM bounded exit<5s" 精度修正**：实测挂死 collector 下**整进程** exit 5.10–5.23s（E5 5104ms / E6 5205ms）；"<5s" 仅对 telemetry composition 单独成立（slow-receiver 单元 oracle ≤3600ms）。非契约违背（#351 30s 预算、compose stop_grace 45s 均满足），表述需按整进程口径修正。
5. **口径澄清（非矛盾）**：W03 oracle "accepted ≥4 语句" 只计事务内协议语句；实测每 accepted save trace 共 19 条 db.statement（含 preHandler/资格读全量）。是放大观察而非重复计数（tx:tx.attempt 严格 1:1，43/43；H4 records==spans 等式）。inventory 记载保留，建议补注口径。（复核轮注：等式右侧 "statement spans=281" 出自 DB 族报告，h4 span dump 未落盘于本审计树未独立重解码；records=281 侧已经 metric 精确核实。）
6. **E1 sink 保留体引用纪律（复核轮修正）**：otlp-sink 有 body cap（E1：requests=18 trace+1 metric、bodiesKept=14、bodiesDroppedForCap=5），淘汰恰为最早 posts（login/examList 流量）。任何"sink 解码含/不含 X"的引用必须基于**全量保留体解码**（本次 836 spans），不得引"首批 184 spans"这类部分样本——v1 的 W01/W02 行即因此失实（已改引 H3 dump face 或撤除），W03 计数已修正（answer_save×1）。
7. **G12 扫描器假阴性（复核轮发现）**：`analyze.mjs:203` sqlKeywords 模式为大写——D1 的小写泄漏（`select "id",…`）不命中，checkpoint `sqlKeywords.log=0` 是假阴性；干净面结论改由复核轮大小写不敏感复验支撑（H4 sink 解码与 H3 明文 dump 对 eyJhbGciOi/select/password/cookie 均 0 命中；`jwtEyJ.sink=5` 为 raw-base64 JSON 结构前缀伪命中，解码后 0）。另 `analyze.mjs:258` 的 login-root 过滤器要求 span 名含 `POST`+`auth/login` 而 request root 实名 `request`，恒不匹配——`G9.loginRequestRootSpansInDump=[]` 为坏过滤器伪影，任何引用不得使用该字段（B1 已改用重建口径，见 §1 W14 行）。

---

## 4. UNKNOWN / SKIPPED 台账（收敛后仍然开放）

- **W07 编号空洞——已于 v3 归位解除（2026-11-15）**：v1/v2 期 W07 定义缺失（`WORKFLOW-INVENTORY.md:5,:239-240`；ask 声明 16 条实收 15 条，本文件旧版 §1 行与 §4 本条以显式 UNKNOWN 占位——`applicable=false` 语义=该编号在当期审计输入中不存在可审计定义，未声称任何产品功能存在与否，也未据 inventory §2.1 的候选猜测填充）。调度方补发定义与 CoverageCheck（8 条 `W07-*` 项）后，按 PROTOCOL-v3 §8.3 归位规则落矩阵行：**W07 = Admin 强制交卷 + 操作员补时**（§1 W07 行 + §2.1 三证核查 + §2.4 四维分账），收敛 FULL_RUNTIME_VERIFIED；静态锚点与运行产物经本会话独立复现（文件头 v3 记录）。inventory §2.1 的候选点名（`attempts.admin.ts:209,303` time_grant/force_submit）与调度方定义一致——候选转正，非推测填充。残留缺口入 GAPS E17/E18。PROTOCOL-v3 §8.3 所记"W07=NOT_APPLICABLE(无定义)"（benchmark workload 语义）自定义补发起被取代；本修订不改协议文件（v3 §8.3 归位规则），仅作收敛输入记录。
- 运行证据缺口（三族 skippedBecause 汇总，均已计入 GAPS）：
  - W06 restore terminal lifecycle（2b 序列中止于 take-c0002，DB 被并行同胞 converge 重置）；
  - W04 ATTEMPT_ALREADY_SUBMITTED 干净证据（run2 脚本 bug 得到的是路径/体不匹配 400，thrown-4xx 形态仍有效）；
  - W03/W04 2b 轮 STALE/FUTURE **两次**未拒反常未根因（ops2b.jsonl s2-stale-seq2-bv0 与 s4-future-seq3-bv99 的 body.accepted 均 true——本次复核读取确认；v1"一次未拒"计数偏低已修正）；
  - run1 作废归档（/tmp/w964-gfamily/run1-invalid/，端口冲突），不用于任何结论；
  - W15 queue-level（2048 满）精确丢弃数不可观测（应用无 drop 计数面）；
  - 候选6 filelog→Loki 真机验收（合同强制禁用至真机验收；本机 WSL2 被合同排除）；
  - collector→Tempo/Prometheus 部署面段（ADR-028 PROPOSED；审计接收器止于 otlp-sink payload 解码）;
  - 协议档正式预算判定（≥6 有效配对 + §6.6-3 oracle 核验）本主机结构性不可行（E8 为探索级配对，n=2，按 PROTOCOL §6.4 保持 UNKNOWN，不声称零成本）；
  - H2 进程内 meter 探针（由代码路径 + E7 运行时等价证明支撑）。
- 跨族环境事实：DB族因共享 slot exam_e2e_w964 被并行活动 re-seed 而改用专用 §2.8 家族 slot exam_e2e_w965（name-guard 与 16-shard 上限不相交）；所有证据库均为 harness 契约内测试库，合成 bench 数据，无真实用户数据进入导出/转储。
- 复核轮确认与未验证项（如实分列）：复核轮已落盘验证为实——三族检查点对应产物（/tmp/w964-gfamily/analysis-summary.json：G1 43/43 traced/multiRoot=0、G6 115 行/60 trace_id、G12 sink unrouted 189/205；/tmp/otel-fi/：fi-isolated-out.txt 真 40P01+57014+哨兵回滚、h3-run.txt:8 注入 40001 wallMs=972 重试成功、h4-decoded.txt durMs=2992.4；导出族 e1–e8 report.json：E5/E6 exit 5104/5205ms、E4/E6 telemetrySignalLines=[]、E7 零请求、E3 ratio-0 spans=0、E1 metric 流恰 4 名无 http.*；W09 三证 inject.mjs:611/inject-run2.log:3 graded waitedMs=3007/H4 work.count；D3 19 根=18 root+1 transaction role、E2 13 root≡13 cycle、emailOutboxLoop.ts:176 位于 withLoopCycleSpan 块外；D4 四条对 inventory :31/:211/:99-102 原文；SKIPPED 项全部可复现）。**仍未验证**：E9 "归因同胞争用"根因猜想（文档自认未证实，复核轮未重跑）；W03 计量等式右侧 statement spans=281（h4 span dump 未落盘于审计树）；三族 ask 输入 JSON 原文（复核以其落盘对应物为准）。

---

## 5. G4 证据拆账（R2-08；campaign 历史证据 vs 当前 SHA 独立验证，各配证据等级）

- **落位声明**：R2-08 finding 原文不在审计树（`PROTOCOL-v3.md:41` verdict 表 + `:316` A.6 负证据 grep——`grep -rn "R2-07\|R2-08\|R2-09"` 零命中）；本节按 ask 指令落法，与 v3 §8.3 对 R2-05 的处理同构；若 R2-08 原文含超出此范围的未闭合面，按 v3 §9.1 第 8 项冻结前义务核对补齐。
- **口径**：矩阵引用的【G族/G4】（结果分类矩阵：401/403/500、corrupt-exam、save value-shaped/thrown、restored/already_in_progress、thrown 400/409 等）全部产自 campaign G 族会话（run1/run2/on-dump）。对本合成步骤而言它们是 **campaign 历史证据**（等级=转引：ask 输入 JSON + /tmp/w964-gfamily 落盘产物，campaign 会话产出）；其中一部分已在复核轮（v2 头记录）或本修订会话（v3 头记录）以命令复现升格为 **当前 SHA 独立验证**（等级=MEASURED）。两级分列如下——引用矩阵行时按本表标注等级，**不得把 campaign 历史证据当作已独立验证**。

| G4 引用点（矩阵行） | campaign 历史证据（等级：转引） | 当前 SHA 独立验证（等级：MEASURED；括注执行会话与命令） |
|---|---|---|
| W01 login 401/200、exam-list 403、NUL 500 分类 | G 族 run2 分类矩阵（ask JSON） | 部分：run2 dump 12 login request root（复核轮 grep 复现，v2 头）；NUL 500 泄漏样本 server-out.log:99（复核轮 `grep -n 'params:'`，v2 头 → GAPS D1）；401/200 分类本体未独立重跑（维持转引） |
| W02 corrupt-exam start 500 exception | G 族 run2（ask JSON） | 部分：start×5 span 在 run2 dump（G2 face）；exception 分类本体维持转引 |
| W03/W04 save accepted/value-shaped/thrown/exception 分类 | G 族 run2 + ops-on-dump/ops2b 落盘（ask JSON） | 部分：复核轮落盘复核（v2 头）——ops2b.jsonl s2/s4 accepted:true（两次未拒反常，E9）、on-dump dump 187 spans 含 2 条拒绝 span（grep 2 命中）；分类矩阵本体未独立重跑 |
| W06 restored/already_in_progress 结果分类 | G 族 run2（ask JSON） | 部分：restore×2 span 在 run2 dump（G2 face）；结果分类本体维持转引 |
| W14 thrown 400/409 request span ERROR + 500 分类 | G 族 run2（ask JSON） | 部分：404 unrouted 恰 1 span 无双根（G1，run2 dump）；取消重建口径（incoming 12/持 completed 10/缺 2）复核轮 reqId 交叉复现（v2 头）；thrown 400/409 status=error 分类本体维持转引 |
| W07（v3 新增，非 G4，同口径拆账）conflict/404/403/409 分类 + 全 outcome 矩阵 | W07 会话 checks.json + responses.jsonl + driver（ask CoverageCheck JSON） | **全部**（本会话，v3 头）：`node /tmp/w07-coverage/analyze-dump.mjs` 两 dump 复现全 outcome 矩阵与 404/403/409 request span 分类；checks.json 28 项/2 fail 读取；三测试文件复跑 25/25（`pnpm --filter @exam/api exec vitest run …`） |

- **拆账结论**：G4 的方向性结论（结果分类可由 span+envelope 双通道观察）在两级证据下一致；但"G4 各分类本体已被逐一独立重跑"**不成立**——除 W07 外均维持转引级，其中复核轮触及的落盘复核点已如实标注。§2.4 四维分账与后续引用一律按本表等级转写；新会话若重跑某项，按 PROTOCOL-v3:6 约定升格并记录命令与输出。
