# P3-UI-AUDIT-0 — Frontend Visual Language, Chinese Typography, and Color Topology Audit

> **Read-only audit.** No production code, tests, CSS, configuration, documentation,
> font assets, or dependencies were modified. The purpose is to reconstruct the
> frontend's current visual system from evidence before any design-system work begins.
>
> Audit scope: `apps/web` — 113 business `.tsx` files + shadcn primitives + global CSS +
> Tailwind v4 theme + self-hosted font assets + i18n. Findings are derived from static
> inspection only; runtime verification gaps are listed in §10.

---

## 1. Verdict

**`VISUAL SYSTEM PARTIALLY IMPLICIT`**

The color layer and status layer are **explicit, centralized, and fully tokenized**
(a strength). But the Chinese-typography layer, the layout-rhythm layer, and the
"component vs page-inline" boundary are **implicit, scattered, enforced by
convention rather than mechanism** (a risk). The system is not broken, but the same
semantic role is implemented three different ways in several places.

---

## 2. Executive finding

1. **The color system is the strongest part of the codebase.** Zero `hex` literals,
   zero `rgb` literals, zero raw palette classes (`text-red-500` count = 0) in any
   `.tsx`. All color flows through `index.css` semantic tokens
   (`--primary` / `--danger` / `--success` / `--warning` / `--info`) plus a shadcn
   theme alias layer (`--color-primary`…). `statusMeta.ts` is the single source of
   truth for status → tone.
2. **A critical Chinese-typography defect exists.** `--font-sans` lists Latin-first
   system fonts (`system-ui`, `Segoe UI`, `PingFang SC`, `Microsoft YaHei`) **before**
   the self-hosted `"Noto Sans CJK SC"`, yet `index.html` preloads Noto's
   regular/medium/bold woff2 subsets. Result: the self-hosted font is effectively
   never matched, Chinese glyphs fall through to OS fallback (uncontrolled across
   platforms), and the preloaded subsets are dead payload.
3. **A systematic fracture exists between components and frontend modules that
   *could* be components.** Top-level shared components
   (`PageHeader` / `StatusBadge` / `LoadingState` / `EmptyState` / `ErrorState`)
   have high, consistent adoption. But **second-tier components**
   (`StatsCard` / `DataTableShell` / `PageSection` / `InlineErrorBanner` /
   `RowActions`) have uneven adoption: pages freely hand-roll equivalent inline
   recipes, and a single visual (the stat card) exists in **4 different forms**
   across the codebase.
4. **Dark mode is entirely unwired.** `index.css` has no `.dark` selector, no
   `prefers-color-scheme`, and no `ThemeProvider`; but generated shadcn primitives
   still carry ~17 `dark:` utilities — dead rules that give the false impression
   dark mode is supported.
5. Three real defect classes drive the verdict: **STAT-CARD-DRIFT** (4 forms),
   **SHELL-ADOPTION-DRIFT** (`DataTableShell` used / not used / hand-rolled `<Card>`
   — three ways), and **CJK-FONT-DEAD-LOAD**. The root cause is the absence of a
   "semantic typography layer" and a "component-adoption contract."

---

## 3. Component topology

### Classification (113 business files)

**① shadcn primitives (28, `components/ui/`, new-york style)** —
`button/card/badge/alert/dialog/alert-dialog/dropdown-menu/select/table/tabs/sheet/pagination/calendar/form/tooltip/popover/radio-group/checkbox/switch/input/textarea/label/separator/avatar/skeleton/sonner`.
All `components.json`-generated, with `data-slot` and CVA variants. **Treat as an
immutable baseline.**

**② Locally modified shadcn primitives: 0.** No business logic hand-edited into
`ui/` — clean.

**③ Shared application components (`components/shared/`, ~22, guarded by the 884-line
`shared.test.tsx`):**
- **State / feedback (highest adoption, ~universal):** `PageHeader`, `LoadingState`,
  `ErrorState`, `EmptyState`, `StatusBadge`, `FieldError`.
- **Form (medium adoption):** `FormSection`, `FormStack`/`FieldStack`,
  `FieldGroup`/`Field`/`FieldRow`, `DatePicker`, `FileUpload`.
- **Data display (low adoption, drift — see below):** `DataTableShell`,
  `DataTablePagination`, `ListToolbar`, `DataToolbar`, `ContentCard`, `StatsCard`,
  `SearchInput`, `RowActions`.
- **Dialogs:** `ConfirmDialog`, `ConfirmActionDialog` (**near-duplicates**, see risk
  table), `ImportWizard`, `InlineErrorBanner`, `ErrorBoundary`.

**④ Feature components:** `components/exam/` (18, exam runtime:
`QuestionRenderer`/`QuestionNavigator`/`ExamTimer`/`SaveIndicator`/per-type inputs),
`components/question/QuestionForm` (422 lines), `components/exam/ExamConfigForm`
(503 lines), `components/settings/*`.

**⑤ Page-local components:** `TimelineSection`/`ExportButtons` inside
`AttemptDetailPage`, `DashboardSkeleton` inside `DashboardPage`, `ExamCard` inside
`ExamListPage`, `AnswerText` inside `ResultPage`.

**⑥ Repeated visual structures not extracted to components:** see §4 and §9.

### Key risks (component relationships)

| Risk | Type | Evidence |
|---|---|---|
| `ConfirmDialog` ≈ `ConfirmActionDialog` | **SEMANTIC + CODE near-duplicate** | `ConfirmActionDialog` is a 33-line shell that only adds `disabled` merging + default-label resolution over `ConfirmDialog`. Two near-identical external APIs (`trigger`/`destructive`/`onConfirm`); callers mix them. |
| `ListToolbar` vs `DataToolbar` | **SEMANTIC near-duplicate** | Both render "rounded bordered card with search/filter/actions/summary." Differ only by breakpoint (`lg` vs `sm`) and slot naming (`search`+`filters` vs `children`). Pages pick "list" or "data" with no objective rule. |
| `DataTableShell` vs `PageSection` vs `ContentCard` | **SEMANTIC near-duplicate (three "titled content containers")** | All render `rounded-lg border bg-card` + title/description + body. `DataTableShell` adds footer/overflow-hidden; `PageSection` adds footer/header border; `ContentCard` has no title. Pages frequently bypass all three and inline `<Card><CardHeader>…` (see §4). |
| `ConnectionIndicator` (shared) **not used by `TakeExamPage`** | **Orphan component** | Defined in `shared/` but the exam runtime renders its own connection UI without referencing it. |

---

## 4. Visual recipe inventory

| Recipe / normalized shape | Approx. occurrences | Representative paths | Semantic uses |
|---|---:|---|---|
| **Stat card: `<Card shadow-sm><CardHeader pb-2><CardTitle text-sm muted>label</CardTitle></CardHeader><CardContent><p text-2xl/3xl bold>value</p></CardContent></Card>`** | **≥24** | `ExamDetailPage`(×7), `ScoreListPage`(×7), `SystemDiagnosticsPage`(×8), `DashboardPage`(`StatsCard` ×4) | numeric KPI overview |
| **Stat card variant B (no Card, pure `<p>` stack):** `<div><p text-sm muted>label</p><p text-3xl bold tabular-nums>value</p></div>` | ×4 | `AttemptDetailPage`(×4) | score summary |
| **Stat card variant C (skeleton):** `<div rounded-lg border p-6><Skeleton/>×2</div>` | ×4 | `DashboardPage`(×4), `SystemDiagnosticsPage`(×3) | loading placeholder |
| **Titled content container:** `<Card shadow-sm><CardHeader><CardTitle text-base>…</CardTitle></CardHeader><CardContent>…` | **≥30** | `DashboardPage`, `ScoreListPage`, `AttemptDetailPage`, `ExamDetailPage`, `ResultPage` | titled section — should be `PageSection` |
| **`rounded-lg border bg-card p-5` content panel** | ×8 | `QuestionWorkspace`, `TakeExamPage` question area | question/answer carrier |
| **Inline error banner:** `rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive` | ×2 | `InlineErrorBanner`(definition), `ExamDetailPage`(inlined copy) | error notice |
| **Candidate answer read-only box:** `min-h-16 rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap` | ×1 | `GradingDetailPage` | read-only answer display |
| **`label:value` metadata double-column:** `<div grid grid-cols-2 gap-2><span text-muted-foreground>L</span><span>V</span>…` | ×1 (6 pairs) | `ExamDetailPage` | config definition list |
| **Row action group:** `<div flex gap-1>` or `flex gap-1.5` | multiple | `ExamPage`(inlined `flex gap-1`), `QuestionPage`/`CandidatesPage`(uses `RowActions`) | table row actions |
| **Pagination:** full `<Pagination>/<PaginationContent>/...` | inlined ×1 vs component ×N | `ScoreListPage`(inlined), `QuestionPage`(`DataTablePagination`) | pagination nav |
| **inline spinner:** `<LoaderCircle size-4 animate-spin/>` + `text-sm muted` span | ×1+ | `QuestionPage`(inlined), `StatusBadge`/`SaveIndicator`(component) | async loading |

### Two defect classes that must be kept separate

- **Same visual recipeerving unrelated semantics:** `Card shadow-sm` +
  `CardTitle text-base` is used simultaneously as a data-table shell
  (`ScoreListPage`), a config block (`ExamDetailPage` config), a timeline shell
  (`AttemptDetailPage`), and a result summary (`ResultPage`). No visual
  differentiation → no semantic signal.
- **Same semantic role implemented with different visual recipes:** the "stat
  number" exists in **4 forms** (table above: `StatsCard` / Card variant / `<p>`
  variant / skeleton variant); the "error banner" exists in both `InlineErrorBanner`
  and `ExamDetailPage`'s inline copy; the "status badge" exists in three forms
  (`StatusBadge`, `Badge variant=secondary + eventToneClass`, and plain text in
  `CandidatesPage`).

---

## 5. Chinese typography audit

### C1. Font authority (KNOWN)

- **Single font definition source:** `apps/web/src/index.css`
  `@theme inline { --font-sans; --font-mono }`. No Tailwind JS config (v4 CSS-only).
- **`--font-sans` (effective stack):**
  ```
  system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
  "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif
  ```
- **`--font-mono`:** `ui-monospace, SFMono-Regular, Menlo, …` (no CJK monospace
  fallback).
- **Loading:** `index.html` uses three `<link rel=stylesheet>` to preload
  `/fonts/noto-sans-cjk-sc/css/{regular,medium,bold}.css`, each containing hundreds
  of `@font-face` declarations (unicode-range subsetted woff2).
- **Size/weight:** `body{font-size:14px;font-weight:400}`;
  `h1,h2,h3{font-weight:600}`.
- **No serif role;** no dedicated long-form Chinese reading role; no dedicated
  numeric role (`tabular-nums` is used ad-hoc — see C4).
- **`branding.defaultName` resolves via i18n:** `zh-CN.ts` is the single copy source
  (`lang="zh-CN"`).

### C2. CJK fallback risk

**KNOWN (repo evidence):** in the `--font-sans` ordering, `"Noto Sans CJK SC"` is
7th, preceded by `system-ui`, `-apple-system`, `Segoe UI`, `PingFang SC`,
`Microsoft YaHei`. Although each `@font-face` declares `local("Noto Sans CJK SC")`,
the main stack prefers system fonts, so **the self-hosted Noto is effectively never
matched** on any machine that has one of the above system CJK fonts installed.

**INFERENCE (platform fallback behavior):**
- **Windows Chromium:** `Segoe UI` matches Latin; CJK falls to `Microsoft YaHei`.
  Glyphs = YaHei.
- **Linux Chromium:** `system-ui` usually → Sans/Noto; CJK mostly falls to
  `Noto Sans CJK SC` (if system-installed) or `Source Han`.
- **macOS:** `PingFang SC` matches. Glyphs = PingFang.

→ The same product renders **three different Chinese glyph families across OSes**,
and the preloaded Noto subsets (hundreds of woff2) are essentially **dead payload**.
This is a textbook `LATIN-FIRST-TYPOGRAPHY` structural defect.

**RUNTIME VERIFICATION REQUIRED:** the actual matched font family name per OS
(see §10).

### C3. Weight audit (KNOWN + inference)

Weight utility counts: `font-medium`×66, `font-semibold`×22, `font-bold`×22,
`font-normal`×12. **No `font-light`/300.**

- **KNOWN:** the self-hosted Noto provides only **regular(400) / medium(500) /
  bold(700)** CSS files. **No 600 (semibold) file exists.**
- **INFERENCE:**
  - `font-medium`(500) maps to Noto medium — **if Noto is matched**.
  - `font-semibold`(600) is used for `h1/h2/h3`, `CardTitle`, `PageHeader` titles,
    `SidebarLink` active state. **Noto has no 600 weight** → the browser either
    snaps to the nearest available weight (500 or 700) or applies **synthetic bold**
    to 400/500, with cross-platform / cross-font results that are not predictable.
  - `font-bold`(700) is used for stat numbers (`text-3xl font-bold`) — if Noto is
    matched there is a true bold; if YaHei/PingFang is matched, 700 may be synthetic.

**`CJK-WEIGHT` + RUNTIME VERIFICATION REQUIRED:** actual semibold rendering on
Windows (YaHei) / Linux / macOS.

### C4. Chinese text recipes

Size/line-height counts: `text-sm`×148, `text-xs`×46, `text-base`×23, `text-2xl`×15,
`text-lg`×11, `text-3xl`×5, `text-xl`×2, `text-5xl`×1; arbitrary pixels only 2
(`text-[11px]`, `text-[13px]`, both in `ExamTimer`).

**Line-height usage is rare and unsystematic:** `leading-none`×4,
`leading-relaxed`×1, `leading-tight`×1, `leading-8`×1 (only `TakeExamPage` question
stem `text-xl leading-8`).

Defect classes (by Chinese-reading standards):

- **`CJK-LINE-HEIGHT` (systemic):** the vast majority of Chinese body text uses
  bare `text-sm` with no explicit line height. Tailwind v4 `text-sm` defaults to
  `line-height:1.25rem`(20px) — too tight for Chinese (ideal 1.5–1.7). Only the
  `TakeExamPage` question stem sets `leading-8`; this is an isolated case, not a
  systemic decision.
- **`FULL-WIDTH-READING` (inconsistent):** the reading-width role is scattered —
  `max-w-7xl`(×3, exam runtime / admin lists), `max-w-4xl`(×2, `ExamListPage` /
  `TakeExamPage` question area), `max-w-5xl`(×1, `ResultPage`), `max-w-2xl`(×6,
  dialogs). No unified "long-form reading container" role.
- **`MIXED-LATIN-CJK-INCONSISTENCY`:** mixed Latin/CJK numbers (e.g.
  `passingScore/totalScore`, `minutes`) have no unified numeric role; `tabular-nums`
  is only used locally in `ExamTopbar` / `AttemptDetailPage` / `SystemDiagnostics`.
- **Question-stem typography:** the `TakeExamPage` stem uses
  `text-xl font-medium leading-8` — the only place in the codebase that makes an
  explicit line-height decision for long Chinese text. It is captured by no
  abstraction, and other long-Chinese surfaces (e.g. `QuestionPreview`,
  `GradingDetailPage` answer box) do not follow it.
- **`TEXT-DENSITY`:** `text-sm text-muted-foreground` as the "secondary text" recipe
  repeats 80+ times, with no `metadata-text` / `helper-text` role.

---

## 6. Color topology

### Topology (two-layer mapping, KNOWN)

**Layer 1 (`:root` semantic variables):** `--bg #f7f8fb`, `--surface #fff`,
`--surface-muted #f9fafb`, `--text #111827`, `--text-muted #6b7280`,
`--text-subtle #9ca3af`, `--border #e5e7eb`, `--border-strong #d1d5db`,
`--primary #2563eb` (+hover/soft), `--danger #b42318` (+hover/soft/border),
`--success #047857` (+soft), `--warning #b54708` (+soft), `--info #175cd3` (+soft),
`--sidebar-*` (a dark sidebar set). `--radius: 0.5rem`.

**Layer 2 (`@theme inline` → Tailwind class names):** `--color-primary →
var(--primary)` etc., exposing `bg-primary`/`text-success`/`bg-success-soft`/
`border-destructive` etc.

**Layer 3 (`statusMeta.ts` → `StatusBadge`):** `StatusTone ∈ {primary, secondary,
success, warning, destructive, info, muted}` → `toneClasses` maps to
`bg-*-soft text-*`. **The single source of truth for status→color, extremely tidy.**

### Role grading

| Role | Grade | Evidence |
|---|---|---|
| page / content / raised surface | **DEFINED + CONSISTENT** | `--bg`/`--surface`/`--surface-muted` consistent |
| primary / secondary / muted text | **DEFINED + CONSISTENT** | `--text`/`--text-muted` |
| primary action | **DEFINED + CONSISTENT** | `--primary` + button `default` variant |
| destructive action | **DEFINED + CONSISTENT** | `--danger` + `danger-hover`/`danger-soft` |
| success / warning / info | **DEFINED + CONSISTENT** | three colors + each `-soft`; `StatusBadge` covers all |
| border hierarchy | **DEFINED + CONSISTENT (two tiers)** | `--border`/`--border-strong` |
| disabled state | **CONSISTENT** (via `disabled:opacity-50`) | but no `--disabled` token |
| focus state | **CONSISTENT** | `focus-visible:ring-ring/30` uniform |
| selected / active | **CONSISTENT** | sidebar `bg-sidebar-accent`, navigator `ring-primary` |
| dark mode | **MISSING (phantom)** | see §2/§7: no `.dark` in CSS, primitives carry dead `dark:` rules |
| chart colors | **MISSING** | no charts |
| `--text-subtle #9ca3af` | **DEFINED but RAW/unwired** | defined, but not aliased into `--color-*` in `@theme`, so no `text-subtle` utility is generated — an orphan token |

**Conclusion:** the color topology is the healthiest layer. The only real issues
are **dark mode is a phantom** (primitives write `dark:` but nothing activates it)
and `--text-subtle` is unwired.

---

## 7. Modernity smell findings (ranked by systemic impact)

| # | Defect class | Code evidence | Representative page/component | Why hierarchy is weakened | Scope |
|---|---|---|---|---|---|
| 1 | **STAT-CARD-DRIFT** (custom) | the single "stat card" semantic exists in 4 forms: `StatsCard`, the `<Card shadow-sm>…<p text-2xl bold>` of `ExamDetailPage`/`ScoreListPage`/`SystemDiagnosticsPage`, the Card-less `<p text-3xl bold>` of `AttemptDetailPage`, and the skeleton `<div rounded-lg border p-6>` | 5 pages, ≥24 instances | the user sees "numeric overview" with different density/font-size/border/shadow on every page — no stable mental model of "this is a KPI" | **SYSTEMIC** |
| 2 | **CJK-FONT-DEAD-LOAD / LATIN-FIRST-TYPOGRAPHY** | `--font-sans` orders system fonts before Noto; `index.html` preloads three Noto subsets | `index.css` + `index.html` | Chinese glyphs uncontrolled across platforms; preload wasted; semibold synthetic where no 600 weight exists | **SYSTEMIC** |
| 3 | **SHELL-ADOPTION-DRIFT** (custom, = WEAK-HIERARCHY + SPACING-DRIFT) | `DataTableShell`: `ExamPage` uses it; `QuestionPage`/`CandidatesPage` do **not** (bare `<Table>`); `ScoreListPage`/`ExamDetailPage` **hand-roll `<Card>`** | 4 list/detail pages | equivalent "table/content shell" sometimes has a border-card wrapper, sometimes not → visual density jumps; no enforced adoption contract | **SYSTEMIC** |
| 4 | **CJK-LINE-HEIGHT** | default `text-sm`(20px line-height) serves most Chinese body; only `TakeExamPage` stem sets `leading-8` (isolated) | almost all pages' body text | Chinese is dense and breathless; long reading fatiguing | **SYSTEMIC** |
| 5 | **STATUS-COLOR-DRIFT** | "status display": `StatusBadge` (`ExamPage`/`ScoreListPage`), `Badge variant=secondary + eventToneClass` (`AttemptDetailPage` timeline), plain text (`CandidatesPage` isActive) | 3 pages | same semantic, three color treatments → user cannot recognize status by color quickly | **SYSTEMIC** |
| 6 | **CARD-EVERYTHING (mild)** | `Card shadow-sm` used as a universal container: stat blocks, config blocks, timeline, table shells, result summary all use it with no visual differentiation | `ScoreListPage`/`ExamDetailPage`/`DashboardPage` | all content is equally "carded"; hierarchy maintained only by shadow/font tweaks, weakening primary/secondary | **SYSTEMIC** |
| 7 | **SHADOW-EVERYTHING (mild)** | `shadow-sm`×32 + almost every `<Card>` manually given `shadow-sm` (`ExamDetailPage` 10×, `SystemDiagnosticsPage` 8×, `ScoreListPage` 7×) | detail / stat pages | shadow everywhere → loses "elevated" meaning, becomes the default | **SYSTEMIC** |
| 8 | **FORM-DENSITY (local)** | `GradingDetailPage` uses one `<Card>` per question, each with 4×`<div space-y-2>`+`<Label>`+control+`<p text-sm destructive>`, repeated N times | `GradingDetailPage` | no form-field abstraction; density via stacked `space-y` | LOCAL |
| 9 | **RADIUS-DRIFT (mild)** | `rounded-md`×47 / `rounded-lg`×31 / `rounded-xl`(only `Card`)/`rounded-sm`/`rounded-full` coexist; `--radius` is defined but usage is not converged | global | many radius tiers but no written rule "inputs=md, cards=lg" | SYSTEMIC (mild) |
| 10 | **BORDER-EVERYTHING (reverse, weak)** | almost all panels have `border`, but border color is single-tier (`--border`); no weak/strong border narrative — `--border-strong` is almost only used on `input` | global | hierarchy relies on shadow rather than border weight | LOCAL |
| 11 | **GRAY-SOUP (mild)** | `text-muted-foreground`×80+; secondary info uniformly the same gray; no `subtle`/`muted` second tier | global | secondary info cannot be further layered | SYSTEMIC (mild) |

---

## 8. Representative page matrix

| Surface | Typography | Surface hierarchy | Color hierarchy | Density | Primary smells |
|---|---|---|---|---|---|
| **Candidate exam runtime** (`TakeExamPage`) | stem `text-xl leading-8` (sole line-height decision); topbar `text-lg semibold`; lots of `text-sm muted` | topbar(sticky) + left nav(`xl:w-24`) + main(`max-w-4xl`) + footer(sticky) | `bg-background`/`bg-card`; status via `SaveIndicator` token; destructive via `destructive/10` soft bg | medium: `max-w-4xl` width limit | CJK-LINE-HEIGHT(outside stem), GRAY-SOUP; but navigator/timer are self-consistent |
| **Admin exam detail** (`ExamDetailPage`) | `PageHeader` title + 7 hand-rolled stat cards + hand-rolled label:value grid | `Card shadow-sm` ×10+ stacked, no `PageSection` | token-consistent; inlined error banner (re-copies `InlineErrorBanner`) | high: card-dense | STAT-CARD-DRIFT, CARD-EVERYTHING, SHELL-ADOPTION-DRIFT, SHADOW-EVERYTHING |
| **Admin grading detail** (`GradingDetailPage`) | `PageHeader`+`description`+`status` (richest); `CardTitle text-base` stem; `min-h-16 … whitespace-pre-wrap` answer box | one `Card` per question (no shadow — inconsistent with other pages) | token-consistent; field error `<p text-sm destructive>` inline | high: per-question cards | FORM-DENSITY, CJK-LINE-HEIGHT(answer long text) |
| **Admin proctor** (`ProctorDashboardPage`/`ExamMonitoringPage`) | not deeply read; Phase2 doc-forbidden per AGENTS, should not be implemented | — | — | — | (outside static visual scope here) |
| **Auth/setup** (`LoginPage`) | not deeply read | — | — | — | — |
| **Dense table** (`QuestionPage`/`ScoreListPage`) | `PageHeader` + table; `ScoreListPage` top has 5 hand-rolled stat cards | `QuestionPage` bare `<Table>`; `ScoreListPage` hand-rolled `<Card>` shell + hand-rolled `<Pagination>` | `ScoreListPage` uses `StatusBadge`; `QuestionPage` uses `Badge TYPE_VARIANT` | high | SHELL-ADOPTION-DRIFT, STAT-CARD-DRIFT, pagination re-copy |
| **Long reading** (`ResultPage`) | `text-5xl bold` total score; table Chinese without line-height tuning | `max-w-5xl` + two `Card`s | pass/fail via `text-success`/`text-destructive` | medium | CJK-LINE-HEIGHT, ad-hoc numeric role |
| **Form-heavy** (`ExamEditPage`/`QuestionForm`/`ExamConfigForm`) | `PageHeader` + two-column `grid-cols-2 gap-4` | bare `<div>` columns + inlined `<h3 text-sm medium>` section titles | token-consistent; `InlineErrorBanner` used | medium | inlined section titles (bypass `PageSection`), form-field unabstracted |

---

## 9. Extraction evidence (based only on observed repetition; no presupposition)

| Candidate role | Observed evidence | Distinct consumers | Semantic consistency | Visual consistency | Extraction confidence |
|---|---|---|---|---|---|
| **StatCard / KpiCard** | `StatsCard`(component) + `<Card shadow-sm><p text-2xl bold>`(ExamDetail/ScoreList/SysDiag) + `<p text-3xl bold>`(AttemptDetail) + skeleton variant | 5 pages, ≥24 instances | high (all "label + big numeric KPI") | **low** (4 forms differ in font-size/border/shadow) | **HIGH** (must first unify, then extract) |
| **SectionCard (titled content container)** | `PageSection`/`ContentCard`/`DataTableShell` are already three implementations, re-copied as `<Card><CardHeader><CardTitle text-base>` in ≥5 pages | ≥8 pages | medium (all "titled content block" but footer/overflow semantics differ slightly) | high | **MEDIUM** (first converge the existing three) |
| **MetadataRow / DefinitionList (label:value)** | `grid-cols-2 gap-2` span pairs (ExamDetail), `flex gap-2 text-sm muted · value` rows (GradingDetail/SysDiag), inlined `IP: …` (AttemptDetail) | 3 pages | high | medium | **MEDIUM** |
| **FieldErrorInline (form field error)** | `<p text-sm/text-xs destructive>` scattered (GradingDetail/Candidates/QuestionForm); `FieldError` component exists but is not adopted everywhere | ≥4 sites | high | high | **HIGH** (adopt the existing component) |
| **LoadingSkeleton / StatSkeleton** | `<div rounded-lg border p-6><Skeleton/>` in Dashboard(×4) + SysDiag(×3) | 2 pages | high | high | **MEDIUM** |
| **ReadOnlyTextPanel (candidate answer read-only box)** | `min-h-16 rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap` | 1 page (GradingDetail), but the semantic will recur in result/grading views | high | high | **LOW** (only 1 site today; wait for repetition to grow) |
| **AnswerFormatter (`formatAnswer` utility)** | `AttemptDetailPage`/`GradingDetailPage`/`ResultPage` each copy a same-named `formatAnswer` (CODE DUPLICATION, not visual) | 3 files | high | — | **HIGH** (pure code extraction, zero visual risk) |
| **PaginatedResponse type** | 5 pages each declare their own `interface PaginatedResponse<T>` (CODE DUPLICATION) | 5 files | high | — | **HIGH** (should come from `@exam/contracts`) |

---

## 10. Runtime verification gaps (static inspection cannot answer reliably)

| Question to verify | Smallest runtime probe |
|---|---|
| actual matched Chinese font family per OS | on Windows/Linux/macOS open DevTools → for `body`/`h1` "Computed → rendered fonts," record the family |
| `font-semibold`(600) rendering where no 600 weight exists (synthetic bold? snap to 500/700?) | same as above, on `.font-semibold` Chinese elements check "synthetic"/actual weight |
| whether self-hosted Noto truly never loads (verify dead network payload) | DevTools Network filter `noto-sans-cjk-sc`, check whether any woff2 is a 200 |
| whether `--text-subtle` is truly unusable | DevTools: try adding `text-subtle` class to an element, confirm Tailwind did not generate it |
| actual line-height readability of Chinese body | real-viewport screenshot of `TakeExamPage`/`ResultPage`, measure line spacing |
| whether `dark:` dead rules produce any style | DevTools: under missing `.dark`, check whether primitives change color in `prefers-color-scheme: dark` (they should not) |
| dark-mode usability (if wired in future) | after adding `.dark`, check contrast |

---

## 11. Top five root causes (root causes, not symptoms)

1. **No "semantic typography layer" contract.** Color has the strong three-layer
   constraint of `statusMeta` + tokens, but **font-size / font-weight / line-height /
   reading width have no equivalent centralized definition** —
   `text-sm text-muted-foreground` is a de-facto standard formed by 80+ repetitions,
   not an explicit role (`metadataText`/`pageTitle`/`sectionTitle`/`readingContent`).
   This is the common root cause of CJK-LINE-HEIGHT, TEXT-DENSITY, and GRAY-SOUP.

2. **The `--font-sans` ordering is a design error and the self-hosted font never
   becomes the effective first choice.** This single decision failure is the root of
   LATIN-FIRST-TYPOGRAPHY, CJK-FONT-DEAD-LOAD, and CJK-WEIGHT in one stroke. Fixing
   it requires both reordering the font stack and confirming the semibold weight
   supply.

3. **Second-tier shared components are "built but not used" — no adoption contract
   or lint enforcement.** `StatsCard`/`DataTableShell`/`PageSection`/
   `InlineErrorBanner`/`FieldError`/`DataTablePagination` all exist, but pages can
   freely bypass them. `lint:arch` guards dependency boundaries but **has no rule
   forbidding "inlining a recipe for which a shared component already exists."** So
   STAT-CARD-DRIFT, SHELL-ADOPTION-DRIFT, and STATUS-COLOR-DRIFT keep regenerating.

4. **The "component vs page-inline" boundary is decided per-page by each author,
   with no template.** `ExamPage` is the golden template (`DataTableShell` +
   `DataToolbar` + `StatusBadge` + `RowActions`), but the same week's
   `ScoreListPage`/`ExamDetailPage` hand-roll `<Card shadow-sm>` — which means the
   documentation (`docs/ui/05-page-templates.md`) exists but **is not followed by
   the code**, and the `docs/ui/` directory referenced in AGENTS.md does not actually
   exist (the real files are in `docs/` root: `frontend-ui-audit-report.md` etc.).
   Documentation authority and code reality are disconnected.

5. **Dark mode is a "half-finished state" never closed out.** Primitives carry
   `dark:` (shadcn-generated defaults) but CSS/Provider are fully unwired, creating a
   phantom of "looks supported, is not," and nobody cleaned it up. This is the
   classic "introduced an abstraction but never closed the loop," same root as #3
   (no forced close-out mechanism).

---

## 12. Audit boundary

**Inspected (all static, read-only):**
- `apps/web/index.html`, `apps/web/components.json`, `apps/web/package.json`,
  `vite.config.ts` (not fully read, but font/style-relevant parts checked).
- `apps/web/src/index.css` (global theme + font stack, line by line).
- `apps/web/src/main.tsx`, `App.tsx` (routing and provider topology).
- `apps/web/src/components/ui/`: `button`, `card`, `badge`, `alert` (line by line);
  `textarea`/`checkbox`/`switch`/`radio-group`/`select`/`dropdown-menu`/`tabs`/
  `input`/`sonner` sampled for `dark:` confirmation.
- `apps/web/src/components/shared/`: all 22 components read line by line.
- `apps/web/src/components/layout/`: `AdminLayout`, `ExamLayout`, `AppSidebar`,
  `BrandMark`, `BrandHeader`, `BrandProvider` line by line.
- `apps/web/src/components/exam/`: all 18 exam-runtime components line by line.
- `apps/web/src/components/question/QuestionForm` (structure sampled),
  `components/exam/ExamConfigForm` (structure sampled), `components/settings/*`
  (not line by line).
- Representative pages line by line: `TakeExamPage`, `ResultPage`, `ExamListPage`,
  `QuestionPage`, `ExamPage`, `CandidatesPage`, `ScoreListPage`, `ExamDetailPage`,
  `ExamEditPage`, `AttemptDetailPage`, `GradingDetailPage`, `DashboardPage`;
  `SystemDiagnosticsPage` (className-pattern sampled), `QuestionForm`
  (className-pattern sampled).
- `apps/web/src/lib/statusMeta.ts` + `statusMetaUtils.ts` line by line.
- `apps/web/public/fonts/noto-sans-cjk-sc/css/regular.css` sampled (to confirm
  unicode-range subsetting and 400-only weight in that file).
- Quantitative searches: raw palette classes (0), hex/rgb literals (0),
  `var(--…)` references, `font-*` weights, `text-*` sizes, `shadow-*`, `rounded-*`,
  `leading-*`, `max-w-*`, `dark:`, `whitespace-pre-wrap`, `shadow-sm` distribution
  by file, `formatAnswer`/`PaginatedResponse` duplication.

**Not inspected line by line:**
`pages/admin/{CoursePage,UsersPage,AuditLogPage,GradingQueuePage,ProctorDashboardPage,ExamMonitoringPage,ExamCreatePage,QuestionEditPage,QuestionImportPage,ImportLogsPage,ResultsOverviewPage,CandidateFieldsPage,SettingsPage}`,
all `*.test.tsx` (used only to infer component test coverage),
`i18n/locales/zh-CN.ts` (only confirmed to exist and to be the copy source — copy
was not verified entry by entry), `hooks/`, `lib/` (except statusMeta), `exam/`
(`transientReducer`/`deriveTakeExamView` logic is non-visual).

**Not done:** did not run the dev server, did not screenshot, did not verify font
matching in a real browser, did not quantify contrast.

**Confirmed no files were modified:** this task was entirely read-only. All reads
were `Read`/`Bash` (grep/wc/cat/find/ls) and Agent exploration; no `Edit`/`Write`
was invoked against source.

Report ends here. No fixes implemented. No redesign proposal written. No design
system created.
