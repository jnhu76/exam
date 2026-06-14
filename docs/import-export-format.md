# CSV 导入/导出格式文档

## 概述

Phase 1 支持以下 CSV 数据导入/导出：

1. **Candidate CSV import** — Admin 批量创建/更新 Candidate。
2. **Question CSV import** — Admin 批量创建 Question。
3. **Result CSV export** — Admin 导出考试结果。

所有数据属于 internal default organization。Phase 1 不使用 organizationSlug，不暴露 tenant switcher，不提供 SuperAdmin 导入/导出路径。

**编码**: UTF-8
**行分隔符**: `\n` (LF)
**列分隔符**: `,` (逗号)
**引用符**: `"` (双引号)
**转义规则**: RFC 4180 — 包含 `,` 或 `"` 的值会用双引号包裹，内部的 `"` 会转义为 `""`

---

## 考生导入

### 权限

- Phase 1: Admin。
- Candidate 不自助注册。
- Candidate 由 Admin 创建或导入。

### CSV 模板下载

**端点**: `GET /candidate-fields/template`

模板来自当前部署 / default organization 的 CandidateField 配置。

**响应** (200):

```json
{
  "headers": ["用户名", "密码", "姓名", "编号", "部门"],
  "exampleRow": "cand001,Temp1234,张三,CAND001,研发部"
}
```

### CSV 格式

**第一行**：字段名称（可自定义，需与后台 CandidateField 配置一致）。

**示例 1 - 字段名表头**：

```csv
username,password,name,candidateNo,department
cand001,Temp1234,张三,CAND001,研发部
cand002,Temp1234,李四,CAND002,运营部
cand003,Temp1234,王五,CAND003,培训部
```

**示例 2 - 字段标签表头**：

```csv
用户名,密码,姓名,编号,部门
cand001,Temp1234,张三,CAND001,研发部
cand002,Temp1234,李四,CAND002,运营部
```

### 字段规则

- `username`: 必需，系统内唯一，3-50 字符，用作登录用户名。
- `password`: 可选。若未提供 password，新建时使用临时密码；生产环境应要求首次登录修改密码。
- `name`: 必需，1-100 字符。
- 其他字段: 根据当前部署 / default organization 的 CandidateField 配置动态决定。

### 导入端点

**端点**: `POST /candidates/import`

**请求体**:

```json
{
  "rows": [
    {
      "username": "cand001",
      "password": "Temp1234",
      "name": "张三",
      "candidateNo": "CAND001",
      "department": "研发部"
    }
  ]
}
```

**响应** (200):

```json
{
  "total": 3,
  "created": 3,
  "updated": 0,
  "errors": []
}
```

**错误响应**:

```json
{
  "total": 3,
  "created": 2,
  "updated": 0,
  "errors": [
    {
      "row": 3,
      "message": "Missing required fields"
    },
    {
      "row": 4,
      "message": "Unique field already exists"
    }
  ]
}
```

### 行为规则

1. **新增**: 如果 `username` 不存在，则创建新的 User + Candidate + CandidateProfile。
2. **更新**: 如果 `username` 已存在且字段值不完全匹配，更新 CandidateProfile 的 `fields` 和 User 的 `name`。
3. **唯一性**: 检查 CandidateField 配置中 `unique: true` 的字段，不能重复。
4. **必填**: 检查 CandidateField 配置中 `required: true` 的字段，不能为空。
5. **密码**: 如果未提供 `password`，新建用户使用临时密码；首次登录改密策略按当前实现边界记录。
6. **Phase 1 审计**: candidate import 应写入最小 AuditLog。

---

## 试题导入

### 权限

- Phase 1: Admin。
- Phase 3 future: scoped Teacher-like role 可获得题库导入权限。

题目归属于 Course，Course 属于 internal default organization。

### CSV 格式

**第一行**：字段名称（固定列结构，不支持自定义）。

**题头**:

```csv
type,content,optionA,optionB,optionC,optionD,standardAnswer,score,difficulty,tags,gradingRule.multiSelectScoring,gradingRule.fillBlankMatchMode
```

**单选题示例** (`single_choice`):

```csv
single_choice,下列哪个是质数？,1,3,4,6,B,5,2,基础,all_correct_full,
single_choice,1+1=?,1,2,3,4,B,5,2,基础,all_correct_full,
```

**多选题示例** (`multiple_choice`):

```csv
multiple_choice,哪些是偶数？,2,3,4,5,"A,C",10,2,基础,partial_half,
multiple_choice,哪些是成功 HTTP 状态码？,200,201,404,500,"A,B",10,3,网络,partial_half,
```

**填空题示例** (`fill_blank`):

```csv
fill_blank,HTTP 的默认端口是____,80,,,,80,5,2,网络,,exact
fill_blank,中国的首都是____,北京,,,,北京,5,2,地理,,exact
```

**判断题示例** (`true_false`):

```csv
true_false,HTTP 是无状态协议,,,true,5,2,网络,,
true_false,一年一定有 366 天,,,false,5,1,常识,,
```

### 字段说明

| 字段                             | 必填       | 说明                                                                                               |
| -------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `type`                           | 必填       | 题型：`single_choice`, `multiple_choice`, `fill_blank`, `true_false`                               |
| `content`                        | 必填       | 题目内容，填空题需包含 `____` 占位符                                                               |
| `optionA`                        | 选择题必填 | 选项 A 内容                                                                                        |
| `optionB`                        | 选择题必填 | 选项 B 内容                                                                                        |
| `optionC`                        | 可选       | 选项 C 内容                                                                                        |
| `optionD`                        | 可选       | 选项 D 内容                                                                                        |
| `standardAnswer`                 | 必填       | 正确答案：选择题用 option id；填空题为文本；判断题为布尔值 (`true`/`false`)                        |
| `score`                          | 必填       | 分值，正整数                                                                                       |
| `difficulty`                     | 可选       | 难度 1-5，默认 3                                                                                   |
| `tags`                           | 可选       | 标签，空格分隔或按当前实现解析                                                                     |
| `gradingRule.multiSelectScoring` | 可选       | 多选题评分：`all_correct_full` 或 `partial_half`                                                    |
| `gradingRule.fillBlankMatchMode` | 可选       | 填空题匹配模式：`exact` 或 `keyword`                                                               |

### 导入端点

**端点**: `POST /questions/import`

**请求体**:

```json
{
  "courseId": "course-basic",
  "rows": [
    {
      "type": "single_choice",
      "content": "下列哪个是质数？",
      "optionA": "1",
      "optionB": "3",
      "optionC": "4",
      "optionD": "6",
      "standardAnswer": "B",
      "score": 5,
      "difficulty": 2,
      "tags": "基础",
      "gradingRule": {
        "multiSelectScoring": "all_correct_full",
        "fillBlankMatchMode": "exact"
      }
    }
  ],
  "confirm": false
}
```

### 验证规则

1. **选项唯一性**: 选项 ID 不能重复。
2. **选择题至少 2 个选项**: `single_choice` 和 `multiple_choice` 必须包含 ≥2 个选项。
3. **标准答案引用选项**: 选择题的 `standardAnswer` 必须是有效 option id。
4. **填空题占位符**: 填空题内容必须包含至少一个 `____` 占位符。
5. **判断题答案**: `standardAnswer` 必须是布尔值 (`true`/`false`)。
6. **正整数分值**: `score` 必须是正整数。
7. **难度范围**: `difficulty` 必须是 1-5 的整数。

---

## 成绩导出

### 权限

- Phase 1: Admin。
- Phase 3 future: scoped ResultViewer / Teacher-like roles。
- Phase 4 future: SuperAdmin only if optional multiTenant returns。

SuperAdmin 不出现在 Phase 1 当前权限中。

### CSV 格式

**导出内容**: 某次考试的结果 CSV。

**列结构**:

```csv
考生姓名,<field1>,<field2>,...,成绩,及格状态,尝试次数,提交时间
```

**示例 - 默认字段**:

```csv
考生姓名,编号,部门,成绩,及格状态,尝试次数,提交时间
张三,CAND001,研发部,85,及格,1,2024-06-01T10:05:00.000Z
李四,CAND002,运营部,72,及格,1,2024-06-01T10:08:00.000Z
```

### 导出端点

**端点**: `GET /exams/:id/export/scores`

**响应**:

- Content-Type: `text/csv; charset=utf-8`
- Content-Disposition: `attachment; filename="scores-<exam-id>-<timestamp>.csv"`

### 字段说明

| 字段                | 说明                                                                       |
| ------------------- | -------------------------------------------------------------------------- |
| `考生姓名`          | Candidate 的 `name` 字段                                                   |
| `field1, field2...` | 当前部署 / default organization 的 CandidateField 字段，按 `sortOrder` 排序 |
| `成绩`              | 最终得分（number）                                                         |
| `及格状态`          | “及格” 或 “不及格”                                                         |
| `尝试次数`          | 累计考试次数（number）                                                     |
| `提交时间`          | ISO 8601 格式日期时间字符串                                                |

### 导出规则

1. **动态列**: 列标题根据系统配置的 CandidateField 动态生成。
2. **空值处理**: 自定义字段空值显示为空字符串。
3. **时间格式**: ISO 8601 格式：`YYYY-MM-DDTHH:mm:ss.sssZ`。
4. **审计**: Phase 1 result CSV export 应写入最小 AuditLog。
5. **大文件导出**: Phase 1 可以同步 CSV；Phase 2 才是 export job / large export / job log。
