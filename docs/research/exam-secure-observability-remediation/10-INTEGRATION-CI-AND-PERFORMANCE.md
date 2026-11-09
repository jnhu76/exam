# 集成 CI 与性能（TASK-CONTRACT §6 / §6.1）

- 契约出处：`TASK-CONTRACT.md` §6（组合集成 12 项）、§6.1（性能测量）、§9 交付物 7。
- 本文由两部分组成：**CI 分册**（组合门禁与 per-PR CI 的真实状态）与**性能分册**
  （integration vs 冻结 master 的交错 A/B）。性能分册正文保持测量员原文，仅在
  2026-11-09 编纂复核时按归档原始数据修正了 4 组引用数字（见“数字勘误”）。

## 七要素（本文自证）

| 要素 | 值 |
| --- | --- |
| 真实代码 SHA | 集成 `a84b416a0c58cd73a7143eef274ef2c68f0f4fcc`；四 PR head 见 CI-0；性能测量对象 `5d4b2773`（与最终差异见性能分册 §0）；master `5140c3dd…` |
| 运行环境 | 本地 WSL2 6.18.54.1、Node v24.22.1、pnpm 11.1.2、PostgreSQL 18.4、nginx 1.30.5-alpine3.24；CI 为 GitHub Actions（per-PR） |
| 执行命令 | 本文件 CI-4、性能分册 §6；本次实际执行 `gh pr checks/view`、`gh api …/logs`、`git branch -r --contains` |
| 关键测试结果 | per-PR：#922/#924/#926 绿、#923 E2E shard 1 红；组合 12 项见 CI-2；性能 NOT_DETECTED + 确定性成本清单 |
| 原始证据路径 | `gh run 42518523050` / job `128847373789`；`raw/perf-ab/`（12 份 phase JSON、analysis.json、微基准、schema diff）；`raw/saveanswer-e2e/` |
| 已知边界 | 组合 12 项无同一 SHA 的完整归档；调度“6/0”无原始日志；#923 红因 M3 与形状 gate 交互；性能受本机噪声 ±10~55% 限制 |
| 结论可信度 | per-PR 查询 = 高；性能确定性指标 = 高、DB 路径 = 中高；组合门禁 = 中低（多为历史归档，非同一 SHA 一次运行） |

---

## CI 分册 — FULL_INTEGRATION_CI

### CI-0. 对象与环境

| 项 | 值 |
| --- | --- |
| 冻结 master | `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d` |
| 最终集成 | `a84b416a0c58cd73a7143eef274ef2c68f0f4fcc`（`final-closure-integration`；按 #922→#923→#924→#926 依序 merge） |
| PR exact head | #922 `7243aa5c5ab46155d914907b6ff30acf9b51cbe4`；#923 `d3580f3e46e2292317dfe831efd982d475d163e8`；#924 `e81b76a17212c8e321a83f1b0522e54a049326f1`；#926 `1dd4d2067fd81143268aaeea56d2e35ef715a6f3` |
| 环境（本地） | WSL2 Linux 6.18.54.1-microsoft-standard-WSL2；Node v24.22.1；pnpm 11.1.2；PostgreSQL 18.4；nginx 1.30.5-alpine3.24 |
| 环境（GitHub CI） | 仓库 workflow（`gh pr checks`），运行于 GitHub Actions；per-PR 触发 |

### CI-1. per-PR CI（本次执行 `gh pr checks`，2026-11-09）

| PR | final head | 结果 | 说明 |
| --- | --- | --- | --- |
| #922 | `7243aa5c` | **全绿** | Static/Build/API/Package/Web coverage/Production transport regression/E2E 1/2+2/2 全 pass |
| #923 | `d3580f3e` | **FAIL** | `E2E (shard 1/2) fail`（run `42518523050` / job `128847373789`）；其余 pass |
| #924 | `e81b76a1` | 全绿 | 同上 8 项 pass |
| #926 | `1dd4d206` | 全绿 | 同上 8 项 pass |

#923 失败的两条测试（`gh api …/actions/jobs/128847373789/logs` 本次下载）：

1. `apps/e2e/e2e/investigation-ui-acceptance.spec.ts:844`
   `expect(clientDialogText).toContain(forgedRequestId)` —— M3 注入
   `req-forged-prt-0001`，而 #923 的 requestId 形状 gate 只投影 UUID 形状 →
   时间线不再显示该伪造值。**这是形状 gate 与既有 E2E 的真实交互**。
2. `rich-content-overflow…:568` `expect(promptScrollAfter).toBeGreaterThan(promptScrollBefore)`
   —— 富文本键盘滚动几何断言；与本轮四 PR 无已知因果通道，**未归因**（不宣布为
   flake 豁免，只记录为第二条失败）。

### CI-2. 组合门禁（契约 §6 的 12 项）真实归档状态

| # | 契约 §6 项 | 状态 | 证据/缺口 |
| --- | --- | --- | --- |
| 1 | Typecheck | 有归档证据 | 08 §A；review 各文件（`tsc`） |
| 2 | Lint | **无归档原始日志** | 评审记录提及，未归档 |
| 3 | Format | 有局部证据 | 08 §A（prettier --check 单文件） |
| 4 | Unit tests | 有归档证据 | 08 §B 全量 `pnpm test` 13m10s 全绿（@038bcdbc/871d0a4f 时代） |
| 5 | API integration | 有归档证据 | 08 §A 4 文件 55 passed；review-security 多次实跑 |
| 6 | Web tests | 有归档证据 | 08 §B `@exam/web` 183 files passed |
| 7 | PostgreSQL tests | 有归档证据 | 08 §A（repo 15 passed、retention 8 passed） |
| 8 | Real browser E2E | **本次执行：M4/M5 通过；最终 head 组合 E2E 未归档且 #923 红** | `raw/saveanswer-e2e/`；CI-1 |
| 9 | Security Canary | 有归档证据（前轮） | `raw/canary-matrix.md`、FIJ canary 扫描；本轮未重跑 |
| 10 | Nginx live-container | 有归档证据 | 07 + `raw/nginx-fault-injection/`（`runs/` 24 个运行目录） |
| 11 | 完整项目 CI 对应门禁 | **FAIL（per-PR #923）** | CI-1；集成 SHA 不在任何远端分支（`git branch -r --contains a84b416a` 为空，本次执行） |
| 12 | 生产构建一致性 | 部分 | 10 性能分册 §0（双侧 `pnpm build`、FULL TURBO 命中）；未做 `apps/web/dist` 逐字节重建比对 |

**关于“集成门禁过 6/败 0；修复后门禁过 6/败 0”**：该陈述来自本轮调度交接，
**证据库中没有对应的原始命令、输出或日志**；6 项的具体组成也未记录。因此本文
不把它计为已复核的 PASS，只作为“调度声明（未归档）”记录。

### CI-3. 判定

```text
FULL_INTEGRATION_CI = FAIL
  # 依据：最终 exact head 的 per-PR CI 中 #923 E2E shard 1 失败；
  # 且使该 E2E 变绿的 M3 测试修复只存在于 integration worktree 未提交 diff，
  # 任何 commit 都不包含它（git log --all -S 为空）。
  # 组合 12 项门禁没有完整的已归档运行；本地 M4/M5 为本次新增证据。
```

合并前必须闭合：把 M3 forged id 的 UUID 形状修复（或等价 pin）提交到 #924 分支
（或 #923 的后续提交），重跑 #923 的 E2E shard 1 至绿，并在最终集成 SHA 上归档
一次完整的组合门禁输出。

### CI-4. 复现

```bash
gh pr view 922/923/924/926 --json headRefOid,state,mergeStateStatus
gh pr checks 922/923/924/926
gh run view 42518523050 --json jobs --jq '.jobs[] | {name,conclusion}'
gh api repos/jnhu76/exam/actions/jobs/128847373789/logs | grep -n "failed\|expect("
git branch -r --contains a84b416a   # 空：集成 SHA 无远端承载
```

**CI 分册结论可信度**：per-PR 状态与失败日志 = 高（本次直接查询/下载）；
组合 12 项 = 中低（多数项有历史归档，但非同一 SHA 的一次完整运行）；调度声明的
“6/0” = 未验证。

---

## 性能分册 — TASK-CONTRACT §6.1

- 轮次：final closure（TASK-CONTRACT §6.1），交付物 7/12 的性能部分。
- 测量角色：性能测量员（独立 subagent）。
- 报告时间：2026-11-09 01:20 (UTC+8)。执行窗口：主基准 2026-11-08 23:54:29 → 2026-11-09 00:32:51 (UTC+8，bench-program.log RUN_START/RUN_END)；微基准与 nginx 实验 00:40 → 01:15 (UTC+8)。

### 数字勘误（2026-11-09 编纂复核，ARCH-PERF-1）

原报告有 4 组引用数字与 `raw/perf-ab/` 归档原始数据不符、无法再生。按契约 §6.1
“报告必须可从原始数据复现”的要求，**以归档 JSON 为准修正报告数字，不修改原始
JSON**。复核命令：

```bash
cd raw/perf-ab
python3 -I -c "import json;d=json.load(open('analysis.json'));\
print([r for r in d['table'] if r['phase']=='httperr-c8' and r['metric']=='cpuMsPerReq'])"
python3 -I -c "import json;print(json.load(open('micro-api-wrapper.json')))"
python3 -I -c "import json;s=open('micro-projection.json').read();\
print(json.loads(s[s.index('{'):]))"
python3 -I -c "import json;print(json.load(open('micro-react-state.json')))"
```

| 位置 | 原报告 | 归档真值（本次复核） | 修正后 |
| --- | --- | --- | --- |
| §2.1 `httperr-c8` CPU B/A | 1.152 | `analysis.json`：`ratioBA = 1.2355`（medians 0.155/0.191 = 1.232） | 1.2355 |
| §2.3 `postWithMeta` | +48.5 ns（+0.83%） | `micro-api-wrapper.json`：`bMinusANs = 162.7`，`bMinusAPercent = 2.95` | +162.7 ns（+2.95%） |
| §2.3 route projection | A 400~412 → B 814~937，+415~538 ns | `micro-projection.json`：realistic 405.4→908.2（+502.8）；pure-miss 384.4→782.3（+397.9）；pure-template 383.7→903.9（+520.2） | +397.9~520.2 ns/事件 |
| §2.3 React 状态槽 | 6.2→8.1 µs/render（+1.9 µs） | `micro-react-state.json`：5994→7978 ns/render，`delta = 1984 ns` | 5.994→7.978 µs（+1.984 µs） |

方向与量级不变（B 更贵/更省、6/6 同向等判定不翻转）；差异属引用错误，已在
各小节就地修正。

## 0. 被测对象与环境

| 项 | 值 |
| --- | --- |
| A（baseline） | master `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d`，独立 worktree `/home/hoo/Source/exam-gap-worktrees/perf-baseline`（ detached，测量后保留供复审） |
| B（integration） | `5d4b2773cf62f93e40fa5661e0d5e19700f40b17`（`final-closure-integration`，= #922→#923→#924→#926 四 PR exact HEAD 依序合并；worktree `/home/hoo/Source/exam-gap-worktrees/integration-final`） |
| Node | v24.22.1（client 与 server 同机同版本） |
| Fastify / Pino / nginx | fastify 5.8.5 / pino 10.3.1 / nginx 1.30.5-alpine3.24（nginx 实验容器） |
| PostgreSQL | 18.4（容器 exam-dev-db-1，单容器多库隔离） |
| API 拓扑 | 每 worktree `tsx src/server.ts`（dev 直跑源码；两变体同构），APP_MODE=e2e（限流结构性关闭），端口 A=3311 / B=3312 |
| 隔离库 | `exam_ci_perf_ab_base` / `exam_ci_perf_ab_int`（`exam_ci[_-]<suffix>` 合法 full-reset 族；各自 migrate+seed:e2e；DB-backed 基准全程串行） |
| 背景降噪 | HEARTBEAT_SCAN_INTERVAL_MS=60000、HEARTBEAT_TIMEOUT_MS=3600000（防 attempts 被标记 disrupted） |
| 硬件 | WSL2 6.18.54.1，8 vCPU，16 GB（同机跑有他人遗留的 dev server，噪声见 §5） |
| stale-dist 防护 | 两 worktree 均重跑 `pnpm build`（B 为 FULL TURBO 缓存命中 = dist 与 HEAD 输入一致）；B 侧运行时 import 的 `@exam/contracts/dist/clientEventRoute.js` 经 node 实测可调用（`projectClientEventRoute('/admin/exams/123') → '/admin/exams/:id'`） |

**测量对象与最终集成的差异（本次复核）**：性能测量对象是 `5d4b2773`；最终集成
`a84b416a` 在其后仅增加评审修复。`git diff --stat 5d4b2773 a84b416a`（本次执行）
共 10 个文件 +388/−33：`proctorMonitoringService.ts`（+19，client-claimed id 形状
gate）、`nginxWebConf.test.ts`、`api.ts`/`api.test.ts`（未用面清理）、
`TakeExamPage.saveRejectionRequestId.test.tsx`、`deploy/nginx/web.conf`（注释与
80 端口配方）、`docker-compose.yml`（healthcheck 路径）、`docs/*`。
**`apps/api/src/routes/attempts.candidate.ts`、域/引擎/db 不在其中**，故 SaveAnswer
路径的 A/B 结论对 `a84b416a` 仍适用；微基准（api.ts 清理后 `postWithMeta` 仍在）
量级不变。

**数据库路由事故与修复（如实披露）**：首轮启动用 `DATABASE_URL` 指定隔离库，但 `APP_MODE=e2e` 下 `packages/db/src/databaseUrl.ts` 走 TEST 分支（`TEST_DATABASE_URL ?? TEST_DB_URL ?? exam_test`），**忽略 `DATABASE_URL`**——两服务器实际连上了共享 vitest 库 `exam_test`。经 `pg_stat_activity` 发现后立即杀停，并精确删除本次误写入的 4 行 `audit_logs`（2×login.failure、2×login.success，按 id 删，`SELECT count(*)` 复核为 0）。随后以 `TEST_DATABASE_URL` 重启并每轮用 `pg_stat_activity WHERE datname=...` 验证实际连接库后才开测。基准期内未再触碰任何 harness 拥有的库。

## 1. 方法

- **交错 A/B**：`run-bench.sh` 共 6 rep；rep 奇数序 `base→int`、偶数序 `int→base`（起始变体轮转）。每变体每 rep 依次跑 9 个 phase：`answers-c1`、`answers-c3`（每 candidate 一条 attempt 串行链，领域真实并发形态）、`answers-c8`（8 lane 压力，含 attempt 行锁 409）、`reject-c8`（baseVersion 超前 → HTTP 200 `accepted:false` FUTURE_VERSION）、`events-safe-c8`（10 事件/批，route=真实 SPA 路径）、`events-miss-c8`（10 事件/批，route=未知路径，投影 miss 最坏形态）、`get-c8`、`heartbeat-c3`、`httperr-c8`（404，无 DB 微路径）。
- 每 phase：6s 预热（不计）+ 12s 测量窗；窗边界采样：客户端逐请求时延（performance.now）、状态码、`accepted` 计数、响应 `x-request-id` 头存在性；服务器子进程 `/proc/<pid>/stat` utime+stime（jiffy=10ms）；Pino stdout 文件字节偏移；`pg_stat_database`（xact_commit/rollback、tup_*，1.6s settle 覆盖 500ms stats flush）；四张业务表精确 `COUNT(*)` 增量（exam_answer_save_receipts / client_events / audit_logs / exam_attempts）。
- 答案形状按题型真实生成（single_choice=optionId、multiple_choice=[2 optionId]、true_false=bool、fill_blank=string），baseVersion 链式跟随 serverVersion；clientSeq 从 500000 起（避开 seed 已占用低段——低段撞车会触发幂等重放：`accepted:true` 但不写 receipt，会污染写入计数；已用 smoke run 识别并修正）。
- 服务器代码两侧 SaveAnswer 路径 diff 为零（`git diff 5140c3dd..5d4b2773 -- apps/api/src/routes/attempts.candidate.ts` 为空），A/B 差异仅：requestIdHeader onRequest 钩子 + 响应头、#925 pino req 序列化器（url+host → route 模板）、client-events route 投影、根 404 边界、CORS fp 根作用域 + expose-headers。
- 原始数据：`raw/perf-ab/`（12 份 phase JSON，共 1,143,112 个请求样本聚合；两份 pino 全量日志 539MB/458MB 未整档，档内存字节统计、行样例与逐 phase 字节差）。

## 2. 主结果（6 rep 中位数；A=base，B=int；spread=min-max/median）

### 2.1 SaveAnswer（保护主目标）

| phase/metric | A | B | B/A | per-rep B/A 离散 | 方向一致性 |
| --- | --- | --- | --- | --- | --- |
| answers-c1 rps | 34.2 | 34.1 | 0.997 | ±28% | 4/6 |
| answers-c1 p50/p95/p99 ms | 34.5/43.9/49.7 | 28.9/41.0/49.3 | 0.84/0.93/0.99 | ±21~108% | 混合 |
| answers-c3 rps | 83.4 | 80.8 | 0.969 | ±55% | 3/6 |
| answers-c3 p50/p95/p99 ms | 37.0/48.3/65.2 | 40.5/48.1/52.9 | 1.10/1.00/0.81 | ±36~130% | 混合 |
| answers-c8 rps | 71.3 | 74.3 | 1.042 | ±16% | 3/6 |
| answers-c8 p95/p99 ms | 275/290 | 288/307 | 1.046/1.059 | ±10~25% | 混合 |
| answers CPU ms/req（c1/c3/c8） | 10.9/8.4/10.5 | 10.3/8.6/10.9 | 0.95/1.03/1.04 | ±19~52% | 混合 |
| reject-c8 rps | 97.9 | 109.2 | 1.116 | ±15% | 4/6（B 快） |
| reject-c8 CPU ms/req | 7.48 | 7.15 | 0.955 | ±13% | **B 更省 6/6** |
| httperr-c8 CPU ms/req（无 DB 微路径） | 0.155 | 0.191 | **1.2355** | ±31% | **B 更贵 6/6**（+0.036ms/req 绝对值） |
| heartbeat-c3 p50 ms | 15.0 | 17.0 | 1.043 | ±21% | 5/6（B 略慢，带内） |

**解读（如实区分可分辨与不可分辨）**：
1. DB 绑定场景（answers/reject/get/events/heartbeat）的吞吐/时延/CPU 中位数差均在 ±5% 内且 per-rep 方向不一致（1~5/6）——**在本机噪声水平下不可分辨**。不宣称"零成本"：分辨率下界即噪声带 ±10~55%（单 phase 单指标）。
2. 两个方向相反的 6/6 一致信号都真实存在且互不矛盾：
   - `httperr`（404 微路径，请求仅 ~1.2ms）：B 每请求多做 requestIdHeader onRequest 钩子 + 头写入，中位 +0.036ms CPU/req（+15%），6/6 rep 同向——这是**可测到的确定性微成本**，绝对量 ≈ 36µs/请求；
   - `reject`（日志最重场景，A 侧 1096B/req Pino 输出）：B 的 #925 req 序列化器把每行 "incoming request" 的 `req.url+host` 换成 `req.route` 模板（确定性 −6.7% 字节），序列化+写出的 CPU 节省盖过头成本，6/6 rep B 更省（中位 −0.33ms/req）。
   - 头成本量级（µs）在 DB 场景（7~11ms/req）中远低于噪声，与"DB 场景测不出"自洽。
3. `heartbeat` p50 +4.3%（5/6 同向）但 rps 同向 −3.5%、离散 ±21%，判为带内、不可分辨（µs 级头成本无法解释 ms 级差，方向疑为漂移残留）。

### 2.2 确定性指标（spread ≈ 0%，直接测量）

| 指标 | A（base） | B（int） | 差 |
| --- | --- | --- | --- |
| Pino 字节/请求 answers | 530.5 B | 457.6 B | **−13.7%**（#925 req 序列化器） |
| Pino 字节/请求 reject / events / get / heartbeat / httperr | 1096.1 / 453.6 / 484.6 / 495.8 / 461.1 B | 1022.9 / 431.6 / 429.6 / 447.8 / 424.0 B | −6.7% / −4.9% / −11.3% / −9.7% / −8.0% |
| PostgreSQL xact/req（answers-c1/c3、reject、events、get、heartbeat） | 4.05/4.10、4.12、4.99、6.05、6.03 | 3.98/4.12、4.11、5.05、6.13、6.11 | ±≤1.4%（带内；含边界 psql 自身 ~1 xact/窗的常量偏差，两侧对称） |
| exam_answer_save_receipts 增量/请求（answers-c1/c3） | 恰 1.000 | 恰 1.000 | 0（spread 0%） |
| receipts 总量 = accepted:true 总量 | 11,316 = 11,316 | 11,534 = 11,534 | 逐笔相等 |
| client_events 增量/请求（events 两 phase） | 恰 10.000 | 恰 10.000 | 0（spread 0%） |
| 响应携带 `x-request-id` | 0 / 593,174 | 549,938 / 549,938（100%） | **新增确定性行为**：每响应 +53B 头行（`x-request-id: ` + 36 字符 UUID + CRLF） |
| 同端点响应头字节（/api/candidate/exams，dev 默认 origin） | 731 B | 920 B | **+189B** = 53B(request-id) + ~136B(CORS 三行：allow-origin/credentials/expose-headers——#924/#865 将 @fastify/cors fp 提升到根作用域后，配置过的 origin 对所有响应生效；基线的封装式注册使这些头从未真正下发） |
| 响应体字节 | 逐端点相同（969/118/15/75 B） | 相同 | 0 |

### 2.3 前端 / 投影微基准（直接测量增量代码）

| 项 | 结果 |
| --- | --- |
| postWithMeta 热路径（真 undici Response/Headers，5×300k ops 中位） | B−A = **+162.7 ns/请求**（+2.95%）= 1× headers.get + 2× 对象分配；B 侧 `request()` 也委托 `requestWithMeta`（diff 阅读证实），故该成本对全部 api 调用生效 |
| 临时关联状态（react@19.2.6，repo 实际依赖） | TakeExamPage 新增 1× useState 槽 ≈ **+1.984µs/render**（12→13 槽 renderToString 5.994→7.978µs/render，微基准级上界；相对整页渲染占比可忽略）；rejection 分支的第二个 setState 与 setSaveRejection 同点自动批处理：**1 vs 2 个同点 setState 实测均只触发 1 次 re-render**（0 额外渲染）；36 字符 string 常驻可忽略 |
| route projection（10 万 ops 中位，integration dist 实测 vs master 版 normalizeRouteForStorage 逐字复刻） | A 383.7~405.4 ns/事件 → B 782.3~908.2 ns/事件 = **+397.9~520.2 ns/事件**（realistic-mix +502.8ns；pure-miss +397.9ns；pure-template +520.2ns）。对照 events 路径 3.9~4.9ms CPU/req ×10 事件 → 投影占比 ~0.1%，与 events 两 phase 无可分辨差一致 |
| nginx access log 字节/请求 | combined(A) → exam_privacy(B)：api-200 **195.8→125**（−36%）；带 token query **229.7→125**（query 长度直接进 combined `$request`，B 恒定）；SPA 156→84；deep-link 208→84；上游 404 180→125；上游 500 172→125；malformed-400 190→81；client-abort 170→87 |
| nginx error log（故障注入，error 级） | 上游 connection-refused ×100：A 264.8 B/req vs B 264.7 B/req（**逐字节同级**，nginx 原生行含完整请求行——Owner Decision A 已接受的原始 URL 风险，两侧同在）；上游容器停止（DNS 不可解析）×100：A 187.9 vs B 187.9 B/req；malformed/client-abort 在 error 级两侧均 0 输出 |
| 隐私对照（同一投放集） | 基线 combined access log 中 `SECRETTOKEN` 命中 200 处；B 0 处（int 侧 access 样例：`"GET /api" 502 157 rt=4.001 up=-/- reqid=-`） |

## 3. 保护指标（直接证据）

| 指标 | 判定 | 证据 |
| --- | --- | --- |
| **NEW_SUCCESS_TELEMETRY_WRITES** | **= 0** | ① answers 全部 phase 的 client_events `COUNT(*)` 增量：A=0、B=0（12 份 phase JSON `tables.client_events` 全零，load 客户端在 answer phase 不发任何 /client-events）；② 终态普查 `client_events GROUP BY name`：A 库只有 `perf.load.event` 729,760 行、B 库 717,270 行 + 1 行 `perf.probe`（本人探测）——不存在任何 `answer_autosave_succeeded` 类成功遥测行；③ 代码侧：TakeExamPage 成功分支 diff 无 `trackExamEvent` 新增 |
| **NEW_REQUEST_ID_DB_WRITES** | **= 0** | ① 两隔离库 `pg_dump --schema-only` 归一化（剔除 pg_dump 18 随机 `\restrict` token）后 **逐字节相同**（schema-diff.txt 仅 2 行 token 差）；② `information_schema.columns ILIKE '%request%'`：业务表零命中（仅 pg_stat_checkpointer.num_requested 与既有 attempt_command_receipts.request_payload JSON 列）；③ 集成树 repository 层 `grep -rn requestId packages/db/src/repository/` = 0 处；④ `git diff 5140c3dd..5d4b2773 -- packages/db/src/migrations` = 空 |
| **SAVEANSWER_DOMAIN_WRITES** | **UNCHANGED** | 每 accepted:true 保存恰写 1 行 receipt：A、B 均 receipts 增量 ≡ accepted:true 计数（逐 phase 1.000/请求、总量 11316=11316 / 11534=11534）；audit_logs 增量两侧均 0/请求；xact_commit/请求差 ≤1.4%（带内）；SaveAnswer 服务端代码 diff 为空（版本协议、事务边界、receipt 语义未触碰） |
| **PERFORMANCE_VERDICT** | **NOT_DETECTED**（附确定性成本清单） | 见 §4 |

## 4. PERFORMANCE_VERDICT = NOT_DETECTED（依据）

1. **保护主目标 SaveAnswer**：吞吐/时延/CPU/xact/写入计数全部带内（中位差 ≤±5%，方向不一致，噪声带 ±10~55%）；领域写入逐笔相等；零新增遥写、零新增 request-id 持久化。
2. **测到的确定性成本（不宣称零成本）**：每响应 +53B `x-request-id` 头行（int 100% 响应携带，A 0%）；dev 默认 origin 配置下另 +~136B CORS 头（fp 根作用域修复使配置的 CORS 头真正下发——生产行为取决于部署 origin 配置，属 #924/#865 设计内）；404 微路径 CPU +36µs/req（6/6 同向，+15% 相对值）；route 投影 +0.40~0.52µs/事件；postWithMeta +162.7ns/请求；1 个额外 React 状态槽 +~1.98µs/render 且 0 额外 re-render。以上合计在 DB 绑定路径（≥7ms/req）低于本机分辨率。
3. **测到的确定性收益**：Pino 每请求字节 −4.9%~−13.7%（#925 req 序列化器）；nginx access log 每请求 −36%~−57%（且 query/深链秘密不再入档）；reject 场景 CPU 6/6 rep 更省。
4. 不满足 DETECTED 的理由：无可归因的 SaveAnswer/领域路径退化；唯一 6/6 同向的成本信号在无 DB 微路径上、绝对值 36µs/req，且与其镜像信号（reject 6/6 更省）共同构成"头成本 µs 级 + 日志字节节省"的自洽图景，而非系统性退化。

## 5. 噪声、置信与已知边界

| 项 | 说明 |
| --- | --- |
| 噪声水平 | 本机同域有他人遗留 dev server 与 WSL2 调度抖动：单配置 6 rep 极差/中位达 20~50%（前轮审计为 0.8~14%）。交错 A/B + 起始变体轮转保证对比有效性，但**全局声明：B/A 差 >±5%（DB 路径）不声称可分辨**；确定性指标（字节、计数、头存在性、schema）spread≈0%，置信高 |
| CPU 采样 | /proc jiffy 粒度 10ms；c1 场景每窗 ~350 请求 × CPU ~10ms → 总 tick 数百级，量化误差 <1%；httperr 微路径 +36µs/req 的绝对值受 jiffy 量化影响，相对值（6/6 同向）稳健 |
| 拓扑边界 | dev 模式 tsx 直跑源码 + client 同机——绝对值不代表生产构建；两侧条件同一，相对结论有效（与前轮 04-PERFORMANCE.md 同口径） |
| pg_stat 边界 | xact_commit 可信；tup_* 仅参考（异步 flush）；业务表写入用精确 COUNT(*) 取证 |
| 静态目录差异 | B worktree 有 apps/api/public（build 产物）→ 注册 SPA 静态面；A 无 → 注册 rootNotFoundBoundary。基准未触达非 /api 未匹配路径，未影响任何 phase；该差异属部署形态而非本次四 PR 的性能面 |
| answers-c8 | attempt 行锁引发 409（A/B 同分布 12~29%），该 phase 用于压力对照，主结论取 c1/c3 |
| 未测项 | 生产构建产物、HTTPS vhost 激活形态、真实 LAN 带宽下的头字节放大、nginx `warn` 级对照（Owner 决策维持 `error`，07 号报告已有 crit/error/warn 矩阵）——均标注 NOT MEASURED，不外推 |

## 6. 复现

```bash
# 0) 两个 worktree（perf-baseline @ 5140c3dd 已保留；integration-final @ 5d4b2773）各自：
pnpm install --frozen-lockfile && pnpm build
# 1) 隔离库（exam_ci[_-] 合法族，seed:e2e 内含 reset→migrate→seed；串行执行）
docker exec exam-dev-db-1 psql -U exam -d postgres -c "CREATE DATABASE exam_ci_perf_ab_base OWNER exam"
DATABASE_URL=postgresql://exam:exam@127.0.0.1:5432/exam_ci_perf_ab_base \
  pnpm --filter @exam/api db:seed:e2e   # int 同理
# 2) 服务器（注意 APP_MODE=e2e 走 TEST_DATABASE_URL，见 §0 事故）
/tmp/perf-ab/start-server.sh base 3311 && /tmp/perf-ab/start-server.sh int 3312
# 3) 主基准（6 rep 交错）与聚合
bash /tmp/perf-ab/run-bench.sh && node /tmp/perf-ab/analyze.mjs
# 4) 保护证据 / 微基准 / nginx A/B
bash /tmp/perf-ab/protection-evidence.sh
node /tmp/perf-ab/micro-projection.mjs && node /tmp/perf-ab/micro-api-wrapper.mjs && node /tmp/perf-ab/micro-react-state.mjs
bash /tmp/perf-ab/nginx-ab.sh && bash /tmp/perf-ab/nginx-f1.sh
```

脚本与全部原始数据：`raw/perf-ab/`（66 文件：load/analyze/nginx 驱动脚本、12 份 phase JSON、discovery、analysis.json、schema dumps+diff、普查输出、微基准输出、nginx 10 阶段结果与两 variant conf 样例、Pino 行样例、响应头 dump）。

## 7. 结论可信度

- 确定性指标（头字节、Pino 字节、receipts/client_events 计数、schema 等价、nginx 字节）：**高**（spread≈0%，机制可从 diff 直接推出并与实测吻合）。
- DB 路径"无可分辨差异"：**中高**（6 rep 交错、双起始序轮转、每相位独立预热；受本机噪声限制，分辨率下界 ±5%）。
- 微路径 +36µs/req 与 reject −0.33ms/req：**中高**（6/6 同向，量级与机制自洽；绝对值受 jiffy 量化）。
- 前端微基准（+162.7ns/+1.984µs）：**中**（微基准级，隔离真实 fetch 往返，量级远低于任何用户可感知阈值，方向由 diff 结构保证）。
