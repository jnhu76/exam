# BASELINE — Final Remediation Freeze (2026-11-08)

施工前基线冻结（任务契约第 2 节「第一阶段：重新冻结基线与 PR」的产出）。
定位区别：本文是**施工方开工前的实时基线**；[`00-BASELINE.md`](00-BASELINE.md) 是
#922 归档的**审计期基线**（审计源码 master `423f2945d9feef73a5413e498fb2772cc245c754`）。
两者基线不同：本轮施工基线 = master `5140c3dd`（与 #922 归档施工基线一致）。

证据来源：五份只读审计（四份 PR 审计 #922/#923/#924/#926 + 一份环境审计，2026-11-08），
及基线记录员本轮当场复核（标记为「本轮复核」的项均由命令输出直接支持，未标记项沿用审计输入）。
任务契约原文：[`TASK-CONTRACT.md`](TASK-CONTRACT.md)（sha256
`e4b151a2766c7a4d65b4fe5462a0e4d32a6070c026434799dfe2eeeabc0accdf`，与源附件字节一致）。

## 1. MASTER_SHA

| 项 | 值 | 出处 |
| --- | --- | --- |
| origin/master | `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d` | 本轮复核 `git -C /home/hoo/Source/exam rev-parse origin/master`；主树 `git rev-parse HEAD` 同值，`## master...origin/master` 无 ahead/behind |
| master tip 语义 | Merge PR #917（分支点后 master 无任何新合并） | PR 审计 #922：`git log 5140c3dd..origin/master` 为空 |

## 2. PR_HEAD_SHA（远端 vs 本地 worktree）

四个 PR 均 base=master、merge-base 恰为 `5140c3dd`（分支直基于当前 master tip）、
OPEN + DRAFT + MERGEABLE，远端 headRefOid 与契约历史参考 SHA 完全相同 → **四个 PR 的
HEAD 均未移动（headMoved=false），无新 commit**。本轮复核：`gh pr view <n>
--json headRefOid,state,isDraft,mergeable` 四次输出与下表远端列一致；各 worktree
`git rev-parse HEAD` 与远端一致；`git status --short` 除分支行外为空（干净）。

| PR | 分支 | 远端 HEAD（=契约参考 SHA） | 本地 worktree | worktree HEAD | 状态 |
| --- | --- | --- | --- | --- | --- |
| #922 | `docs/secure-observability-evidence-archive` | `7243aa5c5ab46155d914907b6ff30acf9b51cbe4` | `/home/hoo/Source/exam-gap-worktrees/s0-evidence` | `7243aa5c5ab46155d914907b6ff30acf9b51cbe4` | OPEN/DRAFT/MERGEABLE/CLEAN |
| #923 | `fix/security-client-event-route-projection` | `038bcdbcba93a0419250484f8f4d1186552786ca` | `/home/hoo/Source/exam-gap-worktrees/pr-864` | `038bcdbcba93a0419250484f8f4d1186552786ca` | OPEN/DRAFT/MERGEABLE |
| #924 | `feat/http-request-id-response-header` | `9e1b8a75072c1c456775b5e0bcd121232faea702` | `/home/hoo/Source/exam-gap-worktrees/pr-865` | `9e1b8a75072c1c456775b5e0bcd121232faea702` | OPEN/DRAFT/MERGEABLE |
| #926 | `fix/security-http-access-log-privacy` | `623bc4b470eee6a31b390ba3f84e6dcaff8ab064` | `/home/hoo/Source/exam-gap-worktrees/pr-log-privacy` | `623bc4b470eee6a31b390ba3f84e6dcaff8ab064` | OPEN/DRAFT/MERGEABLE |

worktree 目录名说明：`pr-864`/`pr-865` 以 Issue #864/#865 命名，分别承载 PR #923/#924
分支（`git branch --show-current` 证实），与 PR 标题引用的 Issue 相符，非错挂。

## 3. 版本（Node / Fastify / Pino / nginx / PostgreSQL / pnpm / Turbo）

| 组件 | 版本 | 出处（本轮复核） |
| --- | --- | --- |
| Node（宿主） | v24.22.1（nvm `/home/hoo/.nvm/versions/node/v24.22.1`） | `node --version` |
| Node（生产镜像 base） | `node:24.22.1-bookworm-slim` | `Dockerfile:1`（`FROM node:24.22.1-bookworm-slim AS base`） |
| Fastify | 声明 `^5.3.3`（`apps/api/package.json:49`）；实装 **fastify@5.8.5** | `pnpm-lock.yaml:3744` |
| Pino | **10.3.1**，非任何 package.json 直接依赖，系 fastify@5.8.5 传递依赖；`apps/api/src` 无 `from 'pino'` 直接导入，日志走 Fastify 内建 logger | `pnpm-lock.yaml:4404`；环境审计 |
| nginx | `nginx:1.30.5-alpine3.24`（web-runner stage；`deploy/nginx/web.conf` 烘焙为 `/etc/nginx/conf.d/default.conf`，web.conf 本身无版本标记） | `Dockerfile:111` |
| PostgreSQL | `postgres:18.4-bookworm`（生产 compose；`docker-compose.dev.yml:6`、CI service 容器同标签） | `docker-compose.yml:124` |
| pnpm | 11.1.2（宿主 `pnpm --version`；`package.json:73` packageManager；Dockerfile corepack prepare 同版本） | 本轮复核 |
| Turbo | 声明 `^2.5.4`（`package.json:69`）；实装 **turbo@2.9.16** | `pnpm-lock.yaml:4939` |

## 4. pnpm / Turbo 构建路径

- 构建入口：根 `package.json` scripts（仓库唯一命令来源，AGENTS.md §7），构建经
  Turbo 编排：`turbo.json` `tasks.build` = `dependsOn: ["^build"]`、
  `outputs: ["dist/**"]`（本轮复核 `cat turbo.json`）。
- 产物路径：各包 `dist/**`（apps/api、apps/web 及 packages/* 一致）；`typecheck`/
  `lint`/`test` 均 `dependsOn: ["^build"]`，即测试运行前依赖 dist 已构建——这正是
  #920 stale-dist 风险的结构性来源（见 §7）。
- `globalDependencies`: `config/**`、`scripts/clean-dist.mjs`、`tsconfig.base.json`
  （这些变化会使 turbo 缓存失效）。

## 5. 生产启动方式

依据 `docs/deployment/mvp-deployment-runbook.md` §3 First installation（:261-310）：

1. `node scripts/init-production-env.mjs` 生成 `.env.production`（EXAM_IMAGE /
   EXAM_WEB_IMAGE 派生自 `.release-version`）；
2. `docker compose --env-file .env.production up -d`（:286）拉取预构建 release 镜像，
   启动默认栈 web+app+db（Redis 默认不启动，profile "redis"）；
3. app 容器内迁移由 docker-entrypoint.sh 执行（runbook :288-290）。

`docker-compose.yml`（compose project `exam-prod`）：app（EXAM_IMAGE，内部 :3000）、
web（EXAM_WEB_IMAGE，唯一公网入口 `${EXAM_PORT:-80}:80`，nginx）、db、redis（可选）。

## 6. 实际日志输出路径

**无文件日志**——全部 pino JSON → stdout：

- `docs/operations/README.md:113`「All logs are pino JSON to stdout. Every request
  carries a `reqId`」（本轮复核 :110-125 段原文）；
- `apps/api/src/server.ts:114-118` Fastify logger 仅 level info + redact +
  err serializer，无 destination/file 配置（本轮复核 :108-125 段）；
- `docker-compose.yml` 无 `logging:` driver 覆盖 → 落 Docker 默认 json-file driver；
- 消费方式：`docker compose --env-file .env.production logs --tail=50 -f app`
  （runbook :289）；`docs/operations/README.md:120-121`（tail all / `jq
  'select(.level >= 40)'` 过滤 warn+）；告警从同一 stdout 流消费 operability.*
  事件（`docs/operations/active-alerting.md:208`）。
- nginx 侧：#926 引入 `exam_privacy` log_format 与 `error_log crit`
  （`deploy/nginx/web.conf`，PR diff 审计；master 上尚无）。

## 7. #920 stale-dist 风险备注（施工纪律）

Issue #920（OPEN，stale-dist 混跑 proctor-events 500）验收全部未勾。**本轮任何实验
与最终测试必须核对实际加载的 dist 对应预期源码版本**：

- Turbo `build.outputs` 为 `dist/**`，而 typecheck/lint/test `dependsOn: ["^build"]`
  ——运行时/测试加载的是 dist 产物，不是 ts 源码；
- 多 worktree 并行时尤其危险：每个 worktree 各自的 `dist/` 可能对应不同分支/不同
  源码版本，误在 A worktree 里启动了 B worktree 构建的产物即 #920 的复现路径；
- 规则：不能把旧 dist 导致的行为错误归因于本轮 PR。实验前须证明「实际加载的
  dist ↔ 预期源码 commit」对应关系（如在 worktree 内干净重建后核对产物，或以
  构建日志/产物内容指纹佐证）。

## 8. 工作树状态（既有改动保护）

本轮复核 `git worktree list` + 逐 worktree `git status --short --branch`：

| 工作树 | 分支 @ HEAD | 状态 |
| --- | --- | --- |
| `/home/hoo/Source/exam`（主树） | master @ `5140c3dd` | 仅 untracked `test-results/`（既有，非本轮产物，保留不动）；与 origin/master 同步 |
| `…/s0-evidence` | docs/secure-observability-evidence-archive @ `7243aa5c` | 干净（本轮新增 BASELINE.md / TASK-CONTRACT.md 前 status 为空） |
| `…/pr-864` | fix/security-client-event-route-projection @ `038bcdbc` | 干净 |
| `…/pr-865` | feat/http-request-id-response-header @ `9e1b8a75` | 干净 |
| `…/pr-log-privacy` | fix/security-http-access-log-privacy @ `623bc4b4` | 干净 |

## 9. CI / Review / 重叠（开工前快照，2026-11-08 审计）

- **CI**：四个 PR 在各自确切 HEAD 上全绿（8 项 pass + CodeRabbit skipping，draft 不
  自动评审）。已核实 CI run 与 headSha 绑定：#922 run 42447373825 → `7243aa5c`；
  #923 run 42447323728 → `038bcdbc`；#924 check-suites → `9e1b8a75`；
  #926 check-runs 9 个中 8 success + CodeRabbit skipped。
- **Review**：四个 PR 均无人工 review（reviews 空、行内评论 0、reviewThreads 0），
  reviewDecision 空；唯一评论均为 coderabbitai「Draft PR not reviewed」自动留言。
  #923 head commit message 提及 'Independent architecture review should-follow'
  整改但未以 GitHub review 留痕；#926 PR body 合并清单三项（Owner review / CI green
  on exact head / Manual merge decision）未勾选，其中 CI 项已被证据满足但勾选框
  未更新。#923 body 注明 'Draft until independent Security/Performance/Architecture
  reviews are attached'。
- **重叠与冲突**：#922 与其余三者零文件重叠（纯新增 docs 归档 + .prettierignore，
  deletions=0）；#923 与其余三者零文件重叠；**#924 × #926 共享
  `apps/api/src/server.ts` 与 `docs/contracts/observability.md`**——`git merge-tree
  --write-tree` 实测当前无文本冲突（hunk 区域相邻不重叠、observability.md 改同一
  表格不同行），但属同域（request-id/日志布线）语义重叠：后合并方需 rebase、复跑
  对端测试，合并顺序需人工协调。

## 10. #865 状态与 Owner 决策引用

Issue #865 **OPEN**（本轮复核 `gh issue view 865`：state=OPEN，
「[Decision Gate][Observability] A2-F9 — SaveAnswer 200 响应 requestId 合同与可调查性」），
按 prior close decision 的 reopen 条款 REOPENED。决策记录三处（本轮复核均存在）：

1. **Issue body decision packet**：`Adopted scope: 865-C — site-wide server-owned
   X-Request-Id response header reusing ADR-025 request.id`；四方案投票
   （A NO_GO 2:1 / B DEFER 平票保守 / **C GO 3:0** / D NO_GO 3:0）已勾选在案；
   body 另有「Implementation checklist (2026-11-08 authorization, scope 865-C)」。
2. **评论 6715360366**（jnhu76，2026-11-08T01:00:37Z）：本轮 Owner 采纳范围
   （2026-11-08 施工授权）865-C；钉死边界：genReqId UUIDv4 单一来源、唯一
   onSend/请求头设置点覆盖 200/4xx/5xx、前端最小消费、第四载体无需 superseding
   ADR；865-D 永久 NO_GO、requestId DB 表/查询 API 维持 NO_GO。
3. **评论 6716597690**（2026-11-08T03:15:37Z）：Implementation status — scope
   865-C Draft PR #924（四向关联不变量 live 验证：响应头==pino reqId==错误信封
   requestId==audit_logs.metadata.requestId）。
4. **评论 6717402223**（2026-11-08T04:48:32Z）：评审加固 commit `9e1b8a75`，
   exact-head CI 9/9 全绿——与 pr-865 worktree HEAD 一致。

任务契约第 0 节的三项 Owner 最终决策（A — #926 保留上游诊断日志；B — #923 接受
历史数据临时残余风险；C — #924 必须完成真实 SaveAnswer 消费）见
[`TASK-CONTRACT.md`](TASK-CONTRACT.md) §0，本轮不得重复争论。

## 11. 关联 Issue 状态摘要

| Issue | State | 要点 |
| --- | --- | --- |
| #800 | OPEN | 研究伞；staged gates NOT automatically authorized；R0 deliverables 验收框未勾 |
| #864 | OPEN | decision packet 审计项已勾（泄露证实）；实现清单未勾；施工 PR #923 |
| #865 | OPEN | Owner 决策 865-C 已记录（见 §10）；施工 PR #924 |
| #919 | OPEN | user_agent 审计，验收未勾；**本轮禁止顺手处理** |
| #920 | OPEN | stale-dist 审计，验收未勾；**本轮禁止顺手处理**（但 §7 纪律适用） |
| #921 | CLOSED | NO_GO_NOW 决策回执：不建新日志平台/查询 API/调查 UI；不留实现任务 |

## 12. 归档登记说明

本文件与 `TASK-CONTRACT.md` 是施工阶段新增文件，**尚未登记入 `SHA256SUMS`**（该清单
由 #922 归档流程生成、覆盖归档时点的 62 个文件；修改已提交的清单内容超出本记录任务的
授权边界）。若后续施工将二者纳入 PR #922 提交，须按归档约定重新生成 `SHA256SUMS`
（手动 `sha256sum` 步骤，CI 不校验）。`TASK-CONTRACT.md` 的 sha256 见文首。
