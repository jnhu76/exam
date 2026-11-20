# #900/#1021 容量实验研究拓扑（环境搭建交付）

冻结基线 SHA：`87510894728ee1ca20a530fc20e29fa1f51709b7`（origin/master；协议
PROTOCOL.md §0）。全部命令在 `cwd=/home/hoo/Source/exam` 下原样可执行（绝对路径）。

## 拓扑组成（实际 Nginx 入口 + host-native 应用 + 真实 PG 研究库）

```
client (curl / Playwright / 负载 driver)
  │  · 协议回放 driver：容器 exam-cap-driver（exam-cap-net 172.28.10.3，
  │    eth0 ≤200 辅助 IP 172.28.10.10..，T-DIRECT 每考生绑定独一源 IP；
  │    T-SHARED 不绑定=共享出口）——见 evidence/driver/{sources.sh,README.md}
  ▼ 入口均为同一 nginx 容器：协议 driver 直连 172.28.10.2:80（容器网内，
    Host/Origin 仍为公共 origin）；浏览器/UI 探针经 http://127.0.0.1:8080
    （appUrl，published port）
┌──────────────────────────────────────────────────────────┐
│ nginx:1.30.5-trixie 容器 exam-cap-nginx                   │
│  · conf = deploy/nginx/web.conf 的派生副本（见下），       │
│    runtime mount 到 /etc/nginx/conf.d/default.conf        │
│  · SPA 静态 = worktree apps/web/dist（只读挂载，生产同构） │
│  · 网络 exam-cap-net 172.28.10.0/24，固定 IP 172.28.10.2  │
│  · XFF 契约与生产逐字一致：X-Forwarded-For $remote_addr   │
│    （REPLACE，不 append），无 nginx 层 limit_req          │
└───────────────┬──────────────────────────────────────────┘
                │ upstream host.docker.internal:3300
                ▼ http://127.0.0.1:3300        （API 直连口，仅运维/seed 用）
┌──────────────────────────────────────────────────────────┐
│ host-native API：node apps/api/dist/server.js             │
│  · 冻结 SHA 的 `pnpm build` 产物（turbo build，非 tsx）    │
│  · APP_MODE=production（生产 limiter ON），池 max=10 不动  │
│  · REDIS_MODE=optional + redis://127.0.0.1:6379           │
│  · CAPACITY_RESEARCH=1（观测插桩）                        │
│  · TRUSTED_PROXY_CIDRS=172.28.10.0/24,127.0.0.1           │
│    （外部代理 override；127.0.0.1 为 Docker Desktop vpnkit│
│    回环跳——见下文 XFF 修正记录；产品 bundled 默认未改动） │
└───────────────┬──────────────────────────────────────────┘
                │ postgresql://…@127.0.0.1:5432/exam_550_e2e
                ▼
┌──────────────────────────────────────────────────────────┐
│ exam-dev compose（pnpm db:up 拥有；docker-compose.dev.yml）│
│  · exam-dev-db-1    postgres:18.4-bookworm @127.0.0.1:5432│
│  · exam-dev-redis-1 redis:7.4.12          @127.0.0.1:6379 │
│  · 研究库 exam_550_e2e（本拓扑唯一采样库，name-guard）     │
└──────────────────────────────────────────────────────────┘
```

nginx 派生 conf：`harness/nginx/capacity-web.conf` —— 与 `deploy/nginx/web.conf`
的唯一差异是 upstream `app:3000` → `host.docker.internal:3300`（生效块一处 +
注释模板一处；XFF 覆盖、隐私 log_format、SPA fallback、Docker DNS resolver
逐字保留）。验证命令：

```bash
diff <(grep -v '^#' /home/hoo/Source/exam/.wt-capacity/deploy/nginx/web.conf) \
     <(grep -v '^#' /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/nginx/capacity-web.conf)
# 实测输出：39c39 upstream 一处差异（app:3000 -> host.docker.internal:3300）
# + 1a2 一行空行（provenance header 接缝）；其余逐字一致
```

## 启动 / 停止 / 重置 / 状态（任意 cwd；含 cwd=/home/hoo/Source/exam）

```bash
TOPO=/home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/topology.sh

bash $TOPO up        # 幂等启动：db:up → 重建研究库 → 起 API → 播种 → nginx → 健康检查
bash $TOPO down      # 停 nginx 容器 + API（dev compose PG/Redis 与研究库保留）
bash $TOPO reset     # down + up（完整重建：库 DROP/CREATE → migrate → seed → 新 JWT secret → 重播种）
bash $TOPO status    # 各组件状态 + 研究库内容计数
```

`up` 前置条件：worktree 构建产物存在。构建（冻结 SHA，按仓库 scripts）：

```bash
pnpm -C /home/hoo/Source/exam/.wt-capacity build   # root package.json "build" = turbo build
```

健康检查（up 内置，亦可单独跑）：

```bash
curl -fsS http://127.0.0.1:3300/api/health     # API 直连
curl -fsS http://127.0.0.1:8080/healthz        # 经 nginx（SPA fallback 200）
curl -fsS http://127.0.0.1:8080/api/health     # 经 nginx → API
curl -fsS http://127.0.0.1:8080/               # 经 nginx 的 SPA index.html
```

实测（2026-11-19，reset 全链 exit 0）：四项全 OK；`appUrl=http://127.0.0.1:8080`。

复验（2026-11-20 03:47 CST，cwd=/home/hoo/Source/exam）：`pnpm -C .wt-capacity build`
（turbo 9/9，FULL TURBO）→ `topology.sh up` 全链 exit 0（重建 exam_550_e2e →
API pid 2232454 → 播种 → nginx → 四项健康检查 OK）；DB 实测 405 users /
11 exams / 24 questions、exam_admissions=0、exam_attempts=0（干净世代）；
合成考生 `cap9same-c0000-de2c5a` 经 nginx `POST /api/auth/login` HTTP 200
（~95ms，role=Candidate）。本世代合成口令常量 =
`harness/lib/config.ts:64 CANDIDATE_PASSWORD`（区别于 #550 lib 的
`pass-550-cap`，用错口令会得到 401 invalid_password——API 日志
security.authentication 可复核）。

## 数据库身份与安全前置（AGENTS.md §6 四步 + testing.md §2.8）

1. **生命周期所有者**：研究 harness（`evidence/fixtures/seed-capacity.ts` +
   `harness/lib/db.ts`，复用 #550 的 name-guard + DROP/CREATE/migrate/seed
   生命周期）。dev compose（PG/Redis）属 `pnpm db:up`（testing.md §2.8 表：
   PostgreSQL server (local) | developer）。
2. **进程实际连接的库**（不凭 .env 猜测，实测输出）：
   ```bash
   docker exec exam-dev-db-1 psql -U exam -d exam -c "SELECT current_database(), version();"
   # exam | PostgreSQL 18.4 (Debian 18.4-1.pgdg12+1) … 127.0.0.1:5432
   ```
   API 进程 env `DATABASE_URL=postgres://exam:exam@127.0.0.1:5432/exam_550_e2e`
   （127.0.0.1:5432 → 容器 exam-dev-db-1 的 host 端口映射，docker ps 证实）。
   seed 脚本运行时亦以 `SELECT current_database()` 打印实际连接库
   （`[seed] rebuilt exam_550_e2e …` / `[seed] data phase connected to exam_550_e2e`）。
3. **名称守卫与测试库证明**：唯一采样库名 `exam_550_e2e` —— 前缀 `exam_550`
   （`harness/lib/db.ts` assertRunDb 拒绝其他前缀）+ 名称含 `e2e`（满足仓库
   test-branch name guard，databaseUrl.ts test|e2e|ci）。它只存在于 exam-dev
   容器上、由研究 harness 创建（`SELECT datname FROM pg_database` 实测清单中
   可见），与开发库 `exam`（同容器 POSTGRES_DB initdb）物理同名不同库、互不
   触达；开发库从未被本拓扑读写。
4. **重置语义**：每 run 之间按协议 R1 loud `DROP DATABASE … WITH (FORCE)` →
   `CREATE` → `migratePostgres` → canonical seed（seed 脚本 `--phase=db` 内置）。

## 播种（合成数据，可重跑）

```bash
# 拓扑内自动执行；独立重跑（--phase=data 需 API 已在 3300 监听）：
pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
  /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/fixtures/seed-capacity.ts --phase=db
# API 起动后：
pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
  /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/fixtures/seed-capacity.ts --phase=data
```

- `--phase=db`：name-guard 内重建库 + 生产迁移 + canonical seed（org/admin）。
- `--phase=data`：course/题目/考试/publish/proctor 走 canonical admin HTTP API
  （领域 command），合成考生走 DB 批量直插（非测量路径）。
- 规模（协议 §2.3 fixture）：同场组 1 场 × 200 合成考生；跨场组 10 场 × 20
  （同 course、同 12 题 true_false、同评分配比）；1 admin（canonical seed）+
  2 proctor。manifest：`evidence/fixtures/seed-manifest.json`（无凭据：合成
  密码为 config 常量，哈希只记算法 argon2id m=65536/t=3/p=4）。

## XFF / request.ip 基线观察（G1.3 as-built 修正版）

初版记载（"客户端源 IP 穿透两层到达审计"）在 G1.3 双侧核对中被推翻，实测与修正如下：

1. **as-built 缺陷**：本环境为 Docker Desktop（`host.docker.internal=192.168.65.254`，
   vpnkit）。nginx→API 一跳在 API 侧 socket 对端是 `127.0.0.1`（api.log
   remoteAddress 实测），不在原 `TRUSTED_PROXY_CIDRS=172.28.10.0/24` 内 →
   Fastify 不采信 XFF，**所有经 nginx 客户端的 request.ip 坍缩为 127.0.0.1**
   （G1.1 审计 ip=127.0.0.1 的真实成因；登录 limiter 同 key 共享）。宿主机经
   published port 127.0.0.1:8080 的连接在 nginx 侧 `$remote_addr` 一律为
   172.28.10.1（vpnkit SNAT），127.0.0.k loopback 绑定不可穿透。
2. **修正**（topology.sh，研究拓扑 override）：`TRUSTED_PROXY_CIDRS=$NET_SUBNET,127.0.0.1`
   —— vpnkit 回环跳列为受信代理后，Fastify 采信 nginx 以 `$remote_addr` 覆盖
   写入的 XFF。修正后 T-DIRECT（driver 容器辅助 IP，见 evidence/driver/）双侧
   观测逐一相同：nginx `$remote_addr`=172.28.10.1k ↔ audit `ip_address`=172.28.10.1k
   （evidence/driver/runs/G1-IP-DIRECT-sanity + G1-PILOT-full-direct-P2-S24-r4/oracle.json
   distinctIPs=24）。
3. `api-restart` 子命令：仅重启 API（保库保播种世代），用于应用 env 修正。

## 与理想拓扑的差异说明

- 三要素（实际 Nginx / host-native 应用 / 真实 PG 测试库）全部满足，无降级。
- 入口绑定 `127.0.0.1:8080` 而非生产 `:80`：避免与本机 80 冲突的研究端口
  选择（`CAPACITY_NGINX_PORT` 可改），nginx 行为本身与生产 conf 逐字一致。
- nginx 以 runtime-mount conf 而非 baked image 运行：web.conf 自身文档认可的
  覆盖机制（"activating … mounts … an overriding conf (runtime mount)"）。
- `TRUSTED_PROXY_CIDRS=172.28.10.0/24,127.0.0.1` 为外部代理拓扑 override
  （compose 注释认可该 override 的适用条件；127.0.0.1 一项是 Docker Desktop
  vpnkit 环境的必要补充，见上文 XFF 修正记录）；产品默认未动。
- 本环境为 Docker Desktop（WSL2）：T-DIRECT 的每考生独立源 IP 由 driver 容器
  的辅助 IP 提供（真实内核 socket 对端），无法用宿主 loopback 绑定实现
  （vpnkit SNAT 坍缩，实测）；协议 driver 与 SUT 的网络路径经容器网桥，
  同刻突发发射存在 ~1 op/ms 的平台序列化上限（evidence/driver/README.md §5）。
- WSL2 单机、driver 与 SUT 同机：协议 §1 已注明的拓扑边界，不因本文件改变。
