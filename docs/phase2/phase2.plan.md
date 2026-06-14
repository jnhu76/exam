# Phase 2 Plan — LAN Exam Platform

> **Phase realignment note**: `docs/phase-roadmap.md` is the current phase authority. Phase 2 is Exam Operation only. It does not implement multiTenant, SuperAdmin, tenant switcher, organizationSlug login, pass-to-proceed API, service tokens, API keys, webhooks, or external integration. Those platformization/integration items move to Phase 4.

## 0. Phase 2 Entry Criteria

Phase 2 只能在 Phase 1.4 + Phase 1.5 + Phase 1.6 + Phase 1.7 完成后启动。

进入 Phase 2 前必须满足：

```txt
[ ] Phase1.4 UI Jobs U01-U04 complete
[ ] Phase1.5 PostgreSQL-only convergence complete
[ ] Phase1.6 PostgreSQL correctness hardening complete
[ ] Phase1.7 security baseline complete
[ ] S03b submit flush complete
[ ] S01 organization data boundary guard complete (Phase 1 singleTenant)
[ ] S02 Admin/Candidate RBAC baseline complete
[ ] S03a server-side exam protocol complete
[ ] PG seed stable
[ ] PG migrations clean
[ ] PG integration tests pass
[ ] pnpm verify pass
```

### Phase2 依赖 Phase1.7 的 baseline

Phase2 可以安全地假设以下 Phase1.7 baseline 已完成：

- [ ] organization data boundary guard
- [ ] Admin/Candidate RBAC baseline
- [ ] 考试协议（S03a + S03b）
- [ ] audit baseline（login/logout/audit-logs API）
- [ ] CSV / security header baseline
- [ ] account / session baseline（JWT secret fallback removed, cookie secure, dummy verify）
- [ ] password baseline（最小长度 8，config 驱动）

### Phase2 不负责提前实现 Phase1.7 full 内容

以下安全内容仍属于 Phase2 或 Phase1.8，不是 Phase2 Entry Criteria（与 `Phase2 Security Scope` 章节完整列表对齐）：

- [ ] sessionVersion full revocation
- [ ] logout 后旧 JWT 服务端失效
- [ ] password change 后旧 token 全部失效
- [ ] force reset 后旧 token 全部失效
- [ ] 5 次失败锁定 15 分钟
- [ ] mustChangePassword
- [ ] 首次登录强制改密
- [ ] 本地 Admin reset-password recovery 已记录；SuperAdmin 恢复机制属于 Phase 4 optional multiTenant
- [ ] Phase1.3 P0/P1/P2 全量通过（除非 full S04/S07 也已完成）

## 1. Phase 2 总目标

Phase 2 的目标不是继续堆 CRUD，而是让系统从“能考”升级为“能管、能控、可诊断、可恢复”。

主线：

```txt
2A: Exam Operation      考试运行控制
2B: Proctor Panel       监考实时面板
2C: Exam Flexibility    考试模式与组卷增强
2D: Operation Export     运营导出与作业日志
```

## 2. Phase 2A — Exam Operation

目标：让考试从“能开始”变成“可管理、可恢复、可干预”。

### Jobs

| Job    | 名称                 | 说明                              |
| ------ | -------------------- | --------------------------------- |
| P2A-J1 | ExamRoom 管理        | 考场名称、容量、IP 段             |
| P2A-J2 | IP 限制              | restrictIp + LAN IP range 检查    |
| P2A-J3 | Attempt Heartbeat    | candidate 定期上报 lastActivityAt |
| P2A-J4 | disrupted 检测与恢复 | 心跳超时标记 disrupted，可恢复    |
| P2A-J5 | Proctor Operations   | 强制交卷、延长时间、标记违纪      |
| P2A-J6 | AuditLog 扩展        | 监考操作全写入审计                |

### 不做

```txt
[ ] 不做 WebSocket UI 大面板，先用轮询也可以
[ ] 不做 Electron
[ ] 不做视频监控
```

## 3. Phase 2B — Proctor Panel

目标：让监考员看到实时状态并处理异常。

### Jobs

| Job    | 名称                     | 说明                             |
| ------ | ------------------------ | -------------------------------- |
| P2B-J1 | WebSocket Infrastructure | 连接、鉴权、organization scope   |
| P2B-J2 | Proctor Dashboard        | 总览：在线、断线、异常、已交卷   |
| P2B-J3 | Candidate Status Cards   | 每个考生进度、剩余时间、连接状态 |
| P2B-J4 | Event Stream             | 断线、切屏、保存失败、交卷事件   |
| P2B-J5 | Realtime Proctor Actions | 延时、强制交卷、标记违纪         |
| P2B-J6 | Fallback Polling         | WebSocket 断开时轮询降级         |

### 不做

```txt
[ ] 不做摄像头监控
[ ] 不做公网远程考试
[ ] 不把答案保存依赖 WebSocket
```

答案保存仍然走 HTTP Answer Save Protocol，WebSocket 只做状态增强。

## 4. Phase 2C — Exam Flexibility

目标：补齐更多考试模式和更灵活的组卷。

### Jobs

| Job    | 名称                   | 说明                              |
| ------ | ---------------------- | --------------------------------- |
| P2C-J1 | Random Paper Builder   | 按题型、难度、标签抽题            |
| P2C-J2 | Random Snapshot Freeze | 抽题后冻结 Question Snapshot      |
| P2C-J3 | timed_sync             | 监考统一开考                      |
| P2C-J4 | deadline               | 只有截止时间，不倒计时            |
| P2C-J5 | untimed                | 不限时练习/模拟                   |
| P2C-J6 | Retake Policies        | daily_limit / weekly_limit        |
| P2C-J7 | Score Strategies       | highest / latest / first 完整实现 |

### 核心原则

随机抽题不能破坏题目快照：

```txt
抽题规则 → 生成试卷 → 冻结 snapshot → 后续题库修改不影响 attempt
```

## 5. Phase 2D — Operation Export

目标：补齐考试运营所需的导出、作业日志和诊断证据。对外集成不属于 Phase 2。

### Jobs

| Job    | 名称                 | 说明               |
| ------ | -------------------- | ------------------ |
| P2D-J1 | Import Job Logs      | 导入作业日志       |
| P2D-J2 | Large Result Export  | 大结果集导出       |
| P2D-J3 | Score PDF Export     | 正式成绩单 PDF     |
| P2D-J4 | Attempt Detail Export| 答卷详情 PDF/Excel |
| P2D-J5 | AuditLog Export      | CSV / JSON         |

> Pass Gate API、API Key / Service Token、webhook、CAS/OAuth 正式集成属于 Phase 4 platformization/integration。

## 6. Phase2 Security Scope

Phase2 自己负责的安全内容（不依赖 Phase1.7 提前完成）：

```txt
[ ] Proctor operation audit
[ ] force submit permission
[ ] extend time permission
[ ] mark misconduct permission
[ ] WebSocket auth
[ ] WebSocket organization scope
[ ] export access control
[ ] import/export job audit
[ ] diagnostics access control
```

Phase2 或 Phase1.8 负责的 full 安全内容（Phase1.7 baseline 之上的加固）：

```txt
[ ] sessionVersion full revocation
[ ] logout 后旧 JWT 服务端失效
[ ] password change 后旧 token 全部失效
[ ] force reset 后旧 token 全部失效
[ ] 5 次失败锁定 15 分钟
[ ] mustChangePassword
[ ] 首次登录强制改密
[ ] 本地 Admin recovery 不依赖 SuperAdmin；SuperAdmin 恢复机制属于 Phase 4 optional multiTenant
[ ] Phase1.3 P0/P1/P2 全量通过（除非 full S04/S07 也已完成）
```

---

## 8. Deferred

以下暂缓到 Phase 3 或独立 Spike：

```txt
- Electron 锁屏客户端
- AI 辅助批改
- 自适应三档降级
- 树形组织层级
- 富文本 / LaTeX / 化学方程式
- 编程题 / 文件上传题 / 画图题
- 移动端适配
```

## 9. Phase 2 推荐执行顺序

```txt
Phase 2A-J1 → J2 → J3 → J4 → J5 → J6
        ↓
Phase 2B-J1 → J2 → J3 → J4 → J5 → J6
        ↓
Phase 2C-J1 → J2 → J3/J4/J5 → J6/J7
        ↓
Phase 2D-J1 → J2 → J3/J4/J5 → J6
```

## 10. Phase 2 Code Quality Gate

每个 Phase 2 job 必须检查：

```txt
[ ] Route 不直接访问 db
[ ] Repository 接收 RequestContext
[ ] 查询带 organizationId
[ ] 状态变更通过 command function
[ ] 敏感操作写 AuditLog
[ ] 新增 API 有 contracts
[ ] 新增 UI 有 loading/error/empty
[ ] 新增实时功能有降级方案
[ ] 不破坏 Phase 1 smoke
[ ] pnpm verify 通过
```
