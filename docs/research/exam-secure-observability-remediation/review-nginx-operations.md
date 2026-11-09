# 独立评审 C — Linux/Nginx/Ops Reliability（TASK-CONTRACT §7.1 Subagent C）

- 评审角色：Linux/Nginx/Ops Reliability（契约 §7.1-C）
- 评审日期：2026-11-09（UTC+8）；执行窗口内全部命令为本评审实际运行
- 评审独立性：未参考其他三路评审结论；仅使用契约冻结输入与本评审自建复现

## Reviewed SHA

- 集成 HEAD（实际验证）：`5d4b2773cf62f93e40fa5661e0d5e19700f40b17`
  （`git -C /home/hoo/Source/exam-gap-worktrees/integration-final rev-parse HEAD`；
  任务书中的 HEAD 字串有乱码，以本 SHA 为准。）
- 冻结 master 基线：`5140c3dd0f9dbde1bdad8f5b757161f3ed96945d`
  （组合 diff 45 个非文档文件，+4456/−91；docs/research 证据归档另计。）
- FIJ 证据受测对象：`confs/web-error.conf`（sha256 前缀 `4edca523`）来自
  pr-log-privacy @ `623bc4b4`（含未提交 Decision-A diff）。与集成 HEAD 的
  `deploy/nginx/web.conf` 逐行 diff **仅注释块（43–47 行）不同，全部指令行逐字节一致**
  （本评审实际 diff 验证）。本评审另在集成 HEAD conf 上独立复现关键场景，闭合该链路。

## Reviewed files

生产代码与配置：
`deploy/nginx/web.conf`（全文件）、`Dockerfile`（web-runner stage）、
`docker-compose.yml`（web/db 服务、logging、healthcheck）、
`apps/api/src/nginxWebConf.test.ts`、`apps/api/src/plugins/clientEventRetention.ts`、
`apps/api/src/plugins/clientEventRetention.contract.test.ts`（用例与并发/停机断言细读）、
`apps/api/src/lib/logRedaction.ts`（req 序列化器，可诊断性相关）、
`docs/deployment/README.md`（Mode A/B、TRUSTED_PROXY）、
`docs/operations/README.md`（新增 nginx 日志处置指引，本 diff +16 行）。

证据库（s0-evidence/docs/research/exam-secure-observability-remediation/）：
`07-NGINX-DIAGNOSTICS-AND-PRIVACY.md`、`08-CLIENT-EVENT-RETENTION-VERIFICATION.md`、
`09-HISTORICAL-DATA-AND-BACKUP-BOUNDARY.md`、`10-INTEGRATION-CI-AND-PERFORMANCE.md`、
`00-BASELINE.md`、`raw/nginx-fault-injection/`（MANIFEST、canary-master-scan.txt、
confs/ 五变体、runs/ 22 次运行原始日志；抽查 s01/s02/s09/s12、lvl-s09-w）。

## 本评审实际执行的检查（全部为本轮真实运行）

| # | 检查 | 命令（在 integration-final） | 结果 |
| --- | --- | --- | --- |
| 1 | conf 漂移 pin 测试 | `apps/api$ pnpm exec vitest run src/nginxWebConf.test.ts` | 5 passed |
| 2 | retention 契约（真实 PG 18.4，vitest globalSetup 自供隔离 schema） | `apps/api$ pnpm exec vitest run src/plugins/clientEventRetention.contract.test.ts` | 8 passed |
| 3 | 集成 HEAD conf 语法 | `docker run --rm -v …/web.conf:/etc/nginx/conf.d/default.conf:ro nginx:1.30.5-alpine3.24 nginx -t` | test successful |
| 4 | FIJ conf vs HEAD conf | `diff confs/web-error.conf …/integration-final/deploy/nginx/web.conf` | 仅注释差异（43–47 行） |
| 5 | compose 日志上限 | `grep -n "logging\|max-size\|max-file\|log-driver" docker-compose.yml docker-compose.dev.yml` | 零命中（无 logging 配置） |
| 6 | 一次性容器复现（隔离网络 `opsrev-net`，nginx:1.30.5-alpine3.24 + node 替身上游挂 `--network-alias app`，用后已全删） | 见 §Threat coverage 各场景 | 见下 |
| 7 | 应用侧日志暴露面 | `grep -rn "var/log/nginx\|docker logs" apps/api/src apps/web/src` | 零命中（无应用侧暴露通路） |

一次性容器复现与 FIJ 的关键差异：FIJ 将宿主目录 bind-mount 到
`/var/log/nginx` 直读文件（MANIFEST 自述"非 symlink 重定向"），**遮蔽了生产镜像的
stock symlink**。本评审不 bind-mount 该路径，直接经 `docker logs` 验证生产落点
（`ls -la /var/log/nginx` 确认 `access.log -> /dev/stdout`、`error.log -> /dev/stderr`）。

## Threat / invariant coverage（含 §7.3 对抗性覆盖）

- **正常路径** ✅：容器内 `GET /api/ok?token=OPSREV-CANARY-N3` → 200（0.007s）；
  `docker logs` access 行 `"GET /api" 200 … up=200/0.004 reqid=4f8a576b-…`，
  reqid 与替身上游盖的 `X-Request-Id` 响应头一致；canary 在 stdout/stderr 合流中
  **0 命中**。SPA 深链（`/exam/123?token=…`）→ access 仅记 `GET /spa`。
  retention 侧正常路径：T1/T2（29d 保留、空清理）随检查 #2 全绿。
- **错误路径** ✅：删除上游容器后 `GET /api/…?token=OPSREV-CANARY-E1` → 502（4.002s，
  嵌入式 DNS SERVFAIL 与 FIJ S02 同形）；error 流出现
  `app could not be resolved (2: Server failure) … request: "GET /api/attempts/1/answers/2?token=OPSREV-CANARY-E1 HTTP/1.1"`
  ——**根因可辨识且含完整请求行**，access 行 `up=-/-` 无 canary。这同时确认
  Decision-A 接受的原始 URL 泄露确实经生产 symlink 路径进入 `docker logs` 持久层。
- **并发/生命周期边界** ✅：retention 契约 T6（两条物理连接，4 writer × 3 cleaner
  并发，Promise.all 任一拒绝即失败；fresh 20 行全保留、expired 收敛为 0）与 T7
  （advisory-lock 门控在飞 sweep，`app.close()` 等待后收敛）——本评审实跑 8/8 通过，
  并细读断言确认非 sleep 型（`waitFor(activeSince !== null)` 确定性在飞证明）。nginx
  生命周期：resolver 请求时解析 + `valid=10s`（web.conf:6-12 INVARIANT）在复现中
  行为一致（上游容器消失 → 请求时 SERVFAIL，非陈旧 IP）。
- **跨权限边界** ✅：error log 唯一读取通路是容器 stderr → docker json 日志 →
  宿主 root/docker 组（应用 RBAC 不覆盖，doc 07 §3 已如实列为 UNKNOWN）；
  应用/前端零暴露通路（检查 #7）；docs/operations/README.md:125-138（本 diff 新增）
  给出读取主体限制、轮转、脱敏共享三条处置。契约要求的
  `INFRA_LOG_ACCESS = NOT_VERIFIED` 判定诚实（部署侧 daemon 驱动/宿主权限确实未验证）。
- **现有测试未覆盖的反例** ✅（→ F1/F2）：`nginxWebConf.test.ts` 只 pin 配置文本；
  FIJ S12 只测了"443 解注释、80 原样服务"形态。**无任何测试覆盖 web.conf:67-68
  自带的 HTTPS 指引（80 端口改 `return 301`）与 compose healthcheck
  （`wget http://127.0.0.1:80/`）的相互作用**——本评审构造该形态实测击穿（见 F1）。

error/warn 选择依据复核（Decision A 边界内）：FIJ crit/error/warn 三级对比
（runs/lvl-*）+ canary-master-scan（22 次：access 恒 0；error 级 7 个上游/解析
故障场景 error log 命中；crit 全静默；warn 级 S09 额外命中）结论自洽。本评审在
集成 HEAD 独立复现 warn 增量泄露：`[warn] using uninitialized "exam_route" variable
… request: "GET /api/badp?token=OPSREV-CANARY-W1 HTTP/1.1"`——warn 相对 error 无
上游故障诊断增益（S02–S05 warn 行与 error 行同消息，实测 lvl-s02-w…s05-w）却新增
malformed 请求行泄露面。维持 `error` 的裁决**依据充分**，不需要退 crit，也不应升 warn。

30 天 retention 收敛（契约 §5.2/§5.3）：插件实现核对（启动补偿 pass、24h unref
interval、in-flight guard、onClose await、per-org 隔离与失败日志、
consecutiveFailedTicks 升级信号，clientEventRetention.ts:158-218）与 doc 08 的
设计事实表逐条吻合；"可删除年龄 ≠ 已从所有介质删除"边界（最坏删除延迟 ≈ 一个
sweep 间隔；停机 = 停机时长 + 启动 pass）如实刻画。契约测试 8/8 在集成 HEAD 实跑通过。

备份残余风险（契约 §5.5/Decision B）：doc 09 枚举真实存在的唯一备份机制
（`scripts/db-backup.sh` pg_dump -Fc；runbook §17），保留期/加密/权限全部 UNKNOWN
（无部署访问权），恢复后 legacy 行重新 at-rest 并由 30 天机制重新老化——未虚报
`BACKUP_RETENTION = UNKNOWN`。本评审无部署访问权，无法进一步验证，维持 UNKNOWN。

可诊断性：edge 侧 access 字段可区分上游源错误（up=502）与边缘源错误（up=-/-，实测）；
error 级消息可辨根因（resolver errno / connect() / timed out，FIJ S02–S05 + 本评审
E1）；app 侧 pino req 序列化器保住 method + 路由模板 + remote 地址/端口
（logRedaction.ts:196-223），与 reqid 关联链（nginx reqid=$sent_http_x_request_id）
贯通（本评审 N3 reqid 头-日志一致）。已知静默面：malformed URI 与客户端提前断开在
error 级零输出（doc 07 矩阵第 9/10 行如实标 ❌，Decision A 内接受；本评审复现 S09
同形：400 + access `"- "` 占位 + error 零行）。

## Concrete findings

### F1 — 遵循 web.conf 自带的 HTTPS 重定向指引会击穿 compose healthcheck（P3，CONFIRMED）

- 位置：`deploy/nginx/web.conf:67-68`（"With HTTPS enabled, replace this server's
  routing with: `return 301 https://$host$request_uri;`"）× `docker-compose.yml:114`
  （healthcheck `wget -q -O /dev/null http://127.0.0.1:80/`）。
- 问题：按 conf 注释把 80 端口整段替换为 301 后，busybox wget 跟随重定向到
  `https://127.0.0.1/` 并做证书校验（nginx:1.30.5-alpine 的 wget 经 ssl_client 校验），
  自签/异名证书必败 → healthcheck 永久 unhealthy。
- Reproduction（本评审一次性容器 opsrev-web2，HEAD conf 443 解注释 + 80 端口加
  `return 301` + 自签 CN=127.0.0.1 证书）：
  - `curl http://127.0.0.1:18444/` → `301 -> https://127.0.0.1/`；`curl -sk https://…:18443/` → 200（服务本身正常）；
  - 容器内执行 compose healthcheck 原命令 → `certificate verify failed … wget exit=1`。
- 影响边界：plain compose 不会自动重启 unhealthy 容器（restart 策略只响应退出码），
  且无任何服务 `depends_on: web: service_healthy`（grep 验证：仅 app→db、web→app）。
  故非流量中断，而是**健康信号永久误报**——事故时把"HTTPS 正常"显示为 unhealthy，
  误导排障与监控门控。
- Proposed minimal fix：在 web.conf 注释与 443 模板中加入 health 豁免定位
  （如 `location = /healthz { return 200; }` 置于 301 之前），并把 compose
  healthcheck 指向 `/healthz`（或注释明示激活 HTTPS 时必须同步调整 healthcheck）；
  `nginxWebConf.test.ts` 的模板 pin 可顺带钉住该豁免块。

### F2 — Mode B（HTTPS）激活配方使 80 端口继续全量明文服务，配置一致性缺口（P2，CONFIRMED）

- 位置：`docs/deployment/README.md:160-171`（激活 = 443 解注释 + 挂载覆写 conf +
  发布 443，**未提 80 端口处置**）× `deploy/nginx/web.conf:54-103`（80 server 原样
  服务 SPA 与 /api 反代）。
- 问题：FIJ S12（`raw/nginx-fault-injection/runs/s12-https/`：`http / -> 200`）实测的
  正是 README 配方形态——操作者按文档激活 HTTPS 后，同一 ingress 仍以明文 HTTP
  全量提供 SPA 与 API。Mode B 的传输保密意图（README:157-159 自述 HTTP 下凭据/答案
  可被窃听）被静默架空；Secure cookie/HSTS 钥匙在 https origin 上不阻止攻击者直接
  用 `http://host` 访问。该 README 段为冻结 master 既有内容（不在本 diff 内），但
  本轮恰是验证 HTTPS 激活形态的一轮，未覆盖/未修正 80 端口处置，故在本角色范围内上报。
- Reproduction：S12 原始证据 + 本评审 F1 复现容器的对照组（未加 301 的 80 server
  返回 200）。标 CONFIRMED：明文服务行为有实测证据；"操作者会照 README 激活而不另做
  80 端口处置"为文档结构事实（配方无该步骤）。
- Proposed minimal fix：README Mode B 补一步 80 端口处置清单：要么加 301 重定向
  （含 F1 的 health 豁免），要么在网络层封堵 80；web.conf 的 HTTPS 注释同步指向
  该清单。纯文档 + 模板注释改动。

### F3 — 生产 compose 无任何日志上限，Decision A 的"避免无限保留"隔离条件在仓库内未落地（P2，CONFIRMED-缺失）

- 位置：`docker-compose.yml:101-121`（web 服务无 `logging:`；全文件 grep
  `logging|max-size|max-file|log-driver` 零命中，dev compose 同）；新增的
  `docs/operations/README.md:133` 自己承认 "the bundled compose file does not cap
  log growth by itself"。
- 问题：error 级恢复后，上游持续故障期间每个失败请求产出一条含完整请求行的
  error 行——doc 10 实测 264.7 B/req（connection refused ×100）/187.9 B/req（DNS
  失败 ×100）（该数字为交付方测量，本评审未复测；量级与本评审观测的单行长度一致）。
  无轮转上限意味着：磁盘增长风险（长时段故障 + 高 QPS 场景）与已接受风险的原始
  URL 留存时长均无仓库内边界，只依赖宿主 daemon 默认。契约 §4.3 仅要求"给出最小
  部署建议"（已给：doc 07 §5、ops README），故非契约违约；但 compose 是本仓生产
  拓扑唯一权威，建议落地而非仅靠 README。
- Reproduction：检查 #5（grep 零命中）+ doc 10 §"nginx error log"行 +
  `docs/operations/README.md:133` 原文。标 CONFIRMED（缺失与自认均为仓库文本事实）。
- Proposed minimal fix：`docker-compose.yml` 为 `web`（并顺带 `app`）加
  `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }`
  （具体数值 Owner 定；属部署 payload 契约范围，建议在 #925 收口时决定，或由 Owner
  明确记录"接受 daemon 默认"的风险决定）。

### F4 — malformed URI 在 error 级完全静默（P3，CONFIRMED，Decision A 内已接受的取舍，无需修复）

- 位置：`deploy/nginx/web.conf:65`（error 级）× FIJ S09 + doc 07 矩阵第 9 行。
- Reproduction（本评审，HEAD conf，经 docker logs）：原始 `\x01` 请求行 →
  400，access 仅 `"- " 400 … reqid=-`，error 级零行；warn 变体则泄露
  `using uninitialized "exam_route" … request: "GET /api/badp?token=OPSREV-CANARY-W1…"`
  （本评审独立复现，与 FIJ lvl-s09-w 一致）。
- 结论：`error` 级下该类请求仅剩 400 + 空占位可辨，无根因细节——这是 Decision A
  权衡的已知代价（warn 的"诊断增益"只有这条会泄露请求行的警告，不值）。doc 07 已
  如实记录。**不要求改动**；记录在案以证明该静默面经过正反两面验证，非遗漏。

（证据链备注，非缺陷：FIJ 受测 conf 为 pr-log-privacy 未提交态 sha `4edca523…`，
与集成 HEAD conf 仅注释差异——指令逐字节一致，且本评审已在 HEAD conf 上独立复现
核心场景，证据链闭合。）

## Remaining uncertainty

1. 部署侧事实（doc 07 §3 清单）：宿主 daemon 日志驱动与轮转参数、journald 接管、
   `/var/lib/docker/containers/**.log` 权限与读取主体、备份是否涵盖容器日志、第三方
   收集器、真实部署是否激活 HTTPS——本环境无部署访问权，全部维持 UNKNOWN；
   `INFRA_LOG_ACCESS = NOT_VERIFIED` 判定成立且未虚报。
2. 备份层（doc 09）：dump 保留期/加密/权限 UNKNOWN；本评审无部署权限，未验证。
3. doc 10 的 error log 字节体积数字为交付方测量，本评审未独立复测（量级与观测吻合）。
4. 真实 Fastify 上游下的 reqid 贯通由替身上游验证（与 FIJ 同样限制）；真实 app 链路
   归 SaveAnswer/架构评审角色，本评审未重复。
5. S07 的瞬态 NXDOMAIN `(3: Host not found)` 一次观察到未复现（doc 07 已如实标注，
   原始文件被重跑覆盖仅存会话记录）——接受该记录方式。

## Verdict

**OPS_REVIEW = CONDITIONAL**

核心交付在本评审范围内成立：access log 隐私（22 次 FIJ + 本评审复现 canary 0 命中）、
error 级诊断价值与 crit 弃用依据（复现确认）、warn 不升级的依据（warn 增量泄露独立
复现）、30 天 retention 在集成 HEAD 真实 PG 8/8 收敛、备份/部署边界诚实标 UNKNOWN、
生产 symlink → docker logs 落点验证（FIJ 遗留的遮蔽缺口已由本评审闭合）。

条件（均为小改动，不阻塞四个 PR 的代码内容）：

1. F2/F1：Mode B HTTPS 激活配方必须补 80 端口处置（301 + health 豁免，或网络层
   封堵），否则"已配置 HTTPS"的部署持续双协议全量服务——文档级修复即可满足；
2. F3：Owner 在 #925/#926 收口时对 compose 日志上限做出显式决定（落地 `logging:`
   上限，或书面接受 daemon 默认并记录理由）——这是 Decision A"避免无限保留错误
   日志"隔离条件的落地形式。

未发现 P0/P1。F4 为已接受取舍的复核记录，无需行动。

---

## 编纂补记（2026-11-09；评审正文未改动）

- **运行环境（宿主实测）**：WSL2 Linux 6.18.54.1-microsoft-standard-WSL2；Node
  v24.22.1；pnpm 11.1.2；PostgreSQL 18.4；nginx 1.30.5-alpine3.24（容器）。
- **SHA 追溯**：评审对象是 `5d4b2773`（其 #926 成分 `a9155634`）。条件 (1)
  F1/F2 已由 `1dd4d206` 修复（80 端口 `location = /healthz` + 301、compose
  healthcheck 指向 `/healthz`、README Mode B 说明、模板 pin 测试）；条件 (2)
  F3（compose `logging:` 上限）**未落地**，最终 `1dd4d206:docker-compose.yml`
  仍无 `logging:`，须 Owner 书面决定。最终集成 `a84b416a`；本评审结论未在
  最终 SHA 重跑，但上述修复点在最终 head 已逐项核对。
- **结论可信度**：高——关键检查为容器/真实 PG 实跑；部署侧事实（daemon 驱动、
  轮转、权限、备份、HTTPS 实际激活）维持 UNKNOWN，未虚报 VERIFIED。
