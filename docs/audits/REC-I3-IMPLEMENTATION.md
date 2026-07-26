# REC-I3 — Disrupted-Attempt Direct Restore UX (Implementation Closeout)

Authority: `docs/adr/ADR-012-candidate-recovery-contract.md`
Architecture reference: `docs/architecture/exam-system/candidate-recovery.md`

## Status

`REC-I3 IMPLEMENTED — READY FOR HUMAN REVIEW`

This document records the implementation of the explicit frontend recovery
workflow frozen by ADR-012 §Recovery Semantics (Disrupted attempt). It does
not change the recovery contract; it records the as-built frontend behavior
and the validation evidence.

## Base HEAD and branch

```text
BASE_HEAD = 8f082b07b7284f168e9e25a3b38b261f0ed9cebc
branch    = feat/rec-i3-disrupted-restore-ux
```

## Defect reproduced

Before REC-I3, a candidate directly opening `/take/:attemptId` for a legally
resumable disrupted attempt was treated as a generic locked attempt:

```text
GET /candidate/attempts/:attemptId/take
  → snapshot.attemptStatus = "disrupted"
  → snapshot.canResume     = true
  → snapshot.isEditable    = false
  → snapshot.lockReason    = "disrupted"

TakeExamPage: loaded the snapshot but never invoked
              POST /api/attempts/:attemptId/restore.
              The page rendered the generic locked / deadline-style view,
              potentially surfacing "时间到" / "正在自动交卷" copy on a
              legally resumable attempt.
```

The defect is reproduced by the new component tests in
`apps/web/src/pages/exam/TakeExamPage.restore.test.tsx` (Case 1 fails against
master without the implementation; the restoring/retry UI is absent on
master).

## Authoritative restore flow implemented

```text
1. GET /candidate/attempts/:attemptId/take (authoritative snapshot)
2. IF snapshot is terminal or not resumable:
     → do not call restore
     → existing authoritative behavior applies
   ELSE IF snapshot.canResume == true:
     → render restoring UI overlay
     → POST /api/attempts/:attemptId/restore EXACTLY ONCE
     → reload GET /candidate/attempts/:attemptId/take
     → branch on the reloaded snapshot
   ELSE:
     → initialize normally
```

The restore POST response (a legacy `LoadAttemptResponse`) is treated only as
a command acknowledgement. The reloaded snapshot — not the restore response —
is the page authority.

## Restore state model

Narrow UI-only state, separate from save/submit UI state. Lives in
`apps/web/src/exam/useAttemptRestore.ts`:

```ts
type RestoreState = "idle" | "restoring" | "failed";
```

This is not a second source of attempt business truth. `CandidateTakeSnapshot`
remains authoritative; the hook only owns restore UI transitions and the
explicit-restore command lifecycle.

## Race and duplicate-request handling

Verified by component tests (Cases 1, 6, 7, 8):

- `restoreInFlightRef` — synchronous deduplication guard. At most one
  concurrent restore POST per mounted attempt. Resistant to React Strict Mode
  effect replay, snapshot re-renders, and translation re-renders.
- `restoreAttemptIdRef` — per-attempt identity guard. A snapshot update for
  the same attempt does not re-fire auto-restore.
- `cancelledRef` — boolean cleanup flag (proven by Context7 for React 19
  effect patterns). Stale async results after route change or unmount are
  discarded; they cannot overwrite the new attempt page.
- When `attemptId` changes, the guards reset and the new attempt initializes
  independently.
- A user-triggered retry after a genuine failure issues a fresh POST
  (`performRestore({ isRetry: true })`).

## Deadline and terminal race handling

The reloaded snapshot is the only branch point after a restore attempt
(ADR-012 §12):

- Restore succeeds → reload returns `in_progress` / editable → normal exam
  page.
- Deadline wins during restore → reload returns terminal/non-resumable → the
  terminal snapshot wins; no automatic restore loop; no misleading
  network-error message (Case 6).
- Restore request fails (network/server) → retain last authoritative
  disrupted snapshot, surface dedicated `failed` UI, offer user-controlled
  retry, do NOT label it as "time is up" (Case 4).
- Snapshot reload fails after a successful/ambiguous restore → uncertain
  state; surface reload/retry path; do NOT invent `in_progress` (Case 9).

## UI/UX

Implemented with the existing component primitives (LoadingState-style
spinner via AppIcon, Alert, Button, Lucide icons, Tailwind/shadcn tokens). No
new design system or dependency.

- **Restoring** (`restore-restoring-surface`, `role="status"`,
  `aria-live="polite"`): spinner + "正在恢复考试" + "服务器正在确认考试状态和剩余时间，
  请勿关闭页面。" Editable controls and the deadline/time-up overlay do NOT
  render.
- **Restore failure** (`restore-failed-surface`, `role="alert"`,
  `aria-live="assertive"`): destructive Alert titled "恢复考试失败", description
  "未能确认考试状态，请检查网络后重试。", with controls "重试恢复" (retry) and "返回考试列表".
  No internal error details, stack traces, IDs, or raw server messages.
- **Resumable disrupted** (snapshot not yet restored): the existing locked
  overlay is suppressed while restoring/failed surfaces are shown; the
  existing deadline/time-up copy is NOT shown merely because
  `isEditable=false` for a disrupted attempt.

## Telemetry boundary

Reuses the existing `trackExamEvent` helper. Emits narrowly scoped,
existing-style events:

```text
restore_started   { attempt: "initial" | "retry" }
restore_succeeded { durationMs }
restore_failed    { durationMs, errorCode, attempt: "initial" | "retry" }
```

Scoped to `attemptId` + `examId` via `TrackExamEventOptions`. Allowed
metadata only (`durationMs`, `errorCode`, `attempt`). No answer content,
question prompts, standard answers, response bodies, cookies, tokens, or
stack traces are recorded (sanitization also runs through
`sanitizeClientEvent`).

REC-I5 (recovery telemetry correlation architecture) is NOT implemented.

## Time-policy defect (REC-I4 boundary)

REC-I3 calls the existing restore endpoint. The current backend may still
grant full disconnected-time compensation. REC-I3 does NOT change that. The
client deliberately uses neutral copy ("服务器正在确认考试状态和剩余时间") and
does not describe the restored time as "correctly compensated" or "fairly
restored". A code comment near the restore caller notes the boundary:

```text
REC-I3 connects the explicit restore workflow.
REC-I4 owns compensation policy; do not duplicate time logic in the client.
```

## Files inspected

Source files inspected before editing:

```text
apps/web/src/pages/exam/TakeExamPage.tsx
apps/web/src/pages/exam/StartExamPage.tsx
apps/web/src/pages/exam/ExamListPage.tsx
apps/web/src/exam/deriveTakeExamView.ts
apps/web/src/exam/transientReducer.ts
apps/web/src/lib/api.ts
apps/web/src/lib/routes.ts
apps/web/src/lib/examTelemetry.ts
apps/web/src/i18n/locales/zh-CN.ts
apps/web/src/pages/exam/TakeExamPage.snapshot.test.tsx
apps/web/src/pages/exam/StartExamPage.test.tsx

apps/api/src/routes/attempts.candidate.ts
apps/api/src/routes/attempts.shared.ts

docs/adr/ADR-012-candidate-recovery-contract.md
docs/architecture/exam-system/candidate-recovery.md
docs/audits/REC-R1-REALITY-AND-CONTRACT.md
```

Confirmed source facts (§7 of the prompt):

1. GET `/candidate/attempts/:attemptId/take` runs deadline reconciliation
   (inside a locked tx in `attempts.candidate.ts`).
2. The snapshot exposes `canResume`, `canSave`, `isEditable`, `lockReason`,
   `attemptStatus`, `effectiveDeadline`, and terminal capabilities
   (`buildCandidateTakeSnapshot` in `attempts.shared.ts`).
3. POST `/api/attempts/:attemptId/restore` already exists
   (`attempts.candidate.ts`).
4. Restore performs deadline reconciliation before attempting lifecycle
   restore (`ensureAttemptDeadlineReconciled` then `restoreAttempt`).
5. Restore may return a legacy `LoadAttemptResponse` rather than a
   `CandidateTakeSnapshot` (route serializes via
   `LoadAttemptResponseSchema`).
6. `TakeExamPage` previously loaded the snapshot but had no explicit restore
   caller (now added via `useAttemptRestore`).
7. `deriveTakeExamView` projects `canResume` from the authoritative snapshot
   (unchanged).
8. The locked overlay previously used deadline/time-up language for all
   locked states (the restoring/failed surfaces now precede it).
9. `StartExamPage` already demonstrates a successful start/restore request
   pattern (`api.post<AttemptResponse>("/api/attempts/${examId}/start")`); the
   new hook reuses the same `api` wrapper.
10. Existing API error handling (`ApiError`) and test utilities are reused.

## Files changed

```text
apps/web/src/exam/useAttemptRestore.ts               (new, 200 LOC)
apps/web/src/pages/exam/TakeExamPage.tsx             (modified — wiring + restore/failed UI)
apps/web/src/pages/exam/TakeExamPage.restore.test.tsx (new, 12 test cases)
apps/web/src/i18n/locales/zh-CN.ts                   (modified — restore key group)
docs/architecture/exam-system/candidate-recovery.md  (modified — diagram + status section)
docs/audits/REC-I3-IMPLEMENTATION.md                 (new — this closeout)
```

## Tests added

`apps/web/src/pages/exam/TakeExamPage.restore.test.tsx` — 12 component /
integration cases, all on the authoritative snapshot read path:

| # | Case | Behavior asserted |
|---|---|---|
| 1 | Disrupted + canResume deep link | POST restore called once; snapshot reloaded; editable exam renders |
| 2 | Ordinary in-progress attempt | Restore endpoint NOT called |
| 3 | Terminal submitted attempt | Restore endpoint NOT called |
| 4 | Restore request fails | Dedicated failure UI; no time-up copy |
| 5 | Retry succeeds | Second POST fires; snapshot reloads; exam editable |
| 6 | Deadline wins during restore | Terminal snapshot wins; no auto-restore loop |
| 7 | Strict Mode / double-init | Only one concurrent restore POST while in flight |
| 8 | attemptId change | New attempt's restore is never fired by stale results |
| 9 | Snapshot reload fails after restore | No invented in_progress; reload/retry path |
| 10 | Existing editable flow (regression) | Saves still flow via the existing path |
| UX-A | Restoring UI | Accessible surface; no editable controls while pending |
| UX-B | Failure affordances | "重试恢复" + "返回考试列表" both reachable |

Test quality: assertions are user-visible behavior and API calls (POST
count, snapshot reload count, control reachability). Deterministic deferred
promises hold restore POSTs pending for concurrency assertions; no arbitrary
sleeps.

## Context7 documentation consulted

- **React 19** (`/reactjs/react.dev`): `useEffect` cleanup patterns for async
  initialization; confirmed the `let ignore = false` boolean cleanup flag as
  the canonical Strict Mode race guard. Confirmed Strict Mode runs an extra
  setup+cleanup cycle on the first mount.
- **Testing Library** (`/testing-library/testing-library-docs`): `waitFor`
  and `findBy*` retry semantics; confirmed `findByRole`/`findByTestId`
  accept `{ timeout }` and that assertions inside `waitFor` must throw to
  trigger a retry.

Context7 was used only as supporting evidence for library behavior; no
library was introduced. The implementation reuses the repository's existing
`api` wrapper, `trackExamEvent` helper, and component primitives.

## Commands executed

```bash
pnpm exec vitest run --no-coverage src/pages/exam/TakeExamPage.restore.test.tsx
pnpm --filter @exam/web test
pnpm --filter @exam/web typecheck
pnpm --filter @exam/web lint:eslint
pnpm typecheck
pnpm lint
pnpm lint:copy
pnpm lint:arch
pnpm verify:static
```

## Test results

```text
apps/web/src/pages/exam/TakeExamPage.restore.test.tsx
  12 passed

apps/web full suite
  1246 passed (12 new + 1234 existing — no regressions)
```

## Static verification results

```text
pnpm verify:static — PASS
  format:check        PASS
  lint                PASS
  lint:copy           PASS
  lint:arch           PASS
  lint:db-config      PASS
  lint:env-contract   PASS
  lint:repo-contract  PASS
  lint:ui-gates       PASS
  lint:eslint         PASS
  typecheck           PASS (17 tasks)
  api:openapi:check   PASS (openapi.json up to date)
```

## Environment limitations

None for the static gate. Integration / E2E (`pnpm test:integration`,
`pnpm test:e2e`, `pnpm e2e:docker`) and `pnpm verify` (which includes
DB-backed coverage) were NOT executed in this run because the prompt
explicitly scopes REC-I3 to focused Web tests + the static gate. They must
be re-run by human review on a runner with Docker/PostgreSQL available
before merge.

## Explicit non-goals (REC-I4 deferred)

The following are deliberately NOT implemented by REC-I3 (ADR-012 §In scope
/ §Out of scope):

```text
REC-I4 time-compensation policy changes
removal of the current full disconnected-time compensation
changes to restoreAttempt engine semantics
IndexedDB / DurableAnswerDraft / SaveOperationOutbox
operationId / strict future-baseVersion validation
answer replay / multi-tab locking / device leases
desktop client behavior / new telemetry architecture
operator incident pages / new database migrations / new REST endpoints
offline answer acceptance policy / ZKP / WebAuthn / TPM / TEE / attestation
```

## Remaining risks

- **REC-I4 still pending.** The current backend may grant full
  disconnected-time compensation on restore. REC-I3 surfaces neutral copy and
  does not address this; REC-I4 owns the policy change.
- **Manual reasoning walkthroughs (§23).** Each of the 10 manual scenarios
  was traced against the implementation and is covered by a component test.
  Final human review should additionally run the E2E happy path
  (`candidate-happy-path`, `resume-attempt`, `submit-flush`) on a runner with
  Docker/PostgreSQL before merge.
- **Strict Mode under React 19 + Suspense.** The boolean cleanup flag is the
  proven guard; if a future React feature causes effects to re-run without
  unmounting, the in-flight ref still prevents concurrent duplicates, but
  human E2E review is advisable.

## Next authorized Job

REC-I4 (Interruption and time-compensation policy) is technically
independent of REC-I3 and may proceed in parallel per ADR-012 §Deferred Work
§Job order rationale.
