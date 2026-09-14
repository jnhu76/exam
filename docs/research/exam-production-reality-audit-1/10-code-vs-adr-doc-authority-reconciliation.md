# 10 — CODE vs ADR/文档权威对账

scope：code-derived model（报告 02-09）冻结后，与 Accepted ADR、SPEC/architecture 声明、roadmap tracker 对账。method：ADR status 清点（主 agent）+ 各报告已建立的对账条目汇总；spec 点名的 #293/#534/#295/#315/#316/#317 逐一核对（gh 实测，OBSERVED_RUNTIME）。本报告只分类，不做 tracker 裁决。

> **REPORT-CORRECTIVE-1**：① ADR-010 重分类 ALIGNED——文件内同时存在 legacy header
> 元数据（`> **Status:** Proposed`）与**当前权威 Status 节**（"Accepted —
> infrastructure implemented"）；原报告误读 header 为当前状态。② ADR-018 重分类
> ALIGNED——/system/* 面是契约 current realization，generic observability platform
> 是 anti-goal，无 metrics 推送是 operability gap 不是 ADR violation。
> ③ tracker 表重对账：#498 CLOSED 但仍被 live docs 引为 current tracker、
> #534 OPEN 自称 memory roadmap 但前置文本未 reconcile（TRACKER_POINTER_DRIFT，
> 文档/治理 finding，非 runtime；不存在 duplicate execution authority）。

## 1. ADR 状态 × 代码现实

| ADR | 声明状态 | 代码现实 | 分类 |
| --- | --- | --- | --- |
| ADR-006 时间权威 | Accepted（amended 2026-07-21） | 单 kernel + 单 now 原则成立（03 §4） | ALIGNED |
| ADR-008 提交冻结 | Accepted | 冻结屏障/崩溃恢复成立（03 §6） | ALIGNED |
| ADR-005 操作状态基线 | Accepted (implemented) | 错误码/审计动作/closed 状态与代码一致 | ALIGNED |
| ADR-011 邮件/通知 | Accepted（多次 amended，#320/#402/#482） | 进程内 outbox（SKIP LOCKED）+ worker 逃生舱；amendment 与代码一致 | ALIGNED（NOTE：独立 worker 入口为双轨残余 F6-05） |
| ADR-014 incident 权威 | Accepted (2026-08-01) | UUIDv5 仲裁/单事务/System 反伪造/fresh-tx 恢复全在 | ALIGNED |
| ADR-015 proctor scope | Accepted | J4-I1B 移除危险 cap、assignment_scoped 404 全在 | ALIGNED |
| ADR-018 可观测窗口 | ACCEPTED (2026-08-14, P7 closeout) | 当前 `/system/*` 面 = 契约 current realization（D1/D3）；Metrics/Logs/Events/Materials 为 future（D5、D7 per-source ADR）；Prometheus/OTel/generic platform = **anti-goal**。无 metrics 推送、liveness 不 gate DB = **生产可运维性缺口**（08 §4），非 ADR violation | **ALIGNED**（带 operability gaps F3-05/F4-05） |
| **ADR-010 scoped RBAC** | **Accepted — infrastructure implemented**（当前权威 Status 节；文件头部 `> **Status:** Proposed` 为 **legacy/历史元数据**，非当前状态） | scopedCapability + resolver + assignment gates 已全面实现并承载生产授权（04 报告） | **ALIGNED**。可记录"文件头部残留过期元数据"（RPT-02 相关），不构成 architecture drift；repository machinery 不消费该 header 状态（无脚本读取） |
| ADR-002 websocket/SSE | Deferred | 无 WS/SSE；轮询语义一致 | ALIGNED（Deferred 如实） |
| ADR-004 desktop/lockdown | DEFERRED | requireLockdown 拒绝激活、无桌面运行时 | ALIGNED（Deferred 如实） |
| ADR-001 Redis | ACCEPTED（optional baseline） | 可选、降级内存、required 模式 fail-closed | ALIGNED |
| ADR-003 job queue | ACCEPTED（amended） | 无外部队列；outbox/loops 分类一致 | ALIGNED |
| ADR-016 offline 未来模型 | Future/记录性 | 无运行时依赖（符合"外部工具不入产品"边界） | ALIGNED（INTENTIONAL_DEFERRED_GATE） |
| ADR-017 Maintainer 边界 | Accepted | Maintainer 零业务权限 + 互斥（04 §3/§7） | ALIGNED |

## 2. Tracker / Issue 对账（gh 实测 2026-09-14，corrective 重取证的 current state）

| Issue | 状态（corrective 实测） | 正文声明 | 对账 |
| --- | --- | --- | --- |
| #516 GENERIC-RUNTIME-ROADMAP | **CLOSED**（COMPLETED，FINAL_VERDICT=GENERIC_RUNTIME_COMPLETE） | — | 前置已满足 |
| **#498 baseline-hardening** | **CLOSED（2026-09-11，COMPLETED）** | "本 Roadmap 已完成并关闭" | **CLOSED_TRACKER_STILL_REFERENCED_AS_CURRENT**：README.md:134、README.zh-CN.md:121、CONTRIBUTING.md:9、docs/README.md:28,52、docs/roadmap/current.md:6,15,28,40,61、docs/roadmap/post-mvp-issues.md:5,11,70 仍把它标为 live/current tracker。原报告误报 #498 OPEN（RPT-03） |
| #534 post-#516 roadmap | **OPEN**（**MEMORY ROADMAP — NOT CURRENT EXECUTION AUTHORITY**，自述） | "Current execution authority remains #516 until #516 is formally completed and closed"（#516 现已关闭，文本未 reconcile） | **POST-#516_TRACKER_TEXT_NOT_RECONCILED**：前置条件已消失但状态文本未更新。#534 明确自称 memory 而非 execution authority——**不构成 #498/#534 duplicate execution authority** |
| #293 umbrella | OPEN | "GENERIC RUNTIME COMPLETE · HIGH-ASSURANCE NOT COMPLETE"；序列 #315→#316→#317→#293 | ALIGNED：与代码现实一致（Controlled/Strict 尚未实现） |
| #315 device/session binding | OPEN | 未实现 | ALIGNED（restrictIp/requireLockdown 在 authoring 层拒绝激活，#516 收口——产品不撒谎） |
| #316 secondary identity | OPEN | 未实现 | ALIGNED |
| #317 continuous monitoring | OPEN | 未实现；detectTabSwitch 仅遥测+警示、无自动处分 | ALIGNED |
| #295 desktop lockdown decision gate | OPEN | ADR-004 DEFERRED | ALIGNED（一致地 Deferred） |

**合并结论（corrective）**：不是 "two OPEN roadmap authorities"，而是
**CLOSED TRACKER STILL REFERENCED AS CURRENT（#498）+ POST-#516 TRACKER TEXT
NOT RECONCILED（#534）**。这是 documentation/governance finding（F2-10
TRACKER_POINTER_DRIFT，重写后仍为 NOTE），不是 runtime finding；本 corrective
不改动 tracker 本身。

## 3. 产品契约面（wire/schema）对账

- OpenAPI 由代码生成并有门禁（`api:openapi:check`）；API wire 契约单源 @exam/contracts——未发现契约与实现漂移的抽样反例。
- take meta 的 resultVisibility/answerVisibility/canSave 等投影与 candidateResultVisibility 单一权威一致（OBSERVED_RUNTIME 实测 hidden/hidden）。
- 控制面 config 契约有机器门禁（config-contract、generate-env.test、docker-e2e-import-surface-contract）——"compose 不许自带语义默认值"被强制。

## 4. Findings

| ID | 级别 | 摘要 |
| --- | --- | --- |
| F1-10 | ~~NOTE~~ **REJECTED** | 原 claim：ADR-010 状态 Proposed vs 已全面实现（状态未翻转）。corrective：文件头部 `> **Status:** Proposed` 是 legacy 元数据；当前权威 Status 节明示 "Accepted — infrastructure implemented"（ADR-010-scoped-rbac-architecture.md:10-12）。无 repository machinery 消费 header 状态。**ADR-010 = ALIGNED**（完整 disposition 见 11 REJECTED appendix） |
| F2-10 | NOTE（重写为 TRACKER_POINTER_DRIFT） | #498 CLOSED 但仍被 7 个 live docs 位置引为 current tracker；#534 OPEN 自称 memory roadmap 但"wait for #516"前置文本未 reconcile。文档/治理 finding；需人工收敛 tracker 指针（本 corrective 不裁决、不修改） |
| F3-10 | NOTE | docs/architecture 与代码抽查一致；status 文档未逐行审计（超出本报告 scope，UNKNOWN） |

## 5. Unknowns

- status 文档（docs/status/implementation-status.md）未逐条与 as-built 对账（时间盒外）。
- CI workflow 接线细节未审计。
