# S3b — Current Grading API Audit

> **Date:** 2026-06-29
> **Branch:** `phase3/role-check-audit`
> **Purpose:** Audit grading detail API to determine if candidate answers are returned and where they are stored, preparing fact base for M1 (manual-grading candidate-answer-detail).

---

## 1. Candidate Answer — Already Returned in Grading Details

**Yes**, the grading details API already returns candidate answers.

### 1.1 API Response

**Route:** `GET /api/admin/attempts/:attemptId/grading-details`
**File:** `apps/api/src/routes/gradingQueue.ts:154-156`

```ts
const answerByQuestion = new Map(
  attempt.answers.map((a) => [a.questionId, a.answer]),
);
```

The `candidateAnswer` field is populated per question (line 181):

```ts
candidateAnswer: answerByQuestion.get(q.originalQuestionId) ?? null,
```

### 1.2 Response Shape

**Contract schema:** `packages/contracts/src/score.ts:113-133`

```ts
GradingDetailsQuestionSchema = z.object({
  questionId: z.string(),
  type: z.string(),                          // "single_choice" | "multiple_choice" | "fill_blank" | "true_false"
  content: z.string(),                       // question content text
  maxScore: z.number(),
  candidateAnswer: z.unknown().nullable(),    // ← candidate answer (string, string[], object, or null)
  entry: ManualGradingEntrySchema.nullable(), // existing manual grading entry (or null)
});
```

**Full response envelope** (`score.ts:144-152`):

```ts
GradingDetailsResponseSchema = z.object({
  attemptId: z.string().uuid(),
  examId: z.string().uuid(),
  examTitle: z.string(),
  candidateId: z.string().uuid(),
  candidateName: z.string(),
  gradingStatus: GradingStatusEnum,          // "auto_graded" | "pending_manual" | "fully_graded"
  questions: z.array(GradingDetailsQuestionSchema),
});
```

### 1.3 Only Subjective Questions Included

Line 158 in `gradingQueue.ts` filters to only questions where `standardAnswer === null` (i.e., subjective questions requiring manual grading).

---

## 2. Candidate Answer Storage Location

### 2.1 Storage Model: JSONB Column on `exam_attempts`

**No separate `answers` table exists.** Answers are stored as a JSONB column on the `exam_attempts` table.

**Schema:** `packages/db/src/schema/pg.ts:299`

```ts
answers: jsonb("answers").$type<AnswerRecord[]>().notNull(),
```

### 2.2 Domain Type

**`packages/domain/src/types.ts:343-348`**

```ts
interface AnswerRecord {
  questionId: string;
  answer: unknown;    // string | string[] | Record<string, string> | boolean | null
  version: number;    // optimistic concurrency (Answer Save Protocol)
  savedAt: Date;
}
```

### 2.3 Access Pattern

Answers are read via `attemptRepo.findById(ctx, attemptId)` which returns the full row including the `answers` JSONB. There are no dedicated answer CRUD methods — answers are updated atomically as part of the attempt's JSONB column during the answer save protocol.

### 2.4 Related JSONB Columns on `exam_attempts`

| Column | Type | Purpose |
|--------|------|---------|
| `questionSnapshot` | JSONB | Frozen question set copied at attempt creation |
| `answers` | JSONB | Candidate's answers array |
| `gradingResult` | JSONB | Auto-grading results (`QuestionScoreResult[]`) |

---

## 3. Manual Grading Entry Storage

**Separate table:** `manual_grading_entries`
**Schema:** `packages/db/src/schema/pg.ts:335-373`

```ts
manualGradingEntries = pgTable("manual_grading_entries", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  attemptId: text("attempt_id").notNull().references(() => examAttempts.id),
  questionId: text("question_id").notNull(),
  score: doublePrecision("score").notNull(),
  maxScore: doublePrecision("max_score").notNull(),
  comment: text("comment").notNull().default(""),
  gradedBy: text("graded_by").notNull(),
  gradedAt: timestamp("graded_at", { withTimezone: true }).notNull(),
  createdAt, updatedAt,
}, [
  uniqueIndex("manual_grading_entries_attempt_question_unique")
    .on(table.attemptId, table.questionId),
  check("score >= 0"),
  check("maxScore >= 0"),
  check("score <= maxScore"),
]);
```

**Repo:** `packages/db/src/repository/manualGradingRepo.ts`
- `findByAttempt(ctx, attemptId)` — all entries for an attempt
- `findByAttemptAndQuestion(ctx, attemptId, questionId)` — single entry
- `upsert(ctx, input)` — INSERT ON CONFLICT DO UPDATE

**Migration:** `packages/db/migrations/postgres/0004_wide_phantom_reporter.sql`

---

## 4. Grading Endpoints Summary

### 4.1 `GET /api/admin/grading-queue`

**File:** `apps/api/src/routes/gradingQueue.ts:45-103`
**Guard:** `[authenticate, requireRole(["Admin"])]`
**Query:** `page`, `pageSize`, `examId?`

**Response per item:**

| Field | Type | Source |
|-------|------|--------|
| `attemptId` | uuid | exam_attempts.id |
| `examId` | uuid | exams.id |
| `examTitle` | string | exams.title |
| `candidateId` | uuid | candidate_profiles.id |
| `candidateName` | string | users.name |
| `submittedAt` | string? | exam_attempts.submittedAt |
| `gradingStatus` | GradingStatusEnum | exam_attempts.grading_status (default: `"auto_graded"`) |
| `pendingQuestionCount` | number | subjectiveCount - scoredCount |

**Data source:** `attemptRepo.listPendingManual(ctx, ...)` — JOINs exam_attempts + exams + candidate_profiles + users + LEFT JOIN manual_grading_entries.

### 4.2 `GET /api/admin/attempts/:attemptId/grading-details`

**File:** `apps/api/src/routes/gradingQueue.ts:110-189`
**Guard:** `[authenticate, requireRole(["Admin"])]`

**Response fields:** See §1.2 above. Key: includes `candidateAnswer` (nullable unknown) per question.

### 4.3 `POST /api/admin/attempts/:attemptId/grade-question`

**File:** `apps/api/src/routes/gradingQueue.ts:197-340`
**Guard:** `[authenticate, requireRole(["Admin"])]`

**Request body** (`score.ts:165-169`):

```ts
{
  questionId: z.string().min(1),
  score: z.number().min(0),
  comment: z.string().max(2000).default(""),
}
```

**Response** (`score.ts:178-188`):

```ts
{
  attemptId: string,
  gradingStatus: GradingStatusEnum,
  questionId: string,
  score: number,
  fullyGraded: boolean,
  totalScore?: number,    // only when fullyGraded
  passed?: boolean,        // only when fullyGraded
}
```

**Flow:** Transactional with row lock → validates question is subjective + score in `[0, maxScore]` → upserts manual_grading_entries → if all subjective questions scored, calls `reconcileScores()` to recompute objective + manual totals → updates attempt → audit logs.

---

## 5. Grading Engine Architecture

### 5.1 Auto-Grading (objective questions)

**`packages/domain/src/gradingEngine.ts`**
- Dispatches by question type: `single_choice`, `true_false` → exact match; `multiple_choice` → set comparison; `fill_blank` → exact or keyword match.
- `hasSubjectiveQuestions(questions)` — returns true when any question has `standardAnswer === null`.

### 5.2 Grading Orchestration

**`packages/exam-engine/src/grading.ts`**
- `computeGradingResult(attempt, exam, now)` — delegates to domain `gradeAnswers()`.
- `finalizeGrading(...)` — sets `gradingStatus: pending_manual` if subjective questions exist, `auto_graded` otherwise.
- `gradeAttempt(...)` / `gradeAttemptIdempotent(...)` — full end-to-end auto-grading.

### 5.3 Manual Grading Command

**`packages/exam-engine/src/manualGrading.ts`**
- `gradeQuestion(...)` — manual grading command (upserts entry, checks if fully graded, reconciles scores).
- `reconcileScores(attempt, entries, passingScore)` — merges objective auto-grades + manual scores into unified result.

### 5.4 Repo Adapters

**`apps/api/src/adapters/repoAdapters.ts`**
- `createManualGradingRepoAdapter()` — adapts DB repo to `ManualGradingRepository` interface.
- `createAttemptRepoAdapter()` — adapts DB repo to `AttemptRepository` interface.

---

## 6. Frontend Grading Pages

### 6.1 Grading Queue List

**File:** `apps/web/src/pages/admin/GradingQueuePage.tsx`

Displays paginated table: candidateName, examTitle, submittedAt, pendingQuestionCount, gradingStatus (StatusBadge).

Rows are clickable → navigates to `/admin/grading-queue/${item.attemptId}`.

### 6.2 Grading Detail Page

**File:** `apps/web/src/pages/admin/GradingDetailPage.tsx`

**Fields displayed per question:**

| Field | Lines | Notes |
|-------|-------|-------|
| Question content | 196 | `q.content` |
| Max score label | 199 | "X 分" |
| Type label | 204 | Hardcoded "主观题" |
| **Candidate answer** | 208-215 | `q.candidateAnswer` rendered via `formatAnswer()` in a bordered box |
| Score input | 221-233 | Number input |
| Comment textarea | 245-258 | Pre-filled from `q.entry.comment` |
| Previous grading label | 273-276 | "已评 X 分" from `q.entry.score` |
| Save button | 262-270 | Per-question |

**`formatAnswer()` helper (lines 34-49):**

```ts
function formatAnswer(answer: unknown): string {
  if (answer === undefined || answer === null || answer === "") return "未作答";
  if (typeof answer === "string") return answer;
  if (typeof answer === "boolean") return answer ? "是" : "否";
  if (Array.isArray(answer)) return answer.join("、");
  if (typeof answer === "object") return Object.values(answer).map(formatAnswer).join("、");
  return String(answer);
}
```

**Frontend types (lines 51-83):**

```ts
interface GradingQuestion {
  questionId: string;
  type: string;
  content: string;
  maxScore: number;
  candidateAnswer: unknown;    // ← already present
  entry: GradingEntry | null;
}
```

### 6.3 Score Validation

**`GradingDetailPage.tsx:24-32`** + **shared in export `validateScore()`**

```ts
function validateScore(score: number, maxScore: number): string | null {
  if (score < 0) return "分数不能为负数";
  if (score > maxScore) return `分数不能超过满分 (${maxScore})`;
  return null;
}
```

---

## 7. Test Coverage

### 7.1 Backend Integration Tests

**`apps/api/src/routes/gradingQueue.test.ts`** (789 lines, 14 test slices)

| Slice | What it tests |
|-------|---------------|
| Lists subjective attempt in queue | 200, matchObject { pendingQuestionCount: 1 } |
| Does NOT list auto_graded attempts | |
| 403 non-admin / cross-org isolation | |
| GET grading-details | 200, questions with { questionId, content, maxScore, entry: null } |
| POST grade-question saves | 200, gradingStatus stays pending_manual |
| Flips fully_graded on last question | 200, fullyGraded: true |
| Re-grade overwrites | Only 1 entry, latest score wins |
| Error contract | 404 unknown, 403 auto_graded, 400 non-subjective, 400 exceeds max, 403 candidate |
| Audit grading.score_entered | |
| Audit grading.finalized | |
| **Candidate answer in details** | `candidateAnswer: "my essay response"`, unanswered → null |
| Reconciles objective + manual | { totalScore: 90 } (40 obj + 50 manual) |
| Re-grade idempotent | totalScore not double-counted |

### 7.2 Frontend Unit Tests

**`apps/web/src/pages/admin/GradingQueuePage.test.tsx`** (137 lines, 7 tests)
- Renders queue items, pending counts, empty state, loading, error, row click navigation, retry.

**`apps/web/src/pages/admin/GradingDetailPage.test.tsx`** (304 lines, 10 tests + 5 validateScore tests)
- Renders attempt info, existing entry, empty score input, score validation, submits score, toast messages, loading/error states, comment submission, save-in-progress disable.

> **Test gap:** Mock data does NOT include `candidateAnswer` on any question. No test asserts on `data-testid="grading-candidate-answer-*"` or `formatAnswer()` rendering.

### 7.3 Engine Tests

| File | Tests |
|------|-------|
| `packages/exam-engine/src/manualGrading.test.ts` (385 lines) | gradeQuestion command (8 tests), reconcileScores (3 tests) |
| `packages/exam-engine/src/grading.test.ts` | Auto-grading engine |
| `packages/db/src/repository/manualGradingRepo.test.ts` (312 lines) | Manual grading repo CRUD + constraints |

### 7.4 E2E (Skipped — Phase 3 Pending)

**`apps/e2e/e2e/manual-grading.spec.ts`** (161 lines)
- Skipped with `test.skip(true, "Phase 3 pending...")`.
- Planned flow: seed exam with objective + subjective → candidate answers → admin grades from queue → candidate sees reconciled total → admin re-grades idempotently.

---

## 8. Subjective Question Detection

A question is "subjective" (needs manual grading) when `questionSnapshot[].standardAnswer === null`.

Checked in:
- `apps/api/src/routes/gradingQueue.ts:158` — filters details to subjective questions only
- `packages/exam-engine/src/manualGrading.ts:49-53` — validates question is subjective before grading
- `packages/domain/src/gradingEngine.ts:150` — `hasSubjectiveQuestions()`

### 8.1 Demo Seed

**`packages/db/src/demo-seed.ts`** does NOT include any subjective questions. All demo questions have non-null standard answers, so no `pending_manual` grading statuses exist in the default demo data.

### 8.2 Test Fixtures

Subjective questions in tests are created as `single_choice` with `standardAnswer: null` (a pragmatic test shortcut — the type doesn't matter for manual grading, only the `standardAnswer` field).

---

## 9. Grading Status Domain

**`packages/domain/src/enums.ts:94-99`**

```ts
export const GradingStatus = {
  AutoGraded: "auto_graded",
  PendingManual: "pending_manual",
  FullyGraded: "fully_graded",
} as const;
```

**`gradingStatus` on `ExamAttempt`** (`types.ts:321`) is optional — `undefined` means the attempt was graded before this field existed; application boundary defaults to `"auto_graded"`.

---

## 10. Key Findings for M1

### 10.1 Candidate Answer IS Already Returned

The grading detail API **already includes** `candidateAnswer` (nullable `unknown`) in the response. The frontend **already renders** it via `formatAnswer()`. The backend integration test **already asserts** on it.

**However**, the frontend test does NOT cover this — mock data lacks `candidateAnswer` and no test verifies the rendering.

### 10.2 What M1 Actually Needs to Add

Based on the Phase 3 job card scope ("subjective / rich-text answer runtime + manual-grading candidate-answer detail and full grading workflow"), the actual gaps for M1 are:

1. **Fill-blank answering runtime** — `fill-blank` question type E2E is Phase 3 (currently skipped).
2. **Rich-text / subjective answering runtime** — No WYSIWYG answer input exists yet.
3. **Frontend test gap** — `GradingDetailPage.test.tsx` needs `candidateAnswer` in mock data and assertions.
4. **E2E unskip** — `manual-grading.spec.ts` needs to be enabled and passing.
5. **Demo seed** — No subjective questions in demo data; adding them would improve manual grading testing.

### 10.3 Files M1 Needs to Modify

| File | Change |
|------|--------|
| `apps/web/src/pages/admin/GradingDetailPage.test.tsx` | Add `candidateAnswer` to mock data, add rendering assertions |
| `apps/e2e/e2e/manual-grading.spec.ts` | Unskip and verify the full grading E2E flow |
| `packages/db/src/demo-seed.ts` | (Optional) Add subjective questions for manual grading demo |
| `apps/e2e/lib/seed.ts` | Verify subjective question seeding works end-to-end |

### 10.4 Files M1 May Need to Add

| File | Purpose |
|------|---------|
| `apps/web/src/pages/admin/GradingDetailPage.test.tsx` (additions) | `formatAnswer()` rendering tests |
| `apps/e2e/e2e/fill-blank-e2e.spec.ts` (unskip) | Fill-blank answering runtime E2E |
| New WYSIWYG/rich-text component (if in M1 scope) | Subjective answer input |

### 10.5 New Tests M1 Should Add

| Test | Location | Priority |
|------|----------|----------|
| `formatAnswer()` renders string answer | `GradingDetailPage.test.tsx` | High |
| `formatAnswer()` renders array answer (fill_blank) | `GradingDetailPage.test.tsx` | High |
| `formatAnswer()` renders null as "未作答" | `GradingDetailPage.test.tsx` | High |
| `formatAnswer()` renders object answer | `GradingDetailPage.test.tsx` | Medium |
| `candidateAnswer` visible in grading detail for unanswered question | `GradingDetailPage.test.tsx` | High |
| Manual grading E2E full flow | `manual-grading.spec.ts` | High |
| Fill-blank answer + manual grading E2E | `fill-blank-e2e.spec.ts` | High (if in M1) |

---

## 11. Complete File Inventory

### Production Code

| File | Relevance |
|------|-----------|
| `apps/api/src/routes/gradingQueue.ts` | All 3 grading endpoints |
| `apps/api/src/adapters/repoAdapters.ts` | Repo adapters for grading engine |
| `packages/contracts/src/score.ts` | All grading Zod schemas |
| `packages/contracts/src/attempt.ts` | AnswerRecordSchema, QuestionSnapshotSchema |
| `packages/domain/src/enums.ts` | GradingStatus enum |
| `packages/domain/src/types.ts` | ExamAttempt, AnswerRecord, QuestionScoreResult, ManualGradingEntry |
| `packages/domain/src/gradingEngine.ts` | Auto-grading engine |
| `packages/exam-engine/src/grading.ts` | Grading orchestration |
| `packages/exam-engine/src/manualGrading.ts` | Manual grading command + reconcileScores |
| `packages/db/src/schema/pg.ts` | exam_attempts.answers JSONB, manual_grading_entries table |
| `packages/db/src/repository/attemptRepo.ts` | listPendingManual, findById |
| `packages/db/src/repository/manualGradingRepo.ts` | findByAttempt, upsert |
| `packages/db/src/repository/gradingQueueRepo.ts` | findExamById, findCandidateWithUser |
| `apps/web/src/pages/admin/GradingQueuePage.tsx` | Queue list page |
| `apps/web/src/pages/admin/GradingDetailPage.tsx` | Grading detail page |
| `apps/web/src/lib/routes.ts` | gradingQueue / gradingDetail route paths |
| `apps/web/src/lib/statusMeta.ts` | GradingStatus badge metadata |

### Test Code

| File | Relevance |
|------|-----------|
| `apps/api/src/routes/gradingQueue.test.ts` | Full integration tests (14 slices) |
| `apps/api/src/routes/attempts/gradingConcurrency.test.ts` | Enrollment finalScore race |
| `apps/api/src/routes/resultPublishing.test.ts` | Result publishing with grading status |
| `apps/web/src/pages/admin/GradingQueuePage.test.tsx` | Queue list frontend tests |
| `apps/web/src/pages/admin/GradingDetailPage.test.tsx` | Grading detail frontend tests |
| `packages/exam-engine/src/manualGrading.test.ts` | Manual grading command tests |
| `packages/exam-engine/src/grading.test.ts` | Auto-grading engine tests |
| `packages/db/src/repository/manualGradingRepo.test.ts` | Manual grading repo tests |
| `apps/e2e/e2e/manual-grading.spec.ts` | E2E (skipped, Phase 3) |
| `apps/e2e/e2e/fill-blank-e2e.spec.ts` | Fill-blank E2E (skipped, Phase 3) |
| `apps/e2e/lib/seed.ts` | E2E seed with subjective question support |

### Migrations

| File | Relevance |
|------|-----------|
| `packages/db/migrations/postgres/0004_wide_phantom_reporter.sql` | Creates manual_grading_entries table + grading_status column |
