# P3-UI-MIGRATE-N-W1 — FieldError Baseline Closure

Status: evidence record for the first bounded `UI-MIGRATE-N` wave.

Wave scope: audit and, where semantically valid, eliminate the remaining
`exam-ui/prefer-field-error` baseline debt after the `GradingDetailPage` pilot
closure.

This wave does **not** migrate other authority families (InlineErrorBanner,
PageSection, StatsCard, typography, surface). It does **not** change the
`FieldError` implementation or API.

---

## A. Verdict

```text
UI-MIGRATE-N-W1: PASS
```

---

## B. Initial baseline truth

Committed HEAD at wave start: `3b85ac9` (working tree clean except untracked
`.zcode/`).

The `exam-ui/prefer-field-error` rule detects a `<p>` whose className carries a
destructive text utility (`text-destructive` / `text-destructive/NN`) together
with a text-size utility (`text-xs` / `text-sm` / … / `text-[...]`). The
baseline suppresses one signature per file: `<file>::text-destructive|text-size`.

A baseline entry proves only:

```text
the deterministic raw recipe existed when enforcement activated
```

It does **not** prove the semantic role is `FieldError`. Multiple `<p>` sites in
one file share a single baseline entry, so an entry can only be removed when
**every** matching `<p>` in that file is gone.

Initial `exam-ui/prefer-field-error` entries (five files):

| Baseline path | Signature | Present in committed baseline |
| --- | --- | --- |
| `apps/web/src/components/exam/ExamConfigForm.tsx` | `text-destructive\|text-size` | YES |
| `apps/web/src/components/exam/QuestionRenderer.tsx` | `text-destructive\|text-size` | YES |
| `apps/web/src/components/exam/SubjectiveAnswerInput.tsx` | `text-destructive\|text-size` | YES |
| `apps/web/src/pages/admin/CandidateFieldsPage.tsx` | `text-destructive\|text-size` | YES |
| `apps/web/src/pages/admin/CandidatesPage.tsx` | `text-destructive\|text-size` | YES |

`pnpm lint:eslint` exits 0 at wave start (all five grandfathered).

The rule recipe match (`text-destructive` + `text-size` on a `<p>`) is a
**lint-recipe fact**, distinct from **semantic FieldError ownership**. Each site
was independently classified below before any migration.

---

## C. Five-site semantic audit

For every candidate site the input semantic domain, validation/failure decision
source, presentation scope, and current raw node were derived from the source.

There are **seven `<p>` sites** across the five baseline files (ExamConfigForm
has three):

| File / site (line at wave start) | Input semantic domain | Decision source | Failure scope | FieldError candidate? |
| --- | --- | --- | --- | --- |
| `ExamConfigForm.tsx` — `timeError` (L189) | time window fields | `closeAt <= openAt` | FIELD_CONTROL_VALIDATION | **YES** |
| `ExamConfigForm.tsx` — `scoreError` (L327) | score fields | `passingScore > totalScore` | FIELD_CONTROL_VALIDATION | **YES** |
| `ExamConfigForm.tsx` — `showWarning` (L307) | totalScore field | manual total ≠ computed sum | DOMAIN_WARNING | NO (advisory; no `role="alert"`) |
| `QuestionRenderer.tsx` — unsupportedType (L72) | (none — no input control) | unrecognized question type | CONTROL_STATE_FEEDBACK | NO (no owning control) |
| `SubjectiveAnswerInput.tsx` — `error` (L72) | textarea | `error` prop | FIELD_CONTROL_VALIDATION | BLOCKED (see §F) |
| `CandidateFieldsPage.tsx` — `mutationError` (L421) | dialog operation | API mutation failure | INLINE_OPERATION_ERROR | NO |
| `CandidatesPage.tsx` — `saveError` (L626) | dialog operation | API save failure | INLINE_OPERATION_ERROR | NO |

A valid `FieldError` migration requires `failure scope = FIELD_CONTROL_VALIDATION`
**and** the error belongs to one specific field/control. The `text-destructive`
+ `text-sm`/`text-xs` + `<p>` lint-recipe facts alone are not semantic ownership
proof.

### Field association (migrated sites only)

| Site | Owning control | Error state | Show condition | Clear condition | Repeated/keyed? |
| --- | --- | --- | --- | --- | --- |
| ExamConfigForm — `timeError` | startTime / endTime inputs | `timeError` boolean | `closeAt <= openAt` | `closeAt > openAt` | no |
| ExamConfigForm — `scoreError` | totalScore / passingScore inputs | `scoreError` boolean | `passingScore > totalScore` | `passingScore <= totalScore` | no |

No new field-association semantics were invented. No `aria-describedby` was
added locally. Adopting `role="alert"` (already present on both pre-migration
nodes) is accepted canonical authority normalization.

---

## D. Characterization evidence

Existing tests covered the "error appears" invariant for both migrated sites
(`shows time error when closeAt is before openAt`,
`shows score error when passingScore > totalScore`). The "error clears"
invariant — the conditional-rendering equivalence that the migration must
preserve — was unprotected. Two focused characterization tests were added to
`apps/web/src/components/exam/ExamConfigForm.test.tsx` **before** migration and
confirmed green on pre-migration production state, then re-confirmed green after
migration.

| Site | Test added/used | Pre-migration result | Post-migration result | Invariant |
| --- | --- | --- | --- | --- |
| ExamConfigForm — `timeError` | `clears the time validation error once closeAt is after openAt` | PASS | PASS | error clears when condition resolves (guards `&&`-gate → `FieldError` falsy-swallow equivalence) |
| ExamConfigForm — `scoreError` | `clears the score validation error once passingScore is within total` | PASS | PASS | error clears when condition resolves (guards `&&`-gate → `FieldError` falsy-swallow equivalence) |

Pre-migration: 801/801 green (whole web suite). Post-migration: 803/803 green
(+2 characterization tests). ExamConfigForm file: 16 → 18 tests, all green.

Consumer tests protect field-error ownership and validation behavior
(appears/clears under the same condition). They do **not** test Tailwind class
strings, do **not** snapshot entire components, and do **not** re-prove
`FieldError` internals (`role="alert"`, `text-xs`, `mt-1`, destructive styling,
falsy-child swallowing), which the canonical authority's own tests own.

---

## E. Accepted migrations

| Site | Input domain | Owning control | Authority route |
| --- | --- | --- | --- |
| ExamConfigForm — `timeError` | time window fields | startTime / endTime inputs | `<FieldError>{t("admin.forms.exam.timeInvalid")}</FieldError>` (keeping `{timeError && (...)}` gate) |
| ExamConfigForm — `scoreError` | score fields | totalScore / passingScore inputs | `<FieldError>{t("admin.forms.exam.passingScoreExceeds", {...})}</FieldError>` (keeping `{scoreError && (...)}` gate) |

Both migrations preserve: validation source, validation message, validation
trigger, clear condition, owning control, DOM locality, surrounding field
structure, and submission/API behavior. The `{error && (...)}` gating is
preserved verbatim; `FieldError` additionally swallows falsy children, which is
equivalent conditional-rendering behavior.

---

## F. Rejected migrations

Five of the seven sites were rejected. Each is classified and routed to its
correct future owner/wave.

### ExamConfigForm — `showWarning` (L307)

```text
failure scope: DOMAIN_WARNING
why FieldError rejected: advisory mismatch notice, not a validation failure.
  The admin in manual mode may intentionally set a totalScore that differs
  from the computed question-score sum. The variable is named showWarning;
  the message is "不匹配" (mismatch), not "无效" (invalid). The pre-migration
  node deliberately omits role="alert" — the original author encoded the
  error-vs-warning distinction in markup.
correct future owner: distinct domain-warning role (no authority today).
  Recorded as an authority gap; not migrated in W1.
baseline retained: YES — lint recipe false-semantic-overlap. The raw structure
  matches prefer-field-error (text-xs + text-destructive on a <p>), but
  FieldError does not own the DOMAIN_WARNING role. Proven required: removing
  the ExamConfigForm baseline entry produces a lint error at L305.
```

### QuestionRenderer — unsupportedType (L72)

```text
failure scope: CONTROL_STATE_FEEDBACK
why FieldError rejected: the default switch case renders a message for an
  unrecognized question type. There is no input control being validated and
  no per-field validation state. This is a control-state / unsupported-type
  notice, not a field/control validation failure.
correct future owner: authority gap / distinct role (unsupported-type notice).
baseline retained: YES — lint recipe false-semantic-overlap.
```

### SubjectiveAnswerInput — `error` (L72)

```text
failure scope: FIELD_CONTROL_VALIDATION (semantically a valid candidate)
why FieldError rejected: BLOCKED on authority API gap. The pre-migration node
  carries id={helpId} and the owning Textarea carries
  aria-describedby={helpId} + aria-invalid={error ? true : undefined}. The
  canonical FieldError component exposes no id prop, so migrating would either
  leave aria-describedby pointing at a non-existent id (broken a11y
  association) or require removing the existing association (changing
  validation ownership — forbidden by §1).
correct future owner: FieldError authority extension (add id pass-through) in
  a future authority task, then migrate. Not a W1 production change.
baseline retained: YES — lint recipe false-semantic-overlap. The raw structure
  matches prefer-field-error, but the FieldError API cannot currently adopt
  the existing a11y association without an authority change (forbidden in W1).
```

### CandidateFieldsPage — `mutationError` (L421)

```text
failure scope: INLINE_OPERATION_ERROR
why FieldError rejected: the node renders mutationError, set by failed
  save / delete / sort API calls inside the add/edit dialog. It is an
  operation error, not a field/control validation failure. The page already
  uses <InlineErrorBanner> for the same mutationError at L243 (the table-level
  surface); the dialog-local duplicate is an inline-operation-error role.
correct future owner: UI-MIGRATE-N-W2 / InlineErrorBanner wave.
baseline retained: YES — lint recipe false-semantic-overlap.
```

### CandidatesPage — `saveError` (L626)

```text
failure scope: INLINE_OPERATION_ERROR
why FieldError rejected: the node renders saveError, set by a failed save API
  call (e.g. "用户名已存在"). It is a server-side operation error surfaced in
  the dialog, not a field/control validation failure. The page already routes
  its genuine field-validation errors (fieldErrors.username / .password /
  .name / [`field:${name}`]) through <FieldError>.
correct future owner: UI-MIGRATE-N-W2 / InlineErrorBanner wave.
baseline retained: YES — lint recipe false-semantic-overlap.
```

A W1 PASS does not require all five baseline entries to disappear. It requires
every removal to be earned and every retained entry to be semantically
explained.

---

## G. Canonical normalization delta

```text
STRICT_VISUAL_A11Y_EQUIVALENCE:
NO
```

The two accepted migrations inherit `FieldError`'s canonical contract:

```text
falsy children → no node
truthy children → <p role="alert">
text-xs
text-destructive
mt-1
```

Both pre-migration nodes already carried `role="alert"` and `text-xs`
`text-destructive`, so the only authority-owned normalization delta adopted is
`mt-1` (spacing). These are authority-owned normalization deltas, not
exam-configuration business-state changes. The conditional-rendering behavior
(no message → no node; message → field-error node) is preserved.

This record does **not** claim strict visual or assistive-technology
equivalence, and does not repeat the UI-PILOT-1 overstatement corrected in the
companion commit.

---

## H. Baseline delta

| Rule | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `exam-ui/prefer-field-error` | 5 entries | 5 entries | 0 |

No baseline entry was removed. Each of the five files still contains at least
one `<p>` matching the `text-destructive|text-size` recipe whose semantic role
is **not** `FieldError`:

| File | Retained-site reason | Failure scope |
| --- | --- | --- |
| `ExamConfigForm.tsx` | `showWarning` (DOMAIN_WARNING) | advisory mismatch notice |
| `QuestionRenderer.tsx` | unsupportedType (CONTROL_STATE_FEEDBACK) | no owning control |
| `SubjectiveAnswerInput.tsx` | `error` (FIELD_CONTROL_VALIDATION, blocked on FieldError `id` API gap) | a11y association cannot be preserved |
| `CandidateFieldsPage.tsx` | `mutationError` (INLINE_OPERATION_ERROR) | API mutation failure |
| `CandidatesPage.tsx` | `saveError` (INLINE_OPERATION_ERROR) | API save failure |

```text
FIELD_ERROR_BASELINE_REMOVALS_EARNED:
NO
```

No removal was earned in W1. The two valid FieldError migrations share a file
(`ExamConfigForm.tsx`) with a retained DOMAIN_WARNING site, so the file-level
baseline entry cannot be removed. Every retained entry is semantically
explained in §F.

```text
NO_NEW_BASELINE_ENTRY_ADDED:
YES
```

---

## I. Unregistered same-role search

After migrating the registered candidates, business scope was searched for
additional local field/control validation failures using the semantic shapes:

```text
fieldErrors.*
validationErrors.*
errors[field]
formState.errors
specific input validation message
```

combined with local destructive presentation, plus a direct scan for any `<p>`
with `text-destructive` + a text-size utility outside the five baseline files.

| Newly found site | Field/control domain | Existing authority bypass? |
| --- | --- | --- |
| (none) | — | — |

`UsersPage.tsx`, `CoursePage.tsx`, and `LoginPage.tsx` all already route their
`fieldErrors.*` through `<FieldError>`. `TakeExamPage.tsx` has `<p
className="text-destructive">` nodes, but they carry **no text-size utility**
(so the rule does not flag them) and are submit-dialog warnings, not field
validation. `LoginPage.tsx`'s destructive element is a `<div role="alert">`
(block-level operation error, already in the `prefer-inline-error-banner`
baseline — W2 scope).

```text
UNREGISTERED_FIELD_ERROR_BYPASS_FOUND:
NO
```

The deterministic baseline fully represented known field-error debt.

---

## J. Verification

Final verification belongs to the final committed HEAD (see §K). Focused
per-site gates:

| Command | Exit code | Result |
| --- | ---: | --- |
| `vitest run src/components/exam/ExamConfigForm.test.tsx` (pre-migration) | 0 | 16/16 passed |
| `vitest run src/components/exam/ExamConfigForm.test.tsx` (post-migration) | 0 | 18/18 passed (+2 characterization) |
| `vitest run src/typography/typography-vocabulary.test.ts src/lib/apiErrors.test.ts` (FieldError authority) | 0 | 9/9 passed |
| `pnpm lint:eslint` (post-migration, baseline intact) | 0 | no violations |

---

## K. Changed files and commits

Working tree at wave start was clean except for untracked `.zcode/`.

W1 commits:

```text
docs(ui): correct pilot FieldError equivalence record
test(ui): characterize exam config field-error ownership
refactor(ui): migrate exam config field-error authorities
docs(ui): record FieldError migration wave evidence
```

The baseline entry retention ships together with the production migration
commit (the ExamConfigForm entry is retained because of the `showWarning`
DOMAIN_WARNING site, not because of any migrated site). No baseline entry was
removed or added.

### Final committed-HEAD verification

Final proof belongs to the final committed HEAD and is produced in an isolated
detached worktree bootstrapped with `pnpm install --frozen-lockfile && pnpm
build`, then:

```text
pnpm lint:eslint             → exit 0
pnpm --filter @exam/web test → 803/803 passed, zero collection failures
pnpm verify:static           → exit 0
```

---

## L. Final invariants

```text
FIVE_BASELINE_SITES_SEMANTICALLY_AUDITED:                       YES
EVERY_FIELD_ERROR_MIGRATION_SAME_ROLE:                         YES
NO_OPERATION_OR_PAGE_ERROR_FORCED_INTO_FIELDERROR:             YES
VALIDATION_OWNERSHIP_PRESERVED:                                YES
CANONICAL_FIELDERROR_NORMALIZATION_ACKNOWLEDGED:               YES
FIELD_ERROR_BASELINE_REMOVALS_EARNED:                          NO
NO_NEW_BASELINE_ENTRY_ADDED:                                   YES
FINAL_VERIFICATION_BELONGS_TO_FINAL_COMMITTED_HEAD:            YES
```

`FIELD_ERROR_BASELINE_REMOVALS_EARNED` is NO: no baseline entry was removable
in W1. The two valid FieldError migrations share `ExamConfigForm.tsx` with a
retained DOMAIN_WARNING site; the other four files contain non-field-error
roles. PASS requires every removal to be earned and every retained entry to be
semantically explained — both hold. The seven other invariants are all YES.

### L.1 Invariant-model clarification (UI-FIELD-ERROR-AUTHORITY-CLOSURE-1 §2)

The invariant name `FIELD_ERROR_BASELINE_REMOVALS_EARNED: NO` above is
ambiguous on its face: "removals earned" can mean either (a) "did any removal
occur" or (b) "were all removals that occurred earned." The two readings carry
opposite PASS/BLOCKED implications. This subsection clarifies the semantics
**without changing the W1 verdict** (W1 remains PASS). The single invariant is
equivalent to the three unambiguous facts below, verified against the W1 commit
range (`3b85ac9..521bd1a`):

```text
ANY_FIELD_ERROR_BASELINE_ENTRY_REMOVED:     NO   (git-proven: baseline.json untouched across W1)
ALL_BASELINE_REMOVALS_EARNED:               YES  (vacuous — zero removals, zero unearned)
ALL_RETAINED_ENTRIES_SEMANTICALLY_EXPLAINED: YES (5/5 explained in §F)
```

So the original `NO` expresses reading (a) — "no removal occurred" — which is
benign. It does **not** express reading (b) — "an unearned removal occurred" —
which would have blocked. Future waves should use the three-valued form above
rather than the conflated single name.

---

## M. Next wave

Only if PASS:

```text
UI-MIGRATE-N-W2:
INLINE ERROR AUTHORITY AUDIT
```

W2 candidates identified by this wave:

- `CandidateFieldsPage.tsx` — `mutationError` dialog-local `<p>` (L421)
- `CandidatesPage.tsx` — `saveError` dialog-local `<p>` (L626)
- plus the existing `exam-ui/prefer-inline-error-banner` baseline entries.

Authority gap identified (not W2 — distinct role):

- `SubjectiveAnswerInput.tsx` — FieldError `id` pass-through, to unblock the
  blocked FIELD_CONTROL_VALIDATION migration.
- `ExamConfigForm.tsx` `showWarning` — DOMAIN_WARNING role (no authority today).
- `QuestionRenderer.tsx` unsupportedType — CONTROL_STATE_FEEDBACK role.

Do not begin W2.
