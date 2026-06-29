# Demo Seed Plan

## Accounts

| Username | Role | Password | Purpose |
|---|---|---|---|
| superadmin | SuperAdmin | admin123 | Organization management, all admin features |
| admin | Admin | admin123 | All admin features except org management |
| teacher1 | Teacher | teacher123 | Course/question/exam management |
| teacher2 | Teacher | teacher123 | Teacher permission checks |
| candidate1 | Candidate | candidate123 | In-progress exam, retake history |
| candidate2 | Candidate | candidate123 | Assigned but not started |
| candidate3 | Candidate | candidate123 | Disrupted/recovery case |
| candidate4 | Candidate | candidate123 | Graded result case |

## Candidate Profiles

| Username | employeeId | department | phone |
|---|---|---|---|
| candidate1 | EMP001 | tech | 13800001111 |
| candidate2 | EMP002 | hr | 13800002222 |
| candidate3 | EMP003 | finance | 13800003333 |
| candidate4 | EMP004 | operation | 13800004444 |

## Courses

| Code | Name | Questions |
|---|---|---|
| SAFETY-101 | 基础安全培训 | 6 questions (all types) |
| SKILL-201 | 技能认证考核 | 4 questions (all types) |
| EMPTY-001 | 空课程测试 | 0 questions (empty state) |

## Questions (10 total)

### SAFETY-101 (6 questions)

| Tag | Type | Content | Score | Difficulty |
|---|---|---|---|---|
| safety-sc1 | single_choice | 灭火器的正确使用步骤是？ | 5 | 2 |
| safety-mc1 | multiple_choice | 以下哪些属于个人防护装备？ | 8 | 3 |
| safety-tf1 | true_false | 发生火灾时应乘坐电梯逃生 | 3 | 1 |
| safety-fb1 | fill_blank | 安全出口标识的颜色是___色 | 5 | 1 |
| safety-sc2 | single_choice | 发现火灾应首先拨打哪个电话？ | 5 | 1 |
| safety-fb2 | fill_blank | 消防通道的宽度不得低于___米 | 5 | 3 |

Total: 31 points

### SKILL-201 (4 questions)

| Tag | Type | Content | Score | Difficulty |
|---|---|---|---|---|
| skill-sc1 | single_choice | 以下哪种是正确的操作流程？ | 5 | 3 |
| skill-mc1 | multiple_choice | 质量检查包括哪些环节？ | 10 | 4 |
| skill-tf1 | true_false | 操作前必须进行设备校验 | 5 | 2 |
| skill-fb1 | fill_blank | 标准操作规程的缩写是___ | 5 | 2 |

Total: 25 points

## Exams (5 total)

| Title | Status | Course | Duration | Time Window | Passing | Total | Retake | ScoreStrategy | MaxAttempts | Control |
|---|---|---|---|---|---|---|---|---|---|---|
| 安全培训考核 A | open | SAFETY-101 | 30min | now-1h → now+24h | 20 | 31 | max_attempts | highest | 2 | default |
| 安全培训草稿考试 | draft | SAFETY-101 | 60min | future | 10 | 13 | unlimited | latest | 99 | default |
| 安全培训已发布未开始 | published | SAFETY-101 | 45min | now+1h → now+3h | 12 | 18 | max_attempts | highest | 2 | default |
| 技能认证历史考试 | closed | SKILL-201 | 90min | now-7d → now-1d | 15 | 25 | pass_then_stop | highest | 3 | default |
| 严格模式考试 | open | SKILL-201 | 20min | now-30m → now+2h | 10 | 15 | max_attempts | latest | 1 | strict |

### Control Flags

- **Default**: shuffleQuestions=false, shuffleOptions=false, detectTabSwitch=false, disableCopyPaste=false, showResultImmediately=true
- **Strict**: shuffleQuestions=true, shuffleOptions=true, detectTabSwitch=true, disableCopyPaste=true, requireLockdown=true, showResultImmediately=false

## Enrollments

### Open Exam (安全培训考核 A)

| Candidate | Enrollment Status | Attempt State | Purpose |
|---|---|---|---|
| candidate1 | started | in_progress (2 answers saved) | Continue exam |
| candidate2 | assigned | no attempt | Start exam |
| candidate3 | started | disrupted (1 answer saved) | Recovery flow |
| candidate4 | completed | graded | Completed state |

### Closed Exam (技能认证历史考试)

| Candidate | Attempts | FinalScore | Purpose |
|---|---|---|---|
| candidate1 | 2 graded (attempts 1+2) | highest of both | Retake history |
| candidate2 | 1 graded (failed) | actual graded score | Failed result |
| candidate3 | 1 graded (borderline) | actual graded score | Borderline pass/fail |
| candidate4 | 1 graded (full score) | 25 | Full-score boundary |

### Strict Exam

| Candidate | Enrollment Status |
|---|---|
| candidate1 | assigned |

## Attempts Detail

| Exam | Candidate | AttemptNo | Status | Answers | Score |
|---|---|---|---|---|---|
| Open | candidate1 | 1 | in_progress | 2 saved | — |
| Open | candidate3 | 1 | disrupted | 1 saved | — |
| Open | candidate4 | 1 | graded | all answered | auto-graded |
| Closed | candidate1 | 1 | graded | all correct answers | auto-graded |
| Closed | candidate1 | 2 | graded | some wrong | auto-graded |
| Closed | candidate2 | 1 | graded | mostly wrong | auto-graded |
| Closed | candidate3 | 1 | graded | mixed | auto-graded |
| Closed | candidate4 | 1 | graded | all from standardAnswer | 25 (full) |

## Expected Page Coverage

| Page | Covered By |
|---|---|
| LoginPage | All accounts + branding |
| DashboardPage | admin/teacher (shows question/exam/candidate counts) |
| CoursePage | 3 courses including empty |
| QuestionPage | 10 questions, 4 types, filterable |
| ExamCreatePage | Courses + questions available |
| ExamPage | 5 exams in different statuses |
| ExamDetailPage | Open exam with 4 enrolled candidates |
| ScoreListPage | Closed exam with 4 graded attempts |
| ResultsOverviewPage | Published + closed exams visible |
| AttemptDetailPage | Graded attempts with per-question results |
| UsersPage | 8 users across 5 roles |
| CandidatesPage | 4 candidates with dynamic fields |
| CandidateFieldsPage | 3 configured fields |
| SettingsPage | OrganizationSettings with branding |
| OrganizationsPage | superadmin only |
| ExamListPage | candidate1-4 see different exam states |
| StartExamPage | candidate2 can start open exam |
| TakeExamPage | candidate1 has in-progress attempt |
| ResultPage | candidate4 has graded result |
| ExamSettingsPage | password change for any role |
