# S7 — Current Candidate Runtime Audit

> **Date:** 2026-06-29
> **Branch:** `phase3/role-check-audit`
> **Purpose:** Map every state variable on the candidate exam-runtime pages, their implicit relationships, the conflicting combinations, what E2E actually asserts, and the open questions this raises for the Large frontend-state-machine grillme. Pure documentation — no state machine introduced, no page refactored, no UI behavior changed.

---

## TL;DR

- The exam runtime is **three pages**, but only **`TakeExamPage`** has real runtime state. It holds **15 `useState` hooks + 8 `useRef`s** (plus 2 derived locals — `currentQuestion`, `currentAnswer`) with **no reducer, no state machine, no single source of truth** — every transition is an ad-hoc `setState` scattered across 6 callbacks and 5 effects.
- State is split across **two parallel layers** that must stay consistent by convention:
  1. **Page-level React state** (`attempt`, `answers`, `saveState`, `isSubmitting`, `deadlinePassed`, `isDisconnected`, …)
  2. **`useSubmitFlush` hook internal refs** (`pendingRef`, `inflightRef`, `statusRef`, `generationRef`) — the real save lifecycle, kept in refs and surfaced only via a `forceTick` re-render hack.
- **Three independent "deadline" clocks** can disagree: the page's `deadlinePassed` flag, the `ExamTimer` countdown's own `onTimeout`, and the server's deadline scanner. The page tries to converge them but the convergence is manual.
- **E2E coverage is server-outcome-biased.** `disconnect-restore` and `deadline-crash` assert server-side transitions (`disrupted → restored`, `autoSubmit`), **not the client UI states** (`deadline-overlay`, `save-rejection-alert`, `isDisconnected` banner). The client state machine has almost no E2E guard.

---

## 1. Pages in Scope

| Page | File | State complexity | Role |
|------|------|------------------|------|
| `StartExamPage` | `apps/web/src/pages/exam/StartExamPage.tsx` | low (4 states) | entry: start / resume / view result |
| `TakeExamPage` | `apps/web/src/pages/exam/TakeExamPage.tsx` | **high (15 states + 8 refs + 2 derived)** | the actual exam runtime |
| `ResultPage` | `apps/web/src/pages/exam/ResultPage.tsx` | low (2 states) | post-submit read-only result |

`ExamListPage` and `ExamSettingsPage` are list/config pages, not runtime — out of scope.

Supporting:
- `useSubmitFlush` (`apps/web/src/hooks/useSubmitFlush.ts`) — debounced per-question save queue + flush; the **second** state layer.
- `ExamTimer` (`apps/web/src/components/exam/ExamTimer.tsx`) — owns its own countdown + `onTimeout`.
- `SaveIndicator` (`SaveState = "idle" | "saving" | "saved" | "error"`).

---

## 2. State Variable Inventory

### 2.1 `StartExamPage` (4 states)

| Variable | Type | Init | Purpose |
|----------|------|------|---------|
| `exam` | `CandidateExamDetailResponse \| null` | `null` | exam detail + `primaryAction` (`start`/`resume`/`view_result`/`none`) |
| `isLoading` | `boolean` | `true` | initial fetch |
| `isStarting` | `boolean` | `false` | attempt-creation in-flight |
| `error` | `string \| null` | `null` | fetch / start error |

Entry decision is **derived from server `primaryAction`**, not local state. The only local runtime flag is `isStarting`.

### 2.2 `TakeExamPage` — React state (15)

| # | Variable | Type | Init | Drives |
|---|----------|------|------|-------|
| 1 | `attempt` | `AttemptData \| null` | `null` | whole attempt snapshot, deadline, status |
| 2 | `isLoading` | `boolean` | `true` | loading screen |
| 3 | `loadError` | `string \| null` | `null` | error screen |
| 4 | `isDisconnected` | `boolean` | `false` | disconnect banner; also gates save-rejection alert |
| 5 | `saveRejection` | `SaveRejection \| null` | `null` | server-rejected-save alert (DEADLINE_EXCEEDED / ATTEMPT_ALREADY_SUBMITTED / ATTEMPT_CLOSED) |
| 6 | `currentIndex` | `number` | `0` | active question |
| 7 | `questionStates` | `QuestionState[]` (`unanswered`/`answered`/`flagged`) | `[]` | navigator + progress counts |
| 8 | `answers` | `Map<questionId, unknown>` | `new Map()` | local answer mirror |
| 9 | `saveState` | `SaveState` (`idle`/`saving`/`saved`/`error`) | `"idle"` | `SaveIndicator` |
| 10 | `showSubmitDialog` | `boolean` | `false` | submit confirmation dialog |
| 11 | `isSubmitting` | `boolean` | `false` | submit in-flight |
| 12 | `isFlushing` | `boolean` | `false` | pre-submit save flush in-flight |
| 13 | `flushResult` | `FlushResult \| null` | `null` | flush summary (`pendingCount`, `failedQuestionIds`, `timedOut`) |
| 14 | `deadlinePassed` | `boolean` | `false` | page's deadline flag → overlay + hides controls |
| 15 | `autoSubmitFailed` | `boolean` | `false` | deadline auto-submit failed → retry button |

**Count: 15 `useState`** (lines 96–112 of `TakeExamPage.tsx`). §2.3 lists the 8 `useRef`s separately.

#### 2.2.1 Derived locals (not state, but load-bearing)

Two plain `const`s derived each render (lines 214–218) are used by effects and JSX as if they were state. They are not listed above but are referenced throughout §3:

```ts
const currentQuestion = attempt?.questionSnapshot[currentIndex];
const currentAnswer = currentQuestion
  ? answers.get(currentQuestion.originalQuestionId)
  : undefined;
```

`currentQuestion` drives the `question_viewed` effect and the question section; `currentAnswer` is passed to `QuestionRenderer`. Both are `undefined` when `attempt` is null — the early-return guards (`isLoading`, `loadError || !attempt || !currentQuestion`) exist precisely because these derived values can be absent.

### 2.3 `TakeExamPage` — refs (8)

| Ref | Type | Purpose |
|-----|------|---------|
| `versionsRef` | `Map<questionId, number>` | last accepted server version per question |
| `clientSeqsRef` | `Map<questionId, number>` | monotonic client seq for idempotency |
| `submittingRef` | `boolean` | re-entrancy guard for `handleSubmit` |
| `deadlineHandledRef` | `boolean` | one-shot guard so deadline fires once |
| `serverOffsetRef` | `number` | server-clock skew (`serverNow - Date.now()`) |
| `heartbeatFailureRef` | `number` | consecutive heartbeat failures (telemetry) |
| `heartbeatFailureReportedRef` | `boolean` | one-shot telemetry guard |
| `unloadedAttemptRef` | `string \| undefined` | unmount-telemetry attempt capture |

### 2.4 `useSubmitFlush` — the hidden second layer (refs + 2 states)

The hook holds the **real per-question save lifecycle** in refs, not state:

| Ref | Type | Purpose |
|-----|------|---------|
| `pendingRef` | `Map<questionId, {timer, save, generation}>` | debounced (1500ms) pending saves |
| `inflightRef` | `Map<questionId, Promise>` | saves currently in-flight |
| `statusRef` | `Map<questionId, SaveStatus>` | `idle`/`pending`/`inflight`/`saved`/`failed` |
| `generationRef` | `Map<questionId, number>` | cancels stale saves on new edit |
| `mountedRef` | `boolean` | guards post-unmount writes |

States: `failedQuestionIds` (derived list) + a `forceTick` counter whose only job is to **force re-render** because the meaningful state lives in refs. This ref-state split is the single biggest source of implicit coupling.

---

## 3. Implicit Relationships Between States

These invariants are **enforced by convention across multiple call sites**, not by a reducer. Each is a candidate bug surface.

### 3.1 The answer-mirror invariant
`answers` (state) must mirror what the server last accepted. It is updated in **four places**:
- optimistic: `saveAnswer` line 243 (`setAnswers(prev.set(...))`)
- server-accepted: line 277 (version bump only, answer value unchanged)
- stale-reconcile: line 297 (server overwrites local answer with `details.serverAnswer`)
- on load: line 168 (rebuilt from `data.answers`)

`questionStates` (answered/unanswered/flagged) is a **parallel mirror** of the same truth, kept in sync manually (lines 172–176, 244–251, 417–428). Flagged-vs-answered can drift from `answers` if any path forgets to update both.

### 3.2 The two-layer save-status coupling
- Page shows `saveState` (`idle`/`saving`/`saved`/`error`) — coarse, single global indicator.
- Hook tracks per-question `SaveStatus` (`idle`/`pending`/`inflight`/`saved`/`failed`) — fine, in refs.
- `saveAnswer` sets `saveState="saving"` optimistically, then the hook callback sets `saved`/`error` on settle. There is **no single owner**; the page's `saveState` and the hook's per-question status can disagree (e.g. question A `saved`, question B `failed` → page shows whichever settled last).

### 3.3 The deadline trio (three clocks)
1. **`deadlinePassed`** — page state, set by the deadline `useEffect` (line 528) polling `nowByServerClock() >= deadlineAt` every 1s.
2. **`ExamTimer.onTimeout`** — the timer component's *own* 1s countdown calling `handleTimeout` (→ flush + submit). Independent of `deadlinePassed`.
3. **Server deadline scanner** — `deadlineScanner` plugin auto-submits server-side regardless of client.

Both client clocks derive `now` from `serverOffsetRef`, but they are separate `setInterval`s. `deadlineHandledRef` tries to make the page's deadline one-shot, and `submittingRef` tries to make submit one-shot — but the two client paths (`deadlinePassed` effect vs `ExamTimer.onTimeout`) are **not mutually exclusive by construction**; they rely on both guards firing.

### 3.4 The disconnect/reconnect coupling
`isDisconnected` is set `true` by:
- save network failure (`saveAnswer` catch, line 332)
- heartbeat failure (`handleHeartbeat` catch, line 466)

and set `false` by:
- save success / stale-reconcile (lines 279, 303)
- heartbeat success (line 454)
- load (line 177)

So **any successful save clears the disconnect banner even if heartbeats are still failing**, and vice versa. The banner reflects "last network result", not "current connectivity".

### 3.5 `saveRejection` vs `isDisconnected` vs `deadlinePassed`
The save-rejection alert only renders when `saveRejection && !isDisconnected` (line 684). The disconnect alert only renders when `isDisconnected && !deadlinePassed` (line 703). The deadline overlay renders when `deadlinePassed` (line 722). These three are **mutually-exclusive-by-render-condition**, but the underlying booleans are not mutually exclusive by setter — a transient state where two are true is possible until the next render.

### 3.6 Submit re-entrancy: `isSubmitting` (state) + `submittingRef` (ref)
Both exist because React state updates are async: `submittingRef` is the real guard (line 350), `isSubmitting` drives the button label/disabled. They are set together (line 351–352) and cleared together (line 359–360) — but only on the **error** path. On success the page navigates away, so the ref is never cleared (fine, unmount).

---

## 4. Conflicting / Fragile State Combinations

Ranked by likelihood of surfacing as a bug.

### C1 — Deadline fires while a save is in-flight (HIGH)
`deadlinePassed` effect calls `flush()` then `handleSubmit()`. `flush()` waits up to `FLUSH_TIMEOUT_MS = 10_000ms`. If the network is slow, the deadline overlay shows ("auto-submitting") for up to 10s with no cancel. If flush times out, `handleSubmit` runs anyway on partial saves. Combined with `isDisconnected=true` (slow net), the user sees the disconnect banner AND the deadline overlay simultaneously until the next render reconciles.

### C2 — `ExamTimer.onTimeout` and the deadline effect both fire (MEDIUM)
Two independent 1s intervals both watch the same deadline. On a slow frame they can both pass the threshold in the same tick. `deadlineHandledRef` guards the page path; `submittingRef` guards submit. But both call `flush()` then `handleSubmit()` — `flush()` is idempotent-ish, but two `flush()` calls race on the same `inflightRef` map. `handleSubmit` is protected by `submittingRef`, so the second is a no-op. **Currently safe by guard, fragile by design.**

### C3 — `saveState` global vs per-question hook status (MEDIUM)
Rapid edits to question A then B: A settles `saved`, B settles `error`. Page `saveState` ends as `error` (last write wins), but the indicator is global — user can't tell *which* question failed. The navigator dots (`questionStates`) don't reflect save failure at all, only answered/unanswered/flagged.

### C4 — `isDisconnected` cleared by unrelated success (MEDIUM)
Heartbeat failing, but a queued save succeeds → `isDisconnected=false` → disconnect banner disappears while heartbeats are still failing. Next heartbeat failure re-sets it. Banner **flickers**.

### C5 — `autoSubmitFailed` + `deadlinePassed` retry vs `submittingRef` (LOW)
The retry button (`retry-submit-btn`, line 743) calls `handleSubmit()` directly. `submittingRef` may still be `true` from the failed attempt if the failure path didn't clear it — but the failure path *does* clear it (line 359). Safe today; fragile if the clear is ever moved.

### C6 — `requiresSubmitOverride` submit-anyway path (LOW)
`requiresSubmitOverride = failedSaveCount > 0 || flushTimedOut` (line 609). When true, the normal confirm button is disabled and a destructive "submit anyway" appears (line 934). If `flushResult` is stale (a later flush succeeded but `flushResult` wasn't reset), the override button can persist. `runSubmitFlush` resets `flushResult` to null first (line 374), mitigating this.

---

## 5. Button Disabled Logic

| Button | Disabled when | Source |
|--------|---------------|--------|
| Start (`exam-start-btn`) | `isStarting` OR (no active attempt AND `primaryAction ∉ {start,resume}`) | `StartExamPage.tsx:267` |
| Submit (header) | hidden when `deadlinePassed` (no explicit disabled) | `TakeExamPage.tsx:637` |
| Previous | `currentIndex === 0` | `:816` |
| Confirm submit (`confirm-submit-btn`) | `isSubmitting \|\| isFlushing \|\| requiresSubmitOverride` | `:927` |
| Submit anyway (destructive) | `isSubmitting \|\| isFlushing` (shown only when `requiresSubmitOverride`) | `:938` |
| Continue answering (cancel) | `isFlushing` | `:912` |
| Retry flush | shown only when `flushTimedOut`; disabled `isSubmitting \|\| isFlushing` | `:920` |
| Retry submit (deadline overlay) | never disabled (relies on `submittingRef` guard inside) | `:743` |
| Flag / Unflag | hidden when `deadlinePassed` | `:767` |
| QuestionRenderer input | `deadlinePassed` | `:792` |

Notable: the **deadline overlay's retry button has no `disabled` prop** — it relies entirely on the imperative `submittingRef` guard inside `handleSubmit`. This is the only action button without a visual disabled state.

---

## 6. Reconnect / Restore Behavior

There is **no explicit "reconnect" state machine**. Reconnection is emergent:

- **Network reconnect** is not detected as an event; it's implied by the next successful save or heartbeat clearing `isDisconnected`.
- **Server-side disrupted → restore** is handled **server-side** (`restoreAttempt`); the client just reloads via `loadAttempt` on page mount or resume navigation. The client has no `disrupted` state of its own — if the server says `status !== "in_progress"` on load, the client **navigates away to result** (line 139–142). So a disrupted attempt, on reload, either restores (server flips to in_progress) or the candidate is bounced to result.
- **Answer restore on reload** rebuilds `answers`, `versionsRef`, `clientSeqsRef` from `data.answers` (lines 157–170). `clientSeq` is seeded to the current version so the next save isn't treated as an idempotent replay.
- **Server-clock skew** (`serverOffsetRef`) is re-synced on every load and every heartbeat response.

> The client has **no concept of "I was disrupted, now I'm back"**. It only knows "load succeeded" or "load failed". The disrupted/recovered distinction lives entirely in the server + audit log, surfaced to proctors, not to the candidate UI.

---

## 7. E2E Coverage of Runtime State

**Headline: E2E asserts server outcomes, not client UI *states*.** This is the most important gap for a future state machine — there is no regression net for the client *transitions* (disabled-gating, overlay rendering, banner appearance).

A key distinction: many specs **exercise** runtime controls as plumbing (the `submitExam()` helper clicks `take-submit-btn` → `confirm-submit-btn` in 9+ specs; `waitForSaveSaved()` waits for the "已保存" indicator in 9 specs) but **assert only the graded outcome**. Exercising a control is not the same as asserting its state. So the controls are not dead — they're just not guarded against regressions in their conditional rendering / disabled logic.

| Spec | What it asserts | Client UI state asserted? |
|------|-----------------|---------------------------|
| `candidate-happy-path` | start → answer → save → submit → graded; asserts `已通过` + score 100 | save indicator *waited on* (`waitForSaveSaved`), submit flow *exercised*; no state assertions |
| `submit-flush` | pending save flushed before submit; score correct | no — only final score |
| `save-submit-race` | server invariants under concurrent save+submit; idempotent double-submit | **explicitly NOT asserting** client score (comment lines 29–34) |
| `resume-attempt` | answer → reload → resume → submit → graded | no UI state, only outcome |
| `refresh-during-exam` | reload persists latest answer; flip+reload | no UI state |
| `disconnect-restore` | server `disrupted → restored`, deadline forward-adjusted, answers preserved | **no** — pure API + outcome |
| `deadline-crash` | server auto-submit + grade after browser "crash" | **no** — `ResultPage` graded result only |
| `proctor-runtime` | admin force-submit / extend-time via API | no candidate UI |
| `result-publishing` | result visibility per publish mode | no runtime UI |

**Client UI states with zero E2E *assertion* (controls may be exercised as plumbing, but no spec verifies the conditional state itself):**
- `deadline-overlay` rendering / "auto-submitting" vs "retry" states
- `save-rejection-alert` (DEADLINE_EXCEEDED / ATTEMPT_ALREADY_SUBMITTED / ATTEMPT_CLOSED)
- `isDisconnected` banner appearance/flicker
- `requiresSubmitOverride` destructive "submit anyway" path
- `autoSubmitFailed` retry button
- `flushTimedOut` retry-flush button

Component/unit tests (`TakeExamPage.test.tsx`, `TakeExamPage.telemetry.test.tsx`) cover some of these at the component level, but E2E does not exercise them through the browser. A state-machine refactor would need new E2E or component tests as its safety net.

---

## 8. Large State-Machine Grillme — Input Questions

These are the questions the frontend state machine (Large job, deferred) must answer. They are surfaced here, not answered.

### Q1 — Single source of truth
Should `answers` + `questionStates` + `versionsRef` collapse into one reducer-owned structure? Today three structures mirror the same truth across state and refs. What's the migration boundary?

### Q2 — Two save-status layers
Page `saveState` (global) vs hook per-question `SaveStatus` (refs). Does the state machine own per-question status and derive the global indicator? Does `useSubmitFlush` become a reducer side-effect rather than a parallel state owner?

### Q3 — Deadline authority
Three clocks (`deadlinePassed`, `ExamTimer.onTimeout`, server scanner). Which is authoritative for the **client** UI? Should `ExamTimer` become a pure view of a page-level deadline state, firing no independent submit? How does the client represent "server already auto-submitted me" vs "I'm auto-submitting"?

### Q4 — Disconnect / reconnect semantics
Should `isDisconnected` be a derived selector ("no successful network in N ms") rather than a flag toggled by 6 call sites? What does "reconnected" mean — next success, or a dedicated probe? Should the banner reflect heartbeat health, save health, or a union?

### Q5 — Submit lifecycle states
`showSubmitDialog` + `isSubmitting` + `isFlushing` + `flushResult` + `requiresSubmitOverride` + `autoSubmitFailed` encode ~6 submit sub-states as booleans. Should this become one `submitPhase` enum (`idle`/`dialog-open`/`flushing`/`submitting`/`done`/`failed`)? What are the legal transitions? Can you cancel a flush mid-flight?

### Q6 — Re-entrancy guards as state
`submittingRef` + `deadlineHandledRef` + `heartbeatFailureReportedRef` are one-shot guards living in refs because state is async. Does the state machine make these first-class transitions (so they're testable and resettable) instead of imperative refs?

### Q7 — Restore / disrupted on the client
The client has no `disrupted` notion. Should it? If the server returns `disrupted` on load, what does the candidate see — a restore spinner, a banner, silent restore? Today it either restores transparently or bounces to result.

### Q8 — Testing the machine
Given E2E covers outcomes not UI states (§7), what's the regression strategy for a state machine? Component tests on every transition? A state-chart library with model-based tests? New E2E for the overlay/rejection/disconnect paths?

---

## 9. File Inventory

### Runtime pages

| File | Role |
|------|------|
| `apps/web/src/pages/exam/StartExamPage.tsx` | entry: start / resume / view result |
| `apps/web/src/pages/exam/TakeExamPage.tsx` | exam runtime (15 states + 8 refs + 2 derived) |
| `apps/web/src/pages/exam/ResultPage.tsx` | post-submit result view |

### Supporting state owners

| File | Role |
|------|------|
| `apps/web/src/hooks/useSubmitFlush.ts` | debounced save queue + flush (second state layer) |
| `apps/web/src/components/exam/ExamTimer.tsx` | own countdown + `onTimeout` (third deadline clock) |
| `apps/web/src/components/exam/SaveIndicator.tsx` | `SaveState` view |
| `apps/web/src/components/exam/QuestionNavigator.tsx` | answered/unanswered/flagged dots |
| `apps/web/src/lib/examTelemetry.ts` | emits the runtime telemetry events (see S6) |

### Tests

| File | Covers |
|------|--------|
| `apps/web/src/pages/exam/TakeExamPage.test.tsx` | component-level runtime behavior |
| `apps/web/src/pages/exam/TakeExamPage.telemetry.test.tsx` | telemetry emission |
| `apps/web/src/pages/exam/StartExamPage.test.tsx` | entry decisions |
| `apps/web/src/pages/exam/ResultPage.test.tsx` | result rendering |
| `apps/e2e/e2e/candidate-happy-path.spec.ts` | full submit flow |
| `apps/e2e/e2e/submit-flush.spec.ts` | flush-before-submit |
| `apps/e2e/e2e/save-submit-race.spec.ts` | server-side race invariants |
| `apps/e2e/e2e/resume-attempt.spec.ts` | reload resume |
| `apps/e2e/e2e/refresh-during-exam.spec.ts` | reload persistence |
| `apps/e2e/e2e/disconnect-restore.spec.ts` | **server** disrupted→restore |
| `apps/e2e/e2e/deadline-crash.spec.ts` | **server** auto-submit |

---

## 10. Risk Summary

- **R1 — No single state owner.** 15 states + 8 refs + 2 derived locals + a hook with its own refs. Every transition is an ad-hoc `setState`; consistency is by convention. Highest refactor risk.
- **R2 — Three deadline clocks** can race; safe today only because of imperative refs (`deadlineHandledRef`, `submittingRef`).
- **R3 — `isDisconnected` flickers** because any success clears it regardless of which channel failed.
- **R4 — Global `saveState` hides per-question failure**; navigator doesn't reflect save health.
- **R5 — E2E blind spot:** client UI states (overlay, rejection alert, disconnect banner, submit-anyway) have no end-to-end guard. A state-machine refactor must add this net first.

---

## 11. Documentation References

| Doc | Content |
|-----|---------|
| `docs/phase3/job-cards.md` §S7 | This job card |
| `docs/phase3/audit/audit-current-events.md` §3.1 | The telemetry events these runtime states emit (`exam_telemetry`) |
| `docs/SPEC.md` §3.5 | Answer Save Protocol (versioned, idempotent) — the contract this runtime implements |
| `docs/phase3/plan.md` | Flags the frontend state machine as a deferred Large job |
