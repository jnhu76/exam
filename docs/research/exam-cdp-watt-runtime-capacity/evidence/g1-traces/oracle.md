# G1-FIDELITY ① DB 对账证据（oracle）— run `G1-FIDELITY-browser-r1-2026-11-19T1952`

运行时刻：2026-11-20 03:52–03:54 CST。数据库：`exam_550_e2e`（研究库，name-guard 前缀
`exam_550`，容器 `exam-dev-db-1`，由 harness topology.sh 于 03:46 重建并播种——本轮
轨迹执行前实测 `attempts=0 admissions=0 receipts=0 grading=0`）。AGENTS.md §6 四步：
生命周期所有者=研究 harness（topology.sh/seed-capacity.ts）；API 进程 pid 2232454
env `DATABASE_URL=postgres://…@127.0.0.1:5432/exam_550_e2e`；`SELECT current_database()`
=exam_550_e2e；名称守卫满足（topology.md §数据库身份）。

以下全部为本轮实测输出（`docker exec exam-dev-db-1 psql -U exam -d exam_550_e2e`）。

## 1. 身份与会话归属

```sql
SELECT u.id, u.username, u.name, u.auth_epoch, string_agg(r.role,',') AS roles
FROM users u LEFT JOIN user_role_assignments r ON r.user_id=u.id
WHERE u.username IN ('cap9same-c0000-de2c5a','cap9same-c0001-c49935')
GROUP BY u.id, u.username, u.name, u.auth_epoch;
```

```
 57ac09e2-316c-4226-9daf-f6a66845ded6 | cap9same-c0001-c49935 | Candidate cap9same-c00 | 0 | Candidate
 5eeac169-82eb-4204-8ec6-4ac78906fee7 | cap9same-c0000-de2c5a | Candidate cap9same-c00 | 0 | Candidate
```

```sql
SELECT id FROM organizations WHERE id='673ed73e-d79f-4879-af16-c30e77aaa261';   -- 1 行
SELECT actor_id, action, ip_address, left(user_agent,50) AS ua, created_at
FROM audit_logs WHERE action='login.success' AND created_at > '2026-11-20 03:50:00+08'
ORDER BY created_at;
```

```
 5eeac169-82eb-4204-8ec6-4ac78906fee7 | login.success | 172.28.10.1 | Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 | 2026-11-20 03:52:38.429102+08
 57ac09e2-316c-4226-9daf-f6a66845ded6 | login.success | 172.28.10.1 | Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 | 2026-11-20 03:53:26.054221+08
```

对账：trace A `sessionClaims`={actorId `5eeac169-…`, role Candidate, organizationId
`673ed73e-…`, authEpoch 0, iat 1795117958, exp 1795204358}；trace B={actorId
`57ac09e2-…`, 同 org, authEpoch 0}。claims.actorId 与 users.id **逐字节相等**；org 行
存在。审计两行 actor_id、时间（03:52:38.429 ↔ 线缆 login POST 完成 03:52:38.4；03:53:26.054
↔ 03:53:26.0）吻合。来源 IP=172.28.10.1：topology XFF 修正（TRUSTED_PROXY_CIDRS 含
127.0.0.1 vpnkit 回环跳）后，nginx `$remote_addr`=vpnkit 网关地址被 Fastify 采信——与
topology.md「XFF/request.ip 基线观察」修正记录一致（上一轮 r1 记录的 127.0.0.1 是修正前
的坍缩值）。auth_epoch=0 → 会话无吊销；轨迹 B 刷新后同一 auth-token cookie 通过
`GET /api/auth/me`→200 与 `GET /api/candidate/attempts/{id}/take`→200（trace B t+2499/2522）
→ **会话跨刷新续存，且 take 数据归属同一 attempt/candidate**。

## 2. 答案版本链（exam_answer_save_receipts）

```sql
SELECT r.attempt_id, u.username, r.question_id, r.client_seq, r.accepted_version,
       left(r.answer_identity,12) AS answer_digest12, r.saved_at
FROM exam_answer_save_receipts r
JOIN exam_attempts a ON a.id=r.attempt_id
JOIN candidate_profiles cp ON cp.id=a.candidate_id JOIN users u ON u.id=cp.user_id
ORDER BY r.attempt_id, r.client_seq;
```

```
 433ce9a3-…f5416bc29bbd | cap9same-c0000-de2c5a | 7b618d55-…90a4cd | 1 | 1 | b5bea41b6c62 | 2026-11-20 03:52:48.427+08
 433ce9a3-…f5416bc29bbd | cap9same-c0000-de2c5a | 7b618d55-…90a4cd | 2 | 2 | fcbcf165908d | 2026-11-20 03:52:50.045+08
 e4a82b69-…838eb5b8df0b | cap9same-c0001-c49935 | 7b618d55-…90a4cd | 1 | 1 | b5bea41b6c62 | 2026-11-20 03:53:28.008+08
```

对账：轨迹 A 线缆两次 POST（t+10485/t+12100ms，body `clientSeq=1,baseVersion=0,answer=true`
与 `clientSeq=2,baseVersion=1,answer=false`，响应 accepted serverVersion=1/2）与 DB 两行
一一对应（saved_at 03:52:48.427/03:52:50.045 ↔ API 日志 POST 完成 03:52:48.417/03:52:50.032，
差 ≤13ms）；轨迹 B 一次 POST（t+2370ms）↔ 行（03:53:28.008 ↔ 日志 03:53:27.996）。两位
考生同答 true 时 answer_identity 前 12 位相同（b5bea41b6c62）→ 内容寻址摘要。改答链
v1(true)→v2(false) 完整，clientSeq 与 accepted_version 同步递增。

## 3. attempt 终态与提交原因（exam_attempts）

```sql
SELECT a.id, u.username, a.attempt_no, a.status, a.started_at, a.deadline_at,
       a.submitted_at, a.graded_at, a.submission_reason, a.grading_status,
       a.total_score, a.passed, jsonb_array_length(a.question_snapshot) AS frozen_qs,
       (SELECT count(*) FROM exam_enrollments e WHERE e.exam_id=a.exam_id AND e.candidate_id=a.candidate_id) AS enroll_rows
FROM exam_attempts a JOIN candidate_profiles cp ON cp.id=a.candidate_id
JOIN users u ON u.id=cp.user_id
WHERE a.id IN ('433ce9a3-1e90-4ec0-890a-f5416bc29bbd','e4a82b69-95b6-4b93-89a7-838eb5b8df0b');
```

```
 433ce9a3-… | cap9same-c0000-de2c5a | 1 | graded | 03:52:46.663 | 05:22:46.663(+90m) | 03:53:22.211 | 03:53:22.211 | manual | auto_graded |  0 | f | 12 | 1
 e4a82b69-… | cap9same-c0001-c49935 | 1 | graded | 03:53:26.315 | 05:23:26.315(+90m) | 03:53:28.377 | 03:53:28.377 | manual | auto_graded | 10 | f | 12 | 1
```

对账（时间均为 +08）：started_at ↔ POST /start 201（API 日志 03:52:46.647 / 03:53:26.300，
差 ≤16ms）；submitted_at ↔ POST /submit 200（03:53:22.198 / 03:53:28.364，差 ≤13ms）；
graded_at=submitted_at（true_false 全自动评分，事务内完成）；deadline=started+90min；
submission_reason=**manual**（两条轨迹均为考生点击交卷，非 scanner/到点）；
grading_status=auto_graded；enrollment 1 行（maxAttempts=1）；passed=f（total 0/10 <
passing 60）与 UI result-total-score（A=0 未通过、B=10）一致。

## 4. 评分工作集（attempt_grading_entries + submitted_answers + 快照）

```sql
SELECT r.attempt_id, count(*) AS entries, count(*) FILTER (WHERE r.correct) AS correct_n,
       sum(r.earned_score) AS earned_sum, max(r.max_score) AS q_max,
       string_agg(DISTINCT r.grading_mode,',') AS modes, string_agg(DISTINCT r.status,',') AS statuses
FROM attempt_grading_entries r
WHERE r.attempt_id IN ('433ce9a3-…','e4a82b69-…') GROUP BY r.attempt_id;
```

```
 433ce9a3-… | 12 | 0 |  0 | 10 | auto | completed_auto
 e4a82b69-… | 12 | 1 | 10 | 10 | auto | completed_auto
```

```sql
-- 改答题（7b618d55-…）评分行：以最后接受版本评分，非首版
SELECT g.attempt_id, g.candidate_answer, g.standard_answer, g.correct, g.earned_score, g.max_score
FROM attempt_grading_entries g
WHERE g.question_id='7b618d55-dfc2-4da8-bba1-4a19fd90a4cd'
  AND g.attempt_id IN ('433ce9a3-…','e4a82b69-…');
```

```
 433ce9a3-… | false | true | f |  0 | 10
 e4a82b69-… | true  | true | t | 10 | 10
```

```sql
SELECT a.id, a.submitted_answers->>'schemaVersion' AS schema,
  jsonb_array_length(a.submitted_answers->'answers') AS n_answers,
  (SELECT count(*) FROM jsonb_array_elements(a.submitted_answers->'answers') x WHERE x->>'value' IS NOT NULL) AS non_null,
  (SELECT string_agg(x->>'value',',') FROM jsonb_array_elements(a.submitted_answers->'answers') x WHERE x->>'value' IS NOT NULL) AS vals
FROM exam_attempts a WHERE a.id IN ('433ce9a3-…','e4a82b69-…');
```

```
 433ce9a3-… | 1 | 12 | 1 | false
 e4a82b69-… | 1 | 12 | 1 | true
```

结论：每冻结题（question_snapshot=12）恰好一条 grading entry；A 改答后以**最后接受版本**
（v2=false）进入评分与 submitted_answers（非首版 true）；B 为 v1=true；未答 11 题 value=null
仍占位。earned_sum（0/10）= total_score = UI 分数；评分模式全 auto/completed_auto。

## 5. 线缆 ↔ 服务器时间交叉验证（harness/logs/api.log，本轮窗口 03:52–03:53）

```
03:52:38.342 POST /api/auth/login                        200 85.8ms   （A；wire serverMs 90）
03:52:46.647 POST /api/attempts/:examId/start            201 55.0ms   （A；wire 62）
03:52:48.417 POST /api/attempts/:attemptId/answers/:qid  200 53.8ms   （A v1；↔ receipt 48.427）
03:52:50.032 POST /api/attempts/:attemptId/answers/:qid  200 47.0ms   （A v2；↔ receipt 50.045）
03:53:16.725 POST /api/attempts/:attemptId/heartbeat     200 16.9ms   （A；take 挂载→此 =30002ms）
03:53:22.198 POST /api/attempts/:attemptId/submit        200 80.8ms   （A；wire 86；↔ submitted_at 22.211）
03:53:25.970 POST /api/auth/login                        200 82.9ms   （B；wire 94）
03:53:26.300 POST /api/attempts/:examId/start            201 55.2ms   （B；wire 64；↔ started_at 26.315）
03:53:27.996 POST /api/attempts/:attemptId/answers/:qid  200 44.5ms   （B v1；↔ receipt 28.008）
03:53:28.364 POST /api/attempts/:attemptId/submit        200 85.1ms   （B；wire 94；↔ submitted_at 28.377）
```

wire serverMs ≈ API responseTime + 5–9ms（nginx 反代 + 回环），单位与因果链自洽；
DB 写入时刻（receipts/started_at/submitted_at）全部落在对应服务器响应完成 ≤16ms 内。
