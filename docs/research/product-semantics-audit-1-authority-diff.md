# EXAM-BOUNDED-PRODUCT-SEMANTICS-AUDIT-1 — Phase 2: Authority Comparison

- BASE = CODE_REALITY_FREEZE_SHA = `0b893262`
- Phase-1 输入：`docs/research/product-semantics-audit-1-code-reality.md`（已冻结；本报告不得反向修改其对代码事实的描述。corrective-1 例外：仅移除 Phase-1 中的文档裁决注记以恢复冻结纯度，代码事实未变。）
- Phase-2 阅读顺序遵循 §15：contracts（timed-sync-semantics、exam-policy-authority）→ SPEC §2.5-2.7/§2.2/§3 → architecture（exam-runtime §3.1.1）→ issue（#294 body、#516 tracker）。
- 判定维度：CODE REALITY（Phase-1）vs NORMATIVE INTENT（下表各 authority），不使用"code wins/docs wins"。

---

## 1. Comparison matrix

| Semantic | Code reality (Phase-1) | Contract | SPEC | Architecture | ADR | Issue | Verdict |
|---|---|---|---|---|---|---|---|
| Exam 状态机/转换 | SC-01 | exam-policy-authority 层级模型 | SPEC:454-467,484-495 | exam-runtime | ADR-005 Accepted | — | **ALIGNED** |
| Attempt 状态机 | SC-02（表部分装饰、grading 不持久化、4 态主流程） | — | SPEC:484 明示“仅 4 态进入主流程” | — | — | — | **ALIGNED**（SPEC 已如实降格）；装饰表本身归入 S-1 |
| 服务端时间权威 | SC-03/C7 | — | SPEC §2.5 | exam-runtime | ADR-006 Accepted | — | **ALIGNED** |
| timing modes | 3 可 author + timed_sync 运行时在、authoring 无、T0 写者无 | timed-sync-semantics.md：Model A 冻结，拒绝口**故意保留**至 activation slice | SPEC §2.5 四模式示例（含 timed_sync 目标态） | — | — | #516 Phase B | **LATENT_POLICY**（文档化 latent；timer.ts:84 注释与代码矛盾 → corrective） |
| minSubmit 双点强制 | SC-05/C14 | — | SPEC §2.5 | — | — | #395 已闭 | **ALIGNED** |
| Admission as-built（anchor/ordinal/双计数/首批即放/批不满照放/无 manual admit/只读 admin 端点） | SC-06/SC-07, C10/C11/C15 | — | SPEC §2.6（#292 已交付行） | exam-runtime §3.1.1 **逐条文档化**（含“UI position 可提前、entitlement 不变”） | — | #292 CLOSED | **ALIGNED**（机制面）；晚加入即时获准推论 → **UNDERSPECIFIED**（H-1/H-2） |
| estimatedWaitSeconds 公式 | SC-07/A-2 | contracts QueueStatusResponse | — | exam-runtime 只写放行数，未写等待估计公式 | — | — | **UNDERSPECIFIED**（展示精度无 owner） |
| 发布冻结/开考拷贝/发布后不可变 | SC-08/C5/C13 | exam-policy-authority：Layer B 冻结权威 | SPEC:463 | exam-runtime | ADR-005/008 | — | **ALIGNED** |
| 身份化答题/评分 | SC-09/C4 | — | SPEC §3 | — | ADR-008 | #294 body 明认 | **ALIGNED** |
| 答案版本协议 | SC-10/C20 | — | SPEC | exam-runtime | ADR-008 | — | **ALIGNED** |
| 评分公式/精度 | SC-11（无舍入，浮点和） | — | — | — | — | — | **UNDERSPECIFIED**（小数累加精度无测试无约定） |
| 手工评分 hold/无 regrade | SC-12/C12 | — | — | — | ADR-008 | — | **ALIGNED** |
| 结果可见性/发布 | SC-13/C8；mode 权威=`resultPublicationMode` | exam-policy-authority:225 三模式 | SPEC 含 `publishResults` 动作（:496），但缺当前三模式发布模型与可见性真值表 | — | — | — | **DOC_STALE**（发布模型/真值表缺失） |
| shuffle 两旗标 | L-1/L-2：stored+candidate-visible+零读者 | contracts 定义；exam-policy-authority:114 **LATENT (stored, not enforced) 已裁决** | SPEC §2.6 列为管控项（开/闭卷预设）+ :1045 Phase2 能力 | — | — | #294 body：“latent policy fields” | **LATENT_POLICY**（#294 持有；SPEC 行未标 runtime 缺失，有冻结风险） |
| detectTabSwitch | L-3/SC-23：旗标仅门控横幅；检测→持久化→监考 warningLevel 管线存在且**不受旗标门控**；无 incident/处置流 | — | SPEC:315/1046 “Phase 1 minimal behavior；处置 Phase 2” | exam-policy-authority:115 **LATENT（client hint, listener unconditional）已裁决** | — | — | **LATENT_POLICY**（文档化；残留=旗标/行为解耦的呈现决策） |
| disableCopyPaste | L-4：无禁用代码，仅横幅 | exam-policy-authority:116 **binding**：“client warning banner only — LATENT (client hint)” | SPEC:316/1047 “前端禁用右键/选择/复制” | — | — | — | **DOC_STALE**（SPEC 行为表述 vs 更具体的 binding authority 已收敛为 banner-only；初判 CODE_DRIFT 经 adversarial review 撤销） |
| restrictIp / requireLockdown | L-5/L-6 零读者 | — | SPEC:320-321 标 [Phase 2]/[Deferred] | — | — | — | **ALIGNED latent**（已文档化） |
| questionSelectionMode random | L-7 publish 拒绝 | contracts | — | — | — | — | **DEAD_SEMANTIC** |
| voided | 无生产者、多消费者 | — | SPEC:143 “Phase 2+ / planned，无管控入口” | — | — | — | **ALIGNED dead**（文档化；ENG/types.ts declare 存根与 SPEC 一致） |
| published≡open 开考等价 | SC-14/C17 | — | SPEC:465 记录惰性 open，未声明考生等价 | — | — | — | **UNDERSPECIFIED** |
| unpublish “未开考”守卫 | 显式守卫不存在；由 reconcile-first+转移表间接成立 | — | SPEC:464 声明该守卫 | — | — | — | **ALIGNED（间接）**，脆弱性备注 |
| 心跳/扰动 | SC-15/C19；30s 扫描/60s 超时可配 | — | SPEC:38/139 记录同值 | exam-runtime | ADR-012/013 | #303/#304 待做 | **ALIGNED**；容忍度归属 → **UNDERSPECIFIED**（H-5） |
| 恢复/操作员命令 | SC-15/16 | — | SPEC:38-39/594（J6 未实现=准确） | — | ADR-012/013/014 | #303/#304 | **ALIGNED** |
| 客户端遥测/监考监控（SC-23） | 采集无条件、计数+warningLevel+只读监考面已交付 | — | SPEC §4.5:827-829 “监考端 Phase 1 不实现”（过期）；:1046 防切屏 minimal 行为 | — | ADR-015 **Accepted** | #303/#304 后续 | **ALIGNED** + SPEC §4.5 **DOC_STALE** |
| RBAC/审计 | SC-17/18 | — | — | authorization.md | ADR-010/014/015 | — | **ALIGNED** |
| retakeCooldown | 字段不存在 | — | SPEC §2.6 行存在（0/60 分钟）无 Phase 标记 | — | — | — | **DOC_STALE**（无 runtime 载体） |
| 控制旗标缺省物化 | SC-20（Zod v3 语义依赖） | contracts `.default({})` | — | — | — | — | **UNDERSPECIFIED**（升级隐患无护栏） |
| retake 终止谓词/开窗判定/过期比较多点实现 | S-1/S-2/S-3/S-6/S-7 | — | — | — | — | — | **MULTIPLE_AUTHORITIES**（当前全对齐，无共享 seam） |
| exam-policy-authority §4 矩阵 | untimed/deadline 已交付（PR #388、E2E timing-modes） | 该文档自身 | — | — | — | — | **DOC_STALE**（:122 行仍标 NOT IMPLEMENTED） |
| SPEC §2.6 脚注 Phase 框架 | force submit/extend/misconduct 均已实现并有 E2E | — | SPEC §2.6 脚注列为 Phase 2 | — | — | — | **DOC_STALE**（Phase 框架落后于代码） |

---

## 2. 按方向分类（§17）（经 adversarial review 修订）

### CODE_DRIFT（规范明确、代码另做）
（无——初判的 disableCopyPaste CODE_DRIFT 经评审撤销：`docs/contracts/exam-policy-authority.md:116` 为更具体的 binding authority，已将语义裁决为 "client warning banner only — LATENT (client hint)"，SPEC:316 是过期一方 → 归入 DOC_STALE。）

### DOC_STALE（代码+更强权威已前进，文档停留）
1. **SPEC §2.6 缺 resultPublicationMode 三模式模型与可见性真值表**（发布动作 `publishResults` 已在 SPEC:496 记载——初版“手动发布动作缺失”表述经评审收窄）。权威：exam-policy-authority:225。
2. **SPEC §2.6 `retakeCooldown` 行**：代码全仓无该字段（TS 与迁移 SQL 均无），行未标 Phase。
3. **exam-policy-authority.md:122**：将 untimed/deadline 与 timed_sync 并标 NOT IMPLEMENTED；Phase A 已交付（PR #388、E2E timing-modes.spec）。
4. **exam-policy-authority.md:118**：Queue admission “none at runtime — LATENT (Phase 2)”——#292 已交付运行时（同文档其余行已被 #292 closeout 更新，此行遗漏）。
5. **SPEC §2.6 脚注**：将 force submit、extend、misconduct marking 列为 Phase 2，三者均已实现并测试。
6. **SPEC §4.5（:827-829）“监考端 Phase 1 不实现”**：只读监考监控面已交付（SC-23；ADR-015 Accepted）；SPEC:1046-1047 “防切屏 minimal / 排队分批 Phase 2”中排队分批已交付。
7. **SPEC §2.6 disableCopyPaste 行（:316/1047）**：与 binding authority exam-policy-authority:116 冲突，后者收敛为 banner-only LATENT。
8. （微）SPEC `maxRetakeAttempts` 命名 vs 契约 `maxAttempts`。
9. （代码注释，非 docs）timer.ts:84 称 “operator start command (B2) persists T0”——B2 不存在于代码（timed-sync 契约文档本身准确）。

### UNDERSPECIFIED（代码择一行为、无权威声明该行为是有意的）
1. **晚加入/重考在批次时刻表已流过时立即获准**（H-1/H-2，合并计数）：exam-runtime §3.1.1 文档化了机制（批不满照放、entitlement 不变），但“历史 release capacity 已流逝使晚加入零额外等待”这一用户可见推论无任何权威声明为产品意图；且可被策略性利用（等批次流过后入队）。
2. **published≡open 考生等价**（SC-14）。
3. **评分浮点累加无精度约定**（SC-11 + U-2）。
4. **等待估计公式的精度/语义**（A-2；与 H-1/H-2 分立保留）。
5. **控制旗标缺省物化依赖 Zod v3 default-through-parse**（SC-20）：v4 语义（短路返回）下 `.default({})` 不再填充嵌套默认值 → requireQueue 等旗标消失 → 准入门静默失效。无护栏测试。
6. **心跳容忍度归属**（H-5）：部署配置（默认 60s）vs 客户端 30s 常量，2:1 为隐式。

### MULTIPLE_AUTHORITIES
1. attempt 终态集合：engine 状态机 vs forceSubmitExecution.ts:347-370 vs submitAndGradeAttempt.ts:92-104/156-180 vs web terminalAttemptSignal.ts vs attempts.shared.ts lockReason（S-1）。
2. “考试已结束”谓词：scores.ts:142-157 与 exam.ts:193-233 两份 route 内联、engine 无对应（S-2）。
3. 过期比较：timer.ts 自称 SOLE authority，attempts.shared.ts:151 第二实现（S-3）。
（全部当前对齐；漂移途径存在。）

### LATENT_POLICY
shuffleQuestions、shuffleOptions、restrictIp、requireLockdown、timed_sync（全链）、questionSelectionMode:"random"、detectTabSwitch（旗标作为控制项为 latent——检测行为本身存在但不受门控，见 L-3/SC-23）——全部已被 exam-policy-authority §4 矩阵、SPEC Phase 标记或 #294/#516 持有者文档化；无一被误当 implemented capability。

---

## 3. Top 20 风险排序发现（§18/§23）（经 adversarial review 重排）

| # | P | 发现 | 依据 | 后果类型 |
|---|---|---|---|---|
| 1 | P1 | 晚加入/重考在其序位的历史批次边界已流逝时立即获准（复用已流逝的历史 release capacity，零额外等待），可策略性利用 | H-1/H-2/A-11 | 可观察 + 弱权威 + 冻结风险最高 |
| 2 | P1 | SPEC §2.6 缺失成绩发布三模式模型与可见性真值表（发布动作已记载，模型缺失） | DOC_STALE-1 | 产品契约缺口，多端可见 |
| 3 | P1 | 控制旗标族“旗标≠行为”解耦：切屏检测无条件采集不受门控、复制粘贴/shuffle 无行为、监考已见 warning 级——作者侧无法通过旗标表达真实管控强度，仅横幅变化 | L-3/L-4/SC-23 + epa:114-116 | 用户可见 + 权威歧义（残留为文案/呈现决策与处置流缺位，后者 SPEC 标 Phase 2） |
| 4 | P2 | shuffle 旗标 latent 但 SPEC 列为管控项且考生可见 → #294 必须收编或降格，否则双载体 | L-1/L-2 | 冻结风险 |
| 5 | P2 | 队列卡死无运行期补救（发布后 flags 冻结+无 manual admit），unpublish→republish 对存量 admissions 语义未定义 | H-3/H-4/SC-22 | 运营风险 + 语义洞 |
| 6 | P2 | voided：无生产者、5+ 处消费者；SPEC 标 planned；死分支测试占用 | §8 | 维护 + 认知 |
| 7 | P2 | published≡open 考生等价未声明 | SC-14 | 权威歧义 |
| 8 | P2 | 向导 passingScore=round(60% 总分) 客户端启发式固化为 per-exam 持久策略 | A-8 | 意外契约 |
| 9 | P2 | route 层三组重复谓词（终态集/已结束/过期比较） | S-1/S-2/S-3 | 漂移风险 |
| 10 | P2 | timed_sync latent 文档化 + 代码注释谎称 B2 存在 | L-8/§12-1 | 认知陷阱 |
| 11 | P2 | Zod v3 default-through-parse 依赖；v4 升级静默破坏 requireQueue 门 | SC-20 | 升级隐患 |
| 12 | P2 | SPEC §4.5“监考端 Phase 1 不实现”+ epa:118“queue none at runtime”双过期（已交付面未回写） | §12-6/7 | 文档失真（面大：运营与监考域） |
| 13 | P3 | SPEC retakeCooldown 行无 runtime 载体 | DOC_STALE-2 | 文档失真 |
| 14 | P3 | exam-policy-authority:122 行 untimed/deadline 标注过期 | DOC_STALE-3 | 文档失真 |
| 15 | P3 | SPEC §2.6 脚注 Phase 框架落后（已交付列为 Phase 2） | DOC_STALE-5 | 文档失真 |
| 16 | P3 | SPEC:1046/1047 防切屏/排队分批 Phase 标记过期 | DOC_STALE-6 | 文档失真 |
| 17 | P3 | 边界方向约定不一致（>=、>=、>、<）未命名 | A-4 | 认知 |
| 18 | P3 | 心跳容忍度归属（部署 vs 产品） | H-5 | 权威歧义 |
| 19 | P3 | estimatedWaitSeconds 仅整 batch 粒度、route 层无数值断言 | A-2/U-1 | 展示精度 |
| 20 | P3 | 多选 Set 去重（API 层可观察） | A-5 | 边缘语义 |

（adversarial review 处置：原 #20 admission id 平序降为实现细节移出 Top 20；原 #1/#2 旗标发现合并重写为 #3；“位次改善”因 exam-runtime:277 已文档化而改判 ALIGNED——Phase-1 §5 的 A-1 行保留为 raw 观测（corrective-1 恢复冻结纯度），分类计数以本报告为准。）

---

## 4. DOC_CORRECTIVE_CANDIDATES（§21——只列不改）

1. SPEC §2.6：补 `resultPublicationMode` 三模式 + 可见性真值表（publishResults 动作已在 :496，无需重复）。
2. SPEC §2.6：`retakeCooldown` 行加 Phase 标记或删除；`maxRetakeAttempts` → `maxAttempts` 对名。
3. SPEC §2.6 脚注：Phase 框架刷新（force submit/extend/misconduct 已交付）。
4. SPEC §2.6：shuffle 两行加 “runtime: #294” 标记，防止 latent 被读作能力。
5. exam-policy-authority §4：:118（queue runtime 已交付）与 :122（untimed/deadline 已交付、timed_sync latent）行刷新。
6. SPEC §4.5 / :1046-1047：监考面已交付（只读轮询子集）、排队分批已交付、防切屏 minimal 行为补记（横幅+无条件遥测）。
7. timer.ts:84 注释更正（B2 未实现）。
8. exam-runtime §3.1.1：补一句“晚加入者在其 batch 边界已过时立即获准”的明示（或记录待产品决策）。
9. UI 文案候选（tabSwitchWarning/copyPasteWarning）：与实际行为对齐（检测存在但无处置流；复制粘贴无行为）——属产品决策，非文档机械修正。

## 5. Open product decisions（不替人决定）

1. 晚加入/重考 vs 已流过时刻表：保持“时刻表推进”（现状）还是改为“实际等待人数推进”或加入场券重置？（影响 #294 之外的公平性叙事）
2. 队列故障补救：是否引入 manual admit（需授权+审计设计），以及 unpublish→republish 是否重置 admission epoch。
3. 控制旗标族收编：切屏/复制粘贴/shuffle 三旗标的 Phase-1 语义统一为“横幅+遥测提示”（现状，需文案对齐）还是补行为（新工作量）；切屏处置流是否随 #303/#304 提前。
4. 心跳容忍度：维持部署配置（文档化默认 60s）还是下沉为考试策略字段。
5. 向导 60% 及格线默认：保留客户端启发式 or 服务端默认值权威化。
6. published≡open：文档化等价 or 强制 open-only 门控。
7. （随 #294）shuffle 载体=既有 controlFlags（SPEC 预设表已暗示）；seed 采纳与否为可选实现选择（快照冻结最终序已满足确定性要求），若采用则需定持久化位置与确定性范围。

---

## 6. Final classification（§26）（adversarial review 后修订版 v2）

```text
PRODUCT_SEMANTICS_AUDIT-1
BASE=0b893262

TOTAL_SEMANTIC_CARDS=23          (v2: +SC-23 监控遥测域)

ALIGNED=15                       (原 14 + SC-23)
DOC_STALE=7                      (SPEC 发布模型 / retakeCooldown / epa:122 / §2.6 脚注 / disableCopyPaste SPEC 行 / SPEC §4.5+1046-1047 / epa:118)
CODE_DRIFT=0                     (初判 1 项经评审撤销为 DOC_STALE)
UNDERSPECIFIED=6                 (H-1/H-2 合并一项, published≡open, 评分精度, 等待估计, Zod 依赖, 心跳归属)
MULTIPLE_AUTHORITIES=3           (终态集 / 已结束谓词 / 过期比较——均 route 层)
LATENT_POLICY=7                  (shuffle×2, restrictIp, requireLockdown, timed_sync, random, detectTabSwitch 作为控制项)
ACCIDENTAL_SEMANTIC=1            (60% 及格线启发式；原 5 项中 4 项经评审改判为已文档化或并入其他类)
DEAD_SEMANTIC=6                  (voided, daily/weekly_limit, InputMode/GradingMode, random, declare 存根)
UNKNOWN=0

P0=0
P1=3
P2=9
P3=8

BLOCKS_#294=no
```

注：类别**非互斥**——同一语义可同时计入多类（如 `questionSelectionMode:"random"` 既在 LATENT_POLICY 又在 DEAD_SEMANTIC）；计数按发现条目归档，不做跨类去重。

Correctness defect：**未发现**，未触发 §0 的 defect-issue 分支。多数高价值不变量（C1-C16、C19、C20）有可执行证据；C17（published≡open）为结构推断、无显式测试；C18 的“无舍入”算术形态由代码证实，而精度边界行为未测试（U-2）。发现的缺口全部为 latent/文档/权威归属类，不构成 current-product reproducible correctness defect。

TOP_10_PRODUCT_SEMANTIC_RISKS = 上表 #1-#10。

## 7. Roadmap interaction（§27）

```text
建议：CONTINUE_TO_#294
```

理由：#294 的机制面（身份体系、冻结快照、per-attempt seam、order 字段、id-based grading）全部 READY——开考拷贝点重排一次、快照冻结最终序即满足确定性顺序要求；其策略面（载体旗标、组合、冻结点）恰是 #294 issue 自身声明的决策空间，SPEC §2.6 与 exam-policy-authority:114 已暗示载体为既有 controlFlags；seed 为可选实现选择而非前提。未发现 BLOCKS_#294 级语义缺口或 correctness defect。

附带建议（不改变顺序、不 tick roadmap）：
- #294 施工前在 Issue 内确认载体（既有 shuffle 旗标）与冻结点（开考拷贝、快照冻结最终序）；seed 采纳与否为该 Issue 内的可选实现选择。
- Open decisions #1/#2（admission 公平性/补救）建议作为独立产品决策记录，不阻塞 #294/#303/#304。
- #516 tracker 的 “[ ] #292 completed and closed” 复选框与 issue 现实（CLOSED）不一致——按 §27 不自动改，仅记录。

## 8. Adversarial review 记录（§24）

- Reviewer：fresh-context，未参与审计，独立从代码重推导（verdict：REQUEST_CHANGES → 修订后 PASS 面貌见下）。
- Blocking×2 已吸收：① detectTabSwitch 发现重推导并改判（检测管线存在、unconditional、epa:115 已裁决）→ L-3/A-10/Top-20/分类全部重写；② SC-23 监控遥测域补录语义地图 + SPEC §4.5 DOC_STALE 行。
- Nonblocking 全部吸收：disableCopyPaste 方向改判 DOC_STALE；“位次改善”改判已文档化；H-1/H-2 与等待估计去重计数；id 平序移出 Top 20；DOC_STALE-1 收窄（SPEC:496 已记载 publishResults）；SPEC:1046-1047 过期行补录。
- 审计新增（评审未提出）：epa:118 queue 行 #292 后过期（§12-6）。
- 核心结论在评审前后一致：P0=0、无 correctness defect、BLOCKS_#294=no、CONTINUE_TO_#294。
- corrective-1（人工 review REQUEST_CHANGES 后吸收）：① Phase-1 恢复冻结纯度——SPEC/exam-policy-authority/ADR/exam-runtime 裁决与“已文档化”注记全部移入本报告（L-3/L-4/A-1/A-10/SC-23/§12-6,7，代码事实未变）；② #294 seed 过度声明撤销（ROADMAP_ENTRY_BLOCKED=NO，seed → OPTIONAL_IMPLEMENTATION_CHOICE）；③ §1 matrix 发布行与 DOC_STALE-1 表述统一（publishResults 已记载，缺三模式模型+真值表）；④ 证据强度表述收窄（C17 结构推断、C18 精度未测）；⑤ “插队”措辞精度化（复用已流逝历史 release capacity，非超越前方序位）；⑥ 分类注明 non-exclusive。

（审计完成。按 §28 STOP：未改任何代码/测试/规范文档/Issue/roadmap；docs/research/ 下两份报告为本次审计唯一产物。）
