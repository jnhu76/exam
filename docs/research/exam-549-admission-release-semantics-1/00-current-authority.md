# #549 — Current authority map (as-built on master `1eff3f49`)

Base SHA: `1eff3f49b6dc13336d4e17593c120d77c680e080`（origin/master，验证一致）。
本文全部结论来自 current-master 代码阅读与 repo-wide 检索，不继承 Issue 叙述。

## 1. 权威模型（与代码逐条对上）

```text
published exam.controlFlags (requireQueue, batchSize, batchInterval；发布后冻结)
        │
        ▼
exam_admissions 行（PostgreSQL，schema/pg.ts:2518）
        │   joined_at        ← joinActive 写入一次（入队锚点）
        │   partial unique   ← (org, exam, candidate) 至多一条 consumed_at IS NULL
        │   admitted_at      ← admitOnce CAS 写入一次（物化事实）
        │   consumed_at(+attempt) ← consumeActive CAS 写入一次（start 同事务）
        ▼
computeBatchRelease({anchor=earliestJoinedAt(全部行), now, batchSize, batchInterval})
    releasedBatches = floor(elapsed/interval) + 1          ← 纯谓词（admissionCommands.ts:141）
    releasedCount   = releasedBatches × batchSize
        ▼
scheduleOrdinal = countAllAhead(joined_at,id)+1（全部行，消费不减） ← 稳定序
        ▼
eligibility: ceil(ordinal/batchSize) ≤ releasedBatches           ← 时间可推导
        ▼
（仅当 reconcile 路径被请求触发时）
reconcileAdmission(candidate) → repo.admitOnce(id, now)          ← CAS，幂等
        ▼
durable admitted_at = 物化时间 ≈ 首次权威交互时间（≠ 资格边界 T）
```

**eligibility != admittedAt** 在代码上成立：`computeBatchRelease` 是纯函数（无 I/O），
`admitted_at` 只由 `admitOnce` 的 `WHERE admitted_at IS NULL` CAS 产生
（examAdmissionRepo.ts:231）。eligibility 可由 durable 事实 + now 随时重算；
admitted_at 是需求驱动写下的物化事实。

## 2. reconcileAdmission 的全部调用方（显式调用图，非函数名推断）

repo-wide 检索（`*.ts/tsx`，排除 test/dist）结果：`reconcileAdmission` 恰有 **2** 个生产调用方：

| # | 调用方 | 触发时机 | 路径 |
| --- | --- | --- | --- |
| 1 | `apps/api/src/routes/attempts.candidate.ts:598` | 考生 POST `/attempts/:examId/queue`（join → reconcile → preview） | `joinAdmissionQueue` → `reconcileAdmission` → `previewAdmissionStatus`，同一请求内 |
| 2 | `packages/exam-engine/src/admissionCommands.ts:361`（`ensureStartAdmission` 内） | 考生 POST `/attempts/:examId/start` 的新 attempt 路径 | `startOrRestoreAttempt`（attemptCommands.ts:316）在 Enrollment 锁之后、attempt 创建同事务内调用 |

`ensureStartAdmission` 的唯一调用方是 `startOrRestoreAttempt`（attemptCommands.ts:316）；
`startOrRestoreAttempt` 的唯一生产调用方是 start 路由（attempts.candidate.ts:704）。
resume/restore 提前返回，不查 admission（attemptCommands.ts:301-306；
admissionCommands.test.ts:614-631 钉住）。

**无任何后台调用方**：`deadlineScanner` / `operabilityMonitor` / `heartbeat` /
`clientEventRetention` / `emailDeliveryWorker` / `submitAndGradeAttempt` 均不引用
admission 符号（repo-wide grep 证实，exit=1）。需求驱动是结构性事实，不是文档愿望。

## 3. 其余 admission 入口与消费者

| 入口/消费者 | 位置 | 读什么 | 是否消费 admitted_at |
| --- | --- | --- | --- |
| join 路由（POST /queue） | attempts.candidate.ts:531 | join+reconcile 后 preview | 间接（ready） |
| start 门（ensureStartAdmission） | admissionCommands.ts:355 | 要求 `admittedAt !== null`，否则 `QueueAdmissionRequiredError`（fail-closed） | **是（权威门）** |
| preview（候生可见状态） | admissionCommands.ts:233 | `ready = deriveAdmissionState === "admitted"`（持久事实，非第二份谓词） | **是** |
| admin 只读视图 | exam.ts:2198（GET /admin/exams/:examId/admissions） | `listByExam` 原始行 + `deriveAdmissionViews` 派生 | **是（透传展示）** |
| consume（start 同事务） | attemptCommands.ts:410 经 repo（gate 入口 admissionCommands.ts:355） | CAS 消费；DB check `admitted_before_consumed` 强制 consumed ⇒ admitted | 是（约束） |
| 监考端 | proctorService / proctorMonitoringService | 用的是 `attemptRepo.listByExam`，**不触及 exam_admissions** | 否 |
| 指标 / 审计 / 通知 / 导出 | — | repo-wide 检索无其他 admittedAt 引用 | 否 |

`estimatedWaitSeconds`（contracts/attempt.ts:968）由谓词推导
（`batchesUntilReady × interval`，admissionCommands.ts:285-288），**不从 admittedAt 读取**。
`status:"ready"`（wire 契约）= 持久 admitted 事实。

## 4. 当前物化触发器清单（完备）

1. 考生轮询 queue 路由（每 2s，见 StartExamPage.tsx:86-96 的 poll loop）。
2. 考生 start 请求（事务内 reconcile）。

没有第三种触发器。API 重启不产生追赶写（无需追赶：eligibility 由 durable 事实+now 重算）。
