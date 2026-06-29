# Demo Seed Contract

Source of truth: codebase inspection. No guessing.

## 1. Enum Values

### Role

| Value | Route Access |
|---|---|
| `SuperAdmin` | All routes + Organizations |
| `Admin` | All routes except Organizations |
| `Teacher` | Courses, Questions, Exams, Scores, Export, Settings |
| `Proctor` | Defined but **zero route access** (dormant) |
| `Candidate` | Attempts, own Scores only |

### ExamStatus

| Value | Transition From |
|---|---|
| `draft` | Initial state on create |
| `published` | `draft -> published` (via publishExam) |
| `open` | `published -> open` (via openExam) |
| `closed` | `open -> closed` (via closeExam) |
| `archived` | `published -> archived`, `closed -> archived` |

### EnrollmentStatus

| Value | Transition |
|---|---|
| `assigned` | Initial on enrollment create |
| `started` | `assigned -> started` (on startAttempt) |
| `completed` | `started -> completed` (on gradeAttempt) |
| `blocked` | `assigned -> blocked` (not yet used in code) |

### AttemptStatus

| Value | Transition |
|---|---|
| `not_started` | Declared but never created (attempts start at in_progress) |
| `queued` | Declared but queue is in-memory only |
| `in_progress` | Initial on startAttempt |
| `disrupted` | `in_progress -> disrupted` (markDisrupted) |
| `submitted` | `in_progress -> submitted`, `disrupted -> submitted` |
| `grading` | `submitted -> grading` |
| `graded` | `grading -> graded` |
| `voided` | Declared but not implemented in Phase 1 |

### QuestionType

| Value | Answer Format |
|---|---|
| `single_choice` | `"A"` (option id string) |
| `multiple_choice` | `["A", "B", "C"]` (array of option ids) |
| `true_false` | `true` or `false` (boolean) |
| `fill_blank` | `"answer"` (string) or `{ key: "value" }` (multi-blank) |

### TimingMode

| Value | Phase 1 Support |
|---|---|
| `timed_sync` | No |
| `timed_window` | **Yes** (only mode allowed in publishExam) |
| `deadline` | No |
| `untimed` | No |

### QuestionSelectionMode

| Value | Phase 1 Support |
|---|---|
| `manual` | **Yes** (only mode allowed in publishExam) |
| `random` | No |

### ScoreStrategy

| Value | Enrollment finalScore Rule |
|---|---|
| `highest` | Update if `score > enrollment.finalScore` |
| `latest` | Always update (every graded attempt) |
| `first` | Never update after first grading |

### RetakePolicy

| Value | Phase 1 Enforcement |
|---|---|
| `unlimited` | No check |
| `max_attempts` | Rejects if `attemptCount >= exam.maxAttempts` |
| `pass_then_stop` | Rejects if `enrollment.finalPassed === true` |
| `daily_limit` | Declared but **never enforced** |
| `weekly_limit` | Declared but **never enforced** |

### MultiSelectScoring

| Value | Behavior |
|---|---|
| `all_correct_full` | Only exact match gets full score |
| `partial_half` | Subset with no wrong = half score |

### FillBlankMatchMode

| Value | Behavior |
|---|---|
| `exact` | Trimmed strings must be equal |
| `keyword` | Trimmed candidate includes trimmed standard |

### ConflictReason

| Value | When |
|---|---|
| `STALE_VERSION` | `baseVersion < currentVersion` |
| `SUBMITTED` | Attempt is submitted/grading/graded |
| `ATTEMPT_CLOSED` | Attempt is voided |

### CandidateField fieldType

| Value | Storage |
|---|---|
| `text` | String |
| `number` | Number |
| `select` | String (one of options) |

## 2. Key Database Relations

```text
organizations (slug unique)
  └── organizationSettings (organizationId unique)
  └── candidateFields (organizationId + name unique)
  └── users (organizationId + username unique)
       └── candidateProfiles (organizationId + userId unique, fields: JSON)
  └── courses (organizationId + code unique)
       └── questions (courseId FK -> courses.id)
            └── exams (courseId FK -> courses.id)
                 └── examEnrollments (organizationId + examId + candidateId unique)
                      └── examAttempts (organizationId + enrollmentId + attemptNo unique)
  └── auditLogs
```

## 3. Required Fields Per Entity

### organizations

| Field | Type | Required |
|---|---|---|
| id | text PK | auto |
| name | text | yes |
| displayName | text | yes |
| slug | text | yes (unique) |
| createdAt | timestamp | auto |
| updatedAt | timestamp | auto |

### organizationSettings

| Field | Type | Required |
|---|---|---|
| id | text PK | auto |
| organizationId | text FK | auto |
| productName | text | no |
| productSubtitle | text | no |
| footerText | text | no |
| organizationDisplayName | text | no |
| timezone | text | no |

### candidateFields

| Field | Type | Required |
|---|---|---|
| id | text PK | auto |
| organizationId | text FK | auto |
| name | text | yes (unique per org) |
| label | text | yes |
| fieldType | text enum | yes |
| required | boolean | yes |
| unique | boolean | yes |
| sortOrder | integer | yes |
| createdAt | timestamp | auto |

### users

| Field | Type | Required |
|---|---|---|
| id | text PK | auto |
| organizationId | text FK | auto |
| username | text | yes (unique per org) |
| passwordHash | text | yes |
| name | text | yes |
| role | text enum | yes |
| isActive | boolean | yes |

### candidateProfiles

| Field | Type | Required |
|---|---|---|
| id | text PK | auto |
| organizationId | text FK | auto |
| userId | text FK | yes (unique per org) |
| fields | JSON | yes |

### courses

| Field | Type | Required |
|---|---|---|
| id | text PK | auto |
| organizationId | text FK | auto |
| name | text | yes |
| code | text | yes (unique per org) |
| description | text | yes |

### questions

| Field | Type | Required |
|---|---|---|
| id | text PK | auto |
| organizationId | text FK | auto |
| courseId | text FK | yes |
| type | text enum | yes |
| content | text | yes |
| options | JSON | yes |
| standardAnswer | JSON | yes |
| attachments | JSON | yes |
| score | real | yes |
| difficulty | integer | yes |
| tags | JSON | yes |
| gradingRule | JSON | yes |

### exams

| Field | Type | Required |
|---|---|---|
| id | text PK | auto |
| organizationId | text FK | auto |
| title | text | yes |
| description | text | yes |
| courseId | text FK | yes |
| status | text enum | yes |
| timingMode | text enum | yes |
| durationMinutes | integer | yes |
| openAt | timestamp | yes |
| closeAt | timestamp | yes |
| passingScore | real | yes |
| totalScore | real | yes |
| questionSelectionMode | text enum | yes |
| questionIds | JSON | yes |
| questionSnapshot | JSON | yes (empty [] for draft) |
| controlFlags | JSON | yes |
| retakePolicy | text enum | yes |
| scoreStrategy | text enum | yes |
| maxAttempts | integer | yes |

### examEnrollments

| Field | Type | Required |
|---|---|---|
| id | text PK | auto |
| organizationId | text FK | auto |
| examId | text FK | yes |
| candidateId | text FK | yes |
| status | text enum | yes |
| attemptCount | integer | yes |
| finalScore | real | no |
| finalPassed | boolean | no |
| finalAttemptId | text | no |

### examAttempts

| Field | Type | Required |
|---|---|---|
| id | text PK | auto |
| organizationId | text FK | auto |
| examId | text FK | yes |
| enrollmentId | text FK | yes |
| candidateId | text FK | yes |
| attemptNo | integer | yes |
| status | text enum | yes |
| questionSnapshot | JSON | yes |
| answers | JSON | yes |
| gradingResult | JSON | no |
| score | real | no |
| passed | boolean | no |
| startedAt | timestamp | no |
| deadlineAt | timestamp | no |
| submittedAt | timestamp | no |
| gradedAt | timestamp | no |
| lastActivityAt | timestamp | no |

## 4. Lifecycle Rules

### Exam Lifecycle

1. Created as `draft` with `questionSnapshot: []`
2. `publishExam()` validates and freezes `questionSnapshot`
3. TotalScore must equal sum of snapshot question scores
4. PassingScore must be <= totalScore
5. Only `timed_window` timing and `manual` selection in Phase 1
6. `openAt < closeAt` required

### Question Snapshot Generation

Triggered by `publishExam()`:
- Copies: `originalQuestionId, type, content, attachments, score, gradingRule`
- Options: only `{ id, content }` (strips `isCorrect`)
- `standardAnswer`: copied as-is
- `order`: index position (0-based)

### Attempt Lifecycle

1. Created by `startAttempt()` with `status: in_progress`
2. Copies `questionSnapshot` from exam
3. `deadlineAt = now + durationMinutes`
4. `answers: []` initially
5. Submit transitions: `in_progress -> submitted -> grading -> graded`
6. Grading uses `gradeAnswers()` from `@exam/domain`
7. Enrollment `finalScore` updated per `scoreStrategy`

### Enrollment finalScore

Determined by `shouldSelectAttempt()`:
- `highest`: update if new score > existing
- `latest`: always update
- `first`: never update after first

### Answer Format

- `single_choice`: string (option id)
- `multiple_choice`: array of strings (option ids)
- `true_false`: boolean
- `fill_blank`: string or Record<string, string> for multi-blank

### Standard Answer Format

- `single_choice`: string (correct option id)
- `multiple_choice`: array of strings (correct option ids)
- `true_false`: boolean
- `fill_blank`: string (pipe-delimited alternatives accepted, e.g. "green|GREEN|绿")

## 5. Unique Keys for Idempotent Upsert

| Table | Unique Key |
|---|---|
| organizations | `slug` |
| organizationSettings | `organizationId` |
| candidateFields | `(organizationId, name)` |
| users | `(organizationId, username)` |
| candidateProfiles | `(organizationId, userId)` |
| courses | `(organizationId, code)` |
| examEnrollments | `(organizationId, examId, candidateId)` |
| examAttempts | `(organizationId, enrollmentId, attemptNo)` |

## 6. Time Window Rules

| Exam Status | Time Condition |
|---|---|
| `open` | `openAt <= now < closeAt` |
| `published` (future) | `openAt > now` |
| `closed` | `closeAt <= now` |
| `draft` | No time constraint |

## 7. Mismatches Found

1. **Proctor role**: Defined in enum but has zero route access. No route uses `requireRole(["Proctor", ...])`.
2. **daily_limit / weekly_limit retake**: Declared in enum but never enforced. `publishExam()` only accepts `unlimited`, `max_attempts`, `pass_then_stop`.
3. **not_started / queued / voided attempt statuses**: Declared but never created in Phase 1. Attempts start at `in_progress`.
4. **Exam state machine test vs code**: Test allows `draft -> archived` and `published -> draft`, but code does not implement these transitions.
5. **Permissions declared but unused**: 22 Permission constants exist, but `ctx.permissions` is always `[]` and no RBAC enforcement exists.
6. **userRepo ctx violation**: `findByOrganizationAndUsername` and `findByOrganizationAndId` do not accept `ctx` as first arg (TODO comments in code).
7. **participantCount placeholder**: `systemStatsRepo.getRecentExams` returns `participantCount: 0` always.
8. **restoreAttempt preserves deadline**: Disrupted attempt recovery does NOT recalculate `deadlineAt`.
