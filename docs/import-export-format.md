# CSV 导入/导出格式文档

## 概述

本系统支持以下 CSV 数据导入/导出：

1. **考生导入** — 批量创建/更新 Candidate
2. **试题导入** — 批量创建 Question
3. **成绩导出** — 导出考试结果为 CSV

**编码**: UTF-8
**行分隔符**: `\n` (LF)
**列分隔符**: `,` (逗号)
**引用符**: `"` (双引号)
**转义规则**: RFC 4180 — 包含 `,` 或 `"` 的值会用双引号包裹，内部的 `"` 会转义为 `""`

---

## 考生导入

### CSV 模板下载

**端点**: `GET /candidate-fields/template`

**响应** (200):

```json
{
  "headers": ["学号", "姓名", "院系", "年级"],
  "exampleRow": "20240001,张三,计算机系,2024级"
}
```

### CSV 格式

**第一行**：字段名称（可自定义，需与后台 CandidateField 配置一致）

**示例 1 - 默认字段**（字段名，推荐使用模板下载获取）:

```
username,password,name,studentId,department,grade
stu001,123456,张三,20240001,计算机系,2024级
stu002,123456,李四,20240002,软件工程,2024级
stu003,123456,王五,20240003,信息安全,2023级
```

也支持使用字段标签（中文）作为表头:

```
用户名,密码,姓名,学号,院系,年级
stu001,123456,张三,20240001,计算机系,2024级
stu002,123456,李四,20240002,软件工程,2024级
```

**示例 2 - 自定义字段**:

```
username,password,name,employeeId,department,position
EMP001,123456,张三,1001,研发部,工程师
EMP002,123456,李四,1002,市场部,专员
```

**字段规则**:

- `username`: 必需，唯一标识，3-50 字符，用作登录用户名
- `password`: 可选（新建时默认 123456，更新时忽略）
- `name`: 必需，1-100 字符
- 其他字段: 根据 CandidateField 配置动态

### 导入端点

**端点**: `POST /candidates/import`

**请求体**:

```json
{
  "rows": [
    {
      "username": "student01",
      "name": "张三",
      "studentId": "20240001",
      "department": "计算机系",
      "grade": "2024级"
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
      "message": "StudentId already exists"
    }
  ]
}
```

### 行为规则

1. **新增**: 如果 `username` 不存在，则创建新的 User + Candidate + CandidateProfile
2. **更新**: 如果 `username` 已存在且字段值不完全匹配，更新 CandidateProfile 的 `fields` 和 User 的 `name`
3. **唯一性**: 检查 CandidateField 配置中 `unique: true` 的字段，不能重复
4. **必填**: 检查 CandidateField 配置中 `required: true` 的字段，不能为空
5. **密码**: 如果未提供 `password`，新建用户默认密码为 123456（首次登录需修改）
6. **身份字段重复**: 如果组织配置了唯一性字段（如学号），导入时会先检查重复

---

## 试题导入

### CSV 格式

**第一行**：字段名称（固定列结构，不支持自定义）

**题头**:

```
type,content,optionA,optionB,optionC,optionD,standardAnswer,score,difficulty,tags,gradingRule.multiSelectScoring,gradingRule.fillBlankMatchMode
```

**单选题示例** (`single_choice`):

```
single_choice,下列哪个是质数？,2,3,5,7,B,5,3,数学 基础,all_correct_full,
single_choice,1+1=?,1,2,3,4,B,5,2,数学 基础,all_correct_full,
```

**多选题示例** (`multiple_choice`):

```
multiple_choice,哪些是质数？,2,3,5,7,"B,C",10,4,数学 基础,all_correct_full,
multiple_choice,2+2=?和3+3=?,,4,5,6,7,"A,D",10,3,数学 基础,partial_half,
```

**填空题示例** (`fill_blank`):

```
fill_blank,中国的首都是____,北京,,,,北京,5,3,地理 基础,exact,fillBlankCaseSensitive
fill_blank,水的化学式是____,第____周期主族元素是____,,,H2,O,10,4,化学 基础,keyword
```

**判断题示例** (`true_false`):

```
true_false,地球是圆的,,,true,10,2,常识 基础,
true_false,水是透明的,,,true,10,2,常识 基础,
```

### 字段说明

| 字段                                 | 必填       | 说明                                                                                               |
| ------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------- |
| `type`                               | 必填       | 题型：`single_choice`, `multiple_choice`, `fill_blank`, `true_false`                               |
| `content`                            | 必填       | 题目内容，填空题需包含 `____` 占位符                                                               |
| `optionA`                            | 选择题必填 | 选项 A 内容                                                                                        |
| `optionB`                            | 选择题必填 | 选项 B 内容                                                                                        |
| `optionC`                            | 选择题必填 | 选项 C 内容                                                                                        |
| `optionD`                            | 选择题必填 | 选项 D 内容                                                                                        |
| `standardAnswer`                     | 必填       | 正确答案：选择题用 option id (如 "A", "B" 或 "A,C")；填空题为文本；判断题为布尔值 (`true`/`false`) |
| `score`                              | 必填       | 分值，正整数                                                                                       |
| `difficulty`                         | 可选       | 难度 1-5，默认 3                                                                                   |
| `tags`                               | 可选       | 标签，逗号分隔                                                                                     |
| `gradingRule.multiSelectScoring`     | 可选       | 多选题评分：`all_correct_full`（全对才得分）或 `partial_half`（部分对得一半）                      |
| `gradingRule.fillBlankMatchMode`     | 可选       | 填空题匹配模式：`exact`（精确匹配）或 `keyword`（关键字匹配）                                      |
| `gradingRule.fillBlankCaseSensitive` | 可选       | 填空题是否区分大小写，默认 false                                                                   |

### 导入端点

**端点**: `POST /questions/import`

**请求体**:

```json
{
  "courseId": "course-uuid",
  "rows": [
    {
      "type": "single_choice",
      "content": "下列哪个是质数？",
      "optionA": "2",
      "optionB": "3",
      "optionC": "5",
      "optionD": "7",
      "standardAnswer": "B",
      "score": 5,
      "difficulty": 3,
      "tags": "数学 基础",
      "gradingRule": {
        "multiSelectScoring": "all_correct_full",
        "fillBlankMatchMode": "exact"
      }
    }
  ],
  "confirm": false
}
```

**参数说明**:

- `courseId`: 目标课程 ID
- `rows`: 题目行数组
- `confirm`: `true` 实际创建，`false` 仅验证

**响应** (200):

```json
{
  "total": 1,
  "valid": 1,
  "warnings": 0,
  "errors": 0,
  "details": [
    {
      "row": 1,
      "status": "valid"
    }
  ]
}
```

**错误响应**:

```json
{
  "total": 2,
  "valid": 1,
  "warnings": 0,
  "errors": 1,
  "details": [
    {
      "row": 1,
      "status": "valid"
    },
    {
      "row": 2,
      "status": "error",
      "message": "choice questions require at least two options"
    }
  ]
}
```

### 验证规则

1. **选项唯一性**: 选项 ID (A/B/C/D) 不能重复
2. **选择题至少2个选项**: `single_choice` 和 `multiple_choice` 必须包含 ≥2 个选项
3. **标准答案引用选项**: 单选题的 `standardAnswer` 必须是有效的 option id，多选题的 `standardAnswer` 必须是有效的 option id 数组
4. **填空题占位符**: 填空题内容必须包含至少一个 `____` 占位符
5. **判断题答案**: `standardAnswer` 必须是布尔值 (`true`/`false`)
6. **填空题答案非空**: `standardAnswer` 不能为空字符串
7. **正整数分值**: `score` 必须是正整数
8. **难度范围**: `difficulty` 必须是 1-5 的整数

---

## 成绩导出

### CSV 格式

**导出内容**: 某次考试的 all attempts 成绩（包括多次尝试的最终成绩）

**列结构**:

```
考生姓名,<field1>,<field2>,...,成绩,及格状态,尝试次数,提交时间
```

**示例 - 默认字段**:

```
考生姓名,学号,院系,年级,成绩,及格状态,尝试次数,提交时间
张三,20240001,计算机系,2024级,85,及格,1,2024-06-01T10:05:00.000Z
李四,20240002,软件工程,2024级,72,不及格,2,2024-06-01T10:08:00.000Z
```

**示例 - 自定义字段**:

```
考生姓名,工号,部门,职位,成绩,及格状态,尝试次数,提交时间
张三,1001,研发部,工程师,85,及格,1,2024-06-01T10:05:00.000Z
李四,1002,市场部,专员,72,不及格,2,2024-06-01T10:08:00.000Z
```

### 导出端点

**端点**: `GET /exams/:id/export/scores`

**权限**: Admin, SuperAdmin, Teacher

**响应**:

- Content-Type: `text/csv; charset=utf-8`
- Content-Disposition: `attachment; filename="scores-<exam-id>-<timestamp>.csv"`

### 字段说明

| 字段                | 说明                                                      |
| ------------------- | --------------------------------------------------------- |
| `考生姓名`          | Candidate 的 `name` 字段                                  |
| `field1, field2...` | 组织配置的 CandidateField 的所有字段，按 `sortOrder` 排序 |
| `成绩`              | 最终得分（number）                                        |
| `及格状态`          | "及格" 或 "不及格"                                        |
| `尝试次数`          | 累计考试次数（number）                                    |
| `提交时间`          | ISO 8601 格式日期时间字符串                               |

### 导出规则

1. **多尝试取最高分**: 如果同一考生参加了多次考试，导出其最终成绩（由 `scoreStrategy` 决定：`highest`/`latest`/`first`）
2. **动态列**: 列标题根据组织配置的 CandidateField 动态生成
3. **空值处理**: 自定义字段空值显示为空字符串
4. **时间格式**: ISO 8601 格式：`YYYY-MM-DDTHH:mm:ss.sssZ`
