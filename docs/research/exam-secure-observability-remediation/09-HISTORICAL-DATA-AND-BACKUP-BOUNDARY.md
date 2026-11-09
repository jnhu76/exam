# Historical Data & Backup Boundary（TASK-CONTRACT §5.5 / Decision B 残余风险）

- Reviewed SHA: `038bcdbcba93a0419250484f8f4d1186552786ca`（worktree
  `/home/hoo/Source/exam-gap-worktrees/pr-864`）
- 调查方式：只读仓库脚本、部署文档与 Compose 拓扑；未触碰任何生产数据、
  生产备份或部署主机。无部署环境访问权限 → 所有部署侧事实标 UNKNOWN。

## §5.5 备份机制枚举（仓库与部署文档中真实存在的）

| 机制 | 存在性 | 权威出处 |
| --- | --- | --- |
| PostgreSQL 逻辑备份（`pg_dump -Fc` / `pg_restore`） | 存在 — 唯一受支持机制，封装于 `scripts/db-backup.sh`（DB 身份从运行中 db 容器解析，不重读 env 文件） | `scripts/db-backup.sh:1-46`；`docs/deployment/mvp-deployment-runbook.md` §17（:1170-1194） |
| 物理/文件系统级备份（`pg_basebackup`、WAL 归档、PITR） | 不存在（平台明确不提供） | runbook:1192-1194 |
| Docker 卷/数据目录复制 | 存在为**宿主持久化而非备份**（`./data/postgres` bind mount；文档明确「Host persistence is not backup」） | runbook:1171-1175；`docker-compose.yml` volumes |
| 备份调度器/目录/保留引擎 | 不存在（平台明确不提供；调度与保留归 cron/systemd 与 operator 政策） | runbook:1191-1193,1204-1205 |
| 备份证据/RPO/RTO 记录子系统 | 不存在（ADR-023 已移除 backup-evidence 表与产品侧记录义务；义务保留在 operator） | runbook:1198-1205 |
| 附件/部署设置文件的备份文档 | 不存在（已知 host-side gap，operator 范围） | runbook:1224（"Scope of this program" 段） |
| 恢复演练 | 存在为隔离一次性容器 drill（§17.2）；`db-backup.sh restore` 明确禁止当 drill 用（会 DROP+CREATE 生产库） | runbook:1206-1216, §17.2 |

## 逐项调查结论

- **备份保留期**：UNKNOWN。runbook:1204-1205 —「the retention horizon are
  operator decisions, enforced by host tooling」。仓库不设、不知道、也不记录
  任何部署的保留期。
- **加密**：UNKNOWN。`db_dump -Fc` 自身不加密；dump 文件加密/静态保护无任何
  产品或文档机制（仓库内无加密要求或实现）；属 operator host-side 义务。
- **文件读取权限**：UNKNOWN。dump 落在 operator 指定路径（如 `/mnt/nas/...`
  示例），权限由主机管理；产品无 RBAC/权限声明覆盖备份文件。
- **恢复后旧事件是否重新出现**：会。`pg_restore` 是全库恢复（restore 流程
  DROP + CREATE + pg_restore，db-backup.sh），dump 时点尚未过期的
  `client_events` 行——包括 pre-#864 原始 legacy route 字节——恢复后重新
  at-rest 存在；随服务器时间推进由 30 天 retention 重新老化删除
  （30-天机制的真实 PG 验证见
  `08-CLIENT-EVENT-RETENTION-VERIFICATION.md` §5.2）。恢复后读取端仍受
  读取侧安全模板投影保护（proctorMonitoringService.ts:68-82），不因恢复
  绕过（读取端审计见 08 号文件 §5.4）。
- **备份清理与业务 retention 独立性**：独立。业务 retention（30 天
  client_events executor）只操作在线库；备份文件的生成/保留/销毁完全由
  operator 工具链拥有，两者无联动（runbook:1191-1193）。⇒ **备份中的历史
  legacy route 字节保留时长 = operator 备份保留期（UNKNOWN），不受本产品
  30 天机制约束。**

## Decision B 残余风险边界（如实记录，不隐藏）

1. 历史 `client_events.route` 原始字节：at-rest 残留（已执行验证，08 号
   文件 §5.4 legacy T）；读取端强制投影为封闭模板或 null（已执行验证）；
   过期行由 30 天清理删除（已执行验证）。**数据库在线层的 30 天机制本轮
   已真实验证；historical at-rest 残余为 Owner 已接受风险（Decision B）。**
2. 备份层：任何部署若存在 ≥30 天前的 dump，其中可能含原始 legacy route
   字节——保留期、加密、读取权限全部 UNKNOWN（无部署访问权限，未验证）。
   `BACKUP_RETENTION = UNKNOWN`（非 VERIFIED、非 PARTIAL）。
3. 未验证项汇总：实际部署的备份计划表、dump 保留窗口、dump 文件权限/加密、
   离线副本、第三方收集——均 NOT_VERIFIED（本环境无部署访问权）。

## §5.6 判定输入（当前状态）

| 判定输入 | 状态 | 依据 |
| --- | --- | --- |
| 新写入安全 | 满足 | ingest 投影 routes/clientEvents.ts:118 + contracts 测试 60 passed + clientEvents.test.ts（含 RT 攻击矩阵，本阶段 4 文件 55 passed 内） |
| legacy 授权读取安全 | 满足 | proctorMonitoring.test.ts "#864 LEGACY rows"（1 passed 单测复跑）+ 读取端审计无绕过（08 号文件 §5.4） |
| 30 天清理机制真实验证 | 满足 | 08 号文件 §5.2 十二条件全 PASS（真实隔离 PG + 可控时钟） |
| 备份残余风险清楚标记 | 满足 | 本文件（UNKNOWN 项明确标注，未虚构 VERIFIED） |

依据以上四项，#923 满足契约 §5.6 当前获授权的产品修复范围；原始历史字节
仍存在（在线层待自然过期、备份层保留期 UNKNOWN）这一事实未隐藏。

## 七要素补记（2026-11-09 编纂复核）

| 要素 | 值 |
| --- | --- |
| 真实代码 SHA | 撰写时 #923 head `038bcdbcba93a0419250484f8f4d1186552786ca`；最终 #923 head `d3580f3e46e2292317dfe831efd982d475d163e8`；最终集成 `a84b416a0c58cd73a7143eef274ef2c68f0f4fcc`；master `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d` |
| 运行环境 | 只读文档/脚本调查，未启动数据库、未读写任何生产/测试数据；宿主 WSL2 Linux 6.18.54.1，Node v24.22.1（本次实测） |
| 执行命令 | `git show`/文件读取核对 `scripts/db-backup.sh`、`docker-compose.yml`、runbook §17；本次复核：`git diff --stat 038bcdbc d3580f3e -- apps/api/src/plugins/clientEventRetention.ts packages/db/src/repository/clientEventRepo.ts scripts/db-backup.sh docs/deployment docs/operations` → 空（备份/保留相关源码与文档在两个 head 间未变） |
| 关键测试结果 | 本文件不执行测试；30 天机制与 legacy 投影的实跑证据在 `08-CLIENT-EVENT-RETENTION-VERIFICATION.md` §5.2/§5.4（8/8 + 1 passed） |
| 原始证据路径 | runbook `docs/deployment/mvp-deployment-runbook.md` §17（:1170-1194 等，正文所列行号）；`scripts/db-backup.sh`；`raw/replay-db-routestorage.txt` |
| 已知边界 | 无部署访问权：备份保留期/加密/dump 权限/离线副本/第三方收集全部 UNKNOWN；`pg_restore` 会使 dump 时点未过期行重新 at-rest；在线 30 天删除不等于所有介质删除 |
| 结论可信度 | 机制枚举与仓库事实：高（源码/文档逐项引用）；部署侧事实：UNKNOWN（诚实声明，未虚构 VERIFIED/PARTIAL） |

**SHA 变更影响**：`038bcdbc → d3580f3e` 只增加 requestId 形状 gate 与 retention
契约测试，不改备份/保留机制；本文件的“备份与业务 retention 完全独立”“保留期
UNKNOWN”结论对最终 head 仍成立。
