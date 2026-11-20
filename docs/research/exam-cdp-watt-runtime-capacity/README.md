# Exam #900 / #1021 容量实验战役归档（exam-cdp-watt-runtime-capacity）

> 状态：**Owner 已确认定稿 · 限定部署的研究归档**。本目录是研究交付物的归档索引；
> 裁决全文与全部数字见 [`RESULTS.md`](RESULTS.md)（r3 定稿复核版 = r2 证据修订 + 全表数字复核），
> 冻结协议见 [`PROTOCOL.md`](PROTOCOL.md) 与 [`PROTOCOL-ADDENDUM.md`](PROTOCOL-ADDENDUM.md)。

## 三项裁决（详见 RESULTS.md §1）

| 决策点 | 裁决 |
| --- | --- |
| 登录准入（L3 登录 FIFO） | **保留现状 A**：采纳决定 `NO_GO_NOW`（T1 不满足；B 三轮实际排队 0）；login p99 效应 `INCONCLUSIVE`（A/A 噪声 14.68% > T4 阈 5pp） |
| 并行交卷准入（S4，S_sub=4） | **保留并行 A**：S4 留作候选；其 S2 重验均在非并发场景，采纳前需补队列满/跨截止/scanner 先锁交错 |
| 单 Node 运行时（Watt 对照） | **KEEP 当前单进程 / STOP_WATT**：主 event loop 未成为限制队列，无主线程因果证据 |

采样基线：A 臂为冻结 SHA `87510894728ee1ca20a530fc20e29fa1f51709b7`（= 本归档分支的基点 origin/master）；
研究分支 `research/capacity-900-1021-l3-admission` HEAD `21276e0e`（含 L3 产品原型，**不在本归档 PR 内**，见下）。
结论限定该 SHA + WSL2 单机 + canonical 配置（RESULTS.md §0.4），不跨硬件外推。

## 证据可获得性分级

**① PR 内可读**（本目录提交的全部文件）：r3 报告与冻结协议；各实验的精简指标
（`{l1-,l2-,s1-,s3-,l3-}analysis/analysis.json`）、逐对数值、断言摘要（`assertions.json`）、
实验台账（`series.log`/`series-state.jsonl`/`pilot-lock.md`/各 `README.md`/`expected.md`/`sizing.md`）、
六份冻结 SHA256 manifest、r2/r3 新增证据（`T6-RECLASSIFICATION.md`、`OWNER-REVIEW-RERUN/`、
`S2-GATE-OWNER-RERUN-r2-{live,inproc}/`、`L3-BARRIER-NGINX-20261120T095755/`）、
`S2-GATE-r3-{live,inproc}/`、`S2-BROWSER-r4/`（25/25 断言与脱敏截图）与复核/驱动脚本（`harness/`、`evidence/driver/` 等）。

**② 仅研究机保留**（不在 PR 内；存在研究 worktree
`docs/research/exam-cdp-watt-runtime-capacity/` 下同名相对路径）：

- 全部原始 run 目录的逐请求原始数据（`samples.jsonl`、`api-sampler.jsonl`、`api-research-snapshots.jsonl`、
  `nginx-access.log`、`schedule.jsonl`、`driver-metrics.jsonl`、截图以外的大件）——L1/L2/S1/S2/S3/L3-ADMISSION
  共 95 正式 run；其完整性以 ① 中的冻结 manifest 为准（PR 只含 manifest，不含这些大件本身，
  **不能仅凭本 PR 验证全量原始文件**）。
- 含口令字面量、不适合入库的文件（原字节版本）：
  `harness/lib/config.ts`（`ADMIN`/`CANDIDATE_PASSWORD` 合成口令常量，报告 §5.3 仅记指针）、
  `evidence/fixtures/seed-capacity.ts`（PR 内为脱敏派生副本，见下）、
  `evidence/S1-SUBMIT/s1-run.sh`（内嵌口令提取字面量；S1 manifest 第 176 条为其本地哈希
  `409da56e528fb0901a0502e03d8a2042dcfcc89d17181ca3fed329bf0535fe9e`）。
- `harness/logs/`（109MB 运行日志）、`evidence/driver/runs/`、`evidence/g1-traces/archive-r1-20261119/`（同目录上一轮归档副本）、
  `evidence/L3/` 中除 `20261120T035200`/`20261120T095755` 外的其余 barrier 轮次、
  S2 的 `S2-BROWSER-r1..r3`/`S2-LIVE-protocol-r*`/`S2-GATE-{r1,r2,final}-*`/`S2-INPROCESS-r*`。
- L3 产品原型（`17f8c27b..21276e0e`，feat/fix/docs 五个提交）与未提交的 S3 原型
  （`apps/api/src/lib/submitAdmission*.ts` 等）：保留在研究分支原位，**不作为本 PR 的一部分**；
  本 PR 不含任何产品代码、CI 配置或构建产物。

**③ 复核标签**：S2 浏览器案例（`S2-BROWSER-r4/`，25/25）保留**原归档标签**——r2 独立复跑只覆盖
live 38/38 + in-process 36/36（`s2-gate.mjs` 不复跑浏览器案例）；不要把浏览器案例表述为已独立复现。
原始 G3/G4 两次 `exit=1` 原因不可追溯、在本环境不可复现，可运行部分的独立复跑通过（RESULTS.md §5.6）。

## 派生（脱敏）文件

| PR 内文件 | 与原字节的差异 |
| --- | --- |
| `evidence/fixtures/seed-capacity.ts` | 文件头加派生声明；proctor 合成口令字面量替换为 `<redacted-for-archive>` |
| `evidence/g1-traces/README.md` | 脱敏断言一节的口令字面量替换为 `<redacted-for-archive>` 并加派生注记 |

两者按 PR 内实际字节计入增量清单；原字节版本仅研究机保留（②）。

## 完整性与校验

- 六份冻结 manifest（`evidence/{L1-VERIFY,L2-ARRIVAL,S1-SUBMIT,S2-TIMING,S3-ADMIT,L3-ADMISSION}/manifest-sha256.txt`）
  **原样保留**，其条目覆盖各自目录的**完整本地证据集**（含大量仅研究机保留的原始文件），
  在研究机上曾以 `sha256sum -c` 全量通过（RESULTS.md §5.4）。
- 本归档新增 [`evidence/manifest-archive-r2-sha256.txt`](evidence/manifest-archive-r2-sha256.txt)：
  覆盖**本 PR 提交的全部文件**（最终版报告、冻结协议与 r2/r3 新增证据、精简指标与台账、
  上述两个派生副本按实际字节），不含清单自身；路径为仓库内相对路径，可在 PR 检出后
  `cd <repo-root> && sha256sum -c docs/research/exam-cdp-watt-runtime-capacity/evidence/manifest-archive-r2-sha256.txt` 校验。

## 敏感内容纪律

未归档任何研究专用明文口令（合成考生/监考口令常量仅指针或脱敏占位）、完整 argon2 哈希、cookie、JWT 或环境变量文件。
两处已知例外均为仓库既有公开信息：`harness/l3-barrier-nginx.ts` 复用仓库 canonical seed 的 admin 口令
（master 的 `docs/archive/dev/demo-seed-test-guide.md` 等既有文档已公开该值）；`DATABASE_URL` 记录中的
`exam:exam@127.0.0.1` 是本机 name-guarded 研究库凭据（与仓库测试文档公开的本地默认一致）。
浏览器轨迹凭据均为 `<redacted>` 占位（g1 README 脱敏断言：明文口令与 `eyJ` 片段 0 次）；
无 DB dump；原始数据仅含合成考生（`cap9*`）与可重置研究库（`exam_550_e2e` 等）。
