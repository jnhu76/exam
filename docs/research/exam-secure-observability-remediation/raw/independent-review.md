# 独立评审记录（INDEPENDENT-REVIEW）

- 轮次：secure-correlation-audit（终稿交付物 9/10）
- 三位裁决官对同一证据底座（baseline/source/external/adversarial/correlation/performance 六线产物）独立出具裁决：`review/security.md`、`review/performance.md`、`review/architecture.md`。安全官另做 6 项关键结论的**独立重放**（R1–R6，`review/replay-*`）；性能官对 144 测点原始 CSV **独立重算**（逐格全等，`summary mismatches: none`）；架构官通读 ADR-025/026 原文并亲验关键源码。

## 1. 三视角职责与边界

| 裁决官 | 视角 | 本阶段实际执行 | 产出 |
|---|---|---|---|
| 安全裁决官 | 红队复查：越权/泄露/信任边界 | R1 跨组织重放、R2 读取面再暴露+分配门、R3 route at-rest、R4 伪造头、R5 引用信任 DB 终态、R6 500 根因 dist 核查（重放脚本与原始脚本仅输出路径不同，diff 已验证） | F1–F12 逐项裁决（1 REFUTED 隐私主张 F4 + 1 REFUTED 可用性主张；其余 CONFIRMED）；U1–U6 未覆盖攻击面清单 |
| 性能裁决官 | 方法论审计 + 机器工作增量 | bench.csv 144 行独立重算、完整性/执行日志核验、脚本精读、变体有效性证据核验、源码核对（runtimeConfig/pg.ts 索引全集）、409 占比重算 | F1–F12（其中 F4 REFUTED：门变体 LEAK_COUNT=2；F7 REFUTED：409 占比表述失准）；六维方法论评估「足以支撑全部结论性主张」 |
| 架构裁决官 | 必要性挑战：能复用就不新增、能小就不大 | 通读 ADR 原文、亲验 clientEvents.ts/server.ts/App.tsx/attempt.ts 等源码、复读六线证据；未运行测试未发请求（LIVE 证据全部引自 campaign 存证并注明） | Q1–Q6 职责问题逐项回答 + 停止清单 10 条 + 最小修复顺序 |

## 2. 三官一致的结论（无分歧）

1. **F4/RT 泄露成立**：route pathname 投影不能阻止敏感值以可还原形式落库并在调查端点再暴露（RT-3/8/12B/12C/14B 双通道证实，重放再证实）——864-A NO_GO、864-B GO、issue864 GO。
2. **requestId 信任模型健全**：服务端 UUIDv4、入站头拒收、伪造/冒充零影响（F7）——requestIdTrust 判 PASS 的依据。
3. **200 关联缺口是实测事实**（F8）：成功与业务拒绝 200 无任何客户端可引用 ID；#865 关闭裁决自设的重开条件被 post-close 证据满足——issue865 REOPEN_RECOMMENDED（3:0）。
4. **865-C 三票 GO、865-D 三票 NO_GO**：响应头方案满足全部硬约束且实测 +52B 封顶；响应体方案与 verbatim 重放语义结构性冲突。
5. **性能无回归**（三官 PASS）：负结果在噪声带内且披露诚实；确定性代价封顶。
6. **调查工作流维持现状 GO（3:0）**；调查端点/UI DEFER 且后置于 864-B。
7. **授权隔离全部 CONFIRMED**：越权负例、引用信任边界、枚举不可区分、三路径一致——authorizationIsolation 判 PASS 的依据。

## 3. 分歧记录（option 级；issue 级三票全一致无分歧）

| 选项 | 安全官 | 性能官 | 架构官 | 归票 | 分歧实质 |
|---|---|---|---|---|---|
| 864-C | DEFER | GO | DEFER | **DEFER（2:1）** | 性能官维度上 C 是 B 的严格工作子集故无性能反对；安全/架构官以信息损失（类别级信号）与 gate(2) 未量化压为 DEFER。无实操影响：C 仅作 B 的回退保留。 |
| 864-D | NO_GO | GO | NO_GO | **NO_GO（2:1）** | 性能官明示其 GO 仅表「机器工作/存储双最小，取舍在关联价值非性能」并接受多数；安全/架构官以过度删除+契约翻搅否决。 |
| 865-A | NO_GO | DEFER | NO_GO | **NO_GO（2:1）** | 性能官自认其维度对 A/C 无区分度、让渡给关联价值裁决（不反对缺口事实本身）；安全/架构官以 post-close 新证据+自设重开条款触发否决维持现状。 |
| 865-B | DEFER | GO | NO_GO | **DEFER（平票取保守，三分歧全记录）** | 安全官：可用但端点不一致非首选；性能官：与 C 同成本类、覆盖最高价值场景；架构官：被支配选项（不省契约成本留其余缺口）。归票取保守 DEFER——**Owner 坚持最小足迹时可接受**（安全官原文）。 |
| investigation-readonly-index | DEFER | NO_GO | DEFER | **DEFER（2:1）** | 性能官以第 7 索引叠加 6 索引热路径的未测写放大直接 NO_GO（F6 medium）；安全/架构官因无四前提具体提案 DEFER。共识：现状无任何形式的 GO；未来重提须先过 scope/所有权 + 同 harness A/B。 |

## 4. 裁决官发现的报告级修正（已吸收进终稿）

- 性能官 R1/R2/R3：RESULTS.md 三处表述失准（409 占比 ~2%→实为 4.3–5.0%；httperr 偏差范围；+51~55B 系均值与每响应 53B 混述）——PERFORMANCE-RESULTS.md §4 已修正呈现，结论不动摇。
- 性能官 F4：**门变体 ≠ 完整 864-B**（LEAK_COUNT=2，已知根下尾段字节仍落库）——已写入 ARCHITECTURE-OPTIONS §1 B 行落地约束（参数化不可降级+canary 矩阵验收）。
- 架构官 Q5：同一发现的独立推导（root-allowlist 定义即保留尾段；敌意真根+秘密尾段组合未入 canary 集，已标注推导性质）——两官从不同路径收敛到同一约束，交叉印证。
- 安全官 R2：scores CSV 409→200 系环境状态演化（attempt 被 scanner 判 graded）非行为矛盾；顺带完成 CSV 内容级验证（7 列、无答案内容、0 canary）。

## 5. 三官共同声明的限制（如实）

- 安全官：重放覆盖 6 项结论；族 5/8 全矩阵、save-answer 矩阵未在本阶段重跑（引用原始 live 证据，raw log+DB 快照完整）；U1–U6 未测。
- 性能官：B/C/D 源码 diff 未留档（复现性缺口 F10）；dev 模式绝对值不代表生产构建。
- 架构官：本阶段只读，LIVE 证据全部引用 campaign 存证；`server.requestId.test.ts` 未执行（引用源码精读+campaign live 实验）。
- 共同：日志文件权限域 INFRA_ACCESS_NOT_VERIFIED；生产 APP_MODE 限流行为未测（U2）。

## 6. TRUST-BOUNDARY-DAG.mmd 格式校对记录（终稿交付物 3）

对 `TRUST-BOUNDARY-DAG.mmd`（综合师生成）做格式校对：静态检查通过——所有含括号/花括号的节点与边标签均在引号内（`ID["…"]` / `-->|"…"|` 形式）、引号 86 个成对、subgraph/end 配对完整、`%%` 注释合法；本机无 mmdc，未做渲染级验证（如实标注）。**未修改任何语义内容**（文件保持原样）。图中标注体系（SV/LV/IV）与 source/field-provenance.md 一致；IV（INFRA_ACCESS_NOT_VERIFIED）仅出现在 nginx 运行时行为与 Pino 读取权两处，与本终稿 §7 三类权限域结论一致。

**呈现局限（读者注意，独立审读修订补充）**：DAG 的 H 节点（「normalizeRouteForStorage(仅 pathname)」）与 CEV 节点（「route 仅 pathname」）是对 **as-built 摄入行为的事实陈述**，不是安全有效性评价——本轮唯一 REFUTED 结论恰是「pathname-only 不足以脱敏」（RT-3/RT-8/RT-12B/12C/14B 以原样/单次解码可还原形态落库并经已授权读取面再暴露，见 ADVERSARIAL-TEST-RESULTS.md §2 与 review/security.md F4）。按任务约束「校对格式但不得改语义」，本轮**未在 DAG 内挂泄露标注节点/边**；单看 DAG 不应得出「route 已消毒」的结论——泄露通路与裁决以终稿 5 号（ADVERSARIAL-TEST-RESULTS）与 10 号（FINAL-VERDICT）文件为准，FINAL-VERDICT §6 交付物清单已加同款指路注记。
