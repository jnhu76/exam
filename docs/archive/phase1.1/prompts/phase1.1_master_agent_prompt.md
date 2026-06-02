# Prompt — Phase 1.1 Stabilization Agent

你是一名全栈工程师和架构守门人。当前项目是 LAN Exam Platform。Phase 1 主体功能已经完成，但存在阻断闭环的 bug。你的任务是完成 Phase 1.1 Release Stabilization，而不是进入 Phase 2。

## 必须先阅读

```txt
docs/SPEC.md
docs/phase1.plan.md
docs/phase1.1-boundary.md
docs/phase1.1-stabilization-plan.md
docs/phase1.1-api-contracts.md
docs/phase1.1-smoke-test.md
docs/jobs/phase1.1_job01_api_empty_body_and_error_handling.md
docs/jobs/phase1.1_job02_exam_publish_refresh.md
docs/jobs/phase1.1_job03_exam_enrollment.md
docs/jobs/phase1.1_job04_candidate_my_exams.md
docs/jobs/phase1.1_job05_account_settings_password.md
docs/jobs/phase1.1_job06_smoke_regression.md
```

## 目标

让 Phase 1 真正闭环：

```txt
Teacher/Admin 登录
  → 创建课程
  → 创建题目
  → 创建考试
  → 发布考试
  → 分配考生
  → Candidate 登录
  → 查看可参加考试
  → 开始 timed_window 考试
  → 自动保存答案
  → 交卷
  → 自动批改
  → 查看成绩
  → 导出成绩
```

## 当前已知 P0

1. `POST /api/exams/:id/publish` 空 body + JSON content-type 导致 Fastify 报错。
2. `DELETE /api/courses/:id` 空 body + JSON content-type 导致 Fastify 报错。
3. 发布考试后页面状态不刷新。
4. 考试详情页不能分配考生。
5. Candidate 登录后没有我的考试入口。
6. 考试一直草稿，不能稳定发布和关联考生。

## 执行顺序

```txt
Job01 API empty body + error handler
Job02 publish refresh + course delete
Job03 exam enrollment
Job04 candidate my exams
Job05 account settings password
Job06 smoke regression
```

每完成一个 job：

```txt
1. 运行相关测试
2. 更新文档状态
3. 记录改了哪些文件
4. 不要继续扩展范围
```

## 禁止

- 不要做 WebSocket；
- 不要做 Electron；
- 不要做随机抽题；
- 不要做 timed_sync / deadline / untimed；
- 不要做 IP 限制；
- 不要做监考面板；
- 不要做 CAS/OAuth；
- 不要做 PDF/Word 导出；
- 不要跳过 RequestContext；
- 不要让 route 直接访问 db；
- 不要硬编码学生/学号/校园/实验室等场景词。

## 最终输出

请输出：

```txt
1. 修复了哪些 P0 bug
2. 补齐了哪些闭环缺口
3. 新增/修改了哪些接口
4. 修改了哪些文件
5. 新增了哪些测试
6. smoke test 结果
7. 仍然遗留的问题
```
