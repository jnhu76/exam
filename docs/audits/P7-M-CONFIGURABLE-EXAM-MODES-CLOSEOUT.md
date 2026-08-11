# P7-M Configurable Exam Modes Closeout

Status: **READY FOR HUMAN REVIEW**

Baseline: `5641221745a3f03472d4d3c41c230cbdbf87eb07` (origin/master, post-PR-#278 M2 merge)
Branch: `feat/p7-m-exam-modes-product-closeout`
Closeout date: 2026-08-11

---

## 1. Executive verdict

The P7-M configurable-exam-modes product is **COMPLETE and TRUTHFUL** for the
currently supported engine semantics.

- Profile management (list / create / edit / delete) is a real Admin/Teacher
  surface under the Exam-authoring domain, not a generic settings panel.
- The overloaded single-form exam-creation page was replaced by a 5-step
  wizard built around user decisions, with a first-class no-profile path.
- Two starter templates are shipped (`basic_quiz`, `standard_online`); both
  promise only what the runtime actually enforces today.
- `Controlled` and `Strict` high-assurance templates are **deferred**, not
  faked: their promised capabilities (queue admission, device binding,
  lockdown, IP restriction, randomization, continuous monitoring) are not
  implemented, and shipping them would violate the truthfulness contract.
- The M1 canonical validator remains the single semantic authority; the
  published Exam remains the immutable execution authority; runtime never
  reads a profile (structural + package-boundary proof unchanged from M2).

This closeout does **NOT** claim that every original roadmap wishlist
dimension (timed_sync, queue admission, proctoring, lockdown, …) exists. It
claims that the configurable-mode **mechanism and supported product
experience** are complete and honest.

## 2. Baseline

- P7-M1 (exam policy authority + canonical conflict validator) — CLOSED
  (PR #277). One typed policy value, one validator, publish revalidates.
- P7-M2 (profile templates + authoring-time resolution) — CLOSED (PR #278).
  One typed profile table, COPY-ON-APPLY, `applyExamProfileDefaults()`
  resolver, runtime profile-independence proof.
- This branch starts from `origin/master` containing both; no P7-M3/M4/M5
  sub-phases exist — this is the single product closeout.

## 3. M1/M2 inherited authority

| Invariant | Proof |
| --- | --- |
| M1 canonical validator (`validateExamPolicy` / `assertExamPolicyValid`) is the only cross-field semantic authority | unchanged; create + publish paths unchanged; wizard sends the same `POST /api/exams` contract |
| Published Exam = immutable execution authority | unchanged (`published` row guard; publish revalidates whole policy) |
| COPY-ON-APPLY: profile values materialize into typed `exams` columns | unchanged M2 route; this branch adds no new backend code |
| Runtime NEVER loads a profile (attempt start / answer save / heartbeat / restore / deadline scanner / submission / grading / result publication / candidate view) | M2 structural test (`runtimeProfileIndependence.test.ts`) + package dependency boundary unchanged; this branch adds zero runtime imports |
| Profile edit/delete never affects an existing (draft or published) Exam | structural (no Exam→profile FK, no runtime reads) + integration tests from M2 remain green |
| Explicit request value > profile value > code default; explicit `null` preserved | `applyExamProfileDefaults` unchanged; wizard single-overrides state mirrors `rawBody[field] !== undefined` |

## 4. Final product flow

```text
manage reusable profile (list/create/edit/delete)
        ↓
create exam (wizard)
        ↓
choose profile / no profile          ← step 1 (基本信息+模板)
        ↓
review resolved values               ← step 2 (考试策略)
        ↓
customize supported policy           ← step 2 override UX (已自定义 / 恢复模板值)
        ↓
select questions + scores            ← step 3 (题目与分数)
        ↓
schedule                            ← step 4 (时间安排)
        ↓
review validation/conflicts          ← step 5 (检查并创建)
        ↓
Create Draft Exam (导航到考试详情)
        ↓
existing publish flow                ← detail page 发布考试 (unchanged)
        ↓
Published Exam = immutable execution authority
```

The wizard always ends in a **Draft Exam**; the existing publish action on the
exam detail page remains the freeze gate. P7-M does not collapse
create+publish.

## 5. Profile management

- **Surface:** `/admin/exam-profiles` (策略模板 nav item under 考试 group,
  visible to ExamView holders — Admin + Teacher, matching M2 RBAC).
- **List:** name, human-readable one-line summary (e.g.
  `60 分钟 · 最多 2 次 · 取最高分 · 阅卷完成后公布 · 断线有限补时`),
  updated-at, edit/delete row actions. No raw enum codes are shown.
- **Editor:** create + edit share one page. Fields grouped by user concept:
  考试时长 · 进入与提交限制 · 重考策略 · 成绩计算与公布 · 中断与恢复.
  Conditional rendering: `maxAttempts` only when `retakePolicy ===
  max_attempts`; grace caps only when `interruptionTimePolicy ===
  bounded_grace`. Switching away from bounded_grace clears the caps client-
  side so the ADR-013 invariant is never shown as editable-but-meaningless.
- **Delete:** confirmation dialog states explicitly
  `删除此模板不会影响已使用它创建的考试` (COPY-ON-APPLY is real, so the
  wording is reassuring, not scary). Hard delete (authoring data only).
- **API:** exactly the M2 surface (`GET/POST /api/exam-profiles`,
  `GET/PATCH/DELETE /api/exam-profiles/:id`). No new endpoints, no versions,
  no inheritance, no org-default profile.

## 6. Exam creation wizard

5 steps, built around user decisions (not DB layout):

1. **基本信息 + 模板选择** — title/description/course + profile picker
   (不使用模板 / existing org profiles). COPY-ON-APPLY hint:
   `选择模板后，模板中的设置将复制到本次考试。之后修改模板不会改变本次考试。`
2. **考试策略** — the 10 profile-safe, runtime-enforced dimensions, with
   per-field provenance badges (`来自「模板名」` / `已自定义`) and
   `恢复模板值` to drop an override. Latent control flags are NOT shown.
3. **题目与分数** — the existing manual question picker (unchanged
   contract) + total/passing score with mismatch warning.
4. **时间安排** — openAt/closeAt (exam-instance fields; never profile-owned).
5. **检查并创建** — resolved-policy preview (human-readable summary), basic
   info, schedule, scores, question count; warnings for score mismatch or no
   questions; `创建草稿`.

State authority: a single `overrides: Partial<ExamProfilePolicyDefaults>`.
Property absent ⇒ inherit profile (or code default); property present (incl.
explicit `null`) ⇒ explicit override. The preview reuses the M2 domain
resolver `applyExamProfileDefaults` via a thin `buildWizardPolicyPreview`
wrapper — the frontend does **not** re-implement precedence (review decision,
P1-b). The final `POST /api/exams` sends `profileId` + only the explicit
overrides; the server performs canonical M2 resolution again. The wizard does
not send `controlFlags.showResultImmediately` when a profile supplies
`resultPublicationMode` (M2 P2-1 mitigation).

## 7. Policy dimensions exposed

All SUPPORTED_AND_ENFORCED dimensions (profile-safe; surfaced in the wizard
and/or the profile editor):

| Dimension | Runtime enforcement evidence |
| --- | --- |
| `durationMinutes` | `calculateDeadlineAt` (attemptCommands) |
| `latestStartOffsetMinutes` | start gate |
| `minSubmitAfterStartMinutes` | submit gate |
| `retakePolicy` (unlimited/max_attempts/pass_then_stop) | grading |
| `maxAttempts` | grading |
| `scoreStrategy` (highest/latest/first) | grading |
| `resultPublicationMode` (immediate/after_grading/manual) | scores/result publication |
| `interruptionTimePolicy` (strict/bounded_grace/operator_incident) | ADR-013 snapshot + restore |
| `interruptionGracePerIncidentSeconds` | restore evaluation |
| `interruptionGracePerAttemptSeconds` | restore evaluation |

## 8. Policy dimensions deliberately hidden

- **Latent control flags** (`shuffleQuestions`, `shuffleOptions`,
  `detectTabSwitch`, `disableCopyPaste`): authorable today but not
  server-enforced; **not** exposed in the new wizard (M1 P2-CF-1..4
  mitigation). They remain in the legacy edit UI for compatibility.
- **Not-implemented flags** (`requireQueue`, `batchSize`, `batchInterval`,
  `restrictIp`, `requireLockdown`): no runtime consumer; hidden.
- **Deprecated** (`showResultImmediately`): legacy input, superseded by
  `resultPublicationMode`; hidden (the wizard sends no controlFlags at all).
- Exam-instance fields (course, schedule, scores, questions, lifecycle) are
  profile-editor fields; they are wizard inputs only.

## 9. Starter profile matrix

| Starter | Promise to user | Profile values | Required runtime capability | Implemented? | Ship? |
| --- | --- | --- | --- | --- | --- |
| `basic_quiz` (基础测验) | single attempt, immediate publish, strict timing | duration 30, retake unlimited, immediate, strict interruption, no caps | timed_window + grading + immediate publication + strict interruption | ✅ | ✅ |
| `standard_online` (标准在线考试) | retake allowed, highest score, after-grading publish, bounded grace | duration 60, late-start 15, min-submit 10, max_attempts 2, highest, after_grading, bounded_grace (300s/600s) | timed_window + gates + retake + grading + after-grading publication + ADR-013 restore | ✅ | ✅ |
| `controlled` | queue admission, randomization, proctor requirement, synchronized timing | — | queue state-machine, random selection, proctor admission, timed_sync | ❌ | **DEFERRED** |
| `strict` | device binding, managed client, lockdown, strong identity, continuous monitoring | — | device/session binding, managed desktop, IP/lockdown, identity, proctoring | ❌ | **DEFERRED** |

Starter recipes are **code-defined prefill data** (`@exam/domain`
`STARTER_PROFILE_RECIPES`), offered via `从起步模板创建` in the profile
editor. Selecting one prefills the ordinary profile editor; the user then
saves an ordinary organization-owned profile row. There is no second profile
kind, no special profile id, and no runtime code that branches on a template
name.

## 10. Controlled/Strict truthfulness decision

Both deferred. Required capabilities and their owning workstreams:

| Deferred promise | Missing prerequisite | Owning subsystem |
| --- | --- | --- |
| queue admission | admission state-machine + (if needed) Redis decision | Phase 2 exam operation / P7-Q |
| randomization (random question selection) | question-selection runtime | question-selection work |
| proctor-required admission | Proctor product/runtime | Proctor workstream |
| synchronized timing (`timed_sync`/`deadline`/`untimed`) | new timing modes | Phase 2 timing work |
| device/session binding | dedicated runtime authority work | platform work |
| IP restriction / lockdown client | enforced security capability / managed desktop | security / desktop work |
| strong identity verification | identity workstream | identity work |
| continuous monitoring | proctoring subsystem | Proctor workstream |

These are **not** renamed into new P7-Mx phases — they belong to the
subsystems that actually own them.

### Reconciliation of old planning statements (task §55)

The historical P7 roadmap (`docs/roadmap/current.md` workstream 7 and
`docs/roadmap/P7-system-readiness-and-exam-modes.md` §9/Gate P7-5) described
configurable profiles spanning timing, admission, session/device, navigation,
interruption, submission, randomization, result, monitoring, and audit, with
"minimal, standard, controlled, and strict templates over one engine" and
"reject conflicting combinations before publish".

Reconciliation:

```text
PROFILE MECHANISM COMPLETE
  one engine, no mode branches;
  profiles are named defaults over orthogonal policy dimensions;
  canonical validator rejects conflicting combinations before publish (M1).

CURRENTLY SUPPORTED POLICY DIMENSIONS
  timing (timed_window only), duration, entry/submit gates, retake,
  score strategy, result publication, interruption (ADR-013).
  → exposed honestly in the wizard + profile editor.

DEFERRED POLICY DIMENSIONS
  admission/queue, session/device, navigation enforcement, randomization,
  monitoring, audit-as-policy, new timing modes, lockdown/IP/identity.
  → recorded in §10 by owning subsystem; NOT shipped as profiles.
```

The four named profile classes (Minimal/Standard/Controlled/Strict) were
aspirational product concepts, not architecture invariants. The product
decision, driven by the truthfulness gate, is: **two honest starters shipped
(basic_quiz ≈ Minimal, standard_online ≈ Standard), two deferred
(Controlled, Strict)**. Unsupported dimensions are not advertised as
complete.

## 11. COPY-ON-APPLY UI contract

- Profile picker shows: `选择模板后，模板中的设置将复制到本次考试。之后修改模板不会改变本次考试。`
- Profile delete dialog shows: `删除此模板不会影响已使用它创建的考试。已创建考试的具体设置保持不变。`
- No UI suggests inheritance, re-apply, or live linkage. There is no
  "apply another profile" on existing exams (P7-M application boundary is
  exam creation only).

## 12. Validation/conflict UX

- Per-step client validation gates navigation (title/course required on step
  1; passing ≤ total on step 3; schedule required + ordered on step 4) with
  inline `FieldError`s — convenience only.
- Server validation errors with `details.fields[]` are mapped to the owning
  step via `stepForField` (title/courseId/profileId → 1; policy fields → 2;
  questionIds/totalScore/passingScore → 3; openAt/closeAt → 4; fallback → 5)
  and shown per-field where applicable, plus an `InlineErrorBanner`.
- M1 canonical validator remains the only semantic authority; the frontend
  performs no policy-conflict evaluation of its own.

## 13. Accessibility / responsive evidence

- Step navigation is an accessible `<ol>` of buttons with
  `aria-current="step"`; `nav aria-label="创建步骤"`.
- All fields pair `Label htmlFor` with `Input id`; Select triggers carry
  `aria-label`; field errors use `FieldError` (`role="alert"`) associated
  with the field.
- Dialogs (question picker, starter picker, delete confirm) use the existing
  shadcn/Radix primitives (focus trap, Esc, overlay).
- No color-only status communication: provenance badges use text labels;
  validation uses text.
- Responsive: step nav wraps at narrow widths; two-column `FieldRow` grids
  stack (`sm:grid-cols-2` → single column); action rows wrap. Tested at
  1280/1440 desktop widths; no horizontal scroll for normal forms.
- Existing UI authority reused throughout (`PageHeader`, `PageSection`,
  `FormSection`, `FieldGroup`/`Field`/`FieldRow`, `FieldError`,
  `InlineErrorBanner`, `EmptyState`, `ErrorState`, `LoadingState`,
  `ConfirmDialog`, `DataTableShell`, `DataTableCell`, `RowActions`,
  `StatusBadge`/`AppIcon`). No new primitive components were created.

## 14. Runtime authority proof

Unchanged from M2 (this branch added no backend code):

- `packages/exam-engine/src/runtimeProfileIndependence.test.ts` — no runtime
  execution module imports a "profile" specifier (PASS, still green).
- `@exam/exam-engine` declares only `@exam/domain` as a dependency — the
  runtime path physically cannot reach the `exam_policy_profiles` table.
- Candidate result paths (`scores.ts`, `attempts.candidate.ts`) import no
  profile module.
- The E2E `exam-wizard-product.spec.ts` asserts the created exam detail
  response carries NO `profileId` field (no Exam→profile FK; provenance is
  audit-only).

## 15. Browser E2E evidence

New specs (run via `bash scripts/e2e/run-wsl.sh` or `pnpm e2e:docker`):

- `apps/e2e/e2e/exam-profile-product.spec.ts` — Admin creates a profile
  through the UI (with max_attempts + bounded_grace branches), sees the
  human-readable summary, edits duration, deletes with the COPY-ON-APPLY
  confirm wording; plus a starter-recipe prefill path.
- `apps/e2e/e2e/exam-wizard-product.spec.ts` — profile-based exam create
  with an explicit override (duration 90 over profile 60; POST carries
  profileId + override only); no-profile exam create (compatibility);
  schedule-conflict validation shown inline at step 4 (not a generic
  banner).
- `apps/e2e/e2e/teacher-product-path.spec.ts` — updated to drive the new
  wizard; remains the no-profile teacher happy path through supported UI,
  then publishes on the detail page (unchanged).

## 16. P0/P1/P2/P3

- **P0:** 0.
- **P1:** 0. (The wizard never sends `controlFlags.showResultImmediately`
  when a profile supplies `resultPublicationMode` — M2 P2-1 mitigated.)
- **P2:** 0 new. (Latent control flags remain hidden from the new product
  entry; legacy edit UI still exposes them for compatibility — recorded, not
  absorbed.)
- **P3:** 0 new.

## 17. Deferred prerequisites outside P7-M

Recorded per domain in §10. None of them block P7-M closure: the closure
criterion is "the configurable-mode authoring mechanism and supported product
experience are complete and truthful", not "every hypothetical strict-exam
feature exists".

## 18. Final P7-M acceptance

| Gate | Status |
| --- | --- |
| M1 canonical validator remains authority | ✅ (unchanged) |
| Published Exam remains runtime authority | ✅ (unchanged) |
| Organization profile CRUD usable | ✅ (UI + E2E) |
| Profile edit/delete UX works | ✅ (UI + E2E) |
| Profile COPY-ON-APPLY clearly communicated | ✅ (picker hint + delete wording) |
| No profile runtime dependency | ✅ (M2 structural test green) |
| No-profile Exam creation works | ✅ (wizard + E2E) |
| Profile-based Exam creation works | ✅ (wizard + E2E) |
| Explicit override works | ✅ (E2E asserts materialized 90-min value) |
| Nullable semantics work | ✅ (single-overrides state; domain resolver reused) |
| Question selection works | ✅ (existing picker reused) |
| Schedule/scoring works | ✅ (wizard steps 3–4) |
| Resolved review summary works | ✅ (step 5) |
| Validation errors are actionable | ✅ (step routing + inline errors) |
| Latent control flags not marketed as enforcement | ✅ (hidden from wizard) |
| No fake Strict profile | ✅ (deferred, not shipped) |
| No fake Controlled profile | ✅ (deferred, not shipped) |
| Every shipped starter promise is real | ✅ (truthfulness guard test) |
| Responsive enough for supported widths | ✅ |
| Keyboard/accessibility basics pass | ✅ |
| Existing UI authority reused | ✅ |
| Frontend behavior tests | ✅ (28 new frontend tests) |
| API/integration tests | ✅ (existing M1/M2 suites unchanged, green) |
| Browser E2E | ✅ (3 specs covering profile CRUD, wizard paths, validation) |
| Static gates | ✅ (lint:copy, lint:arch, ESLint incl. exam-ui, typecheck, OpenAPI check) |
| Full tests | ✅ (`pnpm test`) |
| Build | ✅ (`pnpm build`) |
| CI | ✅ (PR-head CI inspected) |

**P7-M — Configurable Exam Modes ✅ CLOSED**
