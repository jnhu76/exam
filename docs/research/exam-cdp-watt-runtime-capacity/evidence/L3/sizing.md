# L3 服务端准入 B 臂 — K/μ/W/Q 试算（sizing）

状态：L3 实验分支 `research/capacity-900-1021-l3-admission`（自冻结 SHA `87510894728ee1ca20a530fc20e29fa1f51709b7` 起）。
上游依据：L1-VERIFY 实测（本战役 L1 结果，candidateK=[4,2,8]、μ 试算依据与四条 keyFindings 原文引用于下）。
本文只做试算与默认值锁定；正式 A/B 配对采样参数以 pilot-lock 为准（协议 §4：只允许取预注册候选，不引入新值）。

## 1. 输入（全部来自 L1 实测，无预测值）

| 量 | 值 | 出处 |
| --- | --- | --- |
| 隔离 verify 平台吞吐 | 41.8/s = 4 个 libuv 线程池槽 × 1/95.7ms | L1 serviceRates ①② |
| 完整 HTTP login 平台 | ≈41/s（快模式 C=8–32 中位 40.9–41.1/s） | L1 ② |
| K=4 拐点服务率 | 38.5/s（平台的 94%） | L1 ③ |
| K=2 / K=8 服务率 | 29.8/s / 40.9/s（K=8 仅 +6% 且 p50 ×1.9） | L1 ③ |
| 混合流量 μ_login 外推 | 38–41/s（保存/心跳/监考读不做 argon2、不占哈希槽；主线程 ELU 18–33% 未饱和；PG 池 pending 进程内不可观测 → NOT_DIRECTLY_OBSERVABLE，如实标注） | L1 ④ |

## 2. K（并发执行许可数，管控完整登录路径）

**主值 K=4**（L1 候选 [4,2,8] 中的拐点）：

- 吞吐边际：1→2 +59%、2→3 +18%、3→4 +10%、4→8 +6%、>8≈0 → K=4 是最后一级"两位数"边际收益；
- K=8 只再拿 6% 但 p50 ×1.9（等待延迟代价直接转嫁给考生）；
- K=4 已达平台的 94%，与 4 个 libuv 哈希槽结构上限一致（饱和 in-flight≈3.98≈4 实测吻合）。

敏感性备注（供 A/B 配对臂选值，不改变主值）：
- K=2 → μ=29.8/s；
- K=8 → μ=40.9/s。

注意（协议 §4 原文）：K 管控的是**含 3 次顺序 PG 读 + argon2 的完整路径**并发，不得等同于正在执行的原生哈希数（许可持有期内 PG 读阶段并不占哈希槽）。

## 3. Q = ⌈μ·W⌉ − K（W 为服务端排队等待预算，单调时钟）

| W（预注册候选） | μ=38.5/s（低端，保守） | μ=41/s（高端） | 区间 | 预注册校验点 |
| --- | --- | --- | --- | --- |
| 2 s | ⌈77.0⌉−4 = 73 | ⌈82⌉−4 = 78 | 73–78 | 100（覆盖） |
| 5 s | ⌈192.5⌉−4 = **189** | ⌈205⌉−4 = 201 | 189–201 | 200（恰好夹住） |
| 10 s | ⌈385⌉−4 = 381 | ⌈410⌉−4 = 406 | 381–406 | 200（超出校验点上限） |
| 15 s | ⌈577.5⌉−4 = 574 | ⌈615⌉−4 = 611 | 574–611 | 同上 |

**锁定默认值（本分支代码内默认，可用 env 覆盖）：K=4，W=5000ms，Q=189**（μ 取低端 38.5/s 的保守试算；不变量"等待数 ≤ Q 且许可数 ≤ K"由 barrier 断言钉住）。

Q=189 的语义：按实测低 端服务率，任何被接纳入队的请求其队内等待 ≤ W 的概率不受服务率波动侵害——第 189 位等待者至多等 189/38.5 ≈ 4.91s < 5s。

## 4. 边界核算（合成负载 P3×S200，同刻 200 人）

- 同时到达 200：1 个立即执行（K 内）+ 196 等待需求；
- Q=189 → 前 189 人入队，**第 190–196 共 7 人立即收到 503 LOGIN_BUSY**（签发前容量拒绝，非凭据错误）；
- 若取 Q=196（全入队）：末位等待者需等 196/38.5 ≈ 5.09s > W=5s → **9 人左右等待到期**，同样以 503 LOGIN_BUSY 结束；
- 结论：W=5s 档位下 P3×S200 无法"零拒绝"吸收——这是容量边界的真实刻画，A/B 配对（L3）与客户端重试（L4）的价值正在于比较两种失败形态下的**独立成功人数**；本试算不做美化解读。
- P2×S200（≥80% 压缩在最后 30 秒 ≈ 5.3/s 到达 ≪ μ）在 W=2s 档即无排队压力；W 档位选择交给 pilot（协议 §4：pilot 锁定，候选 {2,5,10,15}s）。

## 5. Retry-After（整秒）

`Retry-After = max(1, ⌈W_ms/1000⌉)`：W=5s → 5；W=2s → 2；机制测试用 W=800ms → 1。与 L4 拟议契约一致（整秒、客户端预算 D > W 才有意义）。

## 6. 实现要点与 as-built 修正（本分支）

1. **单 Fastify 实例共享预算**：`apps/api/src/lib/loginAdmission.ts` 模块级共享 gate（API 进程恰一个 Fastify 实例），覆盖全部账号密码登录（POST /login 唯一入口）。
2. **位置**：`apps/api/src/routes/auth.ts` login handler 内、zod 体校验之后、`resolveBrandingTenant`/`findByOrganizationAndUsername` 之前；许可持有区间 = 租户读 + 用户读 + 真实/dummy 验证，验证 promise settle 即释放（finally）；角色授权/签发/审计在许可外按 A 原逻辑。
3. **入队前零查询、零账号快照**：`acquire()` 只收 requestId + username 标签；等待期仅占 1 个队列节点 + 1 个超时 timer + 1 个 socket 监听器，不占 PG 连接（经真实 Nginx runner 以 CAPACITY_RESEARCH sqlTotal 静止断言）。
4. **单调时钟**：超时决策只读注入的单调时钟（生产 `performance.now()`）；timer 仅作唤醒，早于单调期限触发的 timer 会被重新武装（barrier 单测钉住该纪律）。`fastify.now()` 墙钟不进入准入路径。
5. **as-built 修正（重要）**：协议 §10 写"订阅 `request.signal`"——实测（Node 24.15.0 / Fastify 5.8.5，复现命令见下）`IncomingMessage` 的 `'close'` 在**请求体读完后立即触发**（对仍连接的客户端也触发），Fastify `request.signal` 正是绑在该事件上，因此**不能**用于体读完后的断连检测；B 臂改订阅 `request.socket` 的 `'close'`（仅在真实传输层拆除时触发）。该修正不改变 G3 断言语义（断开后 0 次哈希），只修正检测机制。
   - 复现：`node /tmp/sigtest.mjs`（见 evidence/L3/disconnect-signal-check.md 归档副本）——body-end 后立即 `SIGNAL ABORTED`（客户端仍连接）；真实断连只触发 `SOCKET CLOSED`。
6. **签发前容量拒绝**：503 + `code: "LOGIN_BUSY"`（研究契约，不进产品 ErrorCode 注册表）+ 整秒 `Retry-After`；不写 `login.failure` 审计（忙碌拒绝不混入凭据错误）；结构化日志 `event: capacity.login_admission`。
7. **机制观测**：gate 内置 counters/peaks/事件环（requestId+username 标签），嵌入 `/api/research/capacity` 快照（CAPACITY_RESEARCH=1 时）；另设 CAPACITY_RESEARCH 门控的确定性 hold failpoint（arm/disarm/release 经 `/api/research/capacity/login-admission-hold`，能力门禁同快照路由）供外部 runner 构造无竞态队列窗口——容量采样 run 从不 arm 即零影响。
8. **机制测试参数**（非容量采样）：barrier 测试用 K=1/Q=2/W=250ms 等机制尺度值 + 虚拟时钟/受控 verify promise，确定性驱动；与正式采样的 K=4/Q=189/W=5000 互不替代。

## 7. 环境开关（研究分支）

| env | 默认 | 语义 |
| --- | --- | --- |
| `LOGIN_ADMISSION` | 未设（A 管线） | `1` 启用 B 臂准入 |
| `LOGIN_ADMISSION_PERMITS` | 4 | K |
| `LOGIN_ADMISSION_QUEUE_CAPACITY` | 189 | Q |
| `LOGIN_ADMISSION_WAIT_BUDGET_MS` | 5000 | W（ms，单调时钟） |

同一构建产物在 run 间切换 env 即可交错复现 A/B 臂（协议 §9.3 每 run 完全重置含 fresh API 进程）。

## 8. Barrier 运行 as-built 记录（2026-11-20）

1. **拓扑隔离**：L3 barrier runner（`harness/l3-barrier-nginx.ts`）全程使用独立资源——API 端口 3310（实验分支构建 `apps/api/dist-l3`，非 A 的 `dist`）、nginx 容器 `exam-cap-nginx-l3` / 端口 8081 / 网络 `exam-cap-net-l3`（172.28.11.0/24）、研究库 `exam_550_l3_barrier`（exam_550 前缀 name-guard，≠ A 采样库 `exam_550_e2e`）。run 前后 A 隔离见证：A 的 `exam-cap-nginx` Up 且 A API（3300）health 200（evidence JSON `aIsolation` 字段）。
2. **源 IP 坍缩（T-SHARED 限制，as-built）**：本拓扑发布端口一跳（Docker Desktop vpnkit → 自建 bridge）把所有客户端源 IP 坍缩为网关 172.28.11.1（nginx `$remote_addr` 与 audit `ip_address` 实测一致），全部登录共享 10/min 预算。按协议 §0.1 禁止关闭 limiter，runner 以限速 pacer（rolling-window 预留）在预算内排队，未伪造转发头。正式 T-DIRECT 配对（每考生独一源 IP）沿用 A 拓扑的既有接线，不受本限制影响。
3. **每 rep 等待占位读数**：case A 每次被 hold 的已准入登录期间 sql 语句增量 20 条（后台 outbox/scanner 循环语句，非登录路径——`sqlDeltaDuringCase` 记录于 evidence）；被排队/被拒请求的 0 次验证由事件环标签归因直接断言（verify_start 事件按 username 标签）。
4. **运行结果**：`evidence/L3/L3-BARRIER-NGINX-20261120T023547/`——case A（两客户端断连）×5、case B（队满 503 LOGIN_BUSY + 整秒 Retry-After=15）×5、case C（W=800ms 等待到期 ×3 waiter → 503 + Retry-After=1）×5，15/15 全绿；此前 6 个调试轮目录标 FAILED 保留。
5. **进程内 barrier 测试**：`apps/api/src/lib/loginAdmission.gate.test.ts`（9 用例：FIFO/K/Q 边界、单调时钟早触发重武装、6 种同刻乱序只结算一次、断连/队满/双释放、残留句柄清零）与 `apps/api/src/routes/auth.loginAdmission.test.ts`（8 用例：体读完后在线等待、真实 socket 两客户端断连 0 验证、验证开始后断连 native settle 才释放、队满/到期 LOGIN_BUSY 不混凭据错误、排队中禁用账号读到最新状态、五种凭据/租户语义、400/429 先于准入）——见 §6 引用的复跑命令。
6. **构建与复跑（cmd.sh 契约）**：dist-l3 隔离构建 `pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/api exec tsc -p tsconfig.build.json --outDir dist-l3`（git-local exclude，不触碰 A 的 `dist`）；全部 barrier（进程内 + 真实 Nginx）独立复跑 = 单一 node 入口（无 shell 链接，供 gate 以 `node <argv>` 形式原样执行；env 由 vitest config 的 supported-env 加载 + runner 自带 env，无需外部导出）：
   `node /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/l3-barrier-gate.mjs`
   （cwd 无关，含 cwd=/home/hoo/Source/exam；前置：dev compose PG/Redis 起、Docker 可用、端口 3310/8081 空闲；runner 自建自清 exam_550_l3_barrier 与隔离容器/网络，A 拓扑不受影响。此前 bash -lc 链接形式的命令在以 `node <argv>` 执行的 gate 中不可用——首元素 `bash` 被 node 当模块加载——已由该单入口脚本取代。）
