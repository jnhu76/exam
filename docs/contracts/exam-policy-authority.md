# P7-M1 Exam Policy Authority & Validation

**Status:** READY FOR HUMAN REVIEW
**Program:** P7-M1 — Exam policy schema + conflict validator
**Baseline (`origin/master`):** `48c3e8d6`
**Branch:** `feat/p7-m1-exam-policy-schema`

This document is the design/audit authority for P7-M1. It records the policy
authority map, the supported/latent/future matrix, the conflict rules, and the
publication freeze contract that the implementation must honor. It is binding
input for P7-M2 (profile templates + resolution).

P7-E0 is CLOSED. Its central conclusion is binding here:

> Exam policy currently freezes through **two different mechanisms** — (1) true
> immutable snapshots/copies, and (2) immutable published Exam-row authority.
> These must NOT be conflated.

---

## 1. Executive conclusion

P7-M1 introduces **one typed exam-policy representation** and **one canonical
cross-field conflict validator**, and routes create/update/publish through them.
It deliberately does **not** add new database columns, a resolved-policy JSON
blob, profile/template persistence, or any new Attempt snapshot fields.

The authority model M1 codifies (and does not change):

```text
Published Exam row  =  Exam-wide policy authority (frozen at publish)
        ↓
   Attempt creation derives ONLY attempt-local execution facts:
     - questionSnapshot (copied)
     - deadlineAt (derived from duration)
     - interruptionTimingPolicySnapshot (validated copy)
     - submittedAnswers (at submit)
        ↓
   Exam-level policy (result mode, retake, score strategy, passing score,
   control flags) is read LIVE from the immutable published row — NOT copied
   per-attempt.
```

The canonical validator centralizes cross-field checks that are today scattered
across Zod refinements, route handlers, and inline `publishExam` guards — and
closes three real gaps: `openAt < closeAt` on create/update, interruption-policy
re-validation at publish, and `max_attempts` ↔ `maxAttempts` sanity. It does not
invent rules for unimplemented dimensions (device binding, admission queue,
proctoring levels) — those are explicitly P7-M2+.

**No DB migration. No profile persistence. No generic rule engine.**

---

## 2. Baseline and methodology

Baseline `48c3e8d6` (origin/master, clean). Evidence gathered by reading the full
schema (`packages/db/src/schema/pg.ts`), contracts (`packages/contracts/src/exam.ts`,
`interruption.ts`), engine commands (`examCommands.ts`, `attemptCommands.ts`,
`grading.ts`, `interruptionPolicy.ts`), routes (`apps/api/src/routes/exam.ts`), and
frontend consumers (`apps/web/src`). Authority docs read: AGENTS.md, P7-E0 audit,
P7 roadmap, state-and-authority, ADR-005/006/008/013/014/015.

---

## 3. Current policy inventory

Every `exams` column that functions as policy/config (`packages/db/src/schema/pg.ts:223-325`):

| Field | DB type | Nullable | Default | DB CHECK |
| --- | --- | --- | --- | --- |
| `status` | text | no | — | none (runtime) |
| `timing_mode` | text | no | — | none |
| `duration_minutes` | integer | no | — | none (Zod `.positive()`) |
| `open_at` / `close_at` | timestamptz | no | — | none (ordering only in `publishExam`) |
| `passing_score` | double | no | — | `>= 0`, `<= total_score` |
| `total_score` | double | no | — | `> 0` |
| `question_selection_mode` | text | no | — | none |
| `question_ids` | jsonb[] | no | — | none |
| `question_snapshot` | jsonb | no | — | none (built at publish) |
| `control_flags` | jsonb | no | — | none |
| `retake_policy` | text | no | — | none |
| `score_strategy` | text | no | — | none |
| `max_attempts` | integer | no | — | none (Zod `.min(1)`) |
| `latest_start_offset_minutes` | integer | **yes** | — | `>= 0` |
| `min_submit_after_start_minutes` | integer | **yes** | — | `>= 0` |
| `result_publication_mode` | text | no | `"immediate"` | none |
| `results_published_at` | timestamptz | yes | — | none (write-once) |
| `interruption_time_policy` | text | no | `"strict"` | `IN (strict,bounded_grace,operator_incident)` |
| `interruption_grace_per_incident_seconds` | integer | yes | — | caps XOR rule |
| `interruption_grace_per_attempt_seconds` | integer | yes | — | caps XOR rule |

**`control_flags` jsonb** (`packages/domain/src/types.ts:212-223`): `shuffleQuestions`,
`shuffleOptions`, `detectTabSwitch`, `disableCopyPaste`, `requireQueue`,
`batchSize`, `batchInterval`, `restrictIp`, `requireLockdown`, `showResultImmediately`
(legacy input, superseded by `result_publication_mode`).

---

## 4. Supported / latent / future matrix

| Dimension | Current fields | Authoring | Runtime | Freeze owner | M1 representation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Timing | `timing_mode` (`timed_window` only) | yes (Zod literal) | `startOrRestoreAttempt` window guard | published row | `timing` | **SUPPORTED** (`timed_window` only) |
| Duration | `duration_minutes` | yes | derived into `attempt.deadline_at` at creation | published row → derived attempt fact | `timing` | **SUPPORTED** |
| Schedule | `open_at`/`close_at` | yes | window guards; schedule editable post-publish | published row (operational exception) | `timing` | **SUPPORTED** |
| Passing/total score | `passing_score`/`total_score` | yes | grading (`grading.ts:273,158`) | published row | `grading` | **SUPPORTED** |
| Question selection | `question_selection_mode` (`manual` only) + `question_ids` | yes | `buildQuestionSnapshot` at publish | publish snapshot | `questions` | **SUPPORTED** (`manual` only) |
| Retake | `retake_policy` + `max_attempts` | yes | attempt eligibility + enrollment completion (`grading.ts:68,69`) | published row | `attempt` | **SUPPORTED** (3 policies) |
| Score strategy | `score_strategy` | yes | `finalizeTerminalGrading` (`grading.ts:324`) | published row | `attempt` | **SUPPORTED** |
| Result publication | `result_publication_mode` | yes | candidate result view (`scores.ts:216`) | published row | `results` | **SUPPORTED** |
| Interruption | `interruption_time_policy` + 2 caps | yes | attempt snapshot + restore evaluation | **attempt snapshot** (frozen at creation) | `interruption` | **SUPPORTED** |
| Late start / min submit | `latest_start_offset_minutes`/`min_submit_after_start_minutes` | yes | attempt-start gate / submit gate | published row | `timing` | **SUPPORTED** |
| Shuffle | `control_flags.shuffleQuestions`/`shuffleOptions` | yes (UI checkbox) | **none** — engine never shuffles | n/a | `control` | **LATENT** (stored, not enforced) |
| Tab-switch detect | `control_flags.detectTabSwitch` | yes (UI checkbox) | client **warning banner only** (`StartExamPage:204`); TakeExam listener runs unconditionally | n/a | `control` | **LATENT** (client hint, not enforcement) |
| Copy/paste disable | `control_flags.disableCopyPaste` | yes (UI checkbox) | client **warning banner only** (`StartExamPage:215`) | n/a | `control` | **LATENT** (client hint) |
| Queue admission | `control_flags.requireQueue`+`batchSize`+`batchInterval` | yes (UI checkbox) | **none** at runtime | n/a | `control` | **LATENT** (Phase 2) |
| IP restriction | `control_flags.restrictIp` | yes (UI checkbox) | **none** | n/a | `control` | **NOT IMPLEMENTED** |
| Lockdown | `control_flags.requireLockdown` | yes (UI checkbox) | **none** | n/a | `control` | **NOT IMPLEMENTED** (Phase 2 desktop) |
| `showResultImmediately` | `control_flags.showResultImmediately` | legacy input | coerced to `result_publication_mode` at create/update | n/a | (deprecated) | **DEPRECATED** (legacy input only) |
| Identity / device binding / managed desktop / admission codes / proctoring levels | — | — | — | — | — | **NOT IMPLEMENTED** (P7-M2+ roadmap) |
| `untimed` / `timed_sync` / `deadline` timing | enum values exist | blocked (Zod literal) | — | — | — | **NOT IMPLEMENTED** (Phase 2) |

**"LATENT"** = code/schema exists and is authorable but the runtime does not enforce it. The M1 validator must **not** invent conflict rules for latent dimensions, but it SHOULD record this gap (§13, §15).

---

## 5. Authority-layer model

```text
Layer A — Profile/template defaults    [P7-M2; NOT IMPLEMENTED in M1]
    editable, reusable, NOT execution authority

Layer B — Published Exam Policy Authority   [the main authority]
    Exam-wide semantics frozen at publish.
    Physical store: the existing typed `exams` columns.
    No separate `resolved_policy` blob (§8 decision).

Layer C — Attempt Execution Snapshot   [only where justified]
    Copied/derived attempt-local execution facts (§7).
```

Core rule (binding): **freeze policy at the authority layer that owns the semantic decision.** Do not snapshot everything everywhere.

---

## 6. Published-row freeze vs true snapshots

Two distinct freeze mechanisms — do NOT conflate (P7-E0 P2-M1):

| Mechanism | Examples | Authority | Source-of-truth at runtime |
| --- | --- | --- | --- |
| **True snapshot** (copied/derived immutable) | `question_snapshot` (publish + attempt copy); `interruptionTimingPolicySnapshot` (attempt); `deadline_at` (derived); `submitted_answers` (submit) | the snapshot column | the snapshot (later exam edits do not affect it) |
| **Published-row immutability** | `result_publication_mode`, `retake_policy`, `score_strategy`, `passing_score`, `total_score`, `max_attempts`, `control_flags`, timing mode | published `exams` row (route guard) | live-read the immutable published row |

Both are freeze. They are **not** the same mechanism. The runtime is safe today because (a) true snapshots decouple attempt execution from later exam edits, and (b) the published-edit route guard (`exam.ts:631`: published rejects all fields except `openAt`/`closeAt`) makes the live-read fields immutable post-publish.

**This distinction is the key P7-M2 input:** a future profile/template edit must resolve into Exam-owned published policy at publish time — never live-reference a mutable template. M1 freezes the seam (§14) so M2 becomes "template persistence + resolution before publish," not an engine rewrite.

---

## 7. Attempt snapshot justification table

Only three policy-bearing payloads are frozen into the attempt at creation
(`packages/exam-engine/src/attemptCommands.ts:248-261`):

| Frozen value | Why it must be attempt-local | Source |
| --- | --- | --- |
| `questionSnapshot` | depends on attempt creation time (the publish snapshot); must survive later exam edits; immutable per-attempt evidence | copied from `exam.questionSnapshot` (itself frozen at publish) |
| `deadlineAt` | **derived** from `start + durationMinutes`; must be stable for this attempt; immutable independently of other attempts | `calculateDeadlineAt(now, exam.durationMinutes)` (`timer.ts:1-7`) |
| `interruptionTimingPolicySnapshot` (4 cols) | interruption decisions must remain stable for this attempt (ADR-013); a mid-attempt exam edit must not change an existing attempt's outcome | `resolveAttemptTimingPolicySnapshotFromExam(exam)` (fail-closed) |
| `submittedAnswers` (at submit) | submission creates terminal answer evidence (ADR-008) | frozen in submit transaction |

**Deliberately NOT copied to the attempt** (read live from the immutable published row):

| Field | Why it is NOT attempt-local |
| --- | --- |
| `result_publication_mode` | Exam-level publication policy, not per-attempt execution fact |
| `retake_policy` / `max_attempts` | Exam/Enrollment aggregation semantics (span multiple attempts) |
| `score_strategy` | Enrollment aggregation across attempts (selects among attempts) |
| `passing_score` / `total_score` | Exam-level grading policy; grading reads `exam.*` (`grading.ts:273,158`) |
| `control_flags` | not consumed by the engine at all (§13); no enforcement to freeze |
| `latest_start_offset_minutes` / `min_submit_after_start_minutes` | applied as gates at creation/submit; no per-attempt immutable need |

"Runtime reads the value" is NOT sufficient reason to copy it. Each frozen
field above has an explicit semantic justification.

---

## 8. Resolved policy schema

M1 introduces a typed **value** — `ResolvedExamPolicy` — as a semantic projection of the published exam row. It is **not** new persistence.

```text
Exam row
   ↓
resolveExamPolicy(exam)
   ↓
ResolvedExamPolicy   (typed value; used by the validator)
```

This provides the M2 seam (`profile defaults + exam overrides → resolver`) without making runtime consumers depend on mutable profile rows. **A `ResolvedExamPolicy` TypeScript value does NOT justify a `resolved_policy jsonb` column** (§14 decision: Option A — existing typed columns remain authority).

The shape groups policy by real semantic ownership, not by a fantasy 14-dimension roadmap. Only groups with real current members exist; empty future abstractions are forbidden.

---

## 9. Conflict rules (canonical validator scope)

Only rules for **currently supported** combinations. Future dimensions (§12) are excluded.

| Rule | Code | Status today | M1 owner |
| --- | --- | --- | --- |
| `open_at < close_at` | `EXAM_WINDOW_INVALID` | publish-only (`publishExam:123`) — **gap on create/update** | canonical validator (all paths) |
| `duration_minutes > 0` | (shape) | Zod + publish | Zod shape (unchanged) |
| `passing_score >= 0 && passing_score <= total_score` | `PASSING_SCORE_EXCEEDS_TOTAL` | 3 places (Zod create, Zod update-both, route merged, publish-vs-sum) | canonical validator (dedupe; publish keeps vs-sum check) |
| `total_score > 0` | (shape) | Zod + DB CHECK | Zod/DB (unchanged) |
| `retake_policy ∈ {unlimited, max_attempts, pass_then_stop}` | (enum) | Zod literal + publish | Zod (unchanged) |
| `retake_policy === "max_attempts"` ⇒ `max_attempts` is meaningful (≥1; present) | `RETAKE_MAX_ATTEMPTS_INVALID` | **nowhere** — gap | canonical validator |
| `question_selection_mode === "manual"` | (enum) | Zod literal + publish | Zod (unchanged) |
| `timing_mode === "timed_window"` | (enum) | Zod literal + publish | Zod (unchanged) |
| `latest_start_offset_minutes >= 0` | (shape/DB) | Zod + DB CHECK | unchanged |
| `min_submit_after_start_minutes >= 0` | (shape/DB) | Zod + DB CHECK | unchanged |
| interruption policy cross-field (strict/op_incident ⇒ caps null; bounded_grace ⇒ both caps > 0; per-incident ≤ per-attempt) | `INVALID_INTERRUPTION_POLICY_*` | `validatePolicyCaps` (create Zod + route; **not publish**) | canonical validator (incl. publish revalidation) |
| `result_publication_mode ∈ {immediate, after_grading, manual}` | (enum) | Zod | Zod (unchanged) |

**Rules explicitly NOT added in M1** (unimplemented dimensions — §12): untimed+deadline-auto-submit, mobile+managed-desktop, anonymous+named-enrollment, monitoring+proctor-incident, multi-session+single-device. These are P7-M2+; no fake enums to reject combinations the system cannot create.

---

## 10. Validation ownership

| Layer | Owns |
| --- | --- |
| **contracts (Zod)** | per-field shape, enum narrowing (Phase-1 literals), `.min()`/`.max()`, defaults. Keep as-is. |
| **canonical validator (`exam-engine`)** | cross-field semantic conflicts (§9). Pure, deterministic, no DB/time/env. |
| **route adapters** | resource existence (course/question), legacy `resultPublicationMode` coercion, HTTP error mapping. |
| **`publishExam`** | resource-integrity checks that need DB facts (question existence, standardAnswer/rubric presence, totalScore == sum). Calls the canonical validator for policy semantics. |
| **DB CHECK** | structural invariants (caps XOR, score bounds). Unchanged. |

Each validation rule has **one** canonical semantic owner. Shape stays in Zod; cross-field semantics move to the canonical validator; resource integrity stays in publish orchestration; DB CHECKs are the last line.

---

## 11. Publication freeze contract

```text
draft Exam policy
    ↓
canonical validation (create/update already validated; publish revalidates whole policy)
    ↓
question snapshot materialization (buildQuestionSnapshot)
    ↓
resource-integrity checks (standardAnswer/rubric, totalScore == sum)
    ↓
status = published
    ↓
Published Exam policy is execution authority
```

After publish, the only supported operational mutation is schedule (`openAt`/`closeAt`), audited as `exam.published_schedule_updated`. No other policy field is mutable post-publish (route guard `exam.ts:631`).

A future M2 profile resolver feeds this same boundary — it must NOT become a runtime dependency. Runtime/attempt/grading consume the published exam row, never a profile/template.

---

## 12. Schedule mutation exception

`openAt`/`closeAt` are editable post-publish (schedule only). This is a **supported post-publish operational mutation**, not a snapshot. Modeled explicitly so "published immutable" does not mean "absolutely no mutation."

- Owner: UPDATE route (`exam.ts:631-647`), audited as `exam.published_schedule_updated`.
- Existing attempts: their `deadline_at` is already frozen (derived at creation); a schedule edit does not retroactively change existing attempt deadlines. `close_at` remains the hard upper bound for operator time grants and is read live under `FOR UPDATE` at restore.
- M1 does **not** redesign schedule handling. No new validation beyond the canonical `open_at < close_at` (which a schedule edit must still satisfy).

---

## 13. control_flags enforcement reality

A JSON bag is not a coherent policy schema. Per-flag audit:

| Flag | Authorable? | Persisted? | Consumed? | Enforced? | Classification |
| --- | --- | --- | --- | --- | --- |
| `shuffleQuestions` | yes (UI) | yes | **no** — engine never shuffles (`buildQuestionSnapshot` is deterministic) | no | LATENT — stored, not enforced |
| `shuffleOptions` | yes (UI) | yes | **no** | no | LATENT |
| `detectTabSwitch` | yes (UI) | yes | client **warning banner** (`StartExamPage:204`); `TakeExamPage` listener runs unconditionally | client hint only | LATENT — not server-enforced |
| `disableCopyPaste` | yes (UI) | yes | client **warning banner** (`StartExamPage:215`) | client hint only | LATENT — not server-enforced |
| `requireQueue` | yes (UI) | yes | **no** runtime queue consumer | no | LATENT — Phase 2 |
| `batchSize` / `batchInterval` | yes (UI) | yes | only meaningful if `requireQueue` (which is latent) | no | LATENT |
| `restrictIp` | yes (UI) | yes | **no** | no | NOT IMPLEMENTED |
| `requireLockdown` | yes (UI) | yes | **no** | no | NOT IMPLEMENTED (Phase 2 desktop) |
| `showResultImmediately` | legacy input | yes (coerced) | coerced to `result_publication_mode`; response field of same name is unrelated | deprecated | DEPRECATED |

**M1 action on control_flags:** NONE structural. Do NOT refactor into many DB columns. Typed domain parsing over the existing JSON is sufficient. The validator does not add conflict rules for latent flags.

**Findings recorded (not fixed in M1):**

- **P2-CF-1:** `shuffleQuestions`/`shuffleOptions` are authorable and persisted but **never enforced** — a candidate authoring "shuffle on" gets no shuffle. This is a product-integrity gap (authoring promises behavior the engine does not provide). Recorded for a separate follow-up; M1 does not implement shuffle.
- **P2-CF-2:** `detectTabSwitch`/`disableCopyPaste` are presented as control flags but are **client hints only** (warning banner; no enforcement). The UI should not imply server enforcement. Recorded separately.
- **P2-CF-3:** `restrictIp`/`requireLockdown` are authorable but have **zero** runtime effect — a candidate can enable them and get no restriction. Recorded separately.
- **P2-CF-4:** `showResultImmediately` is a deprecated legacy input that still appears in the authoring UI and persists a stale value. Recorded separately.

These are **not** M1 scope (§45 non-goals). They are recorded so a future truthfulness pass can decide whether latent flags should fail validation, be hidden from authoring, or be implemented.

---

## 14. Future P7-M2 resolver contract (the seam M1 leaves)

M1 success = M2 becomes "template persistence + resolution before publish," not an engine rewrite. The contract M1 freezes:

```text
[P7-M2]  profile/template defaults   (editable, reusable, NOT execution authority)
       +
         per-exam overrides
       ↓
         resolve  →  ResolvedExamPolicy (the typed value M1 introduces)
       ↓
         canonical validate
       ↓
         publish writes/finalizes existing typed Exam columns
       ↓
         published row immutable = execution authority
```

**Hard M2 acceptance conditions (frozen by M1):**

- Runtime engine does NOT load a profile/template to execute a published exam.
- Attempt start consumes Exam authority only (no profile resolver).
- Grading consumes Exam authority / Attempt evidence only.
- A profile/template change after publish MUST NOT affect a published exam or active attempt.

M1 cannot test a table that does not exist, but it freezes the interface: attempt start consumes Exam authority; grading consumes Exam authority; the canonical validator runs on a resolved value, not a template reference.

---

## 15. P0 / P1 / P2 / P3 findings

**P0:** 0.

**P1:** 0. No currently-supported policy combination can reach publish and violate correctness — `publishExam`'s inline guards currently catch the supported-set conflicts (just not centrally). M1 centralizes without changing the safety floor.

**P2:**

- **P2-1 (validator gaps):** `open_at < close_at` is enforced only at publish (create/update accept inverted windows silently); interruption-policy cross-field rules are not re-checked at publish; `max_attempts` policy has no sanity check vs `maxAttempts`. M1 **fixes** these (they are the canonical validator's reason to exist). Evidence: `publishExam:123` (only openAt check); `validatePolicyCaps` absent from `publishExam`; no maxAttempts check anywhere.
- **P2-CF-1..4:** latent/unenforced control flags (§13). Recorded; **not fixed in M1**.

**P3:**

- **P3-1:** `passingScore <= totalScore` exists in 4 places with drifting semantics. M1 dedupes to the canonical validator (publish keeps the vs-sum check).
- **P3-2:** `showResultImmediately` dual-read state (legacy input + unrelated response field). Recorded.

---

## 16. Explicit non-goals (M1 MUST NOT)

NO profile/template persistence · NO profile CRUD API/UI · NO exam creation wizard · NO org default profile · NO system settings store · NO config control plane · NO generic resolved-policy JSON blob · NO policy versioning · NO policy DSL · NO generic rule engine · NO expression evaluator · NO feature-flag system · NO dynamic active-attempt policy mutation · NO new timing modes · NO admission queue · NO Redis expansion · NO device binding · NO proctoring expansion · NO browser lockdown · NO new Attempt snapshot fields (result mode/retake/score strategy stay live-read) · NO control_flags refactor into DB columns · NO implementation of latent flags (shuffle/IP/lockdown).

---

## 17. Verification evidence

- **Canonical validator unit tests** — `packages/exam-engine/src/examPolicy.test.ts`
  (26 tests): valid baselines (default, bounded_grace, operator_incident,
  max_attempts); each supported conflict (window, passing>total, max_attempts
  sanity, interruption caps XOR + per-incident≤per-attempt + non-positive);
  boundary (passing === total); multi-conflict; determinism; non-mutation;
  assert-throw contract; route-layer `validateExamPolicyInput` parity with
  `validateExamPolicyForExam`.
- **Authoring + publish integration** —
  `apps/api/src/routes/examPolicyValidation.test.ts` (5 tests): create rejects
  inverted window (`EXAM_WINDOW_INVALID`) and passing>total; create accepts
  valid baseline; draft-update rejects inverted window; publish happy path.
- **Published-freeze** — unchanged invariant; existing `examCommands` +
  route-level publish/transition tests continue to pass (publish revalidates
  whole policy via `assertExamPolicyValid`).
- **Gates:** `pnpm verify:static` PASS (format, lint, copy, arch, db-config,
  env-contract, repo-contract, ui-gates, eslint, typecheck, openapi:check,
  stale-ui-docs). `pnpm test` — exam-engine 591 PASS; API suite green for the
  touched files. Full `pnpm test` run confirmed at close.

---

## 18. Adversarial review (§40 answers)

1. **Policy = the cross-field semantic combination of exam-wide rules** (timing, scoring, retake, results, interruption, submission gates). Ordinary metadata (title, description, courseId) is not policy.
2. Policy fields: timing/schedule/duration, passing/total score, question selection, retake/score-strategy/maxAttempts, result publication, interruption policy, late-start/min-submit gates, control flags. Non-policy: id, title, description, courseId, timestamps, status lifecycle.
3. Published Exam authority: result mode, retake, score strategy, passing/total score, maxAttempts, control flags, timing mode.
4. Attempt snapshots: questionSnapshot, deadlineAt, interruptionTimingPolicySnapshot, submittedAnswers — only these (§7).
5. Each exists because: depends on creation time / must survive exam edits / immutable per-attempt / terminal evidence (§7).
6. No Exam-level fact is duplicated into the attempt without need. retake/score-strategy/result-mode/passing are deliberately live-read (§7).
7. No runtime path reads mutable profile/default config. Attempt start + grading consume only the published exam row (grep-verified).
8. All published policy fields are immutable except the explicit schedule exception (§12).
9. Future profile edits cannot change a published exam — M1 freezes the seam (§14); M2 resolves into published columns, never live-references templates.
10. No supported policy conflict can reach publish — M1's canonical validator runs on create/update/publish.
11. Latent flags (shuffle/IP/lockdown/queue) are authorable but NOT presented as enforced in the validator; they are recorded as LATENT (§13).
12. Control flags promise enforcement that does not exist — recorded P2-CF-1..4, not fixed in M1.
13. One canonical semantic conflict validator: `validateExamPolicy` (§9).
14. create/update/publish all use it; publish revalidates the whole policy (§11).
15. Publish revalidates whole policy: YES.
16. Runtime does NOT repeatedly resolve settings/profile policy: correct — it reads the published row.
17. No generic rule engine: correct — a few readable functions.
18. No profiles: correct.
19. No generic JSON resolved-policy snapshot: correct — `ResolvedExamPolicy` is a typed value, not persistence.
20. M2 can add profile templates without changing execution authority: YES — the seam (§14) makes M2 "template persistence + resolution before publish."

---

P7-M1 EXAM POLICY AUTHORITY + VALIDATOR — READY FOR HUMAN REVIEW
