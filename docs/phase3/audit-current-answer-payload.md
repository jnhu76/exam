# S8 — Current Answer Payload Audit

> **Date:** 2026-06-29
> **Branch:** `phase3/role-check-audit`
> **Purpose:** Map the current answer save/submit payload end to end — schema, the save vs submit difference, where the final answer lives, whether any snapshot/hash/revision/canonicalization exists, and how deadline/force-submit reuse the path. Fact base for the Answer Protocol v2 grillme (L4/L5). Pure documentation — no protocol implemented, no submit behavior changed, no grading schema changed.

---

## TL;DR

- **Save carries a payload; submit carries none.** `POST /attempts/:id/answers/:qid` sends `{ answer, clientSeq, clientSavedAt, baseVersion }`. `POST /attempts/:id/submit` sends **an empty body** — it grades whatever answers are already persisted on the attempt row.
- **The "final answer" is just the last-accepted `AnswerRecord.answer` per question**, stored in the `answers` JSONB column on `exam_attempts`. There is **no separate final-answer table, no submit-time answer payload, no answer snapshot taken at submit**. Submission freezes the row by status (`submitted`), not by copying answers.
- **Versioning exists; hashing/canonicalization do not.** Each answer has a monotonic `version` (server) + `clientSeq` (client) for idempotency and optimistic concurrency. But there is **no content hash, no canonical form, no signature** — the idempotency check is a recursive deep-structural-equality (`answersEqual`), and grading compares `answer` to `standardAnswer` directly.
- **`clientSeqHistory` is an append-only audit trail** of every accepted save per question, stored *inside* the same JSONB answer object. It is the closest thing to an answer history/snapshot, but it grows unbounded and is never pruned.
- **Deadline auto-submit, admin force-submit, and candidate submit all converge on the same engine** (`submitAttempt` → `readGradingSnapshot` → `computeGradingResult` → `finalizeGrading`), and all three run inside one locked transaction with the attempt row lock. However, only candidate submit uses the `submitAndGradeAttempt` orchestrator; force-submit reimplements the locked-tx pattern inline, and the scanner uses the monolithic `gradeAttemptIdempotent` wrapper instead of the decomposed freeze-barrier functions.

---

## 1. Answer Payload — Storage Model

### 1.1 Single JSONB column on `exam_attempts`

**Schema:** `packages/db/src/schema/pg.ts:299`

```ts
answers: jsonb("answers").$type<AnswerRecord[]>().notNull(),
```

There is **no `answers` table**. Every answer for an attempt is one row's JSONB array. Each element is a `StoredAnswer` (API-side superset of the domain `AnswerRecord`).

### 1.2 Domain type — `AnswerRecord`

**`packages/domain/src/types.ts:343-348`**

```ts
interface AnswerRecord {
  questionId: string;
  answer: unknown;     // ← untyped payload; shape depends on question type
  version: number;     // server-assigned, monotonic per question
  savedAt: Date;
}
```

`answer` is `unknown` end to end — contracts, domain, engine, and DB all treat it as opaque JSON. Its real shape is determined by question type (see §2.3).

### 1.3 API-side superset — `StoredAnswer` (the persisted shape)

**`apps/api/src/routes/attempts.candidate.ts:71-95`**

```ts
interface StoredAnswer extends Omit<AnswerRecord, "savedAt"> {
  savedAt: Date | string;
  clientSeq?: number;                  // last client sequence number accepted
  clientSeqHistory?: StoredAnswerReceipt[];  // append-only receipt trail
}

interface StoredAnswerReceipt {
  clientSeq: number;
  answer: unknown;
  version: number;
  savedAt: Date | string;
}
```

So the persisted JSONB element is richer than the domain type: it carries `clientSeq` + a `clientSeqHistory` array. **The domain/engine ignore these extra fields** — they exist only so the save protocol can detect idempotent replays (§4.2).

> **`clientSeqHistory` is an unbounded append-only log.** Every accepted save pushes the *previous* receipt into it (see §5.2). There is no pruning, no cap, no migration. A long exam with many edits grows this array without limit. This is the single biggest payload-shape risk for v2.

---

## 2. Save Answer — Request/Response

### 2.1 Endpoint

`POST /api/attempts/:attemptId/answers/:questionId`
**File:** `apps/api/src/routes/attempts.candidate.ts:744-903`
**Contract:** `packages/contracts/src/attempt.ts:142-193`

### 2.2 Request payload

```ts
SaveAnswerRequestSchema = z.object({
  attemptId: z.string().uuid(),       // must match path
  questionId: z.string().uuid(),      // must match path
  answer: z.unknown(),                // the answer value (opaque)
  clientSeq: z.number().int().min(0), // client monotonic sequence
  clientSavedAt: z.string().datetime(),
  baseVersion: z.number().int().min(0), // client's last-known server version
});
```

Path/body id mismatch → `ValidationError` (line 782). Runs inside a transaction holding the attempt row lock (`findByIdForUpdate`).

### 2.3 The `answer` value shapes (by question type)

The payload is `z.unknown()` at the contract layer; actual shapes are enforced implicitly by the frontend `QuestionRenderer` and consumed by the grading engine:

| Question type | `answer` shape | Example |
|---------------|----------------|---------|
| `single_choice` | `string` (option id) | `"opt_3"` |
| `multiple_choice` | `string[]` (option ids, ordered) | `["opt_1","opt_3"]` |
| `true_false` | `boolean` | `true` |
| `fill_blank` | `string` (or `string[]` for multi-blank) | `"42"` |

There is **no per-type Zod refinement** on `answer` in the contract — any JSON the client sends is accepted by the schema (type-specific validation happens only at grading time, where a mismatch typically scores 0).

### 2.4 Response — discriminated union on `accepted`

```ts
SaveAnswerAcceptedSchema  = { accepted: true,  serverVersion, savedAt }   // .strict()
SaveAnswerRejectedSchema  = { accepted: false, reason, message,
                              serverVersion, savedAt,
                              details?: { serverAnswer? } }                // .strict()
```

Reject reasons (`SaveAnswerRejectReasonEnum`, `attempt.ts:35-41`):
`STALE_VERSION` | `ATTEMPT_ALREADY_SUBMITTED` | `ATTEMPT_CLOSED` | `DEADLINE_EXCEEDED` | `CONFLICTING_PAYLOAD`.

Only `STALE_VERSION` returns `details.serverAnswer` (the server's current answer) so the client can reconcile. `CONFLICTING_PAYLOAD` does **not** — the route handler gates `details` on `conflict.reason === "STALE_VERSION"` only (`attempts.candidate.ts:897-900`), even though the domain type carries `latestAnswer` for both.

---

## 3. Submit — Empty Payload, Reads Stored Answers

### 3.1 Endpoint

`POST /api/attempts/:attemptId/submit`
**File:** `apps/api/src/routes/attempts.candidate.ts:905-961`
**Contract:** `SubmitAttemptRequestSchema` = params only (`attemptId`) — **no body schema**.

### 3.2 Submit carries NO answer payload

```ts
const { attempt } = await submitAndGradeAttempt(
  fastify.db, ctx, attemptId, candidateProfile.id, fastify.now(),
);
```

Submit does **not** receive, echo, or re-validate any answer. It delegates to `submitAndGradeAttempt` (`apps/api/src/orchestrators/submitAndGradeAttempt.ts`), which:

1. Locks the attempt row (`findByIdForUpdate`).
2. Flips status `in_progress|disrupted → submitted` via `submitAttempt`.
3. **Re-reads `attempt.answers` from the same locked transaction** (`readGradingSnapshot`).
4. Computes the score from those locked answers (`computeGradingResult`).
5. Finalizes (`finalizeGrading`).

> **The final answer set is "whatever is in `answers` at the moment the submit lock is taken."** Nothing is copied, snapshotted, or hashed at submit. The freeze is purely a status flag + row lock.

### 3.3 Save vs Submit — the core difference

| Aspect | Save (`/answers/:qid`) | Submit (`/submit`) |
|--------|------------------------|--------------------|
| Carries answer payload? | ✅ yes (`answer` + versioning meta) | ❌ no (params only) |
| Per-question? | ✅ one question | ❌ whole attempt |
| Idempotency | `clientSeq` + structural equality | status-guarded (`graded` is terminal; `submitted` re-grades) |
| Lock | attempt row lock | attempt row lock |
| Side effect | appends to `answers` JSONB | flips status → grades → writes score |
| Version bump | yes (`version++`) | n/a |

**Implication for v2:** a "WYSIWYG submit" (the answer visible at submit time always wins) currently *cannot* be expressed, because submit has no payload — it grades the persisted set, and a racing save can still land before the lock (see `save-submit-race` E2E, which explicitly does NOT assert score===100). This is documented in the spec gap and is the v2 grillme's central question (§7 Q1).

---

## 4. Versioning, Idempotency, Conflict Detection

### 4.1 The protocol — `processSaveAnswer`

**File:** `packages/exam-engine/src/answerProtocol.ts:76-179`

Two independent mechanisms guard a save:

**A. `clientSeq` idempotency (replay detection)** — lines 119-142
- Key: `${questionId}:${clientSeq}`.
- If the key exists and the payload is **structurally equal** → return the prior accepted result (safe replay).
- If the key exists but the payload **differs** → reject `CONFLICTING_PAYLOAD` (client misusing a seq).

**B. `baseVersion` optimistic concurrency** — lines 144-159
- If `baseVersion < currentVersion` → reject `STALE_VERSION`, returning `latestAnswer` for client reconciliation.
- Otherwise accept, `version = currentVersion + 1`.

### 4.2 Structural equality — `answersEqual`

**`answerProtocol.ts:18-58`** — a hand-written recursive deep-equal:
- primitives: `Object.is`
- arrays: ordered, element-wise
- objects: **sorted-key** comparison (so key order doesn't matter)

This is the *only* "canonicalization" in the system — and it's implicit (comparison-only), not a stored canonical form.

### 4.3 Order of checks in `processSaveAnswer`

1. `voided` → `ATTEMPT_CLOSED`
2. `submitted|grading|graded` → `ATTEMPT_ALREADY_SUBMITTED`
3. past deadline → `DEADLINE_EXCEEDED`
4. idempotency key hit → replay or `CONFLICTING_PAYLOAD`
5. stale baseVersion → `STALE_VERSION`
6. else → accept, bump version

---

## 5. Where the "Final Answer" Lives / Persistence Path

### 5.1 No separate final-answer store

There is **no** `final_answers` table, no submit-time copy, no immutable snapshot table. The final answer for a question is `StoredAnswer.answer` at the version that was current when submit locked the row.

### 5.2 How a save rewrites the JSONB (`attempts.candidate.ts:835-866`)

On accept, the handler rebuilds the whole `answers` array:

```ts
const storedNewAnswer: NormalizedStoredAnswer = {
  ...saveResult.newAnswer,          // { questionId, answer, version, savedAt }
  clientSeq: body.clientSeq,
  clientSeqHistory: [
    ...(previousAnswer?.clientSeqHistory ?? []),  // prior receipts
    ...previousReceipt,                            // the just-superseded receipt
  ],
};
const newAnswers = storedAnswers
  .filter((a) => a.questionId !== questionId)     // drop old entry
  .concat([storedNewAnswer]);                      // append new entry
await txRepo.update(ctx, attemptId, { answers: newAnswers, lastActivityAt: now });
```

Key facts:
- The **entire `answers` array is rewritten on every single save** (read-modify-write of the whole JSONB). No partial update.
- `clientSeqHistory` grows by one receipt per superseded version — **unbounded**.
- `lastActivityAt` is bumped on every accepted save (this is the heartbeat field).

### 5.3 Is there an "answer snapshot"?

**No, not in the v2 sense.** The closest things:
- **`clientSeqHistory`** — an append-only receipt trail *per question*, but it's mutation history, not a frozen point-in-time set.
- **`questionSnapshot`** — this is the *question* snapshot (questions frozen at attempt creation so later edits don't affect attempts). It is NOT an answer snapshot. Do not confuse the two.

So at submit there is **no frozen answer snapshot** — the freeze is behavioral (status flip + row lock), not structural (no copy).

---

## 6. Hash / Revision / Canonicalization — Does It Exist?

| Mechanism | Present? | Evidence |
|-----------|----------|----------|
| Content hash (sha256 etc.) | ❌ **No** | only crypto in repo is session-token hashing (`packages/auth/src/session.ts`); no hash of answer content anywhere |
| Canonical stored form | ❌ **No** | `answer` stored exactly as sent; only an in-memory sorted-key *comparison* exists (`answersEqual`) |
| Digital signature / integrity tag | ❌ **No** | — |
| Server-side revision number | ✅ **Yes** | `version` per question, monotonic, server-assigned |
| Client-side sequence | ✅ **Yes** | `clientSeq`, monotonic per client session |
| Append-only history | ⚠️ **Partial** | `clientSeqHistory` receipts, but unbounded and per-question only |

> **Bottom line:** the protocol is *versioned* (good) but *not content-integrity-checked* (no hash/signature/canonical form). Two structurally-equal-but-byte-different payloads (e.g. key order) are treated as equal by `answersEqual`; two byte-equal payloads sent under different `clientSeq` are treated as different. v2 grillme must decide whether content integrity matters.

---

## 7. Deadline / Force-Submit — Do They Reuse the Same Path?

### 7.1 Three submit entry points, one engine core

| Entry | File | Reuses engine? | Reuses `submitAndGradeAttempt`? |
|-------|------|----------------|---------------------------------|
| Candidate submit | `attempts.candidate.ts:940` | ✅ | ✅ directly |
| Admin force-submit | `attempts.admin.ts:169-235` | ✅ (inline) | ❌ reimplements the locked-tx pattern inline |
| Deadline scanner | `deadlineScanner.ts:129-133` | ✅ (one tx, monolithic wrapper) | ❌ uses `gradeAttemptIdempotent` instead of decomposed freeze-barrier functions |

**All three call `submitAttempt`** (the state-machine command that flips status to `submitted`). All three then grade from `attempt.answers`. So **the answer read path is identical** — they all grade the persisted JSONB.

### 7.2 The ADR-008 freeze barrier (candidate submit only)

`submitAndGradeAttempt` runs submit + snapshot-read + score-compute + finalize **in one transaction under the row lock** (`submitAndGradeAttempt.ts:50-121`). The orchestrator's docstring is explicit: this prevents a racing save from changing which answer the score is computed from.

### 7.3 Force-submit does NOT reuse `submitAndGradeAttempt`

`attempts.admin.ts` reimplements the same locked-tx + submit + grade pattern inline (comment at line 163: "Matches `autoSubmitAndGrade` / `submitAndGradeAttempt`"). It is behaviorally equivalent today but is a **code duplication** — a v2 change to the submit path would have to be applied in three places. This is a maintenance hazard, not a correctness bug (the E2E `proctor-runtime.spec` covers force-submit grading).

### 7.4 Deadline scanner uses a different engine API surface (but same tx safety)

`deadlineScanner.ts:110-136` runs `submitAttempt` + `gradeAttemptIdempotent` **inside one `executeInTransaction`** with the row lock — it IS transactionally safe, equivalent to the candidate freeze barrier in atomicity. The difference is API surface: the scanner uses the monolithic `gradeAttemptIdempotent` wrapper (which internally calls `readGradingSnapshot` → `computeGradingResult` → `finalizeGrading`), while the candidate path uses those three functions decomposed inside `submitAndGradeAttempt`. Both read from the same locked transaction. The maintenance hazard is that a v2 change to the grading pipeline must be applied in two code paths, not that the scanner has a wider race window.

---

## 8. Grading Read Path (how answers feed scores)

**File:** `packages/exam-engine/src/grading.ts`

```ts
computeGradingResult(attempt, exam, now)
  → gradeAnswers(attempt.id, attempt.questionSnapshot, attempt.answers, exam.passingScore, now)
```

- Reads `attempt.answers` (the `AnswerRecord[]`) directly — no copy, no projection.
- Matches each answer to its question via `questionId` against `questionSnapshot`.
- Compares `answer` to the snapshot's `standardAnswer` per the question's `gradingRule` (`multiSelectScoring`, `fillBlankMatchMode`, `fillBlankCaseSensitive`).
- Subjective questions (`standardAnswer == null`) are excluded from auto-grading; they go through the manual grading path (`gradingQueue.ts`, see S4/S6), which reads `attempt.answers` the same way (`answerByQuestion` map, `gradingQueue.ts:154`).

> The grading path trusts `attempt.answers` as-is. There is no integrity re-check, no re-canonicalization, no validation that `answer` matches the question type before grading — a malformed answer simply scores 0.

---

## 9. Frontend Answer State (cross-ref)

Detailed in S7; summarized here for the payload picture:

- `answers: Map<questionId, unknown>` — local mirror of `attempt.answers`, updated optimistically and on server accept/stale-reconcile (`TakeExamPage.tsx:105`).
- `versionsRef: Map<questionId, number>` — mirrors server `version`, sent back as `baseVersion` on next save.
- `clientSeqsRef: Map<questionId, number>` — monotonic client seq, seeded to current version on load so the first save isn't a replay (`TakeExamPage.tsx:159-166`).
- `useSubmitFlush` debounces saves (1500ms) and flushes all pending before submit (`hooks/useSubmitFlush.ts`).

The frontend **never sends the full answer set** — only per-question deltas. Submit sends nothing.

---

## 10. L4 / L5 Grillme — Input Questions (Answer Protocol v2)

Surfaced, not answered.

### Q1 — WYSIWYG submit
Submit carries no payload today, so "the answer visible at submit time" can lose to a racing persisted save (`save-submit-race` E2E documents this). Should v2 make submit carry a final-answer payload + version barrier (the spec's "Option D")? What does the candidate sign at submit — the whole set, or per-question?

### Q2 — Bounded `clientSeqHistory`
The append-only receipt trail grows without limit inside the JSONB. Should v2 cap it, rotate it, or move it to a separate append-only table? What's the retention/audit requirement vs. storage cost?

### Q3 — Whole-array rewrite
Every save read-modify-writes the entire `answers` JSONB. Under concurrent saves this is serialized by the row lock, but it's write-amplifying. Should v2 move to a per-answer row model (`attempt_answers` table)?

### Q4 — Content integrity
No hash/canonical/signature exists. Does v2 need content integrity (detect tampering between save and grade)? If so, hash what — the raw JSON, a canonical form, or a type-aware normalized form? Where is the hash stored and verified?

### Q5 — `answer: unknown` typing
The payload is opaque end to end; malformed answers silently score 0. Should v2 add per-type Zod refinement at save time (reject malformed early) or keep grading as the only validator? What about new question types (Phase 2+)?

### Q6 — Three submit paths
Candidate, force-submit, and deadline scanner all run submit+grade in one locked transaction, but via different code paths (`submitAndGradeAttempt` orchestrator vs inline reimplementation vs `gradeAttemptIdempotent` wrapper). Should v2 funnel them through one orchestrator so the freeze barrier and any new payload handling apply uniformly?

### Q7 — Snapshot at submit
There's no frozen answer snapshot at submit — the freeze is status+lock. Should v2 write an immutable `submitted_answers` snapshot at submit for audit/grade-dispute, separate from the mutable `answers`? What are the privacy implications (S6 §1.3)?

### Q8 — Idempotency vs integrity
`clientSeq` idempotency relies on structural equality. Is that the right replay contract for v2, or should it be a content hash so byte-different-but-equal payloads are also deduped? What happens across reconnects where `clientSeq` resets?

---

## 11. File Inventory

### Contracts / domain

| File | Role |
|------|------|
| `packages/contracts/src/attempt.ts:142-193` | `SaveAnswerRequestSchema`, accepted/rejected/response schemas, reject-reason enum |
| `packages/contracts/src/attempt.ts:90-95` | `AnswerRecordSchema` (the persisted element) |
| `packages/domain/src/types.ts:343-384` | `AnswerRecord`, `SaveAnswerRequest`, accepted/rejected response types |

### Engine (the protocol)

| File | Role |
|------|------|
| `packages/exam-engine/src/answerProtocol.ts` | `processSaveAnswer` + `answersEqual` (the entire save protocol) |
| `packages/exam-engine/src/grading.ts:88-113` | `readGradingSnapshot` (answer read path); `computeGradingResult` at `:119-131` calls into `gradeAnswers` |
| `packages/exam-engine/src/attemptCommands.ts` | `submitAttempt` (status flip command) |

### API

| File | Role |
|------|------|
| `apps/api/src/routes/attempts.candidate.ts:744-903` | save-answer route + JSONB rewrite (§5.2) |
| `apps/api/src/routes/attempts.candidate.ts:905-961` | submit route (empty payload) |
| `apps/api/src/orchestrators/submitAndGradeAttempt.ts` | candidate submit+grade freeze barrier (ADR-008) |
| `apps/api/src/routes/attempts.admin.ts:169-235` | force-submit (reimplemented inline) |
| `apps/api/src/plugins/deadlineScanner.ts:129-133` | deadline auto-submit (split calls) |

### DB / storage

| File | Role |
|------|------|
| `packages/db/src/schema/pg.ts:299` | `answers` JSONB column on `exam_attempts` |
| `packages/db/src/repository/attemptRepo.ts` | `findByIdForUpdate`, `update` (the read-modify-write) |

### Frontend (cross-ref S7)

| File | Role |
|------|------|
| `apps/web/src/pages/exam/TakeExamPage.tsx:240-346` | `saveAnswer` (optimistic + protocol) |
| `apps/web/src/hooks/useSubmitFlush.ts` | debounce + flush |

---

## 12. Risk Summary

- **R1 — No WYSIWYG submit.** Submit has no payload; a racing save can change the graded answer. Documented gap; v2 Q1.
- **R2 — Unbounded `clientSeqHistory`.** Grows per-question without cap inside JSONB; long exams / heavy editors inflate the row. v2 Q2.
- **R3 — Whole-array rewrite per save.** Write amplification; serialized by row lock but expensive under load. v2 Q3.
- **R4 — No content integrity.** No hash/canonical/signature; tampering between save and grade is undetectable. v2 Q4.
- **R5 — Three submit paths.** Candidate / force-submit / scanner reimplement the flow; a v2 change must touch all three or diverge. v2 Q6.
- **R6 — `answer: unknown` everywhere.** Malformed payloads silently score 0; no early rejection. v2 Q5.
- **R7 — Scanner uses different engine API.** Deadline scanner uses `gradeAttemptIdempotent` (monolithic wrapper) instead of the decomposed freeze-barrier functions used by `submitAndGradeAttempt`. Both are inside one locked transaction — this is a maintenance hazard (two code paths for the grading pipeline), not a race-window bug. §7.4.

---

## 13. Documentation References

| Doc | Content |
|-----|---------|
| `docs/SPEC.md` §3.5 | Answer Save Protocol (versioned, idempotent) — the spec this implements |
| `docs/phase3/job-cards.md` §S8 | This job card |
| `docs/phase3/audit-current-candidate-runtime.md` | Frontend answer state + save/submit UI flow (S7) |
| `docs/phase3/audit-current-events.md` | Save/submit telemetry + audit events (S6) |
| `apps/api/src/orchestrators/submitAndGradeAttempt.ts:22-42` | ADR-008 freeze barrier docstring |
| `apps/e2e/e2e/save-submit-race.spec.ts:29-34` | Explicit non-guarantee of WYSIWYG submit |
