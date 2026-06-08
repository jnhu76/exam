# Exam Data Chain

## Full Data Flow

```text
Organization ──→ OrganizationSettings
             ──→ CandidateFields ──→ CandidateProfile
             ──→ Users ──→ CandidateProfile
             ──→ Courses ──→ Questions
                              ──→ Exam.questionSnapshot (frozen copy)
                                        ──→ ExamEnrollment
                                                ──→ ExamAttempt.questionSnapshot (copy from Exam)
                                                        ──→ ExamAttempt.answers
                                                        ──→ ExamAttempt.gradingResult
                                                        ──→ ExamAttempt.score/passed
                                                ──→ ExamEnrollment.finalScore/finalPassed
```

## Edge-by-Edge Documentation

### Organization → OrganizationSettings

- **FK**: `organizationSettings.organizationId → organizations.id`
- **Cardinality**: 1:1 (unique index on organizationId)
- **Consumer**: LoginPage (branding), SettingsPage
- **API**: `GET /api/settings/branding`, `GET /api/admin/settings/branding`

### Organization → CandidateFields

- **FK**: `candidateFields.organizationId → organizations.id`
- **Cardinality**: 1:N
- **Unique**: `(organizationId, name)`
- **Consumer**: CandidateFieldsPage, CandidatesPage (dynamic columns), import template
- **API**: `GET /api/candidate-fields`, CRUD endpoints

### Users → CandidateProfile

- **FK**: `candidateProfiles.userId → users.id`
- **Cardinality**: Only Candidate-role users have profiles (1:1 via unique index on `(organizationId, userId)`)
- **Required**: `fields: Record<string, unknown>` — must match configured CandidateFields
- **Consumer**: CandidatesPage, ExamDetailPage (enrollment picker), ScoreListPage (candidate identity)
- **API**: `GET /api/candidates`, CRUD + import

### Courses → Questions

- **FK**: `questions.courseId → courses.id`
- **Cardinality**: 1:N
- **Required**: Questions must have `options`, `standardAnswer`, `gradingRule`, `score`
- **Consumer**: QuestionPage, ExamCreatePage (picker)
- **API**: `GET /api/questions`, CRUD + import

### Questions → Exam.questionSnapshot

- **Trigger**: `publishExam()` (POST `/exams/:id/publish`)
- **Mechanism**: `buildQuestionSnapshot()` copies each question to `QuestionSnapshot`
- **Stripped**: `options.isCorrect` is removed (candidates cannot see correct answers)
- **Kept**: `originalQuestionId`, `type`, `content`, `attachments`, `options (id+content)`, `standardAnswer`, `score`, `gradingRule`
- **Validation**: `exam.totalScore` must equal sum of snapshot scores
- **Consumer**: TakeExamPage (candidate view), grading engine
- **Immutable**: After publish, edits to QuestionBank do NOT affect the snapshot

### Exam → ExamEnrollment

- **FK**: `examEnrollments.examId → exams.id`, `examEnrollments.candidateId → candidateProfiles.id`
- **Unique**: `(organizationId, examId, candidateId)`
- **Initial status**: `assigned`
- **Status flow**: `assigned → started → completed`
- **Consumer**: ExamDetailPage (enrollment list), ExamListPage (candidate view)
- **API**: `GET /exams/:id/enrollments`, `POST /exams/:id/enrollments`, `DELETE /exams/:id/enrollments/:id`

### ExamEnrollment → ExamAttempt

- **FK**: `examAttempts.enrollmentId → examEnrollments.id`
- **Unique**: `(organizationId, enrollmentId, attemptNo)`
- **Created by**: `startAttempt()` (POST `/attempts/:examId/start`)
- **Copies**: `questionSnapshot` from exam (second freeze point)
- **Initial state**: `status: in_progress`, `answers: []`
- **Computed**: `deadlineAt = now + exam.durationMinutes`
- **Consumer**: TakeExamPage, ResultPage, AttemptDetailPage, ScoreListPage

### ExamAttempt → Answers

- **Storage**: `examAttempt.answers: AnswerRecord[]` (JSON column)
- **Protocol**: Versioned, idempotent saves via `processSaveAnswer()`
- **Conflict detection**: `baseVersion < currentVersion → STALE_VERSION`
- **Consumer**: TakeExamPage (save on every change), grading engine
- **API**: `POST /attempts/:attemptId/answers/:questionId`

### ExamAttempt → GradingResult

- **Trigger**: `submitAttempt()` → `gradeAttempt()` (POST `/attempts/:attemptId/submit`)
- **Mechanism**: `gradeAnswers()` from `@exam/domain`
- **Per-question**: `QuestionScoreResult { questionId, score, maxScore, correct, candidateAnswer, standardAnswer }`
- **Stored**: `examAttempt.gradingResult`, `examAttempt.score`, `examAttempt.passed`
- **Consumer**: ResultPage, AttemptDetailPage, ScoreListPage
- **API**: `GET /scores/attempts/:attemptId`

### ExamAttempt/Enrollment → Final Score

- **Trigger**: `gradeAttempt()` after successful grading
- **Rule**: `shouldSelectAttempt(exam.scoreStrategy, enrollment, score)`
  - `highest`: Update if `score > enrollment.finalScore`
  - `latest`: Always update
  - `first`: Never update after first
- **Fields updated**: `enrollment.finalScore`, `enrollment.finalPassed`, `enrollment.finalAttemptId`
- **Status**: Enrollment transitions to `completed`
- **Consumer**: ExamListPage (candidate), ExamDetailPage (admin), ScoreListPage
- **API**: Computed from enrollment + attempts

## Answer Format Reference

| QuestionType | Candidate Answer | Standard Answer | Grading |
|---|---|---|---|
| `single_choice` | `"A"` (string) | `"A"` | Strict equality |
| `multiple_choice` | `["A","B"]` (array) | `["A","B","C"]` | Set comparison, configurable partial scoring |
| `true_false` | `true`/`false` (boolean) | `true`/`false` | Strict equality |
| `fill_blank` | `"answer"` or `{k:"v"}` | `"answer"` or `{k:"v"}` | Pipe-delimited alternatives, exact/keyword mode |

## Status Lifecycle Summary

### Exam: `draft → published → open → closed → archived`

### Enrollment: `assigned → started → completed`

### Attempt: `in_progress → submitted → grading → graded`

Special: `in_progress ↔ disrupted` (heartbeat timeout / recovery)
