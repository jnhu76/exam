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

(Populated in commit 2 — characterization tests, all green against
pre-migration production source.)

## K. Production migrations

(Populated in commit 3 — the 29-node `shadow-sm` removal.)

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

(Populated in commit 4 — boundary-test review for variant / arbitrary / state
shadow forms.)

## O. Baseline transition

```text
exam-ui/no-business-shadow: 7 → 0
```

(Populated in commit 4 — baseline key removed, baseline-behavior tests
converted to fixture-based enforcement + adversarial reintroduction probe.)

## P. Bounded search

(Populated at final verification — §16.)

## Q. Documentation

This document, plus minimal current-truth updates to `AGENTS.md`,
`P3-UI-lint-readiness-report.md` §4.3, and `P3-UI-agent-construction-guide.md`
(populated in commit 5).

## R. Test-count and test-file provenance

(Populated at final verification — §16.)

## S. Clean verification

(Populated at final verification — §16.)

## T. Final invariants

(Populated at final verification — §16.)

## U. Next gate

```text
UI-MIGRATE-N-W4B ADVERSARIAL REVIEW: READY
```

(Confirmed only on PASS.)
