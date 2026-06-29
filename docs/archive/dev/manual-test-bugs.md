# Manual Test Bugs

Bugs discovered during manual testing of the demo seed dataset and their fixes.

| ID | Page | Priority | Status |
|---|---|---|---|
| BUG-01 | /admin/exams/:examId/scores | P0 | Open |
| BUG-02 | Candidate take exam (fill blank) | P0 | Open |
| BUG-03 | /exam/:examId/start error handling | P0 | Open |
| BUG-04 | Attempt count duplicate/in-progress | P0 | Open |
| BUG-05 | /admin/results "查看成绩" eligibility | P1 | Open |
| BUG-06 | /admin/users SuperAdmin role badge | P1 | Open |
| BUG-07 | /admin/candidate-fields type select | P1 | Open |
| BUG-08 | Candidate take exam prev/next nav | P2 | Open |
| BUG-09 | Question index answered indicator | P2 | Open |
| BUG-10 | Questions/Users full-main refresh | P2 | Open |
| BUG-11 | Course description input + display | P2 | Open |
| BUG-12 | Candidate dialog spacing + required | P2 | Open |
| BUG-13 | Exam list operation column clarity | P1 | Open |

---

## BUG-01: Score API validation error

- **Page**: `/admin/exams/:examId/scores`
- **Repro**: Navigate to `/admin/results` → click "查看成绩" on any exam
- **Observed**: `GET /api/exams/:id/scores?page=1&passFilter=all` → 400 `Expected number, received string`
- **Expected**: Query parsing coerces `page` to number; page loads.
- **Root cause**: The score route validated `request.query` directly. In this path the query object could still contain scalar string values from the URL, so `page=1` reached Zod as `"1"` on the failing request path and triggered number validation before route logic ran.
- **Fix**: Normalize score-list query scalars before validation, then keep `ScoreListQuerySchema` as the authority for coercion and constraints. Added API regression coverage for `page=1&pageSize=10&passFilter=all`.
- **Retest**:
  1. Log in as Admin/Teacher.
  2. Open `/admin/results` and click "查看成绩" for a graded exam.
  3. Confirm `/api/exams/:examId/scores?page=1&passFilter=all` returns 200.
  4. Confirm page switching still works and invalid values such as `page=0` still return 400.

## BUG-02: Fill blank question has no input

- **Page**: Candidate take exam
- **Repro**: candidate1 logs in → start/continue exam → navigate to fill_blank question (Q4 安全出口标识的颜色是\_\_\_色)
- **Observed**: Answer area empty, no input field
- **Expected**: Input field renders, accepts text, saves answer
- **Root cause**: Frontend rendering assumed fill-blank inputs came from `question.options`. Demo/manual data used `fill_blank` content with `____` placeholders and string `standardAnswer`, but no option metadata, so the renderer had no blanks to display on the candidate page.
- **Fix**: `FillBlankInput` now derives blanks from the question content when `options` is empty. Single-blank questions save as a plain string, which remains compatible with the existing save protocol and grading logic. Added regression coverage for load/save/submit/grade on a fill-blank attempt, plus a candidate-page smoke test.
- **Retest**:
  1. Log in as candidate and open a published exam containing a `fill_blank` question with `____`.
  2. Confirm the answer area renders at least one text input.
  3. Type an answer and confirm the page sends save requests during the attempt.
  4. Submit the exam and confirm grading recognizes the fill-blank answer correctly.

## BUG-03: Start exam error not surfaced

- **Page**: `/exam/:examId/start`
- **Repro**: candidate1 → start "安全培训考核 A" after reaching max attempts
- **Observed**: Button spins → silently stops, no message; backend returned 400 `Maximum attempt count reached`
- **Expected**: Clear inline error / toast; loading stops
- **Root cause**: The start page only handled the POST failure path after clicking the button. It did not preload enough exam-attempt state to distinguish "can continue", "can start", and "blocked", so the UI fell back to a generic start flow and only showed transient behavior.
- **Fix**: Candidate exam detail now returns `activeAttemptId`, `canStartNewAttempt`, and `blockingReason`. The start page uses that state to render explicit inline messaging, stop button spin correctly, and show precise max-attempt / already-passed errors before posting.
- **Retest**:
  1. Use a candidate whose exam has already exhausted `maxAttempts`.
  2. Open `/exam/:examId/start`.
  3. Confirm the page immediately shows "已达到最大考试次数，无法再次开始考试。"
  4. Confirm the button is disabled and no extra attempt is created.

## BUG-04: Attempt count miscount

- **Page**: `/exam/:examId/start`
- **Repro**: candidate1 enters start page repeatedly
- **Observed**: Count jumps 1/2 → 2/2 unexpectedly; visiting start page may create a new attempt
- **Expected**: Visiting start page does NOT create a new attempt; in-progress attempt counts as one
- **Root cause**: Start-page state and start-attempt behavior were not clearly separated. The candidate detail endpoint did not expose active-attempt state, so the frontend could not reliably resume an existing attempt. That made repeated start flows depend on POST behavior instead of a read-only detail view.
- **Fix**: Kept `/api/candidate/exams/:examId` read-only and added active-attempt metadata. The start page now routes directly to the existing `in_progress` attempt instead of trying to create another one. Added command, API, and UI regression coverage for "continue existing attempt" and "max attempts reached after completion".
- **Retest**:
  1. Start an exam as candidate, then leave the attempt in `in_progress`.
  2. Re-open `/exam/:examId/start` multiple times.
  3. Confirm the page shows "继续考试" and links back to the same attempt.
  4. Confirm attempt count does not increase and no second in-progress attempt is created.

## BUG-05: "查看成绩" shown for ineligible exams

- **Page**: `/admin/results`
- **Repro**: View list including published/future exams
- **Observed**: "查看成绩" shown even for "进行中" or pre-start published exams
- **Expected**: Only closed/finished exams allow score viewing; others hide or disable with reason
- **Root cause**: Frontend score-entry eligibility was inferred locally from incomplete list data. The exam list route did not expose score-view eligibility or graded-attempt count, so `/admin/results` could not reliably distinguish "未结束", "未开放但已发布", and "暂无成绩".
- **Fix**: Exam list API now returns `gradedAttemptCount`, `canViewScores`, and `scoreViewDisabledReason`. `/admin/results` disables ineligible "查看成绩" buttons based on backend-derived flags. The score-list API also rejects direct access before exam end or when no graded attempts exist yet.
- **Retest**:
  1. Open `/admin/results`.
  2. Confirm future/published and in-progress exams show disabled "查看成绩".
  3. Confirm ended exams with zero graded attempts also show disabled "查看成绩".
  4. Confirm only ended exams with graded attempts can open `/admin/exams/:examId/scores`.
  5. Directly open an ineligible score URL and confirm backend returns 409.

## BUG-06: SuperAdmin role badge empty

- **Page**: `/admin/users`
- **Repro**: View users table as superadmin
- **Observed**: superadmin row has empty role badge
- **Expected**: Badge displays "超级管理员" or similar mapping
- **Root cause**: User-role display depended on a strict frontend mapping with no defensive fallback. The enum, seed, and route values all use `SuperAdmin`, but the page had no regression coverage for that role and would render an empty badge if the mapping drifted.
- **Fix**: Verified role enum and seed values stay `SuperAdmin`, added regression coverage for SuperAdmin rows, and made the badge mapping resilient by falling back to the raw role string if a label is missing.
- **Retest**:
  1. Log in as admin or superadmin and open `/admin/users`.
  2. Confirm the `SuperAdmin` row shows badge text "超级管理员".
  3. Confirm non-SuperAdmin roles still display their expected Chinese labels.

## BUG-07: Candidate field type select frozen

- **Page**: `/admin/candidate-fields`
- **Repro**: Click "新建字段" → try to change "类型" dropdown
- **Observed**: Always shows "文本", cannot be changed
- **Expected**: Dropdown allows selecting all supported types
- **Root cause**: The create dialog used a custom Select chain that was not reliably updating the visible selected field type in this form path, even though the enum values themselves were correct (`text` / `number` / `select`).
- **Fix**: Kept the same field-type enum and backend contract, but replaced the create-form control with a simple controlled native `<select>` for this page. That makes the selected type explicit and stable without touching the API contract or edit-mode rule.
- **Retest**:
  1. Open `/admin/candidate-fields`.
  2. Click "添加字段".
  3. Change "类型" from "文本" to "数字" and then "选项".
  4. Confirm the control reflects each selection before saving.

## BUG-08: Exam take page missing prev/next

- **Page**: Candidate take exam
- **Observed**: Only right-side question index for navigation
- **Expected**: Explicit prev/next buttons, last question shows "提交考试"
- **Root cause**: TBD
- **Fix**: TBD
- **Retest**: TBD

## BUG-09: Answered question indicator weak

- **Page**: Candidate take exam (right-side index)
- **Observed**: Subtle bg change, hard to distinguish answered/current/unanswered
- **Expected**: Clear visual hierarchy + aria-label
- **Root cause**: TBD
- **Fix**: TBD
- **Retest**: TBD

## BUG-10: Filter change reloads entire main area

- **Page**: `/admin/questions` (and `/admin/users` toggle)
- **Observed**: Selecting a filter causes full main rerender flicker
- **Expected**: Only table region updates
- **Root cause**: TBD
- **Fix**: TBD
- **Retest**: TBD

## BUG-11: Course description single-line + truncated

- **Page**: `/admin/courses`
- **Observed**: Description is single-line input; table truncates without way to view full text
- **Expected**: Textarea in form; tooltip/expand on table
- **Root cause**: TBD
- **Fix**: TBD
- **Retest**: TBD

## BUG-12: Candidate dialog spacing + defaults

- **Page**: `/admin/candidates`
- **Observed**: Tight label/input spacing; create form prefills admin/admin123
- **Expected**: Consistent vertical spacing; password blank or safe default; required markers
- **Root cause**: TBD
- **Fix**: TBD
- **Retest**: TBD

## BUG-13: Exam list operation column unclear

- **Page**: `/admin/exams`
- **Observed**: Operation column header missing/unclear; delete button visibility inconsistent
- **Expected**: Column header "操作"; delete shown only when allowed
- **Root cause**: Backend already enforced "only draft exams can be deleted", but the list page only partially reflected that rule by conditionally hiding delete in some states. That made the operation column behavior look inconsistent.
- **Fix**: Exam list API now returns `canDelete` and `deleteDisabledReason` from the same rule the delete route enforces. `/admin/exams` always renders the operation column consistently, enables delete only for drafts, and disables it with a reason for non-draft exams.
- **Retest**:
  1. Open `/admin/exams`.
  2. Confirm draft exams have an enabled delete action.
  3. Confirm published/open/closed/archived exams show a disabled delete action instead of a clickable one.
  4. Attempt direct `DELETE /api/exams/:id` on a non-draft exam and confirm backend still returns 409.
