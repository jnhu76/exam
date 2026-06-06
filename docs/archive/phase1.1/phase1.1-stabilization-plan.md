# Phase 1.1 Stabilization Plan

## 0. 背景

Phase 1 主体功能已经完成，但当前仍存在阻断闭环的问题：

- 考试发布请求失败；
- 删除课程请求失败；
- 考试详情页不能分配考生；
- Candidate 登录后没有可参加考试入口；
- 草稿考试无法稳定发布；
- 用户缺少修改密码等自服务能力。

这些不是 Phase 2 功能，而是 Phase 1 的收口问题。

## 1. 目标链路

Phase 1.1 必须让以下链路可跑：

```txt
Admin / Teacher 登录
  → 创建课程
  → 创建题目
  → 创建考试
  → 发布考试
  → 分配考生
  → Candidate 登录
  → 查看我的考试
  → 开始考试
  → 自动保存答案
  → 交卷
  → 自动批改
  → 查看成绩
  → 导出成绩
```

## 2. 优先级

### P0：今天就先修

1. API client 空 body 请求问题；
2. 后端错误处理 400 被包装成 500；
3. publish exam 成功后状态刷新；
4. delete course 可用；
5. exam enrollment 管理；
6. candidate 我的考试；
7. smoke test。

### P1：Phase 1.1 发布前补

1. 修改密码；
2. 操作 feedback；
3. 清晰错误消息；
4. 最小 AuditLog；
5. UI 空状态 / loading / error 状态。

## 3. Job 切分

| Job | 文件 | 目标 |
|---|---|---|
| 1 | `phase1.1_job01_api_empty_body_and_error_handling.md` | 修 API client + 后端错误处理 |
| 2 | `phase1.1_job02_exam_publish_refresh.md` | 修发布考试与详情页刷新 |
| 3 | `phase1.1_job03_exam_enrollment.md` | 补考试考生资格管理 |
| 4 | `phase1.1_job04_candidate_my_exams.md` | 补 Candidate 我的考试入口 |
| 5 | `phase1.1_job05_account_settings_password.md` | 补账号自服务与修改密码 |
| 6 | `phase1.1_job06_smoke_regression.md` | 补完整 smoke 与回归测试 |

## 4. 不变量

实现时必须继续遵守：

- Route 层禁止直接访问 db；
- Repository 必须接收 RequestContext；
- 业务查询必须带 organizationId；
- 状态变更必须通过 command function；
- 答案保存必须幂等；
- 题目快照不能被题库修改影响；
- 服务端计时是权威；
- 敏感操作写入 AuditLog；
- 不得硬编码“学生/学号/校园/实验室”等场景词。

## 5. 推荐执行节奏

```txt
Day 1:
  Job01 API client 空 body + error handler
  Job02 publish/delete 修复

Day 2:
  Job03 Exam Enrollment

Day 3:
  Job04 Candidate 我的考试
  Job05 修改密码

Day 4:
  Job06 smoke + regression
  修残留 UI feedback

Day 5:
  Review + Phase 2 plan freeze
```

## 6. 验收命令

优先运行：

```bash
pnpm verify
pnpm test:integration
pnpm smoke
```

如果项目没有上述命令，至少运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config
```

## 7. Release Criteria

Phase 1.1 可以结束的条件：

```txt
[ ] P0 bug 清零
[ ] 完整 smoke 通过
[ ] 前端无明显静默失败
[ ] 后端无 empty JSON body 500
[ ] Candidate 可以完成一次考试
[ ] Teacher/Admin 可以看到成绩
[ ] CSV 导出可用
[ ] 文档更新
```
