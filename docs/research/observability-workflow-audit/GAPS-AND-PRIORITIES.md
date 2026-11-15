# GAPS-AND-PRIORITIES — 缺口五分类汇总与优先级排序

- **产出**：覆盖矩阵综合员（收敛步骤）。输入与性质声明同 `COVERAGE-MATRIX.md` 文件头：静态清单 WORKFLOW-INVENTORY（@`1d689b4a`）+ ask 提供的三族运行时证据 JSON（转引，本步骤未重跑实验）；本次实际执行的验证仅为读清单、`grep W07`（确认编号空洞）与静态锚点 grep 抽查（见 COVERAGE-MATRIX 文件头）。
- **结论边界**：全部 gap 判定限定遥测 On 态形态（H2/H3/H4）。生产默认 Off（`runtime.ts:208`；启用被 W7.2 +10.4% CPU NO_GO，PR #980）——任何优化建议必须适配该默认态与 ADR-028 有界 containment，不得以"补全记录/全量采集"为目标（见 §7 non-goals）。
- **复核轮修订（v2）**：按复核意见修正 D1/D2/E9/干净面的证据刻画与计数——复核确认各结论方向均不受影响，但对样本的描述以下列落盘事实为准（复核命令与输出见 COVERAGE-MATRIX.md 头部复核记录）。**审计 harness 口径注意**：otlp-sink 有 body cap（E1：requests=18 trace+1 metric、bodiesKept=14、bodiesDroppedForCap=5，淘汰最早 posts）——"sink 保留体不含 X"仅证明落盘保留体不含，不证明未导出；引用纪律见 COVERAGE-MATRIX §3-6。

---

## 0. 五分类定义与计数

| 分类 | 定义 | 计数 | 编号 |
|---|---|---|---|
| **defect** | 被测系统真实缺陷：违反既有契约/误导下游/泄漏，需要 owner 修复或裁定 | 3 产品 + 1 文档 | D1–D4 |
| **out_of_scope_v1** | 现契约未要求、属产品/架构边界决策；非本次实现缺陷，需 owner 裁定而非默认施工 | 7 | O1–O7 |
| **evidence_gap** | 能力可能存在但本 campaign 未获运行证据；需补测/验收 | 16 | E1–E16 |
| **inherent_blindspot** | 设计内不可见（head sampling 定义、server-span 生命周期收口等），补测无法消除，只能接受或改变设计 | 2 | B1–B2 |
| **privacy_omitted** | 按隐私边界刻意不可恢复的省略；非缺陷，列入声明面以防误判为丢失 | 5 | P1–P5 |

---

## 1. defect（产品缺陷，按严重度排序）

### D1 — pino 错误行泄漏原始 SQL 文本**与绑定参数值**（log 通道）
- **证据**（复核轮按落盘样本修正刻画）：【G族/G12 + 复核轮独立核实】500 路径 "Unhandled request error" 的 `err.message` 为 DrizzleQueryError 消息，含**全列 SQL 文本与绑定参数值**：`Failed query: select "id", "organization_id", "username", "password_hash", … from "users" where …` **加** `params: 5f4f1b4d-079b-458d-ac20-43af732cc116,bench-\u0000bad`（/tmp/w964-gfamily/h3/server-out.log:**99**，reqId=8c8294fb…，NUL 字节登录触发；落点为 W01 登录路径 `userRepo.findByOrganizationAndUsername` ← auth.js:115；stack 含内部文件路径）。**绑定参数值（组织 ID UUID 与用户名）随 SQL 一并泄漏——实际比初版"不含绑定参数值"的描述更严重**。span/导出面干净（各自有 scrub）；日志通道对驱动错误消息无等价脱敏（`logRedaction.ts:12-30` 只删 password/token/cookie 类键）。另：checkpoint 扫描器对该泄漏**漏报**（`analyze.mjs:203` sqlKeywords 模式大写，小写 `select…` 不命中，`sqlKeywords.log=0` 为假阴性）——干净判定不能依赖该扫描器，须大小写不敏感复验（复核轮已做，见 §5）。
- **为什么是 defect**：若以 `docs/contracts/observability.md` 边界为准属真实违反；即使按窄口径，把 users 全列 SQL 与 org ID/用户名绑定值写入通用错误日志也与"统一错误、结构化日志"边界相悖（AGENTS.md §5）。需 owner 裁定日志面是否在契约范围内（见 §6 P1）。
- **影响面**：任何 500（含 W01 登录、W03 保存等最高频路径的 DB 异常分支）；当前生产默认 Off 态**照常发生**（这是 stdout 排障主通道），是本清单唯一"现在就在发生"的隐私类缺陷，且样本实测已含真实组织标识与用户名。

### D2 — `url.path="(unrouted)"` 跨类型污染
- **证据**：静态 `urlScrubSpanProcessor.ts:60-74` onEnd 无类型判别；运行实测 run2 **695**/781 spans（复核轮重数与 G12 checkpoint unroutedBySpanName 求和一致；初版 694 为笔误）、H4 导出面 189/205、E2 980/1000 全部被写伪路由【G族/候选缺口9；DB族/G3 note；导出族/G7 note】。
- **影响**：按 url.path 聚合产生巨型伪路由桶，污染 Tempo/下游查询语义（REALITY §10 E8）。On 态缺陷；生产 Off 态无受害者，但属启用前必须修的正确性问题。

### D3 — 非业务 span 传播空洞（discovery/heartbeat 语句逃逸父上下文）
- **证据**：【G族/G2】19/563 条 db.statement parentSpanId=null 各自成 solo trace（18 根池 role + 1 transaction role，均后台 discovery）——与 inventory §2.2 "discovery 只读语句挂 cycle" 记载不符；【导出族/E2】email worker_heartbeats upsert 13/13 逃逸 cycle span（`emailOutboxLoop.ts:176` writeHeartbeat 位于 `withLoopCycleSpan`(:135-174) 块之后）。
- **影响**：后台故障时 trace 碎片化不可回链（只能按时间窗拼）；不影响业务 span 挂链（21/21 业务 span 零例外）与计量等式（records==spans）。

### D4 — 审计文档缺陷（audit-doc，非产品代码）
- inventory W14 行 "4xx root span 不置 ERROR" 与实测相反（thrown 400/409 request span status=error，仅非 throw 路径 unset）【G族/G4】；
- inventory §2.2 "discovery 语句挂 cycle" 与 D3 实测不符；
- inventory G4 行 "dropSpans 接 NOOP meter（runtime.ts:380-383）" 与 as-built 不符（全仓 grep 零命中，比记载更弱）【导出族/候选7】；
- W15 "SIGTERM bounded exit<5s" 需按整进程口径修正（挂死下 5.10–5.23s）【导出族/E5/E6】。
- 处置：WORKFLOW-INVENTORY 相应行按 COVERAGE-MATRIX §3 修订，不需产品变更。

---

## 2. out_of_scope_v1（边界决策，需 owner 裁定）

| # | 缺口 | 证据 | 裁定出口 |
|---|---|---|---|
| O1 | 业务 span 词汇外工作流（W00/W01/W10①④/W11①/W12① 等）无语义层 | 【G族/候选缺口4】9 调用点/9 词汇静态+运行双证；词汇外路由失败仅 envelope+WARN | REALITY G2 "是否扩充无裁决"——维持无裁决，不默认施工 |
| O2 | 浏览器→服务端无 W3C trace 延续（仅 x-request-id 单键） | 【G族/候选缺口5】web 零 otel 依赖；`serverRootPropagator.ts:29-50` 入站 traceparent 不采信 | 产品边界决策（LAN/on-premise、无前端遥测面） |
| O3 | HTTP request metric 不存在（速率/时延无聚合序列） | 【导出族/候选2 FAIL】生产 metric 恰 4 处（`backgroundLoopSpan.ts:84/89/93`、`index.ts:165`）；E1 解码 metric 流恰 4 个无 http.* | REALITY §10 E9 open——需 owner 裁定"结构性缺失 vs 有意排除"，不是默认补齐 |
| O4 | H2/H3 无真 metric provider（W4 containment） | 【导出族/候选1 PARTIAL】`runtime.ts:373-394` 仅 otlp 分支；E7 运行时零 metric 面 | 合同设计，非缺陷；enable 裁决与 NO_GO 一起评审 |
| O5 | exporter/collector 故障应用层零信号 | 【导出族/候选7 FAIL】E4/E5/E6 三注入 telemetrySignalLines=[]；无 diag/dropSpans 面 | ADR-028 D1 有意 containment；若裁定需最小信号，见 §6 P7 的有界建议 |
| O6 | 无持久 refusal/audit 的失败痕迹面（W04 无持久 refusal #861；W06/W08/W09 audit deprecated/恒 0 行） | inventory 记录 + G4 运行佐证（痕迹=exactly-1 WARN+span result+receipt/域表） | 有意设计；增强需产品裁决，不默认加 audit |
| O7 | W13 服务端业务 outbound HTTP 不存在；相邻 Redis 无 OTel 面 | inventory 负证据 grep；`redisRuntime.ts` 仅 4 条状态日志 | LAN/on-premise 边界；引入时按 W13 oracle 核对 |

---

## 3. evidence_gap（需补测/验收，不构成实现缺陷）

| # | 缺口 | 归属 W | 现状证据 |
|---|---|---|---|
| E1 | 整工作流零运行证据（摄入+retention） | W11 | 三族均未触达；coverage 维持 TEST_ONLY |
| E2 | ATTEMPT_ALREADY_SUBMITTED 拒绝无干净运行证据 | W04 | run2 脚本 bug 得 400 路径不匹配形态；2b 被 DB 重置打断 |
| E3 | restore terminal lifecycle 未触发 | W06 | 2b 中止于 take-c0002（DB 被并行同胞 converge 重置） |
| E4 | frozen（take 读时冻结）未运行见证；take 404 ownership 未注入 | W08 | 运行中冻结走 W09 扫描器 |
| E5 | submit 幂等/crash-recovery/freeze 锁竞争未注入；grade leg 未运行 | W05 | G2 仅 submit×2 成功父链 |
| E6 | disruption/incident 腿 span/日志级未逐条解码；C5 人机冲突未注入 | W10 | 仅 H4 work.count incident_created=1 metric 面 |
| E7 | SMTP retry_wait/dead/ownership-lost 故障路径未注入 | W12 | 仅 processed+sent=1 成功链 |
| E8 | tick-throw/per-candidate error/quiet no_op/skipped 形态未见证 | W09 | 仅 submitted=1 |
| E9 | 2b STALE/FUTURE **两次**未拒反常未根因（ops2b.jsonl s2-stale-seq2-bv0 与 s4-future-seq3-bv99 的 body.accepted 均 true——复核轮落盘确认；"归因同胞争用"为未证实猜想，复核轮未重跑） | W03/W04 | 落盘复核确认，留 owner 跟进 |
| E10 | queue-level（2048 满）精确丢弃数不可观测 | W15 | 应用无 drop 计数面（与 O5 相关但独立可测） |
| E11 | filelog→Loki 真机端到端验收 | W15/G8 | 合同强制禁用至真机验收（technical-telemetry.md:110-120）；WSL2 被排除 |
| E12 | collector→Tempo/Prometheus 部署面段 | W15/G10 | ADR-028 PROPOSED；审计止于 otlp-sink payload |
| E13 | 协议档正式预算判定（≥6 有效配对+oracle 核验） | 全局 | 本主机结构性不可行（E8 探索级 n=2，按 §6.4 保持 UNKNOWN） |
| E14 | 探针路由导出面 + 503/budget 故障面 | W00 | E1/H4 未逐条解码 |
| E15 | start restored 分支 / 双击并发运行见证 | W02 | 仅 500 exception 路径注入 |
| E16 | H2 进程内 meter 探针 | 全局 | 由代码路径+H4 对照支撑，未进程内验证 |

---

## 4. inherent_blindspot（设计内不可见，补测无法消除）

- **B1 — 客户端取消/断连不可见**：【G族/取消/客户端中断】两种注入（raw socket destroy、fetch abort）下取消请求的 span 以正常终态出现（status=unset、200），日志零 abort/ECONNRESET 行——机制：server-span 生命周期以响应完成收口，断连在设计面之外（与 PR #980 W5 "nothing implemented" 一致）。
- **B2 — head sampling 盲区**：【导出族/G11/候选8】ratio=0.1 → 92% 请求（含业务 span/db 语句/时延）零 span 证据；ratio=0 全静默而进程照常服务；后台 cycle 同为 root 同受采样（ratio=0.1 轮 40+ cycle 仅 1 幸存）。缓解面=采样无关证据（pino WARN+audit_logs/域表/receipt），E4 实证 WARN 带 reqId/actorId 可对账 receipt。

## 5. privacy_omitted（刻意省略，声明以防误判为丢失）

- **P1** url.path 一律路由模板或 "(unrouted)"，raw path 永不保留（`urlScrubSpanProcessor.ts:48-52`）→ 404 原始目标不可恢复（扫描流量不可按目标归因）；
- **P2** span statusMessage 全 null / "(redacted)"，exception.*/error.type 删除（exceptionScrub）；
- **P3** pino redact remove 策略不可恢复式删除 password/token/cookie（`logRedaction.ts:12-30`）；
- **P4** span/metric 属性面为封闭词表：无 SQL 文本/绑定参数/连接串/凭据/答案内容/业务 payload（DB族 privacyFindings：H3+H4 双通道 5 冻结键实测）；
- **P5** 入站 traceparent 不采信（`serverRootPropagator.ts:29-50`）——身份/延续面省略。
- **干净面声明**【G族/G12 + 复核轮大小写不敏感复验】：除 D1 日志通道外，H3 dump 与 H4 解码导出体对 JWT/密码字面/cookie/SQL 关键字/原始 URL/答案内容全部 0 命中。**扫描器口径注意**：checkpoint 的 sqlKeywords 模式为大写（`analyze.mjs:203`），对 D1 的小写泄漏漏报（`sqlKeywords.log=0` 为假阴性）——干净面由复核轮以大小写不敏感复验独立成立（H4 sink 解码与 H3 明文 dump 对 eyJhbGciOi/select/password/cookie 均 0 命中；`jwtEyJ.sink=5` 为 raw-base64 JSON 结构前缀伪命中，解码后 0）。本声明**不覆盖日志通道**（D1 是其上的已知违例）；span/导出两通道判定维持干净。

---

## 6. 优先级排序（高频路径优先）

排序主轴：**WORKFLOW-INVENTORY §4 频率 rank**（W03=1、W01=2、W05=3、W10=4、W08=5、W06=6、W15=7、W02=8、W11=9、W14=10、W12=11、W00=12、W04=13、W09=14、W13=15）× 缺口对"当前生产默认 Off 态排障"或"未来 On 启用"的实际价值。**判据是可诊断性增益，不是覆盖率本身**。

| 优先级 | 缺口 | 绑定 rank | 理由 |
|---|---|---|---|
| **P1** | **D1 日志 SQL 泄漏** | 触及 rank1/2（W03 保存、W01 登录 500 分支） | 唯一"现在就在发生"的隐私缺陷：Off 态 stdout 是生产排障主通道，任意 500 即触发；修复成本小（错误消息脱敏/仅留 error kind），不依赖遥测启用决策 |
| **P2** | **D2 url.path 污染** | 跨全高频（rank1-6 贡献绝大多数 span 量） | On 启用的前置正确性问题（下游聚合即被污染）；高频路径放大受害者数量 |
| **P3** | **E9 2b 反常根因 + E2 ATTEMPT_ALREADY_SUBMITTED 见证** | rank1/13（W03/W04 保存协议） | 保存协议是全平台最高频写路径；两次未拒反常虽归因同胞争用但未证实，属正确性信心缺口，证据成本低（一次干净隔离复跑） |
| **P4** | **E5 submit 幂等/crash/锁竞争 + grade leg 见证** | rank3 | 交卷高峰锁集中是 inventory 初判的最坏场景之一，当前仅有测试层证据 |
| **P5** | **E3 restore terminal + E4 frozen + E6 disruption** | rank5/6 | 中断/冻结/恢复的用户争议场景（补时、谁冻结）只有域表级证据，缺运行级端到端见证 |
| **P6** | **D3 后台语句逃逸 + E7/E8 后台故障形态** | rank4/11/14 | 后台可诊断性：trace 碎片化使 cycle 归因靠时间窗拼；先修 writeHeartbeat 挂链（低成本），discovery 逃逸随 D3 一并处理 |
| **P7** | **O5 裁定 + E10/E11/E12**（W15 自诊断与部署面） | rank7 | 若 owner 裁定需要最小信号：**单个有界 exporter-terminal-failure 计数或一条 init/first-failure 日志**即为充分——不是加自观测体系；queue 级丢弃数裁定为"外部可观测即可"或补 drop 计数，二选一 |
| **P8** | **E1 W11 运行证据** | rank9 | retention/摄入为低频低风险路径，一轮观测即可消除整工作流的 TEST_ONLY |
| **P9** | **O3 HTTP request metric 裁定、O1 词汇扩充裁定、O2 浏览器 trace 裁定、B1 取消 capture 裁定** | rank10/15 及全局 | 全部是 owner 决策而非默认施工：每个都先要"要不要"的裁决，再谈实现 |

（W00 探针的 E14 与 W13/O7 不入排序：探针形态已有运行见证、探针故障面价值低；outbound HTTP 不存在。）

---

## 7. 明确排除的方向（non-goals）

1. **不以"全部记录下来/补全覆盖"为优化方向**。生产 On 已因 +10.4% CPU 被 NO_GO（PR #980）；任何建议必须在 Off 默认与 ADR-028 有界 containment 预算内成立。采样盲区（B2）是 head sampling 的定义性后果，缓解面（WARN+域表对账）已存在且经 E4 实证——不为此补 span。
2. **不默认扩充业务 span 词汇表**（O1）、**不默认引入 HTTP request metric**（O3）、**不默认启用 Loki leg**（E11，合同禁用中）、**不默认加浏览器遥测**（O2）——四项全部停在 owner 裁定。
3. **不把 W15 自诊断扩成自观测体系**：裁定若需要，最小充分面=单个 exporter-terminal-failure 信号（计数或一条一次性日志），与既有 `telemetry.init_failed`（`runtime.ts:218-226`，endpoint 脱敏）同级。
4. **不把 privacy_omitted 当缺陷"修复"**：P1-P5 是隐私边界的实现面，恢复任何一项都构成边界变更，需显式决策。
5. **不据推测填充 W07**：编号空洞保持 UNKNOWN，等待调度方补发定义。

---

## 8. 成本/价值视角补充（裁决分析员，2026-11-15）

- **产出**：应最终裁决 ask 要求补充的两张决策证据表——每工作流"原有 Pino+requestId 面 vs OTel 增量"与组件处置分级。**本节只给决策证据，不实施任何替换/裁剪**。
- **证据边界**：价值侧引用 §0–§7 与 COVERAGE-MATRIX 的运行见证（campaign 三族产物，转引）；**成本侧无新数据**——正式归因 benchmark BLOCKED（0/45 有效 segment，见 PERFORMANCE-REPORT §3：配额结构性不可完成 + harness CPU 采样缺陷 + quiet-machine 违反 + oracle 失败），每工作流 CPU/时延/内存增量**全部无判定数字**。因此本节的价值列是已证实的，成本列是未测的；任何裁剪/替换决策在预算实验重跑前都不具备充分证据。

### 8.1 每工作流：原有 Pino+requestId 能知道什么 vs OTel 新增什么

| W | 原有 Pino+requestId 面（Off 态即有） | OTel 新增证据（On 态） | 增量判定 |
|---|---|---|---|
| W00 探针 | request completed 日志 + x-request-id；/ready 503 body 只含 gate answer | request+handler 双 span、/ready db.statement、db.client.operation.duration | **低**：探针故障已有 envelope+日志完整分类；2-span 形态是骨架非增量 |
| W01 认证/列表 | Login denied WARN（reqId/actorId）+ 500 envelope + audit | trace_id↔reqId 逐字节对账（G6 实证）、request span ERROR、authRoutes handler | **中**：日志↔链路对账是增量；但 WARN+reqId 对账面已可用（E4 实证） |
| W02 start | envelope + WARN | start 业务 span→db.transaction 父链（27-span breakdown） | **中**：读放大定位（exam-list N+1 类）需 span 级 |
| W03 答案保存 | accepted:true + receipt 行 + 恰 1 WARN | **40001 sqlstate 端到端**（语句 span error→attempt ERROR→transaction.retry event→直方图 error 桶）、40P01 真死锁、3s 锁等待 settle 窗、24-span 逐 trace 分解 | **最高**：DB 故障注入端到端定位的唯一通道，三证 FULL |
| W04 拒绝面 | 恰 1 WARN + reason + envelope（#861 无持久 refusal 属有意设计） | 拒绝形态 span result 属性 | **低-中**：WARN 面已结构化；span 仅同义补充（G7：new-accept 与重放同形） |
| W05 submit | 终态 + audit + receipt | submit span（幂等/crash 分支无区分，G7 缺口） | **低-中**：成功链增量有限；故障分支证据缺（E5） |
| W06 restore | restored/already_in_progress 结果 + envelope | restore span 父链；markDisrupted 词汇外（G2） | **中**：terminal/disruption 链路价值未见证（E3） |
| W07 | —（编号空洞） | — | UNKNOWN |
| W08 take | frozen/unchanged 响应 + WARN | deadline_reconcile span + unchanged 20-span 分解 | **中**：读时冻结链路；frozen 形态未见证（E4） |
| W09 deadline auto-submit | submission_reason=deadline DB 终态（事后） | auto_submit span + scanner cycle + work.count metric 三方实时对账 | **高**：唯一能实时观测后台决策链的工作流，三证 FULL |
| W10 heartbeat | heartbeat WARN/audit + incident 域表 | 路由 span（词汇外）+ heartbeat cycle + incident_created metric 面 | **中**：incident 腿仅 metric 面见证（E6） |
| W11 retention | stdout 本地日志（无 durable 台账属有意设计 #544§9） | **零运行证据**（TEST_ONLY，三族未触达） | UNKNOWN（整工作流） |
| W12 outbox | outbox sent/dead 状态 + fake SMTP drain | email_outbox cycle + work.count processed/sent；**worker_heartbeats 逃逸缺陷（D3）** | **中**：cycle 链有价值但被 D3 碎片化削弱 |
| W13 outbound HTTP | —（NOT_IMPLEMENTED） | — | NOT_APPLICABLE |
| W14 HTTP 失败 | 404/envelope + WARN | thrown 400/409 span status=error（修正 inventory 旧记载）；**取消/断连不可见（B1 运行实证盲区）** | **低-中**：取消类故障 OTel 同样静默，增量仅 4xx/5xx 分类 |
| W15 exporter/关机 | `telemetry.init_failed` 一条信号（endpoint 脱敏） | **无自诊断面**（dropSpans/diag 零命中，O5/候选7 FAIL）；应用层零信号属有意 containment | **负增量**：exporter 自身故障 OTel 不提供任何信号，靠外部 sink 对账 |

**综合**：OTel 增量集中于 **W03/W09（高）**、W01/W02/W06/W08/W10/W12（中）；W04/W14 增量被既有 WARN 面与盲区压缩；W15 为负增量。采样盲区 B2（head sampling 定义性后果）意味着 On 态在高采样比下才有效，而高采样比正是成本所在——**价值与成本在同一旋钮上对拉，这正是预算实验（当前 BLOCKED）必须先行重跑的原因**。

### 8.2 组件处置分级（决策证据；本 PR 不实施替换）

分级定义：KEEP＝保留现状（默认 Off 零成本 + On 态有已证价值）；SLIM＝保留但识别出条件性裁剪参数（仅 On 态超预算时审议）；DISABLE_BY_DEFAULT＝当前合同/证据要求默认关闭；EXPERIMENTAL_REPLACE_CANDIDATE＝存在可信替换路径、待证据；INSUFFICIENT_EVIDENCE＝现状无法作出保留/裁剪判断。

| 组件 | 处置 | 依据 |
|---|---|---|
| OTel SDK 核心 + @fastify/otel request/handler span | **KEEP** | Off 态早返回零成本（`runtime.ts:208`【CODE_VERIFIED】）；On 态为全链骨架（W00–W14 span 面基座） |
| 业务操作 span 层（exam.attempt.*，businessOperationSpan） | **KEEP** | W03/W09 三证 FULL（COVERAGE-MATRIX §2.1）；词汇外缺口（O1）另列 owner 裁决，不影响本体价值 |
| db.statement 语句 span（packages/otel-drizzle-postgresjs + scrub） | **KEEP（附 SLIM 候选注）** | DB 故障端到端定位唯一通道（40001/40P01/lockwait）；但每 accepted-save trace 19 条语句 span 为最大 span 量来源（COVERAGE-MATRIX §3-5）——若未来 On 态超预算，**第一裁剪参数**是非业务语句/preHandler 读；裁剪收益未量化，现不裁 |
| scrub processors（urlScrub/exceptionScrub） | **KEEP** | 隐私边界 P1–P4 的实现面；干净面经复核轮大小写不敏感复验（§5） |
| metric provider + 4 处生产 metric（仅 otlp 分支，`runtime.ts:373-394`） | **KEEP** | 有意设计（O4 合同）；面积极小（每 H4 段 6 metric posts，MEASURED；HTTP request metric 不存在属 O3 owner 裁决项） |
| OTLP exporter + shutdownTelemetry flush | **KEEP** | 故障注入下业务隔离实证（E4–E7）；关机 ≤5.23s < 30s 预算；零诊断信号问题（O5）按 GAPS P7 最小信号面另议，非替换理由 |
| H3 memory exporter/ring（内存环 + shutdown dump） | **INSUFFICIENT_EVIDENCE** | 有界性有见证（7/7 段 dump=1000 全解析，MEASURED）但其成本/生产用途均未量化；当前定位是审计见证工具，不是生产信号面 |
| 后台 loop cycle span 全量 tick 面（exam.loop.*，每 tick 一 cycle） | **SLIM（条件性）** | span 量与 tick 频率线性相关（E2：13 cycle/短窗；ratio=0.1 轮 40+ cycle 仅 1 幸存【转引】）——On 态下 span 体量的主要来源之一；裁剪参数＝独立 cycle 采样比；收益未量化，仅超预算时审议 |
| filelog→Loki 摄入 leg | **DISABLE_BY_DEFAULT** | 合同强制禁用至真机端到端验收（technical-telemetry.md:110-120；E11）；WSL2 被排除在验收外 |
| collector→Tempo/Prometheus 部署面 | **DISABLE_BY_DEFAULT** | ADR-028 PROPOSED 未接受（E12）；本实验 collector 资源面零采集，无部署成本数字 |
| exporter 自诊断面（dropSpans/diag/error handler） | **INSUFFICIENT_EVIDENCE** | 现状为零（O5 全仓 grep 零命中）；"补最小信号 vs 维持零面"是 owner 裁决（P7），证据两侧都不完整 |
| HTTP request rate/latency metric | **INSUFFICIENT_EVIDENCE** | 不存在（O3 结构性缺失 vs 有意排除未裁定）；无成本数据支持引入或排除 |

**无 EXPERIMENTAL_REPLACE_CANDIDATE 级组件**：唯一可信替换方向是"用既有 WARN+reqId+audit/receipt 缓解面替代部分 span 面"（B2 缓解面 E4 实证可用），但它是采样策略参数而非组件替换，且预算实验 BLOCKED 使任何替换的成本收益都无法量化——替换决策全部悬置至重跑完成。

### 8.3 对 §6 优先级排序的成本侧修正

本节不改变 §6 排序（可诊断性增益主轴不变），补两条成本侧注记：

1. **P1（D1 修复）与 P2（D2 修复）不依赖任何成本数字**——D1 在 Off 态现在就在发生，D2 是 On 态启用前置正确性；二者是预算实验重跑**之前**就该完成的项。
2. **一切"SLIM/替换/裁剪"类建议的执行前置**＝G1 预算实验解除阻断并产出 ≥6 有效配对数字（PERFORMANCE-REPORT §3 解除条件）；在此之前任何组件级成本主张（含本节"最大 span 量来源"的量级观察）都只是结构观察，不是成本证明。
