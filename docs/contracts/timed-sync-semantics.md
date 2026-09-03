# #291 Phase B — `timed_sync` / Admission Semantic Freeze

> **Status: READY-FOR-IMPLEMENTATION (B0 semantic authority, 2026-09-03).**
> This record freezes the `timed_sync` clock semantics and its relationship
> to the #292 admission queue. It is the design authority for Phase B
> implementation slices until superseded by an Accepted ADR or a later
> dated amendment in this file. Phase A reality (deadline / untimed) merged
> via PR #388; this document starts from that baseline.

## 1. Current truth (as-built @ master `b994d109`)

- `TimingMode = timed_sync | timed_window | deadline | untimed`
  (`packages/domain/src/enums.ts`). `AuthoringTimingMode` excludes
  `timed_sync`, so no authoring path can produce it.
- `timed_sync` is rejected at two canonical seams:
  `validateTimingModeMatrix` (`packages/exam-engine/src/examPolicy.ts`, the
  policy validator used by create / draft-update / publish) and the
  `publishExam` guard (`examCommands.ts`). These rejections STAY until the
  activation slice explicitly lifts them.
- Runtime deadline kernel (Phase A): attempts are created directly as
  `in_progress`; `attempt.deadlineAt` is written only for `timed_window`
  (personal `now + duration`). `computeEffectiveDeadline(exam, attempt) =
  min(closeAt, deadlineAt)` with the nullable untimed case, and
  `isAttemptDeadlineExpired` is the sole expiry authority. The deadline
  scanner discovers candidates as an over-approximation and re-decides
  under `FOR UPDATE`.
- Exam lifecycle: `draft → published → open → closed → archived`
  (+ `canceled`). `published → open` happens lazily on access when
  `now >= openAt` (`checkAndUpdateExamStatus`); `open → closed` lazily at
  `closeAt`. `extendExam` moves `closeAt` only.
- `not_started` / `queued` attempt statuses have no production write path.
- `requireQueue` / `batchSize` / `batchInterval` are authorable policy
  fields, and `requireQueue=true` is NOT inert as-built: a legacy Phase 2
  in-memory admission gate (process-local module Map, queue-status route,
  and candidate-start gating in `apps/api/src/routes/attempts.candidate.ts`)
  is product-reachable for a published `timed_window` exam today —
  non-durable (queue membership and batch timing reset on restart),
  single-instance, unaudited. It is not an admission runtime; #292's durable
  admission design replaces it (premise drift tracked in #394). Redis is
  adopted for shared rate limiting only (ADR-001); queue Redis adoption
  remains decision-gated.

## 2. Candidate models considered

| Dimension | A — operator T0, shared clock | B — queue drains, then T0 | C — personal clock on admit | D — T0 = openAt |
| --- | --- | --- | --- | --- |
| Global synchronized clock | ✔ single durable T0 | ✔ | ✘ per-admit | ✔ (scheduled) |
| Equal candidate duration | ✘ latecomers get less | ✔ | ✔ | ✘ latecomers less |
| Queue required | ✘ orthogonal | ✔ required | ✔ required | ✘ |
| Operator trigger required | ✔ | ✔ | ✔ (admission) | ✘ contradicts SPEC |
| Restart-safe T0 | ✔ one column | ✔ + queue state | ✘ needs admit ledger | ✔ |
| Deadline kernel reusable | ✔ copy shared deadline into attempt | ✔ | ✔ | ✔ |
| Fairness | sitting = one shared end | equal run time | equal run time | shared end |
| Operational complexity | low (one command + column) | high (cohort readiness, absent policy) | high (admission first) | low |
| Compatibility with SPEC §2.5 | ✔ “监考员统一触发开考，所有人同时开始倒计时，到时强制交卷” | partial (SPEC example ambiguous) | ✘ degenerates to timed_window + queue | ✘ no operator start |
| Compatibility with #291 | ✔ queue explicitly a separate issue | ✘ makes timed_sync depend on #292 | ✘ | ✘ |
| Compatibility with #292 | ✔ queue composes orthogonally | — | — | ✔ |

**Chosen: Model A**, for these repo-authority reasons:

1. SPEC §2.5 (the product contract) says the operator/proctor triggers the
   start, everyone enters one shared countdown, and there is a single
   forced-submit end (“到时强制交卷” implies one global end instant).
2. #291 non-goals explicitly separate queue admission from timing modes, so
   `timed_sync` must be meaningful with `requireQueue=false`; Model B cannot
   exist without #292 and is therefore not the core semantics.
3. Model C collapses `timed_sync` into `timed_window + admission` and is
   rejected for the same reason.
4. Model D removes the operator trigger the SPEC names as the start
   authority and is rejected.
5. ADR-006 requires the start instant to be a server-authoritative durable
   instant — exactly one written timestamp satisfies it.

Under Model A, the SPEC's timed_sync example (“运营人员点击开考 → 考生排队
分批进入 → 开始 90 分钟倒计时”) is read as: with a queue, candidates are
admitted into the running (or about-to-run) sitting per #292 policy; the
operator is expected to trigger start once the cohort is ready. Operational
discipline of when to press Start is not a second timing model.

## 3. Frozen timing authority (Model A)

Two authorities stay separate (they must not be collapsed):

- **Timing authority**: when does the shared clock begin and end —
  `syncStartedAt` (T0) + the global deadline equation below. Owned by the
  canonical operator start command (B2).
- **Admission authority**: who may enter and when — #292's queue state
  machine. `timed_sync` does NOT imply `requireQueue`.

### Timing equations

```txt
T0              = exam.syncStartedAt        -- server instant, written exactly once
syncDeadline    = closeAt === null
                    ? T0 + durationMinutes
                    : min(T0 + durationMinutes, closeAt)

attempt.deadlineAt = syncDeadline           -- copied at attempt start
effectiveDeadline  = min(closeAt, attempt.deadlineAt) = syncDeadline
```

- `computeEffectiveDeadline` / `isAttemptDeadlineExpired` / the deadline
  scanner need NO timed_sync branches: the copied `deadlineAt` flows through
  the existing Phase A kernel unchanged.
- Copy cost (amended 2026-09-03 after adversarial review): a **cap-bound**
  sitting copies the old `closeAt` into `deadlineAt`, so a later
  `extendExam` cannot reach in-flight attempts through the min() alone —
  the B2 extend command must rewrite in-flight `deadlineAt` in that case
  (see the extend row in §7). A **duration-bound** sitting needs no rewrite.
- Two candidates starting at `T0+2min` and `T0+30min` resolve to the same
  `attempt.deadlineAt` — the deadline is derived from the durable T0, never
  from the candidate's start instant.
- Restart reconstruction: T0 is a PostgreSQL column; the deadline is a pure
  function of the exam row. No process-local state participates.

### Field semantics under timed_sync

| Field | Rule under timed_sync | Rationale |
| --- | --- | --- |
| `durationMinutes` | required, `> 0` (activation validator) | a synchronized sitting has a shared countdown |
| `openAt` | earliest operator-trigger instant; also gates candidate visibility of the pre-start exam; start command must reject `now < openAt` | announced window start |
| `closeAt` | required; absolute hard cap bounding the global deadline; `openAt < closeAt` (existing window check); lazy `open → closed` at `closeAt` retained | bounded sitting; guards against a late operator trigger stretching the sitting |
| `syncStartedAt` | new nullable column; null = sitting not triggered; written exactly once; never reset (cancel/archive keep it as history) | durable T0 authority |
| `requireQueue` | `false` = self-entry after T0 (the Phase B core). `true` = #292 composition — **rejected at authoring/publish activation until #292 ships durable admission** (§4/§7); timed_sync must never fall back to the legacy in-memory gate (§1). End-state matrix has no forbidden combination; only the runtime support matrix temporarily rejects it | timing and admission are orthogonal dimensions |
| `batchSize` / `batchInterval` | meaningful only with `requireQueue=true`; owned by #292 | admission policy |
| `interruptionTimePolicy` | **strict only** at activation | same rationale as deadline mode: bounded_grace auto-compensation is modelled around a personal deadline and would silently desynchronize the shared end |
| `maxAttempts` / retake | one synchronized sitting ≈ one attempt per enrollment; activation validator rejects `max_attempts > 1`; `unlimited` / `pass_then_stop` retakes re-enter the same shared global deadline (remaining time only). Multi-sitting retakes are out of scope | no repo authority for per-retake sittings; never silently allow an incoherent second full-duration sitting |
| `latestStartOffsetMinutes` | cutoff anchored at **T0** (`syncStartedAt + offset`), not `openAt`; null = entry allowed until the global deadline | the buffer is relative to the sitting's start |
| `minSubmitAfterStartMinutes` | unchanged personal semantics (anchored at the attempt's own `startedAt`) | it bounds minimum answering time, not the shared clock |
| `latestStart` after deadline | entry after `syncDeadline` is forbidden (new attempt would be born expired) | born-expired attempts are a protocol error |

### Candidate-visible semantics (frozen for later slices)

- Before T0, while the sitting window is live (`now < closeAt`): no attempt
  may start; candidate sees “等待开考” (waiting), not “window closed”. No
  attempt rows exist pre-T0 (waiting-room is enrollment visibility, not a
  durable attempt state).
- Never-started sitting expiry: if the exam reaches `closeAt` before T0 is
  established, synchronized start becomes permanently unavailable. Frozen
  effects: candidate start returns the canonical expired-window result (the
  existing open-window gate precedes any “waiting” branch), never “waiting
  for synchronized start”; no T0 may be minted afterwards; the exam must
  converge to a lifecycle state representing an expired, non-startable exam.
  The concrete lifecycle transition (e.g. lazy `published → closed`, if the
  state-machine authority is extended accordingly) is a B2 implementation
  decision; B1 must not invent a product transition.
- After T0, before the global deadline: start succeeds;
  `attempt.deadlineAt = syncDeadline` (shared remaining time).
- After the global deadline: start is rejected; in-flight attempts are
  auto-submitted by the existing scanner/reconciliation at `syncDeadline`.
- Reconnect/reload/API restart: attempts restore via the existing
  disruption/recovery path; remaining time is a pure function of durable
  rows (`syncDeadline - now`), so restarts cannot change it.

### Operator / capability semantics (frozen for B2)

- The synchronized start is a canonical exam lifecycle command reusing the
  existing `published → open` transition + writing `syncStartedAt` in one
  transaction. No new role check: the owning capability is the existing
  exam lifecycle/edit capability family (exact permission selected in B2
  from the capability catalog; NOT a role-name check and NOT a broad new
  Admin grant).
- Two concurrent start commands: the second must observe the first's T0 —
  the command writes `syncStartedAt` with a conditional
  (`WHERE sync_started_at IS NULL`) / transition-guarded update; a replay
  returns the already-started exam idempotently (single authoritative T0).
- Start is rejected when: exam not `published` (already opened/closed/
  canceled), `now < openAt`, `now >= closeAt`.

## 4. Queue relationship and #292

- `timed_sync + requireQueue=false` is the Phase B product core: an
  operator-triggered sitting where enrolled candidates self-enter after T0.
- `timed_sync + requireQueue=true` stays unreachable until #292 ships its
  admission runtime. The blanket `timed_sync` authoring/publish rejections
  cover this only while they exist; from B2 activation until #292 lands, the
  activation validator itself must reject the combination (§7) and the
  timed_sync start path must never consult the legacy in-memory admission
  gate (§1) — that gate is #292's to retire or replace (#394), not a
  transitional timed_sync queue.
- Admission semantics under timed_sync (contract #292 must implement):
  admission is an entry gate only — it never changes the global deadline.
  Candidates admitted after T0 receive less remaining time; queue delay is
  part of the sitting, which is exactly why the operator is expected to
  trigger start once the cohort is ready.
- Queue storage recommendation (recorded for #292): PostgreSQL-authoritative
  admission entries (candidate/enrollment, state, enqueuedAt/admittedAt,
  idempotency key, audit linkage) with the existing transaction/locking
  conventions. Redis remains rate-limit-only per ADR-001; a Redis queue
  needs an ADR-001 update with durability/reconciliation contracts first.
  Polling is sufficient for waiting UX; no WebSocket/SSE introduction.

## 5. Durable authority map

| State | Durable authority |
| --- | --- |
| Synchronized start (T0) | `exams.sync_started_at` (new, nullable) |
| Synchronized deadline | pure function of the exam row (`computeSyncDeadline`); copied into `attempt.deadlineAt` at start |
| Attempt expiry decision | `isAttemptDeadlineExpired` (existing sole seam) |
| Queue position / admitted state | #292 (PostgreSQL admission entries; not an attempt status) |
| Attempt state | existing ExamAttempt state machine — `not_started`/`queued` stay non-durable; admission is NOT modelled as an attempt state |
| Audit | existing audit authority — `exam.sync_started` (new action, B2, atomic durability) + existing attempt actions |

Rationale for not activating `queued` as an attempt state: admission is a
property of eligibility-to-enter (Enrollment/admission entity), not of a
particular answer sheet; creating attempt rows for queued candidates would
give pre-start rows with snapshots and attempt numbers whose lifecycle is
undefined. #292 owns the admission record shape.

## 6. Restart / failure semantics

- API restart after operator start: T0 and all copied deadlines are in
  PostgreSQL; candidates' remaining time and auto-submit behavior are
  unchanged. No reconstruction from memory, Redis, or websockets.
- Retry / duplicate start: idempotent single T0 (conditional write).
- Scanner: unchanged — discovery over-approximates, under-lock recheck via
  `isAttemptDeadlineExpired` is the mutation authority. Sync attempts carry
  a concrete `deadlineAt`, so discovery needs no new predicate.

## 7. Policy compatibility matrix

| Policy | Compatibility with timed_sync | Decision |
| --- | --- | --- |
| interruption `strict` | ✔ | required at activation |
| interruption `bounded_grace` | ✘ auto-compensation desynchronizes the shared end | rejected at activation validator |
| interruption `operator_incident` | deferred | per-attempt grants exist (ADR-013, closeAt-bounded); whether timed_sync admits them is an explicit later product decision, not silently enabled |
| extend exam | ✔ with one B2 rule: when the sitting is **cap-bound** (`T0 + duration >= closeAt` before the extension), extending `closeAt` must rewrite `deadlineAt` for in-flight attempts (`in_progress`/`disrupted`) to the new sync deadline inside the extend command's transaction (audit-covered) — the copied `deadlineAt` otherwise keeps the old cap and the extension would not reach candidates already in the sitting, diverging from deadline-mode precedent. A **duration-bound** sitting needs no rewrite (extension only postpones lazy close). All still-in-flight attempts move together, so the shared end is preserved | keep existing command + B2 sync branch |
| `requireQueue=true` before #292 | ✘ no durable admission runtime exists (the legacy in-memory gate is not one) | rejected at authoring/publish activation (B2) until #292; timed_sync start path never consults the in-memory gate |
| extend one attempt | deferred with `operator_incident` | explicit later decision |
| retake | one sitting = one attempt; `max_attempts > 1` rejected at activation; cross-sitting retakes out of scope | activation validator |
| result publication | orthogonal (mode + `resultsPublishedAt`); no coupling | unchanged |

## 8. Migration needs

- `ALTER TABLE exams ADD COLUMN sync_started_at timestamptz NULL` —
  append-only, no backfill (legacy and non-sync rows stay null), backward
  compatible. No DB CHECK: per-mode legality stays owned by the canonical
  policy validator (same split as Phase A migration 0040).

## 9. Implementation slices

- **B0 (this record)** — semantic freeze + documentation truth correction.
  No production behavior.
- **B1 — synchronized-time kernel** (no product activation): durable
  `syncStartedAt` column + domain field; pure `computeSyncDeadline`
  equation in the canonical deadline-authority module; timed_sync branch in
  `startOrRestoreAttempt` (shared `deadlineAt`, pre-T0 and post-deadline
  start rejection, T0-anchored late-entry cutoff); openAt auto-open
  exemption for `timed_sync` in `checkAndUpdateExamStatus`. Authoring and
  publish keep rejecting `timed_sync`; no candidate route, contract, or UI
  change.
- **B2 — synchronized lifecycle activation**: canonical operator start
  command (published→open + T0, conditional-write idempotency), capability
  selection, `exam.sync_started` atomic audit, activation-time policy
  matrix (duration/closeAt required, strict-only, retake rule,
  `timed_sync + requireQueue=true` rejection until #292 — §4/§7), authoring
  and publish activation, admin trigger surface, candidate waiting UX, E2E.
  Also: the `extendExam` cap-bound rewrite of in-flight `deadlineAt` (§7);
  the never-started sitting's lifecycle convergence at `closeAt` (§3).
- **B3 — admission queue (#292)** per its own issue.
- **B4 — composition**: `timed_sync + requireQueue`, proctor/operator
  console surfaces, final multimodal closeout.

## 10. Test oracle (B1)

- `computeSyncDeadline` truth table: null T0 → null; `T0 + duration`;
  `min(T0 + duration, closeAt)` in both binding orders; null duration →
  fail-closed error (a malformed sync exam must never degrade to
  "no deadline").
- Shared deadline: two starts at different instants produce identical
  `attempt.deadlineAt`.
- Pre-T0 start rejected; post-deadline start rejected; post-`closeAt` start
  rejected (existing window gate regression). The pre-T0 “waiting” result is
  window-bounded: with T0 null at/after `closeAt`, candidate start gets the
  canonical expired-window rejection, never “waiting for synchronized
  start” (published + T0=null + `now >= closeAt`).
- Late-entry cutoff anchored at T0.
- `checkAndUpdateExamStatus`: `timed_sync` stays `published` past `openAt`
  (no auto-open); `timed_window` auto-open regression; lazy close at
  `closeAt` regression.
- Phase A regressions: `timed_window` keeps `startedAt + duration`;
  `deadline` keeps `closeAt`-only; `untimed` keeps null (never expires).

## 11. Non-goals

- No queue/admission runtime (#292), no `queued`/`not_started` attempt
  states, no waiting UI, no proctor console, no authoring/publish/candidate
  activation of `timed_sync` (B2), no Redis, no WebSocket/SSE, no new
  scheduler, no interruption-policy widening, no retake-policy rework.

## 12. Stop conditions

- If B2's capability/audit selection cannot reuse the existing exam
  lifecycle capability family without a broad grant, stop and record the
  missing-capability design before implementing.
- If the per-attempt operator grant for `timed_sync` is requested, it is a
  new product decision requiring its own record (it changes the shared-end
  fairness model).
- If B2 is asked to keep `timed_sync + requireQueue=true` publishable before
  #292's durable admission ships, stop: that combination is frozen out
  until #292 (§4/§7).
- Any divergence between this freeze and as-built code is a defect: reconcile
  both directions per AGENTS.md §4 before continuing.
