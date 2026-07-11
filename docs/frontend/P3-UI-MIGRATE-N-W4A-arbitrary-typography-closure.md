# UI-MIGRATE-N-W4A — Arbitrary Typography Closure

> Accepted gates:
>
> ```text
> UI-MIGRATE-N-W3: PASS
> UI-MIGRATE-N-W3 ADVERSARIAL REVIEW: PASS
> UI-MIGRATE-N-W4: GO
> ```
>
> Starting HEAD: `8103d55` (verified).

## Scope

W4A is deliberately limited to **arbitrary typography closure** — the single
registered `exam-ui/no-arbitrary-typography` baseline site and the rule's
fitness as active policy. Shadow/elevation debt is **not** audited here; that
belongs to W4B. No `shadow-*` value, `StatsCard`, `PageSection`, timer logic,
low-time threshold, or status/error semantics were touched.

## A. Verdict

```text
UI-MIGRATE-N-W4A: PASS
```

## B. Initial baseline truth

| Item | Committed truth |
| --- | --- |
| W4A starting HEAD | `8103d55` |
| Exact baseline owner/signature | `apps/web/src/components/exam/ExamTimer.tsx::text-[11px]` |
| Active ESLint wiring | `exam-ui/no-arbitrary-typography: "error"` in `businessGlobs` + `layoutGlobs` (`apps/web/eslint.config.ts`) |
| Exact forbidden token grammar | `text-[...]`, `leading-[...]`, `tracking-[...]` (prefix + `-[` ... `]`) |
| Existing typography alternatives | `type-*` recipes in `typography/recipes.css` (incl. `type-metadata`); named scale utilities (`text-xs`/`text-sm`/…) |

## C. Rule reconstruction

The rule visits `JSXOpeningElement`, reads the `className` attribute, and
collects every statically-knowable token via `collectClassNameTokens`
(descends literals, template quasis, `JSXExpressionContainer`, arrays,
`&&`/`?:`, and `cn`/`clsx`/`twMerge` string-literal args; purely dynamic
classes yield zero tokens). A token is flagged when, after stripping any
`responsive:`/`state:`/stacked variant prefixes, it is `text-[…]` /
`leading-[…]` / `tracking-[…]`.

Detection matrix (post-W4A, after the variant-prefix fix):

| Shape | Detected? |
| --- | --- |
| `text-[11px]` | YES |
| `md:text-[11px]` | YES (variant stripped) |
| `hover:leading-[1.7]` | YES (variant stripped) |
| `group-hover:tracking-[0.02em]` | YES (stacked variant stripped) |
| `leading-[1.7]` | YES |
| `tracking-[0.02em]` | YES |
| `className={cn("text-[11px]", x)}` | YES (cn string-literal arg) |
| `className={dynamicValue}` | NO (dynamic — zero tokens; intended) |
| `text-xs` / `text-sm` (named scale) | NO (the token path) |
| `type-metadata` (semantic recipe) | NO (the authority path) |

## D. Policy identity

```text
ARBITRARY_TYPOGRAPHY_POLICY: GLOBAL_TOKEN_POLICY
```

This rule is **not** a semantic-role inference proxy. Authority documents state
the policy in role-independent terms:

- `P3-UI-Foundation-plan.md` §4.3 lists "arbitrary typography values" as a
  high-confidence forbidden **pattern**, alongside raw domain status tone and
  business-page shadows — all syntax/token policies, not role inferences.
- `P3-UI-Foundation-plan.md` (`exam-ui/no-arbitrary-typography`): "Reject new
  arbitrary typography values such as `text-[…]` / `leading-[…]` /
  `tracking-[…]` **outside approved primitive or specialized runtime
  components**."

The forbidden shape is the arbitrary-value bracket form, regardless of the
semantic role the element carries. Known semantic diversity is therefore not a
false positive under this policy. This is the distinction from the retired
`no-raw-typography` / `no-raw-surface-recipe` rules (W3), which were role
inference proxies and could not deterministically distinguish the owner role.

## E. Node semantic audit

The baseline node is the **label** of the ExamTimer, not its numeric value:

```text
content semantic role : compact supporting factual/operational label
element type          : <div>
interactive/control   : none
layout density        : compact (px-3 py-1.5 wrapper; leading-none)
responsive behavior   : none
font family           : font-ui (default)
font size             : 11px (arbitrary) → 0.75rem/12px after migration
line height           : leading-none (structural compact override retained)
weight                : 500 (font-medium) → 400 (recipe-owned)
numeric alignment     : n/a (the label is not numeric)
adjacent labels/values: the <span> MM:SS value below it
```

The component separates three distinct roles:

```text
timer numeric value          → <span> font-mono text-xl font-bold tabular-nums
timer unit/secondary label   → <div> text-[11px] …  (the baseline node)
low-time destructive surface → wrapper border/bg/text destructive utilities
```

The baseline node classifies exactly as **`METADATA`** (compact supporting
operational label — "剩余时间"). It is **not** `TIMER_VALUE` (the value is the
neighboring `<span>`).

## F. Migration-option matrix

| Option | Same role | Behavior preserved | Authority cost | Verdict |
| --- | --- | --- | --- | --- |
| A — `text-xs` (12px standard scale) | close (metadata-ish) | size 11→12px; weight/color/leading kept | none, but bypasses the role authority | rejected (authority exists) |
| B — `type-metadata` recipe | **exact** (METADATA) | size 11→12px, weight 500→400 (recipe-owned), color equiv (muted), `leading-none` retained | adopts existing recipe | **chosen** |
| C — existing component authority | n/a | no timer-label component exists | — | n/a |
| D — new recipe/token | proven role but only ONE consumer | — | forbidden (one consumer insufficient) | rejected |
| E — retain baseline | arbitrary value remains | — | no authority can represent it (false) | rejected |

The smallest valid solution is **Option B**: the `type-metadata` recipe already
owns the METADATA role (`typography-vocabulary.md`; `recipes.css` pins
`font-ui`, `0.75rem`, `1.125rem` leading, `400` weight, `--text-muted`). The
migrated node keeps `leading-none` as the intentional compact-layout override
for this tight timer cell.

## G. Characterization evidence

New characterization tests in
`src/components/exam/examComponents.test.tsx` (the `describe("ExamTimer")`
block), all run **green against pre-migration production code** before the
migration was applied:

| Test | Pre-migration result | Protected invariant |
| --- | --- | --- |
| renders the remaining-time label alongside the MM:SS value | PASS | label + value content |
| keeps the timer value zero-padded to two digits per field (`05:03`) | PASS | zero-pad formatting |
| keeps the label visually distinct from the numeric value (value owns `tabular-nums`; label does not) | PASS | numeric/label role hierarchy |
| activates the low-time state at the 300s threshold | PASS | low-time boundary (inclusive) |
| does not activate the low-time state above the threshold | PASS | low-time boundary (exclusive) |
| updates the remaining-time value each second | PASS | per-second update cadence |

The old arbitrary class is intentionally **not** asserted. The size-hierarchy
invariant is pinned through the durable **role** property (`tabular-nums`), not
computed `font-size`, because the jsdom toolchain does not load the stylesheet
(the same limitation documented in `recipes.test.ts`). After migration all six
remain green.

## H. Accepted migration

```diff
-      <div className="text-[11px] font-medium leading-none text-muted-foreground">
+      <div className="type-metadata leading-none">
```

The arbitrary value is replaced by the existing `type-metadata` recipe (the
proven role authority). `leading-none` is retained as the structural compact
override. No shadow, surface, color-state, numeric, mono, or responsive class
was changed; no structural change to the component.

## I. Normalization delta

```text
AUTHORITY-OWNED TYPOGRAPHY NORMALIZATION
```

| Property | Before | After | Source of change |
| --- | --- | --- | --- |
| font-size | 11px (arbitrary) | 0.75rem / 12px | `type-metadata` recipe |
| font-weight | 500 (`font-medium`) | 400 | `type-metadata` recipe |
| color | `text-muted-foreground` | `--text-muted` (equivalent) | `type-metadata` recipe |
| font-family | default UI | `--font-ui` (explicit) | `type-metadata` recipe |
| line-height | `leading-none` | `leading-none` (retained override) | unchanged |

This is an **authority-owned normalization**, not strict visual equivalence:
size grows 11→12px and weight drops 500→400 because the recipe owns those
properties for the METADATA role. The change is acknowledged, not claimed as
pixel-identical.

## J. Lint decision

```text
SOUND_ARBITRARY_TYPOGRAPHY_POLICY_EXISTS: YES
NO_ARBITRARY_TYPOGRAPHY_LINT: KEEP
```

KEEP is correct because the policy is a global token policy (forbid the
arbitrary-value bracket form everywhere in lint scope, regardless of semantic
role) and the detector now accurately recognizes that syntax, including under
responsive/state/stacked variant prefixes. The pre-W4A detector had one real
gap — it did not strip variant prefixes, so `md:text-[11px]` escaped the global
policy. W4A closes that gap by stripping `name:` variant segments before
matching, aligning the detector with the documented policy. Semantic diversity
(STAT / label / value / control) is not a false positive under a global token
policy.

## K. Baseline delta

```text
ANY_ARBITRARY_TYPOGRAPHY_BASELINE_ENTRY_REMOVED: YES
ALL_ARBITRARY_TYPOGRAPHY_REMOVALS_EARNED:    YES
ALL_RETAINED_ENTRIES_EXPLAINED:              YES
```

The `exam-ui/no-arbitrary-typography` baseline array (one entry) was removed
entirely from `baseline.json`. The removal is **earned**: an adversarial test
in `baseline-behavior.test.ts` reintroduces `text-[11px]` into `ExamTimer.tsx`
and asserts it is reported as a real, unshielded error (no baseline protects
it anymore). The `no-business-shadow` array is byte-identical (verified via
`git diff`). No new baseline entry was added.

## L. Bounded policy search

A bounded same-policy search across all lint scope
(`src/pages`, `src/components/shared`, `src/components/exam`,
`src/components/settings`, `src/components/question`, `src/components/layout`)
and the typography authority files (`src/typography`) for `text-[` /
`leading-[` / `tracking-[`:

```text
UNREGISTERED_ARBITRARY_TYPOGRAPHY_VIOLATION_FOUND: NO
```

The only textual match is a comment inside the characterization test file
(describing the retired pattern), and test files are excluded from lint scope
by config. No business-page, layout, generated/vendor, or authority-impl
violation exists outside the registered W4A scope.

## M. Documentation reconciliation

- Created this evidence document.
- Corrected the stale final section of
  `apps/web/src/typography/typography-vocabulary.md`: it previously described
  the vocabulary as the source for a future active `exam-ui/no-raw-typography`.
  It now records that `no-raw-typography` was retired in W3 (structural
  section-title ownership was not deterministically detectable) and that
  `no-arbitrary-typography` remains the active global token-policy rule.
- The Markdown vocabulary remains synchronized with its TypeScript mirror
  (`typography-vocabulary.ts`), which already recorded the W3 retirement.
- The unrelated `surface/recipes.css` cascade-layer comment was **not** modified.

## N. Test-count provenance

| Test file | Before | After | Delta |
| --- | --- | --- | --- |
| `examComponents.test.tsx` | 20 | 26 | +6 (ExamTimer characterization) |
| `no-arbitrary-typography.test.ts` | 11 | 19 | +8 (variant/recipe/clsx boundaries) |
| `baseline-behavior.test.ts` | 8 | 9 | +1 (reintroduction adversarial probe) |
| **web total** | **769** | **784** | **+15** |

All +15 are fully attributed: 6 characterization, 8 rule boundary (responsive
`md:`/state `hover:`/stacked `group-hover:` now detected; `clsx`/`twMerge`
static; recipe `type-*` valid; named-scale-under-variant valid), 1 adversarial
baseline-removal probe. No test was deleted or merged.

## O. Verification

See §16 provenance: detached worktree at the final committed HEAD,
`pnpm install --frozen-lockfile` + `pnpm build` green, then
`pnpm lint:eslint`, `pnpm --filter @exam/web test`, `pnpm verify:static` all
exit 0.

## P. Changed files and commits

```text
685844c  test(ui): characterize arbitrary typography owner
<next>   refactor(ui): remove registered arbitrary typography debt
<next>   fix(ui-lint): reconcile arbitrary typography policy
<next>   docs(ui): record arbitrary typography closure
```

Files modified:

```text
apps/web/src/components/exam/ExamTimer.tsx              (migration)
apps/web/src/components/exam/examComponents.test.tsx     (characterization — committed in 685844c)
apps/web/src/lint/exam-ui/baseline.json                  (entry removed)
apps/web/src/lint/exam-ui/rules/no-arbitrary-typography.ts          (variant-aware detection + doc)
apps/web/src/lint/exam-ui/rules/__tests__/no-arbitrary-typography.test.ts  (boundary tests)
apps/web/src/lint/exam-ui/rules/__tests__/baseline-behavior.test.ts  (closure + adversarial probe)
apps/web/src/typography/typography-vocabulary.md         (stale §synchronization corrected)
docs/frontend/P3-UI-MIGRATE-N-W4A-arbitrary-typography-closure.md   (this document)
```

## Q. Final invariants

```text
REGISTERED_ARBITRARY_TYPOGRAPHY_NODE_AUDITED:      YES
MIGRATION_USES_EXISTING_VALID_AUTHORITY:           YES
TIMER_BEHAVIOR_PRESERVED:                          YES
TYPOGRAPHY_NORMALIZATION_ACKNOWLEDGED:             YES
NO_ARBITRARY_TYPOGRAPHY_LINT_DECISION:             KEEP
ALL_BASELINE_REMOVALS_EARNED:                      YES
NO_SHADOW_DEBT_TOUCHED:                            YES
NO_NEW_BASELINE_ENTRY_ADDED:                       YES
TYPOGRAPHY_VOCABULARY_SYNCED:                      YES
TEST_COUNT_DELTA_FULLY_ATTRIBUTED:                 YES
FINAL_VERIFICATION_BELONGS_TO_FINAL_COMMITTED_HEAD: YES
```

## R. Next gate

```text
UI-MIGRATE-N-W4B:
READY FOR ELEVATION AUTHORITY AUDIT
```

W4B is not begun.
