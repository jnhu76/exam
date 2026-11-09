# ops F1+F2 fix verification — HTTPS 激活 80 端口处置（#926 复审用）

- 触发：四路独立评审 ops F1+F2（P2 FIX_NOW）——Mode B 激活配方无 80 端口处置
  + 裸 server-level `return 301` 指引与 compose healthcheck 冲突。
- 环境：与 FIJ 主矩阵相同（nginx:1.30.5-alpine3.24，一次性容器+网络，已清理）；
  自签证书（私钥未归档）。
- `web-https-301.conf`：新配方激活形态（443 模板解除注释 + 80 端口
  `location = /healthz { return 200; }` + `location / { return 301 …; }`，
  /api 反代与 SPA location 移除）。
- `web-https-old301.conf`：旧裸 server-level 301 形态（P3 见证用）。
- 结果（new301-curl.txt / old301-curl.txt）：
  - 新配方：/healthz→200；/→301→https；/api/ok→301；https /→200；
    容器内 `wget -q -O /dev/null http://127.0.0.1:80/healthz` exit=0。
  - 旧裸 301：/healthz→301；同一 wget exit=1（自签证书校验失败）
    ——即激活后 false-unhealthy 的实证。
  - 基础 HTTP-only conf（默认部署路径）：/healthz 经 SPA fallback→200，
    compose healthcheck 一行改动在默认形态同样可用。
