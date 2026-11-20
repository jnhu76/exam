#!/usr/bin/env python3
"""G1-FIDELITY：把 replay-spec.json 的步骤模板修正为实测 wire 路径（一次性）。

轨迹实测（trace-a/b）发现首版模板三处路径与真实浏览器行为不符：
  take 恢复读取   = GET /api/candidate/attempts/{attemptId}/take（非 /api/attempts/{id}）
  结果页读取      = GET /api/scores/attempts/{attemptId}（并发再读 take）
  保存后遥测批量  = POST /api/client-events
本脚本只改 flows.*.steps；observedApiCalls（来自实测 trace）保持不变。
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = os.path.join(HERE, "..", "evidence", "g1-traces", "replay-spec.json")

spec = json.load(open(SPEC))

A_STEPS = [
    {"id": "A1-session-probe", "when": "登录页加载（瞬时）", "method": "GET", "url": "${origin}/api/auth/me",
     "headersRole": {"accept": "application/json", "cookie": "（可无；未登录 → 401 预期）"}, "bodyTemplate": None,
     "responseContract": {"status": "401（未登录时）", "note": "会话探测；回放可省略"}, "dependsOn": []},
    {"id": "A2-branding", "when": "登录页加载（瞬时）", "method": "GET", "url": "${origin}/api/settings/branding",
     "headersRole": {"accept": "application/json"}, "bodyTemplate": None,
     "responseContract": {"status": 200}, "dependsOn": []},
    {"id": "A3-login", "when": "用户点击登录（瞬时）", "method": "POST", "url": "${origin}/api/auth/login",
     "headersRole": {"content-type": "application/json", "origin": "${origin}", "referer": "${origin}/login", "cookie": "（无需）"},
     "bodyTemplate": {"username": "${username}", "password": "${password}"},
     "responseContract": {"status": 200, "extract": {
         "authCookie": "set-cookie: auth-token=<jwt>（HttpOnly; SameSite=Strict; Max-Age=86400；后续所有请求携带；不落盘）",
         "userId": "body.id", "role": "body.role=Candidate"}},
     "dependsOn": []},
    {"id": "A4-list", "when": "登录跳转后页面加载（瞬时；与 unread-count 并发）", "method": "GET", "url": "${origin}/api/candidate/exams",
     "headersRole": {"accept": "application/json", "cookie": "auth-token=${authCookie}", "referer": "${origin}/exam/list"}, "bodyTemplate": None,
     "responseContract": {"status": 200, "extract": {"examId": "body[].id（card=exam-card-${examId}）"}}, "dependsOn": ["A3-login"]},
    {"id": "A5-notifications", "when": "同 A4（并发）", "method": "GET", "url": "${origin}/api/notifications/unread-count",
     "headersRole": "同 A4", "bodyTemplate": None, "responseContract": {"status": 200}, "dependsOn": ["A3-login"]},
    {"id": "A6-exam-detail", "when": "点击列表卡片 start（瞬时）", "method": "GET", "url": "${origin}/api/candidate/exams/${examId}",
     "headersRole": {"accept": "application/json", "cookie": "auth-token=${authCookie}", "referer": "${origin}/exam/list"}, "bodyTemplate": None,
     "responseContract": {"status": 200, "note": "start 页详情（enrollment/attempt 状态）"}, "dependsOn": ["A4-list"]},
    {"id": "A7-start-attempt", "when": "点击 exam-start-btn（瞬时）", "method": "POST", "url": "${origin}/api/attempts/${examId}/start",
     "headersRole": {"content-type": "application/json", "cookie": "auth-token=${authCookie}", "origin": "${origin}", "referer": "${origin}/exam/${examId}/start"},
     "bodyTemplate": {}, "responseContract": {"status": 201, "extract": {"attemptId": "body.id（startOrRestoreAttempt：已存在 in_progress attempt 则恢复返回）"}},
     "dependsOn": ["A6-exam-detail"]},
    {"id": "A8-take-restore", "when": "take 页挂载（紧跟 A7）", "method": "GET", "url": "${origin}/api/candidate/attempts/${attemptId}/take",
     "headersRole": {"accept": "application/json", "cookie": "auth-token=${authCookie}", "referer": "${origin}/exam/${attemptId}/take"}, "bodyTemplate": None,
     "responseContract": {"status": 200, "extract": {"questionId": "body.questions[0].id（首题；shuffleQuestions=false → 蓝图顺序）", "answers": "body.answers（恢复已有答案）"}},
     "dependsOn": ["A7-start-attempt"]},
    {"id": "A9-save-answer-v1", "when": "作答变更后 1500ms debounce（DEBOUNCE_MS，实测 check→POST ≈1.5s）", "method": "POST",
     "url": "${origin}/api/attempts/${attemptId}/answers/${questionId}",
     "headersRole": {"content-type": "application/json", "cookie": "auth-token=${authCookie}", "origin": "${origin}", "referer": "${origin}/exam/${attemptId}/take"},
     "bodyTemplate": {"attemptId": "${attemptId}", "questionId": "${questionId}", "answer": "${answerV1}", "clientSeq": 1, "clientSavedAt": "${iso8601-now}", "baseVersion": 0},
     "responseContract": {"status": 200, "extract": {"accepted": "body.accepted===true", "serverVersion": "body.serverVersion=1（→ 下一次 baseVersion）"}},
     "dependsOn": ["A8-take-restore"]},
    {"id": "A10-save-answer-v2-revise", "when": "改答变更后 1500ms debounce；clientSeq=2、baseVersion=A9.serverVersion=1", "method": "POST",
     "url": "${origin}/api/attempts/${attemptId}/answers/${questionId}",
     "headersRole": "同 A9",
     "bodyTemplate": {"attemptId": "${attemptId}", "questionId": "${questionId}", "answer": "${answerV2}", "clientSeq": 2, "clientSavedAt": "${iso8601-now}", "baseVersion": 1},
     "responseContract": {"status": 200, "extract": {"accepted": "true", "serverVersion": 2}}, "dependsOn": ["A9-save-answer-v1"]},
    {"id": "A11-client-events", "when": "每次保存 started/success 后批量上报（实测 save 后 ~1.6s）", "method": "POST", "url": "${origin}/api/client-events",
     "headersRole": "同 A9", "bodyTemplate": {"events": "${telemetry-batch（answer_autosave_started/success，携带 clientSeq 相关键）}"},
     "responseContract": {"status": 200}, "dependsOn": ["A9-save-answer-v1"]},
    {"id": "A12-heartbeat", "when": "take 页挂载起每 30000ms（实测 mount→heartbeat=30.001s）", "method": "POST",
     "url": "${origin}/api/attempts/${attemptId}/heartbeat", "headersRole": "同 A9（无 body）", "bodyTemplate": None,
     "responseContract": {"status": 200, "note": "连续失败进入断连态；恢复后重基准服务端时钟"}, "dependsOn": ["A8-take-restore"]},
    {"id": "A13-submit", "when": "用户点击交卷并确认（瞬时；提交前 flush 未落盘保存）", "method": "POST", "url": "${origin}/api/attempts/${attemptId}/submit",
     "headersRole": "同 A9", "bodyTemplate": {},
     "responseContract": {"status": 200, "extract": {"status": "body.status（submitted/graded）", "grading": "结果含评分（resultPublicationMode=immediate）"}},
     "dependsOn": ["A10-save-answer-v2-revise"]},
    {"id": "A14-result-read", "when": "跳转 /result 后页面加载（两条并发）", "method": "GET",
     "url": "${origin}/api/scores/attempts/${attemptId} + GET ${origin}/api/candidate/attempts/${attemptId}/take",
     "headersRole": "同 A9（referer=${origin}/exam/${attemptId}/result）", "bodyTemplate": None,
     "responseContract": {"status": 200, "extract": {"totalScore": "body（scores）；UI testid=result-total-score"}},
     "dependsOn": ["A13-submit"]},
]

B_STEPS = [
    {"id": "B1-B6", "when": "同 A1–A10（换 ${username}=第二名考生；maxAttempts=1 → 每轨迹独立考生；本轨迹只作答一次）",
     "method": "—", "url": "见 A1–A10（A9 保存 v1 后即进入刷新）", "headersRole": "同 A", "bodyTemplate": None,
     "responseContract": None, "dependsOn": ["A-flow"]},
    {"id": "B7-refresh-reload", "when": "保存确认后用户刷新（page.reload / 断线重连）",
     "method": "GET",
     "url": "${origin}/exam/${attemptId}/take（SPA 文档）→ GET ${origin}/api/auth/me + GET ${origin}/api/settings/branding + GET ${origin}/api/notifications/unread-count + GET ${origin}/api/candidate/attempts/${attemptId}/take",
     "headersRole": "同 A8（cookie 保持 → 会话跨刷新续存）", "bodyTemplate": None,
     "responseContract": {"status": 200, "extract": {"restoredAnswer": "body.answers[questionId] —— UI 回显为 radio checked（实测 true-false-true 恢复选中）"}},
     "dependsOn": ["B6（=A9 保存 v1）"]},
    {"id": "B8-submit-after-recovery", "when": "恢复确认后用户交卷（瞬时，实测恢复→submit ~170ms）", "method": "POST",
     "url": "${origin}/api/attempts/${attemptId}/submit", "headersRole": "同 A13", "bodyTemplate": {},
     "responseContract": {"status": 200, "note": "提交的服务端答案集合=最后接受版本（B6 的 v1=true）；结果 score=10/120"},
     "dependsOn": ["B7-refresh-reload"]},
    {"id": "B9-result-read", "when": "同 A14", "method": "GET",
     "url": "${origin}/api/scores/attempts/${attemptId} + GET ${origin}/api/candidate/attempts/${attemptId}/take",
     "headersRole": "同 A14", "bodyTemplate": None, "responseContract": {"status": 200}, "dependsOn": ["B8-submit-after-recovery"]},
]

spec["flows"]["A-happy-path"]["steps"] = A_STEPS
spec["flows"]["B-refresh-recovery"]["steps"] = B_STEPS
json.dump(spec, open(SPEC, "w"), ensure_ascii=False, indent=2)
print("replay-spec.json steps updated:", len(A_STEPS), "A steps,", len(B_STEPS), "B steps")
