# 架构选项裁决（ARCHITECTURE-OPTIONS）

- 轮次：secure-correlation-audit（终稿交付物 8/10）
- 汇总来源：`review/security.md`（安全裁决官）、`review/performance.md`（性能裁决官）、`review/architecture.md`（架构裁决官）三份独立裁决。
- 归票规则：每项取三裁决官多数；平票取保守值（DEFER/KEEP_CLOSED/INCONCLUSIVE）并记录分歧。option 级分歧在每节末尾注明。

## 1. #864 route 存储安全（A–D）

| 选项 | 安全官 | 性能官 | 架构官 | **归票** | 关键证据与理由（含误删率/兼容性/CPU 成量） |
|---|---|---|---|---|---|
| A 维持现状 | NO_GO | NO_GO | NO_GO | **NO_GO（3:0）** | pathname 投影控制目标被 LIVE 双通道证伪（F4：RT-3/RT-8/RT-12B/RT-12C/RT-14B 原样/单次解码可还原落库并经已授权 proctor-events 再暴露，裁决官重放 R2/R3 今日再证实 12 canary）；perf 实验自身 http-canary 证实变体 A 库存 `/password-reset/<canary>` 等泄露 route。#864 自设 gate「真实链路 canary 负例」已满足——维持现状=保留已证实泄露通路。零性能收益。 |
| **B 服务端投影为稳定 route 模板（动态标识符参数化、未知路径置空）** | GO | GO | GO | **GO（3:0）** | 唯一同时：①关闭全部泄露通路（未知→null 覆盖五类 canary；模板化移除 path 段标识符/secret，**客户端字节零保留**）；②保留时间线合法信号（哪场考试哪一页）服务调查工作流；③符合 #864 scope 偏好「单一 canonical、有界服务端摄入投影」。兼容性：wire schema 不变（route 仍 string 1..500）、存储仍 `string|null`（无迁移/新持久字段）、读取面零改动。CPU：实测门变体零可测开销；完整参数化为同量级纯字符串工作（<10µs/事件 vs 2.3–2.9ms CPU/req，INFERRED 但被 ±3% 噪声带封顶）。**落地约束**：模板表单一权威（共享常量 @exam/contracts 优先，否则 API 表+对 App.tsx 52 模板的漂移守卫）；段级线性匹配禁回溯正则；**禁用 `request.routeOptions.url`**（API 模板≠SPA 导航路径）；禁通用 Sanitizer Framework、禁新 schema/迁移/持久字段；31 只 canary 类+真根+秘密尾段组合作回归验收（性能官 F4：root-allowlist 门变体 LEAK_COUNT=2，参数化不可降级）。 |
| C 只保留有限 route category/name | DEFER | GO | DEFER | **DEFER（2:1，性能官 GO 分歧记录）** | 同样关闭泄露但把信号压到类别级（丢失 per-exam/per-attempt 页面上下文，损害调查工作流）；架构官补充：**并不比 B 小**——正确分类必须先有 B 的全部模板知识再丢弃更多信息；#864 gate(2) 调查效用损失量化未完成。作为 B 的回退保留。性能官视角：机器工作为 B 的严格子集（未单独测量，子集论证成立），故无性能反对。 |
| D 完全停止存储 route | NO_GO | GO | NO_GO | **NO_GO（2:1，性能官 GO 分歧记录）** | 过度删除已授权且正常工作的诊断信号：泄露可用 B 关闭而无需砍功能；且是全部发送方 wire/存储契约翻搅+读取面改动，违背最小长期正确改动。性能官立场：机器工作与存储字节双最小、性能视角无反对——但取舍在时间线关联价值（非性能维度），接受多数 NO_GO。 |

## 2. #865 请求关联（A–D）

| 选项 | 安全官 | 性能官 | 架构官 | **归票** | 关键证据与理由 |
|---|---|---|---|---|---|
| A 维持现状 | NO_GO | DEFER | NO_GO | **NO_GO（2:1，性能官 DEFER 分歧记录）** | 无安全暴露（F7/F8：伪造头零影响、信封机制健全），但 playbook live 证明（关闭决策 13:33:47Z **之后**的新实测证据）：200 成功报障客户端零可引用服务端 ID（pb-02 头清单+契约无字段）、接受类归因仅 ±150ms 时间窗推断（窗内 5 候选需状态码过滤）、并发不可归因（T08）——即 #865 关闭文本自设重开条件「实测运维工作流需要精确的 200-请求日志查找且能证明缺失 join」已被满足。性能官：性能与 C 无可分辨差异、视角无区分度，交由关联价值裁决（同意缺口存在，仅不以其维度定 NO_GO）。 |
| B 仅 SaveAnswer 增加 X-Request-Id 响应头 | DEFER | GO | NO_GO | **DEFER（平票取保守，三分歧全记录：DEFER/GO/NO_GO）** | 覆盖最高价值场景且契约面最小（性能官：与 C 同成本类），但安全官指出制造端点不一致（其余 200 端点同缺口仍在）且错误信封已是全局机制——单端点头是局部补丁；架构官判「被支配选项」：不省任何契约类成本、留全部其他缺口、制造表面不一致，SaveAnswer 专属缺口若 Owner 拒绝 wire 变更应由 info 日志行（非 wire）解决。**Owner 坚持最小足迹时可接受，不作首选**。 |
| **C 全站统一服务端生成 X-Request-Id 响应头（复用 request.id）** | GO | GO | GO | **GO（3:0）** | 复用既有 `request.id`（server.ts:111 genReqId UUIDv4，微基准 103.3ns 属共同存量）纯响应头：无新 ID 生成、无 Correlation Service、无新增持久化 client_event（候选硬约束全满足，性能官 F5 实测日志 Δ≤0.1%、pg xact 零增量）。防伪造性质不变：`requestIdHeader:false` 继续拒入站头（F7 今日再证实；出站回显同名头不产生回授——E1a–f 已证入站零读取）。ID 公开性为 Stripe/GitHub/GitLab/AWS/CF 全行业实践。跨主体冒充可被授权模型识破且与授权零耦合（playbook 情形 4）。代价实测精确 +52B/响应无回归。不触碰 SaveAnswer 响应体——verbatim ACK 语义零影响。**落地要求**：契约（observability.md 以 ADR-025 为权威更新为第四载体，无需 superseding ADR）+ 全响应测试（200/4xx/5xx 携带、入站仍忽略、遥测回显仍 client_claimed）一次成文；跨域读取场景补 Access-Control-Expose-Headers（同源 nginx 拓扑下非必需）；onSend 内禁新增日志调用。 |
| D SaveAnswer .strict() 响应体加 requestId | NO_GO | NO_GO | NO_GO | **NO_GO（3:0）** | 传输身份进业务契约且与协议语义结构性冲突：同键重放逐字复用原 ACK（T02/R1 实测 savedAt 为原始时刻），体含 requestId 则重放要么携带原请求 ID 误导关联、要么破坏 verbatim 重放；业务 Schema 塞传输身份属层次错位；#865 关闭裁决对该形态已 NO_GO，无新证据翻案（架构官：永不翻案项）。 |

## 3. 调查工作流方案

| 方案 | 安全官 | 性能官 | 架构官 | **归票** | 关键证据与理由 |
|---|---|---|---|---|---|
| 现状（stdout/Pino + jq/时间窗/运维脚本） | GO | GO | GO | **GO（3:0）** | playbook 七情形中 1/2/3/4/5/7 live 可解 + 跨重启唯一性（489+6 reqId 零交集）；LAN/on-prem 下部署管理员对 stdout 的 OS 级访问天然构成调查授权（外部对照：GitLab self-managed 同构）；零新增攻击面、产品侧机器工作为零。已知边界如实：并发归因不可分（AMBIGUOUS 为既定三态语义）、日志保留期受限（N4→INSUFFICIENT 为诚实降级非待修 bug）。 |
| 新增只读索引 | DEFER | NO_GO | DEFER | **DEFER（2:1，性能官 NO_GO 分歧记录）** | 无满足四前提（Permission/租户约束/字段投影/限流+查询行为审计）的具体提案；若仅为既有读路径补 DB 索引属实现细节，须先明确 scope 与所有权、无实测查询痛点。性能官 NO_GO 依据（F6, medium）：client_events 已有 5 复合+1 唯一共 6 索引（pg.ts:1141-1172），events 热路径 10 行 INSERT/请求为 DB 写密集——第 7 索引=未测量的每行索引维护写放大，且现有 (org, received_at) 已覆盖时间窗查询形态；若未来重提须同 harness A/B。 |
| 调查端点 | DEFER | DEFER | DEFER | **DEFER（3:0）** | 在低信任遥测存储上新开特权读取面——恰是 F4 泄露所在；四前提均未设计。**前置依赖：864-B 投影修复落地后再评估**，否则端点会再暴露原始 path（架构官排序约束）。满足前提+864-B 前置+自测查询成本后方可重新评估。 |
| 管理 UI | DEFER | DEFER | DEFER | **DEFER（3:0）** | 调查端点的超集、同一批前提；现状工作流已可解，无运维需求证据支撑新 UI 面。 |

## 4. Issue 级归票（最终值，与 FINAL-VERDICT 一致）

| 项 | 安全官 | 性能官 | 架构官 | **归票** |
|---|---|---|---|---|
| issue864Verdict | GO | GO | GO | **GO（3:0，无分歧）** |
| issue865Verdict | REOPEN_RECOMMENDED | REOPEN_RECOMMENDED | REOPEN_RECOMMENDED | **REOPEN_RECOMMENDED（3:0，无分歧）** |
| performanceVerdict | PASS | PASS | PASS | **PASS（3:0，无分歧）** |

- #864 GO 的含义：DEFER gate (1) live 负例已产出并经裁决官双通道重放证实；issue 自述偏好「单一 canonical、有界服务端摄入投影」即 864-B。按 Issue 同步协议先做 reality audit（把本审计负例、五类 canary 通路、真根+尾段残留风险、模板表单一权威与漂移守卫、禁项写入 scope/acceptance）再施工。
- #865 REOPEN_RECOMMENDED 的含义：**不是推翻 Owner 决定，而是执行其自设条款**——关闭文本明示重开条件，该条件在关闭后被三份 post-close 证据满足（playbook 情形 1/3/6=缺失 join 实测 17:12Z；performance 变体 B=代价实测 22:24Z；关闭时二者均不存在）。重开范围锁定 865-C（含 info 日志行替代项的对比裁决）；865-D 的 NO_GO 维持不变。**重开是 Owner 动作，本轮不自动执行**。

## 5. 过度工程停止清单（架构官 §Q6，三官无异议）

①Correlation Service/中央 ID/实例注册表/ULID（ADR-025 明令）；②OTel/traceparent 采纳（契约 non-goals+重审触发器未满足）；③每次成功请求的 audit 行或 client_event 持久化（存储放大，契约明文「不是每个请求都产生 audit 行」）；④receipt 增 request 标记列/durable refusal 表/复活 attempt.saveAnswer（#861/#866/#800 冻结，并发 AMBIGUOUS 是既定语义）；⑤通用 Sanitizer Framework/per-event-type schema（#864 禁前者，后者独立 Owner gate）；⑥route 新 schema/迁移/持久字段；⑦`request.routeOptions.url` 当 SPA 模板来源（对象错误）；⑧调查端点/UI 先于 864-B 或缺四前提；⑨中央日志存储/保留平台（N4 INSUFFICIENT 是诚实降级）；⑩重开 865-D（结构性冲突永不翻案）。

## 6. 推荐架构（一句话）

**864-B（封闭模板投影，客户端字节零保留）+ 865-C（全站 X-Request-Id 响应头复用 request.id）+ 调查工作流维持现状**；两者相互独立可并行（唯一排序约束：任何调查端点必须后置于 864-B）。
