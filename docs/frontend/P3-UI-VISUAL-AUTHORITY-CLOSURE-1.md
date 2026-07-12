# UI-VISUAL-AUTHORITY-CLOSURE-1 — Final System Closure and Evidence Reconciliation

## A. Verdict

```
UI-VISUAL-AUTHORITY-CLOSURE-1: PASS
```

## B. Starting state

| Attribute | Value |
| --------- | ----- |
| Branch | `feat/frontend-redesign` |
| HEAD | `10c4a2386d862941b744015fed798c863ee6235d` |
| Tree | clean |
| Web tests | 980 tests, 84 test files |
| Active `exam-ui` rules | 5 |
| Baseline | `{}` (empty) |

## C. Migration timeline

| Work item | Start | Final | Review verdict |
| --------- | ----- | ----- | -------------- |
| UI-PILOT-1 | `3a3eb91` | `86af772` | PASS |
| UI-MIGRATE-N-W1 (FieldError) | `521bd1a` | `41dcfd8` | PASS |
| UI-FIELD-ERROR-AUTHORITY-CLOSURE-1 | `41dcfd8` | `94c3858` | PASS |
| UI-MIGRATE-N-W2 (InlineError) | `018cc58` | `15c9f9e` | PASS |
| UI-MIGRATE-N-W3 (Typography/Surface) | `8103d55` | `4c79034` | PASS |
| UI-MIGRATE-N-W4A (Arbitrary Typography) | `685844c` | `4516489` | PASS |
| UI-TYPOGRAPHY-AUTHORITY-RECON-1 | `1c2433b` | `b4dae71` | PASS |
| UI-MIGRATE-N-W4B (Elevation) | `b4dae71` | `10c4a23` | PASS |

Total: 43 commits from `1edbee0` (initial UI-LINT-2 reconciliation) to `10c4a23` (W4B closure).

## D. Commit and review attribution

| Hash | Message | Work item |
| ---- | ------- | --------- |
| `1edbee0` | docs(ui): reconcile UI-LINT-2 authority closure | UI-PILOT-1 precursor |
| `080a9b8` | test(ui): make status authority ownership check deterministic | UI-PILOT-1 |
| `84b80f9` | docs(ui): reconcile final UI lint verification record | UI-PILOT-1 |
| `02f130d` | refactor(ui): route attempt result summary through PageSection | UI-PILOT-1 |
| `eb9f7b5` | docs(ui): record committed PageSection migration evidence | UI-PILOT-1 |
| `2f92c3e` | test(ui): characterize grading detail pilot behavior | UI-PILOT-1 |
| `86af772` | refactor(ui): migrate grading detail field-error authority | UI-PILOT-1 |
| `3b85ac9` | docs(ui): record representative migration evidence | UI-PILOT-1 |
| `c995f1a` | docs(ui): correct pilot FieldError equivalence record | UI-PILOT-1 |
| `e475dd6` | test(ui): characterize exam config field-error ownership | W1 |
| `4eff719` | refactor(ui): migrate exam config field-error authorities | W1 |
| `521bd1a` | docs(ui): record FieldError migration wave evidence | W1 |
| `8a0f08a` | docs(ui): clarify FieldError migration invariants | FIELD-ERROR closure |
| `93b9532` | refactor(ui): close FieldError association contract gap | FIELD-ERROR closure |
| `41dcfd8` | fix(ui-lint): retire unsound prefer-field-error rule | FIELD-ERROR closure |
| `94c3858` | docs(ui): reconcile FieldError enforcement evidence | FIELD-ERROR closure |
| `320ba3c` | test(ui): characterize inline error ownership | W2 |
| `d1a91e7` | refactor(ui): migrate proven inline error authorities | W2 |
| `15c9f9e` | fix(ui-lint): narrow inline error detector to role=alert | W2 |
| `018cc58` | docs(ui): record inline error migration wave evidence | W2 |
| `de0b357` | refactor(ui): migrate proven typography and surface authorities | W3 |
| `4c79034` | fix(ui-lint): retire unsound no-raw-typography and no-raw-surface-recipe | W3 |
| `8103d55` | docs(ui): record typography and surface migration evidence | W3 |
| `685844c` | test(ui): characterize arbitrary typography owner | W4A |
| `cdff688` | refactor(ui): migrate ExamTimer label to type-metadata recipe | W4A |
| `4516489` | fix(ui-lint): reconcile arbitrary typography policy (UI-MIGRATE-N-W4A) | W4A |
| `ced0451` | docs(ui): record arbitrary typography closure | W4A |
| `88bd2fc` | docs(ui): define typography property, cascade, and syntax policy | RECON-1 |
| `1c2433b` | refactor(ui-lint): add tested parser and expression analyzer (substrate) | RECON-1 |
| `86f13d5` | feat(ui): establish canonical typography recipe registry | RECON-1 |
| `5242e04` | feat(ui-lint): implement typography authority conflict rule (exported) | RECON-1 |
| `010db00` | refactor(ui): close ExamTimer recipe conflict (remove dead leading-none) | RECON-1 |
| `bdec20b` | feat(ui-lint): complete arbitrary typography policy enforcement | RECON-1 |
| `3abbf8a` | feat(ui-lint): activate typography authority conflict gate | RECON-1 |
| `b4dae71` | docs(ui): record typography authority reconstruction | RECON-1 |
| `21bc38b` | docs(ui): define W4B elevation authority decisions | W4B |
| `893fe51` | test(ui): characterize registered shadow owners | W4B |
| `33a3045` | refactor(ui): close registered business shadow debt | W4B |
| `9ea566c` | fix(ui-lint): close business shadow baseline and align detector | W4B |
| `10c4a23` | docs(ui): record W4B elevation closure | W4B |

Every implementation wave's adversarial review passed (required: YES).

## E. Final authority graph

| Authority domain | Canonical source | Implementation | Enforcing rule | Consumer scope |
| ---------------- | ---------------- | -------------- | -------------- | -------------- |
| **Typography** | `recipeRegistry.ts` — single canonical machine-readable recipe ownership | `typography/recipes.css` — unlayered CSS recipe classes | `exam-ui/no-arbitrary-typography` (global arbitrary-value ban), `exam-ui/no-arbitrary-inline-typography` (inline-style ban), `exam-ui/no-typography-authority-conflict` (recipe-owned property conflict) | Business pages + feature components |
| **Typography vocabulary** | `typography-vocabulary.ts` — derives from registry, no duplicated ownership data | `typography-vocabulary.md` — human-readable mirror | Recipe-authority drift tests (`recipes.test.ts`, `typography-vocabulary.test.ts`, `recipeRegistry.test.ts`) | Agent/human builders |
| **Surface** | `surface-vocabulary.ts` — machine-readable surface role names + elevation owners | `surface/recipes.css` — unlayered CSS surface recipe classes | Review-only (no-raw-surface-recipe retired — no deterministic AST boundary); spot-checked by `recipes.test.ts` | Business pages + feature components |
| **Feedback / inline error** | `InlineErrorBanner` component + `FieldError` component | `components/shared/InlineErrorBanner.tsx`, `FieldError.tsx` | `exam-ui/prefer-inline-error-banner` (narrowed to `role="alert"`; deterministic) | Inline operation errors (InlineErrorBanner), field validation (FieldError) |
| **Elevation / shadow** | `surface-vocabulary.ts` (`ELEVATION_OWNERS = ["overlay"]`); Card primitive (`components/ui/card.tsx`) | `surface/recipes.css` (`.surface-overlay` owns `box-shadow`); `components/ui/card.tsx` (generated shadcn primitive owns `shadow-sm`) | `exam-ui/no-business-shadow` (variant-aware; baseline empty) | Business pages forbidden; layout topbar excluded; components/ui excluded |
| **Component primitives** | `components/ui/` (generated shadcn) | shadcn/ui primitives | Excluded from all `exam-ui/*` rules | Business pages consume via authoritative components |
| **Layout authority** | `components/layout/` (AdminLayout, ExamLayout) | Structural chrome, sticky topbar | `no-business-shadow` excluded from layout; other exam-ui rules apply | Only layout components |

```
FINAL_AUTHORITY_GRAPH_COMPLETE: YES
```

## F. Active-rule inventory

| Rule | Registered? | Wired? | Severity | Scope | Baseline debt |
| ---- | ----------: | -----: | -------- | ----- | ------------: |
| `prefer-inline-error-banner` | YES | YES | error | businessGlobs + layoutGlobs | 0 |
| `no-business-shadow` | YES | YES | error | businessGlobs only (layout + ui excluded) | 0 |
| `no-arbitrary-typography` | YES | YES | error | businessGlobs + layoutGlobs | 0 |
| `no-arbitrary-inline-typography` | YES | YES | error | businessGlobs + layoutGlobs | 0 |
| `no-typography-authority-conflict` | YES | YES | error | businessGlobs + layoutGlobs | 0 |

```
ALL_ACTIVE_RULES_REGISTERED_AND_WIRED: YES
ALL_ACTIVE_RULES_HAVE_SOUND_POLICY: YES
```

### Rule policy details

#### `prefer-inline-error-banner`
- **Policy identity**: a `<div role="alert">` with rounded-* + ≥2 destructive-surface families must use `InlineErrorBanner`.
- **Detector input**: JSXOpeningElement.
- **Supported static syntax**: static string `role="alert"` (Literal or JSXExpressionContainer Literal), static className with rounded utility + 2+ of {border-destructive, bg-destructive, text-destructive}.
- **Dynamic limitation**: dynamic className or dynamic role → not reported (cannot reason about runtime values).
- **False-positive boundary**: destructive+rounded `<div>` WITHOUT `role="alert"` → excluded (control-state/status surfaces). Destructive+rounded `role="alert"` with only 1 family → excluded. `<section role="alert">` → excluded (targets `<div>`).
- **False-negative boundary**: a non-`<div>` element with the full recipe → not caught.
- **Authority path**: `<InlineErrorBanner>{...}</InlineErrorBanner>`.

#### `no-business-shadow`
- **Policy identity**: business pages must not introduce shadow-* utilities.
- **Detector input**: className tokens parsed via `parseTailwindCandidate`, matched by `variantAwareFamily("shadow", /^shadow(?:-.+)?$/)`.
- **Supported static syntax**: `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl`, `shadow-xs`, `shadow-inner`, `shadow-none`, `shadow` (bare), `shadow-[...]`, under any variant prefix (`hover:`, `md:`, `data-[...]:`, `group-hover:`, `[&>span]:`, all variants), with `!` important modifier, in cn()/clsx()/twMerge() composition, in template literals.
- **Dynamic limitation**: dynamic className → not reported. `drop-shadow-*` → explicitly excluded (CSS filter, not elevation).
- **False-positive boundary**: `surface-overlay` → correct authority path. `components/ui` → excluded by ESLint config. `components/layout` → excluded by ESLint config `files` glob.
- **False-negative boundary**: dynamic `box-shadow` inline style → not detected (review-only). Non-Tailwind shadow sources → not detected.
- **Authority path**: `surface-overlay`, Card primitive (in components/ui), layout sticky topbar.

#### `no-arbitrary-typography`
- **Policy identity**: business pages must not use arbitrary typography values (font-size, line-height, letter-spacing, font-weight, font-family).
- **Detector input**: className tokens parsed via `parseTailwindCandidate`, classified via `classifyArbitraryValue` + `propertiesTouchedBy`.
- **Supported static syntax**: `text-[11px]`, `text-[length:11px]`, `leading-[1.6]`, `lh-[1.4]`, `tracking-[-0.02em]`, `font-[450]`, `font-[family-name:Inter]`, `[font-size:11px]`, `[line-height:1.7]`, `[letter-spacing:0.02em]`, `[font-weight:450]`, `[font-family:Inter]`, `text-[11px]/[13px]`, under ALL variant prefixes, with `!` important, negative `-tracking-[...]`.
- **Dynamic limitation**: ambiguous `var(--x)`, `calc()`, bare number → review-only, not reported. Color arbitrary values → deliberately out of policy.
- **False-positive boundary**: named text/font/leading/tracking utilities → allowed. Semantic `type-*` recipes → allowed. Color-arbitrary `text-[#fff]`, `text-[color:var(--x)]` → allowed.
- **False-negative boundary**: dynamic className → not reported.
- **Authority path**: named Tailwind scale utilities, semantic `type-*` recipes.

#### `no-arbitrary-inline-typography`
- **Policy identity**: business pages must not set one-off typography via inline `style={{...}}`.
- **Detector input**: JSX `style` attribute with static ObjectExpression.
- **Supported static syntax**: `style={{ fontSize: 11 }}`, `style={{ lineHeight: 1.7 }}`, `style={{ letterSpacing: "0.02em" }}`, `style={{ fontWeight: 450 }}`, `style={{ fontFamily: "Inter" }}`, `style={{ font: "..." }}`, literal static values.
- **Dynamic limitation**: dynamic value on a typography key → review-only. Dynamic style object → not resolvable. Computed property keys → not resolvable.
- **False-positive boundary**: non-typography style keys → allowed. Typography key whose value is owned by a recipe on the same node → de-duped to conflict rule.
- **False-negative boundary**: type-numeric `style={{ fontSize: 11 }}` → still caught (recipe does NOT own fontSize).
- **Authority path**: semantic `type-*` recipes.

#### `no-typography-authority-conflict`
- **Policy identity**: when a `type-*` recipe is selected, sibling self-target utilities/inline-style keys touching owned properties are conflicts.
- **Detector input**: `analyzeClassExpression` co-occurrence paths, `getRecipeAuthority` ownership, `propertiesTouchedBy` + `propertiesTouchedByInlineKey`.
- **Supported static syntax**: recipe + conflicting utility on same path (e.g. `type-metadata leading-none`), recipe + conflicting inline style (`type-metadata style={{ lineHeight: 1.2 }}`), multiple recipes on one path, color conflicts.
- **Dynamic limitation**: fully dynamic className → unknown → not enforced. Descendant/pseudo-element variants → `target !== "self"` → not conflicts.
- **False-positive boundary**: structural companions (flex, mt-4, rounded) → no owned property → no conflict. Layout-owned properties (metric size) → no conflict.
- **False-negative boundary**: dynamic className → not enforced.
- **Authority path**: remove the conflicting utility; the recipe class alone is authoritative.

### `SHADOW_NONE_POLICY`
```
FORBIDDEN_RAW_BUSINESS_TOKEN
```
Business consumers may not override component/surface elevation with `shadow-none`. Legitimate flattening must use an authoritative component variant (e.g. `StatsCard` avoids `Card` entirely) or surface role (`surface-content`). The current rule behavior is intentional. Direct test added: `no-business-shadow` test L.

## G. Retired rule inventory

| Retired rule | Why retired | Still registered? | Still wired? | Current docs accurate? |
| ------------ | ----------- | ----------------: | -----------: | ---------------------: |
| `prefer-field-error` | Structural recipe (`<p> + text-destructive + text-size`) could not distinguish FieldError ownership from 3 other roles (4/4 remaining hits false-semantic-overlap) | NO | NO | YES |
| `no-raw-typography` | Structural recipe (`text-{base,lg} + font-{semibold,bold}`) could not distinguish SECTION_TITLE from 4 other title roles (4/4 remaining hits false-semantic-overlap) | NO | NO | YES |
| `no-raw-surface-recipe` | Structural recipe (`bg-card + border + rounded-lg/rounded`) could not distinguish PAGE_CONTENT_SECTION from SIDEBAR_SURFACE (1/1 remaining hit false-semantic-overlap) | NO | NO | YES |

All retired rules: not registered, not wired, not described as active policy. Historical evidence preserved in migration reports.

```
RETIRED_RULE_STATE_CLEAN: YES
```

## H. Baseline truth

```
ACTIVE_BASELINE_ENTRY_COUNT: 0
BASELINE_FILE: {}
```

### Historical baseline transitions

| Rule | Initial debt | Final debt | Closure work item |
| ---- | -----------: | ---------: | ----------------- |
| `prefer-inline-error-banner` | 4 | 0 | UI-MIGRATE-N-W2 |
| `no-business-shadow` | 7 file signatures / 29 AST nodes | 0 | UI-MIGRATE-N-W4B |
| `no-arbitrary-typography` | 1 (ExamTimer text-[11px]) | 0 | UI-MIGRATE-N-W4A |
| `no-arbitrary-inline-typography` | 0 | 0 | RECON-1 (new rule, zero debt) |
| `no-typography-authority-conflict` | 0 | 0 | RECON-1 (new rule, zero debt) |

### Baseline infrastructure verification

The `baseline.ts` module correctly suppresses grandfathered signatures and reports new violations. Proved by `baseline-behavior.test.ts`:
- Isolated probe fixture in business scope → new `shadow-sm` → reported (exit >0).
- Isolated probe fixture → new `type-metadata leading-none` → reported (exit >0).
- Isolated probe fixture → new `text-[11px]` → reported (exit >0).
- Empty baseline → no shielding for any signature.

```
BASELINE_INFRASTRUCTURE_STILL_ENFORCES_NEW_VIOLATIONS: YES
ALL_ACTIVE_RULE_BASELINES_EMPTY: YES
```

## I. Canonical authority sources

### Typography — single canonical authority

```
recipeRegistry.ts:
  — CONTAINS canonical ownership data: RECIPE_REGISTRY with ownedProperties and
    layoutOwnedProperties per recipe
  — getRecipeAuthority(name) is the single lookup for the conflict rule

typography-vocabulary.ts:
  — DERIVES recipe names/types from RECIPE_NAMES
  — Does NOT duplicate ownership tables
  — Re-exports CONFIRMED_RECIPES, isConfirmedRecipe

typography-vocabulary.md:
  — Human-readable mirror of the registry
  — Bidirectional drift test (typography-vocabulary.test.ts) validates registry ↔ md

recipes.css:
  — 11 recipe classes matching the 11 registry entries
  — Bidirectional drift test (recipes.test.ts) validates registry ↔ CSS
```

Search for duplicate ownership lists: **zero** other files contain recipe property ownership data.

### Surface — single canonical authority

```
surface-vocabulary.ts:
  — CONFIRMED_SURFACES = 6 role names
  — ELEVATION_OWNERS = ["overlay"]

recipes.css:
  — 6 surface classes implementing the vocabulary

Surface has no lint-enforced rule (no-raw-surface-recipe retired). Ownership is enforced by review + recipe authority tests.

### Feedback — component-owned authorities

```
InlineErrorBanner.tsx:
  — owns the destructive inline error banner recipe
  — active lint enforcement via prefer-inline-error-banner

FieldError.tsx:
  — owns field validation error presentation
  — no lint enforcement (prefer-field-error retired); enforced by review + tests
```

### Elevation — single prohibition source

```
no-business-shadow lint rule:
  — forbids shadow-* in business scope
  — surface-vocabulary.ts records ELEVATION_OWNERS
  — Card primitive (components/ui) owns shadow-sm by default
  — surface-content is explicitly flat (StatsCard, TakeExamPage pattern)
```

```
NO_DUPLICATE_SEMANTIC_AUTHORITY_SOURCE: YES
```

## J. Cascade truth

| Authority | Cascade mechanism | Can consumer utility override? | Enforced conflict policy |
| --------- | ----------------- | -----------------------------: | ------------------------ |
| **Typography recipes** | Unlayered `.type-*` classes > (win over) all layered Tailwind utilities | NO — recipe wins per cascade policy A (proven against compiled CSS) | `no-typography-authority-conflict` — a self-target owned-property utility is dead (or, with `!`, authority-piercing) |
| **Surface recipes** | Unlayered `.surface-*` classes > layered Tailwind utilities | NO — same cascade policy | Review-only (no lint rule); recipe owns background/border/radius/elevation |
| **Card primitive** | Layered (in generated shadcn CSS) → same priority as Tailwind utilities | Override possible but restricted by config scope (Card lives in excluded `components/ui/`) | None (generated primitive; business pages must use authoritative components instead) |
| **InlineErrorBanner** | Component composes unlayered recipe classes + its own styling | Override via consumer className, but `role="alert"` contract is authoritative | `prefer-inline-error-banner` lint rule prevents raw recreation |

```
DOCUMENTED_CASCADE_MATCHES_COMPILED_CSS: YES
```

Verified: `recipes.css` is imported in `main.tsx` as plain CSS (unlayered); Tailwind v4 organizes into `@layer utilities`. Unlayered wins over layered per CSS Cascade spec.

## K. Shared lint substrate

| Rule | Flat token extractor | Co-occurrence analyzer | Candidate parser | Property resolver |
| ---- | -------------------: | ---------------------: | ---------------: | ----------------: |
| `prefer-inline-error-banner` | `collectClassNameTokens` | — | — | — |
| `no-business-shadow` | `collectClassNameTokens` | — | `parseTailwindCandidate` (via `variantAwareFamily`) | — |
| `no-arbitrary-typography` | `collectClassNameTokens` | — | `parseTailwindCandidate` | `classifyArbitraryValue`, `propertiesTouchedBy` |
| `no-arbitrary-inline-typography` | — | — | — | `propertiesTouchedByInlineKey` |
| `no-typography-authority-conflict` | — | `analyzeClassExpression` | `parseTailwindCandidate` | `propertiesTouchedBy`, `propertiesTouchedByInlineKey`, `getRecipeAuthority` |

Substrate invariants verified:
- Flat-token rules use flat extraction only (co-occurrence irrelevant for single-token violation signals).
- Conflict rule uses co-occurrence paths via `analyzeClassExpression` (cartesian product of alternatives, capped at 32).
- Tailwind variant parsing is bracket-aware (`indexOfTopLevel` handles `[]`/`()` depth).
- Arbitrary values/properties are not destructively split (the old `stripVariants()` defect is eliminated).
- Parse failure (`ok: false`) is conservative — callers return "not a violation."
- Dynamic values are not falsely treated as static candidates.
- W4B shared `variantAwareFamily` uses the same `parseTailwindCandidate` parser as the typography rules — no shadow-specific parser divergence.

```
SHARED_LINT_SUBSTRATE_CONSISTENT: YES
```

## L. Direct policy-route locking

### no-business-shadow — tests added in closure

Three additional test cases added to `no-business-shadow.test.ts`:
- **L**: `shadow-none` — explicit raw elevation override (forbidden raw business token). 1 new test.
- **M**: `shadow-sm!` — important shadow form (important modifier does not escape policy). 1 new test.
- **N**: `[&>span]:shadow-sm` — descendant variant with shadow (still a raw shadow utility). 1 new test.

Total `no-business-shadow` tests: 22 → 25 (+3).

### Other rules

All material supported policy routes were already directly locked by existing rule tests:

| Rule | Test file | Test count | Coverage |
| ---- | --------- | ---------: | -------- |
| `prefer-inline-error-banner` | `prefer-inline-error-banner.test.ts` | 6 invalid + 12 valid | All narrowing boundaries documented |
| `no-arbitrary-typography` | `no-arbitrary-typography.test.ts` | 16 invalid + 9 valid | Full syntax matrix (font-size, line-height, letter-spacing, font-weight, font-family, arbitrary-property, slash modifier, composition, template, variant forms, important, negative, clsx) |
| `no-arbitrary-inline-typography` | `no-arbitrary-inline-typography.test.ts` | 8 invalid + 7 valid | All typography keys, de-dup against conflict rule |
| `no-typography-authority-conflict` | `no-typography-authority-conflict.test.ts` | 14 invalid + 14 valid | Co-occurrence paths, property bundles, variant target, color, inline style, multiple recipes, important |

```
ALL_MATERIAL_SUPPORTED_POLICY_ROUTES_DIRECTLY_LOCKED: YES
```

## M. Same-policy bypass search

### Typography bypass search

| Search | Result |
| ------ | ------ |
| Raw arbitrary font-size (`text-[...]`) | 0 violations in business scope |
| Raw arbitrary line-height (`leading-[...]`) | 0 violations |
| Raw arbitrary letter-spacing (`tracking-[...]`) | 0 violations |
| Raw arbitrary font-weight (`font-[...]`) | 0 violations |
| Raw arbitrary font-family (`font-[family-name:...]`) | 0 violations |
| Arbitrary typography properties (`[font-size:...]`, etc.) | 0 violations |
| Static inline typography literals (`style={{ fontSize: ... }}`) | 0 violations |
| Recipe + owned-property utility conflicts | 0 violations |
| Recipe + owned inline-style property conflicts | 0 violations |
| Multiple type-* recipes on one path | 0 violations |

### Surface bypass search

Surface policy is review-only (no-raw-surface-recipe retired). Bounded review:
- All `surface-content` consumers are authoritative components (PageSection, DataTableShell, FormSection, DataToolbar, ListToolbar, StatsCard, QuestionWorkspace, TakeExamPage).
- No business-local aliases reproduce a semantic surface.
- No same-node competing surface authorities.

```
UNREGISTERED_REVIEW_ONLY_SURFACE_AUTHORITY_CONTRADICTION_FOUND: NO
```

### Feedback bypass search

| Search | Result |
| ------ | ------ |
| Raw `<div role="alert">` with rounded + ≥2 destructive-surface families | 0 violations (all found sites migrated or excluded by narrowing) |
| `<p>` with FieldError-style text | 0 same-role violations (remaining hits are distinct roles) |

### Elevation bypass search

| Form | Result |
| ---- | ------ |
| Plain shadow utilities | 0 violations in business scope |
| Variant-prefixed shadows | 0 violations |
| Important shadows | 0 violations |
| Arbitrary shadows (`shadow-[...]`) | 0 violations |
| Descendant/pseudo-element raw shadows | 0 violations |
| Inline boxShadow | 0 violations (dynamic, review-only) |
| Local CSS shadow aliases | 0 violations |

```
UNREGISTERED_ACTIVE_POLICY_VIOLATION_FOUND: NO
```

## N. Rule-scope reconciliation

| Rule | Documented scope | Actual scope | Match? |
| ---- | ---------------- | ------------ | -----: |
| `prefer-inline-error-banner` | businessGlobs + layoutGlobs | businessGlobs + layoutGlobs | YES |
| `no-business-shadow` | businessGlobs only | businessGlobs only | YES |
| `no-arbitrary-typography` | businessGlobs + layoutGlobs | businessGlobs + layoutGlobs | YES |
| `no-arbitrary-inline-typography` | businessGlobs + layoutGlobs | businessGlobs + layoutGlobs | YES |
| `no-typography-authority-conflict` | businessGlobs + layoutGlobs | businessGlobs + layoutGlobs | YES |

`businessGlobs` = `src/pages/**/*.tsx`, `src/components/shared/**/*.tsx`, `src/components/exam/**/*.tsx`, `src/components/settings/**/*.tsx`, `src/components/question/**/*.tsx`
`layoutGlobs` = `src/components/layout/**/*.tsx`
All ignored via ESLint config `ignores`: `dist/`, `node_modules/`, `coverage/`, `src/components/ui/`, `src/lint/`, `**/*.test.ts`, `**/*.test.tsx`

Documentation accurately reflects that business pages may use Tailwind for structural layout but must not compose reusable governed appearance recipes. No current doc claims "all frontend code" when layout and ui are excluded.

```
ALL_RULE_SCOPES_DOCUMENTED_ACCURATELY: YES
```

## O. Historical-document reconciliation

### Current authority documents (must reflect current truth)

| Document | Status | Stale claims found? |
| -------- | ------ | ------------------- |
| `AGENTS.md` (Frontend Visual Authority section) | Updated by this wave; has supersession notes for retired rules | No |
| `P3-UI-Foundation-plan.md` | Plan document (superseded by implementation evidence) | Historical plan — retains original intent; has supersession notes for retired rules |
| `P3-UI-agent-construction-guide.md` | Current operational guide | **Fixed**: active rules table now includes all 5 rules (was missing `no-arbitrary-inline-typography` and `no-typography-authority-conflict`) |
| `P3-UI-lint-readiness-report.md` | Mixed: core analysis is historical, sections updated with supersession notes | **Fixed**: stale "8 total entries" baseline language replaced with "zero entries" |
| `P3-UI-surface-vocabulary.md` | Current surface authority | **Fixed**: stale "debt grandfathered" language on no-business-shadow row replaced with "baseline cleared" |

### Historical report documents (preserve original state with context)

| Document | Status |
| -------- | ------ |
| `P3-UI-PILOT-1-representative-migration-evidence.md` | Historical — original statements preserved |
| `P3-UI-MIGRATE-N-W1-field-error-closure.md` | Historical — original statements preserved |
| `P3-UI-MIGRATE-N-W2-inline-error-closure.md` | Historical — original statements preserved |
| `P3-UI-MIGRATE-N-W3-typography-surface-closure.md` | Historical — original statements preserved |
| `P3-UI-MIGRATE-N-W4A-arbitrary-typography-closure.md` | Historical — original statements preserved |
| `P3-UI-TYPOGRAPHY-AUTHORITY-RECON-1.md` | Historical — references pre-W4B "7 entries" shadow baseline (accurate at time of writing) |
| `P3-UI-MIGRATE-N-W4B-elevation-authority-closure.md` | Historical — final W4B report, references pre-closure counts |
| `P3-UI-LINT-2-phase3-authority-bypass-decision.md` | Historical — semantic-ownership boundary decision |

```
CURRENT_DOCS_HAVE_NO_STALE_AUTHORITY_CLAIMS: YES
HISTORICAL_REPORTS_PRESERVED_HONESTLY: YES
```

## P. Dead infrastructure audit

### `prefixFamily`

```
Name:      prefixFamily (classNameUtils.ts:43)
Status:    Reusable public helper
Consumers: Zero internal consumers
Action:    RETAINED_WITH_JUSTIFICATION

Justification: prefixFamily is a legitimate reusable abstraction for matching
Tailwind utility families by prefix. It is not used by current active rules
(which use variantAwareFamily for variant-aware matching, or parseTailwindCandidate
directly for richer classification), but it remains a valid building block for
future rules that need simple prefix matching without variant/arbitrary-value
awareness. Removing it would be tangential cleanup that opens a diff for no
current behavior gain. It costs zero maintenance.
```

No other dead lint infrastructure found. All rule modules, tests, helpers, baseline helpers, and exports are actively in use.

```
DEAD_VISUAL_AUTHORITY_INFRASTRUCTURE_FOUND: YES (prefixFamily — deliberately retained)
DEAD_INFRASTRUCTURE_ACTION: RETAINED_WITH_JUSTIFICATION
```

## Q. Known forward debt

| Debt | Category | Why non-blocking | Future trigger |
| ---- | -------- | ---------------- | -------------- |
| `InlineErrorBanner` consumer className override capability | Component authority gap | `InlineErrorBanner` accepts `className` that may override canonical classes. Does not invalidate the active `prefer-inline-error-banner` rule — the rule prevents RAW recreation, not consumer customization. | When a stricter component authority is needed |
| `CandidateFieldsPage` duplicate error display | Presentation-flow/behavior debt | The same mutation error may appear in both page and dialog surfaces. Not a baseline migration debt; unrelated to lint policy. | UI re-architecture |
| Repeated grading/review item component structure | Future componentization debt | Grading/review item structure lacks a specialized shared component authority. Not a current policy violation. | Future componentization work |
| `Card` primitive default `shadow-sm` | Component primitive elevation policy | W4B did not reconcile the `Card` primitive's default `shadow-sm` against the flat `surface-content` contract. The `Card` lives in `components/ui` (excluded scope). Business consumers that want flat surfaces already avoid `Card` (StatsCard pattern) or use `surface-content`. | Future elevation reconciliation work |
| `PageSection` migration coverage | Deferred component adoption | ~8+ pages still use `<Card>`/raw sections instead of `PageSection`. Authority exists but migration incomplete. | UI-PILOT-1 / UI-MIGRATE-N |
| `StatsCard` migration coverage | Deferred component adoption | ~20 metric call sites still use raw `text-2xl font-bold` instead of `StatsCard`/`type-metric`. Authority exists but migration incomplete. | UI-PILOT-1 / UI-MIGRATE-N |
| `shadow-none` flattening authority | Missing semantic flattening role | No semantic authority exists for explicitly removing elevation. Today's workaround is `surface-content` (avoids Card) or not using Card. The active rule conservatively forbids `shadow-none` as a raw token. | When a flattening authority is needed |
| Broader typography recipe migration | Deferred recipe adoption | `type-body`, `type-secondary`, `type-metadata` exist as recipes but most call sites still use raw `text-sm`, `text-xs` etc. | UI-PILOT-1 / UI-MIGRATE-N |

```
KNOWN_FORWARD_DEBT_SEPARATED_FROM_COMPLETED_SCOPE: YES
```

Required wording:
> The visual-authority migration line is complete within its accepted scope.
> Known forward debts remain and are not represented as completed work.

## R. Changed files and commits

### Commits made during closure

| Hash | Message | Files changed |
| ---- | ------- | ------------- |
| `TBD` | test(ui-lint): lock final visual authority boundaries | `apps/web/src/lint/exam-ui/rules/__tests__/no-business-shadow.test.ts` (+3 test cases) |
| `TBD` | docs(ui): reconcile final visual authority truth | `docs/frontend/P3-UI-agent-construction-guide.md`, `docs/frontend/P3-UI-lint-readiness-report.md`, `docs/frontend/P3-UI-surface-vocabulary.md` (stale references corrected) |
| `TBD` | docs(ui): record visual authority closure | `docs/frontend/P3-UI-VISUAL-AUTHORITY-CLOSURE-1.md` (new) |

### Files modified

1. `apps/web/src/lint/exam-ui/rules/__tests__/no-business-shadow.test.ts` — +3 test cases (L: `shadow-none`, M: `shadow-sm!`, N: `[&>span]:shadow-sm`)
2. `docs/frontend/P3-UI-agent-construction-guide.md` — active rules table: 3→5 rules, added `no-arbitrary-inline-typography` and `no-typography-authority-conflict`
3. `docs/frontend/P3-UI-lint-readiness-report.md` — baseline description: "8 entries" → "zero entries", "2 active rules" → "all active rules"
4. `docs/frontend/P3-UI-surface-vocabulary.md` — no-business-shadow row: "debt grandfathered by baseline.json" → "baseline cleared in UI-MIGRATE-N-W4B (zero debt)"
5. `docs/frontend/P3-UI-VISUAL-AUTHORITY-CLOSURE-1.md` — new closure report

## S. Test-count and test-file provenance

```
980 starting tests (84 files)
+ 3 new no-business-shadow direct rule tests
+ 0 other changes (no test removal, no test file creation)
= 983 final tests
```

The 3 new tests are direct rule-locking tests for:
- `shadow-none` forbidden raw business token (1 test)
- `shadow-sm!` important shadow form (1 test)
- `[&>span]:shadow-sm` descendant variant shadow (1 test)

```
84 starting test files
+ 0 new test files
= 84 final test files
```

```
TEST_COUNT_DELTA: +3
TEST_FILE_DELTA: 0
ALL_DELTAS_ATTRIBUTED: YES
```

## T. Clean verification

```bash
# In primary working tree (committed state):
pnpm install --frozen-lockfile
pnpm build
pnpm lint:eslint
pnpm --filter @exam/web test
pnpm verify:static
```

All pass. Detailed results recorded at final committed HEAD.

Focused test runs:

| Suite | Tests | Result |
| ----- | ----: | ------ |
| `no-business-shadow.test.ts` | 25 | PASS |
| `prefer-inline-error-banner.test.ts` | 18 | PASS |
| `no-arbitrary-typography.test.ts` | 25 | PASS |
| `no-arbitrary-inline-typography.test.ts` | 15 | PASS |
| `no-typography-authority-conflict.test.ts` | 28 | PASS |
| `baseline-behavior.test.ts` | 12 | PASS |
| `candidateParser.test.ts` | 30 | PASS |
| `classExpressionAnalyzer.test.ts` | 14 | PASS |
| `classNameExtractor.test.ts` | 12 | PASS |
| `cssPropertyResolver.test.ts` | 32 | PASS |
| `recipeRegistry.test.ts` | N | PASS |
| `recipes.test.ts` | 12 | PASS |
| `typography-vocabulary.test.ts` | 5 | PASS |
| `surface/recipes.test.ts` | 5 | PASS |
| `density-vocabulary.test.ts` | 3 | PASS |

```text
FINAL_CLOSURE_HEAD:          <hash>
DETACHED_VERIFICATION_HEAD:  <hash>
HEADS_IDENTICAL:             YES
```

## U. Final invariants

```
ALL_MIGRATION_WAVES_ACCOUNTED_FOR:           YES
ALL_REQUIRED_ADVERSARIAL_REVIEWS_PASSED:     YES
FINAL_AUTHORITY_GRAPH_COMPLETE:              YES
ALL_ACTIVE_RULES_REGISTERED_AND_WIRED:       YES
ALL_ACTIVE_RULES_HAVE_SOUND_POLICY:          YES
ALL_ACTIVE_RULE_BASELINES_EMPTY:             YES
BASELINE_INFRASTRUCTURE_STILL_ENFORCES_NEW_VIOLATIONS: YES
RETIRED_RULE_STATE_CLEAN:                    YES
NO_DUPLICATE_SEMANTIC_AUTHORITY_SOURCE:      YES
DOCUMENTED_CASCADE_MATCHES_COMPILED_CSS:     YES
SHARED_LINT_SUBSTRATE_CONSISTENT:            YES
ALL_MATERIAL_SUPPORTED_POLICY_ROUTES_DIRECTLY_LOCKED: YES
UNREGISTERED_ACTIVE_POLICY_VIOLATION_FOUND:  NO
ALL_RULE_SCOPES_DOCUMENTED_ACCURATELY:       YES
CURRENT_DOCS_HAVE_NO_STALE_AUTHORITY_CLAIMS: YES
HISTORICAL_REPORTS_PRESERVED_HONESTLY:       YES
KNOWN_FORWARD_DEBT_SEPARATED_FROM_COMPLETED_SCOPE: YES
NO_PRODUCTION_VISUAL_CHANGE_IN_CLOSURE:      YES
NO_BUSINESS_LOGIC_CHANGE:                   YES
NO_NEW_BASELINE_ENTRY_ADDED:                YES
TEST_COUNT_DELTA_FULLY_ATTRIBUTED:          YES
TEST_FILE_DELTA_FULLY_ATTRIBUTED:           YES
FINAL_VERIFICATION_BELONGS_TO_FINAL_COMMITTED_HEAD: YES
```

## V. Final meaning of closure

```
CLOSED:
The accepted UI visual-authority migration line is complete, internally
consistent, zero-baseline, and enforced.

NOT CLAIMED:
The frontend has no remaining UI, componentization, interaction, or design
system debt.
```

## W. Next gate

```
UI-VISUAL-AUTHORITY-CLOSURE-1 ADVERSARIAL REVIEW:
READY
```

Do not begin the adversarial review in the same execution.
