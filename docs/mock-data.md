# Mock 数据

## 概述

以下数据用于 Phase 1 测试、演示和开发。所有 ID 使用固定 UUID 便于追溯。

**Phase 1 单租户说明**：

- 所有 Mock 数据属于内部 default organization。
- Mock 数据不创建 SuperAdmin。
- Mock 登录不依赖 organizationSlug。
- Phase 1 默认 mock 用户只需要 admin + candidate。
- admin 可以多个，但默认 mock 只需要一个 admin。
- candidate 可以多个。
- teacher mock 如需保留，只能放在 Future / Phase 3 examples，不作为 Phase 1 default mock。
- Mock exam 优先覆盖 `timed_window` 主路径。
- queue / restrictIp / lockdown / random advanced policy 是 Phase 2 examples，不作为 Phase 1 default mock。

---

## 组织数据 (Internal Default Organization)

> Phase 1 单租户模式：系统内部已有 default organization，无需手动创建。`slug` 仅为内部兼容字段，Mock 登录不依赖 organizationSlug。

```json
{
  "id": "org-default",
  "name": "Default Organization",
  "displayName": "考试中心",
  "slug": "default",
  "productName": "考试平台",
  "productSubtitle": "可靠的内网考试系统",
  "footerText": "© 2024 当前部署",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

---

## 用户数据 (Phase 1 Mock Users)

```json
[
  {
    "id": "user-admin",
    "username": "admin",
    "name": "管理员",
    "role": "Admin",
    "isActive": true,
    "organizationId": "org-default",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  {
    "id": "user-candidate-01",
    "username": "cand001",
    "name": "张三",
    "role": "Candidate",
    "isActive": true,
    "organizationId": "org-default",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  {
    "id": "user-candidate-02",
    "username": "cand002",
    "name": "李四",
    "role": "Candidate",
    "isActive": true,
    "organizationId": "org-default",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

---

## 考生字段 Mock (CandidateField)

### 默认字段配置

```json
[
  {
    "id": "field-candidate-no",
    "name": "candidateNo",
    "label": "编号",
    "fieldType": "text",
    "required": true,
    "unique": true,
    "sortOrder": 0,
    "organizationId": "org-default"
  },
  {
    "id": "field-department",
    "name": "department",
    "label": "部门",
    "fieldType": "text",
    "required": false,
    "unique": false,
    "sortOrder": 1,
    "organizationId": "org-default"
  }
]
```

### Candidate CSV 示例

```csv
用户名,密码,姓名,编号,部门
cand001,Temp1234,张三,CAND001,研发部
cand002,Temp1234,李四,CAND002,运营部
cand003,Temp1234,王五,CAND003,培训部
```

> 若未提供 password，新建时使用临时密码；生产环境应要求首次登录修改密码。

---

## 课程数据 (Mock Courses)

```json
[
  {
    "id": "course-basic",
    "name": "基础能力测评",
    "code": "BASIC101",
    "description": "Phase 1 timed_window 主路径演示课程",
    "organizationId": "org-default"
  }
]
```

---

## 题目数据 (Mock Questions)

### Question CSV 示例

```csv
type,content,optionA,optionB,optionC,optionD,standardAnswer,score,difficulty,tags,gradingRule.multiSelectScoring,gradingRule.fillBlankMatchMode
single_choice,下列哪个是质数？,1,3,4,6,B,5,2,基础,all_correct_full,
multiple_choice,哪些是偶数？,2,3,4,5,"A,C",10,2,基础,partial_half,
true_false,HTTP 是无状态协议,,,,,true,5,2,网络,,
fill_blank,HTTP 的默认端口是____,,,,,80,5,2,网络,,exact
```

### 题目 JSON 示例

```json
[
  {
    "id": "q-sc-1",
    "organizationId": "org-default",
    "courseId": "course-basic",
    "type": "single_choice",
    "content": "下列哪个是质数？",
    "options": [
      { "id": "A", "content": "1" },
      { "id": "B", "content": "3" },
      { "id": "C", "content": "4" },
      { "id": "D", "content": "6" }
    ],
    "standardAnswer": "B",
    "score": 5,
    "difficulty": 2,
    "tags": ["基础"]
  },
  {
    "id": "q-tf-1",
    "organizationId": "org-default",
    "courseId": "course-basic",
    "type": "true_false",
    "content": "HTTP 是无状态协议",
    "standardAnswer": true,
    "score": 5,
    "difficulty": 2,
    "tags": ["网络"]
  }
]
```

---

## 考试数据 (Phase 1 Mock Exam)

### timed_window 主路径考试

```json
{
  "id": "exam-basic-timed-window",
  "organizationId": "org-default",
  "title": "基础能力测评",
  "courseId": "course-basic",
  "durationMinutes": 60,
  "openAt": "2024-06-01T09:00:00.000Z",
  "closeAt": "2024-06-01T11:00:00.000Z",
  "passingScore": 6,
  "totalScore": 10,
  "timingMode": "timed_window",
  "questionSelectionMode": "manual",
  "questionIds": ["q-sc-1", "q-tf-1"],
  "controlFlags": {
    "shuffleQuestions": true,
    "shuffleOptions": true,
    "detectTabSwitch": false,
    "disableCopyPaste": false,
    "showResultImmediately": true
  },
  "maxAttempts": 1
}
```

### Candidate enrollment / assignment

```json
[
  {
    "id": "enrollment-basic-001",
    "organizationId": "org-default",
    "examId": "exam-basic-timed-window",
    "candidateId": "user-candidate-01",
    "status": "assigned",
    "attemptCount": 0
  },
  {
    "id": "enrollment-basic-002",
    "organizationId": "org-default",
    "examId": "exam-basic-timed-window",
    "candidateId": "user-candidate-02",
    "status": "assigned",
    "attemptCount": 0
  }
]
```

---

## 成绩导出示例

### Result CSV

```csv
考生姓名,编号,部门,成绩,及格状态,尝试次数,提交时间
张三,CAND001,研发部,95,及格,1,2024-06-01T10:05:00.000Z
李四,CAND002,运营部,72,及格,1,2024-06-01T10:08:00.000Z
王五,CAND003,培训部,58,不及格,1,2024-06-01T10:10:00.000Z
```

---

## Phase 1 试用数据组合

1. 使用 internal default organization。
2. 使用 admin 登录。
3. 配置 CandidateField。
4. 导入 Candidate CSV。
5. 创建课程。
6. 导入 Question CSV。
7. 创建 `timed_window` 考试。
8. 发布考试。
9. 分配 Candidate。
10. Candidate 使用 username/password 登录。
11. Candidate 开始考试、自动保存答案、提交。
12. 系统自动批改。
13. Admin / Candidate 查看结果。
14. Admin 导出 Result CSV。

---

## Future / Phase 2 Examples

以下不是 Phase 1 default mock：

- random question selection
- queue admission (`requireQueue`, `batchSize`, `batchInterval`)
- restrictIp
- Electron lockdown
- full retake policy / score strategy workflows
- larger export job logs

## Future / Phase 3 Examples

以下不是 Phase 1 default mock：

- teacher mock user
- Proctor / Grader / ContentManager role bundles
- scoped Teacher-like permissions
- staff invitation and email password reset
