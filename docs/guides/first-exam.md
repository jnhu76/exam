# First Exam Walkthrough (Admin)

> Audience: an operator/admin running Exam for the first time on an existing
> Standard deployment. Every route, button, and label below is taken from the
> shipped product at master `511e6e60` (release `v0.0.10`).
>
> **The web UI is Simplified Chinese only.** This guide quotes the Chinese
> labels you will actually see, with English glosses. A paired Simplified
> Chinese version is at
> [first-exam.zh-CN.md](first-exam.zh-CN.md).
>
> **Verification status:** `SOURCE_AND_EXISTING_TEST_EVIDENCE_ONLY` — steps
> were verified against source routes/components and the existing E2E specs;
> no human-admin browser trial was run for this guide.
>
> What this guide does **not** promise: that a successful submit protects
> answers against every kind of server disaster. See
> [Standard capabilities §5–§7](../product/standard-supported-capabilities.md#5-answer-save-semantics)
> for save semantics and fault domains before running a high-stakes exam.

## 0. Before you start

- A running deployment (next section) or an existing one.
- The deployment is **single-organization**: everything you create belongs to
  one internal organization.
- Backup is **your** responsibility as host operator (`scripts/db-backup.sh`,
  [runbook §17](../deployment/mvp-deployment-runbook.md)). The product has no
  automatic backup. Do not use `db:reset`/`down -v` against a deployment with
  real data — they destroy volumes.

## 1. Install and start

```bash
git clone https://github.com/jnhu76/exam.git && cd exam
node scripts/init-production-env.mjs     # creates .env.production — fill the required secrets
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps   # wait for web + app + db to be healthy
```

Full details, including offline image transfer and LAN addresses, are in
[INSTALL.md](../../INSTALL.md) and the
[deployment README](../deployment/README.md). If you remap the port or access
the host from the LAN, set `EXAM_PORT`, `CORS_ORIGIN`, and
`PUBLIC_WEB_ORIGIN` to the exact origin users will browse.

## 2. Check service health

Open `http://<your-host>:<EXAM_PORT>` — the nginx edge serves the app.
After an admin exists you can check:

- **系统监控** (System monitoring) at `/admin/system` — database status,
  CPU/memory, scanners.
- **运维总览** (Operations overview) at `/admin/operations`.
- From the host: `curl http://localhost/api/health` (liveness) and
  `curl http://localhost/api/ready` (readiness — PostgreSQL usable).

## 3. Initialize the first Admin

There is no public self-registration. Two supported paths:

```bash
docker compose --env-file .env.production exec app \
  node dist/scripts/bootstrap-admin.js \
  --username admin --password '<STRONG_PASSWORD>' \
  --name 'System Admin' --organization-name 'My Organization'
```

Or, if `LAUNCHPAD_SETUP_TOKEN` was set before first start, the guided
bootstrap at `/launchpad` (the token disables it when unset). Log in at
`/login` (登录) with the admin account.

## 4. Create a course (题库 → 课程管理)

Questions belong to courses, so create one first:

1. Sidebar: **题库 → 课程管理** (Question bank → Courses), route
   `/admin/courses`.
2. Click **新增课程** (Create course) and fill 课程名称 (name, required) and
   课程代码 (code, required); 描述 (description) is optional.

## 5. Create questions (题库 → 题目管理)

1. Sidebar: **题库 → 题目管理**, then the create route
   `/admin/questions/new` (新增题目).
2. Pick 所属课程 (course), 题目类型 (type). Five supported types:
   单选 (single choice), 多选 (multiple choice), 判断 (true/false),
   填空 (fill blank), 文本作答 (text response).
3. Enter 题目内容 (content; a Rich mode with math/table/code is available),
   选项/标准答案 (options / standard answer) as the type requires, and 分值
   (score).
4. For 文本作答 (text response): the 评分标准 (rubric) is **required** and is
   frozen into the exam at publish; it is what graders will see.

Bulk authoring: **题库 → 题目导入** (`/admin/questions/import`) takes a CSV
template. Note: imported questions are Plain-only (no Rich content), and a
text_response created via import still requires manual grading later.

## 6. Create the exam (考试 → 考试管理)

1. Sidebar: **考试 → 考试管理**, route `/admin/exams`; click the create
   action to open `/admin/exams/new` — a 5-step wizard:
   1. **基本信息**: 考试名称 (title, required) and 所属课程 (course,
      required); optional 策略模板 (policy profile) pre-fills step 2 by
      copy-on-apply.
   2. **考试策略**: 计时模式 timing mode — 定时窗口 `timed_window` /
      截止时间 `deadline` / 不限时 `untimed`; 考试时长 duration (timed
      window); 重考策略 retake policy (不限次数 / 限制次数 / 通过后停止);
      分数策略 score strategy (highest / latest / first); 成绩公布方式
      result publication — 交卷后立即公布 immediate / 评分完成后公布 after
      grading / 管理员手动公布 manual; 中断恢复策略 interruption policy
      (strict / bounded grace / operator incident).
   3. **题目与分数**: click **手动选题** to pick existing questions; 总分
      (total score) follows the question scores; 及格分 (passing score)
      defaults to 60%.
   4. **时间安排**: 开始时间 openAt / 结束时间 closeAt (hidden for 不限时).
   5. **检查并创建**: review, then **创建草稿** (Create draft).

The wizard creates a **draft**. Supported policies only: there is no
`timed_sync` activation, no random question selection, no exam clone.

## 7. Publish

Open the exam detail `/admin/exams/:id` and click **发布考试** (Publish).

> **Irreversibility:** publishing freezes the questions (content, options,
> answers, rubric) into a snapshot. Later question-bank edits do **not**
> affect this exam. Publishing itself is a single click without a
> confirmation dialog; while published (已发布, not yet open) you can
> **撤回发布** (unpublish) back to draft — that action asks for confirmation.
> Later lifecycle actions — 关闭 (close), 取消 (cancel), 归档 (archive) —
> also ask for confirmation.

## 8. Enroll candidates

1. Create candidate accounts first: sidebar **管理 → 考生管理**
   (`/admin/candidates`) — **新增考生** (create: username / password / name)
   or **导入** (bulk CSV with headers `username,password,name` plus any
   configured candidate fields). Candidates log in with username +
   password; there is no self-registration.
2. Back on the exam detail page, open the default **报考** (enrollment) tab,
   click **添加考生**, search and pick candidates (there is no CSV import for
   exam enrollment — enrollment is picker-only).

For non-admin staff (Teacher / Grader / Proctor) accounts, use
**管理 → 用户管理** (`/admin/users`): 新增用户 (create with role) or
邀请成员 (email invitation). Assignments, if needed: Teacher → Course and
Grader → Exam are managed from dialogs on the same users page; Proctor →
Exam is assigned from the recovery exam detail page (requires typing a user
ID).

## 9. Candidate: log in and start

1. Candidate logs in at `/login` and lands on `/exam/list`
   (可参加的考试 — exams you can take).
2. Open the exam card and click **开始考试** (start). If an attempt was
   interrupted earlier, the same card offers **继续考试** (continue).

## 10. Answer and understand the save indicator

The candidate answers questions on `/exam/:attemptId/take`. The top bar
shows the save indicator with exactly four states:

| Indicator | Meaning |
| --- | --- |
| 等待保存 (waiting) | Nothing pending to send right now. |
| 保存中… (saving) | A save request is in flight; outcome not yet known. |
| 已保存 (saved) | The server accepted this answer (`accepted: true` + version). |
| 保存失败 (save failed) | Not saved; the client retries automatically while the page is open. |

> **What "已保存" does not mean.** Saves are debounced by ~1.5 s; an edit
> made but not yet sent lives in memory only and **is lost if the browser
> refreshes before it is sent**. There is no durable offline draft and no
> offline exam mode. Keep a live connection for the whole attempt.

## 11. Submit

Click **交卷** (submit). The 确认交卷 dialog shows 题目总数 (questions),
未答题 (unanswered), 未保存 (unsaved), 保存失败 (save failed) counts. Confirm
with **确认交卷**. Submitting freezes the attempt — the server's
`submitted_answers` becomes the grading authority; no further edits are
possible.

## 12. Manual grading (only if the exam has text responses)

1. Sidebar: **考试 → 待评分** (`/admin/grading-queue`) lists attempts with
   待手动评分 (pending manual grading).
2. Open one: the grader sees 考生作答 (candidate answer), 参考答案
   (reference answer), and the frozen 评分标准 (rubric) per question.
3. Enter 分数 (score within max) and optional 评语 (comment), then
   **提交评分** (submit grading) — per-question grading is **irreversible**
   (评分提交后不可修改).
4. Objective questions were already auto-graded at submit.

Grading authority is exam-scoped for Grader accounts (they only see exams
they are assigned to; assignment via the users page).

## 13. Publish / view results

- 成绩公布方式 = immediate: candidates see results right after submit at
  `/exam/:attemptId/result` (考试成绩).
- = after grading: results become visible when manual grading completes.
- = manual: an admin opens the exam detail and clicks **发布成绩** (publish
  results) — a confirmed, write-once action. Candidates then see pass/fail
  against 及格线 and per-question detail.

Admins can inspect scores anytime under **考试 → 成绩查询**
(`/admin/results`) and export them.

## 14. If something goes wrong mid-exam

- **Candidate side:** refresh or reopen `/exam/list` and click **继续考试**
  (continue). The attempt's frozen snapshot is restored from the server.
  Heartbeat loss marks an attempt disrupted and surfaces it to staff.
- **Staff side:** the **恢复与处置 → 恢复审查** (Recovery review,
  `/admin/recovery`) and **监考处置** (`/admin/proctor/recovery`) consoles
  list disrupted attempts/incidents; admins can grant extra time from the
  dashboard (audited).
- **Server/container restart:** answers already acknowledged by the server
  ("已保存") survive app/PostgreSQL restart when the PostgreSQL data
  directory is intact. **Not covered:** a refresh before an edit was sent
  (lost), and a restore of an older backup (answers acknowledged after the
  backup point are gone from the restored database — backup/restore is the
  host operator's job; see [runbook §17](../deployment/mvp-deployment-runbook.md)).
  For the exact evidence boundaries, see
  [Standard capabilities §6](../product/standard-supported-capabilities.md#6-recovery-and-fault-domains).

## Known product gaps met during this walkthrough

None blocking: every step above completes with the shipped UI/API. Minor
gaps you will notice (documented, not workarounds here): the admission-queue
switch and Proctor→Exam assignment have no full-fledged picker UI; the UI is
zh-CN only; there is no English locale.
