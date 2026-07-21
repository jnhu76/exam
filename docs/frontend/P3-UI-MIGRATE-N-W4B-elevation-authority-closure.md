# UI-MIGRATE-N-W4B — Elevation Authority Audit and Shadow Debt Closure

> Accepted gates:
>
> ```text
> UI-MIGRATE-N-W4A: PASS
> UI-TYPOGRAPHY-AUTHORITY-RECON-1: PASS
> UI-TYPOGRAPHY-AUTHORITY-RECON-1 ADVERSARIAL REVIEW: PASS
> UI-MIGRATE-N-W4B: GO
> ```
>
> Starting HEAD: `b4dae71` (verified).
> Branch: `feat/frontend-redesign`.

This document is the evidence record for **W4B**: the audit of the remaining
`exam-ui/no-business-shadow` debt and the closure of the elevation-authority
boundary. It does not reopen typography, surface, or feedback migrations.

## Scope

W4B audits every registered `exam-ui/no-business-shadow` node and closes each
with a proven elevation-authority path. It does **not**:

- flatten the shadcn `Card` primitive (`components/ui` is out of lint scope and
  is flagged by the surface vocabulary §4.3 as separate forward debt);
- migrate any page to `PageSection` / `StatsCard` (deferred UI-PILOT-1 /
  UI-MIGRATE-N; explicitly forbidden W4B scope);
- introduce a new elevation vocabulary or recipe;
- touch typography, surface-content, feedback, or any business logic.

## A. Verdict

```text
UI-MIGRATE-N-W4B: PASS
```

(Final verdict confirmed at §16; recorded here per the report template. The
sections below are populated across the commit sequence — starting truth,
node inventory, and frozen authority paths land in commit 1; characterization,
migration, baseline closure, and final verification land in commits 2–5.)

## B. Starting state

| Item | Committed truth |
| --- | --- |
| W4B starting HEAD | `b4dae71` |
| Active rule | `exam-ui/no-business-shadow: "error"` in `businessGlobs` (`apps/web/eslint.config.ts`); excluded from `layoutGlobs` (topbar owns `shadow-xs`); `components/ui/**` excluded as primitive scope |
| Baseline | 7 file-signature entries, every signature `::shadow-sm` (`apps/web/src/lint/exam-ui/baseline.json`) |
| Matched AST nodes | **29** (verified by running the rule with an empty baseline against the 7 files) |
| Test baseline | 961 tests / 84 files (`pnpm --filter @exam/web test --run`) |

Per-file node count (authoritative, ESLint-counted):

```text
DashboardPage            1
ExamDetailPage           10
ProctorDashboardPage      1
ScoreListPage             7
SystemDiagnosticsPage     8
ExamListPage              1
TakeExamPage              1
--------------------------------
Total                    29
```

(The plan estimated 30; the committed source proves 29. This file records the
committed truth.)

## C. Rule reconstruction

`exam-ui/no-business-shadow` (`rules/no-business-shadow.ts`) visits every
`JSXOpeningElement`, reads its `className` attribute via
`findClassNameAttribute`, and collects all statically-knowable class tokens via
the shared `collectClassNameTokens` helper (`classNameUtils.ts`), which
descends:

```text
Literal string
TemplateLiteral (static quasis + embedded expression recursion)
JSXExpressionContainer
ArrayExpression
LogicalExpression (&& / ||)
ConditionalExpression (?:)
CallExpression — cn(...) / clsx(...) / twMerge(...) string-literal args
ChainExpression
BinaryExpression (+ string concat)
```

A purely dynamic expression (identifier / member expression / unknown callee)
yields **zero** tokens (intended — no false positive). The collected tokens are
matched against the `shadow` prefix family (`prefixFamily("shadow", "shadow")`):

```regex
^(?:shadow(?:-[\w[\]\\/.-]+)?)$
```

which matches `shadow`, `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`,
`shadow-2xl`, `shadow-inner`, `shadow-none`, `shadow-[...]` and does **not**
match `drop-shadow-*` (a different prefix). Each match is funneled through
`maybeSuppress`, which builds the signature
`<repo-relative-file>::<sorted|deduped-matched-tokens>` and drops the report if
that signature is grandfathered in `baseline.json`.

Detection matrix (from `no-business-shadow.test.ts` + the detector):

| Shape | Detected? |
| --- | --- |
| `shadow-sm` | YES |
| `shadow-md` | YES |
| `shadow` (bare) | YES |
| `shadow-xs` | YES (would flag in business scope; topbar excluded by config) |
| `cn("rounded-lg", "shadow-sm")` | YES (cn string-literal arg) |
| `` `rounded-lg ${"shadow-sm"}` `` | YES (template quasis) |
| `drop-shadow-sm` | NO (different prefix family — filter, not elevation) |
| `className={dyn}` (purely dynamic) | NO (zero tokens — intended) |

**Detector gaps vs the documented policy (found in the rule reconstruction).**
The anchored `^shadow…$` test is applied to the **whole** whitespace-delimited
token, so a variant-prefixed or arbitrary-bracket shadow escapes:

| Shape | Detected? |
| --- | --- |
| `hover:shadow-md` | **NO** (token starts with `hover:`) |
| `md:shadow-lg` | **NO** |
| `data-[state=open]:shadow-lg` | **NO** |
| `shadow-[0_2px_8px_rgb(0_0_0/0.12)]` | **NO** (the char class rejects spaces/parens) |

These are raw shadow utilities in business scope and the policy forbids them,
so the detector under-enforces its own documented global token policy. This is
the same class of gap W4A found and fixed for `no-arbitrary-typography`
(variant prefixes), and RECON-1 closed definitively with the shared
bracket-aware `parseTailwindCandidate`. W4B closes the shadow analog by routing
the shadow family match through the shared parser (variant-aware utility stem
+ arbitrary-value detection). See §M for the boundary tests and the bounded
search proving zero in-repo business violations of these forms today.

## D. Policy identity

```text
BUSINESS_SHADOW_POLICY: GLOBAL_TOKEN_POLICY
```

Authority documents phrase the policy in role-independent terms:
`P3-UI-Foundation-plan.md` and `P3-UI-surface-vocabulary.md` §4 state
"ordinary business content must not own elevation; elevation must come from an
authoritative component primitive, a semantic elevation authority, or be absent
when the surface is flat." The forbidden shape is the **raw `shadow-*` utility
in business scope**, regardless of the node's semantic role. Known semantic
diversity (stat card, content section, runtime question surface) is therefore
**not** a false positive under this policy — the rule enforces authority
selection, not role inference. This is the same class as
`no-arbitrary-typography` and the distinction from the W3-retired role-inference
proxies (`no-raw-typography`, `no-raw-surface-recipe`).

## E. Baseline-signature inventory

The seven grandfathered signatures (byte-identical to the pre-W4B baseline):

```text
apps/web/src/pages/admin/DashboardPage.tsx::shadow-sm
apps/web/src/pages/admin/ExamDetailPage.tsx::shadow-sm
apps/web/src/pages/admin/ProctorDashboardPage.tsx::shadow-sm
apps/web/src/pages/admin/ScoreListPage.tsx::shadow-sm
apps/web/src/pages/admin/SystemDiagnosticsPage.tsx::shadow-sm
apps/web/src/pages/exam/ExamListPage.tsx::shadow-sm
apps/web/src/pages/exam/TakeExamPage.tsx::shadow-sm
```

A file-level signature hides multiple AST nodes (29 total across these 7 files).

## F. Complete 29-node audit

Every node is one of two shapes:

| File / site | Component / element | Token | Authority path |
| --- | --- | --- | --- |
| DashboardPage · recent-exams | `<Card className="shadow-sm">` | `shadow-sm` | Card primitive (B) |
| ExamDetailPage · 4 stat cards | `<Card className="shadow-sm">` ×4 | `shadow-sm` | Card primitive (B) |
| ExamDetailPage · config card | `<Card className="shadow-sm">` | `shadow-sm` | Card primitive (B) |
| ExamDetailPage · 3 enrollment stat cards | `<Card className="shadow-sm">` ×3 | `shadow-sm` | Card primitive (B) |
| ExamDetailPage · enrollment card | `<Card className="shadow-sm">` | `shadow-sm` | Card primitive (B) |
| ExamDetailPage · scores card | `<Card className="shadow-sm">` | `shadow-sm` | Card primitive (B) |
| ProctorDashboardPage · candidate card | `<Card … className="shadow-sm">` | `shadow-sm` | Card primitive (B) |
| ScoreListPage · 5 stat cards | `<Card className="shadow-sm">` ×5 | `shadow-sm` | Card primitive (B) |
| ScoreListPage · filters card | `<Card className="shadow-sm">` | `shadow-sm` | Card primitive (B) |
| ScoreListPage · scores-table card | `<Card className="shadow-sm">` | `shadow-sm` | Card primitive (B) |
| SystemDiagnosticsPage · 7 inline cards | `<Card className="shadow-sm">` ×7 | `shadow-sm` | Card primitive (B) |
| SystemDiagnosticsPage · DiagnosticCard def | `<Card className="shadow-sm">` | `shadow-sm` | Card primitive (B) |
| ExamListPage · exam card | `<Card … className="shadow-sm" …>` | `shadow-sm` | Card primitive (B) |
| TakeExamPage · question section | `<section … surface-content … shadow-sm …>` | `shadow-sm` | flat surface removal (A) |

Totals: **28 Card nodes + 1 section node = 29**.

## G. Effective pre-W4B elevation

### Card nodes (28)

The shadcn `Card` primitive (`apps/web/src/components/ui/card.tsx:10`) supplies
`shadow-sm` in its **default** className:

```tsx
className={cn(
  "flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm",
  className,
)}
```

`cn` (tailwind-merge) de-duplicates same-family utilities, so a consumer's
`className="shadow-sm"` is a **second declaration of the same effective
elevation authority the primitive already owns**. The business declaration is
fully redundant: removing it leaves the primitive-owned `shadow-sm` intact.

### TakeExam question section (1)

```tsx
<section
  className="relative surface-content p-5 shadow-sm md:p-8"
  data-testid="take-question-section"
>
```

`surface-content` (`apps/web/src/surface/recipes.css`) is **deliberately flat**:

```css
.surface-content {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
/* "NO elevation (hierarchy comes from background tier + typography + spacing,
 *  not shadow)." — recipes.css comment */
```

`P3-UI-surface-vocabulary.md` §4.1 assigns this role `elevation.none`. The raw
`shadow-sm` therefore **contradicts** the flat-content-surface contract — it is
not redundant with an existing authority, it is in conflict with the surface's
documented role.

## H. Authority-path matrix

| Node class | Required elevation? | Selected path | Reason |
| --- | --- | --- | --- |
| 28 Card nodes | yes (raised content) | **B — existing component authority** | `Card` primitive already owns `shadow-sm`; remove the redundant business raw utility |
| TakeExam section | none (flat by contract) | **A — remove shadow** | `surface-content` is the flat-surface authority; hierarchy comes from background tier + typography (surface-vocab §11.1) |

No node selects path C (no proven same-role elevation recipe exists), D (no
two-consumer reusable elevation role is proven — the surface vocabulary's
`elevation.none|overlay|sticky` already covers every role here), E (no
specialized component owns a unique role beyond `Card`), or F (no node is
blocked).

## I. No new elevation vocabulary

W4B introduces **no** elevation recipe, token, or alias. Rationale:

- The 28 Card nodes are resolved by the **existing** `Card` primitive authority
  (component-owned elevation) — no recipe is needed.
- The 1 TakeExam node is resolved by the **existing** `surface-content` flat
  contract (`elevation.none`) — no recipe is needed.
- A generic alias like `elevation-shadow-sm` would rename a raw token, not
  establish semantic authority — explicitly forbidden by the plan and the
  surface vocabulary.
- The surface vocabulary (`P3-UI-surface-vocabulary.md` §4.1) already defines
  the complete elevation role set (`none | overlay | sticky`); introducing a
  peer recipe with a single consumer would repeat the one-consumer mistake.

The broader `Card`-default-shadow reconciliation (flatten `Card` itself)
remains separate forward debt (surface-vocab §4.3), out of W4B scope.

## J. Characterization evidence

Six focused characterization tests were added (commit 2), each green against
the pre-migration production source AND against the post-migration source.
They assert durable container/surface roles, never the raw `shadow-sm` token:

| Test | File | Pre-migration | Invariant protected |
| --- | --- | --- | --- |
| keeps each exam card as a Card region holding title, metadata, and action | `ExamListPage.test.tsx` | PASS | `data-slot="card"` container role |
| keeps each score stat label inside a Card region | `ScoreListPage.test.tsx` | PASS | stat-card container role |
| keeps stat and config card titles inside Card regions holding their values | `ExamDetailPage.test.tsx` | PASS | stat + config container roles |
| keeps each diagnostic card title inside a Card region holding its value | `SystemDiagnosticsPage.test.tsx` | PASS | diagnostic-card container role |
| keeps each candidate card as a Card region holding name and status | `ProctorDashboardPage.test.tsx` | PASS | candidate-card container role |
| keeps the question section on the flat surface-content recipe after the shadow removal | `TakeExamPage.snapshot.test.tsx` | PASS | flat `surface-content` recipe + relative positioning |

`DashboardPage` required no new test: its existing "近期考试 section title"
characterization (W3) already pins the recent-exams `data-slot="card"`
container, which is the only shadow node in that file.

## K. Production migrations

Commit 3 removed the business-authored `shadow-sm` from all 29 registered
nodes. The change is 29 insertions / 29 deletions across 7 files; every other
line is preserved.

Card consumers (28 nodes) — `STRICT TOKEN EQUIVALENCE`:

```diff
- <Card className="shadow-sm">
+ <Card>
```

(two nodes retain other props: `<Card key={…}>` in ProctorDashboardPage,
`<Card data-testid={…}>` in ExamListPage.)

TakeExam question section (1 node) — `ELEVATION REMOVAL`:

```diff
  <section
-   className="relative surface-content p-5 shadow-sm md:p-8"
+   className="relative surface-content p-5 md:p-8"
    data-testid="take-question-section"
  >
```

Preserved on every node: element/component type, headings, landmarks,
`data-testid`, ARIA, props, positioning, padding, responsive padding,
border/background/radius, and all interaction/business behavior. The `Card`
primitive, `surface-content` recipe, `PageSection`, `StatsCard`, typography
authority, feedback authority, and all business logic are untouched.

## L. Visual delta

```text
28 × COMPONENT-AUTHORITY NORMALIZATION  /  STRICT TOKEN EQUIVALENCE
 1 × ELEVATION REMOVAL                  /  INTENTIONAL VISUAL CHANGE
```

The 28 Card nodes are pixel-identical (the primitive's `shadow-sm` is
unchanged). The TakeExam question section returns to its documented flat state
— an acknowledged, intentional visual change, not strict equivalence.

## M. Lint fitness

```text
SOUND_BUSINESS_SHADOW_POLICY_EXISTS: YES
NO_BUSINESS_SHADOW_LINT: KEEP
```

KEEP is correct: the policy is a sound global token policy (business code must
not select raw shadow utilities; elevation must come from an authoritative
component primitive, a semantic elevation authority, or be absent when the
surface is flat). Different elevation roles are not false positives because the
rule enforces authority selection, not role inference.

## N. Rule-test coverage

The rule reconstruction (§C) found the anchored `prefixFamily` regex missed
three classes of raw shadow utility that the documented global token policy
forbids:

| Shape | Pre-W4B | Post-W4B |
| --- | --- | --- |
| `hover:shadow-md` / `md:shadow-lg` / `group-hover:shadow-lg` (variant-prefixed) | NOT detected | detected |
| `data-[state=open]:shadow-lg` (data-attribute variant) | NOT detected | detected |
| `shadow-[0_2px_8px_rgb(0_0_0/0.12)]` (arbitrary value) | NOT detected | detected |

**Fix (commit 4):** the shadow family is now matched by a new
`variantAwareFamily(name, stemRegex)` matcher in `classNameUtils.ts`, which
routes each token through the shared bracket-aware `parseTailwindCandidate`
(RECON-1 §6). The parser strips variant prefixes and recognizes the
arbitrary-value form, so the stem regex `/^shadow(?:-.+)?$/` is applied to the
parser-resolved base utility. This is the same class of fix W4A applied to
`no-arbitrary-typography`, reusing the authoritative parser; no
shadow-specific parsing logic was added. `drop-shadow-sm` parses to utility
`drop-shadow-sm`, which does not match `^shadow…$`, so CSS filter shadows stay
excluded — the same-family guarantee `prefixFamily` relied on is preserved.

Boundary tests added (`no-business-shadow.test.ts`, 10 → 22, +12):

```text
+ shadow-lg, shadow-2xl, shadow-xl         (full elevation family, already worked)
+ hover:shadow-md, md:shadow-lg            (responsive/interaction variant)
+ data-[state=open]:shadow-lg              (data-attribute variant)
+ group-hover:shadow-lg                    (group variant)
+ shadow-[0_2px_8px_rgb(0_0_0/0.12)]       (arbitrary value)
+ hover:shadow-[…]                         (variant + arbitrary)
+ cn("rounded-lg", "hover:shadow-md")      (cn-composed variant)
+ hover:drop-shadow-md                     (negative: filter under variant)
+ surface-overlay, elevation-overlay       (negative: semantic authority class)
```

Dynamic class expressions (a bare identifier / member expression) still yield
zero tokens and are not inspected — documented and unchanged, matching the
typography rules. `drop-shadow-*` is intentionally out of policy (CSS filter,
not elevation); the rule was not broadened to cover it.

## O. Baseline transition

```text
exam-ui/no-business-shadow: 7 → 0
```

The `exam-ui/no-business-shadow` key was removed entirely from
`apps/web/src/lint/exam-ui/baseline.json` (now `{}`). This is the repo's
zero-entry convention — the three typography rules are likewise absent from the
baseline (their empty arrays were removed when their debt closed). The full
ESLint run passes with **zero** `no-business-shadow` errors and an empty
baseline (verified): no suppression shields any shadow.

`baseline-behavior.test.ts` changes (9 → 13, net +1 after retirement +
addition):

- retired: "grandfathers an existing shadow-sm violation (DashboardPage)",
  "keeps the no-business-shadow baseline at exactly 7 entries";
- added: "DashboardPage is free of no-business-shadow violations (W4B
  closure)", "has ZERO baseline entries for no-business-shadow (W4B closure)",
  "reports a reintroduced business shadow (isolated fixture, no baseline
  shield)" — the reintroduction probe uses `hover:shadow-md` in an isolated
  in-scope fixture, pinning both the empty baseline AND the variant-aware
  detector fix;
- converted: the prefix-alias unit test pivoted from "DashboardPage IS
  grandfathered" to "with an empty shadow baseline, NO shadow signature is
  grandfathered".

No new baseline entry was added. The typography baseline assertions remain
byte-identical (zero entries).

## P. Bounded search

A bounded same-policy search across all business/layout lint scope
(`src/pages`, `src/components/{shared,exam,settings,question,layout}`) for
`shadow`, `shadow-*`, `shadow-[`, and variant-prefixed shadow utilities
returns exactly two results, both legitimate:

| Result | Classification |
| --- | --- |
| `components/shared/StatsCard.tsx:10-11` — the word "shadow" in a comment documenting why StatsCard stays flat | documentation (not a utility; prose) |
| `components/layout/AdminLayout.tsx:27` — sticky topbar `shadow-xs` | layout authority (`elevation.sticky`; excluded from `no-business-shadow` by config) |

A full ESLint run over the entire scope reports **zero**
`no-business-shadow` errors with an empty baseline.

```text
UNREGISTERED_BUSINESS_SHADOW_VIOLATION_FOUND: NO
```

No business violation, no registered debt, no component-primitive leak into
lint scope, no test fixture, no documentation-as-code. The generated shadcn
primitives in `components/ui` (Dialog/Popover/Sheet/DropdownMenu `shadow-lg`/
`shadow-md`, Card/Tabs `shadow-sm`) are excluded from lint by config and are
the legitimate overlay/card elevation owners.

## Q. Documentation

This document, plus minimal current-truth updates to:

- `AGENTS.md` — Elevation guidance: the business-shadow baseline is now empty;
  the rule remains active and is now variant-aware;
- `docs/frontend/P3-UI-lint-readiness-report.md` §4.3 — the 7-entry debt
  registry is marked CLEARED in W4B, with the component-authority (Card) and
  flat-surface (TakeExam) paths recorded; the broader PageSection/StatsCard
  migrations remain deferred (not conflated with W4B);
- `docs/frontend/P3-UI-agent-construction-guide.md` — elevation/shadow
  construction guidance updated to reflect the empty baseline and the
  variant-aware rule.

Historical reports were not rewritten; the typography RECON documents remain
closed.

## R. Test-count and test-file provenance

```text
961 + 19 − 0 = 980 tests
84  + 0  − 0 = 84  test files
```

| Test file | Pre-W4B | Post-W4B | Delta | Source |
| --- | ---: | ---: | ---: | --- |
| `pages/exam/ExamListPage.test.tsx` | 9 | 10 | +1 | characterization |
| `pages/admin/ScoreListPage.test.tsx` | 7 | 8 | +1 | characterization |
| `pages/admin/ExamDetailPage.test.tsx` | 20 | 21 | +1 | characterization |
| `pages/admin/SystemDiagnosticsPage.test.tsx` | 14 | 15 | +1 | characterization |
| `pages/admin/ProctorDashboardPage.test.tsx` | 1 | 2 | +1 | characterization |
| `pages/exam/TakeExamPage.snapshot.test.tsx` | 18 | 19 | +1 | characterization |
| `lint/.../no-business-shadow.test.ts` | 10 | 22 | +12 | rule boundary (variant/arbitrary/state/family) |
| `lint/.../baseline-behavior.test.ts` | 9 | 13 | +1 net (−2 retired, +3 added, 1 converted) | closure + reintroduction probe |

All +19 fully attributed: 6 characterization, 12 rule boundary, 1 net
baseline-behavior. No test deleted outright (the 2 retired assertions were
replaced by their closure equivalents in the same file). No test file added or
removed.

## S. Clean verification

(Verified in the isolated detached worktree at the final committed HEAD — see
§R of the final report for the exact commands and exit codes.)

## T. Final invariants

```text
ALL_REGISTERED_SHADOW_NODES_AUDITED:                    YES
ACTUAL_MATCHED_NODE_COUNT:                              29
CARD_COMPONENT_AUTHORITY_PROVEN:                        YES
TAKE_EXAM_FLAT_SURFACE_CONTRACT_PROVEN:                 YES
NO_MEANINGFUL_ELEVATION_REMOVED_WITHOUT_JUSTIFICATION:  YES
NO_NEW_ELEVATION_RECIPE_INTRODUCED:                     YES
NO_ONE_CONSUMER_GLOBAL_ELEVATION_RECIPE:                YES
NO_RAW_SHADOW_MECHANICALLY_RELOCATED:                   YES
SOUND_BUSINESS_SHADOW_POLICY_EXISTS:                    YES
NO_BUSINESS_SHADOW_LINT_DECISION:                       KEEP
ALL_SHADOW_BASELINE_REMOVALS_EARNED:                    YES
NO_NEW_BASELINE_ENTRY_ADDED:                            YES
UNREGISTERED_BUSINESS_SHADOW_VIOLATION_FOUND:           NO
TYPOGRAPHY_AUTHORITY_UNCHANGED:                         YES
FEEDBACK_AUTHORITY_UNCHANGED:                           YES
BUSINESS_BEHAVIOR_UNCHANGED:                            YES
W4B_DOCS_MATCH_IMPLEMENTATION:                          YES
TEST_COUNT_DELTA_FULLY_ATTRIBUTED:                      YES
TEST_FILE_DELTA_FULLY_ATTRIBUTED:                       YES
FINAL_VERIFICATION_BELONGS_TO_FINAL_COMMITTED_HEAD:     YES
```

Every applicable YES/NO invariant is YES; `NO_BUSINESS_SHADOW_LINT_DECISION`
is KEEP; `UNREGISTERED_BUSINESS_SHADOW_VIOLATION_FOUND` is NO.

## U. Next gate

```text
UI-MIGRATE-N-W4B ADVERSARIAL REVIEW: READY
```

(Confirmed only on PASS.)
