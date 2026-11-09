# #926 — nginx 原生诊断恢复：故障注入矩阵、风险模型与拆分裁决

- 对应：TASK-CONTRACT §4（Owner Decision A）、§4.2 十二场景矩阵、§4.3 风险模型、§4.4 拆分结论。
- 受测对象：PR #926 分支 worktree @ `623bc4b470eee6a31b390ba3f84e6dcaff8ab064`
  **的未提交 Decision-A 工作树状态**（该 commit 内仍是 `error_log … crit;`，
  `git show 623bc4b4:deploy/nginx/web.conf` 实测）。受测快照归档为
  `raw/nginx-fault-injection/confs/web-error.conf`，sha256
  `4edca523dc37dc7277486d18f78925dbfa063b5b145dca4f4ea7f7c08ddc0053`
  （= `SHA256SUMS:68`；`git show 623bc4b4:deploy/nginx/web.conf | sha256sum`
  为 `e65cd9f9…`，不等于该值）。最终交付
  `1dd4d206:deploy/nginx/web.conf` 为 `90214ace…`；受测快照与最终交付的差异
  **仅两处注释块**，`log_format` / `access_log` / `error_log` / `location`
  指令逐字节一致（复核见 §7）。
- 执行环境与原始证据：[`raw/nginx-fault-injection/`](raw/nginx-fault-injection/)
  （含 MANIFEST、`runs/` 24 个运行目录的全部 access/error 日志、级别变体 diff、
  canary 总扫描）。
- 结论可信度：容器级实证（真实 nginx 1.30.5 + Docker 嵌入式 DNS），非生产环境；
  部署边界项见 §4 UNKNOWN 清单。

## 七要素（本文自证）

| 要素 | 值 |
| --- | --- |
| 真实代码 SHA | 受测快照 = #926 worktree @ `623bc4b4…` 的未提交 Decision-A 状态（sha256 `4edca523…`）；最终交付 `1dd4d2067fd81143268aaeea56d2e35ef715a6f3:deploy/nginx/web.conf`（`90214ace…`）；最终集成 `a84b416a…`；master `5140c3dd…` |
| 运行环境 | 容器内 nginx 1.30.5-alpine3.24 + Docker 29.7.2 嵌入式 DNS（`raw/nginx-fault-injection/MANIFEST.md`）；宿主 WSL2 Linux 6.18.54.1 |
| 执行命令 | FIJ 驱动脚本 `raw/nginx-fault-injection/run-web.sh`、`cap.sh`（`runs/` 24 个运行目录）；本次复核命令见 §7 |
| 关键测试结果 | §1 十二场景矩阵；§2 crit/error/warn 对比；canary：access 0、error 级 7 场景泄露、crit 0、warn 额外 S09 泄露（§7 复核计数） |
| 原始证据路径 | `raw/nginx-fault-injection/`（MANIFEST、`runs/`、`confs/`、`canary-master-scan.txt`、`conf-variant-diffs.txt`） |
| 已知边界 | 部署侧 daemon 驱动/轮转/权限/journald/备份/收集器/HTTPS 实际激活 = UNKNOWN（§3）；容器实验非生产拓扑 |
| 结论可信度 | 高（容器级 24 次运行 + 本次 SHA/diff/canary 复核）；部署边界 UNKNOWN |

## 1. §4.2 十二场景矩阵（error 级，生产 conf）

每场景字段：现象（HTTP status / duration）→ access log 摘要 → error log 摘要 →
reqid → 敏感 URL 出现 → 根因可辨识度。原始行见 `raw/nginx-fault-injection/runs/`。

| # | 场景 | HTTP / 耗时 | access log（exam_privacy） | error log（error 级，非 notice） | reqid | 敏感 URL | 根因可辨识 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 上游正常 | 200 / 19.9ms | `GET /api 200 … up=200/0.012` | 无（仅启动 notice 横幅） | =stand-in UUID | 无 | 无故障 |
| 2 | 上游容器 stop | 502 / 4.00s | `up=-/-` | `app could not be resolved (2: Server failure)` + 完整请求行 | - | **error log 请求行含 canary** | ✅ 消息指名 `app` 与 resolver 错误码 |
| 3 | Connection refused | 502 / 2.5ms | `up=502/0.000` | `connect() failed (111: Connection refused) while connecting to upstream` + 请求行 + `upstream: "http://IP:3000/…?canary"` | - | **error log 两处含 canary**（请求行 + upstream URL） | ✅ |
| 4 | 上游超时（默认 proxy_read_timeout 60s） | 504 / 60.00s | `up=504/60.006` | `upstream timed out (110: Operation timed out) while reading response header` + 请求行 + upstream URL | - | **error log 两处含 canary** | ✅ |
| 5 | 上游提前关闭连接 | 502 / 5–6ms | `up=502/0.002` | `upstream prematurely closed connection while reading response header from upstream` + 请求行 + upstream URL | - | **error log 两处含 canary** | ✅（access 的 up=502 无法区分 3/5，error 消息可） |
| 6 | resolver 不可达（变体：resolver→10.255.255.1） | 502 / 30.00s（默认 resolver_timeout） | `up=-/-` | `app could not be resolved (110: Operation timed out)` + 请求行 | - | **error log 请求行含 canary** | ✅ |
| 7 | 不存在的 upstream host | 502 / 4.00s | `up=-/-` | `app could not be resolved (2: Server failure)` | - | **error log 请求行含 canary** | ✅（本 Docker 29.7.2 嵌入式 DNS 对不可解析名统一回 SERVFAIL；容器 stop 与别名未注册同形，见 7b；一次瞬态 NXDOMAIN `(3: Host not found)` 观察到但未复现，原始文件被重跑覆盖，仅存会话记录） |
| 8 | 上游回 502/503/504 | 502/503/504 / 2–6ms | `up=502/503/504` | **零行** | =stand-in UUID（错误响应也盖） | 无 | nginx 无错；access 的 `up=<code>` 区分上游源（up=502）与边缘源（up=-/-） |
| 9 | malformed URI（原始 \x01） | 400 | 方法占位 `"- "`、route 未定 | **零行** | - | 无（两级日志均未落 canary） | ❌ error 级静默；仅 access 400 |
| 10 | 客户端提前断开 | 499 / curl exit 28 @1s | `499 rt=1.003 up=-/1.001` | **零行** | - | 无 | ❌ error 级静默；access 499 语义可辨 |
| 11 | 静态 SPA（含深链 query secret） | 200 ×3 | `GET /spa`（三请求同占位） | 零行 | - | 无 | 无故障 |
| 12 | HTTP + HTTPS 激活形态（443 模板解除注释 + 自签证书） | 200（443 与 80 均通） | 同格式：`/spa`、`/api up=200 reqid=<uuid>` | 零行 | TLS 下同样贯通 | 无 | 隐私指令在激活形态同样生效 |

reqid 出处说明：矩阵中的 UUID 由 stand-in 上游（`upstream.mjs`，模拟 ADR-025
行为）生成，非真实 Fastify API；nginx 侧 `$sent_http_x_request_id` 的贯通与
nginx 自答请求 `reqid=-` 的语义不受影响。

## 2. crit / error / warn 级别对比（关键场景）

| 场景 | crit | error | warn |
| --- | --- | --- | --- |
| S02 解析失败 | 静默（0 行） | ✅ resolver 消息 + 请求行泄露 | 与 error 相同（消息同为 [error] 级；无新增 [warn] 行） |
| S03 refused | 静默 | ✅ 111 消息 + 两处泄露 | 与 error 相同 |
| S04 超时 | 静默 | ✅ 110 消息 + 两处泄露 | 与 error 相同 |
| S05 上游关闭 | 静默 | ✅ 消息 + 两处泄露 | 与 error 相同 |
| S09 malformed | 静默 | 静默 | **新增 `[warn] using uninitialized "exam_route" variable while logging request`，引用含 canary 的原始畸形请求行** |
| S10 客户端断开 | 静默 | 静默 | 静默（客户端断开消息在 info 级） |

裁决依据（契约 §4.2"优先 error，除非 warn 有明确必要诊断收益"）：

- **crit 在全部 6 个故障场景根因不可辨识**——Decision A 拒绝 crit 的直接经验证据；
- **warn 相对 error 零诊断增益**（上游/解析故障消息全部本来就是 [error] 级），
  却**新增一条泄露面**（uninitialized-variable 警告引用畸形原始请求行）；
- 维持 `error`。canary 命中计数见 `raw/nginx-fault-injection/canary-master-scan.txt`：
  24 次运行 access log **0 命中**；error log 命中仅出现在 error 级 7 个
  上游/解析故障场景与 warn 级 S09（crit 全零系因全静默，非脱敏）。

## 3. §4.3 风险模型（恢复原生 error log 后）

原生日志实际泄露范围（已验证）：

- error 级消息在**上游连接/解析/超时类故障**时引用两处原始 URL：客户端
  请求行（含 query）与 `upstream: "http://…"` 字段（含 query）；malformed
  请求行在 warn 级额外经 uninitialized-variable 警告泄露；
- 上游正常应答、上游源 5xx、静态 SPA、TLS 形态、客户端断开：error log 无泄露；
- access log（exam_privacy）在全部场景/级别 **0 泄露**。

谁能读 / 在哪持久化 / 保留多久（本地可验证部分）：

- 容器内 `/var/log/nginx/error.log`；生产镜像 symlink 到 stderr →
  **`docker logs`（daemon json-file 默认驱动）即持久化位置**；
- 本仓 `docker-compose.yml` **未配置 `logging:` 上限**——保留量与轮转完全
  由宿主 daemon 默认决定（本仓不可控、部署相关 → UNKNOWN）。

本地无法验证（真实施署边界，一律 UNKNOWN）：

1. 宿主 Docker daemon 的 log driver（json-file/journald/其他）与其 rotation 参数；
2. systemd/journald 是否实际接管（若 journald：journal 磁盘限额与保留策略）；
3. `/var/lib/docker/containers/**.log` 的宿主机文件权限与读取主体清单
   （本地管理员、docker 组成员；Docker 管理权限接近宿主高权限，应用 RBAC
   不能证明 OS 日志权限安全）；
4. 备份是否涵盖 docker 日志卷/宿主日志及其保留期；
5. 是否存在第三方日志收集器；
6. 真实部署是否启用 HTTPS 形态（模板已验证，实际激活状态 UNKNOWN）。

本地运维诊断收益（已验证）：S02–S07 六类故障在 error 级均可凭原生消息定位
根因（含 resolver errno、upstream 地址、阶段），crit 下全部不可辨。

## 4. §4.4 拆分结论

```text
NGINX_ACCESS_LOG_PRIVACY = PASS
  # 24 次运行 × 三级别 × HTTP/HTTPS，access log canary 命中 0
  # （raw/nginx-fault-injection/canary-master-scan.txt）
NGINX_ERROR_LOG_DIAGNOSTIC = PASS
  # error 级下 S02–S07 六类故障原生消息均可辨识根因；crit 下全部不可辨
NGINX_ERROR_LOG_RAW_URL_RISK = ACCEPTED
  # 已验证：error 级 7 场景泄露原始请求行（部分含 upstream URL 二次泄露）；
  # warn 级额外泄露 malformed 请求行。Owner Decision A 有边界接受，不与
  # access-log 隐私合并声明
INFRA_LOG_ACCESS = NOT_VERIFIED
  # 本地仅验证容器内落点与 docker logs 通路；daemon 驱动/轮转、宿主权限、
  # journald、备份、收集器均为 UNKNOWN（§3 清单）
```

## 5. 最小部署建议（不引入新日志平台，#921 NO_GO）

1. 限制 `docker logs` 与 `/var/lib/docker/containers/**.log` 的读取主体：
   仅本地管理员/排障角色；不给考生或普通考试管理员开放宿主访问；
2. 为 `web`（及 `app`）服务配置显式日志上限（compose `logging:
   driver: json-file, max-size/max-file`）或确认宿主 daemon 默认轮转，
   防止错误日志无限保留；
3. 排障材料（error log 片段、`docker logs` 导出）先脱敏（请求行 query）再共享；
4. 不将原始 error log 暴露给考生端或非管理员 UI（本产品无此通路，保持）。

## 6. 与 crit 版本的差异（#925 记录）

crit 版（623bc4b4 之前 #926 草稿）以全静默换取"canary 全零"；Decision-A
error 版在 7 个上游/解析故障场景重新出现原始请求行——这是**接受的风险**，
换来六类故障的根因可辨识。access log 隐私在两版本一致（0 泄露）。

## 7. 受测对象与最终交付的差异复核（2026-11-09 编纂）

本节的命令与输出均为编纂会话实际执行，用于消除 F1（受测对象标注歧义）。

```bash
# 1) 受测快照 = 未提交 Decision-A worktree 状态
sha256sum raw/nginx-fault-injection/confs/web-error.conf
# 4edca523dc37dc7277486d18f78925dbfa063b5b145dca4f4ea7f7c08ddc0053
grep -n "web-error.conf" SHA256SUMS
# 68:4edca523…  ./raw/nginx-fault-injection/confs/web-error.conf

# 2) commit 内的 web.conf 不是该 sha
for c in 623bc4b4 a9155634 1dd4d206; do git show "$c:deploy/nginx/web.conf" | sha256sum; done
# 623bc4b4 e65cd9f9…（crit 版：error_log … crit;）
# a9155634 ff4f7518…（Decision-A error 级）
# 1dd4d206 90214ace…（最终：Decision-A + 80 端口激活配方）

# 3) 受测快照 vs 最终交付：仅注释差异
git show 1dd4d206:deploy/nginx/web.conf > /tmp/final-web.conf
diff -u raw/nginx-fault-injection/confs/web-error.conf /tmp/final-web.conf
# 两个 hunk，均为 # 注释（:40-47 的 warn 说明、:61-77 的 80 端口配方）；
# log_format / access_log / error_log / location 指令逐字节一致。
```

canary 计数复核（`runs/` 现有 24 个运行目录、48 份 access/error 日志。MANIFEST
标题写“22 次”，但其清单明细为 13 个主矩阵（含 s07b）+ 5 个 crit + 6 个 warn = 24，
与目录计数一致；**以 24 为准**，正文相关处已同步修正）：

```bash
cd raw/nginx-fault-injection
cat runs/*/access.log | grep -c EXAMAUDIT        # → 0（全部运行/级别）
for d in runs/*/; do echo "$(basename $d) $(grep -c EXAMAUDIT "$d/error.log")"; done
# error 级主矩阵 s02…s07b：7 个上游/解析故障各 1 行（该行同时含请求行与
#   upstream URL）；s08/s09/s10/s11/s12 = 0；
# crit 变体（lvl-*-c）全部 0；warn 变体 lvl-s02…s05-w = 1（[error] 级消息），
#   lvl-s09-w = 1（uninitialized-variable 警告），lvl-s10-w = 0。
```

结论：正文矩阵与级别裁决不变；受测快照的 SHA 归属、以及“受测快照与最终交付仅
注释不同”这一事实，现已可逐命令复核。
