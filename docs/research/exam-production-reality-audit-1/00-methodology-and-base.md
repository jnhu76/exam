# 00 — 方法论与基线（EXAM-PRODUCTION-REALITY-AUDIT-1 · REPORT-CORRECTIVE-1）

> **REPORT-CORRECTIVE-1 APPLIED（2026-09-14）**：本报告集已在 corrective
> 分支上从证据强度与结论强度重新对齐。修正内容总览见
> `13-report-corrective-changelog.md`；fresh-context 复核记录见
> `14-fresh-context-corrective-review.md`。原始审计结论作为历史版本保留在
> 审计分支 `audit/exam-production-reality-1`（HEAD `385e836c`）。

- **BASE_SHA**: `b9b0e08c1e06af9052c5abf611b72372601b45f9`（`origin/master`）
- **CORRECTIVE_BRANCH**: `audit/exam-production-reality-1-corrective`（真正基于 `b9b0e08c`；旧审计分支的 merge-base 为 `cc3f2c`，属于 ancestry 错误，见 13 报告 RPT-07）
- **树身份（TREE IDENTITY）**: `b9b0e08c` 与 `cc3f2c` 的树**字节相同**（`git diff cc3f2c b9b0e08c` 为空；`b9b0e08c` 是 PR #539 的 merge commit，合并结果树与 PR 头 `cc3f2c` 一致）。因此所有在 `cc3f2c` 上执行的 CI 证据可诚实用于 BASE，依据是树字节同一性，不是 SHA 相同。
- **审计时间**: 2026-09-14；corrective 时间 2026-09-14
- **审计性质**: AUDIT ONLY + REPORT-CORRECTIVE。无 production code / schema / contract / roadmap / ADR / Issue 修改，无 bug 修复。唯一允许的写路径是 `docs/research/exam-production-reality-audit-1/**`。

## 1. 环境基线（OBSERVED_RUNTIME）

| 项 | 值 | 证据 |
| --- | --- | --- |
| Node | v24.15.0 | `node -v` |
| pnpm | 11.1.2（`packageManager: pnpm@11.1.2`） | `pnpm -v`、根 `package.json` |
| PostgreSQL | 18.4-bookworm（容器镜像，生产与 dev 同版本族） | `docker-compose.yml:db`、`docker-compose.dev.yml:db` |
| Docker / Compose | 29.5.3 / v5.1.4 | `docker --version` |
| OS / kernel | WSL2, linux 6.18.33.2-microsoft-standard-WSL2 x64 | `uname -r` |
| CPU / RAM | 20 vCPU / 15 GiB（约 10 GiB available） | `nproc`、`free -h` |
| `availableParallelism` | 20（Node 视角） | Node `os.availableParallelism()` |
| git 工作树 | clean（fetch 后 `git status --short` 为空） | OBSERVED_RUNTIME |

容量实验的换算警告：本机为 WSL2 单机环境，20 vCPU 单机同时承载 API、PostgreSQL 与负载生成器，测得的绝对吞吐不可直接外推到生产硬件；实验只用于回答"瓶颈属于结构性还是余量性"。

## 2. 方法论

### 2.1 Code first

第一阶段不读 ADR/README/SPEC/roadmap 作为架构依据。架构事实只从以下来源反推：

- source code（`apps/api/src`、`apps/web/src`、`packages/*`）
- schema（`packages/db/src/schema/pg.ts`，40 张表（单文件 Drizzle 定义））
- route registration（`apps/api/src/routes/registerApiRouteModules.ts`，27 个 route module）
- engine commands（`packages/exam-engine/src`，28 个源文件（含测试共 68 个 .ts））
- repository 实现（`packages/db/src/repository`，39 个非测试文件）
- authz（`packages/authz/src`：catalog / presets / resolver / systemActor）
- runtime 插件与后台循环（`apps/api/src/plugins`、`workers`、`orchestrators`）
- frontend router（`apps/web/src/App.tsx`：约 35 个 admin 路由 + 4 个考生路由 + 5 个公开路由）
- 测试（与源文件同目录的 co-located `*.test.ts` + `apps/e2e` Playwright + `tests/deployment` + `formal/tla`）
- 配置与部署接线（`docker-compose*.yml`、`Dockerfile`、`scripts/`）

代码注释仅作 hint，不作 runtime evidence。所有结论标注证据类型：

```text
OBSERVED_CODE / OBSERVED_SCHEMA / OBSERVED_RUNTIME / MEASURED / EXECUTED_TEST / DOCUMENTED / INFERRED / UNKNOWN
```

反幻觉约束（对全部 finding 生效）：

- `DOCUMENTED ≠ OBSERVED`；`TEST_FILE_EXISTS ≠ TEST_EXECUTED`（本报告集所有测试数量一律指**测试文件**，不是"已通过的测试数"；执行证据单独列出，见 09 报告 §4）；`DB_FIELD_EXISTS ≠ FEATURE_EXISTS`；`UI_EXISTS ≠ CAPABILITY_EXISTS`；`ADR_ACCEPTED ≠ CODE_MATCHES`；`LIVENESS ≠ READINESS ≠ ALERTING`；`OPERABILITY_RECOMMENDATION ≠ ADR_VIOLATION`；`CAPABILITY_NAME ≠ RESOURCE_OWNERSHIP`；`OLD_ADR_HEADER ≠ CURRENT_ADR_STATUS`；`CLOSED_ISSUE ≠ LIVE_ROADMAP`；`DETECTION ≠ RECONCILIATION ≠ INCIDENT ≠ JUDGMENT`。
- BLOCKER / MAJOR finding 至少两个独立证据锚点，或一个可执行复现器；否则降级 CANDIDATE。
- severity 只按最终统一登记（11 报告）取一个值，禁止在分报告之间漂移。

### 2.2 Micro → Macro

每个模块先产出 MODULE CARD（ENTRYPOINTS / INPUTS / OUTPUTS / PERSISTENT STATE / AUTHORITY / CALLS / LOCKS / BACKGROUND / RBAC / FAILURE / RESTART / SCALE / TESTS / EVIDENCE / CONFIDENCE），由小事实聚合为模块级图，再聚合为子系统级与全系统图（报告 01、02）。禁止先画"大架构图"再倒推。

### 2.3 图纪律

所有 Mermaid 图的 edge 使用限定语义（CALLS / READS / WRITES / LOCKS / AUTHORIZES / VALIDATES / FREEZES / EMITS / POLLS / RETRIES / QUEUES / CONSUMES / RECOVERS / RENDERS / NAVIGATES），每张图附 3–10 个 evidence anchors（`file:symbol`）。

### 2.4 执行顺序

1. 冻结基线（本文件 §1）。
2. 主 agent 直接取证 + 串行研究 subagent（受预算约束：本审计共使用 subagent 调用 ≤5；见 §4）。
3. 隔离环境容量实验（报告 08）。
4. 冻结 code-derived model 后才进入文档/ADR 对账（报告 05、10）。
5. 最终 fresh-context 对抗评审（SA5）+ 主 agent 复核（§3）。

## 3. 主 agent / subagent 分工与预算

```text
MAX SUBAGENT CALLS = 5；本环境并发上限实际为 1，全部串行。
SA1: RBAC / capability / UI（Explore）
SA2: attempt / time / admission / submission（Explore）
SA3+SA4（合并为一轮）: detection / incidents / background execution / deployment / operations / scale / test evidence（Explore）
SA5: final fresh-context adversarial reviewer
主 agent: 唯一 synthesis authority，亲自取证核心路径并复核全部 SA5 的 BLOCKER/MAJOR。
```

## 4. 报告索引

| 文件 | 内容 |
| --- | --- |
| `00-methodology-and-base.md` | 本文件 |
| `01-module-census-and-micrographs.md` | 全部 module cards + 模块级局部图 |
| `02-whole-system-code-derived-architecture.md` | 六个必需架构 view（process/HTTP/状态/时间/准入/提交） |
| `03-attempt-time-admission-submission.md` | 状态机、时间权威、准入、提交/批改深审 |
| `04-rbac-capability-implementation-ui.md` | capability→role→scope→route→engine→UI 矩阵 |
| `05-detection-incidents-adr-reconciliation.md` | detection architecture 与 ADR 对账 |
| `06-ui-reachability-dead-surfaces.md` | UI 可达性与 dead surface |
| `07-persistence-concurrency-recovery.md` | 持久化/事务/恢复与不变量仲裁者 |
| `08-scale-operability-capacity.md` | 20/50/100/200 场景、负载实验、运维就绪 |
| `09-evidence-test-architecture.md` | 测试证据架构按不变量分类 |
| `10-code-vs-adr-doc-authority-reconciliation.md` | CODE vs 规范声明对账 |
| `11-findings-register.md` | 统一 findings register（corrective 后重建：0 BLOCKER / 0 MAJOR / 12 MINOR / 16 NOTE + 7 条 REPORT_CORRECTIVE + REJECTED appendix） |
| `12-final-production-readiness-verdict.md` | 分维度裁决 + Q1–Q4（corrective 后多维化） |
| `13-report-corrective-changelog.md` | **corrective 变更日志**（original claim / corrected claim / reason / evidence / affected reports） |
| `14-fresh-context-corrective-review.md` | **fresh-context 对抗复核**结果与主 agent disposition |

## 5. 审计命令记录

实际执行过的门禁与实验命令及其结果，见 `08-scale-operability-capacity.md` §实验记录与最终交付报告（`12`）尾部的验证记录。审计结束时 production diff 必须为 0（`git diff --stat b9b0e08c -- . ':(exclude)docs/research/**'` 为空）。Corrective 验证记录见 `13` 报告 §7 与 `12` 尾部。

## 6. 本报告的未知项

- 无。基线事实全部 OBSERVED_RUNTIME / OBSERVED_CODE。
- Corrective 新增 UNKNOWN：交卷风暴的 p95/p99/max 未被持久化到原始 notes（探针内置了分位数计算但没有保存 submit 模式的完整输出）——不得从 p50=1.3s 外推尾部（08 §2 场景 D）。开局风暴/监考/交卷/准入恢复的延迟百分位数同属"终端观察转录、raw 未保留"层级（08 §2 provenance 规则）。
- **Issue #540（audit issue）状态说明**：corrective 未修改任何 GitHub Issue（任务授权只覆盖 `docs/research/exam-production-reality-audit-1/**`）。#540 body 仍携带 pre-corrective 的旧结论（F1-04 MAJOR、0/1/12/12 计数、UI PROVEN、"454 单测"表述），**与 corrected 报告集不一致**——这是有意保留的历史记录，等待 human 决定更新 #540 或追加 corrective 评论（见 13 报告 §9）。
