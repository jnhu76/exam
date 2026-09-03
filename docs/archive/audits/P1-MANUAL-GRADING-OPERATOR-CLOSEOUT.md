# P1 Manual Grading Operator Closeout

Closeout date: 2026-07-30
Branch: `feat/p1-grading-operator-closeout`
Base: `master` @ `32a81ad6`
Source audit: `docs/audits/P1-MANUAL-GRADING-OPERATOR-REALITY-AUDIT.md`

## 1. Executive verdict

The manual grading backend is a correct one-time irrevocable scoring model
(audit conclusion unchanged). The closeout closes the operator-facing gap that
the audit identified as P1: the frontend presented that irrevocable commit as
an ordinary "save", conflated "not graded" with "scored 0", showed no
post-submit feedback, no confirmation, no read-only completed state, and no
network-result reconciliation. The backend SQL also lacked a defense-in-depth
transition guard.

This task did **not** redesign grading. No draft / finalize / reopen / revision
/ review states were introduced. The MVP one-time scoring semantics
(`pending_manual → completed_manual`, last question auto-closes) are frozen and
unchanged. All work is operator-UX truthfulness, client-side reconciliation, and
one SQL guard — the authority graph, the single aggregation path, and the
single terminal writer are untouched.

## 2. Original findings addressed

See §11 for the per-finding verdict table. Summary: all 5 P1 findings CLOSED,
P2-1 (SQL guard) CLOSED. The remaining P2 items (search/filter, independent
answer/identity permission enforcement, broader E2E) are out of this task's
frozen scope and stay deferred per the audit.

## 3. Frozen MVP semantics

Preserved exactly (no behavior change):

```
pending_manual
    → operator explicitly submits a score for this question
completed_manual
    → the last pending_manual question is completed
graded + fully_graded
    → canonical terminal closure (finalizeTerminalGrading) ran in the same tx
```

- One-time scoring per question; completed entries are immutable under the
  ordinary grading command.
- The last completed question auto-triggers canonical terminal closure — there
  is no separate attempt-level finalize step.
- No draft, no reopen, no revision, no double-grading, no anonymous grading,
  no M11 assignment. (All deferred per audit D-1..D-5.)

## 4. Implementation changes

Six commits, one per slice (+ the audit doc carried in from the working tree):

| Slice | Commit | Subject |
| ----- | ------ | ------- |
| 1 | `69d85806` | fix(grading): require explicit score entry |
| 2 | `92e9beea` | fix(grading): close operator submission UX |
| 3 | `84048002` | fix(grading): reconcile ambiguous score submissions |
| 4 | `c55b4f72` | fix(db): guard manual grading entry completion |
| 5 | (this slice) | test(e2e): cover partial manual grading recovery |
| docs | (this slice) | docs(grading): close manual grading operator workflow |

Files changed (production):
- `apps/web/src/pages/admin/GradingDetailPage.tsx` — score-input string model,
  confirmation dialog, read-only completed state, authoritative GET refresh,
  ambiguous-result reconciliation.
- `apps/web/src/i18n/locales/zh-CN.ts` — submission / reconciliation copy.
- `packages/db/src/repository/attemptGradingEntryRepo.ts` — SQL status+mode
  guard on `completeManualEntry`.

Files changed (test/E2E):
- `apps/web/src/pages/admin/GradingDetailPage.test.tsx`
- `packages/db/src/repository/attemptGradingEntryRepo.test.ts`
- `apps/e2e/e2e/manual-grading.spec.ts` (button-rename + confirm flow)
- `apps/e2e/e2e/manual-grading-partial-recovery.spec.ts` (new)

## 5. Empty score versus explicit zero (P1-3)

The score input is now a raw-string model. Three states are distinct and cannot
collapse via `Number("") === 0`:

```
pending question   → input is "" (empty)      → cannot POST, field error 请输入分数
explicit zero      → input is "0"             → POSTs score: 0 (legal grade)
positive score     → input is the number      → POSTs normally
completed question → input is String(entry.score), disabled
```

`parseScoreInput(raw, maxScore)` treats empty/whitespace and non-finite input as
`scoreRequired` before any range check; an explicit "0" stays valid. The
backend `z.number().min(0)` contract is unchanged — `score: 0` remains a legal
grade at the API/engine layer.

## 6. Successful submission state synchronization (P1-2)

On a successful POST the page re-GETs `grading-details` and replaces ALL local
state (data, scores, comments) from the server response. The just-graded
question immediately becomes read-only with the **real** committed
`gradedBy` / `gradedAt` / score / comment. The client never fabricates
`gradedAt = new Date()` or a `gradedBy` display name. A completed question
(`q.entry !== null`) or a fully-graded attempt renders all inputs disabled with
no submit button and a "已提交评分" marker.

## 7. Ambiguous result reconciliation (P1-5, P2-4)

On POST error the page does NOT assume failure. It re-GETs grading-details and
branches on the target question's authoritative server entry status (never on
matching an English error message):

- **Case A** — entry now `completed_manual`: committed despite the lost
  response. Neutral synchronized-success; read-only. No "retry".
- **Case B** — entry still `pending_manual` and attempt still `pending_manual`:
  real failure. Operator input restored, control editable, real failure message.
  No auto re-POST.
- **Case C** — attempt now `fully_graded` or question gone: latest state loaded,
  status-changed message.
- **Failure-of-failure** — reconciliation GET also fails: input preserved,
  "无法确认评分是否已提交，请刷新页面核对", no auto-POST, no success claim.

## 8. SQL transition guard (P2-1)

`completeManualEntry`'s UPDATE WHERE now also requires
`grading_mode = 'manual' AND status = 'pending_manual'`. A non-matching UPDATE
touches zero rows and returns null; the engine fails closed on null
(`NotFoundError`). This is defense-in-depth — the engine state machine remains
the primary authority, and the attempt FOR UPDATE lock is unchanged. The guard
makes a `completed_manual` entry un-overwritable and an `auto` entry
un-completable even if the engine guard were ever bypassed.

## 9. Test evidence

(see the morning report / `.artifacts/.../test-results.md` for full command +
exit-code + pass/fail counts). Headline:

- Web grading detail unit: 54 passed (was 33; +21 across slices 1-3).
- DB grading entry repo: 15 passed (was 12; +3 SQL-guard tests).
- Engine grading suites: 60 passed with the guard in place.
- API grading suites: 42 passed with the guard in place.
- E2E `manual-grading.spec.ts` (blocking): green after the button-rename +
  confirm-flow update.
- E2E `manual-grading-partial-recovery.spec.ts` (new): two-subjective-question
  partial-completion + reload recovery + explicit-0 completion → fully graded.

## 10. Remaining deferred capabilities

Unchanged from the audit (D-1..D-5): no reopen/revision, no anonymous grading,
no M11 assignment, no rubric auto-scoring, no batch grading. P2-5 (independent
`grading.answer.view` / `grading.identity.view` enforcement) and P2-6 (queue
search/filter) remain documented limitations, not defects.

## 11. Per-finding verdict (audit P1)

| Finding | Result | Evidence |
| ------- | ------ | -------- |
| P1-1 misleading "保存" label | CLOSED | 提交评分 / 提交中... copy + irrevocability banner + confirmation dialog (Slice 2) |
| P1-2 no per-entry post-submit feedback | CLOSED | authoritative GET refresh → read-only completed state with score/comment/gradedBy/gradedAt (Slice 2) |
| P1-3 ungraded defaults to 0 | CLOSED | string score-input model + parseScoreInput; empty ≠ 0; explicit 0 legal (Slice 1) |
| P1-4 no confirmation before submit | CLOSED | controlled AlertDialog with score/max/irrevocable, confirm gates the POST (Slice 2) |
| P1-5 no error discrimination / reconciliation | CLOSED | authoritative GET reconciliation, Cases A/B/C + failure-of-failure (Slice 3) |
| P2-1 SQL status guard | CLOSED | grading_mode + status WHERE guard on completeManualEntry (Slice 4) |

## 12. Commands and results

Captured in `.artifacts/p1-grading-operator-closeout/baseline.md` and
`.artifacts/p1-grading-operator-closeout/test-results.md` (gitignored execution
evidence). Every focused suite was run with a real exit code; no GREEN claim is
made without a run.
