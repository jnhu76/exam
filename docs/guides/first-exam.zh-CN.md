# 首场考试操作指南（管理员）

> 读者：第一次在已有 Standard 部署上组织考试的运维 / 管理员。以下所有
> 路由、按钮与界面文案均取自 master `511e6e60`（release `v0.0.10`）的
> 实际产品。
>
> **产品 Web UI 目前仅有简体中文。**本指南直接引用你将看到的中文文案。
> 英文对照版见 [first-exam.md](first-exam.md)。
>
> **验证状态：** `SOURCE_AND_EXISTING_TEST_EVIDENCE_ONLY` —— 各步骤依据
> 源码路由 / 组件与既有 E2E 规格核对；本指南未进行真实管理员浏览器试用。
>
> 本指南**不**承诺：交卷成功即意味着答案在任何服务器灾难下都不丢。在组织
> 高利害考试前，请先阅读
> [Standard 能力说明 §5–§7](../product/standard-supported-capabilities.zh-CN.md#5-答案保存语义)
> 的保存语义与故障域。

## 0. 开始之前

- 一个已运行的部署（见下一节），或既有部署。
- 部署是**单组织**的：你创建的一切都归属同一个内部组织。
- 备份是 Host Operator（部署方）**你自己的**责任
  （`scripts/db-backup.sh`，[runbook §17](../deployment/mvp-deployment-runbook.md)）。
  产品没有自动备份。不要对含真实数据的部署执行 `db:reset` / `down -v`
  ——它们会删除数据卷。

## 1. 安装并启动

```bash
git clone https://github.com/jnhu76/exam.git && cd exam
node scripts/init-production-env.mjs     # 生成 .env.production —— 填写必填密钥
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps   # 等待 web + app + db 全部 healthy
```

完整细节（含离线镜像传输、局域网地址）见
[INSTALL.zh-CN.md](../../INSTALL.zh-CN.md) 与
[部署说明](../deployment/README.md)。如果重映射端口或从局域网访问主机，
请把 `EXAM_PORT`、`CORS_ORIGIN`、`PUBLIC_WEB_ORIGIN` 设置为用户实际浏览
的准确地址。

## 2. 检查服务健康

打开 `http://<你的主机>:<EXAM_PORT>` —— nginx 边缘即产品入口。管理员就绪
后可以检查：

- **系统监控** `/admin/system` —— 数据库状态、CPU / 内存、scanner。
- **运维总览** `/admin/operations`。
- 在主机上：`curl http://localhost/api/health`（存活）与
  `curl http://localhost/api/ready`（就绪——PostgreSQL 可用）。

## 3. 初始化第一个 Admin

系统没有公开自助注册。两条受支持路径：

```bash
docker compose --env-file .env.production exec app \
  node dist/scripts/bootstrap-admin.js \
  --username admin --password '<STRONG_PASSWORD>' \
  --name 'System Admin' --organization-name 'My Organization'
```

或在首次启动前设置了 `LAUNCHPAD_SETUP_TOKEN` 时，使用 `/launchpad` 的引导
初始化（未设置该变量时 launchpad 是禁用的）。然后用 admin 账号在
`/login`（登录）进入系统。

## 4. 创建课程（题库 → 课程管理）

题目必须归属课程，先建课程：

1. 侧边栏：**题库 → 课程管理**，路由 `/admin/courses`。
2. 点击 **新增课程**，填写课程名称（必填）与课程代码（必填）；描述可选。

## 5. 新建题目（题库 → 题目管理）

1. 侧边栏：**题库 → 题目管理**，进入新建页 `/admin/questions/new`
   （新增题目）。
2. 选择所属课程与题目类型。支持五种：单选、多选、判断、填空、文本作答。
3. 填写题目内容（可选 Rich 模式，支持公式 / 表格 / 代码），按题型填写
   选项 / 标准答案，以及分值。
4. 文本作答题：**评分标准（rubric）必填**，发布时会冻结进考试，评卷人所
   看到的就是它。

批量出题：**题库 → 题目导入**（`/admin/questions/import`）使用 CSV 模板。
注意：导入的题目仅支持 Plain 内容（无 Rich），且通过导入创建的
text_response 之后同样需要人工评分。

## 6. 创建考试（考试 → 考试管理）

1. 侧边栏：**考试 → 考试管理**，路由 `/admin/exams`；点击新建进入
   `/admin/exams/new` —— 五步向导：
   1. **基本信息**：考试名称（必填）与所属课程（必填）；可选策略模板
      （profile），按 copy-on-apply 预填第 2 步。
   2. **考试策略**：计时模式 —— 定时窗口 `timed_window` / 截止时间
      `deadline` / 不限时 `untimed`；考试时长（定时窗口）；重考策略
      （不限次数 / 限制次数 / 通过后停止）；分数策略（最高 / 最新 /
      首次）；成绩公布方式 —— 交卷后立即公布 / 评分完成后公布 / 管理员
      手动公布；中断恢复策略（strict / bounded grace / operator incident）。
   3. **题目与分数**：点击**手动选题**挑选已有题目；总分随题目分值计算；
      及格分默认 60%。
   4. **时间安排**：开始时间 / 结束时间（不限时无此字段）。
   5. **检查并创建**：核对后点击**创建草稿**。

向导创建的是**草稿**。仅支持已交付的策略：没有 `timed_sync` 启用、没有
随机抽题、没有考试复制。

## 7. 发布

打开考试详情 `/admin/exams/:id`，点击**发布考试**。

> **不可逆性：** 发布会把题目（内容、选项、答案、rubric）冻结成快照。
> 之后对题库的修改**不会**影响这场考试。发布本身是单击、无确认对话框；
> 在"已发布"（尚未开放）状态可以**撤回发布**回到草稿——该操作有确认
> 对话框。后续生命周期操作——关闭、取消、归档——同样有确认对话框。

## 8. 报名考生（Enrollment）

1. 先建考生账号：侧边栏 **管理 → 考生管理**（`/admin/candidates`）——
   **新增考生**（用户名 / 密码 / 姓名）或**导入**（批量 CSV，表头
   `username,password,name` 加已配置的考生字段）。考生用用户名 + 密码
   登录；没有自助注册。
2. 回到考试详情页，默认**报考**页签中点击**添加考生**，搜索并勾选考生
   （考试报名没有 CSV 批量导入——只能通过选择器添加）。

非管理岗员工（Teacher / Grader / Proctor）账号在 **管理 → 用户管理**
（`/admin/users`）：新增用户（含角色）或邀请成员（邮件邀请）。如需指派：
Teacher → 课程与 Grader → 考试在同一用户页的对话框中管理；Proctor → 考试
在恢复考试详情页指派（需要手动输入用户 ID）。

## 9. 考生：登录并开始

1. 考生在 `/login` 登录后落在 `/exam/list`（可参加的考试）。
2. 打开考试卡片点击**开始考试**。若此前有过中断，同一张卡片会显示
   **继续考试**。

## 10. 作答并理解保存指示器

考生在 `/exam/:attemptId/take` 作答。顶栏保存指示器恰好四种状态：

| 指示器 | 含义 |
| --- | --- |
| 等待保存 | 当前没有待发送的内容。 |
| 保存中… | 保存请求在途；结果未知。 |
| 已保存 | 服务器已接受该答案（`accepted: true` + 版本号）。 |
| 保存失败 | 未保存；页面打开期间客户端会自动重试。 |

> **"已保存"不意味着什么。** 保存有约 1.5 秒防抖；已输入但尚未发送的
> 编辑仅存于内存，**发送前刷新浏览器会丢失**。产品没有持久化离线草稿，
> 也没有离线考试模式。整个作答期间请保持与服务器的连接。

## 11. 交卷

点击**交卷**。确认交卷对话框会显示题目总数、未答题、未保存、保存失败
计数，确认后点击**确认交卷**。提交会冻结 attempt——服务器的
`submitted_answers` 成为评分权威；此后不能再修改答案。

## 12. 人工评分（仅当本场含文本作答题）

1. 侧边栏：**考试 → 待评分**（`/admin/grading-queue`）列出待手动评分的
   attempt。
2. 打开一条：阅卷人看到考生作答、参考答案，以及每题冻结的评分标准
   （rubric）。
3. 填写分数（不超过满分）与可选评语，点击**提交评分**——逐题评分
   **不可撤销**（评分提交后不可修改）。
4. 客观题在提交时已自动评分完成。

Grader 账号的评分权限按考试指派（只能看到被指派的考试；指派在用户页
管理）。

## 13. 公布 / 查看成绩

- 成绩公布方式 = 交卷后立即公布：考生交卷后在
  `/exam/:attemptId/result`（考试成绩）立即看到结果。
- = 评分完成后公布：人工评分完成后可见。
- = 管理员手动公布：管理员打开考试详情，点击**发布成绩**（有确认框，
  一次性写入）。考生随后可见相对及格线的通过 / 未通过与逐题明细。

管理员随时可在 **考试 → 成绩查询**（`/admin/results`）查看并导出成绩。

## 14. 考试中断时怎么办

- **考生侧：** 刷新或重新打开 `/exam/list`，点击**继续考试**。attempt 的
  冻结快照会从服务器恢复。心跳超时会将 attempt 标记为中断并呈现给
  工作人员。
- **工作人员侧：** **恢复与处置 → 恢复审查**（`/admin/recovery`）与
  **监考处置**（`/admin/proctor/recovery`）控制台列出异常 attempt /
  incident；管理员可在仪表盘上补偿考试时间（有审计）。
- **服务器 / 容器重启：** 只要 PostgreSQL 数据目录完好，服务器已确认的
  答案（"已保存"）在 app / PostgreSQL 重启后保留。**不覆盖：** 发送前的
  刷新（会丢失），以及恢复较旧备份（备份点之后服务器确认的答案在恢复后
  的数据库中不存在——备份 / 恢复是 Host Operator 的责任，见
  [runbook §17](../deployment/mvp-deployment-runbook.md)）。精确证据边界见
  [Standard 能力说明 §6](../product/standard-supported-capabilities.zh-CN.md#6-恢复与故障域)。

## 本指南流程中遇到的产品缺口

无阻塞：以上每一步都可以用已交付的 UI / API 完成。你会注意到的小缺口
（已如实记录，本指南不做绕过）：准入队列开关与 Proctor → 考试指派没有
完整的 picker UI；界面仅简体中文；没有英文界面。
