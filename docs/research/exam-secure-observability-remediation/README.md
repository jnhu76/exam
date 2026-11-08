# Exam Secure Observability Audit — Evidence Archive

版本化归档：2026-11 安全关联与可观测性边界审计（secure-correlation-audit）的十份
终稿、独立评审、回写草稿与可公开原始证据。归档目的：使 #864/#865 的施工裁决与
后续复验不依赖 gitignored 的 `.tmp/` 工作区。

- 审计基线 master SHA：`423f2945d9feef73a5413e498fb2772cc245c754`（Merge PR #915）
- 实验源码 SHA 与各实验步骤出处：见 [00-BASELINE.md](00-BASELINE.md)
- 归档施工基线 master SHA：`5140c3dd0f9dbde1bdad8f5b757161f3ed96945d`（本目录创建时）
- 审计纪律：只读审计 + 受控实验，全程零产品改动（`PRODUCT_CHANGES = NONE`）

## 文件索引

| 文件 | 内容 | 原始文件（.tmp，未入档） |
| --- | --- | --- |
| [00-BASELINE.md](00-BASELINE.md) | 基线冻结、源码测绘、SHA 记录 | `BASELINE-AND-SOURCE-MAP.md` |
| [01-FINAL-AUDIT.md](01-FINAL-AUDIT.md) | 最终裁决（六项判定 + 归票 + 严格输出块） | `FINAL-VERDICT.md` |
| [02-SECURITY-EVIDENCE.md](02-SECURITY-EVIDENCE.md) | 对抗测试结果（RT 系列 canary 矩阵解读） | `ADVERSARIAL-TEST-RESULTS.md` |
| [03-AUTHORIZATION-MATRIX.md](03-AUTHORIZATION-MATRIX.md) | 授权隔离矩阵（M1–M20、族 1–9、113+ 探针） | `AUTHORIZATION-MATRIX.md` |
| [04-PERFORMANCE.md](04-PERFORMANCE.md) | 性能实验（4 变体 × 4 场景 × 3 并发） | `PERFORMANCE-RESULTS.md` |
| [05-ARCHITECTURE-DECISION.md](05-ARCHITECTURE-DECISION.md) | 方案裁决（864-B / 865-C 等 A–D 对比） | `ARCHITECTURE-OPTIONS.md` |
| [06-REPRODUCIBILITY.md](06-REPRODUCIBILITY.md) | 环境搭建与复现 runbook（仓库语义命令） | `env/RUNBOOK.md` |
| [SHA256SUMS](SHA256SUMS) | 本目录全部文件的 SHA-256 清单 | 归档时生成 |
| [raw/](raw/) | 可公开原始证据（下表） | `.tmp/` 各子目录 |

`raw/` 内的关键证据（与 [01-FINAL-AUDIT.md](01-FINAL-AUDIT.md) §1 判定依据对应）：

- **route 泄露（RT-3/8/12B/12C/14B/18B）**：`canary-matrix.md`（31 用例投放矩阵）、
  `db-route-dump.txt` / `db-metadata-dump.txt` / `db-per-event-classification.txt`
  （at-rest 终态 31 行）、`timeline-proctorA1.json`（已授权读取面 12 canary）、
  `post-canaries.out.txt`（HTTP 投放原始输出）、`unit-normalize.out.txt`
  （单元级投影输出）。
- **授权隔离（M1–M20、113+ 探针）**：`authz-tenant.md`、`authz-proctor-admin.md`、
  `run-01-cross-org.txt`、`run-02-cross-candidate.txt`、
  `run-02b-proctor-cross-exam.txt`、`run-05-enumeration.txt`、
  `run-06-07-clientevents-requestId.txt`、
  `run-07b-proctorevents-500-isolation.txt`。
- **requestId 信任与关联**：`header-influence.md`（伪造头 E1a–f）、
  `pb-08-restart-raw.log`（跨重启唯一性，495 distinct reqId 零复用）、
  `01-02-header-consistency-raw.log`（200 无 ID / 信封有 ID 对照）、
  `pb-s1..s7-scenario-raw.log`（调查七情形，含 ±150ms 窗 5 候选反例）、
  `03-saveanswer-matrix-raw.log`、`consistency-02.md`、`saveanswer-matrix.md`、
  `investigation-playbook.md`。
- **性能原始数据**：`bench.csv`（144 行测量行）、`summary.csv`（48 格聚合）、
  `bench-devnull.csv` / `devnull-summary.txt`（sink 对比，INCONCLUSIVE 项）、
  `uuid-bench.txt`（randomUUID 微基准）、`http-canary-c.txt` /
  `unit-canary-c.out.txt` / `httperr-c8-perrep.txt`（门变体专项）。
- **独立评审与重放**：`review-security.md`、`review-performance.md`、
  `review-architecture.md`（三裁决官意见）、`replay-*`（裁决官独立重放输出）。
- **回写草稿**：`writeback-issue-864.md`、`writeback-issue-865.md`、
  `writeback-issue-800.md`（发布到 GitHub 的底稿）。
- **其余终稿**：`external-practices.md`（五厂商外部实践）、
  `request-correlation-matrix.md`、`independent-review.md`、
  `trust-boundary-dag.mmd`（信任边界 DAG）。

## 脱敏声明（SECURITY_SANITIZATION_PASS）

归档前逐类扫描：JWT/Bearer、Cookie/Set-Cookie、密码、私钥、真实用户身份、
内部主机地址。合成 Canary（`EXAMAUDIT-CANARY-*` 前缀）为标记用途保留。

**未入档（含活动凭据或大体量运行时日志，原值仅存于 gitignored `.tmp/`）**：

- `env/*.token`（7 个会话 JWT）、`performance/state-*.json`（内嵌同批 token）、
  `evidence/boot-*-cookies*.txt`、`evidence/proctor2-cookies.txt`、
  `evidence/boot-14-orgb-jwt-boundary.txt`（Set-Cookie/JWT 原文）；
- `env/server.log` / `env/server.prev-session.log`（1.9MB Pino 运行日志；
  复验用过滤摘录已在 `raw/` 各证据文件中）；
- `correlation/pb-01-live-traffic.log` / `pb-02-live-traffic.log`（含 5 处 JWT）。

文档中引用 token 的复现命令一律以 `$(cat .tmp/.../xxx.token)` 形式引用文件路径，
不内嵌值。`exam:exam` 开发库凭据与 `admin/admin123` 等 seed 账号为仓库已提交的
开发缺省值（`docker-compose.dev.yml`、e2e seed），不构成新增暴露。

地址与主机标识的边界（精确表述）：
- 唯一入档的私有地址是 `172.18.0.3/32`（Docker bridge 网关侧看到的容器自身地址），
  出现在 `06-REPRODUCIBILITY.md` 的数据库身份核验输出中；它是容器网络地址而非
  机构 LAN 主机，且不伴随任何凭据。
- 入档证据保留开发机路径（`/home/<user>/Source/...`）、Node 版本路径与 Pino
  `hostname` 字段（开发机命名）——属于宿主指纹级信息，非凭据/秘密/PII；如需最小化
  可在发布前统一规范化。
- 真实内部 LAN 主机名/IP 仅出现在未入档的 server.log 中（已排除）。

## 复现

见 [06-REPRODUCIBILITY.md](06-REPRODUCIBILITY.md)（主要步骤使用仓库语义命令：
`pnpm db:up`、`pnpm seed:e2e`、`pnpm --filter @exam/api dev`，数据库生命周期遵循
`docs/standards/testing.md` §2.8 所有权契约）。注意：原始 `.tmp` 脚本
（`canary/unit-normalize.mjs`、`adversarial/post-canaries.mjs`、
`correlation/exp1-2.sh`、`performance/scripts/run-bench.sh` 等）未随本归档入库；
按 06-REPRODUCIBILITY.md 与各证据文件内嵌的命令行可重建等价实验。

复现口径（精确表述）：06 中出现的 `CREATE DATABASE exam_ci_audit` 等手工命令是
**审计时的一次性证据采集步骤**，不是第四套数据库生命周期；数据库生命周期的唯一
权威仍是 `docs/standards/testing.md` §2.8（库名属 `exam_ci[_-]<suffix>` 合法族、
未触碰 dev `exam`、未执行 `db:down`/`db:reset`）。`raw/replay-timeline-proctorA1.json`
与 `raw/timeline-proctorA1.json` 逐字节相同——这是重放复现实验的**结果证据**
（同一请求序列产生相同投影），不是重复文件。

## 完整性

`SHA256SUMS` 覆盖本目录除自身外的全部文件。该目录加入 `.prettierignore`，
格式化工具不得改动证据原文。完整性校验是**手动步骤**（`sha256sum -c SHA256SUMS`，
实测 62/62 OK）；CI 目前不校验该清单——如需自动化，应在后续变更中增加独立检查，
而非在本归档内引入工具。
