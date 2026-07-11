# Typography Semantic Vocabulary

> Authority for the semantic typography roles of the Exam frontend
> (UI-VOCAB-1T). Derived from the accepted UI audit and actual application
> consumers — not from desired component names. Each CONFIRMED role is the
> single public authority for its semantic purpose; the `type-*` recipe
> primitives (UI-RECIPE-1A) implement these roles.

## How to read this

- **Role** — the public semantic name (recipe authority). One role ⇒ one public
  recipe name; business consumers use the role name, never the primitive stack.
- **Owned properties** — what the recipe pins. A role does NOT own every
  property; size may be owned by layout context when consumers vary in scale.
- **Representative consumers** — observed in-repo evidence (non-exhaustive).
- Font-family roles (`font.ui`, `font.reading`, `font.serif`, `font.mono`) are
  distinct from complete typography recipes (`type-*`): `font.reading` is the
  semantic reading-family role; `type-reading` is the complete recipe and
  initially uses `font.reading`, NOT `font.serif`. Equating reading with serif
  is forbidden.

---

## CONFIRMED roles

| Role | Semantic purpose | Owned properties | Representative consumers |
| --- | --- | --- | --- |
| `page-title` | The single title of a page; strongest non-numeric hierarchy. | family `font.ui`, size `2xl`, weight `700`, color primary text, leading tight, tracking tight | `PageHeader` `h1`; `StartExamPage`/`ResultPage`/`ExamSettingsPage` h1 |
| `page-description` | Subtitle/lede directly under a page or section title; explanatory, not factual-record. | family `font.ui`, size `sm`, weight `400`, color muted, leading `snug` | `PageHeader` description; `FormSection`/`PageSection` description |
| `section-title` | Title of a content section / card / panel within a page. | family `font.ui`, size `base` (or `lg` at page-section scale), weight `700`, color primary text | `PageSection`/`DataTableShell`/`FormSection` `h2`; `CardTitle` |
| `body` | Default running UI text. | family `font.ui`, size `sm` (14px base), weight `400`, color primary text, leading `snug` | `body`; general paragraph text |
| `secondary` | De-emphasized running text that is explanatory/secondary but not a compact factual record. | family `font.ui`, size `sm`, weight `400`, color muted, leading `snug` | `text-sm text-muted-foreground` descriptive spans (80+ uses) |
| `metadata` | Compact supporting factual information: timestamps, identifiers, secondary record facts, operational context. NOT "small gray text" — requires the factual-record meaning. | family `font.ui`, size `xs`, weight `400`/`500`, color muted, leading `snug`; optional `tabular-nums` for numeric facts | `AttemptDetail` timestamps/actor/IP; `AuditLog`/`SystemDiagnostics` facts; `StatsCard` trend |
| `reading` | Sustained reading of a long Chinese passage (exam instruction, long question stem). Higher line-box than UI body. | family `font.reading`, size `xl`, weight `500`, color primary text, leading `loose` (~1.7 for CJK) | `TakeExamPage` question stem (`text-xl font-medium leading-8`) |
| `long-response` | Read-only long candidate/source text that may wrap many lines; preserves whitespace. | family `font.reading`, size `sm`, weight `400`, color primary text, leading `relaxed`, `white-space: pre-wrap`, `min-height` | `GradingDetailPage` candidate-answer box; `CoursePage` long descriptions |
| `metric` | A KPI/stat numeric value; the prominent number of a stat card. | family `font.ui`, weight `700`, color primary text, `font-variant-numeric: tabular-nums`; size OWNED BY LAYOUT (consumers use `2xl`/`3xl`/`5xl`) | `StatsCard` value; `ExamDetail`/`ScoreList`/`SystemDiagnostics`/`AttemptDetail` stat numbers; `ResultPage` total score |
| `numeric` | Tabular numeric alignment for tables/timers/counts (not the prominent metric). | `font-variant-numeric: tabular-nums`; optional weight; size/family OWNED BY LAYOUT | `ExamTimer`/`ExamTopbar` time; `ExamMonitoring`/`SystemDiagnostics` table cells; score table columns |
| `code` | Monospaced code / log / JSON dump presentation. | family `font.mono`, size `xs`, weight `400`, `white-space: pre`, `overflow-x: auto` | JSON/log `<pre>` in `ImportLogs`/`AuditLog`/`AttemptDetail`/`ErrorBoundary`; `ExamTimer`/`ExamTopbar` time uses `font.mono` |

---

## MERGED

| Candidate | Merged into | Reason |
| --- | --- | --- |
| `helper` | `page-description` / `secondary` | The only "helper" usage (form/section description) is semantically identical to page/section description — explanatory text under a title. It is NOT distinguishable from `page-description`. Distinguished from `field-error` (critical feedback, separate component) and `metadata` (factual records). |

## DEFERRED

| Candidate | Reason |
| --- | --- |
| `section-description` | Weak standalone evidence; the description-under-section-title recipe is the same shape as `page-description`. Reuse `page-description` for now; split only if section-scale descriptions need a distinct size later. |
| `long-response` serif opt-in | The `long-response` role EXISTS (confirmed) but initially uses `font.reading` (sans). Opting a specific long-response surface into `font.serif` is a future explicitly-approved decision (UI-TYPO-2 conditional roles), not enabled by default. |

## REJECTED

| Candidate | Reason |
| --- | --- |
| `field-error` | NOT a typography recipe — it is a feedback component (`FieldError`) owning anatomy (role=alert) + critical text. Typography-wise it reuses `secondary`/`xs` size with `critical` color; its authority is the component, not a `type-*` recipe. |
| `status` | NOT a typography recipe — domain status presentation is owned by `StatusBadge` + `statusMeta.ts` (a separate authority). Typography recipes must not reproduce domain status colors. |

---

## Font-family roles (semantic, distinct from recipes)

| Role | Resolves to | Purpose |
| --- | --- | --- |
| `font.ui` | `--font-ui` (Noto Sans CJK SC first) | All UI text |
| `font.reading` | `--font-reading` (currently = `--font-ui`) | Sustained reading family role; recipe `type-reading` uses this, NOT serif |
| `font.serif` | `--font-serif` (Noto Serif SC) | Sustained Chinese reading ONLY, by explicit opt-in (UI-TYPO-2 boundary) |
| `font.mono` | `--font-mono` | Code/log/mono presentation |

---

## Synchronization with ESLint

The structural lint proxy `exam-ui/no-raw-typography` was **retired** in
UI-MIGRATE-N-W3: it could not deterministically distinguish `section-title`
ownership from topbar/question/overlay title roles (no sound NARROW AST
boundary existed). It is **not** an active rule and this vocabulary is no
longer described as the source for it. Recipe authority is enforced by
semantic migration review and the recipe authority tests
(`typography/recipes.test.ts`), not by a structural lint proxy.

`exam-ui/no-arbitrary-typography` remains the active **global token-policy**
rule (confirmed KEEP in UI-MIGRATE-N-W4A). It forbids the arbitrary-value
bracket form (`text-[…]` / `leading-[…]` / `tracking-[…]`, including under
responsive/state/stacked variant prefixes) regardless of semantic role; the
semantic role itself is owned by these recipes. The primitive classes each
recipe owns (e.g. `page-title` owns `text-2xl` + `font-bold` + weight +
leading) are recorded in the recipe implementation
(`src/typography/recipes.css`, UI-RECIPE-1A).
