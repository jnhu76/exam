# UI-TYPOGRAPHY-AUTHORITY-RECON-1 — Typography Policy, Parser, Ownership, and Cascade Reconstruction

> Supersedes the narrow patch proposed as `UI-MIGRATE-N-W4A-CORRECTIVE-1` and the
> closure record `P3-UI-MIGRATE-N-W4A-arbitrary-typography-closure.md` (which
> remains the historical W4A record; a supersession note is added there in C8).
>
> Starting HEAD: `ced0451` (verified).
>
> This document is the **complete architecture record** for the typography
> authority system. Sections marked *(committed in C1)* carry decision-only
> content; sections marked *(completed in C8)* are finalized after
> implementation.

## 0. Required outcome

```text
one documented typography policy
one bracket-aware Tailwind candidate parser
one explicit arbitrary-typography grammar
one machine-readable recipe ownership registry
one deterministic recipe-conflict rule
one proven cascade model
zero unresolved conflicts among current type-* consumers
complete tests for supported syntax and known bypass routes
synchronized source, tests, docs, and lint wiring
```

## 1. Hard boundaries (scope)

Allowed: typography lint utilities + parser substrate; `no-arbitrary-typography`;
its rule tests; baseline behavior tests; lint plugin registration + ESLint wiring;
typography vocabulary TS/MD; typography recipe definitions + tests; typography
authority documentation; current business consumers that already use a `type-*`
recipe and contain a proven conflicting primitive utility; `ExamTimer` typography
classes + focused tests; shared lint utilities used by active rules; tests for
other active rules if required to prove parser compatibility; cascade-model
comments; the inaccurate cascade-layer comment in `surface/recipes.css`; W4A
evidence; this new evidence document; a new deterministic recipe-conflict rule.

Forbidden: begin shadow/elevation migration; remove or migrate any `shadow-*`;
change the `no-business-shadow` decision or its seven-entry baseline; migrate new
pages to typography recipes merely because raw typography is present; resurrect
retired semantic proxies (`no-raw-typography`); infer semantic roles from text /
variable names / translation keys / file names; create a new typography recipe for
one consumer; change timer arithmetic / thresholds / cadence / callbacks /
displayed value; migrate StatsCard/metric debt; migrate PageSection or surface
authorities; add baseline entries to conceal defects; weaken a documented policy
to make implementation easier; claim support for syntax the detector does not
parse; implement a full Tailwind compiler or copy Tailwind internals blindly.

## 2. Recorded committed state (committed in C1)

| Item | Committed truth |
| --- | --- |
| reconstruction starting HEAD | `ced0451` |
| active UI lint rules | `prefer-inline-error-banner`, `no-business-shadow`, `no-arbitrary-typography` (all `"error"` in business + layout globs) |
| active typography rule wiring | `no-arbitrary-typography: "error"` in business + layout globs |
| arbitrary typography baseline | empty |
| shadow baseline | 7 entries (byte-identical, untouched) |
| current recipe count | 11 (`type-*`) |
| current `type-*` consumers | 14 sites (enumerated in §13, completed in C8) |
| current shared token extractor | `collectClassNameTokens` + `findClassNameAttribute` in `classNameUtils.ts` |

## 3. Official Tailwind syntax findings (research, committed in C1)

Researched via Context7 (`/tailwindlabs/tailwindcss.com`, Tailwind v4.3) and the
compiled project CSS. The repository parser owns exactly this subset:

- **Variants** stack left-to-right and may be combined: responsive (`sm:`/`md:`…),
  state (`hover:`/`focus:`/`active:`/`disabled:`), group/peer
  (`group-hover:`/`peer-focus:`), `data-[attr=val]:`, `aria-invalid:`,
  `supports-[display:grid]:`, arbitrary `[&>span]:`, group-arbitrary
  `group-[.is-published]:`, theme (`dark:`).
- **Important modifier** is a trailing `!` (v4): `text-[11px]!`.
- **Negative utility** is a leading `-`: `-tracking-[0.02em]`.
- **Arbitrary value:** `text-[11px]`, `text-[length:11px]` (data-type hint —
  colon INSIDE brackets), `text-[var(--x)]` (ambiguous), `text-[calc(...)]`.
- **Arbitrary property:** `[font-size:11px]`, `[color:red]` — whole token
  bracketed; colon separates property:value.
- **Slash line-height modifier:** `text-sm/[17px]`, `text-[11px]/[13px]`.
- **CSS shorthand:** `[font:500_12px/1_sans-serif]`.
- **Critical utility fact (docs-verified):** every named `text-{xs..9xl}` sets
  BOTH `font-size` AND `line-height`. Utilities must therefore be modeled by
  their full CSS-property bundle, not as size-only.

Current `stripVariants()` in `no-arbitrary-typography.ts` does `indexOf(":")` in
a loop WITHOUT bracket awareness → corrupts `[length:11px]`, `[&>span]`, `var(--x)`.

## 4. Typography-expression route inventory (committed in C1)

| Expression route | Exists in repo? | Current enforcement | Policy status |
| --- | --- | --- | --- |
| named `text-*`/`leading-*`/`tracking-*`/`font-*`/`tabular-nums` | yes (wide) | none (not a policy target) | allowed |
| arbitrary `text-[11px]`/`leading-[1.7]`/`tracking-[…]` | no (ExamTimer cleared in W4A) | `no-arbitrary-typography` | enforced |
| `text-[length:11px]` / data-type hint | no | NOT detected (parser defect) | enforced after C6 |
| `[font-size:11px]` arbitrary property | no | NOT detected | enforced after C6 |
| slash line-height modifier `text-[11px]/[13px]` | no | NOT detected | enforced after C6 |
| `font-[450]` (weight) / `font-[family-name:…]` | no | NOT detected | enforced after C6 |
| variant forms `md:text-[11px]`, `[&>span]:text-lg` | no | variant stripped (bracket-unsafe) | enforced (self-target) after C6 |
| inline JSX `style={{ fontSize: 11 }}` | no (zero in lint scope) | none | enforced via companion rule after C6 |
| local CSS one-offs in business CSS | no business-owned CSS modules in scope | none | out of scope (no business CSS) |

## 5. Typography policy categories (committed in C1)

The phrase "no arbitrary `text-[…]`" is imprecise because `text-[…]` can mean
font-size OR color. Policy separates:

```text
NO_ARBITRARY_TYPOGRAPHY_POLICY_CATEGORIES:
  font-size
  line-height
  letter-spacing
  font-weight
  font-family
```

Excluded categories and their owners:

| Candidate | CSS meaning | Typography policy owner? | Real owner |
| --- | --- | --- | --- |
| `text-[11px]` | font-size | YES | typography |
| `text-[length:11px]` | font-size | YES | typography |
| `text-[color:var(--x)]` | color | NO | color/token policy |
| `text-[#123456]` | color | NO | color/token policy |
| `leading-[1.7]` | line-height | YES | typography |
| `tracking-[0.02em]` | letter-spacing | YES | typography |
| `font-[450]` | font-weight | YES | typography |
| `font-[family-name:…]` | font-family | YES | typography |
| `[font-size:11px]` | font-size | YES | typography |
| `[color:red]` | color | NO | color/token policy |
| `text-[var(--x)]` | ambiguous | UNKNOWN | review-only (requires type hint) |

## 6. Parser boundary (committed in C1, realized in C2)

The shared candidate parser recognizes structural regions (variant prefix,
important, negative, base utility, arbitrary value, arbitrary property, slash
modifier, bracket contents, parenthesis contents, escaped characters) WITHOUT
fully validating Tailwind. Principles:

```text
colon outside balanced brackets/parentheses → may separate variants
colon inside [...]                          → data-type/value content, never a variant separator
slash outside balanced brackets             → may represent a modifier
escaped delimiter                           → not structural
unbalanced syntax                           → return ok:false (UNKNOWN), never invent meaning
```

Forbidden: `split(":")`, `lastIndexOf(":")`, repeated `indexOf(":")` without
balanced-structure awareness.

### Variant TARGET dimension (realized in C2)

A parsed candidate carries a `target` independent of its variant category:

```text
target = self          hover:/focus:/disabled:/data-[…]:/aria-invalid:/group-hover:/peer-focus:/dark:/md:/supports-*:
target = descendant     [&>span]: / *: / **: / [&_p]:
target = pseudo-element before:/after:/placeholder:/marker:/first-letter:/selection:
target = unknown        unparseable arbitrary variant
```

The recipe-conflict rule fires ONLY for `target = self`; descendant /
pseudo-element variants do NOT conflict with the root recipe; unknown is
review-only.

## 7. Cascade policy (committed in C1) — PROVEN

Independently verified against the compiled CSS (`apps/web/dist/assets/*.css`):

- Tailwind declares layers `properties, theme, base, components, utilities`.
- The `.type-*` recipes (imported as plain CSS via `main.tsx`, NOT layered) are
  emitted AFTER the entire `@layer utilities{…}` block — i.e. UNLAYERED.

Per the CSS Cascade specification, **unlayered styles WIN over all layered
styles regardless of source order.** Therefore:

```text
TYPOGRAPHY_CASCADE_POLICY: A — RECIPES OWN AND WIN
```

Consequences:
- Authority-owned properties CANNOT be overridden by business utilities.
- `allowedStateOverrides` is dropped from the registry: it would record a
  permission that cannot take effect at runtime (a layered `hover:font-bold`
  still loses to the unlayered recipe).
- State/interaction changes belong to recipe variants, authoritative component
  variants, or semantic state classes — NOT to business primitive-utility
  overrides of recipe-owned properties.
- Any self-target utility touching a recipe-owned property is a conflict,
  regardless of variant category. The `!` important modifier additionally can
  pierce authority and is always a conflict on an owned property.

The stale comment in `surface/recipes.css` ("unlayered custom CSS is overridden
by utility classes") is BACKWARDS and is corrected in C8.

## 8. Recipe ownership registry (committed in C1, realized in C3)

`recipeRegistry.ts` is the SINGLE canonical machine-readable authority. The
module layering is:

```text
cssPropertyResolver.ts / classExpressionAnalyzer.ts   ← leaf type+logic modules
recipeRegistry.ts          ← THE canonical authority (roles + owned + layout-owned)
typography-vocabulary.ts   ← re-exports public names/types FROM registry
typography-vocabulary.md   ← human mirror; registry table GENERATED, equality-tested
recipes.css                ← implementation; CSS↔registry drift test bidirectional
```

Property type is `RecipeOwnedProperty` (covers non-typography props too):

```text
font-family | font-size | line-height | font-weight | letter-spacing |
color | font-variant-numeric | white-space | min-height | overflow-x
```

### Resolved contradiction — long-response `min-height`

PRE-EXISTING contradiction (found in C1):
- `typography-vocabulary.md` listed `min-height` as an OWNED property of
  `long-response`;
- `recipes.css` did NOT declare `min-height`;
- the real consumer `GradingDetailPage.tsx:213` uses `type-long-response min-h-16`.

**Resolution (recorded authoritatively): `min-height` is LAYOUT-OWNED for
long-response.** It aligns with the CSS implementation and the consumer; the
vocabulary Markdown is corrected (the owned-properties column drops min-height);
CSS is unchanged (already omits it); the consumer's `min-h-16` is VALID. This is
a closed pre-existing contradiction, not a silent change. `type-code` keeps
`white-space` + `overflow-x` as genuinely OWNED (both are declared in CSS today).

Registry entries (canonical — see `recipeRegistry.ts` for the source of truth):

| Recipe | ownedProperties | layoutOwnedProperties |
| --- | --- | --- |
| page-title | family, size, line-height, weight, letter-spacing, color | — |
| page-description | family, size, line-height, weight, color | — |
| section-title | family, size, line-height, weight, color | — |
| body | family, size, line-height, weight, color | — |
| secondary | family, size, line-height, weight, color | — |
| metadata | family, size, line-height, weight, color | — |
| reading | family, size, line-height, weight, color | — |
| long-response | family, size, line-height, weight, color, white-space | min-height |
| metric | family, weight, color, font-variant-numeric | size, line-height |
| numeric | font-variant-numeric | size, line-height, family, weight |
| code | family, size, line-height, weight, white-space, overflow-x | — |

Key distinctions that survive:
- `type-metric` with `text-3xl` is VALID — metric's size+line-height are
  layout-owned, and `text-3xl` touches only those.
- `type-numeric` with `text-sm font-mono` is VALID — size/family/weight are
  layout-owned.
- `type-section-title` with `text-lg font-semibold` is a CONFLICT — size,
  line-height, and weight are all owned.
- `type-metadata` with `leading-none` is a CONFLICT (line-height owned) — and
  the class is also dead under cascade policy A.

## 9. Color + shorthand boundary (committed in C1)

Two independent questions are kept separate:

1. **Global arbitrary-typography ban** (`no-arbitrary-typography`): text-color is
   OUT-OF-POLICY (owned by the future color/token authority). `text-[color:…]`
   and `text-[#fff]` are NOT reported here.
2. **Recipe authority conflict** (`no-typography-authority-conflict`): text-color
   utilities DO touch the `color` property, which most recipes OWN. So
   `type-section-title text-red-500` IS a conflict, even though the global
   arbitrary rule lets the color token through.

CSS shorthand expansion (`[font:…]`, inline `style={{font:…}}`) expands to its
sub-property bundle and conflicts on each owned sub-property. Ambiguous values
(`text-[var(--x)]`, `font-[var(--x)]`, `text-[calc(...)]`) return
`unknown/requires-type-hint` and are REVIEW-ONLY everywhere. The parser returns
structure; the classifier decides; policy is never guessed.

## 10. Co-occurrence + de-dup policy (committed in C1)

- `classExpressionAnalyzer` returns co-occurrence `alternatives: string[][]`
  (combination-capped; >32 → unknown/review-only). Each path is checked
  independently — `cond ? "type-metadata" : "type-metric text-3xl"` produces no
  cross-path false conflict. Static fragments (`text-${size}`) are NOT treated
  as complete candidates.
- Two `type-*` recipes on one path → `MULTIPLE_TYPE_RECIPES_ON_SAME_PATH` error.
- Report de-dup: a recipe-node inline-style owned-property key is reported ONLY
  by the conflict rule (the inline companion yields); a recipe non-owned
  property (e.g. `type-numeric` size) is reported by the inline companion. One
  accurate diagnostic per node.

## 11–24. *(completed in C8)*

The implementation evidence, consumer audit (§13), ExamTimer resolution (§14),
arbitrary-typography enforcement matrix (§15), text-color boundary (§16),
baseline truth (§19), documentation reconciliation (§20), test-count provenance
(§22), verification (§22), changed files and commits (§T), final invariants
(§23), and final report (§24) are appended in Commit 8 after implementation
completes.
