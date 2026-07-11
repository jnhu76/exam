# P3-UI-MIGRATE-N-W2 — InlineErrorBanner Baseline Closure

Status: evidence record for the second bounded `UI-MIGRATE-N` wave.

Wave scope: audit the `exam-ui/prefer-inline-error-banner` baseline and both
W1-routed same-role candidates, migrate the proven inline-operation-error
sites to `InlineErrorBanner`, and reconcile the detector's lint fitness.

This wave does **not** migrate other authority families (FieldError is closed
in W1; PageSection, StatsCard, typography, surface, shadow remain). It does
**not** change the `InlineErrorBanner` implementation or API. It does **not**
reopen the `FieldError` authority line.

---

## A. Verdict

```text
UI-MIGRATE-N-W2: PASS
```

---

## B. Initial baseline truth

Committed HEAD at wave start: `94c3858` (verified clean; the FieldError
closure review PASS and `UI-MIGRATE-N-W2: GO` were the accepted baseline).

The `exam-ui/prefer-inline-error-banner` rule detected a `<div>` whose
className carried a `rounded-*` utility together with at least TWO distinct
destructive-surface/text utility families (`border-destructive`, `bg-
destructive[-soft|/NN]`, `text-destructive[/NN]`). The baseline suppressed
one signature per file: `<file>::destructive-surface|rounded`.

Committed initial baseline (4 entries across 1 rule):

```text
apps/web/src/components/exam/ExamTimer.tsx::destructive-surface|rounded
apps/web/src/pages/LoginPage.tsx::destructive-surface|rounded
apps/web/src/pages/admin/ExamDetailPage.tsx::destructive-surface|rounded
apps/web/src/pages/exam/StartExamPage.tsx::destructive-surface|rounded
```

Two additional same-role candidates were routed here from W1 (they were
`<p>`-shaped field/operation-error sites that did not match the detector
shape but are genuine inline-operation-error roles):

```text
apps/web/src/pages/admin/CandidateFieldsPage.tsx   → mutationError, dialog-local
apps/web/src/pages/admin/CandidatesPage.tsx        → saveError,     dialog-local
```

---

## C. InlineErrorBanner authority contract

Derived from `apps/web/src/components/shared/InlineErrorBanner.tsx`:

| Contract dimension | Actual authority behavior |
| --- | --- |
| semantic role | inline destructive error banner — block-level notice for an operation/form-submit/section failure rendered inline within an otherwise usable surface |
| root element | `<div>` |
| alert semantics | `role="alert"` (authority-owned, fixed; no caller `role` prop) |
| message API | `children: ReactNode` (structured children supported, not only strings) |
| action support | none intrinsic (no retry/action slot) |
| styling ownership | canonical recipe: `surface-attention border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive` |
| caller overrides | `className?: string` only — merged after the canonical recipe via `cn`; no `id` / `style` / `role` override |

No API gap was proven for any W2 candidate: every accepted site renders a
plain message string as children, which the existing `{ children; className? }`
API already covers. No component extension was made.

```text
INLINE_ERROR_AUTHORITY_SCOPE_PROVEN: YES
```

---

## D. Known-site semantic audit

| Site | Failure scope | Authority applicable | Final action |
| --- | --- | --- | --- |
| `ExamTimer.tsx:37` | timer countdown display (≤300s low-time branch) | NO — destructive **control state**, not an operation error; no `role` | RETAIN (false-positive baseline, removed via detector NARROW) |
| `LoginPage.tsx:92` | form-submit authentication operation error | YES — inline within an otherwise usable form; not field-owned | MIGRATE |
| `ExamDetailPage.tsx:525` | publish-operation failure | YES — inline on the loaded page; not a full-page load failure (`ErrorState` owns load failures separately) | MIGRATE |
| `StartExamPage.tsx:248` | multi-role status message (active-attempt / max-attempts / retake / start-error) | NO — multi-role **status surface**; only the start-error fallback branch is an operation error; no `role` | RETAIN (false-positive baseline, removed via detector NARROW) |
| `CandidateFieldsPage.tsx:421` | dialog-local save operation error | YES — true role; `<p>`-shaped (did not match detector) | MIGRATE |
| `CandidatesPage.tsx:626` | dialog-local save operation error | YES — true role; distinct from the page's per-field validation (`FieldError`) | MIGRATE |

```text
ALL_KNOWN_INLINE_ERROR_SITES_AUDITED: YES
EVERY_INLINE_ERROR_MIGRATION_SAME_ROLE: YES
NO_FIELD_WARNING_OR_CONTROL_STATE_FORCED_TO_INLINEERROR: YES
```

---

## E. Characterization evidence

The `InlineErrorBanner` authority component previously had **no** component
test. This wave added `apps/web/src/components/shared/InlineErrorBanner.test.tsx`
(5 tests) protecting: `<div>` root, authority-owned `role="alert"`, canonical
destructive-surface class contract, caller `className` merge order, and
structured-children rendering. Run green against the pre-migration component
before any consumer was migrated.

The two W1-routed dialog-local candidates were already covered by existing
characterization tests protecting their meaningful invariants:

| Site | Characterization test | Pre-migration result | Protected invariant |
| --- | --- | --- | --- |
| `CandidateFieldsPage` mutationError | "shows API error without unhandled rejection"; "clears dialog mutation error when closing" | PASS | operation error renders at dialog scope; clears on dialog close |
| `CandidatesPage` saveError | "preserves USER_ALREADY_EXISTS save error"; "preserves CANDIDATE_IDENTITY_CONFLICT save error"; "renders API field errors from ApiError details" | PASS | operation error message preserved; field-validation boundary (`FieldError`) remains distinct |
| `LoginPage` error | "shows error message when login fails" (`getByRole("alert")`) | PASS | auth operation error renders with alert semantics |
| `ExamDetailPage` publishError | "shows publish error message on failure" (`findByText`) | PASS | publish operation error renders inline |

No new page-level characterization tests were required: every meaningful
invariant listed in §7 of the wave brief was already protected. No snapshot
tests, no old-Tailwind-class assertions, no flaky post-import spies were
introduced.

---

## F. Accepted migrations

Four sites migrated to `InlineErrorBanner`, each preserving its error source,
message/i18n key, trigger, clear condition, dialog/page scope, retry behavior,
and business/API behavior:

1. `LoginPage.tsx` — form-submit authentication operation error.
2. `ExamDetailPage.tsx` — publish-operation failure (the secondary `toast`
   channel is untouched; only the inline banner channel migrated).
3. `CandidateFieldsPage.tsx` dialog-local save error (now matches the
   page-banner site at L243, which already used `InlineErrorBanner`).
4. `CandidatesPage.tsx` dialog-local save error; the per-field validation
   boundary (`FieldError` at the field rows) is preserved.

---

## G. Rejected migrations

Two baseline sites were deliberately **not** migrated:

- `ExamTimer.tsx` — the low-time branch applies destructive color to a
  **countdown timer chip**. The `<div>` renders the remaining time, not an
  error message. This is a destructive **control state**, not an operation
  error. It has no `role` attribute.
- `StartExamPage.tsx` — `inlineMessage` is a **multi-role status surface**
  whose color is dynamically chosen (primary for active-attempt / retake-info
  states, destructive only for the start-error fallback). Migrating it to
  `InlineErrorBanner` would force a multi-role status surface into a single
  operation-error role. It has no `role` attribute.

Forcing either into `InlineErrorBanner` would be a false-role migration. They
remain as-is; their baseline entries are instead removed by the detector
narrowing in §J.

---

## H. Authority API gaps

None. The existing `{ children: ReactNode; className?: string }` API covered
every accepted site. No extension was made. No `id`, retry-callback, action
slot, or structured-message prop was needed.

---

## I. Canonical normalization delta

Adopting the canonical `InlineErrorBanner` recipe changes appearance relative
to the hand-rolled sites. These are **authority-owned normalization** deltas
(coming directly from the existing `InlineErrorBanner` contract), not strict
visual equivalence:

| Site | Before | After (canonical authority) |
| --- | --- | --- |
| `LoginPage` | `p-2 rounded text-sm text-destructive bg-destructive/10` | `surface-attention border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive` |
| `ExamDetailPage` | `rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive` | `surface-attention border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive` |
| `CandidateFieldsPage` / `CandidatesPage` | `<p role="alert" className="text-sm text-destructive">` | `<div role="alert">` + full banner recipe (root element `p`→`div`; adds border, soft fill, rounded) |

Message text, i18n keys, visibility/clear conditions, retry behavior, dialog
scope, and `role="alert"` are preserved across all four sites.

```text
INLINE_ERROR_SCOPE_AND_CLEAR_BEHAVIOR_PRESERVED: YES
CANONICAL_INLINE_ERROR_NORMALIZATION_ACKNOWLEDGED: YES
```

---

## J. Lint-fitness evidence

Detector before this wave: `<div>` + `rounded-*` + ≥2 destructive families.

Per live baseline match (role column is the decisive NARROW signal):

| Site | Detector match | Semantic role | InlineErrorBanner owner? | Has `role="alert"`? |
| --- | --- | --- | --- | --- |
| `ExamTimer.tsx:37` | yes | DESTRUCTIVE_CONTROL_STATE | NO | no |
| `LoginPage.tsx:92` | yes | INLINE_OPERATION_ERROR | YES (migrated) | yes |
| `ExamDetailPage.tsx:525` | yes | INLINE_OPERATION_ERROR | YES (migrated) | yes |
| `StartExamPage.tsx:248` | yes | multi-role status | NO | no |

The two W1-routed true-role candidates did **not** match the detector (they
are `<p>`-shaped with a single destructive family — a false negative of the
structural recipe, but a correct non-match for the banner anatomy):

| Site | Detector match | Semantic role | InlineErrorBanner owner? |
| --- | --- | --- | --- |
| `CandidateFieldsPage.tsx:421` | no (`<p>`, <2 families) | INLINE_OPERATION_ERROR | YES (migrated) |
| `CandidatesPage.tsx:626` | no (`<p>`, <2 families) | INLINE_OPERATION_ERROR | YES (migrated) |

NARROW proposals evaluated:

| Proposed detector | True owners retained | Non-owners excluded | False negatives | Viable? |
| --- | ---: | ---: | ---: | --- |
| current (rounded + ≥2 destructive families) | 2 | 0 (both control-state FPs leak) | 0 | no |
| + require `role="alert"` | 2 | 2 (both FPs have no role) | 0 | **yes** |
| + require `<Field>`/`<FieldGroup>` ancestor | 2 | 0 (CandidatesPage saveError is a sibling of a real FieldError inside FieldGroup) | 0 | no |
| + variable-name / translation-key signal | — | — | — | disallowed by policy |

Decisive soundness evidence: `role="alert"` is the authority-owned a11y
contract (`InlineErrorBanner` always renders it). Both false positives reuse
destructive color for non-error control/state surfaces and carry **no** `role`
attribute. The narrowing does not false-positive on `ErrorState` (<2
destructive families on its root div), `FieldError` (`<p>`), or
`InlineErrorBanner` itself (filename-exempt).

Unlike the FieldError closure (where no sound narrowing existed), a sound
deterministic narrowing **does** exist here.

```text
SOUND_INLINE_ERROR_DETECTOR_EXISTS: YES
```

---

## K. Lint decision

```text
PREFER_INLINE_ERROR_BANNER_LINT: NARROW
```

The detector now requires a static `role="alert"` attribute on the matched
`<div>`, in addition to the existing `rounded-*` + ≥2-destructive-families
gates. A dynamic `role={expr}` is treated as not-an-alert so the rule never
reasons about runtime values. Rule tests cover 12 valid cases (including both
false-semantic-overlap shapes) and 6 invalid cases (all `role="alert"`
bypasses, including a JSX-expression-container role literal).

The rule is **not** retired: the `InlineErrorBanner` authority and its
deterministic structural lint both remain active. They are distinct — the
authority owns the semantic role; the lint enforces the structural anatomy.

---

## L. Baseline delta

Reconstructed baseline transition (git-verified):

| State | `prefer-inline-error-banner` entries |
| --- | ---: |
| wave start (`94c3858`) | 4 |
| after migrations (LoginPage, ExamDetailPage → InlineErrorBanner) | 2 outstanding matches (ExamTimer, StartExamPage) |
| after detector NARROW (role requirement excludes both) | 0 |
| final HEAD | array removed |

Every removal is earned:

| File | Semantic role | Migration result | Final detector status | Baseline result |
| --- | --- | --- | --- | --- |
| `ExamTimer.tsx` | DESTRUCTIVE_CONTROL_STATE | not migrated (non-owner) | no longer matches (no `role`) | removed (NARROW-excluded) |
| `LoginPage.tsx` | INLINE_OPERATION_ERROR | migrated to `InlineErrorBanner` | no longer matches (filename-exempt) | removed (earned by migration) |
| `ExamDetailPage.tsx` | INLINE_OPERATION_ERROR | migrated to `InlineErrorBanner` | no longer matches (filename-exempt) | removed (earned by migration) |
| `StartExamPage.tsx` | multi-role status | not migrated (non-owner) | no longer matches (no `role`) | removed (NARROW-excluded) |

```text
ANY_INLINE_ERROR_BASELINE_ENTRY_REMOVED: YES
ALL_BASELINE_REMOVALS_EARNED: YES
ALL_RETAINED_ENTRIES_SEMANTICALLY_EXPLAINED: YES (vacuous — array removed)
NO_NEW_BASELINE_ENTRY_ADDED: YES
```

---

## M. Same-role search

Bounded business-scope search for additional inline operation/form-submit
errors (mutation/save/delete/login/start/section failures). Found no
unregistered inline-operation-error bypass rendered with the destructive
banner recipe. The two W1-routed dialog-local candidates were the only
same-role sites outside the baseline, and both are now migrated.

Sites that reuse destructive color but are **distinct roles** (correctly not
migrated): `ExamTimer` (control state), `StartExamPage` inlineMessage
(multi-role status), `ErrorState` (full-page resource failure), `FieldError`
(per-field validation), `ExamConfigForm` showWarning (domain warning).

```text
UNREGISTERED_INLINE_ERROR_BYPASS_FOUND: NO
```

---

## N. Test-count provenance

The rule-test file grew from 12 cases (7 valid + 5 invalid) to 18 cases
(12 valid + 6 invalid) — a net +6 `RuleTester` cases, each registered as one
vitest test via the `ruleTester.ts` wiring. No tests were deleted.

```text
797   wave-start suite total (verified at 94c3858)
  +5  InlineErrorBanner.test.tsx authority component tests (new file)
  +6  prefer-inline-error-banner rule-test cases (12 → 18)
  -0  deleted tests
= 808 final web suite total (verified at HEAD, isolated worktree)
```

```text
TEST_COUNT_DELTA_FULLY_ATTRIBUTED: YES
```

---

## O. Verification

Isolated detached worktree at final HEAD, bootstrapped canonically:

```bash
pnpm install --frozen-lockfile   # OK
pnpm build                        # 9/9 tasks, exit 0
pnpm lint:eslint                  # exit 0
pnpm --filter @exam/web test      # 808 passed, exit 0, zero collection failures
pnpm verify:static                # 17/17 tasks, exit 0
```

```text
FINAL_VERIFICATION_BELONGS_TO_FINAL_COMMITTED_HEAD: YES
```

---

## P. Changed files and commits

```text
test(ui): characterize inline error ownership
refactor(ui): migrate proven inline error authorities
fix(ui-lint): narrow inline error detector to role=alert
docs(ui): record inline error migration wave evidence
```

Production source changed (non-test, non-doc, non-lint): four files —
`LoginPage.tsx`, `ExamDetailPage.tsx`, `CandidateFieldsPage.tsx`,
`CandidatesPage.tsx` (each only the inline-error render site + an import).

---

## Q. Final invariants

```text
ALL_KNOWN_INLINE_ERROR_SITES_AUDITED:                                YES
EVERY_INLINE_ERROR_MIGRATION_SAME_ROLE:                              YES
NO_FIELD_WARNING_OR_CONTROL_STATE_FORCED_TO_INLINEERROR:             YES
INLINE_ERROR_SCOPE_AND_CLEAR_BEHAVIOR_PRESERVED:                     YES
CANONICAL_INLINE_ERROR_NORMALIZATION_ACKNOWLEDGED:                   YES
PREFER_INLINE_ERROR_BANNER_LINT_DECISION:                            NARROW
ALL_BASELINE_REMOVALS_EARNED:                                        YES
ALL_RETAINED_ENTRIES_SEMANTICALLY_EXPLAINED:                         YES
NO_NEW_BASELINE_ENTRY_ADDED:                                         YES
TEST_COUNT_DELTA_FULLY_ATTRIBUTED:                                   YES
FINAL_VERIFICATION_BELONGS_TO_FINAL_COMMITTED_HEAD:                  YES
```

---

## R. Next gate

```text
UI-MIGRATE-N-W3:
READY FOR NARROW TYPOGRAPHY / SURFACE DEBT AUDIT
```

Distinct-line reminder (mirrors the W1 framing): the `InlineErrorBanner`
authority and the `exam-ui/prefer-inline-error-banner` deterministic lint are
two different things. The authority owns the semantic role and is enforced by
component tests + semantic review; the lint enforces the structural anatomy
(now narrowed to `role="alert"` + destructive-surface recipe). Narrowing the
detector did not narrow the authority.
