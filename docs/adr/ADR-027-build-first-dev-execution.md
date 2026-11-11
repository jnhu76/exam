# ADR-027: 构建/运行架构裁决 —— 采用 Build-first 开发执行模式（Rev 2.1）

- **Status: ACCEPTED**（2026-11-11，Owner Final Architecture Adjudication **APPROVE WITH ERRATA**；E1–E3 为强制约束，已并入正文 §0.1、§2.2–2.4、§5、§9、§10。批准记录 = [#937 评论 6774167661](https://github.com/jnhu76/exam/issues/937#issuecomment-6774167661)，本文正文以该评论定稿的 Rev 2.1 ADR 文本为基础、经 PR1（#938）按仓库 ADR 规范落盘；**Rev 2.1.1 勘误**（见文尾）：§2.4/§9/§10.4 失败窗口措辞按 PR1 A3 实测修正。单 PR 施工、merge / release / issue closure 的授权状态以 AGENTS.md §2 与 #938 为准。）本核准不代表 #920 具体 HTTP 500 根因已复现或修复，也不代表系统具有跨全部进程的原子版本切换能力。
- **Date**: 2026-11-11（Rev 1：2026-11-10，见 #937 评论 2）
- **BASE_SHA**: `0e0be6f72e1400573f7e6380134c455707313cb6`（证据基线不变；Rev 2 未重跑实验，设计修订基于既有 POC 证据 + 本会话对 `scripts/e2e/run.sh:783-789` 的原文复核）
- **Decision**: **ADOPT_BUILD_FIRST_DEV**（方向已获 Owner 批准；文本按条件修订）
- **Parent implementation issue**: #938（已创建，核准前不开工）

---

## 0. Owner 条件批准记录与修订映射

**Owner Review（2026-11-11）**：Architecture direction **APPROVED** · First-run `dev` dependency build **APPROVED** · Current ADR text **REVISION REQUIRED** · Parent implementation issue **APPROVED TO CREATE**（→ #938）· #920 reality-audit comment **APPROVED TO POST** · Production implementation / Merge / Release / Issue closure **NOT AUTHORIZED**。

**Acceptance principle（Owner 原文，本 ADR 的一切设计判断以此为准）**：

> 正确的构建和运行行为必须成为标准入口的默认行为，不能依赖开发者记住额外操作。

| # | Owner 必须修订条件 | Rev 2 落点 |
| --- | --- | --- |
| 1 | Canonical development entrypoint：受管模式必须成为默认 `pnpm dev`，不得长期双轨；一次性入口须显式命名并限定保证边界 | §2.1–2.3（`pnpm dev` = `turbo watch dev`；`dev:once` 显式一次性；`watch:dist` 非受管轨工具）；§6 新增被否决项"双轨默认入口" |
| 2 | Failed-build safety：Phase 1 验证构建失败/恢复/连续修改/启动竞态；部分 dist 不得视为新版本；`noEmitOnError` 或等效机制实际验证 | §2.4（noEmitOnError 提升进 Phase 1 实施与验收）；§10.4–10.7 四场景门禁 |
| 3 | E2E dependency closure：本地与 CI E2E 构建前置本轮收敛；保持 E2E 生命周期所有权与测试隔离 | §2.5（run.sh `build_assets` 收敛为全闭包构建，独立 PR）；§7 Phase 2 |
| 4 | Explicit residual guarantees：区分受管开发轨/一次性执行轨/生产部署轨，逐项记录 N1/G1/G2/G3/A4 保证范围与处置；不得宣称跨全部进程的原子版本切换 | §9 重构为三轨保证矩阵 + 明示 non-claim |
| 5 | Issue ownership：Parent Implementation Issue 承载施工；#920 保持 OPEN/RESEARCH_FIRST，POC 不代替其因果验证 | #938 已建；§7 Phase 4（#920 独立轨道）；§2.6 |

### 0.1 Owner 最终核准与强制 Errata（2026-11-11，Rev 2.1 并入）

**Decision: APPROVE WITH ERRATA**。Approved 清单：`pnpm dev`（`turbo watch dev`）唯一推荐 canonical 受管开发入口；`dev:once` 显式一次性 Turbo 编排入口；首启先建完整 workspace 依赖闭包；`noEmitOnError` 与四类失败安全测试入 PR 1；本地 E2E 完整构建闭包入 PR 2；防复发守卫入 PR 3；#938 为实施编排宿主；#920 保持 OPEN / RESEARCH_FIRST、`STALENESS_CAUSALITY=INCONCLUSIVE`。**Final verdict: GO — Architecture Decision Approved; Implementation Remains Gated.**

**Errata（本次核准的约束，必须进入正式 ADR 与相关 PR 验收）：**

- **E1 — Failed-build semantics**：`noEmitOnError` 保证发生编译错误时不输出本次编译的新产物，不保证跨包原子发布，也不保证既有运行进程立即停止执行旧版本。失败构建不得被视为成功发布。受管执行轨必须明确暴露失败，并通过真实执行证据验证恢复行为。→ 落点 §2.4、§9 行 1、§10.4–10.5。
- **E2 — dev:once semantics**：`dev:once` 不启用 Turbo 的跨包增量构建和受管重启，但保留底层 Vite/tsx 自身的文件监听行为。不得描述为所有源码变更都不会触发重启。→ 落点 §2.2、§9 行 2、§10.11。
- **E3 — Concurrent build ownership**：`pnpm dev` 与 `pnpm watch:dist` 不得在未经验证的情况下作为同一工作树的并行 dist 构建所有者。需要明确命令适用场景，增加必要的负例验证或证明并发安全。→ 落点 §2.3、§9 行 2 处置、§10.12。

---

## 1. Context

（与 Rev 1 相同，事实未变，摘要保留；全文见 #937 评论 2 / 本地 `08-FINAL-ARCHITECTURE-DECISION.md` §1。）

1. **as-built 解析（轴 A）**：每包 exports 三条件（`@exam/test-source`→src / `types`→dist d.ts / `default`→dist js；权威 `config/workspace-resolution.mjs:60`）。Vitest（11 配置）与 typecheck（9 份）绑 src fail-closed；plain Node、api dev 的 tsx、vite、E2E、生产绑 dist，无消费时校验。
2. **as-built 新鲜度（轴 B）**：仅程序性保证（clean-before-compile + turbo `^build` + Dockerfile 显式链）；消费时刻零校验。
3. **结构性缺口（根因）**：dev 轨无守卫（`turbo.json` dev 任务无 `dependsOn`，turbo.json:9-18；api dev 实测消费 dist；fresh clone `pnpm dev` 响亮失败、过期 dist 静默加载；基线循环 2 手动动作 / P50 21.4–24.1s）；L5 运行时一致性零保证（#920 候选层，`STALENESS_CAUSALITY` INCONCLUSIVE）；web dev 轨静默陈旧（M7 实测 marker=0）；次级缺陷：tsc 无 noEmitOnError（F08）、`pnpm deploy --legacy` 毒化（G-deploy-poisoning）、README:114 "hot reload" 失实（N3）。
4. **本地/CI E2E 构建前置不对等（D1）**：`scripts/e2e/run.sh` `build_assets()`（:783-789，本会话原文复核）仅 `pnpm --filter @exam/web build` + `pnpm --filter @exam/api build` 两条直调——`--filter` 直跑不走 turbo `^build` DAG，7 个内部包 dist 完全依赖宿主遗留状态；CI 每 shard SHA 级全量重建。Rev 1 将其列为"零触碰"残留，**Owner 条件 3 将其收进本轮范围**。

## 2. Decision

**采用 Build-first 开发执行模式（ADOPT_BUILD_FIRST_DEV），以受管模式为默认开发入口：**

1. **Canonical development entrypoint（条件 1）**：root `package.json` `dev` script 由 `turbo dev` 改为 **`turbo watch dev`**——受管新鲜度成为 `pnpm dev` 的**默认语义**。首次运行：dev 任务 `dependsOn: ["^build"]` 先构建全依赖闭包（Owner 已批准该首建语义）；此后源变更由 turbo watch 重建受影响闭包并自动重启受管 dev 任务（api dev + web dev，POC 实测 PID 换血、M6 9376ms·0 动作、M7 web 5.5s）。**不存在"默认入口可能静默消费旧 dist"的轨**。`turbo.json` dev 任务（turbo.json:9-18）加 `"interruptible": true` + `"dependsOn": ["^build"]` 两键（既有 `cache:false`/`persistent:true` 保留）。
2. **一次性入口显式命名**：新增 `pnpm dev:once` = `turbo dev`。保证边界（**E2 修正口径**，README 为契约载体）：不启用 Turbo 的**跨包增量构建与受管重启**——workspace 内部包（`packages/*/src`）的源码变更不触发闭包重建；但**底层 Vite / tsx watch 自身的文件监听行为保留**（apps 内源码及各自监听面内的变更照常触发 vite reload / tsx 进程重启）。**不得**把 `dev:once` 描述为"所有源码变更都不会触发重启"。面向脚本化/一次性起栈场景。不引入第四入口。
3. **非受管轨的显式构建监听**：新增 `pnpm watch:dist` = `turbo watch build`——为 `pnpm start` / `worker:email` / CLI 等一次性执行轨提供的显式补救：只重建产物、**不重启进程**（边界写入 README）。**并发构建所有权（E3）**：`pnpm dev` 与 `pnpm watch:dist` 都是 dist 构建所有者，turbo 2.9.16 无 workspace 级构建锁——**同一 worktree 内不得默认并行**（未经验证的并发写 dist 属未定义行为）。适用场景（README 承载）：`dev` = 受管开发循环；`watch:dist` = **仅在**运行非受管轨（`start`/`worker`/CLI）时监听构建。PR 1 须交付其一：① 并发安全证明，或 ② 适用场景边界明示 + 同 worktree 并行负例的实测行为记录（fail toward 明示不支持）。Rev 1 的 `watch:dev` 别名取消（与默认 `dev` 重复）。
4. **Failed-build safety 内建于 Phase 1（条件 2，从 Rev 1 的 Phase 2(a)(e) 提升）**：build 轨启用 **`noEmitOnError`**（落点在 build 配置面——`tsconfig.base.json` 或各 `tsconfig.build.json`，由 PR 1 按 9 份 typecheck 配置与 web `tsc -b` 轨道的实测兼容性确定）。语义：**失败构建不发布任何可消费的部分 dist**——结合既有 clean-before-compile，失败后 dist 为空 → 消费者 `ERR_MODULE_NOT_FOUND` 显式失败，取代 as-built 的"语法坏 dist 被执行"（F08，两 POC 独立复现）。**失败语义边界（E1）**：`noEmitOnError` 的保证范围 = **本次编译不输出新产物**；它**不保证跨包原子发布**，也**不保证既有运行进程立即停止执行旧版本**——本架构不承诺跨包原子发布。受管轨失败窗口的 as-built 行为（PR1 A3 实测，五态分类：构建失败=是 / 新产物已产出=否 / 旧产物仍在=失败包已清理、非失败上游包完好 / 运行时存活=否）：受管 dev 任务**停止**（任务退出），失败在 watch 输出中**响亮暴露**，服务不可用直至修复；修复源码并重建后 dev 自动恢复并服务新版本（A4 实测）。因此：失败构建**不得被视为成功发布**；受管执行轨必须**显式暴露失败**（turbo watch 失败输出可见、dev 任务不发生伪重启），恢复行为（修复→重建→重启→新版本可见）以**真实执行证据**验证（§10.4–10.5）。四场景验收见 §10.4–10.7。
5. **E2E dependency closure 本轮收敛（条件 3）**：`run.sh` `build_assets()` 从两条 `--filter` 直调收敛为**全依赖闭包构建 `pnpm build`**（turbo 全量 9 包，走 `^build` DAG），与 CI 每 shard 的全量重建语义对齐。**不变**：run.sh 仍是 E2E env 唯一权威与 DB/进程生命周期所有者（worker 库隔离、端口重映射、APP_MODE、退出码矩阵零触碰）。独立 PR（PR 2），见 §7 Phase 2。
6. **次级缺陷 focused issues（更新清单）**：web build clean-dist（F3b）、deploy-poisoning 上游报告+recovery 文档、N1 窗口深评（turbo 重启顺序）、G3 worker 纳管评估。（noEmitOnError 与 A4 阴性测试已提升进 Phase 1，不再是 focused issue。）
7. **#920 保持 OPEN / RESEARCH_FIRST（条件 5）**：本决策是 #920 taxonomy 中的候选补救 A/B 落地，**不裁决也不代替** `STALENESS_CAUSALITY` 的因果验证（其受控实验独立推进）；补救 C（provenance）三条件延后口径不变。

POC 度量依据不变（M6 −56.2%·0 动作、M7 web 0 动作 5.5s、M1–M5 零回归、oracle 四绿；各自 worktree 基线对照）。

## 3. Architecture invariants

沿用 03 的 I1–I10，本决策影响（相对 Rev 1 的增量）：

- **I1**：增强（`dev.dependsOn:["^build"]` 收口 dev 前置缺口）——不变。
- **I3/I5**：**受管轨成为 `pnpm dev` 默认语义**（比 Rev 1 更强：默认入口即新鲜度入口）；非受管轨保持显式缺口（G2/G3 列名）。
- **I10 显式失败**：**增强**——noEmitOnError 使失败构建从"留下语法坏 dist"（运行时 SyntaxError，症状指向 dist）变为"零发布 + 消费者显式 missing 失败"（根因指向构建）。
- **I7 Test/CI Parity**：**增强**——本地 E2E 构建前置收敛至与 CI 同为全闭包（PR 2）；此前为 D1 差异。
- I2/I4/I6/I8/I9 与红线（生产永不激活 `@exam/test-source`、禁止洗白失败）不变。I4 的 N1 瞬态窗口按 §9 矩阵明示。

## 4. Ownership model

| 产物/职责 | 唯一所有者 | 护栏 |
| --- | --- | --- |
| dist 生命周期 | 各包 build script（clean-dist.mjs && tsc -p）；web 为 vite build | clean-before-compile + **noEmitOnError（新增）** |
| 一次性构建编排 | turbo `build`（`^build` DAG）；生产镜像为 Dockerfile 显式链 | turbo hash；payload oracle |
| **dev 受管新鲜度（canonical，修订）** | **`pnpm dev`（root script → `turbo watch dev`）**：编排闭包重建 + 重启受管 dev 任务 | dev 任务 `interruptible` + `dependsOn:["^build"]`；README 行为契约 |
| 一次性 dev 入口（修订） | `pnpm dev:once`（`turbo dev`） | README 显式保证边界（首建闭包；不启用跨包重建/受管重启，Vite/tsx 自身监听保留——E2）；不加守卫禁用 |
| 非受管轨构建监听（新增） | `pnpm watch:dist`（`turbo watch build`） | README 边界（只重建、不重启进程；与 `pnpm dev` 不得同 worktree 并行——E3） |
| E2E 构建前置（修订） | `run.sh` `build_assets()` → `pnpm build`（全闭包） | run.sh 仍为 E2E env/DB/进程唯一权威（测试隔离不变） |
| 解析权威 | `config/workspace-resolution.mjs`（不变） | lint:arch |
| 生产 provenance | 双 oracle + CI 镜像探针（不变） | CI production-transport job |
| `STALENESS_CAUSALITY` 裁决权 | #920 自身受控实验（不变） | 不被本决策预设 |

## 5. Target execution graph（采纳后）

```
源码编辑 packages/*/src
        │
        ├─ vitest / typecheck ──► src（fail-closed，不变）
        │
        └─ pnpm dev（= turbo watch dev，canonical）
              ├─ 首轮：依赖闭包 build（^build）→ 启动 dev 任务
              ├─ 源变更 → turbo 重建受影响闭包（clean + noEmitOnError：
              │     失败 → 零发布，dev 任务保持旧版或显式失败，无部分 dist）
              ├─ 任务完成后重启 interruptible dev 任务：
              │     ├─ api dev（tsx watch，消费 dist）→ PID 换血，~9.4s 新内容可见
              │     └─ web dev（vite，消费 dist）→ 自动重启，~5.5s 可见
              └─ 受管循环内 N1 瞬态窗口（~10s，web 先新 api 后新，自愈）——§9 明示

一次性入口：pnpm dev:once（首建闭包后启动；不启用跨包重建/受管重启，
      底层 Vite/tsx 自身监听保留——E2）
非受管轨：pnpm start / worker:email / CLI —— 无自动保证（G2/G3）；显式补救
      watch:dist（与 pnpm dev 不得同 worktree 并行——E3）
管线入口：pnpm build / verify / test —— 不变；E2E：run.sh build_assets → pnpm build（PR 2 后）
生产：Dockerfile 显式链 + entrypoint fail-fast —— 不变
```

## 6. Rejected alternatives

（Rev 1 §6 全部保留：Source-first 本轮不采纳、换 Turbo/Nx、TS Project References、JIT exports、turbo boundaries、mtime 哨兵、立即 provenance、KEEP_CURRENT。新增：）

| # | 备选 | 裁决 | 依据 |
| --- | --- | --- | --- |
| 9 | **双轨默认入口（Rev 1 形态：`pnpm dev`=一次性 + `watch:dev`=受管并存）** | **Owner 条件 1 否决** | 违反 acceptance principle：默认入口仍可静默消费旧 dist，正确行为依赖开发者记住换入口。Rev 2 将受管模式设为默认，一次性需求由显式命名的 `dev:once` 承载并限定边界 |

## 7. Migration plan

- **Phase 0（Owner 门禁）**：方向性批准已获得（§0）；本 Rev 2 提交**最终核准**。核准后：parent issue #938 开工、每 PR 按 AGENTS.md §2 获施工授权。Rev 1 的"dev 任务语义变化需 Owner 显式确认"已由 §0 的 First-run approval 满足。
- **Phase 1 = PR 1（canonical 入口 + 失败安全）**：turbo.json dev 任务 +2 键；root scripts：`dev` 改 `turbo watch dev`、+`dev:once`、+`watch:dist`；build 轨 noEmitOnError；README 三入口契约 + 修正 :114 "hot reload"；回归测试（入口契约断言）+ 四场景行为验证协议（§10）。门禁：oracle 四件套 + M6/M7 抽样 + 四场景全过。
- **Phase 2 = PR 2（E2E 闭包收敛）+ focused issues**：run.sh `build_assets` → `pnpm build`（RED：内部包探针在旧构建前置下不可见；GREEN：可见；E2E 隔离零变化）。focused issues：web clean-dist、deploy-poisoning、N1 深评、G3 worker（挂 #938）。
- **Phase 3（防复发守卫 = PR 3）**：Dockerfile 构建清单 == workspace 可构建包集合；build helper ⊆ `globalDependencies`（挂 lint:arch / verify:static）。
- **Phase 4（#920 收口，独立轨道）**：按 #920 自身 gate 执行受控 A/B/C 实验；`STALENESS_CAUSALITY` 裁决与补救 C 三条件立项口径不变。

## 8. Compatibility considerations

- 零新依赖、零 lockfile 变化、零工具升级；exports/vitest/typecheck/workspace-resolution 治理面零改动（不变）。
- **`pnpm dev` 语义变化（较 Rev 1 扩大）**：默认进入受管 watch 模式——首次先建全闭包（已获批），此后源变更自动重建+重启。一次性需求迁移到 `dev:once`。`docs/development/README.md:59,:114,:132` 三处同步更新。CI 与 run.sh 的 api 轨（`pnpm --filter @exam/api dev` 直调，不经 root script）不受影响。
- **noEmitOnError 面**：typecheck 轨（noEmit）与 vitest 轨语义不受影响，但 PR 1 必须实测 9 份 `tsconfig.typecheck.json` 与 web `tsc -b`（composite）轨道无行为变化；增量构建交互（tsbuildinfo 钉在 dist 内、clean 后全量）在 PR 1 验证。
- CI turbo 缓存因 turbo.json/tsconfig 变更一次性 miss（预期）；`ci.yml:79` cache key 含 `hashFiles('turbo.json')`。
- 退役条件：无（不删除任何现有兼容面）。

## 9. Residual guarantees（三轨保证矩阵，条件 4）

| 轨 | 入口 | 保证 | 不保证（明示） | 处置 |
| --- | --- | --- | --- | --- |
| **受管开发轨** | `pnpm dev`（turbo watch dev） | 首建全闭包；源变更→受影响闭包重建→api/web dev 自动重启（PID 换血实测）；失败构建零新产物发布（noEmitOnError），部分 dist 不会被视为新版本；**失败被显式暴露**（watch 错误输出可见，无伪重启）——E1 | **跨进程原子切换**：N1 瞬态代际窗口 ~10s（web ~5.5s 先新、api ~15–17s 后新，实测，自愈、仅 dev 轨）；**失败窗口无旧版运行时兜底**：失败重建期间受管 dev 任务停止、服务不可用直至修复重建（A3/A4 实测；零发布≠撤旧版≠原子替换——E1）；跨包原子发布 | N1 文档化 + turbo 重启顺序评估（focused issue，挂 #938） |
| **一次性执行轨** | `dev:once` / `pnpm start` / `worker:email` / `worker:email:dev` / tsx ops 脚本 / CLI·migration | `dev:once`：首建闭包 + **不启用跨包重建/受管重启，但 Vite/tsx 自身文件监听保留**（E2）；`start`/`worker`/CLI 启动时点也不保证（G2 as-built 保留：源变更后静默陈旧，f09b-start.log pid 98833 实证）；G3：worker:email:dev 无 watch 且非 turbo 任务 | 内部包（packages/*/src）源码变更后的闭包重建与受管重启；`watch:dist` 只重建不重启 | 显式补救 `watch:dist`（适用场景=仅非受管轨运行时；**与 `pnpm dev` 不得同 worktree 并行，E3**）+ README 边界；G3 纳管评估（focused issue） |
| **生产部署轨** | Dockerfile 显式链 / docker-entrypoint / compose | 镜像构建闭包完整性（payload oracle + prod-resolution 69·56 双 oracle）；entrypoint fail-fast；dist 唯一执行入口 | 运行时 provenance（补救 C 三条件延后）；**#920 因果未决**（STALENESS_CAUSALITY=INCONCLUSIVE） | #920 受控实验独立裁决（Phase 4） |

- **A4（turbo watch 启动期竞态）**：n=3 无失效样本但无对抗协议证据 → **阴性测试提升进 PR 1 验收**（§10.7）；补齐前不得声称"免疫"。
- **G1（构建窗口完整旧产物静默服务）**：非受管轨残留（F07 t+1 实证）；受管轨经 interruptible 重启规避；列名不掩盖。
- **明示 non-claim**：**本架构未实现、也不宣称跨全部进程的原子版本切换**；`noEmitOnError` 仅保证本次编译零发布，**不构成跨包原子发布**（E1）；非受管进程集合之间无任何一致性保证；本核准不代表 #920 HTTP 500 根因已复现或修复。

## 10. Measurable acceptance criteria（Phase 1 / PR 1 合入门禁）

Rev 1 八条保留（oracle 四件套、M6 判优双阈值、M7、M1/M2/M5 不劣化、README 断言、首建确认——后者已由 §0 满足），**新增/替换**：

1–3.（不变）`pnpm lint:arch`；`pnpm build` + `pnpm lint:prod-resolution`（69/56）；R4 oracle 8/8。
4. **失败安全·构建失败（E1）**：注入类型错误至内部包 → watch 重建失败 → **零新产物发布**（失败包 dist 已清理且无新产物；非失败上游包 dist 完好；无语法坏 dist 被执行——F08 形态消失）；**失败被显式暴露**（watch 非零/错误输出可见，dev 任务无伪重启）；失败期间受管进程行为如实记录（A3 实测：受管 dev 任务停止、服务不可用直至修复重建）——**不视为成功发布**。
5. **失败安全·恢复（E1）**：修复错误 → 自动重建成功 → dev 重启 → 新版本可见（R1 probe + dev PID 换血），全程以**真实执行证据**留痕。
6. **失败安全·连续快速修改**：连续 N（≥3）次快速源码修改 → 最终状态一致（最后写入的 tag 可见，无丢失终态、无中间态卡死）。
7. **失败安全·启动期竞态（A4 阴性测试）**：`pnpm dev` 启动后**立即**注入源码变更 → 事件不丢、最终可见（对 SF 型 arming 竞态的对抗样本）。
8. M6/M7 抽样（不变：R1 ≤15s·0 动作·PID 实变；web 0 动作可见）；M1/M2/M5 不劣化 >1.5×。
9. README 三入口契约：`grep` 断言 `dev:once`、`watch:dist` 命中；`:114` "hot reload" 已修正；`dev` 描述为受管模式；**`dev:once` 边界按 E2 口径、`watch:dist` 适用场景与并行边界按 E3 口径书写**。
10. noEmitOnError 兼容面：9 份 tsconfig.typecheck.json + web `tsc -b` 轨道实测无行为变化；typecheck/vitest oracle 保持绿。
11. **dev:once 行为契约（E2）**：内部包（packages/*/src）源码变更不触发闭包重建（dist 无变化）；apps 内源码变更的 Vite/tsx 自身监听行为实测并如实写入 README——**不得**宣称"所有源码变更都不会触发重启"。
12. **并发构建所有权（E3）**：同 worktree `pnpm dev` + `pnpm watch:dist` 并行的实测行为记录（负例验证）；或给出并发安全证明。二者交付其一，README 适用场景段落与之对齐。

PR 2（E2E）验收：内部包探针注入后本地 E2E 最小 spec 可见新行为（RED 在旧 build_assets 上不可见）；`pnpm e2e` 冒烟 + DB 隔离断言不变。PR 3 验收：lint:arch + 反事实（第 10 包 / 未登记 helper → violation）。Phase 4 以 #920 自身 gate 为准。

## 11. Rollback strategy

- **PR 1**：单 revert——root `dev` 还原为 `turbo dev`、删 `dev:once`/`watch:dist`、删 dev 任务 2 键、移除 noEmitOnError 配置、还原 README、删测试文件。零数据/迁移/依赖面；oracle 不受影响。降级路径：watch 模式可靠性问题时 `dev:once` 仍提供一次性起栈，无死端。
- **PR 2**：单 revert build_assets 段（回到两条 --filter 直调——D1 缺口还原但可独立回滚）。
- **PR 3**：单 revert（纯静态检查）。
- 回滚后系统精确回到 as-built。

---

*Rev 2 修订依据：Owner Architecture Review（2026-11-11，条件清单见 §0）；Rev 2.1 修订依据：Owner Final Architecture Adjudication（2026-11-11，APPROVE WITH ERRATA，E1–E3 见 §0.1）。**Rev 2.1.1 勘误（2026-11-11，#940 修复轮 Owner 裁决第 1 条）**：§2.4、§9、§10.4 中"失败期间受管进程继续执行旧版本"的表述与 PR1 A3 实测不符，修正为"受管 dev 任务停止、失败响亮暴露、修复重建后恢复"，并明示不承诺跨包原子发布；E1 决策内容（零新产物、失败≠成功发布、显式暴露、真实执行证据验证恢复）不变。Rev 1 全文与证据链（01a/01b/02a/02b/03/gate1/04/05/06/07 + evidence/）见 #937 评论 1–13，均未失效；Rev 2/2.1 未重跑实验，新增事实仅 `run.sh:783-789` 原文复核（本会话）。本 ADR 即该核准的 Formal Accepted 记录（PR1 落盘）。*

