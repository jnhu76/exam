# Phase 2 Job Index

> `docs/phase-roadmap.md` is the current phase authority. Phase 2 is Exam Operation. Pass-to-proceed API, service tokens, API keys, webhooks, external integration, optional multiTenant, and SuperAdmin are Phase 4 platformization/integration.

## Phase 2A — Exam Operation

| Job    | 文件建议                              | 内容                         |
| ------ | ------------------------------------- | ---------------------------- |
| P2A-J1 | `phase2a_job01_exam_room.md`          | ExamRoom 管理                |
| P2A-J2 | `phase2a_job02_ip_restriction.md`     | IP 限制                      |
| P2A-J3 | `phase2a_job03_attempt_heartbeat.md`  | Attempt heartbeat            |
| P2A-J4 | `phase2a_job04_disrupted_restore.md`  | disrupted 检测与恢复         |
| P2A-J5 | `phase2a_job05_proctor_operations.md` | 强制交卷、延长时间、标记违纪 |
| P2A-J6 | `phase2a_job06_auditlog_expansion.md` | 审计日志扩展                 |

## Phase 2B — Proctor Panel

| Job    | 文件建议                                  | 内容               |
| ------ | ----------------------------------------- | ------------------ |
| P2B-J1 | `phase2b_job01_websocket.md`              | WebSocket 基础设施 |
| P2B-J2 | `phase2b_job02_proctor_dashboard.md`      | 监考总览           |
| P2B-J3 | `phase2b_job03_candidate_status_cards.md` | 考生状态卡片       |
| P2B-J4 | `phase2b_job04_event_stream.md`           | 实时事件流         |
| P2B-J5 | `phase2b_job05_realtime_actions.md`       | 实时监考操作       |
| P2B-J6 | `phase2b_job06_polling_fallback.md`       | WebSocket 降级轮询 |

## Phase 2C — Exam Flexibility

| Job    | 文件建议                            | 内容                       |
| ------ | ----------------------------------- | -------------------------- |
| P2C-J1 | `phase2c_job01_random_builder.md`   | 随机抽题                   |
| P2C-J2 | `phase2c_job02_random_snapshot.md`  | 随机试卷快照冻结           |
| P2C-J3 | `phase2c_job03_timed_sync.md`       | timed_sync                 |
| P2C-J4 | `phase2c_job04_deadline.md`         | deadline                   |
| P2C-J5 | `phase2c_job05_untimed.md`          | untimed                    |
| P2C-J6 | `phase2c_job06_retake_policies.md`  | daily_limit / weekly_limit |
| P2C-J7 | `phase2c_job07_score_strategies.md` | scoreStrategy 完整实现     |

## Phase 2D — Operation Export

| Job    | 文件建议                                 | 内容         |
| ------ | ---------------------------------------- | ------------ |
| P2D-J1 | `phase2d_job01_import_job_logs.md`       | 导入作业日志 |
| P2D-J2 | `phase2d_job02_large_result_export.md`   | 大结果集导出 |
| P2D-J3 | `phase2d_job03_score_pdf.md`             | 成绩 PDF     |
| P2D-J4 | `phase2d_job04_attempt_detail_export.md` | 答卷详情导出 |
| P2D-J5 | `phase2d_job05_auditlog_export.md`       | 审计日志导出 |

## 建议

不要一次性生成所有 Phase 2 job 细文档。先完成 Phase 1.1，再从 Phase 2A-J1 开始。
