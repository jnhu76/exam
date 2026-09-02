# Exam Platform — Domain Language

Configurable LAN/on-premise exam and assessment platform. Single-tenant, multi-user (Admin + Candidate in Phase 1).

## Question Types

**QuestionType**: The kind of question — what the examinee is asked to do.
_Avoid_: question kind, question category

- `single_choice` — pick one option from a list
- `multiple_choice` — pick one or more options from a list
- `true_false` — select true or false
- `fill_blank` — complete a short text blank; auto-graded, single-line input, standardAnswer required
- `text_response` — constructed free-text response; manual-graded, standardAnswer optional; inputMode is always multi_line in MVP; future short-answer variants require responseConfig or a separate QuestionType

**InputMode**: How the frontend renders the answer input control. Derived from QuestionType via `getInputMode(type)` at the API layer; not stored in DB.
_Avoid_: render mode, display type

- `choice` — radio/checkbox selection (single_choice, multiple_choice)
- `boolean` — true/false toggle (true_false)
- `single_line` — single-line text input (fill_blank)
- `multi_line` — multi-line textarea (text_response)

**GradingMode**: How the answer is scored. Derived from QuestionType via `getGradingMode(type)` at the API layer; not stored in DB.
_Avoid_: scoring mode

- `auto` — system grades by comparing against standardAnswer (single_choice, multiple_choice, true_false, fill_blank)
- `manual` — human grader enters score (text_response)

**standardAnswer**: The correct or reference answer for a question. Required for auto-graded questions. Optional (may be null) for text_response. Not a subjectivity marker.
_Avoid_: answer key, correct answer (use standardAnswer), solution

**rubric**: A scoring guide for manual grading. Phase 1 MVP stores it as plain text; no rubric builder UI. Required for text_response questions at publish time (rubric must be non-empty; standardAnswer is optional). Two-layer storage: `questions.rubric` is the authoring/editing source; `QuestionSnapshot.rubric` is the frozen grading source, copied at attempt creation time. Grading views must read from snapshot, never JOIN live questions table.
_Avoid_: marking scheme, scoring rubric (use rubric)

**Known risk — per-attempt snapshot timing**: If snapshots are created when each candidate starts (not at exam publish), different candidates may receive different rubric versions if the teacher edits between starts. MVP accepts this risk; a future exam-publish-time snapshot would fix it.

**Publish validation**: Auto-graded questions (single_choice, multiple_choice, true_false, fill_blank) require a non-empty standardAnswer. text_response requires a non-empty rubric at publish time; standardAnswer is optional. Empty strings like "暂无" do not count as valid.

## Exam Lifecycle

**ExamStatus**: The lifecycle state of an exam (the container), independent of any candidate's attempt. 6 values; Phase 2 has implemented the full state and all transitions.
_Avoid_: exam state, exam phase, exam stage

- `draft` — teacher/admin editing; candidates cannot see the exam or start attempts
- `published` — released; candidates can see the exam and start attempts, but `now < openAt` (not yet auto-opened)
- `open` — `now >= openAt`; candidates can start attempts
- `closed` — normal end (`now >= closeAt` or admin close); no new attempts; existing attempts finish their own lifecycle independently
- `canceled` — **abnormal cancellation, NOT equivalent to `closed`**; results/exports carry a cancellation marker (full Phase 3 semantics)
- `archived` — terminal archive; reachable only from `closed` or `canceled`

**Transitions** (authoritative; mirrors `examStateMachine.ts`):

```
draft      → [published]
published  → [draft, open, canceled, archived]
open       → [closed, canceled]
closed     → [archived]
canceled   → [archived]
archived   → []  (terminal)
```

**Critical rules**:
- `published` and `open` are distinct and must not be collapsed. Both allow attempt start; they differ only by whether `now >= openAt`.
- `canceled` ≠ `closed`: `closed` is a normal end; `canceled` is an abnormal cancellation requiring a cancellation marker on results/exports.
- `archived` is the sole terminal state, reachable only from `closed` or `canceled`.

**Candidate attempt boundary**: Candidates may start attempts only when `ExamStatus` is `published` or `open` (`OPEN_STATUSES = { published, open }` in `attemptCommands.ts`). `draft`, `closed`, `canceled`, and `archived` reject attempt start.

**Command functions**: All status changes go through centralized command functions (`packages/exam-engine/src/examCommands.ts`); mutating `status` directly in a route is forbidden.

- `publishExam` — draft → published (builds QuestionSnapshot; guards: ≥1 question, valid schedule, authoring timing mode (`timed_window`/`deadline`/`untimed`; `timed_sync` rejected until Phase B activation), manual selection, valid retake policy, score totals)
- `openExam` — published → open
- `closeExam` — open → closed (idempotent: already-closed returns unchanged)
- `cancelExam` — published|open → canceled (NOT idempotent; does not void/force-submit attempts — that guard is route-layer)
- `unpublishExam` — published → draft (route reconciles by-now first; a `published` exam past openAt is rejected; open→draft is never accepted)
- `extendExam` — open → open (extends `closeAt` only; positive integer minutes; preserves remaining-window semantics)
- `archiveExam` — closed|canceled → archived
- `publishResults` — NOT a state transition; sets `resultsPublishedAt` (drives resultVisibility → visible)
- `checkAndUpdateExamStatus` — lazy reconcile-by-now (published→open when `now >= openAt`; open→closed when `now >= closeAt`); called at admin operations and candidate entry points

_Avoid_ (command names): `reopen` (use `open`/`openExam`), `delete` (use `archive`/`archiveExam`).

## Exam Attempt Lifecycle

**AttemptStatus**: The lifecycle state of a candidate's exam attempt. 8 values; the API also returns derived capability fields.
_Avoid_: attempt state, attempt phase

- `not_started` — enrolled but not yet started
- `queued` — waiting for batch entry (Phase 2)
- `in_progress` — candidate is actively taking the exam; `answers` is writable
- `disrupted` — heartbeat timeout; candidate disconnected
- `submitted` — candidate submitted; `submitted_answers` frozen; `gradingStatus` may be `pending_manual` if manual grading is needed
- `grading` — auto-grading in progress (transient machine-only; not used for human grading wait)
- `graded` — all scoring complete (both auto and manual); result visibility depends on visibility policy
- `voided` — terminal override; may or may not have `submitted_answers`

**GradingStatus**: The scoring lifecycle dimension, independent of AttemptStatus.
_Avoid_: score status, grading phase

- `auto_graded` — scored entirely by the auto-grading engine (set at submit freeze for pure-objective attempts)
- `pending_manual` — manual grading needed (text_response questions exist)
- `fully_graded` — all scoring complete

> The historical `pending_auto` value has been removed; it is not in the current enum (`packages/domain/src/enums.ts`). Pure-objective attempts are set to `auto_graded` at the submit freeze barrier.

**Critical rule**: The manual grading queue's work truth source is the materialized `attempt_grading_entries` (predicate: `grading_mode='manual' AND status='pending_manual'`), NOT `gradingStatus` and NOT an `attemptStatus = 'grading'` query. `gradingStatus` describes the attempt-level scoring lifecycle/display state but cannot manufacture or rebuild queue work items; `gradingStatus = 'pending_manual'` without a matching pending entry does not appear in the queue (ghost-attempt guard). The `grading` attemptStatus is a transient auto-grading indicator only.

**State machine discipline**: All state changes go through集中 command functions (`submitAttempt`, `resumeAttempt`, `markDisrupted`, `gradeQuestion`, `voidAttempt`). Each command uses a transition matrix with business guards, executed inside a database transaction with row lock or conditional update. DB is the fact source; domain state machine defines allowed transitions; API returns derived capabilities; frontend consumes derived capabilities, not raw DB state.

> The historical `completeManualGrading` command does not exist in current production code; the one-way pending-only manual completion command is `gradeQuestion` (`packages/exam-engine/src/manualGrading.ts`).

**Derived attempt capabilities**: API returns these alongside raw `attemptStatus`; frontend consumes these, not raw status.
_Avoid_: computed permissions

- `isEditable` — can the candidate save answers now; `isEditable = attemptStatus === 'in_progress' && serverNow < effectiveDeadline`; computed server-side, never by frontend
- `canStart` — can the candidate begin this attempt
- `canResume` — can the candidate resume a disrupted attempt
- `canSave` — can the candidate save answers (subset of isEditable)
- `canSubmit` — can the candidate submit
- `lockReason` — why the UI is locked (e.g. `'deadline'`, `'submitted'`, `'voided'`); present when `isEditable=false`

**answers** (column): The candidate's editable work-in-progress answers. Mutated by saveAnswer. Only writable when attempt is `in_progress`. Read by the candidate during the exam.
_Avoid_: working answers, draft column

**submitted_answers** (column): The frozen snapshot of answers at submit time. Written once in the submit transaction as a clean `SubmittedAnswersSnapshot` (no clientSeq/baseVersion). Immutable after submit. Used exclusively by grading and result computation.
_Avoid_: final answers, locked answers, grading answers

**SubmittedAnswersSnapshot**: The shape of `submitted_answers`: `{ schemaVersion: 1, answers: { questionId: string, value: unknown }[] }`. Derived from draft answers by normalizing against the exam question snapshot and stripping protocol metadata.

**submitted_answers_hash**: NOT a DB column in MVP. Hash utilities (`hashSubmittedAnswers()`) exist for testing, backfill verification, and optional audit logging, but idempotency is guaranteed by transactions + status guards + submitted_answers immutability, not by hash comparison.

**submit freeze barrier**: The single-transaction operation that reads `answers`, normalizes them to `SubmittedAnswersSnapshot`, writes to `submitted_answers`, transitions attempt to `submitted`, and rejects any concurrent saveAnswer. Defined in ADR-008.
_Avoid_: submit lock, answer lock

**Deadline reconciliation**: Lazy-triggered at candidate attempt entry points (`/take`, save, submit, resume) via shared `ensureAttemptDeadlineReconciled(attemptId, serverNow)`. No后台 worker, no定时扫描, no Redis.

**GET 写副作用警告**: `GET /candidate/attempts/:attemptId/take` may trigger deadline reconciliation (transactional write). This is a command-style GET with side effects. Response must include `Cache-Control: no-store`. Documentation must acknowledge this: SWR, prefetch, CDN, and HTTP cache layers must not cache this endpoint.

Trigger: `attemptStatus in ('in_progress', 'disrupted') && serverNow >= effectiveDeadline`.

`effectiveDeadline` = min(exam deadline, attempt deadline, extension-adjusted deadline) — derived from existing fields, no new deadline model.

Behavior in transaction:
1. Lock attempt row (`FOR UPDATE`)
2. If not expired → return attempt unchanged
3. If `submitted/grading/graded` → return existing (already frozen)
4. If `voided/not_started/queued` → return unchanged
5. Load question snapshot, build `SubmittedAnswersSnapshot` from draft `answers`
6. Derive grading plan from snapshot (fully auto-gradable → `graded` + `fully_graded`; has manual → `submitted` + `pending_manual`)
7. Set `attemptStatus`, `submittedAt = effectiveDeadline`, `submissionReason = 'deadline'`
8. Audit `action = 'attempt.deadline_reconciled'`, `effectiveAt = effectiveDeadline`, `occurredAt = serverNow`
9. Idempotent: repeated calls do not overwrite existing `submitted_answers` or `submittedAt`

Save after deadline: reconcile first (L0-3 freezes the attempt inside the save entry transaction), then return `ATTEMPT_ALREADY_SUBMITTED` (the attempt is now deadline-submitted, so the save is rejected as already-submitted). The legacy `DEADLINE_EXCEEDED` reason is superseded: both communicate the same invariant — no save accepted past the deadline. Optionally附带最新 CandidateTakeSnapshot.

Submit after deadline: reconcile first, return existing deadline-submitted snapshot; do not accept new answer payload.

**Backfill strategy**: `submitted_answers` is populated by a separate TypeScript backfill script (not Drizzle migration). Covers all attempts with submit semantics: `submitted`, `grading`, `graded`, and `voided` with non-null `submittedAt`. Abnormal data fails fast by default; `--allow-quarantine` routes quarantined attempts to a report.

## Result Visibility

**resultVisibility**: Whether the candidate can see their score/pass status after grading.
_Avoid_: score visibility, result release mode

- `hidden` — not yet released
- `visible` — released to candidate

**answerVisibility**: Whether the candidate can see standardAnswer/rubric after grading. Independent of resultVisibility.
_Aavoid_: standard answer visibility, answer release

- `hidden` — standardAnswer/rubric not shown
- `visible` — standardAnswer/rubric shown

## DTO Boundaries

**CandidateTakeSnapshot**: The unified response from `GET /candidate/attempts/:attemptId/take`. Contains attempt metadata, derived capabilities (`attemptStatus`, `isEditable`, `canSave`, `canSubmit`, `resultVisibility`, `answerVisibility`, `submittedAt`, `serverRevision`), server time fields (`serverNow`, `effectiveDeadline`), safe questions with `answerValue` (the single answer view for the current state), and `answerSource: 'draft' | 'submitted' | 'none'`. Never contains standardAnswer, rubric, gradingMode, correctOption, teacher notes, or unreleased scores. This is the business truth source for the frontend; the frontend derives its view from this snapshot via a pure function, not from local state.
_Avoid_: take-exam response, candidate exam DTO

**GradingQuestionDTO**: The question shape returned to the grader during manual scoring. Contains standardAnswer, rubric, gradingMode, and `submittedAnswer` (from `submitted_answers`, not draft).
_Avoid_: grading detail DTO, score question DTO

**ResultDTO**: The result shape returned to the candidate after result release. Contains score and pass status; standardAnswer only if answerVisibility allows.
_Avoid_: score DTO, exam result DTO
