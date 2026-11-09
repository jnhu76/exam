# FINAL-OWNER-DECISIONS — Decision A / B / C 的落地结果、证据与边界

- 契约出处：`TASK-CONTRACT.md` §0（三项 Owner 决策）、§4（#926）、§5（#923）、§3（#924）。
- 本文只记录**决定是否落地、以什么形态落地、证据在哪、边界是什么**；不重复性能数字（见
  `10-INTEGRATION-CI-AND-PERFORMANCE.md`）与逐条协议用例（见
  `SAVEANSWER-PROTOCOL-REGRESSIONS.md`）。
- 本文中的“本次复核”指 2026-11-09 证据编纂会话实际执行的命令；未执行的一律标注
  “采信归档/评审记录”。

## 七要素（本文自证）

| 要素 | 值 |
| --- | --- |
| 真实代码 SHA | master `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d`；最终集成 `a84b416a0c58cd73a7143eef274ef2c68f0f4fcc`；PR #922 `7243aa5c5ab46155d914907b6ff30acf9b51cbe4` / #923 `d3580f3e46e2292317dfe831efd982d475d163e8` / #924 `e81b76a17212c8e321a83f1b0522e54a049326f1` / #926 `1dd4d2067fd81143268aaeea56d2e35ef715a6f3` |
| 运行环境 | WSL2 Linux 6.18.54.1-microsoft-standard-WSL2；Node v24.22.1；pnpm 11.1.2；PostgreSQL 18.4（`exam-dev-db-1` / `postgres:18.4-bookworm`）；nginx 1.30.5-alpine3.24（容器实验，见 07）；Playwright Chromium（E2E） |
| 执行命令 | 见 §4；每个结论旁标注是“本次执行”还是“采信”。 |
| 关键测试结果 | Decision A：nginx 24 次故障注入（`runs/`）+ access canary 0（归档）；Decision B：retention 契约 8/8（归档+评审实跑）；Decision C：本次 M4 浏览器 E2E `1 passed`，UI 请求编号与服务器 WARN `reqId` 逐字符相等（见 §3.3） |
| 原始证据路径 | `raw/nginx-fault-injection/`、`raw/saveanswer-e2e/`、`raw/perf-ab/`、`raw/replay-db-routestorage.txt`；文档 `07`–`10` 与四份 `review-*.md` |
| 已知边界 | 部署侧日志驱动/轮转/权限/备份 = UNKNOWN；compose 无 `logging:` 上限；#923 最终 head 的 GitHub E2E 红；M3 修复只存在于 integration worktree 未提交改动（§5） |
| 结论可信度 | Decision A：高（容器级），部署边界 UNKNOWN；Decision B：高（真实 PG），备份边界 UNKNOWN；Decision C：高（本次真实浏览器 + 真实服务器日志同一 UUID），集成 CI 判定为中（见 §5） |

## 0. 冻结对象与 SHA 映射（本次实测）

`git cat-file -t` 对下列 9 个 SHA 全部返回 `commit`（本次执行）。`gh pr view`
（本次执行，2026-11-09）返回的 `headRefOid` 与右列逐一相等。

| 对象 | final head | 说明 |
| --- | --- | --- |
| #922 证据归档 | `7243aa5c` | s0-evidence worktree 当前 HEAD；本轮新增文档仍为未跟踪（见 §5） |
| #923 route 投影 | `d3580f3e` | 含 `871d0a4f`（retention 契约测试）→ `d3580f3e`（requestId 形状 gate） |
| #924 requestId | `e81b76a1` | 含 `872a244f`（SaveAnswer 真实消费）→ `e81b76a1`（heartbeat 负例、删除未用错误面） |
| #926 日志隐私 | `1dd4d206` | 含 `a9155634`（Decision-A error 级）→ `1dd4d206`（80 端口激活配方） |
| 最终集成 | `a84b416a` | 按 #922→#923→#924→#926 依序 merge；`git log --oneline --graph a84b416a` 可见四个 merge commit |

注意：施工线结论中出现的 `871d0a4f`（#923）、`872a244f`（#924）、`a9155634`（#926）
是各自修复轮的中间 head，已被后续 review-fix commit 取代；最终 head 以上表为准
（`git branch -a --contains` 与 `gh pr view` 双向核对）。

## 1. Decision A — #926 保留上游诊断日志

**决定（契约 §0）**：不接受 `error_log crit`；保留 nginx 原生 error 级故障信息，
同时保留安全 access-log 格式；明确接受 error log 可能含完整请求行的风险，但不得
把 access 安全与 error 原始 URL 混为同一安全声明。

**落地结果**

| 项 | 落地形态 | 证据（final SHA） |
| --- | --- | --- |
| error 级 | `error_log /var/log/nginx/error.log error;` | `deploy/nginx/web.conf:65` @ `1dd4d206`；`apps/api/src/nginxWebConf.test.ts:85,92-102`（模板 pin + 禁止 `crit`） |
| access 隐私 | `log_format exam_privacy` + `access_log … exam_privacy` | `deploy/nginx/web.conf:49,64` @ `1dd4d206` |
| HTTPS 激活配方 | 80 端口不再原样明文服务：`location = /healthz { return 200; }` + `location / { return 301 … }` | `deploy/nginx/web.conf:64-77`；`docs/deployment/README.md:160-179`；`nginxWebConf.test.ts:117-148`（含 compose healthcheck pin） |
| healthcheck | 探测改为 `/healthz` | `docker-compose.yml:114,118` @ `1dd4d206` |
| 诊断收益 | error 级下 S02–S07 六类故障根因可辨识；crit 全静默 | `07-NGINX-DIAGNOSTICS-AND-PRIVACY.md` §1–§2；`raw/nginx-fault-injection/`（`runs/` 24 个运行目录） |
| 风险接受 | error 级 7 个上游/解析故障场景出现完整请求行（部分含 upstream URL 二次泄露）；warn 额外泄露 malformed 请求行 | 同上 §2–§3；`raw/nginx-fault-injection/canary-master-scan.txt` |

**本次复核执行的独立核对**（不替代 24 次故障注入）：

```bash
sha256sum raw/nginx-fault-injection/confs/web-error.conf
# 4edca523dc37dc7277486d18f78925dbfa063b5b145dca4f4ea7f7c08ddc0053
for c in 623bc4b4 a9155634 1dd4d206; do git show "$c:deploy/nginx/web.conf" | sha256sum; done
# 623bc4b4 e65cd9f9…（crit 版）
# a9155634 ff4f7518…（Decision-A 版）
# 1dd4d206 90214ace…（最终，含 80 端口配方）
diff -u raw/nginx-fault-injection/confs/web-error.conf <(git show 1dd4d206:deploy/nginx/web.conf)
# 仅两处注释块不同（约 :40-47 与 :61-77）；log_format / access_log /
# error_log / location 指令逐字节一致
```

结论：07 号文档标题中的 `623bc4b4` 是**采集时所在 commit**，`4edca523…` 是
**未提交 Decision-A worktree 快照** `raw/nginx-fault-injection/confs/web-error.conf`
本体（`SHA256SUMS:68` 亦为该路径），不是任何 commit 内的文件；最终交付
`1dd4d206:deploy/nginx/web.conf` 为 `90214ace…`，二者指令行一致、仅注释不同。
该标注已补入 07 号文档头部（本次编辑）。

**边界**

1. `INFRA_LOG_ACCESS = NOT_VERIFIED`：宿主机 Docker daemon 驱动/轮转、
   `/var/lib/docker/containers/**.log` 权限、journald、备份、第三方收集器、
   HTTPS 实际激活状态均无部署访问权 → UNKNOWN（07 §3 清单）。
2. `docker-compose.yml`（final `1dd4d206`）**仍无 `logging:` 上限**（本次
   `git show 1dd4d206:docker-compose.yml | grep logging` 无命中）；Owner 必须在
   #925/#926 收口时落地上限或书面接受 daemon 默认（ops F3，未决，见 §5）。
3. warn 级不采用：warn 不增加上游故障诊断，却新增 malformed 请求行泄露
   （07 §2）。

**可信度**：高（容器级 24 次运行 + 模板 pin 测试 + 本次 SHA/diff 复核）；
部署侧访问边界为 UNKNOWN，未虚构 VERIFIED。

## 2. Decision B — #923 接受历史数据临时残余风险

**决定（契约 §0）**：不迁移历史 `client_events.route`、不批量删除生产数据；
保留读取端安全投影；历史记录按 30 天 retention 自然清理；备份边界必须记录，
无部署访问权时标 UNKNOWN。

**落地结果**

| 项 | 落地形态 | 证据（final SHA） |
| --- | --- | --- |
| 不迁移/不批删 | 无数据迁移、无批删脚本 | `git diff --stat 5140c3dd a84b416a -- packages/db/migrations` 为空（本次执行）；`git diff --stat … apps/api/src/plugins/clientEventRetention.ts` 为空 |
| 新写入投影 | ingest 前 `projectClientEventRoute(event.route)` | `apps/api/src/routes/clientEvents.ts:118` @ `d3580f3e` |
| legacy 读取投影 | timeline 读取强制投影 | `apps/api/src/lib/proctorMonitoringService.ts:72` @ `d3580f3e` |
| client-claimed requestId 形状 gate | 仅投影 well-formed UUID string | 同上 `:202-231`（`REQUEST_ID_UUID_SHAPE`、`key === "requestId"` 分支） |
| 30 天 executor | `CLIENT_EVENT_RETENTION_DAYS = 30`；24h sweep；启动即 `runPass()`；`fastify.now()` 服务端时钟；`onClose` 等待在飞 pass | `apps/api/src/plugins/clientEventRetention.ts:33,36,103,162-205,207-217` @ `d3580f3e` |
| 契约测试 | 8/8（真实隔离 PG + 可控时钟 + trigger 故障注入 + 双连接并发 + advisory-lock shutdown） | `08-CLIENT-EVENT-RETENTION-VERIFICATION.md` §5.2/§A；review-security 实跑 8 passed |
| 历史字节 still at rest | 真实 DB 转储显示 pre-#864 原始字节仍在库 | `raw/replay-db-routestorage.txt`；`09-HISTORICAL-DATA-AND-BACKUP-BOUNDARY.md` |

**本次复核**：仅做静态核对（上表 diff/grep）。retention 8/8 与 legacy 投影
`1 passed` 为归档与独立评审的实跑记录，本次未重跑（未把“未执行”写成 PASS）。

**边界**

1. “到达可删除年龄 ≠ 已从所有介质删除”：在线层 30 天后删除；备份层保留期由
   operator 决定 → `BACKUP_RETENTION = UNKNOWN`（09）。
2. `pg_restore` 全库恢复会使 dump 时点未过期的行重新 at-rest；读取端仍投影，
   但字节仍在（09）。
3. 备份加密、dump 文件权限、离线副本、第三方收集：全部 UNKNOWN（无部署权限）。
4. 历史 at-rest 残余为 Owner 已接受风险（Decision B），文档未隐藏。

**可信度**：高（在线层真实 PG 终态断言）；备份层 UNKNOWN（诚实声明，非 PARTIAL）。

## 3. Decision C — #924 必须完成真实 SaveAnswer 消费

**决定（契约 §0）**：只提供 `postWithMeta()` 不够；必须打通
`HTTP SaveAnswer → response header → API client → TakeExamPage → failure/rejection
diagnosis → authorized server log lookup`，区分 200 业务拒绝、4xx/5xx、网络失败与
成功；不得为每个成功请求新增持久化 telemetry。

### 3.1 链路落地（final 代码）

| 环节 | 实现 | file:line @ final |
| --- | --- | --- |
| 服务器 mint | `genReqId: () => randomUUID()`；`requestIdHeader: false` | `apps/api/src/server.ts:112,114` @ `e81b76a1` |
| 响应头 | root-scope `onRequest` 钩子写 `x-request-id = request.id` | `apps/api/src/plugins/requestIdHeader.ts`（`setupRequestIdHeader`，final） |
| 200 拒绝服务端事实 | 结构化 WARN `"Answer save rejected"`，`request.log.warn` 自动携带 `reqId`；响应体 `accepted:false` 不含 requestId | `apps/api/src/routes/attempts.candidate.ts:1124-1149` @ `e81b76a1` |
| 客户端读取 | 成功路径 `meta.requestId = response.headers.get("x-request-id")` | `apps/web/src/lib/api.ts:306-338`（`:331-333`）@ `e81b76a1` |
| 客户端封装 | `postWithMeta` 复用唯一 `requestWithMeta` 核心 | `apps/web/src/lib/api.ts:426-434`；`request()` 亦委托同一核心 `:363-367` |
| 4xx/5xx 双载体 | error envelope `requestId` 为准；header 仅函数内局部变量，二者不一致记录**有界** warn `api.request_id_correlation_mismatch` | `apps/web/src/lib/api.ts:235-268` |
| 保存调用 | 唯一 `api.postWithMeta<SaveAnswerResponseDTO>`；请求体字段与 master 相同 | `apps/web/src/pages/exam/TakeExamPage.tsx:897-908` @ `a84b416a` |
| 200 拒绝分支 | 置 `saveRejection` + `saveRejectionRequestId(meta.requestId)`；遥测仅在存在时附 `requestId` | 同上 `:967-987` |
| UI 诊断编号 | 仅在有 id 时渲染 `candidateRuntime.saveRejection.requestId`（“请求编号”） | 同上 `:1585-1594` |
| 授权服务端日志查询 | 无新查询 API/UI；运维按 `reqId` 在 Pino 输出中检索同一 UUID（契约明确禁止新建查询 API/调查 UI） | `docs/contracts/observability.md:32,63-73,155-166` |
| 不新增成功遥测 | success 分支只发既有 `answer_autosave_success`（无 requestId）；无 `answer_autosave_succeeded` 持久化事实 | `TakeExamPage.tsx:915-931`；`10-INTEGRATION-CI-AND-PERFORMANCE.md` §3 `NEW_SUCCESS_TELEMETRY_WRITES = 0` |
| 不新增 requestId 表 | migrations diff 为空（本次执行） | `git diff --stat 5140c3dd a84b416a -- packages/db/migrations` → 空 |

### 3.2 六类结果语义（摘要，逐条见协议回归文档）

| Case | 语义 | final 落点 |
| --- | --- | --- |
| A 200 accepted | 更新 serverVersion / saved；不新增 requestId 持久化 | `TakeExamPage.tsx:915-931` |
| B 200 accepted:false | 保留 reason 分类；UI 显示实际响应头 id；遥测 `errorCode/clientSeq/requestId?` | `:967-987` |
| C STALE_VERSION+serverAnswer | 正常协调，应用服务器答案；零失败遥测；requestId 不参与比较 | `:934-965` |
| D 4xx/5xx | ApiError envelope requestId 为唯一消费事实；header 不一致仅有界 warn | `api.ts:235-268` |
| E transport/ACK 丢失 | `requestId = null`；不伪造；UI 无“请求编号” | `TakeExamPage.tsx:1028-1041`；`api.ts:339-359` |
| F 并发/迟到 | `scopeGenAtSchedule`/`saveStale()` 守卫生效；旧 attempt 不覆盖新状态 | `TakeExamPage.tsx:847-848,909-913,997-1005` |

### 3.3 真实浏览器证据（本次执行，2026-11-09 05:59 UTC+8）

对象：`/home/hoo/Source/exam-gap-worktrees/integration-final` @ `a84b416a`
（工作树另有 2 个**未提交**测试文件改动，见边界 B1；产品代码 = exact `a84b416a`）。

```bash
DEV_API_PORT=3520 E2E_WORKERS=1 E2E_PRT_SHOT_DIR=/tmp/m4-evidence2 \
  bash scripts/e2e/run.sh --grep "M4:" --keep-server
# → Running 1 test using 1 worker
#   ✓ M4: real 200 business rejection — the candidate reads the actual
#     response's request id from the UI, and the claim reaches the timeline (7.2s)
#   1 passed (8.0s)  EXIT=0
```

同一运行的三个证据点（同一 UUID）：

1. 考生可见 alert（`05-save-rejection-request-id.png`）：
   `请求编号：e0289b97-f55e-4ee6-8864-6472faf51116`；
2. 服务器 Pino WARN（`server-rejection-line.json`）：
   `{"level":40,…,"reqId":"e0289b97-f55e-4ee6-8864-6472faf51116",…,"reason":"CONFLICTING_PAYLOAD","msg":"Answer save rejected"}`；
3. 管理员时间线（`06-timeline-client-claimed-request-id.png`）：
   `answer_autosave_failed` 行带“客户端声明，未经服务端核验”，metadata 中同一
   `e0289b97-f55e-4ee6-8864-6472faf511…`。

即：本次运行**亲手**证明了 “HTTP SaveAnswer → 响应头 → API client → UI →
授权时间线/服务端日志同一编号”的完整消费链；不是只引用实现方报告。M4 的真实性
由 spec 的 race-free 构造保证：先为同一 `(attemptId, questionId, clientSeq=1)`
落一条不同内容的 receipt，再放行页面真实请求，`CONFLICTING_PAYLOAD` 由真实服务端
状态计算（`apps/e2e/e2e/investigation-ui-acceptance.spec.ts:949-1005` @ `a84b416a`）。

### 3.4 边界

- **B1（重要）**：`investigation-ui-acceptance.spec.ts` 的 M3 forged requestId 从
  `req-forged-prt-0001` 改为 UUID 形状的修复**只存在于 integration worktree 的
  未提交改动**（`git diff` 于 `:762`；`git log --all -S "00000000-0000-4000-8000-000000000bad"`
  为空）。原因是 #923 `d3580f3e` 的 requestId 形状 gate 会让旧 M3 断言失败——这正是
  #923 最终 head 的 GitHub E2E 红因（§5）。M4 的断言与该改动无关。
- **B2**：没有服务器日志查询 API/UI；关联由运维在授权主机日志读取中完成。浏览器
  观察到的 header 值在 DB 中仍是 **client-claimed correlation candidate**，不是身份。
- **B3**：任意改写/剥离 `x-request-id` 的中间层会使浏览器观察值偏离服务端事实；
  代码以 envelope 优先 + 有界 mismatch warn 兜底，部署侧需按 runbook 不改写该头。
- **B4**：Fastify 未到达 reply 的请求（连接中断、socket framing、框架级 bad URL）
  没有头，这是文档化边界（`requestIdHeader.ts` 注释；`docs/contracts/observability.md`）。
- **B5**：M5（transport → UNKNOWN）本次执行通过：
  `DEV_API_PORT=3510 … --grep "M5:"` → `1 passed (4.1s)`，页面只有连接异常/保存
  失败提示、无“请求编号”（`raw/saveanswer-e2e/07-…png`）。另两次尝试（3400/3460）
  因宿主端口被瞬时占用在 API 启动阶段 `EADDRINUSE`，未进入 Playwright，已在
  `raw/saveanswer-e2e/run.txt` 如实记录。

**可信度**：高（同一 UUID 三处互证，命令与产物均归档）；B1 使“最终可合并性”判定
降级，见 §5。

## 4. 本次执行命令清单（可复核）

```text
git cat-file -t <9 个给定 SHA>                     → 全部 commit
git log --oneline --graph --decorate a84b416a      → 四 PR 依序 merge 图
git branch -a --contains <各 head>                 → 分支归属
gh pr view 922/923/924/926 --json headRefOid…      → final head 与上表一致
gh pr checks 922/923/924/926                       → 见 §5（#923 E2E shard 1 fail）
sha256sum / git show <sha>:deploy/nginx/web.conf   → 见 §1
diff -u <snapshot conf> <final conf>               → 仅注释差异
git diff --stat 5140c3dd a84b416a -- <保存/领域/迁移路径> → 见 §2、§3.1
DEV_API_PORT=3520 … bash scripts/e2e/run.sh --grep "M4:" --keep-server → 1 passed
DEV_API_PORT=3510 … bash scripts/e2e/run.sh --grep "M5:" --keep-server → 1 passed
grep "Answer save rejected" /tmp/e2e-wsl-api.log   → reqId == UI 请求编号
```

## 5. 未决事项与合并就绪边界（必须随最终裁决一并阅读）

| # | 事项 | 事实 | 影响 |
| --- | --- | --- | --- |
| O1 | **#923 最终 head CI 红** | `gh pr checks 923`（本次执行）：`E2E (shard 1/2) fail`，job `128847373789` / run `42518523050`；日志显示 2 failed：`investigation-ui-acceptance.spec.ts:844`（M3 forged id 非 UUID）与 `rich-content-overflow…:568`（scroll 几何；未发现与本轮的因果通道，未归因） | 最终四 head 不是“全绿”；M3 失败是 #923 形状 gate 与既有 E2E 的**真实交互**，不是纯 flake |
| O2 | **M3 修复未提交** | UUID 形状 forged id 仅在 integration worktree 未提交；任何 commit 都不含该改动（`git log --all -S` 为空） | 按现有已提交代码合并四 PR，E2E 仍会红；收口提交必须包含该测试修复（或等价 pin） |
| O3 | **compose 日志上限未落地** | final `1dd4d206:docker-compose.yml` 无 `logging:`；ops F3 | Decision A 的“避免无限保留”隔离条件在仓库内未成立；Owner 需落地或书面接受 daemon 默认 |
| O4 | **集成组合门禁无归档原始日志** | 契约 §6 的 12 项组合门禁在证据库中没有完整原始日志；调度口述“集成门禁过 6/败 0；修复后门禁过 6/败 0”，本次无法从证据库复核其组成与输出 | `FULL_INTEGRATION_CI` 不能凭此声明 PASS（详见 10 号文档 §1） |
| O5 | **证据未入库** | s0-evidence `git status --short`：07/08/09/10、BASELINE、TASK-CONTRACT、`raw/nginx-fault-injection/`、`raw/perf-ab/`、四份 review 及本轮新增文档均未跟踪；`SHA256SUMS` 为 M，且第 292 行仍列旧名 `./10-INTEGRATION-PERFORMANCE.md` | 最终裁决前必须由收口提交入库并重生成校验和（含重命名后的 `10-INTEGRATION-CI-AND-PERFORMANCE.md` 与 `raw/saveanswer-e2e/`）；ARCH-EVID-1 |
| O6 | **备份/部署边界 UNKNOWN** | 09 号文档；07 §3 | 不得宣称历史数据风险已消除 |

## 6. 证据索引

- 决策与矩阵：`TASK-CONTRACT.md` §0/§3/§4/§5；`07-…md`、`08-…md`、`09-…md`、`10-…md`
- 浏览器链路：`raw/saveanswer-e2e/`（05/06 截图、服务器拒绝行、运行记录）
- nginx：`raw/nginx-fault-injection/`（MANIFEST、`runs/` 24 个运行目录、canary 扫描、conf 变体）
- 性能与保护指标：`raw/perf-ab/`（12 份 phase JSON、analysis.json、微基准、schema diff）
- 历史字节：`raw/replay-db-routestorage.txt`；读取端审计：08 §5.4
- 独立评审：`review-security.md`、`review-saveanswer-protocol.md`、
  `review-nginx-operations.md`、`review-architecture-performance.md`
