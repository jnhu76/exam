# Admin Frozen Result View Verification

> **Task:** P3-MOD-P3-3 — Admin Frozen Result View Proof
> **Mode:** Boundary proof (API + Web tests). Production changes: **None**.

---

## A. Verdict

```text
P3-MOD-P3-3: PASS
```

---

## B. Admin route/DTO findings

The Admin result view is **two distinct endpoints**, each with a clear role:

| Endpoint | Role | Projection source | Used by |
| --- | --- | --- | --- |
| `GET /api/scores/attempts/:attemptId` (`scores.ts:376`) | Admin **result** view | frozen `questionSnapshot` via `buildQuestionResults` (`scores.ts:100-119`); Admin **bypasses publication gate** (`scores.ts:209`) and **keeps standardAnswer** (`scores.ts:434-438`: strip only for `isCandidate`) | `AttemptDetailPage.tsx:454-455` |
| `GET /api/admin/attempts/:attemptId/grading-details` (`gradingQueue.ts:127`) | Admin **manual grading** workflow | frozen `questionSnapshot` (`gradingQueue.ts:177`); filters to `gradingMode === "manual"` only (`:179-182`); `standardAnswer`/`rubric` from frozen snapshot (`:193-194`) | `GradingDetailPage` |

**Key contract facts audited before writing tests:**
- Admin `scores/attempts/:id` **bypasses the publication gate** (`computeResultVisibility` stage 2: `if (role !== "Candidate") return { visible: true }`, `scores.ts:209-211`). So Admin sees score/pass regardless of `resultPublicationMode`/`resultsPublishedAt`.
- Admin `scores/attempts/:id` **keeps standardAnswer** (`isCandidate ? strip : keep`, `scores.ts:434-438`) — the inverse of the candidate strip.
- `buildQuestionResults` joins `attempt.gradingResult` × `attempt.questionSnapshot` (frozen) — **never** a live-question JOIN.
- `grading-details` projection explicitly comments "never JOIN live questions" (`gradingQueue.ts:190-192`).

---

## C. State matrix

| Attempt state | Candidate visibility | Admin visibility |
| --- | --- | --- |
| `pending_manual` | hidden (`not_started`, status=submitted) | visible (frozen answer/rubric/standardAnswer via `grading-details`; objective earnedScore via `scores`) |
| `fully_graded` + `pending_publish` (manual) | **hidden** (`pending_publish`) | **visible** — full score/pass + per-question earnedScore + standardAnswer (PROVEN cross-proof) |
| `fully_graded` + published | visible (25/true) | visible, **unchanged** by publication (PROVEN) |

---

## D. Frozen metadata proof

- Test: `admin scores result is immune to live-question mutation (frozen snapshot truth)` (`scores.test.ts`).
- Mutate LIVE question `content` → `"P3-3 LIVE MUTATED objective prompt"` and `standardAnswer` → `"b"`.
- Admin `scores/attempts/:id` still returns frozen `content === "P3-3 objective prompt"` and `standardAnswer === "a"` (not `"b"`).
- Source: `buildQuestionResults` (`scores.ts:100-119`) reads `attempt.questionSnapshot`, not the live `questions` table.
- The `grading-details` endpoint's frozen immunity is additionally PROVEN by pre-existing `gradingQueue.test.ts:1373` ("keeps frozen metadata even when the live question row changes", P3-MOD-P1-1).

---

## E. Objective proof

- Admin keeps `standardAnswer` (frozen): cross-proof test asserts `objQ.standardAnswer === "a"` and `objQ.score === 10`.
- Candidate answer `"a"` + earnedScore 10 from frozen auto-grade.
- (Candidate side strips standardAnswer — proven in P3-2.)

---

## F. text_response proof

- Cross-proof test: text_response `score === 15` (terminal earnedScore).
- `grading-details` frozen rubric (multiline) + standardAnswer (with-value and null) — PROVEN by pre-existing `gradingQueue.test.ts:1347` (frozen standardAnswer+rubric), `:1416` (null standardAnswer/rubric), `:1444` (multiline candidate answer + rubric). Reused, not duplicated.
- Candidate answer multiline preservation — PROVEN by `gradingQueue.test.ts:1444`.

---

## G. Score identity

Cross-proof + publish test: objective 10 + manual 15 = Admin aggregate `totalScore === 25` = post-publish Candidate visible `totalScore === 25`. Publication does not recompute (admin projection totalScore/passed identical before/after publish — PROVEN).

---

## H. Authorization proof

- Admin → 200 (all tests).
- Candidate → cannot read another candidate's attempt (PROVEN P3-2 ownership, 404). Candidate reading its own hidden result gets the hidden DTO (not the admin projection).
- Unauthenticated → **401** (PROVEN: `rejects unauthenticated access to the admin result endpoint`).
- Candidate denied on grading endpoints → 403 (PROVEN pre-existing `gradingQueue.test.ts:371,817`).
- Teacher routes: not modified (legacy state; P4 scope `P3-MOD-P4-2A`).

---

## I. Frontend consumption proof

- `AttemptDetailPage.tsx` consumes **only** `GET /api/scores/attempts/:id` for the result (line 454-455) + `GET /api/admin/attempts/:id/timeline`. It does **NOT** fetch `/api/questions/:id` — no live-question JOIN on the client (confirmed by grep).
- The page renders score/pass/standardAnswer purely from the Admin scores DTO. Web test `P3-3: renders full admin frozen result` proves score/pass + objective standardAnswer render from the admin DTO (which carries `showResultImmediately:true` + standardAnswer regardless of candidate publication).
- ScoreListPage: navigation/list surface (per existing `ScoreListPage.test.tsx`); full field proof concentrates on AttemptDetailPage.

---

## J. Existing evidence reused (not duplicated)

- `gradingQueue.test.ts` P3-MOD-P1-1 block (1320-1485): frozen standardAnswer/rubric projection, live-mutation immunity, null standardAnswer, multiline answer/rubric — **reused** for INV-A2/A5 on the grading-details endpoint.
- `gradingQueue.test.ts` post-terminal re-grade rejection (1587, 1651) — **reused** for INV post-terminal immutability.
- `scores.test.ts` "allows admins to view a single attempt result" (311) + P3-2 ownership/hidden tests — **reused**.
- `AttemptDetailPage.test.tsx` existing score/pass/standardAnswer rendering tests — **reused**.
- `manual-grading.spec.ts` E2E (P1): admin opens grading details, sees frozen answer/rubric/reference, completes grading — **reused** (no new E2E added; the cross-moment admin-visible/candidate-hidden proof is covered by the API cross-proof test, which is more precise than a UI E2E for this invariant).

---

## K. Tests added

### API (`apps/api/src/routes/scores.test.ts`, +4 — describe "P3-3 admin frozen result view")
1. `cross-proof: fully_graded + manual pending_publish — Admin sees full result, Candidate hidden` — **the core INV-A1 proof**: same attempt, same moment; Admin `scores/attempts/:id` returns totalScore 25 / passed true / objective standardAnswer "a" / per-question earnedScore 10+15; Candidate same endpoint returns `showResultImmediately:false` + `pending_publish` + no score/pass/questionResults.
2. `admin scores result is immune to live-question mutation (frozen snapshot truth)` — INV-A2/A5 for the scores endpoint: live content/standardAnswer edit does not drift the admin result.
3. `publish-results flips candidate visibility but does not change the admin projection` — publication changes candidate release only; admin totalScore/passed unchanged (no recompute).
4. `rejects unauthenticated access to the admin result endpoint` — 401.

### Web (`apps/web/src/pages/admin/AttemptDetailPage.test.tsx`, +1)
5. `P3-3: renders full admin frozen result (score/pass + standardAnswer) from the admin scores DTO` — admin page renders aggregate score/pass + objective frozen standardAnswer from the admin DTO (which bypasses candidate publication).

---

## L. Commands and results

| Command | exit | result |
| --- | :---: | --- |
| `pnpm --filter api test -t "P3-3 admin frozen result"` | 0 | 4 passed (real `exam_test` DB) |
| `pnpm --filter web test -t "P3-3"` | 0 | 1 passed |
| `pnpm --filter api test` | 0 | **954 passed \| 5 skipped (93 files)** |
| `pnpm --filter web test` | 0 | **1089 passed (94 files)** |
| `pnpm --filter contracts test` | 0 | 205 passed (7 files) |
| `pnpm --filter api typecheck` / `--filter web typecheck` | 0 | clean |
| `pnpm lint` / `lint:arch` / `lint:copy` | 0 | all passed |
| `pnpm format:check` | 0 | passed (formatted `scores.test.ts` then re-ran) |

API tests connect to the real `exam_test` Postgres (`pnpm db:up`). No repository mocks; cross-proof/frozen/authz all hit real DB + real route code. No new E2E needed (P1 manual-grading E2E + API cross-proof cover the invariant).

---

## M. Production changes

```text
None
```

Only `apps/api/src/routes/scores.test.ts` + `apps/web/src/pages/admin/AttemptDetailPage.test.tsx` + this report. No route/contract/engine/page source changes.

---

## N. Findings and contract debt

- Non-blocking: the Admin result view reuses the candidate `scores/attempts/:id` endpoint with a role branch (Admin bypasses gate + keeps standardAnswer). This is sound but means "Admin result" is not a distinct route — acceptable for MVP; a dedicated admin projection route is a possible future refinement (not a defect).
- `showResultImmediately` naming (legacy, means "result visible") — carried forward from P3-2 debt record.

---

## O. Deferred Teacher scope

Teacher route/capability migration is **P4** (`P3-MOD-P4-2A`). Teacher access is not changed in this task; current legacy Teacher denial (if any) is expected, not a P3-3 defect.

---

## P. Next task

```text
P3 RESULT PUBLICATION: CLOSED
NEXT: P3-MOD-P4-1 — MVP RBAC route matrix
```
