# 透明登录、集中交卷与运行时容量架构裁决报告

> **状态：Owner 已确认定稿 · 限定部署的研究归档（r3 定稿复核版 = r2 证据修订 + 全表数字复核，记录见 §5.5；三项工程决策：保留登录 A、保留并行交卷 A、暂停 Watt）。归档范围、证据可获得性分级与脱敏说明见本目录 `README.md`。**
> 本报告的产品实现、合并、GitHub issue 变更或生产配置变更**另行处理**；报告本身不构成合并建议，也不构成产品容量认证或 SLA 承诺。
> 所有实验使用合成考生与可重置研究数据库 `exam_550_e2e`（S2 进程内测试使用自建自清的 `exam_test_s2`）；未读写开发/生产数据。
> 报告中的每个数字均来自亲自打开核对的原始产物（`samples.jsonl`、`driver.json`、`oracle.json`、`api-sampler`/`api-summary`/`pg-activity` 等）；r3 定稿复核记录见 §5.5。

## Owner 评审修订（2026-11-20，r2）

Owner 已接受本轮三项工程决策：**保留登录 A、保留并行交卷 A、暂停 Watt**。报告定稿暂缓，本轮只做小范围证据修订，不重跑完整容量矩阵；三项裁决不变。本修订逐项落实 Owner 的四点意见：

1. **P3 的 T6 判定**：按冻结协议 §8 的 `发送滞后 p99 <50ms` 判 **未过**（18 个 P3 型 run 作废，不构成严格同刻容量轮次）；同时保留「实际发出负载下 200/200 成功」这一独立事实。6.49s 只作为该平台发射形态的观测值，不是严格同刻时延上界。见 §1.1、§2.2、§4.2。
2. **登录的采纳决定与效果判定分列**：采纳决定 `NO_GO_NOW`；p99 效应 `INCONCLUSIVE`（A/A 14.68% > T4 的 5pp）；P2 三轮 B 的实际排队人数均为 0。另补 L1 HTTP 的 fast n=5 与全样本敏感性，交代快/慢批次划分。见 §1.1、§2.5、§4.3。
3. **收窄交卷的 PG 归因**：`p99(HTTP) − p99(事务) − p99(对照请求)` 只是**分位数残差估计**，不能解释为逐请求借连接等待，也不据此精确分摊 90–95% 的时延；`submittedAtFirst/Last` 不是 DB COMMIT 时刻（S2 观测到 `submittedAt` 可比落库早约 3.05s），原「COMMIT 跨度」表述撤回。保留最扎实的证据链：A 的 T7 窗 PG 池 10/10、S4 三轮峰值 5/6/6、同量交卷完成时背景 save 尾延迟三对均改善。见 §1.3、§2.6、§5.5。
4. **两次 exit=1 进入主报告的复现结论**：S2 与 L3 barrier 分开记录「归档断言通过」与「独立复跑」，保存新 run ID、命令、首个失败点、stderr、退出码与产物路径。本轮结果：L3 barrier 新 run 通过（vitest 17/17 + real-Nginx 15/15）；S2 r1 因候选池耗尽 exit=2，重置研究库后 r2 通过（live 38/38 + inproc 36/36），browser 25/25 未由 gate 复跑；原始 G3/G4 的 exit=1 不可复现。见 §5.6。

产品跟进（不属于本轮性能裁决）：共享 NAT 的登录可用性优先核实；交卷「已提交却提示失败」的结果确认文案进入产品评审；Watt、降低 Argon2 强度、扩大 PG 池均无本轮证据支持。见 §5.7。

## 复核结论（定稿前数字复核，2026-11-20）

本节记录对报告数字的独立复核结果。复核由四部分组成：① 用归档原始数据逐 run 复算；② 对代表性样例执行一次真实负载复跑（`L2-ARRIVAL-P2-S200-RECHECK-r1`，新 run-id，未覆盖原 run）；③ 对 S2 与 L3 barrier 两个 gate 各做一次新 run ID 的独立复跑（§5.6）；④ r3 定稿复核——全部表格数字由报告撰写会话重开原始数据逐项核对（记录见 §5.5 r3 条目，仅更正三处誊写/计数，裁决不变）。

**复核一致（可复算且与报告一致）**

- L2 主矩阵 12 个 cell 的 login p99/p95/max、独立成功人数、拒绝分类、最后 login/submit、save/hb p99；60/60 主矩阵 run 独立成功 N/N；T-SHARED 的 34/100 与确定性计数；P1 vs P2 S200 配对 +75.3%（5/5）等——均与 `l2-analysis.json` 及各 run `samples.jsonl` 一致（复核明细见 §5.5）。
- L1 隔离/HTTP 曲线、CPU/成功、p50/p99、RSS、maxInFlight=4、ELU 18.3%、EL p90 1.39ms/max 62.55ms；正式 run 95 个（iso 35 + HTTP 60）。
- S1 五轮 p50/p99/末位确认、借连接估计 2056–2254ms、PG 池 10/10、lock wait 0、save/hb/监考尾延迟；S3 三对 A/S4 的 p50/p99/末位/save/hb/监考/门计数/拒绝 20/20；L3-ADMISSION 三对配对原始值与 A/A 14.68%/1.77%；S2 live 38/38、in-process 36/36、browser 25/25 及 ②-a 时间线；G1 16/17 API 请求、7/7 + 4/4 UI 断言；六个 manifest 的 `sha256sum -c` 全部 OK、两份协议 SHA256 一致。

**独立复跑（Owner 评审修订，2026-11-20）**：S2 gate 在新 run ID 下 r1 因候选池耗尽 `exit=2`；重建 name-guarded `exam_550_e2e` 后 r2 通过（live 38/38、in-process 36/36）。L3 barrier gate 在新 run ID 下通过（vitest 17/17、real-Nginx 15/15）。原始 G3/G4 的 `exit=1` 在本环境不可复现；详见 §5.6 与 `evidence/OWNER-REVIEW-RERUN/README.md`。

**已修正的不一致（本报告已按原始数据改写）**

1. **T-SHARED「两轮数字逐位一致」不成立**：两轮的**确定性计数**（offered 1622、login 100、indep 34、429 拒绝分类 207、依赖取消 996）一致，但**时延/QoS 列不同**（login p99 114 vs 111ms、save p99 54 vs 218ms、hb p99 25 vs 19ms）。报告已改为「计数一致，时延/QoS 不同」，不再声称逐位一致。
2. **T-SHARED「429 总数 207」口径错误**：原始 `samples.jsonl` 实际有 **276 个 429 响应**（login 端点 66 个一致）；其中 **69 个是登录前 `/me` 预检，实际状态码为 429，不是 401**。driver 把这些行统一标为 `verifyKind=me-401-expected`、`verified=true`，但未校验状态码；同轮 `/me` 另有 40 个真实 401（设计内预期）与 2 个 200（已登录后的正常响应）。**207 个才是拒绝分类中的 429**。报告表头与数字已改为「429 拒绝分类 207（含 login 66）+ `/me` 预检实际 429 69」，两者不重不漏合计 276。
3. **S1「主线程 65–116% 单核」撤回**：该区间由 `cpuT7Window.apiMainThreadCpuMs ÷ submit.drainMs` 推导，但归档分析器没有对应字段/脚本，按 250ms tick 直接复算只能得到主线程 60–86%、进程 70–108%（每 run 仅 3–4 tick，粒度不足），不能精确复现 65–116%。报告已改用可直接复核的「主线程占进程 CPU 83–88%」（`cpuT7Window.mainThreadSharePct`）+「EL max 16.33–49.84ms」作为 busy-but-not-blocked 证据；该修正不改变「主 event loop 不是限制队列」的结论，但 PG 池归因只保留「池 10/10 + S4 峰值 5/6/6 + save 尾延迟改善」这条证据链，不再声称精确分摊 90–95%。

**unverifiable（无法复核，已注明原因）**

- **O1-START、M1-RUNTIME、L4-RETRY、RT-B-WATT、RT-C-WATT**：无 run、无原始数据可重算；报告已如实标「未启动/未触发」，不引用上游 run ID。其中 O1/M1/L4/RT-C 按 **Owner 缩减指令（2026-11-20）** 未运行，RT-B 按 G5 条件未触发；依据 `PROTOCOL-ADDENDUM.md` §1。
- **S1 主线程绝对份额的 65–116% 区间**：如上述已撤回/替换；替换后的 83–88% 可复核。
- **历史比较项**（Login CPU/成功 121→550ms、登录 7–10s、交卷 1–4s、#668 62–68%）：只作对照输入，不是本轮实测，也不是门槛。

**代表性负载复跑（复核证据）**

- run：`L2-ARRIVAL-P2-S200-RECHECK-r1`（2026-11-20 17:14–17:20 CST；`l2-run.sh --profile=p2 --n=200 --topology=direct --scenario=full --reset=1 --pair=9`）。到达表归一化后与原 run 逐行相同（3258 op，seed 9001021，flow=mix，b-share=0.1）；driver `planned=sent=gotResponse=3258`、login 200/200、0×429/503/网络失败、dropped=0、T6 PASS。
- 业务 oracle（`oracle.json`/`oracle.log`）：attempts 200 全 `graded`/`manual`、每 attempt 12 条 grading entry、`frozenQuestions=12`、`answersMatchDriver=true` 200/200、receipts 合计 **371**（171 人 ×2 + 29 人 ×1）、`dupActive=dupTerminal=0`；DB `loginSuccessDistinctCandidates=200`、`loginSuccessAll=202`、`loginFailure=0`。
- **绝对时延/CPU 与归档批次不同**：复跑 login p50/p95/p99=57/78/114ms、save p99=75ms、hb p99=28ms、CPU/成功 176.7ms；归档 r1 为 135/95/30ms、CPU 220.9ms（5-run 区间 122–143ms），L3-ADMISSION A 臂为 101–117ms/173–181ms。结论：**绝对容量值存在跨会话/跨批次波动**，本报告所有绝对时延/CPU 均按「单批次观测」解读；配对/相对结论（P1 vs P2、A vs B、A vs S4）不受影响。
- 复跑 run 的 `l2-run-meta.json` `headSha=21276e0ea2da0f553ec487cf0bc9b68cdb2cf340`（研究分支 HEAD）与归档 `87510894` 不同，但 A 臂 `dist` 的 `server.js` SHA256 `996df611…`、`routes/attempts.candidate.js` `501604d5…` 与 `S3-ADMIT/build-manifest.json` 的 A 臂一致、`dist` mtime 未变（2026-11-19 21:23，未重建）；这是研究分支工作树状态，不是 A 代码差异。

**Owner 缩减指令声明**：O1-START、M1-RUNTIME、L4-RETRY、RT-C-WATT（Watt 多 Worker）与独立审读均按 **Owner 缩减指令（2026-11-20）未运行**；RT-B-WATT（1 Worker 包装 overhead）未被指令点名、按 G5 条件未触发。依据 [`PROTOCOL-ADDENDUM.md`](PROTOCOL-ADDENDUM.md) §1。独立审读未形成独立 run；本节复核来自归档原始数据复算、上述一次代表性负载复跑与 §5.6 的两次独立 gate 复跑。

---

## 0. 阅读约定、协议修订与口径更正

### 0.1 臂与缩写

| 缩写 | 含义 |
| --- | --- |
| **A（原始实现）** | 冻结 SHA `87510894728ee1ca20a530fc20e29fa1f51709b7` 的 `apps/api/dist`；生产 limiter ON、PG 池 10、argon2id `m=65536,t=3,p=4`、libuv 默认 4 线程 |
| **B（L3 服务端准入）** | 研究分支 `research/capacity-900-1021-l3-admission` 的 `dist-l3` + 登录 FIFO 准入（K=4，Q=189，W=5000ms，单调时钟） |
| **S4（S3 交卷准入）** | 同工作树 `dist-s3` + 事务前全局手动交卷上限 `S_sub=4`（`Q_sub=200`、`W_sub=15000ms`，研究契约 `503 SUBMIT_BUSY`） |
| **T-DIRECT** | 每考生绑定独立真实 loopback 源 IP，经实际 Nginx；生产 limiter 原样开启 |
| **T-SHARED** | 整批共享同一出口 IP；登录 10/min/IP 先于容量机制拒绝，结果单列 |
| **P1/P2/P3** | 240s 窗口均匀到达 / ≥80% 压缩在最后 30s / 同刻突发；**均为本轮合成负载（SYNTHETIC），不是客户实测分布** |
| **S_N** | 并发台阶（S20/S50/S100/S200），不是支持人数承诺 |

### 0.2 协议修订（必须披露）

- 冻结协议：`PROTOCOL.md` v1.0，SHA256 `442f0ec61400c62090632490aed2fa6609f7c855221937512f5bc7384fc192aa`（本会话 `sha256sum PROTOCOL.md` 复核一致）。
- 修订附录：`PROTOCOL-ADDENDUM.md`（Owner 缩减指令，2026-11-20），SHA256 `fd45a4648b5846d26957ba7cb35173926e0649fe8c44388d7739a62f3b2e6073`（复核一致）。
- **裁撤**：O1-START、M1-RUNTIME（W1–W6）、L4-RETRY、RT-C-WATT（多 Worker）**未启动**，原因是 **Owner 缩减指令 2026-11-20，非上游证据判定**；台账固定为「未启动（Owner 缩减指令）」，不引用不存在的上游 run ID。
- **降采样**：S1 由 ≥5 对降为 5 轮固定矩阵 + 1 轮 A/A；L3-ADMISSION 降为 3 对 + 2 轮 A/A；S3 降为 3 对、只筛 S_sub=4；S2 每案例 1 遍（原 ≥5）。T1–T8 阈值数值**未修改**；降采样只降低置信度，不放宽门禁。
- **后果**：L3 的 B 收益结论与 S3 的收益/代价结论均属「单场景/缩减样本量的初步证据」；L4 客户端透明重试**没有任何本轮证据**（T8 随之永久不可触发）；Watt 多 Worker 无直接反事实。

### 0.3 对上游摘要的两处计数更正（本报告以原始数据为准）

1. **L1 正式 run 数**：`analysis.json` 实际为 isolated 35 + HTTP 60 = **95 个正式 run**（HTTP 各点：C=1/C=4/C=8/C=16/C=32 各 10 轮，C=2/C=3 各 5 轮）。上游摘要/README §3 的「105」「70 HTTP run」计数有误；本报告按 95 计数，已复核 41.62–41.95/s、maxInFlight=4、ELU 18.3% 等数字不受影响。
2. **L2 full run 数**：P1/P2/P3 × S20/S50/S100/S200 × 5 = **60 个直接拓扑主矩阵 run**；另有 2 个 T-SHARED、4 个纯登录补测、1 个 pilot，合计 **67 个完成 run**，加 1 个失败轮（保留）。上游摘要「65 个 full run / 65/65」应读作 **60/60 主矩阵 run + pilot 20/20**；本报告已更正。

---

## 1. 一页裁决

### 1.1 登录：保留现状 A（采纳决定 NO_GO_NOW；p99 效应 INCONCLUSIVE）

**裁决**：在 P2×S200×T-DIRECT 单机场景，**保留原始实现 A**；不采纳服务端 FIFO 准入 B；**不加**客户端透明重试（L4 未运行，无证据）。

**判定分列（Owner 评审修订）**：

| 维度 | 判定 | 依据 |
| --- | --- | --- |
| 采纳决定 | **NO_GO_NOW** | T1 未满足；A 在该场景 N/N、零拒绝，B 无可测收益 |
| p99 效应 | **INCONCLUSIVE** | 点估计 −2.9%，但 A/A 14.68% > T4 的 5pp，且未追加复测；不能把 −2.9% 当作已分辨的真效应 |
| 机制事实 | **P2 三轮 B 的实际排队人数均为 0** | waiting 峰 0、permits 峰 4；B 的队列在该到达分布下从未启动，这是当前无需改产品的最直接理由 |

| 项 | 内容 |
| --- | --- |
| 部署范围 | 单 Fastify 实例、单机 WSL2、经实际 Nginx、每考生独立源 IP、canonical limiter（登录 10/min/IP、全局 100/min/IP）、P2×S200。**不覆盖**：严格同刻（P3 因 T6 未过，见 §2.2）、共享 NAT、多进程/多 Worker、S130 |
| 证据编号 | E-L3-02（3 对配对）、E-L1-01（并发曲线）、E-L2-D（到达矩阵）、E-L3-01（barrier） |
| 关键数字 | 登录 p99 A 104ms → B 99ms，配对中位 **−2.9%** [−4.8%, −2.0%]，3/3 同向；A/A 噪声地板 **14.68%** → p99 效应 **INCONCLUSIVE**（点估计 −2.9%，但 A/A 14.68% 超过 T4 的 5pp，不能分辨为真效应）。CPU/成功 179.5 → 176.6ms（−1.6%，3/3；A/A 1.77%）。峰值 RSS（VmHWM）484448KB → 520152KB（+7.4%，方向不一致，<10% 预算）。同等 offered（3258 op/轮，四级计数全等）**200/200 ×6 轮**；**0×503**、0×401/429/网络失败（拒绝分类口径；flow-B 登录前的设计内 `/me` 401 不计）。B 的准入闸门在全部 B 轮**从未排队**；**P2 三轮的实际排队人数均为 0**（waiting 峰 0、permits 峰 4）。 |
| 代价（保留 A） | P3×S200 同刻登录 p99 6.49s（max 6.58s；该轮发射展宽 668–927ms，按协议 T6 不构成严格同刻容量轮次，见 §2.2），但 200/200 成功；P2 入口 p99 本批次 135ms（独立复跑 114ms，见「复核结论」）。A 无新组件、无新 503 契约。 |
| 代价（若采纳 B） | 新运行时组件；新 `503 LOGIN_BUSY` 研究契约（非产品语义）；客户端重试未验证；RSS +7.4%；本场景**无可测收益**。 |
| 可推翻它的观察 | ① 在 ≥5 对独立配对中复现 P3 型同刻突发，B 的登录 p99 **或** CPU/成功改善 **≥10%**、RSS 增幅 <10%、success/error/认证语义不变（T1）；② 真实到达率接近 μ≈38.5/s 并出现 ≥1% offered 的实质容量拒绝（T8），此时才重开 B/C；③ 多进程/多 Worker 下证明 B 的全局语义仍成立。 |

### 1.2 交卷：保留并行 A；全局准入 S_sub=4 保留为有界候选

**裁决**：保留当前并行交卷（A）。S3 的 `S_sub=4` **已由 T7 触发并完成配对**，它确实消除了 PG 池饱和与混合 QoS 恶化，但把末位权威确认推迟约 0.7s（+33.4%）且引入新 503 契约；本轮**不采纳**，作为候选保留给 Owner 在明确 QoS 取舍后决定。

| 项 | 内容 |
| --- | --- |
| 部署范围 | 单进程、同场 200 × P3 同刻交卷 + 20 名背景考生（save 5s±2 / hb 15s±5）+ 2 名监考 3s；PG 池 10。**不覆盖**跨场 S3、多进程、S_sub=2/8 |
| 证据编号 | E-S1-01（T7 触发）、E-S3-01（3 对）、E-S3-02（拒绝机制）、E-S2-01/02（时序） |
| 关键数字 | 完成数 A 200/200 = S4 200/200（3/3 对，0×503）。混合 QoS：save p99 1518 → 143ms（配对中位 **−90.6%**，3/3）、heartbeat 1613 → 20ms（**−98.8%**，3/3）、监考读 1636 → 35ms（**−97.8%**，3/3）。PG 池 T7 窗：A `maxBusySessions=10`、`pollsAtMax10=4–5`；S4 5/6/6、**0**。代价：末位确认 2109 → 2813ms（**+33.4%** [29.2,34.1]，3/3）；交卷 p99 2088 → 2791ms（+33.7%）；但 p50 2036 → 1620ms（−20.9%）。 |
| 代价（保留 A） | 交卷窗口内 PG 池 10/10 饱和；同窗 save/hb p99 从 46/31ms 恶化到 1560/300ms（同场）或 1582/964ms（跨场）；交卷 p99 2.26–2.39s。 |
| 代价（若采纳 S4） | 末位确认 +0.70s（2.11→2.81s）与 p99 +0.70s；新 `503 SUBMIT_BUSY` 研究契约；进程内全局上限（多 Worker 未验证）；S_sub=2/8 曲线未测。 |
| 可推翻它的观察 | ① 在真实/生产型到达中 T7(b) 不再复现（无混合 QoS 恶化）→ S3 无必要；② Owner 明确末位确认预算（例如 <2.5s）→ S4 因 +0.7s 被否；③ 恢复 ≥5 对并夹逼 S_sub=2/8，出现「尾部 +<15% 且 QoS 改善 ≥50%」的更好折中点 → 重开；④ 任何重复提交/丢失提交/评分重复 → 立即拒绝 S4（T5）。 |

### 1.3 运行时：KEEP（#900 `STOP_WATT`）

**裁决**：**KEEP 当前单进程运行时**。登录路径受 **libuv 4 个原生哈希槽**限制，交卷路径受 **PG 池 10 饱和**影响（分位数残差估计；不能精确分摊）；主 event loop 未成为限制队列，无主线程因果证据，不进入 Watt 对照。

| 项 | 内容 |
| --- | --- |
| 部署范围 | 原始 A、单 Fastify 进程、20 核 WSL2 宿主；登录与交卷两类路径。**不覆盖** M1 W1–W6 全动作画像、O1 开考归因、多 Worker、新库/历史数据 |
| 证据编号 | E-L1-01、E-L2-D、E-S1-01、E-L3-02、E-RT-KEEP |
| 关键数字 | 隔离 verify 平台 **41.8/s** = 4 × 1/95.7ms，C∈{8,16,32} 零增长，`maxInFlight=4`；完整 HTTP login **fast 平台** **40.9–41.1/s** ≈ 隔离平台 → native-hash-bound；C=32 主线程 ELU **18.3%**（1720/9405ms），EL p90 中位 1.39ms、max 62.55ms。L2 67 run EL max **≤49.22ms**（P1/P2 ≤25.15/22.02ms）；以 P2-S200-r1 为例，登录末段（最后 ~30s）主线程约 **25–26%** 单核、进程约 **75%**，未饱和。S1 交卷：p99 2.26–2.39s，T7 窗 PG 池 **10/10**、lock wait **0**、借连接等待 **分位数残差估计 2056–2254ms**（= submitHTTP_p99 − [pgTx_p99 + 无事务请求 RT_p99]；不能解释为逐请求借连接等待，也不据此分摊 p99 的 90–95%）；主线程占进程 CPU **83–88%**、EL 无长阻塞（max 16.33–49.84ms）——瓶颈指向 PG 池，不是 event loop。 |
| 代价（KEEP） | 登录 P3×S200 同刻 p99 6.49s（T6 未过，见 §2.2）；同场集中交卷 p99 2.39s 且混合 save 1.5s。均为已测现状，不是产品 SLA。 |
| 代价（若进入 Watt） | 多 Worker 需要重新验证 Redis 共享限流窗口、请求身份/限流预算、总池 10 的分配、后台 scanner/outbox 单一所有权、关闭/恢复等价性；任一不等价即 `SEMANTICALLY_BLOCKED`。本轮**未测**，成本未知。 |
| 可推翻它的观察 | ① 补跑 M1-W3/W4（本轮裁撤），证明交卷/混合窗主线程 ELU 接近饱和，且多 loop/多 Worker 在同预算下把 p99 降低 **≥15%**（T2）且 RSS 增幅 <15%、宿主 CPU <10%、零语义错误；② 定义明确的产品容量目标后，登录/交卷目标未满足且瓶颈可归因于单个 event loop；③ 出现主线程长阻塞（EL max 远超本机 ~11ms 计时地板并伴随吞吐下降）的直接证据。 |

### 1.4 三项裁决的共同边界

- 结论仅适用于 **冻结 SHA `87510894` + 本机 WSL2 + canonical 配置**；driver 与 SUT 同宿主（协议 §1 拓扑边界），不跨硬件外推。
- 全部到达分布为**合成负载**；P1 是产品预期形态的近似，P2/P3 是压力/对抗形态，不是客户分布。
- 仓库**没有客户 SLA**；本报告不认证产品容量，不承诺支持人数。所有 T1–T8 均为**研究性阈值**（§4.2）。
- **绝对时延/CPU 是单批次观测**：定稿复核的独立复跑显示同一 P2×S200 场景 login p99 114ms vs 本批次 135ms、CPU/成功 176.7 vs 220.9ms（约 −16%~−20%）；跨会话波动已披露于「复核结论」，配对/相对结论不受影响。

---

## 2. 实测容量表

### 2.1 测试床与方法

| 项 | 值 | 证据 |
| --- | --- | --- |
| 机器 | WSL2，20 vCPU（i7-12700H），15GiB 内存，无 cgroup CPU/内存配额（`cpu.max=max`、`nr_throttled=0`） | `evidence/env-freeze.md` |
| OS / Node / 关键依赖 | Ubuntu 26.04.1 LTS / Node v24.15.0 / pnpm 11.1.2 / argon2 0.41.1 / postgres.js 3.4.9 / Fastify 5.8.5 / PostgreSQL 18.4 容器 | `evidence/env-freeze.md` |
| 拓扑 | 实际 Nginx（`deploy/nginx/web.conf` 派生）→ API；T-DIRECT 每考生独立真实源 IP；T-SHARED 共享出口 IP | `evidence/topology.md`、`evidence/driver/` |
| 冻结 SHA | `87510894728ee1ca20a530fc20e29fa1f51709b7` | `evidence/env-freeze.md` |
| offered 定义 | 预注册到达表计划请求数；429/401/503/网络失败/driver 滞后与丢样全部计入 | 协议 §5 |
| 独立成功 | DB/会话 oracle（`login.success` distinct candidates；HTTP 200 必要非充分） | 各 run `db-oracle.json`/`oracle.json` |
| p99 口径 | 每 run 内 p99，跨 5 run 取中位并同报 [min,max]（机制型除外）；样本量随数同报。分位数取法为各分析器统一的保守口径 `sorted[floor(n·p)]`（0 基；`l2-metrics.py:29-33`、`s1-analyze.py:31-36`），比最近邻法略偏保守（取较高值） | 协议 §8/§9 |
| T6 | driver 进程组 CPU <30% 宿主、无单核 >90%、发送滞后 p99 <50ms、丢样 0 | 协议 §8 |

> **p99 同报 max**：L2 各 cell 的 max 观测值：P1×S200 login max 90ms；P2×S200 146ms；P3×S200 6577ms；P3×S100 3231ms；P1×S20 71ms；其余见 §2.2 表内 p99 与脚注。样本量：每个直接拓扑 cell = 5 run × N（S20=100、S50=250、S100=500、S200=1000 个 login）。

### 2.2 T-DIRECT 主矩阵（机器 M-WSL2；来源拓扑 T-DIRECT；经真实 Nginx；每考生独立源 IP）

> 下表每行的机器均为 **M-WSL2**、来源拓扑均为 **T-DIRECT**，故不重复列；「最后 login」与「最后 submit」均以到达窗口起点（WARMUP 2.5s 后）起算。

| 到达 | cohort | offered/run | 独立成功/run | 拒绝（429/401/503/网络） | login p95 | login p99（5-run 中位） | 最后 login（窗起点起算） | save p99 | heartbeat p99 | T6 |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| P1 | S20 | 20 | 20/20 | 0/0/0/0 | 67ms | 67ms [62,71] | 230.81s | 42ms | 34ms | PASS |
| P1 | S50 | 50 | 50/50 | 0/0/0/0 | 64ms | 74ms [68,116] | 236.27s | 45ms | 30ms | PASS |
| P1 | S100 | 100 | 100/100 | 0/0/0/0 | 66ms | 77ms [69,107] | 237.81s | 50ms | 35ms | PASS |
| P1 | S200 | 200 | 200/200 | 0/0/0/0 | 70ms | 77ms [77,78] | 239.77s | 50ms | 32ms | PASS |
| P2 | S20 | 20 | 20/20 | 0/0/0/0 | 67ms | 67ms [65,99] | 236.78s | 44ms | 32ms | PASS |
| P2 | S50 | 50 | 50/50 | 0/0/0/0 | 71ms | 77ms [71,98] | 240.01s | 55ms | 27ms | PASS |
| P2 | S100 | 100 | 100/100 | 0/0/0/0 | 83ms | 104ms [95,112] | 240.01s | 64ms | 32ms | PASS |
| P2 | S200 | 200 | 200/200 | 0/0/0/0 | 96ms | 135ms [122,143] | 240.01s | 108ms | 30ms | PASS |
| P3 | S20 | 20 | 20/20 | 0/0/0/0 | 628ms | 628ms [615,661] | **0.63s** | 120ms | 52ms | 4 PASS / 1 未过（T6 lag） |
| P3 | S50 | 50 | 50/50 | 0/0/0/0 | 1535ms | 1569ms [1556,1646] | **1.64s** | 299ms | 126ms | 未过（T6 lag；轮次作废） |
| P3 | S100 | 100 | 100/100 | 0/0/0/0 | 3077ms | 3208ms [3071,3231] | **3.44s** | 591ms | 275ms | 未过（T6 lag；轮次作废） |
| P3 | S200 | 200 | 200/200 | 0/0/0/0 | 6344ms | 6491ms [6298,6531] | **7.02s** | 1696ms | 564ms | 未过（T6 lag；轮次作废） |

**读法与脚注**

- 全部 60 个主矩阵 run **独立成功 = N/N（100%）**；`planned=sent=gotResponse` 四级计数逐 run 全等、`driverDropped=0`；直接拓扑 **0×429/0×401/0×503**、0 网络失败。另有 pilot `L2-PILOT-P2-S20-r1` 20/20（不入统计）。**口径**：这里的 401 指「拒绝分类中的 401」；flow-B 登录前的 `/me` 设计内 401（每个 full run 恰 N 条，`verifyKind=me-401-expected`）不计入拒绝。
- 每个直接 cell 的样本：5 run；save/hb 的 n 随 cohort：S20 每 run save 36–37、hb 16–17；S50 save 93–94、hb 43–44；S100 save 189–190、hb 89–90；S200 save 371–382、hb 171–182。
- **全流程最后 submit（5-run 中位）**：P1 为 274.4/279.9/281.4/283.6s、P2 为 280.4/283.2/283.4/283.6s、P3 为 44.2/44.6/45.4/47.0s（按 S20/S50/S100/S200）。对应 offered 全流程 op 数随 cohort 增长（S200 为 3258 op），故 S 台阶之间的绝对完成时间不可直接横比。
- **跨批次波动（定稿复核披露）**：独立复核复跑 `L2-ARRIVAL-P2-S200-RECHECK-r1` 的 login p99=114ms、save p99=75ms、CPU/成功=176.7ms，低于本表归档的 135/108/220.9ms；L3-ADMISSION A 臂同场景为 101–117ms/173–181ms。本表绝对时延/CPU 应作为**单批次观测**，不能当作跨会话常数；P1/P2、A/B、A/S4 的配对相对结论不受影响。
- **P3 的「同刻」不是严格 0ms，且按冻结协议 T6 判未过**：Docker Desktop vpnkit 网桥的逐连接发射成本约 3–7ms/op（由 `width ÷ op` 反算，机制未进一步归因），S200 有效发射宽度 668–927ms、发射滞后 p99 525–757ms（`arrival.sameMomentActualEmitWidthMs` 逐 run 记录）。协议 §8 T6 要求发送滞后 p99 <50ms，任一违反即该轮作废并判 `LOAD_GENERATOR_BLOCKED`；因此 **18 个 P3 型 run（S50/S100/S200 全部 + S20-r4 + 纯登录 P3 两轮）均未通过 T6，不构成严格同刻容量轮次**；其余 49 个 run 通过 T6，P3 的 18 轮按协议作废、不计入容量结论。P3 行保留的「独立成功 20/20、50/50、100/100、200/200」是**实际发出负载**下可核对的事实；6.49s 是该平台该次发射形态的观测值，**不是严格同刻时延上界，也不是 SUT 纯时延**（发射展宽与计时起点都会影响结果）。没有事前批准的 T6 修订：`PROTOCOL-ADDENDUM` 只降采样，未改 T6（§0.2）。重新判定明细见 `evidence/L2-ARRIVAL/T6-RECLASSIFICATION.md`（原始 `l2-analysis.json`/`driver.json` 的 `t6` 字段保留不改，作为 sidecar 说明）。
- **P1 vs P2 交错配对（S200，5 对，同一到达表 seed=9001021）**：login p99 77 → 135ms，配对中位 **+75.3%** [+56.4%,+85.7%]，5/5 同向；p95 70 → 96ms（+35.7%，5/5）；save p99 50 → 108ms（**+116%**，5/5）；start p99 61 → 146ms（+133%，5/5）；heartbeat p99 32 → 30ms（−9.1%，4/5 反向，无实质变化）。在 S200 语境，同臂相邻 run 的 login p99 相对差 ≤12.2%（P1 全距 1.3%、P2 全距 15.6%，全距分母取中位），配对信号显著超出噪声。
- S100 的 P1→P2 login p99 为 +26.8%（4/5 同向），但同臂全距 49%（含 107ms 离群 run），与噪声重叠；S20/S50 的形态差 |中位| ≤8% 且方向不一致——只有 S200 达到噪声分离。

### 2.3 T-SHARED 对照（单列，不并入容量结论；机器同为 M-WSL2）

| run | offered（op） | login offered | 独立成功 | 429 拒绝分类（含 login） | 429 `/me` 预检（实际 429） | 依赖取消 op | login p95/p99 | 最后 login | save p99 | hb p99 | T6 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| L2-SHARED-P2-S100-r1 | 1622 | 100 | **34/100（34%）** | **207（login 66）** | **69** | 996（987 业务 + 9 文档） | 109/114ms | 221.08s | 54ms | 25ms | PASS |
| L2-SHARED-P2-S100-r2 | 1622 | 100 | **34/100（34%）** | **207（login 66）** | **69** | 996（987 业务 + 9 文档） | 111/111ms | 221.08s | 218ms | 19ms | PASS |

- 两轮的**确定性计数一致**（offered 1622、login 100、独立成功 34、429 拒绝分类 207、依赖取消 996），但**时延/QoS 列不同**：login p99 114 vs 111ms、save p99 54 vs 218ms、hb p99 25 vs 19ms；后者受单轮少量成功者的背景动作影响，不构成容量结论。**共享出口 IP 下，登录 10/min/IP 与全局 100/min/IP 先于任何容量机制拒绝**。
- 429 响应共 **276**：其中 **207 个计入拒绝分类**——branding 69、login 66、exam-detail 13、start 13、unread 10、exams 9、client-events 6+6、heartbeat 6、save:1 5、take 2、save:2 1、submit 1；另 **69 个是登录前 `/me` 预检，实际 HTTP 状态码是 429，不是 401**。这 69 个 `/me` 行被 driver 统一标为 `verifyKind=me-401-expected` 且 `verified=true`，但该标记只表达「设计内预期」，**没有校验状态码**；同一轮 `/me` 另有 40 个真实 401 与 2 个 200——40 个 401 才是设计内预期，2 个 200 是已登录后的正常响应。69 个 `/me` 429 不计入 207 拒绝分类，也不改变 34/100 的独立成功数，但说明共享出口下**入场流程从 `/me` 预检阶段就开始被限流**。
- 结论：该拓扑的**可用性限制**不是容量问题；生产若存在大规划 NAT，需要单独的产品/部署策略（不在本轮裁决内）。**先核实目标学校的真实网络拓扑与 Nginx 所见来源，再决定部署或来源限流策略**；`/me` 预检的 69 个实际 429 应纳入入场流程可用性评估，不能只看 34/100 的独立成功数。

### 2.4 纯登录补测与 CPU 分解

| run | 独立成功 | login p95/p99 | 最后 login | CPU/成功（进程 CPU ÷ DB oracle） |
| --- | ---: | ---: | ---: | ---: |
| L2-LOGINONLY-P2-S100-r1 | 100/100 | 90/106ms | 240.013s | 155.6ms |
| L2-LOGINONLY-P2-S100-r2 | 100/100 | 90/118ms | 240.014s | 150.4ms |
| L2-LOGINONLY-P3-S100-r1 | 100/100 | 2729/2806ms | 3.092s | 252.5ms |
| L2-LOGINONLY-P3-S100-r2 | 100/100 | 2663/2753ms | 3.037s | 244.2ms |

- 混合 vs 纯登录（P2×S100）：full 约 **20.99s/100 人（209.9ms/人）** vs login-only 约 **15.30s/100 人（153.0ms/人）** → 登录约占混合进程 CPU 的 **73%**；配对差分增量约 5.7s/100 人，含非登录动作与 full run 多出约 43–44s 窗口的后台循环（未单独剥离）。
- 同刻突发抬高登录 CPU：纯登录 P3×S100 248.4ms/成功 vs P2×S100 153.0ms/成功（同样 100 次成功登录，**+62%** 进程 CPU）；与历史比较项「Login CPU/成功 低并发 ~121ms → 高并发 ~550ms」同向。**机制未归因**（未装内存带宽/缓存/调度计数器）。

### 2.5 登录并发–成功吞吐 / CPU / RSS 曲线（L1-VERIFY）

**隔离 verify**（直接调 `verifyPasswordOrDummy`，真实库；每点 5 run × N=600）与 **完整 HTTP login**（经真实 Nginx、T-DIRECT、每点 fast n=5 × N=200；全样本敏感性见下表）：

| C | 隔离吞吐（次/s） | 隔离 CPU/op | HTTP 吞吐（fast n=5，次/s） | HTTP CPU/成功（fast n=5） | HTTP p50 / p99（fast n=5 中位） | API RSS（VmHWM） |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 24.4 | 55.5ms | 18.6 | 61.4ms | 53 / 79ms | 322MB |
| 2 | 35.1 | 87.2ms | 29.8 | 84.8ms | 66 / 99ms | 386MB |
| 3 | 38.6 | 148.1ms | 34.9 | 131.1ms | 85 / 107ms | 450MB |
| **4** | **41.8（平台）** | 202.4ms | **38.5（拐点）** | 176.4ms | 103 / 126ms | 513MB |
| 8 | 41.5 | 204.0ms | 40.9 | 211.9ms | 192 / 228ms | 513MB |
| 16 | 40.8 | 209.2ms | 41.1 | 209.3ms | 378 / 440ms | 514MB |
| 32 | 40.4 | 211.7ms | 41.1 | 208.8ms | 759 / 838ms | 514MB |

**快/慢批次划分与全样本敏感性（Owner 评审补充）**：HTTP 每点 10 轮（C=1/4/8/16/32）或 5 轮（C=2/3）。C=1/4/8/16/32 的 r1–r5 为 `unprobed`（无前后环境探针），r6–r10 的前后固定负载探针均 ≥21/s 判为 `fast`；C=2/3 的 5 轮全部是 `fast`。正式读数取 fast n=5。`unprobed` 组按吞吐双峰事后分组，慢模式轮保留但不入正式读数（`evidence/L1-VERIFY/README.md` §6）。全样本中位与 fast 并列如下：**41.8/s 隔离平台与 40.9–41.1/s HTTP fast 平台只在 fast 口径成立**；C=4/8 的全样本中位为 33.7/35.2/s，差异来自慢模式轮。

| C | HTTP fast n=5 吞吐（次/s） | HTTP unprobed n=5 吞吐（次/s） | 全样本中位吞吐（次/s） | fast CPU/成功 | 全样本 CPU/成功 | fast p99 | 全样本 p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 18.6 | 12.9 | 18.6（n=10） | 61.4ms | 61.7ms | 79ms | 80ms |
| 2 | 29.8 | —（全部 fast） | 29.8（n=5） | 84.8ms | 84.8ms | 99ms | 99ms |
| 3 | 34.9 | —（全部 fast） | 34.9（n=5） | 131.1ms | 131.1ms | 107ms | 107ms |
| 4 | 38.5 | 29.0 | 33.7（n=10） | 176.4ms | 219.8ms | 126ms | 142ms |
| 8 | 40.9 | 29.3 | 35.2（n=10） | 211.9ms | 263.6ms | 228ms | 273ms |
| 16 | 41.1 | 22.6 | 40.5（n=10） | 209.3ms | 212.9ms | 440ms | 463ms |
| 32 | 41.1 | 40.2 | 40.8（n=10） | 208.8ms | 209.5ms | 838ms | 858ms |

- **吞吐在 C=4 封顶**：41.8/s = 4 个 libuv 槽 × 1/95.7ms；`maxInFlight=4`（5/5 run），C∈{8,16,32} 零增长，逐 op 时长每翻倍 ≈×2 为纯排队（模型估计，非直接观测）。
- **CPU/成功从 55.5ms 膨胀到 202–212ms（3.7×）**；饱和只烧 8.5/20 核，说明限制是槽位而非核数。膨胀机制（内存带宽/缓存/调度）**未归因**。
- HTTP **fast** 平台 40.9–41.1/s（全样本见上表）≈ 隔离平台 → 登录路径 **native-hash-bound**；主线程 ELU 18.3%（全窗 1720/9405ms，c32-r6），EL p90 中位 1.39ms、max 62.55ms（本 VM 计时地板 ~11ms）。
- **口径勘误**：HTTP 表 C=4/C=8 的 CPU/成功 219.8/263.6ms 是 n=10 混合中位（含慢模式）；本节取 fast n=5 的 176.4/211.9ms。全样本吞吐 C=4/C=8 为 33.7/35.2/s，fast 为 38.5/40.9/s。两口径均保留在 `analysis.json`。
- 105→95 run 计数更正见 §0.3；105 个「正式 run」的旧说法不采纳。

### 2.6 交卷：同场/跨场、混合 QoS 与 S3 配对

**S1 固定矩阵（P3 同刻交卷 200 人；同场 1 场×200 vs 跨场 10 场×20；到达表逐字节相同）**

| run | 臂/模式 | 完成 | 交卷 p50 | 交卷 p99 | 末位权威确认 | PG 池 maxBusy / polls@10 | save p99（基线→T7 窗） | hb p99（基线→T7） | 监考 p99（基线→T7） | 借连接等待：分位数残差估计（非逐请求） |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | ---: |
| cross-pure-r1 | 跨场/纯 | 200/200 | 2201ms | 2263ms | 2274ms | 10 / 3 | —（无背景） | — | — | 2056ms |
| same-pure-r1 | 同场/纯 | 200/200 | 2336ms | 2389ms | 2414ms | 10 / 6 | — | — | — | 2160ms |
| same-pure-r2 | 同场/纯（A/A） | 200/200 | 2246ms | 2301ms | 2316ms | 10 / 3 | — | — | — | 2168ms |
| same-overlay-r1 | 同场/叠加 | 200/200 | 2314ms | 2383ms | 2388ms | 10 / 4 | 46 → **1560ms** | 31 → **300ms** | 39 → **1929ms** | 2254ms |
| cross-overlay-r1 | 跨场/叠加 | 200/200 | 2266ms | 2331ms | 2350ms | 10 / 5 | 41 → **1582ms** | 31 → **964ms** | 39 → **1777ms** | 2157ms |

- **T7(a) 成立（分位数残差口径）**：5 轮 `submitHTTP_p99 − [pgTx_p99 + 无事务请求 RT_p99]` = 2056/2160/2168/2254/2157ms（阈 100ms）。这是**分位数残差估计**，不是逐请求借连接等待：各分位点可能对应不同请求，不能据此精确分摊 p99 中的 90–95%。同时 T7 窗内 PG 池 10/10 满载（`pollsAtMax10=3–6`），T7(a) 的 100ms 阈值由残差量级稳健满足。
- **T7(b) 成立**：叠加臂 save p99 46→1560ms（33.9×）/41→1582ms（38.6×）；heartbeat 31→300ms（9.7×）/31→964ms（31.1×）；监考读 39→1929ms（49.5×）/39→1777ms（45.6×）。
- **同场 vs 跨场：INCONCLUSIVE**。纯交卷 +5.6%、叠加 +2.2%，均 < 2×A/A 噪声地板 7.4%（p99 A/A 3.7%）。T7 窗内 lock wait 两臂 5 轮全 **0**（`wait_event_type='Lock'` 无事件），#668 的 FOR SHARE 读者共存语义在 200 人同场集中交卷下复现；PREP 窗（非测量）才出现 exam 行 `Lock:tuple` 短等待（≤207ms）。
- 交卷权威确认：5×200/200 唯一终态 `graded`、`submission_reason=manual`、12/12 评分 entry、receipts `[1,2]`、`attempt.submit` 审计 1/考生、dupActive/dupTerminal=0；叠加轮 20/20 背景考生保持 `in_progress`。
- **末位确认 2274/2414/2316/2388/2350ms；`submittedAtFirst/Last` 不能当作 DB COMMIT 时刻。** S2 已观测到 `submittedAt` 可比落库早约 **3.05s**（②-a：`submittedAt=T−2s`，真实落库晚 3.05s），两者不是同一事件。原「DB COMMIT 跨度 851–1033ms / 448–910ms」及「约 1.3s 尾段是 COMMIT 后两次事务外读排队」的表述撤回；「事务后两次读取约 1.3s」只保留为**待验证解释**。
- **可复核的证据链（支持保留 S4 候选）**：① A 的 T7 采样窗内 PG 池达到 10/10（`pollsAtMax10=3–6`）；② S4 三轮峰值降为 5/6/6（`polls@10=0`）；③ 同量交卷完成（200/200）时，背景 save p99 三对均改善（1518→143、1288→44、1536→153ms）。这三条支持「并发交卷挤压其他请求」；不据此精确分摊 90–95% 的时延。
- **心跳低样本警告**：部分轮次 T7 窗 hb 只有 **11–13 个样本**，此时 p99 等于最大值，单个 p99 不具分位数稳定性；表内 hb p99 必须与样本数同看。A 臂 T7 hb p99={32,1397,1564,1613,1619}ms、S4={126,20,20}ms 已按原始分布给出（见下方 A/A 条），不采用单一 p99 判据。
**S3-ADMIT 配对（同场 200 × P3 交卷 + overlay；3 对交错；A vs S_sub=4）**

| 对 | A 交卷 p99 | S4 p99 | A p50 | S4 p50 | A 末位确认 | S4 末位确认 | A save p99 | S4 save p99 | A hb p99 | S4 hb p99 | A 监考 p99 | S4 监考 p99 | A PG max/polls@10 | S4 PG max/polls@10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1 | 2081 | 2675 | 2016 | 1550 | 2086 | 2695 | 1518 | 143 | 1564 | 126 | 1579 | 34 | 10/4 | 5/0 |
| 2 | 2088 | 2791 | 2036 | 1620 | 2109 | 2813 | 1288 | 44 | 1613 | 20 | 1636 | 36 | 10/5 | 6/0 |
| 3 | 2126 | 2845 | 2055 | 1626 | 2138 | 2866 | 1536 | 153 | 1619 | 20 | 1679 | 35 | 10/5 | 6/0 |

- 配对中位：submit p99 **+33.7%** [+28.5,+33.8]（3/3）；p50 **−20.9%** [−23.1,−20.4]（3/3）；末位确认 **+33.4%** [+29.2,+34.1]（3/3）；save **−90.6%** [−96.6,−90.0]（3/3）；hb **−98.8%** [−98.8,−91.9]（3/3）；监考 **−97.8%** [−97.9,−97.8]（3/3）；完成数 0.0%（均 200/200）。
- 门计数（3 个 S200 run）：`acquireEntered=admitted=released=200`、`queueFull=timeout=disconnected=0`、等待峰 **192**、许可峰 **4**，结束 live 句柄全 0。交卷事务并发被限制在 4，等待者不持 PG 连接、不查询。
- 拒绝语义（2 个机制 run，20/20 断言 PASS）：Q=200/W=1ms → 4×200 + 2×503（reason=timeout）；Q=1/W=15000ms → 5×200（1 个经队列）+ 1×503（reason=queue_full）；503 均带 `Retry-After`，被拒 attempt `in_progress`、0 audit、0 receipt、0 评分 entry。
- A/A 噪声地板（aa1→aa2）：submit p99 +11.1%、p50 +11.5%、drain +11.0%、save T7 p99 +24.0%、监考 +9.9%；heartbeat p99 在该对为 32ms vs 1397ms（n=11 vs 13，p99=max），**不采用单一 p99 判据**，改报原始分布：A 臂 T7 hb p99={32,1397,1564,1613,1619}ms，S4={126,20,20}ms（aa1 的 32ms 为 11 个样本恰好避开饱和窗的反例）。

---

## 3. 交卷时序（S2-TIMING，A 原始实现）

### 3.1 总表：每案例预期 vs 实测

> 预注册预期表 `expected.md`（SHA256 见同类 manifest）在任何测量前写定；实测后不回改。表中「已保存 / 已提交 / 已评分」分开核对。S2 每案例 1 遍（ADDENDUM §2.3 降采样），断言全过；live 38/38、in-process 36/36、browser 25/25。

| 案例 | 预注册预期 | 实测 UI | DB 终态 / 原因 / 时间 | 已保存（receipts / 版本） | 已提交（status / submittedAt / 审计） | 已评分（entries / score） | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ①-a 保存成功后提交 | v1→v2 均 accepted；冻结 v2；manual；审计 1 | G1 trace A 覆盖：保存 chip「已保存」→结果页 0 分；S2 为协议级 | graded / manual；submittedAt 在 [send,recv] 内（send 07:41:36.965Z、DB 15:41:36.973+08 = 07:41:36.973Z、recv 07:41:37.016Z） | receipts `[1,2]`；freeze=v2(false) | graded；submittedAt=route 入口样本；audit **1** | 12 条；finalScore=0（答 false） | PASS |
| ①-b 保存在途，save 先得锁 | save v2 先落账；冻结含 v2；audit 1 | 浏览器额外证据：对话框「保存中...」、确认按钮 disabled；释放后 save accepted→结果页 | graded / manual | receipts `[1,2]`；freeze=v2(false) | graded；audit **1** | 12 条 | PASS |
| ①-b' 保存在途，submit 先得锁 | 晚到 save 不得被 200 骗过；冻结 v1；audit 1 | 未跑浏览器（§2.3：①②浏览器面由事务测试覆盖） | graded / manual | receipts `[1]`；晚到 save **200 + accepted:false + ATTEMPT_ALREADY_SUBMITTED + serverVersion=0**；freeze=v1(true) | graded；audit **1** | 12 条 | PASS（预期表 serverVersion=1 为翻译错误，按代码/实测更正为 0） |
| ②-a 手动先锁，处理跨截止 | route 取时 T−2s 决定 manual；submittedAt=T−2s | 未跑浏览器（事务测试覆盖） | graded / manual；T=07:41:49.678Z，route 样本 07:41:47.678Z，真实时钟越过截止后 ~1.007s 才释放锁（07:41:50.685Z），落库 07:41:50.724Z | 提交前已保存 v1（receipt 1 行，saved=1） | graded；submittedAt=**T−2s**（早于真实落库约 3.05s）；audit **1** | 12 条；finalScore=10 | PASS（公平性落差见 §3.3） |
| ②-b scanner 先锁 | scanner 冻结 T；reason=deadline；audit 0；晚到手动 200 零新增写 | 未跑浏览器 | graded / deadline；submittedAt=**T**（epoch 精确相等） | freeze=scanner 时 draft（v1） | scanner 提交；audit **0**；晚到手动 POST 200 且 submittedAt/reason 不变 | 12 条；finalScore=10 | PASS |
| ②-c 边界 now==T | ≥ 比较符 → deadline 冻结；audit 0 | 未跑浏览器 | graded / deadline；submittedAt=**T**（精确） | freeze=draft（v1） | audit **0** | 12 条；finalScore=10 | PASS |
| ②-d 边界 now==T−1ms | 手动；submittedAt=T−1ms；audit 1 | 未跑浏览器 | graded / manual；submittedAt=**T−1ms**（精确） | receipt v1 | audit **1** | 12 条；finalScore=10 | PASS |
| ②-e1 保存侧 now==T | 预期 DEADLINE_EXCEEDED（原预期表） | 未跑浏览器 | 保存事务内联 reconcile 先冻结：reason=deadline、submittedAt=T、audit 0 | **未保存**（receipt 0 行；返回 200 accepted:false + ATTEMPT_ALREADY_SUBMITTED + serverVersion=0） | 已按 deadline 提交；audit **0** | 12 条；finalScore=0 | PASS（预期更正：内联冻结先于纯 deadline 守卫；DEADLINE_EXCEEDED 仅引擎直调可达） |
| ②-e2 保存侧 now==T−1ms | accepted；新 receipt；保持 in_progress | 未跑浏览器 | in_progress，无冻结 | **已保存**：receipt 1 行、serverVersion=1 | 未提交 | 0 条 | PASS |
| ②-e3 纯 processSaveAnswer 边界 | ==deadline → DEADLINE_EXCEEDED；−1ms → accepted | — | — | 决策函数级 | — | — | PASS（同一 ≥ 比较符双侧钉死） |
| ③-a 协议级双击 | 两 POST 均 200；唯一业务效果；audit 1 | 未跑浏览器 | graded / manual；单一 submittedAt 15:41:40.039+08 | freeze 单套 | 2×200；outcome `{graded, replay_no_change}`；audit **1** | 12 条，单次评分 | PASS |
| ③-b 响应丢失 + 重试 | 客户端连接丢失；权威重读 graded；重试幂等 | ③-d 浏览器：toast「提交失败，请重试」、停留考试页；重试→结果页 | graded / manual；submittedAt 15:41:41.323+08 不变 | freeze 单套 | 代理捕获 HTTP/1.1 200（服务端已提交）；重试 200；audit **1** | 12 条；无重复评分 | PASS |
| ③-c 浏览器同 tick 双击 | 恰 1 个 POST；graded 一次；audit 1 | 单击双击后直接结果页；`attempt.submit.completed` 恰 1 条 | graded / manual | freeze 单套 | 实际 POST **1**；audit **1** | 12 条 | PASS |
| ④-A 重启在入事务前 | 重启后 PG 仍 in_progress；转发后 graded 一次 | 代理 hold 未触达 API 时 api-restart；重启窗口后需重新登录（原始样本 `reLoginNeeded=true`、落到 /login；研究拓扑每次 api-restart 轮换 JWT secret），重登后重提 | 重启后、转发前：in_progress、audit 0、entries 0；转发后 graded/manual | 无提交副作用 | 转发后 audit **1** | 转发后 12 条 | PASS（拓扑差异：产品固定 secret 时会话不失效） |
| ④-B 已提交但响应未送达 | PG 已 graded；恢复后无重复 | 代理捕获 200 后 restart；浏览器 toast；重登结果页显示成绩 10 | graded / manual；submittedAt 已设；audit 1；entries 12；finalScore=10 | freeze 单套 | audit **1**；重试 replay_no_change | 12 条 | PASS |

### 3.2 「已保存 / 已提交 / 已评分」分开写清

- **已保存**只由 `exam_answer_save_receipts` + answers JSONB 证明：①-a `[1,2]`、①-b `[1,2]`、①-b' `[1]`；②-e2 有 receipt，②-e1 **无 receipt**（HTTP 200 不代表已保存）。
- **已提交**只由 attempt `status` + `submittedAt` + `submissionReason` + `attempt.submit` 审计证明：manual 5 例、deadline 3 例（②-b/②-c/②-e1）、replay 1 例（②-b 晚到手动）、①-b' 的晚到 save 不构成提交。
- **已评分**只由 `attempt_grading_entries` + enrollment `finalScore` 证明：12 条 entry 是每案例的固定工作集；②-e2 未提交故 0 条；replay 不新增评分。

### 3.3 公平性与 UX 落差（非语义错误，语义错误数为 0）

1. **route 入口取时的公平性边界**（②-a）：请求在截止前 2.000s 取时，但锁释放在截止后约 1.007s、落库在截止后约 1.046s；`submittedAt` 回填到截止前 2s。业务上按 candidate-wins 线性化；对照同一时刻到达但取时晚于截止的请求会得到 deadline 冻结。公平性边界在「route 入口取时」，不在锁获得/提交时刻——需在产品语义文档中显式化。
2. **已提交但响应丢失的 UI 文案**（③-d/④-B）：服务端已提交，UI 只提示「提交失败，请重试」并停留在考试页，不自动做一次权威重读；考生需手动重试/刷新。业务终态正确（重试幂等），但错误文案在已提交场景具有误导性。
3. **最后改答未进入冻结集**（①-b'/②-e1）：服务端冻结权威（EXSEM 冻结快照）按既有语义拒绝晚到保存；候选人只看到保存失败（200+accepted:false 或 ATTEMPT_ALREADY_SUBMITTED）。记录为可感知落差，未见数据一致性破坏。

### 3.4 预注册预期表的两处更正（留痕，不改冻结文件）

- ①-b'：预期表写「serverVersion 回 1」，实测/代码为 **0**（`answerProtocol.ts:159-166` 状态守卫硬编码 0）。断言按实测 0 通过。
- ②-e1：预期表写 `DEADLINE_EXCEEDED`，实测为 **ATTEMPT_ALREADY_SUBMITTED**——保存事务内联 reconcile 先按 ≥ 冻结该 attempt，`processSaveAnswer` 的 deadline 守卫不再可达。`semanticErrors=[]`，两处均为预期表翻译错误而非产品错误。

### 3.5 S3 臂下的 S2 重验

在 `S_sub=4` 臂上重跑 S2 可复跑套件：live **38/38**、in-process **36/36**、真实浏览器 **25/25** 全部 PASS，与基线逐断言同序、同 pass（差异仅为动态 `submittedAt` 时间戳）。说明门在非并发场景不改变业务路径；被拒/等待仅出现在并发交卷。**这些重验都在非并发场景**；若未来采纳 S4，需单独覆盖「等待队列已占满许可、手动请求跨截止、scanner 先取得锁」的交错。本轮保留 A，无需等待该补验。

---

## 4. 实验台账

### 4.1 台账（每行均有处置）

| 实验 ID | 固定变量 | 干预/场景 | run ID / 证据路径 | 样本量 | 效应（配对原始值见 §4.3） | 限制 / 处置 |
| --- | --- | --- | --- | --- | --- | --- |
| **G1-FIDELITY** | 冻结 SHA、真实 Nginx、`timed_window` 考试、合成考生 | 真实浏览器两轨迹：A 登录→等候→开考→改答→保存→交卷→结果；B 保存→刷新→恢复→提交 | `evidence/g1-traces/`（`trace-a-happy-path.json` 40 req/16 API、`trace-b-refresh-recovery.json` 62 req/17 API、`oracle.md`、`replay-spec.json`） | 2 条轨迹；UI 7/7 + 4/4 | 身份/答案版本/终态/评分四项 DB 对账全过；wire login 90ms 对 API 日志 85.8ms（差 4.2ms）；刷新后会话续存 | 单机、单考试；PASS |
| **L1-VERIFY** | 真实库、argon2 m=65536,t=3,p=4、池 10、libuv 4 | 并发 {1,2,3,4,8,16,32}；隔离 verify 与完整 HTTP login | `evidence/L1-VERIFY/analysis.json` + `L1-VERIFY-iso-c*-r*` + `L1-VERIFY-http-c*-r*`（95 正式 run） | 隔离 5×600/点；HTTP 5×200/点 | C=4 平台 41.8/s、maxInFlight=4；HTTP 平台 40.9–41.1/s；CPU/成功 55.5→202–212ms（3.7×）；ELU 18.3% | CPU 膨胀机制未归因；PG 池等待不可直接观测；PASS |
| **L2-ARRIVAL** | 同 N、同会话初态、同一到达表 seed=9001021 | P1/P2/P3 × S20/50/100/200；T-DIRECT 主、T-SHARED 单列、纯登录补测 | `evidence/L2-ARRIVAL/l2-analysis.json` + 60 个主矩阵 run + 2 shared + 4 login-only + 1 pilot + 1 FAILED；复核另加 `L2-ARRIVAL-P2-S200-RECHECK-r1` | 67 完成 run + 1 失败轮 + 1 复核复跑（不入 67） | 直接拓扑 60/60 均 N/N、0 拒绝；P2−P1 login p99 +75.3%（S200，5/5）；P3×S200 7.02s 内 200/200；复跑绝对时延更低（p99 114 vs 135ms），见「复核结论」 | 合成到达；P3 18 轮 T6 未过（按协议作废，不作严格同刻结论）；绝对值为单批次；其余矩阵 PASS |
| **O1-START** | — | 集中开考 vs 错峰（含 L2 登录+开考叠加） | **无 run** | 0 | 无 | **未启动（Owner 缩减指令 2026-11-20，非上游证据判定；PROTOCOL-ADDENDUM §1）** |
| **S1-SUBMIT** | 200 独立 attempts、同题量/改答/评分配比、同一到达表 | 同场 200 vs 跨场 10×20；纯交卷 vs overlay（save 5s±2/hb 15s±5/监考 3s） | `evidence/S1-SUBMIT/` 5 正式 run + 2 pilot；`s1-analysis.json` | 5×200 交卷 + 20 背景 ×2 叠加轮 | T7(a) 分位数残差 2056–2254ms（≥100ms 阈值；非逐请求直读）；T7(b) save 34–39×、hb 9.7–31×；同场 vs 跨场 +5.6%/+2.2% < 2×噪声 7.4% → INCONCLUSIVE | 单对差分 + 1 轮 A/A；pgTx 250ms 采样下界；PASS |
| **S2-TIMING** | A、受控服务端时钟、确定性 barrier、真实 PG、真实 Nginx/Chromium | 四类交错（保存/在途提交、跨截止、双击/重试/响应丢失、重启两窗口） | `evidence/S2-TIMING/S2-GATE-r3-live/` 与 `S2-GATE-r3-inproc/`、`S2-BROWSER-r4`、`S2-*` 失败轮保留 | live 38、inproc 36、browser 25 断言 | 全过；无新语义错误；3 项公平性/UX 落差 | 每案例 1 遍（ADDENDUM §2.3）；归档 PASS；独立复跑见 §5.6（r2 live+inproc 通过；browser 未复跑） |
| **S3-ADMIT** | 同场 200 × P3 × overlay、池 10、取时/重试策略不变 | 事务前全局手动交卷上限 S_sub=4（Q=200/W=15s） | `evidence/S3-ADMIT/` 8 正式 + 1 pilot + 2 拒绝机制 run；`s3-analysis.json` | 3 对 + A/A 2 轮 + pilot 1 | save −90.6%、hb −98.8%、监考 −97.8%、完成数不变；末位 +33.4%、p99 +33.7%、p50 −20.9% | **触发**（T7 a∧b，上游 S1 run `S1-SUBMIT-same-overlay-r1` / `cross-overlay-r1`）；n=3；仅同场；PASS |
| **M1-RUNTIME** | — | W1–W6（稳态/登录/交卷/混合/重连/scanner） | **无 run** | 0 | 无 | **未启动（Owner 缩减指令；PROTOCOL-ADDENDUM §1）** |
| **L3（barrier）** | 单 Fastify、K=4/Q=189/W=5s、真实 Nginx | FIFO 准入机制正确性：断连 0 次哈希、队满/到期/释放恰一次、≤Q/≤K、无残留 | `evidence/L3/L3-BARRIER-NGINX-20261120T035200/`、`L3/*.json`、gate/route 测试 | 4 轮 × 15/15；gate 9/9 + route 8/8 | 全绿；`503 LOGIN_BUSY` + `Retry-After`；断连后 0 次 verify；release 恰一次 | 发布端口一跳源 IP 坍缩（T-SHARED 形态）；机制证据，非性能；独立复跑见 §5.6（新 run 15/15 + vitest 17/17） |
| **L3-ADMISSION** | P2×S200×T-DIRECT、同一到达表、K=4/Q=189/W=5s | A vs B（登录 FIFO 准入） | `evidence/L3-ADMISSION/` 3 对 + 2 A/A + 1 pilot；`l3-paired-analysis.json` | 3 对 × 200 login + 3258 op | login p99 −2.9%（A/A 14.68%）；CPU/成功 −1.6%；RSS +7.4%；200/200、0×503；B 队长峰 0 | **T1 不满足 → NO_GO_NOW**；单场景、n=3；PASS（作为否决证据） |
| **L4-RETRY** | — | 客户端透明重试（503/Retry-After 行为断言与收益） | **无 run** | 0 | 无 | **未启动（Owner 缩减指令；PROTOCOL-ADDENDUM §1）**；T8 随之永久不可触发；采用 B 前必须补验 |
| **RT-B-WATT** | — | 1 Worker 包装 overhead 低成本测 | **无 run** | 0 | 无 | **未启动（条件未触发）**：G5 要求主线程因果证据 + 目标容量未满足；本轮判 KEEP（E-RT-KEEP）；非 Owner 点名裁撤 |
| **RT-C-WATT** | — | 多 Worker {1,2,4} 对照 | **无 run** | 0 | 无 | **未启动（Owner 缩减指令；PROTOCOL-ADDENDUM §1）** |

**处置汇总**：实际运行 **8** 项（G1、L1、L2、S1、S2、S3、L3 barrier、L3-ADMISSION）；未启动/未触发 **5** 项（O1、M1、L4、RT-B、RT-C；其中 4 项 Owner 缩减指令、1 项条件未触发）；**阻塞 0**。失败轮：L2 的 `FAILED-L2-ARRIVAL-P2-S200-r1-api-unavailable`（API 中途消失，499×502，保留 FAILED.md、不计统计，正式对由重跑补齐）；S2 的 `S2-LIVE-protocol-r1/r2`、`S2-INPROCESS-r1`、`S2-BROWSER-r1/r2`（脚本/布局缺陷，修复后 r3/r4 通过）——均按 R2 保留，不吞错。

### 4.2 研究性门槛与产品 SLA（分开标明）

| 门槛 | 预注册值 | 性质 | 本轮结果 | 判定 |
| --- | --- | --- | --- | --- |
| T1（#1021 采纳） | 登录 p99 **或** CPU/成功改善 ≥10%（配对中位）；RSS <10%；语义不变 | 研究性 | −2.9% / −1.6%；RSS +7.4%；语义不变 | **不满足** |
| T2（#900 Watt） | p99 或吞吐实益 ≥15%；RSS <15%；宿主 CPU <10%；无新语义错误 | 研究性 | 未进入 Watt；无对照 | 不适用（KEEP） |
| T3（QoS 无回归） | save/hb p99 配对中位恶化 <10% | 研究性 | B：save +4.0%、hb −17.1%（均在 A/A 噪声内）；S4：大幅改善 | B 通过；S4 通过 |
| T4（A/A 噪声） | 同臂相对极差 < 预期收益一半（T1 5pp / T2 7.5pp） | 研究性 | L3 A/A login p99 14.68%（超 5pp，按 P2×S200 分位数抖动排查；未追加复测，因两指标面值远低于门禁）；L2 S200 同臂全距 1.3%/15.6% | **p99 效应 INCONCLUSIVE**；采纳决定 NO_GO_NOW 不变（P2 三轮 B 排队为 0） |
| T5（零新语义错误） | 出现 A 未有的错误类/正确凭据 401/S2 不变量失败 → 暂停采纳 | 研究性 | L3 9 轮 0×401/429/503（拒绝分类口径；flow-B 设计内 `/me` 401 不计）；S4 下 S2 38+36+25 全过；无重复副作用 | 通过 |
| T6（driver 余量） | CPU <30%、单核 <90%、lag p99 <50ms、丢样 0 | 研究性 | L2 49 PASS；**P3 18 轮未过**（lag p99 525–757ms ≥50ms，按协议作废/`LOAD_GENERATOR_BLOCKED`，不作容量结论）；S1/S3/L3 全 PASS | **P3 未过（协议 T6）；其余通过** |
| T7（S3 触发） | 借连接 p99 ≥100ms **或** save/hb 恶化 ≥2× 且 ≥50ms | 研究性 | 分位数残差 2056–2254ms（非逐请求直读）；save 33.9×/38.6×、hb 9.7×/31.1× | **触发** |
| T8（L4 扩大） | 真实流量出现 503 LOGIN_BUSY + 排队超时 ≥1% offered | 研究性 | L3 B 0/800 offered；T8 不可触发 | 未触发; L4 已裁撤 |
| **产品 SLA** | **仓库无客户 SLA** | 非研究性 | 本报告不认证容量 | 留给 Owner |

**历史比较项（只作对照，不是门禁）**：Login CPU/成功 低并发 ~121ms → 高并发 ~550ms（#1018/#1021）；Node 24 vs 26 ±0.8%；登录 7–10s、交卷 1–4s（#550/#584 特定 WSL 拓扑）；#668 同场交卷进程内 p99 改善 62–68%（非 HTTP 端到端）。本轮对应观测：登录 CPU/成功 61.4ms（C=1 HTTP）→ 208.8ms（C=32，fast n=5）；P2×S200 login p99 135ms、P3×S200 6.49s（T6 未过，见 §2.2）；交卷 p99 2.26–2.39s。不同拓扑/口径，**不可直接当作达标/未达标**。

### 4.3 实现收益的配对原始值

**L3（A → B，P2×S200，3 对）**

| 指标 | 对1 A/B | 对2 A/B | 对3 A/B | 配对中位 |
| --- | --- | --- | --- | ---: |
| login p99 | 104/101ms | 101/99ms | 104/99ms | **−2.9%** |
| CPU/成功 | 180.8/176.8ms | 179.5/176.6ms | 176.7/174.4ms | **−1.6%** |
| 峰值 RSS | 484448/520152KB | 476928/526384KB | 522540/502280KB | **+7.4%** |
| save p99 | 78/76ms | 72/80ms | 76/79ms | +4.0% |
| heartbeat p99 | 35/29ms | 28/32ms | 35/26ms | −17.1% |
| start p99 | 83/89ms | 89/114ms | 96/106ms | +10.4% |

**判定分列**：p99 点估计 −2.9%，但 A/A 14.68% > T4 的 5pp，p99 效应 **INCONCLUSIVE**；采纳决定仍为 **NO_GO_NOW**（T1 未满足，A 已达标而 B 无可测收益）。P2 三轮 B 的 waiting 峰均为 0，队列从未启动。

**S3（A → S4，同场 P3 overlay，3 对）**

| 指标 | 对1 A/S4 | 对2 A/S4 | 对3 A/S4 | 配对中位 |
| --- | --- | --- | --- | ---: |
| 交卷 p99 | 2081/2675ms | 2088/2791ms | 2126/2845ms | **+33.7%** |
| 交卷 p50 | 2016/1550ms | 2036/1620ms | 2055/1626ms | **−20.9%** |
| 末位权威确认 | 2086/2695ms | 2109/2813ms | 2138/2866ms | **+33.4%** |
| save p99（T7） | 1518/143ms | 1288/44ms | 1536/153ms | **−90.6%** |
| heartbeat p99（T7） | 1564/126ms | 1613/20ms | 1619/20ms | **−98.8%** |
| 监考读 p99（T7） | 1579/34ms | 1636/36ms | 1679/35ms | **−97.8%** |
| 完成数 | 200/200 | 200/200 | 200/200 | 0% |

**hb 低样本警告**：T7 窗 hb 样本数在部分轮次低至 11–13，此时 p99 等于最大值；上表 hb 数值必须与样本数同看，不单独作为分位数效应（见 §2.6 的原始分布与说明）。

### 4.4 条件分支与未触发的引用链

- **S3 已被触发**：上游 run `S1-SUBMIT-same-overlay-r1` 与 `S1-SUBMIT-cross-overlay-r1` 同时满足 T7(a)（借连接 2254/2157ms ≥100ms）与 T7(b)（save 33.9×/38.6×、hb 9.7×/31.1×，且绝对值 ≥50ms）。
- **T8 未触发**：B 在 P2×S200 真实到达的 0/800 offered 503（`l3-paired-analysis.json` `bLogin503=0`）；且 L4 已裁撤，T8 永久不可触发。
- **RT-B-WATT 未触发**：G5 要求「主线程与考生可见退化有因果证据 + 目标容量未满足」；本轮判 KEEP（E-RT-KEEP），不满足前置；RT-C 另受 Owner 裁撤。
- **O1/M1/L4 未启动**：无上游 run 可引用，依据为 `PROTOCOL-ADDENDUM.md` §1（Owner 缩减指令），这是合法处置。
- **S130 边界补测未触发**：S100→S200 未出现需要夹逼的拐点（P1 基本持平 67→77ms、P2 单调上升 67→135ms、P3 近似线性排空），依据协议 §2.1「仅当出现拐点时补测」；L2 主矩阵已覆盖 S20/50/100/200。

---

## 5. 可复现证据

### 5.1 协议、基线与代码

| 项 | 值 / 路径 |
| --- | --- |
| 冻结协议 | `.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/PROTOCOL.md`，SHA256 `442f0ec61400c62090632490aed2fa6609f7c855221937512f5bc7384fc192aa`（实测 `sha256sum` 一致） |
| 修订附录 | 同目录 `PROTOCOL-ADDENDUM.md`，SHA256 `fd45a4648b5846d26957ba7cb35173926e0649fe8c44388d7739a62f3b2e6073`（一致） |
| 冻结 SHA | `87510894728ee1ca20a530fc20e29fa1f51709b7`（`origin/master`；主工作树同点，未 merge/rebase） |
| 研究 worktree | `/home/hoo/Source/exam/.wt-capacity`，当前分支 `research/capacity-900-1021-l3-admission`（HEAD `21276e0e`） |
| L3 原型 commit | `17f8c27b`（feat(api): add L3 login FIFO admission gate）、`e8cd2a68`、`083b392a`；另 `5dd127e0`、`21276e0e`（barrier 文档/单节点入口） |
| S3 原型 | 工作树未 commit 改动：`apps/api/src/lib/submitAdmission.ts`、`submitAdmission.gate.test.ts`、`attempts.candidate.ts`、`capacityResearch.ts`、`apps/api/dist-s3/`。`git diff --stat`（tracked）：2 files changed, **+77 / −24**；`submitAdmission.ts`、`submitAdmission.gate.test.ts`、`dist-s3/` 为 untracked |
| 构建溯源 | `evidence/S3-ADMIT/build-manifest.json`：A `dist` 来自冻结 SHA 既有构建；S4 `dist-s3` 由 `pnpm exec tsc -p tsconfig.build.json --outDir dist-s3` 构建；两臂 `attempts.candidate.js` 哈希不同 |

> **纪律说明**：研究产物按协议 §13 以未跟踪文件/研究分支形式留在 worktree；本轮报告撰写**未 commit、未 push、未 merge**，主工作树保持 clean。报告先交 Owner 评审；任何产品实现/合并/issue/生产配置另行处理。

### 5.2 复跑命令（代表性）

所有命令均在 `cwd=/home/hoo/Source/exam` 下原样可执行；每个 run 目录的 `cmd.sh` 是该轮完整命令。

```bash
# L1 隔离 verify（示例 C=4，N=600）
pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
  /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/l1-verify.ts \
  --run-id=L1-VERIFY-iso-c4-r1 --concurrency=4 --n=600

# L1 完整 HTTP login（每考生独立源 IP，完整 R1 重置）
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/driver/l1-http-run.sh \
  --run-id=L1-VERIFY-http-c4-r1 --concurrency=4 --n=200 --reset=1

# L2（示例 P2×S200）
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/L2-ARRIVAL/l2-run.sh \
  --run-id=L2-ARRIVAL-P2-S200-r1 --profile=p2 --n=200 --topology=direct --scenario=full --reset=1 --pair=1

# S1（示例同场叠加）
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S1-SUBMIT/s1-run.sh \
  --run-id=S1-SUBMIT-same-overlay-r1 --arm=same --mode=overlay --n=200 --reset=1

# S2（live 协议 + in-process + 浏览器；需先起 8090/8091 代理，见 README）
node .wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S2-TIMING/s2-gate.mjs --run-id=S2-GATE-r3

# S3（示例 S4 臂）
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S3-ADMIT/s3-run.sh \
  --run-id=S3-ADMIT-S4-P3-S200-overlay-r1b --arm=s4 --mode=overlay --n=200 --reset=1

# L3 barrier（真实 Nginx）
node /home/hoo/Source/exam/.wt-capacity/apps/api/node_modules/tsx/dist/cli.mjs \
  /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/l3-barrier-nginx.ts

# L3-ADMISSION（示例 B 臂）
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/L3-ADMISSION/l3-run.sh \
  --run-id=L3-ADMISSION-B-P2-S200-r1b --arm=b --profile=p2 --n=200 --topology=direct --scenario=full --reset=1 --pair=1

# 分析（L2/L3/S1/S3）
python3 .wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/L2-ARRIVAL/l2-analyze.py
python3 .wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/L3-ADMISSION/l3-paired-analysis.py
python3 .wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S1-SUBMIT/s1-analyze.py \
  S1-SUBMIT-cross-pure-r1 S1-SUBMIT-same-pure-r1 S1-SUBMIT-same-pure-r2 \
  S1-SUBMIT-same-overlay-r1 S1-SUBMIT-cross-overlay-r1
python3 .wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S3-ADMIT/s3-analyze.py \
  S3-ADMIT-A-P3-S200-overlay-aa1 S3-ADMIT-A-P3-S200-overlay-aa2 \
  S3-ADMIT-A-P3-S200-overlay-r1a S3-ADMIT-S4-P3-S200-overlay-r1b \
  S3-ADMIT-S4-P3-S200-overlay-r2b S3-ADMIT-A-P3-S200-overlay-r2a \
  S3-ADMIT-A-P3-S200-overlay-r3a S3-ADMIT-S4-P3-S200-overlay-r3b
```

### 5.3 fixture、seed 与脱敏

- fixture：`evidence/fixtures/seed-capacity.ts`（`--phase=db` 重建库；`--phase=data` 经 canonical admin API 建 course/题/考试/publish/proctor + DB 批量直插考生）。
- seed 规模（`evidence/fixtures/seed-manifest.json`）：**400 合成考生** = 同场组 1 场×200 + 跨场组 10 场×20（同 course 蓝图、12 题 true_false、90min、每题 10 分、总分 120、maxAttempts=1）；11 场考试；2 个 course 蓝图（`blueprintCourses=2`、`questionsPerExam=12`）；2 proctor + 1 admin + canonical 2 candidate。
- 口令纪律：manifest 只记录 `passwordConstant` 指针（`harness/lib/config.ts` 中的合成口令）与 argon2id `m=65536,t=3,p=4`；**不归档明文口令、完整哈希、cookie、token**。浏览器轨迹中凭据均为 `<redacted>` 占位（A 18 处/B 19 处，`<redacted>` 字符串实测计数；`eyJ` 片段 0 次），JWT 仅内存解码 claims、不落盘。
- 到达表：`evidence/L2-ARRIVAL/…/schedule.jsonl`（seed=9001021，flow=mix，b-share=0.1）；S1/S3 的 `arrival-p3-200.json` 与 `arrival-p3-20.json` 逐字节相同（SHA256 见两份 README）。
- 原始数据：每 run `samples.jsonl`（逐请求原始行）、`driver.json`、`db-oracle.json`/`oracle.json`、`api-sampler.jsonl`、`api-research-snapshots.jsonl`、`pg-activity.jsonl`、`nginx-access.log`、`cmd.sh`。本战役的原始数据为 **JSON/JSONL**（未生成 CSV）；所有 JSON/JSONL 均按原样归档，未做二次加工。

### 5.4 SHA256 manifest 与完整性（本会话实测）

| 目录 | manifest 条目 | `sha256sum -c` 结果 |
| --- | ---: | --- |
| `evidence/L1-VERIFY/` | 1439 | **1439/1439 OK** |
| `evidence/L2-ARRIVAL/` | 1563 | **1563/1563 OK** |
| `evidence/S1-SUBMIT/` | 177 | **177/177 OK** |
| `evidence/S2-TIMING/` | 96 | **96/96 OK** |
| `evidence/S3-ADMIT/` | 315 | **315/315 OK** |
| `evidence/L3-ADMISSION/` | 224 | **224/224 OK** |

> 说明（r3 定稿复核更新）：六个 manifest 均在本定稿会话用 `sha256sum -c` 逐条重验，全部 OK。L1 README §6 的「1405」为较早的计数；当前 manifest 为 1439 条且全部 OK。**S2-TIMING manifest 已于 2026-11-20 19:55 重新生成并扩为 96 条**（含 Owner 评审复跑的 `S2-GATE-OWNER-RERUN-r1-live/`、`S2-GATE-OWNER-RERUN-r2-{live,inproc}/` 共 6 条；r2 报告写作时的 60 条计数已被取代），96/96 全 OK。仍不在任何 manifest 内的新增产物：复核复跑 `L2-ARRIVAL-P2-S200-RECHECK-r1`（生成于 L2 manifest 之后）、`evidence/L3/L3-BARRIER-NGINX-20261120T095755/`、`evidence/OWNER-REVIEW-RERUN/`——三者均未改动任何既有 manifest 条目。

### 5.5 报告数字的复核记录（本会话）

**r3 定稿复核（报告撰写会话，2026-11-20 晚）**：本节以下 1–9 条为 r2 阶段的复核记录；r3 定稿时由报告撰写会话对**本报告全部表格数字**逐项重开原始数据核对，未发现新的不一致，仅更正三处誊写/计数（已就地改入正文）：

1. 更正 §1.2 与 §4.3 的 heartbeat 配对中位原文值 1564 → **1613ms**（A 臂三轮 {1564,1613,1619} 的中位；配对 Δ 中位 −98.8% 不变）；
2. 更正 §2.2 同臂相邻差 ≤12.3% → **≤12.2%**（P2×S200 时间序相邻差 {3.0, 12.2, 9.0, 7.5}%）；
3. 更正 §5.4 S2-TIMING manifest 计数 60 → **96**（manifest 已于 19:55 重新生成并纳入 Owner 复跑 6 条，96/96 OK）。

r3 实测核对方式与覆盖（全部只读，不改证据树）：L1 95 个正式 run 的 fast/unprobed/全样本吞吐、CPU/成功、p50/p99、RSS 全部从 `analysis.json` 的 `perRun`/`perPoint` 独立重算；ELU=1720/9405=18.29% 与 EL p90 中位 1.39ms/max 62.55ms 分别从 `L1-VERIFY-http-c32-r6/api-summary.json` 与 `api-research-snapshots.jsonl`（9 个快照）重算。L2 12 个 cell 的 p95/p99[min,max]/最后 login/save/hb/最后 submit 从 `l2-analysis.json` 逐 cell 重算；T-SHARED 两轮的 429 分类（非 `/me` 207、`/me` 实际 429 69、`/me` 401 40、200 2、状态 null=依赖取消 996）直接从两轮 `samples.jsonl` 逐行重数；P1 vs P2 配对 Δ（+75.3%/+35.7%/+116%/+133%/−9.1% 与方向一致性）与 A/A 全距、save/hb 样本量区间（S20 [36,37]/[16,17] … S200 [371,382]/[171,182]）、EL 按形态最大值（25.15/22.02/49.22ms）逐一复核；`L2-ARRIVAL-P2-S200-r1` 用仓库分析器在归档原始数据副本上独立复跑（输出逐字一致：`login ok=200/200 indep=200 p99=135ms save p99=95ms hb p99=30ms cpu/succ=220.9ms t6=PASS`），并直接检查 raw 排序尾部（[96,96,96,101,101,102,118,127,135,143]）确认分位数口径；`L2-ARRIVAL-P2-S200-RECHECK-r1` 的全部指标与 oracle（200 graded、371 receipts、distinct 200、loginSuccessAll 202）从该 run 文件重读。S1 五轮 p50/p99/末位、借连接残差估计 {2056,2160,2168,2254,2157}、PG 池 10/`pollsAtMax10` {3,6,3,4,5}、T7(b) save/hb/监考 {33.9×,9.7×,49.5×}/{38.6×,31.1×,45.6×}、同场 vs 跨场差分 {+5.6%,+2.2%}、主线程占进程 CPU {83.1–87.7%}、T7 窗 EL max {16.33–49.84ms} 全部从 `s1-analysis.json` 复算；oracle 节的 perExamTerminal 直接验证同场=1 场×200、跨场=10 场×20。L3-ADMISSION 三对原始值（逐对 A/B 六指标）、A/A 地板（aa1 117ms vs aa2 101ms → 14.68%）、B 臂准入计数（204/204/204、waiting 峰 0、permits 峰 4）从 `l3-paired-analysis.json` 与 `arm-check-post.json` 复核。L3 barrier 归档轮与 Owner 复跑轮各 15/15（A/B/C ×5）从两个 `l3-barrier-nginx.json` 复核。S2 四套断言计数（归档 live 38/36、browser 25×2、S3 重验 38/36/25、Owner 复跑 38/36）从各 `assertions.json` 重读；②-a 时间线（T=07:41:49.678Z、route 样本=T−2000ms 逐 ms 相等、barrier 释放 07:41:50.685Z、落库 07:41:50.724Z）与 ②-b/②-c/②-d/②-e1/②-e2/②-e3 的 submittedMs/审计/评分字段从 `S2-GATE-r3-{live,inproc}/samples.jsonl` 原始事件重读；①-a 46.2ms、①-b' serverVersion=0、③-a outcome 集、③-c 单 POST、③-d 代理捕获 3996B、④-A/④-B 新 pid {2969513,2969765} 从对应 samples/assertions 复核。S3 三对全部 12 列（p50/p99/末位/save/hb/监考/PG 池）+ A/A（p99 +11.1%、hb 32 vs 1397ms）+ 门计数（200/200/200、waiting 峰 192、permits 峰 4、live 全 0）+ 两个拒绝机制 run（各 10/10 断言；4+2×503 与 5+1×503）从 `s3-analysis.json`/`results.json` 复算；§1.3 的「P2-S200-r1 最后 30s 主线程 25.1% 单核、进程 74.3% 单核」从该 run `api-sampler.jsonl` 原始 tick 重算（7540ms/22290ms ÷ 30000ms）。六个 manifest 的 `sha256sum -c` 全部重跑（1439/1563/177/96/315/224 条全 OK）；`PROTOCOL.md`/`PROTOCOL-ADDENDUM.md` 哈希重验一致；G1 两条轨迹的 40/62 请求、16/17 个 API 请求、7/7+4/4 断言与 wire↔日志时序（90/85.8ms）从 trace 与 `oracle.md` 复读；seed totals（400/11/12/2/2）从 `seed-manifest.json` 复读；env-freeze 版本面（Ubuntu 26.04.1、Node v24.15.0、pnpm 11.1.2、argon2 0.41.1、postgres.js 3.4.9、Fastify 5.8.5、池 10、libuv 4、15GiB）逐项复读。

以下为 r2 阶段的复核记录：

初稿撰写时只做了分析器复算；定稿复核阶段另执行了一次**真实负载复跑**（`L2-ARRIVAL-P2-S200-RECHECK-r1`，2026-11-20 17:14–17:20 CST，新 run-id、未覆盖原 run），并保留对原始 run 的分析器复算。具体：

1. **代表性样例负载复跑（真实执行）**：`l2-run.sh --run-id=L2-ARRIVAL-P2-S200-RECHECK-r1 --profile=p2 --n=200 --topology=direct --scenario=full --reset=1 --pair=9`。到达表归一化后与原 run 逐行相同（3258 op，seed 9001021，flow=mix，b-share=0.1）；driver `planned=sent=gotResponse=3258`、login 200/200、0×429/503/网络失败、dropped=0、T6 PASS。`l2-metrics.json`：login p50/p95/p99=57/78/114ms、save p99=75ms、hb p99=28ms、CPU/成功 176.7ms、最后 login 240.002s、最后 submit 283.614s。`oracle.json`/`oracle.log`：200 attempts 全 `graded`/`manual`、每 attempt 12 条 grading entry、`frozenQuestions=12`、`answersMatchDriver=true` 200/200、receipts 合计 371（171 人 ×2 + 29 人 ×1）、`dupActive=dupTerminal=0`；`db-oracle.json`：`loginSuccessDistinctCandidates=200`、`loginSuccessAll=202`、`loginFailure=0`、graded 200。**绝对时延/CPU 与归档批次不同**：归档 r1 为 135/95/30ms、CPU 220.9ms（5-run p99 区间 122–143ms），复跑 114/75/28ms、CPU 176.7ms；这证明绝对容量值存在跨会话/跨批次波动，报告已按「单批次观测」解读（见「复核结论」）。该 RECHECK run 不在原 1563 条 L2 manifest 内（manifest 生成于复跑前），未改动任何既有证据文件。
2. **原始 run 的分析器复算（只读副本）**：把 `L2-ARRIVAL-P2-S200-r1` 的原始产物复制到 `/tmp/capreport/repro-p2s200`（不改证据树），执行仓库分析器：
   `python3 -I .wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/L2-ARRIVAL/l2-metrics.py --run-dir=/tmp/capreport/repro-p2s200`
   输出 `login ok=200/200 indep=200 p99=135ms save p99=95ms hb p99=30ms cpu/succ=220.9ms t6=PASS`；与归档 `l2-metrics.json` 的 `login`/`inProgressOps`/`completion`/`apiCpu`/`t6` **5/5 节完全 MATCH**。`db-oracle.json` 独立成功 200、graded 200、无不变量违反。
3. **L2 全部 60 个主矩阵 run**：不经 `l2-analyze.py`，直接从 `samples.jsonl` 复算每 cell 的 p95/p99/last/save/hb，与 `l2-analysis.json` 的 12 个 cell 全部一致（本文 §2.2 表即该复算结果）。
4. **L1**：从 `analysis.json` 的 `perRun` 复算 fast n=5 的 HTTP 吞吐/CPU/p99/RSS 与隔离平台（41.62–41.95/s、maxInFlight=4）；从 `L1-VERIFY-http-c32-r6/api-summary.json` 复算 ELU 1720/9405=18.3%，从 `api-research-snapshots.jsonl` 复算 EL p90 中位 1.39ms、max 62.55ms。
5. **S1**：从 `s1-analysis.json` 复算 5 轮的 borrow 估计 2056–2254ms、save/hb/proctor 配对值。`submittedAtFirst/Last` 只作为业务提交时间，**不可当作 DB COMMIT 时刻**（S2 观测到 `submittedAt` 可比落库早约 3.05s），因此不据此声称 COMMIT 跨度；原「COMMIT 后约 1.3s」改为待验证解释。主线程 65–116% 的推导已撤回，改用可直接复核的 83–88% 占进程 CPU。
6. **S3**：从 `s3-analysis.json` 复算 3 对的 p50/p99/末位/save/hb/监考与门计数（200/200、waiting 192/permits 4、0 queueFull/timeout）；与各 run `oracle.json`（200 graded、receipts 400、audit 1/人）一致；拒绝机制 `results.json` 20/20 断言 PASS。
7. **L3-ADMISSION**：从 `l3-paired-analysis.json` 复算 3 对的 login p99/CPU/RSS/save/hb/start 与 A/A 地板 14.68%/1.77%；B 臂 `acquireEntered=admitted=released=204`（200 考生 + 4 次 admin/仪表登录）、waiting 峰 0、permits 峰 4。
8. **S2**：逐条读取 `S2-GATE-r3-live/assertions.json`（38/38）、`S2-GATE-r3-inproc/assertions.json`（36/36）、`S2-BROWSER-r4/assertions.json`（25/25），并从 `S2-GATE-r3-inproc/samples.jsonl` 复核 ②-a 的 T/route 样本/释放时刻（T=07:41:49.678Z、route=T−2s、释放 07:41:50.685Z）。独立复跑见 §5.6（r2 live 38/38、inproc 36/36；browser 未复跑）。
9. **G1**：从 `trace-a/b` 复核 16/17 个 API 请求、7/7 与 4/4 UI 断言；`oracle.md` 的 4 项 DB 对账与本会话读取一致（wire login 90ms vs API 85.8ms）。

**数据库 oracle 的边界（如实记录）**：历史 run 的 `oracle.json`/`db-oracle.json` 是 run 时用 durable oracle 直读 PG 写下的权威记录；这些 run 之后研究库已按 R1 重置，**无法对历史 run 重新执行 SQL 对账**，故以归档 oracle 为准。RECHECK run 的 oracle 是在同一 run 的独立 fresh 连接上直读的，且与 driver 期望答案逐条比对（200/200 `answersMatchDriver=true`）。
**无法复核的部分**：L2 失败轮 `FAILED-L2-ARRIVAL-P2-S200-r1-api-unavailable` 的 DB oracle 无法事后补做（DB 已被后续 reset 覆盖），只保留 driver/采样器侧证据与 FAILED.md；L1 的 CPU/op 膨胀机制未归因；L2 P3 的发射展宽只作为平台观测，未进一步归因；PG 池等待的进程内逐请求观测**不可直接观测**，报告已按此标注。

### 5.6 独立复现结论（Owner 评审修订）

Owner 指出运行台账中有两次独立复跑 `exit=1`。本节把「归档断言通过」与「独立复跑」分开记录。所有复跑使用新 run ID，完整命令、退出码、首个失败点、stderr（日志为 `2>&1`）与产物路径落盘在 `evidence/OWNER-REVIEW-RERUN/README.md`。

**原始记录（不可追溯的部分）**：G3/G4 的独立复跑只留下 `exit=1` 这一条（S2 与 L3 barrier），当时的台账没有保存命令、首个失败点与 stderr；因此原始失败原因**不可追溯**。下面的新复跑是对该证据缺口的补救，不冒充对原始失败点的还原。

| 项目 | 归档断言 | 独立复跑（新 run ID） | 命令（完整路径见 README） | 退出码 | 首个失败点 / 结果 | 产物 |
| --- | --- | --- | --- | ---: | --- | --- |
| S2-TIMING | live 38/38、inproc 36/36、browser 25/25（r3/r4） | `S2-GATE-OWNER-RERUN-r2`（本轮 r1 为前置失败） | `node .../S2-TIMING/s2-gate.mjs --run-id=S2-GATE-OWNER-RERUN-r2` | **0** | 本轮 r1：exit 2，`need 5 unused candidates, got 0 (from=0)`（`s2-live.mjs:197`，候选池耗尽，非断言失败）；重置 `exam_550_e2e` 后 r2：live 38/38、inproc 36/36，PASS | `evidence/S2-TIMING/S2-GATE-OWNER-RERUN-r2-{live,inproc}/`；日志 `evidence/OWNER-REVIEW-RERUN/s2-gate-OWNER-RERUN-r{1,2}.log` |
| L3 barrier | 15/15（最终归档 `L3-BARRIER-NGINX-20261120T035200`；报告 §4.1 记 4 轮） | `L3-BARRIER-NGINX-20261120T095755` | `node .../harness/l3-barrier-gate.mjs` | **0** | vitest 17/17（gate 9 + route 8）；real-Nginx 15/15（A/B/C ×5）；`ALL BARRIER TESTS GREEN`。case A rep 5 耗时 59.75s（仍通过；未单独归因） | `evidence/L3/L3-BARRIER-NGINX-20261120T095755/`；日志 `evidence/OWNER-REVIEW-RERUN/l3-barrier-gate-OWNER-RERUN-r1.log` |

**结论**：

- 两个可运行 gate 在新的 run ID 下均**独立通过**；G3/G4 原 `exit=1` 仍是历史事实（原因未被当时台账记录，且没有留下可归因的失败点），但在本环境下**不可复现**。当前证据状态应表述为「可运行部分独立复现通过」，不是「独立复现未通过」，也不能把原始 `exit=1` 当作产品/断言失败。
- S2 的 **browser 25/25 仍为归档证据**：`s2-gate.mjs` 按设计只复跑 live + in-process；不能声称浏览器案例被本次独立复跑覆盖。
- 独立复跑不改变三项裁决；它把可运行部分的证据强度从「未独立复现」提升为「独立复现通过」。
- 新增的 `evidence/OWNER-REVIEW-RERUN/` 与 `L3-BARRIER-NGINX-20261120T095755/` **不在任何 manifest 内**；`S2-GATE-OWNER-RERUN-*` 已随 §5.4 所述的 S2 manifest 重生成（96 条）纳入。所有复跑均未改动任何既有证据文件。

### 5.7 建议 Owner 决策

1. **登录**：接受「保留现状 A（NO_GO_NOW）」，并把 p99 效应单独标为 **INCONCLUSIVE**（A/A 14.68% > T4 5pp）；P2 三轮 B 的排队人数均为 0，是当前无需改产品的最直接理由。B 原型与 barrier 证据保留在 `research/capacity-900-1021-l3-admission`（HEAD `21276e0e`）供未来 P3/更高压力重开；若重开，先补 L4 客户端重试安全性与 ≥5 对 P3 配对。
2. **交卷**：将 S_sub=4 作为「有界候选」而非默认方案；若要采纳，需先定义末位确认/QoS 的产品取舍，并补 S_sub=2/8 与多进程语义；当前不建议直接合入。
3. **运行时**：接受 `KEEP`/`STOP_WATT`；若要推翻，优先补 M1-W3/W4（交卷/混合主线程 vs PG 份额）和 O1（开考归因），再决定是否投入 Watt。**Watt、降低 Argon2 强度、扩大 PG 池都没有本轮证据支持。**
4. **产品容量/SLA**：本轮不认证容量；P3×S200 的 6.49s 登录 p99 是发射展宽 668–927ms 下的观测值，**不是严格同刻时延上界**；2.39s 交卷 p99 与 1.5s 混合 save 尾延迟同样应作为产品目标讨论的输入，而不是承诺值。
5. **共享 NAT 登录优先**：先核实目标学校真实网络拓扑与 Nginx 所见来源，再决定部署或来源限流策略。T-SHARED 两轮均只有 34/100 独立成功，且每轮 69 个 `/me` 实际 429（被 driver 误标为 `me-401-expected`），说明限流从入场第一步就生效；这比 P2 登录 p99 再省几毫秒更影响能否开考。
6. **交卷结果确认（独立于 S4）**：S2 ③-b/④-B 已记录服务端完成提交、响应丢失、UI 提示「提交失败，请重试」。最小产品设计：响应不确定时显示「正在确认交卷结果」，重读当前 `attemptId`；已提交→结果页；仍可提交→允许重试；读取失败→「暂未确认」。这直接解决考生可见的问题，不依赖 S4 是否采纳。
7. **后续工作**：P3 真实同刻需多机 driver；S2 的 3 项公平性/UX 落差建议进入产品语义/文案评审；本轮无需重跑完整容量矩阵，修订后可作为「限定部署、限定负载」的研究结论归档。

---

## 附录 A：证据编号 → 路径

| 编号 | 路径 |
| --- | --- |
| E-G1-01 | `evidence/g1-traces/`（`trace-a-happy-path.json`、`trace-b-refresh-recovery.json`、`oracle.md`、`replay-spec.json`、`screenshots/`） |
| E-L1-01 | `evidence/L1-VERIFY/analysis.json`、`README.md`、`manifest-sha256.txt`、各 `L1-VERIFY-{iso,http}-*` 目录 |
| E-L2-D | `evidence/L2-ARRIVAL/l2-analysis.json`、`l2-metrics.py`、60 个 `L2-ARRIVAL-P*-S*-r*` 目录、`pilot-lock.md` |
| E-L2-S | `evidence/L2-ARRIVAL/L2-SHARED-P2-S100-r1/r2`、`l2-analysis.json` `shared` 节 |
| E-L2-R | `evidence/L2-ARRIVAL/L2-ARRIVAL-P2-S200-RECHECK-r1/`（复核复跑；`l2-metrics.json`、`oracle.json`、`oracle.log`、`db-oracle.json`） |
| E-L2-L | `evidence/L2-ARRIVAL/L2-LOGINONLY-P{2,3}-S100-r{1,2}` |
| E-S1-01 | `evidence/S1-SUBMIT/`（5 正式 run、`s1-analysis.json`、`s1-oracle.ts`、`arrival-p3-200.json`、`README.md`） |
| E-S2-01 | `evidence/S2-TIMING/S2-GATE-r3-live/`、`S2-GATE-r3-inproc/`、`expected.md`、`expected.md.sha256` |
| E-S2-02 | `evidence/S2-TIMING/S2-BROWSER-r4/`、`s2-proxy.mjs`、`s2-browser.ts` |
| E-S3-01 | `evidence/S3-ADMIT/`（8 正式 run、`s3-analysis.json`、`pilot-lock.md`、`build-manifest.json`） |
| E-S3-02 | `evidence/S3-ADMIT/S3-ADMIT-REJECT-timeout-r1/`、`S3-ADMIT-REJECT-queuefull-r1/`、`api-admission-events.log` |
| E-S3-S2 | `evidence/S3-ADMIT/S2-GATE-r1-live/`、`S2-GATE-r1-inproc/`、`S2-BROWSER-r1/`、`s2-reverify.json` |
| E-L3-01 | `evidence/L3/`（`L3-BARRIER-NGINX-20261120T035200/`、`sizing.md`、`disconnect-signal-check.*`） |
| E-L3-02 | `evidence/L3-ADMISSION/`（3 对 + 2 A/A + 1 pilot、`l3-paired-analysis.json`、`pilot-lock.md`） |
| E-RT-KEEP | 本报告 §1.3/§2.5/§2.6 引用的 `analysis.json`/`l2-analysis.json`/`s1-analysis.json`/`l3-paired-analysis.json` 数字 |
| E-L2-T6 | `evidence/L2-ARRIVAL/T6-RECLASSIFICATION.md`（P3 T6 的协议口径重新判定） |
| E-RERUN | `evidence/OWNER-REVIEW-RERUN/`、`evidence/S2-TIMING/S2-GATE-OWNER-RERUN-r2-{live,inproc}/`、`evidence/L3/L3-BARRIER-NGINX-20261120T095755/` |
| E-ADDENDUM | `PROTOCOL-ADDENDUM.md`、`evidence/PROTOCOL-ADDENDUM.md.sha256` |

## 附录 B：关键原始文件清单（最小集）

```text
PROTOCOL.md
PROTOCOL-ADDENDUM.md
evidence/PROTOCOL.md.sha256
evidence/PROTOCOL-ADDENDUM.md.sha256
evidence/env-freeze.md
evidence/topology.md
evidence/fixtures/seed-capacity.ts
evidence/fixtures/seed-manifest.json
evidence/g1-traces/{trace-a-happy-path.json,trace-b-refresh-recovery.json,oracle.md,replay-spec.json}
evidence/L1-VERIFY/{analysis.json,README.md,manifest-sha256.txt}
evidence/L2-ARRIVAL/{l2-analysis.json,l2-metrics.py,l2-run.sh,pilot-lock.md,manifest-sha256.txt}
evidence/L2-ARRIVAL/L2-ARRIVAL-P2-S200-RECHECK-r1/{l2-metrics.json,oracle.json,oracle.log,db-oracle.json}
evidence/S1-SUBMIT/{s1-analysis.json,s1-analyze.py,s1-run.sh,s1-oracle.ts,pilot-lock.md,manifest-sha256.txt}
evidence/S2-TIMING/{expected.md,expected.md.sha256,s2-gate.mjs,s2-live.mjs,s2-inprocess.ts,s2-browser.ts,s2-proxy.mjs,manifest-sha256.txt}
evidence/S3-ADMIT/{s3-analysis.json,s3-analyze.py,s3-run.sh,s3-oracle.ts,pilot-lock.md,build-manifest.json,manifest-sha256.txt}
evidence/L3/{sizing.md,disconnect-signal-check.mjs,disconnect-signal-check.output.txt,L3-BARRIER-NGINX-20261120T035200/l3-barrier-nginx.json}
evidence/L3-ADMISSION/{l3-paired-analysis.json,l3-paired-analysis.py,l3-run.sh,pilot-lock.md,manifest-sha256.txt}
```
