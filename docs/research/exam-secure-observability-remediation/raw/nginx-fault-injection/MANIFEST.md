# FIJ — nginx fault-injection raw evidence manifest

- 目的：TASK-CONTRACT §4.2 十二场景故障注入矩阵 + crit/error/warn 级别对比，
  为 Owner Decision A（error_log 恢复 `error` 级）提供经验证据；§4.3/§4.4 结论见
  上层 `../07-NGINX-DIAGNOSTICS-AND-PRIVACY.md`。
- 日期：2026-11-08（UTC 时间戳见各日志行）。

## 环境

| 项 | 值 |
| --- | --- |
| 主机 | WSL2 linux 6.18.54.1-microsoft-standard-WSL2 |
| Docker | 29.7.2, build a7dcaa6 |
| 边缘镜像 | `nginx:1.30.5-alpine3.24`（digest `nginx@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94`，容器内 `nginx/1.30.5`） |
| stand-in 上游镜像 | `node:24.22.1-bookworm-slim`（本地加载，无 RepoDigest） |
| 隔离网络 | `exam-fij`（bridge 172.19.0.0/16，一次性，已删除） |
| 受测配置 | worktree `/home/hoo/Source/exam-gap-worktrees/pr-log-privacy` @ `623bc4b470eee6a31b390ba3f84e6dcaff8ab064`（含未提交 Decision-A diff）的 `deploy/nginx/web.conf`，sha256 `4edca523…ddc0053`，与 `confs/web-error.conf` 逐字节一致 |
| 级别变体 | `confs/web-crit.conf` / `confs/web-warn.conf`：仅第 62 行 error_log 级别不同（`conf-variant-diffs.txt`）；`confs/web-resdead.conf`：仅第 12 行 resolver 改为不可路由 10.255.255.1（S06 专用变体）；`confs/web-https.conf`：README 运维路径的 443 模板解除注释形态 |
| 客户端 | 主机 curl 8.18.0 / nc（S09 原始畸形请求行） |
| stand-in 上游 | `upstream.mjs`——非真实 Fastify API；仅模拟 ADR-025 相关行为（响应头盖 X-Request-Id UUIDv4）。所有 reqid 出处标记为 STAND-IN |

## 目录

- `runs/<id>/`：`curl.txt`（状态+耗时）、`access.log`、`error.log`（bind-mount
  /var/log/nginx 直读，非 symlink 重定向）、`docker.log`（entrypoint 输出）、
  部分含 `hdr.txt`/`nc-response.txt`。
- `run-web.sh` / `cap.sh`：一次性容器编排与采集脚本。
- `canary-master-scan.txt`：全部运行 × 两日志的 canary 命中计数。
- `conf-variant-diffs.txt`：变体与生产 conf 的完整 diff。

## 运行清单（22 次）

| run | 级别 | 场景 |
| --- | --- | --- |
| s01-normal … s12-https（13 个，含 s07b） | error（s06 为 resdead 变体；s12 为 https 形态） | §4.2 矩阵 1–12 |
| lvl-s02-c/s03-c/s04-c/s05-c/s09-c | crit | 级别对比 |
| lvl-s02-w/s03-w/s04-w/s05-w/s09-w/s10-w | warn | 级别对比 |

## 合成 Canary

全部形如 `EXAMAUDIT-CANARY-FIJ-*`（每 run 唯一），无真实凭据/用户数据。
实验容器 IP（172.19.x.x）属于已销毁的一次性网络。证书为丢弃式自签
（私钥未归档；生成命令：`openssl req -x509 -newkey rsa:2048 -nodes -days 2
-subj /CN=127.0.0.1 -addext subjectAltName=IP:127.0.0.1`）。

## 清理见证

`docker rm -f fij-web fij-app fij-sleep` + `docker network rm exam-fij` 后
`docker ps -a --filter name=fij` = 0、网络 0、卷 0；harness 的
`exam-dev-db-1`/`exam-dev-redis-1` 全程未触碰（结束时仍 Up healthy）。
