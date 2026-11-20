# G1-FIDELITY ① 浏览器轨迹证据（run `G1-FIDELITY-browser-r1-2026-11-19T1952`，本地 2026-11-20 03:52–03:54 CST）

总纲 G1.1：真实浏览器（仓库 Playwright chromium，`@exam/e2e` 依赖闭包，headless）经**实际
Nginx 入口** `http://127.0.0.1:8080` 跑两条考生轨迹，全量记录 HTTP 线缆行为，并对照研究库
`exam_550_e2e` 逐项对账。仅使用 fixture 已播种的 `timed_window` 考试（examId
`330d1242-8262-4631-9fb3-6d0dca741678`，`cap900 same-field S200`，12 题 true_false，
maxAttempts=1、duration 90min、passing 60）；DB 实测全部 11 场考试均为 timed_window，
**timed_sync 不存在且未被触碰**（未启用模式未被激活）。

本轮为独立复跑（上一轮 2026-11-19 r1 见 `archive-r1-20261119/`；本轮在 2026-11-20 03:46
topology reset 后的干净世代上执行，DB 起点 attempts=0/receipts=0/grading=0）。

## 文件索引

| 文件 | 内容 |
| --- | --- |
| `trace-a-happy-path.json` | 轨迹 A 全量记录：40 个请求（16 个 /api/）+ UI 事件 + 断言 + JWT claims（无 token 值） |
| `trace-b-refresh-recovery.json` | 轨迹 B 全量记录：62 个请求（17 个 /api/ + 1 次 SPA 文档 reload） |
| `replay-spec.json` | 回放规格：两条流 14+4 步模板（可参数化字段、依赖顺序、时序节拍）+ 实测 observedApiCalls + 7 条回放不变量 |
| `oracle.md` | DB 对账：精确 psql 命令 + 本轮实测输出（身份/会话、版本链、终态、评分） |
| `screenshots/*.png` | A：列表/take/结果；B：恢复/结果（无凭据画面） |
| `archive-r1-20261119/` | 上一轮（2026-11-19 世代）完整存档：traces/replay-spec/oracle/README/screenshots |

采集脚本：`harness/g1-fidelity-trace.ts`（复跑需先 `topology.sh reset` 重建库，
因 maxAttempts=1 且本轮两位考生 attempt 已终态 graded）。

## 复跑命令（cwd 任意）

```bash
# 前置：bash …/harness/topology.sh reset   # 重建研究库（name-guard）并重播种
pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
  /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/g1-fidelity-trace.ts
# 回放规格步骤模板以实测 wire 路径修正（一次性后处理）：
python3 …/harness/g1-replayspec-fix.py
```

时序单位备注：Playwright 1.61 `request.timing()` 实测返回 startTime=epoch-毫秒、
其余字段=相对毫秒（与官方文档的"秒"不符）；采集脚本已内置归一（epoch-ms 防御判定，
`g1-fidelity-trace.ts` requestfinished 处理器）。交叉验证：本轮 login POST wire
serverMs=90/94ms ↔ API 日志 responseTime 85.8/82.9ms（差值=nginx+回环 ~5–9ms），
start 62/64 ↔ 55.0/55.2，submit 86/94 ↔ 80.8/85.1 —— 单位与量级自洽。

## 轨迹摘要（实测，相对轨迹首请求）

**A（cap9same-c0000-de2c5a，attempt `433ce9a3-1e90-4ec0-890a-f5416bc29bbd`）**

| t (ms) | 事件 |
| --- | --- |
| 284/285 | GET /api/auth/me → 401（未登录探测）、GET /api/settings/branding → 200 |
| 413 | POST /api/auth/login → 200（wire serverMs 90；argon2 验密路径） |
| 525/528 | 登录跳转：GET /api/notifications/unread-count + GET /api/candidate/exams（并发） |
| 528–8635 | 等候：列表驻留 ≈8.1s，期间无轮询请求 |
| 8635 | GET /api/candidate/exams/{examId}（start 页详情） |
| 8718 | POST /api/attempts/{examId}/start → **201**（attempt 创建；wire 62/日志 55.0ms） |
| 8793 | GET /api/candidate/attempts/{attemptId}/take（题目快照/恢复） |
| 10485 | POST answers（check 后 ≈1.50s debounce）v1=true：clientSeq=1 baseVersion=0 → accepted serverVersion=1 |
| 12100 | **改答** v2=false：clientSeq=2 baseVersion=1 → accepted serverVersion=2 |
| 13786/18785 | POST /api/client-events（保存遥测批量，各 1 次） |
| 38795 | POST heartbeat（take 挂载 t+8793 后 **30002ms**，节拍=30s；响应 {ok,serverNow}） |
| 44269 | POST submit → 200（wire 86/日志 80.8ms；submission_reason=manual） |
| 44364/44457 | 结果页：GET …/take + GET /api/scores/attempts/{id}（并发） |

UI 断言 7/7 PASS：落地 /exam/list、两次保存 chip=已保存（wire accepted=true 且
serverVersion=1/2 递增）、结果 score=0 未通过。

**B（cap9same-c0001-c49935，attempt `e4a82b69-95b6-4b93-89a7-838eb5b8df0b`）**

| t (ms) | 事件 |
| --- | --- |
| 223/223/338 | auth/me(401) / branding / **login → 200**（wire 94/日志 82.9ms） |
| 449/449 | unread-count + candidate/exams |
| 585/671/750 | exam 详情 / start → 201 / take 恢复读取 |
| 2370 | POST answers v1=true → accepted serverVersion=1 |
| 2433 | **刷新**：SPA 文档 reload（GET /exam/{attemptId}/take） |
| 2439 | POST /api/client-events（exam_started 批量）→ **net::ERR_ABORTED**（reload 中止在途遥测；服务端未收到，业务不受影响） |
| 2499–2522 | auth/me(200，会话跨刷新续存) + branding + unread-count + take 恢复读取 |
| 2522 后 | 恢复校验：true-false-true radio 回显选中（服务端恢复值，断言 PASS，截图 b-1-restore） |
| 2737 | POST submit → 200（manual，wire 94/日志 85.1ms；恢复→交卷 ≈215ms）；结果 score=10 |

## DB 对账结论（详见 oracle.md，全部本轮实测）

- **身份与会话归属**：JWT claims.actorId（A `5eeac169…` / B `57ac09e2…`）= users.id；
  role=Candidate、auth_epoch=0；organizationId `673ed73e…` = organizations.id；audit
  login.success 各 1 行，actor/时间与线缆 login POST 逐一吻合（03:52:38.429 ↔ POST
  03:52:38.34；03:53:26.054 ↔ 03:53:25.97）；来源 IP=**172.28.10.1**（topology XFF 修正后，
  nginx $remote_addr=vpnkit 网关地址经受信代理覆盖写入穿透——与 topology.md 修正记录一致）。
  B 刷新后同一 auth-token cookie 通过 auth/me(200) 与 take(200) → 会话跨刷新续存。
- **答案版本链**（exam_answer_save_receipts）：A 两行（clientSeq 1→v1 true、2→v2 false，
  saved_at 03:52:48.427/03:52:50.045 ↔ 线缆 POST 03:52:48.417/03:52:50.032，差 ≤13ms）；
  B 一行（clientSeq 1→v1，28.008 ↔ 27.996）。两位考生同答 true 时 answer_identity 摘要
  相同（b5bea41b…）→ 内容寻址摘要；改答链 v1(true)→v2(false) 完整。
- **attempt 终态与提交原因**：双双 status=graded、submitted_at=graded_at（true_false 全
  自动评分瞬时）、submission_reason=manual、grading_status=auto_graded；A total 0/pass f、
  B total 10/pass f（及格线 60）——与 UI result-total-score 一致；started_at/submitted_at
  与线缆 start/submit POST 时刻差 ≤16ms；enrollment 1 行（maxAttempts=1 契约）。
- **评分工作集**：各 12 条 attempt_grading_entries（每冻结题恰好一条，auto/completed_auto）；
  A 的改答题 candidate_answer=**false**（最后接受版本 v2，非首版 true）、correct=f earned 0；
  B 同题 candidate_answer=true earned 10；question_snapshot 冻结 12 题；
  submitted_answers（schemaVersion 1）覆盖全部 12 题，A 非空值=false、B=true，其余 11 题 null。

## 脱敏断言（本轮归档实测）

> 归档派生副本说明：本行原文写出了合成口令字面量本身；归档 PR 中该字面量已替换为
> `<redacted-for-archive>`，原字节版本仅研究机保留（`evidence/g1-traces/README.md`）。

- `<redacted-for-archive>`（明文密码）：3 个 JSON 中 **0 次**；登录 body password 字段为 `<redacted>`。
- JWT 片段（`eyJ…`）：**0 次**；cookie/set-cookie/authorization 头值全部 `<redacted>`
  （A 17 处、B 18 处）。
- `auth-token=` 出现 5 次，全部为 replay-spec 的参数占位符 `${authCookie}`，无真实值。
- JWT 仅内存解码 payload 记录 claims（actorId/role/organizationId/authEpoch/iat/exp），
  token 本体不落盘；screenshots 无凭据画面。
