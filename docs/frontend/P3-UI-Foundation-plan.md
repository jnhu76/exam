# Phase 3 UI Foundation Plan

## Semantic Visual Authority, Chinese Typography, and Component Adoption

## 1. Purpose

The current frontend does not primarily suffer from an incomplete component library or an inconsistent color palette.

The audit established that the color system is already largely semantic and centralized, while the major structural weaknesses are:

* uncontrolled Chinese font fallback;
* loaded CJK font assets that are not authoritative in the active font stack;
* missing semantic typography roles;
* repeated visual recipes expressed directly through primitive Tailwind utilities;
* multiple components competing for similar visual roles;
* authoritative shared components that can be freely bypassed by business pages;
* no deterministic enforcement preventing new visual-language drift.

This work establishes an explicit visual authority model for the Exam frontend.

The objective is not to eliminate Tailwind.

The objective is to make Tailwind an implementation substrate rather than the business-facing visual language.

The target authority chain is:

```text
Visual principles
        ↓
Semantic tokens
        ↓
Semantic recipes
        ↓
Authoritative components
        ↓
Business pages
```

Business pages remain responsible for structure and responsive layout.

Business pages must no longer independently compose reusable appearance recipes from primitive Tailwind typography, surface, elevation, or domain-status utilities.

---

## 2. Design principles

The Exam UI should be:

```text
calm
precise
restrained
reading-oriented
operational
```

It is an examination workspace.

It is not:

* a SaaS marketing surface;
* a dashboard made entirely from floating cards;
* a government information portal;
* an English-first UI with Chinese rendered through accidental OS fallback.

Visual quality should primarily come from:

* intentional typography;
* controlled visual hierarchy;
* consistent spacing;
* stable semantic roles;
* limited elevation;
* clear content measure;
* predictable component anatomy.

Shadows, gradients, excessive rounded surfaces, or decorative effects must not be used as substitutes for hierarchy.

---

## 3. Visual authority model

The frontend visual system shall contain four authority layers.

### 3.1 Physical tokens

Physical implementation values.

Examples:

```text
font face
font weight
font size
line height
spacing
radius
raw color values
```

Physical tokens are implementation facts.

Business pages must not depend directly on physical token identity where a semantic role exists.

Examples of physical facts:

```text
Noto Sans CJK SC
Noto Serif CJK SC
400
500
700
14px
20px
#f7f8fb
```

These values do not express product meaning.

---

### 3.2 Semantic tokens

Semantic tokens describe visual roles.

Initial domains include:

#### Font roles

```text
font.ui
font.reading
font.serif
font.mono
```

#### Text roles

```text
text.primary
text.secondary
text.subtle
text.critical
```

#### Surface roles

```text
surface.page
surface.content
surface.subtle
surface.work
surface.attention
surface.overlay
```

#### Border roles

```text
border.subtle
border.default
border.strong
border.interactive
border.critical
```

#### Elevation roles

The initial elevation vocabulary should remain deliberately small:

```text
elevation.none
elevation.overlay
```

Ordinary business content must not gain elevation merely because it is represented using a Card component.

#### Status roles

The existing status tone model remains authoritative unless evidence demonstrates a defect:

```text
primary
secondary
success
warning
destructive
info
muted
```

`statusMeta.ts` remains the authority for domain status to tone mapping.

Business pages must not independently assign domain status colors.

---

### 3.3 Semantic recipes

A semantic recipe binds multiple physical or semantic values into one visual decision.

Typography is the first required recipe domain.

Initial candidate typography recipes:

```text
type-page-title
type-page-description

type-section-title
type-section-description

type-body
type-secondary
type-metadata
type-helper

type-reading
type-long-response

type-metric
type-numeric

type-code
```

A typography recipe owns, as applicable:

```text
font family
font size
font weight
line height
letter spacing
text color
```

Business pages must not reproduce an existing typography recipe by composing primitive utilities such as:

```text
text-sm
font-medium
leading-5
tracking-tight
text-muted-foreground
```

The implementation may use Tailwind v4 custom utilities or another project-local CSS mechanism.

The public authority is the semantic recipe name, not the underlying Tailwind recipe.

Semantic recipes must be derived from observed application roles.

Do not create recipes solely for visual convenience or one-off page styling.

---

### 3.4 Authoritative components

A visual role becomes an authoritative component when it owns stable structure, behavior, accessibility, or variants in addition to appearance.

Examples of likely authoritative roles include:

```text
status presentation
field error
inline error feedback
metric presentation
tabular work surface
page header
empty state
loading state
row actions
```

A component does not become authoritative merely because duplicate JSX exists.

Authority requires a stable semantic role.

For each shared visual component, the project must identify:

```text
semantic role
owned anatomy
owned appearance recipe
supported variants
known bypass patterns
```

Two components must not independently claim the same visual role without an explicit semantic distinction.

Existing collisions such as:

```text
PageSection
ContentCard
DataTableShell
```

must be reviewed against semantic roles before additional shared containers are introduced.

---

## 4. Tailwind boundary

Tailwind remains part of the frontend implementation.

The boundary is not:

```text
business pages cannot use Tailwind
```

The boundary is:

```text
business pages cannot independently compose reusable appearance recipes
from primitive Tailwind utilities when a semantic authority exists
```

### 4.1 Freely allowed in business pages

Structural and responsive utilities remain normal.

Examples:

```text
flex
grid
block
hidden

relative
absolute
fixed
sticky

items-*
justify-*

grid-cols-*
col-span-*

w-*
h-*
min-*
max-*

overflow-*

gap-*
space-*

responsive variants
```

Business pages own placement, layout, responsive arrangement, and page-specific structure.

Example:

```tsx
<div className="grid gap-4 lg:grid-cols-4">
```

This is valid business-page Tailwind usage.

---

### 4.2 Semantic-authority controlled

The following visual domains should progressively move behind semantic recipes, variants, or authoritative components:

```text
font family
font size
font weight
line height
letter spacing

text hierarchy
surface color
border color
radius
elevation

domain status tone
reading measure
content density
```

Primitive utilities in these domains are not immediately globally forbidden.

They become restricted as semantic authorities are introduced and migrated.

This avoids creating a lint policy before a valid replacement exists.

---

### 4.3 High-confidence forbidden patterns

The initial authority gate should target only high-confidence violations.

Candidates include:

```text
raw domain status tone in business pages
business-page shadow utilities
arbitrary typography values
known FieldError bypass recipes
known InlineErrorBanner bypass recipes
```

All restrictions require narrowly defined allowlists for:

```text
components/ui
authoritative shared components
semantic recipe implementation files
overlay primitives where elevation is intentional
```

---

## 5. Implementation sequence

The work must be performed in the following order.

---

# UI-PLAN-0 — Visual Authority Planning Baseline

## Goal

Establish this plan as the project authority for the UI foundation work.

## Work

* record the audit findings accepted as baseline evidence;
* define the four-layer visual authority model;
* define the initial execution order;
* explicitly state that color palette redesign is not part of the initial scope;
* explicitly state that dark mode is currently unsupported unless separately activated by a future task;
* define controlled migration as the only permitted adoption strategy.

## Exit condition

The project has one documented visual-authority plan and one active UI foundation cursor.

No production UI change is made.

---

# UI-AGENT-1 — Frontend Agent Authority Rules

## Goal

Update `AGENTS.md` or the authoritative frontend agent guidance before production migration begins.

## Required rules

The frontend guidance must state:

### Component discovery

Before introducing a shared visual structure, inspect:

```text
components/ui
components/shared
existing semantic recipes
existing authoritative component registry
```

### Visual authority

Shared visual authorities must be reused.

A business page must not recreate an existing authoritative visual recipe using equivalent primitive Tailwind utilities.

### Component insufficiency protocol

When an authoritative component is insufficient:

1. identify the missing semantic or interaction requirement;
2. determine whether the requirement belongs to the existing role;
3. extend the authority when the semantic role is unchanged;
4. introduce a distinct role only when semantics genuinely differ.

Do not bypass an authority because a local Tailwind implementation is faster.

### Tailwind boundary

Business pages may use Tailwind for structural layout and responsive behavior.

Business pages must not independently recreate an existing typography, surface, elevation, or status recipe.

### Typography

Chinese UI rendering is intentional.

Do not introduce new font-family stacks.

Do not create one-off typography recipes in business pages.

Serif usage is restricted to explicitly approved reading roles.

### Status color

Domain status color must flow through the authoritative status mapping.

Do not map domain states directly to raw visual tone classes in pages.

### Elevation

Business pages must not introduce shadow utilities unless the visual role explicitly owns overlay elevation.

## Exit condition

A new agent reading only the frontend authority guidance can identify:

```text
where to search for visual authority
what Tailwind usage is permitted
when a component may be extended
when a new visual role may be created
```

---

# UI-LINT-1 — Visual Authority Enforcement Substrate

## Goal

Establish deterministic enforcement before widespread primitive extraction or page migration.

## Principle

Do not attempt to infer arbitrary visual semantics.

Rules must enforce known authority boundaries.

The first rules should be narrow and high signal.

## Initial candidate rules

### `exam-ui/no-domain-status-color`

In business-page and feature scopes, reject direct domain-state presentation using raw:

```text
text-success
bg-success-soft
text-warning
bg-warning-soft
text-destructive
bg-destructive
text-info
bg-info-soft
```

where the code is presenting a domain status.

Allow:

```text
statusMeta.ts
StatusBadge
authoritative status components
visual feedback components where color represents feedback rather than domain state
```

The exact rule scope must be derived from actual AST patterns and existing usage.

Do not introduce a broad false-positive rule.

### `exam-ui/prefer-field-error`

Detect known inline field-error recipes already owned by `FieldError`.

Report the authority replacement.

### `exam-ui/prefer-inline-error-banner`

Detect the known destructive inline-banner recipe already owned by `InlineErrorBanner`.

### `exam-ui/no-business-shadow`

Reject `shadow-*` in business pages and feature components.

Allow overlays and explicitly registered authoritative components.

Existing violations may be grandfathered during the initial gate if necessary, but no new violation may be introduced.

### `exam-ui/no-arbitrary-typography`

Reject new arbitrary typography values such as:

```text
text-[...]
leading-[...]
tracking-[...]
```

outside approved primitive or specialized runtime components.

Existing ExamTimer values must be explicitly reviewed rather than silently normalized.

## Baseline strategy

The lint gate must distinguish:

```text
existing debt
new violation
```

Do not make the repository permanently red merely to prove a rule exists.

Use one of:

```text
explicit allowlist
baseline file
narrow initial file scope
controlled migration rule activation
```

The chosen method must remain inspectable and deterministic.

## CI

The UI authority lint command must become part of the normal verification graph.

## Exit condition

A new known visual-authority bypass cannot land silently.

---

# UI-TYPO-1 — Chinese Sans Font Authority Correction

## Goal

Make the project's Chinese UI font intentional and cross-platform stable.

## Accepted audit defect

The project self-hosts Noto Sans CJK SC regular, medium, and bold resources.

The active `--font-sans` stack places system and OS-specific fonts before the self-hosted CJK font.

This allows Windows, macOS, and Linux to render different Chinese typefaces while the project still downloads or prepares self-hosted CJK assets.

## Work

* make the self-hosted Chinese sans family authoritative in the appropriate semantic font role;
* remove Latin-first ordering that prevents the intended CJK face from being selected;
* preserve sensible fallback fonts;
* confirm actual loaded face names match the `@font-face` declarations;
* review the requested 400/500/600/700 roles against actual available font faces;
* do not retain `600` as a semantic dependency unless the selected family provides an intentional rendering strategy;
* introduce the initial semantic font roles:

```text
font.ui
font.reading
font.mono
```

`font.ui` and `font.reading` may initially resolve to the same physical sans family.

The semantic roles must remain separate.

## Runtime verification

At minimum verify:

```text
Windows Chromium
Linux Chromium
```

For representative Chinese text:

```text
body text
PageHeader title
section title
question stem
long answer
metric value
```

Record:

```text
rendered font
resolved weight
network font loading
```

## Exit condition

Chinese UI font selection is intentional and verified.

The project no longer self-hosts a primary CJK font while systematically preferring unrelated OS-specific CJK fonts.

---

# UI-TYPO-2 — Chinese Serif and Reading Roles

## Goal

Introduce an intentional serif reading role without turning serif into a global decoration or prestige signal.

## Work

Evaluate and establish:

```text
font.serif
type-reading
type-long-response
```

Serif is reserved for sustained reading contexts.

Initial allowed candidate contexts:

```text
long examination instructions
reading passages
long-form source material
selected long question stems
```

Conditional contexts requiring evidence:

```text
reference answers
grading rubrics
```

Initially forbidden serif contexts:

```text
buttons
navigation
tabs
badges
form labels
inputs
tables
dialog actions
scores
timers
metadata
status presentation
```

A serif role must specify:

```text
font authority
weight supply
line height
content measure
mixed Latin/CJK behavior
fallback behavior
```

Do not globally apply serif based on HTML tag names.

## Implementation authority (established)

The serif role is now physically established (UI-TYPO-2 complete):

```text
semantic role:  --font-serif  (apps/web/src/index.css)
physical asset: "Noto Serif SC", self-hosted under
                apps/web/public/fonts/noto-serif-sc/
provenance:     @fontsource/noto-serif-sc@5.2.8 (chinese-simplified subset), OFL 1.1
weights:        400 (regular), 700 (bold) — no 500/600 shipped
wiring:         apps/web/index.html loads css/{regular,bold}.css
fallback:       local("Noto Serif SC") -> local("Source Han Serif SC") -> self-hosted woff2
```

The semantic boundary (allowed / conditional / forbidden contexts above) is the
authority. `font.serif` is distinct from `font.reading` (the semantic sans
reading-family role) and from `type-reading` (the complete reading recipe,
UI-RECIPE-1A, which initially uses `font.reading`, not serif). Equating reading
with serif is forbidden; a future or explicitly approved recipe may opt a
surface into `font.serif`.

## Exit condition

Serif has a documented semantic role and a controlled implementation authority.

Business pages cannot introduce arbitrary serif usage.

---

# UI-VOCAB-1 — Semantic Visual Vocabulary

## Goal

Define the minimum visual vocabulary required by the existing application.

## Evidence source

Use the accepted UI audit.

Pay particular attention to:

```text
80+ muted text recipes
24+ metric/stat presentations
30+ titled content containers
multiple status presentation strategies
multiple table-shell strategies
```

## Method

For every proposed visual role, identify:

```text
observed consumers
semantic meaning
visual responsibility
whether structure is owned
whether interaction is owned
```

Classify each role as:

```text
TOKEN
RECIPE
COMPONENT
NOT A ROLE
```

Do not start from desired component names.

Start from observed semantics.

## Required initial output

A machine-readable or strongly structured visual authority registry.

Example conceptual form:

```yaml
role: typography.metadata
authority: recipe
implementation: type-metadata
owned-properties:
  - font-family
  - font-size
  - font-weight
  - line-height
  - color

role: feedback.field-error
authority: component
implementation: FieldError
owned-anatomy:
  - error text
owned-appearance:
  - critical text role

role: status.domain
authority: component
implementation: StatusBadge
mapping: statusMeta
```

The exact storage format is an implementation decision.

The registry must be easy for:

```text
humans
agents
lint rules
future audits
```

to inspect.

## Exit condition

The frontend has an explicit list of visual roles and one authority owner for each accepted role.

No role collision remains undocumented.

---

# UI-COMP-1 — Component Authority Reconciliation

## Goal

Reconcile existing shared components against the semantic visual vocabulary.

## Required review set

At minimum:

```text
PageHeader
StatsCard
DataTableShell
DataTablePagination
ListToolbar
DataToolbar
PageSection
ContentCard
StatusBadge
FieldError
InlineErrorBanner
RowActions
LoadingState
EmptyState
ErrorState
ConfirmDialog
ConfirmActionDialog
```

For every component assign:

```text
KEEP
EXTEND
MERGE
RENAME
DEMOTE
REMOVE
ROLE UNKNOWN
```

Also assign:

```text
owned semantic role
known consumers
known bypass patterns
```

Particular attention is required for:

```text
PageSection vs ContentCard vs DataTableShell
StatsCard vs four existing metric presentations
ListToolbar vs DataToolbar
ConfirmDialog vs ConfirmActionDialog
```

Do not preserve duplicate component APIs merely to minimize diff size.

Do not merge components solely because they look similar.

Semantic role is authoritative.

## Exit condition

Every retained shared visual component has a distinct role.

The project has no undocumented multi-owner visual role.

---

# UI-RECIPE-1 — Semantic Recipe Implementation

## Goal

Implement the accepted semantic vocabulary.

## Work

Introduce semantic recipes using the smallest mechanism compatible with the existing Tailwind v4 and shadcn substrate.

Prefer:

```text
Tailwind v4 custom utilities
CSS semantic classes
existing CVA variants
```

Do not introduce Panda CSS, Chakra UI, Vanilla Extract, StyleX, or another styling engine.

Those systems are architectural references, not migration targets.

Implement accepted typography recipes and non-structural visual roles.

Primitive Tailwind utilities may remain inside recipe implementation files.

Business pages consume recipe authority names.

## Exit condition

Accepted semantic recipes have one implementation source.

A recipe change does not require grep-based modification of unrelated business pages.

---

# UI-LINT-2 — Primitive Visual Vocabulary Boundary

## Goal

Tighten enforcement after valid semantic replacements exist.

## Rules

Introduce or activate rules such as:

```text
exam-ui/no-raw-typography
exam-ui/no-raw-surface-recipe
exam-ui/no-domain-status-color
exam-ui/no-business-shadow
exam-ui/no-authority-bypass
```

The exact primitive classes prohibited in business pages must be generated from or synchronized with the accepted semantic vocabulary.

Do not prohibit a primitive utility unless:

```text
a semantic authority exists
or
the utility is explicitly forbidden by product visual policy
```

## Exit condition

Business pages retain Tailwind for layout.

Business pages cannot recreate governed appearance recipes from primitive utilities.

---

# UI-PILOT-1 — Representative Page Migration

## Goal

Validate the complete authority model on one representative page.

## Recommended pilot

`GradingDetailPage`

Reason:

It contains:

```text
page hierarchy
status
question content
candidate answer
reference answer
rubric
form fields
field errors
score input
actions
long Chinese text
```

It exercises typography, reading, work surfaces, status, feedback, and form density.

## Work

Migrate only the pilot page and directly required shared authorities.

Do not perform opportunistic site-wide cleanup.

## Review

Evaluate:

```text
visual hierarchy
Chinese typography
font rendering
recipe coverage
component anatomy
Tailwind boundary
lint enforcement
accessibility
responsive behavior
```

## Exit condition

The representative page can be implemented primarily through:

```text
semantic recipes
authoritative components
structural Tailwind
```

without requiring local visual recipes.

---

# UI-MIGRATE-N — Controlled migration

## Goal

Migrate existing pages by visual-semantic families.

Recommended family order:

```text
1. grading
2. admin detail pages
3. dense list/table pages
4. candidate result pages
5. form-heavy pages
6. examination runtime
7. diagnostics and exceptional operational pages
```

Each migration task must:

1. identify the roles exercised;
2. identify existing authority bypasses;
3. migrate only to existing authorities;
4. introduce a new role only through vocabulary review;
5. remove corresponding lint grandfathering;
6. verify the migrated surface.

Do not perform a repository-wide mechanical Tailwind replacement.

## Final exit condition

The Exam frontend has:

* intentional Chinese sans rendering;
* an explicit serif reading role;
* semantic visual vocabulary;
* one authority owner per visual role;
* deterministic UI authority lint;
* CI enforcement;
* structural Tailwind in business pages;
* semantic recipes or authoritative components for governed appearance;
* no uncontrolled reintroduction of known visual recipes.

The resulting frontend design system must optimize for visual consistency under repeated AI modification, not merely for the appearance of one redesign pass.
