# 环境冻结清单（G0）

冻结时间：2026-11-19（本文件创建时刻）。本清单只记录事实与采集命令，不含任何凭据、密码、完整哈希、cookie 或 token。

## 冻结基线

| 项 | 值 | 证据 |
| --- | --- | --- |
| origin/master 冻结 SHA | `87510894728ee1ca20a530fc20e29fa1f51709b7` | `git fetch origin && git rev-parse origin/master`（本地 master 同点，未 merge/rebase） |
| 研究分支 | `research/capacity-900-1021` | `git -C .wt-capacity branch --show-current` |
| 隔离 worktree | `/home/hoo/Source/exam/.wt-capacity` | `git worktree list`：主树 master @ 87510894 + 该 worktree @ 87510894 |
| 主工作树隔离 | `.wt-capacity/` 追加至 `.git/info/exclude`（非受控 `.gitignore`） | `tail -3 .git/info/exclude` 显示末行 `.wt-capacity/` |
| 依赖安装 | `pnpm install --frozen-lockfile`：resolved 763，reused 756，argon2 原生构建（node-gyp-build）成功，2.5s | 安装日志（2026-11-19） |
| typecheck | `pnpm -C .wt-capacity typecheck` → `Tasks: 17 successful, 17 total`（turbo 缓存命中） | 本轮实测 |

## OS / 内核 / WSL

- Ubuntu 26.04.1 LTS（VERSION_CODENAME=resolute），`/etc/os-release`
- Linux WuJie 6.18.58.1-microsoft-standard-WSL2 #1 SMP PREEMPT_DYNAMIC x86_64（WSL2）

## 硬件与有效 CPU 配额

- `nproc` = 20；CPU 型号 `12th Gen Intel(R) Core(TM) i7-12700H`（`/proc/cpuinfo` model name）
- cgroup v2 `/sys/fs/cgroup/cpu.max` = `max 100000` → 无 CPU 配额限制（不限核）
- `/sys/fs/cgroup/cpu.stat`：`nr_periods 0`（冻结时刻未观察到 throttling）

## 内存

- `free -h`：Mem total 15Gi（`/proc/meminfo` MemTotal 16244580 kB），Swap 4.0Gi；冻结时刻 available ≈ 11Gi
- cgroup v2 `/sys/fs/cgroup/memory.max` = `max` → 无 cgroup 内存限制（实际边界为 WSL2 VM 内存）

## Node / pnpm

- Node `v24.15.0`（openssl 3.5.5；经 fnm 管理）；pnpm `11.1.2`

## 关键依赖版本（pnpm-lock.yaml，冻结 SHA 下）

- argon2 `0.41.1`（声明 `^0.41.1` @ `packages/auth/package.json:42`；安装日志确认 0.41.1 原生构建）
- postgres（postgres.js）`3.4.9`（声明 `^3.4.9` @ `packages/db/package.json:149`、`apps/api/package.json:60`）
- drizzle-orm `0.45.2`（pnpm-lock.yaml:3491）
- fastify `5.8.5`（pnpm-lock.yaml:3759）

## libuv 线程池

- 环境变量 `UV_THREADPOOL_SIZE` 未设置（`env | grep -i UV_` 无输出）
- 仓库内（apps/packages/scripts/config/docker-compose*.yml）grep `UV_THREADPOOL_SIZE` 无匹配
- → 每进程 libuv 线程池为 Node 默认 **4** 线程

## 应用 PG 总连接池

- 单 Fastify 进程单池，**max = 10**（postgres.js 默认值，仓库代码未覆盖）。链路：
  - `apps/api/src/plugins/db.ts:26` — `createDatabase(database.url)`，不传 `options.max`、不传 `searchPath`
  - `packages/db/src/database.ts:31` — 原样转发至 `createPostgresDatabase`
  - `packages/db/src/postgres.ts:48-51` — `options?.max === undefined` → `postgres(databaseUrl, {})`
  - postgres.js 3.4.9 默认 `max: globalThis.Cloudflare ? 3 : 10`（`node_modules/postgres/cjs/src/index.js:449`，按 lockfile 安装）
- 与总纲 G5 “总 pool=10” 一致。

## 测试哈希（只记算法/版本与 m/t/p）

- 生产与合成考生/用户密码统一经 `hashPassword()`：`packages/auth/src/password.ts:4-8`，`type: argon2id`，**未显式传 m/t/p**（使用库默认）。调用点示例：`apps/api/src/routes/candidate.ts:632`、`apps/api/src/routes/auth.ts:781`、`apps/api/src/routes/attempts/__tests__/attempts.testHelpers.ts:397`。
- 缺失账号 dummy 验证 `verifyPasswordOrDummy`（`packages/auth/src/password.ts:37-47`）同样用默认参数 hash，不计完整哈希。
- 实测安装版 argon2@0.41.1 默认参数（探针 PHC 参数段，盐/摘要未记录）：**argon2id, v=19, m=65536（KiB）, t=3, p=4**
- 探针命令（在 `packages/auth` 下，pnpm 严格 node_modules）：
  `node -e "require('argon2').hash('capacity-freeze-probe-only',{type:require('argon2').argon2id}).then(h=>console.log(h.split('$').slice(1,4).join('$')))"`
  输出参数段 `$argon2id$v=19$m=65536,t=3,p=4`

## 备注

- 本文件位于研究 worktree `docs/research/exam-cdp-watt-runtime-capacity/evidence/`，后续 G0 的 PROTOCOL.md 哈希、采样数据与 run ID 证据归档于同目录树。
- 主工作树 `/home/hoo/Source/exam` 在本步骤结束时保持 clean（见 G0 执行记录）。
