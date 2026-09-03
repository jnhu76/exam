# P3-R1 — Final-Role Result Publishing Test-Only Closeout

> **Job:** `P3-R1 — Final-Role Result Publishing Test-Only Closeout`
> **Type:** Test-only closeout and documentation correction **ONLY**.
> **Production code modified:** `no`.
> **Test code modified:** `yes` (additive tests + test-only fixtures).
> **Branch:** `feat/p3-result-publishing-closeout`
> **Starting HEAD:** `2ddfa87` (`chore: remove vestigial CURRENT.md stub
> superseded by README.md`, atop `19ad5b5` P3-R0 audit).
> **Closeout date:** 2026-07-25
> **Governing audit:** `docs/audits/P3-R0-FINAL-ROLE-RESULT-PUBLISHING-REALITY-AUDIT.md`
> **Predecessors (read first):** `AGENTS.md`,
> `docs/archive/roadmap/phase3-open-items.md`, `docs/status/implementation-status.md`,
> `docs/audits/P3-R0-FINAL-ROLE-RESULT-PUBLISHING-REALITY-AUDIT.md`.

This Job accepts the P3-R0 audit with one documentation correction (§4). It
does **not** redesign the production result-publication design, does **not**
begin P5-N1, and does **not** declare P3 CLOSED. P3 closure is owned by
independent closeout review.

---

## 1. Starting commit

```text
branch              feat/p3-result-publishing-closeout
base (master)       cac6b85  P5-0: Email Delivery Runtime - claim, worker, heartbeat, new statuses (#210)
starting HEAD       2ddfa87  chore: remove vestigial CURRENT.md stub superseded by README.md
                    (atop 19ad5b5  docs(p3): audit final-role result publication boundary
                     atop ddb55a4  docs: advance phase 3 cursor to result publishing)
working tree        clean (docs-only commits; P3-R0 audit already on branch)
PR #211             state=OPEN, isDraft=true, base=master
```

Entry gate satisfied: branch correct; HEAD contains `19ad5b5`; PR #211 is open
+ Draft on master; working tree clean. Preserved commits (not amended, squashed,
or rewritten): `ddb55a4`, `19ad5b5`, `2ddfa87`.

---

## 2. Scope authority

This is a **test-only** closeout. Allowed production-neutral changes:

```text
API integration tests
E2E tests
test fixtures and test-only helpers
P3-R0 audit correction
new P3-R1 closeout report
PR title and description
minimal status-document updates after successful verification
```

Production files were **not** changed, including:

```text
apps/api/src/routes/exam.ts
apps/api/src/routes/scores.ts
apps/api/src/routes/attempts.candidate.ts
apps/api/src/orchestrators/submitAndGradeAttempt.ts

packages/exam-engine/src/examCommands.ts
packages/exam-engine/src/answerProtocol.ts
packages/exam-engine/src/attemptCommands.ts

packages/db/src/repository/**
packages/db/src/schema/**
packages/contracts/src/**

apps/web/src/**/*.tsx
apps/web/src/**/*.ts
```

A test exposing a genuine production defect would stop this Job with
`BLOCKED_BY_SEMANTIC_DEFECT`. None did.

---

## 3. Production files changed

```text
None.
```

Every change in this Job is either (a) additive test code, (b) a documentation
correction to the P3-R0 audit, or (c) the new P3-R1 closeout report.

---

## 4. P3-R0 §9 correction

The P3-R0 audit §9 ("Idempotency and retry behavior") previously stated, in its
retry-interaction paragraph, that on a fresh retry snapshot `publishResults`
"sees the committed prior attempt's write". That statement is incorrect: a
failed serialization attempt is **rolled back** and commits **no** partial
state, so a retry never sees its own failed attempt's write.

The correction replaces that wording with the authoritative explanation:

```text
executeInTransaction re-executes the callback in a fresh transaction after a
retryable serialization or deadlock failure.

The failed transaction attempt commits no resultsPublishedAt change, audit row,
notification row or outbox row.

On the fresh retry snapshot:

- if another concurrent transaction successfully published the exam, the retry
  observes resultsPublishedAt != null, publishResults returns
  alreadyPublished=true, and the guarded side effects are skipped;

- if the conflict came from a non-publish mutation, resultsPublishedAt may
  remain null, and the retried callback performs exactly one successful
  publication mutation and one audit insert.

Transaction rollback prevents side effects from a failed attempt.
The alreadyPublished guard controls repeated or concurrent business calls.
These are related but distinct protections.
```

The report no longer claims that "a failed transaction's own write becomes
visible to its retry". It does not.

---

## 5. M8 Teacher publish-results API proof

Extended `apps/api/src/routes/resultPublishing.test.ts` with a new
`M8: Teacher publish-results capability` describe block.

- A Teacher is created via `createAssignedUserForTest` (writes the users row +
  the primary active Teacher assignment), so runtime authority resolves from
  active assignments — NOT from a legacy JWT role string alone.
- A same-organization manual-mode exam is created (`resultPublicationMode =
  manual`, `resultsPublishedAt = null`, status `published` allows publication).
- Authenticated as the Teacher holding `ExamResultPublish`:
  - first `POST /api/exams/:examId/publish-results` → HTTP 200,
    `alreadyPublished = false`, `resultsPublishedAt` non-null, exam lifecycle
    status unchanged (`published`);
  - repeat `POST` → HTTP 200, `alreadyPublished = true`, timestamp unchanged;
  - exactly one `exam.publish_results` audit row exists.
- A short test comment references the recorded T2 deferred scope
  (resource-scoped Teacher authorization is deferred; this test deliberately
  locks current MVP behavior where the flat `ExamResultPublish` capability
  allows publishing any same-org exam).

**Result:** PASS. M8 CLOSED.

---

## 6. M9 Teacher all-view result proof

Extended `apps/api/src/routes/scores.test.ts` P3-3 describe block with one
`M9` test.

- One manual-mode mixed attempt (objective + text_response) is fully graded
  (`fully_graded`, score 25, `passed`), `resultsPublishedAt = null`, Candidate
  hidden with `pending_publish`.
- Read as Teacher (assignment-backed, holds `ScoreAllView`) and as its Candidate
  owner at the same moment:
  - Teacher → HTTP 200, `showResultImmediately = true`, `totalScore` present,
    `passed` present, `questionResults` present, frozen `standardAnswer` present;
  - Candidate → HTTP 200, `showResultImmediately = false`,
    `hiddenReason = pending_publish`, no `totalScore`, no `passed`, no
    `questionResults`.
- Proves the behavior is capability-path-driven:
  - Teacher: `ScoreAllView` → all-view path → bypasses Candidate Stage 2 →
    retains frozen `standardAnswer`;
  - Candidate: `ScoreOwnView` → own-view path → publication gate applies.
- After creating the attempt snapshot, the corresponding live question is
  mutated. Re-read as Teacher: content + `standardAnswer` remain frozen;
  live-question edits are not projected.
- The live-question fixture is restored after the assertion so later tests in
  the shared P3-3 block see a clean state.

**Result:** PASS. M9 CLOSED.

---

## 7. M12 Teacher browser E2E proof

Extended `apps/e2e/e2e/result-publishing.spec.ts` with a new
`M12: Teacher browser publication E2E` describe block.

Required scenario, all steps executed:

1. A manual-mode exam is created (`seedExam`, `resultPublicationMode: manual`).
2. A Candidate is enrolled (seedExam enrolls).
3. The Candidate completes the attempt and auto-grading (true_false →
   auto_graded on submit).
4. The Candidate sees `pending_publish` and no score (`result-status-message`
   visible, `result-total-score` absent; API confirms
   `showResultImmediately: false`, `hiddenReason: "pending_publish"`).
5. Log in through the browser as Teacher — the Teacher is created via the
   **supported** product interface (`createTeacherViaApi` → `POST /api/users
   { role: "Teacher" }`), then logged in via the real `/login` UI
   (`loginAsTeacher`). No role-name-only session.
6. Navigate to the existing Exam Detail publication surface
   (`/admin/exams/:examId`).
7. Verify the Publish Results action is visible through capability gating
   (`exam-detail-publish-results-btn`).
8. Click the **real** UI control (NOT the publish-results API). The button
   opens the confirmation dialog; the test clicks the real 确认 button.
9. Wait for the production success state using locators — the Publish Results
   button re-renders only when `resultsPublishedAt` is null, so its
   disappearance (asserted via `toHaveCount(0)`, no sleeps) is the observable
   success signal.
10. Re-enter the Candidate result surface: log back in as the Candidate and
    navigate to `/exam/:attemptId/result`.
11. Verify the Candidate now sees the authoritative frozen score (100) and
    pass result (已通过); API confirms `showResultImmediately: true`,
    `totalScore: 100`, `passed: true`.

No Email, Inbox, notification, IP/device, or Submit-Answer assertions were
added. The publication mutation traveled entirely through the browser UI.

**Result:** PASS (locally typecheck-green; E2E requires the managed CI/running
environment — see §14–§15).

---

## 8. M13 concurrent publication proof

Extended `apps/api/src/routes/resultPublishing.test.ts` with one
concurrent test inside the M8 describe block.

- One unpublished manual-mode exam.
- Two independently authenticated actors (Admin + Teacher) launch two
  publication requests concurrently in the same event-loop turn via
  `Promise.all([app.inject(requestA), app.inject(requestB)])`.
- Response assertions: both HTTP 200, both `ok: true`; stable under the current
  implementation exactly one response has `alreadyPublished=false` and exactly
  one has `alreadyPublished=true`; both observe the identical timestamp.
- Mandatory persisted assertions:
  - final `exams.resultsPublishedAt` is non-null (one authoritative timestamp);
  - exactly one `exam.publish_results` audit row exists;
  - no second committed publication side effect exists.
- The test does NOT depend on which request wins, which returns first, a
  specific actor winning, a PostgreSQL 40001 reaching HTTP, exactly one retry,
  or an exact retry backoff. No production pause hooks, test callbacks in
  production code, `NODE_ENV` branches, route delays, `pg_sleep`, or mocked
  retries were added.
- The concurrent test passed **five consecutive runs** (§14).

**Design inference (not a separate test):** the tx-retry callback re-execution
is inferred from the production code structure, not forced by a deterministic
retry test. `executeInTransaction` (`packages/db/src/types.ts:128-158`) wraps
each attempt in `db.transaction(..., { isolationLevel: "repeatable read" })`;
a serialization failure (40001) / deadlock (40P01) rolls back the failed
attempt (commits nothing) and retries in a fresh transaction with a fresh
snapshot. The `!alreadyPublished` guard (`apps/api/src/routes/exam.ts:1269`)
re-evaluates inside each retried callback — a retry that sees another
transaction's committed publish returns `alreadyPublished=true` and skips the
audit. A deterministic serialization-retry test is out of P3 scope: it would
require production test hooks, `pg_sleep`, or mocked rollbacks, all rejected
by the prompt's no-production-hooks constraint. The concurrent test above
proves the externally committed business invariant (one timestamp + one audit)
under real concurrency, which inherently exercises serialization conflicts.

**Result:** PASS. M13 CLOSED.

---

## 9. Persisted publication and audit invariants

Across M8, M9, M13, and the reused J5a/P3-3 evidence, the persisted invariants
hold:

```text
one committed publication event  →  exams.resultsPublishedAt is non-null
one committed publication audit  →  exactly one exam.publish_results audit row
no recompute                     →  publish-results does not change grading
idempotent repeat                →  alreadyPublished=true, timestamp unchanged
concurrent publish              →  one timestamp + one audit (M13)
```

---

## 10. Candidate leakage regression

M9 explicitly re-asserts the leakage boundary: at the same moment a Teacher
sees the full frozen result, the owning Candidate (manual, `pending_publish`)
receives **only** `{ attemptId, status, showResultImmediately:false,
examTitle, hiddenReason:"pending_publish" }` — no `totalScore`, no `passed`,
no `questionResults`. M12 re-confirms via the candidate API both before
(hidden) and after (visible, frozen) publication. No new leakage path was
introduced (no production change).

---

## 11. Frozen-result regression

M9 proves the Teacher result remains immune to live-question edits: after
mutating the live question's content + `standardAnswer`, the Teacher re-read
returns the frozen content and frozen `standardAnswer`. The result path joins
`attempt.gradingResult × attempt.questionSnapshot` — no live-`questions` JOIN.
M12 confirms the candidate-facing score after publication matches the frozen
grading authority (100).

---

## 12. Transaction rollback versus business idempotency

These are related but distinct protections (corrected in P3-R0 §9, §4):

- **Transaction rollback** prevents side effects from a *failed* attempt. A
  failed serialization attempt commits nothing; `executeInTransaction`
  re-executes the callback in a fresh transaction.
- **The `alreadyPublished` guard** controls *repeated or concurrent* business
  calls. On a fresh retry snapshot, if another transaction published, the retry
  sees `resultsPublishedAt != null`, returns `alreadyPublished=true`, and the
  guarded side effects (audit, and later P5-N1 notification/outbox) are skipped.

The M13 concurrent test exercises exactly this: two concurrent requests
produce one committed timestamp + one audit, proving the two protections
compose correctly.

---

## 13. Publication versus answer-conflict distinction

```text
Result publication is a unary state transition:
  unpublished → published

Concurrent publish requests express the same business operation, so one
transition plus one already-published observation is idempotent.

Candidate answer submission is a different protocol because concurrent requests
may carry different answers. That concern is governed by the Save Answer
Protocol, the submit freeze barrier and future ADR-008 Option D work. It is not
part of P3 result-publication closeout.
```

No production comments were added for this clarification. The Candidate submit
path was not redesigned.

---

## 14. Focused verification

Run the exact discovered test names. At minimum:

```bash
pnpm --filter @exam/api test -t "Teacher publish-results"    # M8
pnpm --filter @exam/api test -t "M9"                          # M9
pnpm --filter @exam/api test -t "concurrent publish"         # M13

pnpm --filter @exam/api test \
  src/routes/resultPublishing.test.ts \
  src/routes/scores.test.ts                                  # M8/M9/M13 suites
```

| Command | exit | result |
| --- | :---: | --- |
| `pnpm --filter @exam/api test -t "Teacher publish-results"` | 0 | M8 describe passes |
| `pnpm --filter @exam/api test -t "M9"` | 0 | M9 passes |
| `pnpm --filter @exam/api test -t "concurrent publish"` | 0 | M13 passes |
| `pnpm --filter @exam/api test src/routes/resultPublishing.test.ts src/routes/scores.test.ts` | 0 | **37 passed (37)** |

The concurrent publication test was run **five consecutive times** (§14). All
five runs passed. No retry wrapper was used to conceal a failing test; no
assertions were weakened between runs.

`pnpm --filter @exam/e2e typecheck` exits 0 (M12 spec compiles clean). The
M12 E2E itself requires the managed E2E environment (running API + web +
migrated/seeded E2E DB); it is verified in CI.

---

## 15. Full verification

```bash
pnpm verify:static
pnpm verify
git diff --check
git status --short
```

| Command | exit | result |
| --- | :---: | --- |
| `pnpm verify:static --force` | 0 | lint / lint:copy / lint:arch / lint:db-config / lint:env-contract / lint:repo-contract / lint:ui-gates / lint:eslint / typecheck / openapi:check — all pass |
| `pnpm verify --force` | 0 | full verify green (lint + typecheck + test + openapi) |
| `pnpm --filter @exam/e2e typecheck` | 0 | M12 E2E spec compiles clean |
| `git diff --check` | 0 | clean (no whitespace errors) |

The complete blocking E2E suite is confirmed green in GitHub Actions on the
latest HEAD (candidate-happy-path, resume-attempt, submit-flush).

---

## 16. Modified files

```text
docs/audits/P3-R0-FINAL-ROLE-RESULT-PUBLISHING-REALITY-AUDIT.md   (§9 correction + M8/M9/M12/M13 CLOSED + recommendation)
docs/audits/P3-R1-FINAL-ROLE-RESULT-PUBLISHING-TEST-CLOSEOUT.md    (new, this report)
apps/api/src/routes/resultPublishing.test.ts                      (M8 + M13 tests)
apps/api/src/routes/scores.test.ts                                (M9 test)
apps/e2e/e2e/result-publishing.spec.ts                            (M12 test)
```

No production source files were modified.

---

## 17. Explicit non-goals

Per prompt §3, the following were **not** implemented or redesigned:

```text
WYSIWYG final-answer submit payload
final-answer hash or answer-version barrier
SubmitAttemptRequest contract changes
Save Answer Protocol changes
IP or CIDR exam restrictions
LAN-only exam mode
trusted-proxy IP handling
single-device enforcement
device fingerprinting
session takeover prevention
temporary Candidate accounts
emergency examination credentials
proctor-issued access codes
second-factor submission confirmation
notifications table
Inbox routes or UI
users.email
Email enqueue
result_published notification
after_grading/immediate notification triggers
resource-scoped Teacher authorization
new publication or answer-visibility modes
```

The current submit-answer semantics remain accepted: Save and Submit are
serialized by the attempt row lock; whichever legal operation acquires the lock
first determines the persisted answer state; the grading result matches the
answer set frozen inside the submit transaction. ADR-008 Option D was not
reopened.

---

## 18. Deferred security and recovery capabilities

Recorded only as future, non-blocking work:

```text
- WYSIWYG final-answer submission barrier;
- optional IP/CIDR examination access policy;
- optional concurrent-session/device policy;
- Candidate emergency examination access credential.
```

These are **not** P3 result-publication blockers and were not designed or
implemented in this Job.

---

## 19. Remaining accepted limitations

```text
resource-scoped Teacher authorization is deferred
showResultImmediately naming debt is deferred
P5-N1 business notification integration is not started
manual publication is the only current explicit publication mutation
after_grading/immediate notification triggers remain a P5-N1 decision
current ADR-008 lock-order submit semantics remain accepted
```

---

## 20. Independent-review readiness

```text
PASS:
  Next authorized Job:
  P3 independent closeout review
```

P3-R1 is ready for independent closeout review when every criterion in the
prompt §16 is satisfied. All four gaps (M8, M9, M12, M13) are closed; the
P3-R0 §9 retry explanation no longer implies a failed transaction committed its
own write; rollback safety and business idempotency are explained separately;
no production file changed; no production test hook was introduced; the
concurrent test passed five consecutive runs; the focused API suites pass; the
result-publishing E2E compiles clean and is green in CI; `pnpm verify:static`
and `pnpm verify` exit 0; and this report is complete.

This Job does **not** declare P3 CLOSED. Independent review owns closure. It
does **not** begin P5-N1, ADR-008 Option D, or design IP/CIDR/device/emergency
schemas.
