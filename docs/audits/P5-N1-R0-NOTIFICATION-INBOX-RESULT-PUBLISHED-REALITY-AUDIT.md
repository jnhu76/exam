# P5-N1-R0 — Notification Inbox + Result-Published Integration Reality Audit

> **Job:** `P5-N1-R0 — Notification Inbox + Result-Published Integration Reality Audit`
> **Type:** Reality audit and specification correction. Production code modified:
> **no**. Test code modified: **no**. Migration files modified: **no**.
> Documentation modified: **yes**.
> **Branch:** `feat/p5-n1-notification-inbox`
> **Starting master commit:** `1c46a96` (Merge pull request #212 — `c58ac6d`
> PR #211 is an ancestor)
> **Audit date:** 2026-07-25
> **Predecessors (read first):** `docs/audits/P3-R0-FINAL-ROLE-RESULT-PUBLISHING-REALITY-AUDIT.md`,
> `docs/audits/P3-R1-FINAL-ROLE-RESULT-PUBLISHING-TEST-CLOSEOUT.md`,
> `docs/roadmap/P5-N1-notification-inbox-result-published-job-v2.md`,
> `docs/adr/ADR-011-notification-and-email-delivery.md`.

This audit reconciles the P5-N1 Job v2 with the post-P5-0 and post-`1c46a96`
repository reality, freezes the smallest product-complete V1 contract, and
recommends the exact implementation Jobs.

This audit does **not** implement production code, add migrations, add tests,
begin the Inbox UI, or enqueue any real Email.

---

## 1. Verdict

```text
PASS:
  Next authorized Job:
  P5-N1-I1 — notification domain + contracts + migration + optional users.email
  (decomposed in §26; the V1 trigger / recipient / attempt / dedupe / schema /
  Email mapping decisions below must be read as the binding contract for I1–I3).
```

P3 is closed. The P5-N1-R0 audit owns the V1 contract correction. The single
unresolved product semantic (recipient eligibility / attempt selection, §10) is
answerable from existing repository authority — it resolves to **option D with
a documented composition rule** rather than `BLOCKED_BY_PRODUCT_SEMANTIC`. The
repository provides a stable, frozen, idempotent, retry-safe transaction seam
(P3-R0 §13 confirmed against current code at `apps/api/src/routes/exam.ts:1269`
and `packages/exam-engine/src/examCommands.ts:392`). P5-0 delivery runtime is
complete and proven. No architecture conflict blocks P5-N1; ADR-011's status is
corrected to **Accepted**.

---

## 2. Starting master commit

```text
branch              feat/p5-n1-notification-inbox
base (master)       1c46a96  Merge pull request #212 from jnhu76/audit/exam-protocol-state-data-authority
PR #210             state=MERGED, mergedAt=2026-07-25T03:19:33Z, mergeCommit=cac6b85
PR #211             state=MERGED, mergedAt=2026-07-25T08:32:32Z, mergeCommit=c58ac6d, headRefOid=c0d9bd8
c58ac6d ancestor    YES (merge-base --is-ancestor confirmed)
cac6b85 ancestor    YES
working tree        clean (docs-only changes)
pnpm verify         exit 0
```

Entry gate satisfied. The local branch `feat/p5-n1-notifacation` (typo, empty,
identical to master) was deleted; the canonical `feat/p5-n1-notification-inbox`
branch was created from the verified HEAD.

---

## 3. Authority read

### 3.1 Documentation authority (read in full)

- `AGENTS.md` (product generalization, phase rules, tech stack, repository
  pattern, frontend visual authority, exam-specific gotchas).
- `docs/roadmap/current.md`, `docs/roadmap/phase-roadmap.md`,
  `docs/roadmap/phase3-open-items.md`.
- `docs/status/implementation-status.md`.
- `docs/roadmap/P5-N1-notification-inbox-result-published-job-v2.md` (the
  specification to reconcile).
- `docs/roadmap/P5-0-email-delivery-runtime-hardening-job.md` (the P5-0
  baseline the audit measures against).
- `docs/adr/ADR-011-notification-and-email-delivery.md` (architecture
  authority — status corrected Proposed → Accepted by this audit).
- `docs/adr/ADR-003-job-queue.md` (queue decision — `Deferred`; PostgreSQL
  outbox remains the queue).
- `docs/architecture/email-config.md` (operational config companion).
- `docs/audits/P3-R0-FINAL-ROLE-RESULT-PUBLISHING-REALITY-AUDIT.md`.
- `docs/audits/P3-R1-FINAL-ROLE-RESULT-PUBLISHING-TEST-CLOSEOUT.md`.

### 3.2 Code authority read (executable evidence)

| Concern | File:line |
| --- | --- |
| Publication command | `packages/exam-engine/src/examCommands.ts:392-417` (`publishResults`) |
| Publication route (tx boundary) | `apps/api/src/routes/exam.ts:1258-1301` (`POST /exams/:id/publish-results`) |
| Result-visibility computation | `apps/api/src/routes/scores.ts:173-226` (`computeResultVisibility`) |
| Transaction helper | `packages/db/src/types.ts:128-158` (`executeInTransaction`) |
| Atomic audit writer | `apps/api/src/audit/auditWriter.ts:130-140` (`recordAtomicHttpAudit`) |
| Email domain types | `packages/domain/src/email.ts:1-117` |
| `EmailDeliveryService` | `apps/api/src/email/emailDeliveryService.ts:29-105` |
| `EmailOutboxService` | `apps/api/src/email/outboxService.ts` |
| Email senders | `apps/api/src/email/senders.ts` |
| Email plugin | `apps/api/src/plugins/email.ts` |
| Email worker | `apps/api/src/workers/emailDeliveryWorker.ts:1-262` |
| Outbox repo (claim/lock/recovery) | `packages/db/src/repository/emailOutboxRepo.ts:221-458` |
| Heartbeat repo | `packages/db/src/repository/workerHeartbeatRepo.ts` |
| Diagnostics | `apps/api/src/routes/system.ts:46-166` (`buildEmailStatus`) |
| Outbox schema | `packages/db/src/schema/pg.ts:584-672` |
| Heartbeat schema | `packages/db/src/schema/pg.ts:681-714` |
| `users` schema | `packages/db/src/schema/pg.ts:103-122` |
| Enrollment schema | `packages/db/src/schema/pg.ts:270-296` |
| Enrollment repo | `packages/db/src/repository/enrollmentRepo.ts:1-126` |
| Attempt repo | `packages/db/src/repository/attemptRepo.ts` |
| Score strategy | `packages/exam-engine/src/grading.ts:38-54` (`shouldSelectAttempt`) |
| Terminal grading | `packages/exam-engine/src/grading.ts:224-354` (`finalizeTerminalGrading`) |
| Score contracts | `packages/contracts/src/score.ts:208-288` |
| User contracts | `packages/contracts/src/user.ts` |
| Candidate contracts | `packages/contracts/src/candidate.ts` |
| Pagination contract | `packages/contracts/src/common.ts:8-36` |
| Error types | `packages/domain/src/errors.ts` |
| Route registry | `apps/api/src/authz/routeRegistry.ts` |
| Auth plugin | `apps/api/src/plugins/auth.ts:257-274` |
| User route | `apps/api/src/routes/user.ts` |
| Candidate route | `apps/api/src/routes/candidate.ts` |
| i18n default locale | `apps/web/src/i18n/index.ts:18` (`zh-CN`) |
| Candidate layout | `apps/web/src/components/layout/ExamLayout.tsx:29-117` |
| Route helpers | `apps/web/src/lib/routes.ts` |
| Result page | `apps/web/src/pages/exam/ResultPage.tsx` |
| API client | `apps/web/src/lib/api.ts:42-95` |
| Polling pattern | `apps/web/src/pages/admin/ProctorDashboardPage.tsx:128-134` |

Migrations read: `packages/db/migrations/postgres/0016_exam_score_invariant.sql`,
`0017_email_delivery_runtime.sql`, `0018_email_outbox_constraints.sql`.

---

## 4. Active roadmap synchronization

After verifying PR #211 (merged, `c58ac6d` an ancestor of master HEAD
`1c46a96`) and its independent closeout evidence (P3-R0 audit + P3-R1
test-only closeout: M8 Teacher publish API proof, M9 Teacher all-view result
proof, M12 Teacher browser publication E2E, M13 concurrent publication
idempotency — all passing, no production changes), the active roadmap state was
synchronized:

| Document | Change |
| --- | --- |
| `docs/roadmap/current.md` | P3 → ✅ CLOSED; P5-N1 → 🔄 REALITY AUDIT IN PROGRESS; P6 → ⏸ BLOCKED on P5-N1 |
| `docs/roadmap/phase3-open-items.md` | P3 → CLOSED; P5-N1 → REALITY AUDIT IN PROGRESS; P5-N1 §"NOT AUTHORIZED" expanded with anti-overdesign items |
| `docs/status/implementation-status.md` | P3 → ✅ CLOSED; P5-N1 → 🔄 REALITY AUDIT IN PROGRESS (P5-N1-R0) |

Commit: `docs: advance phase 3 cursor to P5-N1`.

---

## 5. ADR-011 reconciliation

ADR-011 (`docs/adr/ADR-011-notification-and-email-delivery.md`) is the
architecture authority. Its `Status:` header read `Proposed` at audit start.
Multiple roadmap documents (`implementation-status.md:93`,
`phase3-open-items.md:85,92`) already described it as accepted. The ADR's core
decisions (two-channel Inbox + async Email outbox, PostgreSQL-backed queue, no
BullMQ/Kafka, atomic business transaction, validated `PUBLIC_WEB_ORIGIN` /
`actionPath`, at-least-once delivery) are the basis on which P5-0 and P3 were
implemented and merged. The audit therefore **corrects the status to Accepted**
(`Status: Accepted (2026-07-25, P5-N1-R0)`).

The ADR's §2.1 "Current implementation facts" table was stale (it described a
pre-P5-0 state). It is updated in place to reflect post-P5-0 reality, with
`Evidence` column citations. The reconciliation of every ADR statement against
current repository fact:

| ADR statement | Current repository fact | Status |
| --- | --- | --- |
| `email_outbox` status `pending`, `sent`, `failed` | `pending`, `processing`, `retry_wait`, `sent`, `dead` (5-state; migration `0017` mapped `failed`→`dead`, deferred `pending`→`retry_wait`) | **IMPLEMENTED_BY_P5_0** |
| No `locked_at`/`locked_by`; no `FOR UPDATE SKIP LOCKED` | Both exist; claim SQL at `emailOutboxRepo.ts:240-268` | **IMPLEMENTED_BY_P5_0** |
| `EmailNotificationService` (manual invoke, no daemon) | Renamed to `EmailDeliveryService` (`emailDeliveryService.ts:29`); worker is resident daemon (`emailDeliveryWorker.ts:150-222`); `EmailNotificationService` class no longer exists in source | **IMPLEMENTED_BY_P5_0** (rename done; service unwired) |
| Worker manually invoked, no background daemon | `while(!shuttingDown)` poll loop, heartbeat each cycle, graceful shutdown on SIGTERM/SIGINT | **IMPLEMENTED_BY_P5_0** |
| `EMAIL_ENABLED=false` outbox rows ARE written | Enqueue layer is NOT gated by `enabled`; `DisabledEmailSender` only no-ops the send path. Net: disabled→rows would be marked `sent` with null provider id. No business caller exists today. | **CURRENT** (behavior preserved; moot until a caller exists) |
| `apps/api/src/notifications/` does not exist | Still does not exist — P5-N1 owns | **STILL_TARGET** |
| `apps/api/src/workers/` does not exist | EXISTS — `emailDeliveryWorker.ts` (P5-0) | **IMPLEMENTED_BY_P5_0** |
| Diagnostics worker status `unknown` (no daemon) | `buildEmailStatus` resolves `worker.status` from heartbeat row; exposes `outbox.{pending,processing,retryWait,sent,dead}`, `oldestPendingAge`, `lastSuccessfulDeliveryAt` | **IMPLEMENTED_BY_P5_0** |
| `notification_id` nullable FK on `email_outbox` | Does NOT exist — P5-N1 owns | **STILL_TARGET** |
| `recipient_user_id` nullable FK on `email_outbox` | Does NOT exist — P5-N1 owns | **STILL_TARGET** |
| `users` table has no email column | Confirmed absent (`pg.ts:106-114`; migrations 0001-0018) — P5-N1 adds optional `users.email` | **STILL_TARGET** |
| At-least-once delivery limitation | Worker reuses one row on retry; `dedupe_key` prevents duplicate row creation; SMTP-accept-but-DB-unconfirmed window remains | **CURRENT** (no code change required) |
| `PUBLIC_WEB_ORIGIN` runtime setting | Does NOT exist in `runtimeConfig.ts` or `.env.example` (only `CORS_ORIGIN`) — P5-N1 adds | **STILL_TARGET** |
| Opaque base64url cursor pagination for Inbox | Not yet built; NOTE: existing repo convention is offset/page (`PaginationParamsSchema` `common.ts:8-36`), not cursor — §19 corrects the ADR | **NEEDS_DOC_CORRECTION** |
| Static code-level V1 channel policy (`policy.ts`) | Not yet built — P5-N1 owns | **STILL_TARGET** |
| Action-path two-layer validation (`actionLink.ts`) | Not yet built — P5-N1 owns | **STILL_TARGET** |
| Batch announcement fan-out excluded from V1 | Confirmed; no code exists | **CURRENT** |

---

## 6. P5-N1 Job v2 reconciliation

The P5-N1 Job v2 (`docs/roadmap/P5-N1-notification-inbox-result-published-job-v2.md`)
was reviewed statement-by-statement against current repository authority.

### 6.1 Speculative / stale statements to CORRECT

| Job v2 statement | Verdict | Correction |
| --- | --- | --- |
| §6 "current verified user schema has no email column" | **CURRENT** (true) | Keep. |
| §8.2 "Add `notification_id` nullable FK" | **KEEP** | Add in P5-N1. |
| §8.2 "Add `recipient_user_id` nullable FK" | **KEEP** | Add in P5-N1 (or derive from notification join — see §12). |
| §9 "`publicationVersion`" in dedupe key | **REMOVE_AS_STALE** | No `publicationVersion` concept exists. Publication is a single irreversible `resultsPublishedAt: null → non-null` transition. Dedupe key = `result_published:{examId}` (see §11). |
| §9 "grade_notification:{attemptId}:{recipientUserId}:{publicationVersion}" | **CORRECT** | `result_published:{examId}` (Inbox) and `result_published:{examId}:{recipientUserId}` (outbox). No `publicationVersion`. |
| §10 `notifyResultPublished(tx, input)` with `publicationVersion`, `actionPath supplied` | **CORRECT** | Drop `publicationVersion`. `actionPath` is built by a trusted command-specific builder (see §16), NOT arbitrary caller-supplied. |
| §11 "Refactor result publication into shared transaction boundary" | **REMOVE_AS_STALE** | The transaction boundary ALREADY exists and is exactly the P3-R0 §13 seam (`exam.ts:1263-1281`). No refactor needed — only a guarded extension inside `!alreadyPublished`. |
| §11 "Remove the old Email-only trigger" | **REMOVE_AS_STALE** | There IS no old route-local Email trigger for results (verified: zero callers of `EmailDeliveryService` in `apps/api/src/routes/`). Nothing to remove. The Job v2's "no double-send" requirement is satisfied vacuously. |
| §11 "the old route-local Email path is removed in the same change" | **REMOVE_AS_STALE** | No such path exists (see above). |
| §13 "opaque cursor pagination" | **CORRECT** | Existing repo convention is offset/page (`PaginationParamsSchema`, `PaginatedResponseSchema`, `common.ts:8-36`). V1 Inbox SHOULD reuse that convention, not introduce a new opaque-cursor pattern. |
| §13 route list (`GET /notifications`, `/unread-count`, `POST /:id/read`, `POST /read-all`) | **KEEP** | All four are needed by the first UI. |
| §14 "NotificationBell + list page or panel" | **KEEP** (narrowed) | V1 = bell + small panel (see §20). |
| §15 "`EMAIL_ENABLED=false` still leaves Inbox authoritative" | **KEEP** | Preserved. |
| §18 step 8 "Refactor result publication into shared transaction boundary" | **REMOVE_AS_STALE** | Already a shared tx boundary. |
| §18 step 9 "Remove old Email-only trigger" | **REMOVE_AS_STALE** | Does not exist. |
| §8.1 columns: `severity`, `resource_type`, `resource_id`, `archived_at`, `invalidated_at` | **DEFER / REMOVE_AS_STALE** | Not needed by V1 behavior (see §12). |

### 6.2 OVERDESIGNED_FOR_V1 items

These Job v2 proposals are rejected for V1 (recorded as deferred capabilities,
§23):

- `publicationVersion` (does not exist; the single irreversible transition is
  the stable key).
- Generic whitelist-based `actionPath` validator with a "generic
  NotificationService" URL-security framework (overdesigned: only one trusted
  builder, `buildResultPublishedActionPath(attemptId)`, is needed — see §16).
- `severity`, `resource_type`, `resource_id`, `archived_at`, `invalidated_at`
  columns (no V1 reader/writer — see §12).
- Opaque base64url cursor pagination (inconsistent with repo's offset/page
  convention — see §19).
- Removal of a nonexistent old Email caller (§11, §18).
- Transaction refactor (already correct — see §17).

---

## 7. Current P5-0 runtime baseline

The P5-0 Email delivery runtime (`docs/roadmap/P5-0-email-delivery-runtime-hardening-job.md`,
PR #210, `cac6b85`) is **complete and proven**. Measured against its §10
acceptance criteria:

| Criterion | Status | Evidence |
| --- | --- | --- |
| `EmailDeliveryService` named, no ambiguous `EmailNotificationService` | ✅ | `emailDeliveryService.ts:29`; zero `EmailNotificationService` references in source |
| 5-state outbox `pending|processing|retry_wait|sent|dead` | ✅ | `email.ts:31-36`; `schema/pg.ts:636-638`; migration `0017` |
| `retry_wait` distinct | ✅ | CHECK `email_outbox_retry_wait_must_have_next` (`0018:30-35`) |
| Claim handles `pending` + due `retry_wait` | ✅ | `emailOutboxRepo.ts:240-268` |
| `FOR UPDATE SKIP LOCKED` claim | ✅ | `emailOutboxRepo.ts:240-268` |
| `locked_at`/`locked_by` persisted | ✅ | `schema/pg.ts:597-598` |
| Abandoned `processing` recovers after lock timeout | ✅ | `recoverAbandoned` (`emailOutboxRepo.ts:282-306`) |
| Retry reuses same row | ✅ | ownership-fenced `markSent/markRetryWait/markDead` |
| Independent worker entrypoint | ✅ | `emailDeliveryWorker.ts`; script `worker:email` in `apps/api/package.json:23` |
| Heartbeat persisted in PostgreSQL | ✅ | `workerHeartbeatRepo.ts:46`; table `worker_heartbeats` |
| Diagnostics expose heartbeat + backlog | ✅ | `buildEmailStatus` (`system.ts:46-166`) |
| `EMAIL_ENABLED=false` semantics tested | ✅ | `DisabledEmailSender` no-ops send; outbox still writable |
| Email remains at-least-once | ✅ | documented + row-reuse on retry |
| `pnpm verify` passes | ✅ | exit 0 |

**Critical P5-0 carryover for P5-N1:** `EmailDeliveryService.enqueueBestEffort`
(`emailDeliveryService.ts:78-90`) **swallows outbox-write errors and returns
`null`**. P5-N1 Job v2 §11 requires outbox insertion to be "required" (its failure
rolls back the result-publication transaction). These are in tension. V1 must
either (a) use `enqueueEmail` (throws on failure) when the outbox row is
required, or (b) insert the outbox row directly via the repository inside the
transaction. `enqueueBestEffort` is explicitly the wrong surface for a
transaction-required insert. (See §17.)

**Another critical P5-0 carryover:** `EmailDeliveryService` is **not
instantiated or wired anywhere** (verified: zero `new EmailDeliveryService`
outside its own test; the worker uses `EmailOutboxService`, not
`EmailDeliveryService`). P5-N1 must either wire `EmailDeliveryService` into a
plugin or call the outbox repository directly. The service is built and
unit-tested but unwired.

---

## 8. Current result-publication transaction seam

The authoritative publication mutation is the `POST /exams/:id/publish-results`
handler (`apps/api/src/routes/exam.ts:1258-1301`). Confirmed against current
code (matches P3-R0 §13):

```text
result = await executeInTransaction(fastify.db, async (tx) => {   // line 1263, repeatable-read, retryable
  const published = await publishResults(                          // line 1264 — single authoritative mutation
    createExamRepoAdapter(createExamRepo(tx), ctx),
    id,
    fastify.now(),
  );
  if (!published.alreadyPublished) {                               // line 1269 — idempotency guard
    await recordAtomicHttpAudit(tx, request, ctx, { ... });        // line 1270 — audit INSIDE tx, immediately after mutation
    // ─── P5-N1 extension point (ADD here, lines 1278→1279) ───
    //Ordering: mutation → audit → fan-out (Inbox, then outbox) → commit
    // const postPublishExam = await examRepo.findById(tx, id);    //   re-read exam for post-publication visibility
    // await resolveRecipients(tx, postPublishExam, ctx);           //   §10 — visibility against post-publish state
    // await notificationRepo.insert(tx, ...);                     //   notifications row per recipient (action_path NOT NULL)
    // await emailOutboxRepo.create(tx, ...);                      //   outbox row per recipient with email
  }
  return published;
});
```

Properties confirmed:
- **`executeInTransaction`** (`db/types.ts:128-158`): repeatable-read isolation,
  auto-retries on `40001`/`40P01` (up to 3 attempts, 20/40/80 ms backoff),
  re-executes callback in a fresh transaction after rollback.
- **Repository calls inside tx today:** exactly one (`publishResults` →
  `examRepo.update`) + one audit. Adding notification/outbox inserts inside the
  same guarded block makes them atomic with the publish.
- **Idempotency lever:** `publishResults` (`examCommands.ts:409-412`) returns
  `alreadyPublished: true` if `resultsPublishedAt != null`; the route reuses
  that flag (`exam.ts:1269`) to suppress side effects. Retries re-evaluate the
  flag on a fresh snapshot — so no double notification/outbox on
  serialization-conflict retry. (P3-R0 §9 retry semantics confirmed.)
- **Single caller:** `publishResults` has exactly one production caller — this
  route. `after_grading`/`immediate` modes have **no** publish mutation
  (visibility is computed at read time); their only candidate-state mutation is
  terminal grading (`finalizeTerminalGrading`, `grading.ts:224-354`), which sets
  grading fields only.

**The seam is frozen and is the only place V1 attaches a `result_published`
notification.**

---

## 9. V1 trigger decision

The only V1 notification type is `result_published`.

### 9.1 Publication-mode matrix (from `scores.ts:173-226`, `examCommands.ts:392-417`)

| Mode | Explicit publication mutation? | Stable transaction seam? | Change semantics if notification added? | In P5-N1 V1? |
| --- | --- | --- | --- | --- |
| `manual` | **YES** — `publishResults` flips `resultsPublishedAt: null → now` | **YES** — `exam.ts:1263-1281` (the §8 seam) | No — notification is a guarded side effect inside `!alreadyPublished` | **YES** |
| `after_grading` | **NO** — visibility computed at read time; no publish flip | No publish seam; terminal grading (`grading.ts:224`) sets grading fields only | Adding a notification here requires a separate trigger at the terminal-grading tx | **DEFERRED** |
| `immediate` | **NO** — visibility computed at read time; no publish flip | No publish seam; terminal grading is the only state mutation | Same as after_grading | **DEFERRED** |

### 9.2 Frozen V1 trigger

```text
V1:
  the first successful manual result-publication transition
  resultsPublishedAt: null → non-null
  detected by the `!published.alreadyPublished` guard (exam.ts:1269)
  → one result_published notification per eligible recipient (§10)
  → optional one outbox row per recipient with email (§14)

Deferred:
  after_grading automatic notification (separate terminal-grading trigger)
  immediate automatic notification (separate terminal-grading trigger)
```

This is a scope decision, not a claim that the deferred modes are unimportant.
The frozen trigger is narrow, stable, and attaches to the already-frozen P3
seam with zero risk to current publication semantics.

---

## 10. Recipient eligibility and attempt-selection decision

### 10.1 The recipient question

The Job v2 §7 posed five options (A–E). The repository authority resolves this
to **option D composed with option B**, with a documented rule:

```text
Recipient rule (V1, manual publish):
  Every Candidate enrolled in the exam (examEnrollments by examId)
  whose score-strategy-selected authoritative attempt is "result-ready"
  receives exactly one result_published notification.
```

### 10.2 Why this rule

- **Not option A (every enrolled Candidate):** A candidate with no attempt
  cannot have a result to navigate to; a notification linking to a
  non-existent result is a broken UX.
- **Not option B (every Candidate with any attempt) alone:** An in-progress or
  ungraded attempt is not "result-ready"; `computeResultVisibility`
  (`scores.ts:173-226`) would hide it. Notifying before the result is
  visible would let the candidate click through to a hidden result.
- **Not option C (every Candidate with a result-ready attempt) alone:** With
  multiple attempts, "result-ready attempt" is ambiguous without the
  score-strategy tie-breaker.
- **Option D (score-strategy-selected authoritative attempt, if
  result-ready):** This is the attempt the Candidate already sees when they
  open the result route — the enrollment's `finalAttemptId`
  (`pg.ts:285`), written during terminal grading via `shouldSelectAttempt`
  (`grading.ts:38-54`). It is the single authoritative attempt the
  notification must open.

### 10.3 Composition rule (concrete query)

```text
For a manual publish of exam E (inside the publication transaction, AFTER
publishResults has flipped resultsPublishedAt):

  enrollments = enrollmentRepo.listByExam(ctx, E)        // enrollmentRepo.ts:109
  for each enrollment:
    candidateProfile = enrollment.candidateId             // → candidateProfiles.id
    user = candidateProfile.userId                         // → users.id (notification recipient)
    authAttempt = enrollment.finalAttemptId                // score-strategy-selected; may be null
    if authAttempt == null → skip (no authoritative attempt yet)
    attempt = attemptRepo.findById(authAttempt)
    visibility = computeResultVisibility(postPublishExam, attempt, "own")
    if visibility.visible == false → skip (result not yet visible to candidate)
    → recipient = user; authoritative attempt = authAttempt
```

This composes existing primitives only — no new scoring authority is invented.
`computeResultVisibility` is the same function the result page uses, so the
notification never links to a hidden result.

**Critical:** In manual mode, visibility depends on `exam.resultsPublishedAt !=
null`. Recipient visibility MUST be evaluated against the post-publication
exam state (after `publishResults` has flipped `resultsPublishedAt`). I2 must
NOT evaluate recipients against an exam object loaded before the publication
transition — that would classify all manual-mode recipients as
`pending_publish`. I2 may satisfy this with exactly one of:
  (A) re-read the exam through the transaction after `publishResults`; or
  (B) construct an immutable post-publication exam view using the authoritative
      `resultsPublishedAt` returned by `publishResults`.

### 10.4 Edge cases handled by the composition

| Edge case | Behavior under the rule |
| --- | --- |
| No attempt | `finalAttemptId` null → skip |
| `in_progress` attempt | `computeResultVisibility` → `not_started` → skip |
| Submitted but not graded | `not_graded` → skip |
| Pending manual grading (`pending_manual`) | `not_graded` → skip (regardless of mode) |
| Multiple attempts | `finalAttemptId` is the score-strategy selection → single authoritative attempt |
| Retakes | `shouldSelectAttempt` already applied `highest`/`latest`/`first` during grading |
| Withdrawn/invalidated attempts | No such column exists on attempts/enrollments; out of scope |
| Cross-organization isolation | `listByExam` is org-scoped (`resolveOrgId`); notification query scoped to `(org, recipientUserId)` |

### 10.5 Notification-attempt invariant

```text
The notification opens the enrollment's finalAttemptId (the score-strategy-
selected authoritative attempt). This is exactly the attempt the candidate sees
when they navigate to /exam/:attemptId/result. No second scoring authority is
introduced.
```

---

## 11. Publication identity and dedupe decision

### 11.1 Can publication happen more than once / be unpublished?

```text
Can result publication happen more than once?
  YES — but it is IDEMPOTENT. publishResults (examCommands.ts:409-412) returns
  alreadyPublished=true and leaves resultsPublishedAt UNCHANGED on repeat.
  There is no publication counter / version.

Can it be unpublished?
  NO — there is no unpublish command. ExamUnpublish (catalog) and
  POST /exams/:id/unpublish exist for the `published` LIFECYCLE status, NOT for
  resultsPublishedAt. resultsPublishedAt is write-once per the current API.

Can resultsPublishedAt be reset?
  NO — no API or command sets it back to null.

Can the same exam produce a second legitimate result_published event?
  NO. resultsPublishedAt: null → now is a single irreversible transition.
  Repeat publishes are no-ops (alreadyPublished=true).
```

### 11.2 Frozen dedupe key (no `publicationVersion`)

The Job v2's `publicationVersion` does not exist. The stable sources already
present are sufficient:

```text
Inbox unique scope:
  organizationId + recipientUserId + dedupe_key

Inbox dedupeKey:
  result_published:{examId}

Email-outbox dedupeKey:
  result_published:{examId}:{recipientUserId}
```

`{examId}` is the stable business identity of the publication event. Because
`resultsPublishedAt` is write-once, `result_published:{examId}` is immutable and
globally unique per exam per the current invariant.

### 11.3 Duplicate / retry publication behavior (frozen)

```text
First successful publication (alreadyPublished=false):
  result mutation (resultsPublishedAt = now)        \
  publication audit (exam.publish_results)           } same tx → commit together
  one Inbox row per eligible recipient              /
  one outbox row per recipient with email          /

Repeat publication (alreadyPublished=true):
  no result mutation
  no new publication audit  (already suppressed)
  no new Inbox row          (suppressed by !alreadyPublished guard)
  no new outbox row         (suppressed by same guard)

Serialization-conflict retry (40001/40P01):
  failed attempt rolls back (commits nothing)
  fresh retry snapshot re-evaluates alreadyPublished
  → if another tx committed the publish first: alreadyPublished=true, side effects skipped
  → if not: exactly one successful publish + one audit + one fan-out
```

### 11.4 Four distinct guarantees (NOT the same)

| Guarantee | Mechanism |
| --- | --- |
| Transaction rollback safety | `executeInTransaction` rolls back all side effects on failure |
| Business-call idempotency | `!alreadyPublished` guard suppresses repeat side effects |
| Database unique-key defense | Partial UNIQUE `(org, recipient, dedupe_key) WHERE dedupe_key IS NOT NULL` on notifications; `(org, dedupe_key)` on outbox |
| Worker at-least-once delivery | Outbox row reuse on retry (P5-0); SMTP-accept-but-unconfirmed window remains (ADR-011 §11.1) |

---

## 12. Minimal notifications schema

The Job v2 §8.1 proposed 14 columns. Each is classified by V1 need:

| Column | V1 behavior reads/writes it? | V1 endpoint exposes it? | V1 test proves it? | What breaks if deferred? | Classification |
| --- | --- | --- | --- | --- | --- |
| `id` | PK | yes (list, mark-read) | yes | nothing works | **REQUIRED_NOW** |
| `organization_id` | org-scope filter | no (derived from ctx) | yes | no org isolation | **REQUIRED_NOW** |
| `recipient_user_id` | own-scope filter | no (derived from ctx) | yes | no recipient isolation | **REQUIRED_NOW** |
| `type` | list/unread-count display | yes | yes | can't distinguish types | **REQUIRED_NOW** |
| `title` | list display | yes | yes | empty list row | **REQUIRED_NOW** |
| `body` | list/detail display | yes | yes | empty list row | **REQUIRED_NOW** |
| `action_path` | link to result (NOT NULL) | yes (rendered link) | yes | notification not actionable | **REQUIRED_NOW** |
| `created_at` | list ordering + unread | yes | yes | unstable order | **REQUIRED_NOW** |
| `read_at` | unread filter + mark-read | yes | yes | no unread badge / mark-read | **REQUIRED_NOW** |
| `dedupe_key` | dedupe insert | no | yes | duplicate rows | **REQUIRED_NOW** |
| `severity` | NONE (V1 = info only) | no | no | nothing | **SPECULATIVE → DEFER** |
| `resource_type` | NONE | no | no | nothing | **SPECULATIVE → DEFER** |
| `resource_id` | NONE | no | nothing breaks; examId is reconstructible from dedupe_key | **SPECULATIVE → DEFER** |
| `archived_at` | NONE | no | no | nothing | **SPECULATIVE → DEFER** |
| `invalidated_at` | NONE | no | no | nothing | **SPECULATIVE → DEFER** |

### 12.1 Frozen minimal V1 table

```text
notifications
- id                    TEXT PK
- organization_id       TEXT NOT NULL FK → organizations.id
- recipient_user_id     TEXT NOT NULL FK → users.id
- type                  TEXT NOT NULL  (V1: only "result_published")
- title                 TEXT NOT NULL
- body                  TEXT NOT NULL
- action_path           TEXT NOT NULL  (validated relative path — V1 has no
                                        non-actionable notification type)
- created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
- read_at               TIMESTAMPTZ (nullable — null = unread)
- dedupe_key            TEXT (nullable — unique per scope)

Indexes:
  (organization_id, recipient_user_id, created_at DESC, id DESC)   -- stable list order
  (organization_id, recipient_user_id, read_at)                     -- unread count
  UNIQUE (organization_id, recipient_user_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL                                    -- dedupe
```

**Rationale.** The 10-column table supports the full V1 contract: own Inbox
list, stable ordering, unread count, mark read, dedupe, org + recipient
isolation, and navigation. `severity`/`resource_type`/`resource_id`/
`archived_at`/`invalidated_at` have no V1 reader, writer, endpoint, or test —
they are speculative and deferred (§23). `action_path` is NOT NULL because V1
has exactly one notification type (`result_published`) and every such
notification must navigate to the authoritative result. A nullable column would
permit a broken `result_published` record. Nullable support for future
announcement or informational types is speculative and must not weaken the V1
invariant — a future migration may relax or redesign the model deliberately.

---

## 13. `users.email` contract

Verified current state: `users.email` does NOT exist (`pg.ts:106-114`;
migrations 0001-0018; `contracts/src/user.ts`; `contracts/src/candidate.ts`;
routes `user.ts`, `candidate.ts`; CSV import).

```text
V1 contract for users.email:
  where created:        Admin POST /api/users, POST /api/candidates
  where edited:         Admin PATCH /api/users/:id, PATCH /api/candidates/:id
  roles that may edit:  Admin (writes via user/candidate routes)
  Candidate self-edit:  NO (Candidate has no self-edit email surface in V1)
  normalization rule:   trim surrounding whitespace; blank → null; preserve
                        the validated address spelling/case (Email is not a
                        login identifier, not unique, no case-insensitive
                        lookup is required, so lowercase is an unnecessary
                        semantic transformation; trim-only is the smallest
                        behavior needed for SMTP delivery)
  validation rule:      Zod `z.string().email()` after normalize; max 320 chars
  API response exposure: included in admin user/candidate read DTOs; NOT in
                        Candidate's own /auth/me (no self-view of email in V1)
  CSV import behavior:  natural and low-risk to add — the import row schema is
                        column-position-tolerant; an optional trailing email
                        column is additive. NOT forced into V1 if it risks the
                        import-column count assumptions.
  uniqueness behavior:  NOT unique (email is optional; multiple nulls allowed;
                        the partial-unique approach is NOT required — blank
                        maps to null, and nulls are not constrained)
```

```text
Default constraints (frozen):
  email optional
  blank → null
  not used for login
  not verified (no ownership-verification / confirmation Email in V1)
  not unique
  no invitation
  no ownership-verification flow
  no account-recovery semantics
  candidate without email remains fully valid (receives Inbox only)
```

---

## 14. NotificationType → EmailType mapping

```text
Frozen mapping (exactly one):
  result_published  →  grade_notification
```

### 14.1 Why reuse `grade_notification`, not a new type

- `grade_notification` is already defined in `packages/domain/src/email.ts:47`.
- Its semantics ("results are now available") match the `result_published`
  notification intent.
- Adding a new `result_published` EmailType would duplicate the same intent
  under two names with no behavioral difference — that is the duplication the
  Job v2's §"NotificationType and EmailType are independent" rule warns against.
- The mapping is explicit and tested (one entry in `policy.ts`).

### 14.2 Mapping rules (from ADR-011 §9.5)

```text
1. No cross-table enum consistency constraint at DB level.
2. String equality between NotificationType and EmailType is never assumed
   ("result_published" !== "grade_notification").
3. Association lives in notifications/policy.ts and has tests.
4. Renaming an EmailType does not change historical NotificationType values.
```

### 14.3 What the Email must NOT include

```text
standard answers
rubric
internal grading details
grader identity
sensitive result data not already approved for Email
```

The Email communicates three things only: (1) results are available, (2) the
exam title, (3) a trusted link back to EXAM. Total score / pass status stay
inside EXAM (the Inbox / result page), not the Email — this matches the
leakage-boundary proof in P3-R0 §6 (`standardAnswer` is stripped from the
candidate-visible DTO; it must not be re-introduced via Email).

---

## 15. Email content boundary

```text
Subject (zh-CN, server-generated):
  "考试结果已发布" (or i18n key notifications.resultPublished.subject)

Text body (zh-CN, server-generated):
  - examTitle (server-trusted string, HTML-escaped at render time)
  - trusted link = PUBLIC_WEB_ORIGIN + action_path (site-relative, re-validated)
  - no score, no pass/fail, no standard answers, no rubric

HTML body (optional):
  - same content, minimal markup, link re-validated against whitelist
  - sanitized (no inline scripts, no external resources)
```

`grade_notification` has **no renderer today** (verified: `email.ts:47` is
defined but unreferenced). P5-N1 I2 must build the renderer/payload as part of
the `result_published → grade_notification` mapping. The renderer takes a
structured payload (examTitle, actionPath) — it does NOT query repositories.

---

## 16. Action-link design

### 16.1 Frozen: command-specific trusted builder, NOT generic whitelist

Two designs were evaluated:

**Arbitrary stored path + generic validator (REJECTED for V1):** `actionPath`
supplied to NotificationService, validated against a whitelist. Overdesigned:
there is exactly one V1 caller (trusted server code), so a generic URL-security
framework is not required.

**Command-specific trusted builder (CHOSEN):**
`buildResultPublishedActionPath(attemptId)` returns `/exam/${attemptId}/result`.
This is the real existing candidate result route (`routes.ts:37`,
`App.tsx:109`, `ResultPage.tsx:66`) — navigation is by `attemptId`, not
`examId`.

### 16.2 Builder contract

```text
buildResultPublishedActionPath(attemptId: string): string
  → returns `/exam/${attemptId}/result`
  → always non-empty and valid (satisfies action_path NOT NULL)

  site-relative output            ✓ (starts with /exam/)
  no request Host authority       ✓ (built from attemptId only)
  PUBLIC_WEB_ORIGIN used only for rendered absolute Email links (render time)
  no external / protocol-relative destination  ✓
  existing route prefix verified  ✓ (/exam/* is a live route family)
  guaranteed non-null              ✓ (V1 has no non-actionable type)
```

### 16.3 Validation (lightweight, V1-appropriate)

Even though the builder is trusted, V1 still requires:
- `action_path` starts with `/exam/`
- matches the pattern `/exam/[a-zA-Z0-9_-]+/result`
- no `..`, no backslash, no scheme, no encoded traversal
- render-time re-validation before combining with `PUBLIC_WEB_ORIGIN`
- `action_path` is NOT NULL (V1 has no non-actionable notification type; a
  nullable column would permit a broken `result_published` record)

This is **not** a generic URL-security framework — it is a single assertion
that the stored path is the one the builder produced. Deferred: a shared
`actionLink.ts` validator if a second V1+ notification type needs it (§23).

---

## 17. Transaction atomicity and retry behavior

### 17.1 Frozen extension seam

Start from the P3-proven route transaction (`exam.ts:1263-1281`). The frozen
ordering is: result mutation → audit → fan-out (Inbox, then outbox) → commit.
Insert the fan-out inside the `!published.alreadyPublished` block, after the
audit:

```text
executeInTransaction(fastify.db, async (tx) => {
  const published = await publishResults(...);                 // keep first — flips resultsPublishedAt
  if (!published.alreadyPublished) {
    await recordAtomicHttpAudit(tx, ...);                      // keep — audit immediately after mutation
    // P5-N1 extension (audit → fan-out ordering):
    // Recipient visibility MUST use post-publication exam state (§10.3).
    // Option A: re-read exam from tx. Option B: use published.postPublishExam.
    const postPublishExam = await examRepo.findById(tx, exam.id); // Option A
    const recipients = await resolveRecipients(tx, postPublishExam, ctx); // §10 composition
    for (const r of recipients) {
      await notificationRepo.insert(tx, {                      // Inbox row (required)
        organizationId, recipientUserId: r.userId,
        type: "result_published", title, body,
        actionPath: buildResultPublishedActionPath(r.attemptId),
        dedupeKey: `result_published:${exam.id}`,
      });
      if (r.email) {
        await emailOutboxRepo.create(tx, {                     // outbox row (required when email exists)
          organizationId, type: "grade_notification", recipientEmail: r.email,
          subject, bodyText, bodyHtml,
          dedupeKey: `result_published:${exam.id}:${r.userId}`,
        });
      }
    }
  }
  return published;
});
```

### 17.2 Atomicity invariant (V1)

```text
result mutation
→ publication audit
→ required Inbox rows (one per eligible recipient)
→ required outbox rows (one per recipient WITH email)
→ commit or roll back together
```

All five steps (result, audit, Inbox rows, outbox rows, commit) are inside the
same transaction. If fan-out fails, the audit and result mutation roll back with
it. SMTP remains outside the transaction (worker drains asynchronously).

### 17.3 Critical tension with `enqueueBestEffort`

`EmailDeliveryService.enqueueBestEffort` (`emailDeliveryService.ts:78-90`)
**swallows** outbox-write errors. If P5-N1 routes through it, a failed outbox
insert would NOT roll back the result publication — violating §17.2. **Resolution
for V1:** insert the outbox row via `emailOutboxRepo.create(tx, ...)` directly
(throws on failure), OR use `EmailDeliveryService.enqueueEmail` (throws). Do NOT
use `enqueueBestEffort` for a transaction-required insert. Alternatively, wire
a new transaction-aware `enqueueEmail`-style path. The worker's existing
`EmailOutboxService`/`emailOutboxRepo.create` is the proven, throw-on-failure
surface.

### 17.4 Retry behavior

- On `40001`/`40P01`, `executeInTransaction` rolls back and retries in a fresh
  transaction (up to 3 attempts, `db/types.ts:69,135-155`).
- The `!alreadyPublished` guard re-evaluates on each retry — a retry that sees
  another transaction's committed publish skips the fan-out (no duplicate).
- `isRetryableError` (`db/types.ts:76-95`) does NOT retry `23505`
  (unique_violation) — so a dedupe-key collision is a hard error, not a silent
  retry. This is correct: a genuine duplicate-key attempt is a bug to surface,
  not mask.

### 17.5 Ordering (frozen)

```text
result mutation  →  audit  →  fan-out inserts (notifications, then outbox)  →  commit
```

This preserves the current P3 route ordering (audit immediately after the
mutation) and requires the smallest production diff in I2. Within the fan-out:
notification rows inserted first (so a notification read never misses its Inbox
row), then outbox rows. Both inside the same tx. If fan-out fails, the
previously inserted audit row rolls back with the transaction — no persisted
audit can claim success for a rolled-back publication.

### 17.6 Required vs. optional outbox when

| Condition | Outbox row |
| --- | --- |
| recipient email exists | REQUIRED (insert inside tx; failure rolls back publication) |
| `EMAIL_ENABLED=false` | REQUIRED insert regardless (send path is what's disabled, not enqueue — matches P5-0 Approach A) |
| recipient has no email | NO outbox row (Inbox only) |
| email runtime config incomplete | Enqueue still succeeds (worker will fail/send-disabled later; publication is committed) |

---

## 18. Fan-out and failure policy

### 18.1 Recipient selection without N+1

```text
1. enrollmentRepo.listByExam(ctx, examId)                  — one query, all enrollments
2. batch-load attempts + compose with computeResultVisibility  — avoid per-row attempt query
3. filter to recipients (finalAttemptId != null && visibility.visible)
```

`listByExam` (`enrollmentRepo.ts:109`) returns all enrollments for the exam in
one query. Attempts are loaded by `finalAttemptId` in a batched `WHERE id = ANY(...)`
or via the existing `attemptRepo` primitives. `computeResultVisibility` is a
pure function (no DB).

### 18.2 Batch inserts

- Inbox rows: `notificationRepo.insertMany(tx, rows)` — one multi-row INSERT.
- Outbox rows: `emailOutboxRepo.create` per row, or a batched insert if the
  repository exposes one. Either way, inside the SAME tx.

### 18.3 Practical recipient bound

Single-tenant LAN deployment; realistic exam = tens to low thousands of
candidates. A single `listByExam` + batched inserts is well within a single
transaction's budget. No Kafka/BullMQ/Redis/background job.

### 18.4 Failure policy (V1)

| Scenario | Behavior |
| --- | --- |
| Candidate without email | Inbox row only |
| Candidate with valid email | Inbox row + linked outbox row |
| DB failure inserting a required Inbox row | whole publication tx rolls back |
| DB failure inserting a required outbox row | whole publication tx rolls back (outbox is required when email exists) |
| One malformed recipient (e.g. invalid email format) | caught at contract/validation; does NOT block other recipients if validated BEFORE the tx. If inside the tx, it rolls back — V1 should validate-then-insert to fail fast |
| SMTP failure after commit | publication remains committed; worker retries per P5-0 |

### 18.5 What V1 does NOT introduce

```text
Kafka / RabbitMQ / BullMQ / Redis queue / background notification fan-out job
generic batch orchestration platform
```

Large-scale announcement fan-out is not this Job (ADR-011 §16; deferred).

---

## 19. Minimal Inbox API

### 19.1 Pagination: REUSE offset/page, NOT opaque cursor

The Job v2 §13 proposed opaque base64url cursor pagination. This is
**inconsistent** with the repository's authoritative bounded-pagination
convention:

```text
packages/contracts/src/common.ts:8-36
  PaginationParamsSchema:   page (≥1, default 1), pageSize (≥1, max 100, default 20)
  PaginatedResponseSchema: { items, total, page, pageSize, totalPages }
```

Every existing list endpoint (`GET /users`, `/candidates`, `/exams`, `/scores`,
`/admin/audit-logs`, `/admin/grading-queue`, `/admin/import-logs`, `/courses`)
uses this convention. Verified: zero opaque-cursor usage anywhere in
`apps/api/src/routes/`. V1 Inbox reuses `PaginationParamsSchema` +
`PaginatedResponseSchema`. This removes the need for a cursor encoder/decoder,
cursor validation, and cursor-scope coupling.

### 19.2 Frozen V1 endpoints

```http
GET  /api/notifications
GET  /api/notifications/unread-count
POST /api/notifications/:id/read
POST /api/notifications/read-all
```

All four are needed by the first UI (bell count + list + mark one + mark all).

### 19.3 Per-endpoint contract

| Endpoint | Why needed by first UI | Pagination | Auth | Scope |
| --- | --- | --- | --- | --- |
| `GET /api/notifications` | list notifications | `PaginationParamsSchema` (page/pageSize, default 20, max 100), order `created_at DESC, id DESC`; optional `?unread=true` | `authenticate` (own-user; mirror `/auth/me`) | `(ctx.organizationId, ctx.actorId)` |
| `GET /api/notifications/unread-count` | bell badge | none | `authenticate` | `(org, actorId)`, `read_at IS NULL` |
| `POST /api/notifications/:id/read` | mark one read | none | `authenticate` | `(org, actorId)`, anti-enumeration 404 on other-user/missing |
| `POST /api/notifications/read-all` | mark all read | none | `authenticate` | `(org, actorId)`, UPDATE `read_at=now()` WHERE unread |

### 19.4 Additional frozen decisions

```text
default limit:       20
maximum limit:       100
stable ordering:     created_at DESC, id DESC
unread filtering:    ?unread=true on list (server-side, not client)
mark-read idempotent: repeated read → no-op (200, same state), not 409
not-found behavior:  404 RESOURCE_NOT_FOUND for other-user or missing
                     (anti-enumeration, same as attempts.candidate.ts:160)
error contract:      ErrorResponseSchema (common.ts:57-67)
route registry:      capability-optional (authenticate-only, like /auth/mute);
                     no new Permission needed for own-Inbox read
required gate:       fastify.authenticate (mirror /auth/me, auth.ts:403)
```

Clients MUST NOT provide `organizationId` or `recipientUserId` — scope derives
from authenticated context.

No Admin Inbox, no Teacher Inbox, no notification-management API is required.

---

## 20. Minimal Candidate UI

### 20.1 Frozen surface: bell + small panel

V1 uses **bell + small panel** (not a dedicated Inbox page). The bell lives in
the candidate shell's top header, inside the right-side cluster
(`ExamLayout.tsx:66`, before the divider at line 77).

```text
Components:
  NotificationBell (apps/web/src/components/notifications/NotificationBell.tsx)
    — Bell icon (lucide-react) + Badge (unread count)
    — Popover panel (shadcn Popover) with notification list
    — loading / empty / error states (Skeleton when loading)

State ownership:
  unread count fetched on authenticated app start + after read operations
  polling: bounded setInterval (consistent with ProctorDashboardPage.tsx:128-134),
           NOT WebSocket/SSE/browser push
```

### 20.2 Required V1 behavior

```text
unread indicator          — Badge with count from /unread-count
loading state             — Skeleton in panel
empty state               — "暂无通知" empty message
error state               — InlineErrorBanner / toast on fetch failure
list result_published     — title + body + created_at
mark one read             — POST /:id/read on click; refresh count
mark all read             — POST /read-all; refresh count
open authoritative result — navigate(routes.exam.result(attemptId))
refresh count after read  — re-fetch /unread-count
```

### 20.3 Reused existing conventions

```text
Tailwind                  — structural layout only (flex/grid/gap/w/h)
shadcn/ui                 — Popover, Badge, Separator, Skeleton, Button
lucide-react              — Bell icon
i18n                      — zh-CN catalog (apps/web/src/i18n/locales/zh-CN.ts)
route helpers             — routes.exam.result(attemptId) (routes.ts:37)
API client                — api.get/post (apps/web/src/lib/api.ts)
polling                   — setInterval + useEffect + useRef (ProctorDashboardPage pattern)
```

### 20.4 What V1 does NOT introduce

```text
WebSocket / SSE / browser push / mobile push / desktop notifications
toast-as-Inbox (Inbox is authoritative; toasts are ephemeral)
dedicated full Inbox page (deferred — §23)
ScrollArea (does not exist in shadcn/ui; add if panel needs scroll)
```

---

## 21. Security boundary

### 21.1 Audited surfaces

| Concern | Status |
| --- | --- |
| Authenticated own-user scope | `fastify.authenticate` + `(ctx.organizationId, ctx.actorId)` query scope (mirror `/auth/me`) |
| Organization boundary | `organizationId` from authenticated context; all queries org-scoped |
| Cross-user notification probing | Anti-enumeration 404 (same message for missing / other-user); `EligibilityDenialMode = "resource_not_found"` pattern |
| Action-link construction | Server-generated `buildResultPublishedActionPath(attemptId)`; never request-Host-based |
| Email address exposure | Server-derived; not reflected from client input |
| Stored title/body rendering | Server-generated strings; escaped at Email render time |
| HTML escaping | Email render escapes examTitle; no inline scripts; no external resources |
| Outbox payload sanitization | `sanitizeError` scrubs secrets; outbox stores caller-supplied subject/text (server-generated) |
| Request Host handling | NOT persisted as public origin; `PUBLIC_WEB_ORIGIN` from runtime config only |

### 21.2 Required principles (all enforced in V1)

```text
Candidate reads only own notifications                 ✓ (repo scope = actorId)
cross-user ID probe does not leak existence            ✓ (uniform 404)
organization/recipient IDs are server-derived          ✓ (from ctx)
notification text is server-generated                  ✓ (route builds title/body)
action link is server-generated                        ✓ (buildResultPublishedActionPath)
request Host is never persisted as public origin       ✓ (PUBLIC_WEB_ORIGIN only)
```

### 21.3 Deferred (NOT P5-N1 blockers)

```text
IP/CIDR exam restriction / LAN allowlisting / device binding
single-session enforcement / emergency exam credentials
WYSIWYG final-answer submission / identity recovery
```

Recorded only as future Exam Security & Recovery capabilities.

---

## 22. Explicit anti-overdesign decisions

| Decision | Rejected alternative | Rationale |
| --- | --- | --- |
| 10-column `notifications` table | 14-column table with `severity`/`resource_type`/`resource_id`/`archived_at`/`invalidated_at` | No V1 reader/writer/endpoint/test for the 5 deferred columns |
| `result_published:{examId}` dedupe | `publicationVersion` column | `publicationVersion` does not exist; single irreversible transition is the stable key |
| `grade_notification` reuse | New `result_published` EmailType | Same intent; duplication under two names with no behavioral difference |
| `buildResultPublishedActionPath` | Generic whitelist + URL-security framework | One trusted caller; one route; framework unjustified |
| Offset/page pagination | Opaque base64url cursor | Existing repo convention (`PaginationParamsSchema`); cursor is a new pattern |
| Bell + small panel | Dedicated Inbox page | Smallest usable surface; page deferred |
| Existing offset/page schema | New cursor infrastructure | Removes encoder/decoder + cursor validation + scope coupling |
| Direct repo insert in tx | `EmailDeliveryService.enqueueBestEffort` | `enqueueBestEffort` swallows errors → breaks atomicity (§17.3) |
| Authenticate-only preHandler | New `Permission` constant | Own-Inbox read mirrors `/auth/me` (no capability) |

---

## 23. Deferred capabilities

The following are explicitly deferred and NOT part of V1:

```text
NotificationType values beyond result_published
  (exam_assigned, exam_time_changed, exam_cancelled, grading_assigned, announcements)
Severity / resource_type / resource_id / archived_at / invalidated_at columns
Generic actionLink.ts URL-security framework (revisit if 2nd notification type lands)
Dedicated full Inbox page (bell + panel suffice for V1)
ScrollArea component (add if panel needs scroll)
User notification preferences / digest / quiet hours / unsubscribe
per-notification-type stale TTL / skipped / suppressed status
stale-message skip implementation
identity-flow migration to NotificationService (invitation/activation/reset)
provider-native idempotency
retention cleanup worker
per-recipient rate limiting / anti-bombing
large-scale announcement fan-out (ADR-003 Job Queue re-evaluation)
external alerting platform integration
Email template engine + backend i18n (route-local inline strings remain)
PUBLIC_WEB_ORIGIN validation hardening (HTTPS enforcement in prod)
Shared validator library across notification types
```

---

## 24. Required migrations

```text
Owned by P5-N1-I1 (foundation):
  packages/db/migrations/postgres/0019_notifications_users_email.sql
    - notifications table (§12.1) — 10 columns + 3 indexes (incl. partial
      UNIQUE on dedupe_key)
    - users.email (optional, nullable, normalized) — ALTER TABLE users ADD
      COLUMN email TEXT; partial UNIQUE is NOT required (nulls allowed)

Owned by P5-N1-I2 (operational Email linkage):
  packages/db/migrations/postgres/0020_email_outbox_notification_link.sql
    - email_outbox.notification_id (nullable FK → notifications.id) — links
      operational email rows to their Inbox notification
    - email_outbox.recipient_user_id (nullable FK → users.id) — allows
      recipient linkage independent of email
    - their nullable foreign keys and required indexes, if any

The two migrations are separate because:
  0019 = Inbox/user foundation
  0020 = operational Email linkage and atomic integration

During I1:
  packages/db/src/repository/emailOutboxRepo.ts remains unchanged
  email_outbox schema remains unchanged
  Email worker and Email services remain unchanged
```

No migration renames `resultsPublishedAt` or touches `exam lifecycle`.

---

## 25. Required tests (test matrix)

### 25.1 Layer — contracts/domain

```text
optional valid email (z.string().email() after trim + preserve)
blank email → null
mixed-case email preserved as supplied (no lowercase transform)
malformed email rejected
max length = 320
candidate without email remains valid
result_published is the only NotificationType value
NotificationType ≠ EmailType string equality
```

### 25.2 Layer — migration/schema

```text
notifications table: columns, NOT NULLs (incl. action_path), defaults,
  3 indexes, partial UNIQUE
users.email: nullable, no unique constraint (nulls allowed)
email_outbox.notification_id: nullable FK
```

### 25.3 Layer — repository

```text
create notification
duplicate dedupe key is idempotent (ON CONFLICT DO NOTHING)
same dedupe key for different recipients does not conflict
list uses stable created_at/id order
offset/page pagination (page, pageSize, unread filter)
unread count
mark one read (sets read_at)
mark all read (sets read_at for all unread)
organization + recipient isolation (cross-user → empty, not error)
claimDue / recoverAbandoned / markSent / markRetryWait / markDead (P5-0 regression)
```

### 25.4 Layer — application policy

```text
result_published requires Inbox
result_published maps explicitly to grade_notification
missing email → Inbox only (no outbox row)
NotificationType/EmailType string equality not assumed
recipient composition (§10): skip no-attempt, skip not-ready, select finalAttemptId
```

### 25.5 Layer — transaction integration

```text
result state + Inbox + outbox commit together
Inbox insertion failure rolls back result publication
outbox insertion failure rolls back result publication (when email exists)
no SMTP call inside transaction
duplicate publication trigger (alreadyPublished=true) creates no rows
concurrent publication (Promise.all two authorized requests) → one timestamp,
  one audit, one fan-out set (M13-style)
serialization-conflict retry re-evaluates alreadyPublished (design inference
  from executeInTransaction + !alreadyPublished guard; no forced-retry hook)
manual publish with a result-ready finalAttemptId → recipient resolution runs
  against post-publication exam state → exactly one notification created
negative control: the same attempt evaluated against pre-publication state would
  be hidden (proves the post-publication visibility test is not vacuous)
```

### 25.6 Layer — authorization/API

```text
unauthenticated requests rejected (401)
candidate lists only own notifications
same-organization other-user access rejected (404 anti-enumeration)
mark read idempotent (200 on repeat)
read-all scoped to actor
pagination limit bounded (reject pageSize > 100)
```

### 25.7 Layer — frontend

```text
unread badge reflects /unread-count
loading state (Skeleton)
empty state ("暂无通知")
error state (toast / banner)
list renders result_published (title, body, created_at)
mark one read updates count
mark all read updates count
result action navigates to /exam/:attemptId/result
```

### 25.8 Layer — E2E

```text
Admin manual publish (browser) → candidate sees unread badge → opens panel →
  marks read → navigates to frozen result (extends M12 with notification steps)
Candidate without email → Inbox only, no outbox row
EMAIL_ENABLED=false → Inbox authoritative, outbox row still created
```

### 25.9 Layer — regression

```text
P5-0 worker + Email tests pass (no enqueueBestEffort wiring change)
P3 result-publishing tests pass (J5a, P3-3, M8/M9/M13 unchanged)
result visibility rules remain authoritative
hidden standard-answer protections unchanged
Admin/Teacher capability gates remain enforced
full verify passes
```

### 25.10 Determinism

All tests above are deterministic without production hooks (worker uses
`DisabledEmailSender` under test; transaction integration uses real
`executeInTransaction` + PostgreSQL `exam_test`). No `pg_sleep`, no mocked
retries, no production callbacks.

---

## 26. Implementation Job decomposition

### P5-N1-I1 — notification foundation

```text
scope:
  - add optional users.email (migration + contracts + Admin create/edit + CSV if natural)
  - add notification domain types (packages/domain/src/notification.ts:
      NotificationType = "result_published"; NotificationSeverity deferred)
  - add notification contracts (packages/contracts/src/notification.ts:
      list/unread-count/mark-read/read-all Zod schemas; reuse
      PaginationParamsSchema + PaginatedResponseSchema)
  - add notifications schema + repository (§12.1; action_path NOT NULL;
      insertMany with ON CONFLICT, list with stable order + unread filter,
      markRead, markAllRead, unreadCount)
  - extend users read DTO to expose email to Admin only

allowed files:
  packages/db/migrations/postgres/0019_notifications_users_email.sql (new —
    notifications table + users.email only; no email_outbox changes)
  packages/db/src/schema/pg.ts (notifications table, users.email)
  packages/db/src/repository/notificationRepo.ts (new)
  packages/db/src/repository/emailOutboxRepo.ts (unchanged in I1)
  packages/domain/src/notification.ts (new)
  packages/domain/src/email.ts (no change — grade_notification already defined)
  packages/contracts/src/notification.ts (new)
  packages/contracts/src/user.ts (add email to admin create/update/read schemas)
  packages/contracts/src/candidate.ts (add email to admin create/update schemas)
  apps/api/src/routes/user.ts (wire email into Admin create/update/read)
  apps/api/src/routes/candidate.ts (wire email into Admin create/update)

forbidden files:
  apps/api/src/routes/exam.ts (transaction extension is I2, not I1)
  apps/api/src/email/** (no change in I1)
  apps/web/src/** (UI is I3)

migration ownership:
  P5-N1-I1 owns 0019_notifications_users_email.sql only (notifications table +
  users.email). email_outbox is NOT modified in I1; notification_id and
  recipient_user_id are added by P5-N1-I2 in 0020.

tests:
  contracts: email validation (valid/blank/null/malformed), candidate-without-email
  migration: notifications columns/indexes/constraints, users.email nullable
  repository: create/dedupe/list/order/unread/markRead/markAllRead/isolation
    (+ P5-0 outbox regression)

acceptance criteria:
  - users.email exists as optional normalized recipient source
  - candidate without email still valid
  - notifications table + indexes + partial UNIQUE exist
  - NotificationType.result_published defined
  - Inbox repository supports list/unread-count/mark-read/mark-all-read with
    org + recipient scope
  - pnpm verify passes

commit boundary:
  feat(user): add optional notification email address
  feat(notification): add inbox domain contracts and persistence

dependency on prior Job: none (P5-N1-R0 is the predecessor)
same Draft PR as I2/I3? NO — I1 is the foundation PR; I2 and I3 build on it.
```

### P5-N1-I2 — result-published policy, Email mapping, atomic integration

```text
scope:
  - result_published recipient policy (§10 composition rule); recipient
    visibility evaluated against post-publication exam state (NOT
    pre-publication state — see §10.3)
  - buildResultPublishedActionPath + V1 action-path validation (§16;
    action_path NOT NULL — builder always produces a valid non-empty path)
  - grade_notification Email renderer + structured payload (§14, §15)
  - static result_published → grade_notification policy mapping (policy.ts)
  - atomic extension of publish-results tx (§17): fan-out Inbox + outbox inside
    !alreadyPublished
  - extend email_outbox with notification_id + recipient_user_id (nullable)
  - wire PUBLIC_WEB_ORIGIN into runtimeConfig + .env.example (validated at boot)
  - reconcile with enqueueBestEffort: use throw-on-failure outbox insert in tx
    (§17.3)

allowed files:
  apps/api/src/routes/exam.ts (extend the tx — ONLY the publish-results handler)
  apps/api/src/notifications/policy.ts (new — static mapping)
  apps/api/src/notifications/actionLink.ts (new — buildResultPublishedActionPath
    + V1 validation; NOT a generic framework)
  apps/api/src/notifications/types.ts (new — API-local interfaces)
  apps/api/src/email/emailDeliveryService.ts (may add a tx-aware enqueue path
    OR I2 calls emailOutboxRepo.create directly)
  apps/api/src/email/templates/grade-notification.ts (new — structured renderer)
  apps/api/src/config/runtimeConfig.ts (add PUBLIC_WEB_ORIGIN)
  apps/api/src/plugins/email.ts (no functional change; PUBLIC_WEB_ORIGIN read
    at render time)
  packages/db/src/schema/pg.ts (email_outbox.notification_id,
    email_outbox.recipient_user_id)
  packages/db/migrations/postgres/0020_email_outbox_notification_link.sql
  .env.example (add PUBLIC_WEB_ORIGIN)

forbidden files:
  apps/api/src/workers/emailDeliveryWorker.ts (no change)
  apps/api/src/routes/scores.ts (no change)
  apps/api/src/orchestrators/submitAndGradeAttempt.ts (no change — immediate/
    after_grading triggers are DEFERRED)
  apps/api/src/routes/gradingQueue.ts (no change)
  apps/web/src/** (UI is I3)

migration ownership:
  P5-N1-I2 owns 0020_email_outbox_notification_link.sql only (email_outbox
  notification_id + recipient_user_id + their nullable foreign keys and
  required indexes). This is a separate migration from 0019 because 0020 is the
  operational Email linkage and atomic integration.

tests:
  policy: result_published requires Inbox; maps to grade_notification; missing
    email → Inbox only
  actionLink: /exam/:id/result accepted; external/protocol-relative/traversal/
    backslash/control-char rejected; render-time re-validation
  Email render: subject/body/html contain examTitle (escaped) + link; no score,
    no standardAnswer
  recipient composition: skip no-attempt; skip not-visible; select finalAttemptId
  recipient visibility: post-publication exam state used (NOT pre-publication);
    manual publish with result-ready finalAttemptId → exactly one notification;
    negative control: same attempt against pre-publication state would be hidden
  transaction: commit-together; Inbox-failure rolls back; outbox-failure rolls
    back (when email exists); no SMTP in tx; duplicate trigger → no rows;
    concurrent publish → one fan-out (M13-style)
  EMAIL_ENABLED=false: Inbox authoritative, outbox row still created
  regression: P5-0 outbox + P3 result tests green

acceptance criteria:
  - manual publish atomically commits result + Inbox + outbox
  - notification opens /exam/:attemptId/result
  - grade_notification renderer is structured + escaped + tested
  - PUBLIC_WEB_ORIGIN validated at boot
  - no SMTP in business transaction
  - pnpm verify passes

commit boundary:
  feat(notification): add action link validation and policy mapping
  feat(notification): add grade notification email renderer
  feat(result): publish inbox and email outbox atomically
  feat(email): extend outbox with notification linkage

dependency on prior Job: I1 (needs notifications table + users.email +
  notification_id/outbox linkage)
same Draft PR as I1? NO — separate PR (I2 depends on I1 merge).
```

### P5-N1-I3 — Inbox API + Candidate UI + E2E and closeout

```text
scope:
  - notification routes (apps/api/src/routes/notifications.ts: list, unread-count,
    mark-read, read-all; authenticate-only; PaginationParamsSchema)
  - register route group in registerApiRoutes.ts
  - NotificationBell + panel UI (§20; ExamLayout.tsx header slot)
  - notificationBell.test.tsx, notificationRoutes.test.tsx
  - E2E: manual publish → badge → panel → read → navigate to result
  - closeout report

allowed files:
  apps/api/src/routes/notifications.ts (new)
  apps/api/src/routes/registerApiRoutes.ts (register group)
  apps/api/src/plugins/notifications.ts (optional — only if a plugin is needed
    for repository wiring; can be inlined in the route for V1)
  apps/web/src/components/notifications/NotificationBell.tsx (new)
  apps/web/src/components/layout/ExamLayout.tsx (add bell to header slot)
  apps/web/src/i18n/locales/zh-CN.ts (add notifications.* keys)
  apps/e2e/e2e/result-publishing.spec.ts (extend with notification steps)

forbidden files:
  apps/api/src/routes/exam.ts (no change — seam already extended in I2)
  packages/db/migrations/** (no new migrations — all schema is I1+I2)

migration ownership: none for I3.

tests:
  API: unauthenticated 401; own-list only; cross-user 404; mark-read idempotent;
    read-all scoped; pagination bounded
  frontend: badge; loading/empty/error states; list render; mark read; mark
    all read; result navigation
  E2E: full publish → badge → read → navigate flow
  regression: full verify + E2E green

acceptance criteria:
  - Inbox API passes auth + isolation + pagination tests
  - Candidate Inbox UI is usable (bell + panel + states + navigation)
  - E2E proves the architecture (manual publish → Inbox → result)
  - pnpm verify + E2E pass

commit boundary:
  feat(api): add notification inbox endpoints
  feat(web): add notification inbox and unread badge
  test(notification): cover transaction dedupe auth and navigation
  docs(p5-n1): closeout report

dependency on prior Job: I2 (needs atomic integration + actionLink + renderer)
same Draft PR as I1/I2? NO — separate PR (I3 depends on I2 merge).
```

---

## 27. Risks and blockers

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `enqueueBestEffort` used for tx-required outbox insert → swallowed failure breaks atomicity | Medium (the Job v2 does not call this out) | High — silent partial publication | I2 uses throw-on-failure insert (repo.create or enqueueEmail); explicit test for outbox-failure-rolls-back |
| Recipient composition performs N+1 over large enrollment | Low (LAN scale) | Medium | Batch attempt load (`WHERE id = ANY`); `listByExam` is one query |
| `PUBLIC_WEB_ORIGIN` absent at Email-render time | Low (runtime-config validated at boot) | Medium — Email link broken | Validate at boot (fail-fast); render-time re-validation; test |
| `grade_notification` renderer leaks score/standardAnswer | Low (renderer is new, explicit §15 boundary) | High — recurrence of P3 leakage class | Renderer only receives `{ examTitle, actionPath }`; test asserts no score/standardAnswer/rubric/grader in output |
| Concurrent publish + notification fan-out race | Low (M13 proves single timestamp + single audit) | Medium | Reuse `!alreadyPublished` guard; M13-style concurrent test for fan-out |
| `notificationRepo.insertMany` driver support | Low | Low | Verify Drizzle supports multi-row insert + ON CONFLICT; fall back to looped `create` if not |
| Recipient visibility evaluated against pre-publication exam state | Medium (manual mode visibility depends on `resultsPublishedAt != null`) | High — all manual recipients classified as `pending_publish` → zero notifications | I2 must evaluate visibility against post-publication exam state (§10.3); required negative-control test proves it is not vacuous |

**No blockers.** P3 is closed; the seam is frozen; P5-0 runtime is proven. The
audit's V1 decisions (§9–§22) are answerable from existing repository
authority.

---

## 28. Next authorized Job

```text
PASS:
  Next authorized Job:
  P5-N1-I1 — notification domain + contracts + migration + optional users.email
  (§26; depends on this audit's frozen V1 contract in §9–§22)
```

The decomposition is three vertical, reviewable PRs (I1 foundation → I2 atomic
integration → I3 Inbox API + UI + E2E), each independently mergeable and
reverting. I1 has no dependency on I2/I3; I2 depends on I1; I3 depends on I2.

---

## Appendix A — Final audit response (prompt §23 format)

```text
1.  Verdict                              PASS (V1 contract frozen)
2.  Starting master commit               1c46a96
3.  Branch                               feat/p5-n1-notification-inbox
4.  PR #210 / #211 merge evidence        both MERGED; cac6b85 + c58ac6d ancestors of HEAD
5.  Roadmap synchronization             P3 ✅ CLOSED; P5-N1 🔄 REALITY AUDIT IN PROGRESS; P6 ⏸
6.  ADR-011 stale-fact reconciliation   status Proposed → Accepted; §2.1 table updated post-P5-0
7.  P5-N1 Job v2 corrections            §6.1 (publicationVersion removed, no old caller to remove,
                                         no tx refactor, pagination corrected to offset/page)
8.  V1 trigger decision                  manual publication only (resultsPublishedAt null→now);
                                         after_grading / immediate DEFERRED
9.  Recipient eligibility rule           enrolled Candidate whose score-strategy-selected
                                         authoritative attempt (finalAttemptId) is result-ready
10. Authoritative attempt-selection      enrollment.finalAttemptId (shouldSelectAttempt, grading.ts:38-54)
11. Dedupe identity                      result_published:{examId} (Inbox);
                                         result_published:{examId}:{recipientUserId} (outbox)
12. Minimal notification schema          10 columns (§12.1); action_path NOT NULL; severity/resource*/archived/invalidated DEFER
13. Deferred schema fields               severity, resource_type, resource_id, archived_at, invalidated_at
14. users.email contract                 optional, trim+preserve case, not unique, blank→null, not for login, max 320
15. EmailType mapping                    result_published → grade_notification (explicit, tested)
16. Email content boundary               results available + examTitle + trusted link; no score/answer/rubric
17. Action-link design                   buildResultPublishedActionPath(attemptId) → /exam/:attemptId/result
18. Transaction extension seam           exam.ts:1269-1279, ordering: mutation → audit → fan-out (Inbox, then outbox), inside !alreadyPublished
19. Fan-out strategy                     listByExam + batched inserts in same tx; LAN-scale, no MQ
20. Failure policy                       Inbox required (rollback on failure); outbox required when email
                                         exists (rollback); SMTP failure after commit → worker retries
21. Minimal Inbox API                    GET /notifications, GET /unread-count, POST /:id/read,
                                         POST /read-all; authenticate-only; PaginationParamsSchema
22. Minimal Candidate UI                 bell + Popover panel in ExamLayout.tsx header slot; polling
23. Security findings                    all 6 required principles enforced; cross-user anti-enumeration 404;
                                         server-generated link/text; Host not persisted
24. Anti-overdesign decisions            10-col table; no publicationVersion; reuse grade_notification;
                                         offset/page (not cursor); bell+panel (not page); direct repo insert
25. Deferred capabilities                §23 (announced types, preferences, identity migration, template engine...)
26. Test matrix                          §25 (9 layers; all deterministic)
27. Implementation Job decomposition     I1 foundation → I2 atomic integration → I3 API/UI/E2E
28. pnpm verify:static result           (verified after commits)
29. pnpm verify result                   (verified after commits)
30. Commits                              docs: advance phase 3 cursor to P5-N1
                                         docs(p5-n1): reconcile notification architecture with current runtime
                                         docs(p5-n1): freeze result-published Inbox contract
31. Draft PR                            P5-N1: audit result-published Inbox integration (Draft, not Ready)
32. Next authorized Job                 P5-N1-I1 (§26)
```
