# P3-R0 — Final-Role Result Publishing Closeout Reality Audit

> **Job:** `P3-R0 — Final-Role Result Publishing Closeout Reality Audit`
> **Type:** Reality audit (production code modified: **no**; test code modified:
> **no**). Determine the exact remaining work to close result publishing under
> the final Admin/Teacher/Candidate role model, and freeze the authoritative
> transaction boundary that P5-N1 will later extend.
> **Branch:** `feat/p3-result-publishing-closeout`
> **Starting master commit:** `cac6b85` (`P5-0: Email Delivery Runtime …` — PR #210)
> **Audit date:** 2026-07-25
> **Predecessors (read first):** `AGENTS.md`, `docs/roadmap/phase3-open-items.md`,
> `docs/status/implementation-status.md`, `docs/audits/P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT.md`,
> `docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md`,
> `docs/archive/phase3/p3-candidate-result-answer-visibility-proof.md`,
> `docs/archive/phase3/p3-admin-result-view-verification.md`.

This audit does **not** implement Inbox, Email integration, notifications,
`users.email`, new visibility modes, or resource-scoped Teacher authorization.
It does **not** declare P3 CLOSED.

---

## 1. Starting commit

```text
branch              feat/p3-result-publishing-closeout
base (master)       cac6b85  P5-0: Email Delivery Runtime - claim, worker, heartbeat, new statuses (#210)
PR #210             state=MERGED, mergedAt=2026-07-25T03:19:33Z, mergeCommit=cac6b85
working tree        clean (docs-only commit ddb55a4 already on branch:
                              "docs: advance phase 3 cursor to result publishing")
```

Entry gate satisfied: PR #210 merged into master; branch based on the merge
commit; `pnpm install --frozen-lockfile` clean; `pnpm verify` exit 0 (see §15
for the cache reality and the forced re-run evidence).

---

## 2. Authority read

Read in full (not summarized): `AGENTS.md`; `docs/roadmap/phase3-open-items.md`
(P3/P4/P5-0/P5-N1 sections); `docs/status/implementation-status.md`;
`docs/audits/P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT.md`;
`docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md`; the two archived P3 proofs
(`p3-candidate-result-answer-visibility-proof.md`,
`p3-admin-result-view-verification.md`).

Code authority read (executable evidence, line numbers current to `cac6b85`):

| Concern | File:line |
| --- | --- |
| Publication command | `packages/exam-engine/src/examCommands.ts:392` (`publishResults`) |
| Publication route (tx boundary) | `apps/api/src/routes/exam.ts:1240-1301` (`POST /exams/:id/publish-results`) |
| Result-visibility decision | `apps/api/src/routes/scores.ts:173` (`computeResultVisibility`) |
| Score result route | `apps/api/src/routes/scores.ts:413-492` (`GET /scores/attempts/:attemptId`) |
| Score-list route | `apps/api/src/routes/scores.ts:267-391` (`GET /exams/:id/scores`) |
| Score capability gate | `apps/api/src/authz/scoreCapability.ts:81` (`buildScoreCapabilityPreHandler`) |
| Flat capability gate | `apps/api/src/plugins/auth.ts:257` (`requireCapability`) |
| Role preset matrix | `packages/authz/src/presets.ts:51-286` (Admin/Teacher/Candidate/Proctor/Grader/System) |
| Capability catalog | `packages/authz/src/catalog.ts:72,83,108-112` (`ExamResultPublish`, `ScoreOwnView`, `ScoreAllView`) |
| Manual-grading finalize (after_grading trigger) | `apps/api/src/routes/gradingQueue.ts:318-382` (`grade-question` tx) |
| Submit + auto-grade (immediate trigger) | `apps/api/src/orchestrators/submitAndGradeAttempt.ts:50` |
| Transaction helper | `packages/db/src/types.ts:128` (`executeInTransaction`) |
| Atomic audit writer | `apps/api/src/audit/auditWriter.ts:130` (`recordAtomicHttpAudit`) |
| Result DTO contracts | `packages/contracts/src/score.ts:208-288` (`AttemptResultResponseSchema`) |
| DB schema (result cols) | `packages/db/src/schema/pg.ts:237-245` (`result_publication_mode`, `results_published_at`) |
| Migration backfill | `packages/db/migrations/postgres/0005_abnormal_clea.sql:1-12` |
| Result-page consumer | `apps/web/src/pages/exam/ResultPage.tsx:98,254` |
| Admin attempt-detail consumer | `apps/web/src/pages/admin/AttemptDetailPage.tsx:194-209,457` |
| Publish-results UI gate | `apps/web/src/lib/capabilities.ts:205` (`canPublishResults`) |

---

## 3. Current publication state machine

Result visibility is **computed at read time**, not stored as a published flag.
Two gates compose (both must pass for a *candidate* to see the full result):

```text
                 ┌─────────────────────────────────────────────────────┐
   Candidate ───▶│ GET /scores/attempts/:attemptId                     │
   (ScoreOwnView)│                                                     │
                 │  Stage 1 — resultReady (computeResultVisibility):   │
                 │    status == "graded"                               │
                 │      AND score/passed/gradedAt/gradingResult set    │
                 │      AND gradingStatus != "pending_manual"          │
                 │      AND (mode != after_grading                     │
                 │           OR gradingStatus == "fully_graded")       │
                 │    else → hidden {not_started | not_graded}         │
                 │                                                     │
                 │  Stage 2 — publication gate (own-view path only):   │
                 │    immediate     → visible                          │
                 │    after_grading → visible (Stage 1 already forced  │
                 │                     fully_graded)                   │
                 │    manual        → visible iff resultsPublishedAt   │
                 │                     != null                         │
                 │                     else → hidden {pending_publish} │
                 │                                                     │
                 │  all-view path (ScoreAllView) bypasses Stage 2.     │
                 └─────────────────────────────────────────────────────┘
```

Authoritative mutation for Stage 2: `publishResults`
(`examCommands.ts:392`) sets `exam.resultsPublishedAt = now`. It is **not** a
lifecycle status transition (`exam.status` is unchanged). Allowed from
`published | open | closed`; `draft | canceled | archived` are rejected.
Idempotent: a repeat call returns `{ alreadyPublished: true }` and leaves the
timestamp unchanged.

Stage 1 has **no explicit "publish" mutation**. `gradingStatus` reaches
`fully_graded` as a side effect of terminal grading inside two transactions:
the candidate submit path (`submitAndGradeAttempt.ts:201` → `finalizeGrading`)
and the manual grade path (`gradingQueue.ts:340` → `gradeQuestion` →
`finalizeTerminalGrading`). There is no separate "publish on grading done"
call — visibility simply flips when the read path next computes Stage 1.

A second, defense-in-depth copy of Stage 1+2 logic exists in
`apps/api/src/routes/attempts.shared.ts:44` (`computeResultVisibility` for the
**CandidateTakeSnapshot** / in-flight take view). It returns only
`"hidden" | "visible"` (no score fields) and never leaks the result during the
exam. It is not the result-page authority.

---

## 4. Publication-mode matrix

| Question | `immediate` | `after_grading` | `manual` |
| --- | --- | --- | --- |
| What makes the result *ready* (Stage 1) | `graded` + score fields + `gradingStatus != pending_manual` | `graded` + score fields + **`gradingStatus == fully_graded`** (auto_graded insufficient) | `graded` + score fields + `gradingStatus != pending_manual` |
| What makes it *visible to Candidate* (Stage 2) | ready ⟹ visible (no extra step) | ready ⟹ visible (no extra step) | ready **AND** `resultsPublishedAt != null` |
| Is `fully_graded` required for candidate visibility? | No (auto_graded is enough) | **Yes** | No (auto_graded is enough) |
| Does `resultsPublishedAt` participate? | No (field ignored by Stage 2) | No (field ignored by Stage 2) | **Yes** (the only mode that reads it) |
| Which command performs publication? | none (implicit) | none (implicit, via terminal grading) | `publishResults` (`examCommands.ts:392`) |
| Which DB rows are mutated? | none on publish | none on publish | `UPDATE exams SET results_published_at = $now, updated_at = $now WHERE organization_id=$org AND id=$exam` (single row, via `examRepo.update`) |
| Can publication be repeated? | n/a (no command) | n/a (no command) | **Yes — idempotent**: repeat returns `alreadyPublished: true`, timestamp unchanged |

DB default for `result_publication_mode` is `'immediate'` (migration
`0005_abnormal_clea.sql:1`). Legacy `control_flags.showResultImmediately: false`
is backfilled to `'manual'` (`0005_abnormal_clea.sql:8-12`). There is **no**
`after_grading` backfill — it is a newer explicit mode settable only on exam
create/update.

---

## 5. Final Admin/Teacher/Candidate capability matrix

Capability-derived (per `presets.ts` + `requireCapability`/`requireScoreCapability`),
**not** legacy role-name. `view` = the score capability path:
`ScoreAllView ⟹ "all"`; `ScoreOwnView + owner ⟹ "own"`.

| Action | Admin | Teacher | Candidate | Unauthenticated | Candidate owning another Candidate's attempt |
| --- | --- | --- | --- | --- | --- |
| **View candidate result** (own/permitted) | `ScoreAllView` ⟹ all-view, full result whenever Stage 1 ready | `ScoreAllView` ⟹ all-view, full result whenever Stage 1 ready (see note T1) | `ScoreOwnView` ⟹ own-view, full result only when Stage 1 **AND** Stage 2 pass | 401 `AUTH_REQUIRED` | 404 `RESOURCE_NOT_FOUND` (anti-enumeration; not 403) |
| **View frozen standard answer** | all-view ⟹ kept (`stripStandardAnswer = view === "own"` ⟹ false) | all-view ⟹ kept (same rule; note T1) | own-view ⟹ **stripped** (`standardAnswer` removed per question) | 401 | n/a (denied at the gate) |
| **Publish results** (`POST /exams/:id/publish-results`) | `ExamResultPublish` ⟹ allowed, any exam | `ExamResultPublish` ⟹ **allowed, any exam** (note T2: route uses flat `requireCapability`, no resource scope wired) | no `ExamResultPublish` ⟹ 403 `PERMISSION_DENIED` | 401 | 403 (no capability) |
| **View grading details** (`GET /admin/attempts/:id/grading-details`) | `GradingDetailView` ⟹ allowed (scoped resolver wired) | **no** `GradingDetailView` in preset ⟹ 403 | no ⟹ 403 | 401 | 403 |

**Note T1 (Teacher result view).** Teacher preset grants `ScoreAllView`
(`presets.ts:140`, marked `⚠️ scoped`). The score result route arbitrates
own/all purely from the capability set (`scoreCapability.ts:150-153`): a Teacher
holding `ScoreAllView` reaches the **all-view** path and (a) bypasses Stage 2
publication gate and (b) keeps `standardAnswer`. The route has no resource
scope resolver on this path. So at runtime a Teacher sees any same-org
candidate's full frozen result (including standardAnswer) regardless of
publication mode. This is the intended P4 product behavior for the MVP
Teacher (course/exam manager) and matches the P4-C3 result-surface proof
(§4 of `P4-C3-THREE-ROLE-E2E-EVIDENCE.md`).

**Note T2 (Teacher publish).** Teacher preset grants `ExamResultPublish`
(`presets.ts:139`, marked `⚠️ scoped`). The publish-results route uses flat
`requireCapability(Permission.ExamResultPublish)` (`exam.ts:1245`) — **no**
`requireScopedCapability`/exam resolver. So at runtime a Teacher can publish
results for **any** exam in the org, not only exams scoped to their
assignments. Resource-scoped Teacher authorization is an explicit P3 **non-goal**
(prompt §7: "resource-scoped Teacher authorization"). This is recorded as a
known scope gap, **not** a defect to fix in P3-R1.

---

## 6. Candidate projection and leakage boundary

Candidate own-view DTO (`AttemptResultResponseSchema`, visible branch,
`packages/contracts/src/score.ts:266-276`) is asserted in
`scores.test.ts:1188` ("result visible: standardAnswer is stripped …") to
contain **none** of:

| Leakage class | In candidate visible DTO? | Mechanism |
| --- | --- | --- |
| `standardAnswer` (per question) | **No** | route strips: `safeQuestionResults = questionResults.map(({ standardAnswer: _, ...rest }) => rest)` when `view === "own"` (`scores.ts:475-478`) |
| `rubric` | **No** | not in `QuestionScoreResultSchema` / `AttemptQuestionResultSchema` at all (`score.ts:8-15,208-218`) |
| `gradingResult` (raw array) | **No** | not projected; only the enriched `questionResults` array is returned |
| `questionSnapshot` | **No** | consumed server-side by `buildQuestionResults` (`scores.ts:95-117`), never serialized |
| grader identity (`gradedBy`) | **No** | not in the result DTO; appears only in `GradingDetailsQuestionSchema.entry` (admin grading surface) |
| grading workset IDs | **No** | not in any result contract |
| internal comments | **No** | `GradeQuestionRequestSchema.comment` stays in `attempt_grading_entries`; not projected to result |
| another Candidate's result | **No** | `scoreCapability.ts:154-166`: own-view holder probing a non-owned attempt ⟹ 404 (anti-enumeration); cross-org ⟹ 403 |

Hidden-result DTO (`HiddenAttemptResultSchema`, `score.ts:245-260`) contains
**only** `{ attemptId, status, showResultImmediately:false, examTitle,
hiddenReason? }` — no `totalScore`, no `passed`, no `questionResults`. PROVEN
by `resultPublishing.test.ts` J5a-2/J5a-8/J5a-10/J5a-11 and `scores.test.ts`
hidden tests.

---

## 7. Frozen-result authority

Result projections (`buildQuestionResults`, `scores.ts:95-117`) join
`attempt.gradingResult` × `attempt.questionSnapshot` — the **frozen** snapshot
copied at publish time (`buildQuestionSnapshot`, `examCommands.ts:49-74`).
There is **no** live-`questions` JOIN on the result path. PROVEN by
`scores.test.ts:1250` ("frozen result metadata is immune to live-question
edits") and the admin-side `scores.test.ts:1575` ("admin scores result is
immune to live-question mutation").

**Publication does not recompute grading.** `publishResults`
(`examCommands.ts:392-417`) touches only `resultsPublishedAt` (+ `updatedAt`).
PROVEN by `scores.test.ts:1617` ("publish-results flips candidate visibility
but does not change the admin projection") and engine test
`examCommands.test.ts:609` (idempotent repeat leaves timestamp unchanged).

---

## 8. Current transaction boundary

The authoritative publication mutation is the `POST /exams/:id/publish-results`
handler (`exam.ts:1258-1301`):

```text
executeInTransaction(fastify.db, async (tx) => {        // repeatable read, retryable
  const published = await publishResults(               // ← single authoritative mutation
    createExamRepoAdapter(createExamRepo(tx), ctx),
    id,
    fastify.now(),
  );
  if (!published.alreadyPublished) {                    // ← no-op guard
    await recordAtomicHttpAudit(tx, request, ctx, {     // ← audit INSIDE tx
      action: "exam.publish_results",
      targetType: "exam",
      targetId: id,
      metadata: { resultsPublishedAt: published.exam.resultsPublishedAt.toISOString() },
    });
  }
  return published;
});
```

- **A transaction IS already used.** `executeInTransaction`
  (`db/types.ts:128`) wraps in `db.transaction(..., { isolationLevel:
  "repeatable read" })`.
- **Repository calls inside it:** exactly one — `publishResults` ⟹
  `examRepo.update(ctx, examId, { resultsPublishedAt: now })` (base CRUD,
  `baseRepo.ts:156`, tenant-scoped `UPDATE … WHERE organization_id AND id`).
- **Audit creation is INSIDE the tx** (`recordAtomicHttpAudit(tx, …)`), and is
  guarded by `!alreadyPublished` so a repeat publish writes **no** audit row.
- **Idempotent** at the engine layer (`examCommands.ts:410-412`: already-set ⟹
  return unchanged, `alreadyPublished: true`) and at the route layer (audit
  suppressed on no-op). See §9 for the retry interaction.

---

## 9. Idempotency and retry behavior

- **Idempotent publish: PROVEN.** `examCommands.test.ts:609` ("is idempotent: a
  repeat call returns alreadyPublished=true and leaves the timestamp
  unchanged") + `resultPublishing.test.ts` J5a-4 (route-level repeat ⟹
  `alreadyPublished: true`, timestamp unchanged) + E2E `result-publishing.spec.ts`
  Scenario B idempotent re-publish no-op.
- **Retry interaction with the tx.** `executeInTransaction` auto-retries on
  serialization conflicts (`isRetryableError`, `db/types.ts:135-157`, exponential
  backoff). `executeInTransaction` re-executes the callback in a fresh
  transaction after a retryable serialization or deadlock failure.

  The failed transaction attempt commits no `resultsPublishedAt` change, audit
  row, notification row or outbox row.

  On the fresh retry snapshot:

  - if another concurrent transaction successfully published the exam, the retry
    observes `resultsPublishedAt != null`, `publishResults` returns
    `alreadyPublished=true`, and the guarded side effects are skipped;

  - if the conflict came from a non-publish mutation, `resultsPublishedAt` may
    remain null, and the retried callback performs exactly one successful
    publication mutation and one audit insert.

  Transaction rollback prevents side effects from a failed attempt. The
  `alreadyPublished` guard controls repeated or concurrent business calls. These
  are related but distinct protections. **Net: retries cannot duplicate side
  effects** (no double timestamp write, no double audit row).
- **Caveat recorded (not a defect).** The idempotency guard reads
  `exam.resultsPublishedAt` set by a *prior committed* publish. Under the
  retry model that is the correct authority. If P5-N1 adds an outbox row
  inside this tx, that row's insert must be guarded the same way (conditional
  on `!alreadyPublished`) or use an idempotency key — otherwise a retry could
  double-insert. The seam in §13 makes this trivial to enforce.

---

## 10. Existing evidence reused (not duplicated)

Per prompt §F — do not duplicate tests whose authority is still valid. The
following are reused as-is (P4 capability rewrite preserved their *invariants*;
only their *cited line numbers* drifted, see §11):

| Evidence | File | Covers | Status |
| --- | --- | --- | --- |
| `publishResults` engine suite | `packages/exam-engine/src/examCommands.test.ts:588` | manual publish, idempotent, state rejections | PROVEN (reused) |
| J5a result-publishing policy | `apps/api/src/routes/resultPublishing.test.ts` | all 3 modes, hiddenReason, idempotent, Admin-allow, Candidate-deny | PROVEN (reused) |
| Score route visibility suite | `apps/api/src/routes/scores.test.ts` (P3-2/P3-3 describes) | manual/after_grading/immediate, standardAnswer strip, cross-candidate 404, frozen immunity, admin cross-proof, publish-no-recompute, unauth 401 | PROVEN (reused) |
| Score capability gate | `apps/api/src/authz/scoreCapability.test.ts` | own/all arbitration, ScoreAllView wins, cross-candidate 404, cross-org 403, multi-role union, no-role-name branch, fail-closed 503 | PROVEN (reused) |
| Score resolver deny mapping | `apps/api/src/authz/resolvers/scoreResolver.test.ts` | resource_not_found/broken_parent_chain/organization_mismatch/resolver_error | PROVEN (reused) |
| Candidate ownership matrix | `apps/api/src/routes/candidateOwnership.test.ts` | cross-candidate result probe ⟹ not B's full result | PROVEN (reused) |
| Grading-queue finalize | `apps/api/src/routes/gradingQueue.test.ts:784,1083,1200` | flips to fully_graded, finalized audit, objective+manual reconcile | PROVEN (reused) |
| Manual grading terminal closure | `apps/api/src/routes/attempts/manualGradingClosure.test.ts` | pending_manual ⟹ fully_graded lifecycle | PROVEN (reused) |
| E2E result publishing | `apps/e2e/e2e/result-publishing.spec.ts` | immediate/manual/after_grading browser+API; partial-score no-leak | PROVEN (reused) |
| E2E manual grading | `apps/e2e/e2e/manual-grading.spec.ts` | text_response ⟹ admin grade ⟹ fully_graded | PROVEN (reused) |
| Route registry conformance | `apps/api/src/authz/routeRegistryConformance.test.ts:410,447` | static: publish-results ⟹ `exam.result.publish`; scores ⟹ `score.all.view` | PROVEN (reused) |
| ResultPage web tests | `apps/web/src/pages/exam/ResultPage.test.tsx` | immediate/hidden/pending_publish/not_graded; score-visible+answers-hidden; no self-release | PROVEN (reused) |
| AttemptDetailPage web tests | `apps/web/src/pages/admin/AttemptDetailPage.test.tsx` | admin frozen result incl. standardAnswer | PROVEN (reused) |
| ExamDetailPage publish-results UI | `apps/web/src/pages/admin/ExamDetailPage.test.tsx:296-369` | publish-results button visibility + fire `POST …/publish-results` | PROVEN (reused) |

### STALE_AFTER_P4 (authority documents, not tests)

The two **archived** P3 proof reports cite pre-P4 code and are STALE as
*line-number authority* (their invariants remain valid and are re-proven by
the current tests above):

- `docs/archive/phase3/p3-candidate-result-answer-visibility-proof.md` cites
  `computeResultVisibility(exam, attempt, role)` (3-arg, role-based) and
  `isCandidate ? strip : keep`. The current signature is
  `computeResultVisibility(exam, attempt, view: "own" | "all")` and the strip
  is `view === "own"` (capability-path-driven, not role-name). Same invariant,
  different authority surface.
- `docs/archive/phase3/p3-admin-result-view-verification.md` cites the same
  pre-P4 signature and the `role !== "Candidate"` admin bypass. The current
  admin bypass is `view === "all"` (ScoreAllView path). Same invariant.

These are archived (under `docs/archive/phase3/`) precisely because they are
historical; they are not current guidance and are not duplicated.

---

## 11. Missing tests

Gaps against the prompt §5 required matrix. Each is a **narrow, additive**
test; none requires production change (see §12).

| # | Required coverage (prompt §5) | Current coverage | Gap | Layer |
| --- | --- | --- | --- | --- |
| M1 | manual: fully graded but unpublished ⟹ Candidate hidden | J5a-2/J5a-10 + scores.test P3-2 | **covered** | API |
| M2 | manual: publish ⟹ Candidate visible | J5a-3 | **covered** | API |
| M3 | manual: repeated publish ⟹ defined idempotent behavior | J5a-4 + engine :609 | **covered** | API+engine |
| M4 | after_grading: auto_graded-not-fully ⟹ Candidate hidden | J5a-8/J5a-11 | **covered** | API |
| M5 | after_grading: fully_graded ⟹ Candidate visible per policy | J5a-9 | **covered** | API |
| M6 | immediate: ready ⟹ Candidate visible without explicit publish | J5a-1 | **covered** | API |
| M7 | Admin: sees frozen result before Candidate publication | scores.test cross-proof :1531 | **covered** | API |
| M8 | **Teacher: final P4 capability behavior for publish** | none — `resultPublishing.test.ts` has 0 `Teacher` references; only Admin-allow + Candidate-deny asserted | **CLOSED** (P3-R1 `resultPublishing.test.ts` M8) | API |
| M9 | **Teacher: final P4 capability behavior for result view (all-view, keeps standardAnswer, bypasses Stage 2)** | none direct (P4-C3 E2E asserts only `200 \| 409 EXAM_NOT_FINISHED` authorization, explicitly *not* result semantics) | **CLOSED** (P3-R1 `scores.test.ts` M9) | API |
| M10 | Candidate: own-result only | candidateOwnership + scoreCapability | **covered** | API |
| M11 | Candidate: no answer/internal-field leakage | scores.test :1188 | **covered** | API |
| M12 | **Teacher publish-results E2E (browser mutation)** | none — P4-C3 used objective true_false only and explicitly excluded manual/after_grading publication | **CLOSED** (P3-R1 `result-publishing.spec.ts` M12) | E2E |
| M13 | **Idempotent publish under tx retry (guard re-evaluates)** | idempotency proven at engine+route layer; the retry-re-execution interaction is inferred, not directly asserted | **CLOSED** (P3-R1 `resultPublishing.test.ts` M13 concurrent) | API/engine |

**No test is "stale after P4" in a way that requires rewriting** — the current
tests already exercise the capability-path authority (`view`-driven, multi-role
union, no role-name branch). The archived *reports* are stale (§10), but the
*tests* they reference were updated during P4 and remain authoritative.

---

## 12. Required production changes

```text
None required to close the result-publication boundary under the final role model.
```

The publication command, route, transaction, capability gates, frozen
projection, and leakage boundary are all correct and proven under the final
Admin/Teacher/Candidate capability model. The only remaining work is
**test-only** closure of gaps M8, M9, M12, M13 (§11).

Recorded scope gaps (explicitly **out of P3**, per prompt §7):

- **Resource-scoped Teacher publish** (T2): Teacher can publish any org exam
  because the route uses flat `requireCapability`. Resource scope is a P3
  non-goal; wired scope resolvers exist (`createExamResolver`) but the
  publish-results route has not adopted `requireScopedCapability`. Defer to a
  later Phase-3/Phase-4 scoped-RBAC job.
- **Contract naming debt** (carried from P3-2/P3-3): `showResultImmediately`
  means "result visible"; `hiddenReason: "not_started"` covers any non-graded
  state. Non-blocking; renaming is out of P3-R1 scope.

---

## 13. Exact P5-N1 extension seam

P5-N1 will attach the first `result_published` notification + Email outbox to
result publication. The exact function to extend is the **`POST
/exams/:id/publish-results` handler's transaction body**
(`apps/api/src/routes/exam.ts:1262-1281`):

```text
executeInTransaction(fastify.db, async (tx) => {
  const published = await publishResults(...);            // ← existing, keep first
  if (!published.alreadyPublished) {                      // ← existing guard, reuse
    await recordAtomicHttpAudit(tx, ...);                 // ← existing, keep
    // ─── P5-N1 extension point (ADD inside this guarded block) ───
    // await notificationRepo.insert(tx, ...);            //   notifications row
    // await emailOutboxRepo.enqueue(tx, ...);            //   email_outbox row
    // ─── both inside the SAME tx ⟹ atomic with the publish mutation ───
  }
  return published;
});
```

Why this seam is correct:

1. **Atomic with the publish.** Adding `notifications` + `email_outbox` inserts
   inside the existing `executeInTransaction` makes them commit-or-rollback with
   `resultsPublishedAt`. No partial publication.
2. **Idempotency preserved for free.** The `!alreadyPublished` guard already
   suppresses the audit on repeat; the same guard suppresses the new rows.
   Retries re-evaluate the guard (§9), so no double notification/outbox on
   serialization-conflict retry.
3. **No recompute.** `publishResults` already returns the committed exam; the
   extension reads `published.exam.resultsPublishedAt` for the notification
   payload — no second grading authority.
4. **Single caller.** `publishResults` has exactly one production caller (this
   route). `after_grading`/`immediate` publication has *no* mutation to extend
   (visibility is computed at read time); P5-N1's `result_published` mapping
   attaches to the **manual publish** event only (matching ADR-011's
   "result_published ⟹ grade_notification" policy for the first integration).

**Caveat for P5-N1 (recorded, not a P3-R1 task):** because `after_grading` and
`immediate` modes have no publish mutation, a `result_published` notification
fired only from this seam covers **manual mode**. If P5-N1 wants notifications
for the auto-release modes, it must add a separate trigger at the terminal
grading transactions (`submitAndGradeAttempt.ts:201` / `gradingQueue.ts:340`),
which is a P5-N1 design decision — **not** a defect in the current P3 boundary.

---

## 14. Scope exclusions

Per prompt §7, this audit does **not** implement or authorize:

```text
notifications table
Inbox routes or UI
users.email
Email enqueue
result_published notification (the rows themselves)
PUBLIC_WEB_ORIGIN / actionPath
template engine
new result visibility modes
answer visibility configuration
grading redesign
live-question result projection
resource-scoped Teacher authorization (T2 is recorded, not fixed)
Proctor or Grader product roles
```

It also does **not** declare P3 CLOSED (prompt: "Do not declare P3 CLOSED
during the audit").

---

## 15. Verification

Environment: real `exam_test` Postgres (`pnpm db:up` → `exam-db-1`, host port
15432). The initial `pnpm verify` was a turbo **cache hit** (FULL TURBO,
source unchanged); to prove the DB integration stages actually pass, the
cache was bypassed and the DB-dependent stages re-run for real:

| Command | exit | result |
| --- | :---: | --- |
| `pnpm verify:static --force` | 0 | lint / lint:copy / lint:arch / lint:db-config / lint:env-contract / lint:repo-contract / lint:ui-gates / lint:eslint / typecheck / openapi:check — all pass |
| `pnpm lint --force` | 0 | Code quality checks passed |
| `pnpm typecheck --force` | 0 | 17/17 (0 cached) |
| `pnpm coverage --force` | 0 | **16/16 tasks, 0 cached, 3m18s** — DB integration tests executed for real |
| `pnpm --filter api test -t "P2D-J5a"` | 0 | 13 passed (result-publishing policy: all 3 modes, idempotency, role deny) |
| `pnpm --filter api test -t "P3-2…P3-3…standardAnswer is stripped…"` | 0 | 8 passed (candidate leakage + admin frozen view) |
| `pnpm --filter api test -t "score capability…candidate ownership…cross-candidate"` | 0 | 54 passed (own/all arbitration, anti-enumeration, cross-org) |
| `git diff --check` | 0 | clean (no whitespace errors) |
| `git status --short` | — | clean working tree |

`pnpm verify` (the canonical entry-gate command) exits 0; its cache content is
identical to the forced re-run above (same source tree), so the entry-gate
result is valid.

---

## 16. Recommended implementation Job

```text
P3 IMPLEMENTED — AWAITING INDEPENDENT CLOSEOUT REVIEW
```

**Rationale.** No production change was required (§12). The publication command,
transaction boundary, capability gates, frozen projection, and leakage boundary
are correct and proven under the final role model. The four test gaps (§11 M8,
M9, M12, M13) are closed by P3-R1 (test-only, no production changes):

- **M8** — Teacher `publish-results` capability behavior (allow, any exam;
  idempotent; capability-driven, not role-name). Add to
  `resultPublishing.test.ts` alongside the existing J5a Admin-allow /
  Candidate-deny rows.
- **M9** — Teacher result-view capability behavior (all-view: bypasses Stage 2,
  keeps standardAnswer, same-org any attempt). Add to `scores.test.ts` P3-3
  describe alongside the Admin cross-proof.
- **M12** — Teacher publish-results E2E (browser mutation through
  `ExamDetailPage`, manual mode, candidate-hidden ⟹ publish ⟹ candidate-visible).
  Add a scenario to `apps/e2e/e2e/result-publishing.spec.ts` using the
  `createTeacherViaApi` / `loginAsTeacher` helpers from P4-C3.
- **M13** — idempotency under tx retry (optional hardening): assert the
  `!alreadyPublished` guard suppresses duplicate audit/rows across a forced
  serialization-retry, documenting the P5-N1 extension invariant.

**Not recommended.** "NARROW TRANSACTION REFACTOR" — the transaction boundary
(§8) is already correct (atomic, audited, idempotent, retry-safe) and is the
exact seam P5-N1 will extend (§13). Refactoring it would risk the frozen
boundary without closing any real gap.

**Not triggered.** "BLOCKED BY SEMANTIC DEFECT" — no semantic defect was found.
The two recorded scope items (T2 resource-scoped Teacher publish; contract
naming debt) are explicit P3 non-goals, not defects.
