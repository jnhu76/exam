# Phase 1.1 Smoke Test

## 1. 目的

验证 Phase 1 的核心闭环是否真的可用。

## 2. 测试前准备

建议使用干净数据库：

```bash
rm -f dev.db
pnpm db:migrate
pnpm db:seed
pnpm dev
```

如果项目命令不同，以项目实际命令为准。

## 3. 测试账号

可用 seed 账号：

```txt
Admin / Teacher: 使用当前项目 seed 配置
Candidate: 使用当前项目 seed 配置
```

如果没有 candidate，需要通过后台创建。

## 4. 手动 Smoke Steps

### Step 1：登录后台

```txt
[ ] 打开 /login
[ ] 使用 Admin 或 Teacher 登录
[ ] 进入 Dashboard
```

### Step 2：课程

```txt
[ ] 创建课程 Course A
[ ] 课程列表显示 Course A
[ ] 删除一个测试课程不触发 Fastify empty body 错误
```

### Step 3：题库

```txt
[ ] 创建单选题
[ ] 创建多选题
[ ] 创建判断题
[ ] 创建填空题
[ ] 题目列表显示题目
```

### Step 4：考试

```txt
[ ] 创建 timed_window 考试
[ ] 手动选择题目
[ ] 保存考试
[ ] 进入考试详情页
[ ] 点击发布
[ ] 页面显示发布中 loading
[ ] 发布成功后状态变为 published
[ ] 不再停留在 draft
```

### Step 5：分配考生

```txt
[ ] 在考试详情页看到“参加人员 / 考生资格”
[ ] 添加一个 Candidate
[ ] 列表显示 assigned
```

### Step 6：Candidate 我的考试

```txt
[ ] 退出后台
[ ] 使用 Candidate 登录
[ ] 进入“我的考试”
[ ] 能看到刚刚分配的考试
[ ] 状态为 available 或显示明确不可参加原因
```

### Step 7：开始考试

```txt
[ ] 点击考试
[ ] 进入开始确认页
[ ] 显示考试名、题目数、时长、及格分
[ ] 点击开始
[ ] 创建或恢复 attempt
[ ] 进入答题页
```

### Step 8：答题与自动保存

```txt
[ ] 作答一题
[ ] 页面显示保存状态
[ ] 刷新页面后答案仍然存在
[ ] remainingSeconds 来自服务端
```

### Step 9：交卷与批改

```txt
[ ] 点击交卷
[ ] 看到确认框
[ ] 提交成功
[ ] 自动批改完成
[ ] 进入结果页
[ ] 显示分数和是否通过
```

### Step 10：成绩与导出

```txt
[ ] Admin/Teacher 登录
[ ] 进入成绩管理
[ ] 能看到该 Candidate 的成绩
[ ] CSV 导出成功
```

## 5. 必须无这些错误

```txt
[ ] 无 FST_ERR_CTP_EMPTY_JSON_BODY
[ ] 无 publish 后静默失败
[ ] 无 delete 后静默失败
[ ] 无 Candidate 登录后无入口
[ ] 无跨租户数据泄漏
[ ] 无 route 直接裸访问 db 的新增代码
```

## 6. 自动化建议

新增 `pnpm smoke`，覆盖：

```txt
1. seed user login
2. create course
3. create questions
4. create exam
5. publish exam
6. add enrollment
7. candidate list exams
8. start attempt
9. save answer
10. submit attempt
11. grade
12. export scores
```
