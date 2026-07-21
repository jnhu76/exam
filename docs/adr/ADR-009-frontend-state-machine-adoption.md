# ADR-009 — Frontend State Machine Adoption Strategy

## Status

**Proposed.** Pending human audit before acceptance.

## Context

The exam platform frontend currently manages all state through manual
`useState` / `useEffect` / `useRef` orchestration with no formal state machine
modeling. The frontend audit (`docs/archive/phase3/frontend-state-machine-audit.md`)
identified ~116 independent state variables across 14 key files, five implicit
state machines without explicit modeling, hardcoded Admin/Candidate binary role
assumptions, and zero `AbortController` usage for request cancellation.

### Current state management landscape

**Candidate Exam Flow** (`apps/web/src/pages/exam/TakeExamPage.tsx`, 950 lines)
is the highest-risk implicit state machine. It simultaneously manages:
loading, loadError, isDisconnected, saveRejection, saveState, showSubmitDialog,
isSubmitting, isFlushing, flushResult, deadlinePassed, autoSubmitFailed via 12
`useState` calls, plus 7 `useRef` slots for versions, clientSeqs, submit mutex,
deadline guard, server clock offset, and heartbeat failure counters. Heartbeat
polling (30s interval), deadline countdown (1s interval), answer debounced save
(via `useSubmitFlush`), and flush-before-submit all operate as independent async
chains with no coordination layer.

The `useSubmitFlush` hook (`apps/web/src/hooks/useSubmitFlush.ts`, 207 lines)
is the closest thing to a well-engineered state module. It uses generation-based
cancellation, debounced saves per question, a formal `SaveStatus` enum
(`idle | pending | inflight | saved | failed`), and a `flush()` method for
draining pending saves before submit. This proves the pattern works and is
the natural foundation for explicit state machine adoption.

**Admin Exam Management** (`apps/web/src/pages/admin/ExamDetailPage.tsx`, 864
lines) uses 9 independent boolean mutation flags: `publishing`, `closing`,
`archiving`, `canceling`, `unpublishing`, `releasing`, `extending`, plus
`addDialogOpen` and `addingEnrollment`. Each handler guards itself with
`if (!id || publishing) return`, but there is no shared "exam is transitioning"
state. Two different mutations (e.g., publish + close) can fire simultaneously
if triggered rapidly. Operation success calls `loadExam()` to refetch, which is
correct but means the UI briefly shows stale data between mutation response and
refetch completion.

**Proctor Dashboard** (`apps/web/src/pages/admin/ProctorDashboardPage.tsx`, 551
lines) polls every 5 seconds via `setInterval(loadStatus, 5000)`. The `setData`
call on success overwrites state without checking for in-flight mutations. A
force-submit response can be immediately overwritten by the next poll cycle.
`forceSubmitting` is a single boolean shared across all candidates — two
concurrent force-submit requests on different candidates would serialize through
the same guard.

**Exam Monitoring** (`apps/web/src/pages/admin/ExamMonitoringPage.tsx`, 440
lines) polls every 15 seconds with a `staleWarning` banner on failure (better
than ProctorDashboard's pattern). However, the timeline dialog for a selected
attempt is not auto-refreshed when the underlying attempt data changes via
polling.

**Grading Detail** (`apps/web/src/pages/admin/GradingDetailPage.tsx`, 284
lines) tracks per-question save state via `saving{}` keyed by questionId, with
`scores{}`, `comments{}`, and `validationErrors{}` as separate state maps.
There is no dirty-tracking — a grader can navigate away with unsaved changes.
The `gradingStatus` is updated from the API response but not reactively
propagated to the queue list.

**Auth / Route / Sidebar** — The authentication context
(`apps/web/src/contexts/AuthContext.tsx:37`) routes by `user.role === "Candidate"`
vs everything-else. `AdminLayout` (`apps/web/src/components/layout/AdminLayout.tsx:39`) currently
blocks Candidate users but allows all non-Candidate users into the admin shell.
This works for the old Admin/Candidate binary model but is too broad once
Teacher, Proctor, and Grader are introduced. `ExamLayout`
(`apps/web/src/components/layout/ExamLayout.tsx:45`) redirects non-Candidate
users to login. `AppSidebar` (`apps/web/src/components/layout/AppSidebar.tsx:190`)
shows management items only when `user.role === Role.Admin`. The `Role` enum
(`packages/domain/src/enums.ts:11-16`) defines only `{Admin, Candidate, System}`.
The `packages/contracts/src/` RoleSchema restricts login-capable roles to
`Admin | Candidate`. Adding Teacher, Proctor, or Grader will break every
one of these checks — a Teacher lands on the Admin dashboard with the full
management sidebar, a Proctor sees no proctor-specific navigation, and a
Grader sees no grading-specific navigation beyond the single sidebar link.

### Problem statement

The core problem is not "too many useState calls" — it is that **complex
interaction flows are modeled as independent boolean flags with no formal
transition rules, no guard functions, and no testable contract**. This leads to:

1. Race conditions between save, submit, heartbeat, and deadline.
2. Duplicate-click vulnerability on mutation buttons.
3. Stale data overwriting mutation results in polling pages.
4. Impossible-to-test state combinations (e.g., "what happens if deadline
   fires while flush is in progress and heartbeat just failed?").
5. Role-gating that cannot accommodate more than two roles without
   rewriting every conditional branch.

## Decision

### 4.1 Adopt explicit frontend state machines gradually

The project will adopt explicit state machine modeling for frontend
interaction flows, applied incrementally to the highest-risk areas first.
This is not a full-rewrite initiative — it targets specific domains where
informal state management creates real correctness or safety risks.

### 4.2 Do not introduce XState in Phase A

XState will not be introduced in Phase A or Phase B. The project's state
machines are local to individual pages and do not require cross-machine
communication, visual editing, or formal verification. XState introduces
additional runtime dependency, bundle cost, and team learning cost that
are not justified at this stage.

### 4.3 Use reducer + transition table + tests first

Phase A through Phase C will use:

- **TypeScript union types** for state and event enums.
- **Pure transition functions**: `transition(state, event) => state`.
- **Guard functions**: `canTransition(state, event) => boolean`.
- **Unit tests** for every valid and invalid transition.
- **No runtime library** — just TypeScript types and plain functions.

This approach has zero dependencies, is fully testable, matches the
project's existing patterns, and can be adopted file-by-file without
migration risk.

### 4.4 Candidate Exam Flow is the first machine

The `CandidateExamMachine` targets `TakeExamPage.tsx` and its coordinate
modules (`useSubmitFlush.ts`, `ExamTimer.tsx`, `SaveIndicator.tsx`).

**Why first:**
- The exam-taking flow is the product's core critical path.
- `TakeExamPage.tsx` has the highest state complexity (19 state slots).
- Save, submit, heartbeat, deadline, and disconnect interact in ways that
  can corrupt exam data or allow editing after deadline.
- Errors in this flow directly impact exam fairness and data reliability.
- The backend already enforces attempt status transitions
  (`packages/domain/src/enums.ts:81-91` AttemptStatus), but the frontend
  has no equivalent formal model for its own interaction state.

### 4.5 Admin Exam Operation is the second machine

The `AdminExamOperationMachine` targets `ExamDetailPage.tsx`.

**Why second:**
- 9 independent mutation boolean flags create a real duplicate-click and
  race condition surface.
- publish / close / extend / archive / cancel / unpublish / release-results
  are mutually exclusive operations that should share a single operation
  state.
- This is simpler than the Candidate Exam Flow (no heartbeat, no deadline,
  no save protocol) — a good second iteration to validate the pattern.

### 4.6 Proctor and Grading machines are deferred

Proctor and Grading state machines are deferred to Phase D, after RBAC
enforcement and API stability are confirmed.

**Why deferred:**
- Proctor pages (`ProctorDashboardPage.tsx`, `ExamMonitoringPage.tsx`)
  depend on role-based access that is not yet enforced (currently any
  Admin can access proctor pages).
- Grading (`GradingDetailPage.tsx`) depends on Grader role assignment
  semantics that are still in migration.
- Building state machines on unstable permission boundaries risks
  building the wrong abstraction.
- The existing polling patterns in these pages, while imperfect, are
  functional and lower risk than the exam-taking flow.

### 4.7 Backend status remains source of truth

The backend exam status, attempt status, grading status, and role
assignments are the authoritative business state. The frontend state
machine:

- **Does not** invent or override business states.
- **Does** manage frontend interaction lifecycle (loading, saving,
  flushing, submitting, polling, disconnect).
- **Does** suppress illegal UI operations (e.g., editing after submit,
  double-clicking publish).
- **Does** provide clear error recovery paths.
- **Does not** replace backend permission enforcement.

After every successful mutation, the frontend must refetch or accept the
backend's authoritative response. Optimistic business-state transitions
(e.g., showing "published" before the backend confirms) are explicitly
out of scope.

## State Layering Model

Three distinct layers of state exist in the frontend. Confusing them is
the root cause of the current complexity.

| State Type | Source of Truth | Examples | Managed By | State Machine? |
| ---------- | --------------- | -------- | ---------- | -------------- |
| **Backend Business State** | Backend API / database | `exam.status`, `attempt.status`, `gradingStatus`, `candidate onlineState`, `role` / `permissions` | Backend authority; frontend reads and displays | No — frontend cannot modify these directly |
| **Frontend Interaction State** | Frontend state machine | `loading`, `saving`, `flushing`, `submitting`, `forceSubmitting`, `extending`, `pollingFailed`, `disconnected`, `autoSubmitFailed`, `operation` | Frontend reducer / transition table | **Yes** — this is the target layer |
| **View / Presentation State** | Local component | `modal open`, `selected tab`, `selected row`, `sidebar collapsed`, `form field touched`, `pagination page`, `search input`, `current question index`, `extendDialogOpen`, `extendMinutes` | Local `useState` | **No** — local UI state stays local |

The key rule: **Backend Business State is read-only from the frontend's
perspective. Frontend Interaction State is what the state machine manages.
View / Presentation State stays in local useState.**

## Machine Module Location and Naming Convention

State machine modules must live in a dedicated directory, not scattered
across component files or mixed into generic `lib` utilities.

**Required path pattern:**

```text
apps/web/src/lib/state-machines/<machineName>.ts
apps/web/src/lib/state-machines/<machineName>.test.ts
```

**Concrete files:**

```text
apps/web/src/lib/state-machines/candidateExamMachine.ts
apps/web/src/lib/state-machines/candidateExamMachine.test.ts

apps/web/src/lib/state-machines/adminExamOperationMachine.ts
apps/web/src/lib/state-machines/adminExamOperationMachine.test.ts
```

**Machine module contract:**

A machine file (`<machineName>.ts`) contains ONLY:

- State type definitions (union types).
- Event type definitions (discriminated unions).
- Transition function(s).
- Guard function(s).
- Optional command type definitions (see Commands / Effects Model).

A machine file MUST NOT import:

- React or any React hook.
- API client (`@/lib/api`).
- Navigation (`useNavigate`, `navigate`).
- Toast / notification (`sonner`).
- Telemetry (`@/lib/examTelemetry`).
- Timer utilities (`setInterval`, `setTimeout`).
- Any UI component.

The machine file is a **pure TypeScript module**. Components and hooks
import from it; it never imports from the component/hook layer.

**Test file contract:**

Every machine test file must cover:

1. Valid transitions — every `(state, event)` pair in the transition table.
2. Invalid transitions — every `(state, event)` pair that should be a no-op.
3. Guard functions — `canX` predicates for each relevant state.
4. Edge cases — race-adjacent scenarios like "save during submit."

## Pure Transition and Side-Effect Boundary

**The transition function must be pure.**

This is the single most important engineering constraint when using
`reducer + transition table` without a library like XState. Without a
runtime enforcing purity, the team must enforce it by convention and
code review.

A transition function receives `(state, event)` and returns the next
state (or `{ state, commands }` — see Commands / Effects Model). It
MUST NOT:

- Call API endpoints (`api.get`, `api.post`, `fetch`).
- Call `navigate()` or `useNavigate()`.
- Call `toast()` or any notification function.
- Send telemetry events (`trackExamEvent`, `logger.*`).
- Read or write `localStorage` / `sessionStorage`.
- Read `Date.now()` or access the clock.
- Start `setTimeout` / `setInterval` / `clearInterval`.
- Modify `useRef` values.
- Directly manipulate the DOM.
- Throw exceptions (illegal transitions return current state).

**Why this matters:** When the transition function is pure, it becomes
trivially testable — you call it with inputs and assert on outputs with
no mocks, no setup, no teardown. Side effects (API calls, navigation,
toasts, timers) are executed by the outer hook or component effect layer
in response to state changes or returned commands. This separation is
what makes the `useReducer` approach viable without XState's built-in
side-effect model.

## Commands / Effects Model

Phase A (spec + tests) can implement the minimal form:

```ts
function transition(state: S, event: E): S
```

Phase B (runtime integration) should evolve to:

```ts
type TransitionResult<S> = {
  state: S;
  commands: MachineCommand[];
};
```

**Example command types for CandidateExamMachine:**

```ts
type MachineCommand =
  | { type: "SAVE_ANSWER"; questionId: string; answer: unknown }
  | { type: "FLUSH_PENDING_SAVES" }
  | { type: "SUBMIT_ATTEMPT" }
  | { type: "NAVIGATE_TO_RESULT"; attemptId: string }
  | { type: "REPORT_TELEMETRY"; event: string; metadata?: Record<string, unknown> }
  | { type: "SHOW_TOAST"; variant: "success" | "error"; message: string };
```

**Commands are not side effects.** They are declarative statements
about "what the outer layer should do." The hook or component that
owns the `useReducer` inspects `result.commands` after each dispatch
and executes them:

```ts
const [state, dispatch] = useReducer(reducer, initialState);

useEffect(() => {
  for (const cmd of stateAfterDispatch.commands) {
    switch (cmd.type) {
      case "NAVIGATE_TO_RESULT":
        navigate(routes.exam.result(cmd.attemptId));
        break;
      case "SHOW_TOAST":
        toast[cmd.variant](cmd.message);
        break;
      // ...
    }
  }
}, [stateAfterDispatch]);
```

This pattern keeps the machine module pure while giving the outer layer
a clear, testable contract for side effects. It also prevents the common
anti-pattern of scattering `useEffect` hooks that implicitly watch
different state variables and trigger side effects in uncoordinated ways.

If Phase B does not introduce commands for now (keeping transition => nextState), the
ADR still recommends reserving the `TransitionResult` shape so that the
runtime integration can adopt commands without changing the machine
module's core contract.

## What Should Be State-Machined

| Domain | Priority | Why | Proposed Machine |
| ------ | -------- | --- | ---------------- |
| Candidate Exam Flow | P0 | Core exam path; highest state complexity; save/submit/deadline/heartbeat/disconnect interact; data integrity risk | `CandidateExamMachine` |
| Admin Exam Operation | P1 | 9 independent mutation flags; mutually exclusive operations need single operation state | `AdminExamOperationMachine` |
| Proctor Operation | P2 | Force submit / extend / flag / polling; depends on RBAC stability | `ProctorOperationMachine` |
| Grading Save Flow | P2 | Per-question save / dirty tracking / finalize; depends on Grader role stability | `GradingMachine` |

## What Should NOT Be State-Machined

The following are local UI concerns that do not benefit from formal
state machine modeling and would only add complexity:

- **Sidebar collapse** — pure presentation toggle, no business semantics.
- **Menu open state** — transient UI interaction.
- **Table pagination** — local view concern.
- **Search input** — local view concern.
- **Form field touched / dirty** — unless tied to a business save flow
  (grading dirty-tracking is a candidate; login form validation is not).
- **Modal open state** — unless the modal controls a business mutation
  (submit confirmation modal is part of the exam machine; generic
  "are you sure?" modals are not).
- **Document title** — derived from route, no state machine needed.
- **Branding context** — loaded once, rarely changes.
- **Simple loading / error page state** — a single `isLoading` / `error`
  pair for a data-fetch-only page does not need a machine.

**Reason:** These are local, leaf-level UI states with no interaction
with other async flows. Wrapping them in a state machine adds code
volume and indirection without improving correctness.

## Candidate Exam Machine Boundary

### In scope

The `CandidateExamMachine` covers the full lifecycle of a candidate
interacting with an in-progress exam attempt:

- Initial loading and load failure.
- Transition to in-progress state.
- Answer editing (dirty detection).
- Save lifecycle: scheduled → inflight → accepted / rejected / failed.
- Connection state: connected ↔ disconnected via heartbeat.
- Submit flow: flush → confirm → submit → success / failure.
- Deadline: reached → auto-submit → success / failure.
- Post-submit: readonly / result redirect.

### Out of scope

- Current question index navigation (pure UI state).
- Question navigator panel collapse / expand.
- Tab / modal animation state.
- Backend `attempt.status` definition itself (backend authority).
- Exam list filtering / sorting (separate page, simple state).

### Proposed TypeScript shape

**Composed machine state** — the machine operates on a single state
object, not four independent reducers:

```ts
type CandidateExamMachineState = {
  /** Top-level page phase — drives which UI section is visible. */
  phase: CandidateExamPhase;
  /** Connection state — derived from heartbeat success / failure. */
  connection: ExamConnectionState;
  /** Save lifecycle — aligned with useSubmitFlush's SaveStatus. */
  save: ExamSaveState;
  /** Submit flow — governs submit button, dialog, and post-submit redirect. */
  submit: ExamSubmitState;
  /** Frontend interaction error message (not backend business state). */
  error?: string;
  /** Question IDs whose saves failed - corresponds to useSubmitFlush's failed question IDs set. */
  failedQuestionIds: string[];
};
```

**Why a single composed state:** Splitting Candidate Exam Flow into 4
independent reducers would lose the ability to coordinate cross-cutting
events. For example, `DEADLINE_REACHED` must simultaneously affect
`submit` (trigger auto-submit), `save` (block further saves), and
`connection` (stop heartbeat UI). A composed state lets one transition
function update multiple dimensions atomically. The type-level separation
(`phase`, `connection`, `save`, `submit`) provides clarity; the
runtime composition provides coordination.

**Why `error` is optional and distinct from `phase`:** `error` stores
transient frontend interaction errors (e.g., "save failed", "submit
timed out") that should display as banners or toasts. It does NOT store
backend business state (e.g., `attempt.status`). When `error` is set,
`phase` remains `in_progress` — the page is still functional, just
showing an error message. `load_error` in `phase` is a different
condition (page cannot render at all).

**Why `failedQuestionIds` is part of the state:** This承接
`useSubmitFlush`'s `failedQuestionIds` array. The submit dialog needs
to know how many questions failed to save to warn the user before
confirming submit. Keeping it in the machine state (rather than reading
it from `useSubmitFlush` at render time) ensures the submit flow has
a consistent snapshot.

**Individual dimension types:**

```ts
/**
 * Top-level phase of the candidate exam page lifecycle.
 * Drives which UI section is visible.
 */
type CandidateExamPhase =
  | "loading"
  | "load_error"
  | "in_progress"
  | "result_redirect";

/**
 * Connection state derived from heartbeat success / failure.
 * Independent of save and submit states.
 */
type ExamConnectionState =
  | "connected"
  | "disconnected";

/**
 * Per-question save lifecycle, aligned with useSubmitFlush's SaveStatus.
 * - dirty: user has edited the answer but it has not yet entered the debounce queue
 * - pending: save is queued, waiting for debounce timer or flush
 * - inflight: save request is in flight
 * - saved: backend confirmed the save was accepted
 * - failed: save failed or was rejected by the backend
 *
 * Tracked globally for the SaveIndicator; per-question detail
 * lives in useSubmitFlush internals.
 */
type ExamSaveState =
  | "idle"
  | "dirty"
  | "pending"
  | "inflight"
  | "saved"
  | "failed";

/**
 * Submit flow state.
 * Governs the submit button, confirmation dialog, and post-submit redirect.
 */
type ExamSubmitState =
  | "idle"
  | "flushing"
  | "confirming"
  | "submitting"
  | "submitted"
  | "submit_failed"
  | "auto_submitting"
  | "auto_submit_failed";
```

**Design rationale:** The current code uses flat booleans (`isDisconnected`,
`isSubmitting`, `isFlushing`, `deadlinePassed`, `autoSubmitFailed`) that
can combine in undefined ways. The proposed shape separates concerns into
four orthogonal dimensions (phase, connection, save, submit) that compose
cleanly. `CandidateExamPhase` replaces the `isLoading` / `loadError` /
`attempt` / `navigate(result)` pattern. `ExamSubmitState` replaces the
`showSubmitDialog` / `isSubmitting` / `isFlushing` / `deadlinePassed` /
`autoSubmitFailed` cluster.

The `ExamSaveState` aligns with `useSubmitFlush`'s existing `SaveStatus`
(`idle | pending | inflight | saved | failed`) by adding a `dirty` state
for the moment between user edit and debounce queue entry. This avoids
the previous design's ambiguous `saving` state that conflated "user just
typed" with "request is in flight." The per-question granularity stays
inside `useSubmitFlush`'s refs, which is the correct abstraction level
for the machine's global `ExamSaveState`.

## Candidate Exam Events

```ts
type CandidateExamEvent =
  | { type: "LOAD_STARTED" }
  | { type: "LOAD_SUCCEEDED"; attemptStatus: string }
  | { type: "LOAD_FAILED"; error: unknown }
  | { type: "ANSWER_CHANGED"; questionId: string }
  | { type: "SAVE_SCHEDULED"; questionId: string }
  | { type: "SAVE_STARTED"; questionId: string }
  | { type: "SAVE_ACCEPTED"; questionId: string }
  | { type: "SAVE_REJECTED"; questionId: string; reason: string }
  | { type: "HEARTBEAT_OK" }
  | { type: "HEARTBEAT_FAILED" }
  | { type: "SUBMIT_CLICKED" }
  | { type: "SUBMIT_CANCELLED" }
  | { type: "FLUSH_STARTED" }
  | { type: "FLUSH_SUCCEEDED" }
  | { type: "FLUSH_FAILED"; error: unknown }
  | { type: "SUBMIT_STARTED" }
  | { type: "SUBMIT_SUCCEEDED" }
  | { type: "SUBMIT_FAILED"; error: unknown }
  | { type: "DEADLINE_REACHED" }
  | { type: "AUTO_SUBMIT_STARTED" }
  | { type: "AUTO_SUBMIT_SUCCEEDED" }
  | { type: "AUTO_SUBMIT_FAILED"; error: unknown }
  | { type: "RECONNECTED" };
```

**Notes on event additions beyond the audit report:**

- `AUTO_SUBMIT_SUCCEEDED` is added because the current code navigates to
  result on success but has no explicit event for it — the machine needs
  this to transition to `result_redirect`.
- `SAVE_SCHEDULED` is added to distinguish "user edited answer" from
  "debounce timer fired and save is queued" — these are different moments
  in `useSubmitFlush`.
- All events carry minimal payload. `questionId` is included on save events
  because `useSubmitFlush` needs it for per-question tracking. No answer
  content is carried by events (content lives in the answers Map).

## Illegal Transition Policy

### Default rule

**All illegal transitions are no-ops.** The `transition()` function returns
the current state when it receives an event that is not valid in the
current state. This is the safest default — it prevents crashes and
undefined behavior.

### Dev-only warnings

In development mode (`import.meta.env.DEV`), illegal transitions log a
console warning with the current state, attempted event, and a stack
trace. This aids debugging without affecting production behavior.

### No production exceptions

Production builds never throw on illegal transitions. The machine
silently stays in the current state. The UI reflects the current state
correctly because it is derived from the machine state.

### Test coverage requirement

Every illegal transition must have a test case asserting the machine
stays in the current state. This is as important as testing valid
transitions — it documents the contract and prevents regressions.

### Illegal transition table

| Current State | Event | Expected Behavior | Reason |
| ------------- | ----- | ----------------- | ------ |
| `submitted` | `ANSWER_CHANGED` | no-op | Attempt already submitted; editing is forbidden |
| `submitting` | `ANSWER_CHANGED` | no-op | Submit in progress; answer changes could cause inconsistency |
| `flushing` | `SUBMIT_CLICKED` | no-op | Flush already in progress; prevent duplicate submit |
| `auto_submitting` | `SUBMIT_CLICKED` | no-op | Deadline auto-submit path has taken over |
| `auto_submitting` | `ANSWER_CHANGED` | no-op | Deadline overlay disables editing |
| `load_error` | `SAVE_SCHEDULED` | no-op | No attempt loaded; nothing to save |
| `load_error` | `SUBMIT_CLICKED` | no-op | No attempt loaded; nothing to submit |
| `result_redirect` | `SAVE_SCHEDULED` | no-op | Exam flow ended |
| `result_redirect` | `SUBMIT_CLICKED` | no-op | Exam flow ended |
| `loading` | `SAVE_SCHEDULED` | no-op | Attempt not yet loaded |
| `loading` | `SUBMIT_CLICKED` | no-op | Attempt not yet loaded |
| `disconnected` | `SAVE_SCHEDULED` | **allowed** | Save should still be attempted while disconnected — `useSubmitFlush` will queue it and fail gracefully; the connection banner warns the user |
| `disconnected` | `SUBMIT_CLICKED` | **allowed** | User may choose to submit despite disconnect; the flush will likely fail but the submit API call may succeed if connectivity is intermittent |

The `disconnected` → `SAVE_SCHEDULED` and `disconnected` → `SUBMIT_CLICKED`
transitions are **intentionally allowed** because the current
`TakeExamPage.tsx` already attempts saves during disconnect (they fail and
set `isDisconnected = true`). Blocking saves during disconnect would be a
behavioral regression. The machine documents this as a deliberate design
choice rather than an implicit side effect.

**Disconnected submit constraints:**

Disconnected submit is allowed only as a UX-compatible transition. It
MUST NOT bypass flush-before-submit. It MUST surface failure clearly and
MUST NOT claim the attempt is submitted until the backend confirms submit
success. Concretely:

1. The submit path still executes `flush()` → `POST /submit` regardless
   of connection state. The flush will likely fail (setting
   `submit = "submit_failed"` or `submit = "auto_submit_failed"`), but
   the attempt is made.
2. If the submit API call succeeds despite the disconnect indicator (e.g.,
   connectivity was intermittent), the machine transitions to `submitted`
   normally.
3. If the submit API call fails, the machine enters `submit_failed` with
   the error. The user sees the error banner and can retry.
4. The machine MUST NOT navigate to the result page until the backend
   confirms submit success (`SUBMIT_SUCCEEDED` event).
5. If future design requires a more conservative approach, a dedicated
   state `submit_attempting_under_disconnected` can be added to
   `ExamSubmitState` to make the disconnect-during-submit condition
   explicitly visible in the UI.

## Admin Exam Operation Machine Boundary

### Proposed shape

```ts
/**
 * Single mutually-exclusive operation state for admin exam management.
 * Only one operation can be in-flight at a time.
 */
type AdminExamOperation =
  | "idle"
  | "publishing"
  | "unpublishing"
  | "closing"
  | "extending"
  | "archiving"
  | "canceling"
  | "releasing_results"
  | "operation_failed";

type AdminExamOperationEvent =
  | { type: "PUBLISH" }
  | { type: "UNPUBLISH" }
  | { type: "CLOSE" }
  | { type: "EXTEND"; minutes: number }
  | { type: "ARCHIVE" }
  | { type: "CANCEL" }
  | { type: "RELEASE_RESULTS" }
  | { type: "OPERATION_SUCCEEDED" }
  | { type: "OPERATION_FAILED"; error: unknown }
  | { type: "RESET_ERROR" };
```

### Constraints

1. **Mutual exclusion**: Only one operation can be in-flight at a time.
   When `operation !== "idle"`, all operation buttons must be disabled.
   This replaces the 9 independent boolean flags in `ExamDetailPage.tsx`.

2. **No optimistic business transition**: On operation success, the
   machine transitions to `idle` and triggers `loadExam()` to refetch.
   The UI does not predictably change `exam.status` — it waits for the
   backend response.

3. **Error retention**: On operation failure, the machine transitions to
   `operation_failed` and retains the error message. The user sees an
   error banner and can dismiss it via `RESET_ERROR` to return to `idle`.
   The backend status is unchanged (the operation was rejected).

4. **Backend is authority**: The machine does not track exam status.
   Exam status comes from the `exam` object fetched via API. The machine
   only tracks "is an admin operation currently in progress."

### Transition rules

| Current State | Event | Next State | Side Effect |
| ------------- | ----- | ---------- | ----------- |
| `idle` | `PUBLISH` | `publishing` | `POST /exams/:id/publish` |
| `idle` | `UNPUBLISH` | `unpublishing` | `POST /exams/:id/unpublish` |
| `idle` | `CLOSE` | `closing` | `POST /exams/:id/close` |
| `idle` | `EXTEND` | `extending` | `POST /exams/:id/extend` |
| `idle` | `ARCHIVE` | `archiving` | `POST /exams/:id/archive` |
| `idle` | `CANCEL` | `canceling` | `POST /exams/:id/cancel` |
| `idle` | `RELEASE_RESULTS` | `releasing_results` | `POST /exams/:id/publish-results` |
| `publishing` | `OPERATION_SUCCEEDED` | `idle` | `loadExam()` |
| `publishing` | `OPERATION_FAILED` | `operation_failed` | display error |
| `*` (any non-idle) | any operation event | current state (no-op) | reject — operation in progress |
| `operation_failed` | `RESET_ERROR` | `idle` | clear error banner |

## Role / Route / Permission Interaction

State machines and RBAC serve different purposes and must not be conflated.

**What the state machine manages:**
- Current page interaction flow (loading → saving → submitting → done).
- Mutation pending / success / failure lifecycle.
- Prevention of duplicate clicks and concurrent mutations.
- Illegal operation suppression (e.g., editing after submit).
- Error recovery guidance.

**What RBAC / permissions manage:**
- Whether a user can access a route.
- Whether a user can see a navigation item.
- Whether a user can see a button.
- Whether a user can call an API endpoint.
- Whether the backend ultimately allows the operation.

**The state machine cannot and should not replace backend permission
enforcement.** The backend is the security boundary. The frontend state
machine is a UX safety layer.

### Permission surface matrix

| Surface | Controlled By | Source | Notes |
| ------- | ------------- | ------ | ----- |
| Route access | Permission helper / route guard | `user.roles` + `user_role_assignments` | Must not assume Admin/Candidate binary; must check against permission set |
| Sidebar visibility | Navigation permission matrix | `user.roles` + `user_role_assignments` | Not equivalent to route access; a Proctor may see proctor nav but not admin nav |
| Button visibility | Capability helper | Backend exam status + user permissions | Status alone is insufficient; a draft exam's Publish button should only appear for users with `PUBLISH_EXAM` permission |
| API permission | Backend enforcement | Session cookie + server-side RBAC | Frontend cannot substitute; 403 responses must be handled gracefully |
| Operation lifecycle | State machine | Frontend interaction state | Only manages pending/error/safety; does not determine whether the operation is allowed |

### Migration path for multi-role

The current binary checks in `AdminLayout.tsx:39` (`user.role === "Candidate"`),
`ExamLayout.tsx:45` (`user.role !== "Candidate"`), and
`AppSidebar.tsx:190` (`user.role === Role.Admin`) must be replaced with
permission-based checks before Teacher / Proctor / Grader roles are
introduced. This is a separate work stream (PR 5 in the rollout plan)
and is not blocked by or blocking the state machine adoption.

The `Role` enum in `packages/domain/src/enums.ts:11-16` must be extended
with `Teacher`, `Proctor`, and `Grader` values. The `packages/contracts/src/`
`RoleSchema` must be updated to allow these roles in login responses.
These changes are backend/contract concerns and are out of this ADR's
scope, but they are prerequisites for PR 5.

## Library Evaluation

| Option | Pros | Cons | Fit For This Project | Decision |
| ------ | ---- | ---- | -------------------- | -------- |
| **reducer + transition table** | Zero dependencies; full control; easy to test incrementally; matches existing patterns; no bundle size increase; can be adopted file-by-file | Requires team discipline; no visual tooling; transition table is manual code; no built-in time-travel debugging | **Excellent** — project has no state libraries; Phase A proves the pattern with zero risk | **Phase A-C adopted** |
| **XState** | Formal state machine modeling; visual editor; provably correct transitions; built-in guards/actions/context; time-travel debugging | Additional runtime dependency; bundle cost; steep learning curve; overkill for page-local state; migration risk for existing patterns; team must learn XState DSL and semantics | **Poor fit** — only TakeExamPage and ExamDetailPage need formal machines; the rest are simple loading/data patterns | **Phase A-C not adopted**; revisit for Phase D if Proctor/Grading become cross-page, long-lived, or require visual verification |
| **Zustand + finite-state reducer** | Lightweight (1KB); easy integration; good devtools; simple API | Not a state machine library — still requires manual transition logic; adds global state when most state is page-local; encourages centralizing state that should stay local | **Mediocre fit** — would help if exam state needed sharing between TakeExamPage and ExamTimer, but that coupling is better solved via props/callbacks | **Not adopted** |
| **TanStack Query** | Solves data fetching: automatic caching, refetching, deduplication, retry, stale-while-revalidate; would replace most manual `useState + useEffect + api.get` patterns | 13KB gzipped; fundamentally changes data-fetching architecture; requires migration of all pages; does not solve mutation state machines, role coupling, or exam flow state | **Excellent for data fetching** but does not address the core problems this ADR targets | **Not adopted here**; consider as a separate modernization initiative |

```text
Decision: Use reducer + transition table + tests for Phase A-C.
Revisit XState only if Proctor / Grading workflows become cross-page,
long-lived, or require visual verification.
TanStack Query is worth separate consideration for data-fetching
modernization but is orthogonal to state machine adoption.
```

## Consequences

### Positive

- **Reduced implicit state complexity in TakeExamPage**: 12 independent
  useState calls become coordinated state dimensions with formal
  transition rules.
- **Transition tests catch regressions**: Invalid state combinations
  (e.g., "save during submit") are tested at the machine level, not
  just as integration-test edge cases.
- **Duplicate-click prevention becomes declarative**: Instead of
  `if (publishing) return` in every handler, the machine's `idle` guard
  automatically blocks concurrent mutations.
- **Role expansion foundation**: Permission checks are separated from
  interaction state, so adding Teacher/Proctor/Grader does not require
  rewriting every state transition.
- **Zero migration risk**: No new dependencies, no runtime changes in
  PR 1/PR 2, incremental adoption in PR 3/PR 4.
- **Backend authority preserved**: The machine explicitly does not
  invent business states, maintaining clean separation of concerns.

### Negative

- **Additional code layer**: The transition table and event types add
  ~200-400 lines of TypeScript per machine. This is intentional
  documentation-as-code but is still new code to maintain.
- **Team discipline required**: Without XState's runtime enforcement,
  developers must remember to dispatch events through the machine
  rather than calling `setState` directly. Code review must enforce
  this.
- **No visual tooling**: Unlike XState's visual editor, the transition
  table is text-based. Complex machines are harder to reason about
  visually.
- **Cannot replace backend permission enforcement**: The machine
  suppresses illegal UI operations but cannot prevent a determined
  attacker from calling APIs directly. This is by design — the backend
  is the security boundary.
- **Polling stale-data issues are not fully solved**: The state machine
  manages mutation lifecycle but does not automatically add request
  cancellation or stale-response detection. Those are separate concerns
  (AbortController adoption) that should be addressed independently.

## Rollout Plan

### PR 1 — ADR Only

**Scope**: Submit this ADR document.
**Files**: `docs/adr/ADR-009-frontend-state-machine-adoption.md`
**Tests**: None required (documentation only).
**Risk**: Zero.

### PR 2 — Role / Route / Permission Matrix Document

**Scope**: Document the permission matrix for all current and planned
roles (Admin, Candidate, Teacher, Proctor, Grader). Define route access
rules, sidebar visibility rules, and button visibility rules as a
reference table. This is a design document, not runtime code.
**Files to create**:
- `docs/architecture/permission-matrix.md`
**Files modified**: None.
**Tests**: None (document only).
**Risk**: Zero. This PR has no code impact but establishes the permission
design that PR 5 will implement.

**Pull-forward note:** If Teacher / Proctor / Grader roles are enabled
in the backend (contracts, seed, login response) before
CandidateExamMachine runtime integration, this PR must be pulled forward
before PR 4. The permission matrix document is the prerequisite for
understanding which pages and buttons need role-based visibility. The
state machine is NOT a permission system and cannot compensate for
missing permission design.

### PR 3 — Candidate Exam Machine Spec

**Scope**: Add pure TypeScript state/event types, transition table,
guard functions, and unit tests. No runtime integration.
**Files to create**:
- `apps/web/src/lib/state-machines/candidateExamMachine.ts` — types + transition function
- `apps/web/src/lib/state-machines/candidateExamMachine.test.ts` — transition tests
**Files modified**: None.
**Tests**: Full transition table coverage, invalid transition tests,
guard function tests.
**Risk**: Zero runtime impact.

### PR 4 — Candidate Exam Machine Runtime Integration

**Scope**: Wire `TakeExamPage.tsx` to use the state machine from PR 3.
Replace the 12 useState calls with a single composed state via
`useReducer`. Create the `useExamAttemptMachine` hook that owns the
reducer, executes commands, and manages side effects.
**Files modified**:
- `apps/web/src/pages/exam/TakeExamPage.tsx`
- New `apps/web/src/hooks/useExamAttemptMachine.ts`
**Files NOT modified**: No backend, no contracts, no other pages.
**Tests**: Integration tests covering the full exam flow: load → answer
→ save → submit → result; load → disconnect → reconnect; load → deadline
→ auto-submit; error paths.
**Risk**: Medium — behavioral changes to the most critical page. Must
be thoroughly tested before merge.

### PR 5 — Admin Exam Operation Machine

**Scope**: Replace the 9 boolean mutation flags in `ExamDetailPage.tsx`
with the `AdminExamOperationMachine`.
**Files to create**:
- `apps/web/src/lib/state-machines/adminExamOperationMachine.ts`
- `apps/web/src/lib/state-machines/adminExamOperationMachine.test.ts`
**Files modified**:
- `apps/web/src/pages/admin/ExamDetailPage.tsx`
- New `apps/web/src/hooks/useAdminExamOperation.ts`
**Tests**: Mutual exclusion tests (only one operation at a time);
operation success/failure/retry flows; button disable behavior.
**Risk**: Low — operation lifecycle is simpler than exam flow.

### PR 6 — Navigation / Permission Runtime Implement

**Scope**: Replace binary role checks with permission-based helpers
for route access, sidebar visibility, and button visibility.
**Files modified**:
- `apps/web/src/components/layout/AdminLayout.tsx`
- `apps/web/src/components/layout/ExamLayout.tsx`
- `apps/web/src/components/layout/AppSidebar.tsx`
- `apps/web/src/contexts/AuthContext.tsx`
- New `apps/web/src/lib/permissions.ts` (permission helper functions)
**Depends on**: PR 2 (permission matrix document); backend `Role` enum
extension + `RoleSchema` update for Teacher/Proctor/Grader.
**Tests**: Route guard tests per role; sidebar visibility tests per
role; button visibility tests per role.
**Risk**: Medium — role logic touches many files but each change is
mechanical.

### PR 7 — Proctor / Grading Machines

**Scope**: State machines for Proctor operation and Grading flow.
**Depends on**: PR 6 (permission runtime); RBAC enforcement stable;
Proctor/Grader role permissions finalized; API stability confirmed.
**Files**: TBD based on PR 6 findings.
**Risk**: Low if PR 6 is solid; high if permission boundaries are
still shifting.

**Why this order:** PR 1 and PR 2 establish foundations (ADR + permission
design) with zero risk. PR 3 and PR 4 deliver the highest-value state
machine (Candidate Exam) spec-first. PR 5 validates the pattern on a
second domain (Admin Operation). PR 6 implements the permission layer
that enables multi-role pages. PR 7 is deferred until the permission
foundation is stable. If new roles arrive before PR 4, PR 2 is pulled
forward — the permission matrix must exist before runtime integration.

## Testing Strategy

### PR 1 (ADR only)

No runtime tests. Documentation lint compliance only.

### PR 2 (Permission Matrix Document)

No runtime tests. Document review only.

### PR 3 (Candidate Exam Machine Spec)

- **Transition table unit tests**: Every valid transition tested.
  `expect(transition("loading", LOAD_SUCCEEDED)).toBe("in_progress")`.
- **Invalid transition tests**: Every illegal transition tested.
  `expect(transition("submitted", ANSWER_CHANGED)).toBe("submitted")`.
- **Guard function tests**: `canSubmit`, `canSave`, `canEdit` tested
  for each state.
- **Edge cases**: "save during submit", "deadline during flush",
  "heartbeat during disconnect".
- All tests run via `pnpm test` with zero runtime impact.

### PR 4 (Candidate Exam Machine Integration)

- **Happy path**: Load → answer → save → submit → navigate to result.
- **Save failure recovery**: Save fails → disconnected banner →
  reconnected → save succeeds.
- **Deadline path**: Timer expires → flush → auto-submit → result.
- **Deadline auto-submit failure**: Timer expires → flush fails →
  auto-submit fails → retry button visible.
- **Submit flush failure**: Submit clicked → flush timeout →
  "submit anyway" override available.
- **Double-submit prevention**: Submit clicked twice → second is no-op.
- **Page unload**: Component unmounts during in-flight save → no
  state update on unmounted component.

### PR 5 (Admin Exam Operation Machine)

- **Mutual exclusion**: Publish clicked → Close clicked while
  publishing → Close is no-op.
- **Operation success**: Publish → success → exam refetched → UI
  shows published status.
- **Operation failure**: Close → failure → error banner → reset →
  idle.
- **Button disable**: Any operation in-flight → all operation buttons
  disabled.

### PR 6 (Navigation / Permission Runtime)

- **Route guard per role**: Admin accesses `/admin/*` → allowed.
  Candidate accesses `/admin/*` → redirected. Proctor accesses
  `/admin/exams/:id/proctor` → allowed. Proctor accesses
  `/admin/users` → redirected.
- **Sidebar per role**: Admin sees full sidebar. Proctor sees proctor
  nav only. Grader sees grading nav only. Candidate sees exam nav only.
- **Button per role**: Draft exam Publish button visible only for
  users with `PUBLISH_EXAM` permission.

## Non-Goals

This ADR explicitly does NOT:

- **Introduce XState** or any state machine library.
- **Introduce Zustand**, Redux, Jotai, or any global state library.
- **Introduce TanStack Query** or SWR for data fetching.
- **Modify backend API contracts**.
- **Modify database schema**.
- **Modify RBAC enforcement**.
- **Refactor all useState calls** across the codebase.
- **Eliminate all local UI state** — sidebar collapse, modal open,
  pagination, and similar concerns stay as local useState.
- **Put UI presentation state into business state machines**.
- **Change backend business state definitions** (exam.status,
  attempt.status, gradingStatus).
- **Implement optimistic business-state transitions** — the machine
  waits for backend confirmation.
- **Add request cancellation (AbortController)** — this is a separate
  concern to be addressed independently.
- **Solve all polling stale-data problems** — the machine manages
  mutation lifecycle, not data freshness.

## Open Questions

1. **Multi-role data**: Will the frontend receive full `user_role_assignments`
   (array of roles + permissions), or only the primary `users.role` string?
   This determines whether permission helpers can check granular permissions
   or must fall back to role-name matching.

2. **Teacher / Proctor / Grader landing pages**: What is the default redirect
   after login for each new role? Teacher → `/admin/dashboard`? Proctor →
   `/admin/exams` (filtered to proctored)? Grader → `/admin/grading-queue`?

3. **Proctor real-time**: Should the Proctor Dashboard adopt WebSocket/SSE
   for real-time candidate status, or continue with HTTP polling? This
   affects whether `ProctorOperationMachine` needs to handle streaming
   events.

4. **Grading batch finalize**: Does the grading workflow need a
   "batch finalize" action (grade all remaining questions and mark
   attempt as fully graded), or is per-question save sufficient? A
   batch action would require an additional machine state.

5. **Disconnected save queue**: In the current implementation, saves
   attempted during disconnect fail and are not retried. Should the
   machine explicitly queue saves during disconnect and flush them on
   reconnect? The audit report notes this as "allowed but not queued"
   — the decision affects `ExamConnectionState` semantics.

6. **Deadline auto-submit retry limit**: When auto-submit fails after
   deadline, should there be a maximum retry count? Currently the
   retry button has no limit. A machine could enforce e.g. 3 retries
   before showing a "contact administrator" state.

7. **Global request cancellation**: Should the project adopt a global
   `AbortController` strategy (e.g., abort all pending requests on
   route change), or is per-component cancellation sufficient? This
   is orthogonal to state machines but affects stale-data risk.

8. **TanStack Query adoption**: Should the data-fetching layer be
   modernized with TanStack Query as a separate initiative? This would
   replace most `useState + useEffect + api.get` patterns with
   `useQuery` / `useMutation`, reducing boilerplate and solving caching,
   deduplication, and stale-while-revalidate automatically. It is
   orthogonal to state machine adoption but would complement it.

## Acceptance Criteria

- [x] Document status is **Proposed**.
- [x] No code implemented.
- [x] No dependencies introduced.
- [x] Phase A-C explicitly does not adopt XState.
- [x] Phase A-C explicitly adopts reducer + transition table + tests.
- [x] Candidate Exam Flow is identified as the first machine.
- [x] Admin Exam Operation is identified as the second machine.
- [x] Proctor / Grading are explicitly deferred.
- [x] Backend business state is explicitly the source of truth.
- [x] State machine is explicitly not a replacement for RBAC.
- [x] Three-layer state model is defined (Backend Business / Frontend Interaction / View Presentation).
- [x] `CandidateExamMachine` state and event types are specified.
- [x] `AdminExamOperationMachine` state and transition table are specified.
- [x] Illegal transition policy is defined with a concrete table.
- [x] Rollout plan has 7 PRs with clear scope and dependencies.
- [x] Testing strategy specifies requirements per PR.
- [x] Non-Goals are explicitly listed.
- [x] Open Questions are explicitly listed.
- [x] All key decisions reference specific file paths and line numbers.
- [x] Machine module naming and location convention is documented (`apps/web/src/lib/state-machines/`).
- [x] `CandidateExamMachine` has a single composed state shape (`CandidateExamMachineState`).
- [x] `ExamSaveState` aligns with `useSubmitFlush` semantics (dirty/pending/inflight/saved/failed).
- [x] Pure transition boundary is documented — transition function must not call API, navigate, toast, telemetry, or timer.
- [x] Side effects are explicitly forbidden inside transition functions.
- [x] Commands / effects evolution path is documented (Phase A: `transition => S`; Phase B: `transition => { state, commands }`).
- [x] Disconnected submit behavior is constrained — must not bypass flush, must not navigate before backend confirms.
- [x] Permission Matrix PR pull-forward condition is documented (if new roles arrive before runtime integration, PR 2 must be pulled forward).
- [x] AdminLayout description is corrected — blocks Candidate but allows all non-Candidate users (not "redirects non-Candidate to login").
