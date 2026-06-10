# Phase 1.1 Boundary — Release Stabilization

## 1. 定位

Phase 1.1 不是 Phase 2，也不是大重构。

它的定位是：

> 修复 Phase 1 闭环中的阻断 bug，补齐最小可发布能力，让 Phase 1 从“功能散点可用”变成“完整流程可跑”。

## 2. Phase 1.1 必须解决什么

### P0：阻断闭环的问题

| 编号 | 问题                                                                                      | 处理方式                                                 |
| ---- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| P0-1 | 无 body 请求带 `Content-Type: application/json`，Fastify 报 `FST_ERR_CTP_EMPTY_JSON_BODY` | 修 API client；后端错误处理保留 400                      |
| P0-2 | 发布考试后页面无反馈 / 状态不刷新                                                         | publish 成功后 reload exam detail + toast + button state |
| P0-3 | 考试详情页无法分配考生                                                                    | 补 Exam Enrollment 管理                                  |
| P0-4 | Candidate 登录后没有“我的考试”入口                                                        | 补 Candidate exams 页面和 start flow                     |
| P0-5 | 草稿考试不能稳定发布                                                                      | 修状态机/API/前端调用链                                  |
| P0-6 | 删除课程按钮无效                                                                          | 修 DELETE 请求与错误反馈                                 |
| P0-7 | Phase 1 smoke test 不完整                                                                 | 加完整闭环 smoke test                                    |

### P1：可发布前应该补

| 编号 | 问题                                     | 处理方式                                        |
| ---- | ---------------------------------------- | ----------------------------------------------- |
| P1-1 | Admin / Teacher / Candidate 不能修改密码 | 补 `/api/me` 与 `/api/me/password`              |
| P1-2 | 错误提示不清楚                           | 统一 error response + toast                     |
| P1-3 | loading / success / failed 状态缺失      | 给发布、删除、保存、分配考生加操作反馈          |
| P1-4 | 审计日志覆盖不足                         | 发布、删除、分配考生、开始考试、交卷写 AuditLog |

## 3. Phase 1.1 可以做什么

允许：

- 修 bug；
- 补接口；
- 补最小 UI；
- 补测试；
- 补 smoke；
- 补审计日志；
- 补账号自服务；
- 补 Candidate 我的考试入口；
- 补 Enrollment 管理；
- 修 API client；
- 修错误处理；
- 补文档。

## 4. Phase 1.1 禁止做什么

禁止：

- 不要引入 WebSocket；
- 不要引入 Electron；
- 不要做随机抽题；
- 不要做 timed_sync / deadline / untimed；
- 不要做 IP 限制；
- 不要做监考面板；
- 不要做 CAS / OAuth；
- 不要做 PDF / Word 导出；
- 不要做 AI 批改；
- 不要做自适应三档降级；
- 不要做树形组织；
- 不要改核心数据模型，除非是为了修正 Enrollment / Attempt 闭环；
- 不要让 route 直接访问 db；
- 不要绕过 RequestContext；
- 不要跳过 organizationId 过滤。

## 5. Definition of Done

Phase 1.1 完成标准：

```txt
[ ] 无 body mutation 请求不再触发 Fastify empty JSON body 错误
[ ] 发布考试后状态正确变为 published
[ ] 考试详情页可以添加/移除考生资格
[ ] Candidate 登录后能看到分配给自己的考试
[ ] Candidate 可以开始 timed_window 考试
[ ] 答案自动保存可用
[ ] 交卷可用
[ ] 自动批改可用
[ ] 成绩页面可用
[ ] 成绩 CSV 导出可用
[ ] 修改密码可用
[ ] P0 问题均有测试或 smoke 覆盖
[ ] pnpm verify 或项目等价命令通过
```

## 6. 进入 Phase 2 的门槛

只有满足以下条件，才允许进入 Phase 2：

```txt
[ ] Phase 1.1 smoke test 通过
[ ] P0 bug 清零
[ ] P1 中至少账号自服务、错误提示、操作反馈完成
[ ] docs/phase2.plan.md 已 review
[ ] Phase 2 每个 job 有明确“不改 Phase 1 闭环”的边界
```
