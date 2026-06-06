# Mock 数据

## 概述

以下数据用于测试、演示和开发。所有 ID 使用固定 UUID 便于追溯。

---

## 考生数据 (Mock Candidates)

### 默认字段配置 - 大学场景

**字段配置** (`CandidateField`):

```
[
  {
    "id": "field-student-id",
    "name": "studentId",
    "label": "学号",
    "fieldType": "text",
    "required": true,
    "unique": true,
    "sortOrder": 0
  },
  {
    "id": "field-department",
    "name": "department",
    "label": "院系",
    "fieldType": "text",
    "required": true,
    "unique": false,
    "sortOrder": 1
  },
  {
    "id": "field-grade",
    "name": "grade",
    "label": "年级",
    "fieldType": "text",
    "required": true,
    "unique": false,
    "sortOrder": 2
  }
]
```

**CSV 数据** (`candidates_default.csv`):

```csv
学号,姓名,院系,年级
20240001,张三,计算机系,2024级
20240002,李四,软件工程,2024级
20240003,王五,信息安全,2023级
20240004,赵六,计算机科学,2024级
20240005,钱七,电子信息,2023级
20240006,孙八,计算机系统,2024级
20240009,周九,软件工程,2024级
20240010,吴十,信息安全,2023级
20240011,郑十一,计算机科学,2024级
20240012,王十二,电子工程,2024级
```

### 自定义字段配置 - 企业场景

**字段配置**:

```
[
  {
    "id": "field-employee-id",
    "name": "employeeId",
    "label": "工号",
    "fieldType": "text",
    "required": true,
    "unique": true,
    "sortOrder": 0
  },
  {
    "id": "field-department",
    "name": "department",
    "label": "部门",
    "fieldType": "text",
    "required": true,
    "unique": false,
    "sortOrder": 1
  },
  {
    "id": "field-position",
    "name": "position",
    "label": "职位",
    "fieldType": "text",
    "required": true,
    "unique": false,
    "sortOrder": 2
  }
]
```

**CSV 数据** (`candidates_enterprise.csv`):

```csv
工号,姓名,部门,职位
EMP001,张三,研发部,工程师
EMP002,李四,市场部,专员
EMP003,王五,设计部,设计师
EMP004,赵六,产品部,产品经理
EMP005,钱七,运营部,运营专员
EMP006,孙八,技术部,后端工程师
EMP007,周九,测试部,测试工程师
EMP008,吴十,人事部,人事专员
```

---

## 题目数据 (Mock Questions)

### 单选题 (single_choice)

**CSV 格式** (`questions_single_choice.csv`):

```csv
type,content,optionA,optionB,optionC,optionD,standardAnswer,score,difficulty,tags,gradingRule.multiSelectScoring
single_choice,下列哪个是质数？,2,3,5,7,B,5,3,数学 基础,all_correct_full
single_choice,1+1=?,1,2,3,4,B,5,2,数学 基础,all_correct_full
single_choice,一元等于多少分？,10,50,100,20,A,2,1,金融 基础,all_correct_full
single_choice,下列哪个是偶数？,2,3,5,8,A,5,2,数学 基础,all_correct_full
single_choice,程序的入口点是？,main,program,function,start,B,5,3,编程 基础,all_correct_full
single_choice,HTTP 状态码 404 表示？,请求未找到,禁止访问,权限不足,服务器错误,C,5,3,网络 基础,all_correct_full
single_choice,下列哪个不是关系型数据库？,MySQL,Oracle,Excel,HTML,D,5,3,数据库 基础,all_correct_full
single_choice,下列哪个是前端框架？,React,Vue,Angular,Django,Ember,A,5,3,前端 基础,all_correct_full
single_choice,下列哪个是 CSS 预处理器？,SASS,LESS,PostCSS,Stylus,C,5,3,前端 基础,all_correct_full
```

### 多选题 (multiple_choice)

**CSV 格式** (`questions_multiple_choice.csv`):

```csv
type,content,optionA,optionB,optionC,optionD,standardAnswer,score,difficulty,tags,gradingRule.multiSelectScoring
multiple_choice,哪些是质数？,2,3,5,7,"B,C",10,4,数学 基础,all_correct_full
multiple_choice,哪些是偶数？,2,4,6,8,"A,D",8,4,数学 基础,all_correct_full
multiple_choice,哪些是前端框架？,React,Vue,Angular,Django,Ember,"A,B",10,5,前端 基础,all_correct_full
multiple_choice,哪些是 CSS 预处理器？,SASS,LESS,PostCSS,Stylus,"C,E",10,5,前端 基础,all_correct_full
multiple_choice,2+2=?和3+3=?,4,6,"A,D",10,3,数学 基础,all_correct_full
multiple_choice,HTTP 状态码有哪些是成功的？,200,201,204,205,206,"A,B,C,D",5,3,网络 基础,all_correct_full
multiple_choice,哪些是关系型数据库？,MySQL,Oracle,PostgreSQL,MariaDB,SQLite,"A,C,D",8,4,数据库 基础,all_correct_full
multiple_choice,哪些属于函数式编程语言？,JavaScript,TypeScript,Haskell,Erlang,Lisp,"B,E",10,5,编程 基础,all_correct_full
multiple_choice,哪些属于 CSS 预处理器？,SASS,LESS,PostCSS,Stylus,MySass,"C,F",10,5,前端 基础,all_correct_full
```

### 填空题 (fill_blank)

**CSV 格式** (`questions_fill_blank.csv`):

```csv
type,content,standardAnswer,score,difficulty,tags,gradingRule.fillBlankMatchMode
fill_blank,中国的首都是____,北京,5,3,地理 基础,exact,fillBlankCaseSensitive
fill_blank,水的化学式是____,H2O,10,4,化学 基础,keyword
fill_blank,地球上最大的海洋是____,太平洋,5,3,地理 基础,keyword
fill_blank,HTTP 的默认端口是____,80,5,3,网络 基础,exact
fill_blank,数据的组织结构有____、层次、网络三种模型,层次,10,4,数据库 基础,exact
fill_blank,关系数据库中表之间的关联通过____实现,外键,5,3,数据库 基础,exact
fill_blank,面向对象的三大特性是封装、继承和____,多态,5,3,面向对象 基础,exact
fill_blank,JavaScript 中的 const 用于声明____,常量,10,3,JavaScript 基础,exact
fill_blank,Node.js 中用于异步 I/O 的回调模式已被____ 取代,Promise,10,4,Node.js 基础,exact
fill_blank,React 中用于管理组件状态的 Hook 是____,useState,10,3,React 基础,exact
fill_blank,RESTful API 中 POST 用于____数据,创建,10,3,RESTful API 基础,exact
fill_blank,JWT Token 存储在客户端的 ____ Cookie 中,HTTP-only,5,3,认证 基础,exact
```

### 判断题 (true_false)

**CSV 格式** (`questions_true_false.csv`):

```csv
type,content,standardAnswer,score,difficulty,tags
true_false,地球是圆的,true,10,2,常识 基础
true_false,水是透明的,true,10,2,常识 基础
true_false,太阳从东边升起,true,10,1,常识 基础
true_false,月亮绕着地球公转,false,10,3,常识 基础
true_false,一年有 365 天,true,10,1,常识 基础
true_false,HTTP 是无状态协议,true,5,2,网络 基础
true_false,SQL 是关系型数据库,true,5,3,数据库 基础
true_false,JavaScript 是单线程的,true,5,3,编程 基础
true_false,React 使用 Virtual DOM 优化渲染性能,true,5,3,前端 基础
true_false,Node.js 适合 I/O 密集型应用,true,5,3,Node.js 基础
true_false,Three.js 是 WebGL 框架,true,5,3,前端 基础
true_false,Vite 支持 HMR (热模块替换),true,5,3,前端 基础
true_false,PostgreSQL 支持 JSONB 类型,true,5,3,数据库 基础
true_false,AuthenticationToken 比 Session Cookie 更安全,true,5,3,认证 基础
true_false,Redis 可以用作消息队列,true,5,3,数据库 基础
true_false,GraphQL 是 API 查询语言,true,5,3,API 基础
```

---

## 考试数据 (Mock Exams)

### 基础考试 - 计算机基础

**考试配置**:

```json
{
  "title": "计算机基础考试",
  "courseId": "course-math-basic",
  "durationMinutes": 60,
  "openAt": "2024-06-01T09:00:00.000Z",
  "closeAt": "2024-06-01T11:00:00.000Z",
  "passingScore": 60,
  "totalScore": 100,
  "questionSelectionMode": "manual",
  "questionIds": [
    "q-tf-1",
    "q-tf-2",
    "q-tf-3",
    "q-tf-4",
    "q-tf-5",
    "q-sc-1",
    "q-sc-2",
    "q-sc-3",
    "q-sc-4",
    "q-sc-5",
    "q-mc-1",
    "q-mc-2",
    "q-mc-3",
    "q-mc-4"
  ],
  "controlFlags": {
    "shuffleQuestions": true,
    "shuffleOptions": true,
    "detectTabSwitch": true,
    "disableCopyPaste": true,
    "requireQueue": false,
    "batchSize": 10,
    "batchInterval": 3,
    "restrictIp": false,
    "requireLockdown": false,
    "showResultImmediately": true
  },
  "retakePolicy": "no-retake",
  "scoreStrategy": "highest",
  "maxAttempts": 1
}
```

**题目详情**:

```json
[
  {
    "id": "q-tf-1",
    "type": "true_false",
    "content": "地球是圆的",
    "standardAnswer": true,
    "score": 10
  },
  {
    "id": "q-tf-2",
    "type": "true_false",
    "content": "水是透明的",
    "standardAnswer": true,
    "score": 10
  },
  {
    "id": "q-tf-3",
    "type": "true_false",
    "content": "太阳从东边升起",
    "standardAnswer": true,
    "score": 10
  },
  {
    "id": "q-tf-4",
    "type": "true_false",
    "content": "HTTP 是无状态协议",
    "standardAnswer": true,
    "score": 5
  },
  {
    "id": "q-tf-5",
    "type": "true_false",
    "content": "JavaScript 是单线程的",
    "standardAnswer": true,
    "score": 5
  },
  {
    "id": "q-sc-1",
    "type": "single_choice",
    "content": "下列哪个是质数？",
    "options": [
      { "id": "A", "content": "2", "isCorrect": false },
      { "id": "B", "content": "3", "isCorrect": true },
      { "id": "C", "content": "5", "isCorrect": false },
      { "id": "D", "content": "7", "isCorrect": false }
    ],
    "standardAnswer": "B",
    "score": 5
  },
  {
    "id": "q-sc-2",
    "type": "single_choice",
    "content": "1+1=?",
    "options": [
      { "id": "A", "content": "1", "isCorrect": false },
      { "id": "B", "content": "2", "isCorrect": true },
      { "id": "C", "content": "3", "isCorrect": false },
      { "id": "D", "content": "4", "isCorrect": false }
    ],
    "standardAnswer": "B",
    "score": 5
  },
  {
    "id": "q-sc-3",
    "type": "single_choice",
    "content": "程序的入口点是？",
    "options": [
      { "id": "A", "content": "main", "isCorrect": false },
      { "id": "B", "content": "program", "isCorrect": true },
      { "id": "C", "content": "function", "isCorrect": false },
      { "id": "D", "content": "start", "isCorrect": false }
    ],
    "standardAnswer": "B",
    "score": 5
  },
  {
    "id": "q-sc-4",
    "type": "single_choice",
    "content": "HTTP 状态码 404 表示？",
    "options": [
      { "id": "A", "content": "请求未找到", "isCorrect": false },
      { "id": "B", "content": "禁止访问", "isCorrect": false },
      { "id": "C", "content": "权限不足", "isCorrect": false },
      { "id": "D", "content": "服务器错误", "isCorrect": true }
    ],
    "standardAnswer": "D",
    "score": 5
  },
  {
    "id": "q-sc-5",
    "type": "single_choice",
    "content": "下列哪个不是关系型数据库？",
    "options": [
      { "id": "A", "content": "MySQL", "isCorrect": false },
      { "id": "B", "content": "Oracle", "isCorrect": false },
      { "id": "C", "content": "Excel", "isCorrect": false },
      { "id": "D", "content": "HTML", "isCorrect": true }
    ],
    "standardAnswer": "D",
    "score": 5
  },
  {
    "id": "q-mc-1",
    "type": "multiple_choice",
    "content": "哪些是质数？",
    "options": [
      { "id": "A", "content": "2", "isCorrect": true },
      { "id": "B", "content": "3", "isCorrect": true },
      { "id": "C", "content": "5", "isCorrect": true },
      { "id": "D", "content": "7", "isCorrect": false }
    ],
    "standardAnswer": ["A", "B", "C"],
    "score": 10,
    "gradingRule": {
      "multiSelectScoring": "all_correct_full"
    }
  },
  {
    "id": "q-mc-2",
    "type": "multiple_choice",
    "content": "哪些是偶数？",
    "options": [
      { "id": "A", "content": "2", "isCorrect": true },
      { "id": "B", "content": "4", "isCorrect": true },
      { "id": "C", "content": "6", "isCorrect": true },
      { "id": "D", "content": "8", "isCorrect": true }
    ],
    "standardAnswer": ["A", "B", "C", "D"],
    "score": 10,
    "gradingRule": {
      "multiSelectScoring": "all_correct_full"
    }
  },
  {
    "id": "q-mc-3",
    "type": "multiple_choice",
    "content": "哪些是前端框架？",
    "options": [
      { "id": "A", "content": "React", "isCorrect": true },
      { "id": "B", "content": "Vue", "isCorrect": true },
      { "id": "C", "content": "Angular", "isCorrect": false },
      { "id": "D", "content": "Ember", "isCorrect": false }
    ],
    "standardAnswer": ["A", "B"],
    "score": 10,
    "gradingRule": {
      "multiSelectScoring": "all_correct_full"
    }
  },
  {
    "id": "q-mc-4",
    "type": "multiple_choice",
    "content": "2+2=?和3+3=?",
    "options": [
      { "id": "A", "content": "4", "isCorrect": true },
      { "id": "B", "content": "5", "isCorrect": false },
      { "id": "C", "content": "6", "isCorrect": true },
      { "id": "D", "content": "8", "isCorrect": false }
    ],
    "standardAnswer": ["A", "C"],
    "score": 10,
    "gradingRule": {
      "multiSelectScoring": "partial_half"
    }
  }
]
```

---

### 随机测验 - Python 基础

**考试配置**:

```json
{
  "title": "Python 基础测验",
  "courseId": "course-python-basic",
  "durationMinutes": 30,
  "openAt": "2024-06-01T14:00:00.000Z",
  "closeAt": "2024-06-01T14:30:00.000Z",
  "passingScore": 40,
  "totalScore": 50,
  "questionSelectionMode": "random",
  "controlFlags": {
    "shuffleQuestions": true,
    "shuffleOptions": true,
    "detectTabSwitch": true,
    "disableCopyPaste": true,
    "requireQueue": false,
    "batchSize": 10,
    "batchInterval": 3,
    "restrictIp": false,
    "requireLockdown": false,
    "showResultImmediately": true
  },
  "retakePolicy": "max_attempts",
  "scoreStrategy": "highest",
  "maxAttempts": 3
}
```

**题目池** (100 题，随机抽取 50 题):

```json
[
  {
    "id": "q-py-1",
    "type": "single_choice",
    "content": "Python 中用于定义函数的关键字是？",
    "options": [
      { "id": "A", "content": "def", "isCorrect": true },
      { "id": "B", "content": "function", "isCorrect": false },
      { "id": "C", "content": "function_", "isCorrect": false },
      { "id": "D", "content": "class", "isCorrect": false }
    ],
    "standardAnswer": "A",
    "score": 1,
    "difficulty": 2,
    "tags": ["Python", "基础", "关键字"]
  },
  {
    "id": "q-py-2",
    "type": "single_choice",
    "content": "Python 中哪个是正确的字符串前缀？",
    "options": [
      { "id": "A", "content": "\"", "isCorrect": true },
      { "id": "B", content": "'", "isCorrect": false },
      { "id": "C", "content": "\"\"\"", "isCorrect": false },
      { "id": "D", "content": "r\"\"", "isCorrect": false }
    ],
    "standardAnswer": "A",
    "score": 1,
    "difficulty": 2,
    "tags": ["Python", "基础", "字符串"]
  },
  {
    "id": "q-py-3",
    "type": "single_choice",
    "content": "Python 中哪个是正确的列表推导式？",
    "options": [
      { "id": "A", "content": "[]", "isCorrect": true },
      { "id": "B", content": "{}", "isCorrect": false },
      { "id": "C", "content": "()", "isCorrect": false },
      { "id": "D", "content": "()", "isCorrect": false }
    ],
    "standardAnswer": "A",
    "score": 1,
    "difficulty": 1,
    "tags": ["Python", "基础", "列表"]
  },
  {
    "id": "q-py-4",
    "type": "true_false",
    "content": "Python 使用缩进来表示代码块",
    "standardAnswer": true,
    "score": 2,
    "difficulty": 1,
    "tags": ["Python", "基础", "代码风格"]
  },
  {
    "id": "q-py-5",
    "type": "true_false",
    "content": "Python 的列表是可变的（mutable）",
    "standardAnswer": true,
    "score": 2,
    "difficulty": 2,
    "tags": ["Python", "基础", "数据结构"]
  }
]
```

---

### 开卷考试 - 综合测试

**考试配置**:

```json
{
  "title": "综合能力测试",
  "courseId": "course-comprehensive",
  "durationMinutes": 120,
  "openAt": "2024-06-15T09:00:00.000Z",
  "closeAt": "2024-06-15T13:00:00.000Z",
  "passingScore": 60,
  "totalScore": 200,
  "questionSelectionMode": "manual",
  "controlFlags": {
    "shuffleQuestions": true,
    "shuffleOptions": true,
    "detectTabSwitch": true,
    "disableCopyPaste": true,
    "requireQueue": true,
    "batchSize": 20,
    "batchInterval": 10,
    "restrictIp": false,
    "requireLockdown": false,
    "showResultImmediately": false
  },
  "retakePolicy": "max_attempts",
  "scoreStrategy": "highest",
  "maxAttempts": 2
}
```

**题目分布**:

- 判断题: 20 题 (每题 2 分)
- 单选题: 20 题 (每题 3 分)
- 多选题: 10 题 (每题 5 分)
- 填空题: 10 题 (每题 5 分)
- 总计: 200 分

**题目数据** (从前面混合使用，示例):

```json
{
  "id": "q-tf-1",
  "type": "true_false",
  "content": "地球是圆的",
  "standardAnswer": true,
  "score": 2
},
{
  "id": "q-sc-1",
  "type": "single_choice",
  "content": "下列哪个是质数？",
  "options": [
    { "id": "A", "content": "2", "isCorrect": false },
    { "id": "B", "content": "3", "isCorrect": true },
    { "id": "C", "content": "5", "isCorrect": false },
    { "id": "D", "content": "7", "isCorrect": false }
  ],
  "standardAnswer": "B",
  "score": 3
}
```

---

## 课程数据 (Mock Courses)

```json
[
  {
    "id": "course-math-basic",
    "name": "数学基础",
    "code": "MATH101",
    "description": "高等数学入门课程"
  },
  {
    "id": "course-python-basic",
    "name": "Python 基础",
    "code": "CS101",
    "description": "Python 编程语言入门"
  },
  {
    "id": "course-comprehensive",
    "name": "综合能力测试",
    "code": "COMP101",
    "description": "综合能力测试（前导课程）"
  }
]
```

---

## 用户数据 (Mock Users)

```json
[
  {
    "id": "user-admin",
    "username": "admin",
    "name": "管理员",
    "role": "SuperAdmin",
    "isActive": true,
    "organizationId": "org-default",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  {
    "id": "user-teacher",
    "username": "teacher",
    "name": "张老师",
    "role": "Teacher",
    "isActive": true,
    "organizationId": "org-default",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  {
    "id": "user-student01",
    "username": "20240001",
    "name": "张三",
    "role": "Candidate",
    "isActive": true,
    "organizationId": "org-default",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  {
    "id": "user-student02",
    "username": "20240002",
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

## 组织数据 (Mock Organization)

```json
{
  "id": "org-default",
  "name": "Default Organization",
  "displayName": "考试中心",
  "slug": "default",
  "productName": "考试平台",
  "productSubtitle": "可靠的内网考试系统",
  "footerText": "© 2024 某机构",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

---

## 试用数据组合

### 场景 1: 新建组织 + 批量导入 + 发布考试

1. 创建组织 → 获取 bootstrapToken
2. 配置 CandidateField（学号、姓名、院系、年级）
3. 下载模板 → 批量导入 10 名考生
4. 创建课程 "数学基础"
5. 导入 10 道基础数学题（CSV）
6. 创建考试 → 分配 10 道题
7. 发布考试 → 添加 10 名考生
8. 考生登录 → 参加考试 → 提交 → 查看成绩

### 场景 2: 现有组织 + 手动组卷 + 限制排队

1. 使用默认组织登录 (admin/admin123)
2. 创建 "Python 基础" 课程
   5 道题 (50 道题)
3. 创建考试 → 开启 `requireQueue` → `batchSize: 20`, `batchInterval: 30` 秒
4. 导入 200 名考生
5. 发布考试 → 添加所有考生
6. 考生登录 → 查看排队状态 → 分批进入考试（每批 20 人）

### 场景 3: 企业内训 — 自定义字段

1. 使用默认组织登录 (admin/admin123)
2. 配置 CandidateField（工号、姓名、部门、职位）
3. 批量导入 50 名员工
4. 创建 "Python 进阶" 课程
5. 导入 50 道 Python 题
6. 创建考试 → 开启严格模式（禁止复制粘贴、检测切屏）
7. 发布考试 → 添加所有员工
8. 员工登录 → 参加考试 → 提交 → 自动评分

### 场景 4: 开卷考试 — 综合能力测试

1. 使用默认组织登录 (admin/admin123)
2. 创建 "综合能力测试" 课程
3. 导入 100 道综合题（覆盖多个学科）
4. 创建考试 → 启用排队入场（batchSize: 50, batchInterval: 15 秒）
5. 批量导入 300 名学生
6. 发布考试 → 添加所有学生
7. 学生登录 → 查看排队状态 → 分批进入考试（每批 50 人）
8. 学生提交 → 导出成绩 CSV

---

## 成绩导出示例

### 导出 CSV - 基础数学考试

**考试 ID**: `exam-math-basic`

**CSV 输出** (`scores-exam-math-basic-1717252800000.csv`):

```
考生姓名,学号,院系,年级,成绩,及格状态,尝试次数,提交时间
张三,20240001,计算机系,2024级,95,及格,1,2024-06-01T10:05:00.000Z
李四,20240002,软件工程,2024级,88,及格,1,2024-06-01T10:08:00.000Z
王五,20240003,信息安全,2023级,72,不及格,1,2024-06-01T10:10:00.000Z
赵六,20240004,计算机科学,2024级,100,及格,1,2024-06-01T10:12:00.000Z
```

### 导出 CSV - 企业 Python 考试（包含重考成绩）

**考试 ID**: `exam-python-basic`

**CSV 输出**:

```
考生姓名,工号,部门,职位,成绩,及格状态,尝试次数,提交时间
张三,EMP001,研发部,工程师,92,及格,2,2024-06-01T14:05:00.000Z
李四,EMP002,市场部,专员,85,及格,3,2024-06-01T14:08:00.000Z
王五,EMP003,设计部,设计师,78,及格,2,2024-06-01T14:10:00.000Z
赵六,EMP004,产品部,产品经理,95,及格,1,2024-06-01T14:12:00.000Z
钱七,EMP005,运营部,运营专员,60,不及格,3,2024-06-01T14:15:00.000Z
```

---

## 使用说明

### 导入流程

1. **准备 CSV 文件**：使用 UTF-8 编码，正确设置列标题
2. **下载模板**: `GET /candidate-fields/template` 获取当前组织的字段模板
3. **验证模式**: `confirm: false` 仅验证不创建
4. **确认导入**: `confirm: true` 实际创建
5. **查看结果**: 检查 `valid`/`warnings`/`errors` 数量和详情

### 导出流程

1. **选择考试**: 从考试列表或详情页进入
2. **点击导出**: 下载 CSV 文件（自动命名为 `scores-<exam-id>-<timestamp>.csv`）
3. **本地打开**: 用 Excel/WPS 打开查看，中文支持良好
4. **分析数据**: 可以筛选、排序、计算统计

### 注意事项

1. **编码**: CSV 必须使用 UTF-8，否则中文会乱码
2. **日期格式**: 导出的提交时间是 ISO 8601 格式，Excel 可以直接识别
3. **多取最高分**: 导出的成绩是最终成绩，不是所有尝试的分数
4. **自定义字段**: 导出列标题根据组织配置动态生成
5. **大文件导出**: 支持 500+ 考生导出，无需分页
6. **导出记录**: 系统记录导出操作审计日志
