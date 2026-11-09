# 安全裁决 — secure-correlation 审计（独立裁决官复查）

- 裁决官复查时间：2026-11-07T22:35Z–22:45Z（本地 2026-11-08 06:35–06:45 CST）；基线 master `423f2945d9feef73a5413e498fb2772cc245c754`，`git status --short` 仅会话前已存在的 `?? test-results/`（零 git 跟踪文件改动）。
- 复查环境（可用，LIVE）：API `http://localhost:3000` 健康 200；dev launcher PID 787438，其 environ `TEST_DATABASE_URL=postgresql://exam:exam@localhost:5432/exam_ci_audit`；DB 身份核验 `current_database()=exam_ci_audit, current_user=exam`（docker exec psql，只读）。
- 复查方式：从 `adversarial/` 与 `correlation/` 选出 6 项最关键结论（含 1 项 REFUTED 不变量与 1 项 REFUTED 隐私主张），按证据文件中的原始命令/脚本独立重放（R1–R5，本目录 `replay-*` 文件），另以源码+行号复核（SOURCE_VERIFIED）。重放脚本与原始脚本的唯一差异是输出路径（请求逻辑逐字一致，diff 已验证）。

## 1. 独立重放矩阵

| # | 重放对象（原始证据） | 原始命令来源 | 本次命令 | 结果 vs 原始 |
|---|---|---|---|---|
| R1 | 跨组织负例 M1–M11 + 正例对照（`adversarial/run-01-cross-org.txt`） | `bash adversarial/f1-cross-org.sh` | 同脚本逐字重跑，输出重定向至 `review/replay-f1-cross-org.txt` | **一致**：adminB M1–M7 全 404（信封 requestId 均服务端新 UUID）；audit-logs `targetId=<OrgA attempt>` 过滤 `items:[]`（无跨 org 行）；candB1 3×404；正例 candA1 own attempt 200 / proctorA1 timeline 200。伪造 `x-request-id` 金丝雀在全部响应体出现 0 次 |
| R2 | 读取面再暴露 + 分配门（`adversarial/readside-checks.out.txt`、`timeline-proctorA1.json`） | `node adversarial/readside-checks.mjs` | 拷贝脚本仅改 3 个输出路径（`review/replay-readside.mjs`，请求逐字一致） | **一致且关键**：proctorA1（已分配）proctor-events **200**、36 items、canary_hits=12（11 行 route 原样 + 1 行 name）；proctorA2（未分配）404/0；admin audit timeline 200/0。差异：scores CSV 由原始 409 变 **200**（attempt 期间被 deadline scanner 判 graded，前置条件通过）——CSV 7 列（姓名/编号/部门/成绩/及格/尝试/提交时间），无标准答案、无 metadata/userAgent/route，0 canary |
| R3 | route at-rest 投影（`adversarial/db-route-dump.txt`） | psql 只读 SELECT | `docker exec exam-dev-db-1 psql -U exam -d exam_ci_audit -c "SELECT event_id, left(route,80), length(route) FROM client_events WHERE event_id LIKE 'rtcanary-%' ORDER BY event_id"` → `review/replay-db-routestorage.txt` | **一致**：31 行全部在库；RT-3 `/password-reset/EXAMAUDIT-CANARY-RT-3`（37B 原样）、RT-8 `/a%2Fb%3Ftoken%3D…`（38B）、RT-12B `…RT-12B@example.com/path`、RT-12C `text/html,…`、RT-14B 含原始 CR/LF 字节（psql 多行显示）；RT-15b 截断 500；RT-4/5 query 剥离为 `/exam/list`；UA 金丝雀 31/31 行命中 |
| R4 | 伪造关联头影响（`correlation/01-02-header-consistency-raw.log` / `exp1-2.sh` E1b/E1c 形） | curl + grep server.log | 同形请求（`review/replay-header-influence.txt`）：无认证 POST save + 3 个伪造头 | **一致**：401 信封 requestId=`b89cb51c-…`（服务端新 UUID）；server.log 该 reqId 恰 `incoming request`+`request completed` 一对；全日志 `grep -c EXAMAUDIT-CANARY-HDR` = 0 |
| R5 | client_events 引用信任边界 DB 终态（`adversarial/run-06-07-clientevents-requestid.txt` L79-101） | `f6-client-events.sh:87-101` 三条 psql | 同查询重放（`review/replay-f6-trustboundary.txt`） | **一致**：candA2 冒用 A1 attempt→attempt_id NULL；candB1 跨 org→全 NULL；proctorA1/admin staff 冒用→全 NULL；candA1 伪造 examId→exam 被替换为 canonical；受害者 A1 attempt 关联行全部 sender=candA1 本人（36 行含后续 RT canary 批，零跨主体注入）。行数 11=原 10 行 f6 + 后续 run-07b 追加的 f6b-minimal（时间线自洽，非矛盾） |
| R6（源码复核，非重放） | proctor-events 500 根因（`adversarial/authz-proctor-admin.md` §4） | — | `stat` dist mtime（2026-11-08 01:05:28 > src 2026-11-07 17:58）+ `grep to_char packages/db/dist/repository/clientEventRepo.js`（:152 命中） | dist 已含 #874 修复 → 解释 R2 中 500→200 转变：原 500 是审计环境陈旧 dist 混跑，非 master 源码缺陷 |

## 2. 逐 finding 裁决（独立标注）

> 状态语义：CONFIRMED=本裁决官以真实实验（R1–R5）或源码+行号独立证实；REFUTED=主张被打破。原始阶段证据作为交叉引用列出。

| # | 领域 | 不变量主张 | 状态 | 严重度 | 证据（本次重放优先） |
|---|---|---|---|---|---|
| F1 | authorization | Org B 主体（Admin/Candidate）对 Org A attempt/exam 的证据、导出、结果、监考端点全部 404 不可解析；audit 列表 org 谓词过滤零跨组织行 | CONFIRMED | low | `review/replay-f1-cross-org.txt`（R1：7×404 + `items:[]` + 正例 200） |
| F2 | authorization | client_events 冒用他人 attempt/exam/question 引用按信任边界折叠（跨 org、无归属、staff 一律 NULL），eventId 去重按 (org,user) 隔离，受害者时间线零跨主体注入 | CONFIRMED | low | `review/replay-f6-trustboundary.txt`（R5 DB 终态复验）+ `adversarial/run-06-07-clientevents-requestid.txt` |
| F3 | authorization | 未分配 Proctor 对 scoped 监考端点 404 反枚举（与资源不存在不可区分），已分配 Proctor 读取折叠到本考试 | CONFIRMED | low | `review/replay-readside-checks.out.txt`（R2：proctorA2 404/0；proctorA1 200）+ `adversarial/authz-proctor-admin.md` §1（41 探针） |
| F4 | privacy | 「route 只存 pathname 即可满足 #875 at-rest 凭据最小化」——**被打破**：path 段 secret（RT-3）、`%3F/%3D` 走私 query（RT-8）、非特殊 scheme opaque userinfo（RT-12B）、`data:` 载荷（RT-12C）、原始 CRLF 字节（RT-14B）以原样/单次解码可还原形态落库，并经已授权 `GET /admin/attempts/:id/proctor-events` 原样再暴露给同组织 Admin/已指派 Proctor | REFUTED | medium | `review/replay-timeline-proctorA1.json`（R2 今日再暴露 12 canary）+ `review/replay-db-routestorage.txt`（R3 at-rest）+ `apps/api/src/lib/proctorMonitoringService.ts:76,95`（route 逐字透传）+ `apps/api/src/routes/clientEvents.ts:31-49`（投影实现） |
| F5 | privacy | user_agent 请求头原样 at-rest 持久化（仅 500 截断、无形状检测）；当前无读取端点返回该列 | CONFIRMED | low | `review/replay-db-routestorage.txt`（R3b：31/31 行含 UA 金丝雀） |
| F6 | privacy | proctor timeline metadata 投影 default-deny：未知事件名 metadata=`{}`，超白名单键全部丢弃；仅 `answer_autosave_failed` 7 键白名单 | CONFIRMED | low | `review/replay-timeline-proctorA1.json`（R2：36 items 中 35×`{}`）+ `proctorMonitoringService.ts:177-205` |
| F7 | correlation | 客户端伪造 request-id/x-request-id/traceparent（含声明他人真实 requestId）不被采纳：信封与 Pino 均为服务端新铸 UUIDv4，日志零残留，授权结论不变 | CONFIRMED | low | `review/replay-header-influence.txt`（R4）+ `correlation/header-influence.md`（E1a–f）+ `apps/api/src/server.ts:111-113` |
| F8 | correlation | HTTP 200 成功与业务拒绝响应不携带任何服务端请求标识（信封仅 4xx/5xx）；客户端报障仅能凭 attemptId+questionId+clientSeq+时间窗，接受类传输归因存在残余歧义、并发重复不可归因 | CONFIRMED | low | `correlation/02-consistency.md` + `correlation/investigation-playbook.md` §4（情形 1/3/6 live）+ `packages/contracts/src/attempt.ts`（SaveAnswerResponse 无 requestId 字段；本阶段未重放，引用原 live 实验） |
| F9 | architecture | proctor-events 对已授权主体返回 500 的缺陷（含 client_events 行即 ResponseSerializationError）根因是 `@exam/db` 陈旧 dist 与新 src 混跑（#874 to_char 修复晚于 dist 构建）；dist 同步重建后端点恢复 200；源码 fallback 分支（`proctorMonitoringService.ts:80-97`）仍不纠正 occurredAt 类型，未来回归仍会整端点 500 | CONFIRMED | medium | R2（今日 200/36 items）+ R6（dist:152 已含 to_char）+ `adversarial/authz-proctor-admin.md` §4（原 500 证据链 repro3/4/5） |
| F10 | performance | 全局 X-Request-Id 响应头（复用 request.id）代价=每响应精确 +52B；吞吐/p95/p99/CPU/pg-xact 变化在 ±3% 噪声带内；route 清洗变体零字节差、无可测开销 | CONFIRMED | low | `performance/RESULTS.md` + `performance/raw/bench.csv`（144 测点、4 变体交错；本阶段未重跑基准，引用既有实测） |
| F11 | correlation | SaveAnswer 协议不变量：同键同内容重放返回原 ACK（零写）、同键异内容 CONFLICTING_PAYLOAD（零写）、并发同键恰一行 receipt（行锁串行）、ACK 丢失服务端照常提交且可幂等恢复 | CONFIRMED | low | `correlation/saveanswer-matrix.md`（T02/T08/T09/T10 live + DB 快照；本阶段未重放，引用原 live 实验） |
| F12 | baseline | 单一 `exam` DB 账号无角色分离，org 隔离完全由应用层 repository 谓词承担（本审计全部越权负例通过）；部署环境日志文件权限属 INFRA_ACCESS_NOT_VERIFIED（pino→stdout，宿主权限不可测） | CONFIRMED | low | `adversarial/db-identity.txt` + `adversarial/authz-proctor-admin.md` §6 |

**无新增 REFUTED**：本裁决官的重放未发现原始证据链之外的越权/泄露反例；唯一 REFUTED（F4）与原始 #864 疑点结论一致并经今日双通道（at-rest + 读取面）再证实。

## 3. 未覆盖攻击面（仅描述 + 合成验证方向，不含可攻击生产的操作细节）

| # | 攻击面 | 现状 | 合成验证方向（建议后续工作） |
|---|---|---|---|
| U1 | CSV 导出公式注入：管理员录入的自由文本（考生姓名/部门/考试标题/题干/考生答案）流入 audit CSV（9 列）、attempt export CSV（含考生答案列）、scores CSV（姓名/部门列） | 未测：本审计只验证了授权边界与列集合，未验证单元格内容转义 | 以 `=EXAMAUDIT-CANARY-…`/`+`/`-`/`@` 前缀金丝雀字符串录入合成考生/考试，导出后检查是否加前缀转义（`'` 或制表符）或原样输出 |
| U2 | 生产模式限流行为：全部枚举/暴力探针在 APP_MODE=e2e（限流结构性关闭，runtimeConfig.ts:712-714）下运行 | 未测：限流开启后的状态码/时序差异、limiter key（IP）在 NAT 共享出口下对考生的交叉影响 | 在生产 APP_MODE 重跑 12 格枚举矩阵 + 同 IP 并发负例，验证 429 不构成存在性 oracle 且 key 不误伤 |
| U3 | 监考分配撤销 TOCTOU：分配门每请求查询（plugins/authz.ts:79-92），但未测撤销与在途请求的竞争 | 未测 | 合成分配撤销与分页翻页交错（page1 后撤销再取 page2），验证每请求重估（期望 404）且无旧能力残留 |
| U4 | operationId 并发碰撞：command receipt 主键冲突拒绝已 SOURCE_VERIFIED，但并发同 operationId 双命令的裁决确定性未测 | 未测 | 合成并发同 operationId 命令对，验证恰一次执行 + 确定性拒绝信封 |
| U5 | route 字段到达 Web UI 后的渲染面：RT-14B 原始 CRLF 已在 API JSON 转义（`\r\n`），但管理/监考 UI 与未来 CSV 导出对该列的渲染未测 | 部分验证（API 层安全） | 在 web UI 渲染含控制字符/500B/Unicode 金丝雀时间线，检查无布局破坏与二次注入 |
| U6 | dev/e2e 混跑陈旧 dist 的构建卫生（F9 根因） | 已证实一次真实事故 | 增加守卫：`@exam/db` dist mtime < src mtime 时 dev 启动 fail-fast 或告警（部署/开发均受益） |

## 4. 候选改动裁决（optionVerdicts）

### #864 route 存储安全

- **864-A 维持现状 → NO_GO**。pathname 投影的控制目标已被 LIVE 双通道证伪（F4：RT-3/8/12B/12C/14B 原样/可还原落库并再暴露，今日重放再证实）；`#864` 自己的 DEFER gate「(1) 真实链路 canary 负例」已由本审计满足，维持现状等于保留已证实泄露通路。
- **864-B 服务端把已知客户端导航路径投影为稳定 route 模板（动态标识符参数化、未知路径置空）→ GO**。唯一同时满足三个条件的选项：(a) 关闭全部三条泄露通路（未知路径→null 覆盖 RT-3/8/12B/12C/14B；模板化移除 path 段内标识符/secret）；(b) 保留时间线合法信号（哪场考试哪一页），服务 #865 调查工作流；(c) 符合 #864 scope 偏好「单一 canonical、有界的服务端摄入投影」。性能变体 C 已实测 allowlist+置空核心无可测开销（F10），参数化为每事件 O(path 段数) 常量工作。约束：路由模板表须单一权威并有与 SPA 路由表（apps/web/src/App.tsx）的漂移守卫；**不得**用 Fastify `request.routeOptions.url`（API 模板≠SPA 导航路径）；不新增通用 Sanitizer Framework、不加 schema/迁移/持久字段（存储仍是 string|null）；禁正则回溯。
- **864-C 只保留有限 route category/name → DEFER**。同样关闭泄露，但把合法调查信号压到类别级（丢失「哪场考试/哪个 attempt 页」上下文）；#864 gate「(2) 量化调查效用损失」尚未量化完成。作为 B 的回退方案保留，不作首选。
- **864-D 完全停止存储 route → NO_GO**。对已授权且正常工作的诊断信号是过度删除：泄露可用 B 关闭而无需砍掉功能；同时是全部发送方的 wire/存储契约翻搅，违背最小长期正确改动。

### #865 请求关联

- **865-A 维持现状 → NO_GO**。安全性无暴露（F7/F8），但 playbook 已 live 证明客户端侧 200-成功报障无可引用服务端 ID、接受类传输归因有残余歧义、并发不可归因（investigation-playbook.md §4「必须新增能力」1/3 项）；该缺口与关闭决策时的信息相比是新增实测证据。
- **865-B 仅 SaveAnswer 增加 X-Request-Id 响应头 → DEFER**。能覆盖最高价值场景且契约面最小，但制造端点不一致（其余 200 端点同缺口仍在），且错误信封已是全局机制——单端点头是局部补丁。若 Owner 坚持最小足迹可接受，不作首选。
- **865-C 全站统一服务端生成 X-Request-Id 响应头（复用 request.id）→ GO**。(a) 复用既有 `request.id`（server.ts:111 genReqId UUIDv4），无新 ID 生成、无 Correlation Service、无新增持久化 client_event（纯响应头）；(b) 防伪造性质不变：`requestIdHeader:false` 继续拒收入站头（F7 今日再证实），ID 公开性与 Stripe/GitHub/GitLab/AWS/Cloudflare 全行业实践一致——秘密性在生成权不在 ID 值；(c) playbook 情形 4 已证跨主体冒充 requestId 可被授权模型识破且无授权耦合；(d) 性能代价精确 +52B/响应、无可测吞吐影响（F10）；(e) 不触碰 SaveAnswer 响应体——幂等 verbatim ACK 语义零影响。落地要求：契约（observability docs/OpenAPI 若适用）+ 测试（全响应含 200/4xx/5xx 携带、入站仍忽略）一次成文。
- **865-D SaveAnswer .strict() 响应体增加 requestId → NO_GO**。把传输层身份塞进业务契约，且与协议语义直接冲突：同键重放返回**原 ACK 逐字复用**（F11/T02/R1，savedAt 均为原始接受时刻）——体含 requestId 时重放响应要么携带原请求的 ID（误导关联），要么破坏 verbatim 重放语义；#865 关闭裁决对此方案已是 NO_GO，本次无新证据支持翻案。

### 调查工作流

- **investigation-status-quo（stdout/Pino + jq/时间窗/运维脚本）→ GO**。playbook 七情形中 1/2/3/4/5/7 全部 live 可解 + 跨重启唯一性；LAN/on-prem 部署下部署管理员对 stdout 的 OS 级访问天然构成调查授权（外部对照结论）；零新增攻击面。已知边界如实：并发归因不可分、日志保留期受限（N4→INSUFFICIENT）。
- **investigation-readonly-index → DEFER**。无具体提案满足四前提（Permission/租户约束/字段投影/限流+查询审计）；若指为既有读路径补 DB 索引，属实现细节非新调查面，须先明确 scope 与所有权。不 GO。
- **investigation-endpoint → DEFER**。会在低信任遥测存储之上新开特权读取面——恰是 F4 泄露所在；四前提均未设计，且应在 864-B 落地（投影修复）之后再评估，否则端点会再暴露原始 path。满足四前提 + 864-B 前置后方可重新评估。
- **investigation-admin-ui → DEFER**。调查端点的超集，同一批前提；现状工作流已可解，无运维需求证据支撑新 UI 面。

## 5. issue 裁决（独立，互不绑架）

- **#864（OPEN, DEFER）→ GO（进入施工）**。其 DEFER gate 所等待的「真实链路 live 负例」已由本审计产出并经裁决官独立重放证实（R2/R3，F4）；issue scope 偏好的「单一 canonical、有界服务端摄入投影」即 864-B。按 Issue 同步协议先做 reality audit 更新 scope/acceptance（含 SPA 模板表单一权威与漂移守卫、禁 Sanitizer Framework 约束写入 acceptance），再施工。
- **#865（CLOSED 2026-11-07 13:33:47Z, CLOSE_AS_NOT_PLANNED）→ REOPEN_RECOMMENDED**。关闭裁决明示重开条件：「若未来实测运维工作流需要精确的 200-请求日志查找且能证明缺失 join，重开此窄选项（X-Request-Id 响应头）而非改领域响应」。该条件在关闭**之后**产生了直接证据：investigation-playbook（live，17:05Z 后执行）证明 200 成功响应客户端零可引用 ID、接受类归因仅时间窗推断、并发不可归因（=缺失 join 的实测），performance 变体 B（22:24Z 后）证明代价仅 +52B 无回归。三项均为关闭时不存在的新证据，触发其自设的重开条款；重开范围应锁定 865-C（全站响应头），维持 865-D 的 NO_GO 不变。

## 6. performance 裁决

**PASS**：B/C/D 三变体 144 测点、4 变体交错实测，吞吐/p95/p99/CPU/pg-xact 差值均在 ±3% 噪声带内且方向不一致；响应字节增量精确（B/D +52B，C 零差）；httperr 共模偏差与 pg 元组计数已如实标 INCONCLUSIVE 且不影响结论（见 performance/RESULTS.md 已知局限）。

## 7. 本裁决的限制（如实）

- 重放覆盖 6 项结论；族 5 枚举时序矩阵、族 8 三路径一致性全矩阵、save-answer 矩阵（F8/F11）未在本阶段重跑，引用原始 live 证据（raw log + DB 快照完整）。
- R2 中 scores CSV 由 409 变 200 是环境状态演化（attempt 被 scanner 判 graded），非行为矛盾；顺带完成了原始阶段未完成的 CSV 内容级验证（7 列、无答案内容、0 canary）。
- 日志文件权限域仍为 INFRA_ACCESS_NOT_VERIFIED（F12）；U1–U6 攻击面未测，仅为后续方向。
