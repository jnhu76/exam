# 架构裁决 — secure-correlation 审计（独立架构裁决官）

- 裁决官：架构裁决官（挑战必要性：能复用就不新增、能小就不大；依据 ADR 与仓库契约，不被安全/性能叙事绑架）。
- 时间：2026-11-08；基线 master `423f2945d9feef73a5413e498fb2772cc245c754`。
- 本阶段方式：**只读**。本会话实际执行：通读 `docs/adr/ADR-025`、`ADR-026` 原文；复读本审计既有证据（`source/adrs-issues.md`、`source/server-correlation.md`、`correlation/{investigation-playbook,02-consistency,header-influence,saveanswer-matrix}.md`、`review/security.md`、`review/replay-db-routestorage.txt`、`performance/RESULTS.md`）；亲验源码 `apps/api/src/routes/clientEvents.ts:31-44`、`apps/api/src/server.ts:106-124`、`apps/api/src/lib/proctorMonitoringService.ts:76,95`（grep）、`packages/contracts/src/attempt.ts:224,246`（grep `.strict()`）、`apps/web/src/App.tsx`（52 个 `path=` 声明）、`apps/web/src/lib/logger.ts:46-69`、`docs/contracts/observability.md:36-90`。未运行测试、未发 live 请求、未触 DB——LIVE 证据全部引自本审计 campaign 已存证实验并注明。
- 结论速览：**864-B GO、865-C GO、#864 进施工、#865 建议重开（锁定窄选项）、调查工作流维持现状 GO、其余 DEFER/NO_GO、过度工程停止清单 10 条。**

---

## 一、职责问题逐项回答

### Q1 现有机制是否已覆盖调查需求？真缺口在哪？

**已覆盖（live 证据）**：

| 需求 | 机制 | 证据 |
| --- | --- | --- |
| 保存业务真相（存没存/版本/内容身份） | `exam_answer_save_receipts` append-only + canonical SHA-256 身份——**唯一权威**，无需 requestId | playbook 情形 3/5/7 全 live 可解；`saveanswer-matrix.md` T02/T09/N1/N2 |
| 协议拒绝归因 | #861 恰一条 WARN（org/actor/attempt/question/clientSeq/reason/serverVersion + 自动 reqId） | `02-consistency.md` 7 拒绝↔7 WARN 一一对应 |
| HTTP 失败归因 | 错误信封 `error.requestId = request.id`（errors.ts 全 7 分支），与 pino/audit 同值（ADR-025 D3） | `02-consistency.md` C1–C4 live |
| ID 唯一性与防伪造 | `genReqId: () => randomUUID()` + `requestIdHeader: false`（server.ts:111-113，本会话亲验）；跨重启零复用；伪造头（含声明他人真实 ID）零影响 | `header-influence.md` E1a–f、pb-08、`review/replay-header-influence.txt`；`server.requestId.test.ts` 为行为合同（本阶段未运行，源码精读见 `source/server-correlation.md` §1） |
| 跨主体/跨组织冒充 | 三态语义（NO_MATCH/ONE_CANDIDATE/AMBIGUOUS）+ 组织先行 + url→DB 归属核验 | playbook 情形 4 live 识破 |

**真缺口（全部便利级、无正确性损失——receipt 永远先回答业务问题）**：

1. **200 成功/业务拒绝响应不携带任何客户端可引用的服务端 ID**（`attempt.ts:224,246` `.strict()` 无该字段，本会话亲验）。客户端报障只能报 attemptId+questionId+clientSeq+时间窗；接受类传输归因靠 ±150ms 时间窗包含判据，窗内实测出现 5 个候选需状态码过滤排除假阳性（playbook 情形 3）。**这是 #865 唯一值得动的问题。**
2. 并发重复保存创建者不可分（T08：两请求同窗，receipt 无 request 标记列）——**冻结三态语义已接受为 AMBIGUOUS**，修复需 receipt 增列，见停止清单。
3. ACK 丢失的原请求归因（T10：业务真相已由 receipt+verbatim 重放闭合，残余仅为原请求日志考证）。
4. 日志保留期外的 INSUFFICIENT（N4）——本质是保留期问题，无保留平台（见停止清单）。

### Q2 是否需要改 wire contract？一个响应头是否就够？

- **响应体：不改（865-D NO_GO，结构性冲突）**。同键重放返回**原 ACK 逐字复用**（T02/R1：savedAt 均为原始接受时刻；`answerProtocol.ts:209-231` 源码依据）。体含 requestId 时，重放响应要么携带**原请求的** ID（误导关联），要么破坏 verbatim 语义；且把传输层身份塞进业务 `.strict()` Schema 是层次错位。
- **响应头：若决定行动，全站一个头就够（865-C）**。复用 `request.id`（不新增生成、不新增服务、零持久化）；性能实验已实测该实现（onSend hook +8 行）代价为每响应精确 +52B、吞吐/延迟/日志/DB 计数无可测变化（`performance/RESULTS.md` 变体 B，144 测点——campaign 实测，本阶段未重跑）。单端点版本（865-B）不省任何契约类成本却制造碎片面。
- **不改 wire 的更小替代（须向 Owner 摆出）**：接受类保存记一条带业务键的 info 日志（镜像 #861 WARN 惯用法，observability.md:43-47 的 SHOULD 方向）。零 wire 变更，且能多关一个缺口（ACK 丢失归因——日志行在服务端，客户端读没读到响应无关）；代价是 answers 热路径日志量约 ×2（reject 场景实测 WARN 使日志 ×2.1，`performance/RESULTS.md` 分场景要点），而响应头代价仅 +52B。**两者皆小；推荐 C 为主（运行时足迹更小、均匀覆盖、正是关闭裁决预留的窄选项），info 行为 Owner 拒绝任何 wire 变更时的替代。**

### Q3 是否违反 ADR-025/026 或 EXSEM 冻结条款？（原文已读）

- **865-C 合规**：ADR-025 D3 身份对应不变量「信封/pino/audit 同值」——响应头成为同值的第四载体，方向一致而非冲突；D2 入站拒收不变（`requestIdHeader:false` 原样保留，出站回显同名头不产生回授：E1a–f 已证入站零读取）；D4「不是业务身份」、D5「客户端遥测 requestId 永远是未验证声明」必须在契约更新文字中原样保留——客户端回显头值进遥测仍是 client_claimed。ADR-025 明示边界「不采纳通用观测/tracing 框架」——单一响应头不是框架。**不需要 superseding ADR**；observability.md 的 requestId 措辞更新以 ADR-025 为权威（其 Normative touchpoints 条款自带此授权）。
- **865-D 违反 verbatim 重放语义**（如上）；同时是 #865 关闭裁决明文 NO_GO 的形态。
- **864-B 合规**：wire Schema 不变（`clientEvent.route` 仍 string 1..500）、存储仍 `string|null`（无迁移、无新持久字段）、读取面代码不动（`proctorMonitoringService.ts:76,95` 本就条件包含）。ADR-026 只辖时间证据，不涉。ADR-020 辖服务端 API 路由身份——route 是客户端遥测载荷字段，现有 `normalizeRouteForStorage` 已在持久化边界解析它，B 是同一职责的收敛，不是 raw-URL 策略分类。EXSEM：无冻结条款辖遥测字段投影形状；EXSEM-016（浏览器事件不证明 misconduct）与 EXSEM-017/018（证据面不得泄密）方向上均被 B 加强。#875 关闭决策的「route 只存 pathname」保证（query/fragment 剥离、有界）被 B 平凡保持，且 route 进一步收敛本就是 #864 的明文未决 scope。
- **反向检查（谁会违反）**：给 receipt/audit/client_event 加 request 维度、开 Correlation Service、引入 OTel——违反 ADR-025/#800 冻结；用 `request.routeOptions.url` 做 SPA 模板——对象错误（API 路由模板≠SPA 导航路径，ask 明示）。

### Q4 #864/#865 裁决边界是否独立？requestId 是否被误用为业务身份？

- **独立，且必须分开裁**：#864 = 低信任客户端自由串的 **at-rest 输入投影**（持久化边界）；#865 = **出站关联面**（响应表面）。互不依赖、互不绑架——865-C 不需要 864-B 先落地，反之亦然。唯一排序约束在 DEFER 项上：任何调查端点必须在 864-B 之后，否则再暴露原始 path（F4 所在）。
- **requestId 未被误用，且候选文本自带防线**：865-C 明文「复用已有 request.id、不新增持久化 client_event」；receipt 刻意不含 requestId（`answerProtocol.ts:280-286`：`{questionId, clientSeq, answerIdentity, version, savedAt}`，归属由 attemptId 外键承载）——**此现状必须保持**，C 落地不得顺手「补全」receipt。campaign 实测四身份互不等价（requestId/operationId/SaveReceiptIdentity/clientSeq，`saveanswer-matrix.md` 身份区分表），865-C 不触碰其中任何一个。

### Q5 更小方案？调查工作流必要性？

- **#864 无更小方案能关死泄露**：性能实验的根段 allowlist 变体（RESULTS.md 变体 C）对已测 canary 全 null，但其定义是「已知 route-root allowlist + 未入表 null + 合法 SPA 路由**原样保留**」——`/exam/<id>/take` 的尾段字节被原样保留，意味着**已知根下的任意尾段（如 `/reset-password/<secret>`）仍是客户端控制字节落库通道**（本会话从变体定义直接读出；敌意真根+秘密尾段组合未在 canary 集中测过，如实标注）。候选 B 的参数化不是锦上添花：**存储值=封闭模板词汇（≤52 串），客户端字节零保留**，这才是同时「关死泄露+保留页面级信号」的最小正确设计。机制代价同类（RESULTS.md 估计投影类 <5µs/事件，无可测开销）。
- **#865 有更小替代**（Q2 的 info 行），已在重开建议中摆给 Owner。
- **调查工作流：现状已足够，GO**。playbook 七情形中全部**业务问题** live 可解（1/2/3/4/5/7 + 重启唯一性）；LAN/on-prem 下部署管理员对 stdout 的 OS 级访问天然构成调查授权（外部对照：Stripe/GitHub/GitLab/AWS/Cloudflare 均以服务端生成 ID 为公开排障句柄，秘密性在生成权不在 ID 值）。新增只读索引/端点/UI 无一有满足四前提（Permission/租户约束/字段投影/限流+查询审计）的具体提案，也无运维需求证据；端点/UI 还会恰好在 F4 泄露所在的数据上新开特权读面。

### Q6 过度工程预警清单（必须停止的方向）

1. **Correlation Service / 中央 ID 服务 / 实例注册表 / ULID·前缀方案**——ADR-025 明令，重审触发器未满足。
2. **OTel/traceparent 采纳**——Observability Contract non-goals + ADR-025 重审触发器未满足。
3. **每次成功请求的 audit 行或 client_event 持久化**——存储放大；契约明文「不是每个请求都产生 audit 行」。
4. **receipt 增 request 标记列 / durable refusal 表 / 复活 `attempt.saveAnswer` audit action**——#861/#866/#800 冻结；并发归因保持 AMBIGUOUS 是既定语义，不是缺陷。
5. **通用 Sanitizer Framework / per-event-type schema**——#864 明令禁前者；后者是独立 Owner gate（A5-F4），不得顺手实现。
6. **route 新 schema/迁移/持久字段**——存储保持 `string|null`，wire 保持 string 1..500。
7. **Fastify `request.routeOptions.url` 当 SPA 模板来源**——对象错误。
8. **调查端点/管理 UI 先于 864-B 或缺四前提**——新特权读面不得建在未修复的泄露之上。
9. **中央日志存储/保留平台**——ADR-025 context 明示不引入；N4 INSUFFICIENT 是诚实降级不是待修 bug。
10. **重开 865-D（响应体字段）**——与 verbatim 重放语义结构性冲突，永不翻案。

---

## 二、候选裁决（optionVerdicts）

| 候选 | 裁决 | 理由（架构） |
| --- | --- | --- |
| **864-A 维持现状** | **NO_GO** | pathname 投影的控制目标被 live 双通道证伪（F4：RT-3/8/12B/12C/14B 原样/可还原落库并经授权时间线再暴露，裁决官重放 R2/R3 再证实）；#864 自设 DEFER gate「真实链路 canary 负例」已满足，维持现状=保留已证实泄露通路。 |
| **864-B 封闭模板投影** | **GO** | 唯一「客户端字节零保留 + 页面级信号保留」的最小设计：存储值=封闭词汇（App.tsx 52 模板），未知→null 覆盖全部五类 canary 通路；无 wire/迁移/新字段；读取面零改动。**参数化不可降级为根段 allowlist**（后者保留已知根下尾段字节，见 Q5）。落地约束：(a) 模板表单一权威——共享常量（`@exam/contracts`，App.tsx 同源消费，仿 sanitizeClientEvent 共享先例）优先，否则 API 侧表 + 对 App.tsx 的漂移守卫测试；(b) 段级线性匹配、禁回溯正则（#875 run-based 先例）；(c) 本审计 31 只 canary 类（真根+秘密尾段须补入）作单元+HTTP 回归；(d) 禁 Sanitizer Framework、禁 `request.routeOptions.url`；(e) contracts 内 route 字段注释从「pathname」改为「模板」属文字同步非 wire 变更。 |
| **864-C 有限 category/name** | **DEFER** | **并不比 B 小**：要正确分类必须先有 B 的全部模板知识，再丢弃更多信息（「哪场考试/哪个 attempt 页」上下文归零）；#864 gate「(2) 量化调查效用损失」未完成。仅作 B 的回退保留。 |
| **864-D 完全停存 route** | **NO_GO** | 为关一个 B 能关死的泄露而删除已授权且正常的诊断信号（proctor 时间线页面上下文），并翻搅全部发送方契约与读取面——最大改动换最小收益，违背最小长期正确。 |
| **865-A 维持现状** | **NO_GO** | 不是「系统坏了」（业务真相 receipt 全覆盖），而是：#865 关闭裁决自设的重开条件（「实测运维工作流需要精确的 200-请求日志查找且能证明缺失 join」）在关闭**之后**被 live 证据满足（playbook 17:12Z > 关闭 13:33:47Z：情形 1 客户端零可引用 ID、情形 3 接受归因 ±150ms 窗 5 候选、情形 6 并发不可分 = 缺失 join 的实测；performance 变体 B 22:24Z = 代价实测）。永久维持现状=无视 Owner 自己预登记的窄选项触发器。 |
| **865-B 仅 SaveAnswer 头** | **NO_GO** | 被支配选项：响应头与错误信封同属全局机制类（信封即全局先例），单端点版不省任何契约成本、留全部其他 200 同缺口、制造表面不一致；SaveAnswer 专属缺口若 Owner 拒绝 wire 变更，应由 info 日志行（非 wire）解决而非碎片头。 |
| **865-C 全站 X-Request-Id 响应头** | **GO** | 复用 `request.id`（ADR-025 既有生成），零新 ID/服务/持久化；均匀关闭 Q1 缺口 1；代价 +52B/响应、无可测影响（campaign 实测）；D2/D4/D5 防线不变。落地约束：(a) observability.md 以 ADR-025 为权威更新（第四载体），无需 superseding ADR；(b) 测试钉死：全部状态码（200/4xx/5xx）带头、入站头仍被忽略、遥测回显仍 client_claimed；(c) 跨域读取场景补 `Access-Control-Expose-Headers`（同源 nginx 拓扑下非必需，外部对照三家均主动暴露）；(d) **不伴随** receipt/audit/client_event 任何改动。**Owner 替代项**：接受类 info 日志行（非 wire、多关 ACK-丢失归因、代价 answers 路径日志 ×2）——重开裁决中二者择一，倾向 C。 |
| **865-D 响应体加 requestId** | **NO_GO** | verbatim 重放结构性冲突（重放携带原请求 ID=误导，或新 ID=破坏逐字复用，T02/R1 实测）；业务 Schema 塞传输身份属层次错位；#865 关闭裁决对该形态已 NO_GO，无新证据翻案。 |
| **investigation-status-quo** | **GO** | 七情形业务问题 live 全解 + 三态/授权模型 + receipt 终态；零新增攻击面；stdout OS 级访问=LAN 调查授权。残余缺口如实：并发 AMBIGUOUS、保留期 INSUFFICIENT（均为接受边界）。 |
| **investigation-readonly-index** | **DEFER** | 无具体提案；若指既有读路径补 DB 索引，属维护者实现细节非调查面，须先明确 scope 与所有权；无实测查询痛点支撑。 |
| **investigation-endpoint** | **DEFER** | 在低信任遥测存储上新开特权读面=恰 F4 所在；四前提（Permission/租户/投影/限流+审计）均未设计；**前置**：864-B 落地后再评估，否则端点再暴露原始 path。 |
| **investigation-admin-ui** | **DEFER** | 端点的超集，同批前提；现状工作流已可解，无运维需求证据。 |

## 三、Issue 独立裁决

- **#864（OPEN, DEFER）→ GO（进入施工）**。DEFER gate (1) live 负例已产出并经裁决官双通道重放证实（R2 读面 12 canary 再暴露、R3 at-rest 31 行）；gate (2) 的效用损失量化只约束「B vs C」的选择，而 B 与 D 的比较不需要它（D 删信号、B 保信号，泄露两者都关）。issue 自述偏好「单一 canonical、有界的服务端摄入投影」即 864-B。按 Issue 同步协议先做 reality audit：把本审计负例、五类 canary 通路、真根+尾段残留风险、模板表单一权威与漂移守卫、禁项（Sanitizer Framework/新 schema/`request.routeOptions.url`）写入 scope/acceptance 再施工。
- **#865（CLOSED 13:33:47Z, CLOSE_AS_NOT_PLANNED）→ REOPEN_RECOMMENDED**。非推翻 Owner 决定，而是执行其自设条款：关闭文本明示「若未来实测运维工作流需要精确的 200-请求日志查找且能证明缺失 join，**重开此窄选项（X-Request-Id 响应头）而非改领域响应**」。该条件在关闭后被三份 post-close 证据满足（playbook 情形 1/3/6 = 缺失 join 实测；performance 变体 B = 代价实测；关闭时二者均不存在）。重开范围锁定 865-C（及 info 行替代项的对比裁决）；865-D 的 NO_GO 维持不变。重开是 Owner 动作。

## 四、最小修复顺序建议

1. **先 #864（唯一 REFUTED 不变量=在库隐私泄露）**：reality audit → 更新 issue 合同 → 864-B 施工（共享模板常量或 API 表+漂移守卫、段级匹配、31+补 canary 回归、contracts 注释同步）。无迁移、无 wire 变更。
2. **并行/随后 #865 重开裁决（Owner）**：C（+8 行 hook + 契约文字 + 测试）或 info 行（非 wire）；二者都不触碰 receipt/audit/client_event。
3. **调查工作流维持现状**；停止清单 10 条生效。
4. （非本裁决对象，仅登记）F9/U6 的 stale-dist 守卫是独立构建卫生项，不绑架上述顺序。

## 五、performance 裁决

**PASS**——依据 campaign 基准（`performance/RESULTS.md`：4 变体交错、12 配置、144 测点；B/D 每响应精确 +52B，C 零字节差；DB 绑定场景吞吐/p95/p99/CPU/pg-xact 差值均在 ±3% 噪声带内；httperr 共模偏差与 pg 元组计数已如实标 INCONCLUSIVE）。**本阶段未重跑基准**，结论引用既有实测。

## 六、本裁决的限制（如实）

- 本阶段为只读裁决：未运行任何测试、未发 live 请求、未查 DB；LIVE 证据全部引用本审计 campaign 存证文件（各 findings 已注明），源码主张为本会话亲验（path:line）。
- 「敌意真根+秘密尾段在根段 allowlist 变体下存活」是从变体定义（RESULTS.md:13,16「合法 SPA 路由原样保留」）直接推导，该具体组合未入 canary 集（已在正文与 findings 标注推导性质）。
- `server.requestId.test.ts` 的行为保证未在本阶段执行，引用源码精读与 campaign live 实验（pb-08/E1a–f）。
