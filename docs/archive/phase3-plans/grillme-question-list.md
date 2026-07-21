# S10 — Phase 3 Large Job Grillme Question List

> **Date:** 2026-06-30
> **Purpose:** Pre-stage the grillme questions for every Phase 3 Large Job, so
> when a grillme session opens, the questioner starts from a fact-backed list —
> not blank-page brainstorming. Each question cites the audit section or file
> that motivates it. Questions are **surfaced, not answered** — answering is the
> grillme session's job (see `grilling` skill).
>
> **Authoritative question count:** each non-DEFERRED Large Job has ≥ 8
> questions, per `job-cards.md` §S10 acceptance criteria.

---

## 0. How to use this list

- A grillme session picks **one** Large Job and walks its questions **one at a
  time** (`grilling` skill rule). Do not merge jobs in one session.
- Every question carries an **Evidence** pointer (audit §, file:line) so the
  questioner can verify the premise live instead of trusting memory.
- A **Rec.** line is the questioner's *recommended* answer direction — the
  grilled party may override it, but must say why.
- Output of a finished grillme = an ADR / matrix / spec / state diagram that
  the question set was designed to force into existence.

---

## 1. DEFERRED — Role / Permission / Scope cluster (L1, L2, L3, L7, L12)

> **Status: DESIGN COMPLETE.** These five Large Jobs are already resolved by the
> Scoped RBAC ADR on the `role-permission` worktree
> (`docs/phase3/rbac/adr-scoped-rbac-architecture.md`, Status: Proposed). That ADR is
> itself the grillme output: it answers account model (L1), permission model
> (L2), custom-role deferral (L3), proctor authority boundary (L7), and tenant
> scope (L12) in one document, with a 16-Middle-Job breakdown
> (RBAC-M1…M10, AUDIT-M1/M2, PROCTOR-M1, GRADING-M1, SYSTEM-M1).
>
> **These Jobs do NOT get re-grilled here.** The remaining work is execution
> (the 16 Middle Jobs in shadow→enforce order), not design. This list therefore
> focuses on the **nine non-DEFERRED Large Jobs** below.

| Job | Title | Status | Where resolved |
|-----|-------|--------|----------------|
| L1 | Teacher / Proctor / Grader Account Model | ✅ DEFERRED | ADR §Role Presets, §Data Model Option C |
| L2 | Backend Permission Model | ✅ DEFERRED | ADR §Formal Model, §Permission Catalog, §Role→Permission Matrix |
| L3 | Custom Role / Custom RBAC | ✅ DEFERRED | ADR §Data Model Option D (deferred), Non-Goals |
| L7 | Proctor Runtime Authority Boundary | ✅ DEFERRED | ADR §Proctor Authority Policy, §22.3 State Transition Matrix |
| L12 | Tenant / Organization / School Scope Model | ✅ DEFERRED | ADR §Scope Model, §Candidate Own-Scope Policy |

---

# 2. Active Grillme Targets

---

## L4 — Answer Protocol v2

> **Evidence base:** `audit-current-answer-payload.md` (S8) §1–§9, §10 (its own
> input questions), `audit-current-events.md` §3.1 (telemetry that depends on
> the save path). The audit's §10 already lists 8 candidate questions; this
> section refines and stress-tests them.

### Q1 — WYSIWYG submit: does submit carry a final-answer payload?
- **Evidence:** Submit sends an **empty body** today (`attempts.candidate.ts:905-961`); it grades whatever is in `attempt.answers` when the row lock is taken (`submitAndGradeAttempt.ts`). The `save-submit-race` E2E **explicitly does not assert score===100** (`save-submit-race.spec.ts:29-34`). `docs/SPEC.md`/phase-roadmap §197 call for an "Option D" final-answer barrier.
- **Rec:** Yes — Phase 3 makes `/submit` carry a final-answer payload + version barrier (the spec's Option D). Without it, "the answer the candidate sees at submit-click" can lose to a racing persisted save.
- **Sub-question:** does the candidate sign the **whole** answer set or **per-question** deltas at submit?

### Q2 — `clientSeqHistory` growth
- **Evidence:** The append-only receipt trail grows without bound inside the `answers` JSONB (`attempts.candidate.ts:835-866`), one receipt per superseded version, never pruned (S8 §1.3, §5.2).
- **Rec:** Cap it (e.g. last N receipts) OR move to a separate append-only `answer_revisions` table. Phase 3 should at minimum cap it; a separate table is the long-term answer.
- **Sub-question:** what is the audit/retention requirement vs. storage cost? Is the full history needed for grade disputes, or only the final + last N?

### Q3 — Whole-array rewrite per save
- **Evidence:** Every save read-modify-writes the **entire** `answers` JSONB (`attempts.candidate.ts:835-866`), serialized by the row lock but write-amplifying (S8 §5.2, R3).
- **Rec:** Phase 3 keeps the JSONB (no schema churn) but documents the cost; a per-answer row model (`attempt_answers` table) is a **separate** Large decision, defer unless measured hot.
- **Sub-question:** is the row-lock serialization a real bottleneck today, or theoretical? (No evidence of contention in audits.)

### Q4 — Content integrity (hash / canonical / signature)
- **Evidence:** **No** content hash, **no** canonical stored form, **no** signature (S8 §6). Only an in-memory sorted-key *comparison* (`answersEqual`) exists. The protocol is versioned but **not** content-integrity-checked.
- **Rec:** Phase 3 adds a content hash at **save time** (stored per answer) and verifies it at **grade time** — detect tampering between save and grade. Hash a canonical form, not raw JSON (key order).
- **Sub-question:** does the hash live on `StoredAnswer` (per-version) or only on the final submit payload?

### Q5 — `answer: unknown` typing
- **Evidence:** The payload is `z.unknown()` end-to-end (S8 §2.3); malformed answers silently score 0 at grade time, no early rejection.
- **Rec:** Phase 3 adds per-question-type Zod refinement **at save time** (reject malformed early). Keeps grading as the authority for correctness, but stops garbage from being stored.
- **Sub-question:** how do new question types (Phase 2+, e.g. rich text) register their refinement without a code change per type?

### Q6 — Three submit paths convergence
- **Evidence:** Candidate submit (`submitAndGradeAttempt`), force-submit (`attempts.admin.ts:169-235`, inline reimplementation), deadline scanner (`gradeAttemptIdempotent`, different API surface) — all do submit+grade in one locked tx but via **different code paths** (S8 §7.1, R5/R7). A v2 change must touch all three.
- **Rec:** Phase 3 funnels all three through one orchestrator so the freeze barrier + any new payload handling apply uniformly. Force-submit and scanner stop reimplementing.
- **Sub-question:** does the orchestrator accept a "submitter actor" param (candidate / proctor / system) so audit attribution is uniform?

### Q7 — Frozen answer snapshot at submit
- **Evidence:** There is **no** frozen answer snapshot — the freeze is status+lock, not a copy (S8 §5.3). `questionSnapshot` is the *question* snapshot, not an answer snapshot.
- **Rec:** Phase 3 writes an immutable `submitted_answers` snapshot at submit (for audit / grade-dispute), separate from the mutable `answers`.
- **Sub-question:** privacy implications — does the snapshot duplicate PII? How does it interact with the candidate-answer audit boundary (S6 §1.3)?

### Q8 — Idempotency contract across reconnects
- **Evidence:** `clientSeq` idempotency relies on structural equality; across reconnects `clientSeq` is seeded to current version (`TakeExamPage.tsx:159-166`), so the "same" logical save can use a different seq (S8 §4).
- **Rec:** Keep `clientSeq` replay detection but make the contract explicit in the spec: "a replay is same-seq + structurally-equal payload." Cross-reconnect replays are **not** deduped by content.
- **Sub-question:** should v2 add content-hash-based dedup as a second layer, or is seq-based enough given the reconnect-seed behavior?

### Q9 (bonus) — Backward compatibility
- **Evidence:** Existing attempts have no hash/snapshot; v2 must grade old attempts too.
- **Rec:** v2 is **additive** — new fields nullable, old attempts graded as today. No migration that rewrites existing `answers`.

---

## L5 — WYSIWYG Submit / Final Answer Barrier (ADR-008 continuation)

> **Evidence base:** `audit-current-answer-payload.md` §3, §7.2 (ADR-008 freeze
> barrier today is *behavioral*, not structural), `submitAndGradeAttempt.ts`
> docstring. This is the **proof-of-equality** half of L4: even if submit
> carries a payload, you must *prove* what the candidate saw equals what gets
> graded.

### Q1 — What does the candidate actually "sign"?
- **Evidence:** Today submit signs nothing (empty body). The barrier must define the signed artifact.
- **Rec:** The candidate signs the **full final answer set + a version barrier** at submit-click time. The signed set is the grading authority; a racing save after submit-click is rejected.
- **Sub-question:** is the signature a content hash (L4 Q4) or a version vector per question?

### Q2 — Client display vs. server authority
- **Evidence:** The candidate sees `answers` (Map) on the client; the server grades `attempt.answers`. These can diverge under the current race (S8 §3.3).
- **Rec:** The submit payload is the **client's view at click time**; the server reconciles it against `attempt.answers` under the lock. If they disagree beyond version drift → reject with a "your view was stale, review" error, not silent grade.
- **Sub-question:** what's the UX when the barrier rejects? Re-show the server's authoritative set and force a re-confirm?

### Q3 — Force-submit / auto-submit barrier
- **Evidence:** Force-submit and deadline scanner don't have a candidate click — there's no "candidate view" to sign (S8 §7.1).
- **Rec:** The barrier applies to **candidate submit only**. Force-submit/auto-submit grade the persisted set as-is (no candidate signature exists). This must be explicit in the spec to avoid a false "uniform barrier" assumption.
- **Sub-question:** does force-submit write its own audit hash of the graded set, so the graded set is still provable even without a candidate signature?

### Q4 — Submit hash / audit hash
- **Evidence:** No hash exists today (S8 §6). A grade-dispute needs a provable "what was graded."
- **Rec:** At submit, compute a hash of the graded answer set and store it on the attempt (`submittedAnswerHash`). Any later re-grade (manual grading reconciliation) must reproduce the same hash from the same inputs or fail loudly.
- **Sub-question:** is the hash over the raw `answers` JSONB, a canonical form, or the `questionSnapshot` + `answers` pair?

### Q5 — Barrier vs. Answer Protocol v2 (L4) dependency
- **Evidence:** L5 is meaningless without L4's content hash + per-type validation.
- **Rec:** L4 and L5 are **one grillme session, two ADRs**: L4 (protocol/payload) is the substrate, L5 (barrier/proof) sits on top. Do not design L5 before L4's hash decision.
- **Sub-question:** can L5 ship incrementally (barrier on candidate submit first, audit hash later), or is it all-or-nothing?

### Q6 — Double-submit / re-submit after rejection
- **Evidence:** `submit` is status-guarded (`submitted`/`graded` terminal); a rejected barrier submit must not flip status.
- **Rec:** A barrier rejection returns the attempt to `in_progress` (no status change) with a reconciliation prompt. The candidate re-submits. The scanner/force-submit paths are unaffected (they don't use the barrier).
- **Sub-question:** is there a max-reconciliation-attempts limit, to prevent a candidate from looping to stall past deadline?

### Q7 — Evidence in E2E
- **Evidence:** `save-submit-race.spec.ts` currently **disclaims** WYSIWYG (lines 29-34). Once the barrier exists, this spec must flip to **assert** score===100.
- **Rec:** The barrier's acceptance test is the inversion of `save-submit-race`: the candidate-visible answer wins. Add it as a gate.
- **Sub-question:** is there a deterministic way to simulate the race in unit/integration tests, or is E2E the only honest place?

### Q8 — Privacy / audit interaction
- **Evidence:** The submit payload now carries the full answer set; the barrier hash is derived from it.
- **Rec:** The payload is **not** logged in full (S6 privacy rule); only the hash + metadata (attemptId, actorId, timestamp) are audit-logged. The full payload lives in the attempt row, audited via the sensitive-read policy (ADR §Grader Visibility).
- **Sub-question:** does the barrier rejection itself audit (sensitive — it reveals a stall attempt)?

---

## L6 — Frontend Exam State Machine

> **Evidence base:** `audit-current-candidate-runtime.md` (S7) §2–§6, §8 (its
> own 8 input questions). The headline fact: `TakeExamPage` has **15 useState +
> 8 useRef + 2 derived**, no reducer, no state machine, three deadline clocks.

### Q1 — Single source of truth
- **Evidence:** `answers`, `questionStates`, `versionsRef` mirror the same truth across state + refs (S7 §3.1, R1).
- **Rec:** Collapse into one reducer-owned structure (or a state-chart). Migration boundary: introduce the reducer behind the existing component API, swap call sites one transition at a time.
- **Sub-question:** useReducer + hand-written transitions, or a state-chart library (XState)? XState gives model-based testing but adds a dependency.

### Q2 — Two save-status layers
- **Evidence:** Page `saveState` (global) vs `useSubmitFlush` per-question `SaveStatus` (refs) — no single owner (S7 §3.2, C3, R4).
- **Rec:** The state machine owns per-question status; the global indicator is a **derived selector**. `useSubmitFlush` becomes a side-effect of the machine, not a parallel state owner.
- **Sub-question:** does the machine own the debounce timer, or stays that an effect?

### Q3 — Deadline authority (three clocks)
- **Evidence:** `deadlinePassed` (page), `ExamTimer.onTimeout` (component), server scanner — three independent clocks (S7 §3.3, C1/C2, R2).
- **Rec:** The **page-level deadline state** is authoritative for the client UI; `ExamTimer` becomes a pure view firing no independent submit. The server scanner is the ultimate authority but the client represents "server already auto-submitted me" vs "I'm auto-submitting" as distinct states.
- **Sub-question:** does the client ever submit on deadline, or always defer to the server scanner + show "auto-submitting" until confirmed?

### Q4 — Disconnect / reconnect semantics
- **Evidence:** `isDisconnected` toggled by 6 call sites; any success clears it → banner flickers (S7 §3.4, C4, R3).
- **Rec:** Make `isDisconnected` a **derived selector** ("no successful network in N ms") rather than a flag. Banner reflects heartbeat ∪ save health.
- **Sub-question:** what does "reconnected" mean — next success, or a dedicated probe? (Rec: next success on either channel.)

### Q5 — Submit lifecycle enum
- **Evidence:** `showSubmitDialog` + `isSubmitting` + `isFlushing` + `flushResult` + `requiresSubmitOverride` + `autoSubmitFailed` ≈ 6 submit sub-states as booleans (S7 §2.2, Q5).
- **Rec:** One `submitPhase` enum: `idle | dialog-open | flushing | submitting | done | failed`. Legal transitions documented; cancel-mid-flush is an explicit transition.
- **Sub-question:** can a candidate cancel a flush mid-flight? (Rec: yes, returns to `dialog-open`.)

### Q6 — Re-entrancy guards as state
- **Evidence:** `submittingRef`, `deadlineHandledRef`, `heartbeatFailureReportedRef` are one-shot guards in refs because state is async (S7 §2.3, Q6).
- **Rec:** Promote to first-class machine transitions (testable, resettable) instead of imperative refs. The "already handled" notion becomes a state, not a ref.
- **Sub-question:** does this hurt the hot path (save/heartbeat)? (Rec: no — guards become guards in the chart, same cost.)

### Q7 — Restore / disrupted on the client
- **Evidence:** The client has **no** `disrupted` notion; on reload it either restores transparently or bounces to result (S7 §6, Q7).
- **Rec:** The client gets a `restoring` state: if the server returns `disrupted`, show a restore spinner + "restoring your session" banner, then transition to `in_progress`. Today's silent-restore-or-bounce is a UX gap.
- **Sub-question:** what does the candidate see if restore **fails** (server can't flip to in_progress)?

### Q8 — Testing the machine (the safety net)
- **Evidence:** E2E asserts **server outcomes, not client UI states** — overlay/rejection/disconnect/submit-anyway have **zero** E2E guard (S7 §7, R5).
- **Rec:** **Before** any refactor, add the regression net: component tests on every transition + new E2E for the overlay/rejection/disconnect paths. A state-chart enables model-based tests.
- **Sub-question:** is the net added in a **prior** PR (no behavior change) so the refactor diff is purely structural?

---

## L8 — UI Design / Workbench UI Contract

> **Evidence base:** `AGENTS.md` §"Phase1.4 UI Foundation Reset" (the existing
> `docs/ui/` constitution + 9 sub-docs), the i18n completion note in
> `phase-roadmap.md` §198. Note: a **prior** UI-foundation effort already
> exists (`docs/ui/00-ui-constitution.md` … `09-phase2-readiness.md`); L8 must
> decide whether to extend it or supersede it.

### Q1 — Relationship to the existing `docs/ui/` constitution
- **Evidence:** `docs/ui/00-ui-constitution.md` through `09-phase2-readiness.md` already define tokens, layout, component boundaries, state grammar, templates, a11y, and a migration plan (9 docs).
- **Rec:** L8 **extends** the existing constitution, does not rewrite it. The grillme's first output is a delta doc: what the existing UI contract lacks for Phase 3 (multi-role nav, proctor panel template, capability-aware components).
- **Sub-question:** is the existing UI reset **complete** (PR 1–9 done), or is L8 blocked on outstanding UI-foundation debt?

### Q2 — Capability-aware navigation (depends on L1/L2 ADR)
- **Evidence:** Nav/landing currently derive from `user.role === "Candidate"/"Admin"` (`AuthContext.tsx:37`, `AdminLayout.tsx:39`) — hardcoded role strings (role-checks audit §6).
- **Rec:** Nav derives from **permissions/capabilities**, not role strings. The Scoped RBAC ADR's RBAC-M9 (Frontend Capability-Aware Navigation) is the implementation; L8 defines the **visual contract** for it.
- **Sub-question:** how does nav re-render when a role assignment changes mid-session?

### Q3 — Proctor panel template (Phase 2-ready but not implemented)
- **Evidence:** `docs/ui/05-page-templates.md` + `09-phase2-readiness.md` document a proctor panel template as "Phase2-ready documentation only"; `AGENTS.md` forbids implementing the real proctor panel during UI reset.
- **Rec:** L8 defines the proctor panel **layout contract** (status cards, event stream, action confirmation) but the real implementation follows the RBAC ADR's PROCTOR-M1. L8 = template, PROCTOR-M1 = behavior.
- **Sub-question:** does the proctor panel share the AdminShell or get its own runtime shell (per `02-layout-system.md`)?

### Q4 — Status grammar unification
- **Evidence:** `docs/ui/04-state-grammar.md` already proposes centralized status grammar; `07-ui-bug-inventory.md` lists scattered CSS/Tailwind status colors as a known bug.
- **Rec:** L8 finalizes the status-grammar token set (normal/warning/critical/disabled/etc.) and the mapping from domain states (attempt status, grading status, warning level) to UI tokens. One source of truth.
- **Sub-question:** are proctor `warningLevel` (normal/warning/critical) and attempt `status` the same visual scale or distinct?

### Q5 — Table / form / action layout contract
- **Evidence:** `docs/ui/05-page-templates.md` defines list/detail/form/exam-runtime templates; the migration plan (`08-migration-plan.md`) is PR-sliced.
- **Rec:** L8 codifies the **layout primitives** (DataTable, DetailLayout, FormSection, ActionBar) as the shared contract every admin page must compose. Subsequent page migrations (PR 6–9) become mechanical.
- **Sub-question:** are these primitives shadcn/ui-based (current stack) or a new layer?

### Q6 — Exam runtime shell vs. admin shell boundary
- **Evidence:** `03-component-boundaries.md` + `02-layout-system.md` already separate AdminShell from ExamShell; `07-ui-bug-inventory.md` flags the boundary as "unclear" historically.
- **Rec:** L8 hardens the boundary: the exam runtime (candidate) and the workbench (admin/proctor/grader) are **two shells** sharing tokens but not layout components. A multi-role user switches shell on role-context select.
- **Sub-question:** can a Teacher who is also a Proctor see both shells in one session, or must they switch?

### Q7 — i18n / copy contract
- **Evidence:** i18n foundation is complete (`phase-roadmap.md` §198, J1–J10); remaining page-level copy migration is a Phase 3 in-scope item.
- **Rec:** L8's contract: **no hardcoded user-visible strings** (enforced by `pnpm lint:copy`); every Phase 3 UI ships through `t()`. The grillme output includes the translation-key naming convention for new Phase 3 surfaces.
- **Sub-question:** do proctor/grading UI strings live under `admin.*` or get new namespaces (`proctor.*`, `grading.*`)?

### Q8 — Accessibility floor
- **Evidence:** `docs/ui/06-accessibility-rules.md` defines a11y rules.
- **Rec:** L8 sets the **acceptance bar**: every Phase 3 component meets the a11y rules (keyboard, focus trap on modals, status announced to SR). No Phase 3 UI merges without an a11y check.
- **Sub-question:** is there an automated a11y gate (axe) in CI, or manual checklist?

---

## L9 — Audit / Monitoring Full Event Taxonomy

> **Evidence base:** `audit-current-events.md` (S6) §2 (audit catalog), §3
> (telemetry), §7 (missing events), §8 (M4 recommendations), §9 (risks). The
> headline trap: ~50 free-form audit actions, no enum, and M4's proposed names
> **collide** with existing ones.

### Q1 — Central event registry (enum / constants / union)
- **Evidence:** `audit_logs.action` is free-form `text`; ~50 distinct literals at ~30 call sites, **no enum/union/constants** (S6 §1.1, §6, R1). A typo (`atempt.submit`) creates an unfilterable orphan.
- **Rec:** Introduce a `AuditAction` constants module (closed union) + Zod enum, validated at the `recordAudit` boundary. **No rename** of existing actions.
- **Sub-question:** is the registry in `packages/contracts` (shared) or `packages/authz` (per the RBAC ADR's AUDIT-M1)?

### Q2 — Reconcile M4 naming collisions BEFORE adding anything
- **Evidence:** M4 proposes `grading.score_submitted` but code already writes `grading.score_entered`; proposes `attempt.force_submitted` but code has `attempt.forceSubmit` (S6 §7.1, §8.2, R3).
- **Rec:** **Do not add the proposed duplicates.** Either keep existing + document, or rename existing in one migration of all read/write/test sites. Pick one per action; the taxonomy must not have two names for one event.
- **Sub-question:** for `attempt.misconductFlagged` vs M4's `proctor.incident_marked` — keep `misconductFlagged` (more specific) and treat incident sub-types as **metadata**, not new actions?

### Q3 — Where do monitoring/infra events live? (the "no home" problem)
- **Evidence:** `audit_logs` = actor-bound compliance; `client_events` = browser-only by design. Infra events (redis.unavailable, email.send_failed, scanner errors) have **no natural table** (S6 §7.2, §8.5, R4/R6).
- **Rec:** Option A — a new `monitoring_events` table (cleanest 3-way separation). **Not** `audit_logs` (no actor) and **not** `client_events` (server-originated, contradicts schema comment).
- **Sub-question:** does M4 decide this, or does L9? (Rec: M4 picks the table as a one-paragraph decision; L9 builds the full taxonomy on top.)

### Q4 — Audit vs. monitoring vs. telemetry channel discipline
- **Evidence:** Three channels coexist today: audit (server, actor-bound), telemetry (browser), and the proposed monitoring (server, infra). They merge only at read-time (proctor timeline) (S6 §1.3, §4).
- **Rec:** L9 codifies the **channel rule**: who-did-what-to-which-entity → audit; is-infra-up → monitoring; what-did-the-browser-observe → telemetry. Each event type is assigned a channel at definition.
- **Sub-question:** can an event be dual-channel (e.g. a forced submit is both an audit action and a monitoring signal)?

### Q5 — Sensitive-read audit coverage
- **Evidence:** `GET .../grading-details` returns candidate answers but writes **no audit** (S6 §7.1, R-grading). The RBAC ADR's AUDIT-M2 adds `grading.detail_viewed`.
- **Rec:** L9 defines the **sensitive-read list** (grading detail, candidate-answer export, audit-log read, role/permission change) — each must audit. L9 = the list; AUDIT-M2 = the wiring.
- **Sub-question:** do routine 403s on sensitive resources audit? (Rec: yes for sensitive, optional for routine.)

### Q6 — Privacy rule for event payloads
- **Evidence:** Audit payloads must not carry answer content / password / token / raw email (S6, M4 §Required Privacy Rule). Today this is call-site discipline.
- **Rec:** L9 makes it a **registry-enforced** rule: each `AuditAction` declares an allowlisted metadata-key set; `recordAudit` rejects unknown keys. Default-deny.
- **Sub-question:** how to migrate the ~30 existing call sites without breaking them? (Rec: allowlist per action, backfill-then-enforce.)

### Q7 — Scanner / system-actor event attribution
- **Evidence:** Scanners write `actorId = "system:..."` but with `role: "Admin"` today (role-checks §2.5, R5; RBAC ADR SYSTEM-M1 fixes this).
- **Rec:** L9's taxonomy includes system-originated events attributed to the **System actor** (not Admin). The naming distinguishes human-initiated (`attempt.forceSubmit`) from system-initiated (`attempt.autoSubmit`) — already true today; L9 makes it exhaustive.
- **Sub-question:** are scanner **errors** (heartbeat/deadline scanner threw) monitoring events? (Rec: yes — S6 R6.)

### Q8 — Ghost allowlist cleanup
- **Evidence:** `paste_detected` and `answer_manual_save_failed` are in the proctor timeline metadata allowlist but **never emitted** (S6 §3.4, R5).
- **Rec:** L9 (or M9) decides per ghost entry: wire it (if the behavior exists) or prune the allowlist. A allowlist entry with no emitter implies false monitoring coverage.
- **Sub-question:** is there a lint/test that every allowlisted event name has at least one emitter?

---

## L10 — E2E Full Parallelization Implementation

> **Evidence base:** `audit-e2e-parallelization.md` (S9) §1–§8. The headline:
> `workers=1` is **intentional**; parallelism is already achieved via
> **sharding** (CI 2-shard, WSL N-shard), each shard = own DB. 15/17 specs
> self-seed.

### Q1 — Is full `workers>1` even needed, or is more sharding enough?
- **Evidence:** Option B (more shards) is zero-code, linear speedup; Option A (per-worker DB) is Large effort (S9 §7). With 17 specs and 2 shards, ~8-9 files/shard.
- **Rec:** **Try 3–4 shards first** (Option B). Only pursue per-worker DB (Option A) if shard count hits diminishing returns (≥6 shards). L10's grillme should first ask "what wall-clock are we targeting?"
- **Sub-question:** what is the current E2E wall-clock per shard, and what's the CI budget?

### Q2 — Per-worker DB (Option A) — how, given single-tenant server?
- **Evidence:** The app is single-tenant per server — one `DATABASE_URL` per process. Playwright doesn't natively route `baseURL` per worker (S9 §7 Option A con).
- **Rec:** If Option A is pursued, spin **one server per worker** (like WSL `E2E_WORKERS` does at shard level) — promote shard-level isolation to worker-level. Heavy but proven.
- **Sub-question:** is there a cheaper path — a worker-scoped fixture that picks a DB+server from a pool?

### Q3 — Shared-state specs (audit-log / admin-flow / demo-seed-accounts)
- **Evidence:** 3 specs touch shared global state (admin account, global tables, fixed demo seed). On close reading they're **SOFT** (count-tolerant/per-card assertions), not HARD blockers (S9 §5, R2/R3).
- **Rec:** Keep their assertions lower-bound/negative/all-match (no exact-count). Add a **lint guard** that no spec adds an exact-count assertion on a shared table.
- **Sub-question:** is the "no spec mutates demo seed" contract enforceable, or convention-only? (Rec: convention today; add a guard.)

### Q4 — Timestamp-uniqueness load-bearing vs. hygiene
- **Evidence:** `users.username` / `courses.code` are org-scoped DB-unique (timestamp suffix load-bearing); `exams.title` has **no DB uniqueness** (suffix is hygiene); `candidateNo` is app-level only (S9 §5.4, R5).
- **Rec:** Add a lint/test: every write-heavy spec's `seedExam` keeps the `${Date.now()}` suffix on the DB-unique/app-unique columns. For `exams.title`, either add a DB constraint or accept same-title coexistence.
- **Sub-question:** should `exams.title` get a DB unique constraint, or is non-uniqueness acceptable (titles are display-only)?

### Q5 — Spec distribution affinity
- **Evidence:** Playwright `--shard=i/N` distributes files round-robin, no data affinity. 15/17 self-seed → any spec can land on any shard (S9 §8).
- **Rec:** No affinity needed today. If Option A lands, worker-DB isolation removes even the residual shared-state concern.
- **Sub-question:** are there specs that **must** run after another (ordering dependency)? (Audit says no `afterAll`, but check implicit ordering.)

### Q6 — Per-spec DB cleanup
- **Evidence:** **No** spec cleans up its seeded data; **no** per-test/per-spec truncation; the DB only grows within a shard (S9 §6, R4).
- **Rec:** Acceptable today (fresh reseed per shard + self-seeding). If shard count grows, consider per-worker truncate on worker exit (Option A includes this).
- **Sub-question:** is the accumulated-row count a test-slowdown risk at high shard counts?

### Q7 — CI cost / minute budget
- **Evidence:** Each shard pays full migrate+seed+server-start overhead (S9 §7 Option B con, R6).
- **Rec:** L10's report includes a CI-minute projection for 2→4→6 shards. The grillme decides the shard count by budget, not by guess.
- **Sub-question:** is there a parallel-job limit in the repo's CI plan that caps shard count?

### Q8 — The "no exact-count" hygiene as a hard rule
- **Evidence:** Option D (S9 §7) — enforce self-seed + count-tolerant assertions so the suite stays parallel-safe as it grows.
- **Rec:** L10 bakes Option D in **regardless** of A/B: it's good hygiene and the natural complement to sharding. A lint rule rejects exact-count assertions on shared tables.
- **Sub-question:** who enforces this going forward — a custom lint rule, or PR review? (Rec: lint, since review drifts.)

---

## L11 — Subjective / Rich Text / Drawing Answer Architecture

> **Evidence base:** `audit-current-grading-api.md` (S3b) §6 (frontend renders
> `formatAnswer()`), §8 (subjective = `standardAnswer === null`), §10 (M1's
> WYSIWYG gap); `audit-current-answer-payload.md` §2.3 (`answer: unknown`
> shapes). Note: M1 already establishes the **grader** side works; L11 is the
> **candidate answering** side + new answer types.

### Q1 — Answer types in scope for Phase 3
- **Evidence:** Today's types: single_choice, multiple_choice, true_false, fill_blank (S8 §2.3). Subjective questions are `single_choice` with `standardAnswer: null` as a test shortcut (S3b §8.2). Rich text / drawing do **not** exist.
- **Rec:** Phase 3 L11 scope: **rich text (essay)** as the first new subjective type. Drawing / file attachment deferred unless explicitly required — they add storage + rendering + integrity complexity.
- **Sub-question:** is drawing in Phase 3 scope per any deployment requirement, or deferred to Phase 4?

### Q2 — Storage model for rich answers
- **Evidence:** Answers live in `attempt.answers` JSONB as `unknown` (S8 §1.1, S3b §2.1). A rich-text blob (HTML/Markdown/Delta) is large; whole-array rewrite per save (L4 Q3) amplifies.
- **Rec:** Rich text stored as a **canonical format** (pick one: Markdown or Quill Delta — not raw HTML) inside the JSONB, with a content hash (L4 Q4). Large answers may justify the `attempt_answers` table (L4 Q3) — defer that decision to L4.
- **Sub-question:** Markdown (human-readable, sanitizable) or Delta (structured, needs renderer)? Rec: Markdown + sanitize on render.

### Q3 — Safe rendering (XSS)
- **Evidence:** `formatAnswer()` (S3b §6.2) currently renders via string join — no `dangerouslySetInnerHTML`. Rich text **will** need HTML rendering.
- **Rec:** Rich text renders through a **sanitized renderer** (DOMPurify or a whitelist-based Markdown renderer), never raw HTML. L11's acceptance bar: no `<script>`, no inline event handlers, no external resources.
- **Sub-question:** is the sanitizer at save time (reject bad input) or render time (clean on display)? Rec: both — reject at save, clean at render.

### Q4 — Grading model for subjective answers
- **Evidence:** Subjective questions go through manual grading (`gradingQueue.ts`, S3b §4.3); `gradingEngine.ts` excludes `standardAnswer === null` from auto-grading (S3b §5.1).
- **Rec:** Rich text answers are **manual-graded only** in Phase 3. AI/keyword-assisted scoring is Phase 4+. L11 defines the answer **shape**; the grading workflow is the RBAC ADR's GRADING-M1.
- **Sub-question:** does a rich-text answer carry word/char counts for the grader? (Rec: yes, as derived metadata, not stored.)

### Q5 — Answer versioning + integrity for large payloads
- **Evidence:** Versioning exists (`version`, `clientSeq`); integrity does not (S8 §6). Large payloads make the whole-array rewrite (S8 §5.2) more expensive.
- **Rec:** Rich text answers reuse the L4 protocol (version + hash). The grillme must confirm L11 sits **on top of** L4's decisions, not parallel.
- **Sub-question:** does a rich-text save send the **full** blob each time, or deltas? Rec: full blob (simpler, idempotent); deltas add a diff engine.

### Q6 — Frontend editing surface
- **Evidence:** No WYSIWYG input exists today (S3b §10.2 item 5). The candidate needs a rich editor.
- **Rec:** L11 picks **one** editor (e.g. a Markdown editor with preview, or TipTap/Quill) and defines the contract: output format, max length, allowed marks. The editor is a Phase 3 component under the L8 UI contract.
- **Sub-question:** offline/LAN constraint — is the editor a bundled library (no CDN)? (Rec: yes — LAN/on-premise, no external deps.)

### Q7 — Word limit / constraints
- **Evidence:** Today's `validateScore` bounds scores (S3b §6.3); no answer-length constraint exists.
- **Rec:** L11 defines per-question constraints (max chars / max words / none) enforced at save time (L4 Q5 per-type refinement). Over-limit answers rejected at save, not silently truncated.
- **Sub-question:** does the constraint live on the Question or the ExamAttempt's question snapshot? (Rec: Question, snapshotted.)

### Q8 — Drawing / attachment (if in scope)
- **Evidence:** No attachment/drawing infra exists. If in scope, this is the largest L11 sub-question.
- **Rec:** If drawing is in scope: stored as SVG or PNG data (not a third-party service), integrity-hashed, rendered via `<img>`/`<svg>` with sanitization. Attachments: local object storage only (LAN constraint).
- **Sub-question:** confirm drawing is Phase 3 before designing — if not, this question is deferred.

---

## L13 — Exam Lifecycle State Model

> **Evidence base:** `audit-current-events.md` §2.5 (exam lifecycle audit actions
> incl. dynamic `exam.<transition>`), role-checks audit §3.3 (exam routes),
> `enums.ts` ExamStatus. Note: a state machine **already exists**
> (`publishExam`, `closeExam`, etc. commands per AGENTS.md "Exam is not CRUD").
> L13 is about **formalizing/documenting** it, not building from scratch.

### Q1 — Is there a state machine today, or scattered commands?
- **Evidence:** AGENTS.md states "Exam is not CRUD: all state changes go through command functions (`publishExam`, `startAttempt`, etc.) — never mutate status directly." ExamStatus enum + audit actions (`exam.publish`, `exam.close`, `exam.cancel`, `exam.archive`, dynamic `exam.<transition>`) exist (S6 §2.5).
- **Rec:** A state machine **exists in spirit** (command functions + status enum). L13's job is to produce a **formal state diagram** + transition table, not invent one. Audit the commands to extract the legal transitions.
- **Sub-question:** are the command functions the single source, or is there status mutation elsewhere? (Rec: grep for direct status writes.)

### Q2 — Full state set + terminal states
- **Evidence:** ExamStatus (`enums.ts:144-153` per RBAC ADR) — draft/published/open/closed/archived/cancelled (approximate; verify in `enums.ts`).
- **Rec:** L13 enumerates the exact set, marks terminal states (archived, cancelled), and defines which transitions are **irreversible** (archive, delete).
- **Sub-question:** is `cancelled` terminal, or can a cancelled exam be revived? (Rec: terminal.)

### Q3 — Transition legality vs. permission (the RBAC invariant)
- **Evidence:** The RBAC ADR's cross-cutting invariant + §22.3: every transition needs **permission + state guard**. L13 provides the state guard half.
- **Rec:** L13's state diagram is the **state-guard authority** the RBAC ADR references. Each transition row says "legal from states X/Y, illegal otherwise." L13 + RBAC ADR are complementary, not overlapping.
- **Sub-question:** does L13 own the diagram, or does it live in the RBAC ADR's §22.3 matrix? (Rec: L13 owns the **exam** lifecycle; RBAC ADR §22.3 cross-references it.)

### Q4 — Dynamic `exam.<transition>` audit actions
- **Evidence:** `reconciliation.ts:51` emits **dynamic** `exam.${transition}` (e.g. `exam.open`, `exam.closed`), double-transition emits both (S6 §2.5).
- **Rec:** L13 enumerates the **closed set** of transitions; the dynamic audit action is reconciled to that set. No free-form transition names.
- **Sub-question:** is the dynamic emission a smell to fix, or intentional for the reconciliation path? (Rec: enumerate it; keep dynamic emission but bound it to the closed set.)

### Q5 — Exam lifecycle vs. attempt lifecycle (boundary)
- **Evidence:** Exam has a lifecycle; attempts (per exam) have their own (`AttemptStatus`, S6 §2.7). Closing an exam should affect open attempts.
- **Rec:** L13 defines the **interaction**: `exam.close` triggers handling of in-progress attempts (force-submit? grace period?). Today's behavior must be audited and documented as part of the diagram.
- **Sub-question:** does `exam.archive` require all attempts terminal first? (Rec: yes — archive is post-close.)

### Q6 — Result publication as a lifecycle concern
- **Evidence:** `exam.publish_results` is a distinct action (S6 §2.5); `ResultPublicationMode` (immediate/after_grading/manual) governs candidate visibility (RBAC ADR §Candidate Own-Scope).
- **Rec:** L13 decides whether result-publication is part of the **exam** state machine (a transition) or a **parallel** flag. Rec: parallel flag (publication is orthogonal to lifecycle status), but the diagram shows the dependency (publish_results requires grading complete).
- **Sub-question:** can results be unpublished after publication? (Rec: no — audit-only, irreversible for trust.)

### Q7 — Extend time / window changes
- **Evidence:** `exam.extend` (exam-level window extend, S6 §2.5) and `attempt.extendTime` (per-attempt, S6 §2.8) are distinct.
- **Rec:** L13 clarifies: `exam.extend` modifies the exam window (a lifecycle-adjacent mutation, not a status transition); `attempt.extendTime` is per-attempt. Both audited; only the exam-level one is an L13 concern.
- **Sub-question:** can an exam window be extended after `exam.close`? (Rec: no — closed is closed.)

### Q8 — State diagram artifact + tests
- **Evidence:** No single diagram exists; transitions are implied by commands.
- **Rec:** L13's output is (a) a Mermaid/XState state diagram in `docs/phase3/`, (b) a transition table, (c) a test that asserts every illegal transition is rejected by the command layer. The test is the regression net.
- **Sub-question:** model-based tests (XState) or enumerated assertion tests? (Rec: enumerated first — the command layer already enforces.)

---

## L14 — Result Visibility / Release Policy

> **Evidence base:** `audit-current-grading-api.md` §9 (GradingStatus), §1.2
> (response includes gradingStatus), role-checks audit §4.2 (scores
> role-conditional visibility), RBAC ADR §Candidate Own-Scope Policy. The
> `ResultPublicationMode` enum already exists; L14 formalizes the **policy**.

### Q1 — Publication modes (already exist) — what's left to design?
- **Evidence:** `ResultPublicationMode` = immediate / after_grading / manual (`enums.ts:115-121` per RBAC ADR). `exam.publish_results` action exists (S6 §2.5). Scores route has role-conditional visibility (`scores.ts:80,209`, role-checks §4.2).
- **Rec:** The **mechanism** exists; L14 designs the **policy edge cases**: re-grading after publication, partial publication, candidate re-take visibility. L14 is policy + contract, not infrastructure.
- **Sub-question:** is the current 3-mode set sufficient, or do deployments need per-candidate release?

### Q2 — Re-grade after publication
- **Evidence:** Manual grading can re-grade (`gradingQueue.ts` re-grade overwrites, S3b §7.1). If a result is already published and the score changes, what does the candidate see?
- **Rec:** L14 decides: re-grade after publication **bumps a version** + re-publishes (candidate sees updated score with an audit trail), OR locks published results (re-grade only before publication). Rec: lock-before-publish, versioned-republish-after.
- **Sub-question:** does the candidate see a "your score was updated" notification, or just the new number?

### Q3 — Candidate visibility gate (permission AND state)
- **Evidence:** Candidate sees own score only if published (`scores.ts:209`, role-checks §4.2) AND has `score.own.view` (RBAC ADR §Candidate Own-Scope). This is the RBAC≠state invariant in action.
- **Rec:** L14 documents the **dual gate**: publication state (exam-level) AND result-publication mode (exam config) AND candidate own-scope. A candidate sees a result iff all three allow.
- **Sub-question:** does `immediate` mode bypass the publication gate entirely, or just set it to "published at submit"?

### Q4 — Review / appeal flow
- **Evidence:** No appeal flow exists today. The phase-roadmap implies "review process" (复核流程) for Phase 3.
- **Rec:** L14 decides if Phase 3 includes an **appeal** state (candidate requests review → grader re-checks). Rec: minimal — a candidate can request re-check (an audit event), but the grade doesn't change unless the grader re-grades. Full appeal workflow is Phase 4.
- **Sub-question:** is "request re-check" a Phase 3 in-scope item per the roadmap, or deferred?

### Q5 — Score breakdown visibility
- **Evidence:** Grading detail returns per-question scores (S3b §1.2); candidate ResultPage shows the total (audit-runtime — verify what's shown).
- **Rec:** L14 defines **what the candidate sees**: total only, total + pass/fail, or per-question breakdown. Rec: configurable per exam (a `resultDetailMode`), default total-only for privacy of the question bank.
- **Sub-question:** does showing per-question breakdown leak the standard answer? (Rec: show candidate's answer + correctness, not the standard answer, unless configured.)

### Q6 — Re-take visibility
- **Evidence:** Multiple attempts per exam are supported (`ExamAttempt` is the core entity per AGENTS.md). `ExamEnrollment` tracks final score by `scoreStrategy`.
- **Rec:** L14 defines whether a candidate sees **all** attempts or only the "selected" one (per `scoreStrategy`). Rec: candidate sees all own attempts + which is selected; admin sees all.
- **Sub-question:** does a re-take reset publication (re-publish needed), or does publication persist across attempts?

### Q7 — Publication audit + privacy
- **Evidence:** `exam.publish_results` audits (S6 §2.5); candidate viewing own result — is it audited?
- **Rec:** Per the RBAC ADR AUDIT-M2, sensitive reads audit. L14 decides if **candidate viewing own result** is a sensitive read (Rec: no — it's the candidate's own data, low-sensitivity; don't audit every view, only publication/re-grade).
- **Sub-question:** is bulk result export (admin) audited? (Rec: yes — `export_scores` exists.)

### Q8 — Release policy contract artifact
- **Evidence:** No single policy doc exists; behavior is scattered across `ResultPublicationMode`, `scores.ts`, RBAC ADR.
- **Rec:** L14's output is a **policy matrix** (mode × visibility × role → what's shown) + the audit events for each transition (publish, re-grade, re-publish). The matrix is the grillme's forcing function.
- **Sub-question:** is the policy deployment-configurable (org settings) or per-exam only? (Rec: per-exam, with org-level defaults.)

---

# 3. Cross-Job Dependencies (grillme ordering)

> The grillme skill walks one job at a time, but jobs have dependencies. This
> section is the **recommended grillme order**, derived from the evidence above.

```txt
Round 1 (substrate — do first):
  L4 Answer Protocol v2          → produces: protocol spec + content hash decision
  L5 WYSIWYG Submit Barrier      → DEPENDS ON L4; produces: final-answer barrier ADR

Round 2 (on top of the substrate):
  L13 Exam Lifecycle State Model → independent; produces: state diagram (RBAC ADR references it)
  L14 Result Visibility Policy   → depends on L13 (publication is a lifecycle concern)
  L11 Subjective Answer Arch     → DEPENDS ON L4 (storage/integrity) + L8 (editor contract)

Round 3 (frontend + taxonomy — do last):
  L6 Frontend State Machine      → depends on L4/L5 (submit barrier) + L8 (contract)
  L8 UI Contract                 → depends on the RBAC ADR (capability-aware nav) — already available
  L9 Event Taxonomy              → independent; produces: event registry + channel rules

Round 4 (infra — independent, schedule by need):
  L10 E2E Parallelization        → likely "more shards" (Option B), code change only if needed
```

**Hard dependencies (must not invert):**
- L5 **after** L4 (barrier needs the hash).
- L14 **after** L13 (publication is lifecycle-coupled).
- L6 **after** L4+L5 (the submit UI state machine must model the barrier).
- L11 **after** L4 (rich answers reuse the protocol).

**Already-resolved inputs (no grillme needed):**
- L1/L2/L3/L7/L12 → Scoped RBAC ADR (`role-permission` worktree).

---

# 4. File Inventory

| File | Role |
|------|------|
| `docs/phase3/audit/audit-current-answer-payload.md` (S8) | L4/L5 evidence |
| `docs/phase3/audit/audit-current-candidate-runtime.md` (S7) | L6 evidence |
| `docs/phase3/audit/audit-current-grading-api.md` (S3b) | L11/L14 evidence |
| `docs/phase3/audit/audit-current-role-checks.md` (S3) | L1/L2/L7/L12 evidence (DEFERRED) |
| `docs/phase3/audit/audit-current-events.md` (S6) | L9 evidence |
| `docs/phase3/audit/audit-current-redis.md` (S5) | M2/L9 monitoring evidence |
| `docs/phase3/audit/audit-e2e-parallelization.md` (S9) | L10 evidence |
| `docs/phase3/plan.md` | Phase 3 S/M/L authority + batch order |
| `docs/phase3/job-cards.md` §S10 | This job card (acceptance: ≥8 Q per Large) |
| `docs/phase3/rbac/adr-scoped-rbac-architecture.md` (`role-permission` worktree) | Resolves L1/L2/L3/L7/L12 |
| `docs/ui/*` | L8 evidence (existing UI constitution) |
| `docs/SPEC.md` §3.5 + `phase-roadmap.md` §173-216 | Phase 3 authority boundaries |
